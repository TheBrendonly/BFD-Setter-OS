# BFD-Setter — Prompt Update List (canonical)

Prompt-CONTENT changes Brendan applies himself through the BFD setter UI. This is the one home for
"the agent should say / stop saying / handle X" prompt wording, kept **separate from code work** so it
can be worked independently.

- **Why a separate list:** prompt content is **hard report-only** (project `CLAUDE.md` "Voice Agent Prompts:
  Do Not Edit, Report Only", and the same rule for Text setters). Claude reports the exact wording and
  location; **Brendan applies it via the UI** (Prompt Management → the setter → SETTER CORE, then Save/Push).
  Claude never edits live prompt content, on the Retell backend or in the repo prompt files.
- **This is NOT for code.** Engine/assembly behavior (how availability, current time, tool rules are
  injected) is code-owned and lives in `Docs/BUG_LIST.md` / `FEATURE_ROADMAP.md`. Many prompt "issues" are
  better fixed in code (that is the whole point of **PROMPT-AUTH-1**); when that is true it is noted on the
  item and the item is only what genuinely must live in the client's stored persona.
- **Companion lists:** bugs → `Docs/BUG_LIST.md` · features → `FEATURE_ROADMAP.md` · your other manual
  actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated → `Docs/DEFERRED.md` · first-client-gated → `Docs/FIRST_CLIENT_TASKS.md`.
- **Status:** `[ ]` to apply · `[~]` partly applied / superseded by code · `[x]` applied (move to
  `Docs/archive/COMPLETED_LOG.md`). Items marked **(voice)** apply to Retell voice setters; **(text)** to the
  external `text_prompts` system prompt; **(both)** to either.
- **Report-only boundary reminder:** the setter's booking MECHANICS (tool names, "only offer injected
  slots", current-time handling, availability) are code-owned as of PROMPT-AUTH-1. Do **not** re-add
  booking/scheduling rules into a stored persona prompt — keep the stored prompt to persona, tone,
  qualification, and company facts. If a booking rule seems missing, it is a code item, not a prompt item.
- **Agent-scope reminder (Brendan, 2026-07-07):** only **Main Outbound** and **Inbound BFD Agent** need
  compliance-grade prompt polish (recording disclosure, telemarketing purpose statement, personalization,
  placeholder guards) — they're the two agents used for the real business. **Gary - Crazy Gary**,
  **Gary - Finance Strategist**, **Gary - Mortgage Broker**, and **Gary - Property Coach** are demo/example
  personas showing prospects how differently-voiced agents can sound — leave their persona prompt content
  as-is. They still need to work practically (booking mechanics, tool configs), just not compliance-polished.
  Don't scope future compliance items into these four unless Brendan says one is on a real outbound campaign.

> **2026-07-11 reconciliation:** the applied/resolved items **PU-1, PU-3, PU-4, PU-6, PU-7, PU-8, PU-10, PU-12**
> (all verified live 2026-07-07) and **PU-9** (the load-bearing CODE half, PU-9-CODE, shipped + verified 2026-07-11)
> were archived → `Docs/archive/COMPLETED_LOG.md`. **PU-2** stays below as superseded-by-code (no action). Only
> **PU-5, PU-11, PU-13** remain genuinely open, all optional/gated.

---

## Open

- [ ] **PU-5 — Stand up "Main Outbound V2" (voice).** A full new-prompt draft is ready:
  `Docs/archive/MAIN_OUTBOUND_V2_PROMPT_2026-06-16.md` (folds the Eddie/"Steven" structure into BFD V1: call-flow
  map, consent/AI-disclosure beat, path triage + goal hierarchy Book>Callback>Info, booking-failure ladder,
  post-booking prep, TTS formatting, rapport). Stand it up yourself via the BFD setter UI (duplicate Main
  Outbound → rename V2 → paste → Save+Push → canary publish), then send Claude a `call_id` for read-only
  verification. **This supersedes the older standalone "booking guardrail" voice item** (V2 includes it). Optional.

- [ ] **PU-11 — Live-transfer prompt line (voice; pairs with F16(d) live-transfer config). DEFERRED by Brendan
  2026-07-07** — the prompt half of the default-OFF F16(d) feature, not needed until he's actually fielding
  transferred calls. **Decision recorded for when he does set it up: apply to BOTH Main Outbound + Inbound BFD
  Agent** (the 4 demo personas stay untouched). Destination number TBD at setup time. Confirmed 2026-07-07: the
  `transfer_call` **tool** doesn't exist on any of the 6 canonical agents yet (all share the same 8 tools), so two
  steps are needed per setter that should transfer: (1) add the `transfer_call` tool with a real destination number
  via Prompt Management → the setter's Voice/Retell settings → Tools; (2) add the prompt line so the agent offers
  it, e.g. *"If the caller clearly asks to speak to a human, or you can't help, offer to connect them and use the
  transfer_call tool."* The "SMS a context-summary on a FAILED transfer" fallback is a separate deferred build (not
  a prompt item). Priority Medium.

- [ ] **PU-13 — BOOK-TZ-1: state offered times in the lead's own timezone (voice; Main Outbound + Inbound).**
  Code now captures the lead's timezone (`leads.timezone`, from the GHL contact) and, on outbound calls, injects
  Retell dynamic vars `{{lead_timezone_label}}` / `{{lead_timezone}}` / `{{business_timezone_label}}` /
  `{{business_timezone}}`. **These are inert until the prompt references them** (like `{{recording_disclosure}}`).
  `{{lead_timezone_label}}` is EMPTY when the lead is in the same/unknown zone, so a conditional reads cleanly.
  **What to add** (Prompt Management → the setter → SETTER CORE, near the booking/offer rules): *"Times on the
  calendar are in {{business_timezone_label}} time and you must book exactly those times. If
  {{lead_timezone_label}} is set, when you SAY a time to the lead, give it in both zones, e.g. 'Thursday 2pm
  {{business_timezone_label}} time, which is around 12pm your time in {{lead_timezone_label}}.' Never change the
  time you book — only how you say it."* The TEXT setter already gets this code-side; this PU is the VOICE half.
  **Booking is unaffected.** Priority Low; **gated on a real interstate lead segment** (also in
  `Docs/FIRST_CLIENT_TASKS.md` as BOOKTZ-1). Source: Session P2 BOOK-TZ-1 build; `leadTimezone.ts`.

## Superseded by code (kept for the record)

- [~] **PU-2 — BOOK-1 text-setter anti-fabrication / booking rules (text) — now CODE-OWNED, do not add to the
  stored prompt.** Originally (2026-06-30) a report-only tweak to add "never invent scarcity / always call
  get-available-slots / book the exact accepted time" rules to `text_prompts.system_prompt`. As of
  **PROMPT-AUTH-1** these are owned code-side (`setterTools.ts` `TOOL_USAGE_INSTRUCTION` + the injected
  availability block + the slot-binding validator) and the stale booking blob was *removed* from the stored
  prompt via the Setter-1 migration. **Do NOT re-add these rules to the stored persona.** Left here so the
  history is traceable; no action. Source: BUG_LIST BOOK-1 / PROMPT-AUTH-1.

## Verify-only (reported applied; confirm behaviorally, don't re-edit)

- [ ] **T10b inbound "ask for details" (voice)** — the inbound path should NOT re-ask for name/email when the
  caller matches a known lead (dynamic vars are preloaded); keep a fallback for unknown/withheld callers. A
  2026-06-16 live read found no anti-pattern; confirm on a live inbound call that Gary greets by name and does
  not re-ask. No edit unless the live call shows the anti-pattern.
