---
description: Onboarding-fix pass close-out (2026-07-06) - all five gate bugs fixed one commit each; webhook-manifest v3 live-verified; frontend fixes await Brendan's github push; next prompt = autonomous test pass.
---

# Onboarding-fix pass — close-out (2026-07-06)

Scope: the five bugs from `Docs/ONBOARDING_GAP_REPORT_2026-07-06.md` (ONBOARD-1/2/3, GOLIVE-1, ACCESS-1).
One commit each on `main`, no frozen surface touched (retell-proxy + voice-booking-tools untouched).

## What shipped (commits `9f5b959`..`bb6322a`)

| Commit | Item | Change |
|---|---|---|
| `9f5b959` | ONBOARD-1 | `use_native_text_engine: true` in CreateClient.tsx + Onboarding.tsx inserts + both Workflows.tsx go-live-flip writes (heals pre-fix clients) |
| `53a03e9` | GOLIVE-1 | webhook-manifest goLiveReady now requires GHL location + retell_phone_1 + >=1 pushed voice setter + external Supabase + lastReceivedAt on both required hooks; per-check `goLiveChecklist` in the response; bookings-webhook got a real `bookings` lastReceived signal; card shows "Still missing: ..." |
| `bac05fa` | ONBOARD-2 | Up-front external-Supabase guard (clients_public `supabase_url` + `has_supabase_service_key`) in handleCreateNewSetter (both channels) + handleSavePrompt (non-voice), clear toast; create does the external write BEFORE the platform `prompts` insert (no orphan) |
| `ad01705` | ACCESS-1 | `prompts/text` + `prompts/voice` wrapped in AgencyRoute; Text/Voice Setter sidebar items hidden from client logins (menu-config path + default menu) |
| `0ad4992` | ONBOARD-3 | 12-char password sweep: CreateClient + sidebar-dialog placeholders, Settings/ClientSettings checks + button gate; NEW real hole closed: the sidebar Add Sub-Account dialog create-login had NO length validation and admin createUser BYPASSES the GoTrue policy |
| `bb6322a` | ONBOARD-1 follow-up | The sidebar Add Sub-Account dialog is a THIRD client-create path; its insert now sets the flag too |

Verification: tsc + vite build green per commit; full suite green (test:node 127/127, test:frontend 8/8,
test:edge 217/217).

## Deploy state

- **webhook-manifest v2 -> v3 ACTIVE** (deploy_single_fn.mjs) and **live-verified**:
  - Synthetic Probe (blank client) -> `goLiveReady:false`, checklist all false except secrets. The GOLIVE-1
    false-positive is dead.
  - BFD dogfood -> all provisioning checks true; `requiredWebhooksReceived:false` is HONEST
    (`sync_ghl_executions` was only created 2026-07-05 and has 0 rows; flips true on the next GHL contact
    sync). Not a bug.
- **Frontend NOT live yet.** Pushed to Forgejo `origin/main`, but Railway builds from the GitHub remote and
  the auto-mode classifier blocked `git push github main`. **Brendan: run `git push github main`** (also in
  BRENDAN_TODO). Until then prod lacks the four frontend fixes.
- Note: a message-only amend was used on the unpushed ACCESS-1 commit to remove an em dash from its subject
  (tree untouched, commit was local-only; repo convention bans em dashes).

## Concurrent-session note

While this pass ran, another session committed `3d1fa36` (Session S shared-fn deploy close-out:
voice-booking-tools v23 + Trigger 20260705.1 LIVE, supervised) and pushed it along with `9f5b959`.
Session S is therefore DONE; its owed MUTATING live regression is the next autonomous test pass
(`Operations/handoffs/2026-07-05-post-deploy-test-prompts.md` Prompt A).

## List updates

- `Docs/BUG_LIST.md`: onboarding cluster collapsed to a fixed-note; GOLIVE-1 -> `COMPLETED_LOG.md`.
- `Docs/TEST_LIST.md`: new "Onboarding-fix pass 2026-07-06" section (5 live rows, gated on the github push).
- `Docs/BRENDAN_TODO.md`: `git push github main` item added; the flip-flag item trimmed to
  `subscription_status` only.
- `Docs/SESSION_PLAN.md`: sequence entry 3b added (this pass, DONE).

## NEXT SESSION PROMPT (emit target: autonomous test pass)

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: execute (read-only + pre-authorized test writes only;
NEVER edit prompt CONTENT; NEVER edit/deploy voice-booking-tools or retell-proxy - frozen live baseline,
this session only TESTS them).

BFD-setter - AUTONOMOUS TEST PASS (post shared-fn deploy + onboarding-fix).

Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first). Supabase ref bjgrgbgykvjrsuwwruoh.
Creds ./.env. Live DB via Mgmt API /database/query (NOT postgres MCP). No em dashes. Verify read-only
before claiming a pass. TEST_PHONE_A (+61405482446) only; TEST_PHONE_B is off-limits.

RUN the full Prompt A from Operations/handoffs/2026-07-05-post-deploy-test-prompts.md (the owed MUTATING
live regression for CANCEL-1 + BOOK-2/3 + SMS-METER-1 on voice-booking-tools v23 + Trigger 20260705.1,
plus its RUN 0 self-verify and residual-human-list ending).

ADDITIONALLY, if `git log github/main..origin/main` shows the onboarding-fix commits have been pushed to
GitHub (Railway deployed): also run the TEST_LIST "Onboarding-fix pass 2026-07-06" rows (ONBOARD-1 both
create paths + SQL check, ONBOARD-2 guard + no-orphan, ACCESS-1 client-role redirect + sidebar trim - needs
a throwaway client login, delete after - GOLIVE-1 card "Still missing" line, ONBOARD-3 copy). If the push
has NOT happened, skip them and say so in the close-out.

Close out per the Relay Protocol in Docs/SESSION_PLAN.md; emit the next prompt (Prompt B human voice
session if residuals remain, else F15 from Docs/TEST_SESSION.md RUN 10).

▶ PIPELINE (live status in Docs/SESSION_PLAN.md):
[✓] Test session  [✓] Onboarding gate  [✓] Onboarding-fix  [✓] Session S (deployed, supervised)
[•] Autonomous test pass (here)  [ ] F15  [ ] F16  [ ] First-Client Milestone (gated)
```
