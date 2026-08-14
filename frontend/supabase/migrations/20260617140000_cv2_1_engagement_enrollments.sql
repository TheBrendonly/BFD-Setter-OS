-- CV2-1 / feature 3.5 — multi-workflow lead lifecycle state machine (2026-06-17)
--
-- Today a lead lives in ONE engagement workflow for its whole life. This adds a
-- lifecycle layer so a lead can flow across distinct workflows:
--   Hot Pursuit -> Cool Down / Long-Tail -> Re-engage
-- transitioned on `sequence_complete` (runEngagement) or on `silent`
-- (nudgeColdReply tier-3), and (in stage 3.7) on a behavioral reactivation
-- trigger (email click / pricing-page visit).
--
-- engagement_enrollments records one row per (lead, workflow) stage the lead
-- passes through; the open row (status active|paused) is the lead's current
-- stage. A partial UNIQUE index enforces at most ONE open enrollment per lead,
-- which is also the serialization point for concurrent transitions.
--
-- OPT-IN / BACKWARD COMPATIBLE: the three new engagement_workflows columns are
-- nullable with no default. Existing workflows get all-null and behave exactly
-- as before (no transition fires; no enrollment row is ever created until a
-- lead actually transitions). Platform DB only. Idempotent (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS public.engagement_enrollments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- TEXT to match engagement_executions.ghl_contact_id / leads.lead_id (GHL contact id).
  lead_id              text NOT NULL,
  workflow_id          uuid NOT NULL REFERENCES public.engagement_workflows(id) ON DELETE CASCADE,
  -- The execution this enrollment drives. SET NULL so archiving an execution
  -- doesn't cascade-delete enrollment history.
  execution_id         uuid REFERENCES public.engagement_executions(id) ON DELETE SET NULL,
  -- active | paused | completed | cancelled | superseded
  status               text NOT NULL DEFAULT 'active',
  -- initial | manual | sequence_complete | silent | reactivation_trigger
  entry_reason         text,
  -- mirrors the closing execution's stop_reason (audit / analytics)
  exit_reason          text,
  -- resolved transition target at close time (audit)
  next_workflow_id     uuid REFERENCES public.engagement_workflows(id) ON DELETE SET NULL,
  -- 3.7 forward-compat: which behavioral signal is being awaited (null = none).
  -- email_click | pricing_page_visit | manual
  reactivation_trigger text,
  -- 3.6/3.7 dormancy: hold the lead until this time before the next touch.
  paused_until         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- THE invariant: at most one OPEN (active|paused) enrollment per lead per client.
-- 'paused' counts as occupied so a dormant 3.6/3.7 lead is never double-enrolled.
CREATE UNIQUE INDEX IF NOT EXISTS engagement_enrollments_one_open_per_lead
  ON public.engagement_enrollments (client_id, lead_id)
  WHERE status IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS engagement_enrollments_lead_idx
  ON public.engagement_enrollments (client_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS engagement_enrollments_workflow_idx
  ON public.engagement_enrollments (workflow_id, status);
-- 3.7 sweeper support: find paused enrollments due for re-warm.
CREATE INDEX IF NOT EXISTS engagement_enrollments_paused_until_idx
  ON public.engagement_enrollments (paused_until)
  WHERE status = 'paused' AND paused_until IS NOT NULL;

ALTER TABLE public.engagement_enrollments ENABLE ROW LEVEL SECURITY;

-- Agency-scoped SELECT, mirroring engagement_executions. Backend writes use the
-- service role, which bypasses RLS.
DROP POLICY IF EXISTS "Users can view engagement enrollments for their agency clients"
  ON public.engagement_enrollments;
CREATE POLICY "Users can view engagement enrollments for their agency clients"
  ON public.engagement_enrollments FOR SELECT TO authenticated
  USING (client_id IN (
    SELECT c.id FROM public.clients c
    JOIN public.profiles p ON p.agency_id = c.agency_id
    WHERE p.id = auth.uid()
  ));

DROP TRIGGER IF EXISTS update_engagement_enrollments_updated_at ON public.engagement_enrollments;
CREATE TRIGGER update_engagement_enrollments_updated_at
  BEFORE UPDATE ON public.engagement_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Lifecycle wiring on engagement_workflows (opt-in, nullable) ──────────────
-- lifecycle_role: null = legacy single-stage; else hot_pursuit|cool_down|long_tail|re_engage
-- transition targets: which workflow the lead enters when this stage ends.
ALTER TABLE public.engagement_workflows
  ADD COLUMN IF NOT EXISTS lifecycle_role text,
  ADD COLUMN IF NOT EXISTS on_sequence_complete_workflow_id uuid
      REFERENCES public.engagement_workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS on_silent_workflow_id uuid
      REFERENCES public.engagement_workflows(id) ON DELETE SET NULL;

COMMIT;
