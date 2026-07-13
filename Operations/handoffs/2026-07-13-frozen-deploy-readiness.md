---
description: Same-session continuation after GATE A — deployed the frozen voice-booking bundle (v53/v25/v28) with 0 agents mutated + a passing SMS booking regression, and assessed the Phase 3 readiness slice (llm_model already live, HIBP Pro-gated). Records what's held for Brendan (live voice, PU-14/PU-6, Resend, GHL workflow, 2FA for the agency smoke).
---

# 2026-07-13 — Phase 2 (frozen deploy) + Phase 3 (readiness slice), autonomous

Continuation of the pre-first-client hardening session (GATE A handoff: `2026-07-13-gate-a-rls.md`). Brendan said
"do all you can without me… before test voice calls; do SMS autonomously," so the frozen deploy + SMS booking +
Phase 3 autonomous bits ran unattended; live voice + UI prompt edits + Resend/GHL are held for him.

## PHASE 2 — frozen voice-booking bundle: DEPLOYED + verified
Deployed `frozen/voice-booking-bundle` (`b710eab`) onto main (`212ea77`), cherry-picking ONLY the 5 frozen files
(the branch predated GATE A, so a full cherry-pick would have reverted it — verified each file's main-vs-frozen
diff was frozen-changes-only first).
- **retell-proxy v52→v53** (SLOT-MAP-1 slot-1-push guard + PII redact), **voice-booking-tools v24→v25**
  (F24 deriveAppointmentId + hoisted endCadenceOnBooking; BOOK-ABORT-GHOST-1 findExistingAppointment idempotency
  + retry + SMS fallback), **retell-call-analysis-webhook v27→v28** (BOOK-VOICE-FABRICATE-1 telemetry + PII).
- **Verified read-only:** all 3 ACTIVE; **0 of 6 live Retell agents mutated** (before/after snapshot); SLOT-MAP-1
  guard present in deployed source (retell-proxy:754); voice-booking-tools typecheck clean + bookingHelpers tests
  11/0. The 19/20 retell-proxy/analysis-webhook deno warnings are the pre-existing type-only ones (deploy is
  esbuild --no-check).
- **Live SMS booking regression PASSED:** a clean single-message booking drove get-available-slots (v25, real
  future slots) → book-appointments (v25) → GHL appt `CRIRXl39HZ8aypnLbFyY` ("Strategy Call", Tue 14 Jul 10am
  Sydney) + `bookings` row `d543f263` source=sms confirmed + Meet link. Test appt then CANCELLED
  (`cancel_appt.mjs`, GHL 200, booking row mirrored). Committed + pushed origin+github.
- **Observation (for PU-14):** a FIRST attempt with two rapid messages got debounce-batched into one turn; the SMS
  setter then offered a stale same-day 8am slot (the tool had correctly returned 12:30pm+ for today) and said
  "snapped up" WITHOUT calling book-appointments. Artifact of the artificial batching, but it reinforces PU-14
  (gate the "booked" claim on an actual book-appointments call). The clean single-message path books correctly.
- **OWED (Brendan):** one live answered-VOICE booking (F24 cadence-ends, no ghost); a live slot-1 Save&Push refuse
  (belt-and-braces); apply PU-14 (booking tool-call gate) + PU-6 (recording disclosure on Main Outbound) in the UI.

## PHASE 3 — readiness slice (autonomous parts)
- **Canonical text `llm_model`: DONE (already live).** DB default = `google/gemini-2.5-flash` (migration
  `20260709120000` applied 2026-07-09 + committed `a7d59bf`); `onboard-client.mjs` default aligned. No action.
- **HIBP: Pro-gated → stays deferred.** Org "Building Flow Digital" is on the **free** plan (Mgmt API). Password
  min-length already **12**, MFA **on**, **signups disabled** (confirms the GATE-A default-role note is benign).
  Flip `password_hibp_enabled` when Supabase Pro lands.
- **Held for Brendan:** Resend SMTP (create the free account + verify buildingflowdigital.com DKIM/SPF + API key →
  I PATCH Supabase Auth SMTP + set RESEND_API_KEY on Trigger prod → run the F14 invite/reset E2E + flip F15 email);
  the reusable GHL reminder-workflow snapshot (config, not code).

## Ready + waiting on a 2FA code
Headless auth harness is built + `playwright-core` installed: `scratchpad/auth.mjs <code>` (magiclink → TOTP →
storageState) + `scratchpad/agency_smoke.mjs` (navigates dashboard / credentials / leads / account-settings on the
DEPLOYED build + checks the SystemTicker OPENROUTER_BALANCE renders for agency). One fresh code runs the GATE-A
agency-UI smoke (confirms the app renders correctly against the new `clients_public` **security_definer** view) and
seeds a durable session (~17h) for the Phase 4 browser legs.

## Next
Phase 4 remaining TEST pass — harness/SMS/data legs autonomously (INTAKE-RL-1 burst-429, SMS STOP, B2-REPOINT-1,
BOOK-TZ-DISPLAY cross-tz, SEC-PII log spot-check, etc.); phone/voice/SMS-STOP legs + the held Phase 2 voice/PU
items with Brendan. Then only the event-gated First-Client Milestone remains.
