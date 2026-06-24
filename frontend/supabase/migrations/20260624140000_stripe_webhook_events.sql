-- Event-idempotency store for inbound Stripe webhooks (B2.1).
--
-- stripe-webhook processes every delivery. invoice.payment_failed is NOT
-- idempotent: it does retry_count + 1, so a Stripe retry or a captured (validly
-- signed) replay double-increments and can jump a client grace_period -> locked
-- prematurely. The handler now claims a unique event_id BEFORE the switch: the
-- insert succeeds exactly once, a 23505 means "already processed" -> return 200
-- {duplicate:true} without reprocessing. If the handler body throws (the function
-- returns 500 and Stripe retries), the claim is DELETEd first so the retry is not
-- dedup-swallowed and the event is not lost.
--
-- Service-role only: written exclusively by the stripe-webhook edge function
-- (service role key, bypass RLS). RLS enabled with no policies so no anon/auth
-- role can read or write it.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
