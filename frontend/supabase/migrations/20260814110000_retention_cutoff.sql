-- 2B — consent/retention cutoff.
--
-- A lead may only be contacted while its consent is current. After a per-client
-- retention window (default 3 months) measured from the lead's consent_timestamp
-- (or created_at when no explicit consent timestamp exists), the daily
-- retentionCutoff task stops all outbound to the lead and unenrolls it from any
-- active cadence.
--
--   clients.retention_months  per-client window in whole months (default 3)
--   leads.retention_expired   set true once the sweep has retired the lead
--                             (audit; kept distinct from setter_stopped / opt-out
--                             so a retention retirement is not confused with STOP)
--
-- v1 stops contacting + unenrolls; PII anonymisation after a grace period is a
-- later step. Read + validated by trigger/_shared/retention.ts.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS retention_months integer NOT NULL DEFAULT 3;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS retention_expired boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
