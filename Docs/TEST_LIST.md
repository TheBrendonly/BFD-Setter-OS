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

## 🟠 MAIN-OUTBOUND-SHARED-1 — dedicated-agent restore (data fix 2026-07-07) — LIVE OUTBOUND CALL OWED

> Fixed as a comprehensive data migration: the WHOLE "Main Outbound" setter (85 slot-keyed rows across
> `prompts`/`agent_settings`/`prompt_configurations`/`prompt_docs`/`prompt_versions` + the `voice_setters`
> binding + the display label) was moved off the poisoned slot 1 to the free slot 10, and its agent restored to
> `agent_f45f4dd…` (`clients.retell_agent_id_10` set for durability). In the UI it is now the **"Main Outbound"
> tile at slot 10**; an EMPTY "Setter-1" tile also renders (the code always seeds slot 1) — leave it empty.
> DB read-back verified this session (Main Outbound and Inbound now distinct agents; nothing left at
> `Voice-Setter-1`; from-number binding intact). Root cause + emergency rollback SQL:
> `Operations/handoffs/2026-07-07-main-outbound-shared-1-fix.md`.

- [ ] **MAIN-OUTBOUND-SHARED-1 live** — place one real outbound dial as Main Outbound
  (`node scripts/test-harness/dial.mjs` — its default target IS Main Outbound, `b09624b5`). Confirm: (a) the
  Retell call record shows `agent_id = agent_f45f4dd87a4072424f3c84b74c` (NOT `b2f6495`); (b) the answered
  opener personalizes with the lead's first name and states the call's purpose ("…you put your hand up for
  some info…"), i.e. the PU-3/PU-7 symptoms are gone; (c) booking still works end-to-end (B-3/B-5 survive).
  **Then re-Save (report-only, Brendan):** re-Save the **Main Outbound tile (now slot 10)** to reassert its own
  prompt + VM-1/API-DEPR-2 presets onto `f45f4dd`, and re-Save Inbound BFD Agent (slot 8) to scrub any
  Main-Outbound config the 2026-07-01 save had pushed onto `b2f6495`. **⚠️ Do NOT create/save a setter on the
  empty "Setter-1" tile** — saving slot 1 re-reads `retell_inbound_agent_id` (b2f6495) and would re-create the
  collision (residual DEFERRED SLOT-MAP-1).

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
- [ ] **F14 — invite E2E (AFTER Resend SMTP lands).** ManageClients → edit a sub-account → "Invite Sub-Account User by
  Email" → invite a test address → email arrives from the branded sender → link lands on "Set Your Password" → a password
  under 12 chars is refused → set a valid one → sign in works, role=client, correct client_id routing.
- [ ] **F14 — client self password reset.** /forgot-password with a client-role email now sends the reset (no more
  "Not Authorized"); the reset form enforces 12 chars; agency reset still works.

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
