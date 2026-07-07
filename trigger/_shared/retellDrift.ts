// F9 v2 — pure drift-state comparison for a LOCKED voice setter.
//
// The scheduled poll (trigger/pollRetellDrift.ts) uses this to detect, server-side:
//   (a) versionDrifted     — the live Retell agent has been published past the version
//                            BFD last synced (retell_synced_version): someone edited the
//                            locked agent directly in Retell.
//   (b) bookingToolsLost   — the locked agent's LLM no longer carries ANY BFD booking
//                            tool, so in-call booking would silently break.
//
// Pure: no DB, no HTTP. Booking-tool names are inlined (KEEP IN SYNC with
// frontend/supabase/functions/_shared/bfdVoiceTools.ts BFD_VOICE_BOOKING_TOOL_NAMES)
// so this module stays self-contained trigger-side, matching the phone.ts twin pattern.

const BFD_VOICE_BOOKING_TOOL_NAMES = new Set<string>([
  "get-available-slots",
  "book-appointments", "book-appointment",
  "cancel-appointments", "cancel-appointment",
  "get-contact-appointments",
  "update-appointment",
  "lookup-contact", "lookup_contact",
  "send-sms", "send_sms",
  "schedule-callback", "schedule_callback",
]);

export interface DriftInput {
  syncedVersion: number | null;
  snapshot: { llm?: { booking_tools_present?: boolean | null } | null } | null;
  liveAgentVersion: number | null;
  liveLlmToolNames: string[];
}

export interface DriftState {
  versionDrifted: boolean;
  bookingToolsLost: boolean;
}

/**
 * Conservative on missing data: a null synced or live version never flags drift
 * (only a confirmed forward move counts), and bookingToolsLost only fires when the
 * snapshot POSITIVELY recorded booking tools (conversation-flow agents, whose
 * snapshot has no llm block, never false-positive).
 */
export function computeDriftState(input: DriftInput): DriftState {
  const versionDrifted =
    input.syncedVersion != null &&
    input.liveAgentVersion != null &&
    input.liveAgentVersion > input.syncedVersion;

  const snapshotHadBookingTools = input.snapshot?.llm?.booking_tools_present === true;
  const liveHasBookingTools = input.liveLlmToolNames.some((n) =>
    BFD_VOICE_BOOKING_TOOL_NAMES.has(n)
  );
  const bookingToolsLost = snapshotHadBookingTools && !liveHasBookingTools;

  return { versionDrifted, bookingToolsLost };
}
