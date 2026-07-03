---
description: Overnight stage-only bug-fix run 2026-07-03 - 10 queued items cleared on branch feature/overnight-bugfix (+ g3-7/vite-major), all with green tests, adversarial review findings fixed, nothing deployed; deploy checklist + live tests owed to Brendan.
---

# Handoff 2026-07-03: Overnight stage-only bug-fix run

## What this run did

Unattended overnight run (started as Opus 4.8, finished as Fable 5). Cleared the residual staged
queue after the PROMPT-AUTH-1 deploy. STAGE ONLY - nothing deployed, no migrations applied, no
Trigger/edge/Railway pushes. `voice-booking-tools` never touched (frozen). Prompt CONTENT never
edited (report-only). Every item is one commit with green tests after it.

**Branch `feature/overnight-bugfix`** off `main` (`b092c9d`), 12 fix commits. **Branch
`g3-7/vite-major`** off that, 1 commit (the breaking vite bump, isolated per the run spec).

Final suite on `feature/overnight-bugfix`: **test:node 122/122, test:frontend 8/8, test:edge
202/202, tsc clean, vite build green.** (The vite-8 tree lives only on `g3-7/vite-major`; the
overnight branch stays on vite 5.4.21.)

## Commits (feature/overnight-bugfix, oldest first)

Pre-existing from earlier in the session (items 1-3 first cut):
- `379e5f6` SMS-MEM-1 - persist inbound human turn to chat_history (new `trigger/_shared/persistHumanTurn.ts`, TDD)
- `5e0305a` PROMPT-LINT-1 - close case/wording lint bypasses + lint followup fields
- `709bf92` FOLLOWUP-PROMPT-1 - time-anchor + availability prefetch on the follow-up channel

This run:
- `3c42a45` MODEL-1-HARDENING (UI) - confirm-gate unknown custom model ids; `frontend/src/lib/isKnownOpenRouterModel.ts` + tests; ApiCredentials shape guard
- `8e64bcc` PHONE-CLEAR-1 - recompute `normalized_phone` on the 3 remaining lead phone writers (Contacts edit + add dialogs, Chats panel)
- `2cf1a8b` F9-1 - close 2 residual lock-leak paths (prompt-doc header editor missing `isLocked`; commitEdit 423 now reverts the display-name write)
- `e453913` RLS-SHAPE-1 - migration FILE only (agency role gate on `sms_delivery_events`); NOT applied
- `d8111d6` PROMPT-LINT-1 review follow-up - lint the store the followup engine actually reads (`agent_settings` via `useAgentSettings`) + kill compound-word false positives (bounded day-name alternation)
- `29ce9a4` FOLLOWUP-PROMPT-1 review follow-up - followup-mode availability wording (no tool instructions) + shared `trigger/_shared/voiceBookingCallTool.ts` (restores the 30s timeout the fork dropped)
- `19a6fb4` MODEL-1-HARDENING review follow-up - save the CANONICAL list id (not the user's casing), anchor the shape guard, wire `npm run test:frontend`
- `5d40ca2` API-DEPR-1 - migrate the last legacy Retell list endpoint (list-agents) to POST /v2/list-agents + get-agent hydration; verify-credentials v2 probe
- `acfc387` VM-1 - set-voicemail draft-first (ensureEditableAgentDraft → publish → repoint) + `static`→`static_text` enum

**g3-7/vite-major:**
- `6cf4f24` G3-7 - vite 5.4.21 → 8.1.3 + plugin-react-swc 4.3.1; 0 npm-audit vulns

## Queue disposition (all 10 items)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | SMS-MEM-1 (High) | STAGED | pre-run; live SMS re-test owed |
| 2 | PROMPT-LINT-1 (Med) | STAGED + review-hardened | now lints `agent_settings` (what sendFollowup reads); compound-word FPs fixed |
| 3 | FOLLOWUP-PROMPT-1 (Med) | STAGED + review-hardened | scope confirmed (no tool loop); followup-mode wording; shared tool caller |
| 4 | MODEL-1-HARDENING (Med) | STAGED + review-hardened | canonical-id save; anchored guard; tests wired |
| 5 | PHONE-CLEAR-1 (Low) | STAGED | 3 residual writers beyond ee479ab's ContactDetail |
| 6 | F9-1 (Med) | STAGED | 2 residual leak paths closed |
| 7 | RLS-SHAPE-1 (Low) | MIGRATION FILE ONLY | not applied |
| 8 | API-DEPR-1 (Med) | MOSTLY STAGED | list-agents done; analysis-prompt fields deferred to supervised Session 9 |
| 9 | VM-1 (Med) | STAGED, NOT LIVE-VERIFIED | needs a live voice call |
| 10 | G3-7 (Low) | DONE on its own branch | browser check + merge owed |

## Adversarial branch review (mid-run) - 6 Important findings, all fixed

A `general-purpose` reviewer swept `b092c9d..HEAD` + the staged MODEL-1 diff. Hard-constraint sweep
clean (no voice-booking-tools, no prompt-content, no deploys). It confirmed the FOLLOWUP-PROMPT-1
scope calls were correct (sendFollowup has no tool loop and never books; nudgeColdReply delegates to
aiGenerateEngagementCopy which never reads text_prompts). 6 Important issues, each verified against
the code before fixing, all fixed in this run:

1. PROMPT-LINT-1 lint guarded the external mirror, not `agent_settings` (what sendFollowup reads) → moved the gate into `useAgentSettings` (shared pure module, browser import).
2. Hyphenated day-range pattern matched compound words ("wedding-friendly") and 422-blocked saves → bounded day-name alternation.
3. Followup availability block told a tool-less model to "call get-available-slots" → `buildAvailabilityBlock({channel})`; followup names no tools.
4. sendFollowup's forked callTool dropped the 30s timeout → shared `voiceBookingCallTool.ts` used by both paths.
5. MODEL-1 saved the user's casing on a case-insensitive match → `findKnownOpenRouterModelId` returns the canonical id.
6. MODEL-1 ApiCredentials shape guard unanchored ("openai/gpt 4o" passed) → `/^[^/\s]+\/\S+$/`.

## What needs Brendan (in order)

1. **Deploy `feature/overnight-bugfix` (supervised).** Merge to main, then:
   - Trigger.dev: `npx trigger.dev@4.4.4 deploy` (SMS-MEM-1, FOLLOWUP-PROMPT-1 - `TRIGGER_DEPLOY_PAT` in .env)
   - Edge fns (via `deploy_single_fn.mjs` / `deploy_with_shared.mjs`, `--use-api --no-verify-jwt`):
     **retell-proxy** (v47→v48: VM-1 + API-DEPR-1), **verify-credentials** (API-DEPR-1),
     **save-external-prompt** (imports the shared `promptLint.ts`; redeploy so the module is current)
   - Frontend: Railway from main (MODEL-1 UI, F9-1, PHONE-CLEAR-1, the browser-side PROMPT-LINT-1 gate)
   - **retell-proxy v48 is Voice-gated** (frozen live baseline): after deploy, one answered outbound
     call to confirm booking still works before trusting v48.
2. **Live tests** (all in `TEST_LIST.md`): SMS-MEM-1 multi-turn memory (from TEST_PHONE_A
   `+61405482446`), FOLLOWUP-PROMPT-1, PROMPT-LINT-1 (incl. the AgentSettingsCard followup-field path),
   MODEL-1 UI, VM-1 (Save & push mode=prompt → full success + voicemail lands on a call), API-DEPR-1
   (Agents tab + Verify), F9-1 residual (locked rename via tile AND doc header), PHONE-CLEAR-1 residual
   (Contacts dialog).
3. **Apply the RLS-SHAPE-1 migration** (`20260703120000_...sql`) at the next migration window.
4. **G3-7**: browser-verify the app on `g3-7/vite-major`, then merge; raise the greenserver inotify
   watch limit (BRENDAN_TODO) so `npm run dev` boots without `CHOKIDAR_USEPOLLING=true`.
5. **Setter-1 prompt content migration** (unchanged, still pending - report-only, BRENDAN_TODO).

## Environment notes

- Plan mode was ON at paste (spec said OFF); setup was done read-only and plan approval was treated
  as the "go". `git fetch origin` confirmed `origin/main` unmoved at `b092c9d`.
- A concurrent session had committed 3 docs-only commits (`2cf903e`/`9ea4c32`/`48cac13`, Brendan's
  session7-finish reconciliation) on top of the branch before this run resumed; verified they touch
  only Docs/ + a handoff, no code overlap.
- `deno check` reports 19 pre-existing strict-mode errors in retell-proxy (unrelated lines 569-595);
  the project pipeline is `deno test --no-check`, and the HEAD copy has the same count. Not introduced
  here.
- vite-8 dev server hits ENOSPC (inotify watchers) on greenserver - environment, not vite. Runs with
  `CHOKIDAR_USEPOLLING=true`; the app-load check used that.

## Next-session prompt

See the fenced block at the bottom of this file (also pasted into chat). Recommended:
**Opus 4.8, plan mode ON** (supervised deploy touching frozen retell-proxy + a live voice test).

```
BFD-setter — Session 9: DEPLOY the overnight bug-fix branch + API-DEPR-1 finish (SUPERVISED).
Model: Opus 4.8. Plan mode: ON (this deploys to a frozen live baseline + needs a live voice call).

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh.
Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY). Live DB via Supabase
Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com with
BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding, never
old memory. NEVER edit voice prompts (report-only). Verify read-only before claiming done. Follow
the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, Operations/handoffs/2026-07-03-overnight-bugfix-run.md, then in
Docs/BUG_LIST.md the staged items (SMS-MEM-1, PROMPT-LINT-1, FOLLOWUP-PROMPT-1, MODEL-1-HARDENING,
PHONE-CLEAR-1, F9-1, RLS-SHAPE-1, API-DEPR-1, VM-1, G3-7) and Docs/TEST_LIST.md.

The branch feature/overnight-bugfix is BUILT + all-green (test:node 122/122, test:frontend 8/8,
test:edge 202/202, tsc + vite build) and NOT deployed. g3-7/vite-major (vite 8) is a separate
branch. On Brendan's GO, in order:
1. Merge feature/overnight-bugfix -> main; push origin + github.
2. Trigger.dev: npx trigger.dev@4.4.4 deploy (SMS-MEM-1 + FOLLOWUP-PROMPT-1).
3. Edge fns via deploy_single_fn.mjs / deploy_with_shared.mjs (--use-api --no-verify-jwt):
   retell-proxy (v47->v48: VM-1 + API-DEPR-1), verify-credentials, save-external-prompt.
   retell-proxy is the FROZEN Voice baseline -> read-only Voice smoke first (0 agents mutated),
   then AFTER deploy one answered outbound call to confirm booking survives v48 before trusting it.
4. Frontend: Railway from main.
5. Apply migration 20260703120000_rls_shape_1_sms_delivery_events_agency_role_gate.sql via Mgmt API.
6. Run the TEST_LIST retests (SMS-MEM-1 multi-turn from TEST_PHONE_A +61405482446; FOLLOWUP-PROMPT-1;
   PROMPT-LINT-1 incl. the AgentSettingsCard followup-field path; MODEL-1 UI; VM-1 Save&push
   mode=prompt -> full success + voicemail lands on a call; API-DEPR-1 Agents tab + Verify; F9-1
   locked-rename via tile AND doc header; PHONE-CLEAR-1 Contacts dialog). Move greens to
   COMPLETED_LOG.md.
7. API-DEPR-1 LEFTOVER (code): migrate retell-proxy set-voice-settings' deprecated
   analysis_summary_prompt / analysis_successful_prompt / analysis_user_sentiment_prompt to
   post_call_analysis_data presets (deferred from overnight because it changes live voice-analysis
   behavior). Deploy + read-only re-confirm the Retell deprecation notice stops firing.
Optional fold-in if time: BOOK-2/3 + SMS-METER-1 supervised shared-fn edits (voice-booking-tools).
Then close out per the Relay Protocol: reconcile the 6 lists (incl. PROMPT_UPDATE_LIST.md), tick
SESSION_PLAN, dated handoff, commit+push, emit the Session 10 (G3-7 merge) prompt.
G3-7 note: g3-7/vite-major is built + headless-verified; it needs a browser check + merge + the
greenserver inotify sysctl bump (BRENDAN_TODO) — can be its own short Opus 4.8 / plan-ON session
with /run to verify the app loads.
CONSTRAINTS: voice-booking-tools stays frozen unless you explicitly take the BOOK-2/3 fold-in;
voice prompts hard report-only; no em dashes.
```
