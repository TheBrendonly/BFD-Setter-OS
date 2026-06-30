// Normalise a free-text clients.llm_model value before sending it to OpenRouter.
// The model field is free text; a stray leading "~" or surrounding whitespace has been
// saved before, which OpenRouter rejects with a 400 — silently breaking the SMS reply /
// cadence AI-copy engines. Returns null when nothing usable remains so the caller falls
// back to its default.
//
// MODEL-1-HARDENING (Session 7.5): the field also once held "google/gemini-flash-latest"
// — a plausible-but-INVALID OpenRouter id — which the old strip-only normaliser passed
// straight through, 400ing every llm_model-driven engine. Two cheap, network-free guards:
//   1. remap known-bad aliases to valid ids;
//   2. treat a non-namespaced value (no "provider/" slash — never a real OpenRouter id) as
//      unusable, so the caller falls back to a working default instead of a silent 400.
// A robust long-term fix (validate against OpenRouter's live /models list) is a written
// recommendation — deliberately no network call here.

// Known-bad free-text values seen in the wild -> the valid OpenRouter id. Keep minimal.
const MODEL_ALIASES: Record<string, string> = {
  "gemini-flash-latest": "google/gemini-2.5-flash",
  "google/gemini-flash-latest": "google/gemini-2.5-flash",
  "gemini-pro-latest": "google/gemini-2.5-pro",
  "google/gemini-pro-latest": "google/gemini-2.5-pro",
};

export function normalizeLlmModel(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/^[~\s]+/, "").trim();
  if (cleaned === "") return null;
  const aliased = MODEL_ALIASES[cleaned] ?? cleaned;
  // Every valid OpenRouter id is namespaced "provider/model". A value without a slash
  // can never resolve — return null so the caller uses its default rather than 400.
  if (!aliased.includes("/")) return null;
  return aliased;
}
