-- 20260625130000_voice_setters_is_inbound.sql
-- F2(b): flag exactly ONE voice setter per client as the inbound responder.
--
-- Replaces the legacy prompts.directions=['inbound'] marker as the UUID-native
-- source of truth for "which setter answers the inbound number". Additive +
-- idempotent. Default false; the inbound setter is set explicitly via the UI
-- (which also rebinds the Retell inbound number), so we do NOT auto-backfill.
BEGIN;

ALTER TABLE public.voice_setters
  ADD COLUMN IF NOT EXISTS is_inbound boolean NOT NULL DEFAULT false;

-- At most one inbound setter per client. Partial unique index (mirrors the
-- existing voice_setters_client_legacy_slot_unique partial-index precedent).
CREATE UNIQUE INDEX IF NOT EXISTS voice_setters_one_inbound_per_client
  ON public.voice_setters (client_id)
  WHERE is_inbound = true;

COMMIT;
