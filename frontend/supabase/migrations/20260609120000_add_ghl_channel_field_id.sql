-- Phase: onboarding-hardening-CA4
-- Captures clients.ghl_channel_field_id in migration history. The column already
-- exists in the live platform DB (bjgrgbgykvjrsuwwruoh) but was never recorded as
-- a migration, so a future schema regen could silently drop it. It is selected by
-- receive-twilio-sms (channel routing); when set, inbound SMS is routed via the
-- per-client GHL channel custom field. Idempotent: no-op where already present.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ghl_channel_field_id text;
