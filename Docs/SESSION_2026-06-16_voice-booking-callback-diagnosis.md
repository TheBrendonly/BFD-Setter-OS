---
description: Deep-dive diagnosis + fixes for two issues on live call call_c74254fa21bf2f68fc435e44ddb — invented booking slots (prompt-flow, backend healthy) and the first-ever AI callback (will fire; double-dial hole closed).
---

# Voice booking + callback deep-dive — 2026-06-16

Call under test: `call_c74254fa21bf2f68fc435e44ddb` (Main Outbound `agent_f45f4dd87a4072424f3c84b74c`
v15, outbound → +61405482446, 2026-06-16 ~02:38-02:41 UTC). BFD clientId
`e467dabc-57ee-416c-8831-83ecd9c7c925`, platform DB `bjgrgbgykvjrsuwwruoh`.

## TL;DR

- **Booking failure = prompt-flow, NOT a backend bug.** The agent invented "Friday 11:00 / 12:30" and never
  called `get-available-slots`. Friday 2026-06-19 has **0 free slots**, so GHL's 400 "slot no longer
  available" was correct. Backend proven healthy by a live round-trip (a real slot booked at HTTP 200).
- **An automated review's two headline claims were WRONG and are refuted here:** (a) an "endDateTime
  timezone bug" at `voice-booking-tools/index.ts:352` — the instant is correct (`…Z` = AEST); refuted by the
  successful real-slot booking. (b) "callback won't fire" — based on a dev-env artifact my own diagnostic
  agent accidentally created; the real prod run is FROZEN/waiting.
- **Callback WILL fire** tomorrow 2026-06-17T00:00Z (10:00 AEST). Prod Trigger run
  `run_cmqg1csns444w0hn2dex5kx5x` (env=prod) is **FROZEN** on `wait.until`; all dial preconditions green.
- **Shipped (verified live):** double-dial dedup (migration + webhook guard + tool 23505-handling) and a
  graceful "slot unavailable" recovery in `book-appointments`.
- **For Brendan (report-only, via setter UI):** add a booking guardrail "only offer/book times from
  `{{available_time_slots}}` or `get-available-slots`; if empty, call `get-available-slots` first; never
  invent."

## Evidence (all read-only, live)

- Retell `get-call`: `retell_llm_dynamic_variables = {"first_name":"Brendan"}` only → `{{available_time_slots}}`
  was empty. tool_calls = 2× `book-appointments` (invented Fri 11:00 / 12:30) → 502; 1× `schedule-callback`
  ("tomorrow morning") → `{ok:true, scheduled:true}`; `end_call`. Zero `get-available-slots`.
- `call_history` for the call: `setter_id=null, idempotency_key=null, pre_call_context=null` → the call did
  **NOT** go through `make-retell-outbound-call` (manual/dashboard test call), which is why no enrichment
  ran and `{{available_time_slots}}` was empty. On a real cadence/campaign call the pipeline pre-loads slots.
- GHL `free-slots`: Thu 2026-06-18 = 18 slots (`…+10:00`); **Fri 2026-06-19 = 0 slots**.
- Round-trip proof: `get-available-slots` → real slot `2026-06-18T16:30:00+10:00` → `book-appointments` =
  **HTTP 200**, GHL appt `C0L2AZEnd0gBBqeBd4r4` confirmed, `bookings` row written
  (`appointment_time 06:30:00+00` = 16:30 AEST). Then cancelled + test row deleted. No artifact left.
- Callback live state: row `522be766` pending, `voice_setters` b09624b5 "Main Outbound" `is_active=true` →
  `agent_f45f4dd…`; outbound phone binding **+61481614530**; tz `Australia/Sydney`; `subscription_status=active`;
  lead `setter_stopped=false`. Prod run `run_cmqg1csns444w0hn2dex5kx5x` FROZEN since 02:41 UTC, ttl 14d.
  `trigger_run_id=NULL` is expected until fire (set in `scheduleCallback.ts:67-69`).

## Disclosure (my own side effect)

During the read-only diagnosis, a sub-agent inadvertently POSTed a "test" trigger to the **dev** Trigger
env (`run_cmqgdyko…`, env=dev, EXPIRED after 10m TTL). It **never dialed** and did **not** create a
`scheduled_callbacks` row (count stayed exactly 1). An automated reviewer mistook this dev artifact for the
real run and wrongly concluded the callback wouldn't fire. Harmless; documented here so it isn't
misread later.

## Shipped this session (deployed to prod)

- **Migration** `frontend/supabase/migrations/20260616120000_scheduled_callbacks_pending_dedup.sql` — partial
  unique index `scheduled_callbacks_pending_contact_uidx (client_id, ghl_contact_id) WHERE status='pending'`.
  Applied via Management API; index confirmed; no duplicate pending rows.
- **`voice-booking-tools` v15:** (B1c) `toolScheduleCallback` catches 23505 → returns
  `{scheduled:true, already_scheduled:true, …}` (no duplicate dial, no false-fail). (B2) `book-appointments`
  returns `{booked:false, status:"slot_unavailable", retry_with_available_slots:true}` (HTTP 200) on a GHL
  400 slot rejection instead of an opaque 502.
- **`retell-call-analysis-webhook` v22:** (B1b) pre-insert dedup — skips the webhook-path callback insert if
  a pending callback already exists for `(client_id, ghl_contact_id)`.
- **Verified live:** real-slot book = 200; unavailable-slot = 200 `booked:false`; duplicate schedule-callback
  for the contact = `already_scheduled:true` with `scheduled_callbacks` count unchanged at 1.

## Open / handoff items

- 🚩 **Brendan (report-only prompt, via BFD setter UI):** add to the AVAILABILITY/BOOKING section of Main
  Outbound (then roll to the 4 Garys):
  > Only ever offer or book a time that appears in `{{available_time_slots}}` or that `get-available-slots`
  > returned during this call. Never invent or guess a time. If `{{available_time_slots}}` is empty/missing,
  > say "let me check the calendar" and call `get-available-slots` BEFORE offering any time. For dates beyond
  > the pre-loaded 30-day window, call `get-available-slots` first.

  Reconcile vs `Docs/VOICE_AGENT_PROMPT_REWRITES_2026-06-14.md` and the V6 item in
  `project_pending_prompt_changes` so it isn't done twice.
- **Live callback verify (2026-06-17 ~10:12 AEST):** a one-shot cron (`9b7572b3`) is set to auto-confirm the
  row flips to `placed` + a call lands on +61405482446. **Caveat:** it is session-only, so it only fires if a
  Claude session is active around then. The callback firing itself is guaranteed by Trigger.dev (the frozen
  prod run), independent of Claude — verification can be re-run anytime after 10:00 AEST by checking row
  `522be766` status + Retell call log.
- **Not done (optional, deferred):** B3 webhook trigger-POST error visibility (currently `console.warn` only).
  Booking does not auto-cancel a pending callback (out of scope).
