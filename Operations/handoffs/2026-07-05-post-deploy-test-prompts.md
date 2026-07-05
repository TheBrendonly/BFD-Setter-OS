---
description: Post-build-pass test-session prompts (2026-07-05) - Prompt A autonomous (harness/Playwright) then residual human list; Prompt B the human/supervised voice session.
---

# Post-deploy test prompts (2026-07-05)

Context: the fix-all-bugs BUILD PASS shipped SWEEP-1 a/b/c + SYNC-LOG-1 + G3-6-SCHEMA-1 live, and the frozen
shared-fn pass (CANCEL-1 + BOOK-2 + BOOK-3 + SMS-METER-1, commit `bcecd7b`) was DEPLOYED LIVE 2026-07-05
(voice-booking-tools edge **v23** + Trigger **20260705.1**). Read-only post-deploy smoke passed; the MUTATING
live regression is still owed. `Docs/TEST_LIST.md` is the pass/fail source of truth.

Two sessions: **run Prompt A first** (it does everything a tool can drive, with zero human). Prompt A ends by
printing the residual HUMAN-only checklist; **Prompt B** is that human session (Brendan performs the physical
actions, Claude verifies read-only alongside).

---

## ▶ Prompt A - AUTONOMOUS test session (do everything drivable by tools; end with the human residual)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (read-only + the pre-authorized test-writes
below only; NEVER edit prompt CONTENT; NEVER edit/deploy voice-booking-tools or retell-proxy - they are the
frozen live baseline and were just deployed; this session only TESTS them).

BFD-setter - AUTONOMOUS TEST PASS. Drive every still-owed test that a tool can do (headless Playwright,
the signed-inbound-SMS harness, programmatic Retell dials, Mgmt-API SQL, service-key edge calls) with NO human.
Repo /srv/bfd/Projects/bfd-setter. Creds ./.env. Supabase ref bjgrgbgykvjrsuwwruoh. No em dashes. Verify
read-only before claiming a pass. READ FIRST: scripts/test-harness/README.md (q.mjs / sms_inbound.mjs /
dial.mjs / ext_tables.mjs; reuse the saved agency Playwright storageState - the refresh_token survives ~17h so
usually no new TOTP), Docs/TEST_LIST.md (SoT for pass/fail), Operations/handoffs/2026-07-05-post-deploy-test-prompts.md,
the 2026-07-05 build-pass close-out in Docs/archive/COMPLETED_LOG.md.

RUN 0 - self-verify state (do not trust doc git-logs): git in sync, voice-booking-tools = v23, Trigger =
20260705.1, analyze-chat-history v19 / analytics-v2-process v19 / compute-analytics v16. npm run test:node +
deno test --no-check frontend/supabase/functions/ both green.

Then execute, capturing a DB/Playwright assertion per step, TEST_PHONE_A (+61405482446) only (TEST_PHONE_B is
Brendan's wife - never use it here):

BUILD-PASS RETESTS (all tool-drivable):
1. SWEEP-1a - headless-load /account-settings as AGENCY and as the CLIENT-role user (a client user now exists
   from onboarding) -> the My Account billing card renders, ZERO console/network 400 on clients_public.
2. SWEEP-1b - headless /chats: no 404 for chat_starred / dismissed_error_alerts; star a conversation +
   reload (persists), dismiss a lead-error banner (stays); assert the rows via q.mjs; confirm the client-role
   user can star/dismiss its OWN rows (RLS).
3. SWEEP-1c - headless /logs Errors + Bookings + Outbound-calls tabs -> lead names hydrate, no "invalid input
   syntax for uuid" 400.
4. SYNC-LOG-1 - fire a sync-ghl-contact intake through the harness (x-wh-token) on a throwaway GHL contact ->
   assert exactly one sync_ghl_executions row (client_id/external_id/status/steps) via q.mjs; delete the throwaway.
5. G3-6-SCHEMA-1 - service-key call analyze-chat-history + analytics-v2-process for BFD -> both return results
   off the external chat_history (no "configuration incomplete"); confirm read paths unchanged.

FROZEN SHARED-FN REGRESSION (CANCEL-1 / BOOK-2 / BOOK-3 / SMS-METER-1 - the live MUTATING check owed after the
v23 + Trigger 20260705.1 deploy; do the SMS + direct-tool legs here, leave the answered VOICE call to Prompt B):
6. CANCEL-1 (SMS, harness) - node scripts/test-harness/sms_inbound.mjs to (a) book a meeting, then (b) "cancel
   that meeting", then in a second thread (c) book + "move it to <another listed time>". Assert via q.mjs +
   tool_invocations: the cancel/reschedule bound the REAL GHL events[].id (no 404), bookings.status flips
   cancelled / appointment_time moves; and force a fabricated-id path (a cancel with no prior
   get-contact-appointments this turn) -> the reply is a refusal ("call get-contact-appointments first" /
   event_not_found), never a false "done". Clean up every test appt via the README cancel recipe.
7. BOOK-2/BOOK-3 (SMS, harness) - the same booking flows must land the EXACT accepted Sydney time (no false
   "unavailable", no day-shift). This is the booking-regression half.
8. SMS-METER-1 (direct tool) - POST voice-booking-tools?tool=send-sms&clientId=<BFD> (intake bearer) to
   TEST_PHONE_A with a test body -> assert a NEW message_queue channel='sms_outbound' row
   (ghl_account_id = location id or client uuid, twilio_message_sid set) via q.mjs. (This DOES send one real
   SMS to TEST_PHONE_A - allowed.)

OTHER STILL-OWED TEST_LIST ITEMS THAT ARE TOOL-DRIVABLE:
9. F9-1 residual - headless: with a setter Retell-locked, rename via the tile heading AND the prompt-doc page
   header -> both refuse with a Retell-locked error, no setter_display_names write (assert via q.mjs). Unlock after.
10. PHONE-CLEAR-1 residual - headless Contacts EDIT dialog + the Chats in-chat panel: edit a lead's phone ->
    normalized_phone follows; clear it -> NULL; add a NEW contact via the dialog -> normalized_phone is set
    (assert each via q.mjs).
11. RLS-SHAPE-1 - a client-role JWT read of sms_delivery_events returns 0 rows (shape hardening).
12. G3-7 - headless-nav the vite-8 prod bundle: /dashboard, a setter/prompt page, /contacts, /logs, /chats,
    /account-settings all render with no console/module errors (this is the automatable half of the browser check).

Pre-authorized test-writes: seed+delete throwaway GHL contacts/leads/rows for the above; send ONE SMS to
TEST_PHONE_A per SMS leg; star/dismiss/rename/phone-edit then REVERT every UI change; cancel every test appt.
Revert ALL test writes and delete ALL artifacts at the end (final sweep: 0 residual throwaways).

CLOSE OUT: mark each passed item in Docs/TEST_LIST.md and move the fully-passed ones to
Docs/archive/COMPLETED_LOG.md. For the shared-fn pass, only move CANCEL-1/BOOK-2/BOOK-3/SMS-METER-1 out of
BUG_LIST once BOTH this SMS/tool regression AND Prompt B's voice leg pass. THEN print, as the LAST thing in the
session, a clean "HUMAN-ONLY TESTS STILL OWED" checklist (exactly the Prompt B items below, plus anything that
failed and needs a human) so Brendan knows precisely what only he can run. Commit the TEST_LIST/COMPLETED_LOG
updates (docs only) and push.
```

---

## ▶ Prompt B - HUMAN / supervised voice session (Brendan acts, Claude verifies read-only)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (read-only verification only; NEVER edit prompt
CONTENT; NEVER edit/deploy voice-booking-tools or retell-proxy).

BFD-setter - HUMAN-IN-THE-LOOP VOICE TEST SESSION. These are the checks a tool cannot do: they need a real
answered phone call (a person to speak + listen) and human audio/browser judgment. Brendan performs each
physical action; Claude verifies read-only via Mgmt-API SQL (scripts/test-harness/q.mjs) + the Retell/GHL REST
APIs and calls pass/fail. Repo /srv/bfd/Projects/bfd-setter. Creds ./.env. No em dashes. READ FIRST:
Docs/TEST_LIST.md, Operations/handoffs/2026-07-05-post-deploy-test-prompts.md, and the 2026-07-03 voice-gate
baseline in COMPLETED_LOG.md (call_d5625539 / booking 4f7c76a0) to compare against.

Do these on ONE answered-call session (batch to minimize calls). Brendan uses his own phone / TEST_PHONE_A;
ask before using TEST_PHONE_B.

1. VOICE GATE - answered-call booking regression on the CURRENT stack (retell-proxy v49 + the just-deployed
   voice-booking-tools v23). Place ONE outbound booking call (Main Outbound / Voice-Setter-master), run the
   booking to completion. Claude verifies: the call connects, the agent uses REAL availability (no fabrication),
   a bookings row lands source='voice_call' status='confirmed' at the exact accepted Sydney time (compare to
   the 2026-07-03 baseline). If it regresses vs v22, roll voice-booking-tools back to v22 via deploy_single_fn.mjs
   and re-open the shared-fn pass.
2. CANCEL-1 (VOICE) - on the same (or a second) answered call, ask the agent to CANCEL the appointment just
   booked, then RESCHEDULE one. Claude verifies via tool_invocations + GHL: the cancel/reschedule bound the REAL
   events[].id (no 404), the appointment flipped cancelled / moved, and a fabricated-id attempt (if it happens)
   was refused with the real list, never a false confirmation. This is the voice half of CANCEL-1 that the
   autonomous session could not drive.
3. SMS-METER-1 (VOICE) - during an answered call, have the agent send a mid-call SMS to the caller. Claude
   verifies a message_queue channel='sms_outbound' row was stamped (F13 metering) - the real in-call path the
   direct-tool test only approximated.
4. VM-1 voicemail-lands - place a call that goes to voicemail; confirm the voicemail message actually plays/leaves
   (audio - human ear), and Claude confirms the push landed on the agents read-only.
5. Anything Prompt A flagged as failed-needs-a-human, plus (optional) the human browser click-through of G3-7 on
   app.buildingflowdigital.com if Brendan wants eyes on it.

CLOSE OUT: Claude marks pass/fail in Docs/TEST_LIST.md, moves fully-passed items (incl. the shared-fn pass, if
both halves are green) to COMPLETED_LOG.md, and commits+pushes the doc updates. Then the only things left to v1
100% are F15/F16 and the event-gated First-Client Milestone.
```
