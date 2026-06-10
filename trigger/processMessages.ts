import { task, wait } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { sendFollowup } from "./sendFollowup";
import { processSetterReply } from "./processSetterReply";
import { pushSmsToGhl } from "./_shared/ghl-conversations";

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const redactPhone = (p: string | null | undefined): string => {
  if (!p) return "<no-phone>";
  const s = String(p);
  if (s.length <= 6) return s.slice(0, 2) + "***";
  return s.slice(0, 4) + "***" + s.slice(-3);
};

const redactBody = (b: string | null | undefined): string => {
  if (b == null) return "<empty>";
  const s = String(b);
  return `[redacted body, ${s.length} chars]`;
};

export const processMessages = task({
  id: "process-messages",
  maxDuration: 3600,
  retry: { maxAttempts: 3 },

  run: async (payload: {
    lead_id: string;
    ghl_account_id: string;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    execution_id: string;
    debounce_seconds?: number;
    setter_number?: string;
  }, { ctx }: any) => {
    const supabase = getMainSupabase();
    const {
      lead_id,
      ghl_account_id,
      contact_name,
      contact_email,
      contact_phone,
      execution_id,
      setter_number,
    } = payload;

    const updateExecution = async (fields: Record<string, unknown>) => {
      await supabase
        .from("dm_executions")
        .update(fields)
        .eq("id", execution_id);
    };

    const triggerRunId: string | undefined = ctx?.run?.id;

    const logError = async (
      errorType: string,
      errorMessage: string,
      context?: Record<string, unknown>
    ) => {
      await supabase.from("error_logs").insert({
        client_ghl_account_id: ghl_account_id,
        lead_id: lead_id,
        execution_id: execution_id,
        trigger_run_id: triggerRunId ?? null,
        severity: "error",
        source: "process_messages",
        category: "dm_processing",
        title: `DM processing error: ${errorType}`,
        error_type: errorType,
        error_message: errorMessage,
        context: {
          ...(context ?? {}),
          trigger_run_id: triggerRunId,
          lead_id,
          ghl_account_id,
        },
        created_at: new Date().toISOString(),
      });
      // has_error is NOT set here — only set after all retries are exhausted
      // so the error banner never shows for transient failures
    };

    let followupTimerId: string | null = null;

    try {
      // ── STEP 0: Look up client + ensure lead exists ──────────────────────────
      // Done BEFORE the debounce wait so the lead appears in the CRM immediately.
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id, ghl_send_setter_reply_webhook_url, supabase_url, supabase_service_key, supabase_table_name, twilio_account_sid, twilio_auth_token, retell_phone_1, use_native_text_engine, ghl_api_key, ghl_location_id, ghl_conversation_provider_id")
        .eq("ghl_location_id", ghl_account_id)
        .single();

      if (clientError || !client) {
        throw new Error(`Could not find client config for GHL account: ${ghl_account_id}`);
      }
      if (!client.use_native_text_engine) {
        throw new Error(`use_native_text_engine must be true for GHL account: ${ghl_account_id} — n8n path decommissioned (Phase 10)`);
      }
      if (!client.ghl_send_setter_reply_webhook_url) {
        throw new Error(`ghl_send_setter_reply_webhook_url not configured for GHL account: ${ghl_account_id}`);
      }

      // Create lead in internal + external Supabase if it doesn't exist yet
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("client_id", client.id)
        .eq("lead_id", lead_id)
        .maybeSingle();

      if (!existingLead) {
        const nameParts = (contact_name ?? "").trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

        const insertFields: Record<string, unknown> = { client_id: client.id, lead_id: lead_id };
        if (firstName) insertFields.first_name = firstName;
        if (lastName) insertFields.last_name = lastName;
        if (contact_email) insertFields.email = contact_email;
        if (contact_phone) insertFields.phone = contact_phone;

        await supabase.from("leads").insert(insertFields);

        // Also upsert into client's external Supabase table
        if (client.supabase_url && client.supabase_service_key) {
          const clientSupabase = createClient(client.supabase_url, client.supabase_service_key);
          const tableName = (client.supabase_table_name as string | null)?.trim() || "leads";
          const externalRecord: Record<string, unknown> = { id: lead_id };
          if (firstName) externalRecord.first_name = firstName;
          if (lastName) externalRecord.last_name = lastName;
          if (contact_email) externalRecord.email = contact_email;
          if (contact_phone) externalRecord.phone = contact_phone;
          await clientSupabase.from(tableName).upsert(externalRecord, { onConflict: "id" });
        }

        console.log(`Created new lead: ${lead_id}`);
      }

      // ── STEP 1: Wait the configured debounce period ─────────────────────────
      const debounceSeconds = payload.debounce_seconds ?? 60;
      const resumeAt = new Date(Date.now() + debounceSeconds * 1000);

      await updateExecution({
        status: "waiting",
        stage_description: "Waiting for more messages...",
        resume_at: resumeAt.toISOString(),
        trigger_run_id: triggerRunId ?? null,
      });

      console.log(`Waiting until ${resumeAt.toISOString()} before processing...`);
      await wait.until({ date: resumeAt });

      // ── Voice-call HOLD ──────────────────────────────────────────────────────
      // Don't generate an SMS reply while a voice call is live for this contact —
      // the agent is talking to them right now. Wait for engagement_executions
      // .active_call_id to clear (set by runEngagement when the call is placed,
      // cleared by retell-call-webhook on call_ended). Bounded to ~15 min so a
      // missed clear can't hang the reply forever.
      {
        const holdDeadline = Date.now() + 15 * 60 * 1000;
        for (;;) {
          const { data: liveCall } = await supabase
            .from("engagement_executions")
            .select("id")
            .eq("ghl_contact_id", lead_id)
            .eq("ghl_account_id", ghl_account_id)
            .not("active_call_id", "is", null)
            .limit(1)
            .maybeSingle();
          if (!liveCall || Date.now() >= holdDeadline) break;
          console.log(`Voice call active for ${lead_id} — holding SMS reply until it ends...`);
          await wait.until({ date: new Date(Date.now() + 20_000) });
        }
      }

      // ── STEP 1.5: Opt-out recheck ────────────────────────────────────────────
      // A lead can text STOP during the debounce wait or the voice-call hold
      // above. receive-twilio-sms sets leads.setter_stopped (atomically with the
      // lead_optouts insert) and cancels the cadence, but a reply generated in
      // this run would otherwise still be sent. Re-read setter_stopped here and
      // bail before generating/sending any reply. Mirrors runEngagement's
      // setter_stopped guard; also closes the lead_optouts resume gap (VC2).
      const { data: optOutCheck } = await supabase
        .from("leads")
        .select("setter_stopped")
        .eq("client_id", client.id)
        .eq("lead_id", lead_id)
        .maybeSingle();
      if (optOutCheck?.setter_stopped) {
        console.log(`Lead ${lead_id} opted out (setter_stopped) during the wait — cancelling before send.`);
        await updateExecution({
          status: "cancelled",
          stage_description: "Lead opted out (STOP) — cadence cancelled before reply.",
          completed_at: new Date().toISOString(),
          resume_at: null,
        });
        await cleanup(supabase, lead_id, ghl_account_id, triggerRunId);
        return { status: "opted_out" };
      }

      // ── STEP 2: Fetch all unprocessed messages ──────────────────────────────
      await updateExecution({
        status: "grouping",
        stage_description: "Grouping messages...",
        resume_at: null,
      });

      const { data: messages, error: messagesError } = await supabase
        .from("message_queue")
        .select("id, message_body, created_at, channel")
        .eq("lead_id", lead_id)
        .eq("ghl_account_id", ghl_account_id)
        .eq("processed", false)
        .order("created_at", { ascending: true });

      if (messagesError || !messages || messages.length === 0) {
        console.log("No unprocessed messages found. Exiting.");
        await updateExecution({
          status: "completed",
          stage_description: "No messages to process.",
          completed_at: new Date().toISOString(),
        });
        await cleanup(supabase, lead_id, ghl_account_id, triggerRunId);
        return { status: "no_messages" };
      }

      // ── STEP 3: Group messages into one string ──────────────────────────────
      const groupedMessage = messages.map((m) => m.message_body).join("\n");
      const messageIds = messages.map((m) => m.id);

      // All messages in a debounce batch come from the same contact session so
      // they share the same channel. Pick the first non-null value.
      const channel = messages.find((m) => m.channel)?.channel ?? null;

      await updateExecution({
        messages_received: messages.length,
        grouped_message: groupedMessage,
        ...(channel ? { channel } : {}),
      });

      console.log(`Grouped ${messages.length} message(s): "${groupedMessage}"`);

      // ── STEP 5: Generate setter reply via processSetterReply task ───────────
      await updateExecution({
        status: "sending",
        stage_description: "Sending to AI engine...",
      });

      let setterReplyOutput: unknown;
      let setterMessages: string[] = [];

      const setterReplyResult = await processSetterReply.triggerAndWait({
        Message_Body: groupedMessage,
        Lead_ID: lead_id,
        Contact_ID: lead_id,
        GHL_Account_ID: ghl_account_id,
        Name: contact_name ?? "",
        Email: contact_email ?? "",
        Phone: contact_phone ?? "",
        Setter_Number: setter_number || "1",
      });

      if (setterReplyResult.ok !== true) {
        const failure = setterReplyResult as { error?: unknown };
        const errMsg = String(failure.error ?? "unknown");
        await logError(
          "process_setter_reply_failed",
          `processSetterReply task failed: ${errMsg}`,
          { lead_id, ghl_account_id, error: failure.error }
        );
        throw new Error(`processSetterReply task failed: ${errMsg}`);
      }

      setterReplyOutput = setterReplyResult.output;
      const responseObj = setterReplyOutput as Record<string, unknown>;

      if (!responseObj.Message_1) {
        await logError(
          "native_text_engine_invalid_format",
          `processSetterReply returned no Message_1. Got: ${JSON.stringify(responseObj).slice(0, 300)}`,
          { lead_id, ghl_account_id, response: responseObj }
        );
        throw new Error("processSetterReply returned no Message_1");
      }

      let msgIdx = 1;
      while (responseObj[`Message_${msgIdx}`]) {
        setterMessages.push(String(responseObj[`Message_${msgIdx}`]));
        msgIdx++;
      }
      await updateExecution({ setter_messages: setterMessages });

      // ── STEP 6: Forward setter reply to GHL — Message_N format ──────────────
      await updateExecution({
        status: "sending",
        stage_description: "Sending reply to GHL...",
      });

      console.log(
        `Forwarding to GHL: ${client.ghl_send_setter_reply_webhook_url}`
      );

      const ghlReplyUrl = `${client.ghl_send_setter_reply_webhook_url}?Contact_ID=${encodeURIComponent(lead_id)}`;

      // The setter reply has Message_1..5, userID, chat_history — but NO Channel.
      // The "Send Setter Reply" GHL workflow's "Which Channel?" decision needs
      // it; without Channel set, the workflow falls to the "None" branch and
      // no message goes out. Inject Channel from the inbound message_queue row
      // (uppercase to match GHL decision conditions like 'includes "SMS"').
      const ghlPayload: Record<string, unknown> = {
        ...(setterReplyOutput as Record<string, unknown>),
        Channel: channel ? channel.toUpperCase() : "SMS",
      };

      const ghlResponse = await fetch(ghlReplyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ghlPayload),
      });

      if (!ghlResponse.ok) {
        const errorText = await ghlResponse.text();
        await logError(
          "ghl_webhook_error",
          `GHL webhook failed: ${ghlResponse.status} ${errorText}`,
          { lead_id, ghl_account_id, status: ghlResponse.status }
        );
        throw new Error(
          `GHL webhook failed: ${ghlResponse.status} ${errorText}`
        );
      }

      console.log("Reply forwarded to GHL successfully.");

      // ── STEP 6.1b: Send SMS directly via Twilio (bypass GHL Custom Webhook substitution) ─
      // GHL's Custom Webhook body doesn't substitute {{contact.phone}} reliably,
      // so we send each setter message directly using the Twilio REST API.
      const twilioSid = (client as any).twilio_account_sid as string | null;
      const twilioAuth = (client as any).twilio_auth_token as string | null;
      const twilioFrom = (client as any).retell_phone_1 as string | null;
      // Phase 7b — Twilio status callback. Reconstruct from SUPABASE_URL
      // (req.url-style internal hostnames don't help here since we're in
      // Trigger.dev, not a Deno edge fn — but we still need the public URL).
      const supabaseUrl = process.env.SUPABASE_URL;
      const statusCallbackUrl = supabaseUrl
        ? `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twilio-status-webhook`
        : null;
      if (channel === "sms" && twilioSid && twilioAuth && twilioFrom && contact_phone) {
        for (const msg of setterMessages) {
          if (!msg?.trim()) continue;
          const params: Record<string, string> = {
            From: twilioFrom,
            To: contact_phone,
            Body: msg,
          };
          if (statusCallbackUrl) params.StatusCallback = statusCallbackUrl;
          const twilioBody = new URLSearchParams(params);
          const twilioRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioAuth}`).toString("base64")}`,
              },
              body: twilioBody.toString(),
            }
          );
          // Bug 3 — Twilio returns `code` + `message`, not `error_code` /
          // `error_message`. See runEngagement.ts sendTwilioSmsAndStamp note.
          const twilioJson = (await twilioRes.json()) as { sid?: string; code?: number; message?: string };
          if (!twilioRes.ok) {
            await logError("twilio_sms_error", `Twilio SMS failed: ${twilioJson.code} ${twilioJson.message}`, { to: redactPhone(contact_phone), error_code: twilioJson.code });
            console.warn(`Twilio SMS failed for msg: ${twilioJson.code} ${twilioJson.message}`);
          } else {
            console.log(`Twilio SMS sent: ${twilioJson.sid} → ${redactPhone(contact_phone)}`);
            // Stamp the outbound on message_queue so the status webhook can
            // mirror terminal states back to it.
            if (twilioJson.sid) {
              try {
                await supabase.from("message_queue").insert({
                  lead_id,
                  ghl_account_id,
                  message_body: msg,
                  contact_name,
                  contact_email,
                  contact_phone,
                  channel: "sms_outbound",
                  twilio_message_sid: twilioJson.sid,
                  processed: true,
                });
              } catch (insErr) {
                console.warn("processMessages: outbound message_queue insert failed (non-fatal)", insErr);
              }
            }
            // Phase B (gap 3) — mirror outbound setter SMS body to GHL so
            // the agency owner sees the conversation thread.
            if (
              (client as any).ghl_api_key
              && (client as any).ghl_location_id
            ) {
              const mirrorResult = await pushSmsToGhl({
                ghlApiKey: (client as any).ghl_api_key as string,
                ghlLocationId: (client as any).ghl_location_id as string,
                contactId: lead_id,
                conversationProviderId: ((client as any).ghl_conversation_provider_id as string | null) ?? null,
                message: msg,
                direction: "outbound",
                altId: twilioJson.sid ?? null,
              });
              if (!mirrorResult.ok) {
                console.warn("processMessages: GHL mirror non-OK", mirrorResult);
              }
            }
          }
        }
      }

      // ── STEP 6.1: Bump last_message_at + preview for conversation list ──────
      if (setterMessages.length > 0) {
        const preview = setterMessages[0].slice(0, 200);
        const nowIso = new Date().toISOString();
        await supabase
          .from("leads")
          .update({
            last_message_preview: preview,
            last_message_at: nowIso,
            // Cadence v2 — direction-aware tracking. AI setter reply is an
            // outbound message; the cold-reply nudge task uses this to detect
            // "we replied, lead went quiet" windows.
            last_outbound_at: nowIso,
          })
          .eq("client_id", client.id)
          .eq("lead_id", lead_id);
      }

      // ── STEP 6.5: Schedule follow-up if configured for this setter ───────────
      const slotId = setter_number ? `Setter-${setter_number}` : null;
      if (slotId) {
        const { data: agentSettings } = await supabase
          .from("agent_settings")
          .select("followup_1_delay_seconds, followup_max_attempts")
          .eq("client_id", client.id)
          .eq("slot_id", slotId)
          .maybeSingle();

        const followupDelay = (agentSettings?.followup_1_delay_seconds as number | null) ?? 0;
        const followupMaxAttempts = (agentSettings?.followup_max_attempts as number | null) ?? 0;

        if (followupDelay > 0 && followupMaxAttempts > 0) {
          const firesAt = new Date(Date.now() + followupDelay * 1000);

          // Cancel any existing pending timer for this contact
          await supabase
            .from("followup_timers")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("lead_id", lead_id)
            .eq("ghl_account_id", ghl_account_id)
            .eq("status", "pending");

          // Create new timer
          const { data: newTimer } = await supabase
            .from("followup_timers")
            .insert({
              client_id: client.id,
              lead_id,
              ghl_account_id,
              setter_number: setter_number ?? "1",
              status: "pending",
              fires_at: firesAt.toISOString(),
            })
            .select("id")
            .single();

          if (newTimer) {
            followupTimerId = newTimer.id;
            const followupRun = await sendFollowup.trigger({
              timer_id: newTimer.id,
              lead_id,
              ghl_account_id,
              setter_number: setter_number ?? "1",
              fires_at: firesAt.toISOString(),
              client_id: client.id,
            });
            // Store the Trigger.dev run ID so Push Now can cancel + re-trigger
            await supabase
              .from("followup_timers")
              .update({ trigger_run_id: followupRun.id })
              .eq("id", newTimer.id);
            console.log(`Follow-up scheduled for ${firesAt.toISOString()} (${followupDelay}s), run: ${followupRun.id}`);
          }
        }
      }

      // ── STEP 7: Mark messages as processed ──────────────────────────────────
      await supabase
        .from("message_queue")
        .update({ processed: true })
        .in("id", messageIds);

      // ── STEP 8: Mark execution as complete ──────────────────────────────────
      await updateExecution({
        status: "completed",
        stage_description: "Done — reply sent to GHL.",
        completed_at: new Date().toISOString(),
        resume_at: null,
        has_error: false, // clear any error flag set during earlier retry attempts
      });

      await cleanup(supabase, lead_id, ghl_account_id, triggerRunId);

      return {
        status: "completed",
        messages_processed: messages.length,
        grouped_message: groupedMessage,
      };
    } catch (error) {
      const maxAttempts = 3; // must match retry.maxAttempts on this task
      const isLastAttempt = (ctx?.attempt?.number ?? 1) >= maxAttempts;

      await updateExecution({
        status: isLastAttempt ? "failed" : "waiting",
        stage_description: isLastAttempt
          ? `Error: ${(error as Error).message}`
          : `Retrying... ${(error as Error).message}`,
        completed_at: isLastAttempt ? new Date().toISOString() : undefined,
        resume_at: null,
        // Only mark has_error after all retries are exhausted — never on intermediate attempts
        ...(isLastAttempt ? { has_error: true } : {}),
      });

      // Cancel any pending follow-up timer if this run failed
      // (follow-up should not fire if the original message was never sent)
      if (followupTimerId) {
        await supabase
          .from("followup_timers")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", followupTimerId)
          .eq("status", "pending");
      }

      // Only cleanup after the final attempt so GHL webhook retries
      // don't spawn a duplicate run while Trigger.dev is still retrying
      if (isLastAttempt) {
        await cleanup(supabase, lead_id, ghl_account_id, triggerRunId);
      }

      throw error;
    }
  },
});

// Bug 32 — filter on trigger_run_id so a finishing run doesn't sweep away the
// active_trigger_runs entry of a concurrently-spawned run for the same lead.
// Pre-fix this orphaned a second dm_execution if a prospect replied twice
// within the debounce window (15-25% of slow-replier prospects per defect
// doc). Post-fix each run cleans only its own active_trigger_runs entry.
async function cleanup(
  supabase: ReturnType<typeof createClient<any>>,
  lead_id: string,
  ghl_account_id: string,
  trigger_run_id: string | undefined
) {
  if (!trigger_run_id) {
    console.warn(
      `cleanup() skipped — trigger_run_id missing for lead_id=${lead_id} ghl_account_id=${ghl_account_id}. ` +
      `This shouldn't happen inside a Trigger.dev task; the run.id is normally always set.`
    );
    return;
  }
  await supabase
    .from("active_trigger_runs")
    .delete()
    .eq("lead_id", lead_id)
    .eq("ghl_account_id", ghl_account_id)
    .eq("trigger_run_id", trigger_run_id);
}
