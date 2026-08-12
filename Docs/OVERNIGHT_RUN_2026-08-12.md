# OVERNIGHT RUN SPEC — 2026-08-12 (canonical for tonight's Claude Code session)

Authorized by Brendan 2026-08-12 as the single exception to the "zero new product code until a
pilot is paid" rule. Context: `Docs/RETELL_PIVOT_DECISION_2026-08-12.md` (read it first) and
`Docs/RETELL_PIVOT_VERDICT_2026-08-12.md` (full analysis).

**Precondition (Brendan, before kickoff):** rotate the Supabase PAT and put the fresh `sbp_*`
value in `/srv/bfd/Projects/bfd-setter/.env` as `SUPABASE_PAT`. Edge-function deploys are blocked
without it. If deploys fail on auth anyway, fall back to code+tests and say so in the handoff.

**Ground rules for the whole run**

- `npm test` green (baseline 453) before ANY deploy. Frontend changes verified by the headless
  render smoke (memory `feedback_frontend_verify_render_smoke`) — never trust tsc/vite build.
- Never edit voice/text prompt CONTENT (standing rule). Never touch a slot where
  `voice_setters.is_retell_locked = true`. No new `clients` rows. No live SMS sends, no live
  outbound calls.
- Retell writes: only against the BFD tenant (`e467dabc-57ee-416c-8831-83ecd9c7c925`) spare slots
  (slot 1 NEVER — SLOT-MAP-1). Reads are safe anywhere.
- If blocked > 30 min on one item: write the blocker to the handoff, move to the next item. Never
  leave `main` broken; commit per-item, deploy per-item.
- Deploys: edge functions via `node scripts/deploy_single_fn.mjs <fn>`; frontend via
  `git push github main` (Railway) only AFTER render smoke passes.

---

## Item 1 — Full-fidelity Retell snapshot + restore (CORE, do first)

**Why:** the ratified workflow shapes agents in Retell's dashboard; the known-good config must be
archivable in BFD's DB with one click, and restorable. Today `pull-retell-config`
(`frontend/supabase/functions/retell-proxy/index.ts`, case `pull-retell-config`) stores a THIN
snapshot: prompt presence/char-count, tool NAMES only. That detects drift but cannot rebuild.

**Build:**

1. Widen the snapshot to store VERBATIM: `general_prompt`, `begin_message`, the full
   `general_tools` array, `model`, `model_temperature`, `knowledge_base_ids`,
   `default_dynamic_variables`, `start_speaker`, plus agent-level fields already captured (voice,
   language, webhook, voicemail, version, is_published) — and for conversation-flow agents the
   full flow JSON. Add `schema_version: 1` and keep `pulled_at`.
2. **Backward compat is mandatory:** keep every existing thin field with identical semantics —
   `computeDriftState` (`trigger/_shared/retellDrift`) and `pollRetellDrift.ts` read them. Their
   tests must stay green untouched.
3. Add a `restore-retell-config` action to retell-proxy: takes clientId + slotNumber, re-pushes
   the stored snapshot through the existing draft→publish path (`ensureEditableAgentDraft` →
   PATCH LLM → `publishAgentVersion` → `repointPhoneVersionsAfterPublish`). Must be tolerant of
   Retell schema drift: on a 400, strip unknown/renamed fields and retry once; report what was
   dropped in the response. Respect the F9 lock (restore onto a locked slot requires
   `force: true` param, and clears then re-sets the lock flags the way pull does).
4. Minimal UI: the existing Pull button flow should surface "full snapshot saved (vN)"; add a
   Restore affordance only if trivial — otherwise leave restore API-only and note it.
5. Tests: Deno tests for pull (fat fields present, thin fields unchanged) and restore (happy
   path, 400-strip-retry path, lock guard). Node tests confirming drift logic unaffected.

**Deploy + verify:** deploy retell-proxy; run a REAL pull against a BFD-tenant slot with an agent
(read-only, safe) and paste the resulting snapshot shape (redact prompt text to first 80 chars)
into the handoff. Do NOT run a live restore against a locked/live agent — restore verification is
Deno-test-level tonight, live test is Brendan's on Thursday.

## Item 2 — Voice→text clone transform

**Why:** ratified flow step 6 — perfect the voice agent, then clone it to the text setter. The
cross-channel copy (`CopySetterDialog.tsx` + `duplicate-setter-config`) adapts PARAMETERS, but a
Conductor-shaped / doc-model voice prompt is free text, so parameter adaptation likely has nothing
to adapt.

**Build:**

1. First TRACE the actual behavior: what does a cross-channel copy produce today when the source
   voice setter is doc-model (post-2026-06-12) free text? Write the finding down before coding.
2. If (as expected) the result is unusable or lossy, build the transform: a server-side AI job
   (follow the `modify-prompt-ai` / `runAiJob` patterns, OpenRouter via the client's key) that
   converts a voice doc prompt → a text setter prompt: strip voice-isms (backchannel, pacing,
   tool filler lines, "say/sound" directions), swap the 5 voice booking tools for the text
   booking approach (`DEFAULT_BOOKING_PROMPT` in `frontend/src/data/defaultBookingPrompt.ts`),
   apply SMS style rules (short replies, casual per the existing text templates), and PRESERVE
   COMPLIANCE LINES VERBATIM (AI disclosure, NCCP guardrail). Output goes through
   `lintTextSetterPrompt` (`_shared/promptLint.ts`) and is written via the existing
   `save-external-prompt` path to the target text slot.
3. Wire it into the existing cross-channel copy path (extend `duplicate-setter-config` or a new
   edge function invoked by it) so the UI flow stays "Copy → pick text slot".
4. Tests: transform unit tests with a fixture voice prompt (build one from
   `frontend/src/data/bfdVoiceSetterPrompt.md`) asserting: compliance lines byte-identical, no
   voice booking tool names in output, lint passes. No live sends anywhere.

**Acceptance:** cloning base Gary (voice) to a spare TEXT slot on the BFD tenant produces a
lint-clean text prompt with compliance intact. Screenshot/paste the diff summary in the handoff.

## Item 3 — Hygiene rides (small, low risk)

1. **Delete `frontend/src/components/PersonalityConstructor.tsx`** (729 lines). Verified
   2026-08-12: zero imports; only reference is the comment at `AgentConfigBuilder.tsx:27`.
   Re-verify with grep, delete, render smoke.
2. **Consolidate `findOrCreateGhlContact` into `_shared`** — 3 copies exist (see TickTick
   2026-08-11 note / grep the functions dir). One shared impl + the 3 call sites re-pointed +
   tests. Deploy the affected functions.

## Item 4 — Documentation alignment (do LAST, reflects what actually shipped)

1. Rewrite `SOP/DEMO_PROSPECT_SETUP.md` step 3 and `SOP/PERSONA_SETUP.md` step 1/3 to the
   Conductor workflow (push template → F9 lock → Conductor in dashboard → QA incl. the three
   extra checks → full-fidelity Pull). Mark both: "ratified 2026-08-12; first live run pending".
   Keep the Modify-with-AI instructions as a collapsed 'legacy path' appendix (the per-section
   Sparkles still works; the top-bar button is dead + backlogged).
2. Update `.claude/skills/demo-prospect` the same way.
3. `SOP/CLIENT_ONBOARDING_SOP.md` §2.2/§4.3: add one paragraph pointing at the decision record
   for how persona shaping now works; do not restructure the SOP.
4. Update `Docs/TEST_LIST.md` with the live-verify items for Brendan (below), and close out via
   the Relay Protocol: handoff to `Operations/handoffs/2026-08-12-overnight-run.md`, overwrite
   `Docs/NEXT_SESSION_PROMPT.md`.

## Handoff must include (Brendan reads this Thursday)

- Per-item: done/partial/blocked, commits, what deployed, test counts before/after.
- The real pulled snapshot shape from Item 1's live verify.
- The voice→text trace finding + fixture diff from Item 2.
- Anything needing TickTick updates (greenserver has no TickTick MCP — Brendan/Cowork syncs).
- Live-verify checklist for Brendan: one real Pull from the UI, one restore on a throwaway slot,
  one voice→text clone from the UI, render smoke visual pass.

## Explicitly OUT of scope tonight

Modify-with-AI button fix (backlogged) · demo_prospects table automation (gated, SOP §7) ·
retiring any AI-editing components (gated on trigger) · anything touching live prospect demos
(Stapleton) · prompt content edits · Stripe/billing/first-client items.
