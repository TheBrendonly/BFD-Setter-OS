// Per-execution LLM cost writer for the P2 ledger (public.execution_cost_events).
//
// The four lead-facing trigger tasks that spend OpenRouter credits
// (processSetterReply, nudgeColdReply, sendFollowup, runEngagement's cadence copy)
// call this after each LLM turn so the agency Cost Ledger shows real per-client LLM
// spend instead of $0.
//
// HONESTY: prefers OpenRouter's ACTUAL billed cost (`usage.cost`, USD ~1:1 credits,
// always returned) → is_estimated=false. When a response carries no cost, falls back
// to a token × price-map estimate → is_estimated=true. A zero/absent cost with no
// tokens writes NOTHING (never a $0 row).
//
// Best-effort by contract: it never throws and never blocks the reply/run — a cost
// write must not affect the SMS reply or cadence execution. Idempotency is the
// caller's providerRef mapped to the UNIQUE(cost_kind, provider_ref) constraint, so
// a Trigger retry re-upserts the same row rather than double-billing.

import { buildCostEvent } from "./costEvents.ts";
import { estimateLlmCostUsd } from "./llmPricing.ts";

export interface LlmUsage {
  cost?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface RecordLlmCostArgs {
  // Only the .from(table).upsert(row, opts) shape is used; typed loosely so both the
  // Trigger supabase-js client and a test stub satisfy it.
  supabase: {
    from: (table: string) => {
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  clientId: string;
  /** Idempotency key → provider_ref. Must be stable per LLM turn (never execution_id). */
  providerRef: string;
  model: string;
  usage: LlmUsage | null | undefined;
  /**
   * Optional pre-computed USD estimate, used when usage.cost is absent — for callers
   * that already hold a token-based estimate (e.g. runEngagement's cadence-copy
   * metricsBuffer.ai_cost_cents) and don't want recordLlmCost to re-derive it from
   * tokens. When set and positive, it replaces the token-map fallback (is_estimated=true).
   */
  fallbackCostUsd?: number | null;
  executionId?: string | null;
  leadId?: string | null;
  workflowId?: string | null;
  /** ISO string; omit to let the DB default occurred_at = now(). */
  occurredAt?: string | null;
}

export interface RecordLlmCostResult {
  written: boolean;
  costUsd: number;
  isEstimated: boolean;
}

export async function recordLlmCost(args: RecordLlmCostArgs): Promise<RecordLlmCostResult> {
  // Prefer actual billed cost; a non-positive or absent cost is NOT an actual $0 —
  // fall back to the token estimate instead.
  const rawCost = args.usage?.cost;
  const actualUsd =
    typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;

  const isEstimated = actualUsd == null;
  let costUsd: number;
  if (!isEstimated) {
    costUsd = actualUsd as number;
  } else if (
    typeof args.fallbackCostUsd === "number" &&
    Number.isFinite(args.fallbackCostUsd) &&
    args.fallbackCostUsd > 0
  ) {
    costUsd = args.fallbackCostUsd;
  } else {
    costUsd = estimateLlmCostUsd(
      args.model,
      Number(args.usage?.prompt_tokens ?? 0),
      Number(args.usage?.completion_tokens ?? 0),
    );
  }

  // Never write a zero row, and never let a missing identity throw downstream.
  if (!(costUsd > 0) || !args.clientId || !args.providerRef) {
    return { written: false, costUsd: costUsd > 0 ? costUsd : 0, isEstimated };
  }

  try {
    const row = buildCostEvent("llm", {
      clientId: args.clientId,
      executionId: args.executionId ?? null,
      workflowId: args.workflowId ?? null,
      leadId: args.leadId ?? null,
      providerRef: args.providerRef,
      costUsd,
      isEstimated,
      occurredAt: args.occurredAt ?? null,
    });
    const { error } = await args.supabase
      .from("execution_cost_events")
      .upsert(row, { onConflict: "cost_kind,provider_ref" });
    if (error) {
      console.warn("recordLlmCost: execution_cost_events upsert failed (non-fatal):", error.message);
      return { written: false, costUsd, isEstimated };
    }
    return { written: true, costUsd, isEstimated };
  } catch (err) {
    console.warn(
      "recordLlmCost: execution_cost_events upsert threw (non-fatal):",
      (err as Error)?.message ?? err,
    );
    return { written: false, costUsd, isEstimated };
  }
}
