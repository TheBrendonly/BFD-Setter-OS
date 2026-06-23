-- Make claim_drip_position idempotent per execution.
--
-- Bug S3a-6: claim_drip_position does ON CONFLICT DO UPDATE next_position + 1 on
-- EVERY call, so a runEngagement retry that replays the drip node (drip is the
-- first node) claims a NEW, higher position -> a later batch -> a longer delay,
-- and inflates the shared batch counter for every later lead. The in-code comment
-- claimed it was idempotent; it wasn't.
--
-- Fix: key each claim by execution_id in a side table. On a repeat call for the
-- same execution, return the original position instead of incrementing.

CREATE TABLE IF NOT EXISTS public.drip_position_claims (
  execution_id uuid PRIMARY KEY,
  client_id uuid,
  workflow_id uuid,
  node_id text,
  campaign_id text,
  position integer NOT NULL,
  started_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

-- Service-role only (written by the SECURITY DEFINER RPC / the engagement runner).
ALTER TABLE public.drip_position_claims ENABLE ROW LEVEL SECURITY;

-- The arg list changes (adds p_execution_id), which Postgres treats as a new
-- overload, so drop the old signature first.
DROP FUNCTION IF EXISTS public.claim_drip_position(uuid, uuid, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.claim_drip_position(
  p_client_id uuid,
  p_workflow_id uuid,
  p_node_id text,
  p_campaign_id text,
  p_batch_size integer,
  p_interval_seconds integer,
  p_execution_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_position integer;
  v_started_at timestamptz;
BEGIN
  -- Idempotency: if this execution already claimed a position, return it unchanged.
  IF p_execution_id IS NOT NULL THEN
    SELECT position, started_at INTO v_position, v_started_at
    FROM drip_position_claims WHERE execution_id = p_execution_id;
    IF FOUND THEN
      RETURN json_build_object('position', v_position, 'started_at', v_started_at);
    END IF;
  END IF;

  INSERT INTO drip_positions (client_id, workflow_id, node_id, campaign_id, next_position, started_at)
  VALUES (p_client_id, p_workflow_id, p_node_id, p_campaign_id, 1, now())
  ON CONFLICT (client_id, workflow_id, node_id, campaign_id)
  DO UPDATE SET next_position = drip_positions.next_position + 1
  RETURNING next_position - 1, started_at INTO v_position, v_started_at;

  -- Persist the claim so a retry of this execution reuses the same position.
  IF p_execution_id IS NOT NULL THEN
    INSERT INTO drip_position_claims (execution_id, client_id, workflow_id, node_id, campaign_id, position, started_at)
    VALUES (p_execution_id, p_client_id, p_workflow_id, p_node_id, p_campaign_id, v_position, v_started_at)
    ON CONFLICT (execution_id) DO NOTHING;
  END IF;

  RETURN json_build_object('position', v_position, 'started_at', v_started_at);
END;
$$;
