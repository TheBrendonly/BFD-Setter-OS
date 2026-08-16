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
// HONESTY: each kind (voice/sms/llm) uses its execution_cost_events rows when the
// period has any (real per-execution cost, carrying each row's is_estimated flag), and
// ONLY falls back to a running estimate when a kind has no ledger rows (SMS = count ×
// seed; LLM = cadence_metrics.ai_cost_cents). This is what prevents double-counting once
// actual rows land. Voice + LLM write actual rows today; SMS still falls back to the count
// estimate until the Twilio settled-price reconciliation ships. The summary keeps the
// estimated portion separate so the card can label it, and so the split stays truthful.

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

interface KindAgg {
  usd: number;
  count: number;
  hasEstimated: boolean; // any is_estimated=true row for this kind
  quantity: number; // summed (used for voice minutes)
}

export function summarizeCostLedger(input: CostLedgerInput): CostLedgerSummary {
  // Bucket every ledger row by kind. Sum dollars per bucket and round to cents ONCE.
  let ledgerActualUsd = 0; // is_estimated=false rows
  let ledgerEstimatedUsd = 0; // is_estimated=true rows
  const kindAgg = new Map<string, KindAgg>();

  for (const ev of input.costEvents) {
    const usd = Number.isFinite(ev.cost_usd) ? ev.cost_usd : 0;
    if (ev.is_estimated) ledgerEstimatedUsd += usd;
    else ledgerActualUsd += usd;
    const cur = kindAgg.get(ev.cost_kind) ?? { usd: 0, count: 0, hasEstimated: false, quantity: 0 };
    cur.usd += usd;
    cur.count += 1;
    cur.hasEstimated = cur.hasEstimated || ev.is_estimated;
    cur.quantity += Number.isFinite(ev.quantity) ? ev.quantity : 0;
    kindAgg.set(ev.cost_kind, cur);
  }

  const voice = kindAgg.get("voice");
  const voiceCostCents = usdToCents(voice?.usd ?? 0);
  const voiceMinutes = voice?.quantity ?? 0;

  // SMS + LLM: use the ledger when the period has any rows of that kind (real,
  // per-execution cost), otherwise fall back to the running estimate. This is what
  // stops the double-count once actual rows land — the estimate is only ever added
  // for a kind that has NO ledger rows.
  const smsAgg = kindAgg.get("sms");
  const smsFromLedger = (smsAgg?.count ?? 0) > 0;
  const smsCostCents = smsFromLedger
    ? usdToCents(smsAgg!.usd)
    : Math.round((input.smsCount || 0) * (input.smsSeedUsdPerMsg || 0) * 100);
  const smsIsEstimated = smsFromLedger ? smsAgg!.hasEstimated : true;

  const llmAgg = kindAgg.get("llm");
  const llmFromLedger = (llmAgg?.count ?? 0) > 0;
  const llmCostCents = llmFromLedger
    ? usdToCents(llmAgg!.usd)
    : Math.max(0, Math.round(input.aiCostCents || 0));
  const llmIsEstimated = llmFromLedger ? llmAgg!.hasEstimated : true;

  const by_kind: CostKindLine[] = [
    { cost_kind: "voice", cost_cents: voiceCostCents, is_estimated: voice?.hasEstimated ?? false },
    { cost_kind: "sms", cost_cents: smsCostCents, is_estimated: smsIsEstimated },
    { cost_kind: "llm", cost_cents: llmCostCents, is_estimated: llmIsEstimated },
  ];

  // Actual vs estimated split: ledger rows contribute by their own is_estimated flag;
  // a fallback estimate (used only when a kind has NO ledger rows) is estimated.
  const actualCents = usdToCents(ledgerActualUsd);
  let estimatedCents = usdToCents(ledgerEstimatedUsd);
  if (!smsFromLedger) estimatedCents += smsCostCents;
  if (!llmFromLedger) estimatedCents += llmCostCents;
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
