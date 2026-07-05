# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. Brendan runs these **after all build + UI work is done** (his call, 2026-06-25).
When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`. When it fails, open a bug in `BUG_LIST.md`.

> **▶ To EXECUTE this list in the fewest live runs, use `Docs/TEST_SESSION.md`** (say "run test session"). This file
> stays the itemized SOURCE OF TRUTH for pass/fail; `TEST_SESSION.md` is the consolidated runbook that batches these
> items by physical action (one voice call, one SMS thread, one agency↔client login, etc.). Keep them in sync.

> **⭐ Overnight bug-fix branch DEPLOYED + LIVE 2026-07-04 (Session 9).** ALL items are live and testable now: backend (SMS-MEM-1, FOLLOWUP-PROMPT-1 via Trigger 20260703.2; VM-1 + API-DEPR-1 list-agents via retell-proxy v48; PROMPT-LINT-1 edge via save-external-prompt v15; verify-credentials v3; RLS-SHAPE-1 migration applied) AND frontend (MODEL-1-HARDENING UI, F9-1, PHONE-CLEAR-1, PROMPT-LINT-1 browser gate — Railway had already deployed the branch to prod overnight; the live bundle was confirmed to contain the MODEL-1 code). **The retell-proxy v48 answered-call Voice-regression is the one live gate owed before v48 is fully trusted (item just below).** Note: DEPLOY-1 (BUG_LIST) — Railway shipped the feature branch to prod overnight; pin the prod deploy to `main` (BRENDAN_TODO).

- [ ] **VOICE GATE — retell-proxy v49 answered-call booking regression (retell-proxy is the FROZEN Voice baseline; v49 SUPERSEDES v48 — API-DEPR-2 landed 2026-07-04).** Read-only smoke already PASSED on both v48 (POST `/v2/list-agents`→24 agents + get-agent hydration) and v49 (list-agents 200 + canonical agents byte-for-byte unchanged), 0 agents mutated. Owed: place ONE answered outbound booking call (Main Outbound / Voice-Setter-master), run the booking to completion → confirm the call connects + books exactly as on v47 (compare to the 2026-07-03 gate `call_d5625539` / booking `4f7c76a0`). If it regresses, roll retell-proxy back to v47 (or v48) via `deploy_single_fn.mjs`. Pairs with the VM-1 voicemail-lands check below (do both on the same call session where practical).
- [~] **API-DEPR-2 — analysis fields migrated to system-presets (retell-proxy v49).** **(b) PASSED live 2026-07-05** (top-level analysis populated on the answered call). **(a) carried to the Fable onboarding session (2026-07-05 Test-finish):** `retell-proxy` requires a real user JWT (no service-key path) so it cannot be replayed server-side; Fable does a voice-setter save on a fresh THROWAWAY agent and asserts the presets there. Two live checks (both zero-risk to the conversation; post-call REPORTING only): (a) after Brendan re-Saves any setter through the BFD setter UI, `get-agent` on that agent shows the 3 deprecated `analysis_*_prompt` fields still absent and `post_call_analysis_data` now carrying 3 `type:"system-presets"` entries (`call_summary`/`call_successful`/`user_sentiment`) + the existing custom fields, no dupes; (b) on the VOICE-GATE answered call above, confirm `call_summary` / `user_sentiment` / `call_successful` still populate TOP-LEVEL in `call_history` after the call (proves the migration kept top-level output, so the analysis webhooks are unaffected). Also: over the next sweep, confirm Retell's legacy-list + analysis-prompt deprecation notices stop firing.

> **⭐⭐ TEST SESSION 2026-07-05 — largely AUTOMATED pass (Claude drove it via headless Playwright + signed-webhook simulation + programmatic Retell dials + Mgmt API).** Full detail + the reusable harness + the next-session prompts are in `Operations/handoffs/2026-07-05-test-session.md`.
> **PASSED → move to COMPLETED_LOG:** RUN 0 self-verify (git/tests/fn-versions/frontend all green); **G3-7** vite-8 render (all 17 agency routes, no page/module errors); **F11** masked-Configured; **UI-1** plain labels; **F8** live edit-save (markup persists + reverts) + blended $0.45/min hand-checked vs SQL; **F13** margin panel + period/anchor + 4-toggle flip + volumes-vs-SQL (voice 3min/1call, SMS 19); **PROMPT-LINT-1** (all bypass cases, pure module); **MODEL-1** (8/8 gate); **API-DEPR-1** (v2 list-agents 200 live); **F9-1** locked-rename refused (no `setter_display_names` write); **PROMPT-AUTH-1 X-Ray** (full assembled prompt visible + matches badge); **G3-6** analytics data path (chat_history 250 rows, timestamp range OK); **VOICE GATE** answered booking on **v49** (call `call_4b1136b5`, booked, clean hangup); **API-DEPR-2(b)** top-level analysis populated (call_successful:true, sentiment Positive); **VM-1 push** (all 5 agents → prompt, NO "partial" — v48 fix confirmed) + **VM-1 plays** (real voicemail left, 15s); **B-5** (inbound from anonymous → no `{{first_name}}`) + **PU-6 recording disclosure present**; **RUN 3 SMS** — 3.12 booking, **SMS-OBS-1**, **SMS-MEM-1** (alternating human/ai, no re-ask), **BOOK-1/BOOK-3** (books exact accepted Sydney time), **MODEL-1**, PROMPT-AUTH-1 date-accuracy, **STOP** respected; **RUN 6 B-2 outage** (inbound never dropped, `bfd-<phone>` synthetic lead, `ghl_contact_resolve_degraded` not `_failed`, Twilio-direct reply, 0 dups, key restored).
> **BUGS FOUND → BUG_LIST:** `G3-6-SCHEMA-1`, `SWEEP-1` (a/b/c), **`CANCEL-1`** (SMS cancel hallucinated eventId → GHL 404; voice likely too). **PROMPT_UPDATE_LIST:** `PU-8` ([Your Name] voicemail placeholder).
> **STILL OWED — UPDATED 2026-07-05 (Test-finish, autonomous):** **RUN 4** (F3 / F4 / FOLLOWUP-PROMPT-1) and **RUN 7** (F1) are all now **DONE + PASS** → `COMPLETED_LOG.md`. Remaining → the **Fable onboarding session** (both need a fresh throwaway agent/client, so they land there cleanly): **API-DEPR-2(a)** (presets-on-agent after a clean voice-setter Save — `retell-proxy` needs a real user JWT, so it is done on the Fable throwaway agent) + **F13 client-EYE view** (needs a client-role user, which Fable creates). Test artifact left: synthetic lead `bfd-+61400000199` (harmless).

> **Session 7 TEST pass — phone-half done 2026-06-30.** The passed items moved to `COMPLETED_LOG.md`:
> B-4(6.2), F2c, G3-3, 6.11, 6.12b (call+SMS), the full **F9 lifecycle** (lock / bulk-skip / Pull+drift /
> outbound-dials-while-locked / unlock+rename-no-423), B-3(6.4), B4-call-side, latency, and the LIVE-A UI
> passes (F2b, F6, B-6×2). Bugs found → `BUG_LIST.md`: **BOOK-1/2/3, MODEL-1-HARDENING, SMS-OBS-1,
> PHONE-CLEAR-1** (+ the earlier F9-1, VM-1, INB-1, UI-1, API-DEPR-1). **MODEL-1 fixed live.** The items
> below are the **still-owed** live checks (best run after tonight's overnight Text-Setter repair lands).

## ⭐ 2026-07-01 deploy — F8 + Session 7.5 DEPLOYED LIVE (consolidated test pass)

> Both F8 and the 7.5 all-bugs fixes are DEPLOYED (handoff `2026-07-01-f8-plus-7.5-deploy.md`). F8's trap is
> proven sealed autonomously (live proof 9/9); these are the BEHAVIORAL checks a human runs. **Batch them**
> (each line covers several items) to avoid repeated work.

## ⭐ F13/F14 (usage & billing + auth) — DEPLOYED LIVE 2026-07-03, ready to test now

> Deployed 2026-07-03 (results in `Operations/handoffs/2026-07-02-usage-billing-auth.md`). Both trap
> proofs passed 9/9 live and the SQL hand-check matched exactly, so the security boundary + math are
> proven; these are the human UI/behavioral checks. The two F14 email items stay gated on Resend SMTP.

- [ ] **F13 — agency margin panel vs SQL hand-check.** Agency login → Sub-Account Config → "Usage & Billing": minutes,
  calls, texts, billed, actual cost, margin all populate for the current period. Hand-check one month via Mgmt API SQL:
  `SELECT SUM(CEIL(GREATEST(duration_ms,0)/60000.0)), COUNT(*), SUM(cost) FROM call_history WHERE client_id='e467dabc-...'
  AND created_at >= '<start_utc>' AND created_at < '<end_utc>';` + the `message_queue` sms_outbound count → matches the panel.
- [ ] **F13 — client toggle matrix.** In the pricing panel flip each of the 4 Client visibility toggles ON one at a time,
  log in as the client each time: the dashboard summary card + the account-page Usage & Billing panel show ONLY that part
  (rate / minutes / texts / month total). All four OFF → neither renders anything for the client.
- [ ] **F13 — dashboard summary card, both roles.** Your agency login sees the margin one-liner on the client's
  ChatAnalytics dashboard (text + voice tabs, not chat-with-ai); the client login sees only toggled parts.
- [ ] **F13 — period browsing + anchor.** Set a billing anchor day (e.g. 15) in the pricing panel → the panel's period
  label shifts to anchor-to-anchor; browse Previous/2-back periods; set anchor 31 on a short month and confirm the label
  clamps to the month's last day.
- [ ] **F14 — invite E2E (AFTER Resend SMTP lands).** ManageClients → edit a sub-account → "Invite Sub-Account User by
  Email" → invite a test address → email arrives from the branded sender → link lands on "Set Your Password" → a password
  under 12 chars is refused → set a valid one → sign in works, role=client, correct client_id routing.
- [ ] **F14 — client self password reset.** /forgot-password with a client-role email now sends the reset (no more
  "Not Authorized"); the reset form enforces 12 chars; agency reset still works.

- [x] **VOICE-REGRESSION CONFIRMATION — DONE 2026-07-03 (Session 7-finish): gate PASSED, retell-proxy v47 SAFE (no rollback).**
  Live outbound `call_d5625539` (Main Outbound `agent_b2f6495` v11, ~2.9 min): **booking E2E PASS** (`bookings` `4f7c76a0`,
  `source='voice_call'`, confirmed, 11:30 AM Thu Sydney; agent used real availability, no fabrication) · **B-3 PASS** (ran on
  current published v11) · **B-5 PASS** (`first_name` populated, zero literal `{{first_name}}`) · **F2c PASS**. → these legs
  archived in `COMPLETED_LOG.md`. **VM-1 FAILED** — Save & push (mode=`prompt`) still "partial", 0/5 agents updated →
  re-opened in `BUG_LIST.md` (v47 fix insufficient; needs draft-first + `static_text`). Does NOT gate v47.
- [ ] **F8 — agency panel + client card.** Agency login → Sub-Account Config → "Cost-to-Price Calculator": edit
  rates/FX/markup/toggles, Save, reload → persists; the live breakdown + blended $/min match a hand-check of the seeded
  figures (Retell $0.07 + LLM $0.003 = $0.073 USD × FX × (1+markup), Twilio OFF, number rental a separate fixed line).
  Turn **show rate to client** ON → log in as that client → AccountSettings shows a read-only "Your Rate $X.XX /min (AUD)"
  card with NO breakdown/markup; toggle OFF → the card disappears. (The trap — client cannot read markup via the API —
  is already proven 9/9; this is the UI behavioral check.)
- [x] **One SMS exchange to a test lead** — CONFIRMED 2026-07-03 via the PROMPT-AUTH-1 live regression (BOOK-1
  acceptance, 3.12 SMS booking `source='sms'`, SMS-OBS-1 `tool_invocations` rows, MODEL-1 no 400 all passed —
  see the PROMPT-AUTH-1 entry above). Not independently re-run by every session; a quick spot-check is fine.
- [ ] **F9-1 / PHONE-CLEAR-1 / G3-8a** — locked-setter inline rename is refused with a clear error (no `setter_display_names`
  write); clearing a lead's phone nulls `leads.normalized_phone`; "execute lead" on a reactivation campaign fires the
  webhook + completes with NO `supabase_service_key` in any browser payload.

## Go-live smokes (code deployed, never live-verified)

- [ ] **3.12 SMS booking** → text "can I book?" → slots → pick → `bookings.source='sms'` + `engagement_executions` ends (`stop_reason='booking_created'`); reschedule / cancel / callback over SMS; STOP mid-exchange is respected (not sent). **BLOCKED on BOOK-1** (the setter currently fabricates "booked out" and never books on an open calendar — `BUG_LIST.md`); **BOOK-1 code is now STAGED on the overnight branch** — re-test via the **Session 7.5 BOOK-1 / 3.12 acceptance** entry below after the Trigger.dev deploy + the prompt tweak.
- [~] **bug-sweep UI** — 6.1 + 6.3-visual already PASS (→ COMPLETED_LOG). **Still owed → LIVE-D:** the **manual SMS send + 429-retry** (real text from the UI; confirm it sends and a 429 path retries).

## Reliability

- [ ] **B4 send-idempotency** — induce a Trigger retry on a real cadence SMS → confirm **no double-send** end-to-end (unit + DB-level proof already done). _Call-side send-once verified live 2026-06-30 (exactly one dial); the SMS-retry-idempotency leg stays here (inducing a live Trigger retry manually is impractical)._

## Session 4 — client visibility + cadence controls (2026-06-26)

> F1 shipped (sync-ghl-contact **v24** + `clients.ghl_conversation_link_field_id`; field provisioned 2026-06-28, id `4tDL3asiRNrQD3MKyP2E`). **F3 + F4 were already built** (F3 = `4b7dbc1`, F4 = `b0c6bea`). These are the still-owed live E2Es.

- [x] **F1 — GHL conversation deep-link. DONE 2026-07-05 (Test-finish, autonomous): PASS → `COMPLETED_LOG.md`.** Fresh contact `ZhJUVbYR06J4ZtHhEFsv` → field `4tDL3…` = `https://app.buildingflowdigital.com/leads/9f078a4f-…` (the new lead's uuid), only that field written (one write), 0 outbound SMS, enrollment skipped. New Low finding SYNC-LOG-1 (missing `sync_ghl_executions` audit table). _Original spec:_ Create a **fresh** GHL contact that posts to `sync-ghl-contact` (note: `sync-ghl-contact` fires on a **tag-add / intake workflow**, not bare contact creation) → on the new GHL contact, the "BFD Conversation Link" field holds `https://app.buildingflowdigital.com/leads/<uuid>`; clicking it opens BFD's conversation view (`ContactDetail.tsx`) for that lead; **exactly one** write, and **no second SMS send** (BFD's own number stays the sole sender). Before the field id is set, lead creation still works and the `sync-convo-link` step shows **"skipped"** (dormant, non-fatal).
- [x] **F3 — pause / resume a running cadence (live-runtime E2E). DONE 2026-07-05 (Test-finish, autonomous): PASS → `COMPLETED_LOG.md`.** Throwaway 2-delay-node workflow; node0 completed (`lcni=0`) → PAUSE (`status=paused`, no finalize) → RESUME (new `trigger_run_id`, resumes at index 1, no re-run of node0) → END NOW (`cancelled`); zero sends. _Original spec:_ Start a test cadence to TEST_PHONE_A (+61405482446). On a **running** execution, click **PAUSE** before step 2 → `engagement_executions.status='paused'`, and **no sends** occur while paused (check DB + Trigger run logs; the `isPaused()` boundary-exit returns `{status:'paused'}` without finalizing metrics). Click **RESUME** → status back to `running`, the cadence continues from the same step (`last_completed_node_index+1`), **no double-send** of the already-sent step. END NOW on a paused exec still cancels cleanly.
- [x] **F4 — timezone-aware cold-reply nudge. DONE 2026-07-05 (Test-finish, autonomous): PASS → `COMPLETED_LOG.md`.** BFD tz forced out of window (Pacific/Honolulu) + one manual `nudge-cold-reply` run → output `scanned:3, nudged:0, skipped:3, errors:0`; seed lead `nudge_count` stayed 0 (reached and stopped by the tz gate specifically), 0 sends; tz restored. In-window positive deliberately not run (blanket trigger would nudge other live leads). _Original spec:_ With a cold lead (silent after an outbound, within the recovery window) whose client `timezone` makes the **local** hour outside 9am–8pm: the hourly `nudgeColdReply` run **skips** it that hour (no SMS) and nudges it on a later in-window hourly run; an in-window lead nudges normally. (Gate is per-client `clients.timezone` via `Intl.DateTimeFormat`, `nudgeColdReply.ts`.) _LIVE-E plan: Claude sets `clients.timezone` out-of-window + manually triggers `nudgeColdReply` (avoids waiting two hourly crons), then in-window, then restores `Australia/Sydney`._

## Session 5 — by-phone pivot / B-2 (shipped 2026-06-26: receive-twilio-sms v29, process-lead-file v14, migration 20260627120000 applied; NO Trigger redeploy)

> Most of B-2 was already live from Spec 1. Session 5 added: (1a) deterministic GHL pick on the inbound fallback, (1b/1c) resilient miss-path (mint `bfd-<phone>` internal lead + background repoint), and (2) the CSV-import `normalized_phone` fix + backfill. Server-side confirmed at ship. These are the still-owed live behavioral checks (LIVE-D). _Claude drives the GHL-outage sim: set a bad `ghl_api_key` via Mgmt API, then restore the real `pit-…` value._

- [ ] **B-2 CSV `normalized_phone`** — import a CSV with an AU phone (e.g. `0405482446`) → the new `leads` row has `normalized_phone='+61405482446'` (Mgmt API). Then an inbound SMS from that number resolves **internal-first** (no new GHL contact minted, no second `leads` row); `receive-twilio-sms` logs `internal lead resolved by normalized_phone`. Also: a UI STOP on that CSV lead now fans out by phone (it was previously invisible to the fan-out).
- [ ] **B-2 inbound never dropped on a GHL outage** — temporarily break GHL resolution (bad `ghl_api_key`) and send an inbound SMS from a number **not** in the CRM → the lead still gets a setter reply (Twilio-direct), a `leads` row exists with `lead_id='bfd-+61…'` + correct `normalized_phone`, and `error_logs` shows `ghl_contact_resolve_degraded` (warning), **not** `ghl_contact_resolve_failed`. A malformed/un-normalizable inbound number still logs `ghl_contact_resolve_failed` + drops (intended).
- [ ] **B-2 background repoint converges, no dup** — after the above, restore GHL and send one more inbound (or wait for the same-request reconcile) → the synthetic row's `lead_id` becomes the real GHL contact id; `message_queue`/`dm_executions`/`active_trigger_runs` for that thread now key off the real id; a later `sync-ghl-contact` webhook **UPDATEs** (no 2nd `leads` row). Spot-check: `select client_id,lead_id,count(*) from leads where lead_id like 'bfd-%' group by 1,2 having count(*)>1` → 0 rows.
- [ ] **B-2 deterministic GHL pick** — for a phone that has >1 GHL contact (if you can stage one), repeated inbound sends resolve to the **same** (most-recently-updated) GHL contact every time — no flapping.

## Session 6 — secret-read hardening / G3-6 (shipped 2026-06-26: analyze-metric v18, analytics-v2-suggest-widgets v14, get-openrouter-usage v1 NEW, get-chat-history v7)

> Defense-in-depth: ~20 browser flows now read presence-only or route through an edge fn. Verified at ship: tsc/build/deno green, all 4 fns ACTIVE. **Q2 decision (2026-06-30): test everything now** — Claude to discover BFD's external chat table + set `clients.supabase_table_name` (currently null) before the live re-test.

- [ ] **G3-6 analytics features still work (Tier 3).** With BFD (external Supabase + OpenRouter configured): **ChatAnalytics** time-series renders over a date range (via `get-chat-history` mode:range), **Contacts** last-interaction timestamps populate (via `fetch-thread-previews`), **custom-metric AI analysis** returns matches (via `analyze-metric` server-side), **AnalyticsV2 / CreateMetricDialog** widget suggestions work (via `analytics-v2-suggest-widgets`), and the **OpenRouter usage** panel loads (via `get-openrouter-usage`).

## Overnight frontend-only build — F11 / UI-1 / INB-1 (shipped 2026-06-29; frontend-only, NO edge deploy)

> Cosmetic/polish + one binding fix. Hard-refresh app.buildingflowdigital.com first.

- [ ] **F11 masked "Configured" indicator** — on **API Credentials** (and the **Setup Guide** dialog), a configured secret shows a fixed-length dot-mask `••••••••••••` in the (still-blank-on-edit) box + a bolder **"Configured ✓"**. Confirm: clicking into the box clears the mask (blank), typing a new key + Save still works, and a blank Save still shows the "no change / unchanged" guard (never writes dots). **Supabase Personal Access Token** + **OpenRouter Management Key** read **(Optional)** and do NOT show the red "Not Configured" pulse when empty.
- [ ] **UI-1 plain setter labels** — AI Rep Config → **Voice Setter Names**: the four slots read plain **"Setter 1 / Setter 2 / Setter 3 / Setter 4"** (no "· Inbound/Outbound/Followup" suffixes). Custom names still save + push.
- [ ] **INB-1 inbound rebind pins `latest_published`** — use the inbound toggle to move the inbound setter, then check the Retell inbound phone binding: `inbound_agents[].agent_version` is now `"latest_published"` (not versionless / not a numeric pin), so inbound auto-follows future publishes.

## Session 7.5 — overnight Text-Setter repair + all-bugs (STAGED on branch `worktree-overnight+text-setter-repair-allbugs`; live-verify AFTER deploy)

> **Deploy FIRST, in daylight, per the `2026-07-01-overnight-text-setter-repair-allbugs` handoff deploy checklist** (VM-1's retell-proxy v46→v47 is **Voice-regression GATED** — see the handoff). Nothing below is live until deployed. All coded + unit-verified on the branch (test:node 80/0, test:edge 125/0, vite build green; adversarial review DONE-CONFIRMED).

- [ ] **BOOK-1 / 3.12 SMS booking (the acceptance test).** After the Trigger.dev deploy (BOOK-1 booking rules are CODE-owned via PROMPT-AUTH-1 — no prompt tweak needed; the Setter-1 migration removes the stale booking blob): text "can I book a meeting?" from a lead on an OPEN calendar → the setter offers ONLY real open times and **books on acceptance**. Proof in the new `tool_invocations` table (platform Supabase): a `get-available-slots` row (the prefetch) THEN a `book-appointments` row with a confirmed result, + a real GHL appointment. The setter must NOT say "booked out"/"snapped up" against open slots. (Supersedes the BLOCKED 3.12 item above.)
- [ ] **SMS-OBS-1 — tool invocations persisted.** After any SMS exchange that touches tools, `select * from tool_invocations where lead_id=... order by created_at` (platform Supabase, Mgmt API) shows the rows (name/args/result/error, `source='sms'`, the prefetch first). Confirms booking is no longer DB-blind. (The migration `20260701120000_tool_invocations.sql` must be applied first.)
- [ ] **MODEL-1-HARDENING — invalid model degrades, never 400s.** In a throwaway client (NOT BFD), set `clients.llm_model` to a bad value (`gemini-flash-latest` or `gptjunk`) via Mgmt API → an SMS still gets a reply (alias remaps / no-slash falls back to the default; no 400). Restore. (Do NOT touch BFD's `clients.llm_model`.)
- [ ] **F9-1 — locked voice setter refuses inline rename.** Retell-lock a voice setter → click its tile name heading and try to rename → refused with a clear "Retell-locked — unlock to rename" error and **no** `setter_display_names` write (the tile name is unchanged after refresh). Unlock → rename works again.
- [ ] **VM-1 — voicemail push lands (not "partial").** Set a `static` or `prompt` voicemail on the client Voicemail card → **Save & push** → result is **"voicemail_set"** success (NOT "Push partial"); the unlocked agents' `voicemail_option` updates; locked agents are skipped + reported. (Voice-regression gate must pass before deploying retell-proxy v47.) **Open question to confirm live:** that the new voicemail actually applies on the next call without a republish — if it does not, the daytime follow-up is draft-first+publish+repoint (see VM-1 note in the handoff).
- [ ] **PHONE-CLEAR-1 — clearing a phone clears the match key.** On a lead, clear the phone + Save → `select normalized_phone from leads where id=...` is **null** (Mgmt API); an inbound SMS from the old number no longer resolves to that lead. Changing the phone updates `normalized_phone` to the new E.164.
- [ ] **G3-8(a) — reactivation webhook fires server-side, no browser secret.** On a reactivation campaign, click **execute lead** → the webhook fires + the lead row reaches `completed`; in the browser Network tab the request goes to `execute-lead-webhook` (Supabase fn) and **no** `supabase_service_key` appears in any browser payload. A failure marks the row `failed` with the error.

## Retests after the relevant fix ships

- [ ] **B-5 / `{{first_name}}`** — a real inbound call from a number **NOT** in the CRM → the agent omits the name and never says the literal `{{first_name}}`. (NB: TEST_PHONE_A is a known lead, so B-5 needs a genuinely unknown number.)

## PROMPT-AUTH-1 — Text-setter prompt authoring/visibility rebuild (added 2026-07-03; DEPLOYED LIVE, partial regression confirmed)

> Root-caused live in Session 7-finish (2026-07-03): the Text setter refused a genuinely-open Monday (hidden
> `Available days: Tue/Wed/Thu ONLY` rule buried in the ~1680-line stored prompt) and then booked **Friday 4pm**
> for an accepted **"Thursday 2pm"** (un-interpolated `{{ $now }}` → no real "today" anchor). Bug = **PROMPT-AUTH-1**
> in `BUG_LIST.md`.
>
> **STATUS 2026-07-03: DEPLOYED LIVE** (main `6c5c339` + `157bb8f`, Trigger `20260703.1`, `save-external-prompt`
> v14, `get-external-prompt` v1, Railway). Adversarially verified pre-deploy (core booking-logic finding
> REFUTED — holds); 4 other findings confirmed and logged/fixed as their own bugs (SMS-MEM-1,
> FOLLOWUP-PROMPT-1, PROMPT-LINT-1 — see `BUG_LIST.md`, all fix-staged on `feature/overnight-bugfix`, not yet
> deployed). **A live multi-turn SMS regression already ran** (reported via a parallel session / shared memory,
> not independently re-verified by every session): booking succeeded (Wed 8 Jul 2:30pm Sydney,
> `bookings.source='sms'`), no "Tue/Wed/Thu", no "snapped up"/"booked out", confirmation named "Sydney time".
> That regression is what surfaced SMS-MEM-1 (a separate, pre-existing, unrelated bug). Given multiple parallel
> sessions have touched this, **re-confirm with a fresh SMS exchange** the next time a human is at the keyboard,
> especially once the `feature/overnight-bugfix` fixes (SMS-MEM-1 chat memory + FOLLOWUP-PROMPT-1 + PROMPT-LINT-1)
> are also deployed — they need their OWN live regression too.
>
> Still open below: **Full-prompt visibility** (X-Ray UI — not yet behaviorally confirmed) and **No leftover
> artifacts** (blocked on Brendan applying the Setter-1 content migration via the UI — report + proposed
> replacement at `Docs/investigations/prompt-migration-reports/e467dabc-57ee-416c-8831-83ecd9c7c925_Setter-1.report.md`,
> generated read-only via `scripts/report_text_prompt_migration.mjs --out <dir>`; steps are in that report) and
> **Efficiency** (not measured live). **Calendar-sourced availability** and **Date/time accuracy** are reported
> passed via the live regression above — do a quick spot-check, not a full re-run, unless something looks off.

- [ ] **Full-prompt visibility** — the operator can view the COMPLETE assembled system prompt a text setter
  sends (nothing load-bearing hidden) and can edit/override every availability + booking rule from the UI.
- [ ] **Calendar-sourced availability** — a text booking on an OPEN Monday succeeds; the setter never refuses a
  day the live calendar shows open (no stale hardcoded day-of-week rule can override the calendar). _Reported
  passed via the 2026-07-03 live regression (Wed 8 Jul offer, no fabricated day restriction) — spot-check only._
- [ ] **Date/time accuracy** — accept a specific offered slot → `book-appointments` books that EXACT day + time
  (real "now" injected, no `{{ $now }}` literal), and the confirmation label matches the booked date. _Reported
  passed via the 2026-07-03 live regression — spot-check only._
- [ ] **No leftover artifacts** — no `{{ … }}` n8n expressions, no duplicated/contradictory sections, and the
  tool names referenced in the prompt match the real tools (`get-available-slots` / `book-appointments`).
  **BLOCKED on Brendan applying the Setter-1 migration** (`BRENDAN_TODO.md`).
- [ ] **Efficiency** — the assembled prompt is materially leaner; tool-calling + date accuracy hold on the fast
  model (`google/gemini-2.5-flash`). **BLOCKED on the Setter-1 migration landing** (current stored prompt is
  still the un-migrated 1680-line version until Brendan applies it).

## SMS-MEM-1 / FOLLOWUP-PROMPT-1 / PROMPT-LINT-1 / MODEL-1-HARDENING (UI) — retest AFTER `feature/overnight-bugfix` deploys

> All fix-staged on branch `feature/overnight-bugfix` as of 2026-07-03. The overnight part-2 run (same date,
> later) FINISHED the branch: MODEL-1's UI half is committed, all 6 adversarial-review findings are fixed, and
> API-DEPR-1 + VM-1 landed on the same branch (final suite: test:node 122/122, test:frontend 8/8,
> test:edge 202/202, tsc + vite build green). NOT yet deployed. NOTE the deploy now includes EDGE FNS
> (retell-proxy v48, verify-credentials, save-external-prompt's shared lint module) + Trigger.dev + frontend —
> see the 2026-07-03 overnight handoff for the exact checklist.

- [ ] **SMS-MEM-1 — multi-turn SMS has real memory.** Send 2+ messages in one conversation (e.g. state a day,
  then separately accept a time) → the setter does NOT re-ask something already answered, and
  `select * from chat_history where session_id=... order by timestamp` (client's external Supabase) now shows
  alternating `human`/`ai` rows, not `ai`-only. (Known accepted behavior: if a run hard-fails before STEP 6 on
  both attempts, that inbound turn is not persisted — the retry-safe placement trade-off.)
- [x] **FOLLOWUP-PROMPT-1 — automated follow-up respects the same date/availability ground truth. DONE 2026-07-05 (Test-finish, autonomous): PASS → `COMPLETED_LOG.md`.** Seeded a "not interested" external `chat_history` + a pending `followup_timers` row → `push-followup-now` → `sendFollowup` decided `cancelled` (0 outbound); `raw_exchange` shows the injected `## Live calendar availability (ground truth…)` block (real GHL slots, follow-up one-way variant, names no tools) + the `## Current date & time (ground truth)` anchor + the stale-`{{ $now }}` neutralizer line. _Original spec:_ Let a cold
  lead trigger a cron follow-up → the copy never states a fabricated day policy or a literal `{{ $now }}`-style
  artifact, and never "offers to check the calendar" (the followup-mode availability block names no tools —
  review follow-up `29ce9a4`). `nudgeColdReply` confirmed NOT to need the fix (no `text_prompts` read, no
  booking loop). Bonus check: `followup_timers.raw_exchange` shows the availability block was injected.
- [ ] **PROMPT-LINT-1 — lint bypasses closed, on the RIGHT store.** (a) In Prompt Management, saving text content
  containing `BookAppointment` (Pascal-case) / `GET_AVAILABLE_SLOT` (caps) / a `Mon-Fri` day restriction is
  BLOCKED with the offending line flagged. (b) NEW (review follow-up `d8111d6`): the same `Mon-Fri` policy typed
  into **Follow-up Instructions on the AgentSettingsCard** is ALSO blocked (that card writes `agent_settings`,
  which is what `sendFollowup` actually reads). (c) False-positive check: copy containing "wedding-friendly" or
  "thumb-friendly" saves CLEAN.
- [ ] **MODEL-1-HARDENING (UI) — unknown model id needs explicit confirmation.** In the OpenRouter model
  selector, typing a made-up/invalid model id and clicking "use as custom" no longer applies it silently —
  it shows an "unknown id, may not exist" warning requiring an explicit "Use anyway" click; a real known id
  still applies on one click. NEW (review follow-up `19a6fb4`): typing a KNOWN id in the wrong case (e.g.
  `Google/Gemini-2.5-Flash`) saves the canonical lowercase id.

## Overnight part-2 additions (same branch + `g3-7/vite-major`) — retest AFTER deploy

- [ ] **VM-1 — voicemail push lands AND survives a call (refined fix `acfc387`; retell-proxy v47→v48,
  Voice-gated).** Save & push mode=`prompt` → full "voicemail_set" success (NOT "partial"); all 5 push targets'
  `voicemail_option` updated (draft→publish→repoint now runs per agent); locked setters skipped + reported;
  then ONE answered-call booking regression to confirm v48 didn't disturb the frozen call path, and (if
  practical) an unanswered call to hear the voicemail. `static` mode now emits `static_text` — try one static
  push too.
- [ ] **API-DEPR-1 — v2 list-agents serves the UI.** After deploying retell-proxy + verify-credentials:
  VoiceAIRepSetup → Agents tab lists the agents with full detail (name/version/published/engine — now hydrated
  via get-agent, one row per agent instead of legacy version-expanded rows); API Credentials → Verify shows
  Retell "Connected"; Retell dashboard deprecation notice stops firing on the next sweep.
- [ ] **F9-1 residual — locked rename refused EVERYWHERE.** With a setter Retell-locked: rename via the tile
  heading AND via the prompt-doc page header → both refuse with a clear Retell-locked error; on a stale-lock
  race the display name REVERTS instead of soft-warning (no tile/Retell name mismatch left behind).
- [ ] **PHONE-CLEAR-1 residual — Contacts dialog + Chats panel.** Edit a lead's phone via the CONTACTS edit
  dialog (not ContactDetail) → `normalized_phone` follows; clear it → NULL; add a NEW contact via the dialog →
  `normalized_phone` is set (lead is inbound-matchable).
- [ ] **G3-7 — app on vite 8 (MERGED to `main` `407b66e` + LIVE on Railway, Session 10 2026-07-04).** The merge +
  headless gates are done (build/tsc/test:frontend/audit green, preview + dev server both served all routes 200 on
  vite 8). REMAINING = the live human browser click-through: open `app.buildingflowdigital.com` (or `npm run dev`
  with `CHOKIDAR_USEPOLLING=true` until the inotify sysctl is raised) → confirm the app renders and a few pages
  navigate (login/dashboard, a setter/prompt page, contacts) with no console errors on the vite-8 prod bundle. Then
  G3-7 → `COMPLETED_LOG.md`.

## 2026-07-05 BUILD PASS retests

Deployed/live (schema + edge + frontend), confirm behaviorally:
- [ ] **SWEEP-1a: /account-settings loads.** Open `/account-settings` as agency + as a client → the My Account
  billing card renders with NO console 400 on `clients_public` (stripe/subscription fields show blank until Stripe).
- [ ] **SWEEP-1b: /chats star + dismiss.** Open `/chats` → NO 404 for `chat_starred` / `dismissed_error_alerts`;
  star a conversation (persists across reload), dismiss a lead-error banner (stays dismissed). Confirm a client-role
  user can star/dismiss its OWN rows (RLS).
- [ ] **SWEEP-1c: /logs names hydrate.** Open `/logs` Errors + Bookings + Outbound-calls tabs → lead names hydrate,
  NO "invalid input syntax for uuid" 400 in the console.
- [ ] **SYNC-LOG-1: intake audit persists.** Trigger a `sync-ghl-contact` intake → one `sync_ghl_executions` row is
  written (client_id, external_id, status, steps). (Was silently no-oping on a missing table.)
- [ ] **G3-6-SCHEMA-1: analytics still run.** Run chat analytics for BFD (Analytics V2 / analyze-chat-history) →
  reads the external `chat_history` and returns results unchanged (column was null; now hardcoded). Deployed
  analyze-chat-history v19 / analytics-v2-process v19 / compute-analytics v16.

STAGED, needs Brendan's supervised deploy + regression (voice-booking-tools is the frozen live baseline):
- [ ] **CANCEL-1: SMS + voice cancel/reschedule bind a real eventId.** After deploying voice-booking-tools
  (`deploy_single_fn.mjs`) + the Trigger.dev bundle: (SMS) book via `scripts/test-harness/sms_inbound.mjs`, then
  "cancel that meeting" → the cancel hits the REAL GHL eventId (no 404), the appointment flips cancelled, the
  `bookings` row flips `status='cancelled'` (assert via `q.mjs`). Repeat a reschedule. (Voice) place an answered call
  and cancel/reschedule an existing appt → same. Confirm a fabricated-id attempt is refused with the real list folded
  back (check `tool_invocations`), never a false "done".
- [ ] **BOOK-2/BOOK-3: booking regression holds.** After the same deploy, run a voice + an SMS booking end-to-end
  (`dial.mjs` + `sms_inbound.mjs`) → books the exact accepted Sydney time, no false "unavailable", window not
  day-shifted. (These change the frozen slot path, run the full booking regression.)
- [ ] **SMS-METER-1: mid-call text meters.** After deploy, have a voice agent send a mid-call SMS → a
  `message_queue` `channel='sms_outbound'` row appears (ghl_account_id = location id or client uuid) and F13 usage
  counts it.

## Standing rule

- After **any** BUG or FEATURE ships, smoke the touched area before marking it done here.
