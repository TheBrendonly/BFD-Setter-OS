# BFD 14-day soak check — 2026-05-13

**Verdict:** INCOMPLETE_DATA

**Reason:** All monitoring queries were blocked at the network level. Both the Supabase Management API (`https://api.supabase.com/v1/projects/bjgrgbgykvjrsuwwruoh/database/query`) and the Supabase project REST endpoint (`https://bjgrgbgykvjrsuwwruoh.supabase.co/rest/v1/`) returned `HTTP 403 Host not in allowlist` for every request, including the refresh call and all six monitoring queries. The Trigger.dev API (`https://api.trigger.dev/`) returned the same 403. The sandbox runner IP is not in either service's IP allowlist. The `SUPABASE_PAT` and `TRIGGER_DEPLOY_PAT` environment variables are both present and non-empty; the block is network-level, not credential-level.

**Action required (Brendan):** Re-run this soak check from a trusted IP (your local machine, Railway, or a whitelisted CI runner) using the same script / queries below. Alternatively, add the runner IP to the Supabase project's network restrictions. The soak window started 2026-04-30 (HEAD `3865879`), so the 14-day window closes 2026-05-14 — there is still ≥ 1 day to collect a clean reading.

---

## Sanity (Q4)

**BLOCKED** — 403 Host not in allowlist. Query that should have run:

```sql
SELECT use_native_text_engine,
       auto_engagement_workflow_id IS NOT NULL AS auto_enroll_set,
       dm_enabled
FROM clients
WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';
```

Expected (from CHANGES_LOG.md phase-9 + phase-night-a7):
- `use_native_text_engine = true` (set 2026-04-30, phase-9)
- `auto_enroll_set = true` (set 2026-05-06, phase-night-a7)
- `dm_enabled = false` (never flipped in CHANGES_LOG)

Cutover status per changelog: **both flags appear to have been set** based on commit history. However, live DB confirmation is required for a PASS verdict.

---

## Funnel (Q1)

**BLOCKED** — 403 Host not in allowlist. Query that should have run:

```sql
SELECT * FROM cadence_funnel
WHERE client_id = 'e467dabc-57ee-416c-8831-83ecd9c7c925'
  AND day >= now() - interval '14 days'
ORDER BY day DESC;
```

Pass threshold: ≥ 7 days of data with `leads_replied / leads_texted >= 5%` on average.

Note: `sms_delivered` in `cadence_funnel` is now authoritative post phase-11f (2026-04-30) because cadence SMS now goes via direct Twilio `Messages.create` with `StatusCallback` to `/twilio-status-webhook`. Any data before 2026-04-30 will show undercount in `sms_delivered`.

---

## SMS errors (Q2)

**BLOCKED** — 403 Host not in allowlist. Query that should have run:

```sql
SELECT status, error_code, count(*)
FROM sms_delivery_events
WHERE client_id = 'e467dabc-57ee-416c-8831-83ecd9c7c925'
  AND received_at > now() - interval '14 days'
  AND status IN ('failed','undelivered')
GROUP BY 1,2
ORDER BY 3 DESC;
```

Pass threshold: terminal failures < 1% of total sends (estimate sends from `cadence_funnel.leads_texted`).

---

## Native-path errors (Q3)

**BLOCKED** — 403 Host not in allowlist. Query that should have run:

```sql
SELECT source, count(*)
FROM error_logs
WHERE source IN (
  'process-setter-reply','run-engagement',
  'ghl-tag-webhook','make-retell-outbound-call'
)
  AND created_at > now() - interval '14 days'
GROUP BY 1
ORDER BY 2 DESC;
```

Pass threshold: 0 OR < 5 rows total across all listed sources over 14 days.

---

## Cadence terminal-state distribution (Q6)

**BLOCKED** — 403 Host not in allowlist. Query that should have run:

```sql
SELECT stop_reason, count(*)
FROM cadence_metrics
WHERE client_id = 'e467dabc-57ee-416c-8831-83ecd9c7c925'
  AND ended_at > now() - interval '14 days'
GROUP BY 1
ORDER BY 2 DESC;
```

Expected stop_reasons: `sequence_complete`, `inbound_reply`, `booking_created`, `opt_out`, `cancelled`, `error`.

---

## Synthetic probe health (Q5)

**BLOCKED** — 403 Host not in allowlist. Queries that should have run:

```sql
SELECT date_trunc('day', ran_at) AS day,
       count(*) FILTER (WHERE passed) AS passes,
       count(*) FILTER (WHERE NOT passed) AS fails
FROM probe_results
WHERE ran_at > now() - interval '14 days'
GROUP BY 1 ORDER BY 1 DESC;

SELECT ran_at, passed, error_message
FROM probe_results
WHERE ran_at > now() - interval '14 days'
  AND NOT passed
ORDER BY ran_at DESC LIMIT 20;
```

Pass threshold: ≥ 95% pass rate over 14 days. Skip (with note) if `probe_results` is empty.

Note: phase-11g shipped the `probe_results` table and `synthetic-probe` Trigger.dev task 2026-04-30. Whether Brendan provisioned the probe client row + env vars per `Docs/RUNBOOK.md §Synthetic probe setup` is unknown from the changelog.

---

## Trigger.dev failures

**INCOMPLETE** — `TRIGGER_DEPLOY_PAT` is present but the Trigger.dev API also returned `HTTP 403 Host not in allowlist`. Could not fetch run history for `process-setter-reply`, `run-engagement`, `place-outbound-call`, or `synthetic-probe`.

Pass threshold: < 5% failure rate over last 14 days for the above tasks.

---

## Recommendation

**Brendan to re-run from a trusted IP before Phase 10 decommission.**

The soak window closes 2026-05-14 (14 days after HEAD `3865879` on 2026-04-30). The automated queries could not execute from this runner because the Supabase project and Trigger.dev project both have IP allowlists that exclude the sandbox environment.

To re-run:
1. From a machine with Management API access, POST each query to `https://api.supabase.com/v1/projects/bjgrgbgykvjrsuwwruoh/database/query` with `Authorization: Bearer $SUPABASE_PAT`.
2. Evaluate against the PASS criteria in §Step 4 of the soak check prompt.
3. If PASS: proceed with Phase 10 steps below.

---

## If PASS — Phase 10 next steps

- Delete the n8n `else` branch in `trigger/processMessages.ts:191-218` (the existing branch on `client.use_native_text_engine`)
- Optional: `ALTER TABLE clients DROP COLUMN text_engine_webhook;`
- Decommission the n8n service on Railway
- Tag `phase-10-n8n-gone`
