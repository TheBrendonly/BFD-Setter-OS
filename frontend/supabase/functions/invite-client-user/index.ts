// invite-client-user (F14)
//
// Agency-only invite-by-email onboarding for sub-account users. A structural
// sibling of create-client-user with the creation call swapped: instead of the
// agency setting a password and handing it over, Supabase emails the client a
// secure invite link; they land on /reset-password (type=invite) and choose
// their own password. Same governance as create-client-user:
//   - caller must hold the agency role,
//   - the target client must belong to the caller's agency,
//   - the auth-trigger's default agency role is flipped to client + the profile
//     is linked, and a partial failure rolls the auth user back (no
//     privilege-escalated orphans).
// Reliable delivery needs custom SMTP (Resend) configured on the project; the
// built-in Supabase mailer is heavily rate-limited.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// The invite redirect must be on the auth allow list. /reset-password already
// is (ForgotPassword uses it), so reuse it; the page shows invite copy when the
// link carries type=invite.
const ALLOWED_ORIGINS = [
  "https://app.buildingflowdigital.com",
  "http://localhost:3000",
  "http://localhost:5173",
];

function resolveSiteUrl(req: Request): string {
  const configured = Deno.env.get("SITE_URL");
  if (configured) return configured.replace(/\/$/, "");
  const origin = req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller is an agency user.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user: callerUser }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !callerUser) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUser.id)
      .single();
    if (callerRole?.role !== "agency") {
      return json({ error: "Only agency users can invite client users" }, 403);
    }

    const { email, full_name, client_id } = await req.json();
    if (!email || typeof email !== "string" || !client_id) {
      return json({ error: "email and client_id are required" }, 400);
    }

    // The target client must belong to the caller's agency.
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("agency_id")
      .eq("id", callerUser.id)
      .single();
    if (!callerProfile?.agency_id) return json({ error: "Caller has no agency" }, 400);

    const { data: clientData } = await adminClient
      .from("clients")
      .select("id, agency_id")
      .eq("id", client_id)
      .single();
    if (!clientData || clientData.agency_id !== callerProfile.agency_id) {
      return json({ error: "Client not found or not in your agency" }, 403);
    }

    // Send the invite (creates the auth user + emails the link).
    const siteUrl = resolveSiteUrl(req);
    const { data: invited, error: inviteError } = await adminClient.auth.admin
      .inviteUserByEmail(email, {
        data: { full_name: full_name || "" },
        redirectTo: `${siteUrl}/reset-password`,
      });
    if (inviteError || !invited?.user) {
      return json({ error: inviteError?.message || "Invite failed" }, 400);
    }

    // GoTrue only rejects CONFIRMED duplicate emails; for a still-pending
    // (unconfirmed) user it re-sends the invite and returns the EXISTING user.
    // That user must never be repointed to this client, and the rollback below
    // must never delete a user this request did not create. Treat a user
    // created noticeably before this request as pre-existing: if it is already
    // bound to exactly this client, report the re-send; otherwise conflict.
    const createdAtMs = Date.parse(invited.user.created_at ?? "");
    const isNewUser = Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 120_000;
    if (!isNewUser) {
      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("client_id, agency_id")
        .eq("id", invited.user.id)
        .maybeSingle();
      const { data: existingRole } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", invited.user.id)
        .maybeSingle();
      if (
        existingProfile?.client_id === client_id &&
        existingProfile?.agency_id === callerProfile.agency_id &&
        existingRole?.role === "client"
      ) {
        return json({ success: true, user_id: invited.user.id, email: invited.user.email, resent: true });
      }
      return json({
        error: "A pending user with this email already exists and is not bound to this client. Resolve it manually before re-inviting.",
      }, 409);
    }

    // The trigger creates the profile with the agency role. We must:
    // 1. Update the profile with client_id and the caller's agency_id.
    // 2. Change the role from agency to client.
    // If EITHER write fails we'd otherwise leave a privilege-escalated orphan,
    // so roll back by deleting the just-invited auth user and fail the request.
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({
        client_id: client_id,
        agency_id: callerProfile.agency_id,
      })
      .eq("id", invited.user.id);

    let roleErr: { message?: string } | null = null;
    if (!profileErr) {
      const res = await adminClient
        .from("user_roles")
        .update({ role: "client" })
        .eq("user_id", invited.user.id);
      roleErr = res.error;
    }

    if (profileErr || roleErr) {
      await adminClient.auth.admin.deleteUser(invited.user.id).catch((e) =>
        console.error("rollback deleteUser failed", e)
      );
      const detail = profileErr?.message || roleErr?.message || "unknown";
      console.error("invite-client-user: profile/role update failed, rolled back", detail);
      return json({ error: `Failed to finalize invited user: ${detail}` }, 500);
    }

    return json({ success: true, user_id: invited.user.id, email: invited.user.email });
  } catch (err) {
    console.error("Error inviting client user:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
    );
  }
});
