-- Recreate public.error_logs to match the live platform DB.
--
-- The table EXISTS live (15 columns, RLS on, one agency-SELECT policy) but the
-- repo migrations DROP it (20260305075050_...) and never recreate it, so the
-- schema drifted: ~15 edge functions / Trigger tasks INSERT into this table, yet
-- a fresh environment built from migrations would not have it. This migration is
-- a NO-OP on prod (every statement is guarded) and makes the repo truthful +
-- provisions fresh environments. Shape pulled verbatim from the live DB.

CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ghl_account_id text,
  client_id uuid,
  lead_id text,
  execution_id uuid,
  job_id uuid,
  trigger_run_id text,
  severity text DEFAULT 'error',
  source text,
  category text,
  title text,
  error_type text,
  error_message text,
  context jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_lookup
  ON public.error_logs USING btree (client_ghl_account_id, created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Agency users may read error logs for clients their agency owns. Service-role
-- writers (edge functions / Trigger tasks) bypass RLS. Guarded so prod, where
-- the policy already exists, is untouched (no momentary read gap).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'error_logs'
      AND policyname = 'agency_select_error_logs'
  ) THEN
    CREATE POLICY agency_select_error_logs ON public.error_logs
      FOR SELECT TO authenticated
      USING (
        client_id IN (
          SELECT clients.id FROM clients
          WHERE clients.agency_id = (
            SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
          )
        )
      );
  END IF;
END $$;
