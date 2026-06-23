-- Replay/retry dedup store for inbound provider webhooks.
--
-- receive-twilio-sms uses this to make the STOP/START compliance branch
-- idempotent on MessageSid: that branch sends a BILLED Twilio compliance SMS and
-- toggles opt-out, then returns before the normal-path message_queue dedup, so a
-- Twilio retry or a captured (validly-signed) replay would otherwise re-bill and
-- re-toggle. Insert (provider, message_sid) up front; a 23505 unique violation
-- means "already processed" -> the handler returns early.
--
-- Service-role only: written exclusively by edge functions (which use the service
-- role key and bypass RLS). RLS is enabled with no policies so no anon/auth role
-- can read or write it.

CREATE TABLE IF NOT EXISTS public.processed_webhook_sids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid,
  provider text NOT NULL DEFAULT 'twilio',
  message_sid text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Twilio MessageSids are globally unique; (provider, message_sid) is the dedup key.
CREATE UNIQUE INDEX IF NOT EXISTS processed_webhook_sids_provider_sid_uniq
  ON public.processed_webhook_sids (provider, message_sid);

ALTER TABLE public.processed_webhook_sids ENABLE ROW LEVEL SECURITY;
