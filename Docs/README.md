# BFD-Setter Documentation

Start here. The docs are a small, maintained set; everything historical lives in `archive/` (kept for reference, not maintained). Every file in `archive/` carries an ARCHIVED banner as of 2026-07-20.

> **Index verified complete 2026-07-20** (`AUDIT_2026-07-20.md`). Every tracked doc under `Docs/` is
> listed on this page, and every link on this page resolves.

**Two doc roots exist and this is a trap on a case-sensitive filesystem:** this `Docs/` directory is the
real one. There is also a lowercase `docs/` holding two 2026-06-18 spec-kit-style files under
`docs/superpowers/` (one plan, one design spec). It is not part of this set and is not maintained.

## Tracking & sessions (start here)

The live work-tracking is the **6 canonical lists** + the master session plan. Don't track open work anywhere else.

| Doc | What it covers |
|-----|----------------|
| [`SESSION_PLAN.md`](SESSION_PLAN.md) | **Single source of truth for the session sequence** to v1 "100%" + the Relay Protocol every session follows. |
| [`BUG_LIST.md`](BUG_LIST.md) | Open bugs / behavior fixes (Claude builds). |
| [`/FEATURE_ROADMAP.md`](../FEATURE_ROADMAP.md) | Feature build queue (lives at repo root). |
| [`BRENDAN_TODO.md`](BRENDAN_TODO.md) | Manual / UI actions only Brendan can do. |
| [`TEST_LIST.md`](TEST_LIST.md) | Things to live-verify after a build. |
| [`DEFERRED.md`](DEFERRED.md) | Someday / gated (v2: lifecycle, A/B, HubSpot, analytics). |
| [`PROMPT_UPDATE_LIST.md`](PROMPT_UPDATE_LIST.md) | Prompt-content edits Brendan applies via the UI (report-only; separate from code work). |

Closed items move to [`archive/COMPLETED_LOG.md`](archive/COMPLETED_LOG.md).

### Trigger-driven session docs

`CLAUDE.md` wires three spoken triggers to these files. They are entry points, not reference reading:

| Doc | Trigger phrase | What it does |
|-----|----------------|--------------|
| [`NEXT_SESSION_PROMPT.md`](NEXT_SESSION_PROMPT.md) | "run next session prompt" | The canonical next-session relay prompt. **Overwritten at every session closeout.** |
| [`TEST_SESSION.md`](TEST_SESSION.md) | "run test session" | Consolidated live-test runbook: batches open `TEST_LIST.md` items into the fewest live runs (RUN 0-10). |
| [`FIRST_CLIENT_MILESTONE.md`](FIRST_CLIENT_MILESTONE.md) | "I'm onboarding a client" | **Event-gated.** Flips Stripe / subscription enforcement / live webhook secrets / AU A2P. Do not run before a contract signs. |

[`FIRST_CLIENT_TASKS.md`](FIRST_CLIENT_TASKS.md) holds the security items that are latent until the first
client-role user exists (the GATE A / GATE B cluster). They live there, not in `BUG_LIST.md`.

## Living docs (the canonical set)

| Doc | What it covers |
|-----|----------------|
| [`/README.md`](../README.md) | Product + repo orientation: what BFD-Setter is, the stack, quick start. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System source of truth: services, data flow, the lead → cadence → booking pipeline, and the current capability set (form routing, native reactivation, voice setters). |
| [`WEBHOOKS.md`](WEBHOOKS.md) | Per-endpoint webhook catalogue + auth. |
| [`CADENCE_DESIGN.md`](CADENCE_DESIGN.md) | The engagement cadence engine: state machine, node types, guards. |
| [`FORM_ROUTING.md`](FORM_ROUTING.md) | Operator guide: how inbound forms route to cadences/agents (incl. BFD's main + Try-Gary setup), adding new forms, and provisioning additional voice agents. |
| [`ROADMAP.md`](ROADMAP.md) | Build **history** (2026-05/06 snapshot). NOT the active to-do list — that moved to the 6 lists above. |

Mental model of the friendly names: ARCHITECTURE (+ WEBHOOKS) = "how it's built", CADENCE_DESIGN = "the engagement engine". Operator-facing SOPs and setup guides now live in the sibling [`../SOP/`](../SOP/) folder (see below).

## Reference / research (kept, not maintained)

Single-topic references cited by the lists above. Read when the linked item comes up; otherwise leave them be.

| Doc | What it covers |
|-----|----------------|
| [`GHL_SYNC_FIX_2026-06-19.md`](GHL_SYNC_FIX_2026-06-19.md) | F1 deep-link + 6.12b outcome-field writeback build record + GHL field-type findings. |
| [`GHL_CUSTOM_FIELDS_HITLIST.md`](GHL_CUSTOM_FIELDS_HITLIST.md) | The ~101-field GHL custom-field cleanup list (Brendan-owned, gated). |
| [`SELF_HOSTING_FEASIBILITY.md`](SELF_HOSTING_FEASIBILITY.md) | Future-reference: self-hosting Supabase + Trigger.dev on Railway. |
| [`AB_TESTING_RESEARCH_2026-06-16.md`](AB_TESTING_RESEARCH_2026-06-16.md) | Research brief for DEFERRED 3.1 (A/B testing). |
| [`HUBSPOT_GHL_COEXISTENCE_ANALYSIS.md`](HUBSPOT_GHL_COEXISTENCE_ANALYSIS.md) / [`HUBSPOT_CLIENT_RECOMMENDATION.md`](HUBSPOT_CLIENT_RECOMMENDATION.md) | DEFERRED 3.11 (HubSpot coexistence) analysis + client-facing summary. |
| [`RETELL_CONVERSATION_FLOW_EVALUATION_2026-06-11.md`](RETELL_CONVERSATION_FLOW_EVALUATION_2026-06-11.md) | Conversation-Flow-vs-single-prompt eval (CONDITIONAL GO). |
| [`EMAIL_PROVIDER_OPTIONS.md`](EMAIL_PROVIDER_OPTIONS.md) | Email/SMTP options for DEFERRED email provider. |
| [`SECURITY_REVIEW_2026-06-05.md`](SECURITY_REVIEW_2026-06-05.md) | Dated whole-codebase security review (the first one). |
| [`SECURITY_REVIEW_2026-07-07.md`](SECURITY_REVIEW_2026-07-07.md) | Session P3 review over the diff since Session 9. Verdict: shipped surface sound. |
| [`SECURITY_REVIEW_2026-07-08.md`](SECURITY_REVIEW_2026-07-08.md) | The RLS/tenant-isolation pass that produced the GATE A + GATE B clusters. **Source of truth for why `FIRST_CLIENT_TASKS.md` exists.** |
| [`ONBOARDING_GAP_REPORT_2026-07-06.md`](ONBOARDING_GAP_REPORT_2026-07-06.md) | New-client dry-run findings that spawned ONBOARD-1/2/3 + GOLIVE-1 + ACCESS-1. |
| [`REBUILD_PRD_KICKOFF.md`](REBUILD_PRD_KICKOFF.md) | Kickoff prompt for the session that reverse-engineered this repo into a rebuild PRD. **This is the origin of the sibling `bfd-setter-v2` project**, not work on this repo. |
| [`investigations/`](investigations/) | Dated deep-dives. Currently: `2026-07-03-prompt-auth-1-text-setter-authoring.md`. |

## Operator SOPs and setup guides

Kept separate from the build docs above, in the sibling [`../SOP/`](../SOP/) folder:

| Doc | What it covers |
|-----|----------------|
| [`../SOP/CLIENT_ONBOARDING_SOP.md`](../SOP/CLIENT_ONBOARDING_SOP.md) | Canonical step-by-step new-client onboarding (hosting model, intake, wiring, go-live). |
| [`../SOP/GHL_SETUP.md`](../SOP/GHL_SETUP.md) | GoHighLevel forms, tags, automations, webhooks. |
| [`../SOP/PERSONA_SETUP.md`](../SOP/PERSONA_SETUP.md) | Per-persona setters + campaigns (Try-Gary). |
| [`../SOP/RUNBOOK.md`](../SOP/RUNBOOK.md) | Operations: deploy commands, rollback, incident playbooks. |
| [`../SOP/CAMPAIGN_PLAYBOOK.md`](../SOP/CAMPAIGN_PLAYBOOK.md) | Operator recipes: new-lead, reactivation, list campaigns. |

## Archive

`archive/` holds superseded/session docs: the dated audits (`AUDIT_2026-06-10`, `AUDIT_RECONCILIATION_2026-06-19`), the old driving prompts (`WORKING_PROMPTS`, `NEXT_SESSION_*`), `MASTER_PLAN`, `CHANGES_LOG`, `FUTURE`, `TRACKING`, `RAILWAY_ENV`, `GHL_PUSH_AUDIT`, `SETUP_OVERVIEW`, dated session/prompt docs, and `soak-checks/`. It also holds [`COMPLETED_LOG.md`](archive/COMPLETED_LOG.md) (closed list items). Git history is the source of truth for the change log; these are kept only for reference.

## Audits

Dated, whole-repo audits. The newest is the current one; older ones are in `archive/`.

| Doc | What it covers |
|-----|----------------|
| [`AUDIT_2026-07-20.md`](AUDIT_2026-07-20.md) | **Current.** Documentation-vs-code audit: every doc classified, ground truth re-established (stack, jobs, routes, schema, deploy, tests), plus the state-of-the-project assessment. |
| [`archive/AUDIT_2026-06-10_full-system-audit.md`](archive/AUDIT_2026-06-10_full-system-audit.md) | 62-finding full-system audit (historical). |
| [`archive/AUDIT_RECONCILIATION_2026-06-19.md`](archive/AUDIT_RECONCILIATION_2026-06-19.md) | Verdicts on all 62 of the above against then-current code (historical). |

## Deployment

Nothing here auto-deploys except the frontend (Railway builds on push to `main`). See [`../SOP/RUNBOOK.md`](../SOP/RUNBOOK.md) and `ROADMAP.md` (each feature lists its deploy steps). Migrations live in `../frontend/supabase/migrations/` (387 of them); fresh projects use `../supabase/schema.sql` + `../supabase/client-schema.sql` rather than replaying the full migration history. Edge functions deploy via the bundle scripts in `../scripts/`, not the plain Supabase CLI.
