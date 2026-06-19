/**
 * Resolves the booking `source` to stamp on a tool-created booking.
 *
 * The voice agent (and Retell) never send a `source`, so the historical
 * "voice_call" default is preserved. The SMS text engine (§3.12) passes
 * `source: "sms"` so SMS-originated bookings are distinguishable in the
 * `bookings` table. Any other non-empty string (e.g. "sms_link") is passed
 * through verbatim.
 */
export function bookingSourceFromBody(body: { source?: unknown }): string {
  const s = body?.source;
  return typeof s === "string" && s ? s : "voice_call";
}
