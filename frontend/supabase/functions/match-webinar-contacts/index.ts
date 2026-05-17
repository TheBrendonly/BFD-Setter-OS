import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loggedFetch } from "../_shared/request-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ZoomAttendee {
  userName: string;
  email?: string;
  joinTime: string;
  leaveTime: string;
  timeInSessionMinutes: number;
  isGuest: boolean;
  country: string;
}

interface ZoomRegistrant {
  firstName: string;
  lastName: string;
  email: string;
  userName: string;
}

interface GHLContact {
  contactId: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  email: string;
  created: string;
  lastActivity: string;
  tags: string;
}

interface MatchedContact {
  userName: string;
  attended: boolean;
  joinTime?: string;
  leaveTime?: string;
  timeInSessionMinutes: number;
  country: string;
  registrationEmail?: string;
  registrationFirstName?: string;
  registrationLastName?: string;
  contactId?: string;
  crmFirstName?: string;
  crmLastName?: string;
  crmEmail?: string;
  crmPhone?: string;
  crmTags?: string;
  matchConfidence: 'high' | 'medium' | 'low' | 'unmatched';
  matchMethod?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      clientId, 
      attendees,      // Attended report (people who joined)
      registrants,    // Not attended report (people who registered but didn't attend) - has emails!
      ghlContacts     // CRM contacts (has all contact details)
    } = await req.json();

    if (!clientId) {
      throw new Error("Client ID is required");
    }

    console.log(`Processing matching for client ${clientId}`);
    console.log(`Attendees: ${attendees?.length || 0}, Non-Attendees (Registrants): ${registrants?.length || 0}, CRM Contacts: ${ghlContacts?.length || 0}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch client's OpenRouter API key
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("openrouter_api_key")
      .eq("id", clientId)
      .single();

    if (clientError) throw new Error(`Failed to fetch client: ${clientError.message}`);
    
    const openrouterApiKey = client?.openrouter_api_key;

    // NEW APPROACH:
    // 1. Build a set of emails from the NOT ATTENDED report (these are people who didn't attend)
    // 2. Filter CRM contacts by removing those whose emails are in the not-attended set
    // 3. Remaining CRM contacts = Attended contacts with full CRM data
    // 4. Match attendees from the Attended Report with the filtered CRM contacts

    // Step 1: Build set of non-attendee emails from registration report
    const nonAttendeeEmails = new Set<string>();
    const nonAttendeeNames = new Set<string>();
    
    for (const reg of registrants || []) {
      if (reg.email) {
        nonAttendeeEmails.add(reg.email.toLowerCase().trim());
      }
      if (reg.userName) {
        nonAttendeeNames.add(reg.userName.toLowerCase().trim());
      }
      const fullName = `${reg.firstName || ''} ${reg.lastName || ''}`.toLowerCase().trim();
      if (fullName && fullName !== ' ') {
        nonAttendeeNames.add(fullName);
      }
    }

    console.log(`Non-attendee emails: ${nonAttendeeEmails.size}, Non-attendee names: ${nonAttendeeNames.size}`);

    // Step 2: Filter CRM contacts - keep only those NOT in the non-attendee list
    const attendedCRMContacts: GHLContact[] = [];
    const allCRMByEmail = new Map<string, GHLContact>();
    const allCRMByName = new Map<string, GHLContact>();
    
    for (const contact of ghlContacts || []) {
      const email = (contact.email || '').toLowerCase().trim();
      const name = (contact.name || '').toLowerCase().trim();
      
      // If this CRM contact's email is in the non-attendee list, skip them
      if (email && nonAttendeeEmails.has(email)) {
        console.log(`Filtered out non-attendee: ${email}`);
        continue;
      }
      
      // This CRM contact is potentially an attendee
      attendedCRMContacts.push(contact);
      
      if (email) {
        allCRMByEmail.set(email, contact);
      }
      if (name) {
        allCRMByName.set(name, contact);
      }
    }

    console.log(`Filtered CRM contacts (potential attendees): ${attendedCRMContacts.length} out of ${ghlContacts?.length || 0}`);

    // Step 3: Now match the Attended Report users with the filtered CRM contacts
    const matchedContacts: MatchedContact[] = [];
    const unmatchedAttendees: ZoomAttendee[] = [];

    for (const attendee of attendees || []) {
      const userName = (attendee.userName || '').toLowerCase().trim();
      const attendeeEmail = (attendee.email || '').toLowerCase().trim();
      
      let matchedGHL: GHLContact | undefined;
      let matchConfidence: 'high' | 'medium' | 'low' | 'unmatched' = 'unmatched';
      let matchMethod = '';

      // Strategy 1: Direct email match from attendee report
      if (attendeeEmail && allCRMByEmail.has(attendeeEmail)) {
        matchedGHL = allCRMByEmail.get(attendeeEmail);
        matchConfidence = 'high';
        matchMethod = 'email_direct';
      }
      
      // Strategy 2: Name match in CRM
      if (!matchedGHL && allCRMByName.has(userName)) {
        matchedGHL = allCRMByName.get(userName);
        matchConfidence = 'medium';
        matchMethod = 'name_direct';
      }
      
      // Strategy 3: Fuzzy name matching
      if (!matchedGHL) {
        for (const [crmName, contact] of allCRMByName) {
          const nameParts = userName.split(' ');
          const crmNameParts = crmName.split(' ');
          
          // Check if first names match
          if (nameParts[0] && crmNameParts[0] && nameParts[0] === crmNameParts[0] && nameParts[0].length > 2) {
            matchedGHL = contact;
            matchConfidence = 'low';
            matchMethod = 'first_name_match';
            break;
          }
          // Check if name contains
          if (crmName.includes(userName) || userName.includes(crmName)) {
            matchedGHL = contact;
            matchConfidence = 'low';
            matchMethod = 'name_contains';
            break;
          }
        }
      }

      if (matchedGHL) {
        matchedContacts.push({
          userName: attendee.userName,
          attended: true,
          joinTime: attendee.joinTime,
          leaveTime: attendee.leaveTime,
          timeInSessionMinutes: attendee.timeInSessionMinutes,
          country: attendee.country,
          contactId: matchedGHL.contactId,
          crmFirstName: matchedGHL.firstName,
          crmLastName: matchedGHL.lastName,
          crmEmail: matchedGHL.email,
          crmPhone: matchedGHL.phone,
          crmTags: matchedGHL.tags,
          matchConfidence,
          matchMethod,
        });
      } else {
        unmatchedAttendees.push(attendee);
      }
    }

    console.log(`Initial matching: ${matchedContacts.length} matched, ${unmatchedAttendees.length} unmatched`);

    // Step 4: Use LLM (Gemini 3 Pro Preview) to identify emails for unmatched attendees
    if (openrouterApiKey && unmatchedAttendees.length > 0 && attendedCRMContacts.length > 0) {
      console.log(`Using LLM (Gemini 3 Pro Preview) to match ${unmatchedAttendees.length} unmatched attendees`);
      
      // Prepare CRM contacts for LLM (only those not already matched)
      const matchedCRMIds = new Set(matchedContacts.map(c => c.contactId).filter(Boolean));
      const unmatchedCRM = attendedCRMContacts
        .filter(c => !matchedCRMIds.has(c.contactId))
        .slice(0, 200)
        .map(c => ({
          id: c.contactId,
          name: c.name,
          email: c.email,
          firstName: c.firstName,
          lastName: c.lastName,
        }));

      const unmatchedList = unmatchedAttendees.slice(0, 50).map(a => ({
        userName: a.userName,
        country: a.country,
      }));

      const prompt = `You are a data matching assistant. Match webinar attendees to CRM contacts based on name similarity.

WEBINAR ATTENDEES (display names from the webinar):
${JSON.stringify(unmatchedList, null, 2)}

CRM CONTACTS (registered contacts with real names and emails):
${JSON.stringify(unmatchedCRM, null, 2)}

TASK: For each attendee, find the best matching CRM contact. Consider:
1. Full name matches (e.g., "John Smith" = "John Smith")
2. Similar names (e.g., "Mike Arnold" might match "Michael Arnold")
3. Nicknames (e.g., "Bob" matches "Robert", "Bill" matches "William")
4. First name + partial last name matches
5. Name variations and typos

IMPORTANT: The goal is to identify the email ID of each attendee from the CRM.

Return a JSON array with format:
[
  { "userName": "attendee display name", "contactId": "matched CRM contact id or null", "confidence": "high|medium|low", "reasoning": "brief explanation" }
]

Only include matches you're confident about. If no good match, set contactId to null.`;

      try {
        const aiRequestBody = {
            model: "google/gemini-3-pro-preview",
            messages: [
              { role: "system", content: "You are a precise data matching assistant. Return only valid JSON arrays. Focus on identifying correct email IDs for webinar attendees." },
              { role: "user", content: prompt }
            ],
            temperature: 0.1,
            max_tokens: 4000,
        };
        const llmResponse = await loggedFetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${openrouterApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(aiRequestBody),
          },
          {
            client_id: clientId,
            request_type: "llm",
            source: "match-webinar-contacts",
            method: "POST",
            request_body: aiRequestBody as unknown as Record<string, unknown>,
            model: "google/gemini-3-pro-preview",
          }
        );

        if (llmResponse.ok) {
          const llmData = await llmResponse.json();
          const content = llmData.choices?.[0]?.message?.content || '';
          
          console.log("LLM response received, parsing...");
          
          // Extract JSON from response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const matches = JSON.parse(jsonMatch[0]);
            console.log(`LLM found ${matches.length} potential matches`);
            
            for (const match of matches) {
              if (match.contactId && (match.confidence === 'high' || match.confidence === 'medium')) {
                const crmContact = attendedCRMContacts.find(c => c.contactId === match.contactId);
                const attendee = unmatchedAttendees.find(a => a.userName === match.userName);
                
                if (crmContact && attendee) {
                  matchedContacts.push({
                    userName: attendee.userName,
                    attended: true,
                    joinTime: attendee.joinTime,
                    leaveTime: attendee.leaveTime,
                    timeInSessionMinutes: attendee.timeInSessionMinutes,
                    country: attendee.country,
                    contactId: crmContact.contactId,
                    crmFirstName: crmContact.firstName,
                    crmLastName: crmContact.lastName,
                    crmEmail: crmContact.email,
                    crmPhone: crmContact.phone,
                    crmTags: crmContact.tags,
                    matchConfidence: match.confidence as 'high' | 'medium',
                    matchMethod: `llm_matching: ${match.reasoning || 'AI identified'}`,
                  });
                  
                  // Remove from unmatched
                  const idx = unmatchedAttendees.findIndex(a => a.userName === attendee.userName);
                  if (idx > -1) unmatchedAttendees.splice(idx, 1);
                  
                  console.log(`LLM matched: "${attendee.userName}" -> "${crmContact.email}" (${match.confidence})`);
                }
              }
            }
          }
        } else {
          const errorText = await llmResponse.text();
          console.error("LLM API error:", llmResponse.status, errorText);
        }
      } catch (llmError) {
        console.error("LLM matching error:", llmError);
      }
    }

    // Add remaining unmatched attendees
    for (const attendee of unmatchedAttendees) {
      matchedContacts.push({
        userName: attendee.userName,
        attended: true,
        joinTime: attendee.joinTime,
        leaveTime: attendee.leaveTime,
        timeInSessionMinutes: attendee.timeInSessionMinutes,
        country: attendee.country,
        matchConfidence: 'unmatched',
      });
    }

    // Calculate statistics
    const stats = {
      totalAttendees: attendees?.length || 0,
      totalNonAttendees: registrants?.length || 0,
      totalGHLContacts: ghlContacts?.length || 0,
      filteredCRMContacts: attendedCRMContacts.length,
      matchedHigh: matchedContacts.filter(c => c.matchConfidence === 'high').length,
      matchedMedium: matchedContacts.filter(c => c.matchConfidence === 'medium').length,
      matchedLow: matchedContacts.filter(c => c.matchConfidence === 'low').length,
      unmatched: matchedContacts.filter(c => c.matchConfidence === 'unmatched').length,
      withPhoneCount: matchedContacts.filter(c => c.crmPhone).length,
      withEmailCount: matchedContacts.filter(c => c.crmEmail).length,
    };

    console.log("Final matching stats:", JSON.stringify(stats, null, 2));

    return new Response(
      JSON.stringify({ 
        success: true, 
        matchedContacts,
        stats,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in match-webinar-contacts:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
