import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// F15(a) — the single read of a sub-account's show-rate funnel via the
// get-show-rate-funnel edge fn. The SERVER decides visibility by role: a client
// sees the funnel only when the agency toggled report.show_funnel_to_client on
// (else { show: false }); the agency always sees it. The funnel numbers are the
// client's OWN performance data, so both roles get the same counts, gated only
// by visibility. Render off the returned shape (boundary stays server-side).

export interface FunnelCounts {
  booked: number;
  confirmed: number;
  held: number;
  no_show: number;
  cancelled: number;
  upcoming: number;
  show_rate: number | null;
  no_show_rate: number | null;
}

export interface FunnelShape {
  period: { start_utc: string; end_utc: string; label: string };
  overall: FunnelCounts;
  by_source: Record<string, FunnelCounts>;
  by_lead_source: Record<string, FunnelCounts>;
}

// Client shape adds { show: true }; agency shape adds { role: 'agency' }.
export type ShowRateFunnelResponse =
  | { show: false }
  | (FunnelShape & { show: true })
  | (FunnelShape & { role: 'agency' });

export function hasFunnel(f: ShowRateFunnelResponse | null): f is FunnelShape & { show?: true; role?: 'agency' } {
  return !!f && 'overall' in f;
}

export function useShowRateFunnel(clientId: string | undefined, periodOffset = 0) {
  const [funnel, setFunnel] = useState<ShowRateFunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSeq = useRef(0);

  const fetchFunnel = useCallback(async () => {
    if (!clientId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-show-rate-funnel', {
        body: { client_id: clientId, period_offset: periodOffset },
      });
      if (error) throw error;
      if (seq !== requestSeq.current) return;
      setFunnel((data ?? { show: false }) as ShowRateFunnelResponse);
    } catch (err) {
      console.error('get-show-rate-funnel failed:', err);
      if (seq !== requestSeq.current) return;
      setFunnel({ show: false });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [clientId, periodOffset]);

  useEffect(() => {
    fetchFunnel();
  }, [fetchFunnel]);

  return { funnel, loading, refetch: fetchFunnel };
}
