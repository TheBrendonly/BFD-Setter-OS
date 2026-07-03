// PROMPT-AUTH-1 — unit tests for the assembly-time current-time anchor.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/timeAnchor.test.ts
//
// The incident: the stored prompt's only "now" was a literal {{ $now }} the native
// engine never interpolates, so the model guessed "this Thursday" and booked Friday.
// These tests prove the injected block carries a real tz-local date, day-of-week,
// ISO offset, and unambiguous relative-day anchors, across timezone boundaries,
// DST, invalid timezones, and month/year rollovers.
import test from "node:test";
import { strict as assert } from "node:assert";
import { buildTimeAnchorBlock, resolveClientTimeZone, DEFAULT_TIMEZONE } from "./timeAnchor.ts";

// 2026-07-03T04:20:00Z = Friday 2026-07-03 14:20 in Australia/Brisbane (+10:00).
const INCIDENT_NOW = Date.parse("2026-07-03T04:20:00Z");

test("Brisbane: real day-of-week, local ISO with offset, and tz name", () => {
  const block = buildTimeAnchorBlock("Australia/Brisbane", INCIDENT_NOW);
  assert.match(block, /## Current date & time \(ground truth\)/);
  assert.match(block, /Today is Friday, 3 July 2026, 14:20 in Australia\/Brisbane/);
  assert.match(block, /2026-07-03T14:20\+10:00/);
});

test("Brisbane: relative-day anchors resolve the incident's 'this Thursday' correctly", () => {
  const block = buildTimeAnchorBlock("Australia/Brisbane", INCIDENT_NOW);
  // Friday 2026-07-03 -> this Monday = 2026-07-06 (the open day the setter refused),
  // this Thursday = 2026-07-09 (what "Thursday 2pm" should have meant).
  assert.match(block, /Tomorrow = Saturday 2026-07-04\./);
  assert.match(block, /this Monday = 2026-07-06/);
  assert.match(block, /this Thursday = 2026-07-09/);
  assert.match(block, /next Friday = 2026-07-10/);
  assert.match(block, /next Thursday = 2026-07-16/);
});

test("UTC-vs-local day mismatch: late UTC evening is already the NEXT day in Brisbane", () => {
  // 2026-07-03T20:00:00Z = Saturday 2026-07-04 06:00 in Brisbane.
  const nowMs = Date.parse("2026-07-03T20:00:00Z");
  const block = buildTimeAnchorBlock("Australia/Brisbane", nowMs);
  assert.match(block, /Today is Saturday, 4 July 2026/);
  assert.match(block, /this Monday = 2026-07-06/);
});

test("DST timezone (Australia/Sydney, AEDT +11:00 in January)", () => {
  // 2026-01-15T02:00:00Z = Thursday 2026-01-15 13:00 AEDT.
  const nowMs = Date.parse("2026-01-15T02:00:00Z");
  const block = buildTimeAnchorBlock("Australia/Sydney", nowMs);
  assert.match(block, /Today is Thursday, 15 January 2026, 13:00 in Australia\/Sydney/);
  assert.match(block, /2026-01-15T13:00\+11:00/);
});

test("null / invalid timezone falls back to the business default (Australia/Sydney), never throws", () => {
  // PROMPT-AUTH-1 hardening: the anchor's fallback must match the booking pipeline's
  // (Australia/Sydney), NOT UTC — a UTC anchor beside a Sydney-keyed slot map
  // re-introduces the off-by-one-day bug. INCIDENT_NOW is 04:20Z = 14:20 Sydney (AEST +10, July).
  const blockNull = buildTimeAnchorBlock(null, INCIDENT_NOW);
  assert.match(blockNull, /Today is Friday, 3 July 2026, 14:20 in Australia\/Sydney/);
  assert.match(blockNull, /2026-07-03T14:20\+10:00/);

  const blockBad = buildTimeAnchorBlock("Not/AZone", INCIDENT_NOW);
  assert.match(blockBad, /in Australia\/Sydney/);
});

test("month rollover: anchors cross into the next month with correct dates", () => {
  // Wednesday 2026-07-29 10:00 Brisbane.
  const nowMs = Date.parse("2026-07-29T00:00:00Z");
  const block = buildTimeAnchorBlock("Australia/Brisbane", nowMs);
  assert.match(block, /Today is Wednesday, 29 July 2026/);
  assert.match(block, /this Saturday = 2026-08-01/);
});

test("block instructs the model to ignore stale {{ \\$now }} residue and never guess", () => {
  const block = buildTimeAnchorBlock("Australia/Brisbane", INCIDENT_NOW);
  assert.match(block, /\{\{ \$now \}\}/);
  assert.match(block, /Never guess or compute a date yourself/);
});

test("resolveClientTimeZone: valid IANA passes through, null/invalid -> business default", () => {
  assert.equal(resolveClientTimeZone("Australia/Sydney"), "Australia/Sydney");
  assert.equal(resolveClientTimeZone("Australia/Perth"), "Australia/Perth");
  assert.equal(DEFAULT_TIMEZONE, "Australia/Sydney");
  assert.equal(resolveClientTimeZone(null), DEFAULT_TIMEZONE);
  assert.equal(resolveClientTimeZone(undefined), DEFAULT_TIMEZONE);
  assert.equal(resolveClientTimeZone(""), DEFAULT_TIMEZONE);
  assert.equal(resolveClientTimeZone("AEST"), DEFAULT_TIMEZONE); // not a valid IANA name
  assert.equal(resolveClientTimeZone("Not/AZone"), DEFAULT_TIMEZONE);
});
