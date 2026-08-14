// Lead-lifecycle state machine — pure decision logic (feature 3.5 / CV2-1).
//
// A lead flows across distinct engagement workflows (Hot Pursuit -> Cool Down /
// Long-Tail -> Re-engage). The transition-lead edge function does the DB
// orchestration (close the current enrollment, open the next, fire the cadence);
// this module isolates the gating decision so it can be unit-tested without a DB.
//
// Split mirrors resolve-workflow.ts: pure decision functions here, thin DB calls
// in the edge function.

export type SkipReason =
  | "opted_out"
  | "no_target"
  | "target_unavailable"
  | "already_in_target";

export type TransitionDecision =
  | { action: "proceed" }
  | { action: "skip"; reason: SkipReason };

/**
 * Decide whether a lifecycle transition should run. Evaluated in priority order:
 *  1. opted_out        — compliance gate; a STOP'd lead never transitions.
 *  2. no_target        — the source workflow has no configured next stage (the
 *                        legacy single-workflow no-op path).
 *  3. target_unavailable — the target workflow is missing or disabled.
 *  4. already_in_target — the lead's open enrollment is already this target
 *                        (an idempotent double-fire from a retry / concurrent run).
 * Otherwise: proceed.
 */
export function decideTransition(args: {
  optedOut: boolean;
  targetWorkflowId: string | null | undefined;
  targetExistsAndActive: boolean;
  currentOpenEnrollmentWorkflowId: string | null | undefined;
}): TransitionDecision {
  if (args.optedOut) return { action: "skip", reason: "opted_out" };
  if (!args.targetWorkflowId) return { action: "skip", reason: "no_target" };
  if (!args.targetExistsAndActive) return { action: "skip", reason: "target_unavailable" };
  if (
    args.currentOpenEnrollmentWorkflowId &&
    args.currentOpenEnrollmentWorkflowId === args.targetWorkflowId
  ) {
    return { action: "skip", reason: "already_in_target" };
  }
  return { action: "proceed" };
}

/** The lifecycle roles a workflow can play. Null = legacy single-stage workflow. */
export const LIFECYCLE_ROLES = [
  "hot_pursuit",
  "cool_down",
  "long_tail",
  "re_engage",
] as const;
export type LifecycleRole = (typeof LIFECYCLE_ROLES)[number];
