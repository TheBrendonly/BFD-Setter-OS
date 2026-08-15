// Unit tests for confirmedBooking (suppress chasing a booked lead).
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/confirmedBooking.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  bookedKey,
  fetchUpcomingBookedKeys,
  hasUpcomingConfirmedBooking,
} from "./confirmedBooking.ts";

const NOW = "2026-08-15T00:00:00.000Z";

// Chainable Supabase stub. Records .eq/.gt/.in filters so we can assert the query
// shape; resolves (thenable) and .maybeSingle() to the configured result.
function fakeSb(result: { data: unknown; error: { message: string } | null }) {
  const calls: { eqs: Array<[string, unknown]>; gts: Array<[string, unknown]>; ins: Array<[string, unknown]>; table?: string } = {
    eqs: [], gts: [], ins: [],
  };
  const builder: any = {
    from(t: string) { calls.table = t; return builder; },
    select() { return builder; },
    eq(c: string, v: unknown) { calls.eqs.push([c, v]); return builder; },
    gt(c: string, v: unknown) { calls.gts.push([c, v]); return builder; },
    in(c: string, v: unknown) { calls.ins.push([c, v]); return builder; },
    limit() { return builder; },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve: (v: typeof result) => unknown) { return resolve(result); },
  };
  return { builder, calls };
}

test("bookedKey: composes client|lead", () => {
  assert.equal(bookedKey("c1", "L1"), "c1|L1");
});

test("fetchUpcomingBookedKeys: empty input short-circuits (no query)", async () => {
  const { builder } = fakeSb({ data: [{ client_id: "c1", lead_id: "L1" }], error: null });
  const keys = await fetchUpcomingBookedKeys(builder, [], NOW);
  assert.equal(keys.size, 0);
});

test("fetchUpcomingBookedKeys: builds a key set + filters on confirmed/upcoming", async () => {
  const { builder, calls } = fakeSb({
    data: [
      { client_id: "c1", lead_id: "L1" },
      { client_id: "c2", lead_id: "L2" },
    ],
    error: null,
  });
  const keys = await fetchUpcomingBookedKeys(builder, ["L1", "L2", "L3", "L1"], NOW);
  assert.equal(keys.has("c1|L1"), true);
  assert.equal(keys.has("c2|L2"), true);
  assert.equal(keys.has("c1|L3"), false);
  assert.equal(calls.table, "bookings");
  assert.deepEqual(calls.eqs, [["status", "confirmed"]]);
  assert.deepEqual(calls.gts, [["appointment_time", NOW]]);
  // de-duped ids passed to .in()
  assert.deepEqual(calls.ins, [["lead_id", ["L1", "L2", "L3"]]]);
});

test("fetchUpcomingBookedKeys: query error fails OPEN (empty set)", async () => {
  const { builder } = fakeSb({ data: null, error: { message: "boom" } });
  const keys = await fetchUpcomingBookedKeys(builder, ["L1"], NOW);
  assert.equal(keys.size, 0);
});

test("hasUpcomingConfirmedBooking: row present -> true", async () => {
  const { builder, calls } = fakeSb({ data: { lead_id: "L1" }, error: null });
  assert.equal(await hasUpcomingConfirmedBooking(builder, "c1", "L1", NOW), true);
  assert.deepEqual(calls.eqs, [["client_id", "c1"], ["lead_id", "L1"], ["status", "confirmed"]]);
  assert.deepEqual(calls.gts, [["appointment_time", NOW]]);
});

test("hasUpcomingConfirmedBooking: no row -> false", async () => {
  const { builder } = fakeSb({ data: null, error: null });
  assert.equal(await hasUpcomingConfirmedBooking(builder, "c1", "L1", NOW), false);
});

test("hasUpcomingConfirmedBooking: query error fails OPEN (false)", async () => {
  const { builder } = fakeSb({ data: null, error: { message: "boom" } });
  assert.equal(await hasUpcomingConfirmedBooking(builder, "c1", "L1", NOW), false);
});
