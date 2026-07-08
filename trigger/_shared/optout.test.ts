// OPTOUT-FAILOPEN-1: unit test for isPhoneOptedOut fail-closed behavior. Runs under Node 22+ via:
//   node --experimental-strip-types --test trigger/_shared/optout.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import { isPhoneOptedOut } from "./optout.ts";

// Minimal fake matching the .from().select().eq().eq().maybeSingle() chain; maybeSingle resolves to
// the configured { data, error }.
function fakeSupabase(result: { data: unknown; error: unknown }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return { from: () => chain };
}

test("empty phone -> false (nothing to check)", async () => {
  assert.equal(await isPhoneOptedOut(fakeSupabase({ data: null, error: null }), "c1", ""), false);
});

test("opted-out row present -> true", async () => {
  assert.equal(await isPhoneOptedOut(fakeSupabase({ data: { phone: "+61400000001" }, error: null }), "c1", "+61400000001"), true);
});

test("no row, no error -> false (genuinely not opted out)", async () => {
  assert.equal(await isPhoneOptedOut(fakeSupabase({ data: null, error: null }), "c1", "+61400000001"), false);
});

test("OPTOUT-FAILOPEN-1: query error -> true (fail closed, skip the send)", async () => {
  assert.equal(
    await isPhoneOptedOut(fakeSupabase({ data: null, error: { message: "statement timeout" } }), "c1", "+61400000001"),
    true,
  );
});
