> **ARCHIVED / HISTORICAL — NOT CURRENT STATE.**
>
> This document is kept for provenance only. It records what was true when it was written and is
> **not maintained**. Do not treat any status, version number, or "next step" in it as current.
>
> For what is actually true now, start at [`Docs/README.md`](../README.md) and
> [`Docs/SESSION_PLAN.md`](../SESSION_PLAN.md).

---
# Next-session activation prompt (2026-05-31)

Paste the block below into a fresh Claude Code session at `/srv/bfd/Projects/bfd-setter`.

---

You are continuing the bfd-setter build. This is a **full autonomous build-to-completion session**: implement everything below, deploy it, and only stop when it is all done. The decisions are already locked (do not re-ask them). Research/verify in code as needed, but do not pause for approval — build, verify, deploy, checkpoint, continue.

## Read first (authoritative context)
- `Docs/ROADMAP.md` — the **SESSION LOG — 2026-05-31** and **NEXT SESSION — locked scope** sections are your spec + both to-do lists.
- `Docs/FORM_ROUTING.md` — the canonical "one webhook URL + tag" routing model.
- `Docs/ARCHITECTURE.md` — current system + capability set.
- Your memory note `project_setter_capability_decisions_2026_05_30` — decisions + ops gotchas.

Current state: HEAD `14af1ee` on `main` (remotes `github` = Railway, `origin` = Forgejo). Backend already deployed to Supabase project ref `bjgrgbgykvjrsuwwruoh`. Frontend deploys via Railway on push to `main`.

## Locked decisions
1. Canonical lead-intake ingress = **`sync-ghl-contact`** (one URL, route by tag, default fallback to `clients.auto_engagement_workflow_id`).
2. Agent-per-form = **tag-per-campaign ONLY**. Retire the Try-Gary persona-slot mechanism (`try_gary_persona_slots`). Do NOT build a within-cadence agent override or a persona-slot UI.
3. **Deploy autonomously** — apply migrations via the Supabase Management API (PAT in `.env`), deploy edge functions via `scripts/deploy_*` , push to `github` + `origin`. Verify every step.
4. Also include: regenerate `types.ts`, gate `/debug-*` routes, retire legacy reactivation, resolve the dual root lockfile.
5. Build the Try-Gary campaign ready for tag ingress.

## Tasks (all of them — see ROADMAP "Claude to-do" for detail)
1. **Single-ingress consolidation**: make `sync-ghl-contact` the canonical endpoint (solid tag routing + default fallback); deprecate the `try-gary-landing` handler in `ghl-tag-webhook` (keep working, mark deprecated) and remove the persona-slot override; document the one-URL+tag pattern.
2. **UI hole 1** — tag-input UX on the campaign row (Workflows.tsx): label, helper, save confirmation, empty-field error.
3. **UI hole 2** — activate/enable toggle on the campaign list row (Workflows.tsx; reuse the Engagement.tsx `is_active` update pattern).
4. **UI hole 3** — DEFAULT badge + "Set as default" on campaign rows (Workflows.tsx; `clients.auto_engagement_workflow_id`).
5. **Try-Gary campaign** — clone the main cadence ("New-Lead Cadence from Form-Fill", id `40e8bea3-b6f6-4562-98d1-f7e6599af6a1`) into the Try-Gary campaign (id `3fda0794-006e-4285-8e4c-04b9667327c9`); keep tag `bfd_setter-try_gary`; set the phone_call node's voice setter (leave a clear TODO for Brendan to confirm which agent); leave INACTIVE pending Brendan review. Do NOT author message content — clone only. BFD client_id `e467dabc-57ee-416c-8831-83ecd9c7c925`.
6. **Regenerate** `frontend/src/integrations/supabase/types.ts` from the live schema (clears ~26 drift errors; picks up `leads.form_source`, `voice_setters.legacy_slot`).
7. **Gate** `/debug-ai-reps*` and `/debug-inject-lead` behind creator/admin mode in App.tsx (`useCreatorMode` `cb` exists).
8. **Retire legacy reactivation** — FIRST verify native reactivation works end-to-end this session, THEN remove `campaign-executor` / `bulk-insert-leads` / `campaign_leads` (code + UI refs + a drop/deprecate migration).
9. **Resolve dual lockfile** — delete root `pnpm-lock.yaml`, standardize on npm; verify Railway build is unaffected.
10. **Deploy everything** autonomously + verify (migrations, edge fns, push); update all docs; commit + push.

## Hard constraints
- **No authoring of prompt/message content** — clone Brendan's existing content; never write new agent prompts/messages.
- **Verify every "dead code" claim before deleting** — the 2026-05-30 audit was wrong 3 times (execution_logs RLS, LEGACY_N8N_HOST, elevenlabs handler, webinar components are all in use). Grep/confirm references first.
- **Backward compatible** — never break the live main-form flow; legacy paths keep working until explicitly retired + verified.
- **Deploy ops**: Supabase Management API SQL runner needs a browser-style `User-Agent` (Cloudflare 1010 bans `python-urllib`); `SUPABASE_PAT` in `.env` is valid.

## At the end
Produce a **detailed, step-by-step plan of everything Brendan must do** (GHL automations per form/agent pointing at the one webhook URL + tag; Retell/Twilio provisioning; review/activate the Try-Gary cadence + confirm its agent; end-to-end test). Note anything you discovered during the build that needs his input.

Start by reading the ROADMAP NEXT SESSION section and confirming current state, then build straight through.
