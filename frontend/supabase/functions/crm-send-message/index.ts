import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { pushSmsToGhl } from "../_shared/ghl-conversations.ts";

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

    const { client_id, contact_id, message } = await req.json();

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

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("twilio_account_sid, twilio_auth_token, retell_phone_1, twilio_default_phone, ghl_location_id, ghl_api_key, ghl_conversation_provider_id, supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const twilioSid = client.twilio_account_sid as string | null;
    const twilioAuth = client.twilio_auth_token as string | null;
    const fromNumber =
      (client.retell_phone_1 as string | null) || (client.twilio_default_phone as string | null);
    if (!twilioSid || !twilioAuth || !fromNumber) {
      return new Response(
        JSON.stringify({ error: "Twilio is not configured. Go to Credentials to add your Twilio SID, auth token and number." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get contact to find lead_id + phone
    const { data: contact, error: contactError } = await supabase
      .from("leads")
      .select("id, lead_id, phone")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: "Contact not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const leadId = contact.lead_id || contact.id;
    const toNumber = contact.phone as string | null;
    if (!toNumber) {
      return new Response(
        JSON.stringify({ error: "This contact has no phone number on file." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // ── Send via Twilio (the GHL send-message webhook was retired 2026-06-17) ─
    const supabaseUrlEnv = Deno.env.get("SUPABASE_URL");
    const statusCallbackUrl = supabaseUrlEnv
      ? `${supabaseUrlEnv.replace(/\/$/, "")}/functions/v1/twilio-status-webhook`
      : null;
    const twilioFields: Record<string, string> = {
      From: fromNumber,
      To: toNumber,
      Body: message.trim(),
    };
    if (statusCallbackUrl) twilioFields.StatusCallback = statusCallbackUrl;

    let twilioData: { sid?: string; code?: number; message?: string };
    try {
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
          },
          body: new URLSearchParams(twilioFields).toString(),
        }
      );
      // Twilio returns failed-send fields as `code` + `message`.
      twilioData = await twilioRes.json().catch(() => ({}));
      if (!twilioRes.ok) {
        await supabase.from("error_logs").insert({
          client_ghl_account_id: client.ghl_location_id || client_id,
          error_type: "MANUAL_SMS_TWILIO",
          error_message: `Twilio send failed: ${twilioData.code} ${twilioData.message}`,
          severity: "error",
          lead_id: contact_id,
          context: { error_code: twilioData.code, lead_id_sent: leadId },
        });
        throw new Error(`Twilio error (${twilioData.code}): ${twilioData.message}`);
      }
    } catch (fetchErr: any) {
      // If it's our re-thrown error, pass it through
      if (fetchErr.message?.startsWith("Twilio error")) {
        throw fetchErr;
      }
      // Network / DNS error
      await supabase.from("error_logs").insert({
        client_ghl_account_id: client.ghl_location_id || client_id,
        error_type: "MANUAL_SMS_TWILIO",
        error_message: `Failed to reach Twilio: ${fetchErr.message}`,
        severity: "error",
        lead_id: contact_id,
        context: { error: fetchErr.message, lead_id_sent: leadId },
      });
      throw new Error(`Failed to reach Twilio: ${fetchErr.message}`);
    }

    // Stamp the outbound on message_queue so the status webhook can mirror
    // terminal states back to it.
    if (twilioData.sid) {
      try {
        await supabase.from("message_queue").insert({
          lead_id: leadId,
          ghl_account_id: client.ghl_location_id || client_id,
          message_body: message.trim(),
          contact_phone: toNumber,
          channel: "sms_outbound",
          twilio_message_sid: twilioData.sid,
          processed: true,
        });
      } catch (insErr) {
        console.warn("crm-send-message: outbound message_queue insert failed (non-fatal)", insErr);
      }
    }

    // Mirror the outbound body to GHL so the owner sees the conversation thread.
    if (client.ghl_api_key && client.ghl_location_id) {
      const mirror = await pushSmsToGhl({
        ghlApiKey: client.ghl_api_key as string,
        ghlLocationId: client.ghl_location_id as string,
        contactId: leadId,
        conversationProviderId: (client.ghl_conversation_provider_id as string | null) ?? null,
        message: message.trim(),
        direction: "outbound",
        altId: twilioData.sid ?? null,
      });
      if (!mirror.ok) {
        console.warn("crm-send-message: GHL mirror non-OK", mirror);
      }
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
