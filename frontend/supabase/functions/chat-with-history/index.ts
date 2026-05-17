import { loggedFetch } from "../_shared/request-logger.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId, supabaseConfig, timeRange, question, openrouterApiKey, chatHistory } = await req.json();

    if (!clientId || !supabaseConfig?.serviceKey || !supabaseConfig?.tableName || !openrouterApiKey || !question) {
      throw new Error('Missing required parameters');
    }

    // Calculate date range with natural-language overrides from the question
    let endDate = new Date();
    let startDate = new Date();
    let timeWindowLabel = `${timeRange} days`;
    let noTimeFilter = false;
    const tf = inferTimeframe(String(question || ''));
    if (tf) {
      if (tf.noTimeFilter) {
        noTimeFilter = true;
        timeWindowLabel = tf.label || 'all time';
      } else if (tf.startDate && tf.endDate) {
        startDate = tf.startDate;
        endDate = tf.endDate;
        timeWindowLabel = tf.label || timeWindowLabel;
      }
    } else {
      startDate.setDate(endDate.getDate() - parseInt(timeRange || '7'));
    }

    // Classify intent: conversation vs data analysis
    const intent = classifyIntent(String(question || ''));
    if (intent !== 'data') {
      try {
        const messages = [
          { role: 'system', content: "You are a friendly conversational AI for a chat analytics app. Keep replies short (1–2 sentences). If the user asks about data, politely ask what timeframe or metric they want. Do not fabricate numbers." },
          ...buildHistoryMessages(chatHistory),
          { role: 'user', content: String(question || '') }
        ];

        const chatReqBody = {
            model: 'google/gemini-2.5-flash',
            messages,
            max_tokens: 300,
            temperature: 0.6
        };
        const resp = await loggedFetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openrouterApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(chatReqBody),
          },
          {
            client_id: clientId,
            request_type: 'llm',
            source: 'chat-with-history-conversational',
            method: 'POST',
            request_body: chatReqBody as unknown as Record<string, unknown>,
            model: 'google/gemini-2.5-flash',
          }
        );

        if (resp.ok) {
          const data = await resp.json();
          const answer = data.choices?.[0]?.message?.content || generateConversationalResponse(intent, String(question || ''), chatHistory);
          return new Response(
            JSON.stringify({ success: true, answer, dataPoints: 0, dataPointsAnalyzed: 0, timeRange: `${timeWindowLabel}` }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) {
        console.warn('Conversational LLM fallback:', e);
      }
      const answer = generateConversationalResponse(intent, String(question || ''), chatHistory);
      return new Response(
        JSON.stringify({ success: true, answer, dataPoints: 0, dataPointsAnalyzed: 0, timeRange: `${timeWindowLabel}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract project URL from service key
    const supabaseUrl = `https://${extractProjectId(supabaseConfig.serviceKey)}.supabase.co`;
    
    // Create external Supabase client
    const externalSupabase = createClient(supabaseUrl, supabaseConfig.serviceKey);

    // Peek at one row to infer schema
    const sampleRes = await externalSupabase
      .from(supabaseConfig.tableName)
      .select('*')
      .limit(1);

    if (sampleRes.error) {
      console.error('Error fetching sample row:', sampleRes.error);
      throw new Error(`Failed to probe table: ${sampleRes.error.message}`);
    }

    const sample = (sampleRes.data && sampleRes.data[0]) || {} as Record<string, any>;
    const cols = Object.keys(sample);

    // Detect columns flexibly
    const pick = (candidates: string[]) => candidates.find((c) => cols.includes(c));
    const timestampCol = pick(['created_at','timestamp','time','ts','inserted_at','date','datetime']);
    const roleCol = pick(['role','sender','author','from']);
    const sessionCol = pick(['session_id','session']);
    const conversationCol = pick(['conversation_id','thread_id','chat_id']);
    const messageCol = pick(['message','content','text','body']);

    // Build query with optional time filter - fetch ALL data within timeframe
    let allChatData: any[] = [];
    let query = externalSupabase.from(supabaseConfig.tableName).select('*');
    
    if (timestampCol) {
      query = query.order(timestampCol, { ascending: false });
      if (!noTimeFilter) {
        query = query
          .gte(timestampCol, startDate.toISOString())
          .lte(timestampCol, endDate.toISOString());
      }
    }

    // Fetch ALL data using pagination to avoid limits
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const batchQuery = query.range(from, from + batchSize - 1);
      const { data: batchData, error: batchError } = await batchQuery;

      if (batchError) {
        console.error('Error fetching chat data batch:', batchError);
        throw new Error(`Failed to fetch chat data: ${batchError.message}`);
      }

      if (batchData && batchData.length > 0) {
        allChatData.push(...batchData);
        from += batchSize;
        hasMore = batchData.length === batchSize; // Continue if we got a full batch
      } else {
        hasMore = false;
      }
    }

    // If no timestamp column, limit to reasonable amount for processing
    if (!timestampCol && allChatData.length > 5000) {
      allChatData = allChatData.slice(0, 5000);
      console.log('Limited to 5000 records due to no timestamp filtering');
    }

    console.log(`Fetched ${allChatData.length} chat records for RAG analysis (timeframe: ${timeWindowLabel})`);
    
    const chatData = allChatData;

    // ==== Deterministic analytics helpers (for exact answers) ====
    const toText = (row: any): string => {
      const m = messageCol ? row[messageCol] : (row.message ?? row.content ?? row.text ?? row.body);
      if (typeof m === 'string') return m;
      if (m && typeof m === 'object') return m.content || m.text || m.message || JSON.stringify(m);
      return '';
    };
    const normRole = (val: any): string => (val ?? '').toString().toLowerCase();
    const getRole = (row: any): 'assistant' | 'user' | 'system' | 'unknown' => {
      const r = roleCol ? normRole(row[roleCol]) : normRole(row.role);
      if (['assistant','bot','ai'].includes(r)) return 'assistant';
      if (['user','human','customer','client'].includes(r)) return 'user';
      if (['system','tool'].includes(r)) return 'system';
      return 'unknown';
    };
    const getSessionId = (row: any): string => {
      if (sessionCol && row[sessionCol] != null) return String(row[sessionCol]);
      return String(row.session_id || row.session || 'unknown');
    };

    // Sets and counts
    const sessionSet = new Set<string>();
    let totalConversations = 0;
    for (const row of chatData) {
      sessionSet.add(getSessionId(row));
      const r = getRole(row);
      if (r === 'assistant' || r === 'user') totalConversations++;
    }

    // Compute NEW sessions (first-time) by looking before the start date
    let newSessions = sessionSet.size;
    if (timestampCol && sessionCol) {
      const allSids = Array.from(sessionSet);
      const chunk = (arr: string[], size = 1000) => arr.reduce((acc: string[][], _v, i) => {
        if (i % size === 0) acc.push(arr.slice(i, i + size));
        return acc;
      }, []);
      const sidChunks = chunk(allSids, 500);
      const seenBefore = new Set<string>();
      for (const ch of sidChunks) {
        const { data: prior, error: priorErr } = await externalSupabase
          .from(supabaseConfig.tableName)
          .select(sessionCol)
          .in(sessionCol, ch)
          .lt(timestampCol, startDate.toISOString());
        if (priorErr) console.warn('Error checking prior sessions:', priorErr);
        for (const r of prior || []) seenBefore.add(String((r as any)[sessionCol]));
      }
      newSessions = allSids.filter((sid) => !seenBefore.has(sid)).length;
    }

    // Intent-specific deterministic answers
    const qLower = String(question || '').toLowerCase();

    // Count phrase occurrences per unique session (people who asked/say X)
    const extractQuoted = (q: string) => {
      const m = q.match(/["“”']([^"“”']+)["“”']/);
      return m ? m[1] : '';
    };

    // Follow-up understanding: detect metric from current text or infer from recent history
    const metricInQuestion = detectMetricFromText(qLower);
    const lastMetric = inferFollowUpMetricFromHistory(chatHistory);
    const mentionsSame = /\b(same( thing)?|do the same|again|that too|same one)\b/.test(qLower);
    const timeframeOnly = !metricInQuestion && (mentionsSame || Boolean(tf));
    const resolvedMetric = metricInQuestion || (timeframeOnly ? lastMetric : null);

    if (resolvedMetric === 'new_users') {
      const answer = `New users (first-time sessions) in the last ${timeWindowLabel}: ${newSessions}.`;
      return new Response(JSON.stringify({ success: true, answer, dataPointsAnalyzed: chatData.length, timeRange: `${timeWindowLabel}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (resolvedMetric === 'unique_sessions') {
      const uniqueSessions = sessionSet.size;
      const answer = `Unique conversations (sessions) in the last ${timeWindowLabel}: ${uniqueSessions}.`;
      return new Response(JSON.stringify({ success: true, answer, dataPointsAnalyzed: chatData.length, timeRange: `${timeWindowLabel}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (resolvedMetric === 'total_messages') {
      const answer = `Total conversation messages (user + assistant) in the last ${timeWindowLabel}: ${totalConversations}.`;
      return new Response(JSON.stringify({ success: true, answer, dataPointsAnalyzed: chatData.length, timeRange: `${timeWindowLabel}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Explicit metric requests
    if (/new\s+users?|first[-\s]?time/.test(qLower)) {
      const answer = `New users (first-time sessions) in the last ${timeWindowLabel}: ${newSessions}.`;
      return new Response(JSON.stringify({ success: true, answer, dataPointsAnalyzed: chatData.length, timeRange: `${timeWindowLabel}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (/(unique\s+)?sessions?/.test(qLower) && /(how many|count|total)/.test(qLower)) {
      const uniqueSessions = sessionSet.size;
      const answer = `Unique conversations (sessions) in the last ${timeWindowLabel}: ${uniqueSessions}.`;
      return new Response(JSON.stringify({ success: true, answer, dataPointsAnalyzed: chatData.length, timeRange: `${timeWindowLabel}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (/(total|how many).*\b(conversation|messages)\b/.test(qLower)) {
      const answer = `Total conversation messages (user + assistant) in the last ${timeWindowLabel}: ${totalConversations}.`;
      return new Response(JSON.stringify({ success: true, answer, dataPointsAnalyzed: chatData.length, timeRange: `${timeWindowLabel}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const askSaidRegex = /how many (people\s+)?(asked|say|said|mentioned)\s+/i;
    if (askSaidRegex.test(qLower)) {
      const phrase = extractQuoted(String(question));
      if (phrase) {
        const phraseLc = phrase.toLowerCase();
        const sessionsWithPhrase = new Set<string>();
        for (const row of chatData) {
          if (getRole(row) !== 'user') continue;
          const txt = toText(row).toLowerCase();
          if (txt.includes(phraseLc)) sessionsWithPhrase.add(getSessionId(row));
        }
        const answer = `"${phrase}" was asked/said by ${sessionsWithPhrase.size} unique sessions in the last ${timeWindowLabel}.`;
        return new Response(JSON.stringify({ success: true, answer, dataPointsAnalyzed: chatData.length, timeRange: `${timeWindowLabel}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // === Fallback to LLM for other open-ended analysis ===

    // Prepare a smart conversational prompt that distinguishes between chat and data analysis
    const systemPrompt = `You're a friendly chat data analyst AI. You need to be smart about when someone is talking TO you vs asking ABOUT data.

## Core Understanding:
**IMPORTANT**: Not every message is a data analysis request! You need to distinguish between:

### Type 1: General Conversation (talk TO the AI)
Examples: "who are you?", "hello", "hi", "how are you?", "what can you do?", "thanks"
**Response**: Answer as a friendly AI assistant, introduce yourself and your capabilities

### Type 2: Data Analysis Questions (ask ABOUT the data) 
Examples: "how many people asked X?", "what are common questions?", "analyze sentiment", "show me patterns"
**Response**: Analyze the chat data and provide insights

## Your Identity (for Type 1 questions):
You're a chat analytics AI that can analyze conversation data from the selected period: ${timeWindowLabel}. You help understand patterns, trends, and insights from ${chatData?.length || 0} chat messages collected within this period.

## Data Analysis Capability (for Type 2 questions):
- Complete dataset from: ${startDate.toDateString()} to ${endDate.toDateString()} (${timeWindowLabel})
- Total messages analyzed: ${chatData?.length || 0} messages  
- Data columns available:
  - Timestamp: ${timestampCol || 'not available'}
  - Message content: ${messageCol || 'not available'} 
  - Participants: ${roleCol || 'not available'}
  - Sessions: ${sessionCol || 'not available'}

## How to Respond:

### For General Conversation:
"Hey! I'm your chat analytics AI. I've got ${chatData?.length || 0} messages from ${timeWindowLabel} loaded up. You can ask me things like 'what are people talking about?' or 'how many times did someone say X?' - or just chat with me!"

### For Data Analysis:
Analyze the actual data and give specific insights like:
"People asked 'why are you' 3 times this week" or "Most common topic is pricing (mentioned 15 times)"

## Decision Rules:
- If they're asking about YOU (who/what/how are you) → General conversation
- If they're asking about PEOPLE/USERS/DATA → Data analysis  
- If they're greeting (hi/hello/hey) → General conversation
- If they mention COUNTING/ANALYZING/PATTERNS → Data analysis
- When in doubt, ask what they'd like to know about their data

Stay conversational and helpful in both modes!`;

    const userPrompt = `Hey! I've got a quick question about our chat data:

${buildEffectiveQuestion(String(question || ''), chatHistory, tf, timeWindowLabel)}

**Recent Conversation Context (most recent first):**
${summarizeHistory(chatHistory, 15)}

**Complete Dataset Info:**
- Time period: ${startDate.toDateString()} to ${endDate.toDateString()} (${timeWindowLabel})
- Total messages analyzed: ${chatData?.length || 0} chat messages
- Data source: ${supabaseConfig.tableName}

Here's a representative sample of the data to analyze:
${JSON.stringify((chatData||[]).slice(0,200), null, 2)}

IMPORTANT: Base your analysis on the COMPLETE dataset of ${chatData?.length || 0} messages, not just this sample. If the current request is a follow-up like "for last 2 days", apply it to the previous intent/question from context.`;

    // Compose messages (no user-editable model; fixed Gemini 2.5 Flash)
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const analysisReqBody = {
        model: 'google/gemini-2.5-flash',
        messages,
        max_tokens: 1500,
        temperature: 0.2
    };
    const openRouterResponse = await loggedFetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(analysisReqBody),
      },
      {
        client_id: clientId,
        request_type: 'llm',
        source: 'chat-with-history-analysis',
        method: 'POST',
        request_body: analysisReqBody as unknown as Record<string, unknown>,
        model: 'google/gemini-2.5-flash',
      }
    );

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      console.error('OpenRouter API error:', errorText);
      throw new Error(`OpenRouter API error: ${openRouterResponse.status}`);
    }

    const openRouterData = await openRouterResponse.json();
    const answer = openRouterData.choices[0].message.content;

    console.log('Generated response for question:', question);

    return new Response(JSON.stringify({ 
      success: true,
      answer,
      dataPointsAnalyzed: chatData?.length || 0,
      timeRange: `${timeWindowLabel}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in chat-with-history:', error);
    return new Response(JSON.stringify({ 
      error: (error as any)?.message || 'Failed to process chat query' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function extractProjectId(serviceKey: string): string {
  try {
    const base64Payload = serviceKey.split('.')[1];
    const decoded = JSON.parse(atob(base64Payload));
    return decoded.ref || 'unknown-project';
  } catch (error) {
    console.error('Failed to extract project ID from service key:', error);
    throw new Error('Invalid service key format. Please provide a valid Supabase service role key.');
  }
}

function classifyIntent(raw: string): 'greeting' | 'how_are_you' | 'who_are_you' | 'capabilities' | 'thanks' | 'smalltalk' | 'data' | 'conversation' {
  const q = (raw || '').toLowerCase().trim();

  // Explicit data-analysis keywords
  const dataKeywords = /(how many|count|top|most common|trending|pattern|analyse|analyze|show me|frequency|freq|stats|statistics|occur|occurrence|mentions|compare|trend|increase|decrease)/i;
  // Timeframe phrases imply data context (e.g., "for 30 days", "last week", "for all")
  const timeframeRegex = /(?:last|past|for)\s+\d+\s*(day|days|week|weeks|month|months|year|years)\b|(?:all time|for all|overall|entire|since start|lifetime)|\b(this|last)\s+(week|month|year)\b|^for\s+all\b|^for\s+\d+\s*(days?|weeks?|months?|years?)\b/i;
  if (dataKeywords.test(q) || timeframeRegex.test(q)) return 'data';

  if (/^(hi|hey|hello|yo|sup|good\s(morning|afternoon|evening))\b/.test(q)) return 'greeting';
  if (/(how are (you|u)|how's it going|hows it going|how r u)/.test(q)) return 'how_are_you';
  if (/(who are you|what are you|who r u)/.test(q)) return 'who_are_you';
  if (/(what can you do|capabilities|how can you help|what do you do)/.test(q)) return 'capabilities';
  if ((/(thank you|thanks|thx|appreciate it)/.test(q))) return 'thanks';
  if (/(nice to meet you|good to see you|bye|goodbye|see you|see ya)/.test(q)) return 'smalltalk';

  return 'conversation';
}

// Metric detection from plain text
function detectMetricFromText(q: string): 'unique_sessions' | 'total_messages' | 'new_users' | null {
  const text = (q || '').toLowerCase();
  if (/new\s+users?|first[-\s]?time/.test(text)) return 'new_users';
  // If they mention conversations or sessions w/o "messages", assume unique sessions
  if (/(unique|total)?\s*(conversations?|sessions?)\b/.test(text) && !/messages?/.test(text)) return 'unique_sessions';
  if (/(total|count|how many).*\b(messages?|conversation messages?)\b/.test(text)) return 'total_messages';
  return null;
}

// Infer the metric the user is referring to from recent history (last 6 msgs)
function inferFollowUpMetricFromHistory(hist?: any[]): 'unique_sessions' | 'total_messages' | 'new_users' | null {
  if (!Array.isArray(hist) || hist.length === 0) return null;
  const lastFew = hist.slice(-6).reverse();
  for (const m of lastFew) {
    const role = String(m?.role || '').toLowerCase();
    const content = String(m?.content || m?.message || m?.text || '').toLowerCase();
    // Prefer explicit user requests
    const userMetric = detectMetricFromText(content);
    if (role === 'user' && userMetric) return userMetric;
    // Parse assistant answers generated by this function
    if (role === 'assistant') {
      if (/unique (conversations|sessions)/.test(content)) return 'unique_sessions';
      if (/total (conversation )?messages/.test(content)) return 'total_messages';
      if (/new users?/.test(content) || /first-time/.test(content)) return 'new_users';
    }
  }
  return null;
}

// Natural-language timeframe parser
function inferTimeframe(q: string): { startDate?: Date; endDate?: Date; label?: string; noTimeFilter?: boolean } | null {
  const text = (q || '').toLowerCase();
  const now = new Date();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

  // All time / overall
  if (/\b(all time|for all|overall|entire|since start|lifetime)\b/.test(text)) {
    return { noTimeFilter: true, label: 'all time' };
  }

  // Numeric ranges: last/past/for N units
  const m = text.match(/(?:last|past|for)\s+(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (m) {
    const n = parseInt(m[1]);
    const unit = m[2];
    let days = n;
    if (unit.startsWith('week')) days = n * 7;
    else if (unit.startsWith('month')) days = n * 30;
    else if (unit.startsWith('year')) days = n * 365;
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    return { startDate: start, endDate: now, label: `${n} ${unit}` };
  }

  // Today / Yesterday
  if (/\btoday\b/.test(text)) {
    return { startDate: startOfDay(now), endDate: now, label: 'today' };
  }
  if (/\byesterday\b/.test(text)) {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    return { startDate: startOfDay(y), endDate: endOfDay(y), label: 'yesterday' };
  }

  // This week (Mon..now) and last week (Mon..Sun)
  if (/\bthis week\b/.test(text)) {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Mon=0
    const start = new Date(d); start.setDate(d.getDate() - day); start.setHours(0,0,0,0);
    return { startDate: start, endDate: now, label: 'this week' };
  }
  if (/\blast week\b/.test(text)) {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Mon=0
    const end = new Date(d); end.setDate(d.getDate() - day - 1); end.setHours(23,59,59,999);
    const start = new Date(end); start.setDate(end.getDate() - 6); start.setHours(0,0,0,0);
    return { startDate: start, endDate: end, label: 'last week' };
  }

  // This month and last month
  if (/\bthis month\b/.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: start, endDate: now, label: 'this month' };
  }
  if (/\blast month\b/.test(text)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0); end.setHours(23,59,59,999);
    return { startDate: start, endDate: end, label: 'last month' };
  }

  return null;
}

// Map recent chat history (last 30 messages) into OpenRouter format safely
function buildHistoryMessages(hist?: any[]): { role: 'user' | 'assistant' | 'system'; content: string }[] {
  if (!Array.isArray(hist)) return [];
  try {
    return hist.slice(-30).map((m: any) => {
      const roleRaw = String((m?.role ?? m?.sender ?? 'user')).toLowerCase();
      const role: 'user' | 'assistant' | 'system' = roleRaw.includes('assistant')
        ? 'assistant'
        : roleRaw.includes('system')
          ? 'system'
          : 'user';
      const content = typeof m?.content === 'string'
        ? m.content
        : (m?.message ?? m?.text ?? m?.body ?? '');
      return { role, content: String(content ?? '').slice(0, 2000) };
    }).filter((m) => m.content);
  } catch {
    return [];
  }
}

// Produce a compact, readable summary of recent history for context
function summarizeHistory(hist?: any[], limit: number = 12): string {
  if (!Array.isArray(hist) || hist.length === 0) return 'None';
  const recent = hist.slice(-limit).reverse(); // most recent first
  const lines = recent.map((m: any) => {
    const roleRaw = String((m?.role ?? m?.sender ?? 'user')).toLowerCase();
    const who = roleRaw.includes('assistant') ? 'AI' : roleRaw.includes('system') ? 'System' : 'User';
    const content = String(m?.content ?? m?.message ?? m?.text ?? m?.body ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    return `- ${who}: ${content}`;
  });
  return lines.join('\n');
}

// Build an effective query by applying follow-up context (e.g., timeframe-only requests)
function buildEffectiveQuestion(q: string, hist?: any[], tf?: any, label?: string): string {
  const qTrim = String(q || '').trim();
  const hasMetric = Boolean(detectMetricFromText(qTrim));
  const hasTf = Boolean(tf);
  const looksLikeFollowUp = /^(for|last|past|this|that|same|again|do the same)/i.test(qTrim) || hasTf;
  if (looksLikeFollowUp && !hasMetric) {
    const prevUser = Array.isArray(hist)
      ? [...hist].reverse().find((m) => String(m?.role ?? m?.sender ?? '').toLowerCase().includes('user'))
      : null;
    const prevText = prevUser
      ? String(prevUser?.content ?? prevUser?.message ?? prevUser?.text ?? prevUser?.body ?? '').trim()
      : '';
    if (prevText) {
      const tfLabel = (tf && tf.label) ? tf.label : (label || '');
      const tfSuffix = tfLabel ? ` (Apply timeframe: ${tfLabel})` : '';
      return `Follow-up to previous question: "${prevText}"${tfSuffix}`;
    }
  }
  return `"${qTrim}"`;
}

function generateConversationalResponse(intent: string, q: string, chatHistory?: any[]): string {
  switch (intent) {
    case 'greeting':
      return "Hey! What's up? If you want, I can look up something from your chats too.";
    case 'how_are_you':
      return "I'm doing great and ready to help. How can I help with your chat data today?";
    case 'who_are_you':
      return "I'm your chat analytics AI — I can quickly answer things about your conversations like counts, patterns, and common topics.";
    case 'capabilities':
      return "I can count things (e.g., 'how many asked \"pricing\"?'), find trends, and surface top topics. Ask away!";
    case 'thanks':
      return "Anytime!";
    case 'smalltalk':
      return "Same here! When you're ready, ask me anything about your chats.";
    case 'conversation':
    default:
      return "Got it. If you want me to dig into the data, say something like 'how many people asked \"pricing\"?' Otherwise, happy to chat!";
  }
}
