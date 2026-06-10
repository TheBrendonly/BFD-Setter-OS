// receive-twilio-sms — public Twilio SMS webhook for direct (non-GHL) inbound.
//
// Mirrors the structure of receive-dm-webhook (q-string GHL contract) but
// adapts to Twilio's form-encoded POST contract. Used by Option D — bypassing
// the GHL phone system because the agency-level GHL sub-account doesn't allow
// BYO Twilio.
//
// Flow:
//   1. Parse form-urlencoded body (From, Body, To, MessageSid, MessageStatus).
//   2. Verify Twilio signature (HMAC-SHA1 of full URL + sorted form params,
//      signed with the per-client Auth Token from clients.twilio_auth_token).
//      Override with SKIP_TWILIO_SIG_CHECK=true env for first-test bring-up only.
//   3. Resolve client by clients.retell_phone_1 = To.
//   4. Find or create GHL contact for the From phone.
//   5. Mirror receive-dm-webhook: insert message_queue + dm_executions +
//      active_trigger_runs + fire process-messages Trigger.dev task.
//   6. Return empty TwiML (Twilio expects <Response/>).

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { pushSmsToGhl } from "../_shared/ghl-conversations.ts";

// Schedule a fire-and-forget GHL mirror that completes after the TwiML response
// returns. EdgeRuntime.waitUntil keeps the runtime alive past the response so
// the fetch isn't cancelled. Falls back to a plain async call (best-effort) if
// the runtime doesn't expose waitUntil.
function scheduleGhlMirror(p: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(p);
  } else {
    p.catch(() => {});
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const TWIML_EMPTY =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Phase 4a — STOP / opt-out keyword regexes. Match common variants;
// a leading/trailing period is tolerated.
const STOP_KEYWORDS_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|opt[- ]?out)\s*\.?\s*$/i;
const START_KEYWORDS_RE = /^\s*(start|unstop|resubscribe|yes)\s*\.?\s*$/i;
const STOP_REPLY = "You've been unsubscribed. Reply START to resubscribe.";
const START_REPLY = "You've been resubscribed. Reply STOP to opt out at any time.";

// Send a one-shot Twilio outbound (used for STOP/START compliance replies)
async function sendTwilioCompliance(args: {
  twilioSid: string | null;
  twilioAuth: string | null;
  fromNumber: string;
  toNumber: string;
  body: string;
}): Promise<void> {
  const { twilioSid, twilioAuth, fromNumber, toNumber, body } = args;
  if (!twilioSid || !twilioAuth) {
    console.warn("sendTwilioCompliance skipped: missing twilio creds");
    return;
  }
  try {
    const supabaseUrlEnv = Deno.env.get("SUPABASE_URL");
    const statusCallbackUrl = supabaseUrlEnv
      ? `${supabaseUrlEnv.replace(/\/$/, "")}/functions/v1/twilio-status-webhook`
      : null;
    const fields: Record<string, string> = { From: fromNumber, To: toNumber, Body: body };
    if (statusCallbackUrl) fields.StatusCallback = statusCallbackUrl;
    const params = new URLSearchParams(fields);
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
        },
        body: params.toString(),
      },
    );
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      console.warn(`sendTwilioCompliance failed ${r.status}: ${errBody.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn("sendTwilioCompliance threw", e);
  }
}

// Phase 4c — cancel any active engagement_executions for this lead.
// Triggered by mid-cadence reply OR by STOP keyword. Uses ghl_contact_id
// (the canonical column on engagement_executions; receive-dm-webhook used
// to query a non-existent `lead_id` column — silently broken).
async function endActiveCadences(args: {
  supabase: any;
  clientId: string;
  ghlContactId: string;
  ghlAccountId: string;
  triggerKey: string | null;
  stopReason: "inbound_reply" | "opt_out";
}): Promise<number> {
  const { supabase, ghlContactId, ghlAccountId, triggerKey, stopReason } = args;
  const { data: active, error } = await supabase
    .from("engagement_executions")
    .select("id, trigger_run_id, campaign_id, client_id")
    .eq("ghl_contact_id", ghlContactId)
    .eq("ghl_account_id", ghlAccountId)
    .in("status", ["pending", "running", "waiting"]);
  if (error) {
    console.warn("endActiveCadences select failed", error);
    return 0;
  }
  if (!active || active.length === 0) return 0;

  for (const exec of active) {
    await supabase
      .from("engagement_executions")
      .update({
        status: stopReason === "opt_out" ? "cancelled" : "completed",
        stop_reason: stopReason,
        completed_at: new Date().toISOString(),
        stage_description: stopReason === "opt_out"
          ? "Cancelled — lead opted out."
          : "Lead replied — engagement complete.",
        // Batch 3 — code-review fix. Tag the channel that delivered the
        // terminating signal so the reactivation dashboard credits the
        // right channel instead of guessing from cadence_metrics send
        // counts (which double-counted multi-channel runs). endActiveCadences
        // is currently only called from inbound-SMS paths; future inbound
        // email / voice termination paths should set their own channel.
        reply_channel: stopReason === "opt_out" ? null : "sms",
      })
      .eq("id", exec.id);
    if (exec.trigger_run_id && triggerKey) {
      await cancelTriggerRun(exec.trigger_run_id, triggerKey);
    }
    if (exec.campaign_id) {
      try {
        await supabase.from("campaign_events").insert({
          client_id: exec.client_id,
          campaign_id: exec.campaign_id,
          execution_id: exec.id,
          lead_id: ghlContactId,
          event_type: stopReason === "opt_out" ? "opt_out" : "reply_received",
          occurred_at: new Date().toISOString(),
        });
      } catch (evtErr) {
        console.warn("endActiveCadences campaign_events insert failed", evtErr);
      }
    }
  }
  console.info("endActiveCadences cancelled", {
    count: active.length,
    ghlContactId,
    stopReason,
  });
  return active.length;
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
  if (!text) return null;
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
    const r = await fetch(
      `https://api.trigger.dev/api/v2/runs/${runId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${triggerKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!r.ok && r.status !== 404) {
      console.warn("cancelTriggerRun non-OK", { runId, status: r.status });
    }
  } catch (e) {
    console.warn("cancelTriggerRun threw", { runId, e });
  }
}

async function triggerProcessMessages(p: TriggerProcessMessagesParams) {
  const r = await fetch(
    "https://api.trigger.dev/api/v1/tasks/process-messages/trigger",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${p.triggerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          lead_id: p.contactId,
          ghl_account_id: p.ghlAccountId,
          contact_name: p.name,
          contact_email: p.email,
          contact_phone: p.phone,
          setter_number: p.setterNumber,
          execution_id: p.executionId,
          debounce_seconds: p.debounceSeconds,
        },
      }),
    },
  );
  const data = await parseJsonSafely(r);
  if (!r.ok) return { ok: false as const, error: data };
  const runId = data?.id || data?.run?.id || null;
  if (!runId) {
    return {
      ok: false as const,
      error: { message: "Trigger.dev did not return a run ID", data },
    };
  }
  return { ok: true as const, runId, data };
}

// Twilio signature: HMAC-SHA1 of (full URL + sorted concatenation of
// form param key+value pairs), base64-encoded. Compare against
// X-Twilio-Signature header.
async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
  authToken: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  const expected = btoa(bin);
  return expected === signatureHeader;
}

// PATCH a single custom field on a GHL contact. Used to set
// contact.channel = "SMS" so the GHL "Send Setter Reply" workflow's
// "Which Channel?" decision (which evaluates contact.channel, NOT the
// inbound payload) routes correctly.
async function setGhlContactChannel(
  ghlApiKey: string,
  channelFieldId: string | null | undefined,
  contactId: string,
  channelLabel: string,
): Promise<void> {
  if (!channelFieldId) {
    console.warn(
      "setGhlContactChannel skipped: clients.ghl_channel_field_id not set — provision per CLIENT_ONBOARDING_SOP",
    );
    return;
  }
  const headers = {
    Authorization: `Bearer ${ghlApiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    Accept: "application/json",
  };
  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          customFields: [
            { id: channelFieldId, key: "channel", field_value: channelLabel },
          ],
        }),
      },
    );
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      console.warn(`setGhlContactChannel failed ${r.status}: ${errBody.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn("setGhlContactChannel threw", e);
  }
}

// GHL contact upsert: search by phone, create if missing.
async function findOrCreateGhlContact(
  ghlApiKey: string,
  ghlLocationId: string,
  fromPhone: string,
  body: string,
): Promise<{ contactId: string; name: string; email: string }> {
  const headers = {
    Authorization: `Bearer ${ghlApiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    Accept: "application/json",
  };

  // Search by phone
  const searchUrl = new URL("https://services.leadconnectorhq.com/contacts/search");
  searchUrl.searchParams.set("locationId", ghlLocationId);
  searchUrl.searchParams.set("query", fromPhone);
  const searchResp = await fetch(searchUrl.toString(), { headers });
  if (searchResp.ok) {
    const searchData = await searchResp.json().catch(() => null);
    const contacts = searchData?.contacts || [];
    const exact = contacts.find((c: any) =>
      c?.phone === fromPhone || c?.phone === fromPhone.replace(/^\+/, "")
    );
    if (exact?.id) {
      return {
        contactId: exact.id,
        name:
          [exact.firstName, exact.lastName].filter(Boolean).join(" ") ||
          exact.contactName || "Unknown",
        email: exact.email || "",
      };
    }
  } else {
    console.warn("GHL contact search failed", searchResp.status);
  }

  // Create — GHL returns 400 with meta.contactId when a duplicate already
  // exists (search above can miss it on phone-only lookups). Treat that as
  // "found" and return the existing id.
  const createResp = await fetch(
    "https://services.leadconnectorhq.com/contacts/",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        phone: fromPhone,
        locationId: ghlLocationId,
        source: "Twilio SMS (BFD)",
        firstName: "SMS",
        lastName: fromPhone,
      }),
    },
  );
  const createBody = await createResp.json().catch(() => null);
  if (createResp.ok) {
    const newId = createBody?.contact?.id || createBody?.id;
    if (!newId) throw new Error("GHL contact create returned no id");
    return { contactId: newId, name: "SMS Lead", email: "" };
  }
  // Duplicate path: { statusCode: 400, message: "This location does not allow duplicated contacts.", meta: { contactId, contactName, matchingField } }
  const dupId = createBody?.meta?.contactId;
  if (createResp.status === 400 && dupId) {
    return {
      contactId: dupId,
      name: createBody?.meta?.contactName || "SMS Lead",
      email: "",
    };
  }
  throw new Error(
    `GHL contact create failed ${createResp.status}: ${JSON.stringify(createBody)}`,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    // Parse form-urlencoded Twilio body
    const rawBody = await req.text();
    const formParams = new URLSearchParams(rawBody);
    const params: Record<string, string> = {};
    for (const [k, v] of formParams.entries()) params[k] = v;

    const fromPhone = params["From"];
    const toPhone = params["To"];
    const messageBody = params["Body"];
    const messageSid = params["MessageSid"];

    if (!fromPhone || !toPhone || messageBody == null) {
      console.warn("receive-twilio-sms missing params", { fromPhone, toPhone, hasBody: messageBody != null });
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve client by inbound To number
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select(
        "id, ghl_location_id, ghl_api_key, dm_enabled, debounce_seconds, twilio_account_sid, twilio_auth_token, supabase_url, supabase_service_key, ghl_conversation_provider_id, ghl_channel_field_id",
      )
      .eq("retell_phone_1", toPhone)
      .maybeSingle();

    if (clientError || !client) {
      console.warn("No client matched To number", { toPhone, clientError });
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // Verify Twilio signature. Mandatory — no skip env var. Twilio signs the
    // EXTERNAL URL it called (whatever was configured in IncomingPhoneNumbers
    // .sms_url). Inside Supabase's Deno runtime `req.url` reports the internal
    // path (e.g. http://host/receive-twilio-sms), not the public path
    // (https://host/functions/v1/receive-twilio-sms), so signing against
    // `req.url` always fails. Reconstruct the public URL from SUPABASE_URL.
    const authToken = client.twilio_auth_token;
    if (!authToken) {
      console.warn("No twilio_auth_token configured for client; rejecting", { clientId: client.id });
      return new Response("Forbidden", { status: 403 });
    }
    const publicWebhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/receive-twilio-sms`;
    const sigOk = await verifyTwilioSignature(
      publicWebhookUrl,
      params,
      req.headers.get("X-Twilio-Signature"),
      authToken,
    );
    if (!sigOk) {
      console.warn("Twilio signature mismatch", {
        clientId: client.id,
        publicWebhookUrl,
        rawReqUrl: req.url,
        messageSid,
      });
      return new Response("Forbidden", { status: 403 });
    }

    if (!client.dm_enabled) {
      console.info("client.dm_enabled=false; SMS recorded but skipped", { clientId: client.id });
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // ── Phase 4a: STOP / START keyword handling ──
    // Sig is already verified; client is resolved. Match against the inbound
    // body BEFORE any GHL contact resolution / message_queue / Trigger.dev hop
    // so opt-out is regulator-friendly (no marketing reply, no AI processing).
    const trimmedBody = (messageBody ?? "").trim();
    const isStop = STOP_KEYWORDS_RE.test(trimmedBody);
    const isStart = START_KEYWORDS_RE.test(trimmedBody);

    if (isStop || isStart) {
      const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY") ?? null;

      // Resolve matching lead rows once — used by STOP cadence cancellation
      // and by the GHL mirror for both STOP and START.
      const { data: matchedLeads } = await supabase
        .from("leads")
        .select("lead_id")
        .eq("client_id", client.id)
        .eq("phone", fromPhone);

      if (isStop) {
        // Record opt-out
        await supabase
          .from("lead_optouts")
          .upsert(
            {
              client_id: client.id,
              phone: fromPhone,
              source: "sms_stop",
              raw_keyword: trimmedBody.toUpperCase().slice(0, 32),
            },
            { onConflict: "client_id,phone" },
          );
        // Mark setter_stopped on any matching lead row
        await supabase
          .from("leads")
          .update({ setter_stopped: true })
          .eq("client_id", client.id)
          .eq("phone", fromPhone);
        // Cancel active cadences for any matching ghl_contact_id under this client
        if (matchedLeads && client.ghl_location_id) {
          for (const lead of matchedLeads) {
            await endActiveCadences({
              supabase,
              clientId: client.id,
              ghlContactId: lead.lead_id,
              ghlAccountId: client.ghl_location_id,
              triggerKey,
              stopReason: "opt_out",
            });
          }
        }
      } else if (isStart) {
        // Symmetric resubscribe
        await supabase
          .from("lead_optouts")
          .delete()
          .eq("client_id", client.id)
          .eq("phone", fromPhone);
        await supabase
          .from("leads")
          .update({ setter_stopped: false })
          .eq("client_id", client.id)
          .eq("phone", fromPhone);
      }

      // Compliance reply (single send, no AI loop)
      const complianceBody = isStop ? STOP_REPLY : START_REPLY;
      await sendTwilioCompliance({
        twilioSid: client.twilio_account_sid as string | null,
        twilioAuth: client.twilio_auth_token as string | null,
        fromNumber: toPhone,
        toNumber: fromPhone,
        body: complianceBody,
      });

      // Phase B (gap 2/3) — mirror both the inbound STOP/START keyword and
      // the outbound auto-reply to GHL for every matched contact, so the
      // conversation thread reflects the opt-out exchange. Skipped silently
      // when the sender has no matching lead row (no contactId to mirror to).
      if (
        matchedLeads
        && matchedLeads.length > 0
        && client.ghl_api_key
        && client.ghl_location_id
      ) {
        for (const lead of matchedLeads) {
          if (!lead.lead_id) continue;
          scheduleGhlMirror(
            pushSmsToGhl({
              ghlApiKey: client.ghl_api_key,
              ghlLocationId: client.ghl_location_id,
              contactId: lead.lead_id,
              conversationProviderId: client.ghl_conversation_provider_id ?? null,
              message: messageBody,
              direction: "inbound",
              altId: messageSid ?? null,
            }),
          );
          scheduleGhlMirror(
            pushSmsToGhl({
              ghlApiKey: client.ghl_api_key,
              ghlLocationId: client.ghl_location_id,
              contactId: lead.lead_id,
              conversationProviderId: client.ghl_conversation_provider_id ?? null,
              message: complianceBody,
              direction: "outbound",
              altId: null,
            }),
          );
        }
      }

      console.info(`Phase 4a ${isStop ? "STOP" : "START"} keyword handled`, {
        clientId: client.id,
        from: fromPhone.slice(0, 4) + "***",
      });
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    if (!client.ghl_api_key || !client.ghl_location_id) {
      console.warn("Missing GHL creds on client", { clientId: client.id });
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // Find or create GHL contact
    let contactId: string;
    let contactName: string;
    let contactEmail: string;
    try {
      const c = await findOrCreateGhlContact(
        client.ghl_api_key,
        client.ghl_location_id,
        fromPhone,
        messageBody,
      );
      contactId = c.contactId;
      contactName = c.name;
      contactEmail = c.email;
    } catch (e) {
      console.error("GHL contact resolve failed", e);
      // REL-03: this drops the inbound reply (no contact, no execution) —
      // record it so the operator can see the dead lead.
      try {
        await supabase.from("error_logs").insert({
          client_id: client.id,
          severity: "error",
          source: "receive_twilio_sms",
          error_type: "ghl_contact_resolve_failed",
          error_message: e instanceof Error ? e.message : String(e),
          context: { messageSid, fromPhone },
        });
      } catch (_logErr) { /* non-fatal */ }
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // Stamp contact.channel = "SMS" so the Send Setter Reply workflow's
    // "Which Channel?" decision (sourced from contact.channel) routes here.
    // Fire-and-forget — don't block the inbound on a slow GHL response.
    setGhlContactChannel(client.ghl_api_key, client.ghl_channel_field_id, contactId, "SMS");

    // Phase B (gap 2) — mirror the inbound SMS body to GHL so the agency
    // owner sees the conversation thread. Best-effort, runs after the TwiML
    // response returns. Uses Conversations API when ghl_conversation_provider_id
    // is set on the client; falls back to a Note otherwise.
    scheduleGhlMirror(
      pushSmsToGhl({
        ghlApiKey: client.ghl_api_key,
        ghlLocationId: client.ghl_location_id,
        contactId,
        conversationProviderId: client.ghl_conversation_provider_id ?? null,
        message: messageBody,
        direction: "inbound",
        altId: messageSid ?? null,
      }),
    );

    const ghlAccountId = client.ghl_location_id;
    const setterNumber = "1"; // SMS via Twilio direct → default Setter-1 slot
    const setterSlotId = "Setter-1";

    // Setter-stopped check
    const { data: leadRow } = await supabase
      .from("leads")
      .select("setter_stopped")
      .eq("lead_id", contactId)
      .eq("client_id", client.id)
      .maybeSingle();

    if (leadRow?.setter_stopped) {
      console.info("Setter stopped — recording SMS only", { contactId, clientId: client.id });
      const nowTs = new Date().toISOString();
      if (client.supabase_url && client.supabase_service_key) {
        try {
          const ext = createClient(client.supabase_url, client.supabase_service_key);
          await ext.from("chat_history").insert({
            session_id: contactId,
            message: { type: "human", content: messageBody, additional_kwargs: {}, response_metadata: {} },
            timestamp: nowTs,
          });
        } catch (e) {
          console.warn("chat_history write failed", e);
        }
      }
      const stoppedNameParts = (contactName || "").split(" ").filter(Boolean);
      await supabase
        .from("leads")
        .upsert({
          client_id: client.id,
          lead_id: contactId,
          first_name: stoppedNameParts[0] ?? null,
          last_name: stoppedNameParts.slice(1).join(" ") || null,
          phone: fromPhone || null,
          email: contactEmail || null,
          last_message_at: nowTs,
          last_message_preview: (messageBody || "").substring(0, 200),
          // Cadence v2 — direction-aware tracking for cold-reply nudge.
          last_inbound_at: nowTs,
          last_reply_at: nowTs,
        }, { onConflict: "client_id,lead_id" });
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    // Resolve debounce
    const legacyDelay = client.debounce_seconds ?? 60;
    let debounceSeconds = 60;
    let delaySource = "default";
    {
      const { data: agentSetting } = await supabase
        .from("agent_settings")
        .select("response_delay_seconds")
        .eq("client_id", client.id)
        .eq("slot_id", setterSlotId)
        .maybeSingle();
      if (agentSetting?.response_delay_seconds != null) {
        debounceSeconds = agentSetting.response_delay_seconds;
        delaySource = "agent_settings";
      } else if (client.debounce_seconds != null) {
        debounceSeconds = legacyDelay;
        delaySource = "legacy_client";
      }
    }

    const nowISO = new Date().toISOString();
    const resumeAt = buildResumeAt(debounceSeconds);

    const triggerPayload = {
      Lead_ID: contactId,
      GHL_Account_ID: ghlAccountId,
      Message_Body: messageBody,
      Name: contactName,
      Email: contactEmail,
      Phone: fromPhone,
      Setter_Number: setterNumber,
      Setter_Slot_Id: setterSlotId,
      Applied_Delay_Seconds: debounceSeconds,
      Delay_Source: delaySource,
      received_at: nowISO,
      channel: "sms",
      twilio_message_sid: messageSid,
    };

    const { data: activeRun } = await supabase
      .from("active_trigger_runs")
      .select("id, trigger_run_id, created_at")
      .eq("lead_id", contactId)
      .eq("ghl_account_id", ghlAccountId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Twilio retries the inbound webhook on transient errors; the partial
    // unique index on message_queue.twilio_message_sid lets us swallow the
    // duplicate so a retry doesn't enqueue (and reply to) the same SMS twice.
    const { error: mqError } = await supabase.from("message_queue").insert({
      lead_id: contactId,
      ghl_account_id: ghlAccountId,
      message_body: messageBody,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: fromPhone,
      channel: "sms",
      twilio_message_sid: messageSid,
    });
    if (mqError) {
      // 23505 = unique_violation — Twilio retried this same SID; treat as success.
      const isDuplicate = (mqError as { code?: string }).code === "23505"
        || /duplicate key|already exists/i.test(mqError.message ?? "");
      if (isDuplicate) {
        console.info("message_queue dedup: Twilio retry for sid", { messageSid });
        return new Response(TWIML_EMPTY, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/xml" },
        });
      }
      console.error("message_queue insert failed", mqError);
      // REL-03: don't drop inbound replies silently — record so the operator
      // (and any alerter) can see dropped inbound SMS. TwiML stays 200 below.
      try {
        await supabase.from("error_logs").insert({
          client_id: client.id,
          lead_id: contactId,
          severity: "error",
          source: "receive_twilio_sms",
          error_type: "inbound_sms_drop",
          error_message: `message_queue insert failed: ${mqError.message ?? "unknown"}`,
          context: { messageSid, contactId, fromPhone },
        });
      } catch (_logErr) { /* non-fatal */ }
    }

    const nameParts = (contactName || "").split(" ").filter(Boolean);
    await supabase
      .from("leads")
      .upsert({
        client_id: client.id,
        lead_id: contactId,
        first_name: nameParts[0] ?? null,
        last_name: nameParts.slice(1).join(" ") || null,
        phone: fromPhone || null,
        email: contactEmail || null,
        last_message_at: nowISO,
        last_message_preview: (messageBody || "").substring(0, 200),
        // Cadence v2 — direction-aware tracking. last_reply_at is reset on
        // every inbound; the cold-reply nudge resets nudge_count too so a
        // re-engaged lead is back at zero.
        last_inbound_at: nowISO,
        last_reply_at: nowISO,
        nudge_count: 0,
      }, { onConflict: "client_id,lead_id" });

    // Voice-call coordination: if a cadence voice call is live for this contact,
    // do NOT end the cadence — the call is mid-flight and the text setter
    // (processMessages) will hold this reply until call_ended. Ending here would
    // cancel the in-flight call's own execution.
    let voiceCallActive = false;
    {
      const { data: lc } = await supabase
        .from("engagement_executions").select("id")
        .eq("ghl_contact_id", contactId).eq("client_id", client.id)
        .not("active_call_id", "is", null).limit(1).maybeSingle();
      voiceCallActive = !!lc;
    }

    // Phase 4c — reply-detected cadence-end. Inbound SMS means the human
    // (or AI) takes the conversation; running cadence sends should stop.
    if (triggerKey && !voiceCallActive) {
      await endActiveCadences({
        supabase,
        clientId: client.id,
        ghlContactId: contactId,
        ghlAccountId,
        triggerKey,
        stopReason: "inbound_reply",
      });
    }

    if (!triggerKey) {
      console.error("TRIGGER_SECRET_KEY not set");
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
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
        const previousPayload =
          existingExec.trigger_payload && typeof existingExec.trigger_payload === "object"
            ? existingExec.trigger_payload
            : {};
        await supabase
          .from("dm_executions")
          .update({
            messages_received: nextMessageCount,
            trigger_payload: { ...previousPayload, ...triggerPayload },
            stage_description: `${nextMessageCount} SMS received — grouping until original window expires.`,
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
          contact_name: contactName,
          status: "waiting",
          messages_received: 1,
          trigger_payload: triggerPayload,
          resume_at: resumeAt,
          channel: "sms",
          stage_description: `Waiting ${debounceSeconds}s for more SMS...`,
        })
        .select("id")
        .single();
      if (execError || !execution) {
        console.error("dm_executions insert failed", execError);
        // REL-03: the reply is queued but no execution will process it.
        try {
          await supabase.from("error_logs").insert({
            client_id: client.id,
            lead_id: contactId,
            severity: "error",
            source: "receive_twilio_sms",
            error_type: "dm_execution_insert_failed",
            error_message: execError?.message ?? "no execution row returned",
            context: { messageSid, contactId, fromPhone },
          });
        } catch (_logErr) { /* non-fatal */ }
        return new Response(TWIML_EMPTY, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/xml" },
        });
      }
      executionId = execution.id;
    }

    const effectiveResumeAt =
      reusingExecution && originalResumeAt ? originalResumeAt : resumeAt;
    const remainingMs = new Date(effectiveResumeAt).getTime() - Date.now();
    const effectiveDebounce = Math.max(1, Math.ceil(remainingMs / 1000));

    const triggerResult = await triggerProcessMessages({
      contactId,
      ghlAccountId,
      name: contactName,
      email: contactEmail,
      phone: fromPhone,
      setterNumber,
      executionId,
      debounceSeconds: effectiveDebounce,
      triggerKey,
    });

    if (!triggerResult.ok) {
      console.error("triggerProcessMessages failed", triggerResult.error);
      // REL-03: execution exists but the processor never got enqueued — the
      // lead's reply will sit unanswered unless someone sees this.
      try {
        await supabase.from("error_logs").insert({
          client_id: client.id,
          lead_id: contactId,
          execution_id: executionId,
          severity: "error",
          source: "receive_twilio_sms",
          error_type: "trigger_process_messages_failed",
          error_message: String(triggerResult.error ?? "unknown"),
          context: { messageSid, contactId, fromPhone },
        });
      } catch (_logErr) { /* non-fatal */ }
      return new Response(TWIML_EMPTY, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
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

    await supabase
      .from("dm_executions")
      .update({
        trigger_run_id: runId,
        stage_description: reusingExecution
          ? `${nextMessageCount} SMS received — ${effectiveDebounce}s remaining in window.`
          : `Waiting ${debounceSeconds}s for more SMS...`,
      })
      .eq("id", executionId);

    console.info("Twilio SMS armed", {
      executionId,
      runId,
      reusingExecution,
      debounceSeconds: effectiveDebounce,
    });

    return new Response(TWIML_EMPTY, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (err) {
    console.error("receive-twilio-sms error", err);
    // REL-03: a top-level failure silently drops the inbound reply — record
    // it. client/supabase from the try block are out of scope here, so build
    // a throwaway client; client_id is unknown at this point.
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await sb.from("error_logs").insert({
        severity: "error",
        source: "receive_twilio_sms",
        error_type: "inbound_sms_unhandled_error",
        error_message: err instanceof Error ? err.message : String(err),
        context: { stack: err instanceof Error ? (err.stack ?? null) : null },
      });
    } catch (_logErr) { /* non-fatal */ }
    // Never 500 to Twilio — they retry aggressively. Return empty TwiML.
    return new Response(TWIML_EMPTY, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  }
});
