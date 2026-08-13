-- 1B — per-client cold-reply nudge config.
--
-- The nudgeColdReply trigger task used to hardcode its cadence
-- (TIER_THRESHOLDS_HOURS = [24, 72, 168], nudge_count < 3), so changing "how
-- many nudges, how far apart" meant a code edit + redeploy. These columns move
-- that config onto the clients row so the agency can tune it per client from
-- the UI (ClientNudgeSettingsCard). Defaults preserve the prior backend
-- behaviour: 2 SMS nudges at +24h then +72h, give up after 14d cold.
--
--   nudge_enabled                boolean  master on/off for cold nudges
--   nudge_offsets_hours          jsonb    array of gaps (hours since the
--                                          previous outbound) before each
--                                          nudge; array length = number of
--                                          nudges before we give up
--   nudge_recovery_window_hours  integer  stop nudging leads colder than this
--
-- Read + validated by trigger/_shared/nudgeConfig.ts (resolveNudgeConfig).
-- These are non-secret. GATE A gates base clients SELECT to agency-role, and
-- the agency settings card reads/writes the base clients row directly, so no
-- clients_public change is needed for the agency-only surface. (If a
-- client-role "My Account" nudge editor is added later, append these three to
-- the clients_public view and the save-account-settings catalog.)

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS nudge_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nudge_offsets_hours jsonb NOT NULL DEFAULT '[24, 72]'::jsonb,
  ADD COLUMN IF NOT EXISTS nudge_recovery_window_hours integer NOT NULL DEFAULT 336;

NOTIFY pgrst, 'reload schema';
