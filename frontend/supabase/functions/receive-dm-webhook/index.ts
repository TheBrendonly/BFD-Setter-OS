import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-signature, x-wh-token",
};

// Constant-time string compare for the static-token webhook proof.
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Phase 8a — GHL Webhook V2 signature verification (HMAC-SHA256 over raw
// body, hex-encoded). Verification only kicks in when the calling
// client has clients.ghl_webhook_secret set; otherwise backwards-compat
// V1 query-string POSTs still work.
async function verifyGhlSignature(
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

type TriggerProcessMessagesParams = {
  contactId: string;
  ghlAccountId: string;
  name: string;
  email: string;
  phone: string;
  setterNumber: string;
  executionId: string;
  debounceSeconds: number;
  triggerKey: string;
};

async function parseJsonSafely(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function buildResumeAt(delaySeconds: number) {
  return new Date(Date.now() + Math.max(0, delaySeconds) * 1000).toISOString();
}

async function cancelTriggerRun(runId: string | null | undefined, triggerKey: string) {
  if (!runId || runId === "unknown") return;

  try {
    const cancelResponse = await fetch(
      `https://api.trigger.dev/api/v2/runs/${runId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${triggerKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!cancelResponse.ok && cancelResponse.status !== 404) {
      const cancelBody = await cancelResponse.text();
      console.warn("Failed to cancel previous Trigger.dev run", {
        runId,
        status: cancelResponse.status,
        body: cancelBody,
      });
    }
  } catch (error) {
    console.warn("Error canceling previous Trigger.dev run", { runId, error });
  }
}

async function triggerProcessMessages({
  contactId,
  ghlAccountId,
  name,
  email,
  phone,
  setterNumber,
  executionId,
  debounceSeconds,
  triggerKey,
}: TriggerProcessMessagesParams) {
  const triggerResponse = await fetch(
    "https://api.trigger.dev/api/v1/tasks/process-messages/trigger",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${triggerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          lead_id: contactId,
          ghl_account_id: ghlAccountId,
          contact_name: name,
          contact_email: email,
          contact_phone: phone,
          setter_number: setterNumber,
          execution_id: executionId,
          debounce_seconds: debounceSeconds,
        },
      }),
    }
  );

  const triggerData = await parseJsonSafely(triggerResponse);

  if (!triggerResponse.ok) {
    console.error("Trigger.dev error:", triggerData);
    return {
      ok: false,
      error: triggerData,
    };
  }

  const runId = triggerData?.id || triggerData?.run?.id || null;

  if (!runId) {
    return {
      ok: false,
      error: { message: "Trigger.dev did not return a run ID", triggerData },
    };
  }

  return {
    ok: true,
    runId,
    triggerData,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const contactId = url.searchParams.get("Lead_ID") || url.searchParams.get("Contact_ID");
    const ghlAccountId = url.searchParams.get("GHL_Account_ID");
    const messageBody = url.searchParams.get("Message_Body");
    const name = url.searchParams.get("Name") || "Unknown";
    const email = url.searchParams.get("Email") || "";
    const phone = url.searchParams.get("Phone") || "";
    const setterNumber = url.searchParams.get("Setter_Number") || "";
    const channelParam = url.searchParams.get("Channel") || url.searchParams.get("channel") || null;
    const setterSlotId = setterNumber ? `Setter-${setterNumber}` : null;

    if (!contactId || !ghlAccountId || !messageBody) {
      // Log malformed request to error_logs
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        try {
          const logClient = createClient(supabaseUrl, serviceKey);
          await logClient.from("error_logs").insert({
            error_type: "missing_params",
            severity: "error",
            client_ghl_account_id: ghlAccountId ?? "unknown",
            lead_id: contactId ?? null,
            error_message: "Missing required params: Lead_ID, GHL_Account_ID, or Message_Body",
            context: {
              received_params: Object.fromEntries(url.searchParams.entries()),
            },
          });
        } catch (logErr) {
          console.error("Failed to log missing params error:", logErr);
        }
      }
      return new Response(
        JSON.stringify({ error: "Missing required parameters: Lead_ID, GHL_Account_ID, Message_Body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);

    // Cancel any pending follow-up timers for this contact
    await supabase
      .from('followup_timers')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('lead_id', contactId)
      .eq('ghl_account_id', ghlAccountId)
      .eq('status', 'pending');

    // Cancel any active engagement executions for this contact (reply detection).
    // engagement_executions stores the GHL contact id under ghl_contact_id, not
    // lead_id (the column doesn't exist). Phase 4c fix.
    const { data: activeEngagements } = await supabase
      .from("engagement_executions")
      .select("id, trigger_run_id, campaign_id, ghl_contact_id, client_id")
      .eq("ghl_contact_id", contactId)
      .eq("ghl_account_id", ghlAccountId)
      .in("status", ["pending", "running", "waiting"])
      .order("started_at", { ascending: false });

    if (activeEngagements && activeEngagements.length > 0 && triggerKey) {
      for (const eng of activeEngagements) {
        // Cancel Trigger.dev run
        if (eng.trigger_run_id) {
          try {
            await fetch(
              `https://api.trigger.dev/api/v2/runs/${eng.trigger_run_id}/cancel`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${triggerKey}`,
                  "Content-Type": "application/json",
                },
              }
            );
          } catch (cancelErr) {
            console.warn("Failed to cancel engagement run:", eng.id, cancelErr);
          }
        }

        // Mark as replied with the canonical Phase 4c stop_reason
        await supabase
          .from("engagement_executions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            stop_reason: "inbound_reply",
          })
          .eq("id", eng.id);

        // Log reply_received event to campaign_events if campaign_id exists
        if (eng.campaign_id) {
          try {
            // Determine reply channel from the last message_sent event for this execution
            let replyChannel: string | null = null;
            const { data: lastSent } = await supabase
              .from("campaign_events")
              .select("channel")
              .eq("execution_id", eng.id)
              .eq("event_type", "message_sent")
              .order("occurred_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (lastSent?.channel) replyChannel = lastSent.channel;

            await supabase.from("campaign_events").insert({
              client_id: eng.client_id,
              campaign_id: eng.campaign_id,
              execution_id: eng.id,
              lead_id: eng.ghl_contact_id,
              event_type: "reply_received",
              channel: replyChannel,
              occurred_at: new Date().toISOString(),
            });
          } catch (evtErr) {
            console.warn("Failed to log campaign reply event:", evtErr);
          }
        }

        console.info("Engagement execution cancelled due to reply", {
          executionId: eng.id,
          contactId,
          ghlAccountId,
        });
      }
    }

    // Detect replies to recently finished executions (sequence ended but lead replied later)
    // Only count if: no reply already recorded, and the last message was sent within 10 days.
    if (!activeEngagements || activeEngagements.length === 0) {
      const { data: recentFinished } = await supabase
        .from("engagement_executions")
        .select("id, campaign_id, ghl_contact_id, client_id, status, stop_reason, last_sms_sent_at, completed_at")
        .eq("ghl_contact_id", contactId)
        .eq("ghl_account_id", ghlAccountId)
        .in("status", ["completed"])
        .not("last_sms_sent_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentFinished && recentFinished.campaign_id && recentFinished.last_sms_sent_at) {
        const lastSentAt = new Date(recentFinished.last_sms_sent_at).getTime();
        const daysSinceLastSent = (Date.now() - lastSentAt) / (1000 * 60 * 60 * 24);

        if (daysSinceLastSent <= 10) {
          const { data: existingReply } = await supabase
            .from("campaign_events")
            .select("id")
            .eq("execution_id", recentFinished.id)
            .eq("event_type", "reply_received")
            .limit(1)
            .maybeSingle();

          if (!existingReply) {
            await supabase
              .from("engagement_executions")
              .update({ stop_reason: "inbound_reply" })
              .eq("id", recentFinished.id);

            try {
              // Determine reply channel from the last message_sent event
              let lateReplyChannel: string | null = null;
              const { data: lastSentLate } = await supabase
                .from("campaign_events")
                .select("channel")
                .eq("execution_id", recentFinished.id)
                .eq("event_type", "message_sent")
                .order("occurred_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (lastSentLate?.channel) lateReplyChannel = lastSentLate.channel;

              await supabase.from("campaign_events").insert({
                client_id: recentFinished.client_id,
                campaign_id: recentFinished.campaign_id,
                execution_id: recentFinished.id,
                lead_id: recentFinished.ghl_contact_id,
                event_type: "reply_received",
                channel: lateReplyChannel,
                occurred_at: new Date().toISOString(),
              });
            } catch (evtErr) {
              console.warn("Failed to log late reply campaign event:", evtErr);
            }

            console.info("Late reply detected for finished engagement", {
              executionId: recentFinished.id,
              contactId,
              daysSinceLastSent: daysSinceLastSent.toFixed(1),
            });
          }
        }
      }
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, dm_enabled, debounce_seconds, supabase_url, supabase_service_key, ghl_webhook_secret")
      .eq("ghl_location_id", ghlAccountId)
      .maybeSingle();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found for GHL_Account_ID: " + ghlAccountId }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify-if-present webhook auth. Two accepted proofs (mirrors
    // sync-ghl-contact): a static `x-wh-token` header equal to the secret
    // (GHL Workflow Custom-Webhook custom header, SOP §5.3) or an HMAC-SHA256
    // `x-wh-signature` over the raw body. No secret => skip (backwards-compat,
    // V1 query-string posts still work). GHL *native* Webhook V2 signs with
    // RSA and is NOT supported.
    if (client.ghl_webhook_secret) {
      const secret = client.ghl_webhook_secret as string;
      const tokenOk = ctEqual(req.headers.get("x-wh-token") ?? "", secret);
      let sigOk = tokenOk;
      const sigHeader = req.headers.get("x-wh-signature");
      if (!sigOk && sigHeader) {
        // V2-style signed JSON body; clone request to read it
        const rawBody = await req.clone().text().catch(() => "");
        sigOk = await verifyGhlSignature(rawBody, sigHeader, secret);
      }
      if (!sigOk) {
        console.warn("receive-dm-webhook: webhook auth failed", { clientId: client.id, ghlAccountId });
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!client.dm_enabled) {
      return new Response(
        JSON.stringify({ error: "Process DMs is disabled for this client" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if setter is stopped for this lead
    const { data: leadRow } = await supabase
      .from("leads")
      .select("setter_stopped")
      .eq("lead_id", contactId)
      .eq("client_id", client.id)
      .maybeSingle();

    if (leadRow?.setter_stopped) {
      console.info("Setter stopped for lead, writing message to chat_history only", { contactId, ghlAccountId });

      const nowTimestamp = new Date().toISOString();

      // Write the inbound message to external Supabase chat_history so it's visible in the UI
      if (client.supabase_url && client.supabase_service_key) {
        try {
          const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);
          const messagePayload = {
            type: "human",
            content: messageBody,
            additional_kwargs: {},
            response_metadata: {},
          };

          await externalSupabase.from("chat_history").insert({
            session_id: contactId,
            message: messagePayload,
            timestamp: nowTimestamp,
          });
        } catch (extErr) {
          console.error("Failed to write inbound message to external Supabase:", extErr);
        }
      }

      // Upsert lead row + bump last_message_at/preview so the frontend detects the new message
      const stoppedNameParts = (name || "").split(" ").filter(Boolean);
      await supabase
        .from("leads")
        .upsert({
          client_id: client.id,
          lead_id: contactId,
          first_name: stoppedNameParts[0] ?? null,
          last_name: stoppedNameParts.slice(1).join(" ") || null,
          phone: phone || null,
          email: email || null,
          last_message_at: nowTimestamp,
          last_message_preview: (messageBody || "").substring(0, 200),
        }, { onConflict: "client_id,lead_id" });

      return new Response(
        JSON.stringify({ status: "setter_stopped", message: "Setter is stopped for this lead. Message recorded but AI processing skipped." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const legacyClientDelay = client.debounce_seconds ?? 60;
    let debounceSeconds = setterSlotId ? 60 : legacyClientDelay;
    let delaySource = setterSlotId ? "default" : (client.debounce_seconds != null ? "legacy_client" : "default");

    if (setterSlotId) {
      const { data: agentSetting } = await supabase
        .from("agent_settings")
        .select("response_delay_seconds")
        .eq("client_id", client.id)
        .eq("slot_id", setterSlotId)
        .maybeSingle();

      if (agentSetting?.response_delay_seconds != null) {
        debounceSeconds = agentSetting.response_delay_seconds;
        delaySource = "agent_settings";
      }
    }

    const nowISO = new Date().toISOString();
    const resumeAt = buildResumeAt(debounceSeconds);

    const triggerPayload = {
      Lead_ID: contactId,
      GHL_Account_ID: ghlAccountId,
      Message_Body: messageBody,
      Name: name,
      Email: email,
      Phone: phone,
      Setter_Number: setterNumber,
      Setter_Slot_Id: setterSlotId,
      Applied_Delay_Seconds: debounceSeconds,
      Delay_Source: delaySource,
      received_at: nowISO,
    };

    console.info("Resolved DM delay", {
      contactId,
      ghlAccountId,
      setterNumber,
      setterSlotId,
      debounceSeconds,
      delaySource,
    });

    const { data: activeRun } = await supabase
      .from("active_trigger_runs")
      .select("id, trigger_run_id, created_at")
      .eq("lead_id", contactId)
      .eq("ghl_account_id", ghlAccountId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error: mqError } = await supabase.from("message_queue").insert({
      lead_id: contactId,
      ghl_account_id: ghlAccountId,
      message_body: messageBody,
      contact_name: name,
      contact_email: email,
      contact_phone: phone,
      channel: channelParam,
    });

    if (mqError) {
      console.error("Failed to insert message_queue:", mqError);
    }

    // Upsert lead row + bump last_message_at/preview so Chats page surfaces the conversation
    const nameParts = (name || "").split(" ").filter(Boolean);
    await supabase
      .from("leads")
      .upsert({
        client_id: client.id,
        lead_id: contactId,
        first_name: nameParts[0] ?? null,
        last_name: nameParts.slice(1).join(" ") || null,
        phone: phone || null,
        email: email || null,
        last_message_at: nowISO,
        last_message_preview: (messageBody || "").substring(0, 200),
      }, { onConflict: "client_id,lead_id" });

    if (!triggerKey) {
      console.error("TRIGGER_SECRET_KEY not set");
      return new Response(
        JSON.stringify({ error: "Trigger secret key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let executionId: string | null = null;
    let reusingExecution = false;
    let nextMessageCount = 1;
    let originalResumeAt: string | null = null;

    if (activeRun?.trigger_run_id) {
      const { data: existingExec } = await supabase
        .from("dm_executions")
        .select("id, status, messages_received, trigger_payload, resume_at")
        .eq("trigger_run_id", activeRun.trigger_run_id)
        .maybeSingle();

      if (existingExec && !["completed", "failed"].includes(existingExec.status || "")) {
        reusingExecution = true;
        executionId = existingExec.id;
        originalResumeAt = existingExec.resume_at;
        nextMessageCount = (existingExec.messages_received || 1) + 1;
        const previousPayload = existingExec.trigger_payload && typeof existingExec.trigger_payload === "object"
          ? existingExec.trigger_payload
          : {};

        // Fixed window: do NOT reset resume_at — keep the original deadline
        await supabase
          .from("dm_executions")
          .update({
            messages_received: nextMessageCount,
            trigger_payload: {
              ...previousPayload,
              ...triggerPayload,
            },
            stage_description: `${nextMessageCount} messages received — grouping until original window expires.`,
          })
          .eq("id", existingExec.id);
      }

      await cancelTriggerRun(activeRun.trigger_run_id, triggerKey);
    }

    if (!executionId) {
      const { data: execution, error: execError } = await supabase
        .from("dm_executions")
        .insert({
          lead_id: contactId,
          ghl_account_id: ghlAccountId,
          contact_name: name,
          status: "waiting",
          messages_received: 1,
          trigger_payload: triggerPayload,
          resume_at: resumeAt,
          channel: channelParam,
          stage_description: `Waiting ${debounceSeconds}s for more messages...`,
        })
        .select("id")
        .single();

      if (execError || !execution) {
        console.error("Failed to create dm_execution:", execError);
        return new Response(
          JSON.stringify({ error: "Failed to create execution record" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      executionId = execution.id;
    }

    // For fixed-window: if reusing, calculate remaining seconds from original resume_at
    const effectiveResumeAt = reusingExecution && originalResumeAt ? originalResumeAt : resumeAt;
    const remainingMs = new Date(effectiveResumeAt).getTime() - Date.now();
    const effectiveDebounce = Math.max(1, Math.ceil(remainingMs / 1000));

    const triggerResult = await triggerProcessMessages({
      contactId,
      ghlAccountId,
      name,
      email,
      phone,
      setterNumber,
      executionId,
      debounceSeconds: effectiveDebounce,
      triggerKey,
    });

    if (!triggerResult.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to trigger task", details: triggerResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runId = triggerResult.runId;

    if (activeRun?.id) {
      await supabase
        .from("active_trigger_runs")
        .update({ trigger_run_id: runId })
        .eq("id", activeRun.id);
    } else {
      await supabase.from("active_trigger_runs").insert({
        lead_id: contactId,
        ghl_account_id: ghlAccountId,
        trigger_run_id: runId,
      });
    }

    // Only update trigger_run_id and stage — do NOT re-set resume_at to avoid UI timer restart
    const finalUpdate: Record<string, unknown> = {
      trigger_run_id: runId,
      stage_description: reusingExecution
        ? `${nextMessageCount} messages received — ${effectiveDebounce}s remaining in window.`
        : `Waiting ${debounceSeconds}s for more messages...`,
    };

    await supabase
      .from("dm_executions")
      .update(finalUpdate)
      .eq("id", executionId);

    console.info("DM run armed", {
      executionId,
      runId,
      reusingExecution,
      debounceSeconds,
      setterSlotId,
    });

    return new Response(
      JSON.stringify({
        status: reusingExecution ? "restarted" : "triggered",
        run_id: runId,
        execution_id: executionId,
        delay_seconds: debounceSeconds,
        setter_slot_id: setterSlotId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("receive-dm-webhook error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});