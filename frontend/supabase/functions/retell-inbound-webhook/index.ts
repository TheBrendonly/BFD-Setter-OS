import { createClient } from "npm:@supabase/supabase-js@2.101.0";

// retell-inbound-webhook — phone-first inbound contact load (B5).
//
// Retell calls a phone number's `inbound_webhook_url` synchronously BEFORE an
// inbound call connects, with { event: "call_inbound", call_inbound: { agent_id,
// from_number, to_number } } (10s timeout, 3 retries). We resolve the client by
// agent_id, look up the contact by from_number, and return the contact's details
// as dynamic_variables so {{first_name}}/{{email}}/etc. are populated on inbound —
// making the prompt's "details already loaded" true for inbound callers, not just
// outbound. Decision 2026-06-14 (B5): TRUST the phone match (no email confirmation).
//
// Contract: https://docs.retellai.com/features/inbound-call-webhook
// Response shape: { call_inbound: { dynamic_variables: {...} } }  (all fields optional).
// Wiring (Brendan, Retell write): set each BYO phone number's inbound_webhook_url to
// this function's URL. The agent's own webhook_url (retell-call-webhook) is separate.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retell-signature",
};

// Verify-if-present HMAC (mirrors retell-call-webhook); inert until the resolved
// client sets retell_webhook_secret.
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

// Always return 200 with whatever dynamic_variables we could resolve. Returning an
// error or empty payload still lets the call proceed (the prompt's empty-vars guidance
// handles the no-match case); we never block an inbound call.
function inboundResponse(eventKey: "call_inbound" | "chat_inbound", dynamicVariables: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ [eventKey]: { dynamic_variables: dynamicVariables } }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Default event key; corrected once we parse the body.
  let eventKey: "call_inbound" | "chat_inbound" = "call_inbound";

  try {
    const rawBody = await req.text();
    const payload = JSON.parse(rawBody || "{}");
    eventKey = payload?.event === "chat_inbound" ? "chat_inbound" : "call_inbound";
    const inbound = payload?.[eventKey] ?? payload?.call_inbound ?? payload?.chat_inbound ?? {};

    const agentId: unknown = inbound?.agent_id;
    const fromNumber: string | null = inbound?.from_number ?? null;

    // Agent id is interpolated into a PostgREST .or() filter — validate its shape.
    if (typeof agentId !== "string" || !/^agent_[A-Za-z0-9]+$/.test(agentId)) {
      return inboundResponse(eventKey, {});
    }
    if (!fromNumber) {
      return inboundResponse(eventKey, {});
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve client by agent_id across all 10 slots (same pattern as retell-call-webhook).
    const { data: clients } = await supabase
      .from("clients")
      .select("id, timezone, retell_webhook_secret")
      .or(
        `retell_inbound_agent_id.eq.${agentId},retell_outbound_agent_id.eq.${agentId},retell_outbound_followup_agent_id.eq.${agentId},retell_agent_id_4.eq.${agentId},retell_agent_id_5.eq.${agentId},retell_agent_id_6.eq.${agentId},retell_agent_id_7.eq.${agentId},retell_agent_id_8.eq.${agentId},retell_agent_id_9.eq.${agentId},retell_agent_id_10.eq.${agentId}`,
      );
    const client = clients?.[0];
    if (!client) {
      return inboundResponse(eventKey, {});
    }

    // Verify-if-present (inert until the client stamps retell_webhook_secret).
    if (client.retell_webhook_secret) {
      const sigOk = await verifyRetellSignature(rawBody, req.headers.get("x-retell-signature"), client.retell_webhook_secret as string);
      if (!sigOk) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Look up the contact by phone (TRUST the phone match — decision B5 2026-06-14).
    // Exact E.164 first; fall back to a last-9-digit suffix match to bridge +61 vs 0
    // local-format storage. Scoped to the resolved client.
    const digits = fromNumber.replace(/\D/g, "");
    const last9 = digits.slice(-9);
    let lead: Record<string, unknown> | null = null;

    const { data: exact } = await supabase
      .from("leads")
      .select("lead_id, first_name, last_name, phone, email, business_name")
      .eq("client_id", client.id)
      .eq("phone", fromNumber)
      .limit(1)
      .maybeSingle();
    lead = exact ?? null;

    if (!lead && last9.length >= 7) {
      const { data: suffix } = await supabase
        .from("leads")
        .select("lead_id, first_name, last_name, phone, email, business_name")
        .eq("client_id", client.id)
        .ilike("phone", `%${last9}`)
        .limit(1)
        .maybeSingle();
      lead = suffix ?? null;
    }

    // current_time in the client's timezone (cheap, always useful on inbound).
    const tz = (client.timezone as string | null) || "Australia/Sydney";
    let currentTime = "";
    try {
      currentTime = new Intl.DateTimeFormat("en-AU", {
        timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      }).format(new Date());
    } catch { /* invalid tz — leave empty */ }

    const dv: Record<string, string> = {
      current_time: currentTime,
      current_timezone: tz,
    };
    if (lead) {
      dv.first_name = String(lead.first_name ?? "");
      dv.last_name = String(lead.last_name ?? "");
      dv.email = String(lead.email ?? "");
      dv.phone = String(lead.phone ?? fromNumber);
      dv.business_name = String(lead.business_name ?? "");
      dv.contact_id = String(lead.lead_id ?? "");
    }

    return inboundResponse(eventKey, dv);
  } catch (err) {
    console.error("retell-inbound-webhook error:", err);
    // Never block the call — return an empty (but valid) override.
    return inboundResponse(eventKey, {});
  }
});
