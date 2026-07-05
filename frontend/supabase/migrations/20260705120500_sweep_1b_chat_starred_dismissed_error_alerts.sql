-- SWEEP-1b: /chats 404, ship the two per-client UI-state tables the browser reads/writes.
--   chat_starred          <- Chats.tsx (star a conversation)          upsert onConflict (client_id, lead_id)
--   dismissed_error_alerts<- useLeadErrorAlert.ts (dismiss a banner)  upsert onConflict (client_id, lead_id, error_log_id)
-- Old 2026-04 Lovable-era migrations for these tables were never applied to this project
-- (information_schema -> 0 rows); applied here to LIVE prod via the Management API (no migration
-- runner). Both are CLIENT-readable/writable UI state written under the client-role browser JWT, so
-- they use the agency_id-scoped FOR ALL policy WITHOUT the get_user_role()='agency' gate, the exact
-- client_account_field_config (20260617120000) pattern: a client-role JWT shares its client's agency_id
-- so it matches the policy for its own rows (read + write). No cross-tenant leak (scope = the client's
-- own agency; onboarding mints a fresh agency per top-level client). NOT the client_pricing_config
-- role-gated shape, which is for agency-only secret/cost inputs.

CREATE TABLE IF NOT EXISTS public.chat_starred (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id, lead_id)
);

ALTER TABLE public.chat_starred ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage starred chats for their clients"
ON public.chat_starred
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

CREATE TABLE IF NOT EXISTS public.dismissed_error_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_id text NOT NULL,
  error_log_id uuid NOT NULL,
  dismissed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id, lead_id, error_log_id)
);

ALTER TABLE public.dismissed_error_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage dismissed error alerts for their clients"
ON public.dismissed_error_alerts
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

NOTIFY pgrst, 'reload schema';
