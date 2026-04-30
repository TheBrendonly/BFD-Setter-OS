// ghl-tag-webhook (phase-11e)
//
// Receives GHL ContactTagUpdate webhooks. When a tag matching a workflow's
// engagement_workflows.new_leads_tag is added, enrol the contact in that
// workflow's cadence. The cadence-end logic in runEngagement.writeCadenceMetrics
// removes the tag at every terminal stop_reason.
//
// Idempotency: duplicate webhook deliveries with the same contactId + tag are
// safe — we skip enrolment if a non-terminal engagement_executions row already
// exists for (client_id, ghl_contact_id, workflow_id).
//
// Sig verification: HMAC-SHA256 over raw body when clients.ghl_webhook_secret
// is set, mirroring receive-dm-webhook (phase-8a). Backwards-compat: skipped
// when no secret is configured.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-signature",
};

const GHL_BASE = "https://services.leadconnectorhq.com";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifyGhlSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const sigBytes = new Uint8Array(sigBuf);
  let hex = "";
  for (const b of sigBytes) hex += b.toString(16).padStart(2, "0");
  const expected = hex.toLowerCase();
  const presented = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
  if (expected.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

type GhlContactDetails = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
};

async function fetchGhlContact(
  apiKey: string,
  contactId: string,
): Promise<GhlContactDetails | null> {
  try {
    const r = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      console.warn(`fetchGhlContact ${r.status} for ${contactId}`);
      return null;
    }
    const j = await r.json().catch(() => null) as any;
    const c = j?.contact ?? j ?? null;
    if (!c) return null;
    return {
      firstName: c.firstName ?? c.first_name ?? null,
      lastName: c.lastName ?? c.last_name ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
    };
  } catch (e) {
    console.warn(`fetchGhlContact threw: ${(e as Error).message}`);
    return null;
  }
}

async function enrollLeadInEngagement(args: {
  supabase: any;
  clientId: string;
  workflowId: string;
  ghlAccountId: string;
  leadId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}): Promise<string | null> {
  const { supabase, clientId, workflowId, ghlAccountId, leadId, contactName, contactPhone, contactEmail } = args;

  const { data: existing } = await supabase
    .from("engagement_executions")
    .select("id, status")
    .eq("client_id", clientId)
    .eq("workflow_id", workflowId)
    .eq("ghl_contact_id", leadId)
    .in("status", ["pending", "running", "waiting"])
    .limit(1)
    .maybeSingle();
  if (existing) {
    console.log(`ghl-tag-webhook: contact ${leadId} already enrolled in ${workflowId} (execution=${existing.id})`);
    return null;
  }

  const { data: execution, error: execErr } = await supabase
    .from("engagement_executions")
    .insert({
      client_id: clientId,
      workflow_id: workflowId,
      ghl_contact_id: leadId,
      ghl_account_id: ghlAccountId,
      contact_name: contactName,
      contact_phone: contactPhone,
      status: "pending",
      current_node_index: 0,
      stage_description: "Auto-enrolled via ghl-tag-webhook",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (execErr || !execution) {
    console.warn("ghl-tag-webhook: engagement_executions insert failed", execErr);
    return null;
  }

  const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
  if (!triggerKey) {
    console.warn("ghl-tag-webhook: TRIGGER_SECRET_KEY missing; enrolled but not triggered");
    return execution.id as string;
  }

  const triggerResp = await fetch(
    "https://api.trigger.dev/api/v1/tasks/run-engagement/trigger",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${triggerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          execution_id: execution.id,
          Lead_ID: leadId,
          GHL_Account_ID: ghlAccountId,
          client_id: clientId,
          workflow_id: workflowId,
          campaign_id: "ghl-tag-webhook",
          Name: contactName ?? undefined,
          Email: contactEmail ?? undefined,
          Phone: contactPhone ?? undefined,
        },
      }),
    },
  );
  if (!triggerResp.ok) {
    const errText = await triggerResp.text();
    console.warn(`ghl-tag-webhook: Trigger.dev run-engagement failed ${triggerResp.status}: ${errText.slice(0, 200)}`);
    return execution.id as string;
  }
  const triggerJson = await triggerResp.json().catch(() => ({})) as any;
  const trigger_run_id = triggerJson?.id ?? null;
  if (trigger_run_id) {
    await supabase
      .from("engagement_executions")
      .update({ trigger_run_id })
      .eq("id", execution.id);
  }
  return execution.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method Not Allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: any = null;
  let rawBody = "";
  try {
    rawBody = await req.text();
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // GHL Webhook V2 payload variants:
  //  - ContactTagUpdate emits `addedTags: string[]` and `removedTags: string[]`
  //  - Some flows just emit the post-update `tags` array
  // Accept either; prefer addedTags when present.
  const contactId: string | null = body.contactId ?? body.contact?.id ?? null;
  const locationId: string | null = body.locationId ?? body.location?.id ?? null;
  const addedTags: string[] = Array.isArray(body.addedTags) ? body.addedTags : [];
  const allTags: string[] = Array.isArray(body.tags) ? body.tags : [];
  const candidateTags = (addedTags.length > 0 ? addedTags : allTags)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());

  if (!contactId) return jsonResponse({ error: "contactId is required" }, 400);
  if (!locationId) return jsonResponse({ error: "locationId is required" }, 400);
  if (candidateTags.length === 0) {
    return jsonResponse({ ok: true, enrolled: null, reason: "no_tags_in_payload" });
  }

  // Resolve client by ghl_location_id.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, ghl_location_id, ghl_api_key, ghl_webhook_secret")
    .eq("ghl_location_id", locationId)
    .maybeSingle();
  if (clientErr) {
    console.warn("ghl-tag-webhook: client lookup error", clientErr);
    return jsonResponse({ error: "Client lookup failed" }, 500);
  }
  if (!client) {
    return jsonResponse({ ok: true, enrolled: null, reason: "client_not_found" }, 404);
  }

  // Phase 8a-style sig verification when configured.
  if (client.ghl_webhook_secret) {
    const sigHeader = req.headers.get("x-wh-signature");
    if (!sigHeader) {
      return jsonResponse({ ok: false, reason: "sig_missing" }, 403);
    }
    const valid = await verifyGhlSignature(rawBody, sigHeader, client.ghl_webhook_secret as string);
    if (!valid) {
      return jsonResponse({ ok: false, reason: "sig_invalid" }, 403);
    }
  }

  // Find the workflow whose new_leads_tag matches one of the added tags.
  // Partial unique index ensures at-most-one ON workflow per client.
  const { data: workflow, error: wfErr } = await supabase
    .from("engagement_workflows")
    .select("id, new_leads_tag, is_active, is_new_leads_campaign")
    .eq("client_id", client.id)
    .eq("is_active", true)
    .eq("is_new_leads_campaign", true)
    .in("new_leads_tag", candidateTags)
    .limit(1)
    .maybeSingle();
  if (wfErr) {
    console.warn("ghl-tag-webhook: workflow lookup error", wfErr);
    return jsonResponse({ error: "Workflow lookup failed" }, 500);
  }
  if (!workflow) {
    return jsonResponse({ ok: true, enrolled: null, reason: "no_matching_workflow" });
  }

  // Fetch contact details from GHL (need name/phone for cadence interpolation).
  let contact: GhlContactDetails | null = null;
  if (client.ghl_api_key) {
    contact = await fetchGhlContact(client.ghl_api_key as string, contactId);
  }
  const fullName = contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || null
    : null;

  // Upsert leads row (find-or-create, mirrors intake-lead pattern).
  await supabase
    .from("leads")
    .upsert(
      {
        client_id: client.id,
        lead_id: contactId,
        first_name: contact?.firstName ?? null,
        last_name: contact?.lastName ?? null,
        phone: contact?.phone ?? null,
        email: contact?.email ?? null,
      },
      { onConflict: "client_id,lead_id" },
    );

  // Enrol.
  let executionId: string | null = null;
  try {
    executionId = await enrollLeadInEngagement({
      supabase,
      clientId: client.id,
      workflowId: workflow.id,
      ghlAccountId: locationId,
      leadId: contactId,
      contactName: fullName,
      contactPhone: contact?.phone ?? null,
      contactEmail: contact?.email ?? null,
    });
  } catch (enrollErr) {
    console.warn("ghl-tag-webhook: enrol failed", enrollErr);
    return jsonResponse({ error: "Enrolment failed" }, 500);
  }

  return jsonResponse({
    ok: true,
    enrolled: executionId,
    reason: executionId ? "enrolled" : "already_enrolled",
    workflow_id: workflow.id,
    matched_tag: candidateTags.find((t) => t === workflow.new_leads_tag) ?? null,
  });
});
