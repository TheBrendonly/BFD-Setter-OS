// voice-booking-tools — native replacement for the n8n booking workflow.
//
// Phase 2 of the master rebuild. Single edge function dispatched on the
// `?tool=...` query param. Replaces the n8n workflow that Retell +
// ElevenLabs agents call for: get-available-slots, book-appointments,
// get-contact-appointments, update-appointment, cancel-appointments.
//
// Brendan flips the agent tool URLs from
//   https://primary-production-392b.up.railway.app/webhook/<tool>
// to
//   https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=<tool>&clientId=<uuid>
// per Phase 2 of the master plan (manual op).
//
// Auth model:
//   - clientId comes from the query string (per-agent, configured at
//     onboarding so the agent only ever talks for one tenant)
//   - If clients.intake_lead_secret is set, callers MUST send
//     `Authorization: Bearer <intake_lead_secret>`. Otherwise no auth
//     (backwards-compat / dev mode). Once Brendan rotates secrets and
//     repoints the Retell tool config, every voice-tool call requires
//     the bearer.
//
// Booking contract: `startDateTime` / `endDateTime` (NOT startDate/endDate)
// per memory `project_retell_booking_payload`. GHL returns 422 traceId
// otherwise.
//
// On a successful book-appointments, also writes a bookings row keyed by
// (client_id, ghl_appointment_id). UNIQUE constraint on that pair gives
// idempotent retries.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { pushSmsToGhl } from "../_shared/ghl-conversations.ts";
import { parseCallbackTime } from "../_shared/parseCallbackTime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";

class ToolError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ghlHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: GHL_VERSION,
    Accept: "application/json",
  };
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") return {};
  try {
    const j = await req.json();
    return (j && typeof j === "object" && !Array.isArray(j)) ? j as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

type ClientRow = {
  id: string;
  ghl_api_key: string | null;
  ghl_calendar_id: string | null;
  ghl_location_id: string | null;
  ghl_assignee_id: string | null;
  gohighlevel_booking_title: string | null;
  intake_lead_secret: string | null;
  timezone: string | null;
  // Added for the send-sms / schedule-callback tools.
  twilio_account_sid: string | null;
  twilio_auth_token: string | null;
  twilio_default_phone: string | null;
  retell_phone_1: string | null;
  ghl_conversation_provider_id: string | null;
  supabase_url: string | null;
  supabase_service_key: string | null;
};

async function resolveClient(supabase: any, clientId: string, authHeader: string | null): Promise<ClientRow> {
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, ghl_api_key, ghl_calendar_id, ghl_location_id, ghl_assignee_id, gohighlevel_booking_title, intake_lead_secret, timezone, twilio_account_sid, twilio_auth_token, twilio_default_phone, retell_phone_1, ghl_conversation_provider_id, supabase_url, supabase_service_key")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !client) throw new ToolError(404, "Client not found");
  if (!client.ghl_api_key) throw new ToolError(409, "Client has no GHL API key configured");

  // Optional bearer auth — required if the client has a secret set
  if (client.intake_lead_secret) {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ToolError(401, "Authorization Bearer required for this client");
    }
    const presented = authHeader.slice("Bearer ".length).trim();
    if (!constantTimeEqual(presented, client.intake_lead_secret)) {
      throw new ToolError(403, "Invalid bearer token");
    }
  }
  return client as ClientRow;
}

async function ghlGet(path: string, apiKey: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${GHL_BASE}${path}`, { headers: ghlHeaders(apiKey) });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

async function ghlSend(method: "POST" | "PUT" | "DELETE", path: string, apiKey: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = { method, headers: ghlHeaders(apiKey) };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`${GHL_BASE}${path}`, init);
  const respBody = await r.json().catch(() => null);
  return { status: r.status, body: respBody };
}

// Resolve a GHL contact for a voice-booking request.
//
// Lookup order:
//   1. body.contactId (explicit override)
//   2. Phone search via GHL `/contacts/?query=<phone>` — most reliable for
//      inbound calls (caller phone arrives via Retell's call object, no
//      transcription required).
//   3. Email search via GHL `/contacts/?query=<email>` — fallback for cases
//      where phone didn't match (e.g. caller dialled from a different number).
//   4. If still nothing AND createIfMissing, create via `POST /contacts/`
//      and log a `contact_merge_candidates` row so the agency can review
//      whether this caller is a duplicate of an existing contact.
//
// Returns { contactId, createdNew } so callers can decide downstream behaviour.
async function resolveContactId(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  createIfMissing: boolean;
  supabase?: any;
}): Promise<{ contactId: string; createdNew: boolean }> {
  const { client, body, createIfMissing, supabase } = args;
  if (typeof body.contactId === "string" && body.contactId) {
    return { contactId: body.contactId, createdNew: false };
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!phone && !email) throw new ToolError(400, "phone, email, or contactId is required");
  if (!client.ghl_location_id) throw new ToolError(409, "Client has no GHL locationId configured");

  const tryQuery = async (term: string): Promise<string | null> => {
    const path = `/contacts/?locationId=${encodeURIComponent(client.ghl_location_id!)}&limit=1&query=${encodeURIComponent(term)}`;
    const r = await ghlGet(path, client.ghl_api_key as string);
    if (r.status >= 200 && r.status < 300) {
      const contacts = (r.body as any)?.contacts;
      if (Array.isArray(contacts) && contacts.length > 0 && typeof contacts[0]?.id === "string") {
        return contacts[0].id as string;
      }
    } else if (r.status >= 500) {
      throw new ToolError(502, `GHL contact search failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    }
    return null;
  };

  // Phone-first (reliable for inbound), then email fallback
  if (phone) {
    const found = await tryQuery(phone);
    if (found) return { contactId: found, createdNew: false };
  }
  if (email) {
    const found = await tryQuery(email);
    if (found) return { contactId: found, createdNew: false };
  }

  if (!createIfMissing) {
    throw new ToolError(404, `No GHL contact found for ${phone || email}`);
  }

  // Create new contact
  const firstName = typeof body.firstName === "string" ? body.firstName : null;
  const lastName = typeof body.lastName === "string" ? body.lastName : null;
  const derivedFirst = firstName
    || (email ? (email.split("@")[0] || "Lead").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim() : "Caller");

  const createBody: Record<string, unknown> = {
    locationId: client.ghl_location_id,
    firstName: derivedFirst,
    source: "voice-booking-tools",
  };
  if (email) createBody.email = email;
  if (phone) createBody.phone = phone;
  if (lastName) createBody.lastName = lastName;

  const create = await ghlSend("POST", "/contacts/", client.ghl_api_key as string, createBody);
  let contactId: string | null = null;
  if (create.status >= 200 && create.status < 300) {
    contactId = ((create.body as any)?.contact?.id) || (create.body as any)?.id || null;
  } else if (create.status === 400) {
    const dupId = (create.body as any)?.meta?.contactId;
    if (dupId) contactId = dupId as string;
  }
  if (!contactId) {
    throw new ToolError(502, `GHL contact resolve failed ${create.status}: ${JSON.stringify(create.body).slice(0, 300)}`);
  }

  // Log merge-candidate row (best-effort). Voice-booking flows always create
  // contacts conservatively; the agency reviews this table to decide whether
  // a given new contact should actually be merged with an existing one.
  // High-priority candidates: caller said "yes" to "have we spoken before?".
  if (supabase) {
    try {
      const previouslyContacted = body.previously_contacted === true || body.previouslyContacted === true;
      const sourceCallId = typeof body.source_call_id === "string" ? body.source_call_id : null;
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || derivedFirst || null;
      await supabase.from("contact_merge_candidates").insert({
        client_id: client.id,
        ghl_contact_id: contactId,
        caller_phone: phone || null,
        caller_email: email || null,
        caller_name: fullName,
        caller_claims_prior_contact: previouslyContacted,
        source_call_id: sourceCallId,
        raw_payload: { create_response: create.body },
      });
    } catch (logErr) {
      console.warn("voice-booking-tools: contact_merge_candidates insert failed (non-fatal)", logErr);
    }
  }

  return { contactId, createdNew: true };
}

// ── Tool: get-available-slots ─────────────────────────────────────────────
// Inputs (body wins over URL):
//   startDateTime / endDateTime  (Retell convention, ISO 8601 with offset)
//   startDate / endDate          (legacy / URL convention; ms epoch or ISO)
//   timeZone / timezone          (IANA, e.g. Australia/Sydney)
//   calendarId                   (overrides client default)
//   userId                       (optional GHL user filter)
// GHL /calendars/{id}/free-slots requires startDate + endDate as ms epoch
// query params, so we always normalise to ms before forwarding.
async function toolGetAvailableSlots(args: {
  client: ClientRow;
  url: URL;
  body: Record<string, unknown>;
}) {
  const { client, url, body } = args;

  const pickStr = (...candidates: unknown[]): string | null => {
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
    }
    return null;
  };

  const calendarId = pickStr(body.calendarId, url.searchParams.get("calendarId")) || client.ghl_calendar_id;
  if (!calendarId) throw new ToolError(400, "No calendar id available");

  const startRaw = pickStr(
    body.startDateTime,
    body.startDate,
    url.searchParams.get("startDateTime"),
    url.searchParams.get("startDate"),
  );
  const endRaw = pickStr(
    body.endDateTime,
    body.endDate,
    url.searchParams.get("endDateTime"),
    url.searchParams.get("endDate"),
  );
  if (!startRaw || !endRaw) {
    throw new ToolError(400, "startDateTime and endDateTime are required (or startDate/endDate)");
  }

  const toMs = (s: string): string => {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.trunc(n));
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return String(d.getTime());
    return s;
  };

  const timezone = pickStr(
    body.timeZone,
    body.timezone,
    url.searchParams.get("timeZone"),
    url.searchParams.get("timezone"),
  ) || client.timezone;
  const userId = pickStr(body.userId, url.searchParams.get("userId"));

  const sp = new URLSearchParams();
  sp.set("startDate", toMs(startRaw));
  sp.set("endDate", toMs(endRaw));
  if (timezone) sp.set("timezone", timezone);
  if (userId) sp.set("userId", userId);

  const r = await ghlGet(`/calendars/${calendarId}/free-slots?${sp.toString()}`, client.ghl_api_key as string);
  if (r.status >= 400) throw new ToolError(502, `GHL free-slots failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// ── Tool: book-appointments ───────────────────────────────────────────────
// Body (matches Retell tool schema):
//   email           required (used to find or create GHL contact)
//   timeZone        optional informational (GHL infers slot offset from startDateTime)
//   startDateTime   required ISO 8601 with offset
//   endDateTime     optional — defaults to startDateTime + 30 min
//   firstName/lastName/phone  optional, used when creating a new contact
//   contactId       optional override (skips email lookup)
//   title/calendarId/notes    optional
async function toolBookAppointments(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;
  const startDateTime = typeof body.startDateTime === "string" ? body.startDateTime : null;
  let endDateTime = typeof body.endDateTime === "string" ? body.endDateTime : null;
  const calendarId = (typeof body.calendarId === "string" && body.calendarId) || client.ghl_calendar_id;

  if (!startDateTime) throw new ToolError(400, "startDateTime is required");
  if (!calendarId) throw new ToolError(400, "No calendar id available");

  // Default endDateTime to startDateTime + 30 min when the agent didn't supply one
  if (!endDateTime) {
    const start = new Date(startDateTime);
    if (Number.isNaN(start.getTime())) {
      throw new ToolError(400, `Invalid startDateTime: ${startDateTime}`);
    }
    endDateTime = new Date(start.getTime() + 30 * 60 * 1000).toISOString();
  }

  const { contactId } = await resolveContactId({ client, body, createIfMissing: true, supabase });

  // Body shape mirrors the canonical 1prompt-os n8n workflow's bookAppointment
  // node: meetingLocationType + ignoreDateRange + toNotify + ignoreFreeSlotValidation
  // are all required by GHL for predictable behaviour even though they have
  // documented defaults.
  const ghlBody: Record<string, unknown> = {
    calendarId,
    locationId: client.ghl_location_id,
    contactId,
    startTime: startDateTime,
    endTime: endDateTime,
    title: (typeof body.title === "string" && body.title) || client.gohighlevel_booking_title || "Appointment",
    meetingLocationType: "default",
    appointmentStatus: "confirmed",
    ignoreDateRange: false,
    toNotify: true,
    ignoreFreeSlotValidation: false,
  };
  if (client.ghl_assignee_id) ghlBody.assignedUserId = client.ghl_assignee_id;
  if (typeof body.notes === "string") ghlBody.notes = body.notes;

  const r = await ghlSend("POST", "/calendars/events/appointments", client.ghl_api_key as string, ghlBody);
  if (r.status >= 400) {
    // GHL rejects a slot that isn't actually free (e.g. the agent offered a time
    // that wasn't returned by get-available-slots, or it was taken since) with
    // 400 "The slot you have selected is no longer available." Return a clean,
    // recoverable result (HTTP 200 wrapper, booked:false) so the voice agent
    // re-checks availability and offers a real slot, instead of seeing an opaque
    // 502 Axios error. Other GHL errors still surface as a 502.
    const bodyStr = JSON.stringify(r.body);
    if (r.status === 400 && /no longer available|not available|slot/i.test(bodyStr)) {
      return {
        booked: false,
        status: "slot_unavailable",
        message: "That time isn't available anymore. Let me check the calendar for the current open times and offer you one of those.",
        retry_with_available_slots: true,
      };
    }
    throw new ToolError(502, `GHL book-appointments failed ${r.status}: ${bodyStr.slice(0, 300)}`);
  }

  const appt = (r.body as any) ?? {};
  const appointmentId = appt.id || appt.appointmentId || appt.event?.id || null;
  if (appointmentId) {
    try {
      await supabase
        .from("bookings")
        .upsert(
          {
            client_id: client.id,
            lead_id: contactId,
            ghl_appointment_id: appointmentId,
            ghl_calendar_id: calendarId,
            appointment_time: startDateTime,
            appointment_end_time: endDateTime,
            source: "voice_call",
            status: "confirmed",
            raw_payload: appt,
          },
          { onConflict: "client_id,ghl_appointment_id" },
        );
    } catch (writeErr) {
      console.warn("voice-booking-tools: bookings row write failed (non-fatal)", writeErr);
    }

    // End any active cadence for this lead — booking takes priority
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
            console.warn("Failed to cancel cadence trigger run on booking", cancelErr);
          }
        }
      }
    } catch (cadenceErr) {
      console.warn("voice-booking-tools: cadence end-on-booking failed (non-fatal)", cadenceErr);
    }
  }

  return r.body;
}

// ── Tool: get-contact-appointments ────────────────────────────────────────
// Inputs (body wins over URL):
//   email      required (Retell convention) — looked up to a GHL contact
//   contactId  optional override
async function toolGetContactAppointments(args: {
  client: ClientRow;
  url: URL;
  body: Record<string, unknown>;
}) {
  const { client, url, body } = args;
  let contactId: string | null = (typeof body.contactId === "string" && body.contactId)
    || url.searchParams.get("contactId");
  if (!contactId) {
    // Look up by phone (preferred for inbound) then email; never create a
    // contact for a read query.
    const lookupBody: Record<string, unknown> = {};
    const phone = (typeof body.phone === "string" && body.phone) || url.searchParams.get("phone");
    const email = (typeof body.email === "string" && body.email) || url.searchParams.get("email");
    if (phone) lookupBody.phone = phone;
    if (email) lookupBody.email = email;
    if (!phone && !email) throw new ToolError(400, "phone, email, or contactId is required");
    const resolved = await resolveContactId({
      client,
      body: lookupBody,
      createIfMissing: false,
    });
    contactId = resolved.contactId;
  }
  const r = await ghlGet(`/contacts/${contactId}/appointments/`, client.ghl_api_key as string);
  if (r.status >= 400) throw new ToolError(502, `GHL get-contact-appointments failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// ── Tool: update-appointment ──────────────────────────────────────────────
// Body: { eventId | appointmentId, startDateTime?, endDateTime?, title?, appointmentStatus? }
// Retell tool schema sends `eventId`; legacy callers used `appointmentId`. Both work.
async function toolUpdateAppointment(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;
  const appointmentId = (typeof body.appointmentId === "string" && body.appointmentId)
    || (typeof body.eventId === "string" && body.eventId)
    || null;
  if (!appointmentId) throw new ToolError(400, "appointmentId or eventId is required");

  const updateBody: Record<string, unknown> = {};
  if (typeof body.startDateTime === "string") updateBody.startTime = body.startDateTime;
  if (typeof body.endDateTime === "string") updateBody.endTime = body.endDateTime;
  if (typeof body.title === "string") updateBody.title = body.title;
  if (typeof body.appointmentStatus === "string") updateBody.appointmentStatus = body.appointmentStatus;
  if (Object.keys(updateBody).length === 0) {
    throw new ToolError(400, "Nothing to update");
  }

  const r = await ghlSend("PUT", `/calendars/events/appointments/${appointmentId}`, client.ghl_api_key as string, updateBody);
  if (r.status >= 400) throw new ToolError(502, `GHL update-appointment failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);

  // Mirror the change locally so /bookings stays current
  try {
    const mirrorPatch: Record<string, unknown> = { raw_payload: r.body };
    if (typeof body.startDateTime === "string") mirrorPatch.appointment_time = body.startDateTime;
    if (typeof body.endDateTime === "string") mirrorPatch.appointment_end_time = body.endDateTime;
    if (typeof body.appointmentStatus === "string") mirrorPatch.status = body.appointmentStatus;
    await supabase
      .from("bookings")
      .update(mirrorPatch)
      .eq("client_id", client.id)
      .eq("ghl_appointment_id", appointmentId);
  } catch (mirrorErr) {
    console.warn("voice-booking-tools: bookings update mirror failed (non-fatal)", mirrorErr);
  }

  return r.body;
}

// ── Tool: cancel-appointments ─────────────────────────────────────────────
// Body: { eventId | appointmentId }
// Retell tool schema sends `eventId`; legacy callers used `appointmentId`. Both work.
async function toolCancelAppointments(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;
  const appointmentId = (typeof body.appointmentId === "string" && body.appointmentId)
    || (typeof body.eventId === "string" && body.eventId)
    || null;
  if (!appointmentId) throw new ToolError(400, "appointmentId or eventId is required");

  // Soft-cancel via PUT with appointmentStatus="cancelled" rather than DELETE.
  // GHL DELETE on appointments requires an extra IAM scope on the PIT token
  // ("This route is not yet supported by the IAM Service.") that BFD's
  // current key doesn't have. Soft-cancel is the GHL-recommended pattern
  // anyway: preserves history, frees the calendar slot, suppresses reminders.
  const r = await ghlSend("PUT", `/calendars/events/appointments/${appointmentId}`, client.ghl_api_key as string, {
    appointmentStatus: "cancelled",
  });
  if (r.status >= 400) throw new ToolError(502, `GHL cancel-appointments failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);

  try {
    await supabase
      .from("bookings")
      .update({ status: "cancelled", raw_payload: r.body })
      .eq("client_id", client.id)
      .eq("ghl_appointment_id", appointmentId);
  } catch (mirrorErr) {
    console.warn("voice-booking-tools: bookings cancel mirror failed (non-fatal)", mirrorErr);
  }

  return r.body;
}

// ── Tool: lookup-contact ──────────────────────────────────────────────────
// Identity tool — designed to be called once near the start of every call so
// the LLM knows whether the caller is a known lead before asking questions.
// Body (via Retell args wrapper or top-level):
//   phone     optional — defaults to the caller's `from_number` from Retell
//             call meta (injected at dispatch). Passing it explicitly lets the
//             LLM re-check after the caller corrects the number.
//   email     optional secondary lookup
// Response shape:
//   {
//     match_quality: "phone" | "email" | "none",
//     contact: { id, firstName, lastName, fullName, email, phone, tags, customFieldValues } | null,
//     recent_bookings: Array<{ id, ghl_appointment_id, appointment_time, status, source }>,
//     latest_engagement: { status, current_node_index, started_at } | null,
//     last_message_preview: string | null,
//   }
// NEVER creates a new contact — strictly a read.
async function toolLookupContact(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!phone && !email) {
    return {
      match_quality: "none",
      contact: null,
      recent_bookings: [],
      latest_engagement: null,
      last_message_preview: null,
      reason: "no phone or email available",
    };
  }
  if (!client.ghl_location_id) throw new ToolError(409, "Client has no GHL locationId configured");

  // Phone-first, then email — same precedence as resolveContactId reads
  const tryQuery = async (term: string): Promise<string | null> => {
    const path = `/contacts/?locationId=${encodeURIComponent(client.ghl_location_id!)}&limit=1&query=${encodeURIComponent(term)}`;
    const r = await ghlGet(path, client.ghl_api_key as string);
    if (r.status >= 200 && r.status < 300) {
      const contacts = (r.body as any)?.contacts;
      if (Array.isArray(contacts) && contacts.length > 0 && typeof contacts[0]?.id === "string") {
        return contacts[0].id as string;
      }
    } else if (r.status >= 500) {
      throw new ToolError(502, `GHL contact search failed ${r.status}`);
    }
    return null;
  };

  let contactId: string | null = null;
  let matchQuality: "phone" | "email" | "none" = "none";
  if (phone) {
    contactId = await tryQuery(phone);
    if (contactId) matchQuality = "phone";
  }
  if (!contactId && email) {
    contactId = await tryQuery(email);
    if (contactId) matchQuality = "email";
  }

  if (!contactId) {
    return {
      match_quality: "none",
      contact: null,
      recent_bookings: [],
      latest_engagement: null,
      last_message_preview: null,
    };
  }

  // Pull the full contact record from GHL — adds firstName/lastName/email/tags/customFieldValues
  const detail = await ghlGet(`/contacts/${contactId}`, client.ghl_api_key as string);
  const c = ((detail.body as any)?.contact) ?? {};
  const firstName = typeof c.firstName === "string" ? c.firstName : null;
  const lastName = typeof c.lastName === "string" ? c.lastName : null;
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  // Recent bookings for this contact in this client (DB-side, not GHL)
  let recent_bookings: Array<Record<string, unknown>> = [];
  try {
    const { data } = await supabase
      .from("bookings")
      .select("id, ghl_appointment_id, appointment_time, status, source")
      .eq("client_id", client.id)
      .eq("lead_id", contactId)
      .order("appointment_time", { ascending: false })
      .limit(3);
    if (Array.isArray(data)) recent_bookings = data as Array<Record<string, unknown>>;
  } catch (bookingsErr) {
    console.warn("voice-booking-tools/lookup-contact: bookings lookup failed (non-fatal)", bookingsErr);
  }

  // Latest engagement_executions row keyed by ghl_contact_id (matches book-appointments cadence-end query)
  let latest_engagement: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase
      .from("engagement_executions")
      .select("status, current_node_index, started_at, completed_at, stop_reason")
      .eq("client_id", client.id)
      .eq("ghl_contact_id", contactId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) latest_engagement = data as Record<string, unknown>;
  } catch (engErr) {
    console.warn("voice-booking-tools/lookup-contact: engagement lookup failed (non-fatal)", engErr);
  }

  // Last inbound message preview from leads.last_message_preview (best-effort; column exists per memory)
  let last_message_preview: string | null = null;
  try {
    const { data } = await supabase
      .from("leads")
      .select("last_message_preview")
      .eq("client_id", client.id)
      .eq("lead_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && typeof (data as any).last_message_preview === "string") {
      last_message_preview = (data as any).last_message_preview;
    }
  } catch (leadErr) {
    console.warn("voice-booking-tools/lookup-contact: leads preview lookup failed (non-fatal)", leadErr);
  }

  return {
    match_quality: matchQuality,
    contact: {
      id: contactId,
      firstName,
      lastName,
      fullName,
      email: typeof c.email === "string" ? c.email : null,
      phone: typeof c.phone === "string" ? c.phone : null,
      tags: Array.isArray(c.tags) ? c.tags : [],
      customFieldValues: Array.isArray(c.customFields) ? c.customFields : [],
    },
    recent_bookings,
    latest_engagement,
    last_message_preview,
  };
}

// ── Tool: send-sms ── voice agent texts the lead mid-call. Sends immediately
// and writes the message to the lead's conversation history (external
// chat_history as an "ai" turn) + mirrors to GHL Conversations, so the text
// setter has the context the instant the lead replies.
async function toolSendSms(args: { client: ClientRow; body: Record<string, unknown>; supabase: any }): Promise<unknown> {
  const { client, body, supabase } = args;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) throw new ToolError(400, "message is required");

  const { contactId } = await resolveContactId({ client, body, createIfMissing: false, supabase });

  // Opt-out guard (compliance): never text a contact who replied STOP.
  const { data: leadRow } = await supabase
    .from("leads").select("setter_stopped").eq("client_id", client.id).eq("lead_id", contactId).maybeSingle();
  if (leadRow?.setter_stopped === true) {
    return { sent: false, reason: "Contact has opted out (STOP); SMS not sent." };
  }

  const toNumber = typeof body.phone === "string" ? body.phone : null;
  const fromNumber = client.twilio_default_phone || client.retell_phone_1;
  if (!client.twilio_account_sid || !client.twilio_auth_token || !fromNumber) {
    throw new ToolError(409, "Twilio is not configured for this client.");
  }
  if (!toNumber) throw new ToolError(400, "No phone number for the lead.");

  // 1) Send via Twilio.
  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${client.twilio_account_sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${client.twilio_account_sid}:${client.twilio_auth_token}`)}`,
      },
      body: new URLSearchParams({ From: fromNumber, To: toNumber, Body: message }).toString(),
    },
  );
  const twilioJson = await twilioRes.json().catch(() => null);
  if (!twilioRes.ok) {
    throw new ToolError(502, `Twilio send failed (${twilioRes.status}): ${twilioJson?.message || "unknown"}`);
  }
  const sid: string | null = twilioJson?.sid ?? null;

  // 2) Write to the lead's conversation history on the EXTERNAL client DB so the
  //    text setter reads it as a prior assistant turn (type:"ai") immediately.
  if (client.supabase_url && client.supabase_service_key) {
    try {
      const ext = createClient(client.supabase_url, client.supabase_service_key);
      await ext.from("chat_history").insert({
        session_id: contactId,
        message: { type: "ai", content: message, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] },
        timestamp: new Date().toISOString(),
      });
    } catch (e) { console.warn("send-sms: chat_history write failed (non-fatal):", e); }
  }

  // 3) Mirror to GHL Conversations + bump leads.last_outbound_at.
  try {
    await pushSmsToGhl({
      ghlApiKey: client.ghl_api_key as string,
      ghlLocationId: client.ghl_location_id as string,
      contactId, conversationProviderId: client.ghl_conversation_provider_id ?? null,
      message, direction: "outbound", altId: sid,
    });
  } catch (e) { console.warn("send-sms: GHL mirror failed (non-fatal):", e); }
  try {
    await supabase.from("leads").update({ last_outbound_at: new Date().toISOString() })
      .eq("client_id", client.id).eq("lead_id", contactId);
  } catch { /* non-fatal */ }

  return { sent: true, sid };
}

// ── Tool: schedule-callback ── voice agent schedules an AI callback at a time
// the lead asked for (reuses the scheduled_callbacks + scheduleCallback task).
async function toolScheduleCallback(args: { client: ClientRow; body: Record<string, unknown>; callMeta: Record<string, unknown> | null; supabase: any }): Promise<unknown> {
  const { client, body, callMeta, supabase } = args;
  const when = typeof body.when === "string" ? body.when : (typeof body.time === "string" ? body.time : "later");
  const { contactId } = await resolveContactId({ client, body, createIfMissing: false, supabase });

  // voice_setter_id: prefer the call's dynamic var, else the client's first active setter.
  const dv = (callMeta && typeof callMeta.retell_llm_dynamic_variables === "object" && callMeta.retell_llm_dynamic_variables)
    ? callMeta.retell_llm_dynamic_variables as Record<string, unknown> : {};
  let voiceSetterId = typeof dv.voice_setter_id === "string" ? dv.voice_setter_id : null;
  if (!voiceSetterId) {
    const { data: vs } = await supabase.from("voice_setters").select("id")
      .eq("client_id", client.id).eq("is_active", true).order("legacy_slot", { ascending: true }).limit(1).maybeSingle();
    voiceSetterId = vs?.id ?? null;
  }
  if (!voiceSetterId) throw new ToolError(409, "No voice setter available to call back with.");

  const parsed = parseCallbackTime(when, new Date(), client.timezone || "Australia/Brisbane");
  const { data: cbRow, error: cbErr } = await supabase.from("scheduled_callbacks").insert({
    client_id: client.id, ghl_contact_id: contactId, ghl_account_id: client.ghl_location_id,
    voice_setter_id: voiceSetterId, call_id: (typeof body.source_call_id === "string" ? body.source_call_id : null),
    contact_phone: (typeof body.phone === "string" ? body.phone : null),
    scheduled_for: parsed.scheduledFor, callback_reason: parsed.reason, status: "pending",
  }).select("id").single();

  // CAD-03: a partial unique index allows only one PENDING callback per
  // (client, contact). A 23505 here means one is already scheduled (an earlier
  // call, or a race with the post-call webhook) — confirm the existing one
  // rather than creating a duplicate dial or falsely telling the caller it
  // failed. Don't re-trigger: the existing row already has its own task run.
  if (cbErr && (cbErr as { code?: string }).code === "23505") {
    const { data: existing } = await supabase.from("scheduled_callbacks")
      .select("scheduled_for, callback_reason")
      .eq("client_id", client.id).eq("ghl_contact_id", contactId).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return {
      scheduled: true,
      already_scheduled: true,
      scheduled_for: existing?.scheduled_for ?? parsed.scheduledFor,
      when: existing?.callback_reason ?? parsed.reason,
    };
  }

  // Don't falsely confirm: if the row didn't persist, surface a tool error so the
  // agent re-tries / tells the caller, rather than promising a callback we lost.
  if (cbErr || !cbRow?.id) {
    console.error("voice-booking-tools schedule-callback insert failed", cbErr);
    throw new ToolError(502, "Could not schedule the callback right now.");
  }

  const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
  if (triggerKey) {
    const tr = await fetch("https://api.trigger.dev/api/v1/tasks/schedule-callback/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${triggerKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { scheduled_callback_id: cbRow.id } }),
    });
    if (!tr.ok) {
      console.error("voice-booking-tools schedule-callback trigger failed", tr.status, await tr.text().catch(() => ""));
      throw new ToolError(502, "Could not schedule the callback right now.");
    }
  }
  return { scheduled: true, scheduled_for: parsed.scheduledFor, when: parsed.reason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const tool = url.searchParams.get("tool");
    const clientId = url.searchParams.get("clientId");
    if (!tool) throw new ToolError(400, "tool query param required");
    if (!clientId) throw new ToolError(400, "clientId query param required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const client = await resolveClient(supabase, clientId, req.headers.get("Authorization"));

    const rawBody = await readJsonBody(req);
    let body: Record<string, unknown>;
    // Retell wraps custom-tool calls as { call: {...}, name: "<tool>", args: {...} }
    // when the tool's `args_at_root` setting is false (BFD's default and the
    // canonical 1prompt-os pattern per the original n8n workflow). Unwrap so
    // every handler can read params at the top level. ALSO inject the caller's
    // phone from the Retell call object so tools that need a contact lookup
    // can search GHL by phone (more reliable than spelled-out email for
    // inbound calls).
    const callMeta: Record<string, unknown> | null = (rawBody && typeof rawBody === "object" && rawBody.call && typeof rawBody.call === "object" && !Array.isArray(rawBody.call))
      ? rawBody.call as Record<string, unknown>
      : null;
    if (rawBody && typeof rawBody === "object" && rawBody.args && typeof rawBody.args === "object" && !Array.isArray(rawBody.args)) {
      body = { ...(rawBody.args as Record<string, unknown>) };
    } else {
      body = { ...(rawBody as Record<string, unknown>) };
    }
    if (callMeta) {
      // Inject caller phone if agent didn't pass one explicitly. Inbound = the
      // caller is `from_number`; outbound = the lead is `to_number`.
      if (typeof body.phone !== "string" || !body.phone) {
        const direction = typeof callMeta.direction === "string" ? callMeta.direction : null;
        const phone = direction === "inbound"
          ? (typeof callMeta.from_number === "string" ? callMeta.from_number : null)
          : (typeof callMeta.to_number === "string" ? callMeta.to_number : null);
        if (phone) body.phone = phone;
      }
      if (typeof callMeta.call_id === "string" && (typeof body.source_call_id !== "string" || !body.source_call_id)) {
        body.source_call_id = callMeta.call_id;
      }
    }

    let result: unknown;
    switch (tool) {
      case "get-available-slots":
        result = await toolGetAvailableSlots({ client, url, body });
        break;
      case "book-appointments":
      case "book-appointment":
        result = await toolBookAppointments({ client, body, supabase });
        break;
      case "get-contact-appointments":
        result = await toolGetContactAppointments({ client, url, body });
        break;
      case "update-appointment":
        result = await toolUpdateAppointment({ client, body, supabase });
        break;
      case "cancel-appointment":
      case "cancel-appointments":
        result = await toolCancelAppointments({ client, body, supabase });
        break;
      case "lookup-contact":
      case "lookup_contact":
        result = await toolLookupContact({ client, body, supabase });
        break;
      case "send-sms":
      case "send_sms":
        result = await toolSendSms({ client, body, supabase });
        break;
      case "schedule-callback":
      case "schedule_callback":
        result = await toolScheduleCallback({ client, body, callMeta, supabase });
        break;
      default:
        throw new ToolError(400, `Unknown tool: ${tool}`);
    }
    return jsonResponse({ ok: true, tool, result });
  } catch (err) {
    if (err instanceof ToolError) {
      return jsonResponse({ ok: false, error: err.message }, err.status);
    }
    console.error("voice-booking-tools error:", err);
    return jsonResponse({ ok: false, error: (err as Error).message ?? "Internal server error" }, 500);
  }
});
