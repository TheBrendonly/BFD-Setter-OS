import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
