import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ allowed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up user by email in auth.users
    const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      console.error("Error listing users:", usersError);
      // Don't reveal errors - return not allowed
      return new Response(
        JSON.stringify({ allowed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const user = usersData?.users?.find(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (!user) {
      // User doesn't exist - don't reveal this, just say not allowed
      // But actually for security we should behave the same as "allowed"
      // so attackers can't enumerate emails. However the requirement says
      // show "contact administrator" for non-agency roles.
      // For non-existent emails, we return allowed=true so the normal
      // "reset link sent" message shows (Supabase won't actually send anything)
      return new Response(
        JSON.stringify({ allowed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check role in user_roles table
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (roleError) {
      console.error("Error fetching role:", roleError);
      return new Response(
        JSON.stringify({ allowed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only agency role can reset password
    const role = roleData?.role || null;
    const allowed = role === "agency";

    return new Response(
      JSON.stringify({ allowed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ allowed: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
