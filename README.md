# BFD-setter — Building Flow's AI Appointment Setter

BFD-setter is Building Flow Digital's internal codebase for the **Building Flow** AI appointment-setter platform — an AI setter (Gary) that works inbound leads over **SMS and AI voice calls** and books them into the client's calendar, using GoHighLevel, Supabase, Retell and Trigger.dev.

> ## → Start at [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md)
>
> That is the **canonical document for this project**: what it is, how it is built, how it functions end
> to end with file-level traces, why it was built this way, and its honest current state. This README is
> a short orientation; the overview is the real thing. A new developer or a fresh AI session should read
> it first.

> **Channel scope, as built:** BFD is **SMS + voice only** today. Outbound email and outbound social DM
> are **not live**, and the cadence engine hard-fails non-SMS outbound on purpose. Inbound DM and
> WhatsApp plumbing exists (`receive-dm-webhook`) but is a roadmap item, not a shipped capability.
> Do not promise email or DM to a client. Source: [`SOP/CLIENT_ONBOARDING_SOP.md`](./SOP/CLIENT_ONBOARDING_SOP.md) §"Channel scope".

> Forked from an upstream OSS project on 2026-04-14 (see git history for lineage). BFD maintains a divergent fork; all upstream branding was removed in the 2026-07-10 branding purge.

---

## What This Is

A business connects their GoHighLevel sub-account. A lead messages them. The AI setter replies automatically — handling objections, booking appointments, following up — without the business touching anything.

This is the complete platform source code: the React dashboard, all 97 Supabase Edge Functions, the Trigger.dev background task engine, and the database schemas.

---

## Architecture

Four services. All must be connected and configured for the system to work.

```
Lead sends message (SMS today; Instagram / Facebook plumbed but not live)
        ↓
GoHighLevel fires webhook
        ↓
Supabase Edge Function  (frontend/supabase/functions/)
  - Identifies the client
  - Queues the message
  - Triggers the Trigger.dev task
        ↓
Trigger.dev  (trigger/)
  - Waits out the debounce window
  - Groups messages from the same contact
  - Runs the native text engine (processSetterReply.ts):
    reads setter prompt + chat history, generates the AI reply
  - Sends the reply direct via Twilio (GHL mirrored)
        ↓
GoHighLevel sends reply to lead
        ↓
Dashboard  (frontend/src/)
  - Shows live execution status
  - Manages setter configuration
  - Analytics, contacts, campaigns
```

> **Current state (2026-07):** the AI reply runs on the **native text engine** (`trigger/processSetterReply.ts`; `use_native_text_engine` is mandatory), and outbound SMS is sent **direct via Twilio** (GHL is mirrored, not the send path). The upstream fork's n8n workflow layer was decommissioned and its last in-repo remnants were removed in the 2026-07-10 branding purge. See [Docs/ARCHITECTURE.md](./Docs/ARCHITECTURE.md) for the authoritative wiring.

**Deployment topology** (hosts that run BFD-setter in production):

- **Frontend dashboard** → Railway production service (renamed from the legacy upstream name 2026-07-10). **Auto-deploys on `git push github main`, NOT `origin`.** `origin` is Forgejo on Tailscale and deploys nothing; Railway is wired to the GitHub mirror.
- **Edge functions + platform Postgres** → Supabase (`bjgrgbgykvjrsuwwruoh`)
- **Background tasks** → Trigger.dev cloud (`proj_fdozaybvhgxnzopabtse`)

Lovable hosts nothing for BFD. Operational runbook: [`SOP/RUNBOOK.md`](./SOP/RUNBOOK.md). Env reference (archived snapshot): [`Docs/archive/RAILWAY_ENV.md`](./Docs/archive/RAILWAY_ENV.md).

---

## What's In This Repo

```
bfd-setter/
│
├── frontend/                        ← React dashboard + all Edge Functions
│   ├── src/
│   │   ├── pages/                   ← 72 pages (dashboard, analytics, AI reps, contacts, etc.)
│   │   ├── components/              ← UI components (shadcn/ui + custom)
│   │   ├── hooks/                   ← Custom React hooks
│   │   ├── integrations/supabase/   ← Supabase client + generated DB types
│   │   └── lib/ utils/ types/       ← Helpers and TypeScript types
│   ├── supabase/
│   │   ├── functions/               ← 97 Deno Edge Functions + _shared/ modules
│   │   ├── migrations/              ← 387 SQL migrations (full schema history)
│   │   └── config.toml              ← per-function verify_jwt settings
│   └── public/                      ← static assets
│
├── trigger/                         ← Trigger.dev background tasks (15 tasks, TypeScript)
│   ├── _shared/                     ← task helpers + the 23 Node unit tests
│   ├── processMessages.ts           ← core DM flow: debounce → native engine → Twilio reply
│   ├── processSetterReply.ts        ← native text engine: prompt + history → AI reply
│   ├── runEngagement.ts             ← cadence state machine (engage / delay / phone_call)
│   ├── sendFollowup.ts              ← scheduled follow-up sequence
│   ├── runAiJob.ts                  ← AI generation: setter config, prompt editing
│   ├── executeWorkflow.ts           ← workflow node execution
│   ├── placeOutboundCall.ts         ← outbound call triggering
│   ├── scheduleCallback.ts          ← callback scheduling
│   └── (7 scheduled tasks)          ← analyzeSmsConversations, refreshCadenceFunnel,
│                                       nudgeColdReply, errorDigest, pollRetellDrift,
│                                       syntheticProbe, weeklyClientReport
│
├── supabase/                        ← loose schema SQL only (NO functions, NO migrations)
│   ├── schema.sql                   ← platform database schema — run in YOUR Supabase project
│   ├── client-schema.sql            ← client database schema — run in each CLIENT'S Supabase project
│   └── client-schema-extension.sql  ← additive client-schema columns
│
├── trigger.config.ts                ← Trigger.dev project config
├── package.json                     ← Trigger.dev dependencies
└── .env.example                     ← required environment variables
```

---

## What You Need

Before you start, you need accounts on these services:

| Service | Purpose |
|---|---|
| **GoHighLevel** | CRM — sends webhooks when leads message, receives AI replies |
| **Supabase** | Platform database + Edge Functions (the webhook API layer) |
| **Trigger.dev** | Runs the background tasks in `/trigger`, including the native text engine |
| **OpenRouter** | LLM API used for AI generation |

You also need a second Supabase project per client (for their leads, chat history, and prompts).

---

## Environment Variables

**Trigger.dev** (set in Trigger.dev Dashboard → Environment Variables):

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API |

**Frontend** (create `frontend/.env.local` from `frontend/.env.example`):

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |

---

## High-Level Setup Steps

See [Docs/ARCHITECTURE.md](./Docs/ARCHITECTURE.md) for the system source of truth, and [SOP/GHL_SETUP.md](./SOP/GHL_SETUP.md) for the GoHighLevel operator guide (forms, tags, automations, webhooks + verification checklist). The full doc index is in [Docs/README.md](./Docs/README.md).

---

## This Is Not a Tutorial

This repo is BFD's internal codebase. It is not a step-by-step setup guide. It contains the complete source code, all Edge Functions, database schemas, and background tasks, but it does not walk you through how to configure each service, wire the webhooks, structure your GHL sub-account, or connect all the layers together.

BFD offers Building Flow as a done-for-you service: we deploy, debug, monitor, and tune Gary (the AI receptionist) on your real inbound. Contact Brendan at brendan@buildingflowdigital.com to scope a 7-day Building Flow Pilot.

---

## License

MIT — inherited from the upstream open-source project this repo was forked from. Free to use, modify, and deploy.
