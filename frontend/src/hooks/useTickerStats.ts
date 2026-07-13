import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TickerStats {
  totalLeads: number | null;
  unreadChats: number | null;
  textSetters: number | null;
  voiceSetters: number | null;
  activeCampaigns: number | null;
  openrouterBalance: number | null;
  outboundCalls: number | null;
}

const REFRESH_MS = 60_000;

export function useTickerStats(clientId: string | undefined, isAgency = false) {
  const [stats, setStats] = useState<TickerStats>({
    totalLeads: null,
    unreadChats: null,
    textSetters: null,
    voiceSetters: null,
    activeCampaigns: null,
    openrouterBalance: null,
    outboundCalls: null,
  });

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const [
          leadsRes,
          activeSettersRes,
          campaignsRes,
          callsRes,
          orCacheRes,
          leadsForUnreadRes,
          readStatusRes,
        ] = await Promise.all([
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
          supabase.from('prompts').select('category').eq('client_id', clientId).eq('is_active', true).in('category', ['text_agent', 'voice_setter']),
          supabase.from('engagement_campaigns' as any).select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('status', 'active'),
          supabase.from('call_history').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('direction', 'outbound'),
          // RLS-ORUSAGE-1: openrouter_usage_cache is agency-only (BFD's bundled-account margin).
          // Skip the read for client-role users (RLS would deny it) and hide the balance below.
          isAgency
            ? supabase.from('openrouter_usage_cache' as any).select('cached_data').eq('client_id', clientId).maybeSingle()
            : Promise.resolve({ data: null } as any),
          supabase.from('leads').select('id, last_message_at').eq('client_id', clientId).not('last_message_at', 'is', null),
          supabase.from('chat_read_status').select('lead_id, last_read_at').eq('client_id', clientId),
        ]);

        // Count unread
        const readMap = new Map<string, string>();
        (readStatusRes.data || []).forEach((r: any) => readMap.set(r.lead_id, r.last_read_at));
        const unread = (leadsForUnreadRes.data || []).filter((l: any) => {
          const lr = readMap.get(l.id);
          if (!lr) return true;
          return new Date(l.last_message_at).getTime() > new Date(lr).getTime();
        }).length;

        // Active setters by category
        const activeRows = (activeSettersRes.data || []) as Array<{ category: string }>;
        const textSetters = activeRows.filter(r => r.category === 'text_agent').length;
        const voiceSetters = activeRows.filter(r => r.category === 'voice_setter').length;

        // OpenRouter balance from cache
        const cached: any = (orCacheRes.data as any)?.cached_data;
        const remaining = cached?.credits?.remaining;
        const balance = typeof remaining === 'number' ? Math.round(remaining) : null;

        if (cancelled) return;
        setStats({
          totalLeads: leadsRes.count ?? 0,
          unreadChats: unread,
          textSetters,
          voiceSetters,
          activeCampaigns: campaignsRes.count ?? 0,
          openrouterBalance: balance,
          outboundCalls: callsRes.count ?? 0,
        });
      } catch (err) {
        console.error('[useTickerStats] error:', err);
      }
    };

    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [clientId, isAgency]);

  return stats;
}
