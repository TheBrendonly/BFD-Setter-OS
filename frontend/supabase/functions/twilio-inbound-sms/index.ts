import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

// Twilio signature: HMAC-SHA1 of (full public URL + sorted concatenation of form
// param key+value pairs), base64-encoded. Compare against X-Twilio-Signature.
async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
  authToken: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  return constantTimeEqual(btoa(bin), signatureHeader);
}

// Constant-time compare (length leak only; base64 signature length is fixed).
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Twilio sends form-encoded data. Capture ALL params for signature checking.
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      params[k] = typeof v === "string" ? v : "";
    }
    const from = params["From"];
    const to = params["To"];
    const body = params["Body"];
    const messageSid = params["MessageSid"];

    if (!from || !to || !body) {
      return new Response(
        '<Response><Message>Missing required fields</Message></Response>',
        { status: 400, headers: { "Content-Type": "text/xml" } }
      );
    }

    // Find the client that owns this Twilio number
    const { data: clients, error: clientError } = await supabase
      .from("clients")
      .select("id, twilio_auth_token")
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

    // SECURITY: verify the request actually came from Twilio before trusting any
    // of its contents. `req.url` is the internal host inside Supabase Edge, so the
    // signed public URL must be reconstructed from SUPABASE_URL (matches the
    // SmsUrl set by twilio-configure-webhook).
    const authToken = clients[0].twilio_auth_token as string | null;
    if (!authToken) {
      console.warn("No twilio_auth_token configured for client; rejecting", { clientId });
      return new Response('<Response></Response>', {
        status: 403,
        headers: { "Content-Type": "text/xml" },
      });
    }
    const publicUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-inbound-sms`;
    const signatureOk = await verifyTwilioSignature(
      publicUrl,
      params,
      req.headers.get("X-Twilio-Signature"),
      authToken,
    );
    if (!signatureOk) {
      console.warn("Twilio signature verification failed; rejecting", { clientId, to });
      return new Response('<Response></Response>', {
        status: 403,
        headers: { "Content-Type": "text/xml" },
      });
    }

    console.log(`Inbound SMS from ${from} to ${to}: ${body}`);

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
