import { createClient } from "npm:@supabase/supabase-js@2";

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
    
    // Verify the caller is an agency user
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
      return new Response(JSON.stringify({ error: "Only agency users can create client users" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, password, full_name, client_id } = await req.json();

    if (!email || !password || !client_id) {
      return new Response(JSON.stringify({ error: "email, password, and client_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the caller's agency_id
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

    // Create the user via admin API
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || "" },
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The trigger will create profile with agency role. We need to:
    // 1. Update profile with client_id and correct agency_id
    // 2. Change role from agency to client
    
    await adminClient
      .from("profiles")
      .update({ 
        client_id: client_id,
        agency_id: callerProfile.agency_id 
      })
      .eq("id", newUser.user.id);

    // Update role to client
    await adminClient
      .from("user_roles")
      .update({ role: "client" })
      .eq("user_id", newUser.user.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user_id: newUser.user.id,
        email: newUser.user.email 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error creating client user:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
