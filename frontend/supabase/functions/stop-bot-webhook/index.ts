import { createClient } from "npm:@supabase/supabase-js@2";

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

    const token = authHeader.replace("Bearer ", "");
    const base64Payload = token.split(".")[1];
    if (!base64Payload) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const payload = JSON.parse(atob(base64Payload));
    const userId = payload.sub;
    if (!userId) {
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

    const requestType = request_type === "Activate" ? "Activate" : "Stop";

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("stop_bot_webhook_url, ghl_location_id")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!client.stop_bot_webhook_url) {
      return new Response(
        JSON.stringify({ error: "Stop Bot Webhook URL not configured. Go to Credentials > GoHighLevel to add it." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: contact, error: contactError } = await supabase
      .from("leads")
      .select("id, lead_id")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const leadId = contact.lead_id || contact.id;

    let webhookResponse: Response;
    let webhookData: any;
    try {
      webhookResponse = await fetch(client.stop_bot_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Lead_ID: leadId,
          Request_Type: requestType,
        }),
      });

      try {
        webhookData = await webhookResponse.json();
      } catch {
        webhookData = await webhookResponse.text();
      }

      if (!webhookResponse.ok) {
        console.error("Stop bot webhook error:", webhookResponse.status, webhookData);
        return new Response(
          JSON.stringify({ error: `Webhook returned ${webhookResponse.status}`, details: webhookData }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (fetchError: any) {
      console.error("Stop bot webhook fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: `Failed to reach webhook: ${fetchError.message}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      JSON.stringify({ success: true, request_type: requestType, setter_stopped: setterStopped, data: webhookData }),
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
