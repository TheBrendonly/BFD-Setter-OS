// get-show-rate-funnel (F15a)
//
// The gated read of a sub-account's show-rate funnel (booked -> confirmed ->
// held -> no-show) for a billing period, per booking source and per lead source.
// Runs as service-role (bookings is agency-scoped; the funnel is assembled +
// role-branched here) and re-derives the caller's role from their JWT.
//
//   POST { client_id, period_offset? } ->
//     role "client", report.show_funnel_to_client false -> { show: false }
//     role "client", toggle on                          -> { show: true, funnel... }
//     role "agency"                                      -> full funnel
//
// Only setter-created bookings are counted (rows already in `bookings`); GHL-
// native/manual appointments with no booking row are ignored (Decision 4). The
// funnel counts are the client's OWN performance data (not margin/cost), so the
// client shape is the SAME numbers as the agency shape, gated only by the
// visibility toggle. Mirrors get-client-usage's auth + period plumbing.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { computeBillingPeriod, sanitizeAnchorDay } from "../_shared/billingPeriod.ts";
import {
  computeFunnel,
  computeFunnelByDimension,
  type FunnelBookingRow,
} from "../_shared/showRateFunnel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const PAGE_SIZE = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization");
    const body = await req.json().catch(() => ({}));
    const { client_id, period_offset } = body as { client_id?: string; period_offset?: number };

    if (!client_id) return json({ error: "Missing client_id" }, 400);

    let role: "agency" | "client";
    try {
      ({ role } = await resolveClientAccess(authHeader, client_id));
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("timezone")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!clientRow) return json({ error: "Client not found" }, 404);

    const { data: pricingRow } = await supabase
      .from("client_pricing_config")
      .select("config")
      .eq("client_id", client_id)
      .maybeSingle();
    const config = (pricingRow?.config ?? {}) as Record<string, unknown>;
    const reportCfg = (config.report ?? {}) as { show_funnel_to_client?: boolean };
    const showFunnelToClient = reportCfg.show_funnel_to_client === true;

    // Client with the funnel toggled off sees nothing (React never gates alone).
    if (role === "client" && !showFunnelToClient) return json({ show: false });

    const period = computeBillingPeriod({
      anchorDay: sanitizeAnchorDay((config as { billing_anchor_day?: number }).billing_anchor_day),
      timeZone: clientRow.timezone || "Australia/Sydney",
      offset: typeof period_offset === "number" ? period_offset : 0,
    });

    // Bookings created in the period (cohort view). Volume is small; page anyway.
    // Carry lead_id so we can attach each booking's lead source below.
    const rows: (FunnelBookingRow & { lead_id: string | null })[] = [];
    const leadIds = new Set<string>();
    for (let from = 0; from < 100 * PAGE_SIZE; from += PAGE_SIZE) {
      const { data: page, error: pageErr } = await supabase
        .from("bookings")
        .select("status, source, lead_id")
        .eq("client_id", client_id)
        .gte("created_at", period.start_utc)
        .lt("created_at", period.end_utc)
        .range(from, from + PAGE_SIZE - 1);
      if (pageErr) throw pageErr;
      for (const b of page ?? []) {
        const leadId = typeof b.lead_id === "string" && b.lead_id ? b.lead_id : null;
        rows.push({
          status: (b.status as string) ?? "confirmed",
          source: (b.source as string | null) ?? null,
          lead_id: leadId,
        });
        if (leadId) leadIds.add(leadId);
      }
      if (!page || page.length < PAGE_SIZE) break;
    }

    // Resolve each booking's lead source (leads.lead_id is the GHL contact id,
    // which is bookings.lead_id). Prefer source_type -> form_source -> utm_source.
    const leadSourceById = new Map<string, string>();
    const idList = [...leadIds];
    for (let i = 0; i < idList.length; i += 200) {
      const chunk = idList.slice(i, i + 200);
      const { data: leads } = await supabase
        .from("leads")
        .select("lead_id, source_type, form_source, utm_source")
        .eq("client_id", client_id)
        .in("lead_id", chunk);
      for (const l of leads ?? []) {
        const src = (l.source_type as string | null) || (l.form_source as string | null) ||
          (l.utm_source as string | null) || null;
        if (typeof l.lead_id === "string" && src) leadSourceById.set(l.lead_id, src);
      }
    }
    for (const r of rows) {
      r.lead_source = r.lead_id ? (leadSourceById.get(r.lead_id) ?? null) : null;
    }

    const overall = computeFunnel(rows);
    const bySource = computeFunnelByDimension(rows, (r) => r.source);
    const byLeadSource = computeFunnelByDimension(rows, (r) => r.lead_source);

    const funnel = {
      period: { start_utc: period.start_utc, end_utc: period.end_utc, label: period.label },
      overall,
      by_source: bySource,
      by_lead_source: byLeadSource,
    };

    if (role === "client") return json({ show: true, ...funnel });
    return json({ role: "agency", ...funnel });
  } catch (err) {
    console.error("get-show-rate-funnel error:", err);
    return json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});
