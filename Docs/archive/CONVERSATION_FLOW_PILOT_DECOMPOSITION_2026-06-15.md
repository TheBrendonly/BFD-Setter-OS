---
description: 2026-06-15 rigid Conversation Flow pilot decomposition for the BFD voice setter (Voice-Setter-Test / "Main Outbound"). Report-only design doc — Brendan builds the agent's node graph in the Retell dashboard; Claude built the engine + this map. Rigid mode only, never Flex.
---

> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---

# Conversation Flow Pilot — Decomposition (2026-06-15)

Companion to `Docs/RETELL_CONVERSATION_FLOW_EVALUATION_2026-06-11.md` (verdict: CONDITIONAL GO, rigid only). The CF engine in the platform is now built (Stage D): a "Convert to Conversation Flow" action on the voice doc page seeds a rigid 5-node template, and Push to Retell creates + round-trips the flow. This doc is the build map for the **one pilot agent**.

**Hard rules:** rigid mode ONLY (never Flex — it recompiles all nodes into one prompt and re-triggers the token-scaling bill). Prompt/node content is Brendan's: this doc proposes the structure; you author the wording in the Retell dashboard.

## Pilot target

- **Agent:** "Voice-Setter-Test" (`agent_f45f4dd87a4072424f3c84b74c`) = "Main Outbound" setter slot 1. (Per the canonical mapping; do NOT pilot on the Garys yet.)
- **Model:** gemini-3.0-flash, `model_high_priority` on (same class as Crazy Gary's 1.0s LLM latency). Per-node model override is available if a node is trivial.
- **Voice / dynamic vars / begin_message:** engine-agnostic — carried over unchanged.

## Why CF helps here (recap)

Rigid CF sends only `global_prompt + the active node's instruction + transcript + tool history` per turn, so the `{{available_time_slots}}` payload is paid for ONLY in the Book node, not every turn — structurally below the 3,500-token billing scaler. Tier 0 already fixed latency on the single prompt; CF's durable win is surcharge elimination + immunity to the prompt-bloat failure class.

## Node map (rigid, 5 nodes)

The platform seeds exactly this skeleton via `compileWizardToFlowOutline` (`frontend/src/lib/conversationFlowOutline.ts`). Edit node wording + add nodes in the Retell dashboard as needed.

1. **Global prompt** (applies to every node): Gary persona, Australian tone, PERSONALITY & STYLE, GUARDRAILS (banned phrases, no-guarantees, blocked topics), COMPANY facts, and the empty-vars/inbound guidance. This is where the bulk of the current single-prompt body goes. (The platform appends the DYNAMIC VARIABLES block to the global prompt at push — do not paste it yourself.)
2. **Welcome** (`conversation`): greet by `{{first_name}}`, confirm it's a good time. Edges → Qualify (free to talk) / End (busy → offer callback).
3. **Qualify** (`conversation`): the 3 must-haves gate (coach/consultant/course-creator + existing inbound leads + $10k+/mo), one question per turn, weave timeline/decision-maker/budget. Edges → Pitch (qualified) / End (not a fit).
4. **Pitch & Objections** (`conversation`): value of the DFY setter, objection handling (robotic / pricing→Brendan / competitors / DM-only), max 2 attempts per objection. Edges → Book (agrees) / End (declines).
5. **Book Appointment** (`conversation` or `subagent` with tools): the ONLY node that touches the booking tools. Edge → End.
6. **End** (`end`).

Objections / "call me back" / wrong-number are good candidates for **global nodes** (trigger from anywhere, return to the prior node) instead of always-loaded prompt sections — this is the structural win over the single prompt.

## Tool placement

Attach the existing custom tools (all already pointing at `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools`) to the **Book node** (and reschedule/cancel if you want them in-flow):

- `get-available-slots` `{ timeZone, startDateTime, endDateTime }` — only for dates beyond the pre-loaded window.
- `book-appointments` `{ email, timeZone, startDateTime }`.
- `get-contact-appointments`, `update-appointment`, `cancel-appointments` — for reschedule/cancel.
- `send-sms`, `schedule-callback` — optional, attach if you want them mid-call.
- `end_call` — Retell built-in.

Tool parity with single-prompt is verified (CF eval section d). Map tool responses into dynamic variables via `response_variables` so slots fetched in-call don't re-inject every turn. **Do NOT carry over the phantom `get_contact` tool** (it doesn't exist; the live single-prompt's booking step was gated on it — book directly once the slot is confirmed, email pre-loaded).

## The field-overlay / round-trip contract (how editing works without clobbering)

The platform's outline (`FlowOutline`) is a thin editable projection. Each node keeps the **full raw Retell node JSON** in `raw`; the UI only edits `global_prompt`, each node's `instruction.text`, and edge `condition` prompts. At push, retell-proxy overlays those three fields back onto `raw`, so **graph surgery you do in the Retell dashboard (adding nodes, tools, edges, response_variables) is preserved** — it round-trips via `get-conversation-flow` on the next open.

Therefore:
- **Safe to edit in the Retell dashboard:** node graph shape, tools, response_variables, per-node models, transition logic, anything.
- **Safe to edit in the BFD setter UI:** global prompt text, node instruction text, edge condition wording.
- The two reconcile on open (live flow wins for graph; your in-app text edits push back over it).

## Create → push → round-trip lifecycle

1. Open the setter's doc page → **Convert to Conversation Flow** (agency-only). Seeds the 5-node template from the current prompt as the global prompt; `status=draft`, no `conversation_flow_id` yet.
2. Edit the node instructions / global prompt in the BFD UI → **Push to Retell**. This calls `sync-voice-setter-cf` → `create-conversation-flow` + `create-agent` (`response_engine: { type: "conversation-flow" }`) + publish + phone repoint, and stores `conversation_flow_id`.
3. Build out the real node graph + tools in the **Retell dashboard**.
4. Reopen the doc page → it hydrates from the live flow (your dashboard work appears); tweak text, push again.

## A/B gate before any fleet rollout (from the eval)

Pilot vs the post-Tier-0 single-prompt Gary on TEST_PHONE_A. GO to fleet only if: booking rate ≥ control, NO `llm_token_surcharge` product line on `GET /v2/get-call/{id}`, `latency.llm.p50` < 900ms, transcript quality holds (no robotic rigid-transition feel). Keep the old single-prompt agent untouched as instant rollback (phone repoint is engine-agnostic).

## What's built vs deferred

- **Built (Stage D, 2026-06-15):** Convert-to-CF entry point + seed template; push/create/round-trip path (retell-proxy `syncVoiceSetterConversationFlow`, already deployed v35). Rigid only; no flex flag anywhere.
- **Deferred:** in-app wizard→CF compile (authoring the whole graph in the BFD UI). Not needed while you author node prompts in the Retell dashboard. Fleet migration tooling — only after the pilot passes the gate.
