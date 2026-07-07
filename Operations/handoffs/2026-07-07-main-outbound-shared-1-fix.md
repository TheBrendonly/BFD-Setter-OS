---
description: MAIN-OUTBOUND-SHARED-1 root-caused + comprehensively fixed 2026-07-07 - Main Outbound restored to its own dedicated Retell agent by migrating the WHOLE setter (all 6 slot-keyed tables + binding + label) off the inbound-collision slot 1 to slot 10. Live answered-call verify owed to Brendan.
---

# MAIN-OUTBOUND-SHARED-1 — root cause + comprehensive fix (2026-07-07)

Opus 4.8, plan mode ON. Brendan approved **Option A** (restore the split, durable). This handoff supersedes the
first-cut version: the initial narrow fix was caught by Brendan mid-session and redone comprehensively.

## What was wrong

The platform `voice_setters` row "Main Outbound" (`id=b09624b5`, client `e467dabc-57ee-416c-8831-83ecd9c7c925`)
ran the same Retell agent + LLM as "Inbound BFD Agent" (`agent_b2f6495…` / `llm_9dd6af…`). Real outbound dials
placed "as Main Outbound" ran the inbound agent/prompt: no `{{first_name}}`, inbound-style opener.

## Root cause (forensic, fully established — NOT a code regression)

A **structural slot/column collision**:
- Main Outbound sat on `legacy_slot = 1`, and retell-proxy's `SLOT_TO_AGENT_COLUMN[1] = clients.retell_inbound_agent_id`
  (the legacy single-agent column from before the inbound/outbound split; outbound slots 2/3 were retired in
  P3a 2026-06-17).
- Making "Inbound BFD Agent" (slot 8) the inbound setter wrote its agent `b2f6495` into
  `clients.retell_inbound_agent_id` (`useSetInboundSetter.ts:93`) — physically slot 1's column.
- The Save & Push path re-derives the agent id from `clients[SLOT_TO_AGENT_COLUMN[slot]]`
  (`syncVoiceSetter`, retell-proxy:835) and `dualWriteVoiceSetter` stamps it onto the row keyed by `legacy_slot`
  (retell-proxy:211). So the **2026-07-01 batch Save & Push of Main Outbound (slot 1)** read `retell_inbound_agent_id
  = b2f6495` and overwrote the row's `retell_agent_id` + `retell_llm_id`.
- Forensic: outbound dials used `agent_f45f4dd…` through 2026-06-24, flipped to `b2f6495` from 2026-07-01 04:15
  (right after the row's `updated_at` 03:40:34); no code shipped 07-01. The phone's `outbound_agents` +
  `clients.retell_outbound_agent_id` stayed `f45f4dd` (retired column, never touched).

## Why the fix had to be comprehensive (the mid-session correction)

A "voice setter" is NOT just the `voice_setters` row. Its identity is spread across two keying systems:
- **Prompt + UI identity** keyed by the `slot_id` string `"Voice-Setter-N"` across 6 tables: `prompts`,
  `agent_settings`, `prompt_configurations`, `prompt_docs`, `prompt_versions`, `setter_ai_reports`. The UI grid
  renders one tile per `Voice-Setter-N` found in `prompts`/`agent_settings` (`PromptManagement.tsx:5644`), NOT
  from `voice_setters`. The tile's display label comes from `clients.setter_display_names['voice-N']`.
- **Agent-binding** = the `voice_setters` row keyed by `legacy_slot` number + its UUID.

The first-cut fix moved only the `voice_setters` row (→ slot 10) + `clients.retell_agent_id_10` + the display
label. That **decoupled** the setter: prompt/tile stayed at slot 1 (showing as unlabeled "SETTER-1" because the
`voice-1` label was cleared), binding moved to slot 10. Brendan spotted the "SETTER-1 / Main Outbound missing"
anomaly before re-saving. **That partial change was fully reverted**, then redone as a cohesive migration.

Pre-flight audit (read-only) confirmed the move is safe: the grid renders by `Voice-Setter-N` enumeration (max
slot 10, no contiguity assumption); cadence dialing is by `voice_setter_id` UUID (`runEngagement.ts:1051`),
and both cadences that use Main Outbound ("Try-Gary", "New-Lead Cadence from Form-Fill") reference the UUID
`b09624b5` — no workflow anywhere references the legacy string `"Voice-Setter-1"`; the one `scheduled_callbacks`
row is `placed` + a different setter; all the slot-keyed UNIQUE constraints are `(client_id, slot_id…)` and slot
10 was empty. `make-retell-outbound-call` resolves the agent from `voice_setters.retell_agent_id` by UUID
(primary path), so the slot rename is transparent to live dials.

## The comprehensive fix (durable, data-only — one transaction)

Moved the ENTIRE Main Outbound setter off the poisoned slot 1 to the free generic slot 10, as one unit
(script: `scratchpad/main_outbound_migration.sql`, run in a `BEGIN…COMMIT`):

```sql
-- 85 slot-keyed rows: 1 prompts + 1 agent_settings + 76 prompt_configurations + 1 prompt_docs + 6 prompt_versions
UPDATE prompts               SET slot_id='Voice-Setter-10' WHERE client_id='e467dabc-…' AND slot_id='Voice-Setter-1';
UPDATE agent_settings        SET slot_id='Voice-Setter-10' WHERE client_id='e467dabc-…' AND slot_id='Voice-Setter-1';
UPDATE prompt_configurations SET slot_id='Voice-Setter-10' WHERE client_id='e467dabc-…' AND slot_id='Voice-Setter-1';
UPDATE prompt_docs           SET slot_id='Voice-Setter-10' WHERE client_id='e467dabc-…' AND slot_id='Voice-Setter-1';
UPDATE prompt_versions       SET slot_id='Voice-Setter-10' WHERE client_id='e467dabc-…' AND slot_id='Voice-Setter-1';
-- binding row -> slot 10 + restore the dedicated agent + llm
UPDATE voice_setters SET legacy_slot=10,
    retell_agent_id='agent_f45f4dd87a4072424f3c84b74c', retell_llm_id='llm_a73df8d21c84d27b990d53e6722d'
  WHERE id='b09624b5-5169-495a-bedd-fb6d3004ab34';
-- slot-10 client agent column (durability: a future slot-10 Save & Push re-reads f45f4dd)
UPDATE clients SET retell_agent_id_10='agent_f45f4dd87a4072424f3c84b74c' WHERE id='e467dabc-…';
-- move the display label, clear the stale slot-1/2 labels
UPDATE clients SET setter_display_names=(setter_display_names - 'voice-1' - 'voice-2')
    || '{"voice-10":"Main Outbound"}'::jsonb WHERE id='e467dabc-…';
```

`setter_ai_reports` had 0 rows at `Voice-Setter-1` (nothing to move). `voice_setter_phone_bindings` (the outbound
from-number `+61481614530`) is keyed by setter UUID → unchanged by the slot move. `clients.retell_inbound_agent_id`
left = `b2f6495` (inbound resolver, correct); Inbound setter (slot 8) untouched. No code, no prompt content, no
Retell writes.

## Verified this session (read-back)

- 85 slot-keyed rows now at `Voice-Setter-10`; **zero rows left at `Voice-Setter-1`** (setter is whole at slot 10).
- `voice_setters`: Main Outbound → slot 10 / `agent_f45f4dd…` / `llm_a73df8…` / `is_inbound=false`; Inbound → slot
  8 / `agent_b2f6495…` / `is_inbound=true`. Two distinct agents.
- `clients`: `retell_agent_id_10 = agent_f45f4dd…`; `retell_inbound_agent_id` still `b2f6495…`;
  `setter_display_names` = `voice-10:"Main Outbound"`, no `voice-1`/`voice-2`.
- from-number binding for `b09624b5` intact (`+61481614530`, in/out).
- Durability: a future Save & Push of Main Outbound (slot 10) re-reads `clients.retell_agent_id_10 = f45f4dd`,
  so it will NOT re-clobber.
- Restored agent `f45f4dd`'s opener already personalizes + states purpose ("Hey {{first_name}}, it's Gary, from
  Building Flow Digital - you put your hand up for some info…").

## Emergency rollback (reverts to the BUG state; use only if the live call regresses)

```sql
BEGIN;
UPDATE prompts               SET slot_id='Voice-Setter-1' WHERE client_id='e467dabc-57ee-416c-8831-83ecd9c7c925' AND slot_id='Voice-Setter-10';
UPDATE agent_settings        SET slot_id='Voice-Setter-1' WHERE client_id='e467dabc-57ee-416c-8831-83ecd9c7c925' AND slot_id='Voice-Setter-10';
UPDATE prompt_configurations SET slot_id='Voice-Setter-1' WHERE client_id='e467dabc-57ee-416c-8831-83ecd9c7c925' AND slot_id='Voice-Setter-10';
UPDATE prompt_docs           SET slot_id='Voice-Setter-1' WHERE client_id='e467dabc-57ee-416c-8831-83ecd9c7c925' AND slot_id='Voice-Setter-10';
UPDATE prompt_versions       SET slot_id='Voice-Setter-1' WHERE client_id='e467dabc-57ee-416c-8831-83ecd9c7c925' AND slot_id='Voice-Setter-10';
UPDATE voice_setters SET legacy_slot=1, retell_agent_id='agent_b2f6495f3e5c4160528f11b618', retell_llm_id='llm_9dd6af7762a341022c670abf8cae' WHERE id='b09624b5-5169-495a-bedd-fb6d3004ab34';
UPDATE clients SET retell_agent_id_10=NULL, setter_display_names=(setter_display_names - 'voice-10') || '{"voice-1":"Main Outbound","voice-2":"Main Outbound"}'::jsonb WHERE id='e467dabc-57ee-416c-8831-83ecd9c7c925';
COMMIT;
```

## Owed to Brendan

- **Live outbound call (Voice-gated → `TEST_LIST.md`):** `node scripts/test-harness/dial.mjs` (default target =
  Main Outbound UUID). Confirm the Retell record shows `agent_id = agent_f45f4dd…`, the answered opener
  personalizes + states purpose, booking works (B-3/B-5 survive).
- **Now SAFE to re-save (via the UI):** Main Outbound is now the **slot-10 tile** (labeled "Main Outbound").
  Re-Save it to reassert its prompt + VM-1/API-DEPR-2 presets onto `f45f4dd` (durable). Re-Save Inbound (slot 8)
  to scrub any Main-Outbound config the 07-01 save pushed onto `b2f6495`. The other four Garys re-save safely.
- **⚠️ Cosmetic + footgun:** the grid force-renders an EMPTY "Setter-1" tile (the code always seeds slot 1).
  Leave it empty — do NOT create/save a setter on it: saving slot 1 would re-read `retell_inbound_agent_id`
  (`b2f6495`) and re-create the inbound-agent collision. That empty tile is the visible face of the residual
  design flaw (DEFERRED SLOT-MAP-1).
- **Prompt items (report-only):** PU-3 + PU-7 auto-resolved by the restore; **PU-6 (recording disclosure) is now
  open on `f45f4dd`** — add e.g. "Just so you know, this call's recorded for quality." near its opener.

## Residual (logged, not fixed — frozen baseline)

`DEFERRED.md` **SLOT-MAP-1**: retell-proxy's slot/agent-column model has no dedicated outbound slot and slot 1
double-duties as the inbound resolver; any future setter placed on slot 1 hits the same trap. Proper fix is a
retell-proxy code change. Gate: next intentional touch of the voice-setter/slot machinery.

## Close-out

- `BUG_LIST.md` → 0 open (fix note updated to the comprehensive version; live verify → `TEST_LIST.md`).
- `PROMPT_UPDATE_LIST.md` PU-3/6/7 corrected (PU-6 scoped to Main Outbound + the demo-persona note Brendan added).
- `DEFERRED.md` SLOT-MAP-1 logged. `SESSION_PLAN.md` pipeline updated. Memory updated.
- Committed + pushed origin + github.

## Next

Per the pipeline, next is **P2** (Brendan-driven `DEFERRED.md` pick — likely a fast no-op) or skip to **P3**
(review + cleanup + research). The P2 prompt is reproduced at the bottom of the prior commit's handoff and in
`SESSION_PLAN.md`.
