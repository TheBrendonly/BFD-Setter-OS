import { createClient } from "npm:@supabase/supabase-js@2";
import { loggedFetch } from "../_shared/request-logger.ts";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SMART_MODEL = "anthropic/claude-sonnet-4";

/** Strip metadata/URLs/attachments to minimize tokens */
function compactContent(raw: string): string {
  if (!raw) return "";
  let t = raw;
  t = t.replace(/^#\s*USER\s*LAST\s*UTTERANCE\s*/i, "");
  t = t.split(/\s*(?:Attachment:\s*|#\s*USER\s*INPUT\s*ATTACH|\(FILES\/IMAGE\/AUDIO EXTRACTED CONTENT\):)/i)[0];
  t = t.replace(/^#\s*\w[\w\s]*\n?/gm, "");
  t = t.replace(/https?:\/\/\S+/gi, "");
  t = t.replace(/\n{2,}/g, "\n").trim();
  return t;
}

interface WidgetRequest {
  id: string;
  name: string;
  prompt: string;
  widget_type: string;
}

function getFormattingTool(widgetType: string) {
  const baseTool = {
    type: "function" as const,
    function: {
      name: "format_chart",
      description: "",
      parameters: { type: "object", properties: {} as Record<string, any>, required: [] as string[], additionalProperties: false },
    },
  };

  switch (widgetType) {
    case "number_card":
      baseTool.function.description = "Format the analysis as a single number with a label";
      baseTool.function.parameters.properties = {
        value: { type: "number", description: "The numeric result" },
        label: { type: "string", description: "Short descriptive label" },
      };
      baseTool.function.parameters.required = ["value", "label"];
      break;
    case "line":
      baseTool.function.description = "Format the analysis as time-series data points for a line chart";
      baseTool.function.parameters.properties = {
        data_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
              value: { type: "number", description: "Value for this date" },
            },
            required: ["date", "value"],
            additionalProperties: false,
          },
        },
      };
      baseTool.function.parameters.required = ["data_points"];
      break;
    case "bar_vertical":
    case "bar_horizontal":
      baseTool.function.description = "Format the analysis as named categories with values for a bar chart";
      baseTool.function.parameters.properties = {
        data_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Category or label name" },
              value: { type: "number", description: "Value for this category" },
            },
            required: ["name", "value"],
            additionalProperties: false,
          },
        },
      };
      baseTool.function.parameters.required = ["data_points"];
      break;
    case "doughnut":
      baseTool.function.description = "Format the analysis as segments for a donut/pie chart";
      baseTool.function.parameters.properties = {
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Segment label" },
              value: { type: "number", description: "Segment value" },
            },
            required: ["name", "value"],
            additionalProperties: false,
          },
        },
      };
      baseTool.function.parameters.required = ["segments"];
      break;
    case "text":
      baseTool.function.description = "Format the analysis as readable text content";
      baseTool.function.parameters.properties = {
        content: { type: "string", description: "The formatted text content (can use markdown)" },
      };
      baseTool.function.parameters.required = ["content"];
      break;
    default:
      baseTool.function.description = "Format the analysis result";
      baseTool.function.parameters.properties = {
        value: { type: "number" },
        label: { type: "string" },
      };
      baseTool.function.parameters.required = ["value"];
  }

  return baseTool;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, widgets, date_from, date_to, model } = await req.json();

    if (!client_id) {
      return new Response(
        JSON.stringify({ error: "client_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!widgets || widgets.length === 0) {
      return new Response(
        JSON.stringify({ error: "At least one widget is required" }),
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

    // Get client configuration from our DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("supabase_url, supabase_service_key, supabase_table_name, openrouter_api_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!client.supabase_url || !client.supabase_service_key) {
      return new Response(
        JSON.stringify({ error: "Client Supabase credentials not configured. Please update them on the Credentials page." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!client.openrouter_api_key) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured. Please update it on the Credentials page." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tableName = client.supabase_table_name || "chat_history";
    const userModel = model || "google/gemini-2.5-pro";

    // Connect to external Supabase and fetch conversations
    const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);

    // Probe for timestamp column
    let timestampColumn = "timestamp";
    const candidates = ["timestamp", "created_at", "time", "date"];
    for (const col of candidates) {
      const { error: probeError } = await externalSupabase
        .from(tableName)
        .select(col)
        .limit(1);
      if (!probeError) {
        timestampColumn = col;
        break;
      }
    }

    console.log(`Using timestamp column: ${timestampColumn}, table: ${tableName}`);

    // Fetch messages within date range (paginate up to 5000)
    const allMessages: any[] = [];
    const pageSize = 1000;
    for (let page = 0; page < 5; page++) {
      const { data, error } = await externalSupabase
        .from(tableName)
        .select("id, session_id, message, " + timestampColumn)
        .gte(timestampColumn, date_from)
        .lte(timestampColumn, date_to)
        .order(timestampColumn, { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error("External Supabase query error:", error);
        return new Response(
          JSON.stringify({ error: `Failed to query chat_history: ${error.message}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!data || data.length === 0) break;
      allMessages.push(...data);
      if (data.length < pageSize) break;
    }

    if (allMessages.length === 0) {
      // Return empty results for all widgets
      const emptyResults: Record<string, any> = {};
      for (const w of widgets as WidgetRequest[]) {
        emptyResults[w.id] = { chart_data: null, message: "No conversations found in this date range." };
      }
      return new Response(JSON.stringify({ results: emptyResults }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Fetched ${allMessages.length} messages from external Supabase`);

    // Group messages by session_id into conversations
    const conversationMap = new Map<string, Array<{ type: string; content: string; timestamp: string }>>();
    for (const row of allMessages) {
      const sessionId = row.session_id || "unknown";
      const msg = row.message || {};
      const msgType = msg.type || "unknown";
      const content = compactContent(msg.content || "");
      const ts = row[timestampColumn] || "";

      if (!content) continue;

      if (!conversationMap.has(sessionId)) {
        conversationMap.set(sessionId, []);
      }
      conversationMap.get(sessionId)!.push({ type: msgType, content, timestamp: ts });
    }

    // Build compact text for AI analysis
    const compactLines: string[] = [];
    for (const [sid, msgs] of conversationMap) {
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        const role = m.type === "human" || m.type === "user" ? "user" : "ai";
        compactLines.push(`[${sid}|${i}|${m.timestamp}|${role}]: ${m.content}`);
      }
    }
    const compactText = compactLines.join("\n");

    // Truncate if too long (rough token estimate: 4 chars per token, limit ~100K tokens)
    const maxChars = 400000;
    const truncatedText = compactText.length > maxChars
      ? compactText.slice(0, maxChars) + "\n[... truncated due to length]"
      : compactText;

    const totalConversations = conversationMap.size;
    const totalMessages = allMessages.length;

    // Process each widget
    const results: Record<string, any> = {};

    for (const widget of widgets as WidgetRequest[]) {
      try {
        console.log(`Processing widget: ${widget.name} (${widget.widget_type})`);

        // Step 1: Analyze conversations with user's model
        const analysisPrompt = `You are analyzing ${totalConversations} chatbot conversations (${totalMessages} total messages) from ${date_from} to ${date_to}.

Task: ${widget.prompt}

Each line is formatted as: [session_id|message_index|timestamp|role]: message_content

Provide a thorough analysis. Include specific numbers, counts, and examples where relevant. If tracking trends over time, break down by date.

Conversations:
${truncatedText}`;

        const step1RequestBody = {
            model: userModel,
            messages: [
              { role: "system", content: "You are a precise analytics assistant. Analyze conversations and provide accurate counts and insights." },
              { role: "user", content: analysisPrompt },
            ],
            temperature: 0,
            max_tokens: 4000,
        };
        const step1Response = await loggedFetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${client.openrouter_api_key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(step1RequestBody),
          },
          {
            client_id,
            request_type: "llm",
            source: "analytics-v2-process-step1",
            method: "POST",
            request_body: step1RequestBody as unknown as Record<string, unknown>,
            model: userModel,
          }
        );

        if (!step1Response.ok) {
          const errText = await step1Response.text();
          console.error(`Step 1 error for ${widget.name}:`, step1Response.status, errText);
          let msg = `Analysis failed (${step1Response.status})`;
          if (step1Response.status === 401) msg = "OpenRouter API key is invalid or revoked (401).";
          else if (step1Response.status === 402) msg = "Insufficient OpenRouter credits (402).";
          else if (step1Response.status === 429) msg = "Rate limit exceeded (429). Try again shortly.";
          results[widget.id] = { chart_data: null, error: msg };
          continue;
        }

        const step1Data = await step1Response.json();
        const rawAnalysis = step1Data?.choices?.[0]?.message?.content || "";

        if (!rawAnalysis) {
          results[widget.id] = { chart_data: null, error: "AI returned empty analysis" };
          continue;
        }

        // Step 2: Format with Claude for the specific widget type
        const formattingTool = getFormattingTool(widget.widget_type);
        const formatPrompt = `Based on the following analysis of chatbot conversations from ${date_from} to ${date_to}, format the data for a "${widget.widget_type}" widget.

${widget.widget_type === "line" ? `IMPORTANT: For line charts, provide one data point per day within the date range. Use YYYY-MM-DD format for dates. If no data exists for a day, use 0.` : ""}
${widget.widget_type === "doughnut" ? `IMPORTANT: For donut charts, provide meaningful segments that represent proportions of the whole.` : ""}
${widget.widget_type === "bar_vertical" || widget.widget_type === "bar_horizontal" ? `IMPORTANT: Provide clear category names and their numeric values.` : ""}
${widget.widget_type === "text" ? `IMPORTANT: Format as clean, readable markdown text. Use numbered lists for rankings.` : ""}
${widget.widget_type === "number_card" ? `IMPORTANT: Extract the single most relevant number and a short descriptive label.` : ""}

Analysis:
${rawAnalysis}

Use the format_chart tool to return the properly formatted data.`;

        const step2RequestBody = {
            model: SMART_MODEL,
            messages: [
              { role: "system", content: "You are a data formatting specialist. Convert analysis results into structured chart data. Be precise with numbers." },
              { role: "user", content: formatPrompt },
            ],
            tools: [formattingTool],
            tool_choice: { type: "function", function: { name: "format_chart" } },
            temperature: 0,
        };
        const step2Response = await loggedFetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${client.openrouter_api_key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(step2RequestBody),
          },
          {
            client_id,
            request_type: "llm",
            source: "analytics-v2-process-step2",
            method: "POST",
            request_body: step2RequestBody as unknown as Record<string, unknown>,
            model: SMART_MODEL,
          }
        );

        if (!step2Response.ok) {
          const errText = await step2Response.text();
          console.error(`Step 2 error for ${widget.name}:`, step2Response.status, errText);
          // Fall back to raw analysis as text
          results[widget.id] = {
            chart_data: { content: rawAnalysis },
            widget_type_override: "text",
            error: `Formatting failed, showing raw analysis`,
          };
          continue;
        }

        const step2Data = await step2Response.json();
        let chartData: any = null;

        const toolCalls = step2Data?.choices?.[0]?.message?.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          try {
            chartData = JSON.parse(toolCalls[0].function.arguments);
          } catch (e) {
            console.error("Failed to parse chart data:", e);
          }
        }

        if (!chartData) {
          // Fallback: try to use the text content
          const textContent = step2Data?.choices?.[0]?.message?.content || rawAnalysis;
          chartData = { content: textContent };
          results[widget.id] = { chart_data: chartData, widget_type_override: "text" };
        } else {
          results[widget.id] = { chart_data: chartData };
        }

        console.log(`Widget ${widget.name} processed successfully`);
      } catch (widgetError) {
        console.error(`Error processing widget ${widget.name}:`, widgetError);
        results[widget.id] = {
          chart_data: null,
          error: widgetError instanceof Error ? widgetError.message : "Processing failed",
        };
      }
    }

    return new Response(JSON.stringify({ results, total_conversations: totalConversations, total_messages: totalMessages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analytics-v2-process error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
