# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. Brendan runs these **after all build + UI work is done** (his call, 2026-06-25).
When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`. When it fails, open a bug in `BUG_LIST.md`.

> **▶ To EXECUTE this list in the fewest live runs, use `Docs/TEST_SESSION.md`** (say "run test session"). This file
> stays the itemized SOURCE OF TRUTH for pass/fail; `TEST_SESSION.md` is the consolidated runbook that batches these
> items by physical action (one voice call, one SMS thread, one agency↔client login, etc.). Keep them in sync.

> **Full re-audit 2026-07-07 (Session P1):** every row below was cross-checked against the live DB/edge-fn state,
> git log, and the dated handoffs. ~20 rows that had already passed (some days earlier) but were never physically
> archived have been moved to `Docs/archive/COMPLETED_LOG.md` — see `Operations/handoffs/2026-07-07-p1-audit-reconciliation.md`
> for the full audit table. What remains below is genuinely still owed.

> **⭐⭐⭐ VOICE + BROWSER TEST SESSION — 2026-07-06, and the 2026-07-05 TEST SESSION before it — ALL PASSED → `COMPLETED_LOG.md`.** Full detail there + handoffs `Operations/handoffs/2026-07-06-voice-browser-session.md` + `2026-07-05-test-session.md`. Between the two, essentially every pre-existing bug/feature check passed (onboarding-fix cluster, the shared-fn pass, F8/F9-1/F11/UI-1/F13 core/PROMPT-LINT-1/MODEL-1/API-DEPR-1 core/PROMPT-AUTH-1 X-Ray, the B-2 outage leg, G3-7 nav, SWEEP-1a/b/c). What's below is either (a) the still-open behavioral checks for the 2026-07-07 combined build, or (b) a small residual set of finer-grained checks that genuinely haven't run yet.

## 2026-07-12 BRENDAN test session — verified PASS + 3 new bugs

> Driven via the harness (headless Playwright + signed inbound-SMS sim + service-key Retell dials) with Brendan on
> the live phone/SMS/browser legs (2 TOTP). **PASS this session (→ COMPLETED_LOG):** F8 panel render, F13 margin
> card (agency), F15 show-rate funnel render, API-DEPR-1 Agents tab, CHATS-DM-1 (no `dm_executions` 400), UI-1
> labels; SMS BOOK-1 offer + booking-completes + SMS-OBS-1 + MODEL-1 + BOOK-3 day-map; B-5 (unknown caller, no name,
> no literal `{{first_name}}`) + Inbound recording-disclosure; VM-1 voicemail detection (`voicemail_reached`);
> linked-lead voice booking (ok:true + real appt + honest confirm); F16b outside-hours dial-defer (data-verified vs
> `businessHours.isWithinSendingWindow`=false on Sunday, next opening Mon 09:02). **NEW FAILS → BUG_LIST:**
> BOOK-VOICE-FABRICATE-1 (High), BOOK-ABORT-GHOST-1 (High, frozen), LEADREACT-CRASH-1 (Med); **prompt items →
> PROMPT_UPDATE_LIST:** PU-14 (booking tool-gate), PU-6 re-verify (recording disclosure on Main Outbound). **Still
> OWED** (need live SMS/voice or a weekday): F16b inside-hours 60s-call, SMS STOP mid-exchange, MODEL-1-HARDENING
> backend, F9V2-1/2 (locked setter), FOLLOWUP-DURING-CALL-1, RESCHED-SMS-1, PURGE-SIM-1, G3-8a, HOURS-1 (a/d)
> behavioral, PURGE-TAG-1, B-2 deterministic GHL pick. Full detail:
> `Operations/handoffs/2026-07-12-brendan-test-session.md`.

## 2026-07-12 autonomous build session — owed live behavioral checks

> All items below were BUILT + DEPLOYED + server-side/live-verified this session (see
> `Operations/handoffs/2026-07-12-autonomous-build.md` for live versions). What remains is a per-item BEHAVIORAL
> confirmation. Pass -> `COMPLETED_LOG.md`; fail -> `BUG_LIST.md`.

- [ ] **LEADREACT-CRASH-1 render** — open `/client/<id>/lead-reactivation` (dogfood): renders the totals (TOTAL
  SENDS / RESPONSES / POSITIVE / BOOKINGS / CLIENTS + rates) with NO console TypeError, not a white screen.
- [ ] **INTAKE-RL-1 burst-429** — >60 signed intake-lead requests in 60s for one client return 429 + Retry-After
  once over the limit (use a throwaway client whose first cadence node is NOT an SMS delay-0, to avoid real sends).
- [ ] **BOOK-TZ-DISPLAY-1 cross-tz SMS** — with a lead whose `leads.timezone` differs from the business tz, the SMS
  setter offers/confirms a time in BOTH zones using the deterministic table (no wrong "your time" arithmetic).
- [ ] **BOOK-CONFIRM-HONESTY-1 forced-failure** — force a book-appointments failure over SMS; the reply is the
  honest holding message, NOT a false "you're booked". (No-misfire on a real booking already confirmed live.)
- [ ] **SEC-PII-LOGS-1 log spot-check** — trigger an outbound-call / DM / webinar-match and confirm the platform
  logs show redacted phone/email (`***1234`, `j***@domain`), not raw values.
- [ ] **F23 live digest** — after real errors accrue in a 24h window (or a manual test run), the error-digest posts a
  Slack rollup (PROBE_ALERT_WEBHOOK_URL); email only when RESEND_API_KEY + ERROR_DIGEST_RECIPIENT are set.
- [ ] **SCHED-1(b) parked probe** — the next hourly synthetic-probe run that parks outside the send window records
  `passed=true` (`raw.stage="skipped-parked"`), not a false FAIL, and posts no Slack alert.
- [ ] **B2-REPOINT-1 outage convergence** — stage a lingering `bfd-<phone>` lead (GHL-outage sim), then send a normal
  inbound after GHL recovers; the lead converges to its real GHL contact id (rows repointed), reply not dropped.

## 2026-07-11 (evening) test session — verified PASS (→ COMPLETED_LOG)

> Driven autonomously via the harness + one TOTP. **PASS this session:** PURGE-UI-1 (14 routes render clean,
> no n8n/Skool/1prompt), **PURGE-UI-2** (fixed the 4 broken redirects first — commit `043e62d` — then verified
> they land on the real setup pages; also purged dead Converteai preloads), PURGE-SYNC-1 + SYNC-LOG-1 (sync log
> rows with labeled steps + echo-skip), COST-1 (morning call voice cost row), COST-4 (client-role blocked),
> MAIN-OUTBOUND answered leg + API-DEPR-2(b), GETCALL-1, CONTACTS-EDIT-DEAD-1, INB-1, B-2 CSV normalized_phone
> (after the B2-CSV-NORM-1 fix, process-lead-file v18) + inbound internal-first + B-2 outage leg, G3-6 Tier-3
> (5 fns 200), G3-6-SCHEMA-1 (analytics-v2-process 200, gate cleared), F13/F15 client-eye, P3-CLEANUP-1.
> **Still owed** (need live SMS/voice or a gated dep): the SMS multi-turn cluster, HOURS-1, FOLLOWUP-DURING-CALL-1,
> RESCHED-SMS-1, LIVE-D, B-5, PURGE-SIM-1, MODEL-1-HARDENING backend leg, F16/F17 (flags OFF), F14 (Resend),
> F9V2 (needs a locked setter; schedule now registered so it fires hourly), COST-2/3 (need a cadence send),
> PURGE-TAG-1 (needs a real GHL tag-apply). New bugs → SCHED-1, B2-REPOINT-1 in `BUG_LIST.md`. Full detail:
> `Operations/handoffs/2026-07-11-combined-bundle-test-gatea.md`.

## Branding purge (2026-07-10) — live-verify

> Frontend restructure + 7 edge fns redeployed (all boot-smoked 400, tsc/build/253 tests green). Full context:
> `Operations/handoffs/2026-07-10-branding-purge.md`. These are the browser/behavioral confirmations owed.

- [ ] **PURGE-UI-1 — setup-guide surface renders after the 5-phase excision.** In the agency browser: open
  Text Setter → Configuration (5 phase cards, no n8n/Workflows-Import/Knowledgebase cards; each card opens the
  right dialog phase), Voice → Configuration (3 cards: Twilio / Accounts / Prompts), Deploy AI Reps guide, and
  the WhatToDo checklist (7 steps, no Skool card; wizard progress bars sane, no NaN/0-of-0). Check the browser
  console for errors while flipping through dialog phases.
- [ ] **PURGE-UI-2 — removed routes redirect, not 404/crash.** Hit `/client/<id>/text-ai-rep/templates`,
  `/voice-ai-rep/templates`, `/api/workflow-imports` directly → each lands on the setup page. Source Files page
  shows only GHL snapshot + Supabase schemas cards.
- [ ] **PURGE-SIM-1 — simulator still runs end-to-end** (run-simulation v21 + generate-simulation-personas v21):
  generate personas, run a short simulation; new dummy leads are `bfd-simulation-*@gmail.com`; OpenRouter calls
  succeed with the new attribution headers.
- [ ] **PURGE-SYNC-1 — GHL contact echo-guard roundtrip unchanged** (sync-ghl-contact v29 + push-contact-to-ghl
  v10): edit a lead field in the BFD UI → lands in GHL; the echo webhook back is SKIPPED (sync log shows the
  echo-guard skip, steps now labeled "Find Lead in BFD"); a real GHL-side edit still syncs in.
- [ ] **PURGE-TAG-1 — try-gary tag still routes** (ghl-tag-webhook v14): apply a legacy `1prompt-try-gary-<style>`
  tag to a test contact → agent_style/source_type derive as before; a `bfd-try-gary-<style>` tag behaves identically.

## Overnight deep-work pass (2026-07-08) — live-verify — ALL CLOSED 2026-07-11

> **RLS-UISTATE-1-LIVE, QH-TZ-1-LIVE, OPTOUT-EDGE-STAGED all verified 2026-07-11 → `Docs/archive/COMPLETED_LOG.md`.**
> (Client-role probe: sibling insert 403 / cross-client select []; agency no lockout. QH-TZ junk-tz → fallback, no
> RangeError. 5 edge-optout consumers redeployed ACTIVE.) **F16C-SMS-1-LIVE** is gated on arming
> `retell_webhook_secret` → moved to `Docs/FIRST_CLIENT_TASKS.md` (GATE B).

## Session P3 cleanup (2026-07-07) — live-verify

- [ ] **P3-CLEANUP-1 — client dashboard/sidebar still loads after the ClientLayout dead-branch removal.**
  P3 removed the dead `presentation_only_mode` redirect branch + the now-unused `Outlet` import / select field
  from `ClientLayout.tsx` (0 clients had the flag live; the route target was already deleted in G3-8(b); tsc +
  vite build green). Railway rebuilds on `git push github`. Smoke: open a client → dashboard + sidebar render
  normally (no blank page, no console error). Low risk, quick confirm.

## Session P2 build (2026-07-07) — deferred pull-forward live-verify

Code + unit tests + read-only data-path checks all done + deployed (see `COMPLETED_LOG` 2026-07-07 P2).
These are the LIVE behavioral confirmations still owed (most are dormant until a real trigger exists):

> **COST-1 / COST-2 / COST-3 (need real client call/SMS/LLM traffic to accrue) → moved to `Docs/FIRST_CLIENT_TASKS.md`.**
> COST-4 (RLS, testable now with a throwaway client) stays below.

- [ ] **COST-4 — RLS.** Agency JWT can SELECT `execution_cost_events`; a client-role JWT canNOT (role-gate,
  like `client_pricing_config`). (Policy mirrors the proven F8 trap; confirm with a throwaway client user.)
- [ ] **F9V2-1 — first live scheduled drift poll.** Confirm the hourly `poll-retell-drift` Trigger.dev task
  runs clean in prod (Version 20260707.1). With a genuinely-locked setter, confirm a real drift sets the tile
  badge + an `error_logs` row (source `trigger.pollRetellDrift`) without opening PromptManagement. (Full data
  path already verified 2026-07-07 via a controlled lock of Property Coach; this is the deployed-schedule
  confirmation.) NOTE: a REAL drift exists right now — Property Coach's live agent is v17 vs synced v13 — but
  it is UNLOCKED (demo persona), so it won't flag until locked.
- [ ] **F9V2-2 — badge clears on pull.** After a drift is flagged, a Pull-from-Retell (or unlock) clears the
  `Drifted · pull` / `Booking tools missing` badge (flags nulled). (Verified via replica; confirm in the UI.)
> **BOOKTZ-1 (needs a real interstate lead segment) → moved to `Docs/FIRST_CLIENT_TASKS.md`.** Voice half also needs PU-13.

> **🟠 MAIN-OUTBOUND-SHARED-1 — FULLY CLOSED 2026-07-11.** Routing + personalization leg passed 2026-07-07; the
> answered-conversation leg passed 2026-07-11 (a live answered booking call dialed as `agent_f45f4dd…` and booked
> end-to-end, GHL appt 14 Jul 1:30pm) → `Docs/archive/COMPLETED_LOG.md`. Residual architectural follow-up = SLOT-MAP-1
> in `BUG_LIST.md` (do NOT create/save a setter on the empty "Setter-1" tile).

## ⭐⭐⭐ COMBINED BUILD SESSION (bugs + F15 + F16 + F17-p1) — DEPLOYED LIVE 2026-07-06/07 — LIVE CHECKS OWED

> All built + deployed (12 commits `8950f69`..`7a0b0b4`; 4 migrations applied; edge fns bookings-webhook v9 /
> get-show-rate-funnel v1 / get-weekly-report v1 / make-retell-outbound-call v28 / retell-inbound-webhook v7 /
> retell-call-webhook v22; Trigger 20260706.1 / 13 tasks; frontend pushed → Railway). test:node 147, test:edge 227.
> Handoff `Operations/handoffs/2026-07-07-combined-build-bugs-f15-f16.md`. Every F16/F17 new behaviour is behind a
> per-client flag defaulting OFF, so nothing dials/texts differently until a client is opted in. Re-verified live
> 2026-07-07 (Session P1): all 21 listed edge fns/versions below are ACTIVE and match; all F15/F16/F17 schema
> (tables + `clients` flag columns, all defaulting `false`) is live. Nothing here has been behaviorally verified yet.

**Phase A bugs (behavioural):**
- [ ] **CHATS-DM-1** — open `/chats`; no `dm_executions ... messages` 400; recent-outbound previews render.
- [ ] **HOURS-1 (a)** — an out-of-hours setter follow-up / nudge DEFERS to the next opening (no midnight text).
- [ ] **HOURS-1 (d)** — a brand-new lead enrolled OUT of hours gets the instant "first thing in the morning" SMS immediately; the call defers into hours.
- [ ] **FOLLOWUP-DURING-CALL-1** — a follow-up/nudge is suppressed while the lead is on a live voice call.
- [ ] **RESCHED-SMS-1** — over SMS the setter no longer false-confirms a reschedule/cancel (says it's checking / re-lists instead).
- [ ] **CONTACTS-EDIT-DEAD-1** — select exactly one contact → the Edit button appears + the dialog saves (normalized_phone recomputed).

**F15 ROI visibility:**
- [ ] **F15 funnel** — after the GHL appointment-status workflow is provisioned (BRENDAN_TODO), flip one real booking confirmed→showed in GHL and watch the dashboard funnel row update (booked/held/no-show).
- [ ] **F15 report** — on the dogfood client, generate a weekly report + view it via ReportSettingsCard "Preview latest report"; sections respect the toggles; email stubbed until Resend.
- [ ] **F15 client-eye** — with the visibility toggles on, a client-role login sees only its own funnel/report (agency-only data never leaks).

**F17-p1 compliance (Voice-gated):**
- [ ] **AU hours clamp** — an AU cadence dial/SMS scheduled for outside 9-8 weekday / 9-5 Sat / Sunday / a public holiday DEFERS to the next legal opening.
- [ ] **Recording disclosure** — enable the toggle + add the PU-6 line to the prompt → a live call opens with the disclosure; disabled → silent.

**F16 never-miss-a-lead (Voice-gated; enable on dogfood first — BRENDAN_TODO):**
- [ ] **F16(b) speed-to-lead** — with the flag on, a new GHL lead inside the legal window gets an AI call within ~60s; outside hours gets the instant SMS instead.
- [ ] **F16(c) missed-call text-back** — with the flag on, hang up on an inbound call quickly → an SMS-back arrives within ~60s and enters the SMS booking flow; a second quick call within 15 min does NOT double-text.
- [ ] **F16(d) live-transfer** — set a transfer number in the VoiceRetellSettings tools editor for a setter, add the PU-11 line to the prompt → a lead asking for a human is transferred to that number.

## ⭐ F13/F14 (usage & billing + auth) — DEPLOYED LIVE 2026-07-03; core math + 3 of 4 F13 UI checks PASSED 2026-07-05

> Deployed 2026-07-03 (results in `Operations/handoffs/2026-07-02-usage-billing-auth.md`). Both trap
> proofs passed 9/9 live and the SQL hand-check matched exactly. The 2026-07-05 TEST SESSION RUN 1 live-verified
> the margin panel, the period/anchor browsing, and the 4-toggle client-visibility flip against a SQL hand-check
> (→ `COMPLETED_LOG.md`) — only the dashboard-summary-card check (both roles) and the two Resend-gated F14 email
> items remain open.

- [ ] **F13 — dashboard summary card, both roles.** Your agency login sees the margin one-liner on the client's
  ChatAnalytics dashboard (text + voice tabs, not chat-with-ai); the client login sees only toggled parts.

> **F14 invite E2E + F14 client self password reset are Resend-SMTP-gated → moved to `Docs/FIRST_CLIENT_TASKS.md`.**

- [ ] **F8 — agency panel + client card.** Agency login → Sub-Account Config → "Cost-to-Price Calculator": edit
  rates/FX/markup/toggles, Save, reload → persists; the live breakdown + blended $/min match a hand-check of the seeded
  figures (Retell $0.07 + LLM $0.003 = $0.073 USD × FX × (1+markup), Twilio OFF, number rental a separate fixed line).
  Turn **show rate to client** ON → log in as that client → AccountSettings shows a read-only "Your Rate $X.XX /min (AUD)"
  card with NO breakdown/markup; toggle OFF → the card disappears. (The trap — client cannot read markup via the API —
  is already proven 9/9; this is the UI behavioral check.)

## Go-live smokes

- [~] **bug-sweep UI** — 6.1 + 6.3-visual already PASS (→ COMPLETED_LOG). **Still owed → LIVE-D:** the **manual SMS send + 429-retry** (real text from the UI; confirm it sends and a 429 path retries).

## Reliability

- [ ] **B4 send-idempotency** — induce a Trigger retry on a real cadence SMS → confirm **no double-send** end-to-end (unit + DB-level proof already done). _Call-side send-once verified live 2026-06-30 (exactly one dial); the SMS-retry-idempotency leg stays here (inducing a live Trigger retry manually is impractical)._

## Session 5 — by-phone pivot / B-2 (shipped 2026-06-26: receive-twilio-sms v29, process-lead-file v14, migration 20260627120000 applied; NO Trigger redeploy)

> Most of B-2 was already live from Spec 1. Session 5 added: (1a) deterministic GHL pick on the inbound fallback, (1b/1c) resilient miss-path (mint `bfd-<phone>` internal lead + background repoint), and (2) the CSV-import `normalized_phone` fix + backfill. **The outage/resilience leg (1b/1c) live-confirmed 2026-07-05 RUN 6 → `COMPLETED_LOG.md`.** The other three checks are still genuinely owed. _Claude drives the GHL-outage sim: set a bad `ghl_api_key` via Mgmt API, then restore the real `pit-…` value._

- [ ] **B-2 CSV `normalized_phone`** — import a CSV with an AU phone (e.g. `0405482446`) → the new `leads` row has `normalized_phone='+61405482446'` (Mgmt API). Then an inbound SMS from that number resolves **internal-first** (no new GHL contact minted, no second `leads` row); `receive-twilio-sms` logs `internal lead resolved by normalized_phone`. Also: a UI STOP on that CSV lead now fans out by phone (it was previously invisible to the fan-out).
- [ ] **B-2 background repoint converges, no dup** — after a GHL-outage inbound mints a synthetic `bfd-<phone>` lead, restore GHL and send one more inbound (or wait for the same-request reconcile) → the synthetic row's `lead_id` becomes the real GHL contact id; `message_queue`/`dm_executions`/`active_trigger_runs` for that thread now key off the real id; a later `sync-ghl-contact` webhook **UPDATEs** (no 2nd `leads` row). Spot-check: `select client_id,lead_id,count(*) from leads where lead_id like 'bfd-%' group by 1,2 having count(*)>1` → 0 rows.
- [ ] **B-2 deterministic GHL pick** — for a phone that has >1 GHL contact (if you can stage one), repeated inbound sends resolve to the **same** (most-recently-updated) GHL contact every time — no flapping.

## Session 6 — secret-read hardening / G3-6 (shipped 2026-06-26: analyze-metric v18, analytics-v2-suggest-widgets v14, get-openrouter-usage v1 NEW, get-chat-history v7)

> Defense-in-depth: ~20 browser flows now read presence-only or route through an edge fn. Verified at ship: tsc/build/deno green, all 4 fns ACTIVE. **Q2 decision (2026-06-30): test everything now** — Claude to discover BFD's external chat table + set `clients.supabase_table_name` (currently null) before the live re-test.

- [ ] **G3-6 analytics features still work (Tier 3).** With BFD (external Supabase + OpenRouter configured): **ChatAnalytics** time-series renders over a date range (via `get-chat-history` mode:range), **Contacts** last-interaction timestamps populate (via `fetch-thread-previews`), **custom-metric AI analysis** returns matches (via `analyze-metric` server-side), **AnalyticsV2 / CreateMetricDialog** widget suggestions work (via `analytics-v2-suggest-widgets`), and the **OpenRouter usage** panel loads (via `get-openrouter-usage`). _Partial coverage already confirmed 2026-07-05 (chat_history 250 rows, timestamp range OK) — the remaining sub-checks (widget suggestions, OpenRouter usage panel) still want a browser pass._

## Overnight frontend-only build — INB-1 (shipped 2026-06-29; frontend-only, NO edge deploy)

> Cosmetic/polish + one binding fix. Hard-refresh app.buildingflowdigital.com first. (F11 masked-indicator + UI-1 plain-labels from this same build both PASSED 2026-07-05 → `COMPLETED_LOG.md`.)

- [ ] **INB-1 inbound rebind pins `latest_published`** — use the inbound toggle to move the inbound setter, then check the Retell inbound phone binding: `inbound_agents[].agent_version` is now `"latest_published"` (not versionless / not a numeric pin), so inbound auto-follows future publishes.

## Session 7.5 — overnight Text-Setter repair + all-bugs (residual checks)

- [ ] **MODEL-1-HARDENING — invalid model degrades, never 400s.** In a throwaway client (NOT BFD), set `clients.llm_model` to a bad value (`gemini-flash-latest` or `gptjunk`) via Mgmt API → an SMS still gets a reply (alias remaps / no-slash falls back to the default; no 400). Restore. (Do NOT touch BFD's `clients.llm_model`.) _(This is the backend/SMS leg specifically — the UI "unknown model id" leg already PASSED 2026-07-05 → `COMPLETED_LOG.md`.)_
- [ ] **G3-8(a) — reactivation webhook fires server-side, no browser secret.** On a reactivation campaign, click **execute lead** → the webhook fires + the lead row reaches `completed`; in the browser Network tab the request goes to `execute-lead-webhook` (Supabase fn) and **no** `supabase_service_key` appears in any browser payload. A failure marks the row `failed` with the error.

## Retests after the relevant fix ships

- [ ] **B-5 / `{{first_name}}`** — a real inbound call from a number **NOT** in the CRM → the agent omits the name and never says the literal `{{first_name}}`. (NB: TEST_PHONE_A is a known lead, so B-5 needs a genuinely unknown number.)

## PROMPT-AUTH-1 — Text-setter prompt authoring/visibility rebuild — CORE CLOSED 2026-07-07 → `COMPLETED_LOG.md`; residual checks below blocked on the Setter-1 migration

> Root-caused live in Session 7-finish (2026-07-03): the Text setter refused a genuinely-open Monday (hidden
> `Available days: Tue/Wed/Thu ONLY` rule buried in the ~1680-line stored prompt) and then booked **Friday 4pm**
> for an accepted **"Thursday 2pm"** (un-interpolated `{{ $now }}` → no real "today" anchor). DEPLOYED LIVE
> 2026-07-03; the live SMS regression + the **Full-prompt-visibility X-Ray check both PASSED** (2026-07-03 live
> regression + 2026-07-05 RUN 1 respectively) → the BUG_LIST entry closed to `COMPLETED_LOG.md` 2026-07-07.
>
> Still open below — both **BLOCKED on Brendan applying the Setter-1 content migration** (`BRENDAN_TODO.md`;
> report + proposed replacement at
> `Docs/investigations/prompt-migration-reports/e467dabc-57ee-416c-8831-83ecd9c7c925_Setter-1.report.md`).
> **Calendar-sourced availability** and **Date/time accuracy** were reported passed via the 2026-07-03 live
> regression (Wed 8 Jul offer, no fabricated day restriction, exact booked time) — a quick spot-check is fine,
> not a full re-run, unless something looks off.

- [ ] **No leftover artifacts** — no `{{ … }}` n8n expressions, no duplicated/contradictory sections, and the
  tool names referenced in the prompt match the real tools (`get-available-slots` / `book-appointments`).
  **BLOCKED on Brendan applying the Setter-1 migration** (`BRENDAN_TODO.md`).
- [ ] **Efficiency** — the assembled prompt is materially leaner; tool-calling + date accuracy hold on the fast
  model (`google/gemini-2.5-flash`). **BLOCKED on the Setter-1 migration landing** (current stored prompt is
  still the un-migrated 1680-line version until Brendan applies it).

## Overnight part-2 additions — retest AFTER deploy

- [ ] **API-DEPR-1 — v2 list-agents serves the UI.** VoiceAIRepSetup → Agents tab lists the agents with full detail
  (name/version/published/engine — hydrated via get-agent, one row per agent instead of legacy version-expanded
  rows); API Credentials → Verify shows Retell "Connected"; Retell dashboard deprecation notice stops firing on
  the next sweep. _(The underlying `v2/list-agents` call itself is live-confirmed working (200, re-verified
  2026-07-07); this row is the remaining UI-presentation + notice-monitoring check.)_

## 2026-07-05 BUILD PASS retests

- [ ] **SYNC-LOG-1: intake audit persists.** Trigger a `sync-ghl-contact` intake → one `sync_ghl_executions` row is
  written (client_id, external_id, status, steps). (Was silently no-oping on a missing table; table confirmed live
  2026-07-07.)
- [~] **G3-6-SCHEMA-1: analytics still run.** _Partly verified 2026-07-06: `analytics-v2-process` (service key) cleared its config gate for BFD (asks for a widget, NOT "configuration incomplete"/400 on the de-overloaded column), and the code hardcodes `chat_history` (v19 live, confirmed by reading the fn). `analyze-chat-history` needs a user JWT (the harness agency token expired), so the full analytics render is left to a browser run._ Run chat analytics for BFD (Analytics V2 / analyze-chat-history) →
  reads the external `chat_history` and returns results unchanged (column was null; now hardcoded). Deployed
  analyze-chat-history v19 / analytics-v2-process v19 / compute-analytics v16.

## Standing rule

- After **any** BUG or FEATURE ships, smoke the touched area before marking it done here.
