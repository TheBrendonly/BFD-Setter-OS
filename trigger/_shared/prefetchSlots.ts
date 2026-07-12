// BOOK-1 — Text-setter availability prefetch (mirrors the Voice setter, read-only).
//
// The Voice setter prefetches GHL free-slots (make-retell-outbound-call:fetchGhlFreeSlots)
// and injects compacted open times into a dynamic var so the model sees ground truth
// before it speaks. The Text setter had no such prefetch, so a weak model fabricated
// "booked out" against an OPEN calendar (BOOK-1).
//
// This mirrors that mechanism without touching the shared, frozen, zero-test
// voice-booking-tools fn: it calls the SAME get-available-slots tool (over the existing
// callTool closure), compacts the result exactly like Voice's compactSlots, and builds a
// ground-truth block injected into the system context every reply.
//
// BOOK-3 avoidance: the window is passed as EPOCH-MS (startDate/endDate). The shared
// handler's toMs() returns a numeric string as-is, so we never hand it an offset-less ISO
// (which it would mis-parse as UTC and skew an AU lead's day). This is exactly how Voice
// queries free-slots (windowStart.getTime()).

import type { CallTool, ToolInvocation } from "./setterToolLoop.ts";
import { formatSlotInZone, isValidTimeZone, zoneShortLabel } from "./leadTimezone.ts";

export const PREFETCH_WINDOW_DAYS = 14;
// Cap the injected block so a busy calendar can't blow up the system context.
const MAX_BLOCK_DAYS = 10;

export type PrefetchStatus = "ok" | "empty" | "error";

export type PrefetchResult = {
  status: PrefetchStatus;
  timezone: string | null;
  windowDays: number;
  slots: Record<string, string[]>;
  invocation: ToolInvocation;
};

// Mirror of make-retell-outbound-call:compactSlots — raw GHL { "YYYY-MM-DD": { slots:
// [ISO...] }, traceId } -> { "YYYY-MM-DD": ["HH:MM", ...] }. Pure; tolerant of junk.
export function compactSlots(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue; // skip traceId and other noise
    const slots = (val as { slots?: unknown } | null)?.slots;
    if (!Array.isArray(slots)) continue;
    out[key] = slots.map((s) => {
      if (typeof s !== "string") return String(s);
      const m = s.match(/T(\d{2}:\d{2})/); // local HH:MM from the ISO timestamp
      return m ? m[1] : s;
    });
  }
  return out;
}

// BOOK-TZ-DISPLAY-1 — deterministic business-tz -> lead-tz label map, computed from the
// raw GHL ISO slots (which carry the business offset) via formatSlotInZone. Shape:
// { "YYYY-MM-DD": { "HH:MM"(business 24h) : "h:mm am"(lead-local) } }. The model reads
// this table instead of doing (unreliable, weak-model) timezone arithmetic itself.
export function leadZoneLabels(
  raw: unknown,
  leadZone: string,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue; // skip traceId and other noise
    const slots = (val as { slots?: unknown } | null)?.slots;
    if (!Array.isArray(slots)) continue;
    const dayMap: Record<string, string> = {};
    for (const s of slots) {
      if (typeof s !== "string") continue;
      const m = s.match(/T(\d{2}:\d{2})/); // business-tz HH:MM (matches compactSlots)
      if (!m) continue;
      const inZone = formatSlotInZone(s, leadZone);
      if (inZone) dayMap[m[1]] = inZone.label;
    }
    if (Object.keys(dayMap).length) out[key] = dayMap;
  }
  return out;
}

export async function prefetchAvailability(args: {
  callTool: CallTool;
  timeZone?: string | null;
  nowMs: number;
  windowDays?: number;
}): Promise<PrefetchResult> {
  const windowDays = args.windowDays ?? PREFETCH_WINDOW_DAYS;
  const timezone = args.timeZone ?? null;
  const startMs = args.nowMs;
  const endMs = args.nowMs + windowDays * 86400000;

  // EPOCH-MS window (not ISO) so the shared handler's toMs() passes it through unchanged.
  const toolArgs: Record<string, unknown> = {
    startDate: String(startMs),
    endDate: String(endMs),
  };
  if (timezone) toolArgs.timeZone = timezone;

  try {
    const result = await args.callTool("get-available-slots", toolArgs);
    const slots = compactSlots(result);
    const status: PrefetchStatus = Object.keys(slots).length > 0 ? "ok" : "empty";
    return {
      status,
      timezone,
      windowDays,
      slots,
      invocation: { name: "get-available-slots", args: toolArgs, result },
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    return {
      status: "error",
      timezone,
      windowDays,
      slots: {},
      invocation: { name: "get-available-slots", args: toolArgs, error: message },
    };
  }
}

// The ground-truth block injected into the system context. The wording is the
// anti-fabrication guard: with the real open times in front of it, a weak model may
// not claim a listed time is "booked out" / unavailable (the BOOK-1 failure mode).
//
// channel 'reply' (default) is the live tool-loop path and its wording is frozen
// (the X-Ray mirror byte-tests it). channel 'followup' is for sendFollowup, which
// has NO tool loop and a strict-JSON output contract — same data + fabrication
// guards, but zero tool instructions (telling that model to "call
// get-available-slots" invites tool-shaped output that fails the JSON parse).
export function buildAvailabilityBlock(
  result: PrefetchResult,
  opts?: { channel?: "reply" | "followup"; leadZone?: string | null }
): string {
  const followup = opts?.channel === "followup";
  // The single timezone the whole flow runs in is the BUSINESS/calendar timezone
  // (clients.timezone), NOT the lead's — never label it "the lead's timezone".
  const tz = result.timezone || "the business timezone";

  if (result.status === "ok") {
    const dates = Object.keys(result.slots).sort().slice(0, MAX_BLOCK_DAYS);
    const trimmed: Record<string, string[]> = {};
    for (const d of dates) trimmed[d] = result.slots[d];
    const more = Object.keys(result.slots).length > dates.length
      ? (followup
        ? " (further dates exist beyond this window)"
        : " (further dates available — call get-available-slots for a later window if asked)")
      : "";
    // BOOK-TZ-DISPLAY-1 — when the lead sits in a valid, DIFFERENT timezone, hand the
    // model a deterministic business->lead conversion table so it states both zones
    // without doing the timezone math (weak model, gets it wrong). Booking is unaffected:
    // the model still books the business-tz HH:MM from the map above. Conditional +
    // additive, so the default (same-zone) block is byte-unchanged.
    const leadZone = opts?.leadZone ?? null;
    let leadZoneLines: string[] = [];
    if (leadZone && isValidTimeZone(leadZone) && leadZone !== result.timezone) {
      const conv = leadZoneLabels(result.invocation.result, leadZone);
      const convTrimmed: Record<string, Record<string, string>> = {};
      for (const d of dates) if (conv[d]) convTrimmed[d] = conv[d];
      if (Object.keys(convTrimmed).length) {
        const leadShort = zoneShortLabel(leadZone);
        leadZoneLines = [
          `- STATING TIMES TO THE LEAD (they are in ${leadShort}, not ${tz}): whenever you OFFER or ` +
          `CONFIRM a time, give BOTH the ${tz} time and the lead's local time. Take the lead's local time ` +
          `EXACTLY from this table — never compute a timezone yourself: ${JSON.stringify(convTrimmed)} ` +
          `(date -> { "business HH:MM": "the lead's local time" }). Still BOOK the ${tz} HH:MM exactly as listed above.`,
        ];
      }
    }
    return [
      "## Live calendar availability (ground truth — already fetched for you this turn)",
      `Timezone: ${tz}. This is the COMPLETE set of real open appointment start times for about the next ${result.windowDays} days, as a map of date -> open times (24h HH:MM):`,
      JSON.stringify(trimmed) + more,
      "Rules for using it:",
      "- Offer ONLY times that appear in this map. Never invent, guess, or round a time.",
      `- NEVER tell the lead a time is "booked out", "full", "snapped up", or unavailable if it appears in this map — it is genuinely open.`,
      "- If the time the lead wants is NOT in this map, say it isn't open and offer the nearest listed alternatives.",
      ...(followup
        ? [
          "- You are drafting a one-way follow-up message: you CANNOT book anything or check other windows from here. If you mention times, mention ONLY times from this map.",
          "- This snapshot is current for this follow-up; no re-checking is possible.",
        ]
        : [
          "- To BOOK a chosen time: call book-appointments with startDateTime as the slot's date and time joined EXACTLY as listed, format YYYY-MM-DDTHH:MM (e.g. 2026-07-06T11:00). Copy the date and time verbatim from this map; never convert timezones or compute a datetime yourself.",
          "- This snapshot is current; you do not need to re-check before offering. Only call get-available-slots again if the lead asks about a date beyond this window.",
        ]),
      ...leadZoneLines,
    ].join("\n");
  }

  if (result.status === "empty") {
    return [
      "## Live calendar availability (ground truth — already fetched for you this turn)",
      `The calendar returned NO open times in the next ${result.windowDays} days (timezone ${tz}).`,
      ...(followup
        ? [
          "- Do NOT invent or name any specific time in this follow-up. You cannot re-check the calendar from here — invite the lead to share what suits them instead.",
          "- Never tell the lead a specific time is unavailable; say the near-term calendar looks full.",
        ]
        : [
          "- Do NOT invent times. If the lead wants to book, call get-available-slots for a different window, or let them know you'll check and follow up.",
          `- Never tell the lead a specific time is unavailable without checking — say the near-term calendar looks full and offer to look further out.`,
        ]),
    ].join("\n");
  }

  // status === "error"
  if (followup) {
    return [
      "## Live calendar availability",
      "(Could not pre-fetch availability for this follow-up.)",
      "- You have NO availability data: do NOT name, offer, or rule out any specific time in this message.",
      "- Never claim a time is open, unavailable, or booked out.",
    ].join("\n");
  }
  return [
    "## Live calendar availability",
    "(Could not pre-fetch availability this turn.)",
    "- Before offering OR ruling out any time, call get-available-slots and use only what it returns.",
    "- Never claim a time is unavailable or booked out without checking the calendar first.",
  ].join("\n");
}
