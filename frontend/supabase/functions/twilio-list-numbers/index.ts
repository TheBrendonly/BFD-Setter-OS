import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    // Validate JWT via direct Auth API call (avoids supabase-js session issues)
    const token = authHeader.replace("Bearer ", "");
    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });
    const user = authRes.ok ? await authRes.json() : null;

    if (!user?.id) {
      console.error("twilio-list-numbers auth failed:", authRes.status);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    // userClient for RLS-scoped queries
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json().catch(() => ({}));
    let account_sid = typeof body.account_sid === "string" ? body.account_sid.trim() : "";
    let auth_token = typeof body.auth_token === "string" ? body.auth_token.trim() : "";
    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";

    if (!account_sid && clientId) {
      const { data: accessibleClient, error: accessError } = await userClient
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .single();

      if (accessError || !accessibleClient) {
        return new Response(JSON.stringify({ error: "Client not found or no access" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: client, error: clientErr } = await adminClient
        .from("clients")
        .select("twilio_account_sid, twilio_auth_token")
        .eq("id", clientId)
        .single();

      if (clientErr) {
        return new Response(JSON.stringify({ error: "Client not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      account_sid = client?.twilio_account_sid?.trim?.() ?? "";
      auth_token = client?.twilio_auth_token?.trim?.() ?? "";
    }

    if (!account_sid || !auth_token) {
      return new Response(
        JSON.stringify({ error: "Missing account_sid or auth_token" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const twilioAuth = btoa(`${account_sid}:${auth_token}`);
    const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PageSize=100`;

    const response = await fetch(listUrl, {
      headers: { Authorization: `Basic ${twilioAuth}` },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Twilio list error:", data);
      return new Response(
        JSON.stringify({ error: `Twilio error: ${data.message || "Invalid credentials"}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const phoneNumbers = (Array.isArray(data.incoming_phone_numbers) ? data.incoming_phone_numbers : []).map(
      (num: any) => ({
        sid: num.sid,
        phone_number: num.phone_number,
        friendly_name: num.friendly_name,
        sms_url: num.sms_url,
        capabilities: {
          sms: num.capabilities?.sms || false,
          voice: num.capabilities?.voice || false,
          mms: num.capabilities?.mms || false,
        },
      })
    );

    return new Response(
      JSON.stringify({ success: true, numbers: phoneNumbers, phone_numbers: phoneNumbers }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error in twilio-list-numbers:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
