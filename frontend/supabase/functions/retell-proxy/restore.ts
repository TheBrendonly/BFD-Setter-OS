// Restore a Retell agent from a full-fidelity snapshot (2026-08-12 overnight build,
// spec Docs/OVERNIGHT_RUN_2026-08-12.md item 1).
//
// Pairs with snapshot.ts: Pull archives the known-good agent, Restore puts it back.
// Everything here is pure or IO-injected, because index.ts calls Deno.serve at module
// scope and cannot be imported by a test.
//
// TWO FIDELITY RULES, enforced here rather than by convention:
//
// 1. NEVER append buildDynamicVarsBlock. syncVoiceSetter appends it at push time
//    (index.ts: `generalPrompt + buildDynamicVarsBlock(tz)`), so the prompt we read
//    back into the snapshot ALREADY contains it. Re-appending would double-inject and
//    trip the {{available_time_slots}} latency guard that exists because of the
//    2026-06-12 blowup (21 refs -> ~291k chars/turn -> first-token timeouts).
// 2. NEVER PATCH read-only agent fields (agent_id, version, is_published,
//    last_modification_timestamp). Retell 400s on them.

import { isRestorableSnapshot, type RetellConfigSnapshot } from "./snapshot.ts";

/** LLM fields a restore must send. Losing any of these makes the restore a lie. */
export const CORE_LLM_FIELDS = [
  "general_prompt",
  "general_tools",
  "model",
  "begin_message",
  "start_speaker",
] as const;

/** LLM fields safe to drop if Retell rejects them (schema churn is monthly). */
export const STRIPPABLE_LLM_FIELDS = [
  "model_temperature",
  "model_high_priority",
  "tool_call_strict_mode",
  "knowledge_base_ids",
  "default_dynamic_variables",
  "states",
  "starting_state",
] as const;

/** Agent fields a restore must send. */
export const CORE_AGENT_FIELDS = [
  "agent_name",
  "voice_id",
  "language",
  "webhook_url",
  "webhook_events",
] as const;

/** Agent fields safe to drop. */
export const STRIPPABLE_AGENT_FIELDS = [
  "webhook_timeout_ms",
  "voice_model",
  "voice_temperature",
  "voice_speed",
  "volume",
  "responsiveness",
  "interruption_sensitivity",
  "enable_backchannel",
  "backchannel_frequency",
  "ambient_sound",
  "ambient_sound_volume",
  "boosted_keywords",
  "normalize_for_speech",
  "vocab_specialization",
  "begin_message_delay_ms",
  "end_call_after_silence_ms",
  "max_call_duration_ms",
  "reminder_trigger_ms",
  "reminder_max_count",
  "voicemail_option",
  "post_call_analysis_model",
  "post_call_analysis_data",
  "data_storage_setting",
  "opt_out_sensitive_data_storage",
  "user_dtmf_options",
  "stt_mode",
  "custom_stt_config",
  "pii_config",
] as const;

export interface RestorePlan {
  engineType: string;
  llmPayload: Record<string, unknown>;
  agentPatch: Record<string, unknown>;
  strippableLlmKeys: readonly string[];
  strippableAgentKeys: readonly string[];
}

export type RestorePlanResult =
  | { ok: true; plan: RestorePlan }
  | { ok: false; status: number; code: string; error: string };

/**
 * Turn a stored snapshot into the two Retell PATCH bodies.
 *
 * `generalToolsOverride` exists for the case where intake_lead_secret was rotated
 * after the pull, so the archived tool auth headers are stale.
 */
export function buildRestorePayloads(
  snapshot: unknown,
  opts?: { generalToolsOverride?: Array<Record<string, unknown>> },
): RestorePlanResult {
  if (!isRestorableSnapshot(snapshot)) {
    return {
      ok: false,
      status: 409,
      code: "snapshot_not_restorable",
      error:
        "This slot's snapshot predates full-fidelity capture (or is missing). " +
        "Pull from Retell again first, then restore.",
    };
  }
  const snap = snapshot as RetellConfigSnapshot;
  const engineType = String(snap.agent?.engine_type ?? "");

  if (engineType === "conversation-flow") {
    return {
      ok: false,
      status: 400,
      code: "cf_restore_unsupported",
      error:
        "Conversation-flow restore is not supported yet. The full flow IS archived in " +
        "the snapshot; rebuilding a node graph needs an update-conversation-flow path " +
        "that does not exist yet.",
    };
  }
  const llm = snap.llm;
  if (!llm || typeof llm.general_prompt !== "string") {
    return {
      ok: false,
      status: 409,
      code: "snapshot_not_restorable",
      error: "Snapshot carries no verbatim general_prompt to restore.",
    };
  }

  // Core LLM fields always go, including a null begin_message (that is a real state,
  // and matches what syncVoiceSetter sends).
  const llmPayload: Record<string, unknown> = {
    model: llm.model ?? null,
    general_prompt: llm.general_prompt,
    begin_message: llm.begin_message ?? null,
    general_tools: opts?.generalToolsOverride ?? llm.general_tools ?? [],
    start_speaker: llm.start_speaker ?? "agent",
  };
  // Optional LLM fields go only when the snapshot actually captured a value: sending a
  // null we recorded because Retell omitted the field could clobber a live setting.
  for (const key of STRIPPABLE_LLM_FIELDS) {
    const value = llm[key];
    if (value !== null && value !== undefined) llmPayload[key] = value;
  }

  const agent = snap.agent ?? {};
  const agentPatch: Record<string, unknown> = {};
  for (const key of [...CORE_AGENT_FIELDS, ...STRIPPABLE_AGENT_FIELDS]) {
    const value = agent[key];
    if (value !== null && value !== undefined) agentPatch[key] = value;
  }

  return {
    ok: true,
    plan: {
      engineType: engineType || "retell-llm",
      llmPayload,
      agentPatch,
      strippableLlmKeys: STRIPPABLE_LLM_FIELDS,
      strippableAgentKeys: STRIPPABLE_AGENT_FIELDS,
    },
  };
}

export type StripOutcome =
  | { action: "retry"; payload: Record<string, unknown>; dropped: string[] }
  | { action: "fatal"; reason: "core_field_rejected"; fields: string[] }
  | { action: "fatal"; reason: "nothing_strippable"; fields: [] };

/**
 * Decide how to react to a Retell 400 on a restore PATCH.
 *
 * Retell's schema churns monthly, so a snapshot taken in August can name a field
 * September rejects. We drop non-load-bearing fields and retry ONCE, but never quietly
 * degrade a core field: a restore that silently loses the prompt or the booking tools
 * looks successful and behaves wrong, which is the worst outcome this feature has.
 */
export function planFieldStrip(
  status: number,
  message: string,
  payload: Readonly<Record<string, unknown>>,
  strippable: readonly string[],
  core: readonly string[],
): StripOutcome {
  if (status !== 400) return { action: "fatal", reason: "nothing_strippable", fields: [] };

  // Retell's 400s are Zod-shaped and name the offending field, in quotes or as a
  // dotted path (body.voice_model). Pull out every identifier we can see.
  const named = new Set<string>();
  for (const m of message.matchAll(/[`'"]([A-Za-z_][A-Za-z0-9_.]*)[`'"]/g)) {
    named.add(m[1].split(".").pop()!);
  }
  for (const m of message.matchAll(/\bbody\.([A-Za-z_][A-Za-z0-9_]*)/g)) named.add(m[1]);

  const namedCore = [...named].filter((n) => core.includes(n));
  if (namedCore.length > 0) {
    return { action: "fatal", reason: "core_field_rejected", fields: namedCore };
  }

  const namedStrippable = [...named].filter((n) => strippable.includes(n) && n in payload);
  // Nothing identifiable: drop the whole strippable set in one pass. That keeps "retry
  // once" deterministic instead of iterating an unknown number of times, and everything
  // dropped is non-load-bearing by construction.
  const toDrop = namedStrippable.length > 0
    ? namedStrippable
    : strippable.filter((k) => k in payload);

  if (toDrop.length === 0) return { action: "fatal", reason: "nothing_strippable", fields: [] };

  const next: Record<string, unknown> = { ...payload };
  for (const key of toDrop) delete next[key];
  return { action: "retry", payload: next, dropped: toDrop };
}

export interface RestoreGuardInput {
  slotNumber: number;
  snapshot: unknown;
  liveAgentId: string | null;
  liveEngineType: string | null;
  isLocked: boolean;
  force: boolean;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; status: number; code: string; error: string };

/**
 * Every refusal a restore can make, in one pure function.
 *
 * Slot 1 is refused unconditionally (SLOT-MAP-1): it aliases the legacy shared column
 * clients.retell_inbound_agent_id, and restore has no legitimate slot-1 use.
 */
export function decideRestoreGuard(input: RestoreGuardInput): GuardResult {
  const { slotNumber, snapshot, liveAgentId, liveEngineType, isLocked, force } = input;

  if (slotNumber === 1) {
    return {
      ok: false,
      status: 400,
      code: "slot_map_1",
      error:
        "SLOT-MAP-1: slot 1 aliases the client's legacy inbound-agent column and can " +
        "never be a restore target, with or without force.",
    };
  }
  if (!liveAgentId) {
    return { ok: false, status: 400, code: "no_agent", error: `No Retell agent for slot ${slotNumber}` };
  }
  if (isLocked && !force) {
    return {
      ok: false,
      status: 423,
      code: "setter_retell_locked",
      error:
        `Voice setter slot ${slotNumber} is Retell-locked. Restoring would overwrite the ` +
        "live agent; pass force to override.",
    };
  }

  const snap = snapshot as RetellConfigSnapshot | null;
  const snapshotAgentId = snap?.agent?.agent_id ?? null;
  if (snapshotAgentId && liveAgentId && snapshotAgentId !== liveAgentId && !force) {
    return {
      ok: false,
      status: 409,
      code: "snapshot_agent_mismatch",
      error:
        `The snapshot was taken from agent ${snapshotAgentId} but slot ${slotNumber} now ` +
        `points at ${liveAgentId}. Restoring would push one agent's config onto another; ` +
        "pull again, or pass force if this is intentional.",
    };
  }

  const snapshotEngine = snap?.agent?.engine_type ?? null;
  if (snapshotEngine && liveEngineType && snapshotEngine !== liveEngineType) {
    return {
      ok: false,
      status: 409,
      code: "engine_mismatch",
      error:
        `Snapshot engine is ${snapshotEngine} but the live agent is ${liveEngineType}. ` +
        "Restoring across engine types would destroy the response engine.",
    };
  }

  return { ok: true };
}

/** The Retell/DB effects the sequencer needs, injected so tests can fake them. */
export interface RestoreIo {
  retellFetch(method: string, path: string, body?: unknown): Promise<unknown>;
  ensureDraft(agentId: string): Promise<{ draftVersion: number; llmId: string | null }>;
  publish(agentId: string, version: number, description: string): Promise<{ version?: number }>;
  latestPublishedVersion(agentId: string): Promise<number | null>;
  repointPhones(agentId: string, publishRespVersion: unknown): Promise<void>;
  /** HTTP status off a thrown Retell error, or null when it was not one. */
  statusOf(error: unknown): number | null;
}

export interface RestoreExecution {
  dryRun: boolean;
  llmId: string | null;
  draftVersion: number | null;
  publishedVersion: number | null;
  publishWarning: string | null;
  droppedFields: { llm: string[]; agent: string[] };
  retried: { llm: boolean; agent: boolean };
  firstAttemptErrors: { llm: string | null; agent: string | null };
}

async function patchWithStripRetry(
  io: RestoreIo,
  path: string,
  payload: Record<string, unknown>,
  strippable: readonly string[],
  core: readonly string[],
): Promise<{ dropped: string[]; retried: boolean; firstError: string | null }> {
  try {
    await io.retellFetch("PATCH", path, payload);
    return { dropped: [], retried: false, firstError: null };
  } catch (err) {
    const status = io.statusOf(err);
    const message = err instanceof Error ? err.message : String(err);
    if (status !== 400) throw err;

    const outcome = planFieldStrip(400, message, payload, strippable, core);
    if (outcome.action === "fatal") {
      const detail = outcome.reason === "core_field_rejected"
        ? `Retell rejected a field the restore cannot drop (${outcome.fields.join(", ")}).`
        : "Retell rejected the payload and nothing was safe to drop.";
      throw new Error(`${detail} Original error: ${message}`);
    }
    // Retry ONCE, per spec. A second failure is fatal.
    await io.retellFetch("PATCH", path, outcome.payload);
    return { dropped: outcome.dropped, retried: true, firstError: message };
  }
}

/**
 * Draft -> PATCH LLM -> PATCH agent -> publish -> repoint, the same sequence
 * syncVoiceSetter uses. Publish and repoint are warn-only: a restore whose content
 * landed but whose publish failed is a partial success the caller must be told about,
 * not an exception.
 */
export async function executeRestoreSequence(
  io: RestoreIo,
  plan: RestorePlan,
  agentId: string,
  liveLlmId: string | null,
  opts: { dryRun: boolean; versionDescription: string },
): Promise<RestoreExecution> {
  const result: RestoreExecution = {
    dryRun: opts.dryRun,
    llmId: null,
    draftVersion: null,
    publishedVersion: null,
    publishWarning: null,
    droppedFields: { llm: [], agent: [] },
    retried: { llm: false, agent: false },
    firstAttemptErrors: { llm: null, agent: null },
  };

  if (opts.dryRun) {
    result.llmId = liveLlmId;
    return result;
  }

  const draft = await io.ensureDraft(agentId);
  result.draftVersion = draft.draftVersion;
  const editLlmId = draft.llmId ?? liveLlmId;
  result.llmId = editLlmId;
  if (!editLlmId) throw new Error("No retell-llm id resolvable for this agent; cannot restore.");

  const llmOutcome = await patchWithStripRetry(
    io,
    `update-retell-llm/${editLlmId}`,
    plan.llmPayload,
    plan.strippableLlmKeys,
    CORE_LLM_FIELDS,
  );
  result.droppedFields.llm = llmOutcome.dropped;
  result.retried.llm = llmOutcome.retried;
  result.firstAttemptErrors.llm = llmOutcome.firstError;

  const agentOutcome = await patchWithStripRetry(
    io,
    `update-agent/${agentId}`,
    plan.agentPatch,
    plan.strippableAgentKeys,
    CORE_AGENT_FIELDS,
  );
  result.droppedFields.agent = agentOutcome.dropped;
  result.retried.agent = agentOutcome.retried;
  result.firstAttemptErrors.agent = agentOutcome.firstError;

  try {
    const publishResp = await io.publish(agentId, draft.draftVersion, opts.versionDescription);
    const confirmed = await io.latestPublishedVersion(agentId);
    result.publishedVersion = confirmed ??
      (typeof publishResp?.version === "number" ? publishResp.version : null);
    await io.repointPhones(agentId, publishResp?.version);
  } catch (pubErr) {
    result.publishWarning = pubErr instanceof Error ? pubErr.message : String(pubErr);
  }

  return result;
}
