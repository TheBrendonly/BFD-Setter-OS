import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_MODEL = "google/gemini-2.5-pro";

const SYSTEM_PROMPT = `You are an expert AI sales setter configuration specialist. Your job is to take a company profile and generate personalized mini-prompts for all parameters in this setter configuration.

## YOUR TASK
You will receive:
1. Company name
2. Company knowledge base
3. Ideal Customer Profile
4. Agent goal & mission
5. Lead source (where leads come from)
6. Lead awareness (what leads already know)
7. All parameters for this setter configuration that need personalized mini-prompts

For EACH parameter, generate a personalized mini-prompt that:
- Personalization means: Write each prompt as if it was custom-built for THIS specific business. Use their industry's real vocabulary — the words their leads actually use. Reference the type of product/service they sell. If the lead source means leads come in warm vs cold, write the prompt to match that. The goal is that someone reading this prompt immediately knows it was written for THEIR business, not a generic template. You don't need to mention the company name in every prompt — just make sure every example, every tone reference, and every instruction reflects their specific world.
- Keeps the SAME structure and intent as the default prompt
- Replaces generic examples with industry-specific ones

## WRITING STYLE — THIS IS CRITICAL
- Write like you're explaining to a 15-year-old. Use SIMPLE, DIRECT words.
- Short sentences. No fluff. No filler. No corporate jargon.
- Say "talk" not "communicate". Say "ask" not "inquire". Say "help" not "facilitate".
- Say "find out" not "ascertain". Say "set up" not "establish". Say "use" not "utilize".
- If the prospect's industry has specific slang or terms that THEY would use daily, yes use those — but everything else stays dead simple.
- Every sentence should be an instruction: DO this. DON'T do that. SAY this. NEVER say that.
- Use **BOLD**, UPPERCASE, and markers like ✅ and ❌ to make rules impossible to miss.

## CRITICAL RULES
1. Return a JSON object where each key is a parameter key and the value is the personalized prompt text
2. For parameters with MULTIPLE OPTIONS: use compound keys in format "paramKey::optionValue" for EACH option. Every option MUST have its own personalized prompt.
3. For single-prompt parameters: use just the parameter key as the JSON key.
4. Every parameter key provided MUST have a corresponding output — do NOT skip any parameter or any option.
5. Do NOT change the fundamental instruction of any parameter, only personalize examples, tone references, and industry context
6. Keep formatting patterns when useful
7. Do NOT add new parameters or skip any
8. Keep prompts tight and efficient, do not add filler
9. Also output a "_selections" object where each key is a parameter name and the value is the recommended option key for that parameter. Include ALL parameters, even boolean ones (use "enabled" or "disabled"). This tells the UI which option to select for each parameter.

## RESPONSE FORMAT
Return ONLY a valid JSON object with the personalized prompts AND a "_selections" field. No markdown code blocks. No extra text.

Example structure:
{
  "agent_pronouns::first_person": "...prompt...",
  "agent_pronouns::we_person": "...prompt...",
  "be_blunt::enabled": "...prompt...",
  "be_blunt::disabled": "...prompt...",
  "_selections": {
    "agent_pronouns": "first_person",
    "be_blunt": "enabled",
    "conversation_flow": "discover_first",
    ...all other parameters...
  }
}`;

type IncomingParameterOption = {
  value: string;
  label: string;
  defaultPrompt: string;
};

type IncomingParameter = {
  key: string;
  label: string;
  currentPrompt: string;
  selectedOption: string;
  options?: IncomingParameterOption[];
};

const buildMessages = (
  companyName: string,
  companyKnowledge: string,
  idealCustomerProfile: string,
  agentGoal: string,
  agentMission: string,
  leadSource: string,
  leadAwareness: string,
  priorCommunications: string,
  parameters: IncomingParameter[],
  userNotes: string,
) => {
  const paramListText = parameters
    .map((p) => {
      if (p.options && p.options.length > 0) {
        const optionsText = p.options.map(
          (opt) => `  - Option "${opt.value}" (${opt.label}):
    Default prompt:
    ${opt.defaultPrompt}`
        ).join("\n\n");
        return `### ${p.key} (${p.label})
Currently selected: ${p.selectedOption}
This parameter has MULTIPLE options. Generate a personalized prompt for EACH option.
Use compound keys in your response: "${p.key}::optionValue" for each option.
Also include this parameter in the _selections object with your recommended option.

Options:
${optionsText}`;
      }

      return `### ${p.key} (${p.label})
Selected option: ${p.selectedOption}
Current default prompt:
${p.currentPrompt}`;
    })
    .join("\n\n");

  const notesSection = userNotes?.trim()
    ? `\n\n## USER NOTES\n${userNotes.trim()}\nTake this into special consideration — these are direct instructions from the person who knows this business best.`
    : '';

  const userPrompt = `Generate personalized mini-prompts for this AI setter configuration.

## COMPANY INFORMATION
Company Name: ${companyName || "Not specified"}

Company Knowledge Base:
${companyKnowledge || "Not provided"}

## IDEAL CUSTOMER PROFILE
${idealCustomerProfile || "Not specified"}

## AGENT GOAL
${agentGoal || "General engagement"}

## AGENT MISSION (in the user's own words)
${agentMission || "Not specified"}

## WHERE LEADS COME FROM
${leadSource || "Not specified"}

## WHAT LEADS ALREADY KNOW
${leadAwareness || "Not specified"}

## PREVIOUS COMMUNICATIONS WITH THE LEAD
${priorCommunications || "No prior contact specified"}${notesSection}

## PARAMETERS TO PERSONALIZE
${paramListText}

Return ONLY a valid JSON object where keys are parameter keys (and compound keys) and values are the personalized prompt strings. Include a "_selections" object mapping each parameter name to its recommended option value.
Do not wrap the JSON in markdown.
Do not add commentary before or after the JSON.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  console.log("[generate-setter-config] v2 — delegate to Trigger.dev");

  try {
    const {
      clientId,
      slotId,
      companyName,
      companyKnowledge,
      idealCustomerProfile,
      agentGoal,
      agentMission,
      leadSource,
      leadAwareness,
      priorCommunications,
      parameters,
      userNotes,
    } = await req.json();

    if (!clientId) {
      return new Response(JSON.stringify({ error: "Client ID is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!parameters || !Array.isArray(parameters) || parameters.length === 0) {
      return new Response(JSON.stringify({ error: "Parameters list is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server configuration error." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!triggerSecretKey) {
      return new Response(JSON.stringify({ error: "TRIGGER_SECRET_KEY not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate client exists and has OpenRouter key
    const { data: clientData, error: dbError } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", clientId)
      .single();

    if (dbError || !clientData) {
      return new Response(JSON.stringify({ error: "Client not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!clientData.openrouter_api_key) {
      return new Response(JSON.stringify({ error: "OpenRouter API key is not configured. Please add it in API Credentials." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize parameters
    const sanitizedParameters: IncomingParameter[] = (parameters as IncomingParameter[])
      .filter((param) => param?.key && (param?.currentPrompt || (param?.options && param.options.length > 0)))
      .map((param) => ({
        key: param.key,
        label: param.label || param.key,
        selectedOption: param.selectedOption || "default",
        currentPrompt: (param.currentPrompt || "").trim(),
        options: param.options?.map(opt => ({
          value: opt.value,
          label: opt.label || opt.value,
          defaultPrompt: (opt.defaultPrompt || "").trim(),
        })),
      }));

    if (sanitizedParameters.length === 0) {
      return new Response(JSON.stringify({ error: "No valid parameters were provided for generation." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build single messages array with all parameters
    const messages = buildMessages(
      companyName, companyKnowledge, idealCustomerProfile,
      agentGoal, agentMission || "", leadSource || "",
      leadAwareness || "", priorCommunications || "",
      sanitizedParameters, userNotes || "",
    );

    // Insert job row
    const { data: jobRow, error: insertError } = await supabase
      .from("ai_generation_jobs")
      .insert({
        client_id: clientId,
        job_type: "generate-setter-config",
        status: "pending",
        input_payload: {
          slotId: slotId || null,
          messages,
          max_tokens: 32000,
          temperature: 0.2,
          response_format: { type: "json_object" },
          sanitizedParameters,
          openrouter_api_key: clientData.openrouter_api_key,
        },
      })
      .select("id")
      .single();

    if (insertError || !jobRow) {
      console.error("Failed to insert ai_generation_jobs:", {
        error: insertError,
        clientId,
        parameterCount: sanitizedParameters.length,
      });
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
          job_type: "generate-setter-config",
          messages,
          max_tokens: 32000,
          temperature: 0.2,
          response_format: { type: "json_object" },
        },
      }),
    });

    const triggerText = await triggerResponse.text();
    let triggerData: Record<string, unknown> | null = null;

    try {
      triggerData = triggerText ? JSON.parse(triggerText) : null;
    } catch {
      triggerData = null;
    }

    if (!triggerResponse.ok) {
      console.error("Trigger.dev error:", {
        status: triggerResponse.status,
        statusText: triggerResponse.statusText,
        body: triggerText,
        jobId,
        clientId,
      });

      await supabase.from("ai_generation_jobs").update({
        status: "failed",
        error_message: `Failed to trigger AI job: ${triggerResponse.status}`,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);

      throw new Error("Failed to trigger AI job processing");
    }

    console.log(`[generate-setter-config] Job ${jobId} created and triggered (run ${(triggerData?.id as string | undefined) || "unknown"}) for ${sanitizedParameters.length} params`);

    return new Response(JSON.stringify({ job_id: jobId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-setter-config error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
