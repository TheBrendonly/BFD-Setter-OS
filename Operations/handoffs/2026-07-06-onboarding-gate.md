---
description: Step-by-step record of the 2026-07-06 end-to-end new-client onboarding dry run (the onboarding gate) - method, each step, what passed, gaps found, and cleanup.
---

# Onboarding Gate — end-to-end new-client dry run (2026-07-06)

**What this is:** the durable record of the autonomous run that stood up a brand-new client through the
LIVE app to find holes across every onboarding touchpoint. Findings + fixes are tracked elsewhere; this
doc is the narrative of *how the run went, step by step*.

- **Findings (filed):** `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md` + BUG_LIST ONBOARD-1/2, GOLIVE-1,
  ACCESS-1, ONBOARD-3.
- **Fixes (built same day, next session):** `Operations/handoffs/2026-07-06-onboarding-fix.md`
  (commits `9f5b959`..`bb6322a` — all five bugs fixed; webhook-manifest v3 live).
- **Gate-run commit:** `d8e1aa0` (docs only; pushed origin + github).

**Goal:** prove a brand-new client can be stood up, find holes across every touchpoint, and produce the
"what a real first client needs" answer. Driven autonomously against the LIVE app + platform DB via
Playwright + Management-API + Retell REST. Throwaway created and fully deleted.

## Setup — the harness unlock
The saved agency Playwright session (`storageState.json`) was ~17h old and its access token had
expired. Instead of needing a fresh TOTP, refreshing the stored **refresh token** via
`POST /auth/v1/token?grant_type=refresh_token` with the anon key returned a fresh `aal2` (MFA-satisfied)
token — so the whole UI-driven run needed **no human TOTP**. Wrapped in a reusable `sess.mjs`
(ensureFresh + SQL + REST helpers). Confirmed the session drove the live agency dashboard.

## Step 1 — Create the sub-account via the real UI
- The actual "New Sub-Account" flow is `CreateClient.tsx` at `/client/:id/create-client` (not
  `Onboarding.tsx`, which is only the first-account welcome form).
- Drove the wizard with real clicks: name/email/description, toggled **"Create Sub-Account Login" =
  Yes**, filled the client login, submitted → redirected to `/settings`; throwaway client `cd853222…`
  created, plus a client-role user created **directly via `create-client-user` (no SMTP)**.
- DB assertions on the new row surfaced the first gaps: `use_native_text_engine=false`,
  `subscription_status=free`, and the wizard captures only name/email/description/logo.

## Step 2 — Full setter setup + API-DEPR-2(a)
- Brought the throwaway to a workable state (authorized test writes): `subscription_status=active`,
  `use_native_text_engine=true`, timezone, and set its `retell_api_key` to BFD's own key so a push
  would create a **throwaway** agent (zero risk to the 5 canonical agents).
- Mapped the save/push flow (Explore agent + source): `save-external-prompt` **hard-400s without
  external Supabase**, but `retell-proxy` (the Retell push) needs only `retell_api_key`.
- **Reproduced the UI's `sync-voice-setter` push with the real agency JWT** on the throwaway (body
  shape from `PromptManagement.tsx:6086`) → created agent `agent_c09e76046…`. `get-agent` confirmed
  **API-DEPR-2(a)**: `post_call_analysis_data` = 3 `system-presets` (`call_summary`/`call_successful`/
  `user_sentiment`) + 6 custom, **no dupes**, deprecated `analysis_*_prompt` **absent**. Plus
  **born-bookable** (5/5 booking tools, per-tenant `voice-booking-tools` URL) and webhook auto-set.
- **VM-1 voicemail push** on the fresh agent: `set-voicemail` → `voicemail_set` (patched 1/1); agent
  flipped hangup → static_text.
- **Text setter** save reproduced the block live: HTTP 400 "Client Supabase credentials not configured."

## Step 3 — Exercise E2E (the provisioning reality)
- `intake-lead` (the SOP §7.1 dry-run) returned **409 "Client has no GHL credentials configured"** —
  lead ingress is GHL-gated.
- The **go-live manifest returned `goLiveReady: true`** for the completely blank client. Traced: it
  only checks that the auto-minted `ghl_webhook_secret` exists, not that anything is actually wired.
- Conclusion: signed SMS booking, outbound voice booking, cadence, analytics, and F1 are all
  **hard-gated on GHL + Twilio + external Supabase** being provisioned first — which the throwaway
  (correctly) doesn't have and which was not faked into BFD's live infra. This is the "what a real
  first client needs" answer.

## Step 4 — F13 client-eye (the other carryover)
- Logged in as the real client-role user (password grant, `aal1`, no MFA) — lands on a working trimmed
  dashboard, no paywall.
- 4-toggle matrix through `get-client-usage` as the **client JWT**: all-off → `{show:false}`, each
  toggle exposes only its own figure, all-on → all four, and the **agency JWT always sees the full
  margin payload**. UI mirror on `/account-settings`: "Usage & Billing" card present all-on, **absent
  all-off**. Server-enforced whitelist confirmed. **F13 client-eye closed.**
- Confirmed **ACCESS-1**: `/credentials` and `/settings` redirect a client to the dashboard, but
  `/prompts/voice` does **not** — the setter editor loads for a client.

## Step 5 — Gap report + filing
- Wrote `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md`; filed **ONBOARD-1/2, GOLIVE-1, ACCESS-1,
  ONBOARD-3** to BUG_LIST; the un-automated provisioning checklist to BRENDAN_TODO; a findings note to
  SOP §11; marked **API-DEPR-2(a) + F13 client-eye** done in TEST_LIST.

## Step 6 — Cleanup + close-out
- Deleted the Retell agent + LLM (204), `client_pricing_config`, `voice_setters`, the client row, and
  the auth user (cascaded profiles/user_roles). **Verified 0 remaining** throwaway clients/users; the 5
  canonical agents all present. No leads/bookings were ever created.
- Committed docs (`d8e1aa0`), pushed origin + github, wrote memory + daily note, prepared the
  onboarding-fix next-session prompt.

## Bottom line
The platform **can** stand up a voice-booking client — voice setter push, voicemail push, and the F13
billing view all work on a fresh client — but **not through one guided UI flow**. The real blockers to
a first client were: the UI-created client's **dead SMS engine** (ONBOARD-1, High), the **false-positive
go-live signal** (GOLIVE-1), **external Supabase + Twilio being manual/un-editable**, and lead flows
being **GHL-gated**. The code-fixable ones (ONBOARD-1/2/3, GOLIVE-1, ACCESS-1) were all closed the same
day in the onboarding-fix pass; the remaining prerequisites (external Supabase provisioning, GHL, Twilio
BYO, canonical text model) are provisioning steps tracked in BRENDAN_TODO.
