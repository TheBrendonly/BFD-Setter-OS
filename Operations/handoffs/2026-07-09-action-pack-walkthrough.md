---
description: 2026-07-09 interactive action-pack walkthrough - applied the 2026-07-07 Brendan action pack (Part A prompt items + Part B manual gates tiers 1-4 incl. a Tier 3 onboarding practice dry run), Brendan driving the UI live, Claude guiding + verifying each step.
---

# Action-pack walkthrough — 2026-07-09 (executed the 2026-07-07 P1 action pack)

Interactive, paced session: Brendan clicked/typed/decided in real time; Claude stated each exact
location + change, waited for confirmation, verified read-only, and ticked the source docs as we went.
Ran the 2026-07-07 action pack (`Operations/handoffs/2026-07-07-brendan-action-pack.md`).

**Model:** started Sonnet, switched to Opus 4.8 [1m] partway. **MAIN-OUTBOUND-SHARED-1 was fixed by a
concurrent session mid-walkthrough** (Main Outbound restored to its own dedicated agent `agent_f45f4dd…`),
which un-blocked PU-3/PU-7.

## Part A — prompt-content items (all resolved)

- **PU-6** (recording disclosure) — APPLIED + VERIFIED LIVE. Added as DIRECT TEXT in Main Outbound's
  begin_message (compliance line = verbatim every call, matching Inbound). `agent_f45f4dd…`/LLM
  `llm_a73df8…` v24: *"…Just so you know, this call's recorded for quality…"*. Scope narrowed to Main
  Outbound only (Inbound already had it; the 4 Gary demo personas are out of compliance scope per Brendan —
  see memory `feedback_example_agents_scope`).
- **PU-12** (inbound placeholder guard) — APPLIED + VERIFIED LIVE. Inbound BFD Agent LLM `llm_9dd6af…` v14
  now carries the "never speak a placeholder/system value like 'SMS Lead'" line.
- **PU-10 + Setter-1 migration** (text setter) — APPLIED + VERIFIED LIVE. Brendan cleared the legacy
  ~511-line "# BOOKING FUNCTION" blob and pasted the lean `DEFAULT_BOOKING_PROMPT` + the PU-10
  reschedule/cancel honesty line. Verified via `get-external-prompt`: 68,750 → 53,720 chars, no
  "Available days"/`{{ $now }}`/legacy tool names, passes the save-external-prompt lint. Closes the
  BRENDAN_TODO Setter-1 migration + the stored-prompt half of the 2 residual PROMPT-AUTH-1 TEST_LIST checks.
- **PU-3 / PU-7** — auto-resolved by the MAIN-OUTBOUND-SHARED-1 restore (dedicated agent already personalizes
  with `{{first_name}}` + states company/purpose). No edit. → COMPLETED_LOG.
- **PU-11** (live-transfer) — DEFERRED by Brendan (prompt half of default-OFF F16(d)). Decision recorded:
  apply to BOTH Main Outbound + Inbound when he sets it up; the `transfer_call` tool doesn't exist on any
  agent yet.
- **PU-5** (Main Outbound V2) — DEFERRED (draft ready in `Docs/archive/MAIN_OUTBOUND_V2_PROMPT_2026-06-16.md`).
- **PU-9** (dead air) — RECLASSIFIED to a CODE item (`PU-9-CODE` in BUG_LIST): traced retell-proxy — the
  tool filler + `speak_after_execution` are code-managed (`BOOKING_TOOL_MESSAGES` @1790, Save&Push overwrites
  @809), so a dashboard edit doesn't stick. Durable fix = retell-proxy code, Voice-gated. (Concurrent session
  has since STAGED a fix — commit `5b5cd42`.)
- **T10b** — verify-only, no edit; live inbound-call check stays in TEST_LIST.

## Part B — manual gates

**Tier 1:** Setter-1 migration DONE (above). **Resend SMTP — DEFERRED to First-Client Milestone** (Brendan:
no use until a paying client login exists). Provider decided = **Resend**, cost **$0** free tier (3k/mo);
folded into `FIRST_CLIENT_MILESTONE.md` M1 as an early step. Confirmed live: Supabase Auth custom SMTP is
unset (`smtp_host/user/pass` all NULL).

**Tier 2:**
- 5-setter re-Save — CONFIRMED effectively done: Main Outbound (v24) + Inbound (v14) both carry the 3
  API-DEPR-2 system-presets; the 4 demo Garys don't but are out of scope.
- **F15/F16/F17 dogfood toggles** — set + verified in DB: `speed_to_lead_enabled=true`,
  `recording_disclosure_enabled=true`, F15 `show_funnel_to_client`/`show_report_to_client=true`.
  **`missed_call_textback_enabled` held OFF** (F16C-SMS-1 vector until `retell_webhook_secret` is armed —
  it briefly came on with the card, flagged, Brendan flipped it back). F15 report `recipient_email` empty
  (email waits on Resend).
- **GHL appointment-status workflow → bookings-webhook — BUILT + VERIFIED END-TO-END.** Brendan built it as
  several per-status automations (GHL exposed no status merge var, so status is hardcoded per automation),
  Custom Webhook POST + `x-wh-token` header. Claude drove a live test via the GHL API: flipped appointment
  `zjLTA9X9nTCwKf24ZWZ6` cancelled→confirmed→cancelled → BOTH automations fired → webhook auth passed →
  `bookings.status` updated each way → 2 `booking_status_events` rows logged (F15 funnel data). Appointment
  restored to original state. Per-client note: each real client's GHL location needs its own copy (→ milestone).

**Tier 3 — ONBOARDING PRACTICE DRY RUN** (Brendan chose this branch):
- **Full-flow walk via `onboard-client.mjs --dry-run`** (zero writes) — shows every INSERT/GHL/Twilio/Retell
  call + the REQUIRED-MANUAL checklist. Finding: the script leaves `ghl_webhook_secret` unset (TODO) whereas
  the UI CreateClient path auto-mints it — a divergence.
- **All 5 prior onboarding-gate fixes verified still holding on `main`** (read-only): ONBOARD-1
  (`use_native_text_engine:true` in all create paths), ONBOARD-2 (up-front external-Supabase guard, no orphan),
  GOLIVE-1 (`goLiveReady` needs the full checklist, not just a minted secret), ACCESS-1 (prompts/voice+text
  AgencyRoute-wrapped).
- **Residue finding + CLEANUP:** the `agencies` table held **13 orphan test-agency rows** (f8proof/f13proof/
  rls-test/zz.testdel/ZZ Onboard Client, all 0 clients + 0 profiles + 0 auth users). Root cause = the
  proof/test teardown scripts delete the client+user+profile but leave the top-level `agencies` row. **Purged
  all 13** (defensive guard: non-BFD AND 0 clients AND 0 profiles); verified only the real BFD agency remains.
  Follow-up: fix those test scripts' teardown to also delete the agency row.
- **Canonical text `llm_model` DECIDED (for real, not a dry-run item): `google/gemini-2.5-flash`** (what the
  live dogfood runs, proven SMS tool-calling). Was 4 inconsistent values. ALIGNED: DB default changed
  (migration `20260709120000_…`) + `onboard-client.mjs` default. New clients now inherit the proven model
  instead of silently getting `gemini-2.5-pro`. (Voice = separate Retell-native `gemini-3.0-flash`, untouched.)
- Brendan chose PURGE-only (not live-mint), so no throwaway client was stood up — the `--dry-run` + read-only
  verification covered it without cleanup risk.

**Tier 4:** sms_llm rate — Brendan tuned it (Claude's grounded rec: real gemini-2.5-flash cost ≈ $0.004/msg
single-call to ≈ $0.009/msg for a booking-tool turn, so the $0.003 seed was low). Billing anchor/toggles —
done. **Screenshot folder name = "BFD Setter"** (decided). **n8n Railway — WON'T shut down** (Brendan keeps
it for other things). Both fold into the new BRANDING PURGE task.

## New findings / logged for later

- **GETCALL-1** (Low, code) — retell-proxy `get-call` hits the unversioned endpoint → 404s the call-detail
  UI. Confirmed live (unversioned 404 / v2 200). Concurrent session STAGED the fix (`5b5cd42`, not deployed).
- **PU-9-CODE** (Low, code, Voice-gated) — dead-air fix is code, not a dashboard edit. Staged (`5b5cd42`).
- **BRANDING PURGE** (BRENDAN_TODO) — remove all 1Prompt/n8n refs from the product. Mapped: ~12 LIVE edge fns
  (care), ~10 UI files (branding), 17 IMMUTABLE migrations (leave), 14 public JSON exports (decide), business
  strings in SetupGuideDialog (`support@1prompt.com`, `app.1prompt.com`, skool link — Brendan decisions), and
  the Railway prod service literally named `1prompt-os` (coordinate). NOT a blind find/replace — scoped as a
  careful dedicated pass (likely its own session). The obsolete SetupGuideDialog n8n-import flow is the biggest
  chunk (rework, not rename).

## What a real first client still needs (external, can't be pre-provisioned autonomously)

External Supabase project + 5-table seed SQL (#1 blocker; both text + voice authoring 400 without it) ·
GHL location + Private Integration Token (everything lead-side is GHL-gated; intake-lead 409s) · Twilio BYO
(SID/token/E.164, unique number, imported into Retell; not UI-editable) · flip subscription_status=active ·
the GHL reminder-workflow snapshot. All captured in `FIRST_CLIENT_MILESTONE.md`.

## Memory written this session

`feedback_example_agents_scope` (only Main Outbound + Inbound need compliance-grade prompts) ·
`reference_retell_mcp_endpoint_audit_2026_07_07` (the global `@jesec/retellai-mcp-server` uses deprecated
LIST endpoints, list_agents sunsets 07/31/2026; get_agent/get_retell_llm are fine) · updated
`feedback_no_internal_prompt_edits` with the 2026-07-07 narrow carve-out (Claude MAY do single-line prompt
edits via Playwright-through-the-UI, with per-edit permission).

## Standing preference update (from this session)

Brendan will now allow Claude to make **single-line** prompt edits itself, **asking permission each time**,
**via Playwright through the BFD setter UI** (so the canonical UI save sticks). LARGE/multi-line edits stay
Brendan-manual. (Not exercised this session — he did the edits himself while in the editor.)

## Next session

Not blocked on anything code-side. Candidates: (1) the **BRANDING PURGE** dedicated pass (after Brendan makes
the support-email/domain/skool + Railway-rename decisions); (2) deploy the STAGED GETCALL-1 + PU-9-CODE
retell-proxy bundle (`5b5cd42`, Voice-gated); (3) the live TEST pass (say "run test session"); (4) the gated
**First-Client Milestone** (say "I'm onboarding a client"). Resume prompt below.

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com.
To know which agent serves a setter, read voice_setters.retell_agent_id directly (MAIN-OUTBOUND-SHARED-1 is
FIXED - Main Outbound = agent_f45f4dd…, dedicated again). NEVER write voice prompt content yourself EXCEPT a
single-line add/removal via Playwright-through-the-UI with per-edit permission (see feedback_no_internal_prompt_edits).
No em dashes. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, this handoff (2026-07-09-action-pack-walkthrough.md), Docs/BUG_LIST.md,
Docs/BRENDAN_TODO.md (the new BRANDING PURGE task), and the 2026-07-08 overnight handoff.

Pick ONE and confirm scope before starting:
(A) BRANDING PURGE - remove all 1Prompt/n8n refs from the bfd-setter product. First get Brendan's decisions
    (support@1prompt.com →?, app.1prompt.com →?, skool link →?, Railway 1prompt-os rename?). Then per-category:
    UI branding strings (safe), live edge fns (read each first, deploy + Voice smoke), leave immutable migrations
    + public JSON exports (decide keep-vs-delete). Fold in the obsolete SetupGuideDialog n8n-import flow (rework)
    + the "BFD Setter" folder-name re-shoot. tsc + build + edge tests after. Plan mode ON.
(B) Deploy the STAGED GETCALL-1 + PU-9-CODE retell-proxy bundle (commit 5b5cd42, v50→v51, Voice-gated):
    read-only Voice smoke, deploy, confirm get-call/{id} 200 + the longer booking-tool filler on a canonical agent.
(C) "run test session" → Docs/TEST_SESSION.md.  (D) "I'm onboarding a client" → Docs/FIRST_CLIENT_MILESTONE.md.
```
