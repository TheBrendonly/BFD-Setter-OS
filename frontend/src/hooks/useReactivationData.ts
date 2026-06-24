// Bug 4 — live data hook for the Lead Reactivation dashboard.
//
// Returns the same shape as the previous mock at
// frontend/src/data/leadReactivationData.ts so the existing chart layer
// renders unchanged. When the underlying tables are empty (e.g. for a client
// that hasn't run a reactivation campaign yet), all numeric fields are 0
// and the dashboard naturally renders an empty state.
//
// Data sources:
//   - engagement_executions(kind='reactivation') for run counts + channel
//     breakdowns (joined with cadence_metrics via execution_id).
//   - cadence_metrics for sms_sent / emails_sent / calls_attempted /
//     calls_picked_up / reply_received / booking_created.
//   - bookings(cadence_execution_id IS NOT NULL) for booking attribution.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MonthlyData {
  month: string;
  callsMade: number;
  callPickups: number;
  callPositive: number;
  callBookings: number;
  smsSent: number;
  smsResponses: number;
  smsPositive: number;
  smsBookings: number;
  emailsSent: number;
  emailResponses: number;
  emailPositive: number;
  emailBookings: number;
}

export interface ClientData {
  client: string;
  totalLeads: number;
  callsMade: number;
  callPickups: number;
  callPositive: number;
  callBookings: number;
  smsSent: number;
  smsResponses: number;
  smsPositive: number;
  smsBookings: number;
  emailsSent: number;
  emailResponses: number;
  emailPositive: number;
  emailBookings: number;
}

export interface ReactivationTotals {
  totalLeads: number;
  callsMade: number;
  callPickups: number;
  callPositive: number;
  callBookings: number;
  smsSent: number;
  smsResponses: number;
  smsPositive: number;
  smsBookings: number;
  emailsSent: number;
  emailResponses: number;
  emailPositive: number;
  emailBookings: number;
  callPickupRate: number;
  smsResponseRate: number;
  emailResponseRate: number;
  callPositiveRate: number;
  smsPositiveRate: number;
  emailPositiveRate: number;
  callBookingRate: number;
  smsBookingRate: number;
  emailBookingRate: number;
}

const EMPTY_TOTALS: ReactivationTotals = {
  totalLeads: 0, callsMade: 0, callPickups: 0, callPositive: 0, callBookings: 0,
  smsSent: 0, smsResponses: 0, smsPositive: 0, smsBookings: 0,
  emailsSent: 0, emailResponses: 0, emailPositive: 0, emailBookings: 0,
  callPickupRate: 0, smsResponseRate: 0, emailResponseRate: 0,
  callPositiveRate: 0, smsPositiveRate: 0, emailPositiveRate: 0,
  callBookingRate: 0, smsBookingRate: 0, emailBookingRate: 0,
};

function ratePct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function monthKey(d: Date): string {
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

export function useReactivationData(clientId: string | undefined) {
  const [data, setData] = useState<{
    totals: ReactivationTotals;
    monthlyData: MonthlyData[];
    clientData: ClientData[];
  }>({ totals: EMPTY_TOTALS, monthlyData: [], clientData: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch reactivation executions (kind='reactivation') for this client over the last 12 months.
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        twelveMonthsAgo.setDate(1);

        const { data: execs, error: execErr } = await (supabase
          .from('engagement_executions')
          .select('id, client_id, status, started_at, stop_reason, reply_channel')
          .eq('client_id', clientId)
          .eq('kind', 'reactivation')
          .gte('started_at', twelveMonthsAgo.toISOString()) as any);
        if (execErr) throw execErr;
        const execRows = (execs as Array<{ id: string; client_id: string; status: string; started_at: string; stop_reason: string | null; reply_channel: string | null }> | null) ?? [];

        // Hydrate cadence_metrics for those executions for channel-level counts.
        const execIds = execRows.map(e => e.id);
        let metrics: Array<{
          execution_id: string;
          sms_sent: number;
          emails_sent: number;
          calls_attempted: number;
          calls_picked_up: number;
          reply_received: boolean | null;
          booking_created: boolean | null;
        }> = [];
        if (execIds.length > 0) {
          const { data: m, error: mErr } = await (supabase
            .from('cadence_metrics')
            .select('execution_id, sms_sent, emails_sent, calls_attempted, calls_picked_up, reply_received, booking_created')
            .in('execution_id', execIds) as any);
          if (mErr) throw mErr;
          metrics = (m as any[]) ?? [];
        }

        // Group by month
        const months: MonthlyData[] = [];
        const monthIndex = new Map<string, MonthlyData>();
        for (let i = 0; i < 12; i++) {
          const d = new Date(twelveMonthsAgo);
          d.setMonth(twelveMonthsAgo.getMonth() + i);
          const key = monthKey(d);
          const row: MonthlyData = {
            month: key,
            callsMade: 0, callPickups: 0, callPositive: 0, callBookings: 0,
            smsSent: 0, smsResponses: 0, smsPositive: 0, smsBookings: 0,
            emailsSent: 0, emailResponses: 0, emailPositive: 0, emailBookings: 0,
          };
          months.push(row);
          monthIndex.set(key, row);
        }

        const metricsByExec = new Map(metrics.map(m => [m.execution_id, m]));

        let totalLeads = 0;
        const totals: ReactivationTotals = { ...EMPTY_TOTALS };

        for (const exec of execRows) {
          const m = metricsByExec.get(exec.id);
          if (!m) continue;
          const k = monthKey(new Date(exec.started_at));
          const month = monthIndex.get(k);
          if (!month) continue;
          totalLeads++;

          month.callsMade += m.calls_attempted ?? 0;
          month.callPickups += m.calls_picked_up ?? 0;
          month.smsSent += m.sms_sent ?? 0;
          month.emailsSent += m.emails_sent ?? 0;
          if (m.reply_received) {
            if ((m.sms_sent ?? 0) > 0) month.smsResponses++;
            if ((m.emails_sent ?? 0) > 0) month.emailResponses++;
          }
          if (exec.stop_reason === 'call_engaged') month.callPositive++;
          if (exec.stop_reason === 'inbound_reply') {
            // Batch 3 fix — credit one channel based on engagement_executions.reply_channel
            // (now populated by endActiveCadences). Fall back to the heuristic
            // (channel with higher send count, sms-wins-tie) when null for legacy rows.
            if (exec.reply_channel === 'sms') month.smsPositive++;
            else if (exec.reply_channel === 'email') month.emailPositive++;
            else if (exec.reply_channel === 'whatsapp') { /* future: whatsappPositive */ }
            else {
              const smsSent = m.sms_sent ?? 0;
              const emailsSent = m.emails_sent ?? 0;
              if (smsSent >= emailsSent && smsSent > 0) month.smsPositive++;
              else if (emailsSent > 0) month.emailPositive++;
            }
          }
          if (m.booking_created) {
            if ((m.calls_attempted ?? 0) > 0 && (m.calls_picked_up ?? 0) > 0) month.callBookings++;
            else if ((m.sms_sent ?? 0) > 0) month.smsBookings++;
            else if ((m.emails_sent ?? 0) > 0) month.emailBookings++;
          }

          totals.callsMade += m.calls_attempted ?? 0;
          totals.callPickups += m.calls_picked_up ?? 0;
          totals.smsSent += m.sms_sent ?? 0;
          totals.emailsSent += m.emails_sent ?? 0;
          if (exec.stop_reason === 'call_engaged') totals.callPositive++;
          if (m.reply_received) {
            if ((m.sms_sent ?? 0) > 0) totals.smsResponses++;
            if ((m.emails_sent ?? 0) > 0) totals.emailResponses++;
          }
          if (exec.stop_reason === 'inbound_reply') {
            if (exec.reply_channel === 'sms') totals.smsPositive++;
            else if (exec.reply_channel === 'email') totals.emailPositive++;
            else if (exec.reply_channel === 'whatsapp') { /* future */ }
            else {
              const smsSent = m.sms_sent ?? 0;
              const emailsSent = m.emails_sent ?? 0;
              if (smsSent >= emailsSent && smsSent > 0) totals.smsPositive++;
              else if (emailsSent > 0) totals.emailPositive++;
            }
          }
          if (m.booking_created) {
            if ((m.calls_attempted ?? 0) > 0 && (m.calls_picked_up ?? 0) > 0) totals.callBookings++;
            else if ((m.sms_sent ?? 0) > 0) totals.smsBookings++;
            else if ((m.emails_sent ?? 0) > 0) totals.emailBookings++;
          }
        }

        totals.totalLeads = totalLeads;
        totals.callPickupRate = ratePct(totals.callPickups, totals.callsMade);
        totals.smsResponseRate = ratePct(totals.smsResponses, totals.smsSent);
        totals.emailResponseRate = ratePct(totals.emailResponses, totals.emailsSent);
        totals.callPositiveRate = ratePct(totals.callPositive, totals.callPickups);
        totals.smsPositiveRate = ratePct(totals.smsPositive, totals.smsResponses);
        totals.emailPositiveRate = ratePct(totals.emailPositive, totals.emailResponses);
        totals.callBookingRate = ratePct(totals.callBookings, totals.callPositive);
        totals.smsBookingRate = ratePct(totals.smsBookings, totals.smsPositive);
        totals.emailBookingRate = ratePct(totals.emailBookings, totals.emailPositive);

        // Multi-client breakdown — fetch the client name from clients table.
        const { data: clientRow } = await (supabase
          .from('clients_public')
          .select('name')
          .eq('id', clientId)
          .maybeSingle() as any);
        const clientName = (clientRow as { name?: string } | null)?.name ?? 'Client';

        const clientData: ClientData[] = [{
          client: clientName,
          totalLeads: totals.totalLeads,
          callsMade: totals.callsMade,
          callPickups: totals.callPickups,
          callPositive: totals.callPositive,
          callBookings: totals.callBookings,
          smsSent: totals.smsSent,
          smsResponses: totals.smsResponses,
          smsPositive: totals.smsPositive,
          smsBookings: totals.smsBookings,
          emailsSent: totals.emailsSent,
          emailResponses: totals.emailResponses,
          emailPositive: totals.emailPositive,
          emailBookings: totals.emailBookings,
        }];

        if (!cancelled) {
          setData({ totals, monthlyData: months, clientData });
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, reloadKey]);

  return {
    ...data,
    loading,
    error,
    refresh: () => setReloadKey(k => k + 1),
  };
}
