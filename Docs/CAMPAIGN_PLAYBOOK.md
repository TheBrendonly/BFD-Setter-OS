---
description: How to compose the existing 1prompt-OS engagement engine (Workflows tab + DB Reactivation page + voice-call-in-cadence step) into the three workflows BFD actually wants to run — new-lead, reactivation, and archived-list. Practical recipes, node JSON, and the gap list for what's still missing.
---

# Campaign Playbook — using what's shipped today

**Last updated:** 2026-05-01

The engagement engine has been quietly building up over Phases 4, 7, 11. This doc is a practitioner's reference: which existing UI does which job, the node-array recipe for each playbook, and what's still missing.

There are three patterns Brendan has named:

1. **New-lead playbook** — auto-enrolled the moment a lead enters the system. SMS, then wait, then SMS, then wait, then voice call, then wait, then SMS, then handoff to human.
2. **Reactivation cycle** — one-shot run over leads that already exist in the platform but have gone cold. Same step types, but enrolled in batches via the DB Reactivation page rather than via auto-enrol.
3. **Archived-list one-shot** — a CSV of leads from outside the platform (an old spreadsheet, an exported GHL list) is uploaded and run through a campaign. Same engine as #2.

All three use the same underlying components:
- `engagement_workflows.nodes` jsonb array (the cadence definition)
- `runEngagement` Trigger.dev task (the executor — handles delay nodes, engage nodes, voice-call branches, voicemail, quiet hours, opt-out detection, booking detection, cadence-end metrics, GHL tag removal)
- `placeOutboundCall` Trigger.dev task (the voice-call sub-task, called by `runEngagement` when an engage step has a `phone_call` channel)

---

## A. The building blocks (existing, shipped)

### Node types in `engagement_workflows.nodes`

A workflow is a linear array of node objects. Each node has a `type` and a few type-specific fields. Keys live in [`frontend/src/pages/Engagement.tsx:48-81`](../frontend/src/pages/Engagement.tsx#L48-L81). The supported types today:

| `type` | Purpose | Required fields |
|---|---|---|
| `delay` | Wait N seconds before next node | `delay_seconds` |
| `engage` | Multi-channel send (SMS, WhatsApp, voice). Mix and match channels in one node — they fire in parallel. | `channels: EngageChannel[]` (each channel is `{type: 'sms'|'whatsapp'|'phone_call', enabled, message?, instructions?, voice_setter_id?, treat_pickup_as_reply?}`) |
| `wait_for_reply` | Pause execution until inbound SMS arrives, OR until `timeout_seconds` elapses (whichever first) | `timeout_seconds` |

The runtime enforces quiet hours (per-lead timezone resolution from phone prefix; `clients.cadence_quiet_hours` default; per-workflow override via `engagement_workflows.quiet_hours_override`). It also short-circuits the cadence on three terminal events (idempotently): `inbound_reply`, `booking_created`, `opt_out`.

### Where each node-type runs

- **delay** → `runEngagement.ts:queueScheduledTask` (Trigger.dev waits)
- **engage with `sms` channel** → direct Twilio send via `sendTwilioSmsAndStamp` (no n8n hop since Phase 11f, including `StatusCallback` + `message_queue` stamp for the funnel)
- **engage with `phone_call` channel** → `placeOutboundCall.triggerAndWait` → `make-retell-outbound-call` edge function → Retell `/v2/create-phone-call`
- **engage with `whatsapp` channel** → unchanged from Phase 4 (Twilio WhatsApp Business API)
- **wait_for_reply** → blocks the run; `receive-twilio-sms` resolves the wait when an inbound arrives matching the lead

### Where each playbook starts

| Playbook | Enrolment trigger |
|---|---|
| New-lead | (a) `clients.auto_engagement_workflow_id` set + lead created via `intake-lead` or `sync-ghl-contact`, OR (b) GHL ContactTagAdded webhook → `ghl-tag-webhook` matches a workflow with `is_new_leads_campaign=true AND new_leads_tag=<added_tag>` |
| Reactivation | DB Reactivation page UI → bulk insert into `campaigns` table → batched enrolment per `ScheduleData` |
| Archived-list | Same as reactivation but the lead source is a CSV upload |

---

## B. Playbook 1 — New-lead cadence

**Goal:** when a fresh lead lands (web form, GHL tag, manual import), introduce the AI setter, give them time to reply, escalate to a voice call after 24h of silence, then a final nudge.

**Recipe (`engagement_workflows.nodes` jsonb):**
```json
[
  { "type": "delay", "delay_seconds": 60 },
  {
    "type": "engage",
    "channels": [{
      "type": "sms",
      "enabled": true,
      "message": "Hey {{first_name}} — saw you came through the form. Is now a good time to chat about what you're looking for?"
    }]
  },
  { "type": "wait_for_reply", "timeout_seconds": 14400 },
  {
    "type": "engage",
    "channels": [{
      "type": "sms",
      "enabled": true,
      "message": "No worries if you've been busy {{first_name}} — quick yes/no, are you still interested in <offer>? Happy to find a time that suits."
    }]
  },
  { "type": "wait_for_reply", "timeout_seconds": 86400 },
  {
    "type": "engage",
    "channels": [{
      "type": "phone_call",
      "enabled": true,
      "voice_setter_id": "voice-1",
      "instructions": "Cold-warm follow-up. Lead came in via web form 36h ago and hasn't replied. Goal: confirm interest and book if appropriate.",
      "treat_pickup_as_reply": true
    }]
  },
  { "type": "delay", "delay_seconds": 14400 },
  {
    "type": "engage",
    "channels": [{
      "type": "sms",
      "enabled": true,
      "message": "Hi {{first_name}}, last one from me — if it's not the right time just let me know and I'll close this out. Otherwise reply with a good time and I'll lock something in."
    }]
  }
]
```

**Cadence-end behaviour:**
- Lead replies at any wait_for_reply → `stop_reason=inbound_reply`, cadence ends, setter takes over via `processMessages.ts`/`processSetterReply.ts`
- Voice call ends with a booking → `stop_reason=booking_created`, GHL appointment written
- Lead sends STOP → `stop_reason=opt_out`, `lead_optouts` row written, no further messages
- Final node executes without reply → `stop_reason=sequence_complete`, `new_leads_tag` removed if present (so a future tag-add can re-enrol)

**Quiet hours:** every `delay` and outbound `engage` step is wrapped by the quiet-hours guard. Default 09:00–19:00 local to the lead's phone prefix (resolved per call), overridable on the workflow card.

**Auto-enrol:** `UPDATE clients SET auto_engagement_workflow_id = '<workflow_id>'` for `intake-lead` to enrol every fresh lead, OR set the workflow's `is_new_leads_campaign=true` + `new_leads_tag='new-lead'` and have a GHL workflow add the `new-lead` tag on contact create.

---

## C. Playbook 2 — Reactivation cycle (existing leads gone cold)

**Goal:** take leads in the platform that haven't been contacted in 60+ days, run them through a SMS → wait → voice → wait → SMS sequence, batched at 50/day on weekdays so we don't spam Twilio or the lead.

### How to source the list

Two paths to feed leads into a reactivation campaign:

1. **Pick from `leads` table directly** via the DB Reactivation UI ([`frontend/src/pages/CampaignCreate.tsx:48-87`](../frontend/src/pages/CampaignCreate.tsx#L48-L87)). UI provides a search + multi-select.
2. **Run a SQL filter against the platform DB**, export, and upload as CSV:
   ```sql
   -- Cold-lead candidates: 60+ days since last message, not booked, not opted out
   SELECT lead_id AS lead_id, first_name, last_name, phone, email
   FROM leads
   WHERE client_id = '<client_uuid>'
     AND last_message_at < now() - interval '60 days'
     AND lead_id NOT IN (SELECT lead_id FROM lead_optouts WHERE client_id = '<client_uuid>')
     AND NOT EXISTS (
       SELECT 1 FROM bookings
       WHERE lead_id = leads.lead_id
       AND status = 'confirmed'
       AND appointment_time > now() - interval '60 days'
     )
   ORDER BY last_message_at DESC NULLS LAST
   LIMIT 1000;
   ```
   Save as CSV with columns `lead_id, first_name, last_name, phone, email`. Upload through the CampaignCreate page.

### Recipe (same shape, slightly different copy)

```json
[
  {
    "type": "engage",
    "channels": [{
      "type": "sms",
      "enabled": true,
      "message": "Hi {{first_name}}, it's been a while — quick check-in: are you still looking at <offer>? No pressure either way, just thought I'd see if anything's changed."
    }]
  },
  { "type": "wait_for_reply", "timeout_seconds": 86400 },
  {
    "type": "engage",
    "channels": [{
      "type": "phone_call",
      "enabled": true,
      "voice_setter_id": "voice-2",
      "instructions": "Reactivation call. Lead has been cold 60+ days. Goal: re-qualify and either book or close politely.",
      "treat_pickup_as_reply": true
    }]
  },
  { "type": "delay", "delay_seconds": 21600 },
  {
    "type": "engage",
    "channels": [{
      "type": "sms",
      "enabled": true,
      "message": "Hey {{first_name}} — tried to give you a call earlier. If now's a better time, just reply YES and I'll dial back. Otherwise I'll leave you to it."
    }]
  }
]
```

### Batch scheduling (already in CampaignCreate.tsx)

The DB Reactivation page exposes:
- `daysOfWeek` (default Mon-Fri)
- `startTime` / `endTime` (default 09:00 / 19:00)
- `timezone` (default the agency's timezone)
- `batchSize` (recommended 50 leads/day for reactivation)
- `batchIntervalMinutes` (recommended 60 — one batch per hour)
- `leadDelaySeconds` (recommended 30s between leads in a batch)

These are already wired up in the UI. They write to the `campaigns` table; the executor processes one batch at a time and respects the schedule.

---

## D. Playbook 3 — Archived-list one-shot

Same as playbook 2 but the lead source is a CSV from outside the platform (a 2-year-old spreadsheet, an exported GHL list, leads from another CRM). Use the CampaignCreate page → "Upload CSV" → run.

**Suggested copy:** lead with explicit memory acknowledgement:
> "Hey {{first_name}} — you reached out a while back about <offer>. Apologies if the timing is off, but figured it was worth one check-in. Are you still in the market?"

**Recommended schedule:** smaller batches than reactivation (25/day), 2-week cooling-off if no reply. CSV-sourced leads are colder and more likely to opt-out, so respect that with smaller batches.

**Compliance note:** if the source list is more than 12 months old, recommend the agency owner re-confirms consent before adding the lead to a cadence. The platform doesn't enforce this — it's an agency policy decision.

---

## E. Gaps that would unblock the next-level cadence work

Items in this section are NOT shipped today. Each maps to a `User Todos.md` line so Brendan can pull-forward when ready.

### Gap E1 — `ghl-tag-webhook` handler (unblocks playbook 1 enrolment via tags)

- Status: schema columns + UI toggle exist (Phase 11a, 11c). The actual webhook endpoint that receives GHL `ContactTagUpdate` and enrolls a lead based on the tag has shipped (Phase 11e — `frontend/supabase/functions/ghl-tag-webhook/index.ts`). It's installed and signature-verified.
- **What's still missing:** Brendan needs to (a) add the GHL webhook in his GHL marketplace settings pointing at `/ghl-tag-webhook`, (b) populate `clients.ghl_webhook_secret` so signature verification passes, (c) confirm the workflow has `is_new_leads_campaign=true` and the right `new_leads_tag`. This is config work, not code.
- Maps to: `User Todos.md` B5.

### Gap E2 — Quiet hours editor UI (already partially built)

- Status: schema column `engagement_workflows.quiet_hours_override` exists. UI for editing it lives in the Cadence Settings top bar of the Engagement editor (Phase 11b, see [`frontend/src/pages/Engagement.tsx`](../frontend/src/pages/Engagement.tsx)).
- **What's still missing:** the per-workflow override is shipped; the per-client default editor (`clients.cadence_quiet_hours` jsonb) is not yet exposed in the UI — Brendan currently sets it via SQL.
- Maps to: `User Todos.md` B1.

### Gap E3 — Voicemail config UI (Cadence Settings bar)

- Status: shipped in Phase 11b — radio in the Cadence Settings bar between Static text and Dynamic (LLM-generated per call). Persists to `engagement_workflows.voicemail_config`. `make-retell-outbound-call` reads it on each call (`ensureVoicemailConfig` in Phase 11d).
- **What's still missing:** nothing on the platform side. Worth a smoke test on BFD: run a cadence outbound call against a phone that goes to voicemail, confirm Retell drops the configured voicemail.
- Maps to: `User Todos.md` B6.

### Gap E4 — Visual cadence-funnel dashboard (cosmetic, deferred)

- Status: `cadence_funnel` materialized view + `refresh_cadence_funnel()` hourly task shipped in Phase 7d + Phase 11a (D-M3). SQL works.
- **What's missing:** no frontend chart yet. Brendan can run the SQL queries from `Docs/TRACKING.md` to see the funnel; an actual page is `User Todos.md` D4 ("Cost-per-booking analytics dashboard") and is gated on having 60 days of data.

### Gap E5 — Pause / resume on a running cadence (operational ergonomics)

- Status: not shipped. `engagement_executions.status` supports `pending|running|waiting|completed|cancelled` but there's no `paused` state.
- **What's missing:** UI button on a campaign card + state-machine logic in `runEngagement.ts` to honour pause. Useful when an agency owner wants to pause a campaign for a holiday week without losing the place.
- Maps to: not in `User Todos.md` yet — surface as a Phase B candidate.

### Gap E6 — A/B testing on cadence copy (deferred, Phase D-tier)

- Status: not shipped. Each workflow currently has one copy string per node. No way to fork a workflow into two arms and split traffic.
- **What's missing:** schema + UI + executor changes to assign a lead to an arm and stamp `engagement_executions.ab_arm`.
- Worth doing once Brendan has 100+ leads/day per cadence so the data is meaningful.

---

## F. Quick-reference matrix

| Playbook | Enrol via | Steps | Schedule control | Best-fit copy tone |
|---|---|---|---|---|
| New-lead | `auto_engagement_workflow_id` OR GHL tag webhook | 5-8 nodes (SMS+wait+SMS+wait+voice+wait+SMS) | Immediate, quiet-hours guarded | Warm, first-touch < 160 chars, friendly |
| Reactivation | DB Reactivation page (existing leads filter) | 4-5 nodes (SMS+wait+voice+wait+SMS) | Batched 50/day weekday 9-19 local | Acknowledge time gap, low-pressure |
| Archived list | DB Reactivation page (CSV upload) | Same as reactivation but smaller batches | Batched 25/day weekday 9-19 local | Explicit "you reached out a while back" |

---

## G. What to read next

- `User Todos.md` Phase B — the queued list of cadence improvements
- `Docs/CADENCE_DESIGN.md` — the design philosophy and Phase 4a-4d details
- `Docs/TRACKING.md` — funnel SQL + how to query `cadence_funnel`
- `Docs/RUNBOOK.md` — incident playbooks for `runEngagement` failures and quiet-hours misconfigurations
