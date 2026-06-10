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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { client_id, contact_id, message } = await req.json();

    if (!client_id || !contact_id || !message) {
      return new Response(
        JSON.stringify({ error: "Missing client_id, contact_id, or message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: the service-role client below bypasses RLS, so verify the caller
    // owns this client before reading its Twilio credentials / sending SMS.
    try {
      await authorizeClientRequest(authHeader, client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    // Get client's Twilio credentials
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("twilio_account_sid, twilio_auth_token, twilio_default_phone")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!client.twilio_account_sid || !client.twilio_auth_token || !client.twilio_default_phone) {
      return new Response(
        JSON.stringify({ error: "Twilio credentials not configured. Go to Credentials page to add them." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get contact's phone number
    const { data: contact, error: contactError } = await supabase
      .from("demo_page_contacts")
      .select("phone_number")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send SMS via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${client.twilio_account_sid}/Messages.json`;
    const twilioAuth = btoa(`${client.twilio_account_sid}:${client.twilio_auth_token}`);

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: contact.phone_number,
        From: client.twilio_default_phone,
        Body: message,
      }),
    });

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("Twilio API error:", twilioData);
      return new Response(
        JSON.stringify({ error: `Twilio error: ${twilioData.message || "Unknown error"}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save message to DB
    const { data: savedMsg, error: saveError } = await supabase
      .from("sms_messages")
      .insert({
        contact_id,
        client_id,
        direction: "outbound",
        body: message,
        twilio_sid: twilioData.sid,
        status: twilioData.status || "sent",
        from_number: client.twilio_default_phone,
        to_number: contact.phone_number,
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving message:", saveError);
    }

    return new Response(
      JSON.stringify({ success: true, message: savedMsg, twilio_sid: twilioData.sid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in twilio-send-sms:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
