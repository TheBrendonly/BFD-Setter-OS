// RESCHED-SMS-1: post-loop honesty guard for the native text engine. The fast
// text model sometimes tells a lead a reschedule/cancel succeeded ("I've moved
// your Friday call to 3pm, all set") while calling NO successful mutation tool
// that turn, so the appointment never actually moved. This detects a reply that
// CLAIMS a completed reschedule/cancel when no update-appointment /
// cancel-appointments returned ok this turn, so the caller can replace it with
// an honest holding message instead of a false confirmation.
//
// Deliberately narrow to reschedule/cancel confirmations: a fresh BOOKING
// legitimately says "all set" (and uses book-appointment, not update/cancel), so
// generic "done" / "all set" must NOT trigger a rewrite on its own. And a reply
// that is already honest ("having a bit of trouble cancelling", "let me
// double-check") is left untouched via the hedge patterns.

export type GuardToolInvocation = { name: string; error?: string };

// Positive: the reply asserts a COMPLETED reschedule or cancel.
const CONFIRM_PATTERNS: RegExp[] = [
  /\bcancell?ed\b/i, // cancelled / canceled (note: NOT "cancelling", which is in-progress)
  /\bcancellation (is |has been )?(confirmed|done|complete|sorted)\b/i,
  /\b(rescheduled|re-scheduled|rebooked|re-booked)\b/i,
  /\b(moved|shifted|switched|changed|pushed)\b[^.!?\n]{0,40}\b(to|for|until|till|back to|forward to|over to)\b/i,
];

// Negation / uncertainty: the reply is already honest (does not claim success),
// e.g. "having a bit of trouble cancelling" or "let me double-check" — leave it.
const HEDGE_PATTERNS: RegExp[] = [
  /\b(can'?t|cannot|could ?n'?t|couldn'?t|unable|was ?n'?t able|not able|won'?t)\b/i,
  /\b(having (a bit of )?trouble|trouble|issue|problem|hiccup)\b/i,
  /\b(let me|i'?ll|i will|going to|gonna)\b[^.!?\n]{0,24}\b(check|look|confirm|double|sort|see|get back)\b/i,
  /\b(check(ing)?|confirm(ing)?|looking into|trying to|attempt)\b[^.!?\n]{0,24}\b(that|this|the change|for you|now|it)\b/i,
];

// True when the text reads as a reschedule/cancel SUCCESS confirmation and is not
// hedged/negated.
export function claimsRescheduleOrCancelSuccess(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (!CONFIRM_PATTERNS.some((re) => re.test(t))) return false;
  if (HEDGE_PATTERNS.some((re) => re.test(t))) return false;
  return true;
}

// True when the reply claims a reschedule/cancel succeeded but no gated mutation
// tool returned ok this turn — the caller should rewrite the reply honestly.
export function needsRescheduleHonestyRewrite(
  replyText: string,
  toolInvocations: GuardToolInvocation[],
): boolean {
  const succeeded = (toolInvocations || []).some(
    (t) => (t.name === "update-appointment" || t.name === "cancel-appointments") && !t.error,
  );
  if (succeeded) return false;
  return claimsRescheduleOrCancelSuccess(replyText);
}
