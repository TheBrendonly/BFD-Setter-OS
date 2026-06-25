# Audit Reconciliation — 2026-06-10 Full-System Audit vs Current Code (2026-06-19)

Walks every confirmed finding in `Docs/AUDIT_2026-06-10_full-system-audit.md` (62 findings) against the **current** code at HEAD `d4c5626` (≈90 commits ahead of the audit), its migrations, and the **live** platform DB (`bjgrgbgykvjrsuwwruoh`). Each finding gets a verdict + the citation that proves it. Genuinely-open items were promoted into `Docs/BUG_LIST.md` (the "Audit-sourced" section).

**Method:** 8 verifiers fanned out by audit section + file domain, each verdicting its findings against current code (grep the actual symbol, not the stale audit line numbers; check schema-class claims against the live DB via the read-only Management API, never `types.ts`). Every `STILL-OPEN`/`PARTIAL` verdict then went through an independent **adversarial re-proof pass** (prompt: "try hard to prove it is actually fixed") before it was allowed to stand — this flipped several first-pass opens to FIXED.

## Tally

| Verdict | Count |
|---|---|
| **FIXED** | 34 |
| **STILL-OPEN** | 11 |
| **PARTIAL** | 14 |
| **DOWNGRADED / MOOT** | 3 |
| **Total** | **62** |

- **Promoted to `BUG_LIST.md`:** 19 (1 high · 6 medium · 9 low · 3 feature). All are genuinely new vs the existing live-E2E `6.x` items; two cross-link (retell-call-webhook → 6.6, resolveContactId → 6.10/6.5).
- **Not promoted:** 34 FIXED (resolved), 3 MOOT (premise false on live DB / no-defect verification result), 2 PARTIAL already tracked (`6.6` webhook-secret provisioning, `6.7` synthetic probe), and the residual halves of items whose actionable part was already fixed.
- The bulk of the audit closed in the two 2026-06-10 fix waves (`06425c3` wave 1 + `47b97d5` wave 2) plus the subsequent build clusters (call-path idempotency `302ad45`, GHL-cut-out `860f037`, by-phone `d867d5a`, voice-booking `c5d7040`, account-access `b1ad2e0`).

---

## §1 — Brendan action items (5)

- **S1-1 · Frontend pulls client secret columns into the browser via `.select()` (F7 residual)** — **STILL-OPEN** (high, Brendan). ~36 src files still select `supabase_service_key`/`twilio_auth_token`/`openrouter_api_key`/`openai_api_key`/`retell_api_key`/`ghl_api_key` into the browser; `clients` RLS is row-level not column-level (verified live: `authenticated` holds unrestricted SELECT, no `clients_public` view / column REVOKE). The exact interim anti-pattern (presence-only `!!token`) persists at `RetellPhoneNumbersTab.tsx:63`, `RetellPhoneNumberSelector.tsx:147`. → **BUG_LIST**.
- **S1-2 · `process-lead-file` references 4 non-existent tables** — **FIXED** (`95a92b3` / migration `20260610130000_audit_lead_file_schema`). `lead_ai_columns`, `lead_ai_values`, `lead_tags`, `lead_tag_assignments`, `client_custom_fields` now exist live with F6-pattern RLS; the `onConflict('lead_id,tag_id')` is satisfied by `lead_tag_assignments_lead_id_tag_id_key`.
- **S1-3 · Inbound state-mutating webhooks unauthenticated until secrets provisioned** — **PARTIAL** (medium, Brendan) · tracked **6.6**. Code improved (verify-if-present + static `x-wh-token`, `b17e558`), but live provisioning is partial (2 clients; `ghl_webhook_secret` set on 1, `retell_/unipile_webhook_secret` 0/2). Not separately promoted — it's the deferred-secrets decision + 6.6.
- **S1-4 · `types.ts` reflects the dev DB not the platform DB** — **PARTIAL** (low). A `check-schema-drift.mjs` guard (DI-10) exists; types.ts is still the dev-shaped superset. Root-enabler, low urgency; not separately promoted (covered by the schema-drift guard intent).
- **S1-5 · Dead `deploy_voice_prompt.mjs` + `.env.example` propagate a deleted Retell LLM/agent id** — **STILL-OPEN** (low, Brendan, report-only). `llm_22e795…` / `agent_5ec5eb…` still hardcoded as fallbacks/defaults. → **BUG_LIST**.

## §2 — Security & IDOR (19)

**The classic unauthenticated-edge-fn IDOR set — all FIXED via `authorize-client-request` (`06425c3`):**
- **S2a-1 compute-analytics**, **S2a-2 trigger-engagement**, **S2a-3 workflow-execute**, **S2a-4 push-engagement-now**, **S2a-5 retry-dm-execution**, **S2a-6 push-followup-now**, **S2a-7 refresh-usage-cache** — **FIXED**. Each now gates on `authorizeClientRequest` / `grantsServiceRole` before any write; compute-analytics also stopped trusting body-supplied client URL/key.

**RLS + webhook-auth residuals:**
- **S2b-1 · `prompt_versions` + `setter_ai_reports` `USING(true)` RLS** — **FIXED** (`06425c3` / migration `20260610121000_audit_prompt_rls_tenant_scope`). Permissive policies dropped; agency-scoped only (verified live `pg_policies`).
- **S2b-2 · `presentation_chat_threads/messages` anon `USING(true)`** — **DOWNGRADED-MOOT**. Tables do not exist on the live platform DB (audit footer downgrade confirmed via live `pg_tables`).
- **S2b-3 · `workflow-inbound-webhook` warn-and-accept when secret set but no header** — **FIXED** (`b17e558`; now 403s on wrong-proof-when-secret-set).
- **S2b-4 · `voice-booking-tools` (+`kb-ingest`) fail-OPEN when `intake_lead_secret` is NULL** — **PARTIAL** (medium). Bearer check skipped when secret NULL (`voice-booking-tools:120`, `kb-ingest:94`); masked today (both live clients have the secret) but a new client reopens money/state tools to any clientId-knower. → **BUG_LIST** (fail-closed).
- **S2b-5 · `campaign-enroll-webhook` authed only by a URL-query token** — **STILL-OPEN** (medium). `enroll_webhook_token` from `?token=`/body, no HMAC/replay/rate-limit (`index.ts:18-47`). → **BUG_LIST**.
- **S2b-6 · `contact_tags` / `contact_tag_assignments` cross-tenant `USING(true)`** — **DOWNGRADED-MOOT** (premise false on live DB per verifier).
- **S2b-7 · `intake-lead`/`kb-ingest`/`voice-booking-tools` conditional auth** — **PARTIAL** (`06425c3` hardened intake-lead to 403). Residual = the `voice-booking-tools`/`kb-ingest` fail-open half (= S2b-4).
- **S2b-8 · `push-engagement-now` `.or()` filter from unvalidated DB string** — **FIXED** (`06425c3`; IDOR source closed + filter hardened).
- **S2b-9 · `sync-ghl-contact/booking` sig checked AFTER DB writes + GHL fan-out** — **PARTIAL** (`06425c3` made `bookings-webhook` the canonical single-lookup signed ingress). Residual = inherent resolve-then-verify ordering; low, not separately promoted.
- **S2b-10 · Twilio sig non-constant-time + no replay protection** — **STILL-OPEN** (low). `expected === signatureHeader` at `receive-twilio-sms:274`, `twilio-status-webhook:55`, `twilio-inbound-sms:34`; STOP/START branch runs before the SID dedup so a replay re-fires a billed compliance SMS. → **BUG_LIST**.
- **S2b-11 · `retell-call-webhook` stamps outcome from a spoofable `agent_id` before optional sig check** — **PARTIAL** (low; `2bedfb3` did the sig-verify rewrite). Outcome stamp still matches only `.eq('id', executionId)` (`:168-185`) with sig skipped when secret unset → a forged `call_ended` mis-routes a cadence. Code hardening (require `active_call_id == call.call_id`) is distinct from arming the secret (6.6). → **BUG_LIST** (cross-link 6.6).
- **S2b-12 · `unipile-webhook` trusts caller `client_id` to pick the secret** — **PARTIAL** (low). Unipile DM not in active use; not promoted (matches the deferred-Unipile decision).

## §3 — Bugs / data-integrity / correctness (15)

- **S3a-1 · `isCancelled` ignores `completed` (booking may not self-stop cadence)** — **FIXED** (`06425c3`; terminal set now includes completed/failed).
- **S3a-2 · Outbound Retell call placed twice on retry (no idempotency)** — **FIXED** (`302ad45`; call-path idempotency key + dedup).
- **S3a-3 · Quiet-hours/schedule gate bypassed for later channels in a multi-channel node** — **STILL-OPEN** (medium). `enforceQuietHoursBeforeSend` only at node entry (`runEngagement.ts:962`); per-channel `wait.until` then sends with no re-gate. → **BUG_LIST**.
- **S3a-4 · Multi-channel engage node re-sends on Trigger retry** — **FIXED** (`302ad45`).
- **S3a-5 · `wait_for_reply` counts outbound as inbound** — **FIXED** (`06425c3`; inbound direction/channel filter added).
- **S3a-6 · Drip node not idempotent on retry (re-claims slot, inflates batch counter)** — **STILL-OPEN** (low). `claim_drip_position` increments every call; replayed mid-wait node consumes a 2nd slot. → **BUG_LIST**.
- **S3a-7 · `executeWorkflow` `workflow_execution_steps` onConflict with no constraint** — **FIXED** (`06425c3` / migration `20260610120000_audit_workflow_steps_unique`).
- **S3b-1 · `sync-ghl-booking` selects non-existent `clients.sync_ghl_booking_enabled`** — **FIXED** (`06425c3`).
- **S3b-2 · `processMessages` double-texts via GHL webhook AND direct Twilio** — **FIXED** (`860f037`; GHL cut out of SMS send path, Twilio sole sender).
- **S3b-3 · `voice-booking-tools` lookup-contact queried `ghl_contact_id` (always-null preview)** — **FIXED** (`d867d5a`).
- **S3b-4 · Outbound voice calls query non-existent `messages` table → `{{chat_history}}` always empty** — **STILL-OPEN** (medium). `fetchChatHistory` at `make-retell-outbound-call:340` + `outbound-call-processing:206` query a bare `messages` table that has no `role/body/lead_id`. → **BUG_LIST**.
- **S3b-5 · `schedule-callback` unchecked insert → false success** — **FIXED** (`c5d7040`).
- **S3b-6 · `voice-booking-tools` `resolveContactId` takes first GHL substring match (wrong-contact risk)** — **PARTIAL** (medium; `d867d5a` added internal-first by-phone). GHL fallback still accepts `contacts[0]` from a fuzzy query with no equality check — fires for new callers / `normalized_phone`-NULL leads. → **BUG_LIST** (cross-link 6.10/6.5).
- **S3b-7 · `unipile-webhook` onConflict vs 3-col constraint** — **FIXED** (`06425c3`).
- **S3b-8 · `twilio-status-webhook` updates non-existent `message_queue.status`** — **FIXED** (`06425c3`).

## §4 — Reliability & observability (10)

- **S4-1 · Inbound-SMS ingress failures silent (no `error_logs`) — REL-03** — **FIXED** (`302ad45`).
- **S4-2 · Retell retry storm: non-retryable 4xx retried 3× — REL-01** — **FIXED** (`302ad45`; AbortTaskRunError on permanent 4xx).
- **S4-3 · `runEngagement` whole-task retry re-sends before index commit — REL-04/CAD-01** — **FIXED** (`302ad45`).
- **S4-4 · `nudgeColdReply` opt-out staleness + references unselected `business_name`/`custom_fields`** — **PARTIAL** (medium). Opt-out half now covered by the by-phone send gate (`e9a00f8`); residual = the two columns omitted from the SELECT (`nudgeColdReply.ts:76-77`) → every nudge generated without business name / custom fields. → **BUG_LIST** (personalization-regression half only).
- **S4-5 · Single e2e monitor outbound-only + dark** — **PARTIAL** (medium, Brendan) · tracked **6.7**. Not separately promoted.
- **S4-6 · `active_call_id` never cleared on call-outcome timeout — VC1** — **FIXED** (`302ad45`). (Distinct from 6.11, which is the *voicemail/no-answer outcome stamping* gap, still open in BUG_LIST.)
- **S4-7 · CA3 `setter_stopped` recheck coverage complete** — **DOWNGRADED-MOOT** (verification result, no defect).
- **S4-8 · `test-external-supabase` returns HTTP 200 on every error path** — **STILL-OPEN** (low). → **BUG_LIST**.
- **S4-9 · `retell-call-webhook` no `error_logs` writes — REL-06** — **FIXED** (`302ad45`).
- **S4-10 · `retell-call-webhook` picks `clients[0]` for a shared master agent** — **STILL-OPEN** (low). No disambiguation when `agent_id` maps to >1 client (`index.ts:67-78`); latent at single tenant, cross-tenant hazard as clients grow. → **BUG_LIST**.

## §5 — Config / dependencies / build (7)

- **S5-1 · GHL handlers assumed HMAC but GHL V2 signs RSA (WI-1)** — **FIXED** (`06425c3`; switched to static `x-wh-token` model + RUNBOOK/SOP corrected).
- **S5-2 · DOMPurify 3.2.6 XSS advisories** — **FIXED** (`06425c3`; bumped within major).
- **S5-3 · react-router-dom 6.30.1 XSS open-redirect** — **FIXED** (`47b97d5`; → 6.30.4).
- **S5-4 · Edge functions no Deno lockfile/import_map (non-reproducible deploys)** — **PARTIAL** (low). `aa9e72b` dropped+gitignored `frontend/deno.lock`; transitive `npm:`/`esm.sh` versions still float. → **BUG_LIST**.
- **S5-5 · No Node `engines` pin** — **FIXED** (`06425c3`).
- **S5-6 · supabase-js version drift (Stripe fns on oldest 2.45.0)** — **FIXED** (`47b97d5`; pinned 2.101.0 across imports).
- **S5-7 · Vite/esbuild dev-server advisories** — **PARTIAL** (low). vite bumped to 5.4.21 but transitive esbuild still 0.21.5 (GHSA-67mh-4wv8-2f99). Dev-server only; prod is a static build. → **BUG_LIST**.

## §6 — Features to build (6)

- **S6-1 · No UI to set per-client webhook secrets** — **FIXED** (`fcfe6f0`; ApiManagement "Webhook Security" card).
- **S6-2 · No per-client onboarding/health readiness dashboard** — **STILL-OPEN** (medium, feature). → **BUG_LIST** (backlog).
- **S6-3 · No automated test coverage / no runner wired** — **PARTIAL** (medium). 11 money-path `*.test.ts` now exist but no `test` script / CI. → **BUG_LIST** (backlog).
- **S6-4 · Onboarding leaves high-automatable external wiring manual** — **STILL-OPEN** (medium). `onboard-client.mjs` never calls `twilio-configure-webhook` / never PATCHes the 5 Retell tool URLs. → **BUG_LIST** (backlog).
- **S6-5 · ApiManagement/ApiCredentials raw-secret pages with no route role-gating** — **PARTIAL** (low). Not exploitable today (agency-only RLS verified live) but `ApiCredentials` route is under `ClientRouteGuard` only, not an agency/creator guard (`App.tsx:264/278`). → **BUG_LIST** (defence-in-depth).
- **S6-6 · No connectivity/credential validation button** — **FIXED** (`08b79f4`; credential-verify shipped in Tier 4).

---

## DOWNGRADED / MOOT (no action)
- **S2b-2** `presentation_chat_*` — tables absent on the live platform DB.
- **S2b-6** `contact_tags`/`contact_tag_assignments` — premise false on the live DB.
- **S4-7** CA3 `setter_stopped` recheck — a verification result confirming complete coverage, not a defect.

## Already tracked elsewhere (cross-link, not re-promoted)
- **S1-3 / S2b-11 provisioning** ↔ `6.6` (Retell inbound webhook secret) + the `feedback_retell_unipile_secrets_deferred` "defer till first paying client" decision.
- **S4-5** ↔ `6.7` (synthetic-probe canary).
- **S4-6 vs 6.11:** S4-6 (`active_call_id` cleared on timeout) is FIXED; 6.11 (stamp `last_call_outcome` for voicemail/no-answer so the cadence advances promptly) remains a distinct, still-open item in BUG_LIST.
