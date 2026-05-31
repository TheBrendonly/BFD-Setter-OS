// reactivate-lead-list — bulk native reactivation (2026-05-31).
//
// Takes a list of leads (CSV rows mapped by the UI, or existing contacts) and
// a target engagement workflow, then enrols each into engagement_executions +
// fires trigger.dev run-engagement — the same native path as reactivate-lead,
// in bulk. Replaces the old campaign_leads -> campaign-executor -> external
// webhook flow for cold-list reactivation (no external receiver needed).
//
// Auth: operator JWT, verified once via assertClientAccess. We then enrol with
// the service client (we deliberately do NOT fan out over HTTP to
// reactivate-lead, because assertClientAccess requires a user JWT, not the
// service key).
//
// Per-lead failures are isolated: one bad row does not abort the batch. The
// response reports enrolled / failed / skipped with per-lead detail.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { normalizeLeadRow, chunk, type NormalizedLead } from "../_shared/reactivate-list.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK = 5; // bounded concurrency, mirrors Contacts "Bulk Reactivate"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Kind = "reactivation" | "manual";

interface EnrollResult {
  lead_id: string;
  ok: boolean;
  execution_id?: string;
  error?: string;
}

// deno-lint-ignore no-explicit-any
async function enrollOne(args: {
  supabase: any;
  supabaseUrl: string;
  serviceKey: string;
  triggerSecretKey: string;
  clientId: string;
  ghlLocationId: string | null;
  workflowId: string;
  kind: Kind;
  lead: NormalizedLead;
}): Promise<EnrollResult> {
  const { supabase, supabaseUrl, serviceKey, triggerSecretKey, clientId, ghlLocationId, workflowId, kind, lead } = args;
  const leadId = lead.lead_id ?? crypto.randomUUID();
  const ghlAccountId = ghlLocationId ?? clientId;

  try {
    // Upsert the leads row so analytics + booking sync have a record.
    const { error: upsertErr } = await supabase
      .from("leads")
      .upsert(
        {
          client_id: clientId,
          lead_id: leadId,
          ghl_account_id: ghlAccountId,
          first_name: lead.first_name || null,
          last_name: lead.last_name || null,
          phone: lead.phone || null,
          email: lead.email || null,
        },
        { onConflict: "client_id,lead_id" },
      );
    if (upsertErr) return { lead_id: leadId, ok: false, error: `lead_upsert: ${upsertErr.message}` };

    // Insert engagement_executions in pending state.
    const contactName = `${lead.first_name} ${lead.last_name}`.trim() || null;
    const { data: execution, error: insertErr } = await supabase
      .from("engagement_executions")
      .insert({
        client_id: clientId,
        workflow_id: workflowId,
        lead_id: leadId,
        ghl_account_id: ghlAccountId,
        contact_name: contactName,
        contact_phone: lead.phone || null,
        contact_email: lead.email || null,
        status: "pending",
        started_at: new Date().toISOString(),
        enrollment_source: kind,
        is_new_lead: false,
        kind,
      })
      .select("id")
      .single();
    if (insertErr || !execution) {
      return { lead_id: leadId, ok: false, error: `execution_insert: ${insertErr?.message ?? "unknown"}` };
    }
    const executionId = execution.id as string;

    // Fire trigger.dev run-engagement.
    const makeRetellCallUrl = `${supabaseUrl}/functions/v1/make-retell-outbound-call`;
    const triggerResp = await fetch(
      "https://api.trigger.dev/api/v1/tasks/run-engagement/trigger",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${triggerSecretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: {
            execution_id: executionId,
            Lead_ID: leadId,
            GHL_Account_ID: ghlAccountId,
            client_id: clientId,
            workflow_id: workflowId,
            Name: contactName ?? "",
            Email: lead.email || "",
            Phone: lead.phone || "",
            make_retell_call_url: makeRetellCallUrl,
            supabase_service_key: serviceKey,
            contact_fields: {},
          },
        }),
      },
    );

    if (!triggerResp.ok) {
      const txt = await triggerResp.text().catch(() => "");
      // Leave the row at pending for inspection / retry.
      return { lead_id: leadId, ok: false, execution_id: executionId, error: `trigger_${triggerResp.status}: ${txt.slice(0, 120)}` };
    }

    const triggerData = await triggerResp.json().catch(() => null) as Record<string, unknown> | null;
    const triggerRunId =
      (triggerData?.id as string | undefined)
      ?? ((triggerData?.run as Record<string, unknown> | undefined)?.id as string | undefined)
      ?? null;

    await supabase
      .from("engagement_executions")
      .update({ trigger_run_id: triggerRunId, status: "running", updated_at: new Date().toISOString() })
      .eq("id", executionId);

    return { lead_id: leadId, ok: true, execution_id: executionId };
  } catch (e) {
    return { lead_id: leadId, ok: false, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "invalid_json" }, 400);

    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    const workflowId = typeof body.workflow_id === "string" ? body.workflow_id : null;
    const kind: Kind = body.kind === "manual" ? "manual" : "reactivation";
    const rawLeads = Array.isArray(body.leads) ? body.leads : null;

    if (!clientId) return json({ error: "client_id is required" }, 400);
    if (!workflowId) return json({ error: "workflow_id is required" }, 400);
    if (!rawLeads || rawLeads.length === 0) return json({ error: "leads[] is required" }, 400);

    try {
      await assertClientAccess(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    if (!triggerSecretKey) return json({ error: "TRIGGER_SECRET_KEY not configured" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: client } = await supabase
      .from("clients").select("ghl_location_id").eq("id", clientId).maybeSingle();
    const ghlLocationId = (client?.ghl_location_id as string | null) ?? null;

    // Normalise + drop un-contactable rows.
    const normalized: NormalizedLead[] = [];
    let skipped = 0;
    for (const raw of rawLeads) {
      const n = raw && typeof raw === "object" ? normalizeLeadRow(raw as Record<string, unknown>) : null;
      if (n) normalized.push(n); else skipped++;
    }

    const results: EnrollResult[] = [];
    for (const batch of chunk(normalized, CHUNK)) {
      const batchResults = await Promise.all(batch.map((lead) =>
        enrollOne({ supabase, supabaseUrl, serviceKey, triggerSecretKey, clientId, ghlLocationId, workflowId, kind, lead })
      ));
      results.push(...batchResults);
    }

    const enrolled = results.filter((r) => r.ok).length;
    const failed = results.length - enrolled;
    return json({ ok: true, total: rawLeads.length, enrolled, failed, skipped, results });
  } catch (e) {
    console.error("[reactivate-lead-list] unhandled", e);
    return json({ error: "internal_error", detail: (e as Error).message }, 500);
  }
});
