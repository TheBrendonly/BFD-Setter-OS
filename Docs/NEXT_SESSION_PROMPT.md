---
description: Canonical next-session relay prompt, regenerated at the 2026-08-16 closeout. The whole DO-NOW build plan + a UI refactor + the Cost Ledger feature shipped and verified live. The "no new product code" rule is LIFTED. Work the remaining queue (cost-ledger fast-follows, CLONE-COMPLIANCE-1, demo SLUG limit, small loose ends), all non-gated.
---

# Next session prompt

Paste the fenced block below as the session's instructions.

```
BFD-setter: the 2026-08-15 DO-NOW plan is fully cleared. Work the remaining non-gated queue below.
Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first; commit by EXPLICIT path, never git add -A).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT is VALID). Live DB via the Supabase
Management API /database/query (scripts/test-harness/q.mjs), NOT the postgres MCP. NEVER edit voice or text
prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md). Deploys: edge fns via
`SUPABASE_PAT=$SUPABASE_PAT node scripts/deploy_single_fn.mjs <slug>`; trigger via
`TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy`; frontend via git push github+origin
main -> Railway (VERIFY a frontend deploy by walking the served chunk graph for a distinctive string, NOT
the entry hash — lazy-chunk changes don't move it; poll `gh api repos/TheBrendonly/BFD-Setter-OS/commits/
<sha>/status` for the Railway build). npm test is the real gate: 648 passing (node 223 + frontend 18 + edge
407); tsc baseline is 17 pre-existing errors, none should be new. No em dashes. Relay Protocol in
Docs/SESSION_PLAN.md.

VERIFY AGAINST THE RUNNING APP, not green builds — this session's repeated lesson (F24 "already deployed",
the sync-ghl-booking lead_id bug, the awaiting_reply clobber all hid behind green tsc/build/tests). For any
frontend change run the headless render smoke (scripts/test-harness/auth.mjs arms the agency login, which
WORKS on the first fresh 2FA code; then a playwright pass loading storageState.json). Any browser/UI check
needs a FRESH 6-digit 2FA code from Brendan at the START — ask for it first.

READ FIRST: Docs/archive/COMPLETED_LOG.md (the 2026-08-16 section, top) for everything that shipped, plus
memories project_cost_ledger_read_surface_2026_08_16, project_booked_lead_suppression_two_engines_2026_08_16,
and feedback_agency_cards_read_clients_public. The "no new product code until a pilot is paid" rule is
LIFTED (Brendan, 2026-08-15) — feature builds are fine.

QUEUE (prioritised, all NON-gated; plan-mode any >30-line/structural item and wait for approval):
  1. Cost Ledger fast-follows (Docs/DEFERRED.md "Cost Ledger fast-follows"): (a) make SMS + LLM cost events
     WRITE to execution_cost_events via buildCostEvent so the ledger is fully actual (today SMS/LLM are
     estimates from cadence_metrics; voice is actual) — this is the biggest one; (b) a proactive 80%-overage
     ALERT (email/push via a scheduled trigger) — v1 only shows the visual flag; (c) note per-client
     monthly_cost_ceiling_cents must be set to activate the cost-vs-ceiling burn-down.
  2. CLONE-COMPLIANCE-1 (code fix): clone-voice-to-text re-asserts voice compliance copy ("call may be
     recorded", spoken-pause) into TEXT prompts. Fix the CODE that generates it (strip voice-only lines when
     the target is a text setter); Brendan still applies PU-15 to the live Setter-2 prompt once.
  3. demo-callback SLUG limit (~5 lines): drop SLUG_MAX_PER_WINDOW to 3/day in demo-callback/index.ts +
     redeploy; update Docs/BRENDAN_TODO.md "bot defense" from an open decision to a recorded ruling
     (Turnstile deferred, 4 un-defer triggers). Turnstile itself stays deferred.
  4. Small loose ends: trim the Lead Sequences page breadcrumb from "All Lead Sequences & Workflows" to
     "All Lead Sequences" (Workflows.tsx usePageHeader, 1 line — the WORKFLOWS tab was retired 2026-08-16);
     optionally wire the 5 Try-Gary cadences' "On silent ->" to Long Tail Nurture (only New-Lead Cadence is
     wired; they're barely-used demo personas); DEMO-CB-2 guard legs still owed (opted-out -> 502,
     after-hours -> 422 decline, per-phone 429) — need off-hours / an opted-out number.
  5. Housekeeping: compact the memory index MEMORY.md to under 17KB (one line per entry); the two orphaned
     Supabase projects (qfbhcixk..., awzlcmd...) still need Brendan to delete them in the console before the
     ORPHAN-PROJ-1 code cleanup.

DO NOT START (gated): the First-Client Milestone (Docs/FIRST_CLIENT_MILESTONE.md — Stripe / subscription
enforcement / live webhook secrets / AU A2P — only when a contract signs); F17 phase 2, F18, F19, F20, F12;
Cloudflare Turnstile; PII anonymisation post-retention. If Brendan says "onboarding a client", switch to
Docs/FIRST_CLIENT_MILESTONE.md instead of this queue.
```
