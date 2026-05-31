-- Cross-client phone-uniqueness audit + guard (2026-05-31)
-- NOT an auto-run migration: applying the unique index while duplicate numbers
-- exist would fail. Run the AUDIT first; resolve any duplicates (a human call on
-- which client keeps the number); THEN apply the GUARD.
--
-- Background: a real incident (shared retell_phone_1 across two clients) silently
-- broke inbound routing. The new voice_setter_phone_bindings table is the place
-- to enforce one-owner-per-number going forward.

-- ───────────────────────── AUDIT ─────────────────────────
-- 1. Same number used by more than one client across the legacy slot columns.
SELECT phone, array_agg(DISTINCT client_id) AS client_ids, count(*) AS uses
FROM (
  SELECT id AS client_id, retell_phone_1 AS phone FROM public.clients WHERE retell_phone_1 IS NOT NULL
  UNION ALL
  SELECT id, retell_phone_2 FROM public.clients WHERE retell_phone_2 IS NOT NULL
  UNION ALL
  SELECT id, retell_phone_3 FROM public.clients WHERE retell_phone_3 IS NOT NULL
) s
GROUP BY phone
HAVING count(DISTINCT client_id) > 1;

-- 2. Duplicate ghl_location_id across clients (collides message_queue / active_trigger_runs).
SELECT ghl_location_id, count(*) AS clients
FROM public.clients
WHERE ghl_location_id IS NOT NULL
GROUP BY ghl_location_id
HAVING count(*) > 1;

-- 3. Duplicate numbers already in the new bindings table.
SELECT phone_e164, count(DISTINCT client_id) AS clients
FROM public.voice_setter_phone_bindings
GROUP BY phone_e164
HAVING count(DISTINCT client_id) > 1;

-- ───────────────────── GUARD (apply only after audit is clean) ─────────────────────
-- One client globally owns a phone number in the new model.
-- CREATE UNIQUE INDEX IF NOT EXISTS voice_setter_phone_bindings_phone_global_unique
--   ON public.voice_setter_phone_bindings (phone_e164);
