// RESCHED-SMS-1: unit tests for the reschedule/cancel honesty guard.
//   node --experimental-strip-types --test trigger/_shared/rescheduleHonestyGuard.test.ts
import test from "node:test";
import { strict as assert } from "node:assert";
import {
  claimsRescheduleOrCancelSuccess,
  needsRescheduleHonestyRewrite,
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
