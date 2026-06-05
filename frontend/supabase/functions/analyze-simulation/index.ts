import { createClient } from "npm:@supabase/supabase-js@2";
import { loggedFetch } from "../_shared/request-logger.ts";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { simulationId, question, threadId, clientId } = await req.json();

    if (!simulationId || !question || !clientId) {
      return new Response(JSON.stringify({ error: "Missing required parameters: simulationId, question, clientId" }), {
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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get client's OpenRouter API key
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", clientId)
      .single();

    if (clientErr || !client?.openrouter_api_key) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured. Please add it in Settings → Credentials." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openrouterKey = client.openrouter_api_key;

    // 2. Fetch simulation details
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

    // 3. Fetch all personas and their messages
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

    // 4. Build conversation transcripts
    const conversationTranscripts: string[] = [];
    for (const persona of (personas || [])) {
      const personaMessages = allMessages.filter((m: any) => m.persona_id === persona.id);
      if (personaMessages.length === 0) continue;

      let transcript = `--- CONVERSATION WITH: ${persona.name} ---\n`;
      transcript += `Profile: ${persona.age}y, ${persona.gender}, ${persona.occupation}\n`;
      transcript += `Problem: ${persona.problem || 'N/A'}\n`;
      transcript += `Goal: ${persona.goal || 'N/A'}\n`;
      transcript += `Status: ${persona.status}\n`;
      if (persona.booking_intent && persona.booking_intent !== 'none') {
        transcript += `Booking Intent: ${persona.booking_intent}\n`;
      }
      transcript += `\n`;

      for (const msg of personaMessages) {
        const role = msg.role === 'user' ? persona.name : 'SETTER';
        transcript += `[${role}]: ${msg.content || '(empty)'}\n`;
      }
      transcript += `--- END CONVERSATION ---\n\n`;
      conversationTranscripts.push(transcript);
    }

    // 5. Fetch the setter's full prompt from prompt_configurations
    const slotId = `Setter-${simulation.agent_number}`;
    const { data: promptConfigs } = await supabase
      .from("prompt_configurations")
      .select("config_key, custom_content, selected_option")
      .eq("client_id", clientId)
      .eq("slot_id", slotId);

    let setterPrompt = "";
    if (promptConfigs && promptConfigs.length > 0) {
      const parts = promptConfigs
        .filter((pc: any) => pc.custom_content?.trim())
        .map((pc: any) => pc.custom_content.trim());
      setterPrompt = parts.join("\n\n── ── ── ── ── ── ── ── ── ── ── ── ── ──\n\n");
    }

    // Also try the prompts table as fallback
    if (!setterPrompt) {
      const { data: prompts } = await supabase
        .from("prompts")
        .select("content")
        .eq("client_id", clientId)
        .eq("slot_id", slotId)
        .eq("is_active", true)
        .limit(1);
      if (prompts && prompts.length > 0 && prompts[0].content) {
        setterPrompt = prompts[0].content;
      }
    }

    // 6. Fetch existing chat history for this thread
    let chatHistory: { role: string; content: string }[] = [];
    if (threadId) {
      const { data: existingMsgs } = await supabase
        .from("simulation_analysis_messages")
        .select("role, content")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      chatHistory = (existingMsgs || []).map((m: any) => ({
        role: m.role,
        content: m.content || "",
      }));
    }

    // 7. Build system prompt
    const totalPersonas = (personas || []).length;
    const completedPersonas = (personas || []).filter((p: any) => p.status === "complete").length;
    const errorPersonas = (personas || []).filter((p: any) => p.status === "error").length;

    const systemPrompt = `You are an expert AI sales coaching analyst. Your job is to analyze simulation test results for a text-based AI sales setter and provide actionable insights to improve the setter's performance.

## CONTEXT

You have access to:
1. **The Setter's Full Prompt** — the complete instructions that guide how the AI setter behaves in conversations.
2. **All Simulation Conversations** — ${totalPersonas} test conversations (${completedPersonas} completed, ${errorPersonas} errors) with diverse AI-generated personas simulating real leads.
3. **Simulation Config** — Business info: ${simulation.business_info || 'Not provided'}

## SETTER PROMPT (ACTIVE CONFIGURATION)
${setterPrompt ? `\`\`\`\n${setterPrompt}\n\`\`\`` : "(No setter prompt found — the configuration may not be saved yet.)"}

## SIMULATION CONVERSATIONS
${conversationTranscripts.join("\n")}

## YOUR CAPABILITIES
- Analyze conversation quality, objection handling, engagement, and conversion patterns
- Identify specific weaknesses in the setter's prompt that led to poor outcomes
- Suggest concrete, copy-paste-ready prompt modifications
- Compare different conversation outcomes and explain what worked vs what didn't
- Provide statistical summaries (e.g., "3 out of 5 conversations failed to handle pricing objections")
- Use tables and structured formatting for clarity

## RESPONSE GUIDELINES
- Be specific — reference exact conversation excerpts when making points
- Be actionable — every insight should come with a concrete suggestion
- Use markdown formatting: tables, bold, headers, bullet points
- When suggesting prompt changes, show the BEFORE and AFTER text
- If the user asks about a specific conversation, focus on that one
- Keep responses thorough but organized — use headers to structure your analysis`;

    // 8. Build messages array
    const llmMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: question },
    ];

    // 9. Call OpenRouter with Claude Sonnet 4
    const analysisRequestBody = {
      model: "anthropic/claude-sonnet-4",
      messages: llmMessages,
      max_tokens: 4000,
      temperature: 0.3,
    };

    const openRouterResponse = await loggedFetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(analysisRequestBody),
      },
      {
        client_id: clientId,
        request_type: "llm",
        source: "analyze-simulation",
        method: "POST",
        request_body: analysisRequestBody as unknown as Record<string, unknown>,
        model: "anthropic/claude-sonnet-4",
      }
    );

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      console.error("OpenRouter error:", openRouterResponse.status, errorText);

      if (openRouterResponse.status === 401) {
        return new Response(JSON.stringify({ error: "Invalid or revoked OpenRouter API key. Please check your credentials." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (openRouterResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Insufficient OpenRouter credits. Please top up your account." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (openRouterResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment and try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: `AI analysis failed: ${openRouterResponse.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await openRouterResponse.json();
    const answer = data.choices?.[0]?.message?.content || "No response generated.";

    return new Response(JSON.stringify({ success: true, answer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("analyze-simulation error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
