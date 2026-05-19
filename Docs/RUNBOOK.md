# Runbook

## Deployment topology

BFD-setter runs on four independent services. No one host owns the whole stack.

| Layer | Where it runs | What it does | Canonical env reference |
|---|---|---|---|
| Frontend dashboard | **Railway** service `1prompt-os-production` | Vite-built React admin UI (`frontend/`). Auto-deploys on push to `main`. | [`Docs/RAILWAY_ENV.md`](RAILWAY_ENV.md) |
| n8n workflows | **Railway** (separate service, being decommissioned in Phase 10) | Legacy text-engine + booking workflows. Native edge-fn replacements live behind `clients.use_native_text_engine`. | n8n URLs catalogued in [`Docs/WEBHOOKS.md`](WEBHOOKS.md) |
| Edge functions + platform DB | **Supabase** (`bjgrgbgykvjrsuwwruoh`) | All webhooks, integrations, and `bfd-platform` Postgres. Deploy with `supabase functions deploy`. | See "Deploys → Edge function" below |
| Background tasks | **Trigger.dev** cloud (`proj_fdozaybvhgxnzopabtse`) | Long-running cadence + AI generation tasks under `trigger/`. Deploy with `npx trigger.dev deploy`. | See "Deploys → Trigger.dev tasks" below |

**Lovable hosts nothing for BFD.** The repo was originally scaffolded with the Lovable AI builder (which previously hosted a preview of the frontend), but BFD's production runs on Railway. The `frontend/.lovable/` directory and any `lovable-tagger` plugin references are inert artifacts from the import; safe to delete. The orphan `.lovable/plan.md` was removed 2026-05-14.

## Deploys

### Edge function (single, canonical)

Use the bundle endpoint via `scripts/deploy_retell_proxy_bundle.mjs` — it always attaches every `_shared/*.ts` file, so functions importing from `../_shared/` work the first time. (The legacy `supabase functions deploy` CLI silently drops `_shared/` references on Supabase's `--no-remote` runtime, which is what broke 27 functions during the EE3 regression. Bundle endpoint is the now-canonical method.)

```bash
cd /srv/bfd/Projects/bfd-setter
set -a && source .env && set +a
node scripts/deploy_retell_proxy_bundle.mjs <slug>
# omit <slug> to default to retell-proxy
```

The script reads the current `verify_jwt` so it's preserved across deploys, prints the new version, and runs a boot probe (HTTP 401 for jwt-required fns, 400 for `verify_jwt=false`).

### Edge function (batch / multiple slugs)

`scripts/deploy_with_shared.mjs` loops over a `SLUGS` array. Today the array is the EE3-sweep list (kept as the "last batch used" example). For a new batch, edit the array in-place or copy the file under a phase-specific name.

```bash
set -a && source .env && set +a
node scripts/deploy_with_shared.mjs
```

### Trigger.dev tasks
```bash
TRIGGER_ACCESS_TOKEN=$(grep '^TRIGGER_DEPLOY_PAT=' .env | cut -d= -f2) \
  npx -y trigger.dev@latest deploy --env prod
```

### Supabase migration via Management API
```bash
node --env-file=.env -e "
const sql = \`<your migration SQL>\`;
const r = await fetch('https://api.supabase.com/v1/projects/bjgrgbgykvjrsuwwruoh/database/query', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + process.env.SUPABASE_PAT,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: sql })
});
console.log(await r.json());
"
```

### Frontend dashboard (Railway)
Auto-deploys on push to `main`. To redeploy without code change: hit the **Redeploy** button in Railway UI for the frontend service.

## Rollback

### One phase back (preferred)
```bash
git revert phase-N..HEAD             # creates a revert commit
git push origin main                  # triggers Railway redeploy
# Redeploy affected edge fns + Trigger.dev tasks per CHANGES_LOG.md "files changed" list
```

### Hard reset (only if forward-fix is impossible)
```bash
git reset --hard <commit-before-broken-phase>
git push --force-with-lease origin main
```
**Warning:** force-push rewrites history. Coordinate with anyone working on the repo.

## Critical operations

### Flip a client to native text engine (Phase 9)
```sql
-- Pre-flight: confirm processSetterReply is deployed
-- (Trigger.dev console should show task `process-setter-reply` at the latest version)

UPDATE clients SET use_native_text_engine = true WHERE id = '<client-uuid>';
```

To roll back instantly:
```sql
UPDATE clients SET use_native_text_engine = false WHERE id = '<client-uuid>';
```

No deploy needed — `processMessages.ts` reads the flag on every run.

### Enable cadence auto-enrolment for a client
```sql
-- Pre-flight: review the workflow nodes
SELECT id, name, jsonb_array_length(nodes) AS node_count
FROM engagement_workflows
WHERE client_id = '<client-uuid>';

-- Enable
UPDATE clients SET auto_engagement_workflow_id = '<workflow-uuid>'
WHERE id = '<client-uuid>';
```

Disable: `UPDATE clients SET auto_engagement_workflow_id = NULL WHERE id = '...'`.

### Cancel an active engagement execution
```sql
-- Find it
SELECT id, trigger_run_id FROM engagement_executions
WHERE ghl_contact_id = '<lead-id>' AND status IN ('pending','running','waiting');

-- Cancel
UPDATE engagement_executions
SET status = 'cancelled', stop_reason = 'manual', completed_at = now()
WHERE id = '<execution-uuid>';
```

Then cancel the Trigger.dev run via:
```bash
curl -X POST https://api.trigger.dev/api/v2/runs/<run_id>/cancel \
  -H "Authorization: Bearer $TRIGGER_SECRET_KEY"
```

### Manually opt-out a phone number
```sql
INSERT INTO lead_optouts (client_id, phone, source)
VALUES ('<client-uuid>', '+61400000000', 'manual')
ON CONFLICT (client_id, phone) DO NOTHING;

UPDATE leads SET setter_stopped = true
WHERE client_id = '<client-uuid>' AND phone = '+61400000000';
```

### Add a per-client custom field id for last_synced_from
1. In the client's GHL location → Settings → Custom Fields → New, name `last_synced_from`, type Single Line Text, applies to Contacts. Note the field id.
2. Persist per-client:
   ```sql
   UPDATE clients
   SET ghl_last_synced_from_field_id    = '<the-field-id>',
       ghl_last_synced_from_field_value = '<distinctive-slug>'   -- e.g. 'acme-co'; defaults to '1prompt-os'
   WHERE id = '<client-uuid>';
   ```
3. No redeploy needed since N1 (2026-05-19) — `push-contact-to-ghl` and `sync-ghl-contact` both read these columns at request time.

The `_value` column is the echo-stamp string written into the GHL custom field and matched on inbound webhooks to skip self-originated updates. Distinct per client so multi-tenant deployments don't cross-stamp.

## Incident playbooks

### "Inbound SMS pipeline silent"
Confirm with:
```sql
SELECT count(*) FROM message_queue WHERE created_at > now() - interval '1 hour';
```
If 0:
1. Check Twilio Messages log: did Twilio attempt the webhook? Note `error_code` if any (11200 = HTTP retrieval failure).
2. Curl the function directly: `curl -X POST 'https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/receive-twilio-sms'` — expect 405 (GET) or 403 (POST without sig).
3. If 5xx: Supabase function is broken. Check function logs in dashboard.
4. If 200 from curl but Twilio still gets non-200: the gateway is rejecting Twilio's POST due to a JWT verification mis-config. Check `verify_jwt = false` in config.toml AND the Management API listing.
5. Reference: session-5 handoff, the req.url-vs-public-URL bug.

### "AI replies stop arriving"
1. Check `error_logs` last hour
2. Check Trigger.dev console for failed `process-messages` runs
3. If `client.use_native_text_engine = true`: also check `process-setter-reply` runs
4. n8n down? `curl https://primary-production-392b.up.railway.app/healthz`
5. OpenRouter key invalid? Test: `curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer $key"`

### "Webhook returning 403"
1. Sig mismatch — check the function logs for the warn message
2. Public URL reconstruction issue (req.url vs SUPABASE_URL)
3. Token mismatch — DB token vs provider's current primary

## Pre-flight checklists

### Before flipping `use_native_text_engine` (Phase 9)
- [ ] processSetterReply task deployed and visible in Trigger.dev console
- [ ] Side-by-side test of 5 historical messages logged in CHANGES_LOG.md, diffs reviewed
- [ ] Trigger.dev runs for processSetterReply succeed (no failures in last 24h test runs)
- [ ] No errors in `error_logs` for `source = 'process-setter-reply'`

### Before enabling auto-enrolment for a client
- [ ] `engagement_workflows.nodes` reviewed — every `engage` node has client-edited copy (no `[BRENDAN: ...]` placeholders)
- [ ] Quiet hours configured: `clients.cadence_quiet_hours` set (or default of 9-9 acceptable)
- [ ] STOP keyword path tested
- [ ] One real lead enrolled manually first, watched through full cadence

### Before n8n decommission (Phase 10)
- [ ] BFD running on `use_native_text_engine = true` for ≥ 14 days
- [ ] Zero regressions logged in CHANGES_LOG.md
- [ ] `voice-booking-tools` agent URL repointed and tested with a live booking
- [ ] `kb-ingest` tested with a real KB doc upload
- [ ] All clients (currently just BFD) flipped

## Embed `intake-lead` on a client website (after Phase 5)

Drop this on the form's success handler:
```html
<script>
async function intakeBuildingFlow(formData) {
  const r = await fetch('https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/intake-lead', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer <YOUR_INTAKE_SECRET>'
    },
    body: JSON.stringify({
      clientId: '<YOUR_CLIENT_ID>',
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

Each client gets their own `intake_lead_secret`. Lookup:
```sql
SELECT id, name, intake_lead_secret FROM clients WHERE id = '<client-uuid>';
```

To rotate: `UPDATE clients SET intake_lead_secret = encode(gen_random_bytes(24), 'base64') WHERE id = '...'`. Then update the embed script.

## GHL configuration playbook

### Configuring the GHL "Send Setter Reply" workflow → bookings webhook (Phase 7c)
Brendan, in GHL:
1. Go to **Workflows** → New → **Calendar Events**
2. Trigger: **Appointment Created** + **Appointment Updated** + **Appointment Cancelled**
3. Action: **Webhook** → URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook`
4. Payload: include `appointmentId`, `contactId`, `calendarId`, `startTime`, `endTime`, `status`
5. Save + activate

### Enabling Webhook V2 for sig verification (Phase 8a)
Brendan, in GHL:
1. **Settings** → **Marketplace** → **Webhooks v2** → **Enable**
2. Note the webhook secret shown — paste into `clients.ghl_webhook_secret` for each client location

### Tag-based auto-enrolment via `ghl-tag-webhook` (Phase 11e)

For tag-driven cadence enrolment, the operator picks ONE workflow per client to be the new-leads campaign and configures the GHL workflow:

1. In the BFD-setter UI: **Workflows** list → flip the **NEW LEADS** Switch ON for the chosen campaign → enter the tag name (e.g. `new-lead`). At-most-one workflow per client may be ON (server-enforced via partial unique index).
2. In GHL: **Workflows** → New → **Contact** → Trigger: **Contact Tag** with **Has Tag** = `<tag-from-step-1>`.
3. Add Action: **Webhook** → URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/ghl-tag-webhook` → Method: POST → Body: include at minimum `contactId`, `locationId`, and the post-update `tags` array (or `addedTags`).
4. Save + activate.

When a contact gets the tag (manually or via any GHL workflow), the webhook fires, the matching workflow is found, the lead is upserted into `leads`, and an `engagement_executions` row is created in `pending` then dispatched via Trigger.dev. The cadence runs to completion; runEngagement removes the tag at every terminal `stop_reason` (`sequence_complete`, `inbound_reply`, `booking_created`, `opt_out`, `cancelled`, `error`).

Sig verification: when `clients.ghl_webhook_secret` is set, an HMAC-SHA256 hex `x-wh-signature` header is required (computed over the raw body). Backwards-compat: skipped when no secret is configured.

Smoke-test (BFD): `curl -i -X POST https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/ghl-tag-webhook -H 'Content-Type: application/json' -d '{"contactId":"<bfd-contact-id>","locationId":"xo0XjmenBBJxJgSnAdyM","addedTags":["new-lead"]}'` → expect `{"ok":true,"enrolled":"<execution-id>"}`.

## Synthetic probe setup (phase-11g)

`trigger/syntheticProbe.ts` runs hourly, posts a fake lead to `intake-lead`, asserts the cadence enters `running` and an outbound `message_queue` row appears within 90s, then cancels. Pass/fail rows go into `probe_results`. On failure it pings `PROBE_ALERT_WEBHOOK_URL` (Slack/Discord-compatible).

### One-off provisioning (operator)

1. Create a dedicated client row + a 1-node test workflow:

```sql
-- A throwaway client just for the probe. Use a Twilio number you OWN.
INSERT INTO public.clients (
  id, agency_id, name,
  twilio_account_sid, twilio_auth_token, retell_phone_1, twilio_default_phone,
  cadence_quiet_hours, intake_lead_secret, dm_enabled,
  use_native_text_engine, llm_model
) VALUES (
  gen_random_uuid(),
  '<agency-uuid>',
  'Synthetic Probe (do not delete)',
  '<twilio-sid>', '<twilio-auth>', '<twilio-from-e164>', '<twilio-from-e164>',
  -- 24/7 so the probe never defers
  '{"start":"00:00","end":"23:59","tz":"Australia/Brisbane","days":[1,2,3,4,5,6,7]}'::jsonb,
  encode(gen_random_bytes(24), 'base64'),
  false,
  true,
  'openai/gpt-4.1-nano'
)
RETURNING id, intake_lead_secret;

-- Save the returned id as <probe-client-id>; intake_lead_secret as <probe-secret>.

-- 1-node workflow that fires a single SMS at T+0 (use a clearly-marked test message).
-- Note: engagement_workflows has no is_active column; rows are treated as active by default.
INSERT INTO public.engagement_workflows (id, client_id, name, nodes)
VALUES (
  gen_random_uuid(),
  '<probe-client-id>',
  'Synthetic probe — single SMS',
  '[{"id":"n1","type":"engage","channels":[{"type":"sms","enabled":true,"message":"[probe] do not respond","delay_seconds":0}]}]'::jsonb
)
RETURNING id;

-- Save returned id as <probe-workflow-id>.

UPDATE public.clients
  SET auto_engagement_workflow_id = '<probe-workflow-id>'
  WHERE id = '<probe-client-id>';
```

2. Set Trigger.dev cloud env vars (Project Settings → Environment Variables):
   - `PROBE_CLIENT_ID` = `<probe-client-id>`
   - `PROBE_INTAKE_SECRET` = `<probe-secret>`
   - `PROBE_TEST_PHONE` = `<your-test-phone-e164>` (will receive the test SMS each hour)
   - `PROBE_ALERT_WEBHOOK_URL` = optional Slack/Discord webhook URL

3. Deploy: `cd <repo> && npx trigger.dev deploy --env prod`. Confirm `synthetic-probe` appears in the Trigger.dev cloud console scheduled tasks list.

### Reading results

```sql
-- Last 24 hours of probe runs
SELECT ran_at, passed, duration_ms, error_message
FROM probe_results
WHERE ran_at > now() - interval '24 hours'
ORDER BY ran_at DESC;

-- Failure rate for the past week
SELECT date_trunc('day', ran_at) AS day,
       count(*) FILTER (WHERE passed) AS passes,
       count(*) FILTER (WHERE NOT passed) AS fails
FROM probe_results
WHERE ran_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;
```

## Environment

Local `.env` template at `.env.example`. Required for autonomous sessions:
- `SUPABASE_PAT` — Supabase Management API PAT (account-level)
- `BFD_PLATFORM_SECRET_KEY` — bfd-platform service-role key (sb_secret_*)
- `BFD_PLATFORM_ANON_KEY` — bfd-platform publishable key (sb_publishable_*)
- `BFD_SETTER_LIVE_SECRET_KEY` — bfd-setter-live service-role key
- `BFD_RETELL_API_KEY` — BFD's Retell API key
- `BFD_TWILIO_ACCOUNT_SID` + `BFD_TWILIO_AUTH_TOKEN` — for Twilio API calls during scripts
- `BFD_GHL_PIT` + `BFD_GHL_LOCATION_ID` — for GHL API calls during scripts
- `BFD_CLIENT_ID` — for SQL filters during scripts
- `TRIGGER_DEPLOY_PAT` — for `npx trigger.dev deploy`

Pre-commit hook (`.git/hooks/pre-commit`) runs `scripts/check-secrets.mjs` to block accidental re-leakage. NEVER inline secrets in committed code.
