# BFD-Setter — Brendan's Manual / UI Todo List

Things only Brendan can do (UI clicks, logins, provider dashboards, business calls). Reconciled 2026-06-25.
Testing actions live in `TEST_LIST.md`; first-paying-client onboarding actions live in `DEFERRED.md`;
**prompt-content edits (agent wording) live in `PROMPT_UPDATE_LIST.md`** (kept separate so you can work
prompt tweaks independently).

## Combined build session 2026-07-07 (bugs + F15 + F16 + F17-p1 all DEPLOYED) — manual follow-ups

- [ ] **Enable the new per-client features on the BFD dogfood client to demo them** (all default OFF). In the
  agency view of the client → **Client Settings → "Calls & compliance"** card: turn on **Speed-to-lead auto-dial**
  (F16b), **Missed-call text-back** (F16c), and (for compliance testing) **Call-recording disclosure** (F17). And
  in the **"Client ROI reporting"** card turn on **Show the show-rate funnel / weekly report to the client** if you
  want the client to see them. Then run the TEST_LIST "Combined build" behavioural checks.
- [ ] **Provision the GHL appointment-status workflow → `bookings-webhook`** so the F15 show-rate funnel accrues
  confirmed/showed/no-show. In GHL, add a Workflow on "Appointment Status Changed" (confirmed / showed / no-show /
  cancelled) with a **Custom Webhook** POST to the `bookings-webhook` URL, and set the client's `ghl_webhook_secret`
  + send it as the `x-wh-token` header (GHL native Webhook V2 is RSA and NOT supported — use the static token).
- [ ] **After Resend SMTP lands (M1, below): the F15 weekly report email flips from stubbed to live automatically**
  (the `weeklyClientReport` cron sends when `RESEND_API_KEY` is set + a recipient email is configured on the client's
  "Client ROI reporting" card). No code change needed; just set `RESEND_API_KEY` on Trigger.dev prod + the recipient.
- [ ] **Apply the prompt-content items** in the setter UI: **PU-6** (recording disclosure line, now wired to
  `{{recording_disclosure}}`), **PU-10** (reschedule list-first), **PU-11** (live-transfer offer line). See
  `PROMPT_UPDATE_LIST.md`.

## P3 review (2026-07-07) — low-priority follow-up

- [ ] **AU public-holiday list refresh (annual, before end of 2027).** `trigger/_shared/businessHours.ts`
  `AU_PUBLIC_HOLIDAYS` is hard-coded for 2026 + 2027 only (flagged in-code "REVIEW ANNUALLY"). As 2028
  approaches, the list silently permits telemarketing dials on 2028+ national public holidays. Ask Claude
  to add the next year's AU national public holidays (a ~10-line code edit + a Trigger deploy). Low
  urgency, harmless until 2028. From the P3 security review (`Docs/SECURITY_REVIEW_2026-07-07.md`).

## Onboarding-fix pass 2026-07-06 — one push to ship it

- [x] **Run `git push github main` from `/srv/bfd/Projects/bfd-setter`.** DONE (confirmed 2026-07-07,
  Session P1): the 2026-07-07 combined-build push carried the five onboarding-fix commits
  (`9f5b959`..`bb6322a`: ONBOARD-1/2/3, GOLIVE-1 card, ACCESS-1) to GitHub — `git log` confirms
  `bb6322a` is an ancestor of `github/main`, and `origin/main`/`github/main` are fully in sync (0
  commits divergent either way, both at `0ad9c83`). webhook-manifest v3 (the GOLIVE-1 server half) was
  already live; all five are now confirmed live end-to-end (the TEST_LIST "Onboarding-fix pass" rows
  already passed 2026-07-06 → `COMPLETED_LOG.md`).

## From the 2026-07-06 end-to-end onboarding dry run (what a REAL first client needs)

Full report: `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md`. The app alone cannot stand up a client; the
un-automated prerequisites, roughly in order (most are code-fixable → see BUG_LIST ONBOARD-1/2, GOLIVE-1):

- [ ] **External Supabase project (SOP §2.1) — the #1 un-automated blocker.** Fully manual: create a
  `<slug>-setter-live` project on supabase.com, grab URL + `sb_secret_*` key, run the 5-table seed SQL,
  paste into the client's Credentials page. It is a HARD dependency for BOTH text and voice setter
  authoring (create-setter and text-save 400 without it — confirmed live). Nothing in the app or
  `onboard-client.mjs` provisions it. Consider a provisioning script / one-click template.
- [ ] **GHL location + Private Integration Token** (Contacts, Conversations, Calendars, Workflows,
  Custom Fields) → `ghl_location_id`, `ghl_calendar_id`, `ghl_assignee_id`, plus the custom fields
  (`last_synced_from` echo-guard, conversation deep-link field, `ghl_channel_field_id`,
  `ghl_conversation_provider_id`) and the webhook actions carrying `x-wh-token`. **Everything lead-side
  is GHL-gated**: `intake-lead` 409s "Client has no GHL credentials configured" (confirmed live), so
  even the SOP §7.1 synthetic dry-run can't run until GHL is wired; voice booking 409s without GHL.
- [ ] **Twilio BYO (client-owned): SID + auth token + E.164 number — NOT UI-editable.** ApiCredentials
  has no Twilio input/save (the token is never even read back). Set via `onboard-client.mjs` or SQL.
  Number must be UNIQUE (sharing another client's `retell_phone_1` breaks inbound routing) and imported
  into Retell before inbound bind / "Configure Twilio Webhook" can complete. A2P is the client's (weeks).
- [ ] **Flip `subscription_status`→`active`** on the new client (UI create sets `free`). SQL/script
  today. (The `use_native_text_engine` half is FIXED 2026-07-06: all three UI create paths now set it
  `true` at birth — see the onboarding-fix pass.)
- [ ] **Confirm the canonical text `llm_model` (SOP §11).** DB default `google/gemini-2.5-pro`;
  onboard-client.mjs default `openai/gpt-4.1-nano`; voice setters seed `gemini-3.0-flash`. A UI-created
  client silently gets gemini-2.5-pro for the text engine. Decide the one true production text model.

## From the 2026-07-03 overnight stage-only bug-fix run (branch `feature/overnight-bugfix` + `g3-7/vite-major`)

- [x] **Deploy the `feature/overnight-bugfix` branch (supervised, your GO).** DONE 2026-07-04 (Session 9, Claude, your GO): merged to `main` (`4a22b8b`, fast-forward), pushed origin+github. Deployed Trigger.dev 20260703.2 (SMS-MEM-1, FOLLOWUP-PROMPT-1), retell-proxy v48 (VM-1 + API-DEPR-1 list-agents), verify-credentials v3, save-external-prompt v15, RLS-SHAPE-1 migration applied. Frontend was ALREADY live (Railway auto-deployed the branch overnight — see DEPLOY-1). Read-only Voice smoke on v48 passed. **Still owed by you:** the live TEST_LIST pass (below), incl. the retell-proxy v48 answered-call Voice-regression + the VM-1 voicemail-lands check.
- [x] **Apply the RLS-SHAPE-1 migration** — DONE 2026-07-04 (Session 9, Claude, Mgmt API): the role gate `get_user_role(auth.uid())='agency'` is confirmed live in `pg_policies` on `sms_delivery_events`.
- [x] **DEPLOY-1 — pin the Railway production frontend deploy to `main` only.** DONE 2026-07-04 (Brendan, screenshot-confirmed): Railway `1prompt-os` → production → Settings → Source shows "Branch connected to production" = `main` with auto-deploy on push. The auto-deploy-any-branch hole is closed.
- [x] **Merge the G3-7 vite-8 branch** — DONE 2026-07-04 (Session 10, Claude): rebased `g3-7/vite-major` onto
  `main` → `--ff-only` merge (`407b66e`) → pushed origin+github → Railway rebuilt prod on vite 8.1.3 (LIVE). All
  headless gates green (build/tsc/test:frontend/audit; preview + dev server served all routes 200). **The only
  remaining piece is the live human browser click-through**, which is a `TEST_LIST.md` item (open
  `app.buildingflowdigital.com`, click a few pages, no console errors) — not a merge action.
- [x] **Raise the inotify watch limit on greenserver (unblocks `npm run dev`)** — DONE 2026-07-04 (Claude, via
  passwordless sudo): `/etc/sysctl.d/60-inotify.conf` now sets `fs.inotify.max_user_watches=524288` and
  `sudo sysctl --system` applied it live (confirmed `fs.inotify.max_user_watches = 524288`). `npm run dev` no
  longer needs `CHOKIDAR_USEPOLLING=true`.

## Active (do when you have time)

- [x] **Verify no alphanumeric SMS sender ID is configured in Twilio (ACMA).** DONE 2026-07-04 (Claude, read-only
  against the live Twilio account `AC11c162…` "Building Flow Digital" using the creds in the `clients` table):
  the one Messaging Service ("BFD", `MG4843…`) has **0 alphanumeric sender IDs**, and the account holds one plain
  long code (`+61481614530`, ACMA-exempt). No rewrite risk. **Standing note for Brendan:** treat any future
  "branded/alpha sender" client request as needing ACMA Sender ID Register registration FIRST (weeks of lead
  time) — https://www.acma.gov.au/sms-sender-id-register.
- [ ] **GHL reminder-workflow snapshot (no-show stack; do at/just before first-client onboarding).** Build ONE
  canonical GHL workflow set in the BFD location and snapshot it for client onboarding: instant booking-confirm
  SMS → 24h reminder with a confirm trigger-link (tap = confirmed, suppresses later nags) → 2h short reminder →
  reschedule link in every touch → post-appointment branch on status (showed / no-show). SMS reminders cut
  no-shows 38-40% and this is config, not code (research verdict: do NOT build a reminder engine in-product;
  GHL's appointment-status triggers + trigger links do it all). Pairs with F15's status sync-back. `[B]`

- [ ] **Apply the Setter-1 prompt content migration (PROMPT-AUTH-1, report-only)** — the legacy 511-line
  "# BOOKING FUNCTION" blob in the stored Text-setter prompt (the root cause of the Monday/wrong-date booking
  bug) is now safe to remove: booking mechanics are code-owned as of PROMPT-AUTH-1. Steps are written out in
  `Docs/investigations/prompt-migration-reports/e467dabc-57ee-416c-8831-83ecd9c7c925_Setter-1.report.md`
  (generated read-only, never touches the DB): open Prompt Management → Setter-1 → SETTER CORE → enable
  "Booking Function" → "View Prompt" → clear the legacy booking text (or click "Return to Default" for the new
  minimal template) → Save/Deploy (now lints on save + snapshots to `prompt_versions`) → re-open "Verify Setter
  Prompt" → "Load live stored prompt" to confirm it's lean. Unblocks 3 `TEST_LIST.md` PROMPT-AUTH-1 checks
  (full-prompt visibility via the new X-Ray, no-leftover-artifacts, efficiency). `[B]`
- [ ] **5.1 Setup-guide screenshot re-shoot** — review and refresh. Lock the canonical BFD Retell **folder name** first, then the screenshots/text in `SetupGuideDialog.tsx` can be re-shot (it still says create a folder named "1Prompt"). `[B]`
- [ ] **B-4 field-access (now self-serve config, not a build input)** — B-4 shipped Session 3. The per-field "which workspace settings a client may see/edit in My Account" is a **per-sub-account** governance editor you already control: open a sub-account → **Sub-Account Config → "My Account Field Access"** and toggle Visible/Editable per field (brand voice, contact hours, voicemail, logo…). Default set is unchanged; tune it per client there. `[B]`
- [ ] **Shut down the n8n Railway service** — the native text engine is fully canonical (the n8n code path was already removed; `processMessages.ts` now throws if `use_native_text_engine` is false). The n8n Railway service can be stopped/deleted. (F5 close-out; the unused `clients.text_engine_webhook` column is deferred, see DEFERRED.) `[B]`
- [x] **Provision the F1 "BFD Conversation Link" GHL custom field (activates F1)** — DONE 2026-06-28 (Claude, via API, during Session 7). Created the TEXT field `BFD Conversation Link` (id `4tDL3asiRNrQD3MKyP2E`, `contact.bfd_conversation_link`) on location `xo0XjmenBBJxJgSnAdyM` and set `clients.ghl_conversation_link_field_id='4tDL3asiRNrQD3MKyP2E'` for client `e467dabc`. F1 is now active; the live deep-link test is in TEST_LIST. (Repo `.env` `BFD_GHL_PIT`/`BFD_GHL_LOCATION_ID` are stale — used the live `clients.ghl_api_key`.)

## From the 2026-07-02 usage/billing + auth build (F13/F14, branch `feature/usage-billing-auth`)

- [x] **Review the branch + say GO for the supervised deploy** — DONE 2026-07-03: Brendan reviewed + GO'd; DEPLOYED LIVE (6 edge fns, Trigger 20260702.1, frontend, backfill; both trap proofs 9/9 + SQL hand-check exact match; results in the handoff). What remains below is yours.
- [ ] **Resend SMTP (unlocks reliable invite + client-reset emails):** (1) create a free Resend account; (2) add + verify `buildingflowdigital.com` (Resend shows the DKIM/SPF DNS records to add); (3) create an API key and hand it to Claude — the SMTP config PATCH payload is in the handoff. Until this lands, invites/resets ride Supabase's built-in mailer, which is rate-limited to a few emails an hour and effectively team-members-only. `[B]`
- [ ] **Confirm the `sms_llm` seed rate** — the per-text sell rate is built from an admin-set "LLM cost per average outbound message", seeded at US$0.003/msg (enabled by default; it does NOT change any blended $/min). Sanity-check against real OpenRouter usage and tune it in the pricing panel. `[B]`
- [ ] **Set per-client billing anchor day + client visibility toggles** — Sub-Account Config → Cost-to-Price Calculator: pick the billing anchor day (default the 1st) and flip on whichever of rate / minutes / texts / month-total each client may see. All four default OFF. `[B]`
- [ ] **After SMTP lands: run the invite + self-reset E2E** — send an invite to a test address (lands on "Set Your Password", 12-char minimum), and run a client-role /forgot-password (now allowed). Items are in TEST_LIST. `[B]`

## From Session 7 phone-half (2026-06-30)

- [x] **Session 7.5 (Text-Setter repair + all bugs) + F8 — BUILT, MERGED to main, and DEPLOYED LIVE 2026-07-01 (overnight, Claude).** Brendan directed a go-live; everything is live. Trigger 20260630.1, `tool_invocations` + `client_pricing_config` migrations, `execute-lead-webhook` v1, `get-blended-rate` v1, frontend (Railway), **retell-proxy v47 (VM-1)** behind a read-only Voice smoke (0 agents mutated). F8 trap proof 9/9. Handoff: `Operations/handoffs/2026-07-01-f8-plus-7.5-deploy.md`. **No deploy left to do** — what remains is your consolidated live-test pass + the manual items below.
- [x] **VOICE-REGRESSION CONFIRMATION — DONE 2026-07-03.** Live outbound call `call_d5625539`: booking + B-3 + B-5
  all confirmed live; **v47 SAFE, no rollback needed**. Voicemail (VM-1) FAILED separately (still "partial",
  0/5 agents) — re-opened in `BUG_LIST.md` as its own item, does not gate v47. → `TEST_LIST.md` /
  `COMPLETED_LOG.md`. (This line was stale — left as open here after the check had already passed.)
- [→] **BOOK-1 prompt tweak — MOVED to `PROMPT_UPDATE_LIST.md` (PU-2) and now CODE-OWNED.** The booking rules it proposed adding to the stored prompt are owned code-side as of PROMPT-AUTH-1 (and the stale booking blob is being removed from the stored prompt via the Setter-1 migration). Do NOT hand-add booking rules to a stored persona. See `PROMPT_UPDATE_LIST.md` PU-2 for the full history.
- [x] **Revert the Property Coach name** — DONE (confirmed live 2026-07-04: `get-agent` returns `agent_name` = "Gary - Property Coach", no trailing " 1"; also recorded as precondition A3 in the 2026-07-03 voice-gate handoff).
- [x] **MODEL-1 — `clients.llm_model` corrected live** — was an invalid OpenRouter id (`google/gemini-flash-latest`) silently breaking all SMS + cadence AI; Claude set it to `google/gemini-2.5-flash` via Mgmt API (2026-06-30). FYI; the hardening (validate the field) is a code item in BUG_LIST (MODEL-1-HARDENING). If you change the model in the UI, use a valid OpenRouter id (e.g. `google/gemini-2.5-flash`).
- [x] **SMS latency reduced** — `agent_settings.response_delay_seconds` for all 7 BFD setters set 60/82 → **12s** (2026-06-30, your call). Tune further in the setter config if 12s feels off.

## After a build ships (I'll prompt you with the exact agent/version)

- [x] **Re-Save the 5 voice setters (for B-5/B-3)** — DONE 2026-07-03 (recorded as precondition A2 in the voice-gate
  handoff; the live voice gate then confirmed B-5 `first_name` populated). **⚠️ A FRESH re-Save is now needed** to
  push the two NEWER agent-level changes onto the live agents: **VM-1** (retell-proxy v48 voicemail draft-first) and
  **API-DEPR-2** (retell-proxy v49 analysis-fields → `post_call_analysis_data` system-presets). That fresh re-Save is
  part of the voice-gate / API-DEPR-2 checks in `TEST_LIST.md` (re-Save any setter, then `get-agent` shows the 3
  `system-presets`). The 5: Main Outbound (slot 1), Gary Property Coach / Mortgage Broker / Finance Strategist /
  Crazy Gary. **Never edit the prompts — re-Save/Push only.**
- [ ] **Apply any report-only prompt tweaks** I surface, via the BFD setter UI (prompt content is hard report-only). **These now live in their own list: `PROMPT_UPDATE_LIST.md`.**
- [x] **Flag the inbound setter (activates F2b)** — DONE (live DB: "Inbound BFD Agent" `is_inbound=true`; `clients.retell_inbound_agent_id` + Retell `+61481614530` inbound binding both point at `agent_b2f6495…`). Flipping this is what surfaced B-6 (now fixed in Session 3.1: the persistence held; the list badge was reading the wrong table). One setter per client; flipping another moves the flag.

## Notes

- The inbound number `+61481614530` answers on a dedicated **"Inbound BFD Agent"** (`agent_b2f6495`) with the neutral greeting — confirmed correct 2026-06-25.
- Outbound calls pick the setter at the **campaign/workflow level** — no setter needs an outbound binding (only one setter is flagged inbound). This is the model the F2 build implements.
