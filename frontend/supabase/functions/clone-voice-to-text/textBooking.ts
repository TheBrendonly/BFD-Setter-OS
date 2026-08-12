// Twin of DEFAULT_BOOKING_PROMPT in frontend/src/data/defaultBookingPrompt.ts.
//
// KEEP IN SYNC with that file. A twin is required, not preferred: edge functions are
// bundled from their own directory plus _shared/ (scripts/deploy_single_fn.mjs), so
// frontend/src is unreachable at runtime. transform.test.ts asserts this copy is
// lint-clean, which is the property that actually matters if the two ever drift.
//
// Booking MECHANICS are code-owned for the text engine (trigger/_shared/setterTools.ts
// TOOL_USAGE_INSTRUCTION + the tool schemas + the runtime-injected availability and
// current-time blocks), so this is persona-level guidance only. It must stay free of
// {{ }} tokens, day/hour policies, example booking times, and legacy tool names, all of
// which the save-external-prompt lint rejects.

export const DEFAULT_TEXT_BOOKING_PROMPT = `# BOOKING APPROACH

The system handles booking mechanics for you: a live calendar availability snapshot and the real current date and time are injected into your context every turn, and the booking tools (get-available-slots, book-appointments, get-contact-appointments, update-appointment, cancel-appointments, schedule-callback) are always available.

Rules:
- The injected live calendar is the ONLY source of truth for availability. Never state a day or time policy of your own.
- Offer only times from the injected availability, and book the exact date and time the lead accepts.
- Keep booking conversational: qualify first when natural, offer 2-3 concrete options, confirm the booked day and time back in plain language.
`;

/**
 * SMS style rules appended to a converted prompt.
 *
 * The voice prompt's pacing rules ("1 to 2 sentences per turn", "one question at a
 * time") are about turn-taking on a phone call; the text equivalents are about message
 * length and thread etiquette, which are genuinely different constraints.
 */
export const TEXT_CHANNEL_STYLE = `# TEXT CHANNEL STYLE

You are texting, not talking. Adapt accordingly:
- Keep messages short: 1 to 2 sentences, the length a real person thumbs out on a phone.
- One question per message. Send it and wait; never stack questions in a thread.
- Write casually and in lower-key punctuation, the way a person texts. No bullet lists, no headings, no markdown in what you send.
- No emoji unless the lead uses them first.
- Never mention speaking, calling, hearing, hold music, or waiting on the line. There is no audio channel here.
- The lead can reread the thread, so do not repeat information you already sent.
`;
