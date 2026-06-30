import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';
import { DEFAULT_PRICING_CONFIG, mergeWithDefaults, type PricingConfig } from '@/lib/blendedRate';

// F8 — per-sub-account cost-to-price config. Agency-only: the agency JWT writes
// client_pricing_config directly (the agency FOR ALL RLS permits it; there is no
// edge fn on the write path, mirroring useClientAccountFieldConfig). Clients NEVER
// read this table — they get the derived blended $/min from get-blended-rate.
export function useClientPricingConfig(clientId: string | undefined) {
  const [config, setConfig] = useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!clientId) return;
    const cacheKey = `pricing_config_${clientId}`;
    const cached = getCached<PricingConfig>(cacheKey);
    if (cached) {
      setConfig(cached);
      setLoading(false);
    }
    try {
      const { data, error } = await (supabase as any)
        .from('client_pricing_config')
        .select('config')
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      const merged = mergeWithDefaults((data?.config as PricingConfig) ?? null);
      setConfig(merged);
      setCache(cacheKey, merged);
    } catch (err) {
      console.error('Error fetching pricing config:', err);
      setConfig(mergeWithDefaults(null));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = useCallback(async (next: PricingConfig) => {
    if (!clientId) return false;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('client_pricing_config')
        .upsert({
          client_id: clientId,
          config: next,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' });
      if (error) throw error;
      setConfig(next);
      return true;
    } catch (err) {
      console.error('Error saving pricing config:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [clientId]);

  return { config, loading, saving, saveConfig, refetch: fetchConfig };
}
