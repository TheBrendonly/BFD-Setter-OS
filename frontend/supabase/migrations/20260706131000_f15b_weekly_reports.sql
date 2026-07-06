-- F15(b) — weekly client ROI report snapshots.
--
-- The weeklyClientReport Trigger cron assembles one row per client per week
-- (calls made/answered, SMS conversations, show-rate funnel, billed usage,
-- top objections, and an agency-editable "what we improved" block), renders a
-- white-label HTML email, and persists the snapshot here. Email send is gated
-- on Resend SMTP (RESEND_API_KEY): until it lands, email_status='stubbed' and
-- the dashboard preview URL renders the stored html/payload.
--
-- Reads go through the get-weekly-report edge fn (service role, role-branched),
-- so RLS is enabled with NO policies (service-role only).

CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  payload jsonb NOT NULL,
  html text,
  email_status text,            -- 'stubbed' | 'sent' | 'failed'
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- One report per client per week (the cron upserts on re-run).
CREATE UNIQUE INDEX IF NOT EXISTS weekly_reports_client_period_uidx
  ON public.weekly_reports (client_id, period_start);
CREATE INDEX IF NOT EXISTS weekly_reports_client_created_idx
  ON public.weekly_reports (client_id, created_at DESC);

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
-- No policies: all access via the get-weekly-report edge fn (service role).

-- F15 report/visibility config, kept in a SEPARATE table from
-- client_pricing_config: the F13 pricing editor overwrites its whole config jsonb
-- via mergeWithDefaults (which drops unknown keys), so a config.report sibling
-- there would be clobbered on the next pricing save. This table holds:
--   { show_funnel_to_client, show_report_to_client, sections:{...},
--     what_we_improved: string[], recipient_email? }
-- Agency-role-gated writes (a client is its own agency, so gate on the agency
-- role like client_pricing_config); the edge fns + cron read it as service role.
CREATE TABLE IF NOT EXISTS public.client_report_config (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_report_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency users can manage report config for their clients"
  ON public.client_report_config
  FOR ALL
  USING (
    (get_user_role(auth.uid()) = 'agency')
    AND client_id IN (
      SELECT clients.id FROM public.clients
      WHERE clients.agency_id IN (SELECT profiles.agency_id FROM public.profiles WHERE profiles.id = auth.uid())
    )
  )
  WITH CHECK (
    (get_user_role(auth.uid()) = 'agency')
    AND client_id IN (
      SELECT clients.id FROM public.clients
      WHERE clients.agency_id IN (SELECT profiles.agency_id FROM public.profiles WHERE profiles.id = auth.uid())
    )
  );
