// Unit test for shouldSendMissedCallTextback() (F16C-SMS-1). Runs under Node 22+ via:
//   node --experimental-strip-types --test missedCallTextback.test.ts
// (also valid as a Deno test — node:test and node:assert/strict are supported natively.)
import test from "node:test";
import { strict as assert } from "node:assert";
import { shouldSendMissedCallTextback } from "./missedCallTextback.ts";

const SIGNED_ABANDONED = {
  signatureVerified: true,
  event: "call_ended",
  enabled: true,
  direction: "inbound",
  fromNumber: "+61400000001",
  durationSec: 5,
};

test("signed + enabled + inbound + short call => true", () => {
  assert.equal(shouldSendMissedCallTextback(SIGNED_ABANDONED), true);
});

test("forged/unsigned (secret unset or HMAC failed) => false, everything else valid", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, signatureVerified: false }), false);
});

test("feature disabled => false", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, enabled: false }), false);
});

test("outbound call => false", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, direction: "outbound" }), false);
});

test("call_analyzed (second webhook for the same call) => false — fires once on call_ended", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, event: "call_analyzed" }), false);
});

test("engaged call (>= 20s) => false; 19s => true (boundary)", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, durationSec: 20 }), false);
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, durationSec: 19 }), true);
});

test("no duration reported counts as missed => true", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, durationSec: null }), true);
});

test("missing from_number => false (nothing to text back)", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, fromNumber: null }), false);
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, fromNumber: "" }), false);
});

test("direction matched case-insensitively; call_type fallback null => false", () => {
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, direction: "Inbound" }), true);
  assert.equal(shouldSendMissedCallTextback({ ...SIGNED_ABANDONED, direction: null }), false);
});
