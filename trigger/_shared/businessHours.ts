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
  return { start, end, tz, days };
}
