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

## GATE A — role-gate the RLS cluster BEFORE inviting the first client-role user

**Hard prerequisite: must ship before the first client-role user is created.** High blast radius (`clients` has
79+ reads) → dedicated careful session with a live throwaway-client-role probe, NOT unattended. Draft migration +
per-table open questions + verification steps: `Docs/GATE_A_RLS_DRAFT_2026-07-08.md`.

- [ ] **RLS-CLIENTS-1 (Critical, latent)** — base `clients` policies have no `get_user_role()='agency'` gate and
  `anon`/`authenticated` hold column SELECT/UPDATE/INSERT on the secret columns. A client-role user would read every
  sibling's `supabase_service_key` (full-DB key), Twilio token, and BFD-bundled Retell/OpenRouter/GHL keys, and could
  `UPDATE subscription_status` / DELETE sibling rows. Fix: add the role gate to all four `clients` policies (mirror
  `client_pricing_config`), keep client reads on `clients_public`, consider `REVOKE` on secret columns from `authenticated`.
- [ ] **RLS-CREDENTIALS-1 (High, latent)** — `credentials.gohighlevel_api_key` readable by a client-role user (ungated
  agency policy; no browser read, so a role-gate is pure hardening).
- [ ] **RLS-TENANT-DISJUNCTION-1 (Med, latent)** — `client_custom_fields`, `lead_ai_columns`, `lead_tags`,
  `prompt_chat_threads`, `prompt_docs`, `prompt_versions`, `setter_ai_reports` use `c.agency_id=p.agency_id OR
  c.id=p.client_id` — the agency disjunct gives a client-role user read+write of sibling rows. Split into agency +
  client-own policies (the RLS-UISTATE-1 shape shipped 2026-07-08).
- [ ] **RLS-TAGTABLES-1 (Low, latent, VERIFY — added 2026-07-12 red-team pass)** — a source-only read of early
  migrations flagged the sibling tag tables `contact_tags`, `contact_tag_assignments`, and `lead_tag_assignments` as
  possibly still `FOR ALL TO authenticated USING (true)` (globally cross-tenant — WORSE than the agency-disjunction on
  `lead_tags` above), with no re-gating migration found for these three. **Verify the LIVE policy** in the GATE A probe
  (`select * from pg_policies where tablename in ('contact_tags','contact_tag_assignments','lead_tag_assignments')`); if
  `USING(true)` or the agency disjunction, re-gate to agency + client-own like the RLS-UISTATE-1 shape. Low value (tag
  data only), but a tenant-isolation gap to close with the rest of GATE A.
- [ ] **RLS-GATE-SIBLING-1 (Med, latent)** — `fetch-thread-previews` / `twilio-list-numbers` / `supabase-project-usage`
  authorize via an RLS-gate (`clients.eq(id).single()`) not `resolveClientAccess`, so a client-role user passing a
  sibling `client_id` reads the sibling's Twilio numbers / thread previews / Supabase usage. Repoint to `resolveClientAccess`.
- [ ] **RLS-ORUSAGE-1 (Med, latent)** — `openrouter_usage_cache.cached_data` (BFD margin/cost) readable by a client-role
  user. NOTE the table IS browser-read (`useTickerStats`/`useOpenRouterUsage`), so the fix must role-branch (agency-only
  read), not merely add a gate.
- [ ] **RLS-UNIPILE-1 / RLS-AGENCIES-1 (Low, latent)** — client-role user could read a sibling's connected LinkedIn/IG
  display name+id (`unipile_accounts`) / rename the shared agency (`agencies`). Fold into the GATE A role-gate sweep.

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
