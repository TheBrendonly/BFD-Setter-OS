// Full-fidelity Retell config snapshot (2026-08-12 overnight build, spec
// Docs/OVERNIGHT_RUN_2026-08-12.md item 1).
//
// WHY: the ratified "Conductor workflow" (Docs/RETELL_PIVOT_DECISION_2026-08-12.md)
// shapes voice personas in Retell's dashboard and then archives the known-good agent
// back into BFD via pull-retell-config. The v0 snapshot stored prompt PRESENCE and a
// char-count plus tool NAMES only — enough to detect drift, not enough to rebuild.
// This builder stores the config VERBATIM so a slot can be restored (see restore.ts).
//
// BACKWARD COMPATIBILITY IS THE CONTRACT. Every v0 key keeps its exact name, nesting
// position and value expression. The one field with a cross-boundary consumer is
// `llm.booking_tools_present`, read by trigger/_shared/retellDrift.ts:49 (strict
// `=== true`) via trigger/pollRetellDrift.ts, which passes the stored jsonb through
// whole. Widening is invisible to it as long as that field keeps its meaning.
// snapshot.test.ts locks both the v0 shape and that one field.
//
// Absent Retell fields are stored as `null`, never `undefined`: undefined vanishes
// through JSON.stringify into jsonb, which would make "Retell omitted it" and "we
// never captured it" indistinguishable on read-back.
import { BFD_VOICE_BOOKING_TOOL_NAMES } from "../_shared/bfdVoiceTools.ts";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Agent-level fields captured verbatim. Mirrors the keys
 * buildAgentUpdatesFromVoiceSettings (index.ts:662) can write, so a restore can put
 * back everything a push can set. Read-only fields (agent_id, version, is_published,
 * last_modification_timestamp) are captured for the audit trail but are NEVER part of
 * a restore PATCH — see RESTORABLE_AGENT_FIELDS in restore.ts.
 */
export const AGENT_FAT_FIELDS = [
  "webhook_url",
  "webhook_events",
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

/** LLM-level fields captured verbatim beyond the v0 thin set. */
export const LLM_FAT_FIELDS = [
  "general_prompt",
  "begin_message",
  "general_tools",
  "model_temperature",
  "model_high_priority",
  "tool_call_strict_mode",
  "knowledge_base_ids",
  "default_dynamic_variables",
  "states",
  "starting_state",
] as const;

export interface BuildSnapshotInput {
  /** Fallback when the agent payload omits agent_id. */
  agentId: string;
  /** get-agent result. */
  agent: Record<string, unknown> | null;
  /** get-retell-llm result; null for conversation-flow agents. */
  llm: Record<string, unknown> | null;
  /** get-conversation-flow result; null for retell-llm agents. */
  flow: Record<string, unknown> | null;
  /** Injected by the caller so tests are deterministic. */
  pulledAt: string;
}

export interface RetellConfigSnapshot {
  schema_version: number;
  pulled_at: string;
  agent: Record<string, unknown>;
  llm: Record<string, unknown> | null;
  flow: Record<string, unknown> | null;
}

/** `obj[key]` coerced to null when absent/undefined. Never returns undefined. */
function nullable(obj: Record<string, unknown> | null, key: string): unknown {
  const value = obj?.[key];
  return value === undefined ? null : value;
}

function pickFat(
  source: Record<string, unknown> | null,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = nullable(source, key);
  return out;
}

/**
 * Build the snapshot stored in voice_setters.retell_config_snapshot.
 *
 * The v0 thin fields are reproduced first and byte-for-byte; the fat fields are
 * appended. Callers pass the raw get-agent / get-retell-llm / get-conversation-flow
 * bodies straight through.
 */
export function buildRetellConfigSnapshot(input: BuildSnapshotInput): RetellConfigSnapshot {
  const { agentId, agent, llm, flow, pulledAt } = input;
  const responseEngine = agent?.response_engine as Record<string, unknown> | undefined;
  const engineType = responseEngine?.type ?? null;

  let llmSnap: Record<string, unknown> | null = null;
  if (llm) {
    // v0 semantics, unchanged: names only, non-string names dropped.
    const tools = Array.isArray(llm.general_tools)
      ? (llm.general_tools as Array<Record<string, unknown>>)
        .map((t) => (typeof t?.name === "string" ? t.name : null))
        .filter(Boolean)
      : [];
    const prompt = typeof llm.general_prompt === "string" ? llm.general_prompt : "";
    const beginMessage = typeof llm.begin_message === "string" ? llm.begin_message : "";
    llmSnap = {
      // ── v0 thin fields (do not reorder, rename, or change these expressions) ──
      // v0 fell back to the agent's response_engine.llm_id, not null.
      llm_id: llm.llm_id ?? responseEngine?.llm_id ?? null,
      model: llm.model ?? null,
      version: llm.version ?? null,
      general_prompt_present: prompt.length > 0,
      general_prompt_chars: prompt.length,
      begin_message_present: beginMessage.length > 0,
      start_speaker: llm.start_speaker ?? null,
      tools,
      // Cross-boundary contract: trigger/_shared/retellDrift.ts:49 reads this.
      booking_tools_present: tools.some((n) => BFD_VOICE_BOOKING_TOOL_NAMES.has(n as string)),
      // ── fat fields (schema_version 1) ──
      ...pickFat(llm, LLM_FAT_FIELDS),
    };
  }

  let flowSnap: Record<string, unknown> | null = null;
  if (flow) {
    flowSnap = {
      // ── v0 thin fields ──
      // v0 read this off the AGENT's response_engine, not the flow body.
      conversation_flow_id: responseEngine?.conversation_flow_id ?? flow.conversation_flow_id ?? null,
      present: true,
      node_count: Array.isArray(flow.nodes) ? (flow.nodes as unknown[]).length : null,
      // ── fat: nested, NOT spread, so a Retell key can never collide with the
      //    three v0 keys above and silently change their meaning. ──
      definition: flow,
    };
  }

  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    pulled_at: pulledAt,
    agent: {
      // ── v0 thin fields (do not reorder or rename) ──
      agent_id: agent?.agent_id ?? agentId,
      agent_name: agent?.agent_name ?? null,
      version: agent?.version ?? null,
      is_published: agent?.is_published ?? null,
      last_modification_timestamp: agent?.last_modification_timestamp ?? null,
      voice_id: agent?.voice_id ?? null,
      language: agent?.language ?? null,
      engine_type: engineType,
      // ── fat fields ──
      response_engine: agent?.response_engine ?? null,
      ...pickFat(agent, AGENT_FAT_FIELDS),
    },
    llm: llmSnap,
    flow: flowSnap,
  };
}

/** True when the snapshot carries enough to rebuild a retell-llm agent. */
export function isRestorableSnapshot(snapshot: unknown): boolean {
  const s = snapshot as RetellConfigSnapshot | null;
  if (!s || typeof s !== "object") return false;
  if (s.schema_version !== SNAPSHOT_SCHEMA_VERSION) return false;
  return typeof s.llm?.general_prompt === "string" || s.flow != null;
}
