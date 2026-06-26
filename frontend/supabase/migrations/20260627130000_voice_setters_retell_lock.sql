-- 20260627130000_voice_setters_retell_lock.sql
-- F9: per-setter Retell lock + ownership sync.
--
-- When is_retell_locked is true, BFD stops managing that setter: every BFD->Retell
-- write path refuses it (single-target throws 423; bulk loops skip it) and the
-- outbound at-call voicemail PATCH is skipped (the call still dials). The mirror
-- columns hold an on-demand "Pull from Retell" snapshot + a version basis for
-- drift detection. Additive + idempotent. v1 = on-demand pull only (no poll).
BEGIN;

ALTER TABLE public.voice_setters
  ADD COLUMN IF NOT EXISTS is_retell_locked       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retell_locked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS retell_synced_at       timestamptz,
  ADD COLUMN IF NOT EXISTS retell_synced_version  int,
  ADD COLUMN IF NOT EXISTS retell_config_snapshot jsonb;

-- The guard runs `WHERE client_id = $ AND is_retell_locked = true` on every
-- guarded retell-proxy write. Partial index mirrors the is_inbound precedent.
CREATE INDEX IF NOT EXISTS voice_setters_locked_by_client
  ON public.voice_setters (client_id)
  WHERE is_retell_locked = true;

COMMIT;
