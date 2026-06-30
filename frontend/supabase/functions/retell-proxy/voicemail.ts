// VM-1 — pure builder for the Retell set-voicemail PATCH body.
//
// Extracted from the set-voicemail handler in index.ts so the mode->voicemail_option
// mapping is unit-testable. The handler previously also PATCHed
// enable_voicemail_detection + voicemail_detection_timeout_ms, but the live Retell agent
// schema no longer accepts those fields, so the whole PATCH 4xx'd and nothing landed
// (the "Push partial: voicemail_set" symptom). The existing voicemail_option:{hangup}
// already lands via the same raw PATCH, so voicemail_option alone is the proven path:
// this builder emits ONLY voicemail_option.

export type VoicemailConfig = {
  mode?: string;
  text?: string | null;
  detect_enabled?: boolean;
  detect_timeout_ms?: number;
} | null;

export type VoicemailPatchResult =
  | { ok: false; action: string; reason: string }
  | { ok: true; mode: string; patchBody: { voicemail_option: Record<string, unknown> } };

export function buildVoicemailPatch(cfg: VoicemailConfig): VoicemailPatchResult {
  if (!cfg || !cfg.mode) {
    return { ok: false, action: "skipped_no_config", reason: "clients.voicemail_config is null — set it first." };
  }

  let voicemailOption: Record<string, unknown>;
  if (cfg.mode === "hangup") {
    voicemailOption = { action: { type: "hangup" } };
  } else if (cfg.mode === "static") {
    if (!cfg.text || !cfg.text.trim()) {
      return { ok: false, action: "skipped_missing_text", reason: "Static voicemail requires `text` to be non-empty." };
    }
    voicemailOption = { action: { type: "static", text: cfg.text } };
  } else if (cfg.mode === "prompt") {
    if (!cfg.text || !cfg.text.trim()) {
      return { ok: false, action: "skipped_missing_text", reason: "Prompt voicemail requires `text` to be non-empty." };
    }
    voicemailOption = { action: { type: "prompt", text: cfg.text } };
  } else {
    return { ok: false, action: "invalid_mode", reason: `Unknown voicemail mode: ${cfg.mode}. Use hangup, static, or prompt.` };
  }

  // VM-1: voicemail_option ONLY — never the deprecated enable_voicemail_detection /
  // voicemail_detection_timeout_ms (they caused the rejection that broke the push).
  return { ok: true, mode: cfg.mode, patchBody: { voicemail_option: voicemailOption } };
}
