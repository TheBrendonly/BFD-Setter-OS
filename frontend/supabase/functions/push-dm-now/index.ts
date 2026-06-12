import { createClient } from "npm:@supabase/supabase-js@2.101.0";
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

    // 1. Get the execution
    const { data: execution, error: execError } = await supabase
      .from("dm_executions")
      .select("id, status, trigger_run_id, lead_id, ghl_account_id, contact_name, trigger_payload")
      .eq("id", execution_id)
      .single();

    if (execError || !execution) {
      return new Response(
        JSON.stringify({ error: "Execution not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant guard: dm_executions has no client_id; it is keyed by ghl_account_id
    // (= clients.ghl_location_id). Resolve the owning client, then require the
    // caller to own it (verified JWT) or be an internal service-role caller.
    const { data: ownerClient, error: ownerErr } = await supabase
      .from("clients")
      .select("id")
      .eq("ghl_location_id", execution.ghl_account_id)
      .maybeSingle();

    if (ownerErr || !ownerClient?.id) {
      return new Response(
        JSON.stringify({ error: "Owning client not found for execution" }),
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

    if (execution.status !== "waiting") {
      return new Response(
        JSON.stringify({ error: "Execution is not in waiting state", status: execution.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      } catch (e) {
        console.warn("Error canceling run", e);
      }
    }

    // 3. Re-trigger with 1 second delay (essentially immediate)
    const payload = execution.trigger_payload && typeof execution.trigger_payload === "object"
      ? execution.trigger_payload as Record<string, string>
      : {};

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
            contact_name: execution.contact_name || payload.Name || "Unknown",
            contact_email: payload.Email || "",
            contact_phone: payload.Phone || "",
            setter_number: payload.Setter_Number || "",
            execution_id: execution.id,
            debounce_seconds: 1,
          },
        }),
      }
    );

    const triggerData = await triggerResponse.json().catch(() => null);

    if (!triggerResponse.ok) {
      console.error("Trigger.dev error on push-now:", triggerData);
      return new Response(
        JSON.stringify({ error: "Failed to re-trigger task", details: triggerData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newRunId = triggerData?.id || triggerData?.run?.id || null;

    // 4. Update execution and active_trigger_runs
    const nowISO = new Date().toISOString();
    const newResumeAt = new Date(Date.now() + 1000).toISOString();

    await supabase
      .from("dm_executions")
      .update({
        trigger_run_id: newRunId,
        resume_at: newResumeAt,
        stage_description: "Pushed now — processing immediately.",
      })
      .eq("id", execution.id);

    if (newRunId) {
      await supabase
        .from("active_trigger_runs")
        .update({ trigger_run_id: newRunId })
        .eq("lead_id", execution.lead_id)
        .eq("ghl_account_id", execution.ghl_account_id);
    }

    console.info("Push now executed", { execution_id, newRunId });

    return new Response(
      JSON.stringify({ status: "pushed", run_id: newRunId, execution_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("push-dm-now error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
