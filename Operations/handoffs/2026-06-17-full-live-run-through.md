---
description: Full live run-through (2026-06-17) validating the Build-1 GHL->Twilio send-path migration + voice/versioning/probe fixes. 10 of 12 items PASS; booking-completion FAIL (prompt - agent invents slots for unavailable days; backend healthy) and probe still mostly red (canary race). 4 bugs found (1 fixed live). The GHL->Twilio migration is VALIDATED. P3a outbound-routing gate met.
---

# BFD-Setter Full Live Run-Through - Session Record (2026-06-17)

Brendan drove every live action; Claude verified read-only via the Supabase Management API SQL
endpoint (project `bjgrgbgykvjrsuwwruoh`), Retell MCP `get_call`/`list_calls`, and the live agent
config. Plan file: `~/.claude/plans/bfd-setter-full-live-run-through-glowing-sparkle.md`.

## Headline
- **The riskiest change is VALIDATED:** the GHL->Twilio outbound SMS migration works end-to-end -
  reply, follow-up, and manual send all deliver DIRECT via Twilio (`twilio_message_sid` stamped).
- **P3a is unblocked:** the UUID picker repoint of cadence `40e8bea3` onto "Main Outbound"
  (`b09624b5`) persisted and the live outbound dialed on the right agent (`agent_f45f4dd`).
- **Two real failures remain:** voice booking-completion (prompt, not backend) and the synthetic
  probe (canary race). Plus 4 bugs surfaced (1 fixed live).

## Reconciliation at closeout (parallel sessions advanced main)
By session end, other sessions had shipped past the state this run-through observed:
- **HEAD is `eb53690`** (not `ca04dab`). Deployed now: **retell-proxy v41, make-retell-outbound-call v23, voice-booking-tools v17, push-contact-to-ghl v9** (this run-through saw v39 / v15). All pushed to both remotes; `b91b6d0` is pushed.
- **The booking failure (item 9) is FIXED** by `eb53690` (voice-booking-tools v17): the real root cause was the voice model rebuilding the slot ISO string and **dropping the timezone offset**, so GHL rejected even wide-open slots as "no longer available" (no voice_call booking had ever succeeded). The fix books GHL's exact canonical free-slot string and returns the real slots inline on an unmatched time (the server-side guard this handoff proposed). My "agent invents slots" framing was the surface symptom; the offset-drop was the mechanism. **Action is now a booking RE-TEST, not a rebuild.** `Docs/BOOKING_SLOT_INVENTION_FIX_PROMPT_2026-06-17.md` is superseded except its optional prompt-hardening.
- **P3a shipped** (`ab254ad` + `1153545`); legacy outbound direction columns code-retired. **This run-through's item-9 repoint already completed P3a repoint step 1** — cadence `40e8bea3` no longer contains "Voice-Setter-1" (both phone nodes = Main Outbound `b09624b5`). Draft `c206da3e` still contains "Voice-Setter-2" (repoint pending).
- **Create-New-Setter wizard-skip bug is FIXED in main** (`1153545`): new setters now seed all 8 tools + `gemini-3.0-flash`. May not be on the live frontend until the next deploy — confirm before the new-setter E2E.

## Scorecard (run-through items)
| # | Item | Result |
|---|---|---|
| 3 | Reply via Twilio | PASS - 2 `sms_outbound` rows w/ `twilio_message_sid`; `dm_executions` completed |
| 4 | Follow-up via Twilio | PASS - `followup_timers` fired (Push Now), sent via Twilio |
| 5 | Manual send | PASS (after Railway env fix) - sends + persists; rate-limit OK (>10s gap); no-phone UI-gated |
| 6 | STOP toggle | PASS (mechanism + no 502s) - live "no reply" unprovable due to GHL multi-contact pollution (BUG C) |
| 7 | Arm Retell secret | Armed -> caused inbound 403 -> REVERTED to NULL (BUG D) |
| 8 | Inbound call | PASS (secret NULL) - greets by name, vars populate, right agent |
| 9 | Outbound repoint + dial | Repoint + routing PASS (P3a gate met); booking-completion FAIL (prompt - invents slots for unavailable days; backend HEALTHY) |
| 10 | Pause/resume E2E | PASS - paused=0 sends; resume=new `trigger_run_id`, no dup; quiet-hours gating confirmed |
| 11 | Cold-reply nudge | PASS (code-verified) - hourly cron + 9am-8pm lead-local-hour gate |
| 12 | UI smoke | PASS (all 6) - GHL fields gone + Save + inbound card; deleted-setter label; analytics; doc-page advanced/relabel; footer + quiz copy |
| 13 | Probe green | FAIL - 2/24 passed in 24h; canary race persists (Trigger start latency 45-82s) |
| 14 | Callback fired ~10am | PASS - `scheduled_callbacks` 522be766 status='placed', fired 00:00:52 UTC on Main Outbound |

## Bugs found
- **BUG A (FIXED live):** Railway frontend missing `VITE_SUPABASE_PROJECT_ID` + `VITE_SUPABASE_PUBLISHABLE_KEY`
  -> manual send fetched `https://undefined.supabase.co/...` ("Failed to fetch"). Also silently broke
  7 other raw-fetch features (Twilio numbers, Email inbox, Instagram DMs, parts of Credentials, demo
  chat). Brendan set both vars + redeployed -> fixed. Durable fix queued (see backlog).
- **BUG B:** Lead phone edit doesn't persist when cleared - the phone reappears after Save
  (`ContactDetail.tsx` `handleSaveContact` pushes to GHL via `push-contact-to-ghl`; GHL re-sync
  overwrites). Folds into the internal/standalone pivot - lead edits should be authoritative in BFD.
- **BUG C (Brendan's direction):** STOP and inbound lead-resolution should be INTERNAL and by-phone -
  STOP should stop ALL leads sharing a phone number; inbound should NOT call GHL
  `findOrCreateGhlContact` (it picks the first phone match -> non-deterministic across duplicate
  contacts). Pivot is to be standalone, not GHL-dependent. Also: when an unknown number texts in,
  create/match a single internal lead.
- **BUG D:** Arming `retell_webhook_secret` makes `retell-inbound-webhook` return 403
  (`verifyRetellSignature` rejects the inbound webhook) -> Retell gets no `dynamic_variables` -> agent
  speaks literal `{{first_name}}`. Confirmed by A/B (same number: armed -> placeholder; NULL -> real
  name). The inbound webhook is likely unsigned / signed differently than the post-call webhooks. DO
  NOT arm `retell_webhook_secret` until inbound signing is confirmed; exempt the inbound webhook from
  signature verification (or verify it correctly). Verify code: `_shared/verify-webhook.ts`.

## Booking-completion failure (the main functional gap)
Backend HEALTHY: `get-available-slots` returns real slots for available days (Thu/Mon/Tue), none for
Friday/weekend; `make-retell-outbound-call` pre-loads `{{available_time_slots}}` correctly (the
agent's FIRST offer in the call was a real Thursday slot). The failure: the lead asked for FRIDAY (0
slots), and the agent HALLUCINATED Friday times instead of declining; `book-appointments`
(`ignoreFreeSlotValidation:false`) correctly rejected each as "not available" -> infinite
"someone beat us to that slot" loop. Prompt/model-adherence issue, NOT an API bug. Fix prompt (both
the prompt-hardening Brendan applies + an optional server-side guard) is in
`Docs/BOOKING_SLOT_INVENTION_FIX_PROMPT_2026-06-17.md` - paste it into a focused fix session.

## Still Brendan's to do
- Apply the booking prompt-hardening via the UI (or run the booking fix-session prompt). Re-test booking after.
- **END the pause-test enrolment** (execution `80563572`, lead "Brendan Green" `28e5097d`) on the
  Engagement page so it doesn't auto-call ~9am tomorrow. (Left running at session end.)
- Decide on the durable raw-fetch refactor (backlog) and the BUG B/C/D fixes.
- (Optional report-only) Add `{{first_name}}` to the greeting opener if you want name-on-pickup.

## Backlog for next build sessions
1. Booking: harden the prompt + (optional) `voice-booking-tools` returns real free slots inline on `slot_unavailable`. (`Docs/BOOKING_SLOT_INVENTION_FIX_PROMPT_2026-06-17.md`)
2. Probe canary fix v2: poll the message_queue check on a longer deadline / wait for `status='completed'`, account for 50-80s Trigger start latency. (`trigger/syntheticProbe.ts`; memory `project_probe_enable_status`)
3. Internal/standalone pivot (BUG B + C): authoritative BFD lead edits + by-phone dedup + by-phone STOP + drop GHL `findOrCreateGhlContact` on inbound.
4. BUG D: exempt/repair Retell inbound-webhook signature verification before arming the secret.
5. Refactor the 8 raw-`fetch`-from-`VITE_SUPABASE_PROJECT_ID` call sites to `supabase.functions.invoke` so they share the known-good client config.

## State at session end
- Git: clean, HEAD `ca04dab` (docs) pushed to both remotes. This run-through doc + the booking-fix
  doc are uncommitted (commit when ready).
- DB writes made + reverted: `retell_webhook_secret` armed then reverted to NULL; all 8-9 test leads
  on `+61405482446` set `setter_stopped=true` then reverted to false. Net DB change from this
  session: none (except the cadence repoint Brendan made via UI, which is intended).
- Deployed versions unchanged: retell-proxy v39, voice-booking-tools v15, retell-call-analysis-webhook
  v22, Trigger v20260616.3.

## Gated round status
- **P3a (retire legacy outbound direction columns):** UNBLOCKED - the UUID outbound-routing gate
  passed. Still HIGH blast radius; plan first.
- **cadence-v2:** pause/resume + UUID migration proven; activate after a clean test-lead pass.
- **CF A/B pilot:** still needs Brendan to build the CF agent first.
