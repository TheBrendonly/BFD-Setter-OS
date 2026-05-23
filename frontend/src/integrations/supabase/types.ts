export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      active_trigger_runs: {
        Row: {
          created_at: string | null
          ghl_account_id: string
          id: string
          lead_id: string
          trigger_run_id: string
        }
        Insert: {
          created_at?: string | null
          ghl_account_id: string
          id?: string
          lead_id: string
          trigger_run_id: string
        }
        Update: {
          created_at?: string | null
          ghl_account_id?: string
          id?: string
          lead_id?: string
          trigger_run_id?: string
        }
        Relationships: []
      }
      agent_settings: {
        Row: {
          booking_function_enabled: boolean | null
          booking_prompt: string | null
          client_id: string
          created_at: string
          file_processing_enabled: boolean | null
          followup_1_delay_seconds: number | null
          followup_2_delay_seconds: number | null
          followup_3_delay_seconds: number | null
          followup_cancellation_instructions: string | null
          followup_instructions: string | null
          followup_max_attempts: number | null
          human_transfer_enabled: boolean | null
          id: string
          last_deployed_prompt: string | null
          model: string | null
          name: string | null
          needs_external_sync: boolean
          response_delay_seconds: number | null
          slot_id: string
          updated_at: string
        }
        Insert: {
          booking_function_enabled?: boolean | null
          booking_prompt?: string | null
          client_id: string
          created_at?: string
          file_processing_enabled?: boolean | null
          followup_1_delay_seconds?: number | null
          followup_2_delay_seconds?: number | null
          followup_3_delay_seconds?: number | null
          followup_cancellation_instructions?: string | null
          followup_instructions?: string | null
          followup_max_attempts?: number | null
          human_transfer_enabled?: boolean | null
          id?: string
          last_deployed_prompt?: string | null
          model?: string | null
          name?: string | null
          needs_external_sync?: boolean
          response_delay_seconds?: number | null
          slot_id: string
          updated_at?: string
        }
        Update: {
          booking_function_enabled?: boolean | null
          booking_prompt?: string | null
          client_id?: string
          created_at?: string
          file_processing_enabled?: boolean | null
          followup_1_delay_seconds?: number | null
          followup_2_delay_seconds?: number | null
          followup_3_delay_seconds?: number | null
          followup_cancellation_instructions?: string | null
          followup_instructions?: string | null
          followup_max_attempts?: number | null
          human_transfer_enabled?: boolean | null
          id?: string
          last_deployed_prompt?: string | null
          model?: string | null
          name?: string | null
          needs_external_sync?: boolean
          response_delay_seconds?: number | null
          slot_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generation_jobs: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          input_payload: Json | null
          job_type: string
          raw_exchanges: Json | null
          result: Json | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_payload?: Json | null
          job_type: string
          raw_exchanges?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_payload?: Json | null
          job_type?: string
          raw_exchanges?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      analytics_chat_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          message_type: string | null
          metadata: Json | null
          role: string
          thread_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "analytics_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_chat_threads: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_chat_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_executions: {
        Row: {
          client_id: string
          completed_at: string | null
          end_date: string | null
          error_message: string | null
          id: string
          stage_description: string | null
          start_date: string | null
          started_at: string | null
          status: string | null
          time_range: string | null
          trigger_run_id: string | null
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          end_date?: string | null
          error_message?: string | null
          id?: string
          stage_description?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: string | null
          time_range?: string | null
          trigger_run_id?: string | null
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          end_date?: string | null
          error_message?: string | null
          id?: string
          stage_description?: string | null
          start_date?: string | null
          started_at?: string | null
          status?: string | null
          time_range?: string | null
          trigger_run_id?: string | null
        }
        Relationships: []
      }
      analytics_results: {
        Row: {
          client_id: string
          conversations_list: Json
          created_at: string | null
          default_metrics: Json
          execution_id: string
          id: string
          summary: Json
          widgets: Json
        }
        Insert: {
          client_id: string
          conversations_list?: Json
          created_at?: string | null
          default_metrics?: Json
          execution_id: string
          id?: string
          summary?: Json
          widgets?: Json
        }
        Update: {
          client_id?: string
          conversations_list?: Json
          created_at?: string | null
          default_metrics?: Json
          execution_id?: string
          id?: string
          summary?: Json
          widgets?: Json
        }
        Relationships: [
          {
            foreignKeyName: "analytics_results_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "analytics_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          calendar_id: string | null
          campaign_id: string | null
          cancellation_link: string | null
          client_id: string
          created_at: string
          end_time: string | null
          ghl_booking_id: string | null
          ghl_contact_id: string | null
          id: string
          lead_id: string | null
          location: string | null
          notes: string | null
          raw_ghl_data: Json | null
          reschedule_link: string | null
          setter_name: string | null
          setter_type: string | null
          start_time: string | null
          status: string
          title: string | null
        }
        Insert: {
          calendar_id?: string | null
          campaign_id?: string | null
          cancellation_link?: string | null
          client_id: string
          created_at?: string
          end_time?: string | null
          ghl_booking_id?: string | null
          ghl_contact_id?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          notes?: string | null
          raw_ghl_data?: Json | null
          reschedule_link?: string | null
          setter_name?: string | null
          setter_type?: string | null
          start_time?: string | null
          status?: string
          title?: string | null
        }
        Update: {
          calendar_id?: string | null
          campaign_id?: string | null
          cancellation_link?: string | null
          client_id?: string
          created_at?: string
          end_time?: string | null
          ghl_booking_id?: string | null
          ghl_contact_id?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          notes?: string | null
          raw_ghl_data?: Json | null
          reschedule_link?: string | null
          setter_name?: string | null
          setter_type?: string | null
          start_time?: string | null
          status?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "engagement_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          anyone_can_add_self: boolean | null
          attachments: Json | null
          attendees: Json | null
          attendees_omitted: boolean | null
          calendar_id: string | null
          categories: Json | null
          client_id: string
          color_hex: string | null
          color_id: string | null
          conference_data: Json | null
          created_at: string
          creator_email: string | null
          creator_name: string | null
          description: string | null
          end_date: string | null
          end_datetime: string | null
          end_time_unspecified: boolean | null
          end_timezone: string | null
          etag: string | null
          extended_properties: Json | null
          external_event_id: string | null
          guests_can_invite_others: boolean | null
          guests_can_modify: boolean | null
          guests_can_see_other_guests: boolean | null
          hangout_link: string | null
          has_attachments: boolean | null
          html_link: string | null
          ical_uid: string | null
          id: string
          importance: string | null
          is_all_day: boolean | null
          is_attendees_list_hidden: boolean | null
          is_cancelled: boolean | null
          is_locked: boolean | null
          is_online_meeting: boolean | null
          is_organizer: boolean | null
          is_private_copy: boolean | null
          is_reminder_on: boolean | null
          lead_id: string | null
          location: string | null
          master_event_id: string | null
          online_meeting_provider: string | null
          online_meeting_url: string | null
          organizer_email: string | null
          organizer_is_self: boolean | null
          organizer_name: string | null
          original_start_datetime: string | null
          original_start_timezone: string | null
          provider: string
          provider_created_at: string | null
          provider_metadata: Json | null
          provider_updated_at: string | null
          recurrence: Json | null
          recurring_event_id: string | null
          reminder_minutes: number | null
          reminders: Json | null
          response_status: string | null
          sensitivity: string | null
          sequence: number | null
          show_as: string | null
          start_date: string | null
          start_datetime: string | null
          start_timezone: string | null
          status: string | null
          synced_at: string | null
          title: string | null
          transparency: string | null
          unipile_account_id: string
          unipile_event_id: string
          updated_at: string
          visibility: string | null
          web_link: string | null
        }
        Insert: {
          anyone_can_add_self?: boolean | null
          attachments?: Json | null
          attendees?: Json | null
          attendees_omitted?: boolean | null
          calendar_id?: string | null
          categories?: Json | null
          client_id: string
          color_hex?: string | null
          color_id?: string | null
          conference_data?: Json | null
          created_at?: string
          creator_email?: string | null
          creator_name?: string | null
          description?: string | null
          end_date?: string | null
          end_datetime?: string | null
          end_time_unspecified?: boolean | null
          end_timezone?: string | null
          etag?: string | null
          extended_properties?: Json | null
          external_event_id?: string | null
          guests_can_invite_others?: boolean | null
          guests_can_modify?: boolean | null
          guests_can_see_other_guests?: boolean | null
          hangout_link?: string | null
          has_attachments?: boolean | null
          html_link?: string | null
          ical_uid?: string | null
          id?: string
          importance?: string | null
          is_all_day?: boolean | null
          is_attendees_list_hidden?: boolean | null
          is_cancelled?: boolean | null
          is_locked?: boolean | null
          is_online_meeting?: boolean | null
          is_organizer?: boolean | null
          is_private_copy?: boolean | null
          is_reminder_on?: boolean | null
          lead_id?: string | null
          location?: string | null
          master_event_id?: string | null
          online_meeting_provider?: string | null
          online_meeting_url?: string | null
          organizer_email?: string | null
          organizer_is_self?: boolean | null
          organizer_name?: string | null
          original_start_datetime?: string | null
          original_start_timezone?: string | null
          provider?: string
          provider_created_at?: string | null
          provider_metadata?: Json | null
          provider_updated_at?: string | null
          recurrence?: Json | null
          recurring_event_id?: string | null
          reminder_minutes?: number | null
          reminders?: Json | null
          response_status?: string | null
          sensitivity?: string | null
          sequence?: number | null
          show_as?: string | null
          start_date?: string | null
          start_datetime?: string | null
          start_timezone?: string | null
          status?: string | null
          synced_at?: string | null
          title?: string | null
          transparency?: string | null
          unipile_account_id: string
          unipile_event_id: string
          updated_at?: string
          visibility?: string | null
          web_link?: string | null
        }
        Update: {
          anyone_can_add_self?: boolean | null
          attachments?: Json | null
          attendees?: Json | null
          attendees_omitted?: boolean | null
          calendar_id?: string | null
          categories?: Json | null
          client_id?: string
          color_hex?: string | null
          color_id?: string | null
          conference_data?: Json | null
          created_at?: string
          creator_email?: string | null
          creator_name?: string | null
          description?: string | null
          end_date?: string | null
          end_datetime?: string | null
          end_time_unspecified?: boolean | null
          end_timezone?: string | null
          etag?: string | null
          extended_properties?: Json | null
          external_event_id?: string | null
          guests_can_invite_others?: boolean | null
          guests_can_modify?: boolean | null
          guests_can_see_other_guests?: boolean | null
          hangout_link?: string | null
          has_attachments?: boolean | null
          html_link?: string | null
          ical_uid?: string | null
          id?: string
          importance?: string | null
          is_all_day?: boolean | null
          is_attendees_list_hidden?: boolean | null
          is_cancelled?: boolean | null
          is_locked?: boolean | null
          is_online_meeting?: boolean | null
          is_organizer?: boolean | null
          is_private_copy?: boolean | null
          is_reminder_on?: boolean | null
          lead_id?: string | null
          location?: string | null
          master_event_id?: string | null
          online_meeting_provider?: string | null
          online_meeting_url?: string | null
          organizer_email?: string | null
          organizer_is_self?: boolean | null
          organizer_name?: string | null
          original_start_datetime?: string | null
          original_start_timezone?: string | null
          provider?: string
          provider_created_at?: string | null
          provider_metadata?: Json | null
          provider_updated_at?: string | null
          recurrence?: Json | null
          recurring_event_id?: string | null
          reminder_minutes?: number | null
          reminders?: Json | null
          response_status?: string | null
          sensitivity?: string | null
          sequence?: number | null
          show_as?: string | null
          start_date?: string | null
          start_datetime?: string | null
          start_timezone?: string | null
          status?: string | null
          synced_at?: string | null
          title?: string | null
          transparency?: string | null
          unipile_account_id?: string
          unipile_event_id?: string
          updated_at?: string
          visibility?: string | null
          web_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_contact_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      call_history: {
        Row: {
          agent_id: string | null
          appointment_booked: boolean | null
          appointment_time: string | null
          call_id: string
          call_status: string | null
          call_successful: boolean | null
          call_summary: string | null
          call_type: string | null
          campaign_id: string | null
          client_id: string | null
          contact_id: string | null
          contact_name: string | null
          cost: number | null
          created_at: string
          custom_analysis_data: Json | null
          custom_data: Json | null
          direction: string | null
          disconnect_reason: string | null
          duration_ms: number | null
          duration_seconds: number | null
          end_timestamp: string | null
          from_number: string | null
          ghl_account_id: string | null
          human_pickup: boolean | null
          id: string
          latency_ms: Json | null
          pre_call_context: Json | null
          public_log_url: string | null
          raw_payload: Json | null
          recording_url: string | null
          setter_id: string | null
          start_timestamp: string | null
          to_number: string | null
          token_usage: number | null
          transcript: string | null
          transcript_object: Json | null
          updated_at: string
          user_sentiment: string | null
          voicemail_detected: boolean | null
        }
        Insert: {
          agent_id?: string | null
          appointment_booked?: boolean | null
          appointment_time?: string | null
          call_id: string
          call_status?: string | null
          call_successful?: boolean | null
          call_summary?: string | null
          call_type?: string | null
          campaign_id?: string | null
          client_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          cost?: number | null
          created_at?: string
          custom_analysis_data?: Json | null
          custom_data?: Json | null
          direction?: string | null
          disconnect_reason?: string | null
          duration_ms?: number | null
          duration_seconds?: number | null
          end_timestamp?: string | null
          from_number?: string | null
          ghl_account_id?: string | null
          human_pickup?: boolean | null
          id?: string
          latency_ms?: Json | null
          pre_call_context?: Json | null
          public_log_url?: string | null
          raw_payload?: Json | null
          recording_url?: string | null
          setter_id?: string | null
          start_timestamp?: string | null
          to_number?: string | null
          token_usage?: number | null
          transcript?: string | null
          transcript_object?: Json | null
          updated_at?: string
          user_sentiment?: string | null
          voicemail_detected?: boolean | null
        }
        Update: {
          agent_id?: string | null
          appointment_booked?: boolean | null
          appointment_time?: string | null
          call_id?: string
          call_status?: string | null
          call_successful?: boolean | null
          call_summary?: string | null
          call_type?: string | null
          campaign_id?: string | null
          client_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          cost?: number | null
          created_at?: string
          custom_analysis_data?: Json | null
          custom_data?: Json | null
          direction?: string | null
          disconnect_reason?: string | null
          duration_ms?: number | null
          duration_seconds?: number | null
          end_timestamp?: string | null
          from_number?: string | null
          ghl_account_id?: string | null
          human_pickup?: boolean | null
          id?: string
          latency_ms?: Json | null
          pre_call_context?: Json | null
          public_log_url?: string | null
          raw_payload?: Json | null
          recording_url?: string | null
          setter_id?: string | null
          start_timestamp?: string | null
          to_number?: string | null
          token_usage?: number | null
          transcript?: string | null
          transcript_object?: Json | null
          updated_at?: string
          user_sentiment?: string | null
          voicemail_detected?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "call_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_events: {
        Row: {
          campaign_id: string
          channel: string | null
          client_id: string
          event_type: string
          execution_id: string | null
          id: string
          lead_id: string
          metadata: Json | null
          node_id: string | null
          node_index: number | null
          occurred_at: string
        }
        Insert: {
          campaign_id: string
          channel?: string | null
          client_id: string
          event_type: string
          execution_id?: string | null
          id?: string
          lead_id: string
          metadata?: Json | null
          node_id?: string | null
          node_index?: number | null
          occurred_at?: string
        }
        Update: {
          campaign_id?: string
          channel?: string | null
          client_id?: string
          event_type?: string
          execution_id?: string | null
          id?: string
          lead_id?: string
          metadata?: Json | null
          node_id?: string | null
          node_index?: number | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "engagement_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "engagement_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          campaign_id: string | null
          created_at: string
          error_message: string | null
          id: string
          lead_data: Json | null
          processed_at: string | null
          scheduled_for: string | null
          status: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_data?: Json | null
          processed_at?: string | null
          scheduled_for?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_data?: Json | null
          processed_at?: string | null
          scheduled_for?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          batch_interval_minutes: number | null
          batch_size: number | null
          campaign_name: string
          client_id: string | null
          created_at: string
          days_of_week: number[] | null
          end_time: string | null
          id: string
          lead_delay_seconds: number | null
          processed_leads: number | null
          reactivation_notes: string | null
          start_time: string | null
          status: string
          timezone: string | null
          total_leads: number | null
          updated_at: string
          user_id: string | null
          webhook_url: string | null
        }
        Insert: {
          batch_interval_minutes?: number | null
          batch_size?: number | null
          campaign_name: string
          client_id?: string | null
          created_at?: string
          days_of_week?: number[] | null
          end_time?: string | null
          id?: string
          lead_delay_seconds?: number | null
          processed_leads?: number | null
          reactivation_notes?: string | null
          start_time?: string | null
          status?: string
          timezone?: string | null
          total_leads?: number | null
          updated_at?: string
          user_id?: string | null
          webhook_url?: string | null
        }
        Update: {
          batch_interval_minutes?: number | null
          batch_size?: number | null
          campaign_name?: string
          client_id?: string | null
          created_at?: string
          days_of_week?: number[] | null
          end_time?: string | null
          id?: string
          lead_delay_seconds?: number | null
          processed_leads?: number | null
          reactivation_notes?: string | null
          start_time?: string | null
          status?: string
          timezone?: string | null
          total_leads?: number | null
          updated_at?: string
          user_id?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_analytics: {
        Row: {
          client_id: string | null
          id: string
          last_updated: string
          metrics: Json | null
          time_range: string
        }
        Insert: {
          client_id?: string | null
          id?: string
          last_updated?: string
          metrics?: Json | null
          time_range: string
        }
        Update: {
          client_id?: string | null
          id?: string
          last_updated?: string
          metrics?: Json | null
          time_range?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_analytics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_analytics_messages: {
        Row: {
          client_id: string | null
          content: string | null
          id: string
          role: string
          timestamp: string
        }
        Insert: {
          client_id?: string | null
          content?: string | null
          id?: string
          role?: string
          timestamp?: string
        }
        Update: {
          client_id?: string | null
          content?: string | null
          id?: string
          role?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_analytics_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_read_status: {
        Row: {
          client_id: string
          created_at: string
          id: string
          last_read_at: string
          lead_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          last_read_at?: string
          lead_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          last_read_at?: string
          lead_id?: string
        }
        Relationships: []
      }
      chat_starred: {
        Row: {
          client_id: string
          created_at: string
          id: string
          lead_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          lead_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          lead_id?: string
        }
        Relationships: []
      }
      client_custom_fields: {
        Row: {
          client_id: string
          created_at: string
          field_name: string
          id: string
          sort_order: number
        }
        Insert: {
          client_id: string
          created_at?: string
          field_name: string
          id?: string
          sort_order?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          field_name?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_custom_fields_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_menu_config: {
        Row: {
          client_id: string
          created_at: string
          id: string
          menu_items: Json
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          menu_items?: Json
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          menu_items?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_menu_config_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portals: {
        Row: {
          client_id: string | null
          created_at: string
          deployment_slug: string | null
          id: string
          is_published: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          deployment_slug?: string | null
          id?: string
          is_published?: boolean | null
          name?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          deployment_slug?: string | null
          id?: string
          is_published?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          agency_id: string | null
          ai_chat_webhook_url: string | null
          analytics_webhook_url: string | null
          api_webhook_url: string | null
          auto_engagement_workflow_id: string | null
          cadence_quiet_hours: Json | null
          campaign_webhook_url: string | null
          chat_analytics_webhook_url: string | null
          created_at: string
          crm_column_widths: Json | null
          crm_filter_config: Json | null
          crm_page_size: number
          database_reactivation_inbound_webhook_url: string | null
          debounce_seconds: number | null
          description: string | null
          dm_debounce_seconds: number | null
          dm_enabled: boolean | null
          elevenlabs_agent_config: Json | null
          elevenlabs_agent_id: string | null
          elevenlabs_api_key: string | null
          elevenlabs_kb_doc_id: string | null
          elevenlabs_phone_number_id: string | null
          email: string | null
          ghl_api_key: string | null
          ghl_assignee_id: string | null
          ghl_calendar_id: string | null
          ghl_call_appt_booked_field_id: string | null
          ghl_call_sentiment_field_id: string | null
          ghl_conversation_provider_id: string | null
          ghl_last_synced_from_field_id: string | null
          ghl_last_synced_from_field_value: string | null
          ghl_location_id: string | null
          ghl_send_setter_reply_webhook_url: string | null
          ghl_webhook_secret: string | null
          gohighlevel_booking_title: string | null
          id: string
          image_url: string | null
          intake_lead_secret: string | null
          knowledge_base_add_webhook_url: string | null
          knowledge_base_delete_webhook_url: string | null
          last_retry_date: string | null
          lead_score_webhook_url: string | null
          llm_model: string | null
          log_column_widths: Json | null
          name: string
          openai_api_key: string | null
          openrouter_api_key: string | null
          openrouter_management_key: string | null
          outbound_caller_webhook_1_url: string | null
          outbound_caller_webhook_2_url: string | null
          outbound_caller_webhook_3_url: string | null
          payment_failed_date: string | null
          phone_call_webhook_url: string | null
          presentation_only_mode: boolean | null
          prompt_webhook_url: string | null
          retell_agent_id_10: string | null
          retell_agent_id_4: string | null
          retell_agent_id_5: string | null
          retell_agent_id_6: string | null
          retell_agent_id_7: string | null
          retell_agent_id_8: string | null
          retell_agent_id_9: string | null
          retell_api_key: string | null
          retell_inbound_agent_id: string | null
          retell_outbound_agent_id: string | null
          retell_outbound_followup_agent_id: string | null
          retell_phone_1: string | null
          retell_phone_1_country_code: string | null
          retell_phone_2: string | null
          retell_phone_2_country_code: string | null
          retell_phone_3: string | null
          retell_phone_3_country_code: string | null
          retell_webhook_secret: string | null
          retry_count: number | null
          save_reply_webhook_url: string | null
          send_engagement_webhook_url: string | null
          send_followup_webhook_url: string | null
          send_message_webhook_url: string | null
          send_whatsapp_webhook_url: string | null
          setter_config_last_generated_at: string | null
          setter_display_names: Json | null
          setup_guide_completed_steps: Json | null
          simulation_webhook: string | null
          sort_order: number | null
          stop_bot_webhook_url: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_end_date: string | null
          subscription_start_date: string | null
          subscription_status: string
          supabase_access_token: string | null
          supabase_service_key: string | null
          supabase_table_name: string | null
          supabase_url: string | null
          sync_ghl_booking_enabled: boolean | null
          sync_ghl_enabled: boolean | null
          system_prompt: string | null
          text_engine_webhook: string | null
          timezone: string
          transfer_to_human_webhook_url: string | null
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          twilio_default_phone: string | null
          unipile_webhook_secret: string | null
          update_pipeline_webhook_url: string | null
          updated_at: string
          use_native_text_engine: boolean
          user_details_webhook_url: string | null
          voicemail_audio_url: Json | null
          voicemail_config: Json | null
          what_to_do_acknowledged: boolean | null
        }
        Insert: {
          agency_id?: string | null
          ai_chat_webhook_url?: string | null
          analytics_webhook_url?: string | null
          api_webhook_url?: string | null
          auto_engagement_workflow_id?: string | null
          cadence_quiet_hours?: Json | null
          campaign_webhook_url?: string | null
          chat_analytics_webhook_url?: string | null
          created_at?: string
          crm_column_widths?: Json | null
          crm_filter_config?: Json | null
          crm_page_size?: number
          database_reactivation_inbound_webhook_url?: string | null
          debounce_seconds?: number | null
          description?: string | null
          dm_debounce_seconds?: number | null
          dm_enabled?: boolean | null
          elevenlabs_agent_config?: Json | null
          elevenlabs_agent_id?: string | null
          elevenlabs_api_key?: string | null
          elevenlabs_kb_doc_id?: string | null
          elevenlabs_phone_number_id?: string | null
          email?: string | null
          ghl_api_key?: string | null
          ghl_assignee_id?: string | null
          ghl_calendar_id?: string | null
          ghl_call_appt_booked_field_id?: string | null
          ghl_call_sentiment_field_id?: string | null
          ghl_conversation_provider_id?: string | null
          ghl_last_synced_from_field_id?: string | null
          ghl_last_synced_from_field_value?: string | null
          ghl_location_id?: string | null
          ghl_send_setter_reply_webhook_url?: string | null
          ghl_webhook_secret?: string | null
          gohighlevel_booking_title?: string | null
          id?: string
          image_url?: string | null
          intake_lead_secret?: string | null
          knowledge_base_add_webhook_url?: string | null
          knowledge_base_delete_webhook_url?: string | null
          last_retry_date?: string | null
          lead_score_webhook_url?: string | null
          llm_model?: string | null
          log_column_widths?: Json | null
          name: string
          openai_api_key?: string | null
          openrouter_api_key?: string | null
          openrouter_management_key?: string | null
          outbound_caller_webhook_1_url?: string | null
          outbound_caller_webhook_2_url?: string | null
          outbound_caller_webhook_3_url?: string | null
          payment_failed_date?: string | null
          phone_call_webhook_url?: string | null
          presentation_only_mode?: boolean | null
          prompt_webhook_url?: string | null
          retell_agent_id_10?: string | null
          retell_agent_id_4?: string | null
          retell_agent_id_5?: string | null
          retell_agent_id_6?: string | null
          retell_agent_id_7?: string | null
          retell_agent_id_8?: string | null
          retell_agent_id_9?: string | null
          retell_api_key?: string | null
          retell_inbound_agent_id?: string | null
          retell_outbound_agent_id?: string | null
          retell_outbound_followup_agent_id?: string | null
          retell_phone_1?: string | null
          retell_phone_1_country_code?: string | null
          retell_phone_2?: string | null
          retell_phone_2_country_code?: string | null
          retell_phone_3?: string | null
          retell_phone_3_country_code?: string | null
          retell_webhook_secret?: string | null
          retry_count?: number | null
          save_reply_webhook_url?: string | null
          send_engagement_webhook_url?: string | null
          send_followup_webhook_url?: string | null
          send_message_webhook_url?: string | null
          send_whatsapp_webhook_url?: string | null
          setter_config_last_generated_at?: string | null
          setter_display_names?: Json | null
          setup_guide_completed_steps?: Json | null
          simulation_webhook?: string | null
          sort_order?: number | null
          stop_bot_webhook_url?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          subscription_status?: string
          supabase_access_token?: string | null
          supabase_service_key?: string | null
          supabase_table_name?: string | null
          supabase_url?: string | null
          sync_ghl_booking_enabled?: boolean | null
          sync_ghl_enabled?: boolean | null
          system_prompt?: string | null
          text_engine_webhook?: string | null
          timezone?: string
          transfer_to_human_webhook_url?: string | null
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_default_phone?: string | null
          unipile_webhook_secret?: string | null
          update_pipeline_webhook_url?: string | null
          updated_at?: string
          use_native_text_engine?: boolean
          user_details_webhook_url?: string | null
          voicemail_audio_url?: Json | null
          voicemail_config?: Json | null
          what_to_do_acknowledged?: boolean | null
        }
        Update: {
          agency_id?: string | null
          ai_chat_webhook_url?: string | null
          analytics_webhook_url?: string | null
          api_webhook_url?: string | null
          auto_engagement_workflow_id?: string | null
          cadence_quiet_hours?: Json | null
          campaign_webhook_url?: string | null
          chat_analytics_webhook_url?: string | null
          created_at?: string
          crm_column_widths?: Json | null
          crm_filter_config?: Json | null
          crm_page_size?: number
          database_reactivation_inbound_webhook_url?: string | null
          debounce_seconds?: number | null
          description?: string | null
          dm_debounce_seconds?: number | null
          dm_enabled?: boolean | null
          elevenlabs_agent_config?: Json | null
          elevenlabs_agent_id?: string | null
          elevenlabs_api_key?: string | null
          elevenlabs_kb_doc_id?: string | null
          elevenlabs_phone_number_id?: string | null
          email?: string | null
          ghl_api_key?: string | null
          ghl_assignee_id?: string | null
          ghl_calendar_id?: string | null
          ghl_call_appt_booked_field_id?: string | null
          ghl_call_sentiment_field_id?: string | null
          ghl_conversation_provider_id?: string | null
          ghl_last_synced_from_field_id?: string | null
          ghl_last_synced_from_field_value?: string | null
          ghl_location_id?: string | null
          ghl_send_setter_reply_webhook_url?: string | null
          ghl_webhook_secret?: string | null
          gohighlevel_booking_title?: string | null
          id?: string
          image_url?: string | null
          intake_lead_secret?: string | null
          knowledge_base_add_webhook_url?: string | null
          knowledge_base_delete_webhook_url?: string | null
          last_retry_date?: string | null
          lead_score_webhook_url?: string | null
          llm_model?: string | null
          log_column_widths?: Json | null
          name?: string
          openai_api_key?: string | null
          openrouter_api_key?: string | null
          openrouter_management_key?: string | null
          outbound_caller_webhook_1_url?: string | null
          outbound_caller_webhook_2_url?: string | null
          outbound_caller_webhook_3_url?: string | null
          payment_failed_date?: string | null
          phone_call_webhook_url?: string | null
          presentation_only_mode?: boolean | null
          prompt_webhook_url?: string | null
          retell_agent_id_10?: string | null
          retell_agent_id_4?: string | null
          retell_agent_id_5?: string | null
          retell_agent_id_6?: string | null
          retell_agent_id_7?: string | null
          retell_agent_id_8?: string | null
          retell_agent_id_9?: string | null
          retell_api_key?: string | null
          retell_inbound_agent_id?: string | null
          retell_outbound_agent_id?: string | null
          retell_outbound_followup_agent_id?: string | null
          retell_phone_1?: string | null
          retell_phone_1_country_code?: string | null
          retell_phone_2?: string | null
          retell_phone_2_country_code?: string | null
          retell_phone_3?: string | null
          retell_phone_3_country_code?: string | null
          retell_webhook_secret?: string | null
          retry_count?: number | null
          save_reply_webhook_url?: string | null
          send_engagement_webhook_url?: string | null
          send_followup_webhook_url?: string | null
          send_message_webhook_url?: string | null
          send_whatsapp_webhook_url?: string | null
          setter_config_last_generated_at?: string | null
          setter_display_names?: Json | null
          setup_guide_completed_steps?: Json | null
          simulation_webhook?: string | null
          sort_order?: number | null
          stop_bot_webhook_url?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          subscription_status?: string
          supabase_access_token?: string | null
          supabase_service_key?: string | null
          supabase_table_name?: string | null
          supabase_url?: string | null
          sync_ghl_booking_enabled?: boolean | null
          sync_ghl_enabled?: boolean | null
          system_prompt?: string | null
          text_engine_webhook?: string | null
          timezone?: string
          transfer_to_human_webhook_url?: string | null
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_default_phone?: string | null
          unipile_webhook_secret?: string | null
          update_pipeline_webhook_url?: string | null
          updated_at?: string
          use_native_text_engine?: boolean
          user_details_webhook_url?: string | null
          voicemail_audio_url?: Json | null
          voicemail_config?: Json | null
          what_to_do_acknowledged?: boolean | null
        }
        Relationships: []
      }
      custom_metrics: {
        Row: {
          analytics_type: string
          campaign_id: string | null
          client_id: string | null
          color: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          prompt: string | null
          sort_order: number | null
          updated_at: string
          widget_type: string
          widget_width: string
        }
        Insert: {
          analytics_type?: string
          campaign_id?: string | null
          client_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          prompt?: string | null
          sort_order?: number | null
          updated_at?: string
          widget_type?: string
          widget_width?: string
        }
        Update: {
          analytics_type?: string
          campaign_id?: string | null
          client_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          prompt?: string | null
          sort_order?: number | null
          updated_at?: string
          widget_type?: string
          widget_width?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "engagement_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_widgets: {
        Row: {
          analytics_type: string
          campaign_id: string | null
          client_id: string | null
          config: Json
          created_at: string
          friendly_name: string | null
          id: string
          is_active: boolean | null
          sort_order: number | null
          title: string
          updated_at: string
          widget_type: string
          width: string
        }
        Insert: {
          analytics_type?: string
          campaign_id?: string | null
          client_id?: string | null
          config?: Json
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean | null
          sort_order?: number | null
          title: string
          updated_at?: string
          widget_type?: string
          width?: string
        }
        Update: {
          analytics_type?: string
          campaign_id?: string | null
          client_id?: string | null
          config?: Json
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean | null
          sort_order?: number | null
          title?: string
          updated_at?: string
          widget_type?: string
          width?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "engagement_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_page_contacts: {
        Row: {
          client_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          phone_number: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone_number: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_page_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_pages: {
        Row: {
          chat_widget_code: string | null
          chatbot_section_subtitle: string | null
          chatbot_section_title: string | null
          client_id: string | null
          created_at: string
          creatives: Json | null
          creatives_page_logo: string | null
          creatives_page_name: string | null
          creatives_section_subtitle: string | null
          creatives_section_title: string | null
          form_ai_subtitle: string | null
          form_ai_title: string | null
          form_ai_webhook_url: string | null
          header_logo_url: string | null
          id: string
          intro_subtitle: string | null
          intro_title: string | null
          is_published: boolean | null
          phone_call_webhook_url: string | null
          published_sections: Json | null
          sections: Json | null
          slug: string | null
          text_ai_enabled_platforms: string[] | null
          text_ai_subtitle: string | null
          text_ai_title: string | null
          text_ai_webhook_url: string | null
          title: string
          updated_at: string
          voice_call_enabled: boolean | null
          voice_phone_country_code: string | null
          voice_phone_number: string | null
          voice_section_subtitle: string | null
          voice_section_title: string | null
          webhook_url: string | null
        }
        Insert: {
          chat_widget_code?: string | null
          chatbot_section_subtitle?: string | null
          chatbot_section_title?: string | null
          client_id?: string | null
          created_at?: string
          creatives?: Json | null
          creatives_page_logo?: string | null
          creatives_page_name?: string | null
          creatives_section_subtitle?: string | null
          creatives_section_title?: string | null
          form_ai_subtitle?: string | null
          form_ai_title?: string | null
          form_ai_webhook_url?: string | null
          header_logo_url?: string | null
          id?: string
          intro_subtitle?: string | null
          intro_title?: string | null
          is_published?: boolean | null
          phone_call_webhook_url?: string | null
          published_sections?: Json | null
          sections?: Json | null
          slug?: string | null
          text_ai_enabled_platforms?: string[] | null
          text_ai_subtitle?: string | null
          text_ai_title?: string | null
          text_ai_webhook_url?: string | null
          title?: string
          updated_at?: string
          voice_call_enabled?: boolean | null
          voice_phone_country_code?: string | null
          voice_phone_number?: string | null
          voice_section_subtitle?: string | null
          voice_section_title?: string | null
          webhook_url?: string | null
        }
        Update: {
          chat_widget_code?: string | null
          chatbot_section_subtitle?: string | null
          chatbot_section_title?: string | null
          client_id?: string | null
          created_at?: string
          creatives?: Json | null
          creatives_page_logo?: string | null
          creatives_page_name?: string | null
          creatives_section_subtitle?: string | null
          creatives_section_title?: string | null
          form_ai_subtitle?: string | null
          form_ai_title?: string | null
          form_ai_webhook_url?: string | null
          header_logo_url?: string | null
          id?: string
          intro_subtitle?: string | null
          intro_title?: string | null
          is_published?: boolean | null
          phone_call_webhook_url?: string | null
          published_sections?: Json | null
          sections?: Json | null
          slug?: string | null
          text_ai_enabled_platforms?: string[] | null
          text_ai_subtitle?: string | null
          text_ai_title?: string | null
          text_ai_webhook_url?: string | null
          title?: string
          updated_at?: string
          voice_call_enabled?: boolean | null
          voice_phone_country_code?: string | null
          voice_phone_number?: string | null
          voice_section_subtitle?: string | null
          voice_section_title?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_pages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dismissed_error_alerts: {
        Row: {
          client_id: string
          dismissed_at: string
          error_log_id: string
          id: string
          lead_id: string
        }
        Insert: {
          client_id: string
          dismissed_at?: string
          error_log_id: string
          id?: string
          lead_id: string
        }
        Update: {
          client_id?: string
          dismissed_at?: string
          error_log_id?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_error_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_executions: {
        Row: {
          channel: string | null
          completed_at: string | null
          contact_name: string | null
          followup_resume_at: string | null
          followup_status: string | null
          ghl_account_id: string
          grouped_message: string | null
          has_error: boolean
          id: string
          lead_id: string
          messages: Json | null
          messages_received: number | null
          resume_at: string | null
          setter_messages: Json | null
          stage_description: string | null
          started_at: string | null
          status: string | null
          trigger_payload: Json | null
          trigger_run_id: string | null
        }
        Insert: {
          channel?: string | null
          completed_at?: string | null
          contact_name?: string | null
          followup_resume_at?: string | null
          followup_status?: string | null
          ghl_account_id: string
          grouped_message?: string | null
          has_error?: boolean
          id?: string
          lead_id: string
          messages?: Json | null
          messages_received?: number | null
          resume_at?: string | null
          setter_messages?: Json | null
          stage_description?: string | null
          started_at?: string | null
          status?: string | null
          trigger_payload?: Json | null
          trigger_run_id?: string | null
        }
        Update: {
          channel?: string | null
          completed_at?: string | null
          contact_name?: string | null
          followup_resume_at?: string | null
          followup_status?: string | null
          ghl_account_id?: string
          grouped_message?: string | null
          has_error?: boolean
          id?: string
          lead_id?: string
          messages?: Json | null
          messages_received?: number | null
          resume_at?: string | null
          setter_messages?: Json | null
          stage_description?: string | null
          started_at?: string | null
          status?: string | null
          trigger_payload?: Json | null
          trigger_run_id?: string | null
        }
        Relationships: []
      }
      drip_positions: {
        Row: {
          campaign_id: string
          client_id: string
          id: string
          next_position: number
          node_id: string
          started_at: string
          workflow_id: string
        }
        Insert: {
          campaign_id: string
          client_id: string
          id?: string
          next_position?: number
          node_id: string
          started_at?: string
          workflow_id: string
        }
        Update: {
          campaign_id?: string
          client_id?: string
          id?: string
          next_position?: number
          node_id?: string
          started_at?: string
          workflow_id?: string
        }
        Relationships: []
      }
      engagement_campaigns: {
        Row: {
          client_id: string
          created_at: string
          enroll_webhook_token: string
          id: string
          name: string
          status: string
          text_setter_number: number
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          enroll_webhook_token?: string
          id?: string
          name: string
          status?: string
          text_setter_number?: number
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          enroll_webhook_token?: string
          id?: string
          name?: string
          status?: string
          text_setter_number?: number
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_campaigns_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "engagement_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_drip_positions: {
        Row: {
          batch_size: number
          campaign_id: string
          client_id: string
          id: string
          interval_seconds: number
          next_position: number
          node_id: string
          started_at: string
          workflow_id: string
        }
        Insert: {
          batch_size: number
          campaign_id: string
          client_id: string
          id?: string
          interval_seconds: number
          next_position?: number
          node_id: string
          started_at?: string
          workflow_id: string
        }
        Update: {
          batch_size?: number
          campaign_id?: string
          client_id?: string
          id?: string
          interval_seconds?: number
          next_position?: number
          node_id?: string
          started_at?: string
          workflow_id?: string
        }
        Relationships: []
      }
      engagement_executions: {
        Row: {
          campaign_id: string | null
          client_id: string | null
          completed_at: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          current_node_index: number | null
          enrollment_source: string | null
          ghl_account_id: string
          id: string
          is_new_lead: boolean | null
          last_call_outcome: Json | null
          last_completed_node_index: number | null
          last_sms_sent_at: string | null
          lead_id: string
          stage_description: string | null
          started_at: string | null
          status: string
          stop_reason: string | null
          trigger_run_id: string | null
          updated_at: string | null
          waiting_for_reply_since: string | null
          waiting_for_reply_until: string | null
          workflow_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          current_node_index?: number | null
          enrollment_source?: string | null
          ghl_account_id: string
          id?: string
          is_new_lead?: boolean | null
          last_call_outcome?: Json | null
          last_completed_node_index?: number | null
          last_sms_sent_at?: string | null
          lead_id: string
          stage_description?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          trigger_run_id?: string | null
          updated_at?: string | null
          waiting_for_reply_since?: string | null
          waiting_for_reply_until?: string | null
          workflow_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          current_node_index?: number | null
          enrollment_source?: string | null
          ghl_account_id?: string
          id?: string
          is_new_lead?: boolean | null
          last_call_outcome?: Json | null
          last_completed_node_index?: number | null
          last_sms_sent_at?: string | null
          lead_id?: string
          stage_description?: string | null
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          trigger_run_id?: string | null
          updated_at?: string | null
          waiting_for_reply_since?: string | null
          waiting_for_reply_until?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_executions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "engagement_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_workflows: {
        Row: {
          client_id: string | null
          created_at: string | null
          id: string
          is_active: boolean
          name: string
          nodes: Json
          schedule: Json | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          nodes?: Json
          schedule?: Json | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          nodes?: Json
          schedule?: Json | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_workflows_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          category: string | null
          client_ghl_account_id: string
          context: Json | null
          created_at: string | null
          error_message: string
          error_type: string
          execution_id: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          severity: string
          source: string | null
          title: string | null
          trigger_run_id: string | null
        }
        Insert: {
          category?: string | null
          client_ghl_account_id: string
          context?: Json | null
          created_at?: string | null
          error_message: string
          error_type: string
          execution_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          severity?: string
          source?: string | null
          title?: string | null
          trigger_run_id?: string | null
        }
        Update: {
          category?: string | null
          client_ghl_account_id?: string
          context?: Json | null
          created_at?: string | null
          error_message?: string
          error_type?: string
          execution_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          severity?: string
          source?: string | null
          title?: string | null
          trigger_run_id?: string | null
        }
        Relationships: []
      }
      execution_logs: {
        Row: {
          campaign_id: string | null
          error_details: string | null
          execution_time: string
          id: string
          lead_id: string | null
          retry_count: number
          status: string
          webhook_response: string | null
        }
        Insert: {
          campaign_id?: string | null
          error_details?: string | null
          execution_time?: string
          id?: string
          lead_id?: string | null
          retry_count?: number
          status?: string
          webhook_response?: string | null
        }
        Update: {
          campaign_id?: string | null
          error_details?: string | null
          execution_time?: string
          id?: string
          lead_id?: string | null
          retry_count?: number
          status?: string
          webhook_response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_timers: {
        Row: {
          client_id: string | null
          created_at: string | null
          decision: string | null
          decision_reason: string | null
          fires_at: string
          followup_message: string | null
          ghl_account_id: string
          id: string
          lead_id: string
          raw_exchange: Json | null
          sequence_index: number | null
          setter_number: string
          status: string
          trigger_run_id: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          decision?: string | null
          decision_reason?: string | null
          fires_at: string
          followup_message?: string | null
          ghl_account_id: string
          id?: string
          lead_id: string
          raw_exchange?: Json | null
          sequence_index?: number | null
          setter_number: string
          status?: string
          trigger_run_id?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          decision?: string | null
          decision_reason?: string | null
          fires_at?: string
          followup_message?: string | null
          ghl_account_id?: string
          id?: string
          lead_id?: string
          raw_exchange?: Json | null
          sequence_index?: number | null
          setter_number?: string
          status?: string
          trigger_run_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "followup_timers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          category: string | null
          client_id: string | null
          content: string | null
          created_at: string
          id: string
          is_published: boolean | null
          tags: string[] | null
          title: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          is_published?: boolean | null
          tags?: string[] | null
          title: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          category?: string | null
          client_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          is_published?: boolean | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_ai_columns: {
        Row: {
          client_id: string | null
          column_name: string
          created_at: string
          id: string
          prompt_template: string
        }
        Insert: {
          client_id?: string | null
          column_name: string
          created_at?: string
          id?: string
          prompt_template: string
        }
        Update: {
          client_id?: string | null
          column_name?: string
          created_at?: string
          id?: string
          prompt_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_ai_columns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_ai_values: {
        Row: {
          ai_column_id: string | null
          created_at: string
          generated_value: string | null
          id: string
          lead_id: string | null
          status: string | null
        }
        Insert: {
          ai_column_id?: string | null
          created_at?: string
          generated_value?: string | null
          id?: string
          lead_id?: string | null
          status?: string | null
        }
        Update: {
          ai_column_id?: string | null
          created_at?: string
          generated_value?: string | null
          id?: string
          lead_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_ai_values_ai_column_id_fkey"
            columns: ["ai_column_id"]
            isOneToOne: false
            referencedRelation: "lead_ai_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_ai_values_contact_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          client_id: string
          color: string | null
          content: string
          created_at: string
          id: string
          lead_id: string
        }
        Insert: {
          client_id: string
          color?: string | null
          content: string
          created_at?: string
          id?: string
          lead_id: string
        }
        Update: {
          client_id?: string
          color?: string | null
          content?: string
          created_at?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tag_assignments: {
        Row: {
          created_at: string | null
          id: string
          lead_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          lead_id: string
          tag_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          lead_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tag_assignments_contact_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "lead_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          client_id: string | null
          color: string | null
          created_at: string | null
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          client_id?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          client_id?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          agent_style: string | null
          business_name: string | null
          client_id: string | null
          consent_text: string | null
          consent_timestamp: string | null
          consent_version: string | null
          created_at: string
          custom_fields: Json | null
          email: string | null
          first_name: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          last_name: string | null
          last_outbound_at: string | null
          last_reply_at: string | null
          lead_id: string | null
          nudge_count: number
          phone: string | null
          phone_valid: boolean
          setter_stopped: boolean
          source_ip: string | null
          source_type: string | null
          tagged_silent_after_engagement: boolean
          tags: Json | null
          updated_at: string
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          agent_style?: string | null
          business_name?: string | null
          client_id?: string | null
          consent_text?: string | null
          consent_timestamp?: string | null
          consent_version?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          last_name?: string | null
          last_outbound_at?: string | null
          last_reply_at?: string | null
          lead_id?: string | null
          nudge_count?: number
          phone?: string | null
          phone_valid?: boolean
          setter_stopped?: boolean
          source_ip?: string | null
          source_type?: string | null
          tagged_silent_after_engagement?: boolean
          tags?: Json | null
          updated_at?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          agent_style?: string | null
          business_name?: string | null
          client_id?: string | null
          consent_text?: string | null
          consent_timestamp?: string | null
          consent_version?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          last_name?: string | null
          last_outbound_at?: string | null
          last_reply_at?: string | null
          lead_id?: string | null
          nudge_count?: number
          phone?: string | null
          phone_valid?: boolean
          setter_stopped?: boolean
          source_ip?: string | null
          source_type?: string | null
          tagged_silent_after_engagement?: boolean
          tags?: Json | null
          updated_at?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      message_queue: {
        Row: {
          channel: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          ghl_account_id: string
          id: string
          lead_id: string
          message_body: string
          processed: boolean | null
        }
        Insert: {
          channel?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          ghl_account_id: string
          id?: string
          lead_id: string
          message_body: string
          processed?: boolean | null
        }
        Update: {
          channel?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          ghl_account_id?: string
          id?: string
          lead_id?: string
          message_body?: string
          processed?: boolean | null
        }
        Relationships: []
      }
      metric_analysis_results: {
        Row: {
          analysis_date: string
          client_id: string | null
          created_at: string
          id: string
          metric_id: string | null
          results: Json
          time_range: string
          total_count: number
        }
        Insert: {
          analysis_date?: string
          client_id?: string | null
          created_at?: string
          id?: string
          metric_id?: string | null
          results?: Json
          time_range: string
          total_count?: number
        }
        Update: {
          analysis_date?: string
          client_id?: string | null
          created_at?: string
          id?: string
          metric_id?: string | null
          results?: Json
          time_range?: string
          total_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "metric_analysis_results_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_analysis_results_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "custom_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_color_preferences: {
        Row: {
          client_id: string | null
          color: string
          created_at: string
          id: string
          metric_name: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          color?: string
          created_at?: string
          id?: string
          metric_name: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          color?: string
          created_at?: string
          id?: string
          metric_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_color_preferences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      openrouter_usage_cache: {
        Row: {
          cached_data: Json
          client_id: string
          created_at: string
          id: string
          last_refreshed: string
        }
        Insert: {
          cached_data?: Json
          client_id: string
          created_at?: string
          id?: string
          last_refreshed?: string
        }
        Update: {
          cached_data?: Json
          client_id?: string
          created_at?: string
          id?: string
          last_refreshed?: string
        }
        Relationships: [
          {
            foreignKeyName: "openrouter_usage_cache_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          attempt_number: number
          attempt_type: string
          attempted_at: string
          client_id: string
          created_at: string
          failure_reason: string | null
          id: string
          result: string
          stripe_invoice_id: string | null
        }
        Insert: {
          attempt_number?: number
          attempt_type?: string
          attempted_at?: string
          client_id: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          result?: string
          stripe_invoice_id?: string | null
        }
        Update: {
          attempt_number?: number
          attempt_type?: string
          attempted_at?: string
          client_id?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          result?: string
          stripe_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_phases: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          order_index: number | null
          portal_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          order_index?: number | null
          portal_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          order_index?: number | null
          portal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_phases_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "client_portals"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_step_completions: {
        Row: {
          completed: boolean | null
          created_at: string
          form_data: Json | null
          id: string
          portal_id: string | null
          step_id: string | null
        }
        Insert: {
          completed?: boolean | null
          created_at?: string
          form_data?: Json | null
          id?: string
          portal_id?: string | null
          step_id?: string | null
        }
        Update: {
          completed?: boolean | null
          created_at?: string
          form_data?: Json | null
          id?: string
          portal_id?: string | null
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_step_completions_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "client_portals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_step_completions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "portal_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_steps: {
        Row: {
          content: Json | null
          created_at: string
          id: string
          name: string
          order_index: number | null
          phase_id: string | null
          show_to_client: boolean | null
        }
        Insert: {
          content?: Json | null
          created_at?: string
          id?: string
          name: string
          order_index?: number | null
          phase_id?: string | null
          show_to_client?: boolean | null
        }
        Update: {
          content?: Json | null
          created_at?: string
          id?: string
          name?: string
          order_index?: number | null
          phase_id?: string | null
          show_to_client?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_steps_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "portal_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_task_completions: {
        Row: {
          completed: boolean | null
          created_at: string
          id: string
          portal_id: string | null
          task_id: string | null
        }
        Insert: {
          completed?: boolean | null
          created_at?: string
          id?: string
          portal_id?: string | null
          task_id?: string | null
        }
        Update: {
          completed?: boolean | null
          created_at?: string
          id?: string
          portal_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_task_completions_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "client_portals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "portal_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_tasks: {
        Row: {
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          order_index: number | null
          portal_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          order_index?: number | null
          portal_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          order_index?: number | null
          portal_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_tasks_portal_id_fkey"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "client_portals"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_chat_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          message_type: string | null
          metadata: Json | null
          role: string
          thread_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "presentation_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "presentation_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_chat_threads: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentation_chat_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agency_id: string | null
          client_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_retry_date: string | null
          logo_url: string | null
          onboarding_completed: boolean | null
          payment_failed_date: string | null
          retry_count: number | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_end_date: string | null
          subscription_start_date: string | null
          subscription_status: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_retry_date?: string | null
          logo_url?: string | null
          onboarding_completed?: boolean | null
          payment_failed_date?: string | null
          retry_count?: number | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          client_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_retry_date?: string | null
          logo_url?: string | null
          onboarding_completed?: boolean | null
          payment_failed_date?: string | null
          retry_count?: number | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end_date?: string | null
          subscription_start_date?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_chat_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          message_type: string | null
          metadata: Json | null
          role: string
          thread_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "prompt_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_chat_threads: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_chat_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_configurations: {
        Row: {
          client_id: string
          config_key: string
          created_at: string | null
          custom_content: string | null
          id: string
          selected_option: string | null
          slot_id: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          config_key: string
          created_at?: string | null
          custom_content?: string | null
          id?: string
          selected_option?: string | null
          slot_id: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          config_key?: string
          created_at?: string | null
          custom_content?: string | null
          id?: string
          selected_option?: string | null
          slot_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_configurations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          client_id: string
          created_at: string
          id: string
          label: string | null
          original_prompt_content: string | null
          prompt_content: string
          slot_id: string
          version_number: number
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          label?: string | null
          original_prompt_content?: string | null
          prompt_content: string
          slot_id: string
          version_number: number
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          label?: string | null
          original_prompt_content?: string | null
          prompt_content?: string
          slot_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          category: string | null
          client_id: string | null
          content: string | null
          created_at: string
          description: string | null
          directions: string[] | null
          id: string
          is_active: boolean | null
          name: string | null
          persona: string | null
          prompt_type: string | null
          slot_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          content?: string | null
          created_at?: string
          description?: string | null
          directions?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          persona?: string | null
          prompt_type?: string | null
          slot_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          client_id?: string | null
          content?: string | null
          created_at?: string
          description?: string | null
          directions?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          persona?: string | null
          prompt_type?: string | null
          slot_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      request_logs: {
        Row: {
          client_id: string | null
          cost: number | null
          created_at: string
          duration_ms: number | null
          endpoint_url: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          method: string | null
          model: string | null
          request_body: Json | null
          request_type: string
          response_body: Json | null
          source: string
          status: string
          status_code: number | null
          tokens_used: number | null
        }
        Insert: {
          client_id?: string | null
          cost?: number | null
          created_at?: string
          duration_ms?: number | null
          endpoint_url?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          method?: string | null
          model?: string | null
          request_body?: Json | null
          request_type?: string
          response_body?: Json | null
          source?: string
          status?: string
          status_code?: number | null
          tokens_used?: number | null
        }
        Update: {
          client_id?: string | null
          cost?: number | null
          created_at?: string
          duration_ms?: number | null
          endpoint_url?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          method?: string | null
          model?: string | null
          request_body?: Json | null
          request_type?: string
          response_body?: Json | null
          source?: string
          status?: string
          status_code?: number | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "request_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      retell_agent_mapping: {
        Row: {
          agent_id: string
          agent_name: string | null
          client_id: string | null
          created_at: string
          ghl_account_id: string
          id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_name?: string | null
          client_id?: string | null
          created_at?: string
          ghl_account_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_name?: string | null
          client_id?: string | null
          created_at?: string
          ghl_account_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retell_agent_mapping_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      setter_ai_reports: {
        Row: {
          client_id: string
          created_at: string
          id: string
          report_data: Json
          slot_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          report_data?: Json
          slot_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          report_data?: Json
          slot_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "setter_ai_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_analysis_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          role?: string
          thread_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_analysis_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "simulation_analysis_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_analysis_threads: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          simulation_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          simulation_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          simulation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_analysis_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_analysis_threads_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_icp_profiles: {
        Row: {
          age_max: number
          age_min: number
          behaviors: string[]
          booking_count: number
          cancel_reschedule_count: number
          concerns: string | null
          created_at: string
          description: string | null
          first_message_detail: string | null
          first_message_sender: string
          form_fields: string | null
          gender: string
          id: string
          lead_knowledge: string | null
          lead_trigger: string | null
          location: string | null
          name: string
          outreach_message: string | null
          persona_count: number
          scenario_items: string[]
          simulation_id: string
          sort_order: number
          test_booking: boolean
          test_cancellation: boolean
          test_reschedule: boolean
          updated_at: string
        }
        Insert: {
          age_max?: number
          age_min?: number
          behaviors?: string[]
          booking_count?: number
          cancel_reschedule_count?: number
          concerns?: string | null
          created_at?: string
          description?: string | null
          first_message_detail?: string | null
          first_message_sender?: string
          form_fields?: string | null
          gender?: string
          id?: string
          lead_knowledge?: string | null
          lead_trigger?: string | null
          location?: string | null
          name?: string
          outreach_message?: string | null
          persona_count?: number
          scenario_items?: string[]
          simulation_id: string
          sort_order?: number
          test_booking?: boolean
          test_cancellation?: boolean
          test_reschedule?: boolean
          updated_at?: string
        }
        Update: {
          age_max?: number
          age_min?: number
          behaviors?: string[]
          booking_count?: number
          cancel_reschedule_count?: number
          concerns?: string | null
          created_at?: string
          description?: string | null
          first_message_detail?: string | null
          first_message_sender?: string
          form_fields?: string | null
          gender?: string
          id?: string
          lead_knowledge?: string | null
          lead_trigger?: string | null
          location?: string | null
          name?: string
          outreach_message?: string | null
          persona_count?: number
          scenario_items?: string[]
          simulation_id?: string
          sort_order?: number
          test_booking?: boolean
          test_cancellation?: boolean
          test_reschedule?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_icp_profiles_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          message_order: number
          message_type: string | null
          persona_id: string
          role: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          message_order?: number
          message_type?: string | null
          persona_id: string
          role?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          message_order?: number
          message_type?: string | null
          persona_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_messages_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "simulation_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_personas: {
        Row: {
          age: number | null
          assigned_message_count: number
          avatar_seed: string | null
          booking_intent: string | null
          created_at: string
          dummy_email: string | null
          dummy_phone: string | null
          gender: string | null
          goal: string | null
          hobbies: string | null
          icp_profile_id: string | null
          id: string
          name: string
          occupation: string | null
          preferred_booking_date: string | null
          problem: string | null
          simulation_id: string
          status: string
        }
        Insert: {
          age?: number | null
          assigned_message_count?: number
          avatar_seed?: string | null
          booking_intent?: string | null
          created_at?: string
          dummy_email?: string | null
          dummy_phone?: string | null
          gender?: string | null
          goal?: string | null
          hobbies?: string | null
          icp_profile_id?: string | null
          id?: string
          name: string
          occupation?: string | null
          preferred_booking_date?: string | null
          problem?: string | null
          simulation_id: string
          status?: string
        }
        Update: {
          age?: number | null
          assigned_message_count?: number
          avatar_seed?: string | null
          booking_intent?: string | null
          created_at?: string
          dummy_email?: string | null
          dummy_phone?: string | null
          gender?: string | null
          goal?: string | null
          hobbies?: string | null
          icp_profile_id?: string | null
          id?: string
          name?: string
          occupation?: string | null
          preferred_booking_date?: string | null
          problem?: string | null
          simulation_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_personas_icp_profile_id_fkey"
            columns: ["icp_profile_id"]
            isOneToOne: false
            referencedRelation: "simulation_icp_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_personas_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_reports: {
        Row: {
          client_id: string
          created_at: string
          id: string
          report_data: Json
          simulation_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          report_data?: Json
          simulation_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          report_data?: Json
          simulation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulation_reports_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: true
            referencedRelation: "simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      simulations: {
        Row: {
          agent_number: number
          business_info: string | null
          client_id: string
          created_at: string
          free_input: string | null
          id: string
          max_messages: number
          min_messages: number
          name: string | null
          num_conversations: number
          status: string
          test_goal: string | null
          test_specifics: string | null
          updated_at: string
        }
        Insert: {
          agent_number?: number
          business_info?: string | null
          client_id: string
          created_at?: string
          free_input?: string | null
          id?: string
          max_messages?: number
          min_messages?: number
          name?: string | null
          num_conversations?: number
          status?: string
          test_goal?: string | null
          test_specifics?: string | null
          updated_at?: string
        }
        Update: {
          agent_number?: number
          business_info?: string | null
          client_id?: string
          created_at?: string
          free_input?: string | null
          id?: string
          max_messages?: number
          min_messages?: number
          name?: string | null
          num_conversations?: number
          status?: string
          test_goal?: string | null
          test_specifics?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          body: string
          client_id: string
          contact_id: string
          created_at: string
          direction: string
          from_number: string | null
          id: string
          status: string
          to_number: string | null
          twilio_sid: string | null
        }
        Insert: {
          body: string
          client_id: string
          contact_id: string
          created_at?: string
          direction?: string
          from_number?: string | null
          id?: string
          status?: string
          to_number?: string | null
          twilio_sid?: string | null
        }
        Update: {
          body?: string
          client_id?: string
          contact_id?: string
          created_at?: string
          direction?: string
          from_number?: string | null
          id?: string
          status?: string
          to_number?: string | null
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "demo_page_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      supabase_usage_cache: {
        Row: {
          cached_data: Json
          client_id: string
          created_at: string
          id: string
          last_refreshed: string
        }
        Insert: {
          cached_data?: Json
          client_id: string
          created_at?: string
          id?: string
          last_refreshed?: string
        }
        Update: {
          cached_data?: Json
          client_id?: string
          created_at?: string
          id?: string
          last_refreshed?: string
        }
        Relationships: [
          {
            foreignKeyName: "supabase_usage_cache_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      support_chat_messages: {
        Row: {
          client_id: string | null
          content: string | null
          created_at: string
          id: string
          role: string
        }
        Insert: {
          client_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          role?: string
        }
        Update: {
          client_id?: string | null
          content?: string | null
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_chat_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_ghl_booking_executions: {
        Row: {
          client_id: string
          contact_name: string | null
          created_at: string
          error_message: string | null
          external_id: string
          id: string
          status: string
          steps: Json | null
        }
        Insert: {
          client_id: string
          contact_name?: string | null
          created_at?: string
          error_message?: string | null
          external_id: string
          id?: string
          status: string
          steps?: Json | null
        }
        Update: {
          client_id?: string
          contact_name?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string
          id?: string
          status?: string
          steps?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_ghl_booking_executions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_ghl_executions: {
        Row: {
          client_id: string
          contact_name: string | null
          created_at: string
          error_message: string | null
          external_id: string
          id: string
          status: string
          steps: Json | null
        }
        Insert: {
          client_id: string
          contact_name?: string | null
          created_at?: string
          error_message?: string | null
          external_id: string
          id?: string
          status?: string
          steps?: Json | null
        }
        Update: {
          client_id?: string
          contact_name?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string
          id?: string
          status?: string
          steps?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_ghl_executions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_wizard_answers: {
        Row: {
          answers: Json | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          is_completed: boolean | null
          updated_at: string
        }
        Insert: {
          answers?: Json | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean | null
          updated_at?: string
        }
        Update: {
          answers?: Json | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "traffic_wizard_answers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      unipile_accounts: {
        Row: {
          client_id: string
          created_at: string
          display_name: string | null
          id: string
          provider: string
          status: string
          unipile_account_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          provider?: string
          status?: string
          unipile_account_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          provider?: string
          status?: string
          unipile_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unipile_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_analytics_chat_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          message_type: string | null
          metadata: Json | null
          role: string
          thread_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          message_type?: string | null
          metadata?: Json | null
          role?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_analytics_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "voice_analytics_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_analytics_chat_threads: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_analytics_chat_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_chat_analytics: {
        Row: {
          client_id: string | null
          id: string
          last_updated: string
          metrics: Json | null
          time_range: string
        }
        Insert: {
          client_id?: string | null
          id?: string
          last_updated?: string
          metrics?: Json | null
          time_range: string
        }
        Update: {
          client_id?: string | null
          id?: string
          last_updated?: string
          metrics?: Json | null
          time_range?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_chat_analytics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_setup: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          replay_url: string | null
          updated_at: string
          webinar_url: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          replay_url?: string | null
          updated_at?: string
          webinar_url?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          replay_url?: string | null
          updated_at?: string
          webinar_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webinar_setup_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_execution_steps: {
        Row: {
          completed_at: string | null
          error_message: string | null
          execution_id: string
          id: string
          input_data: Json | null
          node_id: string
          node_type: string
          output_data: Json | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          execution_id: string
          id?: string
          input_data?: Json | null
          node_id: string
          node_type: string
          output_data?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          execution_id?: string
          id?: string
          input_data?: Json | null
          node_id?: string
          node_type?: string
          output_data?: Json | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_execution_steps_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "workflow_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_executions: {
        Row: {
          client_id: string
          completed_at: string | null
          error_message: string | null
          id: string
          started_at: string
          status: string
          trigger_data: Json | null
          trigger_run_id: string | null
          trigger_type: string
          workflow_id: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          started_at?: string
          status?: string
          trigger_data?: Json | null
          trigger_run_id?: string | null
          trigger_type: string
          workflow_id: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          error_message?: string | null
          id?: string
          started_at?: string
          status?: string
          trigger_data?: Json | null
          trigger_run_id?: string | null
          trigger_type?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_executions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_webhook_requests: {
        Row: {
          client_id: string
          id: string
          raw_request: Json
          received_at: string
          workflow_id: string
        }
        Insert: {
          client_id: string
          id?: string
          raw_request?: Json
          received_at?: string
          workflow_id: string
        }
        Update: {
          client_id?: string
          id?: string
          raw_request?: Json
          received_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_webhook_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_webhook_requests_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          client_id: string
          created_at: string
          description: string | null
          edges: Json
          id: string
          is_active: boolean
          name: string
          nodes: Json
          updated_at: string
          webhook_mapping_reference: Json | null
        }
        Insert: {
          client_id: string
          created_at?: string
          description?: string | null
          edges?: Json
          id?: string
          is_active?: boolean
          name?: string
          nodes?: Json
          updated_at?: string
          webhook_mapping_reference?: Json | null
        }
        Update: {
          client_id?: string
          created_at?: string
          description?: string | null
          edges?: Json
          id?: string
          is_active?: boolean
          name?: string
          nodes?: Json
          updated_at?: string
          webhook_mapping_reference?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_drip_position: {
        Args: {
          p_batch_size: number
          p_campaign_id: string
          p_client_id: string
          p_interval_seconds: number
          p_node_id: string
          p_workflow_id: string
        }
        Returns: Json
      }
      delete_campaign_with_data: {
        Args: { campaign_id_param: string }
        Returns: undefined
      }
      delete_client_with_data: {
        Args: { client_id_param: string }
        Returns: undefined
      }
      get_avg_response_minutes: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      get_secure_leads: {
        Args: { campaign_id_filter: string }
        Returns: {
          campaign_id: string | null
          created_at: string
          error_message: string | null
          id: string
          lead_data: Json | null
          processed_at: string | null
          scheduled_for: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "campaign_leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_client_id: { Args: { _user_id: string }; Returns: string }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "agency" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["agency", "client"],
    },
  },
} as const
