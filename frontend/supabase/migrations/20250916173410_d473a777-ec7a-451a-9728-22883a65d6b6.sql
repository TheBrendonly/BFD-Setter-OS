-- Enable required extensions for cron scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Update the chat_analytics table to support multiple time ranges per client
ALTER TABLE public.chat_analytics 
DROP CONSTRAINT IF EXISTS chat_analytics_pkey;

-- Add unique constraint on client_id and time_range combination
ALTER TABLE public.chat_analytics 
ADD CONSTRAINT chat_analytics_client_timerange_unique UNIQUE (client_id, time_range);

-- Create cron job to auto-refresh analytics every 12 hours
SELECT cron.schedule(
  'auto-refresh-chat-analytics',
  '0 */12 * * *', -- Every 12 hours at minute 0
  $$
  SELECT
    net.http_post(
        url:='https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/auto-refresh-analytics',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3emxjbWRvbWh0eXFqYWJ6dm5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzNzU2NjUsImV4cCI6MjA3MDk1MTY2NX0.UK5sJg6901GnvxBFDL6-XWBNTmqfHU7ctBowfRCYSV8"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);

-- Create index for better performance on time range queries
CREATE INDEX IF NOT EXISTS idx_chat_analytics_client_timerange ON public.chat_analytics(client_id, time_range);
CREATE INDEX IF NOT EXISTS idx_chat_analytics_last_updated ON public.chat_analytics(last_updated DESC);