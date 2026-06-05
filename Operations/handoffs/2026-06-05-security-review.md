---
description: Session handoff for the 2026-06-05 whole-codebase security review — what was fixed, deployed, verified, and the open webhook-provisioning residual.
---

# Handoff — Security Review (2026-06-05)

**Commit:** `c2ca345` on `main` (pushed to Forgejo `origin` + GitHub). Previous HEAD `8d5a835`.
**Platform project:** `bjgrgbgykvjrsuwwruoh`. **Full writeup:** `Docs/SECURITY_REVIEW_2026-06-05.md`.

## What this session did
Whole-codebase security review (83 edge functions, Trigger tasks, frontend, SQL/RLS, secrets). Every
agent finding was verified against source before acting (several were false positives, dropped).

### Two facts that drove severity
- **Every reviewed edge function deploys `verify_jwt=false`** (confirmed via Management API) — they are
  PUBLIC, regardless of `config.toml`. The repo config does NOT reflect deployed verify_jwt state.
- The **browser reads the platform DB directly with the anon key** (`supabase.from('clients')` 40×), so
  RLS + in-function authorization are the only tenant boundaries.

### Fixed + deployed + verified
- **F1 (CRITICAL cross-tenant IDOR / secret theft):** new `_shared/authorize-client-request.ts`
  (dual-mode: internal `sb_secret_*` service-role caller — validated *functionally* via
  `auth.admin.listUsers`, not brittle string-equality — OR JWT owner of `clientId`). **34 client-scoped
  functions** guarded. `chat-with-history`/`test-external-supabase` stopped trusting body-supplied
  Supabase service keys.
- **F3 SSRF** (`notify-webhook`): auth + private/loopback/link-local/metadata blocking + `redirect: manual`.
- **F5** (`github-proxy`): auth required. (Its `GITHUB_PAT` is currently expired/invalid — rotate or remove.)
- **F4 XSS** (`EmailInbox.tsx`): DOMPurify.
- **F2 (safe parts):** `stripe-webhook` fails closed on missing signature; `twilio-inbound-sms` verifies
  the Twilio signature.
- **F6 RLS:** tenant-scoped `prompt_chat_threads`/`prompt_chat_messages` (was `USING(true)`). Migration
  `frontend/supabase/migrations/20260605120000_f6_prompt_chat_rls_tenant_scope.sql`, applied live + simulated.
- **F9:** removed Stripe key/header logging.

### Deploy + verification
- 36 functions redeployed with `supabase functions deploy <fn> --use-api --no-verify-jwt`
  (`--use-api` bundles server-side, ~6s/fn; default Docker path was >240s and hung). Script:
  `scripts/deploy_security_fixes.sh`.
- **Live tests:** anon-key attacker → `401` on every guarded function; valid service-role caller → `200`
  with real data (internal Trigger path preserved); F6 RLS simulated (owner sees rows, stranger sees 0).

## OPEN — Brendan to action (security residual)
- **Webhook authenticity (chose "ship safe, document"):** GHL/Retell/Unipile/workflow webhooks
  (`sync-ghl-contact` lead ingress, `sync-ghl-booking`, `ghl-tag-webhook`, `bookings-webhook`,
  `receive-dm-webhook`, `workflow-inbound-webhook`, `unipile-webhook`, `retell-call-webhook`,
  `retell-call-analysis-webhook`) are still forgeable — **0/2 live clients have the per-provider webhook
  secrets set**. Closing requires provisioning `clients.<provider>_webhook_secret` AND reconfiguring the
  upstream provider to send it, then flipping each handler to fail-closed. Runbook in the Docs file.
  **This is now also a NEW per-client onboarding step.**
- **github-proxy `GITHUB_PAT`** expired — rotate or remove the source-files feature.
- **F7 (low):** secret columns (`supabase_service_key`, api keys) are readable by in-agency browser users
  via the `clients` row (agency-scoped, not cross-tenant). Consider a column-restricted view/RPC.
- **F10 (low):** anon JWT + project ref `awzlcmdomhtyqjabzvnn` in 5 old cron migrations — rotate if live.

## Next-session pointers
- A mapping workflow was run this session to author (a) a functional-review prompt and (b) a new-client
  setup simulation prompt — see the chat output / the two prompts handed to Brendan.
- Smoke-test reminder: confirm the admin-panel flows that call the 34 guarded functions still work for a
  logged-in user (setter config save, simulation, prompt AI, Stripe portal). Negative+internal paths
  already verified server-side.
