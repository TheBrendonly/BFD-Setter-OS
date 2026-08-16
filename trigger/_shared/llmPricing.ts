// Model-aware OpenRouter pricing (USD per token). Single source shared by
// aiGenerateEngagementCopy (its cadence-copy token estimate) and recordLlmCost
// (the LLM ledger fallback used only when a response carries no usage.cost), so
// the two can never drift.
//
// Keys are matched as substrings against the model id passed by the caller, so
// e.g. "openai/gpt-4.1-nano" and "anthropic/claude-sonnet-4-6" resolve to the
// right row. Unknown models fall back to gpt-4.1-nano (cheap default). Prices are
// the 2026-05 OpenRouter list prices.
//
// If a per-client cost is wildly wrong because of model drift, update this table —
// the cost_estimate_cents in cadence_metrics + the >500c error_logs ceiling guard
// both depend on it.

export const MODEL_PRICING: Array<{ match: string; prompt: number; completion: number }> = [
  // OpenAI cheap class
  { match: "gpt-4.1-nano", prompt: 0.0000001, completion: 0.0000004 },
  { match: "gpt-4o-mini",  prompt: 0.00000015, completion: 0.0000006 },
  // Anthropic
  { match: "claude-haiku-4", prompt: 0.000001, completion: 0.000005 },
  { match: "claude-sonnet",  prompt: 0.000003, completion: 0.000015 },
  { match: "claude-opus",    prompt: 0.000015, completion: 0.000075 },
  // Google Gemini (BFD's current setting via clients.llm_model)
  { match: "gemini-2.5-pro", prompt: 0.00000125, completion: 0.000005 },
  { match: "gemini-2.0-flash", prompt: 0.0000001, completion: 0.0000004 },
  { match: "gemini-2.5-flash", prompt: 0.0000003, completion: 0.0000025 },
  // Catch-all gemini family (anything not matched above)
  { match: "gemini", prompt: 0.000001, completion: 0.000004 },
];

// Unknown model: assume gpt-4.1-nano. Cost will be underestimated for pricier
// models but the 500c per-lead ceiling guard still catches runaway usage.
const FALLBACK_PRICE = { prompt: 0.0000001, completion: 0.0000004 };

export function priceFor(model: string): { prompt: number; completion: number } {
  const lc = (model || "").toLowerCase();
  for (const row of MODEL_PRICING) {
    if (lc.includes(row.match)) return { prompt: row.prompt, completion: row.completion };
  }
  return FALLBACK_PRICE;
}

/**
 * Token-based USD estimate, used as the fallback when OpenRouter returns no
 * usage.cost. Non-finite / negative token counts are treated as 0.
 */
export function estimateLlmCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = priceFor(model);
  const pt = Number.isFinite(promptTokens) && promptTokens > 0 ? promptTokens : 0;
  const ct = Number.isFinite(completionTokens) && completionTokens > 0 ? completionTokens : 0;
  return pt * price.prompt + ct * price.completion;
}
