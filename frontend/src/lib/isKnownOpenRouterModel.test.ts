// MODEL-1-HARDENING — unit tests for the OpenRouter model-id membership check.
//
// OpenRouterModelSelector's "use as custom model" buttons called onChange(search)
// directly with zero membership check against the fetched model list, so an
// invalid-but-slash-containing id (the exact shape of the google/gemini-flash-latest
// incident) reached clients.llm_model unchecked. This is the membership check used
// to gate that escape hatch behind an explicit confirmation step; the find variant
// (review follow-up) returns the CANONICAL list id so a differently-cased match can
// never be saved verbatim.
//
// Run via `npm run test:frontend`, or ad-hoc with Node 22+:
//   node --experimental-strip-types --test frontend/src/lib/isKnownOpenRouterModel.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import { findKnownOpenRouterModelId, isKnownOpenRouterModelId } from "./isKnownOpenRouterModel.ts";

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

test("case-insensitive match resolves to the CANONICAL list id, never the user's casing", () => {
  assert.equal(isKnownOpenRouterModelId("Google/Gemini-2.5-Flash", MODELS), true);
  assert.equal(findKnownOpenRouterModelId("Google/Gemini-2.5-Flash", MODELS), "google/gemini-2.5-flash");
});

test("tolerates surrounding whitespace and still returns the canonical id", () => {
  assert.equal(isKnownOpenRouterModelId("  openai/gpt-4o  ", MODELS), true);
  assert.equal(findKnownOpenRouterModelId("  OPENAI/GPT-4O  ", MODELS), "openai/gpt-4o");
});

test("unknown id finds null", () => {
  assert.equal(findKnownOpenRouterModelId("google/gemini-flash-latest", MODELS), null);
});
