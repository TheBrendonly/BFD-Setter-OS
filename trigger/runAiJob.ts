import { task } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";

const getMainSupabase = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

type Message = { role: "system" | "user" | "assistant"; content: string };

interface ChunkPayload {
  messages: Message[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" | "text" };
}

interface AiJobPayload {
  job_id: string;
  client_id: string;
  job_type: string;
  // Single call (most job types)
  messages?: Message[];
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" | "text" };
  // Multi-chunk (generate-setter-config)
  chunks?: ChunkPayload[];
  sanitized_parameters?: { key: string }[];
  // Optional: if provided, these selections override AI-generated _selections (used for copy setter)
  preserve_selections?: Record<string, unknown>;
}

// ── Model max_completion_tokens lookup (cached per process) ──────────────────
// Prevents sending max_tokens higher than the model supports, which causes errors.

const modelLimitsCache = new Map<string, number | null>();

async function getModelMaxTokens(apiKey: string, model: string): Promise<number | null> {
  if (modelLimitsCache.has(model)) return modelLimitsCache.get(model)!;
  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    for (const m of data.data ?? []) {
      const limit = m.top_provider?.max_completion_tokens ?? null;
      modelLimitsCache.set(m.id, limit);
    }
    return modelLimitsCache.get(model) ?? null;
  } catch {
    return null;
  }
}

// ── Call OpenRouter once ──────────────────────────────────────────────────────

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number; // USD, from native_tokens_prompt/completion or x-openrouter-cost header
}

// Module-level accumulator so parallel chunks sum up correctly
let _lastUsage: OpenRouterUsage | null = null;
export function getLastUsage(): OpenRouterUsage | null { return _lastUsage; }
export function resetUsage() { _lastUsage = null; }
function addUsage(u: OpenRouterUsage) {
  if (!_lastUsage) { _lastUsage = { ...u }; return; }
  _lastUsage.prompt_tokens += u.prompt_tokens;
  _lastUsage.completion_tokens += u.completion_tokens;
  _lastUsage.total_tokens += u.total_tokens;
  if (u.cost !== undefined) _lastUsage.cost = (_lastUsage.cost ?? 0) + u.cost;
}

// Per-invocation capture of raw requests/responses for debugging
interface RawExchange {
  chunk_index?: number;
  messages: Message[];
  model: string;
  max_tokens?: number;
  raw_response: string;
}
let _rawExchanges: RawExchange[] = [];
export function getRawExchanges(): RawExchange[] { return _rawExchanges; }
export function resetRawExchanges() { _rawExchanges = []; }
function captureExchange(exchange: RawExchange) { _rawExchanges.push(exchange); }

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: Message[],
  max_tokens: number | undefined,
  temperature: number,
  response_format: { type: string },
  chunkIndex?: number
): Promise<string> {
  // Cap at the model's max completion tokens so we never send a value the model rejects.
  // If the caller provided a lower value, honour it — don't inflate to the model ceiling,
  // since prompt tokens + output tokens must fit within the total context window.
  const modelMax = await getModelMaxTokens(apiKey, model);
  if (modelMax !== null) {
    const callerValue = max_tokens;
    max_tokens = callerValue !== undefined ? Math.min(callerValue, modelMax) : modelMax;
    console.log(`max_tokens: ${max_tokens} (caller: ${callerValue ?? "unset"}, model cap: ${modelMax}) for ${model}`);
  } else {
    console.log(`max_tokens limit unknown for ${model}, using: ${max_tokens}`);
  }

  const body: Record<string, unknown> = { model, messages, temperature, response_format };
  if (max_tokens !== undefined) body.max_tokens = max_tokens;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if ((err as Error).name === "AbortError") {
      throw new Error("OpenRouter request timed out after 5 minutes.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) throw new Error("Invalid OpenRouter API key.");
    if (response.status === 402) throw new Error("Insufficient OpenRouter credits.");
    if (response.status === 429) throw new Error("OpenRouter rate limit hit. Will retry.");
    throw new Error(`AI service error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || content.trim() === "") throw new Error("AI returned empty response. Please try again.");

  // Capture token usage + cost for logging
  if (data.usage) {
    const costHeader = response.headers.get("x-openrouter-cost");
    addUsage({
      prompt_tokens: data.usage.prompt_tokens ?? 0,
      completion_tokens: data.usage.completion_tokens ?? 0,
      total_tokens: data.usage.total_tokens ?? 0,
      cost: costHeader ? parseFloat(costHeader) : (data.usage.cost ?? undefined),
    });
  }

  // Capture raw exchange for debugging (stored in ai_generation_jobs)
  captureExchange({
    ...(chunkIndex !== undefined ? { chunk_index: chunkIndex } : {}),
    messages,
    model,
    max_tokens,
    raw_response: content,
  });

  return content;
}

// ── Parse JSON from AI content (strips markdown fences if present) ─────────────

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const stripped = content.replace(/^```json\n?/i, "").replace(/\n?```$/i, "").trim();
    try {
      return JSON.parse(stripped);
    } catch {
      throw new Error("AI returned invalid JSON. Will retry.");
    }
  }
}

// ── callOpenRouter with JSON parse retry (up to 3 attempts) ──────────────────
// Used by all job types that need a parsed JSON response.
async function callOpenRouterJson(
  apiKey: string,
  model: string,
  messages: Message[],
  max_tokens: number | undefined,
  temperature: number,
  response_format: { type: string },
  chunkIndex?: number
): Promise<unknown> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const content = await callOpenRouter(apiKey, model, messages, max_tokens, temperature, response_format, chunkIndex);
      return parseJson(content);
    } catch (err: unknown) {
      lastError = err as Error;
      const msg = lastError.message ?? "";
      // Only retry on JSON parse failures — not on auth/rate/timeout errors
      if (!msg.includes("invalid JSON") && !msg.includes("empty response")) throw lastError;
      console.warn(`attempt ${attempt}/3 failed with: ${msg}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError;
}

// ── Unified log writer ────────────────────────────────────────────────────────
// Writes to error_logs with source/category/title so the Logs page can show
// AI job activity alongside DM errors in one unified view.

async function writeLog(
  supabase: ReturnType<typeof getMainSupabase>,
  opts: {
    client_ghl_account_id: string;
    severity: "info" | "error" | "warning";
    source: string;
    category: string;
    title: string;
    error_type: string;
    error_message: string;
    job_id?: string;
    context?: Record<string, unknown>;
  }
) {
  try {
    await supabase.from("error_logs").insert({
      client_ghl_account_id: opts.client_ghl_account_id,
      severity: opts.severity,
      source: opts.source,
      category: opts.category,
      title: opts.title,
      error_type: opts.error_type,
      error_message: opts.error_message,
      job_id: opts.job_id ?? null,
      context: opts.context ?? {},
      created_at: new Date().toISOString(),
    });
  } catch {
    // Never let logging failure break the main flow
  }
}

// ── Main task ─────────────────────────────────────────────────────────────────

export const runAiJob = task({
  id: "run-ai-job",
  maxDuration: 3600,
  retry: { maxAttempts: 3 },

  run: async (payload: AiJobPayload, { ctx }: any) => {
    const supabase = getMainSupabase();
    const { job_id, client_id, job_type } = payload;
    const triggerRunId: string | undefined = ctx?.run?.id;

    const updateJob = async (fields: Record<string, unknown>) => {
      await supabase.from("ai_generation_jobs").update(fields).eq("id", job_id);
    };

    try {
      await updateJob({ status: "running", started_at: new Date().toISOString() });

      // Get client's OpenRouter API key + preferred model + GHL account ID for logging
      const { data: clientData, error: clientError } = await supabase
        .from("clients")
        .select("openrouter_api_key, llm_model, ghl_location_id")
        .eq("id", client_id)
        .single();

      if (clientError || !clientData?.openrouter_api_key) {
        throw new Error("OpenRouter API key is not configured. Please add it in API Credentials.");
      }

      const model = clientData.llm_model ?? "google/gemini-2.5-pro";
      const ghlAccountId = clientData.ghl_location_id ?? client_id;
      const startedAt = Date.now();
      resetUsage();
      resetRawExchanges();
      let result: unknown;

      // ── modify-prompt-ai / modify-mini-prompt-ai: plain text response ────────
      if (job_type === "modify-prompt-ai" || job_type === "modify-mini-prompt-ai") {
        if (!payload.messages) throw new Error("messages required for this job type");

        const content = await callOpenRouter(
          clientData.openrouter_api_key,
          model,
          payload.messages,
          payload.max_tokens,
          payload.temperature ?? 0.3,
          { type: "text" }
        );

        // Try to parse as JSON first (in case AI wrapped it)
        // Otherwise treat entire content as the modified prompt
        let modifiedPrompt = content;
        let summary = "Prompt has been modified. Review the changes below.";

        try {
          const parsed = parseJson(content) as Record<string, unknown>;
          if (parsed.modifiedPrompt) {
            modifiedPrompt = parsed.modifiedPrompt as string;
            summary = (parsed.summary as string) ?? summary;
          }
        } catch {
          // Raw text — use as-is
        }

        result = { modifiedPrompt, summary };

      // ── All other job types: single JSON call ─────────────────────────────────
      } else {
        if (!payload.messages) throw new Error("messages required for this job type");

        // Always enforce 32k minimum for all JSON job types — reasoning models need headroom
        if ((payload.max_tokens ?? 0) < 32000) {
          payload.max_tokens = 32000;
        }

        if (job_type === "generate-setter-config") {
          // ── generate-setter-config: parallel chunked requests ─────────────────
          // Split parameters into chunks of ~8 and fire all in parallel.
          // Each chunk gets the full company context + user notes + new system prompt.
          // Results are merged into one object. Much faster than one huge request.

          const SETTER_CONFIG_SYSTEM_PROMPT = `You are the world's best AI sales setter prompt writer. You write mini-prompts that make AI setters sound like they were born and raised inside a specific industry, working for a specific company, talking to a specific type of lead.

## YOUR JOB
You receive: a company profile, an ICP, a lead source, user notes, and a batch of setter parameters with their default prompts.
You output: a personalized version of every parameter prompt in the batch — rewritten from scratch using the company's world, language, and context.

## IF CONTEXT IS MISSING
If the company name, knowledge base, ICP, or mission are blank, "Not specified", or clearly placeholder/gibberish text (less than 10 meaningful words total across all fields), do NOT invent a niche or industry. Instead:
- Write every prompt in a fully neutral, business-agnostic way
- Use [Company], [Product/Service], [Lead] as placeholders instead of naming a specific industry
- Do NOT reference agencies, setters, roofing, SaaS, or any other niche
- The output should read as a clean template a business of ANY type could fill in

## THE MOST IMPORTANT RULE: NO GENERIC LINES
Every single line you write must feel like it was written specifically for THIS business.
- If they sell AI setters to agencies → every example uses agencies, clients, lead follow-up, GHL, setters
- If they use slang → use that slang throughout
- If they're casual and direct → write casual and direct
- If their leads come from a waitlist → write for a warm waitlist lead, not a cold stranger
- NEVER write a line that could apply to any random business. If it could work for a dentist AND a SaaS company AND a realtor — it's too generic. Rewrite it.

## HOW TO PERSONALIZE
- Use the actual words, phrases, and jargon their leads use every day
- Reference their specific offer, service type, and delivery model
- If the user notes describe a persona (e.g. "talk like Gary, casual, uses slang") — write every prompt in that voice
- Replace every generic example with an example from their world
- If a parameter mentions "the product" — name it. If it mentions "the lead" — describe them specifically
- The setter reading these prompts should instantly feel like: "yes, I know exactly what I'm doing, who I'm talking to, and how I talk"

## WRITING STYLE
- Short sentences. Simple words. Direct instructions.
- DO this. DON'T do that. SAY this. NEVER say that.
- Use **BOLD**, UPPERCASE, ✅ and ❌ for rules that can't be missed
- Write like you're briefing a human rep who just joined the team — give them the real talk, not the corporate handbook
- Use the industry's natural slang and vocabulary where appropriate — not forced, just natural
- Every prompt should read like it was written by someone who has been in this industry for years

## OUTPUT FORMAT — FOLLOW THIS EXACTLY
Return a single valid JSON object. Nothing else. No markdown code fences. No comments. No text before or after the JSON.

The JSON must contain:
1. One key per parameter option using format "parameterKey::optionValue" for each option. For single-prompt parameters: just "parameterKey". Every option listed in the input MUST appear — do NOT skip any.
2. A "_selections" key: a flat object mapping every parameter name in this batch to the recommended option value. Boolean params use "enabled" or "disabled". Numeric params use the number as a string.

If you skip any parameter or any option the configuration will be broken. Every key in the input must have a corresponding key in the output.`;

          const userMessage = payload.messages.find(m => m.role === "user");
          if (!userMessage) throw new Error("No user message found in payload");

          // Split user message into: context block (everything before ## PARAMETERS TO PERSONALIZE)
          // and individual parameter blocks (each starts with ###)
          const userContent = userMessage.content;
          const paramsMarker = "## PARAMETERS TO PERSONALIZE";
          const markerIdx = userContent.indexOf(paramsMarker);

          let contextBlock = userContent;
          let paramBlocks: string[] = [];

          if (markerIdx !== -1) {
            contextBlock = userContent.slice(0, markerIdx).trim();
            const paramsSection = userContent.slice(markerIdx + paramsMarker.length).trim();
            // Split on ### but keep the ### prefix
            paramBlocks = paramsSection.split(/(?=^###)/m).map(s => s.trim()).filter(Boolean);
          }

          const CHUNK_SIZE = 8;
          const chunks: string[][] = [];
          for (let i = 0; i < paramBlocks.length; i += CHUNK_SIZE) {
            chunks.push(paramBlocks.slice(i, i + CHUNK_SIZE));
          }

          // If no parameter blocks found (unexpected format), fall back to single request
          if (chunks.length === 0) {
            chunks.push([userContent]);
          }

          // Fire all chunks in parallel
          const chunkResults = await Promise.all(
            chunks.map(async (chunkParams, idx) => {
              const chunkUserContent = contextBlock
                + "\n\n## PARAMETERS TO PERSONALIZE\n"
                + chunkParams.join("\n\n")
                + "\n\nReturn ONLY a valid JSON object where keys are parameter keys and values are the personalized prompt strings. Include a _selections object for this batch.";

              return await callOpenRouterJson(
                clientData.openrouter_api_key,
                model,
                [
                  { role: "system", content: SETTER_CONFIG_SYSTEM_PROMPT },
                  { role: "user", content: chunkUserContent },
                ],
                payload.max_tokens,
                payload.temperature ?? 0.3,
                { type: "json_object" },
                idx
              ) as Record<string, unknown>;
            })
          );

          // Merge all chunk results — combine prompt keys and merge _selections
          const merged: Record<string, unknown> = {};
          const mergedSelections: Record<string, unknown> = {};

          for (const chunkResult of chunkResults) {
            for (const [key, value] of Object.entries(chunkResult)) {
              if (key === "_selections" && typeof value === "object" && value !== null) {
                Object.assign(mergedSelections, value);
              } else {
                merged[key] = value;
              }
            }
          }
          // If preserve_selections was passed (e.g. copy setter), override AI-generated selections
          // with the original setter's values so option choices are not re-decided by the AI.
          if (payload.preserve_selections && Object.keys(payload.preserve_selections).length > 0) {
            Object.assign(mergedSelections, payload.preserve_selections);
            console.log(`preserve_selections applied: overrode ${Object.keys(payload.preserve_selections).length} selection(s)`);
          }

          merged["_selections"] = mergedSelections;

          result = { personalizedPrompts: merged };

        } else {
          // ── All other job types: single JSON call ───────────────────────────
          result = await callOpenRouterJson(
            clientData.openrouter_api_key,
            model,
            payload.messages,
            payload.max_tokens,
            payload.temperature ?? 0.3,
            payload.response_format ?? { type: "json_object" }
          );
        }
      }

      const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      const usage = getLastUsage();

      // Log usage (non-critical)
      try {
        await supabase.from("openrouter_usage").insert({
          client_id,
          job_type,
          model,
          prompt_tokens: usage?.prompt_tokens ?? null,
          completion_tokens: usage?.completion_tokens ?? null,
          total_tokens: usage?.total_tokens ?? null,
          cost_usd: usage?.cost ?? null,
          created_at: new Date().toISOString(),
        });
      } catch { /* ignore — table may not have new columns yet */ }

      const rawExchanges = getRawExchanges();
      await updateJob({
        status: "completed",
        result,
        error_message: null,
        completed_at: new Date().toISOString(),
        raw_exchanges: rawExchanges.length > 0 ? rawExchanges : null,
      });

      // Log success to unified logs table
      const usageSummary = usage
        ? ` | ${usage.prompt_tokens}→${usage.completion_tokens} tokens${usage.cost !== undefined ? ` | $${usage.cost.toFixed(4)}` : ""}`
        : "";
      await writeLog(supabase, {
        client_ghl_account_id: ghlAccountId,
        severity: "info",
        source: "run_ai_job",
        category: "openrouter",
        title: `${job_type} completed`,
        error_type: "ai_job_completed",
        error_message: `${job_type} completed in ${durationSeconds}s using ${model}${usageSummary}`,
        job_id,
        context: { job_type, model, job_id, trigger_run_id: triggerRunId, duration_seconds: parseFloat(durationSeconds), ...(usage ?? {}) },
      });

      return { status: "completed", job_id };

    } catch (error) {
      const errorMessage = (error as Error).message;

      // Classify error source for better debugging
      let category = "system";
      let title = `${job_type} failed`;
      if (errorMessage.includes("invalid JSON") || errorMessage.includes("empty response")) {
        category = "openrouter";
        title = "AI returned invalid response";
      } else if (errorMessage.includes("timed out")) {
        category = "openrouter";
        title = "AI request timed out";
      } else if (errorMessage.includes("API key")) {
        category = "credentials";
        title = "OpenRouter API key error";
      } else if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
        category = "openrouter";
        title = "OpenRouter rate limit hit";
      } else if (errorMessage.includes("credits") || errorMessage.includes("402")) {
        category = "credits";
        title = "Insufficient OpenRouter credits";
      }

      // Write to unified logs so it shows on the Logs page
      if (typeof ghlAccountId !== "undefined") {
        await writeLog(supabase, {
          client_ghl_account_id: ghlAccountId,
          severity: "error",
          source: "run_ai_job",
          category,
          title,
          error_type: `ai_job_failed`,
          error_message: errorMessage,
          job_id,
          context: { job_type, model: clientData?.llm_model ?? "unknown", job_id, trigger_run_id: triggerRunId },
        });
      }

      const rawExchangesOnError = getRawExchanges();
      await updateJob({
        status: "failed",
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
        raw_exchanges: rawExchangesOnError.length > 0 ? rawExchangesOnError : null,
      });
      throw error;
    }
  },
});
