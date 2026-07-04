// API-DEPR-2 — pure builder for the Retell agent `post_call_analysis_data` array.
//
// Retell's 06/15/2026 deprecation notice removes three top-level agent fields —
// analysis_summary_prompt / analysis_successful_prompt / analysis_user_sentiment_prompt —
// in favour of `post_call_analysis_data` entries of { type: "system-presets", name, description }
// where name is call_summary / call_successful / user_sentiment. Crucially, system-preset
// OUTPUTS still populate the TOP-LEVEL call_analysis fields (call_summary / call_successful /
// user_sentiment), NOT custom_analysis_data — so the downstream analysis webhooks are unaffected.
//
// This is the single Retell-facing merge point (called from buildAgentUpdatesFromVoiceSettings).
// It folds the deprecated prompt fields into system-presets, merges them with the caller's custom
// analysis fields, and is idempotent + rollout-safe: a caller that already sends the presets (new
// frontend) wins over a stale deprecated field (old browser), and it never emits the deprecated
// field names.

// Maps a deprecated top-level field name -> its system-preset `name`.
const DEPRECATED_FIELD_TO_PRESET: ReadonlyArray<[string, string]> = [
  ["analysis_summary_prompt", "call_summary"],
  ["analysis_successful_prompt", "call_successful"],
  ["analysis_user_sentiment_prompt", "user_sentiment"],
];

export function buildPostCallAnalysisData(
  voiceSettings?: Record<string, unknown>,
): unknown[] | undefined {
  const raw = voiceSettings?.post_call_analysis_data;
  const incoming: unknown[] = Array.isArray(raw) ? raw : [];

  // Split incoming entries: caller-provided system-presets (keyed by name, encounter order
  // preserved via the Map) vs everything else (custom fields, order preserved).
  const presets = new Map<string, unknown>();
  const custom: unknown[] = [];
  for (const entry of incoming) {
    const e = entry as Record<string, unknown> | null;
    if (e && e.type === "system-presets" && typeof e.name === "string") {
      // First occurrence wins; drop accidental duplicates from the caller.
      if (!presets.has(e.name)) presets.set(e.name, e);
    } else {
      custom.push(entry);
    }
  }

  // Defensive rollout fold: convert any still-present deprecated field into a preset, but only
  // if the caller did not already provide that preset (caller-provided presets win, so a fresh
  // save from the new frontend is never clobbered by a stale field).
  for (const [field, presetName] of DEPRECATED_FIELD_TO_PRESET) {
    const value = voiceSettings?.[field];
    if (typeof value === "string" && value.trim() !== "" && !presets.has(presetName)) {
      presets.set(presetName, { type: "system-presets", name: presetName, description: value });
    }
  }

  const merged = [...presets.values(), ...custom];
  // Preserve today's behaviour: only set the field on the agent when there is something to send.
  return merged.length > 0 ? merged : undefined;
}
