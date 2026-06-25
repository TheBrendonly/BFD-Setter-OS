---
description: Click-by-click operator runbook (2026-06-24) for the Brendan-owned items behind the calls/{{first_name}} fix (Trigger concurrency raise, re-Save 5 setters, inbound greeting document-only, calls live-smoke) plus the GHL SMS-in-Conversations POC, each with the read-only server-side verification Claude runs after.
---

# BFD Setter Operator Runbook (2026-06-24)

Brendan-owned actions for the 2026-06-23 calls / `{{first_name}}` fix follow-through (already deployed:
`49a594e` on `main`, retell-inbound-webhook v6 + retell-proxy v43, Trigger `20260623.1`) plus the GHL
"SMS in Conversations" POC. For each item: what you click, then how Claude verifies read-only afterward.
No code changes. Hard rule: never edit voice prompts; re-Save/Push only.

Baseline measured this session (2026-06-24 ~01:00): Trigger prod dispatch latency is already HEALTHY
(queue->start 0.0-3.5 min over the last 25 runs); the 2026-06-23 ~20-45 min lateness has cleared.

---

## A. Trigger.dev latency: NO upgrade needed (root cause was a resolved platform incident)

Resolved diagnosis (2026-06-24): the 2026-06-23 ~20-45 min call latency was Trigger.dev's **"Region
Dequeue Performance Degradation"** incident (status.trigger.dev: Jun 22-23, 22h43m, US East 1 + EU
Central 1, resolved Jun 23 9:43pm UTC), NOT concurrency starvation. Evidence: the independent hourly
crons were equally late (platform-wide), only ~3 runs were in flight against the prod limit of 20, and a
fresh probe this session (after the incident resolved) is back to 0.0-3.5 min. A bigger plan would have
queued in the same degraded region, so upgrading would not have helped.

Decision (Brendan, 2026-06-24): STAY on the free plan. Prod concurrency 20 / Dev 25 is far above the ~3
peak at 0 clients.

Concurrency-need model (why 20 is plenty): on Trigger Cloud each task runs for seconds then completes or
checkpoints-and-releases its slot, so concurrency demand = peak simultaneous task EXECUTIONS, driven by
enrollment bursts not lead totals. Rule of thumb: concurrency ~= (leads needing first-touch in the same
minute) x ~4s / 60s, so 20 concurrency = ~300 first-touches/minute. 20 drains a ~500-lead burst in ~75s.
`placeOutboundCall` is separately capped at 20 on `retellOutboundQueue` (~300 call-placements/min). You
only outgrow 20 if you regularly enroll >~2000 leads in one instant, or many clients burst the same
minute. Watch-item: if a cron/task is ever changed to fan out one child run PER lead, demand jumps with
active-lead count.

Upgrade trigger (observed, not lead-count): latency spike WHILE peak concurrent runs sit near 20 AND
status.trigger.dev green = real concurrency, fix with Hobby $10/mo (25) or +50 bundles $10/mo. Latency
spike platform-wide with low concurrency + a status incident = platform issue, wait it out.

Verify (read-only): the dispatch-latency probe (`TRIGGER_PROD_API_KEY`) reports the queue->start gap;
healthy = seconds-to-low-minutes.

## B. Re-Save the 5 voice setters (apply the empty-string default_dynamic_variables safety net)

Why: retell-proxy v43 now writes agent-level `default_dynamic_variables` (all empty strings) on every
Save/Push, so any unfilled `{{variable}}` renders as nothing instead of the literal token. This only
reaches a LIVE agent when that setter is next Saved/Pushed; the 5 live agents were last modified
2026-06-17 (before v43), so they do not have it yet. NEVER edit the prompt text, just open and Save/Push:

1. Main Outbound (slot 1)
2. Gary - Property Coach (slot 4)
3. Gary - Mortgage Broker (slot 5)
4. Gary - Finance Strategist (slot 6)
5. Gary - Crazy Gary (slot 7)

Claude verifies (read-only) via Retell get_agent on each agent_id, confirming `default_dynamic_variables`
is now present with `first_name/last_name/email/phone/business_name = ""`. (contact_id is NOT in the
agent-level defaults; it is injected by retell-inbound-webhook at call time.)
- slot 1: `agent_f45f4dd87a4072424f3c84b74c`
- slot 4: `agent_e71ee570afc57878bc15a991f7`
- slot 5: `agent_3cfd96bff096b0ec08fe272f1b`
- slot 6: `agent_fa8a7b317caa7f27e025df28eb`
- slot 7: `agent_f1264975ec7385293271773117`

## C. Inbound greeting: DOCUMENT ONLY (no change now)

Finding (verified read-only 2026-06-24): inbound `+61481614530` and outbound use the SAME agent
`agent_f45f4dd` and the SAME `begin_message`, the outbound opener:
"Hey {{first_name}}, it's Gary, from Building Flow Digital - you put your hand up for some info on our AI
setter service. Got a quick sec?". The `{{first_name}}` literal-token bug is already fixed in code
(retell-inbound-webhook v6 returns `first_name=""`), so a cold inbound caller now hears "Hey , it's
Gary... you put your hand up..." (empty, not the literal token). It still reads outbound-flavoured on
inbound, but that is cosmetic.

Decision (Brendan, 2026-06-24): you will SPLIT inbound from outbound LATER. No greeting change now.
When you split (per-direction agent fork), give the dedicated INBOUND agent this neutral opener (from
`frontend/src/data/bfdVoiceSetterPrompt.md` line 27) and leave the OUTBOUND opener as-is:
"Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital. Just so you know, this call is
being recorded for quality. What can I help you with?"

## D. Calls live-smoke

1. Real try-gary form-fill (e.g. mortgage broker persona) with a test contact. Expect the outbound call
   within ~1-2 min.
   - Claude verifies (read-only): call_history row for the destination number; created-at vs form-fill gap.
2. Inbound call to `+61481614530` from a number NOT in the CRM. Expect Gary to omit the name and NEVER
   say the literal `{{first_name}}`.
   - Claude verifies: code-confirmed (v6 first_name=""); plus read the call_history/transcript row.

## E. GHL "SMS in Conversations" POC (when you have done the GHL app clicks)

Full field-by-field is in the 2026-06-22 handoff Part B. Summary:

1. My Apps -> Create App "BFD SMS Mirror" (Distribution = Private + Sub-Account).
2. Scopes: conversations.readonly, conversations.write, conversations/message.readonly,
   conversations/message.write, contacts.readonly.
3. Conversation Providers -> Create "BFD Twilio Mirror"; Type = SMS; CHECK "Is this a Custom Conversation
   Provider"; Delivery URL = https://buildingflowdigital.com (dummy, never called while non-default).
4. Install the app on location `xo0XjmenBBJxJgSnAdyM`.
5. Copy the conversationProviderId and paste it to Claude.
6. SAFETY CHECK (the whole double-send guard): Sub-Account Settings -> Phone Numbers -> (Advanced) ->
   SMS Provider: confirm "BFD Twilio Mirror" is NOT the default; the existing Twilio/LC Phone stays
   default. Tell Claude "non-default confirmed".

Claude then wires it (Mgmt API): pre-read SELECT (expect NULL) ->
`UPDATE clients SET ghl_conversation_provider_id='<id>' WHERE id='e467dabc-57ee-416c-8831-83ecd9c7c925';`
-> post-read SELECT and echo the stored value back.

Single-message double-send test: Brendan sends ONE SMS via the real BFD flow (manual CRM send is
simplest) to TEST_PHONE_A `+61405482446` (free-use; do NOT use the wife's phone without asking). Success
= all three:
(a) the phone buzzes exactly once (the definitive no-double-send signal);
(b) Claude reads exactly 1 BFD send in `sms_delivery_events` (twilio_message_sid, status sent/delivered);
(c) Claude reads exactly 1 outbound SMS BUBBLE in GHL Conversations (not a Note) via `clients.ghl_api_key`.

Known risk / contingency (PIT vs OAuth): the backend posts with the PIT, which references a different
app's providerId. (a) Try PIT+providerId as-is (what the code already sends). (b) If the bubble is
missing while Twilio still sent (401/403/provider-mismatch; non-OK `via:"conversations"` in edge logs),
the fix is to switch the conversations post to the new app's OAuth access token: that is a code change,
so it gets scoped and flagged before implementing, never changed silently. (c) Fallback: SMS still
mirrors to Conversations without the branded provider tag (acceptable).

---

## Optional: Part D go-live live smokes (read-only Mgmt-API SELECTs on `e467dabc` / `xo0Xjmen`)

Run when ready: 3.12 SMS booking (`bookings.source='sms'` + engagement_executions
`stop_reason='booking_created'`); 6.11 voicemail/no-answer fast-fallback SMS + `last_call_outcome`
stamped; 6.12 call+SMS outcome fields + `leads.last_sms_analyzed_at` advances; 6.10 fresh GHL lead has
`leads.normalized_phone`; 6.7 probe canary; bug-sweep UI 6.1/6.3/6.4 + delete-setter leaves no orphan
`voice_setters` row.
