import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveLeadByPhone } from "./leadResolve.ts";

function fakeSupabase(rows: any[]) {
  const calls: any = {};
  const builder: any = {
    select: () => builder, eq: (k: string, v: string) => { calls[k] = v; return builder; },
    order: (col: string, opts: any) => { calls.order = calls.order ?? []; calls.order.push([col, opts]); return builder; },
    limit: (n: number) => { calls.limit = n; return builder; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  };
  return { from: () => builder, _calls: calls };
}

Deno.test("returns the most-recent survivor and orders deterministically", async () => {
  const sb = fakeSupabase([{ id: "winner", updated_at: "2026-06-17T00:00:00Z" }]);
  const lead = await resolveLeadByPhone(sb as any, "client1", "+61405482446");
  assertEquals(lead?.id, "winner");
  assertEquals(sb._calls.client_id, "client1");
  assertEquals(sb._calls.normalized_phone, "+61405482446");
  assertEquals(sb._calls.limit, 1);
  assertEquals(sb._calls.order[0][0], "updated_at");
});

Deno.test("returns null when none match", async () => {
  const sb = fakeSupabase([]);
  assertEquals(await resolveLeadByPhone(sb as any, "c", "+61400000000"), null);
});
