---
description: Combined build session close-out (2026-07-06/07) - cleared all 5 open code bugs (Phase A) + shipped F15 (ROI visibility) + F16 (never-miss-a-lead) + F17 phase-1 (AU compliance), all DEPLOYED LIVE; only the gated First-Client Milestone remains to v1 100%.
---

# Combined build session — bugs + F15 + F16 + F17-p1 — DEPLOYED LIVE (2026-07-06/07)

One mega-session (Brendan's call, not a split relay). Built, committed per item, tested green, and
**deployed everything on Brendan's GO**. 12 commits `8950f69`..`7a0b0b4` on `main` (origin + github).

## What shipped + deployed

**Deploy footprint (all LIVE):**
- **Migrations (4, Mgmt API):** `booking_status_events`, `weekly_reports`, `client_report_config`,
  `clients.recording_disclosure_enabled` + `speed_to_lead_enabled` + `missed_call_textback_enabled`,
  `clients_public` view recreated twice (0 raw secrets leaked, 13 has_* booleans intact — verified).
- **Edge fns:** bookings-webhook **v9**, get-show-rate-funnel **v1 (NEW)**, get-weekly-report **v1 (NEW)**,
  make-retell-outbound-call **v28**, retell-inbound-webhook **v7**, retell-call-webhook **v22**. (Voice-gated:
  make-retell-outbound-call / retell-inbound-webhook / retell-call-webhook — but every new path is behind a
  per-client flag defaulting OFF, so live-call behaviour is UNCHANGED until a client is opted in.)
- **Trigger.dev:** **20260706.1, 13 tasks** (was 12; +weeklyClientReport). Ships Phase A + the AU clamp +
  speed-to-lead in runEngagement/sendFollowup/processMessages/nudgeColdReply/processSetterReply.
- **Frontend:** pushed to github → Railway prod building (live-verify owed).
- Tests at close: **test:node 147/147, test:edge 227/227, vite build green.**

**Phase A — 5 bugs (all fixed + deployed):**
- **CHATS-DM-1** (`8950f69`): `/chats` selected `dm_executions.messages` (absent in live DB) → 400. Now reads
  `setter_messages` (outbound reply string[]) / `grouped_message`.
- **HOURS-1 + FOLLOWUP-DURING-CALL-1** (`3141383`): extracted quiet-hours into ONE shared
  `trigger/_shared/businessHours.ts` (unit-tested); sendFollowup was ungated → now snaps fires_at + re-gates
  at send time; processMessages snaps the initial timer; nudgeColdReply reads the client's cadence_quiet_hours
  (killed the hardcoded 9-20); new-lead node-0 fires its confirmation SMS instantly with hour-aware copy while
  the call defers; sendFollowup + nudgeColdReply now suppress while a live voice call is in progress
  (shared `isVoiceCallActive`). Dead code removed (`b5d903e`/`fef6f93`: the dead Deno `business-hours.ts` +
  `timeUtils.getNextValidTime`).
- **RESCHED-SMS-1** (`3cc34f5`): post-loop honesty guard in processSetterReply — a reply can't claim a
  reschedule/cancel succeeded unless a gated mutation tool returned ok that turn (narrow to reschedule/cancel
  language; skips already-honest hedges; a fresh booking's "all set" is not tripped).
- **CONTACTS-EDIT-DEAD-1** (`0b9b278`): wired the dead Edit dialog to a selection-bar Edit button (shown when
  exactly one contact is selected).

**F15 — client ROI visibility pack (`521c02c` funnel, `c66d339` report):**
- Show-rate funnel: `booking_status_events` transition log (bookings-webhook appends on each status change,
  idempotent); pure `showRateFunnel.ts` (booked→held→no-show + rates, by source + lead source);
  `get-show-rate-funnel` edge fn (role/toggle branched); dashboard + ClientSettings + AccountSettings cards.
  **KEY finding: the live `bookings` table is the phase7a schema** (`ghl_appointment_id`/`appointment_time`/
  `source`/`status`) — `types.ts` is STALE for it; bookings-webhook already matched live (no repair needed).
  No setter_name column live, so the funnel breaks down by booking `source` (voice/sms/etc.), not by named setter.
- Weekly report: `weeklyClientReport` cron (Mon 9am AEST) assembles per-client metrics (calls made/answered,
  SMS conversations, funnel, week minutes/texts) reusing the pure F13/funnel modules cross-dir; persists to
  `weekly_reports`; renders white-label HTML (escaped); **email send gated on RESEND_API_KEY** (stubbed until
  Resend/M1 lands). `get-weekly-report` fn + agency ReportSettingsCard (toggles, "what we improved", live
  preview). Config in the NEW `client_report_config` table (separate from client_pricing_config so the F13
  pricing editor's full-jsonb overwrite can't clobber it; agency-role-gated RLS).
  **Deferred (noted):** top objections (no queryable store) + estimated pipeline value.

**F17 phase 1 — AU compliance (`421f11b` clamp, `b093e03` disclosure):**
- AU Telemarketing-Standard clamp on the shared businessHours module: weekdays 09:00-20:00, Sat 09:00-17:00,
  no Sunday, no national public holiday (2026-2027 const, REVIEW ANNUALLY), intersected with the client window,
  AU-tz only. Every cadence send + voice dial now gates through `isWithinSendingWindow`/`getNextSendingOpening`.
- Recording-disclosure toggle: `clients.recording_disclosure_enabled`; make-retell-outbound-call +
  retell-inbound-webhook inject `{{recording_disclosure}}` ("required"/"not_required") on every call. Spoken
  line is PU-6 (prompt-side); inert until referenced.

**F16 — never-miss-a-lead pack (`7a0b0b4`), all per-client opt-in, default OFF:**
- **F16(b) speed-to-lead:** on a new-lead first-touch node, when `speed_to_lead_enabled`, the phone_call channel
  dials immediately (skips its inter-channel delay), still legal-window gated; out-of-hours fallback is the
  node-0 instant SMS.
- **F16(c) missed-call text-back:** **topology finding — inbound voice is Retell-terminated** (the number is
  "custom"/imported into Retell; NO Twilio voice webhook exists), so this is driven off the Retell call
  disposition in retell-call-webhook (short/abandoned inbound → SMS back into the SMS engine), deduped on caller
  phone, best-effort. NOT a new Twilio webhook.
- **F16(d) live-transfer:** per-setter transfer destination number field in the VoiceRetellSettings tools editor,
  writing `transfer_destination` into the transfer_call tool in general_tools (flows through the FROZEN
  retell-proxy untouched — no proxy edit, no DB column; the Retell agent is the source of truth).
  **Deferred (noted):** the SMS-summary-on-failed-transfer + the transfer prompt line (PU-11) — the failed-transfer
  signal from Retell needs live confirmation before shipping auto-SMS.
- Agency "Calls & compliance" card (ComplianceSettingsCard) toggles all three call flags + disclosure.

## Frozen surfaces respected
retell-proxy + voice-booking-tools were NOT touched. F16(d) transfer config flows through the proxy untouched.

## OWED — Brendan-driven live verification (→ TEST_LIST) + manual steps (→ BRENDAN_TODO)
- Behavioural live pass of all of the above (see TEST_LIST "Combined build" block).
- Enable F16 speed-to-lead + missed-call + F15 funnel/report visibility on the BFD dogfood client to demo them.
- Provision the GHL appointment-status workflow → bookings-webhook so the funnel accrues confirmed/showed/no-show.
- Resend SMTP (M1) → flip the weekly report email from stubbed to live.
- Apply PU-6 (disclosure line), PU-10 (reschedule guidance), PU-11 (transfer line) in the setter UI.

## Next
Only the event-gated **First-Client Milestone** remains to v1 "100%". Nothing auto-runs; when a client signs, say
"I'm onboarding a client" → `Docs/FIRST_CLIENT_MILESTONE.md`.
