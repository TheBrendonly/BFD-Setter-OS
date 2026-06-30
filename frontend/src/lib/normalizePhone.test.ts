// PHONE-CLEAR-1 — unit tests for the frontend phone normalizer (mirror of
// supabase/functions/_shared/phone.ts). The frontend lead-detail save writes leads
// directly from the browser and omitted normalized_phone, so clearing/changing a
// lead's phone left the OLD normalized_phone in place — still inbound-/STOP-matchable
// by the old number (by-phone resolution keys off normalized_phone since the Session-5
// pivot). ContactDetail now recomputes normalized_phone via this helper on save.
//
// Frontend has no test runner; run this ad-hoc with Node 22+:
//   node --experimental-strip-types --test frontend/src/lib/normalizePhone.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import { normalizePhone } from "./normalizePhone.ts";

test("AU national / subscriber / +country formats normalise to E.164", () => {
  assert.equal(normalizePhone("0412345678"), "+61412345678");
  assert.equal(normalizePhone("+61412345678"), "+61412345678");
  assert.equal(normalizePhone("412345678"), "+61412345678");
  assert.equal(normalizePhone("61412345678"), "+61412345678");
  assert.equal(normalizePhone("(04) 1234 5678"), "+61412345678");
});

test("PHONE-CLEAR-1: a cleared/empty phone normalises to null (not the old number)", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), null);
  assert.equal(normalizePhone("   "), null);
});
