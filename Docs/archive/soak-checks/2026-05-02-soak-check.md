> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../../README.md) and
> [`Docs/SESSION_PLAN.md`](../../SESSION_PLAN.md).

---
# Soak-Check — 2026-05-02

**Soak window:** Day 2 of 14 (native cutover: 2026-04-30 per phase-9-bfd-native-cutover)
**Phase context:** phase-11i-diff-harness is the latest soak-relevant tag; most recent commit is `28494d8` (phase-night-ghl-push-gap-1 docs pin, 2026-05-02).

---

## Check 1 — BFD client config (`use_native_text_engine`, `dm_enabled`)

```sql
SELECT use_native_text_engine, dm_enabled
FROM clients
WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';
```

**Result: BLOCKED** — `SUPABASE_PAT` environment variable is not set (zero-length).
The Management API call could not be made.

**Context from CHANGES_LOG:** Phase-9 (`a7b66f3`, 2026-04-30) executed
`UPDATE clients SET use_native_text_engine=true WHERE id='e467dabc-...'` and
recorded this as the start of the 14-day soak window. No subsequent revert
commit exists in git log. Flag is *presumed* true but could not be verified live.

**Interpretation:** ⚠️ UNVERIFIED (cannot confirm without DB access)

---

## Check 2 — Probe results (last 48 h)

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE passed)     AS passes,
       count(*) FILTER (WHERE NOT passed) AS fails
FROM probe_results
WHERE ran_at > now() - interval '48 hours';
```

**Result: BLOCKED** — `SUPABASE_PAT` not set.

**Interpretation:** ⚠️ UNVERIFIED — pass rate cannot be calculated.

---

## Check 3 — Error logs (last 48 h, key sources)

```sql
SELECT created_at, source, error_type, substr(error_message, 1, 160)
FROM error_logs
WHERE source IN ('process_setter_reply','process-messages','process_messages',
                 'synthetic-probe','run_engagement')
  AND created_at > now() - interval '48 hours'
ORDER BY created_at DESC
LIMIT 30;
```

**Result: BLOCKED** — `SUPABASE_PAT` not set.

**Interpretation:** ⚠️ UNVERIFIED — cannot confirm zero `process_setter_reply` errors.

---

## Check 4 — n8n endpoint probe

**Command:**
```
curl -s -o /dev/null -w '%{http_code}' -X POST \
  'https://primary-production-392b.up.railway.app/webhook/n8n-ai-lead-setter?
   Message_Body=hi&Lead_ID=fake&Contact_ID=fake&
   GHL_Account_ID=xo0XjmenBBJxJgSnAdyM&Name=probe&
   Email=probe@example.com&Phone=%2B61400000000&Setter_Number=1'
```

**Result: HTTP 403**

**Interpretation:** ❌ FAIL — The n8n webhook is rejecting the probe request.
Possible causes:
- n8n webhook authentication/IP-allowlist blocking unauthenticated probes
- Railway cold-start + auth middleware returning 403 before workflow executes
- GHL_Account_ID or other param no longer accepted by n8n route logic
- n8n workflow was disabled or the route was changed

This is the legacy path — BFD is now on the native engine — so 403 may be
expected if Brendan intentionally locked the webhook. However, it could also
indicate n8n is degraded, which matters if the native engine ever needs to
fall back, or if other clients still use n8n.

---

## Summary Table

| Check | Query / Action | Raw Result | Status |
|-------|---------------|-----------|--------|
| 1. BFD `use_native_text_engine` | SELECT from clients | N/A (no PAT) | ⚠️ BLOCKED |
| 2. Probe pass rate 48 h | SELECT from probe_results | N/A (no PAT) | ⚠️ BLOCKED |
| 3. Error logs 48 h | SELECT from error_logs | N/A (no PAT) | ⚠️ BLOCKED |
| 4. n8n endpoint | HTTP POST to webhook | `403` | ❌ FAIL |

---

## Recommendation: (B) Investigate n8n / debug native

**Reason:**

1. **DB checks blocked** — `SUPABASE_PAT` was not available in the runtime
   environment. Checks 1–3 could not execute. The native flag, probe pass rate,
   and error log status are all unverified. The soak cannot be declared healthy
   without these signals.

2. **n8n probe returned 403** — Even if BFD is fully on the native engine, a
   403 on the legacy webhook warrants investigation. If n8n is locked
   intentionally (e.g., auth added), document it. If it is degraded, confirm
   other clients are not impacted.

**Immediate actions for Brendan:**
- Set `SUPABASE_PAT` (a `sbp_*` Management API token) in the environment where
  soak-check runs (e.g., as a GitHub Actions/Railway secret or `.env` file).
  Re-run this script once the PAT is available.
- Investigate the n8n 403 — check Railway logs for the `n8n-ai-lead-setter`
  webhook and confirm whether the route requires authentication or has been
  intentionally restricted.

**Soak window status:** Day 2 / 14 — too early to certify Phase 10 regardless.
Continue monitoring; re-run with PAT set before next check.
