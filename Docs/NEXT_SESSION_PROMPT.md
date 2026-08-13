---
description: Canonical next-session relay prompt, regenerated at the 2026-08-13 evening closeout. The login is fixed and the frontend is released; finish the two remaining live legs (SMS-GHL-1 and the DEMO-CB real-call runbook), then work the Claude-Code queue.
---

# Next session prompt

Paste the fenced block below as the session's instructions.

```
BFD-setter: finish the last two owed live legs, then work the Claude-Code queue.
Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first; commit by EXPLICIT path, never git add -A).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT is VALID). Live DB via the Supabase
Management API /database/query (scripts/test-harness/q.mjs), NOT the postgres MCP. NEVER edit voice or text
prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md). Deploys: edge fns via
`node scripts/deploy_single_fn.mjs <slug>`, and NEVER deploy_retell_proxy_bundle.mjs (it bundles index.ts +
_shared only and would drop retell-proxy's four function-local siblings). npm test is the only real gate:
608 baseline, all passing. No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Operations/handoffs/2026-08-13-mfa-unblocked-owed-legs.md, then Docs/TEST_LIST.md.

THE LOGIN IS FIXED. As of 2026-08-13 evening the headless agency login works and MFA-LOGIN-1 is CLOSED. Do
NOT rebuild auth.mjs. `node scripts/test-harness/auth.mjs <scratchdir>` arms and waits; ask Brendan to fire
ONE fresh 6-digit code with `echo 123456 > <scratchdir>/totp.txt`; it saves storageState.json to that dir.
ONE prereq that bit the last three sessions: playwright-core is NOT committed (gitignored node_modules), so
if auth.mjs throws ERR_MODULE_NOT_FOUND run `npm install --no-save playwright-core` (browser download
skipped, cached Chromium reused). Scratchpad scripts that import playwright-core need the repo node_modules
on the ESM resolution path: symlink it, ln -s <repo>/node_modules <scratch>/node_modules. If a session will
drive the browser, ASK BRENDAN FOR A FRESH 2FA CODE AT THE START. Note: server-side aal2 is never checked
(_shared/assert-client-access.ts), so only browser-UI legs need the elevated session; retell-proxy actions
(pull/restore) need an AGENCY user JWT (pull it from storageState localStorage sb-<ref>-auth-token), not the
service key. Retell MCP key is invalid (401): use BFD_RETELL_API_KEY from .env against api.retellai.com.

TWO OWED LIVE LEGS REMAIN (everything else from the 2026-08-12 build passed 2026-08-13, see COMPLETED_LOG):

1. SMS-GHL-1: one real inbound SMS from a number that is NOT already a CRM lead, to +61481614530, so it
   exercises the GHL contact leg. Confirm the lead resolves to a REAL GHL contact id (not bfd-<phone>) and the
   reply goes out. TEST_PHONE_B +61403804263 was confirmed non-CRM and pre-approved by Brendan last session
   but not sent; re-confirm the chosen number is still non-CRM, ask Brendan to text it, then watch leads.

2. DEMO-CB-1/2: run the TickTick task "RUN: DEMO-CB-1 demo-callback dry run (bfd-setter, Claude-assisted)" in
   the bfd-setter project. It is a step-by-step runbook: Brendan submits /g/stapleton-finance-b7q4 on his
   phone and answers Gary's real callback; you verify each step (landing up, lead has a real GHL id +
   bfd-demo-callback tag, call fired, booking landed on BFD's GHL calendar, confirmation email arrived). The
   landing render and the unknown-slug 404 already PASSED. Must be within 8am-8pm AEST. Cancel the test
   booking afterwards.

Pass -> Docs/archive/COMPLETED_LOG.md; fail -> Docs/BUG_LIST.md + fix + retest. Close out per the Relay
Protocol. The standing rule holds: zero new PRODUCT code until a pilot is paid; tooling, infra and
verification are fine.

THEN, ONLY IF THE TWO LEGS ABOVE ARE CLOSED, work this queue in order (Claude Code's job, not Brendan's or
Cowork's):

  A. Verify /try-gary GHL-to-cadence wiring end to end (TickTick, same title). Read-only tracing plus a live
     probe. No new code, not gated. Do this first, it is verification.
  B. Slot 10 name drift on the BFD client (TickTick, same title). Read the live rows before proposing; slot 9
     orphan is already RESOLVED, so confirm what is actually still drifting.
  C. Greenserver: build_card.py fixes found by the E2E test (TickTick, same title; ~30 lines: source line +
     headline anchor + --reuse-plate + footer margin). Different project, content-pipeline tooling.
  D. Rebuild the Projects -> Notion docs mirror (TickTick "Claude Code on greenserver: rebuild the Projects ->
     Notion docs mirror, ~90 min, plan mode"). Plan mode, confirm the approach with Brendan first.

Backlog, do NOT build unprompted (all in the TickTick task "CLAUDE CODE BACKLOG (bfd-setter)"):
CLONE-COMPLIANCE-1 (the voice->text clone re-asserts voice compliance copy into text prompts, gated); give
text setters a prompt_docs row; a Restore UI; delete or guard deploy_retell_proxy_bundle.mjs.

Explicitly NOT in scope, do not start: receive-twilio-sms hardening and sender-aware inbound SMS routing
(both product code, gated); ORPHAN-PROJ-1 project deletion, the PII vendor-toggle pass, and every secret
rotation (Brendan, provider consoles); PU-15 and every other prompt-content edit (Brendan, via the UI,
report only).
```
