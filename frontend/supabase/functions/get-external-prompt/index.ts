// PROMPT-AUTH-1 — read-only fetch of the LIVE stored prompt from the client's
// external Supabase, for the text X-Ray "live stored prompt" view.
//
// Why this exists: the editor compiles forward and never round-trips the stored
// text_prompts.system_prompt, so the stored blob can silently diverge from the
// section state (that divergence hid a stale "Tue/Wed/Thu ONLY" booking rule that
// caused wrong live bookings). This fn lets the UI show the exact bytes the text
// engine will read at runtime (processSetterReply reads the same row verbatim).
//
// Mirrors save-external-prompt's table resolution: text -> text_prompts with a
// legacy `prompts` fallback; voice -> voice_prompts (card_name normalized).

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, card_name, channel } = await req.json();

    if (!client_id || !card_name) {
      return json({ error: "client_id and card_name are required" }, 400);
    }

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const platform = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: client, error: clientError } = await platform
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return json({ error: "Client not found" }, 404);
    }
    if (!client.supabase_url || !client.supabase_service_key) {
      return json({ error: "Client Supabase credentials not configured" }, 400);
    }

    const external = createClient(client.supabase_url, client.supabase_service_key);

    const isVoice = channel === "voice" || String(card_name).startsWith("Voice-");
    const normalizedCardName = String(card_name).replace(/^Voice-/, "");
    const primaryTable = isVoice ? "voice_prompts" : "text_prompts";
    const fallbackTable = isVoice ? null : "prompts";

    const isTableMissing = (msg: string) =>
      msg.includes("schema cache") || msg.includes("does not exist") || msg.includes("42P01");

    const readRow = async (table: string) =>
      await external
        .from(table)
        .select("system_prompt, updated_at")
        .eq("card_name", normalizedCardName)
        .maybeSingle();

    let table = primaryTable;
    let { data: row, error: readError } = await readRow(primaryTable);
    if (readError && fallbackTable && isTableMissing(readError.message || "")) {
      table = fallbackTable;
      ({ data: row, error: readError } = await readRow(fallbackTable));
    }
    if (readError) {
      return json({ error: `Failed to read external ${table}: ${readError.message}` }, 500);
    }
    if (!row) {
      return json({ success: true, found: false, table, card_name: normalizedCardName });
    }

    return json({
      success: true,
      found: true,
      table,
      card_name: normalizedCardName,
      system_prompt: row.system_prompt ?? "",
      updated_at: row.updated_at ?? null,
    });
  } catch (error) {
    console.error("get-external-prompt error:", error);
    return json({ error: (error as Error)?.message ?? "Unexpected error" }, 500);
  }
});
