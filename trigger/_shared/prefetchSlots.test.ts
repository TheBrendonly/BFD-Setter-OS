// BOOK-1 — unit tests for the Text-setter availability prefetch.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/prefetchSlots.test.ts
//
// BOOK-1 root cause: unlike Voice (which prefetches availability into a dynamic var
// so the model sees open times before it speaks), the Text setter relied on the model
// to voluntarily call get-available-slots — and a weak model fabricated "booked out"
// against an OPEN calendar. The fix mirrors Voice read-only: prefetch via the SAME
// shared get-available-slots tool, compact like Voice's compactSlots, and inject a
// ground-truth block every reply so fabrication is structurally impossible.
//
// These tests prove: (1) compaction matches Voice (HH:MM, skips traceId); (2) the
// prefetch calls get-available-slots with an EPOCH-MS window (NOT an offset-less ISO —
// that would hit BOOK-3's UTC-misparse); (3) it never throws; (4) the injected block
// carries the real open times + the anti-fabrication guard.
import test from "node:test";
import { strict as assert } from "node:assert";
import { compactSlots, prefetchAvailability, buildAvailabilityBlock, leadZoneLabels } from "./prefetchSlots.ts";
import type { CallTool } from "./setterToolLoop.ts";

const RAW_GHL = {
  "2026-07-01": { slots: ["2026-07-01T09:00:00+10:00", "2026-07-01T09:30:00+10:00"] },
  "2026-07-02": { slots: ["2026-07-02T14:00:00+10:00", "2026-07-02T16:00:00+10:00"] },
  traceId: "abc-123",
};

const NOW = Date.parse("2026-06-30T00:00:00Z");

test("compactSlots: ISO slots -> HH:MM map, skips traceId and non-date keys", () => {
  const out = compactSlots(RAW_GHL);
  assert.deepEqual(out, {
    "2026-07-01": ["09:00", "09:30"],
    "2026-07-02": ["14:00", "16:00"],
  });
  assert.equal((out as Record<string, unknown>).traceId, undefined);
});

test("prefetchAvailability: calls get-available-slots with an EPOCH-MS window (avoids BOOK-3)", async () => {
  let capturedName = "";
  let capturedArgs: Record<string, unknown> = {};
  const callTool: CallTool = async (name, args) => {
    capturedName = name;
    capturedArgs = args;
    return RAW_GHL;
  };

  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW, windowDays: 14 });

  assert.equal(capturedName, "get-available-slots");
  // startDate/endDate must be numeric epoch-ms strings, NOT offset-less ISO.
  assert.match(String(capturedArgs.startDate), /^\d+$/, "startDate must be epoch ms");
  assert.match(String(capturedArgs.endDate), /^\d+$/, "endDate must be epoch ms");
  assert.equal(Number(capturedArgs.startDate), NOW);
  assert.equal(Number(capturedArgs.endDate), NOW + 14 * 86400000);
  assert.equal(capturedArgs.timeZone, "Australia/Sydney");

  assert.equal(r.status, "ok");
  assert.equal(r.timezone, "Australia/Sydney");
  assert.deepEqual(r.slots, { "2026-07-01": ["09:00", "09:30"], "2026-07-02": ["14:00", "16:00"] });
  // The prefetch is itself a recorded ToolInvocation (so SMS-OBS-1 persists it).
  assert.equal(r.invocation.name, "get-available-slots");
  assert.equal(r.invocation.error ?? null, null);
});

test("prefetchAvailability: empty calendar -> status empty, slots {}", async () => {
  const callTool: CallTool = async () => ({ traceId: "x" });
  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW });
  assert.equal(r.status, "empty");
  assert.deepEqual(r.slots, {});
});

test("prefetchAvailability: callTool throwing -> status error, never throws", async () => {
  const callTool: CallTool = async () => {
    throw new Error("voice-booking-tools get-available-slots failed: GHL 502");
  };
  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW });
  assert.equal(r.status, "error");
  assert.match(r.invocation.error ?? "", /GHL 502/);
  assert.deepEqual(r.slots, {});
});

test("buildAvailabilityBlock: ok block carries the real times + anti-fabrication guard", async () => {
  const callTool: CallTool = async () => RAW_GHL;
  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW, windowDays: 14 });
  const block = buildAvailabilityBlock(r);
  assert.match(block, /09:00/);
  assert.match(block, /Australia\/Sydney/);
  // The guard wording that makes BOOK-1's fabrication structurally disallowed.
  assert.match(block, /booked out/i);
  assert.match(block, /never/i);
});

test("buildAvailabilityBlock: error block tells the model to call get-available-slots, no fabrication", () => {
  const block = buildAvailabilityBlock({
    status: "error",
    timezone: "Australia/Sydney",
    windowDays: 14,
    slots: {},
    invocation: { name: "get-available-slots", args: {}, error: "boom" },
  });
  assert.match(block, /get-available-slots/);
  assert.match(block, /never/i);
});

// FOLLOWUP-PROMPT-1 review follow-up: the followup channel has NO tool loop and a
// strict-JSON output contract, so its variant must keep the anti-fabrication data +
// rules but must NOT instruct the model to call get-available-slots /
// book-appointments (tool-shaped output would fail the JSON parse and the run).
test("buildAvailabilityBlock followup mode: ok block keeps data + guard, drops all tool instructions", async () => {
  const callTool: CallTool = async () => RAW_GHL;
  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW, windowDays: 14 });
  const block = buildAvailabilityBlock(r, { channel: "followup" });
  assert.match(block, /09:00/);
  assert.match(block, /booked out/i);
  assert.doesNotMatch(block, /get-available-slots/);
  assert.doesNotMatch(block, /book-appointments/);
  assert.doesNotMatch(block, /\bcall\b/i);
});

test("buildAvailabilityBlock followup mode: empty and error blocks name no tools and forbid naming times", () => {
  const empty = buildAvailabilityBlock(
    { status: "empty", timezone: "Australia/Sydney", windowDays: 14, slots: {}, invocation: { name: "get-available-slots", args: {} } },
    { channel: "followup" }
  );
  const error = buildAvailabilityBlock(
    { status: "error", timezone: "Australia/Sydney", windowDays: 14, slots: {}, invocation: { name: "get-available-slots", args: {}, error: "boom" } },
    { channel: "followup" }
  );
  for (const block of [empty, error]) {
    assert.doesNotMatch(block, /get-available-slots/);
    assert.doesNotMatch(block, /book-appointments/);
    assert.match(block, /do not|don't|never/i);
  }
});

test("buildAvailabilityBlock: default (reply) mode is unchanged by the followup variant", async () => {
  const callTool: CallTool = async () => RAW_GHL;
  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW, windowDays: 14 });
  assert.equal(buildAvailabilityBlock(r), buildAvailabilityBlock(r, { channel: "reply" }));
  assert.match(buildAvailabilityBlock(r), /book-appointments/);
});

// ── BOOK-TZ-DISPLAY-1 — deterministic business->lead conversion (no model arithmetic) ──

test("leadZoneLabels: Sydney business slots -> Perth lead-local labels (deterministic)", () => {
  const out = leadZoneLabels(RAW_GHL, "Australia/Perth");
  // Perth (+08:00) is 2h behind Sydney (+10:00): 09:00 -> 7:00 am, 14:00 -> 12:00 pm.
  assert.deepEqual(out, {
    "2026-07-01": { "09:00": "7:00 am", "09:30": "7:30 am" },
    "2026-07-02": { "14:00": "12:00 pm", "16:00": "2:00 pm" },
  });
  assert.equal((out as Record<string, unknown>).traceId, undefined);
});

test("buildAvailabilityBlock: differing leadZone appends the conversion table + no-math instruction", async () => {
  const callTool: CallTool = async () => RAW_GHL;
  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW, windowDays: 14 });
  const block = buildAvailabilityBlock(r, { leadZone: "Australia/Perth" });
  assert.match(block, /STATING TIMES TO THE LEAD/);
  assert.match(block, /Perth/);
  assert.match(block, /never compute a timezone yourself/i);
  assert.match(block, /12:00 pm/); // the Perth-local label for the 14:00 Sydney slot
  // Booking still references the business-tz map + verbatim HH:MM.
  assert.match(block, /book-appointments/);
});

test("buildAvailabilityBlock: same-zone leadZone is a no-op (byte-identical to no opts)", async () => {
  const callTool: CallTool = async () => RAW_GHL;
  const r = await prefetchAvailability({ callTool, timeZone: "Australia/Sydney", nowMs: NOW, windowDays: 14 });
  assert.equal(buildAvailabilityBlock(r, { leadZone: "Australia/Sydney" }), buildAvailabilityBlock(r));
  // An invalid/junk lead zone also degrades to the unchanged block.
  assert.equal(buildAvailabilityBlock(r, { leadZone: "Not/AZone" }), buildAvailabilityBlock(r));
});
