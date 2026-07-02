import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// F13 — the single read of a sub-account's billing-period usage + cost via the
// get-client-usage edge fn. The SERVER decides the shape by role: a client gets
// only the admin-toggled parts (or { show: false }); the agency gets the full
// usage + margin payload. This hook never post-processes by role — rendering
// off the returned shape keeps the boundary server-side.

export interface ClientUsageShape {
  show: true;
  period: { start_utc: string; end_utc: string; label: string };
  display_currency: string;
  minutes?: number;
  texts?: number;
  rate_per_min_minor?: number;
  total_minor?: number;
  fixed_monthly_minor?: number;
}

export interface AgencyUsageShape {
  role: 'agency';
  period: {
    start_utc: string;
    end_utc: string;
    label: string;
    anchor_day: number;
    timezone: string;
    offset: number;
  };
  display_currency: string;
  voice: {
    calls: number;
    null_cost_calls: number;
    billable_minutes: number;
    billed_minor: number;
    actual_cost_usd_micros: number;
    actual_cost_minor: number;
    blended_per_min_minor: number;
  };
  sms: {
    outbound_texts: number;
    billed_minor: number;
    per_message_minor: number;
    est_cost_minor: number;
  };
  totals: {
    usage_billed_minor: number;
    fixed_monthly_minor: number;
    actual_cost_minor: number;
    margin_minor: number;
    margin_bps: number | null;
  };
  client_display: {
    show_rate: boolean;
    show_minutes: boolean;
    show_texts: boolean;
    show_total: boolean;
  };
}

export type ClientUsageResponse = { show: false } | ClientUsageShape | AgencyUsageShape;

export function isAgencyUsage(u: ClientUsageResponse | null): u is AgencyUsageShape {
  return !!u && 'role' in u && u.role === 'agency';
}

export function isClientUsage(u: ClientUsageResponse | null): u is ClientUsageShape {
  return !!u && 'show' in u && u.show === true;
}

export function useClientUsage(clientId: string | undefined, periodOffset = 0) {
  const [usage, setUsage] = useState<ClientUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Stale-response guard: quick period changes race their responses; only the
  // most recently issued request may commit state.
  const requestSeq = useRef(0);

  const fetchUsage = useCallback(async () => {
    if (!clientId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-client-usage', {
        body: { client_id: clientId, period_offset: periodOffset },
      });
      if (error) throw error;
      if (seq !== requestSeq.current) return;
      setUsage((data ?? { show: false }) as ClientUsageResponse);
    } catch (err) {
      console.error('get-client-usage failed:', err);
      if (seq !== requestSeq.current) return;
      setUsage({ show: false });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [clientId, periodOffset]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  return { usage, loading, refetch: fetchUsage };
}
