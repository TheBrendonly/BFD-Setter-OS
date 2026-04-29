// Shared business-hours helpers for Supabase Deno edge functions.
// Originally inlined in bulk-insert-leads; extracted for reuse.
//
// Conventions for these helpers:
//   - daysOfWeek uses 1..7 (1=Mon, 7=Sun) — matches the day-of-week
//     convention captured in Docs/CADENCE_DESIGN.md.
//   - startTime / endTime are HH:MM strings interpreted in `timezone`.
//   - Overnight windows (start > end) are supported.
//
// Run-engagement (Node / Trigger.dev) keeps its own copy of an
// equivalent function with field names mapped to the cadence_quiet_hours
// jsonb shape; nothing in /trigger imports from this file because Deno
// modules can't be required from Node.

export function isWithinBusinessHours(
  date: Date,
  startTime: string,
  endTime: string,
  daysOfWeek: number[],
  timezone: string,
): boolean {
  const timeInTZ = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
  const dayOfWeek = timeInTZ.getDay(); // 0..6 (Sun..Sat)
  const normalizedDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 1..7 (Mon..Sun)

  if (!daysOfWeek.includes(normalizedDay)) return false;

  const currentTime = timeInTZ.toTimeString().slice(0, 5); // "HH:MM"
  const isOvernight = startTime > endTime;
  if (isOvernight) {
    return currentTime >= startTime || currentTime <= endTime;
  }
  return currentTime >= startTime && currentTime <= endTime;
}

export function getNextValidTime(
  currentTime: Date,
  startTime: string,
  endTime: string,
  daysOfWeek: number[],
  timezone: string,
): Date {
  let nextTime = new Date(currentTime);
  for (let i = 0; i < 14 * 24 * 60; i++) {
    if (isWithinBusinessHours(nextTime, startTime, endTime, daysOfWeek, timezone)) {
      return nextTime;
    }
    nextTime = new Date(nextTime.getTime() + 60_000); // step forward 1 min
  }
  // Fallback after 14d — return the original time so callers don't park forever
  return currentTime;
}
