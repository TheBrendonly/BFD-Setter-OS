import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
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

    // Find client by matching the agent_id across all 10 agent slots
    const { data: clients, error: clientErr } = await internalSupabase
      .from("clients")
      .select("id, supabase_url, supabase_service_key")
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
      }
    }

    // Bug 1 — cadence coordination. On call_ended, stamp the outcome onto
    // the engagement_execution that placed this call so runEngagement.ts can
    // break its poll loop and decide whether to advance (missed → next
    // channel sends the missed-call SMS) or terminate (human pickup +
    // treat_pickup_as_reply → stop_reason='call_engaged').
    if (payload.event === "call_ended") {
      const executionId: string | null = (dynamicVars.execution_id as string | undefined) || null;
      if (executionId) {
        const callId = call.call_id || call.id || null;
        const { error: execErr } = await internalSupabase
          .from("engagement_executions")
          .update({
            last_call_outcome: {
              call_id: callId,
              disconnect_reason: call.disconnection_reason || null,
              call_status: call.call_status || call.status || null,
              ended_at: new Date().toISOString(),
            },
          })
          .eq("id", executionId);
        if (execErr) {
          console.warn(
            `retell-call-webhook: last_call_outcome write failed for exec ${executionId}: ${execErr.message}`
          );
        } else {
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
    return new Response(
      JSON.stringify({ ok: false, error: lastError }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
