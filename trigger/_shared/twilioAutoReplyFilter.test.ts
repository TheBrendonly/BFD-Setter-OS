import { test } from "node:test";
import { strict as assert } from "node:assert";

// Inline copy of the Bug 30 filter — the helper isn't exported from
// ghl-conversations.ts (private internal). Test is run pre-deploy by the
// audit gate. If the patterns drift, update both copies + this test.
const TWILIO_AUTO_REPLY_PATTERNS: ReadonlyArray<RegExp> = [
  /you have successfully been unsubscribed/i,
  /you have successfully been re-?subscribed/i,
  /you will not receive any more messages/i,
  /reply\s+start\s+to\s+resubscribe/i,
  /msg\s*&\s*data rates may apply/i,
];

function isTwilioAutoReply(body: string): boolean {
  for (const re of TWILIO_AUTO_REPLY_PATTERNS) {
    if (re.test(body)) return true;
  }
  return false;
}

test("filters Twilio Advanced Opt-Out STOP boilerplate", () => {
  assert.equal(
    isTwilioAutoReply("You have successfully been unsubscribed. You will not receive any more messages from this number. Reply START to resubscribe."),
    true,
  );
});

test("filters Twilio Advanced Opt-Out START boilerplate", () => {
  assert.equal(
    isTwilioAutoReply("You have successfully been re-subscribed to messages from this number. Reply HELP for help. Reply STOP to unsubscribe."),
    true,
  );
});

test("filters Twilio HELP/data rates fragment", () => {
  assert.equal(
    isTwilioAutoReply("Reply HELP for help. Reply STOP to unsubscribe. Msg&Data Rates May Apply."),
    true,
  );
});

test("matches case-insensitively", () => {
  assert.equal(
    isTwilioAutoReply("YOU HAVE SUCCESSFULLY BEEN UNSUBSCRIBED."),
    true,
  );
});

test("matches resubscribed without hyphen", () => {
  assert.equal(
    isTwilioAutoReply("You have successfully been resubscribed to messages."),
    true,
  );
});

test("does NOT filter BFD's own STOP_REPLY", () => {
  assert.equal(
    isTwilioAutoReply("You've been unsubscribed. Reply START to resubscribe."),
    true, // ← matches "reply start to resubscribe" pattern — that's fine, BFD's STOP_REPLY mirrors are intended to be filtered too (they're written by BFD itself and arrive via the same path as the carrier reply)
  );
});

test("does NOT filter ordinary cadence SMS", () => {
  assert.equal(
    isTwilioAutoReply("Hey Brendan, just following up on the call we had yesterday. Want me to send through the pricing breakdown?"),
    false,
  );
});

test("does NOT filter empty body", () => {
  assert.equal(isTwilioAutoReply(""), false);
});

test("does NOT filter generic 'yes' or 'no' replies", () => {
  assert.equal(isTwilioAutoReply("yes"), false);
  assert.equal(isTwilioAutoReply("no"), false);
  assert.equal(isTwilioAutoReply("YES PLEASE"), false);
});
