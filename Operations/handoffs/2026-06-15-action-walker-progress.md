---
description: 2026-06-15 action-walker session progress — Brendan walked through the post-build task list (Tasks 1-14 resolved, 15-18 pending); one analytics fix shipped; several bugs + next-build items logged. Resume-ready checkpoint.
---

# Action-Walker Session Progress — 2026-06-15

Brendan ran the durable action-walker (`Docs/BRENDAN_ACTION_WALKER_PROMPT.md`) over the 18 post-build tasks. Session paused at Task 15 (Brendan finishing the voice rewrites once home). This is the resume point.

## Shipped this session (live + committed)

- **compute-analytics v13 — "Total Voice Call" N/A fix.** `computeDefaultMetrics` only ever emitted "Total Conversations"; the voice dashboard reads "Total Voice Call" → N/A. Now passes `isVoice` and emits the voice label. Deployed v13, verified live (tile renders **21**). The D3 `call_history` read itself was already working.

## Done / verified (no code needed)

- **T1 sidebar labels**, **T2 probe hidden** (is_system), **T3 pause/resume buttons** (code-verified; gated to running/pending — live exercise folded into T16), **T5 cost ceiling** (persisted `weekly_cost_ceiling_cents=5000`), **T6 Convert-to-CF button**, **T7 MFA card** — all confirmed.
- **T8 landing order** — APPLIED: `clients.sort_order` probe=100, BFD=0 (verified).
- **T9 MFA** — TOTP already enabled in Supabase Auth; Brendan enrolled — verified a `verified` totp factor for `brendan@`.
- **T10 phone-first inbound** — (a) `inbound_webhook_url` on +61481614530 SET + verified (→ retell-inbound-webhook); agent webhook untouched. (b) inbound "ask for details" prompt drop logged to the pending-prompt-changes list. Lookup confirmed: matches caller's `from_number` (caller ID); unknown/withheld → fallback.
- **T13 probe** — `PROBE_CLIENT_ID` / `PROBE_INTAKE_SECRET` / `PROBE_TEST_PHONE` SET in Trigger prod via API + verified; past the env gate (but see blocker below).

## Skipped / deferred (Brendan-decided)

- **T11 webhook secrets** — Option A: leave secrets NULL. Blocked by a verify-scheme bug (below).
- **T12 AU SMS A2P** — skipped; clarified live SMS account = `…3ae4fa` (DB), number +61481614530 (not the `.env` `…b57a16` account). Bundle/number-acquisition logged for later.
- **T14 Supabase Pro / HIBP** — skipped; logged to enable HIBP on Pro upgrade.

## PENDING — resume here

- **T15 — apply the 5 voice rewrites** (`Docs/VOICE_AGENT_PROMPT_REWRITES_2026-06-14.md`): Main Outbound (slot 1) first, then Garys slots 4-7. Fixes the phantom `get_contact` booking bug; Main Outbound also gets the latency/cost fix. Main Outbound's PASS=false is a verified FALSE POSITIVE (auto-block at push; don't re-add inbound guards; keep gemini-3.0-flash + high-priority). Fold in the T10b inbound "ask for details" drop in the same session. After pushing, Brendan sends call_id(s) → Claude verifies version-repoint + latency read-only.
- **Live run-through (T16/T17/T18 + inbound call test)** — consolidated in memory `project_live_test_runthrough`: pause/resume E2E; outbound repoint cadence `40e8bea3` → "Main Outbound" + live call (gates the column drop); CF pilot A/B (gates fleet rollout); inbound phone-first call test (+61481614530 from a known lead's phone).

## Next-build code items surfaced this session (logged in memory)

1. **compute-analytics**: surface `recording_url`/`public_log_url` so "Call Recordings & Transcripts" stops showing 0 CALLS (Brendan explicitly requested); fix "New User Messages" custom metric (builtinMetricNames collision). [`project_voice_analytics_total_voice_call_na_bug`]
2. **intake-lead is_system bypass** — probe can't go green: `intake-lead:286` 409s the probe client for no GHL creds. Add an is_system bypass mirroring B3 verify-only. [`project_probe_enable_status`]
3. **Webhook signature verify rewrite (BLOCKER for arming secrets)** — `verifyRetellSignature` uses `HMAC(body,secret)`+`sha256=` but Retell really sends `v={ts},d=HMAC(body+ts, API_KEY)`; storing the secret would 403 ALL Retell webhooks. Unipile suspect (likely static header). Fix verify code first; secret value = Retell API key. [`project_webhook_sig_verify_scheme_bug`]
4. **Probe ChatAnalytics hang** — probe direct URL → analytics/chatbot/dashboard stuck on RetroLoader (zero-config/zero-data client path) + a navigate('/client/:id') error-redirect loop. [`project_probe_chatanalytics_hang_bug`]
5. **Account access restructure (roadmap)** — My Account = client self-serve (admin-governed fields); admin-only Sub-Account Config under Manage Sub-Accounts per sub-account. [`project_account_access_restructure_idea`]

## For-later notes (logged)

- Twilio AU regulatory bundle + how BFD acquires client numbers (BYO-per-client recommended). [`project_twilio_au_number_acquisition_and_bundle`]
- Enable HIBP on Supabase Pro upgrade. [`project_deferred_hibp_on_pro_upgrade`]
- Pending prompt changes running list. [`project_pending_prompt_changes`]

## State

HEAD after this session's commits (Forgejo + GitHub `main`). Edge fn live: compute-analytics **v13**. Trigger prod: PROBE_* set. No live prompt edits (report-only honored).
