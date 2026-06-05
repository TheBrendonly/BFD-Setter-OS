import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { client_id, setter_slot_id, user_feedback, parameterCatalog } = await req.json();

    if (!client_id || !setter_slot_id || !user_feedback?.trim()) {
      return new Response(JSON.stringify({ error: "Missing required parameters: client_id, setter_slot_id, user_feedback" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get client's OpenRouter API key
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", client_id)
      .single();

    if (clientErr || !client?.openrouter_api_key) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured. Please add it in Settings → Credentials." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch all prompt_configurations for this setter
    const { data: promptConfigs } = await supabase
      .from("prompt_configurations")
      .select("config_key, custom_content, selected_option")
      .eq("client_id", client_id)
      .eq("slot_id", setter_slot_id);

    // 3. Build config lookup
    const configLookup: Record<string, { selected_option: string; custom_content: string }> = {};
    for (const pc of (promptConfigs || [])) {
      configLookup[pc.config_key] = {
        selected_option: pc.selected_option || "",
        custom_content: pc.custom_content || "",
      };
    }

    // 4. Build parameter listing from catalog
    let paramListing = "";

    if (parameterCatalog && Array.isArray(parameterCatalog) && parameterCatalog.length > 0) {
      const paramSections: string[] = [];

      for (const param of parameterCatalog) {
        const configKey = param.key.startsWith("param_") ? param.key : `param_${param.key}`;
        const stored = configLookup[configKey];

        let currentSelection = "";
        let currentPrompt = "";

        if (stored?.custom_content) {
          try {
            const parsed = JSON.parse(stored.custom_content);
            currentSelection = String(parsed.value || stored.selected_option || "");
            if (parsed.customPrompt) {
              currentPrompt = parsed.customPrompt;
            } else if (parsed.optionPrompts && parsed.value) {
              currentPrompt = parsed.optionPrompts[String(parsed.value)] || "";
            }
          } catch {
            currentSelection = stored.selected_option || "";
            currentPrompt = stored.custom_content;
          }
        }

        if (param.type === "select" && param.options && param.options.length > 0) {
          let section = `### Parameter: ${param.label} (config_key: ${configKey})\n`;
          section += `Type: select\n`;
          section += `Currently Selected: "${currentSelection}"\n`;
          if (currentPrompt) {
            section += `Current Active Prompt:\n\`\`\`\n${currentPrompt}\n\`\`\`\n`;
          }
          section += `\nAvailable Options:\n`;

          for (const opt of param.options) {
            const isSelected = opt.value === currentSelection;
            let optPrompt = opt.defaultPrompt || "(no default prompt)";
            if (stored?.custom_content) {
              try {
                const parsed = JSON.parse(stored.custom_content);
                if (parsed.optionPrompts && parsed.optionPrompts[opt.value]) {
                  optPrompt = parsed.optionPrompts[opt.value];
                }
              } catch { /* use default */ }
            }

            section += `  - Option "${opt.value}" (${opt.label})${isSelected ? " ← CURRENTLY SELECTED" : ""}\n`;
            section += `    Prompt for this option:\n    \`\`\`\n    ${optPrompt.replace(/\n/g, "\n    ")}\n    \`\`\`\n`;
          }

          paramSections.push(section);
        } else {
          let readablePrompt = currentPrompt || stored?.custom_content?.trim() || "";
          if (!readablePrompt && stored?.custom_content) {
            try {
              const parsed = JSON.parse(stored.custom_content);
              readablePrompt = parsed.customPrompt || "";
            } catch { readablePrompt = stored.custom_content; }
          }

          if (readablePrompt) {
            let section = `### Parameter: ${param.label} (config_key: ${configKey})\n`;
            section += `Type: ${param.type}\n`;
            section += `Option: ${stored?.selected_option || ""}\n`;
            section += `Prompt:\n\`\`\`\n${readablePrompt}\n\`\`\``;
            paramSections.push(section);
          }
        }
      }

      paramListing = paramSections.join("\n\n");
    } else {
      // Fallback without catalog
      const entries: string[] = [];
      for (const pc of (promptConfigs || [])) {
        if (pc.custom_content?.trim()) {
          let readablePrompt = pc.custom_content.trim();
          if (pc.config_key.startsWith("param_")) {
            try {
              const parsed = JSON.parse(readablePrompt);
              if (parsed.customPrompt) readablePrompt = parsed.customPrompt;
              else if (parsed.optionPrompts && parsed.value) readablePrompt = parsed.optionPrompts[parsed.value] || readablePrompt;
            } catch { /* not JSON */ }
          }
          entries.push(`### Parameter: ${pc.config_key}\nOption: ${pc.selected_option || ""}\nPrompt:\n\`\`\`\n${readablePrompt}\n\`\`\``);
        }
      }
      paramListing = entries.join("\n\n");
    }

    // 5. Build system prompt
    const systemPrompt = `You are an expert AI sales setter analyst. You analyze setter configurations and suggest targeted improvements based on user feedback.

## CURRENT SETTER PARAMETERS
${paramListing || "(No parameters configured yet)"}

## USER FEEDBACK (MANDATORY DIRECTIVE)
The user has provided specific instructions about what they want changed. You MUST treat this as a direct order — not a suggestion.
Your ONLY job is to fulfill the user's request by finding ALL parameters related to their instructions and modifying them accordingly.
DO NOT add your own opinions, extra suggestions, or improvements beyond what the user asked for.
If the user's request affects 1 parameter, return 1 suggestion. If it affects 15 parameters, return 15 suggestions.
Search the ENTIRE prompt configuration for anything related to the user's request.

User's instructions:
\`\`\`
${user_feedback.trim()}
\`\`\`

## YOUR TASK
Execute the user's directive above. Find EVERY parameter whose prompt content relates to the user's instructions and modify them accordingly.
- Do NOT suggest changes unrelated to the user's request
- Do NOT add your own improvement ideas — only implement what the user asked for
- If the user says "remove emojis", find ALL parameters that mention emojis and update them
- If the user says "change tone to formal", find ALL parameters related to tone and update them
- Be thorough: scan every parameter prompt for relevance to the user's request

Return a JSON object with this exact structure:
{
  "summary": "2-3 sentence summary of what you're changing and why",
  "suggestions": [
    {
      "config_key": "param_use_emojis",
      "parameter_label": "Use Emojis",
      "current_option": "enabled",
      "suggested_option": "disabled",
      "reason": "User requested no emojis. Current prompt allows free emoji use.",
      "severity": "critical",
      "original_prompt": "current full prompt text for the option",
      "suggested_prompt": "complete rewritten prompt for the suggested option"
    }
  ]
}

CRITICAL RULES:
- Only suggest changes that directly address the user's feedback
- For "select" type parameters: if the issue is that the WRONG option is selected, suggest switching to the other option AND provide the rewritten prompt for that option
- The "current_option" and "suggested_option" fields MUST contain the exact option VALUE ids from the parameter definition (e.g., "give_range", "redirect_to_call", "address_directly") — NEVER return the human label
- If no option change is needed, set "suggested_option" equal to the current option value
- Keep the same ## heading format in rewrites
- Each rewrite must be the COMPLETE replacement prompt, not a partial edit
- The parameter_label MUST match the exact label shown in the parameter definitions above
- severity: "critical" = directly contradicts feedback, "important" = significantly affects result, "minor" = small improvement
- Return ONLY the JSON object, no markdown, no extra text`;

    // 6. Build LLM request
    const reportRequestBody = {
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Analyze the setter configuration based on the user's feedback and return structured parameter improvement suggestions as a JSON object." },
      ],
      response_format: { type: "json_object" },
      max_tokens: 16000,
      temperature: 0.3,
    };

    // 7. Create ai_generation_jobs row
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    if (!triggerSecretKey) throw new Error("TRIGGER_SECRET_KEY not configured");

    const { data: jobRow, error: insertError } = await supabase
      .from("ai_generation_jobs")
      .insert({
        client_id,
        job_type: "analyze-setter-prompt",
        status: "pending",
        input_payload: {
          slotId: setter_slot_id || null,
          messages: reportRequestBody.messages,
          response_format: reportRequestBody.response_format,
          max_tokens: reportRequestBody.max_tokens,
          temperature: reportRequestBody.temperature,
          openrouter_api_key: client.openrouter_api_key,
        },
      })
      .select("id")
      .single();

    if (insertError || !jobRow) {
      console.error("Failed to insert job:", insertError);
      throw new Error("Failed to create generation job");
    }

    const jobId = jobRow.id;

    // 8. Trigger Trigger.dev task
    const triggerResponse = await fetch("https://api.trigger.dev/api/v1/tasks/run-ai-job/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${triggerSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          job_id: jobId,
          client_id,
          job_type: "analyze-setter-prompt",
          messages: reportRequestBody.messages,
          response_format: reportRequestBody.response_format,
          max_tokens: reportRequestBody.max_tokens,
          temperature: reportRequestBody.temperature,
        },
      }),
    });

    if (!triggerResponse.ok) {
      const errText = await triggerResponse.text();
      console.error("Trigger.dev error:", triggerResponse.status, errText);
      await supabase.from("ai_generation_jobs").update({
        status: "failed",
        error_message: `Failed to trigger AI job: ${triggerResponse.status}`,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
      throw new Error("Failed to trigger AI job processing");
    }

    console.log(`[analyze-setter-prompt] Job ${jobId} created for slot ${setter_slot_id}`);

    return new Response(JSON.stringify({ job_id: jobId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("analyze-setter-prompt error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
