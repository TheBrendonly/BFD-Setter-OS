import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lintTextSetterPrompt } from "./promptLint.ts";

// PROMPT-AUTH-1 — save-time lint. The reject rules are calibrated against the
// exact stale content found live in the BFD Setter-1 row on 2026-07-03; the
// clean-pass cases are calibrated against legitimate persona/qualification copy
// so the lint can't brick a normal save.

Deno.test("rejects the incident's literal stale lines (from the live Setter-1 row)", () => {
  const stale = [
    "## BOOKING CONSTRAINTS",
    "",
    "**Available days:** Tuesday, Wednesday, Thursday ONLY.",
    "",
    "- **Current time:** {{ $now }}",
    "",
    "1. Verify the slot is actually available via `Get_Available_Slot`.",
  ].join("\n");
  const r = lintTextSetterPrompt(stale);
  assertEquals(r.ok, false);
  const rules = r.errors.map((e) => e.rule);
  assert(rules.includes("weekday-availability-policy"), `rules: ${rules.join(",")}`);
  assert(rules.includes("unresolved-template-token"));
  assert(rules.includes("legacy-tool-name"));
  // line numbers are 1-based and point at the offending lines
  const dayFinding = r.errors.find((e) => e.rule === "weekday-availability-policy")!;
  assertEquals(dayFinding.line, 3);
});

Deno.test("rejects every legacy n8n tool name", () => {
  for (const name of [
    "Get_Available_Slot",
    "bookAppointment",
    "createContact",
    "getContactAppointments1",
    "updateAppointment1",
    "cancelAppointment1",
  ]) {
    const r = lintTextSetterPrompt(`Call \`${name}\` to proceed.`);
    assertEquals(r.ok, false, `${name} should be rejected`);
    assertEquals(r.errors[0].rule, "legacy-tool-name");
  }
});

Deno.test("rejects the legacy template header and 'we only book' day policies", () => {
  assertEquals(lintTextSetterPrompt("# SERVICE FUNCTIONS - TEXT AGENT WORKFLOW").ok, false);
  assertEquals(lintTextSetterPrompt("We only book calls on Tuesdays.").ok, false);
  assertEquals(lintTextSetterPrompt("Only available Wednesday, sorry.").ok, false);
  assertEquals(lintTextSetterPrompt("Bookings Tuesday, Wednesday, Thursday ONLY").ok, false);
});

Deno.test("warns (not rejects) on example times, {value}, EST default, duplicate headings", () => {
  const text = [
    "## GOAL",
    "Booked for this Thursday at 2pm!",
    "## MAX PUSHBACK: {value}",
    "If unclear, default to EST for scheduling.",
    "## GOAL",
    "Engage and qualify.",
  ].join("\n");
  const r = lintTextSetterPrompt(text);
  assertEquals(r.ok, true); // warnings never block
  const rules = r.warnings.map((w) => w.rule);
  assert(rules.includes("example-booking-time"), rules.join(","));
  assert(rules.includes("unresolved-value-token"));
  assert(rules.includes("hardcoded-timezone-default"));
  assert(rules.includes("duplicate-heading"));
});

Deno.test("clean persona/qualification copy passes with no findings", () => {
  const clean = [
    "# IDENTITY",
    "You are Alex, the friendly scheduling assistant for Building Flow Digital.",
    "",
    "## GOAL: ENGAGE & QUALIFY",
    "Ask about their business, volume of inbound leads, and current follow-up process.",
    "",
    "## TONE",
    "Casual Australian English. Short SMS-length replies. Never pushy.",
    "",
    "We can find a time that suits you any day the calendar is open.",
    "Our team is available to help with onboarding questions on weekdays.",
  ].join("\n");
  const r = lintTextSetterPrompt(clean);
  assertEquals(r.ok, true, JSON.stringify(r.errors));
  assertEquals(r.errors.length, 0);
  assertEquals(r.warnings.length, 0);
});

Deno.test("the new minimal DEFAULT_BOOKING_PROMPT-style content passes", () => {
  const modern = [
    "# BOOKING APPROACH",
    "",
    "The system handles booking mechanics for you: a live calendar availability snapshot and the real current date and time are injected into your context every turn, and the booking tools (get-available-slots, book-appointments, get-contact-appointments, update-appointment, cancel-appointments, schedule-callback) are always available.",
    "",
    "Rules:",
    "- The injected live calendar is the ONLY source of truth for availability. Never state a day or time policy of your own.",
    "- Offer only times from the injected availability, and book the exact date and time the lead accepts.",
    "- Keep booking conversational: qualify first when natural, offer 2-3 concrete options, confirm the booked day and time back in plain language.",
  ].join("\n");
  const r = lintTextSetterPrompt(modern);
  assertEquals(r.ok, true, JSON.stringify(r.errors));
  assertEquals(r.errors.length, 0);
});

Deno.test("empty / null-ish input never throws", () => {
  assertEquals(lintTextSetterPrompt("").ok, true);
  assertEquals(lintTextSetterPrompt(undefined as unknown as string).ok, true);
});

// PROMPT-LINT-1 — the save-time lint was itself bypassable by casing/wording
// variants of the exact content it exists to block (found by the parallel
// adversarial review of PROMPT-AUTH-1, 2026-07-03).

Deno.test("case-insensitive: PascalCase and ALL-CAPS legacy tool names are rejected", () => {
  assertEquals(lintTextSetterPrompt("Call `BookAppointment` now.").ok, false);
  assertEquals(lintTextSetterPrompt("Use GET_AVAILABLE_SLOT to check.").ok, false);
});

Deno.test("case-insensitive: lowercased legacy template header is rejected", () => {
  assertEquals(lintTextSetterPrompt("# service functions - text agent workflow").ok, false);
});

Deno.test("abbreviated weekday range 'Mon-Fri' is rejected", () => {
  assertEquals(lintTextSetterPrompt("We're open Mon-Fri only, sorry.").ok, false);
  assertEquals(lintTextSetterPrompt("Available Monday-Friday, no exceptions.").ok, false);
});

Deno.test("reworded restrictive day policies are rejected", () => {
  assertEquals(lintTextSetterPrompt("We don't book on Tuesdays.").ok, false);
  assertEquals(lintTextSetterPrompt("Tuesdays and Wednesdays are the only days we're open.").ok, false);
});

Deno.test("broadened patterns still let clean copy through with no false positives", () => {
  const clean = [
    "# IDENTITY",
    "You are Alex, the friendly scheduling assistant for Building Flow Digital.",
    "",
    "Our team is available to help with onboarding questions on weekdays.",
    "We can find a time that suits you any day the calendar is open.",
  ].join("\n");
  const r = lintTextSetterPrompt(clean);
  assertEquals(r.ok, true, JSON.stringify(r.errors));
  assertEquals(r.errors.length, 0);
});

// PROMPT-LINT-1 review follow-up: the first hyphenated-range pattern used bare
// stems + \w*, so ordinary compound words ("wedding-friendly") matched as a
// day range and 422-blocked legitimate saves.
Deno.test("hyphenated compound words are NOT day ranges (no save-blocking false positives)", () => {
  const clean = [
    "We recommend a wedding-friendly venue for the demo.",
    "Keep replies thumb-friendly and satisfaction-friendly.",
    "Use a monitor-friendly layout.",
    "The sunset-thursday palette is our brand accent.",
  ].join("\n");
  const r = lintTextSetterPrompt(clean);
  assertEquals(r.ok, true, JSON.stringify(r.errors));
  assertEquals(r.errors.length, 0);
});

Deno.test("real abbreviated and plural day ranges are still rejected", () => {
  assertEquals(lintTextSetterPrompt("Bookings Tues-Thurs.").ok, false);
  assertEquals(lintTextSetterPrompt("Open Mondays-Fridays.").ok, false);
  assertEquals(lintTextSetterPrompt("Mon - Fri only.").ok, false);
});
