---
description: SMS/text setter tool parity (§3.12) BUILT on branch feat/sms-tool-parity-2026-06-19 — text engine can now book/reschedule/cancel/check-slots/schedule-callback via voice-booking-tools; tests green; NOT deployed (coordinated deploy after merge). Also: §6.11 + §6.5 confirmed verify-only this session.
---

# SMS/Text Setter Tool Parity (§3.12) — Build Handoff (2026-06-19)

Built in an isolated git worktree. **No live deploy this session** (coordinated deploy after merge, per the session contract). All verification is local (tsc/deno/node + read-only reasoning).

## Branch

- Worktree branch (harness-sanitized name): `worktree-feat+sms-tool-parity-2026-06-19`
- **Intended branch name for the PR/merge: `feat/sms-tool-parity-2026-06-19`** (the harness strips `/`; rename or re-create at merge time).
- Base: `main` @ `d4c5626` (merged Spec 1 + committed HOLD-loop fix).
- 6 commits, +824/−33 across 9 files. Working tree clean.

## What shipped (code-complete, undeployed)

§3.12 gives the text engine the voice agent's booking tools by reusing the existing `voice-booking-tools` edge fn. **No new booking backend.**

1. **`voice-booking-tools` optional `source` param** — `book-appointments` now stamps `bookings.source` from the request body via a new pure helper `_shared/toolBookingSource.ts` (`bookingSourceFromBody`), defaulting to `"voice_call"` when absent. The SMS engine passes `source="sms"`; the voice/Retell path never sends `source`, so it is byte-unchanged. (Commit `3115681`.)
2. **`trigger/_shared/setterTools.ts`** — the 6 OpenAI function-calling schemas the LLM sees (`get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments`, `schedule-callback`) + `TOOL_USAGE_INSTRUCTION`, a CODE-SIDE system addendum (sibling to `MULTI_MESSAGE_INSTRUCTION`, **not** a stored-prompt edit — voice/text prompts stay report-only). `send-sms` and `lookup-contact` are intentionally excluded (double-send / redundancy). (Commit `b27130e`.)
3. **`trigger/_shared/setterToolLoop.ts`** — the provider-agnostic agentic loop (injected `callLlm`/`callTool`). Safety properties, all unit-tested: engine-injected identity always overrides model-supplied identity; iteration cap + forced no-tools finalization; tool errors folded (never thrown) so a booking hiccup can't break the SMS reply; `ToolsUnsupportedError` degrades to reply-only; `slot_unavailable` forwarded verbatim; unknown tool folded as error. (Commits `5144e52`, `58952b9`.)
4. **`trigger/processSetterReply.ts`** — the single OpenRouter call is replaced by the loop. `callLlm` (OpenRouter w/ tools/tool_choice, per-call 60s timeout, throws `ToolsUnsupportedError` on a tools-related 4xx), `callTool` (HTTP to `voice-booking-tools?tool=&clientId=`, bearer = client `intake_lead_secret` when set, unwraps `{ok,result}`, throws on `!ok`), identity injection (`contactId=Lead_ID`, phone, email, client `timezone`, `source="sms"`). Client select extended with `intake_lead_secret, timezone`. **Input payload + `{Message_1..N}` output contract unchanged** (verified against the `processMessages` caller). (Commit `eb325cc`.)
5. **`trigger/processMessages.ts`** — STEP 5.5 opt-out re-check after the loop, before the Twilio send (mirrors STEP 1.5); the longer loop widens the STOP window. (Commit `cefc17a`.)

**Rollout = GLOBAL ON** (Brendan's decision): tool-calling is always enabled — no `sms_tools_enabled` flag, no schema change. Safety rests on the graceful fallback + iteration cap + identical-to-today path when the model emits no tool calls. Rollback = revert + redeploy.

### Multi-turn model
A booking conversation (offer slots → lead picks in a later SMS → book) is carried by the persisted natural-language `chat_history`, NOT raw tool JSON. Within one debounce run the loop may make 1–3 tool calls; tool-call/result turns are in-process only. No `chat_history` schema change.

## Verification (local, this session)

- **Node tests: 48 pass / 0 fail** — `setterToolLoop.test.ts` (8: cases a–f + unknown-tool + tools-unsupported), `setterTools.test.ts` (5 structural), plus existing `classifyCallOutcome`/`twilioAutoReplyFilter` (regression).
- **Deno tests: 12 pass / 0 fail** — `toolBookingSource.test.ts` (5) + existing `bookingSource.test.ts` (7, regression).
- **`deno check` clean** on all new production modules.
- **tsc (strict NodeNext, ad-hoc):** my changes add **0 new type errors**. The only errors are pre-existing supabase-js-`never` artifacts on untouched lines in `processSetterReply`/`sendFollowup` (the project deploys via trigger.dev esbuild, which strips types; these were confirmed present on `main` HEAD too).
- **Regression scan (subagent):** `processMessages` reads only `Message_1..N` from the result (unchanged); no voice/Retell caller sends `source` (voice path = `voice_call`).

## Coordinated deploy list (AFTER merge — NOT done this session)

1. **DB:** none (global-on, no flag column).
2. **Edge function (Deno):** redeploy **`voice-booking-tools`** only (the `source` param + new `_shared/toolBookingSource.ts`), `--use-api --no-verify-jwt`, with `_shared` bundled.
3. **Trigger.dev (single deploy, pin `trigger.dev@4.4.4`):** bundles `processSetterReply.ts` + `processMessages.ts` + new `trigger/_shared/setterTools.ts` + `setterToolLoop.ts`.
- Order: edge fn + Trigger together. Rollback = revert + redeploy.

## Live smoke checklist (Brendan drives post-deploy; Claude verifies read-only)

From a known lead's phone, text the BFD number and confirm each:
1. "Can I book a call?" → agent offers specific times (proves `get-available-slots`).
2. Reply with one offered time → booked; verify a `bookings` row with **`source='sms'`** tied to the lead, and the active cadence ended.
3. "Can we move it to <other time>?" → reschedule (proves `get-contact-appointments` + `update-appointment`).
4. "Cancel it" → cancelled.
5. "Just call me tomorrow at 3pm" → `scheduled_callbacks` row created.
6. Text **STOP** while a booking exchange is mid-flight → no further reply (STEP 5.5 gate).
- Confirm BFD's `clients.llm_model` is tool-capable before relying on global-on (gemini-class is; weak models degrade to reply-only via the fallback).

## Docs to update at merge (NOT edited in this branch — see why)

`Docs/BUG_LIST.md` is **untracked in main** (not present in the worktree) and `FEATURE_ROADMAP.md` has **uncommitted changes in the main tree**, so editing them in this branch would risk blocking the merge on a dirty tree / conflicting with the parallel bug session. Apply these in the main tree at merge:
- **`FEATURE_ROADMAP.md` §3.12** → mark `[~]` built (code-complete, pending coordinated deploy), reference branch `feat/sms-tool-parity-2026-06-19`.
- **`FEATURE_ROADMAP.md` §6.9 / `Docs/BUG_LIST.md` §6.9** → mark closed-by-3.12 once deployed.

## §6.11 + §6.5 — confirmed VERIFY-ONLY this session (no code needed here)

- **§6.11** (missed-call → fallback SMS ~10min late): the runEngagement side this session owns is **already shipped** — `trigger/runEngagement.ts:1148` clears `active_call_id` on the `waitForCallOutcome` timeout path (the comment cites the timeout path explicitly). The open part is webhook `last_call_outcome` stamping for voicemail/no-answer, which lives in `retell-call-analysis-webhook` (the webhook the live agent posts to) — **owned by the GHL-sync/bug session per `BUG_LIST.md`**. Nothing to do here.
- **§6.5** (internal by-phone STOP + inbound resolution): Spec 1 already shipped it — `receive-twilio-sms` resolves internal-by-phone first (`:644`), STOP fans out by phone (`:527`/`:541`), the inbound leads upsert sets `normalized_phone` (`:860`), and the sibling HOLD read has `.eq("status","running")` (`:885`). The only remaining piece — dropping the GHL `findOrCreateGhlContact` fallback (`:662`) — is **deferred** (Brendan's call) until the bug session's §6.10 (`sync-ghl-contact` NULL `normalized_phone`) is live, else GHL-originated leads with a null `normalized_phone` would dup. Internal-first model confirmed correct.

## Isolation honored

Touched only: `trigger/{processSetterReply,processMessages}.ts`, `trigger/_shared/setter{Tools,ToolLoop}.ts(+tests)`, `frontend/supabase/functions/voice-booking-tools/index.ts`, `frontend/supabase/functions/_shared/toolBookingSource.ts(+test)`. Did NOT touch `frontend/src/**`, `{sync-ghl-contact,retell-inbound-webhook,push-contact-to-ghl,retell-call-analysis-webhook}`, `syntheticProbe.ts`, or bugs 6.1/6.2/6.3/6.4/6.6/6.7/6.10/6.11(stamping)/6.12.
