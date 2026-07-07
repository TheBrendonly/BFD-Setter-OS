---
description: MAIN-OUTBOUND-SHARED-1 root-caused + fixed 2026-07-07 - Main Outbound restored to its own dedicated Retell agent via a durable data/binding change (slot move off the inbound-collision slot 1). Live answered-call verify owed to Brendan.
---

# MAIN-OUTBOUND-SHARED-1 — root cause + durable data fix (2026-07-07)

Opus 4.8, plan mode ON. Brendan approved **Option A** (restore the split, durable), **report PU-3/6/7**
(report-only), and **verify the live answered call in his TEST session** (this session confirmed DB read-back
only). No code, no prompt content, no Retell writes.

## What was wrong

The platform `voice_setters` row "Main Outbound" (`id=b09624b5`, client `e467dabc-57ee-416c-8831-83ecd9c7c925`)
held `retell_agent_id = agent_b2f6495…` + `retell_llm_id = llm_9dd6af…` — the same Retell agent + LLM as the
"Inbound BFD Agent" row. `make-retell-outbound-call` reads `voice_setters.retell_agent_id` directly
(`agentId = setter.retell_agent_id` → `override_agent_id`, [index.ts:599](../../frontend/supabase/functions/make-retell-outbound-call/index.ts)),
so real outbound dials placed "as Main Outbound" were running the inbound agent/prompt: no `{{first_name}}`,
inbound-style "what can I help you with?" opener instead of a stated outbound purpose.

## Root cause (fully established — forensic, not a guess)

A **structural slot/column collision**, triggered by a user Save & Push — NOT a code regression:

1. Main Outbound sat on `voice_setters.legacy_slot = 1`. In retell-proxy's `SLOT_TO_AGENT_COLUMN`, **slot 1
   maps to `clients.retell_inbound_agent_id`** ([retell-proxy/index.ts:177](../../frontend/supabase/functions/retell-proxy/index.ts)).
   Slot 1 is the legacy single-agent column from before the inbound/outbound split; the real outbound slots
   2/3 (`retell_outbound_agent_id`/`_followup`) were retired in P3a (2026-06-17) and left out of the map — so
   there is no dedicated outbound slot anymore.
2. Making "Inbound BFD Agent" (slot 8) the inbound setter wrote its agent `b2f6495` into
   `clients.retell_inbound_agent_id` ([useSetInboundSetter.ts:93](../../frontend/src/hooks/useSetInboundSetter.ts))
   — physically slot 1's column.
3. The Save & Push path re-derives the agent id **from the client slot-column, never from the row's own prior
   value**: `syncVoiceSetter` reads `clients[SLOT_TO_AGENT_COLUMN[slot]]` (retell-proxy:835) and
   `dualWriteVoiceSetter` stamps it onto the row keyed by `legacy_slot` (retell-proxy:211).
4. So the **2026-07-01 batch Save & Push of Main Outbound (slot 1)** read `retell_inbound_agent_id = b2f6495`
   and overwrote the row's `retell_agent_id` AND `retell_llm_id`.

**Forensic proof.** Retell call history: outbound dials to the default test number (`+61405482446`) used
`agent_f45f4dd…` through 2026-06-24, then flipped to `agent_b2f6495…` from 2026-07-01 04:15 — right after the
row's `updated_at = 2026-07-01 03:40:34`. No code shipped 07-01 (last in-window deploy was 06-30). The phone's
static `outbound_agents` and `clients.retell_outbound_agent_id` both still held `f45f4dd` (the retired outbound
column was never touched), which is why they stayed correct — the exact inverse of the usual "don't trust the
phone binding" trap.

Two Explore agents independently converged on the same single writer (`dualWriteVoiceSetter`) and mechanism;
the one fact they flagged to confirm (Main Outbound's `legacy_slot`) was verified live = 1.

## The fix (durable, data-only)

A bare "restore the column" would NOT survive Brendan's next required Save & Push (still slot 1 → re-reads the
inbound column → re-clobbers). So the fix moves Main Outbound off slot 1 to the only free MAPPED slot (10 →
`retell_agent_id_10`; slots 2/3 are unmapped and would error a save, slot 9 has a placeholder row):

```sql
-- 1. point slot-10's client column at the dedicated agent
UPDATE clients SET retell_agent_id_10 = 'agent_f45f4dd87a4072424f3c84b74c'
  WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';
-- 2. move Main Outbound to slot 10 + restore its agent + LLM
UPDATE voice_setters SET legacy_slot = 10,
    retell_agent_id = 'agent_f45f4dd87a4072424f3c84b74c',
    retell_llm_id   = 'llm_a73df8d21c84d27b990d53e6722d'
  WHERE id = 'b09624b5-5169-495a-bedd-fb6d3004ab34';
-- 3. move the UI slot label, clear the stale slot-1/2 labels
UPDATE clients SET setter_display_names =
    (setter_display_names - 'voice-1' - 'voice-2') || '{"voice-10":"Main Outbound"}'::jsonb
  WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';
```

Left untouched on purpose: `clients.retell_inbound_agent_id = b2f6495` (still the correct inbound resolver, slot
8 Inbound unchanged); `clients.retell_outbound_agent_id`/`_followup = f45f4dd` (retired, harmless). No Retell
write (`outbound_agents` was already `f45f4dd`).

## Pre / post values (rollback record)

| field | BEFORE (rollback to this) | AFTER |
|---|---|---|
| `voice_setters.b09624b5.legacy_slot` | `1` | `10` |
| `voice_setters.b09624b5.retell_agent_id` | `agent_b2f6495f3e5c4160528f11b618` | `agent_f45f4dd87a4072424f3c84b74c` |
| `voice_setters.b09624b5.retell_llm_id` | `llm_9dd6af7762a341022c670abf8cae` | `llm_a73df8d21c84d27b990d53e6722d` |
| `clients.retell_agent_id_10` | `NULL` | `agent_f45f4dd87a4072424f3c84b74c` |
| `setter_display_names.voice-1` / `voice-2` | `"Main Outbound"` / `"Main Outbound"` | removed |
| `setter_display_names.voice-10` | (absent) | `"Main Outbound"` |

**Rollback SQL** (only if the live call regresses):
```sql
UPDATE voice_setters SET legacy_slot = 1,
    retell_agent_id = 'agent_b2f6495f3e5c4160528f11b618',
    retell_llm_id   = 'llm_9dd6af7762a341022c670abf8cae'
  WHERE id = 'b09624b5-5169-495a-bedd-fb6d3004ab34';
UPDATE clients SET retell_agent_id_10 = NULL,
    setter_display_names = (setter_display_names - 'voice-10')
      || '{"voice-1":"Main Outbound","voice-2":"Main Outbound"}'::jsonb
  WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';
```

## Verified this session (read-back)

- `voice_setters`: Main Outbound → slot 10 / `agent_f45f4dd…` / `llm_a73df8…` / `is_inbound=false`; Inbound BFD
  Agent → slot 8 / `agent_b2f6495…` / `is_inbound=true`. **The two rows now point at different agents.**
- `clients`: `retell_agent_id_10 = agent_f45f4dd…`; `retell_inbound_agent_id` still `b2f6495…`;
  `setter_display_names` has `voice-10:"Main Outbound"`, no `voice-1`/`voice-2`.
- No slot-1 row remains → the collision is broken; a future Save & Push of Main Outbound (slot 10) re-reads
  `retell_agent_id_10 = f45f4dd`, so it will NOT re-clobber.
- Restored agent `f45f4dd` (LLM `llm_a73df8`) opener confirmed intact (read-only): *"Hey {{first_name}}, it's
  Gary, from Building Flow Digital - you put your hand up for some info on our AI setter service. Got a quick
  sec?"* — already personalizes + states purpose.

## Owed to Brendan (TEST_LIST + report-only)

- **Live outbound call (Voice-gated → `TEST_LIST.md` "MAIN-OUTBOUND-SHARED-1 live"):** `node
  scripts/test-harness/dial.mjs` (default target IS Main Outbound). Confirm the Retell record shows
  `agent_id = agent_f45f4dd…`, the answered opener personalizes + states purpose, and booking still works
  (B-3/B-5 survive).
- **Re-Save (via the UI, report-only):** re-Save **Main Outbound** (now slot 10) to reassert its own prompt +
  VM-1/API-DEPR-2 presets onto `f45f4dd`; re-Save **Inbound BFD Agent** (slot 8) to scrub any Main-Outbound
  config the 2026-07-01 save had pushed onto `b2f6495`.
- **Prompt items (report-only, `PROMPT_UPDATE_LIST.md`):** PU-3 + PU-7 auto-resolved by the restore; **PU-6
  (recording disclosure) is now open on `f45f4dd`** — add e.g. *"Just so you know, this call's recorded for
  quality."* near its opener (the F17 `{{recording_disclosure}}` variable is a no-op until wording references
  it).
- **Naming note:** the restored agent's Retell display name is still "Voice-Setter-Test" (CLAUDE.md flags that
  name as "not in use" — now stale). Optional rename is Brendan's, in the Retell UI.

## Residual (logged, not fixed — frozen baseline)

`DEFERRED.md` **SLOT-MAP-1**: retell-proxy's slot/agent-column model has no dedicated outbound slot and slot 1
double-duties as the inbound resolver, so any future setter on slot 1 hits the same trap. Proper fix is a
retell-proxy code change (dedicated outbound slot, or match `dualWriteVoiceSetter` on the setter UUID instead
of `legacy_slot`, or guard against writing when a non-inbound setter resolves to `retell_inbound_agent_id`).
Gate: next intentional touch of the voice-setter/slot machinery.

## Close-out

- `BUG_LIST.md` → 0 open (MAIN-OUTBOUND-SHARED-1 fixed; live verify moved to `TEST_LIST.md`).
- `PROMPT_UPDATE_LIST.md` PU-3 (resolved) / PU-6 (now 4 agents) / PU-7 (Main Outbound clean) corrected.
- `DEFERRED.md` SLOT-MAP-1 logged. `SESSION_PLAN.md` pipeline updated. Memory updated
  (`project_inbound_outbound_share_agent_2026_06_24` flipped SUPERSEDED → RESOLVED + root cause).
- Committed + pushed origin + github.

## Next

Per the pipeline, next is **P2** (Brendan-driven `DEFERRED.md` pick session — likely a fast no-op since most
items are gated on a paying client) or **skip to P3** (review + cleanup + research). Both prompts are in the
2026-07-07 P1 handoff; the P2 prompt is reproduced below with the pipeline advanced.

```
SETTINGS: Model Opus 4.8 [1m] · Thinking HIGH · Mode: plan ON (may involve new feature design - research + approve before any edits).

BFD-setter continuation. Repo /srv/bfd/Projects/bfd-setter, branch main (git pull first).
Supabase ref bjgrgbgykvjrsuwwruoh. Creds in ./.env (SUPABASE_PAT, TRIGGER_DEPLOY_PAT, BFD_RETELL_API_KEY).
Live DB via Supabase Management API /database/query (NOT postgres MCP). Live Retell via api.retellai.com
with BFD_RETELL_API_KEY. To know which agent serves a setter, read voice_setters.retell_agent_id directly
(NOT the phone-number binding). NEVER edit voice prompts (report-only: report location + change, Brendan
applies in the BFD setter UI). Verify read-only before claiming done. No em dashes. Follow the Relay
Protocol in Docs/SESSION_PLAN.md.
READ FIRST: Docs/SESSION_PLAN.md, the 2026-07-07 P1 handoff + action pack, the 2026-07-07
MAIN-OUTBOUND-SHARED-1 fix handoff, Docs/DEFERRED.md.

BFD-setter - Session P2: deferred-feature pick session.

Scope: this is a Brendan-driven triage, not a default build session. Most of Docs/DEFERRED.md is
explicitly gated on something that hasn't happened yet (a paying client, real usage data, a Supabase Pro
upgrade, an explicit client ask) - the point of this session is to check whether any of those gates have
now been met, or whether Brendan wants to pull something forward regardless of its gate, NOT to build the
list wholesale.

1. Walk Docs/DEFERRED.md with Brendan section by section (Lead lifecycle system, F8 v2, 2.6 cost dashboard,
   3.1 A/B testing, 3.2 agent-by-form-field, 3.3 campaign-level default setter, 3.9 cost-ceiling aggregates,
   3.11 HubSpot+GHL, 4.1 pricing model, 4.3 multi-Twilio failover, BOOK-TZ-1 per-lead timezone, E-1, email
   provider, HIBP, the text_engine_webhook column drop, the by-phone Spec-2 N-row merge, F9 v2, SLOT-MAP-1).
   For each, ask: has the stated gate been met, or does Brendan want it built anyway?
2. For anything Brendan greenlights: use superpowers:brainstorming first (this is new feature work), then
   writing-plans, then build it following the same TDD + verify-before-completion discipline as every other
   session here.
3. If nothing is greenlit: say so plainly, do not invent scope, and close this session out as a fast no-op.
4. Do NOT touch the gated First-Client Milestone items (Stripe, webhook secrets, AU A2P).

Close out per the Relay Protocol regardless of outcome (update the lists if anything shipped, write a dated
handoff, commit/push). Then emit the Session P3 prompt (or, if this session decides P3's scope should change
based on what got built here, an adjusted version of it) verbatim in chat + save it into the handoff.

▶ PIPELINE: [✓] P1 audit + action pack   [✓] MAIN-OUTBOUND-SHARED-1 fix   [•] P2 (here)   [ ] P3 review+cleanup+research   [ ] First-Client Milestone (GATED)
```
