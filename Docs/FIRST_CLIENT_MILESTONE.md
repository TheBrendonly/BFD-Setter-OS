# BFD-Setter — FIRST-CLIENT MILESTONE (event-gated)

**Trigger:** when Brendan says **"I'm onboarding a client" / "onboarding a client" / "first client signed"**, read this
file and run the prompt below. **Do NOT run it before a contract actually signs** — it flips production gates (Stripe,
subscription enforcement, live webhook secrets, AU A2P) that should stay dormant until there is a real paying client.

This is the LAST step to v1 "100%". Everything before it (the test pass, Session S, F15, F16) is in
`Docs/TEST_SESSION.md` RUN 10. Full context on the gated cluster: `Docs/DEFERRED.md` (first-paying-client cluster) +
the onboarding SOP in `Company/knowledge`.

---

## The prompt

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
Company/knowledge, scripts/onboard-client.mjs, and the readiness dashboard.

Scope (the DEFERRED first-client cluster + the research additions):
1. Stripe go-live: backfill subscription_status, then set ENFORCE_SUBSCRIPTION_GATE=true
   (_shared/assertActiveSubscription.ts is shipped dormant); prove a delinquent client is blocked and an active
   one is not.
2. Webhook signing secrets: provision the GHL/Retell/Unipile signing secrets; arm retell_webhook_secret (= the
   Retell API key; one controlled live call, revert to NULL on any 403). See DEFERRED 6.6.
3. AU SMS A2P / Messaging Service registration for +61481614530 (or confirm the regulatory bundle); confirm AU
   handset delivery is reliable (the bare long code delivery was slow/unconfirmed).
4. Onboard the client via scripts/onboard-client.mjs + the SOP: BYO Twilio creds, GHL location, calendars, setter
   provisioning, F8/F13 rate card + billing anchor day + client-visibility toggles (see TEST_SESSION M4).
5. GHL reminder-workflow snapshot: provision the confirm / 24h reminder+confirm-link / 2h / reschedule / status
   branch stack on the client's GHL location (research verdict: orchestrate GHL, do not build a reminder engine),
   and wire its appointment-status changes into the F15 show-rate funnel.
6. Compliance close-out: recording disclosure ON for the client (PU-6 applied), calling-hours enforcement confirmed
   (F17 phase 1), consent source/method/timestamp recorded for their lead flow; flip HIBP if Supabase Pro landed.
7. Readiness dashboard green + a full smoke of the CLIENT'S own flows (one voice booking, one SMS booking, one
   cadence step) BEFORE handover.
Close out per the Relay Protocol. After this session, v1 is LIVE + 100%. Emit the post-client queue prompt (F18 AI
confirmation call first, then F19 QA digest, F20 revenue attribution, F12 cost optimization) generated from
FEATURE_ROADMAP.md + SESSION_PLAN.md.

▶ PIPELINE (final step; live status in Docs/SESSION_PLAN.md):
[✓] Test session   [✓] Session S   [✓] F15   [✓] F16   [•] First-Client Milestone (here) -> v1 LIVE + 100%
Post-client queue (later, gated by real usage/data): F18 -> F19 -> F20 -> F12.
```

---

## Prerequisites before running this (surface them if not yet done)

- **M1 Resend SMTP** and **M2 Setter-1 prompt migration** from `Docs/TEST_SESSION.md` RUN 9 should be done (invite
  emails + a clean stored prompt matter at onboarding).
- **F16 / F17 phase-1** (calling-hours enforcement + recording-disclosure toggle) should be built, since step 6 turns
  them on for the client. If F16 hasn't run yet, either run it first or flag the compliance controls as manual.
- The **GHL reminder-workflow snapshot** (BRENDAN_TODO) is best built once, ahead of time, and reused per client.
