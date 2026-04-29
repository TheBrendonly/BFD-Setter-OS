# Changes Log

Append-only. One row per phase / sub-phase as it ships. Used to roll back.

| Date | Phase | Commit SHA | Tag | Files changed | Revert |
|---|---|---|---|---|---|
| 2026-04-30 | 0 — Docs scaffold | `0967238` | `phase-0-docs` | `Docs/*` (7 new) | `git revert phase-0-docs..HEAD` |
| 2026-04-30 | 6 — Bidirectional GHL sync | `68237a5` | `phase-6-bidi-sync` | `frontend/supabase/functions/push-contact-to-ghl/index.ts:33` (field id), `frontend/supabase/functions/sync-ghl-contact/index.ts` (echo guard), `n8n/exports/Text_Engine_REVERSE_ENGINEERED.md` (NEW) | `git revert phase-6-bidi-sync..HEAD` then redeploy push-contact-to-ghl + sync-ghl-contact |
| 2026-04-30 | 1 — Text Engine port | `0e76001` | `phase-1-text-engine-port` | `trigger/processSetterReply.ts` (NEW), `trigger/processMessages.ts` (branch on `client.use_native_text_engine`) | `git revert phase-1-text-engine-port..HEAD` then `npx trigger.dev deploy --env prod` |
| 2026-04-30 | 7a — Tracking schema | `22b61d5` | `phase-7a-tracking-schema` | `frontend/supabase/migrations/20260430120000_phase7a_tracking_schema.sql` (NEW). Tables: `lead_optouts`, `sms_delivery_events`, `cadence_metrics`, `bookings`. Cols on `clients`: `cadence_quiet_hours`, `intake_lead_secret`, `voicemail_audio_url`, `ghl_webhook_secret`, `unipile_webhook_secret`. RLS agency-scoped. | Migration is additive — manual revert via `DROP TABLE bookings, cadence_metrics, sms_delivery_events, lead_optouts; ALTER TABLE clients DROP COLUMN cadence_quiet_hours, DROP COLUMN intake_lead_secret, DROP COLUMN voicemail_audio_url, DROP COLUMN ghl_webhook_secret, DROP COLUMN unipile_webhook_secret;` |
| 2026-04-30 | 4a + 4c — STOP keyword + reply-detected cadence-end | _this commit_ | `phase-4a-4c-stop-and-reply-end` | `frontend/supabase/functions/receive-twilio-sms/index.ts` (STOP/START regex + lead_optouts upsert + setter_stopped + endActiveCadences helper, reply-end after message_queue insert), `frontend/supabase/functions/receive-dm-webhook/index.ts` (column bug fix `lead_id`→`ghl_contact_id` on engagement_executions; canonical `inbound_reply` stop_reason). | `git revert phase-4a-4c..HEAD` then redeploy `receive-twilio-sms` + `receive-dm-webhook` |

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
