import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { buildLeadInsert } from "../_shared/lead-insert.ts";
import { assertActiveSubscription } from "../_shared/assertActiveSubscription.ts";
import { AssertAccessError } from "../_shared/assert-client-access.ts";
import { isPhoneRecentDuplicate } from "./dedup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Auth token, header-first. Prefer x-wh-token / Authorization: Bearer so the
    // secret doesn't leak via URL-query access logs, browser history, or Referer.
    // Query/body are kept as a DEPRECATED fallback for existing GHL configs that
    // still post the token in the body; migrate those to the header.
    const bearer = req.headers.get("authorization");
    let token: string | null =
      req.headers.get("x-wh-token") ||
      (bearer && bearer.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null);
    let body: Record<string, unknown> = {};

    try {
      body = await req.json();
    } catch {
      // Body may not be JSON
    }

    if (!token) token = url.searchParams.get("token"); // deprecated
    if (!token && body.token) {
      token = String(body.token); // deprecated
    }

    if (!token) {
      return new Response(
        JSON.stringify({ error: "token is required (x-wh-token header, or deprecated query/body field)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Look up campaign by token
    const { data: campaign, error: campErr } = await supabase
      .from("engagement_campaigns")
      .select("id, client_id, workflow_id, status")
      .eq("enroll_webhook_token", token)
      .single();

    if (campErr || !campaign) {
      return new Response(
        JSON.stringify({ error: "Invalid token — campaign not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (campaign.status !== "active") {
      return new Response(
        JSON.stringify({ error: "Campaign is not active", campaign_status: campaign.status }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // S2b-5 per-token rate-limit (fixed window, keyed on the campaign id ≡ the
    // enroll token). Caps how fast a leaked token can create leads + fire billable
    // engagements. Fail-open on RPC error: the limiter is a safety net, not the
    // gate (the token + active-campaign checks above are the gate).
    const RATE_LIMIT = Number(Deno.env.get("ENROLL_RATE_LIMIT_PER_MIN") || "60");
    const { data: rlCount, error: rlErr } = await supabase.rpc("bump_rate_limit", {
      p_bucket_key: `enroll:${campaign.id}`,
      p_window_seconds: 60,
    });
    if (rlErr) {
      console.warn("campaign-enroll-webhook: rate-limit RPC failed (allowing)", rlErr);
    } else if (typeof rlCount === "number" && rlCount > RATE_LIMIT) {
      console.warn("campaign-enroll-webhook: rate limited", { campaignId: campaign.id, count: rlCount, limit: RATE_LIMIT });
      return new Response(
        JSON.stringify({ error: "rate_limited", limit_per_minute: RATE_LIMIT, retry_after_seconds: 60 }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }

    // Extract contact data from query params first, then fall back to body
    const name = url.searchParams.get("Name") || url.searchParams.get("name") || String(body.name || body.Name || body.contact_name || "");
    const phone = url.searchParams.get("Phone") || url.searchParams.get("phone") || String(body.phone || body.Phone || body.contact_phone || "");
    const email = url.searchParams.get("Email") || url.searchParams.get("email") || String(body.email || body.Email || body.contact_email || "");
    const lead_id_input = url.searchParams.get("Lead_ID") || url.searchParams.get("lead_id") || String(body.lead_id || body.Lead_ID || body.contact_id || body.Contact_ID || "");

    // Parse name into first/last
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    if (!phone && !email && !lead_id_input) {
      return new Response(
        JSON.stringify({ error: "At least one of phone, email, or lead_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientId = campaign.client_id;

    // B1 — server-side subscription gate (dormant unless ENFORCE_SUBSCRIPTION_GATE
    // =true). This webhook is token-authed only, so it's the path that most needs a
    // server gate: blocks billable enrolment (lead create + trigger-engagement) for
    // a non-active client.
    try {
      await assertActiveSubscription(clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    const allHeaders: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });

    const webhookRequestPayload = {
      source: "campaign_enroll_webhook",
      query: Object.fromEntries(url.searchParams),
      body,
      headers: allHeaders,
      params: {
        Lead_ID: lead_id_input,
        Name: name,
        Email: email,
        Phone: phone,
      },
      received_at: new Date().toISOString(),
    };

    if (campaign.workflow_id) {
      const { error: webhookLogError } = await supabase
        .from("workflow_webhook_requests")
        .insert({
          workflow_id: campaign.workflow_id,
          client_id: clientId,
          raw_request: webhookRequestPayload,
          received_at: webhookRequestPayload.received_at,
        });

      if (webhookLogError) {
        console.error("Failed to store campaign webhook request:", webhookLogError);
      }
    }

    let resolvedLeadId = lead_id_input.trim();

    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

    const findLeadByExactIdentifier = async (identifier: string) => {
      const normalizedIdentifier = identifier.trim();
      if (!normalizedIdentifier) return null;

      const { data: externalLeadMatch, error: externalLeadError } = await supabase
        .from("leads")
        .select("id, lead_id, first_name, last_name, phone, email")
        .eq("client_id", clientId)
        .eq("lead_id", normalizedIdentifier)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (externalLeadError) throw externalLeadError;
      if (externalLeadMatch) return externalLeadMatch;

      if (!isUuid(normalizedIdentifier)) {
        return null;
      }

      const { data: internalLeadMatch, error: internalLeadError } = await supabase
        .from("leads")
        .select("id, lead_id, first_name, last_name, phone, email")
        .eq("client_id", clientId)
        .eq("id", normalizedIdentifier)
        .limit(1)
        .maybeSingle();

      if (internalLeadError) throw internalLeadError;
      return internalLeadMatch;
    };

    const findLeadByPhoneOrEmail = async () => {
      if (phone) {
        const { data, error } = await supabase
          .from("leads")
        .select("id, lead_id, first_name, last_name, phone, email")
          .eq("client_id", clientId)
          .eq("phone", phone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (data) return data;
      }

      if (email) {
        const { data, error } = await supabase
          .from("leads")
        .select("id, lead_id, first_name, last_name, phone, email")
          .eq("client_id", clientId)
          .eq("email", email)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (data) return data;
      }

      return null;
    };

    // Find or create lead: exact Lead_ID first, then phone/email fallback, then create.
    let existingLead: { id: string; lead_id: string | null; first_name?: string; last_name?: string; phone?: string; email?: string } | null = null;

    if (resolvedLeadId) {
      existingLead = await findLeadByExactIdentifier(resolvedLeadId);
    }

    if (!existingLead && (phone || email)) {
      existingLead = await findLeadByPhoneOrEmail();

      if (existingLead && resolvedLeadId && !existingLead.lead_id) {
        const { error: backfillLeadIdError } = await supabase
          .from("leads")
          .update({ lead_id: resolvedLeadId })
          .eq("id", existingLead.id)
          .eq("client_id", clientId);

        if (backfillLeadIdError) {
          console.error("Failed to backfill lead_id on existing lead:", backfillLeadIdError);
        }
      }
    }

    if (existingLead) {
      resolvedLeadId = existingLead.lead_id || lead_id_input.trim() || existingLead.id;
    } else {
      const leadIdentifierToStore = lead_id_input.trim();
      const { data: newLead, error: leadErr } = await supabase
        .from("leads")
        .insert(buildLeadInsert({
          clientId,
          leadId: leadIdentifierToStore || null,
          firstName,
          lastName,
          phone,
          email: email || null,
        }))
        .select("id")
        .single();

      if (leadErr || !newLead) {
        console.error("Failed to create lead:", leadErr);
        return new Response(
          JSON.stringify({ error: "Failed to create lead" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      resolvedLeadId = leadIdentifierToStore || newLead.id;
    }

    // S2b-5 phone-dedup: if this same phone was just enrolled for this client via a
    // DIFFERENT lead inside the window, skip the (billable) enrolment. The lead row
    // above is still created/updated for audit; only the trigger-engagement call is
    // skipped. Mirrors ghl-tag-webhook, keyed on normalized_phone.
    if (await isPhoneRecentDuplicate(supabase, clientId, phone, resolvedLeadId)) {
      console.info("campaign-enroll-webhook: skipped duplicate phone enrolment", { clientId, campaignId: campaign.id });
      return new Response(
        JSON.stringify({ success: true, skipped: "duplicate_phone", lead_id: resolvedLeadId, campaign_id: campaign.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Trigger the engagement via the existing trigger-engagement function
    // Pass contact data as URL search params (same pattern as GHL new lead workflow)
    const triggerUrl = new URL(`${supabaseUrl}/functions/v1/trigger-engagement`);
    triggerUrl.searchParams.set("Lead_ID", resolvedLeadId);
    triggerUrl.searchParams.set("Name", name);
    triggerUrl.searchParams.set("Email", email);
    triggerUrl.searchParams.set("Phone", phone);

    const triggerResp = await fetch(triggerUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        lead_id: resolvedLeadId,
        client_id: clientId,
        workflow_id: campaign.workflow_id,
        campaign_id: campaign.id,
        contact_name: name || (existingLead ? `${existingLead.first_name || ''} ${existingLead.last_name || ''}`.trim() : '') || undefined,
        contact_phone: phone || existingLead?.phone || undefined,
        contact_email: email || existingLead?.email || undefined,
        enrollment_source: "webhook",
        is_new_lead: !existingLead,
      }),
    });

    const triggerResult = await triggerResp.json();

    if (!triggerResp.ok) {
      console.error("trigger-engagement failed:", triggerResult);
      return new Response(
        JSON.stringify({ error: "Failed to enroll lead", detail: triggerResult }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        lead_id: resolvedLeadId,
        campaign_id: campaign.id,
        execution_id: triggerResult.execution_id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("campaign-enroll-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
