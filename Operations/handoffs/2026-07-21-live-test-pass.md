---
description: 2026-07-21 evening live TEST pass (Brendan present) — 3 owed legs + voice booking + autonomous legs all PASS; SEC-PII-LOGS-1 + the full GHL booking-sync fix shipped.
---

# 2026-07-21 (evening) — Live TEST pass + GHL booking-sync fix

Live window, Brendan on the phone/2FA. Harness: magic-link + TOTP (`agency_login.mjs`), service-key dials
(`dial.mjs`), signed inbound-SMS sims (`sms_inbound.mjs`), Mgmt-API SQL (`q.mjs`), GHL REST. Scratchpad
`storageState.json` held the agency session for all browser legs.

## What passed (→ COMPLETED_LOG 2026-07-21 evening)

**3 owed legs:** STOP-footer 24a (appended once, not doubled, +429 LIVE-D) · bookings render-smoke (ContactDetail
shows real bookings, no JS error; `lead_notes` 400 is pre-existing) · REACT-NORMPHONE-1 (reactivation stamps
`normalized_phone`, by-phone matchable).
**Voice booking regression:** real answered call → GHL appt + `bookings` row (source=voice_call), honest confirm,
no ghost. Frozen v53/v25 baseline good.
**Autonomous:** COST-4 · SCHED-1(b) · MODEL-1-HARDENING · FOLLOWUP-DURING-CALL-1 · HOURS-1(a/d) · BOOK-TZ-DISPLAY-1 ·
RESCHED-SMS-1 (also evidences BOOK-CONFIRM-HONESTY-1).

## What shipped (committed + deployed)

- **SEC-PII-LOGS-1 residual** `d1622dd` — redact raw phone in 3 Trigger opt-out log lines. Trigger **20260721.3**,
  7 schedules re-verified.
- **sync-ghl-booking parser** `436b168` (v16) + observability `58db4ea` (v17) — parse the GHL standard-webhook
  payload (`calendar.appointmentId` at high precedence, `location.id`, `calendar.id`). END-TO-END verified live.
- **`sync_ghl_booking_executions` audit table** created (RLS tenant-read + service-write). NOTE: created via raw
  Mgmt-API SQL (this project has no `schema_migrations`); no repo migration file. `types.ts` not regenerated for it.

## The GHL booking-sync saga (important — the real root cause)

Brendan got a GHL "Workflow Error" email during the voice test. Chain of diagnosis:
1. First theory (stale PIT on a Custom Webhook) — **superseded**.
2. Real cause: **two ingestion endpoints, and one workflow pointed at a DEAD project.**
   - `bookings-webhook` ← the four F15 status workflows ("BFD bookings → BFD-Setter (BOOKED/CANCELLED/Show/No-Show)"),
     built + verified 2026-07-07, on the live project. These were fine.
   - `sync-ghl-booking` ← the "Add Booking to BFD-Setter OS" workflow, whose Custom Webhook URL was still the
     **retired `qfbhcixkxzivpmxlciot` project**. That project is STILL ALIVE and serves a pre-parser-fix copy of the
     fn, so it returned `{"error":"Booking_ID is required"}` (400) on the new payload — never reaching our live fn.
3. Fixes: (a) our live `sync-ghl-booking` now parses the new payload shape; (b) Brendan repointed the workflow URL to
   `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-booking` with `x-wh-token = ghl_webhook_secret`.
   Re-test booking = clean (source=ghl_calendar row, BOOKED + CANCELLED flowed, 0 `MISSING_BOOKING_ID`).

**Brendan still-open (GHL UI, → BRENDAN_TODO):**
- Audit EVERY GHL workflow for the `qfbhcixkxzivpmxlciot` host and repoint any remaining ones to the live project.
- Decommission (or lock down) the retired `qfbhcixkxzivpmxlciot` Supabase project — it silently serves stale code
  and is a latent trap for any integration still pointed at it.

## Deferred to next session (non-blocking)

- **BOOK-CONFIRM-HONESTY-1** dedicated forced-failure (needs a controlled book-appointments failure; the honest-
  holding-message mechanism is already evidenced by RESCHED-SMS-1).
- **PURGE-SIM-1** (simulator end-to-end) · **PURGE-TAG-1** (needs a real GHL tag-apply).
- **`lead_notes` pre-existing frontend bug** — `LeadNotesPanel`/`Chats` query a `lead_notes` table that does not
  exist in prod (400 + "Error fetching notes" on every ContactDetail). Present since the initial commit; decide:
  create the table or remove the notes UI.

## Gotchas captured

- The retired `qfbhcixkxzivpmxlciot` project is LIVE and serves old function code — treat any 4xx that looks like
  our own error but never appears in our logs as a possible wrong-project URL.
- `create_appt.mjs` sed-chain: the base file books 10:00; a `s/T11:00:00/…/` no-ops. Check the actual booked time.
- `sync_ghl_booking_executions` was missing — GHL booking-sync audit logging had been a silent no-op until now.
