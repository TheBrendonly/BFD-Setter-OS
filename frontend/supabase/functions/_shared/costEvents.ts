// Per-execution cost ledger row builder (Session P2).
//
// Pure shape/sanitize helper for public.execution_cost_events. The three runtime
// writers (voice = retell-call-webhook / retell-call-analysis-webhook, sms =
// twilio-send-sms + cadence-direct send, llm = trigger/runEngagement) all build
// their row through this so the shape, rounding, and defaults stay identical.
//
// TWIN: this file is byte-identical to trigger/_shared/costEvents.ts (edge fns and
// Trigger.dev tasks can't share an import path — keep both in sync, like phone.ts).
//
// The insert itself is always best-effort at the call site: a failed cost write must
// never block the call / SMS / execution hot path.

export type CostKind = "voice" | "sms" | "llm";

export interface CostEventInput {
  clientId: string;
  executionId?: string | null;
  workflowId?: string | null;
  leadId?: string | null;
  providerRef?: string | null;
  quantity?: number | null;
  unit?: string | null;
  costUsd: number;
  isEstimated?: boolean;
  /** ISO string; omit to let the DB default occurred_at = now(). */
  occurredAt?: string | null;
}

export interface CostEventRow {
  execution_id: string | null;
  client_id: string;
  workflow_id: string | null;
  lead_id: string | null;
  cost_kind: CostKind;
  provider_ref: string | null;
  quantity: number | null;
  unit: string | null;
  cost_usd: number;
  is_estimated: boolean;
  occurred_at?: string;
}

/** Round to 6 dp to match numeric(12,6); never emit NaN/negative/Infinity cost. */
function sanitizeCost(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1e6) / 1e6;
}

function sanitizeQuantity(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Build a validated execution_cost_events insert row. `cost_kind` is required and
 * validated; a non-finite/negative cost collapses to 0 rather than corrupting the
 * ledger. execution_id/workflow_id/lead_id are nullable (inbound voice + ad-hoc
 * sends legitimately have no execution).
 */
export function buildCostEvent(kind: CostKind, input: CostEventInput): CostEventRow {
  if (kind !== "voice" && kind !== "sms" && kind !== "llm") {
    throw new Error(`buildCostEvent: invalid cost_kind "${kind}"`);
  }
  if (!input.clientId) {
    throw new Error("buildCostEvent: clientId is required");
  }
  const row: CostEventRow = {
    execution_id: input.executionId ?? null,
    client_id: input.clientId,
    workflow_id: input.workflowId ?? null,
    lead_id: input.leadId ?? null,
    cost_kind: kind,
    provider_ref: input.providerRef ?? null,
    quantity: sanitizeQuantity(input.quantity),
    unit: input.unit ?? null,
    cost_usd: sanitizeCost(input.costUsd),
    is_estimated: input.isEstimated ?? false,
  };
  if (input.occurredAt) row.occurred_at = input.occurredAt;
  return row;
}
