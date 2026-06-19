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
// for tests while matching the real supabase-js builder shape).
type SupabaseUpdateLike = {
  from: (table: string) => {
    update: (payload: Record<string, unknown>) => {
      // PromiseLike (not Promise) so the real supabase-js PostgrestFilterBuilder
      // — a thenable lacking catch/finally — is assignable here.
      eq: (col: string, val: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

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
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("engagement_executions")
    .update({ last_call_outcome: stamp, active_call_id: null })
    .eq("id", executionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
