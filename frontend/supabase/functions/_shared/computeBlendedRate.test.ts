import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeBlendedRate,
  type PricingComponent,
  type PricingConfig,
} from "./computeBlendedRate.ts";

// F8 cost-to-price calculator — pure money-math core.
// Integer micros internally (1 dollar = 1,000,000 micros; 1 cent = 10,000 micros),
// FX as an integer micro-multiplier, markup + FX buffer in basis points, ONE
// round-half-to-even at the micros->cents boundary. No floats, no toFixed.
// These tests cover ONLY the pure logic (no DB, no HTTP).

// FX 1.52 USD->display expressed in micros.
const FX_152 = 1_520_000;
const FX_150 = 1_500_000;

function comp(over: Partial<PricingComponent> = {}): PricingComponent {
  return { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 0, ...over };
}

function cfg(over: Partial<PricingConfig> = {}): PricingConfig {
  return {
    display_currency: "AUD",
    fx_usd_to_display_micros: FX_152,
    fx_buffer_bps: 0,
    markup_bps: 0,
    show_rate_to_client: false,
    components: {},
    ...over,
  };
}

Deno.test("USD-only: single explicit FX step, no markup", () => {
  // 0.07 USD/min * 1.52 = 0.1064 AUD = 10.64c -> round half-even -> 11c.
  const r = computeBlendedRate(cfg({
    components: { retell: comp({ currency: "USD", rate_micros: 70_000 }) },
  }));
  assertEquals(r.usd_per_min_micros, 70_000);
  assertEquals(r.aud_per_min_micros, 0);
  assertEquals(r.blended_per_min_minor, 11);
  assertEquals(r.display_currency, "AUD");
});

Deno.test("markup multiplier applies to the per-minute blend", () => {
  // 0.07 * 1.52 = 0.1064; * 1.5 (5000 bps) = 0.1596 AUD = 15.96c -> 16c.
  const r = computeBlendedRate(cfg({
    markup_bps: 5000,
    components: { retell: comp({ currency: "USD", rate_micros: 70_000 }) },
  }));
  assertEquals(r.blended_per_min_minor, 16);
});

Deno.test("mixed USD + AUD components: only the USD aggregate is FX-converted", () => {
  // USD 0.07 * 1.50 = 0.105 AUD ; AUD 0.075 (no FX) ; total 0.180 AUD = 18c.
  const r = computeBlendedRate(cfg({
    fx_usd_to_display_micros: FX_150,
    components: {
      retell: comp({ currency: "USD", rate_micros: 70_000 }),
      twilio_voice: comp({ currency: "AUD", rate_micros: 75_000 }),
    },
  }));
  assertEquals(r.usd_per_min_micros, 70_000);
  assertEquals(r.aud_per_min_micros, 75_000);
  assertEquals(r.blended_per_min_minor, 18);
});

Deno.test("FX buffer (bps) inflates the conversion rate", () => {
  // fx 1.50 * (1 + 200bps=2%) = 1.53 ; 0.07 * 1.53 = 0.1071 = 10.71c -> 11c.
  const r = computeBlendedRate(cfg({
    fx_usd_to_display_micros: FX_150,
    fx_buffer_bps: 200,
    components: { retell: comp({ currency: "USD", rate_micros: 70_000 }) },
  }));
  assertEquals(r.blended_per_min_minor, 11);
});

Deno.test("per-month components are segregated into fixed_monthly_minor, never the per-min blend", () => {
  const r = computeBlendedRate(cfg({
    markup_bps: 5000,
    fx_usd_to_display_micros: FX_150,
    components: {
      retell: comp({ currency: "USD", unit: "per_minute", rate_micros: 70_000 }),
      number_rental: comp({ currency: "AUD", unit: "per_month", rate_micros: 8_250_000 }),
    },
  }));
  // Per-min blend is retell only (markup applies): 0.07*1.5=0.105; *1.5=0.1575=15.75c -> 16c.
  assertEquals(r.blended_per_min_minor, 16);
  // number_rental is $8.25/mo = 825c, no markup, no FX (already AUD).
  assertEquals(r.fixed_monthly_minor, 825);
  // number_rental is NOT in the per-minute line items.
  assertEquals(r.lineItems.map((l) => l.key), ["retell"]);
  assertEquals(r.fixedLineItems.map((l) => l.key), ["number_rental"]);
});

Deno.test("round-half-to-even at the micros->cents boundary, both directions", () => {
  // 10.5c -> 10 (even). 0.07 USD * 1.50 = 0.105 AUD = 10.5c.
  const half10 = computeBlendedRate(cfg({
    fx_usd_to_display_micros: FX_150,
    components: { retell: comp({ currency: "USD", rate_micros: 70_000 }) },
  }));
  assertEquals(half10.blended_per_min_minor, 10);
  // 11.5c -> 12 (even). AUD 0.115 (no FX, no markup).
  const half11 = computeBlendedRate(cfg({
    components: { other: comp({ currency: "AUD", rate_micros: 115_000 }) },
  }));
  assertEquals(half11.blended_per_min_minor, 12);
});

Deno.test("deterministic: two runs of the same config are byte-identical", () => {
  const c = cfg({
    markup_bps: 5000,
    fx_buffer_bps: 150,
    components: {
      retell: comp({ currency: "USD", rate_micros: 70_000 }),
      openrouter_llm: comp({ currency: "USD", rate_micros: 3_000 }),
      twilio_voice: comp({ currency: "AUD", rate_micros: 75_000 }),
    },
  });
  assertEquals(JSON.stringify(computeBlendedRate(c)), JSON.stringify(computeBlendedRate(c)));
});

Deno.test("per-component enable/disable: disabled components are excluded", () => {
  const r = computeBlendedRate(cfg({
    components: {
      retell: comp({ currency: "USD", rate_micros: 70_000, enabled: true }),
      twilio_voice: comp({ currency: "AUD", rate_micros: 75_000, enabled: false }),
    },
  }));
  assertEquals(r.aud_per_min_micros, 0);
  assertEquals(r.lineItems.map((l) => l.key), ["retell"]);
});

Deno.test("all-disabled config yields zero everywhere", () => {
  const r = computeBlendedRate(cfg({
    components: {
      retell: comp({ currency: "USD", rate_micros: 70_000, enabled: false }),
      number_rental: comp({ currency: "AUD", unit: "per_month", rate_micros: 8_250_000, enabled: false }),
    },
  }));
  assertEquals(r.blended_per_min_minor, 0);
  assertEquals(r.fixed_monthly_minor, 0);
  assertEquals(r.lineItems, []);
  assertEquals(r.fixedLineItems, []);
});

Deno.test("line items sum EXACTLY to the per-currency subtotals (integer, no rounding)", () => {
  const r = computeBlendedRate(cfg({
    components: {
      retell: comp({ currency: "USD", rate_micros: 70_000 }),
      openrouter_llm: comp({ currency: "USD", rate_micros: 3_000 }),
      twilio_voice: comp({ currency: "AUD", rate_micros: 75_000 }),
      twilio_sms: comp({ currency: "AUD", rate_micros: 1_200 }),
    },
  }));
  const usdSum = r.lineItems.filter((l) => l.currency === "USD").reduce((a, l) => a + l.native_micros, 0);
  const audSum = r.lineItems.filter((l) => l.currency === "AUD").reduce((a, l) => a + l.native_micros, 0);
  assertEquals(usdSum, r.usd_per_min_micros);
  assertEquals(audSum, r.aud_per_min_micros);
  assertEquals(r.usd_per_min_micros, 73_000);
  assertEquals(r.aud_per_min_micros, 76_200);
});

Deno.test("a per-month USD component is FX-converted into fixed_monthly_minor", () => {
  // USD $5.00/mo * 1.50 = $7.50/mo = 750c (no markup on fixed monthly).
  const r = computeBlendedRate(cfg({
    fx_usd_to_display_micros: FX_150,
    markup_bps: 5000,
    components: {
      a2p: comp({ currency: "USD", unit: "per_month", rate_micros: 5_000_000 }),
    },
  }));
  assertEquals(r.fixed_monthly_minor, 750);
  assert(r.lineItems.length === 0);
});
