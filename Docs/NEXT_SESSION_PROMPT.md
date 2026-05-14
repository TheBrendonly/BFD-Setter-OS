# Next-session prompt

Paste this into a fresh Claude Code session opened on `/srv/bfd/Projects/1prompt-os`. Start in **plan mode**, get user approval, then switch to execution mode.

The prior session (2026-05-13) closed the last Phase A punch-list item (manual form test) AND shipped the Bug 1 fix (mid-call SMS during active Retell call). Full GHL form → AI setter cadence chain is now verified end-to-end via Pattern B with proper call-outcome coordination. Two bugs remain — Bug 3 is the small momentum win, Bug 2 is the agent-prompt timezone fix.

---

```
Resuming BFD-setter bug triage from /srv/bfd/Operations/handoffs/2026-05-11-ghl-to-1prompt-wiring.md.

Read these FIRST in this order:
1. /srv/bfd/Operations/handoffs/2026-05-11-ghl-to-1prompt-wiring.md §D
   (the closed state from 2026-05-13 + three bugs flagged)
2. /srv/bfd/Projects/1prompt-os/Docs/CLIENT_ONBOARDING_SOP.md §5.13
   (Pattern B architecture, just written — context for the bugs)
3. /srv/bfd/Projects/1prompt-os/Docs/CHANGES_LOG.md row 1
   (2026-05-13 "night-ghl-form-pattern-b-verified" — what got wired)
4. /srv/bfd/Projects/1prompt-os/User Todos.md Phase A punch list
   (items (a), (b), (e) are the three open bugs)
5. /home/brendan/.claude/projects/-srv-bfd-Projects-1prompt-os/memory/MEMORY.md
   (see [[session-2026-05-13-state]], [[call-outcome-cadence-bug]],
    [[ghl-snapshot-pattern-b]], [[twilio-carrier-optout]])

State of play:
- HEAD: d3d4403 on origin/main (no commits today; all changes via DB +
  GHL UI + docs only). Today's pending tag `phase-night-ghl-form-pattern-b-verified`
  not yet pushed — Brendan to commit + push the doc updates first.
- Schema: prod has `clients.sync_ghl_enabled` column now (added 2026-05-13
  via Management API). BFD's value is true.
- Trigger.dev: v20260509.2 (unchanged).
- Supabase deployed sync-ghl-contact: v12 with edff01f fixes (unchanged).
- Phase 9 native engine soak: should be complete (>14 days since 2026-04-30).
  Phase 10 cleanup (drop text_engine_webhook, retire dormant n8n / Send*
  columns) is safe to schedule.

Pick ONE bug to ship this session (suggest order: 3 → 1 → 2):

# Bug 3 — Twilio error extraction (small, 15 min)

trigger/runEngagement.ts:171 reads `twilioJson.error_code` and
`twilioJson.error_message` from Twilio's REST API response. Twilio
actually returns `code` and `message` (no error_ prefix). Today's
SMS-blocked-by-opt-out failure surfaced as
"Twilio SMS failed: ? unknown" instead of
"Twilio SMS failed: 21610 Attempt to send to unsubscribed recipient",
which cost 10 minutes of guessing.

Steps:
1. Change line 173 from `errorCode: twilioJson.error_code,
   errorMessage: twilioJson.error_message` to
   `errorCode: (twilioJson as any).code, errorMessage:
   (twilioJson as any).message`.
2. Also fix the `twilioJson` typed-object literal on line 171 to declare
   `code?: number; message?: string` (instead of error_code/error_message).
3. Smoke test: craft a curl to Twilio's REST API with a bogus number,
   see the response. Confirm the field names.
4. Redeploy Trigger.dev: `cd /srv/bfd/Projects/1prompt-os/trigger &&
   TRIGGER_ACCESS_TOKEN=$(grep '^TRIGGER_DEPLOY_PAT=' /etc/bfd-secrets/bfd-os.env
   | awk -F= '{print $2}' | awk '{print $1}') npx trigger.dev@4.4.4 deploy`.
5. Commit + tag `phase-night-runengagement-twilio-error-extraction`.
6. Add row to CHANGES_LOG.md.

# Bug 1 — Mid-call SMS during active Retell call ✅ DONE 2026-05-13

Shipped as commit `571e18f`, tag `phase-night-bug1-call-outcome-coordination`.
Trigger.dev `v20260513.1`. Edge function `retell-call-webhook` v10.

Final implementation (slightly different from the original sketch):
- Added one column `engagement_executions.last_call_outcome JSONB`
  (not two — `awaiting_call_id` turned out redundant since runEngagement
  already knows the call_id it placed).
- `retell-call-webhook` on `call_ended` stamps `last_call_outcome` keyed
  by `dynamicVars.execution_id`.
- `runEngagement.ts` polls every 15s (`wait.for` frozen, zero compute)
  for up to 10 min after each `phone_call` channel. Classification
  mirrors `retell-call-analysis-webhook.ts:740-750`. New stop_reason
  `'call_engaged'` introduced. Both phone_call sites (engage channel +
  legacy flat node) covered.

Memory: [[bug1-call-outcome-coordination]] documents the deploy steps
and the runtime semantics.

Manual end-to-end re-verification still pending — run the form path
test described in handoff §D and confirm (1) no mid-call SMS on pickup,
(2) missed-call SMS still fires AFTER call_ended on no-answer/voicemail.

# Bug 2 — Voice agent timezone (low-medium, 1-2h)

§E (a) punch-list item. pre_call_context.metadata.timezone =
"America/New_York" — should be clients.timezone (= "Australia/Sydney"
for BFD). Slot list passed to Retell is also in -04:00 offsets.

Two surfaces to fix:
1. The Retell agent prompt (in client's external Supabase `voice_prompts`
   table — agent prompt has ET baked into the call-opening template).
2. voice-booking-tools `get-available-slots` handler in
   frontend/supabase/functions/voice-booking-tools/index.ts — partial fix
   already shipped at commit c4499ed (defaults from clients.timezone when
   caller doesn't pass timeZone). But pre-call context still gets
   America/New_York from somewhere upstream — likely make-retell-outbound-call
   building the dynamic_variables. Trace where `timezone: America/New_York`
   originates.

Workflow rules:
- Each phase ENDS with a commit, a git tag `phase-N-<slug>`, and a row
  in Docs/CHANGES_LOG.md with revert command.
- Test against BFD only — don't fan out to other clients until Phase C.
- Don't touch clients.use_native_text_engine (still on, soak complete).
- Bug 1 is closed. Pick Bug 3 first for a momentum win (15 min), then
  Bug 2 (voice agent timezone).

End-of-run deliverable: update /srv/bfd/Operations/handoffs/2026-05-11-ghl-to-1prompt-wiring.md
§D with which bug was fixed + the tag + the verification done.
```

---

End of next-session prompt.
