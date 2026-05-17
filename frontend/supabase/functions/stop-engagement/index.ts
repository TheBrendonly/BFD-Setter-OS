import { createClient } from "npm:@supabase/supabase-js@2.49.1";

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

    // Read execution to get trigger_run_id
    const { data: execution, error: readError } = await supabase
      .from("engagement_executions")
      .select("trigger_run_id, status")
      .eq("id", execution_id)
      .single();

    if (readError || !execution) {
      return new Response(
        JSON.stringify({ error: "Execution not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to cancelled
    await supabase
      .from("engagement_executions")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        stop_reason: "manual_stop",
      })
      .eq("id", execution_id);

    // Cancel Trigger.dev run if exists (use v2 API)
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
        console.error("Failed to cancel Trigger.dev run:", cancelErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("stop-engagement error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
