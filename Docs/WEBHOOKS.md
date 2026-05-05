---
description: Single source of truth for every webhook URL in 1prompt-OS — inbound (external systems calling us), outbound (us calling them), and legacy/n8n. Use during client onboarding to wire external systems and to know what to test after a deploy.
---

# WEBHOOKS

Catalogue of every HTTP endpoint involved in the 1prompt-OS / BFD-setter platform.

- **Inbound** = external system calls one of our Supabase edge functions
- **Outbound** = our edge function calls an external service
- **Legacy** = currently still pointed at n8n; being migrated to native edge functions

All inbound URLs are on the bfd-platform Supabase project: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/<fn-name>`.

For client-specific examples below the BFD client id `e467dabc-57ee-416c-8831-83ecd9c7c925` is shown. Swap in `{clientId}` for any other tenant.

---

## §A — Inbound (external → us)

### A.1 GoHighLevel

| Endpoint | Function | What it does | Where to wire it in GHL | Auth |
|---|---|---|---|---|
| `bookings-webhook` | [bookings-webhook](../frontend/supabase/functions/bookings-webhook/index.ts) | Receives Calendar Events (Created / Updated / Cancelled). Inserts/updates `bookings` row + cross-links to `cadence_executions` so manual GHL bookings show up in the funnel. | Workflows → New → Trigger: Calendar Events → Action: Webhook | Optional `clients.ghl_webhook_secret` (HMAC). Currently best-effort. |
| `ghl-tag-webhook` | [ghl-tag-webhook](../frontend/supabase/functions/ghl-tag-webhook/index.ts) | Receives "contact tag added" events. Auto-enrols the lead in any engagement workflow whose `is_new_leads_campaign=true AND new_leads_tag=<added_tag>`. | Workflows → Trigger: Contact Tag Added → Action: Webhook | None today (B5 will add) |
| `sync-ghl-contact` | [sync-ghl-contact](../frontend/supabase/functions/sync-ghl-contact/index.ts) | Inbound contact create/update mirror; populates `leads` row. Used as a webhook target for GHL "Contact Created" workflow. | Workflows → Trigger: Contact Created → Action: Webhook | Optional `ghl_webhook_secret` |

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
| `retell-call-webhook` | [retell-call-webhook](../frontend/supabase/functions/retell-call-webhook/index.ts) | Receives `call_started`, `call_ended`, transcript events. Writes `call_history`. | Retell → Agent → webhook config | Optional `clients.retell_webhook_secret` HMAC |
| `retell-call-analysis-webhook` | [retell-call-analysis-webhook](../frontend/supabase/functions/retell-call-analysis-webhook/index.ts) | Receives `call_analyzed` (post-call summary, sentiment, appointment_booked). Writes `call_history` analysis fields **and** pushes a GHL Note + 2 custom fields if configured (per `phase-night-ghl-push-gap-1` 2026-05-02). | Retell → Agent → webhook (separate from call events, or same endpoint) | Optional `retell_webhook_secret` |

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
| `receive-dm-webhook` | [receive-dm-webhook](../frontend/supabase/functions/receive-dm-webhook/index.ts) | Receives inbound social DMs. Mirrors `receive-twilio-sms` shape (queue + execution + Trigger.dev fire). Tenant via `?client_id=` query string. | Unipile → Webhooks | Per-client `clients.unipile_webhook_secret` (HMAC). Currently optional. |
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

## §C — Legacy / being decommissioned

| URL | Replaced by | Status |
|---|---|---|
| `https://n8n-1prompt.99players.com/webhook/<...>` (text engine) | Native `processSetterReply` in `processMessages.ts` | Phase 9 cutover for BFD shipped at `phase-9-bfd-native-cutover` (`319f2a8`). 14-day soak day 5/14 as of 2026-05-04. Phase 10 = delete the n8n branch + drop `clients.text_engine_webhook`. |
| `https://n8n-1prompt.99players.com/webhook/e4cffeea-…` (voice tools) | `voice-booking-tools` edge function | A3 in progress 2026-05-04. |

After A3 + Phase 10, n8n hosts nothing for BFD and the Railway n8n service can be shut down.

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

| Method | Used by | Where the secret lives |
|---|---|---|
| `Authorization: Bearer <intake_lead_secret>` | `voice-booking-tools`, `intake-lead` | `clients.intake_lead_secret` (`encode(gen_random_bytes(24), 'base64')`) |
| Twilio HMAC-SHA1 (X-Twilio-Signature header) | `receive-twilio-sms`, `twilio-status-webhook` | `clients.twilio_auth_token`. **Critical:** verify against the **public** URL, not `req.url` (memory `reference_supabase_deno_req_url`). |
| GHL HMAC | `bookings-webhook`, `sync-ghl-contact`, optional on others | `clients.ghl_webhook_secret`. Currently best-effort, will be enforced in A6. |
| Retell HMAC | `retell-call-webhook`, `retell-call-analysis-webhook` | `clients.retell_webhook_secret`. Currently optional. |
| Stripe sig | `stripe-webhook` | env `STRIPE_WEBHOOK_SECRET` |
| Token query string | `campaign-enroll-webhook`, `workflow-inbound-webhook` | DB-issued tokens per workflow / campaign |

**A6 (signature verification ON for GHL + Retell + Twilio + Unipile) is the LAST step of Phase A** — once the per-client secrets are populated, sig mismatches return 403 and silently kill inbound traffic. Get a known-good baseline first.

---

## §F — Troubleshooting

- **A webhook returns 401/403:** check the Bearer or HMAC header — most likely the per-client secret was rotated or never set.
- **A webhook returns 404 / wrong tenant:** double-check the `?clientId=` query param matches a row in `clients`.
- **A webhook works locally but not in Twilio/Retell:** memory `reference_supabase_deno_req_url` — `req.url` inside the edge function is the **internal** host, not the public one. Reconstruct the public URL from `SUPABASE_URL` env when verifying HMACs.
- **Inbound SMS hangs at `.maybeSingle()`:** memory `feedback_probe_no_shared_phone` — two clients with the same `retell_phone_1` cause `PGRST116`. Check for duplicate phone-number provisioning.
- **Engagement workflows return "No campaigns yet":** check `engagement_workflows` has `sort_order` + `is_active` columns (added 2026-05-03 in `phase-night-engagement-workflows-missing-cols`).

---

**Last updated:** 2026-05-04 (A3 in flight — voice tool repoint pending)
