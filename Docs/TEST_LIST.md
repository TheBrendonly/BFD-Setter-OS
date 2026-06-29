# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. Brendan runs these **after all build + UI work is done** (his call, 2026-06-25).
When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`. When it fails, open a bug in `BUG_LIST.md`.

## Go-live smokes (code deployed, never live-verified)

- [ ] **6.11** voicemail / no-answer call → fallback SMS fires promptly (NOT the old ~600s ceiling) and `engagement_executions.last_call_outcome` is stamped.
- [ ] **6.12b** answered call + SMS → GHL contact outcome fields populate (Call Outcome / AI Summary / Call Intent / Qualified / Last Call Date); SMS thread → after the hourly scan, Sentiment/Intent/Qualified/Summary populate (`leads.last_sms_analyzed_at` advances).
- [ ] **3.12 SMS booking** → text "can I book?" → slots → pick → `bookings.source='sms'` + `engagement_executions` ends (`stop_reason='booking_created'`); reschedule / cancel / callback over SMS; STOP mid-exchange is respected (not sent).
- [~] **bug-sweep UI** — **6.1 PASS** 2026-06-28 (Sub-Accounts nav → click opens `/client/<id>/settings`, Pencil opens edit, Trash opens confirm → cancelled; both sub-accounts intact). **6.3 visual PASS** (Twilio/Retell PHONE NUMBERS list shows `+61481614530` + REFRESH/IMPORT; Twilio inbound-SMS webhook AUTO-CONFIGURED; Instagram DMs + Email inboxes load cleanly as setup-style pages — channels not connected for BFD). **Still owed → LIVE-D:** the **manual SMS send + 429-retry** (real text). (delete-setter no-orphan already → COMPLETED_LOG, code.)

## Reliability

- [ ] **B4 send-idempotency** — induce a Trigger retry on a real cadence SMS → confirm **no double-send** end-to-end (unit + DB-level proof already done).

## Session 1 — voice reliability (PREREQ: Brendan re-Saves the 5 setters first)

**Before these, re-Save/Push (do NOT edit prompts) each of: Main Outbound (slot 1) + Gary Property Coach / Mortgage Broker / Finance Strategist / Crazy Gary.** Code deployed 2026-06-25 (retell-proxy v45, duplicate-setter-config v8); fixes only land on the next Save. **PREREQ CONFIRMED DONE 2026-06-26** (read-only): all 5 setters re-Saved; **B-3** (outbound `latest_published`) + **B-5** (default-vars net on all 5 published LLMs) verified → COMPLETED_LOG. The paired `{{first_name}}` live retest remains under Retests. **B-1 rename cascade → COMPLETED_LOG** (code: `set-agent-name` cascades to prompts/agent_settings/voice_setters/Retell; live names already consistent).

## Session 2 — security/quality sweep (deployed 2026-06-25: retell-call-webhook v21, test-external-supabase v17)

- [ ] **G3-3 outcome-stamp guard** — a normal outbound voice call still stamps `engagement_executions.last_call_outcome` and clears `active_call_id` on `call_ended` (cadence advances/terminates as before). A `call_ended` with no `call_id` is now refused (logged, no stamp) — verify a real call is unaffected.
## Session 3 — settings + setter cleanup (shipped 2026-06-25; frontend build green, DB migs applied via Mgmt API; NO edge-fn deploy needed)

- [x] **F2b inbound auto-rebind** — **PASS 2026-06-28 (Session 7).** Flipped inbound ON for Crazy Gary (slot 7) → binding moved (UI showed Crazy Gary "Inbound·Bound", Inbound BFD Agent dropped to "Not Active" — correct, slot 8 is `prompts.is_active=false` report-only), toast on each flip; flipped back to Inbound BFD Agent (slot 8) → restored. Verified end state: only slot 8 `is_inbound=true`, `clients.retell_inbound_agent_id=agent_b2f6495`, Retell `inbound_agents→agent_b2f6495`, phone `last_modification_timestamp` bumped (live rebind fired). NB minor: the toggle rebind omits `agent_version:"latest_published"` → logged **INB-1** (low).
- [ ] **F2c — OUTBOUND CALLING STILL WORKS END-TO-END (must verify).** After removing the per-setter outbound phone config, confirm a real outbound voice call still fires: enroll/trigger a cadence with a `phone_call` step that picks a voice setter at the workflow level → the call **actually places and dials**, rings from a valid number (resolves `voice_setter_phone_bindings`→`clients.retell_phone_1` fallback; no "no Retell phone configured" error), connects to the **correct** setter's Retell agent, and on hang-up stamps `engagement_executions.last_call_outcome` + the cadence advances. Use TEST_PHONE_A (+61405482446) so it's a real dial. This is the key regression check for the F2c change.
- [x] **F6 setup guides** — **PASS 2026-06-28 (Session 7).** Code-confirmed: the `MultiAgentLogicStep`/`VoiceInboundLogicStep`/`QuizQuestion` files are deleted and `SETUP_PHASES` counts renumbered (`text-prompts-setup: 7` was 8; `voice-prompts-setup: 6` was 7). Live: the Setup Guide tab renders the phases cleanly (Twilio/Accounts/Inbound/Outbound/Prompts, with step counts, no gaps/errors). (Per-step "save marks the right step" is code-confirmed via the renumbered `SETUP_PHASES` ids, not deep-walked.)
## Session 3.1 — F2b inbound-toggle hotfix / B-6 (shipped 2026-06-26; frontend-only, Railway auto-deploy, NO edge deploy)

> Note: the persistence path was confirmed working read-only at ship (live DB already has slot 8 `is_inbound=true` + the Retell `+61481614530` inbound binding pointing at `agent_b2f6495…`). These tests confirm the **status-badge fix** and the **non-silent / race-safe toggle hardening** on the live UI. Hard-refresh app.buildingflowdigital.com first.

- [x] **B-6 toggle holds + is non-silent** — **PASS 2026-06-28 (Session 7).** Toggle showed a success toast on each flip and persisted (end state confirmed in DB); covered as part of the F2b move-and-restore.
- [x] **B-6 "Bound" vs "rebind"** — **PASS 2026-06-28 (Session 7).** Flipping inbound ON for Crazy Gary moved the green "Bound" to its card + rebound the live Retell inbound number; the previously-bound Inbound BFD Agent dropped back (to "Not Active", correct for the report-only agent).

## Session 4 — client visibility + cadence controls (2026-06-26)

> F1 shipped this session (sync-ghl-contact **v24** + `clients.ghl_conversation_link_field_id` migration, applied live). **F3 + F4 were already built** (F3 = `4b7dbc1`, F4 = `b0c6bea`); Session 4 verified them live and redeployed Trigger.dev prod (`20260625.1`, 12 tasks) to guarantee the runtime. These tests are the still-owed live E2Es.

- [ ] **F1 — GHL conversation deep-link (PREREQ: provision the field first).** In GHL, create a text/URL custom field "BFD Conversation Link" on the location, then store its id: `UPDATE clients SET ghl_conversation_link_field_id='<id>' WHERE id='<client>'` (see BRENDAN_TODO). Then create a **fresh** GHL contact that posts to `sync-ghl-contact` → on the new GHL contact, the "BFD Conversation Link" field holds `https://app.buildingflowdigital.com/leads/<uuid>`; clicking it opens BFD's conversation view (`ContactDetail.tsx`) for that lead; **exactly one** write, and **no second SMS send** (BFD's own number stays the sole sender). Before the field id is set, lead creation still works and the `sync-convo-link` step shows **"skipped"** (dormant, non-fatal).
- [ ] **F3 — pause / resume a running cadence (live-runtime E2E).** Start a test cadence to TEST_PHONE_A (+61405482446). On a **running** execution, click **PAUSE** before step 2 → `engagement_executions.status='paused'`, and **no sends** occur while paused (check DB + Trigger run logs; the `isPaused()` boundary-exit returns `{status:'paused'}` without finalizing metrics). Click **RESUME** → status back to `running`, the cadence continues from the same step (`last_completed_node_index+1`), **no double-send** of the already-sent step. END NOW on a paused exec still cancels cleanly.
- [ ] **F4 — timezone-aware cold-reply nudge.** With a cold lead (silent after an outbound, within the recovery window) whose client `timezone` makes the **local** hour outside 9am–8pm: the hourly `nudgeColdReply` run **skips** it that hour (no SMS) and nudges it on a later in-window hourly run; an in-window lead nudges normally. (Gate is per-client `clients.timezone` via `Intl.DateTimeFormat`, `nudgeColdReply.ts`.)

## Session 5 — by-phone pivot / B-2 (shipped 2026-06-26: receive-twilio-sms v29, process-lead-file v14, migration 20260627120000 applied; NO Trigger redeploy)

> Most of B-2 was already live from Spec 1 (STOP fully internal+by-phone; inbound internal-first). Session 5 added: (1a) deterministic GHL pick on the inbound fallback, (1b/1c) resilient miss-path so a GHL outage never drops the reply (mint `bfd-<phone>` internal lead + background repoint to the real GHL id), and (2) the CSV-import `normalized_phone` fix + backfill. Server-side confirmed at ship: column+index present, `rows_missing_norm=0`, no duplicate `bfd-%` rows, both fns ACTIVE. These are the still-owed live behavioral checks.

- [ ] **B-2 CSV `normalized_phone`** — import a CSV with an AU phone (e.g. `0405482446`) → the new `leads` row has `normalized_phone='+61405482446'` (Mgmt API). Then an inbound SMS from that number resolves **internal-first** (no new GHL contact minted, no second `leads` row); `receive-twilio-sms` logs `internal lead resolved by normalized_phone`. Also: a UI STOP on that CSV lead now fans out by phone (it was previously invisible to the fan-out).
- [ ] **B-2 inbound never dropped on a GHL outage** — temporarily break GHL resolution (e.g. a bad `ghl_api_key`) and send an inbound SMS from a number **not** in the CRM → the lead still gets a setter reply (Twilio-direct), a `leads` row exists with `lead_id='bfd-+61…'` + correct `normalized_phone`, and `error_logs` shows `ghl_contact_resolve_degraded` (severity warning), **not** `ghl_contact_resolve_failed` (the old drop). A malformed/un-normalizable inbound number still logs `ghl_contact_resolve_failed` + drops (intended).
- [ ] **B-2 background repoint converges, no dup** — after the above, restore GHL and send one more inbound (or wait for the same-request reconcile) → the synthetic row's `lead_id` becomes the real GHL contact id; `message_queue`/`dm_executions`/`active_trigger_runs` for that thread now key off the real id; a later `sync-ghl-contact` webhook for that GHL id **UPDATEs** (no 2nd `leads` row). If a real-id lead already existed, `error_logs` shows `synthetic_repoint_skipped_collision` (deferred to the Spec-2 merge) — not a duplicate. Spot-check: `select client_id,lead_id,count(*) from leads where lead_id like 'bfd-%' group by 1,2 having count(*)>1` → 0 rows.
- [ ] **B-2 deterministic GHL pick** — for a phone that has >1 GHL contact (if you can stage one), repeated inbound sends resolve to the **same** (most-recently-updated) GHL contact every time — no flapping between contact ids.

## Session 6 — secret-read hardening / G3-6 (shipped 2026-06-26: analyze-metric v18, analytics-v2-suggest-widgets v14, get-openrouter-usage v1 NEW, get-chat-history v7; frontend Railway auto-deploy; NO migration — `clients_public` + has_<col> already existed)

> Defense-in-depth: ~20 browser flows that read a secret VALUE now read presence-only (`clients_public` + `has_<col>`) or route the work through an edge fn so the key never reaches the browser. The acceptance gate is the **network-tab proof** below. Verified at ship: tsc clean, vite build green, deno check clean on all 4 fns, all 4 ACTIVE.

- [ ] **G3-6 analytics features still work (Tier 3 — live re-test owed at first client).** With a client that has an external Supabase + OpenRouter key configured: **ChatAnalytics** time-series chart still renders over a date range (now via `get-chat-history` mode:range), **Contacts** last-interaction timestamps still populate (via `fetch-thread-previews`), **custom-metric AI analysis** still returns matches (via `analyze-metric` reading the key server-side), **AnalyticsV2 / CreateMetricDialog** widget suggestions still work (via `analytics-v2-suggest-widgets`), and the **OpenRouter usage** panel (credits/key/activity, via `get-openrouter-usage`) still loads. Per-tenant external-DB timestamp semantics can only be fully validated against a real client.

## Session 6.5 — F9 per-setter Retell lock + fold-ins (shipped 2026-06-26: retell-proxy v46, make-retell-outbound-call v27, migration 20260627130000)

> F9 server guard is verified read-only at ship (12 guard-core unit tests pass; the 5 columns + partial index live; `loadLockIndex` query valid; both fns deployed + booted). The authenticated 423-refusal / bulk-skip / pull / outbound-still-dials behaviours need a live UI session — those are these checks. Agency role.

- [x] **F9 lock a setter (UI).** — **PASS 2026-06-28 (Session 7).** Locked Gary - Property Coach (slot 4): Retell-locked badge + "Not pulled" chip; Edit button read "Retell-locked" and did NOT open the editor (confirmed); Duplicate/Delete hidden. Live DB: `is_retell_locked=true` + `retell_locked_at` set, exactly one setter locked.
- [~] **F9 server refuses BFD writes (single-target).** With the setter locked, rename it via the tile name editor (set-agent-name) → fails with a "setter is Retell-locked" message (HTTP 423 `setter_retell_locked`). (Save/Push is unreachable because Edit is blocked; 423 is the server backstop.) **→ FAILED 2026-06-28 (Session 7): server guard HELD (423, Retell `agent_name` + `voice_setters.name` unchanged) but the inline tile editor pre-wrote `setter_display_names` and reported "saved (Retell push warning)" — the rename leaked at the display layer. Logged as `BUG_LIST` F9-1. Re-verify after the fix.**
- [x] **F9 bulk loops SKIP the locked setter, process the rest.** → **PASS 2026-06-28 (Session 7).** Booking-tool refresh (`refresh-booking-tool-messages`) toast "Updated **5 of 6**"; read-only proof: locked slot-4 LLM frozen (`1782381372457`) while slots 5/6/7 LLM timestamps bumped → only the locked setter skipped. The other bulk loop (`set-voicemail`) also skipped slot 4 (in-set + locked → skipped before PATCH); its "partial" toast is the **separate** pre-existing voicemail bug **VM-1**, not an F9 issue.
- [x] **F9 Pull from Retell + drift.** — **PASS 2026-06-28 (Session 7).** First Pull → `retell_synced_version=11`, snapshot populated, `booking_tools_present=true`, chip "In sync". Edited the agent in Retell + published (live version → 13) → chip "Drifted · pull" (live 13 > synced 11). Re-Pull → `retell_synced_version=13`, snapshot refreshed, "In sync". All DB-verified.
- [ ] **F9 outbound still dials while locked.** Place a test outbound call on the locked setter → the call **still places** (voicemail PATCH skipped; `make-retell-outbound-call` logs "is Retell-locked — skipping voicemail PATCH").
- [ ] **F9 unlock resumes BFD management.** Click **Unlock** → dialog warns the next Save overwrites Retell + offers **Pull from Retell first**. Unlock → badge clears, Edit reopens the editor, and a rename/Save now succeeds (no 423).
## Overnight frontend-only build — F11 / UI-1 / INB-1 (shipped 2026-06-29; frontend-only, Railway auto-deploy, NO edge deploy — edge versions UNCHANGED)

> Cosmetic/polish + one binding fix. Hard-refresh app.buildingflowdigital.com first. None of these touch live Retell/DB at render time.

- [ ] **F11 masked "Configured" indicator** — on **API Credentials** (and the **Setup Guide** dialog), a configured secret shows a fixed-length dot-mask `••••••••••••` in the (still-blank-on-edit) box + a bolder **"Configured ✓"**. Confirm: clicking into the box clears the mask (blank), typing a new key + Save still works, and a blank Save still shows the "no change / unchanged" guard (never writes dots). **Supabase Personal Access Token** + **OpenRouter Management Key** read **(Optional)** and do NOT show the red "Not Configured" pulse when empty.
- [ ] **UI-1 plain setter labels** — AI Rep Config → **Voice Setter Names**: the four slots read plain **"Setter 1 / Setter 2 / Setter 3 / Setter 4"** (no "· Inbound/Outbound/Followup" suffixes). Custom names still save + push.
- [ ] **INB-1 inbound rebind pins `latest_published`** — use the inbound toggle to move the inbound setter, then check the Retell inbound phone binding: `inbound_agents[].agent_version` is now `"latest_published"` (not versionless / not a numeric pin), so inbound auto-follows future publishes. (Pairs with the B-3 outbound auto-follow check.)

## Retests after the relevant fix ships

- [ ] **B-3 (6.4)** clear a lead's phone, Save → it stays cleared in BFD **and** GHL (only the name case was retested before).
- [ ] **B-4 (6.2)** client-role login — after a test client-role user is provisioned, confirm it lands on its own dashboard and is RLS-scoped.
- [ ] **B-5 / `{{first_name}}`** — a real inbound call from a number NOT in the CRM → the agent omits the name and never says the literal `{{first_name}}` (code-confirmed via the inbound webhook; verify live, and re-verify after the default-vars net ships).
- [ ] **Calls latency** (optional) — re-measure outbound dispatch latency during the smoke; believed resolved (platform/region incident).

## Standing rule

- After **any** BUG or FEATURE ships, smoke the touched area before marking it done here.
