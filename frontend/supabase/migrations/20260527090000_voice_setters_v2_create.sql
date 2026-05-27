-- Phase 1 of voice-setters redesign (plan: ~/.claude/plans/i-had-a-friend-imperative-hare.md).
-- Creates first-class voice_setters + voice_setter_phone_bindings tables.
-- Additive only. Legacy slot columns on clients/prompts remain until Phase 7 cleanup migration.

-- ── voice_setters ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_setters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name            text NOT NULL,
  retell_agent_id text,
  retell_llm_id   text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_voice_setters_client_id ON public.voice_setters(client_id);
CREATE INDEX IF NOT EXISTS idx_voice_setters_retell_agent_id ON public.voice_setters(retell_agent_id) WHERE retell_agent_id IS NOT NULL;

-- ── voice_setter_phone_bindings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_setter_phone_bindings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL,
  direction   text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  setter_id   uuid NOT NULL REFERENCES public.voice_setters(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, phone_e164, direction)
);

CREATE INDEX IF NOT EXISTS idx_vspb_setter_id ON public.voice_setter_phone_bindings(setter_id);
CREATE INDEX IF NOT EXISTS idx_vspb_client_phone ON public.voice_setter_phone_bindings(client_id, phone_e164);

-- ── updated_at trigger on voice_setters ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_voice_setters_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS voice_setters_updated_at ON public.voice_setters;
CREATE TRIGGER voice_setters_updated_at
  BEFORE UPDATE ON public.voice_setters
  FOR EACH ROW EXECUTE FUNCTION public.touch_voice_setters_updated_at();

-- ── RLS: agency-scoped (mirrors agent_settings + leads pattern) ─────────────
ALTER TABLE public.voice_setters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_all_voice_setters" ON public.voice_setters;
CREATE POLICY "agency_all_voice_setters" ON public.voice_setters
  FOR ALL TO authenticated
  USING (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ))
  WITH CHECK (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ));

ALTER TABLE public.voice_setter_phone_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agency_all_voice_setter_phone_bindings" ON public.voice_setter_phone_bindings;
CREATE POLICY "agency_all_voice_setter_phone_bindings" ON public.voice_setter_phone_bindings
  FOR ALL TO authenticated
  USING (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ))
  WITH CHECK (client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
  ));
