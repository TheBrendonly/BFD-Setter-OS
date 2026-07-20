---
description: Single copy-paste kickoff prompt for the 2026-06-18 BFD-setter session. Ties together the 2026-06-17 full-live-run-through leftovers + the Create-New-Setter E2E verification + the P3a post-ship repoints/tests into ONE live session (Brendan drives UI clicks + live calls; Claude verifies read-only). Booking timezone root cause already fixed (eb53690 / voice-booking-tools v17) so booking is now a RE-TEST. Claude-side code fixes are a separate backlog at the bottom.
---

> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---

# BFD-Setter — Next Session Kickoff (2026-06-18)

Paste the block below into a fresh session. It is a LIVE verification session: Brendan does the UI
clicks + phone calls, Claude verifies read-only. Voice prompt CONTENT is report-only.

State at handoff: HEAD `eb53690` on main (both remotes), no unpushed commits. Deployed: retell-proxy
**v41**, make-retell-outbound-call **v23**, voice-booking-tools **v17**, push-contact-to-ghl **v9**,
Trigger `v20260616.3`. P3a shipped; booking timezone-offset bug fixed (eb53690). Full prior record:
`Operations/handoffs/2026-06-17-full-live-run-through.md`.

---

## COPY-PASTE PROMPT

```
BFD-setter live verification session (2026-06-18). FIRST read: Operations/handoffs/2026-06-17-full-live-run-through.md
+ Docs/NEXT_SESSION_KICKOFF_2026-06-18.md + memory project_p3a_retire_outbound_direction_columns_2026_06_17,
project_create_setter_skips_wizard_bug, project_voice_booking_and_callback_2026_06_16,
project_ghl_is_the_outbound_send_channel, feedback_no_internal_prompt_edits, feedback_verify_before_moving_on.

Creds in .env (BFD_RETELL_API_KEY/RETELL_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PAT); run node --env-file=.env.
Read-only verification via the Supabase Management API SQL runner (POST /v1/projects/bjgrgbgykvjrsuwwruoh/database/query,
Bearer $SUPABASE_PAT, SELECT only — the connected postgres MCP points at an unrelated railway DB, do NOT use it) +
Retell MCP get_call/get_agent/get_retell_llm. The .env RETELL_API_KEY is stale/401 for direct REST — use the Retell MCP.
I (Brendan) do all UI clicks + live calls; you verify read-only and report. NEVER edit voice prompt content (report-only).
Give me a go/no-go after each step; if any step fails, STOP, diagnose read-only, report, then continue.

Key IDs: BFD client e467dabc-57ee-416c-8831-83ecd9c7c925 | active cadence 40e8bea3 | draft cadence c206da3e |
Main Outbound voice_setter b09624b5-5169-495a-bedd-fb6d3004ab34 (agent_f45f4dd87a4072424f3c84b74c, llm_a73df8d…, the
8-tool golden reference) | "Voice Setter 8" / Main Outbound V2 = agent_088a9ed98d7e815b0382f0d579 |
inbound number +61481614530 | TEST_PHONE_A (mine, free use) +61405482446. The 8 tools = end_call + get-available-slots,
book-appointments, get-contact-appointments, update-appointment, cancel-appointments, send-sms, schedule-callback; every
booking-tool url ends in /functions/v1/voice-booking-tools; model gemini-3.0-flash; exactly one {{available_time_slots}}.

PRE-FLIGHT (you verify before we start):
0a. Confirm the live frontend (Railway) is on the latest main (HEAD eb53690) so it includes the Create-New-Setter fix
    (commit 1153545) and the VITE_SUPABASE_PROJECT_ID/PUBLISHABLE_KEY env fix from yesterday. If a redeploy is pending,
    tell me to redeploy first (new-setter E2E below depends on it).
0b. Confirm there are no unpushed commits and HEAD is eb53690 on both remotes.

SECTION A — P3a post-ship repoints + live tests (project_p3a_retire_outbound_direction_columns_2026_06_17):
NOTE: cadence 40e8bea3's "Voice-Setter-1" repoint is ALREADY DONE (verified 2026-06-17: both phone nodes = Main
Outbound b09624b5; nodes no longer contain "Voice-Setter-1") — just re-confirm, don't redo.
A1. Draft cadence c206da3e still contains "Voice-Setter-2". I'll repoint its Voice-Setter-2 node(s) to a UUID setter in
    the picker (do NOT activate). You verify: c206da3e nodes no longer contain "Voice-Setter-2".
A2. I fire an outbound on 40e8bea3 to TEST_PHONE_A. Expect: dials on Main Outbound (agent_f45f4dd…). You verify via
    Retell get_call (agent_id) + make-retell-outbound-call logs.
A3. I fire a Try-Gary persona campaign. Expect: dials the matching Gary agent via the UUID path. Verify same way.
A4. I open a Gary editor (slots 4-7) and click Save/Push. Expect: success, NO "agent shared across slots" / direction
    warning, agent + LLM persist. You confirm clients.retell_agent_id_4..7 unchanged.
A5. I place an inbound call to +61481614530. Expect: greets normally, reverse-maps to BFD (webhooks untouched in P3a).
    Verify via retell-call/inbound-webhook receipt + the call row. KEEP retell_webhook_secret NULL (see backlog 6.6).

SECTION B — Create-New-Setter E2E + Main Outbound V2 (project_create_setter_skips_wizard_bug). Golden ref = agent_f45f4dd.
B1. NEW-SETTER E2E: I click "Create New Setter" (voice) in the UI and give you the new agent_id. You verify read-only via
    Retell: get_agent -> response_engine.llm_id -> get_retell_llm. PASS = exactly 8 general_tools (the set above), every
    booking-tool url ends in /functions/v1/voice-booking-tools, model gemini-3.0-flash, exactly 1 {{available_time_slots}}
    in general_prompt. Then I hit Save once; you re-GET to confirm STILL 8 (durability). Then I run a booking test call;
    pull get_call and confirm get-available-slots + book-appointments fired + a bookings row was written.
B2. MAIN OUTBOUND V2 = agent_088a9ed98d7e815b0382f0d579 ("Voice Setter 8"), currently 3 tools. I toggle Booking Function
    ON + Save->Push; you re-verify get_retell_llm shows 8 tools (same set). Then I send a test-call call_id; pull get_call
    and report: token size sane, latency.llm.p50 < 1.2s, booking tool_calls fire, slot-unavailable / consent / callback
    branches behave.

SECTION C — Booking RE-TEST + run-through leftovers:
C1. BOOKING RE-TEST (the timezone-offset root cause was fixed in eb53690 / voice-booking-tools v17 — no voice booking had
    ever succeeded before it). On an outbound call (B1 or A2), I ask to book a REAL open day/time. Expect: book-appointments
    now SUCCEEDS (HTTP 201 / booked:true) and a bookings row + GHL appointment are created. You verify via get_call tool_calls
    + the bookings row + (read-only) GHL appointment. If it still fails, capture the exact GHL response read-only and classify.
    Separately confirm the v17 behavior: an unmatched/invented time returns the real available_slots inline (no doomed POST).
C2. Confirm callback row 522be766 stayed 'placed' (it fired 2026-06-17 ~10am) — just a sanity re-read.
C3. Report-only: if I want name-on-pickup, tell me the exact greeting-line edit to add {{first_name}} (I apply in the UI).

Also flag for me: push-contact-to-ghl is at v9 (deployed) and b91b6d0 is already pushed — confirm nothing else is owed.
End with a go/no-go scorecard per step + anything still mine to do + an updated handoff.
```

---

## What is already DONE (so the session doesn't redo it)
- Cadence `40e8bea3` Voice-Setter-1 repoint -> Main Outbound (done in the 2026-06-17 run-through; both phone nodes = `b09624b5`).
- Booking timezone-offset root cause fixed (`eb53690`, voice-booking-tools v17).
- Create-New-Setter fix merged to main (`1153545`) — pending live frontend deploy confirmation (pre-flight 0a).
- `b91b6d0` pushed; push-contact-to-ghl v9 deployed.
- VITE_SUPABASE_PROJECT_ID / PUBLISHABLE_KEY set in Railway + frontend redeployed (manual send works again).

## CLAUDE-SIDE CODE FIXES — separate build sessions (NOT tomorrow's live tests)
Tracked in `FEATURE_ROADMAP.md` §6.3-6.8:
- 6.3 Refactor 8 raw-`fetch` `VITE_SUPABASE_PROJECT_ID` call sites -> `supabase.functions.invoke` (durable fix for the manual-send class).
- 6.4 Lead field edits don't persist when cleared (GHL re-sync overwrites) — internal-pivot.
- 6.5 STOP + inbound lead-resolution internal/by-phone; drop GHL contact lookup; one internal lead per phone — internal-pivot.
- 6.6 Retell sig-verify 403s the inbound webhook when secret armed — fix/exempt before arming `retell_webhook_secret`.
- 6.7 Synthetic-probe canary race v2 (still ~2/24) — `trigger/syntheticProbe.ts`.
- 6.8 (report-only) greeting opener `{{first_name}}` on pickup if wanted.

## Deferred (not tomorrow): Supabase Pro/HIBP · email/Resend · Client #2 onboarding · pricing/Stripe · cadence-v2 activation · CF A/B (needs the CF agent built).
