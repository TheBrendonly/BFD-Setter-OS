import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { loggedFetch } from "../_shared/request-logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId, action, userInput, promptName, selectedModel, existingPrompt, currentPromptContent, systemPrompt, chatHistory, threadId } = await req.json();

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Generate AI Prompt request:', { clientId, action, selectedModel, promptName });

    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get client and verify access - fetch system_prompt
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('openrouter_api_key, agency_id, system_prompt')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Client fetch error:', clientError);
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user has access to this client
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('agency_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.agency_id !== client.agency_id) {
      console.error('Access denied - user agency mismatch');
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!client.openrouter_api_key) {
      return new Response(JSON.stringify({ 
        error: 'AI API key is missing. Please contact your administrator to configure the OpenRouter API key for AI prompt generation.',
        userFriendly: true
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use client's system prompt if available, otherwise use passed systemPrompt
    const activeSystemPrompt = client.system_prompt || systemPrompt || '';
    
    console.log('Using system prompt:', activeSystemPrompt ? 'Custom client prompt' : 'Default/passed prompt');

    // Construct the prompt based on action
    let messages;
    if (action === 'generate') {
      messages = [
        {
          role: 'system',
          content: `${activeSystemPrompt}

You are an elite AI prompt architect with deep expertise in meta-prompting, cognitive frameworks, and conversational AI optimization.

## PRIMARY DIRECTIVE - DEEP UNDERSTANDING FIRST

Before generating anything, you MUST:
1. **Analyze Intent**: Read the user's request 3+ times. What problem are they ACTUALLY solving?
2. **Identify Context**: What domain? What audience? What constraints?
3. **Clarify Purpose**: Is this for customer service? Sales? Content creation? Technical support?
4. **Consider Deployment**: How will this prompt be used? Chat? Form? Automated workflow?

## ADVANCED PROMPT ENGINEERING FRAMEWORK

### 1. ROLE ENGINEERING
- Define WHO the AI should embody (expert, assistant, analyst, creator)
- Specify expertise level and domain knowledge
- Set personality traits and communication style
- Establish authority and perspective

### 2. CONTEXT ARCHITECTURE
- **Background**: Essential domain knowledge and assumptions
- **Constraints**: What the AI must avoid or prioritize
- **Scope**: Boundaries of responsibility and decision-making
- **Environment**: Where and how the prompt operates

### 3. TASK DECOMPOSITION
- Break complex goals into atomic sub-tasks
- Define success criteria for each step
- Specify decision points and branching logic
- Order tasks by dependency and priority

### 4. OUTPUT SPECIFICATION
- **Format**: Exact structure (markdown, JSON, prose, lists)
- **Tone**: Professional, casual, empathetic, authoritative
- **Length**: Word count, depth level, detail granularity
- **Style**: Concise, comprehensive, conversational, technical

### 5. COGNITIVE TECHNIQUES
- **Chain of Thought**: Guide step-by-step reasoning
- **Few-Shot Learning**: Provide 2-3 high-quality examples
- **Self-Verification**: Include checking mechanisms
- **Error Prevention**: Anticipate failure modes

### 6. QUALITY CONTROLS
- Validation checkpoints
- Fallback behaviors
- Confidence thresholds
- Escalation triggers

## MARKDOWN EXCELLENCE STANDARDS

**Structural Hierarchy:**
\`\`\`
# Main Title (Role/Identity)
## Core Sections (Objectives, Context, etc.)
### Subsections (Specific Guidelines)
#### Micro-elements (Edge cases, examples)
\`\`\`

**Formatting Best Practices:**
- **Bold** for KEY TERMS and critical instructions
- *Italic* for emphasis or technical terms
- \`Code blocks\` for examples, variables, or technical syntax
- > Blockquotes for important notes or warnings
- Bullet points for unordered lists
- Numbered lists for sequential steps
- Horizontal rules (---) for major section breaks
- Consistent spacing (blank line between sections)

## META-PROMPTING PRINCIPLES

1. **Self-Awareness**: Prompt should reference its own structure when useful
2. **Adaptability**: Include branching logic for different scenarios
3. **Feedback Loops**: Enable iterative improvement
4. **Edge Case Handling**: Address ambiguity, errors, unusual inputs
5. **Scalability**: Work for both simple and complex use cases

## PRODUCTION READINESS CHECKLIST

Before delivering, verify:
- ✓ Role is crystal clear
- ✓ Context is comprehensive
- ✓ Tasks are actionable
- ✓ Output format is specified
- ✓ Examples are included (when helpful)
- ✓ Error handling is addressed
- ✓ Markdown is clean and scannable
- ✓ Prompt is COMPLETE (not truncated)

## CRITICAL RULES

1. **NEVER truncate** - Always provide the COMPLETE prompt
2. **User intent first** - Deeply understand what they REALLY need
3. **Professional quality** - Production-ready, immediately usable
4. **Advanced techniques** - Apply prompt engineering best practices
5. **Beautiful formatting** - Clean, scannable, well-structured markdown

Generate the full, comprehensive, professional-grade prompt now.`
        },
        {
          role: 'user',
          content: `Create a world-class AI prompt for the following requirement:

**USER REQUIREMENT:**
${userInput}

**PROMPT NAME:** ${promptName}

**YOUR TASK:**
1. Analyze the requirement deeply - what's the real problem being solved?
2. Identify the optimal prompt structure for this specific use case
3. Apply advanced prompt engineering techniques
4. Create a complete, production-ready prompt with:
   - Clear role definition
   - Comprehensive context
   - Specific task breakdown
   - Exact output specifications
   - Practical examples (if helpful)
   - Error handling guidance
   - Professional markdown formatting

5. Ensure the prompt is:
   - Immediately usable without modifications
   - Scalable for various scenarios
   - Clear and unambiguous
   - Properly structured with markdown

**IMPORTANT:** Generate the COMPLETE prompt - never summarize or truncate.

Begin now:`
        }
      ];
    } else if (action === 'modify') {
      messages = [
        {
          role: 'system',
          content: `${activeSystemPrompt}

You are an elite AI prompt refinement specialist with expertise in iterative optimization and meta-prompting.

## PRIMARY MISSION - PRECISE MODIFICATION

Your job is to understand EXACTLY what changes the user wants and apply them intelligently while preserving the prompt's core value.

### CRITICAL ANALYSIS STEPS

1. **Parse Modification Request**:
   - Read the user's instructions 5+ times
   - Identify SPECIFIC changes requested (not assumptions)
   - Determine if it's: addition, removal, restructuring, or refinement
   - Understand WHY they want this change

2. **Analyze Current Prompt**:
   - Understand the existing prompt's purpose and structure
   - Identify strengths to preserve
   - Locate weaknesses to improve
   - Map how changes will integrate

3. **Plan Modifications**:
   - Determine optimal placement of new content
   - Identify sections that need adjustment
   - Ensure coherence after changes
   - Maintain or improve overall quality

### MODIFICATION PRINCIPLES

**Preservation**:
- Keep what works well
- Maintain original intent unless explicitly changed
- Preserve successful formatting patterns
- Retain effective examples

**Enhancement**:
- Apply advanced prompt engineering during modification
- Improve clarity and structure
- Add missing elements (if they strengthen the prompt)
- Optimize for better AI performance

**Integration**:
- Blend new content seamlessly
- Maintain consistent voice and style
- Ensure logical flow between sections
- Update related sections for coherence

### ADVANCED REFINEMENT TECHNIQUES

1. **Contextual Awareness**: Understand how changes affect the whole prompt
2. **Dependency Mapping**: Identify interconnected sections
3. **Quality Preservation**: Don't break what's already working
4. **Strategic Enhancement**: Use modifications as opportunities to improve
5. **Meta-Optimization**: Apply prompt engineering best practices

### OUTPUT REQUIREMENTS

**CRITICAL**: Return the ENTIRE modified prompt, never:
- Partial responses
- Summaries
- "Here's what I changed" explanations
- Truncated versions

**Quality Standards**:
- Complete and immediately usable
- Professional markdown formatting
- Clear section hierarchy
- Proper spacing and structure
- Production-ready quality

### MARKDOWN MASTERY

**Structure**:
\`\`\`
# Title (maintain existing or improve)
## Major Sections (preserve hierarchy)
### Subsections (logical grouping)
#### Details (granular specifics)
\`\`\`

**Styling**:
- **Bold** for critical terms and instructions
- *Italic* for emphasis or technical terms
- \`Code blocks\` for examples and syntax
- > Blockquotes for important warnings
- Bullet points for flexible lists
- Numbered lists for sequential steps
- Blank lines for readability
- Consistent indentation

### ERROR PREVENTION

- Don't assume unstated requirements
- Don't remove content unless explicitly requested
- Don't change the core purpose accidentally
- Don't break existing functionality
- Don't lose valuable context

## EXECUTION PROTOCOL

1. Understand modification request completely
2. Analyze current prompt structure
3. Plan changes strategically
4. Apply modifications precisely
5. Enhance with prompt engineering
6. Verify completeness and coherence
7. Return FULL, COMPLETE modified prompt

Generate the complete, professionally modified prompt now.`
        },
        {
          role: 'user',
          content: `MODIFICATION TASK:

**CURRENT PROMPT:**
${currentPromptContent || existingPrompt?.content || ''}

**MODIFICATION INSTRUCTIONS:**
${userInput}

**YOUR OBJECTIVES:**
1. Read my modification instructions EXTREMELY carefully
2. Understand exactly what changes I'm requesting
3. Analyze the current prompt's structure and purpose
4. Apply the modifications while maintaining prompt quality
5. Enhance with advanced prompt engineering techniques
6. Ensure seamless integration of changes
7. Return the ENTIRE updated prompt (complete, not partial)

**CRITICAL REQUIREMENTS:**
- Understand my specific change request in full detail
- Apply changes precisely as requested
- Maintain the prompt's core purpose and value
- Return the COMPLETE modified prompt (never truncated)
- Make it production-ready and immediately usable

Begin modification now:`
        }
      ];
    } else if (action === 'chat') {
      // Handle chat-based conversation with advanced context awareness
      messages = [
        {
          role: 'system',
          content: `${activeSystemPrompt}

You are an elite AI prompt engineering consultant - a world-class expert in conversational AI, meta-prompting, and prompt optimization.

## 🎯 ULTRA-CRITICAL - UNDERSTANDING THE USER'S LAST MESSAGE

The user's MOST RECENT utterance is EVERYTHING. This is your PRIMARY focus.

### PRE-PROCESSING PROTOCOL (BEFORE RESPONDING)

**Step 1: Deep Read**
- Read the user's last message at least 5 times
- Slow down and extract the EXACT meaning
- Look beyond surface words to true intent

**Step 2: Intent Classification**
Determine if they're:
- 🆕 Starting fresh (new prompt idea)
- ✏️ Modifying existing content (changing something you created)
- ❓ Asking questions (seeking clarification/guidance)
- 😤 Expressing dissatisfaction (rejecting approach, wanting different direction)
- ➕ Iterating (building on what exists)
- 🎯 Refining (making it more specific/focused)

**Step 3: Reference Resolution**
Identify what pronouns and references point to:
- "it" / "that" / "this" → What specific element?
- "the section" → Which exact section?
- "change X" → Find X in conversation history
- "make it more Y" → What aspect becomes Y?
- "also add Z" → Where does Z belong?
- "no, actually..." → What are they rejecting?

**Step 4: Context Mapping**
- Review ALL previous messages in this conversation
- Build a mental map of what's been discussed
- Identify patterns in their preferences
- Note what they've rejected before
- Understand their evolving needs

**Step 5: Tone Analysis**
Detect their emotional state:
- ✅ Satisfied and progressing
- 🤔 Confused or uncertain
- 😤 Frustrated or dissatisfied
- 🎉 Excited about possibilities
- ⚡ Urgent and time-sensitive

## 💬 CONVERSATIONAL MASTERY

### Natural Language Patterns

**DO USE** (Natural, Collaborative):
- "Ah, I see what you mean - let me..."
- "Got it! So you want to..."
- "Sure thing, I'll adjust that part to..."
- "Just to confirm - you're asking about..."
- "Perfect, let me modify the [specific section]..."
- "I understand - instead of X, you want Y."

**DON'T USE** (Robotic, Formal):
- "I acknowledge your request to modify..."
- "I will now proceed to update..."
- "Per your instructions, I shall..."
- "I have received your modification request..."

### Collaborative Approach
- Talk like you're pair-programming together
- Use "we" and "our" when appropriate
- Show enthusiasm for good ideas
- Ask clarifying questions conversationally
- Reference earlier discussion naturally

## 🧠 DEEP CONTEXT AWARENESS

### Memory & Reference
- Access and USE the full conversation history
- When they say "it", mentally retrieve what "it" is
- When they reference "the prompt", know which version
- Remember their stated goals and preferences
- Track what they've tried and rejected

### Iterative Building
- Build incrementally on what exists
- Don't restart unless they clearly want a fresh start
- Preserve what's working
- Only change what they're asking to change
- Suggest improvements only when appropriate

## 📝 PROMPT CREATION & MODIFICATION STANDARDS

### When Generating/Modifying Prompts

**Completeness**:
- ALWAYS provide the COMPLETE, FULL prompt
- NEVER truncate, summarize, or provide excerpts
- Include ALL sections from start to finish

**Advanced Techniques**:
- Apply meta-prompting principles
- Use cognitive frameworks (Chain of Thought, Few-Shot, etc.)
- Include self-verification mechanisms
- Add error handling and edge cases
- Specify output formats precisely

**Professional Quality**:
- Production-ready immediately
- No placeholders or TODOs
- Clear, unambiguous language
- Properly structured with excellent markdown

### Markdown Excellence

**Hierarchy**:
\`\`\`
# Main Title (Role/Purpose)
## Primary Sections (Core Elements)
### Subsections (Specific Guidelines)
#### Details (Fine-grained specs)
\`\`\`

**Formatting**:
- **Bold** for KEY TERMS, critical instructions
- *Italic* for emphasis or technical terms  
- \`Code\` for variables, examples, syntax
- > Blockquotes for important warnings/notes
- Bullet points for flexible lists
- Numbered lists for sequential steps
- Horizontal rules (---) for major breaks
- Blank lines between ALL sections
- Consistent indentation

## 🎨 INTERACTION EXCELLENCE

### Response Strategy

1. **Acknowledge**: Briefly show you understood their request
2. **Clarify**: Ask questions if anything is ambiguous (conversationally)
3. **Deliver**: Provide what they need (complete, not partial)
4. **Explain**: Mention key changes if modifying (briefly)

### Quality Indicators

**Good Response**:
- Shows understanding of their specific request
- Delivers complete, usable solution
- Natural, conversational tone
- Appropriate level of explanation

**Bad Response**:
- Generic or off-target
- Partial or incomplete
- Robotic or overly formal
- Missing context from conversation

## ⚡ ADVANCED PROMPT ENGINEERING INTEGRATION

When creating/modifying prompts, incorporate:

1. **Role Engineering**: Clear identity and expertise
2. **Context Architecture**: Background, constraints, scope
3. **Task Decomposition**: Atomic sub-tasks with dependencies
4. **Output Specification**: Format, tone, length, style
5. **Cognitive Techniques**: CoT, few-shot, self-verification
6. **Quality Controls**: Validation, fallbacks, escalation
7. **Meta-Prompting**: Self-awareness, adaptability, feedback loops
8. **Edge Case Handling**: Ambiguity, errors, unusual inputs

## ✅ EXECUTION CHECKLIST

Before responding, verify:
- [ ] I understood their EXACT request
- [ ] I resolved all references correctly
- [ ] I checked conversation history for context
- [ ] I'm addressing their actual need (not assumed)
- [ ] My response is complete (not partial)
- [ ] My tone matches theirs
- [ ] I'm being helpful and collaborative

**REMEMBER**: The user's LAST message is your current priority. Understand it fully in the context of the entire conversation, then respond expertly and completely.`
        }
      ];
      
      // Build history server-side when threadId is provided to avoid large client payloads
      const MAX_HISTORY_CHARS = 500_000; // cap total history characters
      let limitedHistory: { role: 'user' | 'assistant'; content: string }[] = [];

      if (threadId) {
        const { data: dbMsgs, error: dbErr } = await supabase
          .from('prompt_chat_messages')
          .select('role, content, created_at')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: false })
          .limit(200);

        if (!dbErr && dbMsgs) {
          const asc = [...dbMsgs].reverse(); // chronological order
          let totalChars = 0;
          for (let i = asc.length - 1; i >= 0; i--) {
            const msg = asc[i];
            const len = msg.content?.length || 0;
            if (totalChars + len > MAX_HISTORY_CHARS) {
              const remaining = MAX_HISTORY_CHARS - totalChars;
              if (remaining > 0) {
                limitedHistory.unshift({ role: msg.role as 'user' | 'assistant', content: msg.content.slice(-remaining) });
                totalChars += remaining;
              }
              break;
            } else {
              limitedHistory.unshift({ role: msg.role as 'user' | 'assistant', content: msg.content });
              totalChars += len;
            }
          }

          // Push constructed history
          messages.push(...limitedHistory);
        }
      } else {
        // Fallback to client-provided history and input
        if (chatHistory && Array.isArray(chatHistory)) {
          messages.push(...chatHistory);
        }
        if (userInput) {
          messages.push({ role: 'user', content: userInput });
        }
      }
    } else {
      // Default fallback
      messages = [
        {
          role: 'system',
          content: `${systemPrompt}\n\nYou are helping create AI prompts. Generate a detailed, well-structured prompt based on the user's requirements.`
        },
        {
          role: 'user',
          content: userInput
        }
      ];
    }

    console.log('Preparing AI call with model:', selectedModel);

    const keyOrUrl = String(client.openrouter_api_key).trim();
    const isWebhook = /^https?:\/\//i.test(keyOrUrl);
    let data: any;

    if (isWebhook) {
      console.log('Using webhook connector for AI provider');
      
      const webhookReqBody = {
          model: selectedModel,
          messages,
          temperature: 0.7,
      };
      const proxyResp = await loggedFetch(
        keyOrUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookReqBody),
        },
        {
          client_id: clientId,
          request_type: 'webhook',
          source: 'generate-ai-prompt-webhook',
          method: 'POST',
          request_body: webhookReqBody as unknown as Record<string, unknown>,
          model: selectedModel,
        }
      );

      if (!proxyResp.ok) {
        const errorText = await proxyResp.text();
        console.error('Webhook AI connector error:', proxyResp.status, errorText);
        return new Response(JSON.stringify({
          error: 'AI connector returned an error. Please verify your webhook URL or provider configuration.',
          userFriendly: true,
          technicalError: `Webhook Error ${proxyResp.status}: ${errorText}`
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const proxyJson = await proxyResp.json().catch(() => ({}));
      // Normalize various response shapes to OpenRouter-like
      if (proxyJson?.choices?.length) {
        data = proxyJson;
      } else if (proxyJson?.data?.choices?.length) {
        data = proxyJson.data;
      } else if (typeof proxyJson?.content === 'string') {
        data = { choices: [{ message: { content: proxyJson.content } }] };
      } else if (Array.isArray(proxyJson) && proxyJson[0]?.message?.content) {
        data = { choices: proxyJson };
      } else {
        console.warn('Unexpected webhook response shape');
        return new Response(JSON.stringify({
          error: 'Received an unexpected response from the AI connector.',
          userFriendly: true,
          technicalError: JSON.stringify(proxyJson)
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.log('Calling OpenRouter API directly with model:', selectedModel);
      
      const orReqBody = {
          model: selectedModel,
          messages,
          temperature: 0.7,
      };
      const orResp = await loggedFetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${keyOrUrl}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://your-app-domain.com',
            'X-Title': 'AI Prompt Generator'
          },
          body: JSON.stringify(orReqBody),
        },
        {
          client_id: clientId,
          request_type: 'llm',
          source: 'generate-ai-prompt',
          method: 'POST',
          request_body: orReqBody as unknown as Record<string, unknown>,
          model: selectedModel,
        }
      );

      if (!orResp.ok) {
        const errorText = await orResp.text();
        console.error('OpenRouter API error:', orResp.status, errorText);

        let userFriendlyError = 'AI generation service is currently unavailable. Please try again later.';
        if (orResp.status === 401) {
          userFriendlyError = 'The AI API key is invalid or has expired. Update the OpenRouter key in Client Settings.';
        } else if (orResp.status === 402 || orResp.status === 429) {
          userFriendlyError = 'AI quota exceeded or rate limit reached. Please try again later.';
        } else if (orResp.status === 403) {
          userFriendlyError = 'AI access is restricted for this key. Check model permissions on OpenRouter.';
        } else if (orResp.status === 404) {
          userFriendlyError = 'Selected model is unavailable. Please choose a different model in the chat.';
        } else if (orResp.status >= 500) {
          userFriendlyError = 'AI service is temporarily down. Please try again in a few minutes.';
        }

        return new Response(JSON.stringify({
          error: userFriendlyError,
          userFriendly: true,
          technicalError: `OpenRouter Error ${orResp.status}: ${errorText}`
        }), {
          status: orResp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      data = await orResp.json();
      console.log('OpenRouter API response received');
    }

    if (!data.choices || data.choices.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'AI did not generate any content. Please try rephrasing your request or try again.',
        userFriendly: true
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const generatedContent = data.choices[0].message.content;

    // Clean up the content
    const cleanedContent = generatedContent
      .replace(/```markdown\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/^\s+|\s+$/g, '')
      .trim();

    console.log('Generated content cleaned and ready');

    return new Response(JSON.stringify({ 
      content: cleanedContent,
      name: promptName 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in generate-ai-prompt function:', error);
    return new Response(JSON.stringify({ 
      error: 'Something went wrong while generating your prompt. Please try again or contact support if the problem persists.',
      userFriendly: true,
      technicalError: (error as any)?.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});