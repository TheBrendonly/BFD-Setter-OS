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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
};

async function resolveClient(supabase: any, clientId: string, authHeader: string | null): Promise<ClientRow> {
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, ghl_api_key, ghl_calendar_id, ghl_location_id, ghl_assignee_id, gohighlevel_booking_title, intake_lead_secret")
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
// Mirrors the canonical 1prompt-os n8n booking workflow:
//   1. body.contactId wins if explicitly supplied.
//   2. Otherwise search GHL by email via `GET /contacts/?query=<email>`.
//   3. If not found AND createIfMissing, create via `POST /contacts/`
//      (honours memory `reference_ghl_contact_create_duplicate`: a 400 with
//      meta.contactId means a duplicate already exists — treat as found).
async function resolveContactId(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  createIfMissing: boolean;
}): Promise<string> {
  const { client, body, createIfMissing } = args;
  if (typeof body.contactId === "string" && body.contactId) return body.contactId;

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) throw new ToolError(400, "email or contactId is required");
  if (!client.ghl_location_id) throw new ToolError(409, "Client has no GHL locationId configured");

  // Step 1 — search by email (canonical n8n pattern)
  const searchPath = `/contacts/?locationId=${encodeURIComponent(client.ghl_location_id)}&limit=1&query=${encodeURIComponent(email)}`;
  const search = await ghlGet(searchPath, client.ghl_api_key as string);
  if (search.status >= 200 && search.status < 300) {
    const contacts = (search.body as any)?.contacts;
    if (Array.isArray(contacts) && contacts.length > 0 && typeof contacts[0]?.id === "string") {
      return contacts[0].id as string;
    }
  } else if (search.status >= 500) {
    throw new ToolError(502, `GHL contact search failed ${search.status}: ${JSON.stringify(search.body).slice(0, 300)}`);
  }

  // Step 2 — not found
  if (!createIfMissing) {
    throw new ToolError(404, `No GHL contact found for email ${email}`);
  }

  // Step 3 — create. Best-effort name from agent-supplied fields, fallback to email-prefix
  const firstName = typeof body.firstName === "string" ? body.firstName : null;
  const lastName = typeof body.lastName === "string" ? body.lastName : null;
  const phone = typeof body.phone === "string" ? body.phone : null;
  const derivedFirst = firstName || (email.split("@")[0] || "Lead").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();

  const createBody: Record<string, unknown> = {
    email,
    locationId: client.ghl_location_id,
    firstName: derivedFirst,
    source: "voice-booking-tools",
  };
  if (lastName) createBody.lastName = lastName;
  if (phone) createBody.phone = phone;

  const create = await ghlSend("POST", "/contacts/", client.ghl_api_key as string, createBody);
  if (create.status >= 200 && create.status < 300) {
    const id = ((create.body as any)?.contact?.id) || (create.body as any)?.id;
    if (id) return id as string;
    throw new ToolError(502, `GHL create-contact returned 2xx with no id: ${JSON.stringify(create.body).slice(0, 300)}`);
  }
  if (create.status === 400) {
    const dupId = (create.body as any)?.meta?.contactId;
    if (dupId) return dupId as string;
  }
  throw new ToolError(502, `GHL contact resolve failed ${create.status}: ${JSON.stringify(create.body).slice(0, 300)}`);
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
  );
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

  const contactId = await resolveContactId({ client, body, createIfMissing: true });

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
    throw new ToolError(502, `GHL book-appointments failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
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
    // Look up by email; do NOT create a contact for a read query
    const email = (typeof body.email === "string" && body.email) || url.searchParams.get("email");
    if (!email) throw new ToolError(400, "email or contactId is required");
    contactId = await resolveContactId({
      client,
      body: { email },
      createIfMissing: false,
    });
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

    let body = await readJsonBody(req);
    // Retell wraps custom-tool calls as { call: {...}, name: "<tool>", args: {...} }
    // when the tool's `args_at_root` setting is false (BFD's default and the
    // canonical 1prompt-os pattern per the original n8n workflow). Unwrap so
    // every handler can read params at the top level.
    if (body && typeof body === "object" && body.args && typeof body.args === "object" && !Array.isArray(body.args)) {
      body = body.args as Record<string, unknown>;
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
