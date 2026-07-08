// F16C-SMS-1 — decide whether the F16(c) missed-call text-back may fire.
//
// The text-back sends an SMS to a caller-controlled from_number off a PUBLIC
// (verify_jwt=false) endpoint, i.e. an SMS-pumping / toll-fraud vector unless
// the webhook is authenticated. Fail-closed: signatureVerified is true ONLY
// when the tenant's retell_webhook_secret is armed AND the x-retell-signature
// HMAC verified (_shared/verify-webhook.ts). Secret-unset therefore counts as
// UNVERIFIED and the send is skipped (call site warns, never throws).
//
// Pure + dependency-free so it can be exercised in a small unit test
// (mirrors the sibling retell-call-analysis-webhook contactId.ts pattern).

export interface MissedCallTextbackDecisionInput {
  /** true ONLY when retell_webhook_secret is set AND the HMAC checked out. */
  signatureVerified: boolean;
  /** payload.event — fires once, on call_ended only (call_analyzed also flows through the file). */
  event: string | null | undefined;
  /** clients.missed_call_textback_enabled === true (per-client opt-in, default OFF). */
  enabled: boolean;
  /** call.direction || call.call_type (Retell populates either). */
  direction: string | null | undefined;
  /** call.from_number when it is a string, else null. */
  fromNumber: string | null;
  /** Rounded seconds from duration_ms / call_duration_ms; null when absent. */
  durationSec: number | null;
}

export function shouldSendMissedCallTextback(
  input: MissedCallTextbackDecisionInput,
): boolean {
  if (input.signatureVerified !== true) return false;
  if (input.event !== "call_ended") return false;
  if (input.enabled !== true) return false;
  const dir = String(input.direction ?? "").toLowerCase();
  if (!dir.includes("inbound")) return false;
  if (typeof input.fromNumber !== "string" || input.fromNumber.length === 0) return false;
  // "Missed" = never really engaged: no duration reported, or under 20s.
  return input.durationSec === null || input.durationSec < 20;
}
