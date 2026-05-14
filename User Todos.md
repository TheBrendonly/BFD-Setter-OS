# User Todos — BFD-setter

Brendan's checklist to take BFD-setter from "shipped behind flags" to "first paying client live + onboarded."

Items are sequenced. Order matters — do them top-to-bottom. Each item links to the section in `Operations/handoffs/2026-04-30-1prompt-master-rebuild-handoff.md` (the master state-of-play) or to the SOP at `Docs/CLIENT_ONBOARDING_SOP.md`.

Effort: S = under 30 min, M = 30 min - 2 hr, L = half day+.

---

## Phase A — Make BFD live on the new stack (before sign Client #2)

These are sequential. 8 items. Total ~half day of effort spread over 2-3 weeks (most of the time is the soak window).

### A1. ~~Cadence copy review on workflow~~ `40e8bea3-…`  ✅ DONE 2026-05-03
- Workflow nodes restructured from `delay`-between-engages to `wait_for_reply`-between-engages so the Engagement editor canvas renders (3 schema bugs surfaced + fixed: `engagement_workflows` missing `sort_order`/`is_active`, `engagement_campaigns` missing `enroll_webhook_token`/`text_setter_number`, BFD's nodes incompatible with the editor's expected model).
- Copy edits applied via SQL in the same migration (n1 SMS dropped "Building Flow Digital", n2 timing 2m→1m, n4 timing 28m→1s, n7 SMS dropped "got a window today", n9 instructions stripped voicemail line).
- Editor at `/client/e467dabc-.../workflows/engagement?wf=40e8bea3-...` now renders cleanly. Cards visible on Campaigns tab.
- Tags shipped: `phase-night-engagement-workflows-missing-cols` (`9578fd5`), `phase-night-engagement-campaigns-missing-cols` (`9233674`), `phase-night-bfd-cadence-restructure-for-editor` (`4595805`).
- DO NOT enable auto-enrolment yet — that's A7.

### A2. Phase 9 cutover for BFD only  *(S, 10 min + 48h passive watch)*
- Wait until the next session ships D-M1 (diff harness — see "Next session prompt" below).
- Eyeball the diff between `processSetterReply` and n8n on 5 historical messages.
- If clean: `UPDATE clients SET use_native_text_engine = true WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';`
- Watch `error_logs WHERE source='process-setter-reply'` for 48 hr.
- Roll back instantly with the inverse SQL if anything spikes.

### A3. ~~Repoint Retell + ElevenLabs voice tool URLs~~  ✅ DONE 2026-05-04
- BFD has ONE Retell agent (`agent_5ec5eb…`) on ONE LLM (`llm_22e795de…`). The "3 agents" assumption in the original spec was wrong — only inbound is provisioned. ElevenLabs is not in active use for BFD, so its hardcoded URL was not touched.
- All 5 tool URLs repointed in the Retell UI from `https://n8n-1prompt.99players.com/webhook/e4cffeea-…` to `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=<name>&clientId=e467dabc-…`.
- `Authorization: Bearer <intake_lead_secret>` header added to all 5 tools (mandatory, not optional — `voice-booking-tools/index.ts:106-113` enforces 401 when the client has a secret set).
- End-to-end test passed: call `call_211ba69142d19f295bbcef6e904` (92s, agent_hangup, sentiment Positive) → `bookings` row `aa10c0dc-…` written with `source=voice_call`, `ghl_appointment_id=j1dUa0ySnaIr0KSdmHzH` (since cancelled + DB row deleted as test-data cleanup). Zero errors in `error_logs`.
- New artefacts: `Docs/WEBHOOKS.md` (every webhook URL in the system, per-client templates), `scripts/snapshot_voice_tools.mjs` (read-only inventory tool).
- Follow-ups (all closed 2026-05-06):
  - (a) `bookings.cadence_execution_id` null because A7 was off — A7 now flipped (see A7 below); next live booking should populate this.
  - (b) ✅ `call_history.appointment_booked` mapping fixed — `phase-night-a3-followup2-appointment-booked-mapping` (`72823a8`) extends the OR-chain to recognise Retell's `custom_analysis_data["Call result"] = "Call Booked"` shape.
  - (c) ✅ Voice-tool timezone default fixed — `phase-night-a3-followup3-timezone-default` (`c4499ed`) makes `get-available-slots` fall back to `clients.timezone` when none provided. BFD's default is `Australia/Sydney`.

### A4. ~~Wire GHL Calendar workflow → `bookings-webhook`~~  ✅ DONE 2026-05-05
- Two workflows shipped (one per status, since GHL workflow merge tags don't expose `appointmentStatus` / `calendarId` / `locationId` — those have to be hardcoded per-trigger):
  - **`BFD bookings → 1prompt (BOOKED)`**: Appointment Status trigger × 2 rows (filter=`new`, filter=`confirmed`) → Custom Webhook POST with `status=confirmed` hardcoded.
  - **`BFD bookings → 1prompt (CANCELLED)`**: Appointment Status trigger (filter=`cancelled`) → Custom Webhook POST with `status=cancelled` hardcoded.
- Both workflows POST `application/x-www-form-urlencoded` to `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook` with 8 key-value rows: `appointmentId={{appointment.id}}`, `contactId={{contact.id}}`, `calendarId=2p9eg0Qv7QoKknk1Sp2d` (hardcoded), `locationId=xo0XjmenBBJxJgSnAdyM` (hardcoded), `startTime={{appointment.start_time}}`, `endTime={{appointment.end_time}}`, `status=<confirmed|cancelled>` (hardcoded per workflow), `type=appointment`.
- Edge function patched: `bookings-webhook` now reads `clients.timezone` and parses GHL's TZ-naive merge-tag strings ("Tuesday, 5 May 2026 8:52 PM") as wall-clock time in that zone, returning ISO-with-offset before storing. Without this, Postgres parses the strings as UTC and stores `appointment_time` ~10 hours off for AU clients.
- Schema: `clients.timezone text NOT NULL DEFAULT 'Australia/Sydney'` added (migration `20260505100000_phase_night_a4_clients_timezone.sql`).
- End-to-end verified: API-created appt → workflow A fires in 5s → row written with `status=confirmed`, `source=ghl_calendar`, `appointment_time` correct UTC. Soft-cancel → workflow B fires in 5s → same row `status=cancelled`. Zero `error_logs`.
- **Known scaling cost (deferred to Phase C):** hardcoded `calendarId` + `locationId` means each new client needs their own pair of workflows on their own GHL location. Documented in `Docs/WEBHOOKS.md` for the SOP.

### A5. Voicemail audio (Twilio-direct path — interim)  *(S, 1 hr)*
- Today's stack uses Twilio AMD `<Play>{audio_url}</Play>` for voicemail-drop. The next session will migrate this to Retell-native (richer + dynamic). For now if you want voicemail-drop working today:
- Record one MP3 per voice setter slot. Host on Supabase Storage (or any public URL).
- Paste into `clients.voicemail_audio_url`:
  ```sql
  UPDATE clients
  SET voicemail_audio_url = '{"voice-setter-1": "https://…/setter1-voicemail.mp3"}'::jsonb
  WHERE id = 'e467dabc-…';
  ```
- After the next session ships the Retell voicemail integration (per the new-session prompt), this Twilio path will be retired and you'll configure voicemail via the Engagement editor's "Cadence Settings" bar instead.

### A6. Turn on signature verification (last)  *(S, 30 min)*
- Do this LAST among A1-A6 — once secrets are set, sig-mismatch returns 403 and could silently kill inbound. Want a known-good baseline first.
- Get + paste each provider's secret:
  ```sql
  UPDATE clients SET ghl_webhook_secret = '<from GHL → Marketplace → Webhooks v2>'
  WHERE id = 'e467dabc-…';

  UPDATE clients SET retell_webhook_secret = '<from Retell agent webhook config>'
  WHERE id = 'e467dabc-…';

  -- Unipile is not in active use yet for BFD — defer if not configured.
  ```

### A7. ~~Enable BFD auto-enrolment~~  ✅ DONE 2026-05-06
- Flipped: `UPDATE clients SET auto_engagement_workflow_id = '40e8bea3-b6f6-4562-98d1-f7e6599af6a1' WHERE id = 'e467dabc-…';` (1 row updated).
- Pre-flight clean: `engagement_workflows.40e8bea3-…` is_active=true, 9 nodes, zero `[BRENDAN:…]` placeholders, `clients.subscription_status='active'`, `clients.timezone='Australia/Sydney'`.
- Auto-enrolment fires from `sync-ghl-contact/index.ts:380-400` (GHL Contact Created webhook path) and `intake-lead/index.ts:136-250` (web form path). `receive-twilio-sms` does NOT auto-enrol (existing-leads-only by design).
- Tag: `phase-night-a7-bfd-auto-enrolment-on` (`e4beaca`). Logged in `Docs/CHANGES_LOG.md` with revert SQL.

### Phase A end-to-end real-lead tests  ✅ ALL PASSED 2026-05-09
Live test of Phase A using Brendan's own phone (+61405482446). Three scenarios. Surfaced 4 real bugs that were fixed in-session before the gate could close.

| Test | Result | Notes |
|---|---|---|
| 1. Voice-booking happy path | ✅ PASS | Lead intake → SMS → call → tool-booked Friday 8 May 10:30 AM AEST. `bookings` row `7ad909cf-…`, `call_history.appointment_booked=true`, cadence stop_reason=`booking_created`. Booking soft-cancelled in cleanup. |
| 2. SMS reply path | ✅ PASS | "Hi" reply → cadence stop_reason=`inbound_reply`. AI setter reply landed at +1m58s ("Hey there! So, just to get us on the right track..."). |
| 3. STOP keyword opt-out | ✅ PASS | STOP → `lead_optouts` row, `setter_stopped=true`, cadence stop_reason=`setter_stopped`, no further outbound, "You've been unsubscribed" compliance reply received. |

Bugs surfaced + fixed mid-session:
1. `intake-lead` + `sync-ghl-contact` auto-enroll trigger payload missing `make_retell_call_url` → `runEngagement` threw at first phone_call node.
2. BFD `clients.retell_outbound_agent_id` + `retell_outbound_followup_agent_id` were NULL — cadence references Voice-Setter-2/3. Filled both slots with the single existing agent (`agent_5ec5eb…`) via SQL UPDATE.
3. `intake-lead` + `sync-ghl-contact` trigger payload missing `contact_fields.phone` → `make-retell-outbound-call` returned 400 "No phone number provided".
4. `runEngagement.isCancelled()` only checked `engagement_executions.status`, not `leads.setter_stopped` → STOP cancellation lost the race with cadence advance, voice call fired post-STOP. Extended `isCancelled` to also check `leads.setter_stopped` and self-cancel the exec with `stop_reason=setter_stopped`. Trigger.dev redeployed to `v20260509.2`. Also pinned `@supabase/supabase-js` to `2.101.0` (a transient bump to 2.105.x broke Trigger.dev runtime via eager WebSocket init on Node 21).

Tag: `phase-night-a-end-to-end-verified`. Phase A officially closed pending the A8 soak.

Punch list (deferred to follow-up sessions):
- (a) ~~Voice agent fetched slots in `America/New_York` despite `clients.timezone=Australia/Sydney`~~ **✅ DONE 2026-05-14 in commit `05106aa`.** Three fixes: (1) `make-retell-outbound-call` edge fn now SELECTs `clients.timezone` and uses it as the default for the `tz` resolution (4 hardcoded `America/New_York` defaults removed). (2) BFD's `voice_prompts` row patched: "Eastern time" → "Sydney time" in the tz-inference fallback; IANA example "America/New_York" → "Australia/Sydney". (3) BFD's Retell LLM `general_prompt` patched with the same 2 strings + `POST /publish-agent` so the live agent uses the new prompt. New `current_timezone` dynamic var passed to Retell so future prompts can reference `{{current_timezone}}` directly. Verification: next outbound call's `pre_call_context.metadata.timezone` should be `Australia/Sydney` and the agent should say "Sydney time" not "Eastern time" in the inference fallback.
- (b) ~~Cadence node n4 (`wait_for_reply` after phone_call) has `timeout_seconds=1`~~ — the n4=1s timing is now intentional: `runEngagement.ts` blocks past every `phone_call` channel until the matching Retell `call_ended` webhook lands (commit `571e18f`, tag `phase-night-bug1-call-outcome-coordination` 2026-05-13). Once call_ended arrives, classification decides: human pickup + `treat_pickup_as_reply=true` → terminate with `stop_reason='call_engaged'`; missed/voicemail/no_connect → advance to next channel (n5 missed-call SMS). New column `engagement_executions.last_call_outcome JSONB` is the coordination primitive. Trigger.dev `v20260513.1` deployed. Verified on the next live test (run after deploy).
- (c) Retell `custom_analysis_data.success_rate` is a boolean — looks like a schema typo.
- (d) ~~Manual end-to-end test from the BFD website lead form~~ **✅ DONE 2026-05-13.** Full chain verified end-to-end (form → tag → Add Lead to 1Prompt OS → sync-ghl-contact → engagement_executions → Trigger.dev → Twilio SMS → Retell call → booking via voice-booking-tools → bookings-webhook → cadence terminated with `stop_reason: booking_created`). Brendan answered the AI call live, booked an appointment for 11:30 AM Sydney. See handoff `Operations/handoffs/2026-05-11-ghl-to-1prompt-wiring.md` §D. Also surfaced + fixed `clients.sync_ghl_enabled` column gap (types.ts drift hit #3 — see memory `feedback_types_ts_drift`). New SOP section landed: `Docs/CLIENT_ONBOARDING_SOP.md` §5.13 documents the snapshot Pattern B ingress (form → tag → Add Lead to 1Prompt OS → sync-ghl-contact).
- (e) ~~Twilio error extraction bug at `trigger/runEngagement.ts:171`~~ **✅ DONE 2026-05-14 in commit `756c7bd`.** Two files fixed (`runEngagement.ts:201-208` `sendTwilioSmsAndStamp` + `processMessages.ts:413-417` AI setter reply path). Helper external return shape (`errorCode`/`errorMessage`) preserved so call sites unchanged. Deployed Trigger.dev v20260514.1. Next 21610 (or any Twilio failure) will now surface the real carrier code/message instead of `? unknown`.

### A8. 14-day soak  *(passive, watch 15 min/day)*
- Three queries to run daily. Scheduled agent will check `error_logs` + `cadence_funnel` automatically (see /schedule below) and ping you if anything breaks.
- **Funnel:** `SELECT * FROM cadence_funnel WHERE client_id='e467dabc-…' AND day=current_date;` Watch `leads_replied/leads_texted` — should be ≥ ~10%.
- **SMS errors:** `SELECT status, error_code, count(*) FROM sms_delivery_events WHERE received_at > now()-interval '24h' AND status IN ('failed','undelivered') GROUP BY 1,2;`
- **Trigger.dev console:** filter `process-setter-reply` + `run-engagement` by FAILED.
- **Retell dashboard:** call quality on `agent_5ec5eb`.

---

## Phase B — UI / config improvements (parallel with soak)

The next session's prompt covers all of these technically. You don't need to do anything for B unless the new session prompts you for a decision.

- B1. **Quiet hours editor** in the Engagement editor "Cadence Settings" top bar — per-workflow override + client-default fallback.
- B2. **"NEW LEADS" toggle** on each campaign card in the Workflows list — at-most-one per client; flipping ON for one auto-flips OFF the previous. Tag (e.g. `new-lead`) entered inline.
- B3. **Reactivation campaigns work independently.** No UI work needed; the toggle from B2 is additive.
- B4. **Voicemail config** in "Cadence Settings" — radio: Dynamic (LLM-generated per call) vs Static text. Pushed to Retell `voicemail_option` agent setting via the existing `retell-proxy` function. Replaces the Twilio AMD path from A5.
- B5. **`ghl-tag-webhook`** — new edge function. Receives GHL contact-tag-added webhook, enrols the lead in whichever workflow has `is_new_leads_campaign=true AND new_leads_tag = <added_tag>`. Tag is removed at cadence end.
- B6. **GHL Custom Conversation Provider** *(S, ~10 min)* — provision a Custom Conversation Provider for BFD inside GHL Marketplace (Settings → Marketplace → Custom Conversations Provider, or via the developer portal), then `UPDATE clients SET ghl_conversation_provider_id = '<id>' WHERE id = 'e467dabc-...';`. **Optional** — until you do this, the SMS body mirror (closed 2026-05-02 in `phase-night-ghl-push-gaps-2-3`) falls back to writing GHL Notes (`POST /contacts/{id}/notes`) which appear on the contact's Notes tab. Once the provider id is set, mirroring switches to real Conversation messages on the Conversations tab. Both work; Conversations is the polished path.
- B7. **Email channel for engagement cadences** *(~~L, 1-2 days dev~~ ✅ DONE 2026-05-13 in `phase-cadence-v2-mvp` Day 3)* — `EngageChannel.type` extended to `"sms" | "whatsapp" | "phone_call" | "email"`. Send path: GHL Conversations API `POST /conversations/messages` with `type: "Email"` (helper `pushEmailToGhl` in `trigger/_shared/ghl-conversations.ts`), Notes fallback if the GHL location has no email infra. Email channel carries `subject`, `body_format` (default html), `from_email?` fields. `cadence_metrics.emails_sent` counter wired. Used live in BFD v2 cadence Phase 2 (n13, n21) + Phase 3 (n23, n25, n27). Engagement editor channel picker NOT yet updated (Phase B follow-up — UI-only). Reply detection via `message_queue` is channel-agnostic so existing wait_for_reply behaviour is preserved.

## Phase B — Cadence v2 follow-ups (2026-05-13)

The cadence-v2 MVP shipped in one session as 5 commits (`35d1925` → `524ac08`). These are the deferred items the plan called out as out-of-scope for the MVP:

- **CV2-1. Multi-workflow enrollment state machine.** New table `engagement_enrollments (lead_id, workflow_id, status, paused_until, reactivation_trigger)` so a lead can transition between Hot Pursuit / Cool Down / Long-Tail / Re-engage workflows rather than living in one big workflow forever. Today's v2 keeps everything in one workflow (`c206da3e-…`). XL effort.
- **CV2-2. Long-tail nurture workflow.** Today's v2 ends with `stop_reason='sequence_complete'` at Day 21 and the lead drops. Build a SECOND workflow (weekly or bi-weekly email-only drip) that gets enrolled after sequence_complete, OR after `tagged_silent_after_engagement=true` from nudgeColdReply. Requires CV2-1 to be clean.
- **CV2-3. Behavioral re-warm triggers.** Email link clicks (need click-tracking infra; GHL Conversations does NOT track clicks by default) and GHL pricing-page-visit events should re-enrol the lead into a "Re-engage" workflow. L effort + GHL custom field setup.
- **CV2-4. Activate BFD v2.** v2 workflow `c206da3e-…` is `is_active=false` today. Brendan to eyeball in the Engagement editor canvas first, then run the 3-step activation SQL documented in `Docs/CADENCE_DESIGN.md` v2 section.
- **CV2-5. Engagement editor support for the email channel.** UI-side work (`frontend/src/pages/Engagement.tsx`) — channel picker doesn't render an "email" option yet. Today email channels exist only in the JSON. M effort.
- **CV2-6. Per-tenant timezone-aware nudgeColdReply cron.** Current cron is `0 6 * * *` (06:00 UTC = Sydney 16:00 — fine for BFD). Multi-tenant: either run multiple cron tasks (one per region) or check lead-local-time inside the loop. M effort.
- **CV2-7. Brand voice prompt overrides.** `clients.brand_voice` column (NEW) + per-workflow override on `engagement_workflows`. `aiGenerateEngagementCopy` already accepts `brandVoice`; just wire it from the DB row. S effort.
- **CV2-8. Cost ceiling: per-week + per-month aggregates.** Today's guard is per-lead (>500c/lead → error_logs warning). Add per-tenant rolling-window aggregate so a runaway tenant gets flagged before any individual lead does. S effort.

## Phase B addenda — operational tasks (Brendan-side, no BFD-setter code)

- B-OP1. **GHL appointment reminder workflows.** Per `Docs/FUTURE.md`, these live in GHL natively, not in BFD-setter code — `bookings-webhook` (Phase 7c, A4-wired) ends the active BFD-setter cadence on appointment-create so GHL reminder workflows can run unimpeded. Build in GHL Workflows once Phase A is closed:
  - 24h-before reminder (SMS + email)
  - 1h-before reminder (SMS)
  - At-appointment-time auto-trigger (optional — could fire a Retell call to confirm the lead is ready)
  - Post no-show follow-up (SMS + book-new-time link)
  - Effort: half-day for Brendan in GHL UI. **No BFD-setter code change required.** BFD-setter cadences must NOT include reminder nodes — that's GHL's territory and prevents double-messaging.

---

## Phase C — Onboard Client #2

Once BFD has been live cleanly for ≥ 14 days.

### C1. Read the SOP front-to-back  *(M, 45 min)*
- `Docs/CLIENT_ONBOARDING_SOP.md` (created this session).
- Sections: pre-sales discovery, info collection, pre-provisioning, DB provisioning SQL, external wiring, cadence review, dry-run, soft launch, debug pitfalls, offboarding.

### C2. Run pre-sales discovery (SOP §1)  *(M, 30 min call)*

### C3. Run info collection call (SOP §2)  *(M, 1 hr call)*

### C4. Provision the client (SOP §3-§5)  *(L, half day)*
- Create their external Supabase project + seed tables (SOP has the exact CREATE TABLE statements).
- INSERT clients row with the SQL template from §4.1.
- Create per-client GHL `last_synced_from` custom field (the next session will ship D-M5 which moves this from a hardcoded BFD constant to a per-client column — until then, paste it into the constant + redeploy).
- Clone the default workflow.
- Configure GHL workflows (Send Setter Reply + Bookings webhook).
- Repoint the client's Retell agent tool URLs.
- Twilio inbound webhook on each of their phone numbers.
- Embed `intake-lead` snippet on their website.

### C5. Cadence copy review with the client (SOP §6)  *(M, 1 hr)*

### C6. Dry-run synthetic + real (SOP §7)  *(S, 30 min)*

### C7. Soft launch — 5 real leads with client present (SOP §8)  *(M, 1 hr screenshare)*

### C8. Hand off, monitor week 1  *(passive)*

---

## Phase D — Strategic decisions (defer until 30 days post Client #2)

- D1. **Pricing.** Held until 30 days of cost-per-booking data exists. Charge Client #2 cost-plus or flat retainer in the meantime.
- D2. **Phase 10 — n8n decommission.** After ≥ 14 days clean on `use_native_text_engine = true` for BFD: delete the `else` branch in `processMessages.ts:209`, drop `clients.text_engine_webhook` (optional), shut down the n8n service on Railway.
- D3. **Multi-Twilio failover.** If Client #2-N's combined volume exceeds a single Twilio account's safe ceiling.
- D4. **Cost-per-booking analytics dashboard.** Currently only schema is there (`cadence_metrics`). Add a real frontend page once you have 60 days of data.

---

## Phase E — Cleanup & Rebrand (do later, before Client #2 onboarding gets serious)

- E1. ~~**Rebrand the project from "1prompt" to "BFD-setter"**~~ **✅ DONE 2026-05-14** — Aria→Gary (he/him), 1prompt→Building Flow (customer-facing) / BFD-setter (internal), upstream Geno/Katherine/Eugene Kadzin/Quimple/1Prompt name-swapped in default templates, n8n workflow booking titles updated, Retell agent JSON templates in `frontend/public/retell-agents/` replaced with Gary persona. ~45 files modified across docs, frontend UI, n8n templates, Retell JSONs. Live infra (n8n URLs, GHL tag/workflow names, Retell agent IDs, package.json `name`, shipped migrations) intentionally untouched per hard constraints. Original touch points (now historical):
  - `User Todos.md` and all `Docs/*.md` references to "1prompt-os" / "1Prompt"
  - `frontend/package.json` `name` field, `frontend/.env.example` comments
  - `frontend/supabase/functions/*/index.ts` header comments mentioning "1prompt-os"
  - The hardcoded `"AI Strategy with Eugene x 1Prompt"` booking title fallback in `voice-booking-tools/index.ts` (replace with BFD-tenant default; the per-client `clients.gohighlevel_booking_title` already overrides)
  - The Retell agent prompts (currently the upstream "Anne / Eugene from 1Prompt" persona; see `/srv/bfd/Company/knowledge/voice-agents/1prompt-upstream-voice-setter-prompt.md` for the full text to replace)
  - `Operations/handoffs/*` newer docs are already "BFD"-leaning; older 1prompt-named files are historical and can stay as-is
  - GitHub repo name (`TheBrendonly/1prompt-os` → `TheBrendonly/bfd-setter` if/when desired; coordinate with any external integrations that reference the URL)
- E2. ~~**Remove all Lovable/dev-tool leftovers and document that this project runs on Railway**~~ **✅ DONE 2026-05-14** — Deleted `frontend/.lovable/plan.md` (the only tracked Lovable artifact; a stale support-popup plan referencing `eugene@quimple.agency`). Confirmed `frontend/vite.config.ts` has no Lovable plugins and `frontend/package.json` has no `lovable-tagger` dep. Added "Deployment topology" section to `Docs/RUNBOOK.md` and a topology block to `README.md` locking the four-layer stack (Railway frontend, Railway n8n, Supabase edge-fns + DB, Trigger.dev background tasks) with "Lovable hosts nothing for BFD" disclaimer. `Docs/RAILWAY_ENV.md` is now linked from both as canonical env reference.
- E3. **Voice agent prompts: full BFD rewrite (Retell-side).** The downloadable Retell agent JSON templates at `frontend/public/retell-agents/` were rebranded to Gary on 2026-05-14 as part of E1. The live Retell agents in BFD's Retell dashboard still run the upstream Anne/Eugene/1Prompt persona and require a ground-up rewrite using BFD's brand voice (Aussie-warm professional, never salesy), BFD's actual ICP and offer, and a clean inbound-vs-outbound split. Use `/srv/bfd/Company/knowledge/voice-agents/1prompt-upstream-voice-setter-prompt.md` as a structural reference (study the framework, replace the content). Touch points: 3 Retell LLMs (`llm_22e795de…` inbound, `llm_692b220d…` outbound, `llm_1807516860…` outbound followup) plus the post-call analysis fields on each agent definition.
- E4. **Retell-folder setup-guide screenshots re-shoot.** `frontend/src/components/SetupGuideDialog.tsx` lines 6090, 6151, 6207, 6521, 6527, 6794, 7104, 7110 (and the `retell1PromptFolder` asset import at line 148) tell admins to create a Retell folder literally named "1Prompt" and the paired screenshots show that folder name. After all client testing is fully complete, decide on the canonical BFD folder name ("Building Flow" recommended), update the instruction text + button labels in `SetupGuideDialog.tsx`, re-shoot the matching screenshots in Retell with the new folder name, replace `frontend/src/assets/setup-guide/retell-1prompt-folder.png` (and any other screenshots showing the old folder name), and update the asset import + alt-text. Deferred from the 2026-05-14 rebrand pass because re-shooting screenshots without first locking the new folder convention risks two divergences (text says X, screenshot still says Y). DO BEFORE next client onboarding.
- E5. **Upstream pun-quiz lesson rewrite.** `frontend/src/components/setup-guide/MultiAgentLogicStep.tsx` lines 71-75 and `frontend/src/components/setup-guide/VoiceInboundLogicStep.tsx` line 427 contain quiz/lesson content that puns on the upstream project name ("one prompt = one AI Rep"). In BFD-setter the pun loses its connection to the product name. Rewrite the quiz questions and inbound-voice-architecture lesson around BFD-setter concepts (setter slots / `text_prompts` table model, voice-prompt three-section composition) rather than the upstream pun. Deferred because this is content rewrite (not a rename), not blocking, and admins onboarding before the rewrite still get the upstream-style lesson which is internally consistent.

---

## Reference

- **Webhooks (every URL in the system):** `Docs/WEBHOOKS.md`
- **Master plan:** `Docs/MASTER_PLAN.md`
- **Master state-of-play (handoff):** `Operations/handoffs/2026-04-30-1prompt-master-rebuild-handoff.md`
- **Onboarding SOP:** `Docs/CLIENT_ONBOARDING_SOP.md`
- **Changes log (every shipped phase + revert command):** `Docs/CHANGES_LOG.md`
- **Runbook (deploys, rollback, incident playbooks):** `Docs/RUNBOOK.md`
- **Cadence design + tone notes:** `Docs/CADENCE_DESIGN.md`
- **Tracking funnel SQL:** `Docs/TRACKING.md`
- **Future / out-of-scope items:** `Docs/FUTURE.md`
- **Next-session prompt for the developer:** `Docs/NEXT_SESSION_PROMPT.md`
