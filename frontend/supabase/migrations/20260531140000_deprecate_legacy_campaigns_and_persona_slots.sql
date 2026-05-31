-- Deprecate legacy CSV-campaign reactivation + the Try-Gary persona-slot override.
--
-- 2026-05-31. Native reactivation (CampaignCreate -> reactivate-lead-list ->
-- engagement_executions / runEngagement) has fully replaced the old
-- campaign_leads -> campaign-executor -> external-webhook path. The
-- campaign-executor and bulk-insert-leads edge functions were removed this
-- session. The `campaign_leads` table no longer exists in this database, so
-- there is nothing to drop for it.
--
-- Agent-per-form is now tag-per-campaign only; the within-cadence persona-slot
-- override (clients.try_gary_persona_slots, consumed by ghl-tag-webhook's
-- handleTryGaryLanding) is retired. The column is left in place to avoid
-- breaking any historical reference, but it is no longer read by any code.
--
-- This migration is documentation-only (COMMENTs); it changes no data or
-- structure and is safe to re-run.

COMMENT ON TABLE public.campaigns IS
  'DEPRECATED 2026-05-31: legacy CSV-campaign metadata. Native reactivation uses engagement_executions; this table is read only by the legacy campaign Dashboard/CampaignDetail UI. Do not build new features against it.';

COMMENT ON COLUMN public.clients.try_gary_persona_slots IS
  'DEPRECATED 2026-05-31: Try-Gary persona-slot voice-setter override is retired. Agent selection is now per-campaign (tag-per-campaign). No code reads this column.';
