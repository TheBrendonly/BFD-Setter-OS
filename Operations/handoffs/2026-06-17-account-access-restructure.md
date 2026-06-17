---
description: Handoff for the 2026-06-17 account-access restructure build (client self-serve My Account over admin-governed sub-account fields) plus the multi-session repo state at time of writing.
---

# Account-Access Restructure — Handoff (2026-06-17)

## What this build is
Establishes a real **agency(admin) vs client(sub-account) permission boundary**. "My Account" becomes a client self-serve page over an **admin-governed subset** of sub-account fields; the full "Sub-Account Config" becomes agency-only; the admin governs (per sub-account) which My Account fields a client can **see** and **edit**, mirroring the existing `client_menu_config` control. (Build 5 from `Docs/NEXT_SESSION_BUILD_KICKOFF_2026-06-17.md`.)

Decisions locked with Brendan this session:
- Default field split = **Branding + prefs**.
- Governance granularity = **two switches per field (Visible + Editable)**.
- Admin surface = **keep Sub-Account Config as the agency-only deep-config page** + embed the governance editor there and in Manage Sub-Accounts.

Key fact that shaped it: the `clients` table is RLS **agency-only** (no client-role policy), so the old Sub-Account Config could never actually save for a client (latent-broken) and there were **no route guards** (only sidebar visibility). So this was a BUILD of the client path, not a rewrite.

## Status: SHIPPED + LIVE (commit `b1ad2e0`, on `main`, both remotes)
The plan file: `~/.claude/plans/bfd-setter-account-access-restructure-de-atomic-brooks.md`.

### DONE — code (14 files, commit `b1ad2e0`)
- **Migration** `frontend/supabase/migrations/20260617120000_client_account_field_config.sql` — new per-client `client_account_field_config` table (`fields jsonb`), mirrors `client_menu_config`; agency-manage-ALL + client-read-own RLS (via `public.get_user_client_id`).
- **types.ts** — surgical `client_account_field_config` block (no wholesale regen — multi-DB).
- **Edge fn** `frontend/supabase/functions/save-account-settings/index.ts` — single service-role chokepoint for a client to READ/WRITE the governed subset of their own `clients` row. Editable allow-set is **re-derived server-side** from the governance config (frontend `editable` is advisory only); read never leaks hidden-field values or secret columns; cost ceilings convert cents↔dollars; voicemail save forwards the caller JWT to `retell-proxy set-voicemail`.
- **Shared helper** `_shared/assert-client-access.ts` — added `resolveClientAccess` (returns `{userId, role}`); existing `assertClientAccess` delegates (no behavior change for other callers).
- **Governance hook + editor** `src/hooks/useClientAccountFieldConfig.ts` + `src/components/ClientAccountFieldConfigEditor.tsx` (Visible + Editable per field; hidden forces non-editable). Embedded in `ClientSettings.tsx` + `ManageClients.tsx`.
- **Client My Account** `src/components/ClientAccountSettingsCard.tsx` in `AccountSettings.tsx` (client-only). `ClientQuietHoursCard` + `ClientVoicemailCard` gained a backward-compatible client mode (`readOnly` / `initialValue` / `onPersist`) — agency direct-update path UNCHANGED.
- **Lockdown** — `ClientLayout.tsx` gates the "Sub-Account Config" sidebar entry to agency; `App.tsx` wraps `settings` / `manage-clients` / `create-client` in `AgencyRoute` (real route guard, not just sidebar visibility). Client Sign Out removed from `ClientSettings` (still on sidebar + My Account).

Default split (admin overrides per sub-account): **editable** = email, description, brand_voice, timezone, logo, quiet_hours; **read-only** = name; **hidden** = weekly/monthly cost ceiling, voicemail. (`logos` bucket already allows any authenticated upload — client logo works, no new policy.)

### DONE — live infra
- **Migration APPLIED** to platform DB `bjgrgbgykvjrsuwwruoh` via Management API + verified (table, RLS enabled, both policies present).
- **Edge fn DEPLOYED** (`save-account-settings` v1 ACTIVE, verify_jwt=false, in-fn auth). Auth probes pass: anon→401, missing client_id→400, anon save→401.

### DONE — verification
- `tsc --noEmit` clean, `vite build` clean, 2× `deno check` clean.
- 8-invariant adversarial review passed (no blockers/majors); 2 minor fixes applied (cost-ceiling read returns dollars to match save; cents validator fails loud).

## NEEDS DOING
1. **Full client-path E2E — GATED on a test client-role user (task 6.2).** Verify live: a client sees only visible fields, read-only ones disabled, editable ones save + persist; a forged patch of a non-editable/secret field is dropped server-side; a hidden field's value never reaches the client. Server enforcement is in place; this is the live round-trip.
2. **Agency UI smoke (doable now, no client user):** Manage Sub-Accounts → edit a sub-account → "My Account Field Access" editor toggles + Save + reload persists; confirm "Sub-Account Config" is gone from a client's sidebar and `/settings` + `/manage-clients` redirect a client.
3. **Keep the field-key contract in sync** between `useClientAccountFieldConfig.ts` (DEFAULT_ACCOUNT_FIELDS / ACCOUNT_FIELD_CATALOG) and the edge fn (FIELD_CATALOG / DEFAULT_ACCOUNT_FIELDS) when adding fields.

## Repo / multi-session state at handoff time
This is a **single shared working directory** (`/srv/bfd/Projects/bfd-setter`, one git) used by multiple concurrent Claude sessions — they share HEAD and the current branch. Checked out on `feat/account-access-restructure` @ `b1ad2e0`.

- **`origin/main` and `github/main` = `b1ad2e0`** (my commit). The account-access work **IS pushed to main on both remotes** (Forgejo `origin` + GitHub `github` → Railway prod frontend). I did not run `git push`; an external push (another session's sync/push on the shared HEAD) carried it up. Local `main` ref is stale (`eb53690`, "behind 2") — `origin/main` is authoritative.
- **Voice/docs session — COMMITTED + PUSHED:** `eb53690` fix(voice): book against GHL canonical free-slot strings (timezone-offset fix) + `56710a0` docs(run-through): 2026-06-17 run-through results + 2026-06-18 kickoff + FEATURE_ROADMAP + User Todos + BOOKING_SLOT_INVENTION_FIX prompt. Both are on main (ancestors of my commit).
- **Cadence-v2 / lead-lifecycle session — NOT committed (dirty in working tree), NOT pushed:**
  - New: `frontend/supabase/functions/transition-lead/index.ts`, `_shared/lifecycle.ts`, `_shared/lifecycle.test.ts`, `_shared/enroll-execution.ts`, migration `20260617140000_cv2_1_engagement_enrollments.sql`.
  - Modified: `frontend/src/pages/Workflows.tsx`, `frontend/supabase/functions/reactivate-lead/index.ts`, `trigger/nudgeColdReply.ts`, `trigger/runEngagement.ts`.
  - Confirmed not present in any commit on any branch. Its migration (`...140000`) sorts AFTER mine (`...120000`), so ordering is fine; coordinate before committing/applying it.

## Cautions
- **Shared-tree hazard:** because sessions share HEAD/branch, a `git commit` here can pick up another session's dirty files, and an external push can land it on main. Stage explicit paths; never `git add -A`.
- This handoff doc is currently **uncommitted**.
