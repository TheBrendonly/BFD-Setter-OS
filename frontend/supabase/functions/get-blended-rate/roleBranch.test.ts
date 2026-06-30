import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeBlendedRate } from "../_shared/computeBlendedRate.ts";
import { DEFAULT_PRICING_CONFIG, mergeWithDefaults } from "../_shared/pricingDefaults.ts";
import { branchByRole } from "./roleBranch.ts";

// F8 governance — the role split is what disarms the trap (RLS on clients is
// row-level + agency-scoped with no column protection, so the boundary MUST be
// server-side). The CLIENT branch may return ONLY the final scalar; the AGENCY
// branch may return the full breakdown + markup + rate table. These tests are
// the unit-level "client cannot read the markup" proof.

// A config with a high markup + the toggle ON — the worst case for a leak.
const MERGED = mergeWithDefaults({ markup_bps: 10_000, show_rate_to_client: true });
const COMPUTED = computeBlendedRate(MERGED);

// Substrings that must NEVER appear in a client-role response.
const FORBIDDEN = ["markup", "rate_table", "fx", "components", "fixed", "lineItems", "subtotal", "micros"];

Deno.test("client + show_rate_to_client OFF returns ONLY {show:false}", () => {
  const off = mergeWithDefaults({ markup_bps: 10_000, show_rate_to_client: false });
  const res = branchByRole(off, "client", computeBlendedRate(off));
  assertEquals(res, { show: false });
});

Deno.test("client + show ON returns ONLY {show, blended_per_min_minor, display_currency}", () => {
  const res = branchByRole(MERGED, "client", COMPUTED) as Record<string, unknown>;
  assertEquals(Object.keys(res).sort(), ["blended_per_min_minor", "display_currency", "show"]);
  assertEquals(res.show, true);
  assertEquals(res.blended_per_min_minor, COMPUTED.blended_per_min_minor);
  assertEquals(res.display_currency, "AUD");
});

Deno.test("client response leaks ZERO markup/cost-input bytes (string scan)", () => {
  const json = JSON.stringify(branchByRole(MERGED, "client", COMPUTED));
  for (const needle of FORBIDDEN) {
    assert(!json.includes(needle), `client response leaked "${needle}": ${json}`);
  }
});

Deno.test("client branch builds a FRESH literal (not a filtered copy of the agency object)", () => {
  // Even when computed carries a full breakdown, the client gets only the scalar.
  const res = branchByRole(MERGED, "client", COMPUTED) as Record<string, unknown>;
  assert(!("rate_table" in res));
  assert(!("markup_bps" in res));
  assert(!("lineItems" in res));
  assert(!("fixed_monthly_minor" in res));
});

Deno.test("agency role gets the full breakdown + markup + rate table (proves a role split)", () => {
  const res = branchByRole(MERGED, "agency", COMPUTED) as Record<string, unknown>;
  assertEquals(res.markup_bps, COMPUTED.markup_bps);
  assertEquals(res.blended_per_min_minor, COMPUTED.blended_per_min_minor);
  assertEquals(res.fixed_monthly_minor, COMPUTED.fixed_monthly_minor);
  assert("rate_table" in res);
  assert("lineItems" in res);
  assert("fx_usd_to_display_micros" in res);
  // the agency sees the toggle state it controls
  assertEquals(res.show_rate_to_client, true);
});
