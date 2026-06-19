// Structural contract guard for the SMS setter tool schemas (§3.12). Runs via:
//   node --experimental-strip-types --test trigger/_shared/setterTools.test.ts
//
// These assertions lock the tool surface the text setter exposes to the LLM:
// exactly the 6 booking tools, and NEVER send-sms (the engine already sends the
// reply — exposing send-sms would double-send) or lookup-contact (identity is
// injected by the engine).
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { SETTER_TOOLS, SETTER_TOOL_NAMES, TOOL_USAGE_INSTRUCTION } from "./setterTools.ts";

const EXPECTED = [
  "get-available-slots",
  "book-appointments",
  "get-contact-appointments",
  "update-appointment",
  "cancel-appointments",
  "schedule-callback",
];

test("SETTER_TOOLS exposes exactly the 6 booking tools", () => {
  const names = SETTER_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, [...EXPECTED].sort());
});

test("SETTER_TOOLS never exposes send-sms or lookup-contact (double-send / redundancy guard)", () => {
  const names = SETTER_TOOLS.map((t) => t.function.name);
  for (const banned of ["send-sms", "send_sms", "lookup-contact", "lookup_contact"]) {
    assert.equal(names.includes(banned), false, `${banned} must not be exposed`);
  }
});

test("every tool is a well-formed OpenAI function schema", () => {
  for (const t of SETTER_TOOLS) {
    assert.equal(t.type, "function");
    assert.equal(typeof t.function.name, "string");
    assert.equal(typeof t.function.description, "string");
    assert.ok(t.function.description.length > 0);
    assert.equal(t.function.parameters?.type, "object");
    assert.equal(typeof t.function.parameters?.properties, "object");
  }
});

test("SETTER_TOOL_NAMES is the set of exposed tool names (for loop validation)", () => {
  assert.deepEqual([...SETTER_TOOL_NAMES].sort(), [...EXPECTED].sort());
  for (const t of SETTER_TOOLS) {
    assert.ok(SETTER_TOOL_NAMES.has(t.function.name));
  }
});

test("TOOL_USAGE_INSTRUCTION guides slot offering + the slot_unavailable recovery", () => {
  assert.equal(typeof TOOL_USAGE_INSTRUCTION, "string");
  assert.ok(TOOL_USAGE_INSTRUCTION.length > 0);
  assert.match(TOOL_USAGE_INSTRUCTION, /available_slots/);
});
