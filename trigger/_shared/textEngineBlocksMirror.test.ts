// PROMPT-AUTH-1 — the text X-Ray shows the runtime-appended instruction blocks
// via a frontend mirror (frontend/src/data/textEngineRuntimeBlocks.ts, generated
// by scripts/generate_text_engine_mirror.mjs). If the mirror drifts from the code
// of record, the X-Ray lies about the TRUE final prompt — this test makes drift a
// CI failure instead. Fix a failure by re-running:
//   node --experimental-strip-types scripts/generate_text_engine_mirror.mjs
import test from "node:test";
import { strict as assert } from "node:assert";
import { MULTI_MESSAGE_INSTRUCTION, TOOL_USAGE_INSTRUCTION } from "./setterTools.ts";
import {
  MULTI_MESSAGE_INSTRUCTION as MIRROR_MULTI,
  TOOL_USAGE_INSTRUCTION as MIRROR_TOOLS,
  SAMPLE_AVAILABILITY_BLOCK,
  SAMPLE_TIME_ANCHOR_BLOCK,
} from "../../frontend/src/data/textEngineRuntimeBlocks.ts";

test("frontend mirror of MULTI_MESSAGE_INSTRUCTION is byte-identical", () => {
  assert.equal(MIRROR_MULTI, MULTI_MESSAGE_INSTRUCTION);
});

test("frontend mirror of TOOL_USAGE_INSTRUCTION is byte-identical", () => {
  assert.equal(MIRROR_TOOLS, TOOL_USAGE_INSTRUCTION);
});

test("sample availability block carries the load-bearing rules", () => {
  assert.match(SAMPLE_AVAILABILITY_BLOCK, /## Live calendar availability/);
  assert.match(SAMPLE_AVAILABILITY_BLOCK, /Offer ONLY times that appear in this map/);
  assert.match(SAMPLE_AVAILABILITY_BLOCK, /YYYY-MM-DDTHH:MM/);
});

test("sample time anchor block carries the load-bearing rules", () => {
  assert.match(SAMPLE_TIME_ANCHOR_BLOCK, /## Current date & time \(ground truth\)/);
  assert.match(SAMPLE_TIME_ANCHOR_BLOCK, /Never guess or compute a date yourself/);
});
