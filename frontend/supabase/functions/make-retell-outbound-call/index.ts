import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

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
  // Bug 2 — detection config lives on `clients.voicemail_config`
  // ({detect_enabled, detect_timeout_ms}). Separate from the workflow-level
  // `cfg` because workflow controls what the agent says, client controls
  // whether the agent listens for voicemail at all.
  detectionCfg?: { detect_enabled?: unknown; detect_timeout_ms?: unknown } | null,
): Promise<void> {
  const hasMessage = !!cfg && !!cfg.message && cfg.message.trim().length > 0;
  const detectEnabled = detectionCfg?.detect_enabled === true;
  if (!hasMessage && !detectEnabled) return;

  const body: Record<string, unknown> = {};
  if (hasMessage) {
    const action =
      cfg!.mode === "dynamic"
        ? { type: "prompt", prompt: cfg!.message }
        : { type: "static_text", text: cfg!.message };
    body.voicemail_option = { action };
  }
  if (detectEnabled) {
    body.enable_voicemail_detection = true;
    const timeoutRaw = detectionCfg?.detect_timeout_ms;
    const timeoutMs =
      typeof timeoutRaw === "number" && timeoutRaw > 0 ? timeoutRaw : 15000;
    body.voicemail_detection_timeout_ms = timeoutMs;
  }

  // Hash includes detection flags so a switch from detect_enabled=false to
  // true (or a timeout change) invalidates the cached PATCH-up-to-date.
  const hash = await sha256Hex(JSON.stringify({ cfg, detectionCfg }));
  if (voicemailHashCache.get(agentId) === hash) {
    console.log(`📭 voicemail config for ${agentId} is up-to-date (hash match) — skipping PATCH`);
    return;
  }
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
    console.log(
      `📭 voicemail config PATCHed for ${agentId} (option_mode=${
        hasMessage ? cfg!.mode : "—"
      }, detect_enabled=${detectEnabled})`,
    );
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

// Compact the raw GHL free-slots payload to shrink the {{available_time_slots}}
// dynamic variable (substituted into the prompt every conversational turn). GHL
// returns { "YYYY-MM-DD": { slots: ["<ISO>", ...] }, "traceId": ... } over a
// 30-day window (~11k chars). We collapse it to { "YYYY-MM-DD": ["HH:MM", ...] }
// — the date is the key and the timezone is already given at top level — which
// cuts the per-turn substitution ~5x while staying truthful. Any unexpected shape
// falls back to the raw payload so live calls can never break on a format change.
function compactSlots(raw: unknown): unknown {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const out: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue; // skip traceId and other noise
      const slots = (val as { slots?: unknown } | null)?.slots;
      if (!Array.isArray(slots)) continue;
      out[key] = slots.map((s) => {
        if (typeof s !== "string") return String(s);
        const m = s.match(/T(\d{2}:\d{2})/); // local HH:MM from the ISO timestamp
        return m ? m[1] : s;
      });
    }
    return Object.keys(out).length > 0 ? out : raw;
  } catch {
    return raw;
  }
}

function buildAvailabilityDynamicVariable(result: AvailabilityFetchResult): string {
  return JSON.stringify({
    source: "ghl_free_slots",
    days: AVAILABILITY_WINDOW_DAYS,
    timezone: result.timezone,
    window_start: result.windowStartIso,
    window_end: result.windowEndIso,
    status: result.fetchStatus,
    slots: compactSlots(result.slots),
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
      idempotency_key,
      custom_instructions,
      contact_fields,
      treat_pickup_as_reply,
      timezone,
      voicemail_config,
    } = body as Record<string, any>;

    if (!client_id) return ok({ error: "client_id is required" }, 400);
    if (!voice_setter_id) return ok({ error: "voice_setter_id is required" }, 400);

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

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

    // CAD-02 idempotency guard: placeOutboundCall retries (lost response,
    // maxDuration ceiling) must not dial the lead twice. The cadence passes a
    // deterministic key (`${execution_id}:${node_index}:${channel_index}`);
    // if a call_history row already carries it, a call was ALREADY placed for
    // this exact cadence step — return it instead of placing another. Checked
    // again right before the dial (checkIdempotencyGuard) to shrink the
    // check-then-act window while this invocation runs its slow enrichment.
    const checkIdempotencyGuard = async (): Promise<Response | null> => {
      if (!idempotency_key) return null;
      const { data: priorCall, error: guardErr } = await supabase
        .from("call_history")
        .select("call_id, call_status")
        .eq("client_id", client_id)
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      if (guardErr) {
        // Fail CLOSED: placing a possibly-duplicate paid call on a blind
        // guard is worse than letting the caller retry with backoff.
        console.error(`Idempotency guard read failed for key ${idempotency_key}: ${guardErr.message}`);
        return ok({
          error: `idempotency check failed: ${guardErr.message}`,
          call_failed: true,
          retryable: true,
          steps,
        }, 200);
      }
      if (priorCall?.call_id) {
        console.log(`♻️ Idempotent replay for key ${idempotency_key} — returning existing call ${priorCall.call_id}, no new dial`);
        addStep("ocp-dedup", "Idempotency Guard", "condition", "completed",
          `Call already placed for this cadence step (call_id=${priorCall.call_id})`);
        return ok({
          success: true,
          call_id: priorCall.call_id,
          already_placed: true,
          steps,
        }, 200);
      }
      return null;
    };
    {
      const guardResponse = await checkIdempotencyGuard();
      if (guardResponse) return guardResponse;
    }

    // 1. Get client config
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select(
        "retell_api_key, retell_inbound_agent_id, retell_outbound_agent_id, retell_outbound_followup_agent_id, retell_agent_id_4, retell_agent_id_5, retell_agent_id_6, retell_agent_id_7, retell_agent_id_8, retell_agent_id_9, retell_agent_id_10, retell_phone_1, retell_phone_2, retell_phone_3, ghl_location_id, ghl_api_key, ghl_calendar_id, timezone, voicemail_config",
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

    // 2. Resolve agent_id + from-number
    //
    // voice_setter_id can be either:
    //   (a) a UUID — new voice_setters-row model (post phase-voice-setters-redesign 2026-05-27)
    //   (b) a "Voice-Setter-N" string — legacy slot model (kept for backward compat
    //       during the transition; remove with the slot-column cleanup migration).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let agentId: string | null = null;
    let fromNumber: string | null = null;
    // Hoisted to outer scope so the post-call debug metadata (slot_number /
    // agent_column) can read them on BOTH paths. On the UUID path they stay null
    // — referencing the legacy-branch consts there threw "slotNumber is not
    // defined" AFTER the call placed, causing a retry/re-dial loop.
    let slotNumber: number | null = null;
    let agentColumn: string | null = null;

    if (UUID_RE.test(voice_setter_id)) {
      // ── UUID path: voice_setters + voice_setter_phone_bindings ──
      const { data: setter, error: setterErr } = await supabase
        .from("voice_setters")
        .select("id, retell_agent_id, name, is_active")
        .eq("id", voice_setter_id)
        .eq("client_id", client_id)
        .maybeSingle();
      if (setterErr || !setter) {
        return ok({
          error: `Voice setter ${voice_setter_id} not found for this client.`,
          code: "voice_setter_not_found",
        }, 404);
      }
      if (!setter.is_active) {
        return ok({
          error: `Voice setter "${setter.name}" is inactive.`,
          code: "voice_setter_inactive",
        }, 409);
      }
      agentId = setter.retell_agent_id;
      if (!agentId) {
        return ok({
          error: `Voice setter "${setter.name}" has no Retell agent provisioned yet.`,
          code: "no_retell_agent_for_setter",
          hint: `Open the "${setter.name}" editor and Save to provision the agent.`,
        }, 409);
      }
      // From-number from outbound binding (cadence node `from_number` override checked later).
      const { data: binding } = await supabase
        .from("voice_setter_phone_bindings")
        .select("phone_e164")
        .eq("setter_id", voice_setter_id)
        .eq("direction", "outbound")
        .eq("client_id", client_id)
        .limit(1)
        .maybeSingle();
      if (binding?.phone_e164) fromNumber = binding.phone_e164;
    } else {
      // ── Legacy slot path: parse "Voice-Setter-N" ──
      slotNumber = parseVoiceSetterSlot(voice_setter_id);
      if (!slotNumber) {
        return ok({
          error: `Invalid voice_setter_id format: ${voice_setter_id}`,
          code: "invalid_voice_setter_id",
        }, 400);
      }
      agentColumn = SLOT_TO_AGENT_COLUMN[slotNumber];
      if (!agentColumn) {
        return ok({
          error: `Invalid voice setter slot: ${slotNumber}`,
          code: "invalid_voice_setter_slot",
        }, 400);
      }
      agentId = (client as Record<string, unknown>)[agentColumn] as string | null;
      if (!agentId) {
        return ok({
          error: `No Retell agent configured for ${voice_setter_id} yet.`,
          code: "no_agent_for_slot",
          slot_id: voice_setter_id,
          slot_number: slotNumber,
          hint: `Open the ${voice_setter_id} editor, fill in the config, and click "Push to Retell" to provision the agent. Then try the test call again.`,
        }, 409);
      }
      const SLOT_TO_PHONE_COLUMN: Record<number, string> = {
        1: "retell_phone_1",
        2: "retell_phone_2",
        3: "retell_phone_3",
      };
      const slotPhoneCol = SLOT_TO_PHONE_COLUMN[slotNumber];
      const slotPhone = slotPhoneCol ? (client as Record<string, unknown>)[slotPhoneCol] as string | null : null;
      fromNumber = slotPhone || null;
    }

    // 3. Get destination phone number (the lead we're calling)
    const phone = contact_fields?.phone || body.phone;
    if (!phone) {
      return ok({
        error: "No phone number provided for the contact.",
        code: "no_contact_phone",
        hint: "Enter a phone number including country code (e.g. +61 4xx xxx xxx).",
      }, 400);
    }

    // 4. Fallback chain for from-number when not set by setter path above.
    if (!fromNumber) {
      fromNumber = client.retell_phone_2 || client.retell_phone_1 || client.retell_phone_3;
    }

    if (!fromNumber) {
      try {
        console.log("📞 No legacy phone columns set, querying Retell API for phone numbers...");
        const retellPhonesResult = await debugFetch(`${RETELL_BASE}/v2/list-phone-numbers`, {
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
            : Array.isArray((retellPhonesData as any)?.items)
              ? (retellPhonesData as any).items
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
      // Try Gary landing routing: surfaces agent_style + source_type +
      // utm_* to the Retell prompt so it can switch persona framing
      // ({{agent_style}}, {{source_type}}). Empty string when not a
      // try-gary lead — non-breaking for existing prompts that don't
      // reference these vars.
      agent_style: fields.agent_style || "",
      source_type: fields.source_type || "",
      utm_source: fields.utm_source || "",
      utm_medium: fields.utm_medium || "",
      utm_campaign: fields.utm_campaign || "",
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

    // Phase 11d + Bug 2 — push voicemail_option (workflow-level message) AND
    // detection flags (client-level `clients.voicemail_config`) to the agent
    // before placing the call. Hash-cached so we don't PATCH on every call.
    // Best-effort; non-fatal.
    const clientVoicemailCfg = (client as Record<string, unknown>).voicemail_config;
    const detectionCfg = clientVoicemailCfg && typeof clientVoicemailCfg === "object"
      ? clientVoicemailCfg as { detect_enabled?: unknown; detect_timeout_ms?: unknown }
      : null;
    if (
      (voicemail_config && typeof voicemail_config === "object") ||
      (detectionCfg && detectionCfg.detect_enabled === true)
    ) {
      await ensureVoicemailConfig(
        client.retell_api_key,
        agentId,
        voicemail_config,
        detectionCfg,
      );
    }

    // 7. Make the Retell API call with full debug capture
    // Re-check the idempotency guard right before spending: a duplicate
    // invocation may have dialed + stamped the key while this one was busy
    // with the GHL enrichment / agent PATCH above.
    {
      const guardResponse = await checkIdempotencyGuard();
      if (guardResponse) return guardResponse;
    }
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

      // REL-01: classify the failure so the caller doesn't retry-storm the
      // paid API. 5xx/429 are transient; any other 4xx (bad number, missing
      // agent, account/credit) is permanent and a retry can never succeed.
      const retryable = retellResp.status >= 500 || retellResp.status === 429;

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
          idempotency_key: idempotency_key || null,
          retell_status: retellResp.status,
          retell_response: retellData,
          retryable,
          steps,
        },
      });

      return ok({ error: errMsg, call_failed: true, retryable, steps }, 200);
    }

    const callId = retellData?.call_id || retellData?.id;
    console.log(`✅ Retell call initiated. call_id: ${callId}`);

    addStep("ocp-call", "Make Voice Setter Call", "action", "completed",
      `call_id=${callId} (${retellDuration}ms)`, undefined, retellDebug);

    // Persist initial call_history record with full debug steps. This row is
    // also the CAD-02 idempotency marker, so a failed stamp degrades the
    // dedup guarantee for this key — make that loud, and treat a 23505 on
    // call_history_idempotency_key_uidx as the smoking gun of a concurrent
    // double-dial (two invocations raced past the guard).
    if (callId) {
      try {
        const { error: chErr } = await supabase.from("call_history").upsert(
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
            idempotency_key: idempotency_key || null,
          },
          { onConflict: "call_id" },
        );
        if (chErr) {
          const isDupKey = (chErr as { code?: string }).code === "23505";
          console.error(
            `${isDupKey ? "🚨 DOUBLE-DIAL detected (idempotency_key already stamped by a concurrent invocation)" : "Failed to persist initial call_history"}: ${chErr.message}`,
          );
          const { error: logErr } = await supabase.from("error_logs").insert({
            client_id,
            severity: "error",
            source: "make-retell-outbound-call",
            error_type: isDupKey ? "duplicate_dial_detected" : "call_history_stamp_failed",
            error_message: chErr.message,
            context: { call_id: callId, idempotency_key: idempotency_key || null, execution_id },
          });
          if (logErr) console.error(`error_logs insert also failed: ${logErr.message}`);
        } else {
          console.log(`📦 Initial call_history record created for ${callId}`);
        }
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
