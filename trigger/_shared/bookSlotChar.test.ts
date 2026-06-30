// BOOK-2 / BOOK-3 — CHARACTERIZATION tests (documentation only; NO edit to the shared fn).
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/bookSlotChar.test.ts
//
// frontend/supabase/functions/voice-booking-tools/index.ts is SHARED with the live Voice
// path, has ZERO tests, and is part of the frozen Session-7 edge baseline — so it is
// READ-ONLY this session and cannot be edited to export its internals. These tests instead
// MIRROR its two tiny pure functions verbatim and assert their CURRENT behaviour, so the
// two latent defects are captured executably as the spec for a supervised daytime edit.
// They assert what IS (they pass); the fix is WRITTEN UP in Docs/BUG_LIST.md (BOOK-2/3),
// not applied. The Text engine is the consumer that feeds these (setterTools.ts:46 tells
// the model to send an offset-less ISO), which is why the characterization lives here.
import test from "node:test";
import { strict as assert } from "node:assert";

// ── Mirror of voice-booking-tools/index.ts resolveCanonicalSlot matching (~line 227) ──
// The handler deliberately ignores the model's tz offset and matches WALL-CLOCK HH:MM
// against GHL's own slot grid (BOOK-2: this offset-ignoring is LOAD-BEARING and proven —
// do NOT "fix" it). The narrow defect: it requires an EXACT HH:MM-vs-grid match.
function canonicalMatch(startDateTime: string, gridSlots: string[]): string | null {
  const timeM = startDateTime.match(/T(\d{2}:\d{2})/);
  if (!timeM) return null;
  const hhmm = timeM[1];
  const canonical = gridSlots.find((s) => s.match(/T(\d{2}:\d{2})/)?.[1] === hhmm);
  return canonical ?? null;
}

// ── Mirror of voice-booking-tools/index.ts toMs (~line 445-451) ──
function toMs(s: string): string {
  const n = Number(s);
  if (Number.isFinite(n)) return String(Math.trunc(n));
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return String(d.getTime());
  return s;
}

const GRID = [
  "2026-07-02T14:00:00+10:00",
  "2026-07-02T14:30:00+10:00",
  "2026-07-02T16:00:00+10:00",
];

test("BOOK-2 (current behaviour): an on-grid HH:MM matches regardless of the model's offset", () => {
  // Same wall-clock time, different offsets, all match the grid's :00 slot — this is the
  // load-bearing, live-proven behaviour we must NOT change.
  assert.equal(canonicalMatch("2026-07-02T14:00:00", GRID), "2026-07-02T14:00:00+10:00");
  assert.equal(canonicalMatch("2026-07-02T14:00:00+10:00", GRID), "2026-07-02T14:00:00+10:00");
  assert.equal(canonicalMatch("2026-07-02T14:00:00Z", GRID), "2026-07-02T14:00:00+10:00");
});

test("BOOK-2 (defect): an OFF-grid minute fails the exact match -> null -> false 'unavailable'", () => {
  // The model offering 14:01 (a minute off GHL's :00/:30 grid) returns null, which the
  // handler turns into buildSlotUnavailable ("That time isn't available") even though
  // 14:00 is open. FIX (supervised daytime): snap to the nearest real grid slot or return
  // slot_unavailable WITH alternatives — never loosen to fuzzy match, never POST an
  // unvalidated time.
  assert.equal(canonicalMatch("2026-07-02T14:01:00", GRID), null);
  assert.equal(canonicalMatch("2026-07-02T15:00:00", GRID), null); // genuinely absent — correct
});

test("BOOK-3 (defect): an offset-less ISO is interpreted in the HOST timezone, not the client's", () => {
  // setterTools.ts:46 tells the model to send an offset-less ISO (e.g. 2026-07-01T00:00:00);
  // toMs() does new Date(s).getTime(), which interprets it in the HOST process timezone.
  // The edge fns run on UTC hosts, so in production that is UTC midnight — 10h AHEAD of an
  // Australia/Sydney lead's intended local midnight, skewing the get-available-slots window
  // (the local day can be off by one). This assertion is host-TZ-robust: it locks that toMs
  // uses the host-local interpretation, and that the UTC vs AU interpretations genuinely
  // differ by the offset.
  const offsetless = "2026-07-01T00:00:00";
  assert.equal(toMs(offsetless), String(new Date(offsetless).getTime())); // host-local, not client tz
  const utcMidnight = Date.parse("2026-07-01T00:00:00Z");
  const auMidnight = Date.parse("2026-07-01T00:00:00+10:00");
  assert.notEqual(utcMidnight, auMidnight); // the two interpretations differ by 10h
  // FIX (supervised daytime): interpret an offset-less ISO in client.timezone, or have the
  // model pass startDate/endDate as epoch ms. The epoch-ms path is already safe — toMs
  // passes a numeric string straight through:
  assert.equal(toMs(String(auMidnight)), String(auMidnight));
});
