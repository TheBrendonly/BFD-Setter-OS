import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { loggedFetch } from "../_shared/request-logger.ts";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface MetricDef {
  id?: string;
  name: string;
  prompt: string;
  description?: string;
  widget_type?: string;
  color?: string;
}

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
  // Voice only: surfaced so the "Call Recordings & Transcripts" table can render
  // (it was showing 0 CALLS because these never flowed through). Empty for text.
  recording_url?: string;
  public_log_url?: string;
  transcript?: string;
}

const HUMAN_ROLE_SET = new Set(["human", "user", "business", "customer", "lead"]);
const BOT_ROLE_SET = new Set(["ai", "assistant", "bot", "agent", "system"]);

function normalizeRole(raw: unknown): string {
  const role = String(raw ?? "").trim().toLowerCase();
  if (HUMAN_ROLE_SET.has(role)) return "human";
  if (BOT_ROLE_SET.has(role)) return "ai";
  return role || "unknown";
}

function decodeJsonValue(raw: unknown): unknown {
  let current = raw;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const record = current as Record<string, unknown>;
      if (record._type === "String" && typeof record.value === "string") {
        current = record.value;
        continue;
      }
    }

    if (typeof current !== "string") break;

    const trimmed = current.trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"'))) {
      return trimmed;
    }

    try {
      current = JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return current;
}

function extractMessageData(...candidates: unknown[]): { type: string; content: string } {
  let resolvedType = "";
  let resolvedContent: unknown = "";

  const assignFromObject = (obj: Record<string, any>) => {
    const candidateType = obj.type ?? obj.role;
    if (!resolvedType && candidateType) {
      resolvedType = normalizeRole(candidateType);
    }

    const candidateContent = obj.content ?? obj.text ?? obj.message ?? obj.body;
    if ((resolvedContent === "" || resolvedContent == null) && candidateContent !== undefined) {
      resolvedContent = candidateContent;
    }
  };

  for (const candidate of candidates) {
    const decoded = decodeJsonValue(candidate);

    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      assignFromObject(decoded as Record<string, any>);
      continue;
    }

    if ((resolvedContent === "" || resolvedContent == null) && decoded !== undefined && decoded !== null) {
      resolvedContent = decoded;
    }
  }

  const decodedContent = decodeJsonValue(resolvedContent);
  if (decodedContent && typeof decodedContent === "object" && !Array.isArray(decodedContent)) {
    assignFromObject(decodedContent as Record<string, any>);

    const objectContent = (decodedContent as Record<string, any>).content
      ?? (decodedContent as Record<string, any>).text
      ?? (decodedContent as Record<string, any>).message;

    if (objectContent !== undefined) {
      resolvedContent = objectContent;
    }
  } else {
    resolvedContent = decodedContent;
  }

  const content =
    typeof resolvedContent === "string"
      ? resolvedContent
      : resolvedContent == null
        ? ""
        : JSON.stringify(resolvedContent);

  return {
    type: resolvedType || "unknown",
    content,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function compactContent(raw: any): string {
  if (!raw) return "";
  // Handle non-string content (objects, arrays, numbers)
  let t: string;
  if (typeof raw === "object") {
    // If it's a parsed message object with content field, extract it
    if (raw.content) return compactContent(raw.content);
    t = JSON.stringify(raw);
  } else {
    t = String(raw);
  }
  t = t.replace(/^#\s*USER\s*LAST\s*UTTERANCE\s*/i, "");
  t = t.split(/\s*(?:Attachment:\s*|#\s*USER\s*INPUT\s*ATTACH|\(FILES\/IMAGE\/AUDIO EXTRACTED CONTENT\):)/i)[0];
  t = t.replace(/^#\s*\w[\w\s]*\n?/gm, "");
  t = t.replace(/https?:\/\/\S+/gi, "");
  t = t.replace(/\.\w+\s+Audio\s+[\d\-]+\s+at\s+[\d.]+\.\w+/gi, "");
  t = t.replace(/\n{2,}/g, "\n").trim();
  return t;
}

function buildCompactConversations(conversations: Conversation[]): string {
  const lines: string[] = [];
  for (const conv of conversations) {
    const sid = conv.session_id || "unknown";
    for (let i = 0; i < conv.messages.length; i++) {
      const msg = conv.messages[i];
      const normalized = extractMessageData(msg.content, { type: msg.type, content: msg.content });
      const role = normalizeRole(msg.type || normalized.type);
      const content = compactContent(normalized.content);
      if (role !== "human" && role !== "ai") continue;
      if (!content) continue;
      const ts = msg.timestamp || "";
      lines.push(`[${sid}|${i}|${ts}|${role === "human" ? "user" : "ai"}]: ${content}`);
    }
  }
  return lines.join("\n");
}

function getDateFilter(timeRange: string, startDate?: string | null, endDate?: string | null) {
  if (timeRange === "custom" && startDate && endDate) {
    // Normalize a date-only upper bound to end-of-day so the last selected day's
    // conversations/calls are included (matches the non-custom branch below);
    // otherwise `to = "2026-06-23"` excludes everything after midnight that day.
    return { from: startDate, to: endDate.length === 10 ? endDate + "T23:59:59" : endDate };
  }
  const days = parseInt(timeRange) || 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0] + "T23:59:59",
  };
}

async function updateStage(supabase: any, executionId: string, stage: string, status?: string) {
  const update: any = { stage_description: stage };
  if (status) update.status = status;
  await supabase.from("analytics_executions").update(update).eq("id", executionId);
}

async function detectTimestampColumn(
  clientSupabaseUrl: string,
  clientServiceKey: string,
  historyTable: string
): Promise<string> {
  // Fetch one row to detect column names
  const url = `${clientSupabaseUrl}/rest/v1/${historyTable}?select=*&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: clientServiceKey,
      Authorization: `Bearer ${clientServiceKey}`,
    },
  });
  if (!res.ok) {
    await res.text();
    return "created_at"; // fallback
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return "created_at";

  const row = rows[0];
  const candidates = ["created_at", "timestamp", "createdAt", "date", "time", "sent_at", "inserted_at"];
  for (const col of candidates) {
    if (col in row) {
      console.log(`Detected timestamp column: ${col}`);
      return col;
    }
  }
  // Fallback: return first key that looks like a timestamp
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      console.log(`Detected timestamp column by value pattern: ${key}`);
      return key;
    }
  }
  return "created_at";
}

async function resolveHistoryTable(
  clientSupabaseUrl: string,
  clientServiceKey: string,
  tableName: string
): Promise<string> {
  if (tableName) {
    return tableName.endsWith("_history") ? tableName : `${tableName}_history`;
  }

  const candidates = ["chat_history", "messages_history", "conversations_history", "call_history"];
  for (const candidate of candidates) {
    const url = `${clientSupabaseUrl}/rest/v1/${candidate}?select=id&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: clientServiceKey,
        Authorization: `Bearer ${clientServiceKey}`,
      },
    });
    if (res.ok) {
      await res.text();
      console.log(`Auto-detected history table: ${candidate}`);
      return candidate;
    }
    await res.text();
  }

  throw new Error("Could not find a history table. Please set the table name in your client settings.");
}

async function fetchConversations(
  clientSupabaseUrl: string,
  clientServiceKey: string,
  tableName: string,
  dateFilter: { from: string; to: string }
): Promise<Conversation[]> {
  const historyTable = await resolveHistoryTable(clientSupabaseUrl, clientServiceKey, tableName);
  const tsCol = await detectTimestampColumn(clientSupabaseUrl, clientServiceKey, historyTable);
  console.log(`Using history table: ${historyTable}, timestamp column: ${tsCol}`);

  // Paginate to get all rows (Supabase default limit is 1000)
  const allRows: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const url = `${clientSupabaseUrl}/rest/v1/${historyTable}?select=*&${tsCol}=gte.${dateFilter.from}&${tsCol}=lte.${dateFilter.to}&order=${tsCol}.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        apikey: clientServiceKey,
        Authorization: `Bearer ${clientServiceKey}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to fetch chat history (${res.status}): ${errText}`);
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  // Group by session_id
  const sessionMap = new Map<string, Conversation>();
  for (const row of allRows) {
    const sid = row.session_id || row.conversation_id || "default";
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        session_id: sid,
        client_id: row.client_id,
        messages: [],
        first_timestamp: row[tsCol] || row.created_at || row.timestamp,
      });
    }
    const conv = sessionMap.get(sid)!;

    const parsedMessage = extractMessageData(
      row.message,
      row.content,
      { type: row.role ?? row.type, content: row.content ?? row.message }
    );

    conv.messages.push({
      type: normalizeRole(parsedMessage.type),
      content: parsedMessage.content,
      timestamp: row[tsCol] || row.created_at || row.timestamp,
    });
  }

  return Array.from(sessionMap.values());
}

// Voice analytics source (B1 / D3 fix). Voice transcripts live in the PLATFORM
// `call_history` table (written by retell-call-webhook / retell-call-analysis-webhook),
// one row per call — NOT in the client's external DB (which only holds chat_history).
// Each call row maps to ONE Conversation whose messages come from transcript_object,
// so the same computeDefaultMetrics / conversation-list path works unchanged.
async function fetchVoiceConversations(
  platformSupabase: any,
  clientId: string,
  dateFilter: { from: string; to: string }
): Promise<Conversation[]> {
  const conversations: Conversation[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data: rows, error } = await platformSupabase
      .from("call_history")
      .select("call_id, transcript_object, transcript, call_summary, created_at, start_timestamp, user_sentiment, recording_url, public_log_url")
      .eq("client_id", clientId)
      .gte("created_at", dateFilter.from)
      .lte("created_at", dateFilter.to)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch call history (${error.code ?? "?"}): ${error.message}`);
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const ts = (row.start_timestamp as string) || (row.created_at as string);
      const messages: ConversationMessage[] = [];
      const turns = Array.isArray(row.transcript_object) ? row.transcript_object : [];
      for (const turn of turns) {
        const t = (turn ?? {}) as Record<string, unknown>;
        const content = String(t.content ?? "").trim();
        if (!content) continue;
        messages.push({ type: normalizeRole(t.role ?? t.type), content, timestamp: ts });
      }
      // Fallback when there is no structured transcript_object: synthesize a single
      // message from the plain transcript or summary so the call still counts.
      if (messages.length === 0) {
        const fallback = String(row.transcript ?? row.call_summary ?? "").trim();
        if (fallback) messages.push({ type: "ai", content: fallback, timestamp: ts });
      }
      conversations.push({
        session_id: (row.call_id as string) || undefined,
        client_id: clientId,
        messages,
        first_timestamp: ts,
        recording_url: (row.recording_url as string) || undefined,
        public_log_url: (row.public_log_url as string) || undefined,
        transcript: (row.transcript as string) || undefined,
      });
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return conversations;
}

async function computeDefaultMetrics(conversations: Conversation[], isVoice = false): Promise<any[]> {
  let totalBotMessages = 0;
  let totalHumanMessages = 0;
  const uniqueUsers = new Set<string>();

  for (const conv of conversations) {
    if (conv.session_id) uniqueUsers.add(conv.session_id);

    for (const msg of conv.messages) {
      const parsedMessage = extractMessageData(msg.content, { type: msg.type, content: msg.content });
      const role = normalizeRole(msg.type || parsedMessage.type);

      if (role === "human") {
        totalHumanMessages++;
      } else if (role === "ai") {
        totalBotMessages++;
      }
    }
  }

  // Voice dashboard reads a "Total Voice Call" tile; text dashboard reads "Total Conversations".
  // Same underlying count (distinct sessions/calls), different label per channel.
  const totalLabel = isVoice ? "Total Voice Call" : "Total Conversations";
  return [
    { title: totalLabel, value: conversations.length, label: totalLabel },
    { title: "Total Bot Messages", value: totalBotMessages, label: "Total Bot Messages" },
    { title: "Total Human Messages", value: totalHumanMessages, label: "Total Human Messages" },
    { title: "New Users", value: uniqueUsers.size, label: "New Users" },
  ];
}

async function computeCustomMetric(
  metric: MetricDef,
  compactText: string,
  conversations: Conversation[],
  openrouterKey: string,
  clientId: string
): Promise<any> {
  const widgetType = metric.widget_type || "number_card";

  let responseFormat = "";
  if (widgetType === "number_card") {
    responseFormat = `Return JSON: {"value": <number>, "label": "<metric name>"}`;
  } else if (widgetType === "line" || widgetType === "bar_vertical") {
    responseFormat = `Return JSON: {"data_points": [{"date": "YYYY-MM-DD", "value": <number>}]}`;
  } else if (widgetType === "bar_horizontal") {
    responseFormat = `Return JSON: {"data_points": [{"name": "<category>", "value": <number>}]}`;
  } else if (widgetType === "doughnut") {
    responseFormat = `Return JSON: {"segments": [{"name": "<category>", "value": <number>}]}`;
  } else {
    responseFormat = `Return JSON: {"content": "<text summary>"}`;
  }

  const systemPrompt = `You are analyzing chat conversations. Your task:
"${metric.prompt || metric.name}"

${responseFormat}

Be precise. Only count real matches. Return valid JSON only, no markdown.`;

  const requestBody = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: compactText },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  const aiResponse = await loggedFetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    {
      client_id: clientId,
      request_type: "llm",
      source: "compute-analytics",
      method: "POST",
      request_body: requestBody as unknown as Record<string, unknown>,
      model: "google/gemini-2.5-flash",
    }
  );

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error(`AI error for metric "${metric.name}":`, aiResponse.status, errText);
    return null;
  }

  const aiData = await aiResponse.json();
  const content = aiData?.choices?.[0]?.message?.content;

  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch { /* fall through */ }
    }
    console.error(`Failed to parse AI response for "${metric.name}":`, content);
    return null;
  }
}

async function processCustomMetricsInBackground(
  supabase: any,
  executionId: string,
  clientId: string,
  conversations: Conversation[],
  customMetrics: MetricDef[],
  openrouterApiKey: string | null
) {
  const builtinMetricNames = new Set([
    "total conversations",
    "total bot messages",
    "total human messages",
    "new users",
    "total voice call",
    // "new user messages" removed: it was reserved here (excluding it from the LLM
    // custom-metric path) but never produced as a default, so it rendered N/A. A
    // user can now define it as a custom metric.
  ]);

  const customMetricsList = (customMetrics || []).filter(
    (metric: any) => !builtinMetricNames.has(String(metric?.name || "").toLowerCase())
  );

  if (customMetricsList.length === 0) {
    await supabase.from("analytics_executions").update({
      stage_description: "Analytics computation complete",
    }).eq("id", executionId);
    console.log(`Analytics computation completed for execution ${executionId}`);
    return;
  }

  if (!openrouterApiKey) {
    await supabase.from("analytics_executions").update({
      stage_description: "Default metrics ready. Custom metrics skipped — OpenRouter key missing.",
    }).eq("id", executionId);
    console.warn(`Skipped custom metrics for execution ${executionId}: missing OpenRouter key`);
    return;
  }

  const compactText = buildCompactConversations(conversations);
  const BATCH_SIZE = 4;
  const widgets: any[] = [];

  for (let batch = 0; batch < customMetricsList.length; batch += BATCH_SIZE) {
    const batchMetrics = customMetricsList.slice(batch, batch + BATCH_SIZE);
    const batchLabel = `Analyzing metrics ${batch + 1}-${Math.min(batch + BATCH_SIZE, customMetricsList.length)}/${customMetricsList.length}...`;

    await supabase.from("analytics_executions").update({
      stage_description: batchLabel,
      status: "completed",
    }).eq("id", executionId);

    const batchResults = await Promise.allSettled(
      batchMetrics.map(async (metric) => {
        try {
          const result = await computeCustomMetric(
            metric,
            compactText,
            conversations,
            openrouterApiKey,
            clientId
          );

          if (result !== null) {
            return {
              id: metric.id,
              title: metric.name,
              name: metric.name,
              widget_type: metric.widget_type || "number_card",
              default_type: metric.widget_type || "number_card",
              color: metric.color,
              formats: {
                [metric.widget_type || "number_card"]: result,
                number_card: result?.value !== undefined ? result : { value: null, label: metric.name },
              },
              data: result,
            };
          }

          return null;
        } catch (metricErr: any) {
          console.error(`Error computing metric "${metric.name}":`, metricErr);
          return null;
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        widgets.push(result.value);
      }
    }

    if (widgets.length > 0) {
      const { error: widgetsPersistError } = await supabase
        .from("analytics_results")
        .update({ widgets })
        .eq("execution_id", executionId);

      if (widgetsPersistError) {
        console.error(`Failed to persist widgets for execution ${executionId}:`, widgetsPersistError);
      }
    }
  }

  if (widgets.length > 0) {
    const { error: widgetsError } = await supabase.from("analytics_results")
      .update({ widgets })
      .eq("execution_id", executionId);

    if (widgetsError) {
      console.error(`Failed to save final widgets for execution ${executionId}:`, widgetsError);
    }

    console.log(`Updated ${widgets.length} custom metric widgets for execution ${executionId}`);
  }

  await supabase.from("analytics_executions").update({
    stage_description: "Analytics computation complete",
  }).eq("id", executionId);

  console.log(`Analytics computation completed for execution ${executionId}`);
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      execution_id,
      client_id,
      time_range,
      start_date,
      end_date,
      default_metrics,
      custom_metrics,
      analytics_type,
      client_supabase_url,
      client_supabase_service_key,
      client_supabase_table_name,
      openrouter_api_key,
    } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (!execution_id || !client_id) {
      return new Response(
        JSON.stringify({ error: "Missing execution_id or client_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tenant guard: this is an internal callee (run-analytics presents the
    // service-role bearer). Without it, an anon-key holder could (a) write
    // analytics_results under any client_id and (b) use the body-supplied
    // external creds below as an outbound-fetch/SSRF relay.
    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }),
          { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    // SECURITY: never trust caller-supplied external DB creds — resolve them
    // from the verified client's own row (mirrors fetch-thread-previews). The
    // body-supplied client_supabase_* values are ignored.
    const { data: clientRow } = await supabase
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", client_id)
      .maybeSingle();
    const extUrl = (clientRow?.supabase_url as string | null) || null;
    const extKey = (clientRow?.supabase_service_key as string | null) || null;
    // Text analytics reads the external "chat_history" table, same as every sibling reader.
    // Not clients.supabase_table_name, that column is the external LEADS table, and feeding it
    // here made resolveHistoryTable append "_history" (e.g. leads -> leads_history 404). G3-6-SCHEMA-1.
    const extTable = "chat_history";

    // Voice analytics reads the PLATFORM call_history (Retell transcripts); text
    // analytics reads the client's external DB. Route the source by type.
    const isVoice = analytics_type === "voice";

    // Mark as running
    await updateStage(supabase, execution_id, `Fetching ${isVoice ? "call" : "chat"} history...`, "running");

    const dateFilter = getDateFilter(time_range || "7", start_date, end_date);
    let conversations: Conversation[];

    // Step 1: Fetch conversations
    try {
      if (isVoice) {
        // B1 fix: voice must NOT require external creds (it reads the platform DB).
        // Previously this path fell through to fetchConversations over chat_history,
        // so voice metrics ran on text data (or failed the external-cred guard).
        conversations = await fetchVoiceConversations(supabase, client_id, dateFilter);
      } else {
        if (!extUrl || !extKey) {
          await supabase.from("analytics_executions").update({
            status: "failed",
            error_message: "Client Supabase credentials not configured",
            completed_at: new Date().toISOString(),
          }).eq("id", execution_id);

          return new Response(
            JSON.stringify({ error: "Client Supabase credentials not configured" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        conversations = await fetchConversations(extUrl, extKey, extTable, dateFilter);
      }
    } catch (fetchErr: any) {
      await supabase.from("analytics_executions").update({
        status: "failed",
        error_message: `Failed to fetch ${isVoice ? "call" : "chat"} history: ${fetchErr.message}`,
        completed_at: new Date().toISOString(),
      }).eq("id", execution_id);

      return new Response(
        JSON.stringify({ error: fetchErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetched ${conversations.length} conversations for client ${client_id}`);

    // Step 2: Compute default metrics (instant, code-based)
    await updateStage(supabase, execution_id, "Computing default metrics...");
    const defaultMetricResults = await computeDefaultMetrics(conversations, isVoice);

    // Step 3: Build conversations list for the frontend
    const conversationsList = conversations.map((conv) => ({
      session_id: conv.session_id,
      message_count: conv.messages.length,
      first_timestamp: conv.first_timestamp,
      // Voice recordings/transcripts (empty for text); the frontend derives the
      // "Call Recordings & Transcripts" table from these.
      recording_url: conv.recording_url,
      public_log_url: conv.public_log_url,
      transcript: conv.transcript,
      messages: conv.messages.map((m) => ({
        role: m.type,
        content: m.content,
        timestamp: m.timestamp,
      })),
    }));

    const summary = {
      total_conversations: conversations.length,
      total_messages: conversations.reduce((sum, c) => sum + c.messages.length, 0),
      date_range: dateFilter,
      analytics_type: analytics_type || "text",
      computed_at: new Date().toISOString(),
    };

    // Step 4: SAVE default metrics immediately so the UI gets data fast
    const { error: earlyInsertError } = await supabase.from("analytics_results").insert({
      client_id,
      execution_id,
      widgets: [],
      default_metrics: defaultMetricResults,
      summary,
      conversations_list: conversationsList,
    });

    if (earlyInsertError) {
      console.error("Failed to save initial analytics results:", earlyInsertError);
      await supabase.from("analytics_executions").update({
        status: "failed",
        error_message: `Failed to save results: ${earlyInsertError.message}`,
        completed_at: new Date().toISOString(),
      }).eq("id", execution_id);

      return new Response(
        JSON.stringify({ error: "Failed to save results" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark completed immediately with default metrics — custom metrics are bonus
    await supabase.from("analytics_executions").update({
      status: "completed",
      stage_description: "Default metrics ready. Processing custom metrics...",
      completed_at: new Date().toISOString(),
    }).eq("id", execution_id);

    console.log(`Default metrics saved for execution ${execution_id}, custom metrics continuing in background...`);

    const backgroundTask = processCustomMetricsInBackground(
      supabase,
      execution_id,
      client_id,
      conversations,
      custom_metrics || [],
      openrouter_api_key || null
    ).catch(async (backgroundErr: any) => {
      console.error("Background custom metric processing failed:", backgroundErr);
      await supabase.from("analytics_executions").update({
        stage_description: "Default metrics ready. Custom metrics failed.",
        error_message: backgroundErr?.message || "Custom metric processing failed",
        status: "completed",
      }).eq("id", execution_id);
    });

    if (typeof (globalThis as any).EdgeRuntime !== "undefined") {
      (globalThis as any).EdgeRuntime.waitUntil(backgroundTask);
    }

    return new Response(
      JSON.stringify({ success: true, execution_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("compute-analytics error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
