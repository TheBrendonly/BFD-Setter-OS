import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.0";

interface LogEntry {
  client_id: string;
  request_type: "llm" | "webhook" | "database";
  source: string;
  endpoint_url?: string;
  method?: string;
  request_body?: Record<string, unknown>;
  response_body?: Record<string, unknown>;
  status_code?: number;
  status: "success" | "error";
  error_message?: string;
  duration_ms?: number;
  tokens_used?: number;
  cost?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget logger — never throws, never blocks the caller */
export async function logRequest(entry: LogEntry): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) return;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Calculate payload sizes for tracking
    const requestSize = entry.request_body ? JSON.stringify(entry.request_body).length : 0;
    const responseSize = entry.response_body ? JSON.stringify(entry.response_body).length : 0;

    // Merge size info into metadata
    const enrichedMetadata = {
      ...(entry.metadata || {}),
      request_size_bytes: requestSize,
      response_size_bytes: responseSize,
    };

    await supabase.from("request_logs").insert({
      client_id: entry.client_id,
      request_type: entry.request_type,
      source: entry.source,
      endpoint_url: entry.endpoint_url || null,
      method: entry.method || "POST",
      request_body: entry.request_body as any,
      response_body: entry.response_body as any,
      status_code: entry.status_code || null,
      status: entry.status,
      error_message: entry.error_message || null,
      duration_ms: entry.duration_ms || null,
      tokens_used: entry.tokens_used || null,
      cost: entry.cost || null,
      model: entry.model || null,
      metadata: enrichedMetadata,
    });
  } catch (err) {
    console.error("[request-logger] Failed to log:", err);
  }
}

/** Wrapper to time a fetch call and log it */
export async function loggedFetch(
  url: string,
  options: RequestInit,
  logMeta: Omit<LogEntry, "duration_ms" | "status_code" | "status" | "response_body" | "endpoint_url">
): Promise<Response> {
  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(url, options);
    const duration_ms = Date.now() - start;
    const cloned = response.clone();
    let responseBody: Record<string, unknown> = {};
    try {
      responseBody = await cloned.json();
    } catch {
      try {
        const text = await cloned.text();
        responseBody = { _raw: text.slice(0, 4096) };
      } catch { /* ignore */ }
    }

    // Extract token usage and cost from OpenRouter/Gateway responses
    let tokens_used = logMeta.tokens_used;
    let cost = logMeta.cost;
    let model = logMeta.model;
    if (responseBody?.usage) {
      const usage = responseBody.usage as any;
      tokens_used = usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
      // OpenRouter includes cost in usage object
      if (typeof usage.cost === "number") {
        cost = usage.cost;
      }
    }
    if (responseBody?.model) {
      model = responseBody.model as string;
    }

    await logRequest({
      ...logMeta,
      endpoint_url: url,
      status_code: response.status,
      status: response.ok ? "success" : "error",
      error_message: response.ok ? undefined : (responseBody?.error as any)?.message || response.statusText,
      response_body: responseBody,
      duration_ms,
      tokens_used,
      cost,
      model,
    });

    return response;
  } catch (err: any) {
    const duration_ms = Date.now() - start;
    await logRequest({
      ...logMeta,
      endpoint_url: url,
      status: "error",
      error_message: err.message || "Network error",
      duration_ms,
    });
    throw err;
  }
}
