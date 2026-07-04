---
description: Session 2026-07-04 wrap — API-DEPR-2 shipped (retell-proxy v49), then a full roadmap-to-100% pass: market research filed as F15-F20, a consolidated self-chaining TEST_SESSION runbook, 3 manual items closed by Claude, and a gated First-Client Milestone doc.
---

# Handoff 2026-07-04 — API-DEPR-2 + roadmap-to-100% + the test relay

One long session. Two phases: (1) the API-DEPR-2 build; (2) planning the whole remaining path to v1 "100%" and
wiring it as a self-chaining relay so Brendan can drive it from one trigger phrase.

## Phase 1 — API-DEPR-2 (DEPLOYED LIVE)

Migrated Retell's 3 deprecated analysis-prompt agent fields into `post_call_analysis_data` `type:"system-presets"`.
Full detail: `Operations/handoffs/2026-07-04-api-depr-2-analysis-fields.md`. Net: retell-proxy **v48 → v49** live,
downstream webhooks untouched (the Session-9 "coordination" worry was refuted — system-preset outputs stay top-level),
test:edge 208/0, read-only smoke passed (0 agents mutated). API-DEPR-1 is now fully code-complete. Owed = the
Brendan-driven answered-call Voice gate + post-save get-agent shape check (in TEST_LIST). Commit `9739252`.

## Phase 2 — roadmap to 100% + the relay

**Market research (deep web pass, 18 sources).** Filed into `FEATURE_ROADMAP.md` as candidate features **F15-F20** +
a research spec + an explicit do-not-build list. Headline: #1 churn driver for AI-setter retainers = "no visible ROI";
clients judge HELD meetings (show rate); speed-to-lead + missed-call text-back are the demo wins; compliance is a moat.
Top picks: **F15** client ROI pack (show-rate funnel + weekly report), **F16** never-miss-a-lead pack (speed-to-lead +
missed-call text-back + live-transfer config), **F17** AU compliance pack. Also filed: PROMPT_UPDATE_LIST **PU-6**
(recording-disclosure line) + **PU-7** (caller-ID check), and 2 BRENDAN_TODO compliance items. Commit `65ebcc6`.

**Stale-list corrections.** BRENDAN_TODO: G3-7 merge, Property Coach name revert, 5-setter re-save all flipped `[x]`
(verified done). BUG_LIST G3-8 flipped `[x]` (part (a) was already fixed via `execute-lead-webhook`; stale prose).
Commit `999f21b`.

**Manual items Claude could do (Brendan gave permission).** DONE + verified this session:
- **DEPLOY-1** — Brendan pinned Railway prod to `main` (screenshot-confirmed) → BUG_LIST + BRENDAN_TODO `[x]`.
- **inotify sysctl** — Claude wrote `/etc/sysctl.d/60-inotify.conf` (`fs.inotify.max_user_watches=524288`) + applied
  it live via passwordless sudo → `[x]`.
- **Twilio ACMA sender-ID check** — read-only against the live account: 0 alphanumeric sender IDs, plain long code
  `+61481614530` only → CLEAN, `[x]`.
- **PU-7 read-only** — Property Coach opener compliant; Crazy Gary opener lacks company+purpose (flagged for Brendan
  if used for real outbound). Commit `bc60886`.

**The self-chaining relay (the point of the session).**
- `Docs/TEST_SESSION.md` is the consolidated test runbook (RUN 0 self-verify → RUN 1-7 the live matrix batched by
  physical action → RUN 8 gated/blocked → **RUN 9 Brendan manual checklist (M1-M7, step-by-step + doc links)** →
  **RUN 10 the next-session prompts** T-fix → Session S → F15 → F16, each with a ▶ PIPELINE footer → close-out).
- `Docs/FIRST_CLIENT_MILESTONE.md` holds the event-gated last-step prompt (Stripe/gate/secrets/A2P/onboarding).
- Triggers wired into CLAUDE.md + AGENTS.md: **"run test session"** → TEST_SESSION.md; **"I'm onboarding a client"**
  → FIRST_CLIENT_MILESTONE.md. Commits `0443026` (+ `bc60886`).

## State of the world (verified)

- `main` clean, all pushed to origin + github. Live: retell-proxy **v49**, Trigger **20260703.2**, save-external-prompt
  v15, verify-credentials v3, get-external-prompt v1, get-client-usage v1, get-blended-rate v2. Frontend on vite 8.
- **All planned CODE sessions (0-10 + API-DEPR-1/2) are DONE.** Nothing is solo-buildable right now (the only unbuilt
  bugs — BOOK-2/BOOK-3/SMS-METER-1 — are frozen `voice-booking-tools`, supervised-daytime only = Session S).

## Next (the relay)

Brendan runs **"run test session"** in a fresh session. That surfaces the manual checklist (RUN 9) + the next-session
prompts (RUN 10). Path: test pass → [T-fix if fails] → Session S → F15 → F16 → (gated) "I'm onboarding a client" →
v1 LIVE + 100%. Post-client queue: F18 → F19 → F20 → F12. Near-term manual blockers worth doing: **M1 Resend SMTP**
(unblocks F14 tests + the F15 report email) and **M2 Setter-1 prompt migration** (unblocks 2 PROMPT-AUTH-1 checks).
