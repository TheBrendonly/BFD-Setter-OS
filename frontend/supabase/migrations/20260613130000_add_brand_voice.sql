-- Per-client brand voice notes, consumed by aiGenerateEngagementCopy when it
-- generates engagement copy. The generator already accepts a brandVoice arg;
-- this is the stored source for it. Nullable: null => the generator's built-in
-- default voice. Idempotent.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS brand_voice text;
