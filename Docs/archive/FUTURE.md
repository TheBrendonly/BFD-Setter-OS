> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---
# Future Work / Out of Scope

Tracked here so they don't get lost. Each entry: what, why-deferred, rough-effort.

---

## Appointment Reminder GHL Campaign (separate workstream)

**What:** Once a lead books an appointment via BFD-setter (voice tool or GHL native), they should receive reminder messages before the appointment:
- 24h before: "Reminder — your call with [client] is tomorrow at [time]"
- 1h before: "About to call you in 1h"
- At appointment time: "Calling you now" (or auto-trigger Retell call)
- After no-show: "Sorry we missed you — book a new time here: [link]"

**Why deferred:** Brendan said this lives in GHL natively, not BFD-setter code. GHL has an "Event Triggers" workflow type that fires on Calendar Appointment Created → wait until N hours before → SMS. No BFD-setter code needed if we use GHL's native scheduling.

**Effort:** half-day for Brendan in GHL UI. No BFD-setter dev work.

**Touch points (so BFD-setter doesn't conflict):**
- bookings-webhook (Phase 7c) ends the active engagement_executions cadence on appointment-create — leaves the GHL reminder workflow free to run
- BFD-setter native cadences MUST NOT include reminder nodes; that's GHL's territory

---

## A/B Testing of Cadence Variants

**What:** Allow 2-N variants of an `engagement_workflow` to be split-tested. `engagement_executions.variant` column. Materialized view splits funnel by variant. Pick winner.

**Why deferred:** MVP feature. Need volume (N>~50 per variant per week) before A/B is meaningful. BFD won't have that volume until they're booking ~10/week.

**Effort:** ~3 days. Small schema change + workflow_variants table + UI for setting weights + reporting query.

---

## Native Calendar (drop GHL Calendar)

**What:** Build BFD-setter native calendar — own the slot/availability/booking UX. Replace GHL Calendar API calls with internal calendar.

**Why deferred:** GHL Calendar works fine. 2-4 weeks for a v1 with own UI. Only worth it when GHL feature gaps actively hurt — clients won't notice the boundary today.

**Effort:** 2-4 weeks. Big lift.

**Trigger to revisit:** when a client says "GHL booking UX is bad and we need X feature". Until then, GHL is fine.

---

## Multi-account Twilio Failover

**What:** When primary Twilio account hits a rate limit / has delivery issues, automatically fall over to a secondary account.

**Why deferred:** BFD has one Twilio account, no rate-limit issues today. Premature.

**Effort:** ~2 days. New `clients.twilio_accounts jsonb[]` array, randomised picker, error-rate tracker.

---

## LinkedIn DM Inbound via Unipile

**What:** Today `unipile-webhook` only handles OAuth completion (CREATION_SUCCESS). Building LinkedIn DM inbound flow = fetching messages from Unipile API or having Unipile push them to a new webhook.

**Why deferred:** Currently leads come via FB/IG/WA (handled by GHL native). LinkedIn outreach isn't BFD's primary channel.

**Effort:** ~3 days. Subscribe to Unipile message events, build inbound handler, mirror sync-ghl-contact pattern for contact resolution.

---

## Workflow-Inbound-Webhook Leads-Upsert

**What:** Currently `workflow-inbound-webhook` is a generic gateway with no contact context — leads-upsert pattern doesn't fit.

**Why deferred:** Edge case. The downstream Trigger.dev `execute-workflow` task knows about the lead/contact and can write to leads itself if a workflow node calls for it.

**Effort:** ~half day. Decide convention for which workflow node-types should auto-upsert leads.

---

## Cost-per-Booking Analytics

**What:** Track Twilio + Retell + OpenRouter spend per booked appointment. Per-client + per-cadence. Identify high-cost low-conversion cadences.

**Why deferred:** Requires polling each provider's billing API + correlating to specific cadence executions. ~1 week.

**Effort:** ~1 week.

---

## Per-Lead Timezone via External API

**What:** Replace the static phone-prefix → TZ map (Phase 4b) with a real TZ lookup (TimeZoneDB API or Google Maps API).

**Why deferred:** Phone prefix gets us 80% there cheaply. External API adds latency + cost. Revisit if we onboard clients with multi-state US ops where Eastern-default is wrong.

**Effort:** ~half day.

---

## Deliverability Optimisation

**What:** Twilio Messaging Service with multi-DID rotation, verified Sender ID for AU, branded sender for US (10DLC/A2P registration).

**Why deferred:** Volume-dependent. Below ~500 messages/day per number, single-DID is fine.

**Effort:** A2P 10DLC registration is multi-week (carrier approval). AU Sender ID is faster. Revisit when BFD scales.
