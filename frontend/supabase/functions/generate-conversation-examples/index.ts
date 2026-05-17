import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { loggedFetch } from "../_shared/request-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_MODEL = "google/gemini-2.5-pro";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId, fullPrompt } = await req.json();

    if (!clientId) {
      return new Response(JSON.stringify({ error: "Client ID is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Server configuration error." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
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

    const openrouterApiKey = clientData.openrouter_api_key;
    if (!openrouterApiKey) {
      return new Response(JSON.stringify({ error: "OpenRouter API key is not configured. Please add it in API Credentials." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert AI prompt engineer specializing in crafting hyper-realistic conversation examples for AI sales setters.

Your job: Generate exactly 3 conversation examples between a lead (USER) and an AI setter (SETTER). These examples will be embedded directly into the setter's system prompt as behavioral references. They are the MOST IMPORTANT part of the entire prompt because they teach the AI exactly how to talk, respond, and handle real situations.

## CRITICAL: WHAT YOU MUST DO

1. **READ THE FULL PROMPT CAREFULLY.** You will receive the complete setter configuration prompt below. Every single detail matters:
   - The IDENTITY section tells you WHO the setter is (name, role)
   - The LEAD CONTEXT tells you WHERE leads come from, what they ALREADY KNOW, and any PREVIOUS CONVERSATIONS
   - The AGENT GOAL tells you the EXACT objective (booking appointments, nurturing, selling, etc.) DO NOT invent goals that are not specified
   - The PERSONALITY & STYLE tells you HOW to talk (tone, emoji usage, grammar, formality, slang)
   - The CONVERSATION STRATEGY tells you the approach (questioning techniques, objection handling, etc.)
   - The GUARDRAILS tell you what to NEVER do
   - The COMPANY section tells you the business details, ICP, and knowledge base

2. **MATCH THE LANGUAGE EXACTLY.** If the setter is configured to be informal with slang and emojis, the examples MUST use that exact style. If formal, be formal. If the setter uses specific phrases or patterns described in the prompt, USE THEM in the examples.

3. **RESPECT THE GOAL.** If the goal is to book appointments, every conversation must naturally flow toward booking. If the goal is nurturing, conversations should build trust and provide value. DO NOT randomly include appointment booking if it is not the goal. DO NOT randomly include product pitching if that is not the strategy.

4. **CONSIDER WHO STARTS THE CONVERSATION.** Based on the lead context:
   - If leads come from inbound inquiries (ads, forms, website) the USER typically starts
   - If this is outbound/reactivation, the SETTER typically starts with a contextual opener
   - If previous communications exist, the SETTER may reference them
   - Mix these up across the 3 examples based on what makes sense for the configured scenario

5. **REFLECT THE ICP.** The ideal customer profile tells you WHO the lead is. Their language, concerns, objections, and questions should match this demographic.

6. **USE THE KNOWLEDGE BASE.** When the setter answers questions about the business, products, or services, the answers MUST come from the company knowledge base provided in the prompt. Do not make up features or details.

## FORMAT RULES

- Each conversation must be between 6 and 15 messages total (mix of USER and SETTER messages)
- The length should vary across the 3 examples (e.g., one shorter at 6-8, one medium at 9-11, one longer at 12-15)
- Format each message on its own line with the label in UPPERCASE: "USER:" or "SETTER:"
- Leave one blank line between each message for visual clarity
- Separate each of the 3 conversations with the exact divider on its own line: ── ──
- No dashes or em dashes anywhere in the output
- Make the conversations feel like REAL text/chat conversations, not scripted or generic
- Each conversation should demonstrate a DIFFERENT scenario or lead type while staying within the configured goal
- Show realistic objections, questions, and natural conversation flow
- The setter should demonstrate the exact questioning techniques, response patterns, and personality traits described in the prompt`;

    let userPrompt = `Here is the complete setter prompt. Generate 3 conversation examples that perfectly demonstrate how this setter should behave in real conversations. Every aspect of the examples (language, tone, goal, strategy, knowledge) must be derived from this prompt:

## FULL SETTER PROMPT:

${fullPrompt?.trim() || '(No prompt provided)'}

──

Now generate 3 realistic conversation examples. Remember:
- Match the EXACT tone, personality, and language style from the prompt
- Only pursue the goals that are ACTUALLY configured (do not invent goals)
- Consider lead source, what leads already know, and any previous communication context
- Vary who starts the conversation based on the scenario
- Vary the length (6-15 messages each)
- Make each example showcase a different realistic scenario within the configured goal
- Use information from the company knowledge base when the setter answers questions`;

    const aiRequestBody = {
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
    };
    const response = await loggedFetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://1prompt.ai",
          "X-Title": "1Prompt AI Conversation Examples Generator",
        },
        body: JSON.stringify(aiRequestBody),
      },
      {
        client_id: clientId,
        request_type: "llm",
        source: "generate-conversation-examples",
        method: "POST",
        request_body: aiRequestBody as unknown as Record<string, unknown>,
        model: AI_MODEL,
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits to your OpenRouter account." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("OpenRouter error:", response.status, t);
      return new Response(JSON.stringify({ error: "Failed to generate examples" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";
    // Normalize any --- separators to the standard short dash divider
    content = content.replace(/\n*-{3,}\n*/g, '\n\n── ──\n\n');

    return new Response(JSON.stringify({ examples: content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-conversation-examples error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
