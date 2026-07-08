---
description: Overnight deep-work pass 2026-07-08 — report-first discovery (16 findings) + Tier A safe-queue fixes deployed + Tier B retell-proxy bundle staged; Brendan deploy/test prompt + gated milestone next.
---

# Overnight Deep-Work Pass — 2026-07-08 (Fable 5, plan OFF, unattended)

## TL;DR
Second deep security/product hunt beyond the known list, then fixed + deployed the safe non-frozen queue and staged the frozen retell-proxy bundle. **16 new findings logged (report-first)**; the headline is that a whole class of RLS + webhook issues is **latent today but arms at first-client onboarding**, consolidated into two hard milestone gates. **6 Tier A fixes deployed**, **2 Tier B fixes staged** (Brendan deploys), **1 deferred**. All code changes adversarially refute-verified (6/6 cleared). Nothing exploitable on the current live setup changed for the worse.

## What shipped (Tier A — non-frozen, DEPLOYED + verified)
| Item | Fix | Deploy | Verify |
|------|-----|--------|--------|
| ROLE-RESOLVE-1 | deterministic `get_user_role` (ORDER BY CASE, prefer agency) | migration applied live | `pg_get_functiondef` + dual-role probe → `agency` |
| RLS-UISTATE-1 | role-split `chat_starred` / `dismissed_error_alerts` (agency gated + client-own) | migration applied live | `pg_policies` = 2 role-split policies/table |
| QH-TZ-1 | `parseQuietHours` validates tz, falls back to default | Trigger.dev **20260708.1** | test:node 164/164; 2 TDD cases |
| OPTOUT-FAILOPEN-1 | opt-out gate fails CLOSED on a query error | Trigger.dev **20260708.1** (trigger side) | TDD test; **edge twin STAGED** (see below) |
| F16C-SMS-1 | fail-closed missed-call text-back requires verified Retell signature | **retell-call-webhook v23→v24** | 9 TDD cases; deno check clean |
| FUNNEL-SCAN-1 | warn on scan-cap truncation (no silent under-count) | **get-show-rate-funnel v1→v2** | deno check clean |

All 6 committed one-per-item. Live edge versions confirmed post-deploy via the Management API (not doc/git).

## What is STAGED (Tier B — FROZEN retell-proxy, NOT deployed; Brendan deploys)
Bundled into **retell-proxy v50 → v51** (one version bump), committed but **live stays v50**:
- **GETCALL-1** — `get-call/{id}` → `v2/get-call/{id}` (unversioned was 404 live; fixes the call-detail view).
- **PU-9-CODE** — `BOOKING_TOOL_MESSAGES` filler lengthened to two-beat ~20-30 words + `speak_after_execution:true` on the write tools (book/update/cancel) to kill booking dead-air. Note: `speak_after_execution:false` is now explicit on the 2 read tools (intended, harmless — worth a listen).

deno check on retell-proxy: **19 pre-existing** strict-type warnings, **ZERO new** from these edits (baseline 19 == 19). test:edge 253/253.

### ⚠️ Deploy checklist for the staged retell-proxy bundle (Brendan, daylight)
1. `SUPABASE_PAT=... node scripts/deploy_single_fn.mjs retell-proxy` (NOT the stale `_bundle` script — it drops the `voicemail.ts`/`postCallAnalysis.ts` siblings). Expect v50→v51 ACTIVE.
2. **Read-only Voice smoke:** `list-agents` returns 200, no agent mutated.
3. **Bulk refresh so existing agents pick up the new filler:** in the UI, PromptManagement → run `refresh-booking-tool-messages` for the client (or invoke retell-proxy `{action:"refresh-booking-tool-messages", clientId}`).
4. **Answered-call listen check:** book on a live call, confirm the agent talks across the GHL round-trip (no dead air) and gives a clean post-tool confirmation; tune the `BOOKING_TOOL_MESSAGES` wording to taste.
5. **GETCALL-1:** open an individual call's detail in the UI → loads (200), no 404.

## What was DEFERRED
- **SLOT-MAP-1** — the minimal `dualWriteVoiceSetter` guard was evaluated and **not staged**. It rewires slot-1/inbound-agent routing in a frozen fn that already caused the MAIN-OUTBOUND-SHARED-1 incident, and `syncVoiceSetter` has no `is_inbound` signal to gate cleanly; a guess-guard deployed blind (read-only smoke only) could break live inbound binding. → dedicated session (pairs with the F2 UUID-native cleanup). Interim data mitigation holds: **do not create/save a setter on the empty "Setter-1" tile.**

## Discovery — 16 new findings (REPORT-FIRST; full detail `Docs/SECURITY_REVIEW_2026-07-08.md`)
**Live enabling-state (verified):** `retell_webhook_secret`=NULL both clients · `ghl_webhook_secret`=SET both (GHL webhooks are signed/enforced today) · `missed_call_textback_enabled`=0 · **0 client-role users** · 2 clients share 1 agency. So most findings are latent until first-client onboarding.

### Two hard milestone gates (recommended for FIRST_CLIENT_MILESTONE.md — see "Brendan, your calls")
- **GATE A — role-gate the RLS before creating the first client-role user.** Closes **RLS-CLIENTS-1 (Critical)** (base `clients` policies ungated + `anon`/`authenticated` hold secret-column grants → a client-role user reads every sibling's `supabase_service_key`/Twilio/Retell/GHL keys + can UPDATE subscription/ DELETE siblings), plus RLS-CREDENTIALS-1 (High, GHL key), RLS-ORUSAGE-1 (margin; NOTE the table is browser-read so the fix must role-branch), RLS-TENANT-DISJUNCTION-1, RLS-GATE-SIBLING-1 (3 edge fns authorize via an RLS-gate not `resolveClientAccess`), RLS-UNIPILE-1, RLS-AGENCIES-1, and the already-shipped RLS-UISTATE-1. **High blast radius (79+ reads touch `clients`) → dedicated careful session with a live client-role probe, NOT unattended.**
- **GATE B — arm `retell_webhook_secret` + Retell signing (milestone 6.6), add fail-closed guards.** Closes **RETELL-BOOKING-SMS-1 (High, exploitable today)** (forged `call_analyzed` → booking-confirm SMS to attacker number), RETELL-CALLHIST-POISON-1, RETELL-CALLBACK-DIAL-1, RETELL-INBOUND-PII-1, and F16C-SMS-1 (fixed). Arming the secret authenticates all 3 Retell webhooks at once. Apply the F16C `signatureVerified` pattern to `retell-call-analysis-webhook` + `retell-inbound-webhook` at that time (fail-closing them now would break live features while the secret is NULL).

### Exploitable-today, needs Brendan's product call
- **TRYGARY-DIAL-1 (High)** — `ghl-tag-webhook/index.ts:531` runs `handleTryGaryLanding` BEFORE the signature check; it reads `phone` from the attacker body and enrolls → immediate Twilio SMS to an attacker-chosen number on a live client's account (5-min per-phone dedupe only → rotatable toll-fraud). Route is DEPRECATED + unreferenced by `frontend/src`, but still live. Not retired unattended (a GHL-side workflow may still post it). **Options:** confirm the GHL side is dead → delete the branch; OR move it after the `ghl_webhook_secret` check; OR add `bump_rate_limit`.

### Other report-first items → BUG_LIST
INTAKE-RL-1 (add `bump_rate_limit` to intake-lead), BOOK-TZ-DISPLAY-1 (setter tells the lead their local time via weak-model arithmetic → wrong; wire the dead `formatSlotInZone`; wants a live cross-tz test), BOOK-CONFIRM-HONESTY-1 (no honesty guard on failed NEW bookings; ghost "you're booked"; wants a live forced-failure test).

## Product review → FEATURE_ROADMAP.md (F21-F25 candidate queue, report-only)
F21 booking-reconciliation guard (two ingest endpoints keyed differently double-count; funnel counts human-booked GHL appts as AI — **reporting-semantics decision for Brendan**), F22 reporting-health assertion (show-rate silently dies if the status automation is unwired), F23 proactive `error_logs` failure digest, F24 booked-lead-keeps-getting-nudged, F25 funnel cohort/event window. Plus reaffirmed: minutes-pool burn-down + cost reconciliation (the P2 ledger has zero read surface), F20 revenue attribution, onboarding self-serve.

## Deploy / change record
- Deployed: Trigger.dev **20260708.1**, retell-call-webhook **v24**, get-show-rate-funnel **v2**, 2 migrations applied live (ROLE-RESOLVE-1, RLS-UISTATE-1).
- Staged (NOT deployed): retell-proxy **v51** (GETCALL-1 + PU-9-CODE). Live retell-proxy stays **v50**.
- Edge-optout twin: fixed in code, its 5 consumers (`intake-lead`, `trigger-engagement`, `receive-twilio-sms`, `stop-bot-webhook`, FROZEN `voice-booking-tools`) STAGED → redeploy owed (`TEST_LIST.md`).
- No Retell writes, no prompt-content edits. `BRENDAN_TODO.md` + `FIRST_CLIENT_MILESTONE.md` + `PROMPT_UPDATE_LIST.md` were mid-edit by a concurrent session and were NOT touched; all commits used explicit paths.

## Brendan, your calls (ranked)
1. **Deploy the staged retell-proxy v51 bundle** (checklist above) — daylight, with the Voice smoke + listen check.
2. **TRYGARY-DIAL-1** — decide: retire the dead try-gary branch, gate it, or rate-limit it (it is a live unauthenticated SMS-to-any-number endpoint on a real client's Twilio).
3. **Fold GATE A + GATE B into `FIRST_CLIENT_MILESTONE.md`** (I could not — the file was mid-edit by another session). GATE A must ship BEFORE the first client-role user is invited.
4. **Run the Tier A live checks** in `TEST_LIST.md` (RLS-UISTATE cross-client probe, QH-TZ cadence, F16C once the secret is armed) + **redeploy the 5 edge-optout consumers**.

## Next
The **First-Client Milestone (`Docs/FIRST_CLIENT_MILESTONE.md`) remains the gated final step to v1 "100%"** — event-gated, run only when a client signs. Pipeline: `[✓] P3  [✓] Overnight deep-work  [ ] Brendan deploys v51 + triages GATE A/B + TRYGARY  [ ] First-Client Milestone (gated)`.
