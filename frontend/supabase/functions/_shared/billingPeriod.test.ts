import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeBillingPeriod, sanitizeAnchorDay } from "./billingPeriod.ts";

// F13 usage metering — billing-period math (pure, no I/O).
// Periods run anchor-day to anchor-day in the client's timezone, end-exclusive.
// Anchor days past a short month's end clamp to that month's last day.
// offset browses history (0 = current, -1 = previous, clamped -24..0).

const UTC = "UTC";
const SYD = "Australia/Sydney";

Deno.test("anchor 1, UTC, mid-month: calendar month period", () => {
  const p = computeBillingPeriod({
    anchorDay: 1,
    timeZone: UTC,
    offset: 0,
    now: new Date("2026-07-15T12:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-07-01T00:00:00.000Z");
  assertEquals(p.end_utc, "2026-08-01T00:00:00.000Z");
  assertEquals(p.label, "1 Jul 2026 to 31 Jul 2026");
  assertEquals(p.anchor_day, 1);
  assertEquals(p.offset, 0);
});

Deno.test("on the anchor day itself the new period has already started", () => {
  const p = computeBillingPeriod({
    anchorDay: 15,
    timeZone: UTC,
    offset: 0,
    now: new Date("2026-07-15T00:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-07-15T00:00:00.000Z");
  assertEquals(p.end_utc, "2026-08-15T00:00:00.000Z");
});

Deno.test("the day before the anchor still belongs to the previous period", () => {
  const p = computeBillingPeriod({
    anchorDay: 15,
    timeZone: UTC,
    offset: 0,
    now: new Date("2026-07-14T23:59:59Z"),
  });
  assertEquals(p.start_utc, "2026-06-15T00:00:00.000Z");
  assertEquals(p.end_utc, "2026-07-15T00:00:00.000Z");
  assertEquals(p.label, "15 Jun 2026 to 14 Jul 2026");
});

Deno.test("anchor 31 clamps in February (non-leap): period is 31 Jan to 28 Feb", () => {
  const p = computeBillingPeriod({
    anchorDay: 31,
    timeZone: UTC,
    offset: 0,
    now: new Date("2026-02-10T12:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-01-31T00:00:00.000Z");
  assertEquals(p.end_utc, "2026-02-28T00:00:00.000Z");
  assertEquals(p.label, "31 Jan 2026 to 27 Feb 2026");
});

Deno.test("anchor 31 on the clamped Feb day starts the Feb-to-Mar period", () => {
  const p = computeBillingPeriod({
    anchorDay: 31,
    timeZone: UTC,
    offset: 0,
    now: new Date("2026-02-28T00:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-02-28T00:00:00.000Z");
  assertEquals(p.end_utc, "2026-03-31T00:00:00.000Z");
});

Deno.test("anchor 31 clamps to 29 in a leap-year February", () => {
  const p = computeBillingPeriod({
    anchorDay: 31,
    timeZone: UTC,
    offset: 0,
    now: new Date("2028-02-29T06:00:00Z"),
  });
  assertEquals(p.start_utc, "2028-02-29T00:00:00.000Z");
  assertEquals(p.end_utc, "2028-03-31T00:00:00.000Z");
});

Deno.test("anchor 31 clamps to 30 in April", () => {
  const p = computeBillingPeriod({
    anchorDay: 31,
    timeZone: UTC,
    offset: 0,
    now: new Date("2026-04-30T00:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-04-30T00:00:00.000Z");
  assertEquals(p.end_utc, "2026-05-31T00:00:00.000Z");
});

Deno.test("offset -1 returns the previous period", () => {
  const p = computeBillingPeriod({
    anchorDay: 1,
    timeZone: UTC,
    offset: -1,
    now: new Date("2026-07-15T12:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-06-01T00:00:00.000Z");
  assertEquals(p.end_utc, "2026-07-01T00:00:00.000Z");
  assertEquals(p.offset, -1);
});

Deno.test("offset -12 returns the same period one year back", () => {
  const p = computeBillingPeriod({
    anchorDay: 1,
    timeZone: UTC,
    offset: -12,
    now: new Date("2026-07-15T12:00:00Z"),
  });
  assertEquals(p.start_utc, "2025-07-01T00:00:00.000Z");
  assertEquals(p.end_utc, "2025-08-01T00:00:00.000Z");
});

Deno.test("positive and out-of-range offsets clamp to 0 / -24", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const fwd = computeBillingPeriod({ anchorDay: 1, timeZone: UTC, offset: 5, now });
  assertEquals(fwd.start_utc, "2026-07-01T00:00:00.000Z");
  assertEquals(fwd.offset, 0);
  const far = computeBillingPeriod({ anchorDay: 1, timeZone: UTC, offset: -99, now });
  assertEquals(far.start_utc, "2024-07-01T00:00:00.000Z");
  assertEquals(far.offset, -24);
});

Deno.test("timezone decides the local date: a UTC-Jul-1 instant is already Jul 2 in Sydney", () => {
  // 2026-07-01T20:00:00Z is 2026-07-02 06:00 AEST (+10). Anchor 2 has been reached.
  const p = computeBillingPeriod({
    anchorDay: 2,
    timeZone: SYD,
    offset: 0,
    now: new Date("2026-07-01T20:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-07-01T14:00:00.000Z"); // Jul 2 00:00 AEST
  assertEquals(p.end_utc, "2026-08-01T14:00:00.000Z"); // Aug 2 00:00 AEST
});

Deno.test("DST transition inside the period: boundaries keep local midnight (AEST in, AEDT out)", () => {
  // Sydney DST starts 2026-10-04. Oct 1 midnight is +10; Nov 1 midnight is +11.
  const p = computeBillingPeriod({
    anchorDay: 1,
    timeZone: SYD,
    offset: 0,
    now: new Date("2026-10-15T00:00:00Z"),
  });
  assertEquals(p.start_utc, "2026-09-30T14:00:00.000Z"); // Oct 1 00:00 AEST
  assertEquals(p.end_utc, "2026-10-31T13:00:00.000Z"); // Nov 1 00:00 AEDT
  assertEquals(p.label, "1 Oct 2026 to 31 Oct 2026");
});

Deno.test("anchor sanitation: 0, 32, NaN and non-numbers clamp or default", () => {
  assertEquals(sanitizeAnchorDay(0), 1);
  assertEquals(sanitizeAnchorDay(32), 31);
  assertEquals(sanitizeAnchorDay(NaN), 1);
  assertEquals(sanitizeAnchorDay(undefined), 1);
  assertEquals(sanitizeAnchorDay(15.9), 15);
  const p = computeBillingPeriod({
    anchorDay: NaN,
    timeZone: UTC,
    offset: Number.NaN,
    now: new Date("2026-07-15T12:00:00Z"),
  });
  assertEquals(p.anchor_day, 1);
  assertEquals(p.offset, 0);
  assertEquals(p.start_utc, "2026-07-01T00:00:00.000Z");
});
