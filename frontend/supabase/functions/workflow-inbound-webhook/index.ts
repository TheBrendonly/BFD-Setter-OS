import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let client_id = url.searchParams.get("client_id");
    const workflow_id = url.searchParams.get("workflow_id");
    const ghl_account_id = url.searchParams.get("GHL_Account_ID");

    if (!workflow_id) {
      return new Response(
        JSON.stringify({ error: "workflow_id query param is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve client_id from GHL_Account_ID if client_id not provided
    if (!client_id && ghl_account_id) {
      const { data: clientRow, error: clientErr } = await supabase
        .from("clients")
        .select("id")
        .eq("ghl_location_id", ghl_account_id)
        .single();

      if (clientErr || !clientRow) {
        return new Response(
          JSON.stringify({ error: "No client found for the provided GHL_Account_ID" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      client_id = clientRow.id;
    }

    if (!client_id) {
      return new Response(
        JSON.stringify({ error: "client_id or GHL_Account_ID query param is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");

    // Verify workflow exists

    // Verify workflow exists (allow inactive workflows to still receive and store requests)
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("id, is_active, nodes")
      .eq("id", workflow_id)
      .eq("client_id", client_id)
      .single();

    if (wfError || !workflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Collect trigger_data from the incoming request
    let requestBody = {};
    try {
      requestBody = await req.json();
    } catch {
      // Body may not be JSON — that's fine
    }

    // Collect ALL headers
    const allHeaders: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });

    const trigger_data = {
      query: Object.fromEntries(url.searchParams),
      body: requestBody,
      headers: allHeaders,
      received_at: new Date().toISOString(),
    };

    // Store the raw request for mapping reference
    await supabase
      .from("workflow_webhook_requests")
      .insert({
        workflow_id,
        client_id,
        raw_request: trigger_data,
        received_at: new Date().toISOString(),
      });

    // Only trigger execution if workflow is active
    if (!workflow.is_active) {
      return new Response(
        JSON.stringify({
          status: "stored",
          message: "Request stored but workflow is not active",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create execution record
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .insert({
        workflow_id,
        client_id,
        status: "pending",
        trigger_type: "inbound_webhook",
        trigger_data,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (execError) throw execError;

    // Call Trigger.dev
    if (!triggerSecretKey) {
      await supabase
        .from("workflow_executions")
        .update({
          status: "failed",
          error_message: "TRIGGER_SECRET_KEY not configured",
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const triggerResponse = await fetch(
      "https://api.trigger.dev/api/v1/tasks/execute-workflow/trigger",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${triggerSecretKey}`,
        },
        body: JSON.stringify({
          payload: {
            workflow_id,
            execution_id: execution.id,
            client_id,
            trigger_data,
          },
        }),
      }
    );

    if (!triggerResponse.ok) {
      const errText = await triggerResponse.text();
      await supabase
        .from("workflow_executions")
        .update({
          status: "failed",
          error_message: `Trigger.dev error: ${errText.slice(0, 200)}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return new Response(
        JSON.stringify({ error: "Failed to trigger workflow execution" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const triggerResult = await triggerResponse.json();
    const trigger_run_id = triggerResult.id || null;

    if (trigger_run_id) {
      await supabase
        .from("workflow_executions")
        .update({ trigger_run_id })
        .eq("id", execution.id);
    }

    return new Response(
      JSON.stringify({
        status: "triggered",
        execution_id: execution.id,
        trigger_run_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Inbound webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
