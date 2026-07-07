---
description: Session P3 close-out (2026-07-07) - full security/quality review since 4a22b8b (surface sound; findings logged, none live-exploitable), dead-code + doc cleanup, verified F18-F20 research refresh (no material change), and a milestone pre-flight. Emits the gated First-Client Milestone prompt.
---

# Session P3 — review + cleanup + research (2026-07-07)

Plan-mode review/cleanup session (Opus 4.8). The deliberate polish gate between the P2 build and the
event-gated First-Client Milestone. Brendan chose to DEFER the one HIGH security finding's code fix to
the milestone (it needs the webhook secret the milestone arms), so this session is review + report +
cleanup with minimal code touch.

## 1. Security + quality review (first full pass since 2026-06-05)

Scope: everything since Session 9 (`4a22b8b` → `ab49283`, 39 commits, ~120 files, +9,586 / -1,786) —
F15, F16, F17-p1, the onboarding-gate cluster + shared-fn booking/cancel, PROMPT-AUTH-1, and the P2
build (`execution_cost_events`, F9 v2 drift poll, BOOK-TZ-1). Method: 3 parallel deep-read agents over
the diff clusters + direct line reads of the highest-risk surfaces + live-DB cross-checks. Full
artifact: **`Docs/SECURITY_REVIEW_2026-07-07.md`**.

**Verdict: the shipped surface is sound.** Auth spine verified (in-code JWT + ownership; `verify_jwt=false`
is intentional). No missing JWT verification, no IDOR (all tenant queries `client_id`-scoped), no
SQL/filter injection, no secret-value column in `clients_public`. All three P2 subsystems SAFE
(cost ledger RLS role-gated + best-effort + idempotent; drift poll per-client-key + Retell GET-only;
BOOK-TZ-1 validates every tz + booked time provably unchanged). F15 RLS, F17 disclosure, onboarding
gate, PROMPT-AUTH-1: clean.

**Findings (all logged; NONE exploitable on the current live setup — default-OFF features, 0 client-role users):**

| ID | Sev | Disposition |
|----|-----|-------------|
| F16C-SMS-1 | HIGH | F16(c) missed-call text-back forgeable-SMS vector (`retell-call-webhook:152-217`): with the feature on and `retell_webhook_secret` unset, a forged `call_ended` webhook texts an attacker-chosen number on the client's Twilio. **Brendan chose report-only + DEFER to the milestone** (the fix needs `retell_webhook_secret`, which step 6.6 arms). Logged to `BUG_LIST.md` with a full fix-spec + folded into `FIRST_CLIENT_MILESTONE.md` step 2 as a hard prerequisite. |
| QH-TZ-1 | MED | Unvalidated `cadence_quiet_hours.tz` throws → cadence self-DoS. Logged with a ~10-line fix-spec. |
| RLS-UISTATE-1 | LOW | `chat_starred`/`dismissed_error_alerts` FOR-ALL policies rely on "one agency per top-level client". No exposure today (1 agency / 2 BFD-internal clients / 0 client-role users). Milestone now verifies fresh-agency-per-client. |
| FUNNEL-SCAN-1 | LOW | `get-show-rate-funnel` scans up to ~100k bookings (perf, bounded). |
| ROLE-RESOLVE-1 | LOW | `get_user_role` `LIMIT 1` nondeterministic for a hypothetical multi-role user (pre-existing). |
| AU-holidays | LOW | Hard-coded 2026/2027 holiday list → `BRENDAN_TODO.md` annual refresh. |

Two fix-specs (F16C-SMS-1, QH-TZ-1) are captured verbatim in `Docs/SECURITY_REVIEW_2026-07-07.md` so
whoever implements them (the milestone / a next code session) has a ready recipe. No code was changed
for either this session.

## 2. Dead-code + doc hygiene

- **Removed** the dead `presentation_only_mode` redirect branch in `frontend/src/components/ClientLayout.tsx`
  (its route target `webinar-presentation-agent` was deleted in G3-8(b); a live check confirmed **0
  clients** have the flag). Also dropped the now-orphaned `Outlet` import, a stale comment, and the
  `presentation_only_mode` field from the `clients_public` select. `tsc --noEmit` clean + `vite build`
  green. Live smoke → `TEST_LIST.md` P3-CLEANUP-1 (Railway rebuilds on push).
- **Fixed doc drift** in `Docs/SESSION_PLAN.md` Standard Context Block: "read the PHONE-NUMBER binding"
  → "read `voice_setters.retell_agent_id` directly" (MAIN-OUTBOUND-SHARED-1 proved the phone binding
  unreliable; keeps every future emitted prompt correct). Also removed a stray em dash in that block.
- **No action (confirmed):** `clients.text_engine_webhook` column drop stays DEFERRED (still wired into
  `clients_public`; needs a coordinated view rebuild). The deleted poll-retell-drift EDGE fn left no
  orphan and no stale `BFD_RETELL_API_KEY` fallback — the Trigger task is the sole poller.

## 3. F18-F20 research refresh

A verified multi-axis rescan (competitors + AU compliance + each of F18/F19/F20, adversarially
verified): **NO material change in 3 days; all three remain build-ready.** Only in-window moves were
Retell Conductor (2026-07-05) and xAI Grok Voice Agent Builder beta (2026-07-06), both no-code
DIY-infra entrants, neither a managed-service competitor. Per-feature sharpening deltas + a dated
refresh note folded into `FEATURE_ROADMAP.md`; a new non-blocking watch (AU Privacy Act tranche-2,
~Dec 2026) added to `Docs/DEFERRED.md`.

## 4. First-Client Milestone pre-flight

Confirmed the `Docs/FIRST_CLIENT_MILESTONE.md` prerequisites are airtight and ADDED (surgical,
additive): the F16(c) fail-closed fix as a hard step alongside 6.6 (arm `retell_webhook_secret`); the
fresh-agency-per-client check (RLS-UISTATE-1) in the onboarding step; the ACMA Sender-ID-Register
exemption note; and the F16/F17-p1 "now BUILT + DEPLOYED" status. The embedded prompt is confirmed
accurate (not rewritten). **The milestone was NOT run — it is event-gated.**

## Deploy state
- **No** edge/trigger deploys, **no** migrations, **no** Retell writes, **no** prompt edits.
- One frontend code change (ClientLayout dead-branch removal) goes live on `git push github` (Railway).
- Everything else is docs/lists.

## Close-out
- 6 lists updated: `BUG_LIST.md` (5 new items), `BRENDAN_TODO.md` (AU-holidays), `DEFERRED.md`
  (Privacy Act watch), `FEATURE_ROADMAP.md` (research refresh + F18-F20 deltas), `TEST_LIST.md`
  (P3-CLEANUP-1), `FIRST_CLIENT_MILESTONE.md` (F16c prereq + fresh-agency + refreshed prereqs).
  `SESSION_PLAN.md` ticked P2 + P3 done. New artifact `Docs/SECURITY_REVIEW_2026-07-07.md`.
- Commits pushed to `origin` + `github`.

## Next — First-Client Milestone (GATED, event-driven)

The relay's next and final step is the First-Client Milestone. It is **event-gated: run it ONLY once a
client has actually signed** (it flips Stripe / subscription enforcement / live webhook secrets / AU
A2P). The prompt below is the one already in `Docs/FIRST_CLIENT_MILESTONE.md`, confirmed accurate this
session (now including the F16(c) fix + fresh-agency prerequisites). Trigger it by saying **"I'm
onboarding a client."**

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (flips live production gates — plan + review first).

BFD-setter - FIRST-CLIENT MILESTONE: production onboarding + go-live hardening.
Brendan drives the dashboards; Claude does the code/config/verification halves. This is event-gated - run ONLY
because a client has actually signed.

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh. Creds in
./.env. Live DB via Supabase Management API /database/query (NOT postgres MCP). NEVER edit prompt content.
retell-proxy + voice-booking-tools are frozen (Voice-gated). Verify read-only before claiming done. No em dashes.
Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, Docs/DEFERRED.md (first-paying-client cluster + gated items), Docs/TEST_SESSION.md
RUN 9 (the manual checklist - confirm M1 Resend + M2 Setter-1 migration are done), the onboarding SOP in
Company/knowledge, scripts/onboard-client.mjs, and the readiness dashboard. Also read Docs/SECURITY_REVIEW_2026-07-07.md
(the F16C-SMS-1 fix-spec you must apply before enabling F16(c)).

Scope (the DEFERRED first-client cluster + the research additions):
1. Stripe go-live: backfill subscription_status, then set ENFORCE_SUBSCRIPTION_GATE=true
   (_shared/assertActiveSubscription.ts is shipped dormant); prove a delinquent client is blocked and an active
   one is not.
2. Webhook signing secrets: provision the GHL/Retell/Unipile signing secrets; arm retell_webhook_secret (= the
   Retell API key; one controlled live call, revert to NULL on any 403). See DEFERRED 6.6. THEN apply the
   F16C-SMS-1 fail-closed fix (BUG_LIST / SECURITY_REVIEW_2026-07-07) before enabling F16(c) missed-call
   text-back: the auto-send must require a verified Retell signature.
3. AU SMS A2P / Messaging Service registration for +61481614530 (or confirm the regulatory bundle); confirm AU
   handset delivery is reliable. Note: plain Twilio numbers are exempt from the ACMA Sender ID Register (live
   1 July 2026); register an alpha sender ID only if the client wants branded SMS.
4. Onboard the client via scripts/onboard-client.mjs + the SOP: BYO Twilio creds, GHL location, calendars, setter
   provisioning, F8/F13 rate card + billing anchor day + client-visibility toggles. Confirm onboarding minted a
   FRESH agency for this client (RLS-UISTATE-1: shared-agency clients cross-read each other's UI-state).
5. GHL reminder-workflow snapshot: provision the confirm / 24h reminder+confirm-link / 2h / reschedule / status
   branch stack on the client's GHL location, and wire its appointment-status changes into the F15 show-rate funnel.
6. Compliance close-out: recording disclosure ON for the client (PU-6 applied), calling-hours enforcement confirmed
   (F17 phase 1), consent source/method/timestamp recorded for their lead flow; flip HIBP if Supabase Pro landed.
7. Readiness dashboard green + a full smoke of the CLIENT'S own flows (one voice booking, one SMS booking, one
   cadence step) BEFORE handover.
Close out per the Relay Protocol. After this session, v1 is LIVE + 100%. Emit the post-client queue prompt (F18 AI
confirmation call first, then F19 QA digest, F20 revenue attribution, F12 cost optimization) generated from
FEATURE_ROADMAP.md + SESSION_PLAN.md.

▶ PIPELINE (final step; live status in Docs/SESSION_PLAN.md):
[✓] P1  [✓] MAIN-OUTBOUND fix  [✓] P2  [✓] P3  [•] First-Client Milestone (here) -> v1 LIVE + 100%
Post-client queue (later, gated by real usage/data): F18 -> F19 -> F20 -> F12.
```
