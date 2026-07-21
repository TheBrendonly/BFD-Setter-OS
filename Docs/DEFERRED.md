# BFD-Setter — Deferred List (someday / gated)

Things deliberately not being built now, each with the gate that would un-defer it. Reconciled 2026-06-25.

## ⭐ MAJOR — add soon (next big build)

- [ ] **Lead lifecycle system** = roadmap 3.5 + 3.6 + 3.7, treated as one feature.
  - **3.5 engine** — multi-workflow enrollment state machine: a lead transitions between workflows (Hot Pursuit → Cool Down → Long-Tail → Re-engage) instead of living in one cadence. **Already partly built** on branch `feat/cadence-v2-lifecycle-wip` (`engagement_enrollments` table + `transition-lead` edge fn + Workflows UI).
  - **3.6 long-tail nurture** — a slow, email-only drip a lead enters after a cadence completes / goes silent (requires 3.5).
  - **3.7 re-warm triggers** — email-click + GHL pricing-page-visit events auto-pull a quiet lead back into Re-engage (requires 3.5 + click-tracking/GHL-event infra).
  - **Gate:** a reliable lead-state classifier (decides hot/cold/silent) + the click-tracking/GHL-event infra for 3.7. This is also the "build a better cadence v2 when needed" direction (the flat 28-node draft `c206da3e` was deleted in favor of this).

## Gated features

- [ ] **F8 v2 — cost-to-price calculator refinements.** F8 v1 shipped + deployed 2026-07-01 (admin rate card + FX + markup + per-component toggles + show-rate-to-client). v2: a **live model-aware LLM estimate** from `openrouter_usage_cache` (replace the static $0.003/min seed with the setter's actual model rate × tokens-per-minute); **post-call Retell actual reconciliation** of the voice line against `call_history.cost`; a **live FX feed** (replace the admin-set rate + buffer). **Prereq now built:** `execution_cost_events` (Session P2 2026-07-07) persists the real per-execution voice/LLM cost this v2 reconciles against. **Remaining gate:** real usage data accrued + a client asking for per-call accuracy. See `FEATURE_ROADMAP` "Feature spec - F8".
- [ ] **2.6 Cost-per-booking analytics dashboard** — `cadence_metrics` + `cadence_funnel` view exist; no chart. **Prereq now built:** the per-execution cost-tracking table (`execution_cost_events`, Session P2 2026-07-07) exists and is accruing real voice/SMS/LLM cost. **Remaining gate:** ~60 days of real accrued data + the dashboard/chart itself (which would read `execution_cost_events`).
- [ ] **3.1 A/B testing** (campaign / agent / AI-generated) — **Gate:** first paying client with ~50+ leads/week.
- [ ] **3.2 Agent-by-form-field** (within-cadence agent override) — **Gate:** a client needs same-cadence/different-agent (tag-per-campaign covers ~80%).
- [ ] **3.3 Campaign-level default voice setter** — **Gate:** per-node selection works today; revisit alongside the F2 UUID-native setter cleanup.
- [ ] **3.9 Cost-ceiling weekly/monthly aggregates** — **Prereq now built:** the per-execution cost-tracking table (`execution_cost_events`, Session P2 2026-07-07) exists (cost is no longer only in-memory). **Remaining gate:** build the rolling aggregate over `execution_cost_events` (today `client_cost_rollup` still sums the flat `cadence_metrics.cost_estimate_cents` seed — repoint it at the real ledger when this is built) + real data accrual.
- [ ] **3.11 HubSpot + GHL coexistence** `[B]` — **Gate:** a client using HubSpot signs.
- [ ] **4.1 Pricing model** (cost-plus vs retainer) `[B]` — **Prereq now built:** `execution_cost_events` (Session P2 2026-07-07) is the durable per-execution cost source cost-per-booking math needs. **Remaining gate:** enough real cost-per-booking data to model against.
- [ ] **4.3 Multi-Twilio failover** — **Gate:** combined volume exceeds one Twilio account's safe ceiling.
- [ ] **E-1 `fetch-thread-previews` 500-on-throw** — **Gate:** it has no live caller (latent); fix only if it gets wired up.
- [ ] **Email provider / custom SMTP** — **Gate:** BFD stays SMS-only by decision; build when a client needs email.
- [ ] **HIBP password-breach check** — **Gate:** Supabase Pro upgrade (flip `password_hibp_enabled=true` via Mgmt API).
- [ ] **Drop the unused `clients.text_engine_webhook` column** (F5 leftover) — the n8n code path is already gone, but the column is still referenced by the `clients_public` view (79 browser reads). Dropping it cleanly needs a coordinated `DROP VIEW` + `CREATE VIEW` (preserving `security_invoker` + grants) — not worth that risk for one inert column. **Gate:** fold it into the next intentional `clients_public` view rebuild.

## First-paying-client onboarding cluster — MOVED to `Docs/FIRST_CLIENT_TASKS.md`

> **6.6** (arm `retell_webhook_secret` + provision GHL/Retell/Unipile webhook signing secrets = GATE B) and the
> **AU SMS A2P** registration for `+61481614530` now live in `Docs/FIRST_CLIENT_TASKS.md` with the rest of the
> first-client-gated work, so they stop surfacing during normal work.

## Security hardening (deferred — post-first-client)

> From the 2026-07-12 pre-pilot red-team pass. The exploitable/latent findings were folded into GATE A/B
> (`Docs/FIRST_CLIENT_TASKS.md`) and new code items into `BUG_LIST.md` (SEC-PII-LOGS-1 / SEC-OPENROUTER-PII-1 /
> SEC-GHPROXY-1); these are the lower-priority defense-in-depth builds parked here.

- [ ] **Encrypt the `clients` secret columns at rest (pgcrypto / Supabase Vault).** GATE A (RLS role-gate + a `REVOKE`
  on the secret columns) closes the in-app read path, but the 13 secret columns (`supabase_service_key`,
  `twilio_auth_token`, `ghl_api_key`, `openrouter_api_key`, …) stay PLAINTEXT at rest, so a DB/backup compromise or a
  service-role leak exposes every tenant's downstream credentials at once. Move them behind pgcrypto or Supabase Vault
  (decrypt server-side in the edge fns that spend them). **Gate:** post-first-client hardening (pairs with the Supabase
  Pro / HIBP flip). Bigger lift than the GATE A grant fix, so deferred.
- [ ] **Broaden `bump_rate_limit` to the no-JWT LLM/compute edge fns (cost-amplification / financial DoS).** Rate
  limiting today covers only `campaign-enroll-webhook` + `crm-send-message` (+ INTAKE-RL-1 pending). The signed webhooks
  are protected by their signatures, but the no-JWT LLM/compute endpoints (`analyze-metric`, `run-simulation`,
  `generate-setter-config`, `modify-prompt-ai`, `compute-analytics`, …) have no per-caller / per-IP limit, so an
  authenticated user could amplify OpenRouter/Retell spend. **Gate:** defense-in-depth; do after GATE A pins these to
  the caller (`SEC-GHPROXY-1`'s shared-PAT limit is the same class).
- [ ] **Validate per-client external Supabase project ownership.** Clients supply their own `supabase_url` +
  `supabase_service_key`, which BFD opens an admin client against at runtime; nothing verifies the project is actually
  theirs. Low concern at 1 client. **Gate:** multi-client scale / when a hostile-client threat model becomes real.
- [ ] **Hygiene: scrub real prod identifiers from `.env.example`** (project refs, Retell agent/LLM ids, GHL location id,
  Twilio number — fingerprinting only, not secrets) and review the blanket `Access-Control-Allow-Origin: *` on the edge
  fns. Trivial, low value. **Gate:** next security-hygiene sweep. (A routine `npm audit` + Deno advisory scan belongs in
  the same sweep — the 2026-07-12 dep review found nothing obvious but ran no lockfile-level scan.)

## Other

- [ ] **`refreshCadenceFunnel` hourly task is dead (0 readers)** — `trigger/refreshCadenceFunnel.ts` runs
  `REFRESH MATERIALIZED VIEW cadence_funnel` every hour, but nothing reads `cadence_funnel` (verified 2026-07-21;
  the file's own comment notes Phase 7d closed the schema but no reader followed). Harmless but wasteful. NOT
  removed this session: deleting a Trigger task risks a dangling prod schedule (the SCHED-1 registration fragility),
  and the value is near-zero. **Gate:** next intentional Trigger-schedule cleanup — remove the task file (stops the
  hourly refresh; leave the view + `refresh_cadence_funnel()` in the DB, harmless) and confirm the schedule
  deregisters on the next deploy. Surfaced by PROJECT_OVERVIEW 12/A7.

- [ ] **DM-webhook A6 — NO ACTION (audit premise corrected 2026-07-21).** PROJECT_OVERVIEW 12/A6 said "decide
  `unipile-webhook` vs `receive-dm-webhook`, retire the loser." They are NOT competing: `receive-dm-webhook` (v18)
  is the generic inbound-DM/message ingress (the ProcessDMs UI's `WEBHOOK_URL` + a webhook-manifest entry), while
  `unipile-webhook` (v14) is the Unipile account-events callback (`unipile-proxy` posts to it + its own manifest
  entry). Each has a distinct caller; retiring either breaks it. Keep both. The DM path itself stays a
  roadmap-not-shipped surface (no live traffic) — no cleanup owed.

- [ ] **AU Privacy Act second-tranche reform (automated-decision transparency / AI disclosure)** — anticipated
  ~Dec 2026 (surfaced by the 2026-07-07 F18-F20 research refresh). No AI-specific voice-disclosure law is in force
  as of mid-2026; this is a WATCH item, not a build. **Gate:** the reform lands + names an obligation touching
  automated calls/SMS; revisit F17 phase-2 (consent audit trail) + the recording-disclosure wording if so.

- [ ] **By-phone Spec 2 — N-row merge + UNIQUE(client_id, normalized_phone)** — collapse the existing duplicate `leads` rows that share a `normalized_phone` into one survivor (richest/most-recent), repoint child tables (engagement_executions / bookings / campaign_events / dm_executions / scheduled_callbacks / message_queue / active_trigger_runs) onto the survivor, add the UNIQUE constraint, and clean up the GHL-side dupes. Spec 1 (go-forward) is live; Session 5's resilient-inbound collision guard explicitly **defers** the rare concurrent-create case here. **Gate:** needs a dry-run on the live dup set first (was the ~10-row `+61405482446` case); low urgency while GHL allow-duplicate-contacts stays OFF. See `project_internal_by_phone_leads_spec1_2026_06_18`.

- [ ] **6.12a GHL custom conversation provider POC** — deferred. The upstream project never used one (it lets GHL own the channel); the marketplace-app path is bfd-specific and painful. The **F1 deep-link feature** covers the need near-term (link from GHL to BFD's conversation view). Revisit the provider only if branded in-GHL bubbles become a hard requirement.

- [ ] **SLOT-MAP-1 — retell-proxy slot/agent-column model has no dedicated outbound slot + slot 1 double-duties as the inbound resolver** (surfaced by MAIN-OUTBOUND-SHARED-1, 2026-07-07; `retell-proxy` = frozen baseline, so report-only for now). `SLOT_TO_AGENT_COLUMN` maps slot 1 → `clients.retell_inbound_agent_id`, slots 4-10 → `retell_agent_id_4..10`; the real outbound slots 2/3 (`retell_outbound_agent_id`/`_followup`) were retired in P3a (2026-06-17) and left OUT of the map. Consequence: `retell_inbound_agent_id` serves double duty (the inbound-webhook client resolver AND slot 1's setter-agent storage), so any setter placed on slot 1 gets its `voice_setters.retell_agent_id` overwritten with the inbound agent on its next Save & Push (`syncVoiceSetter` re-derives the id from the slot column, `dualWriteVoiceSetter` keyed on `legacy_slot`). MAIN-OUTBOUND-SHARED-1 was worked around with data (the whole Main Outbound setter moved off slot 1 to slot 10), but the trap remains for slot 1: the grid always force-renders an EMPTY "Setter-1" tile, and creating/saving a setter on it would re-read `retell_inbound_agent_id` and re-create the inbound-agent collision. That empty tile is the visible face of this flaw; leave it empty until the code fix lands. **Proper fix (v2, code):** give sync a real dedicated outbound slot, OR guard `dualWriteVoiceSetter` so it never writes when the resolved `agentColumn` for a non-inbound setter is `retell_inbound_agent_id`, OR stop keying the row match on `legacy_slot` (match on the setter UUID). **Gate:** next time the voice-setter/slot machinery is intentionally touched (pairs with the F2 UUID-native cleanup). Severity low (data workaround holds; only bites a setter on slot 1). **Also tracked as an open row in `Docs/BUG_LIST.md` (SLOT-MAP-1)** — this DEFERRED entry holds the full design context; BUG_LIST is the actionable pointer. See `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`.
