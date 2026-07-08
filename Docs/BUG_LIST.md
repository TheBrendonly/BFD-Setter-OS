# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25 with Brendan; full re-audit 2026-07-07 (Session P1).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · prompt-content edits (Brendan via UI) → `PROMPT_UPDATE_LIST.md` · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`).
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## P3 security review (2026-07-07) — new open items

> Found by the Session P3 security/quality pass over the diff since Session 9 (`4a22b8b`). Full write-up,
> fix-specs, and the "clean" clusters: `Docs/SECURITY_REVIEW_2026-07-07.md`. Nothing here is exploitable
> on the CURRENT live setup (default-OFF features, 0 client-role users) — these are pre-first-client
> hardening items; F16C-SMS-1 is gated into the milestone.

- [ ] 🔴 **F16C-SMS-1 (High, DEFERRED to First-Client Milestone) — F16(c) missed-call text-back is a
  forgeable unauthenticated outbound-SMS vector.** `retell-call-webhook/index.ts:152-217`: with
  `missed_call_textback_enabled=true` and `retell_webhook_secret` unset (the default), the signature
  block (`:128-143`) is skipped, so a forged `call_ended` POST (`direction:"inbound"`, short
  `duration_ms`, attacker-chosen `from_number`) makes the client's Twilio text that number (SMS-pumping /
  toll-fraud; mitigated by fixed body + 15-min dedupe, but numbers rotate). **Not exploitable today**
  (default-OFF, 0 clients have the flag or the secret). Brendan chose report-only + defer: the fix needs
  `retell_webhook_secret`, which the milestone arms (DEFERRED 6.6), so it is folded into
  `Docs/FIRST_CLIENT_MILESTONE.md` step 6 as a HARD prerequisite before enabling F16(c). Fix-spec (thread
  a `signatureVerified` bool through the verify block + extract a pure `shouldSendMissedCallTextback`
  predicate + gate the send, `console.warn` never throw): `Docs/SECURITY_REVIEW_2026-07-07.md`.
- [ ] 🟠 **QH-TZ-1 (Medium) — unvalidated `cadence_quiet_hours.tz` stalls a client's whole cadence.**
  `trigger/_shared/businessHours.ts:81-90` `parseQuietHours` accepts `tz` as free text; a malformed zone
  throws `RangeError` in `isWithinQuietHoursWindow` / the AU clamp on EVERY send attempt → that client's
  cadence self-DoS (fail-closed, so NOT a compliance bypass). Cheap ~10-line hardening: validate with
  `isValidTimeZone` (from `_shared/leadTimezone.ts`), fall back to `DEFAULT_QUIET_HOURS.tz` +
  `console.warn`. Trigger-only (no edge twin); test in the existing `businessHours.test.ts`. Full
  fix-spec: `Docs/SECURITY_REVIEW_2026-07-07.md`.
- [ ] 🟡 **RLS-UISTATE-1 (Low, latent) — `chat_starred` / `dismissed_error_alerts` FOR ALL policies are
  agency-scoped without the `get_user_role()='agency'` gate.** Correct only while "one agency per
  top-level client" holds. **No exposure today** (live DB: 1 agency / 2 BFD-internal clients, 0
  client-role users; tables hold only UI-state, no secret/cost data). Becomes relevant when a real
  client-role user exists AND two real clients share an agency. Mitigation: the onboarding "fresh agency
  per top-level client" step is now an explicit milestone check (`FIRST_CLIENT_MILESTONE.md`), OR add a
  client-scope to the two policies as defense-in-depth.
- [ ] 🟡 **FUNNEL-SCAN-1 (Low, perf) — `get-show-rate-funnel` scans up to ~100k bookings.**
  `get-show-rate-funnel/index.ts:101` paginates to `100 * PAGE_SIZE` under the service role. Bounded and
  fine for early clients; date-window / cap harder if a tenant ever grows large.
- [ ] 🟡 **ROLE-RESOLVE-1 (Low, pre-existing) — `get_user_role` `LIMIT 1` with no `ORDER BY`.** A user
  holding both an `agency` and a `client` role row resolves nondeterministically. Not introduced by any
  recent diff; users hold one role in practice. Defense-in-depth: order deterministically / prefer the
  more-privileged role.

## Overnight deep-work pass (2026-07-08) — new open items

> Found by the overnight discovery pass (4 parallel adversarial audits + product review). Full write-up,
> refutations, fix-specs, and the two consolidated milestone gates: `Docs/SECURITY_REVIEW_2026-07-08.md`.
> **Live enabling-state (verified):** `retell_webhook_secret`=NULL both clients, `ghl_webhook_secret`=SET
> both, `missed_call_textback_enabled`=0, **0 client-role users**, 2 clients share 1 agency. So the RLS
> cluster is **latent until the first client-role user is invited**, and the Retell-webhook cluster is
> open only while `retell_webhook_secret` is NULL. Both collapse into two hard milestone gates (GATE A =
> role-gate RLS before the first client user; GATE B = arm `retell_webhook_secret`) recommended for
> `FIRST_CLIENT_MILESTONE.md` (that file + `BRENDAN_TODO.md` were mid-edit by a concurrent session, so the
> overnight handoff routes GATE A/B + TRYGARY-DIAL-1 to Brendan to fold in — not edited this session).

- [x] 🟠 **OPTOUT-FAILOPEN-1 (High, compliance) — FIXED (trigger) + STAGED (edge twin) 2026-07-08.**
  `optout.ts` `isPhoneOptedOut` discarded the query `error` and returned `!!data`, so a transient
  `lead_optouts` SELECT failure returned "not opted out" → a billable marketing SMS to a number that
  texted STOP (AU Spam Act breach + spend) on the app's central opt-out gate. Fixed to fail CLOSED
  (return `true` = skip send, + `console.warn`) with a TDD test. `trigger/_shared/optout.ts` deployed
  via Trigger.dev this session; the byte-identical edge twin `frontend/supabase/functions/_shared/optout.ts`
  is imported by the FROZEN `voice-booking-tools` (+ non-frozen edge fns) so its fix is committed but
  STAGED — Brendan redeploys the edge consumers. Live re-check → `TEST_LIST.md`.
- [ ] 🔴 **RLS-CLIENTS-1 (Critical, latent → GATE A) — base `clients` policies have no `get_user_role()='agency'`
  gate, and `anon`/`authenticated` hold column SELECT/UPDATE/INSERT on the secret columns.** A client-role
  user reads every sibling client's `supabase_service_key` (full-DB-compromise key), Twilio token, and the
  BFD-bundled Retell/OpenRouter/GHL keys, and can `UPDATE subscription_status` / DELETE sibling rows. This is
  the 2026-06-05 F7 re-severitied for imminent client-role users + shared BFD keys. `clients_public` protects
  app code, not the base table. **Not exploitable today** (0 client-role users). High-blast-radius fix
  (79+ reads) → dedicated session before the first client user, verified with a live client-role probe. Fix
  approach + the whole GATE A cluster: `Docs/SECURITY_REVIEW_2026-07-08.md`.
- [ ] 🟠 **RETELL-BOOKING-SMS-1 (High, exploitable today → GATE B) — forgeable booking-confirmation SMS.**
  `retell-call-analysis-webhook/index.ts:643-732`: `retell_webhook_secret` NULL → unsigned; a forged
  `call_analyzed` with `appointment_booked=true` + attacker `to_number` sends a Twilio SMS to the attacker's
  number on the client's account. Sibling of F16C, different fn+sink. NOT fixed unattended (booking-confirm SMS
  is an ACTIVE feature; fail-closing while the secret is NULL breaks it). Closed by arming `retell_webhook_secret`
  + the F16C fail-closed guard at milestone 6.6.
- [ ] 🟠 **[B] TRYGARY-DIAL-1 (High, exploitable today — needs Brendan's call) — `ghl-tag-webhook` try-gary branch
  sends SMS pre-auth.** `ghl-tag-webhook/index.ts:531` returns `handleTryGaryLanding` before the
  `ghl_webhook_secret` check (`:571`); it reads `phone` from the attacker body and enrolls → immediate Twilio SMS
  (`delay_seconds:0`) to an attacker-chosen number on a live client's Twilio (5-min per-phone dedupe only →
  rotatable = toll-fraud). Route is DEPRECATED + unreferenced by `frontend/src` but still a live endpoint. NOT
  retired unattended (a GHL-side workflow may still post it). Brendan: confirm the GHL side is dead → delete the
  branch, OR move it after the secret check, OR add `bump_rate_limit`. Routed to Brendan via the overnight handoff.
- [ ] 🟡 **RETELL-CALLHIST-POISON-1 (Medium → GATE B) — forged `call_analyzed` injects attacker `call_history` +
  `execution_cost_events` rows** (`retell-call-analysis-webhook/index.ts:400-491`; fresh `provider_ref=call_id`
  defeats the idempotency guard) → poisons funnel/weekly-report/cost ledger. RISES to High once the ledger is
  wired to billing. Closed by arming `retell_webhook_secret`.
- [ ] 🟡 **RETELL-CALLBACK-DIAL-1 (Medium → GATE B) — forged payload schedules an outbound Retell voice call to
  the attacker's number** (`retell-call-analysis-webhook/index.ts:355-395`; needs a valid `voice_setter_id` UUID
  = capability barrier). Closed by arming `retell_webhook_secret`.
- [ ] 🟠 **RLS-CREDENTIALS-1 (High, latent → GATE A) — `credentials.gohighlevel_api_key` readable by a client-role
  user** (ungated agency policy; no browser read, so a role-gate is pure hardening).
- [ ] 🟡 **RLS-TENANT-DISJUNCTION-1 (Medium, latent → GATE A) — client-writable tenant tables let a client-role user
  read+write sibling clients' rows.** `client_custom_fields`, `lead_ai_columns`, `lead_tags`, `prompt_chat_threads`,
  `prompt_docs`, `prompt_versions`, `setter_ai_reports` use `c.agency_id=p.agency_id OR c.id=p.client_id` — the
  agency disjunct defeats own-client scope for client-role users. Split into agency + client-own policies.
- [ ] 🟡 **RLS-GATE-SIBLING-1 (Medium, latent → GATE A) — `fetch-thread-previews` / `twilio-list-numbers` /
  `supabase-project-usage` authorize via an RLS-gate (`clients.eq(id).single()`) not `resolveClientAccess`**, so a
  client-role user passing a sibling `client_id` reads the sibling's Twilio numbers / thread previews / Supabase usage.
- [ ] 🟡 **RLS-ORUSAGE-1 (Medium, latent → GATE A) — `openrouter_usage_cache.cached_data` (BFD margin/cost) readable
  by a client-role user** (ungated agency policy). NOTE the table IS browser-read (`useTickerStats`/`useOpenRouterUsage`),
  so the fix must role-branch (agency-only read), not merely add a gate — which is why it was NOT touched unattended.
- [ ] 🟡 **INTAKE-RL-1 (Medium, design) — `intake-lead` has no `bump_rate_limit`** and its secret is designed to be
  embedded in public client HTML; if published, an attacker reading the secret gets unbounded immediate SMS to
  attacker numbers. Add `bump_rate_limit` (the `campaign-enroll-webhook` pattern).
- [ ] 🟡 **BOOK-TZ-DISPLAY-1 (Medium) — the SMS setter tells the lead their local time via weak-model mental
  arithmetic → wrong.** `trigger/processSetterReply.ts:213-222` instructs `gpt-4.1-nano` (temp 0) to compute the
  lead-local time; the deterministic `formatSlotInZone` (`leadTimezone.ts:58`) exists but is dead code. Misleading
  confirmation in the exact cross-tz case BOOK-TZ-1 exists for (e.g. "12pm your time" when Perth-local is 11am).
  Non-frozen. Fix: pre-render each offered slot's lead-zone label with `formatSlotInZone`, drop the arithmetic
  instruction. Wants a live cross-tz SMS test. Relates to BOOK-TZ-1 + the voice-side PU-13.
- [ ] 🟡 **BOOK-CONFIRM-HONESTY-1 (Medium) — no honesty guard on failed NEW bookings.** `rescheduleHonestyGuard`
  (`trigger/processSetterReply.ts:432`) covers reschedule/cancel only; a reply falsely claiming "you're booked" when
  `book-appointments` hard-errored is caught by nothing → ghost booking. Non-frozen. Fix: extend the guard with
  "claims booked but no successful `book-appointments` this turn" (mirror RESCHED-SMS-1). Over-fire risk → wants a
  live forced-failure test.
- [ ] 🟢 **RETELL-INBOUND-PII-1 (Low → GATE B) — forged `call_inbound` returns a lead's name/email** in
  `dynamic_variables` (`retell-inbound-webhook/index.ts:52-164`; unsigned). Unauthenticated phone→identity oracle.
  Closed by arming `retell_webhook_secret`.
- [ ] 🟢 **RLS-UNIPILE-1 / RLS-AGENCIES-1 (Low, latent → GATE A) — client-role user can read a sibling's connected
  LinkedIn/IG display name+id (`unipile_accounts`) / rename the shared agency (`agencies`).** No usable secret;
  nuisance/identifier only. Fold into the GATE A role-gate sweep.

## 🟡 Low — open (code)

- [ ] **PU-9-CODE (reclassified from PROMPT_UPDATE_LIST PU-9 on 2026-07-07) — dead-air / talk-while-waiting
  latency is code-owned, not a dashboard edit (Voice-gated, retell-proxy).** On an answered booking call the
  agent goes silent for a beat while a booking tool round-trips to GHL (~3-8s), but the spoken filler is capped
  at "under 10-12 words" (~2s). The filler copy lives in a hardcoded `BOOKING_TOOL_MESSAGES` map
  (`frontend/supabase/functions/retell-proxy/index.ts:1790`) applied via the bulk `refresh-booking-tool-messages`
  action, and the normal Save & Push overwrites the agent's `general_tools` from stored config
  (`index.ts:809`) — so a Retell-dashboard edit of the filler / `speak_after_execution` does NOT stick.
  **Durable fix:** lengthen each GHL-hitting tool's copy in `BOOKING_TOOL_MESSAGES` to a multi-beat ~20-30 word
  line + set `speak_after_execution: true` on book/cancel/update (and wherever the default booking tools are
  first seeded), deploy retell-proxy (version bump + read-only Voice smoke), then run the bulk
  `refresh-booking-tool-messages`. Deeper backend latency trim (cache/pre-warm availability in
  `voice-booking-tools`, frozen) is a separate later item. Severity Low (UX polish, no correctness/data risk),
  effort S. **After this session** (Voice-gated CODE session). The persona-side talk-track *bridges* remain a
  normal prompt item on PROMPT_UPDATE_LIST PU-9.

- [ ] **GETCALL-1 (found 2026-07-07, incidental — during the Retell MCP endpoint audit) — `retell-proxy`'s
  `get-call` case hits a 404'd unversioned Retell endpoint, so the call-detail view is broken live.**
  `frontend/supabase/functions/retell-proxy/index.ts:1449` calls `retellFetch(apiKey, "GET",
  \`get-call/${params.callId}\`)` — no `v2/` prefix. **Live-tested 2026-07-07** with a real `call_id`:
  unversioned `GET /get-call/{id}` → **404**, `GET /v2/get-call/{id}` → **200**. Wired to the UI:
  `frontend/src/hooks/useRetellApi.ts:137` `getCall` → `frontend/src/components/retell/RetellCallLogsTab.tsx:54`
  calls it when a user opens an individual call's detail, so that action 404s today. **Fix:** one-line
  endpoint-prefix change (`get-call/${id}` → `v2/get-call/${id}`), same pattern as the 2026-06-05/06-09
  list-endpoint migrations (this repo's list-* calls are already on v2/v3; `get-call` was missed). Touches
  retell-proxy → needs a version bump + the standard read-only Voice smoke on deploy. Found incidentally while
  auditing the SEPARATE global `retell` MCP server (see memory `reference_retell_mcp_endpoint_audit_2026_07_07`)
  — this is this repo's own code, not that package. Severity Low (isolated read path, one UI action, no data
  risk), effort XS. **After this session** (CODE session, not the prompt/manual action-pack walkthrough).

## 🟡 Low — open (code, frozen baseline)

- [ ] **SLOT-MAP-1 (found 2026-07-07 via MAIN-OUTBOUND-SHARED-1) — slot 1 double-duties as both a setter slot
  and the inbound-agent resolver; the empty "Setter-1" voice tile is a live footgun.** In retell-proxy
  `SLOT_TO_AGENT_COLUMN`, slot 1 maps to `clients.retell_inbound_agent_id` (a legacy single-agent column; the
  real outbound slots 2/3 were retired in P3a 2026-06-17, so there is NO dedicated outbound slot). Because the
  voice grid always force-renders a `Voice-Setter-1` tile even when slot 1 is empty, **creating or saving a
  setter on that empty "Setter-1" tile re-reads `retell_inbound_agent_id` and stamps the inbound agent onto the
  new setter** — i.e. it re-creates exactly the MAIN-OUTBOUND-SHARED-1 collision. MAIN-OUTBOUND-SHARED-1 was
  worked around with data (Main Outbound moved off slot 1 to slot 10), but slot 1 itself remains poisoned.
  **Interim mitigation:** leave the empty "Setter-1" tile alone (documented in `TEST_LIST.md` + the fix handoff).
  **Proper fix (code, `retell-proxy` = frozen baseline, so gated):** give sync a real dedicated outbound slot,
  OR guard `dualWriteVoiceSetter` so it never writes when a non-inbound setter's resolved `agentColumn` is
  `retell_inbound_agent_id`, OR key the `voice_setters` row match on the setter UUID instead of `legacy_slot`.
  Severity Low (data workaround holds; only bites a setter placed on slot 1). Effort S-M. Full design context +
  the same three fix options: `Docs/DEFERRED.md` SLOT-MAP-1. Source:
  `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`.

## Status: MAIN-OUTBOUND-SHARED-1 fixed (data); 1 open item = SLOT-MAP-1 above (Low, code/frozen-baseline)

> **MAIN-OUTBOUND-SHARED-1 — ROOT-CAUSED + FIXED (data) 2026-07-07.** Restored "Main Outbound" to its own
> dedicated Retell agent. Root cause was a structural slot/column collision, not a code regression: "Main
> Outbound" sat on `voice_setters.legacy_slot = 1`, and in retell-proxy `SLOT_TO_AGENT_COLUMN` slot 1 maps to
> `clients.retell_inbound_agent_id` (a legacy single-agent column; the real outbound slots 2/3 were retired in
> P3a 2026-06-17). When the Inbound setter was made inbound (~2026-06-26) the toggle wrote its agent
> `agent_b2f6495…` into `retell_inbound_agent_id`; the 2026-07-01 batch Save & Push of Main Outbound (slot 1)
> re-read that column and `dualWriteVoiceSetter` stamped `b2f6495`+its LLM onto the Main Outbound row
> (forensic: outbound dials used `agent_f45f4dd…` through 2026-06-24, flipped to `b2f6495` from 2026-07-01
> 04:15, right after the row's `updated_at` 03:40:34; no code shipped 07-01). **Durable data fix (Option A,
> Brendan-approved, comprehensive):** a voice setter's identity spans two keying systems — the prompt/UI tile
> keyed by the `slot_id` string `"Voice-Setter-N"` across 6 tables (`prompts`, `agent_settings`,
> `prompt_configurations`, `prompt_docs`, `prompt_versions`, `setter_ai_reports`) AND the `voice_setters` row
> keyed by `legacy_slot`. So the fix migrated the WHOLE setter off the poisoned slot 1 to the free generic slot
> 10 in one transaction: 85 slot-keyed rows `Voice-Setter-1 → Voice-Setter-10`, `voice_setters.legacy_slot 1→10`
> + restored `retell_agent_id`/`retell_llm_id` to `agent_f45f4dd…`/`llm_a73df8…`, `clients.retell_agent_id_10 =
> agent_f45f4dd…` (durability: a future slot-10 Save & Push re-reads this, no re-clobber), and moved the
> `voice-10` display label. Pre-flight audit confirmed cadence dialing + node routing are by `voice_setter_id`
> UUID (transparent to the slot rename) and slot 10 was empty; `retell_inbound_agent_id` (b2f6495, inbound
> resolver) + the Inbound setter (slot 8) + the from-number binding were left untouched. No code, no prompt
> content, no Retell writes. _(A first-cut fix moved only the `voice_setters` row and decoupled the tile —
> caught by Brendan, fully reverted, redone comprehensively.)_ **Live answered-call verification is owed →
> `TEST_LIST.md`.** Full detail + emergency rollback SQL:
> `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`. Residual architectural follow-up (slot 1
> doubling as a setter slot + the inbound resolver; no dedicated outbound slot; the empty "Setter-1" tile is
> its visible face — do NOT create a setter on it) logged in `Docs/DEFERRED.md` SLOT-MAP-1 (retell-proxy code,
> frozen baseline).

Every CODE bug that had been logged is now either **shipped + live-verified** (→ `Docs/archive/COMPLETED_LOG.md`)
or **shipped + deployed, awaiting Brendan's live behavioral pass** (→ `Docs/TEST_LIST.md` — nothing left needing
a *code* fix). Session P1 (2026-07-07) audited every row against the live DB/edge-fn state, git log, and the
dated handoffs, and reconciled the backlog: several items that had passed their live test days earlier had never
been physically archived (BOOK-1, DEPLOY-1, F11, UI-1, three of the four F13 UI checks, the PROMPT-AUTH-1 X-Ray
check, and the B-2 GHL-outage check) — these are now in `COMPLETED_LOG.md` with their real pass dates. Several
others (HOURS-1, RESCHED-SMS-1, CHATS-DM-1, FOLLOWUP-DURING-CALL-1, CONTACTS-EDIT-DEAD-1, the 5-bug
onboarding-gate cluster, API-DEPR-1, G3-8) were fully code-complete + deployed but still had a stale `[x]` entry
sitting here; they now live solely as open rows in `TEST_LIST.md` (if a live check is still owed) or are fully
archived (if it already passed). See the dated handoff `Operations/handoffs/2026-07-07-p1-audit-reconciliation.md`
for the full per-item audit table.

The only remaining CODE-adjacent bug-history item still genuinely gated is **PROMPT-AUTH-1**: its core
booking-logic fix is deployed + live-regression-confirmed (→ `COMPLETED_LOG.md`), and the one thing left is a
content migration only Brendan can apply via the UI — tracked as its own row in `BRENDAN_TODO.md`
("Apply the Setter-1 prompt content migration").

Nothing is blocking the gated **First-Client Milestone** on the CODE side. See `Docs/SESSION_PLAN.md` for the
live session sequence.

---

## History (batches previously closed from this list)

> **Overnight bug-fix branch — MERGED to main + DEPLOYED LIVE 2026-07-04 (Session 9, supervised, Brendan GO).** `feature/overnight-bugfix` fast-forwarded onto `main` (`4a22b8b`), pushed origin+github. Deployed: **Trigger.dev 20260703.2** (SMS-MEM-1, FOLLOWUP-PROMPT-1), **retell-proxy v47→v48** (VM-1 + API-DEPR-1 list-agents), **verify-credentials v2→v3** (API-DEPR-1 probe), **save-external-prompt v14→v15** (shared `promptLint.ts`), and the **RLS-SHAPE-1 migration APPLIED** via Mgmt API (role gate confirmed live). Read-only Voice smoke on v48 PASSED. All items subsequently live-verified and closed — see `COMPLETED_LOG.md`.
>
> **Session 7.5 + F8 — MERGED to main + DEPLOYED LIVE 2026-07-01** (overnight; handoff `Operations/handoffs/2026-07-01-f8-plus-7.5-deploy.md`). SMS-OBS-1, BOOK-1 code, MODEL-1-HARDENING, F9-1, VM-1, PHONE-CLEAR-1, G3-8(a) all deployed this batch; all subsequently live-verified and closed — see `COMPLETED_LOG.md`.
>
> **2026-07-07 combined build (bugs + F15 + F16 + F17-p1)** — the last 5 open CODE bugs (HOURS-1 + folded FOLLOWUP-DURING-CALL-1, RESCHED-SMS-1, CHATS-DM-1, CONTACTS-EDIT-DEAD-1) shipped + deployed alongside F15/F16/F17-p1. Live behavioral verification of this batch is the current content of `TEST_LIST.md`'s "Combined build" section.
>
> Shipped in **Session 6 (2026-06-26, secret-read hardening)**: G3-6 (~20 surfaces across 3 tiers) — closed via `COMPLETED_LOG.md`.
>
> Shipped in **Session 5 (2026-06-26, by-phone pivot)**: B-2 deterministic GHL pick + resilient outage handling + CSV `normalized_phone` backfill — closed via `COMPLETED_LOG.md` (the GHL-outage leg live-confirmed 2026-07-05 RUN 6; three finer-grained B-2 checks remain open in `TEST_LIST.md`).
>
> Shipped in **Session 3.1 (2026-06-26, F2b inbound-toggle hotfix)**: B-6 split-brain list badges — closed via `COMPLETED_LOG.md`.
>
> Shipped in **Session 2 (2026-06-25, security/quality sweep)**: G3-1 (already fixed pre-session), G3-2/G3-3/G3-4/G3-5, types.ts drift — closed via `COMPLETED_LOG.md`.
>
> Shipped in **Session 1 (2026-06-25, voice reliability)**: B-1 rename cascade, B-3 outbound auto-follow, B-5 default-vars net — closed via `COMPLETED_LOG.md`.
>
> Closed in the 2026-06-25 reconciliation: inbound neutral greeting, Trigger latency, 6.8 `{{first_name}}`, F10 key rotation, 6.13 GHL secret-field check — see `Docs/archive/COMPLETED_LOG.md`. Prior shipped clusters (audit waves, billing B1/B2, session-1 hardening, S6, clients_public boundary) are in `Docs/ROADMAP.md` + the dated handoffs.
