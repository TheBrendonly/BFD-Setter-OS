// CANONICAL LEAD-INTAKE INGRESS (2026-05-31).
// This is THE single inbound webhook URL for every client. Routing is decided
// entirely by the tag(s) the lead arrives with: a tag matching an active
// new-leads cadence (engagement_workflows.new_leads_tag) routes the lead there;
// no match falls back to the client's default cadence
// (clients.auto_engagement_workflow_id). Tags are read from the query string
// (Tag/tag/Form_Tag/route_tag), the JSON body (tag/tags[]) and contact.tags.
// Per form/agent, the only client setup is one GHL automation that adds a
// routing tag and posts here. See Docs/FORM_ROUTING.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { fetchActiveNewLeadsWorkflows, resolveWorkflow } from "../_shared/resolve-workflow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-signature, x-wh-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Constant-time string compare for the static-token webhook proof.
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Optional GHL Webhook V2 signature verification (HMAC-SHA256 hex over the raw
// body, keyed by clients.ghl_webhook_secret). Mirrors bookings-webhook. Only
// enforced when the resolved client has the secret set; otherwise accept (the
// prior behaviour) so existing unsigned lead ingress keeps working.
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
  const expectedHex = hex.toLowerCase();
  const presented = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
  if (expectedHex.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    mismatch |= expectedHex.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

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
    const rawBody = await req.clone().text();
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

    // Form-to-agent routing: collect candidate tags from the GHL workflow POST
    // (a routing tag) or the contact's own tags. A tag matching an active
    // new-leads workflow routes the lead there; otherwise we fall back to the
    // client's default cadence (auto_engagement_workflow_id).
    // Tags may arrive as an array (intake-lead / contact-tag webhooks) OR as a
    // comma-separated string — GHL's standard outbound Webhook action sends
    // "tags":"a,b" (a STRING, verified 2026-05-31), and a custom webhook may
    // pass ?tags=a,b. Normalise both shapes so routing works regardless.
    const asTagList = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((t): t is string => typeof t === "string")
        : typeof v === "string"
        ? v.split(",")
        : [];
    const candidateTags: string[] = [
      url.searchParams.get("Tag"), url.searchParams.get("tag"),
      url.searchParams.get("Form_Tag"), url.searchParams.get("route_tag"),
      ...asTagList(url.searchParams.get("tags")),
      ...asTagList(body.tag),
      ...asTagList(body.tags),
      ...asTagList(contact.tags),
    ].filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());

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
      .select("id, sync_ghl_enabled, auto_engagement_workflow_id, ghl_last_synced_from_field_id, ghl_last_synced_from_field_value, ghl_webhook_secret")
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

    // Optional GHL webhook auth (verify-if-present). Inert until the client
    // stamps ghl_webhook_secret. Two accepted proofs:
    //   (1) a static `x-wh-token` header equal to the secret — the mechanism for
    //       the GHL Workflow "Custom Webhook" action (add the secret as a custom
    //       header in the workflow). This is BFD's canonical Pattern-B ingress.
    //   (2) an HMAC-SHA256 `x-wh-signature` over the raw body.
    // NOTE: GHL *native* Webhook V2 signs with RSA (not HMAC), which is NOT
    // supported here — provision the secret as a static token (SOP §5.3), not
    // as a native Webhook V2 secret, or real traffic would 403.
    if (clientRow.ghl_webhook_secret) {
      const secret = clientRow.ghl_webhook_secret as string;
      const tokenOk = ctEqual(req.headers.get("x-wh-token") ?? "", secret);
      const sigOk = tokenOk || await verifyGhlSignature(rawBody, req.headers.get("x-wh-signature"), secret);
      if (!sigOk) {
        console.warn("[sync-ghl-contact] GHL webhook auth failed", { clientId: clientRow.id, ghlAccountId });
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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

      // Multi-persona re-enrolment: an EXISTING contact who submits Try-Gary again
      // (a different persona) otherwise gets only an update with no call. If an
      // inbound bfd_setter-try_gary* tag matches an ACTIVE campaign and the contact
      // has no running execution for that workflow, enrol them so they get that
      // persona's call. Scoped to try_gary tags so routine contact.update echoes for
      // the main cadence never re-trigger. Non-fatal.
      const tryGaryTags = candidateTags.filter((t) => t.startsWith("bfd_setter-try_gary"));
      if (tryGaryTags.length > 0) {
        try {
          const wfs = await fetchActiveNewLeadsWorkflows(supabase, clientId, tryGaryTags);
          const reRouted = resolveWorkflow({ workflows: wfs, candidateTags: tryGaryTags, fallbackWorkflowId: null });
          if (reRouted.workflowId) {
            const { data: activeExec } = await supabase
              .from("engagement_executions")
              .select("id")
              .eq("client_id", clientId)
              .eq("ghl_contact_id", contactId)
              .eq("workflow_id", reRouted.workflowId)
              .in("status", ["pending", "running"])
              .limit(1);
            if (!activeExec || activeExec.length === 0) {
              await enrollLeadInEngagement({
                supabase, clientId, workflowId: reRouted.workflowId, ghlAccountId,
                leadId: contactId, contactName: name || null, contactPhone: phone || null, contactEmail: email || null,
              });
              steps.push(makeStep("sync-reenrol", "Re-enrol (Try-Gary persona)", "enroll", "completed",
                `Workflow ${reRouted.workflowId} (${reRouted.matchedTag})`));
            }
          }
        } catch (e) {
          console.warn("[sync-ghl-contact] try-gary re-enrol failed (non-fatal):", e);
        }
      }

      await logExecution(clientId, contactId, name || null, "updated", null, steps);
      return new Response(
        JSON.stringify({ status: "updated", contact_id: existingContact.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Resolve the target workflow from the inbound tags (else default).
      const newLeadsWorkflows = await fetchActiveNewLeadsWorkflows(supabase, clientId, candidateTags);
      const routed = resolveWorkflow({
        workflows: newLeadsWorkflows,
        candidateTags,
        fallbackWorkflowId: (clientRow.auto_engagement_workflow_id as string | null) ?? null,
      });

      const { data: newContact, error: createErr } = await supabase
        .from("leads")
        .insert({
          client_id: clientId,
          lead_id: contactId,
          first_name: firstName || null,
          last_name: lastName || null,
          phone: phone || null,
          email: email || null,
          form_source: routed.matchedTag,
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

      // Enrol into the routed workflow: a tag-matched new-leads workflow when
      // the inbound carries a routing tag, else the client's default cadence
      // (auto_engagement_workflow_id). No tag match and no default => skip.
      if (routed.workflowId) {
        try {
          await enrollLeadInEngagement({
            supabase,
            clientId,
            workflowId: routed.workflowId,
            ghlAccountId,
            leadId: contactId,
            contactName: name || null,
            contactPhone: phone || null,
            contactEmail: email || null,
          });
          steps.push(makeStep("sync-engage", "Enroll in Engagement Cadence", "enroll_engagement", "completed",
            `Workflow ${routed.workflowId} (${routed.source}${routed.matchedTag ? `: ${routed.matchedTag}` : ""})`));
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
