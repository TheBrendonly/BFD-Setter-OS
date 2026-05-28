# Client Onboarding SOP — BFD-setter

Standard operating procedure for onboarding a new client end-to-end. Written so a non-technical operator (or a future Claude session) can run it without making decisions in the moment.

**Time estimate:** half a day of focused work for the operator + 1 hr of client time across two calls.

**Pre-condition for this SOP to be valid:** BFD has been live on `use_native_text_engine = true` for ≥ 14 days with no regressions in `cadence_funnel`. If not, run BFD live first (Phase A in `User Todos.md`).

---

## 1. Pre-sales discovery

Ask BEFORE you sign. Each answer maps to a config decision later — note them in `Operations/handoffs/<date>-<client>-discovery.md`.

### 1.1 Volume sizing
- Expected leads / month, peak hour, peak day-of-week.
- Inbound vs outbound mix. Voice on or off?
- **Threshold:** < 500 SMS/day per Twilio number = single DID is fine. Above = consider BYO Twilio or multiple numbers (defer multi-Twilio failover to Phase D — see `User Todos.md`).

### 1.2 Existing stack
- Do they already have **GHL**? *(Required — we don't replace it. Confirm they have a sub-account / location they can give you a PIT for.)*
- Do they have **Twilio**? **Retell**? **OpenRouter**? **ElevenLabs**?
- For each: do they own the account, or do you provision on their behalf?

### 1.3 Compliance scope
- Region: US (10DLC / A2P brand registration), AU (Spam Act, no SMS to fixed lines), UK, SG, NZ.
- Confirm STOP keyword handling acceptable (it is, baked into `receive-twilio-sms` Phase 4a).
- Confirm consent provenance for every lead source: TCPA in US, Spam Act in AU. Get this in writing for your records.

### 1.4 Target conversion flow
- SMS-only? SMS + voice live? SMS + voicemail-drop? WhatsApp on/off?
- Determines node mix in their cloned `engagement_workflow`.

### 1.5 Working hours + timezone(s)
- One TZ or multi-state?
- Days of week (Mon-Fri vs Mon-Sat vs 7-day).
- Maps to `clients.cadence_quiet_hours` jsonb.

### 1.6 Stop signals + brand tone
- Aussie warm vs US direct vs UK formal.
- Specific words/phrases banned (e.g. "champ", "team", "partner").
- Sign-off convention (first name, no full company sig).

### 1.7 Decision-makers + commit-to-test windows
- Who reviews cadence copy? (Required step before flag flip.)
- 5-lead soft-launch slot booked — they must be sitting with you for it.
- Who owns Twilio / GHL / Retell passwords on their side?

### 1.8 Output
A one-pager of answers saved to `Operations/handoffs/<date>-<client>-discovery.md`. Will be referenced throughout the rest of this SOP.

---

## 2. Day-1 information collection (1 hr call)

Goal: collect every value you'll paste into SQL. Use a shared doc so the client can fill it in async if needed.

| # | Field | Why we need it | Where it lives |
|---|---|---|---|
| 1 | `agency_id` | RLS scoping (which agency owns this client) | `clients.agency_id` |
| 2 | Display name | UI label | `clients.name` |
| 3 | `ghl_location_id` | Every GHL API call needs it | `clients.ghl_location_id` |
| 4 | `ghl_api_key` (PIT with scopes Contacts/Conversations/Calendars/Workflows/CustomFields) | Server-side GHL auth | `clients.ghl_api_key` |
| 5 | `ghl_calendar_id` | Default booking calendar (voice-booking-tools) | `clients.ghl_calendar_id` |
| 6 | `ghl_assignee_id` | Who's assigned to bookings in GHL | `clients.ghl_assignee_id` |
| 7 | `twilio_account_sid` | BFD-shared OR BYO | `clients.twilio_account_sid` |
| 8 | `twilio_auth_token` | Inbound sig verification | `clients.twilio_auth_token` |
| 9 | `retell_phone_1` (E.164) | Primary inbound | `clients.retell_phone_1` |
| 10 | `retell_phone_2`, `retell_phone_3` | Extra DIDs | same | 
| 11 | `retell_api_key` | Per-client BYO | `clients.retell_api_key` |
| 12 | `retell_inbound_agent_id` | Inbound voice slot 1 | `clients.retell_inbound_agent_id` |
| 13 | `retell_outbound_agent_id` | Outbound new-lead | `clients.retell_outbound_agent_id` |
| 14 | `retell_outbound_followup_agent_id` | Follow-up | `clients.retell_outbound_followup_agent_id` |
| 15 | `retell_agent_id_4..10` | Voice setter slots | same |
| 16 | `openrouter_api_key` | LLM spend isolated per client | `clients.openrouter_api_key` |
| 17 | `llm_model` | Model choice (default: `openai/gpt-4.1-nano`) | `clients.llm_model` |
| 18 | External Supabase project URL + service key + publishable key | Client's own setter-live mirror | `clients.supabase_url`, `_service_key`, `_anon_key` |
| 19 | Quiet hours JSON (start/end/tz/days) | Phase 4b guard | `clients.cadence_quiet_hours` |
| 20 | Voicemail audio URLs per setter | Twilio AMD voicemail-drop (interim before Retell-native) | `clients.voicemail_audio_url` jsonb |
| 21 | Brand tone notes + banned words | Pasted into client's `text_prompts` row | client's external Supabase |
| 22 | Website embed location | Where the `intake-lead` snippet goes | n/a |

**Output:** filled checklist saved to `Operations/handoffs/<date>-<client>-onboarding-collected.md`.

---

## 3. Pre-provisioning (BEFORE the onboard SQL)

### 3.1 Provision the client's external Supabase project

The platform DB (`bjgrgbgykvjrsuwwruoh`) is shared. Each client also gets their own "setter-live" project that mirrors BFD's `bfd-setter-live` (chat history, prompts, KB).

Steps:
1. Browse to https://supabase.com/dashboard → New project. Pick the agency org. Region closest to client.
2. Name: `<client-slug>-setter-live`. Save the project ref.
3. Settings → API → grab `Project URL`, `sb_publishable_*` (anon), `sb_secret_*` (service_role). 2026-04-29 onwards, only `sb_secret_*` / `sb_publishable_*` are valid (legacy JWTs disabled — see `MASTER_PLAN.md` invariants).
4. SQL Editor → run the seed:

```sql
-- pgvector for KB embeddings (optional but recommended)
CREATE EXTENSION IF NOT EXISTS vector;

-- chat_history (processSetterReply / sendFollowup target)
CREATE TABLE chat_history (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,           -- the GHL contact id
  message jsonb NOT NULL,             -- LangChain { type: 'human' | 'ai', content, ... }
  timestamp timestamptz DEFAULT now()
);
CREATE INDEX chat_history_session_idx ON chat_history (session_id, timestamp);

-- text_prompts (one row per AI persona / setter slot)
CREATE TABLE text_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_name text UNIQUE NOT NULL,     -- e.g. 'Setter-1', 'Setter-2'
  system_prompt text,
  temperature numeric DEFAULT 0.7,
  model text DEFAULT 'openai/gpt-4.1-nano',
  updated_at timestamptz DEFAULT now()
);

-- voice_prompts (Retell agent prompt overrides + dynamic vars)
CREATE TABLE voice_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setter_slot text UNIQUE NOT NULL,   -- 'voice-setter-1' .. 'voice-setter-10'
  system_prompt text,
  voice_id text,
  updated_at timestamptz DEFAULT now()
);

-- documents (KB target for kb-ingest)
CREATE TABLE documents (
  id bigserial PRIMARY KEY,
  source_url text,
  title text,
  content text,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- leads mirror (dual-write target from platform.leads)
CREATE TABLE leads (
  id text PRIMARY KEY,                -- GHL contact id
  first_name text, last_name text, email text, phone text,
  source text, tags text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### 3.2 Per-provider account decisions

| Provider | Type | Per-client model | What client provides |
|---|---|---|---|
| **bfd-platform Supabase** | shared | one row in `clients` table | nothing (we provision) |
| **External Supabase** | per-client | new project per client | nothing (you provision §3.1) |
| **GHL** | per-client | one location per client | location id + PIT with scopes |
| **Retell** | per-client BYO | one Retell account, multi-agent | API key + agent IDs (or you build) |
| **OpenRouter** | per-client BYO recommended | mint key on client's behalf, invoice them | nothing (you mint at https://openrouter.ai/keys, charge through) |
| **Twilio** | BYO or shared | see decision tree §3.3 | SID + auth token (if BYO) |
| **ElevenLabs** | per-client BYO if used | optional | API key |
| **Trigger.dev** | shared | one project (`proj_fdozaybvhgxnzopabtse`) — tasks are payload-scoped | nothing |

### 3.3 Twilio decision tree (BYO vs share BFD)

**Share BFD account** when:
- Client has < 500 SMS/day expected.
- Client is comfortable with BFD as carrier of record.
- Faster — skip A2P/10DLC re-registration (BFD's brand already approved).

**BYO Twilio** when:
- Client volumes > 500/day.
- Client wants their own brand on the SMS billing.
- US client — A2P 10DLC registration is per-brand; their brand needs the registration.

**Trade-off:** shared BFD account = single suspension hurts everyone. BYO isolates risk.

### 3.4 GHL prep
1. Confirm location id by hitting `GET https://services.leadconnectorhq.com/locations/<location-id>` with the PIT — should return 200.
2. Confirm PIT scopes: **Contacts**, **Conversations**, **Calendars**, **Workflows**, **Custom Fields**.
3. Click-path to verify scopes: GHL → Settings → Private Integrations → click PIT → confirm scope checkboxes.

### 3.5 Retell prep
The 5 slots that always matter (`make-retell-outbound-call/index.ts:14-16`):

1. `retell_inbound_agent_id` — answers when leads call us.
2. `retell_outbound_agent_id` — first outbound call to a new lead.
3. `retell_outbound_followup_agent_id` — follow-up calls.
4. Voice setter slots `retell_agent_id_4..10` — used when cadence specifies `voice_setter_id` in an `engage` channel.
5. **Voicemail is now Retell-native** (per the next-session prompt). On every Retell agent we set `voicemail_option` either `{ type: 'static_text', text: ... }` or `{ type: 'prompt', prompt: ... }`. No separate voicemail agent.

Reuse existing Retell agents if the client already has them. Otherwise create persistent agents per `MASTER_PLAN.md` invariant ("BFD-setter uses persistent Retell agents").

---

## 4. Database provisioning (the SQL)

Run against `bjgrgbgykvjrsuwwruoh` via Supabase Management API (`RUNBOOK.md` deploys section has the curl pattern).

### 4.1 INSERT clients

```sql
INSERT INTO public.clients (
  id, agency_id, name,
  ghl_location_id, ghl_api_key, ghl_calendar_id, ghl_assignee_id,
  twilio_account_sid, twilio_auth_token,
  retell_phone_1, retell_phone_2, retell_phone_3,
  retell_api_key,
  retell_inbound_agent_id, retell_outbound_agent_id, retell_outbound_followup_agent_id,
  retell_agent_id_4, retell_agent_id_5, retell_agent_id_6,
  retell_agent_id_7, retell_agent_id_8, retell_agent_id_9, retell_agent_id_10,
  openrouter_api_key, llm_model,
  supabase_url, supabase_service_key, supabase_table_name,
  dm_enabled, debounce_seconds, use_native_text_engine,
  cadence_quiet_hours,
  intake_lead_secret,
  voicemail_audio_url,
  voicemail_config,
  ghl_webhook_secret, retell_webhook_secret, unipile_webhook_secret,
  ghl_last_synced_from_field_id,
  ghl_last_synced_from_field_value,
  auto_engagement_workflow_id,
  timezone,
  created_at
) VALUES (
  gen_random_uuid(),
  '<agency-uuid>',
  '<Client Display Name>',
  '<ghl_location_id>', '<ghl_pit>', '<ghl_calendar_id>', '<ghl_assignee_id>',
  '<twilio_sid>', '<twilio_auth>',
  '<retell_phone_1>', NULL, NULL,
  '<retell_api_key>',
  '<agent_inbound>', '<agent_outbound>', '<agent_followup>',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '<openrouter_key>', 'openai/gpt-4.1-nano',
  '<https://<ref>.supabase.co>', '<sb_secret_*>', 'leads',
  false,                                    -- dm_enabled OFF until soft launch
  60,                                       -- debounce_seconds
  true,                                     -- use_native_text_engine ON from day 1
  '{"start":"09:00","end":"21:00","tz":"<IANA>","days":[1,2,3,4,5]}'::jsonb,
  encode(gen_random_bytes(24), 'base64'),   -- intake_lead_secret
  '{}'::jsonb,                              -- voicemail_audio_url, fill later if Twilio AMD path used (rare under Retell-native voicemail)
  '{"mode":"hangup","text":null}'::jsonb,    -- voicemail_config (Retell-native; mode = hangup|static|prompt; set later via Sub-Account Settings → Voicemail card, §5.14)
  NULL,                                     -- ghl_webhook_secret (paste in §5.3)
  NULL,                                     -- retell_webhook_secret (paste in §5.5)
  NULL,                                     -- unipile_webhook_secret
  NULL,                                     -- ghl_last_synced_from_field_id (set in §4.2)
  '<client-slug>',                          -- ghl_last_synced_from_field_value (echo-stamp value; pick a short distinctive slug per client, e.g. "acme-co" — defaults to "1prompt-os" if NULL)
  NULL,                                     -- auto_engagement_workflow_id (set in §8 after copy review)
  '<IANA>',                                 -- timezone (e.g. 'Australia/Brisbane'); also lives in cadence_quiet_hours.tz — keep both in sync
  now()
)
RETURNING id, intake_lead_secret;
```

Save the returned `id` — that's `<client-uuid>` everywhere downstream.

### 4.2 Create per-client GHL `last_synced_from` custom field

```bash
curl -X POST "https://services.leadconnectorhq.com/locations/<ghl_location_id>/customFields" \
  -H "Authorization: Bearer <ghl_pit>" \
  -H "Version: 2021-07-28" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "last_synced_from",
    "dataType": "TEXT",
    "model": "contact"
  }'
```

Capture the returned `id`, then store it per-client (D-M5 added the `ghl_last_synced_from_field_id` column):

```sql
UPDATE public.clients
SET ghl_last_synced_from_field_id = '<the-field-id-returned>'
WHERE id = '<client-uuid>';
```

### 4.3 Clone the default workflow

```sql
INSERT INTO public.engagement_workflows (id, client_id, name, nodes, created_at)
SELECT gen_random_uuid(),
       '<client-uuid>',
       'Default new-lead cadence',
       nodes,
       now()
FROM public.engagement_workflows
WHERE id = '40e8bea3-b6f6-4562-98d1-f7e6599af6a1'   -- BFD canonical default
RETURNING id;
```

DO NOT yet `UPDATE clients SET auto_engagement_workflow_id = ...` — copy review must happen first (§6).

### 4.4 Echo-loop guard sanity check

`sync-ghl-contact` skips inbound webhooks where `customField.last_synced_from = <clients.ghl_last_synced_from_field_value>` (default `"1prompt-os"`, per-client since N1 2026-05-19) AND `leads.updated_at < 60s old`. The check uses `clients.ghl_last_synced_from_field_id` for the field id (per-client; D-M5) AND `clients.ghl_last_synced_from_field_value` for the stamp value. Both `push-contact-to-ghl` (write) and `sync-ghl-contact` (read) read the same column, so they move together. Confirm by editing a contact via the platform UI and checking that no extra `sync_ghl_executions` row fires.

---

## 5. External wiring (click-paths)

### 5.1 GHL "Send Setter Reply" workflow

Mirror BFD's. In the client's GHL → Workflows → New → Inbound:
1. Trigger: SMS Received (or DM Received).
2. Decision: "Which Channel?" — reads `contact.channel` (set by `setGhlContactChannel` at `receive-twilio-sms/index.ts:267`).
3. Action: Webhook to your `text_engine_webhook` (n8n bridge) — OR skip the workflow entirely if `use_native_text_engine = true` (recommended for new clients).

### 5.2 GHL Calendar webhook → `bookings-webhook`

1. Workflows → New → **Calendar Events**.
2. Triggers: **Appointment Created** + **Appointment Updated** + **Appointment Cancelled**.
3. Action: **Webhook** → URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook`
4. Payload: `appointmentId`, `contactId`, `calendarId`, `startTime`, `endTime`, `status`, `locationId`.
5. Save + activate.

### 5.3 GHL Webhook V2 secret → `clients.ghl_webhook_secret`

1. Settings → Marketplace → **Webhooks v2** → Enable.
2. Copy the secret.
3. `UPDATE clients SET ghl_webhook_secret = '<secret>' WHERE id = '<client-uuid>';`
4. Once set, `receive-dm-webhook` enforces HMAC-SHA256 on `x-wh-signature`.

### 5.4 Retell custom-tool URLs

For EACH Retell agent (5 slots above), set tool URLs to:
- `POST https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=get-available-slots&clientId=<client-uuid>`
- same path with `tool=book-appointments`, `tool=get-contact-appointments`, `tool=update-appointment`, `tool=cancel-appointments`

Authorization header per tool: `Bearer <clients.intake_lead_secret>` (the value returned by §4.1).

Use the Retell REST API (NOT the MCP — strips custom-tool params per memory `reference_retell_rest_vs_mcp`).

### 5.5 Retell webhook secret → `clients.retell_webhook_secret`

In each Retell agent's webhook config, copy the signing secret. Then:
```sql
UPDATE clients SET retell_webhook_secret = '<secret>' WHERE id = '<client-uuid>';
```
Once set, `retell-call-analysis-webhook` enforces `x-retell-signature`.

### 5.6 Retell voicemail config

(After the next session ships the Retell-native voicemail integration.)

In the Engagement editor → "Cadence Settings" bar → Voicemail:
- Choose "Static text" + paste the script (with `{{first_name}}` etc), OR
- Choose "Dynamic" + paste an LLM prompt (Retell will generate the voicemail per call).

Saved into `engagement_workflows.voicemail_config` jsonb. `runEngagement.ts` pushes into Retell's `voicemail_option` agent setting before each phone_call node fires.

### 5.7 ElevenLabs (if used)

Same URL pattern as Retell (point at `voice-booking-tools`). Constant lives at `elevenlabs-manage-agent/index.ts:56-57`.

### 5.8 `intake-lead` website embed

Hand the client this snippet, replacing `<intake_lead_secret>` and `<client-uuid>`:

```html
<script>
async function intakeBuildingFlow(formData) {
  const r = await fetch('https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/intake-lead', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer <intake_lead_secret>'
    },
    body: JSON.stringify({
      clientId: '<client-uuid>',
      first_name: formData.get('first_name'),
      last_name: formData.get('last_name'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      source: 'website-form'
    })
  });
  return r.json();
}
</script>
```

### 5.9 Twilio inbound SMS webhook

For each client phone number (the `retell_phone_*` values):
1. Twilio Console → Phone Numbers → Manage → Active Numbers → click the number.
2. **Messaging Configuration** → "A message comes in" → Webhook → `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/receive-twilio-sms` → POST.
3. Save.
4. No per-number status callback config needed — `processMessages` outbound stamps `StatusCallback=<…>/twilio-status-webhook` on each `Messages.create` call automatically.

### 5.10 Tag-based auto-enrolment via `ghl-tag-webhook` (Pattern A — greenfield)

Use Pattern A when the client does NOT have the 1Prompt SetterOS GHL snapshot installed. For snapshot-imported clients (BFD and most agency clients), use **Pattern B in §5.13 instead** — the snapshot's `Add Lead to 1Prompt OS` workflow already implements the tag-based ingress via `sync-ghl-contact`.

After cadence copy review (§6) and dry-run (§7), wire GHL → ghl-tag-webhook so contacts auto-enrol when a chosen tag is added:

1. In the BFD-setter UI: **Workflows** list → flip the **NEW LEADS** Switch ON for the campaign → enter the tag name (e.g. `new-lead`). At-most-one workflow per client may be ON.
2. In GHL: **Workflows** → New → Trigger: **Contact Tag** has tag `<tag>` → Action: **Webhook** → URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/ghl-tag-webhook` → Method: POST → Body: include `contactId`, `locationId`, and the post-update `tags` (or `addedTags`) array.
3. Save + activate.

The tag is removed at every terminal `stop_reason` (sequence_complete / inbound_reply / booking_created / opt_out / cancelled / error) by `runEngagement.writeCadenceMetrics`. See `Docs/RUNBOOK.md` "Tag-based auto-enrolment" for sig verification + smoke test.

### 5.11 GHL Custom Conversation Provider (optional — polished SMS-thread mirror)

Phase B (`phase-night-ghl-push-gaps-2-3`, 2026-05-02) added a server-side mirror that pushes every inbound and outbound SMS body to GHL so the conversation thread on the contact reflects the full lead story. Two endpoint paths:

- **Conversations API** (polished, recommended): `POST /conversations/messages/{inbound|outbound}`. Requires a Custom Conversation Provider id provisioned in GHL Marketplace — agency owner sees real Conversation messages on the Conversations tab.
- **Notes API** (default fallback): `POST /contacts/{id}/notes` with body `[platform -> SMS <direction>] <message>`. Visible on the Notes tab. No setup required.

The mirror runs regardless of which path is used; if `clients.ghl_conversation_provider_id` is null, the helper falls back to Notes automatically.

**To wire the polished path:**

1. In the agency's GHL account: **Settings -> Marketplace -> Conversation Providers -> Add custom provider**. Or via the developer portal at `https://marketplace.gohighlevel.com/`. Name it something like "BFD-setter SMS mirror". Set type = SMS.
2. Copy the provider id (looks like a 24-char hex string).
3. `UPDATE clients SET ghl_conversation_provider_id = '<id>' WHERE id = '<client-uuid>';`
4. Smoke-test: send one inbound SMS to the client's Twilio number; expect a new message on the GHL contact's Conversations tab within ~5s. If it lands in Notes instead, double-check the provider id is correctly pasted and the marketplace integration is published.

**To verify the fallback is working when no provider is configured:** trigger the same inbound, then check the contact's Notes tab in GHL for an entry prefixed `[platform -> SMS inbound]`.

The helper is at `frontend/supabase/functions/_shared/ghl-conversations.ts` (Deno) and `trigger/_shared/ghl-conversations.ts` (Node copy). Wired into `receive-twilio-sms`, `processMessages.ts` (gated on `client.use_native_text_engine === true`), and `runEngagement.ts` `sendTwilioSmsAndStamp` (engage + send_sms nodes).

**Step 5.11.5 — GHL `channel` custom-field id → `clients.ghl_channel_field_id`** (added 2026-05-22, Bug 23)

`receive-twilio-sms` stamps the GHL contact's `channel` custom field to `"SMS"` on every inbound so the GHL **Send Setter Reply** workflow's "Which Channel?" decision routes correctly (the decision reads `contact.channel`, NOT the inbound payload). The custom-field UUID was previously hardcoded for BFD; now per-client.

1. In GHL: **Settings -> Custom Fields -> Custom Fields**. Create or locate the `channel` custom field on the Contact object. Type: `Multiple Options` (values: `SMS`, `Email`, `Voice`, etc.). If it already exists, use its id.
2. Copy the field id from the URL or field-detail panel (looks like `p0vCIz497xZLk5fUSF0X` for BFD, or a UUID for newer locations).
3. `UPDATE clients SET ghl_channel_field_id = '<id>' WHERE id = '<client-uuid>';`
4. If left NULL: `setGhlContactChannel` no-ops with a `console.warn` line — inbound SMS still flows, but the GHL workflow's channel-routing decision will fall through to its default branch.

### 5.12 Voice call summary push to GHL (optional — populates contact timeline)

Phase night (`phase-night-ghl-push-gap-1`, 2026-05-02) added automatic GHL Note creation + custom field updates after every completed Retell call analysis. This closes GHL push gap 1: previously the agency owner saw nothing on the GHL contact timeline about calls made through the platform.

**What gets pushed:**
- A GHL Note on the contact: `[Voice Call Summary]`, duration, sentiment, appointment booked flag, and the full Retell-generated call summary.
- Two custom fields (when configured): `last_call_sentiment` and `last_call_appointment_booked`.

The push fires automatically whenever `retell-call-analysis-webhook` receives a `call_analyzed` event AND the call's `contact_id` dynamic variable is set (i.e. the agent knew which GHL contact it was talking to). It is best-effort: failures only log a `console.warn` and never affect the core call record.

**To wire the custom fields (optional but recommended):**

1. In the new client's GHL location, create two custom fields of type **Text**:
   - Field label: `Last Call Sentiment`, field key: `last_call_sentiment`
   - Field label: `Last Call Appointment Booked`, field key: `last_call_appointment_booked`
2. Copy each field's id (visible in the field's URL or via `GET /locations/{locationId}/customFields`).
3. Run:
   ```sql
   UPDATE clients
   SET
     ghl_call_sentiment_field_id = '<sentiment-field-id>',
     ghl_call_appt_booked_field_id = '<appt-booked-field-id>'
   WHERE id = '<client-uuid>';
   ```
4. On the next completed call, open the GHL contact's Notes tab. Expect a note starting with `[Voice Call Summary]` within seconds of the call ending. The two custom fields should also reflect the latest values.

**Notes fallback:** the Note is always written when `clients.ghl_api_key` is present (no custom field ids required). The custom field PATCH is silently skipped if either field id is null.

### 5.13 GHL Snapshot ingress — `Add Lead to 1Prompt OS` (Pattern B — snapshot-imported clients)

Use Pattern B when the client imported the 1Prompt SetterOS GHL snapshot (BFD and most agency clients). The snapshot ships with a `Add Lead to 1Prompt OS` workflow that uses **tag-add → `sync-ghl-contact`** as the new-lead ingress, NOT `ghl-tag-webhook` (which is Pattern A in §5.10). Tag is the trigger; data flows through `sync-ghl-contact` and auto-enrolment fires via `clients.auto_engagement_workflow_id`.

**Architecture:**

```
Lead source (form / LinkedIn / manual / CSV)
    ↓ adds tag "bfd_setter-new_lead"  (per-source tagging workflow OR form's built-in tag setting)
GHL workflow "Add Lead to 1Prompt OS"
    Trigger: Contact Tag Added = "bfd_setter-new_lead"
    Action 1: Update Contact Field "GHL Account ID" = <client-location-id>
    Action 2: Custom Webhook POST → sync-ghl-contact
        Body: { Lead_ID, Name, Email, Phone, GHL_Account_ID }
    ↓
sync-ghl-contact (Supabase edge function)
    - Resolves client via clients.ghl_location_id = GHL_Account_ID match
    - CREATE path: inserts leads row + (if auto_engagement_workflow_id set) fires Trigger.dev run-engagement
    - UPDATE path: bumps leads.updated_at, does NOT re-enrol (idempotent on duplicate tag-add)
```

**Per-client config (5 places):**

#### 5.13.1 The "Add Lead to 1Prompt OS" workflow

In the GHL UI for the client's location, open workflow `Add Lead to 1Prompt OS`:

1. **Trigger:** confirm "Contact Tag Added" with value `bfd_setter-new_lead` (or whatever convention the client uses — must match `engagement_workflows.new_leads_tag` if you also want `ghl-tag-webhook` to fire, but Pattern B doesn't require this column).
2. **Action 1 — Update Contact Field "GHL Account ID":** set value to `<client-location-id>` (the same as `clients.ghl_location_id`). This is what the next action's body uses to resolve the tenant in `sync-ghl-contact`.
3. **Action 2 — Custom Webhook:**
   - Method: `POST`
   - URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-contact?clientId=<client-uuid>` (the `clientId` query param is ignored by the function but kept for grep-ability/audit; tenant resolution happens via `GHL_Account_ID` in the body).
   - Headers: **none** (sync-ghl-contact does not enforce auth today — deferred to A6 sig verification).
   - Content-Type: `application/json`
   - Body (exact JSON; do NOT rename keys):
     ```json
     {
       "Lead_ID": "{{contact.id}}",
       "Name": "{{contact.name}}",
       "Email": "{{contact.email}}",
       "Phone": "{{contact.phone}}",
       "GHL_Account_ID": "{{contact.ghl_account_id}}"
     }
     ```
4. **Publish.**

#### 5.13.2 The form-to-tag bridge workflow (one per lead source)

For each lead source (website form, LinkedIn DM, manual entry), build a small workflow that just adds the `bfd_setter-new_lead` tag. This decouples lead sourcing from cadence enrollment — adding new sources is a small workflow, not a touch to sync-ghl-contact.

**For a website GHL form:**
1. In **Campaigns** folder → **+ Create Workflow** → name e.g. `Form Submit - "bfd_setter-new_lead" tag added`.
2. **Trigger:** `Form Submitted` → filter `Form is <form-name>` (e.g. `New Lead to GHL`, form id `<form-id>`). **MUST filter to the specific form** — otherwise every form submit on the location triggers a cadence.
3. **Action 1:** `Add Contact Tag` → `bfd_setter-new_lead`.
4. **Publish.**

**Why two workflows and not one combined form-to-webhook:** decoupling means LinkedIn / CSV / manual / future form X all converge on the same tag. Single sync-ghl-contact ingress, multiple lead sources, zero per-source webhook config.

**Conventional tags (BFD location uses these — copy to new clients):**
- `bfd_setter-new_lead` — triggers Add Lead to 1Prompt OS
- `bfd_setter-stop_setter` — set when STOP keyword received; triggers `Stop / Activate Setter` workflow
- `bfd_setter-text_setter`, `bfd_setter-voice_setter` — internal routing tags

#### 5.13.3 Disable the snapshot's bookings workflow

The snapshot ships with `Add Booking to 1Prompt OS` (single workflow for all appointment events). **Do not use it.** GHL's workflow merge tags don't expose `appointmentStatus`, so it can't tell booked vs cancelled apart. BFD's pattern (§G of `Docs/WEBHOOKS.md`) is two workflows: `<client> bookings → 1prompt (BOOKED)` and `<client> bookings → 1prompt (CANCELLED)`, each filtering to one status case and hardcoding it in the body.

1. Open `Add Booking to 1Prompt OS` in the GHL editor.
2. Toggle **Publish OFF** (move slider to Draft).
3. Confirm the two BFD-pattern booking workflows exist (see §5.2 above for `bookings-webhook` wiring; build a per-client equivalent of `BFD bookings → 1prompt (BOOKED)` + `(CANCELLED)`).

#### 5.13.4 Other snapshot workflows — dormant under native engine

Under `clients.use_native_text_engine=true` (BFD's mode), these snapshot workflows are **vestigial** — their URLs are stored in `clients` for validation, but the runtime path bypasses them entirely:

| Workflow | Column it expects | Used by | Status under native engine |
|---|---|---|---|
| `Send Setter Reply` | `clients.ghl_send_setter_reply_webhook_url` | `processMessages` (legacy n8n branch only) | Dormant; URL validated but never called |
| `Send Engagement` | `clients.send_engagement_webhook_url` | `runEngagement` WhatsApp branch only | Dormant for SMS+voice clients |
| `Send Followup` | (column exists, not actively referenced) | n/a | Dormant |
| `Send Message` | (column exists, not actively referenced) | n/a | Dormant |
| `Receive Message` | n/a (Twilio webhook handles inbound) | n/a | Dormant |
| `Stop / Activate Setter` | called via tag-add | Parallel path; primary STOP is `receive-twilio-sms` → `setter_stopped` flag | Tag-add path runs in parallel; safe to leave published |

**You can leave them published** — they don't fire under native engine and don't double-fire anything. They become load-bearing again only if you roll back `use_native_text_engine=false` or add a WhatsApp node to a cadence. Phase 10 (post-soak) will likely retire the URL columns entirely.

For each Send* workflow, do confirm the Inbound Webhook URL in the workflow's trigger matches what's stored in the client's BFD admin UI config. They were upstream-default URLs at snapshot import time and need updating per new GHL location.

#### 5.13.5 End-to-end verification (8 hops)

Once §5.13.1-3 are done and the cadence is published (§6), run a real form submission against the client's website. Watch all 8 hops:

| # | Where to check | Pass criteria |
|---|---|---|
| 1 | GHL UI · Contacts | New contact created with submitted fields, tagged `1prompt - new lead` |
| 2 | GHL UI · Workflows → Form-to-tag workflow → History | Run shows "Completed" within ~10s |
| 3 | GHL UI · Workflows → `Add Lead to 1Prompt OS` → History | Run shows "Completed" within ~5s of the form-to-tag run, no failed actions |
| 4 | `SELECT * FROM leads WHERE lead_id='<ghl-contact-id>'` | New row, fields populated from the form |
| 5 | `SELECT * FROM engagement_executions WHERE ghl_contact_id='<ghl-contact-id>' ORDER BY created_at DESC LIMIT 1` | New row, `status` in (`pending`,`running`), `trigger_run_id` populated |
| 6 | Trigger.dev console · `proj_fdozaybvhgxnzopabtse` · runs | `run-engagement` run started within ~5s |
| 7 | `SELECT * FROM message_queue WHERE contact_phone='<phone>' ORDER BY created_at DESC` | Outbound SMS row, `twilio_message_sid` populated, body matches first cadence node |
| 8 | Tester's phone | SMS n1 lands within ~30s of submit |

**If Hop 4 fails** (no leads row): sync-ghl-contact returned non-200. Common causes:
- `sync_ghl_enabled` column missing on `clients` (run `ALTER TABLE clients ADD COLUMN IF NOT EXISTS sync_ghl_enabled BOOLEAN NOT NULL DEFAULT true`). Pre-2026-05-13 deployments may not have this column.
- `clients.ghl_location_id` doesn't match the GHL_Account_ID action value in 5.13.1 step 2.
- The `clientId` query param is wrong — but the function ignores it; check the body has the right `GHL_Account_ID`.

**If Hop 5 fails but Hop 4 passes**: sync-ghl-contact reached UPDATE path (existing leads row). Delete the row and re-trigger to test from CREATE path. UPDATE path is idempotent-by-design and does not re-enrol.

**If Hop 8 fails with no message_queue row visible**: check Trigger.dev run logs at `https://cloud.trigger.dev/projects/proj_fdozaybvhgxnzopabtse`. Run-engagement may have thrown at the SMS node. Common cause is Twilio carrier opt-out (error code `21610`) from prior STOP keyword testing — the tester texts `START` from their phone to `<from_number>` to clear it.

**If SMS lands but with `Twilio SMS failed: ? unknown` in Trigger.dev logs**: known bug — `runEngagement.ts:171` reads `error_code`/`error_message` from Twilio's response but Twilio uses `code`/`message`. Track down the actual error by querying `https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json` directly.

### 5.14 Sub-Account Settings sidebar (per-client cadence config)

Shipped 2026-05-20 in `phase-night-sub-account-settings-sidebar-fix`. The SYSTEM section of the agency sidebar now has TWO items:

- **Sub-Account Settings** → `/client/<client-uuid>/settings` (per-client config: Timezone, Contact hours, Voicemail, Logo, Description). This is the page hosting the cards added in N7/N8/voicemail-detection.
- **Account Settings** → `/client/<client-uuid>/account-settings` (user-level: email, password, theme).

Click-path for first-time Client #2 setup:

1. Log in as agency.
2. Switch sub-account to Client #2 (top-left sub-account switcher).
3. Sidebar SYSTEM → **Sub-Account Settings**.
4. Configure each card in order:
   - **Client logo + description** — top of page; cosmetic, optional.
   - **Timezone** — IANA select (e.g. `Australia/Brisbane`, `America/New_York`). Must match the `clients.timezone` you set in §4.1 AND the `tz` field in `cadence_quiet_hours`.
   - **Contact hours (cadence quiet-hours window)** — start + end times (24h `<input type="time">`), 7-day toggle row M/T/W/T/F/S/S, IANA tz (defaults to the timezone above). The runtime treats this as the WINDOW WHEN CONTACT IS ALLOWED (not when it's silenced — read the card's preview line "within window: Yes/No" to sanity-check). Falls back to runEngagement default 09:00-21:00 Australia/Brisbane all 7 days if NULL.
   - **Voicemail config** — radio: Hangup (default) / Static text / Dynamic prompt. Detection subsection: enable_voicemail_detection checkbox (default ON), timeout preset buttons (5s/10s/15s/30s/60s/custom). For Static + Prompt modes, the textarea is required. Save & Push: PATCHes `voicemail_option` + `enable_voicemail_detection` + `voicemail_detection_timeout_ms` on every unique Retell agent_id across all 10 slot columns for the client (no publish step needed — these are draft-level settings).

Sourced from [`ClientLayout.tsx:954-977`](frontend/src/components/ClientLayout.tsx#L954-L977) + [`ClientSettings.tsx`](frontend/src/pages/ClientSettings.tsx).

### 5.15 Save Setter (voice picker + safety guard + Fork button)

The Voice-Setter editor at `/client/<client-uuid>/prompts/voice` is where per-slot voice + prompt config lives.

#### 5.15.1 Voice picker (post-2026-05-20)

Hardcoded presets at [`RetellVoiceSelector.tsx:11-48`](frontend/src/components/RetellVoiceSelector.tsx#L11-L48) — verified against Retell's live catalog 2026-05-20:

| Voice ID | Name | Gender | Description |
|---|---|---|---|
| `11labs-Myra` | Myra | female | Warm, conversational |
| `11labs-Marissa` | Marissa | female | Natural pacing, realistic vocal texture |
| `11labs-Brian` | Brian | male | Casual, grounded — like a real sales rep on a phone call |
| `11labs-Cimo` | Cimo | female | Deep, calm tone — natural and trustworthy |

**Pasting a custom voice ID:** the search box accepts any Retell-known voice (e.g. `custom_voice_xxxxxxxx` from the Retell dashboard, `openai-alloy`, `cartesia-*`, raw ElevenLabs IDs that you've registered as Retell custom voices first). Once the popover closes, an EE5-era guard commits non-empty pastes that didn't match a preset.

**Pre-2026-05-20 broken preset:** `11labs-Matt` was removed in `phase-night-remove-broken-matt-preset` — Retell's catalog returned 404 for it. Any prompts.content row that still hardcodes `voice_id: "11labs-Matt"` would fail Save Setter with `Retell API error [404]: Item 11labs-Matt not found from voice`. If you see this on Client #2's first Save Setter, edit the voice picker to any current preset and re-save.

#### 5.15.2 EE1 safety guard + Fork button

Save Setter pushes the slot's prompt to its Retell agent. If `clients.retell_<slot>_agent_id` is shared with sibling slot columns (the shared-agent scenario, common when only 1 inbound DID is provisioned and all 3 directions route to the same agent), the EE1 safety guard fires when the push's `directions` array does NOT cover every column the agent is bound to. Without the guard, the push would silently overwrite the LLM serving the other directions (the 2026-05-18 wipe scenario).

**You'll hit this if:** during onboarding, you set only `retell_inbound_agent_id` (left 2 + 3 NULL), then Save Setter, then notice the dynamic-vars block is generic and edit only the "inbound" direction's prompt. The guard fires because the user is now claiming only 1 column of a 3-column shared agent.

**Toast UI:** "🛡️ Push blocked — agent shared across slots" with a detailed backend message naming the agent + which columns are shared. Shipped 2026-05-20 in `phase-night-per-direction-agent-fork`: when the user has selected EXACTLY ONE direction, the toast also surfaces a **Fork** action button.

Click Fork → modal → confirm → calls retell-proxy `fork-slot-direction`:

1. Reads source agent (the shared one) from `clients.retell_<direction>_agent_id`.
2. Clones the source LLM byte-identical via `create-retell-llm`.
3. Clones the source agent (with whitelisted voice/STT/PII/voicemail fields) via `create-agent`, pointed at the new LLM, agent_name = `"{source name} ({direction label})"`.
4. Publishes the new agent.
5. Repoints the canonical phone-version pin (inbound→slot 1 phone, outbound_initial→slot 2 phone, outbound_followup→slot 3 phone).
6. UPDATEs `clients[directionColumn]` to the new agent_id. **The other 2 direction columns stay pointing at the original shared agent.**
7. Re-runs the original Save Setter (now the safety guard won't fire because the slot has its own agent).

Per the no-internal-prompt-edits rule, the action is a CLONE — no prompt content is mutated. The same client owns the source and the fork.

#### 5.15.3 Publish silently failing — the 6-drafts symptom

If Save Setter PATCH succeeds but the auto-publish step fails (Retell rate-limit, malformed payload, transient 5xx), the new draft accumulates without going live. Shipped 2026-05-20 in `phase-night-surface-publish-warning`: a destructive toast titled "⚠️ Saved + patched, but NOT published to live agent" fires when `data.publish_warning` is set in the 2xx response.

If you see this during onboarding: open Retell dashboard → agent → check version count → if there are unpublished drafts ahead of the live version, click Publish on the latest version. Or re-Save Setter (the publish step runs again).

---

## 6. Cadence + content review (with the client)

1. Open the cloned `engagement_workflows` row in the Engagement editor.
2. For every `engage` node: replace `[BRENDAN: ...]` placeholders with client-approved copy.
3. Apply tone notes from `CADENCE_DESIGN.md`:
   - First-touch SMS < 160 chars (1 segment).
   - `{{first_name}}` not `{{full_name}}`.
   - Sign-off = first name only.
4. Set `delay_seconds` per channel. Defaults: SMS T+0, voice T+2m, follow-up SMS T+30m, voicemail-drop T+24h.
5. Configure quiet hours in the new "Cadence Settings" bar (per-workflow override; or inherit client default).
6. Configure voicemail (Static or Dynamic) in the same bar.
7. Set the "NEW LEADS" toggle ON for this workflow (only one per client). Enter the GHL tag name (e.g. `new-lead`). The `ghl-tag-webhook` will auto-enrol any contact tagged with that value.

DO NOT set `auto_engagement_workflow_id` yet — synthetic dry-run runs first (§7).

---

## 7. Synthetic dry-run

All assertions are SQL queries.

### 7.1 Test lead via intake-lead
```bash
curl -X POST "https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/intake-lead" \
  -H "Authorization: Bearer <intake_lead_secret>" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"<client-uuid>","first_name":"Test","last_name":"Synthetic","phone":"<your-test-phone>","email":"test@example.com","source":"sop-dryrun"}'
```
Assert leads + engagement row:
```sql
SELECT id, lead_id, phone, source FROM leads
WHERE client_id = '<client-uuid>' AND phone = '<your-test-phone>';

SELECT id, status, stop_reason, last_completed_node_index
FROM engagement_executions
WHERE client_id = '<client-uuid>' ORDER BY created_at DESC LIMIT 1;
```

### 7.2 Cadence fires within 5 min (or defers per quiet hours)
```sql
SELECT created_at, message_body, channel
FROM message_queue
WHERE created_at > now() - interval '10 minutes';
```
Twilio outbound also visible in Twilio Console → Messages.

### 7.3 Real Retell call
Trigger via `make-retell-outbound-call`. Assert booking flow + `bookings` row:
```sql
SELECT id, ghl_appointment_id, source, appointment_time, status
FROM bookings WHERE client_id = '<client-uuid>'
ORDER BY created_at DESC LIMIT 1;
```

### 7.4 STOP test
From a test phone, send `STOP`. Assert:
```sql
SELECT * FROM lead_optouts WHERE client_id = '<client-uuid>';

SELECT status, stop_reason FROM engagement_executions
WHERE ghl_contact_id = '<test-lead-ghl-id>'
ORDER BY completed_at DESC LIMIT 1;
-- expect: status=cancelled, stop_reason=opt_out
```

### 7.5 Quiet hours test
Set `cadence_quiet_hours` to a window 1 hour from now. Trigger a cadence. Assert that the message is deferred (Trigger.dev console will show the task in `wait.until()`).

---

## 8. Soft launch + monitoring (days 1-7)

### 8.1 Flip auto-enrolment

```sql
UPDATE clients
SET auto_engagement_workflow_id = '<cloned-workflow-uuid>',
    dm_enabled = true
WHERE id = '<client-uuid>';
```

### 8.2 Push 5 real leads through with the client present (screenshare)

### 8.3 Per-client SQL queries to watch (daily, 5 min)

```sql
-- Funnel
SELECT * FROM cadence_funnel
WHERE client_id = '<client-uuid>' AND day = current_date;

-- SMS errors
SELECT status, error_code, error_message, count(*)
FROM sms_delivery_events
WHERE client_id = '<client-uuid>' AND received_at > now() - interval '24 hours'
  AND status IN ('failed','undelivered')
GROUP BY 1,2,3 ORDER BY 4 DESC;

-- error_logs
SELECT created_at, source, error_message
FROM error_logs
WHERE client_ghl_account_id = '<ghl_location_id>'
  AND created_at > now() - interval '24 hours' ORDER BY 1 DESC LIMIT 50;
```

### 8.4 Trigger.dev console
Filter `payload.client_id = '<client-uuid>'` — watch `process-setter-reply`, `process-messages`, `run-engagement` for FAILED.

### 8.5 SLA
4 hr Mon-Fri week 1, 24 hr business-day after. Single Slack channel per client.

---

## 9. Common pitfalls + debug

| Symptom | First check | Fix |
|---|---|---|
| No SMS reaching client | `dm_enabled = true`? Twilio sig — `receive-twilio-sms/index.ts:316-336` uses public-URL reconstruction (memory `reference_supabase_deno_req_url`). Curl the function directly — expect 403, not 5xx. | Set `dm_enabled = true`. If 5xx, check function logs |
| Cadence not enrolling new leads | `auto_engagement_workflow_id` non-null? `sync-ghl-contact` Trigger.dev runs failing? | UPDATE clients to set the column |
| STOP keyword not honoured | `lead_optouts` row inserted? `endActiveCadences` log line in `receive-twilio-sms`? | Check function logs |
| Booking not closing cadence | GHL bookings webhook configured (§5.2)? `bookings.ghl_appointment_id` populated? | Re-wire the GHL workflow |
| Sig verification 403 | Correct webhook secret column populated? | Update the right column for the right provider |
| AI replies feel off | Setter prompt at `bfd-setter-live.text_prompts` (the client's mirror DB)? Toggle `use_native_text_engine` to compare? | Iterate the system_prompt |
| Echo loop on contact updates | `ghl_last_synced_from_field_id` set per-client? | UPDATE clients with the right field id |
| Voicemail not playing | Is Retell agent's `voicemail_option` set? | Push via `retell-proxy` `update-agent` action |
| Quiet hours not deferring | `cadence_quiet_hours` jsonb shape correct? Per-lead TZ resolving? | Check runEngagement logs for `Quiet-hours gate` lines |

---

## 10. Rollback / offboarding

```sql
-- Disable cadence
UPDATE clients SET auto_engagement_workflow_id = NULL, dm_enabled = false
WHERE id = '<client-uuid>';

-- Disable text engine
UPDATE clients SET use_native_text_engine = false
WHERE id = '<client-uuid>';

-- Cancel active executions
UPDATE engagement_executions
SET status = 'cancelled', stop_reason = 'client_disabled', completed_at = now()
WHERE client_id = '<client-uuid>' AND status IN ('pending','running','waiting');
```

Tear down (if offboarding):
1. Deactivate Twilio webhooks in Twilio Console.
2. Pause/delete the client's external Supabase project from supabase.com.
3. Optional hard delete: `DELETE FROM clients WHERE id = '<client-uuid>';` (cascades).

**Data retention:** before deletion, export `leads`, `bookings`, `cadence_metrics`, `chat_history` to a dated CSV in `Operations/archives/<date>-<client>/`. Default retention: 90 days post-offboard, then purge.

---

## 11. Pricing/packaging note (defer)

Pricing held until 30 days of cost-per-booking data exists per `FUTURE.md` "Cost-per-Booking Analytics". Don't quote prices in this SOP. When a sales conversation requires a number, link to the FUTURE.md item and use a temporary hand-priced engagement letter — recorded in `Operations/handoffs/<date>-pricing-<client>.md`.

---

## 12. Onboarding-script reference

`scripts/onboard-client.mjs` (phase-11h) automates §4.1 (clients INSERT), §4.2 (GHL custom field create + store the returned id on the clients row), and §4.3 (clone BFD default workflow). It prints the new client_id, intake_lead_secret, cloned workflow_id, and a follow-up checklist with click-path steps to take next.

```
node --env-file=.env scripts/onboard-client.mjs \
  --name "Client Display Name" \
  --agency-id <agency-uuid> \
  --ghl-location-id <id> \
  --ghl-pit <pit> \
  --twilio-sid <sid> \
  --twilio-token <token> \
  --twilio-phone <e164> \
  --default-tz "Australia/Brisbane" \
  [--retell-api-key <key>] \
  [--openrouter-key <key>] \
  [--dry-run]
```

Required env vars (in `.env`):
- `SUPABASE_PAT` — Supabase Management API token (`sbp_*`)
- `SUPABASE_PROJECT_REF` — defaults to `bjgrgbgykvjrsuwwruoh` (BFD platform)

Use `--dry-run` first to preview the SQL + GHL POST without executing. The script writes the `intake_lead_secret` to stdout exactly once — capture it; it can't be retrieved later without admin DB access.

The script does NOT cover §1 (pre-sales discovery), §2 (info collection), §3.1 (per-client external Supabase project), §5 (GHL/Retell/Twilio click-paths), §6 (cadence copy review), §7 (dry-run), §8 (soft launch), §9 (debug), §10 (rollback). Those still require human judgement or external dashboard clicks.

---

## §C Mock onboarding checklist (single page)

A one-page tickable reference Brendan can keep open in a second tab while walking the mock onboarding of Client #2. Cross-references the heavier sections by anchor.

### Before the discovery call

- [ ] Brand hierarchy locked: BFD = agency, "Building Flow" = product, Gary (he/him) = persona, BFD-setter = codebase. Confirm with client they accept "Building Flow / Gary" branding (we don't white-label per client yet).
- [ ] Pricing question scoped per §11 — no quote during the mock; defer to the dated engagement letter pattern.

### Discovery call (§1)

- [ ] Volume sizing (§1.1): leads/month, peak hour, peak day, inbound vs outbound mix, voice on/off.
- [ ] Stack inventory (§1.2): GHL location confirmed; Twilio/Retell/OpenRouter/ElevenLabs ownership.
- [ ] Compliance scope (§1.3): region (10DLC for US, Spam Act for AU); consent provenance in writing.
- [ ] Target conversion flow (§1.4): SMS-only? SMS + voice? Voicemail-drop?
- [ ] Working hours + TZ (§1.5): IANA timezone, days-of-week.
- [ ] Tone + banned words (§1.6).
- [ ] Decision-makers + 5-lead soft-launch slot booked (§1.7).
- [ ] Filled `Operations/handoffs/<date>-<client>-discovery.md`.

### Day-1 info collection (§2)

Collect all 22 fields per the table at §2. Save to `Operations/handoffs/<date>-<client>-onboarding-collected.md`.

- [ ] GHL: location_id + PIT with scopes (Contacts/Conversations/Calendars/Workflows/CustomFields).
- [ ] Twilio: BYO or shared BFD (decision tree §3.3).
- [ ] Retell: API key + agent IDs (or you'll create on Day 1).
- [ ] OpenRouter: minted on client's behalf at https://openrouter.ai/keys.
- [ ] External Supabase project provisioned per §3.1 — `<client-slug>-setter-live`.
- [ ] Quiet hours JSON drafted (start, end, IANA tz, days array).
- [ ] Voicemail script (or "hangup" if Pattern A) drafted per §5.14.
- [ ] Brand tone + banned words paste-ready for the client's `text_prompts` row.

### Pre-provisioning (§3)

- [ ] External Supabase project created (§3.1). Captured: project ref, `sb_secret_*`, `sb_publishable_*`, project URL.
- [ ] 5 tables created via SQL editor (chat_history, text_prompts, voice_prompts, documents, leads).
- [ ] Twilio decision made (BYO vs shared).
- [ ] GHL location ID + PIT verified via `GET /locations/<id>` → 200.
- [ ] Retell 5 slot IDs decided (you'll provision new agents or reuse existing).

### DB provisioning (§4)

- [ ] Run `scripts/onboard-client.mjs --dry-run` first.
- [ ] Confirm output SQL + GHL POST look right.
- [ ] Run without --dry-run. **Capture the `intake_lead_secret` and `client_id` immediately** — secret can't be retrieved later.
- [ ] Confirm INSERT included **all 22 fields** including the new `voicemail_config` jsonb and `timezone` text column added 2026-05-20.
- [ ] §4.2 — `last_synced_from` custom field created in GHL; field ID stored in `clients.ghl_last_synced_from_field_id`.
- [ ] §4.2.5 — confirm `clients.ghl_last_synced_from_field_value` is per-client (NOT the default `"1prompt-os"`) — pick a distinctive slug per client like `"acme-co"`.
- [ ] §4.3 — workflow cloned from BFD canonical (DO NOT yet set `auto_engagement_workflow_id`).
- [ ] §4.4 — echo-loop guard sanity check (edit a contact via the platform UI, confirm no extra `sync_ghl_executions` row fires).

### External wiring (§5)

Click-paths (do in order):

- [ ] §5.1 — "Send Setter Reply" workflow (skip under native engine; document the dormant state per §5.13.4).
- [ ] §5.2 — GHL Calendar webhook → `bookings-webhook`.
- [ ] §5.3 — GHL Webhook V2 secret → `clients.ghl_webhook_secret`.
- [ ] §5.4 — Retell custom-tool URLs on each provisioned agent.
- [ ] §5.5 — Retell webhook secret → `clients.retell_webhook_secret`.
- [ ] §5.6 — Retell voicemail config via Sub-Account Settings UI (§5.14) — NOT direct SQL.
- [ ] §5.7 — ElevenLabs (optional; BFD doesn't use it).
- [ ] §5.8 — `intake-lead` website embed handed to the client (or their dev).
- [ ] §5.9 — Twilio inbound SMS webhook configured for every `retell_phone_*`.
- [ ] §5.10 OR §5.13 — pick Pattern A (greenfield ghl-tag-webhook) or Pattern B (snapshot-imported with `Add Lead to 1Prompt OS`). Most agency clients = Pattern B.
- [ ] §5.11 — GHL Custom Conversation Provider (optional polished SMS-thread mirror).
- [ ] §5.12 — Voice call summary push to GHL (optional but recommended; create 2 custom fields + store the IDs).

### Per-client sub-account config (§5.14, post-2026-05-20)

In the platform UI:

- [ ] Switch sub-account to Client #2.
- [ ] Sidebar SYSTEM → **Sub-Account Settings** → confirm renders without redirect.
- [ ] Timezone card → set IANA, save.
- [ ] Contact hours card → set start/end times + 7-day toggles + tz (defaults from above) → preview line shows "within window: Yes/No" → save.
- [ ] Voicemail card → pick Hangup / Static / Dynamic → if not Hangup, fill the textarea → Save & Push. Toast should say "Pushed voicemail to N/N Retell agent(s)".

### Voice setter prompt + Save Setter (§5.15)

- [ ] Sidebar AI → Voice Setters → Voice-Setter-1.
- [ ] Voice picker → choose one of Myra/Marissa/Brian/Cimo (or paste custom voice ID).
- [ ] Setter name → set agent_name (will propagate to Retell).
- [ ] Direction toggle: confirm all 3 ON for the first save (slot 1 inherits all 3 columns).
- [ ] Click Save Setter → expect "Retell AI Synced" toast OR Fork-button flow if guard fires.
- [ ] Open Retell dashboard → confirm agent_name + voice landed; latest version is published.

### Cadence + content review (§6)

- [ ] Open Engagement editor for the cloned workflow.
- [ ] Replace every `[BRENDAN: ...]` placeholder with client-approved copy.
- [ ] First-touch SMS < 160 chars (1 segment).
- [ ] `{{first_name}}` not `{{full_name}}`.
- [ ] Sign-off = first name only.
- [ ] Set `delay_seconds` per channel (defaults: SMS T+0, voice T+2m, follow-up SMS T+30m, voicemail-drop T+24h).
- [ ] Cadence Settings → quiet hours + voicemail config either inherits client default or has workflow-level override.
- [ ] NEW LEADS toggle ON + GHL tag name entered (e.g. `new-lead` or `1prompt - new lead` for Pattern B).

### Synthetic dry-run (§7)

- [ ] §7.1 — test lead via `intake-lead`.
- [ ] §7.2 — cadence fires + Twilio outbound visible.
- [ ] §7.3 — real Retell call (book + confirm `bookings` row).
- [ ] §7.4 — STOP keyword test.
- [ ] §7.5 — quiet hours test.

### Soft launch (§8)

- [ ] §8.1 — flip `auto_engagement_workflow_id` + `dm_enabled = true` via SQL.
- [ ] §8.2 — 5 real leads through with the client on screenshare.
- [ ] §8.3 — daily 5-min SQL watch for week 1 (cadence_funnel + sms_delivery_events + error_logs).
- [ ] §8.4 — Trigger.dev console filtered on `payload.client_id`.
- [ ] §8.5 — Slack channel set up with the client; 4-hr SLA Mon-Fri week 1.

### Brendan-side gotchas (from prior sessions)

- **GHL Snapshot Pattern B clients** ([[reference_ghl_snapshot_pattern_b]]) — the `Add Lead to 1Prompt OS` workflow is the new-lead ingress, NOT `ghl-tag-webhook`. Confirm trigger tag matches what the form-to-tag workflows set.
- **Twilio carrier opt-outs** ([[reference_twilio_carrier_optout]]) — if the test phone has previously texted STOP, error 21610 is sticky at the carrier gateway. Text START from the test phone to clear before the first cadence test.
- **Subscription gate** ([[project_subscription_gate]]) — onboarding inserts `subscription_status='free'`; UPDATE to `'active'` until Stripe billing is wired or new clients get gated.
- **types.ts drift** ([[feedback_types_ts_drift]]) — if you add new columns post-N1/N2, also add them to `frontend/src/integrations/supabase/types.ts` so frontend code compiles cleanly.

### Done-criteria

- [ ] Client receives a real test SMS (n1) within 30s of submitting a real form on their website.
- [ ] Reply lands in their GHL Conversations tab AND/OR Notes within 5s.
- [ ] Voice booking flow completes; appointment lands in GHL Calendar AND `bookings` table.
- [ ] STOP keyword opts out cleanly; `lead_optouts` row written; no further outbound.
- [ ] Daily KPI watch via SQL feeds the cadence_funnel view; no error_logs entries.

This list maps 1:1 to the heavier sections — if anything is unclear during the mock, jump to the linked anchor.

---

## §D Pre-sales prep punch list (for Brendan, before pre-sales call #1)

Surfaced from re-reading the polished SOP. Items Brendan should resolve in his own time BEFORE the first real Client #2 conversation, so he isn't caught flat-footed on the call.

### Pricing + commercial

- [ ] **Decide a temporary number** for the engagement letter (§11 says defer formal pricing until 30 days of cost-per-booking data exists, but you need SOMETHING to put in the letter). Options: flat monthly retainer, per-booking fee, hybrid. **My read:** the FUTURE.md "Cost-per-Booking Analytics" item needs to ship first to give you a real number, but for Client #2 pick a defensible interim — e.g. "$X/mo + $Y per booked appointment for the first 30 days; we'll true up to a usage-based pricing model once data exists". Land this BEFORE the discovery call.
- [ ] **Cancel + refund policy** — minimum term, notice period, what's pro-rated. Write a one-paragraph clause for the engagement letter.
- [ ] **Onboarding fee** — covers the half-day of operator work in §1-§8 plus the per-provider account creation. Suggested floor: $X non-refundable, applied against month 1 if they continue.

### Provider account decisions Brendan must make

- [ ] **Twilio: BYO or share BFD account?** Default in §3.3 is share when <500 SMS/day. Confirm Client #2's expected volume in §1.1 makes share viable; if not, the BYO path means they handle A2P 10DLC registration before you can launch.
- [ ] **OpenRouter: mint on client's behalf or BYO?** Default §3.2 says mint on behalf + invoice through. Reconfirm — if Client #2 wants their own billing, you need to walk them through key minting.
- [ ] **Retell: client BYO or BFD-shared?** §3.2 says per-client BYO. Confirm — and if they BYO, they need to provision their own Retell account before §3.5.
- [ ] **External Supabase: BFD provisions or client provisions?** Default §3.1 says BFD provisions in client's agency-org Supabase account. If client has their own Supabase org, they could provision themselves — but you lose the unified backup posture. Recommend BFD provisions.

### Compliance + legal (§1.3)

- [ ] **TCPA / Spam Act consent verbiage** — exactly what the website lead-form checkbox must say + a copy of the privacy policy update they need to make. Prepare a 1-pager Brendan can hand the client.
- [ ] **A2P 10DLC brand-registration status (US clients only)** — if Client #2 is US-based AND BYO Twilio, they need brand + campaign registration. ~$50 brand + $10/mo campaign. Add to engagement letter as an explicit pre-launch step they own.

### Operational scope decisions

- [ ] **Lead-source coverage** — only website form? Also LinkedIn DMs? CSV uploads? Manual GHL Add Contact? Each source needs a workflow per §5.13.2.
- [ ] **Channels** — SMS only, SMS + voice, SMS + voice + voicemail-drop, SMS + DM? Determines the cadence node mix in §6.
- [ ] **STOP keyword handling** — confirm with client that they accept the automatic STOP handling baked into `receive-twilio-sms` (Phase 4a). Add to engagement letter.
- [ ] **Working hours response policy** — what happens to leads who reply at 11pm? Cadence runs at 09:00 next morning per §1.5 quiet hours, but the engagement letter should state this so client isn't surprised.

### Soft-launch slot booking

- [ ] **Schedule the 5-lead soft-launch session** (§8.2) with the client BEFORE you start §1-§4. They sit with you on screenshare; you push 5 real leads through; cadence sends SMS + voice in real time. ~2hr window. If they can't commit to this, defer the onboarding — pushing live without their eyeballs has caused issues in BFD's own dogfood.

### SOP self-tests Brendan should do BEFORE the call

- [ ] **Walk the mock onboarding (§C) end-to-end against a fake "Client TestCo"** — provision a real Supabase + GHL location + Retell agents + cadence clone. Discover what feels rough so you can polish the operator playbook (this SOP) one more time. ~half day investment.
- [ ] **Time-box the dry-run** — if it takes >6hr you've underestimated the half-day claim at the top of this SOP; revise the SOP estimate before quoting Client #2.

### Documentation Brendan owes the client

- [ ] **"What the client owns vs what BFD operates"** — single page covering: who holds the Twilio account, who can see what in GHL, who controls the cadence copy, who can disable the cadence in an emergency (both — explicit kill switches in §10).
- [ ] **"What to do when something breaks"** — Brendan's pager + SLA tiers + the 24/7 emergency escalation path. Even if it's "ping Brendan on WhatsApp," document it.

### Internal hygiene (BFD ops)

- [ ] **Confirm `Operations/handoffs/<date>-clientTestCo-onboarding-collected.md` template exists** — referenced throughout §2. If the file doesn't exist as a fillable template yet, create it. (Spot-check: looks like the SOP just describes the shape; Brendan creates the file per-client.)
- [ ] **`scripts/onboard-client.mjs --dry-run` works end-to-end** — last verified 2026-05-09 in `phase-night-a-end-to-end-verified` per memory `project_phase_a_closed`. Spot-check one more time before the mock so any provisioning regressions surface NOW not on the live call.

---

End of SOP. Total length ~1100 lines; the §C checklist + this §D punch list make this the source-of-truth for Client #2 onboarding.

