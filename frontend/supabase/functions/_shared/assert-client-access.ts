// _shared/assert-client-access.ts
//
// Canonical JWT-based tenant verification helper. Mirrors the pattern in
// retell-proxy/index.ts:53-100 and check-client-subscription. Use this
// from every authenticated edge function that takes a clientId from the
// caller and reads tenant data — never trust the clientId alone.
//
// Pattern:
//   import { assertClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
//   try {
//     await assertClientAccess(req.headers.get("Authorization"), clientId);
//   } catch (e) {
//     if (e instanceof AssertAccessError) return jsonResponse({error:e.message}, e.status);
//     throw e;
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export class AssertAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Verify the JWT's SIGNATURE (not just base64-decode it) via GoTrue and return
// the authenticated user id. Decoding the payload with atob() — the prior
// behaviour — trusted any forged token; auth.getUser(token) validates it
// against the project's JWT secret and rejects forgeries.
export async function verifyUserId(authHeader: string | null): Promise<string> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AssertAccessError(401, "Unauthorized");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new AssertAccessError(401, "Unauthorized");
  }
  return data.user.id;
}

export async function assertClientAccess(authHeader: string | null, clientId: string): Promise<void> {
  const userId = await verifyUserId(authHeader);
  const admin = getSupabaseAdmin();
  const [{ data: client }, { data: roleData }, { data: profile }] = await Promise.all([
    admin.from("clients").select("id, agency_id").eq("id", clientId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle(),
    admin.from("profiles").select("agency_id, client_id").eq("id", userId).maybeSingle(),
  ]);
  if (!client) throw new AssertAccessError(404, "Client not found");
  const role = roleData?.role;
  const allowed = role === "agency"
    ? !!profile?.agency_id && profile.agency_id === client.agency_id
    : role === "client"
      ? profile?.client_id === client.id
      : false;
  if (!allowed) {
    console.warn(`[assertClientAccess] forbidden: user=${userId} role=${role ?? "none"} clientId=${clientId}`);
    throw new AssertAccessError(403, "Forbidden");
  }
}
