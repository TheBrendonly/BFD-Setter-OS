import { createClient } from 'npm:@supabase/supabase-js@2.101.0'
import { loggedFetch } from "../_shared/request-logger.ts"
import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { clientId, timeRange = '7', triggerType = 'manual', customMetrics = [], backgroundTask = false } = await req.json()

    const shouldNotifyWebhook = triggerType !== 'auto-refresh'

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: 'Client ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // SEC-001 hardening: verify the caller's JWT owns this clientId before
    // touching any tenant data. Without this an attacker who knows another
    // client's UUID could read that client's chat-analytics output.
    try {
      await assertClientAccess(req.headers.get("Authorization"), clientId);
    } catch (authErr) {
      if (authErr instanceof AssertAccessError) {
        return new Response(
          JSON.stringify({ error: authErr.message }),
          { status: authErr.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw authErr;
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get client configuration
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('supabase_url, supabase_service_key, supabase_table_name, analytics_webhook_url, openrouter_api_key')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: 'Client not found or configuration missing' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!client.supabase_url || !client.supabase_service_key || !client.supabase_table_name) {
      return new Response(
        JSON.stringify({ error: 'Client Supabase configuration is incomplete' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!client.analytics_webhook_url) {
      return new Response(
        JSON.stringify({ error: 'Analytics webhook URL not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Define the background analytics processing task
    async function processAnalytics() {
      try {
        console.log(`Processing analytics for client ${clientId}, timeRange: ${timeRange}`)
        
        // Create client for external Supabase - client is guaranteed to exist here
        const externalSupabase = createClient(client!.supabase_url, client!.supabase_service_key)

        // Calculate date range
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - parseInt(timeRange))

        console.log(`Fetching data from ${startDate.toISOString()} to ${endDate.toISOString()}`)

        // Determine which timestamp column exists by probing common names with a filtered query
        let timestampColumn: string | null = null;
        const candidates = ['created_at', 'timestamp', 'time', 'date', 'created', 'inserted_at'];
        for (const col of candidates) {
          const test = externalSupabase
            .from(client!.supabase_table_name)
            .select(col)
            .gte(col, startDate.toISOString())
            .lte(col, endDate.toISOString())
            .limit(1);
          const { error: probeError } = await test;
          if (!probeError) {
            timestampColumn = col;
            console.log(`Using timestamp column: ${timestampColumn}`);
            break;
          }
          if (probeError && probeError.code !== '42703') {
            console.warn(`Column probe for ${col} returned error:`, probeError);
          }
        }


        // Fetch chat data from external Supabase with appropriate filters
        let query = externalSupabase.from(client!.supabase_table_name).select('*');
        
        if (timestampColumn) {
          query = query
            .gte(timestampColumn, startDate.toISOString())
            .lte(timestampColumn, endDate.toISOString())
            .order(timestampColumn, { ascending: true });
        } else {
          // If no timestamp column, just get recent data by limiting results
          query = query.limit(1000);
        }

        const { data: chatData, error: chatError } = await query;

        if (chatError || !chatData || chatData.length === 0) {
          if (chatError) {
            console.error('Error fetching chat data:', chatError)
          } else {
            console.log('No chat data found for the specified time range')
          }
          // Save empty (N/A) results but still notify webhook
          const emptyMetrics = {
            Bot_Messages: 0,
            New_Users: 0,
            Total_Conversations: 0,
            "Other Metrics": {}
          }

          await supabase
            .from('chat_analytics')
            .upsert({
              client_id: clientId,
              time_range: timeRange,
              metrics: emptyMetrics,
              last_updated: new Date().toISOString()
            }, {
              onConflict: 'client_id,time_range'
            })

          // Send to webhook even when there is no data or an error fetching
          if (shouldNotifyWebhook && client!.analytics_webhook_url) {
            await fetch(client!.analytics_webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId,
                timeRange,
                triggerType,
                metrics: emptyMetrics,
                error: chatError ? chatError.message : undefined,
                timestamp: new Date().toISOString()
              })
            }).catch((e) => console.error('Webhook call failed:', e))
          }

          return { success: true, data: emptyMetrics }
        }

        // Prepare data for OpenRouter AI analysis
        const formattedMessages = chatData.map((row: any) => {
          const message = row.message || row
          return {
            role: message.role || 'unknown',
            content: message.content || message.message || '',
            timestamp: row.created_at || new Date().toISOString()
          }
        })

        // Create analysis prompt with custom metrics
        let analysisPrompt = `
        Analyze the following chat conversation data and provide analytics in this EXACT JSON format:
        {
          "Bot_Messages": <number>,
          "New_Users": <number>, 
          "Total_Conversations": <number>,
          "Other Metrics": {
            "Thank You Count": <number>,
            "Questions Asked": <number>
          }
        }

        Rules:
        - Bot_Messages: Count messages with role "assistant" or "bot"
        - New_Users: Count unique users (estimate based on conversation patterns)
        - Total_Conversations: Count distinct conversation sessions
        - Thank You Count: Count messages containing thanks/gratitude
        - Questions Asked: Count messages from users that end with "?" or contain question words

        Chat data to analyze:
        ${JSON.stringify(formattedMessages.slice(0, 100))} // Limit for token efficiency
        `

        // Add custom metrics to prompt and response format
        if (customMetrics && customMetrics.length > 0) {
          customMetrics.forEach((metric: any) => {
            analysisPrompt += `\n- ${metric.name}: ${metric.prompt}`
          })

          // Update expected response format for custom metrics
          const customMetricsFormat = customMetrics.map((m: any) => `"${m.name}": <number>`).join(',\n            ')
          analysisPrompt = analysisPrompt.replace(
            '"Questions Asked": <number>',
            `"Questions Asked": <number>,
            ${customMetricsFormat}`
          )
        }

        analysisPrompt += `\n\nReturn ONLY the JSON object, no additional text.`

        // Call OpenRouter for AI analysis
        if (!client!.openrouter_api_key) {
          throw new Error('OpenRouter API key not configured')
        }

        const analysisReqBody = {
            model: 'anthropic/claude-3.5-sonnet',
            messages: [
              {
                role: 'user',
                content: analysisPrompt
              }
            ],
            temperature: 0.1,
            max_tokens: 1000
        }

        const openRouterResponse = await loggedFetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${client!.openrouter_api_key}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://your-app.com',
              'X-Title': 'Chat Analytics'
            },
            body: JSON.stringify(analysisReqBody)
          },
          {
            client_id: clientId,
            request_type: 'llm',
            source: 'analyze-chat-history',
            method: 'POST',
            request_body: analysisReqBody as unknown as Record<string, unknown>,
            model: 'anthropic/claude-3.5-sonnet',
          }
        )

        if (!openRouterResponse.ok) {
          const errorText = await openRouterResponse.text()
          console.error('OpenRouter API error:', errorText)
          throw new Error(`OpenRouter API error: ${openRouterResponse.status} ${errorText}`)
        }

        const aiResult = await openRouterResponse.json()
        
        if (!aiResult.choices || !aiResult.choices[0]) {
          console.error('Unexpected OpenRouter response:', aiResult)
          throw new Error('Invalid response from OpenRouter API')
        }

        const analysisContent = aiResult.choices[0].message.content
        console.log('AI Analysis Result:', analysisContent)

        // Parse AI response
        let metrics
        try {
          metrics = JSON.parse(analysisContent)
        } catch (parseError) {
          console.error('Failed to parse AI response:', analysisContent)
          throw new Error('Failed to parse AI analysis results')
        }

        // Save results to our database
        const { error: saveError } = await supabase
          .from('chat_analytics')
          .upsert({
            client_id: clientId,
            time_range: timeRange,
            metrics: metrics,
            last_updated: new Date().toISOString()
          }, {
            onConflict: 'client_id,time_range'
          })

        if (saveError) {
          console.error('Error saving analytics:', saveError)
          throw new Error(`Failed to save analytics: ${saveError.message}`)
        }

        // Send to webhook if configured
        if (shouldNotifyWebhook && client!.analytics_webhook_url) {
          try {
            await fetch(client!.analytics_webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId,
                timeRange,
                triggerType,
                metrics,
                timestamp: new Date().toISOString()
              })
            })
            console.log('Analytics sent to webhook successfully')
          } catch (webhookError) {
            console.error('Error sending to webhook:', webhookError)
            // Don't fail the entire operation for webhook errors
          }
        }

        console.log(`Analytics processing completed for client ${clientId}`)
        return { success: true, data: metrics }

      } catch (error) {
        console.error(`Analytics processing failed for client ${clientId}:`, error)
        // Always notify webhook on errors as well
        try {
          if (client!.analytics_webhook_url) {
            await fetch(client!.analytics_webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId,
                timeRange,
                triggerType,
                metrics: null,
                error: (error as Error).message,
                timestamp: new Date().toISOString()
              })
            })
            console.log('Error notification sent to webhook successfully')
          }
        } catch (notifyErr) {
          console.error('Webhook error notification failed:', notifyErr)
        }
        throw error
      }
    }

    // If this is a background task, start it without awaiting
    if (backgroundTask) {
      // Use EdgeRuntime.waitUntil to ensure task completion even after response
      const backgroundPromise = processAnalytics().then((result) => {
        console.log('Background analytics processing completed successfully')
        // Ensure data is persisted by doing an additional verification save
        return supabase
          .from('chat_analytics')
          .upsert({
            client_id: clientId,
            time_range: timeRange,
            metrics: result.data,
            last_updated: new Date().toISOString()
          }, {
            onConflict: 'client_id,time_range'
          })
      }).catch(async (error) => {
        console.error('Background analytics processing failed:', error)
        // Notify webhook about the failure as well
        try {
          if (client!.analytics_webhook_url) {
            await fetch(client!.analytics_webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientId,
                timeRange,
                triggerType,
                metrics: null,
                error: (error as Error).message,
                timestamp: new Date().toISOString()
              })
            })
            console.log('Background error notification sent to webhook successfully')
          }
        } catch (notifyErr) {
          console.error('Background webhook error notification failed:', notifyErr)
        }
        // Even on failure, save an error state so user knows what happened
        return supabase
          .from('chat_analytics')
          .upsert({
            client_id: clientId,
            time_range: timeRange,
            metrics: { 
              error: 'Processing failed', 
              message: (error as Error).message,
              timestamp: new Date().toISOString()
            },
            last_updated: new Date().toISOString()
          }, {
            onConflict: 'client_id,time_range'
          })
      })
      
      // Ensure the task runs to completion even if response is sent
      // Use a simple promise handling since EdgeRuntime may not be available
      backgroundPromise.catch(console.error)
      
      // Return immediate response
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Analytics processing started in background - data will persist permanently',
          clientId,
          timeRange,
          note: 'Data will be saved to database and persist across all sessions'
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    } else {
      // Process synchronously for immediate response
      const result = await processAnalytics()
      return new Response(
        JSON.stringify(result),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

  } catch (error) {
    console.error('Error in analyze-chat-history function:', error)
    return new Response(
      JSON.stringify({ 
        error: (error as Error).message,
        details: 'Failed to process analytics request'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

// Add graceful shutdown handling
self.addEventListener('beforeunload', () => {
  console.log('Function is shutting down gracefully')
})