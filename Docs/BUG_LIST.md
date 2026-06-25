# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25 with Brendan (one-by-one triage of all lists).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`).
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## 🔴 High — core behavior

- [ ] **B-6 (F2b regression) Inbound-setter toggle doesn't persist + "Not Active" confusion.** Reported 2026-06-25 by Brendan: flipping "INBOUND CALLS — USE THIS SETTER?" ON for **Inbound BFD Agent** (slot 8) and saving doesn't hold; de-clicking + saving also doesn't hold; and the setter shows **"Not Active"** no matter how many times he saves.
  - **Diagnosis so far (read-only):** the F2b frontend **is** deployed (live `PromptManagement` bundle contains the new code). Live DB: `voice_setters.is_inbound` is `false` for **all** 7 BFD setters. Ruled out: RLS (the `agency_all_voice_setters` policy allows Brendan's update — his agency `fb6b57a3` owns BFD client `e467dabc`), slot-id mismatch (Inbound BFD Agent is `Voice-Setter-8` in `agent_settings`/`prompts` **and** `legacy_slot=8`, so `setInboundSetter`'s `legacy_slot` lookup is correct), and `dualWriteVoiceSetter` (its UPDATE branch never touches `is_inbound`). **Leading hypothesis:** Brendan tested while Railway was mid-deploy, so his attempts ran on the OLD build (which never wrote `is_inbound`) — a hard-refresh + retry on the now-live build may already work. **Secondary:** a subtle write/revert bug in `useSetInboundSetter` (the optimistic `setVoiceSetterDirections(prev)` revert, or an unsurfaced toast on a failed `voice_setters` UPDATE).
  - **Separate sub-issue — "Not Active":** that badge is `prompts.is_active`, which only flips true on **Deploy/Push**, not Save (by design). The inbound agent was provisioned outside this UI so its prompt slot reads "Not Active." **Do NOT just deploy it to clear the badge** — deploying pushes UI prompt content onto the live `agent_b2f6495`, overwriting the neutral inbound greeting (violates the report-only-prompt rule). Inbound routing does NOT depend on `is_active` (it works off the Retell phone `inbound_agents` binding + `clients.retell_inbound_agent_id`). Fix = make the inbound setter's status badge reflect the binding (is_inbound / bound number), not prompt-deploy state.
  - **Fix in Session 3.1** (hotfix; see SESSION_PLAN): reproduce on the live build, add explicit success/failure toasts + a busy state to the toggle so a failed write is never silent, confirm the `voice_setters` UPDATE actually persists from the browser, and decouple the inbound-setter status badge from `prompts.is_active`. Effort S.

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
