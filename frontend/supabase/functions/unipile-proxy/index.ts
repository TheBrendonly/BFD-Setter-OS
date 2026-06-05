import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY")!;
const UNIPILE_DSN = Deno.env.get("UNIPILE_DSN")!;

const buildQueryString = (params: Record<string, string | null>) => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check using getClaims (no network call)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const baseUrl = `https://${UNIPILE_DSN}`;

    const headers = {
      "X-API-KEY": UNIPILE_API_KEY,
      accept: "application/json",
      "content-type": "application/json",
    };

    let result: Response;

    switch (action) {
      case "hosted-auth-link": {
        const body = await req.json();
        const { clientId, providers = ["INSTAGRAM"] } = body;

        // SECURITY: verify the caller owns this client before binding a Unipile
        // hosted-auth account / notify_url to it.
        try {
          await authorizeClientRequest(authHeader, clientId);
        } catch (e) {
          if (e instanceof AssertAccessError) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          throw e;
        }

        // Generate hosted auth link
        const expiresOn = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        
        // Build the notify_url using the edge function URL
        const notifyUrl = `${supabaseUrl}/functions/v1/unipile-webhook?client_id=${clientId}`;

        result = await fetch(`${baseUrl}/api/v1/hosted/accounts/link`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "create",
            providers,
            api_url: baseUrl,
            expiresOn,
            name: clientId,
            notify_url: notifyUrl,
          }),
        });
        break;
      }

      case "list-accounts": {
        result = await fetch(`${baseUrl}/api/v1/accounts`, {
          method: "GET",
          headers,
        });
        break;
      }

      case "list-chats": {
        const accountId = url.searchParams.get("account_id");
        const limit = url.searchParams.get("limit") || "50";
        const cursor = url.searchParams.get("cursor") || "";
        
        let chatUrl = `${baseUrl}/api/v1/chats?account_id=${accountId}&limit=${limit}`;
        if (cursor) chatUrl += `&cursor=${cursor}`;
        
        result = await fetch(chatUrl, {
          method: "GET",
          headers,
        });
        break;
      }

      case "get-messages": {
        const chatId = url.searchParams.get("chat_id");
        const limit = url.searchParams.get("limit") || "50";
        const cursor = url.searchParams.get("cursor") || "";
        
        let msgUrl = `${baseUrl}/api/v1/chats/${chatId}/messages?limit=${limit}`;
        if (cursor) msgUrl += `&cursor=${cursor}`;
        
        result = await fetch(msgUrl, {
          method: "GET",
          headers,
        });
        break;
      }

      case "send-message": {
        const body = await req.json();
        const { chatId, text } = body;

        result = await fetch(`${baseUrl}/api/v1/chats/${chatId}/messages`, {
          method: "POST",
          headers: {
            "X-API-KEY": UNIPILE_API_KEY,
            accept: "application/json",
            "content-type": "multipart/form-data",
          },
          body: new URLSearchParams({ text }),
        });
        break;
      }

      case "get-attendee": {
        const attendeeId = url.searchParams.get("attendee_id");
        result = await fetch(`${baseUrl}/api/v1/chat_attendees/${attendeeId}`, {
          method: "GET",
          headers,
        });
        break;
      }

      // ── Calendar endpoints ──
      case "list-calendars": {
        const accountId = url.searchParams.get("account_id");
        result = await fetch(`${baseUrl}/api/v1/calendars?account_id=${accountId}`, { method: "GET", headers });
        break;
      }

      case "list-calendar-events": {
        const accountId = url.searchParams.get("account_id");
        const calendarId = url.searchParams.get("calendar_id");
        const limit = url.searchParams.get("limit") || "50";
        const cursor = url.searchParams.get("cursor") || "";
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");

        result = await fetch(
          `${baseUrl}/api/v1/calendars/${encodeURIComponent(calendarId ?? "")}/events${buildQueryString({
            account_id: accountId,
            limit,
            cursor,
            start,
            end,
          })}`,
          { method: "GET", headers }
        );
        break;
      }

      case "create-calendar-event": {
        const accountId = url.searchParams.get("account_id");
        const calendarId = url.searchParams.get("calendar_id");
        const body = await req.json();
        result = await fetch(`${baseUrl}/api/v1/calendars/${calendarId}/events?account_id=${accountId}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        break;
      }

      case "delete-calendar-event": {
        const eventId = url.searchParams.get("event_id");
        result = await fetch(`${baseUrl}/api/v1/calendars/events/${eventId}`, { method: "DELETE", headers });
        break;
      }

      // ── Email endpoints ──
      case "list-emails": {
        const accountId = url.searchParams.get("account_id");
        const limit = url.searchParams.get("limit") || "50";
        const role = url.searchParams.get("role") || "";
        let emailUrl = `${baseUrl}/api/v1/emails?account_id=${accountId}&limit=${limit}`;
        if (role) emailUrl += `&role=${role}`;
        result = await fetch(emailUrl, { method: "GET", headers });
        break;
      }

      case "get-email": {
        const emailId = url.searchParams.get("email_id");
        result = await fetch(`${baseUrl}/api/v1/emails/${emailId}`, { method: "GET", headers });
        break;
      }

      case "send-email": {
        const accountId = url.searchParams.get("account_id");
        const body = await req.json();
        result = await fetch(`${baseUrl}/api/v1/emails`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...body, account_id: accountId }),
        });
        break;
      }

      case "delete-email": {
        const emailId = url.searchParams.get("email_id");
        result = await fetch(`${baseUrl}/api/v1/emails/${emailId}`, { method: "DELETE", headers });
        break;
      }

      case "get-attendee-picture": {
        const attendeeId = url.searchParams.get("attendee_id");
        const picRes = await fetch(`${baseUrl}/api/v1/chat_attendees/${attendeeId}/picture`, {
          method: "GET",
          headers: { "X-API-KEY": UNIPILE_API_KEY },
        });
        
        if (!picRes.ok) {
          return new Response(JSON.stringify({ error: "Picture not found" }), {
            status: picRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        
        const imageBuffer = await picRes.arrayBuffer();
        const contentType = picRes.headers.get("content-type") || "image/jpeg";
        return new Response(imageBuffer, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }

    const data = await result.json();
    return new Response(JSON.stringify(data), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unipile proxy error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
