import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import SavingOverlay from '@/components/SavingOverlay';
import {
  RefreshCw, Key, Database, Server,
  Table2, Search, X, Maximize2, RotateCcw, MessageSquare,
} from '@/components/icons';
import { format, parseISO } from 'date-fns';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import {
  GridLayout,
  useContainerWidth,
  verticalCompactor,
  type LayoutItem,
  type Layout,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';

// ── Style Constants ──────────────────────────────────────────────────
const FONT: React.CSSProperties = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" };
const LABEL_STYLE: React.CSSProperties = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" };
const TABLE_CELL_STYLE: React.CSSProperties = { fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" };
const GROOVE_BORDER = '3px groove hsl(var(--border-groove))';

// ── Grid Constants ───────────────────────────────────────────────────
const COLS = 4;
const ROW_HEIGHT = 26;
const GRID_MARGIN: [number, number] = [12, 12];
const STORAGE_KEY_PREFIX = 'supabase_usage_widget_order_';

interface UsageWidget {
  id: string;
  title: string;
  widget_type: 'project_meta' | 'number_card' | 'table_editor';
  sort_order: number;
}

const DEFAULT_WIDGETS: UsageWidget[] = [
  { id: 'project_meta', title: 'Project', widget_type: 'project_meta', sort_order: 0 },
  { id: 'total', title: 'Total', widget_type: 'number_card', sort_order: 5 },
  { id: 'database', title: 'Database', widget_type: 'number_card', sort_order: 6 },
  { id: 'auth', title: 'Auth', widget_type: 'number_card', sort_order: 7 },
  { id: 'storage', title: 'Storage', widget_type: 'number_card', sort_order: 8 },
  { id: 'table_editor', title: 'Table Editor', widget_type: 'table_editor', sort_order: 10 },
];

function getWidgetSize(w: UsageWidget): { w: number; h: number } {
  if (w.widget_type === 'project_meta') return { w: COLS, h: 5 };
  if (w.widget_type === 'number_card') return { w: 1, h: 4 };
  return { w: COLS, h: 14 };
}

function widgetsToLayout(widgets: UsageWidget[]): LayoutItem[] {
  return [...widgets]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((widget) => {
      const size = getWidgetSize(widget);
      return {
        i: widget.id,
        x: widget.sort_order % COLS,
        y: Math.floor(widget.sort_order / COLS),
        w: size.w,
        h: size.h,
        isResizable: false,
      };
    });
}

function layoutToSortOrders(layout: Layout): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of layout) {
    map.set(item.i, item.y * COLS + item.x);
  }
  return map;
}

// ── Helpers ──────────────────────────────────────────────────────────

const StatusTag = ({ status }: { status: string }) => {
  const isHealthy = status === 'ACTIVE_HEALTHY' || status === 'ACTIVE';
  const label = isHealthy ? 'ACTIVE' : status;
  const colorClass = isHealthy
    ? 'terminal-tag-green'
    : status === 'PAUSED' || status === 'INACTIVE'
    ? 'terminal-tag-orange'
    : 'terminal-tag-red';
  return <span className={`terminal-tag ${colorClass}`}>{label}</span>;
};

const formatNumber = (val: number | undefined | null) => {
  if (val == null) return '—';
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
};

const formatDate = (d: string | undefined | null) => {
  if (!d) return '—';
  try { return format(parseISO(d), 'MMM d, yyyy'); } catch { return d; }
};

const formatAddonText = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

const formatAddonPrice = (price: unknown): string | null => {
  if (price == null) return null;
  if (typeof price === 'string') return price;
  if (typeof price === 'number' && Number.isFinite(price)) return `$${price}`;
  if (typeof price === 'object') {
    const value = price as { description?: unknown; amount?: unknown; interval?: unknown };
    if (typeof value.description === 'string' && value.description.trim().length > 0) return value.description;
    const amount = Number(value.amount);
    const amountLabel = Number.isFinite(amount) ? `$${amount}` : null;
    const intervalLabel = typeof value.interval === 'string' && value.interval.length > 0 ? value.interval : null;
    if (amountLabel && intervalLabel) return `${amountLabel}/${intervalLabel}`;
    if (amountLabel) return amountLabel;
  }
  return null;
};

// ── Cell Expand Modal ────────────────────────────────────────────────

const CellExpandModal = ({ value, column, onClose }: { value: string; column: string; onClose: () => void }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={`p-0 gap-0 overflow-hidden [&>button]:hidden ${
          expanded 
            ? 'w-[90vw] max-w-none !top-4 !translate-y-0 !bottom-4 !h-auto' 
            : 'w-full max-w-lg max-h-[60vh]'
        }`}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <div className="flex items-center justify-between px-6 shrink-0" style={{ borderBottom: GROOVE_BORDER, paddingTop: '14px', paddingBottom: '14px' }}>
          <span style={TABLE_CELL_STYLE} className="font-medium text-foreground truncate">{column}</span>
          <div className="flex items-center gap-2">
            <Button 
              size="icon"
              variant="ghost"
              className="h-8 w-8 !bg-muted !border-border hover:!bg-accent"
              onClick={() => setExpanded(!expanded)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
            <Button 
              size="icon"
              variant="ghost"
              className="h-8 w-8 !bg-muted !border-border hover:!bg-accent"
              onClick={onClose}
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6" style={{ minHeight: 0 }}>
          <pre style={{ ...TABLE_CELL_STYLE, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} className="text-foreground">
            {value}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Table Editor (Supabase-style) ────────────────────────────────────

const TableEditor = ({ tables, columns, rlsStatus, clientId }: {
  tables: any[];
  columns: any[];
  rlsStatus: any[];
  clientId: string;
}) => {
  const PRIORITY_TABLES = ['prompts', 'credentials'];

  const sortedTables = useMemo(() => {
    return [...tables].sort((a: any, b: any) => {
      const aIdx = PRIORITY_TABLES.indexOf(a.table_name);
      const bIdx = PRIORITY_TABLES.indexOf(b.table_name);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.table_name.localeCompare(b.table_name);
    });
  }, [tables]);

  const [selectedTable, setSelectedTable] = useState<string>(sortedTables[0]?.table_name || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCell, setExpandedCell] = useState<{ value: string; column: string } | null>(null);

  const rlsLookup = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (Array.isArray(rlsStatus)) {
      rlsStatus.forEach((r: any) => { map[r.tablename] = r.rowsecurity; });
    }
    return map;
  }, [rlsStatus]);

  const filteredTables = useMemo(() => {
    if (!searchQuery.trim()) return sortedTables;
    return sortedTables.filter((t: any) => t.table_name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [sortedTables, searchQuery]);

  const tableColumns = useMemo(() => {
    return columns.filter((c: any) => c.table_name === selectedTable);
  }, [columns, selectedTable]);

  const { data: tableData, isLoading: tableDataLoading } = useQuery({
    queryKey: ['supabase-table-data', clientId, selectedTable],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await supabase.functions.invoke('supabase-project-usage', {
        body: { client_id: clientId, action: 'table_data', table_name: selectedTable },
      });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    enabled: !!selectedTable,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const rows = tableData?.rows || [];
  const dataColumns = rows.length > 0 ? Object.keys(rows[0]) : tableColumns.map((c: any) => c.column_name);

  const colTypeMap = useMemo(() => {
    const map: Record<string, string> = {};
    tableColumns.forEach((c: any) => { map[c.column_name] = c.data_type; });
    return map;
  }, [tableColumns]);

  const isRlsEnabled = rlsLookup[selectedTable] ?? false;

  const getCellDisplayValue = (val: any): string => {
    if (val == null) return 'NULL';
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  };

  return (
    <>
      {expandedCell && (
        <CellExpandModal value={expandedCell.value} column={expandedCell.column} onClose={() => setExpandedCell(null)} />
      )}
      <div className="bg-card flex h-full" style={{ border: GROOVE_BORDER }}>
        {/* Sidebar */}
        <div className="w-[220px] flex flex-col shrink-0" style={{ borderRight: GROOVE_BORDER }}>
          <div className="p-2" style={{ borderBottom: GROOVE_BORDER }}>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tables..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={TABLE_CELL_STYLE}
                className="w-full pl-7 pr-2 py-1.5 bg-background text-foreground placeholder:text-muted-foreground groove-border focus:outline-none"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="py-1">
              {filteredTables.map((table: any) => (
                <button
                  key={table.table_name}
                  onClick={() => setSelectedTable(table.table_name)}
                  style={TABLE_CELL_STYLE}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    selectedTable === table.table_name
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <Table2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{table.table_name}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main - Data grid */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 bg-background h-[52px]" style={{ borderBottom: GROOVE_BORDER }}>
            <span style={TABLE_CELL_STYLE} className="font-medium text-foreground">{selectedTable}</span>
            <div className="flex items-center gap-2 ml-auto">
              {isRlsEnabled ? (
                <span className="terminal-tag terminal-tag-green">RLS ENABLED</span>
              ) : (
                <span className="terminal-tag terminal-tag-red">RLS DISABLED</span>
              )}
              <span style={TABLE_CELL_STYLE} className="text-muted-foreground">
                {rows.length} row{rows.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Data grid */}
          <div className="flex-1 overflow-auto">
            {tableDataLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                <span style={TABLE_CELL_STYLE}>Loading table data...</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <span style={TABLE_CELL_STYLE}>No rows in this table</span>
              </div>
            ) : (
              <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-background" style={{ height: '52px' }}>
                    {dataColumns.map((col: string) => (
                    <th key={col} className="h-[52px] px-3 text-left align-middle whitespace-nowrap last:border-r-0 bg-background"
                        style={{ ...TABLE_CELL_STYLE, borderRight: GROOVE_BORDER, borderBottom: GROOVE_BORDER, position: 'sticky', top: 0 }}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{col}</span>
                          {colTypeMap[col] && (
                            <span className="text-muted-foreground font-normal" style={{ fontSize: '11px' }}>{colTypeMap[col]}</span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      {dataColumns.map((col: string, colIdx: number) => {
                        const cellVal = getCellDisplayValue(row[col]);
                        const isLast = colIdx === dataColumns.length - 1;
                        return (
                          <td
                            key={col}
                            className="px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate cursor-pointer hover:bg-muted/30"
                            style={{ ...TABLE_CELL_STYLE, borderBottom: '1px solid hsl(var(--border))', ...(isLast ? {} : { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }) }}
                            onClick={() => setExpandedCell({ value: cellVal, column: col })}
                          >
                            {row[col] == null ? (
                              <span className="text-muted-foreground italic">NULL</span>
                            ) : typeof row[col] === 'object' ? (
                              <span className="text-muted-foreground">{JSON.stringify(row[col]).slice(0, 80)}</span>
                            ) : typeof row[col] === 'boolean' ? (
                              <span className={row[col] ? 'text-emerald-400' : 'text-muted-foreground'}>
                                {String(row[col])}
                              </span>
                            ) : (
                              String(row[col]).slice(0, 120)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-1.5 bg-background" style={{ borderTop: GROOVE_BORDER }}>
            <span style={TABLE_CELL_STYLE} className="text-muted-foreground">
              {rows.length} row{rows.length !== 1 ? 's' : ''} · {dataColumns.length} column{dataColumns.length !== 1 ? 's' : ''}
            </span>
            <span style={TABLE_CELL_STYLE} className="text-muted-foreground">Read-only</span>
          </div>
        </div>
      </div>
    </>
  );
};

// ── Main Component ───────────────────────────────────────────────────

const SupabaseUsage = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();

  const { credentials, isLoading: credentialsLoading } = useClientCredentials(clientId);
  const queryClient = useQueryClient();
  const hydratedRef = useRef(false);
  const isDraggingRef = useRef(false);
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 });

  const hasPat = Boolean(credentials?.has_supabase_access_token);
  const hasUrl = Boolean(credentials?.supabase_url);

  // ── Layout state ───────────────────────────────────────────────────
  const [widgets, setWidgets] = useState<UsageWidget[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PREFIX + clientId);
      if (saved) {
        const orders: Record<string, number> = JSON.parse(saved);
        return DEFAULT_WIDGETS.map(w => ({
          ...w,
          sort_order: orders[w.id] ?? w.sort_order,
        }));
      }
    } catch {}
    return DEFAULT_WIDGETS;
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PREFIX + clientId);
      if (saved) {
        const orders: Record<string, number> = JSON.parse(saved);
        setWidgets(DEFAULT_WIDGETS.map(w => ({
          ...w,
          sort_order: orders[w.id] ?? w.sort_order,
        })));
      } else {
        setWidgets(DEFAULT_WIDGETS);
      }
    } catch {
      setWidgets(DEFAULT_WIDGETS);
    }
  }, [clientId]);

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resettingLayout, setResettingLayout] = useState(false);

  const handleResetLayout = useCallback(async () => {
    setResettingLayout(true);
    await new Promise(r => setTimeout(r, 300));
    setWidgets(DEFAULT_WIDGETS);
    localStorage.removeItem(STORAGE_KEY_PREFIX + clientId);
    setResettingLayout(false);
  }, [clientId]);

  // ── Data fetching ──────────────────────────────────────────────────
  const { data: cachedRow, isLoading: cachedRowLoading } = useQuery({
    queryKey: ['supabase-usage-cache', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supabase_usage_cache')
        .select('*')
        .eq('client_id', clientId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && hasPat && hasUrl,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (cachedRow && !hydratedRef.current) {
      hydratedRef.current = true;
      const cached = cachedRow.cached_data as any;
      if (cached && typeof cached === 'object' && Object.keys(cached).length > 0) {
        queryClient.setQueryData(['supabase-project-usage', clientId], cached);
      }
    }
  }, [cachedRow, clientId, queryClient]);

  const { data, error, isFetching } = useQuery({
    queryKey: ['supabase-project-usage', clientId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await supabase.functions.invoke('supabase-project-usage', {
        body: { client_id: clientId },
      });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    enabled: false,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
  });

  const saveToCache = useCallback(async (freshData: any) => {
    if (!clientId || !freshData) return;
    const now = new Date().toISOString();
    await supabase
      .from('supabase_usage_cache')
      .upsert({
        client_id: clientId,
        cached_data: freshData,
        last_refreshed: now,
      }, { onConflict: 'client_id' });
  }, [clientId]);

  const handleRefresh = useCallback(async () => {
    const result = await queryClient.fetchQuery({
      queryKey: ['supabase-project-usage', clientId],
      queryFn: async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');
        const res = await supabase.functions.invoke('supabase-project-usage', {
          body: { client_id: clientId },
        });
        if (res.error) throw new Error(res.error.message);
        return res.data;
      },
    });
    if (result) await saveToCache(result);
  }, [clientId, queryClient, saveToCache]);

  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (hasPat && hasUrl && cachedRow === null && !autoFetchedRef.current) {
      autoFetchedRef.current = true;
      handleRefresh();
    }
  }, [hasPat, hasUrl, cachedRow, handleRefresh]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefreshClick = async () => {
    setRefreshing(true);
    try {
      await handleRefresh();
      queryClient.invalidateQueries({ queryKey: ['supabase-table-data', clientId] });
    } catch {}
    setRefreshing(false);
  };

  const isRefreshing = refreshing || isFetching;
  const project = data?.project;

  usePageHeader({
    title: 'Supabase Usage',
    leftExtra: project ? (
      <div className="flex items-center gap-3 ml-3">
        <StatusTag status={project.status || 'UNKNOWN'} />
      </div>
    ) : undefined,
    actions: [
      {
        label: isRefreshing ? 'REFRESHING...' : 'REFRESH',
        icon: <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />,
        onClick: onRefreshClick,
        disabled: isRefreshing,
      },
      {
        label: 'DEFAULT LAYOUT',
        icon: <RotateCcw className="w-4 h-4" />,
        onClick: () => setResetConfirmOpen(true),
      },
    ],
  }, [isRefreshing, project?.status, resetConfirmOpen]);

  // ── Layout handlers ────────────────────────────────────────────────
  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;

      const sortOrders = layoutToSortOrders(newLayout);
      let hasChanged = false;

      const updatedWidgets = widgets.map((w) => {
        const newOrder = sortOrders.get(w.id);
        if (newOrder !== undefined && newOrder !== w.sort_order) {
          hasChanged = true;
          return { ...w, sort_order: newOrder };
        }
        return w;
      });

      if (hasChanged) {
        setWidgets(updatedWidgets);
        const orders: Record<string, number> = {};
        updatedWidgets.forEach(w => { orders[w.id] = w.sort_order; });
        localStorage.setItem(STORAGE_KEY_PREFIX + clientId, JSON.stringify(orders));
      }
    },
    [widgets, clientId]
  );

  // ── Early returns ──────────────────────────────────────────────────
  if (credentialsLoading) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          <span style={FONT}>Loading...</span>
        </div>
      </div>
    );
  }

  if (!hasPat || !hasUrl) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6">
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <Key className="w-8 h-8 text-muted-foreground" />
            <h3 className="text-lg font-medium">Supabase Access Token Not Configured</h3>
            <p className="text-muted-foreground text-center max-w-lg">
              To view Supabase project usage, you need to configure a
              <strong> Personal Access Token (PAT)</strong> and <strong>Supabase URL</strong> in the Credentials page.
            </p>
            <Button variant="outline" onClick={() => navigate(`/client/${clientId}/credentials`)}>
              Go to Credentials
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data?.error === 'no_pat' || data?.error === 'no_url') {
    return (
      <div className="container mx-auto max-w-7xl space-y-6">
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <Key className="w-8 h-8 text-muted-foreground" />
            <h3 className="text-lg font-medium">{data.message}</h3>
            <Button variant="outline" onClick={() => navigate(`/client/${clientId}/credentials`)}>
              Go to Credentials
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Computed data ──────────────────────────────────────────────────
  const addons = data?.addons;
  const apiUsageSummary = data?.api_usage_summary;
  const tables = data?.tables;
  const columnsData = data?.columns;
  const rlsStatus = data?.rls_status;
  const selectedAddons = addons?.selected_addons || [];

  const totalAuthRequests = Number(apiUsageSummary?.total_auth_requests ?? 0);
  const totalRestRequests = Number(apiUsageSummary?.total_rest_requests ?? 0);
  const totalRealtimeRequests = Number(apiUsageSummary?.total_realtime_requests ?? 0);
  const totalStorageRequests = Number(apiUsageSummary?.total_storage_requests ?? 0);
  const totalApiRequests = Number(data?.api_requests_total ?? apiUsageSummary?.total_requests ?? 0);

  const computeAddon = selectedAddons.find((a: any) => a?.type === 'compute' || a?.type === 'COMPUTE');
  const computeLabel = computeAddon
    ? formatAddonText(computeAddon?.variant?.name) || formatAddonText(computeAddon?.variant?.identifier) || 'Default'
    : null;

  const getStatValue = (id: string): string => {
    switch (id) {
      case 'database': return formatNumber(totalRestRequests);
      case 'auth': return formatNumber(totalAuthRequests);
      case 'realtime': return formatNumber(totalRealtimeRequests);
      case 'storage': return formatNumber(totalStorageRequests);
      case 'total': return formatNumber(totalApiRequests);
      default: return '—';
    }
  };

  // ── Filter widgets based on available data ─────────────────────────
  const visibleWidgets = widgets.filter((w) => {
    if (w.id === 'project_meta') return !!project;
    if (w.widget_type === 'number_card') return !!project;
    if (w.id === 'table_editor') return Array.isArray(tables) && tables.length > 0;
    return true;
  });

  const visibleLayout = widgetsToLayout(visibleWidgets);

  // ── Widget renderers ───────────────────────────────────────────────
  const renderProjectMeta = () => (
    <div className="bg-card h-full overflow-auto" style={{ border: GROOVE_BORDER }}>
      <table className="w-full border-collapse">
        <tbody>
          {project?.name && (
            <tr style={{ borderBottom: GROOVE_BORDER }}>
              <td className="px-4 py-3" style={{ ...TABLE_CELL_STYLE, width: '180px', borderRight: GROOVE_BORDER }}>
                <span className="text-muted-foreground">Project</span>
              </td>
              <td className="px-4 py-3" style={{ ...TABLE_CELL_STYLE, textTransform: 'uppercase' }}>
                {project.name}
              </td>
            </tr>
          )}
          <tr style={{ borderBottom: GROOVE_BORDER }}>
            <td className="px-4 py-3" style={{ ...TABLE_CELL_STYLE, width: '180px', borderRight: GROOVE_BORDER }}>
              <span className="text-muted-foreground">Region</span>
            </td>
            <td className="px-4 py-3" style={{ ...TABLE_CELL_STYLE, textTransform: 'uppercase' }}>
              {project?.region || '—'}
            </td>
          </tr>
          <tr style={{ borderBottom: GROOVE_BORDER }}>
            <td className="px-4 py-3" style={{ ...TABLE_CELL_STYLE, borderRight: GROOVE_BORDER }}>
              <span className="text-muted-foreground">Created</span>
            </td>
            <td className="px-4 py-3" style={TABLE_CELL_STYLE}>
              {formatDate(project?.created_at)}
            </td>
          </tr>
          {computeLabel && (
            <tr style={{ borderBottom: GROOVE_BORDER }}>
              <td className="px-4 py-3" style={{ ...TABLE_CELL_STYLE, borderRight: GROOVE_BORDER }}>
                <span className="text-muted-foreground">Compute Instance</span>
              </td>
              <td className="px-4 py-3" style={TABLE_CELL_STYLE}>
                {computeLabel}{computeAddon && formatAddonPrice(computeAddon?.variant?.price) ? ` · ${formatAddonPrice(computeAddon?.variant?.price)}` : ''}
              </td>
            </tr>
          )}
          {selectedAddons.filter((a: any) => a?.type !== 'compute' && a?.type !== 'COMPUTE').map((addon: any, i: number) => {
            const addonType = formatAddonText(addon?.type) || 'ADDON';
            const variantName = formatAddonText(addon?.variant?.name) || formatAddonText(addon?.variant?.identifier) || addonType;
            const priceLabel = formatAddonPrice(addon?.variant?.price);
            return (
              <tr key={i} style={{ borderTop: GROOVE_BORDER }}>
                <td className="px-4 py-3" style={{ ...TABLE_CELL_STYLE, borderRight: GROOVE_BORDER }}>
                  <span className="text-muted-foreground">{addonType.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')}</span>
                </td>
                <td className="px-4 py-3" style={TABLE_CELL_STYLE}>
                  {variantName}{priceLabel ? ` · ${priceLabel}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderNumberCard = (widget: UsageWidget) => {
    const val = getStatValue(widget.id);
    return (
      <div className="stat-cell relative h-full flex flex-col" style={{ padding: '12px 16px' }}>
        <div style={{ ...FONT, textTransform: 'capitalize' }} className="font-medium text-muted-foreground mb-2">
          {widget.title}
        </div>
        <div className="border-t border-dashed border-border -mx-4 mb-0" />
        <div className="flex-1 flex items-center justify-center">
          <div
            style={{
              fontSize: '45px',
              fontFamily: "'VT323', monospace",
              lineHeight: 1,
              marginTop: '5px',
            }}
            className="font-light"
          >
            {val}
          </div>
        </div>
      </div>
    );
  };

  const renderWidgetContent = (widget: UsageWidget) => {
    if (widget.widget_type === 'project_meta') return renderProjectMeta();
    if (widget.widget_type === 'number_card') return renderNumberCard(widget);
    if (widget.widget_type === 'table_editor') {
      return (
        <TableEditor
          tables={tables}
          columns={Array.isArray(columnsData) ? columnsData : []}
          rlsStatus={Array.isArray(rlsStatus) ? rlsStatus : []}
          clientId={clientId!}
        />
      );
    }
    return null;
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6">
      {error && (
        <div className="p-3 border border-destructive/40 bg-destructive/10 text-destructive">
          <span className="text-xs font-medium tracking-wide uppercase">Error</span>
          <p className="text-sm mt-1">{(error as Error).message}</p>
        </div>
      )}

      <div ref={containerRef} className="w-full min-w-0">
        {mounted && visibleWidgets.length > 0 && (
          <GridLayout
            width={width}
            layout={visibleLayout}
            gridConfig={{
              cols: COLS,
              rowHeight: ROW_HEIGHT,
              margin: GRID_MARGIN,
              containerPadding: [0, 0],
            }}
            dragConfig={{
              enabled: true,
              handle: '.grid-drag-handle',
              cancel: 'button, input, textarea, select',
            }}
            resizeConfig={{ enabled: false }}
            compactor={verticalCompactor}
            autoSize
            onDragStop={() => { isDraggingRef.current = true; }}
            onLayoutChange={handleLayoutChange}
            className="campaign-rgl-grid"
          >
            {visibleWidgets.map((widget) => (
              <div key={widget.id} className="grid-drag-handle cursor-grab active:cursor-grabbing">
                {renderWidgetContent(widget)}
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {!project && (cachedRowLoading || isRefreshing || (hasPat && hasUrl && cachedRow === null && !data)) && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          <span className="text-sm">Loading Supabase project data...</span>
        </div>
      )}

      {!isRefreshing && !cachedRowLoading && !error && !project && !data?.error && cachedRow !== null && (
        <div className="fixed inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <MessageSquare className="w-12 h-12 text-primary mb-4" />
          <h3 className="text-lg font-medium">No data available</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Click refresh to load your Supabase project data.
          </p>
        </div>
      )}

      <SavingOverlay isVisible={resettingLayout} message="Resetting layout..." variant="fixed" />

      <DeleteConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset to Default Layout"
        description="Are you sure you want to reset the dashboard to its default layout? All customizations (reordering) will be lost."
        confirmLabel="Reset"
        confirmIcon={<RotateCcw className="w-4 h-4 mr-2" />}
        onConfirm={() => {
          setResetConfirmOpen(false);
          handleResetLayout();
        }}
      />
    </div>
  );
};

export default SupabaseUsage;
