---
description: Session 7 TEST pass phone-half (2026-06-30) — passes banked, bugs found (BOOK-1/2/3, MODEL-1, SMS-OBS-1, PHONE-CLEAR-1), overnight Text-Setter repair set up + council-vetted; remaining live items deferred.
---

# Session 7 — TEST pass, phone-half (2026-06-30)

Brendan-driven live sweep; Claude verified read-only. Continued the Session-7 TEST pass (UI half / LIVE-A was 2026-06-28). The big outcomes: the whole **voice call cluster + F9 lifecycle passed**, a **live-breaking bug (MODEL-1) was found + fixed**, and the **SMS-booking failure (BOOK-1) was root-caused** → it spawned a council-vetted **overnight Text-Setter repair session** (kickoff prompt at the bottom).

## Passed (→ COMPLETED_LOG)
- **B-4 (6.2)** client-role RLS + "My Account only" nav. Claude provisioned + deleted a throwaway client-role user; read-only RLS proof (own-agency user sees 0; cross-agency boundary solid). **Finding (by-design):** RLS is agency-scoped, not per-client; within one agency a client role is UI-scoped, not DB-isolated, from siblings (each real client = own agency via signup).
- **F2c** outbound calling E2E (cadence "Try-Gary: Property Coach" n3 phone_call → Property Coach; placed/dialed/correct agent/cadence advanced).
- **G3-3** outcome stamped + `active_call_id` cleared on `call_ended`.
- **6.12b** call-half (GHL Call Outcome=Answered / AI Summary / Last Call Date / Sentiment / Intent) + SMS-half (`last_sms_analyzed_at` advanced + SMS sentiment/intent on the contact).
- **F9 outbound-dials-while-locked** (call placed on the locked setter) + **F9 unlock** (rename cascaded to Retell + DB with NO 423 → full F9 lifecycle verified).
- **B4** call-side send-once (one dial). **Latency** acceptable (Trigger dequeue, tens of seconds).
- **B-3 (6.4)** phone-clear (BFD `phone=null` + GHL phone cleared).
- **6.11** voicemail/no-answer → fallback SMS ~9s after call end (not the old ~600s).
- Migrated LIVE-A UI passes: F2b, F6, B-6×2, F9 lock/bulk/Pull.

## Bugs found (→ BUG_LIST)
- **BOOK-1 (H)** — the SMS setter **fabricates "booked out / snapped up" and never books** against an OPEN calendar (live GHL = 180 free slots; the "full" wording exists nowhere in code → model invented it). Root structural cause: Text doesn't prefetch availability the way Voice does. **Fix = the overnight session below.**
- **BOOK-2 / BOOK-3 (L, shared-fn defer)** — `resolveCanonicalSlot` off-grid-minute false-negative; `toMs()` parses offset-less ISO as UTC (AU window skew). Both in the **shared** `voice-booking-tools` (zero tests, frozen Session-7 baseline) → write-up + characterization test only, supervised daytime edit.
- **SMS-OBS-1 (M)** — tool calls/responses not persisted (`processSetterReply.ts:344` `tool_calls:[]`) → booking failures are DB-blind. Persist them (overnight session's first deliverable).
- **MODEL-1-HARDENING (M)** — `clients.llm_model` was `google/gemini-flash-latest` (invalid OpenRouter id) → silently 400'd ALL SMS + cadence AI; `normalizeLlmModel` only strips `~`/whitespace. **Live value FIXED to `google/gemini-2.5-flash` via Mgmt API.** Hardening = validate the field.
- **PHONE-CLEAR-1 (L)** — clearing a lead's phone doesn't clear `leads.normalized_phone` → still inbound-/STOP-matchable by the old number.

## Live changes applied this session (Brendan-approved)
- `clients.llm_model` `google/gemini-flash-latest` → `google/gemini-2.5-flash` (MODEL-1 fix; unblocks SMS + cadence AI).
- `agent_settings.response_delay_seconds` all 7 BFD setters 60/82 → **12s** (SMS latency).
- (Transient, restored) Supabase PAT in `.env` expired mid-session → Brendan refreshed it.

## Still owed (→ Session 7-finish, after the overnight repair + fix pass)
B-5 (inbound from a non-CRM number), F1 (fresh GHL contact deep-link), LIVE-D (B-2 ×4 + manual-send/429), LIVE-E (F3/F4), G3-6 Tier-3 analytics, **3.12 SMS booking (blocked on BOOK-1)**, and live-verify of F11/UI-1/INB-1.

## Sequence from here (see `Docs/SESSION_PLAN.md`)
1. **TONIGHT — Session 7.5: overnight Text-Setter structural repair** (prompt below). Branch-only, deploy-nothing.
2. **Fix pass** — F9-1, VM-1, API-DEPR-1, PHONE-CLEAR-1, MODEL-1-HARDENING, G3-8(a).
3. **Session 7-finish** — the remaining live TEST items.
4. **Session 8** — F8 cost-to-price calculator (PLAN mode).

Council verdict on the overnight session: **GO-with-changes**. Key catches folded into the prompt: `voice-booking-tools` is shared with live Voice + the frozen Session-7 edge baseline (read-only tonight, no deploy); BOOK-2's HH:MM canonicalization is a deliberate load-bearing fix (don't "offset-fix"); no upstream git remote (reference = `n8n/exports/Text_Engine_REVERSE_ENGINEERED.md`); both prompts report-only; observability persistence first; spec-kit thin front-door only.

---

## Overnight Text-Setter repair — kickoff prompt (paste into a fresh session tonight)

```
BFD-setter — TEXT SETTER structural REPAIR (research → fix, own overnight session, UNSUPERVISED). Repo /srv/bfd/Projects/bfd-setter.

== WHAT THIS IS ==
This is research-then-REPAIR on an UNDERSTOOD pipeline. NOT a feature build, NOT a rewrite. Goal: guarantee a ready-to-book SMS lead ALWAYS reaches a real GHL booking by making the booking PLUMBING bulletproof and giving the model ground-truth availability — EVEN WHEN THE PROMPT IS WEAK. Match the Voice Setter on booking OUTCOME, not mechanism: keep Text async, debounced, message-grouped, STOP-interruptible. The trigger was the live finding that the SMS setter fabricates "booked out" against an OPEN calendar (BOOK-1).

== CONTEXT / CREDS ==
Branch off main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY). Live DB via Supabase Management API /database/query with a BROWSER User-Agent (NOT postgres MCP, NOT for writes tonight). Live GHL via clients.ghl_api_key (a pit-… token; repo .env BFD_GHL_* are STALE). The TEXT setter prompt + chat history live in the CLIENT'S EXTERNAL Supabase (clients.supabase_url / supabase_service_key) in text_prompts.system_prompt (card_name "Setter-N") + chat_history. BFD client_id = e467dabc-57ee-416c-8831-83ecd9c7c925.

== ABSOLUTE GUARDRAILS (read twice; violating these is the failure mode) ==
1. DEPLOY NOTHING. No `supabase functions deploy`, no Trigger.dev deploy, no Retell PATCH/publish, no Supabase Management-API WRITE, no save-external-prompt call, no live SMS/outbound calls/GHL booking POSTs. Work ONLY on an isolated git WORKTREE branch off clean main (e.g. overnight/text-setter-repair). NEVER push/merge/deploy. End state = branch + docs + handoff for Brendan's daytime review.
2. FROZEN BASELINE (verbatim): retell-proxy v46, make-retell-outbound-call v27, and the current live voice-booking-tools version MUST NOT be redeployed tonight — Session 7's PAUSED live TEST baseline depends on it. You may edit source on the branch, but the live versions stay frozen.
3. EDITABLE ALLOWLIST (edit + TDD these only): trigger/processSetterReply.ts, trigger/_shared/setterTools.ts, trigger/_shared/setterToolLoop.ts, trigger/_shared/llmModel.ts, their *.test.ts siblings, and a NEW tool-invocation-persistence migration/table.
   READ-ONLY TONIGHT (do NOT edit): frontend/supabase/functions/voice-booking-tools/**, retell-proxy/**, make-retell-outbound-call/**, receive-twilio-sms/**, _shared/bfdVoiceTools.ts, and ALL prompt content (Retell voice prompts AND the external text_prompts.system_prompt). voice-booking-tools is SHARED with the LIVE Voice path and has ZERO tests — treat it as hazardous-by-default (ref project_ee1_fanout_incident_2026_05_18: shared-surface fan-out wiped live data).
4. PROMPTS ARE REPORT-ONLY (both Retell voice AND external text_prompts — even though save-external-prompt makes the text one writable through our product). Do NOT edit prompt content. Stored-prompt weaknesses are REPORTED for Brendan (append a copy-paste-ready recommendation to BRENDAN_TODO + the project_pending_prompt_changes memory), never edited. Behavior is steered ONLY through editable code.
5. Do NOT change identity-injection order (contactId pinned LAST in setterToolLoop) — the EE1 cross-wiring guardrail.
6. Do NOT touch clients.llm_model or response_delay_seconds for real clients (MODEL-1 already remediated to google/gemini-2.5-flash). Any model/debounce change is a code-default or a written recommendation only.
7. Surgical only: every changed line traces to a numbered defect in the Phase-1 doc. No opportunistic refactor of the (already-robust) tool loop, no "cleanup" of the shared fn, no broad processMessages rewrite.

== SKILLS (mandatory) ==
The SUPERPOWERS chain is the executor: brainstorming → systematic-debugging → writing-plans → test-driven-development → verification-before-completion, with dispatching-parallel-agents for read-only research lanes. Use spec-kit ONLY as a thin front-door: at most /speckit-specify (one spec: "Text Setter structural correctness vs Voice Setter"), optionally /speckit-tasks. SKIP /speckit-clarify (no human overnight) and /speckit-analyze (the constitution is still the empty [PROJECT_NAME] template — the gate is hollow). Do NOT use /speckit-implement as the executor and do NOT fill/rewrite the constitution as a side-quest. If spec-kit shows any process churn, drop it and run pure superpowers.

== PHASE 0 — SETUP ==
Create the worktree branch. Write a one-page "shared-surface contract" to scratchpad classifying every relevant file as FREELY-EDITABLE (the trigger/* text-path allowlist) / GATED (shared, write-up only) / REPORT-ONLY (prompts). Give that doc to every subagent so none independently edits the shared fn.

== PHASE 1 — RESEARCH (read-only HARD GATE; no code edits until the doc exists) ==
Fan out parallel READ-ONLY subagents on DISJOINT lanes:
  (A) TEXT path trace: processSetterReply → setterToolLoop → setterTools → (shared) voice-booking-tools. System-prompt assembly + token SIZE. Model selection. Debounce (agent_settings.response_delay_seconds).
  (B) VOICE path trace: make-retell-outbound-call slot PREFETCH (it injects available_time_slots into a Retell dynamic var so the model sees open times BEFORE it speaks) + retell-proxy → the SAME voice-booking-tools. The standalone-prompt UI (frontend/src/components/prompt-doc/PromptDocPage.tsx + PromptManagement/AgentConfigBuilder). Prompt SIZE (was historically too large — check Text for the same).
  (C) REFERENCE trace: n8n/exports/Text_Engine_REVERSE_ENGINEERED.md (the real local reference for the original Text engine) + shared-tool trace. NOTE: there is NO upstream git remote here; genokadzin/1prompt-os is our heavily-divergent fork BY DESIGN — do NOT clone it as a dependency, do NOT treat it as a correctness oracle, do NOT revert deliberate BFD divergences. If referenced at all, flag best-effort; never fabricate a diff.
  (D) TEST-COVERAGE inventory (note voice-booking-tools has ZERO tests).
Output = ONE comparison doc: a "Text vs Voice structural map" table (slot lookup / book / reschedule / cancel / callback / debounce / model selection / identity injection / persistence — where each implements it + whether they SHARE code), ending in a NUMBERED, file:line-cited defect list. Tag each defect: [CODE-TEXT-SAFE] / [CODE-SHARED-DEFER] / [PROMPT-BRENDAN] / [INTENTIONAL-DIVERGENCE]. Pre-seed the list (do NOT silently drop these):
  - BOOK-1 = [PROMPT-BRENDAN] + code-side levers. The SMS model fabricates unavailability and never calls book-appointments (proven: live GHL = 180 free slots; setter said "snapped up"). Root structural cause: unlike Voice, Text does NOT prefetch availability — it depends on the model voluntarily calling get-available-slots.
  - BOOK-2 = [CODE-SHARED-DEFER] (write-up + characterization test only). CORRECT PREMISE: resolveCanonicalSlot in voice-booking-tools ALREADY deliberately ignores the model's timezone offset and matches wall-clock HH:MM against GHL's own grid — this is the LOAD-BEARING, live-proven fix (same slot books with +10:00, 400s without). BOOK-2 is the NARROW exact-HH:MM-vs-grid granularity defect (an off-grid minute → false "unavailable"); the eventual fix is snap-to-nearest-real-grid-slot OR return slot_unavailable with real alternatives — NEVER change offset handling, NEVER loosen to fuzzy matching, NEVER POST an unvalidated time. Do NOT apply tonight (shared fn).
  - BOOK-3 = [CODE-SHARED-DEFER] (write-up only). Separate, narrow: toMs() parses offset-less ISO (which setterTools.ts:46 tells the model to send) as UTC for the free-slots WINDOW → AU windows shift ~10h / day off-by-one. Shared fn → write-up + characterization test only.
  - OBSERVABILITY = [CODE-TEXT-SAFE]. processSetterReply.ts:344 hardcodes tool_calls:[]; loopResult.toolInvocations (populated in setterToolLoop) is never persisted. Build the persistence FIRST.

== PHASE 2 — IMPLEMENT (only after the Phase-1 doc exists + the defect list is frozen/tagged; ONLY [CODE-TEXT-SAFE] items; TDD per fix, failing test first in trigger/_shared/*.test.ts) ==
  (1) PERSIST tool invocations to a new DB table FIRST (highest-value, lowest-risk, Text-only, additive). Gate the rest on this landing green. This is what makes overnight verification sound and unblocks future booking diagnosis.
  (2) GIVE THE SMS MODEL GROUND TRUTH (the structural BOOK-1 fix, mirroring how Voice prefetches): prefetch a get-available-slots window and inject a COMPACT real-open-times block into context on every reply, so the model cannot fabricate availability it never checked. (Read voice-booking-tools' compactSlots for the shape — read-only.)
  (3) Tighten the code-side TOOL_USAGE_INSTRUCTION (setterTools.ts) + add an ANTI-FABRICATION guard (no "unavailable" claim is allowed without a get-available-slots tool result) + a tool_choice nudge to force the get-available-slots turn before any availability assertion / to force book-appointments on lead acceptance.
Anything touching voice-booking-tools (BOOK-2/BOOK-3) is a WRITTEN FINDING + a CHARACTERIZATION test of CURRENT behavior (to establish voice parity before any future edit) for a SUPERVISED daytime session — NOT an overnight apply.

== BOUND THE SWARM ==
Parallel subagents ONLY for independent read-only Phase-1 lanes and file-DISJOINT Phase-2 text edits. ONE coordinator owns all writes to trigger/_shared/. Forbid any subagent from running deploy/network-write commands. Never let two agents edit the same file; never edit voice-booking-tools at all.

== DONE (falsifiable; "works completely" from green tsc alone is NOT acceptable) ==
DONE for the Text-safe scope = (a) tool invocations are persisted to a DB table; (b) get-available-slots is always called/injected before the model may assert unavailability; (c) the off-grid-minute and tz-window cases have failing-then-passing UNIT tests (the SHARED fixes themselves are WRITTEN UP, not applied); (d) `npx tsc` + `npm run test:node` pass with output pasted (verification-before-completion). End-to-end live booking (scripted SMS → confirmed GHL appointment, with the tool log showing get-available-slots THEN book-appointments=confirmed) is what BRENDAN live-verifies later — tsc + unit tests are necessary, NOT sufficient. Do NOT claim BOOK-1 is "fixed from code alone": code makes fabrication structurally impossible (ground-truth slots + forced tool call); the prompt-wording change is Brendan's to apply.

== CLOSE ==
Write: the comparison doc, a fix-summary (what changed; what is unit-verified vs what still needs Brendan's live test), the BOOK-1 prompt recommendation (copy-paste-ready), and a DEPLOY CHECKLIST (every file changed, every test added, the exact deploy commands Brendan would run, and the VOICE-regression checklist he must pass before any new voice-booking-tools version goes live). Update the 5 canonical lists (BUG_LIST for BOOK-1/2/3, TEST_LIST for the voice-regression checklist, BRENDAN_TODO for the prompt + deploy steps). Leave a dated handoff in Operations/handoffs/. Commit to the branch. Do NOT push/merge/deploy and do NOT auto-emit a "next session" as if changes are live; do NOT invalidate the Session 7 TEST baseline/docs.

READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + Docs/BUG_LIST.md (BOOK-1/2/3, MODEL-1) + n8n/exports/Text_Engine_REVERSE_ENGINEERED.md. Follow the Relay Protocol but honor the DEPLOY-NOTHING / branch-only override above.
```
