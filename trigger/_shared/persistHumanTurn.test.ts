// SMS-MEM-1 — unit tests for persistHumanTurn.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/persistHumanTurn.test.ts
//
// Strategy: exercise the REAL persistHumanTurn with a fake client-supabase client.
// Proves: the inbound human turn is written to chat_history with the 4-key
// LangChain-style HumanMessage shape (type/content/additional_kwargs/response_metadata,
// no tool_calls/invalid_tool_calls — those are AI-only keys); a DB error is reported
// (not thrown); the helper never throws (a persistence hiccup must not break the reply).
import test from "node:test";
import { strict as assert } from "node:assert";
import { persistHumanTurn } from "./persistHumanTurn.ts";

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

test("happy path: one insert into chat_history with the 4-key human message shape", async () => {
  const supabase = makeSupabase();
  const r = await persistHumanTurn({
    supabase: supabase as any,
    leadId: "lead-xyz",
    messageBody: "can I book a meeting?",
    timestamp: "2026-07-03T10:00:00.000Z",
  });
  assert.equal(r.ok, true);
  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].table, "chat_history");
  const row = supabase.calls[0].rows;
  assert.equal(row.session_id, "lead-xyz");
  assert.equal(row.timestamp, "2026-07-03T10:00:00.000Z");
  assert.equal(row.message.type, "human");
  assert.equal(row.message.content, "can I book a meeting?");
  assert.deepEqual(row.message.additional_kwargs, {});
  assert.deepEqual(row.message.response_metadata, {});
  assert.deepEqual(
    Object.keys(row.message).sort(),
    ["additional_kwargs", "content", "response_metadata", "type"],
    "human turn must NOT carry tool_calls/invalid_tool_calls — those are AI-only keys"
  );
});

test("DB insert error: reported as ok:false, never thrown", async () => {
  const supabase = makeSupabase({ error: { message: "permission denied" } });
  const r = await persistHumanTurn({
    supabase: supabase as any,
    leadId: "lead-xyz",
    messageBody: "hi",
    timestamp: "2026-07-03T10:00:00.000Z",
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /permission denied/);
});

test("supabase.from throwing: swallowed, returns ok:false (never breaks the reply)", async () => {
  const throwingSupabase = {
    from() {
      throw new Error("client exploded");
    },
  };
  const r = await persistHumanTurn({
    supabase: throwingSupabase as any,
    leadId: "lead-xyz",
    messageBody: "hi",
    timestamp: "2026-07-03T10:00:00.000Z",
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /client exploded/);
});
