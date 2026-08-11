import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clientIpFromHeaders,
  DEMO_PROSPECTS,
  ipBucketKey,
  isWithinCallingHours,
  phoneBucketKey,
  resolveProspect,
  slugBucketKey,
  slugSpacingBucketKey,
  validateCallbackRequest,
} from "./prospects.ts";

function body(overrides: Record<string, unknown> = {}) {
  return {
    first_name: "Brendan",
    email: "brendan@buildingflowdigital.com",
    phone: "0405482446",
    ...overrides,
  };
}

// ── validation ──

Deno.test("accepts a well-formed request and normalizes the phone to E.164", () => {
  const result = validateCallbackRequest(body());
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.normalizedPhone, "+61405482446");
  assertEquals(result.value.firstName, "Brendan");
  assertEquals(result.value.email, "brendan@buildingflowdigital.com");
});

Deno.test("accepts an already-E.164 AU mobile", () => {
  const result = validateCallbackRequest(body({ phone: "+61 405 482 446" }));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.normalizedPhone, "+61405482446");
});

Deno.test("lowercases and trims the email", () => {
  const result = validateCallbackRequest(body({ email: "  Brendan@Example.COM " }));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.email, "brendan@example.com");
});

Deno.test("rejects a missing or blank first name", () => {
  assertEquals(validateCallbackRequest(body({ first_name: "   " })).ok, false);
  assertEquals(validateCallbackRequest(body({ first_name: undefined })).ok, false);
});

Deno.test("rejects a malformed email", () => {
  for (const email of ["nope", "a@b", "a b@c.com", ""]) {
    assertEquals(validateCallbackRequest(body({ email })).ok, false, `expected reject: ${email}`);
  }
});

Deno.test("rejects an AU landline — mobiles only", () => {
  // +61 2 9999 9999 normalizes fine but is not a mobile.
  assertEquals(validateCallbackRequest(body({ phone: "0299999999" })).ok, false);
});

Deno.test("rejects non-AU numbers — international toll-fraud guard", () => {
  for (const phone of ["+14155550123", "+442071838750", "+6427123456"]) {
    assertEquals(validateCallbackRequest(body({ phone })).ok, false, `expected reject: ${phone}`);
  }
});

Deno.test("rejects unparseable phone input", () => {
  for (const phone of ["", "abc", "123"]) {
    assertEquals(validateCallbackRequest(body({ phone })).ok, false, `expected reject: ${phone}`);
  }
});

Deno.test("rejects a non-object body", () => {
  assertEquals(validateCallbackRequest(null).ok, false);
  assertEquals(validateCallbackRequest("nope").ok, false);
});

Deno.test("truncates an overlong name rather than rejecting it", () => {
  const result = validateCallbackRequest(body({ first_name: "a".repeat(500) }));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.firstName.length, 80);
});

// ── prospect registry ──

Deno.test("resolves a known slug case-insensitively", () => {
  // Every registered prospect resolves once its setter id is filled in.
  for (const [slug, prospect] of Object.entries(DEMO_PROSPECTS)) {
    if (prospect.voiceSetterId.startsWith("__")) continue;
    assertEquals(resolveProspect(slug.toUpperCase())?.slug, slug);
  }
});

Deno.test("refuses an unknown slug", () => {
  assertEquals(resolveProspect("not-a-prospect"), null);
  assertEquals(resolveProspect(""), null);
  assertEquals(resolveProspect(undefined), null);
  assertEquals(resolveProspect(42), null);
});

Deno.test("refuses a prospect whose setter is not provisioned yet", () => {
  // Guards the placeholder state: a registry entry added before the Retell
  // persona exists must not dial with a bogus setter id.
  const pending = Object.values(DEMO_PROSPECTS).filter((p) => p.voiceSetterId.startsWith("__"));
  for (const prospect of pending) {
    assertEquals(resolveProspect(prospect.slug), null);
  }
});

Deno.test("every registry entry is internally consistent", () => {
  for (const [key, prospect] of Object.entries(DEMO_PROSPECTS)) {
    assertEquals(key, prospect.slug, "registry key must match its slug");
    assertEquals(key, key.toLowerCase(), "registry keys must be lowercase");
    assertEquals(prospect.clientId.length, 36, "clientId must be a uuid");
    assertEquals(prospect.firmName.length > 0, true);
  }
});

Deno.test("prototype-chain slugs resolve to null, not a crash", () => {
  // "__proto__"/"constructor" index the prototype on a plain object; without
  // the hasOwn guard resolveProspect would throw instead of 404ing.
  assertEquals(resolveProspect("__proto__"), null);
  assertEquals(resolveProspect("constructor"), null);
  assertEquals(resolveProspect("toString"), null);
});

// ── rate limit buckets ──

Deno.test("bucket keys are namespaced and distinct per subject and dimension", () => {
  assertEquals(phoneBucketKey("+61405482446"), "demo-callback:phone:+61405482446");
  assertEquals(slugBucketKey("stapleton-finance"), "demo-callback:slug:stapleton-finance");
  assertEquals(ipBucketKey("203.0.113.7"), "demo-callback:ip:203.0.113.7");
  assertEquals(slugSpacingBucketKey("stapleton-finance"), "demo-callback:slugmin:stapleton-finance");
  assertEquals(phoneBucketKey("+61400000000") === phoneBucketKey("+61405482446"), false);
  // The daily-cap and spacing buckets for one slug must never collide.
  assertEquals(slugBucketKey("x") === slugSpacingBucketKey("x"), false);
});

Deno.test("clientIpFromHeaders takes the first x-forwarded-for hop", () => {
  assertEquals(
    clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    "203.0.113.7",
  );
  assertEquals(clientIpFromHeaders(new Headers({ "x-forwarded-for": " 198.51.100.2 " })), "198.51.100.2");
  assertEquals(clientIpFromHeaders(new Headers()), null);
  assertEquals(clientIpFromHeaders(new Headers({ "x-forwarded-for": "" })), null);
});

// ── calling hours ──

Deno.test("calling hours: inside the Sydney window", () => {
  // 2026-08-11T02:00Z = midday AEST (UTC+10).
  assertEquals(isWithinCallingHours(new Date("2026-08-11T02:00:00Z"), "Australia/Sydney"), true);
});

Deno.test("calling hours: 11pm Sydney is outside the window", () => {
  // 2026-08-11T13:00Z = 11pm AEST.
  assertEquals(isWithinCallingHours(new Date("2026-08-11T13:00:00Z"), "Australia/Sydney"), false);
});

Deno.test("calling hours: boundaries — 8am is in, 8pm is out", () => {
  // 22:00Z = 8am AEST next day; 10:00Z = 8pm AEST.
  assertEquals(isWithinCallingHours(new Date("2026-08-10T22:00:00Z"), "Australia/Sydney"), true);
  assertEquals(isWithinCallingHours(new Date("2026-08-11T10:00:00Z"), "Australia/Sydney"), false);
});

Deno.test("calling hours: an invalid timezone fails open", () => {
  assertEquals(isWithinCallingHours(new Date("2026-08-11T13:00:00Z"), "Not/AZone"), true);
});
