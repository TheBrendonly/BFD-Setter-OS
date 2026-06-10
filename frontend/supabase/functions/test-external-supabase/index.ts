import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

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
    const { clientId, supabaseConfig, timeRange } = await req.json();

    // Validate input parameters
    if (!clientId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Client ID is required'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SECURITY: block cross-tenant access before any external connection.
    try {
      await authorizeClientRequest(req.headers.get('Authorization'), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw e;
    }

    if (!supabaseConfig?.serviceKey) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Supabase Service Key is required. Please provide your service role key.' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!supabaseConfig?.tableName) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Table name is required. Please specify the table containing your chat history data.' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!supabaseConfig?.url) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Supabase URL is required. Please provide your Supabase project URL.' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate URL format
    if (!supabaseConfig.url.includes('supabase.co') && !supabaseConfig.url.includes('localhost')) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Invalid Supabase URL format. Please provide a valid Supabase project URL (e.g., https://your-project.supabase.co).' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate service key format (basic check). Accept the modern key formats
    // (sb_secret_* service key, sb_publishable_* anon key) as well as the legacy
    // JWT shape (eyJ... with 3 dot-separated parts). Without the modern shapes a
    // valid sb_secret_* service key is wrongly rejected during onboarding.
    const serviceKey = String(supabaseConfig.serviceKey || '');
    const isLegacyJwt = serviceKey.startsWith('eyJ') && serviceKey.split('.').length === 3;
    const isModernKey = serviceKey.startsWith('sb_secret_') || serviceKey.startsWith('sb_publishable_');
    if (!isLegacyJwt && !isModernKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid service key format. Please ensure you are using the service role key (not the anon key) from your Supabase project settings.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SECURITY: this is a connection tester for the caller's OWN client (authorized
    // above), invoked from the UI to validate creds before they are saved — so the
    // body-supplied creds are used. Constrain the URL to a genuine Supabase project
    // host so the server cannot be used as an SSRF probe against internal/metadata
    // endpoints.
    const supabaseHostOk = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(
      String(supabaseConfig.url || '').trim(),
    );
    if (!supabaseHostOk) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid Supabase project URL. Expected https://<project-ref>.supabase.co'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Testing connection to:', supabaseConfig.url, 'table:', supabaseConfig.tableName);

    // Create external Supabase client
    const externalSupabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

    // Test connection by querying the table
    const { data, error } = await externalSupabase
      .from(supabaseConfig.tableName)
      .select('*')
      .limit(1);

    if (error) {
      console.error('External Supabase error:', error);
      
      // Provide specific error messages based on the error type
      if (error.message.includes('relation') && error.message.includes('does not exist')) {
        return new Response(JSON.stringify({ 
          success: false,
          error: `Table '${supabaseConfig.tableName}' does not exist in your Supabase database. Please check the table name and ensure it exists.` 
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (error.message.includes('JWT') || error.message.includes('auth') || error.message.includes('permission')) {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'Authentication failed. Please verify your service key is correct and has the necessary permissions.' 
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (error.message.includes('connect') || error.message.includes('network') || error.message.includes('timeout')) {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'Unable to connect to your Supabase instance. Please verify your URL is correct and your project is active.' 
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Generic error fallback
      return new Response(JSON.stringify({ 
        success: false,
        error: `Database connection failed: ${error.message}` 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Successfully connected to external Supabase, found table with data structure:', 
                data && data.length > 0 ? Object.keys(data[0]) : 'empty table');

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Successfully connected to external Supabase',
      tableStructure: data && data.length > 0 ? Object.keys(data[0]) : []
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in test-external-supabase:', error);
    
    // Handle fetch/network errors
    if ((error as any)?.name === 'TypeError' && (error as any)?.message?.includes('fetch')) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Network error: Unable to reach your Supabase instance. Please check your URL and internet connection.' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Handle JSON parsing errors
    if ((error as any)?.name === 'SyntaxError') {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Invalid response from Supabase. Please verify your configuration.' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ 
      success: false,
      error: (error as any)?.message || 'An unexpected error occurred while testing the connection.' 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function extractProjectId(serviceKey: string): string {
  // Service keys typically contain base64 encoded JSON with project info
  try {
    // This is a simplified extraction - you might need to adjust based on actual key format
    const base64Payload = serviceKey.split('.')[1];
    const decoded = JSON.parse(atob(base64Payload));
    return decoded.ref || 'unknown-project';
  } catch (error) {
    console.error('Failed to extract project ID from service key:', error);
    throw new Error('Invalid service key format. Please ensure you are using the service role key from your Supabase project settings, not the anon key.');
  }
}