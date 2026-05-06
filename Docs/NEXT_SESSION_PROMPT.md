# Next-session prompt

Paste this into a fresh Claude Code session. Start in **plan mode**, get user approval, then switch to **bypass-permissions** for execution.

---

```
Resuming 1prompt-OS — Phase 11 (Cadence UI completion + Retell voicemail
native + ghl-tag-webhook + dev-backlog hardening). Read these FIRST in
this order:

1. /srv/bfd/Projects/1prompt-os/User Todos.md  (canonical user-side checklist)
2. /srv/bfd/Projects/1prompt-os/Docs/CLIENT_ONBOARDING_SOP.md  (the SOP that this work makes possible)
3. /srv/bfd/Projects/1prompt-os/Docs/CHANGES_LOG.md  (10 phase tags shipped 2026-04-30; see how each row is formatted)
4. /srv/bfd/Operations/handoffs/2026-04-30-1prompt-master-rebuild-handoff.md  (state-of-play; especially §F open follow-ups)
5. /srv/bfd/Projects/1prompt-os/Docs/MASTER_PLAN.md
6. /srv/bfd/Projects/1prompt-os/Docs/CADENCE_DESIGN.md
7. C:\Users\brend\.claude\projects\c--Projects-Projects-1prompt-os\memory\MEMORY.md

Repo: /srv/bfd/Projects/1prompt-os. HEAD on origin/main is whatever
the prior session pushed (check with `git log --oneline -5`). Brendan
will run /loop or fast mode for this work — execute autonomously.

# Scope (priority order)

## P1 — Foundation (already shipped by the prior session, just verify)

The prior session shipped these and they are LIVE on origin/main:
- Migration `20260501000000_phase11a_cadence_overrides.sql` — adds `engagement_workflows` cols `quiet_hours_override jsonb`, `is_new_leads_campaign boolean`, `new_leads_tag text`, `voicemail_config jsonb`; partial unique index `engagement_workflows_one_new_leads_per_client`; adds `clients.ghl_last_synced_from_field_id text`
- D-M5: `push-contact-to-ghl` reads `clients.ghl_last_synced_from_field_id` instead of the hardcoded BFD constant
- D-M3: Trigger.dev scheduled task `refresh-cadence-funnel` running cron `0 * * * *`
- D-M1: `scripts/native-vs-n8n-diff.mjs` for the Phase 9 side-by-side test

Verify by running `git log --oneline | head -10` and reading the most
recent CHANGES_LOG.md entries.

## P2 — Cadence UI (per Brendan's spec from the chat where this prompt was generated)

Three frontend changes + one backend wiring + one new edge function. The
detailed plan is in the SUBAGENT REPORT below (verbatim from the
planning subagent). Ship in this order with a commit + tag per
sub-phase:

### P2a — Engagement editor "Cadence Settings" top bar (tag `phase-11b-cadence-settings-bar`)
- New component CadenceSettingsBar collapsing under the existing toolbar in `frontend/src/pages/Engagement.tsx`
- Two sections: Quiet Hours (per-workflow override; or "Inherit from client default") + Voicemail (radio: Dynamic / Static text)
- Uses pre-existing day-pill + time-popover + IANA timezone selector patterns (see drip schedule lines 1547-1631)
- Persists `quiet_hours_override` and `voicemail_config` to `engagement_workflows` via existing `handleSave` (line 2786)
- Disable the drip "Restrict to working hours" Switch (line 1527-1537) when global quiet hours is ON; tooltip explains why

### P2b — Workflows list "NEW LEADS" toggle (tag `phase-11c-new-leads-toggle`)
- Modify `SortableCampaignRow` in `frontend/src/pages/Workflows.tsx` (lines 66-107)
- Add `Switch` "NEW LEADS" + inline tag-name `Input` when toggled on
- At-most-one constraint enforced both client-side (optimistic flip-off of any other ON row in same client) and server-side (partial unique index)
- Also write `clients.auto_engagement_workflow_id` for legacy intake-lead path
- Toast confirms

### P2c — runEngagement quiet-hours fallback chain + voicemail push (tag `phase-11d-runengagement-overrides`)
- Extend `engagement_workflows` select at `runEngagement.ts` line 403 to include `quiet_hours_override, voicemail_config, is_new_leads_campaign, new_leads_tag`
- Quiet hours chain: `parseQuietHours(workflow.quiet_hours_override) ?? parseQuietHours(client.cadence_quiet_hours) ?? DEFAULT_QUIET_HOURS`
- Before each `phone_call` channel: push voicemail config to Retell via `retell-proxy` `update-agent` action with `voicemail_option`. Cache by hash so we don't PATCH on every call
- DELETE the existing Twilio AMD voicemail-drop branch (`call_mode === "voicemail_drop"` at lines ~664-700) — Retell handles voicemail natively now per the SUBAGENT REPORT below
- Drop `voicemail_audio_url` references and the `placeVoicemailDrop` function
- Update `Docs/CADENCE_DESIGN.md` Phase 4d section to reflect Retell-native voicemail

### P2d — ghl-tag-webhook edge function (tag `phase-11e-ghl-tag-webhook`)
- New `frontend/supabase/functions/ghl-tag-webhook/index.ts`
- Receives GHL ContactTagUpdate webhook
- Looks up client by `ghl_location_id`, finds workflow where `is_active AND is_new_leads_campaign AND new_leads_tag = ANY(addedTags)`
- Calls `enrollLeadInEngagement` (mirror intake-lead's helper at lines 110-150)
- Returns `{ ok, enrolled: <execution_id> }`
- GHL Webhook V2 sig verification when `clients.ghl_webhook_secret` is set (mirror receive-dm-webhook's HMAC pattern from Phase 8a)
- Document URL in RUNBOOK.md "GHL configuration playbook"

### P2e — Cadence-end tag removal in runEngagement (folded into P2c if simpler)
- In `writeCadenceMetrics` (or just before its callsites at end-of-cadence): if `workflow.is_new_leads_campaign AND workflow.new_leads_tag`, call GHL `DELETE /contacts/{id}/tags/{tagName}` to remove the tag
- Use `clients.ghl_api_key` already loaded into the workflow context

## P3 — D-M2 + D-M4 + D-M6 (the master plan's "MUST HAVE before Client #2")

These are documented in the prior session's handoff §"Deliverable 1" but
were left for this session. Ship after P2 lands:

### P3a — runEngagement engage-node SMS via Twilio direct (tag `phase-11f-engagement-twilio-direct`)
- Engage SMS path currently goes via `client.send_engagement_webhook_url` (a GHL Custom Webhook)
- Replace with direct Twilio Messages.create (mirror processMessages.ts lines 332-359 — same StatusCallback URL, same message_queue insert with twilio_message_sid + outbound)
- Without this, cadence SMS deliveries don't appear in `sms_delivery_events` → funnel undercounts `sms_delivered`

### P3b — Synthetic probe scheduled task (tag `phase-11g-synthetic-probe`)
- New `trigger/syntheticProbe.ts` running every 30 min (cron `*/30 * * * *`)
- POSTs a fake lead to `/functions/v1/intake-lead` with a dedicated synthetic-probe client_id (Brendan provisions in the DB; document in RUNBOOK)
- Polls `engagement_executions` for 90s, asserts status='running' + outbound message_queue row appears
- Cancels the cadence, writes pass/fail to a new `probe_results` table
- On failure: posts to a Slack/Discord webhook URL stored in env

### P3c — onboard-client.mjs script (tag `phase-11h-onboard-script`)
- `scripts/onboard-client.mjs` taking `--name --ghl-location-id --ghl-pit --twilio-sid --twilio-token --default-tz`
- Steps documented in `Docs/CLIENT_ONBOARDING_SOP.md` §3-4
- INSERTs clients row, generates intake_lead_secret + ghl_webhook_secret + retell_webhook_secret placeholders, creates GHL last_synced_from custom field, captures id, stores per-client; clones default workflow
- Prints next-step checklist (Retell tool URLs, intake snippet, etc)
- Update SOP §12 to point to the script

# Test as you go

After each phase's deploy:
- Edge functions: smoke test with curl (missing param → 400; wrong auth → 403)
- Trigger.dev tasks: trigger one manually via the cloud console; assert the expected output
- DB migrations: query the new schema via Management API (`SUPABASE_PAT` in .env)
- UI changes: run `npm run dev` in frontend/, click through the flow, look for console errors

# Workflow rules (from prior session)

- Each phase ENDS with a commit, a git tag `phase-N-<slug>`, and a row in `Docs/CHANGES_LOG.md` with revert command
- Cap OpenRouter test spend at $10
- Cadence message copy = clearly-marked placeholders (e.g. "[BRENDAN: replace with intro line]") — Brendan rewrites before turning live cadences on
- Booking-detected → cadence ends. Reply-detected → cadence ends. STOP keyword → opt-out + cadence cancel
- DO NOT flip clients.use_native_text_engine — Brendan's manual step
- Reference upstream repo https://github.com/genokadzin/1prompt-os via WebFetch when uncertain why a pattern was built a certain way

# End-of-run deliverable

Final handoff at `/srv/bfd/Operations/handoffs\<date>-1prompt-phase11-handoff.md` summarising every phase shipped, tag, and Brendan's next manual action.

---

# SUBAGENT REPORT (verbatim — UI plan from the planning agent)

[The next session should re-read the full planning report from the
prior session if needed. The summary is:]

UI changes:
1. `frontend/src/pages/Engagement.tsx` — insert CadenceSettingsBar
   between the toolbar (line 3315-3371) and the canvas (line 3373).
   Reuse drip-schedule day-pill + time-popover patterns from lines
   1547-1631.
2. `frontend/src/pages/Workflows.tsx` — extend SortableCampaignRow
   (lines 66-107) with the NEW LEADS Switch + tag input.
3. `runEngagement.ts` — quiet-hours fallback chain + voicemail push;
   delete the Twilio AMD branch.
4. `ghl-tag-webhook/index.ts` — new edge function mirroring
   intake-lead's enrollLeadInEngagement helper.

Schema (already shipped by prior session — verify):
- engagement_workflows.quiet_hours_override jsonb
- engagement_workflows.is_new_leads_campaign boolean default false
- engagement_workflows.new_leads_tag text
- engagement_workflows.voicemail_config jsonb { mode, message }
- partial unique index engagement_workflows_one_new_leads_per_client
- clients.ghl_last_synced_from_field_id text

# SUBAGENT REPORT (verbatim — Retell voicemail research)

Retell native voicemail:
- voicemail_option on agent object: { action: 'static_text' | 'prompt' | 'hangup' | 'bridge_transfer' }
- Or legacy voicemail_message string field (supports {{vars}})
- Per-call override NOT supported via API — only voicemail_option on agent
- Recommended: per-agent voicemail with template vars + per-lead retell_llm_dynamic_variables for dynamic content
- AMD runs first 3 min; <30ms latency; ends call with disconnection_reason='voicemail_reached'
- Cost: standard call rate (~$0.04-0.10 per voicemail) vs sub-cent for Twilio MP3 — factor into pricing
- Migration: drop placeVoicemailDrop() and the call_mode==='voicemail_drop' branch in runEngagement.ts; instead push voicemail_option to retell-proxy update-agent before each phone_call

Retell docs cited:
- https://docs.retellai.com/build/handle-voicemail
- https://docs.retellai.com/api-references/update-agent
```

---

End of next-session prompt.
