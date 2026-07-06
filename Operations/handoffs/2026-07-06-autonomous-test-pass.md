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

1. **Prompt 2 - voice + browser session (below).** Hybrid: Claude drives the browser-UI + SMS checks
   autonomously via headless Playwright (after ONE 2FA code from Brendan at the start) - the onboarding-fix
   live rows, ACCESS-1, SWEEP-1a/b/c, F9-1, PHONE-CLEAR-1, G3-7 nav, and the CANCEL-1 SMS leg - and Brendan
   does only the true answered-call legs (VOICE GATE, CANCEL-1 voice, in-call SMS meter). (VM-1 already PASSED
   2026-07-05, do NOT redo.) Closes the shared-fn pass, then emits F15.
2. **F15 - client ROI visibility pack** (plan mode; `Docs/TEST_SESSION.md` RUN 10 has the full prompt).
3. **F16 - never-miss-a-lead pack + F17 phase-1 AU compliance** (plan mode; same source). If a demo is
   imminent, F16 before F15.
4. **First-Client milestone** - event-gated (Stripe live, webhook secrets, AU A2P). Not a Claude build session;
   trigger by saying "I'm onboarding a client" (`Docs/FIRST_CLIENT_MILESTONE.md`).

Each session closes out per the Relay Protocol and emits the next. F15/F16 prompts are ready verbatim in
`Docs/TEST_SESSION.md` RUN 10.

---

## NEXT SESSION PROMPT - Prompt 2 (hybrid: Claude drives browser + SMS; Brendan does the phone-call legs)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (Claude drives the browser-UI + SMS checks
autonomously via headless Playwright + the harness; Brendan does ONLY the true answered-phone-call legs;
pre-authorized test-writes below only; NEVER edit prompt CONTENT; NEVER edit/deploy voice-booking-tools or
retell-proxy - frozen live baseline).

BFD-setter - VOICE + BROWSER TEST SESSION (finishes the shared-fn pass). Repo /srv/bfd/Projects/bfd-setter.
Creds ./.env. Supabase ref bjgrgbgykvjrsuwwruoh. No em dashes. Verify read-only before claiming a pass.
READ FIRST: CLAUDE.md "LOGIN ACCESS / 2FA" note, scripts/test-harness/README.md,
Operations/handoffs/2026-07-06-autonomous-test-pass.md (what part 1 already passed - do NOT redo),
Docs/TEST_LIST.md (SoT), and the 2026-07-03 voice-gate baseline in COMPLETED_LOG.md (call_d5625539 /
booking 4f7c76a0). TEST_PHONE_A (+61405482446) only; ask before TEST_PHONE_B.

STEP 0 - LOGIN (do this FIRST, before anything else). This session needs a browser-authenticated agency
session, so ASK BRENDAN FOR A FRESH 6-DIGIT 2FA CODE UP FRONT: "I need a 2FA code to drive the browser -
please open your authenticator." Then establish the headless agency session per the harness README (admin
magiclink generate-link with the service key -> navigate the action_link -> fill the TOTP -> save
context.storageState() to THIS session's scratchpad). Do NOT probe an old token - the refresh token is
single-use and expires ~17h; just drive through the browser and re-save storageState after. Keep the state
warm for the whole session. (Client-role checks below need NO code: make a throwaway client user with a
password, log in via grant_type=password, delete after.)

RUN 0 - self-verify: git in sync; voice-booking-tools=v23, retell-proxy=v49, webhook-manifest=v3,
analyze-chat-history v19 / analytics-v2-process v19 / compute-analytics v16; npm run test:node + deno test
--no-check frontend/supabase/functions/ both green. Confirm the onboarding-fix commits are on github/main
(Railway deployed).

PART A - CLAUDE DRIVES AUTONOMOUSLY (headless Playwright + harness; no human):
A1. Onboarding-fix live rows (from the 2026-07-06 pass): ONBOARD-1 (create a throwaway sub-account via the
    UI AND via the sidebar Add Sub-Account dialog -> SQL use_native_text_engine=true on both; delete after),
    ONBOARD-2 (on a client with NO external Supabase, Create New Setter -> clear "configure external Supabase"
    toast + zero new prompts rows), ONBOARD-3 (placeholders read "Min 12", sidebar <12 password refused),
    GOLIVE-1 UI ("Still missing" line lists the failing checks on a not-ready client).
A2. ACCESS-1 (throwaway CLIENT login, no 2FA): /prompts/voice + /prompts/text redirect like /credentials;
    no Text/Voice Setter sidebar items. Delete the throwaway client + user after.
A3. SWEEP-1a/b/c UI: /account-settings (agency + the throwaway client) no console/network 400 on
    clients_public; /chats star + dismiss persist (assert rows via q.mjs, incl. the client-role RLS write);
    /logs Errors + Bookings + Outbound tabs hydrate names, no uuid 400.
A4. F9-1 + PHONE-CLEAR-1 (browser): with a setter Retell-locked, inline rename via the tile AND the doc-page
    header both refuse, no setter_display_names write (q.mjs); Contacts edit dialog + Chats panel:
    edit/clear/add a phone -> normalized_phone follows/clears/sets (q.mjs). Revert every change.
A5. G3-7: headless-nav the vite-8 bundle (/dashboard, a prompt page, /contacts, /logs, /chats,
    /account-settings) -> no console/module errors.
A6. CANCEL-1 SMS leg: via sms_inbound.mjs, book a NEW appt, then "cancel that meeting" -> assert the cancel
    bound the REAL events[].id (no 404) + bookings.status flips cancelled; reschedule in a 2nd thread ->
    appointment_time moves; force a fabricated-id path (cancel with no prior get-contact-appointments this
    turn) -> refusal, never a false "done". TARGET ONLY appts created in THIS session; clean up by exact id.
    NB: TEST_PHONE_A may hold a live confirmed appt - never cancel one you did not create this session.

PART B - BRENDAN ON THE PHONE (Claude verifies read-only via q.mjs + Retell/GHL REST, calls pass/fail):
B1. VOICE GATE - one answered outbound booking call (Main Outbound / Voice-Setter-master) run to completion
    on v49 + v23 -> bookings row source='voice_call' status='confirmed' at the exact accepted Sydney time (vs
    the 2026-07-03 baseline). If it regresses vs v22, roll voice-booking-tools back to v22 via
    deploy_single_fn.mjs and re-open the shared-fn pass.
B2. CANCEL-1 VOICE - on that call, ask the agent to CANCEL the just-booked appt then RESCHEDULE one -> Claude
    confirms the real events[].id binding (no 404), the appt flipped/moved, no false confirmation.
B3. SMS-METER-1 in-call - have the agent send a mid-call SMS -> Claude confirms a message_queue
    channel='sms_outbound' row was stamped. (VM-1 is NOT owed - passed 2026-07-05.)

CLOSE OUT: mark pass/fail in Docs/TEST_LIST.md; move fully-passed items to COMPLETED_LOG.md, INCLUDING the
shared-fn pass (CANCEL-1/BOOK-2/BOOK-3/SMS-METER-1) out of BUG_LIST once BOTH the SMS/tool half (part 1) AND
the voice half (B1-B3) are green. Commit + push docs to origin + github. Then emit the F15 prompt (from
Docs/TEST_SESSION.md RUN 10). After F15/F16, the only thing left to v1 100% is the event-gated First-Client
Milestone.

▶ PIPELINE (live status in Docs/SESSION_PLAN.md):
[✓] Test session  [✓] Onboarding gate  [✓] Onboarding-fix  [✓] Session S (deployed)
[✓] Autonomous test pass (part 1)  [•] Voice + browser session (here)  [ ] F15  [ ] F16  [ ] First-Client Milestone (gated)
```
