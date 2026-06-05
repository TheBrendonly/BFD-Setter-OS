import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  client_id: z.string().uuid(),
  channel: z.enum(["text", "voice"]),
});

const isMissingTableError = (message: string = "") =>
  message.includes("schema cache") ||
  message.includes("relation") ||
  message.includes("does not exist");

const parseSlotNumber = (cardName: string) => {
  const match = /^Setter-(\d+)$/i.exec(cardName.trim());
  if (!match) return null;

  const slotNumber = Number(match[1]);
  return Number.isInteger(slotNumber) && slotNumber > 0 ? slotNumber : null;
};

const getLowestMissingSlot = (numbers: number[]) => {
  const occupied = new Set(numbers.filter((n) => Number.isInteger(n) && n > 0));
  occupied.add(1);

  let candidate = 1;
  while (occupied.has(candidate)) candidate += 1;
  return candidate;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { client_id, channel } = parsed.data;

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    const internalSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: client, error: clientError } = await internalSupabase
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!client.supabase_url || !client.supabase_service_key) {
      return new Response(
        JSON.stringify({ error: "Client Supabase credentials not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);
    const primaryTable = channel === "voice" ? "voice_prompts" : "text_prompts";
    const fallbackTable = channel === "voice" ? null : "prompts";

    const readCardNames = async (table: string, fallbackUsed = false) => {
      const { data, error } = await externalSupabase
        .from(table)
        .select("card_name");

      if (error) {
        return {
          success: false as const,
          table,
          fallbackUsed,
          error: error.message,
          rows: [] as Array<{ card_name: string | null }>,
        };
      }

      return {
        success: true as const,
        table,
        fallbackUsed,
        error: null,
        rows: (data || []) as Array<{ card_name: string | null }>,
      };
    };

    let result = await readCardNames(primaryTable);

    if (!result.success && fallbackTable && isMissingTableError(result.error || "")) {
      console.warn(`[list-external-setter-slots] Falling back from ${primaryTable} to ${fallbackTable}`);
      result = await readCardNames(fallbackTable, true);
    }

    if (!result.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to query external setters: ${result.error}`,
          table: result.table,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cardNames = Array.from(
      new Set(
        result.rows
          .map((row) => row.card_name)
          .filter((cardName): cardName is string => typeof cardName === "string" && cardName.trim().length > 0),
      ),
    );

    const slotNumbers = Array.from(
      new Set(
        cardNames
          .map(parseSlotNumber)
          .filter((slotNumber): slotNumber is number => slotNumber !== null),
      ),
    ).sort((a, b) => a - b);

    return new Response(
      JSON.stringify({
        success: true,
        channel,
        table: result.table,
        fallback_used: result.fallbackUsed,
        card_names: cardNames,
        slot_numbers: slotNumbers,
        lowest_missing_slot: getLowestMissingSlot(slotNumbers),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[list-external-setter-slots] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
