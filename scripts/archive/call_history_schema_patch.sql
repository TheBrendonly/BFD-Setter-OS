-- call_history schema patch — add columns missing from bfd-platform
-- Run in: https://supabase.com/dashboard/project/bjgrgbgykvjrsuwwruoh/sql
-- These columns are required by retell-call-analysis-webhook edge function

ALTER TABLE public.call_history
  ADD COLUMN IF NOT EXISTS setter_id text,
  ADD COLUMN IF NOT EXISTS campaign_id text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS token_usage integer,
  ADD COLUMN IF NOT EXISTS voicemail_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_pickup boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_data jsonb,
  ADD COLUMN IF NOT EXISTS latency_ms jsonb,
  ADD COLUMN IF NOT EXISTS appointment_time timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
