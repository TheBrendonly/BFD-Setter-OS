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
live-path** sessions: **Session 1 (B-1 cascade), Session 4 (F1/F3), Session 5 (B-2 by-phone pivot), Session 6.5 (F9 lock build), Session 8 (F8 cost calc)**,
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
- [x] **Session 6.5 — F9 Retell lock build + fold-ins (CODE, PLAN mode — design-heavy + live-path).** DONE
  2026-06-26. Brendan chose **SPLIT** (F9 first this session; F8 after the TEST pass). Shipped **F9 v1** —
  per-setter Retell lock + ownership sync: migration `20260627130000` (`is_retell_locked` + snapshot/version
  cols + partial index, applied live); pure guard core `_shared/retell-lock.ts` (12 unit tests, TDD); a
  SERVER-ENFORCED write-guard across all retell-proxy write paths (single-target THROW 423
  `setter_retell_locked`; the two BULK loops `set-voicemail`/`refresh-booking-tool-messages` SKIP locked
  setters + report them); `make-retell-outbound-call` skips the at-call voicemail PATCH for a locked setter
  but **still dials**; new `set-setter-lock` + READ-ONLY `pull-retell-config` (snapshot + version-drift); tile
  lock toggle + confirm dialogs + Retell-locked/sync badges + Pull button + Edit-entry gating; `useRetellApi`
  now surfaces the structured 423 body. **retell-proxy v46, make-retell-outbound-call v27.** Two cheap in-area
  fold-ins (Brendan's call): **F8-1** (cost-ceiling inputs agency-gated) + **G3-8(c)** (deleted dead
  ApiManagement/SupabaseConfigCard/RefreshCostDialog). tsc + build + 118 edge tests green; verified read-only
  (columns/index live, guard query valid, fns booted). F9 v2 → DEFERRED. F9 v1 + F8-1 + G3-8(c) → TEST_LIST.
  → emits the **Session 7** TEST prompt. (F8 build = **Session 8**, after the TEST pass.)
- [~] **Session 7 — TEST pass (BRENDAN drives, Claude verifies).** IN PROGRESS — **UI half (LIVE-A) done 2026-06-28;
  phone-half done 2026-06-30** (handoff `Operations/handoffs/2026-06-30-session7-test-pass-phone-half.md`). PASSED
  (→ COMPLETED_LOG): the ~21 read-only banks + LIVE-A UI (F2b/F6/B-6×2/F9 lock/bulk/Pull) + **phone-half**
  B-4(6.2), F2c, G3-3, 6.11, 6.12b(call+SMS), the full **F9 lifecycle** (outbound-dials-while-locked + unlock+
  rename-no-423), B-3(6.4), B4-call, latency. **Bugs found this half →** BUG_LIST: **BOOK-1** (SMS setter
  fabricates "booked out" + never books on an OPEN calendar — model/prompt, proven NOT API; **H**), **BOOK-2/3**
  (latent shared-fn slot-grid/tz defects; **L**, shared-fn defer), **SMS-OBS-1** (tool calls not persisted; **M**),
  **MODEL-1-HARDENING** (free-text llm_model can break all AI; **M** — the live misconfig itself FIXED), **PHONE-CLEAR-1**
  (normalized_phone not cleared on phone-clear; **L**). **Config:** SMS latency 60-82→12s. **Still owed (→ Session 7-finish):**
  B-5, F1, LIVE-D (B-2 ×4 + manual-send/429), LIVE-E (F3/F4), G3-6 Tier-3, and **3.12 SMS booking (blocked on BOOK-1)**.
  Because BOOK-1 is structural, an **overnight Text-Setter repair (Session 7.5)** runs first, then the fix pass.
- [x] **Session 7.5 — Overnight Text-Setter repair + FOLD-IN ALL OPEN BUGS, v2 (CODE; branch-only, DEPLOY-NOTHING).** **DONE 2026-07-01** — branch `worktree-overnight+text-setter-repair-allbugs` (8 fix commits + BOOK-2/3 char tests; **NOTHING deployed**). All 11 open bugs dispositioned: **7 staged `[~]`** (SMS-OBS-1, BOOK-1 code, MODEL-1a, F9-1, VM-1, PHONE-CLEAR-1, G3-8a) · **BOOK-2/3** char-test+writeup · **API-DEPR-1 + G3-7** deferred · **MODEL-1b** demoted (save UI is a known-IDs dropdown). BOOK-1 prompt half stays report-only `[B]`. test:node 80/0, test:edge 125/0, vite build green; adversarial verification council = **DONE-CONFIRMED**. Deploy checklist (VM-1 retell-proxy v46→v47 = the only Voice-gated unit) + Voice gate + the tomorrow prompt are in `Operations/handoffs/2026-07-01-overnight-text-setter-repair-allbugs.md`. _Original scope note below._
  Triggered by BOOK-1. Council-vetted **twice** (GO-with-changes). Research-then-repair the Text setter (vs Voice vs the
  n8n reference `n8n/exports/Text_Engine_REVERSE_ENGINEERED.md`; **no upstream remote**) AND additively fold in EVERY open
  BUG_LIST item, each triaged into a frozen ledger: **fix-tonight-branch** (BOOK-1 code, SMS-OBS-1 persistence FIRST, F9-1,
  MODEL-1b) / **stage-on-branch+deploy-checklist** (MODEL-1a, VM-1 [Voice-gated], PHONE-CLEAR-1, G3-8(a)) /
  **write-up+characterization-test** (BOOK-2/3, shared `voice-booking-tools` = read-only) / **defer** (API-DEPR-1, G3-7).
  A PLANNING council ratifies the ledger before code; an ADVERSARIAL VERIFICATION council gates "done" (they replace the
  absent reviewer). Both prompts report-only; DEPLOY NOTHING; frozen baseline (retell-proxy v46 / make-retell-outbound-call
  v27 / voice-booking-tools) untouched. Kickoff prompt (v2) = the `2026-06-30` handoff. **Done when:** branch + comparison doc
  + per-bug ledger + deploy checklist (Voice-regression gated) + passing unit tests (no deploy) + an emitted **tomorrow**
  testing prompt; Brendan deploys + live-verifies in daylight.
- [~] **Fix pass — ABSORBED into 7.5 (staged on its branch 2026-07-01).** F9-1 / VM-1 / SMS-OBS-1 / MODEL-1-HARDENING / PHONE-CLEAR-1 / G3-8(a) / BOOK-1
  code all landed on 7.5's branch (deploy-pending). **What truly remains as their own sessions:** **API-DEPR-1** (frozen-baseline multi-fn
  Retell/GHL deprecation migration + live-API re-confirm) and **G3-7** (breaking vite major bump). (INB-1, UI-1, F11 already
  built in the 2026-06-29 overnight build → live-verify only in Session 7-finish, not rebuilt.)
- [ ] **Session 7-finish — deploy 7.5's branch + remaining live TEST (BRENDAN drives, Claude verifies).** First DEPLOY the
  7.5 branch per its checklist (Voice-regression gated for the retell-proxy v47 bump), THEN: B-5, F1, LIVE-D (B-2 ×4 +
  manual-send/429), LIVE-E (F3/F4), G3-6 Tier-3, **3.12 SMS booking** (re-test after the BOOK-1 repair + applying the
  report-only prompt tweak), + live-verify the staged fixes (F9-1, VM-1, SMS-OBS-1, MODEL-1, PHONE-CLEAR-1, G3-8(a)) +
  F11/UI-1/INB-1. **Done when:** TEST_LIST green / all fails logged.
- [ ] **Session 8 — F8 cost-to-price calculator (CODE, PLAN mode — money math + agency governance).** The
  second half of the split. Build per `FEATURE_ROADMAP` "Feature spec - F8" + the decided scope: pure
  `computeBlendedRate` (integer minor units + explicit FX step + markup multiplier + deterministic rounding;
  TDD the core) and an **agency-only** rate panel on Sub-Account Config (mirror `ClientAccountFieldConfigEditor`
  governance), per-sub-account override on a global default. **NEW requirement:** a per-sub-account "show rate
  to client" toggle (agency-set) that surfaces a read-only blended-$/min display card in that client's own
  account settings (markup/breakdown stay agency-only). **Done when:** computeBlendedRate tests pass; the panel
  edits/persists + the client display card respects the toggle; client role can't see the markup internals →
  TEST_LIST. → emits the **First-client milestone**.
- [ ] **First-client milestone (BRENDAN, gated).** Not a Claude code session. At the first paying client:
  flip Stripe live (backfill `subscription_status` → set `ENFORCE_SUBSCRIPTION_GATE=true`), provision the
  GHL/Retell/Unipile webhook secrets + arm `retell_webhook_secret` (6.6), register AU SMS A2P for
  `+61481614530`. See `Docs/DEFERRED.md`. After this, v1 is live + 100%.

When Sessions 0-8 are `[x]` and TEST_LIST is green, BFD-setter is at v1 "100%". v2 = the lifecycle
system + A/B + analytics + HubSpot + F9 v2 (`Docs/DEFERRED.md`).
