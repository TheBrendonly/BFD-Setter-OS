// get-cost-ledger — the agency-only cost read surface over the P2 ledger.
//
// The FIRST reader of execution_cost_events. Mirrors get-client-usage's auth +
// billing-period conventions, but answers the P&L questions the usage panel does
// not: cost by kind, cost-per-booking, an estimated-vs-actual split, and two
// burn-downs (voice minutes vs the pool, cost vs the monthly ceiling).
//
//   POST { client_id, period_offset? } ->
//     role "client"  -> { role:"client", show:false }   (internal P&L, never leaked)
//     role "agency"  -> { role:"agency", currency:"USD", period, ...summary }
//
// HONESTY: voice cost is ACTUAL (execution_cost_events). SMS + LLM are ESTIMATES
// (SMS = outbound count × seed rate; LLM = cadence_metrics.ai_cost_cents), because
// SMS/LLM cost events are not written to the ledger yet. All USD — this is raw
// provider cost, so no FX to the display currency (deliberate; see costLedger.ts).
//
// Auth: resolveClientAccess (JWT signature + ownership), same as get-client-usage.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { mergeWithDefaults, type PricingConfigInput } from "../_shared/pricingDefaults.ts";
import { computeBillingPeriod } from "../_shared/billingPeriod.ts";
import { summarizeCostLedger, type CostEventRow } from "../_shared/costLedger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Mirrors trigger/_shared/sendTwilioSmsAndStamp SMS_SEGMENT_COST_USD_SEED (1.4c/segment).
const SMS_SEED_USD_PER_MSG = 0.014;
// Per-client per-period cost rows are tiny (voice calls + cadence runs); this cap is
// a paranoia bound, not a real limit. Logged if ever hit.
const ROW_CAP = 5000;

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
    // Internal P&L: only the agency ever sees cost. A client (its own agency in RLS) gets nothing.
    if (role !== "agency") return json({ role: "client", show: false });

    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("timezone, ghl_location_id, monthly_cost_ceiling_cents")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!clientRow) return json({ error: "Client not found" }, 404);

    const { data: pricingRow } = await supabase
      .from("client_pricing_config")
      .select("config")
      .eq("client_id", client_id)
      .maybeSingle();
    const merged = mergeWithDefaults((pricingRow?.config ?? null) as PricingConfigInput | null);

    const period = computeBillingPeriod({
      anchorDay: merged.billing_anchor_day,
      timeZone: clientRow.timezone || "Australia/Sydney",
      offset: typeof period_offset === "number" ? period_offset : 0,
    });

    // Voice + any other ledger cost events in the period (actual provider cost).
    const { data: eventRows, error: evErr } = await supabase
      .from("execution_cost_events")
      .select("cost_kind, quantity, cost_usd, is_estimated")
      .eq("client_id", client_id)
      .gte("occurred_at", period.start_utc)
      .lt("occurred_at", period.end_utc)
      .limit(ROW_CAP);
    if (evErr) throw evErr;
    if ((eventRows?.length ?? 0) >= ROW_CAP) {
      console.warn("get-cost-ledger: execution_cost_events row cap hit for", client_id);
    }
    const costEvents: CostEventRow[] = (eventRows ?? []).map((r) => ({
      cost_kind: String(r.cost_kind ?? ""),
      quantity: Number(r.quantity ?? 0),
      cost_usd: Number(r.cost_usd ?? 0),
      is_estimated: r.is_estimated === true,
    }));

    // LLM cost estimate — cadence_metrics.ai_cost_cents summed over the period.
    const { data: metricRows, error: mErr } = await supabase
      .from("cadence_metrics")
      .select("ai_cost_cents")
      .eq("client_id", client_id)
      .gte("created_at", period.start_utc)
      .lt("created_at", period.end_utc)
      .limit(ROW_CAP);
    if (mErr) throw mErr;
    const aiCostCents = (metricRows ?? []).reduce(
      (sum, r) => sum + (Number(r.ai_cost_cents) || 0),
      0,
    );

    // SMS count — same linkage as get-client-usage (ghl_account_id holds the GHL
    // location id or the client_id on the fallback path; probe stamps excluded).
    const smsKeys = [clientRow.ghl_location_id, client_id].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    const { count: smsCount, error: smsErr } = await supabase
      .from("message_queue")
      .select("id", { count: "exact", head: true })
      .eq("channel", "sms_outbound")
      .in("ghl_account_id", smsKeys)
      .gte("created_at", period.start_utc)
      .lt("created_at", period.end_utc)
      .not("twilio_message_sid", "like", "PROBE_SKIPPED%");
    if (smsErr) throw smsErr;

    // Bookings produced in the period (confirmed) — the cost-per-booking denominator.
    const { count: bookingCount, error: bErr } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client_id)
      .eq("status", "confirmed")
      .gte("created_at", period.start_utc)
      .lt("created_at", period.end_utc);
    if (bErr) throw bErr;

    const summary = summarizeCostLedger({
      costEvents,
      aiCostCents,
      smsCount: smsCount ?? 0,
      smsSeedUsdPerMsg: SMS_SEED_USD_PER_MSG,
      bookingCount: bookingCount ?? 0,
      monthlyCeilingCents: typeof clientRow.monthly_cost_ceiling_cents === "number"
        ? clientRow.monthly_cost_ceiling_cents
        : null,
      includedMinutes: merged.included_minutes > 0 ? merged.included_minutes : null,
    });

    return json({ role: "agency", currency: "USD", period, ...summary });
  } catch (err) {
    console.error("get-cost-ledger error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
