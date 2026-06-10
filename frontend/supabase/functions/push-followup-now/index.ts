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
    const { timer_id } = await req.json();

    if (!timer_id) {
      return new Response(
        JSON.stringify({ error: "Missing timer_id" }),
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

    // 1. Get the timer
    const { data: timer, error: timerError } = await supabase
      .from("followup_timers")
      .select("id, status, trigger_run_id, lead_id, ghl_account_id, setter_number, client_id")
      .eq("id", timer_id)
      .single();

    if (timerError || !timer) {
      return new Response(
        JSON.stringify({ error: "Timer not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant guard: only the owning agency (JWT) or an internal service-role
    // caller may act on this timer. Checked after load so we have client_id.
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), timer.client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    if (timer.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Timer is not in pending state", status: timer.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Cancel the current Trigger.dev run if exists
    if (timer.trigger_run_id) {
      console.info("Cancelling Trigger.dev run", { runId: timer.trigger_run_id });
      try {
        const cancelUrl = `https://api.trigger.dev/api/v2/runs/${timer.trigger_run_id}/cancel`;
        console.info("Cancel URL:", cancelUrl);
        const cancelRes = await fetch(cancelUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${triggerKey}`,
            "Content-Type": "application/json",
          },
        });
        const cancelBody = await cancelRes.text();
        console.info("Cancel response", { status: cancelRes.status, body: cancelBody });
        if (!cancelRes.ok && cancelRes.status !== 404) {
          console.error("Failed to cancel followup run", { status: cancelRes.status, body: cancelBody });
        }
      } catch (e) {
        console.error("Error canceling followup run", e);
      }
    } else {
      console.warn("No trigger_run_id on timer — cannot cancel existing run", { timer_id: timer.id });
    }

    // 3. Re-trigger with 5 second delay
    const newFiresAt = new Date(Date.now() + 5000).toISOString();

    const triggerResponse = await fetch(
      "https://api.trigger.dev/api/v1/tasks/send-followup/trigger",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${triggerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: {
            timer_id: timer.id,
            lead_id: timer.lead_id,
            ghl_account_id: timer.ghl_account_id,
            setter_number: timer.setter_number,
            fires_at: newFiresAt,
            client_id: timer.client_id,
          },
        }),
      }
    );

    const triggerData = await triggerResponse.json().catch(() => null);

    if (!triggerResponse.ok) {
      console.error("Trigger.dev error on push-followup-now:", triggerData);
      return new Response(
        JSON.stringify({ error: "Failed to re-trigger followup task", details: triggerData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newRunId = triggerData?.id || triggerData?.run?.id || null;

    // 4. Update followup_timers
    await supabase
      .from("followup_timers")
      .update({
        fires_at: newFiresAt,
        trigger_run_id: newRunId,
        status: "pending",
      })
      .eq("id", timer.id);

    console.info("Push followup now executed", { timer_id, newRunId });

    return new Response(
      JSON.stringify({ status: "pushed", run_id: newRunId, timer_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("push-followup-now error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
