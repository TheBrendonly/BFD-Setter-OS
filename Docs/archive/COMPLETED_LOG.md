# BFD-Setter — Completed / Closed Items Log (archive)

Items closed out of the active lists. Newest first. The active lists are in the repo root + `Docs/`
(`BUG_LIST.md`, `FEATURE_ROADMAP.md`, `BRENDAN_TODO.md`, `TEST_LIST.md`, `DEFERRED.md`).

## 2026-06-25 — Session 2 (security/quality sweep)

- **G3-1 (S2b-4) fail-closed on NULL `intake_lead_secret`** — was ALREADY fixed in `49a594e` (audit sweep 2026-06-23): both `voice-booking-tools` and `kb-ingest` now return 401 when the client's `intake_lead_secret` is NULL (stricter than asked — covers read tools too). It was simply never moved off `BUG_LIST`. No code change this session; closed here. The other Session-2 items (G3-2 disambiguation, G3-3 outcome-stamp guard, G3-4 status codes, G3-5 esbuild override, types.ts drift) are deployed and live in `TEST_LIST.md` pending Brendan's UI verification.

## 2026-06-25 — list/doc reconciliation session (with Brendan)

Closed:
- **Inbound neutral greeting (item 3 / 6.8 inbound)** — DONE. Verified live: the inbound number `+61481614530` answers on a dedicated **"Inbound BFD Agent"** (`agent_b2f6495`, LLM `llm_9dd6af7` v2) opening "Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital… What can I help you with?" (no `{{first_name}}`). Earlier confusion was a stale memory claiming inbound==outbound==`agent_f45f4dd`.
- **Trigger.dev call latency** — DONE. Root cause was a Trigger.dev region dequeue incident (platform/region), now resolved; not a concurrency cap.
- **6.8 greeting `{{first_name}}`** — DONE. Outbound personalizes ("Hey {{first_name}}, it's Gary…"), inbound is neutral. Both correct.
- **F10 rotate old anon key `awzlcmdomhtyqjabzvnn`** — DONE (Brendan).
- **6.13 GHL Supabase-secret custom fields** — VERIFIED-CLEAR (0/123 fields match).

Dropped (will not track):
- **New-setter "Joe's Diner" seed prompt** — Brendan won't onboard people this way; removed from all lists.

Decisions locked (drive the active BUG/FEATURE items):
- Setter name source-of-truth = the setter-edit-page name field (and the duplicate flow writes the same field). → B-1.
- STOP + inbound = internal-first by-phone, drop the GHL lookup. → B-2.
- Settings nav: client sees only "My Account"; admin sees "My Account" + "Sub-Accounts" (list → click → config). → B-4.
- Voice-setter model = one setter flagged inbound; outbound chosen at campaign/workflow level; no per-setter outbound binding (kills old 2.3). → F2.
- Cadence direction = the lifecycle system (3.5/3.6/3.7); flat 28-node draft `c206da3e` deleted. → DEFERRED (major).
- n8n to be decommissioned (F5); the setup-guide quizzes that teach the n8n/1prompt model to be removed (F6).
- GHL SMS-in-Conversations: drop the marketplace conversation-provider near-term; ship the deep-link custom field instead (F1).

Git hygiene: deleted all merged/stale local + remote branches on `origin` (Forgejo) and `github`; kept only `main` + `feat/cadence-v2-lifecycle-wip` (the lifecycle WIP). Removed the merged `internal-by-phone-leads` worktree.

> Prior shipped work (audit waves 2026-06-10/19/23, billing B1/B2, session-1 hardening, S6 features, clients_public boundary) is recorded in `Docs/ROADMAP.md` and the dated handoffs under `Operations/handoffs/`.
