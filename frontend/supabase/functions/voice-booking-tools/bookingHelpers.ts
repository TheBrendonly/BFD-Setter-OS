// Pure helpers for voice-booking-tools, extracted so they are unit-testable
// (the handler file talks to GHL/Twilio and can't be exercised directly).
// Covers three BUG_LIST items handled in the same supervised shared-fn pass:
//   BOOK-2   pickCanonicalSlot  : snap a near-miss HH:MM to the real grid slot
//   BOOK-3   wallClockLocalToEpochMs : read an offset-less ISO in the client tz
//   CANCEL-1 extractApptEvents / realEventIds / activeAppointments : id binding

// ── BOOK-2 ────────────────────────────────────────────────────────────────
// Match the agent's intended wall-clock HH:MM against GHL's own free-slot
// strings. Offset-ignoring is LOAD-BEARING (proven: same slot books with the
// right offset, 400s without), so we only ever read HH:MM. The defect this
// fixes: requiring an EXACT HH:MM match turned a near-miss (e.g. the model
// emits 14:01 for a real 14:00 slot) into a false "unavailable". We snap to the
// nearest real slot within a tight tolerance; anything further stays unmatched
// so a genuinely-absent time still returns real alternatives. NEVER fuzzy-book.
export const SLOT_SNAP_TOLERANCE_MIN = 2;

function hhmmToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function slotHhmm(slot: string): string | null {
  return slot.match(/T(\d{2}:\d{2})/)?.[1] ?? null;
}

// Given the requested wall-clock HH:MM and GHL's slot strings for that day,
// return the canonical GHL slot string to book, or null if none is close enough.
export function pickCanonicalSlot(
  gridSlots: unknown[],
  requestedHhmm: string,
  toleranceMin = SLOT_SNAP_TOLERANCE_MIN,
): string | null {
  const slots = gridSlots.filter((s): s is string => typeof s === "string");
  // Exact wall-clock match first (unchanged, load-bearing behaviour).
  const exact = slots.find((s) => slotHhmm(s) === requestedHhmm);
  if (exact) return exact;
  // Otherwise snap to the nearest slot within tolerance (kills the off-by-a-minute
  // false negative without loosening to a fuzzy match).
  const wantMin = hhmmToMinutes(requestedHhmm);
  if (wantMin == null) return null;
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const s of slots) {
    const sh = slotHhmm(s);
    const sm = sh ? hhmmToMinutes(sh) : null;
    if (sm == null) continue;
    const diff = Math.abs(sm - wantMin);
    if (diff <= toleranceMin && diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

// ── BOOK-3 ────────────────────────────────────────────────────────────────
// The model sends get-available-slots windows as offset-less ISO (setterTools.ts
// tells it to). new Date("2026-07-08T00:00:00") is parsed in the HOST timezone
// (UTC on the edge host), so an Australia/Sydney lead's local midnight lands ~10h
// off and the day can slip. Interpret an offset-less wall clock in the client tz.
export function hasExplicitOffset(iso: string): boolean {
  return /([+-]\d{2}:?\d{2}|Z)$/.test(iso.trim());
}

// ms to add to a wall clock read as if UTC to reach the true UTC instant in `tz`.
export function offsetMsForZone(timeZone: string, epochMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  const asIfUtc = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return asIfUtc - epochMs;
}

// Interpret an offset-less "YYYY-MM-DD(T| )HH:MM(:SS)" as a wall clock in `timeZone`
// and return the true epoch ms. Returns null if the string can't be parsed.
export function wallClockLocalToEpochMs(iso: string, timeZone: string): number | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const guessUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  if (Number.isNaN(guessUtc)) return null;
  return guessUtc - offsetMsForZone(timeZone, guessUtc);
}

// ── CANCEL-1 ────────────────────────────────────────────────────────────────
// GHL /contacts/{id}/appointments/ returns { events: [{ id, startTime, title,
// appointmentStatus, deleted, ... }], traceId }. The model must bind a REAL
// events[].id; nothing stops it inventing one (-> GHL 404). These helpers let the
// cancel/reschedule handlers validate the id server-side and fold the real list back.
export type ApptEvent = {
  id: string;
  startTime?: string;
  title?: string;
  appointmentStatus?: string;
};

export function extractApptEvents(body: unknown): ApptEvent[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  const out: ApptEvent[] = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const ev = e as Record<string, unknown>;
    if (typeof ev.id !== "string" || !ev.id) continue;
    if (ev.deleted === true) continue; // a deleted appt is not a bindable id
    out.push({
      id: ev.id,
      startTime: typeof ev.startTime === "string" ? ev.startTime : undefined,
      title: typeof ev.title === "string" ? ev.title : undefined,
      appointmentStatus: typeof ev.appointmentStatus === "string" ? ev.appointmentStatus : undefined,
    });
  }
  return out;
}

// Every real (non-deleted) appointment id for this contact, the set a cancel /
// reschedule eventId must belong to.
export function realEventIds(events: ApptEvent[]): Set<string> {
  return new Set(events.map((e) => e.id));
}

// The clean list folded back to the model when it passes an unknown id: active
// (non-cancelled) appointments, earliest first, so it picks the one the lead means.
export function activeAppointments(events: ApptEvent[]): ApptEvent[] {
  return events
    .filter((e) => (e.appointmentStatus ?? "").toLowerCase() !== "cancelled")
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}
