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

- [ ] **BOOK-CONFIRM-HONESTY-1 — dedicated forced-failure.** Force a `book-appointments` failure over SMS (throwaway
  client) → the reply is the honest holding message, NOT a false "you're booked". (The mechanism is already
  evidenced live: RESCHED-SMS-1 passed 2026-07-21 with the honest "wasn't able to make that change" reply; this is
  belt-and-braces on the booking-specific path.)
- [ ] **PURGE-SIM-1 — simulator end-to-end** (run-simulation v21 + generate-simulation-personas v21): generate
  personas, run a short simulation; new dummy leads are `bfd-simulation-*@gmail.com`; OpenRouter calls succeed with
  the new attribution headers.
- [ ] **PURGE-TAG-1 — try-gary tag still routes** (ghl-tag-webhook v14): apply a legacy `1prompt-try-gary-<style>`
  tag to a test GHL contact (Claude can do this via the GHL API) → agent_style/source_type derive as before; a
  `bfd-try-gary-<style>` tag behaves identically.
- [ ] **F15 funnel — status transition reaches the dashboard.** Flip a real booking confirmed→showed in GHL (the
  status workflows are verified live as of 2026-07-21: BOOKED + CANCELLED both flowed) → the dashboard funnel row
  updates (booked/held/no-show). Claude-drivable via the GHL API + a booking fixture.
- [ ] **F15 report — generate + preview.** On the dogfood client, generate a weekly report + view it via
  ReportSettingsCard "Preview latest report"; sections respect the toggles. (Email leg stays Resend-gated →
  `FIRST_CLIENT_TASKS.md`.)
- [ ] **F9V2-1/2 — locked-setter drift flag + badge clear.** Deliberately Retell-lock a setter (config write, not
  prompt content) → the hourly `poll-retell-drift` flags a real drift (`retell_drift_detected_at` + `error_logs`
  row) → the tile badge shows → a Pull-from-Retell/unlock clears it. (The schedule itself is registered + firing —
  verified 2026-07-21. Property Coach has a real v17-vs-synced-13 drift but is unlocked, so it correctly won't flag.)
- [ ] **B2-REPOINT-1 — outage convergence.** Stage a lingering `bfd-<phone>` lead (GHL-outage sim: break/restore
  `ghl_api_key`, pre-authorized in the TEST_SESSION rules), then send a normal inbound after GHL recovers → the lead
  converges to its real GHL contact id (rows repointed), reply not dropped.

## Needs a browser session (2FA code from Brendan at the start)

- [ ] **F8 — agency panel edit-persist + client rate card.** Sub-Account Config → Cost-to-Price Calculator: edit
  rates/FX/markup/toggles, Save, reload → persists; blended $/min matches a hand-check. Flip **show-rate-to-client**
  ON → a client-role login sees the read-only rate card (no breakdown/markup); OFF → gone. (Panel render + the
  server-side trap are already proven; this is the edit/persist/toggle behavioral leg.)
- [ ] **F13 — dashboard summary card, both roles.** Agency login sees the margin one-liner on the client's
  ChatAnalytics dashboard (text + voice tabs); a client login sees only toggled parts.
- [ ] **G3-8(a) — reactivation webhook fires server-side, no browser secret.** Execute-lead on a reactivation
  campaign → row reaches `completed`; the browser Network tab shows the request going to `execute-lead-webhook`
  with NO `supabase_service_key` in any browser payload; a failure marks the row `failed`.
- [ ] **G3-6 residual — analytics browser sub-checks.** CreateMetricDialog widget suggestions
  (`analytics-v2-suggest-widgets`), the OpenRouter usage panel (`get-openrouter-usage`), and a full
  analyze-chat-history / AnalyticsV2 render for BFD (the G3-6-SCHEMA-1 browser leg). Everything else in G3-6
  passed 2026-07-11.

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
