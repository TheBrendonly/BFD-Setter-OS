---
description: Session 10 (2026-07-04) merged the G3-7 vite 5->8.1.3 bump to main and it is LIVE on Railway; headless gates all green, live human browser click-through deferred to Brendan's testing session.
---

# Handoff 2026-07-04: Session 10 — G3-7 vite-8 merge (LIVE)

## What this session did

Merged the vite major bump to `main` and shipped it to production (Opus 4.8, plan ON, Brendan GO:
"headless-verify now, add the browser click-through to the testing session" + "merge + push now").

- **Rebased** `g3-7/vite-major` onto `main` — clean (the single vite commit `6cf4f24` touches only
  `frontend/package.json` + `frontend/package-lock.json`; main's two newer commits were docs-only, no
  file overlap). New commit `407b66e`.
- **`--ff-only` merge** to `main` (`9679850..407b66e`, no merge commit, matches the Session-9 style),
  **pushed origin + github**.
- **Railway auto-rebuilt prod on vite 8 and it is LIVE** — the live bundle went from `index-BR48RXqX.js`
  (last-modified 2026-07-03 20:14 GMT, the pre-vite-8 branch build) to **`index-DIHbxMhk.js`**
  (last-modified 2026-07-04 03:39 GMT). `app.buildingflowdigital.com` root + entry JS + `/login` +
  `/dashboard` all HTTP 200 on the new build.

## Verification (headless, all green)

After a fresh `npm install` in `frontend/` (node_modules confirmed **vite 8.1.3** + `@vitejs/plugin-react-swc`
4.3.1; the tree had vite 5.4.21 before the reinstall):

- `npm run build` **exit 0** — 4.74s, Rolldown bundler. This is exactly what Railway runs on merge, so it
  was the hard gate. (Benign "chunks > 500 kB" advisory, same as on vite 5.)
- `tsc --noEmit` **exit 0**.
- `npm run test:frontend` **8/8**.
- `npm audit` (frontend) **0 vulnerabilities** (vite + dompurify + tar advisories all cleared).
- Render gate — the **preview of the production build** (`vite preview :4173`, closest to what Railway
  serves): index served with correct `<title>BFD-setter</title>` + hashed `index-B2KfogF0.js` (local build
  hash) 200, and SPA routes `/dashboard` `/contacts` `/prompt-management` `/login` all 200.
- Dev server booted on vite 8 in **464ms** with `CHOKIDAR_USEPOLLING=true` (inotify sysctl still not raised);
  root + `/src/main.tsx` (module transform) + `/@vite/client` all 200. Note: it bound to **:8081** because a
  pre-existing long-running vite (:8090, 16h) held part of the port range — left that process alone.

Node here is `v22.22.3` (satisfies `engines >=20 <23` and vite 8's floor). `vite.config.ts` needed no change.

## Deferred to Brendan's testing session (per his call)

The **live human browser click-through** was NOT done this session — Brendan chose headless-now +
"add the test to the testing session." So G3-7 is **NOT fully closed**: a G3-7 row stays in `TEST_LIST.md`
for the rendered check (open `app.buildingflowdigital.com`, confirm the app renders and a few pages navigate —
login/dashboard, a setter/prompt page, contacts — with no console errors on the vite-8 prod bundle). When that
passes, G3-7 → `COMPLETED_LOG.md`.

## Still open (Brendan-only, unchanged on BRENDAN_TODO)

1. **DEPLOY-1** — pin the Railway prod frontend deploy to `main` only (Settings → Source). Still open; this
   session's merge went to `main`, so it deployed via the intended path, but the auto-deploy-any-branch hole
   is still there.
2. **inotify sysctl** on greenserver — `fs.inotify.max_user_watches=524288` (needs sudo) so `npm run dev`
   boots without `CHOKIDAR_USEPOLLING=true`.

## List reconciliation (this session)

- `BUG_LIST.md` — G3-7 entry updated: MERGED TO MAIN + PUSHED (LIVE) `407b66e`, headless gates recorded,
  browser click-through deferred to TEST_LIST.
- `TEST_LIST.md` — G3-7 row repointed off the branch to "MERGED to `main` + LIVE on Railway"; remaining =
  the live browser click-through.
- `SESSION_PLAN.md` — Session 10 ticked `[x]`; remaining-sequence summary updated (Session 10 done, G3-7
  browser check folded into the async live TEST pass).
- `BRENDAN_TODO.md` — no change (DEPLOY-1 + inotify already listed).
- `FEATURE_ROADMAP.md` / `DEFERRED.md` / `PROMPT_UPDATE_LIST.md` — no change (G3-7 is a bug, no feature or
  prompt-content work).

## Next up

The critical path is now: the **async live TEST pass** Brendan still owes (Session 7-finish + Session-9
retests + this G3-7 browser click-through — voice-regression call FIRST) → any fix-pass → **API-DEPR-2**
(the deprecated `analysis_*_prompt` -> `post_call_analysis_data` full-stack migration; its own scoped
session) → optional BOOK-2/3 + SMS-METER-1 supervised shared-fn edits → First-client milestone.

Recommended next Claude session = **API-DEPR-2** (independent of the live TEST pass). Prompt below.

## Next session prompt

```
BFD-setter — API-DEPR-2: migrate the deprecated Retell analysis prompt fields to post_call_analysis_data.
Model: Opus 4.8. Plan mode: ON (full-stack change that shifts live call-analysis behavior; brainstorm first).

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh.
Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY). Live DB via Supabase Management
API /database/query (NOT postgres MCP). Live Retell via api.retellai.com with BFD_RETELL_API_KEY. To know
which agent serves a direction, read the PHONE-NUMBER binding (list-phone-numbers inbound/outbound_agent_id),
never old memory. NEVER edit voice prompts (report-only). retell-proxy is the FROZEN live Voice baseline —
any change to it is Voice-gated (read-only smoke + an answered-call regression before it counts as done),
and voice-booking-tools stays frozen. Verify read-only before claiming done. No em dashes. Follow the Relay
Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, Operations/handoffs/2026-07-04-session10-g3-7-merge.md, and the API-DEPR-1
entry in Docs/BUG_LIST.md (its "ANALYSIS-FIELDS PART" paragraph is the full scope of this session).

Scope (the piece deliberately split out of Session 9): the deprecated analysis_summary_prompt /
analysis_successful_prompt / analysis_user_sentiment_prompt fields customize Retell's BUILT-IN
call_summary / user_sentiment / call_successful. Migrating them to post_call_analysis_data presets moves
the values into custom_analysis_data. This is FULL-STACK and shifts live behavior:
- UI: frontend/src/components/VoiceRetellSettings.tsx (the 3 textareas ~L1377-1400)
- save payload: frontend/src/pages/PromptManagement.tsx:6110-6117
- defaults: frontend/src/lib/retellVoiceAgentDefaults.ts
- retell-proxy: index.ts:708-710 (Voice-gated deploy)
- DOWNSTREAM CONSUMERS that read these TOP-LEVEL off call_analysis and would BREAK if the values move into
  custom_analysis_data: retell-call-webhook/index.ts:307-309 + retell-call-analysis-webhook/index.ts:422-424
  → these need coordinated changes so they read the migrated location.
- type defs in VoiceRetellSettings / useRetellApi.
The fields STILL WORK today (deprecation NOTICE, not removal) so there is NO urgency — get it right, not fast.
FIRST confirm the CURRENT Retell-recommended way to customize the built-in analysis prompts (docs may have
moved again). Brainstorm -> plan -> approve -> build -> verify. Deploy retell-proxy only behind the Voice gate.
Then close out per the Relay Protocol: reconcile the 6 lists, tick SESSION_PLAN, dated handoff, commit+push,
emit the next prompt.
Independent of the async live TEST pass Brendan still owes (incl. the G3-7 vite-8 browser click-through).
```
