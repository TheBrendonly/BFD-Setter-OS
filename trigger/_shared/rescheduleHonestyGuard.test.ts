// RESCHED-SMS-1: unit tests for the reschedule/cancel honesty guard.
//   node --experimental-strip-types --test trigger/_shared/rescheduleHonestyGuard.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  claimsRescheduleOrCancelSuccess,
  needsRescheduleHonestyRewrite,
  claimsBookingSuccess,
  needsBookingHonestyRewrite,
} from "./rescheduleHonestyGuard.ts";

const OK_UPDATE = [{ name: "update-appointment" }];
const OK_CANCEL = [{ name: "cancel-appointments" }];
const ERR_UPDATE = [{ name: "update-appointment", error: "GHL 404" }];
const NO_MUTATION = [{ name: "get-available-slots" }, { name: "get-contact-appointments" }];

test("false confirmation without a successful mutation -> rewrite", () => {
  // the exact incident phrasing
  assert.equal(
    needsRescheduleHonestyRewrite("I've moved your Friday call to 3pm, all set!", NO_MUTATION),
    true,
  );
  assert.equal(needsRescheduleHonestyRewrite("Done, your appointment is cancelled.", []), true);
  assert.equal(needsRescheduleHonestyRewrite("All good, I've rescheduled you.", NO_MUTATION), true);
  // a refused mutation (error) still counts as "no success"
  assert.equal(needsRescheduleHonestyRewrite("Your call has been moved to 4pm.", ERR_UPDATE), true);
});

test("confirmation WITH a successful mutation -> passes through", () => {
  assert.equal(needsRescheduleHonestyRewrite("Your call has been moved to 3pm.", OK_UPDATE), false);
  assert.equal(needsRescheduleHonestyRewrite("Your appointment is cancelled.", OK_CANCEL), false);
});

test("fresh booking confirmation is NOT a reschedule claim -> passes through", () => {
  // booking uses book-appointment, not update/cancel; "all set" alone must not trip the guard
  assert.equal(needsRescheduleHonestyRewrite("You're all set for Friday at 2pm!", NO_MUTATION), false);
  assert.equal(needsRescheduleHonestyRewrite("Great, booked you in for 10am Tuesday.", NO_MUTATION), false);
});

test("already-honest hedged replies are left alone", () => {
  assert.equal(
    needsRescheduleHonestyRewrite("Having a bit of trouble cancelling that, let me look into it.", NO_MUTATION),
    false,
  );
  assert.equal(
    needsRescheduleHonestyRewrite("I can't move that appointment right now.", NO_MUTATION),
    false,
  );
  assert.equal(
    needsRescheduleHonestyRewrite("Let me double-check that change for you and confirm.", NO_MUTATION),
    false,
  );
});

test("claimsRescheduleOrCancelSuccess pure predicate", () => {
  assert.equal(claimsRescheduleOrCancelSuccess("I've rescheduled your appointment."), true);
  assert.equal(claimsRescheduleOrCancelSuccess("moved your call to 3pm"), true);
  assert.equal(claimsRescheduleOrCancelSuccess("your appointment is cancelled"), true);
  assert.equal(claimsRescheduleOrCancelSuccess("what time works for you?"), false);
  assert.equal(claimsRescheduleOrCancelSuccess(""), false);
  // "cancelling" (in-progress) is not "cancelled" (done)
  assert.equal(claimsRescheduleOrCancelSuccess("I'm cancelling that now"), false);
});

// ── BOOK-CONFIRM-HONESTY-1: fresh-booking honesty guard ──

const OK_BOOK = [{ name: "book-appointments" }];
const OK_BOOK_SINGULAR = [{ name: "book-appointment" }];
const ERR_BOOK = [{ name: "book-appointments", error: "This operation was aborted" }];

test("booking: claims booked with NO successful book-appointments -> rewrite", () => {
  assert.equal(
    needsBookingHonestyRewrite("Perfect, you're booked for Tuesday at 2pm — confirmation email coming.", NO_MUTATION),
    true,
  );
  // a book-appointments that ERRORED (BOOK-ABORT-GHOST abort) still counts as "no success"
  assert.equal(needsBookingHonestyRewrite("You're all set for Tuesday 2pm.", ERR_BOOK), true);
});

test("booking: claims booked WITH a successful book-appointment(s) -> passes through", () => {
  assert.equal(needsBookingHonestyRewrite("All done — you're booked in for Tuesday 2pm.", OK_BOOK), false);
  assert.equal(needsBookingHonestyRewrite("All done — you're booked in for Tuesday 2pm.", OK_BOOK_SINGULAR), false);
});

test("booking: a mere OFFER is not a confirmation (no false positive)", () => {
  assert.equal(claimsBookingSuccess("I can book you in for 2pm Tuesday — shall I lock it in?"), false);
  assert.equal(claimsBookingSuccess("Would you like me to book you in for Tuesday at 2pm?"), false);
  assert.equal(claimsBookingSuccess("Shall I lock in 2pm for you?"), false);
  assert.equal(claimsBookingSuccess("You're all set to pick whichever time suits."), false);
});

test("booking: an already-honest hedge is left untouched", () => {
  assert.equal(
    needsBookingHonestyRewrite("Having a bit of trouble locking that in — let me double-check and confirm shortly.", NO_MUTATION),
    false,
  );
  assert.equal(
    needsBookingHonestyRewrite("I wasn't able to book that just now, let me take another look.", NO_MUTATION),
    false,
  );
});

test("booking: various completed-booking phrasings fire without a tool success", () => {
  for (const reply of [
    "You're confirmed for Thursday at 10am.",
    "Great, I've booked you in for Friday 3pm.",
    "Got you booked in for Monday morning.",
    "Your appointment is confirmed.",
    "All booked in — see you then.",
  ]) {
    assert.equal(needsBookingHonestyRewrite(reply, NO_MUTATION), true, reply);
  }
});
