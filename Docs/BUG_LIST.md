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

- [ ] **CLONE-COMPLIANCE-1 — the voice→text clone re-asserts *voice* compliance copy into a *text* prompt.**
  Found by the CLONE-2 operator read on the live `Setter-2` clone (19,449 chars, 2026-08-12 09:22).
  The conversion is otherwise excellent: all 20 sections, persona intact, **0** surviving `{{ }}` tokens,
  **0** tool-call specs. But the compliance block re-asserted verbatim at the top is voice copy:
  > "Quick bit of honesty before we dive in, I'm Brendan's AI assistant helping with **these calls**, and
  > **the call may be recorded** for quality. All good with you?" **[brief pause for acknowledgment or objection]**
  Over SMS there is no call and no recording, and a stage direction for a spoken pause is meaningless. It
  also directly contradicts the same prompt's line 142: *"Never mention speaking, calling, hearing, hold
  music, or waiting on the line. There is no audio channel here."*
  **This is the verify-and-repair layer working as built, and the design being wrong.** Last night's model
  output reworded the disclosures for the text channel, the byte-identical check failed, and the code put
  the *voice* originals back. The handoff recorded that as the guarantee firing correctly; it fired, but
  what it produced is not shippable in a text channel.
  **Fix (code, `clone-voice-to-text`):** the compliance re-assertion must be channel-aware — either accept a
  semantically-equivalent text rewrite (match on the *obligations* present: AI disclosure, recording/data
  disclosure, opt-out) rather than bytes, or carry a text-channel variant of each compliance line and
  re-assert that. **Gated behind the standing "no new product code until a pilot is paid" rule**, so this is
  filed, not built. The matching wording change is **PU-15** in `PROMPT_UPDATE_LIST.md`, a Brendan-applies item so
  the live `Setter-2` prompt can be corrected today without waiting for the code fix.

- [ ] **ORPHAN-PROJ-1 `[B]` — two retired Supabase projects are still alive and answering.** Verified 2026-08-12
  by unauthenticated probe: `https://qfbhcixkxzivpmxlciot.supabase.co/rest/v1/` and
  `https://awzlcmdomhtyqjabzvnn.supabase.co/rest/v1/` both return **HTTP 401**, i.e. the API is up and demanding
  auth. A dead project would fail DNS or connection. `qfbhcixkxzivpmxlciot` is the one memory already flags as
  "STILL ALIVE serving stale edge code", and it is the reason a 4xx can appear that never shows up in our logs:
  the request landed on a project nobody reads the logs of.
  **Why it stays open even though the code is clean.** The live risk is the surviving infrastructure, not the
  repo. Grep confirms **no live code path calls either host**: the only source references are two
  `localStorage.removeItem('sb-<ref>-auth-token')` cleanup calls (`AuthProvider.tsx:198-199`,
  `ClientLayout.tsx:947`) that exist precisely to purge stale tokens, plus explanatory comments in
  `ProcessDMs.tsx` and `integrations/supabase/functionsBase.ts`. `functionsBase.ts` is the durable fix: every
  literal function URL now derives from `VITE_SUPABASE_URL`, so a surface cannot silently re-point at a dead ref.
  **Fix (Brendan, provider console):** delete or pause both projects. `BRENDAN_TODO.md` already carries the
  `qfbhcixkxzivpmxlciot` deletion as optional; this bug upgrades it and adds the second ref, because "optional"
  undersells an internet-reachable project holding a copy of an old schema and old edge code.
  **Then (code, trivial):** once both are gone, drop the two `removeItem` lines and the stale-ref comments; they
  are dead-infrastructure trivia at that point. Do NOT drop them before deletion: any browser still holding one
  of those tokens relies on that cleanup at sign-out.
  **Do not confuse this with a leak.** No secret is exposed; 401 means unauthenticated reads are refused. The
  hazard is misrouting and log blindness, not disclosure.

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
