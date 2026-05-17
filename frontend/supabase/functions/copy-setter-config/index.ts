import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_MODEL = "google/gemini-2.5-pro";

const SYSTEM_PROMPT = `You are an expert AI sales setter configuration specialist. Your job is to take an EXISTING setter configuration (the SOURCE) and re-create it for a DIFFERENT setter slot (the TARGET).

## YOUR TASK
You will receive:
1. The SOURCE setter's full configuration — all parameter keys, selected options, their mini-prompts, AND identity/company context
2. The TARGET setter's complete parameter catalog (which may differ if crossing text ↔ voice channels)
3. Optional user guidelines on how to adapt the copy

## WHAT YOU MUST DO
For EACH parameter in the TARGET parameter list:
- If a matching parameter exists in the SOURCE, use the SOURCE's prompt as the basis and adapt it
- If the parameter exists only in the TARGET (no SOURCE equivalent), generate a prompt that matches the style, tone, and business context from the SOURCE configuration
- If crossing channels (text → voice or voice → text), adapt the communication style appropriately:
  - Text → Voice: Convert written-style instructions to spoken conversation style. Remove references to typing, text formatting, emojis in text, etc. Add voice-appropriate guidance (tone of voice, pacing, verbal cues)
  - Voice → Text: Convert spoken-style instructions to written message style. Add text-appropriate guidance (message length, emoji usage, formatting)

## IDENTITY & COMPANY FIELDS
The SOURCE will include identity fields (agent name, company name, ICP, lead sources, etc.) stored OUTSIDE the parameter system.
You MUST copy these into the output as simple prompt keys so the target setter receives the same business context.
For example: "agent_name", "company_name", "company_knowledge_base", "ideal_customer_profile", "agent_mission", "lead_source", "lead_awareness", "prior_communications"

## WRITING STYLE — THIS IS CRITICAL
- Write like you're explaining to a 15-year-old. Use SIMPLE, DIRECT words.
- Short sentences. No fluff. No filler. No corporate jargon.
- Say "talk" not "communicate". Say "ask" not "inquire". Say "help" not "facilitate".
- Every sentence should be an instruction: DO this. DON'T do that. SAY this. NEVER say that.
- Use **BOLD**, UPPERCASE, and markers like ✅ and ❌ to make rules impossible to miss.
- Keep the same industry-specific language from the source.

## CRITICAL RULES
1. Return a JSON object where each key is a TARGET parameter key and the value is the personalized prompt text
2. For parameters with MULTIPLE OPTIONS: use compound keys "paramKey::optionValue" for EACH option
3. For single-prompt parameters: use just the parameter key
4. Every TARGET parameter MUST have output — do NOT skip any
5. Keep the source's business context, examples, and tone throughout
6. Also output a "_selections" object mapping each parameter to its recommended option value
7. Copy the source's selected options when the same parameter exists in both; otherwise pick the best fit
8. Do NOT add new parameters or skip any
9. ALSO include identity/company keys in the output (agent_name, company_name, ideal_customer_profile, etc.)

## RESPONSE FORMAT
Return ONLY a valid JSON object. No markdown code blocks. No extra text.

Example:
{
  "agent_name": "...prompt for agent name...",
  "company_name": "...company name value...",
  "ideal_customer_profile": "...ICP description...",
  "agent_mission": "...mission prompt...",
  "lead_source": "...lead source info...",
  "agent_pronouns::first_person": "...prompt...",
  "agent_pronouns::we_person": "...prompt...",
  "_selections": {
    "agent_pronouns": "first_person",
    "agent_goal": "book_appointments",
    ...
  }
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  console.log("[copy-setter-config] Starting");

  try {
    const { clientId, sourceSlotId, targetSlotId, sourceChannel, targetChannel, userGuidelines, targetParameters } =
      await req.json();

    if (!clientId || !sourceSlotId || !targetSlotId) {
      return new Response(
        JSON.stringify({ error: "clientId, sourceSlotId, and targetSlotId are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !triggerSecretKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate client and get API key
    const { data: clientData, error: clientErr } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", clientId)
      .single();

    if (clientErr || !clientData) {
      return new Response(
        JSON.stringify({ error: "Client not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!clientData.openrouter_api_key) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key is not configured. Please add it in API Credentials." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch ALL source setter's prompt_configurations (not just param_ prefixed)
    const { data: sourceConfigs } = await supabase
      .from("prompt_configurations")
      .select("config_key, selected_option, custom_content")
      .eq("client_id", clientId)
      .eq("slot_id", sourceSlotId);

    if (!sourceConfigs || sourceConfigs.length === 0) {
      return new Response(
        JSON.stringify({ error: "Source setter has no configuration to copy." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build source config summary — separate param_ configs from identity/company configs
    const sourceParamSections: string[] = [];
    const sourceIdentitySections: string[] = [];

    // Identity/company keys stored via usePromptConfigurations (localConfigs)
    const identityKeys = new Set([
      'agent_name', 'agent_goal', 'custom_prompt',
      'company_name', 'company_knowledge_base', 'ideal_customer_profile',
      'agent_mission', 'lead_source', 'lead_awareness', 'prior_communications',
    ]);

    for (const conf of sourceConfigs) {
      // Skip internal metadata keys
      if (conf.config_key === 'ai_config_notes' || conf.config_key === '_retell_voice_settings') continue;

      if (conf.config_key?.startsWith("param_")) {
        // Parameter system configs
        const paramKey = conf.config_key.replace("param_", "");
        let readableContent = "";
        let selectedOption = conf.selected_option || "";

        if (conf.custom_content?.trim()) {
          try {
            const parsed = JSON.parse(conf.custom_content);
            selectedOption = String(parsed.value ?? selectedOption);
            if (parsed.customPrompt) {
              readableContent = parsed.customPrompt;
            } else if (parsed.optionPrompts) {
              const prompts = Object.entries(parsed.optionPrompts)
                .map(([optVal, prompt]) => `  Option "${optVal}":\n  ${String(prompt).replace(/\n/g, "\n  ")}`)
                .join("\n\n");
              readableContent = prompts;
            }
          } catch {
            readableContent = conf.custom_content;
          }
        }

        if (readableContent) {
          sourceParamSections.push(
            `### ${paramKey}\nSelected: ${selectedOption}\nPrompt:\n${readableContent}`
          );
        }
      } else if (identityKeys.has(conf.config_key)) {
        // Identity/company configs (stored without param_ prefix)
        const content = conf.custom_content?.trim() || '';
        const selected = conf.selected_option?.trim() || '';
        if (content || selected) {
          sourceIdentitySections.push(
            `### ${conf.config_key}\nSelected: ${selected}\nContent:\n${content}`
          );
        }
      }
    }

    // Also get agent_settings for the source (name, model, etc.)
    const { data: sourceAgent } = await supabase
      .from("agent_settings")
      .select("name, model")
      .eq("client_id", clientId)
      .eq("slot_id", sourceSlotId)
      .single();

    const isCrossChannel = sourceChannel !== targetChannel;
    const channelNote = isCrossChannel
      ? `\n\n## CROSS-CHANNEL ADAPTATION\nThe SOURCE is a ${sourceChannel.toUpperCase()} setter and the TARGET is a ${targetChannel.toUpperCase()} setter. You MUST adapt all prompts to fit the ${targetChannel} channel's communication style.`
      : "";

    const guidelinesNote = userGuidelines?.trim()
      ? `\n\n## USER INSTRUCTIONS\n${userGuidelines.trim()}\nFollow these instructions carefully — they come directly from the user.`
      : "";

    // Build target parameter list text
    let targetParamListText = "(No target parameter list provided — use source parameters as reference)";
    if (targetParameters && Array.isArray(targetParameters) && targetParameters.length > 0) {
      targetParamListText = targetParameters.map((p: any, i: number) => {
        let line = `${i + 1}. **${p.key}** — ${p.label} (type: ${p.type || 'select'})`;
        if (p.options && p.options.length > 0) {
          line += `\n   Options: ${p.options.map((o: any) => `"${o.value}" (${o.label})`).join(', ')}`;
        }
        return line;
      }).join('\n');
    }

    const userPrompt = `Re-create the following setter configuration for a new setter slot.

## SOURCE SETTER CONFIGURATION (${sourceChannel.toUpperCase()} channel: ${sourceSlotId})
${sourceAgent?.name ? `Agent Name: ${sourceAgent.name}` : ""}

### IDENTITY & COMPANY CONTEXT
${sourceIdentitySections.join("\n\n") || "(No identity configs found)"}

### PARAMETERS
${sourceParamSections.join("\n\n") || "(No parameters found)"}${channelNote}${guidelinesNote}

## TARGET SETTER
Channel: ${targetChannel.toUpperCase()}
Slot: ${targetSlotId}

## TARGET PARAMETER CATALOG
These are ALL the parameters the target setter supports. You MUST generate a prompt and selection for EVERY one:
${targetParamListText}

Re-create ALL the source parameters above for the target slot. Keep the same business context, examples, and personalization. For parameters with multiple options, use compound keys "paramKey::optionValue".
ALSO include identity/company keys (agent_name, company_name, ideal_customer_profile, agent_mission, lead_source, lead_awareness, prior_communications) copied from the source.

Return ONLY a valid JSON object with the parameter prompts and a "_selections" object.`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    // Insert job row
    const { data: jobRow, error: insertError } = await supabase
      .from("ai_generation_jobs")
      .insert({
        client_id: clientId,
        job_type: "generate-setter-config",
        status: "pending",
        input_payload: {
          slotId: targetSlotId,
          sourceSlotId,
          sourceChannel,
          targetChannel,
          messages,
          max_tokens: 32000,
          temperature: 0.2,
          response_format: { type: "json_object" },
          openrouter_api_key: clientData.openrouter_api_key,
        },
      })
      .select("id")
      .single();

    if (insertError || !jobRow) {
      console.error("Failed to insert job:", insertError);
      throw new Error("Failed to create generation job");
    }

    const jobId = jobRow.id;

    // Trigger the Trigger.dev task
    const triggerResponse = await fetch(
      "https://api.trigger.dev/api/v1/tasks/run-ai-job/trigger",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${triggerSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: {
            job_id: jobId,
            client_id: clientId,
            job_type: "generate-setter-config",
            messages,
            max_tokens: 32000,
            temperature: 0.2,
            response_format: { type: "json_object" },
          },
        }),
      }
    );

    if (!triggerResponse.ok) {
      const errText = await triggerResponse.text();
      console.error("Trigger.dev error:", triggerResponse.status, errText);
      await supabase
        .from("ai_generation_jobs")
        .update({
          status: "failed",
          error_message: `Failed to trigger AI job: ${triggerResponse.status}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      throw new Error("Failed to trigger AI job processing");
    }

    console.log(
      `[copy-setter-config] Job ${jobId} created: ${sourceSlotId} → ${targetSlotId} (${sourceChannel} → ${targetChannel})`
    );

    return new Response(JSON.stringify({ job_id: jobId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("copy-setter-config error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});