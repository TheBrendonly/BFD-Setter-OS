---
description: Two pasteable prompts for tonight's PARALLEL build sessions (bug-sweep + SMS-feature), partitioned by file/domain with a shared isolation contract so they don't collide. Generated 2026-06-19 after the live E2E verification.
---

# Tonight's parallel sessions — bug-sweep + feature-build

Two sessions run at the same time. They are partitioned so they **never edit the same files** and **never deploy concurrently**. Paste PROMPT A into one session, PROMPT B into the other.

## Why the split
The SMS/cadence engine bugs (6.5 by-phone STOP/resolution, 6.9 SMS reply-only, 6.11 missed-call outcome stamping) live in the SAME files that the MAJOR feature 3.12 (SMS tool parity) rewrites. So the **feature session owns the whole engine** (3.12 + 6.5/6.9/6.11), and the **bug session owns everything else** (frontend + standalone edge fns). That is the only way to get true parallel isolation.

## SHARED ISOLATION CONTRACT (in both prompts)
1. **Isolated worktree + branch.** Use the superpowers `using-git-worktrees` skill. Bug branch `fix/bug-sweep-2026-06-19`, feature branch `feat/sms-tool-parity-2026-06-19`. Never edit files outside your domain (lists below).
2. **NO deploys to shared live infra during the parallel run** — no `supabase functions deploy`, no `trigger.dev deploy`, no Railway deploy, no live DB migration apply. **Commit to your branch only.** Deploys are ONE coordinated step after both branches are reviewed + merged (Brendan/follow-up session, order: migrations → edge fns → Trigger → Railway; Trigger pinned `trigger.dev@4.4.4`).
3. **Verify without deploying:** `cd frontend && npx tsc --noEmit`; `deno test` for edge-fn `_shared` helpers; read-only Supabase Management API SQL runner (SELECT only, project `bjgrgbgykvjrsuwwruoh`, `node --env-file=.env`, Bearer `$SUPABASE_PAT`). Do NOT use the connected postgres MCP (points at an unrelated railway DB).
4. **Voice-agent prompt CONTENT is report-only** — never edit prompts in Retell or repo prompt files; report the change for Brendan to apply in the BFD setter UI.
5. **Migrations:** if needed, unique timestamp, DO NOT apply live; stage + note for the coordinated deploy.
6. **Trigger.dev:** both domains contain Trigger tasks (feature: processMessages/runEngagement; bug: syntheticProbe). Per rule 2, NEITHER deploys Trigger during the run — one coordinated Trigger deploy from merged main afterwards.
7. **Shared docs** (`FEATURE_ROADMAP.md`, `Docs/BUG_LIST.md`, `User Todos.md`): each ticks ONLY its own items; resolve any conflict at merge.
8. `_shared/phone.ts` is READ-ONLY for both (import only; coordinate if a change is truly needed).
9. Use superpowers (`brainstorming`/`writing-plans`/`test-driven-development`/`systematic-debugging`/`verification-before-completion`) and end with a per-item PASS/FAIL + a commit per item.

---

## PROMPT A — BUG-SWEEP SESSION (frontend + standalone edge fns)

```
BFD-setter BUG-SWEEP session, 2026-06-19 (PARALLEL with a feature session — isolation contract below is mandatory).

FIRST read: Docs/BUG_LIST.md, FEATURE_ROADMAP.md §6, and memories project_create_setter_skips_wizard_bug, project_delete_setter_orphans_voice_setters_row_2026_06_19, project_normalized_phone_null_on_ghl_intake_2026_06_19, feedback_no_internal_prompt_edits, feedback_verify_before_moving_on. Latest state: Operations/handoffs/2026-06-19-live-e2e-verification.md.

YOUR SCOPE (frontend + standalone edge fns only). Fix, with a repro + test per bug:
- 6.10 sync-ghl-contact creates leads with normalized_phone=NULL — add `normalized_phone: normalizePhone(phone)` to the leads insert (~L512), import normalizePhone from _shared/phone.ts (read-only). Audit other NON-engine create paths.
- 6.3 refactor the 8 raw-fetch sites (manual-send class) to supabase.functions.invoke (lib/twilioNumbers.ts, pages/InstagramDMs, ApiCredentials, EmailInbox, DemoPageContactChat, components/instagram/AttendeeAvatar+AttendeeProfileDialog, components/contacts/ContactConversationHistory).
- 6.4 lead-edit-vs-GHL-resync: name-edit no-overwrite already verified (S4 2026-06-19); confirm + fix the CLEARED-field/phone-removal case (ContactDetail.tsx handleSaveContact + push-contact-to-ghl). [confirm source-of-truth with Brendan]
- 6.6 retell-inbound-webhook 403s when retell_webhook_secret armed — confirm Retell inbound signing; verify correctly OR exempt inbound webhook. Do NOT arm the secret. [Brendan provides secret after]
- 6.7 syntheticProbe canary race v2 — poll the message_queue check on a longer deadline / wait for status='completed' (Trigger start latency 45-82s). Code: trigger/syntheticProbe.ts. (Code only — do NOT deploy Trigger; flag for the coordinated deploy.)
- 6.1 sidebar SYSTEM labels (ClientLayout.tsx) — rename/group [Brendan confirm labels].
- 6.2 verify admin + sub-account logins (Auth.tsx + useAuth) [Brendan provides failing behaviour].
- 6.8 (report-only) greeting opener {{first_name}} — report the exact line for Brendan; do NOT edit prompt content.
- Deferred polish if time: delete-setter orphaned voice_setters row (PromptManagement delete handler + retell-proxy) — delete the voice_setters row when deleting the agent.

DO NOT TOUCH (feature session owns these): trigger/processMessages.ts, trigger/runEngagement.ts, frontend/supabase/functions/{voice-booking-tools,receive-twilio-sms,retell-call-webhook,retell-call-analysis-webhook}/, _shared/{leadResolve,optout,ghl-conversations}.ts. Do NOT take bugs 6.5, 6.9, 6.11 (engine — feature session owns them).

ISOLATION CONTRACT: work in a git worktree on branch fix/bug-sweep-2026-06-19 (superpowers using-git-worktrees). COMMIT per bug; do NOT deploy to live Supabase/Trigger/Railway and do NOT apply live DB migrations (the feature session is also live; deploys are coordinated AFTER merge). Verify via `cd frontend && npx tsc --noEmit` + `deno test` + the read-only Supabase Management API (SELECT only, node --env-file=.env, $SUPABASE_PAT; NOT the postgres MCP). Use superpowers systematic-debugging + TDD + verification-before-completion. End with a PASS/FAIL per bug + a list of what needs the coordinated deploy.
```

---

## PROMPT B — FEATURE SESSION (SMS/cadence engine: 3.12 + engine bugs)

```
BFD-setter FEATURE session, 2026-06-19: build 3.12 SMS/text setter TOOL PARITY (MAJOR/asap) + the engine bugs that share its files (PARALLEL with a bug session — isolation contract below is mandatory).

FIRST read: FEATURE_ROADMAP.md §3.12, §6.9, §6.11, §6.5; Docs/BUG_LIST.md; memories project_normalized_phone_null_on_ghl_intake_2026_06_19, project_inbound_reply_stuck_hold_fix_2026_06_18, project_internal_by_phone_leads_spec1_2026_06_18, feedback_no_internal_prompt_edits, feedback_verify_before_moving_on. Latest state: Operations/handoffs/2026-06-19-live-e2e-verification.md.

GOAL — 3.12 SMS tool parity: the text engine (trigger/processMessages.ts) is reply-only; give it the voice agent's action tools by invoking the EXISTING voice-booking-tools edge fn (clientId-scoped — NO new booking backend). Add a function/tool-calling layer so an inbound SMS can: get-available-slots, book-appointments, get-contact-appointments, update-appointment, cancel-appointments, schedule-callback. Multi-turn across the processMessages debounce window (offer slots → confirm → book); write the booking with source='sms'; honor the by-phone opt-out gate (STEP 1.5) and the report-only prompt rule. This closes 6.9.

ALSO (same files, so this session owns them):
- 6.11 missed/voicemail call doesn't stamp engagement_executions.last_call_outcome → runEngagement.waitForCallOutcome (runEngagement.ts:212-235) eats the full 600s ceiling → fallback SMS ~10 min late. Make the call-ended/analysis webhook stamp last_call_outcome for non-pickup (voicemail_reached/no_answer) outcomes too (answered calls already stamp + advance). Also clear active_call_id on the timeout branch.
- 6.5 internal by-phone STOP + inbound resolution (receive-twilio-sms): STOP stops ALL leads on a phone; resolve inbound internally by-phone (drop/΅minimize the GHL findOrCreateGhlContact fallback) so it's deterministic. [confirm internal-first model with Brendan]

START with superpowers brainstorming (design the SMS tool-calling layer + multi-turn state across debounce) then writing-plans, then TDD. Reuse voice-booking-tools (do not duplicate booking logic). 

DO NOT TOUCH (bug session owns these): frontend/src/**, frontend/supabase/functions/{sync-ghl-contact,retell-inbound-webhook,push-contact-to-ghl}/, trigger/syntheticProbe.ts. Do NOT take bugs 6.1/6.2/6.3/6.4/6.6/6.7/6.10.

ISOLATION CONTRACT: work in a git worktree on branch feat/sms-tool-parity-2026-06-19 (superpowers using-git-worktrees). COMMIT incrementally; do NOT deploy to live Supabase/Trigger/Railway and do NOT apply live DB migrations (the bug session is also live; deploys are coordinated AFTER merge). Verify via `cd frontend && npx tsc --noEmit` + `deno test` (voice-booking-tools/processMessages _shared helpers) + the read-only Supabase Management API (SELECT only, node --env-file=.env, $SUPABASE_PAT; NOT the postgres MCP). Voice-agent prompt CONTENT is report-only. End with a plan + tests + a list of what needs the coordinated deploy (edge fns + one Trigger deploy pinned trigger.dev@4.4.4).
```

---

---

# ⚠️ UPDATE 2026-06-19 — NOW 3 SESSIONS (added GHL-sync). This supersedes the 2-session split above.

A 3rd major bug (6.12 GHL sync incomplete) shares files with both sessions, so it gets its own session and the scopes are re-cut. **Use PROMPT A (re-scope delta), PROMPT B (re-scope delta), and PROMPT C below.**

## 3-way file ownership (never cross these lines)
- **Session 1 BUG (frontend + standalone):** `frontend/src/**`, `frontend/supabase/functions/sync-ghl-contact/`, `retell-inbound-webhook/`, `trigger/syntheticProbe.ts`. Items 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.10.
- **Session 2 FEATURE (SMS engine):** `trigger/processMessages.ts`, `trigger/runEngagement.ts`, `frontend/supabase/functions/voice-booking-tools/`, `receive-twilio-sms/`, `_shared/{leadResolve,optout}.ts`. Items 3.12, 6.9, 6.5 (+ the runEngagement `active_call_id`-clear half of 6.11).
- **Session 3 GHL-SYNC (NEW):** `frontend/supabase/functions/retell-call-analysis-webhook/`, `retell-call-webhook/`, `_shared/ghl-conversations.ts`, `push-contact-to-ghl/`. Items 6.12, 6.11 (webhook-stamp half), 6.13 (security fields), + the GHL custom-field cleanup (`Docs/GHL_CUSTOM_FIELDS_HITLIST.md`).

## Delta to PROMPT A (bug): also add to DO-NOT-TOUCH: `push-contact-to-ghl/`, `retell-call-analysis-webhook/`, `_shared/ghl-conversations.ts`. Fix **6.4 in `sync-ghl-contact` (the read-back/no-overwrite side), NOT in push-contact-to-ghl** (that's the GHL-sync session's).
## Delta to PROMPT B (feature): **remove 6.11's webhook work** (→ GHL-sync session); keep only the `runEngagement` `active_call_id`-clear-on-timeout. Add to DO-NOT-TOUCH: `retell-call-analysis-webhook/`, `_shared/ghl-conversations.ts`, `push-contact-to-ghl/`. You may CALL `pushSmsToGhl` but do NOT edit `ghl-conversations.ts`.

## PROMPT C — GHL-SYNC SESSION (research-heavy)

```
BFD-setter GHL-SYNC session, 2026-06-19: fix 6.12 (SMS not in GHL Conversations + call/SMS outcome variables not written to GHL) + 6.11 (stamp last_call_outcome for voicemail/no-answer) + 6.13 (security fields) + the GHL custom-field cleanup. PARALLEL with a bug session + a feature session — isolation contract is mandatory.

FIRST read: Docs/BUG_LIST.md (6.11, 6.12, 6.13), Docs/GHL_CUSTOM_FIELDS_HITLIST.md, FEATURE_ROADMAP.md §6.11/§6.12, and memories project_ghl_duplicate_contacts_split_2026_06_18 (outcome-field + conversation-provider gap), project_inbound_reply_stuck_hold_fix_2026_06_18, feedback_no_internal_prompt_edits, feedback_verify_before_moving_on. State: Operations/handoffs/2026-06-19-live-e2e-verification.md.

PHASE 1 — DEEP RESEARCH (use superpowers brainstorming + the deep-research/claude-api + context7 for GHL API docs; do NOT skip). Produce a written spec BEFORE coding:
  1. GHL Conversations API: exactly how to post inbound + outbound messages so they show in the contact's Conversations tab. Determine the role of `ghl_conversation_provider_id` (currently NULL on the BFD client) — confirm whether a CUSTOM CONVERSATION PROVIDER must be registered via a GHL marketplace app (and therefore [B] Brendan), or whether the conversations/messages/{inbound,outbound} endpoints work another way. Document the current behaviour: `_shared/ghl-conversations.ts` falls back to a NOTE when the provider id is null.
  2. Outcome-variable MAP: list every GHL contact field that should be populated from a call and/or an SMS conversation, and for EACH: the GHL field id (from the hit-list), the SOURCE of the value (SMS-as-they-happen, or Retell end-of-call report = custom_analysis_data / call_analysis / transcript), and WHEN it's written (per inbound/outbound SMS, vs once at call_ended). Use the KEEP-for-6.12 set in Docs/GHL_CUSTOM_FIELDS_HITLIST.md (Call Outcome, AI Call Summary, Call Intent, Last Call Date, status, callback fields, appointment fields) + the existing Setter Call Sentiment / Setter Appointment Booked. Note the type mismatch caveat (existing Sentiment=SINGLE_OPTIONS, Appointment Booked=CHECKBOX vs the code's plain-string writes — see the dup-split memory).
  3. Decide the write path: extend retell-call-analysis-webhook (call outcomes) + add an SMS-side field-writeback (in the GHL mirror, not in processMessages which the feature session owns — coordinate via _shared/ghl-conversations.ts which YOU own).

PHASE 2 — BUILD (TDD):
  - 6.12a: make SMS (inbound + outbound) post to the GHL Conversations tab (fix pushSmsToGhl + the provider path). If a marketplace-app provider is required, implement the code path + flag the provider registration as [B] Brendan, and verify the fallback/real path.
  - 6.12b: write the mapped outcome fields to the GHL contact — from the Retell end-of-call report (retell-call-analysis-webhook) for calls, and from the SMS conversation for texts. Provision any missing field ids on the clients row (server-side; coordinate the column values).
  - 6.11: in retell-call-analysis-webhook (the webhook that actually fires — agent webhook_url points here), stamp engagement_executions.last_call_outcome for voicemail_reached / no_answer outcomes (not just human_pickup) so runEngagement.waitForCallOutcome advances immediately instead of the 600s ceiling.
  - 6.13: verify (read-only) whether GHL fields "Supabase Service Role Key" (6uO14dISilgbMcn35Ne4) + "Supabase Project URL" (eRGxS6OZhW20KLxP2c1n) hold real values; report + plan their deletion (do not leave secrets in the CRM).
  - (Optional, if time) draft the GHL custom-field cleanup: a script/list to delete the ~101 PROBABLY-DELETE fields in Docs/GHL_CUSTOM_FIELDS_HITLIST.md — but DO NOT delete live; produce the actionable list for Brendan to confirm.

DO NOT TOUCH (other sessions own these): trigger/processMessages.ts, trigger/runEngagement.ts, frontend/supabase/functions/{voice-booking-tools,receive-twilio-sms,sync-ghl-contact,retell-inbound-webhook}/, frontend/src/**, trigger/syntheticProbe.ts. Do NOT take bugs 6.1/6.2/6.3/6.4/6.5/6.7/6.9/6.10 or feature 3.12.

ISOLATION CONTRACT: git worktree on branch fix/ghl-sync-2026-06-19 (superpowers using-git-worktrees). COMMIT incrementally; do NOT deploy to live Supabase/Trigger/Railway and do NOT apply live DB migrations (coordinated AFTER merge). Verify via `cd frontend && npx tsc --noEmit` + `deno test` + the read-only Supabase Management API (SELECT only, node --env-file=.env, $SUPABASE_PAT; NOT the postgres MCP) + read-only GHL GETs. Voice-agent prompt CONTENT is report-only. End with the Phase-1 spec + tests + a coordinated-deploy list + the [B] items (conversation provider, field-id provisioning, field deletions).
```

## After ALL THREE finish (coordinated, NOT during the parallel run)
Merge the 3 branches to main (resolve shared-doc conflicts: FEATURE_ROADMAP.md / BUG_LIST.md / User Todos.md — each session only ticked its own items). Then deploy ONCE in order: apply staged migration(s) → deploy changed edge fns with the `_shared` bundle (note voice-booking-tools bundles `_shared/ghl-conversations.ts`, so deploy it AFTER both the feature + GHL-sync changes are merged) → one `trigger.dev@4.4.4 deploy --env prod` → Railway picks up main. Then re-run live smokes: SMS booking (3.12), missed-call timing (6.11), a fresh GHL lead (6.10), SMS-in-Conversations + outcome fields (6.12).
