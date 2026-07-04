---
description: API-DEPR-2 (2026-07-04) migrated Retell's 3 deprecated analysis-prompt agent fields into post_call_analysis_data system-presets; retell-proxy v49 live, downstream webhooks untouched (the Session-9 coordination worry was refuted), Brendan owes the answered-call Voice gate.
---

# Handoff 2026-07-04: API-DEPR-2 — analysis-prompt fields → post_call_analysis_data

## What this session did

Migrated the three deprecated Retell agent fields (`analysis_summary_prompt`,
`analysis_successful_prompt`, `analysis_user_sentiment_prompt` — Retell's 06/15/2026 removal notice)
into `post_call_analysis_data` entries of `type:"system-presets"`. Opus 4.8, plan mode ON, brainstorm →
plan → approved (full-stack + accept the reporting-only behavior shift) → build → verify.

## The finding that reframed the whole task

The Session-9 BUG_LIST framed this as risky because migrating "moves the values into
`custom_analysis_data`, which the downstream webhooks do NOT read, so it needs coordinated changes to the
two analysis webhooks." **That was wrong**, proven three ways (all read-only):

1. **Docs (06/15/2026 notice + create-agent/get-call API refs):** the fields become
   `post_call_analysis_data` entries `{ type:"system-presets", name, description }` with
   `name` = `call_summary` / `call_successful` / `user_sentiment`. Mapping:
   summary→call_summary, successful→call_successful, user_sentiment→user_sentiment.
2. **System-preset outputs stay TOP-LEVEL** on `call_analysis` (`call_summary`/`user_sentiment`/
   `call_successful`). The `get-call` schema confirms `custom_analysis_data` holds only user-defined
   custom fields. → the two analysis webhooks (`retell-call-webhook/index.ts:307-309`,
   `retell-call-analysis-webhook/index.ts:422-424`) read the same place and were **NOT touched**.
3. **Live agents (Property Coach, Voice-Setter-Test):** the 3 `analysis_*_prompt` fields are already
   **absent** (Retell strips deprecated fields on write) and `post_call_analysis_data` = 6 custom / 0
   presets. So today the app's analysis prompts do NOT reach Retell; analysis runs on Retell defaults.
   After this change they finally apply — an accepted, minor REPORTING-only shift. **No call/booking
   behavior is touched.**

## Implementation (full-stack; app editing + storage model unchanged)

Kept the 3 textareas in `VoiceRetellSettings.tsx` and the separate config persistence
(`saveConfig('_retell_voice_settings')`) as-is — no split/backfill/migration. Only the Retell wire
format changed, merged at the save boundary in BOTH places for deploy-order safety (Railway frontend +
Supabase edge fn deploy independently):

- **NEW `frontend/supabase/functions/retell-proxy/postCallAnalysis.ts`** — pure
  `buildPostCallAnalysisData(voiceSettings)`: splits caller presets (keyed by name) from custom fields,
  defensively folds any still-present deprecated fields into presets (caller-provided presets win, so a
  fresh save is never clobbered), dedups by preset name, returns `[...presets, ...custom]` or `undefined`
  when empty. Mirrors the `voicemail.ts`/`voicemail.test.ts` pattern.
- **NEW `postCallAnalysis.test.ts`** — 6 cases (mapping, no deprecated names in output, idempotent/no
  dupes/caller-wins, custom-only passthrough, empty→undefined, blank fields ignored).
- **`retell-proxy/index.ts`** — `buildAgentUpdatesFromVoiceSettings`: removed the 3 deprecated
  top-level mappings (old L708-710); now `agentUpdates.post_call_analysis_data = buildPostCallAnalysisData(...)`.
- **`frontend/src/pages/PromptManagement.tsx`** — save payload builds the 3 system-presets, strips any
  stray presets from the custom array, sends `post_call_analysis_data: [...presets, ...custom]`, and drops
  the 3 deprecated `analysis_*_prompt` keys from the retell-proxy invoke body.
- **`frontend/src/lib/retellVoiceAgentDefaults.ts`** — added
  `DEFAULT_RETELL_ANALYSIS_USER_SENTIMENT_PROMPT`; repointed the inline strings in
  `VoiceRetellSettings.tsx` + `PromptManagement.tsx`.
- **NOT touched:** the two analysis webhooks, `voice-booking-tools` (frozen), voicemail logic, any voice
  prompt, `useRetellApi` types (already fit).

## Verification

- `tsc --noEmit` 0 · `vite build` exit 0 · `test:edge` **208/0** (202 prior + 6 new).
- **retell-proxy v48 → v49 deployed** (Voice-gated) via `deploy_single_fn.mjs` (bundled the new
  `postCallAnalysis.ts` sibling, excluded the test; verify_jwt preserved). fn_status ACTIVE.
- **Read-only Voice smoke PASSED:** Retell `POST /v2/list-agents` → HTTP 200; both canonical agents
  byte-for-byte unchanged (versions 16/22, deprecated fields absent, pcad 6 custom / 0 presets) → **0
  agents mutated** this session.

## Owed (Brendan-driven, in TEST_LIST)

The answered-call Voice regression (shared with the v48 gate) + two API-DEPR-2 checks: (a) after
re-Saving a setter in the UI, `get-agent` shows 3 `system-presets` in `post_call_analysis_data` + the
custom fields, no dupes, deprecated fields still absent; (b) on the answered call, `call_summary` /
`user_sentiment` / `call_successful` still populate top-level in `call_history`. Roll back to v47/v48 via
`deploy_single_fn.mjs` if the call regresses. Also confirm the Retell deprecation notices stop firing.

## List reconciliation

- `BUG_LIST.md` — API-DEPR-1 flipped `[x]` (both parts code-complete); ANALYSIS-FIELDS PART rewritten with
  the actual outcome + the refuted-claim correction.
- `TEST_LIST.md` — Voice gate row updated to v49 (supersedes v48); new API-DEPR-2 shape/top-level check row.
- `SESSION_PLAN.md` — API-DEPR-2 entry ticked `[x]`; remaining-sequence prose updated (API-DEPR-2 done).
- `FEATURE_ROADMAP.md` / `BRENDAN_TODO.md` / `DEFERRED.md` / `PROMPT_UPDATE_LIST.md` — no change (a bug,
  no feature/prompt/deferred/manual-action delta beyond the TEST_LIST gate).

## Next up

Critical path: the **async live TEST pass** Brendan owes (Session 7-finish + Session-9 retests +
G3-7 vite-8 browser click-through + this API-DEPR-2 v49 answered-call gate — voice-regression call FIRST)
→ any fix-pass → optional BOOK-2/3 + SMS-METER-1 supervised shared-fn edits → First-client milestone.
No code session is strictly required next; recommended next Claude session = whatever the TEST pass turns
up, else the First-client milestone prep. Prompt below.

## Next session prompt

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). retell-proxy is the
FROZEN live Voice baseline — any change is Voice-gated. Verify read-only before claiming done. No em dashes.
Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + the list(s) for this session.

All planned code sessions to v1 "100%" are now DONE (Sessions 0-10 + API-DEPR-1 + API-DEPR-2).
What remains is Brendan-driven: (1) the async live TEST pass — voice-regression answered call FIRST
(retell-proxy v49 booking + B-3/B-5 + VM-1 voicemail + API-DEPR-2 top-level analysis fields), then the
SMS / fresh-GHL-contact / agency↔client / F13×4 / F14×2 / LIVE-D / LIVE-E / G3-6 Tier-3 / G3-7 vite-8
browser click-through matrix in TEST_LIST.md; (2) DEPLOY-1 (pin Railway prod to `main`) + the inotify
sysctl (BRENDAN_TODO); (3) First-client milestone (event-gated, Docs/DEFERRED.md).

Your job this session: if Brendan reports live-test results, triage each PASS → COMPLETED_LOG and each
FAIL → a new BUG_LIST item + a scoped fix session. If nothing is owed, help with First-client milestone
prep. Optional, only if Brendan asks: the supervised shared-fn edits BOOK-2/3 + SMS-METER-1
(voice-booking-tools is frozen — daytime supervised only). Close out per the Relay Protocol.
```
