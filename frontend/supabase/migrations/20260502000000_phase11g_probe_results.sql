-- phase-11g — synthetic probe results table.
-- Operator-only audit trail for the hourly synthetic probe Trigger.dev task.
-- A simple time-series table; no agency/client RLS policies (service-role
-- only access — the data is BFD-internal alerting + observability).

CREATE TABLE IF NOT EXISTS public.probe_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at          timestamptz NOT NULL DEFAULT now(),
  passed          boolean NOT NULL,
  duration_ms     integer,
  error_message   text,
  raw             jsonb
);

CREATE INDEX IF NOT EXISTS probe_results_ran_at_idx
  ON public.probe_results (ran_at DESC);

ALTER TABLE public.probe_results ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies — only the service role (Trigger.dev tasks
-- and operator-side scripts) reads/writes this table.
