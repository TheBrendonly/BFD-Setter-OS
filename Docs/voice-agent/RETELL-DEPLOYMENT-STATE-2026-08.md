---
description: Engineering reference for the Retell voice agents — live agent/LLM ids, injected dynamic variables, known defects. Split out of the Gary knowledge base 2026-08-11, because none of this belongs in a document the agent reads on a call.
status: verified 2026-08-10 against the Retell API and the live edge functions
last_confirmed: 2026-08-10
owner: Brendan Green
product: bfd-setter (v1) — NOT bfd-setter-v2
companions:
  - Company/knowledge/gary-agent-knowledge-base-2026-08.md (what the agent knows)
  - Company/knowledge/voice-agents/gary-main-outbound-prompt-v4-2026-08-10.md (how the agent behaves)
---

# Retell voice agents — deployment state

Engineering reference. **Nothing here should ever be loaded into a retrieval knowledge base the agent reads on a call** — it's internal state, not call content.

---

## Which product is this? `bfd-setter` (v1). Not v2.

`bfd-setter` and `bfd-setter-v2` are different products. Everything live is v1.

| | `Projects/bfd-setter` (**v1 — LIVE**) | `Projects/bfd-setter-v2` (rebuild) |
|---|---|---|
| Status | Shipped, serving the live agents | Target architecture. PRD + scaffolding. |
| Shape | React frontend + Supabase edge functions + Trigger.dev | pnpm/turbo monorepo, `apps/` + `packages/`, Dockerfiles for api/web/worker |
| Edge functions | `frontend/supabase/functions/` — all 20+ | **none** — no `supabase/functions` directory exists |
| Supabase project | `bjgrgbgykvjrsuwwruoh` (`BFD_PLATFORM_URL`) | n/a |
| Retell wiring | `make-retell-outbound-call` places every live call | not wired |

**Proof:** every live Retell agent's `webhook_url` is `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/retell-call-analysis-webhook`, and that function only exists under `bfd-setter/frontend/supabase/functions/`.

**Trap:** `bfd-setter-v2/.env` is a byte-for-byte copy of `bfd-setter/.env`, so it *looks* wired to Retell. It isn't.

---

## Live agents (Retell API, 2026-08-10)

All published, all `en-AU`, all on `gemini-3.0-flash`.

| Agent | agent_id | LLM | v |
|---|---|---|---|
| **Main Outbound** (BFD's own sales agent) | `agent_f45f4dd87a4072424f3c84b74c` | `llm_a73df8d21c84d27b990d53e6722d` | 28 |
| **Inbound BFD Agent** | `agent_b2f6495f3e5c4160528f11b618` | `llm_9dd6af7762a341022c670abf8cae` | 18 |
| Gary — Mortgage Broker (demo) | `agent_3cfd96bff096b0ec08fe272f1b` | `llm_263eb3495b31351e3d66b5fa3b51` | 17 |
| Gary — Property Coach (demo) | `agent_e71ee570afc57878bc15a991f7` | `llm_112c23530053e8af86c186093e2c` | 19 |
| Gary — Finance Strategist (demo) | `agent_fa8a7b317caa7f27e025df28eb` | `llm_9af96b31e0f1c3fd9bccc8e0f989` | 11 |
| Gary — Crazy Gary (test) | `agent_f1264975ec7385293271773117` | `llm_8b1e8df1b4b0d1c84a0c8a679a57` | 12 |

**Shared voice settings:** custom AU voice, responsiveness 0.97, interruption sensitivity 0.9, backchannel on, voice temp 1.06, speed 1.1, max call 10 min, silence hangup 179s, voicemail → hangup, STT `accurate`, ambient sound `call-center`, begin-message delay 2000ms.

**Tools on every agent (8):** `end_call`, `get-available-slots`, `book-appointments`, `update-appointment`, `cancel-appointments`, `get-contact-appointments`, `send-sms`, `schedule-callback`. All custom tools point at `voice-booking-tools` on Supabase.

**`knowledge_base_ids` is EMPTY on every agent.** No Retell-native knowledge base is attached, so the agent knowledge base is a human reference until one is created. Anything the agent must know on a call has to live in the prompt.

---

## Dynamic variables — ground truth

**Source of truth: `frontend/supabase/functions/make-retell-outbound-call/index.ts`, the `dynamicVars` object.** This is the live outbound path — every enroller routes through it (`intake-lead`, `trigger-engagement`, `sync-ghl-contact`, `ghl-tag-webhook`, `reactivate-lead`, `reactivate-lead-list`, `push-engagement-now`, `resume-engagement`, `scheduleCallback`, `runEngagement`).

> ⚠️ **Do not read `outbound-call-processing/index.ts` for this.** It has its own, much smaller `dynamicVars` object and no enroller calls it. Reading it on 2026-08-10 produced a false "booking is broken" finding. If you need to know what a call actually receives, read `make-retell-outbound-call`.

| Group | Variables |
|---|---|
| Lead | `first_name` · `last_name` · `email` · `phone` · `business_name` · `user_contact_details` (full GHL contact JSON) · `custom.<fieldname>` (one per GHL custom field, auto-expanded) |
| Time | `current_time` · `current_timezone` · `business_timezone` · `business_timezone_label` · `lead_timezone` · `lead_timezone_label` |
| Calendar | `available_time_slots` (compacted GHL free-slots) |
| History | `chat_history` · `call_history` |
| Routing | `agent_style` · `source_type` · `utm_source` · `utm_medium` · `utm_campaign` |
| Config | `recording_disclosure` (`required` / `not_required`) · `custom_instructions` · `treat_pickup_as_reply` |
| Internal | `ghl_account_id` · `ghl_contact_id` · `execution_id` · `voice_setter_id` |

Any can be an empty string when the underlying data is missing. Empty means "not known", not "broken".

**Three variable sets were built for the prompt and sat unused until 2026-08-10** — the code comments say "inert until the prompt uses them". The v4 prompt now uses all three:

1. **`agent_style` + `source_type`** — Try-Gary landing routing, built so the prompt can switch persona framing. Now drives the broker/coach vertical branch.
2. **`business_timezone_label` + `lead_timezone_label`** — `lead_timezone*` is non-empty **only** when the lead is in a different valid zone. Now used to state offered times in both zones while still booking the business-tz time.
3. **`recording_disclosure`** — per-client flag from `clients.recording_disclosure_enabled`. Now gates the recording clause in the opener. **The AI disclosure is NOT gated by this and never should be.**

**Booking is phone-first.** `voice-booking-tools` resolves the GHL contact by phone before falling back to email, so a missing email does not break booking on an outbound call.

**Inbound calls to a BYO Twilio number get NO dynamic variables at all.** Every `{{...}}` substitutes empty. The agent must discover the date via `get-available-slots`, identify the caller from `call.from_number`, ask for an email, and fall back to the default (broker) vertical path.

---

## Known defects (2026-08-10)

1. **Stale Retell pointers in BOTH `.env` files** (`bfd-setter/.env` and `bfd-setter-v2/.env`):
   - `BFD_RETELL_LLM_ID=llm_22e795de19b4d25cb579013586be` — does not exist in the Retell account.
   - `BFD_RETELL_AGENT_ID=agent_5ec5e…` — does not exist either.
   - **Severity: low.** Nothing currently deploys prompts through these vars; a call against a non-existent LLM id would 404 loudly. Fix before v2 wires up voice.
2. **Main Outbound's `begin_message` discloses recording but not AI.** The Inbound agent's opener does. Outbound must too — this is a compliance gap, not cosmetic.
3. ~~Four variables referenced in the prompt are never injected.~~ **RETRACTED — this was wrong.** See the warning above.
4. **`ambient_sound = "call-center"`** on a solo-founder agent. Manufactures a call centre that doesn't exist.

---

## Wiring the knowledge base into Retell

Not wired. `knowledge_base_ids` is empty on every agent.

1. Create a Retell Knowledge Base from `Company/knowledge/gary-agent-knowledge-base-2026-08.md`. That file is now clean — product, business and founder facts only, no deployment internals. Upload it as-is.
2. Attach the KB id to `llm_a73df8d21c84d27b990d53e6722d` (Main Outbound) and `llm_9dd6af7762a341022c670abf8cae` (Inbound).
3. Only then trim the FACTS block out of the prompt. **Not before** — an unattached KB plus a trimmed prompt means an agent that knows nothing.
4. **Never upload this file.** It is internal state; the agent has no reason to retrieve an agent_id on a live call.
