---
description: Handoff for the 2026-07-10 BRANDING PURGE session - all 1Prompt/n8n refs removed from the bfd-setter product; next session is the staged retell-proxy bundle (option B).
---

# 2026-07-10 - BRANDING PURGE session handoff

## What happened

The scoped BRANDING PURGE (BRENDAN_TODO, mapped 2026-07-09) ran as its own session and is **DONE**.
Full itemization: `Docs/archive/COMPLETED_LOG.md` (2026-07-10 entry). Brendan's decisions, locked at
session start: GHL step rewritten to the BFD provisioning model (support@buildingflowdigital.com); ALL
Skool + upstream-repo links removed; the 15 public JSON exports deleted; Railway service renamed this
session; SetupGuideDialog n8n phases excised (still-true phases kept); PromptManagement demo defaults
stripped of 1prompt refs only (one-time exception, listed below).

### The prompt-default cut lines (approved exception to the no-prompt-edits rule)
All in `frontend/src/pages/PromptManagement.tsx` DEFAULT_* strings; stored DB prompts untouched:
- Deleted the 77-line `## ABOUT EUGENE & 1PROMPT` fake-bio section from DEFAULT_BOT_PERSONA_CONTENT
  (Belarus/hockey/300+ agencies/13K-YouTube claims + "When Naturally Mentioning" + "Social Proof" blocks).
- 8x `https://access.1prompt.com/` -> `[your-checkout-link]` (webinar/qualification demo scripts).
- 1x `https://www.skool.com/1prompt-ai-sales-reps-3124` -> `[your-community-link]`.
- 2x platform lists dropped the word "n8n" ("Powered by ..." + "Platform integrations ...").

### Edge fns deployed (all ACTIVE, boot-smoked 400/no-500)
run-simulation v21, generate-simulation-personas v21 (headers -> buildingflowdigital.com / "BFD Setter ...",
dummy emails `bfd-simulation-*`), generate-conversation-examples v19, format-metric-chart v19,
sync-ghl-contact v29 (+"Find Lead in BFD" step labels), push-contact-to-ghl v10, ghl-tag-webhook v14
(accepts `bfd-try-gary-` AND legacy `1prompt-try-gary-`). **Echo-guard fallback changed to `bfd-setter`
for NEW clients only** - both live clients carry the explicit `'1prompt-os'` column value, verified in DB
before the change, so nothing live moved.

### Deliberate residuals (legacy-value support, NOT branding misses)
- `retell-proxy` `LEGACY_N8N_HOST = "n8n-1prompt.99players.com"` rewrite guard - defensive, untouched
  (retell-proxy is frozen pending its own staged-bundle session).
- Live DB `ghl_last_synced_from_field_value='1prompt-os'` on both clients + the matching GHL workflow
  filters (renaming those is Brendan's optional GHL-side cleanup).
- `probe@1prompt.local` - the synthetic probe lead's DB identity (annotated in syntheticProbe.ts).
- Migrations, `Docs/archive/`, dated handoffs, `Docs/WEBHOOKS.md` legacy ledger, and the factual GHL
  automation names in `SOP/GHL_SETUP.md`.

### Permission-gated leftovers (parked in BRENDAN_TODO)
- **elevenlabs-manage-agent live undeploy** (repo copy deleted; only caller was an archived page).
- **Trigger.dev prod deploy** - syntheticProbe Slack text ("BFD-setter synthetic probe FAIL") is in the
  repo, ships with the next Trigger deploy. Cosmetic drift only.

### Verification
tsc clean, production build clean, **253/253 tests pass** (node + frontend + deno edge). 7 deployed fns
boot-smoke returned 4xx (no boot failures). Live browser checks owed -> `Docs/TEST_LIST.md` PURGE-UI-1/2,
PURGE-SIM-1, PURGE-SYNC-1, PURGE-TAG-1.

### Railway rename
Brendan renamed the production service off `1prompt-os` this session; the push of this session's commit
doubles as the post-rename deploy verification (grep the live JS for a purge marker, per DEPLOY-1 memory:
verify by content, not entry hash).

## NEXT SESSION (paste this prompt)

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env. Live DB via Supabase Management API /database/query.
Follow the Relay Protocol in Docs/SESSION_PLAN.md. READ FIRST: Docs/SESSION_PLAN.md, the latest handoff
(Operations/handoffs/2026-07-10-branding-purge.md), Docs/BUG_LIST.md, Docs/TEST_LIST.md.

Task (option B from the 2026-07-09 relay): deploy the STAGED GETCALL-1 + PU-9-CODE retell-proxy bundle
(commit 5b5cd42, v50->v51, Voice-gated). Read-only Voice smoke first, deploy via
scripts/deploy_retell_proxy_bundle.mjs ONLY IF current (else scripts/deploy_single_fn.mjs is stale-safe;
check memory project_p2_deferred_build_2026_07_07), then confirm get-call/{id} 200 + the longer
booking-tool filler on a canonical agent (read voice_setters.retell_agent_id fresh; never edit prompts).
While in retell-proxy: Brendan may also greenlight removing the now-dead LEGACY_N8N_HOST rewrite guard
(branding-purge residual) IF the DB/Retell tool URLs are verified clean - ask first.
Also offer: "undeploy elevenlabs-manage-agent" (one Management-API DELETE, permission-gated last session).
```
