import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT_MODIFY = `You are an expert AI prompt engineer. Your job is to modify an existing AI setter prompt based on the user's request.

## HOW THIS SYSTEM WORKS

The prompt you receive is a FULL SETTER PROMPT composed of multiple MINI-PROMPT SECTIONS. Each section controls a specific behavior of the AI setter (e.g., identity, response length, emoji usage, storytelling, directness, communication tone, etc.). These sections are separated by this exact separator:

── ── ── ── ── ── ── ── ── ── ── ── ── ──

**The full prompt is synced bi-directionally with a structured config UI on the backend.** Each section maps 1:1 to a mini-prompt configuration panel. This means:
- The NUMBER of sections must NEVER change
- The ORDER of sections must NEVER change
- Sections must NEVER be added, removed, merged, or split

## ABSOLUTE RULES — STRUCTURE PRESERVATION

**VIOLATING THESE RULES WILL BREAK THE SYNC BETWEEN THE FULL PROMPT AND THE CONFIG UI.**

**YOU MUST:**
- PRESERVE the EXACT number of sections (separators) — no more, no fewer
- PRESERVE the EXACT separator format: ── ── ── ── ── ── ── ── ── ── ── ── ── ──
- PRESERVE the EXACT order of sections
- Return the COMPLETE modified prompt, not just the changed parts

**YOU MUST NOT — EVER:**
- Add new separators or remove existing ones
- Change the separator format in any way
- Merge two sections into one
- Split one section into two
- Reorder sections
- Remove a section entirely (even if user asks — instead, empty its content but keep the section header and separator)

## WHAT YOU CAN MODIFY

1. **Section content**: You can freely modify the text WITHIN any section to fulfill the user's request
2. **Section titles (## headers)**: You CAN rename a section's ## header if the user's request warrants it
3. **Empty a section**: If a user wants to "remove" something, clear the content but keep the ## header and the separator before it

## WHERE TO PUT DIFFERENT TYPES OF CONTENT — CRITICAL ROUTING RULES

When the user provides information or requests changes, you MUST decide WHERE it goes using these rules IN ORDER:

1. **ALWAYS check existing sections FIRST**
2. **Company/business information**: Put in the **COMPANY & SERVICES INFORMATION** section
3. **Conversation examples, sample dialogues**: Go in the **CONVERSATION EXAMPLES** section
4. **Spans multiple sections**: Modify EACH relevant section independently
5. **ADDITIONAL CUSTOM INSTRUCTIONS is the ABSOLUTE LAST RESORT**

## CONTENT MODIFICATION GUIDELINES
- Follow the user's instructions precisely
- Maintain the same writing style and tone unless asked to change it
- Keep the same formatting patterns unless asked to change
- Be creative but faithful to the user's intent

## RESPONSE FORMAT
You MUST respond with a JSON object containing exactly two fields:
1. "modifiedPrompt": The complete modified prompt text (raw text, no markdown code blocks)
2. "summary": A brief, friendly summary (2-4 sentences) of what you changed.

IMPORTANT: Return ONLY the JSON object. No markdown, no code blocks, no extra text.`;

const SYSTEM_PROMPT_GENERATE = `You are an expert AI prompt engineer. Your job is to write the content for a SINGLE mini-prompt section based on the user's request.

## CONTEXT

A mini-prompt is a focused instruction block that controls one specific behaviour of an AI setter (for example: identity, tone, response length, emoji usage, objection handling, storytelling, custom instructions). The user has opened the editor for one such mini-prompt and the section is currently empty — you are generating it from scratch.

You will NOT receive a separator-delimited multi-section prompt. You receive only:
- The user's request describing what this mini-prompt should do
- (Optionally) a section title or label for context

## WHAT TO PRODUCE

Write the mini-prompt content as plain text instructions addressed to an AI setter. The content should:
- Be self-contained — readable as a standalone instruction block
- Be specific and actionable, not vague platitudes
- Match the user's intent precisely
- Use clear, direct language; avoid filler
- Stay within the scope the user described — do not bolt on unrelated guidance

DO NOT include:
- Section separators (── ── ──)
- A section heading (## ...) — the UI handles headings outside of this content
- Quotes around the whole thing or markdown code fences
- Meta-commentary about what you wrote

## RESPONSE FORMAT

You MUST respond with a JSON object containing exactly two fields:
1. "modifiedPrompt": The mini-prompt content you generated (raw text, no markdown code blocks)
2. "summary": A brief, friendly summary (1-3 sentences) describing what you produced.

IMPORTANT: Return ONLY the JSON object. No markdown, no code blocks, no extra text.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fullPrompt: rawFullPrompt, userMessage, conversationHistory, clientId, sectionOrder, slotId } = await req.json();
    const fullPrompt = typeof rawFullPrompt === "string" ? rawFullPrompt : "";
    const isEmptyPrompt = fullPrompt.trim() === "";

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: "Client ID is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: "User message is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!triggerSecretKey) {
      return new Response(
        JSON.stringify({ error: "TRIGGER_SECRET_KEY not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: clientData, error: dbError } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", clientId)
      .single();

    if (dbError || !clientData) {
      return new Response(
        JSON.stringify({ error: "Client not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!clientData.openrouter_api_key) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key is not configured. Please add it in API Credentials." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build messages array — branch on empty vs non-empty fullPrompt.
    // Non-empty: "modify multi-section prompt" path (preserves section count).
    // Empty: "generate single mini-prompt section from scratch" path.
    const trimmedHistory = (conversationHistory && Array.isArray(conversationHistory))
      ? conversationHistory.slice(-10)
      : [];

    let sectionCount: number;
    const messages: Array<{ role: string; content: string }> = [];

    if (isEmptyPrompt) {
      sectionCount = 1;
      const sectionLabels = sectionOrder || [];
      const sectionLabelHint = sectionLabels.length > 0
        ? `\n\nThis mini-prompt is for the section labelled: ${sectionLabels.join(", ")}.`
        : (slotId ? `\n\nThis mini-prompt is identified by slot: ${slotId}.` : "");
      messages.push({ role: "system", content: SYSTEM_PROMPT_GENERATE + sectionLabelHint });

      for (const msg of trimmedHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }

      messages.push({
        role: "user",
        content: `The mini-prompt is currently empty. Generate the content from scratch based on this request:\n\n${userMessage}`,
      });
    } else {
      sectionCount = fullPrompt.split("── ── ── ── ── ── ── ── ── ── ── ── ── ──").length;
      const sectionLabels = sectionOrder || [];
      const sectionMapInfo = sectionLabels.length > 0
        ? `\n\nThe current sections in order are: ${sectionLabels.map((s: string, i: number) => `${i + 1}. ${s}`).join(", ")}`
        : "";
      messages.push({
        role: "system",
        content:
          SYSTEM_PROMPT_MODIFY +
          `\n\nCRITICAL: The current prompt has exactly ${sectionCount} sections (${sectionCount - 1} separators). Your output MUST have EXACTLY ${sectionCount} sections (${sectionCount - 1} separators). NO EXCEPTIONS.${sectionMapInfo}`,
      });

      for (const msg of trimmedHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }

      messages.push({
        role: "user",
        content: `Here is the CURRENT FULL PROMPT:\n\n---START OF PROMPT---\n${fullPrompt}\n---END OF PROMPT---\n\nUser request: ${userMessage}`,
      });
    }

    // Insert job row
    const { data: jobRow, error: insertError } = await supabase
      .from("ai_generation_jobs")
      .insert({
        client_id: clientId,
        job_type: "modify-prompt-ai",
        status: "pending",
        input_payload: {
          slotId: slotId || null,
          messages,
          max_tokens: 16000,
          temperature: 0.3,
          openrouter_api_key: clientData.openrouter_api_key,
          original_section_count: sectionCount,
        },
      })
      .select("id")
      .single();

    if (insertError || !jobRow) {
      console.error("Failed to insert job:", insertError);
      throw new Error("Failed to create generation job");
    }

    const jobId = jobRow.id;

    // Trigger the Trigger.dev task
    const triggerResponse = await fetch("https://api.trigger.dev/api/v1/tasks/run-ai-job/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${triggerSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          job_id: jobId,
          client_id: clientId,
          job_type: "modify-prompt-ai",
          messages,
          max_tokens: 16000,
          temperature: 0.3,
        },
      }),
    });

    if (!triggerResponse.ok) {
      const errText = await triggerResponse.text();
      console.error("Trigger.dev error:", triggerResponse.status, errText);
      await supabase.from("ai_generation_jobs").update({
        status: "failed",
        error_message: `Failed to trigger AI job: ${triggerResponse.status}`,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
      throw new Error("Failed to trigger AI job processing");
    }

    console.log(`[modify-prompt-ai] Job ${jobId} created`);

    return new Response(
      JSON.stringify({ job_id: jobId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("modify-prompt-ai error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
