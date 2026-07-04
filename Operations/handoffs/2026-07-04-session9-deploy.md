---
description: Session 9 (2026-07-04) supervised deploy of the overnight bug-fix branch - all backend + frontend live, RLS migration applied, API-DEPR-1 analysis-fields split to its own session, DEPLOY-1 Railway config finding, live TEST pass owed to Brendan.
---

# Handoff 2026-07-04: Session 9 supervised deploy of `feature/overnight-bugfix`

## What this session did

Supervised deploy (Opus 4.8, plan ON, Brendan GO) of the overnight bug-fix branch. Everything is now LIVE.

- **Merged** `feature/overnight-bugfix` → `main` (`4a22b8b`, fast-forward; no merge commit), pushed origin + github.
- **Trigger.dev** `20260703.2` (12 tasks) — SMS-MEM-1, FOLLOWUP-PROMPT-1.
- **Edge fns** (via `deploy_single_fn.mjs`, `--use-api`-equivalent, verify_jwt preserved):
  - **retell-proxy v47 → v48** (VM-1 draft-first + `static_text`; API-DEPR-1 list-agents → `POST /v2/list-agents` + get-agent hydration)
  - **verify-credentials v2 → v3** (API-DEPR-1 v2 probe)
  - **save-external-prompt v14 → v15** (picks up shared `promptLint.ts`)
- **RLS-SHAPE-1 migration APPLIED** via Mgmt API — `get_user_role(auth.uid())='agency'` gate on `sms_delivery_events` confirmed live in `pg_policies`.
- **Frontend** — was ALREADY LIVE (see DEPLOY-1 below); no action needed.

Final pre-deploy suite (on the branch): test:node 122/122, test:frontend 8/8, test:edge 202/202, tsc + vite build green. Frontend also built clean locally this session (14.9s).

## Voice gate — read-only smoke PASSED; answered-call OWED

retell-proxy is the frozen Voice baseline. Read-only smoke on v48 PASSED with **0 agents mutated**: `POST /v2/list-agents` returns 24 unique agents (`{items, has_more:false}`, under the 1000 cap), the v48 `unwrapList` handles the `items` shape, and per-agent `GET get-agent/{id}` hydration works. **Still owed (Brendan-driven, in TEST_LIST):** one answered outbound booking call to confirm v48 didn't disturb the frozen call path (roll back to v47 if it regresses), plus the VM-1 voicemail-lands check on the same call.

## DEPLOY-1 (new finding) — Railway ships feature branches to production

The frontend was found ALREADY LIVE at the start of the deploy. Root cause: **Railway auto-deployed the `feature/overnight-bugfix` branch straight to the production domain `app.buildingflowdigital.com` ~06:14 AEST**, ~5h before the `main` merge. Proven read-only:
- the live prod bundle contains branch-only strings — `"Use anyway"` (commit `3c42a45`, MODEL-1) and `"Model ID must look like provider/model (e.g. google/gemini-2.5-flash)."` (commit `19a6fb4`) — code that was on the branch only;
- the container `last-modified` = `2026-07-03 20:14 GMT` = 06:14 AEST, while `main` was still `b092c9d` until the merge 40 min before close-out.

So the overnight run's "STAGE ONLY, nothing deployed" intent was silently bypassed by Railway for the frontend. My fast-forward `main` push was the same SHA `4a22b8b`, so Railway saw nothing new and didn't rebuild (which is why the bundle hash never changed after the push — an early false-alarm "frontend not deploying" that turned out to be "frontend already deployed"). **Fix → BRENDAN_TODO:** pin the Railway prod deploy to `main` (Settings → Source), disable auto-deploy from other branches. Logged as **DEPLOY-1** (Low) in BUG_LIST.

## API-DEPR-1 leftover — SPLIT to its own session (API-DEPR-2)

The plan framed the remaining analysis-fields migration as "one code piece." The Session-9 investigation found it is materially bigger and riskier, so it was deferred (Claude recommendation, Brendan agreed):
- the deprecated `analysis_summary_prompt`/`analysis_successful_prompt`/`analysis_user_sentiment_prompt` have a FULL editing UI (`frontend/src/components/VoiceRetellSettings.tsx` ~L1377-1400) and are sent on every voice-settings save (`frontend/src/pages/PromptManagement.tsx:6110-6117`), so it is full-stack (UI + save payload + `retellVoiceAgentDefaults.ts` + retell-proxy `index.ts:708-710` + type defs);
- it shifts live behavior: those fields customize Retell's BUILT-IN `call_summary`/`user_sentiment`/`call_successful`, which the two downstream webhooks read top-level (`retell-call-webhook/index.ts:307-309`, `retell-call-analysis-webhook/index.ts:422-424`); migrating to `post_call_analysis_data` presets moves those into `custom_analysis_data`, which those consumers do NOT read → needs coordinated webhook changes too;
- the fields STILL WORK today (deprecation notice, not removal), so no urgency.

Recommended: a dedicated brainstorm→plan→build→verify session that also confirms the current Retell recommendation for customizing built-in analysis prompts. Full detail in the API-DEPR-1 entry in `Docs/BUG_LIST.md`.

## List reconciliation (this session)

- `BUG_LIST.md` — top banner records the Session-9 deploy; SMS-MEM-1 / FOLLOWUP-PROMPT-1 / PROMPT-LINT-1 / MODEL-1-HARDENING / F9-1 / VM-1 / PHONE-CLEAR-1 flipped from STAGED → DEPLOYED LIVE (awaiting behavioral verify in TEST_LIST); RLS-SHAPE-1 → APPLIED; API-DEPR-1 list-agents part DEPLOYED + analysis-fields split to API-DEPR-2; new **DEPLOY-1** logged.
- `TEST_LIST.md` — Session-9 deploy banner (all items live + testable); explicit **Voice-gate answered-call** item added.
- `BRENDAN_TODO.md` — deploy + RLS items ticked done; **DEPLOY-1** (pin Railway to main) added.
- `SESSION_PLAN.md` — Session 9 ticked `[x]`; overnight-run entry ticked; remaining sequence updated (live TEST pass → Session 10 G3-7 → API-DEPR-2 → BOOK-2/3/SMS-METER-1 → First-client).
- `PROMPT_UPDATE_LIST.md` — no change this session (no prompt-content work; prompts stayed report-only).

## What remains (owed to Brendan / next sessions)

1. **Live TEST pass** (async, Brendan drives): the retell-proxy v48 answered-call Voice-regression FIRST, then SMS-MEM-1 multi-turn (from TEST_PHONE_A `+61405482446`), FOLLOWUP-PROMPT-1, PROMPT-LINT-1 (incl. the AgentSettingsCard follow-up field path), MODEL-1 UI, VM-1 (Save & push mode=prompt → full success + voicemail lands), API-DEPR-1 (Agents tab + Verify), F9-1 (locked rename via tile AND doc header), PHONE-CLEAR-1 (Contacts dialog). Move greens to `COMPLETED_LOG.md`.
2. **DEPLOY-1** — pin the Railway prod frontend deploy to `main`.
3. **Session 10 (G3-7)** — browser-verify the app on `g3-7/vite-major`, merge, and raise the greenserver inotify sysctl.
4. **API-DEPR-2** — the deprecated analysis-fields migration, its own full-stack session.
5. **Setter-1 prompt content migration** (report-only, unchanged; BRENDAN_TODO).

## Environment notes

- Deploy scripts: `scripts/deploy_single_fn.mjs <slug>` bundles siblings + all `_shared/*.ts` and preserves `verify_jwt`. Trigger pinned to `@4.4.4` per the incident memory (repo `deploy` script uses `@latest` — do not use it).
- Live checks used the Supabase Management API `/database/query` (browser UA) and `api.retellai.com` with `BFD_RETELL_API_KEY`; no writes to Retell.
- `deno check` still reports the ~19 pre-existing strict-mode errors in retell-proxy (unrelated lines); the pipeline is `deno test --no-check`.

## Next session prompt

See the fenced block below (also printed in chat). Recommended: **Session 10 (G3-7 vite-8 merge), Opus 4.8, plan ON**, with `/run` to browser-verify the app on the vite-8 branch.

```
BFD-setter — Session 10: merge the G3-7 vite-8 branch (mostly DONE; needs a browser check).
Model: Opus 4.8. Plan mode: ON (a live-path merge + a real browser verify).

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh.
Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY). Live DB via Supabase
Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com with
BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding, never
old memory. NEVER edit voice prompts (report-only). Verify read-only before claiming done. Follow
the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, Operations/handoffs/2026-07-04-session9-deploy.md, then in
Docs/BUG_LIST.md the G3-7 entry + DEPLOY-1, and Docs/TEST_LIST.md the G3-7 row.

Branch `g3-7/vite-major` (off `feature/overnight-bugfix`, commit `6cf4f24`) bumps vite 5.4.21 → 8.1.3
+ @vitejs/plugin-react-swc 4.3.1; 0 npm-audit vulns; build/tsc/test:frontend/app-load all headless-green.
It is NOT merged. On Brendan's GO:
1. `git checkout g3-7/vite-major`; rebase onto current `main` if needed (main moved to 4a22b8b in Session 9).
2. `/run` (or `CHOKIDAR_USEPOLLING=true npm run dev` from frontend/) and click through a few real pages in a
   browser to confirm the app loads + navigates on vite 8 (headless was green, browser is the gate).
3. On success: merge `g3-7/vite-major` → main, push origin + github (Railway will auto-deploy — see DEPLOY-1;
   if the prod trigger is now pinned to main, this is the intended path).
4. WATCH-OUT (DEPLOY-1): Railway currently ships any pushed branch to the prod domain. If DEPLOY-1 isn't fixed
   yet, be aware the merge to main (or even a branch push) may go live immediately.
5. Greenserver: raise the inotify watch limit so `npm run dev` boots without CHOKIDAR_USEPOLLING (BRENDAN_TODO,
   needs sudo: fs.inotify.max_user_watches=524288).
Then close out per the Relay Protocol: reconcile the 6 lists, tick SESSION_PLAN, dated handoff, commit+push,
emit the next prompt (API-DEPR-2, or the First-client milestone if the live TEST pass is green).
CONSTRAINTS: voice-booking-tools stays frozen; voice prompts hard report-only; no em dashes.
Independent of the async live TEST pass Brendan still owes on the Session-9 deploy.
```
