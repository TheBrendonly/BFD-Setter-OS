// Bug 3 — reactivate-lead edge fn.
//
// Generic "enrol existing lead into an engagement workflow" RPC. Same code
// path that trigger-engagement uses for fresh inbound leads, but with an
// explicit `kind` parameter so the analytics layer can distinguish
// new_lead vs reactivation vs manual injection runs.
//
// Callers:
//   - Bug 6 (Reactivate button on lead row UI)  → kind="reactivation"
//   - Bug 11 (/agency/debug/inject-lead page)  → kind="manual"
//   - Future: campaign-executor batch fire     → kind="reactivation"
//
// Atomicity: inserts engagement_executions with status="pending",
// fires trigger.dev runEngagement, then updates to status="running" +
// writes trigger_run_id back. A separate (out-of-scope here) sweeper task
// can re-fire rows stuck at status="pending" with no trigger_run_id after
// some interval. For now, the failure mode is a stuck row with a clear
// error column for manual inspection.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Kind = "new_lead" | "reactivation" | "manual";

function isKind(v: unknown): v is Kind {
  return v === "new_lead" || v === "reactivation" || v === "manual";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "invalid_json" }, 400);

    const client_id = typeof body.client_id === "string" ? body.client_id : null;
    const workflow_id = typeof body.workflow_id === "string" ? body.workflow_id : null;
    const lead_id = typeof body.lead_id === "string" ? body.lead_id : null;
    const campaign_id = typeof body.campaign_id === "string" ? body.campaign_id : null;
    const kind: Kind = isKind(body.kind) ? body.kind : "reactivation";

    if (!client_id) return json({ error: "client_id is required" }, 400);
    if (!lead_id) return json({ error: "lead_id is required" }, 400);

    // Tenant guard. Skip when the caller is the Supabase service role
    // (internal cron / sweeper); JWT-bearer callers must own client_id.
    try {
      await assertClientAccess(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    if (!triggerSecretKey) {
      return json({ error: "TRIGGER_SECRET_KEY not configured" }, 500);
    }

    // Hydrate lead contact fields from leads table for runEngagement payload.
    // If absent, fall back to body fields. Don't fail if leads row missing —
    // GHL contact-id-only flows are valid.
    const { data: leadRow } = await supabase
      .from("leads")
      .select("first_name, last_name, phone, email, custom_fields, ghl_account_id")
      .eq("client_id", client_id)
      .eq("lead_id", lead_id)
      .maybeSingle();

    const ghl_account_id = (leadRow?.ghl_account_id as string | null)
      ?? (typeof body.ghl_account_id === "string" ? body.ghl_account_id : null)
      ?? client_id;
    const first_name = (leadRow?.first_name as string | null) ?? "";
    const last_name = (leadRow?.last_name as string | null) ?? "";
    const phone = (leadRow?.phone as string | null) ?? (typeof body.phone === "string" ? body.phone : "");
    const email = (leadRow?.email as string | null) ?? (typeof body.email === "string" ? body.email : "");

    // Insert engagement_executions row in pending state.
    const { data: execution, error: insertError } = await supabase
      .from("engagement_executions")
      .insert({
        client_id,
        workflow_id,
        ghl_contact_id: lead_id,
        ghl_account_id,
        contact_name: `${first_name} ${last_name}`.trim() || null,
        contact_phone: phone || null,
        contact_email: email || null,
        status: "pending",
        started_at: new Date().toISOString(),
        campaign_id,
        enrollment_source: kind,
        is_new_lead: kind === "new_lead",
        kind,
      })
      .select("id")
      .single();

    if (insertError || !execution) {
      console.error("[reactivate-lead] insert failed", insertError);
      return json({ error: "insert_failed", detail: insertError?.message }, 500);
    }

    const execution_id = execution.id as string;

    // Fire trigger.dev runEngagement.
    const makeRetellCallUrl = `${supabaseUrl}/functions/v1/make-retell-outbound-call`;
    const triggerResp = await fetch(
      "https://api.trigger.dev/api/v1/tasks/run-engagement/trigger",
      {
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
            campaign_id,
            Name: `${first_name} ${last_name}`.trim() || first_name || "",
            Email: email || "",
            Phone: phone || "",
            make_retell_call_url: makeRetellCallUrl,
            supabase_service_key: serviceKey,
            contact_fields: (leadRow?.custom_fields as Record<string, unknown> | null) ?? {},
          },
        }),
      },
    );

    if (!triggerResp.ok) {
      const txt = await triggerResp.text().catch(() => "");
      console.error("[reactivate-lead] trigger.dev failed", triggerResp.status, txt);
      // Leave the engagement_executions row at pending so the operator can
      // see what happened. Sweeper / manual retry can re-fire.
      return json({
        error: "trigger_failed",
        status: triggerResp.status,
        detail: txt.slice(0, 200),
        execution_id,
      }, 502);
    }

    const triggerData = await triggerResp.json().catch(() => null) as Record<string, unknown> | null;
    const trigger_run_id =
      (triggerData?.id as string | undefined)
      ?? (triggerData?.run as Record<string, unknown> | undefined)?.id as string | undefined
      ?? null;

    await supabase
      .from("engagement_executions")
      .update({
        trigger_run_id,
        status: "running",
        updated_at: new Date().toISOString(),
      })
      .eq("id", execution_id);

    return json({
      ok: true,
      execution_id,
      trigger_run_id,
      kind,
    });
  } catch (e) {
    console.error("[reactivate-lead] unhandled", e);
    return json({ error: "internal_error", detail: (e as Error).message }, 500);
  }
});
