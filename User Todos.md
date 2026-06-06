# User Todos — BFD-setter

Brendan's checklist to take BFD-setter from "shipped behind flags" to "first paying client live + onboarded."

Items are sequenced. Order matters — do them top-to-bottom. Each item links to the section in `Operations/handoffs/2026-04-30-1prompt-master-rebuild-handoff.md` (the master state-of-play) or to the SOP at `Docs/CLIENT_ONBOARDING_SOP.md`.

Effort: S = under 30 min, M = 30 min - 2 hr, L = half day+.

---

## 🧪 FUNCTIONAL VERIFICATION (2026-06-06)

Whole-platform functional pass/fail verification. Full report + evidence:
**→ [Operations/handoffs/2026-06-05-functional-verification.md](../../Operations/handoffs/2026-06-05-functional-verification.md)**

Outcome: system is **functionally healthy end-to-end**. Live E2E to TEST_PHONE_A confirmed ingress (`intake-lead`) -> cadence SMS -> real Retell call answered 47s -> inbound AI text reply, all DB-confirmed. Auth layer solid (anon->401 everywhere; `make-retell-outbound-call` dual-mode; `retell-proxy` JWT-only). `classifyCallOutcome` byte-identical + Bug-33 guard intact. `duplicate-setter-config` still clones `directions:[]`. Synthetic test lead `iAHb62nsQVOEIl8kbCi4` + its GHL contact deleted post-test (done 2026-06-06).

### Brendan-required — ordered by severity

- [ ] **V1. (HIGH, S) Restore the synthetic probe** — runs hourly but failed **0/48 in 48h**: `Missing env: PROBE_CLIENT_ID, PROBE_INTAKE_SECRET, PROBE_TEST_PHONE` (never set in Trigger.dev **prod**). The canary verifies nothing right now. Set those 3 env vars in Trigger.dev prod, AND give probe client `b0e4f199-3fa5-4c8d-851b-6167ff46ad91` a sendable from-number (its `retell_phone_1` is null) or its cadence SMS step fails even once env is set. Code: [trigger/syntheticProbe.ts](trigger/syntheticProbe.ts) lines 57-88.
- [ ] **V2. (HIGH, M/L) AU SMS deliverability** — messages are accepted by Twilio (`sent`, no error) but AU handset delivery on bare long code `+61481614530` is slow/unconfirmed since ~Jun 5 (Jun 3 DLR took 6.7h; recipient saw them eventually). NOT a code fault. Pursue **A2P / a registered Messaging Service** for the number. Separately, the number-level `status_callback` is stale -> `https://api.vapi.ai/twilio/status` (Vapi leftover); repoint to `.../functions/v1/twilio-status-webhook` (per-message callbacks already work, so this is cleanup not the cause).
- [ ] **V3. (MED) Webhook secrets still unset** — reconfirmed: BFD has zero `ghl/retell/unipile_webhook_secret`, so verify-if-present HMAC is inert and those webhooks are forgeable. **Same item as the SECURITY REVIEW "Provision webhook secrets" task below** — not new, reconfirmed live.
- [ ] **V4. (LOW, S, optional) Snappier text replies** — the ~2 min reply delay is ~60s intentional debounce (`clients.debounce_seconds=60`) + ~70s gemini-2.5-pro generation. Lower `debounce_seconds` (e.g. 20-30s) for faster replies, at a small risk of answering before a multi-text lead finishes. Code: [trigger/processMessages.ts](trigger/processMessages.ts) lines 146-158.
- [ ] **V5. (LOW, S, optional) Close code-verified-only items** — STOP/START opt-out flow and the UI Save+publish smoke were verified by code, not live-fired this session. Run when convenient (STOP -> opt-out + one compliance reply -> START resubscribe; publish -> phone agent repoint).
- [ ] **V6. (LOW, prompt-manual) Agent offered a weekend slot** — during the test call the agent offered a Sat slot not in `get-available-slots` (calendar is Mon-Fri). Prompt-behaviour, so Brendan-manual per [[feedback_no_internal_prompt_edits]] — consider constraining the agent to only offer returned slots.

### Claude / coding-agent — ordered by severity

- [ ] **VC1. (MED, S) Clear `active_call_id` on execution cancel/complete** — found this session: cancelling an `engagement_executions` row while a call is live leaves `active_call_id` dangling (live agent uses `retell-call-analysis-webhook`'s `treat_pickup_as_reply`, which doesn't touch that field). Cosmetic but messy; null it in the cancel/complete paths. Ref: [frontend/supabase/functions/retell-call-analysis-webhook/index.ts](frontend/supabase/functions/retell-call-analysis-webhook/index.ts) lines 761-840.
- [ ] **VC2. (MED, M) `lead_optouts`-without-`setter_stopped` resume gap** — known gap reconfirmed: cadence resume guards on `leads.setter_stopped` but has no second-line `lead_optouts` check, so if `setter_stopped` is cleared while a `lead_optouts` row persists, the cadence can resume against an opted-out lead. Add the second guard in `runEngagement` isCancelled. Ref: [trigger/runEngagement.ts](trigger/runEngagement.ts).
- [ ] **VC3. (LOW, S/doc) Document/consolidate the two voice-coordination paths** — `retell-call-webhook` (`last_call_outcome` polling, the "Bug 1" path) vs `retell-call-analysis-webhook` (`treat_pickup_as_reply` -> mark completed + cancel Trigger run). Live BFD agent `agent_f45f4dd87a4072424f3c84b74c` uses the analysis webhook, so `last_call_outcome`/`active_call_id` are vestigial on the live path. Decide which is canonical and document (or retire the unused one).

---

## 🔒 SECURITY REVIEW (2026-06-05) — shipped `c2ca345`

Whole-codebase security review shipped + deployed to `bjgrgbgykvjrsuwwruoh`. Full detail:
`Docs/SECURITY_REVIEW_2026-06-05.md` + handoff `Operations/handoffs/2026-06-05-security-review.md`.

**Done (deployed + verified live):**
- ✅ Cross-tenant IDOR closed on 34 edge functions (new `_shared/authorize-client-request.ts` dual-mode guard). Verified: anon→401, internal service-role→200.
- ✅ SSRF (`notify-webhook`), open proxy (`github-proxy`), XSS (`EmailInbox.tsx`), Stripe fail-closed, Twilio-inbound signature, prompt-chat RLS tenant-scoped (F6 migration applied).

**Open — Brendan to action:**
- [ ] **(S, per client) Provision webhook secrets** — GHL/Retell/Unipile/workflow webhooks are still forgeable (0/2 clients have secrets). Set `clients.<provider>_webhook_secret` + configure the upstream provider to send it, then flip handlers to fail-closed. **This is now a NEW onboarding step.** Runbook in the Docs file.
- [ ] **(S) Rotate or remove `GITHUB_PAT`** — currently expired; `github-proxy` source-files feature is broken until rotated.
- [ ] **(M, low) F7:** stop exposing `clients` secret columns to the browser (column-restricted view/RPC).
- [ ] **(S, low) F10:** rotate the anon key/project ref `awzlcmdomhtyqjabzvnn` baked into 5 old cron migrations, if that project is still live.

---

## 🔎 ONBOARDING DRY-RUN SIMULATION (2026-06-06) — gaps to action

Full simulation walkthrough (all 11 phases, provision/store/verify/breaks-if-skipped + 12-item gap list):
`~/.claude/plans/you-are-a-senior-calm-cocke.md` (durable copy of findings in handoff
**→ [Operations/handoffs/2026-06-06-onboarding-simulation-gaps.md](../../Operations/handoffs/2026-06-06-onboarding-simulation-gaps.md)**).
Nothing was executed — this was a read-only audit of `Docs/CLIENT_ONBOARDING_SOP.md` against live code.
Note: edge fns live under `frontend/supabase/functions/`. These items feed Phase C (onboard Client #2) + the §A6 / security items above.

### Coding-agent (autonomous code) — by severity

- [ ] **CA1. 🔴 SECURITY — add request-auth/signature verify to the 4 forgeable webhook handlers.** Verified: zero secret/HMAC code in `frontend/supabase/functions/{sync-ghl-contact,sync-ghl-booking,workflow-inbound-webhook,retell-call-webhook}/index.ts`. Setting `clients.*_webhook_secret` does NOT protect these (it only arms `bookings-webhook` / `receive-dm-webhook` / `retell-call-analysis-webhook` / `unipile-webhook`). `sync-ghl-contact` is the **primary lead ingress** and is forgeable by anyone who learns a `ghl_location_id`. This is the code half of **§A6** + the security-review open item (line 21). Pattern to copy: the HMAC check already in `bookings-webhook/index.ts`. *(M)*
- [ ] **CA2. 🟠 Fix `twilio-configure-webhook` wrong slug.** `frontend/supabase/functions/twilio-configure-webhook/index.ts:49` builds `.../twilio-inbound-sms` (legacy, logs to `sms_messages` only, no engagement/GHL/queue) and writes it as `SmsUrl` at `:87`. Canonical is `receive-twilio-sms`. Both verify the Twilio sig, so a mis-config gives no error — inbound SMS silently bypasses the cadence. Fix the URL or deprecate the auto-config. *(S)*
- [ ] **CA3. 🟠 Confirm `lead_optouts` is enforced on the send path.** STOP writes `lead_optouts` + cancels the exec, but verify `runEngagement.ts` / `processMessages.ts` actually READ `lead_optouts` before each send (carrier `21610` is the only confirmed backstop today). If a re-enrolled contact can be messaged post-STOP, add the guard. *(S to confirm, M if guard missing)*
- [ ] **CA4. 🟠 `ghl_channel_field_id` schema gap.** Selected by `receive-twilio-sms/index.ts:432`, used at `:636`, warns-and-skips at `:287` when null — but the column is **absent from `frontend/supabase/migrations/` and `types.ts`**. First verify whether it exists in the live platform DB `bjgrgbgykvjrsuwwruoh` (Mgmt API `information_schema.columns`). If present-but-uncaptured: add a no-op migration + types.ts entry so a regen can't drop it. If absent: the `select` would error — add the migration. *(S)*
- [ ] **CA5. 🟡 `test-external-supabase` false-negatives `sb_secret_*` keys.** `frontend/supabase/functions/test-external-supabase/index.ts:83` validates `eyJ` + 3-part JWT shape, so it rejects valid modern service keys during onboarding. Accept `sb_secret_*` (or add a real REST connectivity probe). *(S)*
- [ ] **CA6. 🟡 `onboard-client.mjs` omits required columns.** `scripts/onboard-client.mjs` does NOT set `subscription_status` (defaults `'free'` = client gated OUT), `ghl_calendar_id`, `ghl_assignee_id`, `supabase_url/service_key/table_name`, the retell agent-id columns, `voicemail_config`, `ghl_channel_field_id`, or the 3 webhook secrets. At minimum set `subscription_status='active'` and print a loud REQUIRED-MANUAL block; ideally cover the rest. Clone source is hardcoded to `40e8bea3-…` (generic), not BFD v2 `c206da3e-…`. *(M)*
- [ ] **CA7. 🟡 `types.ts` drift — add `ghl_last_synced_from_field_value`** (used by `sync-ghl-contact` but missing from `frontend/src/integrations/supabase/types.ts`). Bundle with CA4. *(S)*
- [ ] **CA8. 🟢 SOP doc fixes in `Docs/CLIENT_ONBOARDING_SOP.md`:** (a) tag inconsistency — §5.13.1 says `bfd_setter-new_lead`, §5.13.5 Hop-1 says `1prompt - new lead`; pick one. (b) `llm_model` divergence — script hardcodes `openai/gpt-4.1-nano`, migration default is `google/gemini-2.5-pro`; document the intended default. (c) note edge fns live under `frontend/supabase/functions/`. (d) clarify canonical booking path is `bookings-webhook` (verifies), distinct from the unverified `sync-ghl-booking`. *(S)*

### Brendan-required — by severity

- [ ] **BR1. 🟠 Retell publish smoke (KNOWN OPEN ITEM).** Save Setter → publish on a live agent, then confirm `get-phone-number` shows the weighted `inbound_agents`/`outbound_agents` list pinned to the PUBLISHED version (not draft). Until this runs, "pinned to published" is unverified. $1 test call to TEST_PHONE_A (+61405482446) should use the new prompt. *(S)*
- [ ] **BR2. 🟡 Decide the intended `llm_model` for new clients** (`openai/gpt-4.1-nano` vs `google/gemini-2.5-pro`) so CA6/CA8 can encode it. *(decision)*
- [ ] **BR3. 🟡 (per client, at onboarding) Provision the 3 webhook secrets AND configure the upstream provider to send them.** Same as the security-review open item (line 21). NOTE: until **CA1** ships, setting these does nothing for the lead ingress / call-event paths. *(S per client)*

---

## 🔥 ACTIVE PUNCH LIST (refreshed 2026-05-24)

Outcomes doc + Phase 10 + Duplicate Setter session add-on:
**→ [Operations/handoffs/2026-05-22-outcomes-and-current-state.md §9 + §9b](../../Operations/handoffs/2026-05-22-outcomes-and-current-state.md)**

**Next-session prompt + persona prompts:**
**→ [Operations/handoffs/2026-05-24-finish-100pct-next-session.md](../../Operations/handoffs/2026-05-24-finish-100pct-next-session.md)**

### Batches shipped (no action needed)

- ✅ Batches 1+2 (2026-05-22): 14 numbered bugs + 2 UI gaps + Bug 6 hotfix. Tags from `phase-night-bug-27-twilio-default-phone` through `phase-night-bug-4-5-6-7-ui-17-18-batch2`.
- ✅ Try Gary landing ingress (`phase-night-try-gary-landing-ingress`, `0107bdb`).
- ✅ Batch 3 (2026-05-23): code-review fixes — reply_channel attribution + composite-filter IN-clause cap + retell-proxy empty-array log + dead-mock cleanup.
- ✅ Batch 4 (2026-05-23): Try Gary persona-slot routing infrastructure.
- ✅ **Bug 10 phone pin** (2026-05-24 prep session): PATCHed inbound + outbound from v37/v49 → v49/v49.
- ✅ **Bug 20 webhook_events** (2026-05-24 verify): slot 2 agent `agent_5ec5eb…` already shows `['call_ended', 'call_analyzed']` from Brendan's overnight Save Setter. No action needed.
- ✅ **Phase 10 n8n decom backend + frontend** (`937254d` + `a5c166d`): 89 LOC backend + 397 LOC frontend deletions. Trigger.dev `v20260524.1` + edge fns `receive-dm-webhook v14` + `sync-external-credentials v11` ACTIVE. **Schema DROP deferred 24h** — earliest 2026-05-25 ~17:30 AEST.
- ✅ **Duplicate Setter feature** (`dce4a75`, tag `feat-duplicate-setter`): new Copy-icon button on every Voice + Text setter card. One-click pure clone (no AI), distinct from existing AI-rewrite COPY. Edge fn `duplicate-setter-config` v1 ACTIVE. **Use this for Try Gary persona provisioning** — drops time-per-persona from ~30 min → ~5-7 min.
- ✅ **Crazy Gary allowlist** (`d4f3841`, tag `feat-try-gary-crazy-gary`): added `crazy-gary` to `TRY_GARY_VALID_STYLES` in ghl-tag-webhook v5. Routing ready once slot 8 is provisioned + map updated.

### Brendan-required tier 1 — apply prompt fix FIRST

- [ ] **1. Bug 29** — Apply recommended booking-flow prompt diff to BFD **slot 2** manually (~10m). Diff at `Operations/verifications/2026-05-22-bug29-slot-match-diagnosis.md`. Verify against v49 LLM (max published 2026-05-24). **DO THIS FIRST** so the fix propagates to slots 4-8 via the new Duplicate button.

### Brendan-required tier 2 — Try Gary persona provisioning (5 personas, much faster now)

- [ ] **2. Provision Voice Setter slot 4** — Duplicate BFD slot 2 → slot 4 via new Copy-icon button. Set agent_name = `Gary — Property Coach`. MODIFY SETTER WITH AI using the **Property Coach prompt** from the handoff doc. Save Setter.
- [ ] **3. Provision Voice Setter slot 5** — Duplicate → slot 5. Name = `Gary — Mortgage Broker`. MODIFY WITH AI using the **Mortgage Broker prompt**. Save Setter.
- [ ] **4. Provision Voice Setter slot 6** — Duplicate → slot 6. Name = `Gary — Finance Strategist`. MODIFY WITH AI using the **Finance Strategist prompt**. Save Setter.
- [ ] **5. Provision Voice Setter slot 7** — Duplicate → slot 7. Name = `Gary — Generic Demo`. MODIFY WITH AI using the **Generic Demo prompt**. Save Setter.
- [ ] **6. Provision Voice Setter slot 8 (crazy-gary)** — Duplicate → slot 8. Name = `Gary — Crazy Gary`. Switch voice to the weird ElevenLabs voice you made. MODIFY WITH AI using the **Crazy Gary prompt**. Save Setter.

(All 5 prompts are in the handoff doc verbatim, ready to paste.)

After each Save Setter, ping Claude with "slot N saved" — Claude runs the slot-N populated verify SQL + phone-pin drift check + re-PATCH if needed.

Once all 5 slots are saved + active, Claude auto-runs Step 2E:
```sql
UPDATE clients SET try_gary_persona_slots = '{
  "property-coach": 4, "mortgage-broker": 5, "finance-strategist": 6,
  "generic-demo": 7, "crazy-gary": 8
}'::jsonb WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';
```

### Brendan-required tier 3 — GHL provisioning (small, ~20 min total)

- [ ] **7. Bug 21** — Provision GHL Custom Conversation Provider + ping with provider_id (~10m). Doc: `Operations/verifications/2026-05-22-bug21-ghl-conversation-provider.md`.
- [ ] **8. Bug 22** — Create 2 GHL custom fields + ping with both field ids (~5m). Doc: `Operations/verifications/2026-05-22-bug22-ghl-call-custom-fields.md`.
- [ ] **9. Bug 26** — Generate GHL webhook secret + ping with the secret (~5m). Doc: `Operations/verifications/2026-05-22-bug26-ghl-webhook-secret.md`.

### Brendan-required tier 4 — marketing site (separate repo)

- [ ] **10. Add `crazy-gary` to the marketing site landing-page persona picker.** Backend allowlist is ready (ghl-tag-webhook v5). Out-of-scope for the bfd-setter repo; lives in the marketing site repo.

### Verification (passive — observe during normal use)

- [ ] **11. Bug 28** — Real C1 pickup + book test (~10m, ~$1 Retell). Auto-fires booking-confirm SMS to lead after booked appointment.
- [ ] **12. Bug 32** — Slow-replier SMS test (~5m). Multiple inbound SMS in quick succession; cadence should not lose the 2nd message.
- [ ] **13. Bug 2** — After next outbound call, GET BFD agent + confirm `enable_voicemail_detection=true, voicemail_detection_timeout_ms=15000`.
- [ ] **14. Try Gary smoke (deferred to separate session)** — 5 outbound Retell calls to TEST_PHONE_A, one per persona, verify each opening line matches its framing.

### Claude-side autonomous work (parallel during next session)

- [ ] **A. Phase 10 schema DROP** — once 24h soak passes (earliest 2026-05-25 ~17:30 AEST), Claude auto-runs `ALTER TABLE clients DROP COLUMN IF EXISTS text_engine_webhook` + verifies + reports. Pre-DROP snapshot already at `Operations/archives/2026-05-24-n8n-decom/clients-snapshot.json`. Auth was already explicitly given for Phase 10.
- [ ] **B. Bug 9 — inbound mid-cadence coordination** (~3-4hr). Now unblocked because Bug 20's `call_ended` subscription is active. Needs Trigger.dev signal pattern.
- [ ] **C. UI gaps 12 / 13 / 15** — visual polish needing browser walkthrough (~3hr total).
- [ ] **D. Code-review followups from prior session** — already shipped in batch 3 (2026-05-23). Confirmed no new code-review items to action.

Companion smoke docs: `/srv/bfd/Operations/verifications/2026-05-{21,22,23,24}-*.md`.

---

**State of play (2026-05-20 EVENING — per-direction agent fork shipped, SOP polished for Client #2 mock, Phase 10 audit done):**

- HEAD: `efa06f2` on Forgejo + GitHub. Session built on top of this morning's FINAL wrap (`c80de8a`); 4 commits + 1 tag.
- **🎯 Per-direction agent fork SHIPPED** — `phase-night-per-direction-agent-fork` (`18ed332`). Option A from the FINAL handoff's per-direction agent feature scoping. Backend new `case "fork-slot-direction"` in retell-proxy (v19 → v20 ACTIVE). Frontend Fork button on the EE1 safety-guard toast (renders only when 1 direction selected) + confirmation modal in `PromptManagement.tsx`. Per the no-internal-prompt-edits rule: pure CLONE (no LLM content mutation; same client owns source + fork). Brendan-side smoke checklist at `Operations/verifications/2026-05-20-evening-fork-feature.md`. **NOT exercised against BFD's live agent this session** — that's Brendan's smoke test when he wants to per-direction the agent.
- **📝 CLIENT_ONBOARDING_SOP.md polished** for tomorrow's Client #2 mock onboarding (`679a9ad` + `efa06f2`). 4 substantive additions: §4.1 INSERT template now includes `voicemail_config` + `timezone` columns; new §5.14 Sub-Account Settings sidebar click-path; new §5.15 Save Setter (voice picker presets + Fork button + publish-warning); new §C single-page mock onboarding checklist; new §D pre-sales prep punch list (pricing, provider decisions, compliance, soft-launch slot). +260 lines net.
- **🔧 Phase 10 n8n decommission AUDIT PREP done** at `Operations/audits/2026-05-20-evening-phase-10-n8n-decom-prep.md`. Soak confirmed clean (20 days since 2026-04-30 phase-9 cutover, BFD `use_native_text_engine=true` continuously). Full grep inventory: 1 active site in `trigger/processMessages.ts` lines 256-335 (dead else-branch), 1 dead select in `receive-dm-webhook:366`, 1 copy site in `sync-external-credentials:87`, 56 frontend refs across 7 files. Proposed deletion order + verification queries + rollback documented. **No code/SQL/Railway changes executed this session.** Cutover is a separate authorized session.
- **Task 1 verification:** BFD's `agent_5ec5eb…` Retell agent is at v47 draft (unpublished), v46 = latest published with `voice_id: 11labs-Brian`. The "publish silently failing" symptom flagged in the morning's FINAL handoff IS still present (1 unpublished draft from Brendan's last click). **Did NOT auto-republish** per the no-internal-prompt-edits rule. Brendan's call: publish v47 manually via Retell dashboard, or re-Save Setter (auto-publish runs again). Live calls fine on v46/Brian.
- **Edge fn versions on prod:** retell-proxy **v20** (was v19), push-contact-to-ghl v6, sync-ghl-contact v14, make-retell-outbound-call v11, ghl-tag-webhook v2, voice-booking-tools v10, retell-call-analysis-webhook v13.
- **Phase A8 soak:** day 12/14 (2 days remaining; ends 2026-05-23).
- **Today's tag count (2026-05-20 full day):** 9 functional tags + 6 docs commits.

**Brendan-side actions queued:**

1. **Mock onboarding walkthrough** of polished `Docs/CLIENT_ONBOARDING_SOP.md` against a fake "Client TestCo" (per §C + §D-self-tests). Time-box ≤6hr; surfaces any rough edges before the real Client #2 call.
2. **Fork feature live smoke test** when ready — see `Operations/verifications/2026-05-20-evening-fork-feature.md` Path A (~5min to walk).
3. **v47 publish** — optional, Brendan's call (publish via Retell dashboard, or re-Save Setter; live calls fine on v46).
4. **Pre-sales prep punch list (§D of SOP)** — pricing decision, provider account decisions, compliance verbiage, lead-source coverage scope, soft-launch slot booking with Client #2.
5. **Phase 10 cutover authorization** — when A8 soak hits 14/14 on 2026-05-23, give explicit Phase 10 GO (full sweep) / Phase 10 partial (backend only) / Defer.

**Open from prior sessions (still pending, unchanged this session):**

- **🚩 D25 EE6 Aria/"drowning in DMs" scrub** in BFD's `prompts.content` — Brendan-manual per the no-internal-prompt-edits rule.
- **🚩 BFD prompts.content "dynamic vars pre-loaded" line** — same Brendan-manual rule.
- **N3 PNG re-shoots** for setup-guide once Brendan does the Retell screenshot session.
- **Template JSONs URL sweep** (~42 hardcoded upstream URLs in `frontend/public/workflows/*.json` + `retell-agents/*.json`) — low urgency.
- **`elevenlabs-manage-agent/index.ts:57`** hardcoded URL — BFD doesn't use ElevenLabs; skip.

**Prior state of play (2026-05-20 FINAL — Save Setter working, all cleanup done):**

- HEAD: `d13b1c3` on Forgejo + GitHub (FINAL wrap docs commit lands on top).
- **Save Setter VERIFIED WORKING:** Retell agent v43-v46 all published with `voice_id: 11labs-Brian` in the last 2 min (Brendan's retry batch). v47 is latest draft (probably his most recent click). 6 unpublished drafts from earlier cleared. **Live calls now route to v46 (or current published) with Brian voice.**
- **🛡️ Safety guard CONFIRMED WORKING:** Brendan un-checked Outbound (follow-up) to test → guard fired with the FULL detailed error message (post-toast-parse-fix). Same behaviour as designed in `phase-e3-followup-ee1-safety-guard` (2026-05-18). NOT a bug — it's the EE1 wipe protection. Brendan wants per-direction agents (legitimate use case → feature request below).
- **Per-direction agent feature request scoped + DEFERRED to next session.** Option A (Fork to new agent button) is the recommended path. ~3 hr implementation. Details in handoff `2026-05-20-pm-verify-defects-and-railway-outage.md` + investigation doc `2026-05-20-save-setter-409-investigation.md`.
- **All BFD bookings cleanup complete.** DB table empty (0 rows). Both lingering GHL appointments cancelled via PUT (DELETE returned 401 IAM scope issue — `appointmentStatus: cancelled` worked via PUT). Cancellation-echo bookings row also deleted.
- **Edge fn versions on prod:** unchanged from AM (retell-proxy v19, push-contact-to-ghl v6, sync-ghl-contact v14, make-retell-outbound-call v11, ghl-tag-webhook v2).
- **Today's tag count (full day):** 8 functional tags + 4 docs commits.

**Prior state of play (2026-05-20 LATE-LATE — real Save Setter root cause found: broken Matt voice preset):**

- HEAD: `d931c25` on Forgejo + GitHub (Wrap-3 docs commit will land on top).
- **Railway deploy queue cleared.** All previously stuck commits deployed (`28636e7` + `85a88aa` + `3a7002f`). Status page back to operational.
- **Real Save Setter 409 root cause IDENTIFIED + FIXED:** It wasn't (only) the EE1 safety guard. The toast-parse fix (`28636e7`) deployed and revealed the actual error: `Retell API error [404]: Item 11labs-Matt not found from voice`. Brendan's saved voice was `11labs-Matt`, which doesn't exist in Retell's catalog (queried live: 311 voices, 0 match for Matt). Retell removed/renamed it at some point post the EE5 voice work (2026-05-16 to 2026-05-18). **Fix shipped:** `phase-night-remove-broken-matt-preset` (`d931c25`) removes Matt from the hardcoded preset list, replaces with `11labs-Brian` (verified live), corrects `11labs-Cimo` gender metadata (Retell reports female, BFD labelled male). Brendan must also pick a non-Matt voice in his picker + re-Save.
- **D37 cleanup complete:** Brendan confirmed GHL Calendar row 1 (`OfwxxJT9L5jO3IMGUTnn`) was a test ("Brendan Test-GHL-Form" contact). DB row deleted. Brendan to cancel the GHL appointment via the Calendar UI separately. **1 row remains** (`e69574ba-…` / `FZ2HiZvVBGbZ8VXBILIP` from 2026-05-13 11:30 AEST, past). Brendan's call whether to delete.
- **6 unpublished Retell drafts on BFD's `agent_5ec5eb`** still pending — once Brendan picks a valid voice + saves successfully, publish should complete and bring v43+ live. Surface fix (`3a7002f`) catches future cases.

**Prior state of play (2026-05-20 LATE EOD — verification walkthrough + 3 deploy-queued fixes):**

- HEAD: `3a7002f` on Forgejo + GitHub (Wrap-2 docs commit will land on top).
- **PM session ran the smoke walkthrough + surfaced 2 defects + 1 product feature request + 1 infra outage.** All defects fixed and committed; deploy queued due to Railway outage.
- **B.1-B.7 smoke walkthrough PASS** (every section confirmed by Brendan or me).
- **D37 cleanup partial:** 6 of 8 BFD bookings rows deleted via Management API DELETE (cancelled test rows). 2 confirmed rows remain pending Brendan's GHL Calendar check.
- **3 functional tags shipped today + queued for Railway deploy:**
  - `phase-night-save-setter-toast-parse-fix` (`28636e7`) — fixes the misleading "Make sure your Retell API key is configured" toast; surfaces real backend errors.
  - `phase-night-sub-account-settings-sidebar-fix` (`85a88aa`) — two SYSTEM-section sidebar items so agency can reach ClientSettings via UI.
  - `phase-night-surface-publish-warning` (`3a7002f`) — toast when Retell PATCH succeeds but auto-publish silently fails.
- **Defect to debug post-deploy:** Save Setter HTTP 409 on BFD's Voice-Setter-1. Either EE1 safety guard firing (with directions less than all 3 claimed) OR different 409 source. Real error surfaces once toast-parse fix deploys + Brendan retries. Investigation doc at `Operations/audits/2026-05-20-save-setter-409-investigation.md`.
- **Discovery:** BFD's `agent_5ec5eb` has 6 unpublished drafts (v43 draft, v37 last published). Live calls still use v37. Surface fix (`3a7002f`) catches future cases.
- **Railway outage 2026-05-19 22:29 UTC ongoing** — Google Cloud blocked Railway's account. Non-enterprise builds throttled. 3 commits stuck in queue. Status: [status.railway.com](https://status.railway.com/).
- **Feature request queued:** per-direction agent fork button (3 options scoped in `audits/2026-05-20-save-setter-409-investigation.md` — Option A recommended ~3 hr).

**Prior state of play (2026-05-20 EOD — sidebar bug fixed + D-sweep + 100% server verification):**

- HEAD: `191eca6` on Forgejo + GitHub (User Todos refresh below + the Phase J docs commit will land on top).
- **4 functional tags shipped 2026-05-20** + 1 docs commit:
  1. `phase-night-sidebar-agency-respects-visible-flag` (`1b6708c`) — root-cause fix for Brendan's "sidebar still has extra Analytics" complaint. Agency role no longer bypasses the visibility filter; `locked` no longer force-overrides `visible`. Latent bug from the 2026-05-18 sidebar cleanup work.
  2. `docs(campaign-playbook)` (`b6e37a5`) — 137-line §H carry-over from 2026-05-17 finally committed.
  3. `phase-night-n8-voicemail-detection` (`d1ce0a2`) — extended N8 with `enable_voicemail_detection` + `voicemail_detection_timeout_ms`. retell-proxy v18 → v19 ACTIVE. ClientVoicemailCard now has a Detection subsection.
  4. `phase-night-n3-setup-guide-text-rebrand` (`191eca6`) — D27 text-only swap "1Prompt" → "Building Flow" across ~13 SetupGuideDialog.tsx strings. PNG re-shoots still pending Brendan's screenshot session.
- **Server-side 100% verification PASS** (14/14): `Operations/verifications/2026-05-20-full-test-pass.md`. Brendan-side UI smoke walkthrough documented in same doc — pending Brendan's walkthrough.
- **3 audits delivered:**
  - `Operations/audits/2026-05-20-bfd-test-data-cleanup-d37.md` — 8 BFD bookings rows triaged for Brendan to pick which to DELETE (no unilateral deletes).
  - `Operations/audits/2026-05-20-cadence-v2-activation-status-d8.md` — **surprise: BFD's cadence v2 is ALREADY ACTIVE** (`auto_engagement_workflow_id = c206da3e-…`). User Todos / memory CV2-4 entry was stale. Optional cleanup of v1 dormant workflow documented.
  - `Operations/audits/2026-05-20-page-usage-audit.md` — covers D10-D17 + D18-D24. 22 questioned pages all route-mounted (4 are demo pages with static data → ARCHIVE candidates), 6 of 7 D18-D24 confirmed dead-import (RedirectToFirstClient is alive at App.tsx:162 — false-positive). No deletes this session — Brendan picks per the prior "don't delete yet" rule.
- **New rule established this session:** [[feedback_no_internal_prompt_edits]] — Claude does NOT alter internal LLM prompts unilaterally (prompts.content, voice_prompts.system_prompt, live Retell general_prompt, etc.). D25 EE6 Aria scrub + BFD prompts.content "dynamic vars pre-loaded" contradiction are flagged for Brendan-manual.
- **Edge fn versions on prod:** retell-proxy v19 (was v18), push-contact-to-ghl v6, sync-ghl-contact v14, make-retell-outbound-call v11, ghl-tag-webhook v2.
- **Phase A8 soak:** day 12/14 (ends 2026-05-23). Do NOT touch `clients.use_native_text_engine`.

**Brendan-side actions still pending:**

1. **Walk the Phase B section of `Operations/verifications/2026-05-20-full-test-pass.md`** — 8 UI smoke tests including the sidebar fix verification, voicemail detection toggle, quiet hours card, setup guide rebrand, N5 env-var-gated features, ClientMenuConfigEditor recovery test.
2. **Set 6 Railway env vars** per `Docs/RAILWAY_ENV.md` § Optional feature-flag vars if not already done.
3. **D37 — pick which bookings rows to DELETE** from `Operations/audits/2026-05-20-bfd-test-data-cleanup-d37.md` (or run the recommended 6-row DELETE inline).
4. **D8 — decide if v1 cadence workflow should be deactivated** (optional cleanup; functional impact = none).
5. **D25 + dynamic-vars contradiction** — both Brendan-manual prompt edits, paths documented in CHANGES_LOG row for `phase-night-n5-url-sweep` + memory `[[feedback_no_internal_prompt_edits]]`.
6. **N3 PNG re-shoots** — when ready, re-capture the Retell folder screenshots with "Building Flow" folder name and `git mv` the PNG file.

**Queued for next session (surfaced during 2026-05-20 verification walkthrough):**

- **Sub-Account Settings sidebar fix** — [`ClientLayout.tsx:967`](frontend/src/components/ClientLayout.tsx#L967) currently routes agency role to `/account-settings` (user-level) instead of `/client/<id>/settings` (per-client config: Timezone, Contact hours, Voicemail). Today there's no recurring UI path to ClientSettings for agency role; only the post-CreateClient redirect or direct URL. **Brendan picked Option A** during smoke test B.2: change the conditional so agency also routes to `/client/<id>/settings`. Single-line fix + label adjustment + tag `phase-night-sub-account-settings-sidebar-fix`. ~5 min.

**Defects + queued fixes from 2026-05-20 afternoon smoke walkthrough:**

- ✅ **Save Setter toast-parse bug FIXED** in `phase-night-save-setter-toast-parse-fix` (`28636e7`). PromptManagement.tsx read `retellError.context.body.code` but supabase-js wraps non-2xx in FunctionsHttpError where `.context` is a Response object. Now uses `await ctx.json()`. Same pattern as TEST CALL fix from 2026-05-18. **STUCK in Railway deploy queue** — Railway major outage as of 2026-05-19 22:29 UTC (Google Cloud blocked their account; non-enterprise builds throttled).
- 🚩 **Save Setter Retell sync failure** — Brendan getting HTTP 409 from retell-proxy on Save Setter. Either the EE1 safety guard is firing (with directions less than all 3 claimed despite UI showing all green), OR a different 409 source we haven't identified. The toast-parse fix above will surface the real error once Railway deploys it. **Investigation in progress** — pulled Supabase edge fn logs but the API has a delay; need to wait for Railway deploy + Brendan to retry.
- 🚩 **6 unpublished Retell agent drafts on BFD's agent_5ec5eb** — Agent is at v43 draft but `is_published: false`. Live calls still use the last published version (likely v37 from EE1 recovery 2026-05-18). LLM prompt has grown from 11,386 → 53,794 chars. Brendan's recent edits aren't going live. Related to the Save Setter failure above (every failed save creates an unpublished draft).
- **Queued: Save Setter publish_warning UI surface** — retell-proxy returns `data.publish_warning` when publish silently fails; frontend currently swallows it. Add a toast that fires when this field is set. Tag `phase-night-surface-publish-warning`. ~20 min.
- **Queued: per-direction agent "fork" button (feature request)** — Brendan wants to push 1 direction's prompt without re-pushing all 3. Today's EE1 safety guard correctly blocks this (would wipe shared agent). Three options to scope: (A) fork to new agent button (recommended, ~3 hr), (B) single-direction-update mode that skips fan-out (~1 hr, less safe), (C) per-direction agent always (~half day, schema/migration). Defer to next session for scoping.

**Railway outage 2026-05-19 22:29 UTC onwards:**

Cause: Google Cloud blocked Railway's account. Affects build pipeline + deployments. Non-enterprise builds throttled. Status page: [status.railway.com](https://status.railway.com/). Commit `28636e7` (toast-parse fix) is on GitHub `main` but stuck in Railway's queue. Commits before 2026-05-19 22:29 UTC (`1b6708c`, `b6e37a5`, `d1ce0a2`, `191eca6`, `9985214`) deployed cleanly before outage. **No action needed BFD-side — wait for Railway recovery, queued deploy will auto-fire.** Or manually trigger redeploy from Railway dashboard when throttle lifts.

**Prior state-of-play (2026-05-19 EOD — Phase E3 follow-up session closed):**

- HEAD: `16e9897` on Forgejo + GitHub (User Todos verification updates pending — will land in 2026-05-19 wrap commit)
- **8 functional tags shipped 2026-05-19** (full list in `Docs/CHANGES_LOG.md` rows 1-8):
  1. `phase-night-n6-remove-paste-in-diagnostic` — retell-proxy:342 diag deleted (v17)
  2. `phase-night-n9-deploy-scripts-canonical-location` — `/tmp/deploy_*` → `scripts/`
  3. `phase-night-n1-per-client-last-synced-from` — `clients.ghl_last_synced_from_field_value` (write + read sides)
  4. `phase-night-n2-types-ts-clients-drift-fix` — 16 missing clients columns added to types.ts
  5. `phase-night-n4-pun-quiz-rewrite` — Q1 + lesson sentence rewritten around BFD-setter concepts
  6. `phase-night-n5-url-sweep` — 11 hardcoded upstream URLs removed (credential-leak vector at ApiCredentials closed)
  7. `phase-night-n8-client-voicemail` — `clients.voicemail_config` + retell-proxy v18 `set-voicemail` + ClientVoicemailCard
  8. `phase-night-n7-client-quiet-hours` — ClientQuietHoursCard (runtime side already wired in runEngagement.ts)
- **2 items found already shipped in earlier phases:** N10 in `phase-11e` (`5ac5f12`), N11 in `phase-11c` (`159637a`). The 2026-05-18d handoff was authored from a stale assessment of these.
- **N3 deferred** per D2=B — pun + screenshots wait for Brendan's 30-min Retell screenshot session.
- **Edge fn versions on prod after this session:** retell-proxy v18, make-retell-outbound-call v11, push-contact-to-ghl v6, sync-ghl-contact v14, ghl-tag-webhook v2 (pre-existing).
- **3 open decisions answered at top of session:** D1=B (ClientSettings, not per-workflow), D2=B (defer N3 entirely), D3=A (build N10/N11 — found already-shipped).
- **NEW BFD-side Railway env vars required** to restore prior behaviour after N5 (see `Docs/RAILWAY_ENV.md` § Optional feature-flag vars): VITE_AI_PROMPT_WEBHOOK_URL, VITE_PROMPT_WEBHOOK_URL, VITE_SETUP_GUIDE_PROMPT_WEBHOOK_URL, VITE_TEXT_CHAT_ANALYTICS_WEBHOOK_URL, VITE_VOICE_CHAT_ANALYTICS_WEBHOOK_URL, VITE_COST_ESTIMATE_URL.
- **Latest handoff:** `Operations/handoffs/2026-05-19-phase-e3-followup-n1-n11-complete.md` (read FIRST next session).
- Phase A8 soak: day 11/14 (ends 2026-05-23). Passive watch continues.

**Prior state-of-play (2026-05-18 EOD):**

- HEAD: `5ff98af` on Forgejo + GitHub (or later if any further commits)
- **14 functional tags + 4 docs commits shipped 2026-05-18.** Full list in `Docs/CHANGES_LOG.md` rows 9-22.
- Brendan triaged the 37-item deferred list → authorized N1-N11 (action) + N12-N13 (research done) for next session.
- **Handoff:** `Operations/handoffs/2026-05-18d-audit-followup-and-next-session-prep.md`
- **3 open decisions** need Brendan's answer before next session executes: (1) D6+D7 UI location, (2) D27 screenshot strategy, (3) D4+D5 timing. Defaults documented in handoff §"Open decisions".
- Phase A8 soak: day 10/14 (ends 2026-05-23). Passive watch continues.

## Next session — Brendan's authorized work (N1-N11)

Per the 2026-05-18d handoff, focused on getting to Client #2 deploy level:

**Critical (Client #2 blockers):**
- ~~**N1** — D36 per-client `last_synced_from` GHL field~~ ✅ DONE 2026-05-19 in `phase-night-n1-per-client-last-synced-from`. Added `clients.ghl_last_synced_from_field_value text DEFAULT '1prompt-os'`. Patched both write side (push-contact-to-ghl/index.ts) AND read side (sync-ghl-contact/index.ts echo-loop guard). Header comments refreshed. SOP §4.1 + §4.4 + RUNBOOK § Add a per-client custom field id updated. push-contact-to-ghl v5→v6, sync-ghl-contact v13→v14. BFD's existing behaviour preserved by DEFAULT (row verified post-migration).
- ~~**N2** — D33 types.ts drift fix~~ ✅ DONE 2026-05-19 in `phase-night-n2-types-ts-clients-drift-fix`. Added 16 missing columns to `clients` Row/Insert/Update in `frontend/src/integrations/supabase/types.ts` (15 from the original audit + `ghl_last_synced_from_field_value` from N1). Two NOT-NULL columns (`timezone` text, `use_native_text_engine` boolean) typed without `| null`. `npx tsc --noEmit` clean. Other heavily-edited tables (prompts, engagement_*, bookings, leads) still clean per the prior audit; broader drift sweep deferred.

**Setup-guide rebrand (if Client #2 uses in-app setup guide):**
- **N3** — D27 setup-guide text rebrand (NEEDS Brendan re-shoot PNGs)
- ~~**N4** — D28 pun-quiz rewrite~~ ✅ DONE 2026-05-19 in `phase-night-n4-pun-quiz-rewrite`. Q1 in `MultiAgentLogicStep.tsx` rewritten away from "one prompt = one AI Rep" pun to BFD-setter setter-slot concept ("One configurable AI Rep with its own prompt, voice, and direction routing"). VoiceInboundLogicStep.tsx:427 lesson copy rephrased to remove the upstream "one prompt" framing AND the em-dash (per CLAUDE.md style rule). Q2-Q4 unchanged — Agent Number routing model applies to BFD-setter as-is.

**Recommended:**
- ~~**N5** — D26 EE7 hardcoded URLs sweep~~ ✅ DONE 2026-05-19 in `phase-night-n5-url-sweep` (partial — see deferred below). Removed 11 active-code hardcoded `n8n-1prompt.99players.com` / `us.1prompt.com` URLs across 9 files: 8 booking-widget literals in `PromptManagement.tsx` template strings → `<YOUR BOOKING LINK>` placeholder; credential-leak fallback in `ApiCredentials.tsx:391` (POSTed supabase_service_key + openai/openrouter/ghl keys upstream) → null-guarded skip; 5 `bcd89376` "Modify Setter with AI" upstream URLs (PromptChatInterface, AIPromptDialog, EmbeddedPromptChat) → `VITE_AI_PROMPT_WEBHOOK_URL` env var, throws cleanly when unset; 2 analytics chat URLs → `VITE_TEXT_CHAT_ANALYTICS_WEBHOOK_URL` + `VITE_VOICE_CHAT_ANALYTICS_WEBHOOK_URL`; `RefreshCostDialog` → `VITE_COST_ESTIMATE_URL`; `PromptManagement.tsx:61` + `SetupGuideDialog.tsx:1747` default-prompt fallbacks → `VITE_PROMPT_WEBHOOK_URL` + `VITE_SETUP_GUIDE_PROMPT_WEBHOOK_URL`; placeholder string in `WebhookConfig.tsx`. Docs/RAILWAY_ENV.md updated with all 6 new env vars + restore-prior-behaviour instructions. **Deferred (next sweep):** ~42 hardcoded URLs in `frontend/public/workflows/*.json` + `frontend/public/retell-agents/*.json` (downloaded client templates — should become placeholder `https://YOUR-N8N-HOST/webhook/...` style); `elevenlabs-manage-agent/index.ts:57` (BFD doesn't use ElevenLabs per Phase A3); 3 orphan Webinar components (`PresentationAgentChatInterface`, `WebinarPresentationAgentChatInterface`, `WebinarSetupGuideDialog` — kept per "don't delete anything" instruction). **HEAD set after this commit.**

**Cleanup wins:**
- ~~**N6** — D2 delete `retell-proxy:342` diagnostic console.log + redeploy v17~~ ✅ DONE 2026-05-19 in `phase-night-n6-remove-paste-in-diagnostic` (`2e4119c`). Diagnostic was at line 342 (not 177 as the handoff said — file had shifted post-v12/16). retell-proxy v17 ACTIVE.
- ~~**N9** — D34 move `/tmp/deploy_with_shared.mjs` to `/scripts/`~~ ✅ DONE 2026-05-19 in `phase-night-n9-deploy-scripts-canonical-location`. Both `deploy_with_shared.mjs` AND `deploy_retell_proxy_bundle.mjs` moved to `scripts/`. `Docs/RUNBOOK.md` § Deploys rewritten to point at the new paths + flag the legacy CLI method as deprecated (silently drops `_shared/` refs).

**Cadence settings (after Decision 1):**
- ~~**N7** — D6 Quiet hours editor~~ ✅ DONE 2026-05-19 in `phase-night-n7-client-quiet-hours`. No schema change — `clients.cadence_quiet_hours` jsonb and `trigger/runEngagement.ts` parseQuietHours + isWithinQuietHoursWindow + getNextQuietHoursStart already exist + wire correctly (read at runEngagement:710 with workflow.quiet_hours_override priority). New `frontend/src/components/setters/ClientQuietHoursCard.tsx` (24h time inputs for start + end + 7-day toggle row M/T/W/T/F/S/S + IANA timezone input defaulting to clients.timezone + live "Now in TZ: HH:MM — within window: Yes/No" preview). Wired into ClientSettings.tsx alongside the new voicemail card. BFD's `cadence_quiet_hours` is currently NULL → falls back to runEngagement default (09:00–21:00 Australia/Brisbane all 7 days); Brendan can now set it from the UI.
- ~~**N8** — D7 Retell-native voicemail~~ ✅ DONE 2026-05-19 in `phase-night-n8-client-voicemail`. SQL: `clients.voicemail_config jsonb DEFAULT '{"mode":"hangup","text":null}'::jsonb`. retell-proxy v17→v18 adds `set-voicemail` action that fetches all 10 retell_agent_id_* columns, dedupes, and PATCHes `voicemail_option` on each unique agent (hangup / static / prompt → Retell shape `{action: {type, text?}}`). New `frontend/src/components/setters/ClientVoicemailCard.tsx` (radio Hangup/Static/Dynamic + textarea + Save & Push button) auto-saves on hangup, requires text + explicit save for static/prompt, fires the set-voicemail action on save, surfaces patched/total Retell agent count in toast. Wired into ClientSettings.tsx below the Timezone block per D1=B (client-wide, not per-workflow). types.ts: added `voicemail_config: Json | null` to Row + Insert + Update.

**Conditional (after Decision 3):**
- ~~**N10** — D4 `ghl-tag-webhook` edge function~~ ✅ ALREADY DONE in `phase-11e` (`5ac5f12`). Verified 2026-05-19: ghl-tag-webhook edge fn deployed at v2 ACTIVE on bjgrgbgykvjrsuwwruoh. Handles ContactTagUpdate webhooks with HMAC-SHA256 sig verification (when `clients.ghl_webhook_secret` set), resolves client by `locationId`, looks up `is_active=true AND is_new_leads_campaign=true AND new_leads_tag IN <addedTags>`, idempotent on (client_id, ghl_contact_id, workflow_id) for non-terminal executions, fetches contact details from GHL, upserts `leads` row, fires Trigger.dev `run-engagement`. Tag-removal on terminal stop_reason is wired in `runEngagement.ts:653-666` (phase-11d). Source confirmed matches deployed version (only commit on file). The 2026-05-18d handoff's N10 entry was authored from a stale assessment.
- ~~**N11** — D5 NEW LEADS toggle on campaign cards~~ ✅ ALREADY DONE in `phase-11c` (`159637a`). Verified 2026-05-19: `frontend/src/pages/Workflows.tsx` has Switch + Tag input on each `SortableCampaignRow` (line 117-134). `handleNewLeadsToggle` (line 376-417) enforces at-most-one per client by UPDATEing all other workflows of the same `client_id` with `is_new_leads_campaign=false, new_leads_tag=null` before flipping the target ON. The 2026-05-18d handoff's N11 entry was also stale.

**Research delivered (skim plan file):**
- **N12** — D1 dynamic-vars injection flow explained (4 mechanisms, 1 is real)
- **N13** — D29-D32 strategic items assessed (all "wait for data" — defer)

## Skipped per Brendan

D3 (passive watch), D8 (BFD-only), D9 (Phase C — after N1-N11), D10-D17 (audit investigations), D18-D24 (dead-code deletes), D25 (EE6 Aria), D29-D32 (not actionable yet), D35 (irrelevant), D37 (test-data cleanup, anytime).

**State of play (2026-05-18 end-of-day, post frontend audit cleanup):**

- HEAD: `907aba5` on Forgejo + GitHub
- **12 tags shipped today total** (3 morning incident-response + 3 afternoon testing fixes + 5 evening audit cleanup + 1 hotfix):
  - Morning: `phase-e3-followup-ee1-incident-recovery` (`6416b01`), `phase-e3-followup-ee1-safety-guard` (`efeb73f`), `phase-e3-followup-test-call-error-ux` (`995773f`)
  - Afternoon: `phase-e3-followup-tz-propagation` (`82235aa`), `phase-e3-followup-setter-name-editor` (`9a9e556`), `phase-e3-followup-phone-first-contact-lookup` (`8e05ca6`)
  - Evening (audit cleanup): `phase-e3-followup-inline-rename-and-rep-nav` (`1480b9e`), `phase-e3-followup-sidebar-analytics-cleanup` (`c4745b2`), `phase-e3-followup-archive-webinar-legacy` (`52bc895`), `phase-e3-followup-rename-airep-setup` (`fcc9b71`), `phase-e3-followup-templates-sidebar-and-engagement` (`e8665d6`), `phase-e3-followup-merge-logs-tabs` (`57666b0` + hotfix `907aba5`)
- Edge fns deployed today: retell-proxy v13 → v16, make-retell-outbound-call v10 → v11
- Sidebar state: Analytics (single item, Text/Voice tabs internal), Engagement under OPS, new TEMPLATES section with Voice + Text AI Rep Templates, Logs with 3-tab nav. Analytics v2 hidden.
- 8 pages archived to `frontend/src/pages/_archived/` (7 Webinar + VoiceAISetter legacy). Files preserved.
- 2 page renames (Voice/Text AI Rep Configuration → Setup). Old URLs redirect.
- Carry-overs: BFD prompts.content "dynamic vars pre-loaded" contradiction (Brendan to choose path); EE-FOLLOWUP-1 paste-in diagnostic still in retell-proxy:177; A8 soak day 10/14.
- Latest handoff: `Operations/handoffs/2026-05-18c-frontend-audit-cleanup-handoff.md` (evening) + `2026-05-18b-...` (afternoon) + `2026-05-18-ee1-fanout-incident-handoff.md` (morning).

**State of play (2026-05-17, post Phase E3 + EE1-EE5 follow-up cleanup):**

- HEAD: `2c833bb` on both Forgejo origin AND GitHub
- Production: `https://app.buildingflowdigital.com/` (Railway-hosted, custom domain)
- Repo path: `/srv/bfd/Projects/bfd-setter/` (back-compat symlink at `.../1prompt-os/`)
- Brand hierarchy locked: **BFD** agency / **Building Flow** product / **Gary** persona (he/him) / **BFD-setter** codebase / `genokadzin/1prompt-os` upstream attribution only
- Phase A end-to-end verified, all 3 bugs closed, native text engine running for BFD
- Phase E1 (rebrand) ✅ DONE. Phase E2 (Lovable cleanup) ✅ DONE. E3 (Retell agents) ✅ DONE 2026-05-17 — full end-to-end voice booking PROVEN working: real GHL appointment `OfwxxJT9L5jO3IMGUTnn` created, `bookings` row `59780225-dfa5-49f7-95ca-c9f1ac486a1c` written via `bookings-webhook`. E4 (setup-guide screenshots), E5 (pun-quiz rewrite) deferred.
- Phase E3 punch list (EE1-EE5) ✅ ALL CLOSED 2026-05-17 in 5 commits: `3173670` (EE2), `b381d78` (EE5), `ff08a8f` (EE3), `f1fcd65` (EE1), `9f8e2f5` (EE4). EE6 (Aria scrub) and EE7 (~15 secondary hardcoded URLs) remain deferred at Brendan's direction.
- Cadence v2 draft at `engagement_workflows.c206da3e-...`, `is_active=false`; awaiting Brendan's eyeball + activation
- Latest handoff: `Operations/handoffs/2026-05-17b-phase-e3-punch-list-cleared-handoff.md`

## New punch list — Phase E3 follow-ups (2026-05-18 EE1-fanout incident)

Smoke test of EE1 (2026-05-17) exposed a shared-agent wipe bug. Recovery + root-cause guard shipped same session. New items below are deferred to a follow-up session.

- **EE1-SG. ~~Fan-out safety guard for shared-agent pushes~~ ✅ DONE 2026-05-18** in `phase-e3-followup-ee1-safety-guard` (`efeb73f`). retell-proxy v14: `syncVoiceSetter` aborts with HTTP 409 `agent_shared_across_slots` if the resolved `existingAgentId` is bound to multiple slot anchor columns AND the push's `directions` don't claim every shared column. Outer catch handler honors structured `.status`/`.code`/`.sharedColumns`/`.conflictingAgentId` fields (was flattening to 400). PromptManagement.tsx push-to-retell toast handler now detects `code === 'agent_shared_across_slots'` and shows a 12s actionable destructive toast.
- **EE1-UI. ~~Direction toggle active-state green styling~~ ✅ DONE 2026-05-18** in same commit. 3 `ToggleGroupItem` components in `frontend/src/pages/PromptManagement.tsx` get `data-[state=on]:!bg-green-500 !text-white !border-green-600` + `border-2 border-border` for inactive visibility. Fixes Brendan's "I can't tell which are on" problem (which contributed to the wipe scenario).
- **EE1-TC. ~~TEST CALL clearer error~~ ✅ DONE 2026-05-18** in `phase-e3-followup-test-call-error-ux` (`995773f`). make-retell-outbound-call v11: 4 validation paths emit `{error, code, hint, slot_id, slot_number}` structured JSON (`no_retell_api_key` 409, `no_agent_for_slot` 409, `invalid_voice_setter_id` 400, `no_contact_phone` 400). TestCallDialog.tsx extracts `error.context.json()` body to surface backend message + hint as toast description (10s) instead of "Edge Function returned a non-2xx status code".
- **EE1-RECOVER. ~~Restore live Retell + DB after wipe~~ ✅ DONE 2026-05-18** in `phase-e3-followup-ee1-incident-recovery` (`6416b01`). Recovery via `scripts/recover_bfd_voice_2026_05_18.mjs`: PATCHed LLM with Gary v3 prompt + gemini-3.0-flash → PATCHed agent name → publish → repoint phone v37 → DELETE orphan agent + LLM. SQL: refilled 3 `clients.retell_*_agent_id` columns + restored prompts.directions for slot 1 + DELETE orphan Voice-Setter-2 prompts row stub.
- **EE-FOLLOWUP-1. ~~Remove retell-proxy:177 voice paste-in diagnostic console.log~~ ✅ DONE 2026-05-19** in `phase-night-n6-remove-paste-in-diagnostic` (`2e4119c`). Actual location was line 342 not 177 (file shifted post-v12/16). retell-proxy v16 → v17 ACTIVE.
- **EE-FOLLOWUP-2. Phone-based inbound contact lookup (Phase 4.1)** — backend already supports it (`voice-booking-tools/index.ts:133-243` phone-first + `call.from_number` auto-injected). Only `bfdVoiceSetterPrompt.ts` lines 137-192 need updating to teach Gary to use phone-first on inbound. Blocked on Brendan's decision: when phone match returns a contact with different email than caller states, (a) trust phone, (b) ask to confirm email, or (c) ask for original email. Default recommendation (b). Scope: M (prompt edit + re-publish via `scripts/deploy_voice_prompt.mjs`).
- **EE-FOLLOWUP-3. ~~Setter renaming with Retell agent_name push~~ ✅ DONE 2026-05-18** in `phase-e3-followup-setter-name-editor` (`9a9e556`). Added a "SETTER NAME" Input at the top of the editor body (above the direction toggle), shown on every editor view (voice + text). Backend plumbing was already wired (promptContent.title → prompts.name → agentName → retell PATCH agent_name); just needed a visible Input bound to promptContent.title. NO schema change needed (prompts.name already exists, no display_name column required). NO edge fn change (retell-proxy already routes agentName). Multi-tenant safe (Retell names scoped per-API-key). Frontend auto-deploys via Railway.
- **EE-FOLLOWUP-4. ~~Phone-first contact lookup on inbound~~ ✅ DONE 2026-05-18 (master template + DYNAMIC_VARS_BLOCK; BFD prompts.content pending)** in `phase-e3-followup-phone-first-contact-lookup` (`8e05ca6`). Backend already supported phone-first (voice-booking-tools/index.ts: resolveContactId, toolLookupContact, auto-injection of call.from_number). Master template (bfdVoiceSetterPrompt.ts) rewritten: BOOKING FLOW Steps 6 + 6.5 + 7, DYNAMIC VARIABLES section, AVAILABLE TOOLS section. New clients get phone-first on provisioning. **For BFD specifically:** the auto-appended DYNAMIC_VARS_BLOCK (Phase 4) includes phone-first guidance on next push, so partial coverage automatic. Full integration into BFD's per-client prompts.content (44,888 chars currently claims "dynamic vars pre-loaded" — false on inbound) is deferred — Brendan to decide: (a) UI AgentConfigBuilder edit, (b) MODIFY SETTER WITH AI button, (c) authorize Claude SQL patch next session.
- **EE-FOLLOWUP-5. ~~TZ propagation (TZ Select + DYNAMIC_VARS_BLOCK templating)~~ ✅ DONE 2026-05-18** in `phase-e3-followup-tz-propagation` (`82235aa`). Root cause for the "Monday May 18" confusion in the booking test was the hardcoded `(ET)` in retell-proxy's DYNAMIC_VARS_BLOCK + empty inbound dynamic vars. retell-proxy v15: syncVoiceSetter SELECTs clients.timezone, templates `(${clientTimezone})` into the block, adds "when dynamic variables are EMPTY (common on inbound calls)" instructions teaching the agent to use get-available-slots to discover today's date instead of guessing. ClientSettings.tsx adds a Timezone Select with 17 IANA options. Brendan can self-serve TZ per sub-account without SQL. Existing live agents pick this up on next UI Push to Retell.

## New punch list — Phase E3 follow-ups (2026-05-17)

These items were surfaced tonight as side findings from the end-to-end test. They're all deferred to a future session per Brendan's direction.

- **EE1. ~~Voice AI Setter UI restructure: inbound/outbound mode toggle~~ ✅ DONE 2026-05-17** in `phase-e3-followup-ee1-direction-toggle` (`f1fcd65`). Shipped as MULTI-select rather than single-toggle per Brendan's clarification — each setter can now own any subset of {Inbound, Outbound (initial), Outbound (follow-up)}. New `prompts.directions text[]` column + backfill (BFD's slot 1 → all 3 directions). `ToggleGroup type="multiple"` rendered above AgentConfigBuilder on Voice-Setter slots; inline cross-slot conflict warnings ("X is currently owned by Voice-Setter-N; pushing will move it"). retell-proxy `fanOutDirections()` helper claims selected direction columns, releases unselected ones, and atomically rewrites sibling `prompts.directions` rows. Deployed retell-proxy v13. SLOT_TO_AGENT_COLUMN "primary anchor" mapping unchanged.
- **EE2. ~~retell-proxy auto-repoint phone-number agent_version after publish~~ ✅ DONE 2026-05-17** in `phase-e3-followup-ee2-phone-version-repoint` (`3173670`). New `repointPhoneVersionsAfterPublish()` helper called after each of the 3 `POST publish-agent` sites: captures the published version (with `GET get-agent` fallback if the publish response lacks it), reads `clients.retell_phone_1/2/3`, PATCHes each non-null phone with the slot-appropriate field (slot 1 → `inbound_agent_version`, slots 2 + 3 → `outbound_agent_version`, slots 4-10 → skip with log). Non-blocking try/catch so a bad phone doesn't fail the whole sync. Deployed retell-proxy v12.
- **EE3. ~~5 functions with legacy `deno.land/std@0.168.0/http/server.ts` imports~~ ✅ DONE 2026-05-17** in `phase-e3-followup-ee3-deno-serve-migration` (`ff08a8f`) + **regression fix** in `phase-e3-followup-ee3-regression-fix` (`565e775`). Sweep covered ALL 30 affected functions (Brendan's call). Initial commit replaced `import { serve } from "..."` + `serve(handler)` with `Deno.serve(handler)` and deployed via Management API simple PATCH. **Probe revealed 27/30 functions BOOT_ERROR** — Supabase's `--no-remote` flag ALSO blocks `https://esm.sh/*` and `jsr:*` imports (not just deno.land/std), AND the simple PATCH endpoint loses `../_shared/*.ts` references that CLI's previous deploys had bundled. Regression-fix commit migrated every `https://esm.sh/PKG@VER` → `npm:PKG@VER`, removed an unused xhr polyfill from generate-ai-prompt, inlined a small base64 encoder in process-lead-file (replacing the blocked `jsr:@std/encoding/base64`), and re-deployed all 30 via the multi-file bundle endpoint (`POST /v1/projects/{ref}/functions/deploy` with `multipart/form-data`) including the 4 `_shared/*.ts` modules. Post-deploy probe: 30/30 boot. `check-client-subscription` (critical for voice booking) returns 401 (was 503). **Future PRs must use `/tmp/deploy_with_shared.mjs` (multi-file bundle endpoint), NOT the simple PATCH template, when a function imports from `../_shared/`.**
- **EE4. ~~External call_history sync failed permanently~~ ✅ DONE 2026-05-17** in `phase-e3-followup-ee4-remove-external-call-history-mirror` (`9f8e2f5`). Removed the entire Step 4 external Supabase mirror block (~120 LOC) from `retell-call-analysis-webhook` along with orphan declarations: `externalSupabaseUrl/externalServiceKey` vars, `clients.supabase_url/supabase_service_key` reads, `EXTERNAL_STRINGIFIABLE_COLUMNS` constant, `safeJsonStringify` helper. Primary `call_history` insert on bfd-platform unchanged. Deployed v12.
- **EE5. ~~Voice paste-in still defaults to a different `custom_voice_xxx`~~ ✅ DONE 2026-05-17** in `phase-e3-followup-ee5-voice-paste-in` (`b381d78`). Retell-proxy diagnostic logs aged out before they could be inspected, so triaged from code analysis instead. Root cause in `RetellVoiceSelector.tsx`: the popover's open→close `useEffect` cleared `search` without firing `onChange`, so any paste not followed by Enter or button click was silently dropped on dismiss. Fix: on open=false transition, commit pending search via onChange if non-empty + differs from value + doesn't match a hardcoded preset name. Belt-and-suspenders `onBlur` on the input runs the same commit synchronously. Frontend auto-deploys on push. The retell-proxy:177 diagnostic console.log was KEPT (not cleaned up yet) so the next push captures evidence the fix worked — clean up in a follow-up.
- **EE6. Aria stale-data leak — RESEARCH ONLY, do not fix yet** — `prompts.content` on bfd-platform (`bjgrgbgykvjrsuwwruoh`) for BFD's Voice-Setter-1 slot has 1 case-sensitive Aria + 4 "drowning in DMs" mentions inside its 44,888-char content field. This is the PER-CLIENT PER-SLOT data row that the AgentConfigBuilder loads on UI open + saves back on UI close. The earlier SQL scrub on `voice_prompts.system_prompt` (bfd-setter-live external supabase) was on the WRONG table — the source-of-truth is `prompts.content` on bfd-platform. Brendan said NOT to fix yet (he can manually delete from final voice_prompts row if needed); just document for future. See handoff `Operations/handoffs/2026-05-17-phase-e3-end-to-end-verified-handoff.md` §"Aria builder investigation" for full data-flow trace. Scope: S (one SQL UPDATE on prompts.content) when ready.
- **EE7. ~15 secondary hardcoded upstream URLs** — flagged in `phase-e3-followup-2` commit message + Agent 2's inventory from earlier this session. Analytics webhooks, prompt webhook, webinar webhook, 11labs caller, us.1prompt.com widget URLs in copy templates, lovable.app origin headers in n8n workflow JSON templates, `1prompt-os` literal as GHL customField tag value. Same class of bug as the booking-tool URLs but lower urgency. Scope: M.

---

## Phase A — Make BFD live on the new stack (before sign Client #2)

These are sequential. 8 items. Total ~half day of effort spread over 2-3 weeks (most of the time is the soak window).

### A1. ~~Cadence copy review on workflow~~ `40e8bea3-…`  ✅ DONE 2026-05-03
- Workflow nodes restructured from `delay`-between-engages to `wait_for_reply`-between-engages so the Engagement editor canvas renders (3 schema bugs surfaced + fixed: `engagement_workflows` missing `sort_order`/`is_active`, `engagement_campaigns` missing `enroll_webhook_token`/`text_setter_number`, BFD's nodes incompatible with the editor's expected model).
- Copy edits applied via SQL in the same migration (n1 SMS dropped "Building Flow Digital", n2 timing 2m→1m, n4 timing 28m→1s, n7 SMS dropped "got a window today", n9 instructions stripped voicemail line).
- Editor at `/client/e467dabc-.../workflows/engagement?wf=40e8bea3-...` now renders cleanly. Cards visible on Campaigns tab.
- Tags shipped: `phase-night-engagement-workflows-missing-cols` (`9578fd5`), `phase-night-engagement-campaigns-missing-cols` (`9233674`), `phase-night-bfd-cadence-restructure-for-editor` (`4595805`).
- DO NOT enable auto-enrolment yet — that's A7.

### A2. Phase 9 cutover for BFD only  *(S, 10 min + 48h passive watch)*
- Wait until the next session ships D-M1 (diff harness — see "Next session prompt" below).
- Eyeball the diff between `processSetterReply` and n8n on 5 historical messages.
- If clean: `UPDATE clients SET use_native_text_engine = true WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';`
- Watch `error_logs WHERE source='process-setter-reply'` for 48 hr.
- Roll back instantly with the inverse SQL if anything spikes.

### A3. ~~Repoint Retell + ElevenLabs voice tool URLs~~  ✅ DONE 2026-05-04
- BFD has ONE Retell agent (`agent_5ec5eb…`) on ONE LLM (`llm_22e795de…`). The "3 agents" assumption in the original spec was wrong — only inbound is provisioned. ElevenLabs is not in active use for BFD, so its hardcoded URL was not touched.
- All 5 tool URLs repointed in the Retell UI from `https://n8n-1prompt.99players.com/webhook/e4cffeea-…` to `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/voice-booking-tools?tool=<name>&clientId=e467dabc-…`.
- `Authorization: Bearer <intake_lead_secret>` header added to all 5 tools (mandatory, not optional — `voice-booking-tools/index.ts:106-113` enforces 401 when the client has a secret set).
- End-to-end test passed: call `call_211ba69142d19f295bbcef6e904` (92s, agent_hangup, sentiment Positive) → `bookings` row `aa10c0dc-…` written with `source=voice_call`, `ghl_appointment_id=j1dUa0ySnaIr0KSdmHzH` (since cancelled + DB row deleted as test-data cleanup). Zero errors in `error_logs`.
- New artefacts: `Docs/WEBHOOKS.md` (every webhook URL in the system, per-client templates), `scripts/snapshot_voice_tools.mjs` (read-only inventory tool).
- Follow-ups (all closed 2026-05-06):
  - (a) `bookings.cadence_execution_id` null because A7 was off — A7 now flipped (see A7 below); next live booking should populate this.
  - (b) ✅ `call_history.appointment_booked` mapping fixed — `phase-night-a3-followup2-appointment-booked-mapping` (`72823a8`) extends the OR-chain to recognise Retell's `custom_analysis_data["Call result"] = "Call Booked"` shape.
  - (c) ✅ Voice-tool timezone default fixed — `phase-night-a3-followup3-timezone-default` (`c4499ed`) makes `get-available-slots` fall back to `clients.timezone` when none provided. BFD's default is `Australia/Sydney`.

### A4. ~~Wire GHL Calendar workflow → `bookings-webhook`~~  ✅ DONE 2026-05-05
- Two workflows shipped (one per status, since GHL workflow merge tags don't expose `appointmentStatus` / `calendarId` / `locationId` — those have to be hardcoded per-trigger):
  - **`BFD bookings → 1prompt (BOOKED)`**: Appointment Status trigger × 2 rows (filter=`new`, filter=`confirmed`) → Custom Webhook POST with `status=confirmed` hardcoded.
  - **`BFD bookings → 1prompt (CANCELLED)`**: Appointment Status trigger (filter=`cancelled`) → Custom Webhook POST with `status=cancelled` hardcoded.
- Both workflows POST `application/x-www-form-urlencoded` to `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook` with 8 key-value rows: `appointmentId={{appointment.id}}`, `contactId={{contact.id}}`, `calendarId=2p9eg0Qv7QoKknk1Sp2d` (hardcoded), `locationId=xo0XjmenBBJxJgSnAdyM` (hardcoded), `startTime={{appointment.start_time}}`, `endTime={{appointment.end_time}}`, `status=<confirmed|cancelled>` (hardcoded per workflow), `type=appointment`.
- Edge function patched: `bookings-webhook` now reads `clients.timezone` and parses GHL's TZ-naive merge-tag strings ("Tuesday, 5 May 2026 8:52 PM") as wall-clock time in that zone, returning ISO-with-offset before storing. Without this, Postgres parses the strings as UTC and stores `appointment_time` ~10 hours off for AU clients.
- Schema: `clients.timezone text NOT NULL DEFAULT 'Australia/Sydney'` added (migration `20260505100000_phase_night_a4_clients_timezone.sql`).
- End-to-end verified: API-created appt → workflow A fires in 5s → row written with `status=confirmed`, `source=ghl_calendar`, `appointment_time` correct UTC. Soft-cancel → workflow B fires in 5s → same row `status=cancelled`. Zero `error_logs`.
- **Known scaling cost (deferred to Phase C):** hardcoded `calendarId` + `locationId` means each new client needs their own pair of workflows on their own GHL location. Documented in `Docs/WEBHOOKS.md` for the SOP.

### A5. Voicemail audio (Twilio-direct path — interim)  *(S, 1 hr)*
- Today's stack uses Twilio AMD `<Play>{audio_url}</Play>` for voicemail-drop. The next session will migrate this to Retell-native (richer + dynamic). For now if you want voicemail-drop working today:
- Record one MP3 per voice setter slot. Host on Supabase Storage (or any public URL).
- Paste into `clients.voicemail_audio_url`:
  ```sql
  UPDATE clients
  SET voicemail_audio_url = '{"voice-setter-1": "https://…/setter1-voicemail.mp3"}'::jsonb
  WHERE id = 'e467dabc-…';
  ```
- After the next session ships the Retell voicemail integration (per the new-session prompt), this Twilio path will be retired and you'll configure voicemail via the Engagement editor's "Cadence Settings" bar instead.

### A6. Turn on signature verification (last)  *(S, 30 min)*
- Do this LAST among A1-A6 — once secrets are set, sig-mismatch returns 403 and could silently kill inbound. Want a known-good baseline first.
- Get + paste each provider's secret:
  ```sql
  UPDATE clients SET ghl_webhook_secret = '<from GHL → Marketplace → Webhooks v2>'
  WHERE id = 'e467dabc-…';

  UPDATE clients SET retell_webhook_secret = '<from Retell agent webhook config>'
  WHERE id = 'e467dabc-…';

  -- Unipile is not in active use yet for BFD — defer if not configured.
  ```

### A7. ~~Enable BFD auto-enrolment~~  ✅ DONE 2026-05-06
- Flipped: `UPDATE clients SET auto_engagement_workflow_id = '40e8bea3-b6f6-4562-98d1-f7e6599af6a1' WHERE id = 'e467dabc-…';` (1 row updated).
- Pre-flight clean: `engagement_workflows.40e8bea3-…` is_active=true, 9 nodes, zero `[BRENDAN:…]` placeholders, `clients.subscription_status='active'`, `clients.timezone='Australia/Sydney'`.
- Auto-enrolment fires from `sync-ghl-contact/index.ts:380-400` (GHL Contact Created webhook path) and `intake-lead/index.ts:136-250` (web form path). `receive-twilio-sms` does NOT auto-enrol (existing-leads-only by design).
- Tag: `phase-night-a7-bfd-auto-enrolment-on` (`e4beaca`). Logged in `Docs/CHANGES_LOG.md` with revert SQL.

### Phase A end-to-end real-lead tests  ✅ ALL PASSED 2026-05-09
Live test of Phase A using Brendan's own phone (+61405482446). Three scenarios. Surfaced 4 real bugs that were fixed in-session before the gate could close.

| Test | Result | Notes |
|---|---|---|
| 1. Voice-booking happy path | ✅ PASS | Lead intake → SMS → call → tool-booked Friday 8 May 10:30 AM AEST. `bookings` row `7ad909cf-…`, `call_history.appointment_booked=true`, cadence stop_reason=`booking_created`. Booking soft-cancelled in cleanup. |
| 2. SMS reply path | ✅ PASS | "Hi" reply → cadence stop_reason=`inbound_reply`. AI setter reply landed at +1m58s ("Hey there! So, just to get us on the right track..."). |
| 3. STOP keyword opt-out | ✅ PASS | STOP → `lead_optouts` row, `setter_stopped=true`, cadence stop_reason=`setter_stopped`, no further outbound, "You've been unsubscribed" compliance reply received. |

Bugs surfaced + fixed mid-session:
1. `intake-lead` + `sync-ghl-contact` auto-enroll trigger payload missing `make_retell_call_url` → `runEngagement` threw at first phone_call node.
2. BFD `clients.retell_outbound_agent_id` + `retell_outbound_followup_agent_id` were NULL — cadence references Voice-Setter-2/3. Filled both slots with the single existing agent (`agent_5ec5eb…`) via SQL UPDATE.
3. `intake-lead` + `sync-ghl-contact` trigger payload missing `contact_fields.phone` → `make-retell-outbound-call` returned 400 "No phone number provided".
4. `runEngagement.isCancelled()` only checked `engagement_executions.status`, not `leads.setter_stopped` → STOP cancellation lost the race with cadence advance, voice call fired post-STOP. Extended `isCancelled` to also check `leads.setter_stopped` and self-cancel the exec with `stop_reason=setter_stopped`. Trigger.dev redeployed to `v20260509.2`. Also pinned `@supabase/supabase-js` to `2.101.0` (a transient bump to 2.105.x broke Trigger.dev runtime via eager WebSocket init on Node 21).

Tag: `phase-night-a-end-to-end-verified`. Phase A officially closed pending the A8 soak.

Punch list (deferred to follow-up sessions):
- (a) ~~Voice agent fetched slots in `America/New_York` despite `clients.timezone=Australia/Sydney`~~ **✅ DONE 2026-05-14 in commit `05106aa`.** Three fixes: (1) `make-retell-outbound-call` edge fn now SELECTs `clients.timezone` and uses it as the default for the `tz` resolution (4 hardcoded `America/New_York` defaults removed). (2) BFD's `voice_prompts` row patched: "Eastern time" → "Sydney time" in the tz-inference fallback; IANA example "America/New_York" → "Australia/Sydney". (3) BFD's Retell LLM `general_prompt` patched with the same 2 strings + `POST /publish-agent` so the live agent uses the new prompt. New `current_timezone` dynamic var passed to Retell so future prompts can reference `{{current_timezone}}` directly. Verification: next outbound call's `pre_call_context.metadata.timezone` should be `Australia/Sydney` and the agent should say "Sydney time" not "Eastern time" in the inference fallback.
- (b) ~~Cadence node n4 (`wait_for_reply` after phone_call) has `timeout_seconds=1`~~ — the n4=1s timing is now intentional: `runEngagement.ts` blocks past every `phone_call` channel until the matching Retell `call_ended` webhook lands (commit `571e18f`, tag `phase-night-bug1-call-outcome-coordination` 2026-05-13). Once call_ended arrives, classification decides: human pickup + `treat_pickup_as_reply=true` → terminate with `stop_reason='call_engaged'`; missed/voicemail/no_connect → advance to next channel (n5 missed-call SMS). New column `engagement_executions.last_call_outcome JSONB` is the coordination primitive. Trigger.dev `v20260513.1` deployed. Verified on the next live test (run after deploy).
- (c) Retell `custom_analysis_data.success_rate` is a boolean — looks like a schema typo.
- (d) ~~Manual end-to-end test from the BFD website lead form~~ **✅ DONE 2026-05-13.** Full chain verified end-to-end (form → tag → Add Lead to 1Prompt OS → sync-ghl-contact → engagement_executions → Trigger.dev → Twilio SMS → Retell call → booking via voice-booking-tools → bookings-webhook → cadence terminated with `stop_reason: booking_created`). Brendan answered the AI call live, booked an appointment for 11:30 AM Sydney. See handoff `Operations/handoffs/2026-05-11-ghl-to-1prompt-wiring.md` §D. Also surfaced + fixed `clients.sync_ghl_enabled` column gap (types.ts drift hit #3 — see memory `feedback_types_ts_drift`). New SOP section landed: `Docs/CLIENT_ONBOARDING_SOP.md` §5.13 documents the snapshot Pattern B ingress (form → tag → Add Lead to 1Prompt OS → sync-ghl-contact).
- (e) ~~Twilio error extraction bug at `trigger/runEngagement.ts:171`~~ **✅ DONE 2026-05-14 in commit `756c7bd`.** Two files fixed (`runEngagement.ts:201-208` `sendTwilioSmsAndStamp` + `processMessages.ts:413-417` AI setter reply path). Helper external return shape (`errorCode`/`errorMessage`) preserved so call sites unchanged. Deployed Trigger.dev v20260514.1. Next 21610 (or any Twilio failure) will now surface the real carrier code/message instead of `? unknown`.

### A8. 14-day soak  *(passive, watch 15 min/day)*
- Three queries to run daily. Scheduled agent will check `error_logs` + `cadence_funnel` automatically (see /schedule below) and ping you if anything breaks.
- **Funnel:** `SELECT * FROM cadence_funnel WHERE client_id='e467dabc-…' AND day=current_date;` Watch `leads_replied/leads_texted` — should be ≥ ~10%.
- **SMS errors:** `SELECT status, error_code, count(*) FROM sms_delivery_events WHERE received_at > now()-interval '24h' AND status IN ('failed','undelivered') GROUP BY 1,2;`
- **Trigger.dev console:** filter `process-setter-reply` + `run-engagement` by FAILED.
- **Retell dashboard:** call quality on `agent_5ec5eb`.

---

## Phase B — UI / config improvements (parallel with soak)

The next session's prompt covers all of these technically. You don't need to do anything for B unless the new session prompts you for a decision.

- B1. **Quiet hours editor** in the Engagement editor "Cadence Settings" top bar — per-workflow override + client-default fallback.
- B2. **"NEW LEADS" toggle** on each campaign card in the Workflows list — at-most-one per client; flipping ON for one auto-flips OFF the previous. Tag (e.g. `new-lead`) entered inline.
- B3. **Reactivation campaigns work independently.** No UI work needed; the toggle from B2 is additive.
- B4. **Voicemail config** in "Cadence Settings" — radio: Dynamic (LLM-generated per call) vs Static text. Pushed to Retell `voicemail_option` agent setting via the existing `retell-proxy` function. Replaces the Twilio AMD path from A5.
- B5. **`ghl-tag-webhook`** — new edge function. Receives GHL contact-tag-added webhook, enrols the lead in whichever workflow has `is_new_leads_campaign=true AND new_leads_tag = <added_tag>`. Tag is removed at cadence end.
- B6. **GHL Custom Conversation Provider** *(S, ~10 min)* — provision a Custom Conversation Provider for BFD inside GHL Marketplace (Settings → Marketplace → Custom Conversations Provider, or via the developer portal), then `UPDATE clients SET ghl_conversation_provider_id = '<id>' WHERE id = 'e467dabc-...';`. **Optional** — until you do this, the SMS body mirror (closed 2026-05-02 in `phase-night-ghl-push-gaps-2-3`) falls back to writing GHL Notes (`POST /contacts/{id}/notes`) which appear on the contact's Notes tab. Once the provider id is set, mirroring switches to real Conversation messages on the Conversations tab. Both work; Conversations is the polished path.
- B7. **Email channel for engagement cadences** *(~~L, 1-2 days dev~~ ✅ DONE 2026-05-13 in `phase-cadence-v2-mvp` Day 3)* — `EngageChannel.type` extended to `"sms" | "whatsapp" | "phone_call" | "email"`. Send path: GHL Conversations API `POST /conversations/messages` with `type: "Email"` (helper `pushEmailToGhl` in `trigger/_shared/ghl-conversations.ts`), Notes fallback if the GHL location has no email infra. Email channel carries `subject`, `body_format` (default html), `from_email?` fields. `cadence_metrics.emails_sent` counter wired. Used live in BFD v2 cadence Phase 2 (n13, n21) + Phase 3 (n23, n25, n27). Engagement editor channel picker NOT yet updated (Phase B follow-up — UI-only). Reply detection via `message_queue` is channel-agnostic so existing wait_for_reply behaviour is preserved.

## Phase B — Cadence v2 follow-ups (2026-05-13)

The cadence-v2 MVP shipped in one session as 5 commits (`35d1925` → `524ac08`). These are the deferred items the plan called out as out-of-scope for the MVP:

- **CV2-1. Multi-workflow enrollment state machine.** New table `engagement_enrollments (lead_id, workflow_id, status, paused_until, reactivation_trigger)` so a lead can transition between Hot Pursuit / Cool Down / Long-Tail / Re-engage workflows rather than living in one big workflow forever. Today's v2 keeps everything in one workflow (`c206da3e-…`). XL effort.
- **CV2-2. Long-tail nurture workflow.** Today's v2 ends with `stop_reason='sequence_complete'` at Day 21 and the lead drops. Build a SECOND workflow (weekly or bi-weekly email-only drip) that gets enrolled after sequence_complete, OR after `tagged_silent_after_engagement=true` from nudgeColdReply. Requires CV2-1 to be clean.
- **CV2-3. Behavioral re-warm triggers.** Email link clicks (need click-tracking infra; GHL Conversations does NOT track clicks by default) and GHL pricing-page-visit events should re-enrol the lead into a "Re-engage" workflow. L effort + GHL custom field setup.
- **CV2-4. Activate BFD v2.** v2 workflow `c206da3e-…` is `is_active=false` today. Brendan to eyeball in the Engagement editor canvas first, then run the 3-step activation SQL documented in `Docs/CADENCE_DESIGN.md` v2 section.
- **CV2-5. Engagement editor support for the email channel.** UI-side work (`frontend/src/pages/Engagement.tsx`) — channel picker doesn't render an "email" option yet. Today email channels exist only in the JSON. M effort.
- **CV2-6. Per-tenant timezone-aware nudgeColdReply cron.** Current cron is `0 6 * * *` (06:00 UTC = Sydney 16:00 — fine for BFD). Multi-tenant: either run multiple cron tasks (one per region) or check lead-local-time inside the loop. M effort.
- **CV2-7. Brand voice prompt overrides.** `clients.brand_voice` column (NEW) + per-workflow override on `engagement_workflows`. `aiGenerateEngagementCopy` already accepts `brandVoice`; just wire it from the DB row. S effort.
- **CV2-8. Cost ceiling: per-week + per-month aggregates.** Today's guard is per-lead (>500c/lead → error_logs warning). Add per-tenant rolling-window aggregate so a runaway tenant gets flagged before any individual lead does. S effort.

## Phase B addenda — operational tasks (Brendan-side, no BFD-setter code)

- B-OP1. **GHL appointment reminder workflows.** Per `Docs/FUTURE.md`, these live in GHL natively, not in BFD-setter code — `bookings-webhook` (Phase 7c, A4-wired) ends the active BFD-setter cadence on appointment-create so GHL reminder workflows can run unimpeded. Build in GHL Workflows once Phase A is closed:
  - 24h-before reminder (SMS + email)
  - 1h-before reminder (SMS)
  - At-appointment-time auto-trigger (optional — could fire a Retell call to confirm the lead is ready)
  - Post no-show follow-up (SMS + book-new-time link)
  - Effort: half-day for Brendan in GHL UI. **No BFD-setter code change required.** BFD-setter cadences must NOT include reminder nodes — that's GHL's territory and prevents double-messaging.

---

## Phase C — Onboard Client #2

Once BFD has been live cleanly for ≥ 14 days.

### C1. Read the SOP front-to-back  *(M, 45 min)*
- `Docs/CLIENT_ONBOARDING_SOP.md` (created this session).
- Sections: pre-sales discovery, info collection, pre-provisioning, DB provisioning SQL, external wiring, cadence review, dry-run, soft launch, debug pitfalls, offboarding.

### C2. Run pre-sales discovery (SOP §1)  *(M, 30 min call)*

### C3. Run info collection call (SOP §2)  *(M, 1 hr call)*

### C4. Provision the client (SOP §3-§5)  *(L, half day)*
- Create their external Supabase project + seed tables (SOP has the exact CREATE TABLE statements).
- INSERT clients row with the SQL template from §4.1.
- Create per-client GHL `last_synced_from` custom field (the next session will ship D-M5 which moves this from a hardcoded BFD constant to a per-client column — until then, paste it into the constant + redeploy).
- Clone the default workflow.
- Configure GHL workflows (Send Setter Reply + Bookings webhook).
- Repoint the client's Retell agent tool URLs.
- Twilio inbound webhook on each of their phone numbers.
- Embed `intake-lead` snippet on their website.

### C5. Cadence copy review with the client (SOP §6)  *(M, 1 hr)*

### C6. Dry-run synthetic + real (SOP §7)  *(S, 30 min)*

### C7. Soft launch — 5 real leads with client present (SOP §8)  *(M, 1 hr screenshare)*

### C8. Hand off, monitor week 1  *(passive)*

---

## Phase D — Strategic decisions (defer until 30 days post Client #2)

- D1. **Pricing.** Held until 30 days of cost-per-booking data exists. Charge Client #2 cost-plus or flat retainer in the meantime.
- D2. **Phase 10 — n8n decommission.** After ≥ 14 days clean on `use_native_text_engine = true` for BFD: delete the `else` branch in `processMessages.ts:209`, drop `clients.text_engine_webhook` (optional), shut down the n8n service on Railway.
- D3. **Multi-Twilio failover.** If Client #2-N's combined volume exceeds a single Twilio account's safe ceiling.
- D4. **Cost-per-booking analytics dashboard.** Currently only schema is there (`cadence_metrics`). Add a real frontend page once you have 60 days of data.

---

## Phase E — Cleanup & Rebrand (do later, before Client #2 onboarding gets serious)

- E1. ~~**Rebrand the project from "1prompt" to "BFD-setter"**~~ **✅ DONE 2026-05-14** — Aria→Gary (he/him), 1prompt→Building Flow (customer-facing) / BFD-setter (internal), upstream Geno/Katherine/Eugene Kadzin/Quimple/1Prompt name-swapped in default templates, n8n workflow booking titles updated, Retell agent JSON templates in `frontend/public/retell-agents/` replaced with Gary persona. ~45 files modified across docs, frontend UI, n8n templates, Retell JSONs. Live infra (n8n URLs, GHL tag/workflow names, Retell agent IDs, package.json `name`, shipped migrations) intentionally untouched per hard constraints. Original touch points (now historical):
  - `User Todos.md` and all `Docs/*.md` references to "1prompt-os" / "1Prompt"
  - `frontend/package.json` `name` field, `frontend/.env.example` comments
  - `frontend/supabase/functions/*/index.ts` header comments mentioning "1prompt-os"
  - The hardcoded `"AI Strategy with Eugene x 1Prompt"` booking title fallback in `voice-booking-tools/index.ts` (replace with BFD-tenant default; the per-client `clients.gohighlevel_booking_title` already overrides)
  - The Retell agent prompts (currently the upstream "Anne / Eugene from 1Prompt" persona; see `/srv/bfd/Company/knowledge/voice-agents/1prompt-upstream-voice-setter-prompt.md` for the full text to replace)
  - `Operations/handoffs/*` newer docs are already "BFD"-leaning; older 1prompt-named files are historical and can stay as-is
  - GitHub repo name (`TheBrendonly/1prompt-os` → `TheBrendonly/bfd-setter` if/when desired; coordinate with any external integrations that reference the URL)
- E2. ~~**Remove all Lovable/dev-tool leftovers and document that this project runs on Railway**~~ **✅ DONE 2026-05-14** — Deleted `frontend/.lovable/plan.md` (the only tracked Lovable artifact; a stale support-popup plan referencing `eugene@quimple.agency`). Confirmed `frontend/vite.config.ts` has no Lovable plugins and `frontend/package.json` has no `lovable-tagger` dep. Added "Deployment topology" section to `Docs/RUNBOOK.md` and a topology block to `README.md` locking the four-layer stack (Railway frontend, Railway n8n, Supabase edge-fns + DB, Trigger.dev background tasks) with "Lovable hosts nothing for BFD" disclaimer. `Docs/RAILWAY_ENV.md` is now linked from both as canonical env reference.
- E3. ~~**Voice agent prompts: full BFD rewrite (Retell-side).**~~ **✅ DONE 2026-05-15.** Scope α: rewrote only the one LLM that's actually wired into BFD's `clients` row today — `llm_22e795de19b4d25cb579013586be` via agent `agent_5ec5eb129f3165cfa07b581a1a`. Discovery during planning: the other 2 LLMs (`llm_692b220d…` outbound, `llm_1807516860…` outbound followup) exist in Retell but are orphaned — every BFD voice call (inbound + cadence-outbound + followup) routes to the single inbound agent today, so rewriting the orphaned LLMs would be staged work with zero live impact and was deferred. Pre-rewrite state: 53,154-char Gary-renamed-but-upstream-scaffolded prompt with `Aria`/`Eugene` example transcripts still inside + the 2-string Sydney patch from Bug 2 closeout. New prompt: 11,386 chars (v3 2026-05-15 in `frontend/src/data/bfdVoiceSetterPrompt.ts`); opens with proactive AI disclosure in sentence 1 (`"Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital. Just so you know, this call is being recorded for quality. What can I help you with?"`) — closes the ASIC misleading-conduct gap that the prior prompt had open; full canonical Gary tone (filler words, verbal nods, interruption rule, text-slang ban, AU spelling, first-name-only, max 1 exclamation, deflection rule, founder backstory); preserved verbatim the 3-question qualification flow, the 7-step booking flow + 6 tool descriptions with `startDateTime`/`endDateTime` ISO format + `Australia/Sydney` IANA default, and the objection responses table (AU-tone-passed). Also fixed `scripts/deploy_voice_prompt.mjs` (Windows path → cross-platform; added `POST /publish-agent` step) and the same path bug in `scripts/update_voice_prompts_setter1.mjs`. Deployment: HTTP 200 PATCH + 200 publish; agent version 24 → 25; model `gemini-3.0-flash` preserved. Read-back jq verifies AI + recording disclosure present, zero `Aria`/`Eugene` leaks remain in the live LLM. Pre-rewrite backup at `/srv/bfd/Operations/handoffs/2026-05-15-e3-pre-rewrite-backup-llm.json` (+ `...backup-agent.json`) for revert. Live test calls (Brendan-side) deferred to next session — see `Operations/handoffs/2026-05-15-phase-e3-voice-agent-rewrite.md`.
- E4. **Retell-folder setup-guide screenshots re-shoot.** `frontend/src/components/SetupGuideDialog.tsx` lines 6090, 6151, 6207, 6521, 6527, 6794, 7104, 7110 (and the `retell1PromptFolder` asset import at line 148) tell admins to create a Retell folder literally named "1Prompt" and the paired screenshots show that folder name. After all client testing is fully complete, decide on the canonical BFD folder name ("Building Flow" recommended), update the instruction text + button labels in `SetupGuideDialog.tsx`, re-shoot the matching screenshots in Retell with the new folder name, replace `frontend/src/assets/setup-guide/retell-1prompt-folder.png` (and any other screenshots showing the old folder name), and update the asset import + alt-text. Deferred from the 2026-05-14 rebrand pass because re-shooting screenshots without first locking the new folder convention risks two divergences (text says X, screenshot still says Y). DO BEFORE next client onboarding.
- E5. **Upstream pun-quiz lesson rewrite.** `frontend/src/components/setup-guide/MultiAgentLogicStep.tsx` lines 71-75 and `frontend/src/components/setup-guide/VoiceInboundLogicStep.tsx` line 427 contain quiz/lesson content that puns on the upstream project name ("one prompt = one AI Rep"). In BFD-setter the pun loses its connection to the product name. Rewrite the quiz questions and inbound-voice-architecture lesson around BFD-setter concepts (setter slots / `text_prompts` table model, voice-prompt three-section composition) rather than the upstream pun. Deferred because this is content rewrite (not a rename), not blocking, and admins onboarding before the rewrite still get the upstream-style lesson which is internally consistent.

---

## Reference

- **Webhooks (every URL in the system):** `Docs/WEBHOOKS.md`
- **Master plan:** `Docs/MASTER_PLAN.md`
- **Master state-of-play (handoff):** `Operations/handoffs/2026-04-30-1prompt-master-rebuild-handoff.md`
- **Onboarding SOP:** `Docs/CLIENT_ONBOARDING_SOP.md`
- **Changes log (every shipped phase + revert command):** `Docs/CHANGES_LOG.md`
- **Runbook (deploys, rollback, incident playbooks):** `Docs/RUNBOOK.md`
- **Cadence design + tone notes:** `Docs/CADENCE_DESIGN.md`
- **Tracking funnel SQL:** `Docs/TRACKING.md`
- **Future / out-of-scope items:** `Docs/FUTURE.md`
- **Next-session prompt for the developer:** `Docs/NEXT_SESSION_PROMPT.md`
