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
