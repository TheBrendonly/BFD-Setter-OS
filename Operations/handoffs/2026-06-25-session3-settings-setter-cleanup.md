---
description: Session 3 close-out (settings nav finish + voice-setter cleanup) and the emitted Session 4 kickoff prompt for BFD-setter.
---

# Session 3 — Settings + setter cleanup (SHIPPED 2026-06-25)

## What shipped (all → `Docs/TEST_LIST.md`; frontend build green; DB via Mgmt API; **no edge/Trigger deploy**)

- **B-4 settings nav** — the client/admin split was **already shipped** (2026-06-17 restructure). Remaining delta was naming: "Manage Sub-Accounts" → **"Sub-Accounts"** (`ClientLayout.tsx`, `ManageClients.tsx`). The `[B]` field-access decision is a standing per-sub-account governance editor (Sub-Account Config → "My Account Field Access"), now noted in `BRENDAN_TODO.md`, not a build input.
- **F2 — UUID-native setter + inbound-only binding.**
  - (a) Picker was already UUID-native; **every** live workflow (incl. the default cadence `40e8bea3`) was verified free of `Voice-Setter-N` slot strings → the data migration was a **no-op**. Added a defensive amber "legacy ref — re-select to migrate" signal in `Engagement.tsx` (F2e).
  - (b) New `voice_setters.is_inbound` + partial unique index `voice_setters_one_inbound_per_client` (migration `20260625130000_voice_setters_is_inbound.sql`, applied live). New `useSetInboundSetter` hook wired into the inbound toggle (`PromptManagement.tsx` `DirectionsToggle`): sets the flag (clears others), sets `clients.retell_inbound_agent_id`, and **auto-rebinds the live Retell inbound number** (`inbound_agents`). Reverts toggle on failure; toggle loads from `is_inbound` (SoT). **PREREQ:** nothing is flagged inbound yet (default false) — Brendan flips it on the "Inbound BFD Agent" setter (BRENDAN_TODO).
  - (c) Removed per-setter `RetellPhoneNumberSelector` from `AgentConfigBuilder.tsx` and **deleted** the component; relocated Twilio import + phone management to the **API Credentials** page via the existing `RetellPhoneNumbersTab`. Outbound from-number unaffected (`retell_phone_1` fallback).
- **F5 — n8n decommission.** Code path **already gone** (`processMessages.ts` throws if not native). Railway shutdown → BRENDAN_TODO. The optional `clients.text_engine_webhook` drop is **deferred** (wired into `clients_public`; needs a coordinated view rebuild) → DEFERRED.
- **F6 — removed setup-guide quizzes.** Deleted `MultiAgentLogicStep.tsx`, `VoiceInboundLogicStep.tsx`, orphaned `QuizQuestion.tsx`; moved shared `QuizNavigationState` → `setup-guide/quizNavigationState.ts`; removed the 2 step objects from `SetupGuideDialog.tsx` and **renumbered** the positional step-ids + `SETUP_PHASES` counts (text 8→7, voice 7→6).
- **F7 — deleted** draft cadence `c206da3e` + its **inert companion** `engagement_campaigns` row `326ea535` (FK required it; 0 references anywhere despite stale `status='active'`). Transactional, verified gone.

Commit: see `git log` on `main`. Files: `useSetInboundSetter.ts`, `quizNavigationState.ts`, the `20260625130000` migration (new); `ClientLayout/ManageClients/AgentConfigBuilder/ApiCredentials/Engagement/PromptManagement/SetupGuideDialog/VoiceOutboundLogicStep/types.ts` (mod); `RetellPhoneNumberSelector/MultiAgentLogicStep/VoiceInboundLogicStep/QuizQuestion` (del).

## Relay Protocol (Docs/SESSION_PLAN.md step 4) — followed
Lists updated (B-4 out of BUG_LIST; F2/F5/F6/F7 out of FEATURE_ROADMAP; all → TEST_LIST; BRENDAN_TODO Railway + inbound-flag + field-access; DEFERRED column drop; COMPLETED_LOG entry); Session 3 ticked in SESSION_PLAN; this handoff written; committed + pushed; Session 4 prompt emitted below.

---

## EMITTED — Session 4 kickoff prompt (paste verbatim to start the next session)

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
silently drops _shared/ refs). After Session 3: NO edge/Trigger fns were redeployed (frontend +
DB-migration only). Current live edge versions are unchanged from Session 2: retell-call-webhook v21,
test-external-supabase v17, retell-proxy v45, duplicate-setter-config v8.

Use the superpowers skill to accomplish tasks.

TASK — SESSION 4: CLIENT VISIBILITY + CADENCE CONTROLS (CODE). Recommended mode: PLAN (F3 touches the
LIVE cadence runtime; research + approve the approach before edits). Scope (FEATURE_ROADMAP):

- F1 (GHL→BFD deep-link custom field). On lead create/sync, write a "BFD Conversation Link" custom
  field (or note) on the GHL contact pointing to the lead's BFD conversation page (/leads/<lead_id>,
  served by ContactDetail.tsx). Lets a client click from GHL into BFD's full conversation view and keep
  their own GHL/Twilio number with no double-send risk. Find the GHL contact create/sync path
  (sync-ghl-contact + the custom-field id pattern already used for outcome fields, e.g.
  ghl_*_field_id columns) and write the link on intake/sync. Replaces the conversation-provider POC
  near-term (DEFERRED 6.12a). Effort S-M.
- F3 (pause/resume a running cadence). Add a `paused` state to engagement_executions + a UI button +
  state-machine handling in trigger/runEngagement.ts (freeze at a step boundary, opt-in; resume
  continues). A full design is in the 2026-06-13 handoff — read it. Needs a live-runtime E2E. Effort M.
- F4 (per-tenant timezone-aware nudgeColdReply cron). Today the cron is fixed UTC; make it per-region
  or do a lead-local-time check so multi-tenant nudges fire at sane local hours. Find the
  nudgeColdReply cron in trigger/ and the per-client timezone (clients.timezone). Effort M.

DONE WHEN: tsc clean + deployed; each item moved out of FEATURE_ROADMAP → TEST_LIST.

CLOSE OUT (Relay Protocol, Docs/SESSION_PLAN.md step 4): update the 5 lists; tick Session 4 done in
SESSION_PLAN.md; write a dated handoff; git add -A + commit + push to origin + github; then EMIT THE
SESSION 5 PROMPT (By-phone pivot: BUG_LIST B-2 — internal-first STOP + inbound resolution, drop the GHL
lookup; larger live-path change, do it alone + carefully) — print it in a fenced block in chat AND save
it into the new handoff, built from the Standard Context Block + Session 5's scope + this Relay
Protocol. Point to Docs/SESSION_PLAN.md; do not inline the whole plan. Session 5 recommended mode: PLAN.
```
