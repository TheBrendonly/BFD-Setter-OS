---
description: Handoff for the 2026-07-11 combined session (Phase 1 retell-proxy/infra cleanup + Phase 2 autonomous test session + Phase 3 GATE A deferred). Next = dedicated GATE A session + residual behavioral SMS/voice legs; First-Client Milestone stays gated.
---

# 2026-07-11 — Combined session (bundle cleanup → test session → GATE A review) handoff

Brendan present. Model Fable 5. Three phases per the 2026-07-10 combined prompt.

## Phase 1 — retell-proxy / infra cleanup — DONE

The staged v51 bundle (GETCALL-1 + PU-9-CODE) was **already deployed + live-verified earlier 2026-07-11**
by the supervised deploy session (see `COMPLETED_LOG.md` 2026-07-11), so Phase 1 became verify-not-redeploy:

- **elevenlabs-manage-agent live undeploy** — Brendan GO. One Management-API DELETE; verified gone (0
  elevenlabs fns remain). Repo copy was already removed 2026-07-10. → BRENDAN_TODO item closed.
- **retell-proxy v51 verified live** — read-only Voice smoke (v2/list-agents 200, 24 agents, 0 mutated);
  `get-call/{id}` → 200; the canonical Main Outbound + Inbound LLM booking tools carry the PU-9 two-beat
  ~20-30-word fillers + `speak_after_execution:true` on the write tools. All confirmed present live.
- **LEGACY_N8N_HOST guard removed → retell-proxy v52** (Brendan GO after a clean scan). Fresh sweep found
  ZERO n8n-host URLs anywhere: `agent_settings` / `prompt_configurations` / `voice_setters` whole-row scan,
  `retell_config_snapshot`, and all **50 live Retell LLM** tool URLs. The name-keyed BFD tool-URL authority
  + placeholder fallback stay, so the guard was dead code. Deployed via `deploy_single_fn.mjs`; boot 400,
  Voice smoke clean (0 mutated). Commit `43a89c6`. Tests 253 edge + 164 node green.
- **Trigger.dev prod deploy 20260711.1** — folds in the cosmetic syntheticProbe Slack-text drift.

## Phase 2 — autonomous test session — mostly PASS, 2 fixes shipped, 3 new findings

Drove the tool-drivable + browser legs via the harness (Playwright magic-link+TOTP, signed inbound-SMS sim,
Mgmt-API SQL, JWT edge-fn calls, throwaway client-role user). One TOTP code from Brendan.

**PASS (→ COMPLETED_LOG):**
- **RLS-UISTATE-1-LIVE** — throwaway client-role probe 8/8: own-client `chat_starred` insert 201, sibling
  insert 403/42501, cross-client select `[]`, same for `dismissed_error_alerts`; **agency user NOT locked
  out** (insert/delete/select all 200). **COST-4** — client-role `execution_cost_events` → 0 rows (control:
  2 rows under service role).
- **COST-1** — the morning answered call (`call_c03c21e6…`, agent_f45f4dd, Tue 14 Jul 1:30pm Sydney booking)
  accrued an `execution_cost_events` voice row `cost_usd=0.30 = call_history.cost`, `is_estimated=false`.
- **MAIN-OUTBOUND-SHARED-1 answered leg** — same call proved outbound uses `agent_f45f4dd` (NOT b2f6495),
  `first_name`="Brendan" interpolated (no literal `{{first_name}}`), booking completed; **API-DEPR-2(b)** —
  `call_analysis` carries `call_summary`/`user_sentiment`/`call_successful` TOP-LEVEL. **PU-9** filler +
  after-confirmation both audible in transcript across the GHL round-trip.
- **PURGE-SYNC-1** — signed sync-ghl-contact: plain update → `updated` + a `sync_ghl_executions` row with
  the "Find Lead in BFD" / "Update Lead" steps (**SYNC-LOG-1** PASS); an echo-stamped update within 60s →
  `skipped_echo` + "Echo-loop check" step.
- **QH-TZ-1-LIVE** — set the probe client's `cadence_quiet_hours.tz` to `Junk/Zone`; the 05:00 synthetic
  probe still enrolled + queued the outbound (passed=true, 17.8s) → the junk tz no longer stalls the cadence.
  Restored tz to `Australia/Brisbane`.
- **B-2 CSV `normalized_phone`** (after the B2-CSV-NORM-1 fix below) — import `0400000456` → row has
  `normalized_phone='+61400000456'`; an inbound SMS from that number resolves internal-first (1 lead, no
  2nd row). **B-2 outage leg** — broke `ghl_api_key`, inbound from an unknown number minted `bfd-+61400…`
  with the right `normalized_phone`, logged `ghl_contact_resolve_degraded` (not `_failed`); key restored in
  a `finally`; no duplicate `bfd-%` rows.
- **GETCALL-1** (retell-proxy get-call action → 200), **G3-6 Tier-3** (get-chat-history mode:range,
  fetch-thread-previews, get-openrouter-usage, analytics-v2-suggest-widgets, analyze-metric all 200 with a
  real JWT), **G3-6-SCHEMA-1** (analytics-v2-process 200, `total_conversations:3` — config gate cleared,
  no "configuration incomplete"), **INB-1** (inbound + outbound phone bindings both `latest_published`),
  **CONTACTS-EDIT-DEAD-1** (single-select → Edit button → dialog → Save, no error).
- **F13/F15 client-eye** — throwaway client-role login: dashboard shows the show-rate FUNNEL but NOT the
  margin/cost/billed one-liner; AccountSettings shows the read-only rate card, NO markup leak; `/settings`
  redirects a client away (AgencyRoute). Agency-only containment holds. 0 console errors.
- **P3-CLEANUP-1** (client dashboard renders post ClientLayout dead-branch removal), **PURGE-UI-1** (setup
  guide surfaces render clean, no n8n/Skool/1prompt text on any of 14 routes).

**Fixes shipped this session (2 commits):**
- **`043e62d`** — (a) removed dead **Converteai** VSL preloads from `frontend/index.html` (1Prompt-era, no
  consumer in src, 403 on every page load — branding-purge residual); (b) **PURGE-UI-2 FAIL fixed**: the
  4 text/voice-ai-rep `templates`+`configuration` redirects used `Navigate to="../setup"`, which React
  Router resolves to `/client/:id/setup` (a 404) not the sibling — repointed all 4 at their real setup
  pages. Verified live after Railway rebuild: all redirects land correctly, converteai gone.
- **`<commit>` (B2-CSV-NORM-1)** — process-lead-file **v18**. The Session-5 B-2 CSV fix was mis-firing: the
  import's local display normalizer prepends `+` to AU national numbers (`0400…`→`+0400…`) BEFORE
  `normalizePhoneE164` ran, and a `+`-prefixed value makes the E164 helper trust the digits + skip its AU
  branch, storing a non-E164 `+0400…`. Now normalizes from the RAW csv value. Live re-probe → `+61400000456`.

**NEW findings → BUG_LIST:**
- **SCHED-1 (Med, infra) — the two hourly cron schedules were NEVER registered in Trigger.dev prod.** The
  schedules list was empty despite `synthetic-probe` + `poll-retell-drift` declaring `schedules.task({cron})`
  in code, and even after this session's deploy. `poll-retell-drift` had **zero runs ever**; `probe_results`
  had 2 rows total. **Registered both imperatively** via the API (dedup keys `synthetic-probe-hourly-prod` /
  `poll-retell-drift-hourly-prod`, `0 * * * *`); the 05:00 probe fired + passed, confirming it works. Root
  cause of why the declarative registration didn't happen on deploy is worth a look (my imperative fix runs
  hourly regardless). This means the synthetic uptime probe + F9 drift poll had been silent since inception.
- **B2-REPOINT-1 (Low) — the GHL-outage synthetic-lead reconcile only repoints within the SAME request.**
  After the outage mint, a LATER inbound (GHL healthy) did NOT converge `bfd-+61…` to a real GHL id (still
  `bfd-` after 90s). The `waitUntil` reconcile runs only in the request that minted the synthetic; a
  separate later inbound just re-resolves internal-first by phone and never re-attempts GHL. Not a drop (the
  reply still flows), but the synthetic id is sticky if GHL was down at mint time and never recovers
  in-request. Matches the code (reconcile gated on `syntheticMinted` in the mint request only).
- **PURGE-TAG-1** — dispositioned, not a blocker: the derivation prefixes (`bfd-try-gary-` /
  `1prompt-try-gary-`) are separate from the live `engagement_workflows.new_leads_tag` values
  (`bfd_setter-try_gary…`). Both prefix forms still derive `agent_style`/`source_type` in
  `extractComplianceFields`; a full tag-apply enrolment test wasn't run (needs a real GHL contact + workflow
  tag). Low risk; folded into the residual behavioral legs.

**Still OWED (residual behavioral legs — need live SMS/voice or a gated dependency):**
- SMS multi-turn: BOOK-1/3.12 booking, SMS-MEM-1, SMS-OBS-1, MODEL-1, RESCHED-SMS-1, manual-send+429 (LIVE-D).
- Timing: HOURS-1 (a/d out-of-hours defer), FOLLOWUP-DURING-CALL-1, F16(b/c/d)/F17 (Voice-gated + flags OFF).
- B-5 (inbound call from a genuinely unknown number), PURGE-SIM-1 (run the simulator end-to-end).
- MODEL-1-HARDENING backend leg (throwaway client bad `llm_model`). COST-2/COST-3 (dormant — no cadence
  send accrued). F9V2-1/2 (schedule now registered; needs a genuinely LOCKED setter to flag drift — none
  exist). F13 dashboard summary card both roles. F14 (Resend-gated). BOOKTZ-1 (needs a real interstate lead).

## Phase 3 — GATE A — DEFERRED to a dedicated session (Brendan's call)

Read-only review of the `ff355d4` draft found it is **incomplete as written**: client-role-reachable pages
(`AccountSettings`, `AnalyticsLayout`, `ClientDashboard`) **UPDATE base `clients`** to persist UI state
(`crm_filter_config`: column widths, dashboard order, last-dashboard) under a client JWT. The draft's blanket
`get_user_role='agency'` UPDATE gate would silently break those client UI-state writes. A correct migration
needs **client_own UPDATE policies** (or those writes relocated to an edge fn) PLUS per-table resolution of
the other 5 tables' OPEN QUESTIONS. It is **Critical but LATENT (0 client-role users today)**. Brendan chose
to defer the full apply to a dedicated GATE A session rather than rush it at the end of a long session.
GATE B stays milestone-gated (needs `retell_webhook_secret` armed) — untouched.

## State at close
- `main`: `43a89c6` (+ the B2-CSV-NORM-1 commit) pushed origin + github. Live fns: **retell-proxy v52**,
  **process-lead-file v18**, Trigger **20260711.1**. Two Trigger schedules now registered.
- Probe client tz restored to `Australia/Brisbane`. No test residue (throwaway users + CSV/outage leads
  deleted; GHL key restored).

## NEXT SESSION (paste — GATE A dedicated session, then residual behavioral legs)

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env. Live DB via Supabase Management API /database/query
(NOT postgres MCP). Live Retell via api.retellai.com with BFD_RETELL_API_KEY. To know which agent serves a
direction read voice_setters.retell_agent_id fresh (never the phone binding). NEVER edit voice/text prompt
content (report-only). Verify read-only before claiming done. No em dashes. Follow the Relay Protocol in
Docs/SESSION_PLAN.md. READ FIRST: Docs/SESSION_PLAN.md, the latest handoff
(Operations/handoffs/2026-07-11-combined-bundle-test-gatea.md), Docs/GATE_A_RLS_DRAFT_2026-07-08.md,
Docs/BUG_LIST.md, Docs/TEST_LIST.md.

SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (Critical RLS migration on a live DB).

PHASE 1 - GATE A RLS role-gate (RLS-CLIENTS-1 Critical + RLS-CREDENTIALS-1 / RLS-TENANT-DISJUNCTION-1 /
RLS-GATE-SIBLING-1 / RLS-ORUSAGE-1 / RLS-UNIPILE-1 / RLS-AGENCIES-1). The ff355d4 draft is INCOMPLETE: the
2026-07-11 review found client-role pages (AccountSettings/AnalyticsLayout/ClientDashboard) UPDATE base
`clients.crm_filter_config` under a client JWT, so a blanket agency-only UPDATE gate breaks client UI-state
saves. Correct it: add client_own policies (or relocate those UI-state writes to clients_public/an edge fn),
and resolve every OPEN QUESTION per table with a read-only sweep FIRST. Then apply via the Management API,
verify pg_policies (memory project_phase3_rls_policy_gaps), and run the live throwaway-client-role probe
(the 2026-07-11 rls_probe.mjs pattern) to prove: client cannot read clients/credentials/openrouter/sibling
tenant rows, CAN read clients_public + write its own tags/custom-fields/UI-state, and the AGENCY user's whole
UI is unaffected (no lockout). GATE B stays milestone-gated - do NOT arm retell_webhook_secret.

PHASE 2 - residual behavioral test legs (drive via scripts/test-harness; ask Brendan for ONE TOTP up front
if browser-auth needed, and for answered voice calls). Owed: SMS multi-turn (BOOK-1/3.12, SMS-MEM-1,
SMS-OBS-1, MODEL-1, RESCHED-SMS-1, LIVE-D manual-send+429), HOURS-1 (a/d), FOLLOWUP-DURING-CALL-1, B-5
(unknown-number inbound call), PURGE-SIM-1, MODEL-1-HARDENING backend leg, F13 dashboard-card both roles,
F16(b/c/d)+F17 (enable dogfood flags first), F9V2 (needs a locked setter), COST-2/3 (need a cadence send).
Also verify SCHED-1: confirm the poll-retell-drift + synthetic-probe schedules still fire hourly, and decide
whether to fix the root cause (declarative schedules not auto-registering on deploy). TEST_LIST.md stays the
pass/fail SoT.

After GATE A + the behavioral legs are green, the only remaining step to v1 "100%" is the First-Client
Milestone (Docs/FIRST_CLIENT_MILESTONE.md) - EVENT-GATED on a signed contract, do NOT run it before then.
Close out per the Relay Protocol.
```
