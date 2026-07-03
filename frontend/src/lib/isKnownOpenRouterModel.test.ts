// MODEL-1-HARDENING — unit tests for isKnownOpenRouterModelId.
//
// OpenRouterModelSelector's "use as custom model" buttons called onChange(search)
// directly with zero membership check against the fetched model list, so an
// invalid-but-slash-containing id (the exact shape of the google/gemini-flash-latest
// incident) reached clients.llm_model unchecked. This is the membership check used
// to gate that escape hatch behind an explicit confirmation step.
//
// Frontend has no test runner; run this ad-hoc with Node 22+:
//   node --experimental-strip-types --test frontend/src/lib/isKnownOpenRouterModel.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import { isKnownOpenRouterModelId } from "./isKnownOpenRouterModel.ts";

const MODELS = [
  { id: "google/gemini-2.5-flash" },
  { id: "openai/gpt-4o" },
];

test("exact match returns true", () => {
  assert.equal(isKnownOpenRouterModelId("google/gemini-2.5-flash", MODELS), true);
});

test("unknown id returns false", () => {
  assert.equal(isKnownOpenRouterModelId("google/gemini-flash-latest", MODELS), false);
});

test("empty or whitespace-only id returns false", () => {
  assert.equal(isKnownOpenRouterModelId("", MODELS), false);
  assert.equal(isKnownOpenRouterModelId("   ", MODELS), false);
});

test("case-insensitive match", () => {
  assert.equal(isKnownOpenRouterModelId("Google/Gemini-2.5-Flash", MODELS), true);
});

test("tolerates surrounding whitespace", () => {
  assert.equal(isKnownOpenRouterModelId("  openai/gpt-4o  ", MODELS), true);
});
