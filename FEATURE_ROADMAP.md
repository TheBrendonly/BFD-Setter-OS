# BFD-Setter — Feature List (canonical, build queue)

Features to build, in rough priority order. Reconciled 2026-06-25 with Brendan.

- **Companion lists:** bugs → `Docs/BUG_LIST.md` · your manual actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated features → `Docs/DEFERRED.md` · prompt-content edits (you apply via the UI) → `Docs/PROMPT_UPDATE_LIST.md`.
- **Status:** `[ ]` planned · `[~]` partly built · `[x]` shipped (move to `Docs/archive/COMPLETED_LOG.md` + note in `Docs/ROADMAP.md`).
- All items are **CODE**. When one ships, move it out and add a TEST_LIST entry for live verification.

---

## Build queue

> **SHIPPED features archived 2026-07-11** (all live in production; specs retained lower in this file): **F8**
> cost-to-price calculator, **F9** per-setter Retell lock, **F11** credentials masked indicator, **F13** usage &
> billing metering, **F14** auth (invite/reset/12-char). Remaining live UI checks live in `TEST_LIST.md`; the
> F14 email E2E is Resend-gated → `Docs/FIRST_CLIENT_TASKS.md`. Full shipped detail → `Docs/archive/COMPLETED_LOG.md`.

## Candidate queue — 2026-07-04 market research (Brendan picks; not yet committed builds)

> Source: a deep web-research pass (competitors: Phonely/Air.ai/Bland/Synthflow/GHL AI Employee/Closebot;
> agency churn data; AU compliance; show-rate practice). Key frame: the #1 churn driver for AI-setter
> retainers is "no visible ROI"; clients judge HELD meetings, not booked ones (target 65-80% show rate);
> prompts are portable so the moat is integration depth + compliance + reporting + the managed service.
> GHL's native AI Employee is US$97/mo unlimited, so the A$2,000 retainer must be justified by what
> GHL-native cannot do. Full research + sources in the "Feature spec - 2026-07 market research" section below.

- [x] **F15 — client ROI visibility (show-rate funnel + weekly report) — SHIPPED + DEPLOYED 2026-07-07 → archived `COMPLETED_LOG.md`.** Live UI checks in `TEST_LIST.md`; the weekly-report EMAIL is Resend-gated → `Docs/FIRST_CLIENT_TASKS.md`.
- [x] **F16 — never-miss-a-lead (speed-to-lead + missed-call text-back + live-transfer config, default-OFF) — SHIPPED + DEPLOYED 2026-07-07 → archived `COMPLETED_LOG.md`.** Behavioral checks (needs dogfood flags ON) in `TEST_LIST.md`; F16(d) summary-on-failed-transfer + PU-11 deferred.
- [~] **[PHASE 1 DEPLOYED 2026-07-07 (combined build) → TEST_LIST; phase 2 = post-first-client]** **F17 - AU compliance pack (phase 1 PRE-first-client, phase 2 post).** Phase 1: verify + enforce
  contact-hours windows for outbound VOICE and cadence SMS (Telemarketing Standard: weekdays 9am-8pm, Sat 9am-5pm,
  no Sun/public holidays — check existing `_shared/business-hours.ts` + F4 nudge gate coverage extends to voice
  dials); per-client call-recording disclosure toggle (NSW/WA/SA are all-party consent; the disclosure LINE itself
  is prompt content -> PU-6). Phase 2 (post-client, gate: first cold list): consent audit trail per lead (source/
  method/timestamp, 2+ yr retention, exportable — Spam Act burden of proof is on the sender) + a DNC Register wash
  step gated on cold-list campaign enrollment (30-day validity; consented + business numbers exempt). Compliance
  infrastructure is a genuine moat vs US-centric competitors. Effort M (phase 1 S-M).
- [ ] **F18 - AI voice confirmation call ~24h before appointment (POST-first-client fast-follow).** Outbound Retell
  call confirming tomorrow's appointment; on "can't make it" offers open slots and REBOOKS in the same call; SMS
  fallback on no-answer. A 135k-appointment study showed ~50% relative no-show reduction from AI reminder calls;
  a whole product category in 2026; GHL workflows cannot do this. Reuses outbound-voice + booking-tools infra.
  Effort M. **2026-07-07 refresh (build-ready, no change):** keep the call strictly transactional (confirm +
  reschedule only, zero upsell) so it stays a non-telemarketing service call in AU (exempt from DNC-wash + the
  telemarketing calling-hour clamp; the SMS no-answer fallback is exempt on the same basis). Must out-ROI GHL's
  native reminder calling (shipped May 2026); the differentiator is visible held-meeting reporting + clean in-call
  rebook. The ~50% figure is a peer-reviewed 135,393-appointment study (20.82% -> 10.25%).
- [ ] **F19 - Call QA digest with sentiment/failure flagging (POST-first-client).** Weekly agency-facing queue of
  flagged calls/conversations (negative sentiment, booking-tool failure, abrupt hang-up) built on the post-call
  analysis + analyze-sms-conversation data already ingested — review the worst 5, not 200 transcripts. Call
  quality is the #2 churn driver and why the first client is leaving Phonely. Effort S-M. **2026-07-07 refresh
  (build-ready, no change):** scope it as the CROSS-CLIENT, weekly, agency-pushed digest over the
  `post_call_analysis_data` already ingested; do NOT rebuild per-call sentiment scoring (Retell's native AI QA
  Analyst + Custom Dashboards cover that per-Retell-account) — F19's differentiator is aggregation across clients +
  weekly push + no agency Retell login. Pre-build (~30 min): check whether Retell Conductor (shipped 2026-07-05)
  exposes reusable eval data/API first.
- [ ] **F20 - Booked-revenue attribution (POST-first-client, before the first renewal).** Tag held appointments
  with outcome + deal value from the GHL opportunity pipeline; report "AI-sourced pipeline: $X" per lead source
  per month. Turns the renewal conversation from "cost A$2,000" into "generated A$40k of pipeline". Effort M.
  **2026-07-07 refresh (build-ready, no change):** read GHL v2 opportunity `monetaryValue` + `source` + `stage`
  (endpoints still date-header versioned, no deprecation found). GHL's April-2026 native pipeline-revenue widget
  reports stage/date totals but does NOT attribute to the AI source, so F20 stays a greenfield differentiator (incl.
  vs GHL AI Employee). "No visible ROI" remains the #1 cancellation driver (June-2026 Trillet analysis), so F20
  stays the top renewal-retention lever.

> **Explicit DO-NOT-BUILD list (research-backed, solo-founder managed retainer):** an in-product reminder engine
> (GHL workflows do confirmation SMS / trigger-link confirms / reschedule links natively — provision a canonical
> GHL reminder workflow at onboarding instead: instant confirm SMS, 24h reminder with confirm trigger-link, 2h
> short SMS, reschedule links; that SOP task lives in BRENDAN_TODO/onboarding); A/B testing (already deferred; no
> statistical power at 1-client volume); a self-serve agent-builder / white-label SaaS portal (invites
> prompt-portability churn; sell outcomes not tooling); WhatsApp/IG/FB DM expansion (GHL covers if asked); voice
> cloning (gimmick for this ICP); own scheduling engine (GHL calendars do round-robin/multi-staff); per-appointment
> performance pricing (creates volume-over-quality incentives — the quality retainer is the differentiation).

## Candidate queue — 2026-07-08 product review (overnight deep-work pass; Brendan picks; not committed)

> Source: the overnight product-review agent read the live booking-ingest, funnel, weekly-report, cost-ledger,
> error-logging, and onboarding code and ranked robustness/observability gaps that would cause churn or support
> load. Two of these (A1/A2) are also logged as reporting-CORRECTNESS items needing Brendan's semantic call —
> see the notes. Framed by the managed-retainer moat (visible ROI is churn driver #1; call quality #2) and the
> existing F18-F20 queue. Effort tags: S = quick win, M/L = bigger build. Nothing here is committed.

- [ ] **F21 - Booking reconciliation guard (fixes the two ROI-report correctness gaps; quick win). Effort S.**
  (a) Two live GHL booking-ingest endpoints key `bookings` on DIFFERENT columns — `bookings-webhook` on
  `(client_id, ghl_appointment_id)` (writes `booking_status_events`, reconciles with voice-tool rows) and the
  older `sync-ghl-booking` on `ghl_booking_id` (returns early on a dup WITHOUT updating status or writing
  `booking_status_events`). If an operator wires the appointment workflow to `sync-ghl-booking`, voice-tool
  bookings never dedupe → duplicate rows → the funnel double-counts booked and never sees held/no-show.
  Deprecate/redirect `sync-ghl-booking` to `bookings-webhook` or key it on `ghl_appointment_id` + update status
  on the dup path. (b) The funnel/weekly `booked` count includes `source="ghl_calendar"` (human-booked GHL
  appointments) despite the funnel's own "setter-created only" contract, inflating the client's "AI booked"
  headline → first reconciliation dispute. Scope the funnel/weekly `booked` to setter sources, or split
  "AI-sourced" vs "all". **NOTE:** (b) is a reporting-semantics decision (does Brendan want AI-sourced-only or
  all appointments in the ROI headline?) → also flagged in `BUG_LIST.md` sibling notes; confirm intent before
  building. **DECISION (Brendan, 2026-07-12): AI-sourced-only.** Scope the funnel/weekly `booked` count to
  setter sources (voice/SMS/cadence); EXCLUDE `source='ghl_calendar'` human-booked appointments from the
  headline. No secondary "all appointments" line requested (build session may add one later if asked).
  Evidence: `bookings-webhook/index.ts:207-261`, `sync-ghl-booking/index.ts:491-505`,
  `get-show-rate-funnel/index.ts:13-17,143`, `_shared/bookingSource.ts:14`, `weeklyClientReport.ts:109,135`.
- [ ] **F22 - Reporting-health assertion (stops the ROI metric silently dying; quick win). Effort S.**
  `show_rate` stays `null` until an appointment reaches held/no-show, which only happens if the operator wired
  the GHL appointment-status-change automation (GHL_SETUP flags it as fiddly). If missing, every booking sits
  `confirmed` forever, `show_rate` is permanently null, and nothing detects it. Add a check that
  `booking_status_events` has received >=1 non-`confirmed` transition per client, surfaced on the go-live
  readiness checklist and flagged if absent for N days. Evidence: `_shared/showRateFunnel.ts:55-63`, GHL_SETUP.md:103.
- [ ] **F23 - Proactive failure digest over `error_logs` (the core managed-service promise; quick-to-medium). Effort S-M.**
  `error_logs` is written from ~8 functions (booking 502s, outbound-call failures, SMS failures, webhook 403s)
  but is a passive table an agency opens manually (`ErrorLogs.tsx`); only `pollRetellDrift` has an optional Slack
  push. A managed retainer's value is catching failures before the client does. Add a daily agency failure digest
  (email/Slack) or threshold alert per client. Broader than F19 (operational, not call-quality). Evidence:
  `ErrorLogs.tsx`, `make-retell-outbound-call:975`, `sync-ghl-booking:638`.
- [ ] **F24 - Booked lead keeps getting nudged after a booking (robustness; medium). Effort S-M.**
  In `voice-booking-tools/index.ts:561-618` (FROZEN — report-only) the `bookings` write AND the "end active
  cadence on booking" are both inside `if (appointmentId)` and the bookings write is non-fatal. If GHL returns
  200 with an unrecognized body (appointmentId null) or the row write fails, the appointment exists in GHL but
  BFD never ends the cadence → the just-booked lead keeps getting follow-up SMS/calls. Derive the appointment id
  defensively + end the cadence keyed on the contact even when the id is unavailable. (Frozen surface: bundle
  with the next voice-gated session.)
- [ ] **F25 - Funnel cohort-vs-event window mismatch makes low-volume show-rate noisy (reporting polish; medium). Effort M.**
  The funnel counts bookings by `created_at` within the billing period, but held/no-show resolves later, so at
  first-client (low) volume the weekly show-rate jumps around (a booking near period-end holds next period).
  Report held/no-show by appointment DATE (event window) rather than booking-creation date, or clearly label it a
  booking cohort. Evidence: `get-show-rate-funnel/index.ts:105-108`, `weeklyClientReport.ts:105`.

**Committed/queued items this review reaffirms (already on the roadmap/DEFERRED — not new):**
- **Minutes-pool burn-down + 80% overage alert + cost-vs-billed reconciliation over `execution_cost_events`** —
  the P2 cost ledger has ZERO read surface and nothing reconciles it against the Retell/Twilio invoice; the
  A$2,000 + 1,500-min pool model has no burn-down or alert, so overage/margin erosion is invisible until the
  provider bill lands (bill-shock churn = the exact Phonely weakness the first client is leaving). This is the
  first-client slice of the deferred **2.6 cost-per-booking dashboard / 3.9 cost-ceiling aggregates / F8 v2** →
  see `DEFERRED.md` (a client-facing "pool remaining" + agency margin view). Effort M. **Recommend promoting to
  a committed build soon after first client.**
- **F20 booked-revenue attribution** (already build-ready) — top RENEWAL lever ("cost A$2,000 → sourced A$X pipeline").
- **Onboarding self-serve** (already in ONBOARDING_GAP_REPORT / BRENDAN_TODO): external-Supabase provisioning
  script + Twilio credential fields in `ApiCredentials.tsx` + a real go-live readiness-checklist surface. Still
  ~5 manual out-of-app steps; the #1 blocker (external Supabase project + 5-table seed) has no provisioning script
  and Twilio creds are SQL-only. Kills managed-service margin past client #1. Effort S each (script + UI fields); M (checklist).

## Build queue (committed)

- [ ] **F12 - Voice-agent per-minute cost optimization (GATED: after the first paying client — NOT before a deal, per Brendan 2026-07-01).** Cut the setter's real per-minute cost without hurting booking performance / conversational quality. **Verified current cost = A$0.34/min all-in** (US$0.22/min, from live Retell billing across 23 recent gemini-3.0-flash calls, 2026-07-01; the earlier prompt-bloat that spiked calls to ~A$2/min is already fixed). Biggest levers: stop pre-injecting 30 days of calendar slots + full chat/call history into model context every turn (fetch slots on-demand via the existing `get-available-slots` tool; keep ~last 10 turns + a rolling summary); turn off `model_high_priority`; cheaper AU TTS than the ElevenLabs custom voice (~A$0.06/min line); cheaper post-call-analysis model than gpt-4.1; review `stt_mode=accurate`. Report-only on the Retell/prompt side (Brendan applies). A ready-to-run **cost-reduction council brief** + the full cost breakdown live in "Feature spec - F12" below. Target ~A$0.20/min. Effort M.
_(F2, F5, F6, F7 SHIPPED Session 3 2026-06-25 → TEST_LIST + COMPLETED_LOG. F5's optional `text_engine_webhook` column drop is deferred — see DEFERRED.md — because the column is wired into the `clients_public` view; the n8n code path itself was already gone.)_
_(F1 SHIPPED Session 4 2026-06-26 (sync-ghl-contact v24 + `clients.ghl_conversation_link_field_id` migration). **F3 + F4 were ALREADY built** before Session 4 — F3 in commit `4b7dbc1` (pause/resume edge fns live v1 + runEngagement `isPaused()` exit + UI buttons), F4 in `b0c6bea` (nudgeColdReply per-lead-local-hour gate). Session 4 verified them live, redeployed Trigger.dev prod (`20260625.1`, 12 tasks) to guarantee the runtime, and reconciled all three → TEST_LIST + COMPLETED_LOG. They were never moved off this queue — a docs-drift catch, not a rebuild.)_

---

## Feature spec - F8 cost-to-price calculator

> Captured 2026-06-26 from Brendan's request + a pricing-research pass. This is a planned future build (after the bug-fix + TEST sessions), parked here so the research is not lost.

**Goal.** An admin-configurable calculator that turns the real per-minute cost of running a setter into a displayed price, in the currency we charge (AUD), with a markup we control. Brendan can toggle each cost component on or off, set the markup, and the blended rate tracks the models actually in use.

**What Brendan asked for (intent).** Adjustable display currency; a per-minute rate; account for Retell, Twilio, OpenRouter, and any other cost; toggle each component on/off (e.g. Twilio off when the client uses their own Twilio); a markup percentage on top (10 / 50 / 100% etc.); the LLM portion is necessarily an estimate; the blended rate updates with the OpenRouter models in use.

**Provider cost research (June 2026, re-confirm figures before relying on them).**
- *Retell AI: billed in USD.* Base voice engine about $0.07/min. Realistic all-in (voice + TTS + LLM + telephony) about $0.13 to $0.31/min depending on models; production users report about $0.09 to $0.11/min on light models. Components: voice engine $0.07/min; LLM about $0.003/min (light) up to about $0.04 to $0.06/min (advanced, e.g. GPT-4o / Claude Sonnet); Retell-supplied telephony about $0.015/min; premium voices (ElevenLabs) carry a surcharge; concurrency is 20 free then $8 per concurrent call per month. Note: `retell-call-webhook` already captures Retell's ACTUAL per-call cost (`call.cost` / `call_cost.combined_cost`) into `call_history.cost`, so voice has a real number to reconcile estimates against, it is not estimate-only.
- *OpenRouter: billed in USD.* Pure pass-through of each model's token price (no markup), input and output tokens priced separately, plus a 5.5% fee on credit top-ups ($0.80 minimum). The per-minute LLM cost is the genuine estimate: it depends on tokens consumed, so derive it from the setter's selected model rate times an assumed (or historical) tokens-per-minute. Live usage already flows into `openrouter_usage_cache` via the `refresh-usage-cache` edge fn + `useOpenRouterUsage` hook.
- *Twilio: currency depends on the account.* The AU pricing page quotes AUD: inbound to a local number A$0.0100/min (+A$3.00/mo number), inbound to a mobile A$0.0500/min (+A$20/mo), outbound to an AU landline A$0.0252/min, outbound to an AU mobile A$0.0750/min, SIP/app A$0.0040/min; SMS outbound A$0.0515/segment, SMS inbound A$0.0075/segment, MMS A$0.35; a clean mobile number A$8.25/mo; failed-message fee A$0.001; SMS-pumping protection A$0.025/msg. BUT a Twilio account bills in its configured currency, so confirm the real account currency rather than assuming AUD. **Key point:** per the onboarding SOP, Twilio is client-BYO-and-billed, so for most clients the Twilio cost is the client's, not BFD's, which is exactly why the Twilio toggle should default OFF for BYO clients.
- *Other costs to weigh.* Number rental (Twilio A$3 to A$8.25/mo) and A2P / regulatory registration are FIXED monthly, not per-minute, so amortize them or show a separate "fixed monthly" line. Supabase hosting and Trigger.dev are BFD-bundled flat overhead (Trigger is currently free tier). Recording / transcription storage, carrier surcharges (variable and hard to predict), and Stripe processing fees on what BFD charges the client are margin considerations, not clean per-minute inputs.

**Currency answer (Brendan's direct question).** Retell = USD. OpenRouter = USD. Twilio = account-currency-dependent (the AU page shows AUD; verify the real account, and note clients usually BYO their own Twilio). So the calculator must hold a USD-to-AUD FX rate (admin-set with a "last updated" stamp for v1, plus an optional FX buffer percentage; a live FX feed is a v2 nicety) and convert the USD components before applying markup.

**Existing infrastructure to build on.**
- Cost-config precedent: `clients.weekly_cost_ceiling_cents` / `monthly_cost_ceiling_cents` (cents, set on Sub-Account Config), the `client_cost_rollup` view (`week_cents` / `month_cents`), `cadence_metrics.ai_cost_cents` / `cost_estimate_cents`, `request_logs.cost` / `tokens_used`, `call_history.duration_ms` / `cost`.
- Admin per-client config precedent to mirror: the `client_account_field_config` table + `ClientAccountFieldConfigEditor` + `save-account-settings` edge fn (agency-only governance, visible/editable per field). The pricing panel should live on `ClientSettings.tsx` (Sub-Account Config) and be agency-only.
- Model selection lives in `voice_setters.retell_llm_id` (per setter); OpenRouter keys in `clients.openrouter_api_key` / `openrouter_management_key`.
- Display: a `formatCurrency` util exists (`UsageCredits.tsx`) but is USD-only and hardcodes "$"; this feature needs a currency-aware formatter (`Intl.NumberFormat(locale, { style: 'currency', currency })`). No `price` / `rate` / `currency` / `markup` columns exist yet, and there is no Twilio cost tracking today.

**Proposed config model.** A per-sub-account pricing config (a global default plus per-client override), stored either as a `pricing_config jsonb` column on `clients` or a dedicated `client_pricing_config` table (mirroring `client_account_field_config`). It holds: `display_currency`; `fx_usd_to_display` (+ optional buffer %); component toggles (`include_retell`, `include_openrouter_llm`, `include_twilio_voice`, `include_twilio_sms`, `include_number_rental`, `include_other`); an editable **rate table** seeded from the research above (so figures are tunable without a deploy); and `markup_percent`.

**Compute + display.** Blended price/min (in display currency) = (sum of enabled components, each converted USD-to-display via FX) times (1 + markup%), with a line-item breakdown view. The LLM line reads the setter's model and estimates from a tokens-per-minute assumption (calibrated later against `openrouter_usage_cache` actuals); the Retell line shows the estimate up front and the actual after a call. Surface the blended "$X.XX /min (AUD)" wherever pricing is shown.

**Open decisions for Brendan.**
1. Audience: internal pricing/quoting tool, or client-facing? ("displayed at what we're charging" reads internal, confirm.)
2. Rate scope: one global BFD rate card, or per-sub-account override on a default? (Recommend per-sub-account override.)
3. FX: admin-set fixed rate (v1) vs a live feed (v2). (Recommend admin-set first.)
4. Twilio default OFF for BYO-Twilio clients (recommend yes, matches the onboarding SOP).
5. Fixed monthly costs (number rental, A2P): a separate line vs amortized into per-minute. (Recommend separate.)

**Phasing.** v1: admin rate card + display currency + FX + per-provider toggles + markup % producing the blended $/min + breakdown, on Sub-Account Config, agency-only. v2: live model-aware LLM estimate from `openrouter_usage_cache`, post-call actual reconciliation against Retell `combined_cost`, and a live FX feed. Effort L (new config store + admin panel + rate seed + compute util + currency formatter + display surfaces + governance).

---

## Feature spec - F9 per-setter Retell lock + ownership sync

> Captured 2026-06-26 from Brendan's request + a Retell-API capability pass + a full inventory of the BFD-to-Retell write surfaces. Planned future build; parked here so the design + research are not lost. Brendan explicitly invited a better approach than "just a lock button," see "Recommended approach."

**The problem.** BFD's UI is the canonical writer of each setter's Retell config: anything Brendan changes directly in Retell is reverted on the next BFD Save/Push (and the repo prompt files have already drifted from live Retell). Retell keeps shipping new features Brendan wants, which will not always be backward-compatible with the BFD prompt-builder. He wants to "lock" a setter so he can edit it directly in Retell without BFD overwriting it, and ideally keep BFD in sync with what Retell holds.

**What Brendan asked for (intent).** (1) A lock button on each voice-setter tile, with a confirm dialog, that stops people entering that setter's edit section. (2) A way to pull all the config settings from Retell into BFD so the two stay "in sync both ways."

**Recommended approach (better than a hidden Edit button + raw two-way sync).** Model it as a per-setter OWNERSHIP flag ("Managed by: BFD or Retell") and make the lock flip ownership to Retell:
1. *Enforce the lock at the write boundary, server-side.* Hiding the Edit button is not protection. There are ~8 BFD code paths that PATCH/publish Retell (inventory below), several of which are BULK loops over all of a client's agents (set-voicemail, refresh-booking-tool-messages) plus the rename cascade and the B-3 outbound re-pin. Any of them clobbers a Retell-managed agent. So gate on `voice_setters.is_retell_locked` INSIDE retell-proxy and skip locked setters in every write path, returning a clear "setter is Retell-locked" refusal. The tile button is just the front door.
2. *Sync by owner, do not attempt simultaneous two-way write-sync.* Retell emits no agent/config-change webhook (only call/chat/transfer lifecycle events), so real-time two-way sync is impossible anyway, and dual-writable config is exactly the clobber problem Brendan is escaping. Instead: a locked (Retell-owned) setter becomes a read-only mirror in BFD (BFD PULLS Retell's live config and shows it read-only); an unlocked (BFD-owned) setter keeps pushing BFD to Retell as today. The lock toggles the direction.
3. *Cheap drift detection via Retell's version.* Retell agents carry a monotonically increasing version integer plus `last_modification_timestamp` and `is_published` on get-agent. Store the last-synced version/timestamp; compare on editor load (and optionally on a schedule) to show "in sync" vs "drifted, pull to refresh." Useful even for UNLOCKED setters as a safety net that warns "Retell was edited outside BFD."
4. *Guard the booking wiring.* BFD force-injects the voice-booking-tools webhooks + dynamic variables. A locked setter restructured in Retell could silently drop them and break booking. The mirror/drift check should specifically verify the BFD booking tools/webhooks are still present on a locked agent and warn if not.
5. *Keep outbound working while locked.* make-retell-outbound-call does a conditional voicemail PATCH at call time; for a locked setter, SKIP that mutation but still place the call. Locking config writes must never block dialing.

**Retell API feasibility (June 2026, re-confirm).**
- *Full pull is possible.* get-agent returns the full agent config (id, version, voice, last_modification_timestamp, is_published, response_engine, etc.); get-retell-llm and get-conversation-flow return the prompt/model/tools and the flow. BFD already has these reads wired in retell-proxy (get-agent, get-llm, get-conversation-flow, list-*), so a complete Retell-to-BFD mirror is feasible from existing read actions.
- *No config-change webhook.* Retell webhooks are call_started / call_ended / call_analyzed (+ chat_* + transfer_*) only; there is no agent_updated event. Sync must be on-demand ("Pull from Retell" button) and/or a scheduled poll, plus the version/timestamp drift check.
- *Versioning helps.* The version integer + is_published let BFD detect "Retell changed" without diffing the whole payload.

**BFD-to-Retell write surfaces the lock must cover** (retell-proxy `frontend/supabase/functions/retell-proxy/index.ts` unless noted): sync-voice-setter (prompt/config push); sync-voice-setter-cf (conversation flow); set-agent-name (rename cascade, also fired by `InlineSetterNameEditor` + `SetterDisplayNamesCard`); set-voicemail (BULK, patches every agent for the client, from `ClientVoicemailCard`); refresh-booking-tool-messages (BULK, patches every agent's LLM); delete-voice-setter; the generic create/update/delete agent+llm+phone CRUD via `useRetellApi`; `make-retell-outbound-call`'s at-call-time voicemail PATCH; and `scripts/deploy_voice_prompt.mjs`. The bulk loops (set-voicemail, refresh-booking-tool-messages) are the easiest to overlook and must skip locked setters.

**Schema.** `voice_setters` has no lock column today. Add `is_retell_locked boolean NOT NULL DEFAULT false`; plus for the mirror/drift: `retell_locked_at timestamptz`, `retell_synced_at timestamptz`, `retell_synced_version int`, and `retell_config_snapshot jsonb` (read-only mirror of the last pulled config). Apply via Management API; write the repo migration; regenerate only the `voice_setters` block of types.ts.

**UI.** The tile grid is in `PromptManagement.tsx` (~line 8031); the Edit button is ~8151, status badges ~8076. Add a lock toggle + a "Retell-managed / Locked" badge on the tile, gate the Edit entry (the editor renders read-only with an "unlock to edit in BFD" state when locked), and add a "Pull from Retell" + "in sync vs drifted" affordance. The lock confirm dialog should spell out: BFD will stop managing this setter and will not overwrite your Retell edits; unlock to resume BFD management.

**Open decisions for Brendan.**
1. Lock granularity: whole-setter (simplest, recommended v1) vs field-level (lock prompt/model but let BFD keep managing the booking webhooks)? Field-level is far more complex.
2. On lock, does BFD stop managing entirely (Brendan owns the booking wiring in Retell, with a drift warning, recommended) or keep re-asserting just the BFD webhooks (hybrid)?
3. Mirror scope: a full JSON snapshot for display + backup (recommended), plus extracted key fields (model, voice, name, tools-present)?
4. Sync trigger: on-demand "Pull from Retell" + on-load drift check for v1 (recommended); scheduled poll for v2?
5. Unlock behavior: warn that resuming BFD management will overwrite Retell's current config on the next Save, and offer "pull current Retell config into BFD first" so his Retell work is not lost (recommended)?

**Report-only alignment.** Pulling FROM Retell as a read-only mirror is consistent with the prompt-content report-only rule (it is a read; nothing is written back to Retell, and the mirror is never an editable surface that pushes prompt content). The lock REDUCES BFD's writes to Retell; it does not add prompt writes.

**Phasing.** v1: `is_retell_locked` column + server-enforced write-guard across all retell-proxy actions (incl. the bulk loops) + the outbound-call PATCH skip + tile lock button/badge/confirm + editor read-only-when-locked + an on-demand "Pull from Retell" read-only mirror with a version drift indicator. v2: scheduled drift poll, booking-tool presence check + alert, and the "pull Retell into BFD before unlock" safety. Effort L (schema + cross-cutting server guard + mirror pull + UI). Independent of F8; build F9 FIRST if Brendan wants to start editing in Retell sooner (it is the safety-critical, currently-blocking one).

---

## Shipped (live in production) — context only

Core appointment-setter platform: multi-channel AI setter (SMS / IG DM / FB), native text engine (Trigger.dev, n8n bypassed), engagement cadences (`runEngagement.ts`), email channel in cadences, form-to-agent routing (tag-per-campaign), CSV/list reactivation, voice setters (UUID model + Retell, live voice picker + Fast Tier), multi-tenant RLS + dual-mode `authorize-client-request.ts`, webhook auth hardening, paid-call-path idempotency, quiet-hours/STOP/reply-end guards, credential "Verify" card, brand voice, §3.12 SMS tool parity (book/reschedule/cancel/check-slots/callback over SMS), GHL outcome-field sync, `clients_public` secret-column boundary, billing B1/B2 (dormant until Stripe go-live), S6 readiness dashboard + CI.

Full chronological build log: `Docs/ROADMAP.md`. Deferred / gated features: `Docs/DEFERRED.md`.

---

## Feature spec - F12 voice-agent per-minute cost optimization

> Captured 2026-07-01 from a live Retell cost audit (146 calls pulled, cost broken down per product). GATED: do this AFTER the first paying client, not before a deal (Brendan). The system prompt is already near-minimal for a single-prompt agent, so this is about ARCHITECTURE (context injection, model/voice/STT choice, post-call pipeline), not prompt wording.

**Verified current cost (2026-07-01).** All-in A$0.34/min (US$0.22/min), stable across recent real calls (A$0.23-0.37). Component breakdown per minute: `llm_token_surcharge` A$0.131 (38%), `retell_voice_engine` A$0.084 (25%, fixed platform fee, not reducible), ElevenLabs TTS A$0.061 (18%), `gemini_3_0_flash` A$0.041 (12%), gpt-4.1 post-call analysis A$0.024 (7%). The old prompt-bloat that pushed calls to ~A$2/min (huge `llm_token_surcharge` from injecting 30-day availability + full history) was fixed ~2026-06-11; premium-model test calls (gpt-5 / claude-sonnet) also inflate cost and should never run on live client calls.

**Current config (agent `agent_f45f4dd...` / llm `llm_a73df8d...`, representative).** model `gemini-3.0-flash` with `model_high_priority=TRUE`; `stt_mode=accurate`; ElevenLabs custom voice; `post_call_analysis_model=gpt-4.1`; ~3,500-word single system prompt; 8 custom booking tools; `background_voice_cancellation` + `ambient_sound` on; still injects `{{available_time_slots}}` (30 days), `{{chat_history}}`, `{{call_history}}` into context.

**Ready-to-run council brief (paste to Claude: "run the council on this"):**

```
COUNCIL BRIEF: Reduce the per-minute cost of the BFD Setter voice agent without compromising
booking performance or conversational quality.

CONTEXT (verified from live Retell data + agent config, 2026-07-01):
- Product: AU AI voice appointment-setter ("Gary"). Single-prompt Retell agent architecture.
- Current all-in cost = A$0.34/min (US$0.22/min), stable across recent real calls (range A$0.23-0.37).
- Cost breakdown per minute: llm_token_surcharge A$0.131 (38%), retell_voice_engine A$0.084 (25%,
  fixed), ElevenLabs TTS A$0.061 (18%), gemini-3.0-flash A$0.041 (12%), gpt-4.1 post-call analysis
  A$0.024 (7%).
- Current config: model gemini-3.0-flash with model_high_priority=TRUE; stt_mode=accurate; ElevenLabs
  custom voice; post_call_analysis_model=gpt-4.1; ~3,500-word system prompt; 8 custom booking tools;
  background_voice_cancellation on; ambient_sound on.
- Context injection today: the agent pre-injects 30 days of calendar availability
  ({{available_time_slots}}) AND chat/call history ({{chat_history}}, {{call_history}}) into the model
  context, re-sent every turn. A get-available-slots tool already exists for on-demand fetching.
- The system prompt is already about as small as it can be for a single-prompt agent; do NOT focus on
  trimming prompt wording. Focus on architecture, context strategy, model/voice/STT choices, and the
  post-call pipeline.

HARD CONSTRAINTS:
- Must NOT degrade: booking success rate, conversational latency/naturalness, AU-accent voice quality,
  or slot-accuracy (the agent must never offer a slot that isn't real).
- Report-only: all changes are applied by Brendan in Retell / the BFD setter UI. Do not assume code
  can be changed unilaterally; recommend, don't implement.
- Keep it SIMPLE and STABLE (solo founder, not enterprise). Prefer low-risk, high-certainty wins.

SPECIFIC QUESTIONS TO ANSWER:
1. model_high_priority=TRUE: what does it cost vs standard priority, and what latency/quality do we
   lose by turning it off? Net recommendation.
2. Context injection: do we need to inject all 30 days of availability up front, before a booking is
   even requested? Or fetch on-demand via get-available-slots only once the lead moves to booking?
   Quantify the token/cost impact and the performance/latency trade-off of each approach.
3. Conversation history: do we need 30 days of history in context, or is "last 10 interactions +
   a rolling summary" sufficient? Design the rolling-summary approach and estimate the cost saving
   and any quality/continuity risk.
4. TTS: is the ElevenLabs custom voice worth A$0.061/min, or is there an equal-quality AU voice at
   lower cost? Recommend specific alternatives.
5. STT: is stt_mode=accurate necessary, or does the cheaper mode hold quality for AU accents?
6. Post-call analysis: is gpt-4.1 needed for post-call extraction, or does a cheaper model
   (gpt-4.1-mini / gemini-flash) do it at ~equal accuracy? Cost delta.
7. Should we move from single-prompt to a conversation-flow / state-machine architecture to cut
   context size? This is a FUTURE consideration (NOT before the first deal). Assess the cost upside,
   the build effort, and whether it risks booking reliability. Flag it as future, not now.

DELIVERABLE:
- A prioritized list of cost-reduction levers, each with: estimated A$/min saved, performance risk
  (low/med/high), effort, and a SAFE-NOW vs FUTURE tag.
- A target "optimized" cost/min if all safe-now levers are applied.
- Explicit callouts of any lever that would compromise performance (so we can reject it).
- The recommended rolling-summary + on-demand-slot design as the headline future architecture change.
```

**Effort.** M (mostly Retell config + context-injection changes Brendan applies; the rolling-summary/on-demand-slot design may need a small code change to how dynamic variables are populated). Reconcile the A$0.34/min figure against fresh call data before relying on it (rates drift).

---

## Feature spec - 2026-07 market research (context for F15-F20)

> Captured 2026-07-04 from a deep research pass (18 searches/fetches). Headline findings:
> - #1 churn driver for agency voice-AI retainers = "no visible ROI" (ahead of quality, integrations, price);
>   clients who can see what the AI does are ~40% less likely to cancel in 90 days (Trillet).
> - Clients judge HELD meetings: <60% show rate = weak reminders/qualification; 65-80% = target; >80% pairs with
>   two reminder touches (day-before + morning-of). SMS reminders cut no-shows 38-40%; AI reminder CALLS ~50%.
> - Speed-to-lead: contact in 5 min = ~100x more likely to connect than 30 min; sub-60s = 391% higher conversion.
> - Phonely's documented weaknesses (the first client's incumbent): limited outbound, 1-2 week onboarding,
>   variable peak-hour performance, unpredictable overage billing, human-escalation gaps. Air.ai was FTC-banned
>   03/2026 (US$18M), so trust/transparency features carry extra weight in this category.
> - "Prompts are portable" (SaaStr): stickiness = integration depth + compliance infra + vertical expertise +
>   reporting, which favors the managed-retainer + deep-GHL model.
> - AU compliance notes: ACMA Sender ID Register enforcement began 1 July 2026 (unregistered alpha sender IDs
>   rewrite to "Unverified"; plain Twilio numbers exempt — verify none configured). NSW/WA/SA = all-party
>   call-recording consent (disclosure line -> PU-6). Telemarketing Standard hours: weekdays 9am-8pm, Sat 9am-5pm,
>   no Sun/public holidays. Spam Act: consent records 2+ years, burden of proof on sender. DNC wash only needed
>   for cold consumer lists. No AI-specific disclosure law in AU as of mid-2026.
> Sources: dialora.ai + ainora.lt + skipcalls.com (Phonely), tested.media + retellai.com (platform comparison),
> gohighlevel.com help (AI Employee, appointment-status triggers), ftc.gov (Air AI), trillet.ai (retention),
> saastr.com (prompt portability), cronical.ai + growleads.io (benchmarks), mybcat.com + getprosper.ai +
> famulor.io (reminders), greetnow.com + digitalapplied.com (speed-to-lead), getaira.io (missed-call text-back),
> acma.gov.au + donotcall.gov.au + waboom.ai + recordinglaw.com + sprintlaw.com.au (AU compliance).

> **2026-07-07 refresh (P3 review).** A 3-day rescan found NO verified material change to F18/F19/F20
> build-readiness; the prior research holds and all three remain build-ready. Only in-window moves: Retell
> Conductor (2026-07-05, an enterprise eval/test/improve interface for production voice agents) and xAI's Grok
> Voice Agent Builder (beta 2026-07-06), both no-code DIY-infra entrants and NEITHER a managed-service competitor;
> both reinforce the "sell outcomes, not a self-serve builder" thesis. AU compliance stable (no AI-specific
> voice-disclosure law in force; ACMA SMS Sender ID Register live 1 July 2026, plain Twilio numbers exempt). New
> non-blocking watch: AU Privacy Act second-tranche reform (automated-decision / AI-transparency disclosure)
> anticipated ~Dec 2026 (tracked in `Docs/DEFERRED.md`). Per-feature deltas are folded into the F18/F19/F20 lines
> above. Citations by publisher/title; URL-level sources live in the 2026-07-04 pass.

## Hard constraints (apply to any feature touching these)

- **Voice agent prompts are report-only.** Never edit prompt content in Retell or repo prompt files; report the location + recommended change to Brendan, who applies it via the BFD setter UI.
- **Backward compatibility:** never break the live main-form flow when adding routing/cadence features.
- **GHL Webhook V2 signs with RSA, not HMAC** — confirm the real signing mechanism before provisioning secrets.
- **Multi-DB app:** the frontend reads the platform DB *and* per-client external DBs, so `types.ts` can't be wholesale-regenerated. Apply schema types surgically.
