import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Plus, Loader2, AlertTriangle } from '@/components/icons';
import { format, subDays } from 'date-fns';
import { CreateMetricDialog } from '@/components/analytics-v2/CreateMetricDialog';
import { V2WidgetRenderer, type V2WidgetData } from '@/components/analytics-v2/V2WidgetRenderer';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import RetroLoader from '@/components/RetroLoader';

const AVAILABLE_MODELS = [
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
];

const DATE_PRESETS = [
  { label: 'Last 24h', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export default function AnalyticsV2() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  usePageHeader({
    title: 'Analytics V2',
    breadcrumbs: [{ label: 'Dashboard' }],
  });

  // State
  const [widgets, setWidgets] = useState<V2WidgetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [processingWidgets, setProcessingWidgets] = useState<Set<string>>(new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteWidgetId, setDeleteWidgetId] = useState<string | null>(null);

  // Controls
  const [selectedModel, setSelectedModel] = useState('google/gemini-2.5-pro');
  const [datePreset, setDatePreset] = useState('7');
  const [dateFrom, setDateFrom] = useState<Date>(subDays(new Date(), 7));
  const [dateTo, setDateTo] = useState<Date>(new Date());

  // Client config
  // G3-6: presence-only — no secret value reaches the browser.
  const [hasOpenrouterKey, setHasOpenrouterKey] = useState<boolean>(false);
  const [hasSupabaseConfig, setHasSupabaseConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Fetch client config
  useEffect(() => {
    if (!clientId) return;
    const fetchConfig = async () => {
      const { data } = await supabase
        .from('clients_public')
        .select('has_openrouter_api_key, supabase_url, has_supabase_service_key, supabase_table_name')
        .eq('id', clientId)
        .single();
      if (data) {
        setHasOpenrouterKey(!!data.has_openrouter_api_key);
        setHasSupabaseConfig(!!(data.supabase_url && data.has_supabase_service_key));
      }
      setConfigLoaded(true);
    };
    fetchConfig();
  }, [clientId]);

  // Fetch widgets
  const fetchWidgets = useCallback(async () => {
    if (!clientId) return;
    const cacheKey = `analytics_v2_widgets_${clientId}`;
    const cached = getCached<V2WidgetData[]>(cacheKey);
    if (cached) {
      setWidgets(cached);
      setLoading(false);
    }
    const { data, error } = await supabase
      .from('dashboard_widgets')
      .select('*')
      .eq('client_id', clientId)
      .eq('analytics_type', 'v2')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (!error && data) {
      const mapped = data.map(w => ({
        id: w.id,
        title: w.title,
        widget_type: w.widget_type,
        width: w.width || 'half',
        config: (w.config as any) || {},
      }));
      setWidgets(mapped);
      setCache(cacheKey, mapped);
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetchWidgets(); }, [fetchWidgets]);

  // Handle date preset change
  const handlePresetChange = (val: string) => {
    setDatePreset(val);
    if (val !== 'custom') {
      const days = parseInt(val);
      setDateFrom(subDays(new Date(), days));
      setDateTo(new Date());
    }
  };

  // Refresh all widgets
  const handleRefresh = async () => {
    if (!clientId || widgets.length === 0) return;

    if (!hasSupabaseConfig) {
      toast({ title: 'Missing Configuration', description: 'Please configure Supabase credentials on the Credentials page.', variant: 'destructive' });
      return;
    }

    if (!hasOpenrouterKey) {
      toast({ title: 'Missing API Key', description: 'Please configure OpenRouter API key on the Credentials page.', variant: 'destructive' });
      return;
    }

    setIsRefreshing(true);
    const allIds = new Set(widgets.map(w => w.id));
    setProcessingWidgets(allIds);

    try {
      const widgetRequests = widgets.map(w => ({
        id: w.id,
        name: w.title,
        prompt: w.config.prompt,
        widget_type: w.widget_type,
      }));

      const { data, error } = await supabase.functions.invoke('analytics-v2-process', {
        body: {
          client_id: clientId,
          widgets: widgetRequests,
          date_from: format(dateFrom, 'yyyy-MM-dd') + 'T00:00:00',
          date_to: format(dateTo, 'yyyy-MM-dd') + 'T23:59:59',
          model: selectedModel,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const results = data?.results || {};
      const totalConversations = data?.total_conversations || 0;
      const totalMessages = data?.total_messages || 0;

      // Update widgets with results
      const updatedWidgets = widgets.map(w => {
        const result = results[w.id];
        if (!result) return w;

        const updatedConfig = {
          ...w.config,
          chart_data: result.chart_data,
          last_processed: new Date().toISOString(),
          model_used: selectedModel,
          error: result.error || undefined,
        };

        // Also update widget type if overridden (fallback to text)
        const updatedType = result.widget_type_override || w.widget_type;

        return { ...w, config: updatedConfig, widget_type: updatedType };
      });

      setWidgets(updatedWidgets);

      // Persist chart data to DB
      for (const w of updatedWidgets) {
        await supabase
          .from('dashboard_widgets')
          .update({ config: w.config as any, widget_type: w.widget_type })
          .eq('id', w.id);
      }

      const errorCount = Object.values(results).filter((r: any) => r.error && !r.chart_data).length;
      if (errorCount > 0) {
        toast({ title: 'Partial Success', description: `${widgets.length - errorCount}/${widgets.length} metrics processed. ${errorCount} had errors.`, variant: 'destructive' });
      } else {
        toast({ title: 'Refresh Complete', description: `Analyzed ${totalConversations} conversations (${totalMessages} messages) across ${widgets.length} metrics.` });
      }
    } catch (e: any) {
      console.error('Refresh error:', e);
      toast({ title: 'Refresh Failed', description: e.message || 'Failed to process metrics', variant: 'destructive' });
    } finally {
      setIsRefreshing(false);
      setProcessingWidgets(new Set());
    }
  };

  // Delete widget
  const handleDelete = async () => {
    if (!deleteWidgetId) return;
    await supabase.from('dashboard_widgets').update({ is_active: false }).eq('id', deleteWidgetId);
    setWidgets(prev => prev.filter(w => w.id !== deleteWidgetId));
    setDeleteWidgetId(null);
    toast({ title: 'Metric deleted' });
  };

  // Toggle widget width
  const handleToggleWidth = async (widgetId: string) => {
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget) return;
    const newWidth = widget.width === 'full' ? 'half' : 'full';
    setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, width: newWidth } : w));
    await supabase.from('dashboard_widgets').update({ width: newWidth }).eq('id', widgetId);
  };

  if (!configLoaded) {
    return <div className="flex items-center justify-center h-64"><RetroLoader /></div>;
  }

  const missingConfig = !hasSupabaseConfig || !hasOpenrouterKey;

  return (
    <div className="container mx-auto max-w-7xl space-y-6">
      {/* Config warning */}
      {missingConfig && (
        <div className="p-4 bg-destructive/10 flex items-center gap-3" style={{ border: '2px groove hsl(var(--border-groove))' }}>
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
            <strong>Configuration Required:</strong>{' '}
            {!hasSupabaseConfig && 'Supabase credentials are missing. '}
            {!hasOpenrouterKey && 'OpenRouter API key is missing. '}
            Please update them on the <strong>Credentials</strong> page.
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card" style={{ border: '3px groove hsl(var(--border-groove))' }}>
        {/* Date preset */}
        <Select value={datePreset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-[160px] h-9" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 400 }}>
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
            {DATE_PRESETS.map(p => (
              <SelectItem key={p.days} value={String(p.days)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value="custom" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              Custom Range
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Custom date inputs */}
        {datePreset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={format(dateFrom, 'yyyy-MM-dd')}
              onChange={e => setDateFrom(new Date(e.target.value))}
              className="h-9 px-2 bg-background text-foreground"
              style={{ border: '1px solid hsl(var(--border))', fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}
            />
            <span className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>to</span>
            <input
              type="date"
              value={format(dateTo, 'yyyy-MM-dd')}
              onChange={e => setDateTo(new Date(e.target.value))}
              className="h-9 px-2 bg-background text-foreground"
              style={{ border: '1px solid hsl(var(--border))', fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}
            />
          </div>
        )}

        {/* Model selector */}
        <Select value={selectedModel} onValueChange={setSelectedModel}>
          <SelectTrigger className="w-[200px] h-9" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            {AVAILABLE_MODELS.map(m => (
              <SelectItem key={m.id} value={m.id} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Refresh */}
        <Button
          onClick={handleRefresh}
          disabled={isRefreshing || widgets.length === 0 || missingConfig}
          className="groove-btn h-9"
          style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
        >
          {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          REFRESH
        </Button>

        {/* Create metric */}
        <Button
          onClick={() => setCreateDialogOpen(true)}
          disabled={!hasOpenrouterKey}
          className="groove-btn h-9 ml-auto"
          style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
        >
          <Plus className="h-4 w-4 mr-2" />
          CREATE METRIC
        </Button>
      </div>

      {/* Widget grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64"><RetroLoader /></div>
      ) : widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground bg-card" style={{ border: '3px groove hsl(var(--border-groove))' }}>
          <div style={{ fontFamily: "'VT323', monospace", fontSize: '28px' }}>NO METRICS YET</div>
          <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
            Click <strong>CREATE METRIC</strong> to define what you want to track from your conversations.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {widgets.map(w => (
            <div key={w.id} className={w.width === 'full' ? 'md:col-span-2' : ''}>
              <V2WidgetRenderer
                widget={w}
                isProcessing={processingWidgets.has(w.id)}
                onDelete={() => setDeleteWidgetId(w.id)}
                onToggleWidth={() => handleToggleWidth(w.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateMetricDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        clientId={clientId || ''}
        onCreated={fetchWidgets}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteWidgetId} onOpenChange={open => !open && setDeleteWidgetId(null)}>
        <AlertDialogContent style={{ border: '3px groove hsl(var(--border-groove))' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>DELETE METRIC</AlertDialogTitle>
            <AlertDialogDescription style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>
              Are you sure? This will remove the metric and its data from the dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="groove-btn" style={{ fontFamily: "'VT323', monospace", fontSize: '16px' }}>CANCEL</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="groove-btn bg-destructive hover:bg-destructive/80" style={{ fontFamily: "'VT323', monospace", fontSize: '16px' }}>DELETE</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
