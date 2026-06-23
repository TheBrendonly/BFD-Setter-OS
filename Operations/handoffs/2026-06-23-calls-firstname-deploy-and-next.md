---
description: Handoff + copy-paste kickoff prompt for the next BFD-setter session — verify the 2026-06-23 calls/{{first_name}} deploy, live-smoke, fix the remaining reported findings, and hunt new bugs + unbuilt features.
---

# Handoff 2026-06-23 — calls/{{first_name}} fix DEPLOYED + next-session kickoff

**Done this session (main `9efe92b`, deployed LIVE):** diagnosed "try-gary form-fills make no calls"
as a Trigger.dev prod ~20-45 min dispatch-latency problem (infra, not code — the call DID fire,
43 min late); fixed the literal `{{first_name}}` + 1 critical + 9 high audit bugs; deployed 9 edge
functions + Trigger `20260623.1`. Full detail: `Docs/CALLS_AND_FIRSTNAME_FIX_2026-06-23.md`.
Right after the deploy, latency dropped to ~2-3 min — confirm it held.

## Kickoff prompt for the next session

```
You are continuing work on the BFD setter at /srv/bfd/Projects/bfd-setter.

Read FIRST: Docs/CALLS_AND_FIRSTNAME_FIX_2026-06-23.md (the prior-session guide; main `9efe92b`,
deployed live 2026-06-23 = 9 edge fns + Trigger 20260623.1), the top entry of the memory MEMORY.md,
and Docs/BUG_LIST.md.

Context: the prior session found that "try-gary form-fills produce no outbound call" is a Trigger.dev
PROD dispatch-latency problem (~20-45 min queue-wait, infra not code — the call fires that late),
and fixed the literal {{first_name}} bug plus 1 critical + 9 high audit bugs (all deployed). Right
after the Trigger deploy the latency dropped to ~2-3 min; confirm it held.

Do, in order:

1. VERIFY LIVE STATE (read-only):
   - Re-measure Trigger.dev prod dispatch latency (snippet in the guide, Part 1). If it is still
     >~5 min under load, the durable fix is the Trigger.dev DASHBOARD (guide Part 2: prod env
     concurrency / plan / billing) which Brendan must do — flag it with the exact numbers.
   - Confirm the 9 deployed edge fns + Trigger 20260623.1 are the active versions.

2. LIVE SMOKE (Brendan places calls/texts; you verify server-side, read-only):
   - A try-gary form-fill should produce an outbound call within ~1-2 min (check call_history).
   - An inbound call from a number NOT in the CRM must omit the name, never the literal token.
   - Remind Brendan to re-Save the 5 voice setters (so the new agent-level default_dynamic_variables
     applies) and to neutralize the inbound begin_message in the UI (guide Part 3 step 3).

3. FIX THE REMAINING REPORTED FINDINGS (audited but not yet fixed):
   - make-retell-outbound-call reads a `messages` table that exists in no migration -> voice loses
     chat-history context. Verify live which table holds SMS/chat, repoint or add a migration.
   - Double GHL note per call when ghl_conversation_provider_id is NULL.
   - campaign-enroll-webhook guessable URL token; twilio-list-numbers cross-tenant secret RLS;
     receive-twilio-sms non-constant-time signature compare + STOP/START-before-dedup; + the lows.

4. HUNT NEW BUGS + UNBUILT FEATURES (the main ask — go broad, use subagents / a workflow):
   - Fresh system-wide audit. Re-sweep and cover anything the prior 10-area pass missed: frontend
     runtime, analytics/simulation, onboarding, Stripe/billing, RLS, and the external/multi-DB
     boundary. Adversarially verify findings (no false positives).
   - Survey UNBUILT features / roadmap gaps Brendan has not worked on: read Docs/ROADMAP.md,
     FEATURE_ROADMAP.md, User Todos.md, and the open [B]/S-items in Docs/BUG_LIST.md; propose the
     highest value/effort items to build next. Do NOT build yet — present a prioritized plan.

Hard constraints:
- NEVER edit voice-agent prompts (Retell backend or repo prompt files) — report only; Brendan
  applies them in the BFD setter UI.
- Deploy edge fns via `set -a && source .env && set +a; node scripts/deploy_single_fn.mjs <slug>`
  (bundles _shared, preserves verify_jwt). Trigger via
  `TRIGGER_ACCESS_TOKEN=$(grep '^TRIGGER_DEPLOY_PAT=' .env|cut -d= -f2) npx -y trigger.dev@4.4.4 deploy --env prod`.
  Migrations via the Management API SQL runner + a committed .sql file (no schema_migrations table).
  App is MULTI-DB (platform bjgrgbgykvjrsuwwruoh vs external) — surgical types.ts only.
- Live DB is reachable read-only via the Management API SQL endpoint with SUPABASE_PAT (the
  mcp__postgres MCP points at the unrelated Railway voice-agent DB, not this Supabase).
- Verify every change (tests + typecheck + a live/server-side check) before claiming done.
  Commit + push (Forgejo origin AND github) per logical chunk. No em dashes in written output.

Start by reading the guide + memory, then give Brendan a short plan before executing.
```
