// processSetterReply — native replacement for n8n's Text_Engine workflow.
// Mirrors the input/output contract documented in
// n8n/exports/Text_Engine_REVERSE_ENGINEERED.md so processMessages.ts can
// branch on clients.use_native_text_engine and replace the n8n hop.
//
// Input:  { Message_Body, Lead_ID, Contact_ID, GHL_Account_ID, Name, Email, Phone, Setter_Number }
// Output: { Message_1: string, Message_2?: string, ... }
//
// Approach:
// 1. Resolve client by ghl_location_id = GHL_Account_ID
// 2. Open the client's external Supabase (text_prompts + chat_history live there)
// 3. Read the setter prompt (text_prompts.system_prompt, card_name = "Setter-N")
// 4. Read chat_history (last 30 rows for session_id = Lead_ID)
// 5. Call OpenRouter with the setter prompt as system, chat as messages, the
//    inbound Message_Body as the latest user turn
// 6. Parse the model's response — expects a JSON object {"messages": [...]}
//    so we get a clean multi-message split. If the model returns plain text,
//    treat the whole response as Message_1
// 7. Write the assistant turn back to chat_history so the next inbound has
//    context (matches n8n's behaviour)
// 8. Return { Message_1, Message_2, ... } so processMessages.ts can keep its
//    existing forward-to-GHL + Twilio outbound logic unchanged

import { task } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { MULTI_MESSAGE_INSTRUCTION, SETTER_TOOLS, SETTER_TOOL_NAMES, TOOL_USAGE_INSTRUCTION } from "./_shared/setterTools.ts";
import { normalizeLlmModel } from "./_shared/llmModel.ts";
import { persistToolInvocations } from "./_shared/persistToolInvocations.ts";
import { prefetchAvailability, buildAvailabilityBlock } from "./_shared/prefetchSlots.ts";
import { buildTimeAnchorBlock, resolveClientTimeZone } from "./_shared/timeAnchor.ts";
import { mergeCanonicalSlots, validateBookingArgs, type CanonicalSlotMap } from "./_shared/slotBinding.ts";
import {
  runSetterToolLoop,
  ToolsUnsupportedError,
  type CallLlm,
  type CallTool,
  type LlmTurn,
  type SetterToolCall,
} from "./_shared/setterToolLoop.ts";

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const MAX_HISTORY_ROWS = 30;
const DEFAULT_MODEL = "openai/gpt-4.1-nano";
// Per-call timeouts. The tool loop caps iterations (default 4), so the worst
// case is ~4 × (LLM_TIMEOUT + TOOL_TIMEOUT) + a final LLM wrap-up, which stays
// well under the task's 600s maxDuration.
const LLM_TIMEOUT_MS = 60 * 1000;
const TOOL_TIMEOUT_MS = 30 * 1000;

// Reuse the n8n-style human-content extractor so chat_history written by older
// n8n turns still parses cleanly when the new task reads it.
function parseHumanContent(raw: string): string {
  const utteranceMatch = raw.match(/# USER LAST UTTERANCE\s*\n([\s\S]*?)(?:\n\n#|$)/);
  if (utteranceMatch) return utteranceMatch[1].trim();
  const legacyMatch = raw.match(/User last input:\s*\n([\s\S]*?)(?:\n\n|$)/);
  if (legacyMatch) return legacyMatch[1].trim();
  return raw.trim();
}

function extractJson(text: string): string | null {
  const blockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (blockMatch) return blockMatch[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return null;
}

// Parse the LLM output into an array of message strings.
// Preferred: model returns {"messages": ["...", "..."]}.
// Fallback 1: model returns split markers ("\n---\n" between segments).
// Fallback 2: whole body becomes a single Message_1.
function parseSetterMessages(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidate = extractJson(trimmed);
  if (candidate) {
    try {
      const obj = JSON.parse(candidate) as { messages?: unknown };
      if (Array.isArray(obj.messages)) {
        const arr = obj.messages
          .map((m) => (typeof m === "string" ? m.trim() : ""))
          .filter((m) => m.length > 0);
        if (arr.length > 0) return arr;
      }
    } catch {
      // fall through
    }
  }

  const splitOnDelim = trimmed
    .split(/\n\s*---\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (splitOnDelim.length > 1) return splitOnDelim;

  return [trimmed];
}

type ChatHistoryRow = {
  message: { type: string; content: string } | null;
  timestamp: string;
};

export const processSetterReply = task({
  id: "process-setter-reply",
  maxDuration: 600,
  retry: { maxAttempts: 2 },

  run: async (payload: {
    Message_Body: string;
    Lead_ID: string;
    Contact_ID: string;
    GHL_Account_ID: string;
    Name: string;
    Email: string;
    Phone: string;
    Setter_Number: string;
  }) => {
    const supabase = getMainSupabase();
    const setterNumber = String(payload.Setter_Number || "1").trim() || "1";
    const slotId = `Setter-${setterNumber}`;

    // ── STEP 1: Resolve client by GHL location id ──
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, llm_model, openrouter_api_key, supabase_url, supabase_service_key, intake_lead_secret, timezone")
      .eq("ghl_location_id", payload.GHL_Account_ID)
      .single();

    if (clientError || !client) {
      throw new Error(`processSetterReply: client lookup failed for GHL_Account_ID=${payload.GHL_Account_ID}: ${clientError?.message ?? "not found"}`);
    }
    if (!client.openrouter_api_key) {
      throw new Error(`processSetterReply: client ${client.id} has no openrouter_api_key`);
    }

    const model = normalizeLlmModel(client.llm_model as string | null) || DEFAULT_MODEL;
    // PROMPT-AUTH-1: resolve the client's timezone ONCE (valid IANA or the AU
    // default) and use the same value for the availability query, the current-time
    // anchor, and the booking identity — so a null/invalid client.timezone can't
    // make the anchor and the slot map fall back to different zones (off-by-one day).
    const clientTimeZone = resolveClientTimeZone(client.timezone as string | null);

    // ── STEP 2: Open client's external Supabase (where prompts + history live) ──
    let setterPrompt = "";
    let chatHistory: ChatHistoryRow[] = [];
    let clientSupabase: ReturnType<typeof createClient> | null = null;

    if (client.supabase_url && client.supabase_service_key) {
      clientSupabase = createClient(
        client.supabase_url as string,
        client.supabase_service_key as string
      );

      const { data: promptRow } = await clientSupabase
        .from("text_prompts")
        .select("system_prompt")
        .eq("card_name", slotId)
        .maybeSingle();
      setterPrompt = (promptRow?.system_prompt as string | null) ?? "";

      const { data: history } = await clientSupabase
        .from("chat_history")
        .select("message, timestamp")
        .eq("session_id", payload.Lead_ID)
        .order("timestamp", { ascending: false })
        .limit(MAX_HISTORY_ROWS);
      if (Array.isArray(history)) {
        chatHistory = (history as ChatHistoryRow[]).slice().reverse();
      }
    }

    // ── STEP 3: Build OpenAI-format message array ──
    const systemContent = [
      setterPrompt && setterPrompt.trim(),
      `## Lead Context\nName: ${payload.Name || "(unknown)"}\nEmail: ${payload.Email || "(none)"}\nPhone: ${payload.Phone || "(none)"}`,
      MULTI_MESSAGE_INSTRUCTION,
      // §3.12 — code-side tool-usage guidance (NOT a stored-prompt edit). Must
      // come after MULTI_MESSAGE_INSTRUCTION since it references that JSON shape.
      TOOL_USAGE_INSTRUCTION,
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: LlmTurn[] = [];
    messages.push({ role: "system", content: systemContent });

    for (const row of chatHistory) {
      const msg = row?.message;
      if (!msg || typeof msg !== "object") continue;
      if (msg.type === "human") {
        const content = parseHumanContent(msg.content || "");
        if (content) messages.push({ role: "user", content });
      } else if (msg.type === "ai") {
        const content = (msg.content || "").trim();
        if (content) messages.push({ role: "assistant", content });
      }
    }

    messages.push({
      role: "user",
      content: payload.Message_Body || "",
    });

    // ── STEP 4: Run the agentic tool loop (§3.12) ──
    // The LLM can now invoke the voice-booking-tools edge fn (check slots,
    // book, reschedule, cancel, callback) over the course of the reply. The
    // loop folds tool results back into the conversation; identity is injected
    // by the engine (below) so the model can't misroute a booking.
    console.log(`processSetterReply: calling ${model} for lead ${payload.Lead_ID} (slot ${slotId}, history ${chatHistory.length} rows, tools on)`);

    const supabaseUrl = process.env.SUPABASE_URL!;
    const toolEndpoint = `${supabaseUrl}/functions/v1/voice-booking-tools`;

    // Engine-injected identity — overrides anything the model supplies so the
    // booking always attaches to THIS lead (contactId = the GHL/internal lead
    // id) and is stamped source="sms".
    const identity: Record<string, unknown> = {
      contactId: payload.Lead_ID,
      source: "sms",
    };
    if (payload.Phone) identity.phone = payload.Phone;
    if (payload.Email) identity.email = payload.Email;
    identity.timeZone = clientTimeZone;

    const callLlm: CallLlm = async ({ messages: llmMessages, tools: llmTools, toolChoice }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      let aiResp: Response;
      try {
        // PROMPT-AUTH-1: tool-bearing calls run at temperature 0 (Gemini
        // function-calling guidance — date/slot accuracy over prose variety);
        // the no-tools finalize keeps 0.5 for natural wording.
        const temperature = llmTools && llmTools.length > 0 ? 0 : 0.5;
        const reqBody: Record<string, unknown> = { model, messages: llmMessages, temperature };
        if (llmTools && llmTools.length > 0) {
          reqBody.tools = llmTools;
          reqBody.tool_choice = toolChoice;
        }
        aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.openrouter_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reqBody),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new Error(`processSetterReply: OpenRouter call timed out after ${Math.round(LLM_TIMEOUT_MS / 1000)}s`);
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
      if (!aiResp.ok) {
        const errBody = await aiResp.text();
        // Some OpenRouter models reject the tools param — degrade to reply-only.
        if (llmTools && llmTools.length > 0 && [400, 404, 422].includes(aiResp.status) && /tool|function/i.test(errBody)) {
          throw new ToolsUnsupportedError(`OpenRouter ${aiResp.status}: ${errBody.slice(0, 200)}`);
        }
        throw new Error(`OpenRouter error ${aiResp.status}: ${errBody.slice(0, 300)}`);
      }
      const aiJson = (await aiResp.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
      };
      const aiMsg = aiJson?.choices?.[0]?.message;
      const toolCalls: SetterToolCall[] = (aiMsg?.tool_calls ?? [])
        .filter((tc) => tc?.function?.name)
        .map((tc) => ({
          id: tc.id || crypto.randomUUID(),
          type: "function" as const,
          function: { name: tc.function!.name as string, arguments: tc.function!.arguments ?? "{}" },
        }));
      return { content: aiMsg?.content ?? null, toolCalls };
    };

    const callTool: CallTool = async (name, toolArgs) => {
      const url = `${toolEndpoint}?tool=${encodeURIComponent(name)}&clientId=${encodeURIComponent(client.id)}`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (client.intake_lead_secret) headers.Authorization = `Bearer ${client.intake_lead_secret}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(toolArgs),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const json = (await resp.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string } | null;
      if (!resp.ok || (json && json.ok === false)) {
        const msg = (json && (json.error || JSON.stringify(json))) || `HTTP ${resp.status}`;
        throw new Error(`voice-booking-tools ${name} failed: ${String(msg).slice(0, 300)}`);
      }
      // Unwrap the { ok, tool, result } envelope so the model sees the payload.
      return json && typeof json === "object" && "result" in json ? json.result : json;
    };

    // ── BOOK-1: prefetch real calendar availability and inject it as ground truth
    // before the model speaks (mirrors the Voice setter). Best-effort — a prefetch
    // failure degrades to a "call get-available-slots" instruction, never blocks the
    // reply. Passing an epoch-ms window sidesteps BOOK-3's offset-less-ISO mis-parse.
    const nowMs = Date.now();
    const prefetch = await prefetchAvailability({
      callTool,
      timeZone: clientTimeZone,
      nowMs,
    });
    // ── PROMPT-AUTH-1: append the availability map + a real current-time anchor.
    // The anchor neutralizes stale in-prompt "now" text (e.g. a literal {{ $now }})
    // so relative days resolve from the engine clock, not model guesswork. Both use
    // the SAME resolved clientTimeZone as the prefetch above.
    messages[0].content = [
      messages[0].content ?? "",
      buildAvailabilityBlock(prefetch),
      buildTimeAnchorBlock(clientTimeZone, nowMs),
    ].join("\n\n");

    // ── PROMPT-AUTH-1: canonical slot map = every open slot the engine has seen
    // this turn (prefetch + any mid-loop get-available-slots). book-appointments /
    // update-appointment are validated against it before executing: a listed time
    // is rewritten to GHL's exact ISO string; an off-list time is refused and the
    // real alternatives are folded back (kills the "Thursday 2pm" -> Friday bug).
    const canonicalSlots: CanonicalSlotMap = new Map();
    mergeCanonicalSlots(canonicalSlots, prefetch.invocation.result);
    const loopCallTool: CallTool = async (name, toolArgs) => {
      const result = await callTool(name, toolArgs);
      if (name === "get-available-slots") mergeCanonicalSlots(canonicalSlots, result);
      return result;
    };

    const loopResult = await runSetterToolLoop({
      messages,
      tools: SETTER_TOOLS,
      validToolNames: SETTER_TOOL_NAMES,
      identity,
      callLlm,
      callTool: loopCallTool,
      validateToolArgs: (name, toolArgs) => validateBookingArgs(canonicalSlots, name, toolArgs),
    });
    if (loopResult.toolInvocations.length > 0) {
      console.log(
        `processSetterReply: lead ${payload.Lead_ID} tool invocations: ` +
        loopResult.toolInvocations.map((t) => `${t.name}${t.error ? "(err)" : "(ok)"}`).join(", "),
      );
    }
    // ── SMS-OBS-1: persist tool calls/results to the platform tool_invocations
    // table so booking failures (BOOK-1) are diagnosable from the DB. Best-effort;
    // never throws (a persistence hiccup must not break the SMS reply).
    await persistToolInvocations({
      supabase,
      clientId: client.id as string,
      leadId: payload.Lead_ID,
      setterSlot: slotId,
      source: "sms",
      // Prepend the BOOK-1 prefetch so the DB shows availability WAS fetched this turn.
      invocations: [prefetch.invocation, ...loopResult.toolInvocations],
    });
    const rawText = (loopResult.finalText || "").trim();
    if (!rawText) {
      throw new Error("processSetterReply: tool loop produced empty content");
    }

    // ── STEP 5: Parse + return n8n-shaped response ──
    const setterMessages = parseSetterMessages(rawText);
    if (setterMessages.length === 0) {
      throw new Error(`processSetterReply: no parseable messages in model output: ${rawText.slice(0, 200)}`);
    }

    const response: Record<string, string> = {};
    setterMessages.forEach((m, idx) => {
      response[`Message_${idx + 1}`] = m;
    });

    // ── STEP 6: Append assistant turn to chat_history (best-effort) ──
    if (clientSupabase) {
      try {
        const combined = setterMessages.join("\n\n");
        await clientSupabase.from("chat_history").insert({
          session_id: payload.Lead_ID,
          message: {
            type: "ai",
            content: combined,
            // SMS-OBS-1: record the tools the model actually invoked this turn
            // (was hardcoded []). Full args/results live in the platform
            // tool_invocations table; this is the LangChain ai-message summary.
            tool_calls: loopResult.toolInvocations.map((t) => ({
              name: t.name,
              args: t.args,
              id: crypto.randomUUID(),
              type: "tool_call",
            })),
            additional_kwargs: {},
            response_metadata: {},
            invalid_tool_calls: [],
          },
          timestamp: new Date().toISOString(),
        });
      } catch (writeErr) {
        console.error(`processSetterReply: chat_history write failed (non-fatal): ${(writeErr as Error).message}`);
      }
    }

    return response;
  },
});
