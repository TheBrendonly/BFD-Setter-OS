# BFD-Setter — Feature List (canonical, build queue)

Features to build, in rough priority order. Reconciled 2026-06-25 with Brendan.

- **Companion lists:** bugs → `Docs/BUG_LIST.md` · your manual actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated features → `Docs/DEFERRED.md`.
- **Status:** `[ ]` planned · `[~]` partly built · `[x]` shipped (move to `Docs/archive/COMPLETED_LOG.md` + note in `Docs/ROADMAP.md`).
- All items are **CODE**. When one ships, move it out and add a TEST_LIST entry for live verification.

---

## Build queue

- [ ] **F1 — GHL deep-link custom field.** On lead create/sync, write a **"BFD Conversation Link"** custom field (or note) on the GHL contact pointing to the lead's BFD conversation page (`/leads/<lead_id>`, served by `ContactDetail.tsx`). Lets a client click from GHL into BFD's full conversation view, and lets a client keep their own GHL/Twilio number with no double-send risk. Replaces the GHL conversation-provider POC near-term (see DEFERRED 6.12a). Effort S-M.
- [ ] **F2 — UUID-native voice-setter model + inbound-only binding.** (a) The cadence node picker reads `voice_setters` UUIDs directly instead of legacy `Voice-Setter-N` slot strings (migrate the live workflow `40e8bea3` refs); (b) exactly **one setter is flagged "inbound"** (bound to the client's inbound number); (c) **remove outbound-direction config** from the setter UI entirely — outbound is always chosen at the campaign/workflow level. Folds in the old "per-setter phone binding" idea, simplified. Effort M.
- [ ] **F3 — Pause / resume a running cadence.** Add a `paused` state to `engagement_executions` + a UI button + state-machine handling in `runEngagement.ts` (frozen-wait at a step boundary, opt-in). Full design in the 2026-06-13 handoff. Needs a live-runtime E2E. Effort M.
- [ ] **F4 — Per-tenant timezone-aware `nudgeColdReply` cron.** Today the cron is fixed UTC; make it per-region or do a lead-local-time check so multi-tenant nudges fire at sane local hours. Effort M.
- [ ] **F5 — Phase 10: n8n decommission.** The native text engine has soaked; delete the n8n `else` branch in `processMessages.ts`, optionally drop `clients.text_engine_webhook`, and shut down the n8n Railway service. Effort S.
- [ ] **F6 — Remove the setup-guide quiz steps.** Delete `MultiAgentLogicStep.tsx` + `VoiceInboundLogicStep.tsx` (and their Setup Guide wiring) entirely — they teach the old n8n / 1prompt prompt-number architecture and Brendan doesn't want quizzes in onboarding. Ties to F5 (the inbound quiz references n8n). Effort S.
- [ ] **F7 — Cleanup: delete the draft cadence workflow `c206da3e`.** The flat 28-node v2 draft is superseded by the lifecycle direction; remove the `engagement_workflows` row (+ its nodes). Effort S (DB op).

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
