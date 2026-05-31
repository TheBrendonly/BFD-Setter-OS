-- Voice setters: populate the UUID model from the legacy slot columns (2026-05-31)
--
-- The voice_setters / voice_setter_phone_bindings tables (created 2026-05-27)
-- were never populated by code. This makes them the real, populated source of
-- truth for every client, WITHOUT removing the legacy slot path (make-retell-
-- outbound-call + retell-proxy still support legacy slots, so live calls are
-- unaffected). retell-proxy now dual-writes voice_setters going forward.
--
-- Idempotent + safe for BFD (which was hand-backfilled with legacy_slot NULL):
--   1. add legacy_slot bridge column,
--   2. stamp existing rows' legacy_slot by matching retell_agent_id,
--   3. insert any populated slot not yet represented (guarded against both
--      unique constraints),
--   4. backfill outbound phone bindings for slots 1-3.

BEGIN;

ALTER TABLE public.voice_setters ADD COLUMN IF NOT EXISTS legacy_slot integer;

CREATE UNIQUE INDEX IF NOT EXISTS voice_setters_client_legacy_slot_unique
  ON public.voice_setters (client_id, legacy_slot)
  WHERE legacy_slot IS NOT NULL;

-- Map slot number -> clients agent column, name, and (slots 1-3) phone column.
CREATE TEMP TABLE _slot_map (slot int, nm text, agent_col text, phone_col text) ON COMMIT DROP;
INSERT INTO _slot_map (slot, nm, agent_col, phone_col) VALUES
  (1, 'Voice Setter 1 (Inbound)',   'retell_inbound_agent_id',          'retell_phone_1'),
  (2, 'Voice Setter 2 (Outbound)',  'retell_outbound_agent_id',         'retell_phone_2'),
  (3, 'Voice Setter 3 (Follow-up)', 'retell_outbound_followup_agent_id','retell_phone_3'),
  (4, 'Voice Setter 4',  'retell_agent_id_4',  NULL),
  (5, 'Voice Setter 5',  'retell_agent_id_5',  NULL),
  (6, 'Voice Setter 6',  'retell_agent_id_6',  NULL),
  (7, 'Voice Setter 7',  'retell_agent_id_7',  NULL),
  (8, 'Voice Setter 8',  'retell_agent_id_8',  NULL),
  (9, 'Voice Setter 9',  'retell_agent_id_9',  NULL),
  (10,'Voice Setter 10', 'retell_agent_id_10', NULL);

-- One row per (client, slot) where the agent column is non-null.
CREATE TEMP TABLE _slot_agents (client_id uuid, slot int, nm text, agent_id text, phone text) ON COMMIT DROP;
INSERT INTO _slot_agents (client_id, slot, nm, agent_id, phone)
SELECT c.id, m.slot, m.nm,
       to_jsonb(c) ->> m.agent_col,
       CASE WHEN m.phone_col IS NOT NULL THEN to_jsonb(c) ->> m.phone_col ELSE NULL END
FROM public.clients c
CROSS JOIN _slot_map m
WHERE NULLIF(trim(coalesce(to_jsonb(c) ->> m.agent_col, '')), '') IS NOT NULL;

-- 2. Stamp existing voice_setters rows with their slot (match by agent id).
UPDATE public.voice_setters vs
SET legacy_slot = sa.slot
FROM _slot_agents sa
WHERE vs.client_id = sa.client_id
  AND vs.retell_agent_id = sa.agent_id
  AND vs.legacy_slot IS NULL;

-- 3. Insert slots not yet represented, guarding both unique constraints
--    (client_id+legacy_slot and client_id+name).
INSERT INTO public.voice_setters (client_id, name, retell_agent_id, is_active, legacy_slot)
SELECT sa.client_id, sa.nm, sa.agent_id, true, sa.slot
FROM _slot_agents sa
WHERE NOT EXISTS (
        SELECT 1 FROM public.voice_setters vs
        WHERE vs.client_id = sa.client_id AND vs.legacy_slot = sa.slot)
  AND NOT EXISTS (
        SELECT 1 FROM public.voice_setters vs
        WHERE vs.client_id = sa.client_id AND vs.retell_agent_id = sa.agent_id)
  AND NOT EXISTS (
        SELECT 1 FROM public.voice_setters vs
        WHERE vs.client_id = sa.client_id AND vs.name = sa.nm);

-- 4. Backfill outbound phone bindings for slots 1-3 (the only slots with a
--    legacy phone column). Bind to whichever voice_setter now owns that slot.
INSERT INTO public.voice_setter_phone_bindings (client_id, setter_id, phone_e164, direction)
SELECT sa.client_id, vs.id, sa.phone, 'outbound'
FROM _slot_agents sa
JOIN public.voice_setters vs
  ON vs.client_id = sa.client_id AND vs.legacy_slot = sa.slot
WHERE sa.phone IS NOT NULL AND trim(sa.phone) <> ''
  AND NOT EXISTS (
        SELECT 1 FROM public.voice_setter_phone_bindings b
        WHERE b.client_id = sa.client_id
          AND b.phone_e164 = sa.phone
          AND b.direction = 'outbound');

COMMIT;
