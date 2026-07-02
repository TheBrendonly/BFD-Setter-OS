// F13 usage metering — billing-period math (pure, dependency-free).
//
// A client's billing month runs anchor-day to anchor-day in the client's own
// timezone (clients.timezone), end-EXCLUSIVE. Anchor days past the end of a
// short month clamp to that month's last day (31 -> Feb 28/29, Apr 30, ...).
// `offset` browses history: 0 = current period, -1 = previous, clamped -24..0.
// Wall-time -> UTC conversion uses the two-pass Intl offset-correction
// technique (no Date-string parsing) so DST transitions resolve exactly.
// Imported by BOTH the get-client-usage edge fn and the frontend (via the
// lib shim), so keep it dependency-free like computeBlendedRate.ts.

export interface BillingPeriodArgs {
  anchorDay: number;
  timeZone: string;
  offset: number;
  now?: Date;
}

export interface BillingPeriod {
  start_utc: string; // ISO instant, inclusive
  end_utc: string; // ISO instant, exclusive
  label: string; // e.g. "15 Jun 2026 to 14 Jul 2026" (inclusive human range)
  anchor_day: number;
  timezone: string;
  offset: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE_MS = 60_000;

/** Clamp an anchor day to a usable 1..31 integer; anything unusable becomes 1. */
export function sanitizeAnchorDay(value: unknown): number {
  const n = typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(31, Math.max(1, n));
}

function clampOffset(value: unknown): number {
  const n = typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(0, Math.max(-24, n));
}

function daysInMonth(year: number, month1: number): number {
  // Day 0 of the NEXT month = last day of this month.
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

interface ZoneParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

function partsInZone(instant: Date, timeZone: string): ZoneParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) map[part.type] = part.value;
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hh: Number(map.hour),
    mm: Number(map.minute),
  };
}

/** UTC instant of local midnight (y, m, d) in timeZone. Two-pass offset correction. */
function wallTimeToUtc(y: number, m: number, d: number, timeZone: string): Date {
  const targetWall = Date.UTC(y, m - 1, d, 0, 0);
  let guessMs = targetWall;
  // Two passes converge for fixed offsets and DST shifts; a third guards the
  // rare gap where local midnight does not exist (we land on the shifted time).
  for (let i = 0; i < 3; i++) {
    const p = partsInZone(new Date(guessMs), timeZone);
    const actualWall = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const diffMs = targetWall - actualWall;
    if (diffMs === 0) break;
    guessMs += Math.round(diffMs / MINUTE_MS) * MINUTE_MS;
  }
  return new Date(guessMs);
}

export function computeBillingPeriod(args: BillingPeriodArgs): BillingPeriod {
  const anchor = sanitizeAnchorDay(args.anchorDay);
  const offset = clampOffset(args.offset);
  const timeZone = args.timeZone || "Australia/Sydney";
  const now = args.now ?? new Date();

  const today = partsInZone(now, timeZone);
  const effToday = Math.min(anchor, daysInMonth(today.y, today.m));

  // Month index (year*12 + month0) of the requested period's START month.
  let monthIndex = today.y * 12 + (today.m - 1);
  if (today.d < effToday) monthIndex -= 1;
  monthIndex += offset;

  const startY = Math.floor(monthIndex / 12);
  const startM = ((monthIndex % 12) + 12) % 12 + 1;
  const startD = Math.min(anchor, daysInMonth(startY, startM));
  const endIndex = monthIndex + 1;
  const endY = Math.floor(endIndex / 12);
  const endM = ((endIndex % 12) + 12) % 12 + 1;
  const endD = Math.min(anchor, daysInMonth(endY, endM));

  const start = wallTimeToUtc(startY, startM, startD, timeZone);
  const end = wallTimeToUtc(endY, endM, endD, timeZone);

  // Human label ends on the day BEFORE the exclusive end boundary.
  let lastY = endY;
  let lastM = endM;
  let lastD = endD - 1;
  if (lastD < 1) {
    lastM -= 1;
    if (lastM < 1) {
      lastM = 12;
      lastY -= 1;
    }
    lastD = daysInMonth(lastY, lastM);
  }
  const label =
    `${startD} ${MONTHS[startM - 1]} ${startY} to ${lastD} ${MONTHS[lastM - 1]} ${lastY}`;

  return {
    start_utc: start.toISOString(),
    end_utc: end.toISOString(),
    label,
    anchor_day: anchor,
    timezone: timeZone,
    offset,
  };
}
