---
description: Session 6 close-out (secret-read hardening / BUG_LIST G3-6) — ~20 browser secret-VALUE reads moved behind clients_public+has_* or edge fns across 3 tiers; 4 edge fns deployed; defense-in-depth (no live exposure). Includes the emitted Session 7 (TEST pass) kickoff prompt.
---

# Session 6 — Secret-Read Hardening (SHIPPED 2026-06-26)

Recommended mode was EXECUTE; ran with one Brendan scope gate (do all 3 tiers now + drop the secret from
the dormant n8n webhook chat interfaces). **G3-6 closed → `TEST_LIST`.** This is defense-in-depth: secrets
were already RLS-scoped and the `clients_public` boundary already shipped; this stops secret *values* ever
reaching the browser. **No DB migration** — the `clients_public` view and all 13 `has_<col>` booleans
already existed.

## What shipped (by tier)

### Tier 1 — mechanical, zero behaviour change
- **`hooks/useClientCredentials.ts`**: read repointed `clients` → `clients_public`; the 13 secret VALUE
  columns dropped from `CREDENTIALS_FIELDS`/interface, replaced by the `has_<col>` booleans. Writes still
  hit `clients` (`updateCredential`/`updateMultipleCredentials` unchanged); a new `toCachePatch` maps a
  secret write to its `has_<col>` boolean in the optimistic cache so the value never lands in React Query.
- **Hook consumers repointed to `has_*`**: `Chats.tsx`, `ContactDetail.tsx` (+ `ContactConversationHistory`
  prop `supabaseServiceKey` → boolean `hasSupabaseServiceKey`), `SupabaseUsage.tsx`, `VoiceAIRepSetup.tsx`.
- **Presence-only direct readers** → `clients_public` + `has_*`: `Dashboard.tsx`, `CampaignCreate.tsx`,
  `KnowledgeBase.tsx`, `AnalyticsV2.tsx` (state `openrouterApiKey`→`hasOpenrouterKey`), `PromptManagement.tsx`
  (the `fetchClientName` read trimmed to `name`; the prompt-webhook payload no longer carries the service key).
  `ClientDashboard.tsx` already read `clients_public` (no change).
- **Dormant n8n webhook chat interfaces** (`VITE_*_WEBHOOK_URL` are unset → already throw): `EmbeddedPromptChat`,
  `PromptChatInterface`, `AnalyticsChatInterface` — stop reading the secret, gate UI on `has_*`, drop the
  secret from the webhook payload.
- **Secret-EDIT pages made write-only** (keep saves working): `ApiCredentials.tsx` (the live `/credentials`
  route) + `SetupGuideDialog.tsx` (live setup-guide flows). Secret inputs seed to `''`; "Configured ✓ / Not
  set" comes from `has_<col>` (SetupGuide uses a non-secret `__configured__` sentinel in its saved snapshot so
  every existing indicator keeps working); **blank-save guards** mean a blank box can't NULL a stored secret;
  grouped saves don't force re-entering an already-set key; the ApiCredentials "refresh/sync" no longer wipes
  a configured secret.

### Tier 2 — edge-fn flips + new usage fn (deploy + network-tab verify)
- **NEW `get-openrouter-usage`** (v1): reads `openrouter_api_key` + `openrouter_management_key` server-side,
  does the 3 `openrouter.ai/api/v1` calls (credits/key/activity), returns the same shapes. `useOpenRouterUsage.ts`
  rewritten to a single `functions.invoke` (kills the 3 direct browser→OpenRouter calls; cache/aggregation kept).
- **`analyze-metric` v18**: `client_id` now required; reads `openrouter_api_key` server-side after authorize;
  body key dropped. ChatAnalytics callers stop reading/passing the key (gate on `hasLLMConfig`).
- **`analytics-v2-suggest-widgets` v14**: gained `createClient` + `authorizeClientRequest` + required `client_id`;
  reads the key server-side. Callers (`CustomMetricDialog`, `analytics-v2/CreateMetricDialog`) send `client_id`;
  `CustomMetricDialog` prop `openrouterApiKey`→`hasOpenrouterKey`.
- ChatAnalytics' in-browser OpenRouter "semantic duplicate" check **removed** (exact-name dedup kept).

### Tier 3 — live external-Supabase reads moved server-side (live re-test owed at first client)
- **`Contacts.tsx`**: dropped the in-browser `createClient` to external Supabase; last-interaction timestamps
  now come from `fetch-thread-previews` (`messages_per_session: 1`). `createClient` import removed.
- **`ChatAnalytics.tsx`**: dropped the in-browser `createClient` time-series read + all `supabase_service_key`
  reads; time-series now uses **`get-chat-history` v7** new `mode:'range'` branch (paginated `gte/lte timestamp`,
  returns `{rows:[{timestamp,message}]}`). The embedded Supabase-config editor's `serviceKey` is now write-only.

## Out of scope → logged as BUG_LIST **G3-8** (do NOT silently leave; not silently broken either)
Dropping these would change live/legacy behaviour, not just harden a read, and they're outside the explicit
G3-6 surface list — so deferred with specifics:
- `LeadRow.tsx` forwards `supabase_service_key` in the **database-reactivation webhook** (a live in-project
  feature) — needs a server-side reactivation path before the key can be dropped.
- `PresentationAgentChatInterface` + `WebinarPresentationAgentChatInterface` POST `openrouter_api_key` to a
  **hardcoded cross-project n8n URL** (`n8n-1prompt.99players.com`) — genuine cross-project leak but legacy/
  likely-dormant; confirm dead → delete, else migrate to an edge fn.
- Dead (unrendered/unrouted) code still referencing secret columns: `pages/ApiManagement.tsx`,
  `components/SupabaseConfigCard.tsx`, `components/RefreshCostDialog.tsx`. (`OpenRouterModelSelector` hits the
  PUBLIC `…/v1/models` endpoint — no key, not a leak.)

## Verify (done at ship)
- `npx tsc --noEmit` clean (baseline 0). `npm run build` green.
- `deno check` clean on analyze-metric, analytics-v2-suggest-widgets, get-openrouter-usage, get-chat-history
  (the pre-existing supabase-js generic wart in get-chat-history's helpers was resolved while extending it).
- Bundle-deployed all 4 (boot probe HTTP 400 = booted; these fns validate `client_id` before auth, so a
  no-body probe is 400 not 401).
- Final grep: **0** in-browser external `createClient`; **0** in-scope `clients` secret selects left; only
  the public OpenRouter models endpoint + the deferred G3-8 surfaces remain.

## Deploy state (end of session)
- Edge: **analyze-metric v18, analytics-v2-suggest-widgets v14, get-openrouter-usage v1 (NEW), get-chat-history v7**.
  Unchanged: sync-ghl-contact v24, retell-proxy v45, retell-call-webhook v21, test-external-supabase v17,
  receive-twilio-sms v29, process-lead-file v14, duplicate-setter-config v8, pause/resume-engagement v1.
- Trigger.dev prod: **20260625.1** (untouched — no `trigger/*` change).
- Frontend: pushed to `main`; Railway auto-deploys (`app.buildingflowdigital.com`) — hard-refresh.
- DB: **no migration** this session.

## Relay Protocol (Docs/SESSION_PLAN.md step 4) — followed
Lists: G3-6 out of `BUG_LIST` → `TEST_LIST` (new Session 6 section: network-tab gate + Tier-3 live re-test);
new **G3-8** logged in `BUG_LIST` Low; Session 6 ticked in `SESSION_PLAN.md`. Memory
`project_session6_secret_read_hardening_2026_06_26` + MEMORY.md pointer written. This handoff written;
commit + push to `origin` + `github`. Session 7 prompt emitted below.

---

## EMITTED — Session 7 kickoff prompt (NEXT — paste verbatim)

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + Docs/TEST_LIST.md (the whole file).

DEPLOY NOTE: the frontend auto-deploys via Railway on push to main (app.buildingflowdigital.com); allow
a few minutes + hard-refresh. Edge fns import from _shared/, so deploy with
`node scripts/deploy_retell_proxy_bundle.mjs <slug>` (the plain `supabase functions deploy` CLI silently
drops _shared/ refs). Trigger.dev tasks deploy with the TRIGGER_DEPLOY_PAT
(`TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy --env prod`). Current live edge
versions: sync-ghl-contact v24, retell-proxy v45, retell-call-webhook v21, test-external-supabase v17,
receive-twilio-sms v29, process-lead-file v14, duplicate-setter-config v8, pause-engagement v1,
resume-engagement v1, analyze-metric v18, analytics-v2-suggest-widgets v14, get-openrouter-usage v1,
get-chat-history v7. Trigger prod 20260625.1. Latest migration 20260627120000.

Use superpowers skills where appropriate.

TASK — SESSION 7: TEST PASS (BRENDAN DRIVES, CLAUDE VERIFIES read-only). Recommended mode: EXECUTE
(no code build; Brendan performs the live actions, Claude verifies server-side read-only + records results).
Scope: run the WHOLE of Docs/TEST_LIST.md in one live sweep — go-live smokes (6.11/6.12b/3.12/6.10/6.7 +
bug-sweep UI), B4 no-double-send, the Session 5 by-phone checks (B-2 CSV normalized_phone / inbound never
dropped on a GHL outage / background repoint no-dup / deterministic GHL pick), the Session 6 secret-read
network-tab gate (G3-6: no secret value in any listed flow; Credentials + Setup Guide still SAVE write-only;
analytics features still work — Tier 3 live re-test), and the B-1/B-3/B-4/B-5 retests. PREREQ for the
Session 1 voice items: Brendan must first re-Save/Push (do NOT edit prompts) each of the 5 setters
(Main Outbound slot 1 + Gary Property Coach / Mortgage Broker / Finance Strategist / Crazy Gary) — fixes
only land on the next Save. Each item that PASSES → move to Docs/archive/COMPLETED_LOG.md; each FAIL → open
a new BUG_LIST item + schedule a fix session. Claude's role: for each item, state the exact server-side
read (Mgmt API SQL / Retell GET / network-tab expectation) that confirms pass/fail; don't claim a UI-only
pass without evidence.

DONE WHEN: TEST_LIST.md is empty/green (every item either → COMPLETED_LOG on pass or → a new BUG_LIST item
on fail), with the server-side evidence recorded.

CLOSE OUT (Relay Protocol, Docs/SESSION_PLAN.md step 4): update the 5 lists (passes → COMPLETED_LOG, fails →
BUG_LIST); tick Session 7 in SESSION_PLAN.md; write a dated handoff; git add -A + commit + push to origin +
github; then EMIT THE NEXT PROMPT — either the First-client milestone (if TEST_LIST is green) or a fix
session for the highest-priority new bug — printed in a fenced block in chat AND saved into the handoff,
built from the Standard Context Block + that next scope + this Relay Protocol. Point to Docs/SESSION_PLAN.md;
do not inline the whole plan.
```
