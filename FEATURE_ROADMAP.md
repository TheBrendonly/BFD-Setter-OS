# BFD-Setter Feature Roadmap

Single forward-looking view of what the platform does today and what is planned next. This consolidates feature items that were previously scattered across `Docs/ROADMAP.md`, `SOP/CAMPAIGN_PLAYBOOK.md`, `Docs/CADENCE_DESIGN.md`, `Docs/AUDIT_2026-06-10_full-system-audit.md`, the HubSpot coexistence docs, and `User Todos.md`.

- **Scope:** product features only. Operational tasks (provisioning, soaks, client onboarding) live in `User Todos.md`. The chronological build/session log lives in `Docs/ROADMAP.md`.
- **Last updated:** 2026-06-13 (Tier 0-4 build: 2.5 credential verify, 2.2 email validation, 3.8 brand voice shipped; 3.4/3.9 deferred with designs in the 2026-06-13 handoff)
- **Maintenance rule:** when a planned feature ships, move it up to "Shipped" with its commit, and update the source doc it came from. Do not turn this file into a session log; keep it status-organized.

## Status legend
`[x]` shipped and live  `[~]` partially built (schema or backend done, needs UI or activation)  `[ ]` designed/planned, not built  `[B]` requires Brendan (provisioning, prompt content, or a business decision)

---

## 1. Shipped (live in production)

The core appointment-setter platform. A business connects GoHighLevel, a lead messages them, and Gary (the AI setter) replies, handles objections, follows up, and books.

- [x] **Multi-channel AI setter** across SMS, Instagram DM, and Facebook (Gary persona). See `README.md`.
- [x] **Native text engine** (`use_native_text_engine=true`) so the DM/SMS flow runs through Trigger.dev directly, no n8n hop. n8n is in wind-down (see Phase 10 below).
- [x] **Engagement cadences** (multi-touch SMS + voice + email sequences) via `runEngagement.ts`. v1 cadence active; the 28-node v2 cadence is built as a draft (see 2.1).
- [x] **Email channel in cadences** (`EngageChannel.type` includes `email`, GHL Conversations send path). Source: `User Todos.md` B7.
- [x] **Form-to-agent routing** (tag-per-campaign): different GHL forms add distinct tags, each tag routes to its own campaign with its own agent and cadence. Single canonical ingress `sync-ghl-contact` plus a default fallback. Source: `Docs/FORM_ROUTING.md`, `Docs/ROADMAP.md` P1.
- [x] **Native CSV / list reactivation** (`reactivate-lead-list` edge fn + DB Reactivation page) enrols uploaded or filtered contacts into a chosen cadence natively, no external webhook. Source: `Docs/ROADMAP.md` P2.
- [x] **Voice setters** (UUID `voice_setters` model core + legacy slots 1-10 in RetellAgentsTab), with per-direction agent forking guard. Source: `Docs/ROADMAP.md` P3, voice-setters memory.
- [x] **Voice setter config UI**: current Retell model dropdown, Fast Tier (`model_high_priority`) toggle, and a live account voice picker (312 voices incl. custom ElevenLabs clones, with preview). Source: voice-setter models memory (commit `41113a5`).
- [x] **Save-Setter guard hardening** (shared-agent fan-out protection, fork opt-in). Source: Save-Setter memory (commit `3023c7c`).
- [x] **Multi-tenant isolation / RLS**: tenant-scoped policies, dual-mode `authorize-client-request.ts` (service-role OR JWT-owner) across edge functions, RLS on `message_queue` / `active_trigger_runs`. Source: security-review memory (`c2ca345`), `Docs/SECURITY_REVIEW_2026-06-05.md`.
- [x] **Webhook auth hardening**: static `x-wh-token` constant-time compare on all 6 GHL handlers; Retell HMAC. Source: `Docs/AUDIT_2026-06-10_full-system-audit.md`.
- [x] **Paid call-path idempotency + retry classification + error_logs coverage**. Source: audit second-wave memory (`47b97d5`).
- [x] **Quiet-hours, opt-out (STOP), and reply-detected cadence-end guards**. Source: `Docs/CADENCE_DESIGN.md` Phase 4a-4c.

---

## 2. Near-term (built but not finished: needs UI, activation, or a small wire-up)

These have schema or backend in place. The remaining work is frontend or a flip.

- [~] **2.1 Activate BFD cadence v2** (28-node, 21-day multi-phase: Hot Burst, Warm Pursuit, Cool Down). Workflow `c206da3e-…` exists as `is_active=false`. Needs Brendan to eyeball it in the editor, then run the 3-step activation SQL. Source: `Docs/CADENCE_DESIGN.md` v2 section, `User Todos.md` CV2-4. `[B]`
- [x] **2.2 Engagement email channel** (shipped 2026-06-13, `08b79f4`): email already renders in the channel picker (the prior "no email option" note was stale); added the missing validation (subject + message required) in `validateEngageNodes`.
- [~] **2.3 Per-setter phone-binding UI** (assign inbound/outbound number to voice setters 4-10). Slots 1-3 phones are backfilled today; legacy slot path works. Source: `Docs/ROADMAP.md` voice-setters follow-ups.
- [~] **2.4 UUID-native cadence node picker** in `Engagement.tsx` (read `voice_setters` directly instead of the legacy `Voice-Setter-N` slots, which work via the resolver today). Source: `Docs/ROADMAP.md` P3.
- [x] **2.5 Credential "Verify"** (shipped 2026-06-13, `08b79f4`): `verify-credentials` edge fn does live server-side reads for Retell / GHL / Twilio / OpenRouter; a "Connection Check" card on API Management shows pass/fail per provider. Secrets stay server-side. Verified live (BFD = all 4 Connected).
- [~] **2.6 Cost-per-booking analytics dashboard**: `cadence_metrics` schema and the `cadence_funnel` materialized view exist; no frontend chart yet. Gated on having ~60 days of data. Source: `User Todos.md` D4, `SOP/CAMPAIGN_PLAYBOOK.md` Gap E4.

---

## 3. Planned features (designed, not built)

Each of these has a written design or clear scope. None is started. Ordered roughly by breadth of value.

- [ ] **3.1 A/B testing** (one capability, three layers). Shared infra: an `ab_test_groups` concept (group owns the tag), variant assignment (round-robin or sticky-by-lead hash), and a comparison view of reply rate / bookings per variant. Build the assignment + comparison plumbing once, then expose all three test types on top.
  - **3.1a Campaign-level A/B**: split inbound leads for one tag across two or more campaigns (test timing, framework, or cadence shape). Needs the partial unique index relaxed for grouped campaigns plus resolver rotation. Difficulty: MODERATE. Source: `Docs/ROADMAP.md` "A/B testing", `SOP/CAMPAIGN_PLAYBOOK.md` Gap E6.
  - **3.1b Agent-level A/B (general)**: split traffic across two agents (voice or text setter) on the SAME cadence to test which agent converts better, holding copy and timing constant. Reuses the per-node / per-campaign setter selection plus the variant-assignment plumbing from 3.1; the winner can be promoted to the default setter. Difficulty: MODERATE.
  - **3.1c AI-generated A/B**: the system auto-generates the variant copy (and, for agents, prompt or persona variations) instead of the operator hand-writing each arm. `aiGenerateEngagementCopy` already produces per-node copy; extend it to emit N labelled variants, stamp the arm on each send, and surface a "promote winner" action once a variant leads on reply or booking rate. Honors the report-only prompt rule in section 6 (AI proposes voice-agent prompt variants; Brendan applies the winner via the BFD setter UI). Difficulty: MODERATE-HIGH. Recommendation: build after 3.1a/3.1b so there is a comparison surface to plug into.
- [ ] **3.2 Agent-by-form-field (within-cadence agent override)**: a form field value picks which voice agent calls the lead inside ONE shared cadence (e.g. `service_type=residential` to Agent A, `commercial` to Agent B). Runtime mechanism already exists (`voice_setter_id_override`, proven by Try-Gary). Net-new: `field_agent_mapping` JSONB + a GHL custom-field read at enrol + a small node UI. Difficulty: MODERATE. Recommendation: DEFER until a client needs same-cadence/different-agent (tag-per-campaign covers ~80%). Source: `Docs/ROADMAP.md` "Agent-by-form-field".
- [ ] **3.3 Campaign-level default voice setter**: a campaign-level default that all phone_call nodes inherit, with optional per-node override (matches how text setter already works at campaign level). Difficulty: LOW-MODERATE. Recommendation: DEFER (per-node selection works now). Source: `Docs/ROADMAP.md` "campaign-level voice-setter default".
- [ ] **3.4 Pause / resume on a running cadence**: add a `paused` state to `engagement_executions` plus a UI button and state-machine logic in `runEngagement.ts`, so an owner can pause a campaign for a holiday week without losing the lead's place. Source: `SOP/CAMPAIGN_PLAYBOOK.md` Gap E5. **Full design ready** in `Operations/handoffs/2026-06-13-tier0-4-build.md` (deferred: modifies the live cadence runtime, needs a live E2E test).
- [ ] **3.5 Multi-workflow enrollment state machine** (`engagement_enrollments` table): let a lead transition between Hot Pursuit / Cool Down / Long-Tail / Re-engage workflows instead of living in one workflow forever. Effort: XL. Prerequisite for 3.6. Source: `User Todos.md` CV2-1.
- [ ] **3.6 Long-tail nurture workflow**: a second, weekly or bi-weekly email-only drip enrolled after a cadence completes or a lead goes silent. Requires 3.5. Source: `User Todos.md` CV2-2.
- [ ] **3.7 Behavioral re-warm triggers**: email link clicks and GHL pricing-page-visit events re-enrol a lead into a Re-engage workflow. Needs click-tracking infra and GHL custom-field setup. Effort: L. Source: `User Todos.md` CV2-3.
- [x] **3.8 Brand voice** (shipped 2026-06-13, `08b79f4`): `clients.brand_voice` column + a Brand Voice textarea in Sub-Account Settings; runEngagement passes it to `aiGenerateEngagementCopy`. (Per-client only; per-workflow override not built.)
- [ ] **3.9 Cost ceiling per-week / per-month aggregates**: today's guard is per-lead (>500c to error_logs). Add a per-tenant rolling-window aggregate so a runaway tenant is flagged before any single lead is. Source: `User Todos.md` CV2-8. **Blocked**: there is no per-execution cost store to aggregate (cost is in-memory, only logged when the per-lead guard fires); needs a cost-tracking table first. Design in the 2026-06-13 handoff.
- [ ] **3.10 Per-tenant timezone-aware nudgeColdReply cron**: current cron is fixed UTC; multi-tenant needs per-region runs or a lead-local-time check. Effort: M. Source: `User Todos.md` CV2-6.
- [ ] **3.11 HubSpot + GHL coexistence (client-specific)**: HubSpot-first lead with GHL kept as the calendar (lazy mirror at booking). Fully analyzed and designed but not built; specific to clients using HubSpot. Source: `Docs/HUBSPOT_CLIENT_RECOMMENDATION.md`, `Docs/HUBSPOT_GHL_COEXISTENCE_ANALYSIS.md`. `[B]`
- [ ] **3.12 SMS/text setter tool parity (book / reschedule / cancel / check-slots / schedule-callback via SMS)** — **MAJOR, asap (Brendan 2026-06-19).** Today the text engine (`trigger/processMessages.ts`) is **reply-only**: it converses + schedules follow-up timers but has NO action tools, so a lead cannot book, reschedule, cancel, check availability, or ask to be called back over SMS — all of those work only on the voice agent. **Build:** add a function/tool-calling layer to the text setter so the LLM can invoke the SAME `voice-booking-tools` edge fn (clientId-scoped) the voice agent uses — `get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments`, `schedule-callback`. An inbound SMS that books / asks for a call fires the matching tool, folds the result into the reply, and writes the booking (add `source='sms'`). **No new booking backend needed — reuse `voice-booking-tools`.** Notes: SMS is async/multi-turn over the debounce window in `processMessages`, so the booking sequence spans messages (offer slots → confirm → book); honor the by-phone opt-out gate (STEP 1.5) and the report-only prompt rule (§7). Unlocks: book-via-SMS, make-a-booking-via-SMS, ask-to-be-called-via-SMS, reschedule/cancel-via-SMS, check-availability-via-SMS. Effort: L. Surfaced during the 2026-06-19 E2E test planning. Gap tracked at §6.9.

---

## 4. Strategic / business decisions (defer until ~30 days post Client #2)

Not pure features; they gate or reshape the platform. Source: `User Todos.md` Phase D.

- [B] **4.1 Pricing model** (cost-plus vs flat retainer): held until cost-per-booking data exists. Stripe billing wiring is the dependent code item.
- [ ] **4.2 Phase 10: n8n decommission**: after a clean soak on the native text engine, delete the n8n `else` branch in `processMessages.ts`, optionally drop `clients.text_engine_webhook`, and shut down the n8n Railway service.
- [ ] **4.3 Multi-Twilio failover**: if combined client volume exceeds a single Twilio account's safe ceiling.

---

## 5. Polish / rebrand remnants (do before serious Client #2 onboarding)

Content and asset cleanup, not functional. Source: `User Todos.md` Phase E.

- [B] **5.1 Setup-guide screenshot re-shoot**: `SetupGuideDialog.tsx` still tells admins to create a Retell folder named "1Prompt" with matching screenshots. Lock the canonical BFD folder name first, then update text + re-shoot.
- [ ] **5.2 Upstream pun-quiz lesson rewrite**: `MultiAgentLogicStep.tsx` / `VoiceInboundLogicStep.tsx` quiz content puns on the upstream "1prompt" name; rewrite around BFD-setter concepts.

---

## 6. Fixes and UX cleanups to schedule

> **Canonical open-bug tracker: [`Docs/BUG_LIST.md`](Docs/BUG_LIST.md)** (consolidated 2026-06-19). The items below are mirrored there; maintain `BUG_LIST.md` as the single bug source going forward. `BUG_LIST.md` also flags the 2026-06-10 audit findings that still need a fixed-vs-open reconciliation.

Known issues raised for the roadmap. Not new features; these correct existing behavior. Capture the exact symptom with Brendan before building where noted.

- [ ] **6.1 Rework the sidebar "SYSTEM" section so it makes sense.** Today it is a hardcoded block at the bottom of the sidebar (`frontend/src/components/ClientLayout.tsx:952`) holding four items: Manage Sub-Accounts (agency only), Sub-Account Settings, Account Settings, and Sign Out. Two problems: (1) the labels overlap and confuse, "Sub-Account Settings" (per-client config: timezone, contact hours, voicemail, logo) vs "Account Settings" (user-level: email, password, theme) vs "Manage Sub-Accounts" (the agency client list) read as near-duplicates; (2) the block sits outside the configurable menu model that drives the rest of the sidebar (`hooks/useClientMenuConfig.ts`, sections MAIN / CONFIG / OPS / BACKEND). Fix: rename for clarity (e.g. "Workspace Settings" vs "My Account" vs "All Sub-Accounts"), group/iconography pass, and decide whether SYSTEM should be part of the configurable catalog or stay pinned. Frontend-only. `[B]` confirm the preferred labels.
- [ ] **6.2 Fix logins for both admin and sub-accounts.** A single email/password flow (`frontend/src/pages/Auth.tsx` + `useAuth`) resolves to either the agency/admin role or the `client` (sub-account) role, then redirects (`role === 'client'` to that client; agency to the client list). Both login paths are reported as needing a fix. Capture the exact symptom per role (failed redirect, role misresolution, session not persisting, wrong landing page) before building, then verify both roles end-to-end. `[B]` provide the specific failing behavior for each role.

### From the 2026-06-17 full live run-through (`Operations/handoffs/2026-06-17-full-live-run-through.md`)

- [ ] **6.3 Refactor the 8 raw-`fetch`-from-`VITE_SUPABASE_PROJECT_ID` call sites to `supabase.functions.invoke`.** Manual send (and 7 other features: `lib/twilioNumbers.ts`, `pages/InstagramDMs.tsx`, `pages/ApiCredentials.tsx`, `pages/EmailInbox.tsx`, `pages/DemoPageContactChat.tsx`, `components/instagram/AttendeeAvatar.tsx` + `AttendeeProfileDialog.tsx`, `components/contacts/ContactConversationHistory.tsx`) build their fetch URL + apikey from `VITE_SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PUBLISHABLE_KEY`. When those Railway build vars are unset the URL becomes `https://undefined.supabase.co/...` and silently "Failed to fetch" (root cause of the manual-send outage; Brendan fixed the Railway env live 2026-06-17). Durable fix: use the supabase-js client (known-good `VITE_SUPABASE_URL`/anon key) so the call sites can't drift from a separate env var. Frontend-only.
- [ ] **6.4 Lead field edits don't persist when cleared (phone reappears after Save).** `ContactDetail.tsx handleSaveContact` updates internal `leads` then pushes to GHL via `push-contact-to-ghl`; a GHL re-sync overwrites the cleared field back, so removing a phone never sticks (`updated_at` unchanged on the row). Ties to the internal/standalone pivot: BFD lead edits should be authoritative and not get clobbered by a GHL re-sync. `[B]` confirm desired source-of-truth behavior.
- [ ] **6.5 Make STOP + inbound lead-resolution internal and by-phone (drop GHL contact lookup).** Two parts: (a) STOP should stop ALL leads sharing a phone number, handled in BFD, not per-single-lead; (b) inbound (`receive-twilio-sms` `findOrCreateGhlContact`) resolves the caller via GHL `/contacts/search` and uses the first phone match — non-deterministic when a number maps to multiple GHL contacts, so STOP applied to one lead doesn't gate the next inbound, and replies fragment across duplicate leads. Pivot is standalone: resolve/dedupe a single internal lead by phone, and when an unknown number texts in, create/match one internal lead (no GHL round-trip). Surfaced live: 3 inbounds from one number resolved to 3 different leads. `[B]` confirm the internal-first model.
- [ ] **6.6 Retell signature-verify 403s the inbound webhook when `retell_webhook_secret` is armed.** `retell-inbound-webhook` is verify-if-present; arming the secret made `verifyRetellSignature` reject the inbound call, returning 403 → Retell got no `dynamic_variables` → the agent spoke literal `{{first_name}}` (confirmed by A/B: armed = placeholder, NULL = real name). The inbound webhook is likely unsigned / signed differently than the post-call webhooks. Fix: confirm Retell's inbound-webhook signing and either exempt the inbound webhook from verification or verify it correctly, BEFORE arming the secret. Until then DO NOT arm `retell_webhook_secret`. Code: `_shared/verify-webhook.ts`. `[B]` provides the secret only after the scheme is confirmed.
- [ ] **6.7 Synthetic-probe canary race v2.** After Build 1's first canary fix the probe still passes only ~2/24 hourly runs, failing with "no outbound message_queue row after cadence ran" (Trigger.dev start latency 45-82s). Fix: poll the Step-3 `message_queue` check on a longer deadline / wait for execution `status='completed'` rather than asserting right after `running`, accounting for the start latency. Code: `trigger/syntheticProbe.ts`; detail in memory `project_probe_enable_status`.
- [ ] **6.8 (report-only) Greeting opener does not use `{{first_name}}` on pickup.** The variable is injected and available from the first utterance, but the prompt's opening line doesn't include it, so the agent doesn't say "Hey {{first_name}}" on pickup. If name-on-pickup is wanted, Brendan adds `{{first_name}}` to the greeting line in the BFD setter UI (prompt content is report-only).
- [ ] **6.9 SMS/text engine is reply-only — no booking / callback / appointment tools (capability gap).** `trigger/processMessages.ts` generates conversational replies + follow-up timers only; it has none of the voice agent's action tools (confirmed 2026-06-19: no book/appointment/callback/tool refs in processMessages). So SMS leads can't book, reschedule, cancel, check slots, or request a callback — the AI converses but takes no action. This is the gap behind the **MAJOR feature §3.12 (SMS tool parity)**; close it by building 3.12 (reuse the `voice-booking-tools` edge fn). Surfaced during the 2026-06-19 E2E test planning.
- [ ] **6.10 🟡 LATENT (currently masked): `sync-ghl-contact` creates leads with `normalized_phone = NULL`.** Found 2026-06-19 clean-slate E2E: a fresh GHL-contact intake created lead `tSwwRGWB8v0fDAvjsxoB` with `phone='+61405482446'` but `normalized_phone=NULL`. `sync-ghl-contact/index.ts` leads `.insert({...})` (~L512-518) **omits `normalized_phone`**; `_shared/leadResolve.ts resolveLeadByPhone` matches **only** `.eq("normalized_phone", …)`, so the lead is invisible to internal by-phone. **Currently MASKED:** with GHL allow-dup OFF + the GHL-contact fallback still in the inbound path, the first inbound resolves to the single GHL contact (= the same lead) AND backfills `normalized_phone` — verified live 2026-06-19: NO dupe, the lead self-healed (`normalized_phone` set after the first inbound SMS). Still worth fixing: (a) there's a null window between create and first inbound, and (b) it **blocks §6.5** (drop the GHL lookup / internal-only) — once the GHL fallback is removed, null `normalized_phone` would cause a real miss. `intake-lead` already sets it (L390); `sync-ghl-contact` was missed. **Fix:** add `normalized_phone: normalizePhone(phone)` to the `sync-ghl-contact` leads insert (audit other create paths), redeploy. Effort: S.
- [ ] **6.11 Missed/voicemail call doesn't stamp `last_call_outcome` → cadence eats the full 600s poll ceiling before the fallback SMS (~10-min delay).** Found 2026-06-19 Run 2: outbound went to voicemail (`call_488833bd`, `voicemail_reached`, no pickup) at 03:56:31, but `engagement_executions.last_call_outcome` was never stamped, so `runEngagement` `waitForCallOutcome` (maxWait 600s, `runEngagement.ts:212-235`) polled to its 10-min ceiling, then advanced + sent the fallback SMS at 04:06:43 (~10 min late vs ~immediate if stamped). The agent `webhook_url` is `retell-call-analysis-webhook` (it wrote call_history), but the outcome-stamping path (`retell-call-webhook` per the L195 comment) didn't stamp `last_call_outcome`. **Scope: voicemail / no-answer outcomes only** — answered calls DO get stamped `human_pickup` and advance promptly (confirmed 2026-06-19 Run 1 + A3: both enrolments completed on pickup within ~1 min). Only `voicemail_reached` / missed calls weren't stamped → 10-min ceiling, so the **missed-call follow-up** is the slow path (still bad for speed-to-lead on no-answers). Investigate whether `retell-call-webhook` receives Retell `call_ended`/voicemail events (the agent posts to the analysis webhook); if not, have the analysis webhook stamp `last_call_outcome` for non-pickup outcomes too (or subscribe retell-call-webhook). Effort: M. **Speed-to-lead impact (missed calls).** Owned by the GHL-sync session (shares `retell-call-analysis-webhook` with 6.12).
- [ ] **6.12 GHL sync incomplete — SMS not in the Conversations tab + call/SMS outcome variables not written to GHL contact fields.** Flagged 2026-06-19. (a) SMS mirror needs `ghl_conversation_provider_id` (NULL; needs a GHL marketplace-app custom conversation provider) so SMS doesn't show in Conversations; (b) only sentiment + appt-booked outcome fields are wired — the broader suite (Call Outcome, AI Call Summary, Call Intent, Last Call Date, status…) isn't written, and SMS conversations write no fields at all. Needs deep research on the GHL variable mapping (what / when / source: SMS-as-they-happen vs Retell end-of-call report) + the conversation-provider mechanism, then build. Owns `retell-call-analysis-webhook` + `_shared/ghl-conversations.ts` + `push-contact-to-ghl`. Effort: L. **[B]** marketplace-app conversation provider. Canonical detail in `Docs/BUG_LIST.md` §6.12.

> **Booking timezone-offset rejection: FIXED 2026-06-17** (`eb53690`, voice-booking-tools **v17**). The voice model rebuilt the slot ISO string and dropped the timezone offset, so GHL rejected even wide-open slots as "no longer available" (no voice_call booking had ever succeeded). Fix books GHL's exact canonical free-slot string + returns real slots inline on an unmatched time. Re-test to confirm a real booking completes; `Docs/BOOKING_SLOT_INVENTION_FIX_PROMPT_2026-06-17.md` is superseded except its optional prompt-hardening.

---

## 7. Hard constraints (apply to any feature touching these)

- **Voice agent prompts are report-only.** Never edit prompt content in Retell or in repo prompt files; report the location and recommended change to Brendan, who applies it via the BFD setter UI. Source: `CLAUDE.md` "Voice Agent Prompts (Retell): Do Not Edit".
- **Backward compatibility:** never break the live main-form flow when adding routing or cadence features.
- **GHL Webhook V2 signs with RSA, not HMAC.** Any webhook-auth feature must confirm the real signing mechanism before provisioning secrets. Source: `Docs/AUDIT_2026-06-10_full-system-audit.md` WI-1.
- **Multi-DB app:** the frontend reads tables across the platform DB (`bjgrgbgykvjrsuwwruoh`) and per-client DBs, so `types.ts` cannot be wholesale-regenerated. Apply schema types surgically.

---

## Related docs

- `Docs/ROADMAP.md` — chronological build/session log (what shipped, when, by which commit).
- `User Todos.md` — operational task list (provisioning, soaks, onboarding) split by Brendan vs Claude.
- `SOP/CAMPAIGN_PLAYBOOK.md` — cadence playbooks and the E1-E6 gap list.
- `Docs/CADENCE_DESIGN.md` — cadence design philosophy and v2 detail.
- `Docs/ARCHITECTURE.md` — system architecture SSOT.
