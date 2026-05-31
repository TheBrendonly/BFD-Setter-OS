-- Multi-tenant isolation: lock down internal queue tables (2026-05-31)
--
-- message_queue and active_trigger_runs had NO row-level security. They are
-- written/read only by service-role edge functions + Trigger.dev tasks (the
-- frontend never queries them — confirmed: they appear only in the generated
-- types.ts). Enabling RLS with no policies = deny-by-default for anon/auth
-- roles, while the service role continues to bypass RLS. This closes the
-- "no RLS" gap from the 2026-05-30 audit with zero runtime impact.
--
-- NOTE on the other audit items, after verification:
--   * execution_logs: its RLS policies reference campaigns.user_id, which DOES
--     exist (added in 20250816224220) and is set on insert — so those policies
--     work (user-scoped). The "unguarded" finding was a false alarm; left as-is.
--   * campaigns.client_id NOT NULL + the campaign-executor auth guard are
--     deferred: that subsystem is being retired now that reactivation runs on
--     the native engine.
--   * Cross-client phone-uniqueness is audit-gated — see
--     20260531140000_phone_uniqueness_GATED.sql (apply only after confirming no
--     duplicate numbers across clients).

ALTER TABLE public.message_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_trigger_runs ENABLE ROW LEVEL SECURITY;
