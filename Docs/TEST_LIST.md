# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`.
When it fails, open a bug in `BUG_LIST.md`.

> **Full archive sweep 2026-07-22.** Every previously-listed row that had already passed (the 2026-07-05/06/07,
> 2026-07-11, 2026-07-12, 2026-07-13, and 2026-07-21 sessions) was physically REMOVED from this file — their
> passes, dates, and evidence live in `Docs/archive/COMPLETED_LOG.md` and the dated handoffs. What remains below
> is genuinely still owed, grouped by what unblocks it. The consolidated live TEST pass itself is COMPLETE
> (2026-07-21 evening, `Operations/handoffs/2026-07-21-live-test-pass.md`); nothing below blocks the
> First-Client Milestone.

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
