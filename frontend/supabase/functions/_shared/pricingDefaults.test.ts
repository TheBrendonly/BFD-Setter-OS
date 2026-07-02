import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeBlendedRate } from "./computeBlendedRate.ts";
import { DEFAULT_PRICING_CONFIG, mergeWithDefaults } from "./pricingDefaults.ts";

// F8 — the global default rate card + the per-client override merge. The default
// lives in code (tunable via the editor, no DB sentinel row); a saved per-client
// row is merged OVER it. No row = pure default. Mirrors useClientAccountFieldConfig.

Deno.test("default config: Twilio components are OFF, rate not shown to client", () => {
  assertEquals(DEFAULT_PRICING_CONFIG.components.twilio_voice.enabled, false);
  assertEquals(DEFAULT_PRICING_CONFIG.components.twilio_sms.enabled, false);
  assertEquals(DEFAULT_PRICING_CONFIG.show_rate_to_client, false);
  assertEquals(DEFAULT_PRICING_CONFIG.display_currency, "AUD");
  // number rental is a fixed monthly line, off by default.
  assertEquals(DEFAULT_PRICING_CONFIG.components.number_rental.unit, "per_month");
  assertEquals(DEFAULT_PRICING_CONFIG.components.number_rental.enabled, false);
});

Deno.test("default config computes a sane non-zero blended rate (retell + LLM enabled)", () => {
  const r = computeBlendedRate(DEFAULT_PRICING_CONFIG);
  assert(r.blended_per_min_minor > 0);
  assertEquals(r.lineItems.map((l) => l.key).sort(), ["openrouter_llm", "retell"]);
});

Deno.test("no saved row -> pure default (deep equal)", () => {
  assertEquals(mergeWithDefaults(null), DEFAULT_PRICING_CONFIG);
  assertEquals(mergeWithDefaults(undefined), DEFAULT_PRICING_CONFIG);
});

Deno.test("partial top-level override merges over the default", () => {
  const merged = mergeWithDefaults({ markup_bps: 10_000, fx_usd_to_display_micros: 1_600_000 });
  assertEquals(merged.markup_bps, 10_000);
  assertEquals(merged.fx_usd_to_display_micros, 1_600_000);
  // untouched fields fall back to the default
  assertEquals(merged.display_currency, "AUD");
  assertEquals(merged.show_rate_to_client, false);
  assertEquals(merged.components.retell.rate_micros, DEFAULT_PRICING_CONFIG.components.retell.rate_micros);
});

Deno.test("partial component override fills the rest of that component from the default", () => {
  const merged = mergeWithDefaults({ components: { twilio_voice: { enabled: true } } });
  assertEquals(merged.components.twilio_voice.enabled, true);
  // currency / unit / rate come from the default
  assertEquals(merged.components.twilio_voice.currency, "AUD");
  assertEquals(merged.components.twilio_voice.unit, "per_minute");
  assertEquals(
    merged.components.twilio_voice.rate_micros,
    DEFAULT_PRICING_CONFIG.components.twilio_voice.rate_micros,
  );
  // other components untouched
  assertEquals(merged.components.retell.enabled, DEFAULT_PRICING_CONFIG.components.retell.enabled);
});

Deno.test("unknown saved component keys are dropped (catalog-anchored, forward-safe)", () => {
  const merged = mergeWithDefaults({ components: { bogus_component: { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 999 } } });
  assert(!("bogus_component" in merged.components));
  assertEquals(Object.keys(merged.components).sort(), Object.keys(DEFAULT_PRICING_CONFIG.components).sort());
});

Deno.test("show_rate_to_client can be turned on by a saved override", () => {
  assertEquals(mergeWithDefaults({ show_rate_to_client: true }).show_rate_to_client, true);
});

// F13 — sms_llm component, billing anchor day, per-part client display toggles.

Deno.test("F13 defaults: sms_llm per_message component on, anchor day 1, all display toggles off", () => {
  assertEquals(DEFAULT_PRICING_CONFIG.components.sms_llm.enabled, true);
  assertEquals(DEFAULT_PRICING_CONFIG.components.sms_llm.unit, "per_message");
  assertEquals(DEFAULT_PRICING_CONFIG.components.sms_llm.currency, "USD");
  assertEquals(DEFAULT_PRICING_CONFIG.billing_anchor_day, 1);
  assertEquals(DEFAULT_PRICING_CONFIG.client_display, {
    show_rate: false,
    show_minutes: false,
    show_texts: false,
    show_total: false,
  });
});

Deno.test("billing_anchor_day merges and clamps (0 -> 1, 45 -> 31, 15.7 -> 15, NaN -> default)", () => {
  assertEquals(mergeWithDefaults({ billing_anchor_day: 15 }).billing_anchor_day, 15);
  assertEquals(mergeWithDefaults({ billing_anchor_day: 0 }).billing_anchor_day, 1);
  assertEquals(mergeWithDefaults({ billing_anchor_day: 45 }).billing_anchor_day, 31);
  assertEquals(mergeWithDefaults({ billing_anchor_day: 15.7 }).billing_anchor_day, 15);
  assertEquals(mergeWithDefaults({ billing_anchor_day: NaN }).billing_anchor_day, 1);
  assertEquals(mergeWithDefaults({}).billing_anchor_day, 1);
});

Deno.test("legacy row with only show_rate_to_client=true maps into client_display.show_rate", () => {
  const merged = mergeWithDefaults({ show_rate_to_client: true });
  assertEquals(merged.client_display?.show_rate, true);
  assertEquals(merged.client_display?.show_minutes, false);
  assertEquals(merged.client_display?.show_texts, false);
  assertEquals(merged.client_display?.show_total, false);
  assertEquals(merged.show_rate_to_client, true);
});

Deno.test("new-style client_display.show_rate mirrors back onto show_rate_to_client", () => {
  const merged = mergeWithDefaults({
    client_display: { show_rate: true, show_minutes: true, show_texts: false, show_total: true },
  });
  assertEquals(merged.show_rate_to_client, true);
  assertEquals(merged.client_display?.show_minutes, true);
  assertEquals(merged.client_display?.show_texts, false);
  assertEquals(merged.client_display?.show_total, true);
});

Deno.test("explicit show_rate_to_client wins over client_display.show_rate when both saved", () => {
  // A row written by the OLD editor after a new-style row existed: the legacy
  // flag is the one the old writer actually changed, so it is authoritative.
  const merged = mergeWithDefaults({
    show_rate_to_client: false,
    client_display: { show_rate: true, show_minutes: false, show_texts: false, show_total: false },
  });
  assertEquals(merged.show_rate_to_client, false);
  assertEquals(merged.client_display?.show_rate, false);
});

Deno.test("the exact live legacy row shape gains sms_llm + F13 fields on merge", () => {
  // Mirror of the deployed client_pricing_config.config row (pre-F13).
  const liveRow = {
    display_currency: "AUD",
    markup_bps: 10_000,
    fx_buffer_bps: 200,
    fx_updated_at: "2026-06-26T00:00:00Z",
    fx_usd_to_display_micros: 1_520_000,
    show_rate_to_client: true,
    components: {
      retell: { enabled: true, currency: "USD" as const, unit: "per_minute" as const, rate_micros: 70_000 },
      openrouter_llm: { enabled: true, currency: "USD" as const, unit: "per_minute" as const, rate_micros: 3_000 },
      twilio_voice: { enabled: false, currency: "AUD" as const, unit: "per_minute" as const, rate_micros: 75_000 },
      twilio_sms: { enabled: false, currency: "AUD" as const, unit: "per_minute" as const, rate_micros: 0 },
      number_rental: { enabled: false, currency: "AUD" as const, unit: "per_month" as const, rate_micros: 8_250_000 },
      other: { enabled: false, currency: "AUD" as const, unit: "per_minute" as const, rate_micros: 0 },
    },
  };
  const merged = mergeWithDefaults(liveRow);
  assertEquals(merged.components.sms_llm.enabled, true);
  assertEquals(merged.components.sms_llm.unit, "per_message");
  assertEquals(merged.billing_anchor_day, 1);
  assertEquals(merged.client_display?.show_rate, true);
  assertEquals(merged.markup_bps, 10_000);
  // And the blended rate is unaffected by the new per_message component.
  const r = computeBlendedRate(merged);
  assertEquals(r.lineItems.map((l) => l.key).sort(), ["openrouter_llm", "retell"]);
  assert(r.per_message_minor > 0);
});
