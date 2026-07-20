---
description: Durable kickoff prompt for the NEXT BFD-setter build session (authored 2026-06-15, post comprehensive build). Paste the PROMPT block to start. Includes the gated/ungated build backlog AND a standalone A/B-testing RESEARCH brief. Kept in Docs/ (not handoffs) so it is not regenerated/overwritten.
---

> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---

# Next Session Build Kickoff (2026-06-15)

Paste the block below to start the next build session at `/srv/bfd/Projects/bfd-setter`. This doc lives in `Docs/` on purpose so it survives handoff regeneration.

---

## PROMPT (copy from here)

```
Next BFD-setter build session. The 2026-06-15 comprehensive build shipped (HEAD 68433af on main, both remotes; Trigger v20260614.2). Read these first, in order:
- Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-15.md  (THIS doc: backlog + the A/B research brief at the bottom)
- Operations/handoffs/2026-06-15-comprehensive-build.md  (what shipped, report-only items, smoke list)
- memory: project_comprehensive_build_2026_06_15, retell-conversation-flow-eval-2026-06-11, voice-latency-root-cause, no-internal-prompt-edits, verify-before-moving-on
- ~/.claude/plans/you-did-a-really-cozy-summit.md (full catalogue: roadmap is section 7)

BEFORE writing code: confirm which of MY gated live-tests have landed (pause/resume E2E, the outbound repoint + live call on cadence 40e8bea3, the CF pilot) and which provisioning items are done (Retell/Unipile secrets, AU A2P, phone inbound_webhook_url, PROBE_* env, Supabase Pro). Skip-and-flag anything not done; do not block the build on it.

Then propose a staged plan and get my approval before anything structural.

Constraints (unchanged): voice prompt content is mine only - report issues, never edit Retell or repo prompt files. Deploy edge fns with `SUPABASE_PAT=… node scripts/deploy_single_fn.mjs <slug>` (or deploy_with_shared.mjs); new functions need verify_jwt=false. Migrations via the Management API SQL runner + a committed .sql file. Trigger.dev via `npx trigger.dev@4.4.4 deploy` (TRIGGER_DEPLOY_PAT, proj_fdozaybvhgxnzopabtse, env prod). App is multi-DB so surgical types.ts only. Verify every stage (tsc + deploy + a server-side check) then hand me a UI smoke list. Commit + push per chunk. No em dashes in any written output.

Scope for this session (confirm/adjust with me):

1. GATED on my live tests (do only after I confirm):
   - Retire the legacy outbound direction columns + inbound-only directions UI (after the outbound repoint + live call on 40e8bea3 passes). This is rearchitecture (a): kill DIRECTION_TO_AGENT_COLUMN + retell_*_agent_id, move direction ownership onto voice_setters; high blast radius - plan it first.
   - CF fleet rollout tooling + the retell-proxy single-prompt/CF engine-adapter refactor (rearch b), only after the CF pilot passes its A/B gate.

2. UNGATED (pick with me):
   - Full schema-drift reconcile pass (the 6 referenced-but-missing tables: messages, payment_attempts, simulation_analysis_messages, supabase_usage_cache, sync_ghl_executions, sync_ghl_booking_executions; and engagement_executions.ghl_contact_id not renamed to lead_id). Investigate each before touching.
   - N5 stale-template cleanup: decide keep-or-kill on the legacy n8n/Retell-agent JSON templates in frontend/public/* (old n8n + railway hosts, deleted llm_22e795 id) and the orphan/_archived Webinar components. Report first, edit only what I approve.
   - Review polish: cost-ceiling breach-log throttle, orphaned-UUID badge in the voice-setter picker, B6 success_rate rename (is_successful_call), inbound-webhook observability log.
   - Roadmap section 7 features as I call them (A/B testing 3.1 - see the research brief below FIRST; multi-workflow enrollment state machine 3.5; long-tail nurture 3.6; behavioral re-warm 3.7; tz-aware nudge cron 3.10). D5 custom SMTP once I pick Resend.

3. RESEARCH (not build) - do this one when I say so: the A/B testing research brief at the bottom of this doc. Spin up sub-agents, produce a report, do not build.
```

## (end of prompt)

---

## RESEARCH BRIEF: A/B testing for agents + workflows (research only, not build)

Note for the agent: this overlaps the existing roadmap item 3.1 (A/B testing, "designed, not built") in `FEATURE_ROADMAP.md` and `~/.claude/plans/you-did-a-really-cozy-summit.md`. Reconcile with that prior design, go deeper, and supersede it where your research finds a better path. Deliver a written report (do NOT build).

Brendan's ask:

I want to look into the best way to do A/B testing with my agents and workflows. This is a research task, not a build task: look at viability, how it would be built, and how it affects the rest of the product. Spin up sub-agents, do real research, and then give me a report with your recommendation and the best way to implement it.

There are two phases to the concept:

1. Initial A/B testing phase. The ability to set up an A/B test comparing two slightly different variants of either a campaign and/or an agent setup. When a test is active, incoming leads alternate between the two variants. Research the best way to scope this: should it be a fixed timeframe, a fixed lead count, or open-ended, and how do we then read the analytics to judge which variant performs best (and on what metric: reply rate, booking rate, show rate, cost per booking). Cover statistical validity (sample size, when a result is trustworthy vs noise) at the volumes a single client realistically runs.

2. AI evaluation phase. On a schedule (weekly or monthly, you recommend), an AI reviews the analytics for the running A/B test, judges which variant is winning, and proposes what the next phase of testing should be (e.g. promote the winner, then test a new variation against it). Essentially an iterative, AI-guided optimisation loop.

What the report should cover:
- Viability and whether this is worth building for the current product stage.
- The data model and mechanics: variant assignment (round-robin vs sticky-by-lead-hash), where the arm is stamped, how results are compared, and how it fits the existing campaign/voice_setters/cadence model (reuse what exists; e.g. the tag-per-campaign resolver, voice_setter overrides, cadence_metrics, the analytics pipeline).
- The three layers from the prior 3.1 design (campaign-level, agent-level, AI-generated variants) and whether to keep that framing.
- Blast radius: what it touches (resolver rotation, the partial-unique campaign index, analytics, UI) and the risk to the live main-form flow.
- The AI-evaluation loop: what data it reads, how it judges significance, cadence, and how its suggestions surface to me (report-only suggestions vs auto-promote). Honor the rule that voice-agent prompt content is mine to apply (AI proposes prompt/persona variants; I apply the winner via the BFD setter UI).
- A phased build recommendation (what to build first, what to defer) and a rough effort estimate.

Then give me your recommendation on the best way to implement it.
```
