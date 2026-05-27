-- Phase 1b of voice-setters redesign: add voice_setter_id FK to prompts table.
-- Voice setter prompts join to voice_setters via this column instead of by slot_id pattern.
-- Text setters keep their existing slot_id (Setter-1, Setter-2, …) untouched.

ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS voice_setter_id uuid
    REFERENCES public.voice_setters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prompts_voice_setter_id
  ON public.prompts(voice_setter_id)
  WHERE voice_setter_id IS NOT NULL;
