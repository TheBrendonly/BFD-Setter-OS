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

    const { account_sid, auth_token, phone_number } = await req.json();

    if (!account_sid || !auth_token || !phone_number) {
      return new Response(
        JSON.stringify({ error: "Missing account_sid, auth_token, or phone_number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const twilioAuth = btoa(`${account_sid}:${auth_token}`);
    const inboundWebhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/receive-twilio-sms`;

    // Step 1: List incoming phone numbers to find the SID for the given number
    const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone_number)}`;
    
    const listResponse = await fetch(listUrl, {
      headers: { Authorization: `Basic ${twilioAuth}` },
    });

    const listData = await listResponse.json();

    if (!listResponse.ok) {
      console.error("Twilio list error:", listData);
      return new Response(
        JSON.stringify({ error: `Twilio API error: ${listData.message || "Failed to list phone numbers"}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!listData.incoming_phone_numbers || listData.incoming_phone_numbers.length === 0) {
      return new Response(
        JSON.stringify({ error: `Phone number ${phone_number} not found in your Twilio account. Make sure it's in E.164 format (e.g. +15551234567).` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const phoneNumberSid = listData.incoming_phone_numbers[0].sid;

    // Step 2: Update the phone number's SMS webhook URL
    const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers/${phoneNumberSid}.json`;

    const updateResponse = await fetch(updateUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        SmsUrl: inboundWebhookUrl,
        SmsMethod: "POST",
      }),
    });

    const updateData = await updateResponse.json();

    if (!updateResponse.ok) {
      console.error("Twilio update error:", updateData);
      return new Response(
        JSON.stringify({ error: `Failed to update webhook: ${updateData.message || "Unknown error"}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully configured SMS webhook for ${phone_number} (${phoneNumberSid}) -> ${inboundWebhookUrl}`);

    return new Response(
      JSON.stringify({
        success: true,
        phone_number_sid: phoneNumberSid,
        webhook_url: inboundWebhookUrl,
        message: `SMS webhook configured automatically for ${phone_number}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in twilio-configure-webhook:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
