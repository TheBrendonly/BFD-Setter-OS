// §3.12 — SMS/text setter tool parity.
//
// OpenAI-style function-calling schemas the text setter (processSetterReply)
// hands to the LLM so an SMS lead can check availability, book, reschedule,
// cancel, or request a callback — the same actions the voice agent already
// performs. Each tool name maps 1:1 to a `voice-booking-tools?tool=<name>`
// action; the engine executes the call and folds the result back into the
// conversation (see setterToolLoop.ts).
//
// IDENTITY IS ENGINE-INJECTED, NOT MODEL-SUPPLIED: the loop overrides
// contactId / phone / email / timeZone / source on every call, so these are
// deliberately NOT exposed as parameters here — the model only decides the
// booking variables (which time, which appointment, when to call back).
//
// send-sms and lookup-contact are intentionally omitted: the engine already
// sends the reply (send-sms would double-send) and already injects identity
// (lookup-contact is redundant; get-contact-appointments covers reschedule
// /cancel lookups).

export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export const SETTER_TOOLS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "get-available-slots",
      description:
        "Look up open appointment times on the calendar for a date window. Call this BEFORE offering times so you only offer slots that are actually free. Returns a map of dates to available times.",
      parameters: {
        type: "object",
        properties: {
          startDateTime: {
            type: "string",
            description:
              "Start of the search window, ISO 8601 (e.g. 2026-06-20T00:00:00). Use the near future — typically today or tomorrow onward.",
          },
          endDateTime: {
            type: "string",
            description:
              "End of the search window, ISO 8601 (e.g. 2026-06-27T23:59:59). Keep the window to about a week so the options stay manageable.",
          },
        },
        required: ["startDateTime", "endDateTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book-appointments",
      description:
        "Book an appointment at a specific time the lead has chosen. Only call this after the lead has picked a concrete time from the slots you offered. If the result says booked:false / slot_unavailable, the time was taken — offer the returned available_slots instead.",
      parameters: {
        type: "object",
        properties: {
          startDateTime: {
            type: "string",
            description:
              "The chosen slot start time, ISO 8601 (e.g. 2026-06-20T14:00:00). Use a time that appeared in get-available-slots for that day.",
          },
          notes: {
            type: "string",
            description: "Optional short note to attach to the appointment.",
          },
        },
        required: ["startDateTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get-contact-appointments",
      description:
        "List this lead's existing appointments. Call this first when the lead wants to reschedule or cancel, to get the appointment's eventId.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update-appointment",
      description:
        "Reschedule an existing appointment to a new time. Get the eventId from get-contact-appointments first. If the result says slot_unavailable, the new time was taken — offer the returned available_slots.",
      parameters: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "The appointment id to move (from get-contact-appointments).",
          },
          startDateTime: {
            type: "string",
            description: "The new start time, ISO 8601 (e.g. 2026-06-21T10:00:00).",
          },
        },
        required: ["eventId", "startDateTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel-appointments",
      description:
        "Cancel an existing appointment. Get the eventId from get-contact-appointments first. Confirm with the lead before cancelling.",
      parameters: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "The appointment id to cancel (from get-contact-appointments).",
          },
        },
        required: ["eventId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule-callback",
      description:
        "Schedule a phone call back to the lead at a time they request (e.g. when they ask to be called rather than booking a calendar slot). Use the lead's own words for the time.",
      parameters: {
        type: "object",
        properties: {
          when: {
            type: "string",
            description:
              "When to call back, in natural language as the lead said it (e.g. \"tomorrow at 3pm\", \"this afternoon\", \"in an hour\").",
          },
        },
        required: ["when"],
      },
    },
  },
];

export const SETTER_TOOL_NAMES: ReadonlySet<string> = new Set(
  SETTER_TOOLS.map((t) => t.function.name),
);

// Code-side system addendum appended to the setter's system prompt (sibling to
// MULTI_MESSAGE_INSTRUCTION). This is NOT a stored-prompt edit — voice/text
// prompts stay report-only; tool guidance lives in code and the schemas ride
// the API `tools` param.
export const TOOL_USAGE_INSTRUCTION = `\n\n## Booking actions (tools)
You can take real actions for the lead with the provided tools: check the calendar, book, reschedule, cancel, and schedule a phone callback. Use them — don't just promise to "get someone to sort it out".

The lead's identity (name, phone, email) is already known to the system. NEVER ask for their phone or email, and never pass contact details to a tool — the system attaches the right contact automatically.

How to book:
1. Call get-available-slots for a sensible near-term window before offering any times.
2. Offer the lead 2-3 specific options from the results in your reply.
3. Only call book-appointments once the lead picks a concrete time.
4. Book at most one appointment per conversation.

A live calendar availability snapshot is included in your system context each turn — treat it as the ground truth for what is open. NEVER tell a lead a time is "booked out", full, snapped up, or unavailable if it appears in that snapshot, and never invent unavailability. If a time the lead wants is not in the snapshot, say it isn't open and offer the nearest listed alternatives.

If a booking or reschedule tool returns booked:false or status "slot_unavailable", the time was just taken — do NOT tell the lead it's booked. Offer only the times in the returned available_slots and ask them to choose.

After a successful booking, confirm the exact day and time back to the lead in plain language.

To reschedule or cancel: call get-contact-appointments first to find the appointment's eventId, then update-appointment or cancel-appointments.

If the lead asks to be called rather than booking a slot, use schedule-callback with the time they gave.

Your final reply to the lead is STILL the {"messages":[...]} JSON described above — tool calls happen separately and are never shown to the lead.`;
