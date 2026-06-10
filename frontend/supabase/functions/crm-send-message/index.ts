import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT_MS = 10_000; // 10 seconds between webhook calls per contact

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

    const { client_id, contact_id, message, channel } = await req.json();

    if (!client_id || !contact_id || !message?.trim()) {
      return new Response(
        JSON.stringify({ error: "Missing client_id, contact_id, or message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the caller's JWT signature AND that they own client_id. Previously
    // the token was base64-decoded without verification and client_id was never
    // ownership-checked → any forged token could send a message as ANY tenant.
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

    const selectedChannel = channel || 'sms';

    // Map internal lowercase channel to display-case for webhook payload
    const CHANNEL_DISPLAY: Record<string, string> = {
      sms: 'SMS',
      whatsapp: 'WhatsApp',
      instagram: 'Instagram',
      facebook: 'Facebook',
      imessage: 'iMessage',
      linkedin: 'LinkedIn',
      live_chat: 'Chat',
    };
    const channelDisplay = CHANNEL_DISPLAY[selectedChannel] || selectedChannel;

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("send_message_webhook_url, ghl_location_id, supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!client.send_message_webhook_url) {
      return new Response(
        JSON.stringify({ error: "Send Message Webhook URL not configured. Go to Credentials > GoHighLevel to add it." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get contact to find lead_id
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

    // ── Rate limit: 10s per contact ──
    const { data: lastSent } = await supabase
      .from("error_logs")
      .select("created_at")
      .eq("client_ghl_account_id", client.ghl_location_id || client_id)
      .eq("error_type", "SMS_WEBHOOK_SENT")
      .eq("lead_id", contact_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (lastSent && lastSent.length > 0) {
      const elapsed = Date.now() - new Date(lastSent[0].created_at).getTime();
      if (elapsed < RATE_LIMIT_MS) {
        const waitSec = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
        return new Response(
          JSON.stringify({ error: `Rate limited. Please wait ${waitSec}s before sending again.`, rate_limited: true, wait_seconds: waitSec }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Send to webhook
    let webhookResponse: Response;
    let webhookData: any;
    try {
      webhookResponse = await fetch(client.send_message_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Lead_ID: leadId,
          Message: message.trim(),
          Channel: channelDisplay,
        }),
      });

      try {
        webhookData = await webhookResponse.json();
      } catch {
        webhookData = await webhookResponse.text();
      }

      if (!webhookResponse.ok) {
        // Log error to error_logs
        await supabase.from("error_logs").insert({
          client_ghl_account_id: client.ghl_location_id || client_id,
          error_type: "SEND_SMS_WEBHOOK",
          error_message: `Webhook returned ${webhookResponse.status}: ${typeof webhookData === 'string' ? webhookData : JSON.stringify(webhookData)}`,
          severity: "error",
          lead_id: contact_id,
          context: {
            webhook_url: client.send_message_webhook_url,
            status_code: webhookResponse.status,
            response: webhookData,
            lead_id_sent: leadId,
          },
        });

        throw new Error(`Webhook error (${webhookResponse.status}): ${typeof webhookData === 'string' ? webhookData : JSON.stringify(webhookData)}`);
      }
    } catch (fetchErr: any) {
      // If it's our re-thrown error, pass it through
      if (fetchErr.message?.startsWith("Webhook error")) {
        throw fetchErr;
      }

      // Network / DNS error
      await supabase.from("error_logs").insert({
        client_ghl_account_id: client.ghl_location_id || client_id,
        error_type: "SEND_SMS_WEBHOOK",
        error_message: `Failed to reach webhook: ${fetchErr.message}`,
        severity: "error",
        lead_id: contact_id,
        context: {
          webhook_url: client.send_message_webhook_url,
          error: fetchErr.message,
          lead_id_sent: leadId,
        },
      });

      throw new Error(`Failed to reach SMS webhook: ${fetchErr.message}`);
    }

    // Record successful send for rate limiting
    await supabase.from("error_logs").insert({
      client_ghl_account_id: client.ghl_location_id || client_id,
      error_type: "SMS_WEBHOOK_SENT",
      error_message: `SMS webhook sent successfully`,
      severity: "info",
      lead_id: contact_id,
      context: {
        lead_id_sent: leadId,
        message_length: message.trim().length,
      },
    });

    // Write to external Supabase chat_history
    let externalWriteSuccess = false;
    const sessionId = contact.lead_id || contact.id;

    if (client.supabase_url && client.supabase_service_key && sessionId) {
      try {
        const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);
        const messagePayload = {
          type: "ai",
          content: message.trim(),
          additional_kwargs: { source: "manual" },
          response_metadata: {},
        };

        await externalSupabase.from("chat_history").insert({
          session_id: sessionId,
          message: messagePayload,
          timestamp: new Date().toISOString(),
        });

        externalWriteSuccess = true;
      } catch (extErr) {
        console.error("Failed to write to external Supabase:", extErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        external_write: externalWriteSuccess,
        sent_message: {
          type: "human",
          content: message.trim(),
          timestamp: new Date().toISOString(),
          source: "manual",
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in crm-send-sms:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
