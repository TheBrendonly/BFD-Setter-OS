---
description: 2026-06-15 comprehensive BFD-setter build session handoff — shipped the 4 designed features + bug cluster + auth/UX/ops walkthrough tasks + UUID node picker + rigid Conversation Flow engine; staged, verified, pushed. Report-only items, Brendan live-tests, pending human items, and the UI smoke list.
---

# BFD-Setter Comprehensive Build — 2026-06-15

Executed the approved staged plan (`~/.claude/plans/comprehensive-bfd-setter-build-session-fluffy-wozniak.md`). Pre-session HEAD `89ebd71`; all work pushed to Forgejo + GitHub `main`. Frontend ships via Railway on push; edge fns deployed via `scripts/deploy_single_fn.mjs`; migrations via the Management API SQL runner; Trigger.dev tasks via `npx trigger.dev@4.4.4 deploy`.

## What shipped (per stage, all verified)

**Stage A — four designed features + bug cluster**
- **A0 (`1c3974d`)** schema-drift reconcile: migration recording `engagement_executions.active_call_id` (written in 5+ files, was in zero migrations) + **B7** fix (null `active_call_id` on the sequence_complete terminal path). Migration applied live (idempotent no-op).
- **A1 (`03acd5d`)** voice analytics source fix **(fixes B1 "Total Voice Call = N/A")**: `compute-analytics` now reads the platform `call_history` (Retell transcripts) for `analytics_type='voice'`, mapping `transcript_object` into the Conversation shape; external-cred guard moved to the text branch only. Deployed `compute-analytics` v12. Verified: BFD has 22 call rows with transcript arrays.
- **A2 (`4b7dbc1`)** pause/resume **(D1 / 4.5)**: new `pause-engagement` + `resume-engagement` edge fns (ACTIVE, auth-guarded 401) + runEngagement paused-exit (non-terminal, no metrics finalize) + PAUSE/RESUME UI. Uses the proven cancel-run + re-trigger-from-last_completed+1 pattern (not a frozen-wait hold). **Needs Brendan live E2E.**
- **A3 (`ef671ed`)** cost ceiling **(D2 / 4.4, flag-only)**: `clients.weekly/monthly_cost_ceiling_cents` + `client_cost_rollup` view (security_invoker, RLS-safe) + writeCadenceMetrics breach flag to `error_logs` (no auto-pause) + Sub-Account Config inputs + spend badge.
- Trigger **v20260614.2** deployed (B7 + paused-exit + cost flag + probe-skip).

**Stage B — auth / UX / ops**
- **B1 (`e90a313`)** sidebar renames (6.1): "Sub-Account Settings"→**Sub-Account Config**, "Account Settings"→**My Account** (sidebar + page titles).
- **B2 (`e90a313`)** hide Synthetic Probe: `clients.is_system` (probe row flagged) filtered out of switcher + ManageClients + landing redirect; per-client direct URL preserved.
- **B3 (`e90a313`)** probe verify-only: runEngagement skips real Twilio dispatch for `is_system` clients but still writes the `sms_outbound` message_queue row the canary asserts (works without Twilio creds). Probe stays dark until Brendan sets `PROBE_*` env.
- **B4 (`b586873`)** phone-first inbound (**B5 decision**): new `retell-inbound-webhook` edge fn — resolves client by agent_id, looks up contact by `from_number` (exact + last-9 suffix), returns `dynamic_variables` so "details already loaded" is true on inbound. Verified live (known→Hayden, unknown→time-only, bad agent→200). Push-time slot-substitution + EE1 fan-out guards already existed (Tier 2) — no change.
- **B5 (`123c763`)** MFA (A9): opt-in TOTP enroll card (My Account) + login challenge (Auth.tsx, redirect-gated). HIBP gated on Supabase Pro.
- **B6** client-role login (6.2 half): code path verified (RedirectToFirstClient handles `role==='client'`→userClientId; Tier 1 hardened the fallback). Live provision needs a real auth user → **handed to Brendan** (fold into Client #2).

**Stage C (`0ffdb2a`) — UUID node picker (2.4)**
- `Engagement.tsx` picker now reads `voice_setters` and stores the row UUID (falls back to legacy slots if a client isn't backfilled; legacy values still display + fire — call-time resolver dual-accepts). Stable row confirmed for BFD outbound: **"Main Outbound"** `b09624b5-5169-495a-bedd-fb6d3004ab34` → `agent_f45f4dd…`.
- **HARD STOP** before column drop (Brendan-gated): repoint the live cadence (`40e8bea3`) call node onto "Main Outbound", live-test an outbound to TEST_PHONE_A, THEN we drop the outbound columns + inbound-only UI (a later build).

**Stage D (`35b6b38`) — Conversation Flow engine (rigid, minimum)**
- "Convert to Conversation Flow" entry point (agency-only) seeds the rigid 5-node template; first Push to Retell creates the flow (retell-proxy `syncVoiceSetterConversationFlow` v35, already deployed) + round-trips dashboard edits. Decomposition doc: `Docs/CONVERSATION_FLOW_PILOT_DECOMPOSITION_2026-06-15.md`. Brendan authors node content + runs the A/B. In-app wizard→CF compile deferred.

## Report-only (Brendan applies; never auto-edited)

- **Phantom `get_contact`** still in the live booking flow + the new-client prompt template — flagged; fix is in `Docs/VOICE_AGENT_PROMPT_REWRITES_2026-06-14.md`. Do not rewrite the template (prompt content is yours).
- **B6 `success_rate`** (`retellVoiceAgentDefaults.ts:27-31`): typed `boolean`, named like a rate. Recommend rename → `is_successful_call` (keep boolean) OR reword the description. Touches new-agent defaults only — your call.
- **N5 stale references (NOT auto-edited):** ~27 `n8n-1prompt.99players.com` + ~5 `primary-production-392b.up.railway.app` hosts in `frontend/public/workflows/*.json` + `retell-agents/*.json` (n8n is in wind-down; these are import templates), the deleted `llm_22e795…` id in retell-agent reference JSONs + repo prompt files, and orphan/`_archived` Webinar components. Recommend: re-export or delete the legacy templates as a deliberate decision rather than mass-editing reference/prompt-content files.
- **Schema drift beyond active_call_id:** the platform DB still has `engagement_executions.ghl_contact_id` (not renamed to `lead_id`) + `kind`/`reply_channel`/`enrollment_source`/`is_new_lead` not obviously in migrations, and 6 referenced-but-missing tables (`messages`, `payment_attempts`, `simulation_analysis_messages`, `supabase_usage_cache`, `sync_ghl_executions`, `sync_ghl_booking_executions` — best-effort writes, prod works). A full reconcile-migrations pass is a future hardening (rearch item d, partially done).

## Needs Brendan live test (NOT claimed done)

1. **Pause/resume E2E** — start a cadence to TEST_PHONE_A, PAUSE in a delay before step 2 (confirm no sends), RESUME (confirm new trigger_run_id, continues, no duplicate SMS); repeat pausing during a phone_call node.
2. **Outbound-column retirement verify** — repoint cadence `40e8bea3` onto "Main Outbound" in the new picker, live outbound to TEST_PHONE_A.
3. **CF pilot** — Convert Voice-Setter-Test, build the node graph in Retell, A/B vs control (gate: booking rate ≥ control, no surcharge line, llm p50 < 900ms).
4. **All voice work** — apply prompts; Claude verifies read-only.

## Still-pending human items (flagged, non-blocking)

- Retell + Unipile webhook secrets (GHL done). AU SMS A2P Messaging Service for `+61481614530`.
- `PROBE_*` env in Trigger prod + enable (probe verify-only code is live; probe dark until then).
- Set `inbound_webhook_url` on each BYO phone → `…/functions/v1/retell-inbound-webhook` (Retell write, yours) + the inbound prompt change (drop "ask for details").
- Confirm TOTP is enabled in Supabase Auth settings (for MFA). Upgrade to Supabase Pro to enable HIBP.
- `clients.sort_order` SQL (BFD=0) so the agency lands on BFD.

## UI smoke list (Brendan)

- [ ] Sidebar shows "Sub-Account Config" + "My Account"; pages titled to match.
- [ ] Agency client list/switcher does NOT show "Synthetic Probe"; probe still reachable by direct URL.
- [ ] Engagement → a running execution shows PAUSE; a paused one shows RESUME + END NOW.
- [ ] ChatAnalytics → Voice → metrics render (no "N/A") over a window with calls.
- [ ] Sub-Account Config → Cost Ceiling inputs save (dollars); spend badge shows.
- [ ] Engagement phone_call node → voice setter picker lists the 5 voice_setters (incl. "Main Outbound").
- [ ] Voice doc page (agency) → "Convert to Conversation Flow" appears on a single-prompt setter.
- [ ] My Account → "Enable 2FA" → QR → enter code → enabled; sign out/in prompts for the code.

## Verification done this session

Per stage: tsc clean (frontend) + edge-fn deploy + a server-side check (live Management API queries / live edge-fn POSTs). Pause/resume edge fns return 401 to unauthorized callers. Inbound webhook returns correct dynamic_variables live. Cost-rollup view returns BFD's row. Trigger v20260614.2 deployed (B7 + paused-exit + cost flag + probe-skip). compute-analytics v12, retell-inbound-webhook v2, pause/resume v1, all ACTIVE.

## Adversarial review (5-agent Workflow) outcome

Ran a 5-dimension adversarial review over the whole diff (`ca4ceae..HEAD`). 19 findings; **3 real, fixed (`8afbea8`):**
- **MFA reload/deep-link bypass (HIGH)** — a reload or direct deep link at aal1 escaped the TOTP challenge. Fixed at the source: `AuthProvider.mfaRequired` + route-guard bounce to /auth + Auth.tsx mount re-challenge.
- **Inbound suffix phone match** — now loads a contact only on an *unambiguous* last-9-digit match (else empty vars).
- **Cost-ceiling parse** — clamps to PG int4 max.

**Verified-and-dismissed (no change needed):** cost-rollup view RLS is safe (`cadence_metrics` policy is agency-scoped + view is security_invoker); the non-fatal `campaign_events` marker write is the deliberate REL-04 design (resume's primary dedup is `last_completed_node_index`); `is_system` is NOT NULL so the null-skip case can't occur; the CF single-prompt editor is already hidden in flow mode. Lower-severity items (breach-log throttle, orphaned-UUID badge, inbound observability logging) noted as optional polish, not shipped.

**Known residual (documented, not false-confidence):** MFA is now robustly gated at the route level; a full RLS-level aal2 hard-gate (DB policies requiring aal2) remains a future hardening. MFA is opt-in — login is unchanged until a factor is enrolled.
