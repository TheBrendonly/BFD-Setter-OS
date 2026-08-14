// retentionCutoff — 2B daily consent/retention sweep.
//
// A lead may only be contacted while its consent is current. Once the client's
// retention window (clients.retention_months, default 3) elapses from the lead's
// consent_timestamp (or created_at when consent is absent), this task stops all
// outbound to the lead and unenrolls it from any active cadence. It does NOT
// delete PII (a later step); it only flags + stops.
//
// The engines already honour setter_stopped (the cadence, nudge and send paths
// all gate on it), so setting setter_stopped is what actually halts outbound.
// retention_expired is a separate audit flag so a retention retirement stays
// distinguishable from a STOP opt-out.
//
// Scale note: the per-lead window depends on the joined client.retention_months,
// which is not expressible as a single PostgREST filter, so candidates are
// fetched oldest-first and filtered in code (bounded per run). For a large lead
// base this should move to an indexed SQL function; logged if a run fills.

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { resolveRetentionMonths, isPastRetention } from "./_shared/retention";

const getMainSupabase = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const MAX_LEADS_PER_RUN = 500;

export const retentionCutoff = schedules.task({
  id: "retention-cutoff",
  cron: "0 3 * * *", // daily 03:00 UTC
  maxDuration: 600,
  retry: { maxAttempts: 1 },

  run: async () => {
    const supabase = getMainSupabase();
    const startedAt = Date.now();
    const now = new Date();

    const { data: candidates, error: queryErr } = await supabase
      .from("leads")
      .select(
        "client_id, lead_id, consent_timestamp, created_at, clients ( retention_months )",
      )
      .eq("retention_expired", false)
      .eq("setter_stopped", false)
      .order("created_at", { ascending: true })
      .limit(MAX_LEADS_PER_RUN);

    if (queryErr) {
      console.error("retentionCutoff: query failed:", queryErr.message);
      throw new Error(`retentionCutoff query failed: ${queryErr.message}`);
    }

    type Candidate = NonNullable<typeof candidates>[number];
    const stats = { scanned: 0, retired: 0, skipped: 0, errors: 0 };

    for (const lead of (candidates ?? []) as Candidate[]) {
      stats.scanned++;
      const cl = lead.clients as unknown as { retention_months?: number | null } | null;
      const months = resolveRetentionMonths(cl);
      const anchor =
        (lead.consent_timestamp as string | null) ?? (lead.created_at as string | null);
      if (!isPastRetention(anchor, months, now)) {
        stats.skipped++;
        continue;
      }

      const nowIso = new Date().toISOString();
      try {
        // 1) Stop all outbound + flag retired. setter_stopped is the gate every
        //    send path honours; retention_expired is the audit marker.
        await supabase
          .from("leads")
          .update({
            retention_expired: true,
            setter_stopped: true,
            awaiting_reply: false,
            tagged_silent_after_engagement: true,
          })
          .eq("client_id", lead.client_id!)
          .eq("lead_id", lead.lead_id!);

        // 2) Cancel any live cadence executions for this lead.
        await supabase
          .from("engagement_executions")
          .update({
            status: "cancelled",
            stop_reason: "retention_expired",
            completed_at: nowIso,
            updated_at: nowIso,
          })
          .eq("client_id", lead.client_id!)
          .eq("ghl_contact_id", lead.lead_id!)
          .in("status", ["pending", "running", "waiting"]);

        // 3) Cancel any open lifecycle enrollments (best-effort; the table exists
        //    once the lifecycle migration is applied).
        try {
          await supabase
            .from("engagement_enrollments")
            .update({
              status: "cancelled",
              exit_reason: "retention_expired",
              closed_at: nowIso,
              updated_at: nowIso,
            })
            .eq("client_id", lead.client_id!)
            .eq("lead_id", lead.lead_id!)
            .in("status", ["active", "paused"]);
        } catch (enrErr) {
          console.warn(
            "retentionCutoff: enrollment cancel failed (non-fatal):",
            (enrErr as Error).message,
          );
        }

        stats.retired++;
      } catch (leadErr) {
        console.error(
          `retentionCutoff: failed to retire lead ${lead.lead_id} (client ${lead.client_id}):`,
          (leadErr as Error).message,
        );
        stats.errors++;
      }
    }

    if (stats.scanned >= MAX_LEADS_PER_RUN) {
      console.warn(
        `retentionCutoff: hit MAX_LEADS_PER_RUN (${MAX_LEADS_PER_RUN}); more leads may remain for the next run.`,
      );
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `retentionCutoff done in ${durationMs}ms: scanned=${stats.scanned} retired=${stats.retired} skipped=${stats.skipped} errors=${stats.errors}`,
    );
    return { ok: true, duration_ms: durationMs, ...stats };
  },
});
