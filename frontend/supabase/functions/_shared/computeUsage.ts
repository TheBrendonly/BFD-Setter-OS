// F13 usage metering — pure usage pricing (no I/O, integer money math).
//
// Voice: each call rounds UP to the next whole minute and the period's minute
// total is billed at the blended per-minute sell rate (computeBlendedRate).
// SMS: outbound texts x the per_message sell rate. The actual-cost side
// (agency-only) converts Retell's reported USD cost at the RAW FX rate, no
// buffer and no markup: the buffer is a sell-side pad, not a cost. Follows the
// computeBlendedRate conventions: BigInt internally, ONE round-half-to-even
// per output figure, cents ("minor") in the display currency.

import type { BlendedRateResult, PricingConfig } from "./computeBlendedRate.ts";

export interface UsageCall {
  duration_ms: number | null;
  duration_seconds: number | null;
}

const MICROS_PER_DOLLAR = 1_000_000n;
const BPS_DEN = 10_000n;
const MS_PER_MINUTE = 60_000;

/** Round num/den (den > 0) to the nearest integer, ties to even; sign-safe. */
function roundHalfEvenSigned(num: bigint, den: bigint): bigint {
  const negative = num < 0n;
  const n = negative ? -num : num;
  const q = n / den;
  const r = n - q * den;
  const twice = r * 2n;
  let out = q;
  if (twice > den) out = q + 1n;
  else if (twice === den) out = q % 2n === 0n ? q : q + 1n;
  return negative ? -out : out;
}

/** Sum of per-call minutes, each call ceiled to a whole minute. */
export function billableMinutes(calls: UsageCall[]): number {
  let minutes = 0;
  for (const call of calls) {
    const ms = typeof call.duration_ms === "number" && Number.isFinite(call.duration_ms)
      ? call.duration_ms
      : typeof call.duration_seconds === "number" && Number.isFinite(call.duration_seconds)
      ? call.duration_seconds * 1000
      : null;
    if (ms === null || ms <= 0) continue;
    minutes += Math.ceil(ms / MS_PER_MINUTE);
  }
  return minutes;
}

export interface UsagePricingArgs {
  billableMinutes: number;
  outboundTexts: number;
  computed: BlendedRateResult;
  merged: PricingConfig;
  /** Sum of call_history.cost for the period, as integer USD micros. */
  actualVoiceCostUsdMicros: number;
}

export interface UsagePricingResult {
  voice_billed_minor: number;
  sms_billed_minor: number;
  usage_billed_minor: number;
  actual_voice_cost_minor: number;
  est_sms_cost_minor: number;
  actual_cost_minor: number;
  margin_minor: number;
  margin_bps: number | null;
}

export function computeUsagePricing(args: UsagePricingArgs): UsagePricingResult {
  const minutes = BigInt(Math.max(0, Math.trunc(args.billableMinutes)));
  const texts = BigInt(Math.max(0, Math.trunc(args.outboundTexts)));
  const fxMicros = BigInt(Math.trunc(args.merged.fx_usd_to_display_micros));

  // Billed side: integer multiples of the already-rounded sell rates.
  const voiceBilled = minutes * BigInt(args.computed.blended_per_min_minor);
  const smsBilled = texts * BigInt(args.computed.per_message_minor);
  const usageBilled = voiceBilled + smsBilled;

  // Actual voice cost: USD micros -> display cents at the RAW FX (no buffer).
  //   cents = 100 * usdMicros * fxMicros / (1e6 * 1e6)
  const costDen = MICROS_PER_DOLLAR * MICROS_PER_DOLLAR;
  const actualVoiceCost = roundHalfEvenSigned(
    100n * BigInt(Math.trunc(args.actualVoiceCostUsdMicros)) * fxMicros,
    costDen,
  );

  // Estimated SMS cost: texts x the NATIVE per-message subtotals (already zero
  // when the component is disabled), FX on the USD part only, no markup.
  const usdMsg = BigInt(args.computed.usd_per_message_micros);
  const audMsg = BigInt(args.computed.aud_per_message_micros);
  const estSmsCost = roundHalfEvenSigned(
    100n * texts * (usdMsg * fxMicros + audMsg * MICROS_PER_DOLLAR),
    costDen,
  );

  const actualCost = actualVoiceCost + estSmsCost;
  const margin = usageBilled - actualCost;
  const marginBps = usageBilled > 0n
    ? Number(roundHalfEvenSigned(margin * BPS_DEN, usageBilled))
    : null;

  return {
    voice_billed_minor: Number(voiceBilled),
    sms_billed_minor: Number(smsBilled),
    usage_billed_minor: Number(usageBilled),
    actual_voice_cost_minor: Number(actualVoiceCost),
    est_sms_cost_minor: Number(estSmsCost),
    actual_cost_minor: Number(actualCost),
    margin_minor: Number(margin),
    margin_bps: marginBps,
  };
}
