import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveBookingSource } from "./bookingSource.ts";

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
