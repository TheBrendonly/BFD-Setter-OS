-- 2026-06-16 (CAD-03 prerequisite): create scheduled_callbacks.
--
-- The table was provisioned live via raw Management-API SQL but no CREATE TABLE
-- migration was ever committed — only the partial dedup index
-- (20260616120000_scheduled_callbacks_pending_dedup.sql) references it. A clean
-- rebuild from the migration files therefore failed ("relation does not exist"),
-- which would break ALL AI callbacks: the scheduleCallback Trigger task,
-- voice-booking-tools `schedule-callback`, and the retell-call-analysis-webhook
-- "call me back" intent all read/write this table.
--
-- This backfills the CREATE TABLE to match the live schema. Idempotent
-- (IF NOT EXISTS) so it is a no-op against the already-provisioned live DB and
-- the timestamp sorts BEFORE the dedup-index migration so a fresh rebuild orders
-- correctly.

CREATE TABLE IF NOT EXISTS public.scheduled_callbacks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL,
  ghl_contact_id      text NOT NULL,
  ghl_account_id      text,
  voice_setter_id     text NOT NULL,
  call_id             text,
  contact_name        text,
  contact_phone       text,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  scheduled_for       timestamptz NOT NULL,
  callback_reason     text,
  custom_instructions text,
  status              text NOT NULL DEFAULT 'pending',
  trigger_run_id      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Due-callback scan index (the schedule poller filters by status + scheduled_for).
CREATE INDEX IF NOT EXISTS idx_scheduled_callbacks_due
  ON public.scheduled_callbacks (status, scheduled_for);
