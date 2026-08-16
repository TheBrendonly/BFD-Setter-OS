-- RETIRED 2026-08-17 (ORPHAN-PROJ-1 cleanup).
-- This migration originally scheduled an every-minute pg_cron job
-- ('refresh-usage-cache-every-minute') that net.http_post'd to a pre-migration
-- Supabase project which is now under a different owner and unreachable to us.
-- It does NOT run on the current platform project (bjgrgbgykvjrsuwwruoh): pg_cron
-- and pg_net are not installed there and no such job exists (verified 2026-08-17).
-- Neutralised to a no-op so the old project ref and its stale anon key are no longer
-- carried in the repo. Usage-cache refresh, where still needed, runs via Trigger.dev.
select 1;
