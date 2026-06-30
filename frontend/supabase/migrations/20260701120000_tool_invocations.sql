-- SMS-OBS-1 (Session 7.5 overnight, staged branch-only — NOT applied tonight).
-- New additive observability table: persists the SMS setter's tool calls/results
-- (get-available-slots / book-appointments / etc.) so booking failures like BOOK-1
-- are diagnosable from the DB instead of requiring a live GHL query + LLM transcript.
--
-- Written by the Trigger.dev task processSetterReply via the platform service role
-- (see trigger/_shared/persistToolInvocations.ts). Internal-only: RLS is ON with no
-- public policies, so only the service role (which bypasses RLS) can read/write until
-- a deliberate read policy is added. Additive — touches nothing existing.

create table if not exists public.tool_invocations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid,
  lead_id text,
  setter_slot text,
  source text,
  invocation_index integer,
  name text not null,
  args jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists tool_invocations_lead_idx
  on public.tool_invocations (lead_id, created_at desc);

create index if not exists tool_invocations_client_idx
  on public.tool_invocations (client_id, created_at desc);

alter table public.tool_invocations enable row level security;
