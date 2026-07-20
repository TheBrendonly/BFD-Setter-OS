---
description: Next BFD-setter build-session kickoff (authored 2026-06-16 after the P0-P2 cluster shipped). Lead item = finish cutting GHL out of the outbound SMS send path so the leadconnectorhq webhook fields become removable. Plus the full filtered remaining backlog (Claude-buildable + gated) and the Brendan action/test list.
---

> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---

# Next Build Session Kickoff (2026-06-17)

Prior session (2026-06-16, HEAD `5bf22e3`) shipped the full P0-P2 cluster (voice publish fix + booking collapse + doc-page UI + sig-verify rewrite + analytics recordings + probe is_system bypass + ChatAnalytics hang + credentials cleanup + inbound webhook manifest) and retired the n8n remnants (Simulation card + api_webhook_url mirror). Record: `Operations/handoffs/2026-06-16-p0-p2-cluster-build.md`. The P0 fix is VERIFIED live (Main Outbound agent v15 is now `is_published=true`, phone repinned).

This list is FILTERED — everything shipped in the 2026-06-15/16 builds is excluded. Only genuinely-open work remains.

## Constraints (unchanged)
Voice prompt CONTENT is Brendan's only (report, never edit). Edge fns via `deploy_single_fn.mjs` / `deploy_with_shared.mjs` / `deploy_retell_proxy_bundle.mjs` (`node --env-file=.env`, PAT in `.env`). New fns need `verify_jwt=false`. Migrations via the Management API SQL runner + committed `.sql`. Multi-DB → surgical types.ts. Verify each stage (tsc + deploy + server check) then a UI smoke list. Commit + push per chunk. No em dashes. **Sequencing rule (Brendan): the full live run-through is the LAST thing — land all Claude builds + all Brendan provisioning/prompt work BEFORE the single test pass so nothing overlaps.**

---

## ⭐ LEAD ITEM — finish cutting GHL out of the outbound SMS send path

Context: Brendan flagged the 5 `services.leadconnectorhq.com/.../webhook-trigger/...` fields (Send Setter Reply / Message / Follow-Up / Engagement / Stop Bot) as clutter, since GHL is no longer the source of truth. Investigation (`project_ghl_is_the_outbound_send_channel`) found: **SMS replies already go DIRECT via Twilio** (`processMessages.ts` STEP 6.1b, line ~366) and **GHL is updated via the conversations API** (`pushSmsToGhl`, line ~409) — exactly as Brendan described. BUT leftover GHL-webhook wiring still references those fields, so they can't just be hidden:

1. **Reply path** — `processMessages.ts` STEP 6 (line 300-340) STILL POSTs to `ghl_send_setter_reply_webhook_url` first and THROWS on failure (335) / missing field (106), *before* the real Twilio send. That GHL workflow does NOT deliver the SMS (can't substitute `{{contact.phone}}` — the reason 6.1b exists). So it's a vestigial gate + footgun. **Fix:** remove STEP 6 + the line-106 guard so SMS no longer touches the GHL webhook. (BFD is SMS-only — `message_queue` shows only `sms_outbound` — so STEP 6's non-SMS deliverer role is unused. If multi-channel reply delivery is ever needed, gate STEP 6 to non-SMS instead of deleting.)
2. **Follow-ups** — `sendFollowup.ts` STEP 8 (line 325) STILL sends via `send_followup_webhook_url` (GHL), no Twilio path; 8 have fired this way. **Fix:** add a Twilio-direct send to sendFollowup mirroring STEP 6.1b (+ `pushSmsToGhl` mirror), then drop the GHL dependency.
3. **Audit** `send_engagement_webhook_url` (WhatsApp + push-engagement-now), `send_message_webhook_url` (crm-send-message), `stop_bot_webhook_url` (stop-bot-webhook) for native equivalents; replace where SMS-only, keep where a channel genuinely needs GHL.
4. **Then** remove the 5 GHL outbound webhook fields from `ApiCredentials.tsx` (state/type/sync/render) — keep the DB columns.

This touches the LIVE messaging path. Ship as one chunk; Brendan fires a live inbound reply + a follow-up to TEST_PHONE_A to confirm before trusting. Then these fields disappear from setup (the original goal).

---

## CLAUDE BUILD — ungated (pick order with Brendan)

- **F7 / E4 secret-column lockdown** (security, deferred from 2026-06-16): make `useClientCredentials` write-only — stop fetching `*_api_key`/`*_token`/`supabase_service_key`/`*_webhook_secret` into the browser; show "configured/not configured"; serve secrets only via the authorized `webhook-manifest`/`verify-credentials` fns. Riskiest part is not breaking agency cred-saving — stage carefully, verify a save still works + a client-role gets no secrets. (Manifest already serves inbound secrets server-side; exposure is agency-only today.)
- **Review polish:** cost-ceiling breach-log throttle (one log/ceiling/day, not per-call); orphaned-UUID badge in the voice-setter picker (`Engagement.tsx`); inbound-webhook observability log.
- **2.3 per-setter phone-binding UI** for voice setters 4-10 (schema ready; slots 1-3 backfilled).
- **3.10 tz-aware `nudgeColdReply` cron** (currently fixed UTC; per-tenant/lead-local-time).
- **VC1/VC3 close-out** (low): VC1 `active_call_id` is already nulled on the cadence-critical path (`retell-call-webhook:211`) — verify the analysis-webhook cancel path + document/close. VC3 pick the canonical voice-coordination path (analysis-webhook `treat_pickup_as_reply` is live; `last_call_outcome` polling is vestigial) and document/retire.
- **F10** stale `awzlcmdomhtyqjabzvnn` URL in 4 cron migrations (URL-only, no key leak — low).
- **N5 stale-template cleanup** (report-first): ~14-42 JSON templates in `frontend/public/*` with dead n8n/railway hosts + deleted `llm_22e795`; orphan `_archived` Webinar components.
- **Schema-drift reconcile** (investigate-first): 6 referenced-but-missing tables (`messages`, `payment_attempts`, `simulation_analysis_messages`, `supabase_usage_cache`, `sync_ghl_executions`, `sync_ghl_booking_executions`) + `engagement_executions.ghl_contact_id` not renamed to `lead_id`.
- **5.1/5.2 rebrand polish** (UI-text): SetupGuide screenshots + text still say "1Prompt"; pun-quiz lessons (`MultiAgentLogicStep.tsx`/`VoiceInboundLogicStep.tsx`) pun on "1prompt". Reshoot/rewrite to BFD.
- **V4 latency tune** (optional): lower `clients.debounce_seconds` 60→20-30s for snappier replies.
- **Account-access restructure** (design-first): My Account = client self-serve (admin-governed fields); admin config under Manage Sub-Accounts per sub-account. Mirror the existing client-menu-config control.
- **Client-role login provision** (6.2): create a test client-role user (scoped via `profiles.userClientId`), confirm RLS-scoped landing. Fold into Client #2.
- **4.2 Phase 10 n8n decommission** (after a clean native-engine soak): delete the n8n else-branch in `processMessages.ts`, optionally drop the legacy webhook column, shut down the n8n Railway service. (Overlaps the LEAD item above.)

## CLAUDE BUILD — gated on Brendan's live tests
- **P3a retire legacy outbound direction columns** (`DIRECTION_TO_AGENT_COLUMN` + `retell_*_agent_id` → ownership on `voice_setters`) — gated on the outbound repoint + live call on cadence `40e8bea3`. High blast radius; plan first.
- **P3b CF fleet rollout + retell-proxy single-prompt/CF engine-adapter refactor** — gated on the CF A/B passing (booking rate ≥ control, no `llm_token_surcharge` line, llm p50 < 900ms).
- **2.1 cadence v2 activation** (workflow `c206da3e`) — gated on the UUID migration live + a test-lead pass; bundle with the A5/D4 UUID migration.
- **2.6 cost-per-booking dashboard** — gated on ~60 days of `cadence_metrics` data.
- **HIBP flip** — gated on Brendan upgrading Supabase to Pro.
- **D5 custom SMTP wiring** — gated on Brendan picking a provider (Resend recommended).

## LARGER FEATURES — pick with Brendan (roadmap §3)
- **3.1 A/B testing** (research brief FIRST, then 3.1a campaign-level → 3.1b agent-level → 3.1c AI-variants).
- **3.2 agent-by-form-field** within one cadence (~80% covered by tag-per-campaign today).
- **3.5 multi-workflow enrollment state machine** (XL; prerequisite for 3.6/3.7).
- **3.6 long-tail nurture** workflow. **3.7 behavioral re-warm** triggers (needs click-tracking infra).

## RESEARCH (not build) — on Brendan's say-so
- A/B testing research brief (sub-agents → report, no build).

---

## BRENDAN — action list (do BEFORE the final test run; sequence matters)

**A. Voice prompts (one prompt session — applies via BFD setter UI; Claude never edits):**
1. Re-save the 4 remaining Garys (slots 4-7) [Main Outbound already done + verified] → send call_id(s) for Claude's read-only version-repoint + latency check.
2. Fold these report-only prompt fixes into the SAME session: T10b inbound "ask for details" drop; Mortgage Gary persona contradiction (broker vs AI-setter); Property Gary placeholder company + theme mismatch; V6 weekend-slot constraint (only offer get-available-slots results); Crazy Gary (+ orphan master) missing send-sms/schedule-callback tools.

**B. Provisioning / keys (non-test):**
3. Provide the Retell + Unipile webhook signing secrets → Claude stores `retell_webhook_secret`/`unipile_webhook_secret` + arms with a controlled test (sig-verify code is now correct). Retell secret value = the Retell API key.
4. AU SMS: register the Messaging Service / A2P for `+61481614530`; confirm which of the 2 Twilio accounts real leads text from.
5. (Optional, when ready) Upgrade Supabase to Pro → Claude flips HIBP.
6. Decisions to confirm: GHL-send-channel migration go-ahead (the LEAD item); email provider (built-in now / Resend later — already leaning built-in); Twilio number model (BYO-per-client recommended); SetupGuide canonical BFD folder name (for the screenshot reshoot).

**C. THE FULL RUN-THROUGH TEST (LAST — single pass, after A+B + Claude's GHL build land):**
7. Inbound phone-first call to `+61481614530` from a known-lead phone → greets by name, doesn't re-ask details.
8. Outbound: repoint cadence `40e8bea3` onto "Main Outbound" in the UUID picker, fire a live outbound to TEST_PHONE_A → dials on the right agent (this unblocks P3a).
9. Pause/resume E2E: enrol a test lead in a multi-step cadence with an early delay, pause (no sends), resume (new trigger_run_id, no dup).
10. Reply + follow-up send via Twilio (confirms the LEAD-item migration): inbound text → AI reply arrives; a scheduled follow-up arrives.
11. CF pilot A/B (if the CF agent is built in Retell): vs control on booking rate / latency p50 / cost (unblocks P3b).
12. UI smoke: doc-page Expand Advanced Settings + relabeled button; Voice Analytics recordings/transcripts list; Credentials → Inbound Webhooks card (Copy + pills + go-live badge); probe direct URL empty state; Group 1 8-item list.
13. Confirm the synthetic probe goes green (a passing `probe_results` row on the next hourly run — the message_queue write is fixed + manually verified).

---

## Already done / closed (do NOT rebuild)
P0 voice publish (v36, verified live) · P1 booking collapse + doc-page UI · P1 credentials cleanup + webhook manifest (v2) · P2 sig-verify (v19/v21/v3) · P2 analytics recordings + New User Messages (v14) · P2 probe is_system bypass (v9, message_queue write verified) · P2 ChatAnalytics hang · D1 pause/resume (code) · D2 cost ceiling (code) · D3 voice analytics source · B1 Total Voice Call (v13) · MFA (enrolled) · hide-probe · 6.1 sidebar · UUID picker (code) · CF engine groundwork · n8n Simulation card + api_webhook_url mirror retired · VC1 active_call_id (cadence path) · GITHUB_PAT rotated (2026-06-14) · landing sort_order (BFD=0).
