# BFD-Setter — Brendan's Manual / UI Todo List

Things only Brendan can do (UI clicks, logins, provider dashboards, business calls). Reconciled 2026-06-25.
Testing actions live in `TEST_LIST.md`; first-paying-client onboarding actions live in `DEFERRED.md`;
**prompt-content edits (agent wording) live in `PROMPT_UPDATE_LIST.md`** (kept separate so you can work
prompt tweaks independently).

## Active (do when you have time)

- [ ] **Apply the Setter-1 prompt content migration (PROMPT-AUTH-1, report-only)** — the legacy 511-line
  "# BOOKING FUNCTION" blob in the stored Text-setter prompt (the root cause of the Monday/wrong-date booking
  bug) is now safe to remove: booking mechanics are code-owned as of PROMPT-AUTH-1. Steps are written out in
  `Docs/investigations/prompt-migration-reports/e467dabc-57ee-416c-8831-83ecd9c7c925_Setter-1.report.md`
  (generated read-only, never touches the DB): open Prompt Management → Setter-1 → SETTER CORE → enable
  "Booking Function" → "View Prompt" → clear the legacy booking text (or click "Return to Default" for the new
  minimal template) → Save/Deploy (now lints on save + snapshots to `prompt_versions`) → re-open "Verify Setter
  Prompt" → "Load live stored prompt" to confirm it's lean. Unblocks 3 `TEST_LIST.md` PROMPT-AUTH-1 checks
  (full-prompt visibility via the new X-Ray, no-leftover-artifacts, efficiency). `[B]`
- [ ] **5.1 Setup-guide screenshot re-shoot** — review and refresh. Lock the canonical BFD Retell **folder name** first, then the screenshots/text in `SetupGuideDialog.tsx` can be re-shot (it still says create a folder named "1Prompt"). `[B]`
- [ ] **B-4 field-access (now self-serve config, not a build input)** — B-4 shipped Session 3. The per-field "which workspace settings a client may see/edit in My Account" is a **per-sub-account** governance editor you already control: open a sub-account → **Sub-Account Config → "My Account Field Access"** and toggle Visible/Editable per field (brand voice, contact hours, voicemail, logo…). Default set is unchanged; tune it per client there. `[B]`
- [ ] **Shut down the n8n Railway service** — the native text engine is fully canonical (the n8n code path was already removed; `processMessages.ts` now throws if `use_native_text_engine` is false). The n8n Railway service can be stopped/deleted. (F5 close-out; the unused `clients.text_engine_webhook` column is deferred, see DEFERRED.) `[B]`
- [x] **Provision the F1 "BFD Conversation Link" GHL custom field (activates F1)** — DONE 2026-06-28 (Claude, via API, during Session 7). Created the TEXT field `BFD Conversation Link` (id `4tDL3asiRNrQD3MKyP2E`, `contact.bfd_conversation_link`) on location `xo0XjmenBBJxJgSnAdyM` and set `clients.ghl_conversation_link_field_id='4tDL3asiRNrQD3MKyP2E'` for client `e467dabc`. F1 is now active; the live deep-link test is in TEST_LIST. (Repo `.env` `BFD_GHL_PIT`/`BFD_GHL_LOCATION_ID` are stale — used the live `clients.ghl_api_key`.)

## From the 2026-07-02 usage/billing + auth build (F13/F14, branch `feature/usage-billing-auth`)

- [x] **Review the branch + say GO for the supervised deploy** — DONE 2026-07-03: Brendan reviewed + GO'd; DEPLOYED LIVE (6 edge fns, Trigger 20260702.1, frontend, backfill; both trap proofs 9/9 + SQL hand-check exact match; results in the handoff). What remains below is yours.
- [ ] **Resend SMTP (unlocks reliable invite + client-reset emails):** (1) create a free Resend account; (2) add + verify `buildingflowdigital.com` (Resend shows the DKIM/SPF DNS records to add); (3) create an API key and hand it to Claude — the SMTP config PATCH payload is in the handoff. Until this lands, invites/resets ride Supabase's built-in mailer, which is rate-limited to a few emails an hour and effectively team-members-only. `[B]`
- [ ] **Confirm the `sms_llm` seed rate** — the per-text sell rate is built from an admin-set "LLM cost per average outbound message", seeded at US$0.003/msg (enabled by default; it does NOT change any blended $/min). Sanity-check against real OpenRouter usage and tune it in the pricing panel. `[B]`
- [ ] **Set per-client billing anchor day + client visibility toggles** — Sub-Account Config → Cost-to-Price Calculator: pick the billing anchor day (default the 1st) and flip on whichever of rate / minutes / texts / month-total each client may see. All four default OFF. `[B]`
- [ ] **After SMTP lands: run the invite + self-reset E2E** — send an invite to a test address (lands on "Set Your Password", 12-char minimum), and run a client-role /forgot-password (now allowed). Items are in TEST_LIST. `[B]`

## From Session 7 phone-half (2026-06-30)

- [x] **Session 7.5 (Text-Setter repair + all bugs) + F8 — BUILT, MERGED to main, and DEPLOYED LIVE 2026-07-01 (overnight, Claude).** Brendan directed a go-live; everything is live. Trigger 20260630.1, `tool_invocations` + `client_pricing_config` migrations, `execute-lead-webhook` v1, `get-blended-rate` v1, frontend (Railway), **retell-proxy v47 (VM-1)** behind a read-only Voice smoke (0 agents mutated). F8 trap proof 9/9. Handoff: `Operations/handoffs/2026-07-01-f8-plus-7.5-deploy.md`. **No deploy left to do** — what remains is your consolidated live-test pass + the manual items below.
- [x] **VOICE-REGRESSION CONFIRMATION — DONE 2026-07-03.** Live outbound call `call_d5625539`: booking + B-3 + B-5
  all confirmed live; **v47 SAFE, no rollback needed**. Voicemail (VM-1) FAILED separately (still "partial",
  0/5 agents) — re-opened in `BUG_LIST.md` as its own item, does not gate v47. → `TEST_LIST.md` /
  `COMPLETED_LOG.md`. (This line was stale — left as open here after the check had already passed.)
- [→] **BOOK-1 prompt tweak — MOVED to `PROMPT_UPDATE_LIST.md` (PU-2) and now CODE-OWNED.** The booking rules it proposed adding to the stored prompt are owned code-side as of PROMPT-AUTH-1 (and the stale booking blob is being removed from the stored prompt via the Setter-1 migration). Do NOT hand-add booking rules to a stored persona. See `PROMPT_UPDATE_LIST.md` PU-2 for the full history.
- [ ] **Revert the Property Coach name** — during the F9-unlock test the setter was renamed to **"Gary - Property Coach 1"** (cascaded live to Retell). Drop the trailing " 1" via the inline tile name editor when convenient (it'll cascade back). `[B]`
- [x] **MODEL-1 — `clients.llm_model` corrected live** — was an invalid OpenRouter id (`google/gemini-flash-latest`) silently breaking all SMS + cadence AI; Claude set it to `google/gemini-2.5-flash` via Mgmt API (2026-06-30). FYI; the hardening (validate the field) is a code item in BUG_LIST (MODEL-1-HARDENING). If you change the model in the UI, use a valid OpenRouter id (e.g. `google/gemini-2.5-flash`).
- [x] **SMS latency reduced** — `agent_settings.response_delay_seconds` for all 7 BFD setters set 60/82 → **12s** (2026-06-30, your call). Tune further in the setter config if 12s feels off.

## After a build ships (I'll prompt you with the exact agent/version)

- [ ] **Re-Save the 5 voice setters** once the B-5/B-3 fix ships (default-vars net + outbound version re-pin) so it takes on the live agents. The 5: Main Outbound (slot 1), Gary Property Coach / Mortgage Broker / Finance Strategist / Crazy Gary. **Never edit the prompts — re-Save/Push only.**
- [ ] **Apply any report-only prompt tweaks** I surface, via the BFD setter UI (prompt content is hard report-only). **These now live in their own list: `PROMPT_UPDATE_LIST.md`.**
- [x] **Flag the inbound setter (activates F2b)** — DONE (live DB: "Inbound BFD Agent" `is_inbound=true`; `clients.retell_inbound_agent_id` + Retell `+61481614530` inbound binding both point at `agent_b2f6495…`). Flipping this is what surfaced B-6 (now fixed in Session 3.1: the persistence held; the list badge was reading the wrong table). One setter per client; flipping another moves the flag.

## Notes

- The inbound number `+61481614530` answers on a dedicated **"Inbound BFD Agent"** (`agent_b2f6495`) with the neutral greeting — confirmed correct 2026-06-25.
- Outbound calls pick the setter at the **campaign/workflow level** — no setter needs an outbound binding (only one setter is flagged inbound). This is the model the F2 build implements.
