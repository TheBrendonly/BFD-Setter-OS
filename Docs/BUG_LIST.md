# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25; full re-audit 2026-07-07 (Session P1); archive sweeps
2026-07-11 and 2026-07-22 (this file holds genuinely-open items only).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · prompt-content edits (Brendan via UI) → `PROMPT_UPDATE_LIST.md` · **first-client-gated → `Docs/FIRST_CLIENT_TASKS.md`** · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`). First-client-gated security items live in `FIRST_CLIENT_TASKS.md`, not here.
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## Open code items

- [x] **MFA-LOGIN-1: RESOLVED 2026-08-13 (evening)** -> `Docs/archive/COMPLETED_LOG.md`. The headless login
  passed on the **first fresh code** once `playwright-core` was installed (it was missing) and the committed
  `scripts/test-harness/auth.mjs` fix ran (field id `#mfa_login_code` plus reload-before-type): aal2 confirmed,
  agency route held, `storageState.json` saved. The earlier 11 `mfa_verification_failed` were the
  stale-field-locator and stale-challenge harness bugs, not a desynced factor; the account was always fine.
  Do not rebuild `auth.mjs`. This unblocked RENDER-1, the release push, SNAP-1/2/3 and CLONE-1 (all passed).

- [x] **CLONE-COMPLIANCE-1 — FIXED 2026-08-16 (see COMPLETED_LOG).** The voice→text clone was re-asserting
  *voice* compliance copy (recording disclosure + spoken-pause direction) into *text* prompts. Fix: a new
  channel sanitizer `sanitizeComplianceLineForText` in `clone-voice-to-text/transform.ts` strips the recording
  clause + spoken-pause direction (keeping AI disclosure + NCCP), applied both to the reasserted block and to
  any voice line the model preserved verbatim. Decision (Brendan 2026-08-16): drop the recording obligation for
  SMS (no call, no recording). Deployed v5, +6 tests. **PU-15** in `PROMPT_UPDATE_LIST.md` (the live `Setter-2`
  prompt wording) remains a Brendan-applies item.

- [x] **ORPHAN-PROJ-1 `[B]` — RESOLVED 2026-08-17 (see COMPLETED_LOG).** The two still-live Supabase projects
  (`qfbhcixkxzivpmxlciot`, `awzlcmdomhtyqjabzvnn`) turned out to belong to **another person** (Brendan cannot
  access them, so BFD cannot delete them). BFD-side action taken instead: removed EVERY code reference so nothing
  in the repo points at them: the `removeItem` token-cleanup calls (`AuthProvider`, `ClientLayout`), the stale-ref
  comments (`ProcessDMs`, `functionsBase`), and the dead `20260314095132` pg_cron migration (neutralised to a
  no-op, which also dropped that project's stale anon key from the repo). Verified **no BFD live connection**:
  pg_cron/pg_net are not installed on the platform db and no DB object references either ref. The projects are a
  third party's to manage; nothing of ours routes to them, so the misrouting/log-blindness hazard is closed.

Everything else: **0 open.** (Since the 2026-07-12 autonomous build; re-confirmed at the 2026-07-21 live TEST
pass and the 2026-07-22 sweep.)

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
