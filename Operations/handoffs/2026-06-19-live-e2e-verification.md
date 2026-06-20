---
description: Live E2E verification session 2026-06-19 — Spec 1 by-phone deploy verified, go-live prep (GHL allow-dup off + outcome fields wired), full clean-slate E2E (answered/missed/inbound/Try-Gary) all PASS; 4 items logged (1 major feature + 3 bugs). Brendan drove all UI/calls, Claude verified read-only.
---

# BFD-Setter Live E2E Verification — Session Record (2026-06-19)

Brendan drove every UI click + live call/SMS; Claude verified read-only via the Supabase Management API SQL runner (project `bjgrgbgykvjrsuwwruoh`), Retell MCP (`get_call`/`get_agent`/`get_retell_llm`/`list_calls`), and read-only GHL v2 API.

## Headline
- **Spec 1 (internal by-phone, `3059023`) verified live** + the go-live prep done.
- **Full clean-slate E2E PASSED**: answered-call booking (+reschedule+send-sms), fast inbound SMS, inbound call+callback, missed-call→SMS fallback, Try-Gary persona routing — every fresh lead resolved to **one** lead + **one** GHL contact (the dupe-split is gone).
- **The 17-min SMS-reply latency is fixed** (HOLD-loop fix `v20260618.2`/`v26` + cleared stranded rows): inbound replies now land in ~2 min, confirmed live.
- **GHL outcome fields now populate** (created + wired this session): sentiment + appointment-booked write to the contact.
- **4 items logged** to `FEATURE_ROADMAP.md` + `User Todos.md` (+ memory).

## Scorecard (all read-only verified)
| Item | Result |
|---|---|
| S1 inbound SMS + voice resolve by-phone | PASS (greeted by name, no new lead/contact) |
| S2 by-phone STOP/START | PASS (STOP=10 stopped +1 optout; START=0 + optout deleted) |
| S3 voice booking source durable + outcome fields | PASS (`source='voice_call'` held; sentiment/appt fields populate) |
| S4 BUG B (lead edit not overwritten by GHL re-sync) | PASS (BFD "GreenEDIT" held vs GHL "GreenGHL") |
| A1 repoint draft cadence `c206da3e` | PASS (all 3 voice nodes → `b09624b5`; reverted to draft) |
| A2 outbound routing on `40e8bea3` | PASS (Main Outbound `agent_f45f4dd`) |
| A3 Try-Gary persona routing | PASS (Crazy Gary `agent_f126497` + cadence `5a161da0`) |
| A4 Save a Gary setter (no shared-slot warning) | PASS (slots unchanged, no fork) |
| A5 inbound greet-by-name (secret NULL) | PASS (via S1 inbound call) |
| B1 Create-New-Setter born bookable | PASS (8 tools + gemini-3.0-flash, durable across save) |
| B2 V2 toggle booking | DROPPED (V2 setter `agent_088a9ed` deleted as test) |
| E2E Run 1 (answered call) | PASS (book + reschedule×2 + send-sms + inbound SMS fast + inbound call + callback, ONE contact) |
| E2E Run 2 (missed call → fallback SMS) | PASS (fallback fired; ~10-min late, see 6.11) |
| Clean slate (DB + GHL → 0) | DONE (backup `/tmp/bfd-clean-slate-backup.json`) |

## Go-live actions completed
- **GHL allow-duplicate-contact = OFF** (Brendan).
- **2 GHL outcome TEXT fields created + wired** to the BFD client: `ghl_call_sentiment_field_id=jWPaRl6ysDgR7KWzW89d`, `ghl_call_appt_booked_field_id=IJVbAhkWv94dRW6Ddnze`. Verified populating live (Run 1: "Positive" + "true").
- `ghl_conversation_provider_id` still NULL — needs a GHL marketplace-app conversation provider for the Conversations "Call" chip (call events land as notes meanwhile). Backlog.

## Clean slate
- Backup written: `/tmp/bfd-clean-slate-backup.json` (original 21 leads + activity + 12 GHL contacts).
- DB wiped BFD-scoped (client `e467dabc` + GHL account `xo0Xjmen`), FK-safe; GHL 12 contacts deleted; re-wiped between E2E runs (Run1→Run2→A3). `error_logs`, the orphaned `voice_setters` row, and the Probe/other clients were preserved.

## Items logged this session (in FEATURE_ROADMAP.md + User Todos.md + memory)
- **3.12 SMS/text setter tool parity** (MAJOR feature, Brendan-requested asap): bring booking/reschedule/cancel/check-slots/schedule-callback to SMS by invoking the existing `voice-booking-tools` edge fn. Effort L.
- **6.9** SMS/text engine is reply-only (no action tools) — the gap behind 3.12.
- **6.10** 🟡 LATENT: `sync-ghl-contact` creates leads with `normalized_phone=NULL` (by-phone can't find them internally). Currently MASKED by the GHL fallback + allow-dup-off (first inbound self-heals it, no dupe observed). Fix = add `normalized_phone` to the insert; blocks §6.5 internal-only. Effort S.
- **6.11** Missed/voicemail call doesn't stamp `last_call_outcome` → cadence waits the full 600s poll ceiling → fallback SMS ~10 min late. Voicemail/no-answer only (answered calls advance promptly). Effort M, speed-to-lead impact.

## Still Brendan's / next build sessions
- Fix **6.10** (1-liner) + **6.11** (outcome stamping) — robustness + speed-to-lead.
- Build **3.12** (SMS tool parity) — MAJOR.
- Provision the GHL conversation provider (Call chip).
- Prior open bugs **6.1–6.8** (sidebar, logins, raw-fetch refactor, internal STOP/by-phone §6.5, Retell inbound sig, probe canary, greeting `{{first_name}}`).
- Deferred fix sessions: the new-setter seed prompt (Joe's-Diner default) reconfig; the delete-setter orphaned `voice_setters` row.

## State at session end
- **No code deploys this session** (read-only verification). Spec 1 + the HOLD-loop fix were already live from prior sessions. The only writes Claude made: wired the 2 GHL outcome field ids onto the client row (authorized), and the clean-slate wipes (authorized).
- BFD currently holds **1 test lead** (`cMzOSNIH…`, the A3 Crazy Gary lead) + its GHL contact + the A3 call. NOT wiped after A3 — wipe it if you want a truly empty go-live start (`/tmp/bfd-wipe.mjs` + `/tmp/bfd-ghl-wipe.mjs`).
- Helper scripts (read-only SQL / GHL / wipe / backup) live in `/tmp/bfd-*.mjs`.
