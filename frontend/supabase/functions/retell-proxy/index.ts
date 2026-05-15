import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RETELL_BASE = "https://api.retellai.com";
const DEFAULT_RETELL_WEBHOOK_EVENTS = ["call_analyzed"];

// Map internal model names to Retell-supported model names
function mapToRetellModel(model: string): string {
  // Strip OpenRouter-style prefixes (e.g., "openai/gpt-5" -> "gpt-5")
  const stripped = model.includes('/') ? model.split('/').pop()! : model;
  
  const mapping: Record<string, string> = {
    "claude-sonnet-4": "claude-4.0-sonnet",
    "claude-4-sonnet": "claude-4.0-sonnet",
    "claude-sonnet-4.5": "claude-4.5-sonnet",
    "claude-haiku-3.5": "claude-4.5-haiku",
    "deepseek-chat": "gpt-4.1-nano",
    "gpt-4": "gpt-4o",
    "gpt-4-turbo": "gpt-4o",
  };
  if (mapping[stripped]) return mapping[stripped];
  const validModels = [
    "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
    "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.2",
    "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
    "claude-4.0-sonnet", "claude-4.5-sonnet", "claude-4.6-sonnet", "claude-4.5-haiku",
    "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.0-flash",
  ];
  if (validModels.includes(stripped)) return stripped;
  console.warn(`[retell-proxy] Unknown model "${model}", falling back to gpt-4.1-nano`);
  return "gpt-4.1-nano";
}

function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey);
}

class RetellProxyAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Decode a Supabase auth JWT without verifying the signature.
// Local decode mirrors check-client-subscription/index.ts:60-71 — avoids
// brittle getUser() session-not-found issues and is sufficient because
// every subsequent DB query goes through the service role + an
// agency/client ownership check below.
function decodeJwtSub(authHeader: string | null): string {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new RetellProxyAuthError(401, "Unauthorized");
  }
  const token = authHeader.slice("Bearer ".length);
  let payload: { sub?: string };
  try {
    payload = JSON.parse(atob(token.split(".")[1]));
  } catch {
    throw new RetellProxyAuthError(401, "Unauthorized");
  }
  if (!payload.sub) throw new RetellProxyAuthError(401, "Unauthorized");
  return payload.sub;
}

// Verify the calling user is allowed to act on `clientId`.
// Agency users: profile.agency_id must match clients.agency_id.
// Client users: profile.client_id must match clients.id.
// This is the same check check-client-subscription performs.
async function assertClientAccess(authHeader: string | null, clientId: string): Promise<void> {
  const userId = decodeJwtSub(authHeader);
  const supabase = getSupabaseAdmin();

  const [{ data: client }, { data: roleData }, { data: profile }] = await Promise.all([
    supabase.from("clients").select("id, agency_id").eq("id", clientId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle(),
    supabase.from("profiles").select("agency_id, client_id").eq("id", userId).maybeSingle(),
  ]);

  if (!client) throw new RetellProxyAuthError(404, "Client not found");

  const role = roleData?.role;
  const allowed = role === "agency"
    ? !!profile?.agency_id && profile.agency_id === client.agency_id
    : role === "client"
      ? profile?.client_id === client.id
      : false;

  if (!allowed) {
    console.warn(`[retell-proxy] Forbidden: user=${userId} role=${role ?? "none"} clientId=${clientId}`);
    throw new RetellProxyAuthError(403, "Forbidden");
  }
}

async function getRetellApiKey(clientId: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("clients")
    .select("retell_api_key")
    .eq("id", clientId)
    .single();

  if (error) throw new Error(`Failed to fetch client: ${error.message}`);
  if (!data?.retell_api_key) throw new Error("Retell API key not configured. Please add it in API Credentials.");
  return data.retell_api_key;
}

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

function getAutoWebhookUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  return `${supabaseUrl}/functions/v1/retell-call-analysis-webhook`;
}

async function syncVoiceSetter(
  apiKey: string,
  clientId: string,
  slotNumber: number,
  generalPrompt: string,
  beginMessage: string,
  model: string,
  agentName: string,
  voiceSettings?: Record<string, unknown>,
  llmSettings?: Record<string, unknown>,
): Promise<unknown> {
  const retellModel = mapToRetellModel(model);
  const supabase = getSupabaseAdmin();
  const agentColumn = SLOT_TO_AGENT_COLUMN[slotNumber];
  if (!agentColumn) throw new Error(`Invalid voice setter slot number: ${slotNumber}`);

  const DEPRECATED_TOOLS = ['create-contact', 'get_contact', 'get-contact'];
  const isValidUrl = (u: unknown): boolean => {
    if (typeof u !== 'string' || !u.trim()) return false;
    try { new URL(u); return true; } catch { return false; }
  };
  const rawTools = Array.isArray(llmSettings?.general_tools) && llmSettings.general_tools.length > 0
    ? (llmSettings.general_tools as Array<Record<string, unknown>>)
        .filter((t) => !DEPRECATED_TOOLS.includes(t.name as string))
        .map((t) => ({
          ...t,
          // Trim tool name to avoid Retell API validation errors
          name: typeof t.name === 'string' ? t.name.trim() : t.name,
          // Trim query_params keys (e.g. " get-contact-appointments" → "get-contact-appointments")
          ...(t.query_params && typeof t.query_params === 'object'
            ? { query_params: Object.fromEntries(Object.entries(t.query_params as Record<string, unknown>).map(([k, v]) => [k.trim(), typeof v === 'string' ? v.trim() : v])) }
            : {}),
        }))
    : [{ type: "end_call", name: "end_call" }];
  // Validate webhook tool URLs — strip tools with invalid URLs to prevent Retell API errors
  const validatedTools = rawTools.filter((t) => {
    if (t.type === 'end_call' || t.type === 'transfer_call') return true;
    if (t.url !== undefined && !isValidUrl(t.url)) {
      console.warn(`[sync-voice-setter] Skipping tool "${t.name}" — invalid URL: "${t.url}"`);
      return false;
    }
    return true;
  });
  const generalTools = validatedTools.length > 0 ? validatedTools : [{ type: "end_call", name: "end_call" }];
  console.log(`[sync-voice-setter] Tools received (${rawTools.length}):`, JSON.stringify(rawTools.map((t: any) => t.name || t.type)));
  console.log(`[sync-voice-setter] Tools to sync (${generalTools.length}):`, JSON.stringify(generalTools.map((t: any) => t.name || t.type)));
  const knowledgeBaseIds = Array.isArray(llmSettings?.knowledge_base_ids)
    ? (llmSettings.knowledge_base_ids as unknown[]).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    : [];
  // Auto-append dynamic variables reference block so Retell can substitute them
  const DYNAMIC_VARS_BLOCK = `

── ── ── ── ── ── ── ── ── ── ── ── ── ──

## DYNAMIC VARIABLES (auto-injected, available at runtime)

You have access to the following dynamic variables about the lead you are calling. Use them naturally in conversation — do NOT ask the lead for information you already have.

- **Lead First Name**: {{first_name}}
- **Lead Last Name**: {{last_name}}
- **Lead Email**: {{email}}
- **Lead Phone**: {{phone}}
- **Lead Business Name**: {{business_name}}
- **Current Date & Time (ET)**: {{current_time}}
- **Available Calendar Slots**: {{available_time_slots}}
- **Full Contact Details**: {{user_contact_details}}
- **Custom Instructions**: {{custom_instructions}}`;

  const enrichedPrompt = generalPrompt + DYNAMIC_VARS_BLOCK;

  const llmPayload: Record<string, unknown> = {
    model: retellModel,
    general_prompt: enrichedPrompt,
    begin_message: beginMessage || null,
    general_tools: generalTools,
    model_high_priority: llmSettings?.model_high_priority ?? true,
    start_speaker:
      typeof llmSettings?.start_speaker === "string" && llmSettings.start_speaker.trim().length > 0
        ? llmSettings.start_speaker
        : "agent",
    knowledge_base_ids: knowledgeBaseIds,
  };

  // Build agent-level update payload from voiceSettings
  // Use explicit !== undefined checks so falsy values (0, false, null) are properly sent
  const agentUpdates: Record<string, unknown> = {};
  if (voiceSettings) {
    if (typeof voiceSettings.voice_id === 'string' && voiceSettings.voice_id.trim().length > 0) {
      agentUpdates.voice_id = voiceSettings.voice_id.trim();
    }
    // voice_model rules per Retell: required for 11labs-* presets AND raw ElevenLabs IDs;
    // NOT accepted for Retell-managed prefixes (custom_voice_*, openai-*, cartesia-*, play-*).
    if (voiceSettings.voice_model && typeof voiceSettings.voice_id === 'string') {
      const vid = voiceSettings.voice_id.trim();
      const isRetellManaged = vid.startsWith('custom_voice_')
        || vid.startsWith('openai-')
        || vid.startsWith('cartesia-')
        || vid.startsWith('play-');
      if (!isRetellManaged) {
        agentUpdates.voice_model = voiceSettings.voice_model;
      }
    }
    if (voiceSettings.voice_temperature !== undefined) agentUpdates.voice_temperature = voiceSettings.voice_temperature;
    if (voiceSettings.voice_speed !== undefined) agentUpdates.voice_speed = voiceSettings.voice_speed;
    if (voiceSettings.volume !== undefined) agentUpdates.volume = voiceSettings.volume;
    if (voiceSettings.language !== undefined) agentUpdates.language = voiceSettings.language || "en-US";
    if (voiceSettings.ambient_sound !== undefined) {
      agentUpdates.ambient_sound = voiceSettings.ambient_sound && voiceSettings.ambient_sound !== "none"
        ? voiceSettings.ambient_sound
        : null;
    }
    if (voiceSettings.ambient_sound_volume !== undefined) agentUpdates.ambient_sound_volume = voiceSettings.ambient_sound_volume;
    if (voiceSettings.responsiveness !== undefined) agentUpdates.responsiveness = voiceSettings.responsiveness;
    if (voiceSettings.interruption_sensitivity !== undefined) agentUpdates.interruption_sensitivity = voiceSettings.interruption_sensitivity;
    if (voiceSettings.end_call_after_silence_ms !== undefined) {
      agentUpdates.end_call_after_silence_ms = voiceSettings.end_call_after_silence_ms;
    }
    if (voiceSettings.max_call_duration_ms !== undefined) agentUpdates.max_call_duration_ms = voiceSettings.max_call_duration_ms;
    if (Array.isArray(voiceSettings.boosted_keywords)) {
      agentUpdates.boosted_keywords = voiceSettings.boosted_keywords.length > 0 ? voiceSettings.boosted_keywords : [];
    }
    if (voiceSettings.enable_backchannel !== undefined) agentUpdates.enable_backchannel = voiceSettings.enable_backchannel;
    if (voiceSettings.backchannel_frequency !== undefined) agentUpdates.backchannel_frequency = voiceSettings.backchannel_frequency;
    if (voiceSettings.begin_message_delay_ms !== undefined) agentUpdates.begin_message_delay_ms = voiceSettings.begin_message_delay_ms;
    if (voiceSettings.webhook_timeout_ms !== undefined) agentUpdates.webhook_timeout_ms = voiceSettings.webhook_timeout_ms;
    if (voiceSettings.data_storage_setting !== undefined) agentUpdates.data_storage_setting = voiceSettings.data_storage_setting || "everything";
    if (voiceSettings.normalize_for_speech !== undefined) agentUpdates.normalize_for_speech = voiceSettings.normalize_for_speech;
    if (voiceSettings.reminder_trigger_ms !== undefined) agentUpdates.reminder_trigger_ms = voiceSettings.reminder_trigger_ms;
    if (voiceSettings.reminder_max_count !== undefined) agentUpdates.reminder_max_count = voiceSettings.reminder_max_count;
    if (voiceSettings.opt_out_sensitive_data_storage !== undefined) agentUpdates.opt_out_sensitive_data_storage = voiceSettings.opt_out_sensitive_data_storage;
    if (voiceSettings.post_call_analysis_model !== undefined) agentUpdates.post_call_analysis_model = voiceSettings.post_call_analysis_model || "gpt-4.1";
    if (voiceSettings.analysis_successful_prompt !== undefined) agentUpdates.analysis_successful_prompt = voiceSettings.analysis_successful_prompt;
    if (voiceSettings.analysis_summary_prompt !== undefined) agentUpdates.analysis_summary_prompt = voiceSettings.analysis_summary_prompt;
    if (voiceSettings.analysis_user_sentiment_prompt !== undefined) agentUpdates.analysis_user_sentiment_prompt = voiceSettings.analysis_user_sentiment_prompt;
    if (Array.isArray(voiceSettings.post_call_analysis_data)) agentUpdates.post_call_analysis_data = voiceSettings.post_call_analysis_data;
    if (voiceSettings.voicemail_option !== undefined && typeof voiceSettings.voicemail_option === "object") {
      agentUpdates.voicemail_option = voiceSettings.voicemail_option;
    }
    if (voiceSettings.vocab_specialization !== undefined) agentUpdates.vocab_specialization = voiceSettings.vocab_specialization || "general";
    if (voiceSettings.user_dtmf_options !== undefined && typeof voiceSettings.user_dtmf_options === "object") {
      agentUpdates.user_dtmf_options = voiceSettings.user_dtmf_options;
    }
    if (voiceSettings.stt_mode !== undefined) agentUpdates.stt_mode = voiceSettings.stt_mode;
    if (voiceSettings.custom_stt_config !== undefined && typeof voiceSettings.custom_stt_config === "object") {
      agentUpdates.custom_stt_config = voiceSettings.custom_stt_config;
    }
    if (voiceSettings.pii_config !== undefined && typeof voiceSettings.pii_config === "object") {
      agentUpdates.pii_config = voiceSettings.pii_config;
    }
  }

  // Fetch the current agent ID for this slot
  const { data: clientData, error: clientErr } = await supabase
    .from("clients")
    .select(agentColumn)
    .eq("id", clientId)
    .single();
  if (clientErr) throw new Error(`Failed to fetch client: ${clientErr.message}`);

  const existingAgentId = (clientData as Record<string, string | null>)?.[agentColumn];

  if (existingAgentId) {
    console.log(`[sync-voice-setter] Updating existing agent ${existingAgentId} for slot ${slotNumber}`);
    const agent = await retellFetch(apiKey, "GET", `get-agent/${existingAgentId}`) as any;
    const llmId = agent?.response_engine?.llm_id;

    if (llmId) {
      const updatedLlm = await retellFetch(apiKey, "PATCH", `update-retell-llm/${llmId}`, llmPayload);
      // Always update agent with name + voice settings + auto webhook
      const agentPatch: Record<string, unknown> = {
        ...agentUpdates,
        webhook_events: DEFAULT_RETELL_WEBHOOK_EVENTS,
      };
      if (agentName) agentPatch.agent_name = agentName;
      // Auto-set webhook so call data syncs without manual config
      if (!agentPatch.webhook_url) agentPatch.webhook_url = getAutoWebhookUrl();
      // Always send the patch to ensure all settings sync
      await retellFetch(apiKey, "PATCH", `update-agent/${existingAgentId}`, agentPatch);
      // Auto-publish so changes go live immediately
      try {
        await retellFetch(apiKey, "POST", `publish-agent/${existingAgentId}`);
        console.log(`[sync-voice-setter] Auto-published agent ${existingAgentId}`);
      } catch (pubErr) {
        console.warn(`[sync-voice-setter] Auto-publish failed (non-blocking):`, pubErr);
      }
      return { success: true, action: "updated_and_published", agent_id: existingAgentId, llm_id: llmId, llm: updatedLlm };
    } else {
      const newLlm = await retellFetch(apiKey, "POST", "create-retell-llm", llmPayload) as any;
      await retellFetch(apiKey, "PATCH", `update-agent/${existingAgentId}`, {
        agent_name: agentName || agent.agent_name,
        response_engine: {
          type: "retell-llm",
          llm_id: newLlm.llm_id,
          ...(newLlm?.version ? { version: newLlm.version } : {}),
        },
        ...agentUpdates,
        webhook_url: agentUpdates.webhook_url || getAutoWebhookUrl(),
        webhook_events: DEFAULT_RETELL_WEBHOOK_EVENTS,
      });
      // Auto-publish so changes go live immediately
      try {
        await retellFetch(apiKey, "POST", `publish-agent/${existingAgentId}`);
        console.log(`[sync-voice-setter] Auto-published agent ${existingAgentId}`);
      } catch (pubErr) {
        console.warn(`[sync-voice-setter] Auto-publish failed (non-blocking):`, pubErr);
      }
      return { success: true, action: "updated_with_new_llm_and_published", agent_id: existingAgentId, llm_id: newLlm.llm_id };
    }
  } else {
    console.log(`[sync-voice-setter] Creating new agent for slot ${slotNumber}`);

    // Use voice from settings or fallback to first available
    let voiceId = voiceSettings?.voice_id as string | undefined;
    if (!voiceId) {
      const voices = await retellFetch(apiKey, "GET", "list-voices") as any[];
      voiceId = voices?.[0]?.voice_id;
      if (!voiceId) throw new Error("No voices available in your Retell account. Please add a voice first.");
    }

    const newLlm = await retellFetch(apiKey, "POST", "create-retell-llm", llmPayload) as any;

    const createAgentPayload = Object.fromEntries(
      Object.entries({
        agent_name: agentName || `Voice Setter ${slotNumber}`,
        channel: "voice",
        voice_id: voiceId,
        response_engine: {
          type: "retell-llm",
          llm_id: newLlm.llm_id,
          ...(newLlm?.version ? { version: newLlm.version } : {}),
        },
        language: (voiceSettings?.language as string) || "en-US",
        ...agentUpdates,
        webhook_url: agentUpdates.webhook_url || getAutoWebhookUrl(),
        webhook_events: DEFAULT_RETELL_WEBHOOK_EVENTS,
      }).filter(([, value]) => value !== undefined && value !== null),
    );

    const newAgent = await retellFetch(apiKey, "POST", "create-agent", createAgentPayload) as any;

    await supabase.from("clients").update({
      [agentColumn]: newAgent.agent_id,
    }).eq("id", clientId);

    console.log(`[sync-voice-setter] Created agent ${newAgent.agent_id} and stored in ${agentColumn}`);
    // Auto-publish newly created agent
    try {
      await retellFetch(apiKey, "POST", `publish-agent/${newAgent.agent_id}`);
      console.log(`[sync-voice-setter] Auto-published new agent ${newAgent.agent_id}`);
    } catch (pubErr) {
      console.warn(`[sync-voice-setter] Auto-publish of new agent failed (non-blocking):`, pubErr);
    }
    return { success: true, action: "created_and_published", agent_id: newAgent.agent_id, llm_id: newLlm.llm_id };
  }
}

async function retellFetch(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
  isFormData = false
): Promise<unknown> {
  const url = `${RETELL_BASE}/${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const options: RequestInit = { method, headers };
  if (body && !isFormData) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  // DELETE returns 204 with no body
  if (res.status === 204) return { success: true };

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = typeof data === "object" && data !== null && "message" in data
      ? (data as { message: string }).message
      : text;
    throw new Error(`Retell API error [${res.status}]: ${msg}`);
  }

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, clientId, ...params } = await req.json();
    if (!clientId) throw new Error("clientId is required");
    if (!action) throw new Error("action is required");

    // Ownership check: the caller's JWT must map to a profile that owns
    // (or has agency-level access to) the requested clientId. Without this,
    // any authenticated agency user could pass another client's UUID and
    // operate on their Retell account / read their API key.
    await assertClientAccess(req.headers.get("Authorization"), clientId);

    const apiKey = await getRetellApiKey(clientId);
    let result: unknown;

    switch (action) {
      // ===== AGENTS =====
      case "list-agents":
        result = await retellFetch(apiKey, "GET", "list-agents");
        break;

      case "get-agent":
        if (!params.agentId) throw new Error("agentId is required");
        result = await retellFetch(apiKey, "GET", `get-agent/${params.agentId}`);
        break;

      case "create-agent":
        result = await retellFetch(apiKey, "POST", "create-agent", params.agentData);
        break;

      case "update-agent":
        if (!params.agentId) throw new Error("agentId is required");
        result = await retellFetch(apiKey, "PATCH", `update-agent/${params.agentId}`, params.agentData);
        break;

      case "delete-agent":
        if (!params.agentId) throw new Error("agentId is required");
        result = await retellFetch(apiKey, "DELETE", `delete-agent/${params.agentId}`);
        break;

      // ===== RETELL LLMs =====
      case "list-llms":
        result = await retellFetch(apiKey, "GET", "list-retell-llms");
        break;

      case "get-llm":
        if (!params.llmId) throw new Error("llmId is required");
        result = await retellFetch(apiKey, "GET", `get-retell-llm/${params.llmId}`);
        break;

      case "create-llm":
        result = await retellFetch(apiKey, "POST", "create-retell-llm", params.llmData);
        break;

      case "update-llm":
        if (!params.llmId) throw new Error("llmId is required");
        result = await retellFetch(apiKey, "PATCH", `update-retell-llm/${params.llmId}`, params.llmData);
        break;

      case "delete-llm":
        if (!params.llmId) throw new Error("llmId is required");
        result = await retellFetch(apiKey, "DELETE", `delete-retell-llm/${params.llmId}`);
        break;

      // ===== KNOWLEDGE BASE =====
      case "list-knowledge-bases":
        result = await retellFetch(apiKey, "GET", "list-knowledge-bases");
        break;

      case "get-knowledge-base":
        if (!params.kbId) throw new Error("kbId is required");
        result = await retellFetch(apiKey, "GET", `get-knowledge-base/${params.kbId}`);
        break;

      case "create-knowledge-base": {
        // Retell KB creation requires multipart/form-data
        const kbData = params.kbData as Record<string, unknown>;
        const formData = new FormData();
        if (kbData.knowledge_base_name) {
          formData.append("knowledge_base_name", kbData.knowledge_base_name as string);
        }
        if (Array.isArray(kbData.knowledge_base_texts)) {
          formData.append("knowledge_base_texts", JSON.stringify(kbData.knowledge_base_texts));
        }
        if (Array.isArray(kbData.knowledge_base_urls)) {
          formData.append("knowledge_base_urls", JSON.stringify(kbData.knowledge_base_urls));
        }
        if (kbData.enable_auto_refresh !== undefined) {
          formData.append("enable_auto_refresh", String(kbData.enable_auto_refresh));
        }

        const kbUrl = `${RETELL_BASE}/create-knowledge-base`;
        const kbRes = await fetch(kbUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: formData,
        });
        const kbText = await kbRes.text();
        let kbResult: unknown;
        try { kbResult = JSON.parse(kbText); } catch { kbResult = { raw: kbText }; }
        if (!kbRes.ok) {
          const kbMsg = typeof kbResult === "object" && kbResult !== null && "message" in kbResult
            ? (kbResult as { message: string }).message : kbText;
          throw new Error(`Retell API error [${kbRes.status}]: ${kbMsg}`);
        }
        result = kbResult;
        break;
      }

      case "delete-knowledge-base":
        if (!params.kbId) throw new Error("kbId is required");
        result = await retellFetch(apiKey, "DELETE", `delete-knowledge-base/${params.kbId}`);
        break;

      // ===== PHONE NUMBERS =====
      case "list-phone-numbers":
        result = await retellFetch(apiKey, "GET", "list-phone-numbers");
        break;

      case "import-phone-number":
        result = await retellFetch(apiKey, "POST", "import-phone-number", params.phoneData);
        break;

      case "update-phone-number":
        if (!params.phoneNumber) throw new Error("phoneNumber is required");
        result = await retellFetch(
          apiKey,
          "PATCH",
          `update-phone-number/${encodeURIComponent(params.phoneNumber)}`,
          params.phoneData
        );
        break;

      case "delete-phone-number":
        if (!params.phoneNumber) throw new Error("phoneNumber is required");
        result = await retellFetch(
          apiKey,
          "DELETE",
          `delete-phone-number/${encodeURIComponent(params.phoneNumber)}`
        );
        break;

      // ===== CALLS =====
      case "list-calls":
        result = await retellFetch(apiKey, "GET", "list-calls");
        break;

      case "get-call":
        if (!params.callId) throw new Error("callId is required");
        result = await retellFetch(apiKey, "GET", `get-call/${params.callId}`);
        break;

      case "create-phone-call":
        result = await retellFetch(apiKey, "POST", "create-phone-call", params.callData);
        break;

      // ===== VOICES =====
      case "list-voices":
        result = await retellFetch(apiKey, "GET", "list-voices");
        break;

      // ===== DELETE VOICE SETTER =====
      case "delete-voice-setter": {
        const slotNumber = params.slotNumber as number;
        if (!slotNumber) throw new Error("slotNumber is required");
        const agentColumn = SLOT_TO_AGENT_COLUMN[slotNumber];
        if (!agentColumn) throw new Error(`Invalid voice setter slot number: ${slotNumber}`);

        const supabaseAdmin = getSupabaseAdmin();
        const { data: clientRow, error: clientFetchErr } = await supabaseAdmin
          .from("clients")
          .select(agentColumn)
          .eq("id", clientId)
          .single();
        if (clientFetchErr) throw new Error(`Failed to fetch client: ${clientFetchErr.message}`);

        const existingAgentId = (clientRow as Record<string, string | null>)?.[agentColumn];
        if (existingAgentId) {
          console.log(`[delete-voice-setter] Deleting Retell agent ${existingAgentId} for slot ${slotNumber}`);
          // Get LLM ID before deleting agent
          try {
            const agent = await retellFetch(apiKey, "GET", `get-agent/${existingAgentId}`) as any;
            const llmId = agent?.response_engine?.llm_id;
            // Delete agent first
            await retellFetch(apiKey, "DELETE", `delete-agent/${existingAgentId}`);
            console.log(`[delete-voice-setter] Deleted Retell agent ${existingAgentId}`);
            // Delete LLM if exists
            if (llmId) {
              try {
                await retellFetch(apiKey, "DELETE", `delete-retell-llm/${llmId}`);
                console.log(`[delete-voice-setter] Deleted Retell LLM ${llmId}`);
              } catch (llmErr) {
                console.warn(`[delete-voice-setter] Failed to delete LLM ${llmId}:`, llmErr);
              }
            }
          } catch (agentErr) {
            console.warn(`[delete-voice-setter] Failed to delete agent ${existingAgentId}:`, agentErr);
          }
          // Clear agent ID from clients table
          await supabaseAdmin.from("clients").update({ [agentColumn]: null }).eq("id", clientId);
          console.log(`[delete-voice-setter] Cleared ${agentColumn} on client ${clientId}`);
        } else {
          console.log(`[delete-voice-setter] No Retell agent found for slot ${slotNumber}, skipping`);
        }

        result = { success: true, action: "deleted", slot: slotNumber, agent_id: existingAgentId || null };
        break;
      }

      // ===== SYNC VOICE SETTER =====
      case "sync-voice-setter": {
        const slotNumber = params.slotNumber as number;
        if (!slotNumber) throw new Error("slotNumber is required");
        const generalPrompt = (params.generalPrompt as string) || "";
        const beginMessage = (params.beginMessage as string) || "";
        const model = (params.model as string) || "gpt-4.1-nano";
        const agentName = (params.agentName as string) || "";
        const voiceSettings = params.voiceSettings as Record<string, unknown> | undefined;
        const llmSettings = params.llmSettings as Record<string, unknown> | undefined;
        console.log(`[sync-voice-setter] Starting sync for slot ${slotNumber}, model: ${model}, agentName: ${agentName}`);
        console.log(`[sync-voice-setter] beginMessage: "${beginMessage}"`);
        console.log(`[sync-voice-setter] Voice settings keys:`, voiceSettings ? Object.keys(voiceSettings) : 'none');
        console.log(`[sync-voice-setter] LLM settings:`, JSON.stringify({
          model_high_priority: llmSettings?.model_high_priority,
          tools_count: Array.isArray(llmSettings?.general_tools) ? llmSettings.general_tools.length : 0,
          kb_ids: llmSettings?.knowledge_base_ids,
          start_speaker: llmSettings?.start_speaker,
        }));
        result = await syncVoiceSetter(apiKey, clientId, slotNumber, generalPrompt, beginMessage, model, agentName, voiceSettings, llmSettings);
        console.log(`[sync-voice-setter] Result:`, JSON.stringify(result));
        break;
      }

      // ===== REFRESH BOOKING TOOL MESSAGES (across all voice setter slots) =====
      // Updates execution_message_description on the 5 booking tools for every
      // deployed Retell LLM tied to this client, without touching the prompt
      // or any other agent settings. Used after we change the default Talk-While-
      // Waiting copy and want existing agents to pick it up.
      case "refresh-booking-tool-messages": {
        const BOOKING_TOOL_MESSAGES: Record<string, string> = {
          "get-available-slots":
            'Based on what the user asked, say a brief natural phrase like "Let me check what I have open for you" or "One sec, pulling up the calendar". Keep it casual, under 10 words, never sound scripted.',
          "book-appointments":
            'Based on the slot the user just picked, say something natural like "Yep, great, let me finalize your booking on my side" or "Perfect, locking that in for you now". Confirm their choice casually, under 12 words.',
          "get-contact-appointments":
            'Based on what the user asked, say a brief natural phrase like "Yes, please bear with me while I check my system" or "Let me pull up your appointments real quick". Acknowledge naturally, under 12 words.',
          "update-appointment":
            'Based on what the user just asked, say a brief casual phrase confirming the change is in progress. Examples: "No worries, updating your booking now, just a few seconds" or "Got it, making that change for you". Keep it natural, under 12 words, never robotic.',
          "cancel-appointments":
            'Based on the user\'s cancellation request, say something brief like "Good, give me a second to process your cancellation" or "Understood, cancelling that for you now". Confirm naturally, under 12 words.',
        };

        const supabaseAdmin = getSupabaseAdmin();
        const agentColumns = Object.values(SLOT_TO_AGENT_COLUMN);
        const { data: clientRow, error: clientFetchErr } = await supabaseAdmin
          .from("clients")
          .select(agentColumns.join(", "))
          .eq("id", clientId)
          .single();
        if (clientFetchErr) throw new Error(`Failed to fetch client: ${clientFetchErr.message}`);

        const updates: Array<Record<string, unknown>> = [];
        for (const [slotStr, column] of Object.entries(SLOT_TO_AGENT_COLUMN)) {
          const agentId = (clientRow as Record<string, string | null>)?.[column];
          if (!agentId) continue;
          try {
            const agent = await retellFetch(apiKey, "GET", `get-agent/${agentId}`) as any;
            const llmId = agent?.response_engine?.llm_id;
            if (!llmId) {
              updates.push({ slot: Number(slotStr), agent_id: agentId, status: "skipped", reason: "no_llm_id" });
              continue;
            }
            const llm = await retellFetch(apiKey, "GET", `get-retell-llm/${llmId}`) as any;
            const currentTools = Array.isArray(llm?.general_tools) ? llm.general_tools : [];
            let touched = 0;
            const patchedTools = currentTools.map((tool: Record<string, unknown>) => {
              const name = typeof tool.name === "string" ? tool.name.trim() : "";
              if (BOOKING_TOOL_MESSAGES[name]) {
                touched += 1;
                return {
                  ...tool,
                  execution_message_description: BOOKING_TOOL_MESSAGES[name],
                  speak_during_execution: true,
                };
              }
              return tool;
            });

            if (touched === 0) {
              updates.push({ slot: Number(slotStr), agent_id: agentId, llm_id: llmId, status: "skipped", reason: "no_booking_tools" });
              continue;
            }

            await retellFetch(apiKey, "PATCH", `update-retell-llm/${llmId}`, { general_tools: patchedTools });
            try {
              await retellFetch(apiKey, "POST", `publish-agent/${agentId}`);
            } catch (pubErr) {
              console.warn(`[refresh-booking-tool-messages] publish failed for ${agentId}`, pubErr);
            }
            updates.push({ slot: Number(slotStr), agent_id: agentId, llm_id: llmId, status: "updated", tools_patched: touched });
          } catch (slotErr) {
            const message = slotErr instanceof Error ? slotErr.message : String(slotErr);
            updates.push({ slot: Number(slotStr), agent_id: agentId, status: "failed", error: message });
          }
        }

        result = { success: true, updated: updates.filter(u => u.status === "updated").length, total: updates.length, results: updates };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    if (error instanceof RetellProxyAuthError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: error.status,
      });
    }
    console.error("retell-proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
