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
import { normalizePhone } from "../_shared/phone.ts";
import { resolveLeadByPhone } from "../_shared/leadResolve.ts";
import { isPhoneOptedOut } from "../_shared/optout.ts";
import { bookingSourceFromBody } from "../_shared/toolBookingSource.ts";
import {
  pickCanonicalSlot,
  hasExplicitOffset,
  wallClockLocalToEpochMs,
  extractApptEvents,
  realEventIds,
  activeAppointments,
  findAppointmentAtInstant,
  type ApptEvent,
} from "./bookingHelpers.ts";

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

  // Bearer auth. These tools place calls, send SMS and book on the client's
  // behalf, so they FAIL CLOSED: a client with no intake_lead_secret configured
  // is not actionable by an unauthenticated caller (onboarding provisions the
  // secret). Previously a NULL secret skipped auth entirely (fail-open).
  if (client.intake_lead_secret) {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ToolError(401, "Authorization Bearer required for this client");
    }
    const presented = authHeader.slice("Bearer ".length).trim();
    if (!constantTimeEqual(presented, client.intake_lead_secret)) {
      throw new ToolError(403, "Invalid bearer token");
    }
  } else {
    throw new ToolError(401, "Client not configured for tool access (no intake_lead_secret set).");
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

// Fetch the raw GHL free-slots map for a window:
//   { "YYYY-MM-DD": { slots: ["<ISO with +offset>"] }, ..., "traceId": "..." }
// The slot strings are GHL's own canonical, correctly-offset times — the source of truth we book
// against. The voice model hand-builds its datetime from a bare "HH:MM" and frequently omits or
// mangles the timezone offset, which makes GHL reject a wide-open slot as "no longer available"
// (proven live: same slot books with +10:00, 400s without). Returns {} on any failure.
async function fetchSlotsRaw(
  client: ClientRow,
  calendarId: string,
  startMs: number,
  endMs: number,
): Promise<Record<string, { slots?: unknown }>> {
  const sp = new URLSearchParams();
  sp.set("startDate", String(startMs));
  sp.set("endDate", String(endMs));
  if (client.timezone) sp.set("timezone", client.timezone);
  const r = await ghlGet(`/calendars/${calendarId}/free-slots?${sp.toString()}`, client.ghl_api_key as string);
  const raw = r.body;
  if (r.status >= 400 || !raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, { slots?: unknown }>;
}

// Compact a raw free-slots map to { "YYYY-MM-DD": ["HH:MM", ...] } — the shape the agent already
// reads from {{available_time_slots}} (mirrors make-retell-outbound-call's compactSlots).
function compactRawSlots(raw: Record<string, { slots?: unknown }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue; // skip traceId and other noise
    const slots = (val as { slots?: unknown } | null)?.slots;
    if (!Array.isArray(slots)) continue;
    out[key] = slots.map((s) => {
      if (typeof s !== "string") return String(s);
      const m = s.match(/T(\d{2}:\d{2})/); // local HH:MM from the ISO timestamp
      return m ? m[1] : s;
    });
  }
  return out;
}

// Add minutes to an ISO datetime, preserving its timezone offset suffix (or Z).
function addMinutesPreserveOffset(iso: string, mins: number): string {
  const off = iso.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? "+00:00";
  const ms = new Date(iso).getTime() + mins * 60 * 1000;
  if (Number.isNaN(ms)) return iso;
  if (off === "Z") return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const sign = off.startsWith("-") ? -1 : 1;
  const oh = parseInt(off.slice(1, 3), 10);
  const om = parseInt(off.slice(4, 6), 10);
  const shifted = new Date(ms + sign * (oh * 60 + om) * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`
    + `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}${off}`;
}

// Match the agent's intended local day + HH:MM against GHL's own free-slot strings and return the
// canonical, correctly-offset slot string. We deliberately IGNORE any offset the model attached to
// startDateTime (it is frequently wrong/missing) and trust only the wall-clock it picked — the agent
// always works in the lead's timezone and reads HH:MM straight from availability. Returns
// { parsed, canonical }: parsed=false means we couldn't read a day+time (caller falls back to the
// raw string); parsed=true with canonical=null means that time is genuinely not an open slot.
async function resolveCanonicalSlot(
  client: ClientRow,
  calendarId: string,
  startDateTime: string,
): Promise<{ parsed: boolean; canonical: string | null }> {
  const dayM = startDateTime.match(/^(\d{4}-\d{2}-\d{2})/);
  const timeM = startDateTime.match(/T(\d{2}:\d{2})/);
  if (!dayM || !timeM) return { parsed: false, canonical: null };
  const day = dayM[1];
  const hhmm = timeM[1];
  // Window straddles the local day on both sides so it covers any timezone offset; GHL keys the
  // returned map by local date in the requested timezone, so we just read the [day] bucket.
  const base = Date.parse(`${day}T00:00:00Z`);
  const raw = await fetchSlotsRaw(client, calendarId, base - 86400000, base + 2 * 86400000);
  const slots = Array.isArray(raw[day]?.slots) ? (raw[day].slots as unknown[]) : [];
  // BOOK-2: exact wall-clock match first, else snap to the nearest real slot within a
  // tight tolerance so an off-by-a-minute model time isn't a false "unavailable".
  const canonical = pickCanonicalSlot(slots, hhmm);
  return { parsed: true, canonical };
}

// Build the recoverable "slot_unavailable" result carrying REAL alternative open times the agent
// can read back. Window: now (or the requested day, whichever is earlier) through requested day + 10
// days, widened once to +21 if empty. Never throws — degrades to a soft message.
async function buildSlotUnavailable(client: ClientRow, calendarId: string, startDateTime: string) {
  try {
    const reqMs = Date.parse(startDateTime);
    const nowMs = Date.now();
    const anchorMs = Number.isNaN(reqMs) ? nowMs : reqMs;
    const startMs = Math.min(nowMs, anchorMs);
    let available_slots = compactRawSlots(await fetchSlotsRaw(client, calendarId, startMs, anchorMs + 10 * 86400000));
    if (Object.keys(available_slots).length === 0) {
      available_slots = compactRawSlots(await fetchSlotsRaw(client, calendarId, startMs, anchorMs + 21 * 86400000));
    }
    const dates = Object.keys(available_slots);
    return {
      booked: false,
      status: "slot_unavailable",
      available_slots,
      message: dates.length
        ? "That time isn't available. Here are the real open times, only offer one of these: "
          + dates.map((d) => `${d}: ${available_slots[d].join(", ")}`).join(" | ")
        : "That time isn't available, and I couldn't find open times in the next few weeks. Ask the caller for a different week and I'll re-check.",
      retry_with_available_slots: true,
    };
  } catch (slotErr) {
    console.warn("voice-booking-tools: inline slot recovery failed (non-fatal)", slotErr);
    return {
      booked: false,
      status: "slot_unavailable",
      message: "That time isn't available anymore. Let me check the calendar for the current open times and offer you one of those.",
      retry_with_available_slots: true,
    };
  }
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

  // Internal-first: resolve against our leads table to get the deterministic
  // survivor lead_id, bypassing the non-deterministic GHL contacts[0] pick that
  // would attach bookings to an arbitrary duplicate contact.
  if (phone && supabase) {
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone) {
      const internalLead = await resolveLeadByPhone(supabase, client.id, normalizedPhone);
      if (internalLead && typeof internalLead.lead_id === "string" && internalLead.lead_id) {
        return { contactId: internalLead.lead_id, createdNew: false };
      }
    }
  }

  // GHL `query` is a FUZZY/partial match, so contacts[0] can be a different
  // contact whose phone/email merely overlaps the search term (booking would
  // attach to the wrong contact). Pull a few results and accept only one whose
  // phone (normalized) or email (lowercased) EXACTLY equals the search term.
  const tryQuery = async (term: string, kind: "phone" | "email"): Promise<string | null> => {
    const path = `/contacts/?locationId=${encodeURIComponent(client.ghl_location_id!)}&limit=5&query=${encodeURIComponent(term)}`;
    const r = await ghlGet(path, client.ghl_api_key as string);
    if (r.status >= 200 && r.status < 300) {
      const contacts = (r.body as any)?.contacts;
      if (Array.isArray(contacts)) {
        const wantPhone = kind === "phone" ? normalizePhone(term) : null;
        const wantEmail = kind === "email" ? term.trim().toLowerCase() : null;
        const match = contacts.find((c: any) => {
          if (typeof c?.id !== "string") return false;
          if (wantPhone) return normalizePhone(c?.phone ?? "") === wantPhone;
          if (wantEmail) return typeof c?.email === "string" && c.email.trim().toLowerCase() === wantEmail;
          return false;
        });
        if (match) return match.id as string;
      }
    } else if (r.status >= 500) {
      throw new ToolError(502, `GHL contact search failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    }
    return null;
  };

  // Phone-first (reliable for inbound), then email fallback
  if (phone) {
    const found = await tryQuery(phone, "phone");
    if (found) return { contactId: found, createdNew: false };
  }
  if (email) {
    const found = await tryQuery(email, "email");
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

  const timezone = pickStr(
    body.timeZone,
    body.timezone,
    url.searchParams.get("timeZone"),
    url.searchParams.get("timezone"),
  ) || client.timezone;
  const userId = pickStr(body.userId, url.searchParams.get("userId"));

  // BOOK-3: the model sends an offset-less ISO (setterTools tells it to); new Date()
  // reads that in the HOST tz (UTC on the edge host), skewing an Australia/Sydney lead's
  // window ~10h. Interpret a bare wall clock in the client/requested timezone instead.
  // Epoch-ms and offset-carrying strings pass through unchanged (both already correct).
  const toMs = (s: string): string => {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.trunc(n));
    if (timezone && !hasExplicitOffset(s)) {
      const ms = wallClockLocalToEpochMs(s, timezone);
      if (ms != null) return String(ms);
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return String(d.getTime());
    return s;
  };

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
// ── BOOK-ABORT-GHOST-1 / F24 helpers ───────────────────────────────────────

// F24: defensive appointment-id derivation. GHL normally returns { id }, but a 200 with
// an unexpected envelope must not silently drop the bookings write. Try the known shapes.
function deriveAppointmentId(appt: any): string | null {
  return appt?.id || appt?.appointmentId || appt?.event?.id || appt?.appointment?.id ||
    appt?.data?.id || appt?.data?.appointment?.id || null;
}

// F24: end any active cadence for this lead — a booking takes priority. Hoisted out of the
// `if (appointmentId)` gate so a just-booked lead's cadence ALWAYS ends, even when the id
// can't be derived from an odd GHL body (otherwise the booked lead keeps getting nudged).
// Keyed on the CONTACT. Best-effort — never throws.
async function endCadenceOnBooking(supabase: any, clientId: string, contactId: string): Promise<void> {
  try {
    const { data: active } = await supabase
      .from("engagement_executions")
      .select("id, trigger_run_id")
      .eq("ghl_contact_id", contactId)
      .eq("client_id", clientId)
      .in("status", ["pending", "running", "waiting"]);
    const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
    for (const exec of active || []) {
      await supabase
        .from("engagement_executions")
        .update({ status: "completed", stop_reason: "booking_created", completed_at: new Date().toISOString() })
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

// BOOK-ABORT-GHOST-1 (a): re-query GHL for an ACTIVE appointment already at the intended
// instant (idempotency). The text engine's 30s tool-caller can abort a create the edge fn
// still completed, so checking before create/retry prevents a duplicate ghost. Best-effort
// — returns null on any GHL error so a genuine first booking still proceeds.
async function findExistingAppointment(
  client: ClientRow,
  contactId: string,
  bookStart: string,
): Promise<ApptEvent | null> {
  try {
    const r = await ghlGet(`/contacts/${contactId}/appointments/`, client.ghl_api_key as string);
    if (r.status >= 400) return null;
    return findAppointmentAtInstant(extractApptEvents(r.body), bookStart);
  } catch {
    return null;
  }
}

// BOOK-ABORT-GHOST-1 (d): on a FINAL booking failure, text the lead a self-serve GHL
// calendar booking link so they can still book instantly. Best-effort — never throws.
async function sendBookingLinkFallback(
  client: ClientRow,
  contactId: string,
  calendarId: string,
  supabase: any,
): Promise<void> {
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("phone, normalized_phone")
      .eq("client_id", client.id)
      .eq("lead_id", contactId)
      .maybeSingle();
    const phone = (lead?.phone as string | null) || (lead?.normalized_phone as string | null);
    if (!phone) return;
    const link = `https://api.leadconnectorhq.com/widget/booking/${calendarId}`;
    await toolSendSms({
      client,
      body: {
        phone,
        message: `Sorry, I couldn't lock that time in just now. You can pick a time here and it'll book instantly: ${link}`,
      },
      supabase,
    });
  } catch (e) {
    console.warn("voice-booking-tools: booking-link fallback SMS failed (non-fatal)", e);
  }
}

async function toolBookAppointments(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;
  const startDateTime = typeof body.startDateTime === "string" ? body.startDateTime : null;
  const calendarId = (typeof body.calendarId === "string" && body.calendarId) || client.ghl_calendar_id;

  if (!startDateTime) throw new ToolError(400, "startDateTime is required");
  if (!calendarId) throw new ToolError(400, "No calendar id available");

  const { contactId } = await resolveContactId({ client, body, createIfMissing: true, supabase });

  // Resolve the canonical, correctly-offset slot string GHL itself returns, by matching the agent's
  // intended local day + HH:MM. This is the load-bearing fix: GHL rejects an open slot when the
  // model omits/mangles the timezone offset (proven live — same slot books with +10:00, 400s "no
  // longer available" without). Matching also validates availability in one step: a parsed time with
  // no matching open slot is simply not available, so we return real alternatives instead of firing
  // a doomed POST. If we can't parse a day+time at all, fall back to the raw string (last resort).
  let bookStart = startDateTime;
  const match = await resolveCanonicalSlot(client, calendarId, startDateTime);
  if (match.parsed) {
    if (!match.canonical) return await buildSlotUnavailable(client, calendarId, startDateTime);
    bookStart = match.canonical;
  } else if (Number.isNaN(new Date(startDateTime).getTime())) {
    throw new ToolError(400, `Invalid startDateTime: ${startDateTime}`);
  }
  const bookEnd = addMinutesPreserveOffset(bookStart, 30);

  // BOOK-ABORT-GHOST-1 (a) idempotency: a prior attempt — e.g. one the SMS engine's 30s
  // tool-caller aborted — may already have created THIS exact appointment server-side.
  // Re-query before creating and reuse it instead of minting a duplicate ghost. Also
  // ensure the cadence is ended (the just-booked lead must not keep getting nudged).
  const preExisting = await findExistingAppointment(client, contactId, bookStart);
  if (preExisting) {
    await endCadenceOnBooking(supabase, client.id, contactId);
    return { id: preExisting.id, startTime: preExisting.startTime ?? bookStart, status: preExisting.appointmentStatus ?? "confirmed", idempotent: true };
  }

  // Body shape mirrors the original upstream n8n workflow's bookAppointment
  // node: meetingLocationType + ignoreDateRange + toNotify + ignoreFreeSlotValidation
  // are all required by GHL for predictable behaviour even though they have
  // documented defaults.
  const ghlBody: Record<string, unknown> = {
    calendarId,
    locationId: client.ghl_location_id,
    contactId,
    startTime: bookStart,
    endTime: bookEnd,
    title: (typeof body.title === "string" && body.title) || client.gohighlevel_booking_title || "Appointment",
    meetingLocationType: "default",
    appointmentStatus: "confirmed",
    ignoreDateRange: false,
    toNotify: true,
    ignoreFreeSlotValidation: false,
  };
  if (client.ghl_assignee_id) ghlBody.assignedUserId = client.ghl_assignee_id;
  if (typeof body.notes === "string") ghlBody.notes = body.notes;

  // BOOK-ABORT-GHOST-1 (c): attempt the create, and on a NON-slot failure retry exactly
  // ONCE — but re-check idempotency between attempts (a failed/aborted first POST may have
  // actually landed) so the retry never double-books. A genuine slot rejection short-circuits
  // to real alternatives (never a retry, never "snapped up").
  let r = await ghlSend("POST", "/calendars/events/appointments", client.ghl_api_key as string, ghlBody);
  if (r.status >= 400) {
    const bodyStr = JSON.stringify(r.body);
    // A slot rejection here is a genuine race (the slot was taken between our match and this
    // POST) — return real alternatives rather than an opaque error.
    if (r.status === 400 && /no longer available|not available|slot/i.test(bodyStr)) {
      return await buildSlotUnavailable(client, calendarId, startDateTime);
    }
    // Non-slot failure (502 / timeout class): the first POST may have partially landed.
    const landed = await findExistingAppointment(client, contactId, bookStart);
    if (landed) {
      await endCadenceOnBooking(supabase, client.id, contactId);
      return { id: landed.id, startTime: landed.startTime ?? bookStart, status: landed.appointmentStatus ?? "confirmed", idempotent: true };
    }
    // Retry the create exactly once.
    r = await ghlSend("POST", "/calendars/events/appointments", client.ghl_api_key as string, ghlBody);
    if (r.status >= 400) {
      const retryStr = JSON.stringify(r.body);
      if (r.status === 400 && /no longer available|not available|slot/i.test(retryStr)) {
        return await buildSlotUnavailable(client, calendarId, startDateTime);
      }
      // BOOK-ABORT-GHOST-1 (d): final failure — text the lead a self-serve booking link so
      // they can still book, then surface an honest error (the caller must NOT say "snapped up").
      await sendBookingLinkFallback(client, contactId, calendarId, supabase);
      throw new ToolError(502, `GHL book-appointments failed ${r.status}: ${retryStr.slice(0, 300)}`);
    }
  }

  const appt = (r.body as any) ?? {};
  const appointmentId = deriveAppointmentId(appt); // F24: tolerant of odd 200 bodies
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
            appointment_time: bookStart,
            appointment_end_time: bookEnd,
            // §3.12: the SMS engine passes source="sms"; voice/Retell callers
            // never send a source, so this defaults to "voice_call" unchanged.
            source: bookingSourceFromBody(body),
            status: "confirmed",
            raw_payload: appt,
          },
          { onConflict: "client_id,ghl_appointment_id" },
        );
    } catch (writeErr) {
      console.warn("voice-booking-tools: bookings row write failed (non-fatal)", writeErr);
    }
  }

  // F24: end the cadence keyed on the CONTACT even when appointmentId couldn't be derived
  // (hoisted OUT of the id gate) — a 200 with an unrecognised body would otherwise leave
  // the just-booked lead in an active cadence, still getting follow-up SMS/calls.
  await endCadenceOnBooking(supabase, client.id, contactId);

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

// CANCEL-1: server-authoritative eventId binding for cancel + reschedule. The model
// (voice or SMS) may pass a HALLUCINATED eventId that matches nothing GHL returned
// (proven live: a fabricated id -> GHL 404 -> cancel silently fails). Before the
// mutating PUT, resolve the contact and confirm the id is one of their REAL
// appointments; if not, refuse and fold the real active list back so the model
// re-binds. Returns { checked:false } when we can't resolve the contact or list
// appointments (no identity / GHL error), the caller then proceeds unchanged, so
// callers that only have an eventId keep working (no regression).
async function verifyEventIdForContact(
  client: ClientRow,
  body: Record<string, unknown>,
  appointmentId: string,
  supabase: any,
): Promise<{ checked: boolean; valid: boolean; appointments: ApptEvent[] }> {
  let contactId: string;
  try {
    ({ contactId } = await resolveContactId({ client, body, createIfMissing: false, supabase }));
  } catch {
    return { checked: false, valid: false, appointments: [] };
  }
  const r = await ghlGet(`/contacts/${contactId}/appointments/`, client.ghl_api_key as string);
  if (r.status >= 400) return { checked: false, valid: false, appointments: [] };
  const events = extractApptEvents(r.body);
  return { checked: true, valid: realEventIds(events).has(appointmentId), appointments: activeAppointments(events) };
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

  // CANCEL-1: reject a fabricated eventId before mutating GHL (reschedule half).
  const idCheck = await verifyEventIdForContact(client, body, appointmentId, supabase);
  if (idCheck.checked && !idCheck.valid) {
    return {
      rescheduled: false,
      status: "event_not_found",
      message: "That appointment id is not one of this contact's appointments. Call get-contact-appointments and reschedule using the exact events[].id it returns; never invent an id.",
      appointments: idCheck.appointments,
    };
  }

  const calendarId = (typeof body.calendarId === "string" && body.calendarId) || client.ghl_calendar_id;

  const updateBody: Record<string, unknown> = {};
  // Reschedule has the same offset hazard as booking: canonicalise the new startTime against GHL's
  // own free-slot strings so the timezone offset is always correct (otherwise GHL rejects an open
  // slot as "no longer available"). A parsed-but-unmatched time means it isn't open — return real
  // alternatives instead of pushing a doomed PUT.
  let newStart: string | null = null;
  if (typeof body.startDateTime === "string") {
    if (calendarId) {
      const match = await resolveCanonicalSlot(client, calendarId, body.startDateTime);
      if (match.parsed && !match.canonical) return await buildSlotUnavailable(client, calendarId, body.startDateTime);
      newStart = match.canonical ?? body.startDateTime;
    } else {
      newStart = body.startDateTime;
    }
    updateBody.startTime = newStart;
    updateBody.endTime = (typeof body.endDateTime === "string")
      ? body.endDateTime
      : addMinutesPreserveOffset(newStart, 30);
  } else if (typeof body.endDateTime === "string") {
    updateBody.endTime = body.endDateTime;
  }
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
    if (newStart) mirrorPatch.appointment_time = newStart;
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

  // CANCEL-1: reject a fabricated eventId before mutating GHL.
  const check = await verifyEventIdForContact(client, body, appointmentId, supabase);
  if (check.checked && !check.valid) {
    return {
      cancelled: false,
      status: "event_not_found",
      message: "That appointment id is not one of this contact's appointments. Call get-contact-appointments and cancel using the exact events[].id it returns; never invent an id.",
      appointments: check.appointments,
    };
  }

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

  // Internal-first: resolve deterministic survivor from our leads table.
  let contactId: string | null = null;
  let matchQuality: "phone" | "email" | "none" = "none";
  if (phone && supabase) {
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone) {
      const internalLead = await resolveLeadByPhone(supabase, client.id, normalizedPhone);
      if (internalLead && typeof internalLead.lead_id === "string" && internalLead.lead_id) {
        contactId = internalLead.lead_id;
        matchQuality = "phone";
      }
    }
  }

  // Phone-first, then email — GHL fallback when no internal lead found. GHL
  // `query` is fuzzy, so accept only a result whose phone/email EXACTLY matches
  // the search term (else a booking attaches to an overlapping wrong contact).
  const tryQuery = async (term: string, kind: "phone" | "email"): Promise<string | null> => {
    const path = `/contacts/?locationId=${encodeURIComponent(client.ghl_location_id!)}&limit=5&query=${encodeURIComponent(term)}`;
    const r = await ghlGet(path, client.ghl_api_key as string);
    if (r.status >= 200 && r.status < 300) {
      const contacts = (r.body as any)?.contacts;
      if (Array.isArray(contacts)) {
        const wantPhone = kind === "phone" ? normalizePhone(term) : null;
        const wantEmail = kind === "email" ? term.trim().toLowerCase() : null;
        const match = contacts.find((c: any) => {
          if (typeof c?.id !== "string") return false;
          if (wantPhone) return normalizePhone(c?.phone ?? "") === wantPhone;
          if (wantEmail) return typeof c?.email === "string" && c.email.trim().toLowerCase() === wantEmail;
          return false;
        });
        if (match) return match.id as string;
      }
    } else if (r.status >= 500) {
      throw new ToolError(502, `GHL contact search failed ${r.status}`);
    }
    return null;
  };

  if (!contactId && phone) {
    contactId = await tryQuery(phone, "phone");
    if (contactId) matchQuality = "phone";
  }
  if (!contactId && email) {
    contactId = await tryQuery(email, "email");
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

  // By-phone opt-out gate (lead_optouts table). Complements the setter_stopped
  // guard above; catches leads who opted out via any SMS path, not just STOP.
  const optNp = normalizePhone(toNumber);
  if (optNp && await isPhoneOptedOut(supabase, client.id, optNp)) {
    return { sent: false, reason: "Contact has opted out; SMS not sent." };
  }

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

  // 4) SMS-METER-1: stamp the platform message_queue (channel='sms_outbound') so this
  //    mid-call text is counted by F13 usage metering, like every other Twilio-direct
  //    writer (ghl_account_id = location id or the client uuid). Non-fatal.
  try {
    await supabase.from("message_queue").insert({
      lead_id: contactId ?? toNumber,
      ghl_account_id: client.ghl_location_id ?? client.id,
      message_body: message,
      contact_phone: toNumber,
      channel: "sms_outbound",
      twilio_message_sid: sid,
      processed: true,
    });
  } catch (mqErr) { console.warn("send-sms: message_queue meter stamp failed (non-fatal):", mqErr); }

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
    // canonical upstream pattern per the original n8n workflow). Unwrap so
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
