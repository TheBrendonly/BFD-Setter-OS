# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25 with Brendan (one-by-one triage of all lists).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`).
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## 🔴 High — core behavior

- [ ] **B-2 (6.5) STOP + inbound resolution should be internal + by-phone (drop GHL lookup).** (a) STOP should stop ALL leads sharing a phone, handled in BFD; (b) inbound (`receive-twilio-sms`) currently resolves via GHL `/contacts/search` (first match, non-deterministic for shared numbers). Pivot to internal by-phone dedupe, no GHL round-trip. 6.10 (`normalized_phone` on intake) is the prerequisite and is already done. **Confirmed internal-first 2026-06-25.** Effort L.

## 🟠 Medium

_(none open — B-4 settings nav split SHIPPED Session 3 2026-06-25, → TEST_LIST.)_

## 🟢 Low — hardening / cleanup

- [ ] **G3-7 (found in Session 2) vite dev-server advisories need a major bump.** `npm audit` (frontend) flags vite ≤6.4.2: path-traversal in optimized-deps `.map` handling (GHSA-4w7w-66w2-5vf9, high) + `server.fs.deny` bypass on Windows + launch-editor NTLM disclosure. All **dev-server only** (prod ships a static build). Fix = bump vite 5.4 → 7/8 (a breaking change), its own session. Also pre-existing moderate advisories on `dompurify` and `tar` (the latter via the `supabase` optional dep) are `npm audit fix`-able. Effort M (vite is breaking).

## 🔵 Large hardening

- [ ] **G3-6 (S1-1 Category C) ~20 browser flows still read secret *values*.** The `clients_public` view boundary shipped, but Dashboard, ChatAnalytics (×5 + in-browser `createClient`), PromptManagement (×2), KnowledgeBase, AnalyticsV2, `useClientCredentials` (CREDENTIALS_FIELDS), and the secret-editing pages still pull a secret value into the browser; each needs an edge-fn so the key stays server-side (pattern: `make-retell-outbound-call` + `_shared/authorize-client-request.ts`). Secrets are already RLS-scoped, so this is defense-in-depth, but Brendan wants it done. Effort L.

---

> Shipped in **Session 2 (2026-06-25, security/quality sweep)**: **G3-1** was already fixed in `49a594e` (both `voice-booking-tools` + `kb-ingest` fail-closed on NULL `intake_lead_secret`) → `COMPLETED_LOG.md`. **G3-2** shared-master-agent disambiguation (match `ghl_account_id`→`ghl_location_id`, log ambiguous), **G3-3** mandatory `active_call_id` bind (refuse stamp when `call_id` missing), **G3-4** real 400/502 status codes + 2 UI callers read `error.context`, **G3-5** esbuild forced to 0.25.12 (override), **types.ts drift** 5 columns added to live `clients` + `clients_public` (security boundary preserved) → all to `TEST_LIST.md`. retell-call-webhook v21, test-external-supabase v17.
>
> Shipped in **Session 1 (2026-06-25, voice reliability)** → moved to `TEST_LIST.md` (need Brendan's re-Save + live verify): **B-1** setter-rename cascade, **B-3** outbound auto-follows `latest_published`, **B-5** default-vars net (root cause found: the field is LLM-level, not agent-level — the v43 agent-level set was a silent no-op; now on `llmPayload`, verified end-to-end on a throwaway agent). retell-proxy v45, duplicate-setter-config v8.
>
> Closed in the 2026-06-25 reconciliation: inbound neutral greeting, Trigger latency, 6.8 `{{first_name}}`, F10 key rotation, 6.13 GHL secret-field check — see `Docs/archive/COMPLETED_LOG.md`. Prior shipped clusters (audit waves, billing B1/B2, session-1 hardening, S6, clients_public boundary) are in `Docs/ROADMAP.md` + the dated handoffs.
