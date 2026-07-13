// get-openrouter-usage — server-side proxy for OpenRouter usage/credits/activity.
//
// G3-6 secret-read hardening: the frontend used to read the client's
// openrouter_api_key + openrouter_management_key into the browser and call
// openrouter.ai directly (3 fetches with the key in the Authorization header).
// This function moves all three calls server-side so the keys never reach the
// browser. The browser sends only { clientId }; we authorize, read the keys with
// the service role, call OpenRouter, and return the same safe shapes the hook
// already consumed (credits / keyUsage / activity).

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OR_BASE = "https://openrouter.ai/api/v1";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId } = await req.json();
    if (!clientId) return json({ error: "clientId is required" }, 400);

    // RLS-ORUSAGE-1: OpenRouter usage/credits = BFD's bundled-account cost basis / margin, so gate
    // to AGENCY role only. authorizeClientRequest previously allowed a client-role caller for its
    // own client_id, which would expose BFD's margin. Browser-only caller (useOpenRouterUsage), so
    // no server-to-server service-role path is lost by using resolveClientAccess.
    try {
      const { role } = await resolveClientAccess(req.headers.get("Authorization"), clientId);
      if (role !== "agency") return json({ error: "Forbidden" }, 403);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: client, error: clientErr } = await admin
      .from("clients")
      .select("openrouter_api_key, openrouter_management_key")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr) return json({ error: `Client lookup failed: ${clientErr.message}` }, 500);

    const apiKey = client?.openrouter_api_key as string | null;
    const managementKey = client?.openrouter_management_key as string | null;
    if (!apiKey) {
      return json({ ok: true, hasKey: false, credits: null, keyUsage: null, activity: [], activityError: null });
    }

    // 1. Credits
    let credits: Record<string, number> | null = null;
    try {
      const res = await fetch(`${OR_BASE}/credits`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (res.ok) {
        const d = (await res.json())?.data ?? {};
        credits = {
          total_credits: d.total_credits ?? 0,
          total_usage: d.total_usage ?? 0,
          remaining: (d.total_credits ?? 0) - (d.total_usage ?? 0),
        };
      }
    } catch (_e) { /* non-fatal */ }

    // 2. Key info
    let keyUsage: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`${OR_BASE}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (res.ok) {
        const d = (await res.json())?.data ?? {};
        keyUsage = {
          label: d.label ?? "",
          usage: d.usage ?? 0,
          usage_daily: d.usage_daily ?? 0,
          usage_weekly: d.usage_weekly ?? 0,
          usage_monthly: d.usage_monthly ?? 0,
          limit: d.limit ?? null,
          limit_remaining: d.limit_remaining ?? null,
          is_free_tier: d.is_free_tier ?? false,
        };
      }
    } catch (_e) { /* non-fatal */ }

    // 3. Activity (prefers the management key; 403 means no management key)
    let activity: unknown[] = [];
    let activityError: string | null = null;
    const activityKey = managementKey || apiKey;
    try {
      const res = await fetch(`${OR_BASE}/activity`, { headers: { Authorization: `Bearer ${activityKey}` } });
      if (res.status === 403) {
        activityError = "Activity data requires a management key. Add your OpenRouter Management Key in Credentials to unlock model breakdown and daily activity.";
      } else if (res.ok) {
        activity = (await res.json())?.data ?? [];
      } else {
        activityError = `Activity API error: ${res.status}`;
      }
    } catch (e) {
      activityError = (e as Error).message;
    }

    return json({ ok: true, hasKey: true, credits, keyUsage, activity, activityError });
  } catch (err) {
    console.error("get-openrouter-usage error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
