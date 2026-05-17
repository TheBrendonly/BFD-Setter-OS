import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function parseJsonSafely(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Accept lead_id + client_id (preferred) OR legacy ghl_contact_id
    const lead_id = body.lead_id || body.ghl_contact_id || "";
    const client_id_input = body.client_id || "";
    const ghl_account_id_input = body.ghl_account_id || "";
    const workflow_id = body.workflow_id || null;
    const contact_name = body.contact_name || null;
    const contact_phone = body.contact_phone || null;
    const contact_email = body.contact_email || null;
    const campaign_id = body.campaign_id || null;
    const enrollment_source = body.enrollment_source || "manual";
    const is_new_lead = body.is_new_lead === true;

    if (!campaign_id) {
      return new Response(
        JSON.stringify({ error: "campaign_id is required. Create an engagement_campaign first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead_id) {
      return new Response(
        JSON.stringify({ error: "lead_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!client_id_input && !ghl_account_id_input) {
      return new Response(
        JSON.stringify({ error: "client_id (or ghl_account_id) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    const makeRetellCallUrl = `${supabaseUrl}/functions/v1/make-retell-outbound-call`;

    if (!triggerSecretKey) {
      console.error("TRIGGER_SECRET_KEY is not set");
      return new Response(
        JSON.stringify({ error: "TRIGGER_SECRET_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve client_id
    let client_id = client_id_input;
    let ghl_account_id = ghl_account_id_input;
    let send_engagement_webhook_url: string | null = null;

    if (!client_id && ghl_account_id) {
      // Legacy path: look up client by ghl_location_id
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id, ghl_location_id, send_engagement_webhook_url")
        .eq("ghl_location_id", ghl_account_id)
        .single();

      if (clientError || !client) {
        return new Response(
          JSON.stringify({ error: "Client not found for ghl_account_id" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      client_id = client.id;
      send_engagement_webhook_url = client.send_engagement_webhook_url || null;
    } else if (client_id) {
      // New path: look up ghl_location_id + engagement webhook from client
      const { data: client } = await supabase
        .from("clients")
        .select("ghl_location_id, send_engagement_webhook_url")
        .eq("id", client_id)
        .single();

      if (!ghl_account_id) ghl_account_id = client?.ghl_location_id || client_id;
      send_engagement_webhook_url = client?.send_engagement_webhook_url || null;
    }

    // Cancel any active engagement executions for the same contact
    const { data: activeEngagements } = await supabase
      .from("engagement_executions")
      .select("id, trigger_run_id")
      .eq("lead_id", lead_id)
      .eq("client_id", client_id)
      .in("status", ["pending", "running"]);

    if (activeEngagements && activeEngagements.length > 0) {
      for (const prev of activeEngagements) {
        // Cancel the Trigger.dev run
        if (prev.trigger_run_id && triggerSecretKey) {
          try {
            const cancelRes = await fetch(
              `https://api.trigger.dev/api/v2/runs/${prev.trigger_run_id}/cancel`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${triggerSecretKey}`,
                  "Content-Type": "application/json",
                },
              }
            );
            await cancelRes.text(); // consume body
          } catch (e) {
            console.warn("Failed to cancel previous engagement run", { id: prev.id, error: e });
          }
        }
        // Mark as superseded
        await supabase
          .from("engagement_executions")
          .update({
            status: "cancelled",
            stop_reason: "superseded",
            completed_at: new Date().toISOString(),
          })
          .eq("id", prev.id);
      }
      console.info(`Cancelled ${activeEngagements.length} prior engagement(s) for contact ${lead_id}`);
    }

    // Fetch lead data from DB BEFORE inserting execution so contact fields are populated
    let leadData: Record<string, string> = {};
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

    let leadQuery = supabase
      .from("leads")
      .select("first_name, last_name, phone, email, business_name, custom_fields")
      .eq("client_id", client_id)
      .eq("lead_id", lead_id)
      .limit(1);

    let { data: lead } = await leadQuery.maybeSingle();

    if (!lead && isUuid(String(lead_id))) {
      const { data: uuidLead } = await supabase
        .from("leads")
        .select("first_name, last_name, phone, email, business_name, custom_fields")
        .eq("id", lead_id)
        .limit(1)
        .maybeSingle();
      lead = uuidLead;
    }

    if (lead) {
      leadData = {
        first_name: lead.first_name || "",
        last_name: lead.last_name || "",
        phone: lead.phone || contact_phone || "",
        email: lead.email || contact_email || "",
        business_name: lead.business_name || "",
      };
      if (lead.custom_fields && typeof lead.custom_fields === "object") {
        for (const [k, v] of Object.entries(lead.custom_fields as Record<string, unknown>)) {
          leadData[`custom.${k}`] = String(v ?? "");
        }
      }
    } else {
      leadData = {
        first_name: contact_name || "",
        last_name: "",
        phone: contact_phone || "",
        email: contact_email || "",
        business_name: "",
      };
    }

    // Resolve contact fields from DB data (fallback to body params)
    const resolvedName = contact_name || `${leadData.first_name} ${leadData.last_name}`.trim() || null;
    const resolvedPhone = contact_phone || leadData.phone || null;
    const resolvedEmail = contact_email || leadData.email || null;

    // Insert engagement execution with resolved contact data
    const { data: execution, error: insertError } = await supabase
      .from("engagement_executions")
      .insert({
        client_id,
        workflow_id: workflow_id || null,
        lead_id: lead_id,
        ghl_account_id: ghl_account_id || client_id,
        contact_name: resolvedName,
        contact_phone: resolvedPhone,
        contact_email: resolvedEmail,
        status: "pending",
        started_at: new Date().toISOString(),
        campaign_id,
        enrollment_source,
        is_new_lead,
      })
      .select("id")
      .single();

    if (insertError || !execution) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create execution" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const execution_id = execution.id;

    // Trigger Trigger.dev the same way receive-dm-webhook does: raw REST fetch to v1
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
            GHL_Account_ID: ghl_account_id || client_id,
            client_id,
            workflow_id: workflow_id || null,
            campaign_id,
            Name: resolvedName || leadData.first_name || "",
            Email: resolvedEmail || leadData.email || "",
            Phone: resolvedPhone || leadData.phone || "",
            send_engagement_webhook_url: send_engagement_webhook_url || "",
            // One engagement webhook handles both channels; keep legacy aliases for downstream consumers.
            send_sms_webhook_url: send_engagement_webhook_url || "",
            send_whatsapp_webhook_url: send_engagement_webhook_url || "",
            // Retell outbound call URL for phone_call channels
            make_retell_call_url: makeRetellCallUrl,
            supabase_service_key: supabaseKey,
            // Snake-case contact fields for template variable resolution
            contact_fields: leadData,
          },
        }),
      }
    );

    const triggerData = await parseJsonSafely(triggerResp);

    if (!triggerResp.ok) {
      console.error("Trigger.dev error:", triggerResp.status, triggerData);
      throw new Error(`Trigger.dev returned ${triggerResp.status}: ${JSON.stringify(triggerData)}`);
    }

    const trigger_run_id = triggerData?.id || triggerData?.run?.id || null;

    if (!trigger_run_id) {
      throw new Error("Trigger.dev response missing id field");
    }

    // Update execution with trigger_run_id
    await supabase
      .from("engagement_executions")
      .update({ trigger_run_id, status: "running" })
      .eq("id", execution_id);

    return new Response(
      JSON.stringify({ success: true, execution_id, trigger_run_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("trigger-engagement error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
