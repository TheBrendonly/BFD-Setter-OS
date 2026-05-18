import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RETELL_BASE = "https://api.retellai.com";
const GHL_BASE = "https://services.leadconnectorhq.com";

// Map Voice-Setter slot numbers to client column names for agent IDs
const SLOT_TO_AGENT_COLUMN: Record<number, string> = {
  1: "retell_inbound_agent_id",
  2: "retell_outbound_agent_id",
  3: "retell_outbound_followup_agent_id",
  4: "retell_agent_id_4",
  5: "retell_agent_id_5",
  6: "retell_agent_id_6",
  7: "retell_agent_id_7",
  8: "retell_agent_id_8",
  9: "retell_agent_id_9",
  10: "retell_agent_id_10",
};

function parseVoiceSetterSlot(value: string): number | null {
  const slotMatch = value.match(/voice-setter-(\d+)/i);
  if (!slotMatch) return null;
  const slotNumber = parseInt(slotMatch[1], 10);
  return Number.isNaN(slotNumber) ? null : slotNumber;
}

// ── Phase 11d — Retell-native voicemail ───────────────────────────────────
// Cache the last-applied voicemail_option hash per agent so we don't PATCH
// on every call. Module-scope Map persists across requests within the same
// edge-fn instance.
const voicemailHashCache = new Map<string, string>();

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureVoicemailConfig(
  apiKey: string,
  agentId: string,
  cfg: { mode: "static" | "dynamic"; message: string } | null | undefined,
): Promise<void> {
  if (!cfg || !cfg.message || !cfg.message.trim()) return;
  const hash = await sha256Hex(JSON.stringify(cfg));
  if (voicemailHashCache.get(agentId) === hash) {
    console.log(`📭 voicemail_option for ${agentId} is up-to-date (hash match) — skipping PATCH`);
    return;
  }
  const action =
    cfg.mode === "dynamic"
      ? { type: "prompt", prompt: cfg.message }
      : { type: "static_text", text: cfg.message };
  const body = { voicemail_option: { action } };
  try {
    const r = await fetch(`${RETELL_BASE}/update-agent/${agentId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`📭 Retell update-agent voicemail PATCH failed ${r.status}: ${txt.slice(0, 200)}`);
      return;
    }
    voicemailHashCache.set(agentId, hash);
    console.log(`📭 voicemail_option PATCHed for ${agentId} (mode=${cfg.mode})`);
  } catch (e) {
    console.warn(`📭 ensureVoicemailConfig error: ${(e as Error).message}`);
  }
}

const AVAILABILITY_WINDOW_DAYS = 30;

/* ─── Debug step types ─── */

interface DebugInfo {
  request_url?: string;
  request_method?: string;
  request_headers?: Record<string, string>;
  request_body?: unknown;
  response_status?: number;
  response_body?: unknown;
  error?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

interface DebugStep {
  id: string;
  label: string;
  node_type: string;
  status: string;
  detail?: string;
  response_data?: string;
  timestamp?: string;
  debug?: DebugInfo;
}

/* ─── Debug fetch helper ─── */

async function debugFetch(
  url: string,
  options: RequestInit,
): Promise<{
  data: unknown;
  raw: string;
  status: number;
  ok: boolean;
  duration_ms: number;
  url: string;
  error?: string;
}> {
  const start = Date.now();
  try {
    const resp = await fetch(url, options);
    const duration_ms = Date.now() - start;
    const raw = await resp.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return { data, raw, status: resp.status, ok: resp.ok, duration_ms, url };
  } catch (err: unknown) {
    const duration_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, raw: "", status: 0, ok: false, duration_ms, url, error: message };
  }
}

/* ─── Availability helpers ─── */

type AvailabilityFetchStatus = "ok" | "empty" | "error" | "not_configured";

interface AvailabilityFetchResult {
  fetchStatus: AvailabilityFetchStatus;
  timezone: string;
  windowStartIso: string;
  windowEndIso: string;
  slots: unknown;
  error?: string;
  debug?: DebugInfo;
}

function buildAvailabilityDynamicVariable(result: AvailabilityFetchResult): string {
  return JSON.stringify({
    source: "ghl_free_slots",
    days: AVAILABILITY_WINDOW_DAYS,
    timezone: result.timezone,
    window_start: result.windowStartIso,
    window_end: result.windowEndIso,
    status: result.fetchStatus,
    slots: result.slots,
    error: result.error ?? null,
  });
}

async function fetchGhlFreeSlots(
  ghlApiKey: string,
  calendarId: string,
  // Default kept as an absolute fallback for programmer error. All
  // in-codebase call sites resolve client.timezone first (Bug 2 fix).
  timezone: string = "America/New_York",
): Promise<AvailabilityFetchResult> {
  const windowStart = new Date();
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + AVAILABILITY_WINDOW_DAYS);

  const url = new URL(`${GHL_BASE}/calendars/${calendarId}/free-slots`);
  url.searchParams.set("startDate", windowStart.getTime().toString());
  url.searchParams.set("endDate", windowEnd.getTime().toString());
  url.searchParams.set("timezone", timezone);

  const maskedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ghlApiKey.slice(0, 8)}...`,
    Version: "2021-04-15",
  };

  console.log(
    `📅 Fetching 30-day GHL free slots: calendar=${calendarId}, tz=${timezone}`,
  );

  const result = await debugFetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ghlApiKey}`,
      Version: "2021-04-15",
    },
  });

  const debug: DebugInfo = {
    request_url: url.toString(),
    request_method: "GET",
    request_headers: maskedHeaders,
    response_status: result.status,
    response_body: result.data,
    duration_ms: result.duration_ms,
    error: result.error,
    metadata: { calendar_id: calendarId, timezone, window_days: AVAILABILITY_WINDOW_DAYS },
  };

  if (!result.ok) {
    const errorMessage = result.error || `GHL free-slots returned ${result.status}`;
    console.warn(`⚠️ ${errorMessage}`);
    return {
      fetchStatus: "error",
      timezone,
      windowStartIso: windowStart.toISOString(),
      windowEndIso: windowEnd.toISOString(),
      slots: null,
      error: errorMessage,
      debug,
    };
  }

  const data = result.data;
  const topLevelCount = Array.isArray(data)
    ? data.length
    : data && typeof data === "object"
      ? Object.keys(data as Record<string, unknown>).length
      : 0;

  console.log(`📅 Got 30-day slot payload with ${topLevelCount} top-level entries`);
  return {
    fetchStatus: topLevelCount > 0 ? "ok" : "empty",
    timezone,
    windowStartIso: windowStart.toISOString(),
    windowEndIso: windowEnd.toISOString(),
    slots: data,
    debug,
  };
}

/**
 * Fetch prior Retell phone calls for this lead, so the voice agent knows what was discussed previously.
 */
async function fetchCallHistory(
  supabase: ReturnType<typeof createClient>,
  leadId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from("call_history")
      .select("direction, call_status, from_number, to_number, call_summary, duration_seconds, created_at")
      .eq("contact_id", leadId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!data || data.length === 0) return "";
    return data
      .map((c: any) => {
        const when = c.created_at ? new Date(c.created_at).toISOString() : "";
        const summary = c.call_summary ? ` — ${c.call_summary}` : "";
        return `[${when}] ${c.direction} call, ${c.call_status}, ${c.duration_seconds ?? 0}s${summary}`;
      })
      .join("\n");
  } catch (err) {
    console.warn("⚠️ Failed to fetch call history:", err);
    return "";
  }
}

/**
 * Fetch prior SMS/WhatsApp conversation history for a lead, to feed into the voice agent's context.
 */
async function fetchChatHistory(
  supabase: ReturnType<typeof createClient>,
  leadId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from("messages")
      .select("role, body, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(50);
    if (!data || data.length === 0) return "";
    return data
      .map((m: { role: string; body: string }) => `[${m.role}] ${m.body}`)
      .join("\n");
  } catch (err) {
    console.warn("⚠️ Failed to fetch chat history:", err);
    return "";
  }
}

async function fetchGhlContactDetails(
  ghlApiKey: string,
  contactId: string,
  locationId: string,
): Promise<{ contactData: string; debug: DebugInfo }> {
  const url = `${GHL_BASE}/contacts/${contactId}`;
  const maskedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ghlApiKey.slice(0, 8)}...`,
    Version: "2021-04-15",
  };

  console.log(`👤 Fetching GHL contact: ${contactId}`);

  const result = await debugFetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ghlApiKey}`,
      Version: "2021-04-15",
    },
  });

  const debug: DebugInfo = {
    request_url: url,
    request_method: "GET",
    request_headers: maskedHeaders,
    response_status: result.status,
    response_body: result.data,
    duration_ms: result.duration_ms,
    error: result.error,
    metadata: { contact_id: contactId, location_id: locationId },
  };

  if (!result.ok) {
    console.warn(`⚠️ GHL contact fetch returned ${result.status}`);
    return { contactData: "", debug };
  }

  const contactData = (result.data as any)?.contact || result.data;
  return { contactData: JSON.stringify(contactData), debug };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const ok = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const steps: DebugStep[] = [];
  const addStep = (
    id: string,
    label: string,
    nodeType: string,
    status: string,
    detail?: string,
    responseData?: string,
    debug?: DebugInfo,
  ) => {
    steps.push({ id, label, node_type: nodeType, status, detail, response_data: responseData, timestamp: new Date().toISOString(), debug });
  };

  try {
    const body = await req.json();

    const {
      client_id,
      voice_setter_id,
      ghl_contact_id,
      ghl_account_id,
      execution_id,
      custom_instructions,
      contact_fields,
      treat_pickup_as_reply,
      timezone,
      voicemail_config,
    } = body as Record<string, any>;

    if (!client_id) return ok({ error: "client_id is required" }, 400);
    if (!voice_setter_id) return ok({ error: "voice_setter_id is required" }, 400);

    addStep("ocp-trigger", "Manual Trigger", "trigger", "completed",
      `setter=${voice_setter_id}, contact=${ghl_contact_id || "N/A"}`, undefined, {
        metadata: {
          client_id,
          voice_setter_id,
          ghl_contact_id,
          ghl_account_id,
          execution_id,
          treat_pickup_as_reply,
          custom_instructions: custom_instructions ? custom_instructions.slice(0, 200) + "..." : "(default)",
          // Pre-resolution telemetry — actual tz used is logged later
          // alongside `tz` (Bug 2 fix: client.timezone or ET fallback).
          timezone: timezone || "(client default)",
          contact_fields,
        },
      });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Get client config
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select(
        "retell_api_key, retell_inbound_agent_id, retell_outbound_agent_id, retell_outbound_followup_agent_id, retell_agent_id_4, retell_agent_id_5, retell_agent_id_6, retell_agent_id_7, retell_agent_id_8, retell_agent_id_9, retell_agent_id_10, retell_phone_1, retell_phone_2, retell_phone_3, ghl_location_id, ghl_api_key, ghl_calendar_id, timezone",
      )
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      console.error("Client not found:", clientErr);
      return ok({ error: "Client not found" }, 404);
    }

    if (!client.retell_api_key) {
      return ok({
        error: "Retell API key not configured for this client.",
        code: "no_retell_api_key",
        hint: "Open API Credentials in the sidebar and add your Retell API key, then try again.",
      }, 409);
    }

    // 2. Resolve agent_id
    const slotNumber = parseVoiceSetterSlot(voice_setter_id);
    if (!slotNumber) {
      return ok({
        error: `Invalid voice_setter_id format: ${voice_setter_id}`,
        code: "invalid_voice_setter_id",
      }, 400);
    }
    const agentColumn = SLOT_TO_AGENT_COLUMN[slotNumber];
    if (!agentColumn) {
      return ok({
        error: `Invalid voice setter slot: ${slotNumber}`,
        code: "invalid_voice_setter_slot",
      }, 400);
    }

    const agentId = (client as Record<string, unknown>)[agentColumn] as string | null;
    if (!agentId) {
      // Phase 3.1 UX fix: structured error so the TestCallDialog can surface a
      // clear "push first" prompt instead of "Edge Function returned a non-2xx
      // status code". HTTP 409 distinguishes "config incomplete" from "bad
      // request" which carries different UX intent.
      return ok({
        error: `No Retell agent configured for ${voice_setter_id} yet.`,
        code: "no_agent_for_slot",
        slot_id: voice_setter_id,
        slot_number: slotNumber,
        hint: `Open the ${voice_setter_id} editor, fill in the config, and click "Push to Retell" to provision the agent. Then try the test call again.`,
      }, 409);
    }

    // 3. Get phone number
    const phone = contact_fields?.phone || body.phone;
    if (!phone) {
      return ok({
        error: "No phone number provided for the contact.",
        code: "no_contact_phone",
        hint: "Enter a phone number including country code (e.g. +61 4xx xxx xxx).",
      }, 400);
    }

    // 4. Determine from_number
    const SLOT_TO_PHONE_COLUMN: Record<number, string> = {
      1: "retell_phone_1",
      2: "retell_phone_2",
      3: "retell_phone_3",
    };
    const slotPhoneCol = SLOT_TO_PHONE_COLUMN[slotNumber];
    const slotPhone = slotPhoneCol ? (client as Record<string, unknown>)[slotPhoneCol] as string | null : null;
    let fromNumber = slotPhone || client.retell_phone_2 || client.retell_phone_1 || client.retell_phone_3;

    if (!fromNumber) {
      try {
        console.log("📞 No legacy phone columns set, querying Retell API for phone numbers...");
        const retellPhonesResult = await debugFetch(`${RETELL_BASE}/list-phone-numbers`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${client.retell_api_key}`,
            "Content-Type": "application/json",
          },
        });

        if (retellPhonesResult.ok) {
          const retellPhonesData = retellPhonesResult.data;
          const retellPhones = Array.isArray(retellPhonesData)
            ? retellPhonesData
            : Array.isArray((retellPhonesData as any)?.phone_numbers)
              ? (retellPhonesData as any).phone_numbers
              : Array.isArray((retellPhonesData as any)?.data)
                ? (retellPhonesData as any).data
                : [];

          const usablePhone = retellPhones.find((entry: any) => {
            if (!entry || typeof entry !== "object") return false;
            return typeof entry.phone_number === "string" && entry.phone_number.trim().length > 0;
          }) as Record<string, unknown> | undefined;

          if (usablePhone?.phone_number && typeof usablePhone.phone_number === "string") {
            fromNumber = usablePhone.phone_number;
            console.log(`📞 Found Retell phone number: ${fromNumber}`);
          }
        }
      } catch (err) {
        console.warn("⚠️ Failed to query Retell phone numbers:", err);
      }
    }

    if (!fromNumber) {
      return ok({ error: "No Retell phone number configured. Add a phone number in Voice AI Rep settings." }, 400);
    }

    // 5. Fetch GHL data in parallel with debug capture
    const ghlApiKey = client.ghl_api_key;
    const calendarId = client.ghl_calendar_id;
    const locationId = ghl_account_id || client.ghl_location_id || "";
    // Bug 2 — default the timezone from clients.timezone (added 2026-05-05
    // in phase-night-a4-clients-timezone), falling back to ET only when
    // the column is null. Previously this was hardcoded to ET regardless
    // of the client's actual timezone, which surfaced as the voice agent
    // offering booking slots in ET to AU leads.
    const clientTz = (client as { timezone?: string | null }).timezone || "America/New_York";
    const tz = timezone || clientTz;

    const leadLookupId = ghl_contact_id || body.lead_id || "";
    const [availableSlots, ghlContactDetails, chatHistory, callHistory] = await Promise.all([
      ghlApiKey && calendarId
        ? fetchGhlFreeSlots(ghlApiKey, calendarId, tz).then(r => buildAvailabilityDynamicVariable(r))
        : Promise.resolve(""),
      ghlApiKey && ghl_contact_id
        ? fetchGhlContactDetails(ghlApiKey, ghl_contact_id, locationId).then(r => r.contactData)
        : Promise.resolve(""),
      fetchChatHistory(supabase, leadLookupId),
      fetchCallHistory(supabase, leadLookupId),
    ]);

    console.log(`📊 Enrichment sizes — slots:${availableSlots.length} contact:${ghlContactDetails.length} chat:${chatHistory.length} calls:${callHistory.length}`);

    // 6. Build dynamic variables
    const fields = contact_fields || {};
    const nowTs = new Date();
    // Bug 2 — render current_time in the client's actual timezone, not ET.
    const currentTimeLocal = nowTs.toLocaleString("en-US", {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "short",
    });

    const dynamicVars: Record<string, string> = {
      first_name: fields.first_name || "",
      last_name: fields.last_name || "",
      email: fields.email || "",
      phone: fields.phone || phone,
      business_name: fields.business_name || "",
      ghl_account_id: locationId,
      ghl_contact_id: ghl_contact_id || "",
      execution_id: execution_id || "",
      voice_setter_id: voice_setter_id || "",
      treat_pickup_as_reply: treat_pickup_as_reply ? "true" : "false",
      current_time: currentTimeLocal,
      current_timezone: tz,
      custom_instructions:
        custom_instructions ||
        `Keep the conversation natural and human-like. Speak casually as if you're a real person, not a bot. Use filler words occasionally (like "yeah", "I mean", "for sure"). Keep responses short - 1 to 2 sentences max unless they ask for more detail. Mirror the prospect's energy and pace. If they sound busy, get to the point fast. If they're chatty, match that vibe. Never sound scripted or robotic.`,
      available_time_slots: availableSlots || "",
      user_contact_details: ghlContactDetails || "",
      chat_history: chatHistory || "",
      call_history: callHistory || "",
    };

    // Extract GHL customFields from the contact JSON into individual `custom.<name>` dynamic vars
    // so the voice setter prompt can reference them as {{custom.fieldname}}.
    try {
      if (ghlContactDetails) {
        const parsed = JSON.parse(ghlContactDetails);
        const ghlCustomFields = Array.isArray(parsed?.customFields)
          ? parsed.customFields
          : Array.isArray(parsed?.contact?.customFields)
          ? parsed.contact.customFields
          : [];
        for (const cf of ghlCustomFields) {
          if (!cf) continue;
          const key = cf.fieldKey || cf.name || cf.id;
          const value = cf.value ?? cf.fieldValue ?? cf.field_value;
          if (key && value !== undefined && value !== null) {
            dynamicVars[`custom.${String(key).replace(/\s+/g, "_")}`] = String(value);
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to parse GHL customFields:", err);
    }

    // Also expose any custom.* keys that trigger-engagement already passed in contact_fields (Supabase leads.custom_fields)
    for (const [k, v] of Object.entries(fields)) {
      if (k.startsWith("custom.")) {
        dynamicVars[k] = String(v ?? "");
      }
    }

    // Phase 11d — push voicemail_option to the agent before placing the call
    // (hash-cached so we don't PATCH on every call). Best-effort; non-fatal.
    if (voicemail_config && typeof voicemail_config === "object") {
      await ensureVoicemailConfig(client.retell_api_key, agentId, voicemail_config);
    }

    // 7. Make the Retell API call with full debug capture
    console.log(`📞 Making outbound call via Retell. Agent: ${agentId}, To: ${phone}, From: ${fromNumber}`);

    const retellPayload: Record<string, unknown> = {
      from_number: fromNumber,
      to_number: phone,
      override_agent_id: agentId,
      retell_llm_dynamic_variables: dynamicVars,
    };

    const retellUrl = `${RETELL_BASE}/v2/create-phone-call`;
    const retellStart = Date.now();
    const retellResp = await fetch(retellUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.retell_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(retellPayload),
    });

    const retellData = await retellResp.json().catch(() => null);
    const retellDuration = Date.now() - retellStart;

    // Sanitized dynamic vars for debug (truncate large values)
    const sanitizedDynVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(dynamicVars)) {
      sanitizedDynVars[k] = v.length > 500 ? v.slice(0, 500) + `... (${v.length} chars total)` : v;
    }

    const retellDebug: DebugInfo = {
      request_url: retellUrl,
      request_method: "POST",
      request_headers: {
        Authorization: `Bearer ${client.retell_api_key.slice(0, 8)}...`,
        "Content-Type": "application/json",
      },
      request_body: {
        from_number: fromNumber,
        to_number: phone,
        override_agent_id: agentId,
        dynamic_variables_summary: sanitizedDynVars,
        dynamic_variables_count: Object.keys(dynamicVars).length,
        dynamic_variables_total_chars: Object.values(dynamicVars).reduce((sum, v) => sum + v.length, 0),
      },
      response_status: retellResp.status,
      response_body: retellData,
      duration_ms: retellDuration,
      metadata: {
        agent_id: agentId,
        slot_number: slotNumber,
        agent_column: agentColumn,
        from_number: fromNumber,
        to_number: phone,
        execution_id,
      },
    };

    if (!retellResp.ok) {
      const errMsg = retellData?.message || retellData?.error || `Retell API returned ${retellResp.status}`;
      console.error("Retell API error:", retellResp.status, retellData);
      retellDebug.error = errMsg;

      addStep("ocp-call", "Make Voice Setter Call", "action", "failed", errMsg, undefined, retellDebug);

      await supabase.from("error_logs").insert({
        client_ghl_account_id: ghl_account_id || client.ghl_location_id || "unknown",
        severity: "error",
        source: "make-retell-outbound-call",
        error_type: "retell_api_error",
        error_message: errMsg,
        context: {
          agent_id: agentId,
          to_number: phone,
          from_number: fromNumber,
          execution_id,
          retell_status: retellResp.status,
          retell_response: retellData,
          steps,
        },
      });

      return ok({ error: errMsg, call_failed: true, steps }, 200);
    }

    const callId = retellData?.call_id || retellData?.id;
    console.log(`✅ Retell call initiated. call_id: ${callId}`);

    addStep("ocp-call", "Make Voice Setter Call", "action", "completed",
      `call_id=${callId} (${retellDuration}ms)`, undefined, retellDebug);

    // Persist initial call_history record with full debug steps
    if (callId) {
      try {
        await supabase.from("call_history").upsert(
          {
            call_id: callId,
            client_id: client_id,
            contact_id: ghl_contact_id || null,
            agent_id: agentId,
            setter_id: voice_setter_id || null,
            direction: "outbound",
            from_number: fromNumber,
            to_number: phone,
            call_status: "initiated",
            ghl_account_id: locationId || null,
            pre_call_context: { steps },
          },
          { onConflict: "call_id" },
        );
        console.log(`📦 Initial call_history record created for ${callId}`);
      } catch (e) {
        console.warn("Failed to persist initial call_history:", e);
      }
    }

    return ok({
      success: true,
      call_id: callId,
      agent_id: agentId,
      to_number: phone,
      from_number: fromNumber,
      contact_details_included: !!ghlContactDetails,
      steps,
    });
  } catch (err) {
    console.error("make-retell-outbound-call error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return ok({ error: message, call_failed: true, steps }, 200);
  }
});
