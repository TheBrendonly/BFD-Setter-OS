import { test } from "node:test";
import assert from "node:assert/strict";
import { recordLlmCost } from "./recordLlmCost.ts";

// A minimal supabase stub that records every .from(t).upsert(row, opts) call.
function fakeSupabase(error: { message: string } | null = null) {
  const calls: Array<{ table: string; row: Record<string, unknown>; opts: unknown }> = [];
  const supabase = {
    calls,
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, opts: unknown) {
          calls.push({ table, row, opts });
          return Promise.resolve({ error });
        },
      };
    },
  };
  return supabase;
}

test("actual path: usage.cost>0 writes an is_estimated=false llm row", async () => {
  const sb = fakeSupabase();
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-abc",
    model: "google/gemini-2.5-pro",
    usage: { cost: 0.5, prompt_tokens: 1000, completion_tokens: 500 },
    executionId: "exec-1",
    leadId: "lead-1",
  });
  assert.equal(res.written, true);
  assert.equal(res.isEstimated, false);
  assert.equal(res.costUsd, 0.5);
  assert.equal(sb.calls.length, 1);
  const call = sb.calls[0];
  assert.equal(call.table, "execution_cost_events");
  assert.deepEqual(call.opts, { onConflict: "cost_kind,provider_ref" });
  assert.equal(call.row.cost_kind, "llm");
  assert.equal(call.row.cost_usd, 0.5);
  assert.equal(call.row.is_estimated, false);
  assert.equal(call.row.provider_ref, "run-abc");
  assert.equal(call.row.client_id, "client-1");
  assert.equal(call.row.execution_id, "exec-1");
  assert.equal(call.row.lead_id, "lead-1");
});

test("fallback path: no usage.cost estimates from tokens with is_estimated=true", async () => {
  const sb = fakeSupabase();
  // gemini-2.5-pro: prompt 0.00000125, completion 0.000005
  // 1000*0.00000125 + 500*0.000005 = 0.00125 + 0.0025 = 0.00375
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-def",
    model: "google/gemini-2.5-pro",
    usage: { prompt_tokens: 1000, completion_tokens: 500 },
  });
  assert.equal(res.written, true);
  assert.equal(res.isEstimated, true);
  assert.equal(res.costUsd, 0.00375);
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].row.is_estimated, true);
  assert.equal(sb.calls[0].row.cost_usd, 0.00375);
});

test("cost=0 as actual is treated as no-cost and falls back to the token estimate", async () => {
  const sb = fakeSupabase();
  // usage.cost=0 must NOT be billed as an actual $0 row; tokens estimate instead.
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-zero-cost",
    model: "google/gemini-2.5-pro",
    usage: { cost: 0, prompt_tokens: 1000, completion_tokens: 500 },
  });
  assert.equal(res.written, true);
  assert.equal(res.isEstimated, true);
  assert.equal(res.costUsd, 0.00375);
});

test("no usable cost or tokens: skips the upsert entirely (no zero rows)", async () => {
  const sb = fakeSupabase();
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-empty",
    model: "google/gemini-2.5-pro",
    usage: { cost: 0, prompt_tokens: 0, completion_tokens: 0 },
  });
  assert.equal(res.written, false);
  assert.equal(sb.calls.length, 0);
});

test("null usage: skips the upsert entirely", async () => {
  const sb = fakeSupabase();
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-null",
    model: "google/gemini-2.5-pro",
    usage: null,
  });
  assert.equal(res.written, false);
  assert.equal(sb.calls.length, 0);
});

test("missing clientId or providerRef: no write, no throw", async () => {
  const sb = fakeSupabase();
  const a = await recordLlmCost({
    supabase: sb as never,
    clientId: "",
    providerRef: "run-x",
    model: "m",
    usage: { cost: 0.5 },
  });
  const b = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "",
    model: "m",
    usage: { cost: 0.5 },
  });
  assert.equal(a.written, false);
  assert.equal(b.written, false);
  assert.equal(sb.calls.length, 0);
});

test("fallbackCostUsd replaces the token estimate when usage.cost is absent", async () => {
  const sb = fakeSupabase();
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-fallback",
    model: "google/gemini-2.5-pro",
    usage: { prompt_tokens: 1000, completion_tokens: 500 }, // token est would be 0.00375
    fallbackCostUsd: 0.03, // caller's own estimate wins over token math
  });
  assert.equal(res.written, true);
  assert.equal(res.isEstimated, true);
  assert.equal(res.costUsd, 0.03);
  assert.equal(sb.calls[0].row.cost_usd, 0.03);
  assert.equal(sb.calls[0].row.is_estimated, true);
});

test("actual usage.cost still wins over fallbackCostUsd", async () => {
  const sb = fakeSupabase();
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-actual-over-fallback",
    model: "google/gemini-2.5-pro",
    usage: { cost: 0.5 },
    fallbackCostUsd: 0.03,
  });
  assert.equal(res.written, true);
  assert.equal(res.isEstimated, false);
  assert.equal(res.costUsd, 0.5);
});

test("upsert error is swallowed (non-fatal), returns written=false without throwing", async () => {
  const sb = fakeSupabase({ message: "boom" });
  const res = await recordLlmCost({
    supabase: sb as never,
    clientId: "client-1",
    providerRef: "run-err",
    model: "google/gemini-2.5-pro",
    usage: { cost: 0.5 },
  });
  assert.equal(res.written, false);
  assert.equal(res.costUsd, 0.5);
  assert.equal(sb.calls.length, 1); // it attempted the upsert
});
