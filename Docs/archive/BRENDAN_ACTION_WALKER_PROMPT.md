---
description: Durable "walk me through my tasks one at a time" prompt for Brendan after the 2026-06-15 build. Paste the PROMPT block into a Claude Code session; the agent then presents each action item in order with exact steps and waits for confirmation. Self-contained task list embedded so it survives handoff-doc churn.
---

> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---

# Brendan Action Walker

Paste the block below into a Claude Code session at `/srv/bfd/Projects/bfd-setter`. It makes the agent hand you your outstanding actions one at a time, in order, with exact steps, waiting for you between each.

The canonical task list is embedded in this file (Section: TASK LIST) so it does not depend on handoff docs that get regenerated.

---

## PROMPT (copy from here)

```
You are my action coach for the BFD-setter project. Work through MY outstanding tasks from the 2026-06-15 comprehensive build, one at a time, in order.

Source of truth, in priority order:
1. The "TASK LIST" section of Docs/BRENDAN_ACTION_WALKER_PROMPT.md (embedded, durable).
2. Operations/handoffs/2026-06-15-comprehensive-build.md (fuller context, may be regenerated).
3. memory project_comprehensive_build_2026_06_15 + MEMORY.md.

How to run this:
- First, read the TASK LIST section and reconcile it against the live system: for each task, before you present it, confirm the exact current UI location / file / command by reading the code or querying live (Management API for Supabase, read-only Retell), so the steps you give me are accurate, not guessed. If something is already done (e.g. you can see it in the DB/UI), say so and skip it.
- Then present tasks ONE AT A TIME, in the listed order. For each: a one-line WHY, the EXACT steps (where to click / what to run / what value to use), and how I VERIFY it worked. Then STOP and wait for me to say "done", "next", "skip", or ask a question.
- Track progress in a TodoWrite list. After I confirm a task, mark it done and present the next.
- Some tasks hand a value back to you (e.g. webhook secrets, call_ids). When I give you one, do your part immediately (store the secret + verify, or run the read-only verification) before moving on.
- You may APPLY the one-liner tasks marked "(Claude can do)" yourself via the Management API if I say go.
- Hard rule: never edit voice agent prompt content yourself (Retell or repo prompt files). For prompt steps, give me the exact change to make; I apply it.

Start by giving me a numbered overview of all tasks (titles only, grouped), then begin task 1.
```

## (end of prompt)

---

## TASK LIST (canonical, embedded)

Ordered: quick verification first, then config/provisioning, then voice, then the three live tests that unblock Claude's next build.

### GROUP A — Quick UI smoke (~10 min, confirms the build shipped clean)

1. **Sidebar labels.** Open the app, check the bottom SYSTEM section reads **"Sub-Account Config"** and **"My Account"** (was "Sub-Account Settings" / "Account Settings"). "Manage Sub-Accounts" unchanged.
2. **Probe hidden.** The agency client list / switcher must NOT show "Synthetic Probe". Confirm BFD is still there. (The probe is still reachable by direct URL on purpose.)
3. **Pause/Resume buttons.** Engagement page, open a running execution (right detail panel): you should see **PAUSE** next to END NOW / PUSH NOW. A paused one shows **RESUME + END NOW**.
4. **Voice analytics.** ChatAnalytics, switch to **Voice**, pick a date range that includes recent calls: metrics should render (the old "Total Voice Call = N/A" should be gone).
5. **Cost ceiling.** Sub-Account Config: there are **Weekly / Monthly cost ceiling ($)** inputs + a rolling-spend line. Enter a value, Save, reload, confirm it persists.
6. **Convert to Conversation Flow.** Open a voice setter's doc page (agency view): a **"Convert to Conversation Flow"** button is present on the single-prompt view. (Do not click it yet unless doing the CF pilot, Group E.)
7. **MFA card.** My Account: a **Two-Factor Authentication** card with "Enable 2FA". (Enrolling is Group C.)

### GROUP B — One-liner (Claude can do)

8. **Landing order:** set `clients.sort_order` so BFD = 0 and the probe = 100, so the agency lands on BFD. (Claude can do this via the Management API on your go, or you run the SQL.)

### GROUP C — Provisioning / config (so shipped features actually run)

9. **Confirm TOTP enabled** in Supabase Auth settings (Dashboard, Authentication, MFA, TOTP on). Then My Account, Enable 2FA, scan with an authenticator app, enter the code. Recovery: if you ever lock out, remove the factor in the Supabase dashboard.
10. **Phone-first inbound wiring (2 parts):**
    a. In Retell, set each BYO phone number's **inbound webhook URL** to `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/retell-inbound-webhook`.
    b. Apply the inbound prompt change (drop the "ask for their details" branch, since details now load on inbound). Prompt change is yours; Claude reports the exact wording on request.
11. **Retell + Unipile webhook secrets.** Provide the signing secret values to Claude; Claude stores `clients.retell_webhook_secret` / `unipile_webhook_secret` and verifies the live call path still works (no 403 surprise). GHL is already done.
12. **AU SMS A2P.** Register a Messaging Service / A2P for `+61481614530`; confirm which number real leads text from (you have 2 Twilio accounts on file).
13. **Probe enable.** Once you are happy with verify-only, set `PROBE_CLIENT_ID` (`b0e4f199-3fa5-4c8d-851b-6167ff46ad91`), `PROBE_INTAKE_SECRET` (the probe client's `intake_lead_secret`), `PROBE_TEST_PHONE` in Trigger prod (`proj_fdozaybvhgxnzopabtse`, env prod) and enable. Kills the ~$30/mo wasted hourly probe SMS.
14. **(Optional) Supabase Pro** upgrade, then tell Claude to flip on HIBP leaked-password protection.

### GROUP D — Voice prompts (your domain, report-only from Claude)

15. **Apply the 5 voice rewrites** (`Docs/VOICE_AGENT_PROMPT_REWRITES_2026-06-14.md`) via the BFD setter UI: Main Outbound (slot 1) first, then the 4 Garys (slots 4-7). These also fix the live phantom `get_contact` booking bug. After pushing, send Claude the call_id(s); Claude verifies the inbound + outbound version repoint and latency read-only.

### GROUP E — Live tests that unblock Claude's next build (the three gates)

16. **Pause/resume E2E.** Enrol a test lead to TEST_PHONE_A in a multi-step cadence with an early delay. While in the delay, click **PAUSE**: confirm no further sends and the Trigger run is cancelled. Click **RESUME**: confirm it continues from the same place, gets a new run id, and does NOT resend the earlier step. Repeat once, pausing during a phone-call step. Report pass/fail to Claude.
17. **Outbound repoint + live call (gates the column drop).** In the cadence "New-Lead Cadence from Form-Fill" (workflow `40e8bea3`), open the phone-call node, and in the voice-setter picker select **"Main Outbound"** (the UUID-backed option). Save. Then fire a live outbound to TEST_PHONE_A and confirm it dials on the right agent. Tell Claude when verified; Claude then retires the legacy outbound columns.
18. **CF pilot (gates fleet rollout).** On Voice-Setter-Test: click **Convert to Conversation Flow**, Push to Retell (creates the flow + agent), then build the node graph in the Retell dashboard using `Docs/CONVERSATION_FLOW_PILOT_DECOMPOSITION_2026-06-15.md`. Run an A/B vs the current single-prompt agent. Gate to pass: booking rate >= control, no `llm_token_surcharge` line on the call, llm p50 < 900ms. Report results to Claude.
```
