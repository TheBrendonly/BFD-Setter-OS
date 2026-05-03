-- phase-night-engagement-campaigns-missing-cols
-- Adds the two columns the Engagement editor (frontend/src/pages/Engagement.tsx)
-- and Workflows page were already selecting from + writing to, but which had
-- never been added to the schema.
--
-- Symptom: opening the editor for any engagement workflow showed a blank page.
-- Engagement.tsx:2787-2795 reads `enroll_webhook_token` + `text_setter_number`
-- via .maybeSingle() which silently returned null on the missing-column error,
-- the auto-create insert at :2799-2802 also failed on its RETURNING clause, the
-- page either crashed during render or stalled. `engagement_campaigns` had 0
-- rows total because every auto-create on every page-load had been failing
-- silently for the lifetime of the table.
--
-- types.ts:1867-1871 already declares both columns as Row fields, confirming
-- the schema was meant to have them but the ALTER never landed in production.

ALTER TABLE public.engagement_campaigns
  ADD COLUMN IF NOT EXISTS enroll_webhook_token text    NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS text_setter_number   integer NOT NULL DEFAULT 1;

-- enroll_webhook_token is the per-campaign auth token used by inbound enrol
-- webhooks to identify which campaign the lead belongs to. Must be unique so
-- no two campaigns can collide on the same incoming token.
ALTER TABLE public.engagement_campaigns
  ADD CONSTRAINT engagement_campaigns_enroll_token_unique UNIQUE (enroll_webhook_token);
