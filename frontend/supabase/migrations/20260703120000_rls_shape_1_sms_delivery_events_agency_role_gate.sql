-- RLS-SHAPE-1 (BUG_LIST, found in the 2026-07-02 full re-audit) — add the
-- get_user_role(...) = 'agency' gate to the sms_delivery_events agency SELECT
-- policy. Same trap class the F8 pricing table sealed (20260701140000): every
-- client IS its own agency (a client-role user's profiles.agency_id EQUALS its
-- client's clients.agency_id), so the agency_id-scoped policy below ALSO matched
-- a client-role JWT, letting a client read its own raw Twilio delivery events
-- directly. Not cross-tenant, and there are zero browser reads of this table
-- today (F13 usage counting runs service-role inside get-client-usage), so this
-- is shape hardening, not an active leak.
--
-- Staged on feature/overnight-bugfix 2026-07-03; NOT applied to live yet.

DROP POLICY IF EXISTS "agency_select_sms_delivery_events" ON public.sms_delivery_events;
CREATE POLICY "agency_select_sms_delivery_events" ON public.sms_delivery_events
  FOR SELECT TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'agency'
    AND client_id IN (
      SELECT clients.id FROM clients
      WHERE clients.agency_id = (SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );
