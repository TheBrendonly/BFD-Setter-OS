-- ============================================================
-- 1Prompt — Main Platform Database Schema
-- Run this in your Supabase SQL Editor to create all tables.
-- This is the schema for YOUR platform database (not the client's).
-- ============================================================


-- ── clients ──────────────────────────────────────────────────────────────────
-- One row per paying client. Source of truth for all client configuration.
-- All other tables reference this via client_id or ghl_location_id.
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),

  -- GoHighLevel
  ghl_location_id text unique not null,
  ghl_send_setter_reply_webhook_url text,
  send_followup_webhook_url text,

  -- n8n (AI engine)
  text_engine_webhook text,

  -- Debounce
  debounce_seconds integer default 60,

  -- OpenRouter
  openrouter_api_key text,
  llm_model text default 'google/gemini-2.5-pro',

  -- Client's own Supabase project (for chat history, leads, prompts)
  supabase_url text,
  supabase_service_key text,
  supabase_table_name text default 'leads',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ── leads ─────────────────────────────────────────────────────────────────────
-- One row per unique lead (GHL contact) seen by a client.
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  lead_id text not null,

  first_name text,
  last_name text,
  email text,
  phone text,

  last_message_preview text,
  setter_stopped boolean default false,

  -- Compliance + audit (ACL s18 + Privacy Act APP 1.7-1.9). Populated by
  -- ingress webhooks (ghl-tag-webhook) when the GHL payload carries these
  -- custom fields. Defensible "agreed to X on Y from Z" evidence.
  agent_style text,
  consent_text text,
  consent_version text,
  consent_timestamp timestamptz,
  source_ip inet,
  user_agent text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  source_type text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(client_id, lead_id)
);
create index if not exists idx_leads_lookup
  on leads (client_id, lead_id);
-- Supports 5-min phone-dedup guard in ghl-tag-webhook (skip enrolment if
-- same client_id + phone seen recently).
create index if not exists idx_leads_phone_dedup_lookup
  on leads (client_id, phone, created_at desc)
  where phone is not null;


-- ── message_queue ─────────────────────────────────────────────────────────────
-- Temporarily stores incoming GHL messages during the debounce window.
-- Trigger.dev reads and groups these before sending to n8n.
create table if not exists message_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  ghl_contact_id text,
  ghl_account_id text not null,
  message_body text not null,
  channel text,
  contact_name text,
  contact_email text,
  contact_phone text,
  processed boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_message_queue_lookup
  on message_queue (lead_id, ghl_account_id, processed);


-- ── active_trigger_runs ───────────────────────────────────────────────────────
-- Prevents duplicate Trigger.dev tasks per contact.
-- Cleaned up when the task completes.
create table if not exists active_trigger_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  ghl_contact_id text,
  ghl_account_id text not null,
  trigger_run_id text not null,
  created_at timestamptz default now(),
  unique(lead_id, ghl_account_id)
);


-- ── dm_executions ─────────────────────────────────────────────────────────────
-- Live execution log — one row per contact session.
-- The frontend reads this to show status, countdown, and history.
create table if not exists dm_executions (
  id uuid primary key default gen_random_uuid(),
  trigger_run_id text,
  ghl_contact_id text,
  lead_id text,
  ghl_account_id text not null,
  contact_name text,
  channel text,

  status text default 'waiting',
  -- status values: 'waiting' | 'grouping' | 'sending' | 'completed' | 'failed'

  stage_description text,
  -- human-readable description of current stage (shown in UI)

  resume_at timestamptz,
  -- when the debounce wait ends — used by frontend for live countdown

  messages_received integer default 0,
  grouped_message text,
  -- the final combined message sent to n8n

  setter_messages jsonb,
  -- array of reply messages returned by n8n

  trigger_payload jsonb,
  -- raw payload received from the GHL webhook

  has_error boolean default false,

  started_at timestamptz default now(),
  completed_at timestamptz
);
create index if not exists idx_dm_executions_lookup
  on dm_executions (ghl_account_id, started_at desc);


-- ── agent_settings ────────────────────────────────────────────────────────────
-- Per-setter configuration. One row per setter slot per client.
-- slot_id format: 'Setter-1', 'Setter-2', etc.
create table if not exists agent_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  slot_id text not null,
  -- e.g. 'Setter-1', 'Setter-2'

  response_delay_seconds integer default 60,

  -- Follow-up sequence
  followup_1_delay_seconds integer default 0,
  followup_2_delay_seconds integer default 0,
  followup_3_delay_seconds integer default 0,
  followup_max_attempts integer default 0,
  followup_instructions text,
  followup_cancellation_instructions text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(client_id, slot_id)
);


-- ── followup_timers ───────────────────────────────────────────────────────────
-- Tracks scheduled follow-up messages per contact.
-- One row per pending/fired/cancelled follow-up attempt.
create table if not exists followup_timers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  lead_id text not null,
  ghl_account_id text not null,
  setter_number text,
  sequence_index integer default 1,

  status text default 'pending',
  -- status values: 'pending' | 'firing' | 'fired' | 'cancelled' | 'failed'

  fires_at timestamptz not null,
  trigger_run_id text,

  -- Populated after AI decision
  decision text,
  -- 'sent' | 'cancelled'
  decision_reason text,
  followup_message text,
  raw_exchange jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_followup_timers_lookup
  on followup_timers (lead_id, ghl_account_id, status);


-- ── ai_generation_jobs ────────────────────────────────────────────────────────
-- Job queue for all AI generation tasks (setter config, prompt modification, etc.)
-- Frontend polls this table until status = 'completed', then reads result.
create table if not exists ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  job_type text not null,
  -- values: 'generate-setter-config' | 'modify-prompt-ai' | 'modify-mini-prompt-ai'
  --         'generate-simulation-config' | 'generate-simulation-report'

  status text default 'pending',
  -- values: 'pending' | 'running' | 'completed' | 'failed'

  messages jsonb,
  -- array of {role, content} messages sent to the LLM

  result jsonb,
  -- the completed AI output (read by frontend when status = 'completed')

  error_message text,
  started_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_ai_generation_jobs_lookup
  on ai_generation_jobs (client_id, status, created_at desc);


-- ── error_logs ────────────────────────────────────────────────────────────────
-- Platform error tracking. Populated by Trigger.dev tasks on failure.
create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  client_ghl_account_id text,
  client_id uuid,
  lead_id text,
  execution_id uuid,
  job_id uuid,
  trigger_run_id text,

  severity text default 'error',
  source text,
  category text,
  title text,
  error_type text,
  error_message text,
  context jsonb,

  created_at timestamptz default now()
);
create index if not exists idx_error_logs_lookup
  on error_logs (client_ghl_account_id, created_at desc);


-- ── openrouter_usage ──────────────────────────────────────────────────────────
-- Tracks token usage and estimated cost per AI job.
create table if not exists openrouter_usage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  job_type text,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost_usd numeric(10, 6),
  created_at timestamptz default now()
);
