---
description: Consolidated Brendan action pack (2026-07-07) - every prompt-content item verified live against the actual Retell agents, plus every open manual gate ordered by leverage.
---

# Brendan action pack — 2026-07-07 (Session P1)

One document, two parts. Part A is prompt-content wording — you apply these yourself via Prompt Management
(Claude never edits live prompts). Part B is everything else you need to click/configure, ordered so the
highest-leverage items are first. Every item below was checked against the *actual live* state today, not
just doc text — several things the docs still called "open" turned out to already be fixed.

## Important note on agent identity (read this first)

**"Main Outbound" and "Inbound BFD Agent" are currently the SAME physical Retell agent** (`agent_b2f6495…`).
There's a separate agent literally named `Voice-Setter-Test` (`agent_f45f4dd…`) that sits statically bound as
the phone number's default outbound agent in Retell's own config — but it's **not actually used** by any real
call (confirmed by reading `make-retell-outbound-call`'s code: it always overrides the agent per-call using
the specific setter's `retell_agent_id`, which for "Main Outbound" resolves to the shared `agent_b2f6495`, not
`Voice-Setter-Test`). This is worth knowing because it's exactly the trap this project's own `CLAUDE.md`
already flags ("ignore the phone number attached to an agent in Retell — it doesn't indicate which agent is
live") — a first pass during this session got caught by it before a code-level check corrected it. Practical
upshot: whatever you check or change on "Inbound BFD Agent" in Prompt Management applies to outbound calls
too, since it's the same underlying agent and prompt.

## Part A — prompt-content items (verified live, paste-ready)

### Do these (still genuinely open)

**PU-3 — personalize the outbound opener with `{{first_name}}`.** Still open. The real Main Outbound (shared
with Inbound) opens with *"Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital. Just so
you know, this call is being recorded for quality. What can I help you with?"* — no name. Since inbound and
outbound share this one prompt, you can't just add `{{first_name}}` to it directly (inbound calls usually
have it blank, so it'd read "Hey , this is Gary..."). Worth deciding: split outbound onto its own dedicated
Retell agent so it can safely personalize, or add a conditional instruction ("use the caller's first name if
you have one") rather than hardcoding the token into the opener.

**PU-6 — recording-disclosure line.** 2 of the 5 distinct canonical agents already have it (Gary - Mortgage
Broker, and the shared Main-Outbound/Inbound agent — which has the strongest version, a full disclosure +
objection-handling section, so outbound calls already carry it too). **Still missing on 3:** Gary - Crazy
Gary, Gary - Finance Strategist, Gary - Property Coach. Add near the top of each one's opening, e.g.:
> "Just letting you know this call is recorded for quality."

Prompt Management → [that setter] → SETTER CORE. Note: the engine already injects a `{{recording_disclosure}}`
variable per the F17 toggle, but **no agent's stored prompt references it yet** — the toggle is a no-op until
this wording lands somewhere.

**PU-7 — Main Outbound's own compliance is borderline (your read needed).** All other agents confirmed
compliant (name+company+purpose in the opener). Main Outbound (shared with Inbound) states persona + company
+ the recording disclosure, but ends with "What can I help you with?" — a question, not a stated purpose for
the call. Worth a look if it's genuinely used for outbound telemarketing (pairs with the PU-3 discussion
above). Crazy Gary remains the other standing item — only fix if it's ever used for real outbound.

**PU-11 — live-transfer prompt line. Bigger gap than previously scoped: the tool itself doesn't exist yet on
any agent, not just the prompt line.** Checked all 6 agents' tool lists — none has a `transfer_call` tool
configured at all. Two steps, per setter that should transfer:
1. Prompt Management → [that setter] → Voice/Retell settings → Tools → **add** the `transfer_call` tool with
   a real destination phone number.
2. Then add a line near the persona/rules, e.g.:
> "If the caller clearly asks to speak to a human, or you can't help, offer to connect them and use the
> transfer_call tool."

**PU-12 — inbound placeholder guard (part 2 of 2 — part 1 is already done).** The Inbound BFD Agent's opener
is already name-free ("Hey, this is Gary, I'm Brendan's AI assistant at Building Flow Digital…" — no
`{{first_name}}`). What's still missing: add to SETTER CORE on the Inbound BFD Agent:
> "If a lead detail (name, business) is empty, unknown, or looks like a placeholder or a system value (for
> example 'SMS Lead'), never say it aloud: speak without a name and ask naturally who's calling."

**PU-10 — text-setter reschedule/cancel honesty (pairs with the already-shipped code guard RESCHED-SMS-1).**
This is on the external per-client `text_prompts` system (Setter-1), a different system Claude can't
read-verify the same way. In the text setter's reschedule/cancel guidance, be explicit: call
`get-contact-appointments` (not `get-available-slots`) before any change, and only say "moved / cancelled /
done" after the tool actually returns success.

**PU-5 — stand up "Main Outbound V2".** Confirmed not yet stood up (no agent named anything like "Main
Outbound V2" exists — there are two unrelated older agents, "BFD Outbound V2 (22.02.25)" and "BFD Cold Call V2
(12.03.25)", don't confuse them). The full draft is ready at
`Docs/archive/MAIN_OUTBOUND_V2_PROMPT_2026-06-16.md` whenever you want to duplicate + stand it up.

**PU-9 — dead-air fix.** Last checked in a prior session against the booking tools' `execution_message_description`
+ `speak_after_execution` settings; those specific values want a quick re-confirm against the correct shared
Main-Outbound/Inbound agent next time you're in Prompt Management (the agent-identity mixup above means this
session's re-check may have looked at the wrong one). Full detail already in
`PROMPT_UPDATE_LIST.md`.

**T10b — inbound "ask for details" (verify-only, no live call regression seen).** Re-checked the stored
prompt: no anti-pattern present. This one genuinely needs a live inbound call to fully confirm runtime
behavior, not just the stored text — no action unless a real call shows the problem.

### Already resolved — no action needed (found already-fixed during this pass)

**PU-1** (timezone naming — "Sydney time" is hardcoded in every prompt already) and **PU-4** (Property Coach
company name — already reads "Building Flow Property", no placeholder). Both moved to `COMPLETED_LOG.md`.

## Part B — every open manual gate, ordered by leverage

### Tier 1 — highest leverage (each unblocks several other things)

1. **Resend SMTP.** Create a free Resend account → add + verify `buildingflowdigital.com` (Resend shows the
   DKIM/SPF DNS records to add) → create an API key → hand it to Claude (the SMTP config PATCH payload is
   ready in `Operations/handoffs/2026-07-02-usage-billing-auth.md`). Unlocks: reliable invite/reset emails
   (F14 E2E test), and the F15 weekly report email flips from stubbed to live automatically (no code change
   needed once the key + a recipient are set).
2. **Apply the Setter-1 prompt content migration** (PROMPT-AUTH-1, report-only). Steps are fully written out
   in `Docs/investigations/prompt-migration-reports/e467dabc-57ee-416c-8831-83ecd9c7c925_Setter-1.report.md`:
   Prompt Management → Setter-1 → SETTER CORE → enable "Booking Function" → "View Prompt" → clear the legacy
   511-line booking blob (or click "Return to Default") → Save/Deploy → re-open "Verify Setter Prompt" → "Load
   live stored prompt" to confirm it's lean. Unblocks the last 2 `TEST_LIST.md` PROMPT-AUTH-1 checks
   (no-leftover-artifacts, efficiency — full-prompt-visibility already passed).

### Tier 2 — F15/F16 dogfood enablement + the one GHL workflow

3. **Enable the new features on the BFD dogfood client to demo them** (all default OFF). Client Settings →
   "Calls & compliance" card: turn on Speed-to-lead auto-dial (F16b), Missed-call text-back (F16c), and (for
   compliance testing) Call-recording disclosure (F17). "Client ROI reporting" card: turn on the show-rate
   funnel / weekly report visibility if you want the client to see them. Then the TEST_LIST "Combined build"
   behavioral checks become runnable.
4. **Provision the GHL appointment-status workflow → `bookings-webhook`.** In GHL: add a Workflow on
   "Appointment Status Changed" (confirmed/showed/no-show/cancelled) with a Custom Webhook POST to the
   `bookings-webhook` URL; set the client's `ghl_webhook_secret` + send it as the `x-wh-token` header (GHL's
   native Webhook V2 is RSA and NOT supported — use the static token). Unblocks the F15 show-rate funnel
   actually accruing confirmed/showed/no-show data.
5. **Fresh re-Save of all 5 canonical voice setters — confirmed still needed, directly verified.** Checked
   `post_call_analysis_data` live on the shared Main-Outbound/Inbound agent just now: it still only has the 6
   original custom fields, none of the 3 API-DEPR-2 system-presets (`call_summary`/`call_successful`/
   `user_sentiment`). The VM-1 (voicemail draft-first) and API-DEPR-2 fixes are proven to work on a throwaway
   agent, but every live canonical agent needs its own fresh re-Save/Push through the BFD setter UI to
   actually pick them up (re-Save/Push only — never edit the prompt content while you're in there).
6. **Apply the prompt-content items above** (PU-6, PU-10, PU-11, PU-12).

### Tier 3 — first-client onboarding prerequisites (do before the next signature, not urgently now)

7. **External Supabase project** (SOP §2.1) — the #1 un-automated blocker for onboarding. Fully manual: create
   a `<slug>-setter-live` project on supabase.com, grab the URL + `sb_secret_*` key, run the 5-table seed SQL,
   paste into the client's Credentials page. Hard dependency for both text and voice setter authoring.
8. **GHL location + Private Integration Token** (Contacts, Conversations, Calendars, Workflows, Custom
   Fields) → `ghl_location_id`, `ghl_calendar_id`, `ghl_assignee_id`, the custom fields, the webhook actions.
   Everything lead-side is GHL-gated (`intake-lead` 409s without it).
9. **Twilio BYO** (client-owned): SID + auth token + E.164 number. Not UI-editable — set via
   `onboard-client.mjs` or SQL. Number must be UNIQUE and imported into Retell before inbound bind.
10. **Flip `subscription_status` → `active`** on the new client (UI create currently sets `free`).
11. **Decide the one true production text `llm_model`.** DB default is `google/gemini-2.5-pro`;
    `onboard-client.mjs` defaults to `openai/gpt-4.1-nano`; voice setters seed `gemini-3.0-flash`. Pick one so
    a UI-created client doesn't silently inherit an unintended model.
12. **GHL reminder-workflow snapshot** (best built once, ahead of time, reused per client): instant
    booking-confirm SMS → 24h reminder with a confirm trigger-link → 2h short reminder → reschedule link in
    every touch → post-appointment branch on status. Config, not code — GHL's own triggers do this natively.

### Tier 4 — lower leverage (do when you have time; nothing is blocked on these)

13. **Confirm the `sms_llm` seed rate** (currently US$0.003/msg) against real OpenRouter usage.
14. **Set per-client billing anchor day + client visibility toggles** for the eventual first client
    (Sub-Account Config → Cost-to-Price Calculator).
15. **5.1 Setup-guide screenshot re-shoot** — lock the canonical BFD Retell folder name first.
16. **Shut down the n8n Railway service** — the native text engine is fully canonical; nothing depends on it
    anymore.

### Already done (for completeness — no action needed)

- ~~Run `git push github main`~~ — confirmed done this session; `github/main` and `origin/main` are in full
  sync.
- ~~Deploy the overnight-bugfix branch~~, ~~Apply the RLS-SHAPE-1 migration~~, ~~Pin Railway to `main`
  (DEPLOY-1)~~, ~~Merge the G3-7 vite-8 branch~~, ~~Raise the inotify watch limit~~ — all previously confirmed
  done, now archived.
- ~~Verify no alphanumeric SMS sender ID configured in Twilio~~ — confirmed clean 2026-07-04.
- ~~Review the F13/F14 branch + GO for supervised deploy~~, ~~Provision the F1 GHL Conversation Link
  field~~ — all previously done.

## First-Client Milestone prerequisites (not run this session — event-gated)

Per scope, `Docs/FIRST_CLIENT_MILESTONE.md` was not touched. Confirmed still open: **M1 Resend SMTP** + **M2
Setter-1 migration** (Tier 1 above), F16/F17 phase-1 built (done — just needs dogfood-enabling to demo), the
GHL reminder-workflow snapshot (Tier 3 #12), and the whole onboarding-prerequisites cluster (Tier 3 #7-11).
None of the Stripe / webhook-secret / AU-A2P gates should be touched until a client actually signs.
