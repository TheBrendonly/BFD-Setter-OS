---
description: Session closeout 2026-06-25 — reconciled all BFD-setter tracking into 5 canonical lists, archived 19 docs (36→21), pruned git branches to main + cadence-v2-lifecycle-wip, fixed memory drift; next session = doc sense-check of the 21 kept docs.
---

# Handoff 2026-06-25 — list/doc reconciliation DONE; next = doc sense-check

## TL;DR
Walked every open item one-by-one with Brendan and reconciled all the scattered tracking into **5 canonical lists**. Archived 19 superseded docs (36→21 in `Docs/`). Pruned all merged/stale git branches (local + both remotes) down to `main` + `feat/cadence-v2-lifecycle-wip`. Fixed the memory that had wrong inbound-agent wiring. Committed to `main`.

Repo `/srv/bfd/Projects/bfd-setter`, branch `main`. Supabase ref `bjgrgbgykvjrsuwwruoh`. Creds in `./.env` (`SUPABASE_PAT`, `TRIGGER_DEPLOY_PAT`, `BFD_RETELL_API_KEY`). Live DB reads via Supabase **Management API** `/database/query` (NOT the postgres MCP). Live Retell reads via `https://api.retellai.com/...` with `BFD_RETELL_API_KEY`. **Never edit voice prompts** (report-only). Read the **phone-number binding** (`list-phone-numbers`) to know which agent serves a direction — do NOT trust old memory.

## The 5 canonical lists (single source of truth — use ONLY these)
- `Docs/BUG_LIST.md` — OPEN bugs (B-1..B-5, G3-1..G3-6, types.ts drift). All CODE unless `[B]`.
- `FEATURE_ROADMAP.md` (repo root) — build queue F1..F7.
- `Docs/BRENDAN_TODO.md` — Brendan's manual/UI actions.
- `Docs/TEST_LIST.md` — verify-after-build (Brendan runs ALL tests at the end).
- `Docs/DEFERRED.md` — gated/someday, incl. the ⭐ major lifecycle system.
- Closed → `Docs/archive/COMPLETED_LOG.md`. **Rule:** fixed+needs-verify → TEST_LIST; fixed+verified → COMPLETED_LOG.

## Decisions locked this session (these drive the lists)
- Setter-name source-of-truth = the setter-edit-page name field; duplicate flow writes the same field; cascade everywhere (B-1).
- STOP + inbound = internal-first by-phone, drop the GHL lookup (B-2).
- Settings nav: client = "My Account" only; admin = "My Account" + "Sub-Accounts" (list→click→config) (B-4).
- Voice-setter model: ONE setter flagged inbound; outbound chosen at campaign/workflow level; remove per-setter outbound binding (F2).
- Cadence direction = the lifecycle system 3.5/3.6/3.7 (DEFERRED, major, soon); deleted the flat 28-node draft `c206da3e` (F7).
- n8n decommission (F5); remove the setup-guide quizzes (F6).
- GHL SMS-in-Conversations: ship a GHL→BFD deep-link custom field (F1), skip the marketplace conversation-provider near-term. Upstream `1prompt-os` never used a provider.

## Verified-live findings (read-only) worth remembering
- Inbound `+61481614530` answers on a SEPARATE **"Inbound BFD Agent"** `agent_b2f6495` (LLM `llm_9dd6af7` v2, neutral greeting — the greeting split is DONE). Outbound = `agent_f45f4dd` "Main Outbound".
- **B-3 bug:** outbound number is version-pinned at **v19** while the agent's latest published is **v21** (inbound auto-follows latest_published; outbound doesn't).
- **B-5 bug:** `default_dynamic_variables` is null on every agent — the v43 net never persisted.

## What was executed (not just documented)
- Git: deleted all merged/stale branches on local + `origin`(Forgejo) + `github`. Only `main` + `feat/cadence-v2-lifecycle-wip` (3.5 lifecycle WIP) remain. Removed the merged `internal-by-phone-leads` worktree.
- Docs: 19 dated/session/kickoff/prompt one-offs + `User Todos.md` → `Docs/archive/`.
- Memory: corrected `project_inbound_outbound_share_agent_2026_06_24`, flipped stale "NOT merged" flags in `MEMORY.md`, added `project_list_doc_reconciliation_2026_06_25`.

---

## ===== COPY-PASTE KICKOFF PROMPT (next session = DOC SENSE-CHECK) =====

```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main. Supabase ref
bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via
api.retellai.com with BFD_RETELL_API_KEY. Read the phone-number binding to know which agent serves
a direction. NEVER edit voice prompts (report-only). Verify read-only before claiming done.

READ FIRST: Operations/handoffs/2026-06-25-list-doc-reconciliation-and-next.md (this), then the 5
canonical lists: Docs/BUG_LIST.md, FEATURE_ROADMAP.md, Docs/BRENDAN_TODO.md, Docs/TEST_LIST.md,
Docs/DEFERRED.md. Memory: project_list_doc_reconciliation_2026_06_25.

TASK — DOC SENSE-CHECK (the 21 kept docs). Last session reconciled all tracking into the 5 lists
and archived 19 stale docs. Now make sure the REMAINING docs still make sense and are non-redundant.
Go file-by-file through Docs/*.md + the root docs (CLAUDE.md, AGENTS.md, README.md, FEATURE_ROADMAP.md)
and for each decide: KEEP-as-is / UPDATE (stale content) / MERGE (overlap) / ARCHIVE (no longer needed).
Do NOT rewrite wholesale — surgical updates only; report before large changes.

Specifically check these for staleness against the locked decisions:
- Docs/CADENCE_DESIGN.md — references the deleted 28-node draft c206da3e + n8n; should point to the
  lifecycle direction (3.5/3.6/3.7) and note n8n is being decommissioned (F5).
- Docs/ROADMAP.md — chronological build log; keep but confirm it isn't duplicating the 5 lists.
- Docs/WORKING_PROMPTS.md — flagged repo/live prompt drift; confirm still useful or archive.
- Docs/ARCHITECTURE.md — confirm it reflects current wiring (separate inbound agent; Twilio-direct;
  multi-DB; clients_public view).
- Docs/GHL_SYNC_FIX_2026-06-19.md + Docs/GHL_CUSTOM_FIELDS_HITLIST.md — still the reference for the
  F1 deep-link + 6.12b outcome fields? keep or fold.
- CLAUDE.md / AGENTS.md — add a pointer to the 5 canonical lists so future sessions use them (and keep
  the twin files in sync per the global rule).
- Confirm the 5 lists cross-reference each other correctly and nothing fell through the cracks.

Output: a short keep/update/merge/archive table for every doc, apply the safe ones, and leave a note
for anything needing Brendan's judgment. End state = a coherent, minimal doc set.

AFTER the doc review, the build backlog is ready in the lists. Likely first build session: the
security quick-wins (G3-1/G3-2/G3-4) + B-1 setter-rename cascade + B-3/B-5 Retell version-pin/default-vars,
or F1 (GHL deep-link) — Brendan picks.
```

## ===== END KICKOFF PROMPT =====
