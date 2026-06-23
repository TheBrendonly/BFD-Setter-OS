// Pure helpers for the retell-call-analysis-webhook.
//
//  - buildCallOutcomeStamp  : 6.11 — the engagement_executions.last_call_outcome
//    payload, enriched with the classifier signals so runEngagement's
//    re-classifyCallOutcome bins voicemail/no-answer/ambiguous calls correctly.
//  - buildOutcomeFieldWrites: 6.12b — maps the analyzed-call outcome data to the
//    GHL contact custom-field writes (id/value pairs), skipping unset ids/values.
//
// Kept pure (no I/O) so both are unit-testable without the Deno.serve handler.

import type { CallSignals } from "./classifyCallOutcome.ts";

export type CallOutcomeStamp = CallSignals & {
  call_id: string | null;
  ended_at: string;
};

/**
 * Build the last_call_outcome stamp from a Retell `call` object. `endedAtIso`
 * is injected (handler passes new Date().toISOString()) so this stays pure.
 */
export function buildCallOutcomeStamp(
  call: Record<string, unknown>,
  endedAtIso: string,
): CallOutcomeStamp {
  const durationMs = typeof call.duration_ms === "number"
    ? call.duration_ms
    : typeof call.call_duration_ms === "number"
      ? call.call_duration_ms
      : null;
  const transcriptTurns = Array.isArray(call.transcript_object)
    ? call.transcript_object.length
    : 0;
  const callAnalysis = call.call_analysis && typeof call.call_analysis === "object"
    ? call.call_analysis as Record<string, unknown>
    : null;

  return {
    call_id: (call.call_id as string | null) ?? (call.id as string | null) ?? null,
    disconnect_reason: (call.disconnection_reason as string | null) ?? null,
    call_status: (call.call_status as string | null) ?? (call.status as string | null) ?? null,
    ended_at: endedAtIso,
    duration_ms: durationMs,
    transcript_turns: transcriptTurns,
    in_voicemail: callAnalysis?.in_voicemail === true,
  };
}

// Minimal supabase surface used by the stamp write (keeps this module I/O-pure
// for tests while matching the real supabase-js builder shape). The filter builder
// is both chainable (.eq returns itself) and awaitable (PromiseLike), so callers
// can scope the update by more than one column.
type EqBuilder =
  & PromiseLike<{ error: { message: string } | null }>
  & { eq: (col: string, val: string) => EqBuilder };
type SupabaseUpdateLike = {
  from: (table: string) => {
    update: (payload: Record<string, unknown>) => EqBuilder;
  };
};

// ── 6.12b: map analyzed-call outcome data → GHL custom-field writes ──

export type OutcomeValues = {
  callHistoryClass: string | null;
  callSummary?: string | null;
  callIntent?: string | null;
  qualified?: boolean | null;
  lastCallDate?: string | null;
  callbackRequested?: boolean | null;
  callbackDatetime?: string | null;
  appointmentDatetime?: string | null;
  sentiment?: string | null;
  appointmentBooked?: boolean | null;
};

export type OutcomeFieldIds = {
  outcome?: string | null;
  summary?: string | null;
  intent?: string | null;
  qualified?: string | null;
  lastCallDate?: string | null;
  callbackRequested?: string | null;
  callbackDatetime?: string | null;
  appointmentDatetime?: string | null;
  sentiment?: string | null;
  appointmentBooked?: string | null;
};

const OUTCOME_LABELS: Record<string, string> = {
  human_pickup: "Answered",
  voicemail: "Voicemail",
  no_connect: "No Answer",
  error: "Error",
  unknown: "Unknown",
};

/**
 * Build the GHL contact custom-field writes from the analyzed-call outcome data.
 * Each write is included only when BOTH its field id is configured AND the
 * source value is meaningful (booleans render true/false; null/empty drop).
 * Returns id/value pairs ready for writeGhlContactFields().
 */
export function buildOutcomeFieldWrites(
  values: OutcomeValues,
  fieldIds: OutcomeFieldIds,
): Array<{ id: string; value: string }> {
  const writes: Array<{ id: string; value: string }> = [];
  const push = (id: string | null | undefined, value: string | null | undefined) => {
    if (id && typeof value === "string" && value.trim() !== "") {
      writes.push({ id, value });
    }
  };
  const boolStr = (b: boolean | null | undefined) =>
    b === true ? "true" : b === false ? "false" : null;

  if (values.callHistoryClass) {
    push(fieldIds.outcome, OUTCOME_LABELS[values.callHistoryClass] ?? values.callHistoryClass);
  }
  push(fieldIds.summary, values.callSummary ?? null);
  push(fieldIds.intent, values.callIntent ?? null);
  push(fieldIds.qualified, boolStr(values.qualified));
  push(fieldIds.lastCallDate, values.lastCallDate ?? null);
  push(fieldIds.callbackRequested, boolStr(values.callbackRequested));
  push(fieldIds.callbackDatetime, values.callbackDatetime ?? null);
  push(fieldIds.appointmentDatetime, values.appointmentDatetime ?? null);
  push(fieldIds.sentiment, values.sentiment ?? null);
  push(fieldIds.appointmentBooked, boolStr(values.appointmentBooked));
  return writes;
}

/**
 * 6.11 — stamp the cadence-critical last_call_outcome on the placing execution
 * and clear the voice-call hold signal so runEngagement.waitForCallOutcome
 * breaks immediately (instead of polling its 600 s ceiling) and processMessages
 * doesn't keep holding inbound SMS for a call that has ended. Mirrors the
 * retell-call-webhook writer; returns { ok:false } so the handler can 500 + let
 * Retell retry on a lost write.
 */
export async function stampLastCallOutcome(
  supabase: SupabaseUpdateLike,
  executionId: string,
  stamp: CallOutcomeStamp,
  clientId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  // Tenant-scope the write. execution_id is read from the (unsigned) webhook body;
  // without client_id a forged outcome for another tenant's execution_id could
  // clear its hold / pollute its outcome. The legit row always has matching
  // client_id (resolved from the same agent), so this never drops a real write.
  let q = supabase
    .from("engagement_executions")
    .update({ last_call_outcome: stamp, active_call_id: null })
    .eq("id", executionId);
  if (clientId) q = q.eq("client_id", clientId);
  const { error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
