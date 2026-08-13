# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25; full re-audit 2026-07-07 (Session P1); archive sweeps
2026-07-11 and 2026-07-22 (this file holds genuinely-open items only).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · prompt-content edits (Brendan via UI) → `PROMPT_UPDATE_LIST.md` · **first-client-gated → `Docs/FIRST_CLIENT_TASKS.md`** · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`). First-client-gated security items live in `FIRST_CLIENT_TASKS.md`, not here.
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

---

## Open code items

- [~] **MFA-LOGIN-1 `[B]` — the headless agency login cannot pass TOTP, and it now blocks the release.**
  11 consecutive `mfa_verification_failed` rejections: 6 on 2026-08-12/13, 5 more on 2026-08-13.
  **Timing is ruled out, definitively.** The final attempt had a **challenge 0.6s old** and the code
  submitted **1.9s** after Brendan wrote it into the file by hand from a terminal (no chat latency at all),
  and Supabase still rejected it. The previously-recorded root cause ("the challenge has a shorter,
  separate expiry, never pre-navigate") was **wrong and is now corrected** in
  `scripts/test-harness/README.md`: the challenge TTL is a measured **300s**, a reload mints a fresh one,
  and a dead challenge reports `mfa_challenge_expired`, which is a *different* error we have not seen once
  on 2026-08-13.
  **Two real harness bugs were found and fixed on the way** (both in the now-committed
  `scripts/test-harness/auth.mjs`): the field locator `getByRole('textbox').first()` was grabbing the EMAIL
  input on the login form that renders before the MFA form swaps in, so the code went into the wrong box
  and the submit button never enabled; and the whole flow now reloads immediately before typing so the
  challenge is ~1s old. Neither fixed the rejection, which is what makes the remaining cause external.
  **Remaining candidates, in order:** authenticator clock drift; Brendan reading a different entry in his
  authenticator (two retired Supabase projects are still alive per ORPHAN-PROJ-1, so near-identical entries
  are plausible); or a stored secret that no longer matches the device.
  **Next step is one 30-second test by Brendan:** log into `app.buildingflowdigital.com` manually in his own
  browser with a code. If that fails too, the factor is desynced and the repair is to delete the factor,
  log in with magiclink alone (which works, because with no verified factor the client-side gate stops
  firing) and **re-enrol TOTP fresh** — that ends with working 2FA rather than 2FA switched off. If it
  succeeds, the fault is in the automation and we have a much smaller search space.
  **Do not work around it by reading `auth.mfa_factors.secret`** to generate codes locally; the permission
  classifier blocks that, correctly.
  **Blast radius:** this is the only thing standing between the 2026-08-12 build and release. RENDER-1
  needs an authenticated browser, the held `git push github main` is gated on RENDER-1, and DEMO-CB-1/2 is
  gated on that push (the `/g/` route is **not live** — see DEMO-CB note in `TEST_LIST.md`).
  **Standing workaround that does not need any of this:** Brendan can click SNAP-1, CLONE-1 and the
  RENDER-1 surfaces himself in the UI in about 10 minutes.

  **UPDATE 2026-08-13 12:53 AEST (relayed via Cowork from Brendan):** Brendan confirmed he CAN log into `app.buildingflowdigital.com` manually in his own browser with a code from his authenticator — it worked, first try. That is the decisive test from above, and it lands on the "succeeds" branch: the account and TOTP factor are fine, nothing is desynced, do NOT delete or re-enrol it. The fault is isolated to the automation harness or its environment (headless browser vs. Brendan's normal browser — different session/cookie state, network path, and browser fingerprint are all still on the table and worth checking if the next run still fails).
  **Next step, unchanged from the plan above:** run `node scripts/test-harness/auth.mjs <scratchdir>` and have Brendan fire ONE fresh code via `echo 123456 > <scratchdir>/totp.txt` (it retries forever, so a rejected code costs nothing but the code). Pass -> close this out to `COMPLETED_LOG.md`. Still `mfa_verification_failed` on a code just proven to work manually -> that is a real, narrower finding (harness/environment divergence, not the account) — capture exactly what differs before trying anything else.

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
