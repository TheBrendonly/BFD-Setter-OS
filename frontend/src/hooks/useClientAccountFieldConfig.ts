import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';

// Per-field governance over the client-facing "My Account" sub-account settings.
// Mirrors the client_menu_config pattern (useClientMenuConfig.ts).
//
// IMPORTANT: the KEY list here is the contract with the server. It MUST match
// FIELD_CATALOG in frontend/supabase/functions/save-account-settings/index.ts —
// a key the UI offers that the server doesn't map (or vice-versa) is a silent
// no-op. Keep both lists in sync.

export interface AccountFieldConfig {
  key: string;
  visible: boolean;
  editable: boolean;
}

export interface AccountFieldMeta {
  key: string;
  label: string;
  description?: string;
}

// Display metadata for the admin governance editor + the client My Account page.
export const ACCOUNT_FIELD_CATALOG: AccountFieldMeta[] = [
  { key: 'name', label: 'Sub-account name', description: 'The display name for this sub-account.' },
  { key: 'email', label: 'Contact email', description: 'Sub-account contact email.' },
  { key: 'description', label: 'Description', description: 'Free-text notes about this sub-account.' },
  { key: 'brand_voice', label: 'Brand voice', description: 'Tone and style notes the AI uses when generating copy.' },
  { key: 'timezone', label: 'Timezone', description: 'Used for booking times and cadence scheduling.' },
  { key: 'logo', label: 'Logo', description: 'Sub-account logo image.' },
  { key: 'quiet_hours', label: 'Contact hours', description: 'When the cadence is allowed to contact leads.' },
  { key: 'voicemail', label: 'Voicemail', description: 'Voicemail detection + behaviour. Saving pushes to Retell.' },
  { key: 'weekly_cost_ceiling', label: 'Weekly cost ceiling', description: 'Agency spend guardrail (weekly).' },
  { key: 'monthly_cost_ceiling', label: 'Monthly cost ceiling', description: 'Agency spend guardrail (monthly).' },
];

// Default split: "Branding + prefs". MUST mirror DEFAULT_ACCOUNT_FIELDS in the
// save-account-settings edge function.
export const DEFAULT_ACCOUNT_FIELDS: AccountFieldConfig[] = [
  { key: 'email', visible: true, editable: true },
  { key: 'description', visible: true, editable: true },
  { key: 'brand_voice', visible: true, editable: true },
  { key: 'timezone', visible: true, editable: true },
  { key: 'logo', visible: true, editable: true },
  { key: 'quiet_hours', visible: true, editable: true },
  { key: 'name', visible: true, editable: false },
  { key: 'voicemail', visible: true, editable: false },
  { key: 'weekly_cost_ceiling', visible: false, editable: false },
  { key: 'monthly_cost_ceiling', visible: false, editable: false },
];

// Merge saved governance with defaults, in catalog order. A hidden field can
// never be editable.
function mergeWithDefaults(saved: AccountFieldConfig[] | null): AccountFieldConfig[] {
  const savedByKey = new Map((saved ?? []).map((f) => [f.key, f]));
  const defByKey = new Map(DEFAULT_ACCOUNT_FIELDS.map((f) => [f.key, f]));
  return ACCOUNT_FIELD_CATALOG.map(({ key }) => {
    const base = savedByKey.get(key) ?? defByKey.get(key) ?? { key, visible: true, editable: false };
    const visible = typeof base.visible === 'boolean' ? base.visible : true;
    const editable = visible && typeof base.editable === 'boolean' ? base.editable : false;
    return { key, visible, editable };
  });
}

export function useClientAccountFieldConfig(clientId: string | undefined) {
  const [fieldConfig, setFieldConfig] = useState<AccountFieldConfig[]>(DEFAULT_ACCOUNT_FIELDS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!clientId) return;
    const cacheKey = `account_field_config_${clientId}`;
    const cached = getCached<AccountFieldConfig[]>(cacheKey);
    if (cached) {
      setFieldConfig(cached);
      setLoading(false);
    }
    try {
      const { data, error } = await (supabase as any)
        .from('client_account_field_config')
        .select('fields')
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      const merged = mergeWithDefaults((data?.fields as AccountFieldConfig[]) ?? null);
      setFieldConfig(merged);
      setCache(cacheKey, merged);
    } catch (err) {
      console.error('Error fetching account field config:', err);
      setFieldConfig(mergeWithDefaults(null));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = useCallback(async (fields: AccountFieldConfig[]) => {
    if (!clientId) return false;
    setSaving(true);
    try {
      // Enforce the invariant before persisting.
      const normalized = fields.map((f) => ({
        key: f.key,
        visible: f.visible,
        editable: f.visible && f.editable,
      }));
      const { error } = await (supabase as any)
        .from('client_account_field_config')
        .upsert({
          client_id: clientId,
          fields: normalized,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' });
      if (error) throw error;
      setFieldConfig(normalized);
      return true;
    } catch (err) {
      console.error('Error saving account field config:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [clientId]);

  return { fieldConfig, loading, saving, saveConfig, refetch: fetchConfig };
}
