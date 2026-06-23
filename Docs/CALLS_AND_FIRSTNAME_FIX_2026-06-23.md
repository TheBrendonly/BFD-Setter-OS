---
description: Diagnosis, fix, deploy and verification guide for the 2026-06-23 "try-gary calls not firing" (Trigger.dev dispatch latency) and literal {{first_name}} issues, plus the system-wide audit sweep.
---

# Calls-not-firing + literal {{first_name}} — fix / deploy / verify guide (2026-06-23)

## TL;DR

- **"BFD setter isn't making calls from try-gary form-fills" is NOT a code bug.** The whole
  pipeline works; the call fires ~20-45 minutes late because the **Trigger.dev prod environment is
  dispatching every run ~20-45 min after it is queued**. The single most important fix is in the
  **Trigger.dev dashboard** (concurrency / plan) — see Part 2. No code change fixes this.
- **The agent speaking literal "{{first_name}}"** is fixed in code (Part 3) for any unknown inbound
  caller; the live greeting wording is a separate UI change you apply (Part 3, step 3).
- A 10-area audit fixed 1 critical + 9 high + a few medium/low bugs found alongside (Part 4), all
  shipped in one commit and deployed (Part 5).

---

## Part 1 — How "no calls" was diagnosed (evidence)

Traced the live test lead **Hayden** (`6Z5aJHqux6h4fUP4SDim`, +61467853118) end to end:

1. Lead created in `leads`, `form_source = bfd_setter-try_gary-mortgage_broker`, not opted out.
2. Enrolled into the **correct** workflow "Try-Gary: Mortgage Broker" (`aad68414`) — active, new-leads
   campaign, phone_call node pointing at an active, provisioned voice setter.
3. Trigger.dev fired; run-engagement reached the phone_call node and placed the call.
4. The call **did connect**: `call_history` row `call_fa814f14ab80de0741ab6fc6e0c` to +61467853118,
   **created 05:38 — 43 minutes after the 04:55 form-fill.**

The delay is pure queue-wait. From the Trigger.dev prod runtime API, every task type
(run-engagement, place-outbound-call, and the hourly crons synthetic-probe / nudge-cold-reply /
refresh-cadence-funnel / analyze-sms-conversation) shows ~16-46 min between `createdAt` and
`startedAt`, then runs in seconds (the call task ran in 4 seconds). The deployment is healthy
(`20260620.3 DEPLOYED`) and only ~3 runs were in flight against a queue limit of 20 — so it is **not**
application concurrency. It is the Trigger.dev environment itself. This is almost certainly also the
real cause of the previously-documented "17-minute inbound-SMS reply latency."

Why it looks like "no call": during testing you give up before the call arrives ~20-45 min later;
and the cadence's first SMS literally says "calling you in 1 minute" while the call lands much later.

How to reproduce / re-check the latency (read-only):

```bash
cd /srv/bfd/Projects/bfd-setter && set -a && source .env && set +a
PK=$TRIGGER_PROD_API_KEY
# list recent runs and eyeball createdAt -> startedAt gap
curl -s "https://api.trigger.dev/api/v1/runs?limit=30" -H "Authorization: Bearer $PK" \
 | python3 -c "import sys,json,datetime
d=json.load(sys.stdin)
for r in d.get('data',[]):
    a,b=r.get('createdAt'),r.get('startedAt')
    g=None
    if a and b:
        g=round((datetime.datetime.fromisoformat(b.replace('Z','+00:00'))-datetime.datetime.fromisoformat(a.replace('Z','+00:00'))).total_seconds()/60,1)
    print(f\"{r.get('taskIdentifier'):22} {r.get('status'):10} queue->start(min)={g}\")"
```

Healthy = seconds. Sick = the ~20-45 min you see today.

---

## Part 2 — THE calls fix: Trigger.dev prod environment (manual, dashboard)

Project: **`proj_fdozaybvhgxnzopabtse`**, environment **prod**. This is the load-bearing fix for the
user-visible symptom; do this before trusting any live call timing.

1. **Concurrency.** Dashboard -> the prod environment -> Concurrency (or Settings -> Concurrency).
   Read the environment concurrency limit. On Hobby/free tiers it is low. The cadence's
   `run-engagement` calls `placeOutboundCall.triggerAndWait(...)`, so an in-progress lead's parent
   run can hold a slot while FROZEN waiting on its own child call run; on a low limit this starves
   the queue (children and even crons wait). **Raise the env concurrency limit (and/or upgrade the
   plan)** well above the steady-state number of simultaneously-running cadences.
2. **Billing / Usage.** Confirm no usage cap or billing issue is throttling the prod environment.
3. **Status / incident.** Check status.trigger.dev for a us-east-1 incident.
4. **Re-measure** with the snippet in Part 1: queued runs should start within seconds.

Code-side mitigation (already partially in this release; deeper change is optional): the
`triggerAndWait` round-trip on the call hot path is the thing that holds a slot. If raising
concurrency is not enough, the follow-up is to fire `placeOutboundCall.trigger()` and poll the
outcome instead of blocking the parent. Left as a future task — raising the env limit is the
first lever.

---

## Part 3 — Literal {{first_name}} fix

Root cause: the agent on +61481614530 (Voice-Setter-Test / setter "Main Outbound",
`agent_f45f4dd…`, LLM `llm_a73df8d…`) has a begin_message "Hey **{{first_name}}**, it's Gary…",
and `retell-inbound-webhook` did not send a `first_name` value for callers not in the CRM, so Retell
rendered the literal token. A caller already in the CRM greeted fine.

Fixed in code (deployed, Part 5):

1. **`retell-inbound-webhook`** now always returns the lead variables (`first_name`, `last_name`,
   `email`, `phone`, `business_name`, `contact_id`) as **empty strings** on every response path, so
   an unknown caller hears "Hey, it's Gary…" — never the literal token.
2. **`retell-proxy`** now sets agent-level **`default_dynamic_variables`** (empty strings) on every
   agent create/update push, as a global safety net for any agent and any unfilled variable.
   Effect is applied to a live agent when that setter is next **Saved/Pushed** from the UI.
3. **You (UI, report-only):** the live inbound greeting is outbound-flavoured ("you put your hand
   up for some info") and reads oddly for cold inbound callers even with the token gone. In the BFD
   setter UI, switch the inbound agent's begin_message to a neutral, variable-free opener (the
   canonical one in `frontend/src/data/bfdVoiceSetterPrompt.md`: "Hey, this is Gary, I'm Brendan's
   AI assistant at Building Flow Digital… What can I help you with?"). Per the no-edit-prompts rule
   this is yours to apply, not the code's.

Verify: call +61481614530 from a number **not** in the CRM — the agent must omit the name, never
say the literal token.

---

## Part 4 — System-wide audit fixes shipped (branch `fix/calls-and-firstname-sweep`)

All verified (0 false positives). File references are in the commit.

CRITICAL
- `ghl-tag-webhook` never passed `make_retell_call_url`, so any lead enrolled via that ingress
  threw at the phone_call node and was never called. Now passes it (like sync-ghl-contact) +
  `runEngagement` has a `SUPABASE_URL` fallback so a missing field can never kill a call again.

HIGH
- `placeOutboundCall` now treats edge-function config 4xx (no setter/agent/api-key/phone, retired
  slot, bad client) as **permanent** -> aborts instead of burning 3 retries then failing the
  cadence opaquely.
- `analyze-sms-conversation` was labelling every inbound lead SMS (channel `"sms"`) as the Setter,
  so the LLM scored a role-swapped transcript and wrote wrong sentiment/intent/qualified to GHL.
  Now classifies by `"outbound"`.
- `llm_model` "~" normalization (was applied at only 1 of 6 OpenRouter sites) consolidated into
  `trigger/_shared/llmModel.ts` and applied at all 5 trigger sites.
- `scheduled_callbacks` had no CREATE TABLE migration (live-only drift, broke a clean rebuild):
  backfilled an idempotent migration (no-op on the live DB).
- Security: tenant-scoped the call-outcome writes in `retell-call-webhook` and `callOutcome.ts` by
  `client_id` (+ an `active_call_id` bind on the non-live webhook); `voice-booking-tools` and
  `kb-ingest` now fail **closed** when `intake_lead_secret` is unset.

MEDIUM / LOW
- E.164-normalize the outbound destination number before Retell; from_number fallback prefers slot 1.

Reported but NOT fixed (own follow-up pass — see the kickoff prompt):
- `make-retell-outbound-call` reads a `messages` table that exists in no migration (voice chat-history
  context silently empty).
- Double GHL note per call when `ghl_conversation_provider_id` is NULL.
- `campaign-enroll-webhook` guessable URL-query token; `twilio-list-numbers` cross-tenant secret RLS;
  `receive-twilio-sms` non-constant-time signature compare; + assorted lows.

Verification done before deploy: `callOutcome` deno tests 12/12; changed edge functions type-check
clean (only pre-existing supabase-js typing noise, identical count at HEAD).

---

## Part 5 — Deploy method (how this was shipped)

```bash
cd /srv/bfd/Projects/bfd-setter && set -a && source .env && set +a

# Edge functions (bundles index + siblings + all _shared, preserves verify_jwt):
for fn in retell-inbound-webhook retell-proxy ghl-tag-webhook analyze-sms-conversation \
          make-retell-outbound-call retell-call-webhook retell-call-analysis-webhook \
          voice-booking-tools kb-ingest; do
  node scripts/deploy_single_fn.mjs "$fn"
done

# Trigger.dev tasks (runEngagement, placeOutboundCall, processSetterReply, sendFollowup,
# runAiJob, nudgeColdReply + new _shared/llmModel.ts):
TRIGGER_ACCESS_TOKEN=$(grep '^TRIGGER_DEPLOY_PAT=' .env | cut -d= -f2) \
  npx -y trigger.dev@4.4.4 deploy --env prod
```

The `scheduled_callbacks` migration is idempotent and the table already exists live, so it is a
no-op — committed for rebuild correctness, not re-run.

---

## Part 6 — Deployment record (2026-06-23, DEPLOYED LIVE)

Commit `49a594e` on `fix/calls-and-firstname-sweep` (merged to `main`).

**Edge functions** (Supabase `bjgrgbgykvjrsuwwruoh`, all `verify_jwt=false`, status ACTIVE):

| function | new version |
|---|---|
| retell-inbound-webhook | v6 |
| retell-proxy | v43 |
| ghl-tag-webhook | v12 |
| analyze-sms-conversation | v2 |
| make-retell-outbound-call | v24 |
| retell-call-webhook | v20 |
| retell-call-analysis-webhook | v24 |
| voice-booking-tools | v21 |
| kb-ingest | v6 |

**Trigger.dev**: prod **`20260623.1`** deployed, 12 tasks detected (includes new
`trigger/_shared/llmModel.ts`). Deployment: cloud.trigger.dev/.../deployments/wpgmf9ws.

**Migration**: `scheduled_callbacks` CREATE TABLE is idempotent; table already existed live -> no-op.

**Verification**:
- `{{first_name}}` fix LIVE-confirmed: `retell-inbound-webhook` for an unknown caller now returns
  `dynamic_variables.first_name = ""` (empty string present, not an absent key) + `phone` echoed.
  So Retell renders nothing instead of the literal token.
- Boot probes (no JWT): make-retell-outbound-call 400, analyze-sms-conversation 403,
  voice-booking-tools 400, kb-ingest 400, retell-call-webhook 200 — all non-5xx, no boot crash.
- `callOutcome` deno tests 12/12 pre-deploy; edge fns type-check clean (pre-existing supabase
  typing noise only).
- **Trigger dispatch latency**: measured ~20-45 min earlier in the day; right after this deploy the
  newest runs dropped to **~2-3 min** (fresh workers / backlog cleared). This may be transient —
  **still do Part 2** (env concurrency / plan) and re-measure over the next hour to confirm it
  stays low under load.

**Still yours (not code):**
1. Trigger.dev dashboard — Part 2 (the durable calls fix).
2. begin_message UI change — Part 3 step 3 (and re-Save the 5 setters so the new
   `default_dynamic_variables` agent config takes effect).
3. Live smoke: a real form-fill -> call within ~1-2 min, and an inbound call from an unknown
   number that omits the name.
