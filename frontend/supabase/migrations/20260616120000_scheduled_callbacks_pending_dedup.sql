-- 2026-06-16 (CAD-03): prevent duplicate AI callbacks → double-dial.
--
-- Two independent code paths insert into scheduled_callbacks with no dedup:
--   1. the in-call tool (voice-booking-tools toolScheduleCallback) when the
--      agent calls schedule-callback mid-call, and
--   2. the post-call webhook (retell-call-analysis-webhook) when call analysis
--      detects a "call me back" intent.
-- Each row triggers its own schedule-callback Trigger.dev run (keyed by the
-- row's UUID), so two rows for one request => two dials to the same lead 24h
-- later. The placeOutboundCall idempotency_key (`callback:${cb.id}`) cannot
-- dedup them because the ids differ.
--
-- Enforce "at most one PENDING callback per (client, contact)" at the DB level.
-- Partial index so completed/placed/cancelled rows never block a future
-- callback for the same contact. The webhook now also pre-checks (skip insert)
-- and the in-call tool treats a 23505 here as "already scheduled" (no second
-- dial, no false-fail to the caller).
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_callbacks_pending_contact_uidx
  ON public.scheduled_callbacks (client_id, ghl_contact_id)
  WHERE status = 'pending';
