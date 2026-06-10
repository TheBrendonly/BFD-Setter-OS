import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Optional GHL Webhook V2 signature verification (HMAC-SHA256 hex over the raw
// body, keyed by clients.ghl_webhook_secret). Mirrors bookings-webhook. Only
// enforced once the resolved client has the secret set; otherwise accept.
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
  let hex = "";
  for (const b of sigBytes) hex += b.toString(16).padStart(2, "0");
  const expectedHex = hex.toLowerCase();
  const presented = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
  if (expectedHex.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    mismatch |= expectedHex.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function pickFirstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
}

function composeName(record: Record<string, unknown>): string | undefined {
  const firstName = firstNonEmptyString(record.firstName, record.first_name, record.first);
  const lastName = firstNonEmptyString(record.lastName, record.last_name, record.last);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || undefined;
}

interface ClientRecord {
  id: string;
  name: string | null;
  ghl_api_key: string | null;
  ghl_calendar_id: string | null;
  ghl_location_id: string | null;
  ghl_webhook_secret: string | null;
}

interface GhlAppointmentLookupResult {
  appointment: Record<string, unknown> | null;
  errorDetail: string | null;
}

async function fetchGhlAppointment(apiKey: string, bookingId: string): Promise<GhlAppointmentLookupResult> {
  try {
    const ghlRes = await fetch(`https://services.leadconnectorhq.com/calendars/events/appointments/${bookingId}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Version": "2021-04-15",
        "Accept": "application/json",
      },
    });

    if (!ghlRes.ok) {
      const errText = await ghlRes.text();
      return {
        appointment: null,
        errorDetail: `${ghlRes.status}: ${errText.substring(0, 200)}`,
      };
    }

    const ghlJson: any = await ghlRes.json();
    const appointment = isRecord(ghlJson?.event)
      ? ghlJson.event
      : isRecord(ghlJson?.appointment)
        ? ghlJson.appointment
        : isRecord(ghlJson)
          ? ghlJson
          : null;

    return { appointment, errorDetail: appointment ? null : "Empty appointment response from GHL API" };
  } catch (error) {
    return {
      appointment: null,
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveClientFromBooking(params: {
  supabase: any;
  bookingId: string;
  preferredClientId?: string | null;
  preferredLocationId?: string | null;
  preferredCalendarId?: string | null;
}): Promise<{ client: ClientRecord | null; appointment: Record<string, unknown> | null; errorDetail: string | null; }> {
  const { data, error } = await params.supabase
    .from("clients")
    .select("id, name, ghl_api_key, ghl_calendar_id, ghl_location_id, ghl_webhook_secret")
    .not("ghl_api_key", "is", null);

  if (error) {
    return { client: null, appointment: null, errorDetail: error.message };
  }

  const allClients = (data ?? []) as ClientRecord[];
  if (allClients.length === 0) {
    return { client: null, appointment: null, errorDetail: "No clients with GHL API keys are configured" };
  }

  const clientsByLocation = new Map<string, ClientRecord>();
  const clientsByCalendar = new Map<string, ClientRecord>();

  for (const client of allClients) {
    if (client.ghl_location_id) clientsByLocation.set(client.ghl_location_id, client);
    if (client.ghl_calendar_id && !clientsByCalendar.has(client.ghl_calendar_id)) {
      clientsByCalendar.set(client.ghl_calendar_id, client);
    }
  }

  const scoreClient = (client: ClientRecord) => {
    let score = 0;
    if (params.preferredLocationId && client.ghl_location_id === params.preferredLocationId) score += 12;
    if (params.preferredCalendarId && client.ghl_calendar_id === params.preferredCalendarId) score += 6;
    return score;
  };

  const candidates = [...allClients]
    .filter((client) => client.id !== params.preferredClientId)
    .sort((a, b) => scoreClient(b) - scoreClient(a));

  let lastError: string | null = null;

  for (const candidate of candidates) {
    const apiKey = candidate.ghl_api_key?.trim();
    if (!apiKey) continue;

    const lookup = await fetchGhlAppointment(apiKey, params.bookingId);
    if (!lookup.appointment) {
      lastError = lookup.errorDetail;
      continue;
    }

    const appointmentLocationId = firstNonEmptyString(
      lookup.appointment.locationId,
      lookup.appointment.location_id,
    );
    const appointmentCalendarId = firstNonEmptyString(
      lookup.appointment.calendarId,
      lookup.appointment.calendar_id,
    );

    const matchedByLocation = appointmentLocationId ? clientsByLocation.get(appointmentLocationId) ?? null : null;
    if (matchedByLocation) {
      return { client: matchedByLocation, appointment: lookup.appointment, errorDetail: null };
    }

    const matchedByCalendar = appointmentCalendarId ? clientsByCalendar.get(appointmentCalendarId) ?? null : null;
    if (matchedByCalendar) {
      return { client: matchedByCalendar, appointment: lookup.appointment, errorDetail: null };
    }

    if (!appointmentLocationId && !appointmentCalendarId) {
      return { client: candidate, appointment: lookup.appointment, errorDetail: null };
    }
  }

  return {
    client: null,
    appointment: null,
    errorDetail: lastError ?? "Unable to match the booking to any configured client",
  };
}

async function resolveClientForBooking(params: {
  supabase: any;
  bookingId: string;
  preferredLocationId?: string | null;
  preferredCalendarId?: string | null;
}): Promise<{ client: ClientRecord | null; appointment: Record<string, unknown> | null; errorDetail: string | null; viaFallback: boolean; }> {
  let preferredClient: ClientRecord | null = null;
  let directLookupError: string | null = null;
  let mismatchError: string | null = null;

  if (params.preferredLocationId) {
    const { data, error } = await params.supabase
      .from("clients")
      .select("id, name, ghl_api_key, ghl_calendar_id, ghl_location_id, ghl_webhook_secret")
      .eq("ghl_location_id", params.preferredLocationId)
      .maybeSingle();

    if (error) {
      directLookupError = error.message;
    } else if (data) {
      preferredClient = data as ClientRecord;
    }
  }

  if (preferredClient?.ghl_api_key?.trim()) {
    const lookup = await fetchGhlAppointment(preferredClient.ghl_api_key.trim(), params.bookingId);

    if (lookup.appointment) {
      const appointmentLocationId = firstNonEmptyString(
        lookup.appointment.locationId,
        lookup.appointment.location_id,
      );
      const appointmentCalendarId = firstNonEmptyString(
        lookup.appointment.calendarId,
        lookup.appointment.calendar_id,
      );

      const locationMatches = !appointmentLocationId
        || !preferredClient.ghl_location_id
        || appointmentLocationId === preferredClient.ghl_location_id;
      const calendarMatches = !appointmentCalendarId
        || !preferredClient.ghl_calendar_id
        || appointmentCalendarId === preferredClient.ghl_calendar_id;

      if (locationMatches && calendarMatches) {
        return {
          client: preferredClient,
          appointment: lookup.appointment,
          errorDetail: null,
          viaFallback: false,
        };
      }

      mismatchError = `Appointment resolved to location ${appointmentLocationId ?? "unknown"} / calendar ${appointmentCalendarId ?? "unknown"}, which does not match the provided GHL account.`;
    } else {
      directLookupError = lookup.errorDetail;
    }
  }

  const fallback = await resolveClientFromBooking({
    supabase: params.supabase,
    bookingId: params.bookingId,
    preferredClientId: preferredClient?.id ?? null,
    preferredLocationId: params.preferredLocationId ?? null,
    preferredCalendarId: params.preferredCalendarId ?? null,
  });

  if (fallback.client) {
    return {
      client: fallback.client,
      appointment: fallback.appointment,
      errorDetail: null,
      viaFallback: true,
    };
  }

  if (preferredClient && !mismatchError) {
    return {
      client: preferredClient,
      appointment: null,
      errorDetail: directLookupError,
      viaFallback: false,
    };
  }

  return {
    client: null,
    appointment: null,
    errorDetail: mismatchError ?? directLookupError ?? fallback.errorDetail,
    viaFallback: false,
  };
}

async function parseRequestBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      const parsed = await req.clone().json();
      return isRecord(parsed) ? parsed : {};
    }
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.clone().formData();
      return Object.fromEntries(
        Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name])
      );
    }
    const raw = await req.clone().text();
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (isRecord(parsed)) return parsed;
    } catch { /* fall through */ }
    const params = new URLSearchParams(raw);
    if (Array.from(params.keys()).length > 0) return Object.fromEntries(params.entries());
  } catch { /* ignore */ }
  return {};
}

interface Step {
  id: string;
  label: string;
  node_type: string;
  status: "completed" | "failed" | "skipped";
  detail?: string;
  timestamp: string;
}

function makeStep(id: string, label: string, nodeType: string, status: Step["status"], detail?: string): Step {
  return { id, label, node_type: nodeType, status, detail, timestamp: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const rawBody = await req.clone().text();
    const body = await parseRequestBody(req);
    const nestedBody = pickFirstRecord(body.body);
    const payload = pickFirstRecord(body.payload, nestedBody.payload);
    const event = pickFirstRecord(body.event, nestedBody.event);
    const data = pickFirstRecord(body.data, nestedBody.data);
    const appointment = pickFirstRecord(
      body.appointment,
      nestedBody.appointment,
      body.booking,
      nestedBody.booking,
      event,
      data,
      payload,
      body.object,
      nestedBody.object,
    );
    const contact = pickFirstRecord(
      body.contact,
      body.Contact,
      nestedBody.contact,
      nestedBody.Contact,
      appointment.contact,
      event.contact,
      data.contact,
      payload.contact,
    );

    const ghlAccountId = firstNonEmptyString(
      url.searchParams.get("GHL_Account_ID"), url.searchParams.get("ghl_account_id"),
      url.searchParams.get("locationId"),
      body.GHL_Account_ID, nestedBody.GHL_Account_ID,
      body.ghl_account_id, nestedBody.ghl_account_id,
      body.ghlAccountId, nestedBody.ghlAccountId,
      body.locationId, nestedBody.locationId,
      body.location_id, nestedBody.location_id,
      appointment.locationId, appointment.location_id,
      event.locationId, event.location_id,
      data.locationId, data.location_id,
      payload.locationId, payload.location_id,
      contact.locationId, contact.location_id,
    );

    const contactId = firstNonEmptyString(
      url.searchParams.get("Lead_ID"), url.searchParams.get("lead_id"),
      url.searchParams.get("Contact_ID"), url.searchParams.get("contact_id"),
      body.Lead_ID, body.lead_id, body.leadId,
      body.Contact_ID, body.contact_id, body.contactId,
      nestedBody.Lead_ID, nestedBody.lead_id, nestedBody.leadId,
      nestedBody.Contact_ID, nestedBody.contact_id, nestedBody.contactId,
      appointment.contactId, appointment.contact_id,
      event.contactId, event.contact_id,
      data.contactId, data.contact_id,
      payload.contactId, payload.contact_id,
      contact.id, contact.lead_id, contact.contact_id,
    );

    const bookingId = firstNonEmptyString(
      url.searchParams.get("Booking_ID"), url.searchParams.get("booking_id"), url.searchParams.get("bookingId"),
      body.Booking_ID, body.booking_id, body.bookingId,
      nestedBody.Booking_ID, nestedBody.booking_id, nestedBody.bookingId,
      body.id, nestedBody.id,
      body.eventId, body.event_id,
      nestedBody.eventId, nestedBody.event_id,
      body.appointmentId, body.appointment_id,
      nestedBody.appointmentId, nestedBody.appointment_id,
      appointment.id, appointment.bookingId, appointment.booking_id,
      appointment.eventId, appointment.event_id,
      event.id, data.id, payload.id,
    );

    const contactName = firstNonEmptyString(
      url.searchParams.get("Name"), url.searchParams.get("name"),
      body.Name, nestedBody.Name,
      body.name, nestedBody.name,
      body.contactName, nestedBody.contactName,
      body.contact_name, nestedBody.contact_name,
      contact.Name, contact.name, contact.fullName, contact.full_name,
      appointment.contactName, appointment.contact_name,
      event.contactName, event.contact_name,
      data.contactName, data.contact_name,
      payload.contactName, payload.contact_name,
      composeName(contact),
      composeName(appointment),
      composeName(event),
      composeName(data),
      composeName(body),
      composeName(nestedBody),
    );

    const calendarHint = firstNonEmptyString(
      body.calendarId, nestedBody.calendarId,
      body.calendar_id, nestedBody.calendar_id,
      appointment.calendarId, appointment.calendar_id,
      event.calendarId, event.calendar_id,
      data.calendarId, data.calendar_id,
      payload.calendarId, payload.calendar_id,
    );

    console.info("[sync-ghl-booking] Incoming webhook", JSON.stringify({
      bookingId,
      ghlAccountId,
      contactId,
      calendarHint,
      bodyKeys: Object.keys(body).slice(0, 20),
    }));

    async function logExecution(
      clientId: string | null, externalId: string, name: string | null,
      status: string, errorMessage: string | null, steps: Step[],
    ) {
      if (!clientId) return;
      try {
        await supabase.from("sync_ghl_booking_executions").insert({
          client_id: clientId, external_id: externalId, contact_name: name,
          status, error_message: errorMessage, steps,
        });
      } catch (e) {
        console.error("[sync-ghl-booking] Failed to log execution:", e);
      }
    }

    if (!bookingId) {
      console.warn("[sync-ghl-booking] Missing booking identifier");
      return new Response(
        JSON.stringify({ error: "Booking_ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let resolvedGhlAccountId = ghlAccountId || null;
    const steps: Step[] = [];
    steps.push(makeStep("booking-trigger", "Receive New Booking", "trigger", "completed",
      `GHL Account: ${resolvedGhlAccountId ?? "unknown"}, Booking: ${bookingId}`));

    // Check for duplicate before client resolution so repeated webhooks still resolve cleanly
    const { data: existingBooking } = await supabase
      .from("bookings")
      .select("id, client_id")
      .eq("ghl_booking_id", bookingId)
      .maybeSingle();

    if (existingBooking) {
      steps.push(makeStep("booking-duplicate", "Duplicate Check", "condition", "completed", `Already exists: ${existingBooking.id}`));
      console.info("[sync-ghl-booking] Duplicate booking", JSON.stringify({ bookingId, clientId: existingBooking.client_id }));
      await logExecution(existingBooking.client_id ?? null, bookingId, contactName || null, "duplicate", null, steps);
      return new Response(
        JSON.stringify({ status: "duplicate", booking_id: existingBooking.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientResolution = await resolveClientForBooking({
      supabase,
      bookingId,
      preferredLocationId: resolvedGhlAccountId,
      preferredCalendarId: calendarHint ?? null,
    });

    const clientRow = clientResolution.client;

    if (!clientRow) {
      steps.push(makeStep("booking-find-client", "Find Client", "find", "failed",
        clientResolution.errorDetail || `No client found for booking ${bookingId}`));
      console.warn("[sync-ghl-booking] Client resolution failed", JSON.stringify({
        bookingId,
        ghlAccountId: resolvedGhlAccountId,
        detail: clientResolution.errorDetail,
      }));
      return new Response(
        JSON.stringify({ error: clientResolution.errorDetail || "No client found for the provided booking" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientId = clientRow.id;

    // Optional GHL Webhook V2 signature check. Inert until the client stamps
    // ghl_webhook_secret AND the upstream GHL webhook is configured to sign
    // (onboarding BR3). Canonical verified booking ingress is bookings-webhook;
    // this path mirrors its verify-if-present behaviour.
    if (clientRow.ghl_webhook_secret) {
      const sigOk = await verifyGhlSignature(
        rawBody,
        req.headers.get("x-wh-signature"),
        clientRow.ghl_webhook_secret,
      );
      if (!sigOk) {
        console.warn("[sync-ghl-booking] GHL signature mismatch", { clientId, bookingId });
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    resolvedGhlAccountId = firstNonEmptyString(
      clientResolution.appointment?.locationId,
      clientResolution.appointment?.location_id,
      clientRow.ghl_location_id,
      resolvedGhlAccountId,
    ) || null;
    steps.push(makeStep(
      "booking-find-client",
      "Find Client",
      "find",
      "completed",
      clientResolution.viaFallback
        ? `Client: ${clientId} (resolved from booking details)`
        : `Client: ${clientId}`,
    ));
    console.info("[sync-ghl-booking] Client resolved", JSON.stringify({
      bookingId,
      clientId,
      ghlAccountId: resolvedGhlAccountId,
      viaFallback: clientResolution.viaFallback,
    }));

    // Find or create lead
    let leadId: string | null = null;
    if (contactId) {
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("client_id", clientId)
        .eq("lead_id", contactId)
        .maybeSingle();

      if (existingLead) {
        leadId = existingLead.id;
        steps.push(makeStep("booking-find-lead", "Find Lead", "find", "completed", `Found: ${leadId}`));
      } else {
        // Create lead
        const nameParts = (contactName || "").trim().split(/\s+/);
        const { data: newLead, error: createErr } = await supabase
          .from("leads")
          .insert({
            client_id: clientId,
            lead_id: contactId,
            first_name: nameParts[0] || null,
            last_name: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
          })
          .select("id")
          .single();

        if (createErr) {
          steps.push(makeStep("booking-find-lead", "Find Lead", "find", "failed", createErr.message));
        } else {
          leadId = newLead.id;
          steps.push(makeStep("booking-find-lead", "Find/Create Lead", "find", "completed", `Created: ${leadId}`));
        }
      }
    } else {
      steps.push(makeStep("booking-find-lead", "Find Lead", "find", "skipped", "No Lead_ID provided"));
    }

    // Query GHL API for appointment details
    let ghlData: Record<string, any> | null = clientResolution.appointment ? { ...clientResolution.appointment } : null;
    const ghlApiKey = clientRow.ghl_api_key;

    if (ghlData) {
      steps.push(makeStep(
        "booking-query-ghl",
        "Fetch Appointment",
        "action",
        "completed",
        clientResolution.viaFallback
          ? "Fetched appointment details from GHL API and resolved the correct client"
          : "Fetched appointment details from GHL API",
      ));
    } else if (ghlApiKey && bookingId) {
      try {
        const lookup = await fetchGhlAppointment(ghlApiKey, bookingId);
        if (lookup.appointment) {
          ghlData = lookup.appointment;
          steps.push(makeStep("booking-query-ghl", "Fetch Appointment", "action", "completed", "Fetched appointment details from GHL API"));
        } else {
          const errDetail = lookup.errorDetail || "Unknown GHL API error";
          steps.push(makeStep("booking-query-ghl", "Fetch Appointment", "action", "failed", errDetail));
          // Log to error_logs but don't block the webhook
          try {
            await supabase.from("error_logs").insert({
              client_id: clientId,
              source: "new-booking-from-gohighlevel",
              error_type: "ghl_api_error",
              message: `Failed to fetch appointment ${bookingId}: ${errDetail}`,
              raw_payload: { bookingId, response: errDetail, ghlAccountId: resolvedGhlAccountId },
            });
          } catch (_logErr) { /* ignore logging failures */ }
        }
      } catch (e: any) {
        steps.push(makeStep("booking-query-ghl", "Fetch Appointment", "action", "failed", e.message));
        try {
          await supabase.from("error_logs").insert({
            client_id: clientId,
            source: "new-booking-from-gohighlevel",
            error_type: "ghl_api_error",
            message: `Exception fetching appointment ${bookingId}: ${e.message}`,
            raw_payload: { bookingId },
          });
        } catch (_logErr) { /* ignore */ }
      }
    } else {
      steps.push(makeStep("booking-query-ghl", "Fetch Appointment", "action", "skipped", "No GHL API key"));
    }

    // Extract appointment details from GHL event data
    const appt = ghlData || {};
    const calLinks = isRecord(appt.calLinks) ? appt.calLinks : {};
    const title = firstNonEmptyString(appt.title, appt.Title, body.title) || null;
    const startTime = firstNonEmptyString(appt.startTime, appt.start_time, body.start_time) || null;
    const endTime = firstNonEmptyString(appt.endTime, appt.end_time, body.end_time) || null;
    const status = firstNonEmptyString(appt.appointmentStatus, appt.status, body.status) || "confirmed";
    const location = firstNonEmptyString(appt.address, appt.location, body.location) || null;
    const notes = firstNonEmptyString(appt.notes, body.notes) || null;
    const calendarId = firstNonEmptyString(appt.calendarId, appt.calendar_id, body.calendar_id, clientRow.ghl_calendar_id) || null;
    const cancellationLink = firstNonEmptyString(calLinks.cancellationLink) || null;
    const rescheduleLink = firstNonEmptyString(calLinks.rescheduleLink) || null;

    // Campaign attribution: find the most recent engagement execution for this lead.
    // Bug 24 — also capture exec.id into cadence_execution_id so bookings link back
    // to the cadence run that produced them. 14-day window prevents stale attribution.
    let campaignId: string | null = null;
    let cadenceExecutionId: string | null = null;
    const leadIdForAttribution = contactId || null;
    if (leadIdForAttribution) {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentExec } = await supabase
        .from("engagement_executions")
        .select("id, campaign_id")
        .eq("ghl_contact_id", leadIdForAttribution)
        .gte("started_at", fourteenDaysAgo)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      cadenceExecutionId = recentExec?.id ?? null;

      if (recentExec?.campaign_id) {
        const { data: campaignCheck } = await supabase
          .from("engagement_campaigns")
          .select("id")
          .eq("id", recentExec.campaign_id)
          .maybeSingle();

        if (campaignCheck) {
          campaignId = campaignCheck.id;
          steps.push(makeStep("booking-attribute", "Attribute Campaign", "action", "completed", `Campaign: ${campaignId}`));
        } else {
          steps.push(makeStep("booking-attribute", "Attribute Campaign", "action", "completed", "No valid campaign found"));
        }
      } else {
        steps.push(makeStep("booking-attribute", "Attribute Campaign", "action", "completed", "No recent engagement found"));
      }
    }

    // Insert booking
    const { data: newBooking, error: insertErr } = await supabase
      .from("bookings")
      .insert({
        client_id: clientId,
        lead_id: leadId,
        ghl_contact_id: contactId || null,
        ghl_booking_id: bookingId,
        campaign_id: campaignId,
        cadence_execution_id: cadenceExecutionId,
        setter_name: null,
        setter_type: null,
        title,
        start_time: startTime,
        end_time: endTime,
        status,
        location,
        notes,
        calendar_id: calendarId,
        cancellation_link: cancellationLink,
        reschedule_link: rescheduleLink,
        raw_ghl_data: ghlData,
      })
      .select("id")
      .single();

    if (insertErr) {
      steps.push(makeStep("booking-insert", "Create Booking", "create_contact", "failed", insertErr.message));
      await logExecution(clientId, bookingId, contactName || null, "failed", insertErr.message, steps);
      return new Response(
        JSON.stringify({ error: "Failed to create booking" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    steps.push(makeStep("booking-insert", "Create Booking", "create_contact", "completed", `Booking: ${newBooking.id}`));

    // Insert campaign_events for analytics
    if (campaignId && leadIdForAttribution) {
      try {
        await supabase.from("campaign_events").insert({
          campaign_id: campaignId,
          client_id: clientId,
          lead_id: leadIdForAttribution,
          event_type: "appointment_booked",
          metadata: {
            booking_id: newBooking.id,
            ghl_booking_id: bookingId,
            start_time: startTime,
            title,
          },
        });
        steps.push(makeStep("booking-event", "Log Campaign Event", "action", "completed", "appointment_booked event created"));
      } catch (e: any) {
        steps.push(makeStep("booking-event", "Log Campaign Event", "action", "failed", e.message));
      }
    }

    await logExecution(clientId, bookingId, contactName || null, "created", null, steps);

    return new Response(
      JSON.stringify({ status: "created", booking_id: newBooking.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("sync-ghl-booking error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
