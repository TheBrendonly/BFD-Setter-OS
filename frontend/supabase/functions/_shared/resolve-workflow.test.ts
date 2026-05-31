// Unit tests for form-to-agent routing resolver. Runs under Node 22+ via:
//   node --experimental-strip-types --test frontend/supabase/functions/_shared/resolve-workflow.test.ts
//
// Covers the pure decision functions only (no DB). The thin DB fetch
// (fetchActiveNewLeadsWorkflows) is exercised by the edge functions at runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { matchWorkflowByTag, resolveWorkflow } from "./resolve-workflow.ts";

const wf = (id: string, new_leads_tag: string | null) => ({ id, new_leads_tag });

test("matchWorkflowByTag: matches a workflow whose tag is in the candidate tags", () => {
  const workflows = [wf("a", "form-roofing"), wf("b", "form-solar")];
  const match = matchWorkflowByTag(workflows, ["form-solar"]);
  assert.equal(match?.id, "b");
});

test("matchWorkflowByTag: trims whitespace on both sides before comparing", () => {
  const workflows = [wf("a", " form-roofing ")];
  const match = matchWorkflowByTag(workflows, ["form-roofing"]);
  assert.equal(match?.id, "a");
});

test("matchWorkflowByTag: ignores workflows with a null tag", () => {
  const workflows = [wf("a", null), wf("b", "form-solar")];
  assert.equal(matchWorkflowByTag(workflows, ["form-solar"])?.id, "b");
  assert.equal(matchWorkflowByTag(workflows, ["anything"]), null);
});

test("matchWorkflowByTag: returns null when no candidate tags", () => {
  assert.equal(matchWorkflowByTag([wf("a", "form-roofing")], []), null);
});

test("matchWorkflowByTag: returns null when nothing matches", () => {
  assert.equal(matchWorkflowByTag([wf("a", "form-roofing")], ["form-solar"]), null);
});

test("matchWorkflowByTag: filters blank candidate tags", () => {
  const workflows = [wf("a", "form-roofing")];
  assert.equal(matchWorkflowByTag(workflows, ["", "   "]), null);
});

test("resolveWorkflow: tag match wins over the fallback", () => {
  const r = resolveWorkflow({
    workflows: [wf("tagged", "form-roofing")],
    candidateTags: ["form-roofing"],
    fallbackWorkflowId: "default-wf",
  });
  assert.deepEqual(r, { workflowId: "tagged", matchedTag: "form-roofing", source: "tag" });
});

test("resolveWorkflow: falls back to the default workflow when no tag matches", () => {
  const r = resolveWorkflow({
    workflows: [wf("tagged", "form-roofing")],
    candidateTags: ["form-unknown"],
    fallbackWorkflowId: "default-wf",
  });
  assert.deepEqual(r, { workflowId: "default-wf", matchedTag: null, source: "default" });
});

test("resolveWorkflow: falls back to default when there are no tags at all", () => {
  const r = resolveWorkflow({
    workflows: [],
    candidateTags: [],
    fallbackWorkflowId: "default-wf",
  });
  assert.deepEqual(r, { workflowId: "default-wf", matchedTag: null, source: "default" });
});

test("resolveWorkflow: returns none when no tag match and no fallback (ghl-tag-webhook semantics)", () => {
  const r = resolveWorkflow({
    workflows: [wf("tagged", "form-roofing")],
    candidateTags: ["form-unknown"],
    fallbackWorkflowId: null,
  });
  assert.deepEqual(r, { workflowId: null, matchedTag: null, source: "none" });
});
