# BFD-Setter — Master Session Plan (to v1 "100%")

**This file is the single source of truth for the session sequence.** Prompts point here; they do NOT
duplicate it. Every session keeps this file current, then emits the next session's prompt from it.
"100%" = rock-solid for the current live setup + ready to onboard a paying client. The deferred /
lifecycle work (`Docs/DEFERRED.md`) is v2 and NOT on this critical path.

The 6 canonical lists are the detail behind each session: `Docs/BUG_LIST.md`, `FEATURE_ROADMAP.md`,
`Docs/BRENDAN_TODO.md`, `Docs/TEST_LIST.md`, `Docs/DEFERRED.md`, and `Docs/PROMPT_UPDATE_LIST.md` (prompt-content
edits Brendan applies via the UI, report-only). Closed items → `Docs/archive/COMPLETED_LOG.md`.

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
- [x] **Session 7.5 — Overnight Text-Setter repair + FOLD-IN ALL OPEN BUGS, v2 (CODE).** **BUILT 2026-07-01 + MERGED to main + DEPLOYED LIVE 2026-07-01** (overnight, alongside F8 — Brendan directed a go-live; handoff `Operations/handoffs/2026-07-01-f8-plus-7.5-deploy.md`). Deployed: Trigger 20260630.1 (SMS-OBS-1/BOOK-1 code/MODEL-1a), `tool_invocations` + `client_pricing_config` migrations, `execute-lead-webhook` v1, frontend (Railway), **retell-proxy v46→v47 (VM-1)** behind a read-only Voice smoke (0 agents mutated; the behavioral answered-call gate still owed → Session 7-finish). Branch `worktree-overnight+text-setter-repair-allbugs` (8 fix commits + BOOK-2/3 char tests). All 11 open bugs dispositioned: **7 staged `[~]`** (SMS-OBS-1, BOOK-1 code, MODEL-1a, F9-1, VM-1, PHONE-CLEAR-1, G3-8a) · **BOOK-2/3** char-test+writeup · **API-DEPR-1 + G3-7** deferred · **MODEL-1b** demoted (save UI is a known-IDs dropdown). BOOK-1 prompt half stays report-only `[B]`. test:node 80/0, test:edge 125/0, vite build green; adversarial verification council = **DONE-CONFIRMED**. Deploy checklist (VM-1 retell-proxy v46→v47 = the only Voice-gated unit) + Voice gate + the tomorrow prompt are in `Operations/handoffs/2026-07-01-overnight-text-setter-repair-allbugs.md`. _Original scope note below._
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
- [x] **Fix pass — ABSORBED into 7.5 + DEPLOYED 2026-07-01.** F9-1 / VM-1 / SMS-OBS-1 / MODEL-1-HARDENING / PHONE-CLEAR-1 / G3-8(a) / BOOK-1
  code all merged to main + deployed. **What truly remains as their own sessions:** **API-DEPR-1** (frozen-baseline multi-fn
  Retell/GHL deprecation migration + live-API re-confirm) and **G3-7** (breaking vite major bump). (INB-1, UI-1, F11 already
  built in the 2026-06-29 overnight build → live-verify only in Session 7-finish, not rebuilt.)
- [~] **Session 7-finish — live TEST pass (BRENDAN drives, Claude verifies).** 7.5 + F8 + Session 8.5 (F13/F14) are DEPLOYED, so
  this is purely the BEHAVIORAL live-test pass, **consolidated to reduce repeated work**: **Voice-regression confirmation FIRST**
  (one outbound call: booking works + B-3/B-5 survive + VM-1 voicemail lands; roll retell-proxy back to v46 if it regressed),
  then one SMS exchange (BOOK-1/3.12/SMS-OBS-1/MODEL-1), one fresh GHL contact (F1/B-5/B-2), one agency→client login pair
  (F8 panel + client card toggle + F13 ×4 + F14 ×2 + INB-1/UI-1/F11), plus B-5, LIVE-D (B-2 ×4 + manual-send/429),
  LIVE-E (F3/F4), G3-6 Tier-3, F9-1, PHONE-CLEAR-1, G3-8(a). **Done when:** TEST_LIST green / all fails logged.
  _IN PROGRESS 2026-07-03 (handoff `2026-07-03-session7-finish-voice-gate.md`): **voice gate PASSED** — booking + B-3 + B-5
  live-confirmed (call `call_d5625539`, booking `4f7c76a0`); **v47 SAFE, no rollback**. Preconditions A1 (BOOK-1 rule added via
  the Text setter's IDENTITY→Agent Mission field) + A2 (5 setters re-saved) + A3 (Property Coach name reverted) DONE.
  **VM-1 FAILED** the gate (still "partial", 0/5 agents; re-opened in BUG_LIST — v47 insufficient, needs draft-first +
  `static_text`)._

  **CONTINUED 2026-07-03 (handoff `2026-07-03-session7-finish-prompt-auth-1-detour.md`): the SMS-exchange leg of the
  remaining matrix triggered a full unplanned detour.** The SMS test found BOOK-1 recurring (a hidden stale prompt
  rule "Available days: Tue/Wed/Thu ONLY" refused an open Monday, then booked the wrong day for an accepted time) →
  root-caused as a systemic prompt-authoring problem, not a typo → filed **PROMPT-AUTH-1** (High) → a dedicated solo
  session (Fable research/design → Opus build, both supervised in a separate session) built the full fix in ~3 hours
  → independently re-verified in THIS session (tests re-run fresh, 2 riskiest files read line-by-line, new edge fn
  authz checked, a live migration-report run generated fresh) → an adversarial multi-agent verify pass (3 lenses,
  refute-gated) confirmed the core fix holds and surfaced 3 follow-on gaps (SMS-MEM-1, FOLLOWUP-PROMPT-1,
  PROMPT-LINT-1) → Brendan deployed PROMPT-AUTH-1 live (main `6c5c339`+`157bb8f`) from a separate session → a live
  multi-turn SMS regression confirmed the P0 fix works (Wed 8 Jul 2:30pm Sydney booking, no fabrication, "Sydney
  time" named) AND surfaced SMS-MEM-1 (separate, pre-existing, unrelated) → all 3 follow-on bugs + a MODEL-1-HARDENING
  UI hardening were then FIX-STAGED on a new branch `feature/overnight-bugfix` by further parallel work (not yet
  deployed as of this writing; test:node 113/113, test:edge 200/200 green). Full detail + the exact commit graph in
  the handoff. **The ORIGINAL Session 7-finish remaining test matrix (F8 UI, F13 ×4, F14 ×2 Resend-gated, fresh
  GHL contact F1/B-5/B-2 + TEST_PHONE_A cleanup, INB-1/UI-1/F11, LIVE-D, LIVE-E, G3-6 Tier-3, F9-1, PHONE-CLEAR-1,
  G3-8a) was NOT started this session** — Brendan chose to close out here and hand the rest to a fresh session once
  the `feature/overnight-bugfix` branch is deployed + re-tested. → next session prompt in the handoff.
- [x] **Session 8 — F8 cost-to-price calculator.** **BUILT + DEPLOYED LIVE 2026-07-01** (overnight; PLAN-mode
  approved then executed). Pure `computeBlendedRate` (integer micros, ONE FX step, bps markup + buffer,
  round-half-even once, line items sum exactly, separate fixed_monthly; 23 edge tests). Agency-only rate panel
  on Sub-Account Config + per-sub-account "show rate to client" toggle → read-only blended-$/min card on the
  client's account page. **THE TRAP, sealed server-side:** an adversarial council VETO caught that the agency
  `FOR ALL` policy matched client-role users (each client = own agency, so profiles.agency_id =
  clients.agency_id); fixed by role-gating the policy on `get_user_role(...) = 'agency'`. **Live trap proof
  9/9** (client cannot read markup/cost inputs via the API; agency gets the full breakdown). Deployed:
  `client_pricing_config` migration + `get-blended-rate` v1 + frontend. F8 touches NO Voice surface → not
  Voice-gated. Live behavioral UI verify (panel persists + client card toggle) → Session 7-finish.
- [x] **Session 8.5 — Full re-audit + F13 usage metering + F14 auth improvements (CODE, PLAN mode).** BUILT
  2026-07-02 on branch `feature/usage-billing-auth`; **DEPLOYED LIVE 2026-07-03 (supervised, Brendan
  reviewed + GO)**: main `ef8e9fc`, get-client-usage **v1** + invite-client-user **v1** (NEW),
  get-blended-rate **v2**, check-reset-eligibility **v11**, update-client-password **v11**,
  retell-call-analysis-webhook **v26**, Trigger **20260702.1**, frontend (Railway on main push).
  Nudge backfill: 1 row repointed, 5 orphans skipped (deleted June test leads, correctly unattributable).
  **F13 trap proof 9/9 + F8 trap proof 9/9 live** (F8 proof gained snapshot-restore) + SQL hand-check
  EXACT MATCH (June period 12 min / 19 texts, fn == raw SQL). SMTP PATCH deferred (Resend items still
  with Brendan). Original build note follows. The session opened with a 5-agent read-only re-audit:
  lists-vs-live CLEAN (all 12 edge fn versions match, all tables live, no drift), security STRONG (no new
  criticals; mintSecret entropy verified 192-bit; 2 new Low items AUTH-LEN-1 fixed-on-branch + RLS-SHAPE-1 watch),
  auth architecture confirmed correct (no new provider needed). **F13** = per-client billing anchor day +
  ceil-per-call minutes x blended rate + all-outbound-texts x a new `sms_llm` per_message component (Twilio is
  client-BYO) + per-part client_display toggles + `get-client-usage` edge fn (fresh-literal role split, same trap
  class as F8) + dashboard/account/agency panels (fixes F8's "not on the client dashboard"); ZERO migrations
  (everything in the client_pricing_config jsonb). **F14** = invite-client-user fn + invite UI + client
  self-password-reset + ResetPassword handles type=invite + 12-char fix; Resend SMTP is a config step gated on
  Brendan's Resend/DNS items. ~40 new tests; test:edge 188/0, test:node 80/0, tsc + vite build green;
  `scripts/f13_usage_trap_proof.ts` ready to run at deploy. → next: Brendan review → supervised deploy →
  the F13/F14 TEST_LIST items fold into Session 7-finish.
- [x] **Overnight stage-only bug-fix run — BUILT 2026-07-03; DEPLOYED LIVE 2026-07-04 (Session 9). Branch `feature/overnight-bugfix` merged to `main` (`4a22b8b`); `g3-7/vite-major` still on its own branch → Session 10.**
  A single unattended run cleared the residual staged queue after the PROMPT-AUTH-1 deploy. 10 items, one commit
  each, green after every one (final: test:node 122/122, test:frontend 8/8, test:edge 202/202, tsc + vite build
  green). SMS-MEM-1 (`379e5f6`), PROMPT-LINT-1 (`5e0305a` + review `d8111d6`), FOLLOWUP-PROMPT-1 (`709bf92` +
  review `29ce9a4`), MODEL-1-HARDENING UI (`3c42a45` + review `19a6fb4`), PHONE-CLEAR-1 3 residual writers
  (`8e64bcc`), F9-1 2 residual leak paths (`2cf1a8b`), RLS-SHAPE-1 migration-file-only (`e453913`), API-DEPR-1
  list-agents→v2 + hydration (`5d40ca2`), VM-1 draft-first + static_text (`acfc387`), G3-7 vite 8.1.3 on its own
  branch (`6cf4f24`). An adversarial branch review found 6 Important issues, all fixed and re-verified in the
  same run (canonical-id save, anchored guard, lint-on-the-right-store, compound-word false positives,
  followup-mode availability wording, shared 30s-timeout tool caller). Handoff:
  `Operations/handoffs/2026-07-03-overnight-bugfix-run.md`. **This SUBSUMES most of Session 9's code** (API-DEPR-1
  is now mostly staged) and does Session 10's work early (G3-7). What remains: the SUPERVISED DEPLOY + live tests
  (below), and Session 9's leftover analysis-fields migration.
- [x] **Session 9 — supervised deploy of the overnight branch. DONE 2026-07-04 (Opus 4.8, plan ON, Brendan GO).**
  Merged `feature/overnight-bugfix` → `main` (`4a22b8b`, fast-forward), pushed origin+github. Deployed: **Trigger.dev
  20260703.2** (SMS-MEM-1, FOLLOWUP-PROMPT-1), **retell-proxy v47→v48** (VM-1 + API-DEPR-1 list-agents), **verify-credentials
  v2→v3**, **save-external-prompt v14→v15**, **RLS-SHAPE-1 migration applied** (role gate confirmed live). Read-only Voice
  smoke on v48 PASSED (POST `/v2/list-agents`→24 agents + get-agent hydration, 0 agents mutated). **Frontend was ALREADY
  live** — Railway had auto-deployed the branch to production overnight (proven: live prod bundle contains branch-only
  MODEL-1 strings), so the fast-forward main push needed no rebuild. **New finding DEPLOY-1** (Low, BUG_LIST + BRENDAN_TODO):
  Railway ships feature branches to the prod domain, bypassing the stage-only gate → pin prod deploy to `main`.
  **Deferred out of Session 9 (Claude rec, Brendan agreed):** the deprecated `analysis_*_prompt` → `post_call_analysis_data`
  migration is bigger + riskier than the plan framed (full-stack: VoiceRetellSettings UI + save path + retell-proxy + the two
  downstream analysis webhooks; shifts live analysis behavior; fields still work today) → **its own scoped session (API-DEPR-2)**.
  The answered-call Voice-regression + all frontend/SMS retests are Brendan-driven, now in TEST_LIST. Optional fold-in
  (**BOOK-2/3** + **SMS-METER-1** shared-fn edits) NOT taken. → Session 10 (G3-7).
- [x] **Session 10 — G3-7 vite-8 merge. DONE 2026-07-04 (Opus 4.8, plan ON, Brendan GO: headless-verify + go live now).**
  Rebased `g3-7/vite-major` onto `main` (clean — vite commit vs docs-only, no overlap) → `--ff-only` merge to `main`
  (`407b66e`) → pushed origin + github → Railway prod rebuild on vite 8 triggered. After a fresh `npm install`
  (node_modules confirmed **vite 8.1.3** + plugin-react-swc 4.3.1): `npm run build` exit 0 (4.74s, Rolldown — the
  Railway-equivalent gate), `tsc --noEmit` 0, `test:frontend` 8/8, `npm audit` **0 vulns**; render gate = the
  **preview of the prod build** (`vite preview :4173`) served index + all SPA routes 200, and the dev server booted
  on vite 8 (464ms, polling). Per Brendan's call the **live human browser click-through was deferred to his testing
  session** (kept as the G3-7 row in `TEST_LIST.md`) — G3-7 closes to `COMPLETED_LOG.md` when that renders green.
  The greenserver inotify sysctl + DEPLOY-1 (pin Railway to `main`) remain open BRENDAN_TODO items. → emits the
  **API-DEPR-2** prompt (or First-client if Brendan's async live TEST pass has gone green).
- [x] **API-DEPR-2 — deprecated Retell analysis-prompt fields → `post_call_analysis_data`. DONE 2026-07-04 (Opus 4.8, plan ON, Brendan approved).**
  Migrated `analysis_summary_prompt`/`analysis_successful_prompt`/`analysis_user_sentiment_prompt` (Retell 06/15/2026 removal) into
  `post_call_analysis_data` `type:"system-presets"` entries (`call_summary`/`call_successful`/`user_sentiment`). **The Session-9 "coordinated
  webhook changes" worry was REFUTED** by current docs + the `get-call` schema + live reads: system-preset outputs stay **TOP-LEVEL** on
  `call_analysis`, so the two analysis webhooks (`retell-call-webhook`, `retell-call-analysis-webhook`) were NOT touched. Full-stack but storage
  model unchanged: new pure `retell-proxy/postCallAnalysis.ts` (`buildPostCallAnalysisData`, 6 unit tests, idempotent + dedup-by-name +
  deploy-order-safe) wired into `buildAgentUpdatesFromVoiceSettings`; frontend `PromptManagement.tsx` save payload folds the 3 prompts into
  presets and drops the deprecated keys (the 3 textareas + config persistence stay); `DEFAULT_RETELL_ANALYSIS_USER_SENTIMENT_PROMPT` const added.
  tsc 0, vite build green, test:edge **208/0**. **retell-proxy v48→v49 (Voice-gated): read-only smoke PASSED** (list-agents 200; canonical
  agents byte-for-byte unchanged, 0 mutated). Accepted minor REPORTING-only shift (the app's analysis prompts now actually apply; today they were
  silently stripped so analysis ran on Retell defaults) — no call/booking behavior touched. API-DEPR-1 is now fully code-complete. Owed = the
  Brendan-driven answered-call Voice gate (shared with v48) + a post-save `get-agent` shape check → `TEST_LIST.md`. → next = First-client (or the
  async live TEST pass if still open).
- [ ] **First-client milestone (BRENDAN, gated).** Not a Claude code session. At the first paying client:
  flip Stripe live (backfill `subscription_status` → set `ENFORCE_SUBSCRIPTION_GATE=true`), provision the
  GHL/Retell/Unipile webhook secrets + arm `retell_webhook_secret` (6.6), register AU SMS A2P for
  `+61481614530`. See `Docs/DEFERRED.md`. After this, v1 is live + 100%.

**Remaining sequence to v1 "100%" (the relay follows this order):**
1. **Session T — the consolidated live TEST pass — DONE (largely AUTOMATED) 2026-07-05.** Claude drove it via
   a new harness (headless Playwright + Twilio-signed inbound-SMS simulation + programmatic Retell dials +
   Mgmt-API SQL); only 3 phone calls needed Brendan. RUN 0/1/2/3/5/6 all PASSED (voice booking on v49, VM-1
   push+play, B-5, SMS booking/memory/obs/STOP, B-2 outage, F8/F13/F11/UI-1/F9-1/PROMPT-LINT-1/MODEL-1/X-Ray).
   Bugs found: **CANCEL-1, SWEEP-1 (a/b/c), G3-6-SCHEMA-1** + PU-8. Full results + reusable harness + the next
   prompts: `Operations/handoffs/2026-07-05-test-session.md` (+ `scripts/test-harness/`). STILL OWED (next
   session, autonomous): API-DEPR-2(a), RUN 4 (F3/F4/followup), RUN 7 (F1), F13 client-eye (via Fable).
1b. **Session Test-finish — AUTONOMOUS — DONE 2026-07-05.** Claude drove every remaining drivable RUN
   send-free via the harness (Mgmt-API SQL, service-key edge fns, Trigger.dev v1 REST, GHL/Retell REST):
   **RUN 4 F4** (tz nudge SKIP: scanned 3 / skipped 3 / nudged 0), **RUN 4 F3** (cadence pause→resume→END NOW,
   no double-send), **RUN 4 FOLLOWUP-PROMPT-1** (raw_exchange shows the injected availability + time-anchor
   blocks, cancel branch, 0 sends), **RUN 7 F1** (fresh GHL contact deep-link field set, one write, no 2nd SMS)
   — all PASS → `COMPLETED_LOG.md`. New Low bug **SYNC-LOG-1** (missing `sync_ghl_executions` table). **API-DEPR-2(a)**
   + **F13 client-eye** carried to the Fable session (both need a fresh throwaway agent/client; retell-proxy needs
   a real user JWT). Handoff `Operations/handoffs/2026-07-05-test-finish.md`; emitted the Build + Fable prompts.
2. **Session Build — fix EVERY open bug** (handoff Prompt B; folds in Session S's BOOK-2/3 + SMS-METER-1).
3. **Session Fable — END-TO-END new-client onboarding via the SOP** to find holes + what a real first-client
   onboarding needs (handoff Prompt C; overnight). Includes the F13 client-eye check.
3b. **Session Onboarding-fix — AUTONOMOUS — DONE 2026-07-06.** Fixed all five onboarding-gate bugs, one
   commit each (`9f5b959`..`bb6322a`): **ONBOARD-1** (`use_native_text_engine:true` in ALL THREE UI create
   paths: CreateClient, Onboarding, sidebar Add Sub-Account dialog, plus the two go-live-flip writes),
   **GOLIVE-1** (webhook-manifest v2→v3 DEPLOYED + live-verified: blank client now `goLiveReady:false`;
   per-check `goLiveChecklist` in the response + a "Still missing" line on the card; bookings-webhook got a
   real lastReceived signal), **ONBOARD-2** (up-front external-Supabase guard on create-setter + text-save,
   external-write-first so no orphan `prompts` row), **ACCESS-1** (AgencyRoute on `prompts/text`+`prompts/voice`
   + client sidebar trim), **ONBOARD-3** (12-char password sweep, incl. a REAL hole: the sidebar dialog's
   create-login had no length check and admin createUser bypasses the GoTrue policy). Tests 127/127 node +
   8/8 frontend + 217/217 edge; tsc + vite build green. GOLIVE-1 → `COMPLETED_LOG.md`. **The 4 frontend fixes
   are NOT live until Brendan runs `git push github main`** (auto-mode blocked the GitHub push; Railway
   builds from GitHub) → live rows in `TEST_LIST.md` "Onboarding-fix pass". Handoff
   `Operations/handoffs/2026-07-06-onboarding-fix.md`.
3c. **Session Autonomous-test-pass (part 1) — DONE 2026-07-06.** Drove the tool-drivable half of the
   post-deploy regression on the live v23 + Trigger 20260705.1 stack: **BOOK-2 (SMS)** exact-time booking,
   **BOOK-3 (SMS)** Sydney slot window (no day-shift), **SMS-METER-1** direct-tool meter stamp all PASS;
   **RLS-SHAPE-1** closed (policy qual role-gated, client JWT → 0 rows); **G3-6-SCHEMA-1** config gate
   reconfirmed. The CANCEL-1 cancel/reschedule + all VOICE legs were DEFERRED to the supervised voice
   session (TEST_PHONE_A holds a live confirmed appt; an unattended cancel misbind could destroy a real
   one). Browser-UI re-checks could not run (harness Playwright agency session expired / refresh token
   single-use). Shared-fn pass stays `[~]` until the voice half lands. Handoff
   `Operations/handoffs/2026-07-06-autonomous-test-pass.md` (carries the Prompt-2 human voice prompt).
3d. **Session Voice + browser (finishes the shared-fn pass) — DONE 2026-07-06.** Hybrid: Claude drove the
   browser-UI + SMS legs autonomously (headless Playwright + harness, one 2FA code at the start), Brendan did
   the one answered outbound voice call. **PART A** browser (ONBOARD-1/2/3, GOLIVE-1 UI, ACCESS-1, SWEEP-1a/b/c,
   F9-1, PHONE-CLEAR-1, G3-7) + SMS (CANCEL-1 cancel + fabricated-id refusal, BOOK-2/3) all PASS; **PART B**
   voice on v49+v23 (VOICE GATE booked, CANCEL-1 reschedule+cancel bound the real eventId, SMS-METER-1 in-call
   stamped a meter row) all PASS. **Shared-fn pass CLOSED** — CANCEL-1/BOOK-2/BOOK-3/SMS-METER-1 both halves
   green → `COMPLETED_LOG.md` (out of BUG_LIST). New bugs: **RESCHED-SMS-1** (SMS reschedule false-done +
   tool-selection), **CHATS-DM-1** (`dm_executions.messages` 400), **FOLLOWUP-DURING-CALL-1**,
   **CONTACTS-EDIT-DEAD-1**; **PU-9** (voice dead-air), **PU-10** (reschedule honesty). Handoff
   `Operations/handoffs/2026-07-06-voice-browser-session.md`. **Emitted F15.** Only F15 → F16 → the gated
   First-Client Milestone remain to v1 "100%".
3e. **Combined build session (bugs + F15 + F16 + F17-p1) — DONE + DEPLOYED LIVE 2026-07-07 (Opus 4.8, plan ON,
   Brendan GO: build all three F16 dial features + deploy everything).** All 5 open CODE bugs (Phase A: CHATS-DM-1,
   HOURS-1 + folded FOLLOWUP-DURING-CALL-1, RESCHED-SMS-1, CONTACTS-EDIT-DEAD-1) + F15 (funnel + weekly report) +
   F16 (speed-to-lead + missed-call text-back + live-transfer, default-OFF flags) + F17-p1 (AU calling-hours clamp
   + recording-disclosure toggle) built, committed per item, tested (test:node 147 / test:edge 227 / build green),
   and DEPLOYED: 4 migrations (Mgmt API), edge fns bookings-webhook v9 / get-show-rate-funnel v1 / get-weekly-report
   v1 / make-retell-outbound-call v28 / retell-inbound-webhook v7 / retell-call-webhook v22, Trigger 20260706.1 (13
   tasks), frontend pushed origin+github (`8950f69`..`7a0b0b4`). HOURS-1 built ONE shared `trigger/_shared/
   businessHours.ts`; F17-p1 extended it with the AU legal clamp. Findings: live `bookings` is the phase7a schema
   (types.ts stale); inbound voice is Retell-terminated so F16(c) is Retell-disposition-driven (not a Twilio
   webhook). Deferred (noted): F15 top-objections + pipeline-value, F16(d) summary-on-failed-transfer + PU-11.
   Handoff `Operations/handoffs/2026-07-07-combined-build-bugs-f15-f16.md`; live checks → TEST_LIST; manual steps
   (dogfood-enable, GHL appt-status workflow, PU-6/10/11) → BRENDAN_TODO. Pipeline:
   `[✓] Voice + browser  [✓] Combined build: bugs + F15 + F16 (DONE 2026-07-07)  [ ] First-Client Milestone (gated)`.
3f. **Session P1 — full list audit + reconciliation + Brendan action pack. DONE 2026-07-07 (Sonnet, execute
   mode, docs/report-only — no product code, no deploys, no prompt edits).** Cross-checked every open row across
   all 6 lists + `MASTER-TODO.md` against the live DB (edge-fn versions, table/column existence via
   `q.mjs`), git log, and the dated handoffs. **Result: `BUG_LIST.md` is now at 0 open items** — every logged
   CODE bug is either live-verified + archived, or shipped+deployed and awaiting only Brendan's behavioral pass
   (tracked solely in `TEST_LIST.md` now, no more duplication). Found + fixed a real reconciliation backlog: 8
   items had already passed their live test (some as early as 2026-07-03/05) but were never physically archived
   — **BOOK-1 + 3.12 SMS booking, DEPLOY-1, F11, UI-1, three of the four F13 UI checks, the PROMPT-AUTH-1
   full-prompt-visibility X-Ray check, the B-2 GHL-outage resilience leg, and API-DEPR-2(a) + the F13
   client-eye view** — all now in `COMPLETED_LOG.md` with their real pass dates cited. ~20 further stale/duplicate
   `[x]`-but-still-present rows across `BUG_LIST.md`/`TEST_LIST.md` (HOURS-1, RESCHED-SMS-1, CHATS-DM-1,
   FOLLOWUP-DURING-CALL-1, CONTACTS-EDIT-DEAD-1, the whole 5-bug onboarding-gate cluster, API-DEPR-1, G3-8,
   CANCEL-1/BOOK-2/BOOK-3/SMS-METER-1/VM-1/F9-1/PHONE-CLEAR-1/SWEEP-1abc/G3-7/F1/F3/F4/SMS-MEM-1/
   FOLLOWUP-PROMPT-1/PROMPT-LINT-1/MODEL-1-HARDENING(UI) duplicates) were removed since they were already
   correctly archived elsewhere. Fixed the duplicate `PU-8` id in `PROMPT_UPDATE_LIST.md` (renumbered the
   inbound-robustness item to **PU-12**). Ticked the `BRENDAN_TODO` "git push github main" row (confirmed via
   `git log`: `origin/main` and `github/main` are fully in sync, both carrying the onboarding-fix commits).
   Confirmed `Docs/ROADMAP.md` is still correctly banner'd as build history only (no change needed). Produced
   the consolidated **Brendan action pack** (`Operations/handoffs/2026-07-07-brendan-action-pack.md`): every
   `PROMPT_UPDATE_LIST` item verified live against the actual Retell agents (read-only), plus every open
   `BRENDAN_TODO` manual gate ordered by leverage. Full audit table + methodology in the dated handoff
   `Operations/handoffs/2026-07-07-p1-audit-reconciliation.md`. Pipeline:
   `[✓] Combined build  [✓] P1 audit + action pack (DONE 2026-07-07)  [ ] P2 (Brendan picks: DEFERRED.md review, or skip to P3)  [ ] P3 review+cleanup+research  [ ] First-Client Milestone (gated)`.
3g. **Session MAIN-OUTBOUND-SHARED-1 fix — DONE 2026-07-07 (Opus 4.8, plan ON, Brendan approved Option A).**
   Root-caused + fixed the one bug P1 had surfaced. "Main Outbound" had been running the Inbound agent
   (`agent_b2f6495…`) on real outbound dials. **Root cause = a structural slot/column collision, not a code
   regression:** Main Outbound sat on `voice_setters.legacy_slot=1`, and retell-proxy `SLOT_TO_AGENT_COLUMN[1]`
   maps to `clients.retell_inbound_agent_id` (a legacy single-agent column; outbound slots 2/3 were retired in
   P3a). Once the Inbound setter pointed `retell_inbound_agent_id` at `b2f6495` (~2026-06-26), the 2026-07-01
   batch Save & Push of Main Outbound (slot 1) re-read that column and `dualWriteVoiceSetter` clobbered the
   row's `retell_agent_id`+`retell_llm_id`. Forensic: outbound dials used `agent_f45f4dd…` through 2026-06-24,
   flipped to `b2f6495` from 2026-07-01 04:15 (right after the row's `updated_at` 03:40:34); no code shipped
   07-01. **Durable data fix (Option A, COMPREHENSIVE):** a voice setter spans 2 keying systems — the prompt/UI
   tile keyed by the `slot_id` string across 6 tables (prompts/agent_settings/prompt_configurations/prompt_docs/
   prompt_versions/setter_ai_reports) AND the `voice_setters` row keyed by `legacy_slot` — so the fix migrated
   the WHOLE setter off the poisoned slot 1 to slot 10 in one txn (85 slot-keyed rows `Voice-Setter-1→10`,
   `legacy_slot 1→10`, restored `agent_f45f4dd…`/`llm_a73df8…`, `clients.retell_agent_id_10=f45f4dd` for
   durability, moved the label). A future Save & Push re-reads slot 10 and won't re-clobber. Cadence/node
   routing is by `voice_setter_id` UUID (transparent to the rename), pre-flight audited. _(A first-cut moved
   only the `voice_setters` row → decoupled the tile; Brendan caught it, fully reverted, redone comprehensively.)_
   Restoring f45f4dd auto-resolved PU-3 + PU-7; PU-6 now open on it (scoped to Main Outbound only). No code, no
   prompt content, no Retell writes. Residual code flaw + the empty "Setter-1" tile → `DEFERRED.md` SLOT-MAP-1.
   Live answered-call verify → `TEST_LIST.md`. Handoff `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`.
   Pipeline: `[✓] P1 audit  [✓] MAIN-OUTBOUND-SHARED-1 fix  [ ] P2 (Brendan picks) or [ ] P3  [ ] First-Client Milestone (gated)`.
4. **Brendan solo block (parallel, no Claude session):** Setter-1 prompt migration, Resend SMTP → F14 E2E,
   sms_llm rate + billing anchor/toggles, n8n Railway shutdown, PROMPT_UPDATE_LIST items (see the 2026-07-07
   action pack for the full ordered list with exact live wording + paste-ready changes).
5. **Candidate pre-first-client feature sessions (Brendan picks; from the 2026-07-04 market research,
   `FEATURE_ROADMAP.md` F15-F17):** F15 client ROI visibility pack (show-rate funnel + weekly report) ·
   F16 never-miss-a-lead pack (speed-to-lead + missed-call text-back + live-transfer config) · F17 phase-1
   AU compliance (hours enforcement check + recording-disclosure toggle). Post-client queue: F18/F19/F20 + F12.
6. **First-client milestone (event-gated, Brendan + Claude assist):** Stripe live + `ENFORCE_SUBSCRIPTION_GATE`,
   webhook signing secrets + arm `retell_webhook_secret` (6.6), AU A2P registration for `+61481614530`, GHL
   reminder-workflow snapshot at onboarding. After this, v1 is live + 100%.
**API-DEPR-1/2 are DONE** (retell-proxy v49 live); Session 10 (G3-7) is DONE — vite 8 is live on `main`.
**`BUG_LIST.md` is at 0 open items as of Session P1 (2026-07-07)** — nothing is blocking the First-Client
Milestone on the CODE side; what remains is Brendan's live behavioral TEST_LIST pass (mostly the 2026-07-07
combined-build checks) + the BRENDAN_TODO manual gates in the 2026-07-07 action pack.

**Ready-to-run prompts for the whole relay live in `Docs/TEST_SESSION.md` RUN 10** (T-fix → Session S → F15 → F16,
each with a self-chaining ▶ PIPELINE footer) **and `Docs/FIRST_CLIENT_MILESTONE.md`** (the gated last step). Triggers:
say "run test session" to start; say "I'm onboarding a client" to surface the milestone.
**Functional 100% = Sessions 0-8 `[x]` + TEST_LIST green** (reached at the end of Session 7-finish); Sessions
9-10 + P1 clear the last open BUG_LIST items + the doc/list backlog; the First-client milestone is the actual
go-live. **P2 (Brendan picks) and P3 (review+cleanup+research)** are optional polish sessions between here and
the milestone — see the emitted prompts in the 2026-07-07 P1 handoff. v2 = the lifecycle system + A/B +
analytics + HubSpot + F9 v2 + F8 v2 (`Docs/DEFERRED.md`), off the 100% path.
