import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveBookingSource, isSetterSource } from "./bookingSource.ts";

Deno.test("resolveBookingSource: voice_call existing + ghl_calendar incoming => voice_call preserved", () => {
  assertEquals(resolveBookingSource("voice_call", "ghl_calendar"), "voice_call");
});

Deno.test("resolveBookingSource: null existing => ghl_calendar used", () => {
  assertEquals(resolveBookingSource(null, "ghl_calendar"), "ghl_calendar");
});

Deno.test("resolveBookingSource: undefined existing (new row) => ghl_calendar used", () => {
  assertEquals(resolveBookingSource(undefined, "ghl_calendar"), "ghl_calendar");
});

Deno.test("resolveBookingSource: ghl_calendar existing => ghl_calendar (no change)", () => {
  assertEquals(resolveBookingSource("ghl_calendar", "ghl_calendar"), "ghl_calendar");
});

Deno.test("resolveBookingSource: empty string existing => incomingSource used", () => {
  assertEquals(resolveBookingSource("", "ghl_calendar"), "ghl_calendar");
});

Deno.test("resolveBookingSource: default incomingSource is ghl_calendar", () => {
  assertEquals(resolveBookingSource(null), "ghl_calendar");
});

Deno.test("resolveBookingSource: ANY non-null non-ghl source wins", () => {
  assertEquals(resolveBookingSource("manual", "ghl_calendar"), "manual");
});

// F21(b) — the AI-sourced-only allowlist for the funnel/weekly "booked" headline.
Deno.test("isSetterSource: setter-created sources are AI-sourced (true)", () => {
  for (const s of ["voice_call", "sms", "sms_link"]) assertEquals(isSetterSource(s), true, s);
});

Deno.test("isSetterSource: human/unknown sources are excluded (false)", () => {
  for (const s of ["ghl_calendar", "manual", "intake_form", "", null, undefined]) {
    assertEquals(isSetterSource(s as string | null | undefined), false, String(s));
  }
});
