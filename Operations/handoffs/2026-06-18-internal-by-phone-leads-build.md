---
description: 2026-06-18 session — verified the first-ever live voice booking (v17 timezone fix), then designed + built + PR'd Spec 1 of the internal/by-phone lead-resolution pivot (PR #5, NOT merged/deployed). Deploy + A1-B2 live-verify deferred to a focused next session with a ready copy-paste kickoff prompt.
---

# Internal by-phone lead resolution — build + PR (2026-06-18)

## Arc of the session
1. **Live verification** (read-only): re-confirmed P3a routing, edge-fn versions (retell-proxy v41 / make-retell-outbound-call v23 / voice-booking-tools v17 / push-contact-to-ghl v9), and the golden-ref + V2 agent baselines. Ran a read-only interference-analysis workflow over the planned A1-C1 steps.
2. **Headline result VERIFIED:** Brendan let the stale enrolment 80563572 ring through -> it ran as an organic A2 (outbound on cadence 40e8bea3 dialed Main Outbound agent_f45f4dd) AND C1 (booking). The booking SUCCEEDED: `call_217d2cad…`, booked 10am Mon 2026-06-22, correct timezone offset. This is the **first-ever successful voice booking** (voice-booking-tools v17 timezone-offset fix proven live; the agent re-offered real Monday slots instead of invent-looping on an unavailable Friday).
3. **Two findings from that booking** (root-caused via a read-only lead-identity-map workflow): bookings land `source='ghl_calendar'` (the GHL appointment webhook overwrites voice-booking-tools' `voice_call`); and the booking attached to a THIRD duplicate GHL contact for +61405482446 (live: **10 lead rows / 10 GHL contacts for one phone**). Root cause = leads keyed by GHL contact id, no phone uniqueness.
4. **Pivoted to building the fix** (Brendan: "start build"). Brainstorm -> approved spec -> plan -> 14-task subagent-driven TDD build -> whole-branch Opus review -> PR.

## What shipped to PR (NOT merged/deployed)
**Spec 1: go-forward internal-by-phone lead resolution.** Branch `feat/internal-by-phone-leads` (HEAD `d84fb7a`, 19 impl commits / 29 files / +926-111), pushed to Forgejo origin + GitHub. **PR #5: https://github.com/TheBrendonly/1prompt-os/pull/5** (reviewed, approved by Brendan).
- Shared `normalizePhone` (E.164/AU) + `resolveLeadByPhone` (deterministic survivor) + `isPhoneOptedOut`; additive `leads.normalized_phone` migration (no unique constraint).
- Internal-by-phone resolution in voice-booking-tools (kills `contacts[0]`), receive-twilio-sms, retell-inbound-webhook, intake-lead (no new dup minting).
- `lead_optouts` enforced by-phone on ALL send paths; UI STOP fans out by phone + repaired ContactDetail STOP; re-arm hole closed.
- BUG B: sync-ghl-contact BFD-wins on identity fields (push kept). bookings-webhook never downgrades `voice_call`.
- Verified: 20 Deno + 4 Node tests green; frontend tsc clean; whole-branch Opus review found no Critical (all 5 cross-task invariants passed); 2 pre-merge fixes applied.

Build trace: `.git/worktrees/internal-by-phone-leads/sdd/progress.md` (+ per-task reports). Spec/plan in `docs/superpowers/`. Durable state: memory `project_internal_by_phone_leads_spec1_2026_06_18`.

## State at close
- Nothing live changed this session (read-only verification + branch-only build). PR #5 reviewed + ready.
- Implementation worktree kept alive at `.claude/worktrees/internal-by-phone-leads`.
- Main checkout still holds the uncommitted cadence-v2 WIP (runEngagement/nudgeColdReply + lifecycle/transition-lead/migration) + unpushed docs commit `eccb29d` — must be reconciled BEFORE merging main.

## Next session = DEPLOY + live-verify (one hit)
A complete copy-paste kickoff prompt was produced (in the prior chat). It covers: preserve the cadence-v2 WIP to its own branch -> merge PR #5 to main (both remotes) -> apply migration 20260618120000 FIRST + verify backfill (10/2/9) -> deploy the 8 edge fns + Trigger workers -> confirm Railway frontend -> smoke S1-S4 -> the deferred A1-A5/B1-B2 live verification. Supabase + Trigger CLIs available next session (project keys). Deferred Spec 2 (merge the 10 dupes + unique constraint + child repoint) is a separate dry-run-first build.
