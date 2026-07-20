> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---
# BFD-setter — Full System + Security Audit (2026-06-10)

Method: 9 specialist auditors (security/IDOR, webhook-ingress, secrets-exposure, cadence-correctness, edge-correctness, data-schema, reliability, dependencies, features) fanned out across the whole codebase, then every finding adversarially verified by an independent agent. **80 raised → 62 confirmed real, 18 rejected** as false-positive or already-known.

Severity: high 14 · medium 26 · low 22. Owner: Claude/code 57 · Brendan/ops 5. (A few code fixes still need a Brendan decision or deploy.)

> **Not yet deployed:** this audit reflects code on disk. The CA1-CA8 fixes from the prior session are also not yet deployed.

> **Update 2026-06-10 (later session):** the first audit-fix wave (CA1-CA8 + security/RLS/data-integrity/cadence, see handoff) deployed live earlier today. A second wave then closed the four remaining Claude task groups, all deployed:
> - **DI-4 / §6 lead-file schema:** `lead_ai_columns`, `lead_ai_values`, `lead_tags`, `lead_tag_assignments`, `client_custom_fields` + `leads.{business_name,custom_fields,phone_valid,tags}` created on the platform DB with F6-pattern RLS (`20260610130000`). Drift guard down from 11 missing tables to 6 (messages, payment_attempts, simulation_analysis_messages, supabase_usage_cache, sync_ghl_executions, sync_ghl_booking_executions remain open).
> - **§6 webhook-secret UI:** ApiManagement "Webhook Security" card (ghl/retell/unipile secrets) shipped — BR3 unblocked.
> - **WI-1 + SEC-09:** x-wh-token static-token auth rolled to all 5 remaining GHL handlers; workflow-inbound-webhook now strict; RUNBOOK's dangerous native-Webhook-V2 instructions replaced. DEP pins: supabase-js `2.101.0` across all 84 edge-fn imports; react-router-dom 6.30.4 + vite 5.4.21 via npm audit fix (esbuild dev-server advisory deferred: needs breaking vite major).
> - **CAD-01/CAD-02/REL-01/REL-04/REL-06 + REL-03 repair:** call-path idempotency (`call_history.idempotency_key` `20260610140000` + edge-fn dedup guard + Trigger-native idempotencyKey), AbortTaskRunError on permanent Retell 4xx, campaign_events send-markers w/ per-channel replay skip, active_call_id cleared on wait-exit, error_logs coverage in retell-call-webhook + receive-twilio-sms. NOTE: the REL-03 fix shipped in the first wave was inert (inserted non-existent `message`/`raw_payload` columns) — repaired in this wave.

---

## 1. Brendan action items (owner = Brendan — I cannot do these)

### 🟠 Frontend pulls client secret columns (service keys, Twilio auth tokens, API keys) into the browser via direct .select()
- **Severity/Category:** high / security
- **Location:** `frontend/src/pages/ApiManagement.tsx:338; pages/PromptManagement.tsx:5336; components/SetupGuideDialog.tsx:658; components/RetellPhoneNumbersTab.tsx:62; components/RetellPhoneNumberSelector.tsx:146; components/EmbeddedPromptChat.tsx:179; plus ~20 more`
- **Problem:** Numerous frontend components select secret columns from the clients table straight into the browser: supabase_service_key (full service-role key to each client's external Supabase), twilio_account_sid/twilio_auth_token, openrouter_api_key, openai_api_key, retell_api_key, ghl_api_key. Because Postgres RLS is row-level (not column-level) and the clients policy permits reading any row in the user's agency, every secret column of every client in an agency is retrievable by any agency user (and exposed in browser memory / network tab / any XSS). This is the known F7 residual; reporting it as still-open and quantifying the surface, plus flagging cases that pull secrets they never use.
- **Fix:** Architectural (Brendan-owned): stop returning secret columns to the browser. Move all calls that need a client service key / Twilio token / provider API key behind an edge function (the service-role functions already do this for most flows). As an interim, change presence-only checks (RetellPhoneNumbersTab, RetellPhoneNumberSelector) to select a computed boolean / non-secret column instead of the raw token, and consider a Postgres column-privilege GRANT or a clients_public view that omits secret columns for the anon/authenticated roles.

### 🟡 process-lead-file references 4 tables that do not exist in the platform DB (lead_ai_columns, lead_ai_values, lead_tags, lead_tag_assignments)
- **Severity/Category:** medium / data-integrity
- **Location:** `frontend/supabase/functions/process-lead-file/index.ts:608,629,746,757,776,796`
- **Problem:** process-lead-file runs against the platform service client (serviceClient passed into processImportJob/processExportJob) and reads/writes lead_ai_columns, lead_ai_values, lead_tags, lead_tag_assignments. None of these tables exist in the platform DB. fetchLeadAIColumns (line 608, called on the EXPORT path at 510) does `if (error) throw error`, so every CSV export job fails. syncImportTagsAndCustomFields writes lead_tags/lead_tag_assignments with `if (error) throw error` (line 776/796), so any IMPORT that assigns tags fails the whole job.
- **Fix:** Decide whether the tag/AI-column import-export feature is in scope for the platform tenant. If yes, create lead_tags, lead_tag_assignments (with UNIQUE(lead_id, tag_id) for the onConflict at :796), lead_ai_columns, lead_ai_values in the platform DB and commit migrations. If no, guard these reads/writes so a missing table degrades gracefully instead of throwing (wrap in try/catch or feature-flag). owner=brendan for the feature/DDL decision; Claude can implement either path.

### 🟡 Inbound state-mutating webhooks remain fully unauthenticated until per-client secrets are provisioned (0/N clients today)
- **Severity/Category:** medium / security
- **Location:** `frontend/supabase/functions/sync-ghl-contact/index.ts:330; sync-ghl-booking/index.ts:530; receive-dm-webhook/index.ts:381; bookings-webhook/index.ts:180; ghl-tag-webhook/index.ts:554; retell-call-webhook/index.ts:110; unipile-webhook/index.ts:76; workflow-inbound-webhook/index.ts:104`
- **Problem:** Every verify-if-present handler is inert until clients.<provider>_webhook_secret is set, and per the session context 0 clients have secrets (BR3 = Brendan provisions). Until then, these endpoints accept forged POSTs that create/modify leads, create bookings, enrol leads into cadences (which place billable Retell calls + SMS), stamp call outcomes, and bind integrations — all with only knowledge of non-secret identifiers (GHL_Account_ID/locationId, agent_id, contactId, bookingId, client_id). This is the known residual carried from the prior security review, restated here because it is the dominant ingress-integrity risk: the protection exists in code but is switched off everywhere in production.
- **Fix:** Provision the webhook secrets (BR3) AND configure each upstream to actually send the signature — but FIRST resolve WI-1 so the chosen GHL signing mechanism matches the verification code, otherwise provisioning will 403 real traffic. Until secrets are live, treat these endpoints as public and rely on idempotency/dedup guards; consider an interim shared static-header token check for the highest-impact money-spending paths (lead enrol, voice-booking-tools).

### 🟢 frontend/src/integrations/supabase/types.ts reflects the dev DB, not the platform DB (~100 tables vs 62) -> type-checked code can reference columns/tables that 42703/PGRST205 at runtime
- **Severity/Category:** low / config
- **Location:** `frontend/src/integrations/supabase/types.ts (whole file); affects all edge functions importing Database types implicitly`
- **Problem:** types.ts declares ~100+ tables including lead_ai_columns, lead_ai_values, lead_tags, lead_tag_assignments, lead_notes, client_custom_fields, client_portals, campaign_leads and many client/leads columns (business_name, custom_fields, sync_ghl_booking_enabled, stripe_* on clients) that do NOT exist in the live platform DB. Because tsc passes against these types, schema-drift bugs (DI-1..DI-9) are invisible at compile time and only surface as 42703/PGRST205 at runtime. This is the root enabler of the whole drift class.
- **Fix:** Do NOT wholesale-regenerate (known to explode). Instead establish a lightweight CI guard: a small script that runs the same information_schema.columns / pg_index query against the platform DB and diffs it against the column/table names referenced by `.from()`/`.select()`/`onConflict` in functions+trigger, failing the build on drift. This catches DI-1..DI-9-class bugs going forward. Short-term, fix the concrete drift items above. owner=brendan to decide the multi-DB type strategy; Claude can write the CI drift-check script.

### 🟢 Dead deploy script and .env.example propagate a deleted Retell LLM/agent id
- **Severity/Category:** low / config
- **Location:** `scripts/deploy_voice_prompt.mjs:20-21; .env.example:37-38`
- **Problem:** scripts/deploy_voice_prompt.mjs hardcodes fallbacks BFD_RETELL_LLM_ID='llm_22e795de19b4d25cb579013586be' and BFD_RETELL_AGENT_ID='agent_5ec5eb129f3165cfa07b581a1a' (the script's own header notes both are STALE / no longer exist). .env.example lines 37-38 ship the same dead llm/agent ids as defaults. Per the project rule, voice prompts are managed only through the BFD setter UI and this script must never run; keeping a runnable script that PATCHes a Retell LLM (with a dead-id fallback that would silently target the wrong thing if BFD_RETELL_LLM_ID were ever set wrong) is a footgun and the .env.example seeds the dead value into new clones.
- **Fix:** Decision for Brendan (report-only per voice-prompt rule): either move scripts/deploy_voice_prompt.mjs to scripts/archive/ (alongside the other retired voice scripts) or delete it, and remove/blank the dead llm/agent defaults in .env.example so new clones don't inherit a non-existent id. Do not edit the live prompt.

## 2. Security & IDOR (owner = Claude)

### 🟠 compute-analytics: unauthenticated, trusts caller-supplied client Supabase URL + service key and cross-tenant client_id
- **Severity/Category:** high / security
- **Location:** `frontend/supabase/functions/compute-analytics/index.ts:561-662 (config.toml:72-73 verify_jwt=false)`
- **Problem:** compute-analytics performs ZERO authentication or ownership verification. It reads client_supabase_url, client_supabase_service_key and client_id directly from the POST body (lines 571-575) and then (a) connects to that external Supabase with the caller-supplied service key to fetch/paginate ALL chat_history (fetchConversations, lines 255-318), and (b) inserts analytics_results keyed by the caller-supplied client_id using the platform service-role client (line 655). Deployed verify_jwt=false, so it is reachable with only the public anon key.
- **Fix:** Add authorizeClientRequest(req.headers.get('Authorization'), client_id) at the top of the handler. Do NOT trust client_supabase_url/client_supabase_service_key from the body: after authorizing, look them up from the clients row for the verified client_id (as fetch-thread-previews does at lines 73-86). This both closes the IDOR and removes the arbitrary-credential relay.

### 🟠 trigger-engagement: unauthenticated enrollment of arbitrary tenants into engagement campaigns (fires outbound SMS/calls)
- **Severity/Category:** high / security
- **Location:** `frontend/supabase/functions/trigger-engagement/index.ts:28-291`
- **Problem:** trigger-engagement takes client_id (or ghl_account_id) and lead_id/campaign_id from the body with no caller authorization, uses the platform service-role client, cancels any existing engagement_executions for that contact, inserts a new engagement_execution, and fires a Trigger.dev run-engagement task. This drives real outbound SMS and Retell calls. Any party with the anon key can enroll arbitrary leads into any client's campaign or cancel another tenant's running engagements.
- **Fix:** Gate with authorizeClientRequest(authHeader, client_id) before any DB write. Internal callers (Trigger tasks, other edge fns) present the service-role bearer and pass automatically; the UI presents the user JWT and is ownership-checked. Resolve client_id from ghl_account_id only AFTER authorizing, or require client_id.

### 🟠 workflow-execute: unauthenticated triggering of any tenant's workflows
- **Severity/Category:** high / security
- **Location:** `frontend/supabase/functions/workflow-execute/index.ts:10-160`
- **Problem:** workflow-execute accepts client_id (and optional workflow_id) from the body, has no auth, and with the service-role client selects that client's workflows, inserts workflow_executions, and fires Trigger.dev execute-workflow tasks. Any caller with the anon key can enumerate workflow/client UUIDs and execute another tenant's automations.
- **Fix:** Add authorizeClientRequest(req.headers.get('Authorization'), client_id) before the workflows query. If this is meant to be triggered by another edge function, that caller already presents the service-role key and will pass the dual-mode check.

### 🟠 push-engagement-now: unauthenticated, acts on any tenant's engagement_execution by id
- **Severity/Category:** high / security
- **Location:** `frontend/supabase/functions/push-engagement-now/index.ts:14-181`
- **Problem:** Takes execution_id from the body with no auth, loads the engagement_execution via service role (no client scoping), cancels its Trigger.dev run, fetches the owning client's send_engagement_webhook_url, and re-fires run-engagement from the next node. The caller never proves ownership of the execution's client_id, so any anon-key holder can disrupt or replay another tenant's outbound sequence by guessing/enumerating execution UUIDs.
- **Fix:** After loading the execution, call authorizeClientRequest(req.headers.get('Authorization'), execution.client_id) before any cancel/re-trigger/update. Internal callers pass via the service-role bearer.

### 🟠 retry-dm-execution: unauthenticated, replays any tenant's DM execution by id
- **Severity/Category:** high / security
- **Location:** `frontend/supabase/functions/retry-dm-execution/index.ts:14-204`
- **Problem:** Takes execution_id from the body, no auth, loads the dm_execution via service role, then resolves the owning client by ghl_account_id, inserts message_queue/dm_executions/active_trigger_runs rows and fires the process-messages Trigger.dev task. No ownership check on the caller, so any anon-key holder can replay another tenant's DM (re-sending messages to that tenant's leads) by enumerating execution UUIDs.
- **Fix:** Resolve client_id from execution.ghl_account_id first, then authorizeClientRequest(authHeader, clientId) before any write/trigger. Reject if the ghl_account_id maps to no client the caller owns.

### 🟠 Permissive USING(true) RLS policies on prompt_versions and setter_ai_reports expose prompt content cross-tenant (F6 fix missed siblings)
- **Severity/Category:** high / security
- **Location:** `frontend/supabase/migrations/20260422130000_bfd_platform_save_setter_final_gaps.sql:79 (prompt_versions), :104 (setter_ai_reports)`
- **Problem:** The 2026-06-05 F6 security migration tightened prompt_chat_threads/prompt_chat_messages to agency-scoped RLS but left the sibling tables prompt_versions and setter_ai_reports with permissive policies. Both tables are read AND written directly from the browser using the publishable/anon key (so RLS is the only tenant boundary), yet each carries a policy that grants every authenticated user full access to every tenant's rows. The clients table itself is correctly agency-scoped, so this is a real cross-agency leak of prompt-builder content and AI setter reports.
- **Fix:** Add a migration that DROPs the permissive policies by their exact names (prompt_versions_all_authenticated, setter_ai_reports_all_authenticated) on the platform DB, mirroring the F6 pattern, so only the agency/client-scoped policies remain. Audit all other tables touched by 20260422130000 / 20260422120000 for the same all_authenticated using(true) pattern.

### 🟠 presentation_chat_threads / presentation_chat_messages have a USING(true) policy with NO role clause (anon-accessible, cross-tenant)
- **Severity/Category:** high / security
- **Location:** `frontend/supabase/migrations/20260303155118_8b0a8cd8-3495-4e62-afee-33c646ab3ab8.sql:41 and :56`
- **Problem:** These two tables originally had agency-scoped EXISTS(...) policies (20251215155108). A later migration added `CREATE POLICY ... FOR ALL USING (true) WITH CHECK (true)` with NO `TO authenticated` clause, which defaults to the `public` role and therefore includes the unauthenticated `anon` role used by the browser publishable key. Combined with the still-present scoped policies (OR semantics), the result is that any caller holding the public anon key can read and write every tenant's presentation chat threads/messages. This is broader than SEC-RLS-01 because it does not even require a login. F6 did not touch these tables.
- **Fix:** Drop the two permissive presentation_chat policies (by name) so only the agency-scoped EXISTS policies remain. Add a CI/grep guard that fails on any `FOR ALL USING (true)` policy lacking a tenant predicate. Confirm against the live platform DB which policies are actually present (pg_policies) since this depends on migration apply order.

### 🟡 push-followup-now: unauthenticated, acts on any tenant's followup_timer by id
- **Severity/Category:** medium / security
- **Location:** `frontend/supabase/functions/push-followup-now/index.ts:14-127`
- **Problem:** Takes timer_id from the body, no auth, loads the followup_timer via service role with no client scoping, cancels its Trigger.dev run and re-fires send-followup. The timer carries client_id but it is never checked against the caller, so any anon-key holder can replay/disrupt another tenant's followups.
- **Fix:** After loading the timer, authorizeClientRequest(authHeader, timer.client_id) before cancel/re-trigger/update.

### 🟡 refresh-usage-cache: world-reachable, no auth, reads every client's keys and calls external billing APIs
- **Severity/Category:** medium / security
- **Location:** `frontend/supabase/functions/refresh-usage-cache/index.ts:228-275`
- **Problem:** refresh-usage-cache has no authentication. With the service role it loads ALL clients including openrouter_api_key, openrouter_management_key, supabase_url and supabase_access_token, then makes outbound calls to OpenRouter and the Supabase Management API for every tenant and upserts cache rows. Intended as a cron job, but because it is verify_jwt=false and unauthenticated, any anon-key holder can repeatedly invoke it (resource amplification / cost-DoS against every tenant's billing endpoints; also a useful oracle to trigger fan-out activity).
- **Fix:** Require the service-role bearer (this is server/cron-only): early-return 401 unless the Authorization bearer equals SUPABASE_SERVICE_ROLE_KEY (or passes grantsServiceRole). The cron invoker already uses the service-role key.

### 🟡 workflow-inbound-webhook accepts unsigned POSTs even when the client has a webhook secret (secret-set-but-no-header = accept)
- **Severity/Category:** medium / security
- **Location:** `frontend/supabase/functions/workflow-inbound-webhook/index.ts:90-116`
- **Problem:** Unlike the other CA1 handlers (which 403 when the secret is set but the signature header is missing), workflow-inbound-webhook only rejects when BOTH a secret AND a signature header are present and they mismatch. If the secret is set but no x-wh-signature header is sent, it logs a warning and ACCEPTS the request. This means an attacker can bypass verification entirely on a 'secured' client simply by omitting the signature header — the endpoint then stores the request and fires a Trigger.dev execute-workflow run (spends compute / can drive downstream actions) fully unauthenticated. The inline comment acknowledges this and tells Brendan to change the warn branch to a 403 if he wants it strict.
- **Fix:** This endpoint dual-serves GHL (signed) and internal client_id callers (unsigned), so a blanket 403 would break the internal path. Split the trust model: require a signature for GHL-shaped calls, and require a service-role/JWT bearer (authorizeClientRequest) for the client_id-direct path. Do not allow 'secret set + no header' to silently pass. At minimum gate the Trigger.dev fan-out behind one of the two proofs.

### 🟡 voice-booking-tools places GHL bookings and sends billable Twilio SMS while unauthenticated when intake_lead_secret is unset
- **Severity/Category:** medium / security
- **Location:** `frontend/supabase/functions/voice-booking-tools/index.ts:107-127,705-815`
- **Problem:** voice-booking-tools authenticates only with a per-client bearer (clients.intake_lead_secret) and ONLY when that secret is set (resolveClient lines 116-125). When intake_lead_secret is null (the backwards-compat / dev default), ANY caller who knows a clientId (a UUID passed in the ?clientId= query param) can invoke money/state-spending tools: send-sms (places a billable Twilio message to an arbitrary phone via the client's twilio creds), book-appointments / update-appointment / cancel-appointments (mutate the client's GHL calendar), schedule-callback (queues a billable outbound Retell call), and resolveContactId can CREATE GHL contacts. clientId is not a secret (it appears in the URL of the agent's tool config and any logged request), so absence of the secret = fully open money-spending + calendar-mutating endpoint.
- **Fix:** Treat intake_lead_secret as MANDATORY for any client whose Retell agents call voice-booking-tools, and verify it is set during onboarding (fail the readiness check if a client has live voice tools but a null secret). Optionally make the code fail-closed: if a money/state-mutating tool is requested and intake_lead_secret is null, return 401 rather than executing. Per the no-prompt-edit rule, do not change the agent tool config yourself — flag for Brendan to provision the secret and confirm the Retell tool sends the bearer.

### 🟡 campaign-enroll-webhook is authenticated only by a token in the URL query string and creates leads + fires billable engagement runs
- **Severity/Category:** medium / security
- **Location:** `frontend/supabase/functions/campaign-enroll-webhook/index.ts:17-61,243-260`
- **Problem:** This public endpoint authenticates purely on enroll_webhook_token (accepted from ?token= or body.token) which selects the campaign and its client_id. There is no HMAC, no replay protection, and no rate limiting. Anyone who learns the token (it travels in URLs, GHL workflow configs, server logs, browser history) can repeatedly POST arbitrary name/phone/email to create leads in that client and fire trigger-engagement runs — each of which can place outbound Retell calls and send SMS (spends money). Unlike intake-lead (which requires a Bearer secret AND a clientId), the only proof here is a bearer-equivalent token placed in the query string, which is far more leak-prone than an Authorization header.
- **Fix:** Move the token to an Authorization: Bearer header (or add an HMAC header) so it stops appearing in URLs/logs, and add a per-token rate limit / dedup window (mirror ghl-tag-webhook's 5-minute phone-dedup) to cap forged enrolments. Long term, align this path with intake-lead's bearer+clientId model. At minimum document the token as a billing-sensitive secret.

### 🟡 contact_tags and contact_tag_assignments are readable/writable by any authenticated user across all tenants
- **Severity/Category:** medium / security
- **Location:** `frontend/supabase/migrations/20260305195941_47ac7579-f6d6-4d68-9202-c425ceb9fbc6.sql:21-22`
- **Problem:** Both tables have a single policy `FOR ALL TO authenticated USING (true) WITH CHECK (true)` with no client/agency predicate. Any logged-in user in any agency can read, insert, update, and delete every other tenant's contact tags and tag assignments. Lower severity than the prompt tables because tag labels are less sensitive than prompt content/PII, but it is still a cross-tenant write primitive (an attacker could mass-delete or re-tag another tenant's contacts).
- **Fix:** Replace with client_id-scoped policies (contact_tags has client_id; contact_tag_assignments can scope via its tag/contact FK to a tenant-owned row), mirroring the clients-table agency predicate.

### 🟢 intake-lead / kb-ingest / voice-booking-tools authenticate only IF intake_lead_secret is set, and 0 clients have one
- **Severity/Category:** low / security
- **Location:** `frontend/supabase/functions/kb-ingest/index.ts:94-99; voice-booking-tools/index.ts:117-125; intake-lead/index.ts (header auth block)`
- **Problem:** These three functions use the per-client clients.intake_lead_secret shared-secret model, but the auth check is conditional: when intake_lead_secret is null/empty the entire bearer check is skipped (fail-open) and the request proceeds with the platform service role and the client's own GHL/external-Supabase credentials. Per known session notes 0 clients currently have provider/intake secrets provisioned, so today these endpoints are effectively unauthenticated for caller-supplied clientId: an attacker can ingest KB documents into a tenant's external Supabase (kb-ingest), create GHL contacts + leads + fire engagement (intake-lead), or read/book/cancel GHL appointments for that tenant (voice-booking-tools).
- **Fix:** Provision intake_lead_secret for every client (BR3-class ops). Code-side (claude): make the secret mandatory for these endpoints, or fail-closed when missing (return 401 rather than proceeding) once provisioning is complete, so a forgotten secret cannot silently open a tenant.

### 🟢 push-engagement-now builds a PostgREST .or() filter from an unvalidated DB string (ghl_contact_id)
- **Severity/Category:** low / security
- **Location:** `frontend/supabase/functions/push-engagement-now/index.ts:101`
- **Problem:** push-engagement-now interpolates execution.ghl_contact_id directly into a PostgREST .or() filter string. The value comes from the engagement_executions row (DB), not directly from the request, so it is second-order rather than directly attacker-controlled; but engagement_executions.ghl_contact_id is itself populated from caller-supplied Lead_ID values via trigger-engagement (which has no input validation), so a crafted Lead_ID containing PostgREST filter syntax (commas, dots, .eq.) could later alter this query's logic. Low severity because the surrounding IDOR is the dominant issue and the field is a contact id, but it is the one interpolated filter in the codebase.
- **Fix:** Validate/encode ghl_contact_id before interpolation (e.g. reject values containing PostgREST metacharacters, or use two separate .eq() queries / .in() instead of a string-built .or()). Fixing IDOR-TRIGGER-ENGAGEMENT input validation also closes the injection source.

### 🟢 sync-ghl-contact / sync-ghl-booking GHL signature is checked AFTER unauthenticated DB writes and an outbound GHL API fetch
- **Severity/Category:** low / security
- **Location:** `frontend/supabase/functions/sync-ghl-contact/index.ts:311-343 (clients SELECT before sig check); frontend/supabase/functions/sync-ghl-booking/index.ts:484-543 (bookings dup-check + clients SELECT + resolveClientForBooking GHL API calls before sig check)`
- **Problem:** In both functions the HMAC signature is only verified after the client row is resolved. In sync-ghl-booking the signature check sits at line 530, AFTER resolveClientForBooking (line 501) which loops over EVERY client with a GHL API key and makes outbound GHL API calls (fetchGhlAppointment) using each client's key to resolve the booking. An unauthenticated attacker who knows/guesses a bookingId can therefore drive the function to enumerate clients and fan out GHL API calls (using BFD's real GHL keys) before any signature is ever checked. The 403 only fires for the matched client and only when that client has a secret set (0 clients today), so today the sig check is fully inert and these endpoints accept forged POSTs that create leads/bookings.
- **Fix:** This is inherent to the resolve-then-verify design (the secret is per-client and the client must be resolved first). Where a stable secret-bearing header or query param identifies the client, verify before the GHL API fan-out. At minimum, document that sync-ghl-booking's brute-forceable GHL-API enumeration is gated only by knowledge of a bookingId, and treat bookings-webhook (which resolves client by locationId, a single lookup, before the GHL fetch) as the canonical signed ingress. Once WI-1 is resolved and secrets are set, this becomes the residual ordering concern.

### 🟢 Twilio signature verification uses non-constant-time string compare and has no replay/timestamp protection
- **Severity/Category:** low / security
- **Location:** `frontend/supabase/functions/receive-twilio-sms/index.ts:248-273; twilio-status-webhook/index.ts:31-56; twilio-inbound-sms/index.ts:11-35`
- **Problem:** All three Twilio handlers verify X-Twilio-Signature correctly (HMAC-SHA1 over public URL + sorted params, public URL reconstructed from SUPABASE_URL) but compare the computed base64 to the header with a plain `expected === signatureHeader` (and `btoa(bin) === signatureHeader`) rather than a constant-time compare. They also do no replay protection: a captured valid (URL+params+signature) tuple can be re-POSTed and will re-verify. receive-twilio-sms is partly protected by the message_queue.twilio_message_sid unique index (a replayed inbound is swallowed as a duplicate), but the STOP/START compliance branch (lines 489-601) runs BEFORE that dedup and will re-send a compliance SMS and re-toggle opt-out on each replay — i.e. a replay can be used to repeatedly trigger an outbound Twilio send (spends money).
- **Fix:** Replace the === comparisons with the constantTimeEqual helper already present in voice-booking-tools.ts / authorize-client-request.ts. For replay, dedup the STOP/START branch on MessageSid too (or move the message_queue SID-insert before the keyword branch) so a replayed STOP can't re-fire a billed compliance SMS. Timing leakage here is low-risk (HMAC output), so this is low severity, but it's a cheap hardening.

### 🟢 retell-call-webhook resolves client and performs DB writes from an unauthenticated, agent_id-spoofable body before the optional signature check
- **Severity/Category:** low / security
- **Location:** `frontend/supabase/functions/retell-call-webhook/index.ts:66-216`
- **Problem:** The function takes agent_id from the public webhook body to resolve the owning client (line 69), then the Retell signature is only checked when client.retell_webhook_secret is set (line 110; 0 clients have it). Because the secret is unset everywhere, an attacker who knows a client's agent_id (an agent_<hex> string that is not secret — it is visible in dashboards, call logs, and prior payloads) can POST a forged call_ended event and: (a) upsert arbitrary leads rows (last_message_at/preview/phone/name, lines 149-172), and (b) stamp engagement_executions.last_call_outcome + clear active_call_id for any execution_id they supply (lines 180-216). The latter directly drives runEngagement's advance-vs-terminate decision, so a forged 'human pickup' or 'missed call' outcome can mis-route a real cadence (skip the missed-call SMS, or terminate the cadence as 'engaged'). The agent_id regex guard prevents PostgREST filter injection but does nothing for authenticity.
- **Fix:** Provision clients.retell_webhook_secret and configure Retell to sign (BR3) so this stops being forgeable. As a code hardening, when stamping last_call_outcome verify the execution row actually has active_call_id matching call.call_id (not just execution_id) so a forged outcome for an arbitrary execution_id is ignored. Note the live coordination path uses retell-call-analysis-webhook (treat_pickup_as_reply) per memory VC3, but retell-call-webhook still writes last_call_outcome and is the documented Retell webhook target.

### 🟢 unipile-webhook trusts the client_id from the URL/body to select which secret to verify against — verification can be sidestepped by targeting a secret-less client_id
- **Severity/Category:** low / security
- **Location:** `frontend/supabase/functions/unipile-webhook/index.ts:46-94`
- **Problem:** The signature secret is looked up using sigClientId = clientId(from ?client_id=) || body.name, i.e. the same caller-supplied value the request is acting on. Verification only runs if THAT client has unipile_webhook_secret set. An attacker can therefore POST with a client_id that has no secret configured (or omit it) and the signature check is skipped entirely, then the body (status=CREATION_SUCCESS, account_id) is upserted into unipile_accounts for the resolved client. Impact is limited (it writes a unipile account binding), but an attacker could bind an attacker-controlled Unipile account_id to a victim client, redirecting/hijacking that client's social-DM integration.
- **Fix:** Require a secret/signature for the upsert path regardless (fail closed if the resolved client has no unipile_webhook_secret), or verify that account_id was actually issued by Unipile (e.g. confirm via Unipile API) before binding it. Low severity because Unipile DM is not in active client use, but it's a tenant-binding write on an unauthenticated path.

## 3. Bugs / data-integrity / correctness (owner = Claude)

### 🟠 Booking-created does not stop the cadence if the Trigger.dev run-cancel call fails (isCancelled ignores status 'completed')
- **Severity/Category:** high / bug
- **Location:** `trigger/runEngagement.ts:405-411 (isCancelled terminal set) + frontend/supabase/functions/bookings-webhook/index.ts:228-246`
- **Problem:** On a confirmed booking, bookings-webhook sets engagement_executions.status='completed' (stop_reason='booking_created') and then tries to cancel the Trigger.dev run; that cancel is wrapped in try/catch and is explicitly non-fatal (swallowed at :244). runEngagement's isCancelled() only treats status in {cancelled, stopped, replied} as terminal — it does NOT include 'completed' (or 'failed'). So the cadence's own self-stop relies entirely on the external Trigger.dev cancel succeeding. If that cancel API call fails (network blip, expired key, run mid-wait), the still-running run wakes from its wait.until and the next isCancelled() returns false for status 'completed', so it keeps sending SMS/placing calls to a lead who already booked.
- **Fix:** In runEngagement.isCancelled(), treat any terminal status (completed, failed, in addition to cancelled/stopped/replied) as a stop condition so DB state alone halts the run regardless of whether the external cancel landed. This makes booking_created (and any other completed-by-another-actor termination) reliably stop sending.

### 🟠 Outbound Retell call placed twice on placeOutboundCall retry (make-retell-outbound-call has no idempotency)
- **Severity/Category:** high / data-integrity
- **Location:** `trigger/placeOutboundCall.ts:16-66 (maxDuration 120, retry maxAttempts 3) + frontend/supabase/functions/make-retell-outbound-call/index.ts:395-848 (no execution_id dedup)`
- **Problem:** placeOutboundCall retries up to 3 times on any thrown error and is bounded to maxDuration 120s. make-retell-outbound-call places the Retell call unconditionally — it has no guard checking whether a call was already placed for this execution_id/contact. If the Retell call is placed successfully but the HTTP response is lost or the 120s ceiling fires before the response returns (Retell placement + the per-call agent voicemail_option PATCH can be slow), placeOutboundCall throws and retries → a SECOND live outbound call dials the same lead. The lead gets called twice (or more).
- **Fix:** Add idempotency in make-retell-outbound-call: before placing, check for a recent voice_call_logs / engagement_executions.active_call_id row for this execution_id (or a short-TTL dedup key) and return the existing call_id instead of placing again. Alternatively lower placeOutboundCall retry to maxAttempts:1 for the place step (the call either lands or it doesn't; a retried place is rarely safe) and/or raise maxDuration so a slow-but-successful placement returns before the ceiling.

### 🟠 sync-ghl-booking selects non-existent clients.sync_ghl_booking_enabled -> booking write-back fully broken
- **Severity/Category:** high / data-integrity
- **Location:** `frontend/supabase/functions/sync-ghl-booking/index.ts:130 and :220`
- **Problem:** Both client-resolution paths in sync-ghl-booking SELECT clients.sync_ghl_booking_enabled, a column that does not exist in the live platform clients table. PostgREST returns error 42703 for the whole select, so resolveClientFromBooking / the preferred-location path bail with errorDetail and no client is ever resolved. The canonical GHL appointment write-back (booking sync) cannot function.
- **Fix:** Either (a) add the column to the platform DB: ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sync_ghl_booking_enabled boolean DEFAULT false; (and commit the migration), or (b) remove sync_ghl_booking_enabled from both selects (130, 220) and the scoreClient bonus (line 154) and the ClientRecord type (line 76). Given sync_ghl_enabled already exists and is the live gate, option (b) is the smaller surgical fix unless per-feature gating is wanted.

### 🟡 Quiet-hours / schedule gate bypassed for later channels in a multi-channel engage node
- **Severity/Category:** medium / bug
- **Location:** `trigger/runEngagement.ts:916 (enforceQuietHoursBeforeSend at node entry only) + :943-953 (inter-channel wait.until with no re-gate)`
- **Problem:** enforceQuietHoursBeforeSend and the schedule gate are evaluated once, at engage-node entry (:916, :920). The channel loop then waits ch.delay_seconds between channels via wait.until (:947-952) with no quiet-hours/schedule re-check before the next channel sends. If an engage node has channels with non-trivial inter-channel delays (e.g. SMS now, then phone_call +6h), a channel that was in-window at node entry can fire its send well inside the lead's quiet-hours window. Quiet hours are a compliance/UX guarantee, so this is a real bypass for any multi-channel node with delays that cross the boundary.
- **Fix:** Call enforceQuietHoursBeforeSend(...) (and the schedule gate) at the top of each channel iteration after the inter-channel wait, before the actual send, not just once at node entry.

### 🟡 processMessages sends the setter reply via BOTH the GHL reply webhook and direct Twilio — double-text if the GHL 'Send Setter Reply' workflow is not truly dormant
- **Severity/Category:** medium / bug
- **Location:** `trigger/processMessages.ts:106-108 (require url) + :322-340 (POST to GHL reply webhook) + :355-424 (direct Twilio send for sms)`
- **Problem:** processMessages requires ghl_send_setter_reply_webhook_url to be set (throws at :106-108) and unconditionally POSTs the setter reply to it (:322). Then, when channel==='sms', it ALSO sends each setter message directly via the Twilio REST API (:355-424). The Docs (GHL_SETUP.md:115, CLIENT_ONBOARDING_SOP.md:544) state the GHL 'Send Setter Reply' workflow is dormant because the native engine sends directly — but the code still hard-requires and calls that webhook. If a client's GHL workflow still has an active SMS send action (or is re-enabled), the lead receives the reply twice: once from GHL and once from direct Twilio.
- **Fix:** Pick one send path. Either gate the GHL reply-webhook POST behind a flag (e.g. only when not using direct Twilio) and stop requiring the URL when direct Twilio creds are present, or make the GHL forward log-only. Confirm with Brendan whether any live client's 'Send Setter Reply' GHL workflow still sends SMS; if any does, this is an active double-text today.

### 🟡 voice-booking-tools lookup-contact queries leads by non-existent column ghl_contact_id (should be lead_id); last_message_preview always null
- **Severity/Category:** medium / bug
- **Location:** `frontend/supabase/functions/voice-booking-tools/index.ts:672-679`
- **Problem:** In toolLookupContact, the last-inbound-message-preview query filters the leads table with .eq("ghl_contact_id", contactId). The leads table column is lead_id (renamed from contact_id in migration 20260403200057; every leads upsert in the codebase uses onConflict: "client_id,lead_id"). PostgREST returns error 42703 ("column leads.ghl_contact_id does not exist"), which is swallowed by the surrounding try/catch, so last_message_preview is ALWAYS null. The voice agent never sees the lead's most recent inbound text during the call-opening identity lookup.
- **Fix:** Change .eq("ghl_contact_id", contactId) to .eq("lead_id", contactId) on line 676. (leads.updated_at exists, so the order-by is fine.)

### 🟡 Outbound voice calls query non-existent 'messages' table for SMS context; agent never gets prior chat history
- **Severity/Category:** medium / bug
- **Location:** `frontend/supabase/functions/make-retell-outbound-call/index.ts:306-325 (and outbound-call-processing/index.ts:206-211)`
- **Problem:** fetchChatHistory queries supabase.from("messages").select("role, body, created_at").eq("lead_id", leadId). There is NO bare 'messages' table in the bfd-setter schema (types.ts only has analytics_chat_messages, sms_messages, message_queue, etc.; the SMS table is sms_messages with columns body/direction/contact_id, NOT role/body/lead_id). The query errors and is swallowed by try/catch, returning "" — so chat_history is ALWAYS empty in the Retell dynamic variables. The voice agent loses all prior SMS conversation context on outbound calls. outbound-call-processing has the identical bug. Even the correct table (sms_messages) is only populated by the legacy direct-Twilio path (twilio-send-sms / twilio-inbound-sms), not the active receive-twilio-sms path (which writes the external chat_history table), so a fix needs to target the right source.
- **Fix:** Decide the real source of SMS history for the platform DB and point both fetchChatHistory functions at it. If the active SMS path stores only to the per-client external chat_history table, fetch from there (mirror the voice-booking-tools send-sms external write), or remove the dead enrichment. Do not leave a silently-empty {{chat_history}} dynamic var.

### 🟡 Multi-channel engage node re-sends SMS/call on Trigger.dev retry (no per-channel idempotency)
- **Severity/Category:** medium / data-integrity
- **Location:** `trigger/runEngagement.ts:943-1255 (engage channel loop) + :1488-1490 (last_completed_node_index written after whole node) + :346 (retry maxAttempts 2)`
- **Problem:** runEngagement has retry.maxAttempts:2 and resumes from last_completed_node_index+1 on retry. last_completed_node_index is written only AFTER an entire node finishes (line 1490). An engage node iterates channels (ci=0..n) and performs the non-idempotent Twilio send / outbound call inside that loop. If any later channel (or the post-send updateExecution/logCampaignEvent) throws, the whole task throws, status is set to 'failed', and Trigger.dev retries from the top of run(). Because this node never wrote last_completed, the retry replays the engage node from channel 0, re-sending the SMS already delivered (and stamped to message_queue/Twilio) on the first attempt. Same applies to a standalone send_sms/send_whatsapp node if the post-send writes fail before line 1490.
- **Fix:** Make sends idempotent across retries. Either (a) write last_completed_node_index incrementally per-channel within the engage node (e.g. last_completed_channel_index) and skip already-sent channels on resume, or (b) before each Twilio send, check message_queue for an existing sms_outbound row for this (lead_id, node_id, body/idempotency-key) within this execution and skip if present, or (c) pass a Trigger.dev idempotencyKey / Twilio idempotency token derived from execution_id+node_id+channel. At minimum stamp a per-node 'sent' marker before the throwable post-send writes.

### 🟡 schedule-callback voice tool: scheduled_callbacks table has no migration; insert error unchecked -> false success + lost callback
- **Severity/Category:** medium / data-integrity
- **Location:** `frontend/supabase/functions/voice-booking-tools/index.ts:797-814`
- **Problem:** toolScheduleCallback inserts into scheduled_callbacks but (a) the table has NO CREATE TABLE anywhere in the repo (no migration, not in types.ts) and (b) the insert result destructures only { data: cbRow } and never checks error. If the insert fails (table missing, RLS, column mismatch on ghl_contact_id/voice_setter_id/callback_reason), cbRow is undefined, the Trigger.dev enqueue is skipped, and the tool still returns { scheduled: true } to the voice agent. The agent then tells the lead 'I've booked your callback' when nothing was scheduled. Even on a successful insert, the Trigger.dev fetch (line 807) has no response check and scheduleCallback is an event-triggered task with no reconciliation poller, so a failed/missing-key enqueue leaves the row 'pending' forever and the callback never fires.
- **Fix:** Brendan: confirm/provision the scheduled_callbacks table in the platform DB (bjgrgbgykvjrsuwwruoh) and add a checked-in migration. Claude: capture the insert error and return { scheduled: false, reason } when it fails, and check the Trigger.dev fetch response (throw a 502 ToolError on non-2xx) so the agent does not falsely confirm a callback. Surgical migration also recommended.

### 🟡 voice-booking-tools resolveContactId selects first GHL contact from a substring phone/email query (wrong-contact booking risk)
- **Severity/Category:** medium / data-integrity
- **Location:** `frontend/supabase/functions/voice-booking-tools/index.ts:173-199, 596-608`
- **Problem:** Contact resolution uses GHL '/contacts/?query=<phone>&limit=1' and takes contacts[0].id with no verification that the returned contact's phone/email actually equals the search term. GHL's query param is a fuzzy/substring match, so a partial phone (e.g. a number that is a substring of another contact's number, or a shared business email domain fragment) can return a different contact. The tool then books/cancels/updates appointments and sends SMS against that mis-matched contact. Used by book-appointments (createIfMissing path), get-contact-appointments, send-sms, schedule-callback, and lookup-contact.
- **Fix:** After fetching contacts[0], verify the returned contact's normalized phone/email matches the search term (E.164-normalize phones before compare) before accepting it; otherwise treat as no-match. Prefer GHL's exact lookup endpoints (e.g. /contacts/search/duplicate?number= or /contacts/lookup) where available.

### 🟡 unipile-webhook upsert onConflict (client_id,unipile_account_id) does not match the 3-column unique constraint
- **Severity/Category:** medium / data-integrity
- **Location:** `frontend/supabase/functions/unipile-webhook/index.ts:111`
- **Problem:** The upsert into unipile_accounts uses onConflict 'client_id,unipile_account_id', but the live unique index is the 3-column (client_id, provider, unipile_account_id). PostgREST requires onConflict columns to exactly match a unique constraint, so this upsert fails with 42P10 and Unipile account connections (LinkedIn/IG DM linkage) are not persisted/updated via the webhook.
- **Fix:** Change the onConflict to 'client_id,provider,unipile_account_id' to match the existing unique index (the payload already includes provider). This is a one-line code fix, no DDL needed.

### 🟢 wait_for_reply node counts outbound messages as inbound replies (no direction/channel filter)
- **Severity/Category:** low / bug
- **Location:** `trigger/runEngagement.ts:1453-1483`
- **Problem:** The wait_for_reply node detects a reply by querying message_queue for ANY row with created_at >= waitStartedAt for this (lead_id, ghl_account_id), with no channel/direction filter (line 1454-1460). Inbound SMS are stamped channel:'sms' while outbound are channel:'sms_outbound' (receive-twilio-sms:761 vs runEngagement:220 / processMessages:396 / nudgeColdReply:242). Any outbound stamp that lands inside the wait window — e.g. a concurrent sendFollowup or nudgeColdReply outbound for the same lead, or a race where our own send timestamp falls within the window — is mis-detected as an inbound reply, terminating the cadence early with stop_reason='inbound_reply' even though the lead never replied.
- **Fix:** Filter the wait_for_reply detection to inbound rows only, e.g. add `.eq('channel','sms')` / `.in('channel', ['sms','whatsapp', ...inbound channels])` or an explicit direction='inbound' filter, so outbound stamps can never be read as replies.

### 🟢 Drip node is not idempotent on retry — re-claims a new batch slot and inflates the campaign batch counter (contradicts code comment)
- **Severity/Category:** low / bug
- **Location:** `trigger/runEngagement.ts:344-345 (idempotency claim) + :853-901 (drip node) + migrations/20260412173255_*.sql:41-47 (claim_drip_position RPC)`
- **Problem:** The task comment at :344-345 asserts the drip position is idempotent and 'claiming the same position twice is safe'. The RPC does the opposite: claim_drip_position does INSERT ... ON CONFLICT DO UPDATE SET next_position = next_position + 1, keyed only on (client_id, workflow_id, node_id, campaign_id) with no lead/execution dedup, returning a fresh incremented position on every call. If runEngagement is retried while the drip node was mid-wait (last_completed_node_index not yet written, so resume replays the drip node), the retry consumes a SECOND queue slot: the lead is reassigned to a later batch (extra delay) and the shared counter is inflated, pushing every subsequently-enrolled lead one slot further back.
- **Fix:** Make drip claiming idempotent per execution: persist the claimed position on engagement_executions (e.g. drip_position/drip_fires_at) the first time, and on resume reuse the stored value instead of re-calling claim_drip_position. Then correct the misleading comment at :344-345.

### 🟢 twilio-status-webhook updates non-existent message_queue.status -> inbox delivery-status mirror silently fails
- **Severity/Category:** low / bug
- **Location:** `frontend/supabase/functions/twilio-status-webhook/index.ts:166-171`
- **Problem:** On a terminal Twilio status the handler does .from('message_queue').update({ status }), but message_queue has no status column. The update returns 42703; because the whole handler is wrapped in a try/catch that returns 'ok' 200, the error is swallowed. The 'Mirror terminal status to message_queue for the inbox UI' feature never works (delivered/failed/undelivered never reflected in the inbox), and the failure is invisible.
- **Fix:** Either add a status text column to message_queue (ALTER TABLE public.message_queue ADD COLUMN IF NOT EXISTS status text;) if the inbox should show delivery state, or remove the dead update block (166-171). Note sms_delivery_events already records (twilio_message_sid, status) terminal events via the upsert just above (line 155, which is correct), so the message_queue mirror may be redundant - prefer removing it unless the inbox UI specifically reads message_queue.status.

### 🟢 executeWorkflow upserts workflow_execution_steps onConflict (execution_id,node_id) with no matching unique constraint
- **Severity/Category:** low / data-integrity
- **Location:** `trigger/executeWorkflow.ts:106`
- **Problem:** The node-step tracking upsert uses onConflict 'execution_id,node_id', but workflow_execution_steps has no unique constraint/index on (execution_id, node_id) - only the PK on id. PostgREST/Postgres require the onConflict columns to match a unique or exclusion constraint, so this upsert fails with 42P10 ('no unique or exclusion constraint matching the ON CONFLICT specification'). Workflow step state (running/completed/failed per node) is never persisted by the workflow engine.
- **Fix:** Add the constraint: ALTER TABLE public.workflow_execution_steps ADD CONSTRAINT workflow_execution_steps_exec_node_key UNIQUE (execution_id, node_id); and commit the migration. Verify the workflow_execute path afterward (a node re-run should update, not duplicate).

## 4. Reliability & observability (owner = Claude)

### 🟠 Inbound SMS ingress failures are silent: failed replies never logged to error_logs
- **Severity/Category:** high / reliability
- **Location:** `frontend/supabase/functions/receive-twilio-sms/index.ts:775, 883, 910, 953-960`
- **Problem:** receive-twilio-sms is the inbound reply path that arms the AI setter. When the non-duplicate message_queue insert fails (line 775), the dm_executions insert fails (line 883), triggerProcessMessages fails (line 910), or the top-level catch fires (line 953), the function returns empty TwiML 200 and only console.error()s. There is NO error_logs write on any of these. The consequence is that a lead's inbound reply is silently dropped: no AI response is ever generated, no execution is created, and nothing surfaces the failure to any dashboard or alert. This is the highest-impact silent-failure class because it directly breaks the core product promise (auto-reply to leads) with zero visibility.
- **Fix:** Add error_logs inserts (source: 'receive_twilio_sms', category: 'inbound_sms') at each of these failure points before returning TwiML, capturing client_id/lead_id/messageSid. Keep the TwiML 200 response (correct, to avoid Twilio retry storms) but record the failure so REL-02's alerter and the operator can see dropped inbound replies. Apply the same to the GHL-contact-resolve catch (line 626).

### 🟡 Retell call retry storm: non-retryable API errors get retried 3x against a paid API
- **Severity/Category:** medium / reliability
- **Location:** `frontend/supabase/functions/make-retell-outbound-call/index.ts:788-813; trigger/placeOutboundCall.ts:61-66`
- **Problem:** make-retell-outbound-call returns HTTP 200 with { error, call_failed: true } on ANY Retell API failure (line 812), including permanent 4xx errors (invalid to_number, agent not provisioned, account/credit issues). placeOutboundCall treats `data?.call_failed` as a throw (line 63-65), and the task is configured retry.maxAttempts:3 with exponential backoff (placeOutboundCall.ts:17-23). There is no classification of retryable vs permanent failure, so a permanently-bad call (e.g. malformed number) is re-attempted 3 times, each hitting the paid Retell create-phone-call endpoint and re-running the full GHL enrichment + agent voicemail PATCH inside the edge fn. Combined with runEngagement's own maxAttempts:2 whole-task retry, a single bad lead can drive ~6 Retell attempts.
- **Fix:** In make-retell-outbound-call, distinguish permanent vs transient Retell failures (4xx like 400/404/422 and 'no agent' / 'no phone' / insufficient-credit codes = permanent). Return a `retryable: false` flag (or a 4xx status the queue won't retry). In placeOutboundCall, only throw (trigger retry) when retryable !== false; otherwise return a non-throwing failure result so the queue does not re-dial. Add a per-(lead_id, voice_setter_id) short cooldown guard before placing a call to prevent any path from double-dialing the same lead.

### 🟡 runEngagement whole-task retry can re-send SMS / re-place calls (spend not idempotent before index commit)
- **Severity/Category:** medium / reliability
- **Location:** `trigger/runEngagement.ts:346 (retry maxAttempts:2), 1127/1276 (SMS send), 983 (call), 1490 (last_completed_node_index committed AFTER send)`
- **Problem:** Retry-safe resume relies on engagement_executions.last_completed_node_index, which is written only at the end of each node iteration (line 1490), AFTER the Twilio SMS (line 1127/1276), Retell call (line 983), WhatsApp (line 1181), and email (line 1221) have already gone out. The task has retry.maxAttempts:2. If the run crashes or is restarted between the actual send and the line-1490 index commit (e.g. a transient DB error in updateExecution, logCampaignEvent, writeToChatHistory, or the index write itself), Trigger.dev restarts run() from the top; resumeFromIndex = lastCompleted + 1 still points at node i (the index for i was never persisted), so node i re-executes and the same SMS is re-sent / the same lead is re-dialed. The in-code comment (line 792 'prevents re-sending messages that were already sent') overstates the guarantee: it only holds if the failure occurs strictly after line 1490.
- **Fix:** Commit last_completed_node_index transactionally with (or immediately after) the spend, before the non-essential logging Promise.all, OR persist a per-(execution_id, node_index) 'sent' marker checked at node entry so a replayed node short-circuits. Alternatively pass a deterministic idempotency token to Twilio/Retell keyed on (execution_id, node_index) so a replay is de-duplicated provider-side. At minimum, move the `last_completed_node_index` write to immediately after the send-success check and wrap the subsequent logging so its failures can't trigger a replay.

### 🟡 nudgeColdReply sends SMS without re-checking opt-out, and references columns it does not SELECT
- **Severity/Category:** medium / reliability
- **Location:** `trigger/nudgeColdReply.ts:64-75 (query), 144-256 (per-lead send loop), 172-173 (business_name/custom_fields)`
- **Problem:** Two issues. (1) Opt-out staleness: setter_stopped=false is filtered once in the candidate query (line 69). The per-lead loop then does an AI generation (network call) and a Twilio send (line 196) per lead, up to 100 leads, with no re-read of setter_stopped before sending. A lead who texts STOP after the query snapshot but before their turn in the loop still gets a marketing nudge SMS, a compliance risk. processMessages and sendFollowup both re-check setter_stopped before sending; this task does not. (2) The AI-copy call references lead.business_name (line 172) and lead.custom_fields (line 173), but neither column is in the SELECT (line 67 selects client_id, lead_id, phone, email, first_name, last_name, last_inbound_at, last_outbound_at, nudge_count, clients(...)). Supabase-js returns undefined for unselected columns, so every nudge is generated without business name / custom fields, silently degrading personalization.
- **Fix:** (1) Re-read leads.setter_stopped (and ideally lead_optouts by phone) for the lead immediately before the Twilio send; skip if stopped. (2) Add business_name and custom_fields to the SELECT, or drop the references if intentionally unused. Low effort, removes a compliance gap and a silent personalization regression.

### 🟡 Single end-to-end monitor covers only the outbound path and is currently dark
- **Severity/Category:** medium / reliability
- **Location:** `trigger/syntheticProbe.ts:47-218`
- **Problem:** The synthetic probe (the only end-to-end health check) posts a fake lead to intake-lead and asserts an OUTBOUND sms_outbound message_queue row appears, then cancels the cadence. It never exercises the inbound reply path (receive-twilio-sms -> message_queue -> processMessages -> setter reply) or the voice-call path. So the most fragile and most silent path in the system (inbound replies, see REL-03) has zero automated verification even if the probe were live. Additionally, the probe is hourly and currently dark (missing PROBE_* env in Trigger.dev prod), meaning right now there is no working end-to-end monitor at all.
- **Fix:** Brendan: provision PROBE_CLIENT_ID / PROBE_INTAKE_SECRET / PROBE_TEST_PHONE in Trigger.dev prod to restore the probe (known item). Claude can then extend the probe with an inbound leg: after the outbound send, simulate an inbound reply (post a signed payload to receive-twilio-sms or insert a message_queue 'sms' row + trigger process-messages) and assert a setter reply / sms_outbound response, closing the inbound monitoring gap from REL-03.

### 🟢 active_call_id never cleared on call-outcome timeout — leaves text-setter SMS hold stuck and call-state dangling
- **Severity/Category:** low / reliability
- **Location:** `trigger/runEngagement.ts:1024-1064 (engage call) + :1399-1438 (legacy call), waitForCallOutcome null branch + processMessages.ts:166-181 (15-min SMS hold)`
- **Problem:** When a phone_call is placed, active_call_id is set (:1024/:1399) as the hold signal that makes processMessages defer SMS replies. It is normally cleared by retell-call-webhook on call_ended. But if waitForCallOutcome returns null (the 600s outcome poll ceiling fires without the webhook ever stamping last_call_outcome), runEngagement logs 'assuming missed' and continues to the next node WITHOUT clearing active_call_id. The stale active_call_id then blocks processMessages' SMS reply for up to its 15-minute hold deadline, and the engagement_executions row carries a dangling active_call_id. This is the known VC1 residual surfaced from the cadence side.
- **Fix:** Clear active_call_id whenever runEngagement stops waiting on a call (on the timeout/null branch, on cancellation, and after classifying any non-engaged outcome) so the text-setter hold releases promptly and call-state isn't left dangling.

### 🟢 CA3 setter_stopped recheck coverage is complete across the active send paths (verification result, not a defect)
- **Severity/Category:** low / reliability
- **Location:** `trigger/processMessages.ts:190-206, runEngagement.ts:389-426/838, sendFollowup.ts:100-117, scheduleCallback.ts:35-43, nudgeColdReply.ts:69`
- **Problem:** Verifying the prompt's explicit question: the setter_stopped recheck added to processMessages (CA3) is NOT needed identically in runEngagement or sendFollowup — they already have equivalent guards. runEngagement.isCancelled() re-reads leads.setter_stopped before every node and during call-waits and self-cancels (:412-424). sendFollowup re-reads setter_stopped after its wait, before generating/sending (:100-117). scheduleCallback honors opt-out at fire time (:35-43). nudgeColdReply filters setter_stopped=false in its query (:69). The one minor residual: nudgeColdReply does not re-check setter_stopped between the query and the Twilio send within the same run, but that window is sub-second per lead and low-risk.
- **Fix:** No action required for runEngagement/sendFollowup. Optionally add a per-lead setter_stopped re-read immediately before the Twilio send in nudgeColdReply for symmetry, but it is low priority.

### 🟢 test-external-supabase returns HTTP 200 on every validation/error path (provider-facing inconsistency)
- **Severity/Category:** low / reliability
- **Location:** `frontend/supabase/functions/test-external-supabase/index.ts:19-215`
- **Problem:** Every failure branch (missing clientId, missing serviceKey, invalid URL, invalid key format, connection error, network error) returns status: 200 with { success: false, error }. While the UI reads the body's success flag, returning 200 for hard input/validation failures is inconsistent with the rest of the codebase (duplicate-setter-config, push-contact-to-ghl, retell-proxy all return 400/404/409/500). It also defeats any HTTP-status-based monitoring/alerting and makes the function indistinguishable from a real success at the transport layer. The cross-tenant authorize block (line 31) correctly returns e.status, so the 200s are only on the body-validation/connection paths.
- **Fix:** Return 400 for client input/validation failures and 502 for upstream-connection failures while keeping the success:false body for the UI. Low priority since the UI works off the body; flagged for consistency and observability.

### 🟢 retell-call-webhook has no error_logs writes; leads upsert and external sync fail silently
- **Severity/Category:** low / reliability
- **Location:** `frontend/supabase/functions/retell-call-webhook/index.ts:170-172, 218-223, 319-323`
- **Problem:** This webhook handles the cadence-coordination call_ended signal and the external call_history sync. It correctly returns 500 to force a Retell retry when the last_call_outcome write fails (lines 198-209, good). But the leads upsert failure (line 170-172), the 'no external Supabase configured' skip (218), and the final external call_history sync failure after the 10-attempt column-stripping loop (line 319-323) are only console.warn/error and never written to error_logs. So lost voice-call activity bumps and failed external call_history syncs are invisible to any alerting. The external sync also returns 500 on final failure, which will cause Retell to retry the WHOLE webhook (re-running the leads upsert and the already-succeeded last_call_outcome write) up to Retell's retry budget, an avoidable amplification.
- **Fix:** Insert error_logs rows (source: 'retell_call_webhook') on the leads upsert failure and the terminal external-sync failure. Consider returning 200 (not 500) for the external call_history sync failure once last_call_outcome has already been persisted, so a non-critical sync miss does not retry the whole webhook and re-stamp the outcome.

### 🟢 retell-call-webhook picks clients[0] when an agent_id maps to multiple clients (shared master agent)
- **Severity/Category:** low / reliability
- **Location:** `frontend/supabase/functions/retell-call-webhook/index.ts:92-106`
- **Problem:** The webhook resolves the client by matching agent_id across all 10 slot columns with a PostgREST .or() that can return multiple client rows, then unconditionally takes clients[0] (line 106). Per project memory, BFD's single master agent (agent_f45f4dd87a4072424f3c84b74c) is shared across multiple direction columns and potentially reused; if more than one client row references the same agent_id, call outcomes and external call_history can be attributed to the wrong tenant, and last_call_outcome is stamped using dynamicVars.execution_id (which is correct) but the leads upsert / external sync use the arbitrarily-chosen client. This is latent today (effectively single active tenant) but is a cross-tenant data-integrity hazard as clients are added.
- **Fix:** When clients.length > 1, disambiguate using a tenant signal already present in the payload (dynamicVars.ghl_account_id / ghl_contact_id, or the execution_id's owning client) rather than clients[0], and log a warning (and error_logs row) on ambiguous matches. Long term, avoid sharing one Retell agent_id across client rows for inbound resolution, or store an explicit client_id in Retell metadata/dynamic vars and resolve by that.

## 5. Config / dependencies / build (owner = Claude)

### 🟠 GHL verify-if-present handlers assume HMAC-SHA256 shared secret, but GHL Webhook V2 signs with RSA public key — provisioning the secret will 403 all real traffic
- **Severity/Category:** high / config
- **Location:** `frontend/supabase/functions/sync-ghl-contact/index.ts:24-50,330-343; sync-ghl-booking/index.ts:13-39,530-543; workflow-inbound-webhook/index.ts:15-41,96-116; bookings-webhook/index.ts:63-91,180-190; receive-dm-webhook/index.ts:13-39,380-398; ghl-tag-webhook/index.ts:33-59,554-563; Docs/RUNBOOK.md:243-246; Docs/CLIENT_ONBOARDING_SOP.md:324-329`
- **Problem:** Every GHL-facing verify-if-present handler computes an HMAC-SHA256 hex over the raw body keyed by clients.ghl_webhook_secret and compares it to the x-wh-signature header. GHL's native Webhook V2 (Settings -> Marketplace -> Webhooks v2) does NOT sign with a per-location HMAC shared secret — it signs the payload with an RSA-SHA256 PRIVATE key and publishes a PUBLIC key for verification; there is no per-location shared 'secret shown' to paste into ghl_webhook_secret. The RUNBOOK (line 246) and onboarding SOP (§5.3) instruct Brendan to 'note the webhook secret shown' and paste it, then state the handlers 'enforce HMAC-SHA256'. If Brendan provisions ghl_webhook_secret expecting native Webhook V2 signing, the HMAC compare will never match GHL's RSA signature and every legitimate inbound (lead create, booking, tag enrol, DM) will return 403 — a full ingress outage for that client.
- **Fix:** Before provisioning any ghl_webhook_secret, confirm the exact GHL signing mechanism for the chosen ingress. If using GHL native Webhook V2: switch verification to RSA-SHA256 against GHL's published public key (a single constant, not per-client). If using the GHL workflow Webhook action: add a static custom header (e.g. x-wh-token) and change the code to a constant-time STRING compare against ghl_webhook_secret (not an HMAC). Update RUNBOOK §243 + SOP §5.3 to match whichever mechanism is real. Keep verify-if-present (inert until secret set) so this stays safe until corrected.

### 🟡 DOMPurify 3.2.6 has known XSS-bypass advisories and is the app's primary HTML sanitizer
- **Severity/Category:** medium / dependency
- **Location:** `frontend/package.json:58 (dompurify ^3.2.6); used in frontend/src/pages/EmailInbox.tsx:437 and frontend/src/components/RichTextEditor.tsx:37`
- **Problem:** The frontend pins dompurify ^3.2.6 (installed 3.2.6). npm audit flags 9 distinct XSS / prototype-pollution-to-XSS advisories affecting <=3.3.3 (e.g. GHSA-h8r8-wccr-v5f2 mutation-XSS, GHSA-v9jr-rg53-9pgp CUSTOM_ELEMENT_HANDLING prototype pollution). DOMPurify is exactly the control that renders untrusted HTML safe here: EmailInbox renders inbound email bodies via DOMPurify.sanitize and RichTextEditor sanitizes user HTML. A sanitizer-bypass directly translates to stored/rendered XSS in a multi-tenant dashboard.
- **Fix:** Bump dompurify to ^3.4.8 (same major, no API change) and re-run `npm audit`. This is the highest-value single bump given it backs the app's XSS defense on untrusted email/HTML content.

### 🟡 react-router-dom 6.30.1 vulnerable to XSS via open redirect (HIGH)
- **Severity/Category:** medium / dependency
- **Location:** `frontend/package.json:78 (react-router-dom ^6.30.1); transitive @remix-run/router 1.23.0`
- **Problem:** Installed react-router-dom 6.30.1 / @remix-run/router 1.23.0 are flagged HIGH: GHSA-2w69-qvjg-hvjx 'React Router vulnerable to XSS via Open Redirects' plus open-redirect advisories (GHSA-9jcx-v3wj-wh4m, GHSA-2j2x-hqr9-3h42 protocol-relative `//` reinterpretation). A patched 6.30.x is available (non-major).
- **Fix:** Update react-router-dom to the patched 6.30.x (npm audit fix handles it without a major bump). Verify no auth-gated route relies on user-supplied redirect targets.

### 🟢 Edge functions have no Deno lockfile / import_map — npm: dep versions are not reproducible
- **Severity/Category:** low / config
- **Location:** `frontend/supabase/functions/ (no deno.json, deno.lock, or import_map.json anywhere under frontend/supabase)`
- **Problem:** There is no deno.json, import_map.json, or deno.lock anywhere under frontend/supabase. Combined with 62 bare `npm:@supabase/supabase-js@2` imports (and other `npm:`/`esm.sh` imports), the exact dependency versions resolved at `supabase functions deploy` time are non-deterministic: two deploys days apart can ship different transitive code with no lockfile to pin or audit. For a payment- and PII-handling backend this is a supply-chain/reproducibility gap.
- **Fix:** Add a deno.lock (and optionally an import map pinning @supabase/supabase-js to a single exact version) for the edge-function workspace so deploys are reproducible and auditable. At minimum replace bare `@2` with exact pins.

### 🟢 No Node engines pin in any package.json (build environment unconstrained)
- **Severity/Category:** low / config
- **Location:** `package.json (root), frontend/package.json — neither declares an "engines" field`
- **Problem:** Neither the root (Trigger tasks) nor the frontend package.json declares an `engines.node` constraint. The frontend uses @types/node ^22 and Trigger config sets runtime:'node', but nothing pins the Node major across local dev, Trigger.dev deploy, and the Railway build. Different Node majors between contributors/CI can produce divergent installs or build failures, and there is no signal to CI of the intended runtime.
- **Fix:** Add an `engines: { "node": ">=20 <23" }` (or the exact Trigger/Railway target) to both package.json files so installs and deploys assert a known Node major.

### 🟢 supabase-js version drift across frontend / trigger / edge functions (3+ pins, 62 unpinned)
- **Severity/Category:** low / dependency
- **Location:** `package.json:5 (2.101.0); frontend/package.json:47 (^2.98.0 -> 2.98.0); frontend/supabase/functions/*/index.ts (npm:@supabase/supabase-js@2 x62, @2.49.1 x18, @2.45.0 x4)`
- **Problem:** @supabase/supabase-js is on at least 4 different versions across the three runtimes: Trigger tasks/root pin 2.101.0, the frontend resolves 2.98.0, and the Deno edge functions split across a bare `@2` (62 imports, floats to latest 2.x at deploy time), `@2.49.1` (18 imports), and `@2.45.0` (4 imports, all four Stripe functions: stripe-portal, stripe-webhook, stripe-checkout, check-client-subscription). The payment-critical functions run the OLDEST client. Behavioural differences (auth/storage/realtime/retry semantics) between 2.45 and 2.101 are real, and the same insert/upsert logic can behave differently per surface. This is a reliability/maintenance hazard, not a single exploit.
- **Fix:** Standardize edge functions on one pinned minor (match the 2.101.x line the rest of the stack uses), prioritizing the Stripe functions off 2.45.0. Replace bare `@2` with an explicit pin. Align frontend (^2.98.0) and root (2.101.0) to the same minor.

### 🟢 Vite 5.4.19 / esbuild 0.21.5 carry dev-server path-traversal & SSRF advisories
- **Severity/Category:** low / dependency
- **Location:** `frontend/package.json:103 (vite ^5.4.19 -> 5.4.19); transitive esbuild 0.21.5`
- **Problem:** npm audit flags vite (path traversal in optimized-deps .map handling GHSA-4w7w-66w2-5vf9, server.fs.deny bypass) and esbuild 0.21.5 (GHSA-67mh-4wv8-2f99: any website can send requests to the dev server and read responses). These only affect the local dev server, not the static production build served from dist/, so real-world impact is low for a deployed SPA, but a developer running `npm run dev` on an untrusted network is exposed.
- **Fix:** Run `npm audit fix` to pull patched vite 5.4.x / esbuild within the existing major. Low urgency since prod is a static build, but worth folding into the same dependency-bump pass.

## 6. Features to build (owner = Claude)

### 🟠 No UI to set per-client webhook signing secrets (security fix is inert without it)
- **Severity/Category:** high / feature
- **Location:** `frontend/src/pages/ApiManagement.tsx, frontend/src/pages/ApiCredentials.tsx (neither references *_webhook_secret); clients.ghl_webhook_secret / retell_webhook_secret / unipile_webhook_secret`
- **Problem:** The verify-if-present HMAC hardening just shipped on sync-ghl-contact, sync-ghl-booking, retell-call-webhook, workflow-inbound-webhook (plus bookings-webhook, retell-call-analysis-webhook) is inert until clients.<provider>_webhook_secret is populated, and there is zero UI to populate it. The only path is raw SQL. A partner onboarding clients cannot arm inbound webhook authentication without DB access, so every client they onboard ships with forgeable inbound webhooks indefinitely.
- **Fix:** Add masked secret inputs for ghl_webhook_secret / retell_webhook_secret / unipile_webhook_secret to ApiManagement (it already has masked-password inputs and a clients.update path at lines 478/526/700). Pair each with a short 'where to copy this from' hint. This is the single change that converts the just-shipped security work from dormant to active for the partner motion.

### 🟡 No per-client onboarding/health readiness dashboard for the operator/partner
- **Severity/Category:** medium / feature
- **Location:** `frontend/src/pages/ClientManagement.tsx:95 (select '*' but renders only name/created_at); frontend/src/pages/ManageClients.tsx:157 (selects id,name,email,description,image_url,created_at)`
- **Problem:** There is no view that tells a partner at-a-glance which clients are fully provisioned and live vs half-configured. The two operator client-list pages render only display fields. Whether a client is actually usable depends on ~15 gating columns (subscription_status, ghl_calendar_id, ghl_assignee_id, retell_*_agent_id, retell_api_key, openrouter_api_key, ghl_webhook_secret, retell_webhook_secret, auto_engagement_workflow_id, external supabase_*, ghl_channel_field_id, voicemail_config) plus external wiring (GHL calendar webhook, Retell tool URLs, Twilio inbound webhook). None of that status surfaces anywhere.
- **Fix:** Add a 'Client readiness' surface: a computed checklist per client (subscription active, GHL creds + calendar + assignee, Retell key + inbound/outbound agents + phone, OpenRouter key, webhook secrets present, auto_engagement_workflow_id set) rendered as a red/amber/green column on ClientManagement and a detail panel. Pure read of existing columns; highest-leverage single feature for a reseller demo because it turns 'is this client live?' from a SQL query into a glance.

### 🟡 Effectively no automated test coverage and no test runner wired
- **Severity/Category:** medium / feature
- **Location:** `package.json (scripts: only dev/deploy; no test); frontend/package.json (no test script, zero test devDeps); 5 ad-hoc *.test.ts files`
- **Problem:** The platform has 82 edge functions, 11 Trigger.dev tasks, and 381 frontend source files, guarded by exactly 5 unit-test files, none of which are runnable via any package script or CI. There is no vitest/jest/playwright dependency in the frontend, no `test` npm script anywhere, and no .github/workflows. For a partner about to onboard paying clients on lead-routing money paths (cadence, booking, opt-out, billing), there is no regression safety net. The 5 existing tests must be invoked by hand with `node --experimental-strip-types --test`.
- **Fix:** Wire a minimal runnable test target first (a root `test` script running `node --experimental-strip-types --test` over the existing *.test.ts), then add vitest for the frontend and a thin smoke suite over the money-path _shared helpers (classifyCallOutcome already exists, add leads-upsert shape, opt-out gate, webhook HMAC verify). Even 15 focused tests + one CI job massively de-risks a reseller motion where Brendan can't manually re-verify every client.

### 🟡 Onboarding leaves high-automatable external wiring as manual click-path
- **Severity/Category:** medium / feature
- **Location:** `scripts/onboard-client.mjs:39-46,344-366 (DOES NOT call twilio-configure-webhook); existing edge fns twilio-configure-webhook, voice-booking-tools`
- **Problem:** onboard-client.mjs automates the clients row, GHL custom field, and workflow clone, but punts on steps that are scriptable against existing infrastructure: Twilio inbound SMS webhook (there is already a twilio-configure-webhook edge function the script never invokes), and the Retell custom-tool URL repointing (deterministic per-client URLs the SOP §5.4 spells out by hand). These are precisely the steps most likely to be done wrong by a partner, and the SOP is now 1022 lines with ~103 manual/checklist markers.
- **Fix:** Extend onboard-client.mjs (or add an onboard step) to (a) invoke twilio-configure-webhook for each provisioned number, and (b) PATCH the 5 Retell custom-tool URLs via REST to the per-client voice-booking-tools endpoint it already constructs at line 353. Both are deterministic and remove the two most error-prone partner steps. NOTE: this touches Retell tool URLs (config, not prompt content) so it does not violate the report-only prompt rule, but confirm with Brendan before enabling the Retell PATCH given the live-agent sensitivity.

### 🟡 ApiManagement/ApiCredentials expose raw provider secrets with no demonstrated role gating in the route table
- **Severity/Category:** medium / feature
- **Location:** `frontend/src/App.tsx:259,273 (ApiCredentials routes); ApiManagement editable fields include retell_api_key, twilio_auth_token, openrouter_api_key, supabase_service_key`
- **Problem:** The credential-editing pages let you set/read provider secrets (Retell key, Twilio token, OpenRouter key, external Supabase service key). The route registrations show no obvious role guard (unlike debug routes which are wrapped in CreatorRouteGuard). For a reseller/partner motion with sub-account client logins, it must be impossible for a client user to view or edit the agency's raw provider keys. This needs explicit verification of who can reach these routes, and aligns with the known residual F7 (client secret columns readable by browser).
- **Fix:** Verify the parent route/layout role guard on ApiCredentials/ApiManagement and, if absent, wrap in an agency/creator-only guard; ensure RLS column-level protection (or a server-mediated masked read) so client-role users never receive raw secret values in the browser. Coordinate with the F7 residual fix.

### 🟢 No connectivity/credential validation: bad GHL/Retell/Twilio/OpenRouter keys fail silently at runtime
- **Severity/Category:** low / feature
- **Location:** `frontend/src/pages/ApiManagement.tsx (only validateWebhookUrl + webhook test-payload exist; no provider-key validation)`
- **Problem:** ApiManagement can send a test payload to webhook URLs and URL-format-validates them, but there is no 'test connection' for the actual provider credentials. A partner who pastes a wrong Retell API key, expired GHL PIT, or wrong Twilio token gets no feedback until a live lead silently fails to be called/messaged. For a partner who isn't Brendan, this turns every typo into a hard-to-diagnose production incident on a paying client.
- **Fix:** Add a lightweight 'Verify' button per credential group that does a cheap read against each provider (Retell list-agents v2, GHL location GET, Twilio account fetch, OpenRouter models) and shows pass/fail inline. Reuse existing proxies (retell-proxy already lists agents). Cheap to build, high demo value, and prevents silent dead-on-arrival clients.

---

## Note on CA1 (this matters)
Finding in §5 ("GHL Webhook V2 signs with RSA public key, not HMAC") means the verify-if-present GHL signature code added in CA1 — and the pre-existing `bookings-webhook` it was copied from — uses the wrong primitive for GHL. It is inert today (0 clients have secrets), but **BR3 (provision webhook secrets) must not proceed for GHL until the signing mechanism is corrected to RSA-SHA256 against GHL’s public key.** The Retell path (`retell-call-webhook`, HMAC) is unaffected.

---

## Live-DB verification (2026-06-10, platform `bjgrgbgykvjrsuwwruoh`)

Spot-checked the schema-drift findings against the live DB via the Management API:

- **CONFIRMED missing on `clients`:** `sync_ghl_booking_enabled` (DI-1), `stripe_customer_id`, `stripe_subscription_id`, `subscription_tier` (DI-2/DI-3). `subscription_status` exists.
- **CONFIRMED missing tables:** `lead_ai_columns`, `lead_ai_values`, `lead_tags`, `lead_tag_assignments` (DI-4); `sync_ghl_executions`, `sync_ghl_booking_executions` (DI-9, audit trail silently lost — inserts are try/caught so non-fatal).
- **DOWNGRADE — EFC-2:** `scheduled_callbacks` table DOES exist; the "lost callback because table missing" claim is wrong. Only the unchecked-insert-error (false success) part may stand.
- **DOWNGRADE — SEC-RLS-02:** `presentation_chat_threads`/`presentation_chat_messages` do NOT exist in the platform DB, so the `USING(true)` policy is a near non-issue for the live tenant (the migration likely only applied to the dev DB).
- **CONFIRMED real targets:** `analytics_results`, `prompt_versions`, `setter_ai_reports` all exist (compute-analytics write target and SEC-RLS-01 tables are real).
