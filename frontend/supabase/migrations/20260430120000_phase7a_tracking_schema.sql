-- 20260430120000_phase7a_tracking_schema.sql
-- Phase 7a (master rebuild) — tracking funnel + cadence engine prep schema.
-- Adds tables: lead_optouts, sms_delivery_events, cadence_metrics, bookings.
-- Adds clients columns: cadence_quiet_hours, intake_lead_secret,
--   voicemail_audio_url, ghl_webhook_secret, unipile_webhook_secret.
-- All idempotent; safe to re-run.

BEGIN;

-- ── lead_optouts (Phase 4a — STOP keyword handling) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  phone text NOT NULL,
  email text,
  source text,                -- 'sms_stop', 'manual', 'unsubscribe_link'
  raw_keyword text,           -- 'STOP', 'UNSUBSCRIBE', etc.
  created_at timestamptz DEFAULT now(),
  UNIQUE (client_id, phone)
);
CREATE INDEX IF NOT EXISTS lead_optouts_phone_idx
  ON public.lead_optouts (client_id, phone);

-- ── sms_delivery_events (Phase 7b — Twilio status callbacks) ────────────────
CREATE TABLE IF NOT EXISTS public.sms_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_message_sid text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL,       -- queued|sending|sent|delivered|failed|undelivered|read
  error_code int,
  error_message text,
  raw_payload jsonb,
  received_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_delivery_events_sid_idx
  ON public.sms_delivery_events (twilio_message_sid, received_at DESC);
CREATE INDEX IF NOT EXISTS sms_delivery_events_client_idx
  ON public.sms_delivery_events (client_id, received_at DESC);

-- ── cadence_metrics (Phase 7e — one row per engagement_executions) ──────────
CREATE TABLE IF NOT EXISTS public.cadence_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid REFERENCES public.engagement_executions(id) ON DELETE CASCADE UNIQUE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.engagement_workflows(id) ON DELETE SET NULL,
  lead_id text,
  nodes_fired int DEFAULT 0,
  sms_sent int DEFAULT 0,
  sms_delivered int DEFAULT 0,
  whatsapp_sent int DEFAULT 0,
  calls_attempted int DEFAULT 0,
  calls_picked_up int DEFAULT 0,
  voicemails_dropped int DEFAULT 0,
  reply_received boolean DEFAULT false,
  time_to_first_response_seconds int,
  booking_created boolean DEFAULT false,
  booking_id uuid,
  time_to_booking_seconds int,
  ended_at timestamptz,
  stop_reason text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cadence_metrics_client_idx
  ON public.cadence_metrics (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cadence_metrics_workflow_idx
  ON public.cadence_metrics (workflow_id, created_at DESC);

-- ── bookings (Phase 7a — first-class appointment ledger) ────────────────────
-- Created from scratch; nothing references this name yet on bfd-platform.
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_id text,                                -- GHL contact id (text, not UUID)
  cadence_execution_id uuid REFERENCES public.engagement_executions(id) ON DELETE SET NULL,
  ghl_appointment_id text,                     -- GHL Calendar Event id (idempotency key)
  ghl_calendar_id text,
  appointment_time timestamptz,
  appointment_end_time timestamptz,
  source text,                                  -- voice_call|manual|ghl_calendar|sms_link|intake_form
  status text DEFAULT 'confirmed',              -- confirmed|cancelled|no_show|attended
  notes text,
  raw_payload jsonb,                            -- last GHL webhook body for audit
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_id, ghl_appointment_id)
);
CREATE INDEX IF NOT EXISTS bookings_cadence_idx
  ON public.bookings (cadence_execution_id) WHERE cadence_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_lead_idx
  ON public.bookings (client_id, lead_id, appointment_time DESC);
CREATE INDEX IF NOT EXISTS bookings_status_idx
  ON public.bookings (client_id, status, appointment_time DESC);

-- ── clients column additions (gates for later phases) ──────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cadence_quiet_hours jsonb,
  ADD COLUMN IF NOT EXISTS intake_lead_secret text,
  ADD COLUMN IF NOT EXISTS voicemail_audio_url jsonb,
  ADD COLUMN IF NOT EXISTS ghl_webhook_secret text,
  ADD COLUMN IF NOT EXISTS unipile_webhook_secret text;

-- ── RLS — agency-scoped, matching pattern from 20260426100000 ──────────────

-- lead_optouts
ALTER TABLE public.lead_optouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_all_lead_optouts" ON public.lead_optouts;
CREATE POLICY "agency_all_lead_optouts" ON public.lead_optouts
  FOR ALL TO authenticated
  USING (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ))
  WITH CHECK (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ));

-- sms_delivery_events: backend-only writes; agency can SELECT
ALTER TABLE public.sms_delivery_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_select_sms_delivery_events" ON public.sms_delivery_events;
CREATE POLICY "agency_select_sms_delivery_events" ON public.sms_delivery_events
  FOR SELECT TO authenticated
  USING (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ));

-- cadence_metrics: backend-only writes; agency can SELECT
ALTER TABLE public.cadence_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_select_cadence_metrics" ON public.cadence_metrics;
CREATE POLICY "agency_select_cadence_metrics" ON public.cadence_metrics
  FOR SELECT TO authenticated
  USING (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ));

-- bookings: full agency CRUD (for the Bookings page)
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_all_bookings" ON public.bookings;
CREATE POLICY "agency_all_bookings" ON public.bookings
  FOR ALL TO authenticated
  USING (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ))
  WITH CHECK (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ));

-- ── updated_at trigger for bookings ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bookings_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_updated_at ON public.bookings;
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_set_updated_at();

COMMIT;
