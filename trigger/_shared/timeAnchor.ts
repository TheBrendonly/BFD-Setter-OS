// PROMPT-AUTH-1 — real current-time anchor injected into the Text-setter system
// context every turn.
//
// Root cause being fixed: the stored client prompt's only "current time" reference
// was a literal, un-interpolated n8n token ({{ $now }}), so the model had no real
// "today" and resolved relative days ("this Thursday") to arbitrary absolute dates
// (on 2026-07-03 it booked Friday 4pm for an accepted "Thursday 2pm"). This block is
// generated at assembly time from the engine's own clock + clients.timezone, so it
// can never go stale and requires no client-prompt edit.
//
// All date arithmetic here is calendar arithmetic on the tz-local date tuple using
// Date.UTC (no DST), so anchors never skate across a daylight-saving transition.

type LocalStamp = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: string; // "14"
  minute: string; // "20"
  offset: string; // "+10:00"
  weekday: string; // "Friday"
  monthName: string; // "July"
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Business default timezone. BFD operates in AU; the live client is Australia/Sydney.
// Falling back here (rather than UTC) keeps the current-time anchor, the GHL
// availability query, and the booking identity resolving a null/invalid
// client.timezone to the SAME zone — a mismatch re-introduces the off-by-one-day
// booking bug this anchor exists to kill.
export const DEFAULT_TIMEZONE = "Australia/Sydney";

// Resolve a client's stored timezone to a VALID IANA name (or the business
// default). Exported so callers can resolve ONCE and pass the same value to the
// anchor, the availability prefetch, and the tool identity.
export function resolveClientTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function localStamp(nowMs: number, timeZone: string): LocalStamp {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(nowMs));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // "GMT+10:00" -> "+10:00"; plain "GMT" (UTC) -> "+00:00".
  const rawOffset = get("timeZoneName").replace("GMT", "").replace("UTC", "");
  const offset = /^[+-]\d{2}:\d{2}$/.test(rawOffset) ? rawOffset : "+00:00";
  // Intl can emit hour "24" for midnight with hour12:false — normalize to "00".
  const hour = get("hour") === "24" ? "00" : get("hour");

  const monthNum = Number(get("month"));
  const monthName = new Intl.DateTimeFormat("en-US", { timeZone, month: "long" })
    .format(new Date(nowMs));

  return {
    year: Number(get("year")),
    month: monthNum,
    day: Number(get("day")),
    hour,
    minute: get("minute"),
    offset,
    weekday: get("weekday"),
    monthName,
  };
}

// Calendar-add on a date tuple via Date.UTC — immune to DST because UTC has none.
function addDays(year: number, month: number, day: number, n: number): { year: number; month: number; day: number; weekday: string } {
  const d = new Date(Date.UTC(year, month - 1, day) + n * 86400000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: WEEKDAYS[d.getUTCDay()],
  };
}

function ymd(t: { year: number; month: number; day: number }): string {
  const mm = String(t.month).padStart(2, "0");
  const dd = String(t.day).padStart(2, "0");
  return `${t.year}-${mm}-${dd}`;
}

export function buildTimeAnchorBlock(timeZone: string | null | undefined, nowMs: number): string {
  const tz = resolveClientTimeZone(timeZone);
  const now = localStamp(nowMs, tz);
  const todayYmd = ymd(now);
  const isoLocal = `${todayYmd}T${now.hour}:${now.minute}${now.offset}`;

  const tomorrow = addDays(now.year, now.month, now.day, 1);
  const thisWeek: string[] = [];
  const nextWeek: string[] = [];
  for (let i = 1; i <= 13; i++) {
    const d = addDays(now.year, now.month, now.day, i);
    const line = `${i <= 6 ? "this" : "next"} ${d.weekday} = ${ymd(d)}`;
    (i <= 6 ? thisWeek : nextWeek).push(line);
  }

  return [
    "## Current date & time (ground truth)",
    `Today is ${now.weekday}, ${now.day} ${now.monthName} ${now.year}, ${now.hour}:${now.minute} in ${tz} (${isoLocal}).`,
    `Tomorrow = ${tomorrow.weekday} ${ymd(tomorrow)}.`,
    `Day anchors: ${thisWeek.join(", ")}; ${nextWeek.join(", ")}.`,
    `Resolve EVERY relative day ("today", "tomorrow", "this Thursday") from these anchors. Never guess or compute a date yourself.`,
    `If anything earlier in this prompt states a different "current time" (for example a literal {{ $now }} token), IGNORE it: it is stale template residue.`,
  ].join("\n");
}
