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

// BOOK-CONFIRM-HONESTY-1 — the mirror of the reschedule guard for a FRESH booking.
// The fast text model (or a tool abort, per BOOK-ABORT-GHOST-1) can produce a
// "you're booked / all set for 2pm / confirmation email coming" reply while
// book-appointments never returned ok this turn, leaving the lead believing they
// are booked when nothing (or a ghost) landed. These patterns are DISTINCT from
// the reschedule ones and deliberately narrow to a COMPLETED booking claim
// (past-tense / "you're booked in / confirmed for <time>"); a mere OFFER
// ("I can book you in for 2pm?", "shall I lock in 2pm?") must NOT trigger a rewrite.
const BOOKING_CONFIRM_PATTERNS: RegExp[] = [
  /\byou'?re (all )?booked\b/i, // you're booked / you're all booked (incl. "booked in")
  /\byou'?re (all )?set (for|on)\b/i, // "you're all set for Tuesday" (not "set to choose")
  /\byou'?re (confirmed|scheduled|booked) (for|on|in)\b/i,
  /\b(locked|penciled|pencilled) (you )?in\b/i, // past tense only ("locked in", not "lock in")
  /\bi'?ve (booked|scheduled|got) you (in|down|for)\b/i,
  /\bgot you (booked|scheduled|down) (in|for)\b/i,
  /\b(your |the )?(appointment|booking|call|meeting|slot) (is |has been )?(booked|confirmed|all set|sorted|locked in|scheduled)\b/i,
  /\b(booking|appointment) (is )?(confirmed|complete|done)\b/i,
  /\ball booked in\b/i,
];

// True when the text reads as a fresh-booking SUCCESS confirmation and is not hedged.
export function claimsBookingSuccess(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (!BOOKING_CONFIRM_PATTERNS.some((re) => re.test(t))) return false;
  if (HEDGE_PATTERNS.some((re) => re.test(t))) return false;
  return true;
}

// True when the reply claims a booking succeeded but no book-appointment(s) tool
// returned ok this turn — the caller should rewrite the reply honestly.
export function needsBookingHonestyRewrite(
  replyText: string,
  toolInvocations: GuardToolInvocation[],
): boolean {
  const succeeded = (toolInvocations || []).some(
    (t) => (t.name === "book-appointments" || t.name === "book-appointment") && !t.error,
  );
  if (succeeded) return false;
  return claimsBookingSuccess(replyText);
}
