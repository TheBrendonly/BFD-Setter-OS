import { createClient } from "npm:@supabase/supabase-js@2";
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the caller's JWT AND that they own client_id. Previously the token was
    // atob-decoded without verification and ownership was never checked → a forged
    // token + any client_id could read that client's external Supabase service key.
    try {
      await assertClientAccess(authHeader, client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    // Get client's external Supabase credentials
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!client.supabase_url || !client.supabase_service_key) {
      return new Response(
        JSON.stringify({ error: "Client has no external Supabase configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);

    // Fetch all chat_history rows — we'll filter business messages in code
    // since the message column is text (stringified JSON)
    const { data: rows, error: fetchError } = await externalSupabase
      .from("chat_history")
      .select("id, message")
      .order("timestamp", { ascending: true });

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch chat_history", detail: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let fixed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows || []) {
      try {
        if (!row.message) continue;

        // Parse the message — it could be single or double encoded
        let parsed: any;
        try {
          parsed = typeof row.message === "string" ? JSON.parse(row.message) : row.message;
        } catch {
          continue; // Not valid JSON, skip
        }

        // If it's still a string after first parse (double-encoded), parse again
        if (typeof parsed === "string") {
          try {
            parsed = JSON.parse(parsed);
          } catch {
            continue;
          }
        }

        // Only fix business type messages
        if (parsed?.type !== "business" && parsed?.type !== "Business") continue;

        // Check if already in correct format
        if (
          parsed.type === "business" &&
          typeof parsed.content === "string" &&
          parsed.additional_kwargs !== undefined &&
          parsed.response_metadata !== undefined
        ) {
          // Already correct format — but check if it's properly stringified in the column
          const correctPayload = JSON.stringify({
            type: "business",
            content: parsed.content,
            additional_kwargs: parsed.additional_kwargs || {},
            response_metadata: parsed.response_metadata || {},
          });

          if (row.message === correctPayload) {
            skipped++;
            continue;
          }
        }

        // Extract the content from whatever format it's in
        const content = parsed.content || parsed.message || parsed.text || "";

        // Build the correct format
        const correctedPayload = JSON.stringify({
          type: "business",
          content: typeof content === "string" ? content : String(content),
          additional_kwargs: {},
          response_metadata: {},
        });

        const { error: updateError } = await externalSupabase
          .from("chat_history")
          .update({ message: correctedPayload })
          .eq("id", row.id);

        if (updateError) {
          errors.push(`Row ${row.id}: ${updateError.message}`);
        } else {
          fixed++;
        }
      } catch (e) {
        errors.push(`Row ${row.id}: ${e.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_rows_scanned: (rows || []).length,
        business_messages_fixed: fixed,
        already_correct: skipped,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in fix-business-messages:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
