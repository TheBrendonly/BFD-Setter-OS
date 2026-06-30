// F8 cost-to-price calculator — pure money-math core.
//
// Turns per-component provider rates into a displayed blended price/min, applying
// a USD->display FX rate (+ optional buffer) and a markup. ALL arithmetic is
// integer (BigInt); the only rounding is a single round-half-to-even at the
// micros->cents boundary, so the result is deterministic and line items sum
// exactly. No floats, no toFixed, no I/O — this module is imported by BOTH the
// agency editor (live preview) and the get-blended-rate edge fn (authoritative
// client number), so there is ONE math implementation. Keep it dependency-free.
//
// Units: 1 dollar = 1,000,000 micros; 1 cent = 10,000 micros. FX is an integer
// micro-multiplier (1.52 -> 1_520_000). Markup + FX buffer are basis points
// (50% -> 5000). "AUD" here means the display currency; "USD" components are the
// only ones FX-converted. Per-month components (number rental, A2P) are kept in a
// SEPARATE fixed_monthly_minor and never folded into the per-minute blend.

export type ComponentUnit = "per_minute" | "per_month";
export type ComponentCurrency = "USD" | "AUD";

/** One configurable cost component (e.g. retell, openrouter_llm, twilio_voice). */
export interface PricingComponent {
  enabled: boolean;
  currency: ComponentCurrency;
  unit: ComponentUnit;
  rate_micros: number;
}

/** The fully-merged pricing config for a sub-account. */
export interface PricingConfig {
  display_currency: string;
  fx_usd_to_display_micros: number;
  fx_buffer_bps: number;
  fx_updated_at?: string;
  markup_bps: number;
  show_rate_to_client: boolean;
  components: Record<string, PricingComponent>;
}

/** A single enabled component, reported in its native (pre-FX, pre-markup) micros. */
export interface LineItem {
  key: string;
  currency: ComponentCurrency;
  unit: ComponentUnit;
  native_micros: number;
}

export interface BlendedRateResult {
  lineItems: LineItem[];        // enabled per-minute components (native micros)
  fixedLineItems: LineItem[];   // enabled per-month components (native micros)
  usd_per_min_micros: number;   // exact integer subtotal (native USD)
  aud_per_min_micros: number;   // exact integer subtotal (native display currency)
  blended_per_min_minor: number;   // cents, display currency, post-FX + markup (single round)
  fixed_monthly_minor: number;     // cents, display currency, post-FX, no markup
  display_currency: string;
  markup_bps: number;
  fx_usd_to_display_micros: number;
  fx_buffer_bps: number;
}

const MICROS_PER_DOLLAR = 1_000_000n;
const BPS_DEN = 10_000n;

/** Round num/den (den > 0, num >= 0) to the nearest integer, ties to even. */
function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num - q * den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

export function computeBlendedRate(config: PricingConfig): BlendedRateResult {
  const fxMicros = BigInt(Math.trunc(config.fx_usd_to_display_micros));
  const bufferBps = BigInt(Math.trunc(config.fx_buffer_bps));
  const markupBps = BigInt(Math.trunc(config.markup_bps));

  // fx_eff = (fxMicros / 1e6) * ((10000 + buffer) / 10000), held as fxNum / fxDen.
  const fxNum = fxMicros * (BPS_DEN + bufferBps);
  const fxDen = MICROS_PER_DOLLAR * BPS_DEN;

  const lineItems: LineItem[] = [];
  const fixedLineItems: LineItem[] = [];
  let usdPerMin = 0n;
  let audPerMin = 0n;
  let usdMonth = 0n;
  let audMonth = 0n;

  // Stable key order -> deterministic output regardless of object insertion order.
  for (const key of Object.keys(config.components).sort()) {
    const c = config.components[key];
    if (!c || !c.enabled) continue;
    const micros = BigInt(Math.trunc(c.rate_micros));
    const item: LineItem = {
      key,
      currency: c.currency,
      unit: c.unit,
      native_micros: Number(micros),
    };
    if (c.unit === "per_month") {
      fixedLineItems.push(item);
      if (c.currency === "USD") usdMonth += micros;
      else audMonth += micros;
    } else {
      lineItems.push(item);
      if (c.currency === "USD") usdPerMin += micros;
      else audPerMin += micros;
    }
  }

  // Per-minute blended cents, as one exact rational rounded once:
  //   cents = 100 * (10000 + markup) * (usd*fxNum + aud*fxDen) / (10000 * 1e6 * fxDen)
  const perMinNum = 100n * (BPS_DEN + markupBps) * (usdPerMin * fxNum + audPerMin * fxDen);
  const perMinDen = BPS_DEN * MICROS_PER_DOLLAR * fxDen;
  const blendedCents = roundHalfEven(perMinNum, perMinDen);

  // Fixed monthly cents (no markup): 100 * (usd*fxNum + aud*fxDen) / (1e6 * fxDen)
  const fixedNum = 100n * (usdMonth * fxNum + audMonth * fxDen);
  const fixedDen = MICROS_PER_DOLLAR * fxDen;
  const fixedCents = roundHalfEven(fixedNum, fixedDen);

  return {
    lineItems,
    fixedLineItems,
    usd_per_min_micros: Number(usdPerMin),
    aud_per_min_micros: Number(audPerMin),
    blended_per_min_minor: Number(blendedCents),
    fixed_monthly_minor: Number(fixedCents),
    display_currency: config.display_currency,
    markup_bps: Number(markupBps),
    fx_usd_to_display_micros: Number(fxMicros),
    fx_buffer_bps: Number(bufferBps),
  };
}
