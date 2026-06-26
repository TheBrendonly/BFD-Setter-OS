# BFD-Setter — Deferred List (someday / gated)

Things deliberately not being built now, each with the gate that would un-defer it. Reconciled 2026-06-25.

## ⭐ MAJOR — add soon (next big build)

- [ ] **Lead lifecycle system** = roadmap 3.5 + 3.6 + 3.7, treated as one feature.
  - **3.5 engine** — multi-workflow enrollment state machine: a lead transitions between workflows (Hot Pursuit → Cool Down → Long-Tail → Re-engage) instead of living in one cadence. **Already partly built** on branch `feat/cadence-v2-lifecycle-wip` (`engagement_enrollments` table + `transition-lead` edge fn + Workflows UI).
  - **3.6 long-tail nurture** — a slow, email-only drip a lead enters after a cadence completes / goes silent (requires 3.5).
  - **3.7 re-warm triggers** — email-click + GHL pricing-page-visit events auto-pull a quiet lead back into Re-engage (requires 3.5 + click-tracking/GHL-event infra).
  - **Gate:** a reliable lead-state classifier (decides hot/cold/silent) + the click-tracking/GHL-event infra for 3.7. This is also the "build a better cadence v2 when needed" direction (the flat 28-node draft `c206da3e` was deleted in favor of this).

## Gated features

- [ ] **2.6 Cost-per-booking analytics dashboard** — `cadence_metrics` + `cadence_funnel` view exist; no chart. **Gate:** ~60 days of real data + the cost-tracking table from 3.9.
- [ ] **3.1 A/B testing** (campaign / agent / AI-generated) — **Gate:** first paying client with ~50+ leads/week.
- [ ] **3.2 Agent-by-form-field** (within-cadence agent override) — **Gate:** a client needs same-cadence/different-agent (tag-per-campaign covers ~80%).
- [ ] **3.3 Campaign-level default voice setter** — **Gate:** per-node selection works today; revisit alongside the F2 UUID-native setter cleanup.
- [ ] **3.9 Cost-ceiling weekly/monthly aggregates** — **Gate:** needs a per-execution cost-tracking table first (cost is in-memory today).
- [ ] **3.11 HubSpot + GHL coexistence** `[B]` — **Gate:** a client using HubSpot signs.
- [ ] **4.1 Pricing model** (cost-plus vs retainer) `[B]` — **Gate:** cost-per-booking data exists.
- [ ] **4.3 Multi-Twilio failover** — **Gate:** combined volume exceeds one Twilio account's safe ceiling.
- [ ] **E-1 `fetch-thread-previews` 500-on-throw** — **Gate:** it has no live caller (latent); fix only if it gets wired up.
- [ ] **Email provider / custom SMTP** — **Gate:** BFD stays SMS-only by decision; build when a client needs email.
- [ ] **HIBP password-breach check** — **Gate:** Supabase Pro upgrade (flip `password_hibp_enabled=true` via Mgmt API).
- [ ] **Drop the unused `clients.text_engine_webhook` column** (F5 leftover) — the n8n code path is already gone, but the column is still referenced by the `clients_public` view (79 browser reads). Dropping it cleanly needs a coordinated `DROP VIEW` + `CREATE VIEW` (preserving `security_invoker` + grants) — not worth that risk for one inert column. **Gate:** fold it into the next intentional `clients_public` view rebuild.

## First-paying-client onboarding cluster `[BRENDAN]`

- [ ] **6.6** arm `retell_webhook_secret` (= the Retell API key; one controlled live call, revert to NULL on any 403) + provision the GHL/Retell/Unipile webhook signing secrets.
- [ ] **AU SMS A2P / Messaging Service registration for `+61481614530`** — Twilio accepts messages but AU handset delivery on the bare long code is slow/unconfirmed; register A2P or confirm the regulatory bundle.

## Other

- [ ] **By-phone Spec 2 — N-row merge + UNIQUE(client_id, normalized_phone)** — collapse the existing duplicate `leads` rows that share a `normalized_phone` into one survivor (richest/most-recent), repoint child tables (engagement_executions / bookings / campaign_events / dm_executions / scheduled_callbacks / message_queue / active_trigger_runs) onto the survivor, add the UNIQUE constraint, and clean up the GHL-side dupes. Spec 1 (go-forward) is live; Session 5's resilient-inbound collision guard explicitly **defers** the rare concurrent-create case here. **Gate:** needs a dry-run on the live dup set first (was the ~10-row `+61405482446` case); low urgency while GHL allow-duplicate-contacts stays OFF. See `project_internal_by_phone_leads_spec1_2026_06_18`.

- [ ] **F9 v2 — Retell lock polish.** v1 shipped Session 6.5 (server guard + on-demand Pull + version-drift + lock UI). v2: a **scheduled drift poll** (cron) so drift is detected without opening PromptManagement; a **booking-tools-present alert** that warns when a locked agent's snapshot flips `booking_tools_present` false (booking would silently break); and an **auto "pull Retell into BFD before unlock"** that hydrates BFD's editor fields from the snapshot (v1 only warns + offers the manual Pull). **Gate:** Brendan actively running locked setters + wanting hands-off drift alerts. See `FEATURE_ROADMAP` "Feature spec - F9".

- [ ] **6.12a GHL custom conversation provider POC** — deferred. Upstream `1prompt-os` never used one (it lets GHL own the channel); the marketplace-app path is bfd-specific and painful. The **F1 deep-link feature** covers the need near-term (link from GHL to BFD's conversation view). Revisit the provider only if branded in-GHL bubbles become a hard requirement.
