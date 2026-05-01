-- 20260501150000_phase_a3e_contact_merge_candidates.sql
-- Phase A3e — contact_merge_candidates table.
--
-- When voice-booking-tools resolves a contact for an inbound caller, it
-- looks up GHL by phone first (via /contacts/?query=<phone>). If no match
-- is found, a new GHL contact is created and a row is inserted here so
-- the agency owner can review whether the new contact should be merged
-- with an existing one (e.g. caller used a different phone last time but
-- gave the same email/name).
--
-- Agent prompt asks "have we spoken before?" and passes the boolean as
-- caller_claims_prior_contact — high-priority candidates filter on that.

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_merge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ghl_contact_id TEXT NOT NULL,
  caller_phone TEXT,
  caller_email TEXT,
  caller_name TEXT,
  caller_claims_prior_contact BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'voice-booking-tools',
  source_call_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  notes TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_merge_candidates_client_status_idx
  ON public.contact_merge_candidates(client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS contact_merge_candidates_priority_idx
  ON public.contact_merge_candidates(client_id, caller_claims_prior_contact, status)
  WHERE caller_claims_prior_contact = TRUE AND status = 'pending';

ALTER TABLE public.contact_merge_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage all contact_merge_candidates"
  ON public.contact_merge_candidates;
CREATE POLICY "Service role can manage all contact_merge_candidates"
  ON public.contact_merge_candidates
  AS PERMISSIVE FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Mirrors the agency_all_bookings policy pattern (phase 7a):
-- profiles.id is the auth.users.id; agency_id on profiles ties them to a client.
DROP POLICY IF EXISTS "agency_all_contact_merge_candidates"
  ON public.contact_merge_candidates;
CREATE POLICY "agency_all_contact_merge_candidates"
  ON public.contact_merge_candidates
  AS PERMISSIVE FOR ALL
  TO authenticated
  USING (
    client_id IN (
      SELECT clients.id
      FROM clients
      WHERE clients.agency_id = (
        SELECT profiles.agency_id FROM profiles WHERE profiles.id = auth.uid()
      )
    )
  );

COMMIT;
