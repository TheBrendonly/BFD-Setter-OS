import { createClient } from "npm:@supabase/supabase-js@2";
import { loggedFetch } from "../_shared/request-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      simulationId, icpProfileId, businessInfo, testGoal, testSpecifics,
      numPersonas, minMessages, maxMessages,
      clientId,
      ageMin = 18, ageMax = 65, gender = 'any', location = '',
      behaviors = ['friendly', 'skeptical', 'inquisitive', 'brief', 'detailed', 'distracted'],
      testBooking = false, testCancellation = false, testReschedule = false,
      bookingCount = 0, cancelRescheduleCount = 0,
      scenarioItems = [],
    } = await req.json();

    if (!simulationId || !numPersonas) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve clientId from simulation row if the caller didn't pass one (frontend currently doesn't).
    let resolvedClientId = clientId as string | undefined;
    if (!resolvedClientId) {
      const { data: simRow, error: simRowErr } = await supabase
        .from("simulations")
        .select("client_id")
        .eq("id", simulationId)
        .single();
      if (simRowErr || !simRow?.client_id) {
        return new Response(JSON.stringify({ error: "Simulation not found or has no client_id" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      resolvedClientId = simRow.client_id as string;
    }

    // OpenRouter API key (per-client) — replaces the legacy Lovable AI gateway path
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", resolvedClientId)
      .single();

    if (clientErr || !clientRow?.openrouter_api_key) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured. Please add it in API Credentials." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const openrouterApiKey = clientRow.openrouter_api_key as string;

    // Fetch existing avatar seeds to avoid duplicates
    const { data: existingPersonas } = await supabase
      .from("simulation_personas")
      .select("avatar_seed")
      .not("avatar_seed", "is", null);
    
    const existingSeeds = new Set((existingPersonas || []).map((p: any) => p.avatar_seed).filter(Boolean));

    function generateUniqueSeed(): string {
      let attempts = 0;
      while (attempts < 100) {
        const seed = Math.random().toString(36).substring(2, 8);
        if (!existingSeeds.has(seed)) {
          existingSeeds.add(seed);
          return seed;
        }
        attempts++;
      }
      const fallback = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
      existingSeeds.add(fallback);
      return fallback;
    }

    // Build behavior list string
    const behaviorList = behaviors.length > 0 ? behaviors.join(', ') : 'friendly, skeptical, inquisitive, brief, detailed, distracted';

    // Build gender constraint
    const genderConstraint = gender === 'any'
      ? 'Generate a natural mix of male and female personas.'
      : `ALL personas MUST be ${gender}. No exceptions.`;

    // Build scenario items section
    let scenarioSection = '';
    // Try to extract scenario items from testSpecifics if not passed directly
    let effectiveScenarios: string[] = scenarioItems;
    if (effectiveScenarios.length === 0 && testSpecifics) {
      const scenarioMatch = testSpecifics.match(/Scenarios to test:\n([\s\S]*?)(?:\n\n|$)/);
      if (scenarioMatch) {
        effectiveScenarios = scenarioMatch[1].split('\n').map((s: string) => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
      }
    }

    if (effectiveScenarios.length > 0) {
      scenarioSection = `
CRITICAL — SCENARIO DISTRIBUTION:
The following scenarios/objections MUST be distributed across the personas. Each persona's "problem" and "goal" fields MUST directly relate to one of these scenarios:
${effectiveScenarios.map((s: string, i: number) => `  ${i + 1}. "${s}"`).join('\n')}

Distribute these scenarios evenly. If there are more personas than scenarios, some scenarios can repeat. Every persona MUST be assigned one of these scenarios as their core problem/objection.`;
    }

    // Extract trigger and lead knowledge from testSpecifics
    let triggerSection = '';
    let knowledgeSection = '';
    if (testSpecifics) {
      const triggerMatch = testSpecifics.match(/Lead Trigger:\s*(.*?)(?:\n\n|$)/s);
      if (triggerMatch) triggerSection = `\nLead trigger context: ${triggerMatch[1].trim()}. Personas should reflect this entry point (e.g., they came from a Facebook ad, a referral, etc.).`;
      
      const knowledgeMatch = testSpecifics.match(/What the lead knows:\s*(.*?)(?:\n\n|$)/s);
      if (knowledgeMatch) knowledgeSection = `\nLead knowledge: ${knowledgeMatch[1].trim()}. Factor this into what the persona already knows going into the conversation.`;
    }

    const systemPrompt = `You are a persona generator for AI sales agent simulation testing. You MUST follow ALL constraints exactly.

HARD CONSTRAINTS (MUST be followed exactly):
1. Generate EXACTLY ${numPersonas} personas. Not more, not less.
2. Every persona's age MUST be between ${ageMin} and ${ageMax} (inclusive). No exceptions.
3. ${genderConstraint}
4. Each persona's "message_count" MUST be a random integer between ${minMessages} and ${maxMessages}. Vary it across personas.
5. Each persona's "behavior_style" MUST be one of: ${behaviorList}. Distribute styles evenly across personas.
${location ? `6. Personas should be from or relevant to this location: ${location}.` : ''}

BUSINESS CONTEXT (this is the business being tested — ALL personas must be realistic customers for THIS specific business):
${businessInfo || "A service business"}

${testGoal ? `The AI agent being tested is: ${testGoal}` : ''}
${triggerSection}
${knowledgeSection}
${scenarioSection}

PERSONA FIELD REQUIREMENTS:
- "name": Realistic full name matching the gender constraint
- "age": Integer between ${ageMin} and ${ageMax} ONLY
- "gender": "male" or "female"
- "occupation": Realistic job title (can be varied/random)
- "problem": Their SPECIFIC problem/need that relates to THIS business. ${effectiveScenarios.length > 0 ? 'MUST be based on one of the scenarios listed above.' : 'Must be relevant to the business context.'}
- "hobbies": 2-3 realistic hobbies (can be varied/random)
- "goal": What they want from the conversation with the AI agent. ${effectiveScenarios.length > 0 ? 'MUST reflect the assigned scenario.' : 'Must be relevant to the business.'}
- "behavior_style": One of: ${behaviorList}
- "message_count": Random integer between ${minMessages} and ${maxMessages}

Return ONLY a JSON array of ${numPersonas} persona objects. No markdown fences, no explanation, just the raw JSON array.`;

    const userPrompt = `Generate exactly ${numPersonas} customer personas for this business simulation. Follow every constraint in the system prompt precisely.`;

    console.log(`Generating ${numPersonas} personas for simulation ${simulationId}, age ${ageMin}-${ageMax}, gender: ${gender}, behaviors: ${behaviorList}, scenarios: ${effectiveScenarios.length}`);

    const llmRequestBody = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
    };

    const response = await loggedFetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://1prompt.ai",
          "X-Title": "1Prompt Simulation Personas Generator",
        },
        body: JSON.stringify(llmRequestBody),
      },
      {
        client_id: resolvedClientId,
        request_type: "llm",
        source: "generate-simulation-personas",
        method: "POST",
        request_body: llmRequestBody as unknown as Record<string, unknown>,
        model: "google/gemini-2.5-flash",
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error:", response.status, errText);
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "OpenRouter credits exhausted. Please top up your OpenRouter balance." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`OpenRouter error: ${response.status}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";
    
    let personas: any[];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array found in response");
      personas = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error("Failed to parse personas:", content);
      throw new Error("Failed to parse generated personas");
    }

    // Post-process: enforce constraints that AI might have missed
    // Pad or trim to exact numPersonas
    while (personas.length < numPersonas) {
      // Duplicate a random existing persona with tweaked fields
      const base = personas[Math.floor(Math.random() * personas.length)];
      const clone = { ...base };
      clone.name = `${base.name.split(' ')[0]} ${['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'][Math.floor(Math.random() * 10)]}`;
      clone.age = Math.floor(Math.random() * (ageMax - ageMin + 1)) + ageMin;
      clone.message_count = Math.floor(Math.random() * (maxMessages - minMessages + 1)) + minMessages;
      clone.behavior_style = behaviors[Math.floor(Math.random() * behaviors.length)];
      personas.push(clone);
    }
    if (personas.length > numPersonas) {
      personas = personas.slice(0, numPersonas);
    }

    // Enforce age range and message count
    for (const p of personas) {
      if (typeof p.age !== 'number' || p.age < ageMin || p.age > ageMax) {
        p.age = Math.floor(Math.random() * (ageMax - ageMin + 1)) + ageMin;
      }
      if (typeof p.message_count !== 'number' || p.message_count < minMessages || p.message_count > maxMessages) {
        p.message_count = Math.floor(Math.random() * (maxMessages - minMessages + 1)) + minMessages;
      }
      if (gender !== 'any' && p.gender !== gender) {
        p.gender = gender;
      }
      if (!behaviors.includes(p.behavior_style)) {
        p.behavior_style = behaviors[Math.floor(Math.random() * behaviors.length)];
      }
    }

    console.log(`Generated ${personas.length} personas. Ages: ${personas.map((p: any) => p.age).join(', ')}`);

    // Determine booking intent distribution
    const effectiveBookingCount = testBooking ? Math.min(bookingCount, numPersonas) : 0;
    const effectiveCancelCount = (testCancellation || testReschedule) ? Math.min(cancelRescheduleCount, effectiveBookingCount) : 0;

    // Shuffle persona indices then assign intents
    const indices = Array.from({ length: personas.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const bookingIndices = new Set(indices.slice(0, effectiveBookingCount));
    const cancelIndices = new Set(indices.slice(0, effectiveCancelCount));

    const dateOptions = ['this week', 'next week', 'in two weeks', 'next month', 'this weekend', 'tomorrow', 'in a few days'];

    // Insert personas into database
    const personaRows = personas.map((p: any, idx: number) => {
      const isBooking = bookingIndices.has(idx);
      const isCancelOrReschedule = cancelIndices.has(idx);

      let bookingIntent = 'none';
      if (isBooking && isCancelOrReschedule) {
        bookingIntent = Math.random() > 0.5 ? 'book_and_cancel' : 'book_and_reschedule';
      } else if (isBooking) {
        bookingIntent = 'book';
      }

      const randomStr = Math.random().toString(36).substring(2, 10);
      const firstName = p.name.split(' ')[0] || 'Test';
      const lastName = p.name.split(' ').slice(1).join('') || 'User';
      const dummyEmail = `1prompt-simulation-${firstName.toLowerCase()}${lastName.toLowerCase()}-${randomStr}@gmail.com`;
      const dummyPhone = `+1555${String(Math.floor(Math.random() * 9000000) + 1000000)}`;

      const goalWithBooking = isBooking
        ? `${p.goal} | Style: ${p.behavior_style} | Booking: ${bookingIntent}`
        : `${p.goal} | Style: ${p.behavior_style}`;

      return {
        simulation_id: simulationId,
        icp_profile_id: icpProfileId || null,
        name: p.name,
        age: p.age,
        gender: p.gender,
        occupation: p.occupation,
        problem: p.problem,
        hobbies: p.hobbies,
        goal: goalWithBooking,
        avatar_seed: generateUniqueSeed(),
        assigned_message_count: p.message_count,
        status: "pending",
        dummy_email: dummyEmail,
        dummy_phone: dummyPhone,
        booking_intent: bookingIntent,
        preferred_booking_date: isBooking ? dateOptions[Math.floor(Math.random() * dateOptions.length)] : null,
      };
    });

    const { data: insertedPersonas, error: insertError } = await supabase
      .from("simulation_personas")
      .insert(personaRows)
      .select();

    if (insertError) throw insertError;

    // Update simulation status to 'personas_ready'
    await supabase
      .from("simulations")
      .update({ status: "personas_ready", updated_at: new Date().toISOString() })
      .eq("id", simulationId);

    return new Response(JSON.stringify({ personas: insertedPersonas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("generate-simulation-personas error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
