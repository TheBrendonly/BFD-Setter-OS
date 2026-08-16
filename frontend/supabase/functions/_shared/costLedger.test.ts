// Unit tests for costLedger (agency cost-ledger summariser).
//   deno test --no-check frontend/supabase/functions/_shared/costLedger.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { summarizeCostLedger, type CostLedgerInput } from "./costLedger.ts";

const base: CostLedgerInput = {
  costEvents: [
    { cost_kind: "voice", quantity: 2.31, cost_usd: 0.35, is_estimated: false },
    { cost_kind: "voice", quantity: 2.035, cost_usd: 0.30, is_estimated: false },
  ],
  aiCostCents: 12, // $0.12 estimated LLM
  smsCount: 10,
  smsSeedUsdPerMsg: 0.014, // 1.4c/SMS
  bookingCount: 2,
  monthlyCeilingCents: 5000, // $50
  includedMinutes: 1500,
};

Deno.test("summarizeCostLedger: voice actual + estimated SMS/LLM totals", () => {
  const s = summarizeCostLedger(base);
  assertEquals(s.voice_cost_cents, 65); // (0.35+0.30)*100
  assertEquals(s.voice_minutes, 4.3); // 2.31+2.035 = 4.345 -> 4.3
  assertEquals(s.llm_cost_cents, 12);
  assertEquals(s.sms_cost_cents, 14); // 10 * 1.4c
  assertEquals(s.actual_cost_cents, 65); // voice only (is_estimated=false)
  assertEquals(s.estimated_cost_cents, 26); // 14 sms + 12 llm
  assertEquals(s.total_cost_cents, 91);
});

Deno.test("summarizeCostLedger: by_kind breakdown includes voice/sms/llm", () => {
  const s = summarizeCostLedger(base);
  const kinds = Object.fromEntries(s.by_kind.map((k) => [k.cost_kind, k.cost_cents]));
  assertEquals(kinds.voice, 65);
  assertEquals(kinds.sms, 14);
  assertEquals(kinds.llm, 12);
  assertEquals(s.by_kind.find((k) => k.cost_kind === "voice")?.is_estimated, false);
  assertEquals(s.by_kind.find((k) => k.cost_kind === "sms")?.is_estimated, true);
});

Deno.test("summarizeCostLedger: cost-per-booking = total / bookings", () => {
  const s = summarizeCostLedger(base);
  assertEquals(s.cost_per_booking_cents, 46); // round(91/2)
});

Deno.test("summarizeCostLedger: no bookings -> cost-per-booking null", () => {
  const s = summarizeCostLedger({ ...base, bookingCount: 0 });
  assertEquals(s.cost_per_booking_cents, null);
});

Deno.test("summarizeCostLedger: minutes burn-down vs pool", () => {
  const s = summarizeCostLedger({ ...base, includedMinutes: 4 });
  assertEquals(s.minutes_burn.limit, 4);
  assertEquals(s.minutes_burn.used, 4.3);
  assertEquals(s.minutes_burn.pct, 107.5); // 4.3/4
  assertEquals(s.minutes_burn.over_80, true);
  assertEquals(s.minutes_burn.over_100, true);
});

Deno.test("summarizeCostLedger: cost burn-down 80% flag", () => {
  const s = summarizeCostLedger({ ...base, monthlyCeilingCents: 100 }); // total 91c of 100c = 91%
  assertEquals(s.cost_burn.pct, 91);
  assertEquals(s.cost_burn.over_80, true);
  assertEquals(s.cost_burn.over_100, false);
});

Deno.test("summarizeCostLedger: no ceiling/pool -> pct null, no flags", () => {
  const s = summarizeCostLedger({ ...base, monthlyCeilingCents: null, includedMinutes: null });
  assertEquals(s.cost_burn.pct, null);
  assertEquals(s.cost_burn.over_80, false);
  assertEquals(s.minutes_burn.pct, null);
  assertEquals(s.minutes_burn.limit, null);
});

Deno.test("summarizeCostLedger: empty period is all zeros, not NaN", () => {
  const s = summarizeCostLedger({
    costEvents: [], aiCostCents: 0, smsCount: 0, smsSeedUsdPerMsg: 0.014,
    bookingCount: 0, monthlyCeilingCents: 5000, includedMinutes: 1500,
  });
  assertEquals(s.total_cost_cents, 0);
  assertEquals(s.voice_minutes, 0);
  assertEquals(s.cost_per_booking_cents, null);
  assertEquals(s.cost_burn.pct, 0);
  assertEquals(s.cost_burn.over_80, false);
});
