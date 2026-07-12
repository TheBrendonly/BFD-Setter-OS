---
description: Handoff for the 2026-07-12 BRENDAN test + build-unblock session. STEP-1 unblock done (F21b = AI-sourced-only); a live test pass surfaced 3 new code bugs (2 booking-integrity, 1 frontend crash) + 2 prompt items; emits the AUTONOMOUS BUILD session prompt.
---

# 2026-07-12 — BRENDAN test + build-unblock session

Model Opus 4.8 [1m]. Brendan present for the live phone/SMS/browser legs; Claude drove verification via the
harness (headless Playwright + signed inbound-SMS sim + service-key dials + Mgmt-API SQL + Retell REST). Two TOTP
codes. This was the "clear my testing + manual todos AND pre-clear the autonomous build session" session: it
completed STEP 1 (unblock) and a PARTIAL STEP 2 (live test pass) which surfaced significant booking-integrity
bugs, then hands off to the AUTONOMOUS BUILD session (prompt at the end).

## STEP 1 — build-session unblock (DONE)
- **F21(b) DECISION = AI-sourced-only.** The ROI funnel + weekly-report `booked` headline must count only
  setter-created bookings (voice/SMS/cadence) and EXCLUDE `source='ghl_calendar'` human-booked appts. No secondary
  "all appointments" line requested. Recorded on `FEATURE_ROADMAP.md` F21 + `Docs/BRENDAN_TODO.md`.
- **F16/F17 dogfood flags:** speed-to-lead (F16b) + recording-disclosure (F17) already ON on the BFD client
  (`e467dabc`); missed-call text-back (F16c) left OFF (behaviorally inert until GATE B arms `retell_webhook_secret`).
- **elevenlabs-manage-agent:** already undeployed 2026-07-11 (verified gone: not among the 96 live fns). BRENDAN_TODO
  row reconciled (was stale-open).

## STEP 2 — live test pass (PARTIAL; the headline is 2 booking bugs)

### PASS -> `COMPLETED_LOG.md` (2026-07-12)
- **Browser (headless, agency login):** F8 Cost-to-Price panel renders (markup 300 / FX 1.52 / Retell 0.07 / LLM
  0.003); F13 margin card renders for agency (Billed $8.22 / Cost $3.60 / Margin $4.62 56.2%); **F15 show-rate
  funnel renders** (10 booked / 8 cancelled / 2 upcoming, sms 6 + Voice 4); API-DEPR-1 Agents tab (24 agents, one
  row each, name/version/PUBLISHED); CHATS-DM-1 (/chats, no `dm_executions...messages` 400); UI-1 (Setter 1..4).
  0 secret-in-payload leaks across all pages. (Note: headless `functions.invoke` to `check-client-subscription`
  logs a benign "Failed to fetch" = CORS/headless artifact; the fn is ACTIVE v19 + returns 401 on a direct call,
  so NOT a bug.)
- **SMS booking (signed inbound sim -> live Twilio reply to TEST_PHONE_A):** BOOK-1 offer (real slots, no
  fabricated "booked out"), booking completes on an explicit accept, SMS-OBS-1 (tool_invocations persisted with
  args/result/error, source=sms), MODEL-1 (reply, no 400), BOOK-3 day-mapping (13 Jul = Monday, no day-shift).
- **Voice:** B-5 (inbound from `anonymous`/withheld -> agent greets with NO name, `first_name=''`, never says the
  literal `{{first_name}}`); the **Inbound BFD Agent DOES speak the recording disclosure** ("this call is being
  recorded for quality"); VM-1 voicemail DETECTION works (`voicemail_reached` / `in_voicemail=true`) - the message
  itself is Retell-side config (Brendan marked done); a linked-lead redial BOOKED cleanly (book-appointments ->
  `{ok:true}` -> real appt, honest confirmation).
- **F16b outside-hours:** DATA-verified against the real gate (`businessHours.isWithinSendingWindow` for now =
  Sunday 16:32 Sydney -> false via `AU_LEGAL_WINDOWS[7]=null`; dial defers to Mon 09:02; the node-0 confirmation
  SMS is hours-exempt per `runEngagement.ts:1041-1042`).

### NEW BUGS -> `BUG_LIST.md` (the build session builds/stages these)
- **BOOK-VOICE-FABRICATE-1 (High, voice).** The Main Outbound agent INTERMITTENTLY confirms a booking WITHOUT
  calling `book-appointments`. Two back-to-back calls on the SAME agent+prompt: call_189be0af "confirmed" a 2:30pm
  booking ("you'll get a confirmation email") with ZERO booking-tool calls (Retell `tool_calls` = only `end_call`),
  no appt, no email = pure fabrication; call_bb3a8f81 called the tool -> `{ok:true}` -> real appt + honest confirm.
  The success envelope is fine (`{ok:true}`), so this is the agent skipping the tool, not a return-shape defect.
  PRIMARY fix = Retell PROMPT (PU-14, Brendan). Code backstop = the SMS-fallback below.
- **BOOK-ABORT-GHOST-1 (High, booking; FROZEN voice-booking-tools -> STAGE not deploy).** On the SMS side, a
  `book-appointments` ~30s tool-caller ABORT returned an error to the setter (which then fabricated "that 8am slot
  just got snapped up") BUT the GHL write had SUCCEEDED -> a real ghost appointment (f38333fa). The lead ended with
  two appointments believing they had one. Fix (per Brendan directive): (a) idempotency + (b) never emit "snapped
  up" from a tool error + (c) retry the booking exactly ONCE on failure/abort + (d) on FINAL failure text the lead
  a self-serve GHL calendar booking link (`toolSendSms`) as a backstop. Bundle with the frozen deploy.
- **LEADREACT-CRASH-1 (Medium, frontend; non-frozen -> deploy).** `/lead-reactivation` white-screens for EVERY
  client: `LeadReactivation.tsx` reads `totals.totalSends/totalResponses/totalPositive/totalBookings/clients`
  which `useReactivationData` never defines -> `formatNum(undefined).toLocaleString()` throws. Compute the missing
  aggregates + harden `formatNum` to `(n)=>(n??0).toLocaleString()`.

### NEW PROMPT ITEMS -> `PROMPT_UPDATE_LIST.md` (Brendan applies via Prompt Management; report-only)
- **PU-14 (HIGH)** — booking tool-call gate: the agent must call book-appointments and must NOT say "booked /
  confirmation email coming" unless it returned ok:true this turn; verify the Retell tool config
  (`speak_after_execution` on, no canned success line). Fixes BOOK-VOICE-FABRICATE-1's root cause.
- **PU-6 re-verify** — recording disclosure fires on the INBOUND agent but NOT on Main Outbound (both got
  `recording_disclosure='required'`; only Inbound spoke it). Add/fix the `{{recording_disclosure}}` line on Main
  Outbound (Inbound is the working reference).

### OWED (a future test pass; NOT the build session's job)
F16b inside-hours 60s auto-call (needs a weekday enrollment), SMS STOP mid-exchange, MODEL-1-HARDENING backend
(throwaway client bad `llm_model`), F9V2-1/2 (needs a genuinely locked setter), FOLLOWUP-DURING-CALL-1,
RESCHED-SMS-1, PURGE-SIM-1, G3-8a (reactivation execute + no browser secret), HOURS-1 (a/d) behavioral,
PURGE-TAG-1, B-2 deterministic GHL pick (needs >1 GHL contact staged — TEST_PHONE_A already has 3, so stageable).

## Live state at close
- **No product code deployed this session** (test-only). Live fns unchanged: retell-proxy **v52**, process-lead-file
  **v18**, Trigger **20260711.1**. Docs-only commit.
- **Calendar clean:** the 3 SMS test appts + 1 voice redial appt all cancelled in GHL + mirrored; the real
  **14 Jul 1:30pm** (f302d0bd) is untouched. No client/lead residue (throwaway users deleted; setter_stopped all
  false; probe tz Australia/Brisbane).
- Harness gained `scripts/test-harness/cancel_appt.mjs` + `verify_booking.mjs`; the headless-auth flow
  (`auth_prime.mjs`/`auth_mfa.mjs` = API magic-link + MFA-verify -> storageState) lives in the SESSION scratchpad
  (single-use, does not carry over).

## What the AUTONOMOUS BUILD session must build/stage (re-derive live, but these are the known open set)
- **Deploy (non-frozen):** INTAKE-RL-1, BOOK-TZ-DISPLAY-1, BOOK-CONFIRM-HONESTY-1, **LEADREACT-CRASH-1 (new)**,
  SEC-PII-LOGS-1, SEC-OPENROUTER-PII-1, SEC-GHPROXY-1, F21 (a+b, b=AI-sourced-only), F22, F23 (Slack; email
  Resend-gated), F25.
- **BUILD + STAGE (frozen, DO NOT deploy):** SLOT-MAP-1, F24, **BOOK-ABORT-GHOST-1 (new, retry+idempotency+SMS
  fallback)**, and the **BOOK-VOICE-FABRICATE-1** code backstop (all in voice-booking-tools) -> one frozen bundle +
  a deploy checklist for Brendan's supervised Voice window.
- **Do NOT touch:** GATE A/B + first-client cluster (`Docs/FIRST_CLIENT_TASKS.md`); prompt content (PU-*).

## NEXT SESSION — paste this (AUTONOMOUS BUILD, plan OFF, unattended)

```
BFD-setter — AUTONOMOUS BUILD session: close out every open bug + buildable feature. Plan OFF, unattended.
Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first — a concurrent session has been active).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com.
NEVER edit voice/text prompt content (report-only; log prompt items to Docs/PROMPT_UPDATE_LIST.md).
Verify read-only after every deploy (live version / policy / boot) — tsc + deploy + push are necessary,
not sufficient. No em dashes. Follow the Relay Protocol in Docs/SESSION_PLAN.md.

READ FIRST: Docs/SESSION_PLAN.md, the latest Operations/handoffs/ doc (2026-07-12-brendan-test-session.md),
Docs/BUG_LIST.md, FEATURE_ROADMAP.md, and Docs/FIRST_CLIENT_TASKS.md (so you know what NOT to touch). Also read
Docs/BRENDAN_TODO.md for the recorded F21(b) decision (= AI-sourced-only).

SETUP FIRST (before you start building): ask Brendan for ONE fresh 6-digit 2FA code and stand up the headless
Playwright auth, so you can browser-verify UI changes AS you build (e.g. confirm the LEADREACT-CRASH-1 fix actually
renders /lead-reactivation instead of white-screening, and smoke any other frontend change). Working flow (proven
2026-07-12): admin POST {SUPABASE_URL}/auth/v1/admin/generate_link {type:"magiclink",email:brendan@buildingflowdigital.com}
with the service key -> POST /auth/v1/verify (apikey=anon) with the returned token_hash for an aal1 session -> POST
/auth/v1/factors/{totp_factor_id}/challenge then /verify {challenge_id, code} for aal2 -> write storageState.json
(localStorage key sb-<ref>-auth-token = the aal2 session JSON) -> drive Playwright 1.61.1 with the cached Chromium at
~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome (launch --no-sandbox). Ask for the code ONCE up front and
re-save storageState after the first refresh (the refresh token is single-use). If Brendan is not around to give a
code, build headless anyway and leave the browser-UI confirmations as TEST_LIST rows.

GOAL: build + deploy + verify EVERY open item that is (a) non-frozen and (b) NOT first-client-gated. Known open set
(re-derive live + build anything else open too):
  BUGS: INTAKE-RL-1 (bump_rate_limit on intake-lead, campaign-enroll-webhook pattern), BOOK-TZ-DISPLAY-1 (wire the
    dead formatSlotInZone in trigger/processSetterReply.ts; drop the model tz-arithmetic instruction),
    BOOK-CONFIRM-HONESTY-1 (extend rescheduleHonestyGuard to NEW bookings), and the NEW 2026-07-12 items:
    LEADREACT-CRASH-1 (frontend; DB Reactivation white-screen — deploy), SEC-PII-LOGS-1 / SEC-OPENROUTER-PII-1 /
    SEC-GHPROXY-1 (2026-07-12 red-team, non-frozen).
  FEATURES: F21 (a: dedupe sync-ghl-booking onto ghl_appointment_id; b: scope funnel/weekly `booked` to AI-sourced
    sources per Brendan), F22 reporting-health assertion, F23 proactive error_logs failure digest (Slack now; EMAIL
    leg behind the same RESEND_API_KEY check F15 uses), F25 funnel cohort/event-window fix.

METHOD (per item): TDD where sensible -> implement surgically -> tsc/deno/tests green -> deploy the right way
  (deploy_single_fn.mjs for non-frozen edge fns, Mgmt API for migrations, npx -y trigger.dev@4.4.4 deploy --env prod
  for Trigger) -> verify read-only (live version ACTIVE / policy / probe) -> ONE commit per item by EXPLICIT path
  (never git add -A — a concurrent session may be editing docs).

DO NOT (out of scope):
  - Frozen baseline (retell-proxy, voice-booking-tools): BUILD + STAGE only, leave undeployed. The frozen bundle =
    SLOT-MAP-1 + F24 + BOOK-ABORT-GHOST-1 (retry + idempotency + never-"snapped-up" + SMS booking-link fallback) +
    the BOOK-VOICE-FABRICATE-1 code backstop — all in voice-booking-tools. Ship code + tests + a deploy checklist in
    the handoff; do NOT deploy headless (Brendan's supervised Voice window).
  - First-client-gated (Docs/FIRST_CLIENT_TASKS.md): GATE A/B, F17 phase 2, F18/F19/F20, F12, Resend/Stripe/A2P/
    onboarding.
  - Prompt content (PU-*, report-only). BOOK-VOICE-FABRICATE-1's PRIMARY fix is PU-14 (Brendan) — you build the code
    backstop only.

CLOSE OUT (Relay Protocol): for each shipped item add a live-verification row to Docs/TEST_LIST.md, move the code
  item to Docs/archive/COMPLETED_LOG.md, update Docs/SESSION_PLAN.md, write a dated Operations/handoffs/ doc (what
  shipped + live versions + the STAGED frozen bundle + its deploy checklist). Commit per item by explicit path; push
  origin + github. Emit the next prompt: the supervised frozen-deploy + Brendan's remaining live TEST pass (the OWED
  list in this handoff).
```
