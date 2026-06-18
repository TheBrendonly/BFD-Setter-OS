/**
 * Resolves the booking source to persist, ensuring a higher-fidelity origin
 * (e.g. voice_call) is never overwritten by a lower-fidelity one (ghl_calendar).
 *
 * Rules:
 * - No existing row (existingSource is null/undefined): use incomingSource.
 * - Existing row with null/empty source: use incomingSource.
 * - Existing row with "ghl_calendar" source: use incomingSource (no information
 *   lost — it was already a GHL-sourced booking).
 * - Existing row with any other source (e.g. "voice_call"): PRESERVE it.
 */
export function resolveBookingSource(
  existingSource: string | null | undefined,
  incomingSource = "ghl_calendar",
): string {
  if (!existingSource || existingSource === "ghl_calendar") {
    return incomingSource;
  }
  return existingSource;
}
