# NEXT SESSION PROMPT (canonical)

**Trigger:** when Brendan says **"run next session prompt"** (or "run the next session prompt"), read this file and
execute the fenced prompt below as the session's instructions. This file is OVERWRITTEN at each session's closeout
with the next session's relay prompt (per the Relay Protocol in `Docs/SESSION_PLAN.md`). Last updated 2026-07-21.

State as of 2026-07-21: the v1-finish loop's **autonomous engineering is complete and deployed** (bookings schema
settled + `types.ts`, REACT-NORMPHONE-1, pre-commit secret hook, CI report job, Spam Act STOP footer, alerting LIVE
to Telegram, 2028 holidays, first-client arming runbook). `BUG_LIST.md` = 0 open. What remains is Brendan-gated: the
live TEST pass, then the event-gated First-Client Milestone. Full detail:
`Operations/handoffs/2026-07-21-v1-finish-loop.md`.

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (plan ON only if a fix touches retell-proxy /
voice-booking-tools / the live cadence runtime).

BFD-setter — CONTINUE the v1 finish loop. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first; a
CONCURRENT session may also commit here — commit by EXPLICIT path, never git add -A: there are untracked resurrected
files on disk). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT; TRIGGER_DEPLOY_PAT=tr_pat
deploy+envvars API; TRIGGER_PROD_API_KEY=tr_prod trigger tasks / list prod schedules; TRIGGER_SECRET_KEY=tr_dev dev
only). Live DB via Supabase Management API /database/query (scripts/test-harness/q.mjs), NOT the postgres MCP. NEVER
edit voice/text prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md). retell-proxy + voice-booking-tools are
the FROZEN voice baseline. Deploys: frontend via `git push github main`; edge fns via a single-slug _shared-bundle
deploy (deploy_single_fn.mjs does NOT bundle _shared); Trigger via `TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx
trigger.dev@4.4.4 deploy` (PIN 4.4.4; @latest aborts on version mismatch), then re-check the 7 prod schedules.
VERIFY READ-ONLY before claiming done; for FRONTEND changes run the headless render smoke, not tsc/build (root tsc
is not a check; frontend/ tsc is a no-op; only `npx tsc --noEmit -p tsconfig.app.json` in frontend/ checks anything,
currently ~17 pre-existing errors). No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Operations/prompts/04-v1-finish-loop.md, Operations/handoffs/2026-07-21-v1-finish-loop.md,
Docs/TEST_LIST.md (owed live legs), Docs/TEST_SESSION.md (RUN 0-9 runbook).

Two tracks:
1. LIVE TEST PASS (Brendan present, phone + ONE 2FA code at the START of the window): run Docs/TEST_SESSION.md
   RUN 0-9, plus this session's 3 owed legs — STOP-footer live send to TEST_PHONE_A (arrives carrying "Reply STOP
   to unsubscribe", not doubled), bookings render-smoke (Chats / ContactDetail / Contact conversation booking
   panels render + now display real bookings on the vite-8 bundle), REACT-NORMPHONE-1 reactivation (normalized_phone
   set -> inbound resolves internal-first). Pass -> COMPLETED_LOG; fail -> BUG_LIST + fix + retest.
2. AUTONOMOUS legs still owed (drive via throwaway clients + the harness, no Brendan): COST-4 RLS, MODEL-1-HARDENING
   backend, SCHED-1(b) parked probe, SEC-PII-LOGS-1 spot-check, PURGE-SIM-1, PURGE-TAG-1, F9V2, BOOK-TZ-DISPLAY-1,
   BOOK-CONFIRM-HONESTY-1, HOURS-1, FOLLOWUP-DURING-CALL-1, RESCHED-SMS-1.

Loop until a full green pass twice in a row with no new findings. Then the only thing left to v1 "100%" is the
event-gated First-Client Milestone — say "I'm onboarding a client" -> Docs/FIRST_CLIENT_MILESTONE.md +
Docs/FIRST_CLIENT_ARMING_RUNBOOK.md (do NOT run it before a contract signs). Close out per the Relay Protocol.

▶ PIPELINE: [✓] v1-finish autonomous engineering (2026-07-21)  [ ] live TEST pass + owed autonomous legs
[ ] First-Client Milestone (event-gated on a signed contract)
```
