-- Form-to-agent routing (2026-05-30)
-- Goal: let ONE client have MANY "new leads" workflows, each bound to a distinct
-- GHL form-tag, so different inbound forms activate different agents/cadences.
--
-- Before: a partial UNIQUE index capped each client at a single
-- is_new_leads_campaign=true workflow. After: a client may have many, but each
-- form-tag still maps to exactly one workflow (no routing ambiguity).
--
-- Backward compatible: every existing client has exactly one new-leads workflow,
-- which simply becomes "one of N". Untagged ingress still falls back to
-- clients.auto_engagement_workflow_id (unchanged).

BEGIN;

-- 1. Drop the one-new-leads-workflow-per-client cap.
DROP INDEX IF EXISTS public.engagement_workflows_one_new_leads_per_client;

-- 2. Each (client_id, new_leads_tag) must be unique among active new-leads
--    workflows, so a form-tag resolves to exactly one workflow. NULL tags are
--    excluded (the legacy/default new-leads workflow keeps a NULL tag).
DROP INDEX IF EXISTS public.engagement_workflows_new_leads_tag_idx;
CREATE UNIQUE INDEX IF NOT EXISTS engagement_workflows_new_leads_tag_unique
  ON public.engagement_workflows (client_id, new_leads_tag)
  WHERE is_new_leads_campaign = true AND new_leads_tag IS NOT NULL;

-- 3. Audit: record which form/tag created a lead (null when untagged/default).
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS form_source text;

COMMIT;
