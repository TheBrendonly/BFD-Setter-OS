# BFD-setter — Master Rebuild Plan

> Mirror of `C:\Users\brend\.claude\plans\resuming-1prompt-os-work-read-reactive-puffin.md`. The plan file is the canonical source; this is the in-repo copy so a fresh session sees it via the codebase.

## Context

The product is: leads come in, BFD-setter runs the optimal multi-channel cadence (SMS / WhatsApp / voice) to maximise booked appointments, and tracks every step of the funnel. Today the system has the right components but isn't wired end-to-end for that goal.

**What is broken or missing:**

- n8n owns LLM orchestration (single point of failure, opaque JSON workflows, version-pinned to 2.17.7)
- No automatic lead enrolment in cadences when a lead arrives
- No tracking funnel — leads → texted → replied → called → picked up → booked is invisible
- No quiet hours / opt-out — sends 24/7, no STOP keyword handling (regulatory risk)
- No reply-detected cadence-end — the engagement engine keeps texting people who already replied
- No booking-detected cadence-end — keeps chasing people who already booked
- No Twilio delivery callbacks — silent SMS failures
- 3 inbound webhooks have no signature verification (B4 from prior plan)

**Goal:** ship native TS that replaces n8n, build the engagement engine end-to-end, add the funnel tracking, harden security. Phased so we can revert cleanly. Designed for a bypass-permissions session to execute autonomously — every phase ends in a commit + git tag.

## Decisions

- **Cadence copy:** placeholders, Brendan edits before turning live cadences on.
- **n8n flag flip:** code ships behind `clients.use_native_text_engine = false` default. Brendan reviews sample outputs side-by-side before flipping (Phase 9).
- **Test spend cap:** $10 OpenRouter. Prefer cheap models: `openai/gpt-4.1-nano`, `anthropic/claude-haiku-4.5`, `google/gemini-2.5-flash-lite`.
- **Booking-detected → cadence ends.** Stop chasing booked leads automatically.
- **Appointment reminder cadence (post-booking) is OUT OF SCOPE.** See `FUTURE.md` — separate GHL campaign workstream.

## Pre-flight (Brendan action, before kickoff)

- Export the three n8n workflows as JSON: `Text_Engine.json`, `Appointment_Booking_Functions.json`, `Update_Knowledgebase.json`. Save into `n8n/exports/`. Without these the port is reverse-engineered from request/response shapes — possible but slower.
- Update local `.env` per session-5 handoff §D (Twilio sid/token, GHL location id, sb_secret_*).

## Phases

| Phase | Scope | Parallel? | Status |
|---|---|---|---|
| 0 | Docs scaffold + baseline | — | shipped 2026-04-30 |
| 1 | n8n port: Text_Engine → `processSetterReply.ts` (flag still false) | — | pending |
| 2 | n8n port: `voice-booking-tools` edge fn | parallel with 3 | pending |
| 3 | n8n port: `kb-ingest` edge fn | parallel with 2 | pending |
| 4 | Engagement engine: STOP, quiet hours, reply-end, voicemail-drop | parallel with 2-3 | pending |
| 5 | `intake-lead` public endpoint | parallel with 4 | pending |
| 6 | Bidirectional GHL sync — wire `last_synced_from` custom field | parallel | pending |
| 7 | Tracking funnel: schema, status callbacks, GHL appointment webhook, views | parallel | pending |
| 8 | Security: B4 webhook sig verification (GHL/Retell/Unipile) | parallel | pending |
| 9 | Cutover: Brendan flips `use_native_text_engine` for BFD | sequential | pending |
| 10 | Decommission: delete n8n callsites + Railway service | sequential, +2 weeks soak | pending |

Each phase ends with: (a) a commit, (b) a git tag `phase-N-<slug>`, (c) a row in `CHANGES_LOG.md`.

## Phase summaries

See the canonical plan file for full detail. Below is the bullet view.

### Phase 1 — `processSetterReply.ts` (Text_Engine port)

Build a Trigger.dev task that mirrors n8n's Text_Engine contract:
- Input: `{ Message_Body, Lead_ID, Contact_ID, GHL_Account_ID, Name, Email, Phone, Setter_Number }`
- Output: `{ Message_1?, Message_2?, ... }`
- Reads setter prompt + chat_history, calls OpenRouter, parses multi-message response
- Branches `processMessages.ts:191-218` on `client.use_native_text_engine`
- Reference template: `trigger/sendFollowup.ts:11-29, 129`

### Phase 2 — `voice-booking-tools` edge fn

Replace n8n booking workflow. Single edge fn, dispatch on `?tool=` query:
- `get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments`
- Calls GHL Calendar API direct (uses `startDateTime` not `startDate` per memory)
- Repoint Retell + ElevenLabs agent tool URLs

### Phase 3 — `kb-ingest` edge fn

Replace n8n KB workflow. POST `{ clientId, content, source_url?, title? }` → write to `bfd-setter-live.documents`.

### Phase 4 — Engagement engine completion

- **4a** STOP / opt-out (`lead_optouts` table; receive-twilio-sms detects + replies + cancels active cadences)
- **4b** Quiet hours (`clients.cadence_quiet_hours` jsonb; runEngagement defers outside window; per-lead TZ from phone prefix)
- **4c** Reply-detected cadence-end (mid-cadence inbound → kill cadence, AI takes over)
- **4d** Voicemail drops (Twilio + TwiML `<Play>`, faster than Retell, set on attempt 3+)

### Phase 5 — `intake-lead` public endpoint

POST endpoint with per-client shared secret. Creates lead, finds-or-creates GHL contact, optionally enrols in cadence. Embeddable JS snippet for client websites.

### Phase 6 — Bidirectional GHL sync

Wire the `last_synced_from` custom field. Brendan creates the field in GHL, pastes id into `push-contact-to-ghl/index.ts:33`. sync-ghl-contact reads + skips when value is `1prompt-os` within 60s.

### Phase 7 — Tracking funnel

- **7a** Schema: `sms_delivery_events`, `cadence_metrics`, extend `bookings`
- **7b** Twilio status callback wiring (`twilio-status-webhook` edge fn + StatusCallback param on every Messages.create)
- **7c** GHL appointment webhook (`bookings-webhook` edge fn — booked → end cadence)
- **7d** Materialised view `cadence_funnel` + sample queries
- **7e** `cadence_metrics` population in runEngagement.ts

### Phase 8 — Webhook signature verification

- **8a** receive-dm-webhook (GHL `x-wh-signature`)
- **8b** retell-call-analysis-webhook (Retell `x-retell-signature`, per-agent secret)
- **8c** unipile-webhook (Unipile `x-unipile-signature`)
- All use the public-URL reconstruction pattern from `receive-twilio-sms/index.ts:316-336`

### Phase 9 — Cutover

Side-by-side test of 5 historical messages (native vs n8n). Brendan reviews diff, flips flag for BFD. 48h monitor.

### Phase 10 — Decommission

After 2 weeks soak: remove n8n callsites in processMessages, decommission n8n service on Railway.

## Out of scope (see `FUTURE.md`)

- Appointment reminder GHL campaign (separate workstream)
- A/B testing of cadence variants
- Native calendar replacement
- Multi-account Twilio failover
- LinkedIn DM inbound via Unipile
- Workflow-inbound-webhook leads-upsert

## Architecture invariants

- bfd-platform = `bjgrgbgykvjrsuwwruoh`; bfd-setter-live = `qildpilxjodxdifggmto`
- Frontend on Railway, n8n on Railway (separate service), Edge fns on Supabase, Trigger.dev on Trigger.dev cloud
- All Supabase keys are `sb_secret_*` / `sb_publishable_*`; legacy JWTs disabled since 2026-04-29T04:09:21Z
- Phone `+61481614530` pinned to `agent_5ec5eb` at inbound_agent_version 6
- BFD-setter uses persistent Retell agents
- UNIQUE on `leads(client_id, lead_id)`; UNIQUE on `message_queue(twilio_message_sid) WHERE NOT NULL`
- RLS on with agency-scoped policies (migration `20260426100000`)
- Inside Supabase Deno edge functions, `req.url` is the INTERNAL URL — reconstruct from `SUPABASE_URL` for HMAC verification

## Reusable patterns (don't reinvent)

- Public-URL reconstruction for HMAC: `receive-twilio-sms/index.ts:316-336`
- JWT-vs-clientId ownership check: `retell-proxy/index.ts:39-87`
- Leads upsert canonical shape: `receive-twilio-sms/index.ts:482-494`
- Dual-write to client mirror: `processMessages.ts:111-122` and `process-lead-file/index.ts:824-849`
- Trigger.dev task template: `trigger/sendFollowup.ts`
- GHL contact create with duplicate handling: `receive-twilio-sms/index.ts:222-255`
- Supabase Management API SQL: `reference_supabase_management_api` memory
- isWithinBusinessHours: `bulk-insert-leads/index.ts:30-61` (extract to `_shared/`)
- Reference upstream when uncertain: `https://github.com/genokadzin/1prompt-os`
