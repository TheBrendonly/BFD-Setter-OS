import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveContactId } from "./contactId.ts";
import { classifyCallOutcome } from "./classifyCallOutcome.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retell-signature",
};

// Phase 8b — Retell webhook signature verification (HMAC-SHA256 over raw
// body; key = clients.retell_webhook_secret). Only kicks in when the
// resolved client has the secret set; otherwise backwards-compat (no
// verification, matches the prior behaviour).
async function verifyRetellSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const sigBytes = new Uint8Array(sigBuf);
  let hex = "";
  for (const b of sigBytes) hex += b.toString(16).padStart(2, "0");
  const expected = hex.toLowerCase();
  const presented = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
  if (expected.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

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
    if (!clientId && agentId) {
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
            .select("ghl_api_key, ghl_location_id, ghl_call_sentiment_field_id, ghl_call_appt_booked_field_id")
            .eq("id", clientId)
            .maybeSingle();

          const ghlApiKey = ghlClientRow?.ghl_api_key as string | null;
          const sentimentFieldId = ghlClientRow?.ghl_call_sentiment_field_id as string | null;
          const apptBookedFieldId = ghlClientRow?.ghl_call_appt_booked_field_id as string | null;

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

            // 1. Write Note (always when ghl_api_key is present)
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

            // 2. PATCH custom fields (only for fields that are configured)
            const customFields: { id: string; field_value: string }[] = [];
            if (sentimentFieldId && record.user_sentiment) {
              customFields.push({ id: sentimentFieldId, field_value: String(record.user_sentiment) });
            }
            if (apptBookedFieldId) {
              customFields.push({ id: apptBookedFieldId, field_value: record.appointment_booked ? "true" : "false" });
            }

            if (customFields.length > 0) {
              const patchRes = await fetch(`${ghlBase}/contacts/${contactId}`, {
                method: "PUT",
                headers: ghlHeaders,
                body: JSON.stringify({ customFields }),
              });
              if (!patchRes.ok) {
                const patchRespBody = await patchRes.text().catch(() => "");
                console.warn(`⚠️ GHL gap-1 custom fields failed ${patchRes.status}: ${patchRespBody.slice(0, 200)}`);
              } else {
                console.log(`✅ GHL gap-1 custom fields patched for contact ${contactId}`);
              }
            }
          } else {
            console.log(`ℹ️ GHL gap-1 skipped for client ${clientId}: no ghl_api_key`);
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

    // ── Step 6: Handle engagement workflow integration ──

    const treatPickupAsReply = dynamicVars.treat_pickup_as_reply === "true";
    const executionId: string | null = dynamicVars.execution_id || null;

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
