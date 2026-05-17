import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// loggedFetch no longer needed — AI calls delegated to Trigger.dev

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { simulationId, clientId, parameterCatalog, userFeedback } = await req.json();

    if (!simulationId || !clientId) {
      return new Response(JSON.stringify({ error: "Missing simulationId or clientId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get client's OpenRouter API key
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", clientId)
      .single();

    if (clientErr || !client?.openrouter_api_key) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch simulation
    const { data: simulation, error: simErr } = await supabase
      .from("simulations")
      .select("*")
      .eq("id", simulationId)
      .single();

    if (simErr || !simulation) {
      return new Response(JSON.stringify({ error: "Simulation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch personas + messages
    const { data: personas } = await supabase
      .from("simulation_personas")
      .select("*")
      .eq("simulation_id", simulationId)
      .order("created_at", { ascending: true });

    const personaIds = (personas || []).map((p: any) => p.id);
    let allMessages: any[] = [];
    if (personaIds.length > 0) {
      const { data: msgs } = await supabase
        .from("simulation_messages")
        .select("*")
        .in("persona_id", personaIds)
        .order("message_order", { ascending: true });
      allMessages = msgs || [];
    }

    // 4. Build transcripts
    const transcripts: string[] = [];
    for (const persona of (personas || [])) {
      const pMsgs = allMessages.filter((m: any) => m.persona_id === persona.id);
      if (pMsgs.length === 0) continue;
      let t = `--- ${persona.name} (${persona.age}y, ${persona.gender}, ${persona.occupation}) ---\n`;
      t += `Goal: ${persona.goal || 'N/A'} | Problem: ${persona.problem || 'N/A'}\n`;
      t += `Status: ${persona.status}`;
      if (persona.booking_intent && persona.booking_intent !== 'none') t += ` | Booking: ${persona.booking_intent}`;
      t += '\n\n';
      for (const msg of pMsgs) {
        t += `[${msg.role === 'user' ? persona.name : 'SETTER'}]: ${msg.content || '(empty)'}\n`;
      }
      t += `--- END ---\n\n`;
      transcripts.push(t);
    }

    // 4b. Fetch ICP profiles (simulation configuration)
    const { data: icpProfiles } = await supabase
      .from("simulation_icp_profiles")
      .select("*")
      .eq("simulation_id", simulationId)
      .order("sort_order", { ascending: true });

    let simulationConfigSection = '';
    if (simulation || (icpProfiles && icpProfiles.length > 0)) {
      simulationConfigSection = `## SIMULATION CONFIGURATION\n`;
      simulationConfigSection += `Name: ${simulation.name || 'N/A'}\n`;
      simulationConfigSection += `Business Info: ${simulation.business_info || 'N/A'}\n`;
      simulationConfigSection += `Test Goal: ${simulation.test_goal || 'N/A'}\n`;
      simulationConfigSection += `Test Specifics: ${simulation.test_specifics || 'N/A'}\n`;
      simulationConfigSection += `Conversations: ${simulation.num_conversations || 'N/A'}, Messages: ${simulation.min_messages}-${simulation.max_messages}\n\n`;

      if (icpProfiles && icpProfiles.length > 0) {
        simulationConfigSection += `### ICP PROFILES TESTED\n`;
        for (const icp of icpProfiles) {
          simulationConfigSection += `\n**${icp.name}** (${icp.persona_count} personas)\n`;
          simulationConfigSection += `Description: ${icp.description || 'N/A'}\n`;
          simulationConfigSection += `Age Range: ${icp.age_min}-${icp.age_max} | Gender: ${icp.gender || 'any'} | Location: ${icp.location || 'N/A'}\n`;
          simulationConfigSection += `First Message: ${icp.first_message_sender || 'N/A'} — ${icp.first_message_detail || 'N/A'}\n`;
          simulationConfigSection += `Lead Trigger: ${icp.lead_trigger || 'N/A'}\n`;
          simulationConfigSection += `Lead Knowledge: ${icp.lead_knowledge || 'N/A'}\n`;
          simulationConfigSection += `Concerns: ${icp.concerns || 'N/A'}\n`;
          if (icp.scenario_items && (icp.scenario_items as string[]).length > 0) {
            simulationConfigSection += `Entry Scenarios: ${(icp.scenario_items as string[]).join(', ')}\n`;
          }
          if (icp.behaviors && (icp.behaviors as string[]).length > 0) {
            simulationConfigSection += `Behaviors: ${(icp.behaviors as string[]).join(', ')}\n`;
          }
          if (icp.test_booking) {
            simulationConfigSection += `Booking Test: ${icp.booking_count || 0} bookings`;
            if (icp.test_cancellation || icp.test_reschedule) {
              simulationConfigSection += `, ${icp.cancel_reschedule_count || 0} cancel/reschedule`;
            }
            simulationConfigSection += `\n`;
          }
        }
      }
    }

    // 5. Fetch current prompt_configurations for this setter
    const slotId = `Setter-${simulation.agent_number}`;
    const { data: promptConfigs } = await supabase
      .from("prompt_configurations")
      .select("config_key, custom_content, selected_option")
      .eq("client_id", clientId)
      .eq("slot_id", slotId);

    // 6. Build a rich parameter listing that includes ALL options per parameter
    // parameterCatalog comes from the client and contains the full definition of each parameter
    // Format: Array<{ key, label, type, options?: Array<{ value, label, defaultPrompt }> }>
    
    const configLookup: Record<string, { selected_option: string; custom_content: string }> = {};
    for (const pc of (promptConfigs || [])) {
      configLookup[pc.config_key] = {
        selected_option: pc.selected_option || '',
        custom_content: pc.custom_content || '',
      };
    }

    let paramListing = '';

    if (parameterCatalog && Array.isArray(parameterCatalog) && parameterCatalog.length > 0) {
      // Build rich listing from client-provided catalog
      const paramSections: string[] = [];

      for (const param of parameterCatalog) {
        const configKey = param.key.startsWith('param_') ? param.key : `param_${param.key}`;
        const stored = configLookup[configKey];
        
        let currentSelection = '';
        let currentPrompt = '';
        
        if (stored?.custom_content) {
          try {
            const parsed = JSON.parse(stored.custom_content);
            currentSelection = String(parsed.value || stored.selected_option || '');
            // Get the active prompt: customPrompt > optionPrompts[value] > default
            if (parsed.customPrompt) {
              currentPrompt = parsed.customPrompt;
            } else if (parsed.optionPrompts && parsed.value) {
              currentPrompt = parsed.optionPrompts[String(parsed.value)] || '';
            }
          } catch {
            currentSelection = stored.selected_option || '';
            currentPrompt = stored.custom_content;
          }
        }

        if (param.type === 'select' && param.options && param.options.length > 0) {
          let section = `### Parameter: ${param.label} (config_key: ${configKey})\n`;
          section += `Type: select\n`;
          section += `Currently Selected: "${currentSelection}"\n`;
          if (currentPrompt) {
            section += `Current Active Prompt:\n\`\`\`\n${currentPrompt}\n\`\`\`\n`;
          }
          section += `\nAvailable Options:\n`;
          
          for (const opt of param.options) {
            const isSelected = opt.value === currentSelection;
            // Get the actual stored prompt for this option (may be customized)
            let optPrompt = opt.defaultPrompt || '(no default prompt)';
            if (stored?.custom_content) {
              try {
                const parsed = JSON.parse(stored.custom_content);
                if (parsed.optionPrompts && parsed.optionPrompts[opt.value]) {
                  optPrompt = parsed.optionPrompts[opt.value];
                }
              } catch { /* use default */ }
            }
            
            section += `  - Option "${opt.value}" (${opt.label})${isSelected ? ' ← CURRENTLY SELECTED' : ''}\n`;
            section += `    Prompt for this option:\n    \`\`\`\n    ${optPrompt.replace(/\n/g, '\n    ')}\n    \`\`\`\n`;
          }
          
          paramSections.push(section);
        } else {
          // Non-select param — show as before
          let readablePrompt = currentPrompt || stored?.custom_content?.trim() || '';
          if (!readablePrompt && stored?.custom_content) {
            try {
              const parsed = JSON.parse(stored.custom_content);
              readablePrompt = parsed.customPrompt || '';
            } catch { readablePrompt = stored.custom_content; }
          }
          
          if (readablePrompt) {
            let section = `### Parameter: ${param.label} (config_key: ${configKey})\n`;
            section += `Type: ${param.type}\n`;
            section += `Option: ${stored?.selected_option || ''}\n`;
            section += `Prompt:\n\`\`\`\n${readablePrompt}\n\`\`\``;
            paramSections.push(section);
          }
        }
      }

      paramListing = paramSections.join('\n\n');
    } else {
      // Fallback: legacy behavior without catalog
      const configMap: Record<string, { selected_option: string; readable_prompt: string }> = {};
      for (const pc of (promptConfigs || [])) {
        if (pc.custom_content?.trim()) {
          let readablePrompt = pc.custom_content.trim();
          if (pc.config_key.startsWith('param_')) {
            try {
              const parsed = JSON.parse(readablePrompt);
              if (parsed.customPrompt) {
                readablePrompt = parsed.customPrompt;
              } else if (parsed.optionPrompts && parsed.value) {
                readablePrompt = parsed.optionPrompts[parsed.value] || readablePrompt;
              } else if (parsed.optionPrompts) {
                const firstKey = Object.keys(parsed.optionPrompts)[0];
                if (firstKey) readablePrompt = parsed.optionPrompts[firstKey];
              }
            } catch { /* not JSON */ }
          }
          configMap[pc.config_key] = {
            selected_option: pc.selected_option || '',
            readable_prompt: readablePrompt,
          };
        }
      }
      paramListing = Object.entries(configMap)
        .map(([key, val]) => `### Parameter: ${key}\nOption: ${val.selected_option}\nPrompt:\n\`\`\`\n${val.readable_prompt}\n\`\`\``)
        .join('\n\n');
    }

    // 7. Call LLM with tool calling for structured output
    const hasUserFeedback = !!userFeedback?.trim();

    const userFeedbackSection = hasUserFeedback
      ? `\n## USER'S DIRECTIVE (MANDATORY)
The user has provided specific instructions about what they want changed. You MUST treat this as a direct order — not a suggestion.
Your ONLY job is to fulfill the user's request by finding ALL parameters related to their instructions and modifying them accordingly.
DO NOT add your own opinions, extra suggestions, or improvements beyond what the user asked for.
If the user's request affects 1 parameter, return 1 suggestion. If it affects 15 parameters, return 15 suggestions.
Search the ENTIRE prompt configuration for anything related to the user's request.

User's instructions:
\`\`\`
${userFeedback.trim()}
\`\`\`
`
      : '';

    const taskInstructions = hasUserFeedback
      ? `Execute the user's directive above. Find EVERY parameter whose prompt content relates to the user's instructions and modify them accordingly.
- Do NOT suggest changes unrelated to the user's request
- Do NOT add your own improvement ideas — only implement what the user asked for
- If the user says "remove emojis", find ALL parameters that mention emojis and update them
- If the user says "change tone to formal", find ALL parameters related to tone and update them
- Be thorough: scan every parameter prompt for relevance to the user's request`
      : `Analyze the conversations and identify which SPECIFIC parameters need improvement based on your expert analysis.
For each parameter:
1. Explain WHY it needs changing (reference specific conversation failures)
2. If the parameter has multiple options (select type), you MAY suggest switching to a different option
3. Provide the COMPLETE rewritten prompt for the target option
- Only suggest changes for parameters that genuinely need improvement
- Focus on the biggest impact changes first
- Maximum 8 parameter suggestions`;

    const systemPrompt = `You are an expert AI sales coaching analyst. You analyze simulation test conversations and identify SPECIFIC parameter-level improvements for the setter's configuration.

${simulationConfigSection}

## CURRENT SETTER PARAMETERS
${paramListing || "(No parameters configured yet)"}

## SIMULATION CONVERSATIONS (${(personas || []).length} total)
${transcripts.join("\n")}
${userFeedbackSection}
## YOUR TASK
${taskInstructions}

CRITICAL RULES:
- For "select" type parameters: if the issue is that the WRONG option is selected, suggest switching to the other option AND provide the rewritten prompt for that option
- The "current_option" and "suggested_option" fields MUST contain the exact option VALUE ids from the parameter definition (e.g., "give_range", "redirect_to_call", "address_directly") — NEVER return the human label
- If no option change is needed, set "suggested_option" equal to the current option value
- Keep the same ## heading format in rewrites
- Each rewrite must be the COMPLETE replacement prompt, not a partial edit
- The parameter_label MUST match the exact label shown in the parameter definitions above`;

    const reportRequestBody = {
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Analyze the simulation results and return structured parameter improvement suggestions using the suggest_parameter_changes tool." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "suggest_parameter_changes",
            description: "Return suggested parameter rewrites based on simulation analysis",
            parameters: {
              type: "object",
              properties: {
                summary: {
                  type: "string",
                  description: "A 2-3 sentence executive summary of overall setter performance",
                },
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      config_key: {
                        type: "string",
                        description: "The exact config_key of the parameter to change (e.g., 'param_use_emojis', 'param_conversation_flow')",
                      },
                      parameter_label: {
                        type: "string",
                        description: "Human-readable label for the parameter — must match the exact label from the parameter definitions",
                      },
                      current_option: {
                        type: "string",
                        description: "The option value currently selected for this parameter (e.g., 'enabled', 'disabled', 'sparingly')",
                      },
                      suggested_option: {
                        type: "string",
                        description: "The option value to switch to. Use the current option value if no switch is needed, or a different option value if the selection should change (e.g., 'disabled' to switch from 'enabled' to 'disabled')",
                      },
                      reason: {
                        type: "string",
                        description: "Why this parameter needs changing, referencing specific conversation failures",
                      },
                      severity: {
                        type: "string",
                        enum: ["critical", "important", "minor"],
                        description: "How impactful this change is",
                      },
                      original_prompt: {
                        type: "string",
                        description: "The current prompt content for this parameter (for the currently selected option)",
                      },
                      suggested_prompt: {
                        type: "string",
                        description: "The complete rewritten prompt for the SUGGESTED option (this replaces the prompt for suggested_option)",
                      },
                    },
                    required: ["config_key", "parameter_label", "reason", "severity", "original_prompt", "suggested_prompt", "current_option", "suggested_option"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "suggestions"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "suggest_parameter_changes" } },
      max_tokens: 16000,
      temperature: 0.3,
    };

    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    if (!triggerSecretKey) throw new Error("TRIGGER_SECRET_KEY not configured");

    // Insert job row
    const { data: jobRow, error: insertError } = await supabase
      .from("ai_generation_jobs")
      .insert({
        client_id: clientId,
        job_type: "generate-simulation-report",
        status: "pending",
        input_payload: {
          messages: reportRequestBody.messages,
          tools: reportRequestBody.tools,
          tool_choice: reportRequestBody.tool_choice,
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

    // Trigger the Trigger.dev task
    const triggerResponse = await fetch("https://api.trigger.dev/api/v1/tasks/run-ai-job/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${triggerSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          job_id: jobId,
          client_id: clientId,
          job_type: "generate-simulation-report",
          messages: reportRequestBody.messages,
          tools: reportRequestBody.tools,
          tool_choice: reportRequestBody.tool_choice,
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

    console.log(`[generate-simulation-report] Job ${jobId} created for simulation ${simulationId}`);

    return new Response(JSON.stringify({ job_id: jobId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("generate-simulation-report error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
