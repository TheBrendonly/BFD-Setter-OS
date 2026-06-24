-- 20260624160000_clients_public_view.sql
-- Security (B5 / S1-1): the browser reads public.clients directly with the anon
-- key, and RLS on clients is ROW-level only (agency-scoped) with NO column
-- protection. So any authenticated agency user can .select() every secret
-- credential column straight into the browser, and select('*') returns them all.
--
-- Fix: a column-filtered read surface `clients_public` that OMITS the 13 secret
-- columns and instead exposes a non-secret has_<col> boolean for each, so
-- presence checks (readiness badge, Twilio-configured) work without the value.
-- Created WITH (security_invoker = on) so the existing per-user RLS on
-- public.clients is still evaluated as the CALLING user (agency sees its fleet,
-- client sees own row). Browser READ .select() calls repoint to this view;
-- WRITES and the genuinely-secret-needing flows continue to use public.clients
-- (the latter to be moved server-side to edge functions in a follow-up).
--
-- Safe columns are enumerated explicitly (NOT select *) so a future secret column
-- added to clients is excluded by default (fail-closed). The 13 omitted secrets:
--   supabase_service_key, supabase_access_token, twilio_auth_token,
--   openrouter_api_key, openrouter_management_key, openai_api_key, retell_api_key,
--   retell_webhook_secret, ghl_api_key, ghl_webhook_secret, intake_lead_secret,
--   elevenlabs_api_key, unipile_webhook_secret
-- Column list derived from live information_schema (project bjgrgbgykvjrsuwwruoh),
-- not types.ts (which carries drift columns the live DB does not have).

BEGIN;

DROP VIEW IF EXISTS public.clients_public;

CREATE VIEW public.clients_public
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
  (unipile_webhook_secret    IS NOT NULL AND unipile_webhook_secret    <> '') AS has_unipile_webhook_secret
FROM public.clients;

-- A view is a distinct object and inherits no grants; PostgREST needs SELECT.
GRANT SELECT ON public.clients_public TO anon, authenticated;

COMMIT;

-- Force PostgREST to pick up the new relation immediately.
NOTIFY pgrst, 'reload schema';
