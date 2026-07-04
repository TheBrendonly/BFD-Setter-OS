export const DEFAULT_RETELL_ANALYSIS_SUCCESSFUL_PROMPT = "Evaluate whether the agent seems to have a successful call with the user, where the agent finishes the task, and the call was complete without being cutoff.";

export const DEFAULT_RETELL_ANALYSIS_SUMMARY_PROMPT = "Write a 1-3 sentence summary of the call based on the call transcript. Should capture the important information and actions taken during the call.";

export const DEFAULT_RETELL_ANALYSIS_USER_SENTIMENT_PROMPT = "Evaluate user's sentiment, mood and satisfaction level.";

export const DEFAULT_RETELL_POST_CALL_ANALYSIS_DATA = [
  {
    name: "Call result",
    description: "Is the call booked by the user?",
    type: "enum",
    choices: ["Call Booked", "Other"],
  },
  {
    type: "string",
    name: "call_ended_reason",
    description: "Reason for the end to be ended",
  },
  {
    type: "string",
    name: "user_name",
    description: "full name of the user",
  },
  {
    type: "string",
    name: "email_id",
    description: "email id of the user",
  },
  {
    type: "boolean",
    name: "success_rate",
    description: "Does this call is a success? and success means that the user asked at least 3 questions",
  },
  {
    name: "interested_status",
    description: "Identify if the user is interested or not interested ",
    type: "enum",
    choices: ["interested", "not_interested"],
  },
] as const;

// Sentinel URL value for the 5 booking tools below. retell-proxy/sync-voice-setter
// rewrites this placeholder (or any legacy n8n-1prompt.99players.com URL) to the
// platform's own voice-booking-tools edge fn with per-tenant clientId + Bearer
// auth at push time. Keep both strings in sync if either changes.
export const BFD_VOICE_BOOKING_TOOLS_PLACEHOLDER = "__BFD_VOICE_BOOKING_TOOLS__";

export const DEFAULT_RETELL_GENERAL_TOOLS = [
  {
    name: "end_call",
    type: "end_call",
  },
  {
    headers: {},
    parameter_type: "json",
    method: "POST",
    query_params: {
      "function-type": "update-appointment",
    },
    description:
      'Use this function to update the appointment . Use the eventId from the appointment  chosen by the user. Use the timezone given by the user and startDateTime given by user from the list of slots or directly. Use the "id" from the appointment list as the eventId which is chosen by the user from the list.',
    type: "custom",
    url: "__BFD_VOICE_BOOKING_TOOLS__",
    args_at_root: false,
    timeout_ms: 120000,
    speak_after_execution: true,
    name: "update-appointment",
    response_variables: {},
    speak_during_execution: true,
    execution_message_description:
      'Based on what the user just asked, say a brief casual phrase confirming the change is in progress. Examples: "No worries, updating your booking now, just a few seconds" or "Got it, making that change for you". Keep it natural, under 12 words, never robotic.',
    parameters: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "The timeZone of the user.",
        },
        eventId: {
          type: "string",
          description: "The eventId of the user.",
        },
        startDateTime: {
          type: "string",
          description: "The startDateTime of the user. for example (2025-07-02T13:30:00-07:00)",
        },
        email: {
          type: "string",
          description: "The email address of the user.",
        },
      },
      required: ["eventId", "timeZone", "startDateTime", "email"],
    },
  },
  {
    headers: {},
    parameter_type: "json",
    method: "POST",
    query_params: {
      "function-type": "get-available-slots",
    },
    description:
      "Use this function to get the list of appointments. Use the timezone given by the get-timezone function. Use the startDateTime given by the user to get the list of appointments.",
    type: "custom",
    url: "__BFD_VOICE_BOOKING_TOOLS__",
    args_at_root: false,
    execution_message_description:
      'Based on what the user asked, say a brief natural phrase like "Let me check what I have open for you" or "One sec, pulling up the calendar". Keep it casual, under 10 words, never sound scripted.',
    timeout_ms: 120000,
    speak_after_execution: false,
    name: "get-available-slots",
    response_variables: {},
    speak_during_execution: true,
    parameters: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "The timezone of the user for which the availability will be checked.",
        },
        startDateTime: {
          type: "string",
          description:
            "The start date and time for the booking window. Set to the beginning of the selected day (e.g., 2025-06-19T00:00:00).",
        },
        endDateTime: {
          type: "string",
          description:
            "The end date and time for the booking window. Set to the end of the selected day (e.g., 2025-06-19T23:59:59).",
        },
        email: {
          type: "string",
          description: "The email address of the user requesting the booking.",
        },
      },
      required: ["timeZone", "startDateTime", "endDateTime", "email"],
    },
  },
  {
    headers: {},
    parameter_type: "json",
    method: "POST",
    query_params: {
      "function-type": "book-appointments",
    },
    description:
      "Use this function to book the appointments. Use the user's timezone, email, and booking date and time.",
    type: "custom",
    url: "__BFD_VOICE_BOOKING_TOOLS__",
    args_at_root: false,
    execution_message_description:
      'Based on the slot the user just picked, say something natural like "Yep, great, let me finalize your booking on my side" or "Perfect, locking that in for you now". Confirm their choice casually, under 12 words.',
    timeout_ms: 120000,
    speak_after_execution: false,
    name: "book-appointments",
    response_variables: {},
    speak_during_execution: true,
    parameters: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "The timeZone of the user.",
        },
        email: {
          type: "string",
          description: "The email of the user.",
        },
        startDateTime: {
          type: "string",
          description:
            "The startDateTime of the user. Example Format: 2025-06-27T18:30:00+05:30 (Make sure to have the correct timezone according to the user)",
        },
      },
      required: ["email", "timeZone", "startDateTime"],
    },
  },
  {
    headers: {},
    parameter_type: "json",
    method: "POST",
    query_params: {
      "function-type": "cancel-appointments",
    },
    description:
      'Use this function to cancel the event. User will select from the given list of user\'s appointments. Use the eventId of that appointment. Get the eventId from the appointment which user choose to cancel. You can get it from the list. it would be like "iJmJNN7ZeiIrIID1JmkW" for example it would be the "id" from the appointment detail you got from get-contact-appointment response',
    type: "custom",
    url: "__BFD_VOICE_BOOKING_TOOLS__",
    args_at_root: false,
    execution_message_description:
      'Based on the user\'s cancellation request, say something brief like "Good, give me a second to process your cancellation" or "Understood, cancelling that for you now". Confirm naturally, under 12 words.',
    timeout_ms: 120000,
    speak_after_execution: false,
    name: "cancel-appointments",
    response_variables: {},
    speak_during_execution: true,
    parameters: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "The eventId of the appointment.",
        },
        email: {
          type: "string",
          description: "The email address associated with the appointment.",
        },
      },
      required: ["eventId", "email"],
    },
  },
  {
    headers: {},
    parameter_type: "json",
    method: "POST",
    query_params: {
      "function-type": " get-contact-appointments",
    },
    description:
      "Use this function to get the contact appointment when user ask to update the booking. Use the contact Id by finding the contact though get-contact function. Use the timezone determined by the user location.",
    type: "custom",
    url: "__BFD_VOICE_BOOKING_TOOLS__",
    args_at_root: false,
    execution_message_description:
      'Based on what the user asked, say a brief natural phrase like "Yes, please bear with me while I check my system" or "Let me pull up your appointments real quick". Acknowledge naturally, under 12 words.',
    timeout_ms: 120000,
    speak_after_execution: false,
    name: "get-contact-appointments",
    response_variables: {},
    speak_during_execution: true,
    parameters: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "The timeZone of the user to get events.",
        },
        email: {
          type: "string",
          description: "The email of the user to get events.",
        },
      },
      required: ["email", "timeZone"],
    },
  },
  {
    type: "custom",
    name: "send-sms",
    url: "__BFD_VOICE_BOOKING_TOOLS__",
    method: "POST",
    parameter_type: "json",
    args_at_root: false,
    query_params: { "function-type": "send-sms" },
    headers: {},
    timeout_ms: 120000,
    speak_during_execution: true,
    speak_after_execution: false,
    execution_message_description:
      "Say a brief natural phrase like \"Sure, texting that to you now\". Under 10 words.",
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
  },
  {
    type: "custom",
    name: "schedule-callback",
    url: "__BFD_VOICE_BOOKING_TOOLS__",
    method: "POST",
    parameter_type: "json",
    args_at_root: false,
    query_params: { "function-type": "schedule-callback" },
    headers: {},
    timeout_ms: 120000,
    speak_during_execution: true,
    speak_after_execution: false,
    execution_message_description:
      "Confirm casually, e.g. \"Great, I'll give you a call back then\". Under 12 words.",
    response_variables: {},
    description:
      "Schedule an AI callback when the lead can't talk now but wants to be called back later. Use ONLY when they are NOT booking an appointment.",
    parameters: {
      type: "object",
      properties: {
        when: {
          type: "string",
          description:
            "When to call back, in the lead's own words — e.g. 'this afternoon', 'tomorrow morning', 'at 3pm', 'in an hour', or an explicit time.",
        },
      },
      required: ["when"],
    },
  },
] as const;

export const DEFAULT_RETELL_VOICEMAIL_OPTION = {
  action: {
    type: "hangup",
  },
} as const;

export const DEFAULT_RETELL_USER_DTMF_OPTIONS = {} as const;

export const formatJsonConfig = (value: unknown): string => JSON.stringify(value, null, 2);

export const parseJsonConfig = <T>(value: string | undefined, fallback: T, label: string): T => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
};

export const parseCommaSeparatedValues = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);