---
description: 2026-06-16 BFD-setter build — cleared the P0 voice-publish critical path + the P1/P2 cluster (booking collapse, doc-page UI, credentials cleanup + auto-surfacing inbound webhook manifest, webhook sig-verify rewrite, analytics recordings, probe is_system bypass + ChatAnalytics hang). Staged A-F, each verified + deployed + pushed; adversarial-reviewed.
---

# BFD-Setter P0-P2 Cluster Build — 2026-06-16

Executed the approved plan (`~/.claude/plans/next-bfd-setter-build-session-prancy-marble.md`). Pre-session HEAD `c0fa1b6`; all work pushed to Forgejo + GitHub `main`. Frontend ships via Railway on push; edge fns via `scripts/deploy_single_fn.mjs` / `deploy_retell_proxy_bundle.mjs`.

## Decisions locked (Brendan, this session)
Full P0→P2 staged; all P3 deferred. Only the 5 voice rewrites are applied (still DRAFT until P0 ships → re-save required, see below). Full webhook-manifest build. Conservative credentials cleanup.

## What shipped (per stage, all verified + deployed)

**Stage A — P0 voice publish (CRITICAL) — `2256919`, retell-proxy v36**
Retell renamed the publish endpoint + made `version` mandatory; the proxy called the old `POST publish-agent/{id}` (no body) at 8 sites, so every voice Save created a draft that never published and the phone kept serving the old version. New `publishAgentVersion()` helper → `POST publish-agent-version/{id}` with the REQUIRED `{version}` body, sourced from a `GET get-agent` right before publish (returns the latest = draft version). All 8 sites replaced. **Bonus:** the `refresh-booking-tool-messages` site (was the only one that published but never repinned the phone) now repins too. **Verified live:** the main agent's latest version (15) is `is_published=false` (Brendan's stuck rewrite draft) while 0-14 are published — confirms both the bug and that the fix publishes the right version.

**Stage B — P1 voice doc-page — `fb17c44` (frontend, Railway)**
- Retired the separate `## BOOKING INSTRUCTIONS` append in both push paths (`PromptManagement.tsx`). It double-added the old get_contact/slot-ref booking on top of the doc body. Booking TOOLS stay attached by name in retell-proxy (independent of `booking_function_enabled`), so tools are NOT detached; `booking_prompt` DATA left intact (reversible).
- `PromptDocPage.tsx`: wired local `advancedExpanded` state (the "Expand Advanced Settings" toggle was a silent no-op); relabeled "Open full settings view" → "Modify-with-AI instructions" (it opens the AI meta-prompt editor, not agent settings).

**Stage C — P2 edge-fn batch — `2bedfb3`**
- **Sig-verify rewrite** (`_shared/verify-webhook.ts`): `verifyRetellSignature` now implements Retell's real `v={ts},d=HMAC_SHA256(body+ts, API_KEY)` scheme + 5-min window + constant-time compare (the old HMAC(body,secret)+sha256= matched nothing → would have 403'd ALL Retell webhooks). The 3 Retell fns import it; `unipile-webhook` switched to `verifyStaticToken` (Unipile uses a static custom header, not HMAC). Secrets stay NULL (verify-if-present inert). Deployed: retell-call-webhook **v19**, retell-call-analysis-webhook **v21**, retell-inbound-webhook **v3**, unipile-webhook **v13**. **Verified:** unsigned POST to all 3 Retell fns → HTTP 200 (no regression).
- **Analytics** (compute-analytics **v14**): voice branch now surfaces `recording_url`/`public_log_url`/`transcript` per call (into conversations_list) so the recordings table can populate; dropped `"new user messages"` from `builtinMetricNames` (it was reserved but never produced → N/A).
- **Probe is_system bypass** (intake-lead **v9**): is_system clients skip GHL contact create/find, synthesize a lead_id, still write engagement_executions + return execution_id. **Verified live:** probe POST now returns 200 + execution_id (was 409).

**Stage D — P2 ChatAnalytics — `0c3180b` (frontend, Railway)**
- Recordings: the `currentWebhookData` memo derives the `"Transcript & Recording URL"` table shape from conversations_list (voice only) using the new backend fields.
- Hang fix: `loadInitialData` sets `initialLoadComplete` in `finally` (was only on success → zero-data/error hung on RetroLoader); removed the `navigate('/client/:id')` in `fetchClientData`'s catch (it bounced back and remounted = infinite loop); friendlier empty state.

**Stage E — P1 credentials cleanup + inbound webhook manifest — `b6f5139` + `6270c66`, webhook-manifest v2**
- **Cleanup (conservative):** removed only the truly-dead `ai_chat_webhook_url` + `chat_analytics_webhook_url` (display-only, no functional reader) from `ApiCredentials.tsx`; renamed the "n8n Connections" card → "Simulation". KEPT all fields with live readers (the brief wrongly listed 6 of 9 as dead — verified they have runtime readers). The legacy `api_webhook_url` cred-mirror was LEFT in place (inert when unconfigured) pending Brendan's confirm to retire it.
- **Manifest:** new `webhook-manifest` edge fn (dual-mode authz, verify_jwt=false) computes every inbound webhook URL, generates+persists missing `ghl_webhook_secret` + `intake_lead_secret` (idempotent), returns 11 entries grouped by destination with token, secured/forgeable status, passive last-received signal, and a `goLiveReady` flag. New `WebhookManifestCard` on the Credentials page (Copy URL + Copy token, status pills, readiness badge). Onboarding now mints `ghl_webhook_secret` at client-create. SOP §5 points operators at the card. **Verified live:** BFD → 11 entries, goLiveReady, no-auth → 401, URLs encoded.
- Adversarial-review fixes (`6270c66`): pill fallback + URL-encode query params.

## Adversarial review (8-agent workflow over c0fa1b6..HEAD)
4 findings raised, 2 confirmed (both medium, both in the new Stage E code) — fixed in `6270c66`. The P0 publish logic, sig-verify, intake-lead bypass, analytics, and ChatAnalytics changes all passed clean.

## Deployed edge-fn versions (all ACTIVE, verify_jwt=false)
retell-proxy v36 · retell-call-webhook v19 · retell-call-analysis-webhook v21 · retell-inbound-webhook v3 · unipile-webhook v13 · compute-analytics v14 · intake-lead v9 · webhook-manifest v2.

## Brendan — required next action (unblocks all voice)
**Re-save all 5 voice setters** (Main Outbound slot 1, then Garys 4-7). Their rewrites are sitting as DRAFTS (e.g. main agent v15 `is_published=false`); the Stage A fix means a re-save now publishes them + repins the phone. Send a call_id → I verify version-repoint + latency read-only.

## UI smoke list (Brendan, after Railway rebuild)
- [ ] Voice doc page → Agent Settings → "Expand Advanced Settings" now expands; the settings button reads "Modify-with-AI instructions".
- [ ] Re-save a voice setter → no `publish_warning`; `GET get-agent-versions` shows the new version `is_published=true`; +61481614530 inbound/outbound pins move to it.
- [ ] Voice Analytics → "Call Recordings & Transcripts" now lists calls (audio plays where a recording exists; transcripts show otherwise). "New User Messages" can be defined as a custom metric.
- [ ] Credentials page → "Inbound Webhooks" card: rows grouped by destination, Copy URL/token work, status pills correct (GHL green/secured, Retell amber/leave-blank), go-live badge.
- [ ] Synthetic Probe direct URL → empty state, not an infinite loader. Next hourly probe → a `probe_results` row.

## Report-only (Brendan applies; never auto-edited)
- T10b inbound "ask for details" drop; Mortgage Gary persona contradiction; Property Gary placeholder company + theme mismatch; V6 weekend-slot constraint. (`project_pending_prompt_changes`)
- Optional: `success_rate` boolean naming in `retellVoiceAgentDefaults.ts` (also live on the agent's post_call_analysis_data).
- Confirm whether to retire the legacy `api_webhook_url` n8n cred-mirror (left in place, inert).

## Deferred / flagged
- **F7 deep lockdown:** the manifest now serves inbound secrets via the authorized edge fn (not bulk page-load). The full write-only refactor of `useClientCredentials` (stop shipping API-key columns to the browser) is deferred — it risks destabilising cred-saving and current exposure is agency-only (no client-role users exist yet).
- **P3a** outbound-column retirement (gated on the outbound-repoint + live call on `40e8bea3` — not run). **P3b** CF fleet rollout (gated on the CF A/B — not run). Account-access restructure, schema-drift reconcile, N5 templates, F10, HIBP-on-Pro, Twilio AU bundle, roadmap §7, A/B research brief.

## State
HEAD `6270c66` on `main` (Forgejo + GitHub). 8 edge fns live. No live prompt edits (report-only honored).
