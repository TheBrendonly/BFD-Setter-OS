import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCallOutcomeStamp, stampLastCallOutcome } from "./callOutcome.ts";
import { classifyCallOutcome } from "./classifyCallOutcome.ts";

const ENDED = "2026-06-19T04:00:00.000Z";

// The stamp must carry enough signal that runEngagement's re-classification
// (classifyCallOutcome) bins the call the same way the webhook would.

Deno.test("buildCallOutcomeStamp: voicemail_reached classifies as voicemail", () => {
  const stamp = buildCallOutcomeStamp(
    { call_id: "call_vm", disconnection_reason: "voicemail_reached", call_status: "ended" },
    ENDED,
  );
  assertEquals(stamp.call_id, "call_vm");
  assertEquals(stamp.ended_at, ENDED);
  assertEquals(stamp.disconnect_reason, "voicemail_reached");
  assertEquals(classifyCallOutcome(stamp), "voicemail");
});

Deno.test("buildCallOutcomeStamp: dial_no_answer classifies as no_connect", () => {
  const stamp = buildCallOutcomeStamp(
    { call_id: "call_na", disconnection_reason: "dial_no_answer" },
    ENDED,
  );
  assertEquals(classifyCallOutcome(stamp), "no_connect");
});

Deno.test("buildCallOutcomeStamp: ghost-connect user_hangup @0.6s/0-turns classifies as no_connect", () => {
  const stamp = buildCallOutcomeStamp(
    {
      call_id: "call_ghost",
      disconnection_reason: "user_hangup",
      duration_ms: 600,
      transcript_object: [],
    },
    ENDED,
  );
  assertEquals(stamp.duration_ms, 600);
  assertEquals(stamp.transcript_turns, 0);
  assertEquals(classifyCallOutcome(stamp), "no_connect");
});

Deno.test("buildCallOutcomeStamp: max_duration_reached classifies as human_pickup", () => {
  const stamp = buildCallOutcomeStamp(
    { call_id: "call_long", disconnection_reason: "max_duration_reached" },
    ENDED,
  );
  assertEquals(classifyCallOutcome(stamp), "human_pickup");
});

// Records the update payload + filter so we can assert the write shape.
function fakeSb(updateError: { message: string } | null = null) {
  const calls: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {
    update: (payload: unknown) => {
      calls.updatePayload = payload;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.eqCol = col;
      calls.eqVal = val;
      return Promise.resolve({ error: updateError });
    },
  };
  const sb = {
    from: (table: string) => {
      calls.table = table;
      return builder;
    },
  };
  return { sb, calls };
}

Deno.test("stampLastCallOutcome: writes last_call_outcome + clears active_call_id on the execution", async () => {
  const stamp = buildCallOutcomeStamp({ call_id: "call_x", disconnection_reason: "voicemail_reached" }, ENDED);
  const { sb, calls } = fakeSb();
  // deno-lint-ignore no-explicit-any
  const res = await stampLastCallOutcome(sb as any, "exec_123", stamp);
  assertEquals(res.ok, true);
  assertEquals(calls.table, "engagement_executions");
  assertEquals(calls.eqCol, "id");
  assertEquals(calls.eqVal, "exec_123");
  const payload = calls.updatePayload as Record<string, unknown>;
  assertEquals(payload.last_call_outcome, stamp);
  assertEquals(payload.active_call_id, null);
});

Deno.test("stampLastCallOutcome: surfaces a write error as { ok: false }", async () => {
  const stamp = buildCallOutcomeStamp({ call_id: "call_y" }, ENDED);
  const { sb } = fakeSb({ message: "boom" });
  // deno-lint-ignore no-explicit-any
  const res = await stampLastCallOutcome(sb as any, "exec_456", stamp);
  assertEquals(res.ok, false);
  assertEquals(res.error, "boom");
});

Deno.test("buildCallOutcomeStamp: reads in_voicemail + duration aliases + status fallback", () => {
  const stamp = buildCallOutcomeStamp(
    {
      id: "call_alias",
      call_status: undefined,
      status: "ongoing",
      call_duration_ms: 12000,
      transcript_object: [{}, {}, {}],
      call_analysis: { in_voicemail: true },
    },
    ENDED,
  );
  assertEquals(stamp.call_id, "call_alias");
  assertEquals(stamp.call_status, "ongoing");
  assertEquals(stamp.duration_ms, 12000);
  assertEquals(stamp.transcript_turns, 3);
  assertEquals(stamp.in_voicemail, true);
  // in_voicemail short-circuits to voicemail regardless of disconnect_reason
  assertEquals(classifyCallOutcome(stamp), "voicemail");
});
