---
description: BFD-setter Session 1 (voice reliability — B-1/B-3/B-5) closeout + the emitted Session 2 (security/quality sweep) prompt.
---

# BFD-Setter — Session 1 (Voice reliability) closeout — 2026-06-25

Relay step done. SESSION_PLAN Session 1 closeout + the Session 2 prompt. Plan mode was used (live voice path); approach approved before edits.

## What shipped (deployed: retell-proxy v45, duplicate-setter-config v8; frontend tsc clean, rides next Railway deploy)

- **B-3 — outbound phone now auto-follows latest published.** `repointPhoneVersionsAfterPublish` now writes `agent_version: "latest_published"` (the string Retell's `AgentVersionReference` accepts — confirmed in docs) instead of a numeric pin, for every direction a phone already routes to the saved agent. This matches the inbound binding and makes the phone immune to the stale-pin class (out-of-band publishes, `set-voicemail` drafts, manual dashboard publishes). `AgentWeight.agent_version` widened to `number | string`.
- **B-5 — default-vars net now actually persists. ROOT CAUSE FOUND.** `default_dynamic_variables` is **NOT an agent field** — Retell silently ignores it on `update-agent`/`create-agent` (verified live on a throwaway agent: PATCH then read-back returned `null`). It lives on the **retell-LLM**. The v43 "belt-and-suspenders" set it on the agent payload, so it never stuck. Fix: moved the empty-string net (`EMPTY_LEAD_DEFAULTS`, DRY const) onto `llmPayload` in `syncVoiceSetter`, and reassert it on rename via `update-retell-llm/{draft.llmId}` in `set-agent-name`. **Verified end-to-end on a throwaway agent**: create-LLM-with-ddv → create agent → mint draft → update-retell-llm(ddv) → publish agent → the published agent's served LLM carries `{first_name:"", …}`. (Conversation-flow agents have no LLM and the field is LLM-only, so CF is N/A — not relevant to the live retell-llm BFD agents.)
- **B-1 — setter rename cascades to one name everywhere.** SoT = `clients.setter_display_names['voice-<N>']` (the inline name on the edit page). Per Brendan: **"Title follows the name too."** On save/rename it now drives `prompts.name`, `agent_settings.name`, `voice_setters.name`, and Retell `agent_name`; the card "Title:"/"Name:" lines display the SoT. Three entry points covered: inline rename (`set-agent-name` now cascades the 3 DB name stores), full Save (`pushVoiceSetterToRetell` `agentName` + `effectivePromptTitle` + `dualWriteVoiceSetter` UPDATE all source the display name), and Duplicate (`duplicate-setter-config` seeds `setter_display_names` for the new slot). The **spoken in-prompt persona `{name}` is intentionally NOT touched** (never-edit-prompts rule); also fixed a latent bug where `dualWriteVoiceSetter`'s UPDATE branch never wrote `name`.

## Files
- `frontend/supabase/functions/retell-proxy/index.ts` — B-3 repoint, B-5 LLM ddv (const + llmPayload + set-agent-name), B-1 dualWrite name + set-agent-name DB cascade.
- `frontend/supabase/functions/duplicate-setter-config/index.ts` — B-1 display-name seed.
- `frontend/src/pages/PromptManagement.tsx` — B-1 `resolvedAgentName`, `effectivePromptTitle`, card line repoint (voice + text).

## Verify (read-only, done)
- Frontend `tsc --noEmit` exit 0. `deno check` on both edge fns shows only the pre-existing `(clientRow as Record<…>)` cast errors (17, none at my edits).
- Deploy via the canonical bundle script (`scripts/deploy_retell_proxy_bundle.mjs`) — NOT the plain CLI, which drops `_shared/` refs. Boot probe 400 (booted, auth-gated).
- B-5 mechanism proven end-to-end on throwaway agents (created + deleted).
- Baseline pre-re-Save: phone outbound `v19` (numeric), inbound `latest_published`; live outbound agent `agent_f45f4dd` latest-published v20 → LLM `default_dynamic_variables = null`.

## ⚠️ Brendan: re-Save the 5 setters before the TEST session
Re-Save/Push only, **never edit prompts**: **Main Outbound (slot 1)** + **Gary - Property Coach / Mortgage Broker / Finance Strategist / Crazy Gary**. The fixes only land on the next Save. After that: outbound flips to `latest_published`, and each agent's LLM gets the default-vars net. B-1/B-3/B-5 verification steps are in `Docs/TEST_LIST.md` (Session 1 section).

---

## NEXT — Session 2 prompt (Security/quality sweep, CODE). Recommended mode: EXECUTE (mechanical/prescriptive, no decisions).

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + the list(s) for this session.

DEPLOY NOTE: edge fns import from _shared/, so deploy with the canonical bundle script
`node scripts/deploy_retell_proxy_bundle.mjs <slug>` (the plain `supabase functions deploy` CLI
silently drops _shared/ refs). retell-proxy is at v45, duplicate-setter-config at v8 after Session 1.

TASK — SESSION 2: SECURITY / QUALITY SWEEP (CODE). Recommended mode: EXECUTE (mechanical, no decisions).
Scope = BUG_LIST G3 items + the types.ts drift. All are small, prescriptive, no design choices:

- G3-1 (S2b-4) voice-booking-tools (+kb-ingest) fail-OPEN when intake_lead_secret is NULL. Money/state
  tools run for any caller who knows the clientId UUID. Fix = return 401 when a money/state tool is
  requested and the client's intake_lead_secret is NULL. Effort S.
- G3-2 (S4-10) retell-call-webhook picks clients[0] for a shared master agent (no disambiguation when an
  agent_id maps to >1 client). Fix = disambiguate via dynamic vars (ghl_account_id / execution owner) +
  log ambiguous matches. Effort M.
- G3-3 (S2b-11) retell-call-webhook stamps outcome from a spoofable agent_id. Require the execution's
  active_call_id == call.call_id before stamping. Effort S.
- G3-4 (S4-8) test-external-supabase returns HTTP 200 on every failure. Fix = 400 for input/validation,
  502 for upstream-connection (keep the success:false body for the UI). Effort S.
- G3-5 (S5-7) transitive esbuild still 0.21.5 (dev-server SSRF GHSA-67mh-4wv8-2f99). Override/resolution
  to esbuild >=0.25 (prod is a static build; dev-server only). Effort S.
- types.ts drift — 5 phantom clients columns read by the browser (crm_page_size, crm_column_widths,
  log_column_widths, sync_ghl_booking_enabled, what_to_do_acknowledged) don't exist in the live clients
  table (those reads 400). Remove the reads or add the columns (check information_schema first). Effort S.

DONE WHEN: tsc clean + deployed; each item moved out of BUG_LIST → TEST_LIST.

CLOSE OUT (Relay Protocol, Docs/SESSION_PLAN.md step 4): update the 5 lists; tick Session 2 done in
SESSION_PLAN.md; write a dated handoff; git add -A + commit + push to origin + github; then EMIT THE
SESSION 3 PROMPT (Settings + setter cleanup: B-4 settings nav split, F2 UUID node picker + single
inbound-setter binding, F5 n8n decommission, F6 remove setup-guide quizzes, F7 delete draft cadence
c206da3e) — print it in a fenced block in chat AND save it into the new handoff, built from the
Standard Context Block + Session 3's scope + this Relay Protocol. Point to Docs/SESSION_PLAN.md;
do not inline the whole plan. Session 3 recommended mode: PLAN (touches several surfaces).
```
