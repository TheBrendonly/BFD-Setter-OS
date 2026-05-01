---
description: Inventory of every event the 1prompt-OS platform pushes to GoHighLevel today, what is NOT pushed (gap list), and recommended fixes ranked by leverage. Reference doc — keep current as new push paths land.
---

# GHL Push Audit — what 1prompt mirrors back to GoHighLevel

**Last updated:** 2026-05-01 (post Phase 9 cutover, BFD on native text engine day 2 of 14)

GHL is the source-of-truth CRM for every BFD-platform tenant. Every event that 1prompt knows about should ideally be visible in GHL too — call summaries on the contact timeline, opt-outs flipping `dndSettings.SMS=true`, cadence steps showing up as Activities. Today some flows mirror cleanly, some only stamp a tag, and some stop entirely at the platform DB.

This doc is the canonical "what's mirrored" inventory. It feeds three downstream things:
1. Client onboarding SOP §4.X (so a new client knows which fields they need to provision in GHL)
2. The CSAT story for Brendan when an agency owner asks "why isn't my GHL timeline complete?"
3. The backlog for which gaps to close next (each gap below is a candidate Phase B/C item)

---

## A. Pushed to GHL today (canonical 6 paths)

### 1. Contact edits from the 1prompt UI → GHL contact PUT

- **Trigger:** User edits a contact in the dashboard.
- **Endpoint:** `PUT /contacts/{contactId}` (Contacts API, `services.leadconnectorhq.com`).
- **Payload:** `firstName`, `lastName`, `email`, `phone`, `companyName`, `tags[]`, `customFields[]` including `last_synced_from = "1prompt-os"` (per-client field id at `clients.ghl_last_synced_from_field_id`, fallback to BFD legacy constant).
- **Where:** [`frontend/supabase/functions/push-contact-to-ghl/index.ts:123-175`](../frontend/supabase/functions/push-contact-to-ghl/index.ts#L123-L175).
- **Echo-loop guard:** writes the `last_synced_from` custom field + bumps `leads.updated_at` so the inbound `sync-ghl-contact` webhook can recognise its own outbound edit and skip re-applying it.

### 2. Lead intake (web widget / simulator / Calendly / Typeform / API) → GHL contact create

- **Trigger:** Public POST to `/intake-lead` from a non-GHL source (web form, embedded widget, public API caller).
- **Endpoint:** `POST /contacts` if no existing match; `PATCH /contacts/{id}/tags` if a duplicate is detected.
- **Payload:** `phone`, `email`, `firstName`, `lastName`, `tags[]` (e.g. `source=web-widget`).
- **Where:** [`frontend/supabase/functions/intake-lead/index.ts:69-134`](../frontend/supabase/functions/intake-lead/index.ts#L69-L134).
- **Side effects:** dual-writes to per-client external Supabase `leads` table; auto-enrols in cadence if `clients.auto_engagement_workflow_id` is set.

### 3. Inbound SMS channel attribution → GHL contact PATCH

- **Trigger:** Twilio inbound SMS webhook arrives at `/receive-twilio-sms`.
- **Endpoint:** `PATCH /contacts/{contactId}` (only the `customFields` array — single field).
- **Payload:** `customFields = [{id: "p0vCIz497xZLk5fUSF0X", value: "SMS"}]` (BFD's hardcoded `channel` field id at `receive-twilio-sms/index.ts:254-288`).
- **Where:** [`frontend/supabase/functions/receive-twilio-sms/index.ts:254-288`](../frontend/supabase/functions/receive-twilio-sms/index.ts#L254-L288).
- **Caveat:** the inbound SMS BODY is NOT pushed (see gap A below). Only the channel attribution.

### 4. Voice-booking tool calls → GHL appointment + contact upsert

- **Trigger:** Retell voice agent calls one of the 5 booking tools during a live call.
- **Endpoints:** `POST /calendars/events/appointments`, `PUT /calendars/events/appointments/{id}`, GHL contact create-if-missing (phone-first lookup).
- **Payload:** `calendarId`, `locationId`, `contactId`, `startTime`, `endTime`, `title`, `appointmentStatus`, etc.
- **Where:** [`frontend/supabase/functions/voice-booking-tools/index.ts:322-430`](../frontend/supabase/functions/voice-booking-tools/index.ts#L322-L430).
- **Side effect:** writes a `bookings` row, ends the active cadence with `stop_reason=booking_created`, logs a `contact_merge_candidates` row if a new contact had to be created.

### 5. Bidirectional sync (GHL → platform): `sync-ghl-contact`, `sync-ghl-booking`

These are GHL → platform writes (the inverse direction), included here because they share the echo-loop guard with path #1.

- **Triggers:** GHL Webhook v2 ContactCreate / ContactUpdate / ContactDelete; AppointmentCreate / Update / Cancel.
- **Where:** [`frontend/supabase/functions/sync-ghl-contact/index.ts:270-305`](../frontend/supabase/functions/sync-ghl-contact/index.ts#L270-L305) (echo guard), [`frontend/supabase/functions/sync-ghl-booking/index.ts:645-679`](../frontend/supabase/functions/sync-ghl-booking/index.ts#L645-L679) (booking insertion).

### 6. Engagement cadence enrolment via tag (Phase 11e)

- **Trigger:** GHL `ContactTagUpdate` webhook hits `/ghl-tag-webhook`.
- **Endpoint side:** No outbound write to GHL on enrolment (the platform reads, then runs the cadence). At cadence END (Phase 11d `removeNewLeadsTag`), if the workflow's `new_leads_tag` is set, that tag is removed from the GHL contact via `DELETE /contacts/{id}/tags` (so the contact doesn't auto-re-enrol on the next webhook).
- **Where:** [`trigger/runEngagement.ts:193-219`](../trigger/runEngagement.ts#L193-L219).

---

## B. NOT pushed to GHL today (gap list, in priority order)

### Gap 1 — Voice call transcripts + summaries (HIGH leverage)

- **What we have:** Full call transcript, Retell-generated call summary, sentiment, `appointment_booked` flag, recording URL, duration, cost.
- **Where it stops:** `call_history` table only.
- **Source:** [`frontend/supabase/functions/retell-call-analysis-webhook/index.ts:379-416`](../frontend/supabase/functions/retell-call-analysis-webhook/index.ts#L379-L416).
- **GHL impact:** the agency owner sees nothing on the GHL contact timeline about what was said in the call, what the lead's sentiment was, or what came out of it. Anyone reading the contact in GHL is blind.
- **Suggested fix:** after the analysis webhook stores the call_summary, write the summary (or full transcript, or both) to the GHL contact as a Note (`POST /contacts/{id}/notes`) and set 2-3 custom fields (`last_call_sentiment`, `last_call_appointment_booked`, `last_call_summary`).

### Gap 2 — Inbound SMS message bodies (HIGH leverage)

- **What we have:** Full text, timestamp, Twilio metadata, sender phone.
- **Where it stops:** `message_queue` + `dm_executions` tables; the body lands in `leads.last_message_preview` for UI but never goes back to GHL.
- **Source:** `receive-twilio-sms/index.ts` full flow.
- **GHL impact:** GHL has no record of the inbound SMS body. The agency can see "channel = SMS" on the contact (gap 3 mitigant) but can't read what the lead actually said. Outbound mirror (gap 6) is also absent in the native engine path, so the GHL conversation thread stays empty.
- **Suggested fix:** after the inbound is received, write to GHL via the Conversations API (`POST /conversations/messages` with `type=Inbound, channel=SMS, contactId=…, message=<body>`). If Conversations API isn't enabled on the location, fallback: write a Note.

### Gap 3 — Outbound setter SMS replies (HIGH — regression of pre-Phase 9)

- **What we have:** LLM-generated reply text, sent timestamp, delivery status (Twilio `MessageStatus` callback).
- **Where it stops:** Twilio outbound only. Pre-Phase 9 the reply went via n8n → optionally to GHL. With `use_native_text_engine=true` the n8n hop is bypassed entirely, so the GHL conversation thread no longer reflects the platform's outbound replies for BFD.
- **Source:** [`trigger/processMessages.ts:209+`](../trigger/processMessages.ts#L209).
- **Suggested fix:** same `POST /conversations/messages` pattern as gap 2 but with `type=Outbound`. Done in the same edge function so inbound + outbound stay together. This single fix closes gap 2 + gap 3.

### Gap 4 — Engagement cadence events (MEDIUM)

- **What we have:** every cadence step: SMS sent, voice call placed, voicemail dropped, wait-for-reply armed, branch taken, opt-out detected, booking detected.
- **Where it stops:** `engagement_executions`, `cadence_metrics`, `sms_delivery_events` tables.
- **GHL impact:** GHL timeline shows the contact got an SMS (via gap 3 fix) but doesn't know it came from a cadence — there's no "started cadence X / step 3 of 6 sent / cadence ended on booking" footprint.
- **Suggested fix:** lower-leverage than gaps 1–3. Likely defer until Brendan has multiple clients running multiple cadences and the agency owners ask for the timeline visibility. When ready: stamp a Note at cadence START and at cadence END (with stop_reason).

### Gap 5 — Opt-out (STOP keyword) → GHL `dndSettings.SMS = true` (MEDIUM, compliance-adjacent)

- **What we have:** `lead_optouts` row written when an inbound STOP keyword is detected; cadence cancels with `stop_reason=opt_out`.
- **Where it stops:** local `lead_optouts` table.
- **GHL impact:** if Brendan or the agency owner manually sends an SMS from inside GHL after a STOP, GHL will happily send it because `dndSettings.SMS` is still false. Compliance-adjacent risk.
- **Suggested fix:** after `lead_optouts` insert, `PATCH /contacts/{id}` with `dndSettings: { SMS: { status: "active", message: "Opted out via STOP keyword on <date>" } }`. STOP-only — no need to mirror START since GHL already supports opt-in via incoming START.
- **Source spot:** `receive-twilio-sms/index.ts` opt-out detection (~line 200-220).

### Gap 6 — Contact merge candidates (LOW — agency-internal workflow)

- **What we have:** `contact_merge_candidates` rows when voice-booking creates a new contact that might be a duplicate.
- **Where it stops:** local table only; no agency-owner UI yet.
- **Suggested fix:** out of scope for GHL push — this is more of "build the merge-candidate triage UI" than "push to GHL". GHL doesn't have a public merge endpoint anyway.

### Gap 7 — Campaign attribution (LOW)

- **What we have:** `campaign_events` rows with `(campaign_id, contact_id, event=appointment_booked, timestamp)`.
- **Suggested fix:** when an `appointment_booked` event is logged, also stamp `contact.campaign_source = <campaign_id>` (custom field) on the GHL contact. Useful when an agency runs multiple campaigns on the same contact set.

---

## C. What "full mirroring" would mean (recommendation summary)

Closing the top 3 gaps (1, 2, 3) gets every BFD agency-owner most of the way to "GHL is the source of truth and shows the full lead story":

1. Voice call summary as a GHL Note + 2 custom fields (~1 hr work, 1 edge function diff).
2. Inbound + outbound SMS bodies as GHL Conversation messages (~2 hr work, single edge function diff covers both directions).
3. Opt-out → GHL `dndSettings.SMS=true` (~30 min work, single edge function diff).

Gaps 4–7 are nice-to-haves and can wait until clients ask. Sequencing: do gaps 2+3 first (single PR), then gap 1, then gap 5 (compliance), then defer the rest until the second agency client lands.

**Out of scope for this audit:** none of these need new tables or new infrastructure. Every fix is a `PATCH /contacts/{id}` or `POST /conversations/messages` from an existing edge function. They're cheap.

---

## D. Quick reference — every place we currently write to GHL

| File | What it writes | When |
|---|---|---|
| `push-contact-to-ghl/index.ts` | `PUT /contacts/{id}` with full upsert payload + `last_synced_from` echo guard | User edits a contact in the dashboard |
| `intake-lead/index.ts` | `POST /contacts` or `PATCH /contacts/{id}/tags` | Public widget / simulator / API lead intake |
| `receive-twilio-sms/index.ts` | `PATCH /contacts/{id}` with channel custom field | Inbound SMS arrives |
| `voice-booking-tools/index.ts` | `POST/PUT /calendars/events/appointments`, `POST /contacts/` | Retell voice agent calls a booking tool |
| `runEngagement.ts` (tag-removal helper) | `DELETE /contacts/{id}/tags/{tag}` | Cadence reaches a terminal stop_reason and the workflow had `new_leads_tag` set |

Anything not in that table is either NOT pushed (see section B) or is a GHL→platform read (`sync-ghl-contact`, `sync-ghl-booking`, `ghl-tag-webhook`).
