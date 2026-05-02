-- Phase: night-ghl-push-gap-1
-- Adds per-client GHL custom field IDs for voice call analytics push.
-- When set, retell-call-analysis-webhook PATCHes last_call_sentiment and
-- last_call_appointment_booked on the GHL contact after every analyzed call.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ghl_call_sentiment_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_call_appt_booked_field_id text;
