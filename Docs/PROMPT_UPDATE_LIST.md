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

---

## Open

- [ ] **PU-8 — Voicemail message says a literal "[Your Name]" placeholder (voice).** Found in the TEST SESSION
  2026-07-05 voice run: on an unanswered outbound call the pushed voicemail landed and the agent left a message,
  but it said *"Hi Brendan, this is **[Your Name]** calling. I wanted to discuss an important update…"* — the
  `[Your Name]` placeholder is never substituted, so the agent literally speaks it. Same class as the
  `{{first_name}}` opener issue but for the AGENT's own name. Fix in the voicemail/opener persona: replace
  `[Your Name]` with the actual setter name (e.g. "Gary") or the correct dynamic variable, on every voice setter
  whose voicemail is used. (VM-1 push + playback themselves now WORK — v48 fix verified; this is purely the
  spoken placeholder.) Report-only; apply via Prompt Management. Priority: medium (a live-sounding voicemail is
  the point). Spot-check all 5 voice setters for the same `[Your Name]` / bracketed placeholders.

- [ ] **PU-1 — Confirm the timezone with the lead when offering/booking (both).** The setter should name the
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

- [ ] **PU-4 — Property Coach company-name placeholder (voice).** Live `Gary - Property Coach` COMPANY FACTS
  still reads `[Your Property Coaching Company Name] = "Building Flow Property"` with an explicit "(Config note
  for Brendan: the company-name field is still the placeholder…)". Set the real company name, remove the
  placeholder bracket, and delete the config note. This was flagged (2026-06-16 live read) as the only
  confirmed still-open voice prompt item. (llm ref `llm_112c2353`.)

- [ ] **PU-3 — Personalize the outbound opener with `{{first_name}}` (voice, 6.8).** On OUTBOUND calls to known
  leads, greet by name: *"Hey {{first_name}}, this is Gary, I'm Brendan's AI assistant at Building Flow
  Digital…"*. `{{first_name}}` is a live dynamic var. **CAUTION:** the opener is shared inbound+outbound; on
  INBOUND (unknown caller) `{{first_name}}` is usually empty → "Hey , this is Gary" sounds broken. Add it only
  on a dedicated OUTBOUND opener/path, or guard it. Parked for your next Retell prompt sweep. Source: BUG_LIST
  6.8.

- [ ] **PU-6 — Call-recording disclosure line (voice, ALL setters; AU compliance).** NSW, WA and SA require
  ALL-PARTY consent to record calls, and Retell records calls. Add a short disclosure near the top of every
  voice setter's opening (e.g. *"Just letting you know this call is recorded for quality."*) — continuing
  after the announcement counts as implied consent. Apply via the UI to the canonical set (Main Outbound +
  the 4 Garys + the inbound agent). The per-client disclosure TOGGLE (engine-side) is feature F17 phase 1;
  the wording itself is this item. Source: 2026-07-04 market/compliance research (recordinglaw.com,
  sprintlaw.com.au).

- [~] **PU-7 — Caller identification within ~30 seconds (voice, outbound; AU compliance check).** The
  Telemarketing Standard requires outbound calls to state name, company, and purpose within ~30 seconds.
  **Read-only check DONE 2026-07-04 (Claude, live Retell `begin_message`):** **Gary - Property Coach** is
  COMPLIANT — opener = *"Hey {{first_name}}, it's Gary, from Building Flow Property, giving you a quick call
  about the property info you requested. Got a sec for a chat?"* (persona + company + purpose all present).
  **⚠️ Gary - Crazy Gary needs attention IF used for real outbound** — opener = *"G'day {{first_name}}, it's
  Rusty Bumblethorpe here, your AI assistant, and oh, do I have stories. What can I dazzle you with today?"*
  — names the persona + discloses AI but states **no company and no clear purpose**. **Your action (only if
  Crazy Gary is used for genuine outbound telemarketing, not just a demo/novelty persona):** add a company +
  brief purpose to its opener via Prompt Management. If it's demo-only, no change needed — just confirm it's
  not on a live outbound campaign. (Not yet checked: Finance Strategist, Mortgage Broker, Main Outbound /
  Voice-Setter-master — same one-line check applies; verify on your next Retell sweep.) Source: 2026-07-04
  compliance research (waboom.ai).

- [ ] **PU-5 — Stand up "Main Outbound V2" (voice).** A full new-prompt draft is ready:
  `Docs/archive/MAIN_OUTBOUND_V2_PROMPT_2026-06-16.md` (folds the Eddie/"Steven" structure into BFD V1: call-flow
  map, consent/AI-disclosure beat, path triage + goal hierarchy Book>Callback>Info, booking-failure ladder,
  post-booking prep, TTS formatting, rapport). Stand it up yourself via the BFD setter UI (duplicate Main
  Outbound → rename V2 → paste → Save+Push → canary publish), then send Claude a `call_id` for read-only
  verification. **This supersedes the older standalone "booking guardrail" voice item** (V2 includes it).

- [ ] **PU-8 — Inbound-unknown-caller robustness: never speak placeholders, de-outbound the opener (voice,
  demo line first, worth mirroring in all setters).** Evidence: inbound calls to the dogfood number
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
