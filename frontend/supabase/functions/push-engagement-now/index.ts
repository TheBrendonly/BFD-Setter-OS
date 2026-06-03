import { createClient } from "npm:@supabase/supabase-js@2";

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

    if (!["running", "pending"].includes(execution.status)) {
      return new Response(
        JSON.stringify({ error: "Execution is not in a pushable state", status: execution.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const startFromNodeIndex =
      typeof execution.current_node_index === "number"
        ? Math.max(execution.current_node_index + 1, 0)
        : 0;

    // 2. Cancel the current Trigger.dev run
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
          console.warn("Failed to cancel run", { status: cancelRes.status });
        }
        // Consume body
        await cancelRes.text();
      } catch (e) {
        console.warn("Error canceling run", e);
      }
    }

    // 3. Fetch client webhook URL
    const { data: client } = await supabase
      .from("clients")
      .select("ghl_location_id, send_engagement_webhook_url")
      .eq("id", execution.client_id)
      .single();

    const send_engagement_webhook_url = client?.send_engagement_webhook_url || "";

    // 4. Fetch lead data
    let leadData: Record<string, string> = {};
    const { data: lead } = await supabase
      .from("leads")
      .select("first_name, last_name, phone, email")
      .or(`id.eq.${execution.ghl_contact_id},lead_id.eq.${execution.ghl_contact_id}`)
      .limit(1)
      .maybeSingle();

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

    // 5. Re-trigger engagement from the next node so Push Now skips the current wait
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
            start_from_node_index: startFromNodeIndex,
          },
        }),
      }
    );

    const triggerData = await triggerResponse.json().catch(() => null);

    if (!triggerResponse.ok) {
      console.error("Trigger.dev error on push-engagement-now:", triggerData);
      return new Response(
        JSON.stringify({ error: "Failed to re-trigger task", details: triggerData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newRunId = triggerData?.id || triggerData?.run?.id || null;

    // 6. Update execution
    await supabase
      .from("engagement_executions")
      .update({
        current_node_index: startFromNodeIndex,
        trigger_run_id: newRunId,
        status: "running",
        stage_description: "Pushed now — skipping current wait and resuming sequence.",
      })
      .eq("id", execution.id);

    console.info("Push engagement now executed", {
      execution_id,
      newRunId,
      currentNodeIndex: execution.current_node_index,
      startFromNodeIndex,
    });

    return new Response(
      JSON.stringify({ status: "pushed", run_id: newRunId, execution_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("push-engagement-now error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
