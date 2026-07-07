// F9 v2 pure drift core (trigger twin). Covers version drift (with null-safety)
// and booking-tools-lost (only when the snapshot positively had booking tools).
//   node --experimental-strip-types --test trigger/_shared/retellDrift.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import { computeDriftState } from "./retellDrift.ts";

const withTools = { llm: { booking_tools_present: true } };
const withoutTools = { llm: { booking_tools_present: false } };
const flowSnapshot = { llm: null, flow: { present: true } };

test("version equal -> not drifted", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["get-available-slots"] });
  assert.equal(s.versionDrifted, false);
});

test("live version ahead -> drifted", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 7, liveLlmToolNames: ["get-available-slots"] });
  assert.equal(s.versionDrifted, true);
});

test("live version behind -> not drifted (defensive)", () => {
  const s = computeDriftState({ syncedVersion: 9, snapshot: withTools, liveAgentVersion: 8, liveLlmToolNames: ["get-available-slots"] });
  assert.equal(s.versionDrifted, false);
});

test("never pulled (syncedVersion null) -> not drifted", () => {
  const s = computeDriftState({ syncedVersion: null, snapshot: withTools, liveAgentVersion: 7, liveLlmToolNames: ["get-available-slots"] });
  assert.equal(s.versionDrifted, false);
});

test("live read failed (liveAgentVersion null) -> not drifted", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: null, liveLlmToolNames: [] });
  assert.equal(s.versionDrifted, false);
});

test("booking tools present in snapshot AND live -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["end_call", "book-appointments"] });
  assert.equal(s.bookingToolsLost, false);
});

test("booking tools present in snapshot but GONE live -> lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["end_call", "transfer_call"] });
  assert.equal(s.bookingToolsLost, true);
});

test("underscore alias counts as a booking tool -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["lookup_contact"] });
  assert.equal(s.bookingToolsLost, false);
});

test("snapshot never had booking tools -> not lost even if live has none", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withoutTools, liveAgentVersion: 5, liveLlmToolNames: [] });
  assert.equal(s.bookingToolsLost, false);
});

test("conversation-flow agent (no llm block) -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: flowSnapshot, liveAgentVersion: 5, liveLlmToolNames: [] });
  assert.equal(s.bookingToolsLost, false);
});

test("null snapshot -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: null, liveAgentVersion: 5, liveLlmToolNames: [] });
  assert.equal(s.bookingToolsLost, false);
});
