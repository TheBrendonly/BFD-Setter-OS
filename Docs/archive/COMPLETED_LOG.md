# BFD-Setter — Completed / Closed Items Log (archive)

Items closed out of the active lists. Newest first. The active lists are in the repo root + `Docs/`
(`BUG_LIST.md`, `FEATURE_ROADMAP.md`, `BRENDAN_TODO.md`, `TEST_LIST.md`, `DEFERRED.md`). First-client-gated
work lives in `Docs/FIRST_CLIENT_TASKS.md` (not archived — deferred).

## 2026-07-22 — lead-notes panel removed (the last console-error blemish)

`8851f79`. The `LeadNotesPanel` (per-contact internal notes) queried a `lead_notes` table prod never had → a 400 +
"Error fetching notes" on every ContactDetail/Chats open since the initial commit. Brendan confirmed the feature
wasn't needed, so removed rather than created: deleted `LeadNotesPanel.tsx` + both call sites (Chats right-panel
NOTES tab → DETAILS-only; ContactDetail slide-out panel + its OPEN/CLOSE NOTES toolbar action + `notes_panel_open`
persistence). The separate booking-note field (`selectedBooking.notes`) untouched; the inert `lead_notes` type block
in the generated `types.ts` left as-is. −634 lines. **Verified:** build + 453 tests green; **headless render smoke
on the deployed vite bundle** (index-24HnNOgD.js) — ContactDetail + Chats render clean, no white-screen, no page
errors, `leadNotesErrorGone:true` (Chats now has ZERO console errors).

> **Observed (pre-existing, NOT introduced) — low priority.** ContactDetail still logs 2 `dm_executions` 400s
> (its query selects `messages`/`setter_messages` columns that don't exist in prod) — same class as the old
> CHATS-DM-1, on the DM surface which has NO live traffic (the panel returns empty; cosmetic console noise only).
> Tracked as a low-priority cleanup, not opened during the 2026-07-22 wind-down. Fix if the DM channel is ever
> shipped, or fold into a future CRM-panel cleanup.

## 2026-07-22 — Full documentation reconciliation + archive sweep (docs-only)

Brendan asked for every list to reflect open-only truth with stale info REMOVED (not just ticked). All 6 lists +
SESSION_PLAN + TEST_SESSION rewritten/banner'd. Items physically closed INTO this log by the sweep (each with its
real pass evidence):

- **PROMPT-AUTH-1 residuals ("No leftover artifacts" + "Efficiency") — CLOSED.** Both were blocked on the Setter-1
  content migration, which Brendan applied + Claude verified 2026-07-07 (stored prompt 68,750 → 53,720 chars; no
  `{{ $now }}` / "Available days" / legacy tool names; passes the lint). The behavioral half (tool-calling + date
  accuracy on `google/gemini-2.5-flash`) is proven by the subsequent live SMS passes (2026-07-12 booking day-map,
  2026-07-13 SMS booking on v25, 2026-07-21 dual-tz offer + reschedule honesty). Nothing left to verify.
- **API-DEPR-1 UI presentation — CLOSED** (Agents tab with full hydrated detail PASSED 2026-07-12; the
  `v2/list-agents` call live-confirmed 2026-07-07). Residual = a Retell-dashboard notice glance → TEST_LIST.
- **GATE-A agency-UI smoke — already passed 2026-07-13**; the remaining "first client-role login" row moved to
  `FIRST_CLIENT_TASKS.md` (only runnable at onboarding). TEST_LIST no longer carries GATE A.
- **B4 SMS send-idempotency live-retry leg → `DEFERRED.md`** (standing; forcing a live Trigger retry is
  impractical; unit + DB + call-side proofs done).
- **BRENDAN_TODO closed items archived:** GHL workflow-URL audit DONE (Brendan, 2026-07-22 — all workflows now
  point at the live project); AU 2028 public holidays SHIPPED (`f31a3cf`, next refresh due before end-2028 for
  2029); the syntheticProbe alert-text cosmetic drift SHIPPED (deployed with Trigger 20260712.2+/20260721.3);
  F21(b) decision recorded as a standing note (feature shipped 2026-07-12). The long [x] history (Session 7/9/10,
  F13/F14 deploy, branding purge, inotify, DEPLOY-1, ACMA check, Setter-1 migration, elevenlabs undeploy,
  F1 field provisioning, Property Coach revert, MODEL-1 correction, SMS latency) was already recorded in this log
  under its original dates and is now removed from the active file.
- **TEST_LIST stale-pass rows removed** (all recorded here under their pass dates): PURGE-UI-1/2, PURGE-SYNC-1,
  SYNC-LOG-1, P3-CLEANUP-1, INB-1, CONTACTS-EDIT-DEAD-1, CHATS-DM-1, COST-4, MODEL-1-HARDENING backend, HOURS-1
  a/d, FOLLOWUP-DURING-CALL-1, RESCHED-SMS-1, BOOK-TZ-DISPLAY-1, SCHED-1(b), SEC-PII-LOGS-1 spot-check, F23,
  LEADREACT-CRASH-1, INTAKE-RL-1, LIVE-D, B-2 CSV + outage legs, G3-6 Tier-3, F15 client-eye, F13 margin/toggles/
  period rows, F8 panel render, the 2026-07-13 frozen-bundle legs (F24 voice booking, PU-14, PU-6, SMS STOP/START),
  and the 2026-07-21 owed legs (STOP-footer, bookings render-smoke, REACT-NORMPHONE-1, voice regression).
- **BUG_LIST** confirmed 0 open; the `lead_notes` pre-existing defect is tracked as a Brendan DECISION (create vs
  remove), not an open build. **DEFERRED** cross-refs corrected (SLOT-MAP-1's exploitable half closed by the v53
  guard — DEFERRED now the sole tracker of the architectural cleanup; INTAKE-RL-1 no longer "pending").

## 2026-07-21 (evening) — Live TEST pass (Brendan present) + GHL booking-sync fix

Live window with Brendan on the phone/2FA (harness: magic-link + TOTP, service-key dials, signed inbound-SMS
sims, Mgmt-API). Full detail: `Operations/handoffs/2026-07-21-live-test-pass.md`.

**The 3 owed live legs — ALL PASS:**
- **STOP-footer (24a)** — manual CRM send to TEST_PHONE_A arrived with `Reply STOP to unsubscribe` appended ONCE
  (server-verified in `message_queue`: `…\n\nReply STOP to unsubscribe`); a body already carrying STOP wording was
  NOT doubled; an immediate re-send returned **429** (LIVE-D rate-limit). Brendan confirmed both texts on his phone.
- **Bookings render-smoke** — ContactDetail renders the full conversation + booking messages incl. the real
  confirmation ("…booked in for a Strategy Call … 12:30 PM AEST …"); no white-screen, no JS/page errors on vite-8.
  (The only console errors are a PRE-EXISTING `lead_notes` 400 — `LeadNotesPanel` queries a table prod never had,
  present since the initial commit, unrelated to the bookings readers.)
- **REACT-NORMPHONE-1** — reactivation (reactivate-lead-list v10 → `buildLeadInsert`) stamped
  `normalized_phone=+61400000001`; the `resolveLeadByPhone` query matched it (by-phone-matchable, no dup). Throwaway.

**Voice booking regression — PASS.** Answered outbound on live Main Outbound (`agent_f45f4dd`, call
`call_e49b7511cd276dd8aa89cc3f765`): real GHL appt + `bookings` row (source=voice_call, confirmed, "Strategy Call
with Brendan", Tue 22 Jul 2pm AEST), honest confirm (email), no ghost, B-5 held. Appt cancelled after. Frozen
v53/v25 voice baseline still good.

**Autonomous legs — PASS:** COST-4 (client-role JWT sees 0 `execution_cost_events`; control read works — role-gate,
not a dead token) · SCHED-1(b) (125 parked probe runs `passed=true`/`skipped-parked`, no false FAIL; config-fails
all historical) · MODEL-1-HARDENING (degrades at all 5 call sites incl. the SMS setter-reply path; junk→null→
DEFAULT_MODEL, alias remap; no 400) · FOLLOWUP-DURING-CALL-1 (`isVoiceCallActive` gate in sendFollowup + nudge) ·
HOURS-1 a/d (AU clamp defers after 8pm/before 9am/Sat-after-5/Sun/ANZAC; new-lead OOH instant SMS + call defers) ·
BOOK-TZ-DISPLAY-1 (setter offered dual-zone "8:00 AM Sydney (6:00 am Perth)" — correct 2h arithmetic) ·
RESCHED-SMS-1 (no active appt → honest "wasn't able to make that change … confirm shortly", no false confirm; also
evidences BOOK-CONFIRM-HONESTY-1's honest-holding-message mechanism).

**Shipped this window:**
- **SEC-PII-LOGS-1 residual** (`d1622dd`, Trigger **20260721.3**) — raw E.164 phone was logged in the by-phone
  opt-out gate of 3 Trigger paths (processMessages/nudgeColdReply/sendFollowup); wrapped in the local `redactPhone`.
  7 prod schedules re-verified active.
- **sync-ghl-booking GHL standard-payload parser** (`436b168` v16, `58db4ea` v17) — the receiver now reads
  `calendar.appointmentId` (at high precedence over the root opportunity `id`), `location.id`, `calendar.id`;
  v17 adds PII-free structural logging of unparseable booking webhooks. **END-TO-END VERIFIED**: created a live GHL
  calendar appt → workflow → `bookings` row (source=ghl_calendar) → cancel flipped it → **0** `MISSING_BOOKING_ID`.
- **GHL "Add Booking to BFD-Setter OS" 400 root-caused + FIXED (Brendan repointed the URL).** The workflow's Custom
  Webhook was still pointed at the **retired `qfbhcixkxzivpmxlciot` project**, which still serves a pre-fix copy of
  `sync-ghl-booking` (proven: POST there → `{"error":"Booking_ID is required"}`). Brendan repointed it to the live
  `bjgrgbgykvjrsuwwruoh`; re-test booking = clean, 0 errors. (The earlier stale-PIT theory was superseded: the real
  cause was the dead-project URL.)
- **`sync_ghl_booking_executions` audit table created** (RLS: tenant-scoped read + service-role write, index on
  `(client_id, created_at desc)`) — the fn's `logExecution` was silently no-oping on a missing table; now GHL
  booking syncs are observable, at parity with `sync_ghl_executions` (contact sync).

## 2026-07-21 — V1 finish loop (client-ready hardening): 6 code items shipped + alerting live

Autonomous loop per `Operations/prompts/04-v1-finish-loop.md`, ratified by the 2026-07-21 v1-vs-v2 decision
(v1 carries the first client; v1 feature work frozen at zero). All deployed + verified this session; live
behavioral legs that need Brendan's phone/2FA are in `TEST_LIST.md`.

- **Bookings schema settled on phase7a** (`61c0d9d`). `information_schema` confirmed live `bookings` = phase7a
  (`appointment_time`/`ghl_appointment_id`/`source`/`raw_payload`). `types.ts` was the stale layer; spliced the
  live blocks in (bookings + leads replaced; `lead_optouts`/`sms_delivery_events`/`client_cost_rollup` added).
  Found + fixed 3 drift-broken readers (`Chats.tsx`, `ContactDetail.tsx`, `ContactConversationHistory.tsx`) that
  queried dead columns (`title`/`start_time`/`ghl_contact_id`) — their booking panels were silently empty since
  phase7a; repointed to phase7a + mapped into the local view models (JSX untouched). tsc 21 -> 17 (0 introduced),
  build green, npm test green. Left the phantom `campaign_leads` type in place (8 frontend files still query it;
  removing it exceeds the tsc baseline + drags in dead-UI removal — out of scope under the freeze).
- **REACT-NORMPHONE-1 fixed** (`05b4323`, reactivate-lead-list **v10**). Routed the leads upsert through
  `buildLeadInsert` so `normalized_phone` is always stamped. Backfill was a no-op (0 live NULL rows; bug was latent).
- **Pre-commit secret hook** (`67e0153`). `scripts/install-git-hooks.mjs` + a `prepare` script install
  `check-secrets.mjs` as a real hook without disturbing graphify's hooks; block-verified against a staged fake PAT.
- **CI report job** (`c03dc5a`). Non-blocking `report` job runs frontend tests + `tsc` + eslint so the 17-error
  typecheck + lint baselines are visible without failing the workflow.
- **Spam Act STOP/unsubscribe footer** (`901a583`, Trigger **20260721.2** + crm-send-message **v15**). New
  `optOutFooter` helper (idempotent; "stop by the office" false-positive guarded) appended at the 4 INITIATED
  commercial send paths (cadence + follow-up via `sendTwilioSmsAndStamp`, nudge, manual CRM send). Wording is
  Brendan's ratified "Reply STOP to unsubscribe"; reactive replies deliberately not footered (matches v2). Code +
  deploy done + unit-tested; live SMS-arrives-with-footer proof owed in the 2FA window.
- **Alerting LIVE + VERIFIED** (`5a9a990`, Trigger 20260721.2). New shared `postAlert` helper routes
  `PROBE_ALERT_WEBHOOK_URL` to Telegram (Hermes 🛠 Dev topic) since Trigger.dev cloud can only reach public sinks
  (greenserver Hermes is Tailscale-only). Armed the env var on Trigger prod via API, then forced a real error-digest
  run: output `slackSent:true` (`emailSent:false`, Resend deferred) — a live Trigger task posted to Brendan's Telegram.
  **This closes the DoD "PROBE_ALERT_WEBHOOK_URL set + a real alert observed arriving" box AND the F23 live-digest
  TEST_LIST leg.** Throwaway error row cleaned up.
- **2028 AU public holidays** added to the telemarketing clamp (`f31a3cf`, ships in 20260721.2).
- **All 7 Trigger prod schedules confirmed active** after both deploys (SCHED-1 stays resolved).
- **DM-webhook A6 corrected:** `receive-dm-webhook` (v18, generic inbound-DM ingress, ProcessDMs UI + manifest) and
  `unipile-webhook` (v14, Unipile account-events callback, unipile-proxy) are complementary, NOT competing — no loser
  to retire. PROJECT_OVERVIEW 12/A6's "retire the loser" premise was wrong.

Handoff: `Operations/handoffs/2026-07-21-v1-finish-loop.md`.

## 2026-07-13 — Voice verification (PU-14/PU-6 + F24/v25) + Phase 4 legs + cache-control

Supervised voice window + autonomous Phase 4. Full detail: `Operations/handoffs/2026-07-13-voice-verify-and-phase4.md`.
- **PU-14 + PU-6 (Brendan applied) — VERIFIED LIVE** on Main Outbound call `call_9ad640...` (108s, agent v26→v28):
  disclosure spoken (PU-6); agent booked via a real `book-appointments` call, no fabricated "booked" (PU-14);
  v25 booked cleanly on voice, no ghost; test appt cancelled. Frozen voice bundle now validated on SMS + voice.
- **INTAKE-RL-1 (DONE)** — 85 concurrent intake-lead POSTs → 60×409 + 25×429 Retry-After:60 in one calendar-minute
  window; no leads/sends (throwaway had no GHL); throwaway deleted.
- **SMS STOP/START (DONE)** — signed STOP recorded a `lead_optouts` opt-out (source=sms_stop); START cleared it;
  safety-net delete confirmed TEST_PHONE_A not left opted out.
- **Cache-control hardening (`d520930`)** — `public/serve.json`: index.html + SPA routes `no-cache`, hashed
  `assets/**` immutable; SPA rewrite preserved (verified locally). Fixes the stale-white-screen class.
- **White-screen regression (mine, `06dbc67`)** — GATE-A ticker referenced `isAgency` out of scope in
  ClientLayout(); tsc/build missed it (root tsconfig is a no-op); caught by the render smoke, fixed, re-smoked 4/4.

## 2026-07-13 — Frozen voice-booking bundle DEPLOYED (SLOT-MAP-1 + F24 + BOOK-ABORT-GHOST-1)

Deployed the staged `frozen/voice-booking-bundle` (`b710eab`) onto main (`212ea77`) in a supervised window
(Brendan authorized the autonomous deploy up to the live voice call). retell-proxy **v53**, voice-booking-tools
**v25**, retell-call-analysis-webhook **v28**. Cherry-picked ONLY the 5 frozen files (the branch predated GATE A).
- **Verified:** 3 fns ACTIVE; **0 live Retell agents mutated** (before/after snapshot of all 6 agents);
  SLOT-MAP-1 guard present in deployed retell-proxy source; voice-booking-tools typecheck clean +
  bookingHelpers tests 11/0.
- **Live SMS booking regression PASSED:** get-available-slots (v25) returned real future slots;
  book-appointments (v25) booked end-to-end (GHL appt `CRIRXl39…`, `bookings` row source=sms confirmed, Meet
  link); test appointment then cancelled. (A batched-message first attempt showed the SMS setter offering a
  stale same-day 8 AM slot + saying "snapped up" without calling book — a model-grounding artifact of the debounce
  batching, noted for PU-14; the clean single-message booking is correct.)
- **OWED (→ TEST_LIST):** live answered-VOICE booking (F24 cadence-ends, no ghost) + PU-14 (booking tool-call gate)
  + PU-6 (recording disclosure on Main Outbound) — Brendan's UI + phone.

## 2026-07-13 — GATE A: RLS role-gate cluster (SHIPPED + VERIFIED, the last pre-client CODE gate)

Opus 4.8, plan-approved, continuous session. Full detail + exact live state: `Operations/handoffs/2026-07-13-gate-a-rls.md`.
Role-gated the whole latent RLS cluster so the first client-role user cannot touch any sibling client's
secrets/cost/config/leads. Proven with a throwaway agency + client-role probe across two sibling clients in one
shared agency: **24/24 PASS** (agency unaffected; client sees only its own row, no secrets — `retell_api_key`
SELECT → 42501; no sibling leads/tags/AI-values; 4 sibling edge fns → 403; own UI-state writes persist;
subscription_status/bundled-key self-escalation blocked by trigger). Then the throwaways were deleted.

- **RLS-CLIENTS-1 (Critical)** — `clients` command-split (SELECT/INSERT/DELETE agency-role-gated; UPDATE agency OR
  client-own-row) + `guard_client_clients_update` BEFORE-UPDATE trigger freezing `subscription_status` + the 4 bundled
  infra keys for client-role writers + `client_own_clients_select` + table→column SELECT REVOKE (111 non-secret cols).
- **RLS-CREDENTIALS-1 / RLS-ORUSAGE-1 / RLS-UNIPILE-1 / RLS-AGENCIES-1** — role-gated agency-only. RLS-ORUSAGE-1 also
  agency-gated the `get-openrouter-usage` edge fn (v1→v2, a 2nd margin-leak vector) + role-branched the ticker read.
- **RLS-TENANT-DISJUNCTION-1 + RLS-TAGTABLES-1** — the 7 tenant parents split into agency-role-gated + client-own FOR
  ALL. Live pg_policies showed the tag tables already tenant-scoped (no `USING(true)` orphans).
- **RLS-GATE-SIBLING-1** — `fetch-thread-previews` / `twilio-list-numbers` / `supabase-project-usage` (all v10→v11)
  repointed to `resolveClientAccess`.
- **LEADS-ROLE-SPLIT-1** — `leads` role-split (children inherit).
- **clients_public** — `security_invoker`→`security_definer` + tenant WHERE (so client reads survive the base gate).

Migrations `20260713120000` / `130000` / `140000`. Owed live UI confirmation (agency smoke + first client-role login) →
`TEST_LIST.md` (2026-07-13 GATE A). GATE B + Stripe + AU A2P + per-client provisioning stay in `FIRST_CLIENT_TASKS.md`.

## 2026-07-12 — AUTONOMOUS BUILD session (SHIPPED + DEPLOYED + verified)

Opus 4.8, plan approved then executed unattended. Full detail + live versions + the STAGED frozen bundle deploy
checklist: `Operations/handoffs/2026-07-12-autonomous-build.md`. Fully live-verified items archived here; items with
a residual behavioral check are tracked in `TEST_LIST.md` (2026-07-12 autonomous build) until that passes.

- **SEC-OPENROUTER-PII-1 (DONE)** — dropped the lead's phone/email from the OpenRouter payload (identity object +
  Lead Context line). **Live SMS booking regression PASSED** end-to-end (turn-1 prefetch `error=null`; turn-2
  book-appointments succeeded, `bookings` row `source=sms`; appointment cancelled). Trigger 20260712.1.
- **SEC-GHPROXY-1 (DONE)** — github-proxy v12: agency-role gate (403 for client-role) + per-user `bump_rate_limit`.
  Verified live: throwaway client-role user → 403; agency-role → passes the gate.
- **F21(a) (DONE)** — sync-ghl-booking v14 rewritten to the phase7a `bookings` shape + dedupe on
  `(client_id, ghl_appointment_id)` + `resolveBookingSource` stamp + `booking_status_events` reconcile (its old insert
  wrote non-existent columns and 500'd — a dead path). Synthetic create→reconcile verified (one row,
  `source=ghl_calendar`, `confirmed→cancelled` event); test rows deleted.
- **F21(b) (DONE)** — AI-sourced-only funnel/weekly `booked` via shared `isSetterSource` (get-show-rate-funnel v3 +
  weeklyClientReport). Live BFD funnel `booked`=setter rows only; a test `ghl_calendar` row excluded; `by_source`
  = setter sources only.
- **F22 (DONE)** — webhook-manifest v4 `reportingHealth {bookings, statusTransitionsSeen, statusAutomationLikelyMissing}`
  (surfaced separately, not folded into `goLiveReady`). Verified live on BFD.
- **LEADREACT-CRASH-1 render (DONE, live browser 2026-07-12)** — `/lead-reactivation` renders all tiles + empty-state,
  0 console/page errors (white-screen fixed); funnel-stage `NaN%` also guarded (`0435561`). F15 funnel card render-verified.
- **F25 (DONE)** — `withEventWindowedShowRate`: held/no-show windowed on `appointment_time` (get-show-rate-funnel v3 +
  weeklyClientReport); `booked` stays a creation cohort, labeled (`held_window`/`booked_window`). Verified live.

## 2026-07-12 — BRENDAN test + build-unblock session (PASSES)

Opus 4.8, Brendan present for the live legs. Harness-driven (headless Playwright + signed inbound-SMS sim +
service-key Retell dials + Mgmt-API SQL). Full detail + the 3 new bugs + the emitted AUTONOMOUS BUILD prompt:
`Operations/handoffs/2026-07-12-brendan-test-session.md`.

**Browser (headless agency login):** F8 Cost-to-Price panel renders (markup 300 / FX 1.52 / Retell 0.07 / LLM
0.003); F13 margin one-liner renders for agency (Billed $8.22 / Cost $3.60 / Margin $4.62 = 56.2%); F15 show-rate
funnel renders (10 booked / 8 cancelled / 2 upcoming; sms 6 + Voice 4); API-DEPR-1 Agents tab lists 24 agents one
row each (name/version/PUBLISHED); CHATS-DM-1 (`/chats`, no `dm_executions...messages` 400); UI-1 (Setter 1..4). 0
secret-in-payload leaks across pages. (`check-client-subscription` "Failed to fetch" in headless = a CORS artifact;
the fn is ACTIVE v19 + 401s on a direct call, NOT a bug.)

**SMS booking (live Twilio reply to TEST_PHONE_A):** BOOK-1 offer (real slots, no fabricated "booked out"),
booking-completes on an explicit accept (book-appointments -> confirmed), SMS-OBS-1 (tool_invocations persisted with
args/result/error), MODEL-1 (reply, no 400), BOOK-3 (13 Jul = Monday, no day-shift).

**Voice:** B-5 (inbound from anonymous/withheld -> greets with NO name, `first_name=''`, never says literal
`{{first_name}}`); the Inbound BFD Agent speaks the recording disclosure; VM-1 voicemail DETECTION works
(`voicemail_reached` / `in_voicemail=true`; the spoken message is Retell-side config, Brendan's domain); a
linked-lead redial BOOKED cleanly (book-appointments -> `{ok:true}` -> real appt, honest confirmation).

**F16b outside-hours:** data-verified against the real gate (`businessHours.isWithinSendingWindow` = false for
Sunday 16:32 Sydney via `AU_LEGAL_WINDOWS[7]=null`; dial defers to Mon 09:02; node-0 confirmation SMS hours-exempt).

**STEP 1 unblock:** F21b DECISION recorded (AI-sourced-only); F16b/F17 dogfood flags already ON;
elevenlabs-manage-agent confirmed already-undeployed (BRENDAN_TODO reconciled).

_New bugs from this session are NOT closed — they live in `BUG_LIST.md` for the AUTONOMOUS BUILD session
(BOOK-VOICE-FABRICATE-1, BOOK-ABORT-GHOST-1 [frozen], LEADREACT-CRASH-1) + `PROMPT_UPDATE_LIST.md` (PU-14, PU-6 re-verify)._

## 2026-07-11 (evening) — COMBINED session: bundle cleanup + autonomous test session + GATE A review

Fable 5, Brendan present. Verified the already-live v51 bundle, cleaned up 3 infra residuals, drove the
tool-drivable + browser test legs, deferred GATE A. Full detail:
`Operations/handoffs/2026-07-11-combined-bundle-test-gatea.md`.

**Phase 1 infra:** elevenlabs-manage-agent **live undeploy** (Management-API DELETE, verified gone —
BRENDAN_TODO item closed); **retell-proxy v52** — removed the dead `LEGACY_N8N_HOST` rewrite guard after a
clean scan (0 n8n URLs across stored configs + snapshots + all 50 live Retell LLMs; commit `43a89c6`);
**Trigger.dev 20260711.1** (syntheticProbe Slack-text drift). retell-proxy v51 bundle (GETCALL-1 + PU-9-CODE)
confirmed live (get-call 200; PU-9 two-beat fillers + speak_after on the write tools present on the canonical
LLMs; 0 agents mutated).

**Phase 2 test session — verified PASS (live):** RLS-UISTATE-1-LIVE (throwaway client-role probe 8/8 + agency
no-lockout), COST-4 (client-role blocked, service-role has rows), COST-1 (morning answered call accrued a voice
cost row = call_history.cost), MAIN-OUTBOUND-SHARED-1 answered-conversation leg (dialed agent_f45f4dd, first_name
interpolated, booked Tue 14 Jul 1:30pm Sydney) + API-DEPR-2(b) (analysis fields TOP-LEVEL) + PU-9 audible,
PURGE-SYNC-1 + SYNC-LOG-1 (sync log rows with labeled steps + echo-skip), QH-TZ-1-LIVE (junk tz no longer stalls
the cadence — 05:00 probe passed), B-2 CSV normalized_phone (after the B2-CSV-NORM-1 fix) + inbound internal-first
resolve, B-2 outage leg (mint bfd-<phone> + degraded warn + no dup), GETCALL-1, G3-6 Tier-3 (5 fns 200 on a real
JWT), G3-6-SCHEMA-1 (analytics-v2-process 200, config gate cleared), INB-1 (latest_published both bindings),
CONTACTS-EDIT-DEAD-1, F13/F15 client-eye (client sees funnel not margin; rate card no markup; /settings redirects),
P3-CLEANUP-1, PURGE-UI-1 (14 routes render clean, no n8n/Skool/1prompt text).

**Phase 2 fixes shipped:** `043e62d` — removed dead Converteai VSL preloads from index.html (1Prompt-era, 403 on
every load) + **fixed PURGE-UI-2** (4 text/voice-ai-rep templates+configuration redirects pointed at a 404
`../setup`; repointed to their real setup pages; verified live). **B2-CSV-NORM-1** — process-lead-file **v18**: CSV
import now derives normalized_phone from the raw csv value (the local display normalizer's `+` prefix was defeating
the E164 AU branch → stored `+0400…` instead of `+61400…`); live re-probe green.

**Phase 3 GATE A — DEFERRED** to the milestone/dedicated session (Brendan's call). Review found the ff355d4 draft
is incomplete: client-role pages UPDATE base `clients.crm_filter_config`, so the blanket agency-only UPDATE gate
would break client UI-state saves — needs client_own policies. Finding recorded on
`Docs/GATE_A_RLS_DRAFT_2026-07-08.md`. GATE A/B live in `Docs/FIRST_CLIENT_TASKS.md` (latent, 0 client-role users).

## 2026-07-11 — SUPERVISED DEPLOY + TEST session + FULL LIST RECONCILIATION

Brendan-supervised daytime session (retell-proxy v51 deploy authorized). Deployed + live-verified the staged
Tier B bundle and the Tier A live checks, fixed TRYGARY, then reconciled ALL six canonical lists: archived
everything verified-done, and pulled every first-client-gated item into the new `Docs/FIRST_CLIENT_TASKS.md`.

### Deployed + live-verified this session
- **GETCALL-1** — retell-proxy `get-call/{id}` → `v2/get-call/{id}` (deployed v50→v51, now live in v52 after the
  branding-purge rebuild). Verified 2026-07-11: `retell-proxy get-call` action → **HTTP 200** with full transcript
  (was 404). Was in BUG_LIST (Low).
- **PU-9-CODE** — lengthened `BOOKING_TOOL_MESSAGES` to two-beat ~20-30 word fillers + `speak_after_execution:true`
  on the write tools (book/update/cancel), `false` explicit on the read tools. Bulk `refresh-booking-tool-messages`
  ran for BFD: **7/7 slots updated, 0 locked, 0 failed**. Verified 2026-07-11 on a live answered booking call
  (`call_c03c21e6…`): `speak_during` filler AND `speak_after` confirmation both fired across the GHL round-trip; the
  booking landed (GHL appt `ipdrHk9K…`, Tue 14 Jul 1:30pm Sydney). Was in BUG_LIST (Low) + PROMPT_UPDATE_LIST PU-9.
- **TRYGARY-DIAL-1 (High)** — removed the unauthenticated `try-gary-landing` branch from `ghl-tag-webhook` (Brendan
  confirmed the GHL-side automation is dead). Deleted the branch + orphaned `handleTryGaryLanding` + its 3 exclusive
  consts; kept `TRY_GARY_TAG_PREFIX*` / `isPhoneRecentDuplicate` / `PHONE_DEDUP_WINDOW_MINUTES` (shared). Deployed
  ghl-tag-webhook v13 (now live at v14 after the branding-purge dual-prefix rebuild). Verified 2026-07-11: a forged
  `source:"try-gary-landing"` POST → **400 contactId required**, 0 leads / 0 executions created. Commit `6ed6cd1`.
- **OPTOUT-FAILOPEN-1 / OPTOUT-EDGE-STAGED** — redeployed the 5 edge consumers of the fixed opt-out twin so the
  lookup fails CLOSED on a DB error: intake-lead v17, trigger-engagement v16, receive-twilio-sms v30,
  stop-bot-webhook v14, voice-booking-tools v24 (frozen, with the read-only Voice smoke — 24-agent set identical
  before/after, nothing mutated). Was BUG_LIST (High) + TEST_LIST OPTOUT-EDGE-STAGED.
- **RLS-UISTATE-1-LIVE** — throwaway client-role probe (bound to BFD, password-grant, no MFA): own-client
  `chat_starred`/`dismissed_error_alerts` insert → **201**; sibling-client insert → **403/42501** (both tables);
  cross-client select → `[]`; own-client select sees its row. Agency-role path (fresh aal1 token): star insert 201,
  select own row, unstar delete 204 → **no lockout**. `pg_policies` confirmed the role-split (agency_all_* +
  client_own_*) on both tables. Was TEST_LIST RLS-UISTATE-1-LIVE.
- **QH-TZ-1-LIVE** — ran the shipped `parseQuietHours` against a junk tz (`Not/AZone`): falls back to
  `Australia/Brisbane` (default) with the warn; downstream `isWithinSendingWindow`/`getNextSendingOpening` run with
  **no RangeError** (control confirmed the raw junk tz throws). Trigger.dev 20260708.1. Was TEST_LIST QH-TZ-1-LIVE.
- **MAIN-OUTBOUND-SHARED-1 (answered-conversation leg)** — the live answered booking call above dialed as
  `agent_f45f4dd…` (the restored dedicated Main Outbound agent), conversed and booked end-to-end. The routing +
  personalization leg passed 2026-07-07; this closes the answered-conversation leg. Was TEST_LIST (`[~]`).

### P3 security review cluster (fixed 2026-07-08, closed 2026-07-11)
All five P3 items are code-complete + deployed + (where a live check was owed) verified this session:
- **F16C-SMS-1** — CODE fix live (retell-call-webhook v24, `signatureVerified` fail-closed). The behavioral
  **live test** is gated on arming `retell_webhook_secret` → moved to `FIRST_CLIENT_TASKS.md` (GATE B).
- **QH-TZ-1** — fixed + live-verified (above).
- **RLS-UISTATE-1** — migration live + cross-role probe verified (above).
- **FUNNEL-SCAN-1** — get-show-rate-funnel v2 (warn on scan-cap truncation). Server-verified.
- **ROLE-RESOLVE-1** — deterministic `get_user_role` (migration live; dual-role probe → `agency`). Server-verified.

### PROMPT_UPDATE_LIST — applied/resolved prompt items (verified live 2026-07-07, formally archived 2026-07-11)
Moved out of the "Open" section (each was `[x]` with a "move to COMPLETED_LOG" note):
- **PU-1** timezone confirmation — "Sydney time" hardcoded in every canonical agent's stored prompt.
- **PU-3** `{{first_name}}` outbound opener — resolved by the MAIN-OUTBOUND-SHARED-1 restore (dedicated agent's
  begin_message personalizes + states purpose; inbound is a separate name-free agent).
- **PU-4** Property Coach company-name placeholder — now "Building Flow Property", no bracket placeholder.
- **PU-6** call-recording disclosure line — applied as direct text in Main Outbound's begin_message; verified read-only.
- **PU-7** caller identification within 30s — Main Outbound compliant; the 4 demo Garys explicitly out of scope.
- **PU-8** voicemail "[Your Name]" placeholder — no bracket placeholder on any of the 5 canonical agents' voicemail.
- **PU-10** reschedule/cancel honesty (list-first, no false confirm) — applied with the Setter-1 migration; the
  load-bearing half is the deployed RESCHED-SMS-1 code guard.
- **PU-12** inbound-unknown-caller "never speak placeholders" guard — applied to Inbound BFD Agent SETTER CORE; verified.
- **PU-9** dead-air — the load-bearing CODE half shipped this session (PU-9-CODE above); the optional persona
  talk-track *bridges* remain a normal report-only prompt option if ever wanted (not tracked as an open item).

### DEFERRED — items that were BUILT (Session P2, 2026-07-07)
- **BOOK-TZ-1** — per-lead timezone display captured (`leads.timezone`, IANA-validated); booked absolute time
  provably unchanged. VOICE prompt wording to speak both zones remains report-only (PROMPT_UPDATE_LIST PU-13, gated
  on a real interstate lead). Dormant until a lead carries a non-business tz.
- **F9 v2** — scheduled Retell drift poll (`trigger/pollRetellDrift.ts`, hourly) + booking-tools-lost alert; verified
  end-to-end against a real drift. Gap (c) auto-hydrate-on-unlock explicitly deferred.

### FEATURE_ROADMAP — shipped features cleared from the build queue
All shipped + deployed live; their remaining live UI checks live in `TEST_LIST.md` (or `FIRST_CLIENT_TASKS.md` where
Resend-gated). Specs retained in `FEATURE_ROADMAP.md` for reference. **F8** (cost-to-price calculator, Session 8),
**F9** (per-setter Retell lock, Session 6.5), **F11** (credentials masked indicator), **F13** (usage & billing
metering), **F14** (auth: invite/reset/12-char), **F15** (client ROI: show-rate funnel + weekly report), **F16**
(never-miss-a-lead: speed-to-lead + missed-call text-back + live-transfer, default-OFF). **F17** phase 1 shipped
(AU calling-hours clamp + recording-disclosure toggle); phase 2 stays gated (post-first-client).

## 2026-07-10 — BRANDING PURGE (dedicated session): all 1Prompt/n8n refs out of the product

Brendan's directive ("anything to do with N8N or 1prompt... is deleted or removed") executed as the scoped
per-category pass. Six decisions taken up front (GHL step → BFD provisioning model; remove all Skool/upstream-repo
links; delete the 15 public JSON exports; Railway rename this session; excise the n8n phases from the setup guide;
strip 1prompt refs from the PromptManagement demo defaults). Highlights:

- **SetupGuideDialog**: deleted the 5 n8n-era phases (workflows-import, n8n-setup, knowledgebase-setup,
  voice-inbound-setup, voice-outbound-setup) + the agent-JSON import steps (~2,000 lines), rewrote the GHL
  account step to the BFD provisioning model (support@buildingflowdigital.com), removed 108 orphaned image
  imports + 112 screenshot files, updated SETUP_PHASES/wrappers/wizards (stale completion ids are ignored).
- **Deleted surfaces**: frontend/public/{workflows,retell-agents} (15 JSONs), WorkflowImports/TextAIRepTemplates/
  VoiceAIRepTemplates pages (+routes → redirects, menu keys), 5 archived webinar pages + WebinarSetupGuideDialog,
  dead WebhookConfig component, GithubFileExplorer + the upstream-repo card, scripts/native-vs-n8n-diff.mjs,
  elevenlabs-manage-agent (repo; live undeploy pending Brendan's go).
- **PromptManagement defaults** (approved one-time exception): deleted the 77-line fake-bio
  "ABOUT EUGENE & 1PROMPT" section, 8× access.1prompt.com → `[your-checkout-link]`, 1× 1prompt Skool →
  `[your-community-link]`, "n8n" dropped from 2 platform lists. Stored DB prompts untouched.
- **Edge fns deployed** (7, all ACTIVE + boot-smoked): run-simulation v21, generate-simulation-personas v21,
  generate-conversation-examples v19, format-metric-chart v19 (OpenRouter headers → buildingflowdigital.com,
  `bfd-simulation-` emails), sync-ghl-contact v29 + push-contact-to-ghl v10 ("Find Lead in BFD" labels;
  echo-guard fallback `bfd-setter` — safe: both live clients carry explicit `1prompt-os` values),
  ghl-tag-webhook v14 (dual try-gary prefix, legacy still accepted). retell-proxy untouched (staged v50→v51
  bundle stays gated on its own session).
- **Docs**: README architecture rewritten to the native-engine reality; RUNBOOK/CLIENT_ONBOARDING_SOP/DEFERRED/
  TEST_SESSION/SELF_HOSTING updated. Migrations, archives, handoffs, and the GHL_SETUP factual automation names
  left as history.
- **Verified**: tsc + production build green, all 253 tests pass, 7 fns boot-smoke 400 (no 500s).
  Live checks → TEST_LIST PURGE-UI-1/2, PURGE-SIM-1, PURGE-SYNC-1, PURGE-TAG-1.

## 2026-07-07 — Session P2: deferred pull-forward build (F9 v2 + BOOK-TZ-1 + execution_cost_events)

Brendan-driven triage over `DEFERRED.md`. The bulk stays gated (no paying client / no real usage data yet);
Brendan greenlit three non-client-gated items, each built at MVP depth with TDD + verify-before-completion.
Commits `db4205e` (cost ledger) + the F9 v2 and BOOK-TZ-1 commits after it. All deployed (edge fns +
Trigger.dev Version 20260707.1).

- **`execution_cost_events` ledger** — dedicated itemized per-execution cost table (voice/sms/llm), keyed by
  `engagement_executions.id`, agency-only role-gated RLS (raw cost = BFD margin; mirrors `client_pricing_config`
  trap), `UNIQUE(cost_kind, provider_ref)` for idempotent upserts. Real cost where available: voice
  (`retell-call-webhook` v23 + `retell-call-analysis-webhook` v27, `call.cost`, execution_id bridged from the
  Retell dynamic var), LLM (`runEngagement` end, real `ai_cost_cents`); estimated for SMS
  (`sendTwilioSmsAndStamp`, num_segments × seed). Pure `buildCostEvent` + 9 unit tests. No downstream consumer
  rewired (it just accrues — the prereq for 2.6/F8v2/3.9/4.1). Idempotency + schema + RLS proven via SQL;
  live accrual → TEST_LIST COST-1..4.
- **F9 v2 (poll + alerts)** — hourly `trigger/pollRetellDrift.ts` reads locked setters + per-client Retell key
  from the DB, compares live get-agent/get-retell-llm vs the stored snapshot via pure `computeDriftState`
  (11 tests), sets persisted `voice_setters.retell_drift_detected_at`/`retell_booking_tools_lost_at` flags →
  error_logs + optional Slack + PromptManagement tile badges; cleared on pull/unlock (retell-proxy v50).
  Gap (c) auto-hydrate-on-unlock explicitly deferred. Verified end-to-end via a controlled lock of Property
  Coach (real live drift v17 vs synced v13): flag+error_logs written, idempotent, cleared on pull, restored.
- **BOOK-TZ-1 (per-lead timezone display)** — `leads.timezone` captured from the GHL contact
  (`buildLeadInsert`/`sync-ghl-contact` v28/`intake-lead` v16, IANA-validated); `leadTimezone.ts` helpers
  (Intl, DST-aware) + 7 tests; VOICE `{{lead_timezone(_label)}}`+`{{business_timezone(_label)}}` dynamic vars
  (`make-retell-outbound-call` v29, inert until the prompt uses them); TEXT additive lead-tz block in
  `processSetterReply` (frozen availability/tool blocks untouched, byte-mirror still green). Booking code
  untouched → booked time stays business-tz. Voice wording is report-only → PU-13. Dormant until a lead
  carries a non-business GHL timezone.

## 2026-07-07 — Session P1 audit reconciliation: backlog items confirmed passed 2026-07-03/05/06 but never archived

A full list-vs-live-state audit (git log, edge-fn versions, table/column existence, and the dated handoffs)
found several items that had already passed their live test — in some cases days earlier — but were left
sitting as open/duplicate rows in `BUG_LIST.md` / `TEST_LIST.md` instead of being moved here. No new testing
was done this session; these are archival-only, each cited to the run/handoff where it actually passed.
Full audit table: `Operations/handoffs/2026-07-07-p1-audit-reconciliation.md`.

- **BOOK-1 + 3.12 SMS booking (the acceptance test) — PASS, 2026-07-05 TEST SESSION RUN 3.** The SMS setter no
  longer fabricates "booked out" against an open calendar: RUN 3's multi-turn SMS exchange (signed inbound to
  TEST_PHONE_A) shows "3.12 booking, SMS-OBS-1, SMS-MEM-1 (alternating human/ai, no re-ask), BOOK-1/BOOK-3
  (books exact accepted Sydney time), STOP respected" all passing (handoff `2026-07-05-test-session.md` RUN 3).
  This is the acceptance test that had been blocking 3.12 SMS booking since Session 7 (2026-06-30); both are
  now closed.
- **DEPLOY-1 — Railway production pinned to `main`. DONE 2026-07-04 (Brendan, screenshot-confirmed).** Railway
  `1prompt-os` → production → Settings → Source shows "Branch connected to production" = `main` with
  auto-deploy on push only. The auto-deploy-any-branch hole (any pushed feature branch reaching the live
  domain unreviewed, discovered during the Session 9 deploy) is closed.
- **F11 — Credentials "Configured" masked indicator. PASS, 2026-07-05 TEST SESSION RUN 1** (headless, all 17
  agency routes): dot-mask placeholder + "Configured ✓" render correctly; write-only guard intact.
- **UI-1 — plain setter labels. PASS, 2026-07-05 TEST SESSION RUN 1.** "Voice Setter Names" card shows plain
  "Setter N" labels, no stale role-hint suffixes.
- **F13 — margin panel + period/anchor browsing + 4-toggle client-visibility matrix. PASS, 2026-07-05 TEST
  SESSION RUN 1.** "F13 margin + period/anchor + 4-toggle flip (+ `show_rate_to_client` mirror) + volumes vs
  SQL (voice 3min/1call, SMS 19)" — live edit-save persisted, blended $/min hand-checked against SQL. (The
  fourth F13 check, the dashboard-summary-card render for both roles, was not explicitly covered by this run
  and stays open in `TEST_LIST.md`.)
- **PROMPT-AUTH-1 — Full-prompt-visibility X-Ray check. PASS, 2026-07-05 TEST SESSION RUN 1.** "PROMPT-AUTH-1
  X-Ray (full assembled prompt + matches badge)" — the operator-facing X-Ray view shows the complete assembled
  system prompt and matches the live stored value. (The "no leftover artifacts" and "efficiency" checks in that
  same BUG_LIST item remain blocked on Brendan applying the Setter-1 content migration — still open in
  `TEST_LIST.md` / `BRENDAN_TODO.md`.) The PROMPT-AUTH-1 bug entry itself (the booking-logic root cause: a
  hidden stale `Available days: Tue/Wed/Thu` rule + un-interpolated `{{ $now }}` causing wrong-day bookings) is
  also closed here — code deployed 2026-07-03 (main `6c5c339`+`157bb8f`), live SMS regression confirmed the
  same day (Wed 8 Jul 2:30pm Sydney booking, no fabrication), and adversarial pre-deploy review refuted the
  only surviving concern. The one remaining piece, a content-hygiene migration Brendan applies himself via the
  UI (removing the legacy 511-line booking blob from the stored Text-setter prompt), is tracked as its own row
  in `BRENDAN_TODO.md` ("Apply the Setter-1 prompt content migration").
- **B-2 — GHL-outage inbound resilience leg. PASS, 2026-07-05 TEST SESSION RUN 6.** "B-2 outage: inbound never
  dropped, `bfd-<phone>` synthetic lead, `ghl_contact_resolve_degraded` (not `_failed`), Twilio-direct reply, 0
  dups, key restored." This is the (1b/1c) resilient-miss-path leg from the Session 5 by-phone pivot. (The
  other three B-2 checks — CSV `normalized_phone`, background-repoint convergence, deterministic GHL pick on a
  multi-contact phone — were not covered by this run and stay open in `TEST_LIST.md`.)
- **API-DEPR-2(a) + F13 client-eye view — PASS, 2026-07-06 (Fable onboarding run).** Pushed `sync-voice-setter`
  with a real AGENCY user JWT on a fresh throwaway client → created agent `agent_c09e76046be7e61b57c030104d`;
  `get-agent` showed `post_call_analysis_data` = 3 `type:"system-presets"` entries (`call_summary`/
  `call_successful`/`user_sentiment`) + 6 custom fields, no dupes, the 3 deprecated `analysis_*_prompt` fields
  absent, born-bookable. Separately, `get-client-usage` as a real CLIENT JWT on a throwaway client/user proved
  the server-enforced visibility whitelist (all toggles OFF → `{show:false}`; each toggle exposes only its own
  figure; all ON → all four; the AGENCY JWT still gets the full margin payload), and the client-role
  `/account-settings` UI rendered the "Usage & Billing" card correctly under each toggle state. Throwaway
  agent/client/user all deleted after.

### PROMPT_UPDATE_LIST items confirmed already resolved (live Retell verification, read-only)

A dedicated read-only pass against the actual live Retell agents (list-agents/get-agent/get-retell-llm, no
writes) for the Brendan action pack turned up four items already in a resolved state — likely from Brendan's
own 2026-07-05 prompt push (the 4 Garys + Inbound BFD Agent were all last edited within seconds of each other
that day):

- **PU-1 (timezone confirmation)** — "Sydney time" / "Australia/Sydney" wording is hardcoded directly in the
  stored prompt on every canonical agent, not just runtime-injected.
- **PU-4 (Property Coach company-name placeholder)** — now reads "Company name: Building Flow Property", no
  bracket placeholder, no config note.
- **PU-8 (voicemail "[Your Name]" placeholder)** — the 4 Garys + the shared Main-Outbound/Inbound BFD Agent's
  voicemail message reads "Leave a breif message saying you will try again later and why you called. Thanks."
  on all five — no placeholder.

**Important correction made mid-session:** an initial verification pass misidentified "Main Outbound" as the
Retell agent literally named `Voice-Setter-Test` (`agent_f45f4dd…`), based on the phone number's static
`outbound_agents` binding — precisely the trap this project's own `CLAUDE.md` warns against ("ignore the
phone number attached to an agent in Retell"). Cross-checked against the platform `voice_setters` table (the
"Main Outbound" row's `retell_agent_id`, which is what `make-retell-outbound-call` actually uses via
`override_agent_id`) and three dated real-call citations already in this file: **the real live "Main
Outbound" is `agent_b2f6495…` — the same physical Retell agent as "Inbound BFD Agent."** This means **PU-3
(outbound opener personalization) is still genuinely open**, not resolved — corrected back to open in
`PROMPT_UPDATE_LIST.md` with the caution that inbound and outbound currently share one prompt, so
`{{first_name}}` can't just be added to the shared opener without breaking inbound. **PU-6** and **PU-7** were
also corrected: Main Outbound (being the same agent as Inbound) already has the recording disclosure, so only
3 agents (not 4) still need it; and Main Outbound's own Telemarketing Standard compliance is borderline (states
persona+company+disclosure but closes with an inbound-style question, not a stated outbound purpose), not
clean-compliant as first reported. `Voice-Setter-Test` (`agent_f45f4dd…`) itself is confirmed genuinely unused
by the live call path — `CLAUDE.md`'s existing note about it was correct all along.

## 2026-07-06 — Voice + browser test session (finishes the shared-fn pass; closes CANCEL-1/BOOK-2/BOOK-3/SMS-METER-1)

Hybrid session: Claude drove the browser-UI + SMS legs autonomously via headless Playwright + the harness (one 2FA code from Brendan at the start, then a warm `storageState` for the whole session); Brendan did the one answered outbound voice call. Handoff: `Operations/handoffs/2026-07-06-voice-browser-session.md`. RUN 0 green (git in sync `380a889`; edge fns voice-booking-tools v23 / retell-proxy v49 / webhook-manifest v3 / analyze-chat-history v19 / analytics-v2-process v19 / compute-analytics v16 all ACTIVE; test:node 127/127, test:edge 217/217).

**PART A — browser UI (headless Playwright, agency session), all PASS:**
- **ONBOARD-1 (both create paths)** — a throwaway sub-account created via the CreateClient PAGE (`/client/:id/create-client`) AND via the sidebar Add Sub-Account dialog were BOTH born with `clients.use_native_text_engine = true` (SQL-verified); both throwaways deleted.
- **ONBOARD-2** — on the no-external-Supabase client (`b0e4f199` "Synthetic Probe"), Create New Setter → clear guard toast *"External Supabase not configured … Configure this client's external Supabase (URL + service key) on the Credentials page first, then create the setter."* and **zero** new `prompts` rows (no orphan).
- **ONBOARD-3** — CreateClient + sidebar-dialog `#login-password` placeholders both read "Min 12 characters"; a <12 password in the sidebar dialog is REFUSED client-side (toast "Password must be at least 12 characters", NO client created, no admin createUser call).
- **GOLIVE-1 UI** — Inbound Webhooks card: not-ready client badge "Not go-live ready" + the "Still missing:" line lists the failing checks (NOEXT → "GHL location, Retell phone number, a pushed voice setter, external Supabase, traffic on the required webhooks"; BFD → "traffic on the required webhooks", the honest `requiredWebhooksReceived` signal).
- **ACCESS-1** — a throwaway CLIENT-role login (created + deleted) hit `/prompts/voice`, `/prompts/text` and `/credentials`: all three redirect to `/analytics/chatbot/dashboard` (AgencyRoute); sidebar shows only ANALYTICS / LEADS / CONVERSATIONS / CREDENTIALS / MY ACCOUNT / SIGN OUT (no Text/Voice Setter items). Full cleanup (user + client deleted).
- **SWEEP-1a/b/c** — `/account-settings` (agency + a throwaway client) no `clients_public` 400; `/logs` Errors + Bookings + Outbound tabs no "invalid input syntax for uuid" 400, all rendered; `/chats` no 404 on `chat_starred`/`dismissed_error_alerts`. Persistence proven via PostgREST round-trips (agency `chat_starred` upsert 201 → read-back → delete 204; agency `dismissed_error_alerts` insert 201 → read-back → delete 204). Client-role RLS own-row write proven (client JWT: `chat_starred` own 201, `dismissed_error_alerts` own 201). All test rows cleaned up.
- **F9-1** — with slot-4 "Gary - Property Coach" Retell-locked (SQL, restored after): tile inline-rename input never appears + toast "Retell-locked — unlock this setter to rename it"; the locked tile's action button reads "RETELL-LOCKED" and clicking it does NOT open the doc page (Radix toast "Setter is Retell-locked…"), so the doc-page-header rename is unreachable too; `clients.setter_display_names` UNCHANGED (no write); lock state restored.
- **PHONE-CLEAR-1** — ADD a contact via the Contacts dialog set `normalized_phone` = +61411222333; EDIT via ContactDetail followed to +61422333444; CLEAR nulled it; Chats DETAILS-panel edit set +61400000777 and reverted to +61400000199 exactly. Throwaway deleted, synthetic lead restored.
- **G3-7** — headless nav of the vite-8 prod bundle across dashboard / prompts / leads / logs / chats / account-settings: all rendered, ZERO module/chunk errors.

**PART A — SMS (harness signed-inbound to the native text engine):**
- **CANCEL-1 (SMS) cancel + fabricated-id refusal — PASS.** Booked a fresh appt (Thu Jul-9 1pm, GHL `0JWu67x70HRIcPpR8TfA`), then "cancel that meeting": the successful `cancel-appointments` bound the REAL `eventId=0JWu67…` (result returned the real appt object, no 404), `bookings` flipped to `cancelled`, GHL cancelled. Every fabricated / un-listed id the model tried (`649000…`, `668d2111…`, `1718557890000`, `58022000-…`) was REFUSED by the eventId binding with "no appointments listed this turn" — none reached GHL, no false confirmation on those. The protected pre-existing appt (`zjLTA9…`, Jul-8 2:30pm) was never touched.
- **BOOK-2 / BOOK-3 (SMS) — re-confirmed PASS.** Two SMS bookings landed at the exact accepted Sydney times (Thu 1pm, Fri 2pm), source sms, confirmed, no day-shift; get-available-slots returned correct Sydney offsets.

**PART B — one answered outbound voice call (Main Outbound `agent_b2f6495…`, `call_c347226e…`, 233s), all PASS on v49 + v23:**
- **VOICE GATE (B1) — PASS.** `book-appointments` `ok:true`, real GHL id `yw7NyOE0…`, the agent offered REAL slots (12:00/12:30 Mon Jul-13, no fabrication) and booked the picked time; `bookings.source='voice_call'`. No regression vs the 2026-07-03 baseline (`call_d5625539` / booking `4f7c76a0`).
- **CANCEL-1 (voice) reschedule + cancel — PASS.** `update-appointment` and `cancel-appointments` both bound the REAL `eventId=yw7NyOE0…` → `ok:true`, no 404, no fabrication, no false confirmation; the reschedule MOVED the time (this is the successful-reschedule leg the SMS engine couldn't produce), the cancel FLIPPED the status. Protected `zjLTA9…` untouched. Server-side voice-booking-tools binding confirmed live.
- **SMS-METER-1 (voice, in-call) — PASS.** Mid-call `send-sms` `ok:true` (Twilio sid `SM82b1cf…`) stamped a `message_queue` `channel='sms_outbound'` row (ghl_account_id = BFD location `xo0Xjmen…`, processed). F13 will count it.
- **Errors check (Brendan ask):** `error_logs` empty for the whole ~90-min window; every voice tool returned `ok:true`.

**Shared-fn pass CLOSED** — CANCEL-1 (binding), BOOK-2, BOOK-3, SMS-METER-1 now have BOTH the SMS/tool half (part 1, 2026-07-06) AND the voice half (this session) green → all four moved out of `BUG_LIST.md`.

**New findings opened this session** (see `BUG_LIST.md` / `PROMPT_UPDATE_LIST.md`): **RESCHED-SMS-1** (SMS reschedule: the fast model calls get-available-slots instead of get-contact-appointments before update-appointment so the binding refuses it, and once emitted a FALSE "moved, all set" with no successful update — data stayed safe; voice reschedule is unaffected); **CHATS-DM-1** (`/chats` queries `dm_executions.messages`, a column that doesn't exist → 400 on the recent-outbound-previews fetch; types-drift); **FOLLOWUP-DURING-CALL-1** (cold-reply nudge / follow-up SMS fired while the lead was on the live voice call); **PU-9** (voice dead-air during tool lookups — the per-tool execution-message word caps are too short to cover the GHL round-trip; recommend longer multi-beat fillers + `speak_after_execution` + a talk-track). **Observations:** `chat_starred`/`dismissed_error_alerts` RLS is agency-scoped (a client-role user can also write sibling clients' rows within the same agency — low sev, convenience tables, RLS-SHAPE class); the standalone Contacts EDIT dialog (`showEditDialog`/`handleEditContact`) is dead/unwired code (ContactDetail + Chats panel are the reachable edit surfaces).

## 2026-07-06 — Autonomous test pass (part 1): shared-fn SMS/tool regression + RLS-SHAPE-1

Ran the tool-drivable half of the post-deploy regression on the live v23 + Trigger 20260705.1 stack (harness: signed inbound SMS, direct tool POST, Mgmt-API SQL), one DB assertion per step. The cancel/reschedule + voice legs were intentionally deferred to the supervised voice session (Prompt 2) because TEST_PHONE_A holds a live confirmed appointment and an unattended cancel misbind could destroy a real one.

- **BOOK-2 (SMS) — PASS.** Booked "Tue 7 Jul 3:30pm" via `sms_inbound.mjs`; `bookings.appointment_time = 2026-07-07 05:30 UTC` = exactly 3:30pm Sydney, status confirmed, source sms. No false "unavailable", no shift. Test appt cleaned up by its exact GHL id (`YQZpHF8Z9HMYrNR1jKDV` cancelled + bookings row mirrored).
- **BOOK-3 (SMS) — PASS.** `get-available-slots` returned the correct Sydney days (Jul 6 + Jul 7) with `+10:00` offsets, no UTC day-shift; the full book cycle logged `get-available-slots` + `book-appointments` in `tool_invocations` with zero errors/404.
- **SMS-METER-1 (direct tool) — PASS.** `POST voice-booking-tools?tool=send-sms&clientId=BFD` (intake bearer) to TEST_PHONE_A → tool `sent:true` (sid `SM449634…`) and a new `message_queue` row `channel='sms_outbound'`, ghl_account_id = BFD location, twilio_message_sid = the sid, processed. (The meter row reflects a genuinely-sent SMS, so it is left in place — deleting it would corrupt metering.)
- **RLS-SHAPE-1 — CLOSED.** `pg_policies` qual for `sms_delivery_events` agency SELECT leads with `(get_user_role(auth.uid()) = 'agency'::text) AND …` → client-role JWT reads 0 rows. Shape hardening proven at the policy level.
- **G3-6-SCHEMA-1 — partly reconfirmed.** `analytics-v2-process` (service key) cleared its config gate for BFD; the fn code hardcodes `chat_history` (v19 live). Full analytics render (analyze-chat-history) needs a user JWT and is left to a browser run.

Not moved out of BUG_LIST: CANCEL-1 / BOOK-2 / BOOK-3 / SMS-METER-1 stay `[~]` — the shared-fn rule requires BOTH the SMS/tool half (done here) AND the voice half (Prompt 2) before closing. CANCEL-1 has no passing leg yet (its cancel/reschedule half is the whole point and was deferred).

Env note: the harness Playwright agency session (storageState) was gone and its refresh_token got consumed on a validity probe (GoTrue rotates refresh tokens single-use), so the browser-UI re-checks (SWEEP-1a/b/c UI, F9-1, PHONE-CLEAR-1 UI, G3-7 nav, ACCESS-1 + the onboarding-fix live rows) could not be driven this session; they need a fresh magic-link + ONE TOTP code and are on the human list.

## 2026-07-06 — Onboarding-fix pass: GOLIVE-1 closed (server-verified live); ONBOARD-1/2/3 + ACCESS-1 built

The five onboarding-gate bugs from `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md`, one commit each
(`9f5b959`..`bb6322a`). Frontend fixes ride Brendan's `git push github main` (Railway builds from
GitHub; the auto-mode classifier blocked that push) → live rows in TEST_LIST "Onboarding-fix pass".

- **GOLIVE-1 — goLiveReady no longer a birth false-positive (CLOSED, server half verified live).** webhook-manifest v2→v3 ACTIVE. goLiveReady now = requiredWebhooksSecured AND ghl_location_id AND retell_phone_1 AND ≥1 pushed voice setter (voice_setters retell_agent_id + is_active) AND external Supabase (url + service key) AND lastReceivedAt on both required hooks (bookings-webhook gained a real `bookings` lastReceived signal, was hardcoded null). Response carries the per-check `goLiveChecklist`; the card shows "Still missing: …". Verified live 2026-07-06: Synthetic Probe (blank) → goLiveReady:false with only the secrets check true; BFD dogfood → all provisioning checks true, requiredWebhooksReceived honestly false (sync_ghl_executions created 2026-07-05, 0 rows yet; flips on the next GHL sync). UI line rides the frontend deploy.
- **ONBOARD-1 — UI-created clients born with the SMS engine ON (BUILT).** `use_native_text_engine: true` added to ALL THREE UI client-create inserts (CreateClient.tsx, Onboarding.tsx, ClientLayout sidebar Add Sub-Account dialog) + the two Workflows.tsx go-live-flip writes (heals pre-fix clients when a default campaign is set). Live verify → TEST_LIST.
- **ONBOARD-2 — create-setter/text-save guarded on external Supabase, no orphan (BUILT).** Up-front `clients_public` supabase_url + has_supabase_service_key check in handleCreateNewSetter (both channels) and handleSavePrompt (non-voice) with a clear "configure the external Supabase on Credentials first" toast; create now does the external write BEFORE inserting the platform `prompts` row. Live verify → TEST_LIST.
- **ACCESS-1 — setter editors agency-only (BUILT).** `prompts/text` + `prompts/voice` AgencyRoute-wrapped (same redirect as /credentials); Text/Voice Setter sidebar items hidden from client logins in both the menu-config and default menus. Live verify (client-role login) → TEST_LIST.
- **ONBOARD-3 — 12-char password copy/validation sweep (BUILT).** CreateClient + sidebar-dialog placeholders 6→12; Settings/ClientSettings checks + copy + button gate 6→12; NEW: the sidebar Add Sub-Account dialog create-login had NO length validation and admin createUser BYPASSES the GoTrue policy, so it could actually create weak client logins — now refused client-side. TOTP 6-digit checks untouched. Live verify → TEST_LIST.

## 2026-07-05 — Build pass: SWEEP-1 (a/b/c) + SYNC-LOG-1 + G3-6-SCHEMA-1 fixed + deployed

The autonomous, low-risk half of the fix-all-bugs BUILD PASS. Schema applied to LIVE prod via the Management API (this project has no migration runner); frontend + edge deployed per surface. Verified read-only. (The shared-fn pass CANCEL-1/BOOK-2/BOOK-3/SMS-METER-1 is BUILT + STAGED, awaiting Brendan's supervised deploy, so it stays `[~]` in BUG_LIST.)

- **SWEEP-1a — /account-settings 400 (FIXED).** AccountSettings selects stripe_customer_id / subscription_start_date / subscription_end_date from `clients_public`; neither the base `clients` table nor the view had them live (20260319185040 never applied). Added the 3 columns to `clients` (nullable, needed at the Stripe milestone) + appended them to the `clients_public` view (security_invoker preserved). Migration `20260705120000_*`. Verified: the exact AccountSettings select returns 200. Live UI re-check owed → TEST_LIST.
- **SWEEP-1b — /chats 404 (FIXED).** Shipped `chat_starred` (unique client_id,lead_id) + `dismissed_error_alerts` (unique client_id,lead_id,error_log_id) with client-readable/writable RLS (the client_account_field_config agency_id-scoped FOR ALL pattern, no role gate — per-client UI state written under the client JWT). Migration `20260705120500_*`. Verified: both tables live, RLS on, unique keys match the upserts' onConflict, selectable (no 404). Live UI re-check owed → TEST_LIST.
- **SWEEP-1c — /logs 400 (FIXED, frontend).** The lead-name classifier put external text ids (error_logs.lead_id / call_history.contact_id / bookings.lead_id — all confirmed GHL text ids, never uuids) into the uuid bucket → leads.in('id', textval) → 400. Routed all four tabs to leads.in('lead_id', …); removed the now-dead uuid branch (its results were never even read — every render consumer keys by the external id). tsc clean; verified the lead_id query hydrates a name. Commit `f0f2cb1` (live on `main` push).
- **SYNC-LOG-1 — sync_ghl_executions (FIXED).** `sync-ghl-contact` logExecution inserts into this table on every intake; it was absent in prod (the 20260402 migrations were never applied — pure drift). Applied the existing create + index + RLS + `steps jsonb` to live prod (idempotent). Verified: all 8 columns present (match the insert), both policies live. A live intake writing an audit row is the owed check → TEST_LIST.
- **G3-6-SCHEMA-1 — clients.supabase_table_name de-overloaded (FIXED, edge).** The column is the external LEADS table (8+ fns) but 3 analytics readers also treated it as the chat table (analyze-chat-history hard-required it → 400 when null, as it is for BFD; analytics-v2-process / compute-analytics used it with fallbacks, and a default-'leads' client would misread once onboarding runs). Hardcoded `chat_history` in all three (matching the 9 sibling chat readers) + dropped the column from their selects. Deployed analyze-chat-history v19, analytics-v2-process v19, compute-analytics v16 (all ACTIVE). No BFD behavior change (column null); fixes the latent default-'leads' case Fable onboarding would hit.

## 2026-07-05 — Build pass reconcile: 7 deployed `[~]` bugs closed (live-verified by the 2026-07-05 TEST SESSION + Test-finish)

Reconcile step of the fix-all-bugs BUILD PASS. These were all DEPLOYED in Session 9 (2026-07-04) and confirmed live-verified across `Operations/handoffs/2026-07-05-test-session.md` (RUN 1/2/3) + `2026-07-05-test-finish.md` (RUN 4). Removed from the active `BUG_LIST.md`; no rebuild. (PHONE-CLEAR-1 deliberately NOT closed here — no RUN in either handoff reports a PHONE-CLEAR-1 pass, so its live Contacts-dialog verify is still owed; it stays `[~]` in BUG_LIST with a TEST_LIST row.)

- **SMS-MEM-1 — Text setter now persists the inbound human turn (PASS).** RUN 3: multi-turn SMS shows alternating human/ai `chat_history` rows and the setter no longer re-asks an already-answered question. Deployed via Trigger 20260703.2 (`trigger/_shared/persistHumanTurn.ts`).
- **FOLLOWUP-PROMPT-1 — follow-up channel got the PROMPT-AUTH-1 protections (PASS).** RUN 4: `sendFollowup` injects the `## Live calendar availability` block (follow-up ONE-WAY variant, names no booking tools), the `## Current date & time` anchor, and the stale-`{{ $now }}` neutralizer; decided `cancelled`, 0 outbound. Deployed via Trigger 20260703.2 (`trigger/_shared/buildFollowupContext.ts`).
- **PROMPT-LINT-1 — save-time lint casing/wording bypasses closed (PASS).** RUN 1: all bypass cases (Pascal/caps tool names, lowercased header, hyphenated day-ranges, reworded day policies, follow-up fields) now caught; ordinary "weekdays" copy still passes clean. Deployed via save-external-prompt v15 + browser `useAgentSettings` gate.
- **SMS-OBS-1 — Text-engine tool calls/results persisted (PASS).** RUN 3: `tool_invocations` rows written on the SMS path (name/args/result), so booking failures are DB-visible. Deployed via Trigger 20260703.2 + the `tool_invocations` table.
- **MODEL-1-HARDENING — invalid `clients.llm_model` can't silently break the engines (PASS).** RUN 1: 8/8 — known ids apply as the canonical lowercase list id, unknown ids require an explicit "Use anyway" confirmation, `provider/model` shape guard anchored. Deployed via the prod frontend (`isKnownOpenRouterModel.ts`) + the MODEL-1a trigger-side alias map.
- **F9-1 — Retell-locked tile rename no longer leaks the display-name write (PASS).** RUN 1: a rename attempt on a locked tile is REFUSED (structured 423 surfaced as an error, no `setter_display_names` write) via both the tile heading and the doc-page header. Deployed via the prod frontend.
- **VM-1 — `set-voicemail` client-wide push lands (PASS).** RUN 2: Save & push (mode=`prompt`) succeeded on all 5 push-target agents with NO "partial" (v48 fix confirmed — `ensureEditableAgentDraft` → publish → repoint, `static`→`static_text` enum), and a real voicemail played (~15s). Deployed via retell-proxy v48.

## 2026-07-05 — Test-finish (AUTONOMOUS): RUN 4 (F3/F4/FOLLOWUP-PROMPT-1) + RUN 7 (F1) all PASS

Claude drove these fully autonomously via the harness (Mgmt-API SQL, service-key edge fns, the Trigger.dev v1 REST endpoint, GHL/Retell REST) after the 2026-07-05 TEST SESSION. All test-writes reverted, all test artifacts deleted (final sweep: 0 residual leads/workflows/campaigns/timers; client config restored — `auto_engagement_workflow_id` set, `timezone=Australia/Sydney`). No prompt content edited; `retell-proxy` (v49) + `voice-booking-tools` untouched.

- **F1 — GHL conversation deep-link (PASS).** Created a fresh GHL contact `ZhJUVbYR06J4ZtHhEFsv` (fresh AU mobile) → POST `sync-ghl-contact` (x-wh-token) → `{status:"created", contact_id:9f078a4f-…}`. Assertions: `leads` row exists, `leads.id` == the response uuid; GHL `GET /contacts/{id}` shows the custom field `4tDL3asiRNrQD3MKyP2E` == `https://app.buildingflowdigital.com/leads/9f078a4f-788c-4f4b-a58e-4c94609c1640` and it is the ONLY custom field (exactly one write); **zero outbound SMS** (BFD stays sole sender); enrollment correctly skipped (0 `engagement_executions`). Send-free method: temporarily nulled `clients.auto_engagement_workflow_id` (its node 0 is an immediate `engage` SMS) for the ~30s window + restored it (Brendan pre-approved). Cleanup: GHL contact deleted (200), `leads` row deleted. Note: the operator audit table `sync_ghl_executions` does not exist in prod so `logExecution` no-ops — logged as **SYNC-LOG-1** (Low) in BUG_LIST; F1 proven directly off the GHL field, which is stronger than the step log.
- **F4 — timezone-aware cold-reply nudge SKIP (PASS).** Seeded one qualifying cold lead, set BFD `clients.timezone` out of the 09:00-20:00 window (`Pacific/Honolulu`, local hour 0), triggered one `nudge-cold-reply` run via the Trigger v1 REST endpoint → run output `{ok:true, scanned:3, nudged:0, tagged_silent:0, skipped:3, errors:0}`: all 3 cold leads (the seed + the 2 real BFD cold leads) tz-skipped, ZERO sends. Seed `nudge_count` stayed 0 and it was NOT tagged_silent (so it reached and was stopped by the tz gate specifically, having passed every other filter — proven by `scanned=3`). `clients.timezone` restored to `Australia/Sydney`; seed lead deleted. (In-window positive deliberately not run — a blanket trigger would nudge every other live cold lead; the tz-gate SKIP is the F4 feature, the positive path is the default it suppresses.)
- **F3 — pause / resume / END NOW (PASS).** Authored a throwaway 2-`delay`-node workflow (node0 5s so it COMPLETES → `last_completed_node_index=0`; node1 3600s to hold the run open), a throwaway campaign + lead for `+61400000288`, enrolled via `trigger-engagement` (service key; needs `workflow_id` in the body, not derived from the campaign). Once node0 completed (run parked deep in node1's delay), **PAUSE** → `status='paused'`, `lcni=0`, `completed_at=NULL`, `stop_reason=NULL` (no metric finalize); **RESUME** → `{status:resumed}`, a NEW `trigger_run_id`, `status='running'`, `lcni` still 0 (node0 not re-run, resumes from index 1 — double-send guard); **END NOW** → `status='cancelled'`, `stop_reason='manual_stop'`. Zero sends the whole test (both nodes are delays). All throwaway rows deleted.
- **FOLLOWUP-PROMPT-1 — follow-up injects availability + time anchor (PASS).** Seeded a throwaway lead + a "not interested" external `chat_history` exchange + a pending `followup_timers` row, fired it via `push-followup-now`. The deployed `sendFollowup` (Trigger 20260703.2) ran and correctly hit the cancellation condition (`decision=cancelled`, ZERO outbound). `followup_timers.raw_exchange` shows the fix's injected blocks in the LLM user message: `## Live calendar availability (ground truth — already fetched for you this turn)` with real GHL open slots, the follow-up ONE-WAY variant (names no booking tools), the `## Current date & time (ground truth)` anchor ("Today is …"), and the explicit stale-`{{ $now }}` neutralizer line. Send-free; all seed rows (platform + external) cleaned up.

**Deferred (not a fail):** **API-DEPR-2(a)** presets-on-agent after a clean voice-setter Save — `retell-proxy` requires a real user JWT (no service-key fast path), and hand-reconstructing a full voice payload against a live shared agent is unsafe. Per Brendan, carried into the **Fable onboarding session**, which does a voice-setter save/deploy on a fresh THROWAWAY agent (zero risk to the 5 canonical agents). API-DEPR-2(b) top-level analysis already PASSED live on 2026-07-05.

## 2026-07-03 — Session 7-finish voice-regression gate (retell-proxy v47 confirmed SAFE)

Brendan-driven live call; Claude verified read-only. The one behavioral leg not run overnight. **v47 did NOT regress the calling path → kept live, no rollback.** Preconditions done first: **A1** (BOOK-1 anti-fabrication rule added to the Text setter via **IDENTITY → Agent Mission** free-text — BFD's text setter is the structured section builder, one text setter `Setter-1`, no single prompt box), **A2** (5 voice setters re-saved/pushed — Retell agents modified 03:40-03:43), **A3** ("Gary - Property Coach 1" reverted).

- **Voice booking E2E (PASS).** Outbound `call_d5625539` (Main Outbound `agent_b2f6495` v11, ~2.9 min, `agent_hangup`, sentiment Positive): the agent used **real availability** ("I don't have 11:00 open… I've got 10:30 or 11:30" — no fabrication) and booked → `bookings` `4f7c76a0`, `source='voice_call'`, `status='confirmed'`, `appointment_time` 2026-07-02 01:30 UTC = **11:30 AM Thu Sydney**.
- **B-3 (latest_published) — PASS.** Ran on `agent_b2f6495` **v11 = current published version** (follows current, not a stale pin); phone binding also shows `outbound_agents[].agent_version="latest_published"`.
- **B-5 (default vars / `{{first_name}}`) — PASS.** Call dyn vars `first_name="Brendan"` populated; **zero literal `{{first_name}}`** in the 2715-char transcript. (Genuine unknown-number leg still owed in TEST_LIST.)
- **F2c (outbound calling works) — PASS.** `voice_setter_id=b09624b5` = Main Outbound; correct agent + from-number.
- **VM-1 (voicemail push) — FAILED → BUG_LIST (re-opened).** Save & push (mode=`prompt`) still "partial"; all 5 push-target agents' `voicemail_option` unchanged (`hangup`) → landed on **0/5**. v47's deprecated-field fix was necessary but not sufficient; blocker is the raw PATCH without `ensureEditableAgentDraft` (immutable published versions) + a latent `static`→`static_text` enum bug. Does NOT gate v47.

## 2026-06-30 — Session 7 TEST pass continued (phone-half + migrated LIVE-A UI passes)

Brendan-driven live sweep; Claude verified read-only. The phone-heavy half of the Session-7 TEST pass. A live-breaking bug (**MODEL-1**) was found + fixed, and the SMS-booking failure (**BOOK-1**) was root-caused → it spawned the **overnight Text-Setter repair session** (council-vetted; see handoff `2026-06-30-session7-test-pass-phone-half.md`). Still-owed live items (B-5, F1, LIVE-D, LIVE-E, G3-6 Tier-3, 3.12) remain in `TEST_LIST.md`.

### Phone-half passes (2026-06-30)
- **MODEL-1 — invalid `clients.llm_model` FOUND + FIXED live.** BFD's `llm_model` was `google/gemini-flash-latest` (not a valid OpenRouter id) → every `llm_model`-driven engine (SMS setter reply + all cadence AI-copy) 400'd silently. Corrected to `google/gemini-2.5-flash` via Mgmt API (Brendan's choice). Hardening (validate the free-text field) → BUG_LIST **MODEL-1-HARDENING**.
- **B-4 (6.2) — client-role RLS + "My Account only" nav (PASS).** Claude provisioned a throwaway client-role user, then deleted it (user_roles back to 1 agency row). Read-only RLS proof: a user in its OWN agency reads 0 leads/0 clients (cross-agency isolation holds); as client-of-BFD it reads its agency's data. Brendan (incognito) confirmed the login lands on its own dashboard with "My Account" only. Finding (recorded by-design): the `leads`/`clients` RLS is **agency-scoped** (single `agency_all_leads` policy) — within one agency a client role is UI-scoped, not DB-isolated, from sibling sub-accounts; cross-agency boundary is solid; onboarding mints a fresh agency per top-level signup so each real client = own agency.
- **F2c — outbound calling still works end-to-end (PASS).** Cadence "Try-Gary: Property Coach" (n3 `phone_call` → Gary - Property Coach slot 4) placed call `call_88a6abd…` on `agent_e71ee570` → +61405482446, human-answered, 57s, 10 turns, `user_hangup`; from-number resolved (no "no Retell phone configured"); on hang-up exec `ee508762` → `completed` (cadence advanced).
- **G3-3 — outcome-stamp guard (PASS).** Same call: `engagement_executions.last_call_outcome` **stamped** (full outcome object) + `active_call_id` **cleared (null)** on `call_ended`.
- **6.12b — answered-call + SMS halves (PASS).** GHL contact (MWPMQuRyatfRINnXukzG) updated 05:53:16 with **Call Outcome=Answered, Last Call Date, AI Summary, Sentiment=Neutral, Call Intent=wants_to_book_meeting**. SMS half: the hourly scan advanced `leads.last_sms_analyzed_at` (2026-06-23 → 2026-06-30 04:00:50) + populated SMS Sentiment/Intent/Summary on the contact.
- **F9 outbound-dials-while-locked (PASS).** The answered call placed + connected on the **locked** Property Coach (`is_retell_locked=true`, voicemail PATCH skipped, still dials).
- **F9 unlock resumes BFD management (PASS).** Unlocked Property Coach (`is_retell_locked=false`, `retell_locked_at=null`); Edit reopened; a rename ("Gary - Property Coach 1") **cascaded with NO 423** to `voice_setters.name` + `setter_display_names.voice-4` + live Retell `agent_name` (re-confirms B-1 cascade). F9 lifecycle fully verified end-to-end. (Brendan to revert the trailing " 1" → BRENDAN_TODO.)
- **B4 send-once / no double-dial (PASS, call side).** Exactly one Retell dial for the cadence call. (SMS-retry idempotency = unit+DB-proven; inducing a live Trigger retry is impractical — stays noted.)
- **Calls latency — re-measured, acceptable.** The cadence call dispatched within tens of seconds (Trigger dequeue), consistent with the known/resolved behavior; not a regression.
- **B-3 (6.4) — phone-clear (PASS core).** Cleared the "Hayden" lead's phone → `leads.phone=null` **and** the GHL contact phone cleared (both 06:22:59). Original B-3 (clear not reaching GHL) FIXED. Finding → BUG_LIST **PHONE-CLEAR-1** (`normalized_phone` not cleared).
- **6.11 — voicemail/no-answer fallback (PASS).** Call `call_4bdcf0f…` → `voicemail_reached`; `last_call_outcome` stamped; cadence fired the fallback "missed call" SMS **~9s after** the call ended (06:26:36 → 06:26:45) — prompt, not the old ~600s ceiling.
- **SMS latency (config change, Brendan-approved):** `agent_settings.response_delay_seconds` for all 7 BFD setters 60/82 → **12s**.

### LIVE-A UI half passes (2026-06-28, migrated from TEST_LIST)
- **F2b inbound auto-rebind (PASS 2026-06-28).** Flipped inbound to Crazy Gary then back to Inbound BFD Agent; binding moved + restored; end state slot 8 `is_inbound=true`, Retell inbound→`agent_b2f6495`, phone timestamp bumped. (Toggle versionless-rebind → INB-1, since fixed in the 2026-06-29 build.)
- **F6 setup guides (PASS 2026-06-28).** Setup Guide tab renders the renumbered phases cleanly (deleted quiz steps confirmed gone; `SETUP_PHASES` counts decremented).
- **B-6 toggle holds + non-silent (PASS 2026-06-28).** Success toast on each flip; persisted (DB-confirmed); covered in the F2b move-and-restore.
- **B-6 "Bound" vs "rebind" (PASS 2026-06-28).** Green "Bound" moved to Crazy Gary's card + rebound the live inbound number; the previously-bound agent dropped back correctly.
- **F9 lock a setter (PASS 2026-06-28).** Locked Property Coach: Retell-locked badge + "Not pulled" chip; Edit read "Retell-locked" + did not open; Duplicate/Delete hidden; DB `is_retell_locked=true`, exactly one locked.
- **F9 bulk loops skip the locked setter (PASS 2026-06-28).** `refresh-booking-tool-messages` toast "Updated 5 of 6"; locked slot-4 LLM frozen while slots 5/6/7 bumped. (`set-voicemail` "partial" = the separate VM-1 bug.)
- **F9 Pull from Retell + drift (PASS 2026-06-28).** First Pull → synced v11, snapshot + `booking_tools_present=true`, "In sync"; edited+published in Retell (→v13) → "Drifted · pull"; re-Pull → synced v13, "In sync".

## 2026-06-29 — Overnight FRONTEND-ONLY build (F11, UI-1, INB-1, G3-8(b))

Unattended overnight, run alongside the **paused** Session 7 TEST pass. **Edge versions UNCHANGED** (retell-proxy **v46**, make-retell-outbound-call **v27**, all other edge fns at their Session-6.5 versions); **no edge deploy, no Retell/DB write, no setter lock/unlock/edit** — the paused Session 7 TEST baseline is intact. Verification was tsc + vite build only (both green). Frontend-only diff on `main`; Railway auto-deploys the static build.

- **F11 — Credentials "Configured" masked indicator + optional-key labelling (SHIPPED → TEST_LIST).** When a secret is configured (`has_<col>` / saved sentinel), the secret box now shows a fixed-length **dot-mask `••••••••••••`** + a bolder **"Configured ✓"**. Critical safety design: the mask is the input **placeholder**, never the `value` — the fields stay write-only (`value=''`), so the existing blank-save guard still reads the box as "unchanged" and a save can never PATCH the secret to literal dots. Zero real secret characters reach the browser (G3-6 boundary preserved). `ApiCredentials.tsx`: both in-file render components (`CredentialInputField`, `ApiCredentialField`) updated, so all 7 secrets get the mask + tag centrally; added an `isOptional` prop to `CredentialInputField` and passed it to **Supabase Personal Access Token** + **OpenRouter Management Key** so they render **(Optional)** and drop the red "Not Configured" pulse. `SetupGuideDialog.tsx`: the 5 inline secret fields (OpenAI, OpenRouter, Supabase Service Key, GHL, Retell) got the dot-mask placeholder (keyed on each `savedXConfig` sentinel) + "Configured ✓" badge for parity. Live-verify of the rendered indicator → TEST_LIST.
- **UI-1 — stale role labels dropped (SHIPPED → TEST_LIST).** `VoiceAIRepSetup.tsx` "Voice Setter Names" card passed pre-P3a hints `{slot:1,'Inbound'}/{2,'Outbound'}/{3,'Followup'}/{4,'Slot 4'}` into `SetterDisplayNamesCard` (renders "Setter N · hint"). Dropped all hints → plain **"Setter N"** (the card's `hint?` is optional; tsc clean). `TextAIRepSetup.tsx`'s card was already hint-free, untouched.
- **INB-1 — inbound rebind pins `latest_published` (SHIPPED → TEST_LIST).** `useSetInboundSetter.ts:109` inbound rebind now sends `inbound_agents:[{ agent_id, agent_version:"latest_published", weight:1 }]` (was versionless) — B-3 auto-follow parity with outbound + the refresh-repoint. No type change needed (`updatePhoneNumber` takes `Record<string,unknown>`). No Retell call fires at build time; effect lands the next time someone uses the inbound toggle.
- **G3-8(b) — dead presentation/webinar cluster deleted; cross-project secret leak closed (DONE).** Confirmed dead by exhaustive grep (the two chat components were imported **only** by two unrouted `_archived` pages; App.tsx has no route to either). Per Brendan's call, deleted the whole 4-file cluster — `PresentationAgentChatInterface.tsx`, `WebinarPresentationAgentChatInterface.tsx`, `_archived/PresentationAgent.tsx`, `_archived/WebinarPresentationAgent.tsx` — which keeps `tsc` green (the archived importers are gone too) and closes the `openrouter_api_key`→hardcoded `n8n-1prompt.99players.com` forward. Re-ran tsc + build after the deletion: both green, no orphaned import. G3-8 **(a)** (LeadRow service-key webhook forward) stays open in BUG_LIST. Pre-existing orphan deliberately left: `ClientLayout.tsx:618` `presentation_only_mode` redirect to a now-nonexistent route (harmless dead branch, out of scope).

## 2026-06-28 — Session 7 (TEST pass — read-only banked + early live sweep; Claude verifies read-only)

Prereq confirmed read-only: all **5 setters re-Saved** — the B-1/B-5 net is on the latest published version (Voice-Setter-Test/outbound + the 4 Garys all carry the default-vars net on their published LLMs). Deployed baseline matches the handoff exactly (14 edge fns at their stated versions; migration `20260627130000` lock columns + partial index live; all setters `is_retell_locked=false`). The items below were closed on read-only proof during this session; the live-UI / live-call items continue in `TEST_LIST.md` as Brendan drives them.

- **B-3 — outbound auto-follow (PASS, read-only).** Retell `list-phone-numbers` → `+61481614530` now shows `outbound_agent_version: "latest_published"` (was numeric `19`); inbound already `latest_published`. The string ref means any later publish goes live on outbound with no re-pin. Acceptance signal met. (The separate "B-3 (6.4)" phone-clear retest stays in TEST_LIST.)
- **B-5 — default-vars net (PASS, read-only).** After the re-Save, every live published **LLM** reports `default_dynamic_variables = {first_name:"", last_name:"", business_name:"", phone:"", email:""}` (was `null`): outbound `llm_a73df8…v22`, Crazy Gary `llm_8b1e8d…v7`, Property Coach `llm_112c23…v11`, Mortgage Broker `llm_263eb3…v11`, Finance Strategist `llm_9af96b…v6`. Confirms the v45 net lands on the LLM (not the agent) and reasserts on Save. (The paired live `{{first_name}}` inbound-call retest stays in TEST_LIST.)
- **G3-5 — esbuild advisory (PASS, local).** `frontend`: `npm ls esbuild` → `esbuild@0.25.12 overridden`; resolved runtime `0.25.12`; `npm audit` no longer lists GHSA-67mh-4wv8-2f99. (Build was green at ship; override + advisory-clear re-confirmed.)
- **F2a / F7 — DB invariants (PASS, read-only).** Partial unique index `voice_setters_one_inbound_per_client` present (`ON (client_id) WHERE is_inbound=true`) → a second-inbound write would error 23505. Draft cadence `c206da3e` (`engagement_workflows`) and companion campaign `326ea535` (`engagement_campaigns`/`campaigns`) are **0 rows** everywhere → deleted, no dangling refs.
- **6.7 — synthetic-probe canary (PASS, read-only).** The `PROBE_*` env is set in Trigger prod (`PROBE_CLIENT_ID` / `PROBE_INTAKE_SECRET` / `PROBE_TEST_PHONE`; optional `PROBE_ALERT_WEBHOOK_URL` not set → failures surface in run logs only). The hourly `synthetic-probe` cron is firing and `probe_results` shows **24/24 consecutive `passed=true`** (latest `2026-06-28 09:00 UTC`, 15.3s) — full pipeline each run: intake-lead → `engagement_executions` `running` → outbound `message_queue` row → cancel. Acceptance ("canary passes") met. (Operator may add `PROBE_ALERT_WEBHOOK_URL` later for proactive fail alerts — optional.)
### Code/DB-verified (no live action needed) — Brendan's call to verify from code where possible

- **G3-6 network-tab gate (PASS, code audit).** Stronger than a one-off Network glance — proves the property for every load. Central reader `useClientCredentials` → `clients_public` and `CREDENTIALS_FIELDS` is `has_*` booleans only (no raw values). No `select('*')` on raw `clients` (the two `select('*')` are on `clients_public`, secret-free). Every raw-secret `.select()` in the codebase is archived/unrouted, `LeadRow` behind the manual "execute lead" button, or the Presentation/Webinar chats — all the already-tracked **G3-8** residue, none among the 13 gated screens (no gated screen imports them). No browser `openrouter.ai` key call (only public `/api/v1/models`); no browser external-Supabase `createClient`.
- **G3-6 Credentials write-only save (PASS, code).** Explicit blank-save guard (`ApiCredentials.tsx:472`): a blank secret field → "No change" toast, write skipped (can't NULL a stored secret); grouped Supabase/LLM saves treat blank as "keep existing".
- **G3-6 Setup-Guide write-only save (PASS, code).** Same guard + `SECRET_CONFIGURED='__configured__'` sentinel (`SetupGuideDialog.tsx:496-498`); `isConfigured` drives blank inputs.
- **F2c phone relocated (PASS, code).** `RetellPhoneNumberSelector` deleted (0 references); `RetellPhoneNumbersTab` lives on `ApiCredentials` + `VoiceAIRepSetup`.
- **G3-8(c) dead code removed (PASS, code).** `pages/ApiManagement.tsx`, `components/SupabaseConfigCard.tsx`, `components/RefreshCostDialog.tsx` all absent; app builds.
- **F8-1 cost-ceiling agency-only (PASS, code).** `{isAgency && (` wraps the weekly/monthly ceiling inputs (`ClientSettings.tsx:311`); the `*_cents` value loads (94-95) and saves (173-174) regardless of role → a client save can't wipe an agency-set ceiling.
- **B-6 inbound badge (PASS, code+data).** List-view badges read `voice_setters.is_inbound` (the SoT, `PromptManagement.tsx:5119+`), not `prompts.is_active`. Live data: slot 8 `is_inbound=true`, its agent `agent_b2f6495` = `clients.retell_inbound_agent_id` = Retell inbound binding → renders green **Inbound · Bound** (not "rebind"). (Pixel confirmable in passing during RUN 4.)
- **B-4 settings nav, agency side (PASS, code).** `ManageClients.tsx:81` title "Sub-Accounts"; `ClientLayout.tsx:960` agency nav "Sub-Accounts"; `ManageClients.tsx:458` `navigate('/client/<id>/settings')`. (Client-role RLS + "My Account only" still owed live → TEST_LIST RUN 2.)
- **types.ts drift, 5 UI-state features (PASS, code+data).** UI reads+writes `crm_page_size`, `crm_column_widths`, `log_column_widths`, `sync_ghl_booking_enabled`, `what_to_do_acknowledged`; all columns live on `clients` → persistence is a plain DB round-trip.
- **B-1 rename cascade (PASS, code+data).** `retell-proxy` `set-agent-name` PATCHes Retell `agent_name` + publishes and cascades `prompts.name` + `agent_settings.name` + `voice_setters.name` (`index.ts:1467-1486`). Live evidence: DB `voice_setters.name` already equals each live Retell `agent_name` (e.g. "Gary - Crazy Gary"). (Inline UI rename + Duplicate-typed-name still nice-to-eyeball but the cascade is proven.)
- **6.10 normalized_phone on GHL intake (PASS, code+data).** `sync-ghl-contact` creates leads via `buildLeadInsert` (`_shared/lead-insert.ts:25` `normalized_phone: normalizePhone(input.phone)`; header comment cites BUG 6.10; unit-tested). Live: all leads populated, `rows_missing_norm=0`.
- **F2e legacy picker (PASS, code).** Defensive legacy `Voice-Setter-N` slot fallback + amber re-select signal present in `Engagement.tsx` (no live data triggers it today).
- **G3-4 status codes (PASS, code+server).** Server side already live-confirmed (missing clientId → HTTP 400 `{success:false}`; connection failure → 502). UI callers read the structured body off `error.context` so the specific toast survives and the Network status is the real 400/502, not 200: `ChatAnalytics.tsx:1282` (external-Supabase test) + `:2607` (metric analysis), and `EmailInbox`/`InstagramDMs` read `error.context.json()`/`.status`.
- **delete-setter no orphan (PASS, code).** `retell-proxy` `delete-voice-setter` soft-deletes the `voice_setters` row (`index.ts:1664` "Soft-delete the voice_setters row so it can't linger as an orphan" → deactivates the row) after tearing down the Retell agent/LLM/flow. (The rest of bug-sweep — 6.1 sub-account nav Pencil/Trash, 6.3 Twilio/inboxes/avatar/cred-sync — stays live in TEST_LIST.)
- **G3-2 shared-agent disambiguation (PASS, code).** `retell-call-webhook` matches `dynamicVars.ghl_account_id` → `clients.ghl_location_id` (1:1) and logs `ambiguous_agent_match` on a genuinely ambiguous match, else falls back to the first row. Single-tenant today = picks the sole match (no-op), which is correct.

- **F1 field provisioned (setup, not the test).** Created the GHL **"BFD Conversation Link"** custom field via API (`POST /locations/{loc}/customFields`, TEXT, `model:contact`) → id `4tDL3asiRNrQD3MKyP2E` (`contact.bfd_conversation_link`) on location `xo0XjmenBBJxJgSnAdyM`; stored it in `clients.ghl_conversation_link_field_id` for client `e467dabc`. F1 is now **active** → the live deep-link write test stays in TEST_LIST (Brendan drives a fresh GHL contact). NB: the live integration authenticates with `clients.ghl_api_key` (a `pit-…` token); the repo `.env` `BFD_GHL_PIT` + `BFD_GHL_LOCATION_ID` are **stale** (401 / wrong location) — local-script only, no runtime impact.

## 2026-06-26 — Session 4 (client visibility + cadence controls)

Planned as three M-sized builds (F1/F3/F4). Read-only verification first (Relay Protocol) found **F3 and F4 were already built and committed to `main`** but never reconciled off `FEATURE_ROADMAP` — so only **F1** was a genuine build. Outcome: F1 shipped, F3/F4 verified live + Trigger.dev redeployed, all three → `TEST_LIST`.

- **F1 — GHL → BFD conversation deep-link (SHIPPED).** On lead **create**, `sync-ghl-contact` now writes the lead's BFD conversation URL (`https://app.buildingflowdigital.com/leads/<leads.id>`, the `ContactDetail.tsx` route) onto the GHL contact via the existing `writeGhlContactFields` helper (`PUT /contacts/{id}`, `customFields:[{id, field_value}]`). New `clients.ghl_conversation_link_field_id` column holds the per-client GHL field id (matches the 16 sibling `ghl_*_field_id` columns); migration `20260626120000` added it to `clients` **and** appended it to the `clients_public` view (CREATE OR REPLACE, `security_invoker=on` preserved, **0 secrets leaked**, 118 cols). Write is **non-fatal + dormant** (a `sync-convo-link` step logs "skipped" until the field id is provisioned — `writeGhlContactFields` no-ops on empty id/key, exactly like the 12 outcome fields). `types.ts` surgical (clients Row/Insert/Update + clients_public Row). Deployed `sync-ghl-contact` **v23 → v24** (bundle script); `deno check` clean; `vite build` green. Replaces the GHL conversation-provider POC near-term (DEFERRED 6.12a). Brendan provisions the GHL field to activate → BRENDAN_TODO; live test → TEST_LIST.
- **F3 — pause / resume a running cadence (ALREADY BUILT; reconciled).** Built in commit `4b7dbc1` (2026-06-15): edge fns `pause-engagement` (live **v1 ACTIVE**) + `resume-engagement` (live **v1 ACTIVE**), the `runEngagement.ts` `isPaused()` boundary-exit (returns `{status:'paused'}` without finalizing metrics), and the `Engagement.tsx` PAUSE/RESUME buttons. `engagement_executions.status` is plain `text` (no CHECK), so `'paused'` is accepted. No code change this session. → TEST_LIST (live-runtime E2E owed).
- **F4 — timezone-aware `nudgeColdReply` cron (ALREADY BUILT; reconciled).** Built in commit `b0c6bea`: `nudgeColdReply.ts` already gates every nudge to 9am–8pm in the client's `clients.timezone` (IANA, via `Intl.DateTimeFormat`); the cron stays hourly UTC and a later in-window run picks up skipped leads. Satisfies F4's "lead-local-time check." No code change this session. → TEST_LIST.
- **Trigger.dev redeploy** — `20260625.1` (12 tasks) from clean `main` HEAD, to guarantee the F3 pause-exit + F4 tz-gate runtime is current in prod (the prior prod deploy predated the 2026-06-23 audit-sweep tweaks to both files).

## 2026-06-25 — Session 3 (settings + setter cleanup)

Frontend build green; DB migrations applied via Management API; **no edge-fn/Trigger deploy needed** (F2b reuses the existing `retell-proxy update-phone-number` action). All items → `TEST_LIST.md` for live verification.

- **B-4 settings nav split** — reality check: the client/admin split was **already shipped** in the 2026-06-17 account-access restructure (SYSTEM nav already gated; deep config already reached via the sub-account click-through; self-serve fields already admin-governed via `ClientAccountFieldConfigEditor`). Remaining delta was the naming finish: renamed the agency nav item + page title "Manage Sub-Accounts" → **"Sub-Accounts"** (`ClientLayout.tsx`, `ManageClients.tsx`). The `[B]` field-access "decision" is a standing per-sub-account governance editor, not a build input (moved to BRENDAN_TODO).
- **F2 — UUID-native setter + inbound-only binding.** (a) Picker already UUID-native; the live default cadence `40e8bea3` and **every** workflow were verified already free of `Voice-Setter-N` slot strings → the data migration was a **no-op**. Added a defensive amber "legacy ref — re-select to migrate" signal in the `Engagement.tsx` picker (F2e). (b) New `voice_setters.is_inbound` boolean + partial unique index `voice_setters_one_inbound_per_client` (migration `20260625130000`, applied live). New `useSetInboundSetter` hook wired to the existing inbound toggle (`PromptManagement.tsx` / `DirectionsToggle`): toggling sets the flag (clears others), points `clients.retell_inbound_agent_id` at the setter's agent, and **auto-rebinds the live Retell inbound number** (`inbound_agents`) — Brendan's chosen behavior; reverts the toggle on failure; toggle now loads from `is_inbound` (the SoT). (c) Removed the per-setter `RetellPhoneNumberSelector` from `AgentConfigBuilder.tsx` and **deleted** the component; relocated phone-number import/management to the **API Credentials** page via the existing `RetellPhoneNumbersTab` (it already had Twilio import). Outbound from-number unaffected (`retell_phone_1` fallback stands).
- **F5 — n8n decommission.** The n8n code path was **already gone** (`processMessages.ts` throws if not on the native engine — no `else` branch survives). Railway shutdown → BRENDAN_TODO. The optional `clients.text_engine_webhook` column drop is **deferred** (it's wired into `clients_public`; dropping needs a coordinated view rebuild — not worth the risk for one inert column) → DEFERRED.
- **F6 — removed setup-guide quizzes.** Deleted `MultiAgentLogicStep.tsx`, `VoiceInboundLogicStep.tsx`, and the orphaned `QuizQuestion.tsx`; relocated the shared `QuizNavigationState` type to `setup-guide/quizNavigationState.ts` (still used by `VoiceOutboundLogicStep`). Removed the two step objects + imports from `SetupGuideDialog.tsx` and **renumbered** the positional step-ids + decremented the `SETUP_PHASES` counts (text 8→7, voice 7→6) so prompt-save completion still maps correctly.
- **F7 — deleted draft cadence `c206da3e`** (+ its **inert companion** `engagement_campaigns` row `326ea535`, which the FK required and which had 0 references anywhere despite a stale `status='active'`). Transactional delete via Mgmt API, verified gone.

## 2026-06-25 — Session 2 (security/quality sweep)

- **G3-1 (S2b-4) fail-closed on NULL `intake_lead_secret`** — was ALREADY fixed in `49a594e` (audit sweep 2026-06-23): both `voice-booking-tools` and `kb-ingest` now return 401 when the client's `intake_lead_secret` is NULL (stricter than asked — covers read tools too). It was simply never moved off `BUG_LIST`. No code change this session; closed here. The other Session-2 items (G3-2 disambiguation, G3-3 outcome-stamp guard, G3-4 status codes, G3-5 esbuild override, types.ts drift) are deployed and live in `TEST_LIST.md` pending Brendan's UI verification.

## 2026-06-25 — list/doc reconciliation session (with Brendan)

Closed:
- **Inbound neutral greeting (item 3 / 6.8 inbound)** — DONE. Verified live: the inbound number `+61481614530` answers on a dedicated **"Inbound BFD Agent"** (`agent_b2f6495`, LLM `llm_9dd6af7` v2) opening "Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital… What can I help you with?" (no `{{first_name}}`). Earlier confusion was a stale memory claiming inbound==outbound==`agent_f45f4dd`.
- **Trigger.dev call latency** — DONE. Root cause was a Trigger.dev region dequeue incident (platform/region), now resolved; not a concurrency cap.
- **6.8 greeting `{{first_name}}`** — DONE. Outbound personalizes ("Hey {{first_name}}, it's Gary…"), inbound is neutral. Both correct.
- **F10 rotate old anon key `awzlcmdomhtyqjabzvnn`** — DONE (Brendan).
- **6.13 GHL Supabase-secret custom fields** — VERIFIED-CLEAR (0/123 fields match).

Dropped (will not track):
- **New-setter "Joe's Diner" seed prompt** — Brendan won't onboard people this way; removed from all lists.

Decisions locked (drive the active BUG/FEATURE items):
- Setter name source-of-truth = the setter-edit-page name field (and the duplicate flow writes the same field). → B-1.
- STOP + inbound = internal-first by-phone, drop the GHL lookup. → B-2.
- Settings nav: client sees only "My Account"; admin sees "My Account" + "Sub-Accounts" (list → click → config). → B-4.
- Voice-setter model = one setter flagged inbound; outbound chosen at campaign/workflow level; no per-setter outbound binding (kills old 2.3). → F2.
- Cadence direction = the lifecycle system (3.5/3.6/3.7); flat 28-node draft `c206da3e` deleted. → DEFERRED (major).
- n8n to be decommissioned (F5); the setup-guide quizzes that teach the n8n/1prompt model to be removed (F6).
- GHL SMS-in-Conversations: drop the marketplace conversation-provider near-term; ship the deep-link custom field instead (F1).

Git hygiene: deleted all merged/stale local + remote branches on `origin` (Forgejo) and `github`; kept only `main` + `feat/cadence-v2-lifecycle-wip` (the lifecycle WIP). Removed the merged `internal-by-phone-leads` worktree.

> Prior shipped work (audit waves 2026-06-10/19/23, billing B1/B2, session-1 hardening, S6 features, clients_public boundary) is recorded in `Docs/ROADMAP.md` and the dated handoffs under `Operations/handoffs/`.
