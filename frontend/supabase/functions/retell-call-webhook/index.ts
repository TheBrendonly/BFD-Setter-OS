import { createClient } from "npm:@supabase/supabase-js@2.101.0";
// Retell signature verification (correct v={ts},d=HMAC(body+ts, API_KEY) scheme,
// 5-min window). Shared across the 3 Retell webhooks. The stored secret value is
// the Retell API key. Verify-if-present.
import { verifyRetellSignature } from "../_shared/verify-webhook.ts";
import { buildCostEvent } from "../_shared/costEvents.ts";

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

    // Dynamic vars carry the tenant/contact/execution identity Retell echoes back.
    // Extracted early so we can (a) disambiguate a shared master agent below and
    // (b) bump leads.last_message_at even when no external Supabase is configured.
    const dynamicVars = call.retell_llm_dynamic_variables || call.dynamic_variables || {};
    const setterId: string | null = dynamicVars.voice_setter_id || null;
    const contactId: string | null =
      dynamicVars.contact_id || dynamicVars.Contact_ID || dynamicVars.Lead_ID || null;

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
      .select("id, ghl_location_id, supabase_url, supabase_service_key, retell_webhook_secret, missed_call_textback_enabled, twilio_account_sid, twilio_auth_token, twilio_default_phone, retell_phone_1")
      .or(
        `retell_inbound_agent_id.eq.${agentId},retell_outbound_agent_id.eq.${agentId},retell_outbound_followup_agent_id.eq.${agentId},retell_agent_id_4.eq.${agentId},retell_agent_id_5.eq.${agentId},retell_agent_id_6.eq.${agentId},retell_agent_id_7.eq.${agentId},retell_agent_id_8.eq.${agentId},retell_agent_id_9.eq.${agentId},retell_agent_id_10.eq.${agentId}`
      );

    if (clientErr || !clients || clients.length === 0) {
      console.warn(`No client found for agent_id ${agentId}`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_client" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Disambiguate when one agent_id is shared across tenants (master agent): the
    // .or() above can return >1 row. Prefer the tenant whose GHL location matches the
    // call's ghl_account_id dynamic var (ghl_location_id is UNIQUE → 1:1 with a tenant).
    // Fall back to the first row but LOG the ambiguity so it's visible as clients grow.
    let client = clients[0];
    if (clients.length > 1) {
      const ghlAccountId =
        typeof dynamicVars.ghl_account_id === "string" && dynamicVars.ghl_account_id
          ? dynamicVars.ghl_account_id
          : null;
      const matched = ghlAccountId
        ? clients.find((c) => c.ghl_location_id === ghlAccountId)
        : null;
      if (matched) {
        client = matched;
      } else {
        console.warn(
          `retell-call-webhook: agent_id ${agentId} maps to ${clients.length} clients; ` +
            `ghl_account_id=${ghlAccountId ?? "(none)"} did not disambiguate — falling back to ${clients[0].id}`
        );
        try {
          await internalSupabase.from("error_logs").insert({
            client_id: clients[0].id,
            severity: "warning",
            source: "retell_call_webhook",
            error_type: "ambiguous_agent_match",
            error_message: `agent_id ${agentId} matched ${clients.length} clients; ghl_account_id=${ghlAccountId ?? "none"}`,
            context: {
              agent_id: agentId,
              candidate_client_ids: clients.map((c) => c.id),
              ghl_account_id: ghlAccountId,
            },
          });
        } catch (_logErr) {
          /* non-fatal */
        }
      }
    }

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

    // ── F16(c) missed-call text-back ──────────────────────────────────────────
    // An inbound call that abandoned quickly (caller hung up before engaging, or
    // a technical drop) triggers an SMS back from our number into the SMS booking
    // engine. Inbound voice is Retell-terminated (the number is imported into
    // Retell, so there is NO Twilio voice webhook), so this is driven off the
    // Retell call disposition. Best-effort, never throws. Per-client opt-in
    // (default OFF). Fires once (call_ended only) and dedupes on the caller phone.
    if (
      payload.event === "call_ended" &&
      (client as { missed_call_textback_enabled?: boolean }).missed_call_textback_enabled === true
    ) {
      try {
        const dir = String(call.direction || call.call_type || "").toLowerCase();
        const inbound = dir.includes("inbound");
        const durMs = call.duration_ms ?? call.call_duration_ms ?? null;
        const durSec = typeof durMs === "number" ? Math.round(durMs / 1000) : null;
        const fromNum = typeof call.from_number === "string" ? call.from_number : null;
        // "Missed" = an inbound call that never really engaged (very short). A
        // genuine booking conversation runs far longer than 20s.
        const abandoned = inbound && !!fromNum && (durSec === null || durSec < 20);
        const cc = client as {
          twilio_account_sid?: string | null; twilio_auth_token?: string | null;
          twilio_default_phone?: string | null; retell_phone_1?: string | null;
        };
        const twilioSid = cc.twilio_account_sid;
        const twilioAuth = cc.twilio_auth_token;
        const fromSetter = cc.twilio_default_phone || cc.retell_phone_1 ||
          (typeof call.to_number === "string" ? call.to_number : null);
        if (abandoned && twilioSid && twilioAuth && fromSetter) {
          // Dedupe: skip if we already texted this caller back in the last 15 min
          // (repeat abandons + the answered-elsewhere / already-in-conversation race).
          const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
          const { data: recent } = await internalSupabase
            .from("message_queue")
            .select("id")
            .eq("channel", "sms_outbound")
            .eq("contact_phone", fromNum)
            .gte("created_at", since)
            .limit(1)
            .maybeSingle();
          if (!recent) {
            const bodyText =
              "Sorry we missed you just now! Happy to help over text: what were you after, and would you like me to book you a time?";
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
            const resp = await fetch(twilioUrl, {
              method: "POST",
              headers: {
                Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({ To: fromNum as string, From: fromSetter, Body: bodyText }).toString(),
            });
            const tj = await resp.json().catch(() => ({} as Record<string, unknown>));
            if (resp.ok) {
              await internalSupabase.from("message_queue").insert({
                client_id: client.id,
                lead_id: contactId || (fromNum as string),
                ghl_contact_id: contactId || null,
                ghl_account_id: (client.ghl_location_id as string | null) || client.id,
                channel: "sms_outbound",
                message_body: bodyText,
                contact_phone: fromNum,
                twilio_message_sid: (tj as { sid?: string }).sid ?? null,
                processed: true,
              });
              console.log(`retell-call-webhook: F16(c) missed-call text-back sent to ${fromNum} (call ${call.call_id ?? "?"})`);
            } else {
              console.warn(
                `retell-call-webhook: F16(c) Twilio send failed: ${(tj as { code?: unknown }).code ?? "?"} ${(tj as { message?: unknown }).message ?? ""}`,
              );
            }
          }
        }
      } catch (mcErr) {
        console.warn("retell-call-webhook: F16(c) missed-call text-back failed (non-fatal):", (mcErr as Error).message);
      }
    }

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
      const callId = call.call_id || call.id || null;
      if (executionId && !callId) {
        // A legit Retell call_ended always carries a call_id. Without it we cannot bind
        // the stamp to the real in-flight call, so refuse to stamp — a forged call_ended
        // with a guessed execution_id but no call_id must not clear/pollute a hold.
        console.warn(
          `retell-call-webhook: call_ended for exec ${executionId} has no call_id — refusing to stamp outcome.`
        );
      } else if (executionId) {
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
        // active_call_id bind is mandatory here (callId is non-null in this branch).
        execUpdate = execUpdate.eq("active_call_id", callId);
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

    // Session P2 — per-execution cost ledger (PLATFORM db via internalSupabase; the
    // call_history push below goes to the client's EXTERNAL db). Voice cost is real
    // (Retell). Idempotent via UNIQUE(cost_kind, provider_ref): this webhook and
    // retell-call-analysis-webhook both fire for the same call_id and both upsert the
    // same row. Best-effort — a cost-write failure must not affect the call sync.
    try {
      const voiceCostUsd = typeof record.cost === "number" ? record.cost : null;
      const voiceCallId = typeof record.call_id === "string" ? record.call_id : null;
      if (voiceCostUsd != null && voiceCostUsd > 0 && voiceCallId) {
        const minutes = typeof durationMs === "number" && durationMs > 0
          ? Math.round((durationMs / 60000) * 1000) / 1000
          : null;
        const costRow = buildCostEvent("voice", {
          clientId: client.id,
          executionId: (dynamicVars.execution_id as string | undefined) || null,
          leadId: contactId,
          providerRef: voiceCallId,
          quantity: minutes,
          unit: "minutes",
          costUsd: voiceCostUsd,
          isEstimated: false,
        });
        const { error: costErr } = await internalSupabase
          .from("execution_cost_events")
          .upsert(costRow, { onConflict: "cost_kind,provider_ref" });
        if (costErr) console.warn(`execution_cost_events voice write failed (non-fatal): ${costErr.message}`);
      }
    } catch (costEx) {
      console.warn(`execution_cost_events voice write threw (non-fatal): ${(costEx as Error).message}`);
    }

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
