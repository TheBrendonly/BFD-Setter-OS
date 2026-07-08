-- ROLE-RESOLVE-1 (BUG_LIST, 2026-07-07 security review) — make get_user_role deterministic.
-- The 20260317080921 definition SELECTs role::text ... LIMIT 1 with NO ORDER BY: a user holding BOTH
-- an 'agency' and a 'client' row resolves nondeterministically. Every role-gated surface keys off this
-- value (client_pricing_config policy, sms_delivery_events RLS-SHAPE-1 gate, the chat_starred /
-- dismissed_error_alerts RLS-UISTATE-1 split, AuthProvider routing), so resolve deterministically and
-- prefer the MORE-privileged role. In practice users hold exactly one row (create-client-user /
-- invite-client-user UPDATE the single row); this is defense-in-depth. Signature / RETURNS text /
-- STABLE / SECURITY DEFINER / search_path all unchanged — CREATE OR REPLACE swaps the body in place.
-- role is enum app_role('agency','client'); the CASE keeps the preference explicit rather than leaning
-- on enum declaration order, and future-proofs unknown values (ELSE 2).
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role WHEN 'agency' THEN 0 WHEN 'client' THEN 1 ELSE 2 END
  LIMIT 1
$$;

NOTIFY pgrst, 'reload schema';
