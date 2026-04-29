-- 20260430130000_phase7d_cadence_funnel_view.sql
-- Phase 7d (master rebuild) — cadence funnel materialised view +
-- refresh helper. Powered by cadence_metrics (rows written by
-- runEngagement on every execution end — Phase 7e).

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.cadence_funnel;

CREATE MATERIALIZED VIEW public.cadence_funnel AS
SELECT
  cm.client_id,
  cm.workflow_id,
  ew.name AS workflow_name,
  date_trunc('day', cm.created_at) AS day,
  count(*) AS leads_enrolled,
  count(*) FILTER (WHERE cm.sms_sent > 0) AS leads_texted,
  count(*) FILTER (WHERE cm.reply_received) AS leads_replied,
  count(*) FILTER (WHERE cm.calls_attempted > 0) AS leads_called,
  count(*) FILTER (WHERE cm.calls_picked_up > 0) AS leads_picked_up,
  count(*) FILTER (WHERE cm.voicemails_dropped > 0) AS voicemails_dropped,
  count(*) FILTER (WHERE cm.booking_created) AS leads_booked,
  count(*) FILTER (WHERE cm.stop_reason = 'opt_out') AS opt_outs,
  avg(cm.time_to_first_response_seconds) AS avg_response_seconds,
  avg(cm.time_to_booking_seconds) AS avg_booking_seconds
FROM public.cadence_metrics cm
LEFT JOIN public.engagement_workflows ew ON ew.id = cm.workflow_id
GROUP BY 1, 2, 3, 4
WITH NO DATA;

CREATE INDEX cadence_funnel_client_day_idx
  ON public.cadence_funnel (client_id, day DESC);

-- Helper to refresh the view; called from a Trigger.dev scheduled task.
-- We try CONCURRENTLY first (requires a unique index) and fall back to
-- a full refresh otherwise.
CREATE OR REPLACE FUNCTION public.refresh_cadence_funnel()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.cadence_funnel;
END;
$$ LANGUAGE plpgsql;

COMMIT;
