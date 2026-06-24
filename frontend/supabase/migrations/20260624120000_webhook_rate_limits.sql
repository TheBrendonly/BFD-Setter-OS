-- Fixed-window per-bucket request counter for inbound webhooks (S2b-5).
--
-- campaign-enroll-webhook is authed only by a campaign enroll token. Anyone who
-- learns that token can create leads + fire billable engagements. This table +
-- the bump_rate_limit() RPC cap how many requests a single bucket (the campaign
-- id) can make per fixed time window, so a leaked token can't be used to flood
-- enrolments. Generic enough to reuse for other webhooks later.
--
-- Service-role only: written exclusively by edge functions (which use the service
-- role key and bypass RLS). RLS is enabled with no policies so no anon/auth role
-- can read or write it.

CREATE TABLE IF NOT EXISTS public.webhook_rate_limits (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS webhook_rate_limits_window_start_idx
  ON public.webhook_rate_limits (window_start);

ALTER TABLE public.webhook_rate_limits ENABLE ROW LEVEL SECURITY;

-- Atomically increment the counter for the current fixed window and return the
-- new count. The window_start is computed server-side so concurrent callers land
-- in the same bucket. On the first hit of a new window it opportunistically prunes
-- rows older than a day so the table can't grow unbounded.
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_bucket_key text,
  p_window_seconds integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO webhook_rate_limits (bucket_key, window_start, count)
  VALUES (p_bucket_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = webhook_rate_limits.count + 1
  RETURNING count INTO v_count;

  IF v_count = 1 THEN
    DELETE FROM webhook_rate_limits WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN v_count;
END;
$$;
