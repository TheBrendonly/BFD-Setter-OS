// demo-callback — public callback-request handler for the Gary demo funnel.
//
// A prospect submits { slug, first_name, email, phone } on /g/<slug>; Gary rings
// them back within seconds from the BFD dogfood number, qualifies, and books on
// BFD's real calendar (so GHL sends a genuine confirmation email).
//
// This replaces the old ring-a-number demo, which showcased inbound answering —
// a capability BFD does not sell. Gary is a warm OUTBOUND speed-to-lead agent.
//
// SECURITY POSTURE — this endpoint dials a real phone on BFD's Twilio + Retell
// accounts, so it is treated as an abuse surface first and a form second:
//   - the browser sends only a slug; client_id and voice_setter_id are resolved
//     from a server-side registry and can never be chosen by the caller
//   - destinations are restricted to AU mobiles (international toll-fraud guard)
//   - two independent rate-limit windows: per-phone and per-slug
//   - opt-outs are honoured and fail closed
//
// Deliberately does NOT go through intake-lead: that path auto-enrols the lead
// into clients.auto_engagement_workflow_id, which on the BFD tenant is a 5-step
// multi-day cadence. A demo is one call, not a drip campaign.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveLeadByPhone } from "../_shared/leadResolve.ts";
import { isPhoneOptedOut } from "../_shared/optout.ts";
import { findOrCreateGhlContact } from "./ghlContact.ts";
import {
  PHONE_MAX_PER_WINDOW,
  PHONE_WINDOW_SECONDS,
  SLUG_MAX_PER_WINDOW,
  SLUG_WINDOW_SECONDS,
  phoneBucketKey,
  resolveProspect,
  slugBucketKey,
  validateCallbackRequest,
} from "./prospects.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Tag applied in GHL so demo prospects are filterable from real pipeline. */
const DEMO_TAG = "bfd-demo-callback";
/** Idempotency window: collapses double-submits into a single dial. */
const IDEMPOTENCY_WINDOW_SECONDS = 300;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** True when the bucket is over its cap for the current window. */
async function isRateLimited(
  supabase: ReturnType<typeof createClient>,
  bucketKey: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("bump_rate_limit", {
    p_bucket_key: bucketKey,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail open on an infrastructure fault: a broken counter must not take the
    // funnel down. The per-slug window and AU-mobile restriction still apply.
    console.warn("demo-callback: rate limit check failed, allowing:", error.message);
    return false;
  }
  return typeof data === "number" && data > max;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => null);

    const prospect = resolveProspect((body as Record<string, unknown> | null)?.slug);
    if (!prospect) return json({ error: "Unknown demo page." }, 404);

    const validation = validateCallbackRequest(body);
    if (!validation.ok) return json({ error: validation.error }, 400);
    const { firstName, email, normalizedPhone, rawPhone } = validation.value;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (
      await isRateLimited(
        supabase,
        phoneBucketKey(normalizedPhone),
        PHONE_WINDOW_SECONDS,
        PHONE_MAX_PER_WINDOW,
      )
    ) {
      return json({ error: "We've already called that number recently. Give it an hour." }, 429);
    }
    if (
      await isRateLimited(
        supabase,
        slugBucketKey(prospect.slug),
        SLUG_WINDOW_SECONDS,
        SLUG_MAX_PER_WINDOW,
      )
    ) {
      return json({ error: "This demo has hit its daily limit. Try again tomorrow." }, 429);
    }

    if (await isPhoneOptedOut(supabase, prospect.clientId, normalizedPhone)) {
      // Deliberately vague: never confirm opt-out status to an anonymous caller.
      return json({ error: "We can't call that number." }, 403);
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, ghl_api_key, ghl_location_id, timezone")
      .eq("id", prospect.clientId)
      .maybeSingle();
    if (clientError || !client) {
      console.error("demo-callback: client lookup failed", clientError);
      return json({ error: "Demo is temporarily unavailable." }, 503);
    }

    // Reuse the deterministic survivor lead when one exists, so we neither add
    // to the duplicate pile nor detach from an existing GHL contact. Only mint a
    // new GHL contact when there is genuinely no usable id.
    const existingLead = await resolveLeadByPhone(supabase, prospect.clientId, normalizedPhone);
    const existingLeadId = typeof existingLead?.lead_id === "string" ? existingLead.lead_id : "";
    const hasRealGhlId = existingLeadId && !existingLeadId.startsWith("bfd-");

    const contactId = hasRealGhlId ? existingLeadId : await findOrCreateGhlContact({
      ghlApiKey: client.ghl_api_key as string,
      ghlLocationId: client.ghl_location_id as string,
      firstName,
      email,
      phone: normalizedPhone,
      source: `bfd-demo:${prospect.slug}`,
      tags: [DEMO_TAG],
    });

    const { error: leadError } = await supabase.from("leads").upsert({
      client_id: prospect.clientId,
      lead_id: contactId,
      first_name: firstName,
      phone: rawPhone,
      normalized_phone: normalizedPhone,
      email,
      form_source: `bfd-demo:${prospect.slug}`,
    }, { onConflict: "client_id,lead_id" });
    if (leadError) {
      // The email capture is the durable value here, so a failed write is fatal
      // rather than silently dialling a lead we never recorded.
      console.error("demo-callback: lead upsert failed", leadError);
      return json({ error: "Demo is temporarily unavailable." }, 503);
    }

    const idempotencyBucket = Math.floor(Date.now() / 1000 / IDEMPOTENCY_WINDOW_SECONDS);
    const callResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/make-retell-outbound-call`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          client_id: prospect.clientId,
          voice_setter_id: prospect.voiceSetterId,
          ghl_contact_id: contactId,
          lead_id: contactId,
          idempotency_key: `demo-${prospect.slug}-${normalizedPhone}-${idempotencyBucket}`,
          timezone: client.timezone ?? "Australia/Sydney",
          contact_fields: {
            first_name: firstName,
            email,
            phone: normalizedPhone,
          },
        }),
      },
    );
    const callResult = await callResponse.json().catch(() => null);

    if (!callResponse.ok || callResult?.call_failed) {
      console.error("demo-callback: outbound call failed", {
        slug: prospect.slug,
        status: callResponse.status,
        error: callResult?.error,
      });
      // The lead is already saved, so the submission was not wasted.
      return json({ error: "We couldn't start the call just now. We'll follow up." }, 502);
    }

    console.log(`demo-callback: dialling for ${prospect.firmName} (${prospect.slug})`);
    return json({ ok: true });
  } catch (err) {
    console.error("demo-callback: unexpected error", err);
    return json({ error: "Something went wrong." }, 500);
  }
});
