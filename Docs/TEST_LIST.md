# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`.
When it fails, open a bug in `BUG_LIST.md`.

> **Full archive sweep 2026-07-22.** Every previously-listed row that had already passed (the 2026-07-05/06/07,
> 2026-07-11, 2026-07-12, 2026-07-13, and 2026-07-21 sessions) was physically REMOVED from this file — their
> passes, dates, and evidence live in `Docs/archive/COMPLETED_LOG.md` and the dated handoffs. What remains below
> is genuinely still owed, grouped by what unblocks it. The consolidated live TEST pass itself is COMPLETE
> (2026-07-21 evening, `Operations/handoffs/2026-07-21-live-test-pass.md`); nothing below blocks the
> First-Client Milestone.

## Demo-callback funnel dry run (2026-08-11 build — blocked on PAT rotation + setter creation)

> Built + review-hardened 2026-08-11 (`9fc1dd1`..`87b522e`): public `/g/:slug` callback landing page +
> `demo-callback` edge fn. **Both original blockers cleared 2026-08-12:** the SUPABASE_PAT is valid (Management
> API 200) and the "Stapleton Finance Demo" setter exists on slot 9 (active, Retell agent, 7,157-char prompt doc,
> and correctly no phone binding per SOP step 4). `demo-callback` is deployed (v3). The landing page renders:
> Playwright against the built bundle loads `/g/stapleton-finance-b7q4` showing "A LIVE DEMO, BUILT FOR
> STAPLETON FINANCE" with zero page errors. Only the live legs below remain.

- [ ] **DEMO-CB-1 — end-to-end dry run.** Submit `/g/stapleton-finance-b7q4` with Brendan's name+email+mobile →
  `leads` row on BFD client carries the email (real GHL contact id, `form_source bfd-demo:stapleton-finance-b7q4`,
  GHL contact tagged `bfd-demo-callback`) → real outbound call fires from +61481614530 → agent sounds
  Stapleton-specific (qualification trio + NCCP guardrail hold) → booking lands on BFD's GHL calendar → confirmation
  email arrives at the SUBMITTED address.
- [ ] **DEMO-CB-2 — guard checks.** Second submit within the hour → per-phone 429 copy. Submit after 8pm AEST →
  honest calling-hours decline. Unknown slug → 404 "Unknown demo page.". Opted-out number (if one exists) →
  indistinguishable from call-failure copy.
- [x] **DEMO-CB-3 — `on_lead_change` residual check. PASSED 2026-08-12** (read-only, run autonomously). Asked for
  any `workflows` row on the BFD client that is `is_active` with `contact_created` in nodes, so the leads upsert
  could fire the legacy workflow-execute trigger. Result: the BFD client has **zero `workflows` rows at all**
  (total 0, active 0), so the trigger cannot fire. Nothing to clean up; no need to re-confirm at dry-run time.

## Retell pivot overnight build (2026-08-12) — Brendan live-verify

> Built + deployed 2026-08-12 (`668eec7`..`8ab5e27`). Everything below was verified as far as it can
> be without a browser session or a real inbound SMS; these are the legs that need Brendan.
> Handoff: `Operations/handoffs/2026-08-12-overnight-run.md`.

- [ ] **SNAP-1 — one real Pull from the UI.** Prompt Management → a BFD voice setter tile → Pull from
  Retell. The toast must now read "Full snapshot saved (vN) · N,NNN char prompt · N tools", not the
  old "Mirror updated". (Server-side equivalent already passed: retell-proxy v54, live pull against
  Main Outbound stored a 34KB snapshot with the 21,675-char prompt and all 8 tool definitions
  verbatim.)
- [ ] **SNAP-2 — one restore on a throwaway slot.** Pick a spare BFD voice slot, Pull it first (a
  pre-2026-08-12 snapshot is refused by design with `snapshot_not_restorable`), then call
  `restore-retell-config` with `dryRun: true`, confirm the planned payload, then run it for real and
  confirm the agent still answers and still has its 5 booking tools. **Never on slot 1, never on
  slot 9 (Stapleton), never on a live client.** API-only tonight: there is deliberately no Restore
  button yet.
- [ ] **SNAP-3 — no false drift alert after a restore.** After SNAP-2, wait for the next hourly
  `pollRetellDrift` run and confirm it does NOT flag `versionDrifted` on the restored slot. The
  re-baseline is meant to prevent exactly this; it is untested against the live poll.
- [ ] **CLONE-1 — one voice→text clone from the UI.** Open text setter **Setter-2** on the BFD tenant
  (seeded 2026-08-12 specifically so this test never touches the live Setter-1) → COPY OTHER SETTER →
  pick a voice setter. Confirm: the confirm-step copy describes a prompt-document conversion, the job
  runs, the result saves, and the toast warns that the section editor below is stale. (Server-side
  equivalent already passed: Voice-Setter-10 → Setter-2, 20,082 chars in, 19,448 out, lint clean,
  zero surviving tokens, both disclosures verbatim.)
- [ ] **CLONE-2 — read the cloned prompt.** Setter-2's prompt is a real conversion of Main Outbound.
  Read it as the operator who would ship it: compliance lines intact, no voice leakage ("caller",
  "on the phone"), persona still recognisable. This is a judgement check, not a pass/fail assertion.
- [ ] **SMS-GHL-1 — one real inbound SMS.** `receive-twilio-sms` was redeployed (v32) with its
  `findOrCreateGhlContact` repointed at the new shared module. The boot probe passes and the adapter
  preserves the old contract exactly, but the GHL contact leg cannot be exercised without a real
  inbound text. Send one from a number that is NOT already a CRM lead and confirm the lead resolves
  to a real GHL contact id and the reply goes out.
- [ ] **RENDER-1 — render smoke visual pass.** Prompt Management, Settings, Dashboard, Account
  Settings, Clients. Frontend changes this run: the Pull toast, the CopySetterDialog voice→text
  branch, and the deletion of the dead PersonalityConstructor.tsx.

## Claude-drivable (autonomous, next cleanup session)

> **2026-07-23 cleanup-tail pass:** PURGE-SIM-1, PURGE-TAG-1, F15 funnel, F15 report, and F9V2-1/2 all PASSED
> autonomously and moved to `Docs/archive/COMPLETED_LOG.md` (2026-07-23 entry). The two below remain OPEN — both
> were blocked from clean unsupervised execution (see notes); their underlying mechanisms are already evidenced live.

- [ ] **BOOK-CONFIRM-HONESTY-1 — dedicated forced-failure.** Force a `book-appointments` failure over SMS (throwaway
  client) → the reply is the honest holding message, NOT a false "you're booked". (Mechanism already evidenced live:
  RESCHED-SMS-1 passed 2026-07-21 with the honest "wasn't able to make that change" reply; this is belt-and-braces
  on the booking-specific path.) **NOT run 2026-07-23:** a clean forced failure needs a throwaway SMS-wired client
  (heavy) or breaking BFD's live booking (pollution/risk) — deferred to a supervised run.
- [ ] **B2-REPOINT-1 — outage convergence.** Stage a lingering `bfd-<phone>` lead (GHL-outage sim: break/restore
  `ghl_api_key`, pre-authorized in the TEST_SESSION rules), then send a normal inbound after GHL recovers → the lead
  converges to its real GHL contact id (rows repointed), reply not dropped. **NOT run 2026-07-23:** the inbound leg
  needs a number NOT in the CRM (the engine sends a real Twilio reply to it); TEST_PHONE_A is a known CRM lead and
  freeing it is Brendan-gated, TEST_PHONE_B is ask-first — no safe non-CRM number available unsupervised. By-phone
  convergence was verified in prior sessions; run this with Brendan present + a safe test number.

## Needs a browser session (2FA code from Brendan at the start)

> **2026-07-23 cleanup-tail pass (agency browser session):** all four pages render CLEAN on the live vite bundle
> (authed, 0 console errors, 0 ≥400 responses). **G3-6 residual + G3-8(a) PASSED** (→ COMPLETED_LOG). F8/F13 render
> verified; only their edit/persist + client-role-visibility behavioral legs remain (need form interaction / a
> second-role login — best as a short live glance).

- [ ] **F8 — edit-persist + client rate card (behavioral leg only).** Render + server-side trap already proven; the
  panel renders clean (2026-07-23). Remaining: Sub-Account Config → Cost-to-Price Calculator — edit rates/FX/markup,
  Save, reload → persists + blended $/min hand-check; flip **show-rate-to-client** ON → a client-role login sees the
  read-only rate card (no breakdown), OFF → gone. (Short live UI pass.)
- [ ] **F13 — dashboard summary card, both roles (content leg only).** Dashboard renders clean (2026-07-23).
  Remaining: confirm the agency margin one-liner text on the ChatAnalytics dashboard (text + voice tabs) and that a
  client login sees only toggled parts. (Short live UI pass / second-role login.)

## Needs Brendan live (phone / UI / a second phone)

- [ ] **F16(b) — speed-to-lead inside-hours 60s call.** Flag is ON for BFD; needs a fresh GHL lead created inside
  the legal window → an AI call within ~60s. (The outside-hours defer half passed 2026-07-12.)
- [ ] **F16(c) — missed-call text-back.** Enable `missed_call_textback_enabled` on the dogfood client
  (`BRENDAN_TODO.md`), hang up quickly on an inbound call → SMS-back within ~60s enters the SMS booking flow; a
  second quick call within 15 min does NOT double-text.
- [ ] **F16(d) — live-transfer.** Gated on Brendan setting a transfer number + the PU-11 prompt line (deferred by
  Brendan until he's fielding transfers). Then: a lead asking for a human is transferred.
- [ ] **B-5 — inbound from a genuinely UNKNOWN number** (voice): the agent omits the name and never says the
  literal `{{first_name}}`. TEST_PHONE_A is a known CRM lead, so this needs a number not in the CRM (the
  2026-07-12 pass used a sim; a real unknown-caller leg is belt-and-braces).
- [ ] **B-2 — deterministic GHL pick** (only if a >1-GHL-contact phone can be staged): repeated inbound sends
  resolve to the SAME (most-recently-updated) contact every time. GHL allow-duplicates is OFF, so staging this is
  awkward; skip unless it occurs naturally.
- [ ] **SLOT-MAP-1 — live UI refuse (optional belt-and-braces).** The guard is deployed + unit-tested
  (retell-proxy v53); a live "Save & Push on the empty Setter-1 tile → refused" confirm is a 30-second UI glance.
- [ ] **F17 — recording-disclosure negative leg (optional).** Toggle OFF → a call opens WITHOUT the disclosure
  (the ON leg verified 2026-07-13). Fold into any future dogfood call.
- [ ] **API-DEPR — Retell dashboard notices stopped (glance).** Confirm the legacy-list + analysis-prompt
  deprecation notices no longer fire on the Retell dashboard sweep (code migrated 2026-07-04; just an eyeball).

## Standing rule

- After **any** BUG or FEATURE ships, smoke the touched area before marking it done here.
