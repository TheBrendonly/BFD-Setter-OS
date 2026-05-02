# User Todos — 1prompt-OS

Brendan's checklist to take 1prompt-OS from "shipped behind flags" to "first paying client live + onboarded."

Items are sequenced. Order matters — do them top-to-bottom. Each item links to the section in `Operations/handoffs/2026-04-30-1prompt-master-rebuild-handoff.md` (the master state-of-play) or to the SOP at `Docs/CLIENT_ONBOARDING_SOP.md`.

Effort: S = under 30 min, M = 30 min - 2 hr, L = half day+.

---

## Phase A — Make BFD live on the new stack (before sign Client #2)

These are sequential. 8 items. Total ~half day of effort spread over 2-3 weeks (most of the time is the soak window).

### A1. Cadence copy review on workflow `40e8bea3-…`  *(M, ~1-2 hr)*
- Open the workflow editor in the app, or PATCH the `nodes` jsonb directly.
- Replace every `[BRENDAN: ...]` placeholder.
- Tone notes are in `Docs/CADENCE_DESIGN.md` "Tone notes" — Aussie-warm, < 160 chars first-touch, `{{first_name}}`, sign off with first name only.
- DO NOT enable auto-enrolment yet — that's A8.

### A2. Phase 9 cutover for BFD only  *(S, 10 min + 48h passive watch)*
- Wait until the next session ships D-M1 (diff harness — see "Next session prompt" below).
- Eyeball the diff between `processSetterReply` and n8n on 5 historical messages.
- If clean: `UPDATE clients SET use_native_text_engine = true WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';`
- Watch `error_logs WHERE source='process-setter-reply'` for 48 hr.
- Roll back instantly with the inverse SQL if anything spikes.

### A3. Repoint Retell + ElevenLabs voice tool URLs  *(S, 30 min)*
- For each Retell agent: PATCH the LLM's tool URLs to:
  `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=<tool>&clientId=e467dabc-57ee-416c-8831-83ecd9c7c925`
- Use REST API, not MCP (memory `reference_retell_rest_vs_mcp` — MCP strips custom-tool params).
- Tools to repoint: `get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments`.
- ElevenLabs URL is hardcoded at `frontend/supabase/functions/elevenlabs-manage-agent/index.ts:56-57` — change there if you use 11Labs.
- Add `Authorization: Bearer <intake_lead_secret>` to each tool's custom-headers config (optional but recommended). Mint the secret with: `UPDATE clients SET intake_lead_secret = encode(gen_random_bytes(24), 'base64') WHERE id = 'e467dabc-…' RETURNING intake_lead_secret;`
- Test ONE real booking end-to-end after repoint. Confirm a `bookings` row appears with `cadence_execution_id` linked.

### A4. Wire GHL Calendar workflow → `bookings-webhook`  *(S, 15 min)*
- GHL → Workflows → New → Calendar Events.
- Triggers: Appointment Created + Updated + Cancelled.
- Action: Webhook → URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook`
- Payload: include `appointmentId`, `contactId`, `calendarId`, `startTime`, `endTime`, `status`, `locationId`.
- Save + activate.
- Without this, manual GHL bookings stay invisible to the funnel — `bookings` only catches voice-tool bookings.

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

### A7. Enable BFD auto-enrolment  *(S, 1 min)*
- Only after A1-A6 are clean.
- `UPDATE clients SET auto_engagement_workflow_id = '40e8bea3-b6f6-4562-98d1-f7e6599af6a1' WHERE id = 'e467dabc-…';`
- New leads created via `sync-ghl-contact` will start auto-enrolling immediately.

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

- E1. **Rebrand the project from "1prompt" to "BFD-setter"** across all docs and code. Touch points include (non-exhaustive):
  - `User Todos.md` and all `Docs/*.md` references to "1prompt-os" / "1Prompt"
  - `frontend/package.json` `name` field, `frontend/.env.example` comments
  - `frontend/supabase/functions/*/index.ts` header comments mentioning "1prompt-os"
  - The hardcoded `"AI Strategy with Eugene x 1Prompt"` booking title fallback in `voice-booking-tools/index.ts` (replace with BFD-tenant default; the per-client `clients.gohighlevel_booking_title` already overrides)
  - The Retell agent prompts (currently the upstream "Anne / Eugene from 1Prompt" persona; see `C:/Projects/Company/knowledge/voice-agents/1prompt-upstream-voice-setter-prompt.md` for the full text to replace)
  - `Operations/handoffs/*` newer docs are already "BFD"-leaning; older 1prompt-named files are historical and can stay as-is
  - GitHub repo name (`TheBrendonly/1prompt-os` → `TheBrendonly/bfd-setter` if/when desired; coordinate with any external integrations that reference the URL)
- E2. **Remove all Lovable/dev-tool leftovers and document that this project runs on Railway** (frontend + n8n) + Supabase (edge fns + DB) + Trigger.dev (background tasks):
  - Delete the orphan `.lovable/` directory at the repo root if present (per memory `reference_deployment_topology`, Lovable hosts NOTHING for BFD, this is just leftover)
  - Audit `package.json`/`vite.config.ts`/build configs for Lovable-specific plugins or scripts
  - Update `README.md` and `Docs/RUNBOOK.md` deployment topology section to read "Frontend on Railway, n8n on Railway, edge fns on Supabase, Trigger.dev tasks on Trigger cloud" with no Lovable references
  - `Docs/RAILWAY_ENV.md` already documents the Railway env shape; ensure it is the canonical place new devs are pointed to
- E3. **Voice agent prompts: full BFD rewrite.** Inbound and outbound prompts currently inherit the upstream Anne/Eugene/1Prompt persona. They need a ground-up rewrite using BFD's brand voice (Aussie-warm professional, never salesy), BFD's actual ICP and offer, and a clean inbound-vs-outbound split. Use `C:/Projects/Company/knowledge/voice-agents/1prompt-upstream-voice-setter-prompt.md` as a structural reference (study the framework, replace the content). Touch points: 3 Retell LLMs (`llm_22e795de…` inbound, `llm_692b220d…` outbound, `llm_1807516860…` outbound followup) plus the post-call analysis fields on each agent definition.

---

## Reference

- **Master plan:** `Docs/MASTER_PLAN.md`
- **Master state-of-play (handoff):** `Operations/handoffs/2026-04-30-1prompt-master-rebuild-handoff.md`
- **Onboarding SOP:** `Docs/CLIENT_ONBOARDING_SOP.md`
- **Changes log (every shipped phase + revert command):** `Docs/CHANGES_LOG.md`
- **Runbook (deploys, rollback, incident playbooks):** `Docs/RUNBOOK.md`
- **Cadence design + tone notes:** `Docs/CADENCE_DESIGN.md`
- **Tracking funnel SQL:** `Docs/TRACKING.md`
- **Future / out-of-scope items:** `Docs/FUTURE.md`
- **Next-session prompt for the developer:** `Docs/NEXT_SESSION_PROMPT.md`
