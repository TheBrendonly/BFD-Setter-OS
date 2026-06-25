# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25 with Brendan (one-by-one triage of all lists).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`).
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## 🔴 High — core behavior

- [ ] **B-1 Setter rename doesn't cascade across all name surfaces.** Renaming a setter updates some places but not others (live example: one setter is "Inbound BFD Agent" in Retell but "Voice Setter 8" in `voice_setters`, "Setter-8" as slot label, "Main Outbound V2" as card heading). **Decided source of truth = the name field on the setter edit page**, and the **duplicate-setter** name input writes that *same* field. On save, cascade atomically to: card name, persona/Title, slot label, `voice_setters.name`, and Retell `agent_name`. Touches the duplicate-setter flow, the rename handler in `PromptManagement.tsx`, the `retell-proxy` sync (PATCH `agent_name`), and the `voice_setters` dual-write. Effort M.
- [ ] **B-2 (6.5) STOP + inbound resolution should be internal + by-phone (drop GHL lookup).** (a) STOP should stop ALL leads sharing a phone, handled in BFD; (b) inbound (`receive-twilio-sms`) currently resolves via GHL `/contacts/search` (first match, non-deterministic for shared numbers). Pivot to internal by-phone dedupe, no GHL round-trip. 6.10 (`normalized_phone` on intake) is the prerequisite and is already done. **Confirmed internal-first 2026-06-25.** Effort L.
- [ ] **B-3 Outbound number pinned to a stale agent version.** Found live 2026-06-25: the inbound number auto-follows `latest_published`, but the **outbound** number is version-pinned (Main Outbound bound at **v19** while the agent's latest published is **v21**), so re-Saves bump the agent but outbound calls keep serving the old version. Fix: on push, `retell-proxy` should repoint the phone number's `outbound_agent_version` to the freshly published version (match the inbound `latest_published` behavior). Effort M.

## 🟠 Medium

- [ ] **B-4 (6.1) Settings nav split (client vs admin).** Decided model: a **client** sees only **"My Account"** (their self-serve settings); an **admin** sees **"My Account"** (own login/password/theme) **+ "Sub-Accounts"** (list → click a sub-account → its config page at `/client/<id>/settings`, which already exists). Removes the near-duplicate "Sub-Account Settings"/"Account Settings"/"Manage Sub-Accounts" confusion. `[B]`-minor: decide which workspace settings (brand voice, contact hours…) a client may self-edit in their My Account vs admin-only. Frontend (`ClientLayout.tsx` SYSTEM block, `useClientMenuConfig.ts`). Effort S-M.
- [ ] **B-5 Agent-level `default_dynamic_variables` empty-string net not persisting.** Verified 2026-06-25: all live agents (incl. the inbound `agent_b2f6495`) show `default_dynamic_variables = null`; the v43 belt-and-suspenders never stuck. The load-bearing `{{first_name}}` fix (inbound webhook returning `first_name=""`) IS deployed, so this is redundant, but Brendan wants the net in place. Make `retell-proxy` actually persist the empty-string defaults on push (and re-pin per B-3 so it takes on outbound). Effort S.
- [ ] **G3-1 (S2b-4) `voice-booking-tools` (+`kb-ingest`) fail-OPEN when `intake_lead_secret` is NULL.** Money/state tools (send-sms, book/cancel, schedule-callback) run for any caller who knows the clientId UUID. Masked today (both live clients have the secret); a new client reopens it. Fix = return 401 when a money/state tool is requested and the secret is NULL. Effort S.
- [ ] **G3-2 (S4-10) `retell-call-webhook` picks `clients[0]` for a shared master agent.** No disambiguation when an `agent_id` maps to >1 client; latent at single-tenant, integrity hazard as clients grow. Fix = disambiguate via dynamic vars (ghl_account_id / execution owner) + log ambiguous matches. Effort M.

## 🟢 Low — hardening / cleanup

- [ ] **G3-3 (S2b-11) `retell-call-webhook` stamps outcome from a spoofable `agent_id`.** Require the execution's `active_call_id == call.call_id` before stamping (a forged `call_ended` can mis-route a cadence). Effort S.
- [ ] **G3-4 (S4-8) `test-external-supabase` returns HTTP 200 on every failure.** Defeats status-based monitoring. Fix = 400 for input/validation, 502 for upstream-connection (keep the `success:false` body for the UI). Effort S.
- [ ] **G3-5 (S5-7) transitive esbuild still 0.21.5 (dev-server SSRF GHSA-67mh-4wv8-2f99).** Override/resolution to esbuild ≥0.25 (prod is a static build; dev-server only). Effort S.
- [ ] **types.ts drift — 5 phantom `clients` columns read by the browser.** `crm_page_size`, `crm_column_widths`, `log_column_widths`, `sync_ghl_booking_enabled`, `what_to_do_acknowledged` are read by the frontend but don't exist in the live `clients` table (those reads 400). Remove the reads or add the columns. Effort S.

## 🔵 Large hardening

- [ ] **G3-6 (S1-1 Category C) ~20 browser flows still read secret *values*.** The `clients_public` view boundary shipped, but Dashboard, ChatAnalytics (×5 + in-browser `createClient`), PromptManagement (×2), KnowledgeBase, AnalyticsV2, `useClientCredentials` (CREDENTIALS_FIELDS), and the secret-editing pages still pull a secret value into the browser; each needs an edge-fn so the key stays server-side (pattern: `make-retell-outbound-call` + `_shared/authorize-client-request.ts`). Secrets are already RLS-scoped, so this is defense-in-depth, but Brendan wants it done. Effort L.

---

> Closed in the 2026-06-25 reconciliation: inbound neutral greeting, Trigger latency, 6.8 `{{first_name}}`, F10 key rotation, 6.13 GHL secret-field check — see `Docs/archive/COMPLETED_LOG.md`. Prior shipped clusters (audit waves, billing B1/B2, session-1 hardening, S6, clients_public boundary) are in `Docs/ROADMAP.md` + the dated handoffs.
