import { task, wait } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { sendTwilioSmsAndStamp } from "./_shared/sendTwilioSmsAndStamp";

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// ── System prompt: decide + generate in one call ──────────────────────────────
const FOLLOWUP_SYSTEM_PROMPT = `You are analyzing a sales conversation to decide whether a follow-up message should be sent, and if so, what to write.

Step 1 — Check cancellation conditions:
Review the provided cancellation conditions. If ANY of them apply to the conversation, you must NOT send a follow-up.

Step 2 — If a follow-up IS appropriate, write a short, highly personalized follow-up message:
- Read the full conversation carefully — understand exactly where it left off
- Sound like the setter naturally continuing the conversation, not a new person
- Be concise: 1-3 sentences maximum
- Reference something specific from the conversation — never write something generic
- Match the tone, language, and style of the setter's previous messages exactly
- If the setter uses casual language and slang — match it
- NEVER start with "Just following up", "Hey there", "I wanted to check in", or "Hi again"
- If follow-up instructions are provided, follow them precisely

Always return a single JSON object — no markdown, no code blocks, nothing outside the JSON:
{"should_followup": true, "reason": "<brief explanation of why a follow-up makes sense>", "message": "<the follow-up message text>"}
or
{"should_followup": false, "reason": "<brief explanation of which cancellation condition applied>", "message": null}`;

// ── Default cancellation conditions (always applied) ─────────────────────────
const DEFAULT_CANCELLATION_CONDITIONS = [
  "The conversation ended naturally — the lead said thanks, goodbye, or the exchange was clearly complete",
  "The lead expressed they no longer want to be contacted or asked to be left alone",
  "The lead gave a clear rejection",
  "The lead confirmed they are not interested",
];

// ── Extract JSON from AI response (handles markdown code blocks) ──────────────
function extractJson(text: string): string {
  const blockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (blockMatch) return blockMatch[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return text;
}

// ── Parse human message content (strips n8n wrapper text) ────────────────────
function parseHumanContent(raw: string): string {
  const utteranceMatch = raw.match(/# USER LAST UTTERANCE\s*\n([\s\S]*?)(?:\n\n#|$)/);
  if (utteranceMatch) return utteranceMatch[1].trim();
  const legacyMatch = raw.match(/User last input:\s*\n([\s\S]*?)(?:\n\n|$)/);
  if (legacyMatch) return legacyMatch[1].trim();
  return raw.trim();
}

// ── Main task ─────────────────────────────────────────────────────────────────
export const sendFollowup = task({
  id: "send-followup",
  maxDuration: 3600,
  retry: { maxAttempts: 2 },

  run: async (payload: {
    timer_id: string;
    lead_id: string;
    ghl_account_id: string;
    setter_number: string;
    fires_at: string;
    client_id: string;
    sequence_index?: number; // 1-based, defaults to 1
  }) => {
    const supabase = getMainSupabase();
    const {
      timer_id,
      lead_id,
      ghl_account_id,
      setter_number,
      fires_at,
      client_id,
    } = payload;
    const sequenceIndex = payload.sequence_index ?? 1;

    // ── STEP 1: Wait until the follow-up fires ────────────────────────────────
    const resumeAt = new Date(fires_at);
    console.log(`Follow-up timer ${timer_id} (seq ${sequenceIndex}): waiting until ${resumeAt.toISOString()}`);
    await wait.until({ date: resumeAt });

    // ── STEP 2: Check if timer was cancelled ──────────────────────────────────
    const { data: timer } = await supabase
      .from("followup_timers")
      .select("status")
      .eq("id", timer_id)
      .single();

    if (!timer || !["pending", "firing"].includes(timer.status)) {
      console.log(`Follow-up timer ${timer_id}: status='${timer?.status}' — skipping.`);
      return { status: "skipped", reason: timer?.status ?? "not_found" };
    }

    // ── STEP 2.5: Check if setter was stopped for this lead ───────────────────
    const { data: leadRow } = await supabase
      .from("leads")
      .select("setter_stopped, phone")
      .eq("lead_id", lead_id)
      .eq("client_id", client_id)
      .maybeSingle();

    if (leadRow?.setter_stopped === true) {
      console.log(`Follow-up timer ${timer_id}: setter_stopped=true — cancelling all pending timers.`);
      await supabase
        .from("followup_timers")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("lead_id", lead_id)
        .eq("ghl_account_id", ghl_account_id)
        .in("status", ["pending", "firing"]);
      return { status: "skipped", reason: "setter_stopped" };
    }

    // Optimistic lock
    await supabase
      .from("followup_timers")
      .update({ status: "firing", updated_at: new Date().toISOString() })
      .eq("id", timer_id)
      .in("status", ["pending", "firing"]);

    // ── STEP 3: Fetch client config ───────────────────────────────────────────
    const { data: client } = await supabase
      .from("clients")
      .select("openrouter_api_key, llm_model, supabase_url, supabase_service_key, twilio_account_sid, twilio_auth_token, retell_phone_1, twilio_default_phone, ghl_api_key, ghl_location_id, ghl_conversation_provider_id")
      .eq("id", client_id)
      .single();

    if (!client?.openrouter_api_key) {
      await supabase.from("followup_timers").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", timer_id);
      throw new Error("Missing client openrouter_api_key");
    }

    // ── STEP 4: Fetch agent settings ──────────────────────────────────────────
    const slotId = `Setter-${setter_number}`;
    const { data: agentSettings } = await supabase
      .from("agent_settings")
      .select("followup_instructions, followup_max_attempts, followup_cancellation_instructions")
      .eq("client_id", client_id)
      .eq("slot_id", slotId)
      .maybeSingle();

    const followupInstructions = (agentSettings?.followup_instructions as string | null) ?? "";
    const maxAttempts = (agentSettings?.followup_max_attempts as number | null) ?? 1;
    const cancellationInstructions = (agentSettings?.followup_cancellation_instructions as string | null) ?? "";

    // ── STEP 5: Fetch chat history from external Supabase ────────────────────
    let chatHistoryText = "No previous conversation available.";
    let clientSupabaseInstance: ReturnType<typeof createClient> | null = null;

    if (client.supabase_url && client.supabase_service_key) {
      clientSupabaseInstance = createClient(
        client.supabase_url as string,
        client.supabase_service_key as string
      );
      const { data: history } = await clientSupabaseInstance
        .from("chat_history")
        .select("message, timestamp")
        .eq("session_id", lead_id)
        .order("timestamp", { ascending: false })
        .limit(30);

      if (history && history.length > 0) {
        const lines = history
          .reverse()
          .map((row: { message: { type: string; content: string } }) => {
            const msg = row.message as { type: string; content: string };
            if (msg.type === "human") {
              const content = parseHumanContent(msg.content);
              return content ? `Lead: ${content}` : null;
            } else if (msg.type === "ai") {
              const content = (msg.content || "").trim();
              return content ? `Setter: ${content}` : null;
            }
            return null;
          })
          .filter(Boolean);
        if (lines.length > 0) chatHistoryText = lines.join("\n");
      }
    }

    // ── STEP 6: Fetch setter prompt from external Supabase ───────────────────
    let setterPrompt = "";
    if (clientSupabaseInstance) {
      const { data: promptRow } = await clientSupabaseInstance
        .from("text_prompts")
        .select("system_prompt")
        .eq("card_name", slotId)
        .maybeSingle();
      setterPrompt = (promptRow?.system_prompt as string | null) ?? "";
    }

    // ── STEP 7: Ask AI to decide + generate follow-up ─────────────────────────
    const model = (client.llm_model as string | null) ?? "google/gemini-2.5-pro";

    // Build cancellation conditions list (defaults + user-defined)
    const customConditions = cancellationInstructions
      ? cancellationInstructions.split(" ; ").map((c) => c.trim()).filter(Boolean)
      : [];
    const allConditions = [...DEFAULT_CANCELLATION_CONDITIONS, ...customConditions];

    const cancellationSection = [
      "## Cancellation Conditions — do NOT send a follow-up if ANY of these apply",
      ...allConditions.map((c) => `- ${c}`),
    ].join("\n");

    const userMessage = [
      setterPrompt ? `## Setter Prompt\n${setterPrompt}` : "",
      `## Conversation History\n${chatHistoryText}`,
      cancellationSection,
      followupInstructions
        ? `## Follow-up Instructions (apply these only if you decide to follow up)\n${followupInstructions}`
        : "",
      sequenceIndex > 1
        ? `## Note\nThis is follow-up attempt #${sequenceIndex}. The lead has not responded to the previous follow-up(s). If you still decide to send one, be slightly more direct — but do not be pushy.`
        : "",
      "## Task\nAnalyze the conversation and return JSON as instructed in the system prompt.",
    ]
      .filter(Boolean)
      .join("\n\n");

    console.log(`Running follow-up decision #${sequenceIndex} for contact ${lead_id} using ${model}`);

    const aiMessages = [
      { role: "system" as const, content: FOLLOWUP_SYSTEM_PROMPT },
      { role: "user" as const, content: userMessage },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3 * 60 * 1000);

    let aiDecision: { should_followup: boolean; reason: string; message: string | null };
    let rawResponse: unknown;

    try {
      const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${client.openrouter_api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: aiMessages,
          temperature: 0.4, // lower temp for more reliable JSON + decision-making
        }),
        signal: controller.signal,
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        throw new Error(`OpenRouter error ${aiResponse.status}: ${errText.slice(0, 200)}`);
      }

      rawResponse = await aiResponse.json();
      const rawContent = (rawResponse as any).choices?.[0]?.message?.content?.trim();
      if (!rawContent) throw new Error("OpenRouter returned empty content");

      try {
        aiDecision = JSON.parse(extractJson(rawContent));
      } catch {
        throw new Error(`AI returned non-JSON content: ${rawContent.slice(0, 200)}`);
      }

      if (typeof aiDecision.should_followup !== "boolean") {
        throw new Error(`AI response missing 'should_followup' field: ${rawContent.slice(0, 200)}`);
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError")
        throw new Error("Follow-up generation timed out after 3 minutes");
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Raw exchange stored on the timer row regardless of decision — powers the logs tab
    const rawExchange = { messages: aiMessages, response: rawResponse };

    console.log(`Follow-up #${sequenceIndex} decision: should_followup=${aiDecision.should_followup}, reason="${aiDecision.reason}"`);

    // ── STEP 7a: AI decided NOT to follow up — cancel everything ─────────────
    if (!aiDecision.should_followup) {
      // Mark this timer as cancelled with the reason + raw exchange
      await supabase
        .from("followup_timers")
        .update({
          status: "cancelled",
          decision: "cancelled",
          decision_reason: aiDecision.reason,
          raw_exchange: rawExchange,
          updated_at: new Date().toISOString(),
        })
        .eq("id", timer_id);

      // Cancel all remaining pending follow-up timers for this contact
      await supabase
        .from("followup_timers")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("lead_id", lead_id)
        .eq("ghl_account_id", ghl_account_id)
        .eq("status", "pending");

      console.log(`Follow-up #${sequenceIndex} cancelled — reason: ${aiDecision.reason}`);
      return {
        status: "cancelled",
        lead_id,
        sequence_index: sequenceIndex,
        reason: aiDecision.reason,
      };
    }

    // ── STEP 8: Send the follow-up directly via Twilio ───────────────────────
    // GHL is no longer in the send path (send_followup_webhook_url retired
    // 2026-06-17). sendTwilioSmsAndStamp delivers via the Twilio REST API,
    // stamps the outbound message_queue row, and mirrors the body to GHL.
    const followupMessage = aiDecision.message;
    if (!followupMessage) throw new Error("AI decided to follow up but returned empty message");

    const toNumber = (leadRow?.phone as string | null) ?? null;
    const fromNumber =
      (client.retell_phone_1 as string | null) ?? (client.twilio_default_phone as string | null) ?? null;
    const twilioSid = client.twilio_account_sid as string | null;
    const twilioAuth = client.twilio_auth_token as string | null;
    if (!twilioSid || !twilioAuth || !fromNumber || !toNumber) {
      const missing = [
        !twilioSid ? "twilio_account_sid" : null,
        !twilioAuth ? "twilio_auth_token" : null,
        !fromNumber ? "from_number(retell_phone_1/twilio_default_phone)" : null,
        !toNumber ? "lead.phone" : null,
      ]
        .filter(Boolean)
        .join(", ");
      await supabase
        .from("followup_timers")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", timer_id);
      await supabase.from("error_logs").insert({
        client_ghl_account_id: ghl_account_id,
        lead_id,
        severity: "error",
        source: "send_followup",
        error_type: "followup_no_send_path",
        error_message: `Follow-up not sent, missing ${missing}`,
        created_at: new Date().toISOString(),
      });
      throw new Error(`Follow-up not sent, missing ${missing}`);
    }

    const sendResult = await sendTwilioSmsAndStamp({
      supabase,
      twilioSid,
      twilioAuth,
      fromNumber,
      toNumber,
      body: followupMessage,
      clientId: client_id,
      leadId: lead_id,
      ghlAccountId: ghl_account_id,
      contactName: null,
      contactEmail: null,
      ghlApiKey: (client.ghl_api_key as string | null) ?? null,
      ghlLocationId: (client.ghl_location_id as string | null) ?? null,
      ghlContactId: lead_id,
      ghlConversationProviderId: (client.ghl_conversation_provider_id as string | null) ?? null,
    });

    if (!sendResult.ok) {
      await supabase
        .from("followup_timers")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", timer_id);
      throw new Error(`Follow-up Twilio send failed: ${sendResult.errorCode} ${sendResult.errorMessage}`);
    }

    console.log(`Follow-up #${sequenceIndex} sent: "${followupMessage.slice(0, 100)}"`);

    // Update last_message_preview for conversation list
    await supabase
      .from("leads")
      .update({ last_message_preview: followupMessage.slice(0, 200) })
      .eq("client_id", client_id)
      .eq("lead_id", lead_id);

    // ── STEP 9: Write to external Supabase chat_history ──────────────────────
    if (clientSupabaseInstance) {
      const chatMessage = {
        type: "ai",
        content: followupMessage,
        tool_calls: [],
        additional_kwargs: {},
        response_metadata: {},
        invalid_tool_calls: [],
      };
      const { error: chatError } = await clientSupabaseInstance
        .from("chat_history")
        .insert({
          session_id: lead_id,
          message: chatMessage,
          timestamp: new Date().toISOString(),
        });
      if (chatError) {
        console.error(`Failed to write follow-up to chat_history: ${chatError.message}`);
        // Non-fatal — message was sent, don't fail the task
      } else {
        console.log(`Follow-up #${sequenceIndex} written to chat_history`);
      }
    }

    // ── STEP 10: Mark timer as fired with decision + raw exchange ─────────────
    await supabase
      .from("followup_timers")
      .update({
        status: "fired",
        followup_message: followupMessage,
        decision: "sent",
        decision_reason: aiDecision.reason,
        raw_exchange: rawExchange,
        updated_at: new Date().toISOString(),
      })
      .eq("id", timer_id);

    // ── STEP 11: Schedule next follow-up in sequence if needed ───────────────
    if (sequenceIndex < maxAttempts) {
      const { data: agentSettingsFull } = await supabase
        .from("agent_settings")
        .select("followup_2_delay_seconds, followup_3_delay_seconds")
        .eq("client_id", client_id)
        .eq("slot_id", slotId)
        .maybeSingle();

      const nextIndex = sequenceIndex + 1;
      let followupDelay = 0;
      if (nextIndex === 2) {
        followupDelay = (agentSettingsFull?.followup_2_delay_seconds as number | null) ?? 0;
      } else if (nextIndex === 3) {
        followupDelay = (agentSettingsFull?.followup_3_delay_seconds as number | null) ?? 0;
      }

      if (followupDelay <= 0) {
        console.log(`No delay configured for follow-up #${nextIndex} — stopping sequence.`);
      } else {
        const nextFiresAt = new Date(Date.now() + followupDelay * 1000);

        // Cancel any other pending timers for this contact (safety)
        await supabase
          .from("followup_timers")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("lead_id", lead_id)
          .eq("ghl_account_id", ghl_account_id)
          .eq("status", "pending");

        const { data: nextTimer } = await supabase
          .from("followup_timers")
          .insert({
            client_id,
            lead_id,
            ghl_account_id,
            setter_number,
            status: "pending",
            fires_at: nextFiresAt.toISOString(),
            sequence_index: nextIndex,
          })
          .select("id")
          .single();

        if (nextTimer) {
          const nextRun = await sendFollowup.trigger({
            timer_id: nextTimer.id,
            lead_id,
            ghl_account_id,
            setter_number,
            fires_at: nextFiresAt.toISOString(),
            client_id,
            sequence_index: nextIndex,
          });

          await supabase
            .from("followup_timers")
            .update({ trigger_run_id: nextRun.id })
            .eq("id", nextTimer.id);

          console.log(`Scheduled follow-up #${nextIndex} for ${nextFiresAt.toISOString()}`);
        }
      }
    }

    return {
      status: "fired",
      lead_id,
      sequence_index: sequenceIndex,
      message_preview: followupMessage.slice(0, 100),
    };
  },
});
