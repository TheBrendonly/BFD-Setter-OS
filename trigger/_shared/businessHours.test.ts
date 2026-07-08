// HOURS-1: unit tests for the shared business-hours module.
//   node --experimental-strip-types --test trigger/_shared/businessHours.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_QUIET_HOURS,
  resolveLeadTimezone,
  isWithinQuietHoursWindow,
  getNextQuietHoursStart,
  parseQuietHours,
  isAuTimezone,
  isWithinAuLegalWindow,
  isWithinSendingWindow,
  getNextSendingOpening,
} from "./businessHours.ts";

const BRIS = "Australia/Brisbane"; // UTC+10, no DST — stable for wall-time asserts
const ALL_DAYS = { start: "09:00", end: "21:00", tz: BRIS, days: [1, 2, 3, 4, 5, 6, 7] };
const WEEKDAYS = { start: "09:00", end: "21:00", tz: BRIS, days: [1, 2, 3, 4, 5] };

const MON_NOON = new Date("2026-07-06T02:00:00Z"); // Brisbane Mon 12:00
const MON_11PM = new Date("2026-07-06T13:00:00Z"); // Brisbane Mon 23:00
const SAT_2PM = new Date("2026-07-04T04:00:00Z");  // Brisbane Sat 14:00

test("in-window: Monday noon is inside 09-21", () => {
  assert.equal(isWithinQuietHoursWindow(MON_NOON, ALL_DAYS, BRIS), true);
});

test("out-of-window: Monday 11pm is outside 09-21", () => {
  assert.equal(isWithinQuietHoursWindow(MON_11PM, ALL_DAYS, BRIS), false);
});

test("day filter: Saturday 2pm blocked when days = Mon-Fri, allowed when Sat included", () => {
  assert.equal(isWithinQuietHoursWindow(SAT_2PM, WEEKDAYS, BRIS), false);
  assert.equal(isWithinQuietHoursWindow(SAT_2PM, ALL_DAYS, BRIS), true);
});

test("overnight window 22:00-06:00 includes 11pm, excludes noon", () => {
  const overnight = { start: "22:00", end: "06:00", tz: BRIS, days: [1, 2, 3, 4, 5, 6, 7] };
  assert.equal(isWithinQuietHoursWindow(MON_11PM, overnight, BRIS), true);
  assert.equal(isWithinQuietHoursWindow(MON_NOON, overnight, BRIS), false);
});

test("getNextQuietHoursStart returns the same instant when already in-window", () => {
  assert.equal(getNextQuietHoursStart(MON_NOON, ALL_DAYS, BRIS).getTime(), MON_NOON.getTime());
});

test("getNextQuietHoursStart snaps forward to the next opening (Tue 09:00 Brisbane)", () => {
  const next = getNextQuietHoursStart(MON_11PM, ALL_DAYS, BRIS);
  assert.ok(next.getTime() > MON_11PM.getTime(), "must move forward");
  assert.equal(isWithinQuietHoursWindow(next, ALL_DAYS, BRIS), true, "must land in-window");
  const expected = new Date("2026-07-06T23:00:00Z").getTime(); // Tue 09:00 Brisbane
  assert.ok(Math.abs(next.getTime() - expected) <= 5 * 60_000, "within one 5-min step of Tue 09:00 Brisbane");
});

test("resolveLeadTimezone: AU prefix -> Brisbane, longest prefix wins, fallback to client tz", () => {
  assert.equal(resolveLeadTimezone("+61412345678", "America/New_York"), "Australia/Brisbane");
  assert.equal(resolveLeadTimezone("+13025551234", "Australia/Brisbane"), "America/New_York");
  assert.equal(resolveLeadTimezone("+35311112222", "Australia/Brisbane"), "Europe/Dublin");
  assert.equal(resolveLeadTimezone(undefined, "Australia/Sydney"), "Australia/Sydney");
  assert.equal(resolveLeadTimezone("+9999999", "Australia/Sydney"), "Australia/Sydney");
});

test("parseQuietHours: valid object parses, junk / missing / empty days -> null", () => {
  assert.deepEqual(parseQuietHours({ start: "08:00", end: "18:00", tz: BRIS, days: [1, 2] }), {
    start: "08:00", end: "18:00", tz: BRIS, days: [1, 2],
  });
  assert.equal(parseQuietHours(null), null);
  assert.equal(parseQuietHours("nope"), null);
  assert.equal(parseQuietHours({ start: "08:00", end: "18:00", tz: BRIS }), null);
  assert.equal(parseQuietHours({ start: "08:00", end: "18:00", tz: BRIS, days: [] }), null);
});

test("QH-TZ-1: invalid tz string falls back to default, isWithinSendingWindow does not throw", () => {
  const cfg = parseQuietHours({ start: "09:00", end: "21:00", tz: "Not/AZone", days: [1, 2, 3, 4, 5] });
  assert.notEqual(cfg, null);
  assert.equal(cfg!.tz, DEFAULT_QUIET_HOURS.tz);
  assert.doesNotThrow(() => isWithinSendingWindow(MON_NOON, cfg!, cfg!.tz));
});

test("QH-TZ-1: valid tz is preserved", () => {
  const cfg = parseQuietHours({ start: "09:00", end: "21:00", tz: "Australia/Perth", days: [1] });
  assert.equal(cfg!.tz, "Australia/Perth");
});

test("DEFAULT_QUIET_HOURS is 09-21 all week Brisbane", () => {
  assert.equal(DEFAULT_QUIET_HOURS.start, "09:00");
  assert.equal(DEFAULT_QUIET_HOURS.end, "21:00");
  assert.deepEqual(DEFAULT_QUIET_HOURS.days, [1, 2, 3, 4, 5, 6, 7]);
});

// ── F17 phase 1: AU Telemarketing Standard clamp ──
test("AU legal clamp: weekday capped at 20:00", () => {
  assert.equal(isWithinAuLegalWindow(new Date("2026-07-06T10:00:00Z"), BRIS), true);  // Mon 20:00
  assert.equal(isWithinAuLegalWindow(new Date("2026-07-06T10:30:00Z"), BRIS), false); // Mon 20:30
});

test("AU legal clamp: Saturday capped at 17:00, Sunday closed", () => {
  assert.equal(isWithinAuLegalWindow(new Date("2026-07-04T07:00:00Z"), BRIS), true);  // Sat 17:00
  assert.equal(isWithinAuLegalWindow(new Date("2026-07-04T07:30:00Z"), BRIS), false); // Sat 17:30
  assert.equal(isWithinAuLegalWindow(new Date("2026-07-05T02:00:00Z"), BRIS), false); // Sun 12:00
});

test("AU legal clamp: national public holiday closed", () => {
  // Australia Day, Mon 26 Jan 2026, noon Brisbane.
  assert.equal(isWithinAuLegalWindow(new Date("2026-01-26T02:00:00Z"), BRIS), false);
});

test("isWithinSendingWindow = client window intersect AU legal (AU tz)", () => {
  const at = new Date("2026-07-06T10:30:00Z"); // Mon 20:30 Brisbane
  assert.equal(isWithinQuietHoursWindow(at, ALL_DAYS, BRIS), true); // client 09-21 says OK
  assert.equal(isWithinSendingWindow(at, ALL_DAYS, BRIS), false);   // AU caps at 20:00
  const holiday = new Date("2026-01-26T02:00:00Z");
  assert.equal(isWithinSendingWindow(holiday, ALL_DAYS, BRIS), false); // holiday blocked
});

test("non-AU timezone: AU clamp is a no-op (delegates to client window)", () => {
  assert.equal(isAuTimezone("America/New_York"), false);
  assert.equal(isAuTimezone("Australia/Brisbane"), true);
  const NY = { start: "09:00", end: "21:00", tz: "America/New_York", days: [1, 2, 3, 4, 5, 6, 7] };
  const at = new Date("2026-07-05T16:00:00Z"); // Sunday around midday in NY
  assert.equal(
    isWithinSendingWindow(at, NY, "America/New_York"),
    isWithinQuietHoursWindow(at, NY, "America/New_York"),
  );
});

test("getNextSendingOpening lands inside the AU legal window", () => {
  const sun = new Date("2026-07-05T02:00:00Z"); // Sunday noon Brisbane
  const open = getNextSendingOpening(sun, ALL_DAYS, BRIS);
  assert.equal(isWithinSendingWindow(open, ALL_DAYS, BRIS), true);
  assert.ok(open.getTime() > sun.getTime(), "must move forward");
});
