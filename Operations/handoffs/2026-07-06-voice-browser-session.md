---
description: Voice + browser test session close-out (2026-07-06) - finishes the shared-fn pass (CANCEL-1/BOOK-2/BOOK-3/SMS-METER-1 both halves green, closed to COMPLETED_LOG); onboarding-fix + SWEEP-1 + F9-1 + PHONE-CLEAR-1 + G3-7 all PASS; 4 new bugs + 2 PU items opened; next = F15.
---

# Voice + browser test session — close-out (2026-07-06)

Hybrid session. Claude drove the browser-UI + SMS legs autonomously via headless Playwright + the
harness (Brendan gave ONE 2FA code at the start; the warm `storageState` lasted the whole session).
Brendan did the single answered outbound voice call. This finishes the shared-fn regression that was
half-done in the 2026-07-06 autonomous test pass (part 1).

## RUN 0 (green)
git in sync (`380a889`, local = origin/main = github/main; onboarding-fix commits on github → Railway
deployed). Edge fns ACTIVE at the expected versions: voice-booking-tools **v23**, retell-proxy **v49**,
webhook-manifest **v3**, analyze-chat-history **v19**, analytics-v2-process **v19**, compute-analytics **v16**.
`npm run test:node` 127/127, `npm run test:edge` 217/217 (incl. the CANCEL-1 `eventIdBinding` unit tests).

## PART A — browser UI (agency session), all PASS
- **ONBOARD-1** both create paths (CreateClient page + sidebar Add Sub-Account dialog) → `clients.use_native_text_engine=true`. Throwaways deleted.
- **ONBOARD-2** on the no-ext-Supabase client (`b0e4f199`) → clear guard toast + zero orphan `prompts` rows.
- **ONBOARD-3** "Min 12 characters" placeholders on both create paths; <12 refused client-side in the sidebar dialog.
- **GOLIVE-1 UI** "Not go-live ready" badge + "Still missing:" line lists the failing checks.
- **ACCESS-1** throwaway client-role login → /prompts/voice + /prompts/text + /credentials all redirect to the dashboard; sidebar trimmed (no Text/Voice Setter). User + client deleted.
- **SWEEP-1a/b/c** no clients_public 400 (agency + client), no logs uuid-400, no chat_starred/dismissed_error_alerts 404; persistence + client-role RLS own-row writes proven via PostgREST round-trips.
- **F9-1** locked tile rename refused (input never appears + toast) + doc page unreachable when locked; no `setter_display_names` write; lock restored.
- **PHONE-CLEAR-1** add (Contacts dialog) / edit + clear (ContactDetail) / edit + revert (Chats panel) → `normalized_phone` follows/nulls/sets. Throwaway deleted, synthetic lead restored.
- **G3-7** vite-8 nav of 6 routes, zero module/chunk errors.

## PART A — SMS + PART B — voice = shared-fn pass CLOSED
- **CANCEL-1** SMS cancel bound the real id (`0JWu67…`), every fabricated id refused ("no appointments listed this turn"); voice reschedule + cancel bound the real id (`yw7NyOE0…`), no 404, time moved + status flipped. Protected pre-existing appt (`zjLTA9…`, Jul-8 2:30pm) untouched throughout.
- **BOOK-2/BOOK-3** SMS (Thu 1pm / Fri 2pm) + voice (12:30 Mon Jul-13) exact accepted Sydney times, no day-shift.
- **SMS-METER-1** SMS direct-tool (part 1) + voice in-call → `message_queue` `sms_outbound` row (sid `SM82b1cf…`).
- **VOICE GATE** `call_c347226e…` (233s) booked on v49+v23, real slots, `source='voice_call'`, clean hangup.
- `error_logs` empty for the whole window; every voice tool returned `ok:true`.

All four (CANCEL-1 / BOOK-2 / BOOK-3 / SMS-METER-1) moved out of `BUG_LIST.md` → `COMPLETED_LOG.md`.

## New findings (logged)
- **RESCHED-SMS-1** (BUG, Medium) — over SMS the fast text model calls `get-available-slots` instead of `get-contact-appointments` before `update-appointment` (binding refuses it every time), and once emitted a FALSE "moved, all set" with no successful mutation. Data stayed safe (voice reschedule works). Fix = a code honesty guard + PU-10 prompt guidance.
- **CHATS-DM-1** (BUG, Medium) — `Chats.tsx:589` selects `dm_executions.messages`, a nonexistent column → 400 on the /chats recent-outbound-previews fetch. Types-drift.
- **FOLLOWUP-DURING-CALL-1** (BUG, Low-Med) — nudge/follow-up SMS fired while the lead was on the live voice call.
- **CONTACTS-EDIT-DEAD-1** (BUG, Low) — the Contacts edit dialog is dead/unwired code.
- **PU-9** (PROMPT_UPDATE_LIST) — voice dead-air during tool lookups: lengthen the per-tool execution messages, `speak_after_execution:true` on book/cancel/update, weave a talk-track. Config already good (ambient_sound, backchannel, speak_during_execution all on).
- **PU-10** (PROMPT_UPDATE_LIST) — text reschedule/cancel: list first, never confirm without a real success.
- Observation: `chat_starred`/`dismissed_error_alerts` RLS is agency-scoped (client-role users can write sibling clients' rows within the same agency — low sev, RLS-SHAPE class).

## Harness (reusable, in the SESSION scratchpad — not committed)
`drv.mjs` (Playwright driver + Mgmt-API `sql()` + `setInput` native-setter + `agencyToken`/`saveState`),
`login.mjs` (admin magic-link + TOTP → storageState), `sms_turn.mjs` (one SMS turn: signed inbound →
poll chat_history for the reply → print tool_invocations), `ghl_appts.mjs` / `retell_call.mjs` /
`retell_config.mjs`. Techniques: native-dispatch `.click()` via `page.evaluate` to bypass the persistent
"LOADING SYSTEM" overlay on the prompts page; force React controlled-input changes via the native value
setter + `input` event. Voice tool calls do NOT log to `tool_invocations` (that table is SMS-only) —
read the Retell call's `transcript_with_tool_calls` instead.

## Next: F15 (client ROI visibility pack) — prompt emitted in chat + lives at `Docs/TEST_SESSION.md` RUN 10.
After F15 → F16 → the event-gated First-Client Milestone, v1 is 100%.
