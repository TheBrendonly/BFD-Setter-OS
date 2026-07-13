---
description: Kickoff prompt + run guide for the Fable session that reverse-engineers bfd-setter into an exhaustive rebuild PRD (functional contract + target architecture + infra decision + UI), then hands off to Opus to build a fresh clone in a new project folder.
---

# Rebuild PRD — Fable kickoff

Purpose: have a Fable session reverse-engineer the entire live product into a build-ready PRD so a fresh, cleaner
implementation can be built that behaves **functionally identically**. The PRD hard-separates three layers:
(A) the immutable functional contract, (B) a proposed better/target architecture (incl. the hosting decision),
(C) UI/UX improvements — so "improvements" can never silently change behaviour.

## How to run it

- **Model:** Fable 5. **Thinking:** maximum. **Mode:** the prompt starts in **plan** (explore + get the folder
  name + outline + one exemplar section approved), then switches to **auto** to write the full set. If you'd
  rather not be prompted for the live-DB/`gh` reads during exploration, launch with `--permission-mode auto`.
- **Where:** run detached on greenserver so it survives your laptop closing:
  `ssh greenserver` -> `tmux new -s build` -> `cd /srv/bfd` -> `claude` (paste the prompt below). Detach with
  `Ctrl-b` then `d`; reattach with `tmux attach -t build`.
- **Working dir is `/srv/bfd`** (the business root). The prompt tells Fable to read the source from
  `/srv/bfd/Projects/bfd-setter` + its GitHub, leave the original untouched, and stand up a NEW project folder
  for the rebuild with the PRD inside it.

## Downstream flow (after the PRD exists)

1. **Gap-check (Opus 4.8, high thinking, read-only):** "Adversarially review the new PRD against the live code +
   DB; list everything missing/unverified/contradictory; don't edit." Fix gaps with a short Fable follow-up.
2. **Build (Opus 4.8, per-milestone plan mode):** a multi-session program, one session per milestone in
   `08_BUILD_PLAN.md`, starting with milestone #0 (stand up the new project + chosen infra), each ending by
   proving parity against `05_FUNCTIONAL_CONTRACT.md`.

---

## THE PROMPT (paste into the Fable session)

```
BFD-Setter — REBUILD PRD authoring session. Your job is to produce an exhaustive, build-ready Product
Requirements + Design document set from which a fresh, cleaner implementation of this product can be built that
is FUNCTIONALLY IDENTICAL to the current live system in every detail. You are NOT writing product code this
session — you are reverse-engineering the entire product into a spec so precise that a competent engineer who has
never seen the original could rebuild a behaviourally-identical system from your docs alone.

WORKING DIRECTORY & SOURCES: you are running from /srv/bfd (the BusinessOS root — it also holds Company/,
Operations/, System/, and other Projects/; stay out of unrelated projects). The SOURCE product you must
reverse-engineer is the existing project, which you read from BOTH:
  - the local clone at /srv/bfd/Projects/bfd-setter (primary; run `git -C /srv/bfd/Projects/bfd-setter pull` and
    `git -C /srv/bfd/Projects/bfd-setter fetch --all` first), AND
  - its GitHub repo (remote `github` -> https://github.com/TheBrendonly/BFD-Setter-OS). Cross-check against
    GitHub so you capture the FULL pushed state, including all branches — in particular the staged
    `frozen/voice-booking-bundle` branch (the not-yet-deployed voice-machinery bundle), which is part of the
    product's intended behaviour.
Creds for live verification are in /srv/bfd/Projects/bfd-setter/.env (SUPABASE_PAT for the Management API,
BFD_RETELL_API_KEY for read-only Retell, Trigger tokens).

READ-ONLY ON THE SOURCE: do NOT modify /srv/bfd/Projects/bfd-setter or any live/external system (no deploy,
migrate, prompt edits, or state changes). You DO create the new rebuild project folder and write the PRD into it
(below).

STAND UP THE NEW PROJECT FOLDER: the rebuild is a NET-NEW project, not a change to the original. Create a new
project folder under /srv/bfd/Projects/ for it — propose the exact name to me in the plan step and confirm it
before creating (default: /srv/bfd/Projects/bfd-setter-v2). Write the entire PRD doc set into that new folder
under Docs/PRD/. The eventual code build (a later Opus program) will build INTO this same new folder; the
original /srv/bfd/Projects/bfd-setter is untouched and serves only as the reference to spec against.

WHAT THIS PRODUCT IS (verify + deepen from the code): a multi-tenant, agency-run AI appointment-setter platform.
Building Flow Digital (the agency) runs AI "setters" for client sub-accounts across two channels: VOICE (Retell
agents, "Gary") and TEXT/SMS (a native Trigger.dev engine). It ingests leads (GHL webhooks / CSV / a public
intake endpoint / forms), runs multi-step engagement cadences, books meetings into GHL calendars, and reports ROI
(show-rate funnel, weekly report, cost-to-price + usage billing). Multi-tenant with agency vs client roles and
strict RLS. Stack today: React+Vite frontend (Railway), ~96 Supabase Deno edge functions, ~15 Trigger.dev cloud
tasks, a PLATFORM Supabase DB PLUS a per-client EXTERNAL Supabase DB (multi-DB), and integrations with Retell,
Twilio (client-BYO), GoHighLevel, OpenRouter, Stripe (dormant), Unipile.

METHOD (be exhaustive — this is the whole point):
1. Explore EVERYTHING in the source: frontend/src (pages, components, hooks, routes, data),
   frontend/supabase/functions/** (every edge fn), trigger/** (every task + _shared),
   frontend/supabase/migrations/**, and the entire Docs/ set (ARCHITECTURE, CAMPAIGN_PLAYBOOK, GHL_SETUP,
   CADENCE_DESIGN, SECURITY_REVIEW_*, ONBOARDING_GAP_REPORT, ROADMAP, the 6 canonical lists) + ALL of
   Operations/handoffs/** + the memory index at ~/.claude/projects/-srv-bfd-Projects-bfd-setter/memory/. The
   handoffs, security reviews, and memory encode the WHY and the hard-won gotchas — mine them; they are as
   important as the code. Also read every branch pushed to GitHub, not just main.
2. VERIFY AGAINST LIVE where the repo drifts (this product has known repo-vs-live drift): confirm the true DB
   schema from information_schema via the Management API (types.ts and migrations drift from live — e.g. the live
   `bookings` table is the "phase7a" shape, not what some old code writes); read the live Retell agent config
   read-only; list live edge-fn versions. Flag EVERY repo-vs-live discrepancy you find.
3. Capture INTENDED behaviour (the contract), not buggy implementation detail. Where the current code has bugs,
   dead code, drift, or tech debt, record it in an "issues to fix in the rebuild" register — the clone must
   preserve every real FEATURE/BEHAVIOUR but must NOT replicate the warts.

HARD RULES (most important):
- SEPARATE three layers cleanly and never let them bleed:
  (A) FUNCTIONAL CONTRACT — the immutable "must behave exactly like this" spec, with explicit acceptance
      criteria per behaviour. This is the source of truth for parity. It is INFRASTRUCTURE-AGNOSTIC: the
      behaviours are identical regardless of how the system is hosted.
  (B) TARGET ARCHITECTURE — your proposed cleaner way to build it (consolidate the ~96 edge fns, unify the two
      booking-ingest paths, resolve drift, typed contracts, migration discipline, whether to keep or retire the
      multi-DB design, a cleaner cadence/text-engine, test strategy) INCLUDING the infrastructure/hosting
      decision below. Proposals only; must satisfy (A).
  (C) UI/UX IMPROVEMENTS — a modernised design system + improved agency/client dashboards, setter builders, and
      reporting views. Must preserve every functional affordance in (A).
- Every claim about behaviour must cite where you verified it (file:line, live query, or handoff).
- Coverage over brevity. If a flow has 12 branches, document all 12. If an edge fn has 7 error modes, document 7.

INFRASTRUCTURE & HOSTING STRATEGY (decide this explicitly; it is a layer-B decision and must NOT change the
layer-A functional contract): The current system depends on managed Supabase (Postgres + RLS + GoTrue auth incl.
TOTP MFA + ~96 Deno edge functions + storage + the Management API, PLUS a separate per-client EXTERNAL Supabase
DB — the multi-DB model), managed Trigger.dev (~15 cron/durable/long-running [maxDuration up to 3600s] background
tasks with retries), and Railway (the frontend + a legacy n8n instance). Do NOT rebuild an external platform for
its own sake, and do NOT keep one out of inertia. Evaluate and pick the RIGHT hosting architecture for a
SOLO-FOUNDER, self-hostable, managed-retainer product, choosing among (a hybrid is allowed):
  (1) Reuse managed Supabase + Trigger.dev as-is.
  (2) Self-host the OSS Supabase and/or Trigger.dev stacks on Railway (run their open-source versions yourself).
  (3) Replace them with a Railway-native custom stack (e.g. a Postgres service + a single API service
      [Node/Deno/Bun] + a background worker + a durable job/queue+cron layer such as pg-boss/BullMQ + an auth
      solution supporting magic-link + TOTP MFA + invite/reset [standalone GoTrue, Lucia/Better-Auth, or similar]
      + S3-compatible object storage), so the whole product COMPLETELY self-hosts on Railway with NO Supabase and
      NO Trigger.dev dependency.
Requirements for this section:
- Produce a CAPABILITY-MAPPING table: every current external capability -> its replacement in the recommended
  target (Postgres, RLS/authorization model, auth+MFA, edge/functions runtime, cron scheduler, durable/retrying
  jobs, long-running ~1h tasks, storage, the per-client external-DB multi-tenancy, Management-API-style admin
  ops, webhook ingestion, secrets/env).
- Confront the HARD parts honestly: (a) the security model is Postgres-RLS-based — decide keep-RLS-in-Postgres vs
  move authorization to the app layer, and keep-the-multi-DB-per-client design vs consolidate to one DB with
  tenant isolation; (b) auth must preserve magic-link + TOTP MFA + agency/client roles + invite/reset;
  (c) background durability, retries, and ~1h long-running tasks; (d) the ~96 functions' Deno-runtime assumptions.
- Weigh the real trade-offs for a solo founder: total cost, ops/maintenance burden, number of moving parts and
  bills, migration effort + data portability (how the platform DB and each client's external DB move), vendor
  lock-in, and RISK to functional parity.
- Give a clear RECOMMENDATION with justification and a migration path. If "completely self-host on Railway, no
  Supabase/Trigger" is achievable without sacrificing parity or overloading a solo operator, treat that as a
  first-class desirable outcome and design it; if it is NOT the right call, say so plainly and recommend the
  managed or hybrid option with reasons. Whatever you choose, the functional contract (A) stays unchanged.

DELIVERABLE — write the doc SET into <new project folder>/Docs/PRD/ (create it), with a master index and linked
domain docs:
- 00_MASTER_PRD.md — product overview, personas (agency/client + the end-lead), value prop, glossary, how to use
  this PRD, and a top-level map of the whole system.
- 01_ARCHITECTURE_AS_BUILT.md — current architecture, verified vs live, deploy topology, the multi-DB model, the
  frozen-voice-machinery concept + why.
- 02_ARCHITECTURE_TARGET.md — proposed cleaner architecture (layer B), INCLUDING the Infrastructure & Hosting
  Strategy decision above (options weighed, capability-mapping table, recommendation, migration path).
- 03_DATA_MODEL.md — every table (platform + external DB): columns, types, constraints, indexes, RLS policies,
  and the drift notes. Include the config stores (client_pricing_config, client_report_config, feature flags).
- Domain deep-dives (one file each, each ending in an explicit "Functional acceptance criteria" list):
  LEAD_INGESTION, CADENCE_ENGINE, TEXT_SETTER, VOICE_SETTER, BOOKING, REPORTING_AND_BILLING, INTEGRATIONS
  (Retell / Twilio / GHL / OpenRouter / Stripe / Unipile — with exact endpoints, payloads, auth, webhook
  signature schemes, and response/error handling), SECURITY_AND_RLS (the full multi-tenant model incl. GATE A
  role-gate + GATE B webhook-signing + the clients_public secret boundary + rate limits + PII redaction),
  COMPLIANCE (AU telemarketing hours, recording disclosure, ACMA Sender ID, Spam Act consent, DNC, DPAs),
  ONBOARDING_AND_GOLIVE, OPS_AND_OBSERVABILITY (Trigger schedules, error_logs, digests, testing/harness).
- 05_FUNCTIONAL_CONTRACT.md — the consolidated, numbered behavioural acceptance criteria (layer A), each with a
  test/verification method, cross-referenced to the domain docs. INFRASTRUCTURE-AGNOSTIC. This is the parity
  checklist the build proves itself against at every step, regardless of the chosen hosting.
- 06_UI_UX.md — current screen/route inventory + component map, then the proposed redesign (layer C).
- 07_GOTCHAS_AND_DECISIONS.md — the why, the incidents (e.g. the EE1 fan-out wipe, the slot-1/inbound-agent
  collision, the phase7a bookings schema, GHL Webhook V2 is RSA not HMAC, Retell's v=ts,d=HMAC scheme, the
  single-use MFA refresh token, repo-vs-live drift), plus the "issues to fix in the rebuild" register.
- 08_BUILD_PLAN.md — a dependency-ordered milestone plan for the builder. MILESTONE #0 = "stand up the new
  project + the chosen infrastructure": scaffold the new /srv/bfd/Projects/<name> repo per the /srv/bfd
  "Starting a New Project" SOP (Forgejo repo under org bfd, .env.example, vaulted secrets, spec-kit, document in
  System/docs/sync-topology.md), then stand up the chosen platform (DB + auth+MFA + jobs/cron + functions runtime
  + storage) and prove one end-to-end vertical slice on it BEFORE the domain slices. Then the domain milestones
  as vertical slices, each with a parity gate against 05_FUNCTIONAL_CONTRACT.md.

DEFINITION OF DONE for the PRD: (1) it covers every domain above with acceptance criteria; (2) a builder could
reproduce each behaviour without seeing the original; (3) the functional contract (A) is clean of architecture/UI
opinions and infra-agnostic; (4) the infrastructure decision is made with a clear recommendation + capability
mapping + migration path; (5) every repo-vs-live drift and known gotcha is captured so the clone doesn't
reintroduce a solved bug.

START IN PLAN MODE: first explore the source read-only (local + GitHub), then propose (a) the new project folder
name, (b) the PRD outline (the exact file list + a 1-paragraph scope for each), (c) your methodology, (d) your
provisional infrastructure recommendation with reasoning, and (e) one fully-written exemplar domain section so I
can judge the depth — and ask me to approve before you create the folder and write the full set. After I approve,
create /srv/bfd/Projects/<approved-name>/Docs/PRD/ and write the whole doc set, checkpointing after each domain
doc. If it spans more than one working block, relay: leave a short progress note at the top of 00_MASTER_PRD.md
and continue.
```
