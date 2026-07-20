> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---
# Review & Onboarding Prompts (2026-06-05)

Two ready-to-paste prompts for a fresh Claude Code session, plus an onboarding gap
analysis. Generated from a 5-agent map of the function surface, the runtime
lead→cadence→voice/SMS→booking chain, `Docs/CLIENT_ONBOARDING_SOP.md`, open gaps, and
the per-client `clients` config surface. Source-of-truth backup; copy the fenced blocks.

---

## PROMPT 1 — Functional Review

```
You are a senior engineer doing a systematic functional verification of the bfd-setter project (multi-tenant voice/SMS AI setter platform: Supabase edge functions + Trigger.dev + GHL + Retell + Twilio + OpenRouter + Stripe). Your job is to prove every functional area works end-to-end, or produce a precise list of what is broken. Do NOT edit prompts, do NOT make live outbound calls/SMS to real numbers without explicit permission, and do NOT change any DB rows except the explicit synthetic-probe test lead lifecycle. Read-mostly. Produce a pass/fail report at the end.

== ENVIRONMENT FACTS ==
- TWO Supabase projects. Platform DB ref `bjgrgbgykvjrsuwwruoh` (canonical: clients, leads, engagement_*, call_history, message_queue, bookings, cadence_metrics). Per-client external mirror DB (e.g. BFD = `qildpilxjodxdifggmto`) holds text_prompts, chat_history, voice_prompts, documents, prompts, credentials.
- 83 edge functions (Deno) + 11 Trigger.dev tasks (project `proj_fdozaybvhgxnzopabtse`).
- CRITICAL auth gotcha: deployed functions run `verify_jwt=false` (~32) but the repo `config.toml` does NOT reflect deployed state. NEVER infer auth from config.toml — confirm against the deployed function via Management API.
- Two test phones: TEST_PHONE_A `+61405482446` (Brendan, free-use), TEST_PHONE_B `+61403804263` (Brendan's wife — ASK before EVERY use).

== TOOLING AVAILABLE ==
1. Supabase Management API (env `SUPABASE_PAT`, a `sbp_...` token): run arbitrary SQL via
   POST https://api.supabase.com/v1/projects/bjgrgbgykvjrsuwwruoh/database/query  body {"query":"..."}
   Use this for all platform-DB reads/asserts. Use the client mirror ref for external-DB checks.
2. `mcp__postgres__query` — direct SQL (confirm which DB it points at first).
3. `mcp__retell__*` MCP — list_agents, get_agent, list_phone_numbers, get_phone_number, get_call, list_calls. NOTE: the Retell MCP key may return 401/invalid (known open item) — if so, fall back to curl against the Retell REST API with the per-client retell_api_key.
4. curl against deployed edge functions: https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/<slug>
5. The React frontend (Railway) for UI smoke tests (retell-proxy actions, Save Setter, settings).
6. Trigger.dev dashboard for run status (filter on payload.client_id).

== METHODOLOGY ==
For each function group below: (a) identify the entry point + auth model, (b) run the smoke test, (c) run the negative/security test, (d) record PASS/FAIL with the exact evidence (row, status code, log line). Start with Tier 0 (the live revenue path); a green hourly synthetic-probe already self-verifies most of ingress→cadence→outbound.

== SECURITY / AUTH CHECKS (run these FIRST, today's priority) ==
The two auth guards: `authorizeClientRequest` (service-role key OR owning user JWT) used by 32 fns, and `assertClientAccess` (JWT-vs-clientId) used by reactivate-lead, reactivate-lead-list, crm-send-message, analyze-chat-history, get-campaign-stats, fix-business-messages, stop-bot-webhook.
For a representative sample of JWT-guarded functions (make-retell-outbound-call, retell-proxy, crm-send-message, reactivate-lead):
- [ ] Anonymous call (no Authorization header) returns 401/403. PASS = NOT 200.
- [ ] Internal service-role path (Authorization: Bearer <SERVICE_ROLE_KEY>) returns 200. PASS = 200.
- [ ] Cross-tenant: a JWT for agency A targeting client_id of agency B returns 403. PASS = rejected.
- [ ] Confirm deployed verify_jwt state via Management API for sync-ghl-contact, retell-call-webhook, receive-twilio-sms — do NOT trust config.toml.
- [ ] Webhook forgeability audit: confirm which inbound webhooks verify signatures. EXPECT verify-if-present (HMAC) on: ghl-tag-webhook, bookings-webhook, unipile-webhook, receive-dm-webhook, retell-call-analysis-webhook. EXPECT ZERO sig logic (forgeable) on: sync-ghl-contact, sync-ghl-booking, workflow-inbound-webhook, retell-call-webhook. Report this as a known residual, not a regression.

== GROUP A — LEAD INGRESS (Tier 0) ==
Entry points: sync-ghl-contact (CANONICAL single ingress; resolves tenant by GHL_Account_ID→clients.ghl_location_id, routes by tag via _shared/resolve-workflow.ts), ghl-tag-webhook (Pattern A), intake-lead (Bearer intake_lead_secret), process-lead-file (CSV/JWT).
Smoke:
- [ ] POST sync-ghl-contact with body {Lead_ID, Name, Email, Phone, GHL_Account_ID=<BFD loc>}; assert a `leads` row + an `engagement_executions` row (status pending→running) + a fired run-engagement Trigger run.
- [ ] Tag routing: a tag matching an active engagement_workflows.new_leads_tag routes there; no tag → falls back to clients.auto_engagement_workflow_id.
Negative:
- [ ] Unknown GHL_Account_ID → 400, no lead created.
- [ ] sync_ghl_enabled=false → returns {status:"disabled"}, NO lead created (assert no row).
- [ ] Missing Lead_ID or GHL_Account_ID → 400.
- [ ] Echo-loop guard: simulate updated_at <60s + matching last_synced_from stamp → skipped_echo.

== GROUP B — ENGAGEMENT / CADENCE (Tier 0, the brain) ==
Task: runEngagement (run-engagement). Node types: delay, send_sms, send_whatsapp, phone_call, engage, wait_for_reply, drip.
Smoke (use a synthetic test lead, no real sends):
- [ ] send_sms node → message_queue row (channel sms_outbound) + Twilio (use Twilio test creds or assert the API call shape; do NOT text real numbers).
- [ ] phone_call node → placeOutboundCall.triggerAndWait fires; engagement_executions.active_call_id set.
- [ ] Resume-on-outcome: simulate retell-call-webhook stamping last_call_outcome; assert waitForCallOutcome breaks and cadence advances.
- [ ] Quiet-hours gating: lead in quiet window → wait.until parks (no immediate send). Fallback chain workflow.quiet_hours_override → clients.cadence_quiet_hours → DEFAULT 09:00-21:00 Brisbane.
- [ ] Opt-out gating: leads.setter_stopped=true → isCancelled() self-cancels with stop_reason=setter_stopped.
Negative:
- [ ] Missing twilio creds → run fails (marked failed), not silent.
- [ ] KNOWN GAP to verify: lead_optouts row present but setter_stopped cleared → cadence resumes (no second-line lead_optouts guard before Twilio send). Confirm whether this fires.

== GROUP C — VOICE (Retell) ==
Entry points: retell-proxy (30 actions, JWT+role), voice-booking-tools (Bearer intake_lead_secret, ?tool=&clientId=), retell-call-webhook (last_call_outcome stamp), retell-call-analysis-webhook, make-retell-outbound-call (internal, verify_jwt=false), placeOutboundCall, scheduleCallback.
Smoke:
- [ ] retell-proxy list-agents / get-agent for BFD returns agents (via MCP or REST with retell_api_key).
- [ ] PUBLISH SMOKE (KNOWN OPEN ITEM): Save+publish an agent via retell-proxy; assert repointPhoneVersionsAfterPublish wrote weighted-list {agent_id, agent_version, weight:1} to phone inbound_agents (slot1) / outbound_agents (slots 2/3). Confirm read is present-array-authoritative (inbound_agents[0].agent_id), NOT the deprecated inbound_agent_id. Confirm a multi-phone client is NOT clobbered (repoint only re-pins phones already on the just-published agent_id, bumps version only).
- [ ] voice-booking-tools?tool=get-available-slots&clientId=<BFD> → GHL free-slots returns. tool=book-appointments with payload using startDateTime/endDateTime (NOT startDate/endDate — 422 otherwise) → bookings row + active engagement_executions cancelled (cadence-end).
- [ ] retell-call-webhook on call_ended with dynamicVars.execution_id → engagement_executions.last_call_outcome stamped AND active_call_id cleared.
Negative:
- [ ] make-retell-outbound-call with missing retell_api_key → 409.
- [ ] voice_setter inactive → 409 voice_setter_inactive.
- [ ] retell-call-webhook last_call_outcome write failure path returns 500 (so Retell retries) — confirm.
- [ ] Voice picker: a setter row with voice_id "11labs-Matt" → Save Setter 404 (Matt removed). Confirm guard.
- [ ] EE1 shared-agent guard: single-DID config (only retell_inbound_agent_id set, 2/3 NULL) → Save Setter for one direction triggers "Push blocked — agent shared across slots" + Fork button.

== GROUP D — TEXT / SMS (Twilio + OpenRouter) ==
Entry points: receive-twilio-sms (live inbound, resolves by retell_phone_1=To, per-client HMAC-SHA1 over reconstructed PUBLIC url), twilio-status-webhook, twilio-send-sms, processMessages → processSetterReply.
Smoke:
- [ ] Inbound SMS (simulated, valid Twilio sig) → message_queue + dm_executions row, active cadences cancelled (unless voiceCallActive hold), process-messages fired.
- [ ] processMessages debounce (60s / clients.debounce_seconds) → processSetterReply → OpenRouter (clients.openrouter_api_key + llm_model) → {Message_1,2...} → reply sent direct via Twilio. Requires use_native_text_engine=true (Trigger-side flag) and external text_prompts Setter-N row.
- [ ] twilio-status-webhook → sms_delivery_events row.
Negative:
- [ ] STOP keyword → lead_optouts upsert, leads.setter_stopped=true, endActiveCadences(opt_out), single compliance reply. START → resubscribe.
- [ ] dm_enabled=false → inbound recorded but no reply (assert silent skip).
- [ ] Two clients sharing retell_phone_1 → .maybeSingle() PGRST116 breaks inbound. Assert no duplicate phones exist: SELECT retell_phone_1, count(*) FROM clients GROUP BY 1 HAVING count(*)>1.
- [ ] Invalid Twilio sig → 403; missing twilio_auth_token → 403. Returns empty TwiML 200 on internal error (no retry-storm).
- [ ] Carrier opt-out 21610 is sticky — if testing with a real phone that texted STOP, text START first.

== GROUP E — BOOKING ==
Entry points: bookings-webhook (GHL appt status, HMAC if ghl_webhook_secret set), sync-ghl-booking, voice-booking-tools (Group C).
Smoke:
- [ ] bookings-webhook confirmed status → bookings upsert (UNIQUE client_id,ghl_appointment_id), stop_reason=booking_created, active engagement_executions cancelled.
- [ ] TZ-naive timestamps parsed in clients.timezone.

== GROUP F — DM/SOCIAL (Unipile) ==
- [ ] receive-dm-webhook (?client_id=, optional HMAC) mirrors receive-twilio-sms shape → process-messages. Verify which slug is live (receive-dm-webhook vs unipile-webhook) before testing.

== GROUP G — ANALYTICS ==
- [ ] run-analytics / compute-analytics / analytics-v2-process / get-campaign-stats return without 500. compute-analytics + v2 use OpenRouter.

== GROUP H — SIMULATION / I — AI PROMPT / J — SETTER CONFIG ==
- [ ] run-simulation / generate-simulation-config (→ run-ai-job) / generate-setter-config (OpenRouter gemini-2.5-pro) return jobs.
- [ ] duplicate-setter-config clones with ZERO directions (else Save fans agent into main columns — the 2026-05-18 wipe class). copy-setter-config / restore-setter-config round-trip.
- [ ] DO NOT call generate-ai-prompt/modify-prompt-ai in a way that edits live prompts (no-internal-prompt-edits rule).

== GROUP K — PROVISIONING / L — BILLING / M — WORKFLOW / N — PROBE ==
- [ ] create-client-user (agency JWT): creates auth user, sets profiles.client_id+agency_id, flips user_roles.role agency→client. Cross-agency target → 403.
- [ ] sync-external-credentials + test-external-supabase enforce agency ownership. NOTE test-external-supabase validates serviceKey.startsWith('eyJ') — a raw sb_secret_* key FAILS the format check though it's the correct post-2026-04-29 key. Flag, don't "fix".
- [ ] stripe-webhook flips clients.subscription_status. check-client-subscription: subscription_status must be 'active'/'grace_period' (default 'free' BLOCKS).
- [ ] synthetic-probe: confirm last probe_results row is green (hourly). If green, ingress→cadence→outbound is self-verified. Confirm PROBE_CLIENT_ID has a NON-shared retell_phone_1.

== TRIGGER.DEV ENV AUDIT ==
- [ ] Confirm Trigger.dev PROD env has SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TRIGGER_SECRET_KEY (scoped separately from Supabase secrets; missing throws before any DB write — sync-ghl-contact needs TRIGGER_SECRET_KEY to enrol).
- [ ] classifyCallOutcome.ts byte-identical in both locations (frontend/.../retell-call-analysis-webhook/ and trigger/_shared/). Confirm Bug 33 guard: ambiguous hangups count as human_pickup only if duration_ms>=5000 AND transcript_turns>=2.

== OUTPUT ==
A markdown table: Group | Function | Test | PASS/FAIL | Evidence. Then a prioritized list of FAILs (Tier 0 first), then the known-residual section (forgeable webhooks, lead_optouts non-enforcement, publish-smoke). Reference exact file paths under /srv/bfd/Projects/bfd-setter/frontend/supabase/functions/<name>/index.ts and /srv/bfd/Projects/bfd-setter/trigger/<task>.ts.
```

---

## PROMPT 2 — New Client Setup Simulation

```
You are a senior engineer running a DRY-RUN SIMULATION of onboarding a brand-new client ("AcmeCo") onto bfd-setter, end to end. GOAL: walk the full provisioning sequence, and at EACH step state (1) what to provision, (2) where it is stored, (3) how to verify it, (4) what SILENTLY breaks if skipped. Do NOT create real external accounts or live rows — simulate, and where a real artifact is needed use a clearly-marked test value. Treat the canonical SOP as ground truth: /srv/bfd/Projects/bfd-setter/Docs/CLIENT_ONBOARDING_SOP.md (1019 lines). End with a readiness checklist and a likely-missing/gaps section. Reference real columns, function names, and SOP sections.

== ARCHITECTURE GROUND TRUTH ==
- TWO Supabase projects per client: PLATFORM DB `bjgrgbgykvjrsuwwruoh` (the `clients` row + all orchestration; source of truth, ~100 cols accreted via migrations — schema.sql is STALE at 15 cols) and a PER-CLIENT EXTERNAL "setter-live" mirror (text_prompts, chat_history, voice_prompts, documents, prompts, credentials).
- Canonical single ingress = sync-ghl-contact (Pattern B, snapshot clients). intake-lead / ghl-tag-webhook are alternates.
- Run platform SQL via Supabase Management API with env SUPABASE_PAT against ref bjgrgbgykvjrsuwwruoh. scripts/onboard-client.mjs automates ONLY §4.1/§4.2/§4.3 and inserts a SUBSET of columns.

Walk these phases IN ORDER. For each, output the provision/store/verify/breaks-if-skipped block.

== PHASE 0 — Pre-sales + decisions (SOP §1,§2) ==
Provision: discovery one-pager (volume, stack, hours/TZ, tone/banned words), 22-field collection doc. Decisions: Twilio BYO-vs-shared, OpenRouter mint-vs-BYO, Retell BYO-vs-BFD, external Supabase who-provisions.
Gate: BFD must have run use_native_text_engine=true >=14 days with no cadence_funnel regression, else onboarding "not valid."
Breaks if skipped: no data to drive config; US BYO-Twilio needs A2P 10DLC brand registration BEFORE launch or SMS is suspended.

== PHASE 1 — Per-client external Supabase (§3.1) ==
Provision: project `acmeco-setter-live`; run seed SQL creating chat_history, text_prompts (seed card_name='Setter-1'), voice_prompts, documents (vector(1536) + CREATE EXTENSION vector), leads mirror. For n8n clients also client-schema-extension.sql: prompts rows 0-10 (workflow hard-reads data[10]) + credentials row.
Store: clients.supabase_url, clients.supabase_service_key (sb_secret_*), clients.supabase_anon_key (sb_publishable_*), clients.supabase_table_name='leads'. Legacy JWT keys disabled since 2026-04-29.
Verify: invoke test-external-supabase. KNOWN MISMATCH — it validates serviceKey.startsWith('eyJ') (JWT shape); a raw sb_secret_* key FAILS the tester even though it's the correct format. Note this, verify connectivity another way.
Breaks if skipped: processSetterReply can't read prompts / write chat_history → AI replies fail silently (empty system prompt). KB ingest + voice overrides break.

== PHASE 2 — Platform clients row + GHL custom field + workflow clone (§4) ==
Provision: run `node --env-file=.env scripts/onboard-client.mjs --dry-run` then for real. CAPTURE client_id + intake_lead_secret IMMEDIATELY (secret is UNRECOVERABLE).
Store (key columns + breaks-if-missing):
- ghl_location_id [REQ] — TENANT RESOLUTION KEY; wrong/missing = no lead ever lands.
- ghl_api_key (PIT, scopes Contacts/Conversations/Calendars/Workflows/CustomFields) [REQ].
- ghl_calendar_id, ghl_assignee_id [REQ for booking].
- twilio_account_sid, twilio_auth_token [REQ] — outbound auth + INBOUND signature verify.
- retell_phone_1 (E.164) [REQ if voice], retell_api_key [REQ if voice], retell_inbound/outbound/outbound_followup_agent_id (3 canonical slots), retell_agent_id_4..10 (optional setter slots).
- openrouter_api_key [REQ for AI], llm_model.
- supabase_url/service_key/table_name [REQ for AI].
- dm_enabled=false UNTIL soft launch (false = NO SMS reaches client).
- use_native_text_engine=true from day 1 (Trigger-side flag).
- debounce_seconds=60, cadence_quiet_hours jsonb {start,end,tz,days[]}, timezone (IANA, keep == quiet_hours.tz).
- intake_lead_secret [REQ] (also Bearer for Retell custom-tool Authorization).
- sync_ghl_enabled=true [REQ] — false/missing → sync-ghl-contact returns disabled, NO lead.
- subscription_status MUST be 'active' (insert defaults 'free' which GATES the client out).
- auto_engagement_workflow_id = NULL until §8 (premature = leads enrol before copy approved).
- ghl_last_synced_from_field_id (set in §4.2), ghl_last_synced_from_field_value (per-client slug, default '1prompt-os').
- Optional: ghl_channel_field_id (else setGhlContactChannel no-ops, "Which Channel?" hits default branch), ghl_conversation_provider_id (else SMS mirror falls to Notes), ghl_call_sentiment_field_id + ghl_call_appt_booked_field_id (else call-summary PATCH silently skipped, Note still written), voicemail_config jsonb, voicemail_audio_url.
- NEW (2026-06-05 security): ghl_webhook_secret, retell_webhook_secret, unipile_webhook_secret.
NOTE: onboard-client.mjs inserts a SUBSET (no ghl_calendar_id, ghl_assignee_id, supabase_*, voicemail_config, subscription_status, ghl_channel_field_id). Confirm the INSERT covered all 22 §4.1 fields.
§4.2: POST /locations/<loc>/customFields {name:"last_synced_from",dataType:"TEXT",model:"contact"} → store id in ghl_last_synced_from_field_id (echo-loop guard). §4.4: edit a contact, confirm no extra sync_ghl_executions row.
§4.3: clone default workflow (INSERT...SELECT FROM engagement_workflows WHERE id='40e8bea3-b6f6-4562-98d1-f7e6599af6a1', or richer BFD v2 28-node 'c206da3e-b8b7-41f8-9de0-997679abefcb'). Do NOT set auto_engagement_workflow_id yet.
Verify: SELECT the row back; confirm all REQ columns non-null; confirm types.ts has every column you used (frontend won't compile / reads undefined otherwise — multi-DB, types.ts CANNOT be wholesale-regenerated).

== PHASE 3 — Platform login (create-client-user) ==
Provision: caller must be agency role; POST {email, password, full_name, client_id}.
Store: Supabase Auth user (email_confirm:true), profiles.client_id+agency_id, user_roles.role flipped agency→client.
Verify: the new user logs in, sees only AcmeCo. Guard: function checks client.agency_id===caller.agency_id (cross-agency → 403).
Breaks if skipped: no dashboard access; if role not flipped, user is wrongly an agency user; if profiles.client_id unset, user not bound to tenant.

== PHASE 4 — Retell agents + phones + weighted *_agents (§3.5,§5.4,§5.5) ==
Provision: persistent agents for 5 slots (inbound=1, outbound-initial=2, outbound-followup=3, voice-setters 4-10) via REST API NOT MCP (MCP strips custom-tool params; MCP key also 401). Set custom-tool URLs on EACH agent: voice-booking-tools?tool=<get-available-slots|book-appointments|get-contact-appointments|update-appointment|cancel-appointments>&clientId=<uuid>, Authorization: Bearer <intake_lead_secret>. Voicemail via Sub-Account Settings UI.
Store: clients.retell_*_agent_id columns (or voice_setters UUID rows + voice_setter_phone_bindings); retell_webhook_secret.
PUBLISH + weighted-list pinning (CRITICAL, the 2026-06-05 migration): after Save Setter publishes, repointPhoneVersionsAfterPublish writes {agent_id, agent_version, weight:1} to phone inbound_agents (slot1)/outbound_agents (slots 2/3) — REPLACED deprecated inbound_agent_version/inbound_agent_id single fields. Run a REAL publish smoke test (this is the KNOWN OPEN item Brendan still owes).
Verify: get-phone-number shows the weighted list pinned to the just-published version; a $1 test call to TEST_PHONE_A uses the new prompt.
Breaks if skipped: phone routes to a stale/draft agent version (EE2 bug) — live calls use old prompt/tools. EE1 guard: single-DID shared-agent + per-direction Save → "Push blocked — agent shared across slots"; use Fork. Persona/cloned setters must own NO directions (else Save fans agent into main columns — 2026-05-18 wipe class). voice_id "11labs-Matt" → Save 404 (removed).

== PHASE 5 — Twilio inbound webhook (§5.9) ==
Provision: for each retell_phone_*, "A message comes in" → https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/receive-twilio-sms (POST). KNOWN DISCREPANCY: the twilio-configure-webhook edge fn auto-sets SmsUrl to .../twilio-inbound-sms (a DIFFERENT, legacy slug). The canonical handler with STOP + sig verify is receive-twilio-sms — verify which is live before relying on the helper.
Verify: send a test SMS in, see message_queue row.
Breaks if skipped: inbound SMS never reaches platform; no AI replies, no STOP handling. Carrier 21610 sticky-opt-out → text START first. US BYO needs A2P 10DLC.

== PHASE 6 — GHL wiring (§5.1-§5.13) ==
Pattern B (snapshot, most clients): `Add Lead to 1Prompt OS` workflow — Trigger=Contact Tag Added `bfd_setter-new_lead`; Action1 set "GHL Account ID"=<loc>; Action2 Custom Webhook POST sync-ghl-contact?clientId=<uuid> body {Lead_ID,Name,Email,Phone,GHL_Account_ID} (DON'T rename keys; clientId query param is IGNORED — tenant resolved by GHL_Account_ID). Per-source form-to-tag bridge: Form Submitted FILTERED to the specific form → Add Tag (unfiltered = every form fires a cadence). Disable snapshot's single `Add Booking` workflow; build two BFD-pattern BOOKED/CANCELLED workflows → bookings-webhook.
Other: GHL Calendar webhook → bookings-webhook {appointmentId,contactId,calendarId,startTime,endTime,status,locationId}. ghl_webhook_secret. ghl_channel_field_id (channel custom field SMS/Email/Voice). ghl_conversation_provider_id. two call-summary fields. Verify PIT scopes via GET /locations/<id> → 200.
Breaks if skipped: wrong pattern (A vs B) = no leads, no error. No tag match + auto_engagement_workflow_id NULL = lead created, no cadence. Booking-outside-voice doesn't end cadence. channel field missing = reply routes to "None" branch.

== PHASE 7 — Per-client cadence config in UI (§5.14,§5.15,§6) ==
Provision: Sub-Account Settings (TZ, contact-hours window, voicemail Save&Push). Voice-Setter editor (pick voice Myra/Marissa/Brian/Cimo, agent name, all 3 directions ON for first save, Save Setter → "Retell AI Synced" or Fork). Cadence copy review: replace every [BRENDAN:...] placeholder (RUNBOOK pre-flight GATES enrolment on zero placeholders), first-touch SMS <160 chars, {{first_name}} not {{full_name}}, delay_seconds per channel, NEW LEADS toggle ON + tag.
Caveat: bare delay nodes between engage nodes crash the canvas editor (Engagement.tsx:3131); use alternating engage→wait_for_reply.

== PHASE 8 — Synthetic dry-run (§7) ==
- §7.1 test lead via intake-lead → leads + engagement_executions rows.
- §7.2 cadence fires <5min (or defers per quiet hours) → message_queue + Twilio Console.
- §7.3 real Retell call → bookings row.
- §7.4 STOP → lead_optouts + engagement_executions cancelled stop_reason=opt_out.
- §7.5 quiet-hours → deferred via wait.until.
- §5.13.5 8-hop Pattern B trace: GHL contact → form-tag workflow → Add-Lead workflow → leads row → engagement_executions → Trigger run → message_queue → tester's phone.

== PHASE 9 — Soft launch + go-live (§8) ==
UPDATE clients SET auto_engagement_workflow_id='<cloned-uuid>', dm_enabled=true WHERE id=<uuid>; (workflow is_active=true, is_new_leads_campaign=true). Confirm subscription_status='active'. Push 5 real leads on screenshare. Daily 5-min SQL watch (cadence_funnel, sms_delivery_events, error_logs). Trigger.dev console filtered on payload.client_id.

== PHASE 10 — Stripe gating (§11,§C) ==
subscription_status='active' until Stripe wired; check-client-subscription reads it; Stripe prod keys in Supabase Secrets not local .env.

== NEW-CLIENT READINESS CHECKLIST (assert each) ==
[ ] external Supabase: 5 tables created, Setter-1 text_prompts seeded
[ ] clients row: all REQ columns non-null; subscription_status='active'; sync_ghl_enabled=true; use_native_text_engine=true; dm_enabled (false pre-launch → true at go-live)
[ ] intake_lead_secret + client_id captured to vault
[ ] types.ts contains every clients column used
[ ] profiles + user_roles + login work; role=client
[ ] >=1 active engagement_workflows; auto_engagement_workflow_id set at go-live
[ ] Retell: agents provisioned + PUBLISHED; phone weighted *_agents pinned to published version; custom-tool URLs + Bearer set
[ ] Twilio: SmsUrl → receive-twilio-sms (NOT twilio-inbound-sms); not sharing retell_phone_1 with any other client
[ ] GHL: Pattern B Add-Lead workflow + filtered form-tag bridge + booking BOOKED/CANCELLED + last_synced_from custom field
[ ] NEW: ghl_webhook_secret + retell_webhook_secret + unipile_webhook_secret set AND upstream configured to send them
[ ] §7 dry-run all 5 sub-tests pass; §5.13.5 8-hop green
[ ] Trigger.dev prod env: SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + TRIGGER_SECRET_KEY

== LIKELY-MISSING / GAPS (surface these explicitly at the end) ==
Report which steps had no automation and were manual; which columns onboard-client.mjs omitted; the test-external-supabase key-format false-negative; the twilio-configure-webhook wrong-slug discrepancy; the webhook-secret residual (secrets have NO verification code behind sync-ghl-contact / sync-ghl-booking / workflow-inbound-webhook / retell-call-webhook — they stay forgeable even after you set the secret); the lead_optouts non-enforcement; and any column you set that is absent from types.ts.
```

---

## ONBOARDING GAP ANALYSIS (what's missing / fragile, and what makes it succeed)

1. **Automation covers only 3 of ~10 phases.** `scripts/onboard-client.mjs` does §4.1 INSERT (subset of columns), §4.2 custom field, §4.3 workflow clone. Everything else is hand-run. Fix: extend the script to the full §4.1 column set + idempotent sub-commands for the external-DB seed and the go-live flip.
2. **Subscription gate silently blocks every new client.** INSERT defaults `subscription_status='free'`; `check-client-subscription` blocks it. Fix: default `'active'` (Stripe not wired) or assert loudly if still `'free'`.
3. **`test-external-supabase` rejects the correct key.** Validates `serviceKey.startsWith('eyJ')`, but valid keys since 2026-04-29 are `sb_secret_*`. The right key fails. Fix: accept `sb_secret_*`/`sb_publishable_*`.
4. **`twilio-configure-webhook` points at the wrong slug** (`twilio-inbound-sms` legacy) vs the canonical `receive-twilio-sms`. Onboarders trusting the helper get no AI replies / no STOP, no error. Fix: point it at `receive-twilio-sms` or retire it.
5. **Webhook-secret step is necessary but NOT sufficient (the 2026-06-05 residual).** Setting the secrets only enables verification on the 5 functions with verify-if-present code (`ghl-tag-webhook`, `bookings-webhook`, `unipile-webhook`, `receive-dm-webhook`, `retell-call-analysis-webhook`). The 4 most critical inbound endpoints — `sync-ghl-contact` (primary ingress), `sync-ghl-booking`, `workflow-inbound-webhook`, `retell-call-webhook` — have ZERO sig-verify code and stay forgeable. **Highest-leverage fix:** add read+HMAC+fail-closed to those 4, then flip the verify-if-present set to fail-closed.
6. **`lead_optouts` written but never enforced pre-send.** `runEngagement` checks only `setter_stopped`. If that clears while a `lead_optouts` row exists, the cadence resumes. Fix: add a `lead_optouts` pre-send guard.
7. **types.ts drift is a hand-maintained multi-DB landmine.** Can't regenerate (pulls wrong DB, 26→232 tables). Every new `clients` column must be hand-added. Fix: curated platform-DB types module + CI diff against `information_schema`.
8. **Retell publish + weighted-list pinning unverified/partly manual.** Publish-smoke still owed; Retell MCP key 401. A phone pinned to a draft dials the wrong prompt silently. Fix: mandatory publish-smoke gate + post-publish assertion + rotate MCP key.
9. **Shared-phone / shared-agent silent breakage.** Two clients sharing `retell_phone_1` break inbound via PGRST116; cloned setters owning directions fan into main columns. Fix: UNIQUE on `retell_phone_1` + enforce the zero-directions invariant.
10. **GHL config entirely manual, easy to misfire** (Pattern A vs B, unfiltered form triggers, single Add-Booking workflow, silent optional fields). Fix: a snapshot/scripted installer + post-setup validator.
11. **Try-Gary persona routing inconsistent** — `User Todos.md` says set `try_gary_persona_slots`, but `ghl-tag-webhook` marks it retired. Fix: pick the canonical path, update the other.

**What makes onboarding reliable:** one idempotent `onboard-client` runner that inserts the FULL clients column set with `subscription_status='active'`, provisions + seeds the external Supabase, sets the 3 webhook secrets AND configures upstreams, runs §7 (5 sub-tests) + the §5.13.5 8-hop as automated assertions, runs the Retell publish-smoke + asserts the weighted-list pin, and finishes with a readiness report that fails loudly on any missing REQ column / shared phone / `'free'` subscription / types.ts gap / "secured-but-unprotected" webhook.
