---
description: Canonical next-session relay prompt, regenerated at the 2026-08-13 closeout. Unblock the TOTP login (or route around it), then finish the seven owed live-verify legs and release the held frontend push.
---

# Next session prompt

Paste the fenced block below as the session's instructions.

```
BFD-setter — unblock the login, then finish the owed live verification and release the held push.
Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first; commit by EXPLICIT path, never git add -A).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT is VALID). Live DB via the Supabase
Management API /database/query (scripts/test-harness/q.mjs), NOT the postgres MCP. NEVER edit voice or text
prompt CONTENT (report-only -> Docs/PROMPT_UPDATE_LIST.md). Deploys: edge fns via
`node scripts/deploy_single_fn.mjs <slug>` and NEVER deploy_retell_proxy_bundle.mjs (it bundles index.ts +
_shared only and would drop retell-proxy's four function-local siblings). npm test is the only real gate:
608 baseline, all passing. No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Operations/handoffs/2026-08-13-mfa-blocker-and-clone-read.md, then Docs/TEST_LIST.md.

DO NOT rebuild the login script. It is committed at scripts/test-harness/auth.mjs and it is correct.
Read the corrected two-clock section of scripts/test-harness/README.md before touching auth at all: the
challenge TTL is a measured 300s, a reload mints a fresh one, and the field is #mfa_login_code (NOT
getByRole('textbox'), which grabs the email box). Three sessions have now rebuilt this from scratch.

STEP 0, BEFORE ANYTHING ELSE — resolve MFA-LOGIN-1 (Docs/BUG_LIST.md). Brendan has ALREADY answered the decisive test (confirmed 2026-08-13 via Cowork): he CAN log into app.buildingflowdigital.com manually in his own browser with a code, first try. Do NOT ask him again. This means the account/factor is fine and the fault is in the automation harness or its environment, not a desynced TOTP secret — do NOT delete or re-enrol the factor.
  Run `node scripts/test-harness/auth.mjs <scratchdir>` and ask Brendan to fire ONE fresh code with `echo 123456 > <scratchdir>/totp.txt` (it retries forever, so a rejected code costs nothing but the code).
  - If it now PASSES — the harness fix from 2026-08-13 (field id `#mfa_login_code`, reload-before-type) was the actual cure and the earlier failures were stale runs; proceed to the owed work below.
  - If it STILL fails with a code Brendan has just proven works manually — capture exactly what differs between the two paths (cookies/session state, network/IP, browser fingerprint, timing) rather than re-running the same script again; file the finding in Docs/BUG_LIST.md and ask Brendan before trying anything invasive.
  - Do NOT read auth.mfa_factors.secret and do NOT mint an MFA-bypassing session. Both are blocked by the permission classifier, correctly, and must not be worked around.
  - IF IT STAYS BLOCKED, DO NOT BURN THE SESSION ON IT AGAIN. Brendan can click SNAP-1, CLONE-1 and the RENDER-1 surfaces himself in ~10 minutes. Ask him to, capture what he sees, and proceed. Note that server-side aal2 is NEVER checked (_shared/assert-client-access.ts), so only the browser-UI legs actually need the elevated session.

THEN the owed work, in dependency order (this chain was not written down before, respect it):
  authenticated browser -> RENDER-1 -> git push github main -> DEMO-CB-1/2
1. RENDER-1 render smoke on the live app (Prompt Management, Settings, Dashboard, Account Settings,
   Clients), THEN `git push github main` to release the frontend. github has been held since 033c8c1 —
   check the live gap with `git rev-list --count $(git ls-remote github main | cut -f1)..HEAD` rather than
   trusting a number written here, since every closeout commit moves it.
2. SNAP-1 one real Pull from the UI. The toast must read "Full snapshot saved (vN) . N,NNN char prompt .
   N tools", not "Mirror updated".
3. SNAP-2 one restore on a throwaway BFD voice slot: Pull first, dryRun, then for real. Confirm the agent
   still answers and still has its 5 booking tools. NEVER slot 1, NEVER slot 9 (Stapleton), NEVER a client
   tenant. Slot 7 "Gary - Crazy Gary" is the least consequential candidate: it is a demo persona, and a
   pull-then-restore writes back identical config, so only the version bumps. API-only, no Restore button.
4. SNAP-3 confirm the next hourly pollRetellDrift does NOT flag versionDrifted on the restored slot.
5. CLONE-1 one voice->text clone from the UI into Setter-2 (seeded so it never touches live Setter-1).
   CLONE-2 is DONE (2026-08-13) - do not redo it.
6. SMS-GHL-1 one real inbound SMS. ASK BRENDAN WHICH NUMBER FIRST: TEST_PHONE_A is already a CRM lead so it
   cannot exercise the GHL contact leg, and TEST_PHONE_B is his wife's phone (permission required per use).
7. DEMO-CB-1/2 the demo-callback dry run on /g/stapleton-finance-b7q4. NOTE: that route is NOT live yet -
   verified 2026-08-13, the live app serves its generic 404, so this is gated on step 1's push.

Pass -> Docs/archive/COMPLETED_LOG.md; fail -> Docs/BUG_LIST.md + fix + retest. Close out per the Relay
Protocol. Then the standing rule resumes: zero new product code until a pilot is paid.

Backlog, do NOT build unprompted: CLONE-COMPLIANCE-1 (the voice->text clone re-asserts voice compliance
copy into text prompts - filed 2026-08-13, gated); give text setters a prompt_docs row; a Restore UI;
delete or guard deploy_retell_proxy_bundle.mjs. All five live in the TickTick task "CLAUDE CODE BACKLOG
(bfd-setter)".

THEN, ONLY IF THE OWED WORK ABOVE IS FULLY CLOSED OUT, work this queue in order. These are the remaining
items that are Claude Code's job rather than Brendan's or Cowork's. Re-read the standing rule first: zero
new PRODUCT code until a pilot is paid. Tooling, infrastructure and verification are not product code;
anything touching the setter product itself is, and stays filed.

  A. Verify /try-gary GHL-to-cadence wiring end to end (TickTick, same title). Read-only tracing plus a
     live probe. No new code, so not gated. Do this first - it is verification, same class as the owed
     work above.
  B. Slot 10 name drift on the BFD client (TickTick, same title). Read the live rows before proposing
     anything; slot 9 orphan is already RESOLVED, so confirm what is actually still drifting.
  C. Greenserver: build_card.py fixes found by the E2E test (TickTick, same title; ~30 lines - source
     line + headline anchor + --reuse-plate + footer margin). Different project, content-pipeline
     tooling, not setter product code. Unblocks the card pipeline.
  D. Rebuild the Projects -> Notion docs mirror (TickTick "Claude Code on greenserver: rebuild the
     Projects -> Notion docs mirror, ~90 min, plan mode"). Plan mode, and confirm the approach with
     Brendan before building - it spans several projects.

  Explicitly NOT in scope for this session, so do not start them: receive-twilio-sms 2026-04-30 hardening
  and sender-aware inbound SMS routing (both product code, both gated); ORPHAN-PROJ-1 project deletion,
  the PII vendor-toggle pass, and every secret rotation (Brendan, provider consoles); PU-15 and every
  other prompt-content edit (Brendan, via the UI - report only).
```
