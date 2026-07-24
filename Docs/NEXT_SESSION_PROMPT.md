# NEXT SESSION PROMPT (canonical)

**Trigger:** when Brendan says **"run next session prompt"** (or "run the next session prompt"), read this file and
execute the fenced prompt below as the session's instructions. This file is OVERWRITTEN at each session's closeout
with the next session's relay prompt (per the Relay Protocol in `Docs/SESSION_PLAN.md`). Last updated 2026-07-23.

State as of 2026-07-23: the optional cleanup tail is mostly DONE. The `dm_executions` 400 on ContactDetail is
FIXED + render-smoke verified (`f840144`) — ContactDetail now logs ZERO console errors. Six residual tests PASSED
autonomously (F9V2, F15 funnel, F15 report, PURGE-TAG-1, PURGE-SIM-1, G3-6, G3-8a) → `COMPLETED_LOG.md` (2026-07-23).
`BUG_LIST.md` = 0 open. **Nothing blocks the First-Client Milestone.** What remains below is a SHORT belt-and-braces
residual that needs Brendan present (real SMS number / forced-failure / a second-role login) — all optional.

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (plan ON only if a fix touches retell-proxy /
voice-booking-tools / the live cadence runtime).

BFD-setter — OPTIONAL residual tail (needs Brendan; all belt-and-braces, nothing blocking). Repo
/srv/bfd/Projects/bfd-setter, branch main (git pull first; commit by EXPLICIT path, never git add -A — untracked
resurrected files on disk). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT; TRIGGER_DEPLOY_PAT;
TRIGGER_PROD_API_KEY; TRIGGER_SECRET_KEY). Live DB via the Supabase Management API /database/query
(scripts/test-harness/q.mjs), NOT the postgres MCP. NEVER edit voice/text prompt CONTENT (report-only ->
Docs/PROMPT_UPDATE_LIST.md). retell-proxy + voice-booking-tools are the FROZEN voice baseline. Deploys: frontend via
`git push github main`; edge fns via a single-slug _shared-bundle deploy (mirror deploy_with_shared.mjs for one
slug); Trigger via `TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy` then re-check the 7 prod
schedules. VERIFY READ-ONLY before claiming done; npm test is the only real gate; for FRONTEND changes run the
headless render smoke. No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/TEST_LIST.md (open-only residual set), Docs/BRENDAN_TODO.md,
Operations/handoffs/2026-07-23-cleanup-tail.md.

REMAINING (all need Brendan; skip any you don't want to bother with — none blocks v1):
- BOOK-CONFIRM-HONESTY-1 — force a book-appointments failure over SMS (throwaway SMS-wired client OR a supervised
  break of BFD's live booking) → confirm the honest holding reply, not a false "you're booked". Mechanism already
  evidenced live (RESCHED-SMS-1).
- B2-REPOINT-1 — outage convergence: with a SAFE non-CRM number Brendan controls, GHL-outage sim (break/restore
  ghl_api_key, short window) → inbound after recovery converges the bfd-<phone> lead to the real GHL id, reply not
  dropped. (Needs a real SMS number; by-phone convergence already verified in prior sessions.)
- F8 behavioral leg — Cost-to-Price Calculator edit/Save/reload persists + blended $/min hand-check; show-rate-to-
  client ON → client-role login sees the read-only rate card, OFF → gone. (Panel render already verified.)
- F13 content leg — confirm the agency margin one-liner text on the ChatAnalytics dashboard, and a client login
  sees only toggled parts. (Dashboard render already verified.)
- (If Brendan wants) the "Needs Brendan live" phone rows: F16b inside-hours 60s call, F16c missed-call text-back
  (enable missed_call_textback_enabled first), F16d transfer, B-5 unknown-caller voice.
- (Housekeeping, M3) n8n Railway shutdown is now FULLY UNBLOCKED: the simulator was repointed off the n8n
  simulation_webhook to the native process-setter-reply engine on 2026-07-24 (`4518408`), so nothing depends on
  n8n any more. Brendan can remove the Railway n8n service whenever he likes.

Browser session note: access is non-persistent (magiclink + TOTP). If a browser leg is needed, ASK BRENDAN FOR ONE
6-DIGIT 2FA CODE at the start; a client-role check can instead use a throwaway password client (no 2FA).

Pass -> COMPLETED_LOG; fail -> BUG_LIST + fix + retest. Close out per the Relay Protocol.
Then the ONLY thing left is the event-gated First-Client Milestone — say "I'm onboarding a client" ->
Docs/FIRST_CLIENT_MILESTONE.md + Docs/FIRST_CLIENT_ARMING_RUNBOOK.md (do NOT run before a contract signs).

▶ PIPELINE: [✓] v1-finish engineering  [✓] live TEST pass (2026-07-21)  [✓] docs reconciliation (2026-07-22)
[~] optional cleanup tail (dm_executions fixed + 6 residual PASS 2026-07-23; short Brendan-gated tail remains)
[ ] First-Client Milestone (event-gated on a signed contract)
```
