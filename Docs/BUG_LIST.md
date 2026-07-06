# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25 with Brendan; full re-audit 2026-07-07 (Session P1).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · prompt-content edits (Brendan via UI) → `PROMPT_UPDATE_LIST.md` · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`).
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## 🟠 Medium — new finding this session

- [ ] **MAIN-OUTBOUND-SHARED-1 (found 2026-07-07, Session P1) — "Main Outbound" appears to have silently lost
  its dedicated Retell agent; it now shares "Inbound BFD Agent"'s agent/prompt, likely an undetected
  regression, not a deliberate change.** Verified live 2026-07-07: the `voice_setters` row named "Main
  Outbound" (`id=b09624b5…`) has `retell_agent_id = agent_b2f6495f3e5c4160528f11b618` — the exact same Retell
  agent as the row named "Inbound BFD Agent". `make-retell-outbound-call` uses this column directly
  (`agentId = setter.retell_agent_id` → `override_agent_id`), so real outbound dials placed "as Main Outbound"
  are actually running Inbound's agent/prompt today. **This contradicts this project's own memory record**: on
  2026-06-24/25, inbound was deliberately split OUT into its own dedicated agent specifically so it wouldn't
  share config with outbound (see the now-corrected memory `project_inbound_outbound_share_agent_2026_06_24` —
  at that time Main Outbound = `agent_f45f4dd…`, a DIFFERENT agent, confirmed by 3 dated live-call citations in
  `COMPLETED_LOG.md` from 2026-06-28 through 2026-07-01). Multiple `COMPLETED_LOG.md` entries from 2026-07-03
  onward already show Main Outbound = `agent_b2f6495…`, so whatever caused the repoint happened sometime
  between 2026-06-25 and 2026-07-03 — no session in that window reports intentionally doing this. **User-facing
  effect (confirmed live 2026-07-07):** the shared agent's opener has no `{{first_name}}` (so outbound calls to
  known leads aren't personalized — PU-3 in `PROMPT_UPDATE_LIST.md`) and closes with an inbound-style question
  ("What can I help you with?") rather than stating the call's purpose (a Telemarketing Standard compliance
  question — PU-7). The separate agent `Voice-Setter-Test` (`agent_f45f4dd…`) that WAS the old Main Outbound
  still exists, unused, and is what the phone number's static (and irrelevant) `outbound_agents` binding
  points to — checking that field instead of the platform DB or the actual calling code is what caused the
  misidentification during this session's own live-verification pass (see the P1 handoff for the full
  self-correction). **Needs investigation, not yet root-caused:** find what changed `voice_setters."Main
  Outbound".retell_agent_id` between 2026-06-25 and 2026-07-03 (check the F9 lock/pull machinery, the
  duplicate-setter-config path, and any admin/manual repoint) and confirm whether Brendan wants Main Outbound
  restored to its own dedicated agent (recommended, matches the original 2026-06-24/25 design intent) or
  whether sharing with Inbound is now intentional. Severity Medium (real live behavior gap; not
  data-destroying). Effort S-M investigation, TBD fix.

## Status: 0 open bugs otherwise (2026-07-07)

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
