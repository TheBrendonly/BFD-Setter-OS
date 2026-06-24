import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, Search, Trash2, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { format } from 'date-fns';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { SchemaNode } from '@/components/error-logs/SchemaNode';
import { LogsTabsNav } from '@/components/logs/LogsTabsNav';

interface ErrorLog {
  id: string;
  created_at: string;
  client_ghl_account_id: string;
  lead_id: string | null;
  execution_id: string | null;
  severity: string;
  error_type: string;
  error_message: string;
  context: any;
}

interface LeadInfo {
  id: string; // internal UUID
  first_name: string | null;
  last_name: string | null;
}

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000] as const;
const DEFAULT_PAGE_SIZE = 50;
const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const HEADER_FONT = { fontFamily: "'VT323', monospace", fontSize: '18px', textTransform: 'uppercase' as const };
const EMPTY_ROWS_MIN = 20;

const COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'severity', label: 'Severity' },
  { key: 'error_type', label: 'Error Type' },
  { key: 'lead', label: 'Lead' },
  { key: 'lead_id', label: 'Lead ID' },
  { key: 'error_message', label: 'Error Message' },
];

const DEFAULT_WIDTHS: Record<string, number> = {
  time: 190,
  severity: 110,
  error_type: 200,
  lead: 160,
  lead_id: 160,
  error_message: 400,
};

const ErrorLogs = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null);
  const [ghlAccountId, setGhlAccountId] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  // Lead name lookup: lead_id (canonical) → { id, first_name, last_name }
  const [leadMap, setLeadMap] = useState<Record<string, LeadInfo>>({});

  // Resizable column widths — persisted to clients.crm_column_widths under error_logs_ prefix
  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...DEFAULT_WIDTHS });
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedWidthsRef = useRef(false);

  // Load saved widths from DB
  useEffect(() => {
    if (!clientId || hasLoadedWidthsRef.current) return;
    hasLoadedWidthsRef.current = true;
    (async () => {
      const { data } = await supabase
        .from('clients_public')
        .select('crm_column_widths')
        .eq('id', clientId)
        .single();
      if (data?.crm_column_widths && typeof data.crm_column_widths === 'object') {
        const all = data.crm_column_widths as Record<string, number>;
        // Extract error_logs_ prefixed keys
        const restored: Record<string, number> = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith('el_') && typeof v === 'number' && v >= 30 && v <= 800) {
            restored[k.slice(3)] = v;
          }
        }
        if (Object.keys(restored).length > 0) {
          setColWidths(prev => ({ ...prev, ...restored }));
        }
      }
    })();
  }, [clientId]);

  // Debounced save to DB (merge with existing crm_column_widths)
  const saveWidthsToDB = useCallback((widths: Record<string, number>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!clientId) return;
      // Read existing, merge, save
      const { data } = await supabase
        .from('clients_public')
        .select('crm_column_widths')
        .eq('id', clientId)
        .single();
      const existing = (data?.crm_column_widths && typeof data.crm_column_widths === 'object' ? data.crm_column_widths : {}) as Record<string, number>;
      // Remove old el_ keys
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(existing)) {
        if (!k.startsWith('el_')) cleaned[k] = v;
      }
      // Add current
      for (const [k, v] of Object.entries(widths)) {
        cleaned[`el_${k}`] = v;
      }
      await supabase
        .from('clients')
        .update({ crm_column_widths: cleaned } as any)
        .eq('id', clientId);
    }, 500);
  }, [clientId]);

  const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] || 120 };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + diff);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.key]: newWidth }));
    };
    const onMouseUp = () => {
      setColWidths(prev => {
        saveWidthsToDB(prev);
        return prev;
      });
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [colWidths, saveWidthsToDB]);

  const totalTableWidth = useMemo(() =>
    COLUMNS.reduce((s, c) => s + (colWidths[c.key] || 120), 0),
    [colWidths]
  );

  // Fetch client's ghl_location_id
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data } = await supabase
        .from('clients_public')
        .select('ghl_location_id')
        .eq('id', clientId)
        .single();
      setGhlAccountId(data?.ghl_location_id || null);
    })();
  }, [clientId]);

  const fetchLogs = useCallback(async () => {
    if (!ghlAccountId) {
      setLogs([]);
      setLoading(false);
      return;
    }
    if (isFirstLoad.current) setLoading(true);
    try {
      let query = (supabase as any)
        .from('error_logs')
        .select('*', { count: 'exact' })
        .eq('client_ghl_account_id', ghlAccountId)
        .order('created_at', { ascending: false });

      if (searchQuery.trim()) {
        query = query.or(`error_type.ilike.%${searchQuery}%,error_message.ilike.%${searchQuery}%,lead_id.ilike.%${searchQuery}%`);
      }

      const { data, error, count } = await query
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;
      const fetched = (data as ErrorLog[]) || [];
      setLogs(fetched);
      setTotalCount(count || 0);

      // Resolve lead names for any lead_ids present
      const leadIds = [...new Set(fetched.map(l => l.lead_id).filter(Boolean))] as string[];
      if (leadIds.length > 0 && clientId) {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, first_name, last_name, lead_id')
          .eq('client_id', clientId)
          .in('lead_id', leadIds);
        if (leads) {
          const map: Record<string, LeadInfo> = {};
          for (const l of leads as any[]) {
            if (l.lead_id) map[l.lead_id] = { id: l.id, first_name: l.first_name, last_name: l.last_name };
          }
          setLeadMap(prev => ({ ...prev, ...map }));
        }
      }
    } catch (err: any) {
      console.error('Error fetching error logs:', err);
      toast.error('Failed to fetch error logs');
    } finally {
      setLoading(false);
      isFirstLoad.current = false;
    }
  }, [ghlAccountId, page, pageSize, searchQuery, clientId]);

  useEffect(() => {
    if (ghlAccountId !== null) fetchLogs();
  }, [ghlAccountId, fetchLogs]);

  const clearLogs = async () => {
    if (!ghlAccountId) return;
    try {
      const { error } = await (supabase as any)
        .from('error_logs')
        .delete()
        .eq('client_ghl_account_id', ghlAccountId);
      if (error) throw error;
      toast.success('Cleared all error logs');
      fetchLogs();
    } catch {
      toast.error('Failed to clear logs');
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);
  const emptyRowCount = Math.max(0, EMPTY_ROWS_MIN - logs.length);

  const getLeadName = (leadId: string | null): string | null => {
    if (!leadId) return null;
    const info = leadMap[leadId];
    if (!info) return null;
    const parts = [info.first_name, info.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  };

  const getLeadUuid = (leadId: string | null): string | null => {
    if (!leadId) return null;
    return leadMap[leadId]?.id || null;
  };

  // Page header — search + error count in leftExtra, same as CRM
  const searchFilterExtra = (
    <div className="flex items-center ml-4" style={{ gap: '12px' }}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search errors..."
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
          className="pl-10 !h-8 w-[210px]"
        />
      </div>
      {totalCount > 0 && (
        <StatusTag variant="negative">{totalCount} Errors</StatusTag>
      )}
    </div>
  );

  usePageHeader({
    title: 'Error Logs',
    leftExtra: searchFilterExtra,
    actions: [
      {
        label: 'CLEAR ALL',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: clearLogs,
        variant: 'outline' as const,
        disabled: totalCount === 0,
      },
      {
        label: loading ? 'REFRESHING...' : 'REFRESH',
        icon: <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />,
        onClick: fetchLogs,
        disabled: loading,
      },
    ],
  }, [loading, totalCount, searchQuery]);

  const renderCell = (log: ErrorLog, colKey: string) => {
    switch (colKey) {
      case 'time':
        return (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {format(new Date(log.created_at), 'MMM d, yyyy, h:mm a')}
          </span>
        );
      case 'severity':
        return (
          <StatusTag variant={log.severity === 'error' ? 'negative' : log.severity === 'warning' ? 'warning' : 'neutral'}>
            {log.severity.toUpperCase()}
          </StatusTag>
        );
      case 'error_type':
        return <span className="font-medium" style={FONT}>{log.error_type}</span>;
      case 'lead': {
        const name = getLeadName(log.lead_id);
        const uuid = getLeadUuid(log.lead_id);
        if (!name) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span
            className="cursor-pointer"
            title="Go to lead"
            onClick={(e) => {
              e.stopPropagation();
              if (uuid) navigate(`/client/${clientId}/leads/${uuid}`);
            }}
          >
            <StatusTag variant="neutral">
              <span style={{ fontFamily: "'VT323', monospace", fontSize: '14px', textTransform: 'uppercase' }}>
                {name.length > 16 ? `${name.substring(0, 16)}...` : name}
              </span>
            </StatusTag>
          </span>
        );
      }
      case 'lead_id':
        if (!log.lead_id) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span
            className="cursor-pointer"
            title="Click to copy Lead ID"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await navigator.clipboard.writeText(log.lead_id!);
                toast.success('Lead ID copied');
              } catch {
                toast.error('Failed to copy');
              }
            }}
          >
            <StatusTag variant="neutral">
              <span style={{ fontFamily: "'VT323', monospace", fontSize: '14px', textTransform: 'uppercase' }}>
                {log.lead_id.length > 12 ? `${log.lead_id.substring(0, 12)}...` : log.lead_id}
              </span>
            </StatusTag>
          </span>
        );
      case 'error_message':
        return (
          <span className="text-sm text-foreground/80 truncate block" style={FONT}>
            {log.error_message.length > 60 ? `${log.error_message.substring(0, 60)}...` : log.error_message}
          </span>
        );
      default:
        return null;
    }
  };

  if (loading && isFirstLoad.current) {
    return (
      <div className="container mx-auto max-w-7xl flex h-full min-h-0 flex-col overflow-hidden pb-0" style={{ paddingTop: '24px' }}>
        <div className="flex items-center justify-center py-16 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl flex h-full min-h-0 flex-col overflow-hidden pb-0" style={{ paddingTop: '24px' }}>
      <div className="mb-4">
        <LogsTabsNav />
      </div>
      {/* Empty states */}
      {!ghlAccountId ? (
        <div className="flex-1 flex min-h-0 flex-col overflow-hidden relative" style={{ border: '3px groove hsl(var(--border-groove))', overscrollBehavior: 'none' }}>
          <div className="flex flex-col items-center justify-center flex-1">
            <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No GHL Account ID</h3>
            <p className="text-sm text-muted-foreground mt-1">Configure the GHL Location ID in Credentials to view error logs.</p>
          </div>
        </div>
      ) : logs.length === 0 && !searchQuery.trim() ? (
        <div className="flex-1 flex min-h-0 flex-col overflow-hidden relative" style={{ border: '3px groove hsl(var(--border-groove))', overscrollBehavior: 'none' }}>
          <div className="flex flex-col items-center justify-center flex-1">
            <CheckCircle className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-medium">NO ERRORS</h3>
            <p className="text-sm text-muted-foreground mt-1">Everything is running smoothly.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Table — unified sticky-header table, same as CRM */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden relative" style={{ border: '3px groove hsl(var(--border-groove))', overscrollBehavior: 'none' }}>
            <ScrollArea className="flex-1 [&>div]:overscroll-none" showHorizontalScrollbar>
              <table className="caption-bottom text-base" style={{ tableLayout: 'fixed', width: totalTableWidth, minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <colgroup>
                  {COLUMNS.map(col => (
                    <col key={col.key} style={{ width: colWidths[col.key] || 120 }} />
                  ))}
                </colgroup>
                <thead className="bg-background">
                  <tr>
                    {COLUMNS.map((col, colIdx) => {
                      const isLast = colIdx === COLUMNS.length - 1;
                      return (
                        <th
                          key={col.key}
                          className="sticky top-0 z-20 h-[52px] px-5 text-left align-middle text-[13px] font-medium tracking-wide text-foreground relative bg-background"
                          style={{
                            borderRight: isLast ? 'none' : '3px groove hsl(var(--border-groove))',
                            borderBottom: '3px groove hsl(var(--border-groove))',
                            borderTop: 'none',
                            borderLeft: 'none',
                          }}
                        >
                          <div className="flex items-center gap-1 select-none overflow-hidden">
                            <span className="truncate">{col.label}</span>
                          </div>
                          {!isLast && (
                            <div
                              className="absolute right-0 top-0 bottom-0 w-[18px] translate-x-1/2 cursor-col-resize z-20"
                              onMouseDown={e => handleResizeStart(col.key, e)}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="bg-card">
                  {logs.length === 0 ? (
                    Array.from({ length: 8 }).map((_, rowIdx) => (
                      <tr key={`empty-${rowIdx}`} className="border-b border-border">
                        {COLUMNS.map((col, colIdx) => {
                          const isLast = colIdx === COLUMNS.length - 1;
                          return (
                            <td
                              key={col.key}
                              className="px-5 py-2.5 text-[13px]"
                              style={{ borderBottom: '1px solid hsl(var(--border))', ...(isLast ? {} : { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }) }}
                            >
                              &nbsp;
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    <>
                      {logs.map(log => (
                        <tr
                          key={log.id}
                          className="cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setSelectedLog(log)}
                        >
                          {COLUMNS.map((col, colIdx) => {
                            const isLast = colIdx === COLUMNS.length - 1;
                            return (
                              <td
                                key={col.key}
                                className="px-5 py-2.5 text-[13px]"
                                style={{ borderBottom: '1px solid hsl(var(--border))', ...(isLast ? {} : { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }) }}
                              >
                                {renderCell(log, col.key)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {/* Empty placeholder rows */}
                      {Array.from({ length: emptyRowCount }).map((_, i) => (
                        <tr key={`empty-${i}`} className="border-b border-border last:border-b-0 bg-card">
                          {COLUMNS.map((col, colIdx) => {
                            const isLast = colIdx === COLUMNS.length - 1;
                            return (
                              <td
                                key={col.key}
                                className="px-5 py-2.5 text-[13px]"
                                style={{ borderBottom: '1px solid hsl(var(--border))', ...(isLast ? {} : { borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }) }}
                              >
                                &nbsp;
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </div>

          {/* Pagination bar — same as CRM */}
          <div className="flex items-center justify-center relative" style={{ marginTop: '12px', marginBottom: '12px' }}>
            <div className="absolute left-0">
              <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(0); }}>
                <SelectTrigger className="h-8 groove-btn w-auto min-w-[130px] pagination-page-size-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-sidebar pagination-page-size-content">
                  {PAGE_SIZE_OPTIONS.map(n => (
                    <SelectItem key={n} value={String(n)} className="pagination-page-size-item">{n} Per Page</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 groove-btn"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                {page + 1} / {Math.max(1, totalPages)}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 groove-btn"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={open => { if (!open) setSelectedLog(null); }}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0" style={{ width: '90vw' }}>
          <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))' }}>
            <DialogTitle style={{ ...HEADER_FONT, fontSize: '24px' }}>
              Error Detail
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6">
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2">
                    <span className="text-xs text-muted-foreground" style={FONT}>Error ID</span>
                    <div className="flex items-center gap-2">
                      <span
                        className="cursor-pointer"
                        title="Click to copy Error ID"
                        onClick={() => { navigator.clipboard.writeText(selectedLog.id); toast.success('Error ID copied'); }}
                      >
                        <StatusTag variant="neutral">{selectedLog.id}</StatusTag>
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>Error Type</span>
                    <p className="font-medium" style={FONT}>{selectedLog.error_type}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>Severity</span>
                    <StatusTag variant={selectedLog.severity === 'error' ? 'negative' : selectedLog.severity === 'warning' ? 'warning' : 'neutral'}>
                      {selectedLog.severity.toUpperCase()}
                    </StatusTag>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>Time</span>
                    <p style={FONT}>{format(new Date(selectedLog.created_at), 'MMM d yyyy, HH:mm:ss')}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground" style={FONT}>GHL Account ID</span>
                    <p style={FONT}>{selectedLog.client_ghl_account_id}</p>
                  </div>
                  {selectedLog.lead_id && (
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground" style={FONT}>Lead ID</span>
                      <span
                        className="cursor-pointer"
                        title="Click to copy Lead ID"
                        onClick={() => { navigator.clipboard.writeText(selectedLog.lead_id!); toast.success('Lead ID copied'); }}
                      >
                        <StatusTag variant="neutral">{selectedLog.lead_id}</StatusTag>
                      </span>
                    </div>
                  )}
                  {selectedLog.execution_id && (
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground" style={FONT}>Execution ID</span>
                      <span
                        className="cursor-pointer"
                        title="Click to copy Execution ID"
                        onClick={() => { navigator.clipboard.writeText(selectedLog.execution_id!); toast.success('Execution ID copied'); }}
                      >
                        <StatusTag variant="neutral">{selectedLog.execution_id}</StatusTag>
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h4 style={HEADER_FONT} className="text-destructive">Error Message</h4>
                  <div className="p-3 bg-destructive/10 groove-border border-destructive/20">
                    <p style={{ ...FONT, fontSize: '12px', lineHeight: '1.5' }} className="text-destructive whitespace-pre-wrap">
                      {selectedLog.error_message}
                    </p>
                  </div>
                </div>

                {selectedLog.context && Object.keys(selectedLog.context).length > 0 && (
                  <div className="space-y-2">
                    <h4 style={HEADER_FONT} className="text-foreground">Context</h4>
                    <div className="p-4 groove-border bg-card overflow-auto max-h-[300px]">
                      {typeof selectedLog.context === 'object' ? (
                        <div>
                          {Object.entries(selectedLog.context).map(([key, value]) => (
                            <SchemaNode key={key} label={key} value={value} />
                          ))}
                        </div>
                      ) : (
                        <pre className="text-foreground/80" style={{ ...FONT, fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {JSON.stringify(selectedLog.context, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ErrorLogs;
