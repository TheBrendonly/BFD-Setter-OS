// Unit test for Bug 33's call outcome classifier. Runs under Node 22+ via:
//   node --experimental-strip-types --test trigger/_shared/classifyCallOutcome.test.ts
//
// This file tests the trigger/_shared/classifyCallOutcome.ts copy. The Deno
// twin at frontend/supabase/functions/retell-call-analysis-webhook/classifyCallOutcome.ts
// is byte-identical, so the same tests apply to both.
import test from "node:test";
import { strict as assert } from "node:assert";
import { classifyCallOutcome } from "./classifyCallOutcome.ts";

// Phase 6 regression: 0.6s call with disconnect_reason=user_hangup, zero
// transcript turns. Pre-fix this classified as human_pickup and killed the
// cadence. Post-fix it must classify as no_connect.
test("Bug 33 regression: 0.6s user_hangup with zero turns => no_connect (NOT human_pickup)", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "user_hangup",
      call_status: "ended",
      duration_ms: 635,
      transcript_turns: 0,
      in_voicemail: false,
    }),
    "no_connect",
  );
});

test("user_hangup with real conversation (10s + 4 turns) => human_pickup", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "user_hangup",
      call_status: "ended",
      duration_ms: 10000,
      transcript_turns: 4,
      in_voicemail: false,
    }),
    "human_pickup",
  );
});

test("agent_hangup with real conversation => human_pickup", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "agent_hangup",
      duration_ms: 30000,
      transcript_turns: 12,
    }),
    "human_pickup",
  );
});

test("agent_hangup with no conversation => no_connect (early agent-side drop)", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "agent_hangup",
      duration_ms: 800,
      transcript_turns: 0,
    }),
    "no_connect",
  );
});

test("inactivity with no conversation => no_connect", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "inactivity",
      duration_ms: 2000,
      transcript_turns: 0,
    }),
    "no_connect",
  );
});

test("voicemail_reached => voicemail (regardless of duration)", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "voicemail_reached",
      duration_ms: 25000,
      transcript_turns: 1,
    }),
    "voicemail",
  );
});

test("ivr_reached => voicemail", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "ivr_reached" }),
    "voicemail",
  );
});

test("in_voicemail flag overrides ambiguous disconnect", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "user_hangup",
      duration_ms: 20000,
      transcript_turns: 5,
      in_voicemail: true,
    }),
    "voicemail",
  );
});

test("legacy voicemail alias => voicemail", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "voicemail" }),
    "voicemail",
  );
});

test("legacy machine_detected alias => voicemail", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "machine_detected" }),
    "voicemail",
  );
});

test("dial_busy => no_connect", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "dial_busy" }),
    "no_connect",
  );
});

test("dial_no_answer => no_connect", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "dial_no_answer" }),
    "no_connect",
  );
});

test("marked_as_spam => no_connect", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "marked_as_spam" }),
    "no_connect",
  );
});

test("user_declined => no_connect (NOT human_pickup)", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "user_declined",
      duration_ms: 1000,
    }),
    "no_connect",
  );
});

test("legacy no_answer alias => no_connect", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "no_answer" }),
    "no_connect",
  );
});

test("error_llm_websocket_lost_connection => error", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "error_llm_websocket_lost_connection" }),
    "error",
  );
});

test("call_status=error with empty disconnect_reason => error", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "", call_status: "error" }),
    "error",
  );
});

test("call_transfer => human_pickup (definite engagement)", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "call_transfer" }),
    "human_pickup",
  );
});

test("max_duration_reached => human_pickup", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "max_duration_reached" }),
    "human_pickup",
  );
});

test("null disconnect_reason with real conversation => human_pickup", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: null,
      duration_ms: 30000,
      transcript_turns: 8,
    }),
    "human_pickup",
  );
});

test("null disconnect_reason with no conversation => no_connect (Phase 6 ghost connect)", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: null,
      duration_ms: 600,
      transcript_turns: 0,
    }),
    "no_connect",
  );
});

test("empty-string disconnect_reason with no conversation => no_connect", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "",
      duration_ms: 0,
      transcript_turns: 0,
    }),
    "no_connect",
  );
});

test("unmapped disconnect_reason with conversation evidence => human_pickup (safe fall-through)", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "some_new_retell_enum_value_we_dont_know",
      duration_ms: 20000,
      transcript_turns: 5,
    }),
    "human_pickup",
  );
});

test("unmapped disconnect_reason with no conversation => no_connect (bias toward funnel safety)", () => {
  assert.equal(
    classifyCallOutcome({
      disconnect_reason: "some_new_retell_enum_value_we_dont_know",
      duration_ms: 0,
      transcript_turns: 0,
    }),
    "no_connect",
  );
});

test("null input => unknown", () => {
  assert.equal(classifyCallOutcome(null), "unknown");
  assert.equal(classifyCallOutcome(undefined), "unknown");
});

test("case insensitivity on disconnect_reason", () => {
  assert.equal(
    classifyCallOutcome({ disconnect_reason: "VOICEMAIL_REACHED" }),
    "voicemail",
  );
});
