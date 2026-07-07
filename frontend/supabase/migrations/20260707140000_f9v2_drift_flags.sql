-- 20260707140000_f9v2_drift_flags.sql
-- F9 v2 — persisted drift signals for LOCKED voice setters.
--
-- v1 computes drift only in the browser (PromptManagement) as a live version compare
-- when the list is open. These columns let the scheduled poll (trigger/pollRetellDrift)
-- record drift server-side so the tile badge shows it WITHOUT a live get-agent call,
-- and so the alert is caught even when no one opens PromptManagement. Set by the poll,
-- cleared by pull-retell-config (drift resolved) and by unlock (guard no longer relevant).

ALTER TABLE public.voice_setters
  ADD COLUMN IF NOT EXISTS retell_drift_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS retell_booking_tools_lost_at timestamptz;

COMMENT ON COLUMN public.voice_setters.retell_drift_detected_at IS
  'F9 v2: set by pollRetellDrift when a locked agent''s live version > retell_synced_version; cleared on pull/unlock.';
COMMENT ON COLUMN public.voice_setters.retell_booking_tools_lost_at IS
  'F9 v2: set by pollRetellDrift when a locked agent''s LLM has lost all BFD booking tools (booking would silently break); cleared on pull/unlock.';

NOTIFY pgrst, 'reload schema';
