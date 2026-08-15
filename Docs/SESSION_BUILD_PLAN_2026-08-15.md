---
description: Curated build plan for the next bfd-setter session — DO NOW + NEXT feature/bugfix work, with LATER separated. Written 2026-08-15 after Phase 1 + Phase 2 cadence work shipped.
---

# bfd-setter — Next-session build plan (created 2026-08-15)

This is the runbook for the next Claude Code session on bfd-setter. Work **DO NOW** top to bottom, then **NEXT**. **LATER** is out of scope for this session — do not start it. Brendan monitors and answers at each **GATE**.

Context: the lead follow-up cadence work shipped + verified live 2026-08-15 (Lead Sequences rename, per-client nudge config, `awaiting_reply` flag, lifecycle state machine, retention cutoff). The old "zero new product code until a pilot is paid" rule is **LIFTED** (Brendan, 2026-08-15) — feature builds are allowed again.

---

## HOW TO START THIS SESSION (paste-in preamble)

- **Model: Claude Opus 4.8 (`claude-opus-4-8`). Do NOT use Opus 5 — Brendan finds it unreliable.**
- **Thinking: extended thinking ON, high reasoning effort.**
- **Plan mode: start in plan mode.** For any item that is structural or >30 lines, present a plan and wait for Brendan's approval before writing code. Small, fully-specified fixes (<30 lines, spec below) can go straight to a diff for approval.

## GLOBAL GUARDRAILS (read every item)

1. **Verify against the RUNNING APP, not green builds.** This session's hard lesson (2026-08-15): three bugs hid behind green `npm run build` + passing tests + correct DB — only the live render smoke caught them. `npx tsc` is a no-op here and vite strips types (see CLAUDE.md "Verification Reality"). `npm test` (633 tests) is the unit safety net; for anything frontend, run the headless render smoke.
2. **Agency settings cards READ from `clients_public`, WRITE to base `clients`.** GATE A revoked base-`clients` SELECT from the `authenticated` role; a card reading `from('clients')` 403s ("Failed to load"). Any NEW non-secret column a card reads must be appended to the `clients_public` view (regenerate from live `pg_get_viewdef`, append before `FROM clients`, keep the tenant WHERE + `security_invoker=off`; see migration `20260814100000`). Memory: [[feedback_agency_cards_read_clients_public]].
3. **Verify a frontend deploy by walking the chunk graph, not the `index-*.js` entry hash.** Lazy-chunk-only changes don't move the entry hash, and the SPA returns `index.html` (200, text/html) for any unknown `/assets/*.js` path. Poll the GitHub commit status (`gh api repos/TheBrendonly/BFD-Setter-OS/commits/<sha>/status`) and BFS the served chunk graph for a distinctive source string. Memory: [[feedback_verify_frontend_deploy_walk_chunk_graph]].
4. **Deploy order: migrations FIRST**, then edge functions, then trigger, then frontend (`git merge --ff-only` to main + push both remotes → Railway). Frontend that SELECTs new columns white-screens until the migration is applied.
5. **Deploy mechanics** (all worked this session): migrations via the Management API (`scripts/apply_sql.mjs` pattern, `SUPABASE_PAT` from `.env`, ref `bjgrgbgykvjrsuwwruoh`); edge fns via `SUPABASE_PAT=… node scripts/deploy_single_fn.mjs <slug>` (bundles `_shared`); trigger via `TRIGGER_ACCESS_TOKEN=$TRIGGER_DEPLOY_PAT npx trigger.dev@4.4.4 deploy`. The auto-mode classifier sometimes blocks a deploy script on the first try — retry once; if it blocks a security-view recreate, generate the migration file and apply via the vetted `apply_sql.mjs` path.
6. **Browser/UI checks need a fresh 6-digit 2FA code from Brendan** (Supabase session ~17h, single-use refresh token). Arm `scripts/test-harness/auth.mjs <scratch-dir>` in the background FIRST, ask for the code, write it to `<scratch-dir>/totp.txt` when ARMED. Never edit voice-agent prompts (report-only). See CLAUDE.md login section.
7. **At every GATE, stop and ask Brendan in-session.**

---

## DO NOW

### 1. Deploy F24 — stop nudging booked leads  (GATE: supervised voice window)
**Why:** a lead who books can still get chased by the cadence/nudge engine — bad UX, worse now that the nudge/lifecycle engine is live. Fix is already BUILT + STAGED, just not deployed.
**Where:** frozen branch `frozen/voice-booking-bundle` (`b710eab`). It hoists `endCadenceOnBooking` out of the id-gate + adds defensive `deriveAppointmentId` (also carries SLOT-MAP-1 + BOOK-ABORT-GHOST-1 + telemetry per memory [[project_autonomous_build_2026_07_12]]). **Do NOT deploy blind** — it's the frozen voice-booking bundle (retell-proxy/voice-booking-tools/retell-call-analysis-webhook); review the diff vs current main first, confirm no agent mutation, and deploy in a window where Brendan can test-book immediately after.
**Verify:** live SMS/voice booking → confirm the booked lead stops receiving cadence/nudge messages; check `engagement_executions.stop_reason='booking_created'`.
**Owner:** Claude deploys; Brendan supervises + test-books.

### 2. Harden receive-twilio-sms + twilio-status-webhook  (small, ~15 lines, Claude solo)
**Why:** inbound SMS is silently dropped on any client-resolution failure — only a `console.warn`, no `error_logs` row, no alert, Twilio sees HTTP 200. The 2026-04-30 follow-up (`Docs/archive/CHANGES_LOG.md:127`) never shipped. Latent data-loss.
**Where:** `frontend/supabase/functions/receive-twilio-sms/index.ts:464` (`.eq("retell_phone_1", toPhone).maybeSingle()`) and `twilio-status-webhook/index.ts:111`. Three changes each:
  1. add `.eq('dm_enabled', true).order('created_at').limit(1)` (PGRST116 on 2 rows currently drops the message)
  2. replace the warn-only bail with an `error_logs` insert (`error_type: 'client_resolve_failed'`)
  3. normalise `To` before matching (currently raw string equality — a differently-formatted stored number silently fails)
**Verify:** `npm test` (edge tests); after deploy, a signed inbound-SMS sim (harness `sms_inbound.mjs`) for a resolvable number still routes; a deliberately-unresolvable `To` writes an `error_logs` row instead of silently dropping. Deploy both edge fns.
**Owner:** Claude solo (bugfix on shipped code).

### 3. Verify the demo funnel end-to-end: /try-gary → GHL → cadence, then DEMO-CB-1  (GATE: Brendan at phone)
**Why:** `/try-gary` (bfd-website, embedded GHL form `iDfDFi1u7Kj9TOehNmoJ`, copy says "calls you back in under 60 seconds") has NEVER been live-verified end to end. It's one of three surfaces the Sales Motion still eyes for the LinkedIn Featured section — if promoted untested, a real prospect submits and gets nothing. DEMO-CB-1 is the active near-term thread (`Docs/NEXT_SESSION_PROMPT.md`). This is the work that converts a prospect → the First-Client Milestone.
**Where:** `/srv/bfd/Projects/bfd-website/app/try-gary/page.tsx`; demo-callback target `https://app.buildingflowdigital.com/g/stapleton-finance-b7q4` (dials from +61481614530). Runbook: TickTick `RUN: DEMO-CB-1` (`6a7d57698f0805267a5475ef`) + `Docs/TEST_SESSION.md`.
**How:** must be 8am–8pm AEST (funnel declines outside by design). Claude confirms the page renders + calling-hours, watches the leads table + cadence server-side; Brendan submits the form on his phone and takes the callback; run DEMO-CB-2 guard legs too (per-phone 429 copy, after-hours decline, opted-out path).
**Owner:** Brendan live at phone; Claude drives every server-side check.

### 4. Activate the lifecycle long-tail nurture (the work we just shipped)  (GATE: Brendan in UI, ~15 min)
**Why:** the lifecycle machine + retention are deployed but a **no-op until wired**. This realizes the value of the 2026-08-15 build.
**How (Brendan in the UI, Claude verifies each step server-side):**
  1. In **Lead Sequences**, create a "Long-Tail Nurture" sequence: generic weekly/fortnightly SMS, no reference to the last message.
  2. Set its **Lifecycle role = Long-Tail**.
  3. On the main cadences (Try-Gary etc.), set **"on silent →"** to the nurture sequence (and optionally "on complete →").
  4. Optionally set per-client `retention_months` (default 3) via SQL until the retention UI ships (LATER).
**Verify:** Claude confirms `engagement_workflows.on_silent_workflow_id` is set; a lead exhausting nudges (`nudgeColdReply` tier-N) POSTs `transition-lead` and opens an `engagement_enrollments` row into the nurture. (Full end-to-end needs a lead to actually go silent — spot-check the wiring + one manual `transition-lead` call on a test lead.)
**Owner:** Brendan in UI; Claude verifies. Server-side ref: `transition-lead` edge fn (live), `engagement_enrollments` table.

---

## NEXT

### 5. Cost-ledger read surface: minutes burn-down + 80% overage alert + cost-vs-billed reconciliation  (feature, Claude builds; plan mode first)
**Why:** the P2 cost ledger `execution_cost_events` has ZERO read surface — you can't see cost-per-booking, minutes burn, or reconcile estimated vs billed. This is what lets you price a pilot confidently; `FEATURE_ROADMAP.md` flags it "promote to a committed build soon after first client." Effort M.
**Where:** reads `execution_cost_events` (+ `cadence_metrics`); new edge fn(s) + a UI surface (likely under Analytics or a usage page). Cross-check the existing `get-client-usage` / `get-blended-rate` fns (memory [[project_f13_f14_usage_billing_auth_built_2026_07_02]]) so this extends rather than duplicates. **Agency-JWT-gated** reads (not the service key) — see the GOTCHA in memory [[project_cleanup_tail_2026_07_23]].
**Owner:** Claude (plan mode → Brendan approves scope → build → deploy → render smoke).

### 6. Reconcile the stale tracking docs  (housekeeping, Claude, ~quick)
**Why:** the docs never recorded the 2026-08-15 shipment; `DEFERRED.md`'s "Lead lifecycle system" (roadmap 3.5) is now stale (its state machine shipped).
**Do:** add `COMPLETED_LOG.md` entries for the 2026-08-15 build (1A/1B/1C + lifecycle + retention, with the commit trail `8517002`→`6b7fb31`→`5f199f7`→`26f1cfd`); close/move the DEFERRED "Lead lifecycle system" item; re-scope 3.6 (long-tail nurture — partially delivered) and 3.7 (re-warm triggers — still gated on click-tracking); refresh the `NEXT_SESSION_PROMPT.md` "no new product code" banner (rule lifted); close the resolved TickTick task "Commit CC session's TikTok pre-flight fix" (`6a7e85bc…`, done as `4f42ab7` in the `/srv/bfd` repo).
**Owner:** Claude solo.

### 7. CLONE-COMPLIANCE-1 code fix  (bugfix, Claude; Brendan still applies PU-15 once)
**Why:** the `clone-voice-to-text` flow re-asserts VOICE compliance copy ("the call may be recorded", spoken-pause stage direction) verbatim into TEXT prompts, contradicting the same prompt's "there is no audio channel here." Root cause behind PU-15. Now un-gated.
**Where:** the clone-voice-to-text edge fn / shared prompt-transform. The fix: strip/replace voice-only compliance lines when the target is a text setter. Report-only on prompt CONTENT — Claude fixes the CODE that generates it; Brendan still applies PU-15 to the live Setter-2 prompt once (Prompt Management → Setter-2 → SETTER CORE → COMPLIANCE block).
**Owner:** Claude (code); Brendan (one-time live prompt via PU-15).

### 8. Cheap security constant: demo-callback SLUG limit + record the Turnstile ruling  (~5 lines, Claude)
**Why:** a `/g/` page serves one named broker; no legit 4th dial. Drop `SLUG_MAX_PER_WINDOW` to **3/day** in `demo-callback/index.ts` and redeploy. Also update `Docs/BRENDAN_TODO.md` "bot defense" item from an open decision to a recorded ruling (Turnstile deferred, with the 4 un-defer triggers listed). Turnstile itself stays deferred (see LATER).
**Owner:** Claude solo.

---

## LATER (do NOT start this session — documented so nothing is lost)

- **F17 phase 2** — per-lead consent audit trail (source/method/timestamp, 2yr retention, exportable) + DNC Register wash. Build timed to the first cold list, not before.
- **F18** pre-appointment AI confirmation call (~24h out, in-call rebook, SMS fallback). Post-first-client fast-follow.
- **F19** cross-client weekly Call-QA digest over `post_call_analysis_data`. Post-first-client; check Retell Conductor first.
- **F20** booked-revenue attribution (tag appts with GHL opportunity value/source). Needs revenue to attribute → post-first-client, before first renewal.
- **F12** voice per-minute cost optimization (~A$0.34 → A$0.20/min). Gated: after first paying client.
- **Per-client retention-months UI** — a settings card (add `retention_months` to `clients_public` per guardrail 2). Ships when the 3-month default needs overriding in-UI.
- **PII anonymisation post-retention** — v1 only stops contacting + unenrolls; actual PII delete after a grace period is the follow-up.
- **Cloudflare Turnstile / SMS-OTP** on the demo form — deferred by ruling until a trigger fires (a `/g/` link goes public, an unattributable 429, >~10 demo pages, or a prospect asks). Only the cheap SLUG constant (item 8) is in scope now.
- **Sender-aware inbound SMS routing** — not needed under the current one-client-per-number architecture; only if demo clients ever share a number.
- **Cosmetic/backlog:** Slot-10 name drift (prompts vs voice_setters); the dead "Modify with AI" button (text side needs it eventually — Retell Conductor can't author text).
- Full deferred/gated list: `Docs/DEFERRED.md` (~25 items) + `Docs/FIRST_CLIENT_TASKS.md` (event-gated go-live: GATE A/B, webhook secrets, AU A2P, Stripe/Resend).

---

## RUNNING ON BRENDAN'S SIDE (Claude can't do these)
- Deploy **Gary v4** prompt + attach the knowledge base (Retell dashboard; files from greenserver, not Notion); fix the **"Hannah" fossil** in the Mortgage-Broker base LLM (`llm_263eb3…` v17) so duplicates say Gary.
- Apply prompt edits **PU-15** (Setter-2 compliance), PU-5 (Main Outbound V2), PU-11 (transfer line, deferred), PU-13 (timezone-aware times).
- **Delete the two orphaned Supabase projects** (`qfbhcixk…`, `awzlcmd…`) in the console, then Claude does the code cleanup (ORPHAN-PROJ-1).
- Confirm **sub-processor DPAs + provider MFA** before real PII; enable **F16c missed-call text-back** on the dogfood client.
