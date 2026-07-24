// Simulator tool shim (repoint of the simulator off the retired n8n engine).
//
// The simulator drives the REAL native setter (processSetterReply) so a simulated
// conversation exercises the live prompt + tool loop. That fidelity is the point, but
// it must not leak into the real world: a dummy persona must never create a real GHL
// appointment or send a real SMS.
//
// Split:
//   READ  tools pass through to the real voice-booking-tools caller, so the setter
//         offers genuine open times (and processSetterReply's canonical-slot / event-id
//         binding still works, since that wrapping happens OUTSIDE this shim).
//   WRITE tools are answered with a synthetic success and never reach GHL/Twilio.
//
// Why the stubs RESOLVE instead of throwing: setterToolLoop only stamps
// ToolInvocation.error when callTool throws, and needsBookingHonestyRewrite treats an
// errored book-appointments as "did not actually book" and rewrites the reply into a
// holding message. A throwing stub would rewrite every simulated confirmation.
import type { CallTool } from "./setterToolLoop.ts";

// Mutating tools: intercepted in simulation. Both hyphen and underscore spellings are
// listed because the model may emit either (mirrors BFD_VOICE_BOOKING_TOOL_NAMES in
// retellDrift.ts / bfdVoiceTools.ts).
const SIMULATED_WRITE_TOOLS = new Set<string>([
  "book-appointments",
  "book-appointment",
  "cancel-appointments",
  "cancel-appointment",
  "update-appointment",
  "schedule-callback",
  "schedule_callback",
  "send-sms",
  "send_sms",
]);

const str = (args: Record<string, unknown>, key: string): string | undefined => {
  const v = args?.[key];
  return typeof v === "string" && v.trim() ? v : undefined;
};

export function isSimulatedWriteTool(name: string): boolean {
  return SIMULATED_WRITE_TOOLS.has((name || "").trim().toLowerCase());
}

/**
 * Wrap the real voice-booking-tools caller so that, in a simulation, mutating tools
 * return a plausible success without touching GHL or Twilio. Anything not recognised as
 * a write tool passes through unchanged (conservative: new read tools keep working).
 */
export function makeSimulationCallTool(inner: CallTool): CallTool {
  let seq = 0;

  return async (name, toolArgs) => {
    const tool = (name || "").trim().toLowerCase();
    if (!SIMULATED_WRITE_TOOLS.has(tool)) return inner(name, toolArgs);

    const args = (toolArgs ?? {}) as Record<string, unknown>;
    seq += 1;
    const base = { simulated: true, success: true } as Record<string, unknown>;

    switch (tool) {
      case "book-appointments":
      case "book-appointment":
        return {
          ...base,
          status: "booked",
          appointmentId: `sim-appt-${seq}`,
          // Echo the requested window so the setter confirms the time it actually chose.
          startDateTime: str(args, "startDateTime") ?? null,
          endDateTime: str(args, "endDateTime") ?? null,
        };

      case "cancel-appointments":
      case "cancel-appointment":
        return { ...base, status: "cancelled", eventId: str(args, "eventId") ?? null };

      case "update-appointment":
        return {
          ...base,
          status: "rescheduled",
          eventId: str(args, "eventId") ?? null,
          startDateTime: str(args, "startDateTime") ?? null,
          endDateTime: str(args, "endDateTime") ?? null,
        };

      case "schedule-callback":
      case "schedule_callback":
        return {
          ...base,
          status: "scheduled",
          callbackId: `sim-callback-${seq}`,
          startDateTime: str(args, "startDateTime") ?? null,
        };

      case "send-sms":
      case "send_sms":
        return { ...base, status: "sent", messageId: `sim-sms-${seq}` };

      default:
        // Unreachable (set membership already checked); keep the shim total.
        return { ...base, status: "ok" };
    }
  };
}
