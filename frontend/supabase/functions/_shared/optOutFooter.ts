// Single source of truth for the outbound-SMS opt-out (STOP) footer (edge/Deno
// side). Mirror of trigger/_shared/optOutFooter.ts — kept in sync by hand
// because the two runtimes cannot share a module. See that file for the full
// rationale. Wording is Brendan's ratified choice: "Reply STOP to unsubscribe".
//
// Applied to the manual CRM send (crm-send-message) — a commercial "initiated"
// send per the v2 ruling. Idempotent: a body that already carries opt-out
// wording is left untouched so nothing doubles up.

export const OPT_OUT_FOOTER = "Reply STOP to unsubscribe";

const OPT_OUT_RE = /\bunsubscribe\b|\bopt[\s-]?out\b|(?:reply|text|txt|send)\s+stop\b/i;

export function hasOptOutWording(body: string): boolean {
  return OPT_OUT_RE.test(body || "");
}

export function appendOptOutFooter(body: string): string {
  if (!body) return body;
  if (hasOptOutWording(body)) return body;
  return `${body}\n\n${OPT_OUT_FOOTER}`;
}
