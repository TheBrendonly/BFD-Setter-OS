---
description: Session handoff 2026-06-24 — Session-1 security+reliability hardening (B3 receive-dm-webhook fail-closed, B4 send-idempotency, B5 ApiCredentials guard, S2b-5 campaign-enroll rate-limit+dedup) is DONE, merged to main fa12f63, deployed live; lists what's verified and the open follow-ups.
---

# Handoff 2026-06-24 — Session-1 hardening DONE (merged to main)

## TL;DR
Session-1 (security + reliability hardening) is complete. 5 commits, **merged to `main`
`fa12f63`** (fast-forward) and pushed to BOTH `origin` (Forgejo) and `github`. Everything
deployed live + verified read-only. No code left uncommitted. Repo: `/srv/bfd/Projects/bfd-setter`.
Supabase ref `bjgrgbgykvjrsuwwruoh`; creds in `./.env` (`SUPABASE_PAT`, `TRIGGER_DEPLOY_PAT`).

Branch `fix/session1-hardening-2026-06-24` left in place (not deleted). Memory:
`project_session1_hardening_2026_06_24`. Daily note: `Operations/daily-notes/2026-06-24.md`.

## What shipped (all live)
| Item | Change | Deploy | Commit |
|---|---|---|---|
| **B5 / S6-5** | `ApiCredentials` routes (`App.tsx:264` + legacy `:278`) wrapped in `<AgencyRoute>` | Railway on push | `c2ca528` |
| **B3** | `receive-dm-webhook` fail-closed: client-lookup + webhook-auth **hoisted ahead of all side-effects**; NULL `ghl_webhook_secret` → 403 behind `DM_WEBHOOK_REQUIRE_SECRET` (default ON, set `false`=kill-switch). New `auth.ts` + Deno test | edge v18 ACTIVE | `a571aad` |
| **S2b-5 / E** | `campaign-enroll-webhook` per-token rate-limit (`webhook_rate_limits` + `bump_rate_limit` RPC, 429 over `ENROLL_RATE_LIMIT_PER_MIN`=60) + `normalized_phone` 5-min dedup (`dedup.ts` + test) | edge v13 ACTIVE | `5ebb5c9` |
| **B4** | send-idempotency for `sendFollowup` + `processMessages` via `outbound_send_claims` (claim-before-send, release-on-fail). Keys `followup:<timer_id>` / `dm:<execution_id>:<bubble_index>` | Trigger `20260624.1` | `26a7e2f` |
| **docs** | `Docs/BUG_LIST.md` updated; `fetch-thread-previews` = no live caller → latent **E-1**, not fixed | — | `fa12f63` |

Migrations applied live (Mgmt API, no schema_migrations table): `20260624120000_webhook_rate_limits`,
`20260624130000_outbound_send_claims`. Tests: 9 deno + 8 node green.

## Verified this session (read-only)
- B3: OPTIONS 200; wrong `x-wh-token` → 403 (auth gates before any side-effect); unknown account → 400.
  Fail-closed branch isn't live-triggerable (e467dabc HAS the secret; b0e4f199 has no `ghl_location_id`).
- S2b-5: `bump_rate_limit` increments; an over-seeded bucket → 429 with **zero enrollment**.
- B4: `outbound_send_claims` PK rejects a duplicate `send_key` (23505).

## Open follow-ups (NOT done — next session)
1. **Live B4 retry smoke** — real cadence SMS + an induced Trigger retry to confirm no double-send E2E
   (the unit + DB-level proof is done; only the live retry path is unexercised).
2. **Sibling GHL webhooks share B3's fail-open class** — `sync-ghl-contact`, `ghl-tag-webhook`,
   `bookings-webhook`, `sync-ghl-booking`, `workflow-inbound-webhook` are still "verify-if-present".
   Broader S1 follow-up (apply the same hoist + fail-closed pattern).
3. **Still-planned Tier-B** (need a Brendan nod): **B1** SubscriptionGate is cosmetic-only (no server-side
   `subscription_status` enforcement), **B2** Stripe cluster (webhook idempotency, cancel-lock, wrong-client
   activation, customer-by-email), **B5/S1-1** secret columns to the browser (architectural —
   `clients_public` view / column GRANT).
4. Minor: retire the deprecated `?token=`/body fallback on `campaign-enroll-webhook` once GHL configs move to
   the header. And a pre-existing `executionId: string|null` deno-check error in receive-dm-webhook (present on
   main, esbuild-tolerated) left untouched.

## Notes
- The kickoff prompt referenced a handoff `2026-06-24-next-sessions-B-C-D-E.md` that does NOT exist on disk;
  SESSION-1 scope was reconstructed from `Docs/BUG_LIST.md` + memory.
- Parallel session (other untracked handoffs) covered the GHL Conversations-provider POC + a calls runbook —
  separate workstream, not touched here.
