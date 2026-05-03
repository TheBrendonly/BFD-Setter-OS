-- phase-night-engagement-workflows-missing-cols
-- Adds the two columns the frontend Workflows page (Workflows.tsx) was already
-- selecting and ordering by, but which had never been added to the schema.
-- Without these, the .select('... is_active ... sort_order ...').order('sort_order')
-- in fetchAll() silently failed and every Campaigns tab rendered "No campaigns yet"
-- regardless of what was in engagement_workflows for the active client.

ALTER TABLE public.engagement_workflows
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active  boolean NOT NULL DEFAULT true;

-- Belt-and-braces backfill for the only existing row (BFD's default cadence).
-- The DEFAULTs above already cover this, but we keep the explicit UPDATE so
-- a future rebuild that re-runs the migration on a populated table is obviously safe.
UPDATE public.engagement_workflows
SET sort_order = COALESCE(sort_order, 0),
    is_active  = COALESCE(is_active, true)
WHERE sort_order IS NULL OR is_active IS NULL;
