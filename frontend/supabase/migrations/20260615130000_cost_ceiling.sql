-- 20260615130000_cost_ceiling.sql
-- D2 (4.4) per-tenant rolling cost ceiling — FLAG ONLY (no auto-pause).
--
-- Today's only guard is per-lead (>500c -> error_logs, in runEngagement). This adds a
-- per-tenant rolling-window aggregate so a runaway tenant is flagged before any single
-- lead is. Reuses cadence_metrics.cost_estimate_cents (already written per execution);
-- no new per-execution table.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS weekly_cost_ceiling_cents integer,
  ADD COLUMN IF NOT EXISTS monthly_cost_ceiling_cents integer;

COMMENT ON COLUMN public.clients.weekly_cost_ceiling_cents IS
  'Flag-only rolling 7-day cadence cost ceiling (cents); NULL = no ceiling. Breach logs an error_logs row (error_type=cost_ceiling_breach); never auto-pauses.';
COMMENT ON COLUMN public.clients.monthly_cost_ceiling_cents IS
  'Flag-only rolling 30-day cadence cost ceiling (cents); NULL = no ceiling.';

-- Rolling per-tenant cost aggregate over cadence_metrics. security_invoker=true so the
-- querying role's RLS on cadence_metrics applies: the frontend agency JWT sees only its
-- own clients; the runtime service-role (RLS-bypassing) sees all.
CREATE OR REPLACE VIEW public.client_cost_rollup
WITH (security_invoker = true) AS
SELECT
  client_id,
  COALESCE(SUM(cost_estimate_cents) FILTER (WHERE created_at >= now() - interval '7 days'), 0)::bigint  AS week_cents,
  COALESCE(SUM(cost_estimate_cents) FILTER (WHERE created_at >= now() - interval '30 days'), 0)::bigint AS month_cents
FROM public.cadence_metrics
GROUP BY client_id;

GRANT SELECT ON public.client_cost_rollup TO authenticated, service_role;
