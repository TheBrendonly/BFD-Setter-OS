---
description: Single source of truth for every webhook URL in BFD-setter — inbound (external systems calling us), outbound (us calling them), and legacy/n8n. Use during client onboarding to wire external systems and to know what to test after a deploy.
---

# WEBHOOKS

> **Partially re-verified 2026-07-20** (`Docs/AUDIT_2026-07-20.md`). The URL patterns, tenant-resolution
> rules and §G GHL workflow setup were confirmed accurate. The auth column and §C were stale and have
> been corrected. **This catalogue is still not exhaustive:** it covers the endpoints an operator has to
> wire, not all 97 edge functions.

Catalogue of the HTTP endpoints an operator must wire on the BFD-setter platform.

- **Inbound** = external system calls one of our Supabase edge functions
- **Outbound** = our edge function calls an external service
- **Legacy** = the decommissioned n8n path, kept for provenance

All inbound URLs are on the bfd-platform Supabase project: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/<fn-name>`.

For client-specific examples below the BFD client id `e467dabc-57ee-416c-8831-83ecd9c7c925` is shown. Swap in `{clientId}` for any other tenant.

---

## §A — Inbound (external → us)

### A.1 GoHighLevel

| Endpoint | Function | What it does | Where to wire it in GHL | Auth |
|---|---|---|---|---|
| `bookings-webhook` | [bookings-webhook](../frontend/supabase/functions/bookings-webhook/index.ts) | Receives Appointment Status events. Inserts/updates `bookings` row + cross-links to `cadence_executions` so manual GHL bookings show up in the funnel. Reads `clients.timezone` to parse the TZ-naive merge-tag date strings GHL emits. | **Two workflows per client** (see §G below) — GHL workflow merge tags don't expose `appointmentStatus` / `calendarId` / `locationId`, so each status case needs its own workflow with the values hardcoded. | Optional `clients.ghl_webhook_secret` (HMAC). Currently best-effort. |
| `ghl-tag-webhook` | [ghl-tag-webhook](../frontend/supabase/functions/ghl-tag-webhook/index.ts) | Receives "contact tag added" events. Auto-enrols the lead in any engagement workflow whose `is_new_leads_campaign=true AND new_leads_tag=<added_tag>`. | Workflows → Trigger: Contact Tag Added → Action: Webhook | None today (B5 will add) |
| `sync-ghl-contact` | [sync-ghl-contact](../frontend/supabase/functions/sync-ghl-contact/index.ts) | Inbound contact create/update mirror; populates `leads` row. Also auto-enrols on CREATE path when `clients.auto_engagement_workflow_id` is set. **Primary new-lead ingress for snapshot-imported clients** — see `SOP/CLIENT_ONBOARDING_SOP.md` §5.3 (Pattern B). The snapshot's `Add Lead to 1Prompt OS` workflow webhooks this function (tag-triggered, not form-triggered). Required body fields: `Lead_ID`, `GHL_Account_ID`. Optional: `Name`, `Email`, `Phone`. Requires `clients.sync_ghl_enabled = true` (column added 2026-05-13). | Workflows → Trigger: Contact Tag Added (snapshot pattern) OR Contact Created (greenfield) → Action: Webhook | Optional `ghl_webhook_secret` (HMAC). Currently best-effort; deferred to A6 |

**BFD URLs:**
- Bookings: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook`
- Tag: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/ghl-tag-webhook?clientId=e467dabc-57ee-416c-8831-83ecd9c7c925`
- Contact: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-contact?clientId=e467dabc-57ee-416c-8831-83ecd9c7c925`

### A.2 Twilio

| Endpoint | Function | What it does | Where to wire it in Twilio | Auth |
|---|---|---|---|---|
| `receive-twilio-sms` | [receive-twilio-sms](../frontend/supabase/functions/receive-twilio-sms/index.ts) | **Active inbound SMS path.** Form-encoded POST. Verifies Twilio HMAC sig, resolves client by `clients.retell_phone_1 = To`, finds/creates GHL contact, writes `message_queue` + `dm_executions`, fires Trigger.dev `process-messages`. Mirrors the same SMS to GHL Conversations. Returns `<Response/>` TwiML. | Console → Phone Numbers → Active Numbers → click number → Messaging → "A MESSAGE COMES IN" webhook | Per-client HMAC via `clients.twilio_auth_token`. Override with env `SKIP_TWILIO_SIG_CHECK=true` for first-bring-up only. |
| `twilio-status-webhook` | [twilio-status-webhook](../frontend/supabase/functions/twilio-status-webhook/index.ts) | Receives delivery receipts (queued / sent / delivered / failed / undelivered) → writes `sms_delivery_events`. Powers the SMS error queries in the soak runbook. | Same number → "STATUS CALLBACK URL" | Twilio HMAC |
| `twilio-inbound-sms` | [twilio-inbound-sms](../frontend/supabase/functions/twilio-inbound-sms/index.ts) | **LEGACY.** Older inbound path that resolved client by `clients.twilio_default_phone`. Replaced by `receive-twilio-sms`. Do not point new numbers here. | n/a | n/a |

**BFD URLs (active):**
- Inbound: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/receive-twilio-sms`
- Status callback: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/twilio-status-webhook`

### A.3 Retell

| Endpoint | Function | What it does | Where to wire it in Retell | Auth |
|---|---|---|---|---|
| `voice-booking-tools` | [voice-booking-tools](../frontend/supabase/functions/voice-booking-tools/index.ts) | **5 tools** the voice agent calls mid-call to read/write the GHL calendar. Single edge function; routes by `?tool=<name>` query string. Tenant resolution by `&clientId=<uuid>`. | Retell → LLM → Functions → set URL on each of: `get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments` | `Authorization: Bearer <clients.intake_lead_secret>` header on each tool |
| `retell-call-webhook` | [retell-call-webhook](../frontend/supabase/functions/retell-call-webhook/index.ts) | Receives `call_started`, `call_ended`, transcript events. Writes `call_history`. **Also (since `phase-night-bug1-call-outcome-coordination` 2026-05-13):** on `call_ended`, stamps `engagement_executions.last_call_outcome` keyed by `dynamicVars.execution_id` so `runEngagement.ts` can resume past `phone_call` channels with the disconnect outcome. Shape: `{ call_id, disconnect_reason, call_status, ended_at }`. | Retell → Agent → webhook config | Optional `clients.retell_webhook_secret` HMAC |
| `retell-call-analysis-webhook` | [retell-call-analysis-webhook](../frontend/supabase/functions/retell-call-analysis-webhook/index.ts) | Receives `call_analyzed` (post-call summary, sentiment, appointment_booked). Writes `call_history` analysis fields **and** pushes a GHL Note + 2 custom fields if configured (per `phase-night-ghl-push-gap-1` 2026-05-02). | Retell → Agent → webhook (separate from call events, or same endpoint) | `retell_webhook_secret`, verify-if-present (`index.ts:209`) |
| `retell-inbound-webhook` | [retell-inbound-webhook](../frontend/supabase/functions/retell-inbound-webhook/index.ts) | **Added to this catalogue 2026-07-20 (was missing).** Inbound-call webhook: resolves the tenant and returns per-call dynamic variables to Retell at call start. | Retell → inbound number / agent webhook | `retell_webhook_secret`, verify-if-present (`index.ts:107`) |

**BFD voice tool URLs (5):**
```
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=get-available-slots&clientId=e467dabc-57ee-416c-8831-83ecd9c7c925
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=book-appointments&clientId=e467dabc-57ee-416c-8831-83ecd9c7c925
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=get-contact-appointments&clientId=e467dabc-57ee-416c-8831-83ecd9c7c925
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=update-appointment&clientId=e467dabc-57ee-416c-8831-83ecd9c7c925
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=cancel-appointments&clientId=e467dabc-57ee-416c-8831-83ecd9c7c925
```
Header on each: `Authorization: Bearer <clients.intake_lead_secret>`.

**BFD call event URLs:**
- `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/retell-call-webhook`
- `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/retell-call-analysis-webhook`

### A.4 Unipile (LinkedIn / IG / FB DMs)

| Endpoint | Function | What it does | Where to wire it | Auth |
|---|---|---|---|---|
| `receive-dm-webhook` | [receive-dm-webhook](../frontend/supabase/functions/receive-dm-webhook/index.ts) | Receives inbound social DMs. Mirrors `receive-twilio-sms` shape (queue + execution + Trigger.dev fire). Tenant via `?client_id=` query string. | Unipile → Webhooks | **FAILS CLOSED** since the 2026-06-24 hardening: a secret is required unless `DM_WEBHOOK_REQUIRE_SECRET` is explicitly set false (`receive-dm-webhook/auth.ts:9-14`). |
| `unipile-webhook` | [unipile-webhook](../frontend/supabase/functions/unipile-webhook/index.ts) | Earlier path for Unipile events. Still deployed; check before pointing new accounts here vs `receive-dm-webhook`. | Unipile → Webhooks | Same |

### A.5 Stripe

| Endpoint | Function | What it does | Where to wire it | Auth |
|---|---|---|---|---|
| `stripe-webhook` | [stripe-webhook](../frontend/supabase/functions/stripe-webhook/index.ts) | Handles `customer.subscription.*` events — flips `clients.subscription_status`. Gates app access (memory `project_subscription_gate`). | Stripe Dashboard → Developers → Webhooks → Add endpoint | `Stripe-Signature` HMAC; secret in `STRIPE_WEBHOOK_SECRET` env |

URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/stripe-webhook`

### A.6 Public (web forms)

| Endpoint | Function | What it does | Where to wire it | Auth |
|---|---|---|---|---|
| `intake-lead` | [intake-lead](../frontend/supabase/functions/intake-lead/index.ts) | Embed snippet on the client's website. Receives form submissions, creates GHL contact, fires the new-lead workflow. Tenant via `?clientId=`. | Embed JS snippet on client site | `Authorization: Bearer <clients.intake_lead_secret>` |

### A.7 Internal / triggered-from-app (NOT externally pointed)

These exist as edge functions and accept HTTP, but are called by our own frontend or Trigger.dev — **don't point external systems at them**:

| Function | Triggered by | Notes |
|---|---|---|
| `workflow-inbound-webhook` | App workflow runner | Per-workflow URL with `?workflow_id=` and tenant token |
| `campaign-enroll-webhook` | App / external (token-gated) | Enrols a lead into a specific campaign by token |
| `stop-bot-webhook` | App | JWT-gated; stops in-flight cadences |
| `notify-webhook` | App | CORS-bypass relay for browser → arbitrary URL |
| `push-engagement-now`, `push-followup-now`, `push-dm-now`, `push-contact-to-ghl`, `push-contact-to-external`, `make-retell-outbound-call`, `crm-send-message`, `trigger-engagement`, `stop-engagement`, `stop-dm-execution`, `retry-dm-execution` | App buttons / Trigger.dev | RPC-style; called from the React app or Trigger tasks |

---

## §B — Outbound (us → external)

We call these with API keys/PATs read from per-client `clients` row columns. Not webhooks per se but worth listing because client onboarding needs the credentials.

| Target | Used by | Per-client credential |
|---|---|---|
| GHL — `POST /conversations/messages` (Conversation Provider) | `_shared/ghl-conversations.ts`, `receive-twilio-sms`, `processSetterReply` | `clients.ghl_api_key` + `clients.ghl_conversation_provider_id` (optional — falls back to GHL Notes per 2026-05-02 gap fix) |
| GHL — `POST /contacts/{id}/notes` | `retell-call-analysis-webhook`, fallback for SMS mirror | `ghl_api_key` |
| GHL — `PATCH /contacts/{id}` (custom fields) | `retell-call-analysis-webhook`, channel-routing patches | `ghl_api_key` + per-field id columns |
| GHL — `POST /contacts` | New-lead path inside `intake-lead`, `sync-ghl-contact` | `ghl_api_key` + `ghl_location_id` |
| Twilio — `POST /Messages.json` | `twilio-send-sms`, `processSetterReply` (native engine) | `twilio_account_sid` + `twilio_auth_token` + `retell_phone_1/2/3` |
| Retell — `POST /create-phone-call` | `make-retell-outbound-call`, voice cadence steps | `retell_api_key` + agent ids |
| Retell — `PATCH /update-retell-llm/{id}` | Provisioning scripts (`install-lookup-contact-tool.mjs`, future `repoint_voice_tools.mjs`) | `BFD_RETELL_API_KEY` env (script context) |
| ElevenLabs — agent management | `elevenlabs-manage-agent` | `clients.elevenlabs_api_key` |
| OpenRouter — LLM completions | `runAiJob.ts` (Trigger.dev), `analyze-*`, `generate-*` | `clients.openrouter_api_key` |

---

## §C — Legacy / decommissioned

**Status as of 2026-07-20: the n8n path is DEAD in code.** Both migrations below completed. `processMessages`
now throws rather than calling n8n (`trigger/processMessages.ts:112-113`), so `use_native_text_engine` is
effectively mandatory, and the last in-repo n8n remnants were removed in the 2026-07-10 branding purge.

| URL | Replaced by | Status |
|---|---|---|
| `https://n8n-1prompt.99players.com/webhook/<...>` (text engine) | Native `processSetterReply` in `processMessages.ts` | **DONE.** Phase 9 cutover shipped at `phase-9-bfd-native-cutover` (`319f2a8`); Phase 10 removed the n8n branch. |
| `https://n8n-1prompt.99players.com/webhook/e4cffeea-…` (voice tools) | `voice-booking-tools` edge function | **DONE** (A3). |

Two dead n8n URL literals still sit in code and are harmless but should not be mistaken for live wiring:
`elevenlabs-manage-agent` (`n8n-1prompt.99players.com`) and `voice-booking-tools`
(`primary-production-392b.up.railway.app`).

Whether the **Railway n8n service** is still running is **UNVERIFIABLE FROM REPO**. Shutting it down is
still listed as an open Brendan item in `Docs/SESSION_PLAN.md`.

---

## §D — Per-client URL template (for SOP)

When onboarding Client #N, all URLs follow these patterns. Swap `{clientId}` for the new client's UUID.

```
# Voice tools (5 — set on each tool in the Retell LLM)
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=get-available-slots&clientId={clientId}
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=book-appointments&clientId={clientId}
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=get-contact-appointments&clientId={clientId}
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=update-appointment&clientId={clientId}
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=cancel-appointments&clientId={clientId}
# Header on each: Authorization: Bearer <clients.intake_lead_secret>

# GHL workflows
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/ghl-tag-webhook?clientId={clientId}
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-contact?clientId={clientId}

# Twilio number config
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/receive-twilio-sms          # "A MESSAGE COMES IN"
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/twilio-status-webhook       # "STATUS CALLBACK URL"

# Retell agent webhooks
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/retell-call-webhook
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/retell-call-analysis-webhook

# Stripe (one global endpoint, not per-client)
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/stripe-webhook

# Public form embed (per-client clientId)
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/intake-lead?clientId={clientId}
# Header: Authorization: Bearer <clients.intake_lead_secret>
```

---

## §E — Auth conventions

Verified against code 2026-07-20. The column that matters is **fail-closed vs verify-if-present**:
"verify-if-present" means the endpoint accepts the request UNVERIFIED while the per-client secret is
NULL, and is therefore forgeable until the secret is armed.

| Method | Used by | Behaviour when secret is unset | Where the secret lives |
|---|---|---|---|
| `Authorization: Bearer <intake_lead_secret>` | `voice-booking-tools` (`index.ts:143`), `intake-lead` (`index.ts:313`) | **FAIL CLOSED** (401) | `clients.intake_lead_secret` (`encode(gen_random_bytes(24), 'base64')`) |
| Twilio HMAC-SHA1 (X-Twilio-Signature) | `receive-twilio-sms` (`index.ts:487-501`), `twilio-status-webhook` (`index.ts:147`), `twilio-inbound-sms` | **FAIL CLOSED** (403) | `clients.twilio_auth_token`. **Critical:** verify against the **public** URL, not `req.url` (memory `reference_supabase_deno_req_url`). Note the helper is triplicated across the three functions rather than shared. |
| Stripe sig | `stripe-webhook` (`index.ts:83-84`) | **FAIL CLOSED** (400, "refusing unverified webhook") | env `STRIPE_WEBHOOK_SECRET` |
| Unipile static token | `receive-dm-webhook` (`auth.ts:9-14`) | **FAIL CLOSED** by default (override: `DM_WEBHOOK_REQUIRE_SECRET=false`) | `clients.unipile_webhook_secret` |
| GHL HMAC-SHA256 **or** static `x-wh-token` | `bookings-webhook` (`index.ts:193`), `sync-ghl-contact` (`index.ts:352-354`), `ghl-tag-webhook` (`index.ts:403-405`), `workflow-inbound-webhook` (`index.ts:98-107`) | **verify-if-present** (forgeable while NULL) | `clients.ghl_webhook_secret`, auto-generated by `webhook-manifest` |
| Retell HMAC-SHA256 (`X-Retell-Signature: v=ts,d=hex`) | `retell-call-webhook` (`index.ts:141`), `retell-call-analysis-webhook` (`index.ts:209`), `retell-inbound-webhook` (`index.ts:107`) | **verify-if-present** (forgeable while NULL) | `clients.retell_webhook_secret`. Deliberately NOT auto-generated (`webhook-manifest/index.ts:13`). |
| Unipile static token | `unipile-webhook` (`index.ts:55-63`) | **verify-if-present**, and the scheme itself is **unconfirmed** | `clients.unipile_webhook_secret`. `_shared/verify-webhook.ts:76-86` says to confirm the exact header/value against Unipile's live config before arming it; leave NULL (inert) until then. |
| Token query string / header | `campaign-enroll-webhook` (`index.ts:27`) | 400 when absent | DB-issued tokens per campaign |

**Retell signature scheme** (`_shared/verify-webhook.ts:33-77`): parse `X-Retell-Signature: v={ts},d={hex}`,
enforce a 5-minute replay window, compute `HMAC_SHA256(rawBody + ts, RETELL_API_KEY)`, constant-time compare.
Note it is keyed by the **API key**, not by a separate signing secret (memory `project_webhook_sig_verify_scheme_bug`).

**Arming the remaining secrets is a first-client gate,** tracked in `Docs/FIRST_CLIENT_TASKS.md`, not here.
Once a per-client secret is populated, signature mismatches return 403 and will silently kill inbound
traffic, so get a known-good baseline first. `webhook-manifest` is the registry that generates and persists
`ghl_webhook_secret` + `intake_lead_secret` (`webhook-manifest/index.ts:68`).

---

## §F — Troubleshooting

- **A webhook returns 401/403:** check the Bearer or HMAC header — most likely the per-client secret was rotated or never set.
- **A webhook returns 404 / wrong tenant:** double-check the `?clientId=` query param matches a row in `clients`.
- **A webhook works locally but not in Twilio/Retell:** memory `reference_supabase_deno_req_url` — `req.url` inside the edge function is the **internal** host, not the public one. Reconstruct the public URL from `SUPABASE_URL` env when verifying HMACs.
- **Inbound SMS hangs at `.maybeSingle()`:** memory `feedback_probe_no_shared_phone` — two clients with the same `retell_phone_1` cause `PGRST116`. Check for duplicate phone-number provisioning.
- **Engagement workflows return "No campaigns yet":** check `engagement_workflows` has `sort_order` + `is_active` columns (added 2026-05-03 in `phase-night-engagement-workflows-missing-cols`).

---

---

## §G — `bookings-webhook` GHL workflow setup (per-tenant)

The GHL **workflow custom-webhook** action only exposes a curated subset of merge tags — `{{contact.id}}`, `{{appointment.id}}`, `{{appointment.start_time}}`, `{{appointment.end_time}}`, and `{{appointment.user.*}}`. **Not** exposed: `appointmentStatus`, `calendarId`, `locationId`, `contactId` as `{{appointment.contact_id}}`. (The full payload IS available via the marketplace-app webhook subscription, but that requires a registered GHL Marketplace app — out of scope for now.)

Workaround: build **two workflows per tenant**, each filtered to one status case, with the missing fields hardcoded in the body. For BFD this is one calendar + one location, so two workflows total. For multi-calendar tenants in the future, build one pair per calendar.

**Workflow #1 — BOOKED**
- Trigger × 2 rows (OR'd): Appointment Status, Event Type=Normal, "Appointment status is" filter set to `new` on row 1 and `confirmed` on row 2. Both rows feed the same downstream action.
- Custom Webhook action — `application/x-www-form-urlencoded`, `POST` to `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook`, no auth header.
- Body (8 key-value rows):
  ```
  appointmentId = {{appointment.id}}
  contactId     = {{contact.id}}
  calendarId    = <hardcode the tenant's calendar id>
  locationId    = <hardcode the tenant's location id>
  startTime     = {{appointment.start_time}}
  endTime       = {{appointment.end_time}}
  status        = confirmed       # hardcoded — workflow only fires on new/confirmed
  type          = appointment
  ```

**Workflow #2 — CANCELLED**
- Trigger: Appointment Status, Event Type=Normal, "Appointment status is" = `cancelled`.
- Same Custom Webhook URL + body shape, except: `status = cancelled` (hardcoded).

**Optional — SHOWED / NO-SHOW:** copy the CANCELLED workflow, change the filter to `Showed` (status=`attended`) or `No-show` (status=`no_show`). Not required for the funnel today; add when those events need tracking.

**Per-client values to substitute:**

| Key | BFD value | Where to find it |
|---|---|---|
| `calendarId` | `2p9eg0Qv7QoKknk1Sp2d` | `clients.ghl_calendar_id` |
| `locationId` | `xo0XjmenBBJxJgSnAdyM` | `clients.ghl_location_id` |

Per-client `timezone` (`clients.timezone`, default `Australia/Sydney`) is read by the function to interpret the TZ-naive date strings GHL emits — set it correctly per tenant during onboarding or `appointment_time` will land off by the offset.

---

**Last updated:** 2026-07-20 (docs audit: §C n8n marked decommissioned, §E rewritten as fail-closed vs
verify-if-present with code citations, `retell-inbound-webhook` added, `receive-dm-webhook` corrected to
fail-closed). Previous update 2026-05-05 (A4 closed — bookings-webhook live, two-workflow GHL pattern
documented, `clients.timezone` added).
