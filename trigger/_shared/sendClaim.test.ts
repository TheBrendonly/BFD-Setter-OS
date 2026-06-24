// Unit tests for the B4 send-idempotency claim helpers.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/sendClaim.test.ts
//
// Strategy: exercise the real claimSend/releaseSend against a fake supabase that
// records the insert payload / delete filter and returns a configurable error,
// proving: fresh claim -> true; 23505 conflict -> false (already sent); other
// error -> true (fail open); releaseSend deletes by send_key.
import test from "node:test";
import { strict as assert } from "node:assert";
import { claimSend, releaseSend } from "./sendClaim.ts";

function makeSupabase(insertError: any) {
  const recorded: any = { insert: null, deleteEq: null };
  return {
    _recorded: recorded,
    from: (table: string) => {
      recorded.table = table;
      return {
        insert: async (row: any) => {
          recorded.insert = row;
          return { error: insertError };
        },
        delete: () => ({
          eq: async (col: string, val: string) => {
            recorded.deleteEq = [col, val];
            return { error: null };
          },
        }),
      };
    },
  };
}

test("claimSend: fresh insert -> true and writes send_key/task/lead_id", async () => {
  const sb = makeSupabase(null);
  const ok = await claimSend(sb as any, "followup:timer-1", "send-followup", "lead-9");
  assert.equal(ok, true);
  assert.equal(sb._recorded.table, "outbound_send_claims");
  assert.equal(sb._recorded.insert.send_key, "followup:timer-1");
  assert.equal(sb._recorded.insert.task, "send-followup");
  assert.equal(sb._recorded.insert.lead_id, "lead-9");
});

test("claimSend: 23505 unique violation -> false (already sent)", async () => {
  const sb = makeSupabase({ code: "23505", message: "duplicate key" });
  const ok = await claimSend(sb as any, "dm:exec-1:0", "process-messages", "lead-9");
  assert.equal(ok, false);
});

test("claimSend: other error -> true (fail open, never drop a message)", async () => {
  const sb = makeSupabase({ code: "08006", message: "connection failure" });
  const ok = await claimSend(sb as any, "dm:exec-1:1", "process-messages", null);
  assert.equal(ok, true);
});

test("releaseSend: deletes by send_key", async () => {
  const sb = makeSupabase(null);
  await releaseSend(sb as any, "followup:timer-1");
  assert.deepEqual(sb._recorded.deleteEq, ["send_key", "followup:timer-1"]);
});
