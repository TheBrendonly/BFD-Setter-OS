# BFD-Setter — Completed / Closed Items Log (archive)

Items closed out of the active lists. Newest first. The active lists are in the repo root + `Docs/`
(`BUG_LIST.md`, `FEATURE_ROADMAP.md`, `BRENDAN_TODO.md`, `TEST_LIST.md`, `DEFERRED.md`).

## 2026-06-25 — Session 3 (settings + setter cleanup)

Frontend build green; DB migrations applied via Management API; **no edge-fn/Trigger deploy needed** (F2b reuses the existing `retell-proxy update-phone-number` action). All items → `TEST_LIST.md` for live verification.

- **B-4 settings nav split** — reality check: the client/admin split was **already shipped** in the 2026-06-17 account-access restructure (SYSTEM nav already gated; deep config already reached via the sub-account click-through; self-serve fields already admin-governed via `ClientAccountFieldConfigEditor`). Remaining delta was the naming finish: renamed the agency nav item + page title "Manage Sub-Accounts" → **"Sub-Accounts"** (`ClientLayout.tsx`, `ManageClients.tsx`). The `[B]` field-access "decision" is a standing per-sub-account governance editor, not a build input (moved to BRENDAN_TODO).
- **F2 — UUID-native setter + inbound-only binding.** (a) Picker already UUID-native; the live default cadence `40e8bea3` and **every** workflow were verified already free of `Voice-Setter-N` slot strings → the data migration was a **no-op**. Added a defensive amber "legacy ref — re-select to migrate" signal in the `Engagement.tsx` picker (F2e). (b) New `voice_setters.is_inbound` boolean + partial unique index `voice_setters_one_inbound_per_client` (migration `20260625130000`, applied live). New `useSetInboundSetter` hook wired to the existing inbound toggle (`PromptManagement.tsx` / `DirectionsToggle`): toggling sets the flag (clears others), points `clients.retell_inbound_agent_id` at the setter's agent, and **auto-rebinds the live Retell inbound number** (`inbound_agents`) — Brendan's chosen behavior; reverts the toggle on failure; toggle now loads from `is_inbound` (the SoT). (c) Removed the per-setter `RetellPhoneNumberSelector` from `AgentConfigBuilder.tsx` and **deleted** the component; relocated phone-number import/management to the **API Credentials** page via the existing `RetellPhoneNumbersTab` (it already had Twilio import). Outbound from-number unaffected (`retell_phone_1` fallback stands).
- **F5 — n8n decommission.** The n8n code path was **already gone** (`processMessages.ts` throws if not on the native engine — no `else` branch survives). Railway shutdown → BRENDAN_TODO. The optional `clients.text_engine_webhook` column drop is **deferred** (it's wired into `clients_public`; dropping needs a coordinated view rebuild — not worth the risk for one inert column) → DEFERRED.
- **F6 — removed setup-guide quizzes.** Deleted `MultiAgentLogicStep.tsx`, `VoiceInboundLogicStep.tsx`, and the orphaned `QuizQuestion.tsx`; relocated the shared `QuizNavigationState` type to `setup-guide/quizNavigationState.ts` (still used by `VoiceOutboundLogicStep`). Removed the two step objects + imports from `SetupGuideDialog.tsx` and **renumbered** the positional step-ids + decremented the `SETUP_PHASES` counts (text 8→7, voice 7→6) so prompt-save completion still maps correctly.
- **F7 — deleted draft cadence `c206da3e`** (+ its **inert companion** `engagement_campaigns` row `326ea535`, which the FK required and which had 0 references anywhere despite a stale `status='active'`). Transactional delete via Mgmt API, verified gone.

## 2026-06-25 — Session 2 (security/quality sweep)

- **G3-1 (S2b-4) fail-closed on NULL `intake_lead_secret`** — was ALREADY fixed in `49a594e` (audit sweep 2026-06-23): both `voice-booking-tools` and `kb-ingest` now return 401 when the client's `intake_lead_secret` is NULL (stricter than asked — covers read tools too). It was simply never moved off `BUG_LIST`. No code change this session; closed here. The other Session-2 items (G3-2 disambiguation, G3-3 outcome-stamp guard, G3-4 status codes, G3-5 esbuild override, types.ts drift) are deployed and live in `TEST_LIST.md` pending Brendan's UI verification.

## 2026-06-25 — list/doc reconciliation session (with Brendan)

Closed:
- **Inbound neutral greeting (item 3 / 6.8 inbound)** — DONE. Verified live: the inbound number `+61481614530` answers on a dedicated **"Inbound BFD Agent"** (`agent_b2f6495`, LLM `llm_9dd6af7` v2) opening "Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital… What can I help you with?" (no `{{first_name}}`). Earlier confusion was a stale memory claiming inbound==outbound==`agent_f45f4dd`.
- **Trigger.dev call latency** — DONE. Root cause was a Trigger.dev region dequeue incident (platform/region), now resolved; not a concurrency cap.
- **6.8 greeting `{{first_name}}`** — DONE. Outbound personalizes ("Hey {{first_name}}, it's Gary…"), inbound is neutral. Both correct.
- **F10 rotate old anon key `awzlcmdomhtyqjabzvnn`** — DONE (Brendan).
- **6.13 GHL Supabase-secret custom fields** — VERIFIED-CLEAR (0/123 fields match).

Dropped (will not track):
- **New-setter "Joe's Diner" seed prompt** — Brendan won't onboard people this way; removed from all lists.

Decisions locked (drive the active BUG/FEATURE items):
- Setter name source-of-truth = the setter-edit-page name field (and the duplicate flow writes the same field). → B-1.
- STOP + inbound = internal-first by-phone, drop the GHL lookup. → B-2.
- Settings nav: client sees only "My Account"; admin sees "My Account" + "Sub-Accounts" (list → click → config). → B-4.
- Voice-setter model = one setter flagged inbound; outbound chosen at campaign/workflow level; no per-setter outbound binding (kills old 2.3). → F2.
- Cadence direction = the lifecycle system (3.5/3.6/3.7); flat 28-node draft `c206da3e` deleted. → DEFERRED (major).
- n8n to be decommissioned (F5); the setup-guide quizzes that teach the n8n/1prompt model to be removed (F6).
- GHL SMS-in-Conversations: drop the marketplace conversation-provider near-term; ship the deep-link custom field instead (F1).

Git hygiene: deleted all merged/stale local + remote branches on `origin` (Forgejo) and `github`; kept only `main` + `feat/cadence-v2-lifecycle-wip` (the lifecycle WIP). Removed the merged `internal-by-phone-leads` worktree.

> Prior shipped work (audit waves 2026-06-10/19/23, billing B1/B2, session-1 hardening, S6 features, clients_public boundary) is recorded in `Docs/ROADMAP.md` and the dated handoffs under `Operations/handoffs/`.
