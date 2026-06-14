-- 20260615140000_client_is_system.sql
-- Hide the Synthetic Probe (and any future internal/system client) from the agency UI.
-- The probe row must stay in the DB (the hourly canary + its from-number live on it);
-- it is only filtered out of the agency client list / switcher / landing redirect.
-- Per-client pages remain reachable by direct URL so the from-number stays settable.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.is_system IS
  'System/internal client (e.g. Synthetic Probe) hidden from the agency client list / switcher / landing redirect. Still reachable by direct URL.';

-- Flag the Synthetic Probe client (PROBE_CLIENT_ID).
UPDATE public.clients SET is_system = true
WHERE id = 'b0e4f199-3fa5-4c8d-851b-6167ff46ad91';
