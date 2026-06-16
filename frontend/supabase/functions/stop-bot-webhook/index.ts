import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { client_id, contact_id, request_type } = await req.json();

    if (!client_id || !contact_id) {
      return new Response(
        JSON.stringify({ error: "Missing client_id or contact_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the caller's JWT AND that they own client_id. Previously the token was
    // atob-decoded without verification and ownership was never checked → a forged
    // token + any client_id could trigger the stop-bot webhook for any tenant.
    try {
      await assertClientAccess(authHeader, client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    const requestType = request_type === "Activate" ? "Activate" : "Stop";

    // Validate the client exists. The GHL stop-bot webhook was retired
    // 2026-06-17, so this is now a purely local state toggle. setter_stopped is
    // already honored by processMessages (STEP 1.5) and runEngagement; an
    // inbound STOP keyword is handled separately by receive-twilio-sms.
    const { error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("id", client_id)
      .single();

    if (clientError) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Persist setter_stopped state to the leads table
    const setterStopped = requestType === "Stop";
    const { error: updateError } = await supabase
      .from("leads")
      .update({ setter_stopped: setterStopped })
      .eq("id", contact_id);

    if (updateError) {
      console.error("Failed to update setter_stopped:", updateError);
    }

    return new Response(
      JSON.stringify({ success: true, request_type: requestType, setter_stopped: setterStopped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in stop-bot-webhook:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
