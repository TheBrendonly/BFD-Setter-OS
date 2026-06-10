import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error("Supabase environment is not configured");
    }

    // Validate JWT via supabase-js client (more resilient than raw fetch)
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user?.id) {
      console.error("fetch-thread-previews auth failed:", authError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    // Reuse authClient for RLS-scoped queries
    const userClient = authClient;

    const body = await req.json().catch(() => ({}));
    const { client_id, session_ids, messages_per_session = 20 } = body;

    if (!client_id || !Array.isArray(session_ids) || session_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "client_id and session_ids required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: accessibleClient, error: accessError } = await userClient
      .from("clients")
      .select("id")
      .eq("id", client_id)
      .single();

    if (accessError || !accessibleClient) {
      return new Response(JSON.stringify({ error: "Client not found or no access" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: clientData, error: clientErr } = await adminClient
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientErr || !clientData?.supabase_url || !clientData?.supabase_service_key) {
      return new Response(
        JSON.stringify({ error: "External database not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const extClient = createClient(clientData.supabase_url, clientData.supabase_service_key);

    const chunkSize = 50;
    const allPreviews: Array<{ session_id: string; timestamp: string; message: any }> = [];
    const recentMessages: Record<
      string,
      Array<{ id: string; session_id: string; timestamp: string; message: any }>
    > = {};

    for (let i = 0; i < session_ids.length; i += chunkSize) {
      const chunk = session_ids.slice(i, i + chunkSize);
      const limit = chunk.length * messages_per_session;

      const { data, error } = await extClient
        .from("chat_history")
        .select("id, session_id, timestamp, message")
        .in("session_id", chunk)
        .order("timestamp", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("External query error:", error);
        continue;
      }
      if (!data) continue;

      const countBySession: Record<string, number> = {};
      const previewSeen = new Set<string>();

      for (const row of data) {
        const sid = row.session_id;
        const count = countBySession[sid] || 0;

        if (!previewSeen.has(sid)) {
          previewSeen.add(sid);
          allPreviews.push({ session_id: sid, timestamp: row.timestamp, message: row.message });
        }

        if (count < messages_per_session) {
          if (!recentMessages[sid]) recentMessages[sid] = [];
          recentMessages[sid].push({
            id: row.id,
            session_id: row.session_id,
            timestamp: row.timestamp,
            message: row.message,
          });
          countBySession[sid] = count + 1;
        }
      }
    }

    for (const sid of Object.keys(recentMessages)) {
      recentMessages[sid].reverse();
    }

    return new Response(
      JSON.stringify({ previews: allPreviews, recent_messages: recentMessages }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("fetch-thread-previews error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
