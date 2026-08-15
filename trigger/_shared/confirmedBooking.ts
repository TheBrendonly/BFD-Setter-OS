// A lead who has already BOOKED must not be chased by the follow-up engines.
//
// Both nudgeColdReply (cold-reply nudges) and sendFollowup (setter follow-up
// timers) gate on leads flags (setter_stopped / awaiting_reply). None of those
// are set by a booking, and the SMS booking-confirmation reply re-stamps
// awaiting_reply=true right after book-appointments runs — so gating on
// awaiting_reply alone can never suppress a booked lead. The authoritative,
// ordering-proof signal is a CONFIRMED, still-upcoming row in `bookings`.
//
// We deliberately do NOT set setter_stopped on booking: that carries STOP /
// opt-out semantics and would block the AI from replying if the booked lead
// texts back to reschedule. A bookings check keeps the booked lead conversational
// while stopping the unsolicited chase.
//
// bookings.lead_id (text) is the GHL contactId, matching leads.lead_id.

// Fail-open rationale: on a bookings query error we return "not booked" (chase
// proceeds) rather than suppressing. A missed suppression is at worst one
// unsolicited nudge (bad UX, not a compliance breach); failing closed would let
// a bookings outage silently halt ALL nudges/follow-ups. Opt-out/compliance
// gating is handled separately by the callers and is unaffected.

export function bookedKey(clientId: string, leadId: string): string {
  return `${clientId}|${leadId}`;
}

// Batch: of these leadIds, which (client_id|lead_id) have an upcoming confirmed
// booking. One query for the whole candidate set.
export async function fetchUpcomingBookedKeys(
  supabase: any,
  leadIds: string[],
  nowIso: string = new Date().toISOString(),
): Promise<Set<string>> {
  const ids = Array.from(new Set(leadIds.filter(Boolean)));
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("bookings")
    .select("client_id, lead_id")
    .eq("status", "confirmed")
    .gt("appointment_time", nowIso)
    .in("lead_id", ids);
  if (error) {
    console.warn("confirmedBooking: fetchUpcomingBookedKeys failed (fail-open):", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((b: any) => bookedKey(b.client_id, b.lead_id)));
}

// Single lead: does it have an upcoming confirmed booking?
export async function hasUpcomingConfirmedBooking(
  supabase: any,
  clientId: string,
  leadId: string,
  nowIso: string = new Date().toISOString(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from("bookings")
    .select("lead_id")
    .eq("client_id", clientId)
    .eq("lead_id", leadId)
    .eq("status", "confirmed")
    .gt("appointment_time", nowIso)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("confirmedBooking: hasUpcomingConfirmedBooking failed (fail-open):", error.message);
    return false;
  }
  return !!data;
}
