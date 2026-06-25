# BFD-Setter — Feature List (canonical, build queue)

Features to build, in rough priority order. Reconciled 2026-06-25 with Brendan.

- **Companion lists:** bugs → `Docs/BUG_LIST.md` · your manual actions → `Docs/BRENDAN_TODO.md` · verify-after-build → `Docs/TEST_LIST.md` · deferred/gated features → `Docs/DEFERRED.md`.
- **Status:** `[ ]` planned · `[~]` partly built · `[x]` shipped (move to `Docs/archive/COMPLETED_LOG.md` + note in `Docs/ROADMAP.md`).
- All items are **CODE**. When one ships, move it out and add a TEST_LIST entry for live verification.

---

## Build queue

- [ ] **F1 — GHL deep-link custom field.** On lead create/sync, write a **"BFD Conversation Link"** custom field (or note) on the GHL contact pointing to the lead's BFD conversation page (`/leads/<lead_id>`, served by `ContactDetail.tsx`). Lets a client click from GHL into BFD's full conversation view, and lets a client keep their own GHL/Twilio number with no double-send risk. Replaces the GHL conversation-provider POC near-term (see DEFERRED 6.12a). Effort S-M.
- [ ] **F3 — Pause / resume a running cadence.** Add a `paused` state to `engagement_executions` + a UI button + state-machine handling in `runEngagement.ts` (frozen-wait at a step boundary, opt-in). Full design in the 2026-06-13 handoff. Needs a live-runtime E2E. Effort M.
- [ ] **F4 — Per-tenant timezone-aware `nudgeColdReply` cron.** Today the cron is fixed UTC; make it per-region or do a lead-local-time check so multi-tenant nudges fire at sane local hours. Effort M.
_(F2, F5, F6, F7 SHIPPED Session 3 2026-06-25 → TEST_LIST + COMPLETED_LOG. F5's optional `text_engine_webhook` column drop is deferred — see DEFERRED.md — because the column is wired into the `clients_public` view; the n8n code path itself was already gone.)_

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
