---
description: Combined next-session kickoff (2026-06-24) — finish the GHL SMS-in-Conversations POC (6.12a, Brendan's GHL dev enrollment is DONE / "My Apps" visible, client row pre-verified NULL+has_pit) AND produce the operator runbook for the Trigger.dev concurrency raise + re-Save 5 setters + neutral inbound begin_message + calls live-smoke, each with read-only server-side verification.
---

# Handoff 2026-06-24 — GHL Conversations POC + calls/{{first_name}} operator runbook (one session)

## TL;DR — what this session does

Two independent work-streams, run together in one session:

- **TASK A — finish the GHL "SMS in Conversations" POC (item 6.12a).** Brendan's GHL *developer-account* enrollment is now DONE ("My Apps → Create App" is visible). He creates a display-only custom SMS conversation provider; Claude wires `clients.ghl_conversation_provider_id` and runs a single-message double-send test. Pre-check already done this session: client `e467dabc` has `ghl_conversation_provider_id = NULL`, `ghl_location_id = xo0XjmenBBJxJgSnAdyM`, `ghl_api_key` present, `llm_model = google/gemini-flash-latest` (clean).
- **TASK B — operator runbook + read-only verification** for the Brendan-owned items behind the 2026-06-23 calls/`{{first_name}}` fix (already deployed: `49a594e` on `main`, Trigger `20260623.1`): the **Trigger.dev concurrency raise** (the real latency fix), **re-Save the 5 voice setters** + verify `default_dynamic_variables`, the **neutral inbound begin_message** (report-only), and a **calls live-smoke** checklist.

Repo `/srv/bfd/Projects/bfd-setter`, branch **`main` = `ce8b79a`** (calls+firstname sweep merged; clean apart from the usual untracked `deno.lock` + an edited ops-wipe handoff). Supabase ref **`bjgrgbgykvjrsuwwruoh`**. Creds in `./.env`: `SUPABASE_PAT`, `TRIGGER_DEPLOY_PAT`, `TRIGGER_PROD_API_KEY`. Live DB reads/writes via the Supabase **Management API** `/database/query` (NOT the postgres MCP). Live GHL reads use the client's real `clients.ghl_api_key` (the `.env BFD_GHL_PIT` is INVALID — 401 — for loc `xo0Xjmen`). **Never edit voice prompts** (report-only; Brendan applies in the BFD setter UI). These ops are live + network → disable the sandbox for them.

---

## ===== COPY-PASTE KICKOFF PROMPT (paste this into the new session) =====

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main = ce8b79a. Supabase ref
bjgrgbgykvjrsuwwruoh. Creds in ./.env: SUPABASE_PAT, TRIGGER_DEPLOY_PAT, TRIGGER_PROD_API_KEY. Live
GHL reads use clients.ghl_api_key (the .env BFD_GHL_PIT is INVALID/401 for loc xo0Xjmen).

READ FIRST (in order):
- Operations/handoffs/2026-06-24-ghl-conversations-poc-and-calls-runbook.md  (this combined snapshot)
- Operations/handoffs/2026-06-22-go-live-deployed-plus-ghl-conversations-provider-poc.md  (Part B = the GHL provider walkthrough)
- Docs/CALLS_AND_FIRSTNAME_FIX_2026-06-23.md  (Parts 2, 3, 6 = the calls latency + {{first_name}} fix)
- Operations/handoffs/2026-06-23-calls-firstname-deploy-and-next.md
- memories: project_ghl_sync_6_11_6_12_6_13_2026_06_19, project_trigger_dev_dispatch_latency_2026_06_23,
  feedback_no_internal_prompt_edits, feedback_verify_before_moving_on

RULES (hard): NEVER edit voice agent prompts — not on Retell (dashboard/REST PATCH/publish) and not in
repo prompt files; report the exact location + recommended change, Brendan applies it in the BFD setter
UI. Verify server-side read-only before claiming anything done (tsc/deploy/push are necessary, not
sufficient). Live DB via Supabase Management API /database/query with $SUPABASE_PAT, NOT the postgres
MCP. Brendan drives anything needing his login/phone/UI; Claude verifies read-only. These ops are
live+network → disable the sandbox for them.

================ TASK A — finish the GHL "SMS in Conversations" POC (item 6.12a) ================
Goal: BFD's Twilio-sent SMS appear as chat BUBBLES in the GHL contact's Conversations tab instead of
as Notes. The flip is one column: set clients.ghl_conversation_provider_id to a real GHL custom-
conversation-provider id (today NULL → pushSmsToGhl falls back to writing a Note).

Verified facts: the code path (frontend/supabase/functions/_shared/ghl-conversations.ts pushSmsToGhl,
+ 5 call sites: receive-twilio-sms, crm-send-message, processMessages, runEngagement→sendTwilioSmsAndStamp,
voice-booking-tools) is MIRROR/LOG-ONLY — it POSTs /conversations/messages/outbound (Version 2021-04-15,
Authorization: Bearer <clients.ghl_api_key>, body {type:"SMS",contactId,message,conversationProviderId,
direction:"outbound",altId:<twilio sid>}). It never calls a GHL "send" endpoint, so there is NO code-level
double-send. The ONLY double-send vector is GHL config: if the new custom provider were made the
location's DEFAULT SMS channel. Pre-check already passed: client e467dabc-57ee-416c-8831-83ecd9c7c925 has
ghl_conversation_provider_id=NULL, ghl_location_id=xo0XjmenBBJxJgSnAdyM, ghl_api_key present.

Step 1 — Brendan creates the display-only provider (Claude walks him field-by-field; full detail in the
2026-06-22 handoff Part B):
  1. My Apps → Create App. Name "BFD SMS Mirror". Distribution = Private + Sub-Account.
  2. Scopes: conversations.readonly, conversations.write, conversations/message.readonly,
     conversations/message.write, contacts.readonly.
  3. Conversation Providers → Create. Name "BFD Twilio Mirror"; Type = SMS; CHECK "Is this a Custom
     Conversation Provider"; Delivery URL = https://buildingflowdigital.com (dummy, never called while
     non-default).
  4. Install the Private app on location xo0XjmenBBJxJgSnAdyM.
  5. Grab the conversationProviderId (provider detail "ID", and sub-account Settings → Conversation
     Providers after install) → paste to Claude.
  6. CRITICAL safety check (the whole double-send guard): sub-account Settings → Phone Numbers →
     (Advanced) → SMS Provider — confirm "BFD Twilio Mirror" is NOT the default; existing Twilio/LC
     Phone stays default. Confirm "non-default" to Claude.

Step 2 — Claude wires it (Mgmt API): pre-read SELECT (expect NULL) →
  UPDATE clients SET ghl_conversation_provider_id='<id>' WHERE id='e467dabc-57ee-416c-8831-83ecd9c7c925';
  → post-read SELECT and echo the stored value back.

Step 3 — single-message double-send test. Brendan sends ONE SMS through the real BFD flow (manual CRM
send is simplest) to TEST_PHONE_A = +61405482446 (free-use; do NOT use TEST_PHONE_B / wife's phone
without asking). Success = all three: (a) phone buzzes exactly once (Brendan observes — the definitive
no-double-send signal); (b) exactly 1 BFD send in sms_delivery_events (twilio_message_sid, status
sent/delivered) for that contact/window — Claude SELECTs read-only; (c) exactly 1 outbound SMS bubble in
GHL Conversations (not a Note) — Claude reads the GHL conversation thread read-only via clients.ghl_api_key.
Posting-auth ladder (the unconfirmed PIT-vs-OAuth caveat — backend posts with the PIT, which references a
DIFFERENT app's providerId): (a) try PIT+providerId as-is (it's what the code already sends); (b) on
401/403/provider-mismatch (bubble missing while Twilio still sent; shows as non-OK via:"conversations" in
edge logs) → switch the conversations post to the new app's OAuth access token (one-time code exchange) —
scope + flag before implementing, do not change code silently; (c) fallback → SMS still mirrors to
Conversations without the branded provider tag (acceptable; keep bubbles, lose only the channel label).

================ TASK B — operator runbook + read-only verification (calls/{{first_name}} follow-through) ================
Produce a SINGLE click-by-click operator runbook for the Brendan-owned items below, and do the read-only
server-side verification around each. Paste the runbook in chat AND save it to a dated handoff doc.

(1) Trigger.dev concurrency raise (THE real latency fix — calls fire ~20-45 min late because the prod
    ENVIRONMENT dispatches runs late, not the app/code). Project proj_fdozaybvhgxnzopabtse, environment
    prod. Runbook: dashboard → prod env → Concurrency (or Settings → Concurrency); read the current env
    concurrency limit; raise it well above steady-state simultaneous cadences (and/or upgrade plan);
    confirm no billing/usage cap; check status.trigger.dev. Cause detail: run-engagement calls
    placeOutboundCall.triggerAndWait(...), so a parent run holds a slot while FROZEN waiting on its child
    call run — a low env limit starves the queue. Then RE-MEASURE latency read-only with the probe (the
    inline snippet in CALLS_AND_FIRSTNAME_FIX_2026-06-23.md Part 1, or recreate scratchpad/trigger_probe.py
    from it; needs TRIGGER_PROD_API_KEY): healthy = queue→start in seconds, sick = ~20-45 min. NOTE this
    latency dropped to ~2-3 min right after the 2026-06-23 deploy (fresh workers) and may be transient —
    measure over time; the env concurrency raise is the durable fix.

(2) Re-Save the 5 voice setters so the new agent-level default_dynamic_variables (empty-string safety net,
    pushed by retell-proxy v43) takes effect on the LIVE agents, then verify read-only. The 5 canonical
    setters (NEVER edit their prompts — re-Save/Push only, which Brendan does in the UI): Main Outbound
    slot 1 = agent_f45f4dd87a4072424f3c84b74c ("Voice-Setter-Test", the live main); Gary - Property Coach
    slot 4 (agent_e71ee57…); Gary - Mortgage Broker slot 5 (agent_3cfd96b…); Gary - Finance Strategist
    slot 6 (agent_fa8a7b3…); Gary - Crazy Gary slot 7 (agent_f126497…). After Brendan re-Saves each,
    Claude verifies read-only via the Retell API (get_agent / Retell MCP) that each agent now carries
    default_dynamic_variables (first_name/last_name/email/phone/business_name/contact_id present, empty).

(3) Neutral inbound begin_message (report-only — Brendan applies in the BFD setter UI; do NOT edit). The
    live inbound greeting is outbound-flavoured and reads oddly for cold inbound callers even with the
    {{first_name}} token now gone. Recommend switching the inbound agent's begin_message to the canonical
    variable-free opener in frontend/src/data/bfdVoiceSetterPrompt.md: "Hey, this is Gary, I'm Brendan's
    AI assistant at Building Flow Digital… What can I help you with?". Surface the exact location + the
    recommended text; Brendan applies it.

(4) Calls live-smoke checklist (Brendan acts, Claude verifies server-side read-only): (a) a real
    try-gary form-fill → the outbound call lands within ~1-2 min (verify the call_history row's
    created-vs-form-fill gap read-only); (b) an inbound call to +61481614530 from a number NOT in the CRM
    → the agent omits the name and never says the literal "{{first_name}}" (already code-confirmed:
    retell-inbound-webhook v6 returns first_name="").

================ OPTIONAL — Part D go-live live smokes (deployed; run when Brendan is ready) ================
Read-only Mgmt-API SELECTs on client e467dabc / loc xo0Xjmen: 3.12 SMS booking (bookings.source='sms' +
engagement_executions stop_reason='booking_created', status='completed'; reschedule/cancel/callback; STOP
not sent); 6.11 voicemail/no-answer → fast fallback SMS + engagement_executions.last_call_outcome stamped;
6.12 call+SMS outcome fields populate (read GHL contact via ghl_api_key; leads.last_sms_analyzed_at
advances after the hourly analyze scan); 6.10 fresh GHL lead has leads.normalized_phone (code already sets
it via buildLeadInsert→normalizePhone — confirm live); 6.7 probe canary; bug-sweep UI 6.1/6.3/6.4 +
delete-setter leaves no orphan voice_setters row.

SUGGESTED ORDER: Task B (1) + (2) are independent of GHL and can go first (raise concurrency, re-measure,
re-Save setters). Task A is gated on Brendan finishing the GHL provider clicks — do it when he has the
providerId. Finish with the live smokes.
```

## ===== END COPY-PASTE KICKOFF PROMPT =====

---

## Reference detail (for the operator, not part of the paste-prompt)

**This session's state (2026-06-24):** Brendan's GHL developer enrollment finished ("My Apps" visible).
Read-only pre-check confirmed client `e467dabc` is ready to wire (`ghl_conversation_provider_id=NULL`,
`ghl_location_id=xo0XjmenBBJxJgSnAdyM`, `ghl_api_key` present, `llm_model` clean). The GHL POC plan
(approach + verification) is at `~/.claude/plans/bfd-setter-continuation-repo-srv-bfd-pro-melodic-pillow.md`.

**Calls/{{first_name}} fix is already DEPLOYED** (don't redo the code/deploy): commit `49a594e` merged to
`main`; edge fns retell-inbound-webhook v6, retell-proxy v43, ghl-tag-webhook v12, analyze-sms-conversation
v2, make-retell-outbound-call v24, retell-call-webhook v20, retell-call-analysis-webhook v24,
voice-booking-tools v21, kb-ingest v6; Trigger `20260623.1`. What remains is purely the Brendan-owned
operator items in TASK B (dashboard concurrency, re-Save setters, begin_message UI text, live smoke).

**Why one session:** Task A is gated on Brendan's GHL UI clicks (idle time for Claude); Task B (1)+(2) are
independent and fill that time. Both want the same read-only verification discipline (Mgmt API SELECT +
Retell read), so they share tooling.
