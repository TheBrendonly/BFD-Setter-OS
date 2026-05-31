// Unit tests for bulk-reactivation pure helpers. Run under Node 22+ via:
//   node --experimental-strip-types --test frontend/supabase/functions/_shared/reactivate-list.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLeadRow, chunk } from "./reactivate-list.ts";

test("normalizeLeadRow: keeps a row with a phone", () => {
  assert.deepEqual(normalizeLeadRow({ first_name: "Sam", phone: "+61400000000" }), {
    first_name: "Sam",
    last_name: "",
    phone: "+61400000000",
    email: "",
    lead_id: null,
  });
});

test("normalizeLeadRow: keeps a row with only an email", () => {
  const r = normalizeLeadRow({ email: "a@b.com" });
  assert.equal(r?.email, "a@b.com");
  assert.equal(r?.phone, "");
});

test("normalizeLeadRow: drops a row with neither phone nor email", () => {
  assert.equal(normalizeLeadRow({ first_name: "Nobody" }), null);
});

test("normalizeLeadRow: trims fields and accepts camelCase variants", () => {
  const r = normalizeLeadRow({ firstName: " Sam ", lastName: " Lee ", Phone: " 123 " });
  assert.equal(r?.first_name, "Sam");
  assert.equal(r?.last_name, "Lee");
  assert.equal(r?.phone, "123");
});

test("normalizeLeadRow: carries an explicit lead_id (or contact id)", () => {
  assert.equal(normalizeLeadRow({ phone: "1", lead_id: "abc" })?.lead_id, "abc");
  assert.equal(normalizeLeadRow({ phone: "1", id: "xyz" })?.lead_id, "xyz");
});

test("normalizeLeadRow: coerces numeric phone to string", () => {
  assert.equal(normalizeLeadRow({ phone: 61400 })?.phone, "61400");
});

test("normalizeLeadRow: handles Title-Case CSV/contact headers", () => {
  const r = normalizeLeadRow({ "First Name": "Sam", "Last Name": "Lee", "Phone": "123", "Email": "s@l.com", "Lead ID": "ghl_1" });
  assert.deepEqual(r, { first_name: "Sam", last_name: "Lee", phone: "123", email: "s@l.com", lead_id: "ghl_1" });
});

test("chunk: splits into fixed-size batches", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunk: returns whole array as one chunk when size <= 0", () => {
  assert.deepEqual(chunk([1, 2, 3], 0), [[1, 2, 3]]);
});
