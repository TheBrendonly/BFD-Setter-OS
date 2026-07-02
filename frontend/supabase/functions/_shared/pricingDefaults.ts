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
//
// F13 additions: an sms_llm per_message component (the LLM cost of generating
// one average outbound text; Twilio carriage stays client-billed), a
// billing_anchor_day (day-of-month the client's billing period starts), and
// per-part client_display toggles. client_display.show_rate stays MIRRORED with
// the legacy show_rate_to_client flag in both directions so the already-deployed
// get-blended-rate keeps working regardless of which writer saved last.

import type { ClientDisplayConfig, PricingComponent, PricingConfig } from "./computeBlendedRate.ts";
import { sanitizeAnchorDay } from "./billingPeriod.ts";

/** A partial override shape (what the agency editor persists into config jsonb). */
export type PricingConfigInput = {
  display_currency?: string;
  fx_usd_to_display_micros?: number;
  fx_buffer_bps?: number;
  fx_updated_at?: string;
  markup_bps?: number;
  show_rate_to_client?: boolean;
  billing_anchor_day?: number;
  client_display?: Partial<ClientDisplayConfig>;
  components?: Record<string, Partial<PricingComponent>>;
};

/** A merged config always carries the F13 fields (mergeWithDefaults guarantees it). */
export type MergedPricingConfig = PricingConfig & {
  billing_anchor_day: number;
  client_display: ClientDisplayConfig;
};

export const DEFAULT_PRICING_CONFIG: MergedPricingConfig = {
  display_currency: "AUD",
  fx_usd_to_display_micros: 1_520_000, // 1.52 USD->AUD (admin-set)
  fx_buffer_bps: 0,
  fx_updated_at: "2026-06-26T00:00:00Z", // last reviewed when the seed was captured
  markup_bps: 5_000, // 50%
  show_rate_to_client: false,
  billing_anchor_day: 1,
  client_display: {
    show_rate: false,
    show_minutes: false,
    show_texts: false,
    show_total: false,
  },
  components: {
    retell: { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 70_000 },
    openrouter_llm: { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 3_000 },
    twilio_voice: { enabled: false, currency: "AUD", unit: "per_minute", rate_micros: 75_000 },
    twilio_sms: { enabled: false, currency: "AUD", unit: "per_minute", rate_micros: 0 },
    // LLM cost of one average outbound text (seed US$0.003; Brendan to confirm).
    sms_llm: { enabled: true, currency: "USD", unit: "per_message", rate_micros: 3_000 },
    number_rental: { enabled: false, currency: "AUD", unit: "per_month", rate_micros: 8_250_000 },
    other: { enabled: false, currency: "AUD", unit: "per_minute", rate_micros: 0 },
  },
};

/** Merge a saved (possibly partial / null) override over the code default. */
export function mergeWithDefaults(
  saved: PricingConfigInput | null | undefined,
): MergedPricingConfig {
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
  // show_rate: the legacy flag is authoritative when saved (an old writer only
  // touches it); otherwise the new-style toggle; otherwise the default.
  const showRate = typeof s.show_rate_to_client === "boolean"
    ? s.show_rate_to_client
    : typeof s.client_display?.show_rate === "boolean"
    ? s.client_display.show_rate
    : d.show_rate_to_client;
  const client_display: ClientDisplayConfig = {
    show_rate: showRate,
    show_minutes: typeof s.client_display?.show_minutes === "boolean"
      ? s.client_display.show_minutes
      : d.client_display.show_minutes,
    show_texts: typeof s.client_display?.show_texts === "boolean"
      ? s.client_display.show_texts
      : d.client_display.show_texts,
    show_total: typeof s.client_display?.show_total === "boolean"
      ? s.client_display.show_total
      : d.client_display.show_total,
  };
  return {
    display_currency: s.display_currency ?? d.display_currency,
    fx_usd_to_display_micros: typeof s.fx_usd_to_display_micros === "number"
      ? s.fx_usd_to_display_micros
      : d.fx_usd_to_display_micros,
    fx_buffer_bps: typeof s.fx_buffer_bps === "number" ? s.fx_buffer_bps : d.fx_buffer_bps,
    fx_updated_at: s.fx_updated_at ?? d.fx_updated_at,
    markup_bps: typeof s.markup_bps === "number" ? s.markup_bps : d.markup_bps,
    show_rate_to_client: showRate,
    billing_anchor_day: typeof s.billing_anchor_day === "number"
      ? sanitizeAnchorDay(s.billing_anchor_day)
      : d.billing_anchor_day,
    client_display,
    components,
  };
}
