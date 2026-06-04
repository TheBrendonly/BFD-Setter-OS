# AGENTS.md

This file provides project-specific guidance to AI coding agents working in this repository.
It is the cross-platform twin of CLAUDE.md (used by Claude Code) and applies to Cursor, GitHub
Copilot, Gemini CLI, OpenAI Codex, Windsurf, Aider, and other AGENTS.md-aware tools.

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
through `/speckit-*` commands/skills; shared project memory and templates live in `.specify/`.
Per-tool command files: Claude (`.claude/skills/`), Codex (`.agents/skills/` + this AGENTS.md),
Cursor (`.cursor/`), Gemini (`.gemini/commands/` + GEMINI.md), Copilot (`.github/` + `.vscode/`).

- Constitution / principles: `.specify/memory/constitution.md` (fill or amend via `/speckit-constitution`).
- Core loop: `/speckit-specify` -> `/speckit-clarify` -> `/speckit-plan` -> `/speckit-tasks` -> `/speckit-implement`.
- Supporting: `/speckit-analyze`, `/speckit-checklist`. Git helpers: `/speckit-git-*`.
- `/speckit-taskstoissues` is GitHub-only and a NO-OP here (we use Forgejo `origin`).
- Complementary to the workspace `/init` scaffolder: `/init` builds folder structure + repo + vault + ralph + the PRD/SOP; spec-kit adds the per-feature SDD loop on top. A project has one `/init` PRD and many spec-kit specs over its life.

## Cross-Platform Sync Note
This AGENTS.md is the twin of CLAUDE.md in the same directory (used by Claude Code).
If you update project workflows, file structures, or coding standards during your session,
please also update CLAUDE.md to keep both files in sync. Both files should always contain equivalent information.
