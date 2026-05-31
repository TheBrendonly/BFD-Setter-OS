# BFD-Setter Build Roadmap

Source: capability audit 2026-05-30 (per-client multi-agent / form routing / reactivation / isolation) plus docs consolidation. Decisions approved by Brendan 2026-05-30.

## Approved decisions

1. **Form routing**: build the full per-client routing layer + UI (different forms activate different agents/cadences for the same client). This is the keystone of the product vision and does not exist today.
2. **Voice setters**: complete the new `voice_setters` UUID model (currently built but never populated). Unlimited voice agents per client.
3. **Reactivation**: wire the CSV/list path into the native engagement engine (`engagement_executions` + `runEngagement`) and drop the external/n8n `campaign_webhook_url` dependency.
4. **Docs**: consolidate 14+ docs into 6 living files.

## Status legend
`[ ]` pending  `[~]` in progress  `[x]` done  `**[YOU]**` only Brendan can do (also listed in the master list)

---

## Master to-do list (Claude) — everything

### P0 — gating decisions
- [x] D1-D4 approved 2026-05-30.

### P1 — Form-to-agent routing (keystone) — CODE COMPLETE (pending deploy)
Design simplified during build: reuse `engagement_workflows.new_leads_tag` as the per-form key (the tag->workflow lookup already existed); just relax the one-per-client cap. No new routing table, no override column, Try-Gary left untouched (lower risk).
- [x] Design locked (reuse new_leads_tag + relax index).
- [x] Migration `20260530120000_form_routing_multi_new_leads.sql`: drop one-new-leads-per-client index; add UNIQUE (client_id, new_leads_tag) WHERE is_new_leads_campaign; add `leads.form_source`.
- [x] Shared resolver `_shared/resolve-workflow.ts` (+ 10 passing unit tests).
- [x] Wired `ghl-tag-webhook` (form_source audit), `sync-ghl-contact` + `intake-lead` (tag-aware routing via resolver, default fallback).
- [x] UI: `Workflows.tsx` now allows many tag-bound new-leads campaigns per client (mutual-exclusion removed, duplicate-tag error handling).
- [x] `deploy_with_shared.mjs` updated to bundle the two functions that import the resolver.
- [ ] **DEPLOY**: run the migration; deploy `ghl-tag-webhook`, and `sync-ghl-contact` + `intake-lead` (with _shared bundle).
- [ ] **[YOU]** Configure each GHL form/workflow to emit a distinct routing tag into the webhook (and post it to sync-ghl-contact as `Tag`/`tag`, or as a `tags[]` entry to intake-lead).

### P2 — Reactivation (CSV -> native) — CODE COMPLETE (pending deploy)
Delivered the one-click native flow. The CampaignCreate ("DB Reactivation") page now enrols the uploaded CSV / selected contacts into a chosen cadence natively via `runEngagement`; the external `campaign_webhook_url` path is no longer used.
- [x] `reactivate-lead-list` edge fn: verify operator once (assertClientAccess), then upsert each lead + insert engagement_executions + fire trigger.dev run-engagement (chunked, per-lead results). Reuses reactivate-lead's pattern inline (no fragile service-key HTTP fan-out).
- [x] Pure helpers `_shared/reactivate-list.ts` (normalizeLeadRow handles snake/camel/Title-Case headers; chunk) + 9 passing tests.
- [x] CampaignCreate repointed: added a cadence picker, dropped the webhook/supabase gates, submit calls `reactivate-lead-list`. Contact mapping now carries `lead_id` so existing leads aren't duplicated.
- [x] `deploy_with_shared.mjs` bundles `reactivate-lead-list`.
- [ ] **DEPLOY**: deploy `reactivate-lead-list` (with _shared bundle). No migration needed.
- [ ] Cleanup (deferred): remove the now-vestigial webhook config UI section in CampaignCreate; retire `bulk-insert-leads` / `campaign-executor` / `campaign_leads` once confirmed unused.

### P3 — Voice setters (complete UUID model)
- [ ] Write path: `retell-proxy` / setup flow creates `voice_setters` rows (not legacy slot columns).
- [ ] UI to create/manage voice setters + `voice_setter_phone_bindings` (inbound/outbound phone per setter).
- [ ] Onboarding (`onboard-client.mjs`) populates `voice_setters` for new clients.
- [ ] Cadence node picker (Engagement.tsx) reads `voice_setters`, not just `agent_settings` slots.
- [ ] Interim: expose legacy voice slots 5-10 in RetellAgentsTab (currently only 4).
- [ ] **[YOU]** Provision the actual Retell agents + phone numbers per agent (external, costs money).

### P4 — Multi-tenant isolation hardening
- [ ] Read-only prod audit: duplicate `retell_phone_*` and duplicate `ghl_location_id` across clients (Claude can run).
- [ ] `campaigns.client_id`: backfill + `SET NOT NULL`.
- [ ] Fix `execution_logs` RLS (broken `campaigns.user_id` reference).
- [ ] Add `client_id` + RLS (or document service-role-only) to `message_queue` / `active_trigger_runs`.
- [ ] Guard against two clients sharing `retell_phone_*`; enforce in onboarding.
- [ ] `campaign-executor`: add client_id/ownership validation.
- [ ] **[YOU]** If the prod audit finds shared phones / location IDs, choose replacements.

### P5 — Docs consolidation (6 living files)
- [ ] `README.md` (orientation), `Docs/ARCHITECTURE.md` (system SSOT, absorbs SETUP_OVERVIEW + WEBHOOKS + tables), `Docs/OPERATIONS.md` (RUNBOOK + tracking), `Docs/ONBOARDING.md`, `Docs/ENGAGEMENT.md` (CADENCE_DESIGN), `Docs/CAMPAIGNS.md`.
- [ ] Archive to Operations/archives/: MASTER_PLAN, CHANGES_LOG, FUTURE, TRACKING, RAILWAY_ENV, soak-checks; merge then drop GHL_PUSH_AUDIT; delete SETUP_OVERVIEW, NEXT_SESSION_PROMPT.

### P6 — Carry-over cleanup (from 2026-05-30 first assessment)
- [ ] Finish n8n decom: repoint/remove `elevenlabs-manage-agent` endpoint; drop dead `LEGACY_N8N_HOST` in retell-proxy.
- [ ] Resolve dual root lockfile (npm vs pnpm).
- [ ] Gate or remove unguarded debug pages.
- [ ] Archive one-off recovery scripts; move stray `.sql` into migrations.
- [ ] Remove dormant webinar component remnants.

---

## Brendan-only list (the things Claude cannot do)

- **Decisions** D1-D4: done (2026-05-30).
- **GHL config**: set each form/workflow to emit a distinct form key or tag (required before form routing works end to end).
- **Retell/Twilio provisioning**: create the agents and buy/assign phone numbers per agent.
- **Phone collisions**: if the prod audit finds shared numbers/location IDs, pick replacements.
- **Prompt content**: any changes to live agent prompt text remain Brendan's (standing rule: Claude does not unilaterally edit prompt content).

---

## FINAL STATUS — 2026-05-31 build (all items addressed)

All code is on `main`, **uncommitted and undeployed**, pending review.

| Item | State | Deploy step | Your action |
|------|-------|-------------|-------------|
| Form routing | DONE | run migration `20260530120000`; deploy ghl-tag-webhook, sync-ghl-contact, intake-lead (last 2 w/ `_shared`) | set GHL form tags |
| Reactivation (CSV→native) | DONE | deploy `reactivate-lead-list` (w/ `_shared`) | none |
| Voice setters | CORE DONE | run migration `20260531120000`; deploy retell-proxy | provision agents/phones for slots 5-10 as needed |
| Isolation | DONE | run migration `20260531130000` | run `scripts/phone_uniqueness_audit_and_fix.sql` audit before applying the (commented) guard |
| Docs | DONE | n/a (files) | n/a |
| Cleanup | TRIAGED | n/a | approve the checklist below |

### Voice setters — documented follow-ups (not blocking the goal)
- Per-setter phone-binding UI (assign inbound/outbound number to setters 5-10). Today: slots 1-3 phones backfilled from `retell_phone_1..3`; legacy slot path stays live.
- UUID-native cadence picker in Engagement.tsx (currently offers `Voice-Setter-N` slots, which work via the legacy resolver + are backfilled into voice_setters).

### Cleanup checklist (owner approval — these touch code/files I did not author)
- **bfdVoiceSetterPrompt.ts**: not imported (only a comment ref), no valid export, breaks `tsc --noEmit` (not `vite build`). RECOMMEND rename to `.md` (preserve as reference, fix tsc). Left untouched pending your call.
- **Dual root lockfile** (`package-lock.json` + `pnpm-lock.yaml`): pick one (recommend npm; delete `pnpm-lock.yaml`).
- **Debug pages** (`/debug-ai-reps*`, `/debug-inject-lead`): gate behind creator/admin mode or remove from prod routes.
- **Vestigial webhook UI** in CampaignCreate + legacy `bulk-insert-leads`/`campaign-executor`/`campaign_leads`: retire once native reactivation is confirmed in prod.
- **One-off scripts** (`recover_bfd_voice_*`, `backfill_*`, `replay_call_to_webhook`, `update_voice_prompts_setter1`, `call_history_schema_patch.sql`): move to `scripts/archive/`.
- **Webinar remnants** (`WebinarSetupGuideDialog`, `WebinarPresentationAgentChatInterface`): remove if dormant.
- **elevenlabs-manage-agent**: still points booking tools at the dead n8n host; repoint to `voice-booking-tools` or remove if ElevenLabs is retired.

### Verified-FALSE audit findings (no action)
- `execution_logs` RLS is NOT unguarded — `campaigns.user_id` exists and the policies work (user-scoped).
- `LEGACY_N8N_HOST` in retell-proxy is NOT dead — used for booking-URL substitution (line ~473).

---

## Part B progress — 2026-05-31 (post-deploy)

**Done (safe, verified):**
- Try-Gary cadence resolution made deterministic (`bfd_setter-try_gary` tag), deployed `ghl-tag-webhook` v7.
- `Docs/FORM_ROUTING.md` added (form→agent routing + voice-agent provisioning reference); linked from README + ARCHITECTURE.
- Archived 6 one-off scripts → `scripts/archive/`.
- Removed the vestigial Campaign Webhook URL field + unused state/import from CampaignCreate (native reactivation leftover).
- Renamed dead `bfdVoiceSetterPrompt.ts` → `.md` (unused; was breaking tsc).

**Verified-and-NOT-touched (audit's "dead code" claims were wrong):**
- `elevenlabs-manage-agent`: still referenced by `pages/_archived/VoiceAISetter.tsx`. Left in place.
- Webinar components (`WebinarSetupGuideDialog`, `WebinarPresentationAgentChatInterface`): imported by the ACTIVE `SetupGuideDialog.tsx`. Removing requires untangling that first. Left in place.

**Newly surfaced (was masked by the broken prompt file):**
- `tsc --noEmit` now shows ~26 PRE-EXISTING type-drift errors across 7 files (top: `LeadReactivation.tsx`, `useReactivationData.ts` — `cadence_metrics` missing from generated `types.ts`; some Json-type mismatches). The build is unaffected (`vite build` doesn't run tsc). Fix = regenerate `frontend/src/integrations/supabase/types.ts` from the current DB schema (also picks up `leads.form_source`, `voice_setters.legacy_slot`). Tracked as a follow-up.

**Deferred (with reasons), still on Claude's list:**
- Per-setter phone-binding UI (slots 4-10) + UUID-native cadence picker in `Engagement.tsx` — large net-new UI on big files; legacy slot path works today.
- Retire legacy reactivation (`bulk-insert-leads`/`campaign-executor`/`campaign_leads`) — wait until native reactivation is confirmed by a real prod run.
- Gate `/debug-*` routes behind creator mode in App.tsx — useCreatorMode (`cb`) is available; needs careful routing edit.
- Dual root lockfile — NOT removed: no Railway/packageManager config found, so changing it could affect the live build's auto-detection. Recommend deciding npm-vs-pnpm deliberately.
- CI migrations-converge check — no `.github/workflows` exists yet; add when CI is set up.
- Regenerate `types.ts` (see above).
