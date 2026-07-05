// BOOK-2 / BOOK-3: regression tests for the fixed slot-matching behaviour.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/bookSlotChar.test.ts
//
// frontend/supabase/functions/voice-booking-tools/index.ts is a Deno edge module that
// can't be imported from Node, so these MIRROR its two fixed pure helpers
// (voice-booking-tools/bookingHelpers.ts: pickCanonicalSlot + wallClockLocalToEpochMs)
// verbatim and lock the intended behaviour. The authoritative unit tests for the real
// module run under Deno (bookingHelpers.test.ts). These started life as characterization
// tests capturing the BOOK-2/3 defects; the supervised shared-fn pass applied the fix, so
// they now assert what the handler DOES after the fix.
import test from "node:test";
import { strict as assert } from "node:assert";

// ── Mirror of voice-booking-tools/bookingHelpers.ts pickCanonicalSlot (BOOK-2) ──
// Offset-ignoring wall-clock match is LOAD-BEARING (do NOT change). The fix: an exact
// HH:MM match wins; otherwise snap to the nearest real slot within a tight tolerance so
// an off-by-a-minute model time isn't a false "unavailable"; anything further stays null.
const SNAP_TOLERANCE_MIN = 2;
function slotHhmm(slot: string): string | null {
  return slot.match(/T(\d{2}:\d{2})/)?.[1] ?? null;
}
function hhmmToMin(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function pickCanonicalSlot(grid: string[], requestedHhmm: string, tol = SNAP_TOLERANCE_MIN): string | null {
  const exact = grid.find((s) => slotHhmm(s) === requestedHhmm);
  if (exact) return exact;
  const want = hhmmToMin(requestedHhmm);
  if (want == null) return null;
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const s of grid) {
    const sh = slotHhmm(s);
    const sm = sh ? hhmmToMin(sh) : null;
    if (sm == null) continue;
    const diff = Math.abs(sm - want);
    if (diff <= tol && diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}

// ── Mirror of voice-booking-tools/bookingHelpers.ts wallClockLocalToEpochMs (BOOK-3) ──
function offsetMsForZone(timeZone: string, epochMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(epochMs))) if (p.type !== "literal") m[p.type] = Number(p.value);
  return Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second) - epochMs;
}
function hasExplicitOffset(iso: string): boolean {
  return /([+-]\d{2}:?\d{2}|Z)$/.test(iso.trim());
}
function wallClockLocalToEpochMs(iso: string, timeZone: string): number | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const guessUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  return guessUtc - offsetMsForZone(timeZone, guessUtc);
}

const GRID = [
  "2026-07-02T14:00:00+10:00",
  "2026-07-02T14:30:00+10:00",
  "2026-07-02T16:00:00+10:00",
];

test("BOOK-2: an on-grid HH:MM matches regardless of the model's offset (load-bearing)", () => {
  assert.equal(pickCanonicalSlot(GRID, "14:00"), "2026-07-02T14:00:00+10:00");
  assert.equal(pickCanonicalSlot(GRID, "16:00"), "2026-07-02T16:00:00+10:00");
});

test("BOOK-2 (fixed): an off-by-a-minute near miss snaps to the real slot", () => {
  assert.equal(pickCanonicalSlot(GRID, "14:01"), "2026-07-02T14:00:00+10:00");
  assert.equal(pickCanonicalSlot(GRID, "14:29"), "2026-07-02T14:30:00+10:00");
  // A genuinely absent time (beyond tolerance) still returns null -> real alternatives.
  assert.equal(pickCanonicalSlot(GRID, "15:00"), null);
  assert.equal(pickCanonicalSlot(GRID, "14:05"), null);
});

test("BOOK-3 (fixed): an offset-less ISO is read in the client timezone, not the host's", () => {
  const offsetless = "2026-07-01T00:00:00";
  assert.equal(hasExplicitOffset(offsetless), false);
  // Australia/Sydney local midnight == the AU-offset instant, NOT UTC midnight.
  assert.equal(wallClockLocalToEpochMs(offsetless, "Australia/Sydney"), Date.parse("2026-07-01T00:00:00+10:00"));
  assert.notEqual(Date.parse("2026-07-01T00:00:00+10:00"), Date.parse("2026-07-01T00:00:00Z"));
  // An offset-carrying string is left to normal Date parsing (already correct).
  assert.equal(hasExplicitOffset("2026-07-01T00:00:00+10:00"), true);
});
