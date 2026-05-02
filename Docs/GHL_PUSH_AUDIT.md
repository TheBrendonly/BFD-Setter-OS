---
description: Inventory of every event the 1prompt-OS platform pushes to GoHighLevel today, what is NOT pushed (gap list), and recommended fixes ranked by leverage. Reference doc — keep current as new push paths land.
---

# GHL Push Audit — what 1prompt mirrors back to GoHighLevel

**Last updated:** 2026-05-02 (gaps 1, 2+3 closed — voice call summary + SMS bodies now mirrored)

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

### 7. SMS body mirror — both directions (Phase B, gaps 2+3, 2026-05-02)

- **Triggers:** every inbound Twilio SMS at `receive-twilio-sms`, every direct-Twilio outbound from `processMessages.ts` setter-reply block (native engine only), every direct-Twilio outbound from `runEngagement.ts` cadence engine, and STOP/START auto-replies.
- **Endpoints:** `POST /conversations/messages/inbound` or `/outbound` when `clients.ghl_conversation_provider_id` is set (Custom Conversation Provider provisioned in GHL Marketplace); `POST /contacts/{id}/notes` fallback otherwise.
- **Payload:** `{ type: "SMS", contactId, message, conversationProviderId, direction, altId, date }` for Conversations; `{ body: "[platform → SMS <direction>] <message>" }` for Notes.
- **Where:** helper at [`frontend/supabase/functions/_shared/ghl-conversations.ts`](../frontend/supabase/functions/_shared/ghl-conversations.ts) (Deno) + [`trigger/_shared/ghl-conversations.ts`](../trigger/_shared/ghl-conversations.ts) (Node copy). Wired into `receive-twilio-sms`, `processMessages.ts`, `runEngagement.ts`.
- **Idempotency:** `altId = twilio_message_sid` so Conversations endpoint dedupes on retry. Notes fallback is not deduped — call sites only fire once per outbound.

### 8. Voice call summary + sentiment + appointment_booked → GHL Note + custom fields (Phase night, gap 1, 2026-05-02)

- **Trigger:** `retell-call-analysis-webhook` receives a `call_analyzed` event AND the call's `contact_id` Retell dynamic variable is set.
- **Endpoints:** `POST /contacts/{contactId}/notes` (always when ghl_api_key is present); `PUT /contacts/{contactId}` with `customFields` array for `last_call_sentiment` + `last_call_appointment_booked` (when the per-client field ids are configured).
- **Payload (note):** `{ body: "[Voice Call Summary]\nDuration: Xs\nSentiment: <sentiment>\nAppointment booked: Yes|No\n\n<call_summary>" }`.
- **Payload (custom fields):** `{ customFields: [{ id: "<field_id>", field_value: "<value>" }] }`.
- **Where:** [`frontend/supabase/functions/retell-call-analysis-webhook/index.ts`](../frontend/supabase/functions/retell-call-analysis-webhook/index.ts) — GHL gap 1 block inserted after the call_history upsert (Step 3). Schema: `clients.ghl_call_sentiment_field_id` + `clients.ghl_call_appt_booked_field_id` added in migration `20260502130000_phase_night_ghl_call_fields.sql`.
- **Onboarding:** see `CLIENT_ONBOARDING_SOP.md §5.12`.

---

## B. NOT pushed to GHL today (gap list, in priority order)

### Gap 1 — Voice call transcripts + summaries (HIGH leverage) — **CLOSED 2026-05-02**

- **Resolution:** `phase-night-ghl-push-gap-1` — after `call_history` upsert, `retell-call-analysis-webhook` now writes a GHL Note (`POST /contacts/{id}/notes`) with the call summary, duration, sentiment, and appointment_booked flag. Also PATCHes two custom fields (`last_call_sentiment`, `last_call_appointment_booked`) when the client has `ghl_call_sentiment_field_id` / `ghl_call_appt_booked_field_id` set. Best-effort: never throws, failures only log `console.warn`.
- **Where:** [`frontend/supabase/functions/retell-call-analysis-webhook/index.ts`](../frontend/supabase/functions/retell-call-analysis-webhook/index.ts) — GHL gap 1 block after the call_history upsert (Step 3). Schema: `clients.ghl_call_sentiment_field_id` + `clients.ghl_call_appt_booked_field_id` (nullable text columns added in `20260502130000_phase_night_ghl_call_fields.sql`).
- **Gating:** fires only when the call's `contact_id` Retell dynamic variable is set and the client has `ghl_api_key` populated. The Note is always written; custom field PATCH is silently skipped if field ids are null.
- **Onboarding:** see `CLIENT_ONBOARDING_SOP.md §5.12` for the two GHL field creation + SQL steps.

### Gap 2 — Inbound SMS message bodies (HIGH leverage) — **CLOSED 2026-05-02**

- **Resolution:** `phase-night-ghl-push-gaps-2-3` — `receive-twilio-sms/index.ts` now schedules `pushSmsToGhl(direction='inbound', altId=messageSid)` via `EdgeRuntime.waitUntil` after the GHL contact resolves. STOP/START keyword inbound is also mirrored (when matched-lead is resolvable). Helper at [`frontend/supabase/functions/_shared/ghl-conversations.ts`](../frontend/supabase/functions/_shared/ghl-conversations.ts).
- **Path:** Conversations API when `clients.ghl_conversation_provider_id` is set; Notes API fallback otherwise.

### Gap 3 — Outbound setter SMS replies (HIGH — regression of pre-Phase 9) — **CLOSED 2026-05-02**

- **Resolution:** `phase-night-ghl-push-gaps-2-3` — three outbound paths now mirror to GHL after the Twilio send succeeds: (a) `trigger/processMessages.ts` setter-reply Twilio block (gated on `client.use_native_text_engine === true` to avoid double-mirror via the legacy n8n workflow path); (b) `trigger/runEngagement.ts` `sendTwilioSmsAndStamp` (engage-node + legacy `send_sms` node, always — Phase-11f direct Twilio); (c) `receive-twilio-sms` STOP/START auto-reply.
- **Path:** Same helper as gap 2. `altId = twilio_message_sid` for Conversations-API dedupe.

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

1. ~~Voice call summary as a GHL Note + 2 custom fields~~. **CLOSED 2026-05-02 — `phase-night-ghl-push-gap-1`.**
2. ~~Inbound~~ + ~~outbound SMS bodies as GHL Conversation messages~~. **CLOSED 2026-05-02 — `phase-night-ghl-push-gaps-2-3`.**
3. Opt-out → GHL `dndSettings.SMS=true` (~30 min work, single edge function diff). **Open.**

Remaining sequencing: gap 5 (opt-out compliance PATCH), then defer gaps 4/6/7 until the second agency client lands.

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
| `_shared/ghl-conversations.ts` (Deno + Node copies) | `POST /conversations/messages/{inbound\|outbound}` (when provider id set) OR `POST /contacts/{id}/notes` (fallback) | Every inbound Twilio SMS + every direct-Twilio outbound (setter reply on native engine, cadence engine, STOP/START auto-reply) |

Anything not in that table is either NOT pushed (see section B) or is a GHL→platform read (`sync-ghl-contact`, `sync-ghl-booking`, `ghl-tag-webhook`).
