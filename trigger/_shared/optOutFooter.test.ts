import { test } from "node:test";
import assert from "node:assert/strict";
import { appendOptOutFooter, hasOptOutWording, OPT_OUT_FOOTER } from "./optOutFooter.ts";

test("appends the footer to a body with no opt-out wording", () => {
  const out = appendOptOutFooter("Hi Sam, still keen to lock in a time?");
  assert.equal(out, `Hi Sam, still keen to lock in a time?\n\n${OPT_OUT_FOOTER}`);
  assert.ok(out.includes("Reply STOP to unsubscribe"));
});

test("does not double up when the body already says 'reply STOP'", () => {
  const body = "Last chance to book. Reply STOP to opt out.";
  assert.equal(appendOptOutFooter(body), body);
});

test("does not double up when the body already says 'unsubscribe'", () => {
  const body = "Deals inside. Unsubscribe anytime.";
  assert.equal(appendOptOutFooter(body), body);
});

test("a bare 'stop' in prose does NOT suppress the footer (no false positive)", () => {
  const body = "Feel free to stop by the office this week.";
  const out = appendOptOutFooter(body);
  assert.ok(out.endsWith(OPT_OUT_FOOTER), "footer should still be appended");
});

test("empty / falsy body is returned unchanged (no footer on nothing)", () => {
  assert.equal(appendOptOutFooter(""), "");
});

test("hasOptOutWording detects the standard phrasings", () => {
  assert.ok(hasOptOutWording("reply stop to cancel"));
  assert.ok(hasOptOutWording("text STOP anytime"));
  assert.ok(hasOptOutWording("you can unsubscribe here"));
  assert.ok(hasOptOutWording("opt-out available"));
  assert.ok(!hasOptOutWording("please stop the presses"));
});
