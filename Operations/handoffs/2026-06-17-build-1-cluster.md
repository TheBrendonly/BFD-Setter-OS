---
description: Build 1 "the cluster" session record (2026-06-17). GHL fully cut out of the outbound SMS send path (reply/follow-up/manual/stop-bot, 5 UI fields removed) + review polish, tz-aware nudges, debounce tune, F10 cron cleanup, rebrand copy. Deploys + verification + the UI/live smoke list Brendan runs in the final pass. Plus deferred/flagged items with rationale.
---

# Build 1 "the cluster" — Session Record (2026-06-17)

**HEAD `eeb3b55` on `main`** (Forgejo + GitHub). Trigger.dev tasks deployed **version 20260616.3**.
Edge fns: crm-send-message **v13**, stop-bot-webhook **v12**, retell-inbound-webhook **v4** (all
verify_jwt=false). Frontend ships via Railway on push. Plan file:
`~/.claude/plans/bfd-setter-build-session-1-nested-liskov.md`.

Staged A-D + 3-8, each tsc-clean + deployed + committed/pushed per chunk. 1 fresh-eyes adversarial
review (1 scoped finding, confirmed non-live-relevant). No em dashes. Gated items (P3a/P3b/cadence-v2)
untouched.

## What shipped (commit by commit)

| Commit | Stage | Summary |
|---|---|---|
| `860f037` | 1A | Reply + follow-up cut over to direct Twilio. Extracted `sendTwilioSmsAndStamp` to `trigger/_shared/`; removed processMessages STEP 6 (GHL reply webhook) + its guard; added a loud no-send guard; sendFollowup sends via Twilio (leads.phone lookup) instead of `send_followup_webhook_url`. |
| `96aa344` | 1B | Manual send (`crm-send-message`) goes direct via Twilio + message_queue stamp + GHL mirror; Chats/ContactDetail send-gate no longer keys on `send_message_webhook_url`. |
| `4270336` | 1C | `stop-bot-webhook` is now a local-only `setter_stopped` toggle (GHL POST dropped); STOP button renders unconditionally. |
| `0f74536` | 1D | Removed the 5 GHL outbound webhook fields from `ApiCredentials.tsx` + `useClientCredentials.ts` (type/state/load/render/save/SELECT). DB columns kept. |
| `de85b2e` | 4 | Cost-ceiling breach log throttled to 1/client/UTC-day; orphaned-setter badge in the Engagement voice-setter picker; structured receipt logs in `retell-inbound-webhook`. |
| `b0c6bea` | 5 | `nudgeColdReply` now hourly + lead-local-hour gate (9am-8pm in client tz); processMessages debounce fallback 60->30; BFD `clients.debounce_seconds` 60->25 (data update). |
| `8258f06` | 6 | F10: repointed the dead `awzlcmdomhtyqjabzvnn` ref in 4 cron migrations. VC1/VC3 documented-closed. |
| `eeb3b55` | 8 | Home footer `1PROMPT.COM` -> `BUILDING FLOW DIGITAL`; quiz `1 Prompt = 1 Agent` -> `1 Setter = 1 Agent`. |

## Server-side verification (done this session)
- Trigger build typechecked + deployed clean (version 20260616.3, exit 0).
- 3 edge fns deployed ACTIVE (versions above).
- `frontend` `npx tsc --noEmit` clean + `npm run build` clean.
- `sendTwilioSmsAndStamp`: 1 definition, imported in 2 files; no leftover `pushSmsToGhl` in runEngagement.
- No straggler references to the 5 removed fields in `frontend/src` (only generated `types.ts`).
- **`message_queue` channels = `sms_outbound` only (25 rows), zero non-SMS** -> the DM tradeoff below is moot for BFD.
- Adversarial review: extraction faithful; rate-limit intact; gates valid; no double-send introduced.

## The LIVE messaging path changed — Brendan's confirm tests (fold into the final run-through)
1. **Inbound reply (Twilio):** text a test lead so the setter replies -> SMS arrives on the handset; `message_queue` has the `sms_outbound` row (`twilio_message_sid` set); GHL contact thread shows the outbound mirror; `dm_executions` = completed.
2. **Follow-up (Twilio):** set a short follow-up delay + `followup_max_attempts>=1`, let the lead go quiet -> follow-up SMS arrives; `followup_timers` row -> `fired`.
3. **Manual send (Twilio):** Chats -> open a known-phone lead -> "Send message" -> arrives + persists on reload; rate-limit still blocks a 2nd send within 10s; a lead with no phone shows a clear error (not silent success).
4. **STOP toggle:** click STOP SETTER -> flips to ACTIVATE + `leads.setter_stopped=true`; text that lead -> setter does NOT reply; ACTIVATE -> replies resume. No 502s in the network tab (GHL POST gone).
5. **Credentials UI:** the 5 GHL webhook fields are gone; Save still saves the remaining GHL fields.

## UI smoke (no live calls)
- Engagement -> a cadence with a deleted/invalid voice setter shows "Unknown setter (removed)" + a warning line (not the raw UUID).
- Home footer reads "BUILDING FLOW DIGITAL"; the multi-agent onboarding quiz reads "1 Setter = 1 Agent = 1 AI Rep".
- Voice Setter page: the Retell-tab gate (retell_api_key) still works.

## Flagged for Brendan (decisions / values I will not guess)
- **DM channels (confirm):** the SMS-only engine now hard-fails (loudly: error_logs + failed execution) any inbound reply on a NON-SMS channel (Instagram/Facebook DM), because GHL STEP 6 (the old multi-channel deliverer) was removed. BFD has zero non-SMS traffic so this is moot today. If social DMs are ever needed, restore a non-SMS delivery gate in processMessages (do NOT silently skip). Approved SMS-only tradeoff.
- **V4 debounce:** BFD `clients.debounce_seconds` lowered 60->25s for snappier replies. Subjective live-quality tradeoff (shorter window = less message batching). Revert with `update public.clients set debounce_seconds = 60 where id = 'e467dabc-57ee-416c-8831-83ecd9c7c925'`.
- **SetupGuide functional values (still 1prompt):** `app.1prompt.com`, `support@1prompt.com`, the Skool community link, and the `retell-1prompt-folder.png` asset/folder need your canonical BFD equivalents. The whole "Option 1: we resell HighLevel" block may not even fit BFD's BYO-Twilio model — confirm before I swap. (Overlaps the still-open "SetupGuide canonical BFD folder name" decision.)
- **Retell/Unipile secrets:** not provided this prompt -> arming skipped. Paste them anytime; sig-verify code is correct + deployed, I store + run a controlled test, revert to NULL on any 403.

## Deferred (with rationale)
- **2.3 per-setter phone-binding (setters 4-10):** the canonical from-number is `voice_setter_phone_bindings` (read by `make-retell-outbound-call`'s UUID path), but `RetellPhoneNumberSelector` persists to the legacy `clients.retell_phone_N` and slots 4-10 collide on `retell_phone_1`. Properly fixing it = rewire the slot-keyed UI to write `voice_setter_phone_bindings` by setter UUID, which touches the LIVE outbound-call binding and overlaps the gated UUID-migration/P3a work. Fold into P3a.
- **F7/E4 deep write-only credentials:** the read-only feature gates already use `isCredentialConfigured()` presence booleans (VoiceAIRepSetup, the hasTwilio gates) and never render raw secret values — the conservative target is already met. The real browser-exposure reduction is blocked by 4 consumers that legitimately use raw `supabase_service_key`/`supabase_access_token` for direct external queries; that needs the server-side endpoint refactor. Deferred (no-op this session).
- **VC3:** the live voice-coordination path (`waitForCallOutcome` reading `last_call_outcome` + `treat_pickup_as_reply`) is healthy and load-bearing (called at 2 live sites). The memory's "polling is vestigial" note was inaccurate. Only the retired `voice_setter_id_override` persona-slot override is genuinely inert; left in place rather than touch the live engine for a cosmetic removal.

## Report-only findings (N5 + schema-drift)
- **N5 dead hosts in `frontend/public`:** `retell-agents/Voice-Setter-1.json` has 5 railway booking-webhook URLs (`primary-production-392b.up.railway.app`); `workflows/voice-sales-rep/Get_Lead_Details.json` references `n8n-1prompt.99players.com`. Also `PresentationAgentChatInterface.tsx`/`WebinarPresentationAgentChatInterface.tsx`/`WebinarSetupGuideDialog.tsx` default to `n8n-1prompt.99players.com` webhooks (functional endpoints for the presentation/webinar agents — likely retired n8n-era; don't blind-swap). No `llm_22e795` in `/public`; no `_archived` Webinar components. Recommend: confirm the presentation/webinar agents are dead, then delete; the Voice-Setter-1.json template is a static asset (the live agents read from Retell, not this).
- **Schema-drift:** the 6 "missing" tables (`messages`, `payment_attempts`, `simulation_analysis_messages`, `supabase_usage_cache`, `sync_ghl_executions`, `sync_ghl_booking_executions`) do NOT exist on the platform DB (`bjgrgbgykvjrsuwwruoh`). Their edge-fn writers (stripe-webhook, analyze-simulation, refresh-usage-cache, sync-ghl-*) would fail in-band (supabase-js errors are in-band, not thrown). Most are gated features (Stripe PARKED, simulation, usage cache, GHL sync). `engagement_executions` correctly uses `ghl_contact_id` (no `lead_id` rename needed). The vestigial `.from("messages")` read in `outbound-call-processing` is dead. Investigate per-feature before creating tables; not a blind fix.

## Pointers
- Live messaging facts: memory `project_ghl_is_the_outbound_send_channel` (now updated: migration DONE)
- This session: memory `project_build_1_cluster_2026_06_17`
- Prior session: `Operations/handoffs/2026-06-16-p0-p2-cluster-build.md`
- The full live run-through test is the LAST thing of all, after this build + Brendan's setup/prompt work.
