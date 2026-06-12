# Retell Conversation Flow vs Single-Prompt: BFD Voice Setter Deep-Dive

**Date:** 2026-06-11. Research only; no changes applied, no Retell writes.
**Verdict: CONDITIONAL GO.** Adopt Conversation Flow as the target architecture via a single pilot agent, sequenced AFTER the already-specified Tier 0/1 latency fixes. Do NOT use it as the latency fix; Tier 0 is the latency fix. No-go on immediate fleet migration.

## Context

The 2026-06-10 latency investigation (`Docs/VOICE_LATENCY_INVESTIGATION_2026-06-10.md`) found the live setters' ~55k-char prompts resolve to ~155-230k tokens per turn (19-21x `{{available_time_slots}}` substitutions), causing 2.6-6.8s voice-to-voice latency, first-token timeout loops, and a token surcharge that was 92% of call cost. Tier 0 (one substitution, Brendan via UI) is already specified and gets latency to ~1.2s. This deep-dive answers the bigger question: should the setters move to Retell **Conversation Flow** (CF) engines?

Sources: docs.retellai.com (claims verified by direct fetch + 3-vote adversarial verification where the workflow completed), retellai.com/pricing, live Retell account telemetry (read-only), full repo code-path audit.

## (a) How Conversation Flow works, and the token/latency math

- A CF is a graph: **conversation nodes** (dialogue, NO tool calling), **subagent nodes** (dialogue WITH tool calling), **function nodes** (deterministic tool execution), logic-split nodes, transfer/end nodes. A **global prompt** (persona) applies to every node. **Global nodes** trigger from anywhere on a condition (objections, "call me back") and can return to the previous node.
- **Per-turn context in standard ("rigid") mode = global prompt + the ACTIVE node's instruction + transcript + tool history.** Other nodes' instructions are not sent (verified 3-0 against docs: "only the active node's prompt is sent to the LLM"). A single conversation node can hold a free-flowing multi-turn stage; you split nodes "when there's logic split, or the instruction got too long".
- **Flex Mode is a trap for our case:** it compiles ALL node instructions + transitions + tool descriptions into one prompt, re-approximating single-prompt behavior, and docs warn it commonly triggers the token-scaling billing rule. Avoid; use rigid mode (docs: "To control costs, consider using rigid mode").
- **Per-node model override** exists (e.g. cheap/fast model on simple nodes); per-call pricing = time in each node x that node's model rate.
- **Account-local empirical proof** (the 2025-05-16 "Eddie Dilleen - Conversation Flow" test call, 18 nodes / 710-char global prompt): **966 avg tokens/LLM request, LLM p50 678ms, e2e p50 ~2.0s** on gpt-4.1 without high-priority. Compare: current big-prompt agents 149k-189k tokens / 2.0-6.4s LLM; healthy May-era single-prompt 15.7k tokens / 0.66-0.73s LLM. (Caveat: n=1, no custom tools fired.)
- Verdict on (a): yes, rigid CF structurally caps per-turn tokens at global-prompt + one node, BUT a Tier-0-fixed single prompt (~17-20k tokens) already meets the latency target (~1.2s, proven by May data). CF's marginal latency win over a fixed single prompt is modest; its structural win is the token/cost cap and the fact that the slots variable is only paid for in booking-branch nodes instead of every turn.

## (b) Cost

- Per-minute LLM pricing is **identical for both engine types** (retellai.com/pricing lists no CF premium): voice infra $0.055/min + TTS + LLM/min (gemini-3.0-flash $0.027, gpt-4.1 $0.045, gpt-4.1-mini $0.016, claude-4.5-haiku $0.025; Fast Tier/high-priority ~1.5x).
- The differentiator is the **token-scaling rule** (docs.retellai.com/accounts/billing-exceptions): tokens counted = global prompt + tool descriptions + node/state prompt + transcript + tool history; above **3,500 tokens**, `Billed Duration = Original x (Tokens / 3,500)` (rounded up). Our June calls show this empirically: `llm_token_surcharge` = 474.6 of 516.6 cost units on the smoking-gun call (~10x inflation). The CF test call had **zero surcharge line**.
- Estimated steady-state per minute (gemini-3.0-flash, high-priority, ElevenLabs TTS):
  - Today (June big prompts): ~$1.50+/min effective.
  - Post-Tier-0 single prompt (~17-20k tok/turn): surcharge factor ~5x on the LLM line, ~$0.30-0.40/min.
  - Rigid CF (~1.5-3k tok/turn): factor ~1, **~$0.15-0.20/min**, roughly halving post-Tier-0 cost and ~10x below today.

## (c) Build + maintenance complexity

- Single prompt: one text box, Brendan iterates freely in the setter UI; entire platform (Save Setter push path, Verify Setter Prompt, fork, x-ray map) is built around it.
- CF: graph of 15-25 nodes per persona; editing means editing nodes/edges in the Retell dashboard or via API JSON. Retell explicitly positions CF for "more complex scenarios with predictable outcomes" and recommends leaving single prompt at >1000 words or >5 functions; we're at ~8-9k words and 7 functions, 8x past the threshold. Multi-prompt (Retell LLM `states`) is a middle option, not deprecated, but CF is Retell's flagship for production branching.
- Honest cost: prompt-decomposition (55k chars → global prompt + nodes) is real design work per persona, and the BFD setter UI loses its "one editable prompt" model unless we build a CF-aware editor (significant frontend work).

## (d) Fit for these agents (free-flowing qualification + structured booking)

Good fit, and the "hybrid" IS rigid CF:
- Qualification stage → 1-3 prompt-driven **conversation nodes** carrying the persona/qualification content (multi-turn, free-flowing within a node; verified).
- Objections / "not a good time" / human-handoff → **global nodes** with go-back, replacing big always-loaded objection sections.
- Booking → a structured branch: **subagent node** (dialogue + `get-available-slots`/`book-appointments`) or function nodes; full **custom tool parity** verified via the create-conversation-flow API schema (`type:"custom"`, url, headers, query_params, speak_during/after_execution, timeout_ms); the existing `voice-booking-tools` endpoints attach unchanged. `response_variables` can map tool responses into dynamic variables (slots fetched in-call instead of injected into every turn).
- Dynamic variables (`{{...}}`, `default_dynamic_variables`) fully supported; `model_choice.high_priority` supported; `start_speaker` supported.
- Residual unknown: whether edge/transition evaluation adds extra LLM calls per turn (docs silent; the test call showed ~1 request per turn, so likely no).

## (e) Migration effort

- **API**: full parity. `POST /create-conversation-flow`, update/get/list, agent `response_engine: {type:"conversation-flow", conversation_flow_id}`. Publish/version/phone semantics unchanged. **No automated single-prompt→CF converter found in the docs**; decomposition is manual design work.
- **Account precedent**: "Eddie Dilleen - Conversation Flow" (May 2025) proves the pattern works here; note it used native Cal.com tools, ours would use the custom GHL tools (parity verified).
- **Repo impact** (full code audit): engine-SPECIFIC, needs rewrite: `retell-proxy/index.ts` `syncVoiceSetter()` (437-895, hardcoded `type:"retell-llm"`, `general_prompt`/`general_tools` payloads), `fork-slot-direction` (1435-1610), `refresh-booking-tool-messages` (1346-1416), `delete-voice-setter` (1262-1308); `PromptManagement.tsx` Save Setter assembly (6042-6150, builds ONE `fullPromptForRetell` string); `AgentConfigBuilder.tsx` `__full_prompt_manual_override__` (2039, 2227-2230). Engine-AGNOSTIC, unchanged: phone repointing, direction fan-out, voice/model selectors, voice settings, voicemail, webhooks, rename, `duplicate-setter-config`, `buildAvailabilityDynamicVariable`.
- Realistic estimate: pilot agent ~1-2 days of design + dashboard build (Brendan, with a prepared decomposition doc); platform support (proxy + UI) ~1-2 weeks of code if fleet rollout is approved.

## Recommendation: CONDITIONAL GO

1. Tier 0/1 first (already specified): fixes latency and ~10x cost this week, no architecture change.
2. Then pilot ONE rigid CF agent and decide fleet rollout on measured numbers. CF's durable wins: surcharge elimination (~2x cheaper than even post-Tier-0), structural immunity to the prompt-bloat failure class that caused this incident, per-node models, predictable booking flow, vendor-aligned architecture (we exceed Retell's single-prompt threshold 8x).
3. Do not use Flex Mode. Do not migrate the fleet before the pilot proves booking-rate parity: conversation quality risk (rigid transitions feeling robotic) is the main thing only a live A/B can rule out.

## Phased plan

**Phase 0: Prerequisite (this week, already specified elsewhere):** Brendan applies Tier 0 (single `{{available_time_slots}}`, de-dup, begin_message); Tier 1 code lands (push-time guard, compact slots, tool hardening, latency surfacing). Capture post-fix baseline: `llm_token_usage.average`, `latency.llm.p50`, cost/min, booking rate.

**Phase 1: Pilot (research→design, ~1-2 days):** Claude drafts a decomposition doc (report-only: global prompt + node map + edges + tool placement for ONE persona, proposed: Voice-Setter-Test). Brendan builds it in the Retell dashboard as a NEW agent (no existing agent touched), attaching the existing voice-booking-tools custom tools, high_priority on, gemini-3.0-flash (or A/B gpt-4.1-mini). Test calls to TEST_PHONE_A.

**Phase 2: Decision gate (1-2 weeks of calls):** A/B pilot vs post-Tier-0 Gary on: e2e p50, tokens/request, cost/min (expect no `llm_token_surcharge` line), booking completion, transcript quality (robotic-transition check). GO to Phase 3 only if booking rate >= control and cost/latency wins hold.

**Phase 3: Platform support (code, 1-2 weeks):** Add CF mode to `retell-proxy` (create/update-conversation-flow sync path alongside `syncVoiceSetter`), template-driven section→node mapping in the setter UI, adapt fork/delete/refresh-tool-messages, keep retell-llm as legacy mode. EE1-style guards (never fan a CF push across shared agents).

**Phase 4: Staged fleet migration:** One persona at a time, old single-prompt agents kept untouched as instant rollback (phone repoint is engine-agnostic). Voice-Setter-master (gpt-5.4, 70k chars) last, and move it off gpt-5.4 per the existing Tier-2 recommendation.

## Verification

- Pilot: `GET /v2/get-call/{id}` after each test call → `llm_token_usage.average` < 3.5k, `latency.llm.p50` < 900ms, no surcharge product line, `tool_calls` populated on bookings.
- Phase 3 code: push a CF setter end-to-end from the UI, confirm flow JSON on Retell matches the template, place a booking test call, confirm GHL appointment + verbal confirmation.
