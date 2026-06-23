// Normalise a free-text clients.llm_model value before sending it to OpenRouter.
// The model field is free text in the UI; a stray leading "~" (e.g.
// "~google/gemini-flash-latest") or surrounding whitespace has been saved before,
// which OpenRouter rejects with a 400 — silently breaking the SMS reply / cadence
// AI-copy engines. This was previously fixed in only ONE call site
// (analyze-sms-conversation); this shared helper covers every trigger task.
// Returns null when nothing usable remains so the caller falls back to its default.
export function normalizeLlmModel(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/^[~\s]+/, "").trim();
  return cleaned === "" ? null : cleaned;
}
