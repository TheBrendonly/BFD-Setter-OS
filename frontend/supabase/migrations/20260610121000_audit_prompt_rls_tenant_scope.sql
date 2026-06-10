-- Audit 2026-06-10 (SEC-RLS-01): prompt_versions and setter_ai_reports were left
-- with permissive `FOR ALL TO authenticated USING (true)` policies when the F6
-- review (20260605120000) scoped the prompt-chat tables — any logged-in user
-- could read/write every tenant's prompt versions and setter AI reports.
-- Both tables have a client_id column, so replace the permissive policy with the
-- same agency/client-scoped predicate F6 uses. Service-role edge functions bypass
-- RLS and are unaffected. Verified live: each table currently has ONLY the
-- permissive policy, so replacement (not bare DROP) is required to keep the UI working.

DROP POLICY IF EXISTS "prompt_versions_all_authenticated" ON public.prompt_versions;
CREATE POLICY "prompt_versions_tenant_scoped" ON public.prompt_versions
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

DROP POLICY IF EXISTS "setter_ai_reports_all_authenticated" ON public.setter_ai_reports;
CREATE POLICY "setter_ai_reports_tenant_scoped" ON public.setter_ai_reports
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
