// transition-lead — feature 3.5 / CV2-1 lifecycle state machine.
//
// Moves a lead from its current engagement workflow into the next lifecycle
// stage (Hot Pursuit -> Cool Down / Long-Tail -> Re-engage). Called internally
// (service-role) by:
//   - runEngagement when a cadence ends with stop_reason='sequence_complete'
//     and the workflow has on_sequence_complete_workflow_id set.
//   - nudgeColdReply tier-3 (silent lead) when the lead's workflow has
//     on_silent_workflow_id set.
//   - (3.7) track-link on a behavioral reactivation trigger.
//
// Idempotent + opt-out-safe + race-safe. Ordering is CLAIM-THEN-FIRE: we close
// the prior open enrollment and insert the new 'active' enrollment row FIRST
// (the partial-unique index engagement_enrollments_one_open_per_lead serializes
// concurrent transitions), and only then create the execution + fire the
// cadence. A lost race (23505) therefore skips WITHOUT ever creating a
// duplicate execution / double cadence.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";
import { enrollAndFire } from "../_shared/enroll-execution.ts";
import { decideTransition } from "../_shared/lifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUniqueViolation(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "23505" || /duplicate key|unique constraint/i.test(err.message ?? ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "invalid_json" }, 400);

    const client_id = typeof body.client_id === "string" ? body.client_id : null;
    const lead_id = typeof body.lead_id === "string" ? body.lead_id : null;
    const target_workflow_id = typeof body.target_workflow_id === "string" && body.target_workflow_id
      ? body.target_workflow_id
      : null;
    const from_execution_id = typeof body.from_execution_id === "string" ? body.from_execution_id : null;
    const from_workflow_id = typeof body.from_workflow_id === "string" ? body.from_workflow_id : null;
    const entry_reason = typeof body.entry_reason === "string" ? body.entry_reason : "manual";

    if (!client_id) return json({ error: "client_id is required" }, 400);
    if (!lead_id) return json({ error: "lead_id is required" }, 400);

    // Tenant guard: internal service-role callers pass; JWT-bearer callers must
    // own client_id.
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    if (!triggerSecretKey) return json({ error: "TRIGGER_SECRET_KEY not configured" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Gather state for the decision ────────────────────────────────────────
    // Opt-out gate (compliance): a STOP'd lead never transitions.
    const { data: leadRow } = await supabase
      .from("leads")
      .select("first_name, last_name, phone, email, setter_stopped")
      .eq("client_id", client_id)
      .eq("lead_id", lead_id)
      .maybeSingle();
    const optedOut = leadRow?.setter_stopped === true;

    // Current open enrollment (active|paused) — at most one (unique index).
    const { data: openEnrollment } = await supabase
      .from("engagement_enrollments")
      .select("id, workflow_id, status")
      .eq("client_id", client_id)
      .eq("lead_id", lead_id)
      .in("status", ["active", "paused"])
      .maybeSingle();

    // Target workflow must exist and be active.
    let targetExistsAndActive = false;
    if (target_workflow_id) {
      const { data: targetWf } = await supabase
        .from("engagement_workflows")
        .select("id, is_active")
        .eq("id", target_workflow_id)
        .maybeSingle();
      targetExistsAndActive = !!targetWf && targetWf.is_active !== false;
    }

    const decision = decideTransition({
      optedOut,
      targetWorkflowId: target_workflow_id,
      targetExistsAndActive,
      currentOpenEnrollmentWorkflowId: openEnrollment?.workflow_id as string | undefined,
    });

    if (decision.action === "skip") {
      return json({ ok: true, skipped: decision.reason });
    }

    const nowIso = new Date().toISOString();

    // ── CLAIM: close prior open enrollment, then claim the new one ────────────
    if (openEnrollment?.id) {
      await supabase
        .from("engagement_enrollments")
        .update({
          status: "completed",
          exit_reason: entry_reason,
          next_workflow_id: target_workflow_id,
          closed_at: nowIso,
        })
        .eq("id", openEnrollment.id);
    } else if (from_workflow_id) {
      // No prior open enrollment (lead originated from an inbound/legacy enrol
      // that predates the lifecycle table). Synthesize a closed history row for
      // the stage we're leaving so the enrollment trail is complete. Best-effort.
      await supabase.from("engagement_enrollments").insert({
        client_id,
        lead_id,
        workflow_id: from_workflow_id,
        execution_id: from_execution_id,
        status: "completed",
        entry_reason: "initial",
        exit_reason: entry_reason,
        next_workflow_id: target_workflow_id,
        closed_at: nowIso,
      });
    }

    // Claim the new stage. The unique index serializes concurrent transitions:
    // exactly one insert wins, the rest get 23505 and skip (no execution made).
    const { data: newEnrollment, error: claimError } = await supabase
      .from("engagement_enrollments")
      .insert({
        client_id,
        lead_id,
        workflow_id: target_workflow_id,
        status: "active",
        entry_reason,
        execution_id: null,
      })
      .select("id")
      .single();

    if (claimError || !newEnrollment) {
      if (isUniqueViolation(claimError)) {
        // A concurrent transition already opened an enrollment for this lead.
        return json({ ok: true, skipped: "already_in_target" });
      }
      console.error("[transition-lead] enrollment claim failed", claimError);
      return json({ error: "claim_failed", detail: claimError?.message }, 500);
    }
    const to_enrollment_id = newEnrollment.id as string;

    // ── FIRE: create the execution + run the target cadence ──────────────────
    // Hydrate contact fields from leads, ghl_account_id from the reference
    // execution (leads has no location id). custom_fields are re-derived at call
    // time by make-retell-outbound-call, so {} here is safe.
    let ghl_account_id: string = client_id;
    const { data: refExec } = await supabase
      .from("engagement_executions")
      .select("ghl_account_id, contact_name, contact_phone, contact_email")
      .eq("client_id", client_id)
      .eq("ghl_contact_id", lead_id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (refExec?.ghl_account_id) ghl_account_id = refExec.ghl_account_id as string;

    const contact_name =
      `${leadRow?.first_name ?? ""} ${leadRow?.last_name ?? ""}`.trim() ||
      (refExec?.contact_name as string | null) || "";
    const contact_phone = (leadRow?.phone as string | null) || (refExec?.contact_phone as string | null) || "";
    const contact_email = (leadRow?.email as string | null) || (refExec?.contact_email as string | null) || "";

    const result = await enrollAndFire({
      supabase,
      supabaseUrl,
      serviceKey,
      triggerSecretKey,
      client_id,
      workflow_id: target_workflow_id,
      lead_id,
      ghl_account_id,
      contact_name,
      contact_phone,
      contact_email,
      enrollment_source: "lifecycle_transition",
      is_new_lead: false,
    });

    if (!result.ok) {
      // Couldn't start the target cadence. Release the claim so a retry can
      // transition again (and the lead isn't stuck with a dead open enrollment).
      await supabase
        .from("engagement_enrollments")
        .update({ status: "cancelled", exit_reason: "enroll_failed", closed_at: new Date().toISOString() })
        .eq("id", to_enrollment_id);
      return json({
        error: result.error,
        status: result.status,
        detail: result.detail,
      }, result.error === "trigger_failed" ? 502 : 500);
    }

    // Link the claimed enrollment to its execution.
    await supabase
      .from("engagement_enrollments")
      .update({ execution_id: result.execution_id })
      .eq("id", to_enrollment_id);

    // Belt-and-braces: close the from-execution if it is somehow still open
    // (runEngagement already completes it on the sequence_complete path; the
    // nudge/silent path has no live execution). Status-guarded so retries no-op.
    if (from_execution_id) {
      await supabase
        .from("engagement_executions")
        .update({
          status: "completed",
          stop_reason: "superseded",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", from_execution_id)
        .in("status", ["pending", "running", "waiting"]);
    }

    return json({
      ok: true,
      transitioned: true,
      to_enrollment_id,
      execution_id: result.execution_id,
      trigger_run_id: result.trigger_run_id,
    });
  } catch (e) {
    console.error("[transition-lead] unhandled", e);
    return json({ error: "internal_error", detail: (e as Error).message }, 500);
  }
});
