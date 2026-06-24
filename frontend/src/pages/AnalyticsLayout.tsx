import { useState, useEffect, useCallback, useRef, Suspense, ReactNode } from "react";
import { Outlet, useParams, useSearchParams } from "react-router-dom";
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { supabase } from '@/integrations/supabase/client';
import { CampaignDashboard } from '@/components/CampaignDashboard';
import RetroLoadingIndicator from '@/components/RetroLoadingIndicator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronRight, Check } from '@/components/icons';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;

interface DashboardOption {
  id: string; // 'default' or workflow id
  name: string;
}

export function AnalyticsLayout() {
  const { clientId } = useParams<{ clientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dashboards, setDashboards] = useState<DashboardOption[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [savedDashboardId, setSavedDashboardId] = useState('default');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isResolvingDashboard, setIsResolvingDashboard] = useState(true);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [campaignHeaderActions, setCampaignHeaderActions] = useState<ReactNode>(null);
  const [defaultHeaderActions, setDefaultHeaderActions] = useState<ReactNode>(null);
  const bootstrappedClientIdRef = useRef<string | null>(null);
  // Capture initial campaign param at mount so bootstrap can use it without re-triggering
  const initialCampaignRef = useRef(searchParams.get('campaign'));

  const rawSelectedId = searchParams.get('campaign');

  // Bootstrap: runs ONLY when clientId changes (or first mount)
  useEffect(() => {
    if (!clientId || bootstrappedClientIdRef.current === clientId) return;

    bootstrappedClientIdRef.current = clientId;
    setIsResolvingDashboard(true);
    setSelectedId(null);
    setDashboards([]);

    let cancelled = false;
    const campaignFromUrl = initialCampaignRef.current;

    (async () => {
      try {
        const [{ data: workflows }, { data: client }] = await Promise.all([
          (supabase as any)
            .from('engagement_workflows')
            .select('id, name, is_active')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false }),
          (supabase as any)
            .from('clients_public')
            .select('crm_filter_config')
            .eq('id', clientId)
            .single(),
        ]);

        if (cancelled) return;

        const savedOrder: string[] | undefined = client?.crm_filter_config?.analytics_dashboard_order;
        const wfList = (workflows || []).map((w: any) => ({ id: w.id, name: w.name }));

        let opts: DashboardOption[] = [
          { id: 'default', name: 'Default' },
          ...wfList,
        ];

        if (savedOrder && savedOrder.length > 0) {
          const map = new Map(opts.map((o) => [o.id, o]));
          const ordered: DashboardOption[] = [];

          for (const id of savedOrder) {
            const item = map.get(id);
            if (item) {
              ordered.push(item);
              map.delete(id);
            }
          }

          map.forEach((value) => ordered.push(value));
          opts = ordered;
        }

        const validIds = new Set(opts.map((option) => option.id));
        const persistedDashboardId = client?.crm_filter_config?.last_analytics_dashboard;
        const nextSavedDashboardId = persistedDashboardId && validIds.has(persistedDashboardId)
          ? persistedDashboardId
          : 'default';
        const nextSelectedId = campaignFromUrl && validIds.has(campaignFromUrl)
          ? campaignFromUrl
          : nextSavedDashboardId;

        setDashboards(opts);
        setSavedDashboardId(nextSavedDashboardId);
        setSelectedId(nextSelectedId);
      } catch (error) {
        console.error('Failed to resolve analytics dashboard:', error);
        if (cancelled) return;

        setDashboards([{ id: 'default', name: 'Default' }]);
        setSavedDashboardId('default');
        setSelectedId('default');
      } finally {
        if (!cancelled) {
          setIsResolvingDashboard(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Sync URL params when selectedId changes (after bootstrap or user selection)
  useEffect(() => {
    if (isResolvingDashboard || !selectedId) return;

    const currentCampaign = searchParams.get('campaign');
    const expectedCampaign = selectedId === 'default' ? null : selectedId;

    if (currentCampaign !== expectedCampaign) {
      const nextParams = new URLSearchParams(searchParams);
      if (expectedCampaign) {
        nextParams.set('campaign', expectedCampaign);
      } else {
        nextParams.delete('campaign');
      }
      setSearchParams(nextParams, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, isResolvingDashboard]);

  const persistSelection = useCallback(async (dashId: string) => {
    if (!clientId) return;

    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();

      const config = data?.crm_filter_config || {};
      await (supabase as any)
        .from('clients')
        .update({ crm_filter_config: { ...config, last_analytics_dashboard: dashId } })
        .eq('id', clientId);
    } catch {
      // ignore
    }
  }, [clientId]);

  const persistOrder = useCallback(async (order: string[]) => {
    if (!clientId) return;

    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();

      const config = data?.crm_filter_config || {};
      await (supabase as any)
        .from('clients')
        .update({ crm_filter_config: { ...config, analytics_dashboard_order: order } })
        .eq('id', clientId);
    } catch {
      // ignore
    }
  }, [clientId]);

  const handleSelect = (dashId: string) => {
    setSelectorOpen(false);
    setSelectedId(dashId);
    setSavedDashboardId(dashId);

    const nextParams = new URLSearchParams(searchParams);
    if (dashId === 'default') {
      nextParams.delete('campaign');
    } else {
      nextParams.set('campaign', dashId);
    }

    setSearchParams(nextParams);
    persistSelection(dashId);
  };

  const handleDragStart = (event: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (event: React.DragEvent, idx: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };

  const handleDrop = (event: React.DragEvent, idx: number) => {
    event.preventDefault();

    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }

    const updated = [...dashboards];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);

    setDashboards(updated);
    setDragIdx(null);
    setDragOverIdx(null);
    persistOrder(updated.map((dashboard) => dashboard.id));
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const selectedName = selectedId
    ? dashboards.find((dashboard) => dashboard.id === selectedId)?.name || 'Default'
    : 'Loading...';
  const selectorDisabled = isResolvingDashboard || !selectedId || dashboards.length === 0;
  const fullScreenLoader = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <RetroLoadingIndicator label="Loading dashboard" />
    </div>
  );

  usePageHeader(
    !isResolvingDashboard && !!selectedId
      ? {
          title: 'Analytics',
          breadcrumbs: [
            { label: 'Analytics' },
          ],
          leftExtra: (
            <div className="flex items-center" style={{ gap: '12px', marginLeft: '6px' }}>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
                <PopoverTrigger asChild>
                  <button
                    disabled={selectorDisabled}
                    className="relative flex h-8 items-center bg-card px-3 text-foreground transition-colors hover:bg-accent/50 disabled:cursor-wait disabled:opacity-70 groove-border"
                    style={{
                      ...FONT,
                      textTransform: 'uppercase',
                      fontWeight: 500,
                      letterSpacing: '1px',
                      minWidth: '140px',
                      paddingRight: '32px',
                    }}
                  >
                    <span className="truncate">{selectedName}</span>
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' as const }}>
                        <rect x="7" y="9" width="2" height="2" />
                        <rect x="9" y="11" width="2" height="2" />
                        <rect x="11" y="13" width="2" height="2" />
                        <rect x="13" y="11" width="2" height="2" />
                        <rect x="15" y="9" width="2" height="2" />
                      </svg>
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="p-0 bg-sidebar groove-border"
                  style={{
                    boxShadow: 'none',
                    minWidth: '200px',
                  }}
                  align="start"
                  sideOffset={4}
                >
                  <div className="py-1">
                    {dashboards.map((dashboard, idx) => (
                      <button
                        key={dashboard.id}
                        onClick={() => handleSelect(dashboard.id)}
                        draggable
                        onDragStart={(event) => handleDragStart(event, idx)}
                        onDragOver={(event) => handleDragOver(event, idx)}
                        onDrop={(event) => handleDrop(event, idx)}
                        onDragEnd={handleDragEnd}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer",
                          selectedId === dashboard.id
                            ? 'bg-accent/50 text-foreground'
                            : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                          dragOverIdx === idx && dragIdx !== idx && 'border-t-2 border-primary'
                        )}
                        style={{ ...FONT, fontWeight: 400 }}
                      >
                        <Check className={cn("h-3.5 w-3.5 shrink-0", selectedId === dashboard.id ? "opacity-100" : "opacity-0")} />
                        <span className="truncate flex-1">{dashboard.name}</span>
                        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-40 cursor-grab" />
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          ),
          rightExtra: selectedId !== 'default' ? campaignHeaderActions : defaultHeaderActions,
        }
      : null,
    [isResolvingDashboard, selectedName, selectorDisabled, selectorOpen, dashboards, selectedId, dragIdx, dragOverIdx, campaignHeaderActions, defaultHeaderActions]
  );

  if (isResolvingDashboard || !selectedId) {
    return fullScreenLoader;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: '32px', paddingTop: '24px' }}>
        <div className="container mx-auto max-w-7xl">
          {selectedId !== 'default' ? (
            <CampaignDashboard workflowId={selectedId} onHeaderActions={setCampaignHeaderActions} />
          ) : (
            <Suspense fallback={fullScreenLoader}>
              <Outlet context={{ campaignId: null, onHeaderActions: setDefaultHeaderActions }} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
