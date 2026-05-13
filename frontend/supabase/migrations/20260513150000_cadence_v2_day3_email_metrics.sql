-- Cadence v2 — Day 3 metrics columns.
-- email channel ships in this commit; emails_sent + ai_cost_cents +
-- cost_estimate_cents are written to cadence_metrics from writeCadenceMetrics
-- on every cadence terminal state. ai_cost is populated by Day 4-5
-- AI-generated copy; cost_estimate by Day 7 cost-ceiling guard.

ALTER TABLE cadence_metrics
  ADD COLUMN IF NOT EXISTS emails_sent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_cost_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_estimate_cents integer NOT NULL DEFAULT 0;
