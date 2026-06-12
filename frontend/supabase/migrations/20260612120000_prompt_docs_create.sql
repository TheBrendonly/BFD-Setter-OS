-- Voice setter doc-model (2026-06-12, Phase 0): canonical prompt document per
-- voice setter slot. After initial setup compiles the section editor's output,
-- this table (not prompt_configurations) is the source of truth for the prompt.
-- Additive and inert: nothing in the legacy app reads it.

CREATE TABLE IF NOT EXISTS public.prompt_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  slot_id text NOT NULL,
  engine_type text NOT NULL DEFAULT 'retell-llm'
    CHECK (engine_type IN ('retell-llm', 'conversation-flow')),
  doc_content text NOT NULL DEFAULT '',
  flow_outline jsonb,
  conversation_flow_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'deployed')),
  deployed_doc_content text,
  setup_completed_at timestamptz,
  promoted_from_full_prompt boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, slot_id)
);

ALTER TABLE public.prompt_docs ENABLE ROW LEVEL SECURITY;

-- Same agency/client tenant-scope predicate as prompt_versions
-- (20260610121000_audit_prompt_rls_tenant_scope.sql).
CREATE POLICY "prompt_docs_tenant_scoped" ON public.prompt_docs
  FOR ALL TO authenticated
  USING (
    client_id IN (
      SELECT c.id FROM public.clients c
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE c.agency_id = p.agency_id OR c.id = p.client_id
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT c.id FROM public.clients c
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE c.agency_id = p.agency_id OR c.id = p.client_id
    )
  );

-- Modify-with-AI meta prompt gets its own column. clients.system_prompt is
-- dual-used today: every setter save overwrites it with the full setter prompt
-- (PromptManagement persistPromptSnapshotToDb) while AIPromptDialog reads it as
-- the AI meta prompt, so the meta prompt is clobbered on each save.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ai_meta_prompt text;
UPDATE public.clients SET ai_meta_prompt = system_prompt WHERE ai_meta_prompt IS NULL;
