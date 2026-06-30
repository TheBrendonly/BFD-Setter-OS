-- F8 — per-sub-account cost-to-price config (markup %, USD->display FX + buffer,
-- the editable rate table, component toggles, and the show-rate-to-client switch).
-- Mirrors client_account_field_config (20260617120000) EXCEPT for the RLS: this
-- table holds AGENCY-ONLY pricing inputs (the F8 analogue of the omitted secret
-- columns), so it gets the agency-manage-all policy ONLY.
--
-- THE TRAP: RLS on clients is row-level + agency-scoped with NO column protection,
-- and a real client is its own agency, so a client-read SELECT policy here would
-- let a client-role JWT .select() the markup / FX / rate table straight into the
-- browser. The client reaches its blended $/min ONLY via the get-blended-rate edge
-- function (service role), which returns just the final scalar when the agency has
-- turned show_rate_to_client on. DELIBERATELY NO client-read SELECT policy below.

CREATE TABLE public.client_pricing_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id)
);

ALTER TABLE public.client_pricing_config ENABLE ROW LEVEL SECURITY;

-- Agency-manage-all (copied verbatim from client_account_field_config). The agency
-- editor writes this row directly under the agency JWT; service_role bypasses RLS
-- for the get-blended-rate read.
CREATE POLICY "Users can manage pricing config for their clients"
ON public.client_pricing_config
FOR ALL
TO authenticated
USING (
  client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id IN (
      SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
)
WITH CHECK (
  client_id IN (
    SELECT clients.id FROM clients
    WHERE clients.agency_id IN (
      SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
    )
  )
);

-- DELIBERATELY NO "client users can read their own pricing config" SELECT policy.
-- Unlike client_account_field_config (which holds only UI visibility metadata),
-- this table holds markup / FX / cost inputs. A client SELECT policy would leak
-- them. Clients receive ONLY the derived blended $/min via get-blended-rate.

NOTIFY pgrst, 'reload schema';
