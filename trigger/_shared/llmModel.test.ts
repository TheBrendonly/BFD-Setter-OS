// MODEL-1-HARDENING — unit tests for normalizeLlmModel.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/llmModel.test.ts
//
// The free-text clients.llm_model field once held "google/gemini-flash-latest" — a
// plausible-but-INVALID OpenRouter id — and the old normalizeLlmModel only stripped a
// leading "~"/whitespace, so the invalid-but-non-empty value passed straight through and
// OpenRouter 400'd EVERY llm_model-driven engine (SMS reply + cadence AI). The hardening:
// map known-bad aliases to valid ids, and treat a clearly-malformed id (no "provider/"
// namespace) as unusable so the caller falls back to its working default instead of 400ing.
import test from "node:test";
import { strict as assert } from "node:assert";
import { normalizeLlmModel } from "./llmModel.ts";

test("valid namespaced id passes through unchanged", () => {
  assert.equal(normalizeLlmModel("google/gemini-2.5-flash"), "google/gemini-2.5-flash");
  assert.equal(normalizeLlmModel("anthropic/claude-3.5-sonnet"), "anthropic/claude-3.5-sonnet");
  assert.equal(normalizeLlmModel("openai/gpt-4.1-nano"), "openai/gpt-4.1-nano");
});

test("strips a leading ~ and surrounding whitespace (legacy behaviour preserved)", () => {
  assert.equal(normalizeLlmModel("~google/gemini-2.5-flash"), "google/gemini-2.5-flash");
  assert.equal(normalizeLlmModel("  google/gemini-2.5-flash  "), "google/gemini-2.5-flash");
});

test("empty / whitespace / ~-only / non-string -> null (caller falls back to default)", () => {
  assert.equal(normalizeLlmModel(""), null);
  assert.equal(normalizeLlmModel("   "), null);
  assert.equal(normalizeLlmModel("~"), null);
  assert.equal(normalizeLlmModel(null), null);
  assert.equal(normalizeLlmModel(undefined), null);
  assert.equal(normalizeLlmModel(123 as unknown as string), null);
});

test("known-bad aliases are remapped to valid ids (the live incident value)", () => {
  assert.equal(normalizeLlmModel("gemini-flash-latest"), "google/gemini-2.5-flash");
  assert.equal(normalizeLlmModel("google/gemini-flash-latest"), "google/gemini-2.5-flash");
  // alias resolution also works after the ~/whitespace strip
  assert.equal(normalizeLlmModel("~gemini-flash-latest"), "google/gemini-2.5-flash");
});

test("a non-namespaced (no slash) value is unusable -> null, not a silent 400", () => {
  // Every real OpenRouter id is "provider/model"; a bare token can never be valid.
  assert.equal(normalizeLlmModel("gpt4nano"), null);
  assert.equal(normalizeLlmModel("gemini"), null);
});
