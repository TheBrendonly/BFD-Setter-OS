# NEXT SESSION PROMPT (canonical)

**Trigger:** when Brendan says **"run next session prompt"** (or "run the next session prompt"), read this file and
execute the fenced prompt below as the session's instructions. This file is OVERWRITTEN at each session's closeout
with the next session's relay prompt (per the Relay Protocol in `Docs/SESSION_PLAN.md`). Last updated 2026-07-13.

```
BFD-setter continuation — finish pre-client readiness. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull
first; a CONCURRENT Claude session also commits here — pull + commit by EXPLICIT path, never git add -A).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env. Live DB via Supabase Management API /database/query. Live
Retell via api.retellai.com. NEVER edit voice/text prompt content unless Brendan explicitly permits (report-only
-> Docs/PROMPT_UPDATE_LIST.md). VERIFY READ-ONLY after every change; for FRONTEND changes run the headless render
smoke, NOT tsc/build (this repo's `npx tsc --noEmit` is a NO-OP: root tsconfig files:[]) -- see memory
feedback_frontend_verify_render_smoke + scratchpad auth.mjs/agency_smoke.mjs. No em dashes. Relay Protocol in
Docs/SESSION_PLAN.md.
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
