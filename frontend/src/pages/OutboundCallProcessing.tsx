import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { X, ClipboardCheck, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, Phone } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import RetroLoader from '@/components/RetroLoader';
import WorkflowCanvas, { type CanvasNode } from '@/components/workflow/WorkflowCanvas';
import type { NodeExecutionStatus } from '@/components/workflow/StaticWorkflowNode';
import { format } from 'date-fns';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { setterLabel } from '@/lib/setterLabels';

const fieldStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;
const tabStyle = { fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' } as const;

/* ─── Types ─── */

interface CallExecution {
  id: string;
  client_id: string;
  lead_id: string;
  contact_name: string | null;
  setter_name: string | null;
  campaign_id: string | null;
  status: string;
  error_message: string | null;
  call_id: string | null;
  created_at: string;
  steps: CallStep[] | null;
}

interface StepDebugInfo {
  request_url?: string;
  request_method?: string;
  request_headers?: Record<string, string>;
  request_body?: unknown;
  response_status?: number;
  response_body?: unknown;
  error?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

interface CallStep {
  id: string;
  label: string;
  node_type: string;
  status: 'completed' | 'failed' | 'skipped' | 'running';
  detail?: string;
  response_data?: string;
  timestamp?: string;
  debug?: StepDebugInfo;
}

/* ─── Static OCP step definitions ─── */

const OCP_STEP_DEFS: { id: string; header: string; title: string; detail: string }[] = [
  { id: 'ocp-trigger', header: 'Trigger', title: 'Campaign Trigger', detail: 'Launched by Trigger.dev when it\'s time to make a call' },
  { id: 'ocp-slots', header: 'Webhook', title: 'Get Available Slots', detail: 'Get available spots from the GoHighLevel calendar' },
  { id: 'ocp-history', header: 'Webhook', title: 'Get Text Setter History', detail: 'Chat history, filtered by Lead ID' },
  { id: 'ocp-fields', header: 'Webhook', title: 'Get Custom Fields', detail: 'Fetch lead custom fields from GoHighLevel' },
  { id: 'ocp-call', header: 'Webhook', title: 'Make Voice Setter Call', detail: 'Dynamic variables sent to Retell AI' },
  { id: 'ocp-end', header: 'End', title: 'End', detail: 'Call initiated successfully' },
];

/* ─── Node Config Panel ─── */

function CallNodeConfig({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const renderContent = () => {
    switch (nodeId) {
      case 'ocp-trigger':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Launched by Trigger.dev when it's time to make a call during an engagement campaign sequence.
            </p>
            <div className="space-y-2">
              <Label className="field-text text-foreground">Dynamic Variables</Label>
              {['lead_id', 'setter_name', 'campaign_id', 'contact_phone', 'contact_name', 'location_id'].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <code className="text-xs px-1.5 py-0.5 bg-muted rounded-none" style={fieldStyle}>{f}</code>
                </div>
              ))}
            </div>
          </div>
        );
      case 'ocp-slots':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Get available spots from the GoHighLevel calendar. Fetches next 30 days of available appointment slots.
            </p>
            <p className="text-muted-foreground" style={fieldStyle}>
              Uses the client's configured GHL API key and Calendar ID.
            </p>
          </div>
        );
      case 'ocp-history':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Get text setter history. Chat history, filtered by Lead ID.
            </p>
          </div>
        );
      case 'ocp-fields':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Fetches lead's custom fields from the GoHighLevel contact record using the GHL API.
            </p>
          </div>
        );
      case 'ocp-call':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Calls the Retell AI outbound endpoint with all collected data as dynamic variables.
            </p>
            <div className="space-y-2">
              <Label className="field-text text-foreground">Dynamic Variables Sent</Label>
              {['contact_name', 'available_time_slots', 'chat_history', 'custom_fields', 'current_time'].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <code className="text-xs px-1.5 py-0.5 bg-muted rounded-none" style={fieldStyle}>{f}</code>
                </div>
              ))}
            </div>
          </div>
        );
      case 'ocp-end':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Call initiated successfully. The voice setter call has been placed via Retell AI.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  const def = OCP_STEP_DEFS.find(d => d.id === nodeId);

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
      >
        <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
          {def?.title || 'Config'}
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

/* ─── Execution Detail Panel (matches Engagement style) ─── */

function CallExecutionDetail({ execution, onClose }: { execution: CallExecution; onClose: () => void }) {
  const { cb } = useCreatorMode();
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleExpand = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const statusVariant = (status: string): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'success': case 'completed': return 'positive';
      case 'failed': return 'negative';
      default: return 'neutral';
    }
  };

  const stepStatusVariant = (status: string): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'completed': return 'positive';
      case 'failed': return 'negative';
      case 'running': return 'warning';
      case 'skipped': return 'neutral';
      default: return 'neutral';
    }
  };

  const rawSteps: CallStep[] = Array.isArray(execution.steps) ? execution.steps : [];

  // Build step cards matching OCP_STEP_DEFS, plus End step
  const buildSteps = () => {
    const steps: { id: string; header: string; title: string; status: string; detail: string; response_data?: string; debug?: StepDebugInfo }[] = [];
    const isSuccess = execution.status === 'success' || execution.status === 'completed';
    const isFailed = execution.status === 'failed';

    for (const def of OCP_STEP_DEFS) {
      if (def.id === 'ocp-end') {
        steps.push({
          id: def.id,
          header: def.header,
          title: def.title,
          status: isSuccess ? 'completed' : 'pending',
          detail: isSuccess ? 'Call initiated successfully' : isFailed ? 'Call failed' : '—',
        });
        continue;
      }

      const rawStep = rawSteps.find(s => s.id === def.id);
      let status = rawStep?.status || 'pending';
      let detail = rawStep?.detail || def.detail;

      if (status === 'completed' && !detail) detail = 'Completed';

      steps.push({
        id: def.id,
        header: def.header,
        title: def.title,
        status,
        detail,
        response_data: rawStep?.response_data,
        debug: rawStep?.debug,
      });
    }

    return steps;
  };

  const allSteps = buildSteps();

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '1px solid hsl(var(--border))' }}
      >
        <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
          Execution Details
        </h3>
        <button
          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Status bar */}
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
        {allSteps.map((step, i) => {
          const hasData = !!step.response_data;
          const hasDebug = !!step.debug;
          const isExpanded = expandedSteps.has(step.id);
          const isDebugExpanded = expandedSteps.has(`${step.id}-debug`);

          return (
            <div key={step.id} className="groove-border bg-background">
              <div className="px-3 py-1.5 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground" style={fieldStyle}>#{i + 1}</span>
                  <span className="text-foreground" style={fieldStyle}>{step.header}</span>
                </div>
                <StatusTag variant={stepStatusVariant(step.status)}>
                  {step.status === 'running' ? 'PROCESSING' : step.status.toUpperCase()}
                </StatusTag>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                <div className="text-foreground" style={fieldStyle}>{step.title}</div>
                <div className={`text-muted-foreground ${cb}`} style={fieldStyle}>{step.detail}</div>

                {/* Duration badge */}
                {step.debug?.duration_ms != null && (
                  <span className="inline-block px-1.5 py-0.5 bg-muted text-muted-foreground rounded" style={{ ...fieldStyle, fontSize: '11px' }}>
                    {step.debug.duration_ms}ms
                  </span>
                )}

                {/* Error inline */}
                {step.debug?.error && (
                  <div className="text-destructive mt-1" style={{ ...fieldStyle, fontSize: '11px' }}>
                    ⚠ {step.debug.error}
                  </div>
                )}

                <div className="flex items-center gap-3 mt-1">
                  {hasData && (
                    <button
                      onClick={() => toggleExpand(step.id)}
                      className="flex items-center gap-1 text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
                      style={fieldStyle}
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      {isExpanded ? 'Hide response' : 'View response'}
                    </button>
                  )}
                  {hasDebug && (
                    <button
                      onClick={() => toggleExpand(`${step.id}-debug`)}
                      className="flex items-center gap-1 text-accent-foreground/70 hover:underline bg-transparent border-none p-0 cursor-pointer"
                      style={fieldStyle}
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isDebugExpanded ? 'rotate-180' : ''}`} />
                      {isDebugExpanded ? 'Hide debug' : 'Debug info'}
                    </button>
                  )}
                </div>

                {hasData && isExpanded && (
                  <pre
                    className={`mt-2 p-2 bg-muted/50 text-muted-foreground overflow-x-auto max-h-[200px] overflow-y-auto ${cb}`}
                    style={{ ...fieldStyle, fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                  >
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(step.response_data!), null, 2);
                      } catch {
                        return step.response_data;
                      }
                    })()}
                  </pre>
                )}

                {hasDebug && isDebugExpanded && (
                  <div className="mt-2 space-y-2">
                    {/* Request info */}
                    {step.debug!.request_url && (
                      <div className="groove-border p-2">
                        <div className="text-foreground mb-1" style={{ ...fieldStyle, fontSize: '11px', fontWeight: 600 }}>REQUEST</div>
                        <div className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '11px' }}>
                          <span className="text-primary">{step.debug!.request_method || 'GET'}</span>{' '}
                          <span style={{ wordBreak: 'break-all' }}>{step.debug!.request_url}</span>
                        </div>
                        {step.debug!.request_headers && (
                          <pre className="mt-1 text-muted-foreground overflow-x-auto" style={{ ...fieldStyle, fontSize: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(step.debug!.request_headers, null, 2)}
                          </pre>
                        )}
                        {step.debug!.request_body && (
                          <pre className="mt-1 p-1.5 bg-muted/30 text-muted-foreground overflow-x-auto max-h-[180px] overflow-y-auto" style={{ ...fieldStyle, fontSize: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(step.debug!.request_body, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Response info */}
                    {step.debug!.response_status != null && (
                      <div className="groove-border p-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-foreground" style={{ ...fieldStyle, fontSize: '11px', fontWeight: 600 }}>RESPONSE</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${step.debug!.response_status >= 200 && step.debug!.response_status < 300 ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`} style={{ ...fieldStyle, fontSize: '10px' }}>
                            {step.debug!.response_status}
                          </span>
                        </div>
                        {step.debug!.response_body && (
                          <pre className="p-1.5 bg-muted/30 text-muted-foreground overflow-x-auto max-h-[200px] overflow-y-auto" style={{ ...fieldStyle, fontSize: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(step.debug!.response_body, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Metadata */}
                    {step.debug!.metadata && Object.keys(step.debug!.metadata).length > 0 && (
                      <div className="groove-border p-2">
                        <div className="text-foreground mb-1" style={{ ...fieldStyle, fontSize: '11px', fontWeight: 600 }}>METADATA</div>
                        <pre className="p-1.5 bg-muted/30 text-muted-foreground overflow-x-auto max-h-[150px] overflow-y-auto" style={{ ...fieldStyle, fontSize: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {JSON.stringify(step.debug!.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Error */}
        {execution.error_message && (
          <div className="groove-border bg-background px-3 py-2">
            <Label className="field-text text-foreground">Error</Label>
            <p className="text-destructive mt-1" style={fieldStyle}>{execution.error_message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
/* ─── Execution Log Panel ─── */

const PAGE_SIZE = 100;

function CallExecutionLog({
  executions,
  onSelectExecution,
  selectedExecutionId,
  onClose,
  onReload,
}: {
  executions: CallExecution[];
  onSelectExecution: (ex: CallExecution) => void;
  selectedExecutionId: string | null;
  onClose: () => void;
  onReload: () => void;
}) {
  const { cb } = useCreatorMode();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredExecutions = useMemo(() => {
    if (!normalizedSearch) return executions;
    return executions.filter(ex => {
      const searchable = [ex.contact_name, ex.setter_name, ex.lead_id, ex.call_id, ex.status];
      return searchable.some(v => typeof v === 'string' && v.toLowerCase().includes(normalizedSearch));
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
      case 'success': case 'completed': return 'positive';
      case 'failed': return 'negative';
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
          placeholder="Search name, setter, or call ID..."
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredExecutions.length === 0 ? (
          <div className="p-4 text-muted-foreground" style={fieldStyle}>
            {normalizedSearch ? 'No executions match your search.' : 'No executions yet. Calls will appear here when campaigns trigger outbound calls.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {paginatedExecutions.map(ex => (
              <button
                key={ex.id}
                onClick={() => onSelectExecution(ex)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  selectedExecutionId === ex.id ? 'bg-accent/80' : 'hover:bg-accent/50'
                }`}
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
                  {ex.contact_name || 'Unknown'} — {ex.setter_name || 'N/A'}
                </div>
              </button>
            ))}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 py-3">
                <button
                  className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 disabled:opacity-40"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-foreground px-2" style={fieldStyle}>
                  {currentPage} / {totalPages}
                </span>
                <button
                  className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 disabled:opacity-40"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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

export default function OutboundCallProcessing() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { credentials } = useClientCredentials(clientId);
  const setterDisplayNames = (credentials?.setter_display_names || {}) as Record<string, string>;
  const [loading, setLoading] = useState(false);
  const [executions, setExecutions] = useState<CallExecution[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [selectedExecution, setSelectedExecution] = useState<CallExecution | null>(null);

  usePageHeader({
    title: 'Outbound Call Processing',
    breadcrumbs: [
      { label: 'Workflows', onClick: () => navigate(`/client/${clientId}/workflows`) },
      { label: 'Outbound Call Processing', badge: 'ACTIVE', badgeVariant: 'positive' as const },
    ],
  });

  // Fetch executions from call_history filtered by client
  const lastFetchRef = useRef(0);
  const fetchExecutions = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase
      .from('call_history')
      .select('*')
      .eq('client_id', clientId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      const mapped: CallExecution[] = (data as any[]).map(row => {
        // Use pre_call_context steps if available (stored by outbound-call-processing edge function)
        const preCallSteps: CallStep[] | null = row.pre_call_context?.steps || null;
        const fallbackSteps: CallStep[] = [
          { id: 'ocp-trigger', label: 'Campaign Trigger', node_type: 'trigger', status: 'completed' as const },
          { id: 'ocp-slots', label: 'Get Available Slots', node_type: 'action', status: 'completed' as const },
          { id: 'ocp-history', label: 'Get Text Setter History', node_type: 'action', status: 'completed' as const },
          { id: 'ocp-fields', label: 'Get Custom Fields', node_type: 'action', status: 'completed' as const },
          { id: 'ocp-call', label: 'Make Voice Setter Call', node_type: 'action', status: row.call_status === 'error' ? 'failed' as const : 'completed' as const },
        ];

        return {
          id: row.id,
          client_id: row.client_id,
          lead_id: row.contact_id || '',
          contact_name: row.to_number || 'Unknown',
          setter_name: row.setter_id ? setterLabel('voice', row.setter_id, setterDisplayNames) : row.agent_id ? `Agent ${row.agent_id.slice(0, 8)}...` : null,
          campaign_id: null,
          status: row.call_status === 'ended' || row.call_status === 'completed' ? 'success' : row.call_status === 'error' ? 'failed' : row.call_status || 'unknown',
          error_message: row.disconnect_reason === 'error' ? 'Call failed' : null,
          call_id: row.call_id,
          created_at: row.created_at,
          steps: preCallSteps || fallbackSteps,
        };
      });
      setExecutions(mapped);
    }
  }, [clientId]);

  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  // Realtime subscription
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`ocp-call-history-${clientId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'call_history', filter: `client_id=eq.${clientId}` },
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

  const canvasNodes: CanvasNode[] = useMemo(() => [
    {
      id: 'ocp-trigger',
      type: 'trigger' as const,
      data: { label: 'Campaign Trigger', triggerType: 'manual' as const, description: 'Launched by Trigger.dev when it\'s time to make a call' },
      children: ['ocp-slots'],
    },
    {
      id: 'ocp-slots',
      type: 'action' as const,
      data: { label: 'Get Available Slots', actionType: 'webhook' as const, method: 'GET' as const, url: '', headers: {}, body: '', description: 'Get available spots from the GoHighLevel calendar' },
      children: ['ocp-history'],
    },
    {
      id: 'ocp-history',
      type: 'action' as const,
      data: { label: 'Get Text Setter History', actionType: 'webhook' as const, method: 'GET' as const, url: '', headers: {}, body: '', description: 'Chat history, filtered by Lead ID' },
      children: ['ocp-fields'],
    },
    {
      id: 'ocp-fields',
      type: 'action' as const,
      data: { label: 'Get Custom Fields', actionType: 'webhook' as const, method: 'GET' as const, url: '', headers: {}, body: '', description: 'Fetch lead custom fields from GoHighLevel' },
      children: ['ocp-call'],
    },
    {
      id: 'ocp-call',
      type: 'action' as const,
      data: { label: 'Make Voice Setter Call', actionType: 'webhook' as const, method: 'POST' as const, url: '', headers: {}, body: '', description: 'Dynamic variables sent to Retell AI' },
      children: ['ocp-end'],
    },
    {
      id: 'ocp-end',
      type: 'end' as const,
      data: { label: 'End', description: 'Call initiated successfully' } as any,
      children: [],
    },
  ], []);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setRightPanel('config');
  }, []);

  const handleDeselectNode = useCallback(() => {}, []);

  const handleSelectExecution = useCallback((ex: CallExecution) => {
    setSelectedExecution(ex);
    setRightPanel('execution-detail');
    setSelectedNodeId(null);
  }, []);

  // Build nodeStatuses for canvas highlighting from selected execution
  const nodeStatuses = useMemo(() => {
    if (!selectedExecution?.steps || rightPanel !== 'execution-detail') return undefined;
    const map = new Map<string, NodeExecutionStatus>();
    const isSuccess = selectedExecution.status === 'success' || selectedExecution.status === 'completed';
    const isFailed = selectedExecution.status === 'failed';

    for (const step of selectedExecution.steps) {
      if (step.status === 'completed') {
        map.set(step.id, 'completed');
      } else if (step.status === 'failed') {
        map.set(step.id, 'failed');
      } else if (step.status === 'running') {
        map.set(step.id, 'processing');
      }
    }

    // Highlight end node when call succeeded
    if (isSuccess) {
      map.set('ocp-end', 'completed');
    } else if (isFailed) {
      map.set('ocp-end', 'failed');
    }

    return map.size > 0 ? map : undefined;
  }, [selectedExecution, rightPanel]);

  // Keep highlightedNodeIds for connector glow
  const highlightedNodeIds = useMemo(() => {
    if (!nodeStatuses) return undefined;
    const ids = new Set<string>();
    nodeStatuses.forEach((status, id) => {
      if (status === 'completed' || status === 'processing') {
        ids.add(id);
      }
    });
    return ids.size > 0 ? ids : undefined;
  }, [nodeStatuses]);

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
          nodeStatuses={nodeStatuses}
          highlightedNodeIds={highlightedNodeIds}
          readOnly
          onSelectNode={handleSelectNode}
          onAddNode={() => {}}
          onDeselectNode={handleDeselectNode}
        />
      </div>

      {/* Right Panel */}
      {rightPanel === 'config' && selectedNodeId && (
        <CallNodeConfig
          nodeId={selectedNodeId}
          onClose={() => { setSelectedNodeId(null); setRightPanel(null); }}
        />
      )}
      {rightPanel === 'executions' && (
        <CallExecutionLog
          executions={executions}
          onSelectExecution={handleSelectExecution}
          selectedExecutionId={selectedExecution?.id || null}
          onClose={() => setRightPanel(null)}
          onReload={fetchExecutions}
        />
      )}
      {rightPanel === 'execution-detail' && selectedExecution && (
        <CallExecutionDetail
          execution={selectedExecution}
          onClose={() => { setSelectedExecution(null); setRightPanel('executions'); }}
        />
      )}
    </div>
  );
}
