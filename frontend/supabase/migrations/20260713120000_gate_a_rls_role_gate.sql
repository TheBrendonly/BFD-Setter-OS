-- GATE A — RLS role-gate cluster (pre-first-client hardening). Plan-mode session 2026-07-13.
--
-- WHY: the browser talks to the platform DB with the anon key, so RLS is the ONLY tenant
-- boundary for direct reads/writes. Every agency `FOR ALL` / agency_id-scoped policy below is
-- matched by a CLIENT-role JWT too (a client's profiles.agency_id == its own client's
-- agency_id — "THE TRAP" documented in 20260701140000). Today 0 client-role users exist so this
-- is LATENT, but the instant the first client-role user is invited an ungated policy hands that
-- user read/write over every sibling client in the shared agency: supabase_service_key (full
-- service-role key), Twilio tokens, the BFD-bundled Retell/OpenRouter/GHL keys, sibling leads,
-- tags, prompts, cost/margin. This migration role-gates the whole cluster. Mirrors the shape
-- already shipped by client_pricing_config (20260701140000) + RLS-UISTATE-1 (20260708121000).
--
-- DESIGN (approved 2026-07-13):
--  * clients: COMMAND-SPLIT. SELECT/INSERT/DELETE -> agency-role only (clients read via
--    clients_public, so no read breaks). UPDATE -> agency-role OR client-own-row, because ~36
--    client-reachable browser paths write UI-state/self-service config directly to clients. A
--    BEFORE UPDATE guard trigger freezes subscription_status + the BFD-bundled SHARED infra keys
--    for client-role writers (closes the billing-gate self-escalation a bare client-own UPDATE
--    would reintroduce). NO client SELECT policy -> a client cannot read its own base row's
--    bundled secrets. (REVOKE on secret columns deliberately NOT used: the agency browser writes
--    secrets via ApiCredentials as `authenticated`, so a blanket REVOKE would break agency saves;
--    the agency-only SELECT gate already closes the cross-tenant read.)
--  * credentials / openrouter_usage_cache / unipile_accounts: prepend the agency role gate
--    (agency-only; none are client-writable). openrouter_usage_cache stays agency-only (the
--    edge fn get-openrouter-usage is role-gated to agency in the same change; the client ticker
--    read is role-branched off in the frontend).
--  * agencies: role-gate the UPDATE only (the RLS-AGENCIES-1 finding). SELECT already matches only
--    the user's OWN agency (own name/branding), so it is left as-is; INSERT is the bootstrap path.
--  * tenant-disjunction parents (client_custom_fields, lead_ai_columns, lead_tags,
--    prompt_chat_threads, prompt_docs, prompt_versions, setter_ai_reports): replace the single
--    disjunction policy (c.agency_id=p.agency_id OR c.id=p.client_id -> agency-wide for clients)
--    with the RLS-UISTATE-1 two-policy split (agency role-gated FOR ALL + client-own FOR ALL).
--  * leads (added to scope 2026-07-13): same two-policy split. Children lead_ai_values /
--    lead_tag_assignments delegate to leads (lead_id IN (SELECT id FROM leads)) and inherit the
--    tightened scope; prompt_chat_messages inherits the split prompt_chat_threads. Children left
--    as-is by design.
--
-- Depends on the deterministic get_user_role (20260708120000) and get_user_client_id
-- (20260317080921), both SECURITY DEFINER (bypass RLS, safe inside policies/triggers).
-- Verified read-only against live pg_policies on 2026-07-13 before authoring; every DROP name
-- below is the exact LIVE policy name (the migration-file rebuild names are NOT live).

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 1. clients (RLS-CLIENTS-1, Critical) — command-split + guard trigger
-- ═══════════════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Agency users can view their clients" ON public.clients;
CREATE POLICY "Agency users can view their clients" ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id)
  );

DROP POLICY IF EXISTS "Agency users can insert clients" ON public.clients;
CREATE POLICY "Agency users can insert clients" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'agency'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id)
  );

DROP POLICY IF EXISTS "Agency users can update clients" ON public.clients;
CREATE POLICY "Agency users can update clients" ON public.clients
  FOR UPDATE TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id)
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'agency'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id)
  );

DROP POLICY IF EXISTS "Agency users can delete clients" ON public.clients;
CREATE POLICY "Agency users can delete clients" ON public.clients
  FOR DELETE TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = clients.agency_id)
  );

-- client-role users may UPDATE ONLY their own clients row (base id == the user's client_id).
-- Column freeze for the sensitive columns is enforced by the guard trigger below. There is
-- deliberately NO client SELECT policy (reads go through clients_public). The frontend UI-state
-- writes use `.update(...).eq('id', clientId)` with return=minimal (no RETURNING), so no SELECT
-- privilege is needed for these updates.
DROP POLICY IF EXISTS "client_own_clients_update" ON public.clients;
CREATE POLICY "client_own_clients_update" ON public.clients
  FOR UPDATE TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'client'
    AND id = public.get_user_client_id(auth.uid())
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'client'
    AND id = public.get_user_client_id(auth.uid())
  );

-- Guard trigger: a client-role user writing its own clients row MUST NOT change
-- subscription_status (billing-gate self-escalation) or the BFD-bundled SHARED infra keys
-- (retell/openrouter/openrouter_management/ghl — BFD's, not the client's). supabase_service_key
-- and twilio_auth_token are the client's OWN external creds (client-writable via ChatAnalytics),
-- so they are NOT frozen. Service-role writes (auth.uid() IS NULL -> get_user_role NULL) and
-- agency writes are unaffected.
CREATE OR REPLACE FUNCTION public.guard_client_clients_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role(auth.uid()) = 'client' THEN
    IF NEW.subscription_status        IS DISTINCT FROM OLD.subscription_status
       OR NEW.retell_api_key           IS DISTINCT FROM OLD.retell_api_key
       OR NEW.openrouter_api_key        IS DISTINCT FROM OLD.openrouter_api_key
       OR NEW.openrouter_management_key IS DISTINCT FROM OLD.openrouter_management_key
       OR NEW.ghl_api_key               IS DISTINCT FROM OLD.ghl_api_key
    THEN
      RAISE EXCEPTION 'client-role users cannot modify protected clients columns (subscription_status / bundled infra keys)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_client_clients_update ON public.clients;
CREATE TRIGGER guard_client_clients_update
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_client_clients_update();

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 2. credentials (RLS-CREDENTIALS-1) / openrouter_usage_cache (RLS-ORUSAGE-1) /
--    unipile_accounts (RLS-UNIPILE-1) — prepend the agency role gate (agency-only)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "agency_all_credentials" ON public.credentials;
CREATE POLICY "agency_all_credentials" ON public.credentials
  FOR ALL TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND gohighlevel_location_id IN (
      SELECT clients.ghl_location_id FROM clients
      WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
    )
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'agency'
    AND gohighlevel_location_id IN (
      SELECT clients.ghl_location_id FROM clients
      WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can manage openrouter usage cache" ON public.openrouter_usage_cache;
CREATE POLICY "Users can manage openrouter usage cache" ON public.openrouter_usage_cache
  FOR ALL TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT c.id FROM clients c JOIN profiles p ON p.agency_id = c.agency_id WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT c.id FROM clients c JOIN profiles p ON p.agency_id = c.agency_id WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can manage unipile accounts for their clients" ON public.unipile_accounts;
CREATE POLICY "Users can manage unipile accounts for their clients" ON public.unipile_accounts
  FOR ALL TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT c.id FROM clients c WHERE c.agency_id IN (SELECT p.agency_id FROM profiles p WHERE p.id = auth.uid())
    )
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT c.id FROM clients c WHERE c.agency_id IN (SELECT p.agency_id FROM profiles p WHERE p.id = auth.uid())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 3. agencies (RLS-AGENCIES-1) — role-gate the UPDATE only. SELECT already matches only the
--    user's OWN agency (branding/name), no cross-tenant leak; INSERT is the bootstrap path.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Agency users can update their agency" ON public.agencies;
CREATE POLICY "Agency users can update their agency" ON public.agencies
  FOR UPDATE TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.agency_id = agencies.id)
  );

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 4. Tenant-disjunction parents (RLS-TENANT-DISJUNCTION-1 + RLS-TAGTABLES-1) — two-policy split.
--    Belt-and-braces DROP of the legacy USING(true) tag names (live shows them already gone).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can manage lead tags" ON public.lead_tags;
DROP POLICY IF EXISTS "Users can manage lead tag assignments" ON public.lead_tag_assignments;

-- client_custom_fields
DROP POLICY IF EXISTS "client_custom_fields_tenant_scoped" ON public.client_custom_fields;
DROP POLICY IF EXISTS "agency_all_client_custom_fields" ON public.client_custom_fields;
DROP POLICY IF EXISTS "client_own_client_custom_fields" ON public.client_custom_fields;
CREATE POLICY "agency_all_client_custom_fields" ON public.client_custom_fields
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_client_custom_fields" ON public.client_custom_fields
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

-- lead_ai_columns
DROP POLICY IF EXISTS "lead_ai_columns_tenant_scoped" ON public.lead_ai_columns;
DROP POLICY IF EXISTS "agency_all_lead_ai_columns" ON public.lead_ai_columns;
DROP POLICY IF EXISTS "client_own_lead_ai_columns" ON public.lead_ai_columns;
CREATE POLICY "agency_all_lead_ai_columns" ON public.lead_ai_columns
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_lead_ai_columns" ON public.lead_ai_columns
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

-- lead_tags
DROP POLICY IF EXISTS "lead_tags_tenant_scoped" ON public.lead_tags;
DROP POLICY IF EXISTS "agency_all_lead_tags" ON public.lead_tags;
DROP POLICY IF EXISTS "client_own_lead_tags" ON public.lead_tags;
CREATE POLICY "agency_all_lead_tags" ON public.lead_tags
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_lead_tags" ON public.lead_tags
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

-- prompt_chat_threads
DROP POLICY IF EXISTS "prompt_chat_threads_tenant_scoped" ON public.prompt_chat_threads;
DROP POLICY IF EXISTS "agency_all_prompt_chat_threads" ON public.prompt_chat_threads;
DROP POLICY IF EXISTS "client_own_prompt_chat_threads" ON public.prompt_chat_threads;
CREATE POLICY "agency_all_prompt_chat_threads" ON public.prompt_chat_threads
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_prompt_chat_threads" ON public.prompt_chat_threads
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

-- prompt_docs
DROP POLICY IF EXISTS "prompt_docs_tenant_scoped" ON public.prompt_docs;
DROP POLICY IF EXISTS "agency_all_prompt_docs" ON public.prompt_docs;
DROP POLICY IF EXISTS "client_own_prompt_docs" ON public.prompt_docs;
CREATE POLICY "agency_all_prompt_docs" ON public.prompt_docs
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_prompt_docs" ON public.prompt_docs
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

-- prompt_versions
DROP POLICY IF EXISTS "prompt_versions_tenant_scoped" ON public.prompt_versions;
DROP POLICY IF EXISTS "agency_all_prompt_versions" ON public.prompt_versions;
DROP POLICY IF EXISTS "client_own_prompt_versions" ON public.prompt_versions;
CREATE POLICY "agency_all_prompt_versions" ON public.prompt_versions
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_prompt_versions" ON public.prompt_versions
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

-- setter_ai_reports
DROP POLICY IF EXISTS "setter_ai_reports_tenant_scoped" ON public.setter_ai_reports;
DROP POLICY IF EXISTS "agency_all_setter_ai_reports" ON public.setter_ai_reports;
DROP POLICY IF EXISTS "client_own_setter_ai_reports" ON public.setter_ai_reports;
CREATE POLICY "agency_all_setter_ai_reports" ON public.setter_ai_reports
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_setter_ai_reports" ON public.setter_ai_reports
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 5. leads (LEADS-ROLE-SPLIT-1, added to scope 2026-07-13) — two-policy split. Children
--    lead_ai_values_via_lead / lead_tag_assignments_via_lead inherit via `lead_id IN (SELECT id
--    FROM leads)` and are intentionally left unchanged.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "agency_all_leads" ON public.leads;
DROP POLICY IF EXISTS "client_own_leads" ON public.leads;
CREATE POLICY "agency_all_leads" ON public.leads
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())))
  WITH CHECK (public.get_user_role(auth.uid()) = 'agency' AND client_id IN (
    SELECT clients.id FROM clients WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())));
CREATE POLICY "client_own_leads" ON public.leads
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()))
  WITH CHECK (public.get_user_role(auth.uid()) = 'client' AND client_id = public.get_user_client_id(auth.uid()));

NOTIFY pgrst, 'reload schema';
