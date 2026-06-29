# BFD-Setter — Feature List (canonical, build queue)

Features to build, in rough priority order. Reconciled 2026-06-25 with Brendan.

- **Companion lists:** bugs → `Docs/BUG_LIST.md` · your manual actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated features → `Docs/DEFERRED.md`.
- **Status:** `[ ]` planned · `[~]` partly built · `[x]` shipped (move to `Docs/archive/COMPLETED_LOG.md` + note in `Docs/ROADMAP.md`).
- All items are **CODE**. When one ships, move it out and add a TEST_LIST entry for live verification.

---

## Build queue

- [ ] **F8 - Configurable cost-to-price calculator (per-minute, multi-currency).** NEXT BUILD (split from F9; Brendan 2026-06-26: F9 first, F8 after the TEST pass). Admin-set, **agency-only** panel on Sub-Account Config that computes a blended displayed price per minute from real provider costs (Retell + OpenRouter LLM + Twilio voice/SMS + number rental + other), with a per-provider on/off toggle (e.g. Twilio off when the client runs their own Twilio), a display currency + admin-set USD-to-AUD FX, and a markup percentage (10 / 50 / 100% etc.). **Decided scope (Brendan):** per-sub-account override on a global default rate card. **NEW requirement:** a per-sub-account "**show rate to client**" toggle (set in the agency settings) that surfaces a **read-only** blended-$/min **display card in that client's own account settings** — markup/breakdown stay agency-only; only the final blended $/min shows to the client when the toggle is on. The LLM line is a live model-aware estimate; voice has Retell's actual per-call cost to reconcile against. Full spec + provider-rate research in the "Feature spec - F8" section below. Effort L.
- [ ] **F11 - Credentials "Configured" masked indicator + optional-key labelling.** Requested by Brendan 2026-06-28 (Session 7) — a blank box + "CONFIGURED" badge doesn't read as obviously-filled. Make a configured secret visually obvious. **Brendan chose (A) 2026-06-28:** a secure fixed-length **dot-mask** `••••••••••••` shown in the box when configured + a bolder "Configured ✓" — looks filled, **zero real characters sent to the browser** (preserves G3-6). (Rejected (B) last-4-real to avoid re-exposing any secret chars.) Build right after the Session 7 sweep. Touches `ApiCredentials.tsx` (+ `SetupGuideDialog.tsx` for parity). **Also:** label the genuinely-optional keys (**Supabase PAT** → Supabase Usage dashboard; **OpenRouter Management Key** → OpenRouter billing panel) as "Optional" so they don't read as missing-required. NB the page already correctly drives CONFIGURED/NOT-CONFIGURED off `has_*` (G3-6 working) — this is polish only. Effort S.
- [x] **F9 - Per-setter Retell lock + ownership-based config sync.** SHIPPED Session 6.5 2026-06-26 → `TEST_LIST.md`. v1: `voice_setters.is_retell_locked` (+ `retell_locked_at`/`retell_synced_at`/`retell_synced_version`/`retell_config_snapshot`, migration `20260627130000`); **server-enforced** write-guard in retell-proxy across all write paths via `_shared/retell-lock.ts` (single-target THROW 423 `setter_retell_locked`; bulk `set-voicemail`/`refresh-booking-tool-messages` SKIP locked setters + report them); `make-retell-outbound-call` skips the at-call voicemail PATCH for a locked setter but **still dials**; new `set-setter-lock` + READ-ONLY `pull-retell-config` actions (snapshot + version drift); tile lock toggle + confirm dialogs + Retell-locked/sync badges + Pull button + Edit-entry gating in `PromptManagement.tsx`. retell-proxy **v46**, make-retell-outbound-call **v27**. 12 guard-core unit tests. **v2 (deferred → DEFERRED.md):** scheduled drift poll, booking-tools-present alert, auto "pull Retell into BFD before unlock". Full spec in "Feature spec - F9" below.
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

## Hard constraints (apply to any feature touching these)

- **Voice agent prompts are report-only.** Never edit prompt content in Retell or repo prompt files; report the location + recommended change to Brendan, who applies it via the BFD setter UI.
- **Backward compatibility:** never break the live main-form flow when adding routing/cadence features.
- **GHL Webhook V2 signs with RSA, not HMAC** — confirm the real signing mechanism before provisioning secrets.
- **Multi-DB app:** the frontend reads the platform DB *and* per-client external DBs, so `types.ts` can't be wholesale-regenerated. Apply schema types surgically.
