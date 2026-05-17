import { createClient } from "npm:@supabase/supabase-js@2";
import { loggedFetch, logRequest } from "../_shared/request-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_BOOKING_MESSAGES = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { simulationId, personaId } = await req.json();

    if (!simulationId && !personaId) {
      return new Response(JSON.stringify({ error: "Missing simulationId or personaId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let simId = simulationId;
    let persona: any = null;

    if (personaId) {
      const { data: p, error: pErr } = await supabase
        .from("simulation_personas")
        .select("*")
        .eq("id", personaId)
        .single();
      if (pErr || !p) throw new Error("Persona not found");
      persona = p;
      simId = p.simulation_id;
    }

    const { data: simulation, error: simError } = await supabase
      .from("simulations")
      .select("*")
      .eq("id", simId)
      .single();
    if (simError || !simulation) throw new Error("Simulation not found");

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("simulation_webhook, ghl_location_id, openrouter_api_key")
      .eq("id", simulation.client_id)
      .single();
    if (clientError || !client?.simulation_webhook) {
      throw new Error("Client simulation_webhook not configured. Please add your Simulation webhook URL in the credentials page.");
    }
    if (!client?.openrouter_api_key) {
      throw new Error("OpenRouter API key not configured. Please add it in API Credentials.");
    }

    const webhookBaseUrl = client.simulation_webhook;
    const openrouterApiKey = client.openrouter_api_key as string;

    // If no specific persona, set simulation status and queue all runnable personas.
    if (!personaId) {
      await supabase
        .from("simulations")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", simId);

      const { data: runnablePersonas, error: runnableErr } = await supabase
        .from("simulation_personas")
        .select("id")
        .eq("simulation_id", simId)
        .in("status", ["pending", "in_progress"]);

      if (runnableErr) throw runnableErr;

      for (const runnablePersona of runnablePersonas || []) {
        enqueuePersonaRun(supabaseUrl, supabaseKey, simId, runnablePersona.id);
      }

      return new Response(JSON.stringify({
        message: `Simulation launched. Queued ${(runnablePersonas || []).length} personas.`,
        queuedPersonas: (runnablePersonas || []).length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Re-fetch persona & simulation status to catch stops/errors set between enqueue and execution ──
    const { data: freshPersona } = await supabase
      .from("simulation_personas")
      .select("status")
      .eq("id", persona.id)
      .single();

    const freshPersonaStatus = freshPersona?.status || persona.status;

    if (freshPersonaStatus === "complete" || freshPersonaStatus === "error") {
      return new Response(JSON.stringify({
        message: `Persona ${persona.name} already ${freshPersonaStatus}`,
        status: freshPersonaStatus,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if simulation was stopped/ended
    const { data: freshSim } = await supabase
      .from("simulations")
      .select("status")
      .eq("id", simId)
      .single();

    if (freshSim?.status === "ended" || freshSim?.status === "complete" || freshSim?.status === "error") {
      console.log(`[Simulation] Simulation ${simId} is ${freshSim.status}, skipping persona ${persona.name}`);
      return new Response(JSON.stringify({
        message: `Simulation already ${freshSim.status}, skipping persona ${persona.name}`,
        status: freshSim.status,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let personaStatusAfterRun = persona.status;
    try {
      await supabase
        .from("simulation_personas")
        .update({ status: "in_progress" })
        .eq("id", persona.id);
      personaStatusAfterRun = "in_progress";

      // Fetch ICP profile for this persona to get lead type info
      let icpProfile: any = null;
      if (persona.icp_profile_id) {
        const { data: icp } = await supabase
          .from("simulation_icp_profiles")
          .select("first_message_sender, form_fields, outreach_message, first_message_detail")
          .eq("id", persona.icp_profile_id)
          .single();
        icpProfile = icp;
      }
      const leadType = icpProfile?.first_message_sender || 'inbound';

      const totalMessages = persona.assigned_message_count;
      const bookingIntent = persona.booking_intent || 'none';
      const hasBookingPhase = bookingIntent !== 'none';

      const { data: existingMessages } = await supabase
        .from("simulation_messages")
        .select("*")
        .eq("persona_id", persona.id)
        .order("message_order", { ascending: true });

      const orderedMessages = existingMessages || [];
      let messageOrder = orderedMessages.length > 0
        ? Math.max(...orderedMessages.map((m: any) => m.message_order || 0))
        : 0;

      const userMessages = orderedMessages.filter((m: any) => m.role === "user");
      const completedUserTurns = userMessages.length;

      const lastUserMsg = userMessages[userMessages.length - 1];
      const lastUserMsgOrder = lastUserMsg?.message_order || 0;
      const hasResponseForLastUser = lastUserMsg
        ? orderedMessages.some((m: any) => m.role === "assistant" && m.message_order > lastUserMsgOrder)
        : true;

      // Determine if we're in the booking phase
      // Booking phase starts after all regular messages are done
      const regularTurnsDone = completedUserTurns >= totalMessages && hasResponseForLastUser;
      const isInBookingPhase = hasBookingPhase && regularTurnsDone;

      // Count booking-phase user messages (those after the regular phase)
      const bookingUserMessages = userMessages.filter((_: any, idx: number) => idx >= totalMessages);
      const bookingTurnCount = bookingUserMessages.length;

      // Check if booking phase is also done
      const bookingPhaseDone = !hasBookingPhase || (isInBookingPhase && (
        bookingTurnCount >= MAX_BOOKING_MESSAGES || // Hit booking message cap
        // Check if booking interaction seems complete (last assistant msg contains booking confirmation keywords)
        orderedMessages.some((m: any) => m.role === "assistant" && m.message_order > lastUserMsgOrder &&
          (m.content?.toLowerCase().includes("booked") || m.content?.toLowerCase().includes("confirmed") ||
           m.content?.toLowerCase().includes("cancelled") || m.content?.toLowerCase().includes("rescheduled") ||
           m.content?.toLowerCase().includes("canceled")))
      ));

      const allDone = regularTurnsDone && (!hasBookingPhase || bookingPhaseDone);

      if (allDone && hasResponseForLastUser) {
        await supabase
          .from("simulation_personas")
          .update({ status: "complete" })
          .eq("id", persona.id);
        personaStatusAfterRun = "complete";
      } else {
        let userMessage: string;
        let needsNewUserMessage: boolean;
        let firstMessageType = 'regular';

        if (completedUserTurns > 0 && !hasResponseForLastUser) {
          userMessage = lastUserMsg.content;
          needsNewUserMessage = false;
          console.log(`[Simulation] Resending unanswered turn ${completedUserTurns}/${totalMessages} for persona ${persona.name}`);
        } else {
          const conversationHistory = orderedMessages.map((m: any) => ({
            role: m.role,
            content: m.content,
          }));

          const turnIndex = completedUserTurns;
          const isFirstMessage = turnIndex === 0;
          const isBookingTurn = isInBookingPhase || (regularTurnsDone && hasBookingPhase);

          // For the first message, generate differently based on lead type
          if (isFirstMessage && leadType === 'engagement') {
            // Form lead: generate a form submission message
            userMessage = await generateFormSubmissionMessage(
              openrouterApiKey,
              persona,
              icpProfile?.form_fields || '',
              icpProfile?.first_message_detail || '',
              simulation.business_info,
            );
            firstMessageType = 'form_submission';
          } else if (isFirstMessage && leadType === 'outreach_response') {
            // Outreach response: first insert the outreach message from the setter side, then generate lead's response
            const outreachMsg = icpProfile?.outreach_message || '';
            if (outreachMsg) {
              // Insert the outreach message as an "assistant" message (from our side)
              messageOrder++;
              await supabase.from("simulation_messages").insert({
                persona_id: persona.id,
                role: "assistant",
                content: outreachMsg,
                message_order: messageOrder,
                message_type: 'outreach',
              });
            }
            // Generate the lead's response to the outreach
            userMessage = await generateOutreachResponseMessage(
              openrouterApiKey,
              persona,
              outreachMsg,
              icpProfile?.first_message_detail || '',
              simulation.business_info,
            );
            firstMessageType = 'regular';
          } else {
            userMessage = await generateUserMessage(
              openrouterApiKey,
              persona,
              conversationHistory,
              turnIndex,
              totalMessages,
              simulation.business_info,
              simulation.test_goal,
              simulation.test_specifics,
              isBookingTurn,
              bookingTurnCount,
            );
          }
          needsNewUserMessage = true;

          messageOrder++;
          await supabase.from("simulation_messages").insert({
            persona_id: persona.id,
            role: "user",
            content: userMessage,
            message_order: messageOrder,
            message_type: isFirstMessage ? firstMessageType : 'regular',
          });
        }

        // Send to webhook
        const actualUserTurnCount = needsNewUserMessage ? completedUserTurns + 1 : completedUserTurns;
        const webhookUrl = new URL(webhookBaseUrl);

        // Use dummy contact info from persona
        const dummyEmail = persona.dummy_email || `1prompt-simulation-${persona.name.toLowerCase().replace(/\s+/g, '')}-${Math.random().toString(36).substring(2, 8)}@gmail.com`;
        const dummyPhone = persona.dummy_phone || `+1555${String(persona.age || 30).padStart(3, "0")}${String(messageOrder).padStart(4, "0")}`;

        // Set all data as query parameters to match n8n webhook format
        webhookUrl.searchParams.set("Message_Body", userMessage);
        webhookUrl.searchParams.set("Lead_ID", persona.id);
        webhookUrl.searchParams.set("GHL_Account_ID", client.ghl_location_id || simulation.client_id);
        webhookUrl.searchParams.set("Name", persona.name);
        webhookUrl.searchParams.set("Email", dummyEmail);
        webhookUrl.searchParams.set("Phone", dummyPhone);
        webhookUrl.searchParams.set("Setter_Number", String(simulation.agent_number));
        webhookUrl.searchParams.set("Simulation", "True");

        const webhookPayload = {};


        console.log(`[Simulation] Sending turn ${actualUserTurnCount}/${totalMessages}${isInBookingPhase ? ' (BOOKING)' : ''} for persona ${persona.name} to ${webhookUrl.toString()}`);

        const webhookResponse = await loggedFetch(
          webhookUrl.toString(),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(webhookPayload),
            signal: AbortSignal.timeout(180000),
          },
          {
            client_id: simulation.client_id,
            request_type: "webhook",
            source: "run-simulation",
            method: "POST",
            request_body: { persona_name: persona.name, turn: actualUserTurnCount, is_booking: isInBookingPhase },
          }
        );

        if (!webhookResponse.ok) {
          const errText = await webhookResponse.text();
          console.error(`Webhook error for persona ${persona.name}:`, errText);

          messageOrder++;
          await supabase.from("simulation_messages").insert({
            persona_id: persona.id,
            role: "assistant",
            content: `[ERROR: Webhook returned ${webhookResponse.status}] ${errText}`,
            message_order: messageOrder,
          });

          throw new Error(`Webhook failed with status ${webhookResponse.status}`);
        }

        const responseText = await webhookResponse.text();

        console.log(`[Simulation] Got response for persona ${persona.name}, turn ${actualUserTurnCount}`);

        const parsedWebhookResponse = parseWebhookResponse(responseText);

        if (parsedWebhookResponse.error) {
          console.error(`[Simulation] Webhook returned error in body for persona ${persona.name}:`, parsedWebhookResponse.error);
          messageOrder++;
          await supabase.from("simulation_messages").insert({
            persona_id: persona.id,
            role: "assistant",
            content: `[ERROR: Webhook error] ${parsedWebhookResponse.error}`,
            message_order: messageOrder,
          });
          throw new Error(`Webhook returned error: ${parsedWebhookResponse.error}`);
        }

        const agentMessages = parsedWebhookResponse.messages;

        if (agentMessages.length === 0) {
          console.error(`[Simulation] No assistant messages found in webhook response for persona ${persona.name}:`, responseText);
          messageOrder++;
          await supabase.from("simulation_messages").insert({
            persona_id: persona.id,
            role: "assistant",
            content: `[ERROR: Invalid webhook response] ${responseText.substring(0, 500)}`,
            message_order: messageOrder,
          });
          throw new Error("Webhook response did not contain any assistant messages");
        }

        console.log(`[Simulation] Parsed ${agentMessages.length} assistant message(s) for persona ${persona.name}`);

        for (const msg of agentMessages) {
          messageOrder++;
          await supabase.from("simulation_messages").insert({
            persona_id: persona.id,
            role: "assistant",
            content: msg,
            message_order: messageOrder,
          });
        }

        // Determine next status
        const newUserTurnCount = needsNewUserMessage ? completedUserTurns + 1 : completedUserTurns;
        const regularDoneNow = newUserTurnCount >= totalMessages;

        // If booking phase, check if we should continue or complete
        let nextStatus: string;
        if (hasBookingPhase) {
          if (!regularDoneNow) {
            nextStatus = "in_progress";
          } else {
            // Check booking phase completion
            const newBookingTurns = needsNewUserMessage && regularTurnsDone ? bookingTurnCount + 1 : bookingTurnCount;
            const bookingDoneNow = newBookingTurns >= MAX_BOOKING_MESSAGES ||
              agentMessages.some(msg =>
                msg.toLowerCase().includes("booked") || msg.toLowerCase().includes("confirmed") ||
                msg.toLowerCase().includes("cancelled") || msg.toLowerCase().includes("canceled") ||
                msg.toLowerCase().includes("rescheduled"));
            nextStatus = bookingDoneNow ? "complete" : "in_progress";
          }
        } else {
          nextStatus = regularDoneNow ? "complete" : "in_progress";
        }

        await supabase
          .from("simulation_personas")
          .update({ status: nextStatus })
          .eq("id", persona.id);

        personaStatusAfterRun = nextStatus;
      }
    } catch (err) {
      console.error(`Error processing persona ${persona.name}:`, err);
      const errorMessage = err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err);
      // Always flip persona out of in_progress, even if recovery UPDATE itself fails.
      // Without this nested guard, a recovery failure left personas stuck in_progress
      // and the run hung waiting for the "all done" check (Phase 7e regression).
      try {
        await supabase
          .from("simulation_personas")
          .update({ status: "error", error_message: errorMessage.slice(0, 2000) })
          .eq("id", persona.id);
      } catch (recoveryErr) {
        console.error(`Recovery UPDATE failed for persona ${persona.name}:`, recoveryErr);
      }
      personaStatusAfterRun = "error";
    }

    // Check if all personas are done → update simulation status
    const { data: allPersonas } = await supabase
      .from("simulation_personas")
      .select("status")
      .eq("simulation_id", simId);

    const allDone = allPersonas?.every((p: any) => p.status === "complete" || p.status === "error");
    if (allDone) {
      const allErrors = allPersonas?.every((p: any) => p.status === "error");
      await supabase
        .from("simulations")
        .update({
          status: allErrors ? "error" : "complete",
          updated_at: new Date().toISOString(),
        })
        .eq("id", simId);
    }

    if (personaStatusAfterRun === "in_progress") {
      enqueuePersonaRun(supabaseUrl, supabaseKey, simId, persona.id);
    }

    return new Response(JSON.stringify({
      message: `Persona ${persona.name} processed`,
      status: personaStatusAfterRun,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("run-simulation error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function enqueuePersonaRun(
  supabaseUrl: string,
  serviceRoleKey: string,
  simulationId: string,
  personaId: string
) {
  const invokePromise = fetch(`${supabaseUrl}/functions/v1/run-simulation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({ simulationId, personaId }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Simulation] Failed to enqueue persona ${personaId}:`, errorText);
      }
    })
    .catch((error) => {
      console.error(`[Simulation] Enqueue error for persona ${personaId}:`, error);
    });

  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(invokePromise);
  } else {
    void invokePromise;
  }
}

const WEBHOOK_MESSAGE_KEY_REGEX = /^Message_(\d+)$/i;

function parseWebhookResponse(responseText: string): { messages: string[]; error: string | null } {
  const trimmedResponse = responseText.trim();

  if (!trimmedResponse) {
    return { messages: [], error: "Empty webhook response" };
  }

  const payloads = extractWebhookPayloads(trimmedResponse);
  const messages = extractAssistantMessages(payloads);

  if (messages.length > 0) {
    return { messages, error: null };
  }

  const error = extractWebhookError(payloads);
  if (error) {
    return { messages: [], error };
  }

  if (payloads.length === 0) {
    return { messages: [trimmedResponse], error: null };
  }

  return { messages: [], error: "Invalid webhook response format" };
}

function extractWebhookPayloads(input: unknown): unknown[] {
  const collected: unknown[] = [];
  collectWebhookPayloads(input, collected);
  return collected;
}

function collectWebhookPayloads(value: unknown, collected: unknown[]) {
  if (value == null) return;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;

    const parsed = parseStructuredWebhookText(trimmed);
    if (parsed !== null) {
      collectWebhookPayloads(parsed, collected);
      return;
    }

    collected.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectWebhookPayloads(item, collected);
    }
    return;
  }

  if (typeof value === "object") {
    collected.push(value);

    const nestedKeys = ["content", "data", "payload", "body", "response", "result"];
    for (const key of nestedKeys) {
      if (key in value) {
        collectWebhookPayloads((value as Record<string, unknown>)[key], collected);
      }
    }
  }
}

function parseStructuredWebhookText(text: string): unknown[] | unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length <= 1) {
      return null;
    }

    const parsedLines: unknown[] = [];
    for (const line of lines) {
      const normalizedLine = line.startsWith("data:") ? line.slice(5).trim() : line;
      try {
        parsedLines.push(JSON.parse(normalizedLine));
      } catch {
        return null;
      }
    }

    return parsedLines;
  }
}

function extractAssistantMessages(payloads: unknown[]): string[] {
  const messages: string[] = [];
  const seen = new Set<string>();

  for (const payload of payloads) {
    if (typeof payload === "string") {
      const normalized = payload.trim();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        messages.push(normalized);
      }
      continue;
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }

    const entries = Object.entries(payload as Record<string, unknown>)
      .map(([key, value]) => ({ key, value, match: key.match(WEBHOOK_MESSAGE_KEY_REGEX) }))
      .filter((entry) => entry.match && typeof entry.value === "string" && entry.value.trim())
      .sort((a, b) => Number(a.match?.[1] || 0) - Number(b.match?.[1] || 0));

    for (const entry of entries) {
      const normalized = (entry.value as string).trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        messages.push(normalized);
      }
    }
  }

  return messages;
}

function extractWebhookError(payloads: unknown[]): string | null {
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }

    const record = payload as Record<string, unknown>;
    const errorDetail =
      record.error ??
      record.Error ??
      record.errorMessage ??
      record.error_message ??
      (record.status === "error" ? record.message ?? record.details ?? record.reason ?? "Unknown webhook error" : null);

    if (typeof errorDetail === "string" && errorDetail.trim()) {
      return errorDetail.trim();
    }

    if (errorDetail && typeof errorDetail === "object") {
      return JSON.stringify(errorDetail);
    }
  }

  return null;
}

async function generateUserMessage(
  apiKey: string,
  persona: any,
  conversationHistory: { role: string; content: string }[],
  turnIndex: number,
  totalTurns: number,
  businessInfo: string,
  testGoal: string,
  testSpecifics: string,
  isBookingTurn: boolean = false,
  bookingTurnCount: number = 0,
): Promise<string> {
  const goalParts = persona.goal?.split(" | ") || [];
  const baseGoal = goalParts[0] || persona.goal || '';
  const behaviorStyle = goalParts.find((p: string) => p.startsWith("Style: "))?.replace("Style: ", "") || "friendly";
  const bookingPart = goalParts.find((p: string) => p.startsWith("Booking: "))?.replace("Booking: ", "") || "none";

  const isFirstMessage = turnIndex === 0;
  const isLastRegularMessage = turnIndex === totalTurns - 1 && !isBookingTurn;

  let bookingInstructions = '';
  if (isBookingTurn) {
    const dummyEmail = persona.dummy_email || '';
    const dummyPhone = persona.dummy_phone || '';
    const preferredDate = persona.preferred_booking_date || 'next week';

    if (bookingTurnCount === 0) {
      // First booking message - express interest in booking
      bookingInstructions = `
BOOKING PHASE: You now want to book an appointment.
- Express interest in booking/scheduling an appointment
- Your preferred time is: ${preferredDate}
- If asked, provide your contact info:
  - Email: ${dummyEmail}
  - Phone: ${dummyPhone}
  - Name: ${persona.name}
- Don't give all info at once. Respond naturally to the agent's questions.`;
    } else if (bookingPart === 'book_and_cancel' && bookingTurnCount >= 2) {
      bookingInstructions = `
CANCELLATION PHASE: You've booked an appointment but now want to cancel.
- Say you changed your mind or something came up
- Ask to cancel your appointment
- Be natural about it`;
    } else if (bookingPart === 'book_and_reschedule' && bookingTurnCount >= 2) {
      bookingInstructions = `
RESCHEDULE PHASE: You've booked an appointment but want to change the time.
- Say something came up with your schedule
- Ask to reschedule to a different time
- Be natural about it`;
    } else {
      bookingInstructions = `
BOOKING PHASE CONTINUED: Continue the booking process naturally.
- Respond to the agent's booking-related questions
- If asked for contact info you haven't provided yet:
  - Email: ${dummyEmail}
  - Phone: ${dummyPhone}
  - Name: ${persona.name}`;
    }
  }

  const systemPrompt = `You are role-playing as a real person texting a business. You ARE this person, not an AI.

Your persona:
- Name: ${persona.name}
- Age: ${persona.age}
- Gender: ${persona.gender}
- Occupation: ${persona.occupation}
- Problem/Need: ${persona.problem}
- Hobbies: ${persona.hobbies}
- Goal: ${baseGoal}
- Communication style: ${behaviorStyle}

Business context: ${businessInfo || "A local service business"}
Test scenario: ${testGoal || "General inquiry"}
Specific focus: ${testSpecifics || "No specific focus"}

RULES:
- Write like a REAL person texting. Use casual language, maybe typos, short messages.
- Be ${behaviorStyle}. ${getBehaviorInstructions(behaviorStyle)}
- ${isFirstMessage ? "This is your FIRST message to the business. Introduce yourself naturally or ask about their service." : ""}
- ${isLastRegularMessage && !isBookingTurn ? "This is your LAST regular message. Wrap up naturally - either thank them, say you'll think about it, or transition to booking if interested." : ""}
- DO NOT break character. DO NOT mention you are an AI or this is a simulation.
- Keep messages SHORT (1-3 sentences max). People text briefly.
- Respond naturally to what the agent said. Don't repeat yourself.
- ONLY output the message text, nothing else. No quotes, no labels.
${bookingInstructions}`;

  const messages: any[] = [{ role: "system", content: systemPrompt }];

  for (const msg of conversationHistory) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.role === "user" 
        ? `[You previously said]: ${msg.content}`
        : `[The business agent replied]: ${msg.content}`,
    });
  }

  messages.push({
    role: "user",
    content: isFirstMessage 
      ? "Generate your first message to the business."
      : isBookingTurn
        ? `Generate your next message as ${persona.name}. You are in the booking phase (booking message ${bookingTurnCount + 1}/${MAX_BOOKING_MESSAGES}).`
        : `Generate your next message as ${persona.name}. Turn ${turnIndex + 1} of ${totalTurns}.`,
  });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://1prompt.ai",
      "X-Title": "1Prompt Simulation Run",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("AI message generation error:", errText);
    throw new Error(`Failed to generate user message: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Hey, I have a question about your service.";
}

function getBehaviorInstructions(style: string): string {
  switch (style) {
    case "inquisitive": return "Ask lots of questions. Be curious. Want to know everything before deciding.";
    case "brief": return "Give very short answers. One word or one sentence max. Make the agent work to keep the conversation going.";
    case "detailed": return "Provide lots of context about your situation. Share background info unprompted.";
    case "skeptical": return "Push back on claims. Ask for proof. Express doubt. Test objection handling.";
    case "friendly": return "Be warm and cooperative. Show genuine interest.";
    case "distracted": return "Sometimes go off topic. Mention unrelated things. Come back to the main point eventually.";
    case "aggressive": return "Be confrontational and demanding. Test the agent's composure. Express frustration.";
    case "impatient": return "Show frustration with slow responses. Want quick answers. Rush the conversation.";
    case "indecisive": return "Can't make up your mind. Go back and forth. Need extra convincing.";
    case "price_sensitive": return "Focus on cost. Ask about discounts. Compare with competitors. Push back on pricing.";
    default: return "Act naturally and conversationally.";
  }
}

async function generateFormSubmissionMessage(
  apiKey: string,
  persona: any,
  formFields: string,
  entryScenario: string,
  businessInfo: string,
): Promise<string> {
  const fields = formFields || 'First Name, Last Name, Email, Phone Number';
  
  const systemPrompt = `You are generating a realistic form submission for a simulated lead. You must output ONLY a structured form submission in this exact format:

📋 FORM SUBMISSION
─────────────────
[Field Name]: [Value]
[Field Name]: [Value]
...

Use the persona details below to fill out the form fields realistically.

Persona:
- Name: ${persona.name}
- Age: ${persona.age}
- Gender: ${persona.gender}
- Occupation: ${persona.occupation}
- Problem/Need: ${persona.problem}
- Email: ${persona.dummy_email || persona.name.toLowerCase().replace(/\s+/g, '.') + '@gmail.com'}
- Phone: ${persona.dummy_phone || '+15551234567'}

Business context: ${businessInfo || "A service business"}
Entry scenario: ${entryScenario || "Lead filled out a contact form"}

Form fields to fill: ${fields}

RULES:
- Fill EVERY field listed with realistic data matching the persona
- For "Notes" or free-text fields, write a brief 1-2 sentence message related to their problem/need
- For service selection fields, pick something relevant to the business
- Output ONLY the form submission block, nothing else`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://1prompt.ai",
      "X-Title": "1Prompt Simulation Run",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate the form submission now." },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate form submission: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || `📋 FORM SUBMISSION\n─────────────────\nName: ${persona.name}\nEmail: ${persona.dummy_email || 'test@example.com'}\nPhone: ${persona.dummy_phone || '+15551234567'}`;
}

async function generateOutreachResponseMessage(
  apiKey: string,
  persona: any,
  outreachMessage: string,
  entryScenario: string,
  businessInfo: string,
): Promise<string> {
  const systemPrompt = `You are role-playing as a real person texting back to a business that sent them a message. You ARE this person, not an AI.

Your persona:
- Name: ${persona.name}
- Age: ${persona.age}
- Gender: ${persona.gender}
- Occupation: ${persona.occupation}
- Problem/Need: ${persona.problem}
- Goal: ${persona.goal}

Business context: ${businessInfo || "A service business"}
Entry scenario: ${entryScenario || "Received an outreach message"}

The business sent you this message:
"${outreachMessage}"

RULES:
- Write like a REAL person texting back. Use casual language, short messages.
- You are RESPONDING to the outreach message above. React to it naturally.
- You might be curious, skeptical, interested, or cautious — pick one that fits your persona.
- Keep it SHORT (1-2 sentences max). This is a text reply.
- DO NOT break character. DO NOT mention you are an AI or this is a simulation.
- ONLY output the message text, nothing else. No quotes, no labels.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://1prompt.ai",
      "X-Title": "1Prompt Simulation Run",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate your response to the outreach message." },
      ],
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate outreach response: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Hey, tell me more about this?";
}
