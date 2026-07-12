# BFD-Setter — Brendan's Manual / UI Todo List

Things only Brendan can do (UI clicks, logins, provider dashboards, business calls). Reconciled 2026-06-25;
first-client cluster pulled out 2026-07-11. Testing actions live in `TEST_LIST.md`; **everything gated on the
first paying client (onboarding, Resend SMTP, Stripe, A2P, GATE A/B) now lives in `Docs/FIRST_CLIENT_TASKS.md`**;
**prompt-content edits (agent wording) live in `PROMPT_UPDATE_LIST.md`** (kept separate so you can work
prompt tweaks independently).

## Build-session pre-clear decisions (2026-07-12) - the autonomous build session reads these

- **F21(b) reporting semantics: DECIDED = AI-sourced only.** The ROI show-rate funnel + weekly-report `booked`
  headline must count ONLY setter-created bookings (voice/SMS/cadence) and EXCLUDE `source='ghl_calendar'`
  human-booked appointments. No secondary "all appointments" line requested. This clears F21(b)'s "confirm
  intent before building" gate; F21(a) (the `sync-ghl-booking` dedup/redirect) needs no decision. The build
  session reads the same decision annotated on `FEATURE_ROADMAP.md` F21.

## Combined build session 2026-07-07 (bugs + F15 + F16 + F17-p1 all DEPLOYED) — manual follow-ups

- [ ] **Enable the new per-client features on the BFD dogfood client to demo them** (all default OFF). In the
  agency view of the client → **Client Settings → "Calls & compliance"** card: turn on **Speed-to-lead auto-dial**
  (F16b), **Missed-call text-back** (F16c), and (for compliance testing) **Call-recording disclosure** (F17). And
  in the **"Client ROI reporting"** card turn on **Show the show-rate funnel / weekly report to the client** if you
  want the client to see them. Then run the TEST_LIST "Combined build" behavioural checks.
- [x] **Provision the GHL appointment-status workflow → `bookings-webhook` — DONE + VERIFIED END-TO-END 2026-07-07.**
  Brendan built it in GHL as several per-status automations (one per status, since GHL exposed no status merge
  variable so it was hardcoded per automation) with a **Custom Webhook** POST to the `bookings-webhook` URL + the
  `x-wh-token: <ghl_webhook_secret>` header. Claude verified the full chain live: flipped a test appointment
  (`zjLTA9X9nTCwKf24ZWZ6`) `cancelled→confirmed→cancelled` via the GHL API → both of Brendan's automations fired →
  webhook auth passed → `bookings.status` updated each way → two `booking_status_events` rows logged (the F15 funnel
  data). Appointment restored to its original `cancelled` state. Only residual = a visual glance at the funnel card
  in the dashboard (test session). Per-client note: each real client's own GHL location needs its own copy of this
  workflow at onboarding (fold into the First-Client Milestone GHL step).
- [ ] **Apply the remaining prompt-content items** in the setter UI: **PU-11** (live-transfer offer line, deferred
  until you're fielding transfers), **PU-13** (state offered times in the lead's own timezone, gated on a real
  interstate lead). See `PROMPT_UPDATE_LIST.md`. _(PU-6 recording disclosure + PU-10 reschedule-list-first are DONE
  + verified → archived; the Resend-gated F15 weekly-report email flip is in `Docs/FIRST_CLIENT_TASKS.md`.)_

## P3 review (2026-07-07) — low-priority follow-up

- [ ] **AU public-holiday list refresh (annual, before end of 2027).** `trigger/_shared/businessHours.ts`
  `AU_PUBLIC_HOLIDAYS` is hard-coded for 2026 + 2027 only (flagged in-code "REVIEW ANNUALLY"). As 2028
  approaches, the list silently permits telemarketing dials on 2028+ national public holidays. Ask Claude
  to add the next year's AU national public holidays (a ~10-line code edit + a Trigger deploy). Low
  urgency, harmless until 2028. From the P3 security review (`Docs/SECURITY_REVIEW_2026-07-07.md`).

## Security review 2026-07-12 (pre-pilot red-team pass) — business/governance items (Claude can't do these)

> A two-model pre-pilot red-team pass ran over the architecture brief; the exploitable/latent findings were folded
> into GATE A/B (`Docs/FIRST_CLIENT_TASKS.md`), new code items into `BUG_LIST.md`, deferred hardening into
> `DEFERRED.md`. These two are the only ones that need YOU (business/legal, not code).

- [ ] **Confirm sub-processor DPAs + data-retention/training terms before the pilot handles real PII.** Real prospect
  PII flows to Retell (transcripts, recordings), Twilio (phone + SMS body), GoHighLevel (name/phone/email + call
  summaries), OpenRouter (the FULL conversation content + phone/email + transcripts), Trigger.dev (task payloads with
  Name/Email/Phone), and Stripe (client billing). For a pilot on real customer PII you want a signed DPA with each, and
  specifically OpenRouter's retention + model-training terms for what we send it (pin to a zero-retention / no-train
  route if available). Pairs with the code-side `SEC-OPENROUTER-PII-1` (drop phone/email from the LLM payload). `[B]`
- [ ] **Confirm MFA + least-privilege on every provider console.** Supabase, Railway, Trigger.dev, Retell, Twilio, GHL,
  Stripe. A compromise of any ONE of these dashboards is a bigger blast radius than any in-app bug — the Supabase
  console alone = the whole platform DB including the plaintext `clients` secret columns. (The in-APP user
  HIBP/MFA/12-char policy is already tracked in `Docs/FIRST_CLIENT_TASKS.md`.) `[B]`

## Onboarding-fix pass 2026-07-06 — one push to ship it

- [x] **Run `git push github main` from `/srv/bfd/Projects/bfd-setter`.** DONE (confirmed 2026-07-07,
  Session P1): the 2026-07-07 combined-build push carried the five onboarding-fix commits
  (`9f5b959`..`bb6322a`: ONBOARD-1/2/3, GOLIVE-1 card, ACCESS-1) to GitHub — `git log` confirms
  `bb6322a` is an ancestor of `github/main`, and `origin/main`/`github/main` are fully in sync (0
  commits divergent either way, both at `0ad9c83`). webhook-manifest v3 (the GOLIVE-1 server half) was
  already live; all five are now confirmed live end-to-end (the TEST_LIST "Onboarding-fix pass" rows
  already passed 2026-07-06 → `COMPLETED_LOG.md`).

## First-client onboarding prerequisites — MOVED to `Docs/FIRST_CLIENT_TASKS.md`

> The un-automated steps to stand up a real client (external Supabase project, GHL location + PIT, Twilio BYO,
> `subscription_status`→active, the canonical text `llm_model` decision, fresh-agency check) now live in
> `Docs/FIRST_CLIENT_TASKS.md` (Onboarding prerequisites). Full gap report:
> `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md`. They stop surfacing here so day-to-day work is unblocked.

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
> **GHL reminder-workflow snapshot (no-show stack)** — first-client-gated → moved to `Docs/FIRST_CLIENT_TASKS.md`
> (Onboarding prerequisites). Build once ahead of time, reuse per client.

- [x] **Apply the Setter-1 prompt content migration (PROMPT-AUTH-1, report-only) — DONE + VERIFIED LIVE
  2026-07-07** (Brendan drove the UI edit during the action-pack session; Claude verified read-only via
  `get-external-prompt`). The legacy 511-line "# BOOKING FUNCTION" blob was replaced with the lean
  `DEFAULT_BOOKING_PROMPT` template + the PU-10 reschedule/cancel honesty line appended. Verified: stored
  prompt 68,750 → 53,720 chars; no "Available days" / `{{ $now }}` / legacy tool names remain; the lean
  BOOKING APPROACH + PU-10 line are present; passes the save-external-prompt lint. The stored-prompt half of
  the 2 residual `TEST_LIST.md` PROMPT-AUTH-1 checks (no-leftover-artifacts, efficiency) is now satisfied by
  this read; the runtime behavioral half (tool-calling + date accuracy hold on the fast model over a live
  SMS) stays in `TEST_LIST.md` for the test session. `[B]`
- [ ] **5.1 Setup-guide screenshot re-shoot (content only; the rest is DONE).** The asset was renamed to
  `retell-bfd-setter-folder.png` and the step text now says "BFD Setter" (branding purge 2026-07-10), but the
  PNG's CONTENT still shows the old folder name. Re-shoot against a Retell folder named **"BFD Setter"** and
  drop the new screenshot onto that same filename. The obsolete n8n-import steps around it were deleted. `[B]`

- [x] **BRANDING PURGE — DONE 2026-07-10 (dedicated session).** All 1Prompt/n8n branding removed from the
  product surface: SetupGuideDialog lost its 5 n8n-era phases (workflows-import, n8n-setup, knowledgebase-setup,
  voice-inbound-setup, voice-outbound-setup; ~2,000 lines + 112 orphaned screenshots), the GHL step was rewritten
  to the BFD provisioning model (support@buildingflowdigital.com), all Skool/upstream-repo links removed, the 15
  public n8n/agent JSON exports + template-download pages + WorkflowImports + archived webinar pages deleted,
  PromptManagement demo defaults stripped of the fake-bio section and 1prompt sales links, DebugTextAIRep's n8n
  steps rewritten to the native engine, 7 edge fns edited + deployed (OpenRouter headers, `bfd-simulation-` email
  prefix, "Find Lead in BFD" labels, echo-guard fallback `bfd-setter` for NEW clients only, dual try-gary tag
  prefix), README/RUNBOOK/SOP updated. Verified: tsc + build + all 253 tests green; 7 fns boot-smoked.
  **Deliberate residuals** (legacy-value support, not branding): `retell-proxy` `LEGACY_N8N_HOST` rewrite guard
  (defensive; revisit in the retell-proxy session), the live DB `ghl_last_synced_from_field_value='1prompt-os'`
  rows + matching GHL workflow filters, the legacy `1prompt-try-gary-` tag prefix (accepted alongside the new
  `bfd-try-gary-`), the probe lead identity `probe@1prompt.local`, migrations/archived docs, and the factual GHL
  automation names in SOP/GHL_SETUP.md (they match your live GHL). Follow-ups → the 3 new `[B]` items below.
- [x] **Undeploy the dead `elevenlabs-manage-agent` edge fn - DONE 2026-07-11** (Brendan GO; one Management-API
  DELETE during the combined bundle session). Verified still gone 2026-07-12 (not among the 96 live functions).
  The item had been left un-ticked here; reconciled 2026-07-12.
- [ ] **Optional GHL-side legacy renames (your GHL, your timing).** (a) The automations are still named
  `Add Lead to 1Prompt OS` / `BFD bookings -> 1prompt (BOOKED/CANCELLED)` - renaming them in GHL is cosmetic
  and safe (webhook URLs are what matter), then update SOP/GHL_SETUP.md to match. (b) New try-gary automations
  should tag `bfd-try-gary-<style>`; once no contact/automation still carries `1prompt-try-gary-*`, tell Claude
  to retire the legacy prefix from `ghl-tag-webhook`. (c) The Supabase storage files the old Source Files page
  served (`Text_Engine_Setter.json`, `Appointment_Booking_Functions.json`, `Voice-Setter-1.json`) are now
  unreferenced; delete from the storage bucket whenever. `[B]`
- [ ] **Trigger.dev deploy rides along next session (cosmetic drift).** The syntheticProbe Slack alert text
  ("1prompt-OS synthetic probe FAIL" -> "BFD-setter synthetic probe FAIL") is changed in the repo but the prod
  Trigger deploy was permission-blocked; it ships automatically with the next Trigger.dev deploy. `[B]`
- [ ] **B-4 field-access (now self-serve config, not a build input)** — B-4 shipped Session 3. The per-field "which workspace settings a client may see/edit in My Account" is a **per-sub-account** governance editor you already control: open a sub-account → **Sub-Account Config → "My Account Field Access"** and toggle Visible/Editable per field (brand voice, contact hours, voicemail, logo…). Default set is unchanged; tune it per client there. `[B]`
- [x] **Shut down the n8n Railway service — WON'T DO (Brendan 2026-07-09): he KEEPS the n8n service, uses it for
  other (non-bfd-setter) things.** The bfd-setter product no longer depends on n8n (native text engine is canonical;
  `processMessages.ts` throws if `use_native_text_engine` is false), so no bfd-setter concern — the service just
  isn't ours to shut down. The IN-REPO dead n8n references (constants, the obsolete SetupGuideDialog n8n-import
  flow, `clients.text_engine_webhook`) are folded into the BRANDING PURGE task above. `[B]`
- [x] **Provision the F1 "BFD Conversation Link" GHL custom field (activates F1)** — DONE 2026-06-28 (Claude, via API, during Session 7). Created the TEXT field `BFD Conversation Link` (id `4tDL3asiRNrQD3MKyP2E`, `contact.bfd_conversation_link`) on location `xo0XjmenBBJxJgSnAdyM` and set `clients.ghl_conversation_link_field_id='4tDL3asiRNrQD3MKyP2E'` for client `e467dabc`. F1 is now active; the live deep-link test is in TEST_LIST. (Repo `.env` `BFD_GHL_PIT`/`BFD_GHL_LOCATION_ID` are stale — used the live `clients.ghl_api_key`.)

## From the 2026-07-02 usage/billing + auth build (F13/F14, branch `feature/usage-billing-auth`)

- [x] **Review the branch + say GO for the supervised deploy** — DONE 2026-07-03: Brendan reviewed + GO'd; DEPLOYED LIVE (6 edge fns, Trigger 20260702.1, frontend, backfill; both trap proofs 9/9 + SQL hand-check exact match; results in the handoff). What remains below is yours.
> **Resend SMTP, the `sms_llm` seed-rate confirm, the per-client billing anchor + visibility toggles, and the
> after-SMTP F14 invite/self-reset E2E** are all first-client-gated → moved to `Docs/FIRST_CLIENT_TASKS.md`
> (Resend SMTP + Billing config sections). Provider is decided (Resend, already wired); payload in
> `Operations/handoffs/2026-07-02-usage-billing-auth.md`.

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
