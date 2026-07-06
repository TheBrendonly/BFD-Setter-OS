---
description: Session P1 close-out (2026-07-07) - full 6-list + MASTER-TODO audit against live state, BUG_LIST reconciled to 0 open items, reconciliation backlog archived, Brendan action pack produced.
---

# Session P1 — full list audit + reconciliation + Brendan action pack (2026-07-07)

Docs + report-only session (Sonnet, execute mode). No product code touched, nothing deployed, no prompt
content edited. Scope: audit all 6 canonical lists + `MASTER-TODO.md` against live reality, reconcile the
backlog, and produce a single paste-ready action pack for Brendan.

## Preflight

- `git pull`: already up to date. HEAD = `origin/main` = `github/main` = `0ad9c83` (the prior session's own
  close-out commit) — confirmed `origin`/`github` are in full sync (0 commits divergent either way).
- `.env` parses (53 lines, well-formed).
- `scripts/test-harness/q.mjs` answered a trivial `SELECT 1` and every live schema query below.
- Retell read-only reachable: `POST /v2/list-agents` → 200, 24 agents.

## Methodology

Read `SESSION_PLAN.md`, the two newest handoffs, all 6 lists, `MASTER-TODO.md`, `ROADMAP.md`, and
`Docs/archive/COMPLETED_LOG.md` in full. Cross-checked every claim against live state:
- **Edge function versions** (Supabase Management API `/functions`): all 21 functions referenced across the
  docs (bookings-webhook, get-show-rate-funnel, get-weekly-report, make-retell-outbound-call,
  retell-inbound-webhook, retell-call-webhook, retell-proxy, voice-booking-tools, webhook-manifest,
  verify-credentials, save-external-prompt, get-client-usage, invite-client-user, get-blended-rate,
  analyze-chat-history, analytics-v2-process, compute-analytics, get-openrouter-usage, get-chat-history,
  execute-lead-webhook, get-external-prompt) are **ACTIVE at exactly the claimed version** — no drift.
- **Schema** (`information_schema` via `q.mjs`): `booking_status_events`, `weekly_reports`,
  `client_report_config`, `sync_ghl_executions`, `tool_invocations`, `chat_starred`,
  `dismissed_error_alerts`, `client_pricing_config` all live; `clients.recording_disclosure_enabled` /
  `speed_to_lead_enabled` / `missed_call_textback_enabled` / `use_native_text_engine` all present, all
  defaulting `false` (confirms the "default OFF" claims for F16/F17 and explains why the ONBOARD-1 fix had
  to explicitly set `use_native_text_engine=true` at insert time).
- **Git log**: confirmed the combined-build range (`8950f69`..`7a0b0b4`) and the onboarding-fix range
  (`9f5b959`..`bb6322a`) are both ancestors of `main`/`github/main`.
- **Code greps**: spot-checked CHATS-DM-1 (`frontend/src/pages/Chats.tsx:589` now selects
  `setter_messages,grouped_message,channel`, not the nonexistent `messages` column — genuinely fixed),
  `trigger/_shared/businessHours.ts` exists (HOURS-1), `Contacts.tsx` Edit button now wired to a
  selection-bar handler (CONTACTS-EDIT-DEAD-1).
- **Handoff cross-reads**: grepped the 2026-07-05 TEST SESSION handoff directly (not just its summary in
  `TEST_LIST.md`) to resolve several ambiguous cases (F11/UI-1/F13/PROMPT-AUTH-1-X-Ray/B-2-outage — see
  below), rather than trusting a possibly-stale secondary summary.

## Audit findings

### BUG_LIST.md: every row was already resolved

All ~19 actionable rows (HOURS-1, PROMPT-AUTH-1, BOOK-1, API-DEPR-1, CANCEL-1, RESCHED-SMS-1, CHATS-DM-1, the
5-bug onboarding-gate cluster, FOLLOWUP-DURING-CALL-1, CONTACTS-EDIT-DEAD-1, DEPLOY-1, SMS-METER-1,
AUTH-LEN-1, RLS-SHAPE-1, BOOK-2, BOOK-3, PHONE-CLEAR-1, G3-7, G3-8) were either (a) already fully
live-verified and belonged in `COMPLETED_LOG.md`, or (b) code-complete + deployed with their live-verify
already tracked as an open row in `TEST_LIST.md` — meaning **the `BUG_LIST.md` entry itself was pure
duplication**. Rewrote `BUG_LIST.md` to a "0 open bugs" status page + the existing historical
"shipped in Session X" provenance notes.

### TEST_LIST.md: ~20 rows already passed but were never archived or removed

Two categories:

**(1) Explicit `[x] ... → COMPLETED_LOG` rows still physically present** (pure housekeeping — content
already correctly archived, just never deleted from the active list): CANCEL-1, BOOK-2/BOOK-3, SMS-METER-1,
VM-1 (×2, one per section), the whole "Onboarding-fix pass" block (ONBOARD-1/2/3, ACCESS-1, GOLIVE-1 UI),
VOICE GATE, F1/F3/F4 (Session 4 section), FOLLOWUP-PROMPT-1, plus a stale "3.12 SMS booking BLOCKED on
BOOK-1" row and a redundant "F9-1 / PHONE-CLEAR-1 / G3-8a" combined row (the F9-1 and PHONE-CLEAR-1 parts
were done; G3-8a is separately tracked and stays open).

**(2) Rows still marked `[ ]` open that had actually already passed** — found by reading the actual
2026-07-05 TEST SESSION handoff directly rather than trusting `TEST_LIST.md`'s own summary of itself:
- **F11** (masked-Configured indicator) and **UI-1** (plain setter labels) — both explicitly listed under RUN
  1's "Verified PASS (move to COMPLETED_LOG)" in the handoff, but their `TEST_LIST.md` rows were still `[ ]`.
- **Three of the four F13 UI checks** (margin panel vs SQL, client toggle matrix, period/anchor browsing) —
  RUN 1: "F13 margin + period/anchor + 4-toggle flip (+ `show_rate_to_client` mirror) + volumes vs SQL." Only
  the "dashboard summary card, both roles" check wasn't explicitly covered — left open.
- **PROMPT-AUTH-1's "Full-prompt visibility" X-Ray check** — RUN 1: "PROMPT-AUTH-1 X-Ray (full assembled
  prompt + matches badge)." The section text below it still said "not yet behaviorally confirmed" — an
  internal contradiction within the same file.
- **The B-2 GHL-outage resilience leg** — RUN 6: "B-2 outage: inbound never dropped, `bfd-<phone>` synthetic
  lead, `ghl_contact_resolve_degraded`, Twilio-direct reply, 0 dups, key restored" — word-for-word matches
  the still-open `TEST_LIST.md` row.
- **SMS-MEM-1, PROMPT-LINT-1, MODEL-1-HARDENING (UI variant only)** — all explicitly named in the
  "2026-07-05 — Build pass reconcile" `COMPLETED_LOG.md` entry, but duplicate open/`[x]`-not-yet-moved rows
  remained in `TEST_LIST.md`.
- **API-DEPR-2(a) + the F13 client-eye view** — `TEST_LIST.md`'s own text said "BOTH DONE + PASS on the
  Fable onboarding run → `COMPLETED_LOG.md`" but neither was ever actually written into `COMPLETED_LOG.md`.
  Added a full new entry citing the specific proof (throwaway agent `agent_c09e76046be7e61b57c030104d`,
  `get-agent` showing 3 system-presets; the client-JWT visibility-whitelist proof).

All of the above are now in `COMPLETED_LOG.md` with their real pass dates. Nothing was re-tested this
session — this was archival reconciliation only, each citation traceable to the run/handoff where it
actually happened.

### What's genuinely still open (left untouched in TEST_LIST.md)

The 2026-07-07 combined-build behavioral checks (Phase A bugs, F15, F16, F17-p1 — none of this has been
live-verified yet), F14 (gated on Resend), the F13 dashboard-summary-card check, F8 agency-panel-client-card,
B4 SMS-retry idempotency, three of the four B-2 checks (CSV import, background repoint, deterministic pick),
G3-6 Tier-3 (partial), INB-1, the backend leg of MODEL-1-HARDENING, G3-8(a), SYNC-LOG-1,
G3-6-SCHEMA-1 (partial), API-DEPR-1's remaining UI/notice-monitoring check, PROMPT-AUTH-1's "no leftover
artifacts" + "efficiency" checks (both blocked on Brendan's Setter-1 migration), and B-5 (needs a genuinely
unknown caller number).

### Other lists

- **`PROMPT_UPDATE_LIST.md`**: fixed the duplicate `PU-8` id — renumbered the inbound-unknown-caller-robustness
  item to **PU-12** (it's unrelated to the voicemail-placeholder PU-8).
- **`BRENDAN_TODO.md`**: ticked "git push github main" — confirmed via git log that `github/main` already
  carries the onboarding-fix range and is in full sync with `origin/main`.
- **`Docs/ROADMAP.md`**: already correctly banner'd as build history only ("This is build HISTORY, not the
  active to-do list") — no change needed.
- **`FEATURE_ROADMAP.md`** and **`Docs/DEFERRED.md`**: read in full, cross-checked against memory and current
  state — both already accurate and current, no staleness found.
- **`MASTER-TODO.md`**: not hand-edited (per its own header, auto-generated — edit the sources, not this
  file). **Note:** it did not regenerate automatically during this session (still timestamped 2026-07-06
  19:43 after all the edits above); the only `PostToolUse` hook found in `/srv/bfd/.claude/settings.json`
  triggers `todo-cockpit`'s `on_cockpit_change.sh` (the laptop-only cockpit), and `master-todo` is a separate
  skill directory (`/srv/bfd/.claude/skills/master-todo`) — worth confirming whether it's meant to regenerate
  automatically or only on explicit invocation, since right now it's showing a stale pre-session snapshot.

## Self-correction worth recording

The Retell-verification background agent initially identified "Main Outbound" as the agent literally named
`Voice-Setter-Test` (`agent_f45f4dd…`), reasoning from the phone number's static `outbound_agents` binding —
which is exactly the trap `CLAUDE.md` already warns against ("ignore the phone number attached to an agent in
Retell... does not indicate which agent is live"). This session's first pass repeated the same mistake before
catching it: cross-checking the platform `voice_setters` table (the "Main Outbound" row's `retell_agent_id`,
which is what `make-retell-outbound-call` actually reads via `override_agent_id` — verified by grepping the
function itself) and three dated real-call citations already sitting in `COMPLETED_LOG.md` showed the real
live "Main Outbound" is `agent_b2f6495…` — the same physical Retell agent as "Inbound BFD Agent". `CLAUDE.md`'s
existing caution about `Voice-Setter-Test` being unused was correct all along. This flipped several
conclusions: **PU-3 is still open** (not resolved — the shared agent's opener has no `{{first_name}}`), PU-6
needed one fewer "still missing" agent (Main Outbound already has the disclosure, being the same agent as
Inbound), PU-7 needed Main Outbound's own compliance downgraded from "compliant" to "borderline, your call",
and a fabricated "PU-13" (Main Outbound has no voicemail) was retracted entirely since it was checked against
the wrong, unused agent. All of `PROMPT_UPDATE_LIST.md`, `COMPLETED_LOG.md`, and the action pack were corrected
before this handoff was finalized — no wrong claim was left standing. No changes were made to `CLAUDE.md`
itself since its existing note turned out to be correct.

## Brendan action pack

Consolidated into `Operations/handoffs/2026-07-07-brendan-action-pack.md`: every `PROMPT_UPDATE_LIST` item
verified live against the actual Retell agents (read-only, via a dedicated verification pass — nothing
written to Retell), plus every open `BRENDAN_TODO` manual gate ordered by leverage (Resend + Setter-1
migration first, then F15/F16 dogfood-enablement + the GHL workflow, then first-client onboarding
prerequisites, then the lower-leverage items).

## First-Client Milestone: not run

Per scope, the gated milestone (`Docs/FIRST_CLIENT_MILESTONE.md`) was not touched. Its prerequisites are
confirmed still open and are called out explicitly in the action pack's ordered list (external Supabase
project, GHL location + PIT, Twilio BYO, `subscription_status` flip, canonical text `llm_model` decision,
plus M1 Resend + M2 Setter-1 migration from `Docs/TEST_SESSION.md` RUN 9).

## Close-out

- `BUG_LIST.md`, `TEST_LIST.md`, `Docs/archive/COMPLETED_LOG.md`, `Docs/PROMPT_UPDATE_LIST.md`,
  `Docs/BRENDAN_TODO.md`, `Docs/SESSION_PLAN.md` all updated (this session).
- Nothing deployed; no prompt content edited (report-only, verified read-only against live agents).
- Committed + pushed to `origin` + `github`.

## Next

Two options, per the pipeline Brendan set up for this relay:

```
[✓] Combined build   [✓] P1 audit + action pack (here)   [ ] P2 (Brendan picks)   [ ] P3 review+cleanup+research   [ ] First-Client Milestone (GATED)
```

**P2** is a Brendan-driven pick session over `Docs/DEFERRED.md` (most items there are explicitly gated on
things that haven't happened yet — a paying client, real usage data, a Supabase Pro upgrade — so there may be
nothing to actually build; if so, this session is a fast no-op). **P3** is a review+cleanup+research session
(security/quality review pass — the last one was 2026-06-05, a month before this rapid-fire feature/bug
stretch; doc/dead-code hygiene; a refresh of the F18-F20 post-client research so those are build-ready the
moment a client signs). Both prompts are below (P2 primary; skip straight to P3 if Brendan prefers).

### Session P2 prompt (primary)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (may involve new feature design - research + approve before any edits).

BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. No em dashes. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the 2026-07-07 P1 handoff + action pack, Docs/DEFERRED.md.

BFD-setter - Session P2: deferred-feature pick session.

Scope: this is a Brendan-driven triage, not a default build session. Most of Docs/DEFERRED.md is
explicitly gated on something that hasn't happened yet (a paying client, real usage data, a Supabase Pro
upgrade, an explicit client ask) — the point of this session is to check whether any of those gates have
now been met, or whether Brendan wants to pull something forward regardless of its gate, NOT to build the
list wholesale.

1. Walk Docs/DEFERRED.md with Brendan section by section (Lead lifecycle system, F8 v2, 2.6 cost dashboard,
   3.1 A/B testing, 3.2 agent-by-form-field, 3.3 campaign-level default setter, 3.9 cost-ceiling aggregates,
   3.11 HubSpot+GHL, 4.1 pricing model, 4.3 multi-Twilio failover, BOOK-TZ-1 per-lead timezone, E-1, email
   provider, HIBP, the text_engine_webhook column drop, the by-phone Spec-2 N-row merge, F9 v2). For each,
   ask: has the stated gate been met, or does Brendan want it built anyway?
2. For anything Brendan greenlights: use superpowers:brainstorming first (this is new feature work), then
   writing-plans, then build it following the same TDD + verify-before-completion discipline as every other
   session here.
3. If nothing is greenlit: say so plainly, do not invent scope, and close this session out as a fast no-op.
4. Do NOT touch the gated First-Client Milestone items (Stripe, webhook secrets, AU A2P) - those stay in
   Docs/DEFERRED.md's "First-paying-client onboarding cluster" and DEFERRED.md's other still-gated items.

Close out per the Relay Protocol regardless of outcome (update the lists if anything shipped, write a dated
handoff, commit/push). Then emit the Session P3 prompt (or, if this session decides P3's scope should change
based on what got built here, an adjusted version of it) verbatim in chat + save it into the handoff.

▶ PIPELINE: [✓] P1 audit + action pack   [•] P2 (here)   [ ] P3 review+cleanup+research   [ ] First-Client Milestone (GATED)
```

### Session P3 prompt (alternative — skip straight here if Brendan doesn't want a P2 pick session)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (touches security-review-driven fixes across many surfaces).

BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. NEVER edit voice prompts (report-only). Verify read-only before claiming done.
No em dashes. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the 2026-07-07 P1 handoff + action pack, Docs/SECURITY_REVIEW_2026-06-05.md.

BFD-setter - Session P3: review + cleanup + research (polish pass before the First-Client Milestone).

Scope:
1. Security/quality review pass. The last full security review was 2026-06-05 — a full month of rapid
   feature + bug-fix work has landed since (F8/F9/F13/F14/F15/F16/F17-p1, the onboarding-gate cluster, the
   shared-fn booking/cancel fixes, PROMPT-AUTH-1). Run the /security-review skill and a /code-review high
   pass over everything shipped since 4a22b8b (Session 9). Report findings; fix anything Critical/High
   directly (with tests), log Medium/Low to BUG_LIST.md if genuinely new.
2. Doc + dead-code hygiene. Known small items to close out: the ClientLayout.tsx:618 dead
   presentation_only_mode redirect branch (harmless, but confirm and remove if still genuinely dead); revisit
   whether the clients.text_engine_webhook column drop (DEFERRED.md) is worth doing now; a light pass over
   any other "noted but out of scope" dead-code callouts accumulated across the BUG_LIST/COMPLETED_LOG
   history (grep COMPLETED_LOG.md for "dead" / "orphan" / "unwired").
3. Refresh F18-F20 post-client research. F18 (AI confirmation call ~24h pre-appointment), F19 (call QA
   digest), F20 (booked-revenue attribution) are all "post-first-client fast-follow" in FEATURE_ROADMAP.md,
   based on 2026-07-04 market research. Do a light refresh pass (has anything material changed since then?
   any new competitor/compliance developments?) so these are genuinely build-ready the moment a client signs
   — per the research's own finding, "no visible ROI" is the #1 retainer-churn driver, so post-client speed
   on these matters.
4. Confirm Docs/FIRST_CLIENT_MILESTONE.md's prerequisite checklist is airtight given everything shipped since
   it was last touched (2026-07-04) - do not run the milestone itself.

Close out per the Relay Protocol. Emit the First-Client Milestone prompt as the next step (it's already
written in Docs/FIRST_CLIENT_MILESTONE.md - confirm it's still accurate rather than rewriting it, and remind
Brendan it is event-gated: only run it once a client has actually signed).

▶ PIPELINE: [✓] P1 audit + action pack   [✓ or skipped] P2   [•] P3 (here)   [ ] First-Client Milestone (GATED)
```
