-- Send-idempotency claims for outbound SMS sent from Trigger.dev tasks (B4).
--
-- sendFollowup (retry maxAttempts 2) and processMessages (maxAttempts 3) send via
-- Twilio and THEN stamp message_queue / mark the timer or execution done. A
-- Trigger retry that fires after a successful send but before that bookkeeping
-- re-runs the whole task body and re-sends the SMS. The tasks now claim a unique
-- send_key BEFORE the Twilio call: the insert succeeds exactly once, a 23505
-- means "already sent on a prior attempt" -> skip the re-send. On a genuine send
-- failure the task deletes its claim so a retry can re-attempt.
--
-- send_key shapes:
--   followup:<timer_id>            (one send per follow-up timer)
--   dm:<execution_id>:<msg_index>  (one send per setter-reply bubble)
--
-- Service-role only: written exclusively by Trigger tasks (service role key,
-- bypass RLS). RLS enabled with no policies so no anon/auth role can touch it.

CREATE TABLE IF NOT EXISTS public.outbound_send_claims (
  send_key text PRIMARY KEY,
  task text NOT NULL,
  lead_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outbound_send_claims ENABLE ROW LEVEL SECURITY;
