import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

// resume-engagement — D1 (4.5). Dual of pause-engagement; mirror of push-engagement-now.
// Re-triggers run-engagement for a PAUSED execution. It deliberately does NOT pass
// start_from_node_index, so runEngagement uses its proven retry-resume default
// (last_completed_node_index + 1): an interrupted node re-runs from its start, while a
// fully-completed node is skipped — no double-execution. Replays of already-sent steps
// are additionally deduped by the campaign_events marker + the per-call idempotency key.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { execution_id } = await req.json();

    if (!execution_id) {
      return new Response(
        JSON.stringify({ error: "Missing execution_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
    const makeRetellCallUrl = `${supabaseUrl}/functions/v1/make-retell-outbound-call`;

    if (!triggerKey) {
      return new Response(
        JSON.stringify({ error: "TRIGGER_SECRET_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Get the engagement execution
    const { data: execution, error: execError } = await supabase
      .from("engagement_executions")
      .select("id, status, trigger_run_id, ghl_contact_id, ghl_account_id, client_id, contact_name, contact_phone, contact_email, workflow_id, campaign_id, current_node_index")
      .eq("id", execution_id)
      .single();

    if (execError || !execution) {
      return new Response(
        JSON.stringify({ error: "Execution not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant guard: only the owning agency (JWT) or an internal service-role
    // caller may act on this execution. Checked AFTER load so we have client_id.
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), execution.client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    // Only a paused execution can be resumed.
    if (execution.status !== "paused") {
      return new Response(
        JSON.stringify({ error: "Execution is not in a resumable state", status: execution.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Cancel any lingering Trigger.dev run (defensive — pause already cancelled it).
    if (execution.trigger_run_id) {
      try {
        const cancelRes = await fetch(
          `https://api.trigger.dev/api/v2/runs/${execution.trigger_run_id}/cancel`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${triggerKey}`,
              "Content-Type": "application/json",
            },
          }
        );
        if (!cancelRes.ok && cancelRes.status !== 404) {
          console.warn("Failed to cancel run on resume", { status: cancelRes.status });
        }
        await cancelRes.text();
      } catch (e) {
        console.warn("Error canceling run on resume", e);
      }
    }

    // 3. Fetch client webhook URL
    const { data: client } = await supabase
      .from("clients")
      .select("ghl_location_id, send_engagement_webhook_url")
      .eq("id", execution.client_id)
      .single();

    const send_engagement_webhook_url = client?.send_engagement_webhook_url || "";

    // 4. Fetch lead data. ghl_contact_id is interpolated into a PostgREST .or()
    // filter string, so guard its shape to prevent filter injection; ids are
    // always UUIDs or GHL alnum tokens.
    let leadData: Record<string, string> = {};
    const contactKey = String(execution.ghl_contact_id ?? "");
    const safeContactKey = /^[A-Za-z0-9_-]+$/.test(contactKey);
    const leadQuery = supabase
      .from("leads")
      .select("first_name, last_name, phone, email, business_name, custom_fields")
      .limit(1);
    const { data: lead } = await (
      safeContactKey
        ? leadQuery.or(`id.eq.${contactKey},lead_id.eq.${contactKey}`)
        : leadQuery.eq("lead_id", contactKey)
    ).maybeSingle();

    if (lead) {
      leadData = {
        first_name: lead.first_name || "",
        last_name: lead.last_name || "",
        phone: lead.phone || execution.contact_phone || "",
        email: lead.email || execution.contact_email || "",
        business_name: lead.business_name || "",
      };
      if (lead.custom_fields && typeof lead.custom_fields === "object") {
        for (const [k, v] of Object.entries(lead.custom_fields as Record<string, unknown>)) {
          leadData[`custom.${k}`] = String(v ?? "");
        }
      }
    } else {
      leadData = {
        first_name: execution.contact_name || "",
        last_name: "",
        phone: execution.contact_phone || "",
        email: execution.contact_email || "",
        business_name: "",
      };
    }

    // 5. Re-trigger engagement. NO start_from_node_index → runEngagement resumes from
    // last_completed_node_index + 1 (its retry-resume default).
    const triggerResponse = await fetch(
      "https://api.trigger.dev/api/v1/tasks/run-engagement/trigger",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${triggerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: {
            execution_id: execution.id,
            Lead_ID: execution.ghl_contact_id,
            GHL_Account_ID: execution.ghl_account_id || execution.client_id,
            client_id: execution.client_id,
            workflow_id: execution.workflow_id || null,
            campaign_id: execution.campaign_id || "",
            Name: execution.contact_name || leadData.first_name || "",
            Email: execution.contact_email || leadData.email || "",
            Phone: execution.contact_phone || leadData.phone || "",
            send_engagement_webhook_url,
            send_sms_webhook_url: send_engagement_webhook_url,
            send_whatsapp_webhook_url: send_engagement_webhook_url,
            make_retell_call_url: makeRetellCallUrl,
            supabase_service_key: serviceKey,
            contact_fields: leadData,
          },
        }),
      }
    );

    const triggerData = await triggerResponse.json().catch(() => null);

    if (!triggerResponse.ok) {
      console.error("Trigger.dev error on resume-engagement:", triggerData);
      return new Response(
        JSON.stringify({ error: "Failed to re-trigger task", details: triggerData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newRunId = triggerData?.id || triggerData?.run?.id || null;

    // 6. Update execution back to running (runEngagement re-sets current_node_index
    //    from last_completed+1 at start).
    await supabase
      .from("engagement_executions")
      .update({
        trigger_run_id: newRunId,
        status: "running",
        stage_description: "Resumed — continuing the sequence.",
      })
      .eq("id", execution.id);

    console.info("Resume engagement executed", {
      execution_id,
      newRunId,
      currentNodeIndex: execution.current_node_index,
    });

    return new Response(
      JSON.stringify({ status: "resumed", run_id: newRunId, execution_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("resume-engagement error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
