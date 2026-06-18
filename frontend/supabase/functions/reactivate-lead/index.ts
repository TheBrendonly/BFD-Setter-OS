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

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { enrollAndFire } from "../_shared/enroll-execution.ts";

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
      .select("first_name, last_name, phone, email")
      .eq("client_id", client_id)
      .eq("lead_id", lead_id)
      .maybeSingle();

    // leads has no ghl_account_id column (not in the select above), so this
    // resolves from the request body, else the client_id. Matches prior runtime.
    const ghl_account_id = (typeof body.ghl_account_id === "string" ? body.ghl_account_id : null)
      ?? client_id;
    const first_name = (leadRow?.first_name as string | null) ?? "";
    const last_name = (leadRow?.last_name as string | null) ?? "";
    const phone = (leadRow?.phone as string | null) ?? (typeof body.phone === "string" ? body.phone : "");
    const email = (leadRow?.email as string | null) ?? (typeof body.email === "string" ? body.email : "");

    // Enrol + fire via the shared primitive (see _shared/enroll-execution.ts).
    // enrollment_source carries `kind`; the old code also wrote a separate
    // `kind` column that no migration backs and that duplicated
    // enrollment_source — dropped here. enrollment_source is canonical.
    const result = await enrollAndFire({
      supabase,
      supabaseUrl,
      serviceKey,
      triggerSecretKey,
      client_id,
      workflow_id,
      lead_id,
      ghl_account_id,
      contact_name: `${first_name} ${last_name}`.trim(),
      contact_phone: phone,
      contact_email: email,
      // leads.custom_fields is not hydrated here (not selected); make-retell-
      // outbound-call re-derives dynamic vars at call time. Matches prior runtime.
      contact_fields: {},
      enrollment_source: kind,
      is_new_lead: kind === "new_lead",
      campaign_id,
    });

    if (!result.ok) {
      if (result.error === "trigger_failed") {
        // Leave the engagement_executions row at pending so the operator can
        // see what happened. Sweeper / manual retry can re-fire.
        return json({
          error: "trigger_failed",
          status: result.status,
          detail: result.detail,
          execution_id: result.execution_id,
        }, 502);
      }
      return json({ error: "insert_failed", detail: result.detail }, 500);
    }

    return json({
      ok: true,
      execution_id: result.execution_id,
      trigger_run_id: result.trigger_run_id,
      kind,
    });
  } catch (e) {
    console.error("[reactivate-lead] unhandled", e);
    return json({ error: "internal_error", detail: (e as Error).message }, 500);
  }
});
