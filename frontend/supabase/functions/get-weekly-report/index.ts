// get-weekly-report (F15b)
//
// Reads the latest weekly ROI report snapshot for a sub-account (the dashboard
// preview URL). Role/toggle branched: the agency always sees it; a client sees
// it only when the agency toggled report.show_report_to_client on. The report
// html is pre-rendered by the weeklyClientReport cron with only the agency-
// enabled sections, so it is safe to return to either role. Mirrors
// get-show-rate-funnel's auth plumbing.
//
//   POST { client_id } ->
//     role "client", show_report_to_client false -> { show: false }
//     role "client", toggle on / role "agency"   -> { show/role, report }

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

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

    const { data: reportRow } = await supabase
      .from("client_report_config")
      .select("config")
      .eq("client_id", client_id)
      .maybeSingle();
    const reportCfg = (reportRow?.config ?? {}) as { show_report_to_client?: boolean };

    if (role === "client" && reportCfg.show_report_to_client !== true) {
      return json({ show: false });
    }

    const { data: report } = await supabase
      .from("weekly_reports")
      .select("period_start, period_end, payload, html, email_status, created_at")
      .eq("client_id", client_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!report) return json(role === "client" ? { show: true, report: null } : { role: "agency", report: null });

    const shaped = {
      period: { start: report.period_start, end: report.period_end },
      payload: report.payload,
      html: report.html,
      email_status: report.email_status,
      created_at: report.created_at,
    };
    return json(role === "client" ? { show: true, report: shaped } : { role: "agency", report: shaped });
  } catch (err) {
    console.error("get-weekly-report error:", err);
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});
