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

type GhlCustomField = { id?: string; key?: string; value?: unknown };

type GhlContactDetails = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  customFields: GhlCustomField[];
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
      customFields: Array.isArray(c.customFields) ? c.customFields : [],
    };
  } catch (e) {
    console.warn(`fetchGhlContact threw: ${(e as Error).message}`);
    return null;
  }
}

// Resolve a custom field by its human-readable `key` (GHL UI name).
// GHL ships customFields as either array of {key, value} or as a flat
// object keyed by id. We handle both.
function readCustomField(
  fields: GhlCustomField[] | Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!fields) return null;
  if (Array.isArray(fields)) {
    const hit = fields.find((f) => typeof f?.key === "string" && f.key.toLowerCase() === key.toLowerCase());
    const v = hit?.value;
    if (v == null) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }
  if (typeof fields === "object") {
    const v = (fields as Record<string, unknown>)[key];
    if (v == null) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  }
  return null;
}

const TRY_GARY_TAG_PREFIX = "1prompt-try-gary-";

// The new_leads_tag that marks the Try-Gary cadence. Set this as the form tag on
// the Try-Gary campaign in the Workflows UI so the Try-Gary landing routes to it
// deterministically (a client may now have several new-leads workflows).
const TRY_GARY_WORKFLOW_TAG = "bfd_setter-try_gary";

// Phase 1 try-gary landing page lives on BFD's marketing site → posts to BFD's
// GHL location → custom-body webhook to this fn with source="try-gary-landing".
// Hardcoded for Phase 1 because try-gary is BFD-only; promote to a
// clients.try_gary_owner flag if a second client ever runs the same landing.
const TRY_GARY_BFD_LOCATION_ID = "xo0XjmenBBJxJgSnAdyM";

const TRY_GARY_VALID_STYLES = new Set([
  "property-coach",
  "mortgage-broker",
  "finance-strategist",
  "generic-demo",
  "crazy-gary",
]);

type ComplianceFields = {
  agent_style: string | null;
  consent_text: string | null;
  consent_version: string | null;
  consent_timestamp: string | null;
  source_ip: string | null;
  user_agent: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  source_type: string | null;
};

function extractComplianceFields(
  body: any,
  contact: GhlContactDetails | null,
  matchedTag: string | null,
): ComplianceFields {
  // GHL custom fields can arrive on the webhook body OR via the contact fetch.
  // Prefer body.customFields (most direct), then body.contact.customFields,
  // then the fetched contact.
  const bodyFields = body?.customFields ?? body?.contact?.customFields ?? null;
  const contactFields = contact?.customFields ?? null;

  const pick = (key: string): string | null =>
    readCustomField(bodyFields, key) ?? readCustomField(contactFields, key);

  // Derive agent_style from the matched tag suffix if not explicitly set.
  let agent_style = pick("agent_style");
  if (!agent_style && matchedTag && matchedTag.startsWith(TRY_GARY_TAG_PREFIX)) {
    agent_style = matchedTag.slice(TRY_GARY_TAG_PREFIX.length) || null;
  }

  // source_type defaults to try_gary_landing only when we recognise the tag.
  let source_type = pick("source_type");
  if (!source_type && matchedTag && matchedTag.startsWith(TRY_GARY_TAG_PREFIX)) {
    source_type = "try_gary_landing";
  }

  return {
    agent_style,
    consent_text: pick("last_consent_text") ?? pick("consent_text"),
    consent_version: pick("consent_version"),
    consent_timestamp: pick("last_consent_timestamp") ?? pick("consent_timestamp"),
    source_ip: pick("source_ip"),
    user_agent: pick("user_agent"),
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
    utm_content: pick("utm_content"),
    utm_term: pick("utm_term"),
    source_type,
  };
}

// 5-minute phone-dedup window. Skip enrolment if the same client_id + phone
// has produced a leads row in the last N minutes. Only fires when we have a
// phone to compare against; lead-id-based idempotency still runs separately.
const PHONE_DEDUP_WINDOW_MINUTES = 5;

async function isPhoneRecentDuplicate(
  supabase: any,
  clientId: string,
  phone: string | null,
  currentLeadId: string,
): Promise<boolean> {
  if (!phone) return false;
  const cutoff = new Date(Date.now() - PHONE_DEDUP_WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("leads")
    .select("lead_id, created_at")
    .eq("client_id", clientId)
    .eq("phone", phone)
    .neq("lead_id", currentLeadId)
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("ghl-tag-webhook: phone dedup query failed", error);
    return false;
  }
  return Boolean(data);
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
  // Optional extras: passed through to runEngagement as contact_fields, which
  // make-retell-outbound-call reads into dynamicVars. Used by the try-gary
  // landing branch to ship agent_style + utm_* through to Retell.
  extraContactFields?: Record<string, string | null | undefined>;
}): Promise<string | null> {
  const { supabase, clientId, workflowId, ghlAccountId, leadId, contactName, contactPhone, contactEmail, extraContactFields } = args;

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

  // Clean extraContactFields (drop empty/null values) before merging.
  const cleanedExtras: Record<string, string> = {};
  if (extraContactFields) {
    for (const [k, v] of Object.entries(extraContactFields)) {
      if (typeof v === "string" && v.length > 0) cleanedExtras[k] = v;
    }
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
          contact_fields: Object.keys(cleanedExtras).length > 0 ? cleanedExtras : undefined,
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

// Try Gary landing-page ingress (Phase 1). The GHL workflow on BFD's location
// fires a custom-body webhook with the flat JSON shape:
//   { source: "try-gary-landing", first_name, phone, agent_style,
//     utm_source/medium/campaign, consent_text_version, consent_timestamp,
//     ghl_contact_id }
// We look up BFD by hardcoded location id, validate the agent_style enum,
// upsert leads with compliance + UTM fields, then enrol into the BFD
// new-leads cadence with agent_style passed through as a Retell
// dynamic_variable. The 4-persona prompt differentiation is downstream of
// this — first-pass uses BFD's existing Gary agent; per-style prompt edits
// happen via Brendan's normal PromptManagement / Save Setter flow.
async function handleTryGaryLanding(
  supabase: any,
  body: any,
): Promise<Response> {
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
  const ghlContactId = typeof body.ghl_contact_id === "string" ? body.ghl_contact_id.trim() : "";
  const rawStyle = typeof body.agent_style === "string" ? body.agent_style.trim() : "";
  const agentStyle = TRY_GARY_VALID_STYLES.has(rawStyle) ? rawStyle : "generic-demo";

  if (!phone) return jsonResponse({ error: "phone is required" }, 400);
  if (!ghlContactId) return jsonResponse({ error: "ghl_contact_id is required" }, 400);

  // Look up BFD by hardcoded location id. Pulling try_gary_persona_slots
  // for the agent_style → Voice Setter slot routing (Batch 4).
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, ghl_location_id, ghl_api_key, try_gary_persona_slots")
    .eq("ghl_location_id", TRY_GARY_BFD_LOCATION_ID)
    .maybeSingle();
  if (clientErr || !client) {
    console.warn("ghl-tag-webhook[try-gary]: BFD client not found", clientErr);
    return jsonResponse({ error: "BFD client not found" }, 404);
  }
  const clientId = client.id as string;
  const locationId = client.ghl_location_id as string;

  // Resolve persona slot override. NULL or missing key → null (runEngagement
  // falls back to the channel's hardcoded voice_setter_id). Phase 1 seed
  // has all 4 styles pointing at slot 2 (BFD's existing Gary); Brendan
  // updates the map as he provisions slots 4-7.
  const personaSlots = (client as any).try_gary_persona_slots as Record<string, unknown> | null;
  const rawSlot = personaSlots?.[agentStyle];
  const voiceSetterOverride =
    typeof rawSlot === "number" && rawSlot >= 1 && rawSlot <= 10
      ? `Voice-Setter-${rawSlot}`
      : null;

  // Phone-dedup guard (reuse the existing 5-min helper).
  const phoneDuplicate = await isPhoneRecentDuplicate(
    supabase,
    clientId,
    phone,
    ghlContactId,
  );

  // Upsert leads row with compliance + UTM + agent_style.
  // The compliance migration column is `consent_version`; the brief's payload
  // calls it `consent_text_version`. Map at the edge so the rest of the
  // pipeline sees the canonical column name.
  const consentText = typeof body.consent_text === "string" ? body.consent_text : null;
  const consentVersion = typeof body.consent_text_version === "string"
    ? body.consent_text_version
    : (typeof body.consent_version === "string" ? body.consent_version : null);
  const consentTimestamp = typeof body.consent_timestamp === "string" ? body.consent_timestamp : null;

  await supabase
    .from("leads")
    .upsert(
      {
        client_id: clientId,
        lead_id: ghlContactId,
        first_name: firstName || null,
        phone: phone || null,
        agent_style: agentStyle,
        source_type: "try_gary_landing",
        consent_text: consentText,
        consent_version: consentVersion,
        consent_timestamp: consentTimestamp,
        utm_source: typeof body.utm_source === "string" ? body.utm_source : null,
        utm_medium: typeof body.utm_medium === "string" ? body.utm_medium : null,
        utm_campaign: typeof body.utm_campaign === "string" ? body.utm_campaign : null,
        utm_content: typeof body.utm_content === "string" ? body.utm_content : null,
        utm_term: typeof body.utm_term === "string" ? body.utm_term : null,
      },
      { onConflict: "client_id,lead_id" },
    );

  if (phoneDuplicate) {
    return jsonResponse({
      ok: true,
      enrolled: null,
      reason: "phone_recent_duplicate",
      dedup_window_minutes: PHONE_DEDUP_WINDOW_MINUTES,
      source: "try-gary-landing",
      agent_style: agentStyle,
    });
  }

  // Resolve the Try-Gary cadence. Prefer a new-leads workflow explicitly tagged
  // TRY_GARY_WORKFLOW_TAG (deterministic now that a client may have several
  // new-leads workflows); fall back to the single active new-leads workflow for
  // backward compat when no Try-Gary cadence is tagged.
  let { data: workflow, error: wfErr } = await supabase
    .from("engagement_workflows")
    .select("id, name")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .eq("is_new_leads_campaign", true)
    .eq("new_leads_tag", TRY_GARY_WORKFLOW_TAG)
    .limit(1)
    .maybeSingle();
  if (!workflow) {
    ({ data: workflow, error: wfErr } = await supabase
      .from("engagement_workflows")
      .select("id, name")
      .eq("client_id", clientId)
      .eq("is_active", true)
      .eq("is_new_leads_campaign", true)
      .limit(1)
      .maybeSingle());
  }
  if (wfErr || !workflow) {
    console.warn("ghl-tag-webhook[try-gary]: no active new-leads workflow", wfErr);
    return jsonResponse({ error: "no_active_new_leads_workflow" }, 404);
  }

  // Enrol — agent_style + utm_* ride in extraContactFields so they land as
  // Retell dynamic_variables on the outbound call.
  let executionId: string | null = null;
  try {
    executionId = await enrollLeadInEngagement({
      supabase,
      clientId,
      workflowId: workflow.id,
      ghlAccountId: locationId,
      leadId: ghlContactId,
      contactName: firstName || null,
      contactPhone: phone,
      contactEmail: null,
      extraContactFields: {
        agent_style: agentStyle,
        first_name: firstName || undefined,
        phone,
        source_type: "try_gary_landing",
        utm_source: typeof body.utm_source === "string" ? body.utm_source : undefined,
        utm_medium: typeof body.utm_medium === "string" ? body.utm_medium : undefined,
        utm_campaign: typeof body.utm_campaign === "string" ? body.utm_campaign : undefined,
        // Batch 4 — Voice Setter slot override. runEngagement applies this
        // at the phone_call channel so try-gary leads route to per-style
        // agents (slots 4-7 once Brendan provisions). Null/absent → uses
        // channel-default Voice-Setter-2.
        voice_setter_id_override: voiceSetterOverride ?? undefined,
      },
    });
  } catch (enrollErr) {
    console.warn("ghl-tag-webhook[try-gary]: enrol failed", enrollErr);
    return jsonResponse({ error: "enrolment_failed" }, 500);
  }

  return jsonResponse({
    ok: true,
    enrolled: executionId,
    reason: executionId ? "enrolled" : "already_enrolled",
    workflow_id: workflow.id,
    source: "try-gary-landing",
    agent_style: agentStyle,
  });
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

  // Try Gary landing-page ingress (Phase 1). Custom flat-JSON body shape
  // distinct from GHL Webhook V2's tag-update shape — discriminate on
  // body.source and route to a dedicated handler.
  if (body.source === "try-gary-landing") {
    return await handleTryGaryLanding(supabase, body);
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

  const matchedTag = candidateTags.find((t) => t === workflow.new_leads_tag) ?? null;
  const compliance = extractComplianceFields(body, contact, matchedTag);

  // Phone-dedup guard: if the same client has seen this phone number in the
  // last PHONE_DEDUP_WINDOW_MINUTES via a *different* GHL contact id, treat
  // this submission as a duplicate and skip enrolment. The lead row still
  // gets upserted so we can audit the attempt.
  const dedupPhone = contact?.phone ?? null;
  const phoneDuplicate = await isPhoneRecentDuplicate(
    supabase,
    client.id as string,
    dedupPhone,
    contactId,
  );

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
        form_source: matchedTag,
        ...compliance,
      },
      { onConflict: "client_id,lead_id" },
    );

  if (phoneDuplicate) {
    return jsonResponse({
      ok: true,
      enrolled: null,
      reason: "phone_recent_duplicate",
      workflow_id: workflow.id,
      matched_tag: matchedTag,
      dedup_window_minutes: PHONE_DEDUP_WINDOW_MINUTES,
    });
  }

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
    matched_tag: matchedTag,
  });
});
