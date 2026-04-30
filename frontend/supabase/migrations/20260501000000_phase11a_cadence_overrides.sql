-- 20260501000000_phase11a_cadence_overrides.sql
-- Phase 11a — schema for the Cadence UI completion + Retell voicemail
-- native + ghl-tag-webhook work scoped in Docs/NEXT_SESSION_PROMPT.md.
-- Idempotent.

BEGIN;

-- ── engagement_workflows: per-workflow overrides ──────────────────────────
ALTER TABLE public.engagement_workflows
  ADD COLUMN IF NOT EXISTS quiet_hours_override jsonb,
  ADD COLUMN IF NOT EXISTS is_new_leads_campaign boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS new_leads_tag text,
  ADD COLUMN IF NOT EXISTS voicemail_config jsonb;

-- Enforce: at most ONE workflow per client may have is_new_leads_campaign=true.
-- A partial unique index is the right primitive (race-safe; CHECK can't reach
-- across rows). When a second workflow tries to flip ON, the UI / RPC must
-- first set the previous one OFF in the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS engagement_workflows_one_new_leads_per_client
  ON public.engagement_workflows (client_id)
  WHERE is_new_leads_campaign = true;

-- Index for the ghl-tag-webhook lookup hot path:
-- "find the active New-Leads workflow for a given (client, tag)"
CREATE INDEX IF NOT EXISTS engagement_workflows_new_leads_tag_idx
  ON public.engagement_workflows (client_id, new_leads_tag)
  WHERE is_new_leads_campaign = true;

-- ── clients: per-client GHL last_synced_from field id (D-M5 de-BFD-ify) ──
-- Today push-contact-to-ghl/index.ts:35 has a hardcoded BFD-only constant.
-- This column lets each client store their own field id (created in their
-- own GHL location at onboarding time).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ghl_last_synced_from_field_id text;

-- Backfill BFD's existing field id so behaviour is unchanged on day one.
-- Safe: only updates the existing BFD row; matches the constant being
-- removed from the edge function in this same phase.
UPDATE public.clients
SET ghl_last_synced_from_field_id = 'PQNTqtTnIw9Uu0XLLE5M'
WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925'
  AND ghl_last_synced_from_field_id IS NULL;

COMMIT;
