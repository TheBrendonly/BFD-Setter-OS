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

> **2026-07-12 AUTONOMOUS BUILD session — every non-frozen open bug shipped + deployed + verified.**
> Moved OUT of here: **SEC-OPENROUTER-PII-1** + **SEC-GHPROXY-1** (fully live-verified → `Docs/archive/COMPLETED_LOG.md`);
> **LEADREACT-CRASH-1, INTAKE-RL-1, BOOK-TZ-DISPLAY-1, BOOK-CONFIRM-HONESTY-1, SEC-PII-LOGS-1 (4 non-frozen fns),
> SCHED-1(b), B2-REPOINT-1** (deployed; a residual live behavioral check each → `Docs/TEST_LIST.md` "2026-07-12
> autonomous build"). Live versions + full detail: `Operations/handoffs/2026-07-12-autonomous-build.md`.
> **BOOK-ABORT-GHOST-1 text side** (never fabricate "snapped up") DEPLOYED (Trigger 20260712.2); its FROZEN
> booking-side half is staged (below). **SCHED-1(a)** (declarative cron auto-register) appeared RESOLVED on this
> deploy — all 7 schedules registered; monitor after the next Trigger deploy.

> **REACT-NORMPHONE-1 — FIXED + DEPLOYED 2026-07-21** (`05b4323`, reactivate-lead-list **v10**). Routed the
> leads upsert through `buildLeadInsert` so `normalized_phone` is always stamped (was hand-rolled + dropped it,
> making reactivated leads invisible to by-phone resolution + the stop-bot-webhook fan-out — Medium, data
> integrity, NOT a compliance breach). Backfill was a no-op: 0 live rows had a NULL `normalized_phone` (latent
> bug). `buildLeadInsert` is drop-guard tested; deno check clean. Live behavioral verify (reactivate a
> phone-bearing lead -> `normalized_phone` set, inbound resolves internal-first) -> `TEST_LIST.md`. This was the
> ONLY open code bug; **`BUG_LIST.md` is now at 0 open items.**

## Frozen baseline bundle — DEPLOYED 2026-07-13 (supervised window; Brendan authorized autonomous deploy)

> **The staged `frozen/voice-booking-bundle` (`b710eab`) is DEPLOYED to prod** (main `212ea77`): retell-proxy
> **v52→v53**, voice-booking-tools **v24→v25**, retell-call-analysis-webhook **v27→v28**. Verified read-only:
> **0 live Retell agents mutated** (before/after snapshot), SLOT-MAP-1 guard present in deployed source, and a
> live **SMS booking regression PASSED** (get-available-slots + book-appointments v25 booked end-to-end — GHL appt
> + `bookings` row confirmed — then cancelled). **SLOT-MAP-1 / BOOK-ABORT-GHOST-1 (booking side) / F24 /
> BOOK-VOICE-FABRICATE-1 telemetry / SEC-PII-LOGS-1 retell-proxy:495** all live → `Docs/archive/COMPLETED_LOG.md`.
> **OWED (→ TEST_LIST):** live answered-VOICE booking (F24 cadence-ends, no ghost) + PU-14 + PU-6 (Brendan UI).

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
