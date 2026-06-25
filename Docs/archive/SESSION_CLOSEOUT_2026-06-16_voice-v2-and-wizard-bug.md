---
description: Session close-out (2026-06-16, late) — booking/callback fixes shipped, prompt-size research, Main Outbound V2 draft + stood up, and a NEW BUG (Create-New-Setter skips the setup wizard so new setters get no booking tools). Includes a copy-paste build prompt for next session.
---

# Session close-out — 2026-06-16 (voice booking/callback + V2 + wizard-skip bug)

## What shipped this session (live in prod, verified)

- **Booking diagnosis (call_c74254):** root cause = prompt-flow (agent invented times on a 0-slot Friday; never called get-available-slots; empty dyn vars because it was a manual non-pipeline call). Backend proven healthy by a live round-trip. The "endDateTime bug" an auto-reviewer claimed was **refuted**.
- **Callback diagnosis:** the first-ever AI callback (row `522be766`) **WILL fire** 2026-06-17 00:00Z (10am AEST) — prod Trigger run `run_cmqg1csns444w0hn2dex5kx5x` is FROZEN/waiting, all dial preconditions green.
- **Backend fixes (deployed, verified, UNCOMMITTED):** double-dial dedup (migration `20260616120000_scheduled_callbacks_pending_dedup.sql` partial unique index + webhook pre-insert guard + in-call 23505 handling) and graceful `slot_unavailable` recovery in book-appointments. `voice-booking-tools` **v15**, `retell-call-analysis-webhook` **v22**.
- Full diagnosis write-up: `Docs/SESSION_2026-06-16_voice-booking-callback-diagnosis.md`.

## Research delivered (report-only)

- **Prompt size vs structure:** old ~56k prompt was bloated by 21× `{{available_time_slots}}` across two booking surfaces; rewrite (live) cut it to 19.5k / 1 ref. Further reduction without losing structure = (A) compaction + Knowledge Base, (B) multi-prompt states [no platform support here], (C) rigid Conversation Flow [groundwork built, ~23% per-call token win, booking turns don't fully escape the 3,500-tok scaler]. Latency is already solved, so this is cost/structure only.
- **Eddie/"Steven" prompt analysis:** extracted 6 transferable patterns (consent beat, path triage + goal hierarchy, booking-failure ladder, post-booking prep Qs, TTS guide, rapport "statements not just questions").

## Main Outbound V2

- **Draft:** `Docs/MAIN_OUTBOUND_V2_PROMPT_2026-06-16.md` — folds the 6 Steven patterns into V1's strengths; single-prompt; 0 literal slot-refs in body.
- **Stood up by Brendan** as setter **"Voice Setter 8"** (`66cc5346…`), Retell agent **"Main Outbound V2"** (`agent_088a9ed98d7e815b0382f0d579`, llm `llm_be74dcf…`). Verified read-only: prompt is the V2 body (18,615 chars, **1** slot ref, no phantom get_contact, all new sections present), published cleanly (v2, no stuck draft — v39 publish path canaried OK), gemini-3.0-flash + custom voice.
- **🔴 BUT V2 has only 3 tools** (`end_call`, `send-sms`, `schedule-callback`). The 5 GHL booking tools are MISSING → **V2 cannot book**. Cause = the wizard-skip bug below.

---

## 🐛 NEW BUG — "Create New Setter" skips the setup wizard (new setters get no booking tools)

**Symptom (Brendan):** creating a new setter did NOT go through the setup wizard — it dropped straight onto the main prompt-edit page, so none of the wizard-configured variables were added. Result: the new voice setter's Retell agent is provisioned WITHOUT the booking function enabled, so only `end_call` + the auto-injected `send-sms`/`schedule-callback` attach — the 5 booking tools (`get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`, `cancel-appointments`) do not. The setter can't book.

**Root cause (code-confirmed):** `handleCreateNewSetter` at `frontend/src/pages/PromptManagement.tsx:5528-5670`:
- Inserts an **empty** `prompts` row (`content:'', persona:'', is_active:false`).
- Calls `retell-proxy` `action:'sync-voice-setter'` with `generalPrompt:''`, **no booking/availability/dynamic-var config**, and a hardcoded **`model:'gpt-5.2'`** (a reasoning model — latency liability per `project_voice_latency_root_cause`; should default to gemini-3.0-flash or the client default).
- Then `fetchPrompts()` + toast. It **never routes through the setup wizard** (`VoiceAIRepSetup.tsx` / `SetupGuideDialog.tsx` / `components/setup-guide/*`), which is what enables the booking function, wires the 5 booking tools (injected by name in retell-proxy), and sets availability + dynamic-variable config. So a new setter is created "bare."

**Evidence:** V2 = setter `66cc5346` / agent `agent_088a9ed98d7e815b0382f0d579` → get-retell-llm shows only 3 tools; Main Outbound (`b09624b5` / `agent_f45f4dd…`) has all 8.

### Immediate manual workaround for V2 (so tomorrow's booking test works)
In the BFD setter UI, open V2 / "Voice Setter 8", **turn ON the booking function toggle** (the one Main Outbound has on), and Save → Push. `retell-proxy` injects the 5 booking tools with the `voice-booking-tools` webhooks. Then ping Claude to re-verify it shows 8 tools before the test call. (If you can't find the toggle, re-run the setup wizard for that setter.)

---

## 📋 COPY-PASTE BUILD PROMPT (next session) — fix the wizard-skip bug

```
Build: "Create New Setter" must produce a fully-configured, bookable voice setter.

BUG: In the BFD setter UI, "Create New Setter" skips the setup wizard and drops the user
on the prompt-edit page. The new setter is created bare, so its Retell agent has NO booking
tools — it can't book. Repro (live): setter "Voice Setter 8" (66cc5346-9402-4e8f-b05a-cb8605c871dd),
Retell agent "Main Outbound V2" (agent_088a9ed98d7e815b0382f0d579) — get-retell-llm shows only
3 tools (end_call, send-sms, schedule-callback); the 5 GHL booking tools are missing. Compare
"Main Outbound" (voice_setter b09624b5 / agent_f45f4dd87a4072424f3c84b74c) which has all 8.

ROOT CAUSE (already located): frontend/src/pages/PromptManagement.tsx handleCreateNewSetter
(~5528-5670) inserts an empty prompts row and calls retell-proxy action:'sync-voice-setter'
with generalPrompt:'' and NO booking/availability/dynamic-var config, plus a hardcoded
model:'gpt-5.2'. It never routes through the setup wizard (VoiceAIRepSetup.tsx /
SetupGuideDialog.tsx / components/setup-guide/*) that enables the booking function (which is
what makes retell-proxy inject the 5 booking tools by name), sets availability, and wires the
dynamic variables.

INVESTIGATE (read-only first):
1. handleCreateNewSetter (PromptManagement.tsx:5528) — exactly what it sets vs omits.
2. The setup wizard: VoiceAIRepSetup.tsx + SetupGuideDialog.tsx + components/setup-guide/* —
   what config it writes (booking_function_enabled / agent_settings / availability / dyn vars /
   model / voice) and where (prompts row, voice_setters row, client columns).
3. retell-proxy sync-voice-setter (frontend/supabase/functions/retell-proxy/index.ts
   syncVoiceSetter ~868-1124): how/when it attaches the 5 booking tools (booking flag? tool
   injection by name?) and what payload fields gate them. Confirm what a fresh setter must pass
   to get all 8 tools wired.
4. Diff a bare new setter vs Main Outbound at the DB + Retell level to enumerate every missing
   field.

FIX (pick the cleaner of, or combine):
  A. Route "Create New Setter" through the setup wizard so booking + availability + dynamic vars
     + model/voice are configured before/at provisioning (preferred — matches product intent).
  B. Minimum: make handleCreateNewSetter create a bookable setter by default — enable the booking
     function, pass the booking config to sync-voice-setter so the 5 tools attach, default the
     model to gemini-3.0-flash (NOT gpt-5.2), and seed the default booking/dynamic-var config.
Also fix the hardcoded model:'gpt-5.2' default regardless of path.

ACCEPTANCE CRITERIA:
- Creating a new voice setter yields a Retell agent with ALL 8 tools (5 booking + send-sms +
  schedule-callback + end_call) wired to the voice-booking-tools edge fn, exactly 1
  {{available_time_slots}} ref, a sane non-reasoning model, and the dynamic-vars block.
- Verify read-only via GET /get-retell-llm (8 tools, 1 slot ref) and a live test booking call
  (tool_calls fire: get-available-slots + book-appointments; booking succeeds).
- Existing setters unaffected.

CONSTRAINTS: prompt CONTENT stays report-only (don't edit live prompts); the wizard routing +
model default + tool-wiring are CODE (do them). Deploy edge fns via scripts/deploy_single_fn.mjs.
Verify before claiming fixed. Project DB ref bjgrgbgykvjrsuwwruoh; creds in .env
(SUPABASE_PAT, BFD_RETELL_API_KEY) per scripts/check-creds.mjs.
```

---

## Other open items (besides tomorrow's test calls)

- [ ] **Commit the shipped backend fixes** — B1/B2 (migration + voice-booking-tools v15 + retell-call-analysis-webhook v22) are LIVE in prod but UNCOMMITTED (prod ahead of repo = drift). Branch off main, commit just those + the session docs; leave the concurrent `retell-proxy` v39 WIP out.
- [ ] **V2 booking-tools workaround** (above) before the V2 booking test.
- [ ] **Callback live-verify** tomorrow ~10am AEST: confirm row `522be766` flips to `placed` + a call lands on +61405482446. (The cron set this session is session-only and won't fire if the session ended; the callback itself fires via Trigger regardless — fold the check into tomorrow's test session.)
- [ ] **Main Outbound V2 test** tomorrow: send Claude the call_id for read-only verify (token size, latency, booking tool_calls, slot-unavailable/consent/callback branches).
- [ ] (Pre-existing) Property Coach company-name placeholder prompt item still open.
