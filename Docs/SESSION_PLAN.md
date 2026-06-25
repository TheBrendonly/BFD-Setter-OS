# BFD-Setter — Master Session Plan (to v1 "100%")

**This file is the single source of truth for the session sequence.** Prompts point here; they do NOT
duplicate it. Every session keeps this file current, then emits the next session's prompt from it.
"100%" = rock-solid for the current live setup + ready to onboard a paying client. The deferred /
lifecycle work (`Docs/DEFERRED.md`) is v2 and NOT on this critical path.

The 5 canonical lists are the detail behind each session: `Docs/BUG_LIST.md`, `FEATURE_ROADMAP.md`,
`Docs/BRENDAN_TODO.md`, `Docs/TEST_LIST.md`, `Docs/DEFERRED.md`. Closed items → `Docs/archive/COMPLETED_LOG.md`.

---

## The Relay Protocol (how EVERY session runs)

1. **START.** Read (in order): this `SESSION_PLAN.md`, the latest `Operations/handoffs/` doc, and the
   list(s) named in this session's scope. Confirm `main` is current (`git pull` first).
2. **DO** only this session's scoped work (below). Stay in scope; if you find something out of scope,
   add it to the right list, don't build it.
3. **VERIFY** read-only / server-side before claiming anything done (tsc + deploy + push are necessary,
   not sufficient). Brendan runs live tests in the dedicated TEST session.
4. **CLOSE OUT — always do all of these, in order:**
   a. Update the 5 lists: move each finished item OUT (→ `TEST_LIST.md` if it needs live verification,
      else → `archive/COMPLETED_LOG.md`).
   b. Update THIS file: tick the session done; if reality changed (new bug, reprioritization, a session
      split or merged), edit the remaining sequence so it stays true.
   c. Write a dated handoff in `Operations/handoffs/YYYY-MM-DD-<topic>.md`.
   d. `git add -A && commit && push` to `origin` + `github` (docs/code both go to `main`).
   e. **Emit the NEXT session's prompt** — generate it FRESH from this file's next entry, print it in
      chat in a fenced block AND save it into the handoff. Use the Standard Context Block below + the
      next session's scope + this Relay Protocol. Do NOT paste the whole plan into it.

If a session is Brendan-driven (TEST or a manual milestone), the closeout still updates the lists +
this file + handoff, and emits the prompt for whatever comes after.

### Standard Context Block (paste at the top of every emitted prompt)
```
BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a direction, read the PHONE-NUMBER binding
(list-phone-numbers inbound_agent_id/outbound_agent_id) — never trust old memory. NEVER edit voice
prompts (report-only: report location + change, Brendan applies in the BFD setter UI). Verify read-only
before claiming done. Follow the Relay Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md + the latest Operations/handoffs/ doc + the list(s) for this session.
```

### Plan mode per session
Start in **plan mode** (research + approve the approach before any edits) for the **design-heavy or
live-path** sessions: **Session 1 (B-1 cascade), Session 4 (F1/F3), Session 5 (B-2 by-phone pivot)**,
and any session that touches the live cadence runtime or many surfaces. **Skip plan mode** (just
execute) for the **mechanical/prescriptive** ones: Session 2 (G3 sweep), Session 3's cleanup
(F5/F6/F7), types.ts, the **doc** session, and the **TEST** session (read-only / Brendan-driven).
Each emitted prompt should state the recommended mode. Note: the closeout (update lists/plan, commit,
push, emit next prompt) runs after you approve + exit plan mode — plan mode front-loads a review gate,
it does not block the relay.

---

## The sequence

Status: `[ ]` not started · `[~]` in progress · `[x]` done. Effort is rough.

- [x] **Session 0 — Documentation fix-up.** DONE 2026-06-25. Keep/update/merge/archive table produced for
  every doc; CADENCE_DESIGN repointed off the deleted `c206da3e` → lifecycle (no more activation SQL);
  ARCHITECTURE got a current-wiring note (separate inbound agent, Twilio-direct, Retell-native voicemail,
  multi-DB, `clients_public`); ROADMAP banner'd as history; root README n8n-staleness + 2 broken links
  fixed; Docs/README index now leads with the 5 lists + SESSION_PLAN + a reference-docs table;
  `CLAUDE.md`/`AGENTS.md` got the tracking pointer (twins in sync); archived `WORKING_PROMPTS.md` +
  `AUDIT_RECONCILIATION_2026-06-19.md`. Doc set: 20 Docs/*.md, coherent + minimal. → emitted **Session 1**.
- [x] **Session 1 — Voice reliability (CODE).** DONE 2026-06-25. B-3 outbound now writes `agent_version:"latest_published"`
  (auto-follow, immune to the stale-pin class; Retell `AgentVersionReference` confirmed to accept the string). B-5
  root-caused: `default_dynamic_variables` is an **LLM** field, not an agent field — the v43 agent-level set was a
  silent no-op (verified on a throwaway agent); moved to `llmPayload` + reasserted on rename; **verified end-to-end**.
  B-1 rename cascades to one name across `prompts.name`/`agent_settings.name`/`voice_setters.name`/Retell `agent_name`
  + card lines (spoken persona untouched; "Title follows name" per Brendan). retell-proxy v45, duplicate-setter-config v8;
  tsc clean. B-1/B-3/B-5 → `TEST_LIST.md`. **PREREQ for TEST:** Brendan re-Saves the 5 setters. → emitted **Session 2**.
- [ ] **Session 2 — Security/quality sweep (CODE).** `BUG_LIST` G3-1 (fail-closed on NULL intake_lead_secret),
  G3-2 (S4-10 shared-agent disambiguation), G3-3 (S2b-11 outcome-stamp guard), G3-4 (S4-8 status codes),
  G3-5 (esbuild ≥0.25), types.ts drift (5 phantom columns). No decisions. **Done when:** all deployed +
  moved to TEST_LIST. → emits **Session 3**.
- [ ] **Session 3 — Settings + setter cleanup (CODE).** `BUG_LIST` B-4 (client="My Account" only; admin=
  "My Account"+"Sub-Accounts"); `FEATURE_ROADMAP` F2 (UUID-native node picker + single inbound-setter
  binding + remove outbound-direction config), F5 (n8n decommission), F6 (remove setup-guide quizzes),
  F7 (delete draft cadence `c206da3e`). **Done when:** deployed + moved to TEST_LIST. → emits **Session 4**.
- [ ] **Session 4 — Client visibility + cadence controls (CODE).** `FEATURE_ROADMAP` F1 (GHL→BFD deep-link
  custom field), F3 (pause/resume a running cadence), F4 (per-tenant timezone `nudgeColdReply` cron).
  **Done when:** deployed + moved to TEST_LIST. → emits **Session 5**.
- [ ] **Session 5 — By-phone pivot (CODE).** `BUG_LIST` B-2 (internal-first STOP + inbound resolution,
  drop the GHL lookup). Larger behavior change to a live path; do it alone + carefully. **Done when:**
  deployed + moved to TEST_LIST. → emits **Session 6**.
- [ ] **Session 6 — Secret-read hardening (CODE, optional pre-100%).** `BUG_LIST` G3-6 (move ~20 browser
  secret-value reads behind edge fns). Defense-in-depth (already RLS-scoped), so can slot after the TEST
  pass if time-boxed. **Done when:** deployed + moved to TEST_LIST. → emits **Session 7**.
- [ ] **Session 7 — TEST pass (BRENDAN drives, Claude verifies).** Run the whole `Docs/TEST_LIST.md` in one
  live sweep (go-live smokes + B4 no-double-send + B-1/B-3/B-4/B-5 retests). Pre-req: Brendan re-Saved
  the 5 setters (from Session 1). Each pass → COMPLETED_LOG; each fail → a new BUG_LIST item + a fix
  session. **Done when:** TEST_LIST is empty/green. → emits the **First-client milestone**.
- [ ] **First-client milestone (BRENDAN, gated).** Not a Claude code session. At the first paying client:
  flip Stripe live (backfill `subscription_status` → set `ENFORCE_SUBSCRIPTION_GATE=true`), provision the
  GHL/Retell/Unipile webhook secrets + arm `retell_webhook_secret` (6.6), register AU SMS A2P for
  `+61481614530`. See `Docs/DEFERRED.md`. After this, v1 is live + 100%.

When Sessions 0-7 are `[x]` and TEST_LIST is green, BFD-setter is at v1 "100%". v2 = the lifecycle
system + A/B + analytics + HubSpot (`Docs/DEFERRED.md`).
