-- Phase: audit-2026-06-10 (DI-6)
-- executeWorkflow.ts upserts workflow_execution_steps with
-- onConflict (execution_id, node_id), but no matching unique constraint exists
-- on the platform DB, so the upsert errors (a node re-run can't update in place).
-- Add the constraint idempotently; guard on table existence and de-dupe any
-- pre-existing duplicate (execution_id, node_id) rows (keep the latest ctid).
DO $$
BEGIN
  IF to_regclass('public.workflow_execution_steps') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.workflow_execution_steps'::regclass
         AND conname = 'workflow_execution_steps_exec_node_key'
     ) THEN
    DELETE FROM public.workflow_execution_steps a
      USING public.workflow_execution_steps b
      WHERE a.ctid < b.ctid
        AND a.execution_id = b.execution_id
        AND a.node_id = b.node_id;
    ALTER TABLE public.workflow_execution_steps
      ADD CONSTRAINT workflow_execution_steps_exec_node_key UNIQUE (execution_id, node_id);
  END IF;
END $$;
