-- GATE A (part 3) — let a client-role user READ (and therefore UPDATE) its OWN clients row
-- without exposing any secret column.
--
-- Part 1 gated base `clients` SELECT to agency-only and added a client-own UPDATE policy. But under
-- PostgreSQL RLS an `UPDATE ... WHERE id = <own>` must locate the row via a SELECT policy; with no
-- client SELECT policy the client's own-row UPDATE matched 0 rows and its UI-state saves silently
-- no-op'd (proven by the throwaway probe: crm_filter_config write did not persist). Fix:
--   (a) add a client-own SELECT policy (its own row only), so the UPDATE can see the row; and
--   (b) restrict authenticated's SELECT to the 111 NON-secret columns (REVOKE the table-level SELECT
--       then GRANT column-level SELECT on the non-secret columns), so a client (or agency) can never
--       read a secret value from base clients directly — its own or a sibling's.
-- clients_public is security_definer (part 2), so it is unaffected by the column REVOKE (runs as the
-- owner). No browser path SELECTs base-clients secret columns (all secret reads are service-role edge
-- fns, which bypass grants) and secret WRITES via ApiCredentials use UPDATE (not revoked), so nothing
-- breaks. anon has no SELECT policy on clients at all (all policies are TO authenticated), so anon
-- already reads zero client rows and is left as-is. The part-1 guard trigger still freezes
-- subscription_status + the bundled infra keys for client-role writers.

CREATE POLICY "client_own_clients_select" ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'client'
    AND id = public.get_user_client_id(auth.uid())
  );

REVOKE SELECT ON public.clients FROM authenticated;
GRANT SELECT (
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
  crm_page_size,
  crm_column_widths,
  log_column_widths,
  sync_ghl_booking_enabled,
  what_to_do_acknowledged,
  ghl_conversation_link_field_id,
  stripe_customer_id,
  subscription_start_date,
  subscription_end_date,
  recording_disclosure_enabled,
  speed_to_lead_enabled,
  missed_call_textback_enabled
) ON public.clients TO authenticated;

NOTIFY pgrst, 'reload schema';
