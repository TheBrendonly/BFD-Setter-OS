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

- [ ] 🟠 **LEADREACT-CRASH-1 (Medium, frontend) - the DB Reactivation page white-screens for every client.**
  `frontend/src/pages/LeadReactivation.tsx` renders `formatNum(totals.totalSends)` (line 121) plus
  `totals.totalResponses` / `totals.totalPositive` / `totals.totalBookings` / `totals.clients` (lines 125-140),
  but `useReactivationData`'s `ReactivationTotals` / `EMPTY_TOTALS` never define those roll-up fields (only the
  per-channel ones: `smsSent`, `callsMade`, `callPositive`, ...). They are therefore always `undefined`, and
  `formatNum = (n) => n.toLocaleString()` throws `Cannot read properties of undefined (reading 'toLocaleString')`,
  blanking the entire route. Verified live 2026-07-12: `/client/<id>/lead-reactivation` renders a fully blank page
  plus that console TypeError, on the dogfood client. Data-independent (the fields are never set regardless of
  data), so it reproduces for ANY client; a regression from the mock->live `useReactivationData` swap (the hook
  comment claims "returns the same shape as the previous mock" but dropped the aggregate roll-ups the page still
  reads). Fix: compute the 5 missing aggregates in the hook (totalSends = calls+sms+emails, totalResponses,
  totalPositive, totalBookings, clients = clientData.length) OR derive them in the component, AND harden
  `formatNum` to `(n) => (n ?? 0).toLocaleString()` as a guard. Found 2026-07-12 test session (RUN 1, browser audit).

- [ ] 🔴 **BOOK-ABORT-GHOST-1 (High, booking) - a `book-appointments` tool timeout creates a GHOST appointment AND
  the setter fabricates "that slot just got snapped up."** Live SMS test 2026-07-12 on an OPEN calendar: on "Monday
  works for me" the SMS setter tried to book the first Monday slot (8:00am); `book-appointments` (idx1) returned
  `{"error":"This operation was aborted"}` (the shared ~30s tool-caller AbortController fired before GHL replied), so
  the setter told the lead *"It looks like that Monday 8:00 AM slot just got snapped up"* and offered other DAYS -
  BUT the GHL write had actually SUCCEEDED, creating a real confirmed appointment (`bookings` f38333fa /
  `ghl_appointment_id` 62B0ZKLKNo, Mon 13 Jul 08:00 Sydney). The lead then booked 10:00am (12ab62ff / GryZyyFpQL),
  ending with TWO real appointments while believing they had one. Two coupled defects: (1) `book-appointments` is not
  timeout-idempotent - a tool abort AFTER the GHL create leaves a ghost booking with no dedup/rollback / re-check;
  (2) the engine maps a tool ABORT to "slot unavailable / snapped up" (a fabricated-scarcity message) instead of an
  honest "let me re-confirm that for you." This is the INVERSE of BOOK-CONFIRM-HONESTY-1 (which guards the
  false-positive "you're booked"): here it is a false-negative PLUS a ghost write. Surfaces: `book-appointments`
  lives in the FROZEN `voice-booking-tools` (idempotency/timeout fix is voice-gated, bundle like BOOK-2/3); the
  abort->"snapped up" interpretation is the text engine (`processSetterReply`, non-frozen) + prompt handling.
  Fix: (a) raise/handle the book-appointments timeout and make it idempotent (on abort, re-query the appointment
  before retry/messaging); (b) never emit "snapped up" from a tool error - route aborts through an honest re-check; (c) retry the
  booking exactly ONCE on a failed/aborted attempt; (d) on FINAL failure, text the lead a self-serve GHL calendar
  booking link (the fn already has Twilio + `toolSendSms`) as a backstop [(c)+(d) per Brendan directive 2026-07-12].
  Found 2026-07-12 test session RUN 3. Evidence: tool_invocations (book-appointments idx1 "This operation was
  aborted" @05:31:12 -> booking f38333fa) + the sms_outbound "snapped up" reply @05:31:17; the second turn's
  book-appointments succeeded (GryZyyFpQL) with an honest confirmation.

- [ ] 🔴 **BOOK-VOICE-FABRICATE-1 (High, booking/voice) - the Main Outbound voice agent intermittently confirms a
  booking WITHOUT calling `book-appointments`.** Live 2026-07-12, two back-to-back outbound calls on the SAME agent
  + prompt (`agent_f45f4dd`): **call_189be0af** verbally confirmed a 2:30pm booking ("All sorted... you'll get a
  confirmation email") but Retell `tool_calls` shows ONLY `end_call` - book-appointments was NEVER invoked, no
  appointment row, no GHL event, no email = pure fabrication; **call_bb3a8f81** DID call book-appointments ->
  `{ok:true}` -> real appointment 3065c059 + an honest confirmation. So the agent non-deterministically skips the
  booking tool and fabricates the confirmation. The success envelope is fine (`{ok:true,tool,result}`), so this is
  NOT a return-shape defect - the agent simply doesn't always call the tool. PRIMARY fix = the Retell PROMPT
  (report-only, Brendan; see PROMPT_UPDATE_LIST PU-14): require a book-appointments call before ANY booking
  confirmation, and forbid "you're booked / a confirmation email is coming" unless the tool returned ok:true this
  turn. CODE backstop (this build session): the BOOK-ABORT-GHOST-1 SMS-booking-link fallback also catches a
  skipped/failed booking; optionally add telemetry when a call's analysis says "booked" but no `bookings` row exists
  for that call. Related: BOOK-ABORT-GHOST-1 (the SMS false-negative + ghost), BOOK-CONFIRM-HONESTY-1 (SMS
  false-positive). Found 2026-07-12 test session RUN 2 (voice).

- [ ] 🟠 **SCHED-1 (Medium, infra) — the two hourly Trigger.dev cron schedules were never registered in prod.**
  `synthetic-probe` + `poll-retell-drift` declare `schedules.task({cron:"0 * * * *"})` in code, but the prod
  schedules list was EMPTY (even after a fresh deploy): `poll-retell-drift` had zero runs ever and `probe_results`
  held 2 rows total since inception — the synthetic uptime probe AND the F9 drift poll had been silent the whole
  time. **Mitigated 2026-07-11:** registered both imperatively via the Trigger API (dedup keys
  `synthetic-probe-hourly-prod` / `poll-retell-drift-hourly-prod`); confirmed firing hourly (24 `probe_results`
  rows in the first day). **Two open follow-ups now that it actually runs:**
  (a) root-cause why the DECLARATIVE `schedules.task` cron didn't auto-register on deploy, so a future re-deploy /
  schedule delete doesn't silently drop them again;
  (b) **the synthetic probe false-fails ~21/24 runs.** The failures are NOT a send bug — the probe client's cadence
  legitimately parks outside its send window (`engagement_executions.stage_description = "Outside quiet hours —
  resuming at 09:01 AM GMT+10"`), but the probe's pass/fail logic (`trigger/syntheticProbe.ts` step 3: "no outbound
  message_queue row after cadence ran (60s poll)") counts a legitimate park as a FAIL. Fix: have the probe treat a
  quiet-hours/business-hours park as PASS/SKIP (read the execution's parked status) instead of failing. **⚠️ If
  `PROBE_ALERT_WEBHOOK_URL` is set in Trigger prod, each false-fail posts a Slack alert hourly** — Brendan should
  check that env var and either apply the probe fix or unset the webhook until it lands (`postAlert` no-ops when
  the var is unset, so if it was never wired there is no spam, just `passed=false` rows). Low urgency. Found 2026-07-11.

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

## Security review 2026-07-12 (pre-pilot red-team pass) — new code items

> A two-model pre-pilot red-team pass over the architecture brief was reconciled against the 2026-07-08 review.
> The BULK of it was ALREADY tracked and is NOT duplicated here: the fail-open Retell cluster (RETELL-INBOUND-PII-1
> / -CALLHIST-POISON-1 / -BOOKING-SMS-1 / -CALLBACK-DIAL-1 = GATE B), base-`clients` secret exposure (RLS-CLIENTS-1 =
> GATE A), the sibling-IDOR endpoints (RLS-GATE-SIBLING-1), account-mgmt authz + secret-log hygiene (reviewed CLEAN)
> — all in `Docs/FIRST_CLIENT_TASKS.md`. The `sync-ghl-contact` "fail-open" claim was REFUTED (GHL webhooks are
> signature-enforced today; `ghl_webhook_secret` set for both clients). The three items below are the only genuinely
> new, live-verified CODE items. New RLS gap (contact/lead tag tables) → GATE A `RLS-TAGTABLES-1`; governance/DPA +
> console-MFA → `BRENDAN_TODO.md`; deferred hardening (secret encryption-at-rest, broaden rate-limit, external-DB
> ownership, hygiene) → `DEFERRED.md`.

- [ ] 🟢 **SEC-PII-LOGS-1 (Low, privacy) — prospect PII is written to stdout logs (→ Supabase/Trigger/Railway logs).**
  The 2026-07-08 review cleared SECRET-value logging, but PII (not secrets) is logged unredacted:
  `unipile-webhook/index.ts:36` (`console.log("Unipile webhook received:", JSON.stringify(body))`) dumps the FULL
  inbound DM (sender identity + message content); `outbound-call-processing/index.ts:490` and
  `make-retell-outbound-call/index.ts:723,903` log full phone numbers; `match-webinar-contacts/index.ts:139,344` log
  raw lead emails. Fix: redact to last-4 / a boolean / a count (reuse the `redactPhone` helper already used in
  `retell-inbound-webhook`). All four fns are non-frozen. (`retell-proxy:495` is the same class but FROZEN → fold that
  one line into the next voice-machinery touch.) Report-first, low urgency (needs platform-log access to exploit).
  Found 2026-07-12 red-team pass.

- [ ] 🟢 **SEC-OPENROUTER-PII-1 (Low, data-minimization) — the text engine sends the lead's raw phone + email to
  OpenRouter every turn.** `trigger/processSetterReply.ts` (~lines 268-274) injects an `identity` object with `phone`,
  `email` (+ `timeZone`) into the OpenRouter chat payload alongside the full conversation. The model almost certainly
  does not need raw phone/email to write a reply, so this is avoidable third-party PII exposure to a subprocessor whose
  retention/training terms are unconfirmed (see the BRENDAN_TODO DPA item). Fix: drop `phone`/`email` from the identity
  payload (keep `contactId` + `timeZone`) unless a prompt genuinely references them. Non-frozen. Report-first: verify no
  booking/confirmation behavior relies on the model seeing them (wants a live SMS regression). Found 2026-07-12 red-team pass.

- [ ] 🟢 **SEC-GHPROXY-1 (Low, hardening; a peer red-team "P0" SSRF claim, REFUTED) — `github-proxy` is safe but spends
  a shared PAT for any logged-in user with no rate limit / role gate.** A peer model flagged `github-proxy` as a no-auth
  SSRF / credential relay. **Refuted on inspection:** it requires an authenticated Supabase user (`auth.getUser()`, else
  401), slug-validates `owner`/`repo` (`/^[\w.-]{1,100}$/`), blocks `..` in paths, and builds every URL as a fixed
  `https://api.github.com/repos/...` from a closed action enum — no arbitrary-host SSRF, no tenant data, a read-only
  public-repo `GITHUB_PAT`. Residual (Low): it accepts ANY authenticated user (not agency-role-gated) and has no
  `bump_rate_limit`, so a logged-in user could exhaust the shared 5000/hr GitHub budget or read any public repo via our
  token. Fix (optional): add `bump_rate_limit` + an agency-role check. Found 2026-07-12 red-team pass.

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
