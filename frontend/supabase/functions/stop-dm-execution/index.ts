import { createClient } from "npm:@supabase/supabase-js@2.101.0";

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
    const body = await req.json();
    const executionId: string | undefined = body.execution_id;
    const timerId: string | undefined = body.timer_id;
    const mode: string = body.mode; // 'delay' or 'followup'

    if (!mode || !["delay", "followup"].includes(mode)) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid mode (delay | followup)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── MODE: DELAY ──
    if (mode === "delay") {
      if (!executionId) {
        return new Response(
          JSON.stringify({ error: "Missing execution_id for delay mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: exec, error: execError } = await supabase
        .from("dm_executions")
        .select("id, status, trigger_run_id, lead_id, ghl_account_id")
        .eq("id", executionId)
        .single();

      if (execError || !exec) {
        return new Response(
          JSON.stringify({ error: "Execution not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (exec.status !== "waiting") {
        return new Response(
          JSON.stringify({ error: "Execution is not in waiting state", status: exec.status }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cancel the Trigger.dev run
      if (exec.trigger_run_id && triggerKey) {
        try {
          const cancelRes = await fetch(
            `https://api.trigger.dev/api/v2/runs/${exec.trigger_run_id}/cancel`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${triggerKey}`,
                "Content-Type": "application/json",
              },
            }
          );
          if (!cancelRes.ok && cancelRes.status !== 404) {
            console.warn("Failed to cancel trigger run", { status: cancelRes.status });
          }
          await cancelRes.text();
        } catch (e) {
          console.warn("Error canceling trigger run", e);
        }
      }

      await supabase
        .from("dm_executions")
        .update({
          status: "cancelled",
          stage_description: "Cancelled by user",
          completed_at: new Date().toISOString(),
        })
        .eq("id", executionId);

      // Delete active_trigger_runs for this contact
      if (exec.lead_id && exec.ghl_account_id) {
        await supabase
          .from("active_trigger_runs")
          .delete()
          .eq("lead_id", exec.lead_id)
          .eq("ghl_account_id", exec.ghl_account_id);
      }

      console.info("Stopped dm_execution", { executionId });

      return new Response(
        JSON.stringify({ status: "stopped", execution_id: executionId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── MODE: FOLLOWUP ──
    if (mode === "followup") {
      if (!timerId) {
        return new Response(
          JSON.stringify({ error: "Missing timer_id for followup mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: timer, error: timerError } = await supabase
        .from("followup_timers")
        .select("id, status, trigger_run_id")
        .eq("id", timerId)
        .single();

      if (timerError || !timer) {
        return new Response(
          JSON.stringify({ error: "Timer not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!["pending", "firing"].includes(timer.status)) {
        return new Response(
          JSON.stringify({ error: "Timer is not in a stoppable state", status: timer.status }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Cancel the Trigger.dev run
      if (timer.trigger_run_id && triggerKey) {
        try {
          const cancelUrl = `https://api.trigger.dev/api/v2/runs/${timer.trigger_run_id}/cancel`;
          const cancelRes = await fetch(cancelUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${triggerKey}`,
              "Content-Type": "application/json",
            },
          });
          const cancelBody = await cancelRes.text();
          console.info("Cancel response", { status: cancelRes.status, body: cancelBody });
        } catch (e) {
          console.error("Error canceling trigger run", e);
        }
      }

      // Set timer to cancelled
      await supabase
        .from("followup_timers")
        .update({ status: "cancelled" })
        .eq("id", timerId);

      console.info("Stopped followup timer", { timerId });

      return new Response(
        JSON.stringify({ status: "stopped", timer_id: timerId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown mode" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("stop-dm-execution error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
