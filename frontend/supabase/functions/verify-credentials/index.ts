import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

// Cheap, read-only "does this credential actually work?" check per provider.
// Runs entirely server-side using the tenant's STORED secrets (never returns or
// exposes them to the browser), so a misconfigured / dead-on-arrival client is
// caught before going live. Guarded by authorizeClientRequest (JWT-owner or
// internal service-role).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ProviderResult = { provider: string; ok: boolean; detail: string };

async function check(
  provider: string,
  run: () => Promise<{ ok: boolean; detail: string }>,
): Promise<ProviderResult> {
  try {
    const { ok, detail } = await run();
    return { provider, ok, detail };
  } catch (e) {
    return { provider, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId } = await req.json();
    if (!clientId) return json({ error: "Missing clientId" }, 400);

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: c, error } = await supabase
      .from("clients")
      .select("retell_api_key, ghl_api_key, ghl_location_id, twilio_account_sid, twilio_auth_token, openrouter_api_key")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !c) return json({ error: "Client not found" }, 404);

    const results = await Promise.all([
      check("retell", async () => {
        if (!c.retell_api_key) return { ok: false, detail: "No API key set" };
        // API-DEPR-1: legacy GET /list-agents is deprecated (removal 07/31/2026);
        // the v2 POST with limit 1 is the cheapest authenticated liveness probe.
        const r = await fetch("https://api.retellai.com/v2/list-agents", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${c.retell_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ limit: 1 }),
        });
        return { ok: r.ok, detail: r.ok ? "Connected" : `HTTP ${r.status}` };
      }),
      check("ghl", async () => {
        if (!c.ghl_api_key) return { ok: false, detail: "No API key set" };
        if (!c.ghl_location_id) return { ok: false, detail: "No location id set" };
        const r = await fetch(`https://services.leadconnectorhq.com/locations/${c.ghl_location_id}`, {
          headers: { Authorization: `Bearer ${c.ghl_api_key}`, Version: "2021-07-28" },
        });
        return { ok: r.ok, detail: r.ok ? "Connected" : `HTTP ${r.status}` };
      }),
      check("twilio", async () => {
        if (!c.twilio_account_sid || !c.twilio_auth_token) {
          return { ok: false, detail: "No account SID / auth token set" };
        }
        const auth = btoa(`${c.twilio_account_sid}:${c.twilio_auth_token}`);
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.twilio_account_sid}.json`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        return { ok: r.ok, detail: r.ok ? "Connected" : `HTTP ${r.status}` };
      }),
      check("openrouter", async () => {
        if (!c.openrouter_api_key) return { ok: false, detail: "No API key set" };
        const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${c.openrouter_api_key}` },
        });
        return { ok: r.ok, detail: r.ok ? "Connected" : `HTTP ${r.status}` };
      }),
    ]);

    return json({ results }, 200);
  } catch (err) {
    console.error("verify-credentials error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
