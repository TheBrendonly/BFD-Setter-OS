# CLAUDE.md

This file provides project-specific guidance to Claude Code when working in this repository.

## Tracking & Session Workflow (read first)

`Docs/SESSION_PLAN.md` is the single source of truth for the session sequence to v1 "100%" and carries the **Relay Protocol** every session follows (start → do scoped work → verify → close out + emit the next prompt). The detail behind each session lives in **6 canonical lists** (do not duplicate work-tracking elsewhere):

- `Docs/BUG_LIST.md` — open bugs / behavior fixes (Claude builds)
- `FEATURE_ROADMAP.md` (repo root) — feature build queue
- `Docs/BRENDAN_TODO.md` — manual/UI actions only Brendan can do
- `Docs/TEST_LIST.md` — things to live-verify after a build
- `Docs/DEFERRED.md` — someday / gated (v2: lifecycle, A/B, HubSpot, analytics)
- `Docs/PROMPT_UPDATE_LIST.md` — prompt-content edits Brendan applies via the UI (report-only; kept separate from code work)

Closed items move to `Docs/archive/COMPLETED_LOG.md`. `Docs/ROADMAP.md` is build **history** (not an active to-do list). Reconciliation context: memory `project_list_doc_reconciliation_2026_06_25`.

**TEST SESSION.** When Brendan says **"run test session" / "let's run test session" / "test session"**, read `Docs/TEST_SESSION.md` and execute it. That is the consolidated runbook: it batches every open `Docs/TEST_LIST.md` item into the fewest live runs (one voice-call session, one SMS session, one agency↔client login pass, one cadence/follow-up pass, one by-phone/GHL-outage pass, etc.), starts with a self-verify-state step (don't trust doc git-logs/versions), lists the pre-authorized test write-actions, ends with **RUN 9** (the Brendan manual checklist) + **RUN 10** (the self-chaining relay of the next-session prompts: T-fix → Session S → F15 → F16 → gated First-Client Milestone), and closes out per the Relay Protocol. `Docs/TEST_LIST.md` remains the source of truth for pass/fail bookkeeping. To run any downstream session, paste its prompt from `Docs/TEST_SESSION.md` RUN 10.

**FIRST-CLIENT ONBOARDING.** When Brendan says **"I'm onboarding a client" / "onboarding a client" / "first client signed"**, read `Docs/FIRST_CLIENT_MILESTONE.md` and run its prompt. It is event-gated (flips Stripe / subscription enforcement / live webhook secrets / AU A2P) — do NOT run it before a contract actually signs. It is the last step to v1 "100%".

## ⚠️ LOGIN ACCESS / 2FA - CHECK AT THE START OF ANY SESSION THAT MAY LOG IN (Playwright)

**Access is deliberately NON-PERSISTENT.** The BFD app agency login has TOTP (2FA), and Supabase's refresh token is single-use (rotates on every refresh) and expires ~17h. There is no standing test account and no committed credential. So:

- **If a session will (or might) need a browser-authenticated action** - any headless Playwright run against the live app, the browser-UI test re-checks (SWEEP-1a/b/c, F9-1, PHONE-CLEAR-1, ACCESS-1, G3-7 nav, the onboarding-fix live rows), or anything that reads/writes as the agency user in the UI - **ASK BRENDAN FOR A FRESH 6-DIGIT 2FA CODE AT THE START, before doing other work.** State plainly: "I'll need a 2FA code to drive the browser; please have your authenticator ready." Do not assume a saved session still works.
- **How the login works** (harness `scripts/test-harness/README.md`): admin `generate_link {type:"magiclink"}` (service key, no email sent) → navigate the `action_link` → the app demands the TOTP → fill Brendan's code → `context.storageState()` saved to the SESSION scratchpad. Reuse it for the rest of that session.
- **Never burn the token on a "is it still valid?" probe.** The first refresh CONSUMES the refresh token and returns a NEW one you MUST save, or the session dies. (This happened 2026-07-06.) Just drive through the browser, which refreshes auth itself, and re-save `storageState` after.
- **Client-role checks (e.g. ACCESS-1) do NOT need a code:** create a throwaway client user with a known password (admin `createUser`), log in via `grant_type=password` (fresh client users have no MFA), verify, then delete the throwaway.
- The saved `storageState.json` lives in the session scratchpad (NOT the repo) and does not carry across sessions - expect to re-auth each session that needs it.

## Behavioral Guidelines

Source: forrestchang/andrej-karpathy-skills. Behavioral guidelines to reduce common LLM coding mistakes. These bias toward caution over speed; use judgment on trivial tasks.

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them, don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it, don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

Test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]

Strong success criteria let the agent loop independently. Weak criteria ("make it work") require constant clarification.

Working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->

## Spec-Driven Development (spec-kit)

This repo is wired for GitHub spec-kit (v0.9.3). The spec -> plan -> tasks -> implement loop runs
through `/speckit-*` slash-command skills (in `.claude/skills/`); shared project memory and
templates live in `.specify/`.

- Constitution / principles: `.specify/memory/constitution.md` (fill or amend via `/speckit-constitution`).
- Core loop: `/speckit-specify` -> `/speckit-clarify` -> `/speckit-plan` -> `/speckit-tasks` -> `/speckit-implement`.
- Supporting: `/speckit-analyze`, `/speckit-checklist`. Git helpers: `/speckit-git-*`.
- `/speckit-taskstoissues` is GitHub-only and a NO-OP here (we use Forgejo `origin`).
- The Codex/Cursor/Gemini/Copilot spec-kit mirrors (`.agents/skills/`, `.cursor/skills/`, `.gemini/commands/speckit.*`, `.github/agents+prompts`) were removed 2026-06-10 (unused on this project). Claude Code (`.claude/skills/`) + `.specify/` are the only spec-kit surfaces here.
- Complementary to the workspace `/init` scaffolder: `/init` builds folder structure + repo + vault + ralph + the PRD/SOP; spec-kit adds the per-feature SDD loop on top. A project has one `/init` PRD and many spec-kit specs over its life.

## Voice Agent Prompts (Retell): Do Not Edit, Report Only

The voice agent prompts live in Retell and are managed by Brendan through the BFD setter UI. This is a hard rule, established 2026-06-06 after repeated revert churn:

- **Never edit a voice agent prompt directly.** Not on the Retell backend (dashboard, or REST PATCH / publish-agent), and not by authoring prompt-content changes in the repo prompt files (`frontend/src/data/bfdVoiceSetterPrompt.md`, `frontend/src/data/defaultBookingPrompt.ts`, and similar). Edits do not stick: the canonical save only happens through the BFD setter UI, so anything changed on the backend or in the repo gets reverted on the next push or recommit. Editing it causes more problems than it solves.
- **If you find a prompt or function issue** (a function not firing from Retell, a booking-flow flaw, wrong wording, and so on), report it to Brendan with specifics: the exact location and the recommended change. Brendan applies it in Retell / the BFD setter UI. Do not apply it yourself, even when the `.env` Retell key is available. Read-only checks against Retell are fine; writes (PATCH/publish) are not.
- **Ignore the phone number attached to an agent in Retell.** The BFD setter pushes a prompt onto a chosen agent and overrides the number at push time, so the number hardwired to an agent does not indicate which agent is live. Example: "Voice-Setter-Test" currently holds the dogfood number but is NOT in use.
- **Agents Brendan actively uses (canonical set):** Gary - Crazy Gary, Gary - Finance Strategist, Gary - Mortgage Broker, Gary - Property Coach, and Voice-Setter-master.
- **Repo and live Retell have drifted.** The repo prompt files, `.env`, and `scripts/deploy_voice_prompt.mjs` still reference a deleted LLM id (`llm_22e795...`). Do not treat the repo prompt files as the source of truth for what a live agent says. Read the live agent (read-only) or ask Brendan.
