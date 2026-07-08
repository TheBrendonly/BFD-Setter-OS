// Shared business-hours logic: the single source of truth for "may a
// setter-initiated message or dial go out right now?". Extracted verbatim from
// runEngagement.ts (HOURS-1) so runEngagement, sendFollowup and nudgeColdReply
// all share ONE implementation instead of three divergent copies. Pure and
// dependency-free (no Trigger.dev imports) so it unit-tests cleanly and both the
// cadence engine and the follow-up tasks can import it.
//
// NAMING NOTE: the historical name "quiet hours" is inverted: the config
// describes the ALLOWED sending window (start..end on `days`), so
// isWithinQuietHoursWindow(now) === true means "OK to send right now". Names are
// kept as-is to minimise churn across the three callers.
//
// F17 phase 1 layers an AU Telemarketing-Standard legal clamp on TOP of this
// module (see the AU_* / *SendingWindow exports added there); the client's
// cadence_quiet_hours config remains the base window.
//
// clients.cadence_quiet_hours jsonb shape (per Docs/CADENCE_DESIGN.md):
//   { "start": "09:00", "end": "21:00", "tz": "Australia/Brisbane",
//     "days": [1,2,3,4,5] }   // 1=Mon ... 7=Sun

import { isValidTimeZone } from "./leadTimezone.ts";

export type QuietHoursConfig = {
  start: string; // HH:MM
  end: string;   // HH:MM
  tz: string;    // IANA
  days: number[]; // 1..7
};

export const DEFAULT_QUIET_HOURS: QuietHoursConfig = {
  start: "09:00",
  end: "21:00",
  tz: "Australia/Brisbane",
  days: [1, 2, 3, 4, 5, 6, 7],
};

const PHONE_TZ_PREFIX_MAP: Record<string, string> = {
  "+61": "Australia/Brisbane",
  "+1":  "America/New_York",
  "+44": "Europe/London",
  "+64": "Pacific/Auckland",
  "+353": "Europe/Dublin",
  "+27": "Africa/Johannesburg",
};

export function resolveLeadTimezone(phone: string | undefined, clientDefaultTz: string): string {
  if (!phone) return clientDefaultTz;
  // Sort prefixes by length descending so +353 wins over +1
  const prefixes = Object.keys(PHONE_TZ_PREFIX_MAP).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (phone.startsWith(prefix)) return PHONE_TZ_PREFIX_MAP[prefix];
  }
  return clientDefaultTz;
}

export function isWithinQuietHoursWindow(now: Date, qh: QuietHoursConfig, tz: string): boolean {
  const localStr = now.toLocaleString("en-US", { timeZone: tz });
  const local = new Date(localStr);
  // 1=Mon..7=Sun
  const dayJs = local.getDay();
  const day = dayJs === 0 ? 7 : dayJs;
  if (!qh.days.includes(day)) return false;
  const cur = local.toTimeString().slice(0, 5);
  const overnight = qh.start > qh.end;
  if (overnight) return cur >= qh.start || cur <= qh.end;
  return cur >= qh.start && cur <= qh.end;
}

// Step forward in 5-minute increments to keep the loop cheap; max 14 days
export function getNextQuietHoursStart(now: Date, qh: QuietHoursConfig, tz: string): Date {
  if (isWithinQuietHoursWindow(now, qh, tz)) return now;
  let probe = new Date(now);
  const stepMs = 5 * 60_000;
  const maxIters = (14 * 24 * 60) / 5;
  for (let i = 0; i < maxIters; i++) {
    probe = new Date(probe.getTime() + stepMs);
    if (isWithinQuietHoursWindow(probe, qh, tz)) return probe;
  }
  // 14d soft cap: return now to avoid forever-park
  return now;
}

export function parseQuietHours(raw: unknown): QuietHoursConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const start = typeof r.start === "string" ? r.start : null;
  const end = typeof r.end === "string" ? r.end : null;
  const tz = typeof r.tz === "string" ? r.tz : null;
  const days = Array.isArray(r.days) ? r.days.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7) : null;
  if (!start || !end || !tz || !days || days.length === 0) return null;
  // QH-TZ-1: an invalid IANA `tz` throws RangeError in isWithinQuietHoursWindow / the AU clamp on every
  // send, stalling the whole cadence. Fall back to the default zone instead of poisoning the config.
  const safeTz = isValidTimeZone(tz) ? tz : DEFAULT_QUIET_HOURS.tz;
  if (safeTz !== tz) console.warn(`parseQuietHours: invalid tz "${tz}", falling back to ${safeTz}`);
  return { start, end, tz: safeTz, days };
}

// ── F17 phase 1: AU Telemarketing Standard calling-hours clamp ──────────────
// Layered ON TOP of the client's cadence_quiet_hours: weekdays 09:00-20:00,
// Saturday 09:00-17:00, no Sunday, no national public holiday. Applied only when
// the resolved timezone is Australian (a no-op elsewhere), so a lead in another
// tz keeps the client-config window unchanged. The effective sending window is
// the INTERSECTION of the client window and this legal window.

// 1=Mon..7=Sun. null = no telemarketing that day.
export const AU_LEGAL_WINDOWS: Record<number, { start: string; end: string } | null> = {
  1: { start: "09:00", end: "20:00" },
  2: { start: "09:00", end: "20:00" },
  3: { start: "09:00", end: "20:00" },
  4: { start: "09:00", end: "20:00" },
  5: { start: "09:00", end: "20:00" },
  6: { start: "09:00", end: "17:00" }, // Saturday
  7: null, // Sunday
};

// National AU public holidays (YYYY-MM-DD), incl. common observed substitutes.
// State-specific holidays + an annual refresh are a later refinement; these are
// the nation-wide prohibited telemarketing days. REVIEW ANNUALLY.
export const AU_PUBLIC_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-26", "2026-04-03", "2026-04-06", "2026-04-25",
  "2026-12-25", "2026-12-26", "2026-12-28",
  // 2027
  "2027-01-01", "2027-01-26", "2027-03-26", "2027-03-29", "2027-04-25",
  "2027-04-26", "2027-12-25", "2027-12-27", "2027-12-28",
]);

export function isAuTimezone(tz: string): boolean {
  return typeof tz === "string" && tz.startsWith("Australia/");
}

// tz-local date (YYYY-MM-DD), ISO weekday (1=Mon..7=Sun) and HH:MM, via Intl.
function localCalendarParts(now: Date, tz: string): { dateStr: string; day: number; hhmm: string } {
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const day = dayMap[wd] ?? 1;
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
  return { dateStr, day, hhmm };
}

// True when `now` falls inside the AU legal calling window for its tz-local day
// (and it is not a public holiday / Sunday).
export function isWithinAuLegalWindow(now: Date, tz: string): boolean {
  const { dateStr, day, hhmm } = localCalendarParts(now, tz);
  if (AU_PUBLIC_HOLIDAYS.has(dateStr)) return false;
  const win = AU_LEGAL_WINDOWS[day];
  if (!win) return false; // Sunday
  return hhmm >= win.start && hhmm <= win.end;
}

// The effective "may we send/dial now?" check: the client window AND (for AU
// timezones) the AU legal window. This is what every cadence send + voice dial
// should gate on (HOURS-1 gave the client-window base; F17 adds the legal clamp).
export function isWithinSendingWindow(now: Date, qh: QuietHoursConfig, tz: string): boolean {
  if (!isWithinQuietHoursWindow(now, qh, tz)) return false;
  if (isAuTimezone(tz) && !isWithinAuLegalWindow(now, tz)) return false;
  return true;
}

// Next instant at which isWithinSendingWindow is true (5-min step, 21-day cap so
// a run of holidays can't overshoot). Returns `now` if already inside.
export function getNextSendingOpening(now: Date, qh: QuietHoursConfig, tz: string): Date {
  if (isWithinSendingWindow(now, qh, tz)) return now;
  let probe = new Date(now);
  const stepMs = 5 * 60_000;
  const maxIters = (21 * 24 * 60) / 5;
  for (let i = 0; i < maxIters; i++) {
    probe = new Date(probe.getTime() + stepMs);
    if (isWithinSendingWindow(probe, qh, tz)) return probe;
  }
  return now; // 21-day soft cap
}
