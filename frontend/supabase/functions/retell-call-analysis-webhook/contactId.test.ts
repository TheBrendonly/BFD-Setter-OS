// Unit test for resolveContactId(). Runs under Node 22+ via:
//   node --experimental-strip-types --test contactId.test.ts
// (also valid as a Deno test once `deno` is on the runner — node:test and
// node:assert/strict are TC39-aligned imports that Deno 1.x supports natively.)
import test from "node:test";
import { strict as assert } from "node:assert";
import { resolveContactId } from "./contactId.ts";

test("resolveContactId prefers ghl_contact_id (BFD cadence emits this)", () => {
  assert.equal(
    resolveContactId({
      ghl_contact_id: "A",
      contact_id: "B",
      Contact_ID: "C",
      Lead_ID: "D",
    }),
    "A",
  );
});

test("resolveContactId falls back to contact_id", () => {
  assert.equal(
    resolveContactId({ contact_id: "B", Contact_ID: "C", Lead_ID: "D" }),
    "B",
  );
});

test("resolveContactId falls back to Contact_ID", () => {
  assert.equal(resolveContactId({ Contact_ID: "C", Lead_ID: "D" }), "C");
});

test("resolveContactId falls back to Lead_ID", () => {
  assert.equal(resolveContactId({ Lead_ID: "D" }), "D");
});

test("resolveContactId returns null when no candidates present", () => {
  assert.equal(resolveContactId({}), null);
});

test("resolveContactId treats empty string as falsy and falls through", () => {
  assert.equal(
    resolveContactId({ ghl_contact_id: "", contact_id: "B" }),
    "B",
  );
});

test("resolveContactId handles null / undefined input", () => {
  assert.equal(resolveContactId(null), null);
  assert.equal(resolveContactId(undefined), null);
});
