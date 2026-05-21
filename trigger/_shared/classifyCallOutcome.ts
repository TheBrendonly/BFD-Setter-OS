// Bug 33 — comprehensive Retell disconnect_reason classifier.
//
// Replaces the legacy boolean chain at retell-call-analysis-webhook/index.ts:606-616
// and runEngagement.ts:325-338 (the two MUST stay in sync per the existing
// comment). The legacy logic counted ANY non-voicemail / non-no-connect /
// non-error disconnect as "human_pickup", which falsely classified 0.6s
// ghost connects (iOS call screening, brief carrier handshakes, swipe-
// accept-then-decline) as engagement and terminated the cadence on them.
//
// Source of truth for the disconnect_reason enum: Retell API docs 2026-05-21.
// Legacy enum strings (no_answer, busy, failed, invalid_number,
// service_unavailable, voicemail, machine_detected) are also accepted as
// aliases so historic data classifies the same way.
//
// Twin file: trigger/_shared/classifyCallOutcome.ts — byte-identical clone
// for the Node runtime. If you change one, change the other.

export type CallSignals = {
  disconnect_reason?: string | null;
  call_status?: string | null;
  duration_ms?: number | null;
  transcript_turns?: number | null;
  in_voicemail?: boolean | null;
};

export type CallClass =
  | "human_pickup"
  | "voicemail"
  | "no_connect"
  | "error"
  | "unknown";

const HUMAN_PICKUP_MIN_DURATION_MS = 5000;
const HUMAN_PICKUP_MIN_TURNS = 2;

const VOICEMAIL_SIGNALS = new Set([
  "voicemail_reached",
  "ivr_reached",
  // legacy aliases
  "voicemail",
  "machine_detected",
]);

const NO_CONNECT_SIGNALS = new Set([
  // current Retell enum
  "dial_busy",
  "dial_failed",
  "dial_no_answer",
  "invalid_destination",
  "telephony_provider_permission_denied",
  "telephony_provider_unavailable",
  "sip_routing_error",
  "marked_as_spam",
  "user_declined",
  "registered_call_timeout",
  "concurrency_limit_reached",
  "no_valid_payment",
  "error_no_audio_received",
  "error_user_not_joined",
  "scam_detected",
  "manual_stopped",
  "transfer_cancelled",
  // legacy aliases (older Retell versions / older call_history rows)
  "no_answer",
  "busy",
  "failed",
  "invalid_number",
  "service_unavailable",
]);

const ERROR_SIGNALS = new Set([
  "error_llm_websocket_open",
  "error_llm_websocket_lost_connection",
  "error_llm_websocket_runtime",
  "error_llm_websocket_corrupt_payload",
  "error_asr",
  "error_retell",
  "error_unknown",
]);

const HUMAN_PICKUP_SIGNALS = new Set([
  "call_transfer",
  "transfer_bridged",
  "max_duration_reached",
]);

const AMBIGUOUS_SIGNALS = new Set([
  "user_hangup",
  "agent_hangup",
  "inactivity",
]);

export function classifyCallOutcome(
  s: CallSignals | null | undefined,
): CallClass {
  if (!s) return "unknown";

  const dr = (s.disconnect_reason || "").toLowerCase();
  const cs = (s.call_status || "").toLowerCase();
  const dur = s.duration_ms ?? 0;
  const turns = s.transcript_turns ?? 0;
  const inVm = s.in_voicemail === true;

  // Definite voicemail / IVR — no human conversation.
  if (VOICEMAIL_SIGNALS.has(dr) || inVm) return "voicemail";

  // Hard no-connect — dial never landed, or user explicitly declined / spam.
  if (NO_CONNECT_SIGNALS.has(dr)) return "no_connect";

  // Retell-side errors.
  if (ERROR_SIGNALS.has(dr) || cs === "error") return "error";

  // Ambiguous hangup signals — require evidence of real conversation.
  // user_hangup at 0.6s with zero transcript turns is the Phase 6 ghost-
  // connect case (Bug 33). Without duration+turns gate, this would falsely
  // classify as human_pickup and silently kill the cadence.
  if (AMBIGUOUS_SIGNALS.has(dr)) {
    if (dur >= HUMAN_PICKUP_MIN_DURATION_MS && turns >= HUMAN_PICKUP_MIN_TURNS) {
      return "human_pickup";
    }
    return "no_connect";
  }

  // Definite human engagement — only happens after a real conversation existed.
  if (HUMAN_PICKUP_SIGNALS.has(dr)) return "human_pickup";

  // Empty / null disconnect_reason — Retell couldn't classify.
  if (!dr) {
    if (turns >= HUMAN_PICKUP_MIN_TURNS && dur >= HUMAN_PICKUP_MIN_DURATION_MS) {
      return "human_pickup";
    }
    return "no_connect";
  }

  // Unmapped value (Retell added something new). Log and bias toward no_connect
  // — a false-negative engagement is recoverable (the cadence keeps running);
  // a false-positive engagement is a funnel killer (the cadence terminates).
  console.warn(
    `classifyCallOutcome unmapped disconnect_reason: ${dr} (cs=${cs}, dur=${dur}, turns=${turns})`,
  );
  if (turns >= HUMAN_PICKUP_MIN_TURNS) return "human_pickup";
  return "no_connect";
}
