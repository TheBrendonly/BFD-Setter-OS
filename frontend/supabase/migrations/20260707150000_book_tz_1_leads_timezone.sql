-- 20260707150000_book_tz_1_leads_timezone.sql
-- BOOK-TZ-1 — per-lead timezone (display only).
--
-- The whole booking flow runs in the business timezone (clients.timezone): GHL
-- availability is queried in it, slots are offered in it, and the appointment lands at
-- that wall-clock. That is correct for a business-owned calendar, but a lead in another
-- zone (e.g. Perth, +08:00) who is told "2pm" is silently booked at 2pm Sydney (= 12pm
-- their time). This column captures the LEAD's own timezone so the setter can state
-- offered times in the lead's zone while still booking the business-tz absolute time.
--
-- Populated from the GHL contact's timezone attribute at intake/sync (IANA-validated;
-- GHL sometimes stores non-IANA labels, which are rejected). NULL = fall back to the
-- business timezone (exactly today's behaviour). Never changes what time is booked.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.leads.timezone IS
  'BOOK-TZ-1: the lead''s own IANA timezone (from the GHL contact). Display-only — offered slots are shown in this zone while the booked absolute time stays business-tz. NULL = use clients.timezone.';

NOTIFY pgrst, 'reload schema';
