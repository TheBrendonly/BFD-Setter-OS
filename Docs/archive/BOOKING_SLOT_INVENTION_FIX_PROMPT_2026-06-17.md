---
description: Copy-paste build prompt for a focused session to fix the voice-booking "agent invents slots for unavailable days" failure (diagnosed 2026-06-17 during the live run-through). Backend is healthy; the agent fabricates times for days with no GHL availability and book-appointments correctly rejects them in a loop. Two fixes - a prompt hardening (Brendan applies via UI) and a server-side guard in voice-booking-tools.
---

> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---

# Voice Booking Fix - "agent invents slots for unavailable days"

> **SUPERSEDED 2026-06-17 (mostly).** A parallel session shipped `eb53690` (voice-booking-tools
> **v17**): the real root cause was the voice model rebuilding the slot ISO string and DROPPING the
> timezone offset, so GHL rejected wide-open slots as "no longer available" (no voice_call booking had
> ever succeeded). The fix books GHL's exact canonical free-slot string and returns the real slots
> inline on an unmatched time — i.e. it already implements the server-side code-guard proposed below.
> What remains OPTIONAL from this doc: the prompt-hardening (the "never invent a time not in the slot
> list" wording in section 2). The next action is a booking RE-TEST to confirm a real booking now
> completes, not a rebuild.

## Copy-paste prompt for the fix session

```
BFD-setter voice-booking fix session. Read Docs/BOOKING_SLOT_INVENTION_FIX_PROMPT_2026-06-17.md (this file)
+ memory project_voice_booking_and_callback_2026_06_16 + feedback_no_internal_prompt_edits
+ feedback_verify_before_moving_on.

CONTEXT (diagnosed live 2026-06-17, outbound call call_a2dc88312c348060995ecd5cf69 on agent_f45f4dd /
llm_a73df8d v17, client e467dabc-57ee-416c-8831-83ecd9c7c925):
- The booking BACKEND is HEALTHY. get-available-slots returns real slots for available days
  (e.g. Thu 2026-06-18 10:00-16:30, Mon 06-22, Tue 06-23); Friday 06-19 and weekends have ZERO slots.
- make-retell-outbound-call pre-loads {{available_time_slots}} correctly (the agent's FIRST offer in
  the call, "Thursday 10am or 2:30pm", was a REAL slot).
- FAILURE: when the lead asked for FRIDAY (a 0-slot day), the agent HALLUCINATED Friday slots
  (9:30, 10, 11, 8:30, 1pm) instead of saying Friday was full. book-appointments posts to GHL with
  ignoreFreeSlotValidation:false, so GHL rejects each invented time with 400 "slot no longer
  available"; voice-booking-tools returns {booked:false, status:"slot_unavailable", ...} -> the agent
  re-invents -> infinite "someone just beat us to that slot" loop, never books.
- So this is PROMPT/MODEL-ADHERENCE, not an API bug. The existing "Slots are the only source of
  truth" guardrail is too soft - the model overrides it under user pressure for a specific day.

DO TWO THINGS:

1. CODE (you build): harden trigger/voice booking so the model CANNOT sustain an invent-loop.
   In frontend/supabase/functions/voice-booking-tools/index.ts, toolBookAppointments (~line 333-394):
   on the slot_unavailable branch (GHL 400 "no longer available"), DON'T just return a "go check the
   calendar" message - instead call the existing free-slots logic (reuse toolGetAvailableSlots /
   ghlGet /calendars/{id}/free-slots) for a sensible window (e.g. the requested day +/- the next ~7
   open days), compact it, and RETURN the real available slots inline in the tool result, e.g.
   { booked:false, status:"slot_unavailable", available_slots:{...}, message:"That time isn't
   available. Here are the real open times: ..." }. That way the only times the agent can read back
   are real ones. Keep the 502 path for non-slot GHL errors. tsc clean; deploy via
   `node --env-file=.env scripts/deploy_single_fn.mjs voice-booking-tools` (or the bundle script);
   confirm ACTIVE + bump version. Add a read-only test (call get-available-slots + a deliberately
   bad book-appointments) proving the response now carries real slots.

2. PROMPT (REPORT-ONLY - Brendan applies via the BFD setter UI; do NOT edit Retell or repo prompt
   files): give Brendan the exact wording to strengthen the BOOKING FLOW / RULES section so it is
   ABSOLUTE: "You may ONLY offer or confirm a time that literally appears in {{available_time_slots}}
   or in a slot list returned by get-available-slots THIS call. If the lead asks for a day/time that
   is not in that list, you MUST say that day/time is unavailable and offer the nearest real
   open day/times - NEVER invent, guess, approximate, or 'try' a time to see if it books. Before EVERY
   book-appointments call, silently confirm the chosen startDateTime is character-for-character one of
   the available slots; if it is not, do not call the tool." Provide it as a diff-style before/after
   block Brendan can paste.

Constraints: read-only verification first; no Retell/repo prompt-content edits (report-only); deploy
via the repo scripts; verify before claiming done; no em dashes. End with: the deployed version, the
test output proving real slots are returned on slot_unavailable, and the exact prompt text for Brendan.
```

## Supporting evidence (for quick reference)

- Live call: `call_a2dc88312c348060995ecd5cf69` (outbound, 2026-06-17 06:23-06:26 UTC, agent
  `agent_f45f4dd87a4072424f3c84b74c`, llm `llm_a73df8d21c84d27b990d53e6722d` v17).
- Tools all correctly point to `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools`
  with `clientId=e467dabc-57ee-416c-8831-83ecd9c7c925`.
- `get-available-slots` live read (range 06-18..06-28) returned real slots for 06-18/22/23/... and
  none for Fridays/weekends. A single-Friday (06-19) query returned only `{traceId}` (zero slots).
- Calendar config: `ghl_calendar_id=2p9eg0Qv7QoKknk1Sp2d`, `ghl_assignee_id=p2Pk4Tt4WZJIFFMvY8LJ`,
  tz Australia/Sydney - all present and working.
- `voice-booking-tools` slot_unavailable branch: `frontend/supabase/functions/voice-booking-tools/index.ts:378-394`.
- Pre-load of `{{available_time_slots}}`: `make-retell-outbound-call/index.ts:237` (free-slots fetch),
  `:759` (inject into `retell_llm_dynamic_variables`).
