import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// F15 — per-sub-account ROI report / visibility config, kept in the dedicated
// client_report_config table (NOT client_pricing_config, whose F13 editor
// overwrites its whole jsonb on save). Agency-only writes (agency-role-gated
// RLS). The edge fns + weekly cron read it as service role.

export interface ReportSections {
  calls: boolean;
  sms: boolean;
  funnel: boolean;
  usage: boolean;
  objections: boolean;
  improvements: boolean;
}

export interface ReportConfig {
  show_funnel_to_client: boolean;
  show_report_to_client: boolean;
  sections: ReportSections;
  what_we_improved: string[];
  recipient_email: string;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  show_funnel_to_client: false,
  show_report_to_client: false,
  sections: { calls: true, sms: true, funnel: true, usage: false, objections: true, improvements: true },
  what_we_improved: [],
  recipient_email: '',
};

function merge(saved: Partial<ReportConfig> | null | undefined): ReportConfig {
  const d = DEFAULT_REPORT_CONFIG;
  const s = saved ?? {};
  return {
    show_funnel_to_client: s.show_funnel_to_client ?? d.show_funnel_to_client,
    show_report_to_client: s.show_report_to_client ?? d.show_report_to_client,
    sections: { ...d.sections, ...(s.sections ?? {}) },
    what_we_improved: Array.isArray(s.what_we_improved) ? s.what_we_improved.filter((x) => typeof x === 'string') : d.what_we_improved,
    recipient_email: typeof s.recipient_email === 'string' ? s.recipient_email : d.recipient_email,
  };
}

export function useClientReportConfig(clientId: string | undefined) {
  const [config, setConfig] = useState<ReportConfig>(DEFAULT_REPORT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('client_report_config')
        .select('config')
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      setConfig(merge((data?.config as Partial<ReportConfig> | null) ?? null));
    } catch (err) {
      console.error('Error fetching report config:', err);
      setConfig(DEFAULT_REPORT_CONFIG);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const saveConfig = useCallback(async (next: ReportConfig) => {
    if (!clientId) return false;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('client_report_config')
        .upsert({ client_id: clientId, config: next, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
      if (error) throw error;
      setConfig(next);
      return true;
    } catch (err) {
      console.error('Error saving report config:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [clientId]);

  return { config, loading, saving, saveConfig, refetch: fetchConfig };
}
