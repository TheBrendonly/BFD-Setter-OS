// get-client-usage (F13)
//
// The single gated read of a sub-account's billing-period usage + cost. Runs as
// service-role (message_queue has RLS with no policies, call_history is
// agency-scoped) and re-derives the caller's role from their JWT, so margin /
// actual provider cost never reach a client even though a real client is its
// own agency (the F8 trap class).
//
//   POST { client_id, period_offset? } ->
//     role "client", all display toggles off -> { show: false }
//     role "client", parts toggled on        -> { show: true, ...only those parts }
//     role "agency"                          -> full usage + margin payload
//
// Usage sources (verified 2026-07-02):
//   - Voice: call_history (duration_ms/duration_seconds + Retell actual cost in
//     USD dollars), client_id-scoped. Each call bills CEIL-to-whole-minute.
//   - SMS: message_queue channel='sms_outbound', linked by ghl_account_id which
//     holds clients.ghl_location_id (or the client_id itself on the
//     crm-send-message fallback path). Synthetic-probe stamps are excluded by
//     their PROBE_SKIPPED sid prefix; every real send has a Twilio sid.
//
// Auth: resolveClientAccess (JWT signature + ownership). verify_jwt is false at
// the gateway; the JWT is validated in-function. Mirrors get-blended-rate.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";
import { computeBlendedRate } from "../_shared/computeBlendedRate.ts";
import { mergeWithDefaults, type PricingConfigInput } from "../_shared/pricingDefaults.ts";
import { computeBillingPeriod } from "../_shared/billingPeriod.ts";
import { billableMinutes, computeUsagePricing, type UsageCall } from "../_shared/computeUsage.ts";
import { branchUsageByRole, type UsagePayload } from "./roleBranch.ts";

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
    const { client_id, period_offset } = body as {
      client_id?: string;
      period_offset?: number;
    };

    if (!client_id) return json({ error: "Missing client_id" }, 400);

    let role: "agency" | "client";
    try {
      ({ role } = await resolveClientAccess(authHeader, client_id));
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    // Client row (timezone + the SMS linkage key) and the pricing override.
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("timezone, ghl_location_id")
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
    const computed = computeBlendedRate(merged);
    const period = computeBillingPeriod({
      anchorDay: merged.billing_anchor_day,
      timeZone: clientRow.timezone || "Australia/Sydney",
      offset: typeof period_offset === "number" ? period_offset : 0,
    });

    // Voice: page the period's calls (a month of calls is small; cap paranoid).
    const calls: UsageCall[] = [];
    let actualVoiceCostUsdMicros = 0;
    let nullCostCalls = 0;
    for (let from = 0; from < 100 * PAGE_SIZE; from += PAGE_SIZE) {
      const { data: page, error: pageErr } = await supabase
        .from("call_history")
        .select("duration_ms, duration_seconds, cost")
        .eq("client_id", client_id)
        .gte("created_at", period.start_utc)
        .lt("created_at", period.end_utc)
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (pageErr) throw pageErr;
      for (const row of page ?? []) {
        calls.push({
          duration_ms: typeof row.duration_ms === "number" ? row.duration_ms : null,
          duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
        });
        const cost = row.cost === null || row.cost === undefined ? NaN : Number(row.cost);
        if (Number.isFinite(cost)) actualVoiceCostUsdMicros += Math.round(cost * 1_000_000);
        else nullCostCalls += 1;
      }
      if (!page || page.length < PAGE_SIZE) break;
    }

    // SMS: count outbound sends linked to this client. ghl_account_id holds the
    // GHL location id, or the client_id itself on the crm-send-message fallback.
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

    const minutes = billableMinutes(calls);
    const outboundTexts = smsCount ?? 0;
    const priced = computeUsagePricing({
      billableMinutes: minutes,
      outboundTexts,
      computed,
      merged,
      actualVoiceCostUsdMicros,
    });

    const payload: UsagePayload = {
      period,
      display_currency: computed.display_currency,
      voice: {
        calls: calls.length,
        null_cost_calls: nullCostCalls,
        billable_minutes: minutes,
        billed_minor: priced.voice_billed_minor,
        actual_cost_usd_micros: actualVoiceCostUsdMicros,
        actual_cost_minor: priced.actual_voice_cost_minor,
        blended_per_min_minor: computed.blended_per_min_minor,
      },
      sms: {
        outbound_texts: outboundTexts,
        billed_minor: priced.sms_billed_minor,
        per_message_minor: computed.per_message_minor,
        est_cost_minor: priced.est_sms_cost_minor,
      },
      totals: {
        usage_billed_minor: priced.usage_billed_minor,
        fixed_monthly_minor: computed.fixed_monthly_minor,
        actual_cost_minor: priced.actual_cost_minor,
        margin_minor: priced.margin_minor,
        margin_bps: priced.margin_bps,
      },
    };

    return json(branchUsageByRole(merged, role, payload));
  } catch (err) {
    console.error("get-client-usage error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
