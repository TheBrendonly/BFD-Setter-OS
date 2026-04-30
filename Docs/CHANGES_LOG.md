# Changes Log

Append-only. One row per phase / sub-phase as it ships. Used to roll back.

| Date | Phase | Commit SHA | Tag | Files changed | Revert |
|---|---|---|---|---|---|
| 2026-04-30 | 0 — Docs scaffold | `0967238` | `phase-0-docs` | `Docs/*` (7 new) | `git revert phase-0-docs..HEAD` |
| 2026-04-30 | 6 — Bidirectional GHL sync | `68237a5` | `phase-6-bidi-sync` | `frontend/supabase/functions/push-contact-to-ghl/index.ts:33` (field id), `frontend/supabase/functions/sync-ghl-contact/index.ts` (echo guard), `n8n/exports/Text_Engine_REVERSE_ENGINEERED.md` (NEW) | `git revert phase-6-bidi-sync..HEAD` then redeploy push-contact-to-ghl + sync-ghl-contact |
| 2026-04-30 | 1 — Text Engine port | `0e76001` | `phase-1-text-engine-port` | `trigger/processSetterReply.ts` (NEW), `trigger/processMessages.ts` (branch on `client.use_native_text_engine`) | `git revert phase-1-text-engine-port..HEAD` then `npx trigger.dev deploy --env prod` |
| 2026-04-30 | 7a — Tracking schema | `22b61d5` | `phase-7a-tracking-schema` | `frontend/supabase/migrations/20260430120000_phase7a_tracking_schema.sql` (NEW). Tables: `lead_optouts`, `sms_delivery_events`, `cadence_metrics`, `bookings`. Cols on `clients`: `cadence_quiet_hours`, `intake_lead_secret`, `voicemail_audio_url`, `ghl_webhook_secret`, `unipile_webhook_secret`. RLS agency-scoped. | Migration is additive — manual revert via `DROP TABLE bookings, cadence_metrics, sms_delivery_events, lead_optouts; ALTER TABLE clients DROP COLUMN cadence_quiet_hours, DROP COLUMN intake_lead_secret, DROP COLUMN voicemail_audio_url, DROP COLUMN ghl_webhook_secret, DROP COLUMN unipile_webhook_secret;` |
| 2026-04-30 | 4a + 4c — STOP keyword + reply-detected cadence-end | `8809f1f` | `phase-4a-4c-stop-and-reply-end` | `frontend/supabase/functions/receive-twilio-sms/index.ts` (STOP/START regex + lead_optouts upsert + setter_stopped + endActiveCadences helper, reply-end after message_queue insert), `frontend/supabase/functions/receive-dm-webhook/index.ts` (column bug fix `lead_id`→`ghl_contact_id` on engagement_executions; canonical `inbound_reply` stop_reason). | `git revert phase-4a-4c..HEAD` then redeploy `receive-twilio-sms` + `receive-dm-webhook` |
| 2026-04-30 | 5 — intake-lead public endpoint | `f670942` | `phase-5-intake-lead` | `frontend/supabase/functions/intake-lead/index.ts` (NEW). Per-client shared-secret POST endpoint; find-or-create GHL contact; dual-write to platform.leads + client mirror; optional auto-enroll in cadence. | `git revert phase-5-intake-lead..HEAD` then `supabase functions delete intake-lead --project-ref bjgrgbgykvjrsuwwruoh` |
| 2026-04-30 | 4b + 4d — quiet hours + voicemail-drop | `70bb24b` | `phase-4b-4d-quiet-and-voicemail` | `trigger/runEngagement.ts` (quiet-hours guard before each engage / send_sms / send_whatsapp / phone_call node + per-lead TZ resolution from phone prefix; voicemail-drop branch via Twilio AMD `<Play>` bypassing Retell), `frontend/supabase/functions/_shared/business-hours.ts` (NEW shared helper), `frontend/supabase/functions/bulk-insert-leads/index.ts` (refactor to import shared helper). | `git revert phase-4b-4d..HEAD` then `npx trigger.dev deploy --env prod` + redeploy bulk-insert-leads |
| 2026-04-30 | 2 + 3 — voice-booking-tools + kb-ingest | `4b01011` | `phase-2-3-n8n-port-tools` | `frontend/supabase/functions/voice-booking-tools/index.ts` (NEW; tools: get-available-slots, book-appointments, get-contact-appointments, update-appointment, cancel-appointments; writes to bookings; ends cadence on book), `frontend/supabase/functions/kb-ingest/index.ts` (NEW). Brendan still must repoint Retell + ElevenLabs agent tool URLs to `/functions/v1/voice-booking-tools?tool=<tool>&clientId=<uuid>` for the cutover. | `git revert phase-2-3..HEAD` then `supabase functions delete voice-booking-tools kb-ingest --project-ref bjgrgbgykvjrsuwwruoh` |
| 2026-04-30 | 7b/c/d/e — Tracking funnel runtime | `d82c7a2` | `phase-7b-c-d-e-tracking-runtime` | `frontend/supabase/functions/twilio-status-webhook/index.ts` (NEW), `frontend/supabase/functions/bookings-webhook/index.ts` (NEW), `frontend/supabase/migrations/20260430130000_phase7d_cadence_funnel_view.sql` (NEW materialised view + refresh fn), `trigger/runEngagement.ts` (cadence_metrics buffer + writeCadenceMetrics on every exit + reply detection + voicemail/calls counters), `trigger/processMessages.ts` (StatusCallback param on outbound + outbound message_queue stamp), `frontend/supabase/functions/receive-twilio-sms/index.ts` (StatusCallback on compliance reply). | `git revert phase-7b-c-d-e..HEAD` then redeploy receive-twilio-sms + remove twilio-status-webhook + bookings-webhook + `DROP MATERIALIZED VIEW cadence_funnel; DROP FUNCTION refresh_cadence_funnel();` + `npx trigger.dev deploy --env prod` |
| 2026-04-30 | 8a/b/c — Webhook signature verification | `c9e1c38` | `phase-8-webhook-sigs` | `frontend/supabase/migrations/20260430140000_phase8_webhook_secrets.sql` (NEW: `clients.retell_webhook_secret`), `frontend/supabase/functions/receive-dm-webhook/index.ts` (GHL `x-wh-signature` HMAC-SHA256 hex when `clients.ghl_webhook_secret` is set), `frontend/supabase/functions/retell-call-analysis-webhook/index.ts` (Retell `x-retell-signature` when `clients.retell_webhook_secret` is set), `frontend/supabase/functions/unipile-webhook/index.ts` (Unipile `x-unipile-signature` when `clients.unipile_webhook_secret` is set). All three are backwards-compatible: skip verification when no secret configured. | `git revert phase-8-webhook-sigs..HEAD` then redeploy the three edge fns |
| 2026-04-30 | 11a — Cadence overrides schema + D-M5 + D-M3 | `949a37d` | `phase-11a-cadence-overrides-d-m5-d-m3` | `frontend/supabase/migrations/20260501000000_phase11a_cadence_overrides.sql` (NEW: `engagement_workflows.quiet_hours_override`, `is_new_leads_campaign`, `new_leads_tag`, `voicemail_config`; partial unique index for at-most-one new-leads campaign per client; `clients.ghl_last_synced_from_field_id` + BFD backfill); `frontend/supabase/functions/push-contact-to-ghl/index.ts` (D-M5 reads per-client field id, legacy fallback to BFD constant); `frontend/supabase/functions/sync-ghl-contact/index.ts` (echo-loop guard reads per-client field id); `trigger/refreshCadenceFunnel.ts` (NEW D-M3 hourly scheduled task running `refresh_cadence_funnel()`). Deployed via Trigger.dev v20260430.1 (8 tasks). User-facing docs: `User Todos.md`, `Docs/CLIENT_ONBOARDING_SOP.md`, `Docs/NEXT_SESSION_PROMPT.md`. | `git revert phase-11a..HEAD` then redeploy push-contact-to-ghl + sync-ghl-contact + `npx trigger.dev deploy --env prod`; manual SQL revert: `ALTER TABLE engagement_workflows DROP COLUMN quiet_hours_override, DROP COLUMN is_new_leads_campaign, DROP COLUMN new_leads_tag, DROP COLUMN voicemail_config; DROP INDEX engagement_workflows_one_new_leads_per_client; ALTER TABLE clients DROP COLUMN ghl_last_synced_from_field_id;` |

## Format for future entries

```
| YYYY-MM-DD | <phase> — <slug> | <sha> | `phase-N-<slug>` | <comma-separated files> | `git revert phase-N..HEAD` |
```

## Detailed notes (per phase)

### Phase 6 — Bidirectional GHL sync complete (2026-04-30)

**Why now (out of phase order):** Brendan asked to action the two pre-flight items from the master plan that needed his login. The GHL custom field can be created via API (this session has BFD's PIT). The n8n export needs Brendan's n8n login, so I reverse-engineered the I/O contract from the only caller in our codebase (`processMessages.ts`) instead. Phase 1 can now proceed in the new session without blocking on the actual n8n JSON export.

**GHL custom field `last_synced_from`** created via `POST /locations/xo0XjmenBBJxJgSnAdyM/customFields` (BFD location). Field id `PQNTqtTnIw9Uu0XLLE5M`, fieldKey `contact.last_synced_from`, dataType `TEXT`. Created on BFD's account; for non-BFD clients, recreate per-location at onboarding.

**Code changes:**
- `frontend/supabase/functions/push-contact-to-ghl/index.ts:33` — `BFD_LAST_SYNCED_FROM_FIELD_ID = "PQNTqtTnIw9Uu0XLLE5M"`. Every outbound `PUT /contacts/{id}` now stamps the field.
- `frontend/supabase/functions/sync-ghl-contact/index.ts` — added echo-loop guard: if the inbound contact webhook contains `customField.last_synced_from = "1prompt-os"` AND `leads.updated_at` is < 60s old, return early with `status: "skipped_echo"`. Logs the skip in `sync_ghl_executions` for observability.

**Deploys:**
- `push-contact-to-ghl` → v2
- `sync-ghl-contact` → v8

**n8n export equivalent:** `n8n/exports/Text_Engine_REVERSE_ENGINEERED.md` — full I/O contract from reading `processMessages.ts:204-282`. Phase 1 can build `processSetterReply.ts` against this. Brendan should still export the live JSON when convenient for the LLM prompt internals.

**Rollback:**
- `git revert phase-6-bidi-sync..HEAD`
- Redeploy push-contact-to-ghl + sync-ghl-contact
- (Optional) the GHL custom field can stay — harmless if unused

### Phase 0 — Docs scaffold (2026-04-30)

**Files:**
- `Docs/MASTER_PLAN.md` — mirror of canonical plan file
- `Docs/ARCHITECTURE.md` — component map + 4 mermaid sequence diagrams
- `Docs/CADENCE_DESIGN.md` — engagement engine spec, state machine, node types, Phase 4a-4d details
- `Docs/TRACKING.md` — funnel definition + table schemas + sample SQL queries
- `Docs/RUNBOOK.md` — deploys, rollback, incident playbooks, GHL config
- `Docs/CHANGES_LOG.md` — this file
- `Docs/FUTURE.md` — out-of-scope items including the appointment reminder GHL campaign

**Notes:**
- All 7 docs in repo to be readable from any session
- The canonical plan file lives at `C:\Users\brend\.claude\plans\resuming-1prompt-os-work-read-reactive-puffin.md` and `Docs/MASTER_PLAN.md` is its in-repo mirror

**Rollback:**
- `git revert phase-0-docs..HEAD && git push origin main` — purely additive, low risk
