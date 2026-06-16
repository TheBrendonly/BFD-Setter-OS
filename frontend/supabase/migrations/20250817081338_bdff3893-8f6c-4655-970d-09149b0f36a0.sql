-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the campaign executor to run every minute
SELECT cron.schedule(
  'process-campaigns-every-minute',
  '* * * * *', -- Run every minute
  $$
  SELECT
    net.http_post(
        url:='https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/campaign-executor',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3emxjbWRvbWh0eXFqYWJ6dm5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNzU2NjUsImV4cCI6MjA3MDk1MTY2NX0.UK5sJg6901GnvxBFDL6-XWBNTmqfHU7ctBowfRCYSV8"}'::jsonb,
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);