import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type DeleteResult = {
  success: boolean;
  deleted: boolean;
  table: string;
  rowId?: string;
  fallbackUsed?: boolean;
  error?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, card_name, channel } = await req.json();

    if (!client_id || !card_name) {
      return new Response(
        JSON.stringify({ error: "client_id and card_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const internalSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: client, error: clientError } = await internalSupabase
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client?.supabase_url || !client?.supabase_service_key) {
      return new Response(
        JSON.stringify({ error: "Client not found or credentials not configured" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);
    const isVoice = channel === "voice";
    const primaryTable = isVoice ? "voice_prompts" : "text_prompts";
    const fallbackTable = isVoice ? null : "prompts";

    const isMissingTableError = (message: string) =>
      message.includes("schema cache") ||
      message.includes("relation") ||
      message.includes("does not exist");

    const lookupAndDelete = async (table: string, fallbackUsed = false): Promise<DeleteResult> => {
      const { data: row, error: selectError } = await externalSupabase
        .from(table)
        .select("id, card_name")
        .eq("card_name", card_name)
        .maybeSingle();

      if (selectError) {
        console.error(`[delete-external-prompt] Select error on ${table}:`, selectError);
        return {
          success: false,
          deleted: false,
          table,
          fallbackUsed,
          error: selectError.message,
        };
      }

      if (!row) {
        console.warn(`[delete-external-prompt] No row found in ${table} for ${card_name}`);
        return {
          success: true,
          deleted: false,
          table,
          fallbackUsed,
        };
      }

      const { error: deleteError } = await externalSupabase
        .from(table)
        .delete()
        .eq("id", row.id)
        .select("id")
        .maybeSingle();

      if (deleteError) {
        console.error(`[delete-external-prompt] Delete error on ${table}:`, deleteError);
        return {
          success: false,
          deleted: false,
          table,
          rowId: row.id,
          fallbackUsed,
          error: deleteError.message,
        };
      }

      const { data: verifyRow, error: verifyError } = await externalSupabase
        .from(table)
        .select("id")
        .eq("id", row.id)
        .maybeSingle();

      if (verifyError) {
        console.error(`[delete-external-prompt] Verify error on ${table}:`, verifyError);
        return {
          success: false,
          deleted: false,
          table,
          rowId: row.id,
          fallbackUsed,
          error: verifyError.message,
        };
      }

      if (verifyRow) {
        console.error(`[delete-external-prompt] Row ${row.id} still exists in ${table} after delete`);
        return {
          success: false,
          deleted: false,
          table,
          rowId: row.id,
          fallbackUsed,
          error: `Row ${row.id} still exists after delete`,
        };
      }

      console.log(`[delete-external-prompt] Deleted ${card_name} from ${table} (id=${row.id})`);
      return {
        success: true,
        deleted: true,
        table,
        rowId: row.id,
        fallbackUsed,
      };
    };

    let result = await lookupAndDelete(primaryTable);

    if (!result.success && fallbackTable && result.error && isMissingTableError(result.error)) {
      console.warn(`[delete-external-prompt] Falling back from ${primaryTable} to ${fallbackTable}`);
      result = await lookupAndDelete(fallbackTable, true);
    }

    if (!result.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to delete external prompt: ${result.error}`,
          table: result.table,
          row_id: result.rowId,
          deleted: result.deleted,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        deleted: result.deleted,
        card_name,
        table: result.table,
        row_id: result.rowId ?? null,
        fallback_used: result.fallbackUsed ?? false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[delete-external-prompt] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
