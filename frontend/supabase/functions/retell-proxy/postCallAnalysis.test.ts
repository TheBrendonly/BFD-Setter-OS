// API-DEPR-2 — unit tests for buildPostCallAnalysisData.
//
// Run via: deno test --no-check frontend/supabase/functions/retell-proxy/postCallAnalysis.test.ts
//
// Retell's 06/15/2026 deprecation notice removes the three top-level agent fields
// analysis_summary_prompt / analysis_successful_prompt / analysis_user_sentiment_prompt.
// They migrate into post_call_analysis_data as { type: "system-presets", name, description }
// entries (name = call_summary / call_successful / user_sentiment). System-preset OUTPUTS
// stay top-level on call_analysis, so the downstream webhooks are unaffected. This builder
// is the single Retell-facing merge point; these tests lock the mapping, the dedupe, and
// that the deprecated field names never appear in the output.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPostCallAnalysisData } from "./postCallAnalysis.ts";

type Entry = Record<string, unknown>;

Deno.test("3 deprecated fields -> 3 system-presets with correct name<->field mapping, custom appended", () => {
  const custom = [
    { name: "Call result", type: "enum", description: "Is the call booked?", choices: ["Call Booked", "Other"] },
    { name: "user_name", type: "string", description: "full name of the user" },
  ];
  const out = buildPostCallAnalysisData({
    analysis_summary_prompt: "SUMMARY_TEXT",
    analysis_successful_prompt: "SUCCESS_TEXT",
    analysis_user_sentiment_prompt: "SENTIMENT_TEXT",
    post_call_analysis_data: custom,
  }) as Entry[];

  assert(Array.isArray(out));
  // presets first, then custom in original order
  assertEquals(out.length, 5);
  assertEquals(out[0], { type: "system-presets", name: "call_summary", description: "SUMMARY_TEXT" });
  assertEquals(out[1], { type: "system-presets", name: "call_successful", description: "SUCCESS_TEXT" });
  assertEquals(out[2], { type: "system-presets", name: "user_sentiment", description: "SENTIMENT_TEXT" });
  assertEquals(out[3], custom[0]);
  assertEquals(out[4], custom[1]);
});

Deno.test("output never carries the deprecated top-level field names", () => {
  const out = buildPostCallAnalysisData({
    analysis_summary_prompt: "S",
    analysis_successful_prompt: "OK",
    analysis_user_sentiment_prompt: "MOOD",
    post_call_analysis_data: [],
  }) as Entry[];
  const serialized = JSON.stringify(out);
  assert(!serialized.includes("analysis_summary_prompt"));
  assert(!serialized.includes("analysis_successful_prompt"));
  assert(!serialized.includes("analysis_user_sentiment_prompt"));
});

Deno.test("idempotent: caller-provided presets are kept, deprecated fields do NOT overwrite them, no dupes", () => {
  const out = buildPostCallAnalysisData({
    // stale deprecated fields still present (old browser) AND already-migrated presets in the array
    analysis_summary_prompt: "STALE_SUMMARY",
    analysis_user_sentiment_prompt: "STALE_SENTIMENT",
    post_call_analysis_data: [
      { type: "system-presets", name: "call_summary", description: "NEW_SUMMARY" },
      { type: "system-presets", name: "user_sentiment", description: "NEW_SENTIMENT" },
      { name: "email_id", type: "string", description: "email" },
    ],
  }) as Entry[];

  const summary = out.filter((e) => e.type === "system-presets" && e.name === "call_summary");
  const sentiment = out.filter((e) => e.type === "system-presets" && e.name === "user_sentiment");
  assertEquals(summary.length, 1);
  assertEquals(sentiment.length, 1);
  // caller preset wins (not clobbered by the stale deprecated field)
  assertEquals(summary[0].description, "NEW_SUMMARY");
  assertEquals(sentiment[0].description, "NEW_SENTIMENT");
  // custom entry preserved
  assert(out.some((e) => e.name === "email_id"));
});

Deno.test("custom-only passthrough is unchanged (no deprecated fields present)", () => {
  const custom = [
    { name: "success_rate", type: "boolean", description: "3+ questions?" },
    { name: "interested_status", type: "enum", description: "interested?", choices: ["interested", "not_interested"] },
  ];
  const out = buildPostCallAnalysisData({ post_call_analysis_data: custom }) as Entry[];
  assertEquals(out, custom);
});

Deno.test("empty input -> undefined (preserve 'only set when present')", () => {
  assertEquals(buildPostCallAnalysisData({}), undefined);
  assertEquals(buildPostCallAnalysisData({ post_call_analysis_data: [] }), undefined);
  assertEquals(buildPostCallAnalysisData(undefined), undefined);
});

Deno.test("blank/whitespace deprecated fields are ignored (no empty presets)", () => {
  const out = buildPostCallAnalysisData({
    analysis_summary_prompt: "   ",
    analysis_successful_prompt: "",
    analysis_user_sentiment_prompt: "REAL",
    post_call_analysis_data: [],
  }) as Entry[];
  assertEquals(out.length, 1);
  assertEquals(out[0], { type: "system-presets", name: "user_sentiment", description: "REAL" });
});
