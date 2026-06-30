-- F8 — per-sub-account cost-to-price config (markup %, USD->display FX + buffer,
-- the editable rate table, component toggles, and the show-rate-to-client switch).
-- Mirrors client_account_field_config (20260617120000) EXCEPT for the RLS: this
-- table holds AGENCY-ONLY pricing inputs (the F8 analogue of the omitted secret
-- columns), so the client must NOT be able to read it at all.
--
-- THE TRAP (and why a verbatim copy of the field-config policy is NOT enough):
-- RLS on clients is row-level + agency-scoped with NO column protection, and a
-- real client is its OWN agency. create-client-user sets a client-role user's
-- profiles.agency_id = the agency's id, which EQUALS that client's
-- clients.agency_id. So the agency "manage your clients" FOR ALL policy
-- (matched by agency_id, NOT by role) ALSO matches a client-role JWT for its own
-- row — and FOR ALL includes SELECT. client_account_field_config can live with
-- that (clients are meant to read their own UI metadata), but this table holds
-- markup / FX / cost inputs, so we additionally require the AGENCY role. With the
-- role gate and NO client-read policy, a client-role JWT matches no policy and is
-- denied. The client reaches its blended $/min ONLY via the get-blended-rate edge
-- function (service role), and only when show_rate_to_client is on.

CREATE TABLE public.client_pricing_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id)
);

ALTER TABLE public.client_pricing_config ENABLE ROW LEVEL SECURITY;

-- Agency-manage-all, ROLE-GATED. Same agency_id scoping as
-- client_account_field_config, PLUS get_user_role(...) = 'agency' so a client-role
-- JWT (which shares its client's agency_id) does NOT match. The agency editor
-- writes this row directly under the agency JWT; service_role bypasses RLS for the
-- get-blended-rate read.
CREATE POLICY "Agency users can manage pricing config for their clients"
ON public.client_pricing_config
FOR ALL
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'agency'
  AND client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id IN (
      SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
)
WITH CHECK (
  public.get_user_role(auth.uid()) = 'agency'
  AND client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id IN (
      SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
);

-- DELIBERATELY NO "client users can read their own pricing config" SELECT policy.
-- Unlike client_account_field_config (UI metadata, client-readable by design),
-- this table holds markup / FX / cost inputs. The role-gated policy above is the
-- only policy; clients get ONLY the derived blended $/min via get-blended-rate.

NOTIFY pgrst, 'reload schema';
