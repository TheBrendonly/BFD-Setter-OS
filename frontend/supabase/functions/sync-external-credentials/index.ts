import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || supabaseKey;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify auth using local JWT validation
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const user = { id: claimsData.claims.sub as string };

    // Get client data
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify agency access
    const { data: profile } = await supabase
      .from('profiles')
      .select('agency_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.agency_id !== client.agency_id) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if external Supabase is configured
    const extUrl = client.supabase_url?.trim();
    const extKey = client.supabase_service_key?.trim();

    if (!extUrl || !extKey) {
      return new Response(JSON.stringify({ error: 'External Supabase credentials not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Connect to external Supabase
    const extSupabase = createClient(extUrl, extKey);

    // Build the credentials payload matching the external credentials table columns
    const credentialsPayload: Record<string, string | null> = {
      supabase_project_url: extUrl,
      supabase_service_role_key: extKey,
      openai_api_key: client.openai_api_key || null,
      openrouter_api_key: client.openrouter_api_key || null,
      text_engine_webhook: client.text_engine_webhook || null,
      simulation_webhook: client.simulation_webhook || null,
      send_message_webhook_url: client.send_message_webhook_url || null,
      send_followup_webhook_url: client.send_followup_webhook_url || null,
      send_engagement_webhook_url: client.send_engagement_webhook_url || null,
      stop_bot_webhook_url: client.stop_bot_webhook_url || null,
      gohighlevel_api_key: client.ghl_api_key || null,
      gohighlevel_calendar_id: client.ghl_calendar_id || null,
      gohighlevel_booking_title: client.gohighlevel_booking_title || null,
      gohighlevel_assignee_id: client.ghl_assignee_id || null,
      gohighlevel_location_id: client.ghl_location_id || null,
    };

    // Try to upsert into the credentials table
    // First check if a row exists
    const { data: existingRows, error: selectError } = await extSupabase
      .from('credentials')
      .select('id')
      .limit(1);

    if (selectError) {
      console.error('Error reading external credentials table:', selectError);
      return new Response(JSON.stringify({ 
        error: `Cannot access external credentials table: ${selectError.message}` 
      }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let syncResult;
    if (existingRows && existingRows.length > 0) {
      // Update existing row
      const { error: updateError } = await extSupabase
        .from('credentials')
        .update(credentialsPayload)
        .eq('id', existingRows[0].id);
      
      if (updateError) {
        console.error('Error updating external credentials:', updateError);
        return new Response(JSON.stringify({ 
          error: `Failed to update external credentials: ${updateError.message}` 
        }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      syncResult = 'updated';
    } else {
      // Insert new row
      const { error: insertError } = await extSupabase
        .from('credentials')
        .insert(credentialsPayload);
      
      if (insertError) {
        console.error('Error inserting external credentials:', insertError);
        return new Response(JSON.stringify({ 
          error: `Failed to insert external credentials: ${insertError.message}` 
        }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      syncResult = 'inserted';
    }

    console.log(`External credentials ${syncResult} for client ${clientId}`);

    return new Response(JSON.stringify({ 
      success: true, 
      result: syncResult,
      synced_fields: Object.keys(credentialsPayload),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
