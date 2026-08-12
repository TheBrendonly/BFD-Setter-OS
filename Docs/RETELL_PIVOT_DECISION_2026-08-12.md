# DECISION RECORD — Retell pivot → "Conductor workflow" (ratified 2026-08-12)

Brendan ratified this in the 2026-08-12 Cowork session after a full research pass on Retell's
current capabilities and a component audit of this repo. Full analysis:
`Docs/RETELL_PIVOT_VERDICT_2026-08-12.md`. Overnight build spec: `Docs/OVERNIGHT_RUN_2026-08-12.md`.

## The decision

**Half pivot.** BFD-setter stays the system of record and the push/pull machinery. Retell's
dashboard + Conductor (their AI copilot, launched 2026-06-29, dashboard-only, NO API) becomes the
standard workbench for shaping VOICE personas. The full pivot (retiring the prompt infrastructure
wholesale) was rejected: the deletable surface is ~3k lines, not 24k, and the biggest files
(`retell-proxy`, `PromptManagement`) are what the workflow *needs*.

## The ratified voice-persona workflow

1. **Push a template from BFD** — prompt base + the 5 booking tools (per-client URLs +
   `intake_lead_secret`) + voice/LLM settings, via `sync-voice-setter`. Already built.
2. **F9-lock the slot** BEFORE any dashboard work — an unlocked slot gets dashboard edits
   clobbered by the next BFD push (doc-model push sends text verbatim).
3. **Shape in Retell with Conductor** — one large prompt carrying the client's info (site facts,
   niche, persona rules). Gets ~95% there. Compliance lines (AI disclosure, recording disclosure,
   NCCP guardrail) must be instructed to stay VERBATIM.
4. **Tweak + QA** — listen check per `SOP/DEMO_PROSPECT_SETUP.md` step 6, PLUS: (a) compliance
   lines word-for-word intact, (b) 5 booking tools present, (c) after any dashboard publish,
   verify the phone isn't pinned to an old agent version (dashboard publishes do NOT run
   `repointPhoneVersionsAfterPublish`).
5. **Pull Retell Config** — archives the known-good agent into
   `voice_setters.retell_config_snapshot` (full-fidelity as of the 2026-08-12 overnight build).
6. **Clone voice → text** — once the voice agent is working well, clone it across to a text
   setter on the BFD side (voice is the hard side; text follows). Text can NEVER live in Retell:
   Retell SMS is US-A2P-only and has no cadences; the native text engine is permanent.

## Key verified facts (2026-08-12)

- Conductor: builds/edits/tests agents from plain English; dashboard-only, no API; free tier 4k tokens.
- Retell API: full CRUD for agents/LLMs/conversation-flows; `get-retell-llm` returns the complete
  prompt + tool definitions; published versions immutable → full round-trip is API-possible.
- No template API; dashboard templates only. BFD's template library + push IS the API equivalent.
- Retell SMS: US-only A2P, no drip cadences → AU text stays BFD-native forever.
- Retell multi-tenancy: none client-facing (org-wide RBAC only). Fine — this was never self-serve.

## What must stay BFD-native regardless

Booking tool injection (per-client URLs/secrets), the SMS cadence engine + STOP/quiet-hours/opt-outs,
lead ingress (GHL webhooks, intake-lead), usage metering/billing, credential vault + tenant boundary,
phone provisioning + version repointing, drift monitoring (`pollRetellDrift`), the compliance review
process (diff/lint) wherever authoring happens.

## Gated — do NOT do before trigger

Trigger = first paid pilot, or 3 consecutive personas where Conductor beat the old path.

- Retire the voice paths of `MiniPromptAIDialog` / `PromptAIChatPanel` / `modify-prompt-ai`
  (the TEXT paths stay — Conductor can't author text).
- Strip `AgentConfigBuilder` / `voiceSetterConfigParameters` / `SetterParameterField` beyond
  setup-only.
- `AIPromptDialog` dead-var fix: BACKLOGGED by Brendan 2026-08-12 (TickTick) — manual paste
  workaround stands; text-side only when revisited.
- `demo_prospects` table automation (SOP/DEMO_PROSPECT_SETUP.md §7): still gated on the demo
  motion validating, before prospect #5.

## Status of the standing "zero new product code until a pilot is paid" rule

Brendan granted ONE exception on 2026-08-12: the overnight run specced in
`Docs/OVERNIGHT_RUN_2026-08-12.md` (full-fidelity snapshot + voice→text transform + hygiene +
docs). Nothing else is exempt.
