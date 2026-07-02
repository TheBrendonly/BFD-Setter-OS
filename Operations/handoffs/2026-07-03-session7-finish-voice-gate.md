---
description: Session 7-finish IN PROGRESS. The voice-regression gate PASSED (retell-proxy v47 SAFE, no rollback) with booking + B-3 + B-5 all live-confirmed; VM-1 FAILED the gate and is re-opened (v47 fix insufficient, needs draft-first + static_text). Preconditions A1/A2/A3 done. The rest of the consolidated live-test matrix plus the F13/F14 checks are deferred to the next session; the combined continuation prompt is at the bottom.
---

# 2026-07-03 — Session 7-finish (part 1): voice-regression gate PASSED, rest deferred

**State:** `main @ 36e48e2` (Session 8.5 / F13 / F14 DEPLOYED LIVE). Nothing needs deploying. This was the
first sitting of the consolidated live TEST pass; Brendan drove, Claude verified read-only. We completed the
preconditions + the voice-regression gate, then stopped and are handing the remaining matrix to a fresh session.

## What we did

**Preconditions (Brendan UI):**
- **A1 — BOOK-1 anti-fabrication rule applied.** BFD's Text setter is the **old structured section builder**
  (SETTER CORE), not a free-text prompt page, and there is exactly **one** text setter (`Setter-1`; status bar
  `TEXT_SETTERS: 1`). No single prompt box, so the rule went into the most reliable verbatim-inject free-text
  field: **IDENTITY → Agent Mission** (`agent_mission`, injected near the top with "EVERYTHING you do should
  serve this mission"). This stacks on top of the already-deployed structural fix (prefetch + inject real slots
  + anti-fabrication guard in `processSetterReply.ts`).
- **A2 — 5 voice setters re-saved/pushed** (Main Outbound + the 4 Garys). Live Retell agents modified 03:40-03:43;
  confirms the B-3/B-5 default-vars net reached the agents.
- **A3 — "Gary - Property Coach 1" reverted** to "Gary - Property Coach" (confirmed live on the agent).

**Voice-regression GATE — PASSED (retell-proxy v47 confirmed SAFE, no rollback):**
- **Booking E2E PASS.** Outbound `call_d5625539` (Main Outbound agent `agent_b2f6495` v11, ~2.9 min, agent_hangup,
  sentiment Positive). The agent used **real availability** ("I don't have 11:00 open… I've got 10:30 or 11:30",
  no fabrication) and booked → `bookings` `4f7c76a0`, `source='voice_call'`, `status='confirmed'`, appt
  `2026-07-02 01:30 UTC` = **11:30 AM Thu Sydney**.
- **B-3 PASS** (ran on `agent_b2f6495` v11 = current published version; binding also shows
  `outbound_agents[].agent_version="latest_published"`).
- **B-5 PASS** (`first_name="Brendan"` populated; zero literal `{{first_name}}` in the transcript). The genuine
  unknown-number leg (inbound from a non-CRM number omits the name) is still owed.
- **F2c PASS** (`voice_setter_id=b09624b5` = Main Outbound; correct agent + from-number).
- **VM-1 FAILED → re-opened in `BUG_LIST.md`.** Save & push (`clients.voicemail_config` mode=`prompt`) still
  reports "partial"; read-only re-check of all 5 push-target agents shows `voicemail_option` unchanged
  (`hangup`) → landed on **0/5**. v47's deprecated-field fix was necessary but not sufficient. The body is valid
  (`type:"prompt"` is a correct Retell enum), so the blocker is the **raw `update-agent` PATCH with no
  `ensureEditableAgentDraft`** (published versions are immutable). Refined fix: route set-voicemail through
  draft→edit→publish→repoint like the other handlers, AND fix the latent `static` enum → **`static_text`**
  (`voicemail.ts:34`). Does NOT gate v47 (calling path all passed). Best folded into Session 9 or a fix-pass.

## Gotchas / findings for the next session
- **Agent mapping (read the live binding, not memory).** BFD "Main Outbound" setter → `agent_b2f6495` (the SAME
  Retell agent as the "Inbound BFD Agent"; it presents as "Gary"). The phone binding's default outbound agent
  `agent_f45f4dd` ("Voice-Setter-Test", v19) is an **orphan** not in the setter set; campaign outbound overrides
  the agent at push time, so a Main Outbound call correctly used `agent_b2f6495`. Brendan's "did main agent" =
  he ran the call from Main Outbound (it worked); there was no dead-agent problem.
- **Repo advanced mid-session.** An early `git log` read caught a stale `a93aa3d` (F8+7.5); the checkout is now
  `36e48e2` (Session 8.5 / F13 / F14). Any early-session doc reads were against the older tree.
- **DOC GAP:** the handoff `Operations/handoffs/2026-07-02-usage-billing-auth.md` referenced by TEST_LIST +
  SESSION_PLAN + the F13/F14 kickoff prompt was **never written**. The F13/F14 deploy record lives only in the
  SESSION_PLAN **Session 8.5** entry + memory `project_f13_f14_usage_billing_auth_built_2026_07_02`. Point the
  next session there (or create the missing handoff).

## Remaining test matrix (→ next session, batched)
1. **SMS exchange** (BOOK-1 tweak already applied) → BOOK-1 acceptance + 3.12 SMS booking (`bookings.source='sms'`
   + `stop_reason='booking_created'`) + SMS-OBS-1 (`tool_invocations` rows) + MODEL-1.
2. **Agency→client login pair** → F8 panel+card, F13 ×4 (margin panel vs SQL, client toggle matrix, dashboard
   summary card both roles, period browsing+anchor), INB-1/UI-1/F11. **F14 email E2Es stay GATED on Resend SMTP.**
3. **Fresh GHL contact from an UNKNOWN number** → F1 deep-link + B-5 inbound no-name + B-2 inbound-resolve. Run
   LAST, then free **TEST_PHONE_A (+61405482446)** via CRM cleanup (3 BFD leads: `nD7x3GyZKRW3zxnMHiew`,
   `YKJKtmzrHrHCnAuBtaxe`, `MWPMQuRyatfRINnXukzG` + the GHL contact; capture read-only, gated-confirm, delete).
4. **Grouped:** LIVE-D (B-2 CSV normalized_phone + GHL-outage degraded + repoint + deterministic pick +
   manual-send/429), LIVE-E (F3 pause/resume + F4 tz nudge), G3-6 Tier-3 (set `clients.supabase_table_name` first),
   F9-1, PHONE-CLEAR-1, G3-8a.

Claude write-actions authorized (test infra, revert after): `clients.timezone` (F4),
`clients.supabase_table_name` (G3-6), `clients.ghl_api_key` break/restore (B-2 outage), CRM cleanup of
`+61405482446` (gated confirm).

## NEXT SESSION prompt (paste into a fresh session)

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (browser UA, NOT postgres MCP). Live Retell via
api.retellai.com with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER
binding (list-phone-numbers weighted-list inbound_agents/outbound_agents; the singular *_agent_id fields are
deprecated/null), never trust old memory. NEVER edit voice prompts (report-only: report location + change,
Brendan applies in the BFD setter UI). Verify read-only before claiming done. Follow the Relay Protocol in
Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + Operations/handoffs/2026-07-03-session7-finish-voice-gate.md +
Docs/TEST_LIST.md + Docs/BUG_LIST.md + Docs/BRENDAN_TODO.md. (F13/F14 context: SESSION_PLAN Session 8.5
entry + memory project_f13_f14_usage_billing_auth_built_2026_07_02; the 2026-07-02-usage-billing-auth
handoff was never written.)

SESSION: Session 7-finish (CONTINUATION) = the consolidated live TEST pass (BRENDAN drives, Claude verifies
read-only). Everything through Session 8.5 (F13 usage/billing + F14 auth) is DEPLOYED (main 36e48e2).
NOTHING needs deploying first.

ALREADY DONE 2026-07-03 (do NOT repeat): preconditions A1 (BOOK-1 anti-fabrication rule added to Text setter
Setter-1 via IDENTITY -> Agent Mission), A2 (5 voice setters re-saved), A3 (Property Coach name reverted).
VOICE-REGRESSION GATE PASSED, retell-proxy v47 SAFE, no rollback: booking E2E + B-3 + B-5 + F2c all
live-confirmed (call_d5625539, booking 4f7c76a0). VM-1 FAILED the gate and is RE-OPENED in BUG_LIST (v47 fix
insufficient: the raw set-voicemail PATCH needs ensureEditableAgentDraft, plus a latent static -> static_text
enum bug); do NOT re-test VM-1 until it is fixed (Session 9 fold-in / fix-pass).

REMAINING TEST MATRIX (batch overlapping actions; verify read-only; look for more consolidation):
  - One SMS exchange to a test lead (BOOK-1 tweak already applied) -> BOOK-1 acceptance + 3.12 SMS booking
    (bookings.source='sms' + engagement ends stop_reason='booking_created') + SMS-OBS-1 (tool_invocations
    rows for the lead: prefetch get-available-slots then book-appointments) + MODEL-1 (engine answers, no 400).
  - One agency->client login pair -> F8 (Cost-to-Price panel edits persist + client card toggle shows only the
    blended $/min) + F13 (margin panel vs a Mgmt-API SQL hand-check; the 4 client visibility toggles one at a
    time; dashboard summary card for both roles; billing-anchor period browsing incl. anchor 31 clamp) +
    INB-1/UI-1/F11. F14 invite + client self-reset E2Es stay GATED on Resend SMTP -> SKIP unless Brendan
    confirms Resend/DNS is live.
  - One fresh GHL contact from an UNKNOWN (non-CRM) number -> F1 deep-link + B-5 inbound no-name + B-2
    inbound-resolve. Run these LAST, then clean the CRM to free TEST_PHONE_A (+61405482446): capture read-only
    first (3 BFD leads nD7x3GyZKRW3zxnMHiew / YKJKtmzrHrHCnAuBtaxe / MWPMQuRyatfRINnXukzG + the GHL contact),
    gated-confirm with Brendan, delete the BFD leads + disassociate the GHL contact, then use it as the unknown
    number. Optional: re-import it afterward to restore baseline.
  - Grouped checks: LIVE-D (B-2 CSV normalized_phone + GHL-outage degraded [Claude breaks/restores
    clients.ghl_api_key] + background repoint converges no-dup + deterministic pick + manual SMS send/429),
    LIVE-E (F3 pause/resume + F4 tz nudge [Claude sets/restores clients.timezone + triggers nudgeColdReply]),
    G3-6 Tier-3 analytics (Claude discovers BFD's external chat table + sets clients.supabase_table_name first),
    F9-1 (locked-setter rename refusal), PHONE-CLEAR-1, G3-8(a). Use a TEST-TRIAGE council if several fail.

CLAUDE WRITE-ACTIONS AUTHORIZED (test infra, revert after): clients.timezone (F4), clients.supabase_table_name
(G3-6), clients.ghl_api_key break/restore (B-2 outage), CRM cleanup of +61405482446 (gated confirm).

BRENDAN MANUAL (BRENDAN_TODO, non-blocking): 5.1 setup-guide screenshots; shut down the n8n Railway service;
tune B-4 field access.

DONE WHEN: TEST_LIST green / all fails logged. Then close out per the Relay Protocol (reconcile the 5 lists;
passes -> COMPLETED_LOG, new fails -> BUG_LIST; tick SESSION_PLAN; dated handoff; git add -A && commit && push
origin + github) and emit the Session 9 prompt (API-DEPR-1; optional fold-in of BOOK-2/3 + SMS-METER-1 + the
VM-1 draft-first + static_text fix, all supervised shared-fn / Voice-gated edits).

No em dashes; fenced; self-contained.
```
