// get-blended-rate
//
// The single gated read of a sub-account's blended cost-to-price. Runs as
// service-role (bypassing the agency-only RLS on client_pricing_config) and
// re-derives the caller's role from their JWT, so the markup / FX / rate table
// never reach a client even though RLS on clients is row-level only.
//
//   POST { client_id } ->
//     role "client", show_rate_to_client off -> { show: false }
//     role "client", show on                 -> { show: true, blended_per_min_minor, display_currency }
//     role "agency"                           -> { role:"agency", ...full breakdown + markup + rate_table }
//
// Auth: resolveClientAccess (JWT signature + ownership). verify_jwt is false at
// the gateway; the JWT is validated in-function (a browser calls it with the
// user token). Mirrors save-account-settings.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { computeBlendedRate } from "../_shared/computeBlendedRate.ts";
import { mergeWithDefaults, type PricingConfigInput } from "../_shared/pricingDefaults.ts";
import { branchByRole } from "./roleBranch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization");
    const body = await req.json().catch(() => ({}));
    const { client_id } = body as { client_id?: string };

    if (!client_id) return json({ error: "Missing client_id" }, 400);

    let role: "agency" | "client";
    try {
      ({ role } = await resolveClientAccess(authHeader, client_id));
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    // Load the per-client override (agency-only table; service role bypasses RLS).
    // No row -> pure default rate card.
    const { data: row } = await supabase
      .from("client_pricing_config")
      .select("config")
      .eq("client_id", client_id)
      .maybeSingle();

    const merged = mergeWithDefaults((row?.config ?? null) as PricingConfigInput | null);
    const computed = computeBlendedRate(merged);

    return json(branchByRole(merged, role, computed));
  } catch (err) {
    console.error("get-blended-rate error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
