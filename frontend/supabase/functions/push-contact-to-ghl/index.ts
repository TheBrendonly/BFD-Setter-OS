// push-contact-to-ghl — push a 1prompt-OS contact edit back to GoHighLevel.
//
// 1prompt-OS keeps `bfd-platform.leads` as a working store, but GHL is
// canonical for contact identity. When a user edits a contact in the
// 1prompt-OS UI we mirror the change back to GHL via Contacts API
// (PUT /contacts/{id}). sync-ghl-contact handles the reverse direction.
//
// Echo-loop prevention: every push tags the GHL contact with
// `customField.last_synced_from = <client-specific value>` (default
// "1prompt-os" for BFD; per-client via clients.ghl_last_synced_from_field_value)
// and bumps `leads.updated_at`. sync-ghl-contact reads the same column and
// uses the timestamp to debounce incoming GHL updates that originated from
// us. (Tag-based skip is also possible if BFD wires the custom field — the
// field id is on clients.ghl_last_synced_from_field_id; if absent on a
// location, the tag is silently dropped by GHL.)
//
// Auth: same JWT-vs-clientId ownership check pattern as retell-proxy
// (see check-client-subscription:60-123 for the canonical version).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// D-M5 — per-client custom field id, read from clients.ghl_last_synced_from_field_id.
// Phase 11a migration backfilled BFD's existing field id on the BFD row, so
// behaviour is unchanged for BFD; new clients have their field id minted at
// onboarding time per the Docs/CLIENT_ONBOARDING_SOP.md §4.2 click-path.
//
// The legacy hardcoded constant `PQNTqtTnIw9Uu0XLLE5M` is gone — kept only as
// a fallback if the column is somehow null on a row that already worked
// against this id.
const BFD_LEGACY_FALLBACK_FIELD_ID = "PQNTqtTnIw9Uu0XLLE5M";

class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function assertClientAccess(authHeader: string | null, clientId: string): Promise<{ agencyId: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) throw new AuthError(401, "Unauthorized");
  const supabase = getSupabaseAdmin();
  // Verify the JWT signature via GoTrue (was: unverified atob → forged tokens passed).
  const token = authHeader.slice("Bearer ".length).trim();
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  const userId = authData?.user?.id;
  if (authErr || !userId) throw new AuthError(401, "Unauthorized");

  const [{ data: client }, { data: roleData }, { data: profile }] = await Promise.all([
    supabase.from("clients").select("id, agency_id").eq("id", clientId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle(),
    supabase.from("profiles").select("agency_id, client_id").eq("id", userId).maybeSingle(),
  ]);
  if (!client) throw new AuthError(404, "Client not found");

  const role = roleData?.role;
  const allowed = role === "agency"
    ? !!profile?.agency_id && profile.agency_id === client.agency_id
    : role === "client"
      ? profile?.client_id === client.id
      : false;
  if (!allowed) throw new AuthError(403, "Forbidden");
  return { agencyId: client.agency_id };
}

interface ContactPushPayload {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  business_name?: string | null;
  custom_fields?: Array<{ id?: string; key?: string; field_value: unknown }>;
  tags?: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId, contactId, contact } = await req.json() as {
      clientId?: string;
      contactId?: string;
      contact?: ContactPushPayload;
    };
    if (!clientId) throw new AuthError(400, "clientId is required");
    if (!contactId) throw new AuthError(400, "contactId is required");
    if (!contact) throw new AuthError(400, "contact is required");

    await assertClientAccess(req.headers.get("Authorization"), clientId);

    const supabase = getSupabaseAdmin();
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("ghl_api_key, ghl_location_id, ghl_last_synced_from_field_id, ghl_last_synced_from_field_value")
      .eq("id", clientId)
      .single();
    if (clientErr || !clientRow?.ghl_api_key) {
      return new Response(
        JSON.stringify({ ok: false, reason: "no_ghl_api_key" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const lastSyncedFromFieldId =
      (clientRow.ghl_last_synced_from_field_id as string | null)
      ?? BFD_LEGACY_FALLBACK_FIELD_ID;
    const lastSyncedFromValue =
      (clientRow.ghl_last_synced_from_field_value as string | null) ?? "1prompt-os";

    // Build GHL Contacts API PUT body
    const body: Record<string, unknown> = {};
    if (contact.first_name !== undefined) body.firstName = contact.first_name;
    if (contact.last_name !== undefined) body.lastName = contact.last_name;
    if (contact.email !== undefined) body.email = contact.email;
    if (contact.phone !== undefined) body.phone = contact.phone;
    if (contact.business_name !== undefined) body.companyName = contact.business_name;
    if (Array.isArray(contact.tags)) body.tags = contact.tags;

    const customFields = Array.isArray(contact.custom_fields) ? [...contact.custom_fields] : [];
    if (lastSyncedFromFieldId) {
      customFields.push({ id: lastSyncedFromFieldId, field_value: lastSyncedFromValue });
    }
    if (customFields.length > 0) body.customFields = customFields;

    const ghlResp = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${clientRow.ghl_api_key}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const respText = await ghlResp.text();
    let respJson: unknown = null;
    try { respJson = JSON.parse(respText); } catch { respJson = { raw: respText }; }

    if (!ghlResp.ok) {
      console.warn(`GHL contact PUT failed ${ghlResp.status}:`, respText.slice(0, 300));
      return new Response(
        JSON.stringify({ ok: false, status: ghlResp.status, body: respJson }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Bump leads.updated_at so sync-ghl-contact can debounce the resulting
    // GHL contact-update webhook (skip if it fires within ~30s of our push).
    await supabase
      .from("leads")
      .update({ updated_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("lead_id", contactId);

    return new Response(
      JSON.stringify({ ok: true, contactId, ghl: respJson }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("push-contact-to-ghl error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
