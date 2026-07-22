# BFD-Setter — FIRST-CLIENT TASKS (single home for everything gated on the first paying client)

**Why this list exists:** everything below is **gated on onboarding the first real client** and was cluttering the
active day-to-day lists (BUG_LIST / TEST_LIST / BRENDAN_TODO / DEFERRED). It is consolidated here so it stops
"popping up" during normal work. **None of it is actionable until a client actually signs** (or, for GATE A,
until the first client-role *user* is invited). Created 2026-07-11 by the full-list reconciliation.

- **The runbook** for actually executing the go-live is `Docs/FIRST_CLIENT_MILESTONE.md` (trigger: Brendan says
  "I'm onboarding a client"). THIS file is the consolidated **backlog/index** of what that milestone must cover,
  pulled out of the other lists. When the milestone runs, work from here + the milestone runbook together.
- **Live enabling-state (verified 2026-07-11):** `0` client-role users · `0` clients with `retell_webhook_secret` ·
  `0` clients with `missed_call_textback_enabled` · 2 internal clients share 1 agency · `subscription_status='active'`
  set manually on both. So the GATE A (RLS) and GATE B (Retell-webhook) clusters below are **latent today** and arm
  the instant the first client-role user exists / the secret is armed.
- Full security detail behind GATE A/B: `Docs/SECURITY_REVIEW_2026-07-08.md` + `Docs/GATE_A_RLS_DRAFT_2026-07-08.md`.

---

## ⭐ Do these FIRST at onboarding (Brendan's call 2026-07-21 — pulled forward out of the general backlog)

Both were candidates for the v1-finish loop but Brendan chose to stand them up AS PART OF onboarding the first
client, near the top of the setup order. The arming runbook (`Docs/FIRST_CLIENT_ARMING_RUNBOOK.md`) lists them as
step 0.

- [ ] **Supabase backups + one restore test (+ decide Pro).** The project is on the FREE tier, which has **no
  automated backups**. Decide the Pro upgrade (also unblocks the HIBP password-breach check), then confirm backups
  exist and run **one restore into a scratch project** before any client data lands. No client goes on an untested
  backup. ~2h. (PROJECT_OVERVIEW 11H / 12-B9.)
- [ ] **Resend SMTP (`RESEND_API_KEY`).** Free-tier Resend account → verify `buildingflowdigital.com` (DKIM/SPF) →
  API key → Claude PATCHes Supabase Auth SMTP + sets `RESEND_API_KEY` + `ERROR_DIGEST_RECIPIENT` on Trigger prod.
  Unblocks: F14 invite/reset emails, the weekly ROI report email, AND the error-digest EMAIL leg (the Slack/Telegram
  leg is already live as of 2026-07-21). Full detail below under "Resend SMTP (M1)". ~1h.

## GATE A — role-gate the RLS cluster BEFORE inviting the first client-role user

> **✅ SHIPPED + VERIFIED 2026-07-13 (Opus 4.8, plan-approved, continuous session). The last pre-client CODE gate is
> CLOSED.** Full detail + exact live state: `Operations/handoffs/2026-07-13-gate-a-rls.md`. 3 migrations
> (`20260713120000/130000/140000`) + 4 edge fns (fetch-thread-previews / twilio-list-numbers / supabase-project-usage
> **v11**, get-openrouter-usage **v2**) + a frontend ticker role-branch. Design = Option A (clients command-split +
> `guard_client_clients_update` trigger freezing subscription_status + bundled keys) with `leads` role-split too.
> Proven with a throwaway agency + client-role probe across two sibling clients in one shared agency: **24/24** — agency
> unaffected; client sees only its own row (no siblings, no secrets — `retell_api_key` SELECT → 42501), UI-state writes
> persist, subscription_status/bundled-key self-escalation blocked by the trigger, all 4 sibling edge fns → 403. Owed:
> the agency-UI browser smoke + the first real client-role login (→ `TEST_LIST.md`). Three catches the draft missed,
> found + fixed live: (1) `clients_public` was `security_invoker` → recreated `security_definer` + tenant WHERE;
> (2) the client-own UPDATE needed a client-own SELECT policy + a table→column SELECT REVOKE (111 non-secret cols) to
> work without leaking secrets; (3) `get-openrouter-usage` (RLS-ORUSAGE-1) allowed client-role → agency-gated.

> **2026-07-22 update:** the agency-UI browser smoke PASSED 2026-07-13 (headless, 4/4 twice — it also caught + fixed
> the `isAgency` white-screen). The only remaining GATE-A verification is the first REAL client-role login, tracked
> as the row below (moved here from TEST_LIST — it can only run at onboarding).

- [ ] **GATE-A first client-role login (at onboarding).** The first real client-role user sees ONLY its own
  dashboard/CRM/tags, no sibling data, no secret values, the ticker hides OPENROUTER_BALANCE, and its UI-state
  prefs (crm_filter_config: column widths, filters) persist across reloads. (Server-side already proven 24/24
  with a throwaway probe; this is the belt-and-braces live-UI leg.)
- [x] **RLS-CLIENTS-1 (Critical)** — DONE. clients command-split (SELECT/INSERT/DELETE agency-role-gated; UPDATE agency
  OR client-own-row) + guard trigger freezing subscription_status + bundled keys + client-own SELECT + secret-column
  SELECT REVOKE. clients read via `clients_public` (now security_definer).
- [x] **RLS-CREDENTIALS-1 (High)** — DONE. `agency_all_credentials` role-gated agency-only.
- [x] **RLS-TENANT-DISJUNCTION-1 (Med)** — DONE. All 7 parents split into agency-role-gated FOR ALL + client-own FOR ALL.
- [x] **RLS-TAGTABLES-1 (Low, VERIFY)** — RESOLVED. Live pg_policies showed `lead_tags`/`lead_tag_assignments` already
  tenant-scoped (NO lingering `USING(true)` orphans; `contact_tags`/`contact_tag_assignments` renamed away). `lead_tags`
  folded into the disjunction split; `lead_tag_assignments` inherits `leads`.
- [x] **RLS-GATE-SIBLING-1 (Med)** — DONE. 3 edge fns repointed to `resolveClientAccess` (supabase-project-usage also
  moved its secret read to the service role). All → 403 for a sibling client_id in the probe.
- [x] **RLS-ORUSAGE-1 (Med)** — DONE. `openrouter_usage_cache` agency-only + `get-openrouter-usage` agency-gated (was a
  2nd margin-leak vector) + ticker role-branched to skip the read for client-role.
- [x] **RLS-UNIPILE-1 / RLS-AGENCIES-1 (Low)** — DONE. `unipile_accounts` agency-role-gated; `agencies` UPDATE role-gated.
- [x] **LEADS-ROLE-SPLIT-1 (added 2026-07-13)** — DONE. `leads` role-split (agency FOR ALL + client-own FOR ALL); children
  `lead_ai_values` / `lead_tag_assignments` inherit. Probe: client reads only its own leads, sibling leads → 0 rows.

## GATE B — arm `retell_webhook_secret` + fail-close the Retell auto-actions (milestone step 6.6)

**Arming the secret authenticates all three Retell webhooks at once.** Until it is armed these stay as-is (fail-closing
them while the secret is NULL would break live features). At arm time, apply the F16C-SMS-1 `signatureVerified`
fail-closed pattern (already shipped in `retell-call-webhook` v24) to the auto-actions below.

- [ ] **Arm `retell_webhook_secret`** (= the Retell API key; one controlled live call, revert to NULL on any 403) +
  provision the GHL/Retell/Unipile webhook signing secrets. (DEFERRED 6.6.)
- [ ] **RETELL-BOOKING-SMS-1 (High, exploitable today until the secret is armed)** — forged `call_analyzed` with
  `appointment_booked=true` + attacker `to_number` sends a Twilio SMS to the attacker's number
  (`retell-call-analysis-webhook/index.ts:643-732`). Closed by arming the secret + the fail-closed guard.
- [ ] **RETELL-CALLHIST-POISON-1 (Med)** — forged `call_analyzed` injects attacker `call_history` +
  `execution_cost_events` rows (fresh `provider_ref` defeats idempotency) → poisons funnel/report/cost ledger. Rises to
  High once the ledger is wired to billing.
- [ ] **RETELL-CALLBACK-DIAL-1 (Med)** — forged payload schedules an outbound Retell voice call to the attacker's number
  (needs a valid `voice_setter_id` UUID = capability barrier).
- [ ] **RETELL-INBOUND-PII-1 (Low)** — forged `call_inbound` returns a lead's name/email in `dynamic_variables`
  (`retell-inbound-webhook`; unsigned). Closed by arming the secret.
- [ ] **F16C-SMS-1-LIVE (behavioral test, gated on the secret)** — the CODE fix is DONE + live (retell-call-webhook v24,
  archived 2026-07-11). Once the secret is armed + Retell signing configured: a forged unsigned `call_ended` produces
  the SUPPRESSED warn + NO SMS; a real signed missed inbound call sends. Until then, confirm no regression.

## Stripe / subscription go-live

- [ ] **Stripe live** — backfill `subscription_status`, then set `ENFORCE_SUBSCRIPTION_GATE=true`
  (`_shared/assertActiveSubscription.ts` ships dormant); prove a delinquent client is blocked and an active one is not.

## AU SMS A2P

- [ ] **AU SMS A2P / Messaging Service registration for `+61481614530`** — Twilio accepts messages but AU handset
  delivery on the bare long code is slow/unconfirmed; register A2P or confirm the regulatory bundle. Plain Twilio
  numbers are exempt from the ACMA Sender ID Register (live 1 July 2026); register an alpha sender ID only if the
  client wants branded SMS.

## Onboarding prerequisites (the un-automated steps to stand up a client — from the 2026-07-06 dry run)

Full report: `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md`. Most are code-fixable (see the onboarding self-serve item in
`FEATURE_ROADMAP.md`), but today they are manual.

- [ ] **External Supabase project (SOP §2.1) — the #1 un-automated blocker.** Create a `<slug>-setter-live` project,
  grab URL + `sb_secret_*` key, run the 5-table seed SQL, paste into Credentials. HARD dependency for BOTH text and
  voice setter authoring (create-setter and text-save 400 without it).
- [ ] **GHL location + Private Integration Token** (Contacts, Conversations, Calendars, Workflows, Custom Fields) →
  `ghl_location_id`, `ghl_calendar_id`, `ghl_assignee_id`, custom fields (echo-guard, conversation deep-link,
  `ghl_channel_field_id`, `ghl_conversation_provider_id`) + webhook actions carrying `x-wh-token`. Everything lead-side
  is GHL-gated (`intake-lead` 409s without it).
- [ ] **Twilio BYO (client-owned): SID + auth token + E.164 number — NOT UI-editable.** Set via `onboard-client.mjs`
  or SQL. Number must be UNIQUE (sharing another client's `retell_phone_1` breaks inbound routing) and imported into
  Retell before inbound bind. A2P is the client's (weeks).
- [ ] **Flip `subscription_status`→`active`** on the new client (UI create sets `free`). (`use_native_text_engine`
  is already set true at birth by all create paths.)
- [ ] **Confirm the canonical text `llm_model` (SOP §11).** Decide the one true production text model (DB default
  `google/gemini-2.5-pro`; onboard-client.mjs default differs; voice setters seed a flash model). A migration exists
  (`20260709120000_canonical_text_llm_model_gemini_2_5_flash.sql`, uncommitted as of 2026-07-11) — resolve + apply.
- [ ] **Confirm onboarding minted a FRESH agency for this client** (RLS-UISTATE: two clients sharing one agency would
  cross-read each other's UI-state; this is the mitigation for keeping RLS-UISTATE-1 safe in practice).
- [ ] **GHL reminder-workflow snapshot** (best built once, ahead of time, reused per client): instant booking-confirm
  SMS → 24h reminder with confirm trigger-link → 2h short reminder → reschedule link in every touch → post-appointment
  status branch (showed / no-show). SMS reminders cut no-shows 38-40%; this is GHL config, not code. Pairs with F15's
  status sync-back.

## Resend SMTP (M1 — do this as ONE OF THE FIRST onboarding steps)

- [ ] **Provision Resend SMTP** (provider decided: Resend; already wired — `RESEND_API_KEY` + the SMTP PATCH payload;
  free tier $0). Steps: create a free Resend account → verify `buildingflowdigital.com` (DKIM/SPF DNS) → API key →
  Claude PATCHes Supabase Auth custom SMTP (`smtp_host/user/pass/sender`, all NULL as of 2026-07-07) + sets
  `RESEND_API_KEY` on Trigger.dev prod + a report recipient. Unblocks F14 invite/reset emails + flips the F15 weekly
  report from stubbed to live. Payload: `Operations/handoffs/2026-07-02-usage-billing-auth.md`.
- [ ] **F14 invite + self-reset E2E (AFTER Resend lands)** — send an invite to a test address (lands on "Set Your
  Password", 12-char minimum), and run a client-role `/forgot-password` (now allowed). Agency reset still works.
- [ ] **F15 weekly report email flips live (AFTER Resend lands)** — the `weeklyClientReport` cron sends when
  `RESEND_API_KEY` is set + a recipient email is configured on the client's "Client ROI reporting" card. No code change.

## Billing config (set at/around onboarding)

- [ ] **Confirm the `sms_llm` seed rate** — the per-text sell rate seeded at US$0.003/msg; sanity-check against real
  OpenRouter usage and tune in the pricing panel.
- [ ] **Set per-client billing anchor day + client-visibility toggles** — Sub-Account Config → Cost-to-Price Calculator:
  billing anchor day (default the 1st) + flip on whichever of rate / minutes / texts / month-total the client may see
  (all default OFF).

## Compliance close-out (at go-live)

- [ ] **Recording disclosure ON** for the client (PU-6 pattern applied to its agent), **calling-hours enforcement
  confirmed** (F17 phase 1, already live), **consent source/method/timestamp** recorded for their lead flow.
- [ ] **Flip HIBP** (`password_hibp_enabled=true` via Mgmt API) IF Supabase Pro has landed. Also min-len 12, MFA on.

## Client-data-gated verifications (need real client traffic to exercise)

- [ ] **COST-1 — voice cost event accrues.** After a real answered outbound client call, confirm an
  `execution_cost_events` row: `cost_kind='voice'`, real `cost_usd`, non-null `execution_id`, `is_estimated=false`.
- [ ] **COST-2 — SMS cost event accrues.** After a cadence outbound SMS, confirm an `sms` row (`quantity`=segments,
  `is_estimated=true`, `provider_ref`=twilio_sid, `execution_id` set).
- [ ] **COST-3 — LLM cost event accrues.** After an AI engagement execution, confirm one `llm` row per execution with
  `execution_id` + non-zero real `cost_usd`.
- [ ] **BOOKTZ-1 — cross-tz lead hears both zones.** With a real interstate lead (`leads.timezone` ≠ business tz):
  (a) TEXT setter states times in both zones; (b) after PU-13, VOICE setter does too; (c) the booked absolute instant
  stays business-tz (the no-leak assertion). Dormant until a real interstate lead segment exists. Voice half needs PU-13.

## Post-client build queue (gated on real usage/data, NOT before a client)

These stay tracked in `FEATURE_ROADMAP.md` / `Docs/DEFERRED.md`; listed here so they're visible as first-client-gated:

- **F18** AI voice confirmation call ~24h before appointment (fast-follow).
- **F19** call QA digest with sentiment/failure flagging.
- **F20** booked-revenue attribution (top renewal lever — before the first renewal).
- **F12** voice per-minute cost optimization (explicitly gated: after the first paying client, per Brendan).
- **Minutes-pool burn-down + cost-vs-billed reconciliation** over `execution_cost_events` (the P2 ledger has no read
  surface yet) — recommend promoting to a committed build soon after first client.
- **F8 v2 / 2.6 cost-per-booking / 3.9 cost-ceiling aggregates / 4.1 pricing model** — all gated on ~60 days of real
  accrued cost data (`Docs/DEFERRED.md`).
- **3.1 A/B testing** — gated on a client with ~50+ leads/week.
- **3.11 HubSpot + GHL coexistence** — gated on a HubSpot client signing.
