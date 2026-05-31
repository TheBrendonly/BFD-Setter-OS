# Tracking & Analytics

## The funnel

```
1. Leads enrolled         (engagement_executions row created)
   │
   ▼
2. Leads texted           (cadence_metrics.sms_sent > 0)
   │
   ▼
3. Leads replied          (cadence_metrics.reply_received = true)
   │
   ▼
4. Leads called           (cadence_metrics.calls_attempted > 0)
   │
   ▼
5. Leads picked up        (cadence_metrics.calls_picked_up > 0)
   │
   ▼
6. Leads booked           (cadence_metrics.booking_created = true)
```

Per-cadence + per-day, drillable by client.

## Tables

### `bookings` (existing, extended in Phase 7a)
Source of truth for appointments. Populated by:
- `voice-booking-tools` after `book-appointments` succeeds
- `bookings-webhook` from GHL appointment-created/updated/cancelled

Add columns (idempotent migration):
```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cadence_execution_id uuid REFERENCES engagement_executions(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text;             -- 'voice_call' | 'manual' | 'ghl_calendar' | 'sms_link'
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status text DEFAULT 'confirmed';  -- 'confirmed' | 'cancelled' | 'no_show' | 'attended'
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS appointment_time timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lead_id text;
CREATE INDEX IF NOT EXISTS bookings_cadence_idx ON bookings (cadence_execution_id) WHERE cadence_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_lead_idx ON bookings (client_id, lead_id, appointment_time DESC);
```

### `sms_delivery_events` (NEW, Phase 7a)
Twilio status callbacks. One row per status update per MessageSid.
```sql
CREATE TABLE sms_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_message_sid text NOT NULL,
  status text NOT NULL,
  error_code int,
  error_message text,
  raw_payload jsonb,
  received_at timestamptz DEFAULT now()
);
CREATE INDEX sms_delivery_events_sid_idx ON sms_delivery_events (twilio_message_sid, received_at DESC);
```

`status` values per Twilio: `accepted`, `queued`, `sending`, `sent`, `receiving`, `received`, `delivered`, `undelivered`, `failed`, `read`.

### `cadence_metrics` (NEW, Phase 7a)
One row per `engagement_executions` row. Populated by runEngagement on execution end.

```sql
CREATE TABLE cadence_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid REFERENCES engagement_executions(id) UNIQUE,
  client_id uuid REFERENCES clients(id),
  workflow_id uuid REFERENCES engagement_workflows(id),
  lead_id text,
  nodes_fired int DEFAULT 0,
  sms_sent int DEFAULT 0,
  sms_delivered int DEFAULT 0,
  whatsapp_sent int DEFAULT 0,
  calls_attempted int DEFAULT 0,
  calls_picked_up int DEFAULT 0,
  voicemails_dropped int DEFAULT 0,
  reply_received boolean DEFAULT false,
  time_to_first_response_seconds int,
  booking_created boolean DEFAULT false,
  booking_id uuid,
  time_to_booking_seconds int,
  ended_at timestamptz,
  stop_reason text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX cadence_metrics_client_idx ON cadence_metrics (client_id, created_at DESC);
CREATE INDEX cadence_metrics_workflow_idx ON cadence_metrics (workflow_id, created_at DESC);
```

### `lead_optouts` (NEW, Phase 4a)
```sql
CREATE TABLE lead_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),
  phone text NOT NULL,
  email text,
  source text,
  raw_keyword text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (client_id, phone)
);
CREATE INDEX lead_optouts_phone_idx ON lead_optouts (client_id, phone);
```

## Views

### `cadence_funnel` (Phase 7d, materialized)
```sql
CREATE MATERIALIZED VIEW cadence_funnel AS
SELECT
  cm.client_id,
  cm.workflow_id,
  ew.name AS workflow_name,
  date_trunc('day', cm.created_at) AS day,
  count(*) AS leads_enrolled,
  count(*) FILTER (WHERE cm.sms_sent > 0) AS leads_texted,
  count(*) FILTER (WHERE cm.reply_received) AS leads_replied,
  count(*) FILTER (WHERE cm.calls_attempted > 0) AS leads_called,
  count(*) FILTER (WHERE cm.calls_picked_up > 0) AS leads_picked_up,
  count(*) FILTER (WHERE cm.booking_created) AS leads_booked,
  avg(cm.time_to_first_response_seconds) AS avg_response_seconds,
  avg(cm.time_to_booking_seconds) AS avg_booking_seconds,
  count(*) FILTER (WHERE cm.stop_reason = 'opt_out') AS opt_outs
FROM cadence_metrics cm
LEFT JOIN engagement_workflows ew ON ew.id = cm.workflow_id
GROUP BY 1,2,3,4;
CREATE INDEX cadence_funnel_idx ON cadence_funnel (client_id, day DESC);
```

Refresh hourly via Trigger.dev scheduled task `refreshCadenceFunnel`:
```ts
schedules.task({
  id: "refresh-cadence-funnel",
  cron: "0 * * * *",
  run: async () => {
    const supabase = getMainSupabase();
    await supabase.rpc("refresh_cadence_funnel");  // SQL fn does CONCURRENTLY refresh
  }
});
```

## Sample queries

### Per-client funnel last 30 days
```sql
SELECT
  workflow_name,
  sum(leads_enrolled) AS enrolled,
  sum(leads_texted) AS texted,
  sum(leads_replied) AS replied,
  sum(leads_called) AS called,
  sum(leads_picked_up) AS picked_up,
  sum(leads_booked) AS booked,
  round(100.0 * sum(leads_replied) / nullif(sum(leads_texted), 0), 1) AS reply_rate_pct,
  round(100.0 * sum(leads_picked_up) / nullif(sum(leads_called), 0), 1) AS pickup_rate_pct,
  round(100.0 * sum(leads_booked) / nullif(sum(leads_enrolled), 0), 1) AS booking_rate_pct,
  round(avg(avg_response_seconds), 0) AS avg_response_s,
  round(avg(avg_booking_seconds) / 60, 0) AS avg_time_to_book_min
FROM cadence_funnel
WHERE client_id = $1 AND day >= now() - interval '30 days'
GROUP BY workflow_name
ORDER BY booking_rate_pct DESC NULLS LAST;
```

### Top failing SMS (delivery errors) last 7 days
```sql
SELECT
  status,
  error_code,
  error_message,
  count(*) AS occurrences
FROM sms_delivery_events
WHERE received_at > now() - interval '7 days'
  AND status IN ('failed', 'undelivered')
GROUP BY status, error_code, error_message
ORDER BY occurrences DESC
LIMIT 20;
```

### Cadence drop-off by node (which node loses the most leads?)
Requires walking `engagement_executions.last_completed_node_index`:
```sql
SELECT
  workflow_id,
  ew.name AS workflow_name,
  ee.last_completed_node_index AS stopped_at_node,
  count(*) AS leads,
  count(*) FILTER (WHERE ee.stop_reason = 'sequence_complete') AS reached_end,
  count(*) FILTER (WHERE ee.stop_reason = 'inbound_reply') AS replied_here,
  count(*) FILTER (WHERE ee.stop_reason = 'booking_created') AS booked_here,
  count(*) FILTER (WHERE ee.stop_reason = 'opt_out') AS opted_out_here
FROM engagement_executions ee
JOIN engagement_workflows ew ON ew.id = ee.workflow_id
WHERE ee.created_at > now() - interval '30 days'
GROUP BY 1,2,3
ORDER BY workflow_name, stopped_at_node;
```

### Time-to-first-response distribution
```sql
SELECT
  workflow_name,
  count(*) AS replies,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY time_to_first_response_seconds) AS p50_s,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY time_to_first_response_seconds) AS p90_s,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY time_to_first_response_seconds) AS p95_s
FROM cadence_metrics
WHERE reply_received AND created_at > now() - interval '30 days'
GROUP BY workflow_name;
```

### Booking attribution: voice vs SMS-driven
```sql
SELECT
  source,
  count(*) AS bookings,
  count(*) FILTER (WHERE status = 'attended') AS attended,
  count(*) FILTER (WHERE status = 'no_show') AS no_shows,
  round(100.0 * count(*) FILTER (WHERE status = 'attended') / nullif(count(*), 0), 1) AS attendance_pct
FROM bookings
WHERE created_at > now() - interval '30 days'
GROUP BY source;
```

## Future analytics (deferred to FUTURE.md)

- A/B test variant attribution: which message variant booked more?
- Cohort analysis: lead arrival hour-of-day vs booking conversion
- Channel mix optimisation: does adding WhatsApp boost reply rate?
- Cost per booked appointment (Twilio + Retell + OpenRouter spend ÷ bookings)
