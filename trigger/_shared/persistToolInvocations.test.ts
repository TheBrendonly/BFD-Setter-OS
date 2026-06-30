// SMS-OBS-1 — unit tests for persistToolInvocations.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/persistToolInvocations.test.ts
//
// Strategy: exercise the REAL persistToolInvocations with a fake platform-supabase
// client. Proves: tool invocations (name/args/result/error) are written to the
// tool_invocations table as one batched insert with the right column mapping; an
// empty list skips the write; a DB error is reported (not thrown); the helper never
// throws (a persistence hiccup must not break the SMS reply).
import test from "node:test";
import { strict as assert } from "node:assert";
import { persistToolInvocations } from "./persistToolInvocations.ts";
import type { ToolInvocation } from "./setterToolLoop.ts";

function makeSupabase(insertResult: { error: unknown } = { error: null }) {
  const calls: Array<{ table: string; rows: any }> = [];
  return {
    calls,
    from(table: string) {
      return {
        insert: async (rows: any) => {
          calls.push({ table, rows });
          return insertResult;
        },
      };
    },
  };
}

const BASE = {
  clientId: "client-abc",
  leadId: "lead-xyz",
  setterSlot: "Setter-1",
  source: "sms",
};

const SAMPLE: ToolInvocation[] = [
  { name: "get-available-slots", args: { startDate: "1", endDate: "2" }, result: { "2026-07-01": { slots: ["x"] } } },
  { name: "book-appointments", args: { startDateTime: "2026-07-01T14:00:00" }, error: "voice-booking-tools book-appointments failed: boom" },
];

test("empty invocations: no insert is attempted, returns ok with count 0", async () => {
  const supabase = makeSupabase();
  const r = await persistToolInvocations({ supabase: supabase as any, ...BASE, invocations: [] });
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.equal(supabase.calls.length, 0, "from()/insert must not be called for an empty list");
});

test("N invocations: one batched insert into tool_invocations with mapped columns", async () => {
  const supabase = makeSupabase();
  const r = await persistToolInvocations({ supabase: supabase as any, ...BASE, invocations: SAMPLE });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(supabase.calls.length, 1, "exactly one insert call (batched)");
  assert.equal(supabase.calls[0].table, "tool_invocations");
  const rows = supabase.calls[0].rows;
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 2);

  // Row 0 — a successful get-available-slots
  assert.equal(rows[0].client_id, "client-abc");
  assert.equal(rows[0].lead_id, "lead-xyz");
  assert.equal(rows[0].setter_slot, "Setter-1");
  assert.equal(rows[0].source, "sms");
  assert.equal(rows[0].invocation_index, 0);
  assert.equal(rows[0].name, "get-available-slots");
  assert.deepEqual(rows[0].args, { startDate: "1", endDate: "2" });
  assert.deepEqual(rows[0].result, { "2026-07-01": { slots: ["x"] } });
  assert.equal(rows[0].error ?? null, null);

  // Row 1 — a failed book-appointments
  assert.equal(rows[1].invocation_index, 1);
  assert.equal(rows[1].name, "book-appointments");
  assert.match(rows[1].error, /failed: boom/);
});

test("DB insert error: reported as ok:false, never thrown", async () => {
  const supabase = makeSupabase({ error: { message: "permission denied" } });
  const r = await persistToolInvocations({ supabase: supabase as any, ...BASE, invocations: SAMPLE });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /permission denied/);
});

test("supabase.from throwing: swallowed, returns ok:false (never breaks the reply)", async () => {
  const throwingSupabase = {
    from() {
      throw new Error("client exploded");
    },
  };
  const r = await persistToolInvocations({ supabase: throwingSupabase as any, ...BASE, invocations: SAMPLE });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /client exploded/);
});

test("oversized result is truncated to a marker so jsonb cannot bloat", async () => {
  const supabase = makeSupabase();
  const huge = "x".repeat(60000);
  const r = await persistToolInvocations({
    supabase: supabase as any,
    ...BASE,
    invocations: [{ name: "get-available-slots", args: {}, result: { blob: huge } }],
  });
  assert.equal(r.ok, true);
  const stored = supabase.calls[0].rows[0].result;
  const storedLen = JSON.stringify(stored).length;
  assert.ok(storedLen < 60000, `stored result must be truncated (was ${storedLen})`);
  assert.equal(stored.truncated, true);
});
