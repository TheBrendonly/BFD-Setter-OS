import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId } = await req.json();
    if (!clientId) {
      return new Response(JSON.stringify({ error: "clientId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    const internalUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const internal = createClient(internalUrl, serviceKey);

    const { data: client, error: clientError } = await internal
      .from("clients")
      .select("supabase_url, supabase_service_key, supabase_table_name")
      .eq("id", clientId)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extUrl = client.supabase_url;
    const extKey = client.supabase_service_key;

    if (!extUrl || !extKey) {
      return new Response(
        JSON.stringify({ error: "External Supabase credentials not configured." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const external = createClient(extUrl, extKey);
    const tableName = client.supabase_table_name?.trim() || "leads";

    const { data: extContacts, error: extError } = await external
      .from(tableName)
      .select("*")
      .limit(5000);

    if (extError) {
      console.error("External fetch error:", extError);
      return new Response(
        JSON.stringify({ error: `Failed to fetch from external Supabase (table: ${tableName}): ${extError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!extContacts || extContacts.length === 0) {
      return new Response(
        JSON.stringify({ synced: 0, updated: 0, deleted: 0, total: 0, message: "No leads found in external Supabase." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let synced = 0;
    let updated = 0;

    for (let i = 0; i < extContacts.length; i += 100) {
      const batch = extContacts.slice(i, i + 100);

      for (const ext of batch) {
        const externalId = String(ext.lead_id || ext.contact_id || ext.session_id || ext.id || "");
        if (!externalId) continue;

        const firstName = ext.first_name || "";
        const lastName = ext.last_name || "";
        const phone = ext.phone || "";
        const email = ext.email || "";
        const businessName = ext.business_name || "";

        let derivedFirst = firstName;
        let derivedLast = lastName;
        if (!derivedFirst && !derivedLast) {
          const fullName = ext.contact_name || ext.name || ext.Name || ext.full_name || ext.fullName || "";
          if (fullName) {
            const parts = fullName.trim().split(/\s+/);
            derivedFirst = parts[0] || "";
            derivedLast = parts.length > 1 ? parts.slice(1).join(" ") : "";
          }
        }

        const standardKeys = new Set([
          "id", "lead_id", "contact_id", "session_id",
          "first_name", "last_name", "contact_name", "name", "Name", "full_name", "fullName",
          "phone", "Phone", "phone_number", "Phone Number",
          "email", "Email", "email_address", "Email Address",
          "business_name", "Business Name", "Company", "company", "Company Name", "company_name", "Organization",
          "created_at", "updated_at", "modified_at", "tags", "custom_fields",
        ]);

        const customFields: Record<string, any> = {};
        for (const [key, value] of Object.entries(ext)) {
          if (standardKeys.has(key)) continue;
          if (value === null || value === undefined) continue;
          if (Array.isArray(value)) {
            customFields[key] = value.join(", ");
          } else if (typeof value === "object") {
            customFields[key] = JSON.stringify(value);
          } else {
            const strVal = String(value);
            if (strVal !== "null") {
              customFields[key] = strVal;
            }
          }
        }

        let tags: any[] = [];
        if (ext.tags) {
          if (Array.isArray(ext.tags)) {
            tags = ext.tags;
          } else if (typeof ext.tags === "string") {
            tags = ext.tags.split(",").map((t: string) => ({
              name: t.trim(),
              color: "#646E82",
            })).filter((t: any) => t.name);
          }
        }

        if (ext.custom_fields && typeof ext.custom_fields === "object" && !Array.isArray(ext.custom_fields)) {
          for (const [key, value] of Object.entries(ext.custom_fields)) {
            if (value !== null && value !== undefined) {
              customFields[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
            }
          }
        }

        const { data: existing } = await internal
          .from("leads")
          .select("id")
          .eq("client_id", clientId)
          .eq("lead_id", externalId)
          .maybeSingle();

        const upsertPayload = {
          first_name: derivedFirst || null,
          last_name: derivedLast || null,
          phone: phone || null,
          email: email || null,
          business_name: businessName || null,
          custom_fields: Object.keys(customFields).length > 0 ? customFields : {},
          tags: tags.length > 0 ? tags : [],
          updated_at: new Date().toISOString(),
        };

        if (existing) {
          await internal
            .from("leads")
            .update(upsertPayload)
            .eq("id", existing.id);
          updated++;
        } else {
          await internal
            .from("leads")
            .insert({
              client_id: clientId,
              lead_id: externalId,
              ...upsertPayload,
            });
          synced++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        synced,
        updated,
        deleted: 0,
        total: extContacts.length,
        message: `Synced ${synced} new and updated ${updated} existing leads`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Sync error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});