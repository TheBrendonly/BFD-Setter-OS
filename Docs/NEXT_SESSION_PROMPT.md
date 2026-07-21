# NEXT SESSION PROMPT (canonical)

**Trigger:** when Brendan says **"run next session prompt"** (or "run the next session prompt"), read this file and
execute the fenced prompt below as the session's instructions. This file is OVERWRITTEN at each session's closeout
with the next session's relay prompt (per the Relay Protocol in `Docs/SESSION_PLAN.md`). Last updated 2026-07-21 (evening).

State as of 2026-07-21 (evening): the v1-finish **live TEST pass is COMPLETE**. All three owed legs (STOP-footer,
bookings render-smoke, REACT-NORMPHONE-1) PASSED, plus the answered voice-booking regression and the autonomous
batch (COST-4, SCHED-1(b), MODEL-1-HARDENING, FOLLOWUP-DURING-CALL-1, HOURS-1 a/d, BOOK-TZ-DISPLAY-1, RESCHED-SMS-1,
LIVE-D). Two fixes shipped: SEC-PII-LOGS-1 residual (Trigger 20260721.3) and the `sync-ghl-booking` GHL
standard-payload parser (v16/v17, END-TO-END verified) + a new `sync_ghl_booking_executions` audit table.
`BUG_LIST.md` = 0 open. Full detail: `Operations/handoffs/2026-07-21-live-test-pass.md`.

**What remains to v1 "100%":** (1) a few NON-BLOCKING deferred autonomous checks + one pre-existing frontend bug;
(2) some GHL-UI cleanup only Brendan can do (`BRENDAN_TODO.md` 2026-07-21 section); (3) the event-gated First-Client
Milestone. None of (1)/(2) blocks onboarding a client.

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (plan ON only if a fix touches retell-proxy /
voice-booking-tools / the live cadence runtime).

BFD-setter — v1 finish loop CLEANUP tail (non-blocking). Repo /srv/bfd/Projects/bfd-setter, branch main (git pull
first; commit by EXPLICIT path, never git add -A — untracked resurrected files on disk). Supabase ref
bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT; TRIGGER_DEPLOY_PAT; TRIGGER_PROD_API_KEY; TRIGGER_SECRET_KEY).
Live DB via the Supabase Management API /database/query (scripts/test-harness/q.mjs), NOT the postgres MCP. NEVER
edit voice/text prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md). retell-proxy + voice-booking-tools are
the FROZEN voice baseline. Deploys: frontend via `git push github main`; edge fns via a single-slug _shared-bundle
deploy (mirror deploy_with_shared.mjs for one slug — see the 2026-07-21 deploy_sgb.mjs pattern); Trigger via
`TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy` then re-check the 7 prod schedules. VERIFY
READ-ONLY before claiming done; npm test is the only real gate; for FRONTEND changes run the headless render smoke.
No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Operations/handoffs/2026-07-21-live-test-pass.md, Docs/TEST_LIST.md, Docs/BRENDAN_TODO.md (2026-07-21).

Autonomous, no Brendan needed (throwaway clients + the harness):
1. BOOK-CONFIRM-HONESTY-1 dedicated forced-failure — force a book-appointments failure over SMS on a throwaway and
   confirm the honest holding message (already evidenced by RESCHED-SMS-1; this is the belt-and-braces).
2. PURGE-SIM-1 — run the simulator end-to-end (generate-simulation-personas + run-simulation v21): personas + a short
   sim, new dummy leads are bfd-simulation-*, OpenRouter calls succeed.
3. PURGE-TAG-1 — apply a legacy 1prompt-try-gary-<style> tag + a bfd-try-gary-<style> tag to a throwaway GHL contact
   (ghl-tag-webhook v14) → agent_style/source_type derive identically.
4. lead_notes pre-existing bug — DECISION with Brendan first (create the table vs remove the notes UI); it 400s on
   every ContactDetail open. If "create the table", mirror it + regen types.ts; if "remove", strip LeadNotesPanel.

Then the ONLY thing left is the event-gated First-Client Milestone — say "I'm onboarding a client" ->
Docs/FIRST_CLIENT_MILESTONE.md + Docs/FIRST_CLIENT_ARMING_RUNBOOK.md (do NOT run before a contract signs). Close
out per the Relay Protocol.

▶ PIPELINE: [✓] v1-finish autonomous engineering  [✓] live TEST pass + owed autonomous legs (2026-07-21)
[ ] non-blocking cleanup tail (optional)  [ ] First-Client Milestone (event-gated on a signed contract)
```
