import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import {
  BFD_VOICE_BOOKING_TOOLS_PLACEHOLDER,
  BFD_VOICE_BOOKING_TOOL_NAMES,
  BFD_SEND_SMS_TOOL,
  BFD_SCHEDULE_CALLBACK_TOOL,
} from "../_shared/bfdVoiceTools.ts";
import { buildVoiceSetterDeactivatePayload } from "../_shared/voice-setter.ts";

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

// Map Voice-Setter slot numbers to client column names for agent IDs.
// Slots 2 (retell_outbound_agent_id) + 3 (retell_outbound_followup_agent_id)
// were retired 2026-06-17 (P3a): outbound routing is now UUID/voice_setters
// driven, so those direction columns are no longer load-bearing. Slot 1
// (inbound) and slots 4-10 (campaign/persona setters) remain.
const SLOT_TO_AGENT_COLUMN: Record<number, string> = {
  1: "retell_inbound_agent_id",
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

// Retell renamed the publish endpoint (2026-06): the old `POST publish-agent/{id}`
// (no body) is gone. The live API is `POST publish-agent-version/{id}` with a
// REQUIRED `{ version }` body — the draft version to publish. We source that draft
// version from the caller (the update-agent PATCH response) when available, else a
// GET get-agent right before publishing returns the current (draft) version.
// Returns the publish response (used only as a fallback version source by
// repointPhoneVersionsAfterPublish, which re-derives the authoritative published
// version via get-agent-versions).
async function publishAgentVersion(
  apiKey: string,
  agentId: string,
  knownVersion?: number,
  versionDescription?: string,
): Promise<{ version?: number }> {
  let version = knownVersion;
  if (typeof version !== "number") {
    const agent = await retellFetch(apiKey, "GET", `get-agent/${agentId}`) as { version?: number };
    version = typeof agent?.version === "number" ? agent.version : undefined;
  }
  if (typeof version !== "number") {
    throw new Error(`publishAgentVersion: could not resolve a draft version for agent ${agentId}`);
  }
  const body: Record<string, unknown> = { version };
  if (versionDescription) body.version_description = versionDescription;
  return await retellFetch(apiKey, "POST", `publish-agent-version/${agentId}`, body) as { version?: number };
}

// Retell makes PUBLISHED agent / retell-llm / conversation-flow versions
// IMMUTABLE: a PATCH on a published resource 400s ("Cannot update published LLM")
// or 422s ("Cannot update published agent other than version title"). The 2026-06-16
// P0 publish fix made auto-publish actually work, so every setter's latest version
// is now published with no trailing draft, and the in-place edit path broke for all
// 5 BFD setters. The fix: create a DRAFT from the published base version, edit the
// draft, then publish it. This helper normalizes "give me an editable draft":
//   - Case A: the latest version is already a draft (is_published=false) -> reuse it
//     in place (no version sprawl; a prior push that drafted then failed before
//     publish self-heals on the next push).
//   - Case B: the latest version is published -> POST create-agent-version with
//     base_version=latest to mint the next draft, then return it.
// Verified live 2026-06-16 on a throwaway agent: create-agent-version versions the
// LLM IN PLACE (same llm_id, response_engine.version bumped, NOT forked), and both
// update-agent and update-retell-llm with no version param then target the draft.
// We still return the draft's llm_id / flow_id so a future fork behavior would be
// handled transparently by callers. See [[project_retell_published_version_immutable_bug]].
interface EditableAgentDraft {
  draftVersion: number;
  llmId: string | null;
  flowId: string | null;
  engineType: string | null;
  createdNewVersion: boolean;
}

async function ensureEditableAgentDraft(
  apiKey: string,
  agentId: string,
): Promise<EditableAgentDraft> {
  type VersionEntry = {
    version?: number;
    is_published?: boolean;
    response_engine?: { type?: string; llm_id?: string; conversation_flow_id?: string };
  };
  const pickEngine = (e?: VersionEntry["response_engine"]) => ({
    engineType: e?.type ?? null,
    llmId: e?.llm_id ?? null,
    flowId: e?.conversation_flow_id ?? null,
  });
  const maxEntry = (versions: VersionEntry[]): VersionEntry => {
    let best = versions[0];
    let bestV = typeof best?.version === "number" ? best.version : -1;
    for (const v of versions) {
      if (typeof v.version === "number" && v.version > bestV) {
        best = v;
        bestV = v.version;
      }
    }
    return best;
  };

  const versions = await retellFetch(apiKey, "GET", `get-agent-versions/${agentId}`) as VersionEntry[];
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(`ensureEditableAgentDraft: no versions returned for agent ${agentId}`);
  }
  const latest = maxEntry(versions);

  // Case A: latest is already a draft -> edit it in place.
  if (latest.is_published !== true) {
    console.log(`[ensureEditableAgentDraft] agent ${agentId} v${latest.version} is already a draft; reusing`);
    return { draftVersion: latest.version as number, ...pickEngine(latest.response_engine), createdNewVersion: false };
  }

  // Case B: latest is published -> mint a draft from it.
  const created = await retellFetch(apiKey, "POST", `create-agent-version/${agentId}`, {
    base_version: latest.version,
  }) as VersionEntry;
  let draftVersion = typeof created?.version === "number" ? created.version : undefined;
  let engine = pickEngine(created?.response_engine);
  // Fallback: if the create response omits version/engine, re-read and take the new max.
  if (typeof draftVersion !== "number" || engine.engineType === null) {
    const after = await retellFetch(apiKey, "GET", `get-agent-versions/${agentId}`) as VersionEntry[];
    const newLatest = maxEntry(after);
    draftVersion = newLatest.version;
    engine = pickEngine(newLatest.response_engine);
  }
  if (typeof draftVersion !== "number") {
    throw new Error(`ensureEditableAgentDraft: could not resolve a draft version for agent ${agentId}`);
  }
  console.log(`[ensureEditableAgentDraft] agent ${agentId}: minted draft v${draftVersion} from base v${latest.version} (llm=${engine.llmId}, flow=${engine.flowId})`);
  return { draftVersion, ...engine, createdNewVersion: true };
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
  // Capture into a const so the value is provably `number` inside the closures
  // below regardless of TS narrowing-into-closure behavior.
  const ver: number = publishedVersion;

  type AgentWeight = { agent_id: string; agent_version?: number; weight: number };

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

  // Bump EVERY direction a phone already routes to `agentId` up to the freshly
  // published version. We no longer derive a single direction from the slot
  // number: a single agent commonly serves BOTH inbound and outbound on the same
  // phone (e.g. BFD's master agent), and the old slot-derived logic only ever
  // bumped one direction, leaving the other pinned to a stale version — the
  // 2026-06-12 incident where a push moved inbound to v12 but left outbound on
  // v10. The per-direction `curAgent === agentId` check preserves the EE1 /
  // multi-phone safety: we only ever bump a phone already bound to this agent in
  // that direction, never reassign a phone bound to a DIFFERENT agent, and a
  // brand-new (just-forked) agent on no phone bumps nothing.
  for (const phone of phones) {
    try {
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

      const fields: { inbound_agents?: AgentWeight[]; outbound_agents?: AgentWeight[] } = {};
      const bumped: string[] = [];

      for (const direction of ["inbound", "outbound"] as const) {
        const column = direction === "inbound" ? "inbound_agents" : "outbound_agents";
        const list = direction === "inbound" ? cur.inbound_agents : cur.outbound_agents;
        const deprecated = direction === "inbound" ? cur.inbound_agent_id : cur.outbound_agent_id;
        // A present array (incl. empty) is authoritative; fall back to the
        // deprecated single-agent field only when the array is absent.
        const curAgent = Array.isArray(list) ? list[0]?.agent_id ?? null : deprecated ?? null;
        if (curAgent !== agentId) continue;
        if (Array.isArray(list)) {
          // Preserve the full weighted list; bump only our agent's version.
          fields[column] = list.map((e) =>
            e.agent_id === agentId ? { ...e, agent_version: ver } : e
          );
        } else {
          // Only the deprecated single field was set; migrate to a weighted list.
          fields[column] = [{ agent_id: agentId, agent_version: ver, weight: 1 }];
        }
        bumped.push(direction);
      }

      if (bumped.length === 0) {
        console.log(`[repoint-phones] ${phone} routes no direction to ${agentId}; skipping (slot ${slotNumber})`);
        continue;
      }

      await retellFetch(
        apiKey,
        "PATCH",
        `update-phone-number/${encodeURIComponent(phone)}`,
        fields,
      );
      console.log(`[repoint-phones] Repointed ${phone} [${bumped.join(", ")}] to v${publishedVersion} (slot ${slotNumber}, agent ${agentId})`);
    } catch (phoneErr) {
      console.warn(`[repoint-phones] Failed to repoint phone ${phone}:`, phoneErr);
    }
  }
}

// EE1 direction fan-out (DIRECTION_TO_AGENT_COLUMN + fanOutDirections) was
// removed 2026-06-17 (P3a). It was the only code that NULLed a direction column,
// and the source of the 2026-05-18 shared-agent wipe class. Outbound routing is
// now UUID/voice_setters-driven; agent-id persistence to clients[agentColumn]
// happens directly in the sync paths, so no fan-out is needed.

// BFD voice-tool URL authority + default-tool injection, shared by the retell-llm
// and conversation-flow sync paths (CustomTool schema is identical for both).
// Extracted VERBATIM from syncVoiceSetter (2026-06-12); output must stay
// byte-identical for the legacy path.
function prepareGeneralTools(
  llmSettings: Record<string, unknown> | undefined,
  clientId: string,
  intakeSecret: string | null,
  logTag: string,
): Array<Record<string, unknown>> {
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
      console.warn(`[${logTag}] Skipping tool "${t.name}" — invalid URL: "${t.url}"`);
      return false;
    }
    return true;
  });
  const generalTools = validatedTools.length > 0 ? validatedTools : [{ type: "end_call", name: "end_call" }];
  console.log(`[${logTag}] Tools received (${rawTools.length}):`, JSON.stringify(rawTools.map((t: any) => t.name || t.type)));
  console.log(`[${logTag}] Tools to sync (${generalTools.length}):`, JSON.stringify(generalTools.map((t: any) => t.name || t.type)));
  const forcedCount = generalTools.filter((t: any) => t.url === VOICE_BOOKING_TOOLS_URL).length;
  if (forcedCount > 0) {
    console.log(`[${logTag}] Forced ${forcedCount} BFD tool URL(s) to voice-booking-tools for client ${clientId}`);
  }
  return generalTools as Array<Record<string, unknown>>;
}

// Dynamic-variables reference block appended to every voice prompt at push time.
// Extracted VERBATIM from syncVoiceSetter (2026-06-12); shared by the retell-llm
// path (appended to general_prompt) and the conversation-flow path (appended to
// global_prompt). KEEP IN SYNC with the client-side replica at
// frontend/src/data/retellDynamicVarsBlock.ts.
//
// Per-client timezone label drives the "Current Date & Time" line so the agent
// anchors to the caller's local TZ instead of the legacy hardcoded (ET) which
// confused Gary in the 2026-05-18 inbound booking ("Monday May 18" when it was
// tomorrow Tuesday in Sydney).
//
// CRITICAL on inbound BYO Twilio calls: dynamic variables arrive EMPTY (Retell
// limitation). The instructional note below tells the agent how to behave when
// {{current_time}} or other vars are blank — defer to the get-available-slots
// tool to discover today's date, never guess the day-of-week.
function buildDynamicVarsBlock(clientTimezone: string): string {
  return `

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
}

// Build agent-level update payload from voiceSettings. Engine-agnostic (the agent
// object is the same for retell-llm and conversation-flow engines). Extracted
// VERBATIM from syncVoiceSetter (2026-06-12).
// Use explicit !== undefined checks so falsy values (0, false, null) are properly sent
function buildAgentUpdatesFromVoiceSettings(voiceSettings?: Record<string, unknown>): Record<string, unknown> {
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
  return agentUpdates;
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

  const generalTools = prepareGeneralTools(llmSettings, clientId, intakeSecret, "sync-voice-setter");
  const knowledgeBaseIds = Array.isArray(llmSettings?.knowledge_base_ids)
    ? (llmSettings.knowledge_base_ids as unknown[]).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    : [];
  // Auto-append dynamic variables reference block so Retell can substitute them
  // (full rationale on buildDynamicVarsBlock above; shared with the CF path).
  const enrichedPrompt = generalPrompt + buildDynamicVarsBlock(clientTimezone);

  // Latency guard (durable prevention). The auto-injected dynamic-vars block adds
  // exactly ONE {{available_time_slots}}. More than one means the prompt body /
  // booking instructions carry duplicates, which Retell re-substitutes with the
  // full availability JSON on EVERY turn — the 2026-06-12 blowup (21 refs ->
  // ~291k chars/turn -> first-token timeouts). We never edit prompt content
  // (report-only rule); we surface a non-fatal warning so the UI can flag it.
  const slotRefCount = (enrichedPrompt.match(/\{\{available_time_slots\}\}/g) || []).length;
  const slotSubstitutionWarning = slotRefCount > 1
    ? `Prompt contains ${slotRefCount} {{available_time_slots}} references (expected 1). ` +
      `Each is re-substituted with the full availability JSON every turn, inflating ` +
      `latency and token cost. Remove the extra references from the prompt body and ` +
      `Booking Instructions; rely on the auto-injected dynamic-variables block only.`
    : null;
  if (slotSubstitutionWarning) console.warn(`[sync-voice-setter] ${slotSubstitutionWarning}`);

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

  // Build agent-level update payload from voiceSettings (engine-agnostic; shared
  // with the conversation-flow path).
  const agentUpdates = buildAgentUpdatesFromVoiceSettings(voiceSettings);

  // Fetch the current agent ID for this slot.
  const { data: clientData, error: agentLookupErr } = await supabase
    .from("clients")
    .select(agentColumn)
    .eq("id", clientId)
    .single();
  if (agentLookupErr) throw new Error(`Failed to fetch client: ${agentLookupErr.message}`);

  const clientRowAgents = clientData as Record<string, string | null>;
  const existingAgentId = clientRowAgents[agentColumn];

  // Capture any non-blocking publish failure (was silently swallowed before
  // the 2026-05-18 incident — Brendan's UI Save Setter looked like a hard error
  // because the toast said "edge fn returned non-2xx" with no detail. Now we
  // surface this in the response so the toast can warn explicitly.)
  let publishWarning: string | null = null;

  if (existingAgentId) {
    console.log(`[sync-voice-setter] Updating existing agent ${existingAgentId} for slot ${slotNumber}`);
    const agent = await retellFetch(apiKey, "GET", `get-agent/${existingAgentId}`) as any;
    // Engine guard (2026-06-12): a conversation-flow agent has no llm_id, so the
    // else-branch below would otherwise create a NEW retell-llm and PATCH the
    // agent's response_engine in place — silently destroying the flow. Refuse.
    if (agent?.response_engine?.type === "conversation-flow") {
      return {
        success: false,
        code: "cf_engine_mismatch",
        error: `Slot ${slotNumber} agent ${existingAgentId} is a conversation-flow agent; ` +
          `the single-prompt save path cannot update it. Use the conversation-flow editor instead.`,
      };
    }
    const staleLlmId = agent?.response_engine?.llm_id;

    if (staleLlmId) {
      // Published agent/LLM versions are IMMUTABLE; patching them 400s/422s. Mint
      // (or reuse) an editable draft, then edit the DRAFT's LLM. Verified live
      // 2026-06-16: create-agent-version versions the LLM in place (same llm_id),
      // and update-agent / update-retell-llm with no version param target the draft.
      const draft = await ensureEditableAgentDraft(apiKey, existingAgentId);
      const editLlmId = draft.llmId ?? staleLlmId;
      const updatedLlm = await retellFetch(apiKey, "PATCH", `update-retell-llm/${editLlmId}`, llmPayload);
      // Always update agent with name + voice settings + auto webhook
      const agentPatch: Record<string, unknown> = {
        ...agentUpdates,
        webhook_events: DEFAULT_RETELL_WEBHOOK_EVENTS,
      };
      if (agentName) agentPatch.agent_name = agentName;
      // Auto-set webhook so call data syncs without manual config
      if (!agentPatch.webhook_url) agentPatch.webhook_url = getAutoWebhookUrl();
      // Always send the patch to ensure all settings sync (targets the draft)
      await retellFetch(apiKey, "PATCH", `update-agent/${existingAgentId}`, agentPatch);
      // Auto-publish the draft so changes go live immediately
      try {
        const publishResp = await publishAgentVersion(apiKey, existingAgentId, draft.draftVersion);
        console.log(`[sync-voice-setter] Auto-published agent ${existingAgentId} (draft v${draft.draftVersion})`);
        await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, existingAgentId, publishResp?.version);
      } catch (pubErr) {
        const message = pubErr instanceof Error ? pubErr.message : String(pubErr);
        console.warn(`[sync-voice-setter] Auto-publish failed (non-blocking):`, message);
        publishWarning = message;
      }
      await dualWriteVoiceSetter(supabase, clientId, slotNumber, agentName, existingAgentId, editLlmId);
      return { success: true, action: "updated_and_published", agent_id: existingAgentId, llm_id: editLlmId, llm: updatedLlm, publish_warning: publishWarning, slot_substitution_warning: slotSubstitutionWarning };
    } else {
      const newLlm = await retellFetch(apiKey, "POST", "create-retell-llm", llmPayload) as any;
      // Published agent versions are IMMUTABLE; mint/reuse an editable draft
      // before repointing the agent's response_engine to the new LLM.
      const draft = await ensureEditableAgentDraft(apiKey, existingAgentId);
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
      // Auto-publish the draft so changes go live immediately
      try {
        const publishResp = await publishAgentVersion(apiKey, existingAgentId, draft.draftVersion);
        console.log(`[sync-voice-setter] Auto-published agent ${existingAgentId} (draft v${draft.draftVersion})`);
        await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, existingAgentId, publishResp?.version);
      } catch (pubErr) {
        const message = pubErr instanceof Error ? pubErr.message : String(pubErr);
        console.warn(`[sync-voice-setter] Auto-publish failed (non-blocking):`, message);
        publishWarning = message;
      }
      await dualWriteVoiceSetter(supabase, clientId, slotNumber, agentName, existingAgentId, newLlm.llm_id);
      return { success: true, action: "updated_with_new_llm_and_published", agent_id: existingAgentId, llm_id: newLlm.llm_id, publish_warning: publishWarning, slot_substitution_warning: slotSubstitutionWarning };
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
      const publishResp = await publishAgentVersion(apiKey, newAgent.agent_id);
      console.log(`[sync-voice-setter] Auto-published new agent ${newAgent.agent_id} (v${publishResp?.version ?? "?"})`);
      await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, newAgent.agent_id, publishResp?.version);
    } catch (pubErr) {
      console.warn(`[sync-voice-setter] Auto-publish of new agent failed (non-blocking):`, pubErr);
    }
    await dualWriteVoiceSetter(supabase, clientId, slotNumber, agentName, newAgent.agent_id, newLlm.llm_id);
    return { success: true, action: "created_and_published", agent_id: newAgent.agent_id, llm_id: newLlm.llm_id, publish_warning: publishWarning, slot_substitution_warning: slotSubstitutionWarning };
  }
}

// ── Conversation Flow sync (doc model Phase 3, 2026-06-12) ───────────────────
// Pushes a flow OUTLINE onto a conversation-flow agent. The outline carries each
// node's full `raw` JSON round-tripped from get-conversation-flow; only
// global_prompt, node instruction text and edge condition prompts are overlaid,
// so graph surgery done in the Retell dashboard is never clobbered.
// RIGID MODE ONLY: flex mode compiles every node into one prompt and triggers
// Retell's 3,500-token billing scaler — never send any flex/compile flag.
interface FlowOutlineNode {
  id: string;
  name?: string;
  type?: string;
  instruction?: { type: string; text: string };
  edges?: Array<{ id?: string; destination_node_id?: string; condition?: string }>;
  raw?: Record<string, unknown>;
}
interface FlowOutline {
  global_prompt?: string;
  start_node_id?: string;
  start_speaker?: string;
  nodes?: FlowOutlineNode[];
}

function outlineNodeToRetellNode(n: FlowOutlineNode): Record<string, unknown> {
  const raw: Record<string, unknown> = (n.raw && typeof n.raw === "object")
    ? { ...n.raw }
    : { id: n.id, name: n.name, type: n.type || "conversation" };
  // Overlay edited instruction text (prompt-type instructions only get text swapped;
  // static_text keeps its own type from raw/outline).
  if (n.instruction && typeof n.instruction.text === "string") {
    const rawInstruction = (raw.instruction && typeof raw.instruction === "object")
      ? raw.instruction as Record<string, unknown>
      : { type: n.instruction.type || "prompt" };
    raw.instruction = { ...rawInstruction, text: n.instruction.text };
  }
  // Overlay edited edge conditions by edge id; edges unknown to the outline pass
  // through from raw untouched. Wizard-generated nodes (no raw) build edges fresh.
  if (Array.isArray(n.edges)) {
    const rawEdges = Array.isArray(raw.edges) ? raw.edges as Array<Record<string, unknown>> : null;
    if (rawEdges) {
      raw.edges = rawEdges.map((re) => {
        const edited = n.edges!.find((e) => e.id && e.id === re.id);
        if (!edited || typeof edited.condition !== "string") return re;
        const rawCondition = (re.transition_condition && typeof re.transition_condition === "object")
          ? re.transition_condition as Record<string, unknown>
          : { type: "prompt" };
        return {
          ...re,
          condition: edited.condition,
          transition_condition: rawCondition.type === "prompt"
            ? { ...rawCondition, prompt: edited.condition }
            : rawCondition,
        };
      });
    } else {
      raw.edges = n.edges.map((e) => ({
        id: e.id,
        destination_node_id: e.destination_node_id,
        condition: e.condition,
        transition_condition: { type: "prompt", prompt: e.condition },
      }));
    }
  }
  return raw;
}

async function syncVoiceSetterConversationFlow(
  apiKey: string,
  clientId: string,
  slotNumber: number,
  flowOutline: FlowOutline,
  model: string,
  agentName: string,
  voiceSettings?: Record<string, unknown>,
  llmSettings?: Record<string, unknown>,
): Promise<unknown> {
  const supabase = getSupabaseAdmin();
  const agentColumn = SLOT_TO_AGENT_COLUMN[slotNumber];
  if (!agentColumn) throw new Error(`Invalid voice setter slot number: ${slotNumber}`);
  if (!flowOutline || !Array.isArray(flowOutline.nodes) || flowOutline.nodes.length === 0) {
    throw new Error("[sync-voice-setter-cf] flowOutline with at least one node is required");
  }

  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("id, intake_lead_secret, timezone")
    .eq("id", clientId)
    .single();
  if (clientErr || !clientRow) {
    throw new Error(`[sync-voice-setter-cf] Failed to fetch client ${clientId}: ${clientErr?.message ?? "not found"}`);
  }
  const clientTimezone = (clientRow as { timezone: string | null }).timezone || "Australia/Sydney";
  let intakeSecret = (clientRow as { intake_lead_secret: string | null }).intake_lead_secret;
  if (!intakeSecret) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    intakeSecret = btoa(String.fromCharCode(...bytes));
    console.log(`[sync-voice-setter-cf] Auto-minting intake_lead_secret for client ${clientId}`);
    const { error: mintErr } = await supabase
      .from("clients")
      .update({ intake_lead_secret: intakeSecret })
      .eq("id", clientId);
    if (mintErr) console.warn(`[sync-voice-setter-cf] intake_lead_secret persist failed: ${mintErr.message}`);
  }

  // Same custom tools as the retell-llm path (identical CustomTool schema), but
  // flow-level: end_call / transfer_call have no place in the flow tools array
  // (call ending is an End node in a conversation flow).
  const generalTools = prepareGeneralTools(llmSettings, clientId, intakeSecret, "sync-voice-setter-cf");
  const flowTools = generalTools.filter((t) => t.type !== "end_call" && t.type !== "transfer_call");

  const flowPayload: Record<string, unknown> = {
    global_prompt: (flowOutline.global_prompt || "") + buildDynamicVarsBlock(clientTimezone),
    nodes: flowOutline.nodes.map(outlineNodeToRetellNode),
    start_speaker: flowOutline.start_speaker === "user" ? "user" : "agent",
    model_choice: {
      type: "cascading",
      model: mapToRetellModel(model),
      high_priority: llmSettings?.model_high_priority ?? true,
    },
    tools: flowTools,
  };
  if (flowOutline.start_node_id) flowPayload.start_node_id = flowOutline.start_node_id;

  // Agent-level updates: voice settings are engine-agnostic; reuse the same
  // field mapping by patching the agent exactly like the retell-llm path does.
  const agentUpdates = buildAgentUpdatesFromVoiceSettings(voiceSettings);

  const { data: clientData, error: agentLookupErr } = await supabase
    .from("clients")
    .select(agentColumn)
    .eq("id", clientId)
    .single();
  if (agentLookupErr) throw new Error(`Failed to fetch client: ${agentLookupErr.message}`);
  const clientRowAgents = clientData as Record<string, string | null>;
  const existingAgentId = clientRowAgents[agentColumn];

  let publishWarning: string | null = null;

  if (existingAgentId) {
    const agent = await retellFetch(apiKey, "GET", `get-agent/${existingAgentId}`) as any;
    const engineType = agent?.response_engine?.type;
    if (engineType !== "conversation-flow") {
      // v1: conversation-flow is for NEW setters only; converting a live
      // single-prompt slot in place is deliberately unsupported.
      return {
        success: false,
        code: "cf_engine_mismatch",
        error: `Slot ${slotNumber} already has a ${engineType ?? "unknown"} agent (${existingAgentId}). ` +
          `Conversation Flow is only supported on newly created setters; duplicate into a fresh slot instead.`,
      };
    }
    const staleFlowId = agent?.response_engine?.conversation_flow_id;
    if (!staleFlowId) throw new Error(`[sync-voice-setter-cf] Agent ${existingAgentId} has no conversation_flow_id`);
    // Published versions (and their flows) are IMMUTABLE; mint/reuse an editable
    // draft, then edit the DRAFT's flow. No live BFD setter uses CF, so this path
    // is unverified live, but keeps the CF flow symmetric with the retell-llm path.
    const draft = await ensureEditableAgentDraft(apiKey, existingAgentId);
    const editFlowId = draft.flowId ?? staleFlowId;
    console.log(`[sync-voice-setter-cf] Updating flow ${editFlowId} on agent ${existingAgentId} draft v${draft.draftVersion} (slot ${slotNumber})`);
    const updatedFlow = await retellFetch(apiKey, "PATCH", `update-conversation-flow/${editFlowId}`, flowPayload) as any;
    const agentPatch: Record<string, unknown> = {
      ...agentUpdates,
      webhook_events: DEFAULT_RETELL_WEBHOOK_EVENTS,
    };
    if (agentName) agentPatch.agent_name = agentName;
    if (!agentPatch.webhook_url) agentPatch.webhook_url = getAutoWebhookUrl();
    await retellFetch(apiKey, "PATCH", `update-agent/${existingAgentId}`, agentPatch);
    try {
      const publishResp = await publishAgentVersion(apiKey, existingAgentId, draft.draftVersion);
      console.log(`[sync-voice-setter-cf] Auto-published agent ${existingAgentId} (draft v${draft.draftVersion})`);
      await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, existingAgentId, publishResp?.version);
    } catch (pubErr) {
      const message = pubErr instanceof Error ? pubErr.message : String(pubErr);
      console.warn(`[sync-voice-setter-cf] Auto-publish failed (non-blocking):`, message);
      publishWarning = message;
    }
    return {
      success: true,
      action: "updated_and_published",
      agent_id: existingAgentId,
      conversation_flow_id: editFlowId,
      flow_version: updatedFlow?.version ?? null,
      publish_warning: publishWarning,
    };
  }

  console.log(`[sync-voice-setter-cf] Creating new conversation-flow agent for slot ${slotNumber}`);
  let voiceId = voiceSettings?.voice_id as string | undefined;
  if (!voiceId) {
    const voices = await retellFetch(apiKey, "GET", "list-voices") as any[];
    voiceId = voices?.[0]?.voice_id;
    if (!voiceId) throw new Error("No voices available in your Retell account. Please add a voice first.");
  }

  const newFlow = await retellFetch(apiKey, "POST", "create-conversation-flow", flowPayload) as any;
  const createAgentPayload = Object.fromEntries(
    Object.entries({
      agent_name: agentName || `Voice Setter ${slotNumber}`,
      channel: "voice",
      voice_id: voiceId,
      response_engine: {
        type: "conversation-flow",
        conversation_flow_id: newFlow.conversation_flow_id,
        ...(newFlow?.version !== undefined && newFlow?.version !== null ? { version: newFlow.version } : {}),
      },
      language: (voiceSettings?.language as string) || "en-US",
      ...agentUpdates,
      webhook_url: agentUpdates.webhook_url || getAutoWebhookUrl(),
      webhook_events: DEFAULT_RETELL_WEBHOOK_EVENTS,
    }).filter(([, value]) => value !== undefined && value !== null),
  );
  const newAgent = await retellFetch(apiKey, "POST", "create-agent", createAgentPayload) as any;

  await supabase.from("clients").update({ [agentColumn]: newAgent.agent_id }).eq("id", clientId);
  console.log(`[sync-voice-setter-cf] Created agent ${newAgent.agent_id} (flow ${newFlow.conversation_flow_id}) in ${agentColumn}`);
  try {
    const publishResp = await publishAgentVersion(apiKey, newAgent.agent_id);
    console.log(`[sync-voice-setter-cf] Auto-published new agent ${newAgent.agent_id} (v${publishResp?.version ?? "?"})`);
    await repointPhoneVersionsAfterPublish(supabase, apiKey, clientId, slotNumber, newAgent.agent_id, publishResp?.version);
  } catch (pubErr) {
    const message = pubErr instanceof Error ? pubErr.message : String(pubErr);
    console.warn(`[sync-voice-setter-cf] Auto-publish of new agent failed (non-blocking):`, message);
    publishWarning = message;
  }
  return {
    success: true,
    action: "created_and_published",
    agent_id: newAgent.agent_id,
    conversation_flow_id: newFlow.conversation_flow_id,
    publish_warning: publishWarning,
  };
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

      case "update-llm": {
        if (!params.llmId) throw new Error("llmId is required");
        // Published LLM versions are IMMUTABLE. This raw pass-through has no agent
        // context, so it cannot mint a draft via create-agent-version (that endpoint
        // is keyed by agent, not LLM). Surface a clear, actionable error instead of
        // leaking Retell's opaque 400; anything editing a live setter's prompt must
        // go through sync-voice-setter, which drafts + publishes.
        const llmState = await retellFetch(apiKey, "GET", `get-retell-llm/${params.llmId}`) as { is_published?: boolean };
        if (llmState?.is_published === true) {
          const guardErr = new Error(
            `LLM ${params.llmId} is published and cannot be edited directly. Use the voice setter ` +
            `"Push to Retell" (sync-voice-setter) flow, which creates a draft version and publishes it.`,
          ) as Error & { code?: string };
          guardErr.code = "llm_update_requires_agent_context";
          throw guardErr;
        }
        result = await retellFetch(apiKey, "PATCH", `update-retell-llm/${params.llmId}`, params.llmData);
        break;
      }

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

        // Published agent versions are IMMUTABLE; mint/reuse a draft, rename it, publish.
        const draft = await ensureEditableAgentDraft(apiKey, existingAgentId);
        await retellFetch(apiKey, "PATCH", `update-agent/${existingAgentId}`, { agent_name: agentName });
        let publishedVersion: number | undefined;
        try {
          const publishResp = await publishAgentVersion(apiKey, existingAgentId, draft.draftVersion);
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
            const conversationFlowId = agent?.response_engine?.type === "conversation-flow"
              ? agent?.response_engine?.conversation_flow_id
              : null;
            // Delete agent first
            await retellFetch(apiKey, "DELETE", `delete-agent/${existingAgentId}`);
            console.log(`[delete-voice-setter] Deleted Retell agent ${existingAgentId}`);
            // Delete the response engine object (LLM or conversation flow) if it exists
            if (llmId) {
              try {
                await retellFetch(apiKey, "DELETE", `delete-retell-llm/${llmId}`);
                console.log(`[delete-voice-setter] Deleted Retell LLM ${llmId}`);
              } catch (llmErr) {
                console.warn(`[delete-voice-setter] Failed to delete LLM ${llmId}:`, llmErr);
              }
            }
            if (conversationFlowId) {
              try {
                await retellFetch(apiKey, "DELETE", `delete-conversation-flow/${conversationFlowId}`);
                console.log(`[delete-voice-setter] Deleted conversation flow ${conversationFlowId}`);
              } catch (flowErr) {
                console.warn(`[delete-voice-setter] Failed to delete conversation flow ${conversationFlowId}:`, flowErr);
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

        // Soft-delete the voice_setters row so it can't linger as an orphan
        // pointing at the now-deleted agent (delete-setter bug). Runs even when
        // no agent was found, so a pre-existing orphan is cleaned too. Keyed on
        // (client_id, legacy_slot) like dualWriteVoiceSetter. Non-blocking.
        try {
          await supabaseAdmin
            .from("voice_setters")
            .update(buildVoiceSetterDeactivatePayload())
            .eq("client_id", clientId)
            .eq("legacy_slot", slotNumber);
          console.log(`[delete-voice-setter] Deactivated voice_setters row for slot ${slotNumber}`);
        } catch (vsErr) {
          console.warn(`[delete-voice-setter] Failed to deactivate voice_setters row for slot ${slotNumber}:`, vsErr);
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

      // ===== SYNC VOICE SETTER (CONVERSATION FLOW ENGINE) =====
      // Doc model Phase 3 (2026-06-12). Pushes a flow outline onto a
      // conversation-flow agent; rigid mode only (no flex/compile flag, ever).
      case "sync-voice-setter-cf": {
        const slotNumber = params.slotNumber as number;
        if (!slotNumber) throw new Error("slotNumber is required");
        const flowOutline = params.flowOutline as FlowOutline | undefined;
        if (!flowOutline) throw new Error("flowOutline is required");
        const model = (params.model as string) || "gpt-4.1-nano";
        const agentName = (params.agentName as string) || "";
        const voiceSettings = params.voiceSettings as Record<string, unknown> | undefined;
        const llmSettings = params.llmSettings as Record<string, unknown> | undefined;
        console.log(`[sync-voice-setter-cf] Starting sync for slot ${slotNumber}, model: ${model}, nodes: ${Array.isArray(flowOutline.nodes) ? flowOutline.nodes.length : 0}`);
        result = await syncVoiceSetterConversationFlow(apiKey, clientId, slotNumber, flowOutline, model, agentName, voiceSettings, llmSettings);
        console.log(`[sync-voice-setter-cf] Result:`, JSON.stringify(result));
        break;
      }

      // ===== GET CONVERSATION FLOW (for the outline editor) =====
      // Returns the LIVE flow JSON for a slot's conversation-flow agent so the
      // frontend hydrates its outline from Retell on every editor open (dashboard
      // edits are absorbed instead of clobbered).
      case "get-conversation-flow": {
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
        const agentId = (clientRow as Record<string, string | null>)?.[agentColumn];
        if (!agentId) {
          result = { success: false, code: "no_agent", error: `No agent for slot ${slotNumber}` };
          break;
        }
        const agent = await retellFetch(apiKey, "GET", `get-agent/${agentId}`) as any;
        if (agent?.response_engine?.type !== "conversation-flow") {
          result = { success: false, code: "cf_engine_mismatch", error: `Slot ${slotNumber} agent is not a conversation-flow agent` };
          break;
        }
        const flowId = agent.response_engine.conversation_flow_id;
        const flow = await retellFetch(apiKey, "GET", `get-conversation-flow/${flowId}`);
        result = { success: true, agent_id: agentId, conversation_flow_id: flowId, flow };
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

            // Published versions are IMMUTABLE; mint/reuse a draft and edit the
            // draft's LLM (same llm_id, in place) before publishing.
            const draft = await ensureEditableAgentDraft(apiKey, agentId);
            await retellFetch(apiKey, "PATCH", `update-retell-llm/${draft.llmId ?? llmId}`, { general_tools: patchedTools });
            try {
              const publishResp = await publishAgentVersion(apiKey, agentId, draft.draftVersion);
              // Repoint phone version pins so the refreshed tool messages go live
              // (this site previously published but never repinned — latent bug).
              await repointPhoneVersionsAfterPublish(supabaseAdmin, apiKey, clientId, Number(slotStr), agentId, publishResp?.version);
            } catch (pubErr) {
              console.warn(`[refresh-booking-tool-messages] publish/repoint failed for ${agentId}`, pubErr);
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
