# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25 with Brendan; full re-audit 2026-07-07 (Session P1).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · prompt-content edits (Brendan via UI) → `PROMPT_UPDATE_LIST.md` · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`).
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## Status: 0 open bugs (2026-07-07)

> **MAIN-OUTBOUND-SHARED-1 — ROOT-CAUSED + FIXED (data) 2026-07-07.** Restored "Main Outbound" to its own
> dedicated Retell agent. Root cause was a structural slot/column collision, not a code regression: "Main
> Outbound" sat on `voice_setters.legacy_slot = 1`, and in retell-proxy `SLOT_TO_AGENT_COLUMN` slot 1 maps to
> `clients.retell_inbound_agent_id` (a legacy single-agent column; the real outbound slots 2/3 were retired in
> P3a 2026-06-17). When the Inbound setter was made inbound (~2026-06-26) the toggle wrote its agent
> `agent_b2f6495…` into `retell_inbound_agent_id`; the 2026-07-01 batch Save & Push of Main Outbound (slot 1)
> re-read that column and `dualWriteVoiceSetter` stamped `b2f6495`+its LLM onto the Main Outbound row
> (forensic: outbound dials used `agent_f45f4dd…` through 2026-06-24, flipped to `b2f6495` from 2026-07-01
> 04:15, right after the row's `updated_at` 03:40:34; no code shipped 07-01). **Durable data fix (Option A,
> Brendan-approved):** moved "Main Outbound" to `legacy_slot = 10` (→ `clients.retell_agent_id_10`, the only
> free mapped slot), set `retell_agent_id_10 = agent_f45f4dd87a4072424f3c84b74c`, restored the row's
> `retell_agent_id`/`retell_llm_id` to `agent_f45f4dd…`/`llm_a73df8…`, moved the `voice-10` display label. A
> future Save & Push of Main Outbound now re-reads `retell_agent_id_10` (= f45f4dd), so it will not re-clobber.
> The phone's static `outbound_agents` was already `f45f4dd` (now consistent). No code, no prompt content, no
> Retell writes. **Live answered-call verification is owed → `TEST_LIST.md`.** Full detail + rollback SQL:
> `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`. A residual architectural follow-up (slot 1
> doubling as a setter slot + the inbound resolver; no dedicated outbound slot in the map) is logged in
> `Docs/DEFERRED.md` (retell-proxy code, frozen baseline).

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
