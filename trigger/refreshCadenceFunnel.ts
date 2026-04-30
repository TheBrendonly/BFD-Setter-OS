// refreshCadenceFunnel — hourly REFRESH MATERIALIZED VIEW cadence_funnel.
//
// Phase 7d closed the schema (cadence_funnel + refresh_cadence_funnel()) but
// left the refresh schedule for a follow-up. Without a scheduler the view is
// stale and the dashboards we'll show clients drift.
//
// Trigger.dev scheduled task is preferred over pg_cron because:
//  - run history is visible in the Trigger.dev console (Brendan can see it
//    succeeded/failed without opening Supabase logs)
//  - failures bubble into the same alerting we use for everything else
//  - one fewer surface to operate (no pg_cron + extension to manage)

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

export const refreshCadenceFunnel = schedules.task({
  id: "refresh-cadence-funnel",
  // Hourly. The view's GROUP BY is `date_trunc('day', created_at)` so a
  // higher cadence wouldn't change much; a lower cadence (e.g. once-daily)
  // would feel stale to anyone watching mid-afternoon.
  cron: "0 * * * *",
  maxDuration: 120,
  retry: { maxAttempts: 2 },

  run: async () => {
    const supabase = getMainSupabase();
    const startedAt = Date.now();

    const { error } = await supabase.rpc("refresh_cadence_funnel");
    if (error) {
      console.error("refresh_cadence_funnel rpc failed:", error.message);
      throw new Error(`refresh_cadence_funnel failed: ${error.message}`);
    }

    const durationMs = Date.now() - startedAt;
    console.log(`refresh_cadence_funnel completed in ${durationMs}ms`);
    return { ok: true, duration_ms: durationMs };
  },
});
