import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { Copy, X, Power, ClipboardCheck, RefreshCw, ChevronLeft, ChevronRight } from '@/components/icons';
import RetroLoader from '@/components/RetroLoader';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import WorkflowCanvas, { type CanvasNode } from '@/components/workflow/WorkflowCanvas';
import { format } from 'date-fns';
import { edgeFunctionUrl } from '@/integrations/supabase/functionsBase';

const fieldStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;
const tabStyle = { fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' } as const;

interface SyncExecution {
  id: string;
  client_id: string;
  external_id: string;
  contact_name: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  steps: SyncStep[] | null;
}

interface SyncStep {
  id: string;
  label: string;
  node_type: string;
  status: 'completed' | 'failed' | 'skipped' | 'running';
  detail?: string;
  timestamp?: string;
}

/* ─── Right-side config panel for read-only node details ─── */

function SyncNodeConfig({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const ghlWebhookUrl = edgeFunctionUrl('sync-ghl-contact');

  const renderContent = () => {
    switch (nodeId) {
      case 'sync-trigger': {
        const copyParam = (val: string) => {
          navigator.clipboard.writeText(val);
          toast.success('Copied to clipboard');
        };
        const paramFields = ['GHL_Account_ID', 'Lead_ID', 'Name', 'Email', 'Phone'];
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="field-text text-foreground">GoHighLevel Webhook URL</Label>
              <p className="text-muted-foreground" style={fieldStyle}>
                Paste this URL into your GoHighLevel workflow as a webhook action. When a new lead is created in GHL, it will be automatically synced to BFD-setter.
              </p>
              <div className="pt-1 flex items-center gap-2">
                <Input value={ghlWebhookUrl} readOnly className="field-text text-xs flex-1" />
                <button
                  className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
                  onClick={() => { navigator.clipboard.writeText(ghlWebhookUrl); toast.success('Webhook URL copied'); }}
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <Label className="field-text text-foreground">Required Query Parameters</Label>
              <p className="text-muted-foreground" style={fieldStyle}>
                Add the following parameters to the webhook URL in your GoHighLevel workflow.
              </p>
              {paramFields.map(p => (
                <div key={p} className="space-y-1">
                  <Label className="field-text text-muted-foreground">Query Param</Label>
                  <div className="flex items-center gap-2">
                    <Input value={p} readOnly className="field-text flex-1" />
                    <button className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50" onClick={() => copyParam(p)}>
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }
      case 'sync-find':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Before processing, the system searches for an existing lead using the Lead ID from the webhook data.
            </p>
          </div>
        );
      case 'sync-condition':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Checks whether the lead was found in the CRM database.
            </p>
            <div className="border-t border-dashed border-border pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-none bg-success" />
                <span className="text-success" style={fieldStyle}>Lead Exists</span>
                <span className="text-muted-foreground" style={fieldStyle}>→ end workflow</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-none bg-destructive" />
                <span className="text-destructive" style={fieldStyle}>Lead Doesn't Exist</span>
                <span className="text-muted-foreground" style={fieldStyle}>→ create lead</span>
              </div>
            </div>
          </div>
        );
      case 'sync-create':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              The lead was not found in the CRM. A new lead record will be automatically created using the data received from GoHighLevel.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  const titles: Record<string, string> = {
    'sync-trigger': 'Webhook Trigger',
    'sync-find': 'Find Lead',
    'sync-condition': 'Condition',
    'sync-create': 'New Lead',
  };

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
      >
        <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
          {titles[nodeId] || 'Config'}
        </h3>
        <button
          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {renderContent()}
      </div>
    </div>
  );
}

/* ─── Execution detail panel ─── */

function SyncExecutionDetail({
  execution,
  onClose,
}: {
  execution: SyncExecution;
  onClose: () => void;
}) {
  const { cb } = useCreatorMode();
  const statusVariant = (status: string): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'created': return 'positive';
      case 'updated': return 'positive';
      case 'failed': return 'negative';
      case 'disabled': return 'warning';
      default: return 'neutral';
    }
  };

  const stepStatusVariant = (status: string): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'completed': return 'positive';
      case 'failed': return 'negative';
      case 'skipped': return 'neutral';
      default: return 'neutral';
    }
  };

  const rawSteps: SyncStep[] = Array.isArray(execution.steps) ? execution.steps : [];
  // Filter out skipped update steps when the path was create (no update node on canvas for create path)
  const steps = rawSteps.filter(s => !(s.id === 'sync-update' && s.status === 'skipped'));
  const stepHeaderById: Record<string, string> = {
    'sync-trigger': 'Trigger',
    'sync-find': 'Find Lead',
    'sync-condition': 'Condition',
    'sync-create': 'New Lead',
    'sync-update': 'Update Lead',
  };
  const stepTitleById: Record<string, string> = {
    'sync-trigger': 'Webhook',
    'sync-find': 'Find Lead',
    'sync-condition': 'Lead Exists?',
    'sync-create': 'Create Lead',
    'sync-update': 'Update Lead',
  };
  const stepHeaderByType: Record<string, string> = {
    trigger: 'Trigger',
    find: 'Find Lead',
    condition: 'Condition',
    create_contact: 'New Lead',
    update_contact: 'Update Lead',
  };
  const getStepPresentation = (step: SyncStep) => ({
    header: stepHeaderById[step.id] ?? stepHeaderByType[step.node_type] ?? step.node_type,
    title: stepTitleById[step.id] ?? step.label,
  });

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
      >
        <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
          Execution Detail
        </h3>
        <button
          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Overall status */}
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <StatusTag variant={statusVariant(execution.status)}>
          {execution.status.toUpperCase()}
        </StatusTag>
        <span className="text-muted-foreground" style={fieldStyle}>
          {format(new Date(execution.created_at), 'MMM d, HH:mm:ss')}
        </span>
      </div>

      {/* Step-by-step breakdown */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {execution.error_message && (
          <div className="groove-border bg-background px-3 py-2">
            <Label className="field-text text-foreground">Error</Label>
            <p className="text-destructive" style={fieldStyle}>{execution.error_message}</p>
          </div>
        )}

        {/* Steps */}
        {steps.length > 0 ? (
          steps.map((step, idx) => {
            const { header, title } = getStepPresentation(step);
            const isTrigger = step.id === 'sync-trigger';
            // Parse GHL Account and Lead from detail for trigger step
            let ghlAccountId = '';
            let ghlLeadId = '';
            if (isTrigger && step.detail) {
              const accMatch = step.detail.match(/GHL Account:\s*([^,]+)/);
              const leadMatch = step.detail.match(/(?:Lead|Contact):\s*(.+)/);
              ghlAccountId = accMatch?.[1]?.trim() || '';
              ghlLeadId = leadMatch?.[1]?.trim() || execution.external_id;
            }
            return (
              <div key={step.id + '-' + idx} className="groove-border bg-background">
                <div className="px-3 py-1.5 flex items-center justify-between border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground" style={fieldStyle}>#{idx + 1}</span>
                    <span className="text-foreground" style={fieldStyle}>{header}</span>
                  </div>
                  <StatusTag variant={stepStatusVariant(step.status)}>
                    {step.status.toUpperCase()}
                  </StatusTag>
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  <div className="text-foreground" style={fieldStyle}>{title}</div>
                  {isTrigger ? (
                    <div className="space-y-1.5 mt-1">
                      <div className="space-y-1">
                        <Label className="field-text text-foreground">Contact Name</Label>
                        <Input value={execution.contact_name || '—'} readOnly className={`field-text text-xs ${cb}`} />
                      </div>
                      <div className="space-y-1">
                        <Label className="field-text text-foreground">GoHighLevel Lead ID</Label>
                        <Input value={ghlLeadId || execution.external_id} readOnly className={`field-text text-xs ${cb}`} />
                      </div>
                      <div className="space-y-1">
                        <Label className="field-text text-foreground">GoHighLevel Account ID</Label>
                        <Input value={ghlAccountId || '—'} readOnly className="field-text text-xs" />
                      </div>
                    </div>
                  ) : (
                    <>
                      {step.detail && (
                        <div className="text-muted-foreground" style={fieldStyle}>{step.detail}</div>
                      )}
                    </>
                  )}
                  {step.timestamp && step.status === 'completed' && (
                    <div className="text-muted-foreground" style={fieldStyle}>
                      {format(new Date(step.timestamp), 'HH:mm:ss.SSS')}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-muted-foreground p-3" style={fieldStyle}>
            No step data recorded for this execution.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Execution list panel ─── */

function SyncExecutionLog({
  executions,
  onSelectExecution,
  onClose,
  onReload,
}: {
  executions: SyncExecution[];
  onSelectExecution: (ex: SyncExecution) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const { cb } = useCreatorMode();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredExecutions = useMemo(() => {
    if (!normalizedSearch) return executions;
    return executions.filter((ex) => {
      const searchable = [ex.contact_name, ex.external_id];
      return searchable.some((v) => typeof v === 'string' && v.toLowerCase().includes(normalizedSearch));
    });
  }, [executions, normalizedSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredExecutions.length / PAGE_SIZE));

  useEffect(() => { setCurrentPage(1); }, [normalizedSearch]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  const paginatedExecutions = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredExecutions.slice(start, start + PAGE_SIZE);
  }, [filteredExecutions, currentPage]);

  const statusVariant = (status: string): 'positive' | 'negative' | 'neutral' => {
    switch (status) {
      case 'created': return 'positive';
      case 'updated': return 'positive';
      case 'failed': return 'negative';
      case 'disabled': return 'warning' as any;
      default: return 'neutral';
    }
  };

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
            Executions
          </h3>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
            onClick={onReload}
            title="Reload"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search name, phone, or ID..."
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredExecutions.length === 0 ? (
          <div className="p-4 text-muted-foreground" style={fieldStyle}>
            {normalizedSearch ? 'No executions match your search.' : 'No executions yet. Send a contact through GHL to start.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {paginatedExecutions.map(ex => (
              <button
                key={ex.id}
                onClick={() => onSelectExecution(ex)}
                className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <StatusTag variant={statusVariant(ex.status)}>
                    {ex.status.toUpperCase()}
                  </StatusTag>
                  <span className="text-muted-foreground" style={fieldStyle}>
                    {format(new Date(ex.created_at), 'MMM d, HH:mm:ss')}
                  </span>
                </div>
                <div className={`mt-1 text-muted-foreground ${cb}`} style={{ ...fieldStyle, fontSize: '13px' }}>
                  {ex.contact_name || 'Unknown'} — {ex.external_id.slice(0, 12)}...
                </div>
              </button>
            ))}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 py-3">
                <button
                  className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 disabled:opacity-40"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-foreground px-2" style={fieldStyle}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 disabled:opacity-40"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main page ─── */

type RightPanel = 'config' | 'executions' | 'execution-detail' | null;

export default function SyncGHLContacts() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [executions, setExecutions] = useState<SyncExecution[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [selectedExecution, setSelectedExecution] = useState<SyncExecution | null>(null);
  const [showToggleDialog, setShowToggleDialog] = useState(false);

  usePageHeader({
    title: 'New Lead from GoHighLevel',
    breadcrumbs: [
      { label: 'Workflows', onClick: () => navigate(`/client/${clientId}/workflows`) },
      { label: 'New Lead from GoHighLevel', badge: 'ACTIVE', badgeVariant: 'positive' as const },
    ],
  }, [syncEnabled]);

  // Load client config
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('clients_public')
        .select('sync_ghl_enabled')
        .eq('id', clientId)
        .single();
      if (error) {
        toast.error('Failed to load config');
      } else {
        setSyncEnabled((data as any)?.sync_ghl_enabled ?? false);
      }
      setLoading(false);
    })();
  }, [clientId]);

  const lastFetchRef = useRef(0);

  const fetchExecutions = useCallback(async () => {
    if (!clientId) return;
    const { data } = await (supabase as any)
      .from('sync_ghl_executions')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      setExecutions(data as SyncExecution[]);
    }
  }, [clientId]);

  // Fetch executions + realtime
  useEffect(() => {
    if (!clientId) return;
    fetchExecutions();
    const channel = supabase
      .channel(`sync-ghl-executions-${clientId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'sync_ghl_executions', filter: `client_id=eq.${clientId}` },
        () => {
          const now = Date.now();
          if (now - lastFetchRef.current < 250) return;
          lastFetchRef.current = now;
          fetchExecutions();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, fetchExecutions]);

  const handleToggle = useCallback(async (enabled: boolean) => {
    if (!clientId) return;
    setSyncEnabled(enabled);
    const { error } = await (supabase as any)
      .from('clients')
      .update({ sync_ghl_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('id', clientId);
    if (error) {
      toast.error('Failed to update');
      setSyncEnabled(!enabled);
    } else {
      toast.success(enabled ? 'Sync enabled' : 'Sync disabled');
    }
  }, [clientId]);

  const canvasNodes: CanvasNode[] = useMemo(() => [
    {
      id: 'sync-trigger',
      type: 'trigger' as const,
      data: { label: 'Webhook', triggerType: 'inbound_webhook' as const, description: 'Receive new lead via webhook' },
      children: ['sync-find'],
    },
    {
      id: 'sync-find',
      type: 'find' as const,
      data: { label: 'Find Lead', actionType: 'find_contact' as const, contactIdMapping: '', description: 'Search by Lead ID' },
      children: ['sync-condition'],
    },
    {
      id: 'sync-condition',
      type: 'condition' as const,
      data: { label: 'Lead Exists?', actionType: 'condition' as const, field: '', operator: 'is_not_empty' as const, value: '', description: 'Check if lead exists', trueLabel: 'Lead Exists', falseLabel: "Lead Doesn't Exist" },
      children: ['sync-end-exists', 'sync-create'],
      branchLabels: { true: 'Lead Exists', false: "Lead Doesn't Exist" },
    },
    {
      id: 'sync-end-exists',
      type: 'end' as const,
      data: { label: 'End', description: 'Lead already exists, no action needed' } as any,
      children: [],
    },
    {
      id: 'sync-create',
      type: 'create_contact' as const,
      data: { label: 'Create Lead', actionType: 'create_contact' as const, ghl_contact_id: '', description: 'Create from webhook data' },
      children: ['sync-end-created'],
    },
    {
      id: 'sync-end-created',
      type: 'end' as const,
      data: { label: 'End', description: 'New lead successfully created' } as any,
      children: [],
    },
  ], []);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setRightPanel('config');
  }, []);

  const handleDeselectNode = useCallback(() => {}, []);

  const handleSelectExecution = useCallback((ex: SyncExecution) => {
    setSelectedExecution(ex);
    setRightPanel('execution-detail');
    setSelectedNodeId(null);
  }, []);

  // Derive highlighted node IDs from the selected execution's steps
  const highlightedNodeIds = useMemo(() => {
    if (!selectedExecution?.steps || rightPanel !== 'execution-detail') return undefined;
    const ids = new Set<string>();
    for (const step of selectedExecution.steps) {
      if (step.status === 'completed' || step.status === 'running') {
        ids.add(step.id);
      }
    }
    return ids.size > 0 ? ids : undefined;
  }, [selectedExecution, rightPanel]);

  const togglePanel = (panel: 'executions') => {
    if (rightPanel === panel || rightPanel === 'execution-detail') {
      setRightPanel(null);
      setSelectedExecution(null);
    } else {
      setRightPanel(panel);
      setSelectedNodeId(null);
    }
  };

  const tabBtnClass = (active: boolean) =>
    `groove-btn !h-8 px-3 flex items-center uppercase transition-colors ${active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`;

  if (loading) return <RetroLoader />;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top toolbar */}
        <div
          className="bg-card shrink-0"
          style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
        >
          <div
            className={rightPanel ? "flex items-center h-full" : "container mx-auto max-w-7xl flex items-center h-full"}
            style={rightPanel ? { paddingLeft: 'max(3rem, calc((100vw - 16rem - 80rem) / 2 + 3rem))', paddingRight: 12 } : undefined}
          >
            <span
              className="text-foreground uppercase"
              style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}
            >
              Monitor Workflow
            </span>

            <div className="flex items-center ml-auto" style={{ gap: 12 }}>
              <button
                onClick={() => togglePanel('executions')}
                className={tabBtnClass(rightPanel === 'executions' || rightPanel === 'execution-detail')}
                style={tabStyle}
              >
                <ClipboardCheck className="w-4 h-4" />
                <span className="ml-1.5">Executions</span>
              </button>
            </div>
          </div>
        </div>

        <WorkflowCanvas
          nodes={canvasNodes}
          selectedNodeId={selectedNodeId}
          highlightedNodeIds={highlightedNodeIds}
          readOnly
          onSelectNode={handleSelectNode}
          onAddNode={() => {}}
          onDeselectNode={handleDeselectNode}
        />
      </div>

      {/* Right Panel */}
      {rightPanel === 'config' && selectedNodeId && (
        <SyncNodeConfig
          nodeId={selectedNodeId}
          onClose={() => { setSelectedNodeId(null); setRightPanel(null); }}
        />
      )}
      {rightPanel === 'executions' && (
        <SyncExecutionLog
          executions={executions}
          onSelectExecution={handleSelectExecution}
          onClose={() => setRightPanel(null)}
          onReload={fetchExecutions}
        />
      )}
      {rightPanel === 'execution-detail' && selectedExecution && (
        <SyncExecutionDetail
          execution={selectedExecution}
          onClose={() => { setSelectedExecution(null); setRightPanel('executions'); }}
        />
      )}
    </div>
  );
}
