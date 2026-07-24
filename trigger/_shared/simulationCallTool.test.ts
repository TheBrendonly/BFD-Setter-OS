// TDD for the simulator's tool shim. Runs via:
//   node --experimental-strip-types --test trigger/_shared/simulationCallTool.test.ts
//
// The simulator drives the REAL native setter (processSetterReply) so simulated
// conversations exercise the live prompt + tool loop. Read tools must hit real GHL
// (so the setter offers genuine times), but WRITE tools must never fire: a simulated
// persona must not create a real appointment or send a real SMS.
//
// Contract that matters downstream: a stubbed write must RETURN (never throw), because
// setterToolLoop only stamps ToolInvocation.error when callTool throws, and
// needsBookingHonestyRewrite treats an errored book-appointments as "did not book" and
// rewrites the reply to a holding message. A throwing stub would make every simulated
// booking confirmation get rewritten.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { makeSimulationCallTool } from "./simulationCallTool.ts";
import type { CallTool } from "./setterToolLoop.ts";

function spyInner(returnValue: unknown = { real: true }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const inner: CallTool = async (name, args) => {
    calls.push({ name, args });
    return returnValue;
  };
  return { inner, calls };
}

const READ_TOOLS = [
  "get-available-slots",
  "get-contact-appointments",
  "lookup-contact",
  "lookup_contact",
];

const WRITE_TOOLS = [
  "book-appointments",
  "book-appointment",
  "cancel-appointments",
  "cancel-appointment",
  "update-appointment",
  "schedule-callback",
  "schedule_callback",
  "send-sms",
  "send_sms",
];

test("read tools delegate to the real tool caller", async () => {
  for (const name of READ_TOOLS) {
    const { inner, calls } = spyInner({ slots: ["2026-08-01T09:00:00+10:00"] });
    const callTool = makeSimulationCallTool(inner);
    const result = await callTool(name, { any: "arg" });
    assert.equal(calls.length, 1, `${name} should reach the real tool`);
    assert.equal(calls[0].name, name);
    assert.deepEqual(result, { slots: ["2026-08-01T09:00:00+10:00"] });
  }
});

test("write tools are stubbed and never reach the real tool", async () => {
  for (const name of WRITE_TOOLS) {
    const { inner, calls } = spyInner();
    const callTool = makeSimulationCallTool(inner);
    const result = await callTool(name, {});
    assert.equal(calls.length, 0, `${name} must NOT hit the real tool in a simulation`);
    assert.ok(result && typeof result === "object", `${name} must return an object`);
    assert.equal((result as Record<string, unknown>).simulated, true);
  }
});

test("stubbed writes resolve rather than throw (keeps ToolInvocation.error unset)", async () => {
  const { inner } = spyInner();
  const callTool = makeSimulationCallTool(inner);
  for (const name of WRITE_TOOLS) {
    await assert.doesNotReject(
      () => callTool(name, {}),
      `${name} must resolve so the booking honesty guard sees a successful invocation`,
    );
  }
});

test("book-appointments stub echoes the requested window so the setter confirms the right time", async () => {
  const { inner, calls } = spyInner();
  const callTool = makeSimulationCallTool(inner);
  const args = {
    startDateTime: "2026-08-01T09:00:00+10:00",
    endDateTime: "2026-08-01T09:30:00+10:00",
  };
  const result = (await callTool("book-appointments", args)) as Record<string, unknown>;
  assert.equal(calls.length, 0);
  assert.equal(result.success, true);
  assert.equal(result.startDateTime, args.startDateTime);
  assert.equal(result.endDateTime, args.endDateTime);
  assert.ok(typeof result.appointmentId === "string" && (result.appointmentId as string).length > 0);
});

test("cancel and update stubs echo the eventId they were given", async () => {
  const { inner } = spyInner();
  const callTool = makeSimulationCallTool(inner);
  const cancelled = (await callTool("cancel-appointments", { eventId: "evt_123" })) as Record<string, unknown>;
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.eventId, "evt_123");

  const updated = (await callTool("update-appointment", {
    eventId: "evt_456",
    startDateTime: "2026-08-02T11:00:00+10:00",
  })) as Record<string, unknown>;
  assert.equal(updated.success, true);
  assert.equal(updated.eventId, "evt_456");
  assert.equal(updated.startDateTime, "2026-08-02T11:00:00+10:00");
});

test("unknown tools pass through to the real caller (conservative default)", async () => {
  const { inner, calls } = spyInner({ ok: true });
  const callTool = makeSimulationCallTool(inner);
  const result = await callTool("some-future-read-tool", { a: 1 });
  assert.equal(calls.length, 1);
  assert.deepEqual(result, { ok: true });
});

test("tool name matching is case and whitespace tolerant", async () => {
  const { inner, calls } = spyInner();
  const callTool = makeSimulationCallTool(inner);
  const result = (await callTool("  Book-Appointments  ", {})) as Record<string, unknown>;
  assert.equal(calls.length, 0, "a differently-cased write tool must still be stubbed");
  assert.equal(result.simulated, true);
});
