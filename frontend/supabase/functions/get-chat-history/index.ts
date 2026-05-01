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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function decodeJwtSub(authHeader: string | null): string {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError(401, "Unauthorized");
  }
  const token = authHeader.slice("Bearer ".length);
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (!payload?.sub) throw new Error("no sub");
    return payload.sub as string;
  } catch {
    throw new AuthError(401, "Unauthorized");
  }
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function assertClientAccess(authHeader: string | null, clientId: string): Promise<void> {
  const userId = decodeJwtSub(authHeader);
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
  perClient: ReturnType<typeof createClient>,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
    const altSessionId = typeof body?.altSessionId === "string" && body.altSessionId !== sessionId
      ? body.altSessionId
      : null;
    const pageSize = typeof body?.pageSize === "number" && body.pageSize > 0 && body.pageSize <= 1000
      ? Math.floor(body.pageSize)
      : 1000;

    if (!clientId) throw new AuthError(400, "clientId is required");
    if (!sessionId) throw new AuthError(400, "sessionId is required");

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

    let rows = await fetchAllRows(perClient, sessionId, pageSize);
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
