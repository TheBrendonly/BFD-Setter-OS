// CANCEL-1: unit tests for cancel/reschedule eventId binding (SMS-path mirror of slotBinding).
//   node --experimental-strip-types --test trigger/_shared/eventIdBinding.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  mergeEventIds,
  validateEventIdArgs,
  type EventIdSet,
} from "./eventIdBinding.ts";

const APPTS = {
  events: [
    { id: "realA", startTime: "2026-07-08 14:00:00", appointmentStatus: "confirmed" },
    { id: "realB", startTime: "2026-07-02 11:30:00", appointmentStatus: "confirmed" },
    { id: "deletedC", deleted: true },
  ],
  traceId: "t",
};

function freshSet(): EventIdSet {
  const s: EventIdSet = new Set();
  mergeEventIds(s, APPTS);
  return s;
}

test("mergeEventIds: folds real (non-deleted) events[].id, tolerant of junk", () => {
  const s = freshSet();
  assert.deepEqual([...s].sort(), ["realA", "realB"]);
  assert.equal(mergeEventIds(s, null), 0);
  assert.equal(mergeEventIds(s, { events: "nope" }), 0);
  assert.equal(mergeEventIds(s, APPTS), 0); // idempotent (already present)
});

test("validateEventIdArgs: non-gated tools pass through untouched", () => {
  const s = freshSet();
  assert.deepEqual(validateEventIdArgs(s, "book-appointments", { startDateTime: "x" }), { ok: true });
  assert.deepEqual(validateEventIdArgs(s, "get-available-slots", {}), { ok: true });
});

test("validateEventIdArgs: a listed eventId is accepted (cancel + reschedule)", () => {
  const s = freshSet();
  assert.deepEqual(validateEventIdArgs(s, "cancel-appointments", { eventId: "realA" }), { ok: true });
  assert.deepEqual(validateEventIdArgs(s, "update-appointment", { eventId: "realB", startDateTime: "x" }), { ok: true });
  // legacy appointmentId key also works
  assert.deepEqual(validateEventIdArgs(s, "cancel-appointment", { appointmentId: "realA" }), { ok: true });
});

test("validateEventIdArgs: a fabricated eventId is refused with the real ids folded back", () => {
  const s = freshSet();
  const fabricated = "6470700000000000000000000000000000000000000000000000000000000000";
  const v = validateEventIdArgs(s, "cancel-appointments", { eventId: fabricated });
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal((v.result as any).status, "event_not_found");
  assert.equal((v.result as any).requested, fabricated);
  assert.deepEqual(((v.result as any).known_event_ids as string[]).sort(), ["realA", "realB"]);
});

test("validateEventIdArgs: with no appointments listed this turn, refuse and require a list first", () => {
  const empty: EventIdSet = new Set();
  const v = validateEventIdArgs(empty, "cancel-appointments", { eventId: "realA" });
  assert.equal(v.ok, false);
  if (v.ok) return;
  assert.equal((v.result as any).status, "appointments_unknown");
});
