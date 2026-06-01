import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Slot → Retell agent column mapping. Mirrors retell-proxy SLOT_TO_AGENT_COLUMN
// so we can detect whether a voice slot is "Active" (Retell agent provisioned).
const VOICE_SLOT_TO_AGENT_COLUMN: Record<number, string> = {
  1: "retell_inbound_agent_id",
  2: "retell_outbound_agent_id",
  3: "retell_outbound_followup_agent_id",
  4: "retell_agent_id_4",
  5: "retell_agent_id_5",
  6: "retell_agent_id_6",
  7: "retell_agent_id_7",
  8: "retell_agent_id_8",
  9: "retell_agent_id_9",
  10: "retell_agent_id_10",
};

function slotNumber(slotId: string): number | null {
  const m = slotId.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function isVoiceSlot(slotId: string): boolean {
  return slotId.startsWith("Voice-");
}

// Lowest slot the allocator may hand out per channel. Voice 1-3 are permanently
// reserved for the primary agent's inbound/outbound/followup columns; text 1 is
// the reserved default setter.
const VOICE_FIRST_FREE = 4;
const TEXT_FIRST_FREE = 2;

// Find the lowest free slot for a channel. A slot is free when it has no rows in
// any of the three slot-keyed tables AND (voice only) its Retell agent column is
// null. Returns the slot_id (e.g. "Voice-Setter-4") or null when 4-10 / 2-10 are
// all taken. Same emptiness rule the explicit-target path enforces below, so the
// frontend can never disagree with the backend about what's free.
// deno-lint-ignore no-explicit-any
async function findFreeSlot(supabase: any, clientId: string, isVoice: boolean): Promise<string | null> {
  const prefix = isVoice ? "Voice-Setter-" : "Setter-";
  const start = isVoice ? VOICE_FIRST_FREE : TEXT_FIRST_FREE;
  for (let n = start; n <= 10; n++) {
    const slotId = `${prefix}${n}`;
    const [p, c, a] = await Promise.all([
      supabase.from("prompts").select("id").eq("client_id", clientId).eq("slot_id", slotId).limit(1),
      supabase.from("prompt_configurations").select("id").eq("client_id", clientId).eq("slot_id", slotId).limit(1),
      supabase.from("agent_settings").select("id").eq("client_id", clientId).eq("slot_id", slotId).limit(1),
    ]);
    if ((p.data?.length ?? 0) > 0 || (c.data?.length ?? 0) > 0 || (a.data?.length ?? 0) > 0) continue;
    if (isVoice) {
      const col = VOICE_SLOT_TO_AGENT_COLUMN[n];
      if (col) {
        const { data: cc } = await supabase.from("clients").select(col).eq("id", clientId).single();
        if (cc && (cc as Record<string, unknown>)[col]) continue;
      }
    }
    return slotId;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId, sourceSlotId, targetSlotId: explicitTargetSlotId, name } = await req.json();

    if (!clientId || !sourceSlotId) {
      return new Response(
        JSON.stringify({ error: "clientId and sourceSlotId are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // explicitTargetSlotId is optional. When omitted we auto-allocate the lowest
    // free slot below. The two checks here only apply to an explicit target.
    if (explicitTargetSlotId && sourceSlotId === explicitTargetSlotId) {
      return new Response(
        JSON.stringify({ error: "Source and target slots must be different." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Same-channel only — duplicating across text↔voice doesn't make sense for a
    // pure clone (parameter catalogs differ). Use the existing COPY (AI-rewrite)
    // flow for cross-channel adaptation.
    if (explicitTargetSlotId && isVoiceSlot(sourceSlotId) !== isVoiceSlot(explicitTargetSlotId)) {
      return new Response(
        JSON.stringify({ error: "Cross-channel duplication is not supported. Source and target must both be voice or both be text." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate client exists
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .single();
    if (clientErr || !clientRow) {
      return new Response(
        JSON.stringify({ error: "Client not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve the target slot: use the explicit one if given (back-compat), else
    // auto-allocate the lowest free slot for the source's channel.
    let targetSlotId: string = explicitTargetSlotId;
    if (!targetSlotId) {
      const freeSlot = await findFreeSlot(supabase, clientId, isVoiceSlot(sourceSlotId));
      if (!freeSlot) {
        return new Response(
          JSON.stringify({ error: "All setter slots are in use (max 10). Delete one to free a slot." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetSlotId = freeSlot;
    }

    // Optional caller-supplied name for the new setter (overrides the "(Copy)" suffix).
    const desiredName = typeof name === "string" && name.trim().length > 0 ? name.trim() : null;

    // Validate target slot is empty across all three slot-keyed tables we clone into.
    const [tgtPrompts, tgtConfigs, tgtSettings] = await Promise.all([
      supabase.from("prompts").select("id").eq("client_id", clientId).eq("slot_id", targetSlotId).limit(1),
      supabase.from("prompt_configurations").select("id").eq("client_id", clientId).eq("slot_id", targetSlotId).limit(1),
      supabase.from("agent_settings").select("id").eq("client_id", clientId).eq("slot_id", targetSlotId).limit(1),
    ]);
    if ((tgtPrompts.data?.length ?? 0) > 0 || (tgtConfigs.data?.length ?? 0) > 0 || (tgtSettings.data?.length ?? 0) > 0) {
      return new Response(
        JSON.stringify({ error: `Target slot ${targetSlotId} is not empty. Delete it first or pick a different slot.` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For voice targets: also reject if the Retell agent column is non-null
    // (could happen if the agent was provisioned but DB rows were deleted).
    if (isVoiceSlot(targetSlotId)) {
      const slotN = slotNumber(targetSlotId);
      const col = slotN ? VOICE_SLOT_TO_AGENT_COLUMN[slotN] : null;
      if (col) {
        const { data: clientCols } = await supabase
          .from("clients")
          .select(col)
          .eq("id", clientId)
          .single();
        if (clientCols && (clientCols as Record<string, unknown>)[col]) {
          return new Response(
            JSON.stringify({ error: `Target slot ${targetSlotId} has a Retell agent attached (${col}). Delete it first.` }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Fetch source rows from the three slot-keyed tables we clone.
    // prompt_versions and setter_ai_reports are intentionally NOT cloned — they
    // are historical to the source slot and the new slot starts fresh.
    const [srcPrompts, srcConfigs, srcSettings] = await Promise.all([
      supabase.from("prompts").select("*").eq("client_id", clientId).eq("slot_id", sourceSlotId),
      supabase.from("prompt_configurations").select("*").eq("client_id", clientId).eq("slot_id", sourceSlotId),
      supabase.from("agent_settings").select("*").eq("client_id", clientId).eq("slot_id", sourceSlotId).maybeSingle(),
    ]);

    if (srcPrompts.error || srcConfigs.error) {
      console.error("[duplicate-setter-config] source fetch error:", srcPrompts.error || srcConfigs.error);
      return new Response(
        JSON.stringify({ error: "Failed to read source setter." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if ((srcPrompts.data?.length ?? 0) === 0 && (srcConfigs.data?.length ?? 0) === 0) {
      return new Response(
        JSON.stringify({ error: `Source slot ${sourceSlotId} has no configuration to duplicate.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clone prompts rows. Drop id/created_at/updated_at; re-key slot_id and
    // suffix the visible name. Force is_active=false so the new slot won't
    // claim to be "Active" until the user opens it + clicks Save Setter
    // (which provisions the Retell agent for voice / triggers external sync
    // for text).
    const promptsToInsert = (srcPrompts.data ?? []).map((row: Record<string, unknown>) => {
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = row;
      const suffixedName = desiredName
        ? desiredName
        : typeof rest.name === "string" && rest.name.trim().length > 0
          ? `${rest.name} (Copy)`
          : `${sourceSlotId} (Copy)`;
      return { ...rest, slot_id: targetSlotId, name: suffixedName, is_active: false };
    });

    if (promptsToInsert.length > 0) {
      const { error: insPromptsErr } = await supabase.from("prompts").insert(promptsToInsert);
      if (insPromptsErr) {
        console.error("[duplicate-setter-config] prompts insert failed:", insPromptsErr);
        return new Response(
          JSON.stringify({ error: `Failed to clone prompts: ${insPromptsErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Clone prompt_configurations rows.
    const configsToInsert = (srcConfigs.data ?? []).map((row: Record<string, unknown>) => {
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = row;
      return { ...rest, slot_id: targetSlotId };
    });

    if (configsToInsert.length > 0) {
      const { error: insConfigsErr } = await supabase.from("prompt_configurations").insert(configsToInsert);
      if (insConfigsErr) {
        console.error("[duplicate-setter-config] prompt_configurations insert failed:", insConfigsErr);
        // Roll back prompts inserts so the target slot stays clean.
        await supabase.from("prompts").delete().eq("client_id", clientId).eq("slot_id", targetSlotId);
        return new Response(
          JSON.stringify({ error: `Failed to clone configurations: ${insConfigsErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Clone agent_settings row (singular per slot). needs_external_sync=true
    // so the next Save Setter / channel sync picks it up.
    if (srcSettings.data) {
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = srcSettings.data as Record<string, unknown>;
      const suffixedAgentName = desiredName
        ? desiredName
        : typeof rest.name === "string" && rest.name.trim().length > 0
          ? `${rest.name} (Copy)`
          : null;
      const settingsToInsert = {
        ...rest,
        slot_id: targetSlotId,
        name: suffixedAgentName,
        needs_external_sync: true,
        last_deployed_prompt: null,
      };
      const { error: insSettingsErr } = await supabase.from("agent_settings").insert(settingsToInsert);
      if (insSettingsErr) {
        console.error("[duplicate-setter-config] agent_settings insert failed:", insSettingsErr);
        // Roll back the prior inserts.
        await Promise.all([
          supabase.from("prompts").delete().eq("client_id", clientId).eq("slot_id", targetSlotId),
          supabase.from("prompt_configurations").delete().eq("client_id", clientId).eq("slot_id", targetSlotId),
        ]);
        return new Response(
          JSON.stringify({ error: `Failed to clone agent settings: ${insSettingsErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(
      `[duplicate-setter-config] ${sourceSlotId} → ${targetSlotId} OK (prompts=${promptsToInsert.length}, configs=${configsToInsert.length}, settings=${srcSettings.data ? 1 : 0})`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        sourceSlotId,
        targetSlotId,
        cloned: {
          prompts: promptsToInsert.length,
          prompt_configurations: configsToInsert.length,
          agent_settings: srcSettings.data ? 1 : 0,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[duplicate-setter-config] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
