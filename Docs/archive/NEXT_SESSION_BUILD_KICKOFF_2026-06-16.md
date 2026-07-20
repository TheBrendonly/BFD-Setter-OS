---
description: Next BFD-setter build-session kickoff prompt (authored 2026-06-15 action-walker). Critical voice-publish fix + voice UI/architecture collapse + credentials cleanup & auto-surfacing webhook manifest + analytics/probe fixes + standing backlog. Paste the PROMPT block into the build session.
---

> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---

# Next Build Session Kickoff (2026-06-16)

## PROMPT (paste from here)

```
Next BFD-setter build session. Two prior sessions: the 2026-06-15 comprehensive build (HEAD 68433af) and the 2026-06-15 action-walker (HEAD 9e76a61, which verified T1-14, shipped compute-analytics v13 fixing voice "Total Voice Call = N/A", and SURFACED a critical voice-publish bug + a voice UI/architecture cluster + a new credentials/webhook feature). This session clears that cluster + standing backlog.

READ FIRST (in order):
- Operations/handoffs/2026-06-15-action-walker-progress.md
- Operations/handoffs/2026-06-15-comprehensive-build.md
- memory: project_voice_publish_and_ui_bugs (CRITICAL), project_voice_analytics_total_voice_call_na_bug, project_webhook_sig_verify_scheme_bug, project_probe_enable_status, project_probe_chatanalytics_hang_bug, project_account_access_restructure_idea, project_pending_prompt_changes, project_live_test_runthrough, project_comprehensive_build_2026_06_15, feedback_no_internal_prompt_edits, feedback_verify_before_moving_on
- Docs/VOICE_AGENT_PROMPT_REWRITES_2026-06-14.md (the 5 rewrites Brendan pasted into the doc bodies)

BEFORE writing code: confirm which gated live tests landed (pause/resume E2E; outbound repoint + live call on cadence 40e8bea3; CF pilot A/B) and which provisioning is done (AU A2P, Supabase Pro, the T10b inbound prompt change). Skip-and-flag anything not done; do not block the build on it.

Constraints (unchanged): voice prompt CONTENT is Brendan's only - report issues, never edit Retell or repo prompt files. Deploy edge fns with `SUPABASE_PAT=… node scripts/deploy_single_fn.mjs <slug>` (or deploy_with_shared.mjs); new functions need verify_jwt=false. Migrations via the Management API SQL runner + a committed .sql file. Trigger.dev via `npx trigger.dev@4.4.4 deploy` (TRIGGER_DEPLOY_PAT, proj_fdozaybvhgxnzopabtse, env prod). Multi-DB app so surgical types.ts only. Verify each stage (tsc + deploy + a server-side check) then hand Brendan a UI smoke list. Commit + push per chunk. No em dashes. Propose a staged plan and get approval before anything structural.

=== PRIORITY 0 - CRITICAL PATH: voice publish is broken (nothing voice goes live until this ships) ===
Retell RENAMED the publish endpoint and made `version` mandatory; retell-proxy still calls the old one, so every voice Save creates a draft that NEVER publishes and the phone keeps serving the old version. Brendan pasted all 5 rewrites (Main Outbound + 4 Garys) into the doc bodies but they are STUCK AS DRAFTS.
- Fix frontend/supabase/functions/retell-proxy/index.ts: change all 8 publish sites (lines 909, 939, 994, 1188, 1242, 1512, 1831, 2004) from `POST publish-agent/${agentId}` (no body) to `POST publish-agent-version/${agentId}` with body `{ version: <draftVersion> }` (version REQUIRED; optional version_description). Source the draft version from the update-agent PATCH response (currently discarded at :906) or GET get-agent right before publish. Centralize into one helper.
- Keep repointPhoneVersionsAfterPublish (244-358) as-is; it already repins inbound+outbound weighted lists, it just never runs because publish throws first.
- Redeploy retell-proxy. VERIFY: Save a setter -> GET get-agent-versions shows the new version is_published=true and the BYO phone (+61481614530) inbound/outbound pins move to it. Then Brendan re-Saves all 5 setters and sends a call_id; verify version-repoint + latency/token profile.

=== P1 - Voice booking architecture collapse (Brendan-decided: booking lives in the MAIN body, matching Retell's main-prompt/functions/settings model) ===
Stop the separate `## BOOKING INSTRUCTIONS` append so the OLD booking_prompt (carrying phantom get_contact x5 + ~10 slot-refs) stops double-appending. In PromptManagement.tsx the append is gated at 6377-6378 and 6706-6707 on `booking_function_enabled && booking_prompt`. Disable it for the 5 BFD voice setters (clear booking_prompt / set booking_function_enabled=false in agentSettings, or remove the append path). Booking now lives in doc_content. Verify the assembled general_prompt has 0 get_contact + 0 editable slot-refs after a push.

=== P1 - Voice doc-page UI bugs (blocked Brendan this session) ===
- PromptDocPage.tsx:407 renders <VoiceRetellSettings> WITHOUT advancedExpanded/onAdvancedExpandedChange, so "Expand Advanced Settings" is a silent no-op (optional-chained handler, VoiceRetellSettings:1163). Wire local advancedExpanded state, mirroring AgentConfigBuilder.tsx:4244-4245.
- PromptDocPage.tsx:413 "Open full settings view" -> onOpenSettings -> setCurrentView('settings') renders the "Modify with AI" meta-prompt editor (PromptManagement.tsx:7915), NOT agent settings. Relabel it ("Modify-with-AI instructions") or repoint to the real settings view.

=== P1 - Credentials page cleanup + auto-surfacing webhook manifest (NEW, the big one) ===
Brendan: the Credentials page still shows dead n8n/lead-connector webhooks, and the webhooks that must be PASTED INTO HIGHLEVEL aren't surfaced anywhere. Two halves:

(A) CLEAN UP frontend/src/pages/ApiCredentials.tsx (page reads/writes clients directly via useClientCredentials):
- Remove dead WEBHOOK_FIELDS entries (26-36) + the never-rendered ApiSettings columns (238-250) + their useEffect sync (475-487), proven to have NO current reader: analytics_webhook_url, ai_chat_webhook_url, chat_analytics_webhook_url, campaign_webhook_url, prompt_webhook_url, knowledge_base_webhook_url, knowledge_base_add_webhook_url, update_pipeline_webhook_url, database_reactivation_inbound_webhook_url, and the twilio_* trio (managed elsewhere; keep the DB columns, just drop from this file's state/types).
- Rename the "n8n Connections" card (1137-1172) -> "Simulation": its only field is simulation_webhook, still read by run-simulation (index.ts:60,287). Delete the card only if the simulator is being retired.
- api_webhook_url cred-mirror (sendToApiCredentialsWebhook, 376-420): legacy n8n cred fan-out, nothing native reads it - confirm with Brendan, then remove.
- KEEP the GHL outbound webhook fields (ghl_send_setter_reply_webhook_url, send_message_webhook_url, send_followup_webhook_url, send_engagement_webhook_url, stop_bot_webhook_url): the native Trigger engine still POSTs to them (processMessages/sendFollowup/etc). Note send_engagement SMS is now native Twilio but WhatsApp still uses it.

(B) AUTO-SURFACE the INBOUND webhook manifest (the "copy these into HighLevel" list). None are surfaced today; they live only in the SOP.
- New edge fn `webhook-manifest` (POST {clientId}, authorize via _shared/authorize-client-request.ts, verify_jwt=false): load the clients row; GENERATE any missing ghl_webhook_secret + intake_lead_secret and persist (idempotent, fills NULLs only) so a URL is never shown live-but-forgeable; do NOT generate retell_webhook_secret (see P2 sig bug). Return entries: { key, label, url, method, headers[], destination, sopRef, lastReceivedAt }.
- URLs are COMPUTED: base (frontend has VITE_SUPABASE_PROJECT_ID; edge fn has SUPABASE_URL) + slug + a query param ONLY for handlers that need it. Tenant otherwise resolves from the POST body.
- Manifest entries + destinations (from the inventory):
  * GHL-bound (paste into GoHighLevel -> Workflows -> Custom Webhook action), header `x-wh-token: <ghl_webhook_secret>`, `Content-Type: application/json`: sync-ghl-contact (?clientId, main lead ingress; body GHL_Account_ID+Lead_ID), ghl-tag-webhook (Contact Tag added trigger), bookings-webhook (Calendar Appt Created/Updated/Cancelled), sync-ghl-booking (?GHL_Account_ID), workflow-inbound-webhook (?workflow_id=&client_id=, STRICT auth once secret set), receive-dm-webhook (?GHL_Account_ID=&Lead_ID=&Message_Body=&Name=&Phone=&Email=&Setter_Number=), campaign-enroll-webhook (?token=, optional per-campaign).
  * Retell (set in Retell dashboard, not GHL): retell-inbound-webhook = each BYO phone's inbound_webhook_url (phone-level); retell-call-webhook + retell-call-analysis-webhook = the agent's webhook_url (agent-level). Tenant via agent_id. (retell_webhook_secret stays BLANK until P2.)
  * Twilio: receive-twilio-sms = Phone Number -> Messaging -> "A message comes in" (auto-set by the existing twilio-configure-webhook button; surface read-only); twilio-status-webhook is self-wired (no step).
  * Unipile: unipile-webhook?client_id=<id>.
  * Web form / intake: intake-lead, `Authorization: Bearer <intake_lead_secret>`, clientId in body (currently the secret is never shown in the UI - surface it).
- New WebhookManifestCard on the page Brendan is looking at (ApiCredentials.tsx; unify with the legacy ApiManagement.tsx "Webhook Security" card at 1330-1401 - do not duplicate): rows grouped by destination, each with a destination label ("put this here in HighLevel / Retell / Twilio / Unipile"), Copy buttons for URL + token (Copy icon already imported), a status pill (red "secret missing / forgeable" -> green "secured"), and a per-row Verify. Verify uses a passive "last received" signal from server tables (sync_ghl_executions, message_queue, call_history, etc - highest signal: proves the operator actually pasted it) and an active probe only for idempotent handlers. Reuse CredentialVerifyCard + the verify-credentials edge fn for the OUTBOUND half; the manifest adds the INBOUND half. Add a ConfigStatusBar-style go-live readiness strip that gates the auto_engagement_workflow_id flip (SOP 8.1) until every required inbound webhook is secured + verified.
- Close the failure windows: generate ghl_webhook_secret + intake_lead_secret at client-create (Onboarding.tsx already mints intake_lead_secret; mirror for ghl); surface intake_lead_secret; add the (currently nonexistent) inbound verification; then update CLIENT_ONBOARDING_SOP.md 5.x from "hand-build the URL + paste" to "read the row -> Copy -> paste into the named screen -> Verify". Flag (report-only) that sync-ghl-contact ingress currently sends no x-wh-token even when the secret is set (SOP line 502) - the manifest must emit the header and the SOP step must be updated.
- ALSO close F7 here (security, User Todos.md ~282): the page reads `clients` directly via useClientCredentials, shipping secret columns (API keys, webhook secrets) to the browser. The manifest moves to a server edge fn anyway; while reworking the page, restrict the frontend `clients` select to non-secret columns and serve secrets/tokens only through the authorized webhook-manifest / verify fns.

=== P2 - Webhook signature verify rewrite (Retell CONFIRMED broken, Unipile suspect) - BLOCKS arming secrets ===
verifyRetellSignature (retell-call-webhook:13, retell-call-analysis-webhook:17, retell-inbound-webhook:26) computes HMAC(body,secret) + strips `sha256=`, but Retell really sends `X-Retell-Signature: v={ts},d=HMAC(body+ts, API_KEY)` with a 5-min window. Storing retell_webhook_secret today 403s ALL Retell webhooks. Rewrite to parse v=,d=, recompute HMAC(body+ts, key), enforce 5-min, constant-time compare; the secret value = the Retell API key. Confirm Unipile's real scheme (verifyUnipileSignature is the same generic HMAC; Unipile typically uses a STATIC custom header -> switch to an x-wh-token style check like GHL). Until fixed, webhook-manifest must mark Retell-secret rows "leave blank / verification not yet supported".

=== P2 - Analytics gaps (compute-analytics) ===
- Surface recording_url / public_log_url per call so "Call Recordings & Transcripts" stops showing 0 CALLS (Brendan explicitly requested). The function returns conversations_list (messages) but not the recordings shape the table reads (currentWebhookData["Transcript & Recording URL"]).
- Fix the "New User Messages" custom metric N/A: it collides with builtinMetricNames (compute-analytics:501-508) so it's excluded from the LLM path but never produced as a default. Either drop it from that set or define it as a real default.

=== P2 - Probe go-green (intake-lead is_system bypass) ===
PROBE_* env is already set in Trigger prod, but the probe 409s at intake-lead:286 ("Client has no GHL credentials configured"). Add an is_system bypass mirroring the B3 verify-only runEngagement pattern: for is_system clients skip GHL contact create/find, synthesize a lead_id, write the engagement_executions row, return execution_id. Critical real-lead ingress path - do it carefully. Then the hourly canary completes (outcomes in public.probe_results).

=== P2 - Probe ChatAnalytics hang ===
Probe direct URL -> analytics/chatbot/dashboard stuck on RetroLoader (ChatAnalytics.tsx:2676) on the zero-data/zero-config client path, plus an error-path navigate('/client/:id') redirect loop (:1222). Add an empty state + remove the loop. Also protects brand-new clients.

=== P3 - GATED on Brendan's live tests (do only after he confirms) ===
- Retire the legacy outbound direction columns + inbound-only directions UI (after the outbound repoint + live call on 40e8bea3 passes). Rearch (a): kill DIRECTION_TO_AGENT_COLUMN + retell_*_agent_id, move direction ownership onto voice_setters. High blast radius - plan first.
- CF fleet rollout tooling + the retell-proxy single-prompt/CF engine-adapter refactor (rearch b), only after the CF pilot passes its A/B gate (booking rate >= control, no llm_token_surcharge line, llm p50 < 900ms).

=== P3 - UNGATED backlog (pick with Brendan) ===
- Account-access restructure (project_account_access_restructure_idea): My Account = client self-serve with admin-governed fields; admin-only config moves under Manage Sub-Accounts per sub-account, like the client-menu control. Design first.
- Schema-drift reconcile: the 6 referenced-but-missing tables (messages, payment_attempts, simulation_analysis_messages, supabase_usage_cache, sync_ghl_executions, sync_ghl_booking_executions) + engagement_executions.ghl_contact_id not renamed to lead_id. Investigate each before touching.
- N5 stale-template cleanup: keep-or-kill the legacy n8n/Retell-agent JSON templates in frontend/public/* (old n8n + railway hosts, deleted llm_22e795 id) + orphan/_archived Webinar components. Report first, edit only approved.
- Review polish: cost-ceiling breach-log throttle, orphaned-UUID badge in the voice-setter picker, B6 success_rate -> is_successful_call rename, inbound-webhook observability log.
- HIBP on Supabase Pro (project_deferred_hibp_on_pro_upgrade): once Brendan upgrades, PATCH config/auth password_hibp_enabled=true.
- Twilio AU regulatory bundle + client number-acquisition model decision (project_twilio_au_number_acquisition_and_bundle): document in the onboarding SOP (BYO-Twilio-per-client recommended).
- Roadmap section 7 as Brendan calls them: A/B 3.1 (research brief FIRST), multi-workflow enrollment state machine 3.5, long-tail nurture 3.6, behavioral re-warm 3.7, tz-aware nudge cron 3.10, D5 custom SMTP once Resend is picked. Also open in the catalogue but not yet picked: roadmap 2.3 per-setter phone-binding UI for voice setters 4-10 (you-did-a-really-cozy-summit.md ~143), roadmap 2.6 cost-per-booking analytics dashboard (schema/view exist, no chart; gated on 60+ days data).
- Security/cleanup residuals (User Todos.md security section): F10 - rotate the anon key / old project ref `awzlcmdomhtyqjabzvnn` baked into ~5 old cron migrations if that project is still live. VC1 - confirm `active_call_id` is nulled on the retell-call-analysis-webhook cancel path (lines ~761-840); A0/Tier-2 closed the stop-engagement + sequence_complete paths but not this one (verify-then-close; fold into the schema-drift pass). VC3 - pick a canonical voice-coordination path and document/retire the other: retell-call-webhook `last_call_outcome` polling vs retell-call-analysis-webhook `treat_pickup_as_reply` (live BFD uses the analysis webhook, so last_call_outcome/active_call_id are vestigial on the live path).
- Optional latency tune (V4, Brendan-decided): ~2 min text-reply delay = 60s intentional debounce + ~70s gemini gen; consider lowering `clients.debounce_seconds` to 20-30s for snappier replies.

=== RESEARCH (not build) - when Brendan says ===
The A/B testing research brief (carry over from the prior kickoff). Spin up sub-agents, produce a report, do not build.

=== Brendan-side, report-only (he applies; never auto-edit prompt content) ===
- T10b inbound "ask for details" drop (project_pending_prompt_changes), folded into the same prompt session as the 5 rewrites.
- Mortgage Gary persona contradiction (mortgage broker vs BFD AI-setter - pick one, trim the other half).
- Property Gary placeholder company name + AI-setter-vs-property-coaching example theme mismatch.
- V6 (User Todos.md ~260): agents have offered a weekend slot the calendar (Mon-Fri) never returned - add a prompt constraint to only offer slots returned by get-available-slots / the pre-loaded availability.
```

## (end of prompt)
