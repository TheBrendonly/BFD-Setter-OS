# BFD-Setter — Master Session Plan (to v1 "100%")

**This file is the single source of truth for the session sequence.** Prompts point here; they do NOT
duplicate it. Every session keeps this file current, then emits the next session's prompt from it.
"100%" = rock-solid for the current live setup + ready to onboard a paying client. The deferred /
lifecycle work (`Docs/DEFERRED.md`) is v2 and NOT on this critical path.

The 5 canonical lists are the detail behind each session: `Docs/BUG_LIST.md`, `FEATURE_ROADMAP.md`,
`Docs/BRENDAN_TODO.md`, `Docs/TEST_LIST.md`, `Docs/DEFERRED.md`. Closed items → `Docs/archive/COMPLETED_LOG.md`.

---

## The Relay Protocol (how EVERY session runs)

1. **START.** Read (in order): this `SESSION_PLAN.md`, the latest `Operations/handoffs/` doc, and the
   list(s) named in this session's scope. Confirm `main` is current (`git pull` first).
2. **DO** only this session's scoped work (below). Stay in scope; if you find something out of scope,
   add it to the right list, don't build it.
3. **VERIFY** read-only / server-side before claiming anything done (tsc + deploy + push are necessary,
   not sufficient). Brendan runs live tests in the dedicated TEST session.
4. **CLOSE OUT — always do all of these, in order:**
   a. Update the 5 lists: move each finished item OUT (→ `TEST_LIST.md` if it needs live verification,
      else → `archive/COMPLETED_LOG.md`).
   b. Update THIS file: tick the session done; if reality changed (new bug, reprioritization, a session
      split or merged), edit the remaining sequence so it stays true.
   c. Write a dated handoff in `Operations/handoffs/YYYY-MM-DD-<topic>.md`.
   d. `git add -A && commit && push` to `origin` + `github` (docs/code both go to `main`).
   e. **Emit the NEXT session's prompt** — generate it FRESH from this file's next entry, print it in
      chat in a fenced block AND save it into the handoff. Use the Standard Context Block below + the
      next session's scope + this Relay Protocol. Do NOT paste the whole plan into it.

If a session is Brendan-driven (TEST or a manual milestone), the closeout still updates the lists +
this file + handoff, and emits the prompt for whatever comes after.

### Standard Context Block (paste at the top of every emitted prompt)
```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + the list(s) for this session.
```

### Plan mode per session
Start in **plan mode** (research + approve the approach before any edits) for the **design-heavy or
live-path** sessions: **Session 1 (B-1 cascade), Session 4 (F1/F3), Session 5 (B-2 by-phone pivot), Session 6.5 (F9/F8 build)**,
and any session that touches the live cadence runtime or many surfaces. **Skip plan mode** (just
execute) for the **mechanical/prescriptive** ones: Session 2 (G3 sweep), Session 3's cleanup
(F5/F6/F7), types.ts, the **doc** session, and the **TEST** session (read-only / Brendan-driven).
Each emitted prompt should state the recommended mode. Note: the closeout (update lists/plan, commit,
push, emit next prompt) runs after you approve + exit plan mode — plan mode front-loads a review gate,
it does not block the relay.

---

## The sequence

Status: `[ ]` not started · `[~]` in progress · `[x]` done. Effort is rough.

- [x] **Session 0 — Documentation fix-up.** DONE 2026-06-25. Keep/update/merge/archive table produced for
  every doc; CADENCE_DESIGN repointed off the deleted `c206da3e` → lifecycle (no more activation SQL);
  ARCHITECTURE got a current-wiring note (separate inbound agent, Twilio-direct, Retell-native voicemail,
  multi-DB, `clients_public`); ROADMAP banner'd as history; root README n8n-staleness + 2 broken links
  fixed; Docs/README index now leads with the 5 lists + SESSION_PLAN + a reference-docs table;
  `CLAUDE.md`/`AGENTS.md` got the tracking pointer (twins in sync); archived `WORKING_PROMPTS.md` +
  `AUDIT_RECONCILIATION_2026-06-19.md`. Doc set: 20 Docs/*.md, coherent + minimal. → emitted **Session 1**.
- [x] **Session 1 — Voice reliability (CODE).** DONE 2026-06-25. B-3 outbound now writes `agent_version:"latest_published"`
  (auto-follow, immune to the stale-pin class; Retell `AgentVersionReference` confirmed to accept the string). B-5
  root-caused: `default_dynamic_variables` is an **LLM** field, not an agent field — the v43 agent-level set was a
  silent no-op (verified on a throwaway agent); moved to `llmPayload` + reasserted on rename; **verified end-to-end**.
  B-1 rename cascades to one name across `prompts.name`/`agent_settings.name`/`voice_setters.name`/Retell `agent_name`
  + card lines (spoken persona untouched; "Title follows name" per Brendan). retell-proxy v45, duplicate-setter-config v8;
  tsc clean. B-1/B-3/B-5 → `TEST_LIST.md`. **PREREQ for TEST:** Brendan re-Saves the 5 setters. → emitted **Session 2**.
- [x] **Session 2 — Security/quality sweep (CODE).** DONE 2026-06-25. G3-1 was already fixed in `49a594e`
  (both `voice-booking-tools`/`kb-ingest` fail-closed on NULL `intake_lead_secret`) → COMPLETED_LOG. Shipped:
  G3-2 shared-master-agent disambiguation (`ghl_account_id`→`ghl_location_id`, logs `ambiguous_agent_match`);
  G3-3 mandatory `active_call_id` bind (refuse stamp when `call_id` missing); G3-4 real 400/502 status codes
  (+ 2 UI callers read the body off `error.context` so messages survive); G3-5 esbuild forced to 0.25.12 via
  npm `overrides` (build+tsc green, advisory cleared); types.ts drift = 5 columns added to live `clients` +
  appended to `clients_public` (security_invoker preserved, 0 secrets leaked, types.ts already declared them
  so no frontend change). retell-call-webhook v21, test-external-supabase v17. Found out-of-scope: vite
  dev-server advisories → new BUG_LIST **G3-7** (needs breaking vite bump). All → TEST_LIST. → emitted **Session 3**.
- [x] **Session 3 — Settings + setter cleanup (CODE).** SHIPPED 2026-06-25. B-4 (was already ~90% shipped
  in the 2026-06-17 restructure → finished the "Sub-Accounts" naming); F2 (new `voice_setters.is_inbound`
  + one-per-client index + inbound toggle auto-rebinds the live Retell number; removed per-setter outbound
  config, relocated phone import to API Credentials; the `40e8bea3`/all-workflow slot→UUID migration was a
  verified **no-op**); F5 (n8n code path was already gone → Railway shutdown to BRENDAN_TODO, column drop
  deferred via `clients_public` dep); F6 (deleted the two quiz steps + renumbered step-ids); F7 (deleted
  `c206da3e` + its inert companion campaign). Frontend build green; DB via Mgmt API; **no edge deploy**.
  All → `TEST_LIST`. → emitted **Session 3.1** (F2b regression found in live use).
- [x] **Session 3.1 — F2b inbound-toggle hotfix (CODE).** DONE 2026-06-26. Read-only diagnosis proved the
  persistence path already works on the live build (live DB: slot 8 `is_inbound=true`,
  `clients.retell_inbound_agent_id=agent_b2f6495…`, Retell `+61481614530` inbound→`agent_b2f6495…` — the
  whole inbound chain was correctly bound; B-6's original failure was testing mid-Railway-deploy on the
  old build). Real bug = **split-brain list badges**: they read `prompts.is_active`/`prompts.directions`
  (Deploy-only, false/empty for the report-only inbound agent) instead of the SoT `voice_setters.is_inbound`.
  Fix: list badges now read `voice_setters.is_inbound` (uncached) → inbound setter shows green
  **"Inbound" + "Bound"** (or amber **"Inbound · rebind"** when `clients.retell_inbound_agent_id` doesn't
  match the setter's agent), not red "Not Active"; toggle made non-silent + race-safe (`disabled` while
  writing; `.select('id')` 0-row detection in `useSetInboundSetter`). Frontend-only; tsc + build green;
  **no edge deploy**. B-6 → `TEST_LIST.md`. → emits **Session 4**. (Was PLAN mode — live path.)
- [x] **Session 4 — Client visibility + cadence controls (CODE).** DONE 2026-06-26 (was PLAN mode — live path).
  Verify-first (Relay Protocol) found **F3 + F4 were already built** and committed to `main` (F3 = `4b7dbc1`:
  `pause-/resume-engagement` live v1 + `runEngagement` `isPaused()` exit + UI buttons; F4 = `b0c6bea`:
  `nudgeColdReply` per-lead-local-hour gate on `clients.timezone`) but never reconciled off `FEATURE_ROADMAP` —
  so only **F1** was a real build. Shipped F1 (GHL→BFD deep-link: `sync-ghl-contact` **v24** writes the lead's
  `/leads/<uuid>` conversation URL onto the GHL contact via `writeGhlContactFields`, gated on the new
  `clients.ghl_conversation_link_field_id` column / migration `20260626120000`; non-fatal + dormant until
  Brendan provisions the field; `clients_public` recreated, 0 secrets leaked; `vite build` + `deno check` green).
  Redeployed Trigger.dev prod (`20260625.1`, 12 tasks) to guarantee the F3/F4 runtime is current. F1/F3/F4 →
  `TEST_LIST`; F1 activation → `BRENDAN_TODO`. → emits **Session 5**.
- [x] **Session 5 — By-phone pivot (CODE).** DONE 2026-06-26 (was PLAN mode — live path). Verify-first found
  **most of B-2 already shipped in Spec 1** (STOP fully internal + by-phone, zero GHL; inbound already
  internal-first via `resolveLeadByPhone`; `normalized_phone` set on the main create paths). The only residual
  GHL-lookup-for-identity was `receive-twilio-sms`'s `findOrCreateGhlContact` fallback on a brand-new-number
  miss. Per Brendan's gate ("Resilient + deterministic", "Fix + backfill"): (1a) made the GHL pick deterministic
  (exact-phone filter → most-recently-updated survivor, not first-match); (1b/1c) made inbound resilient — a GHL
  outage no longer drops the reply (REL-03): it mints a deterministic internal lead `bfd-<normalized_phone>` (reply
  flows Twilio-direct), logs `ghl_contact_resolve_degraded`, and a background `waitUntil` reconcile repoints the
  synthetic row to the real GHL id behind a UNIQUE-collision guard (bounded child set; defers concurrent-create to
  the Spec-2 merge); (2) fixed the CSV-import `normalized_phone` gap in `process-lead-file` + a one-time idempotent
  backfill migration `20260627120000`. receive-twilio-sms **v29**, process-lead-file **v14**, migration applied;
  no Trigger redeploy (`trigger/*` unchanged). Server-side verified (column/index present, `rows_missing_norm=0`,
  no dup `bfd-%` rows). B-2 → `TEST_LIST`. → emits **Session 6**.
- [x] **Session 6 — Secret-read hardening (CODE).** DONE 2026-06-26 (was EXECUTE mode; one Brendan gate on
  scope → all 3 tiers now + drop secret from the dormant webhooks). G3-6 closed across ~20 surfaces in 3
  tiers: **T1** central `useClientCredentials` → `clients_public` + `has_*` (+ all presence-only readers,
  the 3 dormant n8n chat interfaces, and the secret-EDIT pages ApiCredentials + SetupGuideDialog made
  write-only with a blank-save guard); **T2** new `get-openrouter-usage` fn + flipped `analyze-metric` /
  `analytics-v2-suggest-widgets` to read the key server-side (callers send `client_id`); **T3** the 2
  in-browser external-Supabase `createClient` reads moved server-side (Contacts→`fetch-thread-previews`,
  ChatAnalytics time-series→`get-chat-history` new `mode:'range'`). No migration (view + has_<col> already
  existed). tsc/build/deno green; analyze-metric **v18**, analytics-v2-suggest-widgets **v14**,
  get-openrouter-usage **v1**, get-chat-history **v7** ACTIVE. Out-of-scope residue (live/legacy webhook
  secret-forwards in LeadRow + the cross-project-n8n Presentation/Webinar chats, + dead ApiManagement/
  SupabaseConfigCard/RefreshCostDialog) logged as **G3-8**. G3-6 → `TEST_LIST` (network-tab gate + Tier-3
  live re-test owed at first client). → emitted **Session 7**; sequence then re-ordered (2026-06-26) to run
  **Session 6.5** (F9/F8 build) before the TEST pass.
- [ ] **Session 6.5 — F9/F8 feature build (CODE, PLAN mode — design-heavy + live-path).** Inserted
  2026-06-26 ahead of the TEST pass (Brendan's call): build it before testing so the single test pass
  validates final behaviour instead of re-testing the voice write paths after. **F9 first (own session) —
  per-setter Retell lock + ownership sync** (`FEATURE_ROADMAP` "Feature spec - F9"): `voice_setters.is_retell_locked`
  (+ snapshot/version cols) with a SERVER-ENFORCED write-guard across all ~8 retell-proxy write paths
  (incl. the two BULK loops + the make-retell-outbound-call voicemail PATCH skip) — outbound dialing must
  keep working while locked; locked setters become a read-only "Pull from Retell" mirror with version-drift
  detection. **F8 second (additive, agency-only, zero runtime overlap; may instead slot after the TEST pass)
  — per-minute cost-to-price calculator** (`FEATURE_ROADMAP` "Feature spec - F8"): `computeBlendedRate`
  (integer minor units + explicit FX + markup) + an agency-only rate panel on Sub-Account Config. Start
  with a discovery sweep (re-verify both specs vs live code + scan BUG_LIST/DEFERRED for other in-area
  wins) and brainstorm the open decisions before coding. **Done when:** F9 + F8 (v1) deployed + moved to
  TEST_LIST (with concrete live checks); v2 noted deferred. → emits the **Session 7** TEST prompt.
- [ ] **Session 7 — TEST pass (BRENDAN drives, Claude verifies).** Run the whole `Docs/TEST_LIST.md` in one
  live sweep (go-live smokes + B4 no-double-send + B-1/B-3/B-4/B-5 retests). Pre-req: Brendan re-Saved
  the 5 setters (from Session 1). Each pass → COMPLETED_LOG; each fail → a new BUG_LIST item + a fix
  session. **Done when:** TEST_LIST is empty/green. → emits the **First-client milestone**.
- [ ] **First-client milestone (BRENDAN, gated).** Not a Claude code session. At the first paying client:
  flip Stripe live (backfill `subscription_status` → set `ENFORCE_SUBSCRIPTION_GATE=true`), provision the
  GHL/Retell/Unipile webhook secrets + arm `retell_webhook_secret` (6.6), register AU SMS A2P for
  `+61481614530`. See `Docs/DEFERRED.md`. After this, v1 is live + 100%.

When Sessions 0-6.5 and 7 are `[x]` and TEST_LIST is green, BFD-setter is at v1 "100%". v2 = the lifecycle
system + A/B + analytics + HubSpot (`Docs/DEFERRED.md`).
