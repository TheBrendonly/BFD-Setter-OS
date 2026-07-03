---
description: Session 7-finish continuation session log — an SMS test found BOOK-1 recurring, which triggered the full PROMPT-AUTH-1 investigation/build/verify/deploy arc (run partly in this session, partly in parallel sessions); 3 follow-on bugs found and fix-staged; the ORIGINAL Session 7-finish test matrix (Batches 2-7) was not started and is handed to a fresh session.
---

# 2026-07-03 — Session 7-finish (continuation): PROMPT-AUTH-1 full arc, session closed before Batches 2-7

**State at close:** `main @ 6c5c339`+`157bb8f`+`f36ff34`+`b092c9d` (PROMPT-AUTH-1 DEPLOYED LIVE). A separate branch
`feature/overnight-bugfix` carries 3 more fixes (SMS-MEM-1, FOLLOWUP-PROMPT-1, PROMPT-LINT-1), all fix-staged,
**not deployed**, plus an in-progress uncommitted MODEL-1-HARDENING UI fix. **Multiple parallel Claude Code
sessions worked this repo simultaneously** during this window — this doc documents both what happened in THIS
conversation and what was observed via git history / shared memory from the others, clearly distinguished.

## Why this session went sideways (in a good way)

This was the Session 7-finish CONTINUATION — a Brendan-drives/Claude-verifies live TEST pass, picking up from
`2026-07-03-session7-finish-voice-gate.md` (voice gate already PASSED). The plan was to batch through the
remaining test matrix (SMS exchange → agency/client login → LIVE-D → LIVE-E → G3-6 → F9-1/PHONE-CLEAR-1/G3-8a →
unknown-number + TEST_PHONE_A cleanup). **Only the first item (the SMS exchange) ran** — it found a real bug
that turned into its own multi-hour arc, and Brendan chose to close the session here rather than push through
the rest. Batches 2-7 are entirely untouched.

## What happened, in order

**1. Batch 1 — SMS exchange (this conversation, verified read-only).** Texted "can I book a meeting?" from
TEST_PHONE_A (+61405482446) to the live BFD Setter-1. Results:
- **SMS-OBS-1 ✅** — `tool_invocations` rows appeared (`get-available-slots` prefetch, `source='sms'`).
- **MODEL-1 ✅** — engine answered, no silent 400.
- **3.12 booking mechanics ✅** — `book-appointments` fired and created a real `bookings.source='sms'` row.
- **BOOK-1 accuracy ❌** — the setter refused a genuinely-open Monday ("we do Tue/Wed/Thu"), then on accepting
  "Thursday 2pm" it booked **Friday 4pm** (`startDateTime 2026-07-03T16:00+10:00`) and confirmed "this Thursday
  at 4pm". Wrong day, wrong time, wrong label. Booking `c1250498…` (later cancelled — see below).

**2. Root cause investigation (this conversation, workflow `text-setter-prompt-authoring-investigation`, 5
agents, ~465k tokens).** The engine's prefetch + injection worked correctly (real, fully-open Monday calendar
was handed to the model with explicit anti-fabrication rules) — the failure was in the **stored** Text-setter
prompt (`text_prompts.system_prompt`, external Supabase `qildpilxjodxdifggmto`, card `Setter-1`, 1680 lines):
a hidden `Available days: Tuesday, Wednesday, Thursday ONLY` rule (buried under `## BOOKING CONSTRAINTS`) plus
a dead, un-interpolated `{{ $now }}` token (the engine never substitutes `{{ }}` tokens) left the model with no
real "today" anchor. Deeper finding: this isn't client-specific — it's auto-seeded into EVERY new setter from
`frontend/src/data/defaultBookingPrompt.ts` (a 646-line legacy n8n template), and the SETTER CORE editor never
surfaces the assembled stored blob, so the operator can't see or fix it. Filed **PROMPT-AUTH-1** (High) in
`BUG_LIST.md`, full investigation saved to `Docs/investigations/2026-07-03-prompt-auth-1-text-setter-authoring.md`
(problem statement, hidden-content inventory, voice-vs-text comparison, efficiency findings, 9 open design
questions with recommended defaults, a 7-phase build plan).

**3. Solo build session (separate session, Fable research/design → Opus build, per the kickoff prompt this
conversation authored).** Built on branch `feature/prompt-auth-1-authoring`:
- **P0 runtime fixes:** `trigger/_shared/timeAnchor.ts` (real current-date/time block injected every turn,
  DST-proof) + `trigger/_shared/slotBinding.ts` (canonical slot map from the prefetch + any mid-loop
  `get-available-slots` calls; `book-appointments`/`update-appointment` validated against it before executing —
  off-list time REFUSED with real alternatives folded back, listed time rewritten to GHL's exact ISO).
- **Authoring fixes:** legacy 646-line `defaultBookingPrompt.ts` cut to a 10-line lint-clean note (auto-seed of
  the stale blob removed); new save-time lint (`promptLint.ts`, text-channel only) blocking `{{...}}` tokens,
  legacy tool names, hardcoded weekday policies; new `get-external-prompt` fn + a text "X-Ray" view (see the
  live stored prompt exactly as the engine reads it); every save now snapshots to `prompt_versions`; a
  **report-only** migration script (`scripts/report_text_prompt_migration.mjs`) that never writes to any DB.
- A follow-up commit (`157bb8f`) unified timezone-fallback handling (`resolveClientTimeZone()` +
  `DEFAULT_TIMEZONE = "Australia/Sydney"`) so a null/invalid `client.timezone` can't desync the time anchor from
  the availability query, and added timezone-naming to the setter's booking language (PU-1).
- test:node 103/103 → 104/104 (after 157bb8f), test:edge 195/195, tsc/vite/deno all green throughout.

**4. Independent re-verification (this conversation, before endorsing deploy).** Did NOT just trust the other
session's self-report: re-ran `test:node`/`test:edge`/`vite build` fresh myself (all green), read
`timeAnchor.ts` + `slotBinding.ts` + their wiring in `processSetterReply.ts` line-by-line, read the new
`get-external-prompt` fn's authorization (`authorizeClientRequest`, no secret leakage), read the save-time lint
for over-strictness risk (none — errors are narrowly scoped), and **ran the report-only migration script myself**
with `--out` to generate a real artifact: `Docs/investigations/prompt-migration-reports/
e467dabc-57ee-416c-8831-83ecd9c7c925_Setter-1.report.md` (+ `.stored.txt` / `.proposed.txt`) — confirms
independently: 42 errors / 26 warnings on the live stored prompt, legacy region lines 1127-1637, a clean
1169-line proposed replacement.

**5. Adversarial verification workflow (this conversation, per Brendan's explicit choice, 21 agents, ~1.16M
tokens — survived a session restart mid-run via `resumeFromRunId`).** 3 independent lenses (booking-logic
correctness / security-authz / regression-risk), each candidate finding then put through 3 refute-oriented
skeptics (majority-must-not-refute to survive). Result: **the core booking-logic finding was REFUTED — the P0
fix holds.** 4 other findings were CONFIRMED:
1. `promptLint.ts`'s two most safety-critical rules (`LEGACY_TOOL_NAMES`, the legacy-header check) lack the
   `/i` flag every sibling rule has → Pascal-case/ALL-CAPS/lowercased variants of the exact banned content pass
   with zero warnings. Empirically reproduced by literally running the lint against test strings.
2. The weekday-policy detector only matches ~4 fixed sentence templates → abbreviated ("Mon-Fri") or reworded
   restrictive policies bypass it, which also weakens the migration-audit script's "CLEAN" verdict (same lint
   module).
3. `trigger/sendFollowup.ts` (the automated cron follow-up/nudge channel) reads the same stored prompt but got
   NONE of the P0 protections (no time anchor, no availability prefetch, no slot-binding) — the same
   fabrication class could still fire there, unwatched.
4. (Related, lower severity) `followup_instructions`/`followup_cancellation_instructions` fields aren't linted
   at all.

Filed as **SMS-MEM-1... wait, no** — filed as **FOLLOWUP-PROMPT-1** and **PROMPT-LINT-1** in `BUG_LIST.md`
(this conversation).

**6. Junk-booking cleanup (this conversation, Brendan-approved).** Cancelled the wrong Friday-4pm test booking
from step 1 via the sanctioned `cancel-appointments` tool (soft-cancel PUT to GHL, mirrors to
`bookings.status='cancelled'`) — confirmed both the GHL event and the DB row show cancelled.

**7. Deploy (separate session, Brendan-driven).** Brendan merged `feature/prompt-auth-1-authoring` to `main`
(`6c5c339`) and deployed: Trigger `20260703.1`, `save-external-prompt` v14, `get-external-prompt` v1, Railway
frontend. Also committed deploy-tooling housekeeping (`f36ff34`: added the 2 new fns to `deploy_with_shared`
SLUGS).

**8. Live regression + SMS-MEM-1 discovery (observed via git history + shared memory — NOT run by this
conversation).** A live multi-turn SMS regression confirmed the P0 fix works: booking succeeded (Wed 8 Jul
2:30pm Sydney, `bookings.source='sms'`), no fabricated "Tue/Wed/Thu", no "snapped up"/"booked out", confirmation
named "Sydney time". The SAME transcript surfaced a separate, pre-existing, unrelated bug: **SMS-MEM-1** — the
normal (non-stopped) SMS path never persists the inbound HUMAN turn to `chat_history` (only the stopped-lead
branch does), so every reply reads back a history of the setter's OWN past messages only, with zero record of
what the lead said — causing re-asked questions and a "book another meeting" offer right after a completed
booking. Filed in `BUG_LIST.md` (observed, not authored by this conversation).

**9. Further fix-staging (separate session/sessions, branch `feature/overnight-bugfix`, observed via git log —
NOT built by this conversation).** All 3 follow-on bugs got FIXED (staged, not deployed):
- `379e5f6` **SMS-MEM-1**: new `trigger/_shared/persistHumanTurn.ts` (TDD), writes the human turn 1ms before
  the AI turn for correct replay ordering.
- `5e0305a` **PROMPT-LINT-1**: `/i` added to both regexes, new weekday-policy patterns (hyphenated ranges,
  reworded phrasing), lint extended to the followup instruction fields, a false-positive regression test added.
- `709bf92` **FOLLOWUP-PROMPT-1**: new `trigger/_shared/buildFollowupContext.ts` (+ test) wires the time-anchor
  + availability prefetch into `sendFollowup.ts`.
- Plus an **uncommitted, in-progress** MODEL-1-HARDENING UI fix as of this writing: new
  `frontend/src/lib/isKnownOpenRouterModel.ts` (+ test) + changes to `OpenRouterModelSelector.tsx` and
  `ApiCredentials.tsx` — an unknown/invalid model id now requires an explicit "Use anyway" confirmation instead
  of applying silently. **Do not assume this is finished or tested** — it was mid-edit when last observed.

I independently re-ran `test:node` (113/113) and `test:edge` (200/200) fresh on `feature/overnight-bugfix` as
part of this session's close-out documentation — both green, confirming the 3 staged fixes are solid.

**10. Close-out (this conversation).** Brendan asked to document everything, reconcile the lists, and close
this session rather than start Batches 2-7. Updated `BUG_LIST.md` (SMS-MEM-1/FOLLOWUP-PROMPT-1/PROMPT-LINT-1/
PROMPT-AUTH-1 status + the MODEL-1-HARDENING UI note), `TEST_LIST.md` (PROMPT-AUTH-1 section reconciled to
DEPLOYED + partial-regression-confirmed; new retest section for the 4 staged-not-deployed items; the SMS
exchange item marked done), `BRENDAN_TODO.md` (added the Setter-1 migration-apply action item), and this file.

## Current state (important — verify before assuming anything)

- **`main`**: PROMPT-AUTH-1 fully live. `DEFERRED.md`/`FEATURE_ROADMAP.md` unaffected (no edits needed there).
- **`feature/overnight-bugfix`**: 3 fixes committed (SMS-MEM-1, PROMPT-LINT-1, FOLLOWUP-PROMPT-1), all green
  (113/113 + 200/200), NOT deployed. Plus an uncommitted MODEL-1-HARDENING UI change (3 files) — check
  `git status` before touching anything on this branch; do not assume it's finished.
- **Other branches touched during this window** (not part of this arc, listed for completeness):
  `feature/prompt-auth-1-authoring` (now merged, can likely be deleted once confirmed), `feature/usage-billing-auth`,
  `overnight/f8-cost-price-calc`, `worktree-overnight+text-setter-repair-allbugs`, `feat/cadence-v2-lifecycle-wip`
  (all pre-existing, untouched this session).
- **Doc gap, still open:** `Docs/BUG_LIST.md`'s PROMPT-AUTH-1 entry previously referenced
  `Operations/handoffs/2026-07-03-prompt-auth-1-build.md` — that file was never actually written by the build
  session. This handoff (the one you're reading) supersedes that reference; the BUG_LIST entry has been updated
  accordingly and no longer points at the missing file.
- **Multiple parallel Claude Code sessions were active simultaneously** on this repo during this whole window.
  A fresh session should NOT trust any single git branch/log snapshot as final — re-check `git log`/`git status`
  across the relevant branches before acting, the same way this session had to.

## What genuinely still needs doing (the actual continuation)

**A. Get `feature/overnight-bugfix` finished, verified, deployed, and live-regression-tested.**
1. Confirm the MODEL-1-HARDENING UI change is finished + committed (or finish it).
2. Re-run `test:node` + `test:edge` + `vite build` fresh (do not trust this doc's numbers if more commits landed).
3. Brendan reviews + GO's a supervised deploy (Trigger.dev + frontend; no edge fn changes in this branch as far
   as observed, but double-check).
4. Live regression: a multi-turn SMS exchange confirming SMS-MEM-1 is fixed (`chat_history` has real
   human/ai alternation, no re-asked questions); a follow-up/nudge trigger confirming FOLLOWUP-PROMPT-1 no
   longer fabricates; a Prompt Management save attempt with Pascal-case/caps legacy content confirming
   PROMPT-LINT-1 now blocks it; the model selector UI confirming MODEL-1-HARDENING's "Use anyway" gate.
5. Move SMS-MEM-1 / FOLLOWUP-PROMPT-1 / PROMPT-LINT-1 / the MODEL-1-HARDENING UI note to `COMPLETED_LOG.md`.

**B. Brendan applies the Setter-1 prompt migration via the UI** (report-only, steps + proposed content already
generated — see `BRENDAN_TODO.md` and `Docs/investigations/prompt-migration-reports/`). Unlocks the remaining
PROMPT-AUTH-1 `TEST_LIST.md` checks (full-prompt visibility X-Ray, no-leftover-artifacts, efficiency).

**C. The ORIGINAL Session 7-finish remaining test matrix — completely untouched this session:**
- **Batch 2** — Agency→client login pair: F8 panel+card, F13 ×4 (margin panel vs SQL hand-check, client
  toggle matrix, dashboard summary card both roles, period browsing + anchor clamp), INB-1/UI-1/F11. F14 email
  E2Es stay GATED on Resend SMTP (Brendan's own todo item, unconfirmed).
- **Batch 3 (LIVE-D)** — B-2 CSV `normalized_phone` + GHL-outage degraded-not-dropped + background repoint
  converges no-dup + deterministic GHL pick + manual SMS send/429-retry.
- **Batch 4 (LIVE-E)** — F3 pause/resume a running cadence + F4 timezone-aware cold-reply nudge.
- **Batch 5** — G3-6 Tier-3 analytics (Claude sets `clients.supabase_table_name` first, currently null).
- **Batch 6** — F9-1 locked-setter rename refusal + PHONE-CLEAR-1 + G3-8(a) reactivation webhook.
- **Batch 7 (LAST)** — fresh GHL contact from an UNKNOWN number → F1 deep-link + B-5 inbound-no-name +
  B-2 inbound-resolve, THEN clean up TEST_PHONE_A (+61405482446) to free it (3 BFD leads:
  `nD7x3GyZKRW3zxnMHiew` / `YKJKtmzrHrHCnAuBtaxe` / `MWPMQuRyatfRINnXukzG` + the GHL contact — capture
  read-only, gated-confirm with Brendan, delete).

**D. Session 9 (API-DEPR-1) and Session 10 (G3-7)** remain queued after Session 7-finish per `SESSION_PLAN.md`
— unchanged, not started.

## Next-session prompt (paste into a fresh session)

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter. MULTIPLE PARALLEL SESSIONS have been working this
repo — do NOT assume `git log`/`git status` from any prior doc is current; re-check branches yourself
(`main`, `feature/overnight-bugfix` at minimum) before acting. Supabase ref bjgrgbgykvjrsuwwruoh. Creds in
./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY). Live DB via Supabase Management API
/database/query (browser UA, NOT postgres MCP). Live Retell via api.retellai.com. NEVER edit voice OR text
prompt CONTENT directly — report-only, Brendan applies via the BFD setter UI; the prompt AUTHORING SYSTEM
(editor/assembly code) is in scope for PROMPT-AUTH-1 follow-on work. Verify read-only before claiming done.
Follow the Relay Protocol in Docs/SESSION_PLAN.md.

READ FIRST: Docs/SESSION_PLAN.md (Session 7-finish entry) + this handoff
(Operations/handoffs/2026-07-03-session7-finish-prompt-auth-1-detour.md) + Docs/BUG_LIST.md + Docs/TEST_LIST.md
+ Docs/BRENDAN_TODO.md.

STATE: PROMPT-AUTH-1 (the text-setter prompt-authoring rebuild) is DEPLOYED LIVE on main and its core fix is
live-regression-confirmed working (booking accuracy, timezone naming). A separate branch
`feature/overnight-bugfix` has 3 more fixes — SMS-MEM-1 (chat memory), FOLLOWUP-PROMPT-1 (follow-up channel
protections), PROMPT-LINT-1 (lint bypass hardening) — all fix-staged (test:node 113/113, test:edge 200/200 as
of 2026-07-03) but NOT deployed, plus a MODEL-1-HARDENING UI change that may or may not be finished/committed
by now — CHECK. The ORIGINAL Session 7-finish remaining test matrix (Batches 2-7: F8/F13/F14 UI, LIVE-D,
LIVE-E, G3-6, F9-1/PHONE-CLEAR-1/G3-8a, F1/B-5/B-2 unknown-number + TEST_PHONE_A cleanup) was NOT started.

SESSION SCOPE (in this order):
1. Check `feature/overnight-bugfix`'s actual current state (git log, git status, re-run tests). If the
   MODEL-1-HARDENING UI change is unfinished, either finish it or flag it clearly — do not deploy half-done
   frontend work.
2. Once that branch is clean + green, get Brendan's GO and deploy it (Trigger.dev if the follow-up path
   changed, frontend for the model-selector UI; confirm exactly what needs deploying from the diff). Run the 4
   live regression checks in TEST_LIST.md's "SMS-MEM-1 / FOLLOWUP-PROMPT-1 / PROMPT-LINT-1 / MODEL-1-HARDENING
   (UI)" section. Move passes to COMPLETED_LOG.md.
3. Remind Brendan (if not already done) to apply the Setter-1 prompt migration via the UI per
   Docs/BRENDAN_TODO.md — this unlocks 3 remaining PROMPT-AUTH-1 TEST_LIST checks.
4. THEN run the original Session 7-finish Batches 2-7 (see the "what genuinely still needs doing" section C in
   this handoff for the full breakdown). Batch overlapping actions per the existing pattern; verify read-only;
   run the unknown-number batch (7) LAST since it ends by freeing TEST_PHONE_A via CRM cleanup.

CLAUDE WRITE-ACTIONS AUTHORIZED (test infra, revert after, per the standing Session 7-finish scope):
clients.timezone (F4 test), clients.supabase_table_name (G3-6), clients.ghl_api_key break/restore (B-2 outage
sim), CRM cleanup of +61405482446 (gated confirm with Brendan first).

DONE WHEN: feature/overnight-bugfix deployed + regression-confirmed, Setter-1 migration applied + its 3
TEST_LIST checks pass, and TEST_LIST is green / all fails logged for Batches 2-7. Then close out per the Relay
Protocol (reconcile the 6 lists, tick SESSION_PLAN, dated handoff, commit+push, emit the Session 9 (API-DEPR-1)
prompt).

No em dashes; fenced; self-contained.
```
