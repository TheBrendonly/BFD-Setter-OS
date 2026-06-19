import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildExistingLeadUpdatePayload,
  identityFieldsInPayload,
  IDENTITY_FIELDS,
} from "./sync-identity-guard.ts";

// BUG B regression: existing-lead GHL contact.update must NOT overwrite
// first_name / last_name / email / phone (BFD-wins on identity fields).

Deno.test("existing-lead update payload contains no identity fields", () => {
  const payload = buildExistingLeadUpdatePayload();
  const leaked = identityFieldsInPayload(payload);
  assertEquals(
    leaked,
    [],
    `Identity fields must not appear in existing-lead update: found ${leaked.join(", ")}`,
  );
});

Deno.test("existing-lead update payload only contains updated_at", () => {
  const payload = buildExistingLeadUpdatePayload();
  const keys = Object.keys(payload);
  assertEquals(keys, ["updated_at"], "Only updated_at should be present");
});

Deno.test("identityFieldsInPayload catches all four identity fields", () => {
  // Simulate a buggy payload that includes identity fields.
  const buggyPayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    first_name: "Alice",
    last_name: "Smith",
    email: "alice@example.com",
    phone: "+61400000000",
  };
  const leaked = identityFieldsInPayload(buggyPayload);
  assertEquals(
    leaked.sort(),
    [...IDENTITY_FIELDS].sort(),
    "Should detect all four identity fields in a payload that includes them",
  );
});

Deno.test("identityFieldsInPayload: cleared field (null) detected as identity field if present in payload", () => {
  // A cleared identity field must not appear in the existing-lead update payload
  // at all — not even as null. GHL can clear it via push-contact-to-ghl instead.
  const payloadWithNull: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    email: null,
  };
  const leaked = identityFieldsInPayload(payloadWithNull);
  assertEquals(leaked, ["email"], "Null identity field still counts as a leak");
});

// BUG 6.4 regression: phone-REMOVAL must stick. When a phone is cleared in the
// BFD UI, push-contact-to-ghl clears it in GHL (phone null !== undefined, so it
// IS pushed); a subsequent GHL contact.update echo must NOT re-introduce the old
// phone. The existing-lead path proves this by never carrying phone at all.

Deno.test("BUG 6.4: existing-lead update payload never carries phone (cleared phone stays cleared)", () => {
  const payload = buildExistingLeadUpdatePayload();
  assertEquals(
    identityFieldsInPayload(payload),
    [],
    "phone must never appear on the existing-lead update path",
  );
  assert(!("phone" in payload), "phone key must be absent so a GHL echo can't rewrite it");
});

Deno.test("BUG 6.4: a cleared phone (null) is still flagged as a leak if it ever appears", () => {
  const buggy: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    phone: null,
  };
  assertEquals(
    identityFieldsInPayload(buggy),
    ["phone"],
    "null phone in the payload still counts as a BFD-overwrite leak",
  );
});
