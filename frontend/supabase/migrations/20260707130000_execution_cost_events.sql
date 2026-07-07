-- 20260707130000_execution_cost_events.sql
-- Session P2 (deferred pull-forward): per-execution cost ledger.
--
-- Today the only cost persistence is cadence_metrics.cost_estimate_cents — a single
-- rolled-up integer built from flat SEED weights (SMS=1.4c, voice=50c/attempt, etc.),
-- not real provider cost. Real numbers exist but are scattered and un-joined:
--   * voice: call_history.cost (real Retell USD, but keyed by GHL contact, not execution)
--   * LLM:   openrouter_usage.cost_usd (real, but job-scoped, not execution-scoped)
--   * SMS:   nothing durable at all (twilio-send-sms stores sid+status, no segments/price)
--
-- This table is the dedicated, itemized, per-execution cost ledger that later feeds
-- 2.6 cost dashboard, F8 v2 live estimate, 3.9 rolling aggregates, and 4.1 pricing.
-- It does NOT replace any read path this session — it just starts accruing.
--
-- RLS: cost_usd is BFD's REAL provider cost — exposing it to a client reveals margin.
-- So this is AGENCY-ONLY and role-gated exactly like client_pricing_config
-- (20260701140000): a client-role JWT shares its client's agency_id and the agency
-- "FOR ALL" scoping would otherwise match it, so we additionally require
-- get_user_role() = 'agency' and deliberately provide NO client-read policy.

CREATE TABLE IF NOT EXISTS public.execution_cost_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid REFERENCES public.engagement_executions(id) ON DELETE SET NULL,
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  workflow_id  uuid REFERENCES public.engagement_workflows(id) ON DELETE SET NULL,
  lead_id      text,                                    -- GHL contact id (text, not UUID)
  cost_kind    text NOT NULL CHECK (cost_kind IN ('voice','sms','llm')),
  provider_ref text,                                    -- call_id | twilio_sid | job id
  quantity     numeric,                                 -- minutes | segments | tokens
  unit         text,                                    -- 'minutes' | 'segments' | 'tokens'
  cost_usd     numeric(12,6) NOT NULL DEFAULT 0,
  is_estimated boolean NOT NULL DEFAULT false,          -- true = derived from rate card, not a provider-reported cost
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Idempotency: voice fires from BOTH retell-call-webhook and retell-call-analysis-webhook
  -- for the same call_id; retries re-run the SMS/LLM sites. (cost_kind, provider_ref) makes
  -- every writer an upsert. Postgres treats multiple NULLs as distinct, so the rare
  -- provider_ref-less row (e.g. a call with no call_id) still inserts rather than colliding.
  CONSTRAINT execution_cost_events_provider_uk UNIQUE (cost_kind, provider_ref)
);

CREATE INDEX IF NOT EXISTS execution_cost_events_client_idx
  ON public.execution_cost_events (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS execution_cost_events_execution_idx
  ON public.execution_cost_events (execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS execution_cost_events_kind_idx
  ON public.execution_cost_events (client_id, cost_kind, occurred_at DESC);

COMMENT ON TABLE public.execution_cost_events IS
  'Itemized per-execution provider cost ledger (voice/sms/llm). Agency-only (raw BFD cost). Prereq for 2.6/F8v2/3.9/4.1.';
COMMENT ON COLUMN public.execution_cost_events.is_estimated IS
  'true = cost derived from the rate card (e.g. SMS segments x rate); false = real provider-reported cost (Retell call.cost, OpenRouter cost_usd).';

ALTER TABLE public.execution_cost_events ENABLE ROW LEVEL SECURITY;

-- Agency-manage-all, ROLE-GATED (see header). service_role (runtime writers) bypasses RLS.
DROP POLICY IF EXISTS "Agency users can read cost events for their clients" ON public.execution_cost_events;
CREATE POLICY "Agency users can read cost events for their clients"
ON public.execution_cost_events
FOR ALL
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'agency'
  AND client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id IN (
      SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
)
WITH CHECK (
  public.get_user_role(auth.uid()) = 'agency'
  AND client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id IN (
      SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
);

-- DELIBERATELY NO "client users can read their own cost events" policy — raw cost is
-- agency-only. Clients see only their derived price via get-blended-rate / get-client-usage.

GRANT SELECT, INSERT ON public.execution_cost_events TO service_role;

NOTIFY pgrst, 'reload schema';
