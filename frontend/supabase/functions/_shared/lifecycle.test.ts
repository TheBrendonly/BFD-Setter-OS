// Unit tests for the lead-lifecycle transition decision (feature 3.5).
// Runs under Node 22+ via:
//   node --experimental-strip-types --test frontend/supabase/functions/_shared/lifecycle.test.ts
//
// Covers the pure gating function only (no DB). The DB orchestration in
// transition-lead/index.ts is exercised by the edge function at runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { decideTransition } from "./lifecycle.ts";

const base = {
  optedOut: false,
  targetWorkflowId: "wf-target" as string | null,
  targetExistsAndActive: true,
  currentOpenEnrollmentWorkflowId: null as string | null,
};

test("decideTransition: proceeds for a fresh lead with a valid active target", () => {
  assert.deepEqual(decideTransition(base), { action: "proceed" });
});

test("decideTransition: opt-out wins over everything (compliance gate first)", () => {
  const d = decideTransition({
    ...base,
    optedOut: true,
    targetWorkflowId: "wf-target",
    targetExistsAndActive: true,
    currentOpenEnrollmentWorkflowId: "wf-other",
  });
  assert.deepEqual(d, { action: "skip", reason: "opted_out" });
});

test("decideTransition: skips when there is no target workflow (legacy no-op path)", () => {
  assert.deepEqual(
    decideTransition({ ...base, targetWorkflowId: null }),
    { action: "skip", reason: "no_target" },
  );
});

test("decideTransition: treats empty-string target as no target", () => {
  assert.deepEqual(
    decideTransition({ ...base, targetWorkflowId: "" }),
    { action: "skip", reason: "no_target" },
  );
});

test("decideTransition: skips when the target is missing or inactive", () => {
  assert.deepEqual(
    decideTransition({ ...base, targetExistsAndActive: false }),
    { action: "skip", reason: "target_unavailable" },
  );
});

test("decideTransition: skips when the lead is already in the target (idempotent double-fire)", () => {
  assert.deepEqual(
    decideTransition({ ...base, currentOpenEnrollmentWorkflowId: "wf-target" }),
    { action: "skip", reason: "already_in_target" },
  );
});

test("decideTransition: proceeds when the lead is open in a DIFFERENT workflow", () => {
  assert.deepEqual(
    decideTransition({ ...base, currentOpenEnrollmentWorkflowId: "wf-cool-down" }),
    { action: "proceed" },
  );
});

test("decideTransition: no_target takes precedence over already_in_target", () => {
  // A null target can't be 'already in target' even if an enrollment is open.
  assert.deepEqual(
    decideTransition({
      ...base,
      targetWorkflowId: null,
      currentOpenEnrollmentWorkflowId: "wf-anything",
    }),
    { action: "skip", reason: "no_target" },
  );
});
