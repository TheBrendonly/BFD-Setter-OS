# Security + Quality Review — 2026-07-07 (Session P3)

Scope: everything shipped since Session 9 (`4a22b8b`) → `ab49283` (39 commits, ~120 files,
+9,586 / -1,786). Platform project `bjgrgbgykvjrsuwwruoh`. Covers F15 (show-rate funnel + weekly
ROI report), F16 (never-miss-a-lead: speed-to-lead / missed-call text-back / live-transfer),
F17-p1 (recording disclosure + AU calling-hours clamp), the onboarding-gate cluster + shared-fn
booking/cancel (voice-booking-tools, webhook-manifest, sweep_1a/1b), PROMPT-AUTH-1, and the Session
P2 build (`execution_cost_events` ledger, F9 v2 drift poll, BOOK-TZ-1). This is the first full pass
since the 2026-06-05 review.

Method: three parallel deep-read agents over the diff clusters + direct line-by-line reads of the
highest-risk surfaces (`execution_cost_events` migration, `pollRetellDrift.ts`, the F16(c) branch,
`businessHours.ts`), cross-checked against the live DB via the Management API.

## Architecture facts that drive severity (unchanged from 2026-06-05, re-confirmed)
- Browser talks to the platform DB with the anon key; **RLS is the only tenant boundary** for direct reads.
- **Every** edge function deploys with `verify_jwt = false` (`config.toml`); in-function authorization is
  mandatory. Verified sound: `_shared/assert-client-access.ts` (`admin.auth.getUser` signature check +
  role re-derivation + ownership) and `_shared/authorize-client-request.ts` (dual-mode service-role OR
  JWT owner; constant-time key compare).
- Agency `FOR ALL` RLS also matches a **client-role** user (a client belongs to its own agency), so any
  cost/pricing/secret table must additionally gate `get_user_role(auth.uid()) = 'agency'`.

## Findings

| ID | Sev | Issue | Disposition |
|----|-----|-------|-------------|
| F16C-SMS-1 | HIGH | F16(c) missed-call text-back is a forgeable unauthenticated outbound-SMS vector (`retell-call-webhook/index.ts:152-217`). When `missed_call_textback_enabled=true` and `retell_webhook_secret` is unset (default), the signature block (`:128-143`) is skipped, so a forged `call_ended` POST with `direction:"inbound"`, short `duration_ms`, and an attacker-chosen `from_number` makes the client's Twilio text that number. SMS-pumping / toll-fraud. Mitigated by fixed body + 15-min per-number dedupe, but numbers rotate. | **REPORT-ONLY, DEFERRED to First-Client Milestone** (Brendan's call). Default-OFF and unused today; the fix requires `retell_webhook_secret` which the milestone arms (DEFERRED 6.6). Logged to `BUG_LIST.md` (F16C-SMS-1) with the full fix-spec; added as a hard prerequisite in `FIRST_CLIENT_MILESTONE.md` step 6. |
| QH-TZ-1 | MEDIUM | `parseQuietHours` (`trigger/_shared/businessHours.ts:81-90`) does not validate `tz`; a malformed `clients.cadence_quiet_hours.tz` (free text) throws `RangeError` in `isWithinQuietHoursWindow`/the AU clamp on every send attempt, stalling that client's whole cadence (fail-closed self-DoS, not a compliance bypass). | **LOG** (`BUG_LIST.md` QH-TZ-1) with the ~10-line fix-spec. Cheap + safe; fix on request / next code session. |
| RLS-UISTATE-1 | LOW (latent) | `chat_starred` + `dismissed_error_alerts` (`sweep_1b`) use an `agency_id`-scoped `FOR ALL` policy WITHOUT the `get_user_role()='agency'` gate. Correct-by-design ONLY while the "one agency per top-level client" onboarding invariant holds. | **LOG + milestone-verify.** No current exposure: live DB has 1 agency / 2 clients (both BFD-internal) and ZERO client-role users, so nothing is exploitable today. Becomes relevant only when a real client-role user exists AND two real clients share an agency. Tables carry only UI-state (starred chats, dismissed alerts) — no secret/cost data. Recommend the onboarding "fresh agency per top-level client" step be an explicit milestone check, OR add a client-scope to these two policies as defense-in-depth. |
| FUNNEL-SCAN-1 | LOW (perf) | `get-show-rate-funnel/index.ts:101` paginates up to `100 * PAGE_SIZE` (≈100k) bookings under the service role. Bounded, but a slow scan for a very large tenant. | **LOG** (`BUG_LIST.md`). Fine for early clients; revisit if a tenant grows large. |
| ROLE-RESOLVE-1 | LOW (pre-existing) | `get_user_role` uses `LIMIT 1` with no `ORDER BY`; a user holding both an `agency` and `client` role row resolves nondeterministically. Not introduced by this diff; users hold one role in practice. | **LOG** (`BUG_LIST.md`) as a defense-in-depth hardening (add deterministic ordering / prefer the more privileged role). |
| (note) | known | `intake_lead_secret` bearer is public-by-design (embedded in static site HTML); it authenticates lead-create + billable auto-enroll + all booking tools. Constant-time compared. Subscription gate dormant unless `ENFORCE_SUBSCRIPTION_GATE=true`. | **No action** — pre-existing accepted design, not tenant-crossing. Rate-limiting is a possible future defense-in-depth. |

## Clean (reviewed, no findings)

- **P2 `execution_cost_events`**: RLS role-gated in BOTH `USING` + `WITH CHECK` (`= 'agency'` AND
  agency-owns-client); no client-read policy; `service_role` gets SELECT/INSERT only. All 4 write sites
  (`sendTwilioSmsAndStamp`, `retell-call-webhook`, `retell-call-analysis-webhook`, `runEngagement`) are
  best-effort (try/catch, no hot-path throw); idempotent via `onConflict:"cost_kind,provider_ref"`.
  Low non-security note: both voice webhooks upsert the whole row → last-writer-wins on a shared
  `call_id` (benign, same source).
- **P2 F9 v2 drift poll** (`trigger/pollRetellDrift.ts`): per-client `retell_api_key` strictly matched
  to the same client's agent; only GET against Retell (`get-agent`, `get-retell-llm`), NEVER a write;
  DB writes scoped per setter/client.
- **P2 BOOK-TZ-1**: `isValidTimeZone` (Intl) validates at every persist path (invalid → NULL/omit, never
  nulls a prior value on upsert); `leadDisplayZone` used only for the prompt block + display dynamic
  vars; the booking-time path never imports a leadTimezone helper — booked time provably unchanged.
- **F15**: `booking_status_events` + `weekly_reports` RLS-enabled with ZERO policies (service-role edge
  fns only). `client_report_config` `FOR ALL` correctly role-gated (`= 'agency'`). Both edge fns verify
  JWT + ownership via `resolveClientAccess` before any read; all queries `client_id`-scoped; report HTML
  escaped.
- **F16 auth**: default-OFF respected; both Retell webhooks regex-validate `agent_id` before the
  PostgREST `.or()` filter (injection-guarded). (F16c is the exception above.)
- **F17-p1**: the calling-hours clamp fails CLOSED (bad tz throws → the send/dial does not happen), not
  open. AU legal windows + holiday set applied as an intersection; non-AU zones are a no-op. Recording
  disclosure is a non-secret boolean, inert until the prompt references it. (Holiday list freshness is a
  separate operational item — see `BRENDAN_TODO.md`.)
- **Onboarding gate**: `voice-booking-tools` now fail-closed on a NULL `intake_lead_secret`; every query
  `client_id`-scoped (no IDOR); CANCEL-1 server-side eventId binding refuses fabricated ids.
  `webhook-manifest` authorizes before anything; GOLIVE-1 requires real provisioning. `sweep_1a`
  `clients_public`: NO secret VALUE added — `stripe_customer_id` + subscription dates are non-secret;
  every real secret is exposed only as a `has_*` boolean; view is `security_invoker`.
- **PROMPT-AUTH-1**: both `get-external-prompt` / `save-external-prompt` call `authorizeClientRequest`
  before any read/write; fixed table allow-list; PostgREST-parameterized filters. Save-time lint blocks
  bad writes (422). No cross-tenant path.

## Fix-specs (for the milestone / next code session)

**F16C-SMS-1 (fail-closed the auto-send).** In `retell-call-webhook/index.ts`: declare
`let signatureVerified = false;` before the verify block (`:128`), set it `true` only after `sigOk`
passes with a secret present (inside `:128-143`). Extract a pure `shouldSendMissedCallTextback(...)`
predicate to a new `missedCallTextback.ts` (mirrors the sibling `retell-call-analysis-webhook`
extract-and-test pattern: `contactId.ts`/`callOutcome.ts`) that additionally requires
`signatureVerified===true`. Gate the send on it and `console.warn` (never throw) when
enabled-but-unauthenticated, so `call_history`/cost/leads processing (all OUTSIDE the branch) is
unaffected. Deno test `missedCallTextback.test.ts`: forged-unsigned⇒false, signed⇒true, and
disabled/outbound/engaged(≥20s)/no-from-number⇒false. Effect: F16(c) requires `retell_webhook_secret`
armed + Retell signing configured, in addition to the opt-in flag — couples it to milestone step 6.6.
Nothing breaks now (default-OFF, no client has the flag or the secret).

**QH-TZ-1 (validate the quiet-hours tz).** In `trigger/_shared/businessHours.ts`:
`import { isValidTimeZone } from "./leadTimezone.ts"`; in `parseQuietHours`, after the structural
guard, `const safeTz = isValidTimeZone(tz) ? tz : DEFAULT_QUIET_HOURS.tz;` (+`console.warn` on
fallback), return `{ start, end, tz: safeTz, days }`. Trigger-only (no edge twin). Test in the existing
`businessHours.test.ts`: `tz:"Not/AZone"` falls back to `DEFAULT_QUIET_HOURS.tz` and
`isWithinSendingWindow` `doesNotThrow`.

## Deploy / change record (this review)
- No edge/trigger deploys, no migrations, no Retell writes, no prompt edits.
- Code change this session: removed the dead `presentation_only_mode` redirect branch in
  `frontend/src/components/ClientLayout.tsx` (route target deleted in G3-8(b); 0 clients had the flag
  live) + dropped the now-unused `Outlet` import and the `presentation_only_mode` select field. `tsc`
  clean + `vite build` green.
- All findings above logged to `BUG_LIST.md` / `BRENDAN_TODO.md`; F16C-SMS-1 also added to
  `FIRST_CLIENT_MILESTONE.md`.
