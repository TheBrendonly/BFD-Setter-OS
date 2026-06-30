---
description: Session 7.5 overnight Text-Setter repair + all-open-bugs (2026-07-01) — STAGED on branch worktree-overnight+text-setter-repair-allbugs, NOTHING deployed. Holds the Text-vs-Voice comparison, the per-bug disposition ledger, the deploy checklist + Voice-regression gate, and the emitted tomorrow kickoff prompt.
---

# Session 7.5 — Overnight Text-Setter repair + FOLD-IN ALL OPEN BUGS (2026-07-01)

**STATE: branch `worktree-overnight+text-setter-repair-allbugs` holds STAGED, UNDEPLOYED fixes. NOTHING is live.** Deploy in daylight per the checklist below (VM-1 gated on a Voice-regression pass), then run the live tests. Do not run live tests against undeployed code. The paused Session-7 TEST baseline (retell-proxy v46, make-retell-outbound-call v27, voice-booking-tools) is untouched.

Verification (re-run green): **test:node 80 pass / 0 fail**, **test:edge 125 pass / 0 fail**, **vite build exit 0**. An independent adversarial verification council reviewed the full diff and returned **DONE-CONFIRMED** (no guardrail breach, no Voice-regression path, no silent drop, the 3 narrowings sound). 8 fix commits + 1 char-test commit; working tree clean.

## How it ran

Plan-mode research (4 read-only lanes) ratified the per-bug ledger up front (the planning council), then per-fix superpowers micro-loops (systematic-debugging → TDD failing-test-first → minimal impl → green) built the branch in ledger order (SMS-OBS-1 first, gating). The adversarial verification council gated "done". spec-kit was NOT used (the constitution is the empty template; pure superpowers was cleaner). Both prompts stayed report-only; deploy-nothing held throughout.

---

## 1. Text vs Voice structural map (the comparison)

| Concern | VOICE setter | TEXT setter (before) | TEXT setter (after, BOOK-1) |
|---|---|---|---|
| Availability ground truth | **Prefetches** GHL free-slots 30 days ahead using `client.timezone`, compacts to `{date:[HH:MM]}` (`make-retell-outbound-call:compactSlots` 195-213), injects `{{available_time_slots}}` before the call | **None** — relied on the model to voluntarily call `get-available-slots` → a weak model fabricated "booked out" against 180 open slots (BOOK-1) | **Prefetches** via the SAME shared `get-available-slots` (read-only) with an EPOCH-MS window, compacts identically, injects a ground-truth block into the system turn EVERY reply + an anti-fabrication clause |
| Booking fn | shared `voice-booking-tools` | shared `voice-booking-tools` (same fn) | unchanged (read-only; reused over HTTP) |
| Slot match | `resolveCanonicalSlot` ignores model offset, matches wall-clock HH:MM (load-bearing, BOOK-2) | same | unchanged (BOOK-2 char-tested, not edited) |
| Window parse | passes epoch ms (`windowStart.getTime()`) | tool descriptions tell the model to send offset-less ISO → `toMs` parses as UTC → AU day skew (BOOK-3) | the BOOK-1 **prefetch** passes epoch ms (dodges BOOK-3); the model-driven path is BOOK-3 char-tested, not edited |
| Tool-call observability | n/a | `toolInvocations` console-logged then discarded; `chat_history.tool_calls` hardcoded `[]` (SMS-OBS-1) | persisted to new platform `tool_invocations` table; `chat_history.tool_calls` populated |
| Identity injection | n/a | engine-injected LAST in `setterToolLoop` (`{...parsed, ...identity}`) — EE1 guardrail | **unchanged** (the prefetch calls `get-available-slots`, which needs no contactId) |
| Model selection | per-agent | `normalizeLlmModel(clients.llm_model)` strip-only → an invalid id 400'd all engines (MODEL-1) | alias map + slash-sanity → invalid degrades to the default, never 400s |

Reference: the n8n `Text_Engine_REVERSE_ENGINEERED.md` did NOT prefetch availability (model-driven), so BOOK-1's prefetch is a deliberate improvement over both the n8n original and our port — not a reverted divergence.

---

## 2. Per-bug disposition ledger (what landed; unit-verified vs needs Brendan's live test)

| Bug | Class | Landed on branch (unit-verified) | Needs Brendan live (after deploy) |
|---|---|---|---|
| **SMS-OBS-1** | CODE / Trigger.dev | NEW `tool_invocations` migration FILE; `trigger/_shared/persistToolInvocations.ts` (5 tests); wired into `processSetterReply`; line 344 `tool_calls` populated | rows visible in `tool_invocations` after an SMS exchange |
| **BOOK-1 code** | CODE / Trigger.dev | `trigger/_shared/prefetchSlots.ts` (6 tests): prefetch via existing `callTool` (EPOCH-MS window), compact like Voice, inject ground-truth block every reply + anti-fabrication clause in `TOOL_USAGE_INSTRUCTION` | 3.12 booking acceptance (slots offered → books on acceptance; tool log proves it) |
| **BOOK-1 prompt** | REPORT-ONLY | n/a (code makes fabrication structurally hard; prompt is Brendan's) | apply the prompt tweak (§4) before the 3.12 re-test |
| **MODEL-1a** | STAGE+DEPLOY / Trigger.dev | hardened `normalizeLlmModel` (alias map + slash-sanity) + `llmModel.test.ts` (5 tests) | bad-model degrades to default on a throwaway client (not BFD) |
| **MODEL-1b** | DEMOTED | none — save UI is the `OpenRouterModelSelector` dropdown (known IDs) | n/a |
| **F9-1** | CODE / frontend build | `InlineSetterNameEditor` isLocked guard; passed at both voice render sites in `PromptManagement` | locked setter refuses inline rename, no `setter_display_names` write |
| **PHONE-CLEAR-1** | CODE / frontend build | NEW `frontend/src/lib/normalizePhone.ts` (byte-identical mirror) + 2 tests; `ContactDetail` updatePayload sets `normalized_phone` | cleared phone → `normalized_phone` null; old number no longer matches |
| **VM-1** | STAGE+DEPLOY / **VOICE-GATED** | NEW `retell-proxy/voicemail.ts` `buildVoicemailPatch` (5 tests) emitting `voicemail_option` ONLY (drops the 2 deprecated detection fields); set-voicemail handler uses it | voicemail push lands ("voicemail_set", not "partial"); **+ confirm voicemail applies on the next call without republish** (the narrowed-out draft-first question) |
| **G3-8(a)** | STAGE+DEPLOY / in-project | NEW `execute-lead-webhook` edge fn (+ `payload.ts` 2 tests); LeadRow repointed — browser no longer reads `supabase_service_key` | "execute lead" fires the webhook + row reaches completed; no service_key in any browser payload |
| **BOOK-2 / BOOK-3** | WRITEUP+CHAR-TEST | `trigger/_shared/bookSlotChar.test.ts` mirrors the shared fn's pure fns, asserts CURRENT behaviour (TZ-robust); NO edit to `voice-booking-tools` | supervised daytime edit (snap off-grid minute; interpret offset-less ISO in client tz) |
| **API-DEPR-1** | DEFER | none (read-only confirmed: retell-proxy still calls bare `list-agents` @1270 etc.; GHL Version headers mixed) | its own daytime session (frozen-baseline multi-fn migration + live-API re-confirm) |
| **G3-7** | DEFER | none (vite `^5.4.19`; breaking major bump, dev-server-only) | its own session |

**Three narrowings (all council-confirmed sound, each leaves the bug actually fixed by a different lever):**
- **BOOK-1 forced-`tool_choice`** → narrowed out. Prefetch+inject already guarantees `get-available-slots` is called + its result injected before any reply, so a forced `tool_choice` object adds OpenRouter model-compat risk for no incremental safety.
- **VM-1 `ensureEditableAgentDraft` routing** → narrowed out. The live hangup `voicemail_option` already lands via the same raw PATCH (proven), so the deprecated fields were the sole cause; adding draft→publish→repoint churn to a multi-agent loop on the frozen Voice surface is the risk the baseline protects. (Open question flagged for the Voice-gated live test.)
- **MODEL-1b** → demoted. The save UI is a known-IDs dropdown, so the free-text-corruption vector can't be reached from the UI; MODEL-1a still catches legacy bad rows.

---

## 3. DEPLOY CHECKLIST (grouped by target; deploy in daylight)

For each: files → target → version bump → tests → Voice-gated?

### A. Trigger.dev redeploy — SAFE to deploy independently, NOT Voice-gated
- **Files:** `trigger/processSetterReply.ts`, `trigger/_shared/{persistToolInvocations,prefetchSlots,llmModel,setterTools}.ts`
- **Target:** redeploy the Trigger.dev `trigger/` tasks (the project's standard Trigger deploy)
- **Tests:** `npm run test:node` (80 pass)
- **Covers:** SMS-OBS-1, BOOK-1 code, MODEL-1a. Touches NO shared-Voice surface; leaves retell-proxy v46 + make-retell-outbound-call v27 untouched.

### B. Apply migration — SAFE, additive
- **File:** `frontend/supabase/migrations/20260701120000_tool_invocations.sql`
- **Target:** apply via Supabase Management API (`/database/query`, browser UA). Additive `create table if not exists` + indexes + RLS-on. No existing object touched.
- **Do this with (A)** so SMS-OBS-1 has its table.

### C. Frontend build — SAFE to deploy independently
- **Files:** `frontend/src/components/setters/InlineSetterNameEditor.tsx`, `frontend/src/pages/{PromptManagement,ContactDetail}.tsx`, `frontend/src/lib/normalizePhone.ts`, `frontend/src/components/LeadRow.tsx`
- **Target:** `frontend build only` (rebuild + ship; vite build green)
- **Covers:** F9-1, PHONE-CLEAR-1, the G3-8a LeadRow repoint. NOTE: ship C **with** D (LeadRow calls the new edge fn).

### D. New edge fn — in-project re-test, NOT Voice-gated
- **Files:** `frontend/supabase/functions/execute-lead-webhook/{index.ts,payload.ts}`
- **Target:** `supabase functions deploy execute-lead-webhook --use-api --no-verify-jwt`
- **Tests:** `npm run test:edge` (125 pass); new fn `deno check`s clean
- **Covers:** G3-8(a). In-project re-test: click "execute lead" on a reactivation campaign.

### E. retell-proxy — **VOICE-REGRESSION GATED** (deploy LAST, only if the gate passes)
- **Files:** `frontend/supabase/functions/retell-proxy/{index.ts (set-voicemail handler only),voicemail.ts}`
- **Target:** `supabase functions deploy retell-proxy --use-api --no-verify-jwt` → **v46 → v47**
- **Tests:** `npm run test:edge` (125 pass)
- **Covers:** VM-1. **THE ONLY VOICE-GATED ITEM.**

### Voice-regression gate (run BEFORE deploying E)
Place a real outbound voice call on a canonical agent (Main Outbound or one of the 4 Garys); confirm: (1) booking still works end-to-end; (2) **B-3** — the outbound agent follows `latest_published`; (3) **B-5** — default dynamic vars net survives (no literal `{{first_name}}`). **If the gate fails, deploy ONLY A–D and leave retell-proxy at v46.**

---

## 4. BOOK-1 prompt recommendation (copy-paste-ready — Brendan applies via the BFD UI)

Apply to the Text setter "Setter-N" `system_prompt` (in the client's EXTERNAL Supabase `text_prompts.system_prompt`), AFTER the Trigger.dev deploy, BEFORE the 3.12 re-test:

> Never tell a lead a time is unavailable unless the get-available-slots tool returned it as unavailable. Always call get-available-slots before discussing or offering times. When a lead accepts a specific time you offered, immediately call book-appointments for that exact time and confirm. Never invent scarcity or use "snapped up" / "booked out" language.

(The code already injects a live availability snapshot every reply and forbids fabrication in `TOOL_USAGE_INSTRUCTION`, so this is reinforcement, not the load-bearing fix.)

---

## 5. TOMORROW kickoff prompt (paste into a fresh session in daylight)

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + Operations/handoffs/2026-07-01-overnight-text-setter-repair-allbugs.md
+ Docs/BUG_LIST.md + Docs/TEST_LIST.md + Docs/BRENDAN_TODO.md.

STATE: The overnight branch worktree-overnight+text-setter-repair-allbugs contains STAGED, UNDEPLOYED
fixes. NOTHING is live. Your FIRST job is to DEPLOY per the checklist, in daylight, gated on the
Voice-regression check — only then run live tests. Do not run live tests against undeployed code.

STEP 1 — DEPLOY (daylight, gated). Use the handoff's DEPLOY CHECKLIST (§3). Deploy targets grouped:
  (A) Trigger.dev redeploy (SMS-OBS-1 / BOOK-1 code / MODEL-1a) + (B) apply migration
      20260701120000_tool_invocations.sql via Mgmt API — SAFE, NOT Voice-gated.
  (C) Frontend build (F9-1 / PHONE-CLEAR-1 / G3-8a LeadRow) — SAFE; ship WITH (D).
  (D) supabase functions deploy execute-lead-webhook --use-api --no-verify-jwt (G3-8a) — in-project re-test.
  (E) supabase functions deploy retell-proxy --use-api --no-verify-jwt (VM-1, v46->v47) — VOICE-GATED:
      run the Voice-regression gate FIRST (real outbound call on a canonical agent; booking works;
      B-3 latest_published + B-5 default vars survive). If the gate FAILS, deploy ONLY A-D, leave
      retell-proxy at v46. Consider a DEPLOY-READINESS council before flipping E live.

STEP 2 — LIVE TESTS (Session-7-finish). Before the 3.12 re-test, apply the BOOK-1 report-only prompt
tweak from BRENDAN_TODO (§4 of the handoff). Then run, from Docs/TEST_LIST.md:
  - The newly-staged 7.5 fixes: BOOK-1/3.12 acceptance (tool_invocations shows get-available-slots THEN
    book-appointments=confirmed + a real GHL appt), SMS-OBS-1 (rows in tool_invocations), MODEL-1
    (bad model degrades on a throwaway client, NOT BFD), F9-1, VM-1, PHONE-CLEAR-1, G3-8a.
  - The still-owed live items: B-5 (inbound from a non-CRM number — TEST_PHONE_A is a known lead, use a
    different number), F1 (fresh GHL contact deep-link; field id 4tDL3asiRNrQD3MKyP2E), LIVE-D
    (B-2 x4 + manual-send/429), LIVE-E (F3 pause/resume + F4 tz nudge), G3-6 Tier-3 analytics.
  - Live-verify the already-BUILT-2026-06-29 items (do NOT rebuild): INB-1, UI-1, F11.
  Use a TEST-TRIAGE council if multiple live tests fail.

STEP 3 — CLOSE OUT (close out THEN emit next). Passed -> COMPLETED_LOG; new failures -> new BUG_LIST
entries; tick SESSION_PLAN Session-7-finish; write a dated handoff; git add -A && commit && push origin +
github. THEN emit the next prompt: Session 8 (F8 cost-to-price calculator, PLAN mode), or a fresh fix-pass
if anything failed, or the dedicated API-DEPR-1 / G3-7 sessions.
```
