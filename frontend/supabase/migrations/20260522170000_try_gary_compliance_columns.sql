-- Try Gary PR 1 — compliance + dedup
--
-- Adds compliance/audit columns to leads so every Try Gary submission carries
-- defensible evidence (consent text + version + timestamp, source IP, user
-- agent, UTM bundle, agent_style variant pick, source_type).
--
-- Per ACL s18 + Privacy Act APP 1.7-1.9 (effective 2026-12-10) we need to be
-- able to prove "this prospect agreed to X consent on Y date from Z source".
--
-- Also adds a partial index to support the application-level phone-dedup
-- guard in ghl-tag-webhook (skip enrolment if same client_id + phone seen in
-- the last 5 minutes).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS agent_style text,
  ADD COLUMN IF NOT EXISTS consent_text text,
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS source_ip inet,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS source_type text;

CREATE INDEX IF NOT EXISTS idx_leads_phone_dedup_lookup
  ON leads (client_id, phone, created_at DESC)
  WHERE phone IS NOT NULL;
