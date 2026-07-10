import { loggedFetch } from "../_shared/request-logger.ts";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface FormatRequest {
  client_id: string;
  metric_name: string;
  metric_prompt: string;
  widget_type: string;
  time_range: string;
  start_date?: string;
  end_date?: string;
  raw_webhook_data: any;
  conversations_list?: any[];
}

// ── Helpers: extract real data from webhook before AI ──

/** Recursively unwrap JSON string payloads (common n8n pattern) */
function deepUnwrap(data: any): any {
  if (typeof data === "string") {
    try { return deepUnwrap(JSON.parse(data)); } catch { return data; }
  }
  return data;
}

/** Extract pre-computed widget data keyed by lowercase title */
function extractWidgetMap(parsed: any): Record<string, any> {
  const map: Record<string, any> = {};
  const widgets = parsed?.widgets || parsed?.data?.widgets || [];
  if (Array.isArray(widgets)) {
    for (const w of widgets) {
      if (w?.title) {
        map[w.title.toLowerCase().trim()] = w;
      }
    }
  }
  const defaults = parsed?.default_metrics || parsed?.data?.default_metrics || [];
  if (Array.isArray(defaults)) {
    for (const d of defaults) {
      if (d?.title) {
        map[d.title.toLowerCase().trim()] = d;
      }
    }
  }
  return map;
}

/** Try to extract pre-computed chart data for a metric directly from webhook */
function extractPrecomputedData(
  widgetMap: Record<string, any>,
  metricName: string,
  widgetType: string
): any | null {
  const key = metricName.toLowerCase().trim();
  const widget = widgetMap[key];
  if (!widget) return null;

  // If widget has a formats object with the requested type
  const formats = widget.formats || {};
  const formatData = formats[widgetType] || formats[widget.default_type];
  if (formatData) {
    // Validate it has the right shape
    if (widgetType === 'doughnut' && formatData.segments) return formatData;
    if ((widgetType === 'line' || widgetType === 'bar_vertical') && formatData.data_points) return formatData;
    if (widgetType === 'bar_horizontal' && formatData.data_points) return formatData;
    if (widgetType === 'text' && formatData.content) return formatData;
    if (widgetType === 'number_card' && (formatData.value !== undefined)) return formatData;
  }

  return null;
}

/** Count conversations per day from conversation list timestamps */
function countConversationsPerDay(
  conversations: any[],
  startDate: string,
  endDate: string
): Array<{ date: string; value: number }> {
  const dayCounts: Record<string, number> = {};

  // Initialize all days to 0
  const cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor <= end) {
    dayCounts[cursor.toISOString().split("T")[0]] = 0;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const conv of conversations) {
    const messages = conv?.messages || conv?.conversation || [];
    const ts =
      conv?.timestamp ||
      conv?.created_at ||
      conv?.date ||
      conv?.first_timestamp ||
      (Array.isArray(messages) && messages[0]?.timestamp) ||
      "";
    if (!ts) continue;
    const day = ts.split("T")[0];
    if (day in dayCounts) {
      dayCounts[day]++;
    }
  }

  return Object.entries(dayCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/** Count messages of a specific role per day */
function countMessagesByRolePerDay(
  conversations: any[],
  roles: string[],
  startDate: string,
  endDate: string
): Array<{ date: string; value: number }> {
  const dayCounts: Record<string, number> = {};
  const cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor <= end) {
    dayCounts[cursor.toISOString().split("T")[0]] = 0;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const roleSet = new Set(roles.map((r) => r.toLowerCase()));
  for (const conv of conversations) {
    const messages = conv?.messages || conv?.conversation || [];
    if (!Array.isArray(messages)) continue;
    for (const msg of messages) {
      const role = (msg.role || msg.type || "").toLowerCase();
      if (!roleSet.has(role)) continue;
      const ts = msg.timestamp || msg.created_at || conv?.timestamp || conv?.created_at || "";
      if (!ts) continue;
      const day = ts.split("T")[0];
      if (day in dayCounts) {
        dayCounts[day]++;
      }
    }
  }

  return Object.entries(dayCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

// ── Schema definitions for AI tool calling ──

const WIDGET_SCHEMAS: Record<string, { name: string; description: string; parameters: any }> = {
  line: {
    name: "format_line_chart",
    description: "Format data into a line chart with date-based data points",
    parameters: {
      type: "object",
      properties: {
        data_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
              value: { type: "number", description: "Numeric value for this date" },
            },
            required: ["date", "value"],
            additionalProperties: false,
          },
        },
        value: { type: "number", description: "Total/aggregate value" },
        label: { type: "string", description: "Short label for the metric" },
      },
      required: ["data_points", "value", "label"],
      additionalProperties: false,
    },
  },
  bar_vertical: {
    name: "format_bar_vertical_chart",
    description: "Format data into a vertical bar chart with date-based data points",
    parameters: {
      type: "object",
      properties: {
        data_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
              value: { type: "number", description: "Numeric value for this date" },
            },
            required: ["date", "value"],
            additionalProperties: false,
          },
        },
        value: { type: "number", description: "Total/aggregate value" },
        label: { type: "string", description: "Short label for the metric" },
      },
      required: ["data_points", "value", "label"],
      additionalProperties: false,
    },
  },
  bar_horizontal: {
    name: "format_bar_horizontal_chart",
    description: "Format data into a horizontal bar chart with named categories",
    parameters: {
      type: "object",
      properties: {
        data_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Category or label name" },
              value: { type: "number", description: "Numeric value for this category" },
            },
            required: ["name", "value"],
            additionalProperties: false,
          },
        },
        value: { type: "number", description: "Total/aggregate value" },
        label: { type: "string", description: "Short label for the metric" },
      },
      required: ["data_points", "value", "label"],
      additionalProperties: false,
    },
  },
  doughnut: {
    name: "format_doughnut_chart",
    description: "Format data into a doughnut/pie chart with named segments",
    parameters: {
      type: "object",
      properties: {
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Segment name" },
              value: { type: "number", description: "Numeric value for this segment" },
            },
            required: ["name", "value"],
            additionalProperties: false,
          },
        },
        value: { type: "number", description: "Total/aggregate value" },
        label: { type: "string", description: "Short label for the metric" },
      },
      required: ["segments", "value", "label"],
      additionalProperties: false,
    },
  },
  text: {
    name: "format_text_widget",
    description: "Format data into a text summary widget",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Rich text summary of the analysis" },
        value: { type: "number", description: "Total/aggregate value if applicable" },
        label: { type: "string", description: "Short label for the metric" },
      },
      required: ["content", "value", "label"],
      additionalProperties: false,
    },
  },
  number_card: {
    name: "format_number_card",
    description: "Format data into a simple numeric display",
    parameters: {
      type: "object",
      properties: {
        value: { type: "number", description: "The numeric value to display" },
        label: { type: "string", description: "Short label for the metric" },
      },
      required: ["value", "label"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: FormatRequest = await req.json();
    const {
      client_id,
      metric_name,
      metric_prompt,
      widget_type,
      time_range,
      start_date,
      end_date,
      raw_webhook_data,
      conversations_list,
    } = body;

    if (!client_id || !metric_name || !widget_type) {
      return new Response(
        JSON.stringify({ error: "client_id, metric_name and widget_type are required" }),
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

    // ── Compute exact date boundaries ──
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    let computedStartDate = start_date;
    let computedEndDate = end_date || todayStr;
    if (!computedStartDate) {
      const daysBack = parseInt(time_range, 10) || 7;
      const startD = new Date(now);
      startD.setDate(startD.getDate() - (daysBack - 1));
      computedStartDate = startD.toISOString().split("T")[0];
    }

    // ── STEP 1: Try to use pre-computed data from webhook (no AI needed) ──
    const parsed = deepUnwrap(raw_webhook_data);
    const widgetMap = extractWidgetMap(parsed);
    const precomputed = extractPrecomputedData(widgetMap, metric_name, widget_type);

    if (precomputed) {
      console.log(`Using pre-computed webhook data for "${metric_name}" (${widget_type})`);
      return new Response(
        JSON.stringify({ success: true, chart_data: precomputed }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 2: For standard metrics, compute server-side from conversations ──
    const conversations = conversations_list || [];
    const metricLower = metric_name.toLowerCase().trim();
    const promptLower = (metric_prompt || "").toLowerCase();

    // Detect if this is a well-known metric we can compute accurately without AI
    let serverComputedData: any = null;

    if (conversations.length > 0 && (widget_type === "line" || widget_type === "bar_vertical")) {
      const isConversationCount =
        metricLower.includes("total conversation") ||
        metricLower.includes("total voice call") ||
        promptLower.includes("conversation session") ||
        promptLower.includes("voice call session");

      const isBotMessages =
        metricLower.includes("bot message") ||
        promptLower.includes("role is 'assistant'") ||
        promptLower.includes("automated response");

      const isHumanMessages =
        metricLower.includes("human message") ||
        promptLower.includes("sent by human");

      const isNewUsers =
        metricLower.includes("new user") ||
        promptLower.includes("first-time user") ||
        promptLower.includes("new or first-time");

      if (isConversationCount) {
        const dataPoints = countConversationsPerDay(conversations, computedStartDate, computedEndDate);
        const total = dataPoints.reduce((s, d) => s + d.value, 0);
        serverComputedData = { data_points: dataPoints, value: total, label: metric_name };
      } else if (isBotMessages) {
        const dataPoints = countMessagesByRolePerDay(
          conversations,
          ["assistant", "ai", "bot"],
          computedStartDate,
          computedEndDate
        );
        const total = dataPoints.reduce((s, d) => s + d.value, 0);
        serverComputedData = { data_points: dataPoints, value: total, label: metric_name };
      } else if (isHumanMessages) {
        const dataPoints = countMessagesByRolePerDay(
          conversations,
          ["human", "user"],
          computedStartDate,
          computedEndDate
        );
        const total = dataPoints.reduce((s, d) => s + d.value, 0);
        serverComputedData = { data_points: dataPoints, value: total, label: metric_name };
      } else if (isNewUsers) {
        // Count first human message per session per day
        const dayCounts: Record<string, number> = {};
        const cursor = new Date(computedStartDate + "T00:00:00Z");
        const endD = new Date(computedEndDate + "T00:00:00Z");
        while (cursor <= endD) {
          dayCounts[cursor.toISOString().split("T")[0]] = 0;
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        for (const conv of conversations) {
          const messages = conv?.messages || conv?.conversation || [];
          if (!Array.isArray(messages)) continue;
          const firstHuman = messages.find(
            (m: any) => ["human", "user"].includes((m.role || m.type || "").toLowerCase())
          );
          if (firstHuman) {
            const ts = firstHuman.timestamp || firstHuman.created_at || conv?.timestamp || conv?.created_at || "";
            if (ts) {
              const day = ts.split("T")[0];
              if (day in dayCounts) dayCounts[day]++;
            }
          }
        }
        const dataPoints = Object.entries(dayCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({ date, value }));
        const total = dataPoints.reduce((s, d) => s + d.value, 0);
        serverComputedData = { data_points: dataPoints, value: total, label: metric_name };
      }
    }

    if (serverComputedData) {
      console.log(`Server-computed data for "${metric_name}" (${widget_type}): total=${serverComputedData.value}`);
      return new Response(
        JSON.stringify({ success: true, chart_data: serverComputedData }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── STEP 3: Fall back to AI for custom/semantic metrics ──
    const { createClient } = await import("npm:@supabase/supabase-js@2.101.0");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: clientData, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", client_id)
      .maybeSingle();

    if (clientError || !clientData?.openrouter_api_key) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured for this client." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openrouterApiKey = clientData.openrouter_api_key;

    // ── Build structured data context ──
    // Pre-count messages by role and day for the AI to reference as ground truth
    let preCountedSummary = "";
    if (conversations.length > 0) {
      const convPerDay = countConversationsPerDay(conversations, computedStartDate, computedEndDate);
      const humanPerDay = countMessagesByRolePerDay(conversations, ["human", "user"], computedStartDate, computedEndDate);
      const botPerDay = countMessagesByRolePerDay(conversations, ["assistant", "ai", "bot"], computedStartDate, computedEndDate);

      preCountedSummary = `
PRE-COUNTED GROUND TRUTH (use these numbers as reference):
- Total conversations in range: ${convPerDay.reduce((s, d) => s + d.value, 0)}
- Total human messages in range: ${humanPerDay.reduce((s, d) => s + d.value, 0)}
- Total bot messages in range: ${botPerDay.reduce((s, d) => s + d.value, 0)}
- Conversations per day: ${JSON.stringify(convPerDay.filter(d => d.value > 0).slice(0, 30))}
`;
    }

    // Build data context from webhook
    let dataContext = "";
    if (parsed && typeof parsed === "object") {
      const widgets = parsed?.widgets || parsed?.data?.widgets || [];
      const defaultMetrics = parsed?.default_metrics || parsed?.data?.default_metrics || [];
      if (Array.isArray(widgets) && widgets.length > 0) {
        dataContext += `WEBHOOK WIDGET DATA:\n${JSON.stringify(widgets.map((w: any) => ({
          title: w.title, formats: w.formats, default_type: w.default_type,
        })), null, 1)}\n\n`;
      }
      if (Array.isArray(defaultMetrics) && defaultMetrics.length > 0) {
        dataContext += `DEFAULT METRICS:\n${JSON.stringify(defaultMetrics, null, 1)}\n\n`;
      }
    }

    // Condensed conversation data
    let conversationsContext = "";
    if (conversations.length > 0) {
      const condensed = conversations.map((conv: any, idx: number) => {
        const messages = conv?.messages || conv?.conversation || [];
        const timestamp = conv?.timestamp || conv?.created_at || conv?.date || (Array.isArray(messages) ? messages[0]?.timestamp : "") || "";
        return {
          session_id: conv?.session_id || conv?.id || `s${idx}`,
          timestamp,
          messages: Array.isArray(messages)
            ? messages.map((m: any) => ({
                role: m.role || m.type,
                content: typeof m.content === "string" ? m.content.slice(0, 200) : "",
                timestamp: m.timestamp || m.created_at || "",
              }))
            : [],
        };
      });
      const convStr = JSON.stringify(condensed, null, 1);
      conversationsContext = convStr.length > 40000 ? convStr.slice(0, 40000) : convStr;
    }

    // Generate expected dates for time-series
    const expectedDates: string[] = [];
    if (widget_type === "line" || widget_type === "bar_vertical") {
      const cursor = new Date(computedStartDate + "T00:00:00Z");
      const endD = new Date(computedEndDate + "T00:00:00Z");
      while (cursor <= endD) {
        expectedDates.push(cursor.toISOString().split("T")[0]);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const schema = WIDGET_SCHEMAS[widget_type] || WIDGET_SCHEMAS.number_card;
    const toolName = schema.name;
    const timeDescription = `from ${computedStartDate} to ${computedEndDate} (${time_range} days)`;

    const systemPrompt = `You are an expert analytics data formatter. Analyze raw conversation data and produce accurately structured chart data.

TODAY: ${todayStr}
METRIC: "${metric_name}"
DESCRIPTION: "${metric_prompt || metric_name}"
VISUALIZATION: ${widget_type}
TIME RANGE: ${timeDescription}
START: ${computedStartDate}  END: ${computedEndDate}
TOTAL CONVERSATIONS PROVIDED: ${conversations.length}
${expectedDates.length > 0 ? `REQUIRED DATES (include ALL, use 0 for days with no data): ${JSON.stringify(expectedDates)}` : ""}

${preCountedSummary}

CRITICAL ACCURACY RULES:
1. ONLY use numbers from actual data — NEVER estimate or invent values.
2. If pre-computed widget data exists for this metric, use those exact values.
3. For time-series: count ACTUAL messages/conversations per day by examining timestamps. Every date in REQUIRED DATES must appear; use 0 if no data.
4. Cross-check: the 'value' field MUST equal the sum of all data_points values or segments values.
5. For semantic metrics (e.g. "questions asked", "thank you count"): scan message content for matching patterns and count accurately.
6. Prefer the PRE-COUNTED GROUND TRUTH numbers above as your baseline reference.`;

    const userContent = `${dataContext}${preCountedSummary}${
      conversationsContext ? `\nCONVERSATION DATA (${conversations.length} sessions):\n${conversationsContext}` : ""
    }\n\nProduce a ${widget_type} for "${metric_name}" covering ${timeDescription}. Every value must come from actual data.`;

    const aiRequestBody = {
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        tools: [{ type: "function", function: schema }],
        tool_choice: { type: "function", function: { name: toolName } },
        temperature: 0,
      };

    const aiResponse = await loggedFetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://buildingflowdigital.com",
        },
        body: JSON.stringify(aiRequestBody),
      },
      {
        client_id,
        request_type: "llm",
        source: "format-metric-chart",
        method: "POST",
        request_body: aiRequestBody as unknown as Record<string, unknown>,
        model: "google/gemini-2.5-flash",
      }
    );

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errText);
      const status = aiResponse.status;
      const msg =
        status === 429 ? "Rate limit exceeded. Please try again." :
        status === 402 ? "Usage credits exhausted." :
        `AI formatting failed (${status})`;
      return new Response(
        JSON.stringify({ error: msg }),
        { status: status === 429 || status === 402 ? status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    let chartData: any = null;
    const toolCalls = aiData?.choices?.[0]?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      try {
        chartData = JSON.parse(toolCalls[0].function.arguments);
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e);
      }
    }

    if (!chartData) {
      return new Response(
        JSON.stringify({ error: "AI failed to produce chart data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Post-validation: ensure data_points sum matches value ──
    if (chartData.data_points && Array.isArray(chartData.data_points)) {
      const sum = chartData.data_points.reduce((s: number, dp: any) => s + (dp.value || 0), 0);
      chartData.value = sum; // Force consistency
    }
    if (chartData.segments && Array.isArray(chartData.segments)) {
      const sum = chartData.segments.reduce((s: number, seg: any) => s + (seg.value || 0), 0);
      chartData.value = sum;
    }

    console.log(`AI formatted "${metric_name}" (${widget_type}): total=${chartData.value}`);

    return new Response(JSON.stringify({ success: true, chart_data: chartData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("format-metric-chart error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
