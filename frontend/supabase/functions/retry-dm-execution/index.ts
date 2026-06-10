import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

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

    if (!triggerKey) {
      return new Response(
        JSON.stringify({ error: "TRIGGER_SECRET_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Read the failed execution
    const { data: execution, error: execError } = await supabase
      .from("dm_executions")
      .select("id, status, has_error, lead_id, ghl_account_id, contact_name, grouped_message, trigger_payload, messages")
      .eq("id", execution_id)
      .maybeSingle();

    if (execError) {
      console.error("DB query error:", execError);
      return new Response(
        JSON.stringify({ error: "Failed to query execution", details: execError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!execution) {
      console.error("Execution not found for id:", execution_id);
      return new Response(
        JSON.stringify({ error: "Execution not found", execution_id }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!execution.has_error && execution.status !== "failed") {
      return new Response(
        JSON.stringify({ error: "Execution does not have an error", status: execution.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve the owning client from the execution's ghl_account_id, then
    // tenant-guard before any write/trigger. Internal callers present the
    // service-role bearer (pass); UI callers a user JWT that must own it.
    const { data: ownerClient } = await supabase
      .from("clients")
      .select("id")
      .eq("ghl_location_id", execution.ghl_account_id)
      .limit(1)
      .maybeSingle();
    if (!ownerClient) {
      return new Response(
        JSON.stringify({ error: "No client found for this execution" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), ownerClient.id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    const payload = execution.trigger_payload && typeof execution.trigger_payload === "object"
      ? execution.trigger_payload as Record<string, string>
      : {};

    const contactName = execution.contact_name || payload.Name || "Unknown";
    const contactEmail = payload.Email || payload.contact_email || "";
    const contactPhone = payload.Phone || payload.contact_phone || "";
    const setterNumber = payload.Setter_Number || payload.setter_number || "";
    const groupedMessage = execution.grouped_message || "";

    const retryTriggerPayload = {
      ...payload,
      Name: contactName,
      Email: contactEmail,
      Phone: contactPhone,
      Setter_Number: setterNumber,
    };

    // 3. Check message_queue for unprocessed rows
    const { data: existingQueue } = await supabase
      .from("message_queue")
      .select("id")
      .eq("lead_id", execution.lead_id)
      .eq("processed", false)
      .limit(1);

    if (!existingQueue || existingQueue.length === 0) {
      // Insert new row into message_queue with the grouped_message
      if (groupedMessage) {
        await supabase.from("message_queue").insert({
          lead_id: execution.lead_id,
          ghl_account_id: execution.ghl_account_id,
          message_body: groupedMessage,
          processed: false,
          contact_name: contactName,
          contact_email: contactEmail,
          contact_phone: contactPhone,
        });
      }
    }

    // 4. Delete active_trigger_runs for this contact
    await supabase
      .from("active_trigger_runs")
      .delete()
      .eq("lead_id", execution.lead_id)
      .eq("ghl_account_id", execution.ghl_account_id);

    // 5. Insert new dm_execution with status pending, carrying over messages from failed execution
    const originalMessages = Array.isArray(execution.messages) ? execution.messages : [];
    const { data: newExec, error: newExecError } = await supabase
      .from("dm_executions")
      .insert({
        lead_id: execution.lead_id,
        ghl_account_id: execution.ghl_account_id,
        contact_name: contactName,
        trigger_payload: retryTriggerPayload,
        grouped_message: groupedMessage || null,
        status: "pending",
        stage_description: "Retrying...",
        has_error: false,
        messages: originalMessages,
      })
      .select("id")
      .single();

    if (newExecError || !newExec) {
      console.error("Failed to create new dm_execution:", newExecError);
      return new Response(
        JSON.stringify({ error: "Failed to create retry execution", details: newExecError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Trigger process-messages task
    const triggerResponse = await fetch(
      "https://api.trigger.dev/api/v1/tasks/process-messages/trigger",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${triggerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: {
            lead_id: execution.lead_id,
            ghl_account_id: execution.ghl_account_id,
            contact_name: contactName,
            contact_email: contactEmail,
            contact_phone: contactPhone,
            setter_number: setterNumber,
            execution_id: newExec.id,
            debounce_seconds: 1,
          },
        }),
      }
    );

    const triggerData = await triggerResponse.json().catch(() => null);

    if (!triggerResponse.ok) {
      console.error("Trigger.dev error on retry:", triggerData);
      return new Response(
        JSON.stringify({ error: "Failed to trigger task", details: triggerData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runId = triggerData?.id || triggerData?.run?.id || null;

    // 7. Save run ID into active_trigger_runs and update dm_execution
    if (runId) {
      await supabase.from("active_trigger_runs").insert({
        lead_id: execution.lead_id,
        ghl_account_id: execution.ghl_account_id,
        trigger_run_id: runId,
      });

      await supabase
        .from("dm_executions")
        .update({ trigger_run_id: runId })
        .eq("id", newExec.id);
    }

    console.info("Retry executed", { old_execution_id: execution_id, new_execution_id: newExec.id, runId });

    return new Response(
      JSON.stringify({ success: true, new_execution_id: newExec.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("retry-dm-execution error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
