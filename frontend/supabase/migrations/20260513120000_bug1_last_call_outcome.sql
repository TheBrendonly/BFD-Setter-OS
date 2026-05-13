-- Bug 1 — cadence sends "missed call" SMS during active call.
-- Adds a coordination column between retell-call-webhook (writer) and
-- trigger/runEngagement.ts (reader). When the cadence places a Retell call,
-- it polls this column until the matching call_id appears, then classifies
-- the disconnect_reason to decide whether to terminate (human pickup +
-- treat_pickup_as_reply) or advance (missed → next channel sends the
-- "just tried calling" SMS).
--
-- Shape: { call_id, disconnect_reason, call_status, ended_at }
ALTER TABLE engagement_executions
  ADD COLUMN IF NOT EXISTS last_call_outcome JSONB;
