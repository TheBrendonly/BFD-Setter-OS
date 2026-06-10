-- Audit 2026-06-10 (DI-4 / handoff task 1): process-lead-file references five
-- tables that exist in the dev DB but were never created on the platform DB
-- (bjgrgbgykvjrsuwwruoh), and its import/export paths read four leads columns
-- the platform leads table lacks. Schemas mirror the dev-DB shapes in types.ts
-- plus the exact usage in frontend/supabase/functions/process-lead-file/index.ts.
-- Everything is idempotent so the migration is safe on the dev DB too.

CREATE TABLE IF NOT EXISTS public.lead_ai_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  column_name text NOT NULL,
  prompt_template text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_ai_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  ai_column_id uuid REFERENCES public.lead_ai_columns(id) ON DELETE CASCADE,
  generated_value text,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, ai_column_id)
);

CREATE TABLE IF NOT EXISTS public.lead_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#646E82',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- UNIQUE (lead_id, tag_id) is load-bearing: process-lead-file upserts with
-- onConflict: 'lead_id,tag_id' (index.ts:797) and PostgREST requires a matching
-- unique constraint or the upsert fails with 42P10.
CREATE TABLE IF NOT EXISTS public.lead_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.lead_tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (lead_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.client_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, field_name)
);

CREATE INDEX IF NOT EXISTS lead_ai_columns_client_id_idx ON public.lead_ai_columns (client_id);
CREATE INDEX IF NOT EXISTS lead_tags_client_id_idx ON public.lead_tags (client_id);
CREATE INDEX IF NOT EXISTS client_custom_fields_client_id_idx ON public.client_custom_fields (client_id);

-- Columns the import path inserts (index.ts:343-356) and buildLeadsCsv exports
-- (index.ts:661-694). tags holds the denormalized array of {name,color} objects.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS phone_valid boolean NOT NULL DEFAULT true;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'::jsonb;

-- RLS: agency/client-scoped, mirroring the F6 pattern
-- (20260605120000_f6_prompt_chat_rls_tenant_scope.sql). Service-role edge
-- functions bypass RLS; these policies exist for the browser (Contacts UI etc).
ALTER TABLE public.lead_ai_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_ai_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_custom_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_ai_columns_tenant_scoped" ON public.lead_ai_columns;
CREATE POLICY "lead_ai_columns_tenant_scoped" ON public.lead_ai_columns
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

DROP POLICY IF EXISTS "lead_tags_tenant_scoped" ON public.lead_tags;
CREATE POLICY "lead_tags_tenant_scoped" ON public.lead_tags
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

DROP POLICY IF EXISTS "client_custom_fields_tenant_scoped" ON public.client_custom_fields;
CREATE POLICY "client_custom_fields_tenant_scoped" ON public.client_custom_fields
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

-- Child tables have no client_id; scope via the parent row. leads carries the
-- tenant-scoped agency_all_leads policy, so RLS applies inside the subquery
-- (same delegation style as prompt_chat_messages in the F6 migration).
DROP POLICY IF EXISTS "lead_ai_values_via_lead" ON public.lead_ai_values;
CREATE POLICY "lead_ai_values_via_lead" ON public.lead_ai_values
  FOR ALL TO authenticated
  USING (
    lead_id IN (SELECT id FROM public.leads)
  )
  WITH CHECK (
    lead_id IN (SELECT id FROM public.leads)
  );

DROP POLICY IF EXISTS "lead_tag_assignments_via_lead" ON public.lead_tag_assignments;
CREATE POLICY "lead_tag_assignments_via_lead" ON public.lead_tag_assignments
  FOR ALL TO authenticated
  USING (
    lead_id IN (SELECT id FROM public.leads)
  )
  WITH CHECK (
    lead_id IN (SELECT id FROM public.leads)
  );
