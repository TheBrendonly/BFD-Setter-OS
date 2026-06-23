import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RETELL_BASE = "https://api.retellai.com";
const GHL_BASE = "https://services.leadconnectorhq.com";

const ok = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/* ─── Step builder with full debug data ─── */

interface DebugStep {
  id: string;
  label: string;
  node_type: string;
  status: string;
  detail?: string;
  response_data?: string;
  timestamp?: string;
  debug?: {
    request_url?: string;
    request_method?: string;
    request_headers?: Record<string, string>;
    request_body?: unknown;
    response_status?: number;
    response_body?: unknown;
    error?: string;
    duration_ms?: number;
    metadata?: Record<string, unknown>;
  };
}

const steps: DebugStep[] = [];
const addStep = (
  id: string,
  label: string,
  nodeType: string,
  status: string,
  detail?: string,
  responseData?: string,
  debug?: DebugStep["debug"],
) => {
  steps.push({
    id,
    label,
    node_type: nodeType,
    status,
    detail,
    response_data: responseData,
    timestamp: new Date().toISOString(),
    debug,
  });
};

/* ─── GHL Helpers (with debug capture) ─── */

interface FetchDebugResult {
  data: unknown;
  raw: string;
  status: number;
  ok: boolean;
  duration_ms: number;
  url: string;
  error?: string;
}

async function debugFetch(
  url: string,
  options: RequestInit,
): Promise<FetchDebugResult> {
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
    return {
      data: null,
      raw: "",
      status: 0,
      ok: false,
      duration_ms,
      url,
      error: message,
    };
  }
}

async function fetchGhlFreeSlots(
  ghlApiKey: string,
  calendarId: string,
  timezone: string,
): Promise<{ slotsJson: string; debug: DebugStep["debug"] }> {
  const now = new Date();
  const plus30 = new Date();
  plus30.setDate(now.getDate() + 30);

  const url = new URL(`${GHL_BASE}/calendars/${calendarId}/free-slots`);
  url.searchParams.set("startDate", now.getTime().toString());
  url.searchParams.set("endDate", plus30.getTime().toString());
  url.searchParams.set("timezone", timezone);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ghlApiKey.slice(0, 8)}...`,
    Version: "2021-04-15",
  };

  const result = await debugFetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ghlApiKey}`,
      Version: "2021-04-15",
    },
  });

  const debug: DebugStep["debug"] = {
    request_url: url.toString(),
    request_method: "GET",
    request_headers: headers,
    response_status: result.status,
    response_body: result.data,
    duration_ms: result.duration_ms,
    error: result.error,
    metadata: {
      calendar_id: calendarId,
      timezone,
      window_start: now.toISOString(),
      window_end: plus30.toISOString(),
      window_days: 30,
    },
  };

  if (!result.ok) {
    return { slotsJson: "", debug };
  }

  return { slotsJson: JSON.stringify(result.data), debug };
}

async function fetchGhlContactDetails(
  ghlApiKey: string,
  contactId: string,
): Promise<{ details: Record<string, unknown>; debug: DebugStep["debug"] }> {
  const url = `${GHL_BASE}/contacts/${contactId}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ghlApiKey.slice(0, 8)}...`,
    Version: "2021-04-15",
  };

  const result = await debugFetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ghlApiKey}`,
      Version: "2021-04-15",
    },
  });

  const debug: DebugStep["debug"] = {
    request_url: url,
    request_method: "GET",
    request_headers: headers,
    response_status: result.status,
    response_body: result.data,
    duration_ms: result.duration_ms,
    error: result.error,
    metadata: { contact_id: contactId },
  };

  if (!result.ok) {
    return { details: {}, debug };
  }

  const contact = (result.data as any)?.contact || result.data || {};
  return { details: contact, debug };
}

// History lives in the client's EXTERNAL Supabase `chat_history` table (LangChain
// shape: session_id = lead_id, message = { type: "human"|"ai", content }, timestamp).
// The old code queried a non-existent platform `messages` table, so this was always
// empty (S3b-4).
async function fetchChatHistory(
  externalUrl: string | null | undefined,
  externalKey: string | null | undefined,
  leadId: string,
  clientId: string,
): Promise<{ history: string; debug: DebugStep["debug"] }> {
  const start = Date.now();
  const requestUrl = `external/chat_history?session_id=${leadId}`;
  if (!externalUrl || !externalKey) {
    return {
      history: "",
      debug: {
        request_url: requestUrl,
        request_method: "SELECT",
        response_status: 0,
        error: "external supabase_url/service_key not configured for client",
        metadata: { lead_id: leadId, client_id: clientId },
      } as DebugStep["debug"],
    };
  }
  try {
    const ext = createClient(externalUrl, externalKey);
    const { data, error } = await ext
      .from("chat_history")
      .select("message, timestamp")
      .eq("session_id", leadId)
      .order("timestamp", { ascending: true })
      .limit(50);

    const duration_ms = Date.now() - start;
    const debug: DebugStep["debug"] = {
      request_url: requestUrl,
      request_method: "SELECT",
      response_status: error ? 500 : 200,
      response_body: { row_count: data?.length ?? 0, error: error?.message },
      duration_ms,
      metadata: { lead_id: leadId, client_id: clientId, limit: 50 },
    };

    if (error || !data || data.length === 0) {
      return { history: "", debug };
    }

    const history = data
      .map((row: { message?: { type?: string; content?: unknown } }) => {
        const m = row.message || {};
        const role = m.type === "ai" ? "assistant" : m.type === "human" ? "user" : (m.type || "unknown");
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        return content ? `[${role}] ${content}` : "";
      })
      .filter(Boolean)
      .join("\n");
    return { history, debug };
  } catch (err: unknown) {
    const duration_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      history: "",
      debug: {
        request_url: requestUrl,
        request_method: "SELECT",
        response_status: 0,
        duration_ms,
        error: message,
      },
    };
  }
}

/* ─── Setter slot mapping ─── */

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Reset steps for each request
  steps.length = 0;

  try {
    const body = await req.json();
    const {
      lead_id,
      setter_name,
      campaign_id,
      contact_phone,
      contact_name,
      location_id,
      client_id,
      execution_id,
      treat_pickup_as_reply,
      custom_instructions,
      timezone,
    } = body;

    if (!client_id) return ok({ error: "client_id is required" }, 400);
    if (!setter_name) return ok({ error: "setter_name is required" }, 400);

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    addStep("ocp-trigger", "Campaign Trigger", "trigger", "completed",
      `lead=${lead_id}, setter=${setter_name}`, undefined, {
        metadata: {
          lead_id,
          setter_name,
          campaign_id,
          contact_phone,
          contact_name,
          execution_id,
          treat_pickup_as_reply,
          custom_instructions: custom_instructions ? custom_instructions.slice(0, 200) + "..." : "(default)",
          timezone: timezone || "America/New_York",
          request_body: body,
        },
      });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Fetch client config
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select(
        "retell_api_key, retell_inbound_agent_id, retell_outbound_agent_id, retell_outbound_followup_agent_id, retell_agent_id_4, retell_agent_id_5, retell_agent_id_6, retell_agent_id_7, retell_agent_id_8, retell_agent_id_9, retell_agent_id_10, retell_phone_1, retell_phone_2, retell_phone_3, ghl_location_id, ghl_api_key, ghl_calendar_id, supabase_url, supabase_service_key",
      )
      .eq("id", client_id)
      .single();

    if (clientErr || !client) return ok({ error: "Client not found" }, 404);
    if (!client.retell_api_key) return ok({ error: "Retell API key not configured" }, 400);

    // 2. Resolve agent ID
    const slotNumber = parseVoiceSetterSlot(setter_name);
    if (!slotNumber) return ok({ error: `Invalid setter_name: ${setter_name}` }, 400);
    const agentColumn = SLOT_TO_AGENT_COLUMN[slotNumber];
    if (!agentColumn) return ok({ error: `Invalid setter slot: ${slotNumber}` }, 400);

    const agentId = (client as Record<string, unknown>)[agentColumn] as string | null;
    if (!agentId) return ok({ error: `No Retell agent configured for ${setter_name}` }, 400);

    const phone = contact_phone || body.phone;
    if (!phone) return ok({ error: "No phone number provided" }, 400);

    const fromNumber = client.retell_phone_2 || client.retell_phone_1 || client.retell_phone_3;
    if (!fromNumber) return ok({ error: "No Retell phone number configured" }, 400);

    const ghlApiKey = client.ghl_api_key;
    const calendarId = client.ghl_calendar_id;
    const locId = location_id || client.ghl_location_id || "";
    const tz = timezone || "America/New_York";

    // 3. Fetch pre-call data in parallel with full debug capture
    const [slotsResult, contactResult, historyResult] = await Promise.all([
      ghlApiKey && calendarId
        ? fetchGhlFreeSlots(ghlApiKey, calendarId, tz)
        : Promise.resolve({
            slotsJson: "",
            debug: {
              error: "GHL calendar or API key not configured",
              metadata: {
                has_ghl_api_key: !!ghlApiKey,
                has_calendar_id: !!calendarId,
              },
            } as DebugStep["debug"],
          }),
      ghlApiKey && lead_id
        ? fetchGhlContactDetails(ghlApiKey, lead_id)
        : Promise.resolve({
            details: {} as Record<string, unknown>,
            debug: {
              error: "GHL API key or lead_id not available",
              metadata: { has_ghl_api_key: !!ghlApiKey, lead_id },
            } as DebugStep["debug"],
          }),
      lead_id
        ? fetchChatHistory(
            (client as { supabase_url?: string | null }).supabase_url,
            (client as { supabase_service_key?: string | null }).supabase_service_key,
            lead_id,
            client_id,
          )
        : Promise.resolve({
            history: "",
            debug: { error: "No lead_id provided" } as DebugStep["debug"],
          }),
    ]);

    const availableSlots = slotsResult.slotsJson;
    const contactDetails = contactResult.details;
    const chatHistory = historyResult.history;

    addStep(
      "ocp-slots",
      "Get Available Slots",
      "action",
      availableSlots ? "completed" : (slotsResult.debug?.error ? "failed" : "skipped"),
      availableSlots
        ? `${availableSlots.length} chars of slot data (${slotsResult.debug?.duration_ms}ms)`
        : slotsResult.debug?.error || "No GHL calendar configured",
      availableSlots || undefined,
      slotsResult.debug,
    );

    addStep(
      "ocp-history",
      "Get Text Setter History",
      "action",
      chatHistory ? "completed" : "skipped",
      chatHistory
        ? `${chatHistory.split("\n").length} messages (${historyResult.debug?.duration_ms}ms)`
        : historyResult.debug?.error || "No chat history found",
      chatHistory || undefined,
      historyResult.debug,
    );

    const customFields = (contactDetails as any)?.customFields || (contactDetails as any)?.custom_fields || {};
    addStep(
      "ocp-fields",
      "Get Custom Fields",
      "action",
      Object.keys(contactDetails).length > 0 ? "completed" : "skipped",
      Object.keys(contactDetails).length > 0
        ? `${Object.keys(customFields).length} custom fields, ${Object.keys(contactDetails).length} total fields (${contactResult.debug?.duration_ms}ms)`
        : contactResult.debug?.error || "No custom fields",
      Object.keys(contactDetails).length > 0 ? JSON.stringify(contactDetails) : undefined,
      contactResult.debug,
    );

    // 4. Build dynamic variables
    const now = new Date();
    const currentTimeET = now.toLocaleString("en-US", {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "short",
    });
    const dynamicVars: Record<string, string> = {
      contact_name: contact_name || "",
      first_name: (contact_name || "").split(" ")[0] || "",
      phone: phone,
      current_time: currentTimeET,
      execution_id: execution_id || "",
      voice_setter_id: setter_name || "",
      treat_pickup_as_reply: treat_pickup_as_reply ? "true" : "false",
    };

    if (availableSlots) dynamicVars.available_time_slots = availableSlots;
    if (chatHistory) dynamicVars.chat_history = chatHistory;
    if (Object.keys(customFields).length > 0) dynamicVars.custom_fields = JSON.stringify(customFields);
    if (Object.keys(contactDetails).length > 0)
      dynamicVars.user_contact_details = JSON.stringify(contactDetails);
    const DEFAULT_CALL_INSTRUCTIONS = `Keep the conversation natural and human-like. Speak casually as if you're a real person, not a bot. Use filler words occasionally (like "yeah", "I mean", "for sure"). Keep responses short - 1 to 2 sentences max unless they ask for more detail. Mirror the prospect's energy and pace. If they sound busy, get to the point fast. If they're chatty, match that vibe. Never sound scripted or robotic.`;
    dynamicVars.custom_instructions = custom_instructions || DEFAULT_CALL_INSTRUCTIONS;
    if (locId) {
      dynamicVars.ghl_account_id = locId;
      dynamicVars.ghl_contact_id = lead_id || "";
      dynamicVars.contact_id = lead_id || "";
    }

    // 5. Call Retell with full debug capture
    console.log(`📞 Outbound call: agent=${agentId}, to=${phone}, from=${fromNumber}`);
    const retellPayload = {
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

    // Build a sanitized version of dynamic vars for debug (truncate large values)
    const sanitizedDynVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(dynamicVars)) {
      sanitizedDynVars[k] = v.length > 500 ? v.slice(0, 500) + `... (${v.length} chars total)` : v;
    }

    const retellDebug: DebugStep["debug"] = {
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
        campaign_id,
        execution_id,
      },
    };

    if (!retellResp.ok) {
      const errMsg = retellData?.message || retellData?.error || `Retell API returned ${retellResp.status}`;
      retellDebug.error = errMsg;
      addStep("ocp-call", "Make Voice Setter Call", "action", "failed", errMsg, undefined, retellDebug);

      await supabase.from("error_logs").insert({
        client_ghl_account_id: locId || "unknown",
        severity: "error",
        source: "outbound-call-processing",
        error_type: "retell_api_error",
        error_message: errMsg,
        context: {
          agent_id: agentId,
          to_number: phone,
          from_number: fromNumber,
          execution_id,
          campaign_id,
          retell_status: retellResp.status,
          retell_response: retellData,
          steps,
        },
      });

      return ok({ error: errMsg, call_failed: true, steps }, 200);
    }

    const callId = retellData?.call_id || retellData?.id;
    addStep(
      "ocp-call",
      "Make Voice Setter Call",
      "action",
      "completed",
      `call_id=${callId} (${retellDuration}ms)`,
      undefined,
      retellDebug,
    );
    console.log(`✅ Outbound call initiated. call_id: ${callId}`);

    // Persist pre-call context with full debug data
    if (callId) {
      try {
        await supabase.from("call_history").upsert(
          {
            call_id: callId,
            client_id: client_id,
            contact_id: lead_id || null,
            contact_name: contact_name || null,
            agent_id: agentId,
            setter_id: setter_name || null,
            direction: "outbound",
            from_number: fromNumber,
            to_number: phone,
            call_status: "initiated",
            campaign_id: campaign_id || null,
            pre_call_context: { steps },
          },
          { onConflict: "call_id" },
        );
      } catch (e) {
        console.warn("Failed to persist pre_call_context:", e);
      }
    }

    return ok({
      success: true,
      call_id: callId,
      agent_id: agentId,
      to_number: phone,
      from_number: fromNumber,
      calendar_slots_included: !!availableSlots,
      chat_history_included: !!chatHistory,
      custom_fields_included: Object.keys(customFields).length > 0,
      steps,
    });
  } catch (err) {
    console.error("outbound-call-processing error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return ok({ error: message, call_failed: true, steps }, 200);
  }
});
