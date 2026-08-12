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
//   - four independent rate-limit windows: per-phone, per-IP, per-slug daily,
//     and per-slug spacing (>=60s between dials on one page)
//   - the limiter FAILS CLOSED: it is the primary volume control here, unlike
//     campaign-enroll-webhook where token auth is the gate and the limiter is
//     a backstop. Cost of a false close is one lost submission during a DB
//     blip; cost of fail-open is unmetered real dials.
//   - opt-outs are honoured and fail closed; the opted-out response is
//     indistinguishable from a call-fire failure so the endpoint is not an
//     opt-out oracle
//   - submissions outside calling hours are declined with an honest message
//
// KNOWN LIMITATION (documented trade-off, security review I2): a submission
// whose phone matches an existing lead updates that lead's name/email. An
// anonymous caller who knows a lead's phone number could therefore retag that
// row. Accepted because the tenant is BFD's own (never a paying client's), the
// funnel's durable value IS capturing the submitted email, and the write is
// rate-limited four ways. Revisit before any non-BFD tenant ever enters the
// registry.
//
// Deliberately does NOT go through intake-lead: that path auto-enrols the lead
// into clients.auto_engagement_workflow_id, which on the BFD tenant is a 5-step
// multi-day cadence. A demo is one call, not a drip campaign.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveLeadByPhone } from "../_shared/leadResolve.ts";
import { isPhoneOptedOut } from "../_shared/optout.ts";
import { buildLeadInsert } from "../_shared/lead-insert.ts";
import {
  addContactTags,
  findOrCreateGhlContact,
  GhlContactError,
  updateContactEmail,
} from "../_shared/ghlContact.ts";
import {
  clientIpFromHeaders,
  IP_MAX_PER_WINDOW,
  IP_WINDOW_SECONDS,
  ipBucketKey,
  isWithinCallingHours,
  PHONE_MAX_PER_WINDOW,
  PHONE_WINDOW_SECONDS,
  phoneBucketKey,
  resolveProspect,
  SLUG_MAX_PER_WINDOW,
  SLUG_SPACING_MAX,
  SLUG_SPACING_SECONDS,
  SLUG_WINDOW_SECONDS,
  slugBucketKey,
  slugSpacingBucketKey,
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
/** Shared copy for "we didn't dial" outcomes that must stay indistinguishable. */
const CALL_UNAVAILABLE = "We couldn't start the call just now. We'll follow up.";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type RateCheck = { limited: boolean };

/**
 * FAILS CLOSED: an RPC error reports limited=true. This limiter is the primary
 * volume control on an endpoint that dials real phones.
 */
async function isRateLimited(
  supabase: ReturnType<typeof createClient>,
  bucketKey: string,
  windowSeconds: number,
  max: number,
): Promise<RateCheck> {
  const { data, error } = await supabase.rpc("bump_rate_limit", {
    p_bucket_key: bucketKey,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.warn("demo-callback: rate limit RPC failed, failing closed:", error.message);
    return { limited: true };
  }
  return { limited: typeof data === "number" && data > max };
}

async function logFunnelError(
  supabase: ReturnType<typeof createClient>,
  args: { clientId: string; leadId: string | null; errorType: string; message: string },
): Promise<void> {
  // A dead demo page fails invisibly to a prospect BFD is actively courting —
  // error_logs is what the operator actually watches, console is not.
  try {
    await supabase.from("error_logs").insert({
      client_id: args.clientId,
      lead_id: args.leadId,
      severity: "error",
      source: "demo-callback",
      error_type: args.errorType,
      error_message: args.message.slice(0, 500),
    });
  } catch (logErr) {
    console.warn("demo-callback: error_logs insert failed:", logErr);
  }
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
    const { firstName, email, normalizedPhone } = validation.value;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Rate limits, cheapest-to-evade first so every dimension always bumps ──
    const clientIp = clientIpFromHeaders(req.headers);
    const checks = await Promise.all([
      isRateLimited(supabase, phoneBucketKey(normalizedPhone), PHONE_WINDOW_SECONDS, PHONE_MAX_PER_WINDOW),
      clientIp
        ? isRateLimited(supabase, ipBucketKey(clientIp), IP_WINDOW_SECONDS, IP_MAX_PER_WINDOW)
        : Promise.resolve({ limited: false } as RateCheck),
      isRateLimited(supabase, slugBucketKey(prospect.slug), SLUG_WINDOW_SECONDS, SLUG_MAX_PER_WINDOW),
      isRateLimited(supabase, slugSpacingBucketKey(prospect.slug), SLUG_SPACING_SECONDS, SLUG_SPACING_MAX),
    ]);
    if (checks[0].limited) {
      return json({ error: "We've already called that number recently. Give it an hour." }, 429);
    }
    if (checks[1].limited) {
      return json({ error: "Too many requests. Try again in an hour." }, 429);
    }
    if (checks[2].limited || checks[3].limited) {
      return json({ error: "This demo is busy right now. Try again in a few minutes." }, 429);
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

    const clientTimezone = (client.timezone as string | null) ?? "Australia/Sydney";
    if (!isWithinCallingHours(new Date(), clientTimezone)) {
      // Honest decline beats an 11pm AI call on a compliance-flavoured pitch.
      return json({
        error: "Gary makes calls between 8am and 8pm AEST. Come back then and he'll ring you within a minute.",
      }, 422);
    }

    if (await isPhoneOptedOut(supabase, prospect.clientId, normalizedPhone)) {
      // Same shape and copy as a call-fire failure: an anonymous caller must
      // not be able to distinguish "opted out" from "call didn't start".
      return json({ error: CALL_UNAVAILABLE }, 502);
    }

    // Reuse the deterministic survivor lead when one exists, so we neither add
    // to the duplicate pile nor detach from an existing GHL contact. Only mint a
    // new GHL contact when there is genuinely no usable id.
    const existingLead = await resolveLeadByPhone(supabase, prospect.clientId, normalizedPhone);
    const existingLeadId = typeof existingLead?.lead_id === "string" ? existingLead.lead_id : "";
    const hasRealGhlId = Boolean(existingLeadId) && !existingLeadId.startsWith("bfd-");

    let contactId: string;
    let ghlDegraded = false;
    if (hasRealGhlId) {
      contactId = existingLeadId;
      // The reused contact must be as filterable and as reachable as a fresh
      // one: tag it, and refresh the email GHL will send the booking
      // confirmation to when the submitted address differs from the stored one.
      const ghlApiKey = client.ghl_api_key as string;
      void addContactTags({ ghlApiKey, contactId, tags: [DEMO_TAG] });
      const storedEmail = typeof existingLead?.email === "string" ? existingLead.email : "";
      if (email && email !== storedEmail.toLowerCase()) {
        const updated = await updateContactEmail({ ghlApiKey, contactId, email });
        if (!updated) {
          console.warn("demo-callback: contact email refresh failed; confirmation may go to the stored address");
        }
      }
    } else {
      try {
        // Shared impl returns a result object; this funnel only needs the id.
        ({ contactId } = await findOrCreateGhlContact({
          ghlApiKey: client.ghl_api_key as string,
          ghlLocationId: client.ghl_location_id as string,
          firstName,
          email,
          phone: normalizedPhone,
          source: `bfd-demo:${prospect.slug}`,
          tags: [DEMO_TAG],
        }));
      } catch (ghlErr) {
        if (!(ghlErr instanceof GhlContactError)) throw ghlErr;
        // GHL being down must not lose the submission — the captured email is
        // the funnel's durable value. Mint the platform's synthetic id (same
        // convention as receive-twilio-sms) so the lead persists; a later
        // successful submit self-heals via the hasRealGhlId path. No call is
        // placed: the demo's whole pitch is the booking, which needs GHL.
        contactId = `bfd-${normalizedPhone}`;
        ghlDegraded = true;
        console.warn("demo-callback: GHL contact resolve failed, persisting lead without a call:", ghlErr.message);
      }
    }

    const { error: leadError } = await supabase.from("leads").upsert({
      ...buildLeadInsert({
        clientId: prospect.clientId,
        leadId: contactId,
        firstName,
        lastName: null,
        phone: normalizedPhone,
        email,
        formSource: `bfd-demo:${prospect.slug}`,
      }),
    }, { onConflict: "client_id,lead_id" });
    if (leadError) {
      // The email capture is the durable value here, so a failed write is fatal
      // rather than silently dialling a lead we never recorded.
      console.error("demo-callback: lead upsert failed", leadError);
      await logFunnelError(supabase, {
        clientId: prospect.clientId,
        leadId: contactId,
        errorType: "lead_upsert_failed",
        message: leadError.message ?? "unknown",
      });
      return json({ error: "Demo is temporarily unavailable." }, 503);
    }

    if (ghlDegraded) {
      await logFunnelError(supabase, {
        clientId: prospect.clientId,
        leadId: contactId,
        errorType: "ghl_contact_resolve_failed",
        message: "lead persisted with synthetic id; no call placed",
      });
      return json({ error: CALL_UNAVAILABLE }, 502);
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
          timezone: clientTimezone,
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
      await logFunnelError(supabase, {
        clientId: prospect.clientId,
        leadId: contactId,
        errorType: "demo_call_fire_failed",
        message: `status ${callResponse.status}: ${String(callResult?.error ?? "unknown").slice(0, 200)}`,
      });
      // The lead is already saved, so the submission was not wasted.
      return json({ error: CALL_UNAVAILABLE }, 502);
    }

    console.log(`demo-callback: dialling for ${prospect.firmName} (${prospect.slug})`);
    return json({ ok: true });
  } catch (err) {
    console.error("demo-callback: unexpected error", err);
    return json({ error: "Something went wrong." }, 500);
  }
});
