// costLedger — pure summariser for the agency cost-ledger read surface.
//
// The first reader of execution_cost_events. Turns raw period cost rows + a few
// aggregates into the numbers the agency Cost Ledger card shows: cost by kind,
// cost-per-booking, an estimated-vs-actual split, and two burn-downs
// (voice-minutes-vs-pool and cost-vs-ceiling).
//
// MONEY: everything is USD integer CENTS. Provider costs (Retell voice, OpenRouter
// LLM, Twilio SMS) are all billed in USD, and this is an agency-internal P&L view,
// so there is deliberately NO FX to the display currency here — it is honest raw cost.
//
// HONESTY: voice is ACTUAL (execution_cost_events, is_estimated=false). SMS + LLM are
// ESTIMATES today (SMS = count × a seed rate; LLM = cadence_metrics.ai_cost_cents),
// because SMS/LLM cost events are not written to the ledger yet. The summary keeps the
// estimated portion separate so the card can label it, and so the split is truthful.

export interface CostEventRow {
  cost_kind: string; // 'voice' | 'sms' | 'llm' | ...
  quantity: number; // e.g. voice minutes
  cost_usd: number; // dollars
  is_estimated: boolean;
}

export interface CostLedgerInput {
  costEvents: CostEventRow[]; // execution_cost_events rows in the billing period
  aiCostCents: number; // SUM(cadence_metrics.ai_cost_cents) — estimated LLM cost (USD cents)
  smsCount: number; // outbound SMS in the period
  smsSeedUsdPerMsg: number; // per-segment USD seed rate (e.g. 0.014)
  bookingCount: number; // confirmed bookings in the period
  monthlyCeilingCents: number | null; // clients.monthly_cost_ceiling_cents (USD cents)
  includedMinutes: number | null; // voice-minute pool from the pricing config
}

export interface CostKindLine {
  cost_kind: string;
  cost_cents: number;
  is_estimated: boolean;
}

export interface BurnDown {
  limit: number | null; // pool size / ceiling
  used: number; // minutes used / cents spent
  pct: number | null; // 0..100+, null when no limit configured
  over_80: boolean;
  over_100: boolean;
}

export interface CostLedgerSummary {
  by_kind: CostKindLine[];
  voice_minutes: number;
  voice_cost_cents: number; // actual
  llm_cost_cents: number; // estimated
  sms_cost_cents: number; // estimated
  total_cost_cents: number;
  actual_cost_cents: number; // is_estimated=false ledger rows (voice today)
  estimated_cost_cents: number; // SMS + LLM (+ any is_estimated ledger rows)
  booking_count: number;
  cost_per_booking_cents: number | null; // null when no bookings
  cost_burn: BurnDown; // spent cents vs monthly ceiling
  minutes_burn: BurnDown; // voice minutes vs pool
}

const usdToCents = (usd: number): number => Math.round((Number.isFinite(usd) ? usd : 0) * 100);

function burn(limit: number | null, used: number): BurnDown {
  const hasLimit = typeof limit === "number" && limit > 0;
  const pct = hasLimit ? (used / (limit as number)) * 100 : null;
  return {
    limit: hasLimit ? (limit as number) : null,
    used,
    pct: pct === null ? null : Math.round(pct * 10) / 10,
    over_80: pct !== null && pct >= 80,
    over_100: pct !== null && pct >= 100,
  };
}

export function summarizeCostLedger(input: CostLedgerInput): CostLedgerSummary {
  // Voice, from the ledger. Sum the dollars per bucket, round to cents ONCE.
  let voiceUsd = 0;
  let voiceMinutes = 0;
  let ledgerActualUsd = 0; // is_estimated=false
  let ledgerEstimatedUsd = 0; // is_estimated=true (none today, but future-proof)
  const otherKindUsd = new Map<string, { usd: number; estimated: boolean }>();

  for (const ev of input.costEvents) {
    const usd = Number.isFinite(ev.cost_usd) ? ev.cost_usd : 0;
    if (ev.is_estimated) ledgerEstimatedUsd += usd;
    else ledgerActualUsd += usd;
    if (ev.cost_kind === "voice") {
      voiceUsd += usd;
      voiceMinutes += Number.isFinite(ev.quantity) ? ev.quantity : 0;
    } else {
      const cur = otherKindUsd.get(ev.cost_kind) ?? { usd: 0, estimated: false };
      cur.usd += usd;
      cur.estimated = cur.estimated || ev.is_estimated;
      otherKindUsd.set(ev.cost_kind, cur);
    }
  }

  const voiceCostCents = usdToCents(voiceUsd);
  const llmCostCents = Math.max(0, Math.round(input.aiCostCents || 0));
  const smsCostCents = Math.round((input.smsCount || 0) * (input.smsSeedUsdPerMsg || 0) * 100);

  const by_kind: CostKindLine[] = [
    { cost_kind: "voice", cost_cents: voiceCostCents, is_estimated: false },
  ];
  for (const [kind, v] of otherKindUsd) {
    by_kind.push({ cost_kind: kind, cost_cents: usdToCents(v.usd), is_estimated: v.estimated });
  }
  by_kind.push({ cost_kind: "sms", cost_cents: smsCostCents, is_estimated: true });
  by_kind.push({ cost_kind: "llm", cost_cents: llmCostCents, is_estimated: true });

  const actualCents = usdToCents(ledgerActualUsd);
  const estimatedCents = usdToCents(ledgerEstimatedUsd) + smsCostCents + llmCostCents;
  const totalCents = actualCents + estimatedCents;

  const roundedMinutes = Math.round(voiceMinutes * 10) / 10;

  return {
    by_kind,
    voice_minutes: roundedMinutes,
    voice_cost_cents: voiceCostCents,
    llm_cost_cents: llmCostCents,
    sms_cost_cents: smsCostCents,
    total_cost_cents: totalCents,
    actual_cost_cents: actualCents,
    estimated_cost_cents: estimatedCents,
    booking_count: input.bookingCount,
    cost_per_booking_cents: input.bookingCount > 0 ? Math.round(totalCents / input.bookingCount) : null,
    cost_burn: burn(input.monthlyCeilingCents, totalCents),
    minutes_burn: burn(input.includedMinutes, roundedMinutes),
  };
}
