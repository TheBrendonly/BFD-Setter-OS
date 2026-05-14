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
  ghl_webhook_secret, retell_webhook_secret, unipile_webhook_secret,
  ghl_last_synced_from_field_id,
  auto_engagement_workflow_id,
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
  '{}'::jsonb,                              -- voicemail_audio_url, fill later if Twilio path
  NULL,                                     -- ghl_webhook_secret (paste in §5.3)
  NULL,                                     -- retell_webhook_secret (paste in §5.5)
  NULL,                                     -- unipile_webhook_secret
  NULL,                                     -- ghl_last_synced_from_field_id (set in §4.2)
  NULL,                                     -- auto_engagement_workflow_id (set in §8 after copy review)
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

`sync-ghl-contact` skips inbound webhooks where `customField.last_synced_from = "1prompt-os"` AND `leads.updated_at < 60s old`. The check uses `clients.ghl_last_synced_from_field_id` (per-client; D-M5). Confirm by editing a contact via the platform UI and checking that no extra `sync_ghl_executions` row fires.

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
    ↓ adds tag "1prompt - new lead"  (per-source tagging workflow OR form's built-in tag setting)
GHL workflow "Add Lead to 1Prompt OS"
    Trigger: Contact Tag Added = "1prompt - new lead"
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

1. **Trigger:** confirm "Contact Tag Added" with value `1prompt - new lead` (or whatever convention the client uses — must match `clients.new_leads_tag` if you also want `ghl-tag-webhook` to fire, but Pattern B doesn't require this column).
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

For each lead source (website form, LinkedIn DM, manual entry), build a small workflow that just adds the `1prompt - new lead` tag. This decouples lead sourcing from cadence enrollment — adding new sources is a small workflow, not a touch to sync-ghl-contact.

**For a website GHL form:**
1. In **Campaigns** folder → **+ Create Workflow** → name e.g. `Form Submit - "1prompt - new lead" tag added`.
2. **Trigger:** `Form Submitted` → filter `Form is <form-name>` (e.g. `New Lead to GHL`, form id `<form-id>`). **MUST filter to the specific form** — otherwise every form submit on the location triggers a cadence.
3. **Action 1:** `Add Contact Tag` → `1prompt - new lead`.
4. **Publish.**

**Why two workflows and not one combined form-to-webhook:** decoupling means LinkedIn / CSV / manual / future form X all converge on the same tag. Single sync-ghl-contact ingress, multiple lead sources, zero per-source webhook config.

**Conventional tags (BFD location uses these — copy to new clients):**
- `1prompt - new lead` — triggers Add Lead to 1Prompt OS
- `1prompt - stop setter` — set when STOP keyword received; triggers `Stop / Activate Setter` workflow
- `1prompt - text setter`, `1prompt voice setter` — internal routing tags

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
