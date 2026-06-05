import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { clientId, jobId, slotId, extraEntries } = await req.json();

    if (!clientId || !jobId || !slotId) {
      return new Response(JSON.stringify({ error: "Missing clientId, jobId, or slotId" }), {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get the AI job result
    const { data: job, error: jobError } = await supabase
      .from("ai_generation_jobs")
      .select("result")
      .eq("id", jobId)
      .single();

    if (jobError || !job?.result) {
      return new Response(JSON.stringify({ error: "Job not found or no result" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const personalizedPrompts = (job.result as any)?.personalizedPrompts;
    if (!personalizedPrompts) {
      return new Response(JSON.stringify({ error: "No personalizedPrompts in result" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const selections: Record<string, string> = personalizedPrompts._selections || {};

    // Parse prompts into option prompts and simple prompts
    const optionPromptsMap: Record<string, Record<string, string>> = {};
    const simplePrompts: Record<string, string> = {};

    for (const [key, prompt] of Object.entries(personalizedPrompts)) {
      if (key === "_selections") continue;
      if (typeof prompt !== "string" || !prompt.trim()) continue;

      if (key.includes("::")) {
        const [paramKey, optionValue] = key.split("::", 2);
        if (!paramKey || !optionValue) continue;
        if (!optionPromptsMap[paramKey]) optionPromptsMap[paramKey] = {};
        optionPromptsMap[paramKey][optionValue] = prompt.trim();
      } else {
        simplePrompts[key] = prompt.trim();
      }
    }

    const entries: any[] = [];

    // For params with option prompts, store state as JSON (matching saveParamStateToDB format)
    for (const [paramKey, optMap] of Object.entries(optionPromptsMap)) {
      const selected = selections[paramKey] || "";
      const activePrompt = optMap[selected] || "";

      const stateJson = JSON.stringify({
        enabled: true,
        value: selected,
        customPrompt: activePrompt,
        optionPrompts: optMap,
      });

      entries.push({
        client_id: clientId,
        slot_id: slotId,
        config_key: `param_${paramKey}`,
        selected_option: "enabled",
        custom_content: stateJson,
      });
    }

    // For simple prompts
    for (const [paramKey, prompt] of Object.entries(simplePrompts)) {
      const selected = selections[paramKey] || "enabled";
      const isEnabled = selected === "enabled" || selected !== "disabled";

      const stateJson = JSON.stringify({
        enabled: isEnabled,
        value: selected,
        customPrompt: prompt,
      });

      entries.push({
        client_id: clientId,
        slot_id: slotId,
        config_key: `param_${paramKey}`,
        selected_option: isEnabled ? "enabled" : "disabled",
        custom_content: stateJson,
      });
    }

    // For selections without prompts
    for (const [paramKey, selected] of Object.entries(selections)) {
      if (optionPromptsMap[paramKey] || simplePrompts[paramKey]) continue;
      const isEnabled = selected === "enabled" || selected !== "disabled";

      const stateJson = JSON.stringify({
        enabled: isEnabled,
        value: selected,
      });

      entries.push({
        client_id: clientId,
        slot_id: slotId,
        config_key: `param_${paramKey}`,
        selected_option: isEnabled ? "enabled" : "disabled",
        custom_content: stateJson,
      });
    }

    entries.push({
      client_id: clientId,
      slot_id: slotId,
      config_key: "__ai_config_unlocked",
      selected_option: "enabled",
      custom_content: "true",
    });

    // Delete wrongly-keyed entries: keys that match known param names but lack the param_ prefix
    const badKeys = Object.keys(selections).map(k => k); // raw param keys without prefix
    if (badKeys.length > 0) {
      await supabase
        .from("prompt_configurations")
        .delete()
        .eq("client_id", clientId)
        .eq("slot_id", slotId)
        .in("config_key", badKeys);
    }

    // Add any extra identity/config entries
    if (Array.isArray(extraEntries)) {
      for (const e of extraEntries) {
        entries.push({ client_id: clientId, slot_id: slotId, ...e });
      }
    }

    // Upsert all entries
    const { error: upsertError } = await supabase
      .from("prompt_configurations")
      .upsert(entries, { onConflict: "client_id,slot_id,config_key" });

    if (upsertError) {
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also restore agent_settings for this slot
    const { error: agentError } = await supabase
      .from("agent_settings")
      .upsert({
        client_id: clientId,
        slot_id: slotId,
      }, { onConflict: "client_id,slot_id" });

    // Also restore the prompts record
    const { error: promptError } = await supabase
      .from("prompts")
      .upsert({
        client_id: clientId,
        slot_id: slotId,
        persona: "",
        content: "",
      }, { onConflict: "client_id,slot_id" });

    return new Response(
      JSON.stringify({
        success: true,
        entriesRestored: entries.length,
        optionParams: Object.keys(optionPromptsMap).length,
        simpleParams: Object.keys(simplePrompts).length,
        selections: Object.keys(selections).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
