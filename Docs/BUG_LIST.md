# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25 with Brendan (one-by-one triage of all lists).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`).
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## 🔴 High — core behavior

_(none open — B-2 by-phone pivot SHIPPED Session 5 2026-06-26, → TEST_LIST.)_

## 🟠 Medium

_(none open — B-4 settings nav split SHIPPED Session 3 2026-06-25, → TEST_LIST.)_

## 🟢 Low — hardening / cleanup

- [ ] **G3-7 (found in Session 2) vite dev-server advisories need a major bump.** `npm audit` (frontend) flags vite ≤6.4.2: path-traversal in optimized-deps `.map` handling (GHSA-4w7w-66w2-5vf9, high) + `server.fs.deny` bypass on Windows + launch-editor NTLM disclosure. All **dev-server only** (prod ships a static build). Fix = bump vite 5.4 → 7/8 (a breaking change), its own session. Also pre-existing moderate advisories on `dompurify` and `tar` (the latter via the `supabase` optional dep) are `npm audit fix`-able. Effort M (vite is breaking).

## 🔵 Large hardening

- [ ] **G3-6 (S1-1 Category C) ~20 browser flows still read secret *values*.** The `clients_public` view boundary shipped, but Dashboard, ChatAnalytics (×5 + in-browser `createClient`), PromptManagement (×2), KnowledgeBase, AnalyticsV2, `useClientCredentials` (CREDENTIALS_FIELDS), and the secret-editing pages still pull a secret value into the browser; each needs an edge-fn so the key stays server-side (pattern: `make-retell-outbound-call` + `_shared/authorize-client-request.ts`). Secrets are already RLS-scoped, so this is defense-in-depth, but Brendan wants it done. Effort L.

---

> Shipped in **Session 5 (2026-06-26, by-phone pivot)** → moved to `TEST_LIST.md`: **B-2**. Verify-first found most of B-2 already live from Spec 1 (STOP fully internal + by-phone, zero GHL; inbound already internal-first via `resolveLeadByPhone`; `normalized_phone` set on the main create paths). The residual GHL `findOrCreateGhlContact` fallback on the inbound miss (only `receive-twilio-sms`) was made **(1a) deterministic** (filter exact-phone matches → most-recently-updated survivor, not first-match) and **(1b/1c) resilient**: a GHL outage no longer drops the reply (REL-03) — it mints a deterministic internal lead `bfd-<normalized_phone>` (reply flows Twilio-direct), logs `ghl_contact_resolve_degraded`, and a background `EdgeRuntime.waitUntil` reconcile repoints the synthetic row to the real GHL id (bounded child set: leads/message_queue/dm_executions/active_trigger_runs) behind a UNIQUE-collision guard. Also fixed the **CSV-import gap**: `process-lead-file` now sets `normalized_phone` via the shared helper + a one-time idempotent backfill migration (`20260627120000`). receive-twilio-sms **v29**, process-lead-file **v14**, migration applied. Server-side verified (column/index present, `rows_missing_norm=0`, no dup `bfd-%` rows); no Trigger redeploy (`trigger/*` unchanged). Deferred (unchanged): the full Spec-2 N-row merge.
>
> Shipped in **Session 3.1 (2026-06-26, F2b inbound-toggle hotfix)** → moved to `TEST_LIST.md`: **B-6**. Read-only diagnosis confirmed the persistence path already works on the live build (live DB: slot 8 "Inbound BFD Agent" `is_inbound=true`, `clients.retell_inbound_agent_id=agent_b2f6495…`, Retell `+61481614530` inbound→`agent_b2f6495…` — the whole chain was correctly bound; Brendan's original failure was testing mid-Railway-deploy on the old build). Real bug = **split-brain list badges**: they read `prompts.is_active` ("Not Active") + `prompts.directions` ([]) instead of the SoT `voice_setters.is_inbound`. Fix: list badges now read `voice_setters.is_inbound` (uncached) → inbound setter shows green **"Inbound" + "Bound"** (or amber **"Inbound · rebind"** if `clients.retell_inbound_agent_id` doesn't match), not red "Not Active"; toggle made non-silent + race-safe (`disabled` while writing + `.select('id')` 0-row detection in `useSetInboundSetter`). Frontend-only; tsc + build green; **no edge deploy**.
>
> Shipped in **Session 2 (2026-06-25, security/quality sweep)**: **G3-1** was already fixed in `49a594e` (both `voice-booking-tools` + `kb-ingest` fail-closed on NULL `intake_lead_secret`) → `COMPLETED_LOG.md`. **G3-2** shared-master-agent disambiguation (match `ghl_account_id`→`ghl_location_id`, log ambiguous), **G3-3** mandatory `active_call_id` bind (refuse stamp when `call_id` missing), **G3-4** real 400/502 status codes + 2 UI callers read `error.context`, **G3-5** esbuild forced to 0.25.12 (override), **types.ts drift** 5 columns added to live `clients` + `clients_public` (security boundary preserved) → all to `TEST_LIST.md`. retell-call-webhook v21, test-external-supabase v17.
>
> Shipped in **Session 1 (2026-06-25, voice reliability)** → moved to `TEST_LIST.md` (need Brendan's re-Save + live verify): **B-1** setter-rename cascade, **B-3** outbound auto-follows `latest_published`, **B-5** default-vars net (root cause found: the field is LLM-level, not agent-level — the v43 agent-level set was a silent no-op; now on `llmPayload`, verified end-to-end on a throwaway agent). retell-proxy v45, duplicate-setter-config v8.
>
> Closed in the 2026-06-25 reconciliation: inbound neutral greeting, Trigger latency, 6.8 `{{first_name}}`, F10 key rotation, 6.13 GHL secret-field check — see `Docs/archive/COMPLETED_LOG.md`. Prior shipped clusters (audit waves, billing B1/B2, session-1 hardening, S6, clients_public boundary) are in `Docs/ROADMAP.md` + the dated handoffs.
