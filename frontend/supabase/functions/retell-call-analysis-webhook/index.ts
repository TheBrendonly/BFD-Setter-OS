import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveContactId } from "./contactId.ts";
import { classifyCallOutcome } from "./classifyCallOutcome.ts";
import { buildCallOutcomeStamp, buildOutcomeFieldWrites, stampLastCallOutcome } from "./callOutcome.ts";
import { pushCallEventToGhl, writeGhlContactFields } from "../_shared/ghl-conversations.ts";
import { parseCallbackTime } from "../_shared/parseCallbackTime.ts";
// Retell signature verification (correct v={ts},d=HMAC(body+ts, API_KEY) scheme,
// 5-min window). Shared across the 3 Retell webhooks. Verify-if-present; the
// stored secret value is the Retell API key.
import { verifyRetellSignature } from "../_shared/verify-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retell-signature",
};

const CALL_ANALYZED_EVENT = "call_analyzed";

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildEnrichedAnalysisData(
  eventType: string,
  rawPayload: Record<string, unknown>,
  call: Record<string, unknown>,
  dynamicVars: Record<string, unknown>,
): Record<string, unknown> | null {
  const rawCustomAnalysisData = call.call_analysis && typeof call.call_analysis === "object"
    ? (call.call_analysis as Record<string, unknown>).custom_analysis_data
    : null;

  const customAnalysisData = rawCustomAnalysisData && typeof rawCustomAnalysisData === "object" && !Array.isArray(rawCustomAnalysisData)
    ? { ...(rawCustomAnalysisData as Record<string, unknown>) }
    : rawCustomAnalysisData !== null && rawCustomAnalysisData !== undefined
      ? { value: rawCustomAnalysisData }
      : {};

  const retellEnvelope: Record<string, unknown> = {
    event: eventType,
    call_analysis: call.call_analysis ?? null,
    metadata: call.metadata ?? null,
    dynamic_variables: dynamicVars,
    transcript_with_tool_calls: call.transcript_with_tool_calls ?? null,
    transfer_destination: rawPayload.transfer_destination ?? null,
    transfer_option: rawPayload.transfer_option ?? null,
    opt_out_sensitive_data_storage: call.opt_out_sensitive_data_storage ?? null,
  };

  if (!Object.keys(customAnalysisData).length && !hasMeaningfulValue(retellEnvelope)) {
    return null;
  }

  return {
    ...customAnalysisData,
    _retell: retellEnvelope,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Always return 200 to prevent Retell retries
  const ok = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Read raw body once so Phase 8b sig verification can hash it and
    // the rest of the handler can JSON.parse it.
    const rawBodyText = await req.text();
    let rawPayload: any;
    try {
      rawPayload = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch {
      return ok({ ok: false, error: "invalid JSON" }, 400);
    }
    const eventType = rawPayload.event;
    console.log(`📞 Retell call analysis webhook received, event: ${eventType}`);

    // Retell sends various events; we care about call completion
    if (eventType !== "call_ended" && eventType !== CALL_ANALYZED_EVENT) {
      console.log(`⏭️ Ignoring event type: ${eventType}`);
      return ok({ ok: true, skipped: true });
    }

    const shouldPersistAnalyzedRecord = eventType === CALL_ANALYZED_EVENT;

    const call = rawPayload.call || rawPayload.data || rawPayload;
    const callId = call.call_id || call.id || null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Step 1: Identify client ──

    const dynamicVars = call.retell_llm_dynamic_variables || call.dynamic_variables || {};
    const ghlAccountId: string | null = dynamicVars.ghl_account_id || dynamicVars.GHL_Account_ID || null;
    const contactId: string | null = resolveContactId(dynamicVars);
    const setterId: string | null = dynamicVars.voice_setter_id || null;
    const normalizedSetterSlotId = typeof setterId === "string"
      ? setterId.replace(/voice-setter-(\d+)/i, "Voice-Setter-$1")
      : null;
    const agentId: string | null = call.agent_id || null;

    let clientId: string | null = null;
    let resolvedGhlAccountId: string | null = ghlAccountId;
    let phoneCallWebhookUrl: string | null = null;
    let setterPostWebhookUrl: string | null = null;
    let existingPreCallContext: unknown = undefined;

    // Primary: resolve via ghl_account_id
    if (ghlAccountId) {
      const { data: clientRow } = await supabase
        .from("clients")
        .select("id, phone_call_webhook_url")
        .eq("ghl_location_id", ghlAccountId)
        .single();

      if (clientRow) {
        clientId = clientRow.id;
        phoneCallWebhookUrl = clientRow.phone_call_webhook_url;
        console.log(`✅ Client resolved via ghl_account_id: ${clientId}`);
      }
    }

    // Fallback: resolve via retell_agent_mapping
    if (!clientId && agentId) {
      const { data: mapping } = await supabase
        .from("retell_agent_mapping")
        .select("client_id, ghl_account_id")
        .eq("agent_id", agentId)
        .single();

      if (mapping) {
        clientId = mapping.client_id;
        resolvedGhlAccountId = resolvedGhlAccountId || mapping.ghl_account_id;
        console.log(`✅ Client resolved via agent_id mapping: ${clientId}`);
      }
    }

    // Second fallback: resolve via client retell agent columns (all 10 slots)
    // agentId is interpolated into the .or() filter string below; validate its
    // shape (real Retell agent ids are "agent_<hex>") to prevent filter injection.
    if (!clientId && agentId && /^agent_[A-Za-z0-9]+$/.test(agentId)) {
      const { data: clients } = await supabase
        .from("clients")
        .select("id, ghl_location_id, phone_call_webhook_url")
        .or(
          `retell_inbound_agent_id.eq.${agentId},retell_outbound_agent_id.eq.${agentId},retell_outbound_followup_agent_id.eq.${agentId},retell_agent_id_4.eq.${agentId},retell_agent_id_5.eq.${agentId},retell_agent_id_6.eq.${agentId},retell_agent_id_7.eq.${agentId},retell_agent_id_8.eq.${agentId},retell_agent_id_9.eq.${agentId},retell_agent_id_10.eq.${agentId}`
        );

      if (clients && clients.length > 0) {
        clientId = clients[0].id;
        resolvedGhlAccountId = resolvedGhlAccountId || clients[0].ghl_location_id;
        phoneCallWebhookUrl = clients[0].phone_call_webhook_url;
        console.log(`✅ Client resolved via retell agent columns: ${clientId}`);
      }
    }

    // If still no client, log error and return 200
    if (!clientId) {
      console.error(`❌ Could not resolve client. agent_id=${agentId}, ghl_account_id=${ghlAccountId}`);

      const errorGhlId = ghlAccountId || "unknown";
      await supabase.from("error_logs").insert({
        client_ghl_account_id: errorGhlId,
        severity: "error",
        source: "retell-call-analysis-webhook",
        error_type: "client_resolution_failed",
        error_message: `Could not resolve client for Retell call. agent_id=${agentId}, ghl_account_id=${ghlAccountId}`,
        context: { call_id: call.call_id, agent_id: agentId, raw_payload: rawPayload },
      });

      return ok({ ok: true, skipped: true, reason: "client_not_found" });
    }

    // Phase 8b — verify Retell signature when the client has the secret
    // configured. Backwards-compatible: no secret → no verification.
    {
      const { data: secretRow } = await supabase
        .from("clients")
        .select("retell_webhook_secret")
        .eq("id", clientId)
        .maybeSingle();
      const retellSecret = secretRow?.retell_webhook_secret as string | null;
      if (retellSecret) {
        const sigHeader = req.headers.get("x-retell-signature");
        if (!sigHeader) {
          console.warn("retell-call-analysis-webhook: secret configured but x-retell-signature missing", { clientId });
          return ok({ ok: false, error: "Forbidden" }, 403);
        }
        const sigOk = await verifyRetellSignature(rawBodyText, sigHeader, retellSecret);
        if (!sigOk) {
          console.warn("retell-call-analysis-webhook: signature mismatch", { clientId, agentId });
          return ok({ ok: false, error: "Forbidden" }, 403);
        }
      }
    }

    // ── Bump leads.last_message_at for the contact (canonical inbound pattern).
    // Mirrors receive-twilio-sms / receive-dm-webhook so the Chats list reflects
    // voice activity. Skipped when contactId is unknown (call had no contact context).
    if (contactId) {
      const direction = String(call.direction || call.call_type || "").toLowerCase();
      const isInbound = direction.includes("inbound");
      const leadPhone = isInbound ? (call.from_number || null) : (call.to_number || null);
      const dvFirst = typeof dynamicVars.first_name === "string" ? dynamicVars.first_name : null;
      const dvLast = typeof dynamicVars.last_name === "string" ? dynamicVars.last_name : null;
      const callTs = toIsoTimestamp(call.end_timestamp) || toIsoTimestamp(call.start_timestamp) || new Date().toISOString();
      const previewBits = ["[voice call"];
      if (call.disconnection_reason) previewBits.push(String(call.disconnection_reason));
      else if (call.call_status) previewBits.push(String(call.call_status));
      else previewBits.push(String(eventType));
      const preview = previewBits.join(": ").slice(0, 200) + "]";

      const upsertRow: Record<string, unknown> = {
        client_id: clientId,
        lead_id: contactId,
        last_message_at: callTs,
        last_message_preview: preview,
      };
      if (leadPhone) upsertRow.phone = leadPhone;
      if (dvFirst) upsertRow.first_name = dvFirst;
      if (dvLast) upsertRow.last_name = dvLast;

      const { error: leadUpsertErr } = await supabase
        .from("leads")
        .upsert(upsertRow, { onConflict: "client_id,lead_id" });
      if (leadUpsertErr) {
        console.warn(`⚠️ leads upsert failed for ${contactId}: ${leadUpsertErr.message}`);
      }
    }

    if (callId) {
      const { data: existingCallHistory } = await supabase
        .from("call_history")
        .select("pre_call_context")
        .eq("call_id", callId)
        .maybeSingle();

      if (existingCallHistory && Object.prototype.hasOwnProperty.call(existingCallHistory, "pre_call_context")) {
        existingPreCallContext = existingCallHistory.pre_call_context;
      }
    }

    // Fetch webhook URL if not already resolved
    if (!phoneCallWebhookUrl) {
      const { data: clientRow } = await supabase
        .from("clients")
        .select("phone_call_webhook_url")
        .eq("id", clientId)
        .single();
      if (clientRow) {
        phoneCallWebhookUrl = clientRow.phone_call_webhook_url;
      }
    }

    // Fetch optional setter-level post-call webhook from prompt_configurations
    if (normalizedSetterSlotId) {
      const { data: setterConfig } = await supabase
        .from("prompt_configurations")
        .select("custom_content")
        .eq("client_id", clientId)
        .eq("slot_id", normalizedSetterSlotId)
        .eq("config_key", "_retell_voice_settings")
        .maybeSingle();

      if (setterConfig?.custom_content) {
        try {
          const parsedConfig = JSON.parse(setterConfig.custom_content);
          const candidateWebhook = typeof parsedConfig?.webhook_url === "string"
            ? parsedConfig.webhook_url.trim()
            : "";

          if (candidateWebhook) {
            setterPostWebhookUrl = candidateWebhook;
            console.log(`✅ Setter post-call webhook resolved for ${normalizedSetterSlotId}`);
          }
        } catch (parseErr) {
          console.warn(`⚠️ Failed to parse setter webhook config for ${normalizedSetterSlotId}:`, parseErr);
        }
      }
    }

    let record: Record<string, unknown> | null = null;

    if (shouldPersistAnalyzedRecord) {
      // ── Step 2: Build call_history record ──

      // Compute duration_seconds from duration_ms or call_duration_ms
      const durationMs = call.duration_ms ?? call.call_duration_ms ?? null;
      const durationSeconds = typeof durationMs === "number" ? Math.round(durationMs / 1000) : null;

      // Detect voicemail / human pickup via Bug 33 shared classifier.
      const disconnectionReason = call.disconnection_reason || null;
      const callHistorySignals = {
        disconnect_reason: disconnectionReason,
        call_status: call.call_status || null,
        duration_ms: typeof durationMs === "number" ? durationMs : null,
        transcript_turns: Array.isArray(call.transcript_object) ? call.transcript_object.length : 0,
        in_voicemail: call.call_analysis?.in_voicemail === true,
      };
      const callHistoryClass = classifyCallOutcome(callHistorySignals);
      const voicemailDetected = callHistoryClass === "voicemail";
      const humanPickup = callHistoryClass === "human_pickup";

      // Extract appointment data from custom_analysis_data if available
      const customAnalysis = call.call_analysis?.custom_analysis_data || {};
      const callResultStr = typeof customAnalysis["Call result"] === "string"
        ? customAnalysis["Call result"]
        : typeof customAnalysis.call_result === "string"
          ? customAnalysis.call_result
          : "";
      const appointmentBooked = customAnalysis.appointment_booked === true
        || customAnalysis.booked === true
        || /\bbook(?:ed|ing)?\b/i.test(callResultStr)
        || false;
      const appointmentTime = customAnalysis.appointment_time || customAnalysis.booked_time || null;

      // Build contact name from dynamic vars
      const contactName = [dynamicVars.first_name, dynamicVars.last_name].filter(Boolean).join(" ") || null;

      // 6.12b: captured when a callback is parsed below, for the GHL
      // "Callback Datetime" outcome field.
      let callbackScheduledForIso: string | null = null;

      // ── Callback scheduling: lead asked to be called back later (NOT a booking) ──
      // Agent should emit custom_analysis_data.requested_callback_time (preferred) or
      // callback_intent; we also fall back to scanning the result text. Dormant until
      // the agent prompt emits these fields.
      const requestedCallbackRaw =
        (typeof customAnalysis.requested_callback_time === "string" && customAnalysis.requested_callback_time) ||
        (typeof customAnalysis.callback_time === "string" && customAnalysis.callback_time) ||
        (typeof customAnalysis.callback_intent === "string" && customAnalysis.callback_intent) || "";
      const wantsCallback = !!requestedCallbackRaw ||
        customAnalysis.callback_requested === true ||
        /\bcall (me )?back\b|call me (later|tomorrow|this afternoon|in)/i.test(callResultStr);
      if (wantsCallback && !appointmentBooked && clientId && contactId && setterId) {
        try {
          const toPhone = call.to_number || (dynamicVars.phone as string | undefined) || null;
          // CAD-03 dedup: the in-call schedule-callback tool may have ALREADY
          // created a pending callback for this contact during the call. Don't
          // create a second row (→ a second dial 24h later). Partial unique index
          // scheduled_callbacks_pending_contact_uidx is the DB backstop; this is
          // the friendly pre-check that also avoids a noisy 23505 in the logs.
          const { data: existingCb } = toPhone
            ? await supabase.from("scheduled_callbacks").select("id")
                .eq("client_id", clientId).eq("ghl_contact_id", contactId)
                .eq("status", "pending").limit(1).maybeSingle()
            : { data: null };
          if (toPhone && existingCb?.id) {
            console.log(`📅 callback already pending for contact ${contactId} (cb=${existingCb.id}); skipping webhook-path insert`);
          } else if (toPhone) {
            const { data: clientTz } = await supabase.from("clients").select("timezone").eq("id", clientId).maybeSingle();
            const tz = (clientTz?.timezone as string | null) || "Australia/Brisbane";
            const parsed = parseCallbackTime(String(requestedCallbackRaw || callResultStr || "later"), new Date(), tz);
            callbackScheduledForIso = toIsoTimestamp(parsed.scheduledFor);
            const { data: cbRow } = await supabase.from("scheduled_callbacks").insert({
              client_id: clientId, ghl_contact_id: contactId, ghl_account_id: resolvedGhlAccountId,
              voice_setter_id: setterId, call_id: callId, contact_name: contactName, contact_phone: toPhone,
              scheduled_for: parsed.scheduledFor, callback_reason: parsed.reason, status: "pending",
            }).select("id").single();
            if (cbRow?.id) {
              const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
              if (triggerKey) {
                await fetch("https://api.trigger.dev/api/v1/tasks/schedule-callback/trigger", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${triggerKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ payload: { scheduled_callback_id: cbRow.id } }),
                });
              }
              console.log(`📅 callback scheduled for ${parsed.scheduledFor} (cb=${cbRow.id}, reason="${parsed.reason}")`);
            }
          }
        } catch (e) {
          console.warn("callback scheduling failed (non-fatal):", e);
        }
      }

      // Extract campaign_id from dynamic vars if available
      const campaignId = dynamicVars.campaign_id || null;

      record = {
        client_id: clientId,
        contact_id: contactId,
        ghl_account_id: resolvedGhlAccountId,
        call_id: callId,
        agent_id: agentId,
        setter_id: setterId,
        campaign_id: campaignId,
        contact_name: contactName,
        from_number: call.from_number || null,
        to_number: call.to_number || null,
        call_type: call.call_type || null,
        direction: call.direction || call.call_type || null,
        call_status: call.call_status || call.status || "completed",
        disconnect_reason: disconnectionReason,
        start_timestamp: toIsoTimestamp(call.start_timestamp),
        end_timestamp: toIsoTimestamp(call.end_timestamp),
        duration_ms: durationMs,
        duration_seconds: durationSeconds,
        transcript: call.transcript || null,
        transcript_object: call.transcript_object || null,
        recording_url: call.recording_url || null,
        public_log_url: call.public_log_url || null,
        call_summary: call.call_analysis?.call_summary || null,
        user_sentiment: call.call_analysis?.user_sentiment || null,
        call_successful: call.call_analysis?.call_successful ?? null,
        token_usage: call.llm_usage?.total_tokens ?? call.token_usage ?? null,
        voicemail_detected: voicemailDetected,
        human_pickup: humanPickup,
        appointment_booked: appointmentBooked,
        appointment_time: appointmentTime ? toIsoTimestamp(appointmentTime) : null,
        custom_analysis_data: buildEnrichedAnalysisData(eventType, rawPayload, call, dynamicVars),
        custom_data: call.metadata || null,
        raw_payload: rawPayload,
        cost: typeof call.cost === "number" ? call.cost : (typeof call.call_cost?.combined_cost === "number" ? Math.round(call.call_cost.combined_cost) / 100 : null),
        latency_ms: call.latency || null,
        updated_at: new Date().toISOString(),
      };

      if (existingPreCallContext !== undefined) {
        record.pre_call_context = existingPreCallContext;
      }

      console.log(`📦 Storing analyzed call ${record.call_id} for client ${clientId}`);

      // ── Step 3: Upsert (idempotent on call_id) ──

      const { error: upsertErr } = await supabase
        .from("call_history")
        .upsert(record, { onConflict: "call_id" });

      if (upsertErr) {
        console.error(`❌ Failed to store call: ${upsertErr.message}`);

        await supabase.from("error_logs").insert({
          client_ghl_account_id: resolvedGhlAccountId || "unknown",
          severity: "error",
          source: "retell-call-analysis-webhook",
          error_type: "call_history_insert_failed",
          error_message: upsertErr.message,
          context: { call_id: record.call_id, client_id: clientId },
        });

        // Still return 200 so Retell doesn't retry
        return ok({ ok: false, error: upsertErr.message });
      }

      console.log(`✅ Call ${record.call_id} stored successfully`);

      // ── GHL gap 1: Push call summary + sentiment + appointment_booked ──
      // Best-effort: never throws; failure only logs a console.warn.
      // Fires only when contactId is known (Retell dynamic variable contact_id).
      // Uses per-client ghl_call_sentiment_field_id / ghl_call_appt_booked_field_id
      // columns — if either is null the corresponding custom-field PATCH is skipped
      // (the Note is always written when ghl_api_key is present).
      if (contactId) {
        try {
          const { data: ghlClientRow } = await supabase
            .from("clients")
            .select(
              "ghl_api_key, ghl_location_id, ghl_call_sentiment_field_id, ghl_call_appt_booked_field_id, " +
              "ghl_conversation_provider_id, " +
              "ghl_call_outcome_field_id, ghl_call_summary_field_id, ghl_call_intent_field_id, ghl_lead_qualified_field_id, " +
              "ghl_last_call_date_field_id, ghl_callback_requested_field_id, ghl_callback_datetime_field_id, ghl_appointment_datetime_field_id, " +
              "twilio_account_sid, twilio_auth_token, twilio_default_phone, retell_phone_1, timezone",
            )
            .eq("id", clientId)
            .maybeSingle();

          const ghlApiKey = ghlClientRow?.ghl_api_key as string | null;
          const sentimentFieldId = ghlClientRow?.ghl_call_sentiment_field_id as string | null;
          const apptBookedFieldId = ghlClientRow?.ghl_call_appt_booked_field_id as string | null;
          const conversationProviderId = ghlClientRow?.ghl_conversation_provider_id as string | null;
          const twilioAccountSid = ghlClientRow?.twilio_account_sid as string | null;
          const twilioAuthToken = ghlClientRow?.twilio_auth_token as string | null;
          const twilioFromNumber = (ghlClientRow?.twilio_default_phone as string | null) || (ghlClientRow?.retell_phone_1 as string | null);
          const clientTimezone = (ghlClientRow?.timezone as string | null) || "Australia/Brisbane";

          if (ghlApiKey) {
            const ghlHeaders = {
              "Authorization": `Bearer ${ghlApiKey}`,
              "Version": "2021-07-28",
              "Content-Type": "application/json",
            };
            const ghlBase = "https://services.leadconnectorhq.com";

            // Build note content
            const callSummary = (record.call_summary as string | null) || "No summary available.";
            const durationStr = record.duration_seconds ? `${record.duration_seconds}s` : "unknown";
            const sentimentStr = (record.user_sentiment as string | null) || "unknown";
            const apptStr = record.appointment_booked ? "Yes" : "No";
            const noteContent = [
              "[Voice Call Summary]",
              `Duration: ${durationStr}`,
              `Sentiment: ${sentimentStr}`,
              `Appointment booked: ${apptStr}`,
              "",
              callSummary,
            ].join("\n");

            // 1. Write Note — ONLY when there is no Conversations provider. When
            // a provider IS configured, pushCallEventToGhl (below) logs the call to
            // the Conversations timeline instead; writing this note too would
            // double-post (fix: double GHL note when ghl_conversation_provider_id
            // is NULL — the legacy note and pushCallEventToGhl's note fallback both
            // fired). These two paths are now mutually exclusive.
            if (!conversationProviderId) {
              const noteRes = await fetch(`${ghlBase}/contacts/${contactId}/notes`, {
                method: "POST",
                headers: ghlHeaders,
                body: JSON.stringify({ body: noteContent }),
              });
              if (!noteRes.ok) {
                const noteRespBody = await noteRes.text().catch(() => "");
                console.warn(`⚠️ GHL gap-1 note failed ${noteRes.status}: ${noteRespBody.slice(0, 200)}`);
              } else {
                console.log(`✅ GHL gap-1 note pushed for contact ${contactId}`);
              }
            }

            // 2. PATCH the full outcome suite (6.12b) in one PUT. The mapper
            // drops any field whose client column is unset or whose source value
            // is empty, so this supersets the old sentiment + appt-booked write.
            const outcomeWrites = buildOutcomeFieldWrites({
              callHistoryClass,
              callSummary: record.call_summary as string | null,
              callIntent: typeof customAnalysis.interested_status === "string" ? customAnalysis.interested_status : null,
              qualified: typeof customAnalysis.success_rate === "boolean"
                ? customAnalysis.success_rate
                : (typeof record.call_successful === "boolean" ? record.call_successful : null),
              lastCallDate: (record.end_timestamp as string | null) ?? (record.start_timestamp as string | null),
              callbackRequested: wantsCallback,
              callbackDatetime: callbackScheduledForIso,
              appointmentDatetime: record.appointment_time as string | null,
              sentiment: record.user_sentiment as string | null,
              appointmentBooked: appointmentBooked === true,
            }, {
              outcome: ghlClientRow?.ghl_call_outcome_field_id as string | null,
              summary: ghlClientRow?.ghl_call_summary_field_id as string | null,
              intent: ghlClientRow?.ghl_call_intent_field_id as string | null,
              qualified: ghlClientRow?.ghl_lead_qualified_field_id as string | null,
              lastCallDate: ghlClientRow?.ghl_last_call_date_field_id as string | null,
              callbackRequested: ghlClientRow?.ghl_callback_requested_field_id as string | null,
              callbackDatetime: ghlClientRow?.ghl_callback_datetime_field_id as string | null,
              appointmentDatetime: ghlClientRow?.ghl_appointment_datetime_field_id as string | null,
              sentiment: sentimentFieldId,
              appointmentBooked: apptBookedFieldId,
            });
            const fieldRes = await writeGhlContactFields({ ghlApiKey, contactId, fields: outcomeWrites });
            if (fieldRes.skipped) {
              console.log(`ℹ️ GHL outcome fields: none configured/none to write for contact ${contactId}`);
            } else if (!fieldRes.ok) {
              console.warn(`⚠️ GHL outcome fields PATCH failed ${fieldRes.status ?? "-"}: ${fieldRes.error ?? ""}`);
            } else {
              console.log(`✅ GHL outcome fields patched (${outcomeWrites.length}) for contact ${contactId}`);
            }

            // Bug 16 — push the call as a Call/Voicemail event on the GHL
            // Conversations timeline. Only when a Custom Conversation Provider is
            // configured; without one, the legacy Note above is the single artifact
            // (so we don't double-post a note via this helper's fallback).
            // Idempotent via altId = Retell call_id.
            if (conversationProviderId) {
              const callDirectionForConv: "inbound" | "outbound" = (typeof record.direction === "string" && record.direction.toLowerCase().includes("inbound"))
                ? "inbound"
                : "outbound";
              const callTypeForConv: "Call" | "Voicemail" = callHistoryClass === "voicemail" ? "Voicemail" : "Call";
              const occurredAt = (record.end_timestamp as string | null) || (record.start_timestamp as string | null) || new Date().toISOString();
              const convPush = await pushCallEventToGhl({
                ghlApiKey,
                contactId,
                conversationProviderId,
                callType: callTypeForConv,
                direction: callDirectionForConv,
                durationSeconds: (record.duration_seconds as number | null) ?? null,
                callId: (record.call_id as string | null) ?? callId,
                recordingUrl: (record.recording_url as string | null) ?? null,
                outcomeSummary: (record.call_summary as string | null) ?? null,
                outcomeClass: callHistoryClass,
                altId: (record.call_id as string | null) ?? callId,
                occurredAt,
              });
              console.log(`📞 Bug-16 conversations push → ${convPush.ok ? "OK" : "FAIL"} via=${convPush.via} status=${convPush.status ?? "-"}`);
            }
          } else {
            console.log(`ℹ️ GHL gap-1 skipped for client ${clientId}: no ghl_api_key`);
          }

          // Bug 28 — booking confirmation SMS via Twilio. Fires when
          // record.appointment_booked === true regardless of direction
          // (an inbound call that books an appointment also gets the SMS).
          // Idempotency: Retell sends call_analyzed once per call; if it ever
          // re-fires we'll send a second SMS — rare in practice, acceptable.
          // Skipped if Twilio creds or from/to numbers are missing.
          if (record.appointment_booked === true) {
            try {
              const leadPhone: string | null = (callDirectionForConv === "outbound")
                ? ((record.to_number as string | null) ?? null)
                : ((record.from_number as string | null) ?? null);

              if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
                console.log(`ℹ️ Bug-28 booking confirm SMS skipped for client ${clientId}: missing twilio creds (sid=${!!twilioAccountSid}, token=${!!twilioAuthToken}, from=${!!twilioFromNumber})`);
              } else if (!leadPhone) {
                console.log(`ℹ️ Bug-28 booking confirm SMS skipped: no lead phone resolved (direction=${callDirectionForConv})`);
              } else {
                // Format appointment time. record.appointment_time may be ISO
                // or a free-form string from the agent's analysis; render best-
                // effort. Falls back to "your scheduled time" if absent.
                const apptTimeRaw = (record.appointment_time as string | null) ?? null;
                let apptHuman = "your scheduled time";
                if (apptTimeRaw) {
                  const parsed = new Date(apptTimeRaw);
                  if (!Number.isNaN(parsed.getTime())) {
                    try {
                      apptHuman = parsed.toLocaleString("en-AU", {
                        timeZone: clientTimezone,
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      });
                    } catch {
                      apptHuman = apptTimeRaw;
                    }
                  } else {
                    apptHuman = apptTimeRaw;
                  }
                }

                const firstName = (dynamicVars.first_name as string | undefined) || null;
                const greeting = firstName ? `Hi ${firstName}, ` : "Hi, ";
                const ghlLocId = (ghlClientRow?.ghl_location_id as string | null) ?? null;
                const ghlLink = ghlLocId
                  ? `https://app.gohighlevel.com/v2/location/${ghlLocId}/contacts/detail/${contactId}`
                  : null;
                const smsBody = ghlLink
                  ? `${greeting}your appointment is confirmed for ${apptHuman}. Details: ${ghlLink}`
                  : `${greeting}your appointment is confirmed for ${apptHuman}.`;

                const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
                const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
                const twRes = await fetch(twilioUrl, {
                  method: "POST",
                  headers: {
                    Authorization: `Basic ${twilioAuth}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: new URLSearchParams({
                    To: leadPhone,
                    From: twilioFromNumber,
                    Body: smsBody,
                  }),
                });
                if (!twRes.ok) {
                  const twErr = await twRes.text().catch(() => "");
                  console.warn(`⚠️ Bug-28 confirm SMS Twilio non-OK ${twRes.status}: ${twErr.slice(0, 200)}`);
                } else {
                  const twJson = await twRes.json().catch(() => ({}));
                  console.log(`✅ Bug-28 booking confirm SMS sent (sid=${twJson.sid ?? "?"}) to ${leadPhone}`);
                  // F13 usage metering counts outbound texts from message_queue
                  // channel='sms_outbound' (ghl_account_id = location id or the
                  // client UUID). Stamp the send like every other Twilio-direct
                  // writer so booking-confirmation texts meter; non-fatal.
                  try {
                    await supabase.from("message_queue").insert({
                      lead_id: contactId ?? leadPhone,
                      ghl_account_id: ghlLocId ?? clientId,
                      message_body: smsBody,
                      contact_phone: leadPhone,
                      channel: "sms_outbound",
                      twilio_message_sid: twJson.sid ?? null,
                      processed: true,
                    });
                  } catch (mqErr) {
                    console.warn("⚠️ Bug-28 message_queue stamp failed (non-fatal):", mqErr);
                  }
                }
              }
            } catch (twErr) {
              console.warn("⚠️ Bug-28 booking confirm SMS exception:", twErr);
            }
          }
        } catch (ghlErr) {
          console.warn("⚠️ GHL gap-1 push exception:", ghlErr);
        }
      }

      // ── Step 4 (REMOVED): external Supabase call_history mirror ──
      //
      // Removed 2026-05-17 (EE4). The mirror tried to upsert into
      // `call_history` on each tenant's external Supabase project. None of
      // the active external projects (e.g. bfd-setter-live qildpilxjodxdifggmto)
      // have a `call_history` table, so every analyzed call wrote a noisy
      // "public.call_history not found in schema cache" entry to error_logs.
      // Per architectural direction in [[project_session4_state]] the
      // external-Supabase pattern is being retired in favour of consolidating
      // on bfd-platform; restoring the mirror later is a single revert.
      // The primary `call_history` insert on bfd-platform earlier in this
      // function is unchanged.

      // ── Step 5: Fire post-call webhook(s) ──

      const internalWebhookUrl = `${supabaseUrl}/functions/v1/retell-call-analysis-webhook`;
      const webhookTargets = Array.from(
        new Set(
          [phoneCallWebhookUrl, setterPostWebhookUrl]
            .map((url) => (typeof url === "string" ? url.trim() : ""))
            .filter((url) => url.length > 0 && url !== internalWebhookUrl)
        )
      );

      if (webhookTargets.length > 0) {
        const webhookPayload = {
          event: "call_completed",
          retell_event: eventType,
          call_id: record.call_id,
          agent_id: agentId,
          setter_id: setterId,
          client_id: clientId,
          contact_id: contactId,
          lead_id: contactId,
          ghl_account_id: resolvedGhlAccountId,
          from_number: record.from_number,
          to_number: record.to_number,
          direction: record.direction,
          call_status: record.call_status,
          disconnect_reason: record.disconnect_reason,
          disconnection_reason: call.disconnection_reason || null,
          duration_ms: record.duration_ms,
          call_summary: record.call_summary,
          user_sentiment: record.user_sentiment,
          call_successful: record.call_successful,
          recording_url: record.recording_url,
          transcript: record.transcript,
          transcript_object: record.transcript_object,
          transcript_with_tool_calls: call.transcript_with_tool_calls || null,
          call_analysis: call.call_analysis || null,
          custom_analysis_data: record.custom_analysis_data,
          metadata: call.metadata || null,
          start_timestamp: record.start_timestamp,
          end_timestamp: record.end_timestamp,
          cost: record.cost,
          call_cost: call.cost ?? null,
          dynamic_variables: dynamicVars,
          retell_dynamic_variables: dynamicVars,
          raw_payload: rawPayload,
          pre_call_context: record.pre_call_context ?? null,
        };

        for (const webhookUrl of webhookTargets) {
          try {
            console.log(`🔔 Firing post-call webhook: ${webhookUrl}`);
            const webhookResp = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(webhookPayload),
            });

            const webhookStatus = webhookResp.status;
            const webhookBody = await webhookResp.text().catch(() => "");
            console.log(`🔔 Post-call webhook response: ${webhookStatus} ${webhookBody.slice(0, 200)}`);
          } catch (webhookErr) {
            console.warn(`⚠️ Post-call webhook failed for ${webhookUrl}:`, webhookErr);
          }
        }
      } else {
        console.log("ℹ️ No external post-call webhook configured, skipping forward sync");
      }
    } else {
      console.log(`ℹ️ Received ${eventType} for call ${callId}; waiting for call_analyzed before persisting full call history`);
    }

    // ── Step 5.5 (6.11): stamp last_call_outcome on call_ended ──
    // The live agents post to THIS webhook (not retell-call-webhook), so the
    // cadence-critical outcome stamp must happen here too. Without it,
    // runEngagement.waitForCallOutcome polls its full 600s ceiling for
    // voicemail / no-answer calls before sending the missed-call fallback SMS
    // (answered calls already complete via Step 6's human-pickup path). Fires on
    // call_ended only (earliest signal); the Step 6 completion stays intact and
    // idempotent. Clearing active_call_id also releases the processMessages HOLD
    // loop for inbound SMS sent during the call.
    const executionId: string | null = dynamicVars.execution_id || null;
    if (eventType === "call_ended" && executionId) {
      const stamp = buildCallOutcomeStamp(call, new Date().toISOString());
      const stampRes = await stampLastCallOutcome(supabase, executionId, stamp, clientId);
      if (!stampRes.ok) {
        // CRITICAL: runEngagement polls last_call_outcome to break its wait loop
        // and decide advance-vs-terminate. A lost write hangs / mis-classifies
        // the cadence — surface it and ask Retell to retry. Narrow, deliberate
        // exception to this handler's otherwise always-200 contract.
        console.error(
          `retell-call-analysis-webhook: CRITICAL last_call_outcome write failed for exec ${executionId}: ${stampRes.error}`,
        );
        try {
          await supabase.from("error_logs").insert({
            client_id: clientId,
            lead_id: contactId || null,
            execution_id: executionId,
            severity: "error",
            source: "retell-call-analysis-webhook",
            error_type: "last_call_outcome_write_failed",
            error_message: stampRes.error ?? "unknown",
            context: { call_id: callId, event: eventType },
          });
        } catch (_logErr) { /* non-fatal */ }
        return new Response(
          JSON.stringify({ error: "Failed to persist call outcome", retry: true }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.log(
        `📞 last_call_outcome stamped on exec ${executionId} (call_id=${stamp.call_id}, reason=${stamp.disconnect_reason ?? "?"})`,
      );
    }

    // ── Step 6: Handle engagement workflow integration ──

    const treatPickupAsReply = dynamicVars.treat_pickup_as_reply === "true";

    if (treatPickupAsReply && executionId) {
      const disconnectReason = call.disconnection_reason || "";
      const callStatus = call.call_status || call.status || "";

      // Bug 33 — comprehensive classifier guards against ghost-connect funnel
      // poisoning (e.g. iOS call screening that briefly accepts then drops).
      // Requires duration >= 5s AND >= 2 transcript turns to count as engagement.
      const pickupSignals = {
        disconnect_reason: disconnectReason || null,
        call_status: callStatus || null,
        duration_ms: typeof call.duration_ms === "number" ? call.duration_ms
          : (typeof call.call_duration_ms === "number" ? call.call_duration_ms : null),
        transcript_turns: Array.isArray(call.transcript_object) ? call.transcript_object.length : 0,
        in_voicemail: call.call_analysis?.in_voicemail === true,
      };
      const pickupClass = classifyCallOutcome(pickupSignals);
      const isHumanPickup = pickupClass === "human_pickup";

      console.log(
        `📞 Engagement ${executionId}: call class=${pickupClass} ` +
        `(disconnect=${disconnectReason || "?"}, status=${callStatus || "?"}, ` +
        `dur=${pickupSignals.duration_ms ?? "?"}, turns=${pickupSignals.transcript_turns}, ` +
        `in_voicemail=${pickupSignals.in_voicemail})`,
      );

      if (isHumanPickup) {
        console.log(`📞 Human pickup detected for execution ${executionId}. Treating as reply — ending engagement.`);

        const { error: engUpdateErr } = await supabase
          .from("engagement_executions")
          .update({
            status: "completed",
            stop_reason: "human_pickup_treated_as_reply",
            completed_at: new Date().toISOString(),
            stage_description: "Call answered by human — engagement ended",
          })
          .eq("id", executionId)
          .in("status", ["pending", "running"]);

        if (engUpdateErr) {
          console.error(`❌ Failed to update engagement execution: ${engUpdateErr.message}`);
        } else {
          console.log(`✅ Engagement ${executionId} marked as completed (human pickup)`);
        }

        const { data: execData } = await supabase
          .from("engagement_executions")
          .select("trigger_run_id")
          .eq("id", executionId)
          .single();

        if (execData?.trigger_run_id) {
          const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
          if (triggerKey) {
            try {
              const cancelRes = await fetch(
                `https://api.trigger.dev/api/v2/runs/${execData.trigger_run_id}/cancel`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${triggerKey}`,
                    "Content-Type": "application/json",
                  },
                }
              );
              await cancelRes.text();
              console.log(`✅ Cancelled TriggerDev run ${execData.trigger_run_id}`);
            } catch (e) {
              console.warn("Failed to cancel TriggerDev run:", e);
            }
          }
        }
      } else {
        console.log(`📞 Call for execution ${executionId} was not a human pickup (${disconnectReason}/${callStatus}). Engagement continues.`);
      }
    }

    return ok({ ok: true, synced: shouldPersistAnalyzedRecord, deferred: !shouldPersistAnalyzedRecord, call_id: callId });
  } catch (err) {
    console.error("Retell call analysis webhook error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return ok({ ok: false, error: message });
  }
});
