import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPhoneRecentDuplicate } from "./dedup.ts";

// S2b-5: campaign-enroll-webhook must skip a rapid duplicate enrolment for the
// same normalized phone (mirrors ghl-tag-webhook). These lock the query shape +
// the normalize/exclude/fail-open behaviour.

function fakeSupabase(rows: any[]) {
  const calls: any = { eq: {} };
  const builder: any = {
    select: () => builder,
    eq: (k: string, v: string) => { calls.eq[k] = v; return builder; },
    gte: (k: string, v: string) => { calls.gte = [k, v]; return builder; },
    neq: (k: string, v: string) => { calls.neq = [k, v]; return builder; },
    limit: (n: number) => { calls.limit = n; return builder; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  };
  return { from: (t: string) => { calls.table = t; return builder; }, _calls: calls };
}

Deno.test("returns true when a recent different-lead row exists for the normalized phone", async () => {
  const sb = fakeSupabase([{ id: "dupe", created_at: "2026-06-24T00:00:00Z" }]);
  const dup = await isPhoneRecentDuplicate(sb as any, "client1", "0405482446", "lead-current");
  assertEquals(dup, true);
  assertEquals(sb._calls.table, "leads");
  assertEquals(sb._calls.eq.client_id, "client1");
  // raw AU national normalized to E.164 before the query
  assertEquals(sb._calls.eq.normalized_phone, "+61405482446");
  assertEquals(sb._calls.neq[0], "lead_id");
  assertEquals(sb._calls.neq[1], "lead-current");
  assert(Array.isArray(sb._calls.gte));
});

Deno.test("returns false when no recent row matches", async () => {
  const sb = fakeSupabase([]);
  assertEquals(await isPhoneRecentDuplicate(sb as any, "c", "+61400000000", null), false);
});

Deno.test("returns false (no query) for an unnormalisable / empty phone", async () => {
  const sb = fakeSupabase([{ id: "should-not-be-read" }]);
  assertEquals(await isPhoneRecentDuplicate(sb as any, "c", "", null), false);
  assertEquals(await isPhoneRecentDuplicate(sb as any, "c", null, null), false);
  // builder.from never invoked -> table stays undefined
  assertEquals(sb._calls.table, undefined);
});

Deno.test("omits the neq exclusion when excludeLeadId is null", async () => {
  const sb = fakeSupabase([]);
  await isPhoneRecentDuplicate(sb as any, "c", "+61400000000", null);
  assertEquals(sb._calls.neq, undefined);
});

Deno.test("fails open (returns false) on a query error", async () => {
  const builder: any = {
    select: () => builder, eq: () => builder, gte: () => builder, neq: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
  };
  const sb = { from: () => builder };
  assertEquals(await isPhoneRecentDuplicate(sb as any, "c", "+61400000000", "x"), false);
});
