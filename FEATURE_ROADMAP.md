# BFD-Setter — Feature List (canonical, build queue)

Features to build, in rough priority order. Reconciled 2026-06-25 with Brendan.

- **Companion lists:** bugs → `Docs/BUG_LIST.md` · your manual actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated features → `Docs/DEFERRED.md`.
- **Status:** `[ ]` planned · `[~]` partly built · `[x]` shipped (move to `Docs/archive/COMPLETED_LOG.md` + note in `Docs/ROADMAP.md`).
- All items are **CODE**. When one ships, move it out and add a TEST_LIST entry for live verification.

---

## Build queue

- [ ] **F8 - Configurable cost-to-price calculator (per-minute, multi-currency).** Admin-set panel that computes a blended displayed price per minute from real provider costs (Retell + OpenRouter LLM + Twilio voice/SMS + number rental + other), with a per-provider on/off toggle (e.g. Twilio off when the client runs their own Twilio), a display currency + USD-to-AUD FX conversion, and a markup percentage on top (10 / 50 / 100% etc.). The LLM line is necessarily a live model-aware estimate; voice already has Retell's actual per-call cost to reconcile against. Larger build, slated AFTER the current bug-fix + TEST sessions (Brendan: "look into this after all these bug fixes are done"). Full spec + provider-rate research in the "Feature spec - F8" section below. Effort L.
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

## Shipped (live in production) — context only

Core appointment-setter platform: multi-channel AI setter (SMS / IG DM / FB), native text engine (Trigger.dev, n8n bypassed), engagement cadences (`runEngagement.ts`), email channel in cadences, form-to-agent routing (tag-per-campaign), CSV/list reactivation, voice setters (UUID model + Retell, live voice picker + Fast Tier), multi-tenant RLS + dual-mode `authorize-client-request.ts`, webhook auth hardening, paid-call-path idempotency, quiet-hours/STOP/reply-end guards, credential "Verify" card, brand voice, §3.12 SMS tool parity (book/reschedule/cancel/check-slots/callback over SMS), GHL outcome-field sync, `clients_public` secret-column boundary, billing B1/B2 (dormant until Stripe go-live), S6 readiness dashboard + CI.

Full chronological build log: `Docs/ROADMAP.md`. Deferred / gated features: `Docs/DEFERRED.md`.

---

## Hard constraints (apply to any feature touching these)

- **Voice agent prompts are report-only.** Never edit prompt content in Retell or repo prompt files; report the location + recommended change to Brendan, who applies it via the BFD setter UI.
- **Backward compatibility:** never break the live main-form flow when adding routing/cadence features.
- **GHL Webhook V2 signs with RSA, not HMAC** — confirm the real signing mechanism before provisioning secrets.
- **Multi-DB app:** the frontend reads the platform DB *and* per-client external DBs, so `types.ts` can't be wholesale-regenerated. Apply schema types surgically.
