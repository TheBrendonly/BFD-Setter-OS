# BFD-Setter — Brendan's Manual / UI Todo List

Things only Brendan can do (UI clicks, logins, provider dashboards, business calls). Reconciled 2026-06-25.
Testing actions live in `TEST_LIST.md`; first-paying-client onboarding actions live in `DEFERRED.md`.

## Active (do when you have time)

- [ ] **5.1 Setup-guide screenshot re-shoot** — review and refresh. Lock the canonical BFD Retell **folder name** first, then the screenshots/text in `SetupGuideDialog.tsx` can be re-shot (it still says create a folder named "1Prompt"). `[B]`
- [ ] **B-4 field-access (now self-serve config, not a build input)** — B-4 shipped Session 3. The per-field "which workspace settings a client may see/edit in My Account" is a **per-sub-account** governance editor you already control: open a sub-account → **Sub-Account Config → "My Account Field Access"** and toggle Visible/Editable per field (brand voice, contact hours, voicemail, logo…). Default set is unchanged; tune it per client there. `[B]`
- [ ] **Shut down the n8n Railway service** — the native text engine is fully canonical (the n8n code path was already removed; `processMessages.ts` now throws if `use_native_text_engine` is false). The n8n Railway service can be stopped/deleted. (F5 close-out; the unused `clients.text_engine_webhook` column is deferred, see DEFERRED.) `[B]`
- [x] **Provision the F1 "BFD Conversation Link" GHL custom field (activates F1)** — DONE 2026-06-28 (Claude, via API, during Session 7). Created the TEXT field `BFD Conversation Link` (id `4tDL3asiRNrQD3MKyP2E`, `contact.bfd_conversation_link`) on location `xo0XjmenBBJxJgSnAdyM` and set `clients.ghl_conversation_link_field_id='4tDL3asiRNrQD3MKyP2E'` for client `e467dabc`. F1 is now active; the live deep-link test is in TEST_LIST. (Repo `.env` `BFD_GHL_PIT`/`BFD_GHL_LOCATION_ID` are stale — used the live `clients.ghl_api_key`.)

## After a build ships (I'll prompt you with the exact agent/version)

- [ ] **Re-Save the 5 voice setters** once the B-5/B-3 fix ships (default-vars net + outbound version re-pin) so it takes on the live agents. The 5: Main Outbound (slot 1), Gary Property Coach / Mortgage Broker / Finance Strategist / Crazy Gary. **Never edit the prompts — re-Save/Push only.**
- [ ] **Apply any report-only prompt tweaks** I surface, via the BFD setter UI (prompt content is hard report-only).
- [x] **Flag the inbound setter (activates F2b)** — DONE (live DB: "Inbound BFD Agent" `is_inbound=true`; `clients.retell_inbound_agent_id` + Retell `+61481614530` inbound binding both point at `agent_b2f6495…`). Flipping this is what surfaced B-6 (now fixed in Session 3.1: the persistence held; the list badge was reading the wrong table). One setter per client; flipping another moves the flag.

## Notes

- The inbound number `+61481614530` answers on a dedicated **"Inbound BFD Agent"** (`agent_b2f6495`) with the neutral greeting — confirmed correct 2026-06-25.
- Outbound calls pick the setter at the **campaign/workflow level** — no setter needs an outbound binding (only one setter is flagged inbound). This is the model the F2 build implements.
