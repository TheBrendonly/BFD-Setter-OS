import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user: callerUser }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is agency role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id)
      .single();

    if (callerRole?.role !== "agency") {
      return new Response(JSON.stringify({ error: "Only agency users can update client passwords" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { client_id, new_password } = await req.json();

    if (!client_id || !new_password) {
      return new Response(JSON.stringify({ error: "client_id and new_password are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Matches the project's GoTrue password policy (password_min_length = 12).
    if (new_password.length < 12) {
      return new Response(JSON.stringify({ error: "Password must be at least 12 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get caller's agency_id
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("agency_id")
      .eq("id", callerUser.id)
      .single();

    if (!callerProfile?.agency_id) {
      return new Response(JSON.stringify({ error: "Caller has no agency" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the client belongs to the caller's agency
    const { data: clientData } = await adminClient
      .from("clients")
      .select("id, agency_id")
      .eq("id", client_id)
      .single();

    if (!clientData || clientData.agency_id !== callerProfile.agency_id) {
      return new Response(JSON.stringify({ error: "Client not found or not in your agency" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the client user(s) linked to this client_id
    const { data: clientUsers } = await adminClient
      .from("profiles")
      .select("id")
      .eq("client_id", client_id);

    if (!clientUsers || clientUsers.length === 0) {
      return new Response(JSON.stringify({ error: "No login user found for this client" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update password for all users linked to this client
    const results = [];
    for (const clientUser of clientUsers) {
      const { error: updateError } = await adminClient.auth.admin.updateUserById(
        clientUser.id,
        { password: new_password }
      );
      if (updateError) {
        results.push({ user_id: clientUser.id, error: updateError.message });
      } else {
        results.push({ user_id: clientUser.id, success: true });
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error updating client password:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
