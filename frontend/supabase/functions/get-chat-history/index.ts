// get-chat-history — server-side proxy for the per-client chat_history table.
//
// Why this exists: as of the 2026-04-30 sb_secret_*/sb_publishable_* key
// rotation, Supabase rejects service-role keys when used from a browser with
// "Forbidden use of secret API key in browser". The frontend used to create a
// per-client Supabase client directly with `clients.supabase_service_key`,
// which now fails. This function moves the fetch server-side so the secret
// key stays out of the browser.
//
// Auth model:
//   - Caller MUST send a valid Authorization Bearer (the user's session JWT).
//   - We decode the JWT locally (no signature check — same pattern as
//     retell-proxy / check-client-subscription) and use the `sub` claim to
//     verify the user's profile matches the requested clientId via
//     assertClientAccess.
//   - Service role used internally to read clients.supabase_url +
//     supabase_service_key, then a per-client Supabase client is constructed
//     server-side to query chat_history.
//
// Body:
//   { clientId, sessionId, altSessionId?, pageSize?, from? }
// Returns:
//   { ok: true, rows: [{id, session_id, timestamp, message}], usedAltId: bool }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Verify the JWT signature (not just base64-decode it) via GoTrue and return the
// authenticated user id. Decoding with atob() trusted forged tokens.
async function verifyUserId(authHeader: string | null): Promise<string> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "Unauthorized");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data?.user?.id) throw new AuthError(401, "Unauthorized");
  return data.user.id;
}

async function assertClientAccess(authHeader: string | null, clientId: string): Promise<void> {
  const userId = await verifyUserId(authHeader);
  const admin = getSupabaseAdmin();
  const [{ data: client }, { data: roleData }, { data: profile }] = await Promise.all([
    admin.from("clients").select("id, agency_id").eq("id", clientId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle(),
    admin.from("profiles").select("agency_id, client_id").eq("id", userId).maybeSingle(),
  ]);
  if (!client) throw new AuthError(404, "Client not found");
  const role = roleData?.role;
  const allowed = role === "agency"
    ? !!profile?.agency_id && profile.agency_id === client.agency_id
    : role === "client"
      ? profile?.client_id === client.id
      : false;
  if (!allowed) {
    console.warn(`[get-chat-history] forbidden: user=${userId} role=${role ?? "none"} clientId=${clientId}`);
    throw new AuthError(403, "Forbidden");
  }
}

type ChatHistoryRow = {
  id: number | string;
  session_id: string;
  timestamp: string;
  message: unknown;
};

async function fetchAllRows(
  // deno: the per-client SupabaseClient generic (schema "public") doesn't unify
  // with ReturnType<typeof createClient> (schema never); typed `any` for the helper.
  perClient: any,
  sessionId: string,
  pageSize: number,
): Promise<ChatHistoryRow[]> {
  const all: ChatHistoryRow[] = [];
  let from = 0;
  // Hard cap to avoid runaway pagination
  for (let page = 0; page < 50; page++) {
    const { data, error } = await perClient
      .from("chat_history")
      .select("id,session_id,timestamp,message")
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`chat_history fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as ChatHistoryRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// G3-6: date-range mode for the ChatAnalytics time-series. Replaces the old
// in-browser createClient + chat_history range query (which needed the secret
// service key in the browser). Returns just {timestamp, message} across the range.
async function fetchRangeRows(
  perClient: any,
  startDate: string,
  endDate: string,
  pageSize: number,
): Promise<Array<{ timestamp: string; message: unknown }>> {
  const all: Array<{ timestamp: string; message: unknown }> = [];
  let from = 0;
  // Hard cap to avoid runaway pagination (50 * 1000 = 50k rows).
  for (let page = 0; page < 50; page++) {
    const { data, error } = await perClient
      .from("chat_history")
      .select("timestamp,message")
      .gte("timestamp", startDate)
      .lte("timestamp", endDate)
      .order("timestamp", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`chat_history range fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as Array<{ timestamp: string; message: unknown }>));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const mode = body?.mode === "range" ? "range" : "session";
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
    const altSessionId = typeof body?.altSessionId === "string" && body.altSessionId !== sessionId
      ? body.altSessionId
      : null;
    const startDate = typeof body?.startDate === "string" ? body.startDate : null;
    const endDate = typeof body?.endDate === "string" ? body.endDate : null;
    const pageSize = typeof body?.pageSize === "number" && body.pageSize > 0 && body.pageSize <= 1000
      ? Math.floor(body.pageSize)
      : 1000;

    if (!clientId) throw new AuthError(400, "clientId is required");
    if (mode === "range") {
      if (!startDate || !endDate) throw new AuthError(400, "startDate and endDate are required for range mode");
    } else if (!sessionId) {
      throw new AuthError(400, "sessionId is required");
    }

    await assertClientAccess(req.headers.get("Authorization"), clientId);

    const admin = getSupabaseAdmin();
    const { data: client, error: clientErr } = await admin
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr) throw new Error(`Client lookup failed: ${clientErr.message}`);
    if (!client?.supabase_url || !client?.supabase_service_key) {
      throw new AuthError(409, "Client has no per-client Supabase credentials configured");
    }

    const perClient = createClient(client.supabase_url, client.supabase_service_key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    if (mode === "range") {
      const rangeRows = await fetchRangeRows(perClient, startDate!, endDate!, pageSize);
      return jsonResponse({ ok: true, rows: rangeRows });
    }

    let rows = await fetchAllRows(perClient, sessionId!, pageSize);
    let usedAltId = false;
    if (rows.length === 0 && altSessionId) {
      rows = await fetchAllRows(perClient, altSessionId, pageSize);
      usedAltId = rows.length > 0;
    }

    return jsonResponse({ ok: true, rows, usedAltId });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, err.status);
    }
    console.error("get-chat-history error:", err);
    return jsonResponse({ ok: false, error: (err as Error).message ?? "Internal server error" }, 500);
  }
});
