// F8 — the global default rate card + per-client override merge.
//
// The default rate card lives in code (tunable in the agency editor; no DB
// sentinel row). A saved per-client row (client_pricing_config.config jsonb) is
// merged OVER this default; no row = pure default. Mirrors the saved->default
// fallback of useClientAccountFieldConfig.mergeWithDefaults. Dependency-free.
//
// Seed rates are the realistic figures from the F8 research (re-confirm before
// relying on them): Retell voice ~US$0.07/min; OpenRouter LLM ~US$0.003/min
// (light); Twilio AU mobile out ~A$0.075/min and SMS per segment (OFF by default
// since Twilio is client-BYO-and-billed); a clean AU mobile number ~A$8.25/mo.
// FX USD->AUD ~1.52 (admin-set, with a "last reviewed" stamp).

import type { PricingComponent, PricingConfig } from "./computeBlendedRate.ts";

/** A partial override shape (what the agency editor persists into config jsonb). */
export type PricingConfigInput = {
  display_currency?: string;
  fx_usd_to_display_micros?: number;
  fx_buffer_bps?: number;
  fx_updated_at?: string;
  markup_bps?: number;
  show_rate_to_client?: boolean;
  components?: Record<string, Partial<PricingComponent>>;
};

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  display_currency: "AUD",
  fx_usd_to_display_micros: 1_520_000, // 1.52 USD->AUD (admin-set)
  fx_buffer_bps: 0,
  fx_updated_at: "2026-06-26T00:00:00Z", // last reviewed when the seed was captured
  markup_bps: 5_000, // 50%
  show_rate_to_client: false,
  components: {
    retell: { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 70_000 },
    openrouter_llm: { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 3_000 },
    twilio_voice: { enabled: false, currency: "AUD", unit: "per_minute", rate_micros: 75_000 },
    twilio_sms: { enabled: false, currency: "AUD", unit: "per_minute", rate_micros: 0 },
    number_rental: { enabled: false, currency: "AUD", unit: "per_month", rate_micros: 8_250_000 },
    other: { enabled: false, currency: "AUD", unit: "per_minute", rate_micros: 0 },
  },
};

/** Merge a saved (possibly partial / null) override over the code default. */
export function mergeWithDefaults(
  saved: PricingConfigInput | null | undefined,
): PricingConfig {
  const d = DEFAULT_PRICING_CONFIG;
  const s = saved ?? {};
  const components: Record<string, PricingComponent> = {};
  // Anchor on the default's component catalog: unknown saved keys are dropped,
  // and a newly-added default component appears for an existing saved row.
  for (const key of Object.keys(d.components)) {
    const dc = d.components[key];
    const sc = s.components?.[key] ?? {};
    components[key] = {
      enabled: typeof sc.enabled === "boolean" ? sc.enabled : dc.enabled,
      currency: sc.currency ?? dc.currency,
      unit: sc.unit ?? dc.unit,
      rate_micros: typeof sc.rate_micros === "number" ? sc.rate_micros : dc.rate_micros,
    };
  }
  return {
    display_currency: s.display_currency ?? d.display_currency,
    fx_usd_to_display_micros: typeof s.fx_usd_to_display_micros === "number"
      ? s.fx_usd_to_display_micros
      : d.fx_usd_to_display_micros,
    fx_buffer_bps: typeof s.fx_buffer_bps === "number" ? s.fx_buffer_bps : d.fx_buffer_bps,
    fx_updated_at: s.fx_updated_at ?? d.fx_updated_at,
    markup_bps: typeof s.markup_bps === "number" ? s.markup_bps : d.markup_bps,
    show_rate_to_client: typeof s.show_rate_to_client === "boolean"
      ? s.show_rate_to_client
      : d.show_rate_to_client,
    components,
  };
}
