-- Phase E3 EE1: per-slot direction multi-select for Voice AI Setter.
--
-- Adds prompts.directions text[] so each voice_setter prompt row can declare
-- which clients.retell_*_agent_id columns the "Push to Retell" action should
-- fan out to. The "primary anchor" for a slot stays governed by retell-proxy's
-- SLOT_TO_AGENT_COLUMN (slot 1 -> retell_inbound_agent_id, slot 2 ->
-- retell_outbound_agent_id, slot 3 -> retell_outbound_followup_agent_id).
-- This new column tells retell-proxy which ADDITIONAL columns to point at the
-- slot's agent after publish.
--
-- Allowed values: 'inbound', 'outbound_initial', 'outbound_followup'.
--
-- Backfill: derive directions from the current clients-row agent_id matches.
-- For each Voice-Setter-N row, look at the slot's primary agent_id (per the
-- mapping above) and check which other columns ALSO equal that agent_id.

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS directions text[];

UPDATE prompts p
SET directions = (
  SELECT array_remove(ARRAY[
    CASE WHEN c.retell_inbound_agent_id IS NOT NULL AND c.retell_inbound_agent_id = anchor.primary_agent THEN 'inbound' END,
    CASE WHEN c.retell_outbound_agent_id IS NOT NULL AND c.retell_outbound_agent_id = anchor.primary_agent THEN 'outbound_initial' END,
    CASE WHEN c.retell_outbound_followup_agent_id IS NOT NULL AND c.retell_outbound_followup_agent_id = anchor.primary_agent THEN 'outbound_followup' END
  ], NULL)
  FROM clients c
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN p.slot_id = 'Voice-Setter-1' THEN c.retell_inbound_agent_id
      WHEN p.slot_id = 'Voice-Setter-2' THEN c.retell_outbound_agent_id
      WHEN p.slot_id = 'Voice-Setter-3' THEN c.retell_outbound_followup_agent_id
    END AS primary_agent
  ) anchor
  WHERE c.id = p.client_id
)
WHERE p.category = 'voice_setter'
  AND p.slot_id IN ('Voice-Setter-1', 'Voice-Setter-2', 'Voice-Setter-3')
  AND p.directions IS NULL;

COMMENT ON COLUMN prompts.directions IS
  'Phase E3 EE1: which retell agent slot columns the push targets. Allowed values: inbound, outbound_initial, outbound_followup. NULL means no fan-out yet (legacy rows).';
