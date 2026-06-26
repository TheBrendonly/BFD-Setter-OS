import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { loggedFetch } from "../_shared/request-logger.ts";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SMART_MODEL = "anthropic/claude-sonnet-4";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, client_id } = await req.json();

    // G3-6: the OpenRouter key is read server-side (never accepted from the
    // browser). client_id is required so we can authorize + resolve the key.
    if (!client_id) {
      return new Response(
        JSON.stringify({ error: "client_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!prompt || !prompt.trim()) {
      return new Response(
        JSON.stringify({ error: "Metric description is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: clientData, error: clientErr } = await admin
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr || !clientData?.openrouter_api_key) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured for this client." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const openrouter_api_key = clientData.openrouter_api_key as string;

    const systemPrompt = `You are an analytics visualization expert. A user wants to create a metric widget for their AI chatbot analytics dashboard. Based on their description of what they want to track, suggest exactly 3 visualization types that would best represent this data.

Available widget types:
- "number_card": A single large number. Best for simple counts, totals, or averages.
- "line": A line chart with dates on X-axis. Best for trends over time.
- "bar_vertical": Vertical bar chart. Best for comparing categories or daily breakdowns.
- "bar_horizontal": Horizontal bar chart. Best for ranked lists or comparisons with long labels.
- "doughnut": A donut/pie chart. Best for showing proportions or percentages of a whole.
- "text": Plain text display. Best for lists, summaries, top-N items, or qualitative insights that cannot be quantified into a single number or chart.

Rules:
- Suggest exactly 3 different widget types, ranked from most recommended to least.
- Each suggestion should be genuinely useful for the described metric.
- Don't suggest types that can't meaningfully represent the data.
- For metrics asking "how many" or counts, number_card + line + bar are usually good.
- For metrics asking for lists, rankings, or qualitative data, text should be the top suggestion.
- For metrics about proportions/splits, doughnut should be included.

Use the provided tool to return your suggestions.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "suggest_widgets",
          description: "Return 3 widget type suggestions for the metric",
          parameters: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: ["number_card", "line", "bar_vertical", "bar_horizontal", "doughnut", "text"],
                    },
                    title: { type: "string", description: "Short title for this visualization option (3-6 words)" },
                    description: { type: "string", description: "Brief explanation of why this visualization works (1-2 sentences)" },
                  },
                  required: ["type", "title", "description"],
                  additionalProperties: false,
                },
                minItems: 3,
                maxItems: 3,
              },
            },
            required: ["suggestions"],
            additionalProperties: false,
          },
        },
      },
    ];

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouter_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SMART_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Metric description: "${prompt}"` },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "suggest_widgets" } },
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("OpenRouter error:", aiResponse.status, errText);
      let userMessage = `OpenRouter error: ${aiResponse.status}`;
      if (aiResponse.status === 401) userMessage = "OpenRouter API key is invalid or revoked (401). Please update your key on the Credentials page.";
      else if (aiResponse.status === 402) userMessage = "OpenRouter account has insufficient credits (402). Please add funds at openrouter.ai.";
      else if (aiResponse.status === 429) userMessage = "OpenRouter rate limit exceeded (429). Please wait a moment and try again.";
      return new Response(
        JSON.stringify({ error: userMessage }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    let suggestions: any[] = [];

    const toolCalls = aiData?.choices?.[0]?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      try {
        const args = JSON.parse(toolCalls[0].function.arguments);
        suggestions = args.suggestions || [];
      } catch (e) {
        console.error("Failed to parse tool call:", e);
      }
    }

    // Fallback if AI didn't return proper suggestions
    if (suggestions.length === 0) {
      suggestions = [
        { type: "number_card", title: "Simple Count", description: "Shows a single number for quick reference." },
        { type: "line", title: "Trend Over Time", description: "Line chart showing daily values across the date range." },
        { type: "bar_vertical", title: "Bar Comparison", description: "Bar chart for visual comparison." },
      ];
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-widgets error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
