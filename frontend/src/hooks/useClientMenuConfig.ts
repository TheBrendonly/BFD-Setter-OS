import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';

export interface MenuItemConfig {
  key: string;
  label: string;
  visible: boolean;
  position: number;
  locked?: boolean;
  type: 'item' | 'divider' | 'section-label';
  icon?: string;
}

// All possible menu items in the sidebar, in default order
export const DEFAULT_MENU_ITEMS: MenuItemConfig[] = [
  { key: 'section-main', label: 'MAIN', visible: true, position: 0, locked: true, type: 'section-label' },
  { key: 'analytics', label: 'Analytics', visible: true, position: 1, type: 'item', icon: '▤' },
  // analytics-voice merged into analytics (single sidebar item with internal Text/Voice tabs in ChatAnalytics.tsx).
  // Kept in MENU_ROUTE_MAP for backward-compat with saved configs that still reference it.
  { key: 'analytics-voice', label: 'Voice Analytics (legacy)', visible: false, position: 2, type: 'item', icon: '▥' },
  // analytics-v2 hidden from default sidebar — experimental metric builder, kept for saved configs that explicitly enabled it.
  { key: 'analytics-v2', label: 'Analytics v2', visible: false, position: 3, type: 'item', icon: '▦' },
  { key: 'contacts', label: 'Leads', visible: true, position: 4, type: 'item', icon: '◇' },
  { key: 'chats', label: 'Conversations', visible: true, position: 5, type: 'item', icon: '✉' },
  { key: 'section-config', label: 'CONFIG', visible: true, position: 6, locked: true, type: 'section-label' },
  { key: 'credentials', label: 'Credentials', visible: true, position: 7, type: 'item', icon: '⚷' },
  { key: 'text-setter', label: 'Text Setter', visible: true, position: 8, type: 'item', icon: '░' },
  { key: 'voice-setter', label: 'Voice Setter', visible: true, position: 9, type: 'item', icon: '♫' },
  { key: 'knowledgebase', label: 'Knowledge Base', visible: true, position: 10, type: 'item', icon: '⚹' },
  { key: 'section-ops', label: 'OPS', visible: true, position: 11, locked: true, type: 'section-label' },
  { key: 'simulator', label: 'Simulator', visible: true, position: 12, type: 'item', icon: '⚔' },
  { key: 'workflows', label: 'Campaigns', visible: true, position: 13, type: 'item', icon: '⛓' },
  // Engagement page is a full workflow editor at /workflows/engagement but it's
  // also reachable from the Workflows (Campaigns) list. Hiding from sidebar to
  // reduce nav clutter; direct URL + Workflows entry still surface it.
  { key: 'engagement', label: 'Engagement', visible: false, position: 14, type: 'item', icon: '◈' },
  { key: 'leads-files', label: 'Lead Files', visible: true, position: 15, type: 'item', icon: '▣' },
  { key: 'logs', label: 'Logs', visible: true, position: 16, type: 'item', icon: '⚡' },
  // TEMPLATES section + 2 items hidden — Source Files (P26 "Source Files" in
  // BACKEND section) already covers Retell + n8n + Supabase template downloads
  // as a unified reference library. Voice/Text AI Rep Templates pages remain
  // accessible via direct URL (/voice-ai-rep/templates, /text-ai-rep/templates)
  // for now; consider merging their content into Source Files later (D-future).
  { key: 'section-templates', label: 'TEMPLATES', visible: false, position: 17, locked: true, type: 'section-label' },
  { key: 'voice-rep-templates', label: 'Voice AI Rep Templates', visible: false, position: 18, type: 'item', icon: '♫' },
  { key: 'text-rep-templates', label: 'Text AI Rep Templates', visible: false, position: 19, type: 'item', icon: '░' },
  { key: 'section-debug', label: 'BACKEND', visible: true, position: 20, locked: true, type: 'section-label' },
  { key: 'openrouter-usage', label: 'OpenRouter Usage', visible: true, position: 21, type: 'item', icon: '□' },
  { key: 'supabase-usage', label: 'Supabase Usage', visible: true, position: 22, type: 'item', icon: '⛁' },
  { key: 'templates', label: 'Source Files', visible: true, position: 23, type: 'item', icon: '⌐' },
  { key: 'demo-pages', label: 'Work Pages', visible: false, position: 24, type: 'item', icon: '⊞' },
];

// Map menu keys to their routes (relative to /client/:clientId)
export const MENU_ROUTE_MAP: Record<string, string> = {
  'analytics': '/analytics/chatbot/dashboard',
  'analytics-voice': '/analytics/voice-ai/dashboard',
  'analytics-v2': '/analytics-v2',
  'contacts': '/leads',
  'chats': '/chats',
  'credentials': '/credentials',
  'text-setter': '/prompts/text',
  'voice-setter': '/prompts/voice',
  'simulator': '/simulator',
  'knowledgebase': '/knowledge-base',
  'db-reactivation': '/campaigns',
  'logs': '/logs',
  'leads-files': '/leads/files',
  'openrouter-usage': '/usage-credits',
  'supabase-usage': '/supabase-usage',
  'templates': '/templates',
  'workflows': '/workflows',
  'calendar': '/calendar',
  'email': '/email',
  'engagement': '/workflows/engagement',
  'demo-pages': '/demo-pages',
  'voice-rep-templates': '/voice-ai-rep/templates',
  'text-rep-templates': '/text-ai-rep/templates',
};

export function useClientMenuConfig(clientId: string | undefined) {
  const [menuConfig, setMenuConfig] = useState<MenuItemConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!clientId) return;
    const cacheKey = `menu_config_${clientId}`;
    const cached = getCached<MenuItemConfig[]>(cacheKey);
    if (cached) {
      setMenuConfig(cached);
      setLoading(false);
    }
    try {
      const { data, error } = await (supabase as any)
        .from('client_menu_config')
        .select('menu_items')
        .eq('client_id', clientId)
        .maybeSingle();

      if (error) throw error;

      if (data?.menu_items) {
        // Merge saved config with defaults to handle new items added later
        const saved = data.menu_items as MenuItemConfig[];
        const savedKeys = new Set(saved.map(i => i.key));
        const merged = [...saved];
        // Add any new default items not in saved config
        for (const def of DEFAULT_MENU_ITEMS) {
          if (!savedKeys.has(def.key)) {
            merged.push({ ...def, position: merged.length });
          }
        }
        // Re-apply locked status and type from defaults, but preserve custom
        // label/icon/visibility. `locked` means "cannot be reordered/renamed";
        // it does NOT mean "must be visible" — section-templates is locked AND
        // intentionally hidden by default, so forcing visible:true here would
        // override the saved visible:false. Bug-fixed 2026-05-20 in
        // phase-night-sidebar-agency-respects-visible-flag.
        for (const item of merged) {
          const def = DEFAULT_MENU_ITEMS.find(d => d.key === item.key);
          if (def?.locked) {
            item.locked = true;
          }
          if (def) {
            item.type = def.type;
            // Only set label/icon from defaults if not customized (i.e. still matches default)
            if (!item.label) item.label = def.label;
            if (!item.icon && def.icon) item.icon = def.icon;
          }
        }
        const sorted = merged.sort((a, b) => a.position - b.position);
        setMenuConfig(sorted);
        setCache(cacheKey, sorted);
      } else {
        setMenuConfig(null);
      }
    } catch (err) {
      console.error('Error fetching menu config:', err);
      setMenuConfig(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = useCallback(async (items: MenuItemConfig[]) => {
    if (!clientId) return;
    setSaving(true);
    try {
      const itemsWithPosition = items.map((item, idx) => ({
        ...item,
        position: idx,
      }));

      const { error } = await (supabase as any)
        .from('client_menu_config')
        .upsert({
          client_id: clientId,
          menu_items: itemsWithPosition,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' });

      if (error) throw error;
      setMenuConfig(itemsWithPosition);
      return true;
    } catch (err) {
      console.error('Error saving menu config:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [clientId]);

  return {
    menuConfig,
    loading,
    saving,
    saveConfig,
    refetch: fetchConfig,
  };
}
