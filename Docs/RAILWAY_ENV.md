# Railway Environment Variables

Last verified: 2026-05-01.

This is the canonical list of environment variables required by each Railway service in the BFD-setter deployment. Brendan owns the Railway dashboard; future Claude sessions can't reach Railway without a `RAILWAY_API_TOKEN` in the local `.env`.

Deployment topology reminder (memory `reference_deployment_topology`):
- **Frontend** → Railway (`1prompt-os-production.up.railway.app`)
- **n8n** → Railway (separate service, being decommissioned in Phase 10)
- **Edge functions** → Supabase (not Railway)
- **Trigger.dev tasks** → Trigger.dev cloud (not Railway)

---

## Service 1: `1prompt-os-production` (frontend)

**What it runs:** Vite-built React dashboard (`frontend/`). Build command: `vite build`. Start command: `npx serve dist -s` (per `frontend/package.json:scripts.start`). Railway uses nixpacks auto-detection — no `Dockerfile` or `railway.json` in repo.

**Required environment variables (all four — none optional):**

| Variable | Value | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://bjgrgbgykvjrsuwwruoh.supabase.co` | Project URL. Read by `client.ts` (main supabase-js init), `CampaignDashboard`, `RetellAgentsTab`, `VoiceRetellSettings`. |
| `VITE_SUPABASE_PROJECT_ID` | `bjgrgbgykvjrsuwwruoh` | Project ref. Read by 9+ feature pages to build edge-function URLs (`https://${projectId}.supabase.co/functions/v1/...`). Without it, those pages 404 silently. |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_OhmsC6mH6bO6u3G52dzZxg_v7OoZw8b` | Publishable key (legacy var name). Read by `client.ts` only. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_OhmsC6mH6bO6u3G52dzZxg_v7OoZw8b` | Publishable key (newer var name). Read by 9+ feature pages. **Same value as `VITE_SUPABASE_ANON_KEY`** until the codebase consolidates. |

**Why two near-identical names exist:** mid-codebase rename. `client.ts` (main `supabase-js` init) still uses `VITE_SUPABASE_ANON_KEY`; newer feature pages standardized on `VITE_SUPABASE_PUBLISHABLE_KEY`. Both must hold the **same** publishable-key value. A future cleanup will consolidate to one name; until then, drift between them silently breaks specific pages.

**Pages broken if `VITE_SUPABASE_PROJECT_ID` or `VITE_SUPABASE_PUBLISHABLE_KEY` are missing:**
- `/api-credentials` (ApiCredentials)
- `/contacts/<id>` ContactConversationHistory transcript loader
- `/twilio-numbers` (twilioNumbers helper)
- Campaign Dashboard
- Demo Page Contact Chat
- Email Inbox
- Instagram DMs (and AttendeeAvatar / AttendeeProfileDialog within)
- Symptoms: page loads, then `apikey: undefined` in network requests, returns 401 / empty.

**Where to source values:**
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PROJECT_ID` are public/non-secret.
- The publishable key: Supabase Dashboard → `bjgrgbgykvjrsuwwruoh` project → Project Settings → API → "Publishable key" (new format `sb_publishable_*`). Legacy JWT format (`eyJ...`) was disabled 2026-04-29 — don't paste an old one.
- All four are mirrored in local `frontend/.env.local` (gitignored).

**How to set on Railway:**
1. Railway dashboard → `Building Flow Digital` workspace → `1prompt-os-production` service → **Variables** tab.
2. Click **+ New Variable** for each missing var.
3. After all four are set, redeploy (Railway will offer a rebuild button).
4. Verification: open `https://1prompt-os-production.up.railway.app/api-credentials` (after auth) — should load the API credentials list. If the page shows blank/loading forever, one of the vars is still missing or wrong.

**Optional Railway-managed vars (don't set these manually):**
- `PORT` — Railway sets automatically for the HTTP listener.
- `NODE_ENV` — defaults to `production` on Railway.
- `RAILWAY_*` — internal, auto-injected.

---

## Service 2: n8n (legacy, being decommissioned)

**Status:** scheduled for shutdown in Phase 10, after the 14-day Phase 9 native-engine soak completes (earliest ~2026-05-14).

**Action during soak:** leave as-is. The `text_engine_webhook` returns HTTP 500 right now and BFD has `use_native_text_engine=true` so n8n is bypassed. After Phase 10 ships (per User Todos D2), shut down this Railway service entirely.

If you do need to keep it alive past Phase 10 (e.g., another client temporarily on `use_native_text_engine=false`), the env vars are managed entirely in n8n's own UI and Railway's Variables tab. Not documented here — would need a fresh audit.

---

## Setting / managing Railway vars from a Claude session

Not currently possible from this repo. To enable:
1. Generate a Railway API token at https://railway.app/account/tokens.
2. Add `RAILWAY_API_TOKEN=...` to local `.env` (gitignored).
3. Future sessions can use the Railway GraphQL API at `https://backboard.railway.app/graphql/v2` to list/set service variables.

Until then, Railway changes stay manual.
