---
description: Session 4 close-out (client visibility + cadence controls) — F1 GHL→BFD deep-link SHIPPED; F3 pause/resume + F4 tz-nudge were ALREADY built and were reconciled (not rebuilt) + verified live; Trigger.dev prod redeployed. Includes the emitted Session 5 (by-phone pivot) kickoff prompt.
---

# Session 4 — Client Visibility + Cadence Controls (SHIPPED 2026-06-26)

Recommended mode was PLAN (live cadence runtime). **Verify-first changed the scope: F3 and F4 were
already built and committed to `main`, just never reconciled off `FEATURE_ROADMAP`.** Only **F1** was a
genuine build. All three are now → `TEST_LIST`.

## What shipped / reconciled

### F1 — GHL → BFD conversation deep-link (NEW)
On lead **create**, `sync-ghl-contact` now writes the lead's BFD conversation URL
`https://app.buildingflowdigital.com/leads/<leads.id>` (the `/leads/:contactId` route served by
`ContactDetail.tsx`, keyed by the `leads.id` **UUID**) onto the GHL contact, reusing
`writeGhlContactFields()` (`_shared/ghl-conversations.ts`: `PUT /contacts/{id}`,
`customFields:[{id, field_value}]`, Version 2021-07-28).

- **Migration `20260626120000`** (applied live via Mgmt API): `clients.ghl_conversation_link_field_id text`
  + `clients_public` recreated with it appended (CREATE OR REPLACE, `security_invoker=on` preserved,
  **0 secrets leaked**, 118 cols). Repo-truth migration file committed.
- **`sync-ghl-contact/index.ts`**: added `ghl_api_key, ghl_conversation_link_field_id` to the CREATE-path
  client-row select; after the lead insert, builds the URL from `newContact.id` and calls
  `writeGhlContactFields`. **Non-fatal + dormant**: wrapped in try/catch, logs a `sync-convo-link` step;
  shows `"skipped"` until the field id is provisioned (`writeGhlContactFields` no-ops on empty id/key —
  same dormancy model as the 12 outcome fields). `APP_BASE_URL` const (env-overridable, defaults to prod).
- **`types.ts`** surgical: column added to clients Row/Insert/Update + clients_public Row.
- **Deployed `sync-ghl-contact` v23 → v24** (bundle script, `verify_jwt=false` preserved, boot probe OK).
  `deno check` clean; `vite build` green.
- **Activation owed (Brendan):** create a text/URL "BFD Conversation Link" custom field in GHL + store its
  id: `UPDATE clients SET ghl_conversation_link_field_id='<id>' WHERE id='<client>'`. → BRENDAN_TODO.

### F3 — pause/resume a running cadence (ALREADY BUILT; reconciled, no code change)
Commit `4b7dbc1` (2026-06-15): `pause-engagement` (live **v1 ACTIVE**) + `resume-engagement`
(live **v1 ACTIVE**); `runEngagement.ts` `isPaused()` boundary-exit (`:374-381` + `:888-893`, returns
`{status:'paused'}` without finalizing metrics); `Engagement.tsx` PAUSE (running) / RESUME (paused) buttons.
`engagement_executions.status` is plain `text` (no CHECK) → `'paused'` accepted. → TEST_LIST (live E2E owed).

### F4 — timezone-aware `nudgeColdReply` cron (ALREADY BUILT; reconciled)
Commit `b0c6bea`: `nudgeColdReply.ts:169-191` gates every nudge to 9am–8pm in the client's
`clients.timezone` (IANA, via `Intl.DateTimeFormat`); cron stays hourly UTC; later in-window run catches
skipped leads. Satisfies F4. → TEST_LIST.

### Trigger.dev redeploy
`20260625.1`, **12 tasks**, from clean HEAD (`TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT
npx trigger.dev@4.4.4 deploy --env prod`) — guarantees the F3 pause-exit + F4 tz-gate runtime is live in
prod (prior deploy predated the 2026-06-23 audit-sweep edits to both files).

## Deploy state (end of session)
- Edge: **sync-ghl-contact v24** (new); pause-engagement v1, resume-engagement v1 (already live); retell-proxy
  v45, retell-call-webhook v21, test-external-supabase v17, duplicate-setter-config v8 (unchanged).
- Trigger.dev prod: **`20260625.1`** (12 tasks).
- Frontend: pushed to `main`; Railway auto-deploys (`app.buildingflowdigital.com`) — hard-refresh.
- DB: migration `20260626120000` applied live + committed.

## Relay Protocol (Docs/SESSION_PLAN.md step 4) — followed
Lists: F1/F3/F4 out of `FEATURE_ROADMAP` (note added: F3/F4 already built; **F8 cost-calculator spec** that
Brendan added was preserved) → `TEST_LIST` (new Session 4 section); F1 activation → `BRENDAN_TODO`; F1 ship +
F3/F4 reconciliation → `COMPLETED_LOG`. Session 4 ticked in `SESSION_PLAN.md`. Memory
`project_session4_client_visibility_cadence_2026_06_26` + MEMORY.md pointer written. This handoff written;
commit + push to `origin` + `github`. Session 5 prompt emitted below.

---

## EMITTED — Session 5 kickoff prompt (NEXT — paste verbatim)

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + Docs/BUG_LIST.md (B-2).

DEPLOY NOTE: the frontend auto-deploys via Railway on push to main (app.buildingflowdigital.com); allow
a few minutes + hard-refresh. Edge fns import from _shared/, so deploy with
`node scripts/deploy_retell_proxy_bundle.mjs <slug>` (the plain `supabase functions deploy` CLI silently
drops _shared/ refs). Trigger.dev tasks deploy with the TRIGGER_DEPLOY_PAT
(`TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy --env prod`). Current live edge
versions: sync-ghl-contact v24, retell-proxy v45, retell-call-webhook v21, test-external-supabase v17,
duplicate-setter-config v8, pause-engagement v1, resume-engagement v1. Trigger prod 20260625.1.

Use the superpowers skill to accomplish tasks.

TASK — SESSION 5: BY-PHONE PIVOT (CODE). Recommended mode: PLAN (larger behavior change to a LIVE inbound /
STOP path — research + approve the approach before edits; do it alone + carefully). Scope: BUG_LIST B-2 —
internal-first STOP + inbound resolution, DROP the GHL lookup. Today STOP handling and inbound-caller
resolution lean on a GHL contact lookup; pivot them to resolve the lead internally **by phone**
(normalized_phone) against the platform DB first, so STOP/opt-out and inbound identification work without a
GHL round-trip (and keep working for clients on their own GHL/Twilio number). Read B-2 in Docs/BUG_LIST.md
for the exact behavior + the decision context (memory project_list_doc_reconciliation_2026_06_25: "STOP +
inbound = internal-first by-phone, drop the GHL lookup"). Mind: normalized_phone can be NULL on some
GHL-intake rows (memory project_normalized_phone_null_on_ghl_intake_2026_06_19) — confirm/repair the
ingress before relying on it. Touches receive-twilio-sms / the inbound resolution path + lead_optouts.

DONE WHEN: tsc clean + deployed (Railway for frontend; bundle script for any edge fn; TRIGGER_DEPLOY_PAT
for Trigger tasks); B-2 moved out of BUG_LIST → TEST_LIST.

CLOSE OUT (Relay Protocol, Docs/SESSION_PLAN.md step 4): update the 5 lists; tick Session 5 done in
SESSION_PLAN.md; write a dated handoff; git add -A + commit + push to origin + github; then EMIT THE
SESSION 6 PROMPT (Secret-read hardening: BUG_LIST G3-6 — move ~20 browser secret-value reads behind edge
fns; defense-in-depth, already RLS-scoped; can slot after the TEST pass if time-boxed) — print it in a
fenced block in chat AND save it into the new handoff, built from the Standard Context Block + Session 6's
scope + this Relay Protocol. Point to Docs/SESSION_PLAN.md; do not inline the whole plan.
```
