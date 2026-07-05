// CANCEL-1: bind cancel/reschedule to real, listed appointment ids (the SMS-path
// mirror of slotBinding). The incident: on "cancel that meeting" the model called
// cancel-appointments with a fabricated eventId (matching nothing GHL returned) ->
// GHL 404 -> the cancel silently failed. The engine keeps the set of every real
// appointment id it has shown the model this turn (from get-contact-appointments
// results) and validates cancel-appointments / update-appointment against it BEFORE
// execution: an unknown id is refused with the real ids folded back, and if no
// appointments have been listed this turn the model is told to list first.
//
// This is defence-in-depth for the SMS/native-text engine (voice-booking-tools does
// the same check server-side, covering the Voice path too). It never REWRITES args;
// it only validates, so it composes cleanly after slotBinding.

export type EventIdSet = Set<string>;

// Fold a get-contact-appointments result ({ events: [{ id, ... }] }) into the set.
// Returns how many ids were added. Tolerant of junk shapes.
export function mergeEventIds(set: EventIdSet, result: unknown): number {
  const events = (result as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return 0;
  let added = 0;
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const ev = e as Record<string, unknown>;
    if (ev.deleted === true) continue;
    if (typeof ev.id === "string" && ev.id && !set.has(ev.id)) {
      set.add(ev.id);
      added++;
    }
  }
  return added;
}

export type EventIdValidation =
  | { ok: true; args?: Record<string, unknown> }
  | { ok: false; error: string; result: unknown };

// cancel-appointment(s) + update-appointment are gated (the two that mutate an
// existing appointment by id). book-appointments is NOT here (no prior id).
const GATED_TOOLS = new Set([
  "cancel-appointments",
  "cancel-appointment",
  "update-appointment",
]);

function eventIdFrom(args: Record<string, unknown>): string | null {
  if (typeof args.eventId === "string" && args.eventId) return args.eventId;
  if (typeof args.appointmentId === "string" && args.appointmentId) return args.appointmentId;
  return null;
}

export function validateEventIdArgs(
  set: EventIdSet,
  name: string,
  args: Record<string, unknown>,
): EventIdValidation {
  if (!GATED_TOOLS.has(name)) return { ok: true };

  const requested = eventIdFrom(args);

  if (set.size === 0) {
    // No appointments listed this turn: refuse to act on a remembered/guessed id
    // rather than trust it. Mirrors slotBinding's "availability_unknown".
    return {
      ok: false,
      error: "no appointments listed this turn",
      result: {
        status: "appointments_unknown",
        note: "No appointments are loaded this turn. Call get-contact-appointments first, then cancel/reschedule using the exact events[].id it returns.",
      },
    };
  }

  if (requested && set.has(requested)) return { ok: true };

  return {
    ok: false,
    error: `eventId ${String(requested ?? "(none)")} is not a listed appointment`,
    result: {
      status: "event_not_found",
      requested: requested ?? null,
      known_event_ids: [...set],
      note: "That id is not one of this contact's appointments. Use one of known_event_ids (from get-contact-appointments); never invent an id.",
    },
  };
}
