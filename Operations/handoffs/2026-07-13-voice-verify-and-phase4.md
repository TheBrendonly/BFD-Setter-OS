---
description: Second half of the 2026-07-13 pre-first-client session — supervised voice window (PU-14/PU-6 applied + live-verified, F24/v25 voice booking PASSED), Phase 4 autonomous legs (INTAKE-RL-1, SMS STOP), a white-screen regression I caused + fixed, and a cache-control hardening. Companion to 2026-07-13-gate-a-rls.md + 2026-07-13-frozen-deploy-readiness.md.
---

# 2026-07-13 — Voice verification + Phase 4 (continuation)

Continues the same session (GATE A + frozen deploy handoffs already written). Brendan supervised the voice
window; the rest ran autonomously per "do all you can."

## Supervised voice window — PASSED
- **Brendan applied PU-14 + PU-6** in the setter UI (Main Outbound + Inbound), agent v26→**v28**. I backed up
  both LLM prompts first (`scratchpad/promptbak_*.json`) and confirmed `speak_after_execution` was already ON
  on both agents (so PU-14 was only the prompt rule). The SETTER CORE editor is a **structured per-subsection
  builder** (not a text box) with no full-prompt override, so I did NOT automate the edit — Brendan pasted it.
- **Live Main Outbound call `call_9ad640407735916a081516f1ec2` (108s) — VERIFIED:** PU-6 disclosure spoken in
  the opener ("I'm Brendan's AI assistant… we might record this for quality — that all good?"); PU-14 held (the
  agent booked via a **real book-appointments call** — `bookings` row source=voice_call — no fabricated "booked");
  **v25 booked cleanly on voice, no ghost**; test appointment cancelled. F24 cadence-end not exercised (the lead
  had no active cadence); code + unit-verified. → the frozen voice bundle is now validated on **both** SMS + voice.

## Phase 4 autonomous legs — PASSED
- **INTAKE-RL-1 burst-429** — 85 CONCURRENT signed intake-lead POSTs on a throwaway client (no GHL → under-limit
  409s at the GHL check, no leads/sends) → 60×409 + **25×429 Retry-After:60** in one window. Note: the limiter is
  a fixed CALENDAR-MINUTE window, so a slow sequential burst won't trip it. Throwaway deleted.
- **SMS STOP/START** — signed inbound STOP recorded an internal opt-out (`lead_optouts`, source=sms_stop); START
  cleared it; a safety-net delete confirmed TEST_PHONE_A is not left opted out.

## Incident I caused + fixed (transparency)
- **White-screen regression (mine).** The GATE-A ticker role-branch referenced `isAgency` inside the exported
  `ClientLayout()` where it wasn't defined → runtime ReferenceError → white screen on every agency route.
  **tsc + vite build did NOT catch it** — and this project's `npx tsc --noEmit` is a NO-OP (root tsconfig
  `files:[]`). Caught only by the headless agency render smoke (once Brendan's 2FA let it run). Fixed `06dbc67`
  (define isAgency from useAuth), re-smoked **4/4** twice. Lesson saved to memory
  (`feedback_frontend_verify_render_smoke`): frontend changes need a render smoke, not tsc/build.
- **Brendan separately hit ERR_TIMED_OUT** on the app — diagnosed as his laptop's network path to Railway
  (`69.46.46.90`, Singapore edge): works from the server + his phone, not his laptop. Prime suspect Tailscale
  exit node / stale DNS (he'll fix later). NOT an app/server issue.
- **Cache-control hardening (`d520930`).** `serve dist -s` served index.html with no Cache-Control, so a bad
  build could stay cached in a browser even after the fix deployed. Added `frontend/public/serve.json`:
  index.html + all SPA routes → `no-cache`; content-hashed `assets/**` → immutable. SPA rewrite preserved
  (verified locally: deep route → 200 + index.html). Applies on the next Railway deploy.

## Verified live-fn / prompt versions after this session
retell-proxy **v53**, voice-booking-tools **v25**, retell-call-analysis-webhook **v28**, fetch-thread-previews /
twilio-list-numbers / supabase-project-usage **v11**, get-openrouter-usage **v2**. Main Outbound agent **v28**
(PU-14/PU-6). 3 GATE-A migrations applied. clients_public is now security_DEFINER.

## Still owed (Brendan) + remaining Phase 4
- **Brendan:** Resend account + DNS (DKIM/SPF) → hand me the API key + sender; I PATCH SMTP + set Trigger
  `RESEND_API_KEY` + run the F14 invite/reset E2E + flip F15 email. Build the reusable GHL reminder-workflow.
  Optional 20s SLOT-MAP-1 UI confirm (guard is code-verified).
- **Remaining harness-able Phase 4 legs** (not yet run): BOOK-TZ-DISPLAY cross-tz SMS, RESCHED-SMS-1,
  FOLLOWUP-DURING-CALL-1, SEC-PII-LOGS-1 log spot-check, F16b inside-hours, MODEL-1-HARDENING backend, F9V2,
  PURGE-SIM/TAG, G3-8a, B2-REPOINT-1 (needs Brendan's OK — overwrites a live secret), plus the 2026-07-12 owed rows.

**Concurrent session note:** another Claude session committed to `main` during this session (Fable rebuild PRD +
a settings allowlist, unrelated); all my work is intact + synced. Committed by explicit path throughout.
After this, v1 remains pre-client-ready; only the event-gated First-Client Milestone (`Docs/FIRST_CLIENT_TASKS.md`)
is left.

## NEXT SESSION — paste this

```
BFD-setter continuation — finish pre-client readiness. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull
first; a CONCURRENT Claude session also commits here — pull + commit by EXPLICIT path, never git add -A).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env. Live DB via Supabase Management API /database/query. Live
Retell via api.retellai.com. NEVER edit voice/text prompt content unless Brendan explicitly permits (report-only
-> Docs/PROMPT_UPDATE_LIST.md). VERIFY READ-ONLY after every change; for FRONTEND changes run the headless render
smoke, NOT tsc/build (this repo's `npx tsc --noEmit` is a NO-OP: root tsconfig files:[]; -p tsconfig.app.json has
pre-existing errors) -- see memory feedback_frontend_verify_render_smoke + scratchpad auth.mjs/agency_smoke.mjs.
No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Operations/handoffs/2026-07-13-voice-verify-and-phase4.md (+ -gate-a-rls + -frozen-deploy-readiness),
Docs/FIRST_CLIENT_TASKS.md, Docs/TEST_LIST.md.

STATUS: All pre-client CODE is DONE + verified (GATE A RLS role-gate + clients_public definer; frozen voice
bundle retell-proxy v53 / voice-booking-tools v25 / retell-call-analysis-webhook v28; PU-14/PU-6 live on agent
v28; cache-control serve.json). Two non-gated readiness items remain (both need Brendan), then the event-gated
First-Client Milestone.

DO (in order):
1. RESEND SMTP (M1) — the last readiness unblock. Brendan: free Resend account -> verify buildingflowdigital.com
   (DKIM/SPF) -> API key. Claude: PATCH Supabase Auth custom SMTP + set RESEND_API_KEY on Trigger prod + report
   recipient (payload in Operations/handoffs/2026-07-02-usage-billing-auth.md); run F14 invite + self-reset E2E
   (12-char min); confirm F15 weekly-report email flips live. -> TEST_LIST / COMPLETED_LOG.
2. GHL REMINDER-WORKFLOW SNAPSHOT — Brendan builds ONE reusable GHL workflow (instant confirm -> 24h reminder w/
   confirm trigger-link -> 2h short -> reschedule links -> showed/no-show status branch). Config, not code.
3. OPTIONAL long-tail Phase 4 behavioral re-tests of already-deployed + code-verified fixes (LOW value; do only
   if desired): BOOK-TZ-DISPLAY cross-tz SMS (gated on a real interstate lead), RESCHED-SMS-1,
   FOLLOWUP-DURING-CALL-1, SEC-PII-LOGS-1 log spot-check, F16b inside-hours, MODEL-1-HARDENING backend, F9V2,
   PURGE-SIM/TAG, G3-8a, B2-REPOINT-1 (needs Brendan's OK, overwrites a live secret). Harness-able ones autonomous.

DO NOT run the First-Client Milestone (Docs/FIRST_CLIENT_MILESTONE.md) until Brendan says "I'm onboarding a
client": GATE B (arm retell_webhook_secret + fail-close the 3 Retell auto-actions), Stripe live +
ENFORCE_SUBSCRIPTION_GATE, AU SMS A2P for +61481614530, per-client provisioning -- all require a signed client.

CLOSE OUT per the Relay Protocol. After 1+2, v1 is fully pre-client-ready; only the First-Client Milestone remains.
```
