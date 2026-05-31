# Next-session prompt

Paste the fenced block below into a fresh Claude Code session opened on `/srv/bfd/Projects/bfd-setter`. Start in **plan mode**, get user approval, then switch to execution mode.

The prior session (2026-05-24) shipped Phase 10 n8n decommission (backend + frontend code), built a new Duplicate Setter feature, wired the `crazy-gary` persona into the Try Gary allowlist, verified Bug 20 live, and confirmed Bug 10 phone pin was already correct. HEAD at `d4f3841` on main both remotes. **Next session goal: drive the project to 100%.** Brendan provisions 5 Try Gary persona voice setters + 3 GHL items + applies Bug 29 prompt diff; Claude autonomously executes Phase 10 schema DROP (after 24h soak passes) + Bug 9 + UI gaps 12/13/15 in parallel worktrees.

---

```
Resuming BFD-setter to drive the platform to 100%. Source-of-truth handoff:

  /srv/bfd/Operations/handoffs/2026-05-24-finish-100pct-next-session.md

Read it IN FULL first. It has everything you need + all 5 Try Gary persona MODIFY WITH AI prompts verbatim.

Also read FIRST (in this order):
1. /srv/bfd/Operations/handoffs/2026-05-22-outcomes-and-current-state.md §9 + §9b
   (Phase 10 + Duplicate Setter + Crazy Gary shipped state)
2. /srv/bfd/Projects/bfd-setter/Docs/CHANGES_LOG.md top 4 rows
   (the 4 commits from 2026-05-24)
3. /srv/bfd/Projects/bfd-setter/User Todos.md ACTIVE PUNCH LIST
   (tier 1 thru 4 + Claude autonomous A-D)
4. ~/.claude/projects/-srv-bfd-Projects-bfd-setter/memory/MEMORY.md
   (top entry [[project-session-2026-05-24-try-gary-and-phase10]])

STATE OF PLAY (verified at handoff write):
- HEAD: d4f3841 on origin/main AND github/main (parity).
- Trigger.dev: runEngagement v20260524.1 ACTIVE (10 tasks).
- Edge fns ACTIVE: receive-dm-webhook v14, sync-external-credentials v11,
  ghl-tag-webhook v5, duplicate-setter-config v1.
- BFD phone (+61481614530) Retell pin: inbound v49, outbound v49.
- BFD agent slot 2 webhook_events: ['call_ended', 'call_analyzed'].
- try_gary_persona_slots current map: {property-coach:2, mortgage-broker:2,
  finance-strategist:2, generic-demo:2}. Updates to slot 4-8 happen as
  Brendan saves each setter.
- Phase 10 schema DROP DEFERRED 24h. Soak window passes ~2026-05-25 17:30
  AEST. Pre-DROP snapshot at
  /srv/bfd/Operations/archives/2026-05-24-n8n-decom/clients-snapshot.json.

GOAL THIS SESSION: get to 100%.

STREAM A — Brendan-driven UI (interactive, paste prompts from handoff doc):
  1. Apply Bug 29 booking-flow prompt diff to BFD slot 2 (manual).
  2. Duplicate slot 2 -> slot 4 (Property Coach), MODIFY WITH AI, Save Setter.
  3. Duplicate slot 2 -> slot 5 (Mortgage Broker), MODIFY WITH AI, Save Setter.
  4. Duplicate slot 2 -> slot 6 (Finance Strategist), MODIFY WITH AI, Save Setter.
  5. Duplicate slot 2 -> slot 7 (Generic Demo), MODIFY WITH AI, Save Setter.
  6. Duplicate slot 2 -> slot 8 (Crazy Gary), switch voice to weird ElevenLabs,
     MODIFY WITH AI, Save Setter.
  7. GHL: Custom Conversation Provider (Bug 21) + 2 custom fields (Bug 22) +
     webhook secret (Bug 26).
  8. Marketing site: add 'crazy-gary' to the landing-page persona picker
     (separate repo).
  After EACH Save Setter cycle, ping Claude "slot N saved" -> Claude runs
  slot-populated verify SQL + phone-pin drift check + re-PATCH if drifted.

STREAM B — Claude autonomous (parallel, worktree per task):
  A. Phase 10 schema DROP — once 24h soak passes (>= 17:30 AEST 2026-05-25),
     auto-execute ALTER TABLE clients DROP COLUMN IF EXISTS text_engine_webhook
     + post-drop verify + commit + tag phase-10-n8n-decom-schema-drop + push.
     No further GO needed; auth was already given for Phase 10.
  B. Bug 9 — inbound mid-cadence coordination (~3-4 hr). Trigger.dev signal
     pattern. Worktree dev-2026-05-25-bug-9-inbound-mid-cadence.
  C. UI gaps 12, 13, 15 — Sub-Account Settings save scopes (~1hr),
     SYSTEM sidebar agency/sub-account labels (~1hr), Agent version
     indicator widget (~1.5hr). Worktree dev-2026-05-25-ui-gaps-12-13-15.

WHEN ALL OF STREAM A + STREAM B DONE:
  - Claude runs the end-of-session audit query (tests all 5 slots filled,
    persona map = {property-coach:4, mortgage-broker:5, finance-strategist:6,
    generic-demo:7, crazy-gary:8}, GHL ids set, webhook_secret set).
  - Claude updates User Todos.md + writes a session-close memory.
  - Claude updates Operations/handoffs/2026-05-22-outcomes-and-current-state.md
    with §10 "2026-05-25 100% completion" row.

STANDING RULES:
- DO NOT touch clients.use_native_text_engine (vestigial post-Phase 10 but
  audit kept it intentionally).
- DO NOT edit any LLM prompt content yourself (Brendan owns prompt edits
  via UI; Bug 29 is manual).
- TEST_PHONE_A (+61405482446) free-use; TEST_PHONE_B (+61403804263, wife)
  requires explicit per-use permission.
- Max 5 outbound Retell calls without explicit OK (cost gate).
- Smoke test 5 calls (one per persona) is DEFERRED to a separate session
  per Brendan's prior selection — do NOT auto-run them this session.

ENV: cd /srv/bfd/Projects/bfd-setter. .env has SUPABASE_PAT,
BFD_RETELL_API_KEY, BFD_GHL_PIT, TRIGGER_DEPLOY_PAT, TRIGGER_PROD_API_KEY,
TRIGGER_SECRET_KEY.

Stream B worktree pattern (mandatory):
  git worktree add .worktrees/dev-2026-05-25-<slug> -b dev-2026-05-25-<slug> main
  cd .worktrees/dev-2026-05-25-<slug>
  ln -s /srv/bfd/Projects/bfd-setter/node_modules ./node_modules
  ln -s /srv/bfd/Projects/bfd-setter/frontend/node_modules ./frontend/node_modules
  cp /srv/bfd/Projects/bfd-setter/.env ./.env
  git push -u origin dev-2026-05-25-<slug>
  git push -u github dev-2026-05-25-<slug>

OK go. Read the handoff doc + the three other context files. Confirm the
state-of-play matches (HEAD d4f3841, phone pin v49/v49, etc.) with one curl
+ one git log. Then start Stream B autonomous work in the background while
standing by for Brendan's Stream A pings.
```
