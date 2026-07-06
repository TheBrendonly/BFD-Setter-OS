# BFD-Setter — Feature List (canonical, build queue)

Features to build, in rough priority order. Reconciled 2026-06-25 with Brendan.

- **Companion lists:** bugs → `Docs/BUG_LIST.md` · your manual actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated features → `Docs/DEFERRED.md` · prompt-content edits (you apply via the UI) → `Docs/PROMPT_UPDATE_LIST.md`.
- **Status:** `[ ]` planned · `[~]` partly built · `[x]` shipped (move to `Docs/archive/COMPLETED_LOG.md` + note in `Docs/ROADMAP.md`).
- All items are **CODE**. When one ships, move it out and add a TEST_LIST entry for live verification.

---

## Build queue

- [x] **F13 - Usage & Billing metering + client visibility (extends F8).** BUILT 2026-07-02 + **DEPLOYED LIVE 2026-07-03** (supervised, Brendan reviewed + GO; get-client-usage v1, get-blended-rate v2, Trigger 20260702.1, frontend; F13 trap proof 9/9 + F8 9/9 + SQL hand-check exact match) → live UI checks in `TEST_LIST.md`. **Decided scope (Brendan 2026-07-02):** per-client billing anchor DAY-OF-MONTH (default 1, short months clamp, boundaries in `clients.timezone`, prior periods browsable); voice billable = per-call CEIL to whole minute x the F8 blended $/min (durations + actual Retell cost already live in `call_history` from the post-call webhook); SMS = ALL outbound texts x a per-text sell rate from a NEW `sms_llm` per_message pricing component (admin-set "LLM cost per average outbound message", seed US$0.003 - Twilio is client-BYO so carriage is not BFD's cost; the per_message bucket NEVER pollutes the per-minute blend); client sees rate/minutes/texts/month-total EACH behind an admin toggle (`client_display` in the pricing config, `show_rate` back-compat-mirrored with `show_rate_to_client`); agency sees the full margin view (billed at sell rates vs actual provider cost). **Zero migrations** (anchor + toggles + component live in the existing `client_pricing_config.config` jsonb). **Compute** = pure `_shared/billingPeriod.ts` + `_shared/computeUsage.ts` + extended `computeBlendedRate` (per_message bucket). **Gated read** = new `get-client-usage` edge fn (service-role; `roleBranch.ts` fresh-literal split, toggled-off keys OMITTED, all-off -> `{show:false}`; same trap class as F8). **UI** = `UsageSummaryCard` on the ChatAnalytics dashboard (BOTH roles, server-branched), `ClientUsagePanel` (period selector) on AccountSettings (client) + ClientSettings after the F8 editor (agency margin view), editor gains anchor-day input + 4-toggle Client visibility group + SMS-per-text breakdown row. **Proof** = `scripts/f13_usage_trap_proof.ts` (delta-based, snapshot-and-restores the live pricing row). ~40 new deno tests; test:edge 188/0, test:node 80/0, tsc + vite build green. Also fixes the F8 discoverability gap: the rate card only rendered on the client Account page for client-role logins, never on the dashboard. **Completion-council fixes (3rd commit):** Bug-28 booking-confirm SMS now stamps message_queue so it meters; nudgeColdReply stamp fixed earlier; KNOWN residual gap = mid-call `send_sms` texts (frozen `voice-booking-tools`) -> BUG_LIST **SMS-METER-1**, folds into the BOOK-2/3 supervised session.
- [x] **F14 - Auth improvements: invite-email onboarding + client self password reset + Resend SMTP + 12-char fix.** BUILT 2026-07-02 + **DEPLOYED LIVE 2026-07-03** (invite-client-user v1, check-reset-eligibility v11, update-client-password v11, frontend; SMTP PATCH still pending Brendan's Resend items, invite/reset E2E gated on it). NO new auth system - Supabase Auth stays (signup disabled, min-12 passwords, optional TOTP, rotation on). (1) NEW `invite-client-user` edge fn: agency-only invite-by-email (structural clone of `create-client-user` - same role flip + profile link + delete-user rollback) via `admin.inviteUserByEmail` redirecting to `/reset-password` (already allow-listed); "Invite Sub-Account User by Email" card in ManageClients' edit view. (2) `check-reset-eligibility` now allows role='client' (clients can self-reset; enumeration-safe always-success preserved). (3) `ResetPassword.tsx` handles `type=invite` links (invite copy: "Set Your Password") and enforces min 12 chars matching the live GoTrue policy (was 6). (4) SMTP = config-only deploy step (Mgmt API PATCH /config/auth with the Resend key; payload in the handoff). AUTH-LEN-1 closed FULLY in the 3rd commit (ManageClients + CreateClient + update-client-password all enforce 12). Audit note: `intake_lead_secret` entropy VERIFIED (24 CSPRNG bytes = 192 bits at all 3 mint sites) - no fix needed.
- [x] **F8 - Configurable cost-to-price calculator (per-minute, multi-currency).** SHIPPED + DEPLOYED LIVE 2026-07-01 (overnight) → `TEST_LIST.md` (live UI verify) + this note. **Resolved 5 decisions:** (1) audience = agency-internal tool PLUS the opt-in client display card; (2) per-sub-account override on a global default rate card; (3) admin-set fixed FX + buffer % + "last updated" stamp (live feed = v2); (4) Twilio toggles default OFF; (5) fixed monthly costs (number rental, A2P) = a SEPARATE line, markup on per-minute only. **Config store** = new `client_pricing_config` table (jsonb, agency-RLS **role-gated** — an adversarial council VETO caught that a verbatim agency `FOR ALL` policy matched client-role users; fixed with `get_user_role(...)='agency'`). **Compute** = pure `_shared/computeBlendedRate.ts` (integer micros, one FX step, bps markup+buffer, round-half-even once). **Gated read** = `get-blended-rate` edge fn (client gets ONLY the blended scalar when the toggle is on; live trap proof 9/9). v2 deferred (`DEFERRED.md`). _Original spec retained below._ (split from F9; Brendan 2026-06-26: F9 first, F8 after the TEST pass). Admin-set, **agency-only** panel on Sub-Account Config that computes a blended displayed price per minute from real provider costs (Retell + OpenRouter LLM + Twilio voice/SMS + number rental + other), with a per-provider on/off toggle (e.g. Twilio off when the client runs their own Twilio), a display currency + admin-set USD-to-AUD FX, and a markup percentage (10 / 50 / 100% etc.). **Decided scope (Brendan):** per-sub-account override on a global default rate card. **NEW requirement:** a per-sub-account "**show rate to client**" toggle (set in the agency settings) that surfaces a **read-only** blended-$/min **display card in that client's own account settings** — markup/breakdown stay agency-only; only the final blended $/min shows to the client when the toggle is on. The LLM line is a live model-aware estimate; voice has Retell's actual per-call cost to reconcile against. Full spec + provider-rate research in the "Feature spec - F8" section below. Effort L.
- [x] **F11 - Credentials "Configured" masked indicator + optional-key labelling.** SHIPPED 2026-06-29 (overnight frontend-only build) → `TEST_LIST.md` + `COMPLETED_LOG.md`. Option (A): a fixed-length **dot-mask** `••••••••••••` shown as the **placeholder** (never the value, so the blank-save guard still treats the box as "unchanged" — zero real chars sent to the browser, G3-6 preserved) + a bolder **"Configured ✓"** on every configured secret in `ApiCredentials.tsx` (via the shared `CredentialInputField`/`ApiCredentialField`) and `SetupGuideDialog.tsx` (5 inline secret fields, parity). Supabase PAT + OpenRouter Management Key now labelled **(Optional)** (new `isOptional` on `CredentialInputField`; suppresses their red "Not Configured" pulse). Frontend-only; tsc + build green; **no edge deploy**.
- [x] **F9 - Per-setter Retell lock + ownership-based config sync.** SHIPPED Session 6.5 2026-06-26 → `TEST_LIST.md`. v1: `voice_setters.is_retell_locked` (+ `retell_locked_at`/`retell_synced_at`/`retell_synced_version`/`retell_config_snapshot`, migration `20260627130000`); **server-enforced** write-guard in retell-proxy across all write paths via `_shared/retell-lock.ts` (single-target THROW 423 `setter_retell_locked`; bulk `set-voicemail`/`refresh-booking-tool-messages` SKIP locked setters + report them); `make-retell-outbound-call` skips the at-call voicemail PATCH for a locked setter but **still dials**; new `set-setter-lock` + READ-ONLY `pull-retell-config` actions (snapshot + version drift); tile lock toggle + confirm dialogs + Retell-locked/sync badges + Pull button + Edit-entry gating in `PromptManagement.tsx`. retell-proxy **v46**, make-retell-outbound-call **v27**. 12 guard-core unit tests. **v2 (deferred → DEFERRED.md):** scheduled drift poll, booking-tools-present alert, auto "pull Retell into BFD before unlock". Full spec in "Feature spec - F9" below.
## Candidate queue — 2026-07-04 market research (Brendan picks; not yet committed builds)

> Source: a deep web-research pass (competitors: Phonely/Air.ai/Bland/Synthflow/GHL AI Employee/Closebot;
> agency churn data; AU compliance; show-rate practice). Key frame: the #1 churn driver for AI-setter
> retainers is "no visible ROI"; clients judge HELD meetings, not booked ones (target 65-80% show rate);
> prompts are portable so the moat is integration depth + compliance + reporting + the managed service.
> GHL's native AI Employee is US$97/mo unlimited, so the A$2,000 retainer must be justified by what
> GHL-native cannot do. Full research + sources in the "Feature spec - 2026-07 market research" section below.

- [x] **[DEPLOYED 2026-07-07 (combined build) → TEST_LIST]** **F15 - Client ROI visibility pack: show-rate funnel + weekly report (PRE-first-client; the retention build).**
  (a) Ingest GHL appointment-status changes (confirmed / showed / no-show / cancelled — GHL fires workflow
  triggers/webhooks) into the platform so every booking tracks booked -> confirmed -> held -> no-show, per setter
  and per lead source. (b) A Trigger.dev cron emails each client a weekly white-label report: calls made/answered,
  SMS conversations, appointments booked/confirmed/held, no-show rate, estimated pipeline value, top objections,
  plus 2-3 "what we improved" bullets (agency-editable). Directly attacks the #1 churn driver; the show-rate metric
  is what retainers live or die on. Email sending is gated on the Resend SMTP item in BRENDAN_TODO. Effort M.
- [x] **[DEPLOYED 2026-07-07 (combined build, default-OFF flags) → TEST_LIST; summary-on-failed-transfer + PU-11 deferred]** **F16 - Never-miss-a-lead pack: speed-to-lead + missed-call text-back + live-transfer config (PRE-first-client; the demo build).**
  (a) Speed-to-lead: new GHL lead -> AI voice call within 60s (inside legal calling hours; SMS fallback outside
  hours / on no-answer) — sub-60s contact shows ~391% higher conversion and only ~7% of companies hit 5 minutes.
  (b) Missed-call text-back: inbound call unanswered/abandoned -> SMS within 60s from the same number into the
  existing multi-turn SMS booking engine (recovers 40-60% of missed calls). (c) Live/warm transfer: per-setter
  config UI for Retell's native `transfer_call` tool (already passes through retell-proxy untouched) so a hot lead
  who asks for a human is transferred to the client's mobile with an SMS context summary fallback. Effort M total
  ((a)/(b) S-M each on existing plumbing, (c) S config UI + report-only prompt line).
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
  Effort M.
- [ ] **F19 - Call QA digest with sentiment/failure flagging (POST-first-client).** Weekly agency-facing queue of
  flagged calls/conversations (negative sentiment, booking-tool failure, abrupt hang-up) built on the post-call
  analysis + analyze-sms-conversation data already ingested — review the worst 5, not 200 transcripts. Call
  quality is the #2 churn driver and why the first client is leaving Phonely. Effort S-M.
- [ ] **F20 - Booked-revenue attribution (POST-first-client, before the first renewal).** Tag held appointments
  with outcome + deal value from the GHL opportunity pipeline; report "AI-sourced pipeline: $X" per lead source
  per month. Turns the renewal conversation from "cost A$2,000" into "generated A$40k of pipeline". Effort M.

> **Explicit DO-NOT-BUILD list (research-backed, solo-founder managed retainer):** an in-product reminder engine
> (GHL workflows do confirmation SMS / trigger-link confirms / reschedule links natively — provision a canonical
> GHL reminder workflow at onboarding instead: instant confirm SMS, 24h reminder with confirm trigger-link, 2h
> short SMS, reschedule links; that SOP task lives in BRENDAN_TODO/onboarding); A/B testing (already deferred; no
> statistical power at 1-client volume); a self-serve agent-builder / white-label SaaS portal (invites
> prompt-portability churn; sell outcomes not tooling); WhatsApp/IG/FB DM expansion (GHL covers if asked); voice
> cloning (gimmick for this ICP); own scheduling engine (GHL calendars do round-robin/multi-staff); per-appointment
> performance pricing (creates volume-over-quality incentives — the quality retainer is the differentiation).

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

## Hard constraints (apply to any feature touching these)

- **Voice agent prompts are report-only.** Never edit prompt content in Retell or repo prompt files; report the location + recommended change to Brendan, who applies it via the BFD setter UI.
- **Backward compatibility:** never break the live main-form flow when adding routing/cadence features.
- **GHL Webhook V2 signs with RSA, not HMAC** — confirm the real signing mechanism before provisioning secrets.
- **Multi-DB app:** the frontend reads the platform DB *and* per-client external DBs, so `types.ts` can't be wholesale-regenerated. Apply schema types surgically.
