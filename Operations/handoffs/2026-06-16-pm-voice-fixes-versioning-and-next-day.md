---
description: 2026-06-16 PM session closeout — voice prompt fixes (item 1 Property company name + booking guardrail on all 5 setters), the Retell published-version immutability bug (fixed v39 by a parallel session), item 4 AU Twilio confirmation, Section A decisions, and the clean task list for 2026-06-17 (Build 1 review + the full live run-through).
---

# BFD-Setter PM Session Closeout — 2026-06-16

Follow-on to the morning P0-P2 cluster build (`Operations/handoffs/2026-06-16-p0-p2-cluster-build.md`). This session started as the "missed-things closeout" (read-only) and became a working session: voice prompt fixes, the versioning bug, the booking guardrail, commits, and Section A.

## End state
- **HEAD `c5d7040` on `main`** (booking dedup + slot-recovery). Plus `3624b01` (retell-proxy v39 versioning fix) and `f0753e0` (A/B research brief) from parallel sessions today.
- **Build 1 is RUNNING** in a separate session Brendan started (GHL send-path migration + probe canary fix + "BFD Setter" rebrand + F7 lockdown + review polish).
- **Deployed edge fns:** retell-proxy **v39**, voice-booking-tools **v15**, retell-call-analysis-webhook **v22** (+ intake-lead v9, compute-analytics v14, webhook-manifest v2 from the AM).
- **Voice setters all live with latest prompts:** Main Outbound **v17**, Property **v8**, Mortgage **v8**, Finance **v5**, Crazy **v5**. Phone `+61481614530` → Main v17 (inbound+outbound). EE1 direction cols all Main (no fan-out).

## What this session did
1. **Missed-things closeout (read-only).** Probe is still RED but NOT the old 409 — the is_system bypass works; real failure is a **canary race** in `trigger/syntheticProbe.ts` (asserts the message_queue row the instant status flips to `running`, before the SMS node, then cancels). Cron healthy. ~15-min fix folded into Build 1. BFD secrets: `retell/unipile_webhook_secret` NULL, `ghl/intake` SET. Captured 4 decisions (see below).
2. **PROMPT 2 verification (read-only).** All 5 setters published; phone pinned to Main. Report-only prompt-fix status pulled live: the Property company-name placeholder was the only genuinely-outstanding item (Mortgage/T10b/V6/Crazy-tools were already fine).
3. **Live test call 1 (Main v15 → +61405482446).** **Speed FIXED:** llm.p50 **1277ms** (max 4272, zero 4.5s timeouts) vs 2.0-6.4s on old versions. **Booking failed** — the agent invented times and never called get-available-slots (GHL 400 "slot no longer available"); diagnosed as prompt-flow (backend later proven healthy by a parallel session). **Callback works** — `schedule-callback` wrote `scheduled_callbacks` row `522be766` (fires **2026-06-17 00:00 UTC ≈ 10am AEST**).
4. **Retell published-version immutability bug (found + handed off + FIXED).** Brendan's "Push to Retell" 400'd ("Cannot update published LLM") then 422'd ("Cannot update published agent"). Root cause: Retell published agents/LLMs/flows are IMMUTABLE; the proxy edited in place (exposed by the AM P0 publish fix). I tried a fork-LLM fix (v37), reverted to clean v38, and wrote a dedicated-session prompt. A **parallel session shipped the proper fix as `ensureEditableAgentDraft` (create-agent-version draft → edit → publish) in retell-proxy v39** (`3624b01`). Memory: `project_retell_published_version_immutable_bug`.
5. **Item 1 — Property company name → "Building Flow Property"** (was a `[Your … Company Name]` placeholder + config note + 4x "Building Flow Digital"). Brendan applied via UI + re-pushed; **validated v39 live** (Property v6/v7/v8, phone safe, no fan-out). LIVE.
6. **Booking guardrail — applied to ALL 5 setters + verified.** Added the "**Slots are the only source of truth**" RULES bullet (never invent times; if `{{available_time_slots}}` empty, call get-available-slots first). Main v17, Property v8, Mortgage v8, Finance v5, Crazy v5; phone + EE1 safe. v39 push flow worked cleanly across 6 pushes (one version per push).
7. **Item 4 — AU Twilio confirmed.** Real-lead SMS account = **`AC…3ae4fa`** ("Building Flow Digital"); the `.env` `…b57a16` is a different/unused account. Number has a regulatory **bundle attached** + delivering. Messaging Service "BFD" exists but EMPTY (optional to add; would break inbound unless its inbound URL is set first). **Brendan confirmed the bundle is OK.** Effectively DONE. Memory: `project_twilio_au_number_acquisition_and_bundle`.
8. **Committed deployed code** (`c5d7040`): booking dedup (partial unique index migration) + graceful slot_unavailable + docs.
9. **Section A done.** Folder name = **"BFD Setter"** (drives the rebrand). Sidebar labels = **keep current**. Orphan **"Voice-Setter-master" Retell agent DELETED** (HTTP 204, zero refs).

## Decisions locked (2026-06-16)
- GHL send-path migration: **GO** (Build 1).
- Retell webhook secret: **arm during the live-test** (value = the Retell API key, already on file); **Unipile N/A** (no account).
- Email provider: **Resend/other LATER — defer**.
- Twilio number model: **BYO-per-client**. AU bundle: **confirmed OK**.
- SetupGuide folder name: **"BFD Setter"**. Sidebar labels: **keep current**.
- Supabase Pro / HIBP: **NOT NOW** (deferred).

## TOMORROW (2026-06-17) — clean task list
**1. Review Build 1 output** (it's running): GHL send-path migration (live reply/follow-up → Twilio-direct, drop the 5 vestigial GHL webhook fields), probe canary fix, "BFD Setter" rebrand (setup-guide text/screenshots + "© 1PROMPT.COM" footer), F7 credential lockdown, review-polish items. Verify + commit/push.

**2. THE FULL LIVE RUN-THROUGH (Brendan; Claude verifies read-only):**
- Inbound phone-first call to `+61481614530` from a known-lead phone (greets by name, doesn't re-ask).
- Outbound: repoint cadence `40e8bea3` → Main Outbound in the UUID picker, fire a live outbound to TEST_PHONE_A. (Unblocks P3a.)
- Pause/resume E2E (enrol test lead, pause = no sends, resume = new trigger_run_id, no dup).
- Reply + follow-up via Twilio (validates the Build-1 GHL send-path migration).
- **Arm the Retell webhook secret** (= the API key) during the calls; confirm signed webhooks pass / revert to NULL on any 403.
- UI smoke: doc-page expand/relabel · Voice Analytics recordings · Credentials inbound-webhook card · probe empty state.
- Confirm the synthetic probe shows a **passing `probe_results` row** (after Build 1's canary fix).
- Confirm **the AI callback fired** this morning (~10am AEST; row `522be766`).

**3. Post-test gated round:** P3a (retire legacy outbound direction columns) after the outbound test passes; cadence v2 activation; CF A/B if the CF agent is built.

## Deferred / future (not blocking)
Supabase Pro + HIBP · email/Resend · Client #2 onboarding (the ~57-step SOP) · pricing + Stripe (~60 days).

## Pointers
- Closeout/plan + copy-paste prompts: `Docs/SESSION_CLOSEOUT_2026-06-16_AND_NEXT_PROMPTS.md`
- Booking/callback diagnosis: `Docs/SESSION_2026-06-16_voice-booking-callback-diagnosis.md`
- Memory: `project_retell_published_version_immutable_bug`, `project_voice_booking_and_callback_2026_06_16`, `project_pending_prompt_changes`, `project_ghl_is_the_outbound_send_channel`, `project_twilio_au_number_acquisition_and_bundle`, `project_probe_enable_status`.
