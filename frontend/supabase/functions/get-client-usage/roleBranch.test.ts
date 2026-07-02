import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { branchUsageByRole, type UsagePayload } from "./roleBranch.ts";
import { mergeWithDefaults } from "../_shared/pricingDefaults.ts";
import type { ClientDisplayConfig } from "../_shared/computeBlendedRate.ts";

// F13 governance — the usage role split. Same trap class as F8: a real client
// is its own agency, so the ONLY boundary between a client and the margin /
// actual-cost figures is this server-side branch. The client response is a
// FRESH literal; toggled-off parts are OMITTED (not nulled); all four toggles
// off returns exactly { show: false }.

function payload(): UsagePayload {
  return {
    period: {
      start_utc: "2026-06-15T00:00:00.000Z",
      end_utc: "2026-07-15T00:00:00.000Z",
      label: "15 Jun 2026 to 14 Jul 2026",
      anchor_day: 15,
      timezone: "Australia/Sydney",
      offset: 0,
    },
    display_currency: "AUD",
    voice: {
      calls: 12,
      null_cost_calls: 1,
      billable_minutes: 132,
      billed_minor: 2_112,
      actual_cost_usd_micros: 9_120_000,
      actual_cost_minor: 1_368,
      blended_per_min_minor: 16,
    },
    sms: {
      outbound_texts: 218,
      billed_minor: 218,
      per_message_minor: 1,
      est_cost_minor: 98,
    },
    totals: {
      usage_billed_minor: 2_330,
      fixed_monthly_minor: 825,
      actual_cost_minor: 1_466,
      margin_minor: 864,
      margin_bps: 3_708,
    },
  };
}

function mergedWith(display: Partial<ClientDisplayConfig>) {
  return mergeWithDefaults({
    client_display: {
      show_rate: false,
      show_minutes: false,
      show_texts: false,
      show_total: false,
      ...display,
    },
  });
}

Deno.test("client with all toggles off gets exactly { show: false }", () => {
  const res = branchUsageByRole(mergedWith({}), "client", payload());
  assertEquals(res, { show: false });
});

Deno.test("each toggle independently adds ONLY its own keys", () => {
  const base = ["show", "period", "display_currency"];
  const cases: Array<[Partial<ClientDisplayConfig>, string[]]> = [
    [{ show_minutes: true }, ["minutes"]],
    [{ show_texts: true }, ["texts"]],
    [{ show_rate: true }, ["rate_per_min_minor"]],
    [{ show_total: true }, ["total_minor", "fixed_monthly_minor"]],
  ];
  for (const [display, extras] of cases) {
    const res = branchUsageByRole(mergedWith(display), "client", payload());
    assertEquals(
      Object.keys(res as Record<string, unknown>).sort(),
      [...base, ...extras].sort(),
      `toggle case ${JSON.stringify(display)}`,
    );
  }
});

Deno.test("all four toggles on: exact key set and exact values", () => {
  const res = branchUsageByRole(
    mergedWith({ show_rate: true, show_minutes: true, show_texts: true, show_total: true }),
    "client",
    payload(),
  ) as Record<string, unknown>;
  assertEquals(Object.keys(res).sort(), [
    "display_currency",
    "fixed_monthly_minor",
    "minutes",
    "period",
    "rate_per_min_minor",
    "show",
    "texts",
    "total_minor",
  ]);
  assertEquals(res.show, true);
  assertEquals(res.minutes, 132);
  assertEquals(res.texts, 218);
  assertEquals(res.rate_per_min_minor, 16);
  assertEquals(res.total_minor, 2_330);
  assertEquals(res.fixed_monthly_minor, 825);
  // The client period is label + boundaries only (no anchor/timezone/offset).
  assertEquals(Object.keys(res.period as Record<string, unknown>).sort(), [
    "end_utc",
    "label",
    "start_utc",
  ]);
});

Deno.test("client response never contains forbidden substrings (margin/cost/markup/fx/micros/...)", () => {
  const res = branchUsageByRole(
    mergedWith({ show_rate: true, show_minutes: true, show_texts: true, show_total: true }),
    "client",
    payload(),
  );
  const body = JSON.stringify(res).toLowerCase();
  const forbidden = [
    "margin",
    "actual",
    "cost",
    "markup",
    "fx",
    "micros",
    "rate_table",
    "usd_",
    "components",
    "lineitems",
    "bps",
    "billed",
  ];
  for (const word of forbidden) {
    assert(!body.includes(word), `client response leaked "${word}": ${body}`);
  }
});

Deno.test("legacy show_rate_to_client=true (no client_display saved) shows the rate part", () => {
  const merged = mergeWithDefaults({ show_rate_to_client: true });
  const res = branchUsageByRole(merged, "client", payload()) as Record<string, unknown>;
  assertEquals(res.show, true);
  assertEquals(res.rate_per_min_minor, 16);
  assertEquals("minutes" in res, false);
});

Deno.test("agency gets the full payload + client_display echo", () => {
  const merged = mergedWith({ show_minutes: true });
  const res = branchUsageByRole(merged, "agency", payload()) as Record<string, unknown>;
  assertEquals(res.role, "agency");
  assertEquals(Object.keys(res).sort(), [
    "client_display",
    "display_currency",
    "period",
    "role",
    "sms",
    "totals",
    "voice",
  ]);
  const totals = res.totals as Record<string, unknown>;
  assertEquals(totals.margin_minor, 864);
  assertEquals(totals.margin_bps, 3_708);
  const voice = res.voice as Record<string, unknown>;
  assertEquals(voice.actual_cost_minor, 1_368);
  assertEquals(voice.null_cost_calls, 1);
  assertEquals((res.client_display as Record<string, unknown>).show_minutes, true);
});
