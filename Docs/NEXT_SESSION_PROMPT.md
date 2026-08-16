---
description: Canonical next-session relay prompt, regenerated at the 2026-08-17 closeout. The 2026-08-15..17 queue is fully cleared (Cost Ledger LLM-actual live-verified, CLONE-COMPLIANCE-1, demo-callback SLUG cap, breadcrumb, Try-Gary on-silent wiring, ORPHAN-PROJ-1 de-referenced, memory compacted). Remaining non-gated work is the Fable-audit triage, the cost-ledger overage alert, and the DEMO-CB-2 guard legs.
---

# Next session prompt

Paste the fenced block below as the session's instructions.

```
BFD-setter next session. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first; commit by EXPLICIT
path, never git add -A; NO em dashes). Supabase ref bjgrgbgykvjrsuwwruoh; creds in ./.env (SUPABASE_PAT valid);
read the live DB via scripts/test-harness/q.mjs (Supabase Management API), NOT the postgres MCP. NEVER edit
voice/text prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md). Deploys: edge fns
`SUPABASE_PAT=$SUPABASE_PAT node scripts/deploy_single_fn.mjs <slug>`; trigger
`TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy`; frontend `git push github+origin main`
-> Railway (verify by polling `gh api repos/TheBrendonly/BFD-Setter-OS/commits/<sha>/status` then BFS the
served chunk graph at https://app.buildingflowdigital.com for a distinctive string, NOT the entry hash).
npm test is the real gate (~666 passing: node + frontend + edge; tsc baseline 17 pre-existing errors, none
new). VERIFY AGAINST THE RUNNING APP, not green builds. Any browser/UI check needs a FRESH 6-digit 2FA code
from Brendan at the START. Canonical lists: Docs/BUG_LIST.md, FEATURE_ROADMAP.md, Docs/BRENDAN_TODO.md,
Docs/TEST_LIST.md, Docs/DEFERRED.md, Docs/PROMPT_UPDATE_LIST.md; history Docs/archive/COMPLETED_LOG.md;
Relay Protocol in Docs/SESSION_PLAN.md.

The 2026-08-15..17 queue is CLEARED. Remaining NON-GATED work, priority order:

1. FABLE AUDIT TRIAGE (highest value). Brendan is running a read-only whole-project security/quality audit
   (the audit prompt was handed to him in the 2026-08-17 session; re-request it or re-derive from CLAUDE.md +
   Docs/DEFERRED.md "Security hardening"). When the findings come back: verify each against the running system
   (do not trust the claim), then TRIAGE into the right canonical list -> BUG_LIST (code bugs), DEFERRED
   (gated), BRENDAN_TODO (manual/provider), PROMPT_UPDATE_LIST (wording); fix the non-gated code bugs with TDD.
   Do NOT re-raise the already-refuted items: github-proxy SSRF, sync-ghl-contact fail-open.
2. COST LEDGER fast-follows (Docs/DEFERRED.md "Cost Ledger fast-follows"): (a) proactive 80%-overage ALERT via
   a scheduled task (worth building now that LLM cost is real actual, not $0); (b) note per-client
   monthly_cost_ceiling_cents must be set for the cost-vs-ceiling burn-down to activate. SMS Twilio
   settled-price reconciliation stays DEFERRED (client-cost focus).
3. DEMO-CB-2 guard legs (Docs/TEST_LIST.md): opted-out -> 502, after-hours -> 422 decline, per-phone 429 —
   need an opted-out number and/or off-hours to exercise; do when the window/number is available.

Owed by BRENDAN (not Claude): PU-15 = apply the live Setter-2 text-prompt wording via the UI (report-only).
DO NOT START (gated): the First-Client Milestone (Docs/FIRST_CLIENT_MILESTONE.md -> Stripe / subscription
enforcement / live webhook secrets / AU A2P, only when a contract signs); F17 phase 2, F18, F19, F20, F12;
Cloudflare Turnstile (BOTDEF-1 ruled deferred); SMS-actual reconciliation; PII anonymisation post-retention.
```
