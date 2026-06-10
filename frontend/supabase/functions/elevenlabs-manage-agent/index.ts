import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const AGENT_NAME = "1Prompt Setter";

// Helper to build a webhook tool config in the format ElevenLabs Create Tool API expects
function buildWebhookToolConfig(
  name: string,
  description: string,
  functionType: string,
  bodyDescription: string,
  bodyProperties: Record<string, { type: string; description: string }>,
  requiredBodyFields: string[],
  timeoutSecs = 30
) {
  // Convert bodyProperties to dict format ElevenLabs expects: { paramName: { type, description, ... } }
  const propertiesDict: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(bodyProperties)) {
    propertiesDict[key] = {
      type: val.type,
      value_type: "dynamic",
      description: val.description,
      dynamic_variable: "",
      constant_value: "",
      enum: null,
      is_system_provided: false,
      required: requiredBodyFields.includes(key),
    };
  }

  // query_params_schema must be wrapped in { type: "object", properties: { ... } }
  const queryParamsDict: Record<string, unknown> = {
    functionType: {
      type: "string",
      value_type: "constant",
      description: "",
      constant_value: functionType,
      enum: null,
      is_system_provided: false,
      required: true,
    },
  };

  return {
    type: "webhook",
    name,
    description,
    force_pre_tool_speech: true,
    execution_mode: "immediate",
    api_schema: {
      url: "https://n8n-1prompt.99players.com/webhook/n8n-11labs-booking-caller",
      method: "POST",
      path_params_schema: {},
      query_params_schema: {
        type: "object",
        description: "Query parameters",
        properties: queryParamsDict,
        required: ["functionType"],
      },
      request_body_schema: {
        type: "object",
        description: bodyDescription,
        properties: propertiesDict,
        required: requiredBodyFields,
      },
      request_headers: {},
    },
    response_timeout_secs: timeoutSecs,
  };
}

// Default tool templates that are auto-created with every new agent
const DEFAULT_TOOL_TEMPLATES = [
  buildWebhookToolConfig(
    "get_contact",
    "Use this tool to search contacts in the system",
    "get_contact",
    "Extract the following from the conversation to look up the contact:\n\nemail: The user's email address as provided during the conversation. This is used to check if the user already exists as a contact in the system.",
    {
      email: { type: "string", description: "The email of the user." },
    },
    ["email"]
  ),
  buildWebhookToolConfig(
    "get-available-slots",
    "Use this function to get the list of appointments. Use the timezone given by the get-timezone function. Use the startDateTime given by the user to get the list of appointments.",
    "get-available-slots",
    "Extract the following from the conversation to check available appointment slots:\n\ntimeZone: The user's timezone as a valid IANA timezone string (e.g., \"America/New_York\", \"Asia/Kolkata\"). If the user gives a city name or abbreviation like \"EST\" or \"IST\", convert it to the correct IANA format.\n\nstartDateTime: The beginning of the day the user wants to check availability for. Set this to the start of that day in ISO 8601 format (e.g., \"2026-03-15T00:00:00\").\nendDateTime: The end of the same day. Set this to the last moment of that day in ISO 8601 format (e.g., \"2026-03-15T23:59:59\").\n\nemail: The user's email address as provided during the conversation.",
    {
      timeZone: { type: "string", description: "The timezone of the user for which the availability will be checked." },
      startDateTime: { type: "string", description: "The start date and time for the booking window. Set to the beginning of the selected day (e.g., 2025-06-19T00:00:00)." },
      endDateTime: { type: "string", description: "The end date and time for the booking window. Set to the end of the selected day (e.g., 2025-06-19T23:59:59)." },
      email: { type: "string", description: "The email address of the user requesting the booking." },
    },
    ["timeZone", "startDateTime", "endDateTime", "email"]
  ),
  buildWebhookToolConfig(
    "book-appointments",
    "Use this function to book the appointments. Use the user's timezone, email, and booking date and time.",
    "book-appointments",
    "Extract the following from the conversation to book the appointment:\n\nemail: The user's email address as provided during the conversation. This is required to create the booking.\ntimeZone: The user's timezone as a valid IANA timezone string.\nstartDateTime: The exact date and time the user wants to book. Format as ISO 8601 (e.g., \"2026-03-15T10:00:00\")",
    {
      timeZone: { type: "string", description: "The timeZone of the user." },
      email: { type: "string", description: "The email of the user." },
      startDateTime: { type: "string", description: "The startDateTime of the user. Example Format: 2025-06-27T18:30:00+05:30 (Make sure to have the correct timezone according to the user)" },
    },
    ["timeZone", "email", "startDateTime"],
    20
  ),
  buildWebhookToolConfig(
    "get-contact-appointments",
    "Use this function to get the contact appointment when user ask to update the booking. Use the contact Id by finding the contact through get-contact function. Use the timezone determined by the user location.",
    "get-contact-appointments",
    "Extract the following from the conversation to retrieve the user's existing appointments:\n\nemail: The user's email address as provided during the conversation.\n\ntimeZone: The user's timezone as a valid IANA timezone string.",
    {
      timeZone: { type: "string", description: "The timeZone of the user." },
      email: { type: "string", description: "The email of the user." },
    },
    ["timeZone", "email"]
  ),
  buildWebhookToolConfig(
    "update-appointment",
    'Use this function to update the appointment. Use the eventId from the appointment chosen by the user. Use the timezone given by the user and startDateTime given by user from the list of slots or directly. Use the "id" from the appointment list as the eventId which is chosen by the user from the list.',
    "update-appointment",
    'Extract the following from the conversation to update the appointment:\n\neventId: The "id" from the appointment list that the user selected.\n\ntimeZone: The user\'s timezone as a valid IANA timezone string.\n\nstartDateTime: The new date and time the user wants to reschedule to. Format as ISO 8601.\n\nemail: The user\'s email address.',
    {
      timeZone: { type: "string", description: "The timeZone of the user." },
      eventId: { type: "string", description: "The eventId of the user." },
      startDateTime: { type: "string", description: "The startDateTime of the user. for example (2025-07-02T13:30:00-07:00)" },
      email: { type: "string", description: "The email address of the user." },
    },
    ["timeZone", "eventId", "startDateTime", "email"]
  ),
  buildWebhookToolConfig(
    "cancel-appointments",
    'Use this function to cancel the event. User will select from the given list of user\'s appointments. Use the eventId of that appointment. Get the eventId from the appointment which user choose to cancel.',
    "cancel-appointments",
    'Extract the following from the conversation to cancel the appointment:\n\neventId: The "id" from the appointment list that the user selected to cancel.\n\nemail: The user\'s email address.',
    {
      email: { type: "string", description: "The email address associated with the appointment." },
      eventId: { type: "string", description: "The eventId of the appointment." },
    },
    ["email", "eventId"]
  ),
];

async function elevenLabsRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
) {
  const opts: RequestInit = {
    method,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
  };
  if (body && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs API error [${res.status}]: ${text}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return {};
}

// Create a single tool in ElevenLabs and return its ID
async function createTool(apiKey: string, toolConfig: Record<string, unknown>): Promise<string> {
  console.log(`Creating tool: ${toolConfig.name}, sending payload...`);
  const result = await elevenLabsRequest(apiKey, "POST", "/convai/tools", {
    tool_config: toolConfig,
  });
  console.log(`Tool created successfully:`, JSON.stringify(result));
  return result.id || result.tool_id;
}

// Create all default tools and return array of tool IDs
async function createDefaultTools(apiKey: string): Promise<string[]> {
  const toolIds: string[] = [];
  for (const template of DEFAULT_TOOL_TEMPLATES) {
    try {
      const toolId = await createTool(apiKey, template);
      if (toolId) {
        toolIds.push(toolId);
        console.log(`Created tool "${template.name}" with ID: ${toolId}`);
      } else {
        console.error(`Tool "${template.name}" created but no ID returned`);
      }
    } catch (e) {
      console.error(`Failed to create tool "${template.name}":`, e.message || e);
    }
  }
  return toolIds;
}

// Delete tools by their IDs
async function deleteTools(apiKey: string, toolIds: string[]): Promise<void> {
  for (const toolId of toolIds) {
    try {
      await elevenLabsRequest(apiKey, "DELETE", `/convai/tools/${toolId}`);
      console.log(`Deleted tool: ${toolId}`);
    } catch (e) {
      console.error(`Failed to delete tool ${toolId}:`, e);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, clientId, ...params } = await req.json();

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    // Fetch client's ElevenLabs API key and stored IDs
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select(
        "elevenlabs_api_key, elevenlabs_agent_id, elevenlabs_phone_number_id, elevenlabs_kb_doc_id, elevenlabs_agent_config"
      )
      .eq("id", clientId)
      .single();

    if (clientError || !client) {
      throw new Error("Client not found");
    }

    const apiKey = client.elevenlabs_api_key;
    if (!apiKey && action !== "save-api-key" && action !== "get-status") {
      throw new Error("ElevenLabs API key not configured");
    }

    let result: Record<string, unknown> = {};

    switch (action) {
      case "save-api-key": {
        const { error } = await supabase
          .from("clients")
          .update({ elevenlabs_api_key: params.apiKey })
          .eq("id", clientId);
        if (error) throw error;
        result = { success: true };
        break;
      }

      case "list-voices": {
        const voicesData = await elevenLabsRequest(apiKey!, "GET", "/voices");
        const voices = (voicesData.voices || []).map((v: Record<string, unknown>) => ({
          voice_id: v.voice_id,
          name: v.name,
          preview_url: v.preview_url || null,
          category: v.category || "unknown",
          labels: v.labels || {},
        }));
        result = { voices };
        break;
      }

      case "list-llms": {
        const llmData = await elevenLabsRequest(apiKey!, "GET", "/convai/llm/list");
        const llms = (llmData.llms || []).map((l: Record<string, unknown>) => {
          const llmId = (l.llm as string) || "";
          let provider = "other";
          if (llmId.startsWith("gpt-") || llmId.startsWith("o1") || llmId.startsWith("o3") || llmId.startsWith("o4")) provider = "openai";
          else if (llmId.includes("gemini")) provider = "google";
          else if (llmId.includes("claude")) provider = "anthropic";
          else if (llmId.includes("grok")) provider = "xai";
          else if (llmId.includes("llama") || llmId.includes("deepseek")) provider = "meta";
          const deprecation = l.deprecation_config as Record<string, unknown> | null;
          const isDeprecated = l.is_deprecated === true || (deprecation?.deprecation_date != null);
          return {
            model_id: llmId,
            display_name: llmId,
            provider,
            is_deprecated: isDeprecated,
            latency: null,
            cost_per_minute: null,
          };
        });
        result = { llms };
        break;
      }

      case "deploy-agent": {
        const agentConfig = params.agentConfig;

        // Step 1: Create all default tools first
        console.log("Creating default tools for new agent...");
        const toolIds = await createDefaultTools(apiKey!);
        console.log(`Created ${toolIds.length} tools:`, toolIds);

        // Step 2: Create agent with tool_ids linked
        const createBody: Record<string, unknown> = {
          conversation_config: {
            agent: {
              prompt: {
                prompt: agentConfig.systemPrompt,
                llm: agentConfig.llmModel || "gemini-2.5-flash",
                knowledge_base: [],
                rag: { enabled: true },
                tool_ids: toolIds,
              },
              first_message: agentConfig.firstMessage,
              language: agentConfig.language || "en",
            },
            asr: {
              quality: "high",
            },
            tts: {
              voice_id: agentConfig.voiceId,
            },
          },
          name: AGENT_NAME,
          tags: ["one-prompt", "1prompt-setter"],
        };

        const agentResult = await elevenLabsRequest(
          apiKey!,
          "POST",
          "/convai/agents/create",
          createBody
        );

        const agentId = agentResult.agent_id;

        // Store agent config with tool IDs
        const storedConfig = { ...agentConfig, tool_ids: toolIds };

        await supabase
          .from("clients")
          .update({
            elevenlabs_agent_id: agentId,
            elevenlabs_agent_config: storedConfig,
          })
          .eq("id", clientId);

        result = { agentId, toolIds, success: true };
        break;
      }

      case "update-agent": {
        const agentId = client.elevenlabs_agent_id;
        if (!agentId) throw new Error("No agent deployed yet");

        const agentConfig = params.agentConfig;
        const existingConfig = (client.elevenlabs_agent_config || {}) as Record<string, unknown>;
        const toolIds = (existingConfig.tool_ids as string[]) || [];

        const kbEntries: unknown[] = [];
        if (client.elevenlabs_kb_doc_id) {
          kbEntries.push({
            type: "text",
            id: client.elevenlabs_kb_doc_id,
            name: AGENT_NAME + " Knowledge Base",
          });
        }

        const updateBody = {
          conversation_config: {
            agent: {
              prompt: {
                prompt: agentConfig.systemPrompt,
                llm: agentConfig.llmModel || "gemini-2.5-flash",
                knowledge_base: kbEntries,
                rag: { enabled: true },
                tool_ids: toolIds,
              },
              first_message: agentConfig.firstMessage,
              language: agentConfig.language || "en",
            },
            tts: {
              voice_id: agentConfig.voiceId,
            },
          },
        };

        await elevenLabsRequest(
          apiKey!,
          "PATCH",
          `/convai/agents/${agentId}`,
          updateBody
        );

        const storedConfig = { ...agentConfig, tool_ids: toolIds };
        await supabase
          .from("clients")
          .update({ elevenlabs_agent_config: storedConfig })
          .eq("id", clientId);

        result = { success: true };
        break;
      }

      case "delete-agent": {
        // Delete tools first (ignore 404s for already-deleted tools)
        const existingConfig = (client.elevenlabs_agent_config || {}) as Record<string, unknown>;
        const toolIds = (existingConfig.tool_ids as string[]) || [];
        if (toolIds.length > 0 && apiKey) {
          console.log("Deleting tools:", toolIds);
          await deleteTools(apiKey, toolIds);
        }

        if (client.elevenlabs_kb_doc_id && apiKey) {
          try {
            await elevenLabsRequest(
              apiKey,
              "DELETE",
              `/convai/knowledge-base/${client.elevenlabs_kb_doc_id}?force=true`
            );
          } catch (e) {
            console.error("Error deleting KB doc (may already be deleted):", e);
          }
        }

        if (client.elevenlabs_phone_number_id && apiKey) {
          try {
            await elevenLabsRequest(
              apiKey,
              "DELETE",
              `/convai/phone-numbers/${client.elevenlabs_phone_number_id}`
            );
          } catch (e) {
            console.error("Error deleting phone number (may already be deleted):", e);
          }
        }

        if (client.elevenlabs_agent_id && apiKey) {
          try {
            await elevenLabsRequest(
              apiKey,
              "DELETE",
              `/convai/agents/${client.elevenlabs_agent_id}`
            );
          } catch (e) {
            console.error("Error deleting agent (may already be deleted):", e);
          }
        }

        // Always clean up DB regardless of ElevenLabs API errors
        await supabase
          .from("clients")
          .update({
            elevenlabs_agent_id: null,
            elevenlabs_phone_number_id: null,
            elevenlabs_kb_doc_id: null,
            elevenlabs_agent_config: {},
          })
          .eq("id", clientId);

        result = { success: true };
        break;
      }

      case "import-phone": {
        const agentId = client.elevenlabs_agent_id;
        if (!agentId) throw new Error("Deploy an agent first before importing a phone number");

        const phoneResult = await elevenLabsRequest(
          apiKey!,
          "POST",
          "/convai/phone-numbers",
          {
            provider: "twilio",
            phone_number: params.phoneNumber,
            label: AGENT_NAME,
            sid: params.twilioSid,
            token: params.twilioToken,
          }
        );

        const phoneNumberId = phoneResult.phone_number_id;

        await elevenLabsRequest(
          apiKey!,
          "PATCH",
          `/convai/phone-numbers/${phoneNumberId}`,
          { agent_id: agentId }
        );

        await supabase
          .from("clients")
          .update({ elevenlabs_phone_number_id: phoneNumberId })
          .eq("id", clientId);

        result = { phoneNumberId, success: true };
        break;
      }

      case "remove-phone": {
        if (client.elevenlabs_phone_number_id) {
          await elevenLabsRequest(
            apiKey!,
            "DELETE",
            `/convai/phone-numbers/${client.elevenlabs_phone_number_id}`
          );

          await supabase
            .from("clients")
            .update({ elevenlabs_phone_number_id: null })
            .eq("id", clientId);
        }
        result = { success: true };
        break;
      }

      case "save-knowledge-base": {
        const agentId = client.elevenlabs_agent_id;
        if (!agentId) throw new Error("Deploy an agent first before adding knowledge base");

        if (client.elevenlabs_kb_doc_id) {
          try {
            await elevenLabsRequest(
              apiKey!,
              "DELETE",
              `/convai/knowledge-base/${client.elevenlabs_kb_doc_id}?force=true`
            );
          } catch (e) {
            console.error("Error deleting old KB doc:", e);
          }
        }

        const kbResult = await elevenLabsRequest(
          apiKey!,
          "POST",
          "/convai/knowledge-base/text",
          {
            text: params.knowledgeText,
            name: AGENT_NAME + " Knowledge Base",
          }
        );

        const kbDocId = kbResult.id;

        const existingConfig = (client.elevenlabs_agent_config || {}) as Record<string, unknown>;
        const toolIds = (existingConfig.tool_ids as string[]) || [];

        await elevenLabsRequest(
          apiKey!,
          "PATCH",
          `/convai/agents/${agentId}`,
          {
            conversation_config: {
              agent: {
                prompt: {
                  knowledge_base: [
                    {
                      type: "text",
                      id: kbDocId,
                      name: AGENT_NAME + " Knowledge Base",
                    },
                  ],
                  rag: { enabled: true },
                  tool_ids: toolIds,
                },
              },
            },
          }
        );

        await supabase
          .from("clients")
          .update({ elevenlabs_kb_doc_id: kbDocId })
          .eq("id", clientId);

        result = { kbDocId, success: true };
        break;
      }

      // ---- Tool management actions ----

      case "list-tools": {
        const existingConfig = (client.elevenlabs_agent_config || {}) as Record<string, unknown>;
        const toolIds = (existingConfig.tool_ids as string[]) || [];
        
        const tools: Record<string, unknown>[] = [];
        for (const toolId of toolIds) {
          try {
            const toolData = await elevenLabsRequest(apiKey!, "GET", `/convai/tools/${toolId}`);
            tools.push(toolData);
          } catch (e) {
            console.error(`Failed to fetch tool ${toolId}:`, e);
            tools.push({ tool_id: toolId, error: true, name: "Unknown (deleted?)" });
          }
        }
        result = { tools, toolIds };
        break;
      }

      case "update-tool": {
        const { toolId, toolConfig } = params;
        if (!toolId) throw new Error("toolId is required");
        
        await elevenLabsRequest(apiKey!, "PATCH", `/convai/tools/${toolId}`, {
          tool_config: toolConfig,
        });
        
        result = { success: true };
        break;
      }

      case "delete-tool": {
        const { toolId } = params;
        if (!toolId) throw new Error("toolId is required");
        
        await elevenLabsRequest(apiKey!, "DELETE", `/convai/tools/${toolId}`);
        
        // Remove from stored tool_ids
        const existingConfig2 = (client.elevenlabs_agent_config || {}) as Record<string, unknown>;
        const currentToolIds = (existingConfig2.tool_ids as string[]) || [];
        const updatedToolIds = currentToolIds.filter((id: string) => id !== toolId);
        
        await supabase
          .from("clients")
          .update({ 
            elevenlabs_agent_config: { ...existingConfig2, tool_ids: updatedToolIds } 
          })
          .eq("id", clientId);
        
        // Also update the agent to remove the tool_id
        if (client.elevenlabs_agent_id) {
          try {
            await elevenLabsRequest(apiKey!, "PATCH", `/convai/agents/${client.elevenlabs_agent_id}`, {
              conversation_config: {
                agent: {
                  prompt: {
                    tool_ids: updatedToolIds,
                  },
                },
              },
            });
          } catch (e) {
            console.error("Error updating agent tool_ids:", e);
          }
        }
        
        result = { success: true, toolIds: updatedToolIds };
        break;
      }

      case "add-tool": {
        const { toolConfig: newToolConfig } = params;
        if (!newToolConfig) throw new Error("toolConfig is required");
        
        const newToolId = await createTool(apiKey!, newToolConfig);
        
        // Add to stored tool_ids
        const existingConfig3 = (client.elevenlabs_agent_config || {}) as Record<string, unknown>;
        const currentIds = (existingConfig3.tool_ids as string[]) || [];
        const newIds = [...currentIds, newToolId];
        
        await supabase
          .from("clients")
          .update({ 
            elevenlabs_agent_config: { ...existingConfig3, tool_ids: newIds } 
          })
          .eq("id", clientId);
        
        // Update agent
        if (client.elevenlabs_agent_id) {
          try {
            await elevenLabsRequest(apiKey!, "PATCH", `/convai/agents/${client.elevenlabs_agent_id}`, {
              conversation_config: {
                agent: {
                  prompt: {
                    tool_ids: newIds,
                  },
                },
              },
            });
          } catch (e) {
            console.error("Error updating agent tool_ids:", e);
          }
        }
        
        result = { success: true, toolId: newToolId, toolIds: newIds };
        break;
      }

      case "get-status": {
        const existingConfig = (client.elevenlabs_agent_config || {}) as Record<string, unknown>;
        const toolIds = (existingConfig.tool_ids as string[]) || [];
        result = {
          hasApiKey: !!client.elevenlabs_api_key,
          agentId: client.elevenlabs_agent_id,
          phoneNumberId: client.elevenlabs_phone_number_id,
          kbDocId: client.elevenlabs_kb_doc_id,
          agentConfig: client.elevenlabs_agent_config || {},
          toolIds,
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
