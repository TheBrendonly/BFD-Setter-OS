# Client Onboarding SOP - BFD-setter

The canonical, end-to-end procedure for onboarding a new client from zero. Written so a
non-technical operator (or a future Claude session) can run it without making decisions in the
moment. Every decision that needs a human is called out explicitly.

**Last reconciled against the live build: 2026-06-17.** If you are reading this much later, spot-check
the column names in section 1.5 against `frontend/src/integrations/supabase/types.ts` and the inbound
webhook list in section 5 against the in-app **API Credentials -> Inbound Webhooks** card (the
`webhook-manifest` edge function is the live source of truth).

**Time estimate:** about half a day of focused operator work plus roughly 1 hour of client time
across two calls.

**Channel scope (important):** BFD is **SMS-only** today. Outbound email and outbound social DM are
not live. Inbound DM / WhatsApp is a roadmap item (the engine hard-fails non-SMS outbound on
purpose). Do not promise email or DM sending to a client.

---

## 0. Hosting and billing model (read first)

This is the spine the whole SOP hangs on. Decided 2026-06-17.

### Who owns, pays, and configures what

| Component | Owns | Pays | Configures | Notes |
|---|---|---|---|---|
| **Twilio** (number, SMS, AU regulatory/A2P bundle) | **Client** | **Client** (Twilio bills the client) | BFD | BYO per client. The client is carrier of record. One number per client. |
| **GoHighLevel** | **Per client** (see below) | BFD-provided: bundled. Client-owned: client. | BFD | The one per-client variable. Path A = BFD-provided sub-account; Path B = client-owned location. |
| **Retell** (voice agents, LLMs, phone wiring) | **BFD** | Bundled in BFD fee | BFD | Per-client agents live in BFD's Retell account under BFD's key. Voice prompts stay BFD-managed. |
| **Supabase** (per-client data backend: chat_history / leads / prompts) | **BFD** | Bundled | BFD | BFD provisions the project (section 2.1). Client manages nothing. |
| **OpenRouter** (LLM inference key) | **BFD** | Bundled | BFD | BFD's key, stored per client. |
| **BFD-setter platform** + Trigger.dev | **BFD** | The managed fee | BFD | Shared infra. |

### The billing line (what you tell the client)

One BFD managed monthly fee covers Retell, Supabase, OpenRouter, the BFD-setter platform, GHL when
BFD-provided, plus setup and support. The client pays Twilio directly for the number, SMS usage, and
the AU regulatory bundle. BFD owns config and uptime for everything except the Twilio account itself.

### The one architectural fact to internalise

**Outbound SMS sends DIRECT via the Twilio REST API. GoHighLevel only mirrors the conversation
thread; it is not in the send path.** (Verified: `trigger/_shared/sendTwilioSmsAndStamp.ts` posts to
`api.twilio.com/.../Messages.json`, stamps `message_queue`, then calls `pushSmsToGhl` only when the
GHL credentials are present.) Consequently:

- The 5 legacy `leadconnectorhq` outbound webhook fields are **retired from the UI** (the DB columns
  are kept but you do not wire them).
- GHL credentials (`ghl_api_key` + `ghl_location_id`) are **optional for sending**: if absent, SMS
  still sends and only the GHL mirror is skipped. They remain **required for lead ingress** and
  strongly recommended for operator visibility.

### GHL hosting: pick the path per client

- **Path A - BFD-provided sub-account (default for clients without GHL):** BFD's GHL agency spins up
  a location from the BFD snapshot and controls forms, automations, calendar, and the mirror.
- **Path B - client-owned GHL (when they already run GHL):** the client gives BFD a Private
  Integration Token into their location and BFD installs the snapshot there.

Both paths converge on the same two BFD fields: `clients.ghl_location_id` and `clients.ghl_api_key`.
Everything downstream in this SOP is identical once those are set.

> **HubSpot clients (deferred):** if a client uses HubSpot as their primary CRM, GHL is used for the
> booking calendar only. The HubSpot + GHL coexistence model is designed but **not yet in the
> provisioning path**, so treat it as out of scope for now and revisit when it is automated. Context:
> [HUBSPOT_CLIENT_RECOMMENDATION.md](../Docs/HUBSPOT_CLIENT_RECOMMENDATION.md) and
> [HUBSPOT_GHL_COEXISTENCE_ANALYSIS.md](../Docs/HUBSPOT_GHL_COEXISTENCE_ANALYSIS.md).

---

## 1. Pre-sales discovery and client intake

Collect everything here before you provision anything. Save the answers to
`Operations/handoffs/<date>-<client>-discovery.md`.

### 1.1 Hosting decisions (make these first)

- **GHL path:** does the client already use GHL? Yes -> Path B (client-owned). No -> Path A
  (BFD-provided). HubSpot primary -> GHL calendar-only, flag the deferred HubSpot note in section 0.
- Confirm the client understands the billing line: managed BFD fee plus client-paid Twilio.

### 1.2 Business and compliance basics

- Legal business name and **ABN** (needed for the AU Twilio regulatory bundle).
- Brand name, website, support email, business hours.
- Timezone (single state or multi-state). Maps to `clients.timezone` and `cadence_quiet_hours.tz`.
- Region and compliance: AU Spam Act (no SMS to fixed lines), consent provenance for every lead
  source in writing. STOP keyword handling is automatic (baked into `receive-twilio-sms`).
- Quiet hours: the window when contact is allowed (start, end, days of week).

### 1.3 Twilio intake (BYO, client-owned)

The client owns and pays Twilio; BFD configures it. Collect:

- Does the client already have a Twilio account? If not, they create one (BFD can screen-share).
- AU number to use or purchase (one DID per client to start).
- ABN and business details for the AU regulatory / A2P bundle. The client owns this registration.
- Who administers the Twilio login on the client side.
- Once provisioned, collect: **Account SID**, **Auth Token**, **the E.164 number**.

### 1.4 ICP, persona, brand tone, booking rules

- Target audience, offer, qualification rules.
- Which persona / voice agent (or the standard Main Outbound). For Try-Gary or multi-persona, see
  [PERSONA_SETUP.md](PERSONA_SETUP.md).
- Brand tone (e.g. Aussie warm vs US direct), banned words, sign-off convention (first name only).
- Booking: which calendar, availability, who is assigned to appointments, how the appointment should
  read on the client's calendar (booking title).

### 1.5 The value-to-column collection table

Every value you will paste into the client row or the app. BFD-managed values you generate yourself;
client-owned values you collect from the client.

| # | Field | Source | Where it lives |
|---|---|---|---|
| 1 | `agency_id` | BFD | `clients.agency_id` |
| 2 | Display name | client | `clients.name` |
| 3 | `ghl_location_id` | client (Path B) or BFD (Path A) | `clients.ghl_location_id` |
| 4 | `ghl_api_key` (PIT: Contacts, Conversations, Calendars, Workflows, CustomFields) | client or BFD | `clients.ghl_api_key` |
| 5 | `ghl_calendar_id` | client | `clients.ghl_calendar_id` |
| 6 | `ghl_assignee_id` | client | `clients.ghl_assignee_id` |
| 7 | `twilio_account_sid` | **client (BYO)** | `clients.twilio_account_sid` |
| 8 | `twilio_auth_token` | **client (BYO)** | `clients.twilio_auth_token` |
| 9 | Client Twilio number (E.164) | **client (BYO)** | `clients.twilio_default_phone` and `clients.retell_phone_1` |
| 10 | `retell_api_key` | **BFD** (BFD-managed Retell) | `clients.retell_api_key` |
| 11 | `retell_inbound_agent_id` | BFD (created via app) | `clients.retell_inbound_agent_id` |
| 12 | `retell_outbound_agent_id`, `retell_outbound_followup_agent_id` | BFD | same-named columns |
| 13 | `retell_agent_id_4..10` (extra voice setter slots, as needed) | BFD | same |
| 14 | `openrouter_api_key` | **BFD** | `clients.openrouter_api_key` |
| 15 | `llm_model` (text engine) | BFD | `clients.llm_model` (script default `openai/gpt-4.1-nano`; confirm canonical value, see section 11) |
| 16 | External Supabase URL + service key (+ table, default `leads`) | **BFD** (you provision, section 2.1) | `clients.supabase_url`, `clients.supabase_service_key`, `clients.supabase_table_name` |
| 17 | `timezone` (IANA) | client | `clients.timezone` (default `Australia/Sydney`) |
| 18 | Quiet hours JSON (start/end/tz/days) | client | `clients.cadence_quiet_hours` |
| 19 | Brand tone notes + banned words | client | the client's `text_prompts` row (external Supabase) |
| 20 | `ghl_conversation_provider_id` (optional, for the polished mirror) | BFD | `clients.ghl_conversation_provider_id` |

Secrets generated for you, not collected: `intake_lead_secret` and `ghl_webhook_secret` are minted
automatically (by the onboard script / Onboarding page / webhook-manifest). `retell_webhook_secret`
is deferred (section 11).

---

## 2. Provision the BFD-managed backend (before the client row)

### 2.1 External Supabase project (BFD provisions)

Each client gets a "setter-live" Supabase project that holds chat history, prompts, and the leads
mirror. BFD owns and pays for it.

1. supabase.com/dashboard -> New project, in the BFD agency org, region closest to the client.
2. Name it `<client-slug>-setter-live`. Record the project ref.
3. Settings -> API: grab the **Project URL** and the **`sb_secret_*` service role key** (and the
   `sb_publishable_*` anon key if needed). As of 2026-04-29 only `sb_secret_*` / `sb_publishable_*`
   are valid (legacy JWTs disabled).
4. SQL Editor -> run the seed:

```sql
-- pgvector for KB embeddings (optional but recommended)
CREATE EXTENSION IF NOT EXISTS vector;

-- chat_history (setter reply / followup target)
CREATE TABLE chat_history (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,            -- the GHL contact id
  message jsonb NOT NULL,              -- LangChain { type: 'human' | 'ai', content, ... }
  timestamp timestamptz DEFAULT now()
);
CREATE INDEX chat_history_session_idx ON chat_history (session_id, timestamp);

-- text_prompts (one row per AI persona / setter slot)
CREATE TABLE text_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_name text UNIQUE NOT NULL,      -- e.g. 'Setter-1'
  system_prompt text,
  temperature numeric DEFAULT 0.7,
  model text DEFAULT 'openai/gpt-4.1-nano',
  updated_at timestamptz DEFAULT now()
);

-- voice_prompts (Retell agent prompt overrides + dynamic vars)
CREATE TABLE voice_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setter_slot text UNIQUE NOT NULL,    -- 'voice-setter-1' .. 'voice-setter-10'
  system_prompt text,
  voice_id text,
  updated_at timestamptz DEFAULT now()
);

-- documents (KB target for kb-ingest)
CREATE TABLE documents (
  id bigserial PRIMARY KEY,
  source_url text, title text, content text,
  embedding vector(1536), metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- leads mirror (dual-write target from platform.leads)
CREATE TABLE leads (
  id text PRIMARY KEY,                 -- GHL contact id
  first_name text, last_name text, email text, phone text,
  source text, tags text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Done when:** the five tables exist and you have the Project URL + service key recorded.

### 2.2 Retell prep (BFD-managed account)

Voice agents live in BFD's Retell account. You do not hand-build agents per slot; the app creates
them when you create a setter (section 4.3). The slot columns the system uses:

1. `retell_inbound_agent_id` - answers when leads call in.
2. `retell_outbound_agent_id` - first outbound call to a new lead.
3. `retell_outbound_followup_agent_id` - follow-up calls.
4. `retell_agent_id_4..10` - extra voice setter slots (used when a cadence node names a `voice_setter_id`).

Voicemail is **Retell-native** (configured later in Sub-Account Settings: Hangup, Static text, or
Dynamic prompt). There is no separate voicemail agent and no Twilio AMD voicemail-drop.

> **Standing rule:** never edit voice/LLM prompt content (in Retell or in repo prompt files). Prompts
> are managed by Brendan through the BFD setter UI. If you find a prompt problem, report the exact
> location and recommended change; do not apply it.

### 2.3 OpenRouter (BFD key)

Use BFD's OpenRouter key for the client (`clients.openrouter_api_key`). Set `clients.llm_model` for
the text engine (see section 11 for the canonical value to confirm).

### 2.4 GHL prep (both paths converge)

1. Confirm the location id by hitting `GET https://services.leadconnectorhq.com/locations/<location-id>`
   with the PIT (expect 200).
2. Confirm the PIT scopes: Contacts, Conversations, Calendars, Workflows, Custom Fields.
3. Path A: create the location from the BFD snapshot. Path B: install the snapshot into the client's
   location. Either way, build the GHL automations per [GHL_SETUP.md](GHL_SETUP.md) (forms, routing
   tags, the one central "Add Lead" webhook, and the two booking webhooks).

### 2.5 Per-provider model (quick reference)

| Provider | Model | Client provides |
|---|---|---|
| Platform Supabase (`bjgrgbgykvjrsuwwruoh`) | shared | nothing |
| External Supabase | per-client, **BFD provisions** | nothing |
| GHL | per-client (Path A or B) | location id + PIT (Path B) |
| Retell | **BFD-managed**, multi-agent | nothing |
| OpenRouter | **BFD key** | nothing |
| Twilio | **BYO, client-owned** | SID + auth token + number |
| Trigger.dev | shared (`proj_fdozaybvhgxnzopabtse`) | nothing |

---

## 3. Create the client record

### 3.1 Run the onboard script (recommended)

`scripts/onboard-client.mjs` does the SQL portion: inserts the client row, creates the GHL
`last_synced_from` custom field, clones the BFD default workflow, and prints a follow-up checklist.

```bash
node --env-file=.env scripts/onboard-client.mjs \
  --name "Client Display Name" \
  --agency-id <agency-uuid> \
  --ghl-location-id <id> \
  --ghl-pit <pit> \
  --twilio-sid <client-sid> \
  --twilio-token <client-auth-token> \
  --twilio-phone <client-e164> \
  --default-tz "Australia/Brisbane" \
  [--retell-api-key <key>] [--openrouter-key <key>] [--llm-model <model>] \
  [--external-supabase-url <url>] [--external-supabase-service-key <key>] \
  [--ghl-calendar-id <id>] [--ghl-assignee-id <id>] \
  [--retell-inbound-agent-id <id>] [--retell-outbound-agent-id <id>] \
  [--retell-outbound-followup-agent-id <id>] [--dry-run]
```

Required env vars (in `.env`): `SUPABASE_PAT` (Management API token `sbp_*`) and
`SUPABASE_PROJECT_REF` (defaults to `bjgrgbgykvjrsuwwruoh`). Run `--dry-run` first to preview the SQL
and the GHL POST.

What it writes to the client row: `ghl_location_id`, `ghl_api_key`, `twilio_account_sid`,
`twilio_auth_token`, `twilio_default_phone`, **`retell_phone_1` (set equal to the Twilio number)**,
`llm_model` (default `openai/gpt-4.1-nano`), `subscription_status` (default **`active`**),
`cadence_quiet_hours` (09:00-21:00 weekdays in the given tz), `intake_lead_secret`,
`use_native_text_engine = true`, `dm_enabled = false`, plus any optional flag you pass.

What it does NOT set (you finish these in the app, sections 4-6): `ghl_calendar_id`,
`ghl_assignee_id`, the Retell agent ids, `supabase_url` / `supabase_service_key`,
`ghl_webhook_secret`, `retell_webhook_secret`, `ghl_channel_field_id`, voicemail config, and
`auto_engagement_workflow_id` (the go-live flip).

> **Note on the from-number:** outbound SMS uses `retell_phone_1` first and falls back to
> `twilio_default_phone`. The script sets both to the client's Twilio number, so a single-number
> client is correct out of the box.

**Done when:** the script prints a `client_id`, `intake_lead_secret`, `cloned_workflow_id`, and the
`ghl_last_synced_from_field_id`. Record these (the `intake_lead_secret` is printed once and cannot be
retrieved later without admin DB access).

### 3.2 Reference: the raw INSERT (if not using the script)

Run against `bjgrgbgykvjrsuwwruoh` via the Supabase Management API. Same columns as the script; the
load-bearing values are the Twilio trio + number, `ghl_location_id` + `ghl_api_key`,
`use_native_text_engine = true`, `subscription_status = 'active'`, `dm_enabled = false` (until soft
launch), `cadence_quiet_hours`, `intake_lead_secret`, and `timezone`. Leave
`auto_engagement_workflow_id` NULL until after copy review (section 8). Voicemail is Retell-native, so
do not populate any AMD voicemail-audio field.

### 3.3 GHL last_synced_from field + echo-loop guard

The script creates the GHL `last_synced_from` custom field and stores its id in
`clients.ghl_last_synced_from_field_id`. This is the echo-loop guard: `sync-ghl-contact` skips inbound
webhooks that BFD itself stamped. The stamp value lives in `clients.ghl_last_synced_from_field_value`
(use a short distinctive per-client slug, e.g. `acme-co`; do not leave it on a generic default).
**Done when:** editing a contact in the platform UI does not fire an extra `sync_ghl_executions` row.

### 3.4 Clone the default workflow

The script clones BFD's canonical default cadence (`40e8bea3-b6f6-4562-98d1-f7e6599af6a1`) into the
new client, inactive. Do not set `auto_engagement_workflow_id` to it yet (copy review first).

---

## 4. Configure in the app

### 4.1 API Credentials page

Open the client's **API Credentials** page and fill the groups that the script left blank:

- **Supabase group:** `supabase_url`, `supabase_service_key` (+ optional access token for the usage
  dashboard).
- **LLM group:** `openrouter_api_key` (+ optional management key for billing data), `llm_model`.
- **Retell:** `retell_api_key`.
- **GHL group:** `ghl_api_key`, `ghl_location_id`, `ghl_calendar_id`, `ghl_assignee_id`, booking
  title.

> **Gap to be aware of:** Twilio credentials (`twilio_account_sid`, `twilio_auth_token`,
> `twilio_default_phone`) are **not editable in the UI today**. They are set by the onboard script or
> via SQL only. If you need to change them later, use SQL. (Tracked in section 11.)

### 4.2 Sub-Account Settings

Open **Sub-Account Settings** (`/client/<client-uuid>/settings`) and configure each card:

- **Timezone** (IANA). Must match `clients.timezone` and the `tz` in `cadence_quiet_hours`.
- **Contact hours** (the cadence quiet-hours window): start, end, days. The card's preview line
  ("within window: Yes/No") confirms the semantics. Falls back to 09:00-21:00 if NULL.
- **Voicemail** (Retell-native): Hangup (default), Static text, or Dynamic prompt, plus
  voicemail-detection toggle and timeout. Save & Push PATCHes `voicemail_option` on every Retell
  agent across the client's slots (no separate publish step).
- **Brand voice**, **cost ceilings** (weekly / monthly, advisory only: they log a breach, they do not
  auto-pause), **logo / description**.

### 4.3 Create and configure the setter(s)

Create the voice and/or text setter(s) for the client (the Voice-Setter editor lives at
`/client/<client-uuid>/prompts/voice`).

> **Known bug + workaround (live build, 2026-06-17):** creating a new voice setter on the currently
> deployed app may produce a setter that is not bookable (only 3 tools, no booking flow), because the
> create-setter path does not run the booking-config wizard. **Workaround:** after creating the setter,
> turn the **Booking Function** toggle ON, then **Save** and **Push**. That injects the 5 booking tools.
>
> A fix that makes new setters "born bookable" (model `gemini-3.0-flash`, all 8 tools,
> `booking_function_enabled = true`) is **committed on branch `fix/create-setter-bookable` but not yet
> merged to `main` or deployed** as of 2026-06-17. Until it deploys, apply the workaround and verify the
> agent has the booking tools after Push.

Other things you may hit in the setter editor:

- **Voice picker:** choose a preset or paste any Retell-known voice id. A removed/invalid preset
  (e.g. the old `11labs-Matt`) causes `Retell API error [404] ... not found from voice` on Save;
  pick a current voice and re-save.
- **Publish warning ("Saved + patched, but NOT published"):** the auto-publish step failed. Re-Save,
  or publish the latest version in the Retell dashboard.

### 4.4 Cadence and content review (with the client)

1. Open the cloned workflow in the Engagement editor.
2. Replace every `[BRENDAN: ...]` placeholder with client-approved copy.
3. Apply tone rules: first-touch SMS under 160 chars, `{{first_name}}` not full name, sign-off first
   name only.
4. Set `delay_seconds` per node. Set quiet hours and voicemail in the Cadence Settings bar.
5. Set the **NEW LEADS** toggle ON for this one workflow and enter the GHL routing tag (e.g.
   `bfd_setter-new_lead`). At most one workflow per client may be ON. This value becomes the
   workflow's `new_leads_tag`, and the inbound routing tag must match it exactly.

Do not flip `auto_engagement_workflow_id` yet (dry-run first, section 7).

---

## 5. Inbound wiring - GHL, Twilio, web form (click-paths)

> **Start here:** open **API Credentials -> Inbound Webhooks** in the app. That card (backed by the
> `webhook-manifest` edge function) computes every inbound URL, shows the `x-wh-token`
> (`ghl_webhook_secret`) and `intake_lead_secret`, marks each row secured / forgeable, and shows
> "last received" so you can confirm the paste worked. For each row: **Copy URL -> Copy token ->
> paste into the named tool -> watch "last received" go green.** The sub-sections below are the
> reference for WHERE in each tool to paste and what each handler does. Section numbers match the
> manifest's `sopRef` values.

For the full GHL automation build (forms, routing tags, the central webhook, bookings), follow
[GHL_SETUP.md](GHL_SETUP.md). The summary below is the BFD-side mapping.

### 5.2 intake-lead (web form)

For a website form, POST to `.../functions/v1/intake-lead` with header
`Authorization: Bearer <intake_lead_secret>` and body `{ clientId, first_name, last_name, phone,
email, source }`. Hand the client the snippet with `<client-uuid>` and `<intake_lead_secret>` filled
from section 3.1.

### 5.3 sync-ghl-contact (main lead ingress) + the GHL webhook secret

This is the canonical lead ingress. Two patterns:

- **Pattern B (default, snapshot clients):** the snapshot's "Add Lead" workflow fires on a
  routing-tag add and POSTs the standard Outbound Webhook to `.../sync-ghl-contact`. The function
  resolves the client by `location.id`. This is the norm.
- **Pattern A (greenfield, no snapshot):** use `ghl-tag-webhook` (section 5.4) instead.

**Secret:** generate a random `ghl_webhook_secret` (the Inbound Webhooks card mints it for you), then
add a custom header `x-wh-token: <secret>` to each GHL Custom Webhook action that POSTs to BFD. Once
set, all six GHL handlers (`sync-ghl-contact`, `sync-ghl-booking`, `workflow-inbound-webhook`,
`bookings-webhook`, `receive-dm-webhook`, `ghl-tag-webhook`) verify the token (or an HMAC
`x-wh-signature`) and 403 anything else. Note: GHL native Webhook V2 signs with an RSA key, not an
HMAC shared secret, so use the **Workflow -> Custom Webhook** action with the static token, not native
Webhook V2.

**Done when:** a test lead creates a `leads` row and an `engagement_executions` row (see section 7.1).

### 5.4 ghl-tag-webhook (Pattern A greenfield fallback)

For clients without the snapshot: GHL Workflow -> Trigger "Contact Tag added" -> Action "Webhook" to
`.../ghl-tag-webhook` (POST), body including `contactId`, `locationId`, and the tags array. Flip the
NEW LEADS toggle on the target workflow first.

### 5.5 bookings-webhook (appointments)

Wire two GHL Calendar automations (the merge tags cannot tell booked from cancelled in one):

- **BOOKED:** Appointment Status confirmed/new -> Custom Webhook (form-encoded) to
  `.../bookings-webhook` with `appointmentId`, `contactId`, `calendarId`, `locationId`, `startTime`,
  `endTime`, `status=confirmed`. BOOKED ends any active cadence (stop reason `booking_created`).
- **CANCELLED:** same with `status=cancelled` (records status only).

`sync-ghl-booking` is an alternate booking path that resolves the client from the booking; prefer
`bookings-webhook`. **Done when:** a test booking upserts a `bookings` row and ends the cadence.

### 5.6 workflow-inbound-webhook

Optional. Generic workflow inbound, strict once the secret is set. The URL carries `client_id` and
`workflow_id` query params (the card fills them).

### 5.7 receive-dm-webhook

Inbound DM ingress (for thread context). **Outbound DM/WhatsApp is not live**, so this is for inbound
capture / mirror only. Secured by the same `x-wh-token` once set.

### 5.8 receive-twilio-sms (inbound SMS) + the GHL mirror

- **Inbound SMS:** in the Twilio console, the number's "A message comes in" webhook points to
  `.../receive-twilio-sms` (POST). The app's **Configure Twilio Webhook** button sets this for you;
  the card shows it read-only. Inbound SMS handles STOP natively.
- **GHL conversation mirror (optional polish):** every inbound and outbound SMS body is mirrored to
  the GHL contact so the thread reflects the full story. If `clients.ghl_conversation_provider_id` is
  set, it uses the GHL Conversations API (messages appear on the Conversations tab); otherwise it
  falls back to Notes automatically. To wire the polished path: GHL Settings -> Marketplace ->
  Conversation Providers -> add a custom SMS provider, copy the id, and
  `UPDATE clients SET ghl_conversation_provider_id = '<id>' WHERE id = '<client-uuid>';`.
- **Channel field (optional):** `clients.ghl_channel_field_id` lets `receive-twilio-sms` stamp the
  GHL contact's channel field on inbound. If NULL it no-ops harmlessly.

> Status callback needs no per-number config: every outbound send stamps
> `StatusCallback=.../twilio-status-webhook` automatically.

### 5.9 unipile-webhook

Not supported yet (social DM). Leave blank.

---

## 6. Voice wiring - Retell (BFD-managed)

### 6.1 retell-inbound-webhook (phone-first inbound)

On each BYO Retell phone, set the **`inbound_webhook_url`** to `.../retell-inbound-webhook`. Retell
calls it synchronously before the call connects; BFD resolves the client by agent id (across all 10
slots), looks up the contact by phone (exact E.164 first, then a last-9-digit suffix match to bridge
+61 and 0 forms), and returns dynamic variables (first name, email, phone, business name, current
time, timezone, contact id) that the prompt uses for context. **Done when:** a test inbound call
resolves the caller and the agent greets them by name.

### 6.2 retell-call-analysis-webhook (call events + analysis)

The agent-level `webhook_url` is auto-set to `.../retell-call-analysis-webhook` on push (events
`call_ended`, `call_analyzed`). No manual step beyond pushing the setter.

### 6.3 voice-booking-tools (custom-tool URLs)

For each Retell agent, the booking tools point at
`.../voice-booking-tools?tool=<name>&clientId=<client-uuid>` with header
`Authorization: Bearer <intake_lead_secret>`. Tools: `get-available-slots`, `book-appointments`,
`get-contact-appointments`, `update-appointment`, `cancel-appointments`. These are injected by the
push path (`retell-proxy`), so a correctly pushed bookable setter has them. Use the Retell REST API,
not the MCP, if you ever set them by hand.

### 6.4 Voice call summary push to GHL (optional)

After each analysed call, BFD writes a `[Voice Call Summary]` note to the GHL contact (when
`ghl_api_key` is present) and updates `last_call_sentiment` / `last_call_appointment_booked` custom
fields if `clients.ghl_call_sentiment_field_id` / `ghl_call_appt_booked_field_id` are set. Optional
but nice for the client's timeline.

> **Retell webhook secret:** `retell_webhook_secret` is intentionally **deferred until the first
> paying client** (anti-forgery hardening, not functional; nothing breaks without it). Leave it
> blank. Same for `unipile_webhook_secret`.

---

## 7. Synthetic dry-run (before go-live)

All assertions are SQL against the platform DB.

### 7.1 Test lead via intake-lead
```bash
curl -X POST "https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/intake-lead" \
  -H "Authorization: Bearer <intake_lead_secret>" -H "Content-Type: application/json" \
  -d '{"clientId":"<client-uuid>","first_name":"Test","last_name":"Synthetic","phone":"<test-phone>","email":"test@example.com","source":"sop-dryrun"}'
```
```sql
SELECT id, lead_id, phone, source FROM leads WHERE client_id = '<client-uuid>' AND phone = '<test-phone>';
SELECT id, status, stop_reason FROM engagement_executions WHERE client_id = '<client-uuid>' ORDER BY created_at DESC LIMIT 1;
```

### 7.2 Cadence fires (or defers per quiet hours)
```sql
SELECT created_at, message_body, channel, twilio_message_sid FROM message_queue
WHERE created_at > now() - interval '10 minutes' ORDER BY created_at DESC;
```
A real outbound row has a `twilio_message_sid`. Cross-check Twilio Console -> Messages.

### 7.3 Real Retell call + booking
Trigger via `make-retell-outbound-call`, complete the booking flow, then:
```sql
SELECT id, ghl_appointment_id, appointment_time, status FROM bookings WHERE client_id = '<client-uuid>' ORDER BY created_at DESC LIMIT 1;
```

### 7.4 STOP test
Text `STOP` from a test phone:
```sql
SELECT * FROM lead_optouts WHERE client_id = '<client-uuid>';
-- engagement_executions for that contact should be status=cancelled, stop_reason=opt_out
```

### 7.5 Quiet hours
Set `cadence_quiet_hours` to a window 1 hour out, trigger a cadence, confirm the message defers
(Trigger.dev shows the task in `wait.until()`).

---

## 8. Go-live

### 8.1 Flip the gates
1. Confirm **go-live readiness**: the Inbound Webhooks card shows `goLiveReady: true`, which requires
   the two **required** webhooks (`sync-ghl-contact` and `bookings-webhook`) to be **secured** (i.e.
   `ghl_webhook_secret` is set).
2. Ensure `subscription_status = 'active'` (the script sets this; clients created via the in-app
   Onboarding flow default to `free` and must be flipped).
3. Flip auto-enrolment:
```sql
UPDATE clients SET auto_engagement_workflow_id = '<cloned-workflow-uuid>', dm_enabled = true WHERE id = '<client-uuid>';
```

### 8.2 Push 5 real leads with the client present (screen-share).

---

## 9. Soft launch monitoring (days 1-7)

```sql
-- Funnel
SELECT * FROM cadence_funnel WHERE client_id = '<client-uuid>' AND day = current_date;

-- SMS delivery failures
SELECT status, error_code, error_message, count(*) FROM sms_delivery_events
WHERE client_id = '<client-uuid>' AND received_at > now() - interval '24 hours'
  AND status IN ('failed','undelivered') GROUP BY 1,2,3 ORDER BY 4 DESC;

-- Errors
SELECT created_at, source, error_message FROM error_logs
WHERE client_ghl_account_id = '<ghl_location_id>' AND created_at > now() - interval '24 hours'
ORDER BY 1 DESC LIMIT 50;
```
Trigger.dev console: filter `payload.client_id = '<client-uuid>'`, watch `process-messages`,
`process-setter-reply`, `run-engagement` for FAILED. SLA: 4 hr Mon-Fri week 1, 24 hr business-day
after.

---

## 10. Per-step "done when" and common failure modes

| Step | Done when | If it fails |
|---|---|---|
| Client row (section 3) | Script returns `client_id` + secrets | Re-run with `--dry-run` to inspect the SQL |
| External Supabase (2.1) | 5 tables exist, URL+key in client row | Re-run the seed; confirm `sb_secret_*` key |
| Setter bookable (4.3) | Agent has the booking tools after Push | Apply the booking-toggle workaround |
| Lead ingress (5.3) | Test lead creates `leads` + `engagement_executions` | Check `ghl_location_id` matches; check `sync_ghl_executions` |
| Outbound SMS (7.2) | `message_queue` row with `twilio_message_sid`; SMS arrives | Check Twilio creds; carrier opt-out 21610 -> text START |
| Inbound voice (6.1) | Caller resolved, greeted by name | Check phone `inbound_webhook_url`; phone-format match |
| Booking (5.5) | `bookings` row, cadence ends | Re-wire the GHL booking webhook |
| Go-live (8.1) | `goLiveReady: true` | Set `ghl_webhook_secret` (the two required webhooks) |

Other pitfalls: no SMS at all -> is `dm_enabled = true` and `subscription_status = 'active'`? AI
replies off -> iterate the setter `system_prompt` in the client's external Supabase. Echo loop on
contact updates -> `ghl_last_synced_from_field_id` set per client? Mirror missing -> `ghl_api_key`
present? Sig 403 -> correct secret column for the provider?

---

## 11. Known issues and current gaps

> **2026-07-06 onboarding-gate dry-run findings** (full report:
> `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md`; code bugs tracked as ONBOARD-1/2, GOLIVE-1, ACCESS-1 in
> `Docs/BUG_LIST.md`):
> - **The in-app "New Sub-Account" wizard (`CreateClient`) does NOT set `use_native_text_engine`** →
>   it stays at the DB default `false`, and `processMessages` hard-throws when false, so a client
>   created purely through the UI has a DEAD SMS text engine. There is NO UI toggle for it. Use
>   `onboard-client.mjs` (which sets it true) for a managed onboard, or flip it by SQL.
> - **Creating a setter requires the external Supabase FIRST.** With no external DB, "Create new setter"
>   errors and leaves an orphan `prompts` row, and text-setter save 400s. Do section 2.1 before section
>   4.3. (The old "born-bookable" create-setter bug in 4.3 is now FIXED on main — a fresh voice push is
>   born bookable with 5/5 tools.)
> - **The `intake-lead` synthetic dry-run (section 7.1) is GHL-gated** — it 409s "Client has no GHL
>   credentials configured" until `ghl_api_key` + `ghl_location_id` are set. Run it AFTER GHL is wired.
> - **`goLiveReady: true` is NOT a real readiness signal (section 8.1).** It only checks that
>   `ghl_webhook_secret` is a non-null string, which is auto-minted at creation, so it is true from
>   birth for a completely unconfigured client. Do not trust it alone — confirm GHL connected, Twilio
>   number set + imported into Retell, ≥1 setter pushed, external Supabase set, and a non-null
>   "last received" on the two required webhooks before flipping `auto_engagement_workflow_id`.

- **Create-setter "born bookable" fix is committed on a branch, not yet deployed (2026-06-17).** The
  live app still needs the booking-toggle workaround (section 4.3). The fix lives on branch
  `fix/create-setter-bookable`, pending merge to `main` + Railway deploy.
- **subscription_status default mismatch.** The onboard script defaults `active`; the in-app
  Onboarding flow defaults `free` (which gates the client out). Always confirm `active` for a live
  client (section 8.1).
- **Twilio credentials are not UI-editable.** Set via the onboard script or SQL only (section 4.1).
- **retell_webhook_secret / unipile_webhook_secret deferred** until the first paying client
  (section 6). Not a blocker; nothing breaks without them.
- **Canonical text `llm_model` to confirm with Brendan.** The script default is
  `openai/gpt-4.1-nano`; voice setters now default to `gemini-3.0-flash`; older docs referenced
  `google/gemini-2.5-pro`. These are different surfaces (text engine vs voice setter vs a prompt-config
  slot). Confirm the intended production text model rather than guessing.

---

## 12. In-app SetupGuide copy needing canonical BFD values (report-only)

Mostly RESOLVED by the 2026-07-10 branding purge: the legacy domain/email/Skool strings were removed,
the GHL step was rewritten to the BFD provisioning model, the Retell folder is "BFD Setter" (screenshot
re-shoot still pending, BRENDAN_TODO 5.1), the agent-JSON template files were deleted (agents are
app-created), and the echo-guard fallback slug is now `bfd-setter` for new clients. Still open for
Brendan to confirm:

- The GHL booking title placeholder ("e.g. Strategy call with Brendan") -> confirm canonical default.
- The default `llm_model` shown -> the canonical value from section 11.
- The Twilio phase copy is A2P / "GHL sends SMS" flavoured and vestigial -> reframe to BYO-Twilio,
  client carrier-of-record, Twilio-direct send (wording is Brendan's to finalise).

---

## 13. Rollback / offboarding

Pause a client (kill switch):
```sql
UPDATE clients SET auto_engagement_workflow_id = NULL, dm_enabled = false WHERE id = '<client-uuid>';
UPDATE clients SET use_native_text_engine = false WHERE id = '<client-uuid>';
UPDATE engagement_executions SET status = 'cancelled', stop_reason = 'client_disabled', completed_at = now()
WHERE client_id = '<client-uuid>' AND status IN ('pending','running','waiting');
```

Offboard: set `subscription_status = 'cancelled'`, deactivate the Twilio webhooks in the client's
Twilio console, and (Path A) export the client's GHL data before reclaiming the sub-account. Before
deletion, export `leads`, `bookings`, `cadence_metrics`, `chat_history` to a dated CSV in
`Operations/archives/<date>-<client>/`. Then pause or delete the external Supabase project. Default
retention: 90 days post-offboard.

---

## 14. What changed vs the previous SOP

- **Outbound SMS:** corrected from "GHL sends" to **Twilio direct + GHL mirror only**; the 5
  `leadconnectorhq` outbound webhook fields are retired from the UI.
- **Twilio:** removed the "share BFD account" decision tree; documented **BYO, client-owned +
  client-billed** (carrier of record) as the single model.
- **Added section 0:** the hosting and billing model (BFD-managed Retell / Supabase / OpenRouter, GHL
  per-client, managed fee + client-paid Twilio).
- **GHL hosting:** documented as two converging paths (BFD-provided vs client-owned).
- **Voicemail:** AMD / Twilio voicemail-drop removed; **Retell-native** is the standard.
- **Removed** the n8n bridge and the legacy GHL send workflows from the new-client path.
- **Channel scope:** stated **SMS-only**; email and outbound DM marked not live (DM/WhatsApp
  roadmap).
- **Added** the create-setter booking workaround + the staged born-bookable fix note.
- **Added** the accurate go-live checklist tied to `webhook-manifest` `goLiveReady` (the two required
  webhooks).
- **Renumbered** the inbound-webhook sub-sections to match the live manifest `sopRef` values.
- **HubSpot:** deferred note + links (not a runbook).
- **Branding:** 1Prompt references corrected to BFD where they are BFD's own (the GHL snapshot name is
  kept only as a historical reference).
- **Retell / Unipile webhook secrets:** documented as deferred to the first paying client.
- **Removed** the prior `§C` mock checklist and `§D` pre-sales punch list: they encoded the old
  share-Twilio / client-BYO-everything model that section 0 now supersedes, plus internal `[[memory]]`
  links that do not belong in a repo doc. The per-step "done when" table (section 10) replaces the
  operational checklist; commercial/pricing prep is out of scope for this SOP.

See also: [GHL_SETUP.md](GHL_SETUP.md) (GHL forms/automations/webhooks),
[PERSONA_SETUP.md](PERSONA_SETUP.md) (per-persona setters), [RUNBOOK.md](RUNBOOK.md) (deploys + ops).

**Verification history:** this SOP was exercised end-to-end on 2026-07-06 by standing up a real
throwaway client through the live UI (created + fully deleted). The gaps that dry run found (and which
drove the section-11 notes above) are in
[ONBOARDING_GAP_REPORT_2026-07-06.md](../Docs/ONBOARDING_GAP_REPORT_2026-07-06.md); the step-by-step
record of how the run went is in
[Operations/handoffs/2026-07-06-onboarding-gate.md](../Operations/handoffs/2026-07-06-onboarding-gate.md).
