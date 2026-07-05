# Onboarding Gap Report — end-to-end new-client dry run (2026-07-06)

**Run:** autonomous overnight, Playwright + Management-API + Retell REST, driving the LIVE app
(`app.buildingflowdigital.com`) as the BFD agency, against the real platform DB
(`bjgrgbgykvjrsuwwruoh`). A throwaway sub-account was created through the UI exactly as an operator
would, walked through setter setup, and a real client-role login was used for the client-eye checks.
**All throwaway artifacts were deleted at the end (see "Cleanup").**

**Bottom line:** the platform can stand up a brand-new voice-booking client, but **not through one
guided flow, and not through the UI alone.** Voice setter push + voicemail push + the F13 client-eye
billing view all work on a fresh client. The blockers to a real first-client onboarding are (1) a
UI-created client has its **SMS text engine silently OFF** with no UI to fix it, (2) **external
Supabase must be hand-provisioned** before any setter can be authored, (3) **Twilio creds are not
UI-editable**, (4) **`goLiveReady` is a false-positive** (true from birth), and (5) lead ingress /
SMS / voice booking are all hard-gated on GHL + Twilio being wired first. Details below.

Two carried-over items were CLOSED this run: **API-DEPR-2(a)** and the **F13 client-eye view**.

---

## What PASSED (works for a fresh client)

- **Sub-account create via UI** (`CreateClient.tsx`, `/client/:id/create-client`): creates the client
  row + auto-mints `intake_lead_secret` + `ghl_webhook_secret`, and (optional) creates a **client-role
  login directly** via `create-client-user` (admin.createUser, `email_confirm:true`) — **no SMTP
  needed**, clean rollback on partial failure. A fresh client login lands on a working (trimmed)
  dashboard, no paywall once `subscription_status='active'`.
- **Voice setter Save & Push** works with only `clients.retell_api_key` set (external DB NOT required
  for the Retell push). Pushed `sync-voice-setter` (retell-proxy v49) → created fresh agent
  `agent_c09e76046be7e61b57c030104d`.
- **API-DEPR-2(a) CLOSED** (real agency JWT, throwaway agent, zero risk to the 5 canonical agents):
  the pushed agent's `post_call_analysis_data` = 3 `type:"system-presets"` (`call_summary`,
  `call_successful`, `user_sentiment`) + 6 custom fields, **no dupes**, and the 3 deprecated
  `analysis_*_prompt` fields are **ABSENT**. `webhook_url` auto-set to retell-call-analysis-webhook.
- **Born-bookable** confirmed on a fresh client: 5/5 booking tools land on the agent's LLM, each URL
  rewritten to the platform `voice-booking-tools` edge fn with the per-tenant `clientId`, plus
  `send-sms` + `schedule-callback`. (The old "create-setter skips wizard" bug is fixed on main.)
- **Voicemail push (VM-1)** on the fresh agent: `set-voicemail` (mode=static) → `voicemail_set`,
  patched 1/1; agent `voicemail_option` flipped hangup → static_text. draft→publish→repoint works.
- **F13 client-eye CLOSED** (real client-role JWT + UI). `get-client-usage` 4-toggle matrix:
  all-off → `{show:false}` (client sees nothing); each toggle exposes ONLY its own figure; all-on →
  all four; **agency always sees the full margin payload** regardless of client toggles. UI mirror on
  `/account-settings`: all-on → "Usage & Billing" card with rate `/min` + Month total; all-off → card
  absent. Server-enforced whitelist (toggled-off keys omitted entirely).

---

## GAPS — code (filed to BUG_LIST.md)

### ONBOARD-1 (High) — UI-created clients have the SMS text engine OFF, with no UI to turn it on
`clients.use_native_text_engine` DB default is `false`; `CreateClient.tsx` never sets it (only
`onboard-client.mjs` sets it `true`). `trigger/processMessages.ts:106` **throws**
`use_native_text_engine must be true … n8n path decommissioned` when false. It is referenced **only**
in generated `types.ts` — no UI component reads or writes it. **Net: a client onboarded purely through
the UI has a dead SMS engine and the operator has no UI lever to fix it (SQL only).**
Fix: set `use_native_text_engine:true` in the CreateClient insert (and/or add it to the go-live flip +
a Sub-Account Settings toggle).

### ONBOARD-2 (Medium) — "Create new setter" hard-fails AND orphans a row without external Supabase
`handleCreateNewSetter` (`PromptManagement.tsx:5734`) inserts a platform `prompts` row FIRST, then
calls `save-external-prompt` and **rethrows** its 400 (`:5757`) when `clients.supabase_url` /
`supabase_service_key` are null. Result on a fresh client: a half-created `prompts` row + "Failed to
create new setter" toast + no Retell agent. Text setter authoring is fully blocked the same way
(`:6828`). Fix: check external-Supabase presence up front with a clear message ("configure the
external Supabase on Credentials first"), and don't insert the platform row until the external write
can succeed (no orphan).

### GOLIVE-1 (Medium) — `goLiveReady` is a false-positive (true from birth)
`webhook-manifest` computes `goLiveReady = every REQUIRED webhook secretStatus === "secured"`, and
`secretStatus="secured"` iff `ghl_webhook_secret` is a non-null string
(`webhook-manifest/index.ts:122,136,209-219`). That secret is auto-minted at client creation
(`CreateClient.tsx:116`) and re-minted by the manifest itself if null (`:68`). So **every brand-new
client reports `goLiveReady:true` immediately** — with no GHL connection, no Twilio number, no setter
pushed, no external DB, and `lastReceivedAt=null` on both required webhooks. The UI gates the SOP §8.1
`auto_engagement_workflow_id` flip on this, so an operator can flip a completely dead client "live".
Fix: strengthen `goLiveReady` (or add a separate readiness checklist) to also require `ghl_location_id`
+ `retell_phone_1` + ≥1 pushed setter + external Supabase set + `lastReceivedAt != null` on the 2
required hooks.

### ACCESS-1 (Medium) — a client-role user can load the setter editor
Live test as the client: `/credentials` and `/settings` correctly redirect to the dashboard
(AgencyRoute), but **`/prompts/voice` does NOT redirect** — the editor loads. `prompts/text` +
`prompts/voice` are not AgencyRoute-wrapped (`App.tsx:282-283`), and the edge fns authorize a client
for their own `client_id` (a client is its own agency under RLS), so a client could self-edit/push
their own setter prompt content — contradicting the "prompts are BFD-managed, clients don't touch
them" rule. Fix: wrap `prompts/text` + `prompts/voice` in AgencyRoute and trim those items from the
client sidebar.

### ONBOARD-3 (Low) — CreateClient password copy mismatch
The handler + submit require ≥12 chars (`loginData.password.length < 12`) but the input placeholder
says "Min 6 characters" (`CreateClient.tsx:378`). Cosmetic; misleads the operator.

---

## GAPS — provisioning / manual (filed to BRENDAN_TODO.md) — "what a real first client needs"

A first-client onboarding cannot be done from the app alone. The un-automated prerequisites, in order:

1. **External Supabase project (SOP §2.1) — the #1 un-automated blocker.** Fully manual: create a
   `<slug>-setter-live` project on supabase.com, grab URL + `sb_secret_*` key, run the 5-table seed
   SQL by hand, paste into Credentials. **Hard dependency for BOTH text and voice setter authoring**
   (create-setter and text-save 400 without it). Nothing in the app or `onboard-client.mjs` provisions
   it. Consider a provisioning script or a documented one-click template.
2. **GHL location + Private Integration Token** (Contacts, Conversations, Calendars, Workflows, Custom
   Fields) + `ghl_location_id`, `ghl_calendar_id`, `ghl_assignee_id`. **Everything lead-side is
   GHL-gated**: `intake-lead` 409s "Client has no GHL credentials configured" (`index.ts:344`), so even
   the SOP §7.1 synthetic dry-run can't run until GHL is wired; voice booking 409s without
   `ghl_api_key`/`ghl_location_id`/`ghl_calendar_id`. Also needs the GHL custom fields wired
   (`last_synced_from` echo-guard, the conversation deep-link field, `ghl_channel_field_id`,
   `ghl_conversation_provider_id`) + the webhook actions carrying `x-wh-token`.
3. **Twilio BYO** (client-owned): SID + auth token + E.164 number → **not UI-editable** (ApiCredentials
   has no Twilio input/save; the token is never even read back). Set via `onboard-client.mjs` or SQL.
   The number must be **unique** (sharing another client's `retell_phone_1` breaks inbound routing via
   `maybeSingle` PGRST116) and imported into Retell (RetellPhoneNumbersTab) before inbound bind /
   "Configure Twilio Webhook" can complete. A2P registration is the client's, weeks of lead time.
4. **Flip `subscription_status` to `active`** (UI create sets `free`) and **`use_native_text_engine`
   to `true`** (see ONBOARD-1) — both SQL/script today.
5. **OpenRouter key + confirm `llm_model`.** DB default `llm_model` is `google/gemini-2.5-pro`;
   `onboard-client.mjs` default is `openai/gpt-4.1-nano`; voice setters seed `gemini-3.0-flash`. SOP
   §11 "confirm the canonical production text model" is still open — a UI-created client silently gets
   gemini-2.5-pro for the text engine.

---

## SOP corrections (filed to SOP/CLIENT_ONBOARDING_SOP.md §11)

- §3.1/§11: state that the **in-app CreateClient wizard does NOT set `use_native_text_engine`** (dead
  SMS engine) — the managed path is `onboard-client.mjs`, or flip it by SQL; there is no UI toggle.
- §4.3: creating a setter **requires external Supabase first**, else it errors and orphans a `prompts`
  row (the born-bookable note is now stale — that bug is fixed).
- §7.1: the synthetic `intake-lead` dry-run is **GHL-gated** (409 without GHL creds) — do it after GHL
  is wired, not before.
- §8.1: **`goLiveReady:true` is not a real readiness signal** (true from birth). Add the real checklist
  (GHL connected, Twilio number set + imported, ≥1 setter pushed, external Supabase set, both required
  webhooks show a non-null "last received").

## Prompt-content gaps

None surfaced this run (the throwaway had no external Supabase, so no prompt content was authored or
inspected). `PROMPT_UPDATE_LIST.md` unchanged.

---

## Cleanup

Throwaway client `cd853222-f7d3-4505-8f77-91ef5edf72b8`, its client-role user
`7f7f691d-…` (`zz.onboard.client.gn0f@example.com`), its `client_pricing_config` / `voice_setters`
rows, and the Retell agent `agent_c09e76046be7e61b57c030104d` + its LLM
`llm_f3dcae925a6fa11b0ccc1192c80f` were all **deleted** at the end of the run (no leads/bookings/
engagement rows were created — `intake-lead` 409'd before insert). The 5 canonical agents were never
touched.
