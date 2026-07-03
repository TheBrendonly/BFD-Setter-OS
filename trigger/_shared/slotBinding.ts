// PROMPT-AUTH-1 — bind bookings to real, listed calendar slots.
//
// Incident being fixed: the model re-derived an accepted "Thursday 2pm" into
// Friday's ISO datetime and voice-booking-tools happily booked it. The fix: the
// engine keeps a canonical map of every open slot it has shown the model this turn
// (from the BOOK-1 prefetch plus any mid-loop get-available-slots calls), and
// book-appointments / update-appointment are validated against that map BEFORE
// execution. On a hit the argument is REWRITTEN to the exact ISO string GHL
// returned (so the frozen shared fn's wall-clock grid match always succeeds); on a
// miss the call is refused and the real open times are folded back so the model
// re-offers instead of mis-booking.
//
// Matching is deliberately WALL-CLOCK LITERAL (date + HH:MM as written), the same
// doctrine as voice-booking-tools' live-proven resolveCanonicalSlot: we never parse
// the model's string with new Date(), so a wrong/missing offset can't shift the day
// (the BOOK-3 failure class).

// "YYYY-MM-DDTHH:MM" (tz-local wall clock) -> canonical GHL ISO slot string.
export type CanonicalSlotMap = Map<string, string>;

const KEY_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

// Extract the wall-clock key from any ISO-ish datetime string, without Date parsing.
export function slotKeyFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(KEY_RE);
  return m ? `${m[1]}T${m[2]}` : null;
}

// Fold a raw get-available-slots result ({ "YYYY-MM-DD": { slots: [ISO...] } }) into
// the canonical map. Tolerant of junk; returns how many slots were added.
export function mergeCanonicalSlots(map: CanonicalSlotMap, raw: unknown): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  let added = 0;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue; // skip traceId and other noise
    const slots = (val as { slots?: unknown } | null)?.slots;
    if (!Array.isArray(slots)) continue;
    for (const s of slots) {
      const k = slotKeyFrom(s);
      if (k && !map.has(k)) {
        map.set(k, s as string);
        added++;
      }
    }
  }
  return added;
}

// Compact date -> ["HH:MM", ...] view of the map, for folding real alternatives
// back to the model on a refused booking.
export function availableTimesByDate(map: CanonicalSlotMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of [...map.keys()].sort()) {
    const [date, time] = key.split("T");
    (out[date] ??= []).push(time);
  }
  return out;
}

export type ToolArgsValidation =
  | { ok: true; args?: Record<string, unknown> }
  | { ok: false; error: string; result: unknown };

const GATED_TOOLS = new Set(["book-appointments", "update-appointment"]);

// Validate (and canonicalize) the startDateTime of a booking/reschedule call.
// Everything else passes through untouched.
export function validateBookingArgs(
  map: CanonicalSlotMap,
  name: string,
  args: Record<string, unknown>,
): ToolArgsValidation {
  if (!GATED_TOOLS.has(name)) return { ok: true };

  const requestedKey = slotKeyFrom(args.startDateTime);

  if (map.size === 0) {
    // No availability data seen this turn (prefetch errored and no mid-loop fetch):
    // refuse to book blind rather than trust a model-constructed datetime.
    return {
      ok: false,
      error: "no availability data this turn",
      result: {
        booked: false,
        status: "availability_unknown",
        note: "No calendar data is loaded this turn. Call get-available-slots first, then book one of the times it returns.",
      },
    };
  }

  if (requestedKey && map.has(requestedKey)) {
    // Rewrite to the exact ISO string GHL returned for this slot.
    return { ok: true, args: { startDateTime: map.get(requestedKey)! } };
  }

  return {
    ok: false,
    error: `requested time ${String(args.startDateTime ?? "(none)")} is not a listed open slot`,
    result: {
      booked: false,
      status: "slot_unavailable",
      requested: args.startDateTime ?? null,
      available_slots: availableTimesByDate(map),
      note: "That exact time is not on the open-slot list. Offer the lead only times from available_slots and ask them to pick one.",
    },
  };
}
