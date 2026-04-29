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

// ── Tool: get-available-slots ─────────────────────────────────────────────
// Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&calendarId=<override>&timezone=<iana>
async function toolGetAvailableSlots(args: {
  client: ClientRow;
  url: URL;
}) {
  const { client, url } = args;
  const calendarId = url.searchParams.get("calendarId") || client.ghl_calendar_id;
  if (!calendarId) throw new ToolError(400, "No calendar id available");

  // GHL accepts startDate/endDate as ms epoch OR as YYYY-MM-DD; we forward
  // whatever the caller passes (Retell often uses ISO date strings).
  const sp = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (["startDate", "endDate", "timezone", "userId"].includes(k)) sp.set(k, v);
  }
  if (!sp.has("startDate") || !sp.has("endDate")) {
    throw new ToolError(400, "startDate and endDate query params required");
  }
  const r = await ghlGet(`/calendars/${calendarId}/free-slots?${sp.toString()}`, client.ghl_api_key as string);
  if (r.status >= 400) throw new ToolError(502, `GHL free-slots failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// ── Tool: book-appointments ───────────────────────────────────────────────
// Body: { contactId, startDateTime, endDateTime, title?, calendarId?, notes? }
async function toolBookAppointments(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;
  const contactId = typeof body.contactId === "string" ? body.contactId : null;
  const startDateTime = typeof body.startDateTime === "string" ? body.startDateTime : null;
  const endDateTime = typeof body.endDateTime === "string" ? body.endDateTime : null;
  const calendarId = (typeof body.calendarId === "string" && body.calendarId) || client.ghl_calendar_id;

  if (!contactId) throw new ToolError(400, "contactId is required");
  if (!startDateTime || !endDateTime) {
    throw new ToolError(400, "startDateTime and endDateTime are required (NOT startDate/endDate — GHL returns 422 otherwise)");
  }
  if (!calendarId) throw new ToolError(400, "No calendar id available");

  const ghlBody: Record<string, unknown> = {
    calendarId,
    contactId,
    startTime: startDateTime,
    endTime: endDateTime,
    title: (typeof body.title === "string" && body.title) || client.gohighlevel_booking_title || "Appointment",
    appointmentStatus: "confirmed",
    locationId: client.ghl_location_id,
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
// Query: ?contactId=<id>
async function toolGetContactAppointments(args: { client: ClientRow; url: URL }) {
  const { client, url } = args;
  const contactId = url.searchParams.get("contactId");
  if (!contactId) throw new ToolError(400, "contactId query param required");
  const r = await ghlGet(`/contacts/${contactId}/appointments/`, client.ghl_api_key as string);
  if (r.status >= 400) throw new ToolError(502, `GHL get-contact-appointments failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// ── Tool: update-appointment ──────────────────────────────────────────────
// Body: { appointmentId, startDateTime?, endDateTime?, title?, appointmentStatus? }
async function toolUpdateAppointment(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;
  const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId : null;
  if (!appointmentId) throw new ToolError(400, "appointmentId is required");

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
// Body: { appointmentId }
async function toolCancelAppointments(args: {
  client: ClientRow;
  body: Record<string, unknown>;
  supabase: any;
}) {
  const { client, body, supabase } = args;
  const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId : null;
  if (!appointmentId) throw new ToolError(400, "appointmentId is required");

  const r = await ghlSend("DELETE", `/calendars/events/appointments/${appointmentId}`, client.ghl_api_key as string);
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

    const body = await readJsonBody(req);

    let result: unknown;
    switch (tool) {
      case "get-available-slots":
        result = await toolGetAvailableSlots({ client, url });
        break;
      case "book-appointments":
      case "book-appointment":
        result = await toolBookAppointments({ client, body, supabase });
        break;
      case "get-contact-appointments":
        result = await toolGetContactAppointments({ client, url });
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
