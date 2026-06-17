# BFD-Setter Documentation

Start here. The docs are now a small, maintained set; everything historical lives in `archive/` (kept for reference, not maintained).

## Living docs (the canonical set)

| Doc | What it covers |
|-----|----------------|
| [`/README.md`](../README.md) | Product + repo orientation: what BFD-Setter is, the stack, quick start. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System source of truth: services, data flow, the lead → cadence → booking pipeline, and the current capability set (form routing, native reactivation, voice setters). |
| [`WEBHOOKS.md`](WEBHOOKS.md) | Per-endpoint webhook catalogue + auth. |
| [`CADENCE_DESIGN.md`](CADENCE_DESIGN.md) | The engagement cadence engine: state machine, node types, guards. |
| [`FORM_ROUTING.md`](FORM_ROUTING.md) | Operator guide: how inbound forms route to cadences/agents (incl. BFD's main + Try-Gary setup), adding new forms, and provisioning additional voice agents. |
| [`ROADMAP.md`](ROADMAP.md) | Active build roadmap + the Claude/Brendan to-do lists. |
| [`SELF_HOSTING_FEASIBILITY.md`](SELF_HOSTING_FEASIBILITY.md) | Future-reference investigation: replacing Supabase + Trigger.dev with self-hosted infra on Railway. Findings, pros/cons, recommendation, migration steps. |

Mental model of the friendly names: ARCHITECTURE (+ WEBHOOKS) = "how it's built", CADENCE_DESIGN = "the engagement engine". Operator-facing SOPs and setup guides now live in the sibling [`../SOP/`](../SOP/) folder (see below).

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

`archive/` holds superseded/session docs: `MASTER_PLAN`, `CHANGES_LOG`, `FUTURE`, `TRACKING`, `RAILWAY_ENV`, `NEXT_SESSION_PROMPT`, `GHL_PUSH_AUDIT`, `SETUP_OVERVIEW`, and dated `soak-checks/`. Git history is the source of truth for change log; these are kept only for reference.

## Deployment

Nothing here auto-deploys. See [`../SOP/RUNBOOK.md`](../SOP/RUNBOOK.md) and `ROADMAP.md` (each feature lists its deploy steps). Migrations live in `../frontend/supabase/migrations/`; fresh projects use `../supabase/schema.sql` + `../supabase/client-schema.sql` rather than replaying the full migration history.
