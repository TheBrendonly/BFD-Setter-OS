-- Per-sub-account governance over which "My Account" fields a client may SEE and EDIT.
-- Mirrors client_menu_config (20260318150754) exactly: per-client row, jsonb config,
-- agency-manage-ALL + client-read-own RLS. The client never WRITES this table; the
-- governed writes to the clients row go through the save-account-settings edge function.

CREATE TABLE public.client_account_field_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id)
);

ALTER TABLE public.client_account_field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage account field config for their clients"
ON public.client_account_field_config
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

-- Allow client-role users to read their own field-governance config
CREATE POLICY "Client users can read their own account field config"
ON public.client_account_field_config
FOR SELECT
TO authenticated
USING (
  client_id = public.get_user_client_id(auth.uid())
);
