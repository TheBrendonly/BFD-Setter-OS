-- 20260430140000_phase8_webhook_secrets.sql
-- Phase 8 (master rebuild) — webhook signature verification.
-- Adds the one new column (retell_webhook_secret) needed for Phase 8b.
-- ghl_webhook_secret (8a) and unipile_webhook_secret (8c) were added
-- in 20260430120000_phase7a_tracking_schema.sql.
-- Already applied via Management API; this file is the source-of-truth
-- mirror for replays and rollback.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS retell_webhook_secret text;

COMMIT;
