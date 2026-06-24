// _shared/assertActiveSubscription.ts
//
// Server-side subscription gate (B1). The frontend SubscriptionGate is cosmetic
// only — any valid JWT (or the intake secret) could trigger billable SMS / voice
// calls / lead enrollments regardless of subscription_status (a billing bypass).
// This helper enforces the same gate server-side at the billable LEAF actions.
//
// SHIPPED DORMANT: it is a no-op unless ENFORCE_SUBSCRIPTION_GATE === "true".
// Stripe is not live yet and subscription_status is managed manually (onboarding
// inserts 'free'), so enabling it now would break every not-yet-'active' client,
// the hourly synthetic probe, try-gary and the dogfood client. Go-live order:
// backfill real clients to 'active'/'grace_period', confirm is_system on the
// probe + 'active' on the default/oldest client, THEN set the env var to "true".
//
// Exemptions mirror the frontend (useSubscription.ts):
//   - is_system clients (the synthetic probe) — never gated.
//   - the globally-oldest client by created_at — force-'active' in the UI.
// Passing statuses: 'active', 'grace_period' (identical to the gate).
//
// Usage (call AFTER the function has authorized + resolved the client_id):
//   import { assertActiveSubscription } from "../_shared/assertActiveSubscription.ts";
//   import { AssertAccessError } from "../_shared/assert-client-access.ts";
//   try { await assertActiveSubscription(clientId); }
//   catch (e) { if (e instanceof AssertAccessError) return json({ error: e.message }, e.status); throw e; }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.0";
import { AssertAccessError } from "./assert-client-access.ts";

const PASSING_STATUSES = new Set(["active", "grace_period"]);

export async function assertActiveSubscription(clientId: string | null | undefined): Promise<void> {
  // Dormant by default — flip ENFORCE_SUBSCRIPTION_GATE=true at Stripe go-live.
  if (Deno.env.get("ENFORCE_SUBSCRIPTION_GATE") !== "true") return;
  if (!clientId) return;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: client } = await admin
    .from("clients")
    .select("id, subscription_status, is_system")
    .eq("id", clientId)
    .maybeSingle();

  // Unknown client — the caller already authorized; not this gate's job to 404.
  if (!client) return;

  // System/internal clients (the synthetic probe) are never gated.
  if (client.is_system) return;

  // The globally-oldest client is force-'active' in the UI; mirror it exactly so
  // server and client agree (NOT per-agency — useSubscription is global).
  const { data: oldest } = await admin
    .from("clients")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (oldest?.id === clientId) return;

  const status = client.subscription_status || "free";
  if (PASSING_STATUSES.has(status)) return;

  // 402 (not 403) so callers can distinguish a billing block from an auth denial.
  throw new AssertAccessError(402, "Subscription inactive");
}
