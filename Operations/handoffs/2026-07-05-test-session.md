---
description: TEST SESSION 2026-07-05 results (largely automated), bugs found, reusable test harness, and the three relay prompts to reach v1 100% (finish-runs -> build-all-bugs -> Fable onboarding).
---

# TEST SESSION handoff — 2026-07-05

Claude drove this pass **largely autonomously** using a new test harness (headless Playwright as the
agency user via a magic-link + one TOTP; Twilio-signed inbound-SMS simulation; programmatic Retell dials
via the service key; Mgmt-API SQL). Only 3 real phone calls needed Brendan. Harness is persisted in
`scripts/test-harness/` (README documents every technique).

## Verified PASS (move to COMPLETED_LOG)
- **RUN 0** self-verify: clean `main`, node 122/0, edge 208/0, retell-proxy **v49** + all fns ACTIVE, live
  frontend current.
- **RUN 1** (headless, all 17 agency routes): **G3-7** vite-8 render clean; **F11** masked-Configured;
  **UI-1** plain labels; **F8** live edit-save (markup 300→350%→revert persisted) + blended **$0.45/min**
  hand-checked; **F13** margin + period/anchor + 4-toggle flip (+ `show_rate_to_client` mirror) + volumes
  vs SQL (voice 3min/1call, SMS 19); **PROMPT-LINT-1** (all bypass cases); **MODEL-1** (8/8); **API-DEPR-1**
  (v2 list-agents 200); **F9-1** locked-rename REFUSED (no display-name write); **PROMPT-AUTH-1 X-Ray**
  (full assembled prompt + matches badge).
- **RUN 2** voice (3 calls): **VOICE GATE** answered booking on v49 (`call_4b1136b5`, booked, clean
  hangup); **API-DEPR-2(b)** top-level analysis (call_successful:true, sentiment Positive); **VM-1 push**
  (all 5 agents → prompt, NO "partial" — v48 fix CONFIRMED) + **VM-1 plays** (real voicemail, 15s);
  **B-5** (inbound from `anonymous` → no `{{first_name}}`) + **PU-6 recording disclosure present**.
- **RUN 3** SMS (signed-webhook multi-turn to TEST_PHONE_A): 3.12 booking, **SMS-OBS-1**, **SMS-MEM-1**
  (alternating human/ai, no re-ask), **BOOK-1/BOOK-3** (books exact accepted Sydney time), STOP respected.
- **RUN 5** analytics data path (chat_history 250 rows, `timestamp` range OK).
- **RUN 6** B-2 outage: inbound never dropped, `bfd-<phone>` synthetic lead, `ghl_contact_resolve_degraded`
  (not `_failed`), Twilio-direct reply, 0 dups, key restored.

## Bugs found (in BUG_LIST unless noted)
- **CANCEL-1** (Medium) — SMS cancel/reschedule fails: model passes a HALLUCINATED `eventId` to
  `cancel-appointments` → GHL 404. The tool itself works (direct PUT = 200). Shared `voice-booking-tools`,
  so voice likely affected too. Id-binding gap (the cancel analogue of BOOK slot-binding).
- **SWEEP-1** (a/b/c) — live console/data errors: `/account-settings` 400 (clients_public missing
  stripe_customer_id/subscription_start_date/subscription_end_date), `/chats` 404 (missing `chat_starred` +
  `dismissed_error_alerts` tables), `/logs` 400 (leads queried by uuid `id` with a text `lead_id`).
- **G3-6-SCHEMA-1** (Low) — `clients.supabase_table_name` overloaded (leads-table vs chat-table).
- **PU-8** (PROMPT_UPDATE_LIST, report-only) — voicemail says literal `[Your Name]` placeholder.

## Still owed (the next session does these — see Prompt A)
- **API-DEPR-2(a)** presets-on-agent after a clean voice-setter Save (headless Save button was elusive —
  try `save-external-prompt` directly, or a cleaner Playwright selector).
- **RUN 4** — F3 cadence pause/resume, F4 tz nudge-skip, FOLLOWUP-PROMPT-1 (Trigger flows).
- **RUN 7** — F1 fresh GHL contact deep-link (creates a real GHL contact; clean up).
- **F13 client-EYE view** — needs a client-role user → covered by the Fable onboarding (Prompt C).
- Cleanup: delete test lead `bfd-+61400000199` if desired.

---

# RELAY PROMPTS

## ▶ Prompt A — finish EVERY remaining run autonomously (paste into a fresh session)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (plan ON only if a fix touches
retell-proxy / voice-booking-tools / the live cadence runtime).

BFD-setter — AUTONOMOUS TEST-FINISH. Complete every remaining live-verify item from the 2026-07-05
TEST SESSION, using the harness in scripts/test-harness/ (README documents it: Mgmt-API SQL, signed
inbound-SMS simulation, programmatic Retell dials via the service key, headless Playwright login via
magic-link + ONE TOTP). Ask Brendan for a single 6-digit TOTP only if/when you need the authenticated
browser; everything else is service-key / webhook / Mgmt-API and needs no human.

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh.
Creds in ./.env. NEVER edit voice/text prompt CONTENT (report-only). retell-proxy + voice-booking-tools
are the FROZEN Voice baseline. Verify read-only before claiming done. No em dashes. Relay Protocol in
Docs/SESSION_PLAN.md. READ FIRST: Operations/handoffs/2026-07-05-test-session.md, Docs/TEST_SESSION.md,
Docs/TEST_LIST.md (the 2026-07-05 "STILL OWED" block).

Scope (drive automatically, clean up all test data, revert all test-writes):
1. API-DEPR-2(a): do a clean voice-setter Save (headless, or call save-external-prompt with the service
   key) -> confirm the agent's post_call_analysis_data gains the 3 type:"system-presets" entries.
2. RUN 4 F4: set clients.timezone so the local hour is OUTSIDE 9am-8pm, trigger nudgeColdReply (find the
   invocation - Trigger task or an edge fn), confirm the cold lead is SKIPPED (no send); set in-window to
   confirm it nudges ONLY if you can route the send to TEST_PHONE_A safely; restore Australia/Sydney.
3. RUN 4 F3: enrol a throwaway lead in a short test cadence to TEST_PHONE_A (signed-inbound trick can seed
   it), PAUSE before step 2 (no sends while paused), RESUME (no double-send), END NOW cancels cleanly.
4. RUN 4 FOLLOWUP-PROMPT-1: confirm a cron follow-up's copy names no fabricated day policy / no {{ $now }}
   and followup_timers.raw_exchange shows the injected block.
5. RUN 7 F1: create a FRESH test GHL contact that posts to sync-ghl-contact (tag-add/intake) -> confirm the
   "BFD Conversation Link" field = https://app.buildingflowdigital.com/leads/<uuid>, one write, no 2nd SMS;
   clean up the test contact.
6. Any other TEST_LIST residuals you can drive.
Move passes to Docs/archive/COMPLETED_LOG.md; new bugs to Docs/BUG_LIST.md. Close out per the Relay
Protocol. THEN EMIT TWO PROMPTS at the end of your run:
  (B) a BUILD prompt that fixes EVERY open bug (this session's + the 2026-07-05 session's + any others in
      BUG_LIST) - see the seed list in the handoff; and
  (C) the FABLE end-to-end onboarding prompt (below, verbatim, refreshed for anything you learned).

▶ PIPELINE: [✓] Test session (2026-07-05)  [•] Test-finish (here)  [ ] Build-all-bugs (B)  [ ] Fable onboarding (C)  [ ] F15  [ ] F16  [ ] First-Client Milestone (gated)
```

## ▶ Prompt B — BUILD: fix every open bug (the test-finish session refines + emits this)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON for anything touching voice-booking-tools /
retell-proxy / live cadence or new schema; execute for isolated frontend/edge fixes.

BFD-setter — BUILD PASS: fix EVERY open bug. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds ./.env. NEVER edit prompt CONTENT. Verify read-only before done.
No em dashes. READ FIRST: Docs/BUG_LIST.md (every open item) + the 2026-07-05 handoff.

Fix, test, and deploy per surface (edge via scripts/deploy_single_fn.mjs; Trigger via TRIGGER_DEPLOY_PAT;
frontend via main push). One logical commit each. Known open set to fix (reconcile against BUG_LIST at
run time - add anything the test-finish session logged):
- CANCEL-1 (SMS/voice cancel+reschedule eventId binding - SHARED voice-booking-tools; plan ON; pair with
  BOOK-2 + BOOK-3 + SMS-METER-1 in the same supervised shared-fn pass, with a voice + SMS regression after).
- SWEEP-1a (add/adjust the clients_public subscription columns or narrow the AccountSettings select).
- SWEEP-1b (ship chat_starred + dismissed_error_alerts tables with client-scoped RLS + the unique keys).
- SWEEP-1c (Logs/ErrorLogs/Chats query leads by lead_id, not uuid id).
- G3-6-SCHEMA-1 (split the overloaded supabase_table_name, or hardcode chat_history in analyze-chat-history).
- Plus every other open BUG_LIST item (BOOK-2/3, SMS-METER-1, and whatever the test-finish session added).
PU-8 + any other PROMPT_UPDATE_LIST items stay report-only (Brendan applies via the UI) - list them for him.
Add a retest row to TEST_LIST for each fix. Close out per the Relay Protocol; hand back to testing.
```

## ▶ Prompt C — FABLE end-to-end onboarding (find holes in the whole system + the SOP)

```
SETTINGS: Model Fable (or Opus 4.8 [1m]) · Thinking HIGH · Mode: execute · run OVERNIGHT.

BFD-setter — END-TO-END NEW-CLIENT ONBOARDING via the SOP, driven by Playwright, to find holes across
EVERY touchpoint and to discover what else is needed to onboard a real client.

Repo /srv/bfd/Projects/bfd-setter. Creds ./.env. Supabase ref bjgrgbgykvjrsuwwruoh. NEVER edit prompt
CONTENT. No em dashes. READ FIRST: Company/knowledge (CLIENT_ONBOARDING_SOP + the onboarding SOP rebuild
memory), Docs/TEST_SESSION.md, the 2026-07-05 handoff + scripts/test-harness/README.md (reuse the harness:
headless Playwright login via magic-link + ONE TOTP, signed inbound-SMS sim, programmatic dials, Mgmt-API
SQL). This is the CANONICAL 100% gate: prove a brand-new client can be stood up and works.

Do, systematically, capturing a screenshot + a DB/Retell assertion at every step:
1. Create a NEW throwaway sub-account through the UI exactly as the SOP says (New Sub-Account -> general,
   credentials, GHL, Twilio BYO, timezone, pricing). Note every field the SOP omits or that has no UI.
2. Walk the FULL setter setup: text setter + at least one voice setter (prompt authoring, save/deploy,
   Retell push), inbound number bind, voicemail push, model selection. Assert each lands live.
3. Exercise the NEW client end-to-end with the harness: a signed inbound SMS booking (SMS-MEM-1/OBS-1/
   BOOK-1), a programmatic outbound voice booking, a voicemail, an inbound-from-unknown, cadence enrol,
   analytics. Clean up all bookings/leads after.
4. F13 CLIENT-EYE view (this session could NOT - no client user existed): invite/create the new client's
   client-role user, log in AS the client, verify the rate card shows when show_rate on and NOTHING when
   all toggles off, and the 4-toggle matrix from the client's eyes.
5. Produce an ONBOARDING GAP REPORT: every manual step with no automation, every SOP field that is unclear
   or missing, every credential/provision needed (GHL custom fields, ghl_channel_field_id, conversation
   provider, A2P, Retell folder, etc.), and everything that broke. File gaps -> BUG_LIST / BRENDAN_TODO /
   the SOP; prompt-content gaps -> PROMPT_UPDATE_LIST. This report is what tells Brendan what a real
   first-client onboarding actually needs.
Delete the throwaway client + all its test data at the end (or leave it clearly tagged for Brendan).

▶ After this + the build pass, the only things between here and v1 100% are F15/F16 (market-research
features) and the event-gated First-Client Milestone. See Docs/TEST_SESSION.md RUN 10.
```
