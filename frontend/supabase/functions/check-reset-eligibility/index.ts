import { createClient } from "npm:@supabase/supabase-js@2.101.0";

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

    // Look up the user via the trigger-mirrored profiles row (GoTrue lowercases
    // emails at signup). listUsers() was page-1-only (50 users), so the
    // role-less block silently failed open once auth.users grew past 50.
    const { data: user, error: usersError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (usersError) {
      console.error("Error looking up profile:", usersError);
      // Don't reveal errors - return not allowed
      return new Response(
        JSON.stringify({ allowed: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // F14: agency AND client roles can self-reset. Only role-less accounts
    // (half-provisioned) still get the "contact administrator" branch.
    const role = roleData?.role || null;
    const allowed = role === "agency" || role === "client";

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
