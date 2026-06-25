# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. Brendan runs these **after all build + UI work is done** (his call, 2026-06-25).
When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`. When it fails, open a bug in `BUG_LIST.md`.

## Go-live smokes (code deployed, never live-verified)

- [ ] **6.11** voicemail / no-answer call → fallback SMS fires promptly (NOT the old ~600s ceiling) and `engagement_executions.last_call_outcome` is stamped.
- [ ] **6.12b** answered call + SMS → GHL contact outcome fields populate (Call Outcome / AI Summary / Call Intent / Qualified / Last Call Date); SMS thread → after the hourly scan, Sentiment/Intent/Qualified/Summary populate (`leads.last_sms_analyzed_at` advances).
- [ ] **3.12 SMS booking** → text "can I book?" → slots → pick → `bookings.source='sms'` + `engagement_executions` ends (`stop_reason='booking_created'`); reschedule / cancel / callback over SMS; STOP mid-exchange is respected (not sent).
- [ ] **6.10** a fresh GHL-intake lead has `leads.normalized_phone` set.
- [ ] **6.7** synthetic-probe canary passes (note: still needs PROBE_* env in Trigger prod — operator).
- [ ] **bug-sweep UI** (hard-refresh): 6.1 sub-account nav (Manage Sub-Accounts → `/settings`, Pencil/Trash work); 6.3 Twilio numbers list + manual send (incl. 429 retry) + Instagram/Email inboxes + attendee avatar + credential sync; delete-setter leaves no orphan `voice_setters` row.

## Reliability

- [ ] **B4 send-idempotency** — induce a Trigger retry on a real cadence SMS → confirm **no double-send** end-to-end (unit + DB-level proof already done).

## Session 1 — voice reliability (PREREQ: Brendan re-Saves the 5 setters first)

**Before these, re-Save/Push (do NOT edit prompts) each of: Main Outbound (slot 1) + Gary Property Coach / Mortgage Broker / Finance Strategist / Crazy Gary.** Code deployed 2026-06-25 (retell-proxy v45, duplicate-setter-config v8); fixes only land on the next Save.

- [ ] **B-3 outbound auto-follow** — after re-Saving Main Outbound, `get-phone-number/+61481614530` shows `outbound_agent_version == "latest_published"` (was numeric `19`). Then any later publish goes live on outbound with no re-pin. (Baseline pre-re-Save: outbound `v19`, inbound already `latest_published`.)
- [ ] **B-5 default-vars net** — after a re-Save, the agent's latest-published **LLM** reports `default_dynamic_variables = {first_name:"", …}` (was `null`). Mechanism already proven on a throwaway agent; this confirms it on the live agents. Pairs with the `{{first_name}}` retest below.
- [ ] **B-1 rename cascade** — rename a voice setter inline (and/or via Duplicate). Confirm the one name shows everywhere: card heading + card "Title:"/"Name:" lines, `voice_setters.name`, `prompts.name`/`agent_settings.name`, and Retell `agent_name` all match. The spoken in-prompt persona is intentionally unchanged. A duplicated setter shows its typed name on the new card immediately.

## Session 2 — security/quality sweep (deployed 2026-06-25: retell-call-webhook v21, test-external-supabase v17)

- [ ] **G3-2 shared-agent disambiguation** — only testable once an `agent_id` is shared by >1 client. With one client per agent today it's a no-op (still picks the sole match). When a master agent is shared: an inbound/outbound call routes its outcome to the tenant whose `ghl_location_id == call ghl_account_id`; a genuinely ambiguous match logs `error_logs.error_type='ambiguous_agent_match'` and falls back to the first row. Low priority until multi-tenant master agents exist.
- [ ] **G3-3 outcome-stamp guard** — a normal outbound voice call still stamps `engagement_executions.last_call_outcome` and clears `active_call_id` on `call_ended` (cadence advances/terminates as before). A `call_ended` with no `call_id` is now refused (logged, no stamp) — verify a real call is unaffected.
- [ ] **G3-4 status codes** — in the UI, a bad external-Supabase test (bad URL / wrong key / missing table) still shows the **specific** error toast (now sourced from `error.context`), and the network tab shows **HTTP 400** (validation) or **502** (connection) instead of 200. A good config still saves. (Live-confirmed server-side: missing clientId → 400 + `{success:false,...}`.)
- [ ] **G3-5 esbuild** — `cd frontend && npm ls esbuild` shows `esbuild@0.25.x overridden`; `npm run build` succeeds; `npm audit` no longer lists GHSA-67mh-4wv8-2f99. (All verified at ship; re-confirm after a fresh `npm ci` on a clean checkout.)
- [ ] **types.ts drift (5 UI-state features now functional)** — hard-refresh, then: Contacts page-size + column widths persist across reload; ErrorLogs/Logs column widths persist; SyncGHLBookings toggle saves + reloads without the "Failed to load config" toast; the onboarding "what to do" acknowledgement sticks. (Live-confirmed: all 5 columns present on `clients` + `clients_public`, view still `security_invoker=on`, 0 secrets leaked.)

## Session 3 — settings + setter cleanup (shipped 2026-06-25; frontend build green, DB migs applied via Mgmt API; NO edge-fn deploy needed)

- [ ] **B-4 settings nav** — as **agency**: SYSTEM nav shows **"Sub-Accounts"** (was "Manage Sub-Accounts") + "My Account"; clicking a sub-account opens `/client/<id>/settings` ("Sub-Account Config"). As **client**: SYSTEM shows "My Account" only; the governed self-serve card renders. (The split itself was already shipped 2026-06-17; this was the naming finish.)
- [ ] **F2b inbound auto-rebind** — PREREQ: nothing is flagged inbound yet (default false). In a voice setter's editor, flip **"INBOUND CALLS — USE THIS SETTER?"** ON for the intended inbound setter (BFD = "Inbound BFD Agent", slot 8). Verify: exactly one `voice_setters.is_inbound=true` for the client; `clients.retell_inbound_agent_id` = that setter's agent; Retell `list-phone-numbers` shows the inbound number's `inbound_agents` now points at that agent. Flip ON for a *second* setter → it moves (only one stays inbound). Toggle reflects `is_inbound` after reload. **Live-write path — confirm at a non-critical moment.**
- [ ] **F2c — OUTBOUND CALLING STILL WORKS END-TO-END (must verify).** After removing the per-setter outbound phone config, confirm a real outbound voice call still fires: enroll/trigger a cadence with a `phone_call` step that picks a voice setter at the workflow level → the call **actually places and dials**, rings from a valid number (resolves `voice_setter_phone_bindings`→`clients.retell_phone_1` fallback; no "no Retell phone configured" error), connects to the **correct** setter's Retell agent, and on hang-up stamps `engagement_executions.last_call_outcome` + the cadence advances. Use TEST_PHONE_A (+61405482446) so it's a real dial. This is the key regression check for the F2c change.
- [ ] **F2c phone config relocated** — the voice setter editor no longer shows a "Phone Number" selector. Twilio import + phone-number management now lives on **API Credentials** (RetellPhoneNumbersTab, under the Retell card) and on the Voice AI Rep Setup page; importing/assigning a number there still works.
- [ ] **F2e legacy picker signal** — (defensive; no live data triggers it today) if a `phone_call` cadence node ever holds a `Voice-Setter-N` string, the picker shows an amber "legacy — re-select to migrate" note instead of the red "removed" error.
- [ ] **F6 setup guides** — walk the **Text AI Rep** and **Voice AI Rep** setup guides: the "Multi Agent Logic" / "Inbound Logic" quiz steps are gone, step counts/progress are correct end-to-end, and saving each prompt marks the right step complete (positional step-ids were renumbered).
- [ ] **F2a / F7 (DB, already live-verified)** — `voice_setters.is_inbound` + partial unique index present; a second-inbound write errors 23505. Draft cadence `c206da3e` (+ its inert companion campaign `326ea535`) deleted; no dangling refs.

## Session 3.1 — F2b inbound-toggle hotfix / B-6 (shipped 2026-06-26; frontend-only, Railway auto-deploy, NO edge deploy)

> Note: the persistence path was confirmed working read-only at ship (live DB already has slot 8 `is_inbound=true` + the Retell `+61481614530` inbound binding pointing at `agent_b2f6495…`). These tests confirm the **status-badge fix** and the **non-silent / race-safe toggle hardening** on the live UI. Hard-refresh app.buildingflowdigital.com first.

- [ ] **B-6 inbound-setter status badge (the fix)** — on the **Voice** tab list view, the **"Inbound BFD Agent"** card now shows a green **"Inbound"** badge **and** a green **"Bound"** status (NOT red "Not Active"). The other voice setters are unaffected (Garys still show "Active"; a never-deployed non-inbound setter still shows "Not Active"). The badge reads `voice_setters.is_inbound` (SoT), not `prompts.is_active`/`directions`.
- [ ] **B-6 toggle holds + is non-silent** — open the inbound setter's editor, flip **"INBOUND CALLS — USE THIS SETTER?"** OFF then ON. Each flip: shows a success/error toast, the toggle is briefly **disabled** while the write is in flight (no double-click race), and the state **persists across a reload**. Right after an ON flip, `voice_setters.is_inbound` for that slot is `true` via Mgmt API. A failed/0-row write would now show an explicit error toast and revert the toggle (never a silent "saved").
- [ ] **B-6 "Bound" vs "rebind"** — flipping inbound ON for a **different** setter moves the green "Bound" to that card (and rebinds the Retell inbound number); the previously-bound card drops back to its normal status. If a setter is flagged inbound but `clients.retell_inbound_agent_id` does not match its agent, the card shows amber **"Inbound · rebind"** (re-bind via API Credentials → Phone Numbers).

## Retests after the relevant fix ships

- [ ] **B-3 (6.4)** clear a lead's phone, Save → it stays cleared in BFD **and** GHL (only the name case was retested before).
- [ ] **B-4 (6.2)** client-role login — after a test client-role user is provisioned, confirm it lands on its own dashboard and is RLS-scoped.
- [ ] **B-5 / `{{first_name}}`** — a real inbound call from a number NOT in the CRM → the agent omits the name and never says the literal `{{first_name}}` (code-confirmed via the inbound webhook; verify live, and re-verify after the default-vars net ships).
- [ ] **Calls latency** (optional) — re-measure outbound dispatch latency during the smoke; believed resolved (platform/region incident).

## Standing rule

- After **any** BUG or FEATURE ships, smoke the touched area before marking it done here.
