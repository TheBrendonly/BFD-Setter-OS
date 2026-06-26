import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { loggedFetch } from "../_shared/request-logger.ts";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ConversationMessage {
  type: string;
  content: string;
  timestamp?: string;
}

interface Conversation {
  session_id?: string;
  client_id?: string;
  messages: ConversationMessage[];
  first_timestamp?: string;
}

/** Strip metadata/URLs/attachments to minimize tokens */
function compactContent(raw: string): string {
  if (!raw) return "";
  let t = raw;
  t = t.replace(/^#\s*USER\s*LAST\s*UTTERANCE\s*/i, "");
  t = t.split(/\s*(?:Attachment:\s*|#\s*USER\s*INPUT\s*ATTACH|\(FILES\/IMAGE\/AUDIO EXTRACTED CONTENT\):)/i)[0];
  t = t.replace(/^#\s*\w[\w\s]*\n?/gm, "");
  t = t.replace(/https?:\/\/\S+/gi, "");
  t = t.replace(/\.\w+\s+Audio\s+[\d\-]+\s+at\s+[\d.]+\.\w+/gi, "");
  t = t.replace(/\n{2,}/g, "\n").trim();
  return t;
}

/** Build compact text representation of conversations for AI */
function buildCompactConversations(conversations: Conversation[]): string {
  const lines: string[] = [];
  for (const conv of conversations) {
    const sid = conv.session_id || "unknown";
    for (let i = 0; i < conv.messages.length; i++) {
      const msg = conv.messages[i];
      const content = compactContent(msg.content);
      if (!content) continue;
      const ts = msg.timestamp || "";
      const role = msg.type === "human" || msg.type === "user" ? "user" : "ai";
      lines.push(`[${sid}|${i}|${ts}|${role}]: ${content}`);
    }
  }
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      client_id,
      metric_id,
      metric_prompt,
      metric_name,
      conversations,
      time_range,
    } = await req.json();

    // G3-6: the OpenRouter key is read server-side (never accepted from the
    // browser). client_id is now required so we can authorize + resolve the key.
    if (!client_id) {
      return new Response(
        JSON.stringify({ error: "client_id is required" }),
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

    if (!conversations || conversations.length === 0) {
      return new Response(
        JSON.stringify({ count: 0, matches: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve the client's OpenRouter key with the service role.
    const orSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: orClient, error: orClientErr } = await orSupabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", client_id)
      .maybeSingle();
    if (orClientErr || !orClient?.openrouter_api_key) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured for this client." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const openrouterApiKey = orClient.openrouter_api_key as string;

    // Build compact conversation text
    const compactText = buildCompactConversations(conversations);

    if (!compactText.trim()) {
      return new Response(
        JSON.stringify({ count: 0, matches: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are analyzing chat conversations. Your task is to find all messages matching the following criteria:

"${metric_prompt || metric_name}"

Each line of conversation data is formatted as: [session_id|message_index|timestamp|role]: message_content

Analyze each message and identify ALL messages that match the criteria. Use the provided tool to return your findings. Only return genuinely matching messages. Be precise.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "report_matches",
          description:
            "Report all messages that match the analysis criteria",
          parameters: {
            type: "object",
            properties: {
              matches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    session_id: { type: "string", description: "The session_id from the message line" },
                    message_index: { type: "number", description: "The message_index from the message line" },
                    timestamp: { type: "string", description: "The timestamp from the message line" },
                    snippet: { type: "string", description: "A brief excerpt of the matching content (max 100 chars)" },
                  },
                  required: ["session_id", "message_index", "timestamp"],
                  additionalProperties: false,
                },
              },
            },
            required: ["matches"],
            additionalProperties: false,
          },
        },
      },
    ];

    // Call OpenRouter
    const metricRequestBody = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: compactText },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "report_matches" } },
      temperature: 0,
    };

    const aiResponse = await loggedFetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metricRequestBody),
      },
      {
        client_id: client_id,
        request_type: "llm",
        source: "analyze-metric",
        method: "POST",
        request_body: metricRequestBody as unknown as Record<string, unknown>,
        model: "google/gemini-2.5-flash",
      }
    );

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("OpenRouter error:", aiResponse.status, errText);
      let userMessage = `OpenRouter error: ${aiResponse.status}`;
      if (aiResponse.status === 401) {
        userMessage = "OpenRouter API key is invalid or revoked (401). Please update your key on the Credentials page.";
      } else if (aiResponse.status === 402) {
        userMessage = "OpenRouter account has insufficient credits (402). Please add funds at openrouter.ai.";
      } else if (aiResponse.status === 429) {
        userMessage = "OpenRouter rate limit exceeded (429). Please wait a moment and try again.";
      }
      return new Response(
        JSON.stringify({ error: userMessage }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();

    // Extract tool call result
    let matches: any[] = [];
    const toolCalls = aiData?.choices?.[0]?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      try {
        const args = JSON.parse(toolCalls[0].function.arguments);
        matches = args.matches || [];
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e);
      }
    }

    const result = { count: matches.length, matches };

    // Cache results in Supabase if metric_id is provided
    if (metric_id && client_id) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Upsert: delete old cache for this metric+time_range, insert new
        await supabase
          .from("metric_analysis_results")
          .delete()
          .eq("metric_id", metric_id)
          .eq("client_id", client_id)
          .eq("time_range", time_range || "7");

        await supabase.from("metric_analysis_results").insert({
          metric_id,
          client_id,
          time_range: time_range || "7",
          results: matches,
          total_count: matches.length,
        });
      } catch (cacheErr) {
        console.error("Cache write failed (non-fatal):", cacheErr);
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-metric error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
