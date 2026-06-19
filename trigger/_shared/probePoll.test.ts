// Unit test for the synthetic-probe Step-3 poll (Bug 6.7). Runs under Node 22+:
//   node --experimental-strip-types --test trigger/_shared/probePoll.test.ts
//
// 6.7: the probe asserted an outbound message_queue row immediately after the
// execution went `running`, but Trigger.dev start latency (45-82s) means the
// SMS node hasn't run yet -> false "no outbound message_queue row". pollUntil
// re-queries on a deadline instead of asserting once.
import test from "node:test";
import { strict as assert } from "node:assert";
import { hasOutboundRow, pollUntil } from "./probePoll.ts";

// A controllable clock so timing is tested without real waits. sleep() advances
// virtual time; now() reports it.
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

test("hasOutboundRow truth table", () => {
  assert.equal(hasOutboundRow([{ channel: "sms_outbound" }]), true);
  assert.equal(hasOutboundRow([{ channel: "sms_inbound" }]), false);
  assert.equal(hasOutboundRow([{ channel: "sms_inbound" }, { channel: "sms_outbound" }]), true);
  assert.equal(hasOutboundRow([]), false);
  assert.equal(hasOutboundRow(null), false);
  assert.equal(hasOutboundRow(undefined), false);
});

test("pollUntil resolves ok:true once a later fetch matches (no real waits)", async () => {
  const clock = fakeClock();
  let calls = 0;
  let sleeps = 0;
  const fetchFn = async () => {
    calls++;
    return calls >= 3 ? [{ channel: "sms_outbound" }] : [];
  };
  const result = await pollUntil(fetchFn, hasOutboundRow, {
    deadlineMs: 60_000,
    sleepMs: 2_500,
    now: clock.now,
    sleep: async (ms) => {
      sleeps++;
      await clock.sleep(ms);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 3, "fetched until the row appeared");
  assert.equal(sleeps, 2, "slept between the first three fetches");
});

test("pollUntil returns ok:true immediately when the first fetch matches (no sleep)", async () => {
  const clock = fakeClock();
  let sleeps = 0;
  let calls = 0;
  const result = await pollUntil(
    async () => {
      calls++;
      return [{ channel: "sms_outbound" }];
    },
    hasOutboundRow,
    {
      deadlineMs: 60_000,
      sleepMs: 2_500,
      now: clock.now,
      sleep: async (ms) => {
        sleeps++;
        await clock.sleep(ms);
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(sleeps, 0, "must not sleep when the first fetch already matches");
});

test("pollUntil returns ok:false when the deadline passes and does not loop forever", async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await pollUntil(
    async () => {
      calls++;
      return [{ channel: "sms_inbound" }]; // never matches
    },
    hasOutboundRow,
    {
      deadlineMs: 10_000,
      sleepMs: 2_500,
      now: clock.now,
      sleep: clock.sleep,
    },
  );
  assert.equal(result.ok, false);
  // deadline 10_000 / sleep 2_500 => 4 sleeps to reach the deadline, 5 fetches.
  assert.equal(calls, 5, "bounded iteration count, not infinite");
});
