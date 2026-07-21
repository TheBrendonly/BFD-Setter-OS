// Single source of truth for the outbound-SMS opt-out (STOP) footer.
//
// Australian Spam Act: every COMMERCIAL message must carry a functional
// unsubscribe facility. v1 previously sent cadence / follow-up / nudge / manual
// SMS with NO unsubscribe wording (audit 2026-07-20 / the v2 compliance finding).
// The wording is Brendan's ratified choice (needs-brendan.md 2026-07-16):
// "Reply STOP to unsubscribe" (mirrors the Act's own "unsubscribe" language).
//
// Scope (matches the v2 ruling): appended to the four INITIATED commercial paths
// (cadence, follow-up, cold-reply nudge, manual CRM send). NOT appended to
// reactive replies inside a conversation the lead started (processMessages /
// receive-twilio-sms), which are the conservative "not initiated" case.
//
// Idempotent: if the body already carries opt-out wording (Brendan wrote his own
// STOP line into the copy), it is left untouched so nothing doubles up.

export const OPT_OUT_FOOTER = "Reply STOP to unsubscribe";

// Matches an explicit opt-out INSTRUCTION, not a bare "stop" (so "stop by the
// office" does not suppress the footer).
const OPT_OUT_RE = /\bunsubscribe\b|\bopt[\s-]?out\b|(?:reply|text|txt|send)\s+stop\b/i;

export function hasOptOutWording(body: string): boolean {
  return OPT_OUT_RE.test(body || "");
}

export function appendOptOutFooter(body: string): string {
  if (!body) return body;
  if (hasOptOutWording(body)) return body;
  return `${body}\n\n${OPT_OUT_FOOTER}`;
}
