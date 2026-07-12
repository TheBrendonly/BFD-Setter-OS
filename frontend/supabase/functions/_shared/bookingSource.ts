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

/**
 * F21(b) — the AI-setter-created booking sources: voice agent (`voice_call`), the
 * SMS text engine (`sms`), and cadence/link SMS (`sms_link`). Used to scope the ROI
 * show-rate funnel + weekly-report `booked` headline to AI-sourced bookings only, per
 * Brendan's 2026-07-12 decision. Everything else — `ghl_calendar` and `manual` (human
 * bookings), `intake_form`, and NULL/unknown — is NOT an AI booking and is excluded.
 */
const SETTER_SOURCES = new Set(["voice_call", "sms", "sms_link"]);
export function isSetterSource(source: string | null | undefined): boolean {
  return !!source && SETTER_SOURCES.has(source);
}
