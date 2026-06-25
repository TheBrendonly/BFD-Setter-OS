---
description: BFD-setter Session 2 (security/quality sweep — G3 items + types.ts drift) closeout + the emitted Session 3 (settings + setter cleanup) prompt.
---

# BFD-Setter — Session 2 (Security/quality sweep) closeout — 2026-06-25

Relay step done. `SESSION_PLAN.md` Session 2 ticked + the Session 3 prompt below. Started in plan mode
(harness default); the one real fork (types.ts drift direction) was approved by Brendan before edits.

## What shipped (deployed: retell-call-webhook v21, test-external-supabase v17; frontend tsc-clean, rides next Railway deploy; live schema applied via Mgmt API)

- **G3-1 — already fixed, no change.** Verified in committed code (`49a594e`, audit sweep 2026-06-23):
  `voice-booking-tools` ([resolveClient L120-134](../../frontend/supabase/functions/voice-booking-tools/index.ts#L120-L134))
  and `kb-ingest` ([L94-104](../../frontend/supabase/functions/kb-ingest/index.ts#L94-L104)) both
  **fail-closed** (401) when `intake_lead_secret` is NULL — stricter than asked (covers read tools too).
  It was simply never moved off `BUG_LIST`. → `COMPLETED_LOG.md`.
- **G3-2 — shared-master-agent disambiguation.** `retell-call-webhook` previously picked `clients[0]` when
  an `agent_id` matched >1 client. Now: added `ghl_location_id` to the lookup, hoisted the `dynamicVars`
  extraction above client selection, and when `clients.length > 1` it picks the tenant whose
  `ghl_location_id == dynamicVars.ghl_account_id` (`ghl_location_id` is UNIQUE → 1:1 tenant). No match /
  no `ghl_account_id` → fall back to `clients[0]` **and** log `error_logs.error_type='ambiguous_agent_match'`
  (with candidate ids). No-op at single-tenant today; closes the integrity hazard as clients grow.
- **G3-3 — mandatory `active_call_id` bind.** The `.eq("active_call_id", callId)` bind already existed but
  only when `callId` was truthy. Restructured so a `call_ended` with no `call_id` is **refused** (logged,
  not stamped) and the bind is unconditional otherwise — a forged `call_ended` with a guessed `execution_id`
  but no `call_id` can no longer clear/pollute a hold. Legit calls always carry `call_id`; runtime unaffected.
- **G3-4 — real status codes.** `test-external-supabase` returned 200 on every failure. Now: **400** on the
  7 input/validation branches, **502** on the 7 upstream-connection branches; the success path (200) and the
  auth-guard (`e.status`) are unchanged, and every `{success:false,…}` body is preserved. Because supabase-js
  drops the body on a non-2xx (`FunctionsHttpError`), the **two callers** (`SupabaseConfigCard.tsx`,
  `ChatAnalytics.tsx`) now read the specific message off `error.context` so the toast stays helpful.
  **Live-confirmed:** missing clientId → HTTP 400 + `{"success":false,"error":"Client ID is required"}`.
- **G3-5 — esbuild ≥0.25.** Added `"overrides": { "esbuild": "^0.25.0" }` to `frontend/package.json`;
  `npm install` resolved `esbuild@0.25.12 overridden` (was transitive 0.21.5 via vite). `npm run build`
  (vite 5.4.21 + esbuild 0.25 compose fine) and `tsc --noEmit` both green; `npm audit` no longer lists
  GHSA-67mh-4wv8-2f99. Dev-server only; prod ships a static build.
- **types.ts drift — Brendan chose "add columns + extend view".** All 5 columns
  (`crm_page_size`, `crm_column_widths`, `log_column_widths`, `sync_ghl_booking_enabled`,
  `what_to_do_acknowledged`) had real repo migrations but were never applied to live. New migration
  `20260625120000_clients_public_add_crm_ui_columns.sql` adds them to `clients` (idempotent) and appends
  them to `clients_public` via `CREATE OR REPLACE VIEW`. **Applied live** (HTTP 201). Verified: all 5 on
  both `clients` and `clients_public`, view still `security_invoker=on`, 13 `has_*` booleans intact,
  **0 secret columns leaked**, spot-read returns defaults. `types.ts` already declared them → no frontend change.

## Files
- `frontend/supabase/functions/retell-call-webhook/index.ts` — G3-2 + G3-3.
- `frontend/supabase/functions/test-external-supabase/index.ts` — G3-4 status codes.
- `frontend/src/components/SupabaseConfigCard.tsx`, `frontend/src/pages/ChatAnalytics.tsx` — G3-4 caller message preservation.
- `frontend/package.json` (+ `package-lock.json`) — G3-5 esbuild override.
- `frontend/supabase/migrations/20260625120000_clients_public_add_crm_ui_columns.sql` — types.ts drift (also applied live).

## Verify (read-only / server-side, done)
- `deno check` on both edge fns: exit 0.
- `frontend`: `npm run build` exit 0 (esbuild 0.25.12), `tsc --noEmit` exit 0, `npm ls esbuild` → 0.25.12 overridden.
- Deployed via `scripts/deploy_retell_proxy_bundle.mjs` (bundles `_shared/`): retell-call-webhook v20→v21, test-external-supabase v16→v17.
- Live: missing-clientId probe → 400 + body; the 5 columns + view confirmed via `information_schema` / `pg_class.reloptions`.
- Behavior retests for Brendan are in `Docs/TEST_LIST.md` (Session 2 section). No re-Save prereq this session.

## Out of scope, logged not built
- **G3-7 (new BUG_LIST item):** `npm audit` flags vite ≤6.4.2 dev-server advisories (path traversal in
  optimized-deps `.map`, `server.fs.deny` bypass, launch-editor NTLM) — needs a breaking vite major bump,
  its own session. Pre-existing moderate `dompurify`/`tar` advisories are `npm audit fix`-able.

---

## NEXT — Session 3 prompt (Settings + setter cleanup, CODE). Recommended mode: PLAN (touches several surfaces).

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + the list(s) for this session.

DEPLOY NOTE: edge fns import from _shared/, so deploy with the canonical bundle script
`node scripts/deploy_retell_proxy_bundle.mjs <slug>` (the plain `supabase functions deploy` CLI
silently drops _shared/ refs). After Session 2: retell-call-webhook v21, test-external-supabase v17,
retell-proxy v45, duplicate-setter-config v8.

TASK — SESSION 3: SETTINGS + SETTER CLEANUP (CODE). Recommended mode: PLAN (touches several surfaces;
research + approve the approach before edits). Scope:

- B-4 (6.1) Settings nav split. Client sees only "My Account" (self-serve settings); admin sees
  "My Account" (own login/password/theme) + "Sub-Accounts" (list → click → that sub-account's config
  page at /client/<id>/settings, which already exists). Kills the duplicate "Sub-Account Settings" /
  "Account Settings" / "Manage Sub-Accounts" confusion. Frontend: ClientLayout.tsx SYSTEM block,
  useClientMenuConfig.ts. `[B]`-minor decision to surface in plan: which workspace settings (brand
  voice, contact hours…) a client may self-edit vs admin-only.
- F2 (FEATURE_ROADMAP) UUID-native node picker + single inbound-setter binding. One setter flagged as
  the inbound setter; outbound is chosen at campaign/workflow level (no per-setter outbound-direction
  binding — kills the old 2.3 model). Picker should be UUID-native, not name-matched.
- F5 n8n decommission (remove the n8n-era paths now that the native text engine is canonical).
- F6 remove the setup-guide quizzes that teach the old n8n/1prompt model.
- F7 delete the flat 28-node draft cadence c206da3e (superseded by the lifecycle system; DEFERRED).

DONE WHEN: tsc clean + deployed; each item moved out of its list → TEST_LIST.

CLOSE OUT (Relay Protocol, Docs/SESSION_PLAN.md step 4): update the 5 lists; tick Session 3 done in
SESSION_PLAN.md; write a dated handoff; git add -A + commit + push to origin + github; then EMIT THE
SESSION 4 PROMPT (Client visibility + cadence controls: F1 GHL→BFD deep-link custom field, F3
pause/resume a running cadence, F4 per-tenant timezone nudgeColdReply cron) — print it in a fenced
block in chat AND save it into the new handoff, built from the Standard Context Block + Session 4's
scope + this Relay Protocol. Point to Docs/SESSION_PLAN.md; do not inline the whole plan. Session 4
recommended mode: PLAN (live cadence path).
```
