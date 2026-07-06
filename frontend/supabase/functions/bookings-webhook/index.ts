// bookings-webhook — receives GHL appointment-created/updated/cancelled.
//
// Phase 7c of the master rebuild. Brendan wires the GHL "Calendar
// Appointment Created/Updated/Cancelled" workflow to POST to this URL.
// We upsert into the bookings table (UNIQUE on
// client_id + ghl_appointment_id) and end any active cadence with
// stop_reason='booking_created' (cancelled / no-show paths just mirror
// the status — they don't restart cadences).
//
// Auth: GHL Webhook V2 sends `x-wh-signature` (HMAC-SHA256 over the raw
// body, signed with the webhook secret). We require Webhook V2 — set
// clients.ghl_webhook_secret per location. Without a secret on the
// client row, we accept POSTs (backwards-compat dev mode); once Brendan
// turns on Webhook V2 and stamps the secret, signature verification is
// mandatory.
//
// Note: GHL's payload shape varies slightly across event types. We
// extract { appointmentId, contactId, calendarId, startTime, endTime,
// status, source } as best-effort from common shapes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveBookingSource } from "../_shared/bookingSource.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wh-signature, x-wh-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

// GHL workflow custom-webhook merge tags emit times as TZ-naive locale
// strings ("Tuesday, 5 May 2026 2:06 PM") rendered in the location's wall
// clock. Interpret them as being in `tz` and return ISO-with-offset.
// ISO-shaped inputs (with T + Z|±hh:mm) are passed through unchanged.
function parseGhlTimestamp(s: string | null, tz: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s;
  const naive = new Date(s);
  if (isNaN(naive.getTime())) return null;
  const wallInTz = naive.toLocaleString("sv-SE", { timeZone: tz, hour12: false });
  const tzAsIfUtc = new Date(wallInTz.replace(" ", "T") + "Z").getTime();
  const offsetMs = naive.getTime() - tzAsIfUtc;
  return new Date(naive.getTime() + offsetMs).toISOString();
}

// Constant-time string compare for the static-token webhook proof.
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

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
  // GHL sends hex-encoded SHA256 (per their Webhook V2 docs)
  let hex = "";
  for (const b of sigBytes) hex += b.toString(16).padStart(2, "0");
  const expectedHex = hex.toLowerCase();
  // Some GHL instances ship sha256= prefixed; tolerate either
  const presented = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
  if (expectedHex.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    mismatch |= expectedHex.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  try {
    const rawBody = await req.text();
    let body: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawBody);
      if (isRecord(parsed)) body = parsed;
    } catch {
      // GHL sometimes posts form-urlencoded — try that
      const params = new URLSearchParams(rawBody);
      body = Object.fromEntries(params.entries());
    }

    // Extract canonical fields
    const appt = isRecord(body.appointment) ? body.appointment : isRecord(body.event) ? body.event : body;
    const locationField = isRecord(body.location) ? body.location : null;

    const ghlLocationId = pickString(
      body.locationId, body.location_id, body.location_Id,
      locationField?.id, locationField?.locationId,
      appt.locationId, appt.location_id,
    );
    const appointmentId = pickString(
      body.appointmentId, body.id, body.appointment_id,
      appt.id, appt.appointmentId, appt.appointment_id,
    );
    const contactId = pickString(
      body.contactId, body.contact_id, body.contact_Id,
      appt.contactId, appt.contact_id,
    );
    const calendarId = pickString(
      body.calendarId, body.calendar_id, appt.calendarId, appt.calendar_id,
    );
    const startTime = pickString(
      body.startTime, body.start_time, body.startDateTime,
      appt.startTime, appt.start_time, appt.startDateTime,
    );
    const endTime = pickString(
      body.endTime, body.end_time, body.endDateTime,
      appt.endTime, appt.end_time, appt.endDateTime,
    );

    // Map GHL status / event → our bookings.status
    const eventType = pickString(body.type, body.event_type, body.eventType);
    const apptStatus = pickString(
      body.appointmentStatus, body.status,
      appt.appointmentStatus, appt.status,
    )?.toLowerCase() ?? null;

    let mappedStatus: string = "confirmed";
    if (apptStatus === "cancelled" || eventType?.toLowerCase().includes("cancel")) {
      mappedStatus = "cancelled";
    } else if (apptStatus === "noshow" || apptStatus === "no_show" || apptStatus === "no-show") {
      mappedStatus = "no_show";
    } else if (apptStatus === "showed" || apptStatus === "attended" || apptStatus === "completed") {
      mappedStatus = "attended";
    } else if (apptStatus) {
      mappedStatus = apptStatus;
    }

    if (!appointmentId || !ghlLocationId) {
      console.warn("bookings-webhook: missing appointmentId or locationId", { appointmentId, ghlLocationId });
      // Acknowledge so GHL doesn't retry forever
      return jsonResponse({ ok: false, error: "Missing required fields" }, 200);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve client by GHL location id (so we can look up its webhook secret)
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, ghl_webhook_secret, timezone")
      .eq("ghl_location_id", ghlLocationId)
      .maybeSingle();
    if (clientErr || !client) {
      console.warn("bookings-webhook: no client for location", ghlLocationId);
      return jsonResponse({ ok: false, error: "client not found" }, 200);
    }

    // Optional webhook auth (mandatory once Brendan stamps the secret). Two
    // proofs (mirrors sync-ghl-contact): a static `x-wh-token` header equal to
    // the secret (GHL Workflow Custom-Webhook custom header, SOP §5.3) or an
    // HMAC-SHA256 `x-wh-signature` over the raw body. GHL *native* Webhook V2
    // signs with RSA and is NOT supported.
    if (client.ghl_webhook_secret) {
      const secret = client.ghl_webhook_secret as string;
      const tokenOk = ctEqual(req.headers.get("x-wh-token") ?? "", secret);
      const sigOk = tokenOk ||
        await verifyGhlSignature(rawBody, req.headers.get("x-wh-signature"), secret);
      if (!sigOk) {
        console.warn("bookings-webhook: GHL signature mismatch", { clientId: client.id, ghlLocationId });
        return jsonResponse({ ok: false, error: "Forbidden" }, 403);
      }
    }

    // Read the existing booking source (if any) so we can preserve a
    // higher-fidelity origin (e.g. voice_call) when GHL fires a confirm/attend
    // event for an appointment that was already created by the voice agent.
    const { data: existingBooking, error: selectErr } = await supabase
      .from("bookings")
      .select("id, source, status")
      .eq("client_id", client.id)
      .eq("ghl_appointment_id", appointmentId)
      .maybeSingle();
    if (selectErr) {
      console.error("bookings-webhook: failed to read existing booking source", selectErr);
      return jsonResponse({ ok: false, error: "existing booking read failed" }, 500);
    }
    const existingSource = existingBooking?.source as string | null | undefined;
    const previousStatus = (existingBooking?.status as string | null) ?? null;

    // Upsert bookings row (idempotent on UNIQUE (client_id, ghl_appointment_id))
    const upsertRow: Record<string, unknown> = {
      client_id: client.id,
      ghl_appointment_id: appointmentId,
      status: mappedStatus,
      raw_payload: body,
    };
    const clientTz = (client.timezone as string | null) || "Australia/Sydney";
    const startIso = parseGhlTimestamp(startTime, clientTz);
    const endIso = parseGhlTimestamp(endTime, clientTz);
    if (contactId) upsertRow.lead_id = contactId;
    if (calendarId) upsertRow.ghl_calendar_id = calendarId;
    if (startIso) upsertRow.appointment_time = startIso;
    if (endIso) upsertRow.appointment_end_time = endIso;
    if (mappedStatus === "confirmed" || mappedStatus === "attended") {
      upsertRow.source = resolveBookingSource(existingSource, "ghl_calendar");
    }

    const { error: upsertErr } = await supabase
      .from("bookings")
      .upsert(upsertRow, { onConflict: "client_id,ghl_appointment_id" });
    if (upsertErr) {
      console.error("bookings-webhook: upsert failed", upsertErr);
      return jsonResponse({ ok: false, error: "upsert failed" }, 500);
    }

    // F15(a) show-rate funnel: append the status transition (best-effort; never
    // fail the webhook). Only logged when the status actually changed, so a GHL
    // re-fire of the same status is idempotent.
    if (previousStatus !== mappedStatus) {
      try {
        let bookingId = (existingBooking?.id as string | null) ?? null;
        if (!bookingId) {
          const { data: fresh } = await supabase
            .from("bookings")
            .select("id")
            .eq("client_id", client.id)
            .eq("ghl_appointment_id", appointmentId)
            .maybeSingle();
          bookingId = (fresh?.id as string | null) ?? null;
        }
        await supabase.from("booking_status_events").insert({
          client_id: client.id,
          booking_id: bookingId,
          ghl_appointment_id: appointmentId,
          from_status: previousStatus,
          to_status: mappedStatus,
          source: (upsertRow.source as string | null) ?? existingSource ?? null,
          raw: body,
        });
      } catch (evErr) {
        console.warn("bookings-webhook: booking_status_events insert failed (non-fatal)", evErr);
      }
    }

    // End any active cadence on appointment-created/confirmed
    if (mappedStatus === "confirmed" && contactId) {
      try {
        const { data: active } = await supabase
          .from("engagement_executions")
          .select("id, trigger_run_id")
          .eq("ghl_contact_id", contactId)
          .eq("client_id", client.id)
          .in("status", ["pending", "running", "waiting"]);
        const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
        for (const exec of active || []) {
          await supabase
            .from("engagement_executions")
            .update({
              status: "completed",
              stop_reason: "booking_created",
              completed_at: new Date().toISOString(),
            })
            .eq("id", exec.id);
          if (exec.trigger_run_id && triggerKey) {
            try {
              await fetch(`https://api.trigger.dev/api/v2/runs/${exec.trigger_run_id}/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${triggerKey}`, "Content-Type": "application/json" },
              });
            } catch (cancelErr) {
              console.warn("bookings-webhook: cadence cancel failed (non-fatal)", cancelErr);
            }
          }
        }
      } catch (cadenceErr) {
        console.warn("bookings-webhook: cadence end-on-booking failed (non-fatal)", cadenceErr);
      }
    }

    return jsonResponse({
      ok: true,
      appointmentId,
      status: mappedStatus,
    });
  } catch (err) {
    console.error("bookings-webhook error:", err);
    return jsonResponse({ ok: false, error: (err as Error).message ?? "Internal server error" }, 500);
  }
});
