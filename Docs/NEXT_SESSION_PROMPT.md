# NEXT SESSION PROMPT (canonical)

**Trigger:** when Brendan says **"run next session prompt"** (or "run the next session prompt"), read this file and
execute the fenced prompt below as the session's instructions. This file is OVERWRITTEN at each session's closeout
with the next session's relay prompt (per the Relay Protocol in `Docs/SESSION_PLAN.md`). Last updated 2026-08-12.

State as of 2026-08-12: the ratified Retell-pivot overnight build SHIPPED in full (four items,
`668eec7`..`c5c5f2d`, tests 514 → 608). Edge functions are deployed. **The frontend push to `github` is
deliberately held** pending one render smoke, which needs a 2FA code. Nothing is broken; `main` is green and
`origin` is current. What remains is Brendan-gated live verification, then back to the standing "zero new
product code until a pilot is paid" rule.

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (plan ON only if a fix touches retell-proxy /
voice-booking-tools / the live cadence runtime).

BFD-setter — verify the 2026-08-12 overnight build, then close it out. Repo /srv/bfd/Projects/bfd-setter,
branch main (git pull first; commit by EXPLICIT path, never git add -A). Supabase ref bjgrgbgykvjrsuwwruoh.
Creds in ./.env (SUPABASE_PAT — VALID as of 2026-08-12; TRIGGER_DEPLOY_PAT; TRIGGER_PROD_API_KEY;
BFD_RETELL_API_KEY). Live DB via the Supabase Management API /database/query (scripts/test-harness/q.mjs),
NOT the postgres MCP. NEVER edit voice/text prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md).
Deploys: edge fns via `node scripts/deploy_single_fn.mjs <slug>` (NEVER deploy_retell_proxy_bundle.mjs — it
bundles index.ts + _shared only and would drop retell-proxy's four function-local siblings); frontend via
`git push github main` AFTER the render smoke. npm test is the only real gate (608 baseline, all passing).
No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Operations/handoffs/2026-08-12-overnight-run.md (what shipped, the trace finding, the gotchas),
then Docs/TEST_LIST.md (rows SNAP-1/2/3, CLONE-1/2, SMS-GHL-1, RENDER-1).

FIRST ACTION: ask Brendan for ONE fresh 6-digit 2FA code. The browser leg is the only thing blocking
closeout, and the app login is magiclink + TOTP with a single-use refresh token. Rebuild the harness in the
session scratchpad (admin generate_link magiclink -> navigate action_link -> fill #mfa_login_code -> save
context.storageState()), then reuse that state for everything else.

THE OWED WORK (all Brendan-gated, in order):
1. RENDER-1 — headless render smoke over Prompt Management, Settings, Dashboard, Account Settings, Clients.
   Frontend changes this run: the Pull toast (PromptManagement), the CopySetterDialog voice->text branch, and
   the deletion of dead PersonalityConstructor.tsx. THEN `git push github main` to release the frontend.
2. SNAP-1 — one real Pull from the UI on a BFD voice setter. Toast must read "Full snapshot saved (vN) ·
   N,NNN char prompt · N tools", not the old "Mirror updated". (retell-proxy requires a USER JWT, so this is
   also the deployed-path check for Item 1.)
3. SNAP-2 — one restore on a throwaway BFD voice slot: Pull first, then restore-retell-config with
   dryRun:true, then for real. Confirm the agent still answers and still has its 5 booking tools. NEVER slot 1
   (SLOT-MAP-1), NEVER slot 9 (Stapleton demo), NEVER a client tenant. API-only: there is no Restore button.
4. SNAP-3 — after that restore, confirm the next hourly pollRetellDrift does NOT flag versionDrifted on the
   restored slot. The re-baseline exists to prevent exactly that and is untested against the live poll.
5. CLONE-1/2 — one voice->text clone from the UI into text setter Setter-2 (seeded 2026-08-12 precisely so
   this never touches the live Setter-1), then read the result as the operator who would ship it.
6. SMS-GHL-1 — one real inbound SMS from a number that is NOT already a CRM lead. receive-twilio-sms was
   redeployed (v32) with its findOrCreateGhlContact repointed at _shared/ghlContact.ts; the boot probe passes
   and the adapter preserves the old contract exactly, but the GHL leg needs a real text.

Pass -> Docs/archive/COMPLETED_LOG.md; fail -> Docs/BUG_LIST.md + fix + retest. Close out per the Relay
Protocol. Then the standing rule resumes: zero new product code until a pilot is paid, with the ONLY
remaining engineering being the event-gated First-Client Milestone ("I'm onboarding a client" ->
Docs/FIRST_CLIENT_MILESTONE.md — do NOT run before a contract signs).

Backlog spawned by this build, do NOT build unprompted: give text setters a prompt_docs row (fixes the
section-editor staleness that makes every voice->text clone carry a do-not-re-save warning); a Restore UI;
delete or guard deploy_retell_proxy_bundle.mjs.

▶ PIPELINE: [✓] v1-finish engineering  [✓] live TEST pass (2026-07-21)  [✓] docs reconciliation (2026-07-22)
[✓] cleanup tail (2026-07-23)  [✓] Retell-pivot overnight build (2026-08-12, four items shipped)
[~] Brendan live-verify of that build (7 rows, browser + one SMS)
[ ] First-Client Milestone (event-gated on a signed contract)
```
