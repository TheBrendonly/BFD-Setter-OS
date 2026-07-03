// FOLLOWUP-PROMPT-1 — unit tests for buildFollowupUserMessage.
//
// Run with Node 22+:
//   node --experimental-strip-types --test trigger/_shared/buildFollowupContext.test.ts
//
// Extracted from the inline userMessage array in sendFollowup.ts so the fix
// (adding the time-anchor + availability blocks) is genuinely unit-testable
// without faking HTTP. Pure string assembly, no I/O.
import test from "node:test";
import { strict as assert } from "node:assert";
import { buildFollowupUserMessage } from "./buildFollowupContext.ts";

const BASE = {
  setterPrompt: "Be casual and friendly.",
  availabilityBlock: "## Live calendar availability\n(fake block)",
  timeAnchorBlock: "## Current date & time (ground truth)\n(fake anchor)",
  chatHistoryText: "Lead: hi\nSetter: hey there",
  cancellationSection: "## Cancellation Conditions\n- lead said stop",
  followupInstructions: "",
  sequenceIndex: 1,
};

test("includes the availability and time-anchor block content", () => {
  const msg = buildFollowupUserMessage(BASE);
  assert.match(msg, /Live calendar availability/);
  assert.match(msg, /Current date & time \(ground truth\)/);
});

test("section ordering: setter prompt, availability, anchor, history, cancellation, task", () => {
  const msg = buildFollowupUserMessage(BASE);
  const idx = (needle: string) => msg.indexOf(needle);
  assert.ok(idx("Setter Prompt") < idx("Live calendar availability"));
  assert.ok(idx("Live calendar availability") < idx("Current date & time"));
  assert.ok(idx("Current date & time") < idx("Conversation History"));
  assert.ok(idx("Conversation History") < idx("Cancellation Conditions"));
  assert.ok(idx("Cancellation Conditions") < idx("## Task"));
});

test("empty setterPrompt omits the Setter Prompt section", () => {
  const msg = buildFollowupUserMessage({ ...BASE, setterPrompt: "" });
  assert.doesNotMatch(msg, /## Setter Prompt/);
});

test("empty followupInstructions omits that section", () => {
  const msg = buildFollowupUserMessage(BASE);
  assert.doesNotMatch(msg, /Follow-up Instructions/);
});

test("non-empty followupInstructions includes that section, after cancellation", () => {
  const msg = buildFollowupUserMessage({ ...BASE, followupInstructions: "Mention the discount." });
  assert.match(msg, /Follow-up Instructions/);
  assert.match(msg, /Mention the discount\./);
  const idx = (needle: string) => msg.indexOf(needle);
  assert.ok(idx("Cancellation Conditions") < idx("Follow-up Instructions"));
});

test("sequenceIndex > 1 includes the attempt-number note; sequenceIndex 1 omits it", () => {
  const first = buildFollowupUserMessage({ ...BASE, sequenceIndex: 1 });
  assert.doesNotMatch(first, /follow-up attempt #/);
  const second = buildFollowupUserMessage({ ...BASE, sequenceIndex: 2 });
  assert.match(second, /follow-up attempt #2/);
});
