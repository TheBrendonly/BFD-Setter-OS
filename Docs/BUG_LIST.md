# BFD-Setter — Bug / Issue List (canonical, OPEN only)

Open bugs and behavior fixes. Reconciled 2026-06-25; full re-audit 2026-07-07 (Session P1); full
reconciliation + archive sweep 2026-07-11 (this file trimmed to genuinely-open items only).

- **Status:** `[ ]` open · `[~]` partially done · `[B]` needs a Brendan input · `[x]` done (moved to archive)
- **Companion lists:** features → `FEATURE_ROADMAP.md` · your manual actions → `BRENDAN_TODO.md` · things to verify → `TEST_LIST.md` · someday/gated → `DEFERRED.md` · prompt-content edits (Brendan via UI) → `PROMPT_UPDATE_LIST.md` · **first-client-gated → `Docs/FIRST_CLIENT_TASKS.md`** · closed items → `Docs/archive/COMPLETED_LOG.md`
- **Rule:** when a bug is fixed + verified, move it out of here (to `TEST_LIST.md` if it needs live verification, else to `COMPLETED_LOG.md`). First-client-gated security items live in `FIRST_CLIENT_TASKS.md`, not here.
- All items below are **CODE** (Claude builds) unless tagged `[B]`.

> **2026-07-11 reconciliation:** the P3 security cluster (F16C-SMS-1, QH-TZ-1, RLS-UISTATE-1, FUNNEL-SCAN-1,
> ROLE-RESOLVE-1), OPTOUT-FAILOPEN-1, TRYGARY-DIAL-1, GETCALL-1, and PU-9-CODE are all **fixed + deployed +
> live-verified** → `Docs/archive/COMPLETED_LOG.md` (2026-07-11 entry). The whole **GATE A (RLS role-gate) + GATE B
> (Retell-webhook forgery) cluster** — RLS-CLIENTS-1, RLS-CREDENTIALS-1, RLS-TENANT-DISJUNCTION-1, RLS-GATE-SIBLING-1,
> RLS-ORUSAGE-1, RLS-UNIPILE-1/AGENCIES-1, RETELL-BOOKING-SMS-1, RETELL-CALLHIST-POISON-1, RETELL-CALLBACK-DIAL-1,
> RETELL-INBOUND-PII-1 — is **latent until the first client-role user / until `retell_webhook_secret` is armed**, so
> it moved to `Docs/FIRST_CLIENT_TASKS.md`. Full detail: `Docs/SECURITY_REVIEW_2026-07-08.md`.

---

## Open code items (not first-client-gated)

- [ ] 🟠 **SCHED-1 (Medium, infra) — the two hourly Trigger.dev cron schedules were never registered in prod.**
  `synthetic-probe` + `poll-retell-drift` declare `schedules.task({cron:"0 * * * *"})` in code, but the prod
  schedules list was EMPTY (even after a fresh deploy): `poll-retell-drift` had zero runs ever and `probe_results`
  held 2 rows total since inception — the synthetic uptime probe AND the F9 drift poll had been silent the whole
  time. **Mitigated 2026-07-11:** registered both imperatively via the Trigger API (dedup keys
  `synthetic-probe-hourly-prod` / `poll-retell-drift-hourly-prod`); the 05:00 probe fired + passed. **Still open:**
  root-cause why the DECLARATIVE `schedules.task` cron didn't auto-register on deploy so a future re-deploy /
  schedule delete doesn't silently drop them again. Low urgency (imperative schedules run regardless). Verify they
  still fire next session. Found 2026-07-11.

- [ ] 🟢 **B2-REPOINT-1 (Low) — GHL-outage synthetic-lead reconcile only repoints within the minting request.**
  `receive-twilio-sms` mints `bfd-<phone>` on a GHL outage and schedules a `waitUntil` reconcile — but ONLY in the
  request that minted it (gated on `syntheticMinted`). If GHL is still down at mint time and recovers later, a
  subsequent inbound just re-resolves internal-first by phone and never re-attempts the GHL repoint, so the synthetic
  `bfd-` id is sticky. Not a drop (reply flows Twilio-direct) and no dup rows; purely that the lead never converges to
  its real GHL contact id if GHL didn't recover during the original request. Fix: a background sweep (or a repoint
  attempt on later inbounds) for lingering `bfd-%` leads. Found 2026-07-11 B-2 outage probe.

- [ ] 🟡 **INTAKE-RL-1 (Medium, design) — `intake-lead` has no `bump_rate_limit`.** Its secret is designed to be
  embedded in public client HTML; if published, an attacker reading the secret gets unbounded immediate SMS to
  attacker-chosen numbers (the default first cadence node is SMS `delay_seconds:0`). `intake-lead` constant-time-compares
  its secret (correct) but has no rate limit. Fix: add `bump_rate_limit` before `enrollLeadInEngagement` (the
  `campaign-enroll-webhook` pattern). Safe + surgical; report-first (precondition = a client publishes the snippet).
  Full detail: `Docs/SECURITY_REVIEW_2026-07-08.md`.

- [ ] 🟡 **BOOK-TZ-DISPLAY-1 (Medium) — the SMS setter tells the lead their local time via weak-model mental
  arithmetic → wrong.** `trigger/processSetterReply.ts:213-222` instructs `gpt-4.1-nano` (temp 0) to compute the
  lead-local time; the deterministic `formatSlotInZone` (`leadTimezone.ts:58`) exists but is dead code. Misleading
  confirmation in the exact cross-tz case BOOK-TZ-1 exists for (e.g. "12pm your time" when Perth-local is 11am).
  Non-frozen. Fix: pre-render each offered slot's lead-zone label with `formatSlotInZone`, drop the arithmetic
  instruction. Wants a live cross-tz SMS test. Relates to BOOK-TZ-1 (built, display-only) + the voice-side PU-13.

- [ ] 🟡 **BOOK-CONFIRM-HONESTY-1 (Medium) — no honesty guard on failed NEW bookings.** `rescheduleHonestyGuard`
  (`trigger/processSetterReply.ts:432`) covers reschedule/cancel only; a reply falsely claiming "you're booked" when
  `book-appointments` hard-errored is caught by nothing → ghost booking. Non-frozen. Fix: extend the guard with
  "claims booked but no successful `book-appointments` this turn" (mirror RESCHED-SMS-1). Over-fire risk → wants a
  live forced-failure test.

## Open code items (frozen baseline — gated on the next intentional voice-machinery touch)

- [ ] **SLOT-MAP-1 — slot 1 double-duties as both a setter slot and the inbound-agent resolver; the empty "Setter-1"
  voice tile is a live footgun.** In retell-proxy `SLOT_TO_AGENT_COLUMN`, slot 1 maps to
  `clients.retell_inbound_agent_id` (a legacy single-agent column; the real outbound slots 2/3 were retired in P3a
  2026-06-17, so there is NO dedicated outbound slot). Because the voice grid always force-renders a `Voice-Setter-1`
  tile even when slot 1 is empty, **creating or saving a setter on that empty "Setter-1" tile re-reads
  `retell_inbound_agent_id` and stamps the inbound agent onto the new setter** — re-creating exactly the
  MAIN-OUTBOUND-SHARED-1 collision. **Interim mitigation (holds today):** leave the empty "Setter-1" tile alone.
  **Proper fix (code, `retell-proxy` = frozen baseline, so gated):** give sync a real dedicated outbound slot, OR
  guard `dualWriteVoiceSetter` so it never writes when a non-inbound setter's resolved `agentColumn` is
  `retell_inbound_agent_id`, OR key the `voice_setters` row match on the setter UUID instead of `legacy_slot`.
  Severity Low (data workaround holds; only bites a setter placed on slot 1). Full design context + the three fix
  options: `Docs/DEFERRED.md` SLOT-MAP-1. Source: `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`.

---

## History (context, not active work)

> **MAIN-OUTBOUND-SHARED-1 — ROOT-CAUSED + FIXED (data) 2026-07-07; answered-conversation leg VERIFIED 2026-07-11.**
> "Main Outbound" had been running the Inbound agent (`agent_b2f6495…`) on real outbound dials, caused by the slot-1 /
> `retell_inbound_agent_id` structural collision (see SLOT-MAP-1). Fixed by migrating the WHOLE setter off the poisoned
> slot 1 to slot 10 and restoring `agent_f45f4dd…`. Routing + personalization leg passed 2026-07-07; the
> answered-conversation leg passed 2026-07-11 (a live answered booking call dialed as `agent_f45f4dd…` and booked
> end-to-end). Full detail + rollback SQL: `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`. Residual
> architectural follow-up = SLOT-MAP-1 above.

> Prior closed batches (audit waves, billing B1/B2, session-1 hardening, S6, clients_public boundary, the P1 audit
> reconciliation, the P3 review cluster, the 2026-07-08 overnight pass, and the 2026-07-11 deploy+reconciliation)
> live in `Docs/archive/COMPLETED_LOG.md` + `Docs/ROADMAP.md` + the dated handoffs. Nothing here blocks the gated
> First-Client Milestone on the CODE side (`Docs/FIRST_CLIENT_TASKS.md` + `Docs/FIRST_CLIENT_MILESTONE.md`).
