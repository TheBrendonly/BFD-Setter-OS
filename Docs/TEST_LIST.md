# BFD-Setter — Test List (verify after build + UI work)

Everything that needs live verification. Brendan runs these **after all build + UI work is done** (his call, 2026-06-25).
When an item passes, move it to `Docs/archive/COMPLETED_LOG.md`. When it fails, open a bug in `BUG_LIST.md`.

> **Session 7 TEST pass — phone-half done 2026-06-30.** The passed items moved to `COMPLETED_LOG.md`:
> B-4(6.2), F2c, G3-3, 6.11, 6.12b (call+SMS), the full **F9 lifecycle** (lock / bulk-skip / Pull+drift /
> outbound-dials-while-locked / unlock+rename-no-423), B-3(6.4), B4-call-side, latency, and the LIVE-A UI
> passes (F2b, F6, B-6×2). Bugs found → `BUG_LIST.md`: **BOOK-1/2/3, MODEL-1-HARDENING, SMS-OBS-1,
> PHONE-CLEAR-1** (+ the earlier F9-1, VM-1, INB-1, UI-1, API-DEPR-1). **MODEL-1 fixed live.** The items
> below are the **still-owed** live checks (best run after tonight's overnight Text-Setter repair lands).

## Go-live smokes (code deployed, never live-verified)

- [ ] **3.12 SMS booking** → text "can I book?" → slots → pick → `bookings.source='sms'` + `engagement_executions` ends (`stop_reason='booking_created'`); reschedule / cancel / callback over SMS; STOP mid-exchange is respected (not sent). **BLOCKED on BOOK-1** (the setter currently fabricates "booked out" and never books on an open calendar — `BUG_LIST.md`); re-test after the overnight Text-Setter repair ships.
- [~] **bug-sweep UI** — 6.1 + 6.3-visual already PASS (→ COMPLETED_LOG). **Still owed → LIVE-D:** the **manual SMS send + 429-retry** (real text from the UI; confirm it sends and a 429 path retries).

## Reliability

- [ ] **B4 send-idempotency** — induce a Trigger retry on a real cadence SMS → confirm **no double-send** end-to-end (unit + DB-level proof already done). _Call-side send-once verified live 2026-06-30 (exactly one dial); the SMS-retry-idempotency leg stays here (inducing a live Trigger retry manually is impractical)._

## Session 4 — client visibility + cadence controls (2026-06-26)

> F1 shipped (sync-ghl-contact **v24** + `clients.ghl_conversation_link_field_id`; field provisioned 2026-06-28, id `4tDL3asiRNrQD3MKyP2E`). **F3 + F4 were already built** (F3 = `4b7dbc1`, F4 = `b0c6bea`). These are the still-owed live E2Es.

- [ ] **F1 — GHL conversation deep-link.** Create a **fresh** GHL contact that posts to `sync-ghl-contact` (note: `sync-ghl-contact` fires on a **tag-add / intake workflow**, not bare contact creation) → on the new GHL contact, the "BFD Conversation Link" field holds `https://app.buildingflowdigital.com/leads/<uuid>`; clicking it opens BFD's conversation view (`ContactDetail.tsx`) for that lead; **exactly one** write, and **no second SMS send** (BFD's own number stays the sole sender). Before the field id is set, lead creation still works and the `sync-convo-link` step shows **"skipped"** (dormant, non-fatal).
- [ ] **F3 — pause / resume a running cadence (live-runtime E2E).** Start a test cadence to TEST_PHONE_A (+61405482446). On a **running** execution, click **PAUSE** before step 2 → `engagement_executions.status='paused'`, and **no sends** occur while paused (check DB + Trigger run logs; the `isPaused()` boundary-exit returns `{status:'paused'}` without finalizing metrics). Click **RESUME** → status back to `running`, the cadence continues from the same step (`last_completed_node_index+1`), **no double-send** of the already-sent step. END NOW on a paused exec still cancels cleanly.
- [ ] **F4 — timezone-aware cold-reply nudge.** With a cold lead (silent after an outbound, within the recovery window) whose client `timezone` makes the **local** hour outside 9am–8pm: the hourly `nudgeColdReply` run **skips** it that hour (no SMS) and nudges it on a later in-window hourly run; an in-window lead nudges normally. (Gate is per-client `clients.timezone` via `Intl.DateTimeFormat`, `nudgeColdReply.ts`.) _LIVE-E plan: Claude sets `clients.timezone` out-of-window + manually triggers `nudgeColdReply` (avoids waiting two hourly crons), then in-window, then restores `Australia/Sydney`._

## Session 5 — by-phone pivot / B-2 (shipped 2026-06-26: receive-twilio-sms v29, process-lead-file v14, migration 20260627120000 applied; NO Trigger redeploy)

> Most of B-2 was already live from Spec 1. Session 5 added: (1a) deterministic GHL pick on the inbound fallback, (1b/1c) resilient miss-path (mint `bfd-<phone>` internal lead + background repoint), and (2) the CSV-import `normalized_phone` fix + backfill. Server-side confirmed at ship. These are the still-owed live behavioral checks (LIVE-D). _Claude drives the GHL-outage sim: set a bad `ghl_api_key` via Mgmt API, then restore the real `pit-…` value._

- [ ] **B-2 CSV `normalized_phone`** — import a CSV with an AU phone (e.g. `0405482446`) → the new `leads` row has `normalized_phone='+61405482446'` (Mgmt API). Then an inbound SMS from that number resolves **internal-first** (no new GHL contact minted, no second `leads` row); `receive-twilio-sms` logs `internal lead resolved by normalized_phone`. Also: a UI STOP on that CSV lead now fans out by phone (it was previously invisible to the fan-out).
- [ ] **B-2 inbound never dropped on a GHL outage** — temporarily break GHL resolution (bad `ghl_api_key`) and send an inbound SMS from a number **not** in the CRM → the lead still gets a setter reply (Twilio-direct), a `leads` row exists with `lead_id='bfd-+61…'` + correct `normalized_phone`, and `error_logs` shows `ghl_contact_resolve_degraded` (warning), **not** `ghl_contact_resolve_failed`. A malformed/un-normalizable inbound number still logs `ghl_contact_resolve_failed` + drops (intended).
- [ ] **B-2 background repoint converges, no dup** — after the above, restore GHL and send one more inbound (or wait for the same-request reconcile) → the synthetic row's `lead_id` becomes the real GHL contact id; `message_queue`/`dm_executions`/`active_trigger_runs` for that thread now key off the real id; a later `sync-ghl-contact` webhook **UPDATEs** (no 2nd `leads` row). Spot-check: `select client_id,lead_id,count(*) from leads where lead_id like 'bfd-%' group by 1,2 having count(*)>1` → 0 rows.
- [ ] **B-2 deterministic GHL pick** — for a phone that has >1 GHL contact (if you can stage one), repeated inbound sends resolve to the **same** (most-recently-updated) GHL contact every time — no flapping.

## Session 6 — secret-read hardening / G3-6 (shipped 2026-06-26: analyze-metric v18, analytics-v2-suggest-widgets v14, get-openrouter-usage v1 NEW, get-chat-history v7)

> Defense-in-depth: ~20 browser flows now read presence-only or route through an edge fn. Verified at ship: tsc/build/deno green, all 4 fns ACTIVE. **Q2 decision (2026-06-30): test everything now** — Claude to discover BFD's external chat table + set `clients.supabase_table_name` (currently null) before the live re-test.

- [ ] **G3-6 analytics features still work (Tier 3).** With BFD (external Supabase + OpenRouter configured): **ChatAnalytics** time-series renders over a date range (via `get-chat-history` mode:range), **Contacts** last-interaction timestamps populate (via `fetch-thread-previews`), **custom-metric AI analysis** returns matches (via `analyze-metric` server-side), **AnalyticsV2 / CreateMetricDialog** widget suggestions work (via `analytics-v2-suggest-widgets`), and the **OpenRouter usage** panel loads (via `get-openrouter-usage`).

## Overnight frontend-only build — F11 / UI-1 / INB-1 (shipped 2026-06-29; frontend-only, NO edge deploy)

> Cosmetic/polish + one binding fix. Hard-refresh app.buildingflowdigital.com first.

- [ ] **F11 masked "Configured" indicator** — on **API Credentials** (and the **Setup Guide** dialog), a configured secret shows a fixed-length dot-mask `••••••••••••` in the (still-blank-on-edit) box + a bolder **"Configured ✓"**. Confirm: clicking into the box clears the mask (blank), typing a new key + Save still works, and a blank Save still shows the "no change / unchanged" guard (never writes dots). **Supabase Personal Access Token** + **OpenRouter Management Key** read **(Optional)** and do NOT show the red "Not Configured" pulse when empty.
- [ ] **UI-1 plain setter labels** — AI Rep Config → **Voice Setter Names**: the four slots read plain **"Setter 1 / Setter 2 / Setter 3 / Setter 4"** (no "· Inbound/Outbound/Followup" suffixes). Custom names still save + push.
- [ ] **INB-1 inbound rebind pins `latest_published`** — use the inbound toggle to move the inbound setter, then check the Retell inbound phone binding: `inbound_agents[].agent_version` is now `"latest_published"` (not versionless / not a numeric pin), so inbound auto-follows future publishes.

## Retests after the relevant fix ships

- [ ] **B-5 / `{{first_name}}`** — a real inbound call from a number **NOT** in the CRM → the agent omits the name and never says the literal `{{first_name}}`. (NB: TEST_PHONE_A is a known lead, so B-5 needs a genuinely unknown number.)

## Standing rule

- After **any** BUG or FEATURE ships, smoke the touched area before marking it done here.
