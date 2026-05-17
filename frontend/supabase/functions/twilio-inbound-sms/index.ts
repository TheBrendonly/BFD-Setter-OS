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

    // Twilio sends form-encoded data
    const formData = await req.formData();
    const from = formData.get("From") as string;
    const to = formData.get("To") as string;
    const body = formData.get("Body") as string;
    const messageSid = formData.get("MessageSid") as string;

    console.log(`Inbound SMS from ${from} to ${to}: ${body}`);

    if (!from || !to || !body) {
      return new Response(
        '<Response><Message>Missing required fields</Message></Response>',
        { status: 400, headers: { "Content-Type": "text/xml" } }
      );
    }

    // Find the client that owns this Twilio number
    const { data: clients, error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("twilio_default_phone", to);

    if (clientError || !clients || clients.length === 0) {
      console.error("No client found for Twilio number:", to);
      // Return empty TwiML so Twilio doesn't retry
      return new Response(
        '<Response></Response>',
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }

    const clientId = clients[0].id;

    // Find the contact by phone number within this client
    const { data: contacts, error: contactError } = await supabase
      .from("demo_page_contacts")
      .select("id")
      .eq("client_id", clientId)
      .eq("phone_number", from);

    if (contactError || !contacts || contacts.length === 0) {
      console.log("No matching contact found for number:", from, "client:", clientId);
      // Still return 200 so Twilio doesn't retry
      return new Response(
        '<Response></Response>',
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }

    const contactId = contacts[0].id;

    // Save inbound message
    const { error: insertError } = await supabase
      .from("sms_messages")
      .insert({
        contact_id: contactId,
        client_id: clientId,
        direction: "inbound",
        body: body,
        twilio_sid: messageSid,
        status: "received",
        from_number: from,
        to_number: to,
      });

    if (insertError) {
      console.error("Error saving inbound message:", insertError);
    }

    // Return empty TwiML (no auto-reply)
    return new Response(
      '<Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  } catch (error) {
    console.error("Error in twilio-inbound-sms:", error);
    return new Response(
      '<Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }
});
