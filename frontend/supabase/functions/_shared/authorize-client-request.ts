// _shared/authorize-client-request.ts
//
// Dual-mode authorization for client-scoped edge functions. A request is allowed
// when it is EITHER:
//   (a) an internal server-to-server call presenting the service-role key as the
//       bearer token (Trigger.dev tasks and other edge functions call each other
//       this way — see trigger/placeOutboundCall.ts). The service-role key is a
//       server-only secret and is rejected in browser contexts by the sb_secret_*
//       key system, so possession of it is a sufficient trust signal; OR
//   (b) an authenticated end user whose agency/client owns `clientId`, verified
//       by assertClientAccess (validates the JWT signature, then ownership).
//
// Use this from every function that takes a caller-supplied clientId and reads or
// mutates that tenant's data/secrets. Never trust the clientId alone.
//
// Pattern:
//   import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";
//   try {
//     await authorizeClientRequest(req.headers.get("Authorization"), clientId);
//   } catch (e) {
//     if (e instanceof AssertAccessError) {
//       return new Response(JSON.stringify({ error: e.message }),
//         { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
//     }
//     throw e;
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.0";
import { assertClientAccess, AssertAccessError } from "./assert-client-access.ts";

// Constant-time string comparison to avoid leaking the service key via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Robustly decide whether `token` grants service-role (RLS-bypassing) access to
// THIS project, without depending on the exact key string/representation. Used as
// a fallback so internal callers (Trigger tasks, self-enqueue) keep working even
// if their configured service key differs byte-for-byte from this function's env
// copy. An anon key or user JWT fails the admin call; only the service role passes.
export async function grantsServiceRole(token: string): Promise<boolean> {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, token, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    return !error;
  } catch {
    return false;
  }
}

export async function authorizeClientRequest(
  authHeader: string | null,
  clientId: string,
): Promise<void> {
  if (!clientId || typeof clientId !== "string") {
    throw new AssertAccessError(400, "Missing clientId");
  }
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // Fast path: exact match with this function's service-role key (no network).
    if (serviceKey && timingSafeEqual(token, serviceKey)) return;
    // Secret-key path: a `sb_secret_*` key is never a user token, so validate it
    // functionally as service-role (covers internal callers whose key differs
    // byte-for-byte from this function's env copy). User JWTs skip this and go
    // straight to ownership verification below — no wasted round-trip.
    if (token.startsWith("sb_secret_") && await grantsServiceRole(token)) return;
  }
  // Falls through to full JWT-signature + ownership verification.
  await assertClientAccess(authHeader, clientId);
}

export { AssertAccessError };
