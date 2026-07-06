// weeklyClientReport (F15b) — assembles + persists one weekly ROI report per
// client and (once Resend SMTP is wired) emails it.
//
// Runs weekly. Reuses the pure funnel / usage / assembly modules from the edge
// _shared dir so numbers match get-show-rate-funnel and F13 (no re-derivation).
// Email send is gated on RESEND_API_KEY: until Brendan wires Resend (BRENDAN_TODO
// M1), each report is persisted with email_status='stubbed' and the dashboard
// preview URL (get-weekly-report) renders it. Section visibility for the client
// email follows the agency's client_pricing_config.config.report toggles.

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { computeFunnel, type FunnelBookingRow } from "../frontend/supabase/functions/_shared/showRateFunnel.ts";
import { billableMinutes, type UsageCall } from "../frontend/supabase/functions/_shared/computeUsage.ts";
import {
  assembleWeeklyReport,
  type WeeklyReportSections,
} from "../frontend/supabase/functions/_shared/weeklyReport.ts";

const getMainSupabase = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// The just-completed week: [today-7d 00:00 UTC, today 00:00 UTC). On the Monday
// cron that is the previous Mon..Sun. Stable per calendar day so the (client_id,
// period_start) upsert is idempotent on a re-run.
function weekWindowUtc(now: Date): { start: string; end: string; label: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const lastDay = new Date(end.getTime() - 24 * 60 * 60 * 1000); // inclusive last day
  const fmt = (d: Date) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return { start: start.toISOString(), end: end.toISOString(), label: `${fmt(start)} to ${fmt(lastDay)}` };
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

export const weeklyClientReport = schedules.task({
  id: "weekly-client-report",
  // Sunday 23:00 UTC = Monday 09:00 AEST — a Monday-morning summary of last week.
  cron: "0 23 * * 0",
  maxDuration: 600,
  retry: { maxAttempts: 2 },

  run: async () => {
    const supabase = getMainSupabase();
    const now = new Date();
    const win = weekWindowUtc(now);
    const stats = { clients: 0, reports: 0, sent: 0, stubbed: 0, errors: 0 };

    const { data: clients, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, timezone, ghl_location_id")
      .eq("is_system", false);
    if (clientsErr) throw new Error(`weeklyClientReport: client query failed: ${clientsErr.message}`);

    const resendKey = process.env.RESEND_API_KEY;

    for (const client of clients ?? []) {
      stats.clients++;
      try {
        const clientId = client.id as string;

        // Calls made / answered.
        const { count: callsMade } = await supabase
          .from("call_history").select("id", { count: "exact", head: true })
          .eq("client_id", clientId).gte("created_at", win.start).lt("created_at", win.end);
        const { count: callsAnswered } = await supabase
          .from("call_history").select("id", { count: "exact", head: true })
          .eq("client_id", clientId).eq("human_pickup", true)
          .gte("created_at", win.start).lt("created_at", win.end);

        // Voice minutes (ceil-per-call, F13 rule).
        const usageCalls: UsageCall[] = [];
        const { data: callRows } = await supabase
          .from("call_history").select("duration_ms, duration_seconds")
          .eq("client_id", clientId).gte("created_at", win.start).lt("created_at", win.end);
        for (const r of callRows ?? []) {
          usageCalls.push({
            duration_ms: typeof r.duration_ms === "number" ? r.duration_ms : null,
            duration_seconds: typeof r.duration_seconds === "number" ? r.duration_seconds : null,
          });
        }
        const minutes = billableMinutes(usageCalls);

        // SMS: conversations (distinct inbound contacts) + outbound texts.
        const smsAccountIds = [client.ghl_location_id, clientId].filter(Boolean) as string[];
        const { data: inboundRows } = await supabase
          .from("message_queue").select("ghl_contact_id")
          .eq("channel", "sms_inbound").in("ghl_account_id", smsAccountIds)
          .gte("created_at", win.start).lt("created_at", win.end);
        const conversations = new Set(
          (inboundRows ?? []).map((r) => r.ghl_contact_id).filter(Boolean),
        ).size;
        const { count: outboundTexts } = await supabase
          .from("message_queue").select("id", { count: "exact", head: true })
          .eq("channel", "sms_outbound").in("ghl_account_id", smsAccountIds)
          .gte("created_at", win.start).lt("created_at", win.end)
          .not("twilio_message_sid", "like", "PROBE_SKIPPED%");

        // Funnel over bookings created in the window.
        const bookingRows: FunnelBookingRow[] = [];
        const { data: bookings } = await supabase
          .from("bookings").select("status, source")
          .eq("client_id", clientId).gte("created_at", win.start).lt("created_at", win.end);
        for (const b of bookings ?? []) {
          bookingRows.push({ status: (b.status as string) ?? "confirmed", source: (b.source as string | null) ?? null });
        }
        const funnel = computeFunnel(bookingRows);

        // Report config (visibility + "what we improved") from client_report_config.
        const { data: reportRow } = await supabase
          .from("client_report_config").select("config").eq("client_id", clientId).maybeSingle();
        const reportCfg = (reportRow?.config ?? {}) as {
          what_we_improved?: unknown;
          sections?: Partial<WeeklyReportSections>;
          recipient_email?: string;
        };
        const sections: WeeklyReportSections = {
          calls: reportCfg.sections?.calls ?? true,
          sms: reportCfg.sections?.sms ?? true,
          funnel: reportCfg.sections?.funnel ?? true,
          usage: reportCfg.sections?.usage ?? false, // billing figures off by default
          objections: reportCfg.sections?.objections ?? true,
          improvements: reportCfg.sections?.improvements ?? true,
        };

        const { payload, html } = assembleWeeklyReport({
          clientName: (client.name as string) ?? "your account",
          brandName: "Building Flow Digital",
          periodLabel: win.label,
          calls: { made: callsMade ?? 0, answered: callsAnswered ?? 0 },
          sms: { conversations },
          funnel: {
            booked: funnel.booked, held: funnel.held, no_show: funnel.no_show,
            cancelled: funnel.cancelled, show_rate: funnel.show_rate, no_show_rate: funnel.no_show_rate,
          },
          billed: { minutes, texts: outboundTexts ?? 0, total_label: null },
          // Top objections: no queryable store yet (deferred fast-follow); the
          // section renders nothing until a source exists.
          objections: [],
          whatWeImproved: asStringArray(reportCfg.what_we_improved),
          sections,
        });

        let emailStatus = "stubbed";
        let sentAt: string | null = null;
        if (resendKey) {
          // Resend wired: attempt the white-label send. Recipient wiring is a
          // BRENDAN_TODO detail; guard so a missing recipient just stubs.
          try {
            const to = reportCfg.recipient_email;
            if (to) {
              const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: "Building Flow Digital <reports@buildingflowdigital.com>",
                  to,
                  subject: `Your weekly report (${win.label})`,
                  html,
                }),
              });
              emailStatus = res.ok ? "sent" : "failed";
              if (res.ok) { sentAt = new Date().toISOString(); stats.sent++; }
            }
          } catch (sendErr) {
            console.warn(`weeklyClientReport: send failed for ${clientId} (non-fatal):`, (sendErr as Error).message);
            emailStatus = "failed";
          }
        }
        if (emailStatus === "stubbed") stats.stubbed++;

        const { error: upsertErr } = await supabase
          .from("weekly_reports")
          .upsert(
            {
              client_id: clientId,
              period_start: win.start,
              period_end: win.end,
              payload,
              html,
              email_status: emailStatus,
              sent_at: sentAt,
            },
            { onConflict: "client_id,period_start" },
          );
        if (upsertErr) throw new Error(`weekly_reports upsert failed: ${upsertErr.message}`);
        stats.reports++;
      } catch (clientErr) {
        stats.errors++;
        console.error(`weeklyClientReport: client ${client.id} failed:`, (clientErr as Error).message);
      }
    }

    console.log(`weeklyClientReport: ${JSON.stringify(stats)} window=${win.label}`);
    return stats;
  },
});
