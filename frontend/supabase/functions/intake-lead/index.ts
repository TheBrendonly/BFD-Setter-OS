// intake-lead — public lead-creation endpoint for non-GHL sources.
//
// Phase 5 of the master rebuild. Lets clients drop a JS snippet on their
// website / Calendly thank-you / Typeform integration / Stripe success URL
// to push a lead into BFD-setter without going through GHL Instant Forms.
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
import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { fetchActiveNewLeadsWorkflows, resolveWorkflow } from "../_shared/resolve-workflow.ts";
import { normalizePhone } from "../_shared/phone.ts";
import { isValidTimeZone } from "../_shared/leadTimezone.ts";
import { resolveLeadByPhone } from "../_shared/leadResolve.ts";
import { isPhoneOptedOut } from "../_shared/optout.ts";
import { assertActiveSubscription } from "../_shared/assertActiveSubscription.ts";
import { AssertAccessError } from "../_shared/assert-client-access.ts";

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

  // Opt-out guard: do not arm a cadence for a phone with a standing opt-out.
  // contactPhone may already be normalized; normalizePhone() is called to get the canonical E.164 form either way.
  const normalizedPhoneForOptOut = normalizePhone(contactPhone ?? undefined);
  if (normalizedPhoneForOptOut) {
    const optedOut = await isPhoneOptedOut(supabase, clientId, normalizedPhoneForOptOut);
    if (optedOut) {
      console.warn(`intake-lead: phone ${normalizedPhoneForOptOut} is opted out for client ${clientId}; skipping enrolment`);
      // Stamp the lead setter_stopped=true so the row reflects the standing opt-out.
      if (leadId) {
        const { error: stopErr } = await supabase
          .from("leads")
          .update({ setter_stopped: true })
          .eq("client_id", clientId)
          .eq("lead_id", leadId);
        if (stopErr) console.error(`intake-lead: failed to stamp setter_stopped for lead ${leadId}:`, stopErr.message);
      }
      return null;
    }
  }

  // Dedup: a website snippet that posts the same form twice (double-click, retry,
  // refresh re-fire) would otherwise arm two parallel cadences for the same lead.
  // Skip if an active enrollment already exists (mirrors sync-ghl-contact).
  const { data: activeExec } = await supabase
    .from("engagement_executions")
    .select("id")
    .eq("client_id", clientId)
    .eq("ghl_contact_id", leadId)
    .eq("workflow_id", workflowId)
    .in("status", ["pending", "running"])
    .limit(1);
  if (activeExec && activeExec.length > 0) {
    console.info("intake-lead: active enrollment already exists, skipping re-enroll", { leadId, workflowId });
    return (activeExec[0] as { id: string }).id;
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
      .select("id, is_system, ghl_location_id, ghl_api_key, intake_lead_secret, auto_engagement_workflow_id, supabase_url, supabase_service_key, supabase_table_name")
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

    // B1 — server-side subscription gate (dormant unless ENFORCE_SUBSCRIPTION_GATE
    // =true). Blocks billable intake (lead create + auto-enrolment) for a non-active
    // client. The helper exempts is_system (the probe) and the default client, so the
    // canary still runs. Translate to IntakeError to fit this function's error model.
    try {
      await assertActiveSubscription(clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) throw new IntakeError(e.status, e.message);
      throw e;
    }

    // is_system clients (the synthetic probe / canary) have no GHL credentials.
    // Mirror the B3 verify-only pattern in runEngagement: skip the GHL contact
    // create/find entirely and synthesize a lead_id so the canary still exercises
    // the real lead -> enroll -> queue pipeline. Real clients still require creds.
    const isSystem = client.is_system === true;
    if (!isSystem && (!client.ghl_api_key || !client.ghl_location_id)) {
      throw new IntakeError(409, "Client has no GHL credentials configured");
    }

    const firstName = (body.first_name || "").trim() || null;
    const lastName = (body.last_name || "").trim() || null;
    // normalisePhone (local) is used for the stored `phone` field and GHL — it passes through
    // ambiguous/short numbers that the shared normalizer would null-out, keeping GHL behaviour
    // unchanged. normalizePhone (shared) is used only for the lookup key and normalized_phone col.
    const phone = normalisePhone(body.phone);
    const normalizedPhone = normalizePhone(body.phone);
    const email = (body.email || "").trim().toLowerCase() || null;

    if (!phone && !email) {
      throw new IntakeError(400, "At least one of phone or email is required");
    }

    // Internal-first reuse: if we have a normalized phone, check for an existing lead
    // before touching GHL. This avoids creating a duplicate GHL contact for a re-entrant
    // form fill by the same person.
    // contactId is guaranteed to be set by one of: reuse path, isSystem path, or findOrCreateGhlContact.
    let contactId!: string;
    let reusingExistingLead = false;
    if (!isSystem && normalizedPhone) {
      const existingLead = await resolveLeadByPhone(supabase, client.id as string, normalizedPhone);
      if (existingLead?.lead_id) {
        contactId = existingLead.lead_id;
        reusingExistingLead = true;
        console.log(`intake-lead: reusing existing lead ${existingLead.id} (lead_id=${contactId}) for phone ${normalizedPhone}`);
      }
    }

    // Resolve / create GHL contact (skipped for is_system: no creds -> synthetic id,
    // and skipped when we already resolved an internal lead above).
    if (!reusingExistingLead) {
      if (isSystem) {
        const synthetic = `probe-${phone || email || clientId}`.replace(/[^a-zA-Z0-9_-]/g, "");
        contactId = synthetic.slice(0, 64) || `probe-${clientId}`;
      } else {
        ({ contactId } = await findOrCreateGhlContact({
          ghlApiKey: client.ghl_api_key as string,
          ghlLocationId: client.ghl_location_id as string,
          firstName,
          lastName,
          phone,
          email,
          source: body.source || "intake-lead",
          tags: Array.isArray(body.tags) ? body.tags : [],
        }));
      }
    }

    // Upsert into platform leads
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;

    // Form-to-agent routing: a posted tag matching an active new-leads workflow
    // routes the lead there; otherwise fall back to the default cadence.
    const candidateTags = (Array.isArray(body.tags) ? body.tags : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
    const newLeadsWorkflows = await fetchActiveNewLeadsWorkflows(supabase, client.id as string, candidateTags);
    const routed = resolveWorkflow({
      workflows: newLeadsWorkflows,
      candidateTags,
      fallbackWorkflowId: (client.auto_engagement_workflow_id as string | null) ?? null,
    });

    const leadRow: Record<string, unknown> = {
      client_id: client.id,
      lead_id: contactId,
      first_name: firstName,
      last_name: lastName,
      phone,
      normalized_phone: normalizedPhone,
      email,
      form_source: routed.matchedTag,
    };
    // BOOK-TZ-1: capture the lead timezone ONLY when the form provided a valid IANA zone.
    // Omitted-when-absent so this upsert never nulls a value a GHL sync already captured.
    const bodyTz = (body.timezone ?? body.time_zone ?? null) as string | null;
    if (isValidTimeZone(bodyTz)) leadRow.timezone = bodyTz;
    await supabase
      .from("leads")
      .upsert(leadRow, { onConflict: "client_id,lead_id" });

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
    if (routed.workflowId) {
      try {
        executionId = await enrollLeadInEngagement({
          supabase,
          clientId: client.id,
          workflowId: routed.workflowId,
          // is_system has no GHL location; keep ghl_account_id non-null (use the
          // client id) so the engagement_executions row still writes.
          ghlAccountId: (client.ghl_location_id as string) || (client.id as string),
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
