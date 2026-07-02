import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { billableMinutes, computeUsagePricing } from "./computeUsage.ts";
import { computeBlendedRate, type PricingConfig } from "./computeBlendedRate.ts";
import { mergeWithDefaults } from "./pricingDefaults.ts";

// F13 usage metering — pure usage pricing (no DB, no HTTP).
// Voice: each call rounds UP to the next whole minute (Brendan's decision),
// billed at the blended per-minute sell rate. SMS: outbound texts x the
// per_message sell rate. The actual-cost side converts Retell's reported USD
// at the RAW FX rate (no buffer; the buffer is a sell-side pad only).

function fixture(over: Partial<PricingConfig> = {}) {
  // FX 1.50, no buffer, 50% markup, retell US$0.07/min + sms_llm US$0.003/msg.
  const merged = mergeWithDefaults({
    fx_usd_to_display_micros: 1_500_000,
    fx_buffer_bps: 0,
    markup_bps: 5_000,
    ...over,
  });
  return { merged, computed: computeBlendedRate(merged) };
}

Deno.test("billableMinutes: each call ceils to a whole minute (59s/60s/61s/0)", () => {
  assertEquals(billableMinutes([{ duration_ms: 59_000, duration_seconds: 59 }]), 1);
  assertEquals(billableMinutes([{ duration_ms: 60_000, duration_seconds: 60 }]), 1);
  assertEquals(billableMinutes([{ duration_ms: 61_000, duration_seconds: 61 }]), 2);
  assertEquals(billableMinutes([{ duration_ms: 0, duration_seconds: 0 }]), 0);
  assertEquals(
    billableMinutes([
      { duration_ms: 61_000, duration_seconds: 61 },
      { duration_ms: 30_000, duration_seconds: 30 },
    ]),
    3,
  );
});

Deno.test("billableMinutes: null duration_ms falls back to duration_seconds; both null counts 0", () => {
  assertEquals(billableMinutes([{ duration_ms: null, duration_seconds: 90 }]), 2);
  assertEquals(billableMinutes([{ duration_ms: null, duration_seconds: null }]), 0);
  assertEquals(billableMinutes([{ duration_ms: -5_000, duration_seconds: -5 }]), 0);
});

Deno.test("voice billed = minutes x blended rate, exact integer math", () => {
  const { merged, computed } = fixture();
  // blended: 0.073 USD * 1.5 = 0.1095 AUD; * 1.5 = 0.16425 = 16.425c -> 16c.
  assertEquals(computed.blended_per_min_minor, 16);
  const r = computeUsagePricing({
    billableMinutes: 100,
    outboundTexts: 0,
    computed,
    merged,
    actualVoiceCostUsdMicros: 0,
  });
  assertEquals(r.voice_billed_minor, 1_600);
  assertEquals(r.sms_billed_minor, 0);
  assertEquals(r.usage_billed_minor, 1_600);
});

Deno.test("sms billed = texts x per_message sell rate", () => {
  const { merged, computed } = fixture();
  // per message: 0.003 * 1.5 * 1.5 = 0.675c -> 1c.
  assertEquals(computed.per_message_minor, 1);
  const r = computeUsagePricing({
    billableMinutes: 0,
    outboundTexts: 200,
    computed,
    merged,
    actualVoiceCostUsdMicros: 0,
  });
  assertEquals(r.sms_billed_minor, 200);
  assertEquals(r.usage_billed_minor, 200);
});

Deno.test("actual voice cost converts USD micros at the RAW FX rate (no buffer), round half even", () => {
  const { merged, computed } = fixture({ fx_buffer_bps: 200 }); // buffer must NOT apply
  // 10.00 USD * 1.50 = 15.00 AUD = 1500c exactly (buffer would make it 1530c).
  const r = computeUsagePricing({
    billableMinutes: 0,
    outboundTexts: 0,
    computed,
    merged,
    actualVoiceCostUsdMicros: 10_000_000,
  });
  assertEquals(r.actual_voice_cost_minor, 1_500);
});

Deno.test("est sms cost = texts x sms_llm native rate, FX-converted, NO markup", () => {
  const { merged, computed } = fixture();
  // 1000 texts * 0.003 USD = 3.00 USD * 1.5 = 4.50 AUD = 450c.
  const r = computeUsagePricing({
    billableMinutes: 0,
    outboundTexts: 1_000,
    computed,
    merged,
    actualVoiceCostUsdMicros: 0,
  });
  assertEquals(r.est_sms_cost_minor, 450);
});

Deno.test("margin = billed - actual cost; margin_bps integer", () => {
  const { merged, computed } = fixture();
  const r = computeUsagePricing({
    billableMinutes: 100, // billed 1600c
    outboundTexts: 0,
    computed,
    merged,
    actualVoiceCostUsdMicros: 7_000_000, // 7 USD * 1.5 = 1050c actual
  });
  assertEquals(r.actual_cost_minor, 1_050);
  assertEquals(r.margin_minor, 550);
  // 550 / 1600 = 34.375% -> 3438 bps (round half even on 3437.5 -> 3438).
  assertEquals(r.margin_bps, 3_438);
});

Deno.test("zero billed usage: margin_bps is null, margin still subtracts cost", () => {
  const { merged, computed } = fixture();
  const r = computeUsagePricing({
    billableMinutes: 0,
    outboundTexts: 0,
    computed,
    merged,
    actualVoiceCostUsdMicros: 1_000_000,
  });
  assertEquals(r.usage_billed_minor, 0);
  assertEquals(r.margin_bps, null);
  assertEquals(r.margin_minor, -150);
});

Deno.test("disabled sms_llm component: texts count but bill and cost estimate are 0", () => {
  const { merged, computed } = fixture({
    components: { sms_llm: { enabled: false, currency: "USD", unit: "per_message", rate_micros: 3_000 } },
  });
  const r = computeUsagePricing({
    billableMinutes: 0,
    outboundTexts: 500,
    computed,
    merged,
    actualVoiceCostUsdMicros: 0,
  });
  assertEquals(r.sms_billed_minor, 0);
  assertEquals(r.est_sms_cost_minor, 0);
});
