# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25; full re-audit 2026-07-07 (Session P1); archive sweeps
2026-07-11 and 2026-07-22 (this file holds genuinely-open items only).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · prompt-content edits (Brendan via UI) → `PROMPT_UPDATE_LIST.md` · **first-client-gated → `Docs/FIRST_CLIENT_TASKS.md`** · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`). First-client-gated security items live in `FIRST_CLIENT_TASKS.md`, not here.
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## Open code items

**NONE — 0 open.** (Since the 2026-07-12 autonomous build; re-confirmed at the 2026-07-21 live TEST pass and the
2026-07-22 sweep.)

The one pre-existing defect — the `lead_notes` console 400 — was **resolved 2026-07-22** by removing the unused
notes panel (`8851f79`; Brendan confirmed the feature wasn't needed). → `Docs/archive/COMPLETED_LOG.md`.

## History (context, not active work)

All prior batches (the GATE A/B clusters, the 2026-07-12 autonomous build, the 2026-07-13 frozen
voice-bundle deploy — retell-proxy v53 / voice-booking-tools v25 / retell-call-analysis-webhook v28, all its owed
legs since PASSED — MAIN-OUTBOUND-SHARED-1, REACT-NORMPHONE-1, SEC-PII-LOGS-1, and everything earlier) are closed
and live in `Docs/archive/COMPLETED_LOG.md` + the dated handoffs. The SLOT-MAP-1 *architectural* cleanup (dedicated
outbound slot / stop keying on `legacy_slot`) is deferred design work, not an open bug → `DEFERRED.md` (the deployed
v53 guard closed the exploitable half). First-client-gated security items → `Docs/FIRST_CLIENT_TASKS.md`.
Nothing blocks the First-Client Milestone on the CODE side.
