-- 20260615120000_reconcile_engagement_executions.sql
-- Schema-drift reconcile (build session 2026-06-15, Stage A0 / rearchitecture item (d)).
--
-- `active_call_id` is written by the runtime in 5+ places
-- (trigger/runEngagement.ts, functions/stop-engagement, functions/retell-call-webhook,
-- functions/processMessages*, functions/receive-twilio-sms) as the text-setter "a call
-- is in flight, hold SMS" signal, but it was added to the live platform DB out-of-band
-- and never recorded in a migration. A clean rebuild / branch / preview DB therefore
-- lacks the column and silently breaks the voice-call hold (and now pause/resume, which
-- nulls it on pause). This migration records the column so the history is honest.
--
-- Idempotent: a no-op on the live platform DB (column already present).

ALTER TABLE public.engagement_executions
  ADD COLUMN IF NOT EXISTS active_call_id text;

COMMENT ON COLUMN public.engagement_executions.active_call_id IS
  'Retell call_id of an in-flight outbound call for this execution; non-null = text setter should hold (no SMS) until the call resolves. Cleared on every terminal/branch exit.';
