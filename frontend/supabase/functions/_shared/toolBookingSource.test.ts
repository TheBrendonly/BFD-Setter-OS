import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bookingSourceFromBody } from "./toolBookingSource.ts";

// §3.12 SMS tool parity: book-appointments must let the caller stamp the
// booking origin (e.g. SMS sends source="sms") while voice/Retell callers,
// which never send a source, keep the historical "voice_call" default.

Deno.test("bookingSourceFromBody: explicit sms source is honored", () => {
  assertEquals(bookingSourceFromBody({ source: "sms" }), "sms");
});

Deno.test("bookingSourceFromBody: missing source defaults to voice_call (voice regression guard)", () => {
  assertEquals(bookingSourceFromBody({}), "voice_call");
});

Deno.test("bookingSourceFromBody: empty-string source defaults to voice_call", () => {
  assertEquals(bookingSourceFromBody({ source: "" }), "voice_call");
});

Deno.test("bookingSourceFromBody: non-string source defaults to voice_call", () => {
  assertEquals(bookingSourceFromBody({ source: 123 }), "voice_call");
});

Deno.test("bookingSourceFromBody: any non-empty string source is passed through", () => {
  assertEquals(bookingSourceFromBody({ source: "sms_link" }), "sms_link");
});
