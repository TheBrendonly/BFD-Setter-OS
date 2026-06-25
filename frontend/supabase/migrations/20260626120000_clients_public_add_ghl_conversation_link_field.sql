-- 20260626120000_clients_public_add_ghl_conversation_link_field.sql
-- F1 (Session 4): GHL -> BFD deep-link custom field.
-- sync-ghl-contact writes a "BFD Conversation Link" custom field onto the GHL
-- contact on lead create (the link points at /leads/<leads.id>, the BFD
-- conversation view). The target GHL custom-field id is held per client in the
-- new clients.ghl_conversation_link_field_id column, matching the existing
-- ghl_*_field_id pattern. The edge fn reads it with the service role on clients
-- directly; clients_public also enumerates the sibling field-id columns, so the
-- new (non-secret) column is appended there too to avoid a clients_public/types
-- drift. Idempotent: re-applying is a no-op (the project has no migration runner;
-- schema is applied via the Supabase Management API).

BEGIN;

-- 1) Base-table column (per-client GHL custom-field id; null = feature dormant).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ghl_conversation_link_field_id text;

-- 2) Re-publish clients_public with the new non-secret column appended. CREATE OR
--    REPLACE keeps every existing column in place (it only allows appending) and
--    preserves the security_invoker setting + existing grants. The column list is
--    reproduced verbatim from 20260625120000_clients_public_add_crm_ui_columns.sql.
CREATE OR REPLACE VIEW public.clients_public
  WITH (security_invoker = on) AS
SELECT
  id,
  ghl_location_id,
  ghl_send_setter_reply_webhook_url,
  send_followup_webhook_url,
  text_engine_webhook,
  debounce_seconds,
  llm_model,
  supabase_url,
  supabase_table_name,
  created_at,
  updated_at,
  name,
  email,
  description,
  agency_id,
  subscription_status,
  image_url,
  system_prompt,
  analytics_webhook_url,
  knowledge_base_add_webhook_url,
  knowledge_base_delete_webhook_url,
  prompt_webhook_url,
  ai_chat_webhook_url,
  transfer_to_human_webhook_url,
  user_details_webhook_url,
  twilio_account_sid,
  setup_guide_completed_steps,
  sort_order,
  presentation_only_mode,
  crm_filter_config,
  elevenlabs_agent_id,
  ghl_calendar_id,
  gohighlevel_booking_title,
  ghl_assignee_id,
  retell_inbound_agent_id,
  retell_outbound_agent_id,
  retell_outbound_followup_agent_id,
  retell_agent_id_4,
  retell_phone_1,
  retell_phone_1_country_code,
  retell_phone_2,
  retell_phone_2_country_code,
  retell_phone_3,
  retell_phone_3_country_code,
  api_webhook_url,
  campaign_webhook_url,
  chat_analytics_webhook_url,
  outbound_caller_webhook_1_url,
  outbound_caller_webhook_2_url,
  outbound_caller_webhook_3_url,
  save_reply_webhook_url,
  simulation_webhook,
  database_reactivation_inbound_webhook_url,
  lead_score_webhook_url,
  update_pipeline_webhook_url,
  send_message_webhook_url,
  send_engagement_webhook_url,
  twilio_default_phone,
  stop_bot_webhook_url,
  retell_agent_id_5,
  retell_agent_id_6,
  retell_agent_id_7,
  retell_agent_id_8,
  retell_agent_id_9,
  retell_agent_id_10,
  phone_call_webhook_url,
  dm_enabled,
  auto_engagement_workflow_id,
  use_native_text_engine,
  cadence_quiet_hours,
  voicemail_audio_url,
  ghl_last_synced_from_field_id,
  setter_display_names,
  ghl_conversation_provider_id,
  ghl_call_sentiment_field_id,
  ghl_call_appt_booked_field_id,
  timezone,
  sync_ghl_enabled,
  ghl_last_synced_from_field_value,
  voicemail_config,
  ghl_channel_field_id,
  try_gary_persona_slots,
  ai_meta_prompt,
  brand_voice,
  weekly_cost_ceiling_cents,
  monthly_cost_ceiling_cents,
  is_system,
  ghl_call_outcome_field_id,
  ghl_call_summary_field_id,
  ghl_call_intent_field_id,
  ghl_lead_qualified_field_id,
  ghl_last_call_date_field_id,
  ghl_callback_requested_field_id,
  ghl_callback_datetime_field_id,
  ghl_appointment_datetime_field_id,
  ghl_sms_sentiment_field_id,
  ghl_sms_intent_field_id,
  ghl_sms_qualified_field_id,
  ghl_sms_summary_field_id,
  -- Presence-only booleans (never the secret value):
  (supabase_service_key      IS NOT NULL AND supabase_service_key      <> '') AS has_supabase_service_key,
  (supabase_access_token     IS NOT NULL AND supabase_access_token     <> '') AS has_supabase_access_token,
  (twilio_auth_token         IS NOT NULL AND twilio_auth_token         <> '') AS has_twilio_auth_token,
  (openrouter_api_key        IS NOT NULL AND openrouter_api_key        <> '') AS has_openrouter_api_key,
  (openrouter_management_key IS NOT NULL AND openrouter_management_key <> '') AS has_openrouter_management_key,
  (openai_api_key            IS NOT NULL AND openai_api_key            <> '') AS has_openai_api_key,
  (retell_api_key            IS NOT NULL AND retell_api_key            <> '') AS has_retell_api_key,
  (retell_webhook_secret     IS NOT NULL AND retell_webhook_secret     <> '') AS has_retell_webhook_secret,
  (ghl_api_key               IS NOT NULL AND ghl_api_key               <> '') AS has_ghl_api_key,
  (ghl_webhook_secret        IS NOT NULL AND ghl_webhook_secret        <> '') AS has_ghl_webhook_secret,
  (intake_lead_secret        IS NOT NULL AND intake_lead_secret        <> '') AS has_intake_lead_secret,
  (elevenlabs_api_key        IS NOT NULL AND elevenlabs_api_key        <> '') AS has_elevenlabs_api_key,
  (unipile_webhook_secret    IS NOT NULL AND unipile_webhook_secret    <> '') AS has_unipile_webhook_secret,
  -- Non-secret UI-state columns (Session 2 drift fix):
  crm_page_size,
  crm_column_widths,
  log_column_widths,
  sync_ghl_booking_enabled,
  what_to_do_acknowledged,
  -- F1 (Session 4): non-secret GHL custom-field id for the BFD conversation link,
  -- appended at the end so CREATE OR REPLACE only adds and never reorders/drops:
  ghl_conversation_link_field_id
FROM public.clients;

-- A view inherits no grants; PostgREST needs SELECT (idempotent re-grant).
GRANT SELECT ON public.clients_public TO anon, authenticated;

COMMIT;

-- Force PostgREST to pick up the changed relation immediately.
NOTIFY pgrst, 'reload schema';
