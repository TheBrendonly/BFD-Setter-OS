---
description: Session closeout (2026-06-16, HEAD 5bf22e3 → cd66282 docs). Single source of truth for what's left after the P0-P2 cluster build, split into (1) missed things, (2) Brendan's tasks, (3) build tasks. Plus copy-paste kickoff prompts for each phase, executed in order: missed → my tasks → build sessions (full run-through test is the very last thing).
---

# BFD-Setter — Session Closeout + Next Prompts (2026-06-16)

**State:** HEAD `cd66282` on `main` (Forgejo + GitHub). The P0-P2 cluster shipped, deployed, verified live (full record: `Operations/handoffs/2026-06-16-p0-p2-cluster-build.md`; next-build detail: `Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md`). The P0 voice-publish fix is confirmed live (Main Outbound agent v15 `is_published=true`, phone repinned).

**Execution order (Brendan):** 1) Missed things → 2) My tasks → 3) Build sessions. The **full live run-through test is the LAST thing of all**, after the build sessions, so it validates everything in one pass and nothing overlaps. The few GATED builds (P3a column drop, P3b CF fleet rollout, cadence-v2 activation) necessarily come AFTER that test because they depend on its results — they are a short post-test round.

**Hard rule:** voice prompt CONTENT is Brendan's only — Claude reports wording, never edits Retell or repo prompt files.

---

## SECTION 1 — MISSED THINGS (gaps, watch-items, decisions, couldn't-build)

1. **Probe — confirm it goes green (watch).** The `intake-lead v9` is_system bypass is live and verified (a manual probe POST wrote the `sms_outbound` message_queue row the canary asserts). BUT no probe run is recorded since 2026-06-15 22:02 (all prior runs failed pre-fix). It should pass on the next hourly run; if it never fires, the Trigger.dev cron needs a poke. Not a build — a verification.
2. **Retell + Unipile webhook secrets still NULL (blocker for full webhook security).** The sig-verify code is now correct (real Retell `v=,d=` scheme), but the secrets aren't provided, so those paths remain forgeable (verify-if-present is inert). Decision: provide them now (→ Claude arms + tests) or keep deferred. GHL is already done + enforced.
3. **GHL send-path — decision/go-ahead.** Confirmed: SMS replies already go DIRECT via Twilio + GHL is updated via API; the `leadconnectorhq` webhook fields are mostly vestigial leftovers. Removing them is a small CODE cleanup (not a UI tweak), scoped as Build-1's lead item. Needs your go-ahead since it changes the live messaging path. (Detail: `project_ghl_is_the_outbound_send_channel`.)
4. **Couldn't build this session (by design):** F7 deep secret-column lockdown (risk to cred-saving — descoped/flagged); P3a + P3b (gated on your live tests); the GHL send-path cleanup (needed your go-ahead). All carried into the build prompts.
5. **FYI, no action:** the legacy `api_webhook_url` n8n cred-mirror is fully retired (kept the external-Supabase sync); the Simulation/n8n card is removed from the UI.

---

## SECTION 2 — BRENDAN'S TASKS (in order; the full test is the last item)

### 2A. Voice prompts (one BFD-setter UI session)
- [ ] Re-save the 4 remaining Garys (slots 4-7). [Main Outbound slot 1 already done + verified.] Send Claude the call_id(s) for read-only version-repoint + latency check.
- [ ] In the SAME session, apply the report-only prompt fixes: T10b inbound "ask for details" drop · Mortgage Gary persona contradiction (broker vs AI-setter) · Property Gary placeholder company + theme mismatch · V6 weekend-slot constraint (only offer get-available-slots results) · Crazy Gary (+ orphan master) missing send-sms/schedule-callback tools.

### 2B. Provisioning / keys (non-test)
- [ ] Provide Retell + Unipile webhook signing secrets (Retell value = the Retell API key) → Claude stores + arms with a controlled test.
- [ ] AU SMS: register the Messaging Service / A2P for `+61481614530`; confirm which of the 2 Twilio accounts real leads text from.
- [ ] (Optional, when ready) Upgrade Supabase to Pro → Claude flips HIBP leaked-password protection.

### 2C. Decisions to lock
- [ ] GHL send-path migration: go / no-go (recommended: go — it's what makes the webhook fields removable).
- [ ] Email provider: built-in mailer now / Resend later (leaning built-in).
- [ ] Twilio number model: BYO-Twilio-per-client (recommended) vs shared.
- [ ] SetupGuide canonical BFD folder name (for the screenshot reshoot).

### 2D. THE FULL RUN-THROUGH TEST (the very last thing — after the build sessions)
- [ ] Inbound phone-first call to `+61481614530` from a known-lead phone → greets by name, doesn't re-ask details.
- [ ] Outbound: repoint cadence `40e8bea3` onto "Main Outbound" in the UUID picker, fire a live outbound to TEST_PHONE_A → dials on the right agent. (Unblocks P3a.)
- [ ] Pause/resume E2E: enrol a test lead in a multi-step cadence with an early delay; pause (no sends); resume (new trigger_run_id, no dup).
- [ ] Reply + follow-up sent via Twilio (validates the GHL send-path migration): inbound text → AI reply arrives; a scheduled follow-up arrives.
- [ ] CF pilot A/B (if the CF agent is built) → vs control (booking rate / latency p50 / cost). (Unblocks P3b.)
- [ ] UI smoke: doc-page Expand Advanced Settings + relabeled button · Voice Analytics recordings/transcripts list · Credentials → Inbound Webhooks card (Copy + pills + go-live badge) · probe direct URL empty state · Group 1 8-item list.
- [ ] Confirm the synthetic probe shows a passing `probe_results` row.

---

## SECTION 3 — BUILD TASKS (Claude; grouped by session)

### Build 1 — "the cluster" (most tasks + issues, one session)
Ships BEFORE the final test so the test covers it.
- **GHL send-path migration (lead):** remove `processMessages` STEP 6 reply-forward + line-106 guard; add Twilio-direct send to `sendFollowup` (mirror STEP 6.1b + `pushSmsToGhl`); audit `send_engagement`/`crm-send-message`/`stop-bot` for native equivalents; then remove the 5 GHL outbound webhook fields from `ApiCredentials.tsx` (keep DB columns).
- **Arm Retell + Unipile secrets** (only if Brendan provided them in 2B) → store + controlled live test → revert on any 403.
- **F7/E4 secret-column lockdown:** write-only `useClientCredentials`.
- **Review polish:** cost-ceiling breach-log throttle · orphaned-UUID badge in the voice-setter picker · inbound-webhook observability log.
- **2.3** per-setter phone-binding UI (setters 4-10). **3.10** tz-aware nudgeColdReply cron. **V4** lower debounce_seconds.
- **VC1/VC3 close-out** · **F10** stale project-ref URL in 4 cron migrations.
- **N5 stale-template cleanup** (report-first) · **schema-drift reconcile** (investigate-first).
- **5.1/5.2** "1Prompt"→BFD setup-guide screenshots + pun-quiz copy.

### Build 2 — A/B testing (its own session; research FIRST, then build)
Research brief via sub-agents → report → then 3.1a campaign-level → 3.1b agent-level → 3.1c AI-variants. No build until the research report is reviewed.

### Build 3 — Conversation Flow full setup (its own session; has prerequisites)
The CF engine groundwork shipped (rigid 5-node template + retell-proxy round-trip). This session = build the fleet-rollout tooling + the retell-proxy single-prompt/CF engine-adapter refactor — GATED on the CF A/B pilot passing. PREREQUISITE CHECK before this runs (see prompt).

### Build 4 — P3a: retire legacy outbound direction columns (its own session; post-test, gated)
Kill `DIRECTION_TO_AGENT_COLUMN` + `retell_*_agent_id`; move direction ownership onto `voice_setters`; inbound-only directions UI. High blast radius — plan first. Gated on the outbound live-call test passing.

### Build 5 — Account-access restructure (its own session; design-first)
My Account = client self-serve (admin-governed fields); admin config moves under Manage Sub-Accounts per sub-account. Design + approval before code.

### Build 6 — Lifecycle features (its own session; large)
3.5 multi-workflow enrollment state machine (XL; prerequisite for) → 3.6 long-tail nurture → 3.7 behavioral re-warm. Plus 3.2 agent-by-form-field if wanted.

### Post-test / gated round (after the final test confirms gates)
- **P3b** CF fleet rollout (after CF A/B passes) — folds into Build 3.
- **2.1** cadence v2 activation (after UUID migration + test-lead pass).
- **2.6** cost-per-booking dashboard (after ~60 days of data).
- **HIBP flip** (after Supabase Pro). **D5** custom SMTP (after provider pick).

---

# COPY-PASTE PROMPTS (run in this order)

## PROMPT 1 — Missed-things closeout
```
BFD-setter missed-things closeout. Read Docs/SESSION_CLOSEOUT_2026-06-16_AND_NEXT_PROMPTS.md Section 1 + Operations/handoffs/2026-06-16-p0-p2-cluster-build.md + memory project_probe_enable_status, project_ghl_is_the_outbound_send_channel, project_webhook_sig_verify_scheme_bug. Then, read-only:
1. Check public.probe_results for any run after 2026-06-15 22:02 and whether it passed. If none fired, check the Trigger.dev synthetic-probe cron is still scheduled and report how to re-trigger it. The intake-lead v9 is_system bypass is live and a manual POST already wrote the sms_outbound message_queue row, so a fresh run should pass — confirm or surface the real remaining failure.
2. Confirm current secret state for BFD (retell_webhook_secret / unipile_webhook_secret NULL; ghl/intake set) via the Management API.
3. I will tell you my decisions: GHL send-path migration go/no-go, whether I'm providing the Retell/Unipile secrets now, email provider, Twilio number model. Capture them into memory + the closeout doc so the build sessions pick them up.
Do not build anything. Report findings + a short "ready for my tasks?" checklist.
```

## PROMPT 2 — Verify my completed setup tasks
```
BFD-setter: I've done my setup tasks (Docs/SESSION_CLOSEOUT_2026-06-16_AND_NEXT_PROMPTS.md Section 2A+2B). Verify read-only, no prompt edits:
1. I re-saved the 4 Garys (slots 4-7). Here are the call_id(s): <PASTE>. For each, and for Main Outbound, confirm the agent's latest version is is_published=true and the phone (if attached) repinned. Read get-call on the call_id(s): llm_token_usage.average, latency.llm.p50, zero 4500ms-timeout lines, tool_calls fired (booking), no phantom get_contact, persona/greeting intact. Report pass/fail per agent.
2. If I've provided the Retell + Unipile webhook secrets (I'll paste them or say they're in the vault), store retell_webhook_secret / unipile_webhook_secret and run a controlled live test: confirm a SIGNED webhook passes and an unsigned one is rejected once armed; revert to NULL on any 403. The sig-verify code is _shared/verify-webhook.ts (already deployed).
3. Re-run the report-only prompt-fix checklist (T10b, Mortgage Gary, Property Gary, V6, Crazy Gary tools) and tell me which I still have outstanding based on a read-only pull of the live agents.
Do not edit any prompt content. Hand me a clean "setup verified" summary + what (if anything) is still mine to do before the build session.
```

## PROMPT 3 — Build session 1 (the cluster)
```
BFD-setter build session 1 (the cluster). Read Docs/SESSION_CLOSEOUT_2026-06-16_AND_NEXT_PROMPTS.md Section 3 "Build 1" + Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md + memory project_ghl_is_the_outbound_send_channel, project_p0_p2_cluster_build_2026_06_16, feedback_no_internal_prompt_edits, feedback_verify_before_moving_on.

Propose a STAGED plan (get approval before structural changes), then build, staged + verified + committed/pushed per chunk:
1. LEAD — GHL send-path migration: in trigger/processMessages.ts remove STEP 6 (the ghl_send_setter_reply_webhook_url forward, ~300-340) + the line-106 guard so SMS no longer depends on the GHL webhook (Twilio STEP 6.1b + pushSmsToGhl already deliver + mirror); in trigger/sendFollowup.ts add a Twilio-direct send (mirror STEP 6.1b) + pushSmsToGhl mirror, then drop send_followup_webhook_url; audit send_engagement_webhook_url (WhatsApp/push-engagement-now), crm-send-message (send_message_webhook_url), stop-bot (stop_bot_webhook_url) and migrate the SMS-only ones; THEN remove the 5 GHL outbound webhook fields from ApiCredentials.tsx (keep DB columns). BFD is SMS-only. Redeploy the Trigger tasks (npx trigger.dev@4.4.4 deploy). This is the LIVE messaging path — flag the exact live reply + follow-up test I must run after.
2. Arm Retell/Unipile secrets if I've provided them (else skip + flag).
3. F7/E4 write-only useClientCredentials (don't break agency cred-saving; descope if it destabilizes).
4. Review polish: cost-ceiling breach-log throttle, orphaned-UUID badge in the Engagement voice-setter picker, inbound-webhook observability log.
5. 2.3 per-setter phone-binding UI (setters 4-10); 3.10 tz-aware nudgeColdReply cron; V4 debounce tune.
6. VC1/VC3 close-out; F10 stale awzlcmdomhtyqjabzvnn URL in the 4 cron migrations.
7. N5 stale templates (report-first, edit only approved); schema-drift reconcile (investigate-first).
8. 5.1/5.2 1Prompt→BFD setup-guide screenshots text + pun-quiz copy.
Constraints: deploy edge fns via the scripts (node --env-file=.env), new fns verify_jwt=false, migrations via Management API + committed .sql, surgical types.ts, tsc clean, no em dashes, adversarial-review the diff before declaring done. Do NOT touch the gated items (P3a/P3b/cadence-v2). End with a UI/live smoke list for me + an updated handoff. The full run-through test happens AFTER this session.
```

## PROMPT 4 — A/B testing research (own session, research only)
```
BFD-setter A/B testing research brief (RESEARCH ONLY — no build). Read Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md (roadmap 3.1) + FEATURE_ROADMAP.md §3.1a/b/c + the existing per-campaign/per-node setter-selection + variant plumbing (Try-Gary, voice_setter_id_override, aiGenerateEngagementCopy). Spin up sub-agents to produce a report covering: (a) campaign-level vs agent-level vs AI-generated-variant A/B, (b) the schema changes each needs (relax the partial unique index, variant-assignment table, resolver rotation), (c) how results are measured against cadence_metrics, (d) how the report-only prompt rule constrains agent-variant rollout (Brendan applies winners via the UI), (e) a recommended phased build order + effort. Deliver as Docs/AB_TESTING_RESEARCH_<date>.md. Do not write feature code.
```

## PROMPT 5 — Conversation Flow full setup (own session; prerequisites first)
```
BFD-setter Conversation Flow full build. FIRST verify my prerequisites are done before building anything — if any are missing, STOP and tell me:
- The CF engine groundwork is live (retell-proxy syncVoiceSetterConversationFlow; "Convert to Conversation Flow" entry point). Confirm via the deployed retell-proxy.
- I have built the CF agent node graph in the Retell dashboard on Voice-Setter-Test per Docs/CONVERSATION_FLOW_PILOT_DECOMPOSITION_2026-06-15.md (node prompts are mine).
- I have run the CF A/B pilot vs control and it PASSED its gate (booking rate >= control, no llm_token_surcharge line, llm p50 < 900ms). Paste the A/B numbers / call_ids.
THEN, only if the gate passed: build the CF fleet-rollout tooling + the retell-proxy single-prompt vs CF response_engine adapter split (rearch b) so a single-prompt save can't clobber a flow. Read Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md (Build 3 / P3b) + memory project_retell_conversation_flow_eval_2026_06_11. Staged plan + approval before structural changes; verify + commit per chunk.
```

## PROMPT 6 — P3a: retire legacy outbound direction columns (own session; post-test)
```
BFD-setter P3a — retire the legacy outbound direction columns. PREREQUISITE: the outbound repoint + live call on cadence 40e8bea3 onto "Main Outbound" (UUID picker) must have PASSED in my run-through test — confirm with me before touching anything. Then, with a staged plan + approval (HIGH blast radius — this is the live booking path): kill DIRECTION_TO_AGENT_COLUMN + retell_outbound_agent_id / retell_outbound_followup_agent_id, move direction ownership onto voice_setters, make the directions UI inbound-only, and clean make-retell-outbound-call's legacy branch. Read Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md (P3a) + memory project_voice_setters_redesign_in_progress + the save-setter-guard / EE1 history so the fix doesn't reintroduce the 2026-05-18 fan-out wipe class. Verify nothing still reads the dropped columns first. Live outbound test after.
```

## PROMPT 7 — Account-access restructure (own session; design-first)
```
BFD-setter account-access restructure (DESIGN FIRST, then build on approval). Read memory project_account_access_restructure_idea + Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md (Build 5). Goal: My Account = client self-serve over an admin-governed subset of fields; admin-only config moves under Manage Sub-Accounts per sub-account; admin can lock which fields a client sees (mirror the existing client-menu-config control). Files: AccountSettings.tsx, ClientSettings.tsx, ClientLayout.tsx sidebar, ManageClients, the client-menu-config pattern. Produce the design + a migration/RLS plan + the field-governance model, get my approval, THEN build staged. Don't change the live permission model without sign-off.
```

## PROMPT 8 — Lifecycle features (own session; large)
```
BFD-setter lifecycle features (large; staged). Read FEATURE_ROADMAP.md §3.5/3.6/3.7 (+ 3.2) + Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md (Build 6). Build order: 3.5 multi-workflow enrollment state machine FIRST (lets a lead transition Hot Pursuit / Cool Down / Long-Tail / Re-engage) — this is the prerequisite; then 3.6 long-tail nurture (email-only drip post-cadence) and 3.7 behavioral re-warm (email-click + GHL pricing-page-visit re-enrol, needs click-tracking infra). Optionally 3.2 agent-by-form-field. Staged plan + approval before each; this is core cadence plumbing so verify with test-lead runs.
```

---

## Pointers
- Full session record: `Operations/handoffs/2026-06-16-p0-p2-cluster-build.md`
- Filtered backlog detail: `Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md`
- Live messaging-path facts: memory `project_ghl_is_the_outbound_send_channel`
- Prompt/agent rules: memory `feedback_no_internal_prompt_edits`, `feedback_verify_before_moving_on`
