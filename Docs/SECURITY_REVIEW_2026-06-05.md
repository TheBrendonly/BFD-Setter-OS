# Security Review — 2026-06-05

Whole-codebase security review of bfd-setter (1prompt-os). Platform project:
`bjgrgbgykvjrsuwwruoh`. Scope: 83 Supabase edge functions, Trigger.dev tasks, the
React/Vite frontend, SQL/RLS, config, secrets.

## Architecture facts that drive severity
- The browser talks to the platform DB directly with the **publishable/anon key**
  (`supabase.from('clients')` appears 40× in `frontend/src/`), so RLS is the only
  tenant boundary for direct reads.
- **All** of the edge functions reviewed deploy with `verify_jwt = false` (confirmed
  via the Management API) — they are public; the Supabase gateway does not gate them.
  Therefore in-function authorization is mandatory.
- Canonical auth helpers: `_shared/assert-client-access.ts` (JWT-signature + ownership)
  and the new `_shared/authorize-client-request.ts` (dual mode: internal service-role
  caller OR JWT owner of `clientId`).

## Findings & status

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| F0 | (gate) | Live platform RLS on secret tables | **VERIFIED OK** — `clients`/`leads`/`profiles`/`user_roles` RLS enabled + agency-scoped, 0 permissive policies |
| F1 | CRITICAL | Cross-tenant IDOR / secret theft in client-scoped edge functions | **FIXED** — 34 functions guarded with `authorizeClientRequest` |
| F2 | HIGH | Webhooks with missing/optional signature verification | **PARTIAL** — Stripe + Twilio-inbound fixed; GHL/Retell/Unipile/workflow = documented residual (see runbook below) |
| F3 | HIGH | SSRF in `notify-webhook` | **FIXED** — auth required + private/loopback/link-local/metadata blocked + `redirect: manual` |
| F4 | HIGH | Stored/reflected XSS in `EmailInbox.tsx` | **FIXED** — DOMPurify sanitization |
| F5 | MEDIUM | `github-proxy` open proxy spending server PAT | **FIXED** — auth required (note: the `GITHUB_PAT` itself is currently invalid/expired — rotate or remove) |
| F6 | MEDIUM | `USING(true)` RLS on `prompt_chat_threads`/`prompt_chat_messages` | **FIXED** — tenant-scoped migration applied + verified (owner sees rows, stranger sees none) |
| F7 | MEDIUM | Secret columns readable by browser via `clients` row | **DOCUMENTED** — agency-scoped (no cross-tenant), but in-agency browser reads include secrets; recommend column-restricting via view/RPC |
| F8 | MEDIUM | `getClaims()` auth + missing ownership (`sync-external-credentials`, `unipile-proxy`) | **FIXED** — `authorizeClientRequest` added |
| F9 | LOW | Log hygiene (Stripe key prefix + full header dump) | **FIXED** (stripe-webhook/checkout); broader error-echo cleanup remains low-priority |
| F10 | LOW | Committed anon JWT + project ref in 5 old cron migrations | **DOCUMENTED** — anon key is public-class; rotate the `awzlcmdomhtyqjabzvnn` anon key if that project is still live. No live secret is committed (`.env` untracked). |

## F1 fix pattern
`authorizeClientRequest(req.headers.get("Authorization"), clientId)` inserted after the
caller `clientId` is parsed and before any tenant secret read / external call / mutation.
It allows either (a) an internal caller presenting the service-role key as bearer
(Trigger tasks already do this — non-breaking) or (b) an end user whose agency/client
owns `clientId`. Functions verified already-safe and skipped: `twilio-list-numbers`,
`fetch-thread-previews`, `supabase-project-usage`, `check-client-subscription`,
`generate-ai-prompt`, `process-lead-file`, `create-client-user`, `update-client-password`,
`push-engagement-now`, `retry-dm-execution`, `refresh-usage-cache`,
`analytics-v2-suggest-widgets` (these either derive the tenant from the authenticated
user / an internal row, use an RLS-scoped client, or do an explicit agency check).

`chat-with-history` and `test-external-supabase` additionally stopped trusting
body-supplied Supabase service keys (`test-external-supabase` keeps body creds for the
"test before save" UX but constrains the URL to `*.supabase.co` to block SSRF).

## RESIDUAL — Webhook authenticity runbook (F2)
These inbound webhooks resolve the tenant from a payload identifier and currently accept
unauthenticated payloads (forgeable → fake leads / triggered cadences / data injection).
They cannot be closed by code alone: **0 of the live clients have the per-client webhook
secrets set**, and the upstream providers must be configured to send a signature/secret.
Enforcing without that breaks live ingress.

Affected: `sync-ghl-contact` (lead ingress), `sync-ghl-booking`, `ghl-tag-webhook`,
`bookings-webhook`, `receive-dm-webhook`, `workflow-inbound-webhook`, `unipile-webhook`,
`retell-call-webhook`, `retell-call-analysis-webhook`.

To close, per client:
1. Generate a strong secret; set the matching `clients.<provider>_webhook_secret`
   (`ghl_webhook_secret`, `unipile_webhook_secret`, `retell_webhook_secret`).
2. Configure the upstream to send it: GHL workflow custom-webhook header / Retell webhook
   signing / Unipile webhook secret.
3. Flip the handler from "verify-if-secret-present" to fail-closed (the GHL/Unipile/Retell
   handlers already verify when the secret is set; making it mandatory is then safe).
4. Smoke-test the live path end to end before moving to the next client.

## Deploy record
- 36 edge functions redeployed with `--no-verify-jwt` (preserving prior public state; the
  in-function guard now enforces auth).
- F6 migration `20260605120000_f6_prompt_chat_rls_tenant_scope.sql` applied to the live DB.
- Verification: per-function negative test (foreign/forged `clientId` → 401/403) + RLS
  simulation for F6.
