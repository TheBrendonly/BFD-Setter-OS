// Unit tests for retention (per-client consent/retention cutoff).
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/retention.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  resolveRetentionMonths,
  retentionCutoffDate,
  isPastRetention,
  DEFAULT_RETENTION_MONTHS,
} from "./retention.ts";

test("resolveRetentionMonths: default when missing / malformed / non-positive", () => {
  assert.equal(resolveRetentionMonths(null), DEFAULT_RETENTION_MONTHS);
  assert.equal(resolveRetentionMonths({}), DEFAULT_RETENTION_MONTHS);
  assert.equal(resolveRetentionMonths({ retention_months: 0 }), DEFAULT_RETENTION_MONTHS);
  assert.equal(resolveRetentionMonths({ retention_months: -2 }), DEFAULT_RETENTION_MONTHS);
  assert.equal(resolveRetentionMonths({ retention_months: "abc" }), DEFAULT_RETENTION_MONTHS);
});

test("resolveRetentionMonths: reads a valid value (rounded)", () => {
  assert.equal(resolveRetentionMonths({ retention_months: 6 }), 6);
  assert.equal(resolveRetentionMonths({ retention_months: 1 }), 1);
  assert.equal(resolveRetentionMonths({ retention_months: 2.6 }), 3);
});

test("retentionCutoffDate: adds calendar months", () => {
  const anchor = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(retentionCutoffDate(anchor, 3).toISOString(), "2026-04-15T00:00:00.000Z");
});

test("isPastRetention: false before the window, true after", () => {
  const anchor = "2026-05-01T00:00:00.000Z"; // +3 months -> 2026-08-01
  assert.equal(isPastRetention(anchor, 3, new Date("2026-07-31T23:59:00.000Z")), false);
  assert.equal(isPastRetention(anchor, 3, new Date("2026-08-01T00:00:01.000Z")), true);
});

test("isPastRetention: missing / unparseable anchor never expires", () => {
  assert.equal(isPastRetention(null, 3, new Date("2030-01-01T00:00:00.000Z")), false);
  assert.equal(isPastRetention(undefined, 3, new Date("2030-01-01T00:00:00.000Z")), false);
  assert.equal(isPastRetention("not-a-date", 3, new Date("2030-01-01T00:00:00.000Z")), false);
});

test("isPastRetention: honours a larger window", () => {
  const anchor = "2026-01-01T00:00:00.000Z";
  assert.equal(isPastRetention(anchor, 12, new Date("2026-06-01T00:00:00.000Z")), false);
  assert.equal(isPastRetention(anchor, 12, new Date("2027-01-02T00:00:00.000Z")), true);
});
