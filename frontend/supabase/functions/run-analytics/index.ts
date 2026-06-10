import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getOpenRouterKey(
  primaryKey: string | null,
  clientSupabaseUrl: string | null,
  clientServiceKey: string | null
): Promise<string | null> {
  if (primaryKey) return primaryKey;
  if (!clientSupabaseUrl || !clientServiceKey) return null;

  try {
    const res = await fetch(
      `${clientSupabaseUrl}/rest/v1/credentials?select=value&key=eq.openrouter_api_key&limit=1`,
      {
        headers: {
          apikey: clientServiceKey,
          Authorization: `Bearer ${clientServiceKey}`,
        },
      }
    );
    if (!res.ok) {
      console.warn("Failed to fetch openrouter key from client Supabase:", res.status);
      return null;
    }
    const rows = await res.json();
    return rows?.[0]?.value || null;
  } catch (err) {
    console.warn("Error fetching openrouter key from client Supabase:", err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      clientId,
      timeRange,
      startDate,
      endDate,
      defaultMetrics,
      customMetrics,
      analyticsType,
    } = body;

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: "Missing clientId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    // Step 1: Look up client credentials
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, supabase_url, supabase_service_key, supabase_table_name, openrouter_api_key")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found", details: clientError }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve OpenRouter API key
    const openrouterKey = await getOpenRouterKey(
      client.openrouter_api_key,
      client.supabase_url,
      client.supabase_service_key
    );

    // Step 2: Create analytics_executions row
    const { data: execution, error: execError } = await supabase
      .from("analytics_executions")
      .insert({
        client_id: clientId,
        status: "pending",
        time_range: timeRange || "7",
        start_date: startDate || null,
        end_date: endDate || null,
        stage_description: "Starting analytics computation...",
      })
      .select("id")
      .single();

    if (execError || !execution) {
      console.error("Failed to create analytics_executions row:", execError);
      return new Response(
        JSON.stringify({ error: "Failed to create execution record", details: execError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const executionId = execution.id;

    // Step 3: Fire-and-forget invoke the compute-analytics edge function. It updates
    // analytics_executions row stage_description / status as it progresses, so the
    // frontend's poller picks up state without us blocking the original request.
    const computeAnalyticsPromise = fetch(`${supabaseUrl}/functions/v1/compute-analytics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        execution_id: executionId,
        client_id: clientId,
        time_range: timeRange || "7",
        start_date: startDate || null,
        end_date: endDate || null,
        default_metrics: defaultMetrics || [],
        custom_metrics: customMetrics || [],
        analytics_type: analyticsType || "text",
        client_supabase_url: client.supabase_url,
        client_supabase_service_key: client.supabase_service_key,
        client_supabase_table_name: client.supabase_table_name,
        openrouter_api_key: openrouterKey,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errText = await response.text();
          console.error(`[run-analytics] compute-analytics returned ${response.status}: ${errText.slice(0, 400)}`);
          await supabase
            .from("analytics_executions")
            .update({
              status: "failed",
              error_message: `compute-analytics edge function returned ${response.status}: ${errText.slice(0, 200)}`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", executionId);
        }
      })
      .catch(async (err: any) => {
        console.error(`[run-analytics] compute-analytics invoke failed:`, err);
        await supabase
          .from("analytics_executions")
          .update({
            status: "failed",
            error_message: `Failed to invoke compute-analytics: ${err?.message ?? String(err)}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", executionId);
      });

    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(computeAnalyticsPromise);
    } else {
      void computeAnalyticsPromise;
    }

    console.info("Analytics run dispatched to compute-analytics edge function", { executionId, clientId, timeRange });

    return new Response(
      JSON.stringify({
        execution_id: executionId,
        status: "pending",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("run-analytics error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
