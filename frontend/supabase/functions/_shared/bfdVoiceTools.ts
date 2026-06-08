// Canonical BFD voice function-call tool authority. Shared by retell-proxy
// (push-time URL forcing + default-tool injection).
//
// Why name-based authority: existing voice setters store stale upstream n8n
// webhook URLs for their booking tools (from the forked repo). Rather than try
// to pattern-match every possible old URL, retell-proxy keys on the tool NAME and
// always rewrites a known BFD tool's URL to our own voice-booking-tools edge fn at
// push time. An unrecognised old URL can therefore never slip through.
//
// KEEP THE TWO TOOL DEFS BELOW IN SYNC with DEFAULT_RETELL_GENERAL_TOOLS in
// frontend/src/lib/retellVoiceAgentDefaults.ts (the UI seed copy), the same way
// the placeholder constant is mirrored there.

// Sentinel URL the UI seeds for BFD tools; resolved to the live endpoint at push.
export const BFD_VOICE_BOOKING_TOOLS_PLACEHOLDER = "__BFD_VOICE_BOOKING_TOOLS__";

// Every tool name (and underscore alias) that MUST route to voice-booking-tools.
// Mirrors the switch in voice-booking-tools/index.ts. end_call/transfer_call excluded.
export const BFD_VOICE_BOOKING_TOOL_NAMES = new Set<string>([
  "get-available-slots",
  "book-appointments", "book-appointment",
  "cancel-appointments", "cancel-appointment",
  "get-contact-appointments",
  "update-appointment",
  "lookup-contact", "lookup_contact",
  "send-sms", "send_sms",
  "schedule-callback", "schedule_callback",
]);

// Default SMS tool: texts the lead mid-call (link / address / confirmation).
export const BFD_SEND_SMS_TOOL = {
  type: "custom",
  name: "send-sms",
  url: BFD_VOICE_BOOKING_TOOLS_PLACEHOLDER,
  method: "POST",
  parameter_type: "json",
  args_at_root: false,
  query_params: { "function-type": "send-sms" },
  headers: {},
  timeout_ms: 120000,
  speak_during_execution: true,
  speak_after_execution: false,
  execution_message_description:
    'Say a brief natural phrase like "Sure, texting that to you now". Under 10 words.',
  response_variables: {},
  description:
    "Send an SMS to the lead during the call. Use when the caller asks you to text them a link, address, booking confirmation, or any info that's easier in writing.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The exact SMS body to text the lead." },
    },
    required: ["message"],
  },
};

// Default callback tool: AI calls the lead back later when they can't talk now.
export const BFD_SCHEDULE_CALLBACK_TOOL = {
  type: "custom",
  name: "schedule-callback",
  url: BFD_VOICE_BOOKING_TOOLS_PLACEHOLDER,
  method: "POST",
  parameter_type: "json",
  args_at_root: false,
  query_params: { "function-type": "schedule-callback" },
  headers: {},
  timeout_ms: 120000,
  speak_during_execution: true,
  speak_after_execution: false,
  execution_message_description:
    'Confirm casually, e.g. "Great, I\'ll give you a call back then". Under 12 words.',
  response_variables: {},
  description:
    "Schedule an AI callback when the lead can't talk now but wants to be called back later. Use ONLY when they are NOT booking an appointment.",
  parameters: {
    type: "object",
    properties: {
      when: {
        type: "string",
        description:
          "When to call back, in the lead's own words, for example 'this afternoon', 'tomorrow morning', 'at 3pm', 'in an hour', or an explicit time.",
      },
    },
    required: ["when"],
  },
};

// The default tools retell-proxy injects into any setter that predates them.
export const BFD_DEFAULT_INJECT_TOOLS = [BFD_SEND_SMS_TOOL, BFD_SCHEDULE_CALLBACK_TOOL];
