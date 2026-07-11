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

### Infra renames - DONE + VERIFIED LIVE (this session)
- Railway prod service: `1prompt-os` -> **`BFD-Setter-OS`** (Brendan, in the dashboard).
- GitHub repo: `TheBrendonly/1prompt-os` -> **`TheBrendonly/BFD-Setter-OS`** (Claude, `gh repo rename`).
- Forgejo repo: `bfd/1prompt-os` -> **`bfd/BFD-Setter-OS`** (Claude, Forgejo API). Both hosts keep
  redirects from the old names; this clone's remotes were updated. **Laptop clone remotes still point at
  the old URLs** - they keep working via redirect, update `~/bfd-os/Projects/<dir>` remotes when convenient.
- Post-rename deploy VERIFIED: pushed `4f560ef` -> Railway auto-built off the renamed GitHub repo, new
  entry bundle `index-l1upHDYq.js` went live; all 176 live JS chunks grep CLEAN for "1prompt"; the new GHL
  step copy ("provisions your GoHighLevel location") is present in the live SetupGuideDialog chunk; the old
  public `/workflows/*.json` + `/retell-agents/*.json` paths now return the SPA shell, not JSON.
- `System/docs/sync-topology.md` updated with the new repo names.

## NEXT SESSION (paste this prompt - COMBINED 3-phase relay, updated 2026-07-11)

```
BFD-setter combined session: retell-proxy bundle -> test session -> GATE A. Brendan is present.
Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh.
Creds in ./.env. Live DB via Supabase Management API /database/query (NOT postgres MCP).
Follow the Relay Protocol in Docs/SESSION_PLAN.md. READ FIRST: Docs/SESSION_PLAN.md, the latest handoff
(Operations/handoffs/2026-07-10-branding-purge.md), Docs/BUG_LIST.md, Docs/TEST_LIST.md.
NEVER edit voice prompt content (report-only; see feedback_no_internal_prompt_edits). Read
voice_setters.retell_agent_id fresh for any agent lookup. No em dashes anywhere.

UPFRONT (before other work): (a) I'll need a fresh 6-digit TOTP code for the browser half of Phase 2 -
tell Brendan to have his authenticator ready; (b) confirm Brendan's GO on the elevenlabs-manage-agent
live undeploy (one Management-API DELETE, repo copy already removed 2026-07-10).

PHASE 1 - retell-proxy staged bundle (option B). Deploy STAGED GETCALL-1 + PU-9-CODE (commit 5b5cd42,
v50->v51, Voice-gated): read-only Voice smoke FIRST (0 agents mutated), deploy via
scripts/deploy_retell_proxy_bundle.mjs ONLY IF current vs the fn dir (else scripts/deploy_single_fn.mjs;
gotcha in memory project_p2_deferred_build_2026_07_07), then confirm get-call/{id} 200 + the longer
booking-tool filler on a canonical agent. While in retell-proxy, ASK Brendan whether to also remove the
LEGACY_N8N_HOST rewrite guard (branding-purge residual): only if a fresh scan of the DB voice_setters
tool snapshots + live Retell LLM tool URLs shows zero n8n-host URLs; if any exist, leave the guard.
Also fold in the pending Trigger.dev prod deploy (cosmetic syntheticProbe Slack-text drift from
2026-07-10) - Brendan is present so the permission gate can be approved interactively.

PHASE 2 - "run test session": execute Docs/TEST_SESSION.md per its runbook (self-verify state first,
batch into fewest live runs). This now includes the 5 branding-purge rows (PURGE-UI-1/2, PURGE-SIM-1,
PURGE-SYNC-1, PURGE-TAG-1), the 2026-07-08 overnight rows (RLS-UISTATE-1-LIVE, QH-TZ-1-LIVE,
OPTOUT-EDGE-STAGED redeploys), and the combined-build behavioral checks. TEST_LIST.md stays the
pass/fail source of truth; RUN 9 is Brendan's manual checklist. Use the Playwright harness
(scripts/test-harness/README.md) with the TOTP from UPFRONT; never probe the refresh token.

PHASE 3 - GATE A (only with Brendan's explicit GO after he reviews): the RLS role-gate migration drafted
review-only in commit ff355d4 (covers RLS-CLIENTS-1 critical + RLS-CREDENTIALS-1 / RLS-TENANT-DISJUNCTION-1 /
RLS-GATE-SIBLING-1 / RLS-ORUSAGE-1; full rows in Docs/BUG_LIST.md). Walk Brendan through the draft, apply
via Management API, verify pg_policies after (memory project_phase3_rls_policy_gaps), then re-run the
RLS-UISTAGE/role live probes from Phase 2 to prove no agency lockout and client-role containment.
GATE B items stay milestone-gated (need retell_webhook_secret armed) - do NOT arm secrets this session.

CLOSE OUT per the Relay Protocol: reconcile the 6 lists + COMPLETED_LOG, daily notes/todos, dated handoff
with the next prompt (next in line: First-Client Milestone, EVENT-GATED on a signed contract - do not run).
If context runs low mid-way, close out the finished phases properly and emit the remaining phases as the
next prompt instead of rushing.
```
