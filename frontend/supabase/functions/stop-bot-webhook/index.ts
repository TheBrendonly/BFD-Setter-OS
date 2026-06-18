import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { normalizePhone } from "../_shared/phone.ts";

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

    // Additional guard: reject empty contact_id to prevent undefined in later queries
    if (typeof contact_id === "string" && contact_id.trim() === "") {
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

    // Resolve the target lead. contact_id may be either:
    //   - a UUID (leads.id) — sent by Chats.tsx (selectedLeadId)
    //   - a text GHL lead_id (leads.lead_id) — sent by ContactDetail.tsx (contactId from route)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      contact_id
    );

    let leadQuery = supabase
      .from("leads")
      .select("id, phone, normalized_phone")
      .eq("client_id", client_id);

    if (isUuid) {
      leadQuery = leadQuery.eq("id", contact_id);
    } else {
      leadQuery = leadQuery.eq("lead_id", contact_id);
    }

    const { data: resolvedLead, error: leadError } = await leadQuery.maybeSingle();

    if (leadError) {
      console.error("Failed to resolve lead:", leadError);
      // Return early on lookup error to avoid proceeding with writes when the
      // lead resolution failed (a real Postgres/RLS error should not silently fall through).
      return new Response(
        JSON.stringify({ success: true, note: "lookup_error" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const setterStopped = requestType === "Stop";

    // Determine the normalized phone for fan-out across all leads on this number.
    const resolvedNormalizedPhone =
      resolvedLead?.normalized_phone ??
      normalizePhone(resolvedLead?.phone ?? null);

    if (resolvedNormalizedPhone) {
      // Fan-out: set setter_stopped on ALL leads sharing (client_id, normalized_phone).
      // Note: the following two writes (setter_stopped update + lead_optouts upsert/delete)
      // are not transactional (edge functions have no transaction support), so a failure
      // between them leaves partial state. The next STOP/START retry will attempt both again.
      const { error: updateError } = await supabase
        .from("leads")
        .update({ setter_stopped: setterStopped })
        .eq("client_id", client_id)
        .eq("normalized_phone", resolvedNormalizedPhone);

      if (updateError) {
        console.error("Failed to update setter_stopped by phone:", updateError);
      }

      if (setterStopped) {
        // Upsert opt-out record keyed by (client_id, phone) — same pattern as receive-twilio-sms.
        const { error: optoutError } = await supabase
          .from("lead_optouts")
          .upsert(
            { client_id, phone: resolvedNormalizedPhone, source: "ui_stop" },
            { onConflict: "client_id,phone" }
          );
        if (optoutError) {
          console.error("Failed to upsert lead_optouts:", optoutError);
        }
      } else {
        // Symmetric: remove opt-out record so send-path gate re-opens.
        const { error: deleteError } = await supabase
          .from("lead_optouts")
          .delete()
          .eq("client_id", client_id)
          .eq("phone", resolvedNormalizedPhone);
        if (deleteError) {
          console.error("Failed to delete lead_optouts:", deleteError);
        }
      }
    } else if (resolvedLead) {
      // Phoneless lead: fall back to stopping just this single row by uuid id.
      const { error: updateError } = await supabase
        .from("leads")
        .update({ setter_stopped: setterStopped })
        .eq("id", resolvedLead.id);

      if (updateError) {
        console.error("Failed to update setter_stopped (phoneless fallback):", updateError);
      }
    } else {
      // Lead could not be resolved — log and continue (don't 404; the UI already
      // toggled optimistically and a hard error is more confusing than a no-op here).
      console.error("stop-bot-webhook: lead not found for contact_id:", contact_id);
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
