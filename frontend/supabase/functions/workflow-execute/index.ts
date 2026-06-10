import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      trigger_type,
      trigger_data,
      client_id,
      workflow_id,
      is_test,
    } = body;

    if (!trigger_type || !client_id) {
      return new Response(
        JSON.stringify({ error: "trigger_type and client_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant guard: internal callers present the service-role bearer (pass);
    // UI callers present a user JWT and must own client_id. Without this any
    // anon-key holder could trigger another tenant's workflows.
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    if (!triggerSecretKey) {
      return new Response(
        JSON.stringify({ error: "TRIGGER_SECRET_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find matching active workflows (or specific workflow for tests)
    let query = supabase
      .from("workflows")
      .select("*")
      .eq("client_id", client_id);

    if (workflow_id) {
      query = query.eq("id", workflow_id);
    } else {
      query = query.eq("is_active", true);
    }

    const { data: workflows, error: wfError } = await query;
    if (wfError) throw wfError;

    if (!workflows || workflows.length === 0) {
      return new Response(
        JSON.stringify({ message: "No matching workflows found", executions: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = [];

    for (const workflow of workflows) {
      const nodes = workflow.nodes || [];

      // Find trigger node matching the trigger_type
      const triggerNode = nodes.find(
        (n: any) => n.type === "trigger" && n.data?.triggerType === trigger_type
      );
      if (!triggerNode) continue;

      // Step 1: Create execution record with status "pending"
      const { data: execution, error: execError } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: workflow.id,
          client_id,
          status: "pending",
          trigger_type,
          trigger_data: trigger_data || {},
          started_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (execError) throw execError;

      // Step 2: Call Trigger.dev API to start the task
      let trigger_run_id: string | null = null;
      try {
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
                workflow_id: workflow.id,
                execution_id: execution.id,
                client_id,
                trigger_data: trigger_data || {},
              },
            }),
          }
        );

        if (!triggerResponse.ok) {
          const errText = await triggerResponse.text();
          throw new Error(`Trigger.dev API returned ${triggerResponse.status}: ${errText.slice(0, 200)}`);
        }

        const triggerResult = await triggerResponse.json();
        trigger_run_id = triggerResult.id || null;

        // Step 3: Update execution with trigger_run_id
        if (trigger_run_id) {
          await supabase
            .from("workflow_executions")
            .update({ trigger_run_id })
            .eq("id", execution.id);
        }
      } catch (triggerError: any) {
        // If Trigger.dev call fails, mark execution as failed
        await supabase
          .from("workflow_executions")
          .update({
            status: "failed",
            error_message: `Failed to trigger execution: ${triggerError.message}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", execution.id);

        results.push({
          id: execution.id,
          workflow_id: workflow.id,
          execution_id: execution.id,
          status: "failed",
          error: triggerError.message,
        });
        continue;
      }

      results.push({
        id: execution.id,
        workflow_id: workflow.id,
        execution_id: execution.id,
        trigger_run_id,
        status: "triggered",
      });
    }

    return new Response(JSON.stringify({ status: "triggered", executions: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Workflow execution error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
