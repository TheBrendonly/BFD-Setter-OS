import { createClient } from "npm:@supabase/supabase-js@2.101.0";
// Retell signature verification (correct v={ts},d=HMAC(body+ts, API_KEY) scheme,
// 5-min window). Shared across the 3 Retell webhooks. Verify-if-present; the
// stored secret value is the Retell API key.
import { verifyRetellSignature } from "../_shared/verify-webhook.ts";
import { normalizePhone } from "../_shared/phone.ts";
import { resolveLeadByPhone } from "../_shared/leadResolve.ts";

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

// Observability — redact the caller number in logs (keep the last 4 for matching).
const redactPhone = (p: string | null): string => {
  if (!p) return "<none>";
  const s = String(p);
  return s.length <= 4 ? "***" : "***" + s.slice(-4);
};


// Always return 200 with whatever dynamic_variables we could resolve. Returning an
// error or empty payload still lets the call proceed (the prompt's empty-vars guidance
// handles the no-match case); we never block an inbound call.
function inboundResponse(eventKey: "call_inbound" | "chat_inbound", dynamicVariables: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ [eventKey]: { dynamic_variables: dynamicVariables } }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
}

// Always emit the lead-context keys (defaulting to empty strings) on EVERY response
// path. An unset dynamic variable makes Retell leave the literal "{{first_name}}" in
// the prompt/begin_message; an empty string renders as nothing. So for an unknown
// caller (no lead match) the agent omits the name instead of speaking the raw token.
function leadVars(lead: Record<string, unknown> | null, fromNumber: string | null): Record<string, string> {
  return {
    first_name: String(lead?.first_name ?? ""),
    last_name: String(lead?.last_name ?? ""),
    email: String(lead?.email ?? ""),
    phone: String(lead?.phone ?? fromNumber ?? ""),
    business_name: String(lead?.business_name ?? ""),
    contact_id: String(lead?.lead_id ?? ""),
  };
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
      return inboundResponse(eventKey, leadVars(null, fromNumber));
    }
    if (!fromNumber) {
      return inboundResponse(eventKey, leadVars(null, null));
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve client by agent_id across all 10 slots (same pattern as retell-call-webhook).
    const { data: clients } = await supabase
      .from("clients")
      .select("id, timezone, retell_webhook_secret, recording_disclosure_enabled")
      .or(
        `retell_inbound_agent_id.eq.${agentId},retell_outbound_agent_id.eq.${agentId},retell_outbound_followup_agent_id.eq.${agentId},retell_agent_id_4.eq.${agentId},retell_agent_id_5.eq.${agentId},retell_agent_id_6.eq.${agentId},retell_agent_id_7.eq.${agentId},retell_agent_id_8.eq.${agentId},retell_agent_id_9.eq.${agentId},retell_agent_id_10.eq.${agentId}`,
      );
    const client = clients?.[0];
    if (!client) {
      console.log(`retell-inbound-webhook: ${eventKey} no client for agent=${agentId} from=${redactPhone(fromNumber)} — returning empty vars`);
      return inboundResponse(eventKey, leadVars(null, fromNumber));
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
    // PRIMARY: normalize the caller number and resolve to the single deterministic
    // survivor via normalized_phone index (handles repeat callers with duplicate rows).
    // FALLBACK: if normalization returns null (unusual format) or the normalized lookup
    // misses (pre-backfill rows), do a raw exact match ordered by updated_at desc so we
    // always get one row rather than silently returning nothing when >1 row matches.
    const normalizedFrom = normalizePhone(fromNumber);
    let lead: Record<string, unknown> | null = null;

    if (normalizedFrom) {
      lead = await resolveLeadByPhone(supabase, client.id, normalizedFrom);
    }

    if (!lead) {
      // Raw-phone fallback: deterministic (most-recently-updated row) so we never hit
      // the old ">1 match returns empty" dead-end even before the backfill is applied.
      const { data: rawMatch } = await supabase
        .from("leads")
        .select("lead_id, first_name, last_name, phone, email, business_name")
        .eq("client_id", client.id)
        .eq("phone", fromNumber)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lead = rawMatch ?? null;
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
      // F17: call-recording disclosure flag (spoken line is PU-6, prompt-side).
      recording_disclosure:
        (client as { recording_disclosure_enabled?: boolean }).recording_disclosure_enabled === true
          ? "required"
          : "not_required",
      ...leadVars(lead, fromNumber),
    };

    console.log(`retell-inbound-webhook: ${eventKey} agent=${agentId} from=${redactPhone(fromNumber)} client=${client.id} matched=${!!lead} verified=${!!client.retell_webhook_secret}`);
    return inboundResponse(eventKey, dv);
  } catch (err) {
    console.error("retell-inbound-webhook error:", err);
    // Never block the call — return safe empty-string vars (never literal tokens).
    return inboundResponse(eventKey, leadVars(null, null));
  }
});
