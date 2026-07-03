# PROMPT-AUTH-1 — Text-setter prompt authoring investigation (2026-07-03)

> Grounding brief for the dedicated solo build session. Produced by the multi-agent investigation
> workflow `text-setter-prompt-authoring-investigation` (4 parallel readers + synthesis, read-only).
> Bug: `Docs/BUG_LIST.md` PROMPT-AUTH-1. Re-test: `Docs/TEST_LIST.md` PROMPT-AUTH-1 section.
> **Verify file:line refs before trusting them** — agents read the tree; a couple of provenance points
> are flagged as unconfirmed (see Phase 0 / Stream 1 caveat).

---

# BFD Text-Setter Prompt Authoring System — Synthesis & Build-Prep Package

Prepared for the solo build session (Fable research/assessment → Opus build). All paths relative to `/srv/bfd/Projects/bfd-setter`. Read-only synthesis of 4 investigation streams. Where streams disagree or a stream could not confirm something, it is flagged inline.

---

## A. PROBLEM STATEMENT

The BFD text-setter booked a lead into the wrong day, wrong time, with a wrong label, while the runtime had already fetched and injected the correct, fully-open live calendar. On 2026-07-03 a lead texted "can I book a meeting?"; the engine correctly prefetched real GHL availability (Monday 2026-07-06 open 08:00-16:30 including 11:00), injected it as ground truth, and persisted the tool calls (`tool_invocations`, `source='sms'`). Despite that, the setter refused Monday ("Monday isn't a day we typically book... we do Tuesdays, Wednesdays, or Thursdays"), offered "Thursday 2pm or 4pm", and on acceptance called `book-appointments` with `startDateTime 2026-07-03T16:00+10:00` — Friday 4pm — while telling the lead "this Thursday at 4pm."

This is **not a prompt typo; it is a systemic authoring-and-assembly failure** with three compounding root causes, all structural: (1) the client's stored 1,680-line `text_prompts.system_prompt` carries a stale, auto-seeded, 554-line legacy n8n "booking function" block (`# BOOKING FUNCTION`, lines ~1127-1680) that hard-codes a fabricated "Available days: Tuesday, Wednesday, Thursday ONLY" policy which overrides the injected live calendar; (2) the only "current time" reference in the entire assembled prompt is a literal, un-interpolated n8n token `{{ $now }}` (lines 1141/1632) — the native text engine does no `{{ }}` substitution, so the model has **no real "today" anchor** and resolves "this Thursday" to an arbitrary absolute date; and (3) the stored prompt is authored by a forward-only section compiler that never round-trips the stored blob back into the editor, buries the 646-line booking template behind a collapsed textarea, and offers only a *read-only* full-prompt view — so **no operator could ever see or delete the offending lines**. The stale content survived precisely because the authoring system made it invisible. Any fix that only edits this one client's prompt would leave the same failure latent in every future client, because the same legacy default (`frontend/src/data/defaultBookingPrompt.ts`) auto-seeds on every "Booking Function" toggle-on.

---

## B. HIDDEN-CONTENT INVENTORY

Every load-bearing / stale / contradictory / dead item in the stored `text_prompts.system_prompt` (card_name `Setter-1`), with provenance and editor-visibility. Line numbers in the stored prompt are from Stream 3's live read; source-of-truth provenance is `frontend/src/data/defaultBookingPrompt.ts` (`DEFAULT_BOOKING_PROMPT`, 646 lines) unless noted. "Visible in editor?" = whether an operator using the current SETTER CORE UI can actually see/edit that text.

| # | Hidden item | Stored-prompt line(s) | Provenance (source file:line) | Visible/editable in editor? |
|---|---|---|---|---|
| 1 | "**Available days:** Tuesday, Wednesday, Thursday ONLY." (fabricated policy) | 1219 | `defaultBookingPrompt.ts:89` (`## BOOKING CONSTRAINTS`), `:91` | No — inside collapsed "View Prompt" booking textarea |
| 2 | "**Available days:** Tuesday, Wednesday, Thursday" (2nd occurrence) | 1634 | `defaultBookingPrompt.ts:502` (`## REFERENCE`), `:506` | No |
| 3 | "**Current time:** {{ $now }}" (dead n8n token; sole time anchor) | 1141, 1632 | `defaultBookingPrompt.ts:13`, `:504`; n8n origin `frontend/public/workflows/text-engine/Text_Engine.json:3411` | No |
| 4 | Canned example bookings ("Booked for this Thursday at 2pm", etc.) — ~11 instances | 1178, 1207, 1213, 1283, 1302, 1306, 1392, 1456 | `defaultBookingPrompt.ts:50,62,65,85,155,170,264,270,328,436,486` | No |
| 5 | Wrong tool name `Get_Available_Slot` (real: `get-available-slots`) | 1223,1275,1340,1414,1492,1583,1588,1610 | `defaultBookingPrompt.ts:95,147,212,286,364,390,455,460,482` | No |
| 6 | Wrong tool name `createContact` (does not exist; identity is engine-injected) | 1476,1255,1259,1324,1582 | `defaultBookingPrompt.ts` | No |
| 7 | Wrong tool names `bookAppointment`, `getContactAppointments1`, `updateAppointment1`, `cancelAppointment1` | 1281/1302/1306/1508; 1382/1446/1520; 1430/1528; 1466/1542 | `defaultBookingPrompt.ts` (n8n node names) | No |
| 8 | Wrong params `startDate`/`endDate` (real schema requires `startDateTime`/`endDateTime`) | 1516-1518 | `defaultBookingPrompt.ts`; contradicts `trigger/_shared/setterTools.ts:43-54,67,77` | No |
| 9 | "ALWAYS offer exactly 2 slots. Not 1. Not 3." (contradicts code "2-3") | 1205 | `defaultBookingPrompt.ts`; contradicts `setterTools.ts:169` | No |
| 10 | "default to EST" timezone rule (client is Australian) | 1239 | `defaultBookingPrompt.ts` | No |
| 11 | `{value}` uninterpolated section-builder placeholder ("## MAX PUSHBACK ATTEMPTS: {value}") | 832 | Section-builder token (persona/content layer) | Partially — via a SETTER CORE param, but token leaks unresolved |
| 12 | Duplicate `## GOAL: ENGAGE & QUALIFY` (3×) | 7, 74, 150 | Section compiler concat (`AgentConfigBuilder.tsx:2878-2938`) | Sections editable; duplication itself not visible as such |
| 13 | Duplicate `## GOAL: BOOK APPOINTMENTS` / `## GOAL: NURTURE LEADS` | 21/164; 33/176 | Section compiler | As above |
| 14 | Duplicate "CRITICAL: DO NOT rush to book." | 25, 168 | Section compiler | As above |
| 15 | Duplicate `## BLOCKED TOPICS` (back-to-back) | 936, 952 | Section compiler | As above |
| 16 | Heading collisions `## MESSAGE LENGTH`, `## REFERENCE`, `## CONVERSATION EXAMPLES` | 425/448; 196/1630; 1007/1009 | Mixed (section compiler + booking default) | Partial |
| 17 | **Correct** booking-honesty layer (real tool names, anti-scarcity) — the one right layer, but out-gunned | 92-95 | Newer content layer (operator/section) | Yes (this is the visible half) |

Two competing booking layers coexist in the same system message: **Layer A (correct, ~4 lines, lines 92-95)** vs **Layer B (stale, 554 lines / ~4,550 tokens / 26% of the whole prompt, lines 1127-1680)**. This is the core structural defect.

**Provenance caveat (Stream 1, explicit):** Stream 1 confirmed the *content* of items 1-10 originates definitively in `defaultBookingPrompt.ts` (structural byte-for-byte match), but did **not** query the live external Supabase, so it cannot prove whether BFD's specific stored row was produced by the UI compiler vs. the out-of-band writer `scripts/deploy_text_prompt.mjs` (which PATCHes `text_prompts` directly, hardcoded `ROW_ID`/`Setter-1`, bypassing the builder — a desync vector). Stream 3 *did* read the live row and measured it (68,762 chars, 1,680 lines), confirming the items are present live. To get exact-byte proof of origin, the build session should diff the live `system_prompt where card_name='Setter-1'` against `DEFAULT_BOOKING_PROMPT`.

---

## C. AUTHORING GAP — why the operator cannot see/edit the full prompt

The editor is a structured section builder ("SETTER CORE"), not a document editor, and three mechanisms combine to hide the load-bearing content:

**1. Forward-only compile, no reverse-parse.** The stored `text_prompts.system_prompt` is *assembled at save time*, not stored verbatim. Compile chain: `AgentConfigBuilder.tsx:3026-3073` (`buildFullPrompt` → `buildFullPromptSegments` → `segmentsToText`) emits a synthetic `output['__full_prompt__']` (`AgentConfigBuilder.tsx:3056-3063`), which concatenates persona layers + content layers + Conversation Examples + Additional Custom Instructions + `# BOOKING FUNCTION\n\n${agentSettings.booking_prompt}` (`AgentConfigBuilder.tsx:3009-3017`) + `# COMPANY`. The save edge function `frontend/supabase/functions/save-external-prompt/index.ts:29-32,135` joins `[persona, content]` with a separator and writes `system_prompt` to the external `text_prompts` row (`index.ts:176-234`). **Nothing ever reads an existing `system_prompt` back into the editor's fields.** The only code that splits on the `── ── ──` separator is `frontend/src/components/prompt-editor/diffUtils.ts:89`, used purely to render a diff, never to hydrate editable fields. Consequence: the stored blob is a frozen compiled snapshot; the operator's live fields are the *current section values*, which need not match the stored monolith (especially if it was written by an older build or by `deploy_text_prompt.mjs`).

**2. The booking blob is auto-seeded and hidden behind a fold.** On enabling "Booking Function" with no existing booking prompt, the full 646-line legacy default is auto-populated: `AgentConfigBuilder.tsx:3900-3901` (`if (newVal && !agentSettings.booking_prompt) updates.booking_prompt = DEFAULT_BOOKING_PROMPT;`), imported at `AgentConfigBuilder.tsx:3`. It is revealed only after clicking "View Prompt" (`bookingPromptExpanded` defaults `false`, `AgentConfigBuilder.tsx:492`; toggle at `:3928-3945`) and renders as one raw `<Textarea>` (`:3945-3946`), never as labeled fields. An operator scanning the structured sections never encounters the "Available days" / `{{ $now }}` lines.

**3. The assembled whole is view-only.** The manual full-prompt override was deliberately removed: `AgentConfigBuilder.tsx:3064-3066` — "The manual full-prompt override feature was removed (the Verify Setter Prompt view is read-only)." So there is no surface to open the ~1,680-line document and edit it as text.

**4. Runtime trusts the blob wholesale, un-interpolated.** `trigger/processSetterReply.ts:156-161` reads `text_prompts.system_prompt` verbatim (keyed by `slotId = 'Setter-' + Setter_Number`, `:126-127`) and prepends it to the system message (`:175-184`) with no `{{ }}` substitution. Editor and runtime are decoupled: the editor's job ends at "overwrite the blob," and the runtime trusts it entirely.

Net: the operator's mental model ("edit the sections") and the stored artifact ("a frozen monolith containing an auto-seeded legacy booking template") have drifted apart, and no UI surface lets anyone view-and-edit the monolith.

---

## D. VOICE vs TEXT COMPARISON — what to borrow vs rethink

| Dimension | Voice setter | Text setter | Borrow / rethink |
|---|---|---|---|
| **Live/runtime store** | Retell LLM `general_prompt` on the bound agent (`clients.retell_agent_N_id`) | External Supabase `text_prompts.system_prompt`, `card_name='Setter-N'` (`processSetterReply.ts:156-161`) | Text's single home is cleaner — **keep it, don't fragment** |
| **Authoring store** | Platform `prompts` + `clients.system_prompt` + `prompt_configurations` rows + localStorage (`PromptManagement.tsx:5324-5354`; `usePromptConfigurations.ts:20-91`) | Same section pipeline authors, then syncs to external `text_prompts` | Both fragment; **rethink** |
| **Assembly** | 7-layer compile → one `general_prompt` (`AgentConfigBuilder.tsx:2878-3031`); proxy appends booking + `DYNAMIC_VARS_BLOCK` at push (`retell-proxy/index.ts:784`) | Runtime concat: stored prompt + Lead Context + 2 instruction blocks (`processSetterReply.ts:175-184`), then availability appended (`:311-316`) | **Borrow** push/runtime-injection discipline |
| **Operator visibility** | Section fields **+ X-Ray of TRUE final prompt** incl. call-time appends (`frontend/src/lib/promptSegments.ts:1-38`; `frontend/src/components/prompt-doc/CallTimeAppendBlock.tsx:1-43`; `AgentConfigBuilder.tsx:3244-3267`; `frontend/src/components/FullPromptXRay.tsx`) | Section builder exposes only some fields; **no X-Ray**; ~1,680-line body unseen | **Borrow the X-Ray** — strongest single idea |
| **Availability injection** | Per-call GHL fetch → `compactSlots` → `available_time_slots` dynamic var (`make-retell-outbound-call/index.ts:195-226,747-800`) | Per-turn prefetch → `buildAvailabilityBlock` date→times map (`trigger/_shared/prefetchSlots.ts:96-134`), appended | Both good; text lacks a "today" label |
| **Current-time handling** | **Live** `current_time` in `clients.timezone`, `dateStyle:"full"` (day-of-week) as dynamic var (`make-retell-outbound-call/index.ts:766-786`); inbound → discover today via `get-available-slots` (`retell-proxy/index.ts:647-654`) | **None injected.** Only literal `{{ $now }}`, un-interpolated → root cause | **Borrow voice's live-timestamp model** |
| **Empty-variable safety** | `EMPTY_LEAD_DEFAULTS` on the LLM (`retell-proxy/index.ts:815,40-42`); "never guess the day, use the tool" doctrine (`:647-654`) | None | **Borrow** the "ground truth only, never guess" rule |
| **Version history** | Partial (`prompt_versions`, AI/simulator flows only) | Partial (same table); **external `text_prompts` row has none — single mutable field + `updated_at`** | Both weak; **rethink** |

**Verdict.** Borrow four things from voice: (a) the **X-Ray "TRUE final prompt" view** (`promptSegments.ts` / `CallTimeAppendBlock.tsx`) — port it to text so hidden stale content becomes visible; (b) **runtime injection of a fresh current-time block** in `clients.timezone` with day-of-week (mirroring `make-retell-outbound-call/index.ts:766-772`), so it can never go stale; (c) the **empty-variable / "never guess, use the tool" doctrine**; (d) **timezone sourced from `clients.timezone`, formatted with day-of-week**.

Do **not** copy: the 7-layer section compiler as the *only* editing surface (it fragments content across `prompt_configurations` + localStorage + `prompts` + `clients.system_prompt` + the live store and is exactly how content becomes un-seeable); the 3+ manual-sync storage copies; stale seed artifacts baked into the body (`{{ $now }}`, canned times, Tue/Wed/Thu); Retell-style draft/publish divergence (the text engine reads the current row directly — keep that simplicity); and `{{...}}` token conventions unless the engine actually owns the substitution.

**Honest caveat (Stream 2):** for BFD's real "Gary", none of the voice authoring pipeline is the live source of truth — Gary was hand-built in Retell, the repo copy `frontend/src/data/bfdVoiceSetterPrompt.md:1-9` references a deleted LLM, and content is report-only. So voice has its *own* "can't see the live prompt" problem; the X-Ray shows the *pipeline's* prompt, not necessarily the *live* one. Borrow the X-Ray *pattern*, not voice's storage topology.

---

## E. EFFICIENCY & CORRECTNESS FINDINGS

**Size & token estimate (Stream 3, measured from the live row + code constants).** The per-turn system message ≈ **73,300 chars / ~19,800 tokens / ~1,690 lines**, composed of: stored `setterPrompt` 68,762 chars (~18,600 tok, 1,680 lines) + Lead Context (~30 tok, `processSetterReply.ts:177`) + `MULTI_MESSAGE_INSTRUCTION` (440 chars, `:103`) + `TOOL_USAGE_INSTRUCTION` (1,828 chars, `setterTools.ts:162-183`) + appended live-availability block (~2,200 chars, `prefetchSlots.ts:96-134`). Plus the `tools` param (6 schemas, ~4,028 chars / ~1,090 tok, `setterTools.ts:33-152`) and up to 30 history rows (`MAX_HISTORY_ROWS`, `processSetterReply.ts:45,168`).

**This is NOT a context-overflow problem** — model is `google/gemini-2.5-flash` (`llmModel.ts` normalizer), ~1M window, so ~20k tokens ≈ 1.9%. The failure mode is **attention dilution + instruction conflict on a small/fast/cheap model**, plus **cost/latency**: the loop re-ships the ~20k-token system message 2-5× per SMS (`setterToolLoop.ts:107` `DEFAULT_MAX_ITERATIONS=4` + `finalize()` at `:102`). One "book a meeting" text can burn ~80-110k input tokens.

**Redundancy / contradiction list.** Duplicates: `## GOAL: ENGAGE & QUALIFY` ×3 (7/74/150), `## GOAL: BOOK APPOINTMENTS` ×2 (21/164), `## GOAL: NURTURE LEADS` ×2 (33/176), "DO NOT rush to book" ×2 (25/168), `## BLOCKED TOPICS` ×2 (936/952), `## MESSAGE LENGTH` ×2 (425/448), heading collisions on `## REFERENCE` (196/1630) and `## CONVERSATION EXAMPLES` (1007/1009). De-duping alone removes ~1-2k tokens with zero behavior change. Direct contradictions: "never invent scarcity" (92-95) vs "Tue/Wed/Thu ONLY" (1219/1634); live-availability "offer ONLY times in this map" (`prefetchSlots.ts:111`) vs "Tue/Wed/Thu ONLY"; "offer 2-3 options" (`setterTools.ts:169`) vs "exactly 2. Not 1. Not 3." (1205); Australian client vs "default to EST" (1239).

**Tool-name / param mismatches (Stream 3).** Engine-exposed tools (`setterTools.ts:33-152`, guarded at `setterToolLoop.ts:132`): `get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments`, `schedule-callback`. The stale prompt tells the model to call `createContact` (nonexistent), `Get_Available_Slot`, `bookAppointment`, `getContactAppointments1`, `updateAppointment1`, `cancelAppointment1`, and coaches params `startDate`/`endDate` instead of required `startDateTime`/`endDateTime`. Correct names appear ~3 places (~600 tok); wrong names appear ~18 places (~4,500 tok) — higher volume + more structure means the stale section competes for control on a small model. A stale name (e.g. `bookAppointment`) trips the guard → "unknown tool" (`setterToolLoop.ts:132,157-163`), burns a loop iteration (cap 4), can force `finalize()` with no booking — exactly a "said it booked, didn't / booked wrong" failure. `schedule-callback` (a real tool) is never mentioned in the stale section.

**`{{ $now }}` anchoring — the P0.** The native engine does zero `{{ }}` interpolation (`processSetterReply.ts:161`), so the sole "current time" reference (lines 1141/1632) is a literal dead token. The model has no anchored "today"; the availability block lists dates but never labels which is today. This is the runtime root cause of "this Thursday" → `2026-07-03T16:00` (Friday).

**Top efficiency wins (prioritized).**
- **P0 (pure system/assembly fix, no prompt-content edit):** inject a real current-time anchor into `systemContent` (`processSetterReply.ts:175-184`) or the availability block (`prefetchSlots.ts:buildAvailabilityBlock`, which already has the timezone and `nowMs` at `:314`) — e.g. "Today is Friday, 4 July 2026 … 'This Thursday' = 2026-07-10. Resolve every relative day from this anchor." This neutralizes `{{ $now }}` even before the stored prompt is cleaned.
- **P0:** delete the 554-line `# BOOKING FUNCTION` region (1127-1680, ~26% of the prompt) at the *authoring-system* level (fix `defaultBookingPrompt.ts` + stop auto-seeding). Everything correct in it is already code-owned by `TOOL_USAGE_INSTRUCTION` + the `tools` schemas + the availability block; everything unique to it is wrong.
- **P1:** remove canned example times / parameterize; de-dupe the repeated GOAL/HONESTY/BLOCKED/MESSAGE-LENGTH blocks.
- **Result:** stored prompt shrinks from ~1,680 to ~300-500 lines of genuinely client-specific persona/qualification content; per-turn tokens drop ~26-35%; ~1,000 tokens of correct code-side guidance stop competing with ~4,500 tokens of stale in-prompt guidance.

---

## F. BEST-PRACTICE RECOMMENDATIONS (Stream 4, with URLs)

Design principles the rebuild should follow, each vendor/practitioner-backed:

1. **Availability is data, not policy — the tool layer is authoritative.** The system prompt must contain zero hard-coded availability rules (no weekdays, no example times, no business hours in prose); availability belongs only in the injected block. Return pre-ranked, fully-qualified ISO-8601-with-offset slots so the model never derives a slot. Add one end-of-prompt rule: "You may ONLY offer times in the AVAILABLE SLOTS block; never state a day/time policy not in that block." Sources: McCormick https://dev.to/nicholasemccormick/why-ai-agents-fail-at-scheduling-and-how-to-fix-it-257h ; Schedulee https://schedulee.com/blog/ai-scheduling-agents-honest-evaluation-2026/ ; Retell https://docs.retellai.com/build/check-availability ; Anthropic "ground in quotes" https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

2. **Anchor "today" with a real injected timestamp** — the single highest-ROI fix. Inject ISO-8601 date + IANA timezone + explicit day-of-week; forbid relative date arithmetic (the model copies the offered slot's ISO string, never reconstructs it). Sources: https://dev.to/terrapin88/why-your-agent-doesnt-know-what-time-it-is-15j4 ; https://www.damiangalarza.com/posts/2026-01-07-llm-date-time-context-production/ (inject Today's date / User timezone / Request timestamp, all machine-formatted); McCormick (explicit tz offsets in every field, "LLMs are notoriously unreliable at timezone arithmetic").

3. **Book the exact slot via a stable reference, not a natural-language label.** Give each offered slot a `slot_id` or canonical ISO string; require `book-appointments` to be called with it verbatim; validate server-side that the booked datetime is a member of the prefetched set, reject+re-prompt otherwise. This closes the "Thursday 2pm" → wrong-ISO gap. Sources: McCormick (UUIDs/stable references prevent re-resolution errors); OpenAI cookbook https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide (always call a tool for factual questions).

4. **Sectioned, layered, template-plus-variables authoring with a three-tier privilege split.** (a) Immutable system scaffolding (booking protocol, "only offer injected slots", tool-use rules) — operators cannot edit; (b) operator-editable persona/policy fields, with real business hours as *structured data that constrains the tool*, not prose; (c) runtime-injected variables (slots, timestamp, lead context). Sources: https://pecollective.com/blog/system-prompt-design-guide/ ; https://www.emergentmind.com/topics/structured-system-prompt-summary ; PromptLayer template variables https://docs.promptlayer.com/features/prompt-registry/template-variables ; OWASP LLM Prompt Injection Prevention https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html ; three-layer defense https://medium.com/@usaif/building-secure-ai-agents-a-three-layer-defense-architecture-for-prompt-injection-76295ebc38a5

5. **Never hide load-bearing content — show the fully assembled prompt.** Render the entire assembled prompt (scaffolding + operator fields + sample injected variables) in a preview pane so nothing is load-bearing-but-hidden. The stale rules survived *because* no operator could see them. Sources: EmergentMind (transparency); PromptLayer (prompts as versioned first-class components).

6. **Save-time linting.** Reject/warn on hard-coded weekday policies, literal example booking times, un-interpolated tokens (a stray `{{ $now }}`), and duplicated/contradictory rules. Sources: Prompt Linter https://marketplace.visualstudio.com/items?itemName=Ignire.prompt-linter ; Promptsage https://github.com/alexmavr/promptsage ; Guardrails AI https://github.com/guardrails-ai/guardrails

7. **Long, contradictory prompts measurably hurt tool-calling.** LongFuncEval (IBM, arXiv 2505.10570 https://arxiv.org/abs/2505.10570): 7-85% drop as tools increase, 7-91% degradation as tool-response length grows, 13-40% as conversations lengthen. Shrink to ~5-7 labeled sections + injected variables; keep the availability/timestamp block at the end (last-position priority per OpenAI GPT-4.1 guide); each rule appears once. Anthropic: few-shot examples must be diverse enough the model doesn't over-generalize — the repeated "Booked for this Thursday at 2pm" is the anti-pattern.

8. **Model-family settings (Gemini 2.5 Flash via OpenRouter).** Run temperature 0 (Gemini function-calling guidance); on the availability step set `tool_choice: "required"` (OpenRouter) / `any` (Gemini) so the model must consult the calendar rather than answer from prose; strongly type the datetime arg (ideally an enum of prefetched slot IDs); keep the tool set small (≤10-20 — currently 6, fine). Sources: https://ai.google.dev/gemini-api/docs/function-calling ; https://openrouter.ai/docs/guides/features/tool-calling ; OpenAI GPT-4.1 guide (on conflict, models follow the instruction closer to the end and follow instructions literally — the durable fix is *deleting* the contradiction, not out-positioning it).

---

## G. OPEN DESIGN QUESTIONS FOR THE OPERATOR (most important output)

These must be answered **before** building. Each has concrete options, a recommended default, and the tradeoff.

**Q1. Editing surface: single-document blob vs. sectioned builder vs. hybrid?**
- (a) Single canonical editable document = the stored `text_prompts.system_prompt`, edited as text (Stream 2's lean recommendation).
- (b) Keep the SETTER CORE 7-layer section compiler as the only surface.
- (c) **Hybrid (recommended default):** immutable code-owned scaffolding + a small set of operator-editable structured fields (persona, tone, FAQs, business hours as data) + runtime-injected variables, with a full assembled-prompt preview.
- Tradeoff: (a) is simplest and kills fragmentation but gives operators a scary 300-500 line wall; (b) preserves current UX but is exactly what hid the content; (c) is the most work but matches every best-practice source (Stream 4 §2) and is the only one that both prevents hidden content and keeps non-technical operators safe.

**Q2. Show a full assembled-prompt preview (the text X-Ray)?**
- (a) **Yes, read-only "TRUE final prompt" X-Ray** including runtime appends (port `promptSegments.ts` / `CallTimeAppendBlock.tsx` / `FullPromptXRay.tsx` from voice) — **recommended default**.
- (b) No preview.
- (c) Editable full-prompt view (re-introduce the removed override).
- Tradeoff: (a) makes hidden stale content immediately visible with low risk (read-only); (c) risks operators hand-editing content that a save-time compile then overwrites (the current desync class). Strongly prefer (a).

**Q3. How much stays operator-editable vs. code-owned?**
- (a) Everything editable (status quo, root cause).
- (b) **Three-tier split (recommended default):** booking protocol / tool rules / "only offer injected slots" / current-time handling are code-owned and immutable; persona/qualification/tone/FAQs/business-hours-as-data are operator-editable; slots/timestamp/lead-context are runtime variables.
- (c) Everything code-owned (operators can't customize).
- Tradeoff: (b) is the OWASP/three-layer consensus (Stream 4 §F.4) and directly prevents a future operator re-introducing a "Tue/Wed/Thu" rule; (c) is safest but removes the product's per-client value.

**Q4. Keep the "SETTER CORE" model or replace it?**
- (a) Keep and repair (stop auto-seeding the legacy booking blob; surface it as fields).
- (b) **Replace the booking half specifically (recommended default):** delete the auto-seeded `DEFAULT_BOOKING_PROMPT` path entirely; move booking mechanics to code-owned scaffolding; keep SETTER CORE only for persona/qualification.
- (c) Full rewrite of the editor.
- Tradeoff: (a) is least effort but the 646-line legacy default remains a landmine; (b) removes the single biggest defect (26% of the prompt) with contained blast radius; (c) is highest risk/effort. Note (Stream 1/3 agree): the correct booking mechanics already exist code-side (`TOOL_USAGE_INSTRUCTION` + `tools` schemas), so (b) deletes redundancy, not capability.

**Q5. Per-client templates vs. one shared scaffolding?**
- (a) Per-client copied templates (status quo — how drift/staleness spreads).
- (b) **One shared, versioned code-owned scaffolding injected at assembly time (recommended default);** clients only override the persona/policy layer.
- (c) Shared template with per-client opt-out.
- Tradeoff: (b) means fixing the scaffolding once fixes every client and no client can carry a stale copy; (a) is why BFD's row diverged from the code's intent. The shared-scaffolding model is the whole point of the redesign.

**Q6. Availability rules: calendar-only vs. operator-declared business hours?**
- (a) **Calendar-only (recommended default):** the GHL free-slots fetch is the sole source of truth; the prompt carries no day/hour policy at all (Stream 4 §F.1).
- (b) Operator declares business hours as *structured data* that filters the calendar tool's output server-side (not prose).
- (c) Operator declares hours as prose in the prompt (status quo — the fabricated-constraint failure mode).
- Tradeoff: (a) is simplest and safest and matches the incident's correct behavior (calendar was open); (b) adds legitimate control (e.g. "no Fridays") without letting the model reason about it, but needs a real filtering mechanism in `prefetchSlots.ts`; (c) is banned by every source. Recommend (a) now, (b) as a fast-follow if the operator genuinely needs to restrict below calendar availability.

**Q7. Current-time injection: where and what format?**
- (a) **Inject a real timestamp block at assembly time (recommended default)** in `processSetterReply.ts` or `prefetchSlots.buildAvailabilityBlock` (both already have `client.timezone` and `nowMs`), formatted ISO-8601 + IANA tz + explicit day-of-week + a computed "this Thursday = YYYY-MM-DD" anchor.
- (b) Add a `get_current_time` tool (hybrid; better for multi-day threads — Stream 4 §1.2).
- (c) Fix `{{ $now }}` interpolation in the engine.
- Tradeoff: (a) is the highest-ROI single change and a pure system fix (no prompt-content edit); (b) adds robustness for long threads but another tool round-trip; (c) perpetuates a fragile token convention the engine shouldn't rely on. Recommend (a), optionally (b) later; avoid (c).

**Q8. Booking argument: natural-language label vs. stable slot reference?**
- (a) Status quo — model reconstructs ISO from "Thursday 2pm" (the wrong-date bug).
- (b) **Each offered slot carries a `slot_id`/canonical ISO; `book-appointments` must be called with it verbatim; server validates membership in the prefetched set (recommended default).**
- (c) Enum-constrain the datetime arg to prefetched slot IDs (Gemini strong-typing, Stream 4 §4.1).
- Tradeoff: (b) closes the re-resolution error with modest code in `setterTools.ts`/`setterToolLoop.ts` + `prefetchSlots.ts`; (c) is the strongest guarantee but requires per-turn dynamic tool schemas (more engine work). Recommend (b), with (c) as a stretch.

**Q9. Versioning/history on the runtime artifact?**
- (a) Status quo — external `text_prompts` row is a single mutable field with only `updated_at`; `prompt_versions` captures only AI/simulator flows (Stream 1 §4).
- (b) **Snapshot every deploy to `prompt_versions` (or an external-side history), with a diff/rollback view (recommended default).**
- (c) No history.
- Tradeoff: (b) would have made "when did Tue/Wed/Thu enter this prompt?" answerable and enables rollback; low effort since the table exists. Recommend (b).

---

## H. PROPOSED BUILD-PLAN OUTLINE (phased, for Opus)

Sequenced so the **incident-killing system fixes ship first** (no client-content edits), then the authoring redesign. Phases 1-2 fully neutralize the live bug's root causes and are report-only-safe.

**Phase 0 — Confirm the stored bytes (assessment; Fable).**
- Read the live external row: `text_prompts.system_prompt where card_name='Setter-1'` (ext Supabase `qildpilxjodxdifggmto`, resolve via `clients.supabase_url`/`supabase_service_key`).
- Diff against `frontend/src/data/defaultBookingPrompt.ts`. Confirm the 554-line `# BOOKING FUNCTION` region and `{{ $now }}` presence, and determine origin (compiler vs `scripts/deploy_text_prompt.mjs`).
- Verify: diff output shows the stale block; note exact line offsets. Risk: none (read-only). Resolves Stream 1's stated gap.

**Phase 1 — Inject a real current-time anchor (P0, pure system fix).**
- Touch: `trigger/processSetterReply.ts` (system message assembly ~175-184) or `trigger/_shared/prefetchSlots.ts:buildAvailabilityBlock` (already has timezone + `nowMs` passed at `processSetterReply.ts:314`).
- Add a "## Current time (ground truth)" block: ISO-8601 local datetime + IANA tz (from `client.timezone`, `processSetterReply.ts:132,225`) + explicit day-of-week + computed relative-day anchors ("this Thursday = YYYY-MM-DD"). Mirror voice's `make-retell-outbound-call/index.ts:766-772` `toLocaleString(..., {dateStyle:'full'})`.
- Verify: unit test on the block builder; live SMS test ("can I book?") confirms the model labels days correctly and books the accepted ISO. Risk: low (additive to system message); makes the stale literal `{{ $now }}` harmless even before content cleanup.

**Phase 2 — Bind the booking argument to a stable reference + server-side validation (P0).**
- Touch: `trigger/_shared/prefetchSlots.ts` (emit `slot_id`/canonical ISO per slot), `trigger/_shared/setterTools.ts` (booking schema: require the exact ISO/`slot_id`; strengthen description), `trigger/_shared/setterToolLoop.ts` (validate the booked datetime is a member of the prefetched set before executing; reject+refold on miss).
- Optionally set `tool_choice: "required"`/temperature 0 on the availability/booking step (OpenRouter/Gemini, Stream 4 §8) — confirm the OpenRouter request builder location before wiring.
- Verify: test that a hallucinated/off-list datetime is rejected and re-prompted; test that an accepted slot books the exact ISO. Risk: medium (touches the tool loop; guard already exists at `setterToolLoop.ts:132`, extend it).

**Phase 3 — Fix the authoring default + stop auto-seeding the legacy blob (system, root content source).**
- Touch: `frontend/src/data/defaultBookingPrompt.ts` (replace the 646-line legacy default with a minimal "trust the injected live-availability + current-time blocks; never state a day/time policy; call `get-available-slots` then `book-appointments` with the exact ISO" instruction, correct tool names, no `{{ $now }}`, no canned times, no Tue/Wed/Thu, no EST); `frontend/src/components/AgentConfigBuilder.tsx:3900-3901,3995` (stop auto-injecting a 554-line blob; or make booking scaffolding code-owned and not stored in the prompt at all).
- Decide per Q4/Q5/Q6: recommended path is to move booking mechanics fully code-side (they already exist in `setterTools.ts:162-183` + schemas) and have the editable prompt carry only persona/qualification.
- Verify: create a fresh test setter, toggle Booking Function, confirm no stale content is seeded; save → read back the external row → confirm no Tue/Wed/Thu / `{{ $now }}` / wrong tool names. Risk: medium (changes what new clients get; existing clients still carry old blobs until Phase 6 migration). **Content of any *existing client* prompt is report-only — do not hand-edit; migrate via the tooling in Phase 6.**

**Phase 4 — Port the X-Ray "TRUE final prompt" preview to text (visibility).**
- Touch: reuse `frontend/src/lib/promptSegments.ts`, `frontend/src/components/prompt-doc/CallTimeAppendBlock.tsx`, `frontend/src/components/FullPromptXRay.tsx` (voice); wire a text-mode X-Ray into `PromptManagement.tsx` / `AgentConfigBuilder.tsx` that renders stored prompt + Lead Context + instruction blocks + availability + current-time block in exact assembly order (mirroring `processSetterReply.ts:175-184` + `:311-316`).
- Verify: X-Ray for `Setter-1` renders the full ~1,680-line stored body (or the new lean body) so any hidden content is visible. Risk: low (read-only UI).

**Phase 5 — Sectioned/three-tier editor + save-time linting (authoring redesign).**
- Touch: `AgentConfigBuilder.tsx`, `setterConfigParameters.ts`, `save-external-prompt/index.ts`. Implement the three-tier split (immutable scaffolding / operator persona-policy / runtime variables). Add a save-time lint that rejects hard-coded weekday policies, literal example times, un-interpolated `{{...}}` tokens, and duplicated headings (Stream 4 §F.6).
- Decide per Q1/Q3. Verify: lint blocks a prompt containing "Tuesday, Wednesday, Thursday ONLY" or `{{ $now }}`; operator can edit persona but not scaffolding. Risk: high (largest surface; stage behind the existing test suites — `test:node`, `test:edge`, vite).

**Phase 6 — Migrate existing client rows + add deploy versioning.**
- Touch: a migration/one-off script (pattern like `scripts/deploy_text_prompt.mjs`, but report-first) to regenerate each client's external `text_prompts.system_prompt` from the new lean scaffolding + their preserved persona layer; snapshot each deploy to `prompt_versions` (table exists, `migrations/20260422130000_*.sql:60-70`).
- **Report-only guardrail:** generate the proposed new prompt per client and present the diff; a human applies via the UI (do not auto-overwrite a client's live prompt). This satisfies the "prompt content is report-only for editing" constraint while the *system* change is what's being built.
- Verify: BFD `Setter-1` regenerated prompt diff reviewed by Brendan; live SMS regression ("book a meeting" → correct Monday offer + correct ISO booking). Risk: medium; gate the actual write on explicit human GO.

**Cross-cutting risks & notes.**
- The out-of-band writer `scripts/deploy_text_prompt.mjs` (hardcoded `ROW_ID`/`Setter-1`, reads a stale `c:/Projects/...` path) is a desync vector — reconcile or retire it as part of Phase 6, else it can re-introduce a stale row.
- Streams agree on all P0s; the only unresolved factual question is Phase 0's origin diff (Stream 1 could not confirm compiler vs out-of-band origin; Stream 3 confirmed the content is live).
- Report-only boundary: Phases 1, 2, 4 touch no prompt content and are safe to ship directly. Phases 3, 5 change the *authoring system* (in-scope). Phase 6 touches client *content* and must stay report-first with human apply.

**Files of record:** stored prompt `text_prompts.system_prompt` (card_name `Setter-1`, ext Supabase `qildpilxjodxdifggmto`); runtime assembly `trigger/processSetterReply.ts:126-184,307-316`; availability `trigger/_shared/prefetchSlots.ts:96-134`; tools + code-side guidance `trigger/_shared/setterTools.ts:33-183`; loop + guard `trigger/_shared/setterToolLoop.ts:102-163`; model normalizer `trigger/_shared/llmModel.ts`; legacy booking default `frontend/src/data/defaultBookingPrompt.ts`; section compiler `frontend/src/components/AgentConfigBuilder.tsx:2878-3097,3900-3945`; save edge fn `frontend/supabase/functions/save-external-prompt/index.ts:29-234`; save page `frontend/src/pages/PromptManagement.tsx`; voice X-Ray to port `frontend/src/lib/promptSegments.ts`, `frontend/src/components/prompt-doc/CallTimeAppendBlock.tsx`, `frontend/src/components/FullPromptXRay.tsx`; voice current-time reference `frontend/supabase/functions/make-retell-outbound-call/index.ts:766-786`.

---

# APPENDIX — raw stream findings

## Stream 1 — text-authoring+visibility

I have all the evidence needed. Here is the report.

---

# Stream 1 Report — How a Text-Setter Prompt Is Authored, and Why the Operator Cannot See/Edit the Full ~1680-Line Prompt

All paths are relative to `/srv/bfd/Projects/bfd-setter`. Ignore the `.claude/worktrees/overnight+text-setter-repair-allbugs/` mirror in grep output; every finding below is cited from the canonical main tree.

## TL;DR (the crux)

1. The stored `text_prompts.system_prompt` is **NOT a verbatim operator blob** and is **NOT hand-editable as one document**. It is **compiled forward** at save time from a section builder ("SETTER CORE") plus a separate, auto-seeded **Booking Function** blob, then written to the client's external DB.
2. The exact hidden strings ("Available days: Tuesday, Wednesday, Thursday ONLY", the canned "this Thursday at 2pm" examples, "{{ $now }}") come from **one file**: `frontend/src/data/defaultBookingPrompt.ts` → the `DEFAULT_BOOKING_PROMPT` constant. It is a **copied legacy n8n text-agent booking prompt** that is auto-injected as the `booking_prompt` the moment an operator flips the "Booking Function" toggle on.
3. The operator can't see/edit those lines because (a) there is **no reverse-parse** — nothing ever reads an existing `system_prompt` back into the editor's fields; the editor only overwrites forward; (b) the booking blob is surfaced only behind a **collapsed "View Prompt" toggle** as a raw 646-line textarea, never as structured fields; and (c) the manual full-prompt override was removed — the only place you can see the assembled whole is a **read-only** "Verify Setter Prompt" view.

---

## 1. The editor: components, exposed fields, and how they map to `text_prompts.system_prompt`

### Editor entry points
- **`frontend/src/pages/PromptManagement.tsx`** (8,527 lines) — the top-level page. Owns the save pipeline that writes to the external `text_prompts` row.
- **`frontend/src/components/AgentConfigBuilder.tsx`** (5,255 lines) — the actual "SETTER CORE" section builder embedded in the page. Compiles the prompt.
- **`frontend/src/hooks/usePromptConfigurations.ts`** — persistence + a fallback compile for the persona half.
- Section definitions: **`frontend/src/data/setterConfigParameters.ts`** (text) / `voiceSetterConfigParameters.ts` (voice).
- Right-rail visual: `frontend/src/components/AgentCoreVisualization.tsx` (renders the "SETTER CORE" title, `AgentCoreVisualization.tsx:459`).
- AI-assist / simulator side-doors: `frontend/src/components/SetterPromptAIDialog.tsx`, `frontend/src/components/simulator/SimulationReportDialog.tsx`.

### What fields/sections the editor exposes
The builder is a **structured toggle/param system**, not a free-text editor. Sections are defined in `setterConfigParameters.ts` as layers of params, e.g. `agent_mission`/"Agent Mission" (`setterConfigParameters.ts:3073-3074`, `3093`), plus dozens of labeled toggles ("Role / Description", "Identity Behavior", "Communication Tone", "Humor in Conversations", "Playful Sarcasm", etc. — `setterConfigParameters.ts:58,178,299,405,441…`). Each toggle carries a small `customPrompt` snippet that gets concatenated.

Two compile engines exist, keyed by config_key:
- **Persona keys**: `agent_name, agent_goal, identity_behavior, personality, communication_tone, grammar_style` (`usePromptConfigurations.ts:167`).
- **Content keys**: `company_knowledge, response_length, formatting_rules, banned_phrases, conversation_flow, custom_prompt` (`usePromptConfigurations.ts:168`).

Plus three things that live **outside** those named sections:
- **Conversation Examples** (appended, `AgentConfigBuilder.tsx:2990-2995`),
- **Additional Custom Instructions** (`AgentConfigBuilder.tsx:2998-3006`),
- **Booking Function** = the `agent_settings.booking_prompt` blob (`AgentConfigBuilder.tsx:3009-3018`) — this is where the Tue/Wed/Thu content lives.

### Is the stored `system_prompt` verbatim or assembled? → **Assembled at save time.**

The authoritative compile is `buildParentConfigOutput` → `buildFullPrompt` → `segmentsToText(buildFullPromptSegments())` in `AgentConfigBuilder.tsx:3026-3073`. It emits a synthetic config row:

```
output['__full_prompt__'] = { customContent: buildFullPrompt(...) }   // AgentConfigBuilder.tsx:3056-3063
```

`buildFullPromptSegments` concatenates: persona layers + content layers + Conversation Examples + Custom Instructions + **`# BOOKING FUNCTION\n\n${agentSettings.booking_prompt}`** (`AgentConfigBuilder.tsx:3010-3017`) + `# COMPANY` (`3021`). That single concatenated string is the `content` half of the prompt.

Save path in `PromptManagement.tsx`:
- `getFullPromptRef.current()` returns `{ persona, content }` where `content = output['__full_prompt__'].customContent` (`AgentConfigBuilder.tsx:3078-3097`).
- On deploy, `contentForSave = builderContent` (`PromptManagement.tsx:6595-6607`).
- It invokes the edge function with `content: contentForSave, persona: personaForSave` (`PromptManagement.tsx:6743-6766`).

Edge function **`frontend/supabase/functions/save-external-prompt/index.ts`** does the final assembly and write:
```
SAVE_SEPARATOR = '\n\n── ── ── ── ── ── ── ── ── ── ── ── ── ──\n\n'   // index.ts:29
fullConsolidatedPrompt = [persona, content].join(SAVE_SEPARATOR)       // index.ts:32
syncPayload.system_prompt = fullConsolidatedPrompt                      // index.ts:135
→ external text_prompts UPDATE/UPSERT where card_name = 'Setter-N'      // index.ts:176-234
```

So `text_prompts.system_prompt` = `persona` + separator + `[all content layers + Booking Function blob + Company]`. **The booking template is baked into the monolith**; it is not stored as a discrete editable field on the external side.

(Two other, older save paths exist and behave the same way: `PromptManagement.tsx:5350-5354` and the `full_prompt` combine at `6943-6957`. The hook's `buildPromptFromConfigs` at `usePromptConfigurations.ts:166-210` is only a **fallback** for the persona half and notably does **not** include booking — the primary `__full_prompt__` path does.)

---

## 2. Provenance of the hidden content

### "Available days: Tuesday, Wednesday, Thursday ONLY", the canned "this Thursday at 2pm" examples, and "{{ $now }}"

**Single source: `frontend/src/data/defaultBookingPrompt.ts`, the `DEFAULT_BOOKING_PROMPT` constant** (646 lines; header at `defaultBookingPrompt.ts:1` = "# SERVICE FUNCTIONS - TEXT AGENT WORKFLOW"). Exact matches to the live prompt's hidden tail:

| Live prompt (per incident) | Source (defaultBookingPrompt.ts) |
|---|---|
| "## BOOKING CONSTRAINTS" → "Available days: Tuesday, Wednesday, Thursday ONLY." (~live L1219) | `:89` "## BOOKING CONSTRAINTS", `:91` "**Available days:** Tuesday, Wednesday, Thursday ONLY." |
| "## REFERENCE" → "Available days: Tuesday, Wednesday, Thursday" (~live L1634) | `:502` "## REFERENCE", `:506` "- **Available days:** Tuesday, Wednesday, Thursday" |
| "Current time: {{ $now }}" (~live L1633) | `:504` "- **Current time:** {{ $now }}" (also `:13`) |
| Canned "You're all set! Booked for this Thursday at 2pm." | `:50`, `:62`, `:65`, `:85`, `:155`, `:170`, `:264`, `:270`, `:328`, `:436`, `:486` |

The section headings, the two Tue/Wed/Thu occurrences (one "ONLY", one bare), and the `{{ $now }}` reference line up **structurally byte-for-byte** with the reported live prompt. Provenance of the content is therefore **definitively `defaultBookingPrompt.ts`**, regardless of which write path delivered the specific live row.

### How it gets in: a shipped default, auto-seeded on toggle-on
- `DEFAULT_BOOKING_PROMPT` is imported into the builder: `AgentConfigBuilder.tsx:3`.
- When the operator enables "Booking Function" and no booking prompt exists yet, it is **auto-populated with the full 646-line default**:
  ```
  if (newVal && !agentSettings.booking_prompt) updates.booking_prompt = DEFAULT_BOOKING_PROMPT;   // AgentConfigBuilder.tsx:3900-3901
  ```
  and the "Reset to default" button reloads it: `AgentConfigBuilder.tsx:3995`.

### It is a copied legacy n8n prompt (not something the native engine understands)
- It instructs the model to call **`Get_Available_Slot`** (`defaultBookingPrompt.ts:95,147,212,286,364,390,455,460,482`) — an n8n-era tool name. The native text engine's actual tool is `get-available-slots` (different name), so the prompt's tool references don't even match the runtime.
- **`{{ $now }}`** was an **n8n expression** that the legacy workflow interpolated: see `frontend/public/workflows/text-engine/Text_Engine.json:3411` (`"# Current Date & Time:\n- {{ $now }}"`) and `Text_Engine_Setter.json:2962`. The **native** engine (`trigger/processSetterReply.ts`) does no such interpolation (see §3 below), so the model sees the literal string `{{ $now }}` and has no real "today" anchor.
- A second, sibling legacy blob with the same defect (Moscow/Minsk windows, `{{current_time_Europe/Minsk}}`, "Available Days: Tuesday, Wednesday, Thursday only (Brendan unavailable Fri-Mon)") is hardcoded inside `PromptManagement.tsx:4176-4237` as `DEFAULT_VOICE_BOOKING_AGENT_CONTENT` (`PromptManagement.tsx:3981`). That one is the voice booking default, but it confirms the same "Tue/Wed/Thu + literal time-token" legacy pattern is pasted in multiple template constants.

### Note: the STATIC text-agent defaults are empty
`STATIC_PROMPTS.textAgents` for `Setter-1..10` ship with `defaultContent: ''` (`defaultPromptTemplates.ts:1128-1140`). So the Tue/Wed/Thu content does **not** come from the per-slot default template — it comes exclusively from the **booking** default described above.

### An out-of-band delivery path also exists
`scripts/deploy_text_prompt.mjs` PATCHes `text_prompts` (hardcoded `ROW_ID`, `Setter-1`) directly from `frontend/src/data/bfdTextSetterPrompt.ts` (`deploy_text_prompt.mjs:8-16,20`), **bypassing the builder entirely**. (That source file is only 217 lines and reads a stale `c:/Projects/...` path, so it is not the 1680-line source, but it demonstrates the external row can be written without any UI/section state — a desync vector; see §3.)

---

## 3. The visibility gap — precisely why the ~1680 lines are hidden

**Editable in the UI:** the structured SETTER CORE toggles/params (`setterConfigParameters.ts`), the persona/content section fields, Conversation Examples, Additional Custom Instructions, Company info, and the Booking Function blob.

**Effectively hidden (the crux):**

1. **No reverse-parse / no round-trip import.** Nothing ever reads an existing `text_prompts.system_prompt` (or `prompts`/`clients.system_prompt`) back into the editor's section state. The editor **only composes forward** (sections → `__full_prompt__` → overwrite). The only code that ever splits on the `── ── ──` separator is `frontend/src/components/prompt-editor/diffUtils.ts:89` — used purely to render a **diff**, never to hydrate editable fields. Consequence: the stored `system_prompt` is a **frozen compiled snapshot**. Whatever an operator sees in the fields is the *current section values*, not the stored blob. If the blob was compiled with a booking template the operator never opened (or written out-of-band via `deploy_text_prompt.mjs`, or by an older build), the operator's fields will not contain those lines while the runtime keeps using the monolith.

2. **The booking constraints are buried in a collapsed raw textarea.** `bookingPromptExpanded` defaults to `false` (`AgentConfigBuilder.tsx:492`). The 646-line booking blob is only revealed after clicking **"View Prompt"** (`AgentConfigBuilder.tsx:3928-3945`), and even then it renders as one raw `<Textarea>` (`:3945-3946`), not as labeled fields. An operator scanning the structured SETTER CORE sections never encounters the "Available days" / "{{ $now }}" lines; they are inside a fold most operators never open.

3. **The assembled whole is view-only.** The manual full-prompt override was deliberately removed and the combined view made read-only:
   > "The manual full-prompt override feature was removed (the Verify Setter Prompt view is read-only)." — `AgentConfigBuilder.tsx:3064-3066`

   So there is **no** surface where the operator can open the ~1680-line document and edit it as text. They get small structured controls + a collapsed booking textarea + a read-only verify pane.

4. **Runtime uses the raw blob, unparsed and un-interpolated.** `trigger/processSetterReply.ts` reads `text_prompts.system_prompt` verbatim (`processSetterReply.ts:156-161`, keyed by `slotId = "Setter-${Setter_Number}"`, `:126-127`) and prepends it to the system message (`:175-184`) with **no template interpolation** — so `{{ $now }}` passes through literally and the stale "Available days" text overrides the live availability block that `_shared/prefetchSlots.ts` appends later. The editor and the runtime are effectively decoupled: the editor's job ends at "overwrite the blob"; the runtime trusts the blob wholesale.

Net: the operator's mental model ("edit the sections") and the stored artifact ("a frozen monolith containing an auto-seeded legacy booking template") have drifted apart, and the UI provides no way to view-and-edit the monolith directly.

---

## 4. Data model, keys, and versioning

### `text_prompts` (client's EXTERNAL "…-setter-live" Supabase — the runtime source)
`supabase/client-schema.sql:87-100`:
```
text_prompts(
  id uuid pk default gen_random_uuid(),
  card_name text not null unique,   -- 'Setter-1','Setter-2',…  MUST match Setter_Number from the GHL webhook (prefixed 'Setter-')
  system_prompt text,               -- the full consolidated prompt (persona + separator + content)
  created_at, updated_at
)
```
- Seeded on provision with a one-line placeholder for `Setter-1` (`client-schema.sql:107-112`).
- `save-external-prompt` also writes sibling columns on this same row: `booking_prompt` (= the content half, `index.ts:136`, later overwritten by `agent_settings.booking_prompt` at `:145`), `booking_function_enabled`, `model`, and the follow-up/delay settings (`index.ts:134-164`). The prompt itself lives only in `system_prompt`.
- It falls back to a legacy `prompts` table if `text_prompts` is absent (`index.ts:55-56,182-198`).

### Relationship of `card_name 'Setter-N'` to slots / voice_setters / clients
- **`card_name` ↔ slot**: 1:1 with the platform-side `slot_id` string `'Setter-N'`. The GHL webhook sends `Setter_Number`; the runtime forms `slotId = 'Setter-' + Setter_Number` and looks up `text_prompts.card_name = slotId` (`processSetterReply.ts:126-127,159`). BFD has exactly one: `Setter-1`.
- **↔ clients**: `text_prompts` lives in the client's own external DB; the platform resolves that DB via `clients.supabase_url` / `clients.supabase_service_key` (`save-external-prompt/index.ts:64-86`; `processSetterReply.ts:150-161`). One `text_prompts` table per client; `card_name` is unique within it.
- **↔ voice_setters**: `voice_setters` is the **voice** counterpart and is a **platform-DB** table (created via migrations, not present in `supabase/client-schema.sql`). Voice setters use `card_name 'Voice-Setter-N'`, which `save-external-prompt` normalizes back to `'Setter-N'` and writes to `voice_prompts` (`index.ts:50-55`). Text and voice share the `Setter-N` numbering but land in different tables (`text_prompts` vs `voice_prompts`).

### Platform-side authoring tables (the editor's working state — NOT the runtime source)
- **`prompt_configurations`** (`client_id, slot_id, config_key, selected_option, custom_content`, unique on `client_id,slot_id,config_key`) — stores each section's value, upserted by `usePromptConfigurations.ts:78-91`. Includes the synthetic `__full_prompt__` row holding the last compiled blob (`AgentConfigBuilder.tsx:3056-3063`).
- **`prompts`** and **`clients.system_prompt`** — platform mirrors written on every deploy (`PromptManagement.tsx:6624-6668`, `6725-6727`).

### Versioning / history → yes, but partial and platform-only
- Table **`prompt_versions`** exists: `frontend/supabase/migrations/20260422130000_bfd_platform_save_setter_final_gaps.sql:60-70` — `(client_id, slot_id, version_number, prompt_content, original_prompt_content, label, created_at)`. Originally created at `migrations/20260320224451_*.sql:1`; RLS tenant-scoped at `migrations/20260610121000_audit_prompt_rls_tenant_scope.sql`.
- **But it only captures AI-edit and simulator flows**, not normal deploys. Inserts happen exclusively in `SetterPromptAIDialog.tsx:780-791` and `simulator/SimulationReportDialog.tsx:843-854` (the "modify prompt with AI" / simulate-and-apply paths). The ordinary "Deploy" save path (§1) does **not** snapshot a version. Slot deletion **purges** all versions for the slot (`PromptManagement.tsx:5852-5869`).
- There is **no history at all on the external `text_prompts` row** — it is a single mutable `system_prompt` with only `updated_at`. So the actual runtime artifact has no version trail.

---

## What I could not determine (stated explicitly)
- I did **not** query the live external Supabase (`qildpilxjodxdifggmto`) — this was a read-only *code* investigation — so I cannot prove from data whether BFD's specific live 1680-line row was produced by the builder compile vs. an out-of-band `deploy_text_prompt.mjs`/onboarding write. What is certain: the **content** of the hidden lines originates in `frontend/src/data/defaultBookingPrompt.ts` (`DEFAULT_BOOKING_PROMPT`), and the **mechanism** that makes them un-seeable is the forward-only compile + collapsed booking textarea + read-only verify view described in §3. If the upcoming session wants proof of the exact stored bytes, read `text_prompts.system_prompt where card_name='Setter-1'` from the client's external DB and diff it against `DEFAULT_BOOKING_PROMPT`.

## Highest-leverage fix targets for the solo session (system, not client content)
- `frontend/src/data/defaultBookingPrompt.ts` — the legacy default is the root content source; the Tue/Wed/Thu constraints and `{{ $now }}` should be removed/replaced with a "trust the injected live-availability block" instruction, and the tool names corrected to `get-available-slots`.
- `AgentConfigBuilder.tsx:3009-3018 / 3900-3901 / 3928-3945` — booking blob is auto-seeded and hidden; either stop auto-injecting a 646-line legacy blob or surface it as first-class, structured, visible fields.
- The **no-reverse-parse** gap (`PromptManagement.tsx` save pipeline + absence of any import) — consider hydrating the editor from the stored `system_prompt`, or add an editable full-prompt view, so operators can see/repair the monolith.
- `trigger/processSetterReply.ts:175-184` — the raw stored prompt is prepended above the live-availability block with no interpolation; ordering/precedence and `{{ $now }}` handling are code-side levers (this aligns with the existing BOOK-1 fix in `Docs/BUG_LIST.md`).
---

## Stream 2 — voice-setter-comparison

I have a complete picture. Here is the report.

---

# Stream 2 — Voice Setter Prompt: Authoring / Storage / Assembly / Push (reference model)

All paths relative to `/srv/bfd/Projects/bfd-setter`. Read-only; nothing edited.

## TL;DR

The voice setter uses a **structured section-editor → compiled single prompt → pushed to Retell** model. Unlike the text setter, the voice path has three things text lacks: (1) an explicit **X-Ray** that renders the TRUE final prompt including everything appended at push/call time, (2) a **live `current_time` dynamic variable** rendered in the client's timezone with day-of-week, and (3) a **server-appended `DYNAMIC_VARS_BLOCK`** that is generated fresh at push time (never stored stale in the body). The catch: for BFD's actual live "Gary", none of that authoring pipeline is the source of truth. Gary is hand-built directly in Retell, the repo copies have drifted and reference a deleted LLM, and by hard rule the content is report-only. That is the same "I can't see the full prompt" complaint the operator had, just one layer removed.

---

## 1. Where the voice prompt lives, how the UI edits it, what is pushed vs local

### Storage (three copies, only one is authoritative at call time)

- **Live / runtime copy = Retell.** The prompt that actually executes is the Retell **LLM `general_prompt`** on the agent bound to the slot (`clients.retell_agent_N_id`). Voice settings live on the Retell **agent** object. This copy is what a call reads; everything else is authoring state.
- **Authoring / mirror copy = platform Supabase.** `PromptManagement.tsx` writes the compiled prompt to the platform `prompts` table keyed by `card_name` (e.g. `Voice-Setter-1`) and mirrors it to `clients.system_prompt`:
  - `frontend/src/pages/PromptManagement.tsx:5324-5334` (upsert `prompts`), `:5353-5354` (`clients.system_prompt`), `:5749` (`card_name`).
- **Section pieces = `prompt_configurations` table + localStorage.** The editor stores each section as a row keyed by `config_key`, cached in localStorage for instant render:
  - `frontend/src/hooks/usePromptConfigurations.ts:20-38` (cache), `:63-91` (`prompt_configurations` upsert on conflict `client_id,slot_id,config_key`).
- **Repo files are display/seed only, and drifted.** `frontend/src/data/bfdVoiceSetterPrompt.md:1-9` is a stale v3 export whose header still targets a deleted LLM (`llm_22e795de19b4d25cb579013586be`) and says "Deploy via REST PATCH + publish-agent ... See scripts/deploy_voice_prompt.mjs." Per project CLAUDE.md this file is NOT the source of truth for what the live agent says.

### How the UI edits it: a structured section editor ("SETTER CORE")

The voice editor is the same `AgentConfigBuilder` component used for text, in `mode === 'voice'`. It is a **7-layer structured builder**, not a free-text box:

- Layers: `settings | identity | company | tone_style | strategy | guardrails | deploy`
  - `frontend/src/components/AgentCoreVisualization.tsx:26-42` (`CORE_LAYERS` + `configKeys` per layer).
- Each layer is composed of many typed parameters (radio-option + free-text `customContent`) defined in `frontend/src/data/voiceSetterConfigParameters.ts` (1649 lines). Example free-text field the operator can edit: `agent_mission` (`:57-58`); most others are option pickers (`agent_role_enabled` `:22`, `identity_behavior` `:97`, `casual_tone` `:216`, etc.).
- Compilation to one prompt: `AgentConfigBuilder.tsx:2878-2938` (`buildFullPromptSegments` walks each layer, emits `## PARAM_TITLE` blocks joined by separators), booking block `:3010-3016`, and `buildFullPrompt` = `segmentsToText(...)` at `:3026-3031`. A parallel simpler joiner lives in `usePromptConfigurations.ts:166-210` (`buildPromptFromConfigs`, persona vs content keys joined by `── ── ──`).
- There is also a **raw single-prompt fallback**: a `__full_prompt__` config row lets the compiled text be stored/edited whole when the section model can't represent it (`PromptManagement.tsx:5373-5379`, `:6330-6362`).

### What is pushed vs kept local

Push happens in `PromptManagement.tsx` `pushVoiceSetterToRetell` (`:6006-6123`): it invokes `retell-proxy` `action: 'sync-voice-setter'` with `generalPrompt: promptText`, `beginMessage`, `model`, `agentName`, `llmSettings` (tools/model_high_priority/start_speaker) and a large `voiceSettings` bag (`:6069-6122`). So **the compiled prompt text + tools + voice settings are pushed; the section rows, localStorage cache, and `prompt_configurations` stay local.**

### Report-only constraint

Editing voice prompt **content** is a hard "report, don't touch" rule (project `CLAUDE.md`, "Voice Agent Prompts (Retell): Do Not Edit, Report Only"; echoed in the prompt file header `bfdVoiceSetterPrompt.md:1-9`). The **authoring system** (editor, compilation, push code) is in-scope to analyze/redesign; a client's stored/live prompt text is not to be hand-edited.

---

## 2. How voice injects live availability + current time (vs text)

### Voice = runtime dynamic variables, generated per-call

Outbound calls (`make-retell-outbound-call/index.ts`):

- **Live availability:** `fetchGhlFreeSlots(ghlApiKey, calendarId, tz)` hits GHL `/calendars/{id}/free-slots` over a 30-day window (`:228-304`), `compactSlots` shrinks `{date: {slots:[ISO]}}` → `{date:[HH:MM]}` (~5× smaller, `:195-213`), wrapped by `buildAvailabilityDynamicVariable` into the `available_time_slots` var (`:215-226`, set at `:800`). Fetched fresh in parallel per call (`:747-760`).
- **Current time:** rendered live in the client's IANA timezone with **full day-of-week + date + time**, not ET:
  - `make-retell-outbound-call/index.ts:766-772` — `nowTs.toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" })` → `current_time` (`:785`), plus `current_timezone` (`:786`). The tz itself is resolved from `clients.timezone` (`:743-744`).
- **`{{first_name}}` and identity:** set from `contact_fields` into `dynamicVars.first_name` etc. (`:774-804`), then shipped as `retell_llm_dynamic_variables` on Retell `create-phone-call` (`:869-874`). Retell substitutes `{{first_name}}`/`{{current_time}}`/`{{available_time_slots}}` into the prompt at each turn.
- **Empty-var safety net:** unset lead vars render as empty string, not the literal token, via `default_dynamic_variables: EMPTY_LEAD_DEFAULTS` set on the **retell-LLM** (not the agent) at `retell-proxy/index.ts:815` + `:40-42`; the code explicitly notes Retell ignores `default_dynamic_variables` on the agent object (`:727-731`).

Inbound calls (BYO Twilio) get **no** injected variables (Retell limitation), so the prompt is written to survive empties and to **discover "today" via a tool call**:
- `retell-proxy/index.ts:647-654` (server `DYNAMIC_VARS_BLOCK` "When dynamic variables are EMPTY" — "Never guess the day-of-week", call `get-available-slots` with no `startDateTime`, "the first returned slot's date IS today").
- Prompt-body reinforcement: `bfdVoiceSetterPrompt.md:157-169`.

### The push-time reference block (never stored stale)

`retell-proxy` appends the dynamic-vars reference to the prompt at push time, so the body never carries a hardcoded, drift-prone copy:
- `retell-proxy/index.ts:627-655` (`buildDynamicVarsBlock(clientTimezone)`) and `:784` (`enrichedPrompt = generalPrompt + buildDynamicVarsBlock(...)`). The `## Current Date & Time ({tz})` line references `{{current_time}}` (`:641`). Client-side byte-identical replica for the X-Ray: `frontend/src/data/retellDynamicVarsBlock.ts:9-37`.
- A latency guard counts `{{available_time_slots}}` occurrences and warns (non-fatal) if >1, because duplicates get re-substituted with the full JSON every turn (`retell-proxy/index.ts:792-799`).

### Contrast: text engine has NO live "today" anchor

- `trigger/processSetterReply.ts:175-184` — `systemContent` = stored `text_prompts.system_prompt` + `## Lead Context` + two static instruction blocks. **No `current_time`, no day-of-week, nothing.**
- Availability is appended (`:311-316`) via `buildAvailabilityBlock` (`trigger/_shared/prefetchSlots.ts:96-134`) — a date-keyed map with strong "offer only these times" rules, but it **also carries no "today is Friday 2026-07-03" line**.
- The stored prompt's only "now" reference is the literal `{{ $now }}` token (n8n-style), which the native text engine does **not** interpolate — same dead token seen in the booking-append default `frontend/src/data/defaultBookingPrompt.ts` ("current date and time via `{{ $now }}`"). This is the precise mechanism behind the wrong-day incident: real open calendar, but no anchored "today," plus stale "Tue/Wed/Thu only" text the model trusts over the injected map.

---

## 3. Voice authoring UX: what the operator can/cannot see and edit

**Structural model:** section-based, single-prompt-under-the-hood, with runtime dynamic vars. The operator interacts with 7 layers of typed parameters (option pickers + a few free-text fields like `agent_mission`), which compile to one Retell `general_prompt`. Voice knobs (voice_id, speed, backchannel, voicemail, STT, analysis prompts, begin_message) are separate structured settings, not prompt text (`retell-proxy/index.ts:661-731`).

**What the operator CAN see (better than text):** the voice editor ships a **Setter Prompt X-Ray** that renders the TRUE final prompt in assembly order, including the read-only "ADDED AT CALL TIME (PUSH)" segments:
- Segment model + byte-exact join: `frontend/src/lib/promptSegments.ts:1-38`.
- Call-time appends surfaced read-only: `AgentConfigBuilder.tsx:3244-3267` (booking append + `buildDynamicVarsBlock`), rendered by `frontend/src/components/prompt-doc/CallTimeAppendBlock.tsx:1-43` and `frontend/src/components/FullPromptXRay.tsx`. So the DYNAMIC_VARS block and booking append are visible even though they are injected server-side.

**What the operator CANNOT see / control:**
- The **runtime substitution values** (`current_time`, the fetched `available_time_slots` JSON) are not shown in the editor — only the `{{...}}` placeholders are.
- For BFD's real Gary, the **actual live Retell prompt** is not what the section editor holds. Gary was authored directly in Retell; repo/section state has drifted and the repo file points at a deleted LLM (`bfdVoiceSetterPrompt.md:2`, project CLAUDE.md "Repo and live Retell have drifted"). So the operator's "I can't see the whole prompt" complaint on voice is real: the X-Ray shows the *pipeline's* prompt, not necessarily the *live* one.
- Publishing is a draft→edit→publish dance (`retell-proxy/index.ts:280-296` `publishAgentVersion`, `:860` `ensureEditableAgentDraft`); if auto-publish fails, drafts silently accumulate and live calls keep the old version — a class of "the thing I edited isn't what's live" surprises.

---

## 4. Honest pros/cons as a template for redesigned text authoring

### Worth copying

1. **Push-time / runtime injection of a fresh reference block instead of storing it in the body.** The voice `DYNAMIC_VARS_BLOCK` is generated at push (`retell-proxy:784`) so it can never go stale. The text engine already appends availability at runtime (`processSetterReply:316`) — extend the same discipline to a **live `current_time` block** (day-of-week + date in `clients.timezone`), exactly like `make-retell-outbound-call:766-772`. This directly kills the wrong-day bug; the text engine currently injects no "today" at all.
2. **The X-Ray "TRUE final prompt" view.** This is the single strongest idea to port. The text setter's core complaint is invisibility of the 1680-line stored prompt; a text X-Ray that renders `stored prompt + Lead Context + instruction blocks + availability block` in exact assembly order (mirroring `promptSegments.ts` / `CallTimeAppendBlock.tsx`) would make hidden stale content like "Tue/Wed/Thu only" immediately visible to whoever edits.
3. **Empty-variable safety net + "never guess, use the tool" doctrine** (`EMPTY_LEAD_DEFAULTS` `retell-proxy:815`; empty-var instructions `:647-654`). Text should adopt the analogous rule that ground-truth (calendar, today) always comes from injected data/tools, never the body's canned examples.
4. **Timezone sourced from `clients.timezone`, formatted with day-of-week** — cheap, robust, and already proven on voice.

### NOT worth copying (rethink freely)

1. **The 7-layer section compiler as the *only* editing surface.** It fragments the prompt across `prompt_configurations` rows + localStorage + `prompts` + `clients.system_prompt` + the live store, which is exactly how content becomes un-seeable and drift accumulates. For text, prefer **one canonical editable document** (the stored `text_prompts.system_prompt`) with injected blocks layered visibly on top, rather than recompiling from opaque section rows.
2. **Three-plus storage copies with manual sync.** Voice has authoring copy, mirror, section rows, and the live Retell copy — and they have demonstrably drifted. Text has a cleaner single home (external `text_prompts.system_prompt`, read at `processSetterReply:156-161`); do not fragment it to match voice.
3. **Stale seed/template artifacts embedded in the body** (`{{ $now }}`, canned example times, "Available days: Tue/Wed/Thu"). These come from templated seeds baked into stored content. The redesign should treat availability/today/day-rules as **injected runtime facts only** and strip such lines from seeds/defaults (`defaultBookingPrompt.ts` still ships `{{ $now }}`).
4. **Draft/publish version divergence.** The Retell publish model creates a live-vs-draft mismatch class of bugs; the native text engine reads the current stored row directly (no publish step) — keep that simplicity; do not introduce a Retell-style versioned publish for text.
5. **Placeholder tokens the engine may not interpolate.** Voice relies on Retell substituting `{{...}}`. The native text engine does its own substitution, so any redesign must guarantee every `{{token}}` in a text prompt is actually resolved (the current `{{ $now }}` failure is precisely this gap) — do not port `{{...}}` conventions without owning the substitution.

---

## Comparison table — voice vs text authoring

| Dimension | Voice setter | Text setter |
|---|---|---|
| **Live/runtime store** | Retell LLM `general_prompt` (per agent, `clients.retell_agent_N_id`) | External Supabase `text_prompts.system_prompt`, `card_name='Setter-N'` (`processSetterReply.ts:156-161`) |
| **Authoring/mirror store** | Platform `prompts` + `clients.system_prompt` + `prompt_configurations` rows + localStorage (`PromptManagement.tsx:5324-5354`; `usePromptConfigurations.ts:20-91`) | Same section pipeline authors it, then synced out to external `text_prompts`; native engine reads external copy |
| **Assembly** | Section editor compiles 7 layers → one `general_prompt` (`AgentConfigBuilder.tsx:2878-3031`); proxy appends booking + `DYNAMIC_VARS_BLOCK` at push (`retell-proxy:784`) | Runtime concat: stored prompt + Lead Context + 2 instruction blocks (`processSetterReply.ts:175-184`), then availability block appended (`:311-316`) |
| **What's visible to operator** | Section fields + **X-Ray of TRUE final prompt** incl. call-time appends (`promptSegments.ts`; `CallTimeAppendBlock.tsx`; `AgentConfigBuilder.tsx:3244-3267`) | Old "SETTER CORE" section builder exposes only some fields; **no X-Ray**; ~1680-line stored body largely unseen/uneditable |
| **Ground-truth (availability) injection** | Per-call GHL fetch → `compactSlots` → `available_time_slots` dynamic var (`make-retell-outbound-call:195-226,747-800`) | Per-turn prefetch → `buildAvailabilityBlock` date→times map (`prefetchSlots.ts:96-134`), appended to system msg |
| **Current-time handling** | Live `current_time` in `clients.timezone`, `dateStyle:"full"` (day-of-week) as dynamic var (`make-retell-outbound-call:766-786`); inbound → discover today via `get-available-slots` tool (`retell-proxy:647-654`) | **None injected.** Only the stored body's literal `{{ $now }}`, which the native engine does not interpolate → root cause of wrong-day |
| **Report-only constraint** | Content report-only; managed via UI/Retell (project CLAUDE.md; `bfdVoiceSetterPrompt.md:1-9`) | Content report-only for hand-edits; authoring **system** in-scope to redesign |

---

## Key file:line index for the solo session

- Voice prompt (drifted repo copy, dead LLM id): `frontend/src/data/bfdVoiceSetterPrompt.md:1-9`
- Section layers: `frontend/src/components/AgentCoreVisualization.tsx:26-42`
- Section params (free-text `agent_mission`): `frontend/src/data/voiceSetterConfigParameters.ts:57-58`
- Compile to single prompt: `frontend/src/components/AgentConfigBuilder.tsx:2878-3031`; simpler join `frontend/src/hooks/usePromptConfigurations.ts:166-210`
- X-Ray (copy this idea for text): `frontend/src/lib/promptSegments.ts:1-38`; `frontend/src/components/prompt-doc/CallTimeAppendBlock.tsx:1-43`; `frontend/src/components/AgentConfigBuilder.tsx:3244-3267`; `frontend/src/components/FullPromptXRay.tsx`
- Push to Retell: `frontend/src/pages/PromptManagement.tsx:6006-6123`
- Server assembly + append + defaults: `frontend/supabase/functions/retell-proxy/index.ts:627-655` (dyn-vars block), `:734-816` (syncVoiceSetter), `:815` + `:40-42` (`EMPTY_LEAD_DEFAULTS`), `:727-731` (agent vs LLM note), `:280-296` (publish), `:792-799` (latency guard)
- Live availability + current_time injection: `frontend/supabase/functions/make-retell-outbound-call/index.ts:195-304` (fetch/compact), `:764-804` (dynamicVars incl. `current_time`), `:869-874` (push)
- Text contrast (no today anchor): `trigger/processSetterReply.ts:175-184`, `:311-316`; `trigger/_shared/prefetchSlots.ts:96-134`
- Stale `{{ $now }}` seed in booking default: `frontend/src/data/defaultBookingPrompt.ts` (header)
---

## Stream 3 — assembly+size+tools

I have all the evidence needed. Here is the report.

---

# Stream 3 — Runtime Prompt Assembly: Bloat, Size & Tool-Execution Analysis

**Scope:** The assembled system prompt the model receives per turn in the native Text engine (`processSetterReply.ts`), for the BFD dogfood client (`text_prompts.card_name='Setter-1'`, external Supabase `qildpilxjodxdifggmto`). All figures below are measured from the live stored prompt (fetched read-only) and the code constants.

---

## 1. Reconstructed per-turn system prompt (what the model actually sees)

The system message (`messages[0].content`) is built in `processSetterReply.ts:175-184`, then the live-availability block is **appended to the end** at `processSetterReply.ts:316`. Final assembled order and measured size:

| # | Component | Source | Chars | ~Tokens | Lines |
|---|-----------|--------|-------|---------|-------|
| 1 | **Stored `setterPrompt`** | `text_prompts.system_prompt` (Setter-1) | 68,762 | **~18,600** | 1,680 |
| 2 | `## Lead Context` (Name/Email/Phone) | `processSetterReply.ts:177` | ~100 | ~30 | 4 |
| 3 | `MULTI_MESSAGE_INSTRUCTION` | `processSetterReply.ts:103` | 440 | 119 | — |
| 4 | `TOOL_USAGE_INSTRUCTION` | `setterTools.ts:162-183` | 1,828 | 494 | — |
| 5 | **Live availability block** (appended) | `prefetchSlots.ts:96-134` | ~2,200* | ~600* | — |
| | **System message total** | | **~73,300** | **~19,800** | **~1,690** |

\* For BFD's fully-open calendar the block serialises a JSON map of ~10 days × ~18 slots/day (measured 1,591 chars for the map alone) plus ~600 chars of rules text.

**Also shipped on every OpenRouter request** (not in the system message, but part of the payload the model attends to):
- `tools` param: 6 function schemas, `SETTER_TOOLS` (`setterTools.ts:33-152`) ≈ **4,028 chars / ~1,090 tokens**.
- Chat history: up to `MAX_HISTORY_ROWS = 30` rows (`processSetterReply.ts:45,168`).
- Folded-back `role:"tool"` result turns during the loop, each truncated at `MAX_TOOL_RESULT_CHARS = 6000` (`setterToolLoop.ts:77,162`).

**Model & window:** `google/gemini-2.5-flash` (confirmed live for this client per project memory; `normalizeLlmModel` in `llmModel.ts` also remaps `gemini-flash-latest`→`google/gemini-2.5-flash`). Context window ≈ **1,048,576 tokens (1M)**.

**Key implication:** at ~20k tokens the prompt is **~1.9% of the window** — this is **NOT a context-overflow problem**. The failure mode is **attention dilution + instruction conflict on a small, fast, cheap model**, plus cost/latency: the tool loop (`setterToolLoop.ts:107`, `DEFAULT_MAX_ITERATIONS = 4`) **re-ships this ~20k-token system message 2–5 times per inbound SMS** (each iteration + a `finalize()` call at `setterToolLoop.ts:102`). One "book a meeting" text can burn ~80–110k input tokens.

---

## 2. Redundancy / bloat / contradiction inventory (with line numbers)

### 2a. Duplicated blocks inside the stored prompt
| Duplicate | Lines | Note |
|-----------|-------|------|
| `## GOAL: ENGAGE & QUALIFY` | **7, 74, 150** | appears **3×** |
| `## GOAL: BOOK APPOINTMENTS` | **21, 164** | 2× |
| `## GOAL: NURTURE LEADS` | **33, 176** | 2× |
| `**CRITICAL: DO NOT rush to book.**` (verbatim identical sentence) | **25, 168** | 2× |
| `## BLOCKED TOPICS` | **936, 952** | 2×, back-to-back sections |
| `## MESSAGE LENGTH` | **425** (DYNAMIC) / **448** (VARY NATURALLY) | 2 sections, same heading |
| `## REFERENCE` | **196** (USE "WE") / **1630** (current-time/days) | heading collision, unrelated content |
| `## CONVERSATION EXAMPLES` | **1007** (`#`) / **1009** (`##`) | nested duplicate heading |
| `Available days: Tuesday, Wednesday, Thursday` | **1219** ("ONLY") / **1634** | 2× (see contradiction below) |

### 2b. Two competing booking-instruction layers (the core structural problem)
- **Layer A (newer, CORRECT)** — `BOOKING HONESTY (hard rules)` at **lines 92-95**: uses the real tool names `get-available-slots` / `book-appointments`, and says "Never invent scarcity; never say booked out / snapped up / just got taken."
- **Layer B (older, STALE)** — the entire `# BOOKING FUNCTION / # SERVICE FUNCTIONS - TEXT AGENT WORKFLOW` region at **lines 1127-1680** (**554 lines, 18,218 chars, ~4,550 tokens = 26% of the whole prompt**). Uses wrong n8n tool names, the fabricated Tue/Wed/Thu constraint, `{{ $now }}`, and US-EST defaults.

These two layers directly contradict each other and both sit in the same system message.

### 2c. Contradictions
| Rule A | Rule B | Lines |
|--------|--------|-------|
| "Never invent scarcity… never say booked out" | "**Available days: Tuesday, Wednesday, Thursday ONLY**" (a fabricated constraint) | 92-95 vs **1219 / 1634** |
| Live availability block: "Offer ONLY times that appear in this map" (Monday 2026-07-06 was in the map) | "Tue/Wed/Thu ONLY" | `prefetchSlots.ts:111` vs 1219 |
| "Offer the lead **2-3** specific options" | "ALWAYS offer **exactly 2** slots. Not 1. Not 3." | `setterTools.ts:169` vs **1205** |
| Client timezone is Australian | "If the user's timezone is unclear… **default to EST**" | `identity.timeZone` (`processSetterReply.ts:225`) vs **1239** |
| Correct tool names + params | Wrong tool names + params (§3 below) | 92-95 / code-side vs **1223-1610** |

### 2d. Dead n8n / template artifacts (the native engine does NOT interpolate these)
`processSetterReply.ts:161` reads `system_prompt` verbatim; there is **no `{{ }}` substitution anywhere** in the native engine. So the model literally sees:
- **`{{ $now }}`** at **line 1141** ("The current date and time via `{{ $now }}`") and **line 1632** ("**Current time:** {{ $now }}"). **This is the sole "current time" reference in the entire assembled prompt — and it is an un-substituted literal.** There is no other now/today anchor injected by the engine (Lead Context has no date; the availability block lists dates but never labels "today"). This is the runtime-side root cause of the date miscalculation in the incident.
- **`{value}`** placeholder at **line 832** (`## MAX PUSHBACK ATTEMPTS: {value}`) — an uninterpolated section-builder token.
- n8n node-name suffixes `getContactAppointments1`, `updateAppointment1`, `cancelAppointment1` (trailing `1`) at lines 1382/1430/1466/1520/1528/1542 etc.

### 2e. Canned example times the model can pattern-match as real offers
Hard-coded fake bookings scattered through the stale half — a weak model treats these as exemplar outputs:
- "You're all set! Booked for **this Thursday at 2pm**" (1178)
- "I have **this Wednesday at 11am or 4pm**" (1207)
- "this Thursday at 2pm, Friday at 10am, next Monday at 3pm, next Tuesday at 1pm" (1213)
- "Confirm: You're all set for **this Thursday at 3pm**!" (1283)
- "Done! You're booked for **this Wednesday at 11am**" (1302), "I'll put you down for **this Wednesday at 11am**" (1306)
- "I see you have a call **this Thursday at 2pm**" (1392, 1456)

The observed incident output ("Thursday 2pm/4pm") is almost verbatim these canned examples.

---

## 3. Tool-execution correctness: prompt-named tools vs the tools the engine actually exposes

**Engine-exposed tools** (`setterTools.ts:33-152`, enforced by `SETTER_TOOL_NAMES` and the guard at `setterToolLoop.ts:132`): `get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments`, `schedule-callback`.

**What the stale prompt tells the model to call** (`## TOOL REFERENCE` 1474-1556, `## TOOL EXECUTION RULES` 1556-1590, decision table 1582-1590):

| Prompt says (wrong) | Real engine tool | Where in prompt |
|---|---|---|
| `createContact` | **does not exist** (identity is engine-injected; `setterTools.ts:16-18`) | 1476, 1255, 1259, 1324, 1582 |
| `Get_Available_Slot` (singular, Title_Case) | `get-available-slots` | 1223, 1275, 1340, 1414, 1492, 1583, 1588, 1610 |
| `bookAppointment` (camelCase) | `book-appointments` | 1281, 1302, 1306, 1508, 1584-1586 |
| `getContactAppointments1` | `get-contact-appointments` | 1382, 1446, 1520, 1568, 1587 |
| `updateAppointment1` | `update-appointment` | 1430, 1528, 1589 |
| `cancelAppointment1` | `cancel-appointments` | 1466, 1542, 1590 |
| *(absent)* | `schedule-callback` (real, exists) | — never mentioned in stale prompt |

**Parameter-name mismatches too:** the stale `TOOL REFERENCE` coaches `startDate` / `endDate` (lines 1516-1518) whereas the live schemas **require** `startDateTime` / `endDateTime` (`setterTools.ts:43-54, 67, 77`).

**Why this can cause failed/misrouted calls:**
- The correct names appear in **3 places** (top block 92-95, code-side `TOOL_USAGE_INSTRUCTION`, and the API `tools` param) totalling ~600 tokens; the **wrong** names appear in **~18 places** across a detailed reference + decision table totalling ~4,500 tokens. On a small model the higher-volume, more-structured stale section competes for control.
- If the model copies a stale name (e.g. emits `bookAppointment`), the loop's guard rejects it: `setterToolLoop.ts:132` → `"unknown tool: bookAppointment"`, folded back as a tool error (`:157-163`). That **burns a loop iteration** (cap = 4) and can push the turn to the forced `finalize()` with **no booking made** — exactly a "said it booked, didn't book / booked wrong" class of failure.
- If it follows the stale **param** guidance (`startDate` instead of `startDateTime`), the required `startDateTime` is absent (identity injection at `setterToolLoop.ts:148` does not supply it) → the booking tool gets a malformed/incomplete call.

Note: the correct booking mechanics are **already fully specified code-side** — the `tools` param schemas + `TOOL_USAGE_INSTRUCTION` (`setterTools.ts:162-183`) cover check/offer/book/reschedule/cancel/callback correctly and are report-only-safe. The stale in-prompt tool section is 100% redundant with code and actively wrong.

---

## 4. Efficiency recommendations (prioritised)

### How the current shape degrades a small/fast model
1. **No real "now" anchor.** The only date reference is the literal `{{ $now }}` (1141, 1632). Gemini-2.5-flash has no reliable "today," so relative-date phrases ("this Thursday") resolve to an arbitrary absolute date — the incident booked `2026-07-03T16:00` (Friday) while labelling it "Thursday." The availability map gives dates but never says which is today.
2. **Fabricated scarcity beats ground truth.** "Available days: Tue/Wed/Thu ONLY" (1219, 1634) is a hard, capitalised constraint that directly overrode the appended live-availability block (which listed Monday). Volume + emphasis of the stale rule won over the single ground-truth block.
3. **Canned example times get echoed** (2c) instead of the fetched slots.
4. **Contradictory tool names/params** raise malformed-call probability and waste loop iterations (§3).
5. **Cost/latency:** ~20k-token system message × 2–5 loop iterations per SMS, most of it dead weight.

### What a lean booking prompt should contain (target ≈ 300–500 lines / ~4–6k tokens)
- **Identity / persona / qualification / tone** — keep (this is the legitimately client-editable part), but **de-duplicate**: the 3× GOAL blocks, 2× "DO NOT rush," 2× BLOCKED TOPICS, 2× MESSAGE LENGTH collapse to one each (removes ~1–2k tokens with zero behaviour change).
- **Delete the entire `# BOOKING FUNCTION / SERVICE FUNCTIONS` region (lines 1127-1680, 554 lines / ~4,550 tokens / 26% of the prompt).** Every correct thing it tries to say is already owned code-side by `TOOL_USAGE_INSTRUCTION` + the `tools` schemas + the availability block; everything unique to it (wrong tool names, Tue/Wed/Thu, EST default, `{{ $now }}`, canned times) is wrong. This one deletion removes ~26% of the prompt and eliminates most of §2c/§2d/§3.
- Booking mechanics, tool names, "offer only real slots," reschedule/cancel flow → **all code-side**, not in the editable prompt (they already are).

### Anchor "current time" properly (highest-value single fix, and it's a SYSTEM change, not a prompt-content edit)
Inject a real, engine-computed now into the assembled system message — e.g. add to the `systemContent` array in `processSetterReply.ts:175-184` (or prepend to the availability block in `prefetchSlots.ts:buildAvailabilityBlock`, which already knows the timezone):

```
## Current time (ground truth)
Today is Friday, 4 July 2026. Current local time: 2026-07-04T09:12+10:00 (Australia/Sydney).
"This Thursday" = 2026-07-10. Resolve every relative day from this anchor; never guess the date.
```

The engine already has everything for this: `client.timezone` (`processSetterReply.ts:132,225`) and `Date.now()` (already passed as `nowMs` to `prefetchAvailability`, `:314`). This makes the stale `{{ $now }}` harmless even before the stored prompt is cleaned, and fixes the date-math root cause at the assembly layer.

### Move static prose from the editable prompt to code
Already code-owned (good, keep): output format, tool-usage guidance, live availability + anti-fabrication rules. **Additionally move to code / template-side:** the "how to display dates," "slot recommendation count," "timezone handling," and "booking confirmation logic" sections (1184-1310) — these are engine policy, not client copy, and currently contradict the code versions. Net: the editable stored prompt shrinks from ~1,680 lines to ~300–500 lines of genuinely client-specific persona/qualification content, and the ~1,000 tokens of correct code-side booking guidance stop competing with ~4,500 tokens of stale in-prompt booking guidance.

### Prioritised issue list
| P | Issue | Evidence | Fix surface |
|---|-------|----------|-------------|
| **P0** | No real "now" anchor; only literal `{{ $now }}` | prompt 1141/1632; no interpolation in `processSetterReply.ts` | **Code** — inject real now+timezone into system message |
| **P0** | Fabricated "Tue/Wed/Thu ONLY" overrides live calendar | prompt 1219/1634 vs `prefetchSlots.ts:111` | Prompt-content (report) + delete stale section |
| **P0** | Wrong tool names/params vs real 6 tools | prompt 1223-1610 vs `setterTools.ts:33-152` | Delete stale `# BOOKING FUNCTION` section |
| **P1** | 554-line stale booking block = 26% of prompt, fully redundant with code | lines 1127-1680 | Delete; keep code-side `TOOL_USAGE_INSTRUCTION` |
| **P1** | Canned example times echoed as offers | 1178/1207/1213/1283/1302/1306 | Remove/parameterise in template |
| **P2** | Duplicated GOAL/HONESTY/BLOCKED/MESSAGE-LENGTH blocks | 7/74/150; 25/168; 936/952; 425/448 | De-dupe |
| **P2** | ~20k-token system re-shipped 2–5×/SMS | `setterToolLoop.ts:107` + `:102` | Falls out of the shrink above |
| **P3** | `{value}` uninterpolated placeholder; EST default for AU client | 832; 1239 | Template + prompt cleanup |

**Bottom line for the solo session:** two of the three P0s are pure *system/assembly* fixes you can make without touching client prompt content — (a) inject a real current-time anchor in `processSetterReply`/`prefetchSlots`, and (b) redesign the authoring template so the stored prompt no longer carries a stale, wrong, 554-line booking section that duplicates and contradicts the code-side tool layer. Doing both neutralises the incident's root causes and cuts ~26–35% of per-turn tokens.

**Files of record:** stored prompt `text_prompts.system_prompt` (card_name `Setter-1`, ext Supabase `qildpilxjodxdifggmto`); assembly `/srv/bfd/Projects/bfd-setter/trigger/processSetterReply.ts`; availability injection `/srv/bfd/Projects/bfd-setter/trigger/_shared/prefetchSlots.ts`; tool schemas + code-side guidance `/srv/bfd/Projects/bfd-setter/trigger/_shared/setterTools.ts`; loop + unknown-tool guard `/srv/bfd/Projects/bfd-setter/trigger/_shared/setterToolLoop.ts`; model normaliser `/srv/bfd/Projects/bfd-setter/trigger/_shared/llmModel.ts`.
---

## Stream 4 — best-practices-web

Research complete across all four areas. Here is the report.

---

# Stream 4 — External Best Practices for Redesigning the Text-Setter Prompt Authoring System & Booking Prompt

Research date 2026-07-03. All sources are cited inline with URLs. Where a finding contradicts the current BFD design (the 1680-line stored prompt, the `{{ $now }}` leftover, the "Tue/Wed/Thu ONLY" rules, the appended availability block, Gemini 2.5 Flash via OpenRouter), it is flagged **⚠ CONTRADICTS CURRENT DESIGN**.

## Executive summary — how the external evidence maps to the incident

The live failure (setter overrode a fully-open live calendar, invented "we only book Tue/Wed/Thu", mislabeled Friday as Thursday) is a textbook instance of three well-documented failure modes, each with vendor-backed fixes:

1. **Stale prompt rules winning over live tool data.** OpenAI's own guidance is explicit: when instructions conflict, the model follows the rule, not the freshest data, and *"tends to follow the one closer to the end of the prompt."* The current system appends live availability at the end (correct instinct), but the stale "Available days: Tuesday, Wednesday, Thursday ONLY" appears **twice** and is strongly worded ("ONLY"), so the conflict is real and the model resolves it toward the hard-coded rule. The fix is to *delete the contradictory rules*, not merely to out-position them.
2. **No real "today" anchor.** `{{ $now }}` is never interpolated by the native engine, so the model has literally no ground-truth current date. Every vendor and practitioner source says the single highest-leverage fix for date/time bugs is injecting a real ISO-8601 timestamp + IANA timezone.
3. **Canned example times teaching the wrong pattern.** Anthropic warns that few-shot examples must be diverse "enough that Claude doesn't pick up unintended patterns." Repeating "Booked for this Thursday at 2pm" ~5 times trains the model to emit exactly that string regardless of the real slot.

---

## Area 1 — System-prompt design for booking/scheduling agents

### 1.1 Preventing hallucinated availability: make the tool layer authoritative, not the prompt

The consensus across practitioner and vendor sources is that availability must be **computed in the tool layer and handed to the model as pre-ranked ground truth**, and the model must be forbidden from reasoning about availability from prose rules.

- Nicholas McCormick's teardown of why scheduling agents fail identifies "unscored availability data" as a core failure: *"Raw free/busy blocks lack ranking logic, forcing agents to invent their own or select arbitrarily."* His fix is to return *"ranked slots with a 0–1 score"* and to *"push domain complexity into the tool layer — let scheduling logic handle availability scoring while agents focus on orchestration and user intent."* ([dev.to](https://dev.to/nicholasemccormick/why-ai-agents-fail-at-scheduling-and-how-to-fix-it-257h))
- Schedulee's 2026 evaluation documents the exact BFD symptom: agents *"can misread blocked time... The agent confirms a booking confidently while a conflict exists."* Their conclusion: hallucination stops *"not because the model got smarter, but because it has enough ground truth to reason from."* ([schedulee.com](https://schedulee.com/blog/ai-scheduling-agents-honest-evaluation-2026/))
- Retell's own docs recommend telling the agent to call `check_calendar_availability` *after the user mentions a time preference* and to *"quote only genuine available slots rather than assumptions."* Retell also notes you should *"include in the prompt explicitly when is the best time to invoke the custom function."* ([docs.retellai.com](https://docs.retellai.com/build/check-availability))
- Anthropic's "ground responses in quotes" technique is directly applicable: for tasks over provided data, *"ask Claude to quote relevant parts... first before carrying out its task. This helps Claude cut through the noise."* Applied here: instruct the model to first restate the injected available slots verbatim before offering any time. ([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))

**Actionable recommendations**
- The system prompt must contain **zero** hard-coded availability rules (no "Tue/Wed/Thu", no example times, no business hours in prose). Availability is *data*, not *policy*, and belongs only in the injected block. **⚠ CONTRADICTS CURRENT DESIGN** — the stored prompt hard-codes days and times in at least 4 places.
- Have the tool/prefetch return **pre-ranked, fully-qualified slots** (ISO-8601 with offset, e.g. `2026-07-06T11:00:00+10:00`), optionally scored, so the model never derives a slot itself.
- Add one explicit rule near the end of the assembled prompt: *"You may ONLY offer times that appear in the AVAILABLE SLOTS block below. If a requested time is not in that block, say it is unavailable and offer the nearest listed slots. Never state a day or time policy that is not in that block."*
- Make the model **echo the chosen slot's exact ISO datetime back** into the `book_appointments` argument, rather than reconstructing it from natural language ("Thursday 2pm"). This closes the gap where "Thursday 2pm" got turned into `2026-07-03T16:00+10:00`.

### 1.2 Anchoring the current date/time (the `{{ $now }}` bug)

This is the single most-cited, highest-ROI fix in the literature.

- The core principle: *"LLMs do not have an internal sense of 'today.' If your prompt depends on the current date, current time, or the user's timezone, you have to provide that context explicitly. Otherwise the model will infer, guess, or reason from stale context."* ([dev.to — terrapin88](https://dev.to/terrapin88/why-your-agent-doesnt-know-what-time-it-is-15j4))
- Damian Galarza's production guide gives a concrete injection format — inject three fields, all machine-formatted: ([damiangalarza.com](https://www.damiangalarza.com/posts/2026-01-07-llm-date-time-context-production/))
  ```
  Today's date is: 2026-07-03            (ISO 8601)
  User timezone is: Australia/Brisbane   (IANA)
  Request timestamp is: 2026-07-03T14:00:00+10:00   (ISO 8601 with offset)
  ```
  and the rule: *"Avoid relative language... Replace phrases like 'today,' 'recently,' or 'last 30 days' with computed values whenever possible."*
- McCormick's scheduling-specific version: *"Explicit timezone offsets in every field... so agents never infer timezones,"* because *"LLMs are notoriously unreliable at timezone arithmetic."* ([dev.to](https://dev.to/nicholasemccormick/why-ai-agents-fail-at-scheduling-and-how-to-fix-it-257h))
- Best practice is a **hybrid** of injection + a tool: *"Injection-only approaches get stale in long sessions... A hybrid approach gives the best of both."* For a per-message SMS turn this matters less, but for multi-message threads spanning days, a `get_current_time` tool is worth having. ([dev.to — thewebtech](https://dev.to/thewebtech/current-date-and-time-for-agents-32kj))

**Actionable recommendations**
- Replace `{{ $now }}` in the stored prompt with a **runtime-interpolated** real timestamp block injected by `processSetterReply.ts` (alongside the availability block), formatted as ISO-8601 + IANA timezone + explicit day-of-week (e.g. "Today is Friday, 2026-07-03, timezone Australia/Brisbane"). **⚠ CONTRADICTS CURRENT DESIGN** — the leftover n8n `{{ $now }}` expression is a silent no-op in the native engine, so the model currently sees a literal string and has no anchor at all. This is the direct cause of the "Thursday → Friday" mislabel.
- Because the availability block already carries fully-qualified ISO datetimes, standardize the *whole* system on ISO-8601-with-offset and forbid the model from doing date arithmetic; it should only copy the offered slot's ISO string.

### 1.3 Making a small, fast model book the exact accepted slot

- Anthropic's anti-hallucination pattern generalizes cleanly: *"Never speculate about code you have not opened... give grounded and hallucination-free answers."* The scheduling analogue is: never state a time you did not read from the AVAILABLE SLOTS block. ([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))
- OpenAI: *"Always call a tool before answering factual questions"* and *"If you don't have enough information to call the tool, ask the user."* Availability is a factual question; the model should never answer it from memory. ([developers.openai.com](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide))
- McCormick: use **UUIDs / stable references** for the slot and booking across tool calls, *"preventing re-resolution errors."* A small model re-deriving "Thursday 2pm" into a datetime is exactly the re-resolution error to design out — pass a slot ID or the exact ISO string, not a natural-language label. ([dev.to](https://dev.to/nicholasemccormick/why-ai-agents-fail-at-scheduling-and-how-to-fix-it-257h))

**Actionable recommendations**
- Give each offered slot a stable identifier in the injected block (`slot_id` or the canonical ISO string) and require `book_appointments` to be called with that identifier verbatim. Validate server-side that the booked datetime is a member of the prefetched set; reject and re-prompt if not.
- Keep the model's job narrow: *select* among enumerated slots, don't *compute* slots.

---

## Area 2 — Structured vs freeform prompt-authoring UIs for non-technical operators

The current editor exposes a few fields (e.g. IDENTITY → agent_mission) as free text while ~1680 lines of load-bearing, un-editable content sit hidden in `text_prompts.system_prompt`. The literature strongly favors a **sectioned, layered, template-plus-variables model with a full-assembled-prompt preview and validation** — and specifically warns against hiding load-bearing content from operators.

### 2.1 Sectioned templates as the authoring unit

- The dominant structured-prompt pattern is a small fixed set of labeled sections. A widely-referenced template is *"five sections: identity, rules, format, edge cases, examples,"* with the guidance to *"explicitly label all sections: role, task, constraints, context, output format."* Sectioning gives *"granular, transparent adaptation."* ([pecollective.com](https://pecollective.com/blog/system-prompt-design-guide/), [emergentmind.com](https://www.emergentmind.com/topics/structured-system-prompt-summary))
- Anthropic recommends XML-tagged sections precisely so the model *and* the author can tell instructions, context, examples and variable inputs apart, reducing misinterpretation. This doubles as the UI's structural backbone: each XML section = one editable card. ([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))

### 2.2 Template + variables, with a system/operator/user privilege split

- Template systems separate *fixed template* from *injected variables*: f-string (simple placeholder replacement) vs Jinja2 (conditionals/loops to include or exclude sections based on whether variables exist). This is exactly the mechanism to inject live availability and the current timestamp as variables rather than baking them into stored text. ([docs.promptlayer.com](https://docs.promptlayer.com/features/prompt-registry/template-variables))
- A "managed prompt environment" is explicitly designed so *"non-technical domain experts can independently work with prompt templates without involvement from developers."* That is the target UX for BFD operators. ([docs.promptlayer.com](https://docs.promptlayer.com/features/prompt-registry/template-variables), [Anthropic Console prompting tools](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompt-templates-and-variables))
- The security literature independently arrives at a **layered privilege model** that maps perfectly onto "what an operator may edit": an **Operator/System tier** (highest privilege, the immutable scaffolding + guardrails) and a **User tier** (lowest privilege) — and hardened prompts keep *"immutable rules as the highest priority section."* For BFD, this argues for three layers: (a) **immutable system scaffolding** (booking protocol, "only offer injected slots", tool-use rules) that operators cannot edit or even see as free text; (b) **operator-editable persona/policy fields** (mission, tone, FAQs, real business hours as *structured data* not prose); (c) **runtime-injected variables** (live slots, timestamp, lead context). ([medium.com/@usaif](https://medium.com/@usaif/building-secure-ai-agents-a-three-layer-defense-architecture-for-prompt-injection-76295ebc38a5), [OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html))

### 2.3 Do not hide load-bearing content; show the fully assembled prompt

- **⚠ CONTRADICTS CURRENT DESIGN.** The current arrangement — an old "SETTER CORE" section builder exposing only some fields while 1680 lines are invisible and un-editable — is the anti-pattern. The stale "Tue/Wed/Thu ONLY" rules survived precisely because no operator could see or delete them. Structured-prompt guidance is that sections should be *"transparent"* and every section explicitly labeled and visible; template systems treat prompts as *"versioned, first-class components."* The redesign should render the **entire assembled prompt** (scaffolding + operator fields + a sample of injected variables) in a read-only preview pane so nothing is load-bearing-but-hidden. ([emergentmind.com](https://www.emergentmind.com/topics/structured-system-prompt-summary), [docs.promptlayer.com](https://docs.promptlayer.com/features/prompt-registry/template-variables))

### 2.4 Linting / validation of the authored prompt

- Prompt linters now exist specifically to catch the BFD failure class. The VS Code **Prompt Linter** *"analyzes prompts and identifies logical conflicts, ambiguities, and potential improvements."* A booking-domain lint rule ("prompt contains a hard-coded weekday/time policy" or "prompt contains a literal example booking time") would have flagged this prompt. ([marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=Ignire.prompt-linter))
- **Promptsage** is a builder+linter+sanitizer that *"combines all components of your prompt into a compressed LLM-ready payload and applies filters to sanitize your final prompt"* — a model for a save-time validation step. ([github.com/alexmavr/promptsage](https://github.com/alexmavr/promptsage))
- Guardrails frameworks (NeMo Guardrails, Guardrails AI) formalize input/processing/output rails; the relevant one here is a **processing rail** that *"controls which context and data the model can access while enforcing business rules"* — i.e. enforce that availability comes only from the injected block. ([github.com/guardrails-ai/guardrails](https://github.com/guardrails-ai/guardrails), [dev.to guardrails overview](https://www.wiz.io/academy/ai-security/ai-guardrails))

**Actionable recommendations for the authoring system**
- Rebuild the editor as **labeled sections mapped to XML tags**, backed by a template engine (f-string/Jinja2-style) where live slots, timestamp, and lead context are **variables**, never stored text.
- Enforce the three-layer privilege split: immutable scaffolding (uneditable), operator persona/policy fields (structured — e.g. business hours as a day/time table that feeds the *tool*, not prose), and runtime variables.
- Add a **"Preview assembled prompt"** pane showing the exact string the model will see, with placeholders filled by a sample turn.
- Add **save-time linting**: reject/warn on hard-coded weekday policies, literal example booking times, un-interpolated template tokens (e.g. a stray `{{ $now }}`), and duplicated/contradictory rules.
- Migrate the stored 1680-line prompt into these structures so no content is hidden.

---

## Area 3 — Prompt size vs tool-calling reliability

The evidence that the 1680-line prompt is itself a reliability hazard is strong and quantitative.

- **LongFuncEval** (IBM, 2025) measured function-calling degradation as context grows: a **7%–85% drop as the number of tools increases**, a **7%–91% degradation in answer retrieval as tool-response length increases**, and **13%–40% degradation as multi-turn conversations get longer.** Conclusion: *"LLMs still struggle with long context in tool calling settings."* ([arxiv.org/abs/2505.10570](https://arxiv.org/abs/2505.10570))
- Long, contradictory prompts specifically damage tool *selection and argument* accuracy: *"When the LLM prompt doesn't clearly delineate what tool to invoke and why, it often misfires or guesses,"* and models misroute *"particularly when there are mutually exclusive cues in descriptions."* A 1680-line prompt with contradictory availability rules is a large source of mutually-exclusive cues. ([medium.com — function-calling pitfalls](https://medium.com/@2nick2patel2/llm-function-calling-pitfalls-nobody-mentions-a0a0575888b1), [medium.com — multi-tool inconsistency](https://medium.com/@abhaychougule0907/underlying-factors-behind-inconsistency-in-llm-responses-with-multi-tool-calling-628ce7b4de76))
- Long system prompts also crowd out usable context: *"Long system prompts reduce how much history you can keep in the context window, which can degrade overall performance."* ([medium.com — why long system prompts hurt](https://medium.com/data-science-collective/why-long-system-prompts-hurt-context-windows-and-how-to-fix-it-7a3696e1cdf9))
- OpenAI's structural remedy for necessarily-long prompts: place key instructions at **both the top and bottom** of the long context, and *"check for conflicting, underspecified, or wrong instructions and examples,"* ensuring *"any important behavior demonstrated in your examples are also cited in your rules."* ([developers.openai.com](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide))
- Anthropic's long-context structure guidance: put longform data near the top, keep the operative query/instruction at the end (queries at the end *"can improve response quality by up to 30%"*), and ground the model in quotes from the data. ([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))
- Anthropic also warns that few-shot examples must be *"Diverse: cover edge cases and vary enough that Claude doesn't pick up unintended patterns."* **⚠ CONTRADICTS CURRENT DESIGN** — the repeated "Booked for this Thursday at 2pm" canned examples are the opposite: a repeated, non-diverse pattern that the model over-generalizes into always saying "Thursday 2pm." ([platform.claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))

**Actionable recommendations**
- Aggressively shrink the assembled prompt. Aim for a compact scaffolding (roughly Anthropic/OpenAI's 5–7 labeled sections) plus injected variables. A 1680-line prompt is well into the regime where LongFuncEval shows large tool-calling degradation.
- Remove all canned example booking times, or replace them with a **small, diverse** example set (different days/times, including "requested time unavailable → offer nearest") whose behaviors are also stated as rules.
- Keep the live availability + timestamp block near the **end** (last-position priority per OpenAI; query-at-end per Anthropic) — the current append location is right; the problem is the contradictory earlier rules, not the block's position.
- De-duplicate rules; each rule should appear once. Duplicated, slightly-different rules are contradictory cues.

---

## Area 4 — Model-family guidance: Gemini 2.5 Flash function-calling + OpenRouter

### 4.1 Gemini 2.5 Flash function-calling (Google primary docs)

- **Function-calling modes** via `tool_choice` in `generation_config`: `auto` (model decides), `any` (*"constrained to always predict a function call"*), `none` (no calls), and a preview `validated` mode (*"model ensures function schema adherence"*). For a booking turn where you *know* a calendar lookup is required, forcing `any`/`required` prevents the model from answering availability from prose. ([ai.google.dev](https://ai.google.dev/gemini-api/docs/function-calling), [cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling))
- **Temperature:** *"use 0 or another low value... to generate more confident results and reduce hallucinations."* A booking setter should run near-zero temperature. ([ai.google.dev](https://ai.google.dev/gemini-api/docs/function-calling))
- **Tool count:** *"Keep the active set to 10–20 tools maximum"* to avoid selection degradation (consistent with LongFuncEval). ([ai.google.dev](https://ai.google.dev/gemini-api/docs/function-calling))
- **Descriptions & typing:** *"Be clear and specific"* in function/parameter descriptions; use *"descriptive names without spaces or special characters"*; use **strong types** (`integer`, `string`, `enum`) rather than generic objects. For booking, make the datetime argument a strongly-typed ISO string and, where possible, an **enum of the offered slot IDs** so the model can only pick a real slot. ([ai.google.dev](https://ai.google.dev/gemini-api/docs/function-calling), [firebase.google.com](https://firebase.google.com/docs/ai-logic/function-calling))
- **Validate before executing** consequential calls (a booking is consequential), and use **thought signatures** with function calling for best results. ([ai.google.dev](https://ai.google.dev/gemini-api/docs/function-calling))

### 4.2 OpenRouter tool-calling (primary docs)

- OpenRouter uses the **OpenAI-compatible tool spec**; the model only *suggests* a call, and *"the application receives that tool-call request, validates it, executes the real operation, and sends the tool result back."* This is the seam to enforce server-side that the booked slot is one of the prefetched slots. ([openrouter.ai](https://openrouter.ai/docs/guides/features/tool-calling))
- `tool_choice`: `none` / `auto` / `required` (`required` = *"the model must call one or more tools"*). Use `required` (or Gemini's `any`) on the availability step. `parallel_tool_calls` defaults true. ([openrouter.ai](https://openrouter.ai/docs/guides/features/tool-calling), [openrouter.ai parameters](https://openrouter.ai/docs/api/reference/parameters))
- Tool-definition best practices per OpenRouter: descriptive names + *"comprehensive descriptions that help the model understand when and how to use the tool."* ([openrouter.ai](https://openrouter.ai/docs/guides/features/tool-calling))

### 4.3 Instruction-conflict behavior (why the stale rule wins)

- OpenAI (GPT-4.1 guide, but the behavior generalizes to instruction-tuned models incl. Gemini Flash): *"If there are conflicting instructions, GPT-4.1 tends to follow the one closer to the end of the prompt"* and the model follows instructions *"more literally."* This is the mechanistic explanation for the incident: with the availability block appended last, the model *should* prefer it — but the stale "ONLY Tue/Wed/Thu" is emphatic and repeated, and there is no real date anchor to reconcile against, so the model still leans on the hard rule. The durable fix is deletion of the contradiction, plus the timestamp anchor, plus `required` tool use. ([developers.openai.com](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide))

**Actionable recommendations**
- Run the setter at **temperature 0** (Gemini guidance).
- On the availability step, set **`tool_choice: "required"`** (OpenRouter) / **`any`** (Gemini) so the model must consult the calendar tool rather than answer from prose.
- Strongly type the booking datetime argument; ideally constrain the selectable slot to an **enum of prefetched slot IDs**, and validate the argument server-side against the prefetched set before executing the booking.
- Keep the tool set small (≤10–20) and give each tool a crisp, non-overlapping description.

---

## Consolidated list of design contradictions to flag for the solo session

1. **Hard-coded availability policy in the prompt** ("Tue/Wed/Thu ONLY", ×2; canned example times, ×~5). Contradicts the entire "tool layer is authoritative, prompt carries no availability" consensus (Area 1) and Anthropic's example-diversity rule (Area 3). → Delete from stored content; move real business hours into *structured operator data* that constrains the calendar tool, not prose.
2. **`{{ $now }}` no-op.** No real date anchor. Contradicts every date/time source (Area 1.2). → Replace with runtime-injected ISO-8601 + IANA-timezone + weekday.
3. **1680-line hidden, un-editable prompt.** Contradicts prompt-length/tool-reliability evidence (Area 3) *and* the "don't hide load-bearing content; show assembled prompt" authoring guidance (Area 2). → Shrink, sectionize, make fully visible, add preview + lint.
4. **Natural-language slot round-tripping** ("Thursday 2pm" → wrong ISO). Contradicts stable-reference guidance (Area 1.3, McCormick). → Pass and book the exact ISO/slot-ID; validate membership server-side.
5. **No forced tool use / temperature not pinned for a factual booking task.** Contradicts Gemini/OpenRouter guidance (Area 4). → `required`/`any` tool_choice + temperature 0 + server-side validation.

---

## Sources

Primary / vendor:
- Anthropic — Prompting best practices: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Anthropic — Console prompt templates & variables: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompt-templates-and-variables
- OpenAI — GPT-4.1 Prompting Guide: https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide
- Google — Gemini API function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Google Cloud / Vertex AI — Introduction to function calling: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling
- Firebase AI Logic — Function calling with Gemini: https://firebase.google.com/docs/ai-logic/function-calling
- OpenRouter — Tool & Function Calling: https://openrouter.ai/docs/guides/features/tool-calling
- OpenRouter — API parameters: https://openrouter.ai/docs/api/reference/parameters
- Retell AI — Check Calendar Availability: https://docs.retellai.com/build/check-availability

Research / evidence:
- LongFuncEval (arXiv 2505.10570): https://arxiv.org/abs/2505.10570

Engineering practitioners:
- Why AI agents fail at scheduling (and how to fix it): https://dev.to/nicholasemccormick/why-ai-agents-fail-at-scheduling-and-how-to-fix-it-257h
- AI Scheduling Agents in 2026 (Schedulee): https://schedulee.com/blog/ai-scheduling-agents-honest-evaluation-2026/
- How to Fix LLM Date and Time Issues in Production (Damian Galarza): https://www.damiangalarza.com/posts/2026-01-07-llm-date-time-context-production/
- Why Your Agent Doesn't Know What Time It Is: https://dev.to/terrapin88/why-your-agent-doesnt-know-what-time-it-is-15j4
- Current Date and Time for agents: https://dev.to/thewebtech/current-date-and-time-for-agents-32kj
- LLM Function-Calling Pitfalls Nobody Mentions: https://medium.com/@2nick2patel2/llm-function-calling-pitfalls-nobody-mentions-a0a0575888b1
- Underlying Factors Behind Inconsistency in Multi-Tool Calling: https://medium.com/@abhaychougule0907/underlying-factors-behind-inconsistency-in-llm-responses-with-multi-tool-calling-628ce7b4de76
- Why Long System Prompts Hurt Context Windows: https://medium.com/data-science-collective/why-long-system-prompts-hurt-context-windows-and-how-to-fix-it-7a3696e1cdf9

Prompt-authoring UI / structure / guardrails:
- System Prompt Design: 9 Patterns for Production LLMs (2026): https://pecollective.com/blog/system-prompt-design-guide/
- Structured System Prompts (EmergentMind): https://www.emergentmind.com/topics/structured-system-prompt-summary
- PromptLayer — Template Variables: https://docs.promptlayer.com/features/prompt-registry/template-variables
- Prompt Linter (VS Code): https://marketplace.visualstudio.com/items?itemName=Ignire.prompt-linter
- Promptsage (builder/linter/sanitizer): https://github.com/alexmavr/promptsage
- Guardrails AI: https://github.com/guardrails-ai/guardrails
- AI Guardrails overview (Wiz): https://www.wiz.io/academy/ai-security/ai-guardrails
- Three-Layer Defense Architecture for Prompt Injection: https://medium.com/@usaif/building-secure-ai-agents-a-three-layer-defense-architecture-for-prompt-injection-76295ebc38a5
- OWASP — LLM Prompt Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
---

