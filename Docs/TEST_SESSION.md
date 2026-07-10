# BFD-Setter — TEST SESSION (consolidated runbook)

**Trigger:** when Brendan says **"run test session" / "let's run test session" / "test session"**, read this
file and execute it top to bottom. This is the single consolidated runbook for the live TEST pass.
**Model:** Opus 4.8 [1m] · **Thinking:** HIGH · **Mode:** execute (NOT plan).

`Docs/TEST_LIST.md` stays the **source of truth for pass/fail bookkeeping** (item names below match it 1:1).
This file is just HOW to clear those items in the fewest physical actions. When an item passes → move it to
`Docs/archive/COMPLETED_LOG.md`; when it fails → open a bug in `Docs/BUG_LIST.md`. Close out per the Relay
Protocol in `Docs/SESSION_PLAN.md` and emit the next prompt (see the end).

---

## Rules (every run)

- Repo `/srv/bfd/Projects/bfd-setter`. Supabase ref `bjgrgbgykvjrsuwwruoh`. Creds in `./.env`
  (`SUPABASE_PAT`, `TRIGGER_DEPLOY_PAT`, `BFD_RETELL_API_KEY`). Live DB via Supabase Management API
  `/database/query` (browser UA, NOT the postgres MCP). Live Retell via `api.retellai.com`.
- **NEVER edit voice OR text prompt CONTENT** (report-only; Brendan applies via the BFD setter UI). The prompt
  AUTHORING SYSTEM / engine code is in scope; `voice-booking-tools` is a FROZEN shared baseline (do not edit).
- **Verify read-only before claiming done.** No em dashes.
- **Nothing here needs a deploy** — the overnight bug-fix branch (Session 9), API-DEPR-1, API-DEPR-2 (retell-proxy
  v49), and G3-7 vite-8 (Session 10) are ALL already deployed live. This session is pure VERIFICATION. If a check
  regresses on a Voice-gated fn, roll THAT piece back (`scripts/deploy_single_fn.mjs`) and log it; do not deploy
  anything new without Brendan's explicit GO.
- **Claude write-actions authorized (test infra; REVERT after):** `clients.timezone` (F4), `clients.supabase_table_name`
  (G3-6), `clients.ghl_api_key` break/restore (B-2 outage sim), and a bad `clients.llm_model` on a THROWAWAY client
  (MODEL-1-HARDENING; never BFD's). **CRM cleanup of `+61405482446` (TEST_PHONE_A) = gated confirm with Brendan FIRST.**
  Everything else is report-only.
- **TEST_PHONE_A** `+61405482446` = free use (but it is a KNOWN CRM lead → B-5 needs a genuinely unknown number).
  **TEST_PHONE_B** `+61403804263` = wife's phone, ASK before each use. `.env` Twilio creds are STALE (live acct in DB).

---

## RUN 0 — Self-verify state (no live actions; do this FIRST)

Multiple parallel sessions have touched this repo. Do NOT trust doc git-logs / test-counts / versions — re-check:
- `git branch -a`, `git log --oneline -15 main`, `git status` (expect clean `main`).
- Re-run `npm run test:node` and `deno test --no-check frontend/supabase/functions/` (expect all green; API-DEPR-2 added 6 tests → 208 edge).
- Confirm live fn versions via Mgmt API: **retell-proxy v49**, save-external-prompt v15, verify-credentials v3,
  get-external-prompt v1, get-client-usage v1, get-blended-rate v2; **Trigger.dev 20260703.2**.
- Confirm the live prod frontend bundle is current (grep a live JS chunk for a recent-code string, not the entry hash).

---

## RUN 1 — Browser: ONE agency-login + ONE client-login pass (no phone; biggest batch)

Log in as the agency, do all the agency-side checks, then log in as the client once and do the client-side checks.
**Also re-Save one voice setter here** (sets up the API-DEPR-2 get-agent check in RUN 2).

Clears these TEST_LIST items:
- **F8 — agency panel + client card** (edit rates/FX/markup/toggles, Save, reload persists; hand-check blended $/min;
  show-rate-to-client ON → client AccountSettings shows the read-only rate card, OFF → gone).
- **F13 — agency margin panel vs SQL hand-check** (Sub-Account Config → Usage & Billing; hand-check one month via the
  Mgmt API SQL in TEST_LIST).
- **F13 — client toggle matrix** (flip each of the 4 visibility toggles; log in as client each time; all-off → nothing).
- **F13 — dashboard summary card, both roles.**
- **F13 — period browsing + anchor** (set anchor day, browse prior periods, anchor 31 on a short month clamps).
- **INB-1 — inbound rebind pins `latest_published`** (toggle inbound setter; check the Retell inbound phone binding
  `agent_version:"latest_published"`).
- **UI-1 — plain setter labels** ("Setter 1..4", no direction suffixes; custom names still save/push).
- **F11 — masked "Configured" indicator** (dot-mask placeholder; blank-save guard; Supabase PAT + OpenRouter Mgmt Key
  read "(Optional)", no red pulse).
- **MODEL-1-HARDENING (UI)** — unknown model id needs an explicit "Use anyway"; a mixed-case KNOWN id saves the
  canonical lowercase slug.
- **PROMPT-LINT-1 — lint bypasses closed, on the RIGHT store** — save text content with `BookAppointment` /
  `GET_AVAILABLE_SLOT` / a `Mon-Fri` day-restriction → BLOCKED with the offending line; the same `Mon-Fri` typed into
  **Follow-up Instructions on AgentSettingsCard** is ALSO blocked; "wedding-friendly" / "thumb-friendly" saves CLEAN.
- **F9-1 — locked-setter rename refused EVERYWHERE** — Retell-lock a setter → rename via the tile name heading AND via
  the prompt-doc page header → both refuse with a clear "Retell-locked" error, no `setter_display_names` write; a
  stale-lock race REVERTS the display name (no tile/Retell mismatch). Unlock → rename works.
- **API-DEPR-1 — v2 list-agents serves the UI** — VoiceAIRepSetup → Agents tab lists agents with full detail
  (name/version/published/engine, one row per agent); API Credentials → Verify shows Retell "Connected".
- **PROMPT-AUTH-1 — Full-prompt visibility (X-Ray)** — the operator can view the COMPLETE assembled system prompt a
  text setter sends (VERIFY dialog: runtime appends + the LIVE stored external row, matches/differs badge) and can
  edit/override every availability + booking rule from the UI.
- **G3-7 — app renders on vite 8** — open `app.buildingflowdigital.com`, click through login/dashboard, a setter/prompt
  page, contacts → renders + navigates with NO console errors on the vite-8 prod bundle.

Gated here (skip until Resend SMTP lands): **F14 invite E2E**, **F14 client self password reset**.

---

## RUN 2 — Voice: ONE answered booking call + ONE unanswered + ONE inbound-from-unknown

**Precondition:** re-Save the 5 voice setters (Main Outbound + the 4 Garys) so the live agents pick up **VM-1** (v48
voicemail) and **API-DEPR-2** (v49 analysis system-presets). Then, before dialing, set a `static` or `prompt` voicemail
on the client Voicemail card and **Save & push**.

Clears:
- **VM-1 — voicemail push lands AND survives a call** — Save & push mode=`prompt` → **"voicemail_set"** success (NOT
  "partial"); all 5 push targets' `voicemail_option` updated (draft→publish→repoint runs per agent); locked setters
  skipped + reported. Try a `static` push too (now emits `static_text`).
- **API-DEPR-2 (a)** — after the re-Save, `get-agent` on that agent shows the 3 deprecated `analysis_*_prompt` fields
  still ABSENT and `post_call_analysis_data` now carrying 3 `type:"system-presets"` entries
  (`call_summary`/`call_successful`/`user_sentiment`) + the existing custom fields, no dupes.
- **VOICE GATE — retell-proxy v49 answered-call booking regression** — one answered outbound booking call
  (Main Outbound / Voice-Setter-master), run booking to completion → connects + books exactly as on v47 (compare
  `call_d5625539` / booking `4f7c76a0`); **B-3** (runs on current published version) + **B-5** (`first_name` populated,
  no literal `{{first_name}}`) survive. If it regresses, roll retell-proxy back to v47/v48.
- **API-DEPR-2 (b)** — after the answered call, `call_summary` / `user_sentiment` / `call_successful` still populate
  TOP-LEVEL in `call_history` (proves the migration kept top-level output; analysis webhooks unaffected).
- **VM-1 voicemail lands** — the unanswered call hears the pushed voicemail.
- **B-5 / `{{first_name}}`** — the inbound-from-unknown call (a genuinely non-CRM number) omits the name, never says
  the literal `{{first_name}}`. (If a fresh unknown number is used in RUN 7's GHL test, do B-5 there instead.)

After: confirm on the Retell dashboard (next sweep) that the **legacy-list + analysis-prompt deprecation notices stop
firing** (API-DEPR-1 + API-DEPR-2).

---

## RUN 3 — SMS: ONE multi-turn exchange from TEST_PHONE_A on an OPEN calendar

One conversation covering booking + memory + observability:
- **BOOK-1 / 3.12 SMS booking acceptance** — text "can I book a meeting?" on an OPEN calendar → the setter offers ONLY
  real open times and **books on acceptance** (never "booked out"/"snapped up"). Proof in `tool_invocations` (platform
  Supabase): a `get-available-slots` prefetch row THEN a `book-appointments` row with a confirmed result + a real GHL
  appointment. Then exercise **reschedule / cancel / callback over SMS**, and **STOP mid-exchange is respected**
  (`bookings.source='sms'`, `engagement_executions` ends `stop_reason='booking_created'`).
- **SMS-OBS-1 — tool invocations persisted** — `select * from tool_invocations where lead_id=... order by created_at`
  shows the rows (name/args/result/error, `source='sms'`, prefetch first).
- **SMS-MEM-1 — multi-turn memory** — state a day, then SEPARATELY accept a time → the setter does NOT re-ask an
  already-answered question; `chat_history` (client external Supabase) now shows alternating `human`/`ai` rows.
- **MODEL-1 (no 400)** — the exchange gets a reply (BFD's live `clients.llm_model` is valid).
- **PROMPT-AUTH-1 spot-checks** (do NOT full-re-run; reported passed 2026-07-03): calendar-sourced availability (no
  fabricated day restriction) + date/time accuracy (books the EXACT accepted day/time, no `{{ $now }}` literal).
- **manual SMS send + 429-retry (LIVE-D)** — send a real text from the UI; confirm it sends and a 429 path retries.

Separately (throwaway client, NOT BFD): **MODEL-1-HARDENING** — set `clients.llm_model` to a bad value
(`gemini-flash-latest` / `gptjunk`) via Mgmt API → an SMS still gets a reply (alias remaps / no-slash falls back; no
400). Restore.

---

## RUN 4 — Cadence + follow-up / nudge (Trigger paths)

- **F3 — pause / resume a running cadence** — start a test cadence to TEST_PHONE_A; on a running execution PAUSE before
  step 2 (`status='paused'`, no sends while paused), RESUME (continues from `last_completed_node_index+1`, no
  double-send); END NOW on a paused exec cancels cleanly.
- **F4 — timezone-aware cold-reply nudge** — set `clients.timezone` so the local hour is OUTSIDE 9am-8pm, manually
  trigger `nudgeColdReply` (avoids waiting for crons) → the cold lead is SKIPPED that hour; set in-window → it nudges;
  restore `Australia/Sydney`.
- **FOLLOWUP-PROMPT-1 — follow-up respects date/availability ground truth** — let a cold lead trigger a cron follow-up
  → the copy never states a fabricated day policy or a literal `{{ $now }}` artifact and never "offers to check the
  calendar" (followup-mode availability block names no tools); `followup_timers.raw_exchange` shows the block was
  injected. (`nudgeColdReply` confirmed NOT to need the fix — no `text_prompts` read, no booking loop.)

---

## RUN 5 — Contacts / leads DB + analytics (UI + Mgmt API; no phone)

- **PHONE-CLEAR-1 — clearing a phone clears the match key, everywhere** — on a lead, clear the phone via ContactDetail,
  the **Contacts edit dialog**, AND the **Chats in-chat contact panel** → `leads.normalized_phone` is NULL each time
  (Mgmt API); an inbound SMS from the old number no longer resolves to that lead; adding a NEW contact via the dialog
  SETS `normalized_phone` (lead is inbound-matchable). Changing the phone updates `normalized_phone` to the new E.164.
- **G3-8(a) — reactivation webhook fires server-side, no browser secret** — on a reactivation campaign click **execute
  lead** → the webhook fires + the row reaches `completed`; in the browser Network tab the request goes to
  `execute-lead-webhook` and **no** `supabase_service_key` appears in any browser payload; a failure marks the row
  `failed`.
- **G3-6 — analytics features still work (Tier 3)** — NOTE (2026-07-05): do NOT set `clients.supabase_table_name`
  to the chat table. It is OVERLOADED (leads-table for intake/process-lead/sync; chat-table only for
  `analyze-chat-history`/`analytics-v2-process`), the RUN-5 fns below hardcode `chat_history` and never read it,
  and setting it to `chat_history` BREAKS leads sync. BFD external chat table = `chat_history` (verified, 250 rows);
  leave the column NULL. See BUG_LIST **G3-6-SCHEMA-1**. Then: ChatAnalytics time-series over a date range (via
  `get-chat-history` mode:range), Contacts last-interaction timestamps (via `fetch-thread-previews`), custom-metric AI
  analysis (via `analyze-metric`), AnalyticsV2 / CreateMetricDialog suggestions (via `analytics-v2-suggest-widgets`),
  and the OpenRouter usage panel (via `get-openrouter-usage`).

---

## RUN 6 — B-2 by-phone cluster (inbound SMS + GHL-outage sim)

Claude drives the outage sim (set a bad `ghl_api_key` via Mgmt API, then restore the real `pit-…`):
- **B-2 CSV `normalized_phone`** — import a CSV with an AU phone (`0405482446`) → the new `leads` row has
  `normalized_phone='+61405482446'`; an inbound SMS from that number resolves internal-first (no new GHL contact, no
  2nd `leads` row); logs `internal lead resolved by normalized_phone`. A UI STOP on that lead fans out by phone.
- **B-2 inbound never dropped on a GHL outage** — with GHL broken, an inbound SMS from a number NOT in the CRM still
  gets a setter reply (Twilio-direct); a `leads` row exists with `lead_id='bfd-+61…'` + correct `normalized_phone`;
  `error_logs` shows `ghl_contact_resolve_degraded` (warning), not `_failed`. A malformed inbound number still logs
  `_failed` + drops (intended).
- **B-2 background repoint converges, no dup** — restore GHL, send one more inbound (or wait for the reconcile) → the
  synthetic row's `lead_id` becomes the real GHL id; a later `sync-ghl-contact` UPDATEs (no 2nd row);
  `select client_id,lead_id,count(*) from leads where lead_id like 'bfd-%' group by 1,2 having count(*)>1` → 0 rows.
- **B-2 deterministic GHL pick** — for a phone with >1 GHL contact (if you can stage one), repeated inbound sends
  resolve to the SAME (most-recently-updated) contact every time.

---

## RUN 7 — Fresh GHL contact (F1) + gated CRM cleanup (LAST)

- **F1 — GHL conversation deep-link** — create a FRESH GHL contact that posts to `sync-ghl-contact` (fires on a
  tag-add / intake workflow, not bare creation) → the "BFD Conversation Link" field holds
  `https://app.buildingflowdigital.com/leads/<uuid>`; clicking it opens BFD's conversation view; exactly one write, no
  second SMS send. (This fresh unknown number also serves B-5 / B-2 if not already covered in RUN 2/6.)
- Then, **gated with Brendan first**, clean up `+61405482446` in the CRM to free it for future runs.

---

## Blocked / gated / standing (report, don't block on these)

- **F14 invite E2E + client self password reset** — GATED on Brendan's Resend SMTP setup (`BRENDAN_TODO.md`).
- **PROMPT-AUTH-1: No leftover artifacts + Efficiency** — BLOCKED on Brendan applying the **Setter-1 prompt content
  migration** via the UI (report-only; steps in `BRENDAN_TODO.md` + the migration report under
  `Docs/investigations/prompt-migration-reports/`). Remind Brendan; it unblocks these 2 checks. Claude cannot do it.
- **B4 SMS send-idempotency** — inducing a live Trigger retry manually is impractical (unit + DB-level proof already
  done; call-side send-once verified live). Standing item.

---

## RUN 9 — Brendan manual checklist (surface this at the END of every test session)

These are the manual / dashboard / UI actions Claude cannot do. Read them out to Brendan at the end of the run with
their current status. **Done items (Claude verified):** DEPLOY-1 (Railway pinned to `main`) · inotify sysctl (raised
to 524288 live) · Twilio ACMA sender-ID check (CLEAN, 0 alpha senders). **Still open below** — each has step-by-step
detail so Brendan can just do it. Canonical status lives in `BRENDAN_TODO.md` / `PROMPT_UPDATE_LIST.md`.

**M1 — Resend SMTP (unblocks the F14 email tests AND the future F15 weekly ROI report email).**
1. Sign up free at https://resend.com.
2. **Domains → Add Domain → `buildingflowdigital.com`.** Resend shows DKIM + SPF (+ optional MX) DNS records.
3. Add those records at the domain's DNS host (wherever `buildingflowdigital.com` DNS lives), then wait for Resend to
   flip the domain to **Verified** (minutes to a few hours).
4. **API Keys → Create API Key** → copy the `re_…` key.
5. Hand the `re_…` key to Claude in a session and say "wire Resend SMTP". Claude runs the Supabase Management API
   PATCH `/config/auth` (host `smtp.resend.com`, port 465, user `resend`, pass = the key, sender name + admin email) —
   the exact payload is in `Operations/handoffs/2026-07-02-usage-billing-auth.md`. Guide:
   https://resend.com/docs/send-with-supabase-smtp
   → then re-run the F14 invite + self-reset checks (RUN 1, currently gated).

**M2 — Setter-1 prompt content migration (unblocks the 2 blocked PROMPT-AUTH-1 checks: "No leftover artifacts" +
"Efficiency").** Report-only; Claude must not edit prompt content.
- In the BFD setter UI: **Prompt Management → Setter-1 → SETTER CORE →** enable **"Booking Function" → "View Prompt"**
  → clear the legacy booking text (or click **"Return to Default"** for the new minimal template) → **Save/Deploy**
  (now lints on save + snapshots to `prompt_versions`) → re-open **"Verify Setter Prompt" → "Load live stored prompt"**
  to confirm it is lean.
- Full generated report + the proposed replacement prompt (42 errors / 26 warnings on the current stored prompt):
  `Docs/investigations/prompt-migration-reports/e467dabc-57ee-416c-8831-83ecd9c7c925_Setter-1.report.md`.

**M3 — n8n Railway shutdown (SAFE now).** The native text engine is canonical (`trigger/processMessages.ts` throws if
`use_native_text_engine` is false), so nothing runtime depends on n8n. In Railway → the n8n service → **Settings →
Remove Service** (or pause it). No code change; the unused `clients.text_engine_webhook` column stays (deferred).

**M4 — Pricing tune (OPTIONAL; defaults are already sane, do per client).** BFD setter UI → **Sub-Account Config →
Cost-to-Price Calculator / Usage & Billing:** set the **billing anchor day** (default 1st), the **sms_llm per-message
rate** (default US$0.003, enabled), and flip whichever of the **4 client-visibility toggles** (rate / minutes / texts /
month-total) each client may see (default all OFF). Nothing is required for 100% — this is tuning to taste.

**M5 — Voice prompt-content items (report-only; apply via Prompt Management, one Retell sweep).** Detail per item is in
`PROMPT_UPDATE_LIST.md`. Priority order:
- **PU-6 (compliance) — call-recording disclosure line** on every voice setter's opener (NSW/WA/SA all-party consent).
- **PU-7 (compliance) — Crazy Gary opener** lacks company + purpose; add them IF it's used for real outbound (else
  confirm it's demo-only). Property Coach already compliant (Claude verified). Spot-check Finance Strategist / Mortgage
  Broker / Main Outbound the same way.
- **PU-4** Property Coach real company name (removes the `[placeholder]`), **PU-3** `{{first_name}}` outbound opener
  (guard against empty on inbound), **PU-1** name the business timezone on booking, **PU-5** stand up Main Outbound V2.

**M6 — Setup-guide screenshots (low priority).** `5.1` — folder name decided ("BFD Setter", 2026-07-09); the asset
was renamed to `retell-bfd-setter-folder.png` in the 2026-07-10 branding purge but its CONTENT still shows the old
folder name - re-shoot against a Retell folder named "BFD Setter" and drop the new screenshot onto that filename.

**M7 — FIRST-CLIENT-GATED (do NOT do until a contract signs; the milestone session covers these).** Stripe live +
`ENFORCE_SUBSCRIPTION_GATE=true`, provision webhook signing secrets + arm `retell_webhook_secret` (6.6), AU SMS A2P /
Messaging Service registration for `+61481614530`, and the GHL reminder-workflow snapshot at onboarding. Full detail in
`Docs/DEFERRED.md` (first-paying-client cluster) + the First-Client Milestone session prompt in `SESSION_PLAN.md`.

---

## RUN 10 — Next sessions (the relay: run these in order after the test pass)

The whole path to v1 "100%", in order. Run each in a FRESH session by pasting its fenced prompt. Each prompt carries a
**▶ PIPELINE** footer so you always see what's left. Live done/not-done status is in `Docs/SESSION_PLAN.md`.

```
                                                                            SETTINGS (each prompt restates these)
[✓] Test session (this file)                                                Opus 4.8 [1m] · think HIGH · execute
[ ] Session T-fix   — ONLY if the test pass logged failures                 Opus 4.8 [1m] · think HIGH · plan IF it
                                                                            touches retell-proxy/voice-booking-tools/
                                                                            live cadence, else execute
[ ] Session S       — supervised: BOOK-2 + BOOK-3 + SMS-METER-1 (frozen)     Opus 4.8 [1m] · think HIGH · plan ON
[ ] Session F15     — client ROI pack (show-rate funnel + weekly report)     Opus 4.8 [1m] · think HIGH · plan ON
[ ] Session F16     — never-miss-a-lead pack (+ F17 phase-1 compliance)      Opus 4.8 [1m] · think HIGH · plan ON
[ ] First-Client Milestone — GATED: only when a contract signs.             Opus 4.8 [1m] · think HIGH · plan ON
     Full prompt in Docs/FIRST_CLIENT_MILESTONE.md (or say "I'm onboarding a client"). After it, v1 = LIVE + 100%.
Post-client queue (later): F18 (AI confirm call) → F19 (QA digest) → F20 (revenue attribution) → F12 (cost opt).
```
Rule of thumb baked into these: **plan mode ON for anything that touches a live/frozen surface** (retell-proxy,
voice-booking-tools, outbound dial paths, new schema, the milestone gates); **execute** for verification + scoped fixes.

Note: F15/F16 are the market-research pre-first-client features (`FEATURE_ROADMAP.md` F15-F20). If the demo is imminent,
run **F16 before F15** (F16 is the flashier live demo; F15 is the retention spine that needs data to accrue anyway).

---

### ▶ Session T-fix — fix pass (ONLY if the test session logged failures)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON only if a fix touches retell-proxy /
voice-booking-tools / the live cadence runtime, otherwise execute.

BFD-setter - FIX PASS for the TEST session failures.

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in
./.env. Live DB via Supabase Management API /database/query (NOT postgres MCP). NEVER edit voice/text prompt
CONTENT (report-only). retell-proxy is the FROZEN Voice baseline (changes are Voice-gated); voice-booking-tools
stays frozen. Verify read-only before claiming done. No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the latest test-session handoff, and the new FAIL entries in Docs/BUG_LIST.md.

Scope: ONLY the bugs the test session logged. For each: reproduce read-only, fix, test, deploy per its surface
(edge fn via scripts/deploy_single_fn.mjs, Trigger via TRIGGER_DEPLOY_PAT, frontend via main push), add a retest
row to TEST_LIST.md. Close out per the Relay Protocol and emit the next prompt (Session S).

▶ PIPELINE (run in order; live status in Docs/SESSION_PLAN.md):
[✓] Test session   [•] T-fix (here)   [ ] Session S   [ ] F15   [ ] F16   [ ] First-Client Milestone (gated)
Next after this: Session S (below, or say "run session S").
```

---

### ▶ Session S — supervised shared-fn (BOOK-2 + BOOK-3 + SMS-METER-1)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON. (The riskiest session — a frozen baseline
shared by BOTH live voice and SMS booking — so plan + review before any edit is mandatory.)

BFD-setter - SUPERVISED shared-fn session: BOOK-2 + BOOK-3 + SMS-METER-1 in the FROZEN voice-booking-tools.
HARD GATE: Brendan is present and live; every edit to voice-booking-tools is
reviewed before deploy, and the deploy is followed the same day by one answered-call booking regression AND one
SMS booking regression (voice-booking-tools is shared by BOTH channels).

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in
./.env. Live DB via Mgmt API /database/query. NEVER edit prompt content. Verify read-only before claiming done.
No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the latest handoff, the BOOK-2 / BOOK-3 / SMS-METER-1 entries in
Docs/BUG_LIST.md (BOOK-2/3 have characterization tests in the repo already - find and run them first).

Scope, one commit each:
1. BOOK-2: resolveCanonicalSlot exact HH:MM grid-match false-negative. Snap to the nearest REAL grid slot, or
   return slot_unavailable with real alternatives. NEVER loosen to fuzzy matching; the wall-clock matching is
   load-bearing and live-proven, do not change the offset handling.
2. BOOK-3: toMs() parses offset-less ISO as UTC, shifting the free-slots window ~10h for Sydney. Interpret
   offset-less ISO in client.timezone.
3. SMS-METER-1: toolSendSms never stamps message_queue channel='sms_outbound', so mid-call texts are invisible
   to F13 metering. Add the same non-fatal post-send stamp the other writers use
   (ghl_account_id = client.ghl_location_id || client.id, twilio_message_sid).
Extend the characterization tests to pin each fix. Deploy voice-booking-tools ONCE at the end (Brendan GO), then
run BOTH live regressions before closing anything. Close out per the Relay Protocol; emit F15.

▶ PIPELINE (run in order; live status in Docs/SESSION_PLAN.md):
[✓] Test session   [✓] T-fix (if needed)   [•] Session S (here)   [ ] F15   [ ] F16   [ ] First-Client Milestone (gated)
Next after this: Session F15 (below, or say "run session F15").
```

---

### ▶ Session F15 — client ROI visibility pack (show-rate funnel + weekly report)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (new schema + a new GHL webhook surface; brainstorm first).

BFD-setter - F15: client ROI visibility pack (show-rate funnel + weekly report).

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in
./.env. Live DB via Mgmt API /database/query. NEVER edit prompt content. retell-proxy + voice-booking-tools
frozen (this feature should not touch either). Verify read-only before claiming done. No em dashes. Relay
Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the latest handoff, the F15 entry + "Feature spec - 2026-07 market research"
in FEATURE_ROADMAP.md, and the F13 usage plumbing (get-client-usage, computeUsage, billingPeriod) so the report
reuses it rather than re-deriving numbers.

Scope:
(a) Show-rate funnel: ingest GHL appointment-status changes (GHL fires workflow triggers/webhooks for confirmed
    / showed / no-show / cancelled) into the platform, keyed to the existing bookings rows. FIRST confirm the
    exact GHL mechanism available on our location read-only against the live GHL API. Track booked -> confirmed
    -> held -> no-show per setter and per lead source. Reuse the sync-ghl-contact ingress + webhook auth patterns.
(b) Weekly client report: a Trigger.dev cron that assembles per-client - calls made/answered, SMS conversations,
    appointments booked/confirmed/held, no-show rate, billed usage (from F13), top objections (existing analysis
    data), plus an agency-editable "what we improved" block. Render white-label HTML email; send via Resend SMTP
    (GATED: if Brendan's Resend item is still open per Docs/TEST_SESSION.md M1, build everything and stub the send
    behind a flag + a preview URL in the dashboard). Client-visibility of each section follows the F13
    client_display toggle pattern.
Tests for the funnel state machine + report assembly. Deploy edge fn(s) + Trigger + frontend on GO. Live-verify:
flip one real booking through confirmed -> showed in GHL and watch the funnel row update; generate one real report
for the BFD dogfood client. Close out per the Relay Protocol; emit F16.

▶ PIPELINE (run in order; live status in Docs/SESSION_PLAN.md):
[✓] Test session   [✓] Session S   [•] F15 (here)   [ ] F16   [ ] First-Client Milestone (gated)
Next after this: Session F16 (below, or say "run session F16"). If the demo is imminent, you may have run F16 first.
```

---

### ▶ Session F16 — never-miss-a-lead pack + F17 phase-1 AU compliance

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (touches outbound dial paths; the hours gate is a compliance control).

BFD-setter - F16: never-miss-a-lead pack (speed-to-lead + missed-call text-back + live-transfer config)
+ F17 phase 1 (AU calling-hours enforcement + recording-disclosure toggle).

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in
./.env. Live DB via Mgmt API. NEVER edit prompt content (the transfer phrasing + disclosure LINE are PU items
Brendan applies; the toggles/engine are code). retell-proxy changes are Voice-gated; voice-booking-tools frozen.
Verify read-only before claiming done. No em dashes. Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the latest handoff, the F16 + F17 entries in FEATURE_ROADMAP.md,
_shared/business-hours.ts (an hours guard already exists - map its coverage FIRST), and make-retell-outbound-call.

Scope:
(a) F17 phase 1 FIRST (it gates the dials): verify/extend hours enforcement so EVERY outbound voice dial and
    cadence SMS respects Telemarketing Standard windows (weekdays 9am-8pm, Sat 9am-5pm, no Sun/public holidays)
    in the lead's timezone falling back to clients.timezone. Add a per-client recording-disclosure toggle
    (engine-side; the spoken line = PU-6, report-only).
(b) Speed-to-lead: new lead via sync-ghl-contact -> AI voice call within 60s INSIDE the legal window, SMS fallback
    outside hours or on no-answer. Per-client opt-in. Reuse campaign/dial plumbing; do not invent a new dial path.
(c) Missed-call text-back: inbound call unanswered/abandoned (Twilio status webhook) -> SMS within 60s from the
    same number into the existing multi-turn SMS booking engine. Dedupe against an answered-elsewhere race.
(d) Live-transfer config: per-setter UI for Retell's native transfer_call tool (retell-proxy already passes it
    through untouched) - target number from client config, plus an SMS context-summary fallback on failed
    transfer. Report the recommended prompt line to PROMPT_UPDATE_LIST; do not write it.
Tests per unit; deploys per surface on GO; live-verify each of the 4 behaviors. Close out per the Relay Protocol;
emit the First-Client Milestone reminder (it is event-gated - do not run it until a client signs).

▶ PIPELINE (run in order; live status in Docs/SESSION_PLAN.md):
[✓] Test session   [✓] Session S   [✓] F15   [•] F16 (here)   [ ] First-Client Milestone (GATED on a signed client)
Next: nothing runs until a client signs. When one does, say "I'm onboarding a client" -> Docs/FIRST_CLIENT_MILESTONE.md.
```

---

### ▶ First-Client Milestone — GATED (do NOT run until a contract signs)

The full prompt lives in **`Docs/FIRST_CLIENT_MILESTONE.md`** (kept separate so it surfaces on demand, not by accident).
When a client actually signs, tell Claude **"I'm onboarding a client"** (or open that file) and run it. It covers Stripe
go-live + the subscription gate, webhook signing secrets, AU A2P registration, onboarding the client, the GHL reminder
snapshot, and the compliance close-out. **After that session, v1 is LIVE + 100%.**

---

## Close-out

Reconcile the 6 lists (passes → `Docs/archive/COMPLETED_LOG.md`, fails → `Docs/BUG_LIST.md`, plus
`PROMPT_UPDATE_LIST.md` if any prompt-content need surfaced), tick `SESSION_PLAN.md`, write a dated handoff, and
`git add -A && commit && push` to origin + github. **Hand Brendan the next prompt from RUN 10 above:** if the test
pass logged failures, hand the **Session T-fix** prompt; otherwise the **Session S** prompt. Each RUN-10 prompt carries
its own ▶ PIPELINE footer, so the relay self-chains: T-fix → S → F15 → F16 → (gated) First-Client Milestone. Also read
out **RUN 9** (the Brendan manual checklist) so the manual items surface too.
