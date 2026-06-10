import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import {
  BFD_VOICE_BOOKING_TOOLS_PLACEHOLDER,
  BFD_VOICE_BOOKING_TOOL_NAMES,
  BFD_SEND_SMS_TOOL,
  BFD_SCHEDULE_CALLBACK_TOOL,
} from "../_shared/bfdVoiceTools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RETELL_BASE = "https://api.retellai.com";
// Bug 20 — subscribe to both call_ended AND call_analyzed so
// engagement_executions.last_call_outcome populates on call_ended (used by
// runEngagement's poll loop) and the full analysis lands on call_analyzed
// (used for call_history + GHL note + custom-field PATCH + Bug 16
// Conversations push + Bug 28 booking confirm SMS).
const DEFAULT_RETELL_WEBHOOK_EVENTS = ["call_ended", "call_analyzed"];

// Map internal model names to Retell-supported model names
function mapToRetellModel(model: string): string {
  // Strip OpenRouter-style prefixes (e.g., "openai/gpt-5" -> "gpt-5")
  const stripped = model.includes('/') ? model.split('/').pop()! : model;
  
  // Forward-map deprecated / renamed ids onto the nearest CURRENT model so
  // setters stored with an old value keep working after the UI drops old models.
  const mapping: Record<string, string> = {
    // OpenAI legacy
    "gpt-4o": "gpt-4.1",
    "gpt-4o-mini": "gpt-4.1-mini",
    "gpt-4": "gpt-4.1",
    "gpt-4-turbo": "gpt-4.1",
    "deepseek-chat": "gpt-4.1-nano",
    // Anthropic legacy / alias naming
    "claude-sonnet-4": "claude-4.5-sonnet",
    "claude-4-sonnet": "claude-4.5-sonnet",
    "claude-4.0-sonnet": "claude-4.5-sonnet",
    "claude-sonnet-4.5": "claude-4.5-sonnet",
    "claude-3.7-sonnet": "claude-4.5-sonnet",
    "claude-haiku-3.5": "claude-4.5-haiku",
    // Google legacy
    "gemini-2.0-flash": "gemini-3.0-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
    "gemini-2.5-flash": "gemini-3.0-flash",
  };
  if (mapping[stripped]) return mapping[stripped];
  // Exact current Retell `model` enum (create-retell-llm, verified 2026-06-09).
  // Keep in sync with RETELL_MODELS in frontend/src/components/RetellModelSelector.tsx.
  const validModels = [
    "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
    "gpt-5", "gpt-5-mini", "gpt-5-nano",
    "gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5",
    "claude-4.6-sonnet", "claude-4.5-sonnet", "claude-4.5-haiku",
    "gemini-3.1-flash-lite", "gemini-3.0-flash", "gemini-2.5-flash-lite",
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
// Verify the JWT signature via GoTrue (was: unverified atob → forged tokens passed).
async function verifyUserId(authHeader: string | null): Promise<string> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new RetellProxyAuthError(401, "Unauthorized");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data?.user?.id) throw new RetellProxyAuthError(401, "Unauthorized");
  return data.user.id;
}

// Verify the calling user is allowed to act on `clientId`.
// Agency users: profile.agency_id must match clients.agency_id.
// Client users: profile.client_id must match clients.id.
// This is the same check check-client-subscription performs.
async function assertClientAccess(authHeader: string | null, clientId: string): Promise<void> {
  const userId = await verifyUserId(authHeader);
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

// Dual-write the new voice_setters UUID model alongside the legacy slot column,
// keyed on (client_id, legacy_slot). Non-blocking: a failure here never breaks
// the live legacy slot path. Backfill migration 20260531120000 stamps existing
// rows' legacy_slot so this upsert hits the right row.
// deno-lint-ignore no-explicit-any
async function dualWriteVoiceSetter(
  supabase: any,
  clientId: string,
  slotNumber: number,
  agentName: string,
  agentId: string,
  llmId: string | null,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("voice_setters")
      .select("id")
      .eq("client_id", clientId)
      .eq("legacy_slot", slotNumber)
      .maybeSingle();
    if (existing?.id) {
      await supabase.from("voice_setters")
        .update({ retell_agent_id: agentId, retell_llm_id: llmId, is_active: true })
        .eq("id", existing.id);
    } else {
      await supabase.from("voice_setters").insert({
        client_id: clientId,
        legacy_slot: slotNumber,
        name: agentName || `Voice Setter ${slotNumber}`,
        retell_agent_id: agentId,
        retell_llm_id: llmId,
        is_active: true,
      });
    }
  } catch (e) {
    console.warn("[sync-voice-setter] voice_setters dual-write failed (non-blocking):", e);
  }
}

function getAutoWebhookUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  return `${supabaseUrl}/functions/v1/retell-call-analysis-webhook`;
}

// Bug 1 — Retell's publish-agent response sometimes returns the DRAFT version
// number (or the just-pushed-draft) rather than the version that is actually
// `is_published=true`. Calling get-agent-versions and filtering on the
// published flag is the only authoritative source of the live version.
// Returns null if no version has is_published=true (very rare; agent never
// published) or if the API errors.
async function fetchLatestPublishedAgentVersion(
  apiKey: string,
  agentId: string,
): Promise<number | null> {
  try {
    const versions = await retellFetch(
      apiKey,
      "GET",
      `get-agent-versions/${agentId}`,
    ) as Array<{ version?: unknown; is_published?: unknown }>;
    if (!Array.isArray(versions)) {
      console.warn(`[fetchLatestPublishedAgentVersion] non-array response for ${agentId}; falling back to publishResp / get-agent`);
      return null;
    }
    let max: number | null = null;
    for (const v of versions) {
      if (v?.is_published === true && typeof v.version === "number") {
        if (max === null || v.version > max) max = v.version;
      }
    }
    if (max === null && versions.length > 0) {
      // Batch 3 code-review fix: surface the legitimate "never published"
      // case so operators see why phone-version repoint silently used the
      // fallback path. Without this, an unpublished agent looks identical
      // to an API error in logs.
      console.warn(`[fetchLatestPublishedAgentVersion] agent ${agentId} has ${versions.length} versions but none are is_published=true`);
    }
    return max;
  } catch (err) {
    console.warn(`[repoint-phones] GET get-agent-versions failed for ${agentId}:`, err);
    return null;
  }
}

// EE2: After publishing an agent, Retell phone-number version pins do NOT auto-update.
// Without this, every UI push silently fails to make tool changes live on real calls
// because the phone keeps routing to the previously-pinned (stale) agent version.
// Slot 1 → inbound_agents; slots 2 + 3 → outbound_agents (weighted-list format,
// which replaced the deprecated inbound_agent_version / outbound_agent_version fields).
// Slots 4-10 currently have no canonical phone routing and are skipped with a log.
// Bug 1 (2026-05-22) — precedence inverted: prefer authoritative
// get-agent-versions filtered to is_published=true over publishResp.version,
// which Retell sometimes returns as the draft number.
async function repointPhoneVersionsAfterPublish(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  apiKey: string,
  clientId: string,
  slotNumber: number,
  agentId: string,
  publishedVersionFromResp: unknown,
): Promise<void> {
  let publishedVersion: number | undefined;
  const latestPublished = await fetchLatestPublishedAgentVersion(apiKey, agentId);
  if (latestPublished !== null) {
    publishedVersion = latestPublished;
  } else if (typeof publishedVersionFromResp === "number") {
    publishedVersion = publishedVersionFromResp;
  } else {
    try {
      const agent = await retellFetch(apiKey, "GET", `get-agent/${agentId}`) as { version?: number };
      if (typeof agent?.version === "number") publishedVersion = agent.version;
    } catch (err) {
      console.warn(`[repoint-phones] GET get-agent fallback failed for ${agentId}:`, err);
    }
  }
  if (typeof publishedVersion !== "number") {
    console.warn(`[repoint-phones] No published version found for agent ${agentId} (slot ${slotNumber}); skipping phone repoint`);
    return;
  }

  type AgentWeight = { agent_id: string; agent_version?: number; weight: number };
  const entry: AgentWeight = { agent_id: agentId, agent_version: publishedVersion, weight: 1 };
  // We send only the slot's OWN direction; Retell preserves the omitted direction
  // on a partial PATCH (empirically confirmed — a live phone holds different
  // inbound/outbound versions, only possible if partial PATCH preserves the rest).
  const fields: { inbound_agents?: AgentWeight[]; outbound_agents?: AgentWeight[] } = {};
  const direction: "inbound" | "outbound" = slotNumber === 1 ? "inbound" : "outbound";
  if (slotNumber === 1) {
    fields.inbound_agents = [entry];
  } else if (slotNumber === 2 || slotNumber === 3) {
    fields.outbound_agents = [entry];
  } else {
    console.log(`[repoint-phones] Slot ${slotNumber} has no canonical phone routing; skipping phone repoint`);
    return;
  }

  const { data: phoneRow, error: phoneErr } = await supabase
    .from("clients")
    .select("retell_phone_1, retell_phone_2, retell_phone_3")
    .eq("id", clientId)
    .maybeSingle();
  if (phoneErr) {
    console.warn(`[repoint-phones] Failed to fetch phones for client ${clientId}: ${phoneErr.message}`);
    return;
  }
  const phones = [
    (phoneRow as Record<string, unknown> | null)?.retell_phone_1,
    (phoneRow as Record<string, unknown> | null)?.retell_phone_2,
    (phoneRow as Record<string, unknown> | null)?.retell_phone_3,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);

  if (phones.length === 0) {
    console.log(`[repoint-phones] Client ${clientId} has no configured phones; skipping repoint`);
    return;
  }

  for (const phone of phones) {
    try {
      // Only re-pin a phone that ALREADY routes this direction to the agent we
      // just published — i.e. bump its version, never change its agent_id. The
      // weighted-list entry necessarily carries agent_id, so blindly PATCHing
      // every phone would clobber any phone bound to a DIFFERENT agent in this
      // direction (a multi-phone client). The deprecated *_agent_version write
      // this replaced was version-only and didn't have that risk.
      const cur = await retellFetch(
        apiKey,
        "GET",
        `get-phone-number/${encodeURIComponent(phone)}`,
      ) as {
        inbound_agents?: AgentWeight[] | null;
        outbound_agents?: AgentWeight[] | null;
        inbound_agent_id?: string | null;
        outbound_agent_id?: string | null;
      };
      const list = direction === "inbound" ? cur.inbound_agents : cur.outbound_agents;
      const deprecated = direction === "inbound" ? cur.inbound_agent_id : cur.outbound_agent_id;
      // A present array (incl. empty) is authoritative; fall back to the
      // deprecated single-agent field only when the array is absent.
      const curAgent = Array.isArray(list) ? list[0]?.agent_id ?? null : deprecated ?? null;
      if (curAgent !== agentId) {
        console.log(`[repoint-phones] ${phone} ${direction} routes to ${curAgent ?? "none"}, not ${agentId}; skipping (slot ${slotNumber})`);
        continue;
      }
      await retellFetch(
        apiKey,
        "PATCH",
        `update-phone-number/${encodeURIComponent(phone)}`,
        fields,
      );
      console.log(`[repoint-phones] Repointed ${phone} ${direction} to ${JSON.stringify(fields)} (slot ${slotNumber}, agent ${agentId})`);
    } catch (phoneErr) {
      console.warn(`[repoint-phones] Failed to repoint phone ${phone}:`, phoneErr);
    }
  }
}

// EE1: column name for each direction key on the clients table.
const DIRECTION_TO_AGENT_COLUMN: Record<string, string> = {
  inbound: "retell_inbound_agent_id",
  outbound_initial: "retell_outbound_agent_id",
  outbound_followup: "retell_outbound_followup_agent_id",
};

// EE1: fan out a slot's published Retell agent_id to the selected direction
// columns on `clients`. Also:
//  - clears any direction column that USED to point at this agent but is no
//    longer selected (releasing that direction so another slot can claim it).
//  - rewrites OTHER voice_setter prompts.directions rows to drop any direction
//    we just claimed, keeping the data model consistent.
async function fanOutDirections(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  clientId: string,
  slotId: string,
  agentId: string,
  selected: string[],
): Promise<void> {
  const valid = selected.filter((d) => d in DIRECTION_TO_AGENT_COLUMN);

  // Read current direction columns to know what's pointing at this agent
  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("retell_inbound_agent_id, retell_outbound_agent_id, retell_outbound_followup_agent_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !clientRow) {
    console.warn(`[fan-out-directions] Failed to read client ${clientId} columns:`, clientErr?.message);
    return;
  }
  const current = clientRow as Record<string, string | null>;

  // Build the UPDATE payload
  const update: Record<string, string | null> = {};
  for (const [direction, column] of Object.entries(DIRECTION_TO_AGENT_COLUMN)) {
    if (valid.includes(direction)) {
      // Claim: point this direction column at this slot's agent
      if (current[column] !== agentId) update[column] = agentId;
    } else if (current[column] === agentId) {
      // Release: this direction was previously owned by this slot but is no
      // longer selected. Clear so another slot can claim, or so the direction
      // becomes inactive.
      update[column] = null;
    }
  }
  if (Object.keys(update).length > 0) {
    const { error: updErr } = await supabase
      .from("clients")
      .update(update)
      .eq("id", clientId);
    if (updErr) {
      console.warn(`[fan-out-directions] clients update failed:`, updErr.message);
    } else {
      console.log(`[fan-out-directions] clients updated for slot ${slotId}:`, JSON.stringify(update));
    }
  }

  // Rewrite OTHER voice_setter rows' directions to remove anything we just claimed.
  // Without this, the UI would still show stale ownership on those other slots.
  if (valid.length > 0) {
    const { data: otherRows, error: othersErr } = await supabase
      .from("prompts")
      .select("id, slot_id, directions")
      .eq("client_id", clientId)
      .eq("category", "voice_setter")
      .neq("slot_id", slotId);
    if (othersErr) {
      console.warn(`[fan-out-directions] read other prompts rows failed:`, othersErr.message);
      return;
    }
    for (const row of (otherRows ?? []) as Array<{ id: string; slot_id: string; directions: string[] | null }>) {
      const dirs = Array.isArray(row.directions) ? row.directions : [];
      const next = dirs.filter((d) => !valid.includes(d));
      if (next.length !== dirs.length) {
        const { error: writeErr } = await supabase
          .from("prompts")
          .update({ directions: next })
          .eq("id", row.id);
        if (writeErr) {
          console.warn(`[fan-out-directions] rewrite slot ${row.slot_id} failed:`, writeErr.message);
        } else {
          console.log(`[fan-out-directions] dropped claimed directions from ${row.slot_id}: ${JSON.stringify(dirs)} -> ${JSON.stringify(next)}`);
        }
      }
    }
  }
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
  directions: string[] = [],
): Promise<unknown> {
  const retellModel = mapToRetellModel(model);
  const supabase = getSupabaseAdmin();
  const agentColumn = SLOT_TO_AGENT_COLUMN[slotNumber];
  if (!agentColumn) throw new Error(`Invalid voice setter slot number: ${slotNumber}`);

  // Multi-tenant: fetch this client's intake_lead_secret + timezone. Secret feeds
  // booking-tool URL rewrites with per-tenant auth; timezone feeds the DYNAMIC_VARS
  // block so the agent gets the correct TZ label (instead of the legacy hardcoded
  // "(ET)" that confused Gary in the 2026-05-18 inbound booking call).
  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("id, intake_lead_secret, timezone")
    .eq("id", clientId)
    .single();
  if (clientErr || !clientRow) {
    throw new Error(`[sync-voice-setter] Failed to fetch client ${clientId}: ${clientErr?.message ?? "not found"}`);
  }
  const clientTimezone = (clientRow as { timezone: string | null }).timezone || "Australia/Sydney";
  let intakeSecret = (clientRow as { intake_lead_secret: string | null }).intake_lead_secret;
  if (!intakeSecret) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    intakeSecret = btoa(String.fromCharCode(...bytes));
    console.log(`[sync-voice-setter] Auto-minting intake_lead_secret for client ${clientId}`);
    const { error: mintErr } = await supabase
      .from("clients")
      .update({ intake_lead_secret: intakeSecret })
      .eq("id", clientId);
    if (mintErr) console.warn(`[sync-voice-setter] intake_lead_secret persist failed: ${mintErr.message}`);
  }

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
  // BFD voice-tool URL authority + default-tool injection.
  // BFD's own function-call tools (booking + send-sms + schedule-callback) must
  // always hit our voice-booking-tools edge fn with a per-tenant clientId + Bearer
  // auth, regardless of whatever URL is stored (legacy upstream n8n host, the
  // sentinel placeholder, or any stale host). We key on the tool NAME so an
  // unrecognised old URL can never slip through; genuine custom user tools and
  // end_call/transfer_call pass through untouched.
  //
  // This runs BEFORE URL validation on purpose: the placeholder is not a valid
  // URL, so a placeholder-seeded tool would otherwise be stripped as "invalid".
  const supabaseUrlForTools = Deno.env.get("SUPABASE_URL")!;
  const VOICE_BOOKING_TOOLS_URL = `${supabaseUrlForTools}/functions/v1/voice-booking-tools`;
  const LEGACY_N8N_HOST = "n8n-1prompt.99players.com";
  const forceBfdToolUrl = (t: Record<string, unknown>) => {
    const toolName = typeof t.name === "string" ? t.name.trim() : "";
    return {
      ...t,
      name: toolName,
      url: VOICE_BOOKING_TOOLS_URL,
      query_params: { tool: toolName, clientId },
      headers: intakeSecret ? { Authorization: `Bearer ${intakeSecret}` } : {},
    };
  };
  const substitutedTools = rawTools.map((t) => {
    if (t.type === "end_call" || t.type === "transfer_call") return t;
    const toolName = typeof t.name === "string" ? t.name.trim() : "";
    const url = typeof t.url === "string" ? t.url : "";
    // Authoritative by NAME: any known BFD tool always points at voice-booking-tools.
    if (BFD_VOICE_BOOKING_TOOL_NAMES.has(toolName)) return forceBfdToolUrl(t);
    // Defensive fallback: name-unknown tools still carrying our placeholder or the
    // legacy n8n host also get rewritten.
    if (url === BFD_VOICE_BOOKING_TOOLS_PLACEHOLDER || url.includes(LEGACY_N8N_HOST)) return forceBfdToolUrl(t);
    return t;
  });
  // Inject the default SMS + callback tools if this setter predates them, so every
  // voice setter ships with the full BFD tool set without any manual editing.
  // Always present (independent of the booking-enabled toggle).
  const presentNames = new Set(
    substitutedTools.map((t) => (typeof t.name === "string" ? t.name.trim() : "")),
  );
  if (!(presentNames.has("send-sms") || presentNames.has("send_sms"))) {
    substitutedTools.push(forceBfdToolUrl(BFD_SEND_SMS_TOOL as Record<string, unknown>));
  }
  if (!(presentNames.has("schedule-callback") || presentNames.has("schedule_callback"))) {
    substitutedTools.push(forceBfdToolUrl(BFD_SCHEDULE_CALLBACK_TOOL as Record<string, unknown>));
  }
  // Validate webhook tool URLs — strip tools with invalid URLs to prevent Retell
  // API errors. BFD tools were already forced to a valid URL above; this only
  // catches a genuine custom user tool with a malformed URL.
  const validatedTools = substitutedTools.filter((t) => {
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
  const forcedCount = generalTools.filter((t: any) => t.url === VOICE_BOOKING_TOOLS_URL).length;
  if (forcedCount > 0) {
    console.log(`[sync-voice-setter] Forced ${forcedCount} BFD tool URL(s) to voice-booking-tools for client ${clientId}`);
  }
  const knowledgeBaseIds = Array.isArray(llmSettings?.knowledge_base_ids)
    ? (llmSettings.knowledge_base_ids as unknown[]).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    : [];
  // Auto-append dynamic variables reference block so Retell can substitute them.
  // Per-client timezone label drives the "Current Date & Time" line so the agent
  // anchors to the caller's local TZ instead of the legacy hardcoded (ET) which
  // confused Gary in the 2026-05-18 inbound booking ("Monday May 18" when it was
  // tomorrow Tuesday in Sydney).
  //
  // CRITICAL on inbound BYO Twilio calls: dynamic variables arrive EMPTY (Retell
  // limitation). The instructional note below tells the agent how to behave when
  // {{current_time}} or other vars are blank — defer to the get-available-slots
  // tool to discover today's date, never guess the day-of-week.
  const DYNAMIC_VARS_BLOCK = `

── ── ── ── ── ── ── ── ── ── ── ── ── ──

## DYNAMIC VARIABLES (auto-injected, available at runtime)

You have access to the following dynamic variables about the lead you are calling. Use them naturally in conversation — do NOT ask the lead for information you already have.

- **Lead First Name**: {{first_name}}
- **Lead Last Name**: {{last_name}}
- **Lead Email**: {{email}}
- **Lead Phone**: {{phone}}
- **Lead Business Name**: {{business_name}}
- **Current Date & Time (${clientTimezone})**: {{current_time}}
- **Caller Timezone (IANA)**: ${clientTimezone}
- **Available Calendar Slots**: {{available_time_slots}}
- **Full Contact Details**: {{user_contact_details}}
- **Custom Instructions**: {{custom_instructions}}

### When dynamic variables are EMPTY (common on inbound calls)

On inbound calls to a BYO Twilio number, Retell does NOT inject dynamic variables — every {{...}} will substitute as empty/literal. If that happens:

1. **Never guess the day-of-week or date.** Do NOT say "tomorrow is Monday" unless you have verified the actual date via a tool call.
2. **To discover today's date**, call \`get-available-slots\` with no \`startDateTime\` — the response is anchored to today in ${clientTimezone}. The first returned slot's date IS today (or the next business hour).
3. **For caller identity** ({{first_name}}, {{email}}), use \`call.from_number\` (auto-injected into tool bodies as \`phone\`) to look up the contact via the contact-lookup tool BEFORE asking the caller their details.
4. **For timezone**, default to ${clientTimezone}. Say "${clientTimezone.split('/').pop()?.replace('_', ' ') || 'local'} time" when confirming bookings.`;

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

  // Fetch the current agent ID for this slot (plus all sibling slot anchor columns
  // for the EE1 safety guard immediately below).
  const allAgentColumns = Object.values(SLOT_TO_AGENT_COLUMN);
  const { data: clientData, error: agentLookupErr } = await supabase
    .from("clients")
    .select(allAgentColumns.join(", "))
    .eq("id", clientId)
    .single();
  if (agentLookupErr) throw new Error(`Failed to fetch client: ${agentLookupErr.message}`);

  const clientRowAgents = clientData as Record<string, string | null>;
  const existingAgentId = clientRowAgents[agentColumn];

  // Hardening (2026-06-09): a content-only Save with NO directions selected
  // (stale/empty toggles) would otherwise make fanOutDirections RELEASE every
  // direction column this agent occupies — unbinding a single master agent that
  // legitimately serves all directions, and tripping the EE1 guard below. When
  // the slot's existing agent already owns one or more direction columns and the
  // push selects none, interpret empty as "preserve current ownership" instead of
  // "release all". This only ever EXPANDS the claim to columns the SAME agent
  // already holds, so it can never claim a column held by a different agent and
  // cannot cause a cross-slot wipe. Explicit partial saves (a non-empty subset)
  // are untouched and still hit the guard.
  let effectiveDirections = directions;
  if (existingAgentId && directions.length === 0) {
    const ownedDirections = Object.entries(DIRECTION_TO_AGENT_COLUMN)
      .filter(([, col]) => clientRowAgents[col] === existingAgentId)
      .map(([dir]) => dir);
    if (ownedDirections.length > 0) {
      effectiveDirections = ownedDirections;
      console.log(
        `[sync-voice-setter] Empty directions on save; preserving current ownership for agent ${existingAgentId}: ${JSON.stringify(ownedDirections)}`,
      );
      // Best-effort self-heal: write the expanded set back to this slot's prompts
      // row so the UI toggles reflect reality on next load. Non-blocking.
      const { error: healErr } = await supabase
        .from("prompts")
        .update({ directions: effectiveDirections })
        .eq("client_id", clientId)
        .eq("slot_id", `Voice-Setter-${slotNumber}`)
        .eq("category", "voice_setter");
      if (healErr) {
        console.warn(`[sync-voice-setter] directions self-heal failed (non-blocking): ${healErr.message}`);
      }
    }
  }

  // EE1 safety (Layer 2, 2026-06-09): the agent PUSH + publish is always safe and
  // idempotent, so a Save NEVER aborts here anymore — the agent always updates and
  // publishes. What stays gated is the DIRECTION-COLUMN FAN-OUT. If `existingAgentId`
  // is referenced by MULTIPLE slot anchor columns and this push's directions do NOT
  // claim every one of them, running fanOutDirections would CLEAR the unclaimed shared
  // column(s) — wiping the agent another slot, or a legacy "Voice-Setter-N" cadence
  // that reads those columns, is serving (the 2026-05-18 incident). In that case we
  // SKIP the fan-out and return a non-fatal warning so the user can resolve ownership
  // via Fork / Delete, WITHOUT losing the agent push. (Layer 1 above already expands an
  // empty selection to the agent's currently-owned columns, so a routine content-only
  // Save is never flagged here.)
  let directionFanOutBlocked = false;
  let directionWarning: string | null = null;
  let directionConflictColumns: string[] = [];
  if (existingAgentId) {
    const columnsPointingAtThisAgent = allAgentColumns.filter(
      (col) => clientRowAgents[col] === existingAgentId,
    );
    if (columnsPointingAtThisAgent.length > 1) {
      const claimedColumns = new Set(
        effectiveDirections.map((d) => DIRECTION_TO_AGENT_COLUMN[d]).filter(Boolean),
      );
      const unclaimedSharedColumns = columnsPointingAtThisAgent.filter(
        (col) => !claimedColumns.has(col),
      );
      if (unclaimedSharedColumns.length > 0) {
        directionFanOutBlocked = true;
        directionConflictColumns = columnsPointingAtThisAgent;
        directionWarning =
          `Agent updated and published, but direction ownership was left unchanged: agent ${existingAgentId} ` +
          `is shared across column(s) ${columnsPointingAtThisAgent.join(", ")} and this Save only claims ` +
          `direction(s) ${directions.length > 0 ? directions.join(", ") : "(none selected)"}. ` +
          `Applying it would have cleared the shared column(s) [${unclaimedSharedColumns.join(", ")}], which could ` +
          `break another slot or a legacy "Voice-Setter-N" cadence that reads those columns. To change direction ` +
          `ownership, Fork this direction onto its own agent, or delete + recreate this slot on a dedicated agent.`;
        console.warn(`[sync-voice-setter] DIRECTION FAN-OUT SKIPPED (non-fatal): ${directionWarning}`);
      }
    }
  }

  // Capture any non-blocking publish failure (was silently swallowed before
  // the 2026-05-18 incident — Brendan's UI Save Setter looked like a hard error
  // because the toast said "edge fn returned non-2xx" with no detail. Now we
  // surface this in the response so the toast can warn explicitly.)
  let publishWarning: string | null = null;

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
        const publishResp = await retellFetch(apiKey, "POST", `publish-agent/${existingAgentId}`) as { version?: number };
        console.log(`[sync-voice-setter] Auto-published agent ${existingAgentId} (v${publishResp?.version ?? "?"})`);
        await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, existingAgentId, publishResp?.version);
      } catch (pubErr) {
        const message = pubErr instanceof Error ? pubErr.message : String(pubErr);
        console.warn(`[sync-voice-setter] Auto-publish failed (non-blocking):`, message);
        publishWarning = message;
      }
      // EE1: fan out direction selection across clients columns + sibling slots
      // (skipped when it would clear a shared column — Layer 2 guard above).
      if (!directionFanOutBlocked) {
        await fanOutDirections(supabase, clientId, `Voice-Setter-${slotNumber}`, existingAgentId, effectiveDirections);
      }
      await dualWriteVoiceSetter(supabase, clientId, slotNumber, agentName, existingAgentId, llmId);
      return { success: true, action: "updated_and_published", agent_id: existingAgentId, llm_id: llmId, llm: updatedLlm, publish_warning: publishWarning, direction_warning: directionWarning, conflicting_agent_id: directionFanOutBlocked ? existingAgentId : null, shared_columns: directionFanOutBlocked ? directionConflictColumns : null };
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
        const publishResp = await retellFetch(apiKey, "POST", `publish-agent/${existingAgentId}`) as { version?: number };
        console.log(`[sync-voice-setter] Auto-published agent ${existingAgentId} (v${publishResp?.version ?? "?"})`);
        await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, existingAgentId, publishResp?.version);
      } catch (pubErr) {
        const message = pubErr instanceof Error ? pubErr.message : String(pubErr);
        console.warn(`[sync-voice-setter] Auto-publish failed (non-blocking):`, message);
        publishWarning = message;
      }
      // EE1: fan out direction selection across clients columns + sibling slots
      // (skipped when it would clear a shared column — Layer 2 guard above).
      if (!directionFanOutBlocked) {
        await fanOutDirections(supabase, clientId, `Voice-Setter-${slotNumber}`, existingAgentId, effectiveDirections);
      }
      await dualWriteVoiceSetter(supabase, clientId, slotNumber, agentName, existingAgentId, newLlm.llm_id);
      return { success: true, action: "updated_with_new_llm_and_published", agent_id: existingAgentId, llm_id: newLlm.llm_id, publish_warning: publishWarning, direction_warning: directionWarning, conflicting_agent_id: directionFanOutBlocked ? existingAgentId : null, shared_columns: directionFanOutBlocked ? directionConflictColumns : null };
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
      const publishResp = await retellFetch(apiKey, "POST", `publish-agent/${newAgent.agent_id}`) as { version?: number };
      console.log(`[sync-voice-setter] Auto-published new agent ${newAgent.agent_id} (v${publishResp?.version ?? "?"})`);
      await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, newAgent.agent_id, publishResp?.version);
    } catch (pubErr) {
      console.warn(`[sync-voice-setter] Auto-publish of new agent failed (non-blocking):`, pubErr);
    }
    // EE1: fan out direction selection across clients columns + sibling slots.
    await fanOutDirections(supabase, clientId, `Voice-Setter-${slotNumber}`, newAgent.agent_id, effectiveDirections);
    await dualWriteVoiceSetter(supabase, clientId, slotNumber, agentName, newAgent.agent_id, newLlm.llm_id);
    return { success: true, action: "created_and_published", agent_id: newAgent.agent_id, llm_id: newLlm.llm_id, publish_warning: publishWarning };
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

// Versioned Retell list endpoints (v2/v3) return { items, pagination_key, has_more }
// instead of a top-level array. Unwrap so the proxy's external contract (a plain
// array) is unchanged and no UI consumer needs to change.
function unwrapList(raw: unknown): unknown {
  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: unknown }).items;
  }
  return raw;
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
        result = unwrapList(await retellFetch(apiKey, "GET", "v2/list-retell-llms"));
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
        result = unwrapList(await retellFetch(apiKey, "GET", "v2/list-phone-numbers"));
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
        result = unwrapList(
          await retellFetch(apiKey, "POST", "v3/list-calls", { sort_order: "descending", limit: 50 })
        );
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

      // ===== SET AGENT NAME =====
      // Lightweight rename: PATCH agent_name on the slot's Retell agent + publish
      // + repoint phone version. Used by SetterDisplayNamesCard so changing a
      // setter's display name in the UI propagates to Retell without a full
      // sync-voice-setter roundtrip. NEVER touches the LLM prompt or voice settings.
      case "set-agent-name": {
        const slotNumber = params.slotNumber as number;
        const agentName = (params.agentName as string)?.trim() ?? "";
        if (!slotNumber) throw new Error("slotNumber is required");
        if (!agentName) throw new Error("agentName is required");
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
        if (!existingAgentId) {
          // Slot hasn't been pushed to Retell yet — no-op; UI saves the display
          // name to clients.setter_display_names regardless. Next full sync-voice-setter
          // will create the agent with this name.
          result = { success: true, action: "skipped_no_agent", reason: "Slot has no Retell agent yet — name saved locally; will apply on first Push to Retell." };
          break;
        }

        await retellFetch(apiKey, "PATCH", `update-agent/${existingAgentId}`, { agent_name: agentName });
        let publishedVersion: number | undefined;
        try {
          const publishResp = await retellFetch(apiKey, "POST", `publish-agent/${existingAgentId}`) as { version?: number };
          publishedVersion = publishResp?.version;
          await repointPhoneVersionsAfterPublish(supabaseAdmin, apiKey, clientId, slotNumber, existingAgentId, publishedVersion);
        } catch (pubErr) {
          // Don't swallow silently — surface to caller so toast can warn.
          const message = pubErr instanceof Error ? pubErr.message : String(pubErr);
          console.warn(`[set-agent-name] publish failed for ${existingAgentId}:`, message);
          result = { success: true, action: "patched_but_publish_failed", agent_id: existingAgentId, publish_error: message };
          break;
        }
        result = { success: true, action: "renamed_and_published", agent_id: existingAgentId, version: publishedVersion ?? null };
        break;
      }

      // ===== SET VOICEMAIL =====
      // Client-wide voicemail config. Reads clients.voicemail_config (jsonb shape:
      // {mode: "hangup" | "static" | "prompt", text: string | null,
      //  detect_enabled?: boolean, detect_timeout_ms?: number}) and PATCHes
      // every unique Retell agent_id across the 10 slot columns. No publish/repoint —
      // voicemail_option is a draft-level setting that takes effect on the next
      // call without requiring a new published version.
      //
      // Detection: enable_voicemail_detection + voicemail_detection_timeout_ms
      // control whether the agent attempts to detect voicemail in the first
      // place. Defaults to enabled with a 30s timeout. Added 2026-05-20 in
      // phase-night-n8-voicemail-detection.
      case "set-voicemail": {
        const supabaseAdmin = getSupabaseAdmin();
        const allAgentCols = Object.values(SLOT_TO_AGENT_COLUMN);
        const { data: clientRow, error: clientFetchErr } = await supabaseAdmin
          .from("clients")
          .select(`voicemail_config, ${allAgentCols.join(", ")}`)
          .eq("id", clientId)
          .single();
        if (clientFetchErr) throw new Error(`Failed to fetch client: ${clientFetchErr.message}`);

        const cfg = (clientRow as Record<string, unknown>)?.voicemail_config as {
          mode?: string;
          text?: string | null;
          detect_enabled?: boolean;
          detect_timeout_ms?: number;
        } | null;
        if (!cfg || !cfg.mode) {
          result = { success: false, action: "skipped_no_config", reason: "clients.voicemail_config is null — set it first." };
          break;
        }

        let voicemailOption: Record<string, unknown>;
        if (cfg.mode === "hangup") {
          voicemailOption = { action: { type: "hangup" } };
        } else if (cfg.mode === "static") {
          if (!cfg.text || !cfg.text.trim()) {
            result = { success: false, action: "skipped_missing_text", reason: "Static voicemail requires `text` to be non-empty." };
            break;
          }
          voicemailOption = { action: { type: "static", text: cfg.text } };
        } else if (cfg.mode === "prompt") {
          if (!cfg.text || !cfg.text.trim()) {
            result = { success: false, action: "skipped_missing_text", reason: "Prompt voicemail requires `text` to be non-empty." };
            break;
          }
          voicemailOption = { action: { type: "prompt", text: cfg.text } };
        } else {
          result = { success: false, action: "invalid_mode", reason: `Unknown voicemail mode: ${cfg.mode}. Use hangup, static, or prompt.` };
          break;
        }

        const detectEnabled = cfg.detect_enabled !== false;
        const detectTimeoutMs =
          typeof cfg.detect_timeout_ms === "number" && cfg.detect_timeout_ms > 0
            ? cfg.detect_timeout_ms
            : 30000;

        const agentIds = new Set<string>();
        for (const col of allAgentCols) {
          const v = (clientRow as Record<string, string | null>)?.[col];
          if (v) agentIds.add(v);
        }
        if (agentIds.size === 0) {
          result = { success: true, action: "skipped_no_agents", reason: "No Retell agents are provisioned for this client yet." };
          break;
        }

        const patchBody = {
          enable_voicemail_detection: detectEnabled,
          voicemail_detection_timeout_ms: detectTimeoutMs,
          voicemail_option: voicemailOption,
        };

        const patches: Array<{ agent_id: string; ok: boolean; error?: string }> = [];
        for (const agentId of agentIds) {
          try {
            await retellFetch(apiKey, "PATCH", `update-agent/${agentId}`, patchBody);
            patches.push({ agent_id: agentId, ok: true });
          } catch (e) {
            patches.push({ agent_id: agentId, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        const okCount = patches.filter((p) => p.ok).length;
        result = {
          success: okCount === patches.length,
          action: "voicemail_set",
          mode: cfg.mode,
          detect_enabled: detectEnabled,
          detect_timeout_ms: detectTimeoutMs,
          patched: okCount,
          total: patches.length,
          results: patches,
        };
        break;
      }

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
        // EE1: directions multi-select. Whitelist + dedupe before passing in.
        const ALLOWED_DIRECTIONS = ["inbound", "outbound_initial", "outbound_followup"];
        const rawDirections = Array.isArray(params.directions) ? params.directions : [];
        const directions = Array.from(new Set(
          rawDirections.filter((d: unknown): d is string => typeof d === "string" && ALLOWED_DIRECTIONS.includes(d))
        ));
        console.log(`[sync-voice-setter] Starting sync for slot ${slotNumber}, model: ${model}, agentName: ${agentName}`);
        console.log(`[sync-voice-setter] beginMessage: "${beginMessage}"`);
        console.log(`[sync-voice-setter] directions:`, JSON.stringify(directions));
        console.log(`[sync-voice-setter] Voice settings keys:`, voiceSettings ? Object.keys(voiceSettings) : 'none');
        console.log(`[sync-voice-setter] LLM settings:`, JSON.stringify({
          model_high_priority: llmSettings?.model_high_priority,
          tools_count: Array.isArray(llmSettings?.general_tools) ? llmSettings.general_tools.length : 0,
          kb_ids: llmSettings?.knowledge_base_ids,
          start_speaker: llmSettings?.start_speaker,
        }));
        result = await syncVoiceSetter(apiKey, clientId, slotNumber, generalPrompt, beginMessage, model, agentName, voiceSettings, llmSettings, directions);
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

      // ===== FORK SLOT DIRECTION =====
      // Per-direction agent fork. When a client's `retell_<direction>_agent_id`
      // points at an agent that is ALSO referenced by other slot columns
      // (the EE1 "shared agent" scenario), this action clones the shared agent
      // into a NEW Retell agent + LLM dedicated to a single direction, and
      // repoints `clients.retell_<direction>_agent_id` to the new agent. The
      // other 2 direction columns are left untouched — they keep pointing at
      // the original shared agent.
      //
      // Brendan reaches this action via the Fork button on the EE1 safety-guard
      // toast in PromptManagement.tsx (added 2026-05-20 in the same tag).
      //
      // Note re: [[feedback_no_internal_prompt_edits]] — this action CLONES the
      // existing prompts row + Retell LLM/Agent without mutating their content.
      // The client owns both the source and the new copies; we are not editing
      // any LLM-facing prompt content. The new agent's general_prompt is byte-
      // identical to the source's at fork time.
      case "fork-slot-direction": {
        const direction = (params.direction as string) || "";
        if (!DIRECTION_TO_AGENT_COLUMN[direction]) {
          throw new Error(
            `Invalid direction: ${direction}. Expected one of inbound, outbound_initial, outbound_followup.`,
          );
        }
        const directionColumn = DIRECTION_TO_AGENT_COLUMN[direction];
        // Direction → canonical slot number for phone-version repoint.
        const DIRECTION_TO_SLOT: Record<string, number> = {
          inbound: 1,
          outbound_initial: 2,
          outbound_followup: 3,
        };
        const targetSlotNumber = DIRECTION_TO_SLOT[direction];
        const targetSlotId = `Voice-Setter-${targetSlotNumber}`;
        const DIRECTION_LABEL: Record<string, string> = {
          inbound: "inbound",
          outbound_initial: "outbound initial",
          outbound_followup: "outbound follow-up",
        };

        const supabaseAdmin = getSupabaseAdmin();
        const allAgentCols = Object.values(SLOT_TO_AGENT_COLUMN);

        // 1. Read the source agent_id + sibling columns (to verify sharing).
        const { data: clientRow, error: clientFetchErr } = await supabaseAdmin
          .from("clients")
          .select(allAgentCols.join(", "))
          .eq("id", clientId)
          .single();
        if (clientFetchErr) throw new Error(`Failed to fetch client: ${clientFetchErr.message}`);
        const agentMap = clientRow as Record<string, string | null>;
        const sourceAgentId = agentMap[directionColumn];
        if (!sourceAgentId) {
          const err = new Error(
            `Cannot fork ${direction}: clients.${directionColumn} is null. Provision the slot first via Save Setter.`,
          );
          (err as Error & { status?: number; code?: string }).status = 409;
          (err as Error & { code?: string }).code = "no_agent_for_direction";
          throw err;
        }
        const columnsPointingAtSource = allAgentCols.filter(
          (col) => agentMap[col] === sourceAgentId,
        );
        if (columnsPointingAtSource.length < 2) {
          const err = new Error(
            `Cannot fork ${direction}: agent ${sourceAgentId} is only referenced by clients.${directionColumn}. ` +
            `It is already dedicated to this direction — no fork needed.`,
          );
          (err as Error & { status?: number; code?: string }).status = 400;
          (err as Error & { code?: string }).code = "not_shared";
          throw err;
        }

        // 2. GET source agent + source LLM from Retell.
        const sourceAgent = await retellFetch(apiKey, "GET", `get-agent/${sourceAgentId}`) as any;
        const sourceLlmId = sourceAgent?.response_engine?.llm_id;
        if (!sourceLlmId) {
          throw new Error(
            `Source agent ${sourceAgentId} has no response_engine.llm_id; cannot clone without source LLM.`,
          );
        }
        const sourceLlm = await retellFetch(apiKey, "GET", `get-retell-llm/${sourceLlmId}`) as any;

        // 3. Create a new Retell LLM cloning the source's settings byte-for-byte.
        //    No prompt editing — pure clone (per the no-internal-prompt-edits rule).
        const newLlmPayload: Record<string, unknown> = {
          model: sourceLlm.model,
          general_prompt: sourceLlm.general_prompt,
          begin_message: sourceLlm.begin_message ?? null,
          general_tools: sourceLlm.general_tools ?? [],
          model_high_priority: sourceLlm.model_high_priority ?? true,
          start_speaker: sourceLlm.start_speaker ?? "agent",
          knowledge_base_ids: sourceLlm.knowledge_base_ids ?? [],
        };
        const newLlm = await retellFetch(apiKey, "POST", "create-retell-llm", newLlmPayload) as any;
        console.log(`[fork-slot-direction] Created new LLM ${newLlm.llm_id} (cloned from ${sourceLlmId})`);

        // 4. Create a new Retell agent cloning the source's voice/STT/PII settings,
        //    pointing at the new LLM. Override agent_name so Brendan can tell the
        //    forked agent apart from the source in the Retell dashboard.
        const sourceName = (sourceAgent.agent_name as string | undefined) ?? `Voice-Setter-${targetSlotNumber}`;
        const newAgentName = `${sourceName} (${DIRECTION_LABEL[direction]})`;

        // Whitelist the agent-level fields that are safe to clone. Avoid
        // copying read-only fields like agent_id, version, last_modification_timestamp.
        const AGENT_CLONE_FIELDS = [
          "voice_id", "voice_model", "voice_temperature", "voice_speed", "volume",
          "language", "ambient_sound", "ambient_sound_volume",
          "responsiveness", "interruption_sensitivity",
          "end_call_after_silence_ms", "max_call_duration_ms",
          "boosted_keywords",
          "enable_backchannel", "backchannel_frequency",
          "begin_message_delay_ms", "webhook_timeout_ms",
          "data_storage_setting", "normalize_for_speech",
          "reminder_trigger_ms", "reminder_max_count",
          "opt_out_sensitive_data_storage",
          "post_call_analysis_model", "post_call_analysis_data",
          "analysis_successful_prompt", "analysis_summary_prompt", "analysis_user_sentiment_prompt",
          "voicemail_option", "enable_voicemail_detection", "voicemail_detection_timeout_ms",
          "vocab_specialization", "user_dtmf_options",
          "stt_mode", "custom_stt_config", "pii_config",
        ];
        const clonedAgentSettings: Record<string, unknown> = {};
        for (const f of AGENT_CLONE_FIELDS) {
          if (sourceAgent[f] !== undefined && sourceAgent[f] !== null) {
            clonedAgentSettings[f] = sourceAgent[f];
          }
        }

        const createAgentPayload: Record<string, unknown> = {
          agent_name: newAgentName,
          channel: "voice",
          response_engine: {
            type: "retell-llm",
            llm_id: newLlm.llm_id,
            ...(newLlm?.version ? { version: newLlm.version } : {}),
          },
          ...clonedAgentSettings,
          webhook_url: getAutoWebhookUrl(),
          webhook_events: DEFAULT_RETELL_WEBHOOK_EVENTS,
        };
        const newAgent = await retellFetch(apiKey, "POST", "create-agent", createAgentPayload) as any;
        const newAgentId = newAgent.agent_id as string;
        console.log(`[fork-slot-direction] Created new agent ${newAgentId} cloned from ${sourceAgentId}`);

        // 5. Auto-publish the new agent. Non-blocking — surface as publish_warning.
        let publishWarning: string | null = null;
        let publishedVersion: number | undefined;
        try {
          const publishResp = await retellFetch(apiKey, "POST", `publish-agent/${newAgentId}`) as { version?: number };
          publishedVersion = publishResp?.version;
          console.log(`[fork-slot-direction] Auto-published new agent ${newAgentId} (v${publishedVersion ?? "?"})`);
        } catch (pubErr) {
          publishWarning = pubErr instanceof Error ? pubErr.message : String(pubErr);
          console.warn(`[fork-slot-direction] Auto-publish failed (non-blocking):`, publishWarning);
        }

        // 6. Repoint the appropriate phone version pin so live calls route to the new agent.
        try {
          await repointPhoneVersionsAfterPublish(
            supabaseAdmin,
            apiKey,
            clientId,
            targetSlotNumber,
            newAgentId,
            publishedVersion,
          );
        } catch (repointErr) {
          console.warn(`[fork-slot-direction] Phone repoint failed (non-blocking):`, repointErr);
        }

        // 7. Repoint the clients column to the new agent. The other 2 direction
        //    columns stay pointing at the original shared agent.
        const { error: clientsUpdateErr } = await supabaseAdmin
          .from("clients")
          .update({ [directionColumn]: newAgentId })
          .eq("id", clientId);
        if (clientsUpdateErr) {
          throw new Error(`Forked agent ${newAgentId} successfully but failed to repoint clients.${directionColumn}: ${clientsUpdateErr.message}`);
        }
        console.log(`[fork-slot-direction] Repointed clients.${directionColumn} from ${sourceAgentId} to ${newAgentId}`);

        // 8. Prompts table maintenance.
        //    Find the prompts row that currently claims this direction.
        //    Two cases:
        //    (a) Source row's slot_id matches the target slot → narrow its
        //        directions array to just [direction] (it's the canonical
        //        editor for the forked agent now).
        //    (b) Source row lives on a different slot → clone its content into
        //        a new row at the target slot with directions=[direction], and
        //        remove `direction` from the source row's directions array.
        const { data: sourcePromptsRows, error: sourcePromptsErr } = await supabaseAdmin
          .from("prompts")
          .select("id, slot_id, directions, content, name, model, temperature")
          .eq("client_id", clientId)
          .eq("category", "voice_setter")
          .contains("directions", [direction]);
        if (sourcePromptsErr) {
          console.warn(`[fork-slot-direction] Prompts row lookup failed (non-fatal):`, sourcePromptsErr.message);
        }
        const sourceRow = (sourcePromptsRows ?? [])[0] as
          | { id: string; slot_id: string; directions: string[] | null; content: string | null; name: string | null; model: string | null; temperature: number | null }
          | undefined;

        if (sourceRow) {
          if (sourceRow.slot_id === targetSlotId) {
            // Case (a) — narrow directions on the existing row at the target slot.
            const { error: narrowErr } = await supabaseAdmin
              .from("prompts")
              .update({ directions: [direction] })
              .eq("id", sourceRow.id);
            if (narrowErr) {
              console.warn(`[fork-slot-direction] Narrow source row failed:`, narrowErr.message);
            } else {
              console.log(`[fork-slot-direction] Narrowed prompts row ${sourceRow.id} directions to [${direction}]`);
            }
          } else {
            // Case (b) — clone source row to target slot, remove direction from source.
            // Check if target slot already has a row (shouldn't, but be safe).
            const { data: targetRows } = await supabaseAdmin
              .from("prompts")
              .select("id")
              .eq("client_id", clientId)
              .eq("category", "voice_setter")
              .eq("slot_id", targetSlotId);
            if (!targetRows || targetRows.length === 0) {
              const { error: cloneErr } = await supabaseAdmin
                .from("prompts")
                .insert({
                  client_id: clientId,
                  category: "voice_setter",
                  slot_id: targetSlotId,
                  directions: [direction],
                  content: sourceRow.content,
                  name: sourceRow.name ?? newAgentName,
                  model: sourceRow.model,
                  temperature: sourceRow.temperature,
                });
              if (cloneErr) {
                console.warn(`[fork-slot-direction] Clone prompts row failed:`, cloneErr.message);
              } else {
                console.log(`[fork-slot-direction] Cloned prompts row to ${targetSlotId} directions=[${direction}]`);
              }
            } else {
              console.log(`[fork-slot-direction] Target slot ${targetSlotId} already has prompts row; skipping clone`);
            }
            // Remove direction from source row.
            const newSourceDirs = (sourceRow.directions ?? []).filter((d) => d !== direction);
            const { error: stripErr } = await supabaseAdmin
              .from("prompts")
              .update({ directions: newSourceDirs })
              .eq("id", sourceRow.id);
            if (stripErr) {
              console.warn(`[fork-slot-direction] Strip direction from source row failed:`, stripErr.message);
            } else {
              console.log(`[fork-slot-direction] Stripped ${direction} from source prompts row ${sourceRow.id}; new directions=${JSON.stringify(newSourceDirs)}`);
            }
          }
        } else {
          console.log(`[fork-slot-direction] No prompts row currently claims ${direction}; UI will show empty editor for the new agent until Save Setter is run.`);
        }

        result = {
          success: true,
          action: "forked",
          source_agent_id: sourceAgentId,
          source_llm_id: sourceLlmId,
          new_agent_id: newAgentId,
          new_llm_id: newLlm.llm_id,
          new_agent_name: newAgentName,
          direction,
          column_updated: directionColumn,
          published_version: publishedVersion ?? null,
          publish_warning: publishWarning,
        };
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
    // Honor structured-error fields (status, code, etc.) so the EE1 safety guard
    // and any future guarded throws surface a meaningful HTTP code + JSON body
    // to the frontend instead of being flattened to a generic 400.
    const errAny = error as { status?: number; code?: string; sharedColumns?: string[]; conflictingAgentId?: string };
    const status = typeof errAny?.status === "number" ? errAny.status : 400;
    const body: Record<string, unknown> = { error: message };
    if (errAny?.code) body.code = errAny.code;
    if (errAny?.sharedColumns) body.shared_columns = errAny.sharedColumns;
    if (errAny?.conflictingAgentId) body.conflicting_agent_id = errAny.conflictingAgentId;
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });
  }
});
