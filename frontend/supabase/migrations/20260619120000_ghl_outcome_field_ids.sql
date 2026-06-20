-- Phase: 6.12b GHL outcome sync
-- Per-client GHL custom-field ids for the full call-outcome suite (written by
-- retell-call-analysis-webhook on call_analyzed) and the SMS-conversation
-- analysis suite (written by analyze-sms-conversation). All nullable: when a
-- column is null the corresponding custom-field write is skipped. Store TEXT-
-- safe field ids only (existing TEXT field, or a dedicated `Setter *` / `Setter
-- SMS *` TEXT field) — plain-string writes to SINGLE_OPTIONS/CHECKBOX/DATE
-- fields silently fail; the type of each target is checked before wiring.
-- Idempotent: no-op where the column already exists.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ghl_call_outcome_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_call_summary_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_call_intent_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_lead_qualified_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_last_call_date_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_callback_requested_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_callback_datetime_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_appointment_datetime_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_sms_sentiment_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_sms_intent_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_sms_qualified_field_id text,
  ADD COLUMN IF NOT EXISTS ghl_sms_summary_field_id text;

COMMENT ON COLUMN public.clients.ghl_call_outcome_field_id IS 'GHL custom-field id for the call outcome label (Answered/Voicemail/No Answer/Error) — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_call_summary_field_id IS 'GHL custom-field id for the AI call summary — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_call_intent_field_id IS 'GHL custom-field id for the call intent (interested/not_interested) — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_lead_qualified_field_id IS 'GHL custom-field id for lead qualified (true/false) — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_last_call_date_field_id IS 'GHL custom-field id for last call date (ISO) — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_callback_requested_field_id IS 'GHL custom-field id for callback requested (true/false) — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_callback_datetime_field_id IS 'GHL custom-field id for the requested callback datetime (ISO) — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_appointment_datetime_field_id IS 'GHL custom-field id for the booked appointment datetime (ISO) — retell-call-analysis-webhook.';
COMMENT ON COLUMN public.clients.ghl_sms_sentiment_field_id IS 'GHL custom-field id for SMS-conversation sentiment — analyze-sms-conversation.';
COMMENT ON COLUMN public.clients.ghl_sms_intent_field_id IS 'GHL custom-field id for SMS-conversation intent — analyze-sms-conversation.';
COMMENT ON COLUMN public.clients.ghl_sms_qualified_field_id IS 'GHL custom-field id for SMS-conversation lead qualified — analyze-sms-conversation.';
COMMENT ON COLUMN public.clients.ghl_sms_summary_field_id IS 'GHL custom-field id for the SMS-conversation summary — analyze-sms-conversation.';

-- Watermark so analyze-sms-conversation only re-classifies a lead's SMS thread
-- when there is new activity since the last analysis (scan-mode debounce).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_sms_analyzed_at timestamptz;

COMMENT ON COLUMN public.leads.last_sms_analyzed_at IS 'Last time analyze-sms-conversation classified this lead''s SMS thread and wrote GHL outcome fields.';
