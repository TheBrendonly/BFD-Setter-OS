// F13 governance — the usage role split (same trap class as F8).
//
// RLS on `clients` is row-level + agency-scoped with NO column protection, and
// a real client IS its own agency, so hiding margin / actual provider cost only
// in React is defeated by a direct edge call. The boundary is THIS server-side
// branch:
//   - role "client": gets ONLY the parts the agency toggled on in
//     client_display, as a FRESH whitelisted literal with toggled-off keys
//     OMITTED entirely. All four toggles off -> exactly { show: false }.
//     Margin, actual cost, markup, FX, micros and per-component data NEVER
//     appear in any client shape.
//   - role "agency": the full usage + margin payload.
// Kept pure (no I/O) so the index handler stays thin and this is unit-testable.

import type { PricingConfig } from "../_shared/computeBlendedRate.ts";
import type { BillingPeriod } from "../_shared/billingPeriod.ts";
import { DEFAULT_PRICING_CONFIG } from "../_shared/pricingDefaults.ts";

export interface UsagePayload {
  period: BillingPeriod;
  display_currency: string;
  voice: {
    calls: number;
    null_cost_calls: number;
    billable_minutes: number;
    billed_minor: number;
    actual_cost_usd_micros: number;
    actual_cost_minor: number;
    blended_per_min_minor: number;
  };
  sms: {
    outbound_texts: number;
    billed_minor: number;
    per_message_minor: number;
    est_cost_minor: number;
  };
  totals: {
    usage_billed_minor: number;
    fixed_monthly_minor: number;
    actual_cost_minor: number;
    margin_minor: number;
    margin_bps: number | null;
  };
}

export interface ClientUsageResponse {
  show: true;
  period: { start_utc: string; end_utc: string; label: string };
  display_currency: string;
  minutes?: number;
  texts?: number;
  rate_per_min_minor?: number;
  total_minor?: number;
  fixed_monthly_minor?: number;
}

export interface AgencyUsageResponse {
  role: "agency";
  period: BillingPeriod;
  display_currency: string;
  voice: UsagePayload["voice"];
  sms: UsagePayload["sms"];
  totals: UsagePayload["totals"];
  client_display: NonNullable<PricingConfig["client_display"]>;
}

export function branchUsageByRole(
  merged: PricingConfig,
  role: "agency" | "client",
  payload: UsagePayload,
): { show: false } | ClientUsageResponse | AgencyUsageResponse {
  const display = merged.client_display ?? DEFAULT_PRICING_CONFIG.client_display;
  if (role === "client") {
    const anyPart = display.show_rate || display.show_minutes || display.show_texts ||
      display.show_total;
    if (!anyPart) return { show: false };
    // FRESH whitelisted literal — never spread the agency payload and delete
    // keys. Toggled-off parts are omitted so nothing leaks by presence.
    const res: ClientUsageResponse = {
      show: true,
      period: {
        start_utc: payload.period.start_utc,
        end_utc: payload.period.end_utc,
        label: payload.period.label,
      },
      display_currency: payload.display_currency,
    };
    if (display.show_minutes) res.minutes = payload.voice.billable_minutes;
    if (display.show_texts) res.texts = payload.sms.outbound_texts;
    if (display.show_rate) res.rate_per_min_minor = payload.voice.blended_per_min_minor;
    if (display.show_total) {
      res.total_minor = payload.totals.usage_billed_minor;
      res.fixed_monthly_minor = payload.totals.fixed_monthly_minor;
    }
    return res;
  }
  // agency: full usage + margin view.
  return {
    role: "agency",
    period: payload.period,
    display_currency: payload.display_currency,
    voice: payload.voice,
    sms: payload.sms,
    totals: payload.totals,
    client_display: display,
  };
}
