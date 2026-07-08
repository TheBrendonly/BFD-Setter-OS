-- RLS-UISTATE-1 (BUG_LIST, 2026-07-07 security review) — role-split the chat_starred /
-- dismissed_error_alerts FOR ALL policies. sweep_1b (20260705120500) shipped ONE agency_id-scoped
-- FOR ALL policy with NO get_user_role() gate, correct ONLY while "one agency per top-level client"
-- holds (if two real clients ever share an agency, client A's browser JWT could read/write client B's
-- starred chats + dismissed alerts). Same trap class RLS-SHAPE-1 (20260703120000) + the F8 pricing
-- table (20260701140000) sealed. Defense-in-depth split:
--   agency role -> FOR ALL across the agency's clients, gated get_user_role(auth.uid())='agency';
--   client role -> FOR ALL on its OWN client's rows only, client_id = get_user_client_id(auth.uid())
--                  (profiles.client_id, the setter_ai_reports 20260402170851 shape). These are
--                  client-writable UI-state tables (Chats.tsx star, useLeadErrorAlert.ts dismiss), so
--                  the client keeps read+write, scoped to its own client instead of the whole agency.
-- Not exploitable today (live: 1 agency / 2 BFD-internal clients / 0 client-role users); pre-first-client
-- hardening. Depends on the deterministic get_user_role from 20260708120000.

-- ── chat_starred ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage starred chats for their clients" ON public.chat_starred;
DROP POLICY IF EXISTS "agency_all_chat_starred" ON public.chat_starred;
DROP POLICY IF EXISTS "client_own_chat_starred" ON public.chat_starred;

CREATE POLICY "agency_all_chat_starred" ON public.chat_starred
  FOR ALL TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT clients.id FROM clients
      WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
    )
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT clients.id FROM clients
      WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );

CREATE POLICY "client_own_chat_starred" ON public.chat_starred
  FOR ALL TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'client'
    AND client_id = public.get_user_client_id(auth.uid())
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'client'
    AND client_id = public.get_user_client_id(auth.uid())
  );

-- ── dismissed_error_alerts ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage dismissed error alerts for their clients" ON public.dismissed_error_alerts;
DROP POLICY IF EXISTS "agency_all_dismissed_error_alerts" ON public.dismissed_error_alerts;
DROP POLICY IF EXISTS "client_own_dismissed_error_alerts" ON public.dismissed_error_alerts;

CREATE POLICY "agency_all_dismissed_error_alerts" ON public.dismissed_error_alerts
  FOR ALL TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT clients.id FROM clients
      WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
    )
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT clients.id FROM clients
      WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );

CREATE POLICY "client_own_dismissed_error_alerts" ON public.dismissed_error_alerts
  FOR ALL TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'client'
    AND client_id = public.get_user_client_id(auth.uid())
  )
  WITH CHECK (
    public.get_user_role(auth.uid()) = 'client'
    AND client_id = public.get_user_client_id(auth.uid())
  );

NOTIFY pgrst, 'reload schema';
