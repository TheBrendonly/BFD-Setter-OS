// F8 governance — the role split (the trap disarmer).
//
// RLS on `clients` is row-level + agency-scoped with NO column protection, and a
// real client is its own agency, so hiding the markup only in React is defeated
// by a direct edge/table call. The boundary is THIS server-side branch:
//   - role "client": gets ONLY the final scalar, and only when the agency has
//     turned show_rate_to_client on. The response is built as a FRESH literal
//     (never the agency object with keys deleted) so a future field added to the
//     breakdown cannot leak by omission.
//   - role "agency": may receive the full breakdown + markup + rate table.
// Kept pure (no I/O) so the index handler stays thin and this is unit-testable.

import type { BlendedRateResult, PricingComponent, PricingConfig } from "../_shared/computeBlendedRate.ts";

export type ClientRateResponse =
  | { show: false }
  | { show: true; blended_per_min_minor: number; display_currency: string };

export interface AgencyRateResponse {
  role: "agency";
  show_rate_to_client: boolean;
  blended_per_min_minor: number;
  per_message_minor: number;
  fixed_monthly_minor: number;
  display_currency: string;
  markup_bps: number;
  fx_usd_to_display_micros: number;
  fx_buffer_bps: number;
  lineItems: BlendedRateResult["lineItems"];
  fixedLineItems: BlendedRateResult["fixedLineItems"];
  messageLineItems: BlendedRateResult["messageLineItems"];
  usd_per_min_micros: number;
  aud_per_min_micros: number;
  rate_table: Record<string, PricingComponent>;
}

export function branchByRole(
  merged: PricingConfig,
  role: "agency" | "client",
  computed: BlendedRateResult,
): ClientRateResponse | AgencyRateResponse {
  if (role === "client") {
    if (!merged.show_rate_to_client) return { show: false };
    // FRESH whitelisted literal — never spread the agency object and delete keys.
    return {
      show: true,
      blended_per_min_minor: computed.blended_per_min_minor,
      display_currency: computed.display_currency,
    };
  }
  // agency: full breakdown (markup + rate table are agency-only).
  return {
    role: "agency",
    show_rate_to_client: merged.show_rate_to_client,
    blended_per_min_minor: computed.blended_per_min_minor,
    per_message_minor: computed.per_message_minor,
    fixed_monthly_minor: computed.fixed_monthly_minor,
    display_currency: computed.display_currency,
    markup_bps: computed.markup_bps,
    fx_usd_to_display_micros: computed.fx_usd_to_display_micros,
    fx_buffer_bps: computed.fx_buffer_bps,
    lineItems: computed.lineItems,
    fixedLineItems: computed.fixedLineItems,
    messageLineItems: computed.messageLineItems,
    usd_per_min_micros: computed.usd_per_min_micros,
    aud_per_min_micros: computed.aud_per_min_micros,
    rate_table: merged.components,
  };
}
