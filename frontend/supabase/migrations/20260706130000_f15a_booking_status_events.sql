-- F15(a) — show-rate funnel: booking status-transition log.
--
-- The live `bookings` table (phase7a shape: ghl_appointment_id / appointment_time
-- / source / status) already carries the CURRENT status. This append-only log
-- records each transition (booked -> confirmed -> held/attended -> no_show /
-- cancelled) with its timestamp, so the weekly report can count what happened
-- IN a given week (not just the booking-created date) and the funnel has an
-- audit trail. bookings-webhook appends a row on every status change.
--
-- Only setter-created bookings are tracked (rows already exist in `bookings`);
-- GHL-native/manual appointments with no booking row are ignored (Decision 4).
--
-- Reads go through the get-show-rate-funnel edge fn (service role, role-branched),
-- so RLS is enabled with NO policies (service-role only) — the message_queue
-- pattern.

CREATE TABLE IF NOT EXISTS public.booking_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ghl_appointment_id text,
  from_status text,
  to_status text NOT NULL,
  source text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb
);

CREATE INDEX IF NOT EXISTS booking_status_events_client_time_idx
  ON public.booking_status_events (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS booking_status_events_appt_idx
  ON public.booking_status_events (client_id, ghl_appointment_id);

ALTER TABLE public.booking_status_events ENABLE ROW LEVEL SECURITY;
-- No policies: all access is via the get-show-rate-funnel / weekly-report edge
-- functions running as service role (mirrors message_queue).
