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
    const { clientId, contactData, externalId, deleteExternalIds } = await req.json();

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
        JSON.stringify({ pushed: false, reason: "No external Supabase configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const external = createClient(extUrl, extKey);
    const tableName = client.supabase_table_name?.trim() || "leads";

    // Handle bulk delete — use batched .in() queries instead of one-by-one
    if (deleteExternalIds && Array.isArray(deleteExternalIds) && deleteExternalIds.length > 0) {
      let deleted = 0;
      const BATCH_SIZE = 100;
      for (let i = 0; i < deleteExternalIds.length; i += BATCH_SIZE) {
        const batch = deleteExternalIds.slice(i, i + BATCH_SIZE);
        const { error: delErr, count } = await external
          .from(tableName)
          .delete()
          .in("lead_id", batch);
        if (!delErr) {
          deleted += count || batch.length;
        } else {
          console.error(`Batch delete failed at offset ${i}:`, delErr.message);
          // Fallback: try one-by-one for this batch
          for (const extId of batch) {
            const { error: singleErr } = await external.from(tableName).delete().eq("lead_id", extId);
            if (!singleErr) deleted++;
          }
        }
      }
      return new Response(
        JSON.stringify({ deleted, total: deleteExternalIds.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const externalRecord: Record<string, any> = {};

    if (externalId) {
      externalRecord.lead_id = externalId;
    }

    if (contactData) {
      if (contactData.first_name !== undefined) externalRecord.first_name = contactData.first_name;
      if (contactData.last_name !== undefined) externalRecord.last_name = contactData.last_name;
      if (contactData.phone !== undefined) externalRecord.phone = contactData.phone;
      if (contactData.email !== undefined) externalRecord.email = contactData.email;
      if (contactData.business_name !== undefined) externalRecord.business_name = contactData.business_name;

      // Tags — jsonb array of objects [{name, color}]
      if (contactData.tags !== undefined) {
        externalRecord.tags = contactData.tags;
      }

      // Custom fields — store as jsonb object in the custom_fields column
      if (contactData.custom_fields !== undefined) {
        externalRecord.custom_fields = contactData.custom_fields;
      }
    }

    externalRecord.updated_at = new Date().toISOString();

    let pushed = false;
    let resultId: string | number = "auto-generated";
    const strippedFields: string[] = [];

    if (externalRecord.lead_id) {
      const { data: existing } = await external
        .from(tableName)
        .select("id")
        .eq("lead_id", externalRecord.lead_id)
        .maybeSingle();

      if (existing) {
        const updatePayload = { ...externalRecord };
        delete updatePayload.lead_id;
        const result = await persistWithFallback(external, tableName, updatePayload, "update", existing.id);
        if (result.error) {
          return new Response(
            JSON.stringify({ error: `Failed to push to external Supabase: ${result.error}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        pushed = true;
        resultId = existing.id;
        strippedFields.push(...result.strippedFields);
      } else {
        const result = await persistWithFallback(external, tableName, externalRecord, "insert");
        if (result.error) {
          return new Response(
            JSON.stringify({ error: `Failed to push to external Supabase: ${result.error}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        pushed = true;
        strippedFields.push(...result.strippedFields);
      }
    } else {
      const result = await persistWithFallback(external, tableName, externalRecord, "insert");
      if (result.error) {
        return new Response(
          JSON.stringify({ error: `Failed to push to external Supabase: ${result.error}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      pushed = true;
      strippedFields.push(...result.strippedFields);
    }

    return new Response(
      JSON.stringify({ pushed, id: resultId, strippedFields }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Push contact error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function persistWithFallback(
  client: any,
  tableName: string,
  record: Record<string, any>,
  mode: "insert" | "update",
  existingId?: number | string
): Promise<{ error: string | null; strippedFields: string[] }> {
  const current = { ...record };
  const strippedFields: string[] = [];
  const maxRetries = 10;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let result;
    if (mode === "update" && existingId !== undefined) {
      result = await client.from(tableName).update(current).eq("id", existingId);
    } else {
      result = await client.from(tableName).insert(current);
    }

    if (!result.error) {
      return { error: null, strippedFields };
    }

    const msg = result.error.message || "";
    const colMatch = msg.match(/Could not find the '([^']+)' column/);
    if (colMatch) {
      const badCol = colMatch[1];
      console.log(`Stripping unsupported column '${badCol}' from external push`);
      delete current[badCol];
      strippedFields.push(badCol);
      continue;
    }

    return { error: msg, strippedFields };
  }

  return { error: "Too many missing columns, giving up", strippedFields };
}
