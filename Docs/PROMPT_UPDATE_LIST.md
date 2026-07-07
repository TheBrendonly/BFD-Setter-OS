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
  actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated → `Docs/DEFERRED.md`.
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

---

## Open

- [x] **PU-8 — Voicemail message says a literal "[Your Name]" placeholder (voice). CONFIRMED RESOLVED
  2026-07-07 (Session P1 live verification) — move to `COMPLETED_LOG.md`.** Checked the live `voicemail_option`
  on the 5 distinct canonical agents (the 4 Garys + the shared Main-Outbound/Inbound BFD Agent): all show the
  identical text *"Leave a breif message saying you will try again later and why you called. Thanks."* (an
  instruction, not a literal script) — no `[Your Name]` or any bracket placeholder anywhere. Likely fixed via
  a 2026-07-05 batch prompt push. ~~Original: on an unanswered outbound call the pushed voicemail landed and
  the agent left a message, but it said *"Hi Brendan, this is **[Your Name]** calling…"* — the placeholder was
  never substituted.~~

- [x] **PU-1 — Confirm the timezone with the lead when offering/booking (both). CONFIRMED ALREADY DONE
  2026-07-07 (Session P1 live verification) — move to `COMPLETED_LOG.md`.** Checked general_prompt on all 6
  canonical agents: explicit "Sydney time" / "Australia/Sydney" wording is hardcoded directly in the stored
  prompt text on every agent (e.g. "Say 'Sydney time' when confirming bookings"), not just runtime-injected —
  it's visible and editable in Prompt Management today. No further Brendan action needed. Original text below
  for the record.
  business timezone when it offers times and when it confirms a booking, so a lead knows *which* "2pm" (e.g.
  *"Booked for Thursday 2:00pm, Sydney time."*). **Engine half is now code-side** (this was added to
  `trigger/_shared/setterTools.ts` `TOOL_USAGE_INSTRUCTION` + the availability block in
  `trigger/_shared/prefetchSlots.ts`, PROMPT-AUTH-1, 2026-07-03 — the timezone name is already in the model's
  context via the live availability + current-time blocks). **Your half (optional, per client):** if a
  client's persona has its own booking-confirmation wording, make sure it doesn't contradict this and, if you
  want it explicit, add the timezone phrasing there. **Scope note:** everything runs in the *business*
  timezone (`clients.timezone`, currently `Australia/Sydney`); there is **no per-lead timezone** — a lead in
  another state who says "2pm" is booked at 2pm Sydney. True cross-timezone handling (convert to the lead's
  own zone) is a v2 feature, logged in `Docs/DEFERRED.md` (BOOK-TZ-1). Source: PROMPT-AUTH-1 timezone-alignment
  audit, 2026-07-03.

- [x] **PU-4 — Property Coach company-name placeholder (voice). CONFIRMED RESOLVED 2026-07-07 (Session P1
  live verification) — move to `COMPLETED_LOG.md`.** Live `Gary - Property Coach` COMPANY FACTS now reads
  *"Company name: Building Flow Property"* — no bracket placeholder, no config note. Already fixed since the
  2026-06-16 finding (likely via the 2026-07-05 batch push). No further action needed. ~~Original: still read
  `[Your Property Coaching Company Name] = "Building Flow Property"` with an explicit config note.~~

- [x] **PU-3 — Personalize the outbound opener with `{{first_name}}` (voice, 6.8). RESOLVED 2026-07-07 by the
  MAIN-OUTBOUND-SHARED-1 restore — move to `COMPLETED_LOG.md`.** The bug fix restored "Main Outbound" to its
  own dedicated agent `agent_f45f4dd…`, whose live `begin_message` already reads *"Hey {{first_name}}, it's
  Gary, from Building Flow Digital - you put your hand up for some info on our AI setter service. Got a quick
  sec?"* — it personalizes AND states the call's purpose. The old "adding `{{first_name}}` would break inbound"
  concern no longer applies: inbound is now a SEPARATE agent (`agent_b2f6495…`, slot 8) with its own name-free
  opener, so the two directions can't collide. No Brendan action. Original (pre-restore) analysis kept below
  for the record.

  ~~STILL OPEN — corrected 2026-07-07 after an agent-identification error.~~ ⚠️ An earlier pass during this session misidentified
  "Main Outbound" as the Retell agent literally named `Voice-Setter-Test` (`agent_f45f4dd…`), based on which
  agent the phone number's static `outbound_agents` binding lists — which is exactly the trap this project's
  own `CLAUDE.md` warns against ("ignore the phone number attached to an agent in Retell"). Cross-checked
  against the platform DB (`voice_setters` row "Main Outbound", `id=b09624b5…`, whose `retell_agent_id` is
  what `make-retell-outbound-call` actually reads via `override_agent_id`) and three dated real-call citations
  in `COMPLETED_LOG.md` (2026-07-03, 2026-07-06 ×2): **the real live "Main Outbound" is `agent_b2f6495…` — the
  SAME physical Retell agent as "Inbound BFD Agent."** Its actual begin_message (re-verified directly) is
  *"Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital. Just so you know, this call is
  being recorded for quality. What can I help you with?"* — **no `{{first_name}}`** anywhere. So the original
  PU-3 request is still unmet, and the original CAUTION is now confirmed to matter even more than the draft
  assumed: since inbound and outbound genuinely share one prompt/agent today, adding `{{first_name}}` directly
  to this opener WOULD break on every inbound call (where it's usually blank). **Recommended fix:** since
  Retell's `begin_message` can't easily branch on call direction within one agent, either (a) split outbound
  onto its own dedicated agent so it can safely use `{{first_name}}`, or (b) add a conditional phrase the
  model is instructed to use only "if a first name is known," rather than baking `{{first_name}}` into the
  literal begin_message text. Flag for Brendan: worth deciding whether inbound+outbound sharing one Retell
  agent is intentional going forward, or worth splitting.

- [ ] **PU-6 — Call-recording disclosure line (voice; AU compliance). NARROWED 2026-07-07: Brendan confirmed
  only Main Outbound needs this now** (the other 3 non-core agents are demo personas, see the agent-scope
  reminder above; Inbound BFD Agent already has it). NSW, WA and SA require ALL-PARTY consent to record calls,
  and Retell records calls. **Only remaining agent:** **Main Outbound** (`agent_f45f4dd…`, LLM `llm_a73df8…` —
  re-verified live 2026-07-07: no "recorded"/"recording"/"quality" anywhere in its opener or general_prompt;
  the pre-restore shared agent HAD the disclosure, but the dedicated Main Outbound agent it was restored to
  does not). Add a short disclosure near the top of its opening (e.g. *"Just letting you know this call is
  recorded for quality."*) — continuing after the announcement counts as implied consent. The literal token
  `{{recording_disclosure}}` (the F17 per-client toggle's dynamic variable) is not referenced in any checked
  prompt today — the engine injects it but nothing in any stored prompt consumes it, confirming the toggle is
  currently a no-op until this wording lands somewhere. Source: 2026-07-04 market/compliance research
  (recordinglaw.com, sprintlaw.com.au). ~~Crazy Gary / Finance Strategist / Property Coach~~ — no action per
  Brendan 2026-07-07 (demo personas, out of compliance scope).

- [x] **PU-7 — Caller identification within ~30 seconds (voice, outbound; AU compliance check). CLOSED
  2026-07-07 — Main Outbound is clean-compliant (its restored dedicated agent `agent_f45f4dd…` opens *"Hey
  {{first_name}}, it's Gary, from Building Flow Digital - you put your hand up for some info on our AI setter
  service…"*, stating persona + company + a clear outbound purpose). Crazy Gary's borderline opener (no
  company/purpose stated) is explicitly out of scope per Brendan 2026-07-07 — it's a demo persona, not a real
  outbound campaign; no action needed unless that changes.

- [ ] **PU-5 — Stand up "Main Outbound V2" (voice).** A full new-prompt draft is ready:
  `Docs/archive/MAIN_OUTBOUND_V2_PROMPT_2026-06-16.md` (folds the Eddie/"Steven" structure into BFD V1: call-flow
  map, consent/AI-disclosure beat, path triage + goal hierarchy Book>Callback>Info, booking-failure ladder,
  post-booking prep, TTS formatting, rapport). Stand it up yourself via the BFD setter UI (duplicate Main
  Outbound → rename V2 → paste → Save+Push → canary publish), then send Claude a `call_id` for read-only
  verification. **This supersedes the older standalone "booking guardrail" voice item** (V2 includes it).

- [ ] **PU-12 — Inbound-unknown-caller robustness: never speak placeholders, de-outbound the opener (voice,
  demo line first, worth mirroring in all setters). PART (1) CONFIRMED ALREADY DONE, PART (2) CONFIRMED STILL
  NEEDED — 2026-07-07 (Session P1 live verification).** _(Renumbered 2026-07-07 from a duplicate "PU-8" id —
  this item is unrelated to the voicemail-placeholder PU-8 above; found in the same 2026-07-05 line-health
  check.)_ **Part (1), name-free direction-neutral opener, is DONE:** the Inbound BFD Agent's live
  `begin_message` is now *"Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital. Just so you
  know, this call is being recorded for quality. What can I help you with?"* — no `{{first_name}}`, already
  name-free and direction-neutral. **Part (2), the specific "never speak a placeholder" guard, is still
  missing** — the general_prompt has a good general fallback ("When dynamic variables are EMPTY (common on
  inbound calls)" — look up by `call.from_number`, never guess), but a text search for "SMS Lead" and "looks
  like a placeholder" across all 6 agents returned zero hits, so the exact failure mode below is not yet
  guarded. **Remaining action:** add to SETTER CORE (on the Inbound BFD Agent — the one that answers the demo
  line): *"If a lead detail (name, business) is empty, unknown, or looks like a placeholder or a system value
  (for example 'SMS Lead'), never say it aloud: speak without a name and ask naturally who's calling."*
  Original evidence below. Evidence: inbound calls to the dogfood number
  (+61 481 614 530) Jun 17-23 show the answering agent (Voice-Setter-Test v22 per the call records; number-vs-agent
  caveat above noted) speaking literal `{{first_name}}` aloud ("I've got you down as {{first_name}}") and using the
  CRM fallback "SMS Lead" as a spoken name. A Jun 26 prompt patch (empty-string defaults + an inbound-fallback
  section) exists but is UNVERIFIED: zero calls since. Two report-only changes for whichever persona answers the
  demo line: (1) the `begin_message` is outbound-shaped ("Hey {{first_name}}, ... you put your hand up for some
  info...") which for an unknown inbound caller renders as "Hey , ..." plus a false claim; make it name-free and
  direction-neutral (e.g. *"G'day, Gary here at Building Flow Digital. How's it going?"*) and let the persona use
  the name later only once known. (2) Add to SETTER CORE: *"If a lead detail (name, business) is empty, unknown,
  or looks like a placeholder or a system value (for example 'SMS Lead'), never say it aloud: speak without a
  name and ask naturally who's calling."* Verify via the two-number regression test queued in
  `/srv/bfd/Operations/needs-brendan.md` (one call from a known number, one from a number not in the CRM). The
  booking backend is independently healthy (2026-07-05 read-only `get-available-slots` probe returned real
  Sydney slots). Source: 2026-07-05 Gary line health check (call records `call_7250ce...`, `call_c4922c...`).

- [ ] **PU-9 — Kill the dead air while the voice agent looks up bookings (voice, config + tool wording).** Found 2026-07-06 (B1 answered call): the agent goes silent for a beat while a booking tool hits GHL. The anti-dead-air settings are ALREADY on and good — `ambient_sound: "call-center"`, `enable_backchannel: true` (freq 0.7), `model_high_priority: true`, and every booking tool has `speak_during_execution: true` with a filler. **Root cause:** each tool's `execution_message_description` caps the spoken filler at "under 10-12 words" (~2 sec of speech), but the GHL round-trip takes ~3-8 sec → silence after the short line (only partly masked by the ambient noise). `speak_after_execution: false` on book/cancel/update also adds a ~1.3 sec LLM delay after the result before the confirm. **Apply via the Retell dashboard / BFD setter UI (per voice setter):** (1) **lengthen** each GHL-hitting tool's `execution_message_description` to a multi-beat ~20-30 word line that keeps talking through the wait, e.g. book-appointments → *"Perfect, locking that in for you now… just syncing it across to Brendan's calendar, give me a couple of seconds."* (2) set **`speak_after_execution: true`** on book/cancel/update with a short canned confirm so the agent speaks the instant the tool returns. (3) **Talk-track bridges** to weave in while a tool runs: recap what they said (*"While that syncs, you mentioned 30-40 leads a week, solid base to build on"*), set the strategy-call value, micro social-proof, a prep question (*"While this loads, what's the one outcome you'd love from the call?"*), or confirm the invite email. **Backend note (deferred build, NOT a prompt item):** the deeper fix for slow lookups is trimming GHL latency in `voice-booking-tools` (frozen) — cache/pre-warm availability; logged for a later session. Live agent read confirmed on `agent_b2f6495…` / `llm_9dd6af77…`. Priority Medium.

- [ ] **PU-10 — Reschedule/cancel: list first, and never confirm without a real success (text; pairs with CODE fix RESCHED-SMS-1).** Found 2026-07-06 (SMS leg): on a reschedule the fast text model called `get-available-slots` instead of `get-contact-appointments` before `update-appointment` (so the eventId binding refused it), and once said *"I've moved your Friday call to 3pm, all set"* while calling no mutation tool — a false confirmation. Prompt half (report-only): in the text setter's reschedule/cancel guidance, be explicit that it must call **`get-contact-appointments`** (not get-available-slots) to load the real appointment before any change, and must **only confirm "moved / cancelled / done" after the tool actually returns success** — if the tool is refused or errors, say so and re-list, never claim it worked. The load-bearing half is the code guard (BUG_LIST RESCHED-SMS-1); this is the persona-side reinforcement. (Note the report-only boundary: this is honesty/flow wording, not a booking MECHANIC.) Priority Medium.

- [ ] **PU-11 — Live-transfer prompt line (voice; pairs with F16(d) live-transfer config). GAP IS BIGGER THAN
  ORIGINALLY SCOPED — confirmed 2026-07-07 (Session P1 live verification): the tool itself doesn't exist on
  any agent yet, not just the prompt line.** Checked `general_tools` on all 6 canonical agents: **none of
  them have a `transfer_call` tool configured** (all 6 share the identical 8 tools — end_call,
  update-appointment, get-available-slots, book-appointments, cancel-appointments, get-contact-appointments,
  send-sms, schedule-callback — zero transfer tooling). The engine (retell-proxy) will pass a `transfer_call`
  tool through untouched if one is configured, but doesn't create one automatically. **Two steps needed, in
  order, per voice setter that should transfer:** (1) **first add the tool itself** via Prompt Management →
  the setter's Voice/Retell settings → Tools → add the `transfer_call` tool with a real destination number;
  (2) **then** add the prompt line so the agent actually offers it, e.g. *"If the caller clearly asks to speak
  to a human, or you can't help, offer to connect them and use the transfer_call tool."* Keep it natural.
  **Related deferred build (NOT a prompt item):** the "SMS a context-summary to the human on a FAILED
  transfer" fallback was NOT built — the Retell failed-transfer signal needs live confirmation before shipping
  an auto-SMS from `retell-call-analysis-webhook`; logged for a later Voice session. Priority Medium.

## Superseded by code (kept for the record)

- [~] **PU-2 — BOOK-1 text-setter anti-fabrication / booking rules (text) — now CODE-OWNED, do not add to the
  stored prompt.** Originally (2026-06-30) a report-only tweak to add "never invent scarcity / always call
  get-available-slots / book the exact accepted time" rules to `text_prompts.system_prompt`. As of
  **PROMPT-AUTH-1** these are owned code-side (`setterTools.ts` `TOOL_USAGE_INSTRUCTION` + the injected
  availability block + the slot-binding validator) and the stale booking blob is being *removed* from the
  stored prompt via the Setter-1 migration. **Do NOT re-add these rules to the stored persona** — that would
  re-introduce exactly the redundant, drift-prone content this whole effort deleted. Left here so the history
  is traceable; no action. Source: BUG_LIST BOOK-1 / PROMPT-AUTH-1.

## Verify-only (reported applied; confirm behaviorally, don't re-edit)

- [ ] **T10b inbound "ask for details" (voice)** — the inbound path should NOT re-ask for name/email when the
  caller matches a known lead (dynamic vars are preloaded); keep a fallback for unknown/withheld callers. A
  2026-06-16 live read found no anti-pattern; confirm on a live inbound call that Gary greets by name and does
  not re-ask. No edit unless the live call shows the anti-pattern.
