// _shared/parseCallbackTime.ts
//
// Turn a free-text callback request ("call me this afternoon", "tomorrow at 3pm",
// "later", "in an hour") into an absolute UTC timestamp, interpreted in the
// client's timezone and clamped into business hours. Heuristic + safe fallback;
// the agent should also emit a structured ISO time when it can (preferred).

const BUSINESS_START_H = 9;   // earliest callback hour (local)
const BUSINESS_END_H = 18;    // latest callback hour (local)
const DEFAULT_MORNING_H = 10;
const DEFAULT_AFTERNOON_H = 14;
const DEFAULT_EVENING_H = 17;

// Offset (ms) to add to a UTC instant to get wall-clock time in `tz`.
function zoneOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }
  const asUtc = Date.UTC(p.year, (p.month ?? 1) - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

// Build a UTC Date from a desired local wall-clock time in `tz`.
function zonedWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  // Adjust twice to converge across DST-ish boundaries.
  let utc = new Date(guess.getTime() - zoneOffsetMs(guess, tz));
  utc = new Date(Date.UTC(y, mo - 1, d, h, mi, 0) - zoneOffsetMs(utc, tz));
  return utc;
}

function localParts(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute };
}

function clampHour(h: number): number {
  if (h < BUSINESS_START_H) return BUSINESS_START_H;
  if (h >= BUSINESS_END_H) return BUSINESS_END_H - 1;
  return h;
}

export interface ParsedCallback {
  scheduledFor: string;   // ISO UTC
  reason: string;         // normalized description
}

/**
 * @param intent free text from the lead/agent (e.g. "tomorrow afternoon", "3pm")
 * @param now current instant
 * @param tz IANA timezone (client's)
 */
export function parseCallbackTime(intent: string, now: Date, tz: string): ParsedCallback {
  const text = (intent || "").toLowerCase().trim();
  const cur = localParts(now, tz);
  let dayOffset = 0;
  let hour: number | null = null;
  let reason = text || "callback requested";

  if (/\btomorrow\b/.test(text)) dayOffset = 1;
  if (/\b(next week)\b/.test(text)) dayOffset = 7;

  // explicit clock time: "3pm", "3 pm", "at 3", "15:30"
  const ampm = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const h24 = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (ampm) {
    hour = parseInt(ampm[1], 10) % 12 + (ampm[3] === "pm" ? 12 : 0);
  } else if (h24) {
    hour = parseInt(h24[1], 10);
  } else if (/\bmorning\b/.test(text)) {
    hour = DEFAULT_MORNING_H;
  } else if (/\b(afternoon|arvo)\b/.test(text)) {
    hour = DEFAULT_AFTERNOON_H;
  } else if (/\b(evening|tonight)\b/.test(text)) {
    hour = DEFAULT_EVENING_H;
  } else if (/\b(in an hour|hour|shortly|bit later|a bit)\b/.test(text)) {
    // relative short delay from now
    const t = new Date(now.getTime() + 60 * 60 * 1000);
    const lp = localParts(t, tz);
    const clamped = clampHour(lp.h);
    return { scheduledFor: zonedWallClockToUtc(lp.y, lp.mo, lp.d, clamped, clamped === lp.h ? lp.mi : 0, tz).toISOString(), reason };
  }

  if (hour === null) {
    // "call me back later" with no time → +2h, clamped to business hours.
    const t = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const lp = localParts(t, tz);
    return { scheduledFor: zonedWallClockToUtc(lp.y, lp.mo, lp.d, clampHour(lp.h), 0, tz).toISOString(), reason: reason || "later" };
  }

  // build target local date
  let y = cur.y, mo = cur.mo, d = cur.d + dayOffset;
  hour = clampHour(hour);
  // if same-day and the target hour has already passed, push to tomorrow
  if (dayOffset === 0 && hour <= cur.h) { d += 1; }
  // normalize day overflow via Date
  const norm = new Date(Date.UTC(y, mo - 1, d));
  y = norm.getUTCFullYear(); mo = norm.getUTCMonth() + 1; d = norm.getUTCDate();

  return { scheduledFor: zonedWallClockToUtc(y, mo, d, hour, 0, tz).toISOString(), reason };
}
