// PROMPT-AUTH-1 — unit tests for canonical slot binding + booking validation.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/slotBinding.test.ts
//
// The incident: the model turned an accepted "Thursday 2pm" into Friday's ISO and
// the booking executed. These tests prove: (1) every slot the engine sees becomes a
// canonical wall-clock key -> exact-GHL-ISO entry; (2) a listed booking is REWRITTEN
// to GHL's exact ISO (so the frozen shared fn's wall-clock grid match always hits);
// (3) an off-list datetime is REFUSED with the real alternatives folded back;
// (4) matching is wall-clock literal, never Date-parsed (no BOOK-3 offset skew);
// (5) with no availability data at all, booking blind is refused.
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  availableTimesByDate,
  mergeCanonicalSlots,
  slotKeyFrom,
  validateBookingArgs,
  type CanonicalSlotMap,
} from "./slotBinding.ts";

const RAW_GHL = {
  "2026-07-06": { slots: ["2026-07-06T11:00:00+10:00", "2026-07-06T14:00:00+10:00"] },
  "2026-07-09": { slots: ["2026-07-09T14:00:00+10:00"] },
  traceId: "abc-123",
};

function freshMap(): CanonicalSlotMap {
  const map: CanonicalSlotMap = new Map();
  mergeCanonicalSlots(map, RAW_GHL);
  return map;
}

test("slotKeyFrom: wall-clock literal extraction, no Date parsing", () => {
  assert.equal(slotKeyFrom("2026-07-06T11:00:00+10:00"), "2026-07-06T11:00");
  assert.equal(slotKeyFrom("2026-07-06T11:00"), "2026-07-06T11:00");
  assert.equal(slotKeyFrom("2026-07-06T11:00:00"), "2026-07-06T11:00");
  assert.equal(slotKeyFrom("2026-07-06 11:00"), "2026-07-06T11:00");
  // A wrong offset must NOT shift the wall-clock key (BOOK-3 class).
  assert.equal(slotKeyFrom("2026-07-06T11:00:00Z"), "2026-07-06T11:00");
  assert.equal(slotKeyFrom("2026-07-06T11:00:00-04:00"), "2026-07-06T11:00");
  assert.equal(slotKeyFrom("garbage"), null);
  assert.equal(slotKeyFrom(undefined), null);
  assert.equal(slotKeyFrom(1234), null);
});

test("mergeCanonicalSlots: builds key -> exact GHL ISO, skips junk, dedupes", () => {
  const map: CanonicalSlotMap = new Map();
  const added = mergeCanonicalSlots(map, RAW_GHL);
  assert.equal(added, 3);
  assert.equal(map.get("2026-07-06T11:00"), "2026-07-06T11:00:00+10:00");
  assert.equal(map.get("2026-07-09T14:00"), "2026-07-09T14:00:00+10:00");
  // Re-merge adds nothing new; junk input adds nothing and never throws.
  assert.equal(mergeCanonicalSlots(map, RAW_GHL), 0);
  assert.equal(mergeCanonicalSlots(map, null), 0);
  assert.equal(mergeCanonicalSlots(map, "nope"), 0);
  assert.equal(mergeCanonicalSlots(map, { traceId: "x" }), 0);
});

test("validateBookingArgs: listed time is ACCEPTED and rewritten to the exact GHL ISO", () => {
  const map = freshMap();
  // Model sends the displayed wall-clock form (offset-less) — the engine binds it.
  const v = validateBookingArgs(map, "book-appointments", {
    startDateTime: "2026-07-06T11:00",
    contactId: "lead-1",
  });
  assert.equal(v.ok, true);
  assert.deepEqual((v as { args?: Record<string, unknown> }).args, {
    startDateTime: "2026-07-06T11:00:00+10:00",
  });
});

test("validateBookingArgs: listed time with seconds / offset variants still binds", () => {
  const map = freshMap();
  for (const variant of [
    "2026-07-06T11:00:00",
    "2026-07-06T11:00:00+10:00",
    "2026-07-06T11:00:00Z", // wrong offset, right wall clock — wall-clock doctrine wins
  ]) {
    const v = validateBookingArgs(map, "book-appointments", { startDateTime: variant });
    assert.equal(v.ok, true, `variant ${variant} should bind`);
    assert.equal(
      (v as { args?: Record<string, unknown> }).args?.startDateTime,
      "2026-07-06T11:00:00+10:00",
    );
  }
});

test("validateBookingArgs: OFF-LIST time is refused with real alternatives (the incident)", () => {
  const map = freshMap();
  // The incident: accepted "Thursday 2pm" became Friday 2026-07-03T16:00+10:00.
  const v = validateBookingArgs(map, "book-appointments", {
    startDateTime: "2026-07-03T16:00:00+10:00",
  });
  assert.equal(v.ok, false);
  const result = (v as { result: Record<string, unknown> }).result;
  assert.equal(result.booked, false);
  assert.equal(result.status, "slot_unavailable");
  assert.deepEqual(result.available_slots, {
    "2026-07-06": ["11:00", "14:00"],
    "2026-07-09": ["14:00"],
  });
});

test("validateBookingArgs: update-appointment is gated the same way", () => {
  const map = freshMap();
  const good = validateBookingArgs(map, "update-appointment", {
    eventId: "evt-1",
    startDateTime: "2026-07-09T14:00",
  });
  assert.equal(good.ok, true);
  assert.equal(
    (good as { args?: Record<string, unknown> }).args?.startDateTime,
    "2026-07-09T14:00:00+10:00",
  );

  const bad = validateBookingArgs(map, "update-appointment", {
    eventId: "evt-1",
    startDateTime: "2026-07-10T09:00",
  });
  assert.equal(bad.ok, false);
});

test("validateBookingArgs: empty map (no availability seen) refuses booking blind", () => {
  const map: CanonicalSlotMap = new Map();
  const v = validateBookingArgs(map, "book-appointments", {
    startDateTime: "2026-07-06T11:00",
  });
  assert.equal(v.ok, false);
  const result = (v as { result: Record<string, unknown> }).result;
  assert.equal(result.status, "availability_unknown");
});

test("validateBookingArgs: non-booking tools pass through untouched", () => {
  const map: CanonicalSlotMap = new Map(); // even with zero data
  for (const name of [
    "get-available-slots",
    "get-contact-appointments",
    "cancel-appointments",
    "schedule-callback",
  ]) {
    const v = validateBookingArgs(map, name, { anything: true });
    assert.equal(v.ok, true, `${name} must not be gated`);
    assert.equal((v as { args?: Record<string, unknown> }).args, undefined);
  }
});

test("availableTimesByDate: sorted compact view for the fold-back", () => {
  const map = freshMap();
  mergeCanonicalSlots(map, { "2026-07-05": { slots: ["2026-07-05T08:30:00+10:00"] } });
  assert.deepEqual(availableTimesByDate(map), {
    "2026-07-05": ["08:30"],
    "2026-07-06": ["11:00", "14:00"],
    "2026-07-09": ["14:00"],
  });
});
