---
description: Autonomous test pass part 1 close-out (2026-07-06) - shared-fn SMS/tool regression + RLS-SHAPE-1 passed; cancel/voice legs deferred to the supervised voice session; next prompt = Prompt 2 (human voice) then F15 -> F16 -> milestone.
---

# Autonomous test pass (part 1) - close-out (2026-07-06)

Ran the tool-drivable half of the post-deploy regression on the LIVE stack (voice-booking-tools v23 +
Trigger 20260705.1). Harness: signed inbound SMS (`sms_inbound.mjs`), direct tool POST, Mgmt-API SQL
(`q.mjs`). One DB assertion per step.

## Passed (autonomous)
- **BOOK-2 (SMS)** - booked "Tue 7 Jul 3:30pm" → `bookings.appointment_time = 2026-07-07 05:30 UTC` (exact 3:30pm Sydney), confirmed, source sms. Cleaned up by exact GHL id.
- **BOOK-3 (SMS)** - `get-available-slots` returned correct Sydney days with `+10:00` (no day-shift); cycle logged in `tool_invocations`, zero errors/404.
- **SMS-METER-1 (direct tool)** - `send-sms` POST stamped a `message_queue` `channel='sms_outbound'` row (sid `SM449634…`).
- **RLS-SHAPE-1** - policy qual leads with `get_user_role(...) = 'agency'` → client JWT reads 0 rows. CLOSED → COMPLETED_LOG.
- **G3-6-SCHEMA-1** - `analytics-v2-process` cleared its config gate; code hardcodes `chat_history` (v19). Full render owed to a browser run.

## Deferred (correct venue = supervised voice session)
- **CANCEL-1 cancel/reschedule (SMS + voice)** - NOT driven: TEST_PHONE_A holds a live confirmed Jul-8 appointment; an unattended cancel misbind could destroy a real appointment. This is the whole point of CANCEL-1, so it goes to Prompt 2 with Brendan present.
- **VOICE GATE, VM-1** - need an answered call.

## Could not drive (env)
The harness Playwright agency session was gone and its refresh_token got consumed on a validity probe
(GoTrue rotates refresh tokens single-use). So the browser-UI re-checks need a fresh magic-link + ONE TOTP:
SWEEP-1a/b/c UI, F9-1, PHONE-CLEAR-1 UI, G3-7 nav, ACCESS-1, and the onboarding-fix live rows. On the human list.

## Shared-fn close rule
CANCEL-1 / BOOK-2 / BOOK-3 / SMS-METER-1 stay `[~]` in BUG_LIST until the voice half (Prompt 2) also passes.

---

## The relay from here (session by session to v1 100%)

1. **Prompt 2 - HUMAN voice session (below).** Brendan on a live call; Claude verifies read-only. Covers the
   deferred CANCEL-1 cancel/reschedule (SMS + voice), the VOICE GATE booking regression on the v23 stack, and
   SMS-METER-1 in-call. (VM-1 already PASSED 2026-07-05, do NOT redo.) Optionally the human browser click-through
   of the UI re-checks. Closes the shared-fn pass.
2. **F15 - client ROI visibility pack** (plan mode; `Docs/TEST_SESSION.md` RUN 10 has the full prompt).
3. **F16 - never-miss-a-lead pack + F17 phase-1 AU compliance** (plan mode; same source). If a demo is
   imminent, F16 before F15.
4. **First-Client milestone** - event-gated (Stripe live, webhook secrets, AU A2P). Not a Claude build session;
   trigger by saying "I'm onboarding a client" (`Docs/FIRST_CLIENT_MILESTONE.md`).

Each session closes out per the Relay Protocol and emits the next. F15/F16 prompts are ready verbatim in
`Docs/TEST_SESSION.md` RUN 10.

---

## NEXT SESSION PROMPT - Prompt 2 (HUMAN voice session)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (read-only verification only; NEVER edit prompt
CONTENT; NEVER edit/deploy voice-booking-tools or retell-proxy).

BFD-setter - HUMAN-IN-THE-LOOP VOICE TEST SESSION. These are the checks a tool cannot do: a real answered
phone call (a person to speak + listen) + human audio/browser judgment. Brendan performs each physical action;
Claude verifies read-only via Mgmt-API SQL (scripts/test-harness/q.mjs) + the Retell/GHL REST APIs and calls
pass/fail. Repo /srv/bfd/Projects/bfd-setter. Creds ./.env. No em dashes. READ FIRST: Docs/TEST_LIST.md,
Operations/handoffs/2026-07-06-autonomous-test-pass.md (what part 1 already passed - do NOT redo),
Operations/handoffs/2026-07-05-post-deploy-test-prompts.md, and the 2026-07-03 voice-gate baseline in
COMPLETED_LOG.md (call_d5625539 / booking 4f7c76a0) to compare against.

Do these on ONE answered-call session (batch to minimize calls). Brendan uses his own phone / TEST_PHONE_A;
ask before TEST_PHONE_B.

1. VOICE GATE - answered-call booking regression on the CURRENT stack (retell-proxy v49 + voice-booking-tools
   v23). Place ONE outbound booking call (Main Outbound / Voice-Setter-master), run booking to completion.
   Claude verifies: connects, agent uses REAL availability (no fabrication), a bookings row lands
   source='voice_call' status='confirmed' at the exact accepted Sydney time (vs the 2026-07-03 baseline). If it
   regresses vs v22, roll voice-booking-tools back to v22 via deploy_single_fn.mjs and re-open the shared-fn pass.
2. CANCEL-1 (SMS + VOICE) - the deferred half from part 1. (SMS) via sms_inbound.mjs: book, then "cancel that
   meeting", then in a 2nd thread book + "move it to <another listed time>". (VOICE) on the answered call, ask the
   agent to CANCEL the just-booked appt, then RESCHEDULE one. Claude verifies via tool_invocations + GHL: the
   cancel/reschedule bound the REAL events[].id (no 404), the appt flipped cancelled / moved, and a fabricated-id
   attempt was refused with the real list, never a false confirmation. NB: the test lead may hold a live confirmed
   appt - target only the appt created in THIS session and clean up by its exact id.
3. SMS-METER-1 (VOICE) - during the answered call, have the agent send a mid-call SMS to the caller. Claude
   verifies a message_queue channel='sms_outbound' row was stamped (the in-call path; the direct-tool half passed
   in part 1).
4. (VM-1 is NOT owed - it PASSED 2026-07-05 RUN 2, push on all 5 agents + voicemail plays, in COMPLETED_LOG;
   retell-proxy v49 did not touch the voicemail path. Only re-check if you happen to hit voicemail on a call.)
5. Optional browser click-through (part 1 could not drive these - agency Playwright session expired; NOTE most of
   these already PASSED on 2026-07-05 per COMPLETED_LOG, so treat as an optional post-deploy spot-check, NOT owed
   work): SWEEP-1a/b/c
   UI (no console 400 on /account-settings, /chats star+dismiss, /logs names), F9-1 locked-rename refused,
   PHONE-CLEAR-1 Contacts dialog, G3-7 vite-8 nav, ACCESS-1 (client login cannot reach /prompts/voice), and the
   onboarding-fix live rows (ONBOARD-1 flag on a throwaway create, ONBOARD-2 guard, ONBOARD-3 copy, GOLIVE-1
   "Still missing" line). Claude asserts each via q.mjs where possible.

CLOSE OUT: Claude marks pass/fail in Docs/TEST_LIST.md, moves fully-passed items (incl. the shared-fn pass, if
both halves are green) to COMPLETED_LOG.md, commits+pushes docs to origin + github. Then emit the F15 prompt
(from Docs/TEST_SESSION.md RUN 10). After F15/F16, the only thing left to v1 100% is the event-gated
First-Client Milestone.

▶ PIPELINE (live status in Docs/SESSION_PLAN.md):
[✓] Test session  [✓] Onboarding gate  [✓] Onboarding-fix  [✓] Session S (deployed)
[✓] Autonomous test pass (part 1)  [•] Human voice session (here)  [ ] F15  [ ] F16  [ ] First-Client Milestone (gated)
```
