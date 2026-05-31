# Self-Hosting Feasibility: Replacing Supabase + Trigger.dev on Railway

**Status:** Investigation / future reference. Nothing here is built. This doc
captures a full audit of what the app depends on, whether the rented
infrastructure (Supabase + Trigger.dev) can be self-hosted on Railway, the
trade-offs, and a step-by-step migration shape for when/if we proceed.

**Date of investigation:** 2026-05-31

---

## 1. The question

Can the entire stack be self-hosted on Railway with plain Postgres, removing the
external dependencies — and what replaces Trigger.dev?

## 2. The headline answer

**"Self-host everything with no external applications" is not achievable**, and
the blocker is not infrastructure — it's the business APIs. The app's whole job
is to orchestrate four third-party services that have **no self-hostable
equivalent**:

| Service | Role | Self-hostable? |
|---|---|---|
| **Retell AI** | Voice agents (inbound/outbound calls) | No — proprietary API |
| **Twilio** | SMS send/receive, phone numbers | No — telephony carrier |
| **GoHighLevel** | CRM, calendar, contacts, lead source | No — client data lives there |
| **OpenRouter** | LLM inference for all AI text | No (could swap for a local LLM, big trade-off) |
| Stripe / Unipile / ElevenLabs | Billing / social DMs / optional TTS | No |

These are **services the product *consumes*, not infrastructure we operate.**
They stay external in every scenario. There is nothing to self-host about them.

So the real, answerable question is narrower:

> **Can we replace Supabase-cloud and Trigger.dev-cloud with infrastructure we
> run on Railway, while continuing to call the four business APIs?**

**Answer: Yes for Supabase. Yes-with-a-rewrite for Trigger.dev.** Both are real
migrations, not config flips. Details below.

---

## 3. What the app actually depends on (codebase audit)

### 3.1 Supabase — used for FAR more than Postgres

- **84 Edge Functions** (Deno runtime) in `frontend/supabase/functions/` —
  webhooks (GHL, Twilio, Stripe, Retell), AI generation, proxies. 43 run with
  `verify_jwt = false`.
- **Auth (GoTrue)** — deeply integrated. `frontend/src/providers/AuthProvider.tsx`
  uses `onAuthStateChange`, `signInWithPassword`, `getSession`, sessions in
  localStorage. RLS policies everywhere reference `auth.uid()`.
- **Postgres** — ~98 tables; **148 tables with RLS enabled, ~517 policies.**
  Mostly standard SQL, but RLS is bound to the Supabase `auth` schema.
- **Realtime** — `postgres_changes` subscriptions in `Chats.tsx`, `Contacts.tsx`,
  `Dashboard.tsx`, `OutboundCallProcessing.tsx`, `SyncGHLContacts.tsx`,
  `TextAIRepSetup.tsx`.
- **Storage** — the `logos` bucket (Settings, Onboarding, Client pages).
- **pg_cron + pg_net** — a per-minute cron that `net.http_post`s the
  `campaign-executor` edge function. **URLs and JWTs are hardcoded in
  migrations** (e.g. `20250817081338`). Likely redundant with Trigger.dev's
  scheduler.
- **Per-client mirror DBs** — `clients.supabase_url` / `supabase_service_key`
  point at a second Supabase project (`bfd-setter-live`, ref `qildpilxjodxdifggmto`)
  holding prompts + chat history. Platform DB is `bfd-platform`
  (ref `bjgrgbgykvjrsuwwruoh`).

### 3.2 Trigger.dev — 10 background tasks (`trigger/`, project `proj_fdozaybvhgxnzopabtse`)

| Task | Type | Trigger | What it does |
|---|---|---|---|
| `runEngagement` | async | intake / tag / UI | **Core cadence state machine.** Multi-channel sequences, quiet hours, drip pacing, cost tracking. Spans days via `wait.until()`. Resume-safe via `last_completed_node_index`. |
| `processMessages` | event | GHL/Twilio webhook | Debounce inbound, group, generate AI reply, send SMS, schedule follow-up. |
| `processSetterReply` | sync child | from processMessages | Native text engine (replaced n8n). Reads prompt + chat history, calls OpenRouter. |
| `sendFollowup` | async | processMessages + self-chain | Scheduled follow-up SMS, AI decides whether to send. |
| `runAiJob` | async | frontend buttons | Generic AI job runner (config generation, prompt modify). Parallel chunks. |
| `placeOutboundCall` | queued | from runEngagement | Calls `make-retell-outbound-call`. **Queue, concurrency limit 20.** |
| `nudgeColdReply` | scheduled | `0 6 * * *` | Daily re-engagement of cold leads. |
| `syntheticProbe` | scheduled | `0 * * * *` | Hourly end-to-end smoke test. |
| `refreshCadenceFunnel` | scheduled | `0 * * * *` | Refreshes a Postgres materialized view. |
| `executeWorkflow` | async | not yet wired | DAG workflow engine. |

**What Trigger.dev gives that plain code doesn't:** durable waits
(`wait.until()` parks a job for hours/days across restarts), retries with
backoff, cron scheduling, concurrency-limited queues, task chaining / blocking
waits (`triggerAndWait`), and a run-history UI. Replacing it means replacing all
six capabilities.

### 3.3 Current deployment topology

| Component | Host | Deploy method |
|---|---|---|
| Frontend (React/Vite) | Railway (`1prompt-os-production`) | auto-deploy on `git push main` |
| 84 Edge Functions | Supabase cloud | `scripts/deploy_with_shared.mjs` (Management API) |
| 10 Trigger.dev tasks | Trigger.dev cloud | `npx trigger.dev deploy --env prod` |
| Postgres ×2 | Supabase cloud | migrations via Management API / CLI |
| n8n | Railway (legacy) | **dead — being decommissioned**, replaced by `processSetterReply` |

---

## 4. Feasibility per component

### 4.1 Postgres on Railway — ✅ feasible
Railway runs Postgres in a container; extensions are installable. There's a
**Supabase-Postgres image template on Railway** bundling 50+ extensions including
`pg_cron` and `pgjwt`. Plain tables + RLS policies port directly via
`pg_dump`/`pg_restore`.

**Caveats:** `pg_net` (async HTTP from inside Postgres) is Supabase-specific and
**not guaranteed** on Railway. Fine, because its only use (the per-minute
`campaign-executor` cron) moves to the job worker. Hardcoded Supabase URLs/JWTs
in migrations must be rewritten.

### 4.2 Supabase Auth / Realtime / Storage / REST — ✅ feasible (self-host Supabase)
The clean path is **not** to rip Supabase out — it's to **self-host Supabase**
(open-source). Railway has an official ~12-service template (Kong gateway,
GoTrue, PostgREST, Realtime, Storage, edge-runtime, Studio, supavisor, etc.).
This keeps `supabase-js` working with minimal frontend change — repoint
`VITE_SUPABASE_URL` at the self-hosted Kong gateway.

**Caveats (significant):**
- Railway's Supabase template **historically did not support Edge Functions and
  Logflare logs** (no Docker socket). Newer templates claim edge-function
  support — **must be verified before committing.**
- You now own backups, PITR, JWT secret rotation, and upgrades. Supabase cloud
  does this today.

### 4.3 Edge Functions (84) — ⚠️ the hard part of the Supabase move
Two options:
- **(a)** Run Supabase `edge-runtime` (Deno) container — lowest code change,
  functions run as-is, but it's the least mature part on Railway.
- **(b)** Rewrite all 84 as a Node/Deno service on Railway — most reliable, but
  84 functions of work plus re-pointing every `functions.invoke()` and every
  external webhook URL (GHL, Twilio, Stripe, Retell dashboards).

### 4.4 Trigger.dev — ⚠️ can't run on Railway; replace with BullMQ
Trigger.dev v4 is open-source and self-hostable via Docker — **but its
task-execution supervisor needs a Docker socket, which Railway does not
provide.** The official self-host pattern requires a *second* VM (e.g. a
DigitalOcean droplet) for execution. That breaks "all on Railway."

**So the Railway-native answer is: don't self-host Trigger.dev — replace it with
a long-running BullMQ + Redis worker as an ordinary Railway service** (a Node
process, no Docker socket needed). BullMQ covers retries, delayed jobs,
repeatable (cron) jobs, and concurrency limits.

**The hard part:** the durable multi-day `wait.until()` semantics and the
resume-safe state machine in `runEngagement` must be re-implemented (delayed
jobs + a DB-backed node cursor). This is the single largest and riskiest
workstream (~40–60h + hardening). Get it wrong and you double-send SMS or drop
leads mid-cadence.

---

## 5. Railway-native target architecture

| Piece | Today | Railway-native replacement |
|---|---|---|
| Postgres (×2 DBs) | Supabase cloud | Railway Postgres, **Supabase-Postgres image** (`pg_cron`, `pgjwt`, 50+ ext) |
| Auth / Realtime / Storage / REST | Supabase cloud | Self-hosted Supabase containers (GoTrue, Realtime, Storage, PostgREST, Kong, supavisor) |
| 84 Edge Functions (Deno) | Supabase cloud | edge-runtime container *(verify)* or Node rewrite |
| 10 background tasks | Trigger.dev cloud | **BullMQ + Redis worker** as a Railway service |
| pg_cron/pg_net per-minute job | Supabase pg_cron | BullMQ repeatable job |
| Frontend | Railway | stays on Railway |

---

## 6. Pros / Cons

**Pros**
- **Cost** — eliminates Supabase + Trigger.dev monthly fees (replaced by Railway
  compute + a Redis add-on).
- **Sovereignty** — all data + infra in your own Railway project, not third-party
  dashboards.
- **Lock-in** — self-hosted Supabase is open-source; the BullMQ worker is fully
  yours.

**Cons**
- **You inherit all DB ops** — backups, point-in-time recovery, JWT rotation,
  Postgres upgrades.
- **Edge-runtime risk** — if it won't run on Railway, you rewrite 84 functions.
- **`runEngagement` rebuild is real engineering risk** — durable-wait state
  machine done wrong = double-sends or dropped leads.
- **Net savings are modest** once your time is priced in. SaaS fees are small
  next to what the four business APIs cost anyway.

---

## 7. Recommendation

Given the stated outcomes (cut cost, sovereignty, reduce lock-in) and an
"all on Railway" target:

**Worth doing, but in this order — and with one push-back.**

1. **Spike the edge-runtime on Railway first (~half a day).** This is the
   make-or-break unknown. Don't plan anything else until you know self-hosted
   Supabase edge functions actually run on Railway.
2. **Migrate Supabase before touching Trigger.dev.** It's the lower-risk,
   higher-reward half — delivers most of the sovereignty + lock-in win with far
   less rebuild risk.
3. **Treat Trigger.dev → BullMQ as a separate, later project.** It's where the
   real risk lives. Leaving Trigger.dev on cloud even after Supabase moves is a
   reasonable middle state — cheap, and avoids betting the live cadence engine on
   a from-scratch state machine.

**Push-back on "all on Railway":** the background jobs are slightly forced onto
Railway. We already run **greenserver** (Docker, restic nightly backups,
Tailscale) — a more natural home for a worker, and one that would let us
self-host *actual* Trigger.dev instead of rebuilding it on BullMQ. If
"everything in one Railway project" matters for simplicity, BullMQ-on-Railway is
the answer. If the goal is just "off the SaaS and onto our own metal," greenserver
gets there with less rebuild risk.

---

## 8. Migration shape (Railway target) — step by step

1. **Spike the riskiest unknown first.** Stand up self-hosted Supabase on Railway;
   confirm edge-runtime + Realtime + Storage work. If edge-runtime won't run,
   decide early: Node rewrite vs a non-Railway escape hatch (greenserver).
2. **Provision Railway Postgres** (Supabase-Postgres image). Migrate both
   `bfd-platform` + `bfd-setter-live` via `pg_dump`/`pg_restore`, RLS included.
3. **Rewrite hardcoded Supabase URLs/JWTs** baked into migrations. Generate fresh
   JWT secret + anon/service keys for the self-hosted gateway.
4. **Deploy the 84 edge functions** (edge-runtime container or Node rewrite).
   Repoint every external webhook URL (GHL, Twilio, Stripe, Retell dashboards) to
   the new Kong/gateway domain. Cross-reference `Docs/WEBHOOKS.md` for the full
   endpoint list.
5. **Build the BullMQ worker** to replace the 10 Trigger.dev tasks, easiest-first:
   - Scheduled tasks (`refreshCadenceFunnel`, `nudgeColdReply`, `syntheticProbe`)
     → BullMQ repeatable jobs.
   - Event tasks (`processMessages`, `processSetterReply`, `sendFollowup`,
     `runAiJob`) → standard jobs + child jobs.
   - `placeOutboundCall` → a queue with `concurrency: 20`.
   - `runEngagement` **last** → delayed jobs for waits + DB-backed node cursor for
     resume safety. Port the guards from `Docs/CADENCE_DESIGN.md` exactly.
6. **Repoint the frontend** env (`VITE_SUPABASE_URL` → Kong gateway) and cut over.

---

## 9. Verification (how to prove the migrated stack works)

- **`syntheticProbe` is already an end-to-end smoke test** — a green probe means
  the whole chain (intake → cadence → outbound queue) works on the new infra.
- **Manual full flow:** GHL form → cadence → SMS via Twilio → Retell voice call →
  booking, against the self-hosted stack.
- **Auth:** log in/out on the frontend against self-hosted GoTrue.
- **Realtime:** confirm Chats/Contacts live updates fire.
- **Data integrity:** row counts + spot-checks on both migrated DBs; verify RLS
  still enforces agency/client isolation.

---

## 10. Sources

- [Self-hosting Trigger.dev v4 with Docker](https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker)
- [Deploy Trigger.dev on Railway (two-platform supervisor note)](https://railway.com/deploy/triggerdev)
- [Railway PostgreSQL docs](https://docs.railway.com/databases/postgresql)
- [Supabase-Postgres image on Railway](https://railway.com/deploy/supabase-postgres-1)
- [Self-host Supabase on Railway guide](https://docs.railway.com/guides/supabase)
- [Supabase self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase self-hosted functions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)
