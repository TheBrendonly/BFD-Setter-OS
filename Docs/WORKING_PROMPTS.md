# Working Prompts (paste at session start)

Two reusable prompts for driving this project. Prompt 1 = what *Claude* should build/fix next. Prompt 2 = what *you (Brendan)* must do to reach 100% live.

---

## Prompt 1 — Backlog sweep (Claude's work to choose from)

```
Sweep this entire project for everything that still needs DOING by you (Claude) and give me ONE prioritized list to choose from. Do not just trust the docs — VERIFY each item against the live state (code, DB via SUPABASE_PAT, edge-fn versions, git) and exclude anything already done.

Scan all of these sources:
- Docs/ROADMAP.md: the "Claude to-do" master list, every "Deferred" note, the "Future feature" sections, and all SESSION LOG follow-ups.
- The newest file in Operations/handoffs/ and the project memory (MEMORY.md + notes).
- Code markers across frontend/src, frontend/supabase/functions, trigger/: TODO / FIXME / HACK / "DEPRECATED" / "DEFER".
- Known issues: the ~24 pre-existing tsc errors (cd frontend && npx tsc -p tsconfig.app.json --noEmit), multi-tenant isolation hardening (ROADMAP P4), docs gaps, the campaign-level voice-setter default, A/B testing.
- Anything I flagged in recent sessions that isn't built yet.

Output ONE numbered table grouped as: (A) BUGS, (B) IN-FLIGHT BUILDS (code-complete but not deployed/verified), (C) FEATURES (deferred + future), (D) TECH DEBT / CLEANUP. For each row: one-line description, where it's tracked (file/doc), size (S/M/L), risk (low/med/high), dependencies/blockers, and whether it needs me (Brendan) for anything.

Guardrails (do not violate): verify every "dead code" claim before proposing deletion (the audit was wrong 3x); never break the live main-form lead flow; keep changes backward compatible; do NOT unilaterally edit prompt/message content; types.ts is multi-DB so never wholesale-regenerate (surgical adds only); deploy via SUPABASE_PAT + scripts/deploy_*.mjs (Management API needs a browser User-Agent); push to github + origin.

End by asking me to either pick item numbers, or say "do all" — in which case sequence them safely, deploy + verify each, and update ROADMAP + memory + a handoff as you go.
```

---

## Prompt 2 — Path to 100% (Brendan's to-do)

```
Pull EVERYTHING that requires ME (Brendan) — the human-only actions you can't do — into one actionable checklist to take this project to 100% live / production-ready. Verify against the live state and exclude anything already done or anything you (Claude) can do yourself.

Scan:
- Docs/ROADMAP.md "Brendan-only list" + every [YOU] marker.
- The newest Operations/handoffs/ doc (its "Brendan to-do" section), and Docs/GHL_SETUP.md, Docs/PERSONA_SETUP.md, Docs/FORM_ROUTING.md.
- Memory feedback notes (provisioning rules, phone-collision rule, no-prompt-edits rule, env-var audits, test-phone permission).
- Current blockers on me: GHL forms/automations/tags wiring; Retell/Twilio agent + number provisioning; prompt/persona content (Duplicate + "Modify with AI"); activating cadences (e.g. the Try-Gary persona campaigns are cloned + INACTIVE with TODO voice sentinels); phone / ghl_location_id collision remediation; Railway + Trigger.dev env vars; end-to-end tests.

Output a checklist grouped as: (1) GHL config, (2) Retell/Twilio provisioning, (3) Prompt/persona content, (4) Activation, (5) Testing & verification, (6) Anything else. For each: [ ] what to do, why it's needed (what it unblocks), and the exact thing to check when it's done. Link the written guide where one exists. Mark the CRITICAL PATH (what must happen, in order, before the first live Try-Gary call works).

Finish with the single most important next action.
```

---

Usage: paste Prompt 1 when you want to drive Claude's build queue; Prompt 2 when you want your own punch list. Both are designed to verify-before-listing so they stay honest as the project evolves.
