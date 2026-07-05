---
description: Test-finish session (2026-07-05, autonomous) — RUN 4 (F3/F4/FOLLOWUP-PROMPT-1) + RUN 7 (F1) all PASS, SYNC-LOG-1 logged, API-DEPR-2(a)+F13 client-eye carried to Fable; carries the Build + Fable relay prompts.
---

# Test-finish handoff — 2026-07-05 (autonomous)

Finished every remaining drivable live-verify item from the 2026-07-05 TEST SESSION, fully autonomous
(no human), send-free. Harness only: Mgmt-API SQL (`scripts/test-harness/q.mjs`), service-key edge fns,
the Trigger.dev v1 REST endpoint (`TRIGGER_PROD_API_KEY`), and the GHL / Retell REST APIs. All test-writes
reverted, all artifacts deleted. `retell-proxy` (v49) + `voice-booking-tools` untouched; no prompt content
edited. RUN 0 self-verify: clean `main` `43fec47`, retell-proxy v49 + all fns ACTIVE.

## Results (all PASS → moved to `Docs/archive/COMPLETED_LOG.md`)

- **RUN 7 · F1 — GHL conversation deep-link.** Fresh GHL contact `ZhJUVbYR06J4ZtHhEFsv` → `sync-ghl-contact`
  (`x-wh-token`) → `{status:created, contact_id:9f078a4f-…}`. GHL custom field `4tDL3asiRNrQD3MKyP2E` =
  `https://app.buildingflowdigital.com/leads/9f078a4f-…` (the new lead's uuid), the ONLY custom field (one
  write), **0 outbound SMS**, enrollment skipped. Send-free via a brief null+restore of
  `clients.auto_engagement_workflow_id` (its node 0 is an immediate `engage` SMS; Brendan pre-approved).
  Cleaned up (GHL contact deleted, leads row deleted).
- **RUN 4 · F4 — timezone nudge SKIP.** BFD tz forced out of the 09:00-20:00 window (Pacific/Honolulu) + one
  `nudge-cold-reply` run → `{scanned:3, nudged:0, skipped:3, errors:0}`. Seed cold lead `nudge_count` stayed
  0, NOT tagged_silent (reached and stopped by the tz gate specifically), 0 sends anywhere. tz restored.
  (In-window positive deliberately not run — a blanket trigger would nudge every other live cold lead.)
- **RUN 4 · F3 — cadence pause / resume / END NOW.** Throwaway 2-delay-node workflow; node0 completed
  (`lcni=0`, run parked in node1's 3600s delay) → PAUSE (`status=paused`, `completed_at`/`stop_reason` NULL,
  no metric finalize) → RESUME (new `trigger_run_id`, `status=running`, resumes at index 1, node0 not re-run
  = double-send guard) → END NOW (`cancelled`, `stop_reason=manual_stop`). Zero sends. All rows cleaned up.
  (Harness note: `trigger-engagement` needs `workflow_id` IN THE BODY — it does not derive it from the
  campaign; and `null >= 0` is `true` in JS, so guard the lcni poll with `=== 0`.)
- **RUN 4 · FOLLOWUP-PROMPT-1 — follow-up injects availability + time anchor.** Seeded a "not interested"
  external `chat_history` + a pending `followup_timers` row → `push-followup-now` → deployed `sendFollowup`
  decided `cancelled` (0 outbound). `raw_exchange` shows the fix's injected blocks: `## Live calendar
  availability (ground truth — already fetched for you this turn)` with real GHL slots, the follow-up
  ONE-WAY variant (names no booking tools), the `## Current date & time (ground truth)` anchor, and the
  explicit stale-`{{ $now }}` neutralizer line. Send-free; seed rows (platform + external) cleaned up.

## Deferred / new

- **API-DEPR-2(a)** (presets-on-agent after a clean voice-setter Save) — **carried to the Fable session.**
  `retell-proxy` requires a real user JWT (no service-key fast path: `assertClientAccess` → `auth.getUser`),
  so it cannot be replayed server-side, and hand-reconstructing a full voice payload against a live shared
  agent is unsafe (EE1 fan-out precedent). Fable does a voice-setter save/deploy on a fresh THROWAWAY agent
  → assert the 3 `type:"system-presets"` there (folded into Prompt C). API-DEPR-2(b) already PASSED live 07-05.
- **F13 client-EYE view** — still needs a client-role user → Fable (Prompt C step 4).
- **NEW BUG — SYNC-LOG-1 (Low).** `sync-ghl-contact` `logExecution()` inserts into `public.sync_ghl_executions`,
  which does not exist in prod → the intake step-audit silently no-ops (non-fatal; F1 proven directly off the
  GHL field). Same class as SWEEP-1(b). Logged in `BUG_LIST.md`.

## What's left to v1 100% (unchanged): Build-all-bugs → Fable onboarding → F15/F16 → First-Client Milestone.

---

# RELAY PROMPTS

## ▶ Prompt B — BUILD: fix every open bug

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON for anything touching voice-booking-tools /
retell-proxy / live cadence or new schema; execute for isolated frontend/edge fixes.

BFD-setter — BUILD PASS: fix EVERY open bug. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds ./.env. Live DB via Supabase Management API /database/query (NOT
postgres MCP). NEVER edit prompt CONTENT (report-only). Verify read-only before claiming done. No em dashes.
Relay Protocol in Docs/SESSION_PLAN.md. READ FIRST: Docs/BUG_LIST.md (every open item), the 2026-07-05
test-session handoff, and Operations/handoffs/2026-07-05-test-finish.md.

FIRST reconcile BUG_LIST: several [~] items are DEPLOYED and now live-verified (SMS-MEM-1, FOLLOWUP-PROMPT-1,
PROMPT-LINT-1, VM-1 push, MODEL-1-HARDENING, F9-1, PHONE-CLEAR-1, SMS-OBS-1 via the 2026-07-05 test session +
this test-finish) — move each verified one to COMPLETED_LOG rather than rebuilding it. THEN fix, test, and
deploy per surface (edge via scripts/deploy_single_fn.mjs; Trigger via TRIGGER_DEPLOY_PAT; frontend via main
push). One logical commit each. Open set to build (reconcile against BUG_LIST at run time):
- SWEEP-1a: /account-settings 400 — clients_public lacks stripe_customer_id / subscription_start_date /
  subscription_end_date. Add the columns (needed at the Stripe milestone anyway) or narrow the AccountSettings
  select to existing columns until then.
- SWEEP-1b: /chats 404 — ship the chat_starred + dismissed_error_alerts tables with client-scoped RLS +
  the unique keys the upserts assume (unique(client_id, lead_id) / (client_id, error_log_id)).
- SWEEP-1c: Logs/ErrorLogs/Chats query leads by uuid id with a text lead_id → use .in('lead_id', ids).
- SYNC-LOG-1: create the sync_ghl_executions table (client-scoped RLS) so sync-ghl-contact's intake audit
  persists, OR drop the dead logExecution calls if the audit surface isn't wanted.
- G3-6-SCHEMA-1: split the overloaded clients.supabase_table_name (leads-table vs chat-table), or hardcode
  chat_history in analyze-chat-history like its siblings so the column means one thing.
- CANCEL-1 (SMS/voice cancel+reschedule eventId binding — SHARED voice-booking-tools; plan ON; pair with
  BOOK-2 + BOOK-3 + SMS-METER-1 in the SAME supervised shared-fn pass, with a voice + SMS booking regression
  after). Add an id-binding validator (mirror slotBinding): the model may only pass an eventId that appeared
  in a prior get-contact-appointments result this conversation; reject fabricated ids with the real list
  folded back. Also check whether get-contact-appointments returns stale vs upcoming appts.
- Plus any other open BUG_LIST item after the reconcile.
PU-8 + any PROMPT_UPDATE_LIST items stay report-only (Brendan applies via the UI) — list them for him.
Add a retest row to TEST_LIST for each fix. Close out per the Relay Protocol; hand back to testing.
```

## ▶ Prompt C — FABLE end-to-end onboarding (find holes in the whole system + the SOP)

```
SETTINGS: Model Fable (or Opus 4.8 [1m]) · Thinking HIGH · Mode: execute · run OVERNIGHT.

BFD-setter — END-TO-END NEW-CLIENT ONBOARDING via the SOP, driven by Playwright, to find holes across
EVERY touchpoint and to discover what else is needed to onboard a real client.

Repo /srv/bfd/Projects/bfd-setter. Creds ./.env. Supabase ref bjgrgbgykvjrsuwwruoh. NEVER edit prompt
CONTENT. No em dashes. READ FIRST: Company/knowledge (CLIENT_ONBOARDING_SOP + the onboarding SOP rebuild
memory), Docs/TEST_SESSION.md, the 2026-07-05 test-session handoff, Operations/handoffs/2026-07-05-test-finish.md
+ scripts/test-harness/README.md (reuse the harness: headless Playwright login via magic-link + ONE TOTP,
signed inbound-SMS sim, programmatic dials, Mgmt-API SQL). This is the CANONICAL 100% gate: prove a
brand-new client can be stood up and works.

Do, systematically, capturing a screenshot + a DB/Retell assertion at every step:
1. Create a NEW throwaway sub-account through the UI exactly as the SOP says (New Sub-Account -> general,
   credentials, GHL, Twilio BYO, timezone, pricing). Note every field the SOP omits or that has no UI.
2. Walk the FULL setter setup: text setter + at least one voice setter (prompt authoring, save/deploy,
   Retell push), inbound number bind, voicemail push, model selection. Assert each lands live.
   >> API-DEPR-2(a) (carried from the Test-finish session — retell-proxy needs a real user JWT, so it must
      run through the UI Save; do it HERE on this throwaway agent, zero risk to the 5 canonical agents):
      after the voice-setter Save, GET the agent (Retell REST /get-agent with BFD_RETELL_API_KEY or the MCP)
      and confirm post_call_analysis_data now carries the 3 type:"system-presets" entries
      (call_summary / call_successful / user_sentiment) + any existing custom fields, no dupes, and that the
      3 deprecated analysis_*_prompt fields are ABSENT. That closes API-DEPR-2.
3. Exercise the NEW client end-to-end with the harness: a signed inbound SMS booking (SMS-MEM-1/OBS-1/
   BOOK-1), a programmatic outbound voice booking, a voicemail, an inbound-from-unknown, cadence enrol,
   analytics. Clean up all bookings/leads after. (Note: F1 deep-link is naturally send-free on a fresh
   client — a new sub-account has no auto_engagement_workflow_id, so no cadence fires; verify F1 here too
   without the null-and-restore dance the dogfood client needed.)
4. F13 CLIENT-EYE view (the Test-finish session could NOT — no client user existed): invite/create the new
   client's client-role user, log in AS the client, verify the rate card shows when show_rate on and NOTHING
   when all toggles off, and the 4-toggle matrix from the client's eyes.
5. Produce an ONBOARDING GAP REPORT: every manual step with no automation, every SOP field that is unclear
   or missing, every credential/provision needed (GHL custom fields, ghl_channel_field_id, conversation
   provider, A2P, Retell folder, etc.), and everything that broke. File gaps -> BUG_LIST / BRENDAN_TODO /
   the SOP; prompt-content gaps -> PROMPT_UPDATE_LIST. This report is what tells Brendan what a real
   first-client onboarding actually needs.
Delete the throwaway client + all its test data at the end (or leave it clearly tagged for Brendan).

▶ After this + the build pass, the only things between here and v1 100% are F15/F16 (market-research
features) and the event-gated First-Client Milestone. See Docs/TEST_SESSION.md RUN 10.
```
