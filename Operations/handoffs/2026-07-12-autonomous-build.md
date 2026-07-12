---
description: Handoff for the 2026-07-12 AUTONOMOUS BUILD session. Closed out every open non-frozen + non-first-client item (7 bugs + F21a/b/F22/F23/F25 + SCHED-1b + B2-REPOINT-1), deployed + live-verified; staged the frozen voice-booking bundle on a branch with a deploy checklist; emits the supervised frozen-deploy + Brendan test-pass prompt.
---

# 2026-07-12 — AUTONOMOUS BUILD session (close out all non-frozen + non-first-client items)

Model Opus 4.8 [1m], plan approved then executed unattended. Brendan provided one 2FA code for the headless
Playwright auth (the auth flow consumed it via a variable-shadowing bug before saving, so the browser render-verify
of LEADREACT-CRASH-1 was re-requested at close). Everything else was verified server-side (live edge-fn versions,
live-DB fixtures, a full live SMS booking regression). One commit per item by explicit path; pushed origin + github.

## Shipped + DEPLOYED + verified (non-frozen)

Live edge-fn versions after this session (all ACTIVE):

| Item | Fn / task | Version | Live verification |
|---|---|---|---|
| INTAKE-RL-1 | intake-lead | v17→**v18** | `bump_rate_limit` increments on a throwaway bucket; 429 branch in v18. (Full burst-429 → TEST_LIST.) |
| SEC-PII-LOGS-1 | unipile-webhook v13→**v14**, outbound-call-processing v13→**v14**, make-retell-outbound-call v29→**v30**, match-webinar-contacts v18→**v19** | ACTIVE | new `_shared/redact.ts` (redactPhone/redactEmail/redactBodyShape) + `redact.test.ts` 3/3; 6 log lines repointed. retell-proxy:495 = FROZEN (in the branch). |
| SEC-GHPROXY-1 | github-proxy | v11→**v12** | throwaway client-role user → **403**; agency-role → passes the gate. (Found: new users default to role `agency` via `handle_new_user` — GATE-A-adjacent, noted below.) |
| F21(a) | sync-ghl-booking | v13→**v14** (→v15 for F23) | synthetic create→reconcile: ONE row, `source=ghl_calendar`, `confirmed→cancelled` + a `booking_status_events` row; test rows deleted. Rewrote the dead old-schema insert to the phase7a shape. |
| F21(b) | get-show-rate-funnel v2→**v3**; weeklyClientReport (Trigger) | ACTIVE | live BFD funnel: `booked`=13 real setter rows (+2 test), the test `ghl_calendar` row excluded; `by_source`=only setter sources. New shared `isSetterSource` + tests. |
| F22 | webhook-manifest | v3→**v4** | live BFD response carries `reportingHealth {bookings:13, statusTransitionsSeen:true, statusAutomationLikelyMissing:false}`; `goLiveReady` unchanged (not folded in). |
| F25 | get-show-rate-funnel **v3**; weeklyClientReport (Trigger) | ACTIVE | live funnel labels `held_window: appointment_date` / `booked_window: created_at`; held/no-show event-windowed on `appointment_time`. New pure `withEventWindowedShowRate` + tests. |
| F23 | new **errorDigest** Trigger task + sync-ghl-booking v14→**v15** (error_logs column fix) | Trigger **20260712.1** | `error-digest` schedule **auto-registered + active** (`0 22 * * *`); pure `_shared/errorDigest.ts` rollup + 4 tests. Slack via `PROBE_ALERT_WEBHOOK_URL`; email behind `RESEND_API_KEY` + `ERROR_DIGEST_RECIPIENT`. Also fixed sync-ghl-booking's two error_logs inserts (message/raw_payload → error_message/context) that silently failed. |
| BOOK-TZ-DISPLAY-1 | processSetterReply + prefetchSlots (Trigger) | Trigger 20260712.1 | wired the dead `formatSlotInZone` via new `leadZoneLabels` → deterministic business→lead conversion table; dropped the model tz-arithmetic. Additive/conditional (default byte-unchanged); prefetchSlots tests +3. |
| BOOK-CONFIRM-HONESTY-1 | rescheduleHonestyGuard + processSetterReply (Trigger) | Trigger 20260712.1 | new `needsBookingHonestyRewrite` (narrow completed-booking patterns); guard tests +5. Live SMS booking regression confirmed it does NOT misfire on a real booking. |
| SEC-OPENROUTER-PII-1 | processSetterReply (Trigger) | Trigger 20260712.1 | dropped phone/email from the identity object + the Lead Context line. **Live SMS booking regression PASSED** (booking completed end-to-end with phone/email removed). |
| SCHED-1(b) | syntheticProbe + probePoll (Trigger) | Trigger 20260712.1 | new `isParkedStage`; a quiet-hours/business-hours park → PASS/SKIP (was ~21/24 false-fails). Tests +2. Also: all 7 declarative schedules registered this deploy, so **SCHED-1(a) appears resolved on the current CLI** (monitor). |
| B2-REPOINT-1 | receive-twilio-sms | v30→**v31** | later inbounds for a lingering `bfd-<phone>` lead now re-trigger the existing collision-guarded reconcile. Reuses the proven waitUntil path. |
| BOOK-ABORT-GHOST-1 (text side) | rescheduleHonestyGuard + processSetterReply (Trigger) | Trigger **20260712.2** | new `needsBookErrorHonestyRewrite`: book-appointments errored + reply blames the slot being "snapped up" → honest re-check (a genuine slot-unavailable RESULT never trips it). Tests +5. |

**Trigger.dev:** 20260712.1 (15 tasks incl. the new error-digest) then 20260712.2 (text-side book-error guard).
**Live SMS booking regression (harness → TEST_PHONE_A):** turn 1 prefetched real slots (`error=null`); turn 2
`book-appointments` succeeded (GHL appt `kF2NzEPSuAeOPdkddegZ`, `bookings` row `source=sms`) → **SEC-OPENROUTER-PII-1
did not break booking; BOOK-CONFIRM did not misfire.** Test appointment cancelled (0 residual).

## STAGED — FROZEN voice-booking bundle (branch `frozen/voice-booking-bundle`, commit `b710eab`) — DO NOT deploy headless

Built + tested (test:node 178, test:edge 262 green on the branch), pushed to origin + github, **left UNDEPLOYED**.

Contents (all edge fns):
- **SLOT-MAP-1** (retell-proxy): `syncVoiceSetter` refuses a slot-1 push unless slot 1 genuinely holds the inbound
  setter (kills the empty-"Setter-1"-tile footgun that re-creates MAIN-OUTBOUND-SHARED-1).
- **F24** (voice-booking-tools): defensive `deriveAppointmentId` + hoisted `endCadenceOnBooking` out of the
  `if(appointmentId)` gate (a booked lead's cadence always ends).
- **BOOK-ABORT-GHOST-1 booking side** (voice-booking-tools): idempotency re-query (`findAppointmentAtInstant`) +
  retry-once (re-checking idempotency between attempts) + SMS booking-link fallback on final failure.
- **BOOK-VOICE-FABRICATE-1 telemetry** (retell-call-analysis-webhook): analysis says booked but no `bookings` row →
  `error_logs` row (`booking_claimed_no_row`). PRIMARY fix is PU-14 (Brendan).
- **SEC-PII-LOGS-1** (retell-proxy:495): redact the phone in the repoint-phones log.

### FROZEN DEPLOY CHECKLIST (Brendan's supervised Voice window)
1. `git checkout frozen/voice-booking-bundle && git pull` (or cherry-pick `b710eab` onto main).
2. Read-only Voice smoke FIRST on the current live agents (baseline).
3. Deploy the 3 edge fns: `SUPABASE_PAT=… node scripts/deploy_single_fn.mjs retell-proxy` (v52→v53),
   `… voice-booking-tools` (v24→v25), `… retell-call-analysis-webhook` (v27→v28).
4. Verify read-only: live versions ACTIVE; a `sync-voice-setter` to a real slot (4-10) still works; a slot-1
   push is now refused (SLOT-MAP-1); the canonical live agents are byte-unchanged (0 mutated).
5. Live Voice booking test: an answered outbound call books cleanly (F24 cadence-ends; no ghost on a slow GHL).
6. Live SMS booking test: an aborted `book-appointments` no longer double-books (idempotency) and never says
   "snapped up" (the text-side guard is ALREADY live on main via 20260712.2).
7. Apply **PU-14** (booking tool-call gate) + **PU-6** re-verify (recording disclosure on Main Outbound) in the UI —
   these are the PRIMARY fixes for BOOK-VOICE-FABRICATE-1 and the Main Outbound disclosure gap.

## Notes / findings (for later, not this session)
- **New users default to role `agency`** (`handle_new_user` trigger + `user_roles.role` default `'agency'`). Benign
  today (signups likely disabled), but a GATE-A-adjacent hardening item — fold into the GATE A RLS sweep.
- **SCHED-1(a)**: the declarative `schedules.task` crons DID auto-register on this deploy (7 active schedules incl.
  error-digest). The earlier non-registration may have been an older-CLI/transient issue — monitor after the next deploy.
- Pre-existing type-only warnings unchanged: intake-lead (2, `body.timezone`), receive-twilio-sms (1, line 1092),
  retell-proxy (19). All deploy via esbuild `--no-check`; my changes added zero new type errors.

## Owed live behavioral checks → `Docs/TEST_LIST.md` (this session's rows)
LEADREACT-CRASH-1 browser render, INTAKE-RL-1 burst-429, BOOK-TZ-DISPLAY-1 cross-tz SMS, BOOK-CONFIRM-HONESTY-1
forced-failure over-fire watch, SEC-PII-LOGS-1 live-log spot-check, F23 live digest (needs errors in 24h), SCHED-1(b)
next parked probe passes, B2-REPOINT-1 GHL-outage convergence. Plus the still-OWED list from 2026-07-12 (F16b
inside-hours, SMS STOP, MODEL-1-HARDENING backend, F9V2, FOLLOWUP-DURING-CALL-1, RESCHED-SMS-1, PURGE-SIM-1, G3-8a,
HOURS-1 behavioral, PURGE-TAG-1, B-2 deterministic-pick).

## NEXT SESSION — paste this (supervised frozen deploy + Brendan TEST pass)

```
BFD-setter — SUPERVISED frozen-deploy + Brendan live TEST pass. Repo /srv/bfd/Projects/bfd-setter (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env. Live DB via Supabase Management API. Live Retell via api.retellai.com.
NEVER edit voice/text prompt content (report-only). Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Operations/handoffs/2026-07-12-autonomous-build.md (the STAGED frozen bundle + its deploy checklist),
Docs/SESSION_PLAN.md, Docs/TEST_LIST.md.

1) Deploy the STAGED frozen bundle `frozen/voice-booking-bundle` (commit b710eab) in Brendan's supervised Voice
   window, following the FROZEN DEPLOY CHECKLIST in the handoff (read-only Voice smoke first; deploy retell-proxy +
   voice-booking-tools + retell-call-analysis-webhook via deploy_single_fn.mjs; verify a slot-1 push is refused and
   the canonical agents are byte-unchanged; then a live Voice + SMS booking test). Apply PU-14 + PU-6 in the UI.
2) Then run Brendan's remaining live TEST pass (the OWED list): this session's rows (LEADREACT render, INTAKE-RL
   burst-429, BOOK-TZ cross-tz SMS, BOOK-CONFIRM forced-failure, SEC-PII log spot-check, F23 live digest, SCHED-1b
   parked probe, B2-REPOINT-1 outage convergence) + the carried-over legs (F16b inside-hours, SMS STOP,
   MODEL-1-HARDENING backend, F9V2, FOLLOWUP-DURING-CALL-1, RESCHED-SMS-1, PURGE-SIM-1, G3-8a, HOURS-1 behavioral,
   PURGE-TAG-1, B-2 deterministic-pick). Log pass→COMPLETED_LOG / fail→BUG_LIST.
After this, the only remaining step to v1 "100%" is the gated First-Client Milestone (Docs/FIRST_CLIENT_TASKS.md).
```
