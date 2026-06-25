---
description: Session handoff 2026-06-22 — the 2026-06-19 go-live backend deploy is DONE (5 edge fns + Trigger 20260620.3); now mid-build on the GHL SMS-in-Conversations proof-of-concept (display-only custom conversation provider), blocked on GHL developer-account enrollment. Plus remaining live smokes + [B] clarifications.
---

# Handoff 2026-06-22 — go-live DEPLOYED, GHL Conversations provider POC in progress

## TL;DR — where we are

1. **The 2026-06-19 go-live backend deploy is DONE and verified** (5 edge fns + one Trigger deploy). Nothing left to deploy.
2. **In progress:** standing up a GHL "SMS in Conversations" feature (item 6.12a) so BFD's Twilio-sent SMS show as chat bubbles in the GHL contact's **Conversations** tab instead of as **Notes**. We decided the approach and started the GHL setup. **Currently blocked** on finishing the GHL *developer-account* enrollment (a browser/Brave issue, now moving to Firefox).
3. **Still pending (Brendan-driven):** the live smoke tests for the deployed go-live work, and a few [B] items.

Repo: `/srv/bfd/Projects/bfd-setter`, branch `main` = `origin` = `github` = **`6842aff`** (clean; only the usual untracked `deno.lock` + an edited ops-wipe handoff). Supabase project ref **`bjgrgbgykvjrsuwwruoh`**. Creds in `./.env`: `SUPABASE_PAT`, `TRIGGER_DEPLOY_PAT`. Read-only DB via the Supabase **Management API** `/database/query` (NOT the postgres MCP). Do **not** edit voice prompts (report-only rule).

---

## PART A — Backend go-live deploy: DONE 2026-06-20 (do NOT redo)

Context: three parallel 2026-06-19 sessions (bug-sweep, §3.12 SMS tool parity, ghl-sync 6.11/6.12) were all merged to `main` `6842aff`. Only the backend deploy of the ghl-sync + ghl-conversations-rebundle pieces remained. Ground truth was verified live first (the handoffs contradicted each other).

**Already-true before this session (verified live, not redone):**
- Git already pushed (`main=origin=github=6842aff`).
- Migration `20260619120000` already applied — all 12 `clients.ghl_*_field_id` cols + `leads.last_sms_analyzed_at` exist. (This project has **no** `supabase_migrations.schema_migrations` table; schema is changed via raw Management-API SQL, never `supabase db push`.)
- `clients.llm_model` for `e467dabc` = `google/gemini-flash-latest` (clean).
- **12/12 GHL outcome field IDs wired** on client `e467dabc-57ee-416c-8831-83ecd9c7c925`.
- Bug-sweep edge fns already deployed (sync-ghl-contact v23, retell-proxy v42, campaign-enroll-webhook v11). The ghl-sync merge (`git diff a5d8bad..6842aff`) did NOT touch them → skipped.

**Deployed this session (all ACTIVE, `verify_jwt=false`):**
| Function | Result |
|---|---|
| `analyze-sms-conversation` | **v1** (NEW — created via `supabase functions deploy --use-api --no-verify-jwt`; `deploy_single_fn.mjs` can't create a new fn) |
| `retell-call-analysis-webhook` | v22 → **v23** (6.11/6.12 + ghl-conversations rebundle) |
| `receive-twilio-sms` | v26 → **v27** (rebundle) |
| `crm-send-message` | v13 → **v14** (rebundle) |
| `voice-booking-tools` | v19 → **v20** (rebundle, deployed last) |

Deploy method: `node --env-file=.env scripts/deploy_single_fn.mjs <slug>` for the 4 existing (bundles `_shared`, preserves `verify_jwt`); supabase CLI for the new one.

**Trigger.dev:** `20260620.2` → **`20260620.3`**, 12 detected tasks (the new `analyze-sms-conversations` hourly task + the 6.7 probe fix). Command: `TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy --env prod`. NOTE: `npx trigger.dev whoami` rejects the env token, but `deploy` authenticates fine with it.

**Worktrees:** removed merged `fix+bug-sweep-2026-06-19` (branch deleted) + `fix+ghl-sync-2026-06-19` (branch kept — 1 unmerged docs commit). Left `internal-by-phone-leads` (separate WIP).

Memory updated: `project_audit_reconciliation_2026_06_19`, `project_ghl_sync_6_11_6_12_6_13_2026_06_19`, `project_sms_tool_parity_3_12_built_2026_06_19`.

---

## PART B — GHL "SMS in Conversations" (item 6.12a): IN PROGRESS, blocked on dev enrollment

### Goal
BFD sends every SMS via its own Twilio. We want each message **mirrored into the GHL contact's Conversations chat thread** (bubbles), not GHL sending it. Today `clients.ghl_conversation_provider_id` is **NULL**, so `pushSmsToGhl` falls back to writing SMS as a contact **Note**. Setting a provider id flips it to the Conversations thread.

### Decision (researched 2026-06-22) — the approach
- **Build a free, PRIVATE, DISPLAY-ONLY custom SMS conversation provider.** A free GHL Private + Sub-Account marketplace app with an SMS conversation provider that has **no working delivery URL** and is **never set as the location's default SMS channel**. That guarantees GHL never sends through it (BFD's Twilio stays the sole sender).
- **Do NOT reuse the "Twilio For Conversations" app** the client already has installed (marketplace id `68a62d8f70e465835fa7af7e` on loc `xo0XjmenBBJxJgSnAdyM`). It is a **delivery** provider (replaces the default SMS channel, sends via the connected Twilio) → double-send vector; and borrowing its `conversationProviderId` with our own token is cross-app/unsupported.
- Code path is already correct: `pushSmsToGhl` → `POST https://services.leadconnectorhq.com/conversations/messages/outbound` (Version `2021-04-15`), which is a display-only "log an already-sent message" endpoint. The danger is the provider attached, not the endpoint.

### Where we got stuck (current blocker)
GHL developer signup kept failing with **"ER-EAE Signup Failed"** in Brave (Brave Shields was blocking the signup backend call — confirmed: switching browser fixed the toast). The user then *logged in* to the **consumer** marketplace (browse-2125-apps view) but there is **no "My Apps / Create App"**, because the **developer account was never actually created**. "My Apps" is the gate; its absence = no developer account.

**Fix (user is doing this now in Firefox):** log out of the consumer session → `marketplace.gohighlevel.com` → **Sign Up** (not Log in) → complete form → **verify phone** → **Get Started** → **click the EMAIL verification link** (this last step is what was skipped). If the email "already exists," use the plus-alias `brendan+ghldev@buildingflowdigital.com`. Once email verification completes, **My Apps → Create App** appears.

### The walkthrough to resume once "My Apps" appears
1. **Create app:** My Apps → Create App. Name "BFD SMS Mirror". Distribution = **Private** + **Sub-Account**.
2. **Scopes:** `conversations.readonly`, `conversations.write`, `conversations/message.readonly`, `conversations/message.write`, `contacts.readonly`.
3. **Conversation Provider** (the part with the settings that matter): Conversation Providers → Create. Name "BFD Twilio Mirror"; **Type = SMS**; **check "Is this a Custom Conversation Provider"**; **Delivery URL** = any valid https you control (e.g. `https://buildingflowdigital.com`) — never actually called while non-default, just satisfies the form.
4. **Install** the Private app on location `xo0XjmenBBJxJgSnAdyM`.
5. **Grab the `conversationProviderId`** — shown as the provider's "ID" in the app's Conversation Providers detail, and at sub-account Settings → Conversation Providers after install.
6. **CRITICAL safety check:** sub-account Settings → Phone Numbers → (Advanced) → SMS Provider — confirm the custom provider is **NOT** the default; leave existing Twilio/LC Phone as default. This is the lever that keeps GHL from ever sending through it.

### Claude's part (once user provides the providerId)
- Wire it: `UPDATE clients SET ghl_conversation_provider_id = '<id>' WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';` via Supabase Management API `/database/query` (project `bjgrgbgykvjrsuwwruoh`, `SUPABASE_PAT`).
- **Single-message double-send test:** Brendan creates a test contact in GHL and sends one SMS through the BFD flow. Claude verifies read-only: exactly **1 delivery** (Twilio) + **1 bubble** in Conversations, **no second send**.

### Open technical caveat — posting auth (PIT vs OAuth)
Our backend posts with the client's **Private Integration Token** (`clients.ghl_api_key`), NOT an OAuth token from the new app. GHL docs don't confirm a PIT can reference a *different* app's `conversationProviderId`. **Test order:** (1) try the PIT + providerId as-is; (2) if 401/403/provider-mismatch → switch to the app's OAuth token (one-time code exchange); (3) fallback → SMS doesn't strictly require a providerId, so we can still get bubbles, just without the branded channel tag.

### Gotcha
`.env BFD_GHL_PIT` is **INVALID** for loc `xo0Xjmen` (returns 401). Live GHL reads must use the client's real `clients.ghl_api_key` from the DB, not that .env token.

---

## PART C — [B] item clarifications settled this session
- **6.6 (`retell_webhook_secret`):** DEFERRED to first-paying-client onboarding (set = Retell API key, one live call, revert to NULL on 403). Recorded in memory `feedback_retell_unipile_secrets_deferred`. Not a current to-do.
- **6.8 ({{first_name}} opener):** recorded in memory `project_pending_prompt_changes` for the **next Retell prompt sweep** (Brendan applies in the BFD setter UI). Caution: the opener is shared inbound+outbound; raw `{{first_name}}` says "Hey ," to unknown inbound callers — add only on a dedicated outbound opener or guard it.
- **6.13 (delete 2 Supabase-secret GHL custom fields):** user reported **DONE**.

---

## PART D — Remaining LIVE SMOKE tests (deployed go-live; Brendan drives, Claude verifies read-only)
- **3.12 SMS booking:** text "can I book?" → slots → pick → `bookings.source='sms'` + cadence ends; reschedule/cancel/callback; STOP mid-exchange not sent.
- **6.11 voicemail/no-answer call:** fallback SMS fires promptly (NOT the old ~600s ceiling); `last_call_outcome` stamped.
- **6.12 outcome fields:** answered call → GHL contact shows Setter Call Outcome/Summary/Intent/Qualified/Last Call Date; SMS thread → after hourly scan, Setter SMS Sentiment/Intent/Qualified/Summary populate. (SMS-in-Conversations needs 6.12a/Part B first; outcome fields do not.)
- **6.10:** fresh GHL-intake lead has `normalized_phone` set.
- **6.7:** synthetic-probe canary passes.
- **bug-sweep UI (hard-refresh):** 6.1 sub-account nav (Manage Sub-Accounts → lands on `/settings`, no "Sub-Account Config" in sidebar, Pencil/Trash work); 6.3 Twilio numbers list + demo-page SMS + manual send (incl 429 retry) + Instagram/Email inboxes + attendee avatar + credential sync; 6.4 phone-removal persists; delete-setter leaves no orphan `voice_setters` row.

Bug tracker: `Docs/BUG_LIST.md`. Audit ledger: `Docs/AUDIT_RECONCILIATION_2026-06-19.md`. GHL-sync spec: `Docs/GHL_SYNC_FIX_2026-06-19.md`.

---

## Immediate next action for the new session
The user is finishing GHL **developer-account enrollment** in Firefox. As soon as **"My Apps"** appears, resume **Part B walkthrough** (create the Private app → display-only SMS provider → providerId → Claude wires `clients.ghl_conversation_provider_id` → single-message double-send test). Independently, the **Part D live smokes** can run whenever Brendan is ready to place calls/SMS.
