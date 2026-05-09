// intake-lead — public lead-creation endpoint for non-GHL sources.
//
// Phase 5 of the master rebuild. Lets clients drop a JS snippet on their
// website / Calendly thank-you / Typeform integration / Stripe success URL
// to push a lead into 1prompt-OS without going through GHL Instant Forms.
//
// Auth: shared per-client secret in clients.intake_lead_secret. Required
// header `Authorization: Bearer <secret>`. NOT a Supabase JWT — clients
// embed this in static HTML snippets, so it must be opaque to the
// frontend bundle.
//
// Flow:
//   1. Auth: clientId in body + bearer matches clients.intake_lead_secret
//   2. Find-or-create GHL contact by phone / email
//   3. Insert into bfd-platform.leads (canonical) + dual-write to client mirror
//   4. If clients.auto_engagement_workflow_id is set, fire runEngagement
//      (uses the same path as sync-ghl-contact's auto-enroll)
//   5. Return { ok, lead_id, ghl_contact_id, engagement_execution_id? }
//
// Idempotency: relies on UNIQUE (client_id, lead_id) on platform.leads.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type IntakeBody = {
  clientId?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  source?: string;
  custom?: Record<string, unknown>;
  tags?: string[];
};

class IntakeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Normalise phone to E.164-ish — strip whitespace + dashes/parens; if it
// looks like a 10-digit AU mobile (04...) prepend +61. Anything else is
// passed through; downstream GHL will reject malformed.
function normalisePhone(input: string | undefined): string | null {
  if (!input) return null;
  const cleaned = input.replace(/[\s\-()]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned;
  if (/^04\d{8}$/.test(cleaned)) return "+61" + cleaned.slice(1);
  return cleaned;
}

async function findOrCreateGhlContact(args: {
  ghlApiKey: string;
  ghlLocationId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  tags: string[];
}): Promise<{ contactId: string }> {
  const { ghlApiKey, ghlLocationId, firstName, lastName, phone, email, source, tags } = args;

  const headers = {
    Authorization: `Bearer ${ghlApiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    Accept: "application/json",
  };

  // Try to search by phone first (preferred), then email
  const queries = [phone, email].filter(Boolean) as string[];
  for (const q of queries) {
    const searchUrl = new URL("https://services.leadconnectorhq.com/contacts/search");
    searchUrl.searchParams.set("locationId", ghlLocationId);
    searchUrl.searchParams.set("query", q);
    const r = await fetch(searchUrl.toString(), { headers });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const contacts = j?.contacts || [];
      const exact = contacts.find((c: any) =>
        (phone && (c?.phone === phone || c?.phone === phone.replace(/^\+/, ""))) ||
        (email && c?.email && c.email.toLowerCase() === email.toLowerCase())
      );
      if (exact?.id) return { contactId: exact.id };
    }
  }

  // Create new
  const createBody: Record<string, unknown> = {
    locationId: ghlLocationId,
    source: source || "intake-lead",
  };
  if (firstName) createBody.firstName = firstName;
  if (lastName) createBody.lastName = lastName;
  if (phone) createBody.phone = phone;
  if (email) createBody.email = email;
  if (Array.isArray(tags) && tags.length > 0) createBody.tags = tags;

  const createResp = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers,
    body: JSON.stringify(createBody),
  });
  const createJson = await createResp.json().catch(() => null);
  if (createResp.ok) {
    const newId = createJson?.contact?.id || createJson?.id;
    if (!newId) throw new IntakeError(502, "GHL contact create returned no id");
    return { contactId: newId };
  }
  // Duplicate-handling pattern (per memory reference_ghl_contact_create_duplicate)
  const dupId = createJson?.meta?.contactId;
  if (createResp.status === 400 && dupId) {
    return { contactId: dupId };
  }
  throw new IntakeError(502, `GHL contact create failed ${createResp.status}: ${JSON.stringify(createJson).slice(0, 200)}`);
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

  const { data: wf } = await supabase
    .from("engagement_workflows")
    .select("id")
    .eq("id", workflowId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!wf) {
    console.warn(`intake-lead: workflow ${workflowId} not found for client ${clientId}, skipping enroll`);
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
      stage_description: "Auto-enrolled via intake-lead",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (execErr || !execution) {
    console.warn("intake-lead: engagement_executions insert failed", execErr);
    return null;
  }

  const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
  if (!triggerKey) {
    console.warn("intake-lead: TRIGGER_SECRET_KEY missing; engagement enrolled but not triggered");
    return execution.id as string;
  }

  const supabaseUrlEnv = Deno.env.get("SUPABASE_URL")!;
  const makeRetellCallUrl = `${supabaseUrlEnv}/functions/v1/make-retell-outbound-call`;

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
          campaign_id: "intake-lead",
          Name: contactName ?? undefined,
          Email: contactEmail ?? undefined,
          Phone: contactPhone ?? undefined,
          make_retell_call_url: makeRetellCallUrl,
          contact_fields: {
            phone: contactPhone ?? "",
            email: contactEmail ?? "",
            name: contactName ?? "",
            first_name: (contactName ?? "").trim().split(/\s+/)[0] || "",
          },
        },
      }),
    }
  );
  if (!triggerResp.ok) {
    const errText = await triggerResp.text();
    console.warn(`intake-lead: Trigger.dev run-engagement failed ${triggerResp.status}: ${errText.slice(0, 200)}`);
    return execution.id as string;
  }
  const triggerJson = await triggerResp.json().catch(() => ({}));
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
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => null)) as IntakeBody | null;
    if (!body || typeof body !== "object") {
      throw new IntakeError(400, "Invalid JSON body");
    }
    const clientId = body.clientId;
    if (!clientId) throw new IntakeError(400, "clientId is required");

    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      throw new IntakeError(401, "Missing Authorization: Bearer <intake_lead_secret>");
    }
    const presentedSecret = auth.slice("Bearer ".length).trim();
    if (!presentedSecret) {
      throw new IntakeError(401, "Empty Bearer token");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, ghl_location_id, ghl_api_key, intake_lead_secret, auto_engagement_workflow_id, supabase_url, supabase_service_key, supabase_table_name")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr || !client) {
      throw new IntakeError(404, "Client not found");
    }
    if (!client.intake_lead_secret) {
      throw new IntakeError(403, "Intake disabled for this client (no secret configured)");
    }
    // Constant-time compare
    const expected = client.intake_lead_secret as string;
    if (presentedSecret.length !== expected.length) {
      throw new IntakeError(403, "Invalid intake secret");
    }
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ presentedSecret.charCodeAt(i);
    }
    if (mismatch !== 0) {
      throw new IntakeError(403, "Invalid intake secret");
    }
    if (!client.ghl_api_key || !client.ghl_location_id) {
      throw new IntakeError(409, "Client has no GHL credentials configured");
    }

    const firstName = (body.first_name || "").trim() || null;
    const lastName = (body.last_name || "").trim() || null;
    const phone = normalisePhone(body.phone);
    const email = (body.email || "").trim().toLowerCase() || null;

    if (!phone && !email) {
      throw new IntakeError(400, "At least one of phone or email is required");
    }

    // Resolve / create GHL contact
    const { contactId } = await findOrCreateGhlContact({
      ghlApiKey: client.ghl_api_key as string,
      ghlLocationId: client.ghl_location_id as string,
      firstName,
      lastName,
      phone,
      email,
      source: body.source || "intake-lead",
      tags: Array.isArray(body.tags) ? body.tags : [],
    });

    // Upsert into platform leads
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;
    await supabase
      .from("leads")
      .upsert(
        {
          client_id: client.id,
          lead_id: contactId,
          first_name: firstName,
          last_name: lastName,
          phone,
          email,
        },
        { onConflict: "client_id,lead_id" },
      );

    // Dual-write to per-client external Supabase
    if (client.supabase_url && client.supabase_service_key) {
      try {
        const ext = createClient(client.supabase_url as string, client.supabase_service_key as string);
        const tableName = (client.supabase_table_name as string | null)?.trim() || "leads";
        const externalRecord: Record<string, unknown> = { id: contactId };
        if (firstName) externalRecord.first_name = firstName;
        if (lastName) externalRecord.last_name = lastName;
        if (phone) externalRecord.phone = phone;
        if (email) externalRecord.email = email;
        await ext.from(tableName).upsert(externalRecord, { onConflict: "id" });
      } catch (mirrorErr) {
        console.warn("intake-lead: mirror write failed (non-fatal)", mirrorErr);
      }
    }

    // Optional cadence enrolment
    let executionId: string | null = null;
    if (client.auto_engagement_workflow_id) {
      try {
        executionId = await enrollLeadInEngagement({
          supabase,
          clientId: client.id,
          workflowId: client.auto_engagement_workflow_id as string,
          ghlAccountId: client.ghl_location_id as string,
          leadId: contactId,
          contactName: fullName,
          contactPhone: phone,
          contactEmail: email,
        });
      } catch (enrollErr) {
        console.warn("intake-lead: auto-enroll failed (non-fatal)", enrollErr);
      }
    }

    return jsonResponse({
      ok: true,
      lead_id: contactId,
      ghl_contact_id: contactId,
      engagement_execution_id: executionId,
    });
  } catch (err) {
    if (err instanceof IntakeError) {
      return jsonResponse({ ok: false, error: err.message }, err.status);
    }
    console.error("intake-lead error:", err);
    return jsonResponse({ ok: false, error: (err as Error).message ?? "Internal server error" }, 500);
  }
});
