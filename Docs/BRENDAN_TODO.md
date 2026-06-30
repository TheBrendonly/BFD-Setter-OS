# BFD-Setter — Brendan's Manual / UI Todo List

Things only Brendan can do (UI clicks, logins, provider dashboards, business calls). Reconciled 2026-06-25.
Testing actions live in `TEST_LIST.md`; first-paying-client onboarding actions live in `DEFERRED.md`.

## Active (do when you have time)

- [ ] **5.1 Setup-guide screenshot re-shoot** — review and refresh. Lock the canonical BFD Retell **folder name** first, then the screenshots/text in `SetupGuideDialog.tsx` can be re-shot (it still says create a folder named "1Prompt"). `[B]`
- [ ] **B-4 field-access (now self-serve config, not a build input)** — B-4 shipped Session 3. The per-field "which workspace settings a client may see/edit in My Account" is a **per-sub-account** governance editor you already control: open a sub-account → **Sub-Account Config → "My Account Field Access"** and toggle Visible/Editable per field (brand voice, contact hours, voicemail, logo…). Default set is unchanged; tune it per client there. `[B]`
- [ ] **Shut down the n8n Railway service** — the native text engine is fully canonical (the n8n code path was already removed; `processMessages.ts` now throws if `use_native_text_engine` is false). The n8n Railway service can be stopped/deleted. (F5 close-out; the unused `clients.text_engine_webhook` column is deferred, see DEFERRED.) `[B]`
- [x] **Provision the F1 "BFD Conversation Link" GHL custom field (activates F1)** — DONE 2026-06-28 (Claude, via API, during Session 7). Created the TEXT field `BFD Conversation Link` (id `4tDL3asiRNrQD3MKyP2E`, `contact.bfd_conversation_link`) on location `xo0XjmenBBJxJgSnAdyM` and set `clients.ghl_conversation_link_field_id='4tDL3asiRNrQD3MKyP2E'` for client `e467dabc`. F1 is now active; the live deep-link test is in TEST_LIST. (Repo `.env` `BFD_GHL_PIT`/`BFD_GHL_LOCATION_ID` are stale — used the live `clients.ghl_api_key`.)

## From Session 7 phone-half (2026-06-30)

- [x] **Overnight Text-Setter repair (Session 7.5) — DONE 2026-07-01, branch `worktree-overnight+text-setter-repair-allbugs`.** All 11 open bugs dispositioned; 8 fix commits staged + unit-verified; **NOTHING deployed**. See the **DEPLOY** section below + the handoff `Operations/handoffs/2026-07-01-overnight-text-setter-repair-allbugs.md`.
- [ ] **DEPLOY the 7.5 branch (do FIRST, in daylight, before any live test).** Grouped by target (full commands in the handoff deploy checklist):
  - **Trigger.dev** (SAFE, NOT Voice-gated): redeploy the `trigger/` tasks (covers SMS-OBS-1, BOOK-1 code, MODEL-1a) **+ apply the migration** `frontend/supabase/migrations/20260701120000_tool_invocations.sql` via Mgmt API.
  - **Frontend build** (SAFE): rebuild + ship the frontend (covers F9-1, PHONE-CLEAR-1, the G3-8a LeadRow repoint).
  - **In-project edge** (NOT Voice-gated): `supabase functions deploy execute-lead-webhook --use-api --no-verify-jwt` (G3-8a), then the in-project re-test.
  - **VOICE-GATED edge** (deploy LAST, only if the gate passes): `supabase functions deploy retell-proxy --use-api --no-verify-jwt` (VM-1, **v46→v47**). **Voice-regression gate:** place a real outbound voice call on a canonical agent, confirm booking still works, confirm B-3 (`latest_published`) + B-5 (default vars) survive. **If the gate fails, deploy ONLY the non-Voice items** and leave retell-proxy at v46. `[B]`
- [ ] **BOOK-1 prompt tweak (report-only — apply via the BFD UI, Text setter "Setter-N" system prompt) — AFTER the Trigger.dev deploy, BEFORE the 3.12 re-test.** The structural code half landed on the 7.5 branch (prefetch + inject ground-truth slots every reply + anti-fabrication guard); this prompt half is still yours to apply. Add a hard rule, roughly: *"Never tell a lead a time is unavailable unless the get-available-slots tool returned it as unavailable. Always call get-available-slots before discussing or offering times. When a lead accepts a specific time you offered, immediately call book-appointments for that exact time and confirm. Never invent scarcity or use 'snapped up' / 'booked out' language."* (Also in the `project_pending_prompt_changes` memory.) `[B]`
- [ ] **Revert the Property Coach name** — during the F9-unlock test the setter was renamed to **"Gary - Property Coach 1"** (cascaded live to Retell). Drop the trailing " 1" via the inline tile name editor when convenient (it'll cascade back). `[B]`
- [x] **MODEL-1 — `clients.llm_model` corrected live** — was an invalid OpenRouter id (`google/gemini-flash-latest`) silently breaking all SMS + cadence AI; Claude set it to `google/gemini-2.5-flash` via Mgmt API (2026-06-30). FYI; the hardening (validate the field) is a code item in BUG_LIST (MODEL-1-HARDENING). If you change the model in the UI, use a valid OpenRouter id (e.g. `google/gemini-2.5-flash`).
- [x] **SMS latency reduced** — `agent_settings.response_delay_seconds` for all 7 BFD setters set 60/82 → **12s** (2026-06-30, your call). Tune further in the setter config if 12s feels off.

## After a build ships (I'll prompt you with the exact agent/version)

- [ ] **Re-Save the 5 voice setters** once the B-5/B-3 fix ships (default-vars net + outbound version re-pin) so it takes on the live agents. The 5: Main Outbound (slot 1), Gary Property Coach / Mortgage Broker / Finance Strategist / Crazy Gary. **Never edit the prompts — re-Save/Push only.**
- [ ] **Apply any report-only prompt tweaks** I surface, via the BFD setter UI (prompt content is hard report-only).
- [x] **Flag the inbound setter (activates F2b)** — DONE (live DB: "Inbound BFD Agent" `is_inbound=true`; `clients.retell_inbound_agent_id` + Retell `+61481614530` inbound binding both point at `agent_b2f6495…`). Flipping this is what surfaced B-6 (now fixed in Session 3.1: the persistence held; the list badge was reading the wrong table). One setter per client; flipping another moves the flag.

## Notes

- The inbound number `+61481614530` answers on a dedicated **"Inbound BFD Agent"** (`agent_b2f6495`) with the neutral greeting — confirmed correct 2026-06-25.
- Outbound calls pick the setter at the **campaign/workflow level** — no setter needs an outbound binding (only one setter is flagged inbound). This is the model the F2 build implements.
