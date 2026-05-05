-- phase-night-a4-bookings-webhook-tz-fix
--
-- Adds clients.timezone (default Australia/Sydney) so bookings-webhook can
-- parse the TZ-naive human-readable date strings GHL emits via workflow
-- merge tags. GHL workflow custom-webhook merge tags only expose
-- {{appointment.start_time}} / {{appointment.end_time}} as locale strings
-- like "Tuesday, 5 May 2026 8:43 PM" with no offset, rendered in the
-- location's wall clock. Without a known TZ, Postgres parses these as UTC,
-- shifting the stored appointment_time by ~10h for AU clients.
--
-- New tenants inherit Australia/Sydney by default. Configure per-tenant via
-- UPDATE clients SET timezone = '<IANA zone>' WHERE id = '<uuid>';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Australia/Sydney';
