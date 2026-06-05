import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId, agentNumber, freeInput } = await req.json();

    if (!clientId || !agentNumber) {
      return new Response(JSON.stringify({ error: "Missing clientId or agentNumber" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    if (!triggerSecretKey) throw new Error("TRIGGER_SECRET_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    // 1. Fetch the setter's full prompt
    const slotId = `Setter-${agentNumber}`;
    let setterPrompt = "";

    const { data: prompts } = await supabase
      .from("prompts")
      .select("content")
      .eq("client_id", clientId)
      .eq("slot_id", slotId)
      .eq("is_active", true)
      .limit(1);
    if (prompts && prompts.length > 0 && (prompts as any[])[0].content) {
      setterPrompt = (prompts as any[])[0].content;
    }

    if (!setterPrompt) {
      const { data: promptConfigs } = await supabase
        .from("prompt_configurations")
        .select("config_key, custom_content, selected_option")
        .eq("client_id", clientId)
        .eq("slot_id", slotId);
      if (promptConfigs && promptConfigs.length > 0) {
        const parts = (promptConfigs as any[])
          .filter((pc) => pc.custom_content?.trim())
          .map((pc) => pc.custom_content.trim());
        setterPrompt = parts.join("\n\n── ── ── ── ── ──\n\n");
      }
    }

    if (!setterPrompt) {
      const { data: clientData } = await supabase
        .from("clients")
        .select("system_prompt")
        .eq("id", clientId)
        .single();
      if (clientData?.system_prompt) {
        setterPrompt = clientData.system_prompt;
      }
    }

    // 2. Fetch agent settings
    const { data: agentSettings } = await supabase
      .from("agent_settings")
      .select("model, booking_function_enabled, booking_prompt")
      .eq("client_id", clientId)
      .eq("slot_id", slotId)
      .single();

    // 3. Build the AI prompt
    const systemPrompt = `You are a simulation configuration AI. Your job is to deeply analyze a text setter's full prompt and generate highly specific, personalized ICP (Ideal Customer Profile) configurations for simulation testing.

## IMPORTANT: ICP vs PERSONA DISTINCTION
An ICP describes a GROUP/SEGMENT of people — NOT a single person. You are defining categories of customers.
In the NEXT step, individual personas (Sarah, John, etc.) will be generated FROM each ICP.
So everything you write must describe the GROUP, using plural language ("these people", "they typically", "customers in this segment").

## YOUR TASK
Analyze the setter prompt below in detail. Extract:
- The business name, industry, and exact services/products offered
- Pricing details, packages, and offers mentioned
- Target audience characteristics
- Common objections the setter is trained to handle
- The setter's sales approach, tone, and strategies
- Any booking/scheduling workflows
- Lead sources and marketing channels mentioned

Then generate ICP profiles that are SPECIFIC to this exact business.

## LANGUAGE RULES
- Write like you're explaining to a smart 15-year-old. Keep it simple and direct.
- No fluff, no filler words, no corporate speak.
- If the industry requires technical jargon (medical, legal, SaaS), use it — but explain it simply.
- Short sentences. Get to the point.
- Use real numbers, real examples from the prompt.

## SETTER PROMPT
${setterPrompt ? "```\n" + setterPrompt + "\n```" : "(No prompt configured yet)"}

## SETTER SETTINGS
- Model: ${agentSettings?.model || 'Not configured'}
- Booking Function: ${agentSettings?.booking_function_enabled ? 'Enabled' : 'Disabled'}

${freeInput ? "## USER'S TESTING GOALS\n" + freeInput : ''}

## OUTPUT FORMAT
Return a JSON object with this exact structure:
{
  "icps": [
    {
      "name": "Short, specific segment name referencing the business, MAX 20 CHARACTERS",
      "description": "3-5 sentences describing this GROUP of people.",
      "persona_count": 3,
      "age_min": 25,
      "age_max": 55,
      "gender": "any",
      "location": "REQUIRED — Specific location relevant to the business. NEVER leave empty.",
      "behaviors": ["friendly", "skeptical", "brief"],
      "first_message_sender": "inbound",
      "first_message_detail": "Describe how people in this ICP typically START the conversation.",
      "form_fields": "",
      "outreach_message": "",
      "lead_trigger": "What brings this group of people in.",
      "lead_knowledge": "What do people in this segment typically know before the conversation?",
      "concerns": "The common worries and objections this group shares.",
      "scenario_items": ["Specific objection to test"],
      "test_booking": false,
      "booking_count": 0
    }
  ],
  "business_info": "Extracted business context",
  "min_messages": 4,
  "max_messages": 8
}

## CRITICAL RULES
1. Generate 1-4 ICPs based on the setter's prompt content
2. EVERY description must use PLURAL language
3. Each ICP MUST reference specific details from the setter prompt
4. ICP names MUST be 20 characters or less
5. first_message_sender options: "inbound", "engagement", "outreach_response", "custom"
6. Behaviors from: friendly, skeptical, inquisitive, brief, detailed, distracted, aggressive, impatient, indecisive, price_sensitive
7. persona_count per ICP: 2-5
8. If the setter has booking functionality, set test_booking=true for at least one ICP
9. age_min >= 18, age_max <= 75
10. EVERY FIELD IS REQUIRED — NEVER leave any field empty
11. Return ONLY the JSON object, no markdown fences, no explanation`;

    const userPrompt = freeInput
      ? `Analyze this setter and generate ICP profiles. The user wants to test: ${freeInput}`
      : `Analyze this setter and generate the optimal ICP profiles for comprehensive simulation testing.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    // Insert job row
    const { data: jobRow, error: insertError } = await supabase
      .from("ai_generation_jobs")
      .insert({
        client_id: clientId,
        job_type: "generate-simulation-config",
        status: "pending",
        input_payload: {
          messages,
          max_tokens: undefined,
          temperature: 0.7,
          response_format: undefined,
          agent_number: agentNumber,
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
          job_type: "generate-simulation-config",
          messages,
          temperature: 0.7,
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

    console.log(`[generate-simulation-config] Job ${jobId} created for setter ${agentNumber}`);

    return new Response(JSON.stringify({ job_id: jobId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-simulation-config error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
