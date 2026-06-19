import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLeadInsert } from "./lead-insert.ts";

// BUG 6.10 regression: every lead-create path must derive normalized_phone from
// phone, so resolveLeadByPhone (which matches normalized_phone ONLY) can find the
// lead. sync-ghl-contact + campaign-enroll-webhook previously omitted it.

Deno.test("buildLeadInsert derives normalized_phone (E.164) from an AU national phone", () => {
  const row = buildLeadInsert({
    clientId: "c1",
    leadId: "lead_1",
    firstName: "Ada",
    lastName: "Lovelace",
    phone: "0405482446",
    email: "ada@example.com",
  });
  assertEquals(row.phone, "0405482446");
  assertEquals(row.normalized_phone, "+61405482446");
});

Deno.test("buildLeadInsert: null phone -> phone null AND normalized_phone null, no throw", () => {
  const row = buildLeadInsert({
    clientId: "c1",
    leadId: "lead_1",
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
  });
  assertEquals(row.phone, null);
  assertEquals(row.normalized_phone, null);
});

Deno.test("buildLeadInsert: empty-string phone -> phone null AND normalized_phone null", () => {
  const row = buildLeadInsert({
    clientId: "c1",
    leadId: "lead_1",
    firstName: "X",
    lastName: "Y",
    phone: "",
    email: null,
  });
  assertEquals(row.phone, null);
  assertEquals(row.normalized_phone, null);
});

Deno.test("buildLeadInsert passes through identity + client fields verbatim", () => {
  const row = buildLeadInsert({
    clientId: "client-abc",
    leadId: "lead-xyz",
    firstName: "Grace",
    lastName: "Hopper",
    phone: "+61467853118",
    email: "grace@example.com",
  });
  assertEquals(row.client_id, "client-abc");
  assertEquals(row.lead_id, "lead-xyz");
  assertEquals(row.first_name, "Grace");
  assertEquals(row.last_name, "Hopper");
  assertEquals(row.email, "grace@example.com");
  assertEquals(row.normalized_phone, "+61467853118");
});

Deno.test("buildLeadInsert includes form_source only when provided (sync-ghl vs campaign)", () => {
  const withSource = buildLeadInsert({
    clientId: "c1", leadId: "l1", firstName: null, lastName: null,
    phone: null, email: null, formSource: "new-lead-tag",
  });
  assertEquals(withSource.form_source, "new-lead-tag");

  const withoutSource = buildLeadInsert({
    clientId: "c1", leadId: "l1", firstName: null, lastName: null,
    phone: null, email: null,
  });
  assert(!("form_source" in withoutSource), "form_source must be absent when not passed");
});

Deno.test("buildLeadInsert always includes the normalized_phone key (drop-guard)", () => {
  const row = buildLeadInsert({
    clientId: "c1", leadId: "l1", firstName: null, lastName: null,
    phone: null, email: null,
  });
  assert("normalized_phone" in row, "normalized_phone must always be present in the insert");
});
