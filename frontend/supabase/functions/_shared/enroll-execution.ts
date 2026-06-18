// _shared/enroll-execution.ts
//
// Shared "insert an engagement_executions row + fire the Trigger.dev
// runEngagement task + write back trigger_run_id/status" primitive. Extracted
// from reactivate-lead so reactivate-lead and transition-lead (feature 3.5)
// share one code path instead of duplicating the insert + REST fire.
//
// This is a thin execution primitive only — it does NOT write
// engagement_enrollments rows. The lifecycle layer (transition-lead) owns
// enrollment-row bookkeeping; reactivate-lead does not create enrollment rows.
//
// NOTE: the column set here is intentionally migration-backed only
// (enrollment_source + is_new_lead live in 20260413132704...). The older
// reactivate-lead code also inserted a `kind` column that no migration backs
// and that duplicated enrollment_source — it is dropped here.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.101.0";

const TRIGGER_RUN_ENGAGEMENT_URL =
  "https://api.trigger.dev/api/v1/tasks/run-engagement/trigger";

export type EnrollAndFireArgs = {
  supabase: SupabaseClient;
  supabaseUrl: string;
  serviceKey: string;
  triggerSecretKey: string;
  client_id: string;
  workflow_id: string | null;
  lead_id: string;
  ghl_account_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  /** GHL custom fields forwarded to runEngagement as dynamic vars. */
  contact_fields?: Record<string, unknown>;
  /** Stored on engagement_executions.enrollment_source for analytics. */
  enrollment_source: string;
  is_new_lead: boolean;
  campaign_id?: string | null;
};

export type EnrollAndFireResult =
  | { ok: true; execution_id: string; trigger_run_id: string | null }
  | { ok: false; error: string; status?: number; detail?: string; execution_id?: string };

/**
 * Insert a pending engagement_executions row, fire Trigger.dev runEngagement,
 * then write back trigger_run_id + status='running'. On Trigger failure the row
 * is left at 'pending' (with the execution_id returned) so an operator/sweeper
 * can re-fire it — same failure semantics as the original reactivate-lead.
 */
export async function enrollAndFire(args: EnrollAndFireArgs): Promise<EnrollAndFireResult> {
  const {
    supabase,
    supabaseUrl,
    serviceKey,
    triggerSecretKey,
    client_id,
    workflow_id,
    lead_id,
    ghl_account_id,
    contact_name,
    contact_phone,
    contact_email,
    contact_fields,
    enrollment_source,
    is_new_lead,
    campaign_id,
  } = args;

  const { data: execution, error: insertError } = await supabase
    .from("engagement_executions")
    .insert({
      client_id,
      workflow_id,
      ghl_contact_id: lead_id,
      ghl_account_id,
      contact_name: contact_name || null,
      contact_phone: contact_phone || null,
      contact_email: contact_email || null,
      status: "pending",
      started_at: new Date().toISOString(),
      campaign_id: campaign_id ?? null,
      enrollment_source,
      is_new_lead,
    })
    .select("id")
    .single();

  if (insertError || !execution) {
    console.error("[enroll-execution] insert failed", insertError);
    return { ok: false, error: "insert_failed", detail: insertError?.message };
  }

  const execution_id = execution.id as string;

  const makeRetellCallUrl = `${supabaseUrl}/functions/v1/make-retell-outbound-call`;
  const triggerResp = await fetch(TRIGGER_RUN_ENGAGEMENT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${triggerSecretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: {
        execution_id,
        Lead_ID: lead_id,
        GHL_Account_ID: ghl_account_id,
        client_id,
        workflow_id: workflow_id ?? null,
        campaign_id: campaign_id ?? null,
        Name: contact_name || "",
        Email: contact_email || "",
        Phone: contact_phone || "",
        make_retell_call_url: makeRetellCallUrl,
        supabase_service_key: serviceKey,
        contact_fields: contact_fields ?? {},
      },
    }),
  });

  if (!triggerResp.ok) {
    const txt = await triggerResp.text().catch(() => "");
    console.error("[enroll-execution] trigger.dev failed", triggerResp.status, txt);
    return {
      ok: false,
      error: "trigger_failed",
      status: triggerResp.status,
      detail: txt.slice(0, 200),
      execution_id,
    };
  }

  const triggerData = await triggerResp.json().catch(() => null) as Record<string, unknown> | null;
  const trigger_run_id =
    (triggerData?.id as string | undefined)
    ?? ((triggerData?.run as Record<string, unknown> | undefined)?.id as string | undefined)
    ?? null;

  await supabase
    .from("engagement_executions")
    .update({
      trigger_run_id,
      status: "running",
      updated_at: new Date().toISOString(),
    })
    .eq("id", execution_id);

  return { ok: true, execution_id, trigger_run_id };
}
