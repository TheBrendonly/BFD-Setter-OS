import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

// pause-engagement — D1 (4.5). Mirror of stop-engagement, but NON-terminal.
// Sets status='paused' (resumable) and cancels the Trigger.dev run so the cadence
// stops without consuming a worker. resume-engagement re-triggers it later from
// last_completed+1. Pause is the dual of stop: stop = "cancelled" (terminal),
// pause = "paused" (resumable).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { execution_id } = await req.json();

    if (!execution_id) {
      return new Response(
        JSON.stringify({ error: "execution_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: execution, error: readError } = await supabase
      .from("engagement_executions")
      .select("trigger_run_id, status, client_id")
      .eq("id", execution_id)
      .single();

    if (readError || !execution) {
      return new Response(
        JSON.stringify({ error: "Execution not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant guard: only the owning agency (verified JWT) or an internal
    // service-role caller may pause this execution.
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), execution.client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    // Only a running execution can be paused (mirrors push-engagement-now's
    // pushable-state guard). Pausing a pending/cancelled/completed exec is a no-op error.
    if (execution.status !== "running") {
      return new Response(
        JSON.stringify({ error: "Execution is not in a pausable state", status: execution.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark paused (NON-terminal: no completed_at, no stop_reason). Clear active_call_id:
    // it is the text-setter hold signal (processMessages waits while it is set), so a
    // pause mid-call would otherwise leave it dangling and stall replies for ~15 min.
    await supabase
      .from("engagement_executions")
      .update({
        status: "paused",
        stage_description: "Paused — manually paused from UI.",
        active_call_id: null,
      })
      .eq("id", execution_id);

    // Cancel the Trigger.dev run so the cadence stops immediately (use v2 API).
    if (execution.trigger_run_id && triggerSecretKey) {
      try {
        await fetch(
          `https://api.trigger.dev/api/v2/runs/${execution.trigger_run_id}/cancel`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${triggerSecretKey}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (cancelErr) {
        console.error("Failed to cancel Trigger.dev run on pause:", cancelErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, status: "paused" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("pause-engagement error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
