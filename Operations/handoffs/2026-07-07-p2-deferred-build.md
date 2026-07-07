---
description: Session P2 close-out (2026-07-07) - deferred pull-forward build. Brendan greenlit 3 non-client-gated items (F9 v2 poll+alerts, BOOK-TZ-1 per-lead timezone, execution_cost_events ledger); all built with TDD, deployed, and verified. Emits the Session P3 prompt.
---

# Session P2 — deferred-feature pick + build (2026-07-07)

Plan-mode build session (Opus 4.8). Triage over `Docs/DEFERRED.md`, then build what Brendan greenlit.
Most of DEFERRED is hard-gated on a paying client / real usage data (no client has signed), so it stays
deferred. Brendan pulled forward the **three non-client-gated items**, each recommended-scope, built with
TDD + verify-before-completion. He declined the MAIN-OUTBOUND-SHARED-1 investigation and the HIBP flip.

## What shipped (all deployed)

### 1. `execution_cost_events` — per-execution cost ledger (the prereq for 2.6 / F8 v2 / 3.9 / 4.1)
- New table keyed by `engagement_executions.id`; agency-only ROLE-GATED RLS (raw cost reveals BFD margin —
  same `get_user_role()='agency'` trap as `client_pricing_config`; NO client-read policy).
  `UNIQUE(cost_kind, provider_ref)` makes every writer an idempotent upsert.
- Pure `buildCostEvent()` (edge + trigger twins) + 9 unit tests.
- Writers: **voice** = `retell-call-webhook` (v23) + `retell-call-analysis-webhook` (v27), real `call.cost`,
  `execution_id` bridged from the Retell dynamic var (NULL for inbound); **SMS** = `sendTwilioSmsAndStamp`,
  num_segments × seed rate, `is_estimated=true`, execution_id threaded from the 2 runEngagement cadence sends;
  **LLM** = `runEngagement` at execution end, real `ai_cost_cents`, one row/execution. All best-effort (a cost
  write never blocks the hot path).
- **No downstream consumer rewired** — it just accrues (deliberate; not gold-plating speculative infra).
- Verified: schema + constraints + RLS via SQL; idempotent upsert proven (same key → 1 row, cost updated).
  Live accrual through real calls/cadence → TEST_LIST COST-1..4.

### 2. F9 v2 — scheduled drift poll + booking-tools-lost alert (poll + alerts only; gap (c) deferred)
- Pure `computeDriftState()` (trigger `_shared/retellDrift.ts`, inlined booking-tool set) + 11 tests.
- `trigger/pollRetellDrift.ts` (hourly `schedules.task`): reads locked setters + **per-client** `retell_api_key`
  from the DB (like retell-proxy's `getRetellApiKey` — NO global Retell secret needed), reads live
  get-agent/get-retell-llm, computes drift. On FIRST detection stamps `voice_setters.retell_drift_detected_at`
  / `retell_booking_tools_lost_at` + writes an `error_logs` row (source `trigger.pollRetellDrift`) + optional
  Slack (`PROBE_ALERT_WEBHOOK_URL`); clears on resolve. Flag-transition throttling (no dup alerts).
- `retell-proxy` (v50): pull-retell-config + unlock clear both flags. PromptManagement tile badges read the
  persisted flags (drift chip works before the on-demand live check; red "Booking tools missing").
- **Architecture note:** the first cut was an edge function invoked by a thin trigger task, but the
  trigger→edge service-key auth was unverifiable locally (key-format mismatch). Since Retell keys live
  per-client in the DB (readable by any service-role client), the whole job moved INTO the Trigger.dev task —
  simpler, no cross-service auth, fully verifiable. The edge function was deleted.
- **Verified end-to-end** against a REAL drift: Property Coach's live agent is v17 vs BFD-synced v13. Locked it,
  ran the exact task logic (replica against live DB): flag + error_logs written → idempotent re-run (no dup) →
  simulated pull (synced=17) cleared the flag → restored the row (unlocked, v13, flags null, test logs deleted).
- **Gap (c) auto-hydrate-BFD-on-unlock: explicitly deferred** (manual Pull covers it; would need snapshot-expand
  + unlock-flow rewrite). Stays in DEFERRED for if Brendan wants hands-off editor hydration.

### 3. BOOK-TZ-1 — per-lead timezone (display only)
- `leads.timezone` (IANA) captured from the GHL contact: `buildLeadInsert` validates + stores it
  (`sync-ghl-contact` v28); `intake-lead` (v16) captures `body.timezone` only when valid (never nulls an
  existing value on upsert). Chosen source = **explicit GHL column, NOT area-code inference** (AU mobiles carry
  no geography; +61 8 spans WA/SA/NT).
- `leadTimezone.ts` helpers (edge + trigger twins, Intl-based, DST-aware) + 7 tests: `isValidTimeZone`,
  `resolveLeadDisplayTimeZone`, `zoneShortLabel`, `formatSlotInZone`.
- **VOICE** (`make-retell-outbound-call` v29): injects `{{lead_timezone}}` / `{{lead_timezone_label}}` /
  `{{business_timezone}}` / `{{business_timezone_label}}` dynamic vars — INERT until the prompt references them
  (same pattern as `recording_disclosure`). `{{available_time_slots}}` and the booked time are UNCHANGED.
- **TEXT** (`processSetterReply`): an ADDITIVE lead-timezone block (only when the lead is in a different valid
  zone) telling the setter to state both zones but book the business-tz time. Does NOT touch the frozen,
  byte-tested `buildAvailabilityBlock` / `TOOL_USAGE_INSTRUCTION` — the text X-Ray mirror stays green.
- **Booking is provably unaffected**: no change to `compactSlots` / `book-appointments` / `resolveCanonicalSlot`;
  the model still books the business-tz HH:MM it's offered. The critical no-leak property holds by construction.
- **Voice prompt wording is report-only** → `PROMPT_UPDATE_LIST.md` **PU-13** (references the new vars). The text
  half is code-owned and live now. Dormant until a lead carries a non-business GHL timezone (the gate).
- v2 refinement noted: precise PER-SLOT lead-tz rendering in the availability data needs the raw ISO before
  `compactSlots` strips it to HH:MM; today the text block relies on the model for simple offset conversion.

## Deploy state
- Edge fns: retell-call-webhook v23, retell-call-analysis-webhook v27, retell-proxy v50,
  make-retell-outbound-call v29, sync-ghl-contact v28, intake-lead v16. (poll-retell-drift edge fn was created
  then deleted — logic moved to the trigger task.)
- Migrations applied (Mgmt API): `20260707130000_execution_cost_events`, `20260707140000_f9v2_drift_flags`,
  `20260707150000_book_tz_1_leads_timezone`.
- Trigger.dev: **Version 20260707.1, 14 tasks** (includes new `poll-retell-drift`). The batched deploy also
  typechecked all trigger changes (F1 runEngagement/sendTwilioSmsAndStamp, F2, F3 processSetterReply).
- Frontend (PromptManagement badges): tsc clean; goes LIVE on `git push github` (Railway).

## For Brendan (small, low-priority)
- **PU-13** (report-only): apply the voice prompt line so the VOICE setter states both timezones — only matters
  once a real interstate lead exists. Full wording in `PROMPT_UPDATE_LIST.md`.
- **Optional:** set `PROBE_ALERT_WEBHOOK_URL` in the Trigger.dev prod env if you want a Slack/Discord PUSH on
  drift (the in-app `error_logs` alert + tile badge work without it).
- **Real live drift exists now:** Property Coach's Retell agent is v17 vs BFD-synced v13 — harmless (it's an
  unlocked demo persona), but if you ever lock it, the poll will (correctly) flag it until you Pull.

## Nothing touched that shouldn't be
No voice prompt content edited (PU-13 is report-only). First-Client Milestone items (Stripe / webhook secrets /
AU A2P) untouched. The pre-existing uncommitted `PROMPT_UPDATE_LIST.md` edit (a prior session's agent-scope
reminder + PU-6/PU-7 corrections) was committed alongside PU-13 with a note.

## Close-out
- 6 lists updated: `DEFERRED.md` (F9 v2 + BOOK-TZ-1 marked built; the 4 cost-gated items note the ledger prereq
  now exists), `TEST_LIST.md` (COST-1..4, F9V2-1/2, BOOKTZ-1), `COMPLETED_LOG.md` (P2 entry),
  `PROMPT_UPDATE_LIST.md` (PU-13). `ROADMAP.md` is history-only (a line added).
- Commits pushed to `origin` + `github`.

## Next — Session P3 (review + cleanup + research)

Emitted verbatim in chat and saved here. P3's scope is unchanged from the P1 handoff EXCEPT its
security/code-review pass now also covers this session's diff (the 3 P2 features), and the notes below.

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (touches security-review-driven fixes across many surfaces).

BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read voice_setters.retell_agent_id directly
— never trust the phone number's static binding or a remembered agent id. NEVER edit voice prompts (report-only).
Verify read-only before claiming done. No em dashes. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the 2026-07-07 P1 + P2 handoffs, Docs/SECURITY_REVIEW_2026-06-05.md.

BFD-setter - Session P3: review + cleanup + research (polish pass before the First-Client Milestone).

Scope:
1. Security/quality review pass. The last full security review was 2026-06-05 — a month-plus of rapid
   feature + bug-fix work has landed since (F8/F9/F13/F14/F15/F16/F17-p1, the onboarding-gate cluster, the
   shared-fn booking/cancel fixes, PROMPT-AUTH-1, AND the Session P2 build: execution_cost_events ledger +
   its 3 write sites, the F9 v2 drift poll, BOOK-TZ-1). Run /security-review + a /code-review high pass over
   everything shipped since 4a22b8b (Session 9), INCLUDING the P2 diff. Pay attention to: the new
   execution_cost_events RLS (agency role-gate correct? any client-role leak of raw cost?), the best-effort
   cost inserts (any hot-path regression / unhandled throw?), poll-retell-drift (reads per-client Retell keys
   with service role — any cross-tenant confusion? does it ever WRITE to Retell? it must not), and the
   BOOK-TZ-1 capture (does an invalid GHL timezone ever reach the column? does the text additive block ever
   change the BOOKED time?). Report findings; fix Critical/High directly (with tests), log Medium/Low to
   BUG_LIST.md if genuinely new.
2. Doc + dead-code hygiene. Known small items: the ClientLayout.tsx:618 dead presentation_only_mode redirect
   branch (confirm + remove if still dead); revisit whether the clients.text_engine_webhook column drop
   (DEFERRED.md) is worth doing now; a light pass over other "noted but out of scope" dead-code callouts
   (grep COMPLETED_LOG.md for "dead"/"orphan"/"unwired"). NEW from P2: confirm the deleted poll-retell-drift
   EDGE function left no orphan (the trigger task is the only drift poller); confirm the BFD_RETELL_API_KEY
   env fallback in the (now-removed) edge fn didn't leave a stale reference.
3. Refresh F18-F20 post-client research (AI confirmation call, call-QA digest, booked-revenue attribution),
   all "post-first-client fast-follow" in FEATURE_ROADMAP.md, based on 2026-07-04 market research. Light
   refresh: anything material changed? new competitor/compliance developments? — so they're build-ready the
   moment a client signs ("no visible ROI" is the #1 retainer-churn driver).
4. Confirm Docs/FIRST_CLIENT_MILESTONE.md's prerequisite checklist is airtight given everything shipped since
   it was last touched (2026-07-04) - do not run the milestone itself.

Close out per the Relay Protocol. Emit the First-Client Milestone prompt as the next step (it's already
written in Docs/FIRST_CLIENT_MILESTONE.md - confirm it's still accurate rather than rewriting it, and remind
Brendan it is event-gated: only run it once a client has actually signed).

▶ PIPELINE: [✓] P1 audit + action pack   [✓] P2 deferred build   [•] P3 review+cleanup+research   [ ] First-Client Milestone (GATED)
```
