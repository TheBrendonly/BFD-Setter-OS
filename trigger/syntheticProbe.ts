// syntheticProbe — phase-11g
//
// Hourly cadence end-to-end smoke test. Posts a fake lead at intake-lead,
// waits for the engagement_executions row to enter `running`, asserts an
// outbound message_queue row appears, then cancels the cadence and writes
// a probe_results row. On failure, posts a one-line summary to
// PROBE_ALERT_WEBHOOK_URL (Slack/Discord-compatible).
//
// Required env vars:
//   PROBE_CLIENT_ID         — uuid of a dedicated synthetic-probe client row
//                             (operator provisions this; see RUNBOOK)
//   PROBE_INTAKE_SECRET     — the clients.intake_lead_secret for that client
//   PROBE_TEST_PHONE        — E.164 phone the operator owns; cadence sends
//                             will land here
//   PROBE_ALERT_WEBHOOK_URL — optional Slack/Discord webhook for failures

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { hasOutboundRow, pollUntil, isParkedStage } from "./_shared/probePoll.ts";

const getSupabase = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type ProbeResult = {
  passed: boolean;
  duration_ms: number;
  error_message?: string;
  raw: Record<string, unknown>;
};

async function postAlert(message: string, raw: Record<string, unknown>): Promise<void> {
  const url = process.env.PROBE_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 BFD-setter synthetic probe FAIL: ${message}`,
        attachments: [{ text: JSON.stringify(raw, null, 2).slice(0, 2000) }],
      }),
    });
  } catch (e) {
    console.warn(`postAlert failed: ${(e as Error).message}`);
  }
}

export const syntheticProbe = schedules.task({
  id: "synthetic-probe",
  // Hourly. Trigger.dev's free-tier minimum cron granularity is hourly;
  // tighten to */30 if the project tier supports it.
  cron: "0 * * * *",
  maxDuration: 180,
  retry: { maxAttempts: 1 },

  run: async () => {
    const startedAt = Date.now();
    const clientId = process.env.PROBE_CLIENT_ID;
    const intakeSecret = process.env.PROBE_INTAKE_SECRET;
    const testPhone = process.env.PROBE_TEST_PHONE;
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabase = getSupabase();

    const persistAndMaybeAlert = async (result: ProbeResult): Promise<ProbeResult> => {
      try {
        await supabase.from("probe_results").insert({
          passed: result.passed,
          duration_ms: result.duration_ms,
          error_message: result.error_message ?? null,
          raw: result.raw,
        });
      } catch (e) {
        console.warn(`probe_results insert failed: ${(e as Error).message}`);
      }
      if (!result.passed) {
        await postAlert(result.error_message ?? "unknown failure", result.raw);
      }
      return result;
    };

    if (!clientId || !intakeSecret || !testPhone) {
      const missing: string[] = [];
      if (!clientId) missing.push("PROBE_CLIENT_ID");
      if (!intakeSecret) missing.push("PROBE_INTAKE_SECRET");
      if (!testPhone) missing.push("PROBE_TEST_PHONE");
      return persistAndMaybeAlert({
        passed: false,
        duration_ms: Date.now() - startedAt,
        error_message: `Missing env: ${missing.join(", ")}`,
        raw: { stage: "config" },
      });
    }

    // Step 1 — POST to intake-lead.
    const intakeUrl = `${supabaseUrl}/functions/v1/intake-lead`;
    const isoStamp = new Date().toISOString();
    const intakeBody = {
      clientId,
      first_name: "Probe",
      last_name: isoStamp,
      phone: testPhone,
      // Legacy address kept on purpose (branding purge 2026-07-10): this email
      // IS the live probe lead's identity in the DB - changing it would mint a
      // second probe lead and orphan the history.
      email: "probe@1prompt.local",
      source: "synthetic-probe",
    };
    let intakeJson: any = null;
    try {
      const r = await fetch(intakeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${intakeSecret}`,
        },
        body: JSON.stringify(intakeBody),
      });
      intakeJson = await r.json().catch(() => null);
      if (!r.ok || !intakeJson?.ok) {
        return persistAndMaybeAlert({
          passed: false,
          duration_ms: Date.now() - startedAt,
          error_message: `intake-lead returned ${r.status}: ${JSON.stringify(intakeJson).slice(0, 300)}`,
          raw: { stage: "intake-lead", status: r.status, body: intakeJson },
        });
      }
    } catch (e) {
      return persistAndMaybeAlert({
        passed: false,
        duration_ms: Date.now() - startedAt,
        error_message: `intake-lead fetch threw: ${(e as Error).message}`,
        raw: { stage: "intake-lead", error: (e as Error).message },
      });
    }

    const leadId: string | null = intakeJson?.lead_id ?? intakeJson?.ghl_contact_id ?? null;
    const executionId: string | null = intakeJson?.engagement_execution_id ?? intakeJson?.execution_id ?? null;
    if (!leadId) {
      return persistAndMaybeAlert({
        passed: false,
        duration_ms: Date.now() - startedAt,
        error_message: "intake-lead returned no lead_id",
        raw: { stage: "intake-lead", body: intakeJson },
      });
    }
    if (!executionId) {
      return persistAndMaybeAlert({
        passed: false,
        duration_ms: Date.now() - startedAt,
        error_message: "intake-lead returned no execution_id (auto-enrolment misconfigured?)",
        raw: { stage: "intake-lead", body: intakeJson, lead_id: leadId },
      });
    }

    // Step 2 — Poll engagement_executions for status transition.
    const deadline = Date.now() + 90_000;
    let observedStatus: string | null = null;
    while (Date.now() < deadline) {
      const { data: row } = await supabase
        .from("engagement_executions")
        .select("status")
        .eq("id", executionId)
        .maybeSingle();
      observedStatus = (row as any)?.status ?? null;
      if (observedStatus === "running" || observedStatus === "completed") break;
      await new Promise((res) => setTimeout(res, 3_000));
    }
    if (observedStatus !== "running" && observedStatus !== "completed") {
      // Cancel + record fail.
      await supabase
        .from("engagement_executions")
        .update({ status: "cancelled", stop_reason: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", executionId);
      return persistAndMaybeAlert({
        passed: false,
        duration_ms: Date.now() - startedAt,
        error_message: `cadence did not enter 'running' within 90s (status=${observedStatus})`,
        raw: { stage: "poll-status", execution_id: executionId, observedStatus },
      });
    }

    // Step 3 — poll for at least one outbound message_queue row. The SMS node
    // enqueues the row shortly AFTER the execution enters `running`, and on a
    // cold Trigger.dev worker that can lag, so poll on a deadline rather than
    // asserting once the instant status flips (Bug 6.7 canary race). Cancelling
    // mid-cadence (Step 4) is intentional, so we do NOT wait for `completed`.
    const { ok: sawOutbound, value: mqRows } = await pollUntil(
      async () => {
        const { data } = await supabase
          .from("message_queue")
          .select("id, channel, twilio_message_sid, created_at")
          .eq("lead_id", leadId)
          .gte("created_at", new Date(startedAt).toISOString())
          .order("created_at", { ascending: false })
          .limit(5);
        return data;
      },
      hasOutboundRow,
      { deadlineMs: 60_000, sleepMs: 2_500 },
    );
    if (!sawOutbound) {
      // SCHED-1(b): distinguish a REAL send failure from a LEGITIMATE park outside the
      // send window (quiet hours / AU business hours). When the cadence parks it enqueues
      // no outbound row by design, so failing here false-alarmed ~21/24 runs (and, with
      // PROBE_ALERT_WEBHOOK_URL set, Slack-spammed hourly). Read the execution's parked
      // stage BEFORE cancelling and treat a park as pass/skip.
      const { data: execRow } = await supabase
        .from("engagement_executions")
        .select("status, stage_description")
        .eq("id", executionId)
        .maybeSingle();
      const stage = ((execRow as { stage_description?: string } | null)?.stage_description) ?? null;
      const parked = isParkedStage(stage);
      // Cancel the probe cadence either way (avoid spamming the operator's phone if it resumes).
      await supabase
        .from("engagement_executions")
        .update({ status: "cancelled", stop_reason: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", executionId);
      if (parked) {
        // Healthy pipeline, just not a send window right now — PASS/SKIP, no alert.
        return persistAndMaybeAlert({
          passed: true,
          duration_ms: Date.now() - startedAt,
          raw: { stage: "skipped-parked", execution_id: executionId, parked_reason: stage, mqRows },
        });
      }
      return persistAndMaybeAlert({
        passed: false,
        duration_ms: Date.now() - startedAt,
        error_message: "no outbound message_queue row after cadence ran (60s poll)",
        raw: { stage: "assert-outbound", execution_id: executionId, mqRows },
      });
    }

    // Step 4 — cancel the cadence to avoid spamming the operator's phone.
    await supabase
      .from("engagement_executions")
      .update({ status: "cancelled", stop_reason: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", executionId);

    return persistAndMaybeAlert({
      passed: true,
      duration_ms: Date.now() - startedAt,
      raw: {
        stage: "ok",
        execution_id: executionId,
        lead_id: leadId,
        outbound_count: mqRows?.length ?? 0,
      },
    });
  },
});
