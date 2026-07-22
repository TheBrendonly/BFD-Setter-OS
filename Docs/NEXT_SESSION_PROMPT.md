# NEXT SESSION PROMPT (canonical)

**Trigger:** when Brendan says **"run next session prompt"** (or "run the next session prompt"), read this file and
execute the fenced prompt below as the session's instructions. This file is OVERWRITTEN at each session's closeout
with the next session's relay prompt (per the Relay Protocol in `Docs/SESSION_PLAN.md`). Last updated 2026-07-22.

State as of 2026-07-22: the live TEST pass is COMPLETE and a full documentation reconciliation has run — all 6
lists are open-only truth. `BUG_LIST.md` = 0 open. `TEST_LIST.md` holds only non-blocking residual checks.
GHL booking-sync is fully fixed + end-to-end verified (v16/v17 + all workflow URLs repointed by Brendan).
**Nothing blocks the First-Client Milestone.** This next session is the OPTIONAL non-blocking cleanup tail.

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (plan ON only if a fix touches retell-proxy /
voice-booking-tools / the live cadence runtime).

BFD-setter — OPTIONAL cleanup tail (non-blocking residual checks). Repo /srv/bfd/Projects/bfd-setter, branch main
(git pull first; commit by EXPLICIT path, never git add -A — untracked resurrected files on disk). Supabase ref
bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT; TRIGGER_DEPLOY_PAT; TRIGGER_PROD_API_KEY; TRIGGER_SECRET_KEY).
Live DB via the Supabase Management API /database/query (scripts/test-harness/q.mjs), NOT the postgres MCP. NEVER
edit voice/text prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md). retell-proxy + voice-booking-tools are
the FROZEN voice baseline. Deploys: frontend via `git push github main`; edge fns via a single-slug _shared-bundle
deploy (mirror deploy_with_shared.mjs for one slug); Trigger via `TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx
trigger.dev@4.4.4 deploy` then re-check the 7 prod schedules. VERIFY READ-ONLY before claiming done; npm test is
the only real gate; for FRONTEND changes run the headless render smoke. No em dashes. Relay Protocol in
Docs/SESSION_PLAN.md.
READ FIRST: Docs/TEST_LIST.md (the open-only residual set), Docs/BRENDAN_TODO.md,
Operations/handoffs/2026-07-21-live-test-pass.md.

TRACK A — autonomous (no Brendan): run the TEST_LIST "Claude-drivable" block —
BOOK-CONFIRM-HONESTY-1 forced-failure (throwaway), PURGE-SIM-1 simulator end-to-end, PURGE-TAG-1 (apply the tags
via the GHL API), F15 funnel status-flip (confirmed->showed via the GHL API -> funnel row updates), F15 report
generate, F9V2 locked-setter drift+badge (lock a setter deliberately; config write, not prompt), B2-REPOINT-1
outage convergence (ghl_api_key break/restore is pre-authorized; keep the window short).

TRACK B — if Brendan is present (ask for ONE 2FA code at the start, else skip): the TEST_LIST browser block
(F8 edit-persist + client rate card, F13 summary card both roles, G3-8a, G3-6 residual sub-checks) and any
"Needs Brendan live" rows he wants to clear (F16b inside-hours, F16c after he enables the flag).

OPTIONAL tidy: the pre-existing `dm_executions` 400 on ContactDetail (BRENDAN_TODO, low-pri cosmetic — guard the
`messages`/`setter_messages` select; DM surface has no live traffic; render smoke after). (lead_notes already
removed 2026-07-22.)

Pass -> COMPLETED_LOG; fail -> BUG_LIST + fix + retest. Close out per the Relay Protocol.
Then the ONLY thing left is the event-gated First-Client Milestone — say "I'm onboarding a client" ->
Docs/FIRST_CLIENT_MILESTONE.md + Docs/FIRST_CLIENT_ARMING_RUNBOOK.md (do NOT run before a contract signs).

▶ PIPELINE: [✓] v1-finish engineering  [✓] live TEST pass (2026-07-21)  [✓] docs reconciliation (2026-07-22)
[ ] optional cleanup tail (THIS)  [ ] First-Client Milestone (event-gated on a signed contract)
```
