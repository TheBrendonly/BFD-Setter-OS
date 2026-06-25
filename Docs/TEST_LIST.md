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

## Retests after the relevant fix ships

- [ ] **B-3 (6.4)** clear a lead's phone, Save → it stays cleared in BFD **and** GHL (only the name case was retested before).
- [ ] **B-4 (6.2)** client-role login — after a test client-role user is provisioned, confirm it lands on its own dashboard and is RLS-scoped.
- [ ] **B-5 / `{{first_name}}`** — a real inbound call from a number NOT in the CRM → the agent omits the name and never says the literal `{{first_name}}` (code-confirmed via the inbound webhook; verify live, and re-verify after the default-vars net ships).
- [ ] **Calls latency** (optional) — re-measure outbound dispatch latency during the smoke; believed resolved (platform/region incident).

## Standing rule

- After **any** BUG or FEATURE ships, smoke the touched area before marking it done here.
