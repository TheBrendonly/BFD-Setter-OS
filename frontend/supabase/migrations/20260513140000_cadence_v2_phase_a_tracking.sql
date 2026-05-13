-- Cadence v2 — Phase A foundations.
-- Adds the message-timing primitives needed by the cold-reply nudge
-- scheduled task (trigger/nudgeColdReply.ts, ships next) and enables
-- the already-built schedule gating on engagement_workflows.
--
-- See /home/brendan/.claude/plans/resuming-from-srv-bfd-operations-handoff-polymorphic-kay.md
-- (approved 2026-05-13).

-- 1. Per-lead message-timing tracking. Distinct from leads.last_message_at
--    which exists for the Chats list preview UI; these track the
--    direction-aware deltas the cold-reply nudge relies on.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudge_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tagged_silent_after_engagement boolean NOT NULL DEFAULT false;

-- 2. Enable schedule gating on the engagement_workflows table. The
--    ScheduleConfig type + getScheduleAwareBatchTime + getNextScheduleWindow
--    helpers in runEngagement.ts (lines 778-789, 1396+) are already built;
--    this column lets clients configure {timezone, days, start_time,
--    end_time} per workflow and have the runtime gate engages on it.
ALTER TABLE engagement_workflows
  ADD COLUMN IF NOT EXISTS schedule jsonb;
