import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, subDays } from 'date-fns';
import RetroLoader from '@/components/RetroLoader';
import SavingOverlay from '@/components/SavingOverlay';
import { defaultCampaignWidgets } from '@/lib/campaignWidgets';
import { CampaignDashboardGrid } from '@/components/campaign/CampaignDashboardGrid';
import { CampaignWidgetEditPopover } from '@/components/campaign/CampaignWidgetEditPopover';
import { CampaignAddMetricMenu } from '@/components/campaign/CampaignAddMetricMenu';
import { getNextDashboardWidgetSlot, toNormalizedDashboardWidgets } from '@/components/campaign/dashboardGrid';
import { RefreshCw, BarChart3, RotateCcw } from '@/components/icons';
import { toast } from 'sonner';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;

const DATE_PRESETS = [
  { label: 'Last 24h', days: 1 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 14 Days', days: 14 },
  { label: 'Last 30 Days', days: 30 },
  { label: 'Last 90 Days', days: 90 },
  { label: 'All Time', days: 0 },
];

interface DashboardWidget {
  id: string;
  title: string;
  friendly_name?: string;
  widget_type: string;
  width?: string;
  config: any;
  sort_order: number;
  color?: string;
}

interface CampaignDashboardProps {
  workflowId: string;
  onHeaderActions?: (actions: ReactNode) => void;
}

const dataCache = new Map<string, { stats: any; widgets: DashboardWidget[] }>();

export function CampaignDashboard({ workflowId, onHeaderActions }: CampaignDashboardProps) {
  const { clientId } = useParams<{ clientId: string }>();
  const initialCache = dataCache.get(`${workflowId}:0`);
  const [stats, setStats] = useState<any>(initialCache?.stats ?? null);
  const [widgets, setWidgets] = useState<DashboardWidget[]>(initialCache?.widgets ? toNormalizedDashboardWidgets(initialCache.widgets) : []);
  const [loading, setLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [datePreset, setDatePreset] = useState('0');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  
  const [editWidget, setEditWidget] = useState<DashboardWidget | null>(null);
  const [deleteWidget, setDeleteWidget] = useState<DashboardWidget | null>(null);
  const statsRef = useRef<string>('');
  const normalizeWidgets = useCallback((items: DashboardWidget[]) => toNormalizedDashboardWidgets(items), []);

  const updateLocalWidgets = useCallback((nextWidgets: DashboardWidget[]) => {
    const normalizedWidgets = normalizeWidgets(nextWidgets);
    const cacheKey = `${workflowId}:${datePreset}`;
    const cachedStats = dataCache.get(cacheKey)?.stats ?? stats;

    setWidgets(normalizedWidgets);
    dataCache.set(cacheKey, { stats: cachedStats, widgets: normalizedWidgets });

    return normalizedWidgets;
  }, [datePreset, normalizeWidgets, stats, workflowId]);

  const fetchData = useCallback(async ({ silent = false, updateWidgets = !silent }: { silent?: boolean; updateWidgets?: boolean } = {}) => {
    if (!workflowId || !clientId) return;

    const cacheKey = `${workflowId}:${datePreset}`;
    if (!silent) {
      const cached = dataCache.get(cacheKey);
      if (cached) {
        setStats(cached.stats);
        setWidgets(cached.widgets);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      // get-campaign-stats authorizes the caller by their user JWT, not the anon
      // key; sending the anon key returns 401 and the dashboard renders all zeros.
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? anonKey;

      let statsUrl = `${supabaseUrl}/functions/v1/get-campaign-stats?workflow_id=${workflowId}`;
      const days = parseInt(datePreset);
      if (days > 0) {
        const dateFrom = format(subDays(new Date(), days), 'yyyy-MM-dd') + 'T00:00:00';
        const dateTo = format(new Date(), 'yyyy-MM-dd') + 'T23:59:59';
        statsUrl += `&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`;
      }

      const [statsResponse, campaignsRes] = await Promise.all([
        fetch(statsUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey },
        }),
        (supabase as any).from('engagement_campaigns').select('id').eq('workflow_id', workflowId),
      ]);

      const statsRes = await statsResponse.json();
      const cIds = (campaignsRes.data || []).map((c: any) => c.id);
      setCampaignIds(cIds);

      let widgetData: DashboardWidget[] = [];
      let hasPersistedWidgets = false;
      if (cIds.length > 0) {
        const { count } = await (supabase as any)
          .from('dashboard_widgets')
          .select('id', { count: 'exact', head: true })
          .in('campaign_id', cIds)
          .eq('analytics_type', 'engagement_campaign')
          .eq('is_active', true);
        hasPersistedWidgets = (count ?? 0) > 0;

        if (hasPersistedWidgets) {
          const { data } = await (supabase as any)
            .from('dashboard_widgets')
            .select('id, title, friendly_name, widget_type, width, config, sort_order')
            .in('campaign_id', cIds)
            .eq('analytics_type', 'engagement_campaign')
            .eq('is_active', true)
            .order('sort_order');
          widgetData = (data || []).map((w: any) => {
            const def = defaultCampaignWidgets.find(d => d.title === w.title);
            return { ...w, color: w.config?.color || def?.color || '#3b82f6' };
          });
        }
      }

      if (!hasPersistedWidgets && widgetData.length === 0) {
        widgetData = defaultCampaignWidgets.map((w, i) => ({
          id: `default-${i}`,
          title: w.title,
          widget_type: w.widget_type,
          width: w.width,
          config: w.config,
          sort_order: w.sort_order,
          color: w.color,
        }));
      }

      const normalizedWidgetData = normalizeWidgets(widgetData);
      const newStatsStr = JSON.stringify(statsRes);
      if (newStatsStr !== statsRef.current) {
        statsRef.current = newStatsStr;
        setStats(statsRes);
      }

      dataCache.set(cacheKey, { stats: statsRes, widgets: normalizedWidgetData });
      if (updateWidgets) setWidgets(normalizedWidgetData);
    } catch (err) {
      console.error('Failed to fetch campaign stats:', err);
    }
    if (!silent) setLoading(false);
  }, [workflowId, clientId, datePreset, normalizeWidgets]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (campaignIds.length === 0) return;

    const channel = supabase
      .channel(`campaign-events-${workflowId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'campaign_events',
      }, (payload) => {
        if (campaignIds.includes(payload.new?.campaign_id)) {
          setTimeout(() => fetchData({ silent: true }), 1500);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [campaignIds, workflowId, fetchData]);

  const formatSmartDuration = (minutes: number): string => {
    if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
    if (minutes < 60) return `${Math.round(minutes)} min`;
    if (minutes < 1440) {
      const hours = Math.floor(minutes / 60);
      const remainingMins = Math.round(minutes % 60);
      return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
    }
    const days = Math.floor(minutes / 1440);
    const remainingHours = Math.round((minutes % 1440) / 60);
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  };

  const getStatValue = (widget: DashboardWidget): string | number => {
    const key = widget.config?.stat_key;
    if (!key || !stats) return 'N/A';
    const val = stats[key];
    if (val === null || val === undefined) return widget.config?.null_label || 'N/A';
    if (key === 'avg_first_engagement_minutes' || key === 'avg_response_minutes') {
      return formatSmartDuration(val as number);
    }
    const prefix = widget.config?.prefix || '';
    const suffix = widget.config?.suffix || '';
    return `${prefix}${val}${suffix}`;
  };

  const getChartData = (widget: DashboardWidget): any => {
    const key = widget.config?.chart_key;
    if (!key || !stats) return null;
    return stats[key];
  };

  const handleReorderWidgets = async (nextWidgets: DashboardWidget[]) => {
    const previousWidgets = widgets;
    const updatedWidgets = updateLocalWidgets(nextWidgets);

    const changedWidgets = updatedWidgets.filter(
      (widget) =>
        !widget.id.startsWith('default-') &&
        widget.sort_order !== previousWidgets.find((previousWidget) => previousWidget.id === widget.id)?.sort_order
    );

    if (changedWidgets.length === 0) return;

    try {
      await Promise.all(
        changedWidgets.map(async (widget) => {
          const { error } = await (supabase as any)
            .from('dashboard_widgets')
            .update({ sort_order: widget.sort_order })
            .eq('id', widget.id);

          if (error) throw error;
        })
      );
    } catch (err) {
      console.error('Failed to save widget order:', err);
      updateLocalWidgets(previousWidgets);
      toast.error('Failed to save widget order');
    }
  };

  const handleUpdateWidget = async (widgetId: string, newTitle: string, newColor: string) => {
    updateLocalWidgets(
      widgets.map((widget) => {
        if (widget.id !== widgetId) return widget;
        return {
          ...widget,
          friendly_name: newTitle,
          color: newColor,
          config: { ...widget.config, color: newColor },
        };
      })
    );

    if (!widgetId.startsWith('default-')) {
      const widget = widgets.find(w => w.id === widgetId);
      const updatedConfig = { ...(widget?.config || {}), color: newColor };
      await (supabase as any)
        .from('dashboard_widgets')
        .update({ friendly_name: newTitle, config: updatedConfig })
        .eq('id', widgetId);
    }
    toast.success('Widget updated');
  };

  const handleDeleteWidget = async (widgetId: string) => {
    updateLocalWidgets(widgets.filter((widget) => widget.id !== widgetId));

    if (!widgetId.startsWith('default-')) {
      await (supabase as any)
        .from('dashboard_widgets')
        .update({ is_active: false })
        .eq('id', widgetId);
    }
    toast.success('Widget removed');
  };

  const handleRenameSeparator = async (widgetId: string, newName: string) => {
    updateLocalWidgets(
      widgets.map((widget) => (widget.id === widgetId ? { ...widget, friendly_name: newName } : widget))
    );

    if (!widgetId.startsWith('default-')) {
      await (supabase as any)
        .from('dashboard_widgets')
        .update({ friendly_name: newName })
        .eq('id', widgetId);
    }
    toast.success('Section renamed');
  };

  const handleResetToDefault = async () => {
    if (campaignIds.length === 0) {
      toast.error('No campaign found');
      return;
    }

    setResetting(true);
    try {
      await (supabase as any)
        .from('dashboard_widgets')
        .update({ is_active: false })
        .in('campaign_id', campaignIds)
        .eq('analytics_type', 'engagement_campaign');

      const { insertDefaultCampaignWidgets } = await import('@/lib/campaignWidgets');
      await insertDefaultCampaignWidgets(clientId!, campaignIds[0]);

      const { count: activeWidgetCount, error: activeWidgetCountError } = await (supabase as any)
        .from('dashboard_widgets')
        .select('id', { count: 'exact', head: true })
        .in('campaign_id', campaignIds)
        .eq('analytics_type', 'engagement_campaign')
        .eq('is_active', true);

      if (activeWidgetCountError) throw activeWidgetCountError;
      if ((activeWidgetCount ?? 0) === 0) {
        throw new Error('Default campaign widgets were not restored');
      }

      // Clear cache so fetchData doesn't serve stale widgets
      dataCache.clear();

      await fetchData({ silent: true, updateWidgets: true });
      toast.success('Dashboard reset to default layout');
    } catch (err) {
      console.error('Failed to reset dashboard:', err);
      toast.error('Failed to reset dashboard');
    } finally {
      setResetting(false);
    }
  };

  const handleAddWidget = async (widgetDef: typeof defaultCampaignWidgets[0]) => {
    if (campaignIds.length === 0) {
      toast.error('No campaign found');
      return;
    }

    const nextSortOrder = getNextDashboardWidgetSlot(widgets);

    const { color, ...dbFields } = widgetDef;
    const { data, error } = await (supabase as any)
      .from('dashboard_widgets')
      .insert({
        ...dbFields,
        client_id: clientId,
        campaign_id: campaignIds[0],
        is_active: true,
        sort_order: nextSortOrder,
      })
      .select('id, title, friendly_name, widget_type, width, config, sort_order')
      .single();

    if (error) {
      console.error('Failed to add widget:', error);
      toast.error('Failed to add widget');
      return;
    }

    updateLocalWidgets([...widgets, { ...data, color: color || '#3b82f6' }]);
    toast.success(`Added "${widgetDef.title}"`);
  };

  const activeWidgetTitles = widgets.map(w => w.title);

  // Push header actions to parent
  useEffect(() => {
    if (!onHeaderActions || loading || !stats) {
      onHeaderActions?.(null);
      return;
    }
    onHeaderActions(
      <>
        <CampaignAddMetricMenu
          activeWidgetTitles={activeWidgetTitles}
          onAddWidget={handleAddWidget}
        />
        <Button
          onClick={() => setShowResetConfirm(true)}
          size="sm"
          variant="outline"
          className="!h-8"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          DEFAULT LAYOUT
        </Button>
      </>
    );
    return () => onHeaderActions(null);
  }, [onHeaderActions, loading, stats, activeWidgetTitles.join(','), showResetConfirm, handleAddWidget]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RetroLoader />
      </div>
    );
  }

  if (!stats) return (
    <div className="flex-1 flex flex-col items-center justify-center text-center min-h-[60vh]">
      <BarChart3 className="w-12 h-12 text-primary mb-4" />
      <h3 className="text-lg font-medium">No data available</h3>
      <p className="text-sm text-muted-foreground mt-1">
        Analytics will appear here once engagement data is recorded.
      </p>
    </div>
  );


  return (
    <div className="space-y-6">
      <SavingOverlay isVisible={resetting} message="Resetting layout..." variant="fixed" />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          onClick={async () => {
            setRefreshing(true);
            await fetchData();
            setRefreshing(false);
            toast.success('Dashboard refreshed');
          }}
          disabled={refreshing}
          size="sm"
          className="!h-8"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          REFRESH
        </Button>
        <Select value={datePreset} onValueChange={setDatePreset}>
          <SelectTrigger className="w-[160px] h-8" style={{ ...FONT, fontWeight: 400 }}>
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent
            className="bg-sidebar border border-border"
            style={{ ...FONT, borderStyle: 'solid', boxShadow: 'none' }}
          >
            {DATE_PRESETS.map(p => (
              <SelectItem key={p.days} value={String(p.days)} style={FONT}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center" style={{ minHeight: 'calc(100vh - 240px)' }}>
          <BarChart3 className="w-12 h-12 text-primary mb-4" />
          <h3 className="text-lg font-medium">No metrics</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Use the <span className="text-foreground font-medium">+ Add Metric</span> button to build your dashboard.
          </p>
        </div>
      ) : (
      <CampaignDashboardGrid
        widgets={widgets}
        getStatValue={getStatValue}
        getChartData={getChartData}
        onEditWidget={setEditWidget}
        onRenameSeparator={handleRenameSeparator}
        onDeleteSeparator={(widgetId) => {
          const w = widgets.find((x) => x.id === widgetId);
          if (w) setDeleteWidget(w);
        }}
        onReorder={handleReorderWidgets}
      />
      )}

      {editWidget && (
        <CampaignWidgetEditPopover
          title={editWidget.friendly_name || editWidget.title}
          internalName={editWidget.title}
          color={editWidget.color || '#3b82f6'}
          onUpdate={(t, c) => { handleUpdateWidget(editWidget.id, t, c); setEditWidget(null); }}
          onDelete={() => { setDeleteWidget(editWidget); setEditWidget(null); }}
          openExternal={!!editWidget}
          onCloseExternal={() => setEditWidget(null)}
        />
      )}

      <DeleteConfirmDialog
        open={!!deleteWidget}
        onOpenChange={(open) => { if (!open) setDeleteWidget(null); }}
        title={deleteWidget?.widget_type === 'separator' ? 'Delete Divider' : 'Delete Widget'}
        description={deleteWidget?.widget_type === 'separator'
          ? `Are you sure you want to remove the "${deleteWidget?.friendly_name || deleteWidget?.title}" divider from your dashboard?`
          : `Are you sure you want to remove "${deleteWidget?.friendly_name || deleteWidget?.title}" from your dashboard? You can add it back later from the Add Metric menu.`}
        onConfirm={() => {
          if (deleteWidget) {
            handleDeleteWidget(deleteWidget.id);
            setDeleteWidget(null);
          }
        }}
      />

      <DeleteConfirmDialog
        open={showResetConfirm}
        onOpenChange={setShowResetConfirm}
        title="Reset to Default Layout"
        description="Are you sure you want to reset the dashboard to its default layout? All customizations (reordering, renaming, deletions) will be lost."
        confirmLabel="Reset"
        confirmIcon={<RotateCcw className="w-4 h-4 mr-2" />}
        onConfirm={() => {
          setShowResetConfirm(false);
          handleResetToDefault();
        }}
      />
    </div>
  );
}
