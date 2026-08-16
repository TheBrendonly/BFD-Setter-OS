# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`.
When it fails, open a bug in `BUG_LIST.md`.

> **Full archive sweep 2026-07-22.** Every previously-listed row that had already passed (the 2026-07-05/06/07,
> 2026-07-11, 2026-07-12, 2026-07-13, and 2026-07-21 sessions) was physically REMOVED from this file — their
> passes, dates, and evidence live in `Docs/archive/COMPLETED_LOG.md` and the dated handoffs. What remains below
> is genuinely still owed, grouped by what unblocks it. The consolidated live TEST pass itself is COMPLETE
> (2026-07-21 evening, `Operations/handoffs/2026-07-21-live-test-pass.md`); nothing below blocks the
> First-Client Milestone.

## Cost Ledger LLM-actual (2026-08-16 build): one live row owed

> Shipped + deployed 2026-08-16 (`5f1e12d`; trigger `20260816.1`, edge `get-cost-ledger` v2). Unit-verified
> (660 tests) and the OpenRouter `usage.cost` mechanism was live-probed on the real client account (response
> carried `usage.cost`). What remains is one real-traffic confirmation, since every LLM billing path also
> sends a real SMS (so there is no side-effect-free way to force a row).

- [ ] **LLM-COST-1: a real setter reply lands a live `execution_cost_events` llm row.** Drive one real
  (non-simulation) inbound SMS to Gary (harness `sms_inbound.mjs` to TEST_PHONE_A, or a real reply), then
  confirm a NEW row: `cost_kind='llm'`, `is_estimated=false`, `cost_usd>0`, `provider_ref` like
  `setter-reply:...`. Re-open the agency Cost Ledger card and confirm the LLM line is non-zero and the
  actual-vs-estimated split reflects it. Naturally covered by the next TEST SESSION's live-SMS pass; also
  fires on any real nudge (`tj.sid`), followup (`timer_id`), or cadence AI-copy (`execution_id`) send.

## Demo-callback funnel dry run (2026-08-11 build): now LIVE in prod, real-call legs owed

> Built plus review-hardened 2026-08-11 (`9fc1dd1`..`87b522e`): public `/g/:slug` callback landing page plus
> `demo-callback` edge fn. Blockers cleared 2026-08-12 (PAT valid, Stapleton setter on slot 9), and the
> **frontend was RELEASED 2026-08-13 evening** (`git push github main`, Railway redeploy), so the funnel is
> now live. **2026-08-13 verified autonomously:** the live app renders `/g/stapleton-finance-b7q4` as the
> Stapleton page ("A LIVE DEMO, BUILT FOR STAPLETON FINANCE", 0 page errors), and an unknown slug returns 404
> both server-side (`{"error":"Unknown demo page."}`) and client-side ("DEMO NOT FOUND"). The remaining legs
> need a real answered call. A Claude-assisted runbook to drive them lives in the TickTick task
> "RUN: DEMO-CB-1 demo-callback dry run (bfd-setter, Claude-assisted)".

- [ ] **DEMO-CB-1: end-to-end dry run. DEFERRED by Brendan 2026-08-13** (fires a real call plus a real
  booking, so it needs him at the phone). Submit `/g/stapleton-finance-b7q4` with name+email+mobile, then
  the `leads` row on the BFD client carries the email (real GHL contact id, not `bfd-<phone>`; `form_source
  bfd-demo:stapleton-finance-b7q4`; GHL contact tagged `bfd-demo-callback`); a real outbound call fires from
  +61481614530; the agent sounds Stapleton-specific (qualification trio plus NCCP guardrail hold); a booking
  lands on BFD's GHL calendar; a confirmation email arrives at the SUBMITTED address. Run via the TickTick
  runbook above.
- [ ] **DEMO-CB-2: guard checks.** **Unknown slug -> 404 "Unknown demo page." PASSED 2026-08-13** (server plus
  client). Still owed: second submit within the hour -> per-phone 429 copy (needs a prior real submit, which
  dials); submit after 8pm AEST -> honest calling-hours decline (needs off-hours); opted-out number ->
  indistinguishable from call-failure copy (needs an opted-out number).
- [x] **DEMO-CB-3 — `on_lead_change` residual check. PASSED 2026-08-12** (read-only, run autonomously). Asked for
  any `workflows` row on the BFD client that is `is_active` with `contact_created` in nodes, so the leads upsert
  could fire the legacy workflow-execute trigger. Result: the BFD client has **zero `workflows` rows at all**
  (total 0, active 0), so the trigger cannot fire. Nothing to clean up; no need to re-confirm at dry-run time.

> **UNBLOCKED 2026-08-13 (evening).** The headless agency login now PASSES: `auth.mjs` cleared TOTP on the
> first fresh code (attempt 1, aal2 confirmed, agency route held). **MFA-LOGIN-1 is closed.** RENDER-1 passed
> and the held `git push github main` was released (26 commits, `033c8c1..e9acb17`); the frontend is live on
> the new bundle, so `/g/stapleton-finance-b7q4` now renders the demo page (no longer the generic 404).
> **SNAP-1, SNAP-2, SNAP-3 and CLONE-1 all PASSED** and moved to `Docs/archive/COMPLETED_LOG.md`. Only
> SMS-GHL-1 (below) and the DEMO-CB real-call legs (above) remain.

## Retell pivot overnight build (2026-08-12): ALL live legs DONE

> Built plus deployed 2026-08-12 (`668eec7`..`8ab5e27`). SNAP-1/2/3, CLONE-1, CLONE-2, RENDER-1 and
> SMS-GHL-1 all PASSED (see COMPLETED_LOG, 2026-08-13 entries). Handoffs:
> `Operations/handoffs/2026-08-12-overnight-run.md` and
> `Operations/handoffs/2026-08-13-mfa-unblocked-owed-legs.md`. Nothing owed in this section.

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
