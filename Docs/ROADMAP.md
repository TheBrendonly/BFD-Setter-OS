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

---

## Future feature — "Agent-by-form-field" (within-cadence agent override)

**Want:** a form field's value picks which voice agent calls the lead (e.g. service_type=residential → Agent A, commercial → Agent B), within ONE cadence.

**Already possible today (no build):** different form → different tag → different Campaign, each Campaign carries its own agent. Use this when each form/business-line wants its own cadence+agent. Covers ~80% of cases.

**Net-new only needed for:** one shared cadence where the agent varies by a form-field value (not by form identity). The runtime mechanism already exists and is proven by Try-Gary (`voice_setter_id_override` in `contact_fields` → applied in `trigger/runEngagement.ts:973-981, 1353-1356`; no runEngagement changes needed).

**Design (when built):**
- `engagement_workflows.field_agent_mapping` JSONB: `{ form_field_key, value_to_agent: { <value>: <voice setter>, __default__: <voice setter> } }`.
- At ingress (ghl-tag-webhook / reactivate-lead-list): read the contact's GHL custom field, look up the map, set `voice_setter_id_override` in `contact_fields`.
- UI: a small "Override agent by form field" section on the campaign's phone-call node.

**Difficulty: MODERATE** (migration + a GHL custom-field fetch at enrol + UI; downstream already wired). **Recommendation: DEFER** — form-tag routing covers most needs; build when a second client actually needs same-cadence/different-agent. Lightweight interim: auto-generate one sub-campaign per field value from a template.

## UI holes — implementation plan (next session)

Frontend-only; deploys via Railway on push. Suggested order:
1. **Tag-input UX** (Workflows.tsx ~121-134) — S (~20m): label + helper text ("Form Tag — routes leads with this GHL tag here"), visual save confirmation, field-level empty error. Low risk.
2. **Activate toggle on the campaign row** (Workflows.tsx ~108-110) — M (~45m): add an enable/disable toggle to the list row reusing Engagement.tsx's is_active update pattern (lines ~3923-3948), with confirm. Low-med risk.
3. **Default-cadence badge + "Set as default"** (Workflows.tsx ~374-410) — M (~50m): fetch `clients.auto_engagement_workflow_id`, show a DEFAULT badge on that row + a "Set as default" action; help text "receives leads with no matching form tag". Low risk.
4. **Try-Gary persona-slot editor** (new `TryGaryPersonaSlotMapper`, in ClientSettings or a creator-only Workflows section) — M (~60m): dropdowns mapping agent_style → voice setter slot, writes `clients.try_gary_persona_slots`; hidden for non-BFD locations. Low risk.

Also worth doing in that session: surface/verify the **DB Reactivation** sidebar item for BFD (it's `menuItemsBeforeWebinar` → /campaigns; presentation_only_mode is off, so check the per-client menu config if hidden).

---

# SESSION LOG — 2026-05-31 (shipped + deployed to prod)

HEAD `14af1ee` on `main` (github + Forgejo). Supabase ref `bjgrgbgykvjrsuwwruoh`. All deployed + verified this session:
- **Form routing**: migration (multi tag-bound campaigns), `_shared/resolve-workflow.ts`, wired ghl-tag-webhook/sync-ghl-contact/intake-lead, Workflows.tsx UI.
- **Native reactivation**: `reactivate-lead-list` edge fn + CampaignCreate repoint (webhook path retired in UI).
- **Voice setters**: backfill migration (legacy_slot bridge), retell-proxy dual-write, 10 slots in RetellAgentsTab.
- **Isolation**: RLS on message_queue + active_trigger_runs.
- **Try-Gary**: deterministic routing to the `bfd_setter-try_gary` tag; that tag set on BFD's Try-Gary campaign (`3fda0794`, still inactive + blank cadence).
- **DB Reactivation sidebar bug**: it was missing from the menu catalog (`DEFAULT_MENU_ITEMS`) so it never rendered for anyone; added to catalog + patched BFD's `client_menu_config`.
- **Docs**: archived 9 stale docs, added Docs/README index + FORM_ROUTING.md + ROADMAP.md, ARCHITECTURE current.
- **Cleanup**: archived one-off scripts, removed vestigial webhook UI, renamed dead `bfdVoiceSetterPrompt.ts` -> `.md` (surfaced ~26 pre-existing type-drift errors — not build-breaking).

Verified-FALSE audit claims (left untouched): execution_logs RLS works (campaigns.user_id exists); LEGACY_N8N_HOST in use; elevenlabs-manage-agent referenced by an archived page; webinar components imported by active SetupGuideDialog. **Lesson for next session: verify every "dead code" claim before deleting.**

Ops notes: Supabase Management API SQL runner needs a non-python User-Agent (Cloudflare 1010 bans python-urllib). The `SUPABASE_PAT` in .env was refreshed this session (old one was revoked in the key rotation).

---

# NEXT SESSION — locked scope (decisions 2026-05-31)

**Decisions:** (1) canonical ingress = **sync-ghl-contact** (one URL, route by tag, default fallback). (2) agent-per-form = **tag-per-campaign ONLY** — retire the Try-Gary persona-slot mechanism; do NOT build the within-cadence override or the persona-slot UI. (3) **deploy autonomously** (migrations via PAT + edge fns + push, verifying each). (4) also include: regenerate types.ts, gate /debug-* pages, retire legacy reactivation, resolve dual lockfile. (5) **build the Try-Gary campaign** ready for tag ingress.

## Claude to-do (next session — do all, autonomously, to completion)
1. **Single-ingress consolidation**: make `sync-ghl-contact` the canonical lead-intake endpoint (robust tag routing + default fallback); **deprecate** the `try-gary-landing` special handler in ghl-tag-webhook (keep working, mark deprecated) and **remove the persona-slot override** (try_gary_persona_slots). Document the "one webhook URL + tag" pattern as THE client setup in FORM_ROUTING.md.
2. **UI hole 1** — tag-input UX on the campaign row (label, helper text, save confirmation, empty-field error). Workflows.tsx.
3. **UI hole 2** — activate/enable toggle on the campaign LIST row (reuse Engagement.tsx is_active pattern + confirm). Workflows.tsx.
4. **UI hole 3** — DEFAULT badge + "Set as default" action on campaign rows (clients.auto_engagement_workflow_id). Workflows.tsx.
5. **Try-Gary campaign build** — clone the main cadence ("New-Lead Cadence from Form-Fill", `40e8bea3`) into the Try-Gary campaign (`3fda0794`); keep tag `bfd_setter-try_gary`; set the phone_call node's voice setter [Brendan confirms which agent]; leave INACTIVE for Brendan review (do NOT author new message content — clone only).
6. **Regenerate** `frontend/src/integrations/supabase/types.ts` from the live schema (clears ~26 drift errors; picks up form_source, legacy_slot).
7. **Gate** /debug-ai-reps*, /debug-inject-lead behind creator/admin mode (App.tsx; useCreatorMode `cb` exists).
8. **Retire legacy reactivation** — FIRST verify native reactivation works end-to-end this session; then remove campaign-executor / bulk-insert-leads / campaign_leads code + UI refs + a drop/deprecate migration.
9. **Resolve dual lockfile** — delete root pnpm-lock.yaml, standardize npm; verify Railway build still works.
10. **Deploy everything autonomously** + verify each (migrations, edge fns, push) + update all docs + commit/push.

## Brendan to-do (hand to me at the end; I'll produce the detailed plan)
- **GHL** (the main one): point the Try-Gary form's automation at the SAME webhook URL as the main form (sync-ghl-contact) and have it add the routing tag; for each agent/form, one GHL automation that adds its tag + posts to that one URL.
- **Retell/Twilio**: provision the voice agent(s) + number(s) for Try-Gary / any per-agent campaigns.
- **Try-Gary cadence**: review/customize the cloned cadence content + confirm which agent calls; then activate it.
- **Test** end-to-end: submit a Try-Gary lead with its tag -> confirm it routes to the Try-Gary campaign and the right agent calls.

## Constraints for next session
- No authoring of prompt/message content (clone existing only).
- Verify every "dead code" claim before deleting (audit was wrong 3x this session).
- Backward compatible — never break the live main-form flow.
- Prod deploy authorized; valid SUPABASE_PAT in .env; Management API needs a browser-style User-Agent.
