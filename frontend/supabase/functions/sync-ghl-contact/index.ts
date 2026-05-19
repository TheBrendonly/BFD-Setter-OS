import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

async function parseRequestBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      const parsed = await req.clone().json();
      return isRecord(parsed) ? parsed : {};
    }
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.clone().formData();
      return Object.fromEntries(
        Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name])
      );
    }
    const raw = await req.clone().text();
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (isRecord(parsed)) return parsed;
    } catch { /* fall through */ }
    const params = new URLSearchParams(raw);
    if (Array.from(params.keys()).length > 0) {
      return Object.fromEntries(params.entries());
    }
  } catch { /* ignore */ }
  return {};
}

interface Step {
  id: string;
  label: string;
  node_type: string;
  status: "completed" | "failed" | "skipped";
  detail?: string;
  timestamp: string;
}

// Auto-enroll a freshly-created lead in an engagement cadence.
// Inserts an engagement_executions row + fires the runEngagement Trigger.dev
// task. Triggered only when clients.auto_engagement_workflow_id is set.
async function enrollLeadInEngagement(args: {
  supabase: any;
  clientId: string;
  workflowId: string;
  ghlAccountId: string;
  leadId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}): Promise<void> {
  const { supabase, clientId, workflowId, ghlAccountId, leadId, contactName, contactPhone, contactEmail } = args;

  // Confirm the workflow exists and belongs to this client (defense in depth).
  const { data: wf } = await supabase
    .from("engagement_workflows")
    .select("id, nodes")
    .eq("id", workflowId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!wf) throw new Error(`engagement_workflow ${workflowId} not found for client ${clientId}`);

  // Create the execution row first so runEngagement has stable state to update.
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
      stage_description: "Auto-enrolled on lead create",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (execErr) throw new Error(`engagement_executions insert failed: ${execErr.message}`);

  // Fire Trigger.dev runEngagement.
  const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY");
  if (!triggerKey) throw new Error("TRIGGER_SECRET_KEY not configured");

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
          campaign_id: "auto-enroll",
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
    },
  );
  if (!triggerResp.ok) {
    const errText = await triggerResp.text();
    throw new Error(`Trigger.dev run-engagement trigger failed ${triggerResp.status}: ${errText.slice(0, 200)}`);
  }
  const triggerJson = await triggerResp.json().catch(() => ({}));
  const trigger_run_id = triggerJson?.id ?? null;
  if (trigger_run_id) {
    await supabase
      .from("engagement_executions")
      .update({ trigger_run_id })
      .eq("id", execution.id);
  }
}

function makeStep(id: string, label: string, nodeType: string, status: Step["status"], detail?: string): Step {
  return { id, label, node_type: nodeType, status, detail, timestamp: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const body = await parseRequestBody(req);
    const contact = isRecord(body.contact) ? body.contact : isRecord(body.Contact) ? body.Contact : {};
    const location = isRecord(body.location) ? body.location : isRecord(body.Location) ? body.Location : {};

    const derivedFirstName = firstNonEmptyString(
      url.searchParams.get("First_Name"), body.First_Name, body.first_name, body.firstName,
      contact.First_Name, contact.first_name, contact.firstName,
    );
    const derivedLastName = firstNonEmptyString(
      url.searchParams.get("Last_Name"), body.Last_Name, body.last_name, body.lastName,
      contact.Last_Name, contact.last_name, contact.lastName,
    );
    const derivedName = [derivedFirstName, derivedLastName].filter(Boolean).join(" ").trim();

    const ghlAccountId = firstNonEmptyString(
      url.searchParams.get("GHL_Account_ID"), url.searchParams.get("ghl_account_id"),
      url.searchParams.get("ghlAccountId"), url.searchParams.get("locationId"),
      body.GHL_Account_ID, body.ghl_account_id, body.ghlAccountId, body.locationId, body.location_id,
      location.id, location.locationId, location.location_id,
    );
    const contactId = firstNonEmptyString(
      url.searchParams.get("Lead_ID"), url.searchParams.get("lead_id"), url.searchParams.get("leadId"),
      url.searchParams.get("Contact_ID"), url.searchParams.get("contact_id"), url.searchParams.get("contactId"),
      body.Lead_ID, body.lead_id, body.leadId,
      body.Contact_ID, body.contact_id, body.contactId,
      contact.id, contact.lead_id, contact.leadId, contact.contact_id, contact.contactId,
    );
    const name = firstNonEmptyString(
      url.searchParams.get("Name"), url.searchParams.get("name"),
      body.Name, body.name, contact.Name, contact.name, derivedName,
    );
    const email = firstNonEmptyString(
      url.searchParams.get("Email"), url.searchParams.get("email"),
      body.Email, body.email, contact.Email, contact.email,
    );
    const phone = firstNonEmptyString(
      url.searchParams.get("Phone"), url.searchParams.get("phone"),
      body.Phone, body.phone, body.phone_number, body.phoneNumber,
      contact.Phone, contact.phone, contact.phone_number, contact.phoneNumber,
    );

    async function logExecution(
      clientId: string | null, externalId: string, contactName: string | null,
      status: string, errorMessage: string | null, steps: Step[],
    ) {
      if (!clientId) return;
      try {
        await supabase.from("sync_ghl_executions").insert({
          client_id: clientId, external_id: externalId, contact_name: contactName,
          status, error_message: errorMessage, steps,
        });
      } catch (e) {
        console.error("[sync-ghl-contact] Failed to log execution:", e);
      }
    }

    if (!ghlAccountId) {
      return new Response(
        JSON.stringify({ error: "GHL_Account_ID is required in the webhook fields or request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!contactId) {
      return new Response(
        JSON.stringify({ error: "Lead_ID is required in the webhook fields or request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const steps: Step[] = [];
    steps.push(makeStep("sync-trigger", "Receive New Lead", "trigger", "completed",
      `GHL Account: ${ghlAccountId}, Lead: ${contactId}`));

    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("id, sync_ghl_enabled, auto_engagement_workflow_id, ghl_last_synced_from_field_id, ghl_last_synced_from_field_value")
      .eq("ghl_location_id", ghlAccountId)
      .single();

    if (clientErr || !clientRow) {
      steps.push(makeStep("sync-find", "Find Lead in 1Prompt", "find", "failed",
        `No client found for GHL_Account_ID: ${ghlAccountId}`));
      return new Response(
        JSON.stringify({ error: "No client found for the provided GHL_Account_ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientId = clientRow.id;

    if (!clientRow.sync_ghl_enabled) {
      steps.push(makeStep("sync-find", "Find Lead in 1Prompt", "find", "completed", `Client: ${clientId}`));
      steps.push(makeStep("sync-disabled", "Sync Disabled", "condition", "failed", "Workflow is disabled for this client"));
      await logExecution(clientId, contactId, name || null, "disabled", "Sync is disabled for this client", steps);
      return new Response(
        JSON.stringify({ status: "disabled", message: "Sync GHL Contacts is disabled for this client" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if contact already exists
    const { data: existingContact } = await supabase
      .from("leads")
      .select("id, updated_at")
      .eq("client_id", clientId)
      .eq("lead_id", contactId)
      .maybeSingle();

    // Echo-loop guard: when push-contact-to-ghl writes a contact upstream it
    // tags customField `last_synced_from = <clients.ghl_last_synced_from_field_value>`
    // (default "1prompt-os" for BFD; per-client for others). GHL then fires
    // contact.update back here; if our leads.updated_at is fresh (< 60s) AND
    // the stamp value matches this client's expected value we KNOW the update
    // originated from us and skip. Without this guard every outbound edit
    // causes a redundant inbound sync round-trip.
    if (existingContact?.updated_at) {
      const candidates: unknown[] = [];
      if (Array.isArray(contact.customFields)) candidates.push(...(contact.customFields as unknown[]));
      if (Array.isArray(contact.customField)) candidates.push(...(contact.customField as unknown[]));
      if (Array.isArray(contact.custom_field)) candidates.push(...(contact.custom_field as unknown[]));
      const perClientFieldId = clientRow.ghl_last_synced_from_field_id as string | null;
      const expectedStampValue = (
        (clientRow.ghl_last_synced_from_field_value as string | null) ?? "1prompt-os"
      ).trim().toLowerCase();
      const isOurStamp = candidates.some((cf) => {
        if (!isRecord(cf)) return false;
        const fieldKey = typeof cf.key === "string" ? cf.key : (typeof cf.fieldKey === "string" ? cf.fieldKey : "");
        const fieldId = typeof cf.id === "string" ? cf.id : "";
        const isLastSynced = fieldKey === "contact.last_synced_from"
          || fieldKey === "last_synced_from"
          || (perClientFieldId !== null && fieldId === perClientFieldId)
          || fieldId === "PQNTqtTnIw9Uu0XLLE5M"; // legacy fallback for BFD-only setups
        if (!isLastSynced) return false;
        const value = cf.value ?? cf.field_value ?? cf.fieldValue;
        return typeof value === "string" && value.trim().toLowerCase() === expectedStampValue;
      });
      if (isOurStamp) {
        const ageMs = Date.now() - new Date(existingContact.updated_at).getTime();
        if (ageMs < 60_000) {
          steps.push(makeStep("sync-echo", "Echo-loop check", "condition", "skipped",
            `Skipping — push-contact-to-ghl stamped this update ${ageMs}ms ago`));
          await logExecution(clientId, contactId, name || null, "skipped_echo", null, steps);
          return new Response(
            JSON.stringify({ status: "skipped_echo", contact_id: existingContact.id, age_ms: ageMs }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    steps.push(makeStep("sync-find", "Find Lead in 1Prompt", "find", "completed",
      existingContact ? `Found: ${existingContact.id}` : "Not found"));
    steps.push(makeStep("sync-condition", "Does Lead Exist?", "condition", "completed",
      existingContact ? "Yes → Update" : "No → Create"));

    // Split name into first/last if individual names not provided
    let firstName = derivedFirstName || "";
    let lastName = derivedLastName || "";
    if (!firstName && !lastName && name) {
      const parts = name.trim().split(/\s+/);
      firstName = parts[0] || "";
      lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (firstName) updatePayload.first_name = firstName;
    if (lastName) updatePayload.last_name = lastName;
    if (email) updatePayload.email = email;
    if (phone) updatePayload.phone = phone;

    if (existingContact) {
      const { error: updateErr } = await supabase
        .from("leads")
        .update(updatePayload)
        .eq("id", existingContact.id);

      if (updateErr) {
        steps.push(makeStep("sync-update", "Update Lead", "update_contact", "failed", updateErr.message));
        steps.push(makeStep("sync-create", "Create New Lead", "create_contact", "skipped"));
        await logExecution(clientId, contactId, name || null, "failed", updateErr.message, steps);
        return new Response(
          JSON.stringify({ error: "Failed to update contact" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      steps.push(makeStep("sync-update", "Update Lead", "update_contact", "completed", `Updated ${existingContact.id}`));
      steps.push(makeStep("sync-create", "Create New Lead", "create_contact", "skipped"));
      await logExecution(clientId, contactId, name || null, "updated", null, steps);
      return new Response(
        JSON.stringify({ status: "updated", contact_id: existingContact.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      const { data: newContact, error: createErr } = await supabase
        .from("leads")
        .insert({
          client_id: clientId,
          lead_id: contactId,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null,
          email: email || null,
        })
        .select("id")
        .single();

      if (createErr) {
        steps.push(makeStep("sync-create", "Create New Lead", "create_contact", "failed", createErr.message));
        await logExecution(clientId, contactId, name || null, "failed", createErr.message, steps);
        return new Response(
          JSON.stringify({ error: "Failed to create contact" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      steps.push(makeStep("sync-create", "Create New Lead", "create_contact", "completed", `Created ${newContact.id}`));

      // Auto-enroll in default engagement cadence when client opts in.
      // Disabled until clients.auto_engagement_workflow_id is non-null —
      // safe to ship; current default is NULL across all clients.
      if (clientRow.auto_engagement_workflow_id) {
        try {
          await enrollLeadInEngagement({
            supabase,
            clientId,
            workflowId: clientRow.auto_engagement_workflow_id,
            ghlAccountId,
            leadId: contactId,
            contactName: name || null,
            contactPhone: phone || null,
            contactEmail: email || null,
          });
          steps.push(makeStep("sync-engage", "Enroll in Engagement Cadence", "enroll_engagement", "completed",
            `Workflow ${clientRow.auto_engagement_workflow_id}`));
        } catch (enrollErr: any) {
          // Non-blocking: lead is created, engagement is opt-in. Log but don't fail.
          console.error("[sync-ghl-contact] auto-enroll failed:", enrollErr);
          steps.push(makeStep("sync-engage", "Enroll in Engagement Cadence", "enroll_engagement", "failed",
            enrollErr?.message || "unknown"));
        }
      }

      await logExecution(clientId, contactId, name || null, "created", null, steps);
      return new Response(
        JSON.stringify({ status: "created", contact_id: newContact.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("Sync GHL contact error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
