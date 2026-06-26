import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertAgentNotLocked,
  assertLlmNotLocked,
  assertSlotNotLocked,
  buildLockIndex,
  isAgentLocked,
  isLlmLocked,
  isSlotLocked,
  LOCK_ERROR_CODE,
  LOCK_HTTP_STATUS,
  LockError,
  type LockedSetterRow,
} from "./retell-lock.ts";

// F9 per-setter Retell lock. The guard core is a pure index over the client's
// locked voice_setters rows: single-target write actions THROW a 423 LockError,
// bulk loops SKIP a locked setter and keep processing the rest, and the outbound
// call path uses a boolean predicate to skip the voicemail PATCH but still dial.
// These tests cover ONLY the pure logic (no DB, no HTTP).

const ROWS: LockedSetterRow[] = [
  { retell_agent_id: "agent_A", retell_llm_id: "llm_A", legacy_slot: 4, name: "Booking Setter" },
  { retell_agent_id: "agent_B", retell_llm_id: "llm_B", legacy_slot: 5, name: "Crazy Gary" },
];

Deno.test("buildLockIndex populates all three sets + name maps", () => {
  const idx = buildLockIndex(ROWS);
  assertEquals(idx.isEmpty, false);
  assertEquals([...idx.agentIds].sort(), ["agent_A", "agent_B"]);
  assertEquals([...idx.llmIds].sort(), ["llm_A", "llm_B"]);
  assertEquals([...idx.slots].sort(), [4, 5]);
  assertEquals(idx.nameByAgentId.get("agent_A"), "Booking Setter");
  assertEquals(idx.nameBySlot.get(5), "Crazy Gary");
});

Deno.test("empty locked-set is a no-op for every predicate and assert", () => {
  const idx = buildLockIndex([]);
  assertEquals(idx.isEmpty, true);
  assertEquals(isSlotLocked(idx, 4), false);
  assertEquals(isAgentLocked(idx, "agent_A"), false);
  assertEquals(isLlmLocked(idx, "llm_A"), false);
  // asserts must NOT throw when nothing is locked
  assertSlotNotLocked(idx, 4);
  assertAgentNotLocked(idx, "agent_A");
  assertLlmNotLocked(idx, "llm_A");
});

Deno.test("locked slot: assertSlotNotLocked throws a 423 LockError naming the setter", () => {
  const idx = buildLockIndex(ROWS);
  const err = assertThrows(() => assertSlotNotLocked(idx, 4), LockError);
  assertEquals((err as LockError).status, LOCK_HTTP_STATUS);
  assertEquals((err as LockError).status, 423);
  assertEquals((err as LockError).code, LOCK_ERROR_CODE);
  assert((err as LockError).message.includes("Booking Setter"));
});

Deno.test("unlocked slot passes through (no throw)", () => {
  const idx = buildLockIndex(ROWS);
  assertSlotNotLocked(idx, 7);
  assertSlotNotLocked(idx, null);
});

Deno.test("agentId match throws; unlocked and null pass", () => {
  const idx = buildLockIndex(ROWS);
  assertThrows(() => assertAgentNotLocked(idx, "agent_A"), LockError);
  assertAgentNotLocked(idx, "agent_ZZZ");
  assertAgentNotLocked(idx, null);
});

Deno.test("llmId match throws; unlocked and null pass", () => {
  const idx = buildLockIndex(ROWS);
  assertThrows(() => assertLlmNotLocked(idx, "llm_B"), LockError);
  assertLlmNotLocked(idx, "llm_ZZZ");
  assertLlmNotLocked(idx, null);
});

Deno.test("slot vs agent independence (row locked by only one identifier)", () => {
  const idx = buildLockIndex([
    { retell_agent_id: null, retell_llm_id: null, legacy_slot: 9, name: "Slot-only" },
    { retell_agent_id: "agent_C", retell_llm_id: null, legacy_slot: null, name: "Agent-only" },
  ]);
  assertEquals(isSlotLocked(idx, 9), true);
  assertEquals(isAgentLocked(idx, "agent_C"), true);
  // the slot-only row must not lock arbitrary agents, and vice-versa
  assertEquals(isAgentLocked(idx, "agent_C_other"), false);
  assertEquals(isSlotLocked(idx, 4), false);
});

Deno.test("bulk-by-agentId predicate (set-voicemail loop) flags only locked agents", () => {
  const idx = buildLockIndex(ROWS);
  const agents = ["agent_A", "agent_unlocked", "agent_B"];
  assertEquals(agents.map((a) => isAgentLocked(idx, a)), [true, false, true]);
});

Deno.test("bulk-by-slot predicate (refresh-booking-tool-messages loop) skips only locked slots", () => {
  const idx = buildLockIndex([
    { retell_agent_id: "agent_B", retell_llm_id: "llm_B", legacy_slot: 5, name: "Crazy Gary" },
  ]);
  const processed: number[] = [];
  for (const slot of [1, 4, 5]) {
    if (isSlotLocked(idx, slot)) continue;
    processed.push(slot);
  }
  assertEquals(processed, [1, 4]);
});

Deno.test("outbound voicemail-skip predicate is a pure boolean", () => {
  const idx = buildLockIndex(ROWS);
  assertEquals(isAgentLocked(idx, "agent_A"), true); // locked: caller skips the PATCH, still dials
  assertEquals(isAgentLocked(idx, "agent_free"), false); // unlocked: caller PATCHes as today
});

Deno.test("name fallback: locked row with null name yields a generic message, no crash", () => {
  const idx = buildLockIndex([
    { retell_agent_id: "agent_X", retell_llm_id: null, legacy_slot: 2, name: null },
  ]);
  const err = assertThrows(() => assertSlotNotLocked(idx, 2), LockError);
  assert((err as LockError).message.length > 0);
});

Deno.test("duplicate agentId across rows: one set entry, last name wins", () => {
  const idx = buildLockIndex([
    { retell_agent_id: "agent_D", retell_llm_id: null, legacy_slot: 1, name: "First" },
    { retell_agent_id: "agent_D", retell_llm_id: null, legacy_slot: 3, name: "Second" },
  ]);
  assertEquals(idx.agentIds.size, 1);
  assertEquals(idx.nameByAgentId.get("agent_D"), "Second");
});
