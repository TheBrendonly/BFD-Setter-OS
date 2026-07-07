import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeDriftState } from "./retellDrift.ts";

// F9 v2 pure drift core (trigger twin). Covers version drift (with null-safety)
// and booking-tools-lost (only when the snapshot positively had booking tools).

const withTools = { llm: { booking_tools_present: true } };
const withoutTools = { llm: { booking_tools_present: false } };
const flowSnapshot = { llm: null, flow: { present: true } };

Deno.test("version equal -> not drifted", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["get-available-slots"] });
  assertEquals(s.versionDrifted, false);
});

Deno.test("live version ahead -> drifted", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 7, liveLlmToolNames: ["get-available-slots"] });
  assertEquals(s.versionDrifted, true);
});

Deno.test("live version behind -> not drifted (defensive)", () => {
  const s = computeDriftState({ syncedVersion: 9, snapshot: withTools, liveAgentVersion: 8, liveLlmToolNames: ["get-available-slots"] });
  assertEquals(s.versionDrifted, false);
});

Deno.test("never pulled (syncedVersion null) -> not drifted", () => {
  const s = computeDriftState({ syncedVersion: null, snapshot: withTools, liveAgentVersion: 7, liveLlmToolNames: ["get-available-slots"] });
  assertEquals(s.versionDrifted, false);
});

Deno.test("live read failed (liveAgentVersion null) -> not drifted", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: null, liveLlmToolNames: [] });
  assertEquals(s.versionDrifted, false);
});

Deno.test("booking tools present in snapshot AND live -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["end_call", "book-appointments"] });
  assertEquals(s.bookingToolsLost, false);
});

Deno.test("booking tools present in snapshot but GONE live -> lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["end_call", "transfer_call"] });
  assertEquals(s.bookingToolsLost, true);
});

Deno.test("underscore alias counts as a booking tool -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withTools, liveAgentVersion: 5, liveLlmToolNames: ["lookup_contact"] });
  assertEquals(s.bookingToolsLost, false);
});

Deno.test("snapshot never had booking tools -> not lost even if live has none", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: withoutTools, liveAgentVersion: 5, liveLlmToolNames: [] });
  assertEquals(s.bookingToolsLost, false);
});

Deno.test("conversation-flow agent (no llm block) -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: flowSnapshot, liveAgentVersion: 5, liveLlmToolNames: [] });
  assertEquals(s.bookingToolsLost, false);
});

Deno.test("null snapshot -> not lost", () => {
  const s = computeDriftState({ syncedVersion: 5, snapshot: null, liveAgentVersion: 5, liveLlmToolNames: [] });
  assertEquals(s.bookingToolsLost, false);
});
