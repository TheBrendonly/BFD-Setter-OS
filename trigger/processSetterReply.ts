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

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const MAX_HISTORY_ROWS = 30;
const DEFAULT_MODEL = "openai/gpt-4.1-nano";
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;

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

const MULTI_MESSAGE_INSTRUCTION = `\n\n## Output format (REQUIRED)\nRespond with ONLY a single JSON object — no markdown, no code fences, no preamble:\n{"messages": ["first reply", "second reply if needed"]}\n\nRules:\n- One element if a single SMS is enough; up to 3 elements when the natural reply needs to be broken into separate SMS\n- Each element is a complete SMS by itself\n- Do not include any text outside the JSON\n- Plain text — no JSON inside the message strings`;

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
      .select("id, llm_model, openrouter_api_key, supabase_url, supabase_service_key")
      .eq("ghl_location_id", payload.GHL_Account_ID)
      .single();

    if (clientError || !client) {
      throw new Error(`processSetterReply: client lookup failed for GHL_Account_ID=${payload.GHL_Account_ID}: ${clientError?.message ?? "not found"}`);
    }
    if (!client.openrouter_api_key) {
      throw new Error(`processSetterReply: client ${client.id} has no openrouter_api_key`);
    }

    const model = (client.llm_model as string | null)?.trim() || DEFAULT_MODEL;

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
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
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

    // ── STEP 4: Call OpenRouter ──
    console.log(`processSetterReply: calling ${model} for lead ${payload.Lead_ID} (slot ${slotId}, history ${chatHistory.length} rows)`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS);

    let rawText = "";
    try {
      const aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client.openrouter_api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.5,
        }),
        signal: controller.signal,
      });
      if (!aiResp.ok) {
        const errBody = await aiResp.text();
        throw new Error(`OpenRouter error ${aiResp.status}: ${errBody.slice(0, 300)}`);
      }
      const aiJson = (await aiResp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      rawText = aiJson?.choices?.[0]?.message?.content?.trim() ?? "";
      if (!rawText) {
        throw new Error("OpenRouter returned empty content");
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        throw new Error(`processSetterReply: OpenRouter call timed out after ${Math.round(RESPONSE_TIMEOUT_MS / 1000)}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
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
            tool_calls: [],
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
