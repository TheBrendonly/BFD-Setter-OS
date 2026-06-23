import { createClient } from "npm:@supabase/supabase-js@2.101.0";
// Retell signature verification (correct v={ts},d=HMAC(body+ts, API_KEY) scheme,
// 5-min window). Shared across the 3 Retell webhooks. The stored secret value is
// the Retell API key. Verify-if-present.
import { verifyRetellSignature } from "../_shared/verify-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retell-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "invalid_json" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`📞 Retell call webhook received, event: ${payload.event}`);

    // Retell sends various events; we only care about call completion
    if (payload.event !== "call_ended" && payload.event !== "call_analyzed") {
      console.log(`⏭️ Ignoring event type: ${payload.event}`);
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const call = payload.call || payload.data || payload;

    // Extract agent_id to find the client
    const agentId = call.agent_id;
    if (!agentId) {
      console.warn("No agent_id in payload, cannot resolve client");
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_agent_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const internalSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Guard: agentId comes from the (public) webhook body and is interpolated into
    // a PostgREST .or() filter string below — validate its shape to prevent filter
    // injection. Real Retell agent ids look like "agent_<hex>".
    if (typeof agentId !== "string" || !/^agent_[A-Za-z0-9]+$/.test(agentId)) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "invalid_agent_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find client by matching the agent_id across all 10 agent slots
    const { data: clients, error: clientErr } = await internalSupabase
      .from("clients")
      .select("id, supabase_url, supabase_service_key, retell_webhook_secret")
      .or(
        `retell_inbound_agent_id.eq.${agentId},retell_outbound_agent_id.eq.${agentId},retell_outbound_followup_agent_id.eq.${agentId},retell_agent_id_4.eq.${agentId},retell_agent_id_5.eq.${agentId},retell_agent_id_6.eq.${agentId},retell_agent_id_7.eq.${agentId},retell_agent_id_8.eq.${agentId},retell_agent_id_9.eq.${agentId},retell_agent_id_10.eq.${agentId}`
      );

    if (clientErr || !clients || clients.length === 0) {
      console.warn(`No client found for agent_id ${agentId}`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_client" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = clients[0];

    // Optional Retell signature verification. Inert until the client stamps
    // retell_webhook_secret AND Retell is configured to sign (onboarding BR3).
    if (client.retell_webhook_secret) {
      const sigHeader = req.headers.get("x-retell-signature");
      if (!sigHeader) {
        console.warn("retell-call-webhook: secret configured but x-retell-signature missing", { clientId: client.id });
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const sigOk = await verifyRetellSignature(rawBody, sigHeader, client.retell_webhook_secret as string);
      if (!sigOk) {
        console.warn("retell-call-webhook: Retell signature mismatch", { clientId: client.id });
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Extract dynamic vars early so we can use contactId for the leads upsert
    // even when an external Supabase isn't configured.
    const dynamicVars = call.retell_llm_dynamic_variables || call.dynamic_variables || {};
    const setterId: string | null = dynamicVars.voice_setter_id || null;
    const contactId: string | null =
      dynamicVars.contact_id || dynamicVars.Contact_ID || dynamicVars.Lead_ID || null;

    // ── Bump leads.last_message_at so the Chats list reflects voice activity.
    // Same pattern as receive-twilio-sms / receive-dm-webhook / retell-call-analysis-webhook.
    if (contactId) {
      const direction = String(call.direction || call.call_type || "").toLowerCase();
      const isInbound = direction.includes("inbound");
      const leadPhone = isInbound ? (call.from_number || null) : (call.to_number || null);
      const dvFirst = typeof dynamicVars.first_name === "string" ? dynamicVars.first_name : null;
      const dvLast = typeof dynamicVars.last_name === "string" ? dynamicVars.last_name : null;
      const ts = call.end_timestamp ? new Date(call.end_timestamp).toISOString() : (call.start_timestamp ? new Date(call.start_timestamp).toISOString() : new Date().toISOString());
      const previewBits = ["[voice call"];
      if (call.disconnection_reason) previewBits.push(String(call.disconnection_reason));
      else if (call.call_status) previewBits.push(String(call.call_status));
      else previewBits.push(String(payload.event));
      const preview = previewBits.join(": ").slice(0, 200) + "]";

      const upsertRow: Record<string, unknown> = {
        client_id: client.id,
        lead_id: contactId,
        last_message_at: ts,
        last_message_preview: preview,
      };
      if (leadPhone) upsertRow.phone = leadPhone;
      if (dvFirst) upsertRow.first_name = dvFirst;
      if (dvLast) upsertRow.last_name = dvLast;
      // Cadence v2 — direction-aware tracking. Inbound calls count as a
      // reply (resets nudge_count). Outbound call placement is bumped in
      // runEngagement.ts where the call originates.
      if (isInbound) {
        upsertRow.last_inbound_at = ts;
        upsertRow.last_reply_at = ts;
        upsertRow.nudge_count = 0;
      }

      const { error: leadUpsertErr } = await internalSupabase
        .from("leads")
        .upsert(upsertRow, { onConflict: "client_id,lead_id" });
      if (leadUpsertErr) {
        console.warn(`⚠️ leads upsert failed for ${contactId}: ${leadUpsertErr.message}`);
        // REL-06: record the lost voice-activity bump so it's visible to the
        // operator instead of dying as console noise.
        try {
          await internalSupabase.from("error_logs").insert({
            client_id: client.id,
            lead_id: contactId,
            severity: "warning",
            source: "retell_call_webhook",
            error_type: "leads_upsert_failed",
            error_message: leadUpsertErr.message,
            context: { call_id: call.call_id || call.id || null, event: payload.event },
          });
        } catch (_logErr) { /* non-fatal */ }
      }
    }

    // Bug 1 — cadence coordination. On call_ended, stamp the outcome onto
    // the engagement_execution that placed this call so runEngagement.ts can
    // break its poll loop and decide whether to advance (missed → next
    // channel sends the missed-call SMS) or terminate (human pickup +
    // treat_pickup_as_reply → stop_reason='call_engaged').
    // Whether the cadence-critical write (last_call_outcome) happened in this
    // request — drives the status code on a terminal external-sync failure.
    let outcomePersisted = false;
    if (payload.event === "call_ended") {
      const executionId: string | null = (dynamicVars.execution_id as string | undefined) || null;
      if (executionId) {
        const callId = call.call_id || call.id || null;
        // Scope the mutation to the resolved tenant AND bind it to the real
        // in-flight call. execution_id and agent_id both come from the (public,
        // currently-unsigned) webhook body, so without this a forged POST with a
        // guessed execution_id could clear another tenant's hold / pollute its
        // outcome. The legit row always satisfies both (runEngagement stamps
        // active_call_id=callId at placement and owns client_id).
        let execUpdate = internalSupabase
          .from("engagement_executions")
          .update({
            last_call_outcome: {
              call_id: callId,
              disconnect_reason: call.disconnection_reason || null,
              call_status: call.call_status || call.status || null,
              ended_at: new Date().toISOString(),
            },
            // Clear the voice-call hold signal so the text setter (processMessages)
            // can release any SMS the lead sent during the call.
            active_call_id: null,
          })
          .eq("id", executionId)
          .eq("client_id", client.id);
        if (callId) execUpdate = execUpdate.eq("active_call_id", callId);
        const { error: execErr } = await execUpdate;
        if (execErr) {
          // CRITICAL: runEngagement polls last_call_outcome to break its wait loop
          // and decide advance-vs-terminate. If this write is lost, the cadence
          // hangs or mis-classifies as a missed call. Return non-2xx so Retell
          // retries the webhook rather than silently dropping the outcome.
          console.error(
            `retell-call-webhook: CRITICAL last_call_outcome write failed for exec ${executionId}: ${execErr.message}`
          );
          // REL-06: this is the failure that hangs/mis-classifies the cadence
          // wait loop — make it visible to alerting before asking Retell to retry.
          try {
            await internalSupabase.from("error_logs").insert({
              client_id: client.id,
              lead_id: contactId || null,
              execution_id: executionId,
              severity: "error",
              source: "retell_call_webhook",
              error_type: "last_call_outcome_write_failed",
              error_message: execErr.message,
              context: { call_id: callId, event: payload.event },
            });
          } catch (_logErr) { /* non-fatal */ }
          return new Response(
            JSON.stringify({ error: "Failed to persist call outcome", retry: true }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          outcomePersisted = true;
          console.log(
            `📞 last_call_outcome stamped on exec ${executionId} (call_id=${callId}, reason=${call.disconnection_reason || "?"})`
          );
        }
      }
    }

    if (!client.supabase_url || !client.supabase_service_key) {
      console.warn(`Client ${client.id} has no external Supabase configured`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_external_db" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the voice_call_history record from Retell call data
    const durationMs = call.duration_ms ?? call.call_duration_ms ?? null;
    const durationSeconds = typeof durationMs === "number" ? Math.round(durationMs / 1000) : null;

    const record: Record<string, unknown> = {
      call_id: call.call_id || call.id,
      client_id: client.id,
      agent_id: agentId,
      setter_id: setterId,
      call_type: call.call_type || call.direction || null,
      from_number: call.from_number || null,
      to_number: call.to_number || null,
      direction: call.direction || call.call_type || null,
      call_status: call.call_status || call.status || "completed",
      start_timestamp: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : null,
      end_timestamp: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : null,
      duration_ms: durationMs,
      duration_seconds: durationSeconds,
      transcript: call.transcript || null,
      transcript_object: call.transcript_object ? JSON.stringify(call.transcript_object) : null,
      recording_url: call.recording_url || null,
      public_log_url: call.public_log_url || null,
      disconnection_reason: call.disconnection_reason || null,
      call_analysis: call.call_analysis ? JSON.stringify(call.call_analysis) : null,
      call_summary: call.call_analysis?.call_summary || null,
      user_sentiment: call.call_analysis?.user_sentiment || null,
      call_successful: call.call_analysis?.call_successful ?? null,
      custom_analysis_data: call.call_analysis?.custom_analysis_data
        ? JSON.stringify(call.call_analysis.custom_analysis_data)
        : null,
      latency_ms: call.latency ? JSON.stringify(call.latency) : null,
      cost: call.cost ?? (typeof call.call_cost?.combined_cost === "number" ? Math.round(call.call_cost.combined_cost) / 100 : null),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log(`📦 Pushing call ${record.call_id} to external call_history for client ${client.id}`);

    const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);

    // Use upsert with column-stripping fallback (external table may not have all columns)
    const mutableRecord = { ...record };
    const maxRetries = 10;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { error } = await externalSupabase
        .from("call_history")
        .upsert(mutableRecord, { onConflict: "call_id" });

      if (!error) {
        console.log(`✅ Call ${record.call_id} synced to call_history`);
        return new Response(
          JSON.stringify({ ok: true, synced: true, call_id: record.call_id }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if it's a missing column error — strip and retry
      const msg = error.message || "";
      const colMatch =
        msg.match(/Could not find the '([^']+)' column/) ||
        msg.match(/column "([^"]+)" of relation "[^"]+" does not exist/);

      if (colMatch) {
        const badCol = colMatch[1];
        if (Object.prototype.hasOwnProperty.call(mutableRecord, badCol)) {
          console.warn(`Stripping unsupported column '${badCol}' from call_history push`);
          delete mutableRecord[badCol];
          continue;
        }
      }

      // If upsert fails because there's no unique constraint on call_id, try plain insert
      if (msg.includes("ON CONFLICT") || msg.includes("there is no unique")) {
        console.warn("No unique constraint on call_id, falling back to insert");
        const { error: insertErr } = await externalSupabase
          .from("call_history")
          .insert(mutableRecord);
        if (!insertErr) {
          console.log(`✅ Call ${record.call_id} inserted into call_history`);
          return new Response(
            JSON.stringify({ ok: true, synced: true, call_id: record.call_id }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        lastError = insertErr.message;
        break;
      }

      lastError = msg;
      break;
    }

    console.error(`❌ Failed to sync call to call_history: ${lastError}`);
    // REL-06: record the terminal sync miss. Status code depends on what this
    // request already accomplished: when the cadence-critical write
    // (last_call_outcome) was persisted, return 200 so Retell does NOT retry
    // the whole webhook (re-running the leads upsert + outcome stamp) for a
    // non-critical external mirror. For call_analyzed (and call_ended without
    // an execution_id) the external sync is the ONLY persistence of the
    // transcript/analysis, so keep the 500 and let Retell redeliver.
    try {
      await internalSupabase.from("error_logs").insert({
        client_id: client.id,
        lead_id: contactId || null,
        severity: "error",
        source: "retell_call_webhook",
        error_type: "external_call_history_sync_failed",
        error_message: lastError ?? "unknown",
        context: { call_id: record.call_id ?? null, event: payload.event, outcome_persisted: outcomePersisted },
      });
    } catch (_logErr) { /* non-fatal */ }
    return new Response(
      JSON.stringify({ ok: false, error: lastError }),
      { status: outcomePersisted ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Retell call webhook error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
