---
description: 2026-07-23 optional cleanup-tail session — dm_executions 400 fixed + 6 residual tests passed autonomously; short Brendan-gated tail remains before the First-Client Milestone.
---

# 2026-07-23 — Optional Cleanup Tail (handoff)

**Session shape:** started with a live agency browser session (magiclink + TOTP, one 2FA code from Brendan), then
ran autonomously after Brendan left. Model Opus 4.8 [1m], execute mode. Nothing here blocks the First-Client Milestone.

## Shipped
- **`dm_executions` 400 on ContactDetail — FIXED (`f840144`, pushed to `main`).** Live `dm_executions` has
  `setter_messages` but no `messages` column; two selects in `ContactConversationHistory.tsx` (162, 302) named
  `messages` → HTTP 400 on every ContactDetail open. Dropped `messages` from both selects (+ line 193 cast
  `(row as any).messages`); both consumers already coerce a missing value to `[]`, so runtime-safe; `setter_messages`
  kept. Verified: npm test green (462), targeted tsc added no new errors, and the deployed-bundle render smoke went
  from **3× `dm_executions` 400 → 0 bad responses + 0 console errors**. Last cosmetic 400 on the page is now gone.

## Passed (autonomous, DB/edge-verified, all fixtures cleaned up) → COMPLETED_LOG 2026-07-23
- **F9V2-1/2** drift flag + tile badge + clear (Property Coach locked → `poll-retell-drift` flagged v19>v13 +
  `error_logs` row → RETELL-LOCKED/DRIFTED·PULL chips → unlock cleared it; original state restored).
- **F15 funnel** (`bookings-webhook` `showed`→attended + `booking_status_events`; `get-show-rate-funnel` held 0→1,
  show_rate null→1 under agency JWT).
- **F15 report** (`weekly-client-report` generated; `usage:false` toggle honored; `get-weekly-report` returns html).
- **PURGE-TAG-1** (live `ghl-tag-webhook` v14: `1prompt-try-gary-*` and `bfd-try-gary-*` derive identical
  agent_style/source_type).
- **PURGE-SIM-1** (personas `bfd-simulation-*@gmail.com` + OpenRouter calls succeed with BFD attribution headers).
- **G3-6 residual** (AnalyticsV2 render clean; `get-openrouter-usage` + `analytics-v2-suggest-widgets` return 200).
- **G3-8(a)** (LeadReactivation render clean; execute path is server-side `invoke('execute-lead-webhook')`, browser
  only reads the masked `has_supabase_service_key` boolean — no browser secret).
- Render smokes: ClientSettings, ChatAnalytics dashboard, AnalyticsV2, LeadReactivation all render clean (authed,
  0 console errors, 0 ≥400) on the live vite bundle.

## Open / not run (all Brendan-gated, all belt-and-braces — nothing blocking)
- **BOOK-CONFIRM-HONESTY-1** — needs a throwaway SMS-wired client or a supervised break of live booking to force a
  `book-appointments` failure. Mechanism already evidenced live (RESCHED-SMS-1).
- **B2-REPOINT-1** — needs a SAFE non-CRM number (the engine sends a real Twilio reply). TEST_PHONE_A is a known CRM
  lead + Brendan-gated to free; TEST_PHONE_B is ask-first. By-phone convergence already verified previously.
- **F8** edit/persist + client rate-card, **F13** margin one-liner content + client toggle matrix — render verified;
  the behavioral / second-role legs need a short live UI pass.
- **F16b/c/d, B-5** — the "Needs Brendan live" phone rows (unchanged).

## Findings worth carrying
- **n8n simulation_webhook returned 500** (the simulator's setter-reply leg). **FIXED 2026-07-24 (`4518408`)** by
  repointing the simulator to the native `process-setter-reply` engine rather than repairing a service M3 deletes.
  The simulator now has no n8n dependency, so the M3 Railway shutdown is fully unblocked. See the 2026-07-24
  entry in `COMPLETED_LOG.md`.
- **PURGE-TAG-1 nuance:** BFD's real new-leads workflows use per-style `bfd_setter-try_gary-*` tags, so the
  tag-suffix agent_style derivation is the legacy landing-page scheme (retained for backwards-compat). Both prefixes
  work when used.
- **Login gotcha (unchanged):** access is non-persistent; the harness saved `storageState` to the session scratchpad
  and reused it all session (re-saving after each browser run to survive Supabase's single-use refresh-token rotation).

## Next
`Docs/NEXT_SESSION_PROMPT.md` holds the short Brendan-gated residual tail. The only thing between here and v1 100%
is the event-gated **First-Client Milestone** (`Docs/FIRST_CLIENT_MILESTONE.md`) — do NOT run before a contract signs.
