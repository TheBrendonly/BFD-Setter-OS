// twilio-status-webhook — receives Twilio MessageStatus callbacks.
//
// Phase 7b of the master rebuild. Every outbound SMS we send (via
// processMessages, runEngagement, sendFollowup, etc.) sets StatusCallback
// to this URL. Twilio fires updates on queued / sending / sent /
// delivered / undelivered / failed / read.
//
// We:
//   1. Verify Twilio sig (HMAC-SHA1 over public URL + sorted form params)
//      using the per-client twilio_auth_token. Public-URL reconstruction
//      from SUPABASE_URL is mandatory inside Deno's edge runtime — see
//      memory reference_supabase_deno_req_url.
//   2. Insert into sms_delivery_events
//   3. If the status is terminal (delivered / failed / undelivered),
//      mirror to message_queue (for dashboard visibility)
//
// Always returns 200 to Twilio (even on errors) so they don't retry
// forever. Sig mismatch returns 403 — Twilio interprets that as "stop
// retrying this URL", which is the correct behaviour.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const TERMINAL_STATUSES = new Set(["delivered", "undelivered", "failed"]);

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
  return constantTimeEqual(expected, signatureHeader);
}

// Constant-time compare (length leak only; base64 signature length is fixed).
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const formParams = new URLSearchParams(rawBody);
    const params: Record<string, string> = {};
    for (const [k, v] of formParams.entries()) params[k] = v;

    const messageSid = params["MessageSid"] || params["SmsSid"] || null;
    const status = (params["MessageStatus"] || params["SmsStatus"] || "").toLowerCase();
    const fromPhone = params["From"] || null;
    const toPhone = params["To"] || null;
    const accountSid = params["AccountSid"] || null;
    const errorCode = params["ErrorCode"] ? Number(params["ErrorCode"]) : null;
    const errorMessage = params["ErrorMessage"] || null;

    if (!messageSid || !status) {
      console.warn("twilio-status-webhook missing MessageSid or status", params);
      return new Response("ok", { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve the client owning this AccountSid so we can verify the sig
    // with their auth token. Fall back to From-number lookup if AccountSid
    // is missing (older Twilio payloads).
    let clientRow: { id: string; twilio_auth_token: string | null } | null = null;
    if (accountSid) {
      const { data } = await supabase
        .from("clients")
        .select("id, twilio_auth_token")
        .eq("twilio_account_sid", accountSid)
        .maybeSingle();
      if (data) clientRow = data;
    }
    if (!clientRow && fromPhone) {
      const { data } = await supabase
        .from("clients")
        .select("id, twilio_auth_token")
        .eq("retell_phone_1", fromPhone)
        .maybeSingle();
      if (data) clientRow = data;
    }
    // Final fallback: lookup via the message_queue row that owns this SID
    if (!clientRow && messageSid) {
      const { data: mq } = await supabase
        .from("message_queue")
        .select("ghl_account_id")
        .eq("twilio_message_sid", messageSid)
        .maybeSingle();
      if (mq?.ghl_account_id) {
        const { data: byLoc } = await supabase
          .from("clients")
          .select("id, twilio_auth_token")
          .eq("ghl_location_id", mq.ghl_account_id)
          .maybeSingle();
        if (byLoc) clientRow = byLoc;
      }
    }

    if (!clientRow?.twilio_auth_token) {
      console.warn("twilio-status-webhook: no client / auth_token resolved; rejecting", {
        accountSid, fromPhone, toPhone, messageSid,
      });
      return new Response("Forbidden", { status: 403 });
    }

    const publicWebhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twilio-status-webhook`;
    const sigOk = await verifyTwilioSignature(
      publicWebhookUrl,
      params,
      req.headers.get("X-Twilio-Signature"),
      clientRow.twilio_auth_token,
    );
    if (!sigOk) {
      console.warn("twilio-status-webhook signature mismatch", {
        clientId: clientRow.id,
        messageSid,
        publicWebhookUrl,
      });
      return new Response("Forbidden", { status: 403 });
    }

    // Upsert delivery event row (one per status update). Twilio retries
    // status callbacks on transient failures, so the DB-side
    // sms_delivery_events_sid_status_unique constraint dedupes
    // (twilio_message_sid, status) pairs idempotently.
    const { error: insertErr } = await supabase
      .from("sms_delivery_events")
      .upsert({
        twilio_message_sid: messageSid,
        client_id: clientRow.id,
        status,
        error_code: errorCode,
        error_message: errorMessage,
        raw_payload: params,
      }, { onConflict: "twilio_message_sid,status" });
    if (insertErr) {
      console.error("twilio-status-webhook: sms_delivery_events upsert failed", insertErr);
    }

    // (Removed) Mirror to message_queue.status — that column does not exist on
    // the platform DB, so the update silently no-op'd. sms_delivery_events above
    // is the canonical terminal-status record (twilio_message_sid, status).

    return new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err) {
    console.error("twilio-status-webhook error:", err);
    return new Response("ok", { status: 200 });
  }
});
