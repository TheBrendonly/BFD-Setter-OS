// G3-8(a) — execute-lead-webhook edge fn.
//
// Server-side replacement for LeadRow.executeLeadManually's in-browser flow. Previously the
// browser read clients.supabase_service_key (via a campaigns->clients join) and forwarded it
// in the database-reactivation webhook payload — a service-role secret transiting the client.
// This loads the client config server-side (service role) and POSTs the SAME payload to the
// campaign's webhook_url, so the secret never reaches the browser. Status transitions
// (processing -> completed/failed) also move server-side. Payload is byte-identical to the
// legacy webhookData (see payload.ts), so the live n8n receiver is unchanged.
//
// In-project re-test (daytime): trigger the "execute lead" button on a reactivation campaign
// and confirm the webhook fires + the lead row reaches completed. NOT Voice-gated.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";
import { buildReactivationWebhookPayload } from "./payload.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "invalid_json" }, 400);

    const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;
    const leadId = typeof body.leadId === "string" ? body.leadId : null;
    if (!campaignId) return json({ error: "campaignId is required" }, 400);
    if (!leadId) return json({ error: "leadId is required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load the campaign (owner + webhook target). Reading minimal, non-secret campaign
    // metadata to derive the owning client_id before the tenant guard.
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .select("id, client_id, campaign_name, reactivation_notes, webhook_url")
      .eq("id", campaignId)
      .single();
    if (campErr || !campaign) return json({ error: "campaign_not_found" }, 404);

    const ownerClientId = (campaign as Record<string, string | null>).client_id;
    if (!ownerClientId) return json({ error: "campaign has no client_id" }, 400);

    // Tenant guard: the caller's agency/client must own this campaign's client.
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), ownerClientId);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const webhookUrl = (campaign as Record<string, string | null>).webhook_url;
    if (!webhookUrl) return json({ error: "campaign has no webhook_url" }, 400);

    // Load the lead, scoped to this campaign (prevents cross-campaign lead ids).
    const { data: lead, error: leadErr } = await supabase
      .from("campaign_leads")
      .select("id, lead_data, scheduled_for, campaign_id")
      .eq("id", leadId)
      .eq("campaign_id", campaignId)
      .single();
    if (leadErr || !lead) return json({ error: "lead_not_found" }, 404);

    // Load the client config SERVER-SIDE — the service key never reaches the browser.
    const { data: client } = await supabase
      .from("clients")
      .select(
        "supabase_url, supabase_service_key, supabase_table_name, database_reactivation_inbound_webhook_url",
      )
      .eq("id", ownerClientId)
      .single();

    await supabase.from("campaign_leads").update({ status: "processing" }).eq("id", leadId);

    const processedAt = new Date().toISOString();
    const payload = buildReactivationWebhookPayload({
      leadData: (lead as Record<string, unknown>).lead_data,
      campaignName: ((campaign as Record<string, string | null>).campaign_name) ?? null,
      reactivationNotes: ((campaign as Record<string, string | null>).reactivation_notes) ?? null,
      leadId,
      campaignId,
      scheduledFor: ((lead as Record<string, string | null>).scheduled_for) ?? null,
      processedAt,
      clientConfig: (client as Record<string, string | null>) ?? {},
    });

    let webhookOk = false;
    let webhookStatus = 0;
    let errorMessage = "";
    try {
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      webhookStatus = resp.status;
      webhookOk = resp.ok;
      if (!resp.ok) errorMessage = `Webhook failed with status ${resp.status}`;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }

    if (webhookOk) {
      await supabase
        .from("campaign_leads")
        .update({ status: "completed", processed_at: processedAt })
        .eq("id", leadId);
      return json({ ok: true, status: "completed", webhookStatus });
    }

    await supabase
      .from("campaign_leads")
      .update({ status: "failed", error_message: errorMessage, processed_at: processedAt })
      .eq("id", leadId);
    return json({ ok: false, status: "failed", webhookStatus, error: errorMessage }, 502);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
