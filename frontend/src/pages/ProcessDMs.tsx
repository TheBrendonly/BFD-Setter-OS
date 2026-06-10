// Process DMs workflow page
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { Zap, Clock, Send, Copy, X, ClipboardCheck, Users, Power, Wrench, RefreshCw, Expand, Info, ExternalLink, StopCircle, Plus, Trash2, Search, ChevronLeft, ChevronRight } from '@/components/icons';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import RetroLoader from '@/components/RetroLoader';
import SavingOverlay from '@/components/SavingOverlay';
import WorkflowCanvas, { type CanvasNode } from '@/components/workflow/WorkflowCanvas';
import { format } from 'date-fns';

const SUPABASE_URL = 'https://qfbhcixkxzivpmxlciot.supabase.co';
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/receive-dm-webhook`;

const fieldStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;
const tabStyle = { fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' } as const;

interface DmMessageEntry {
  body: string;
  received_at: string;
}

interface SetterDelayItem {
  slotId: string;
  responseDelaySeconds: number;
}

interface DmExecution {
  id: string;
  trigger_run_id: string | null;
  contact_name: string | null;
  status: string | null;
  stage_description: string | null;
  resume_at: string | null;
  messages_received: number | null;
  started_at: string | null;
  completed_at: string | null;
  lead_id: string;
  ghl_account_id: string;
  grouped_message: string | null;
  messages: DmMessageEntry[] | null;
  trigger_payload: Record<string, string> | null;
  followup_status: string | null;
  followup_resume_at: string | null;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ─── Right-side config panel for read-only node details ─── */

function ProcessDMsNodeConfig({
  nodeId,
  debounceSeconds,
  onDebounceChange,
  saving,
  executions,
  onClose,
  onConfigureDelay,
  onConfigureFollowupDelay,
  onConfigureFollowupInstructions,
  primarySetterSlotId,
}: {
  nodeId: string;
  debounceSeconds: number;
  onDebounceChange: (val: number) => void;
  saving: boolean;
  executions: DmExecution[];
  onClose: () => void;
  onConfigureDelay: () => void;
  onConfigureFollowupDelay: () => void;
  onConfigureFollowupInstructions: () => void;
  primarySetterSlotId: string;
}) {
  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    toast.success('Webhook URL copied');
  };

  const activeCount = (statuses: string[]) => executions.filter(e => statuses.includes(e.status || '')).length;

  const renderContent = () => {
    // Handle dynamic follow-up node IDs
    const followupWaitMatch = nodeId.match(/^dm-followup-wait-(\d+)$/);
    const followupMatch = nodeId.match(/^dm-followup-(\d+)$/);
    const doneMatch = nodeId.match(/^dm-done-(\d+)$/);
    const followupDoneMatch = nodeId.match(/^dm-followup-done-(\d+)$/);

    switch (nodeId) {
      case 'dm-trigger':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="field-text text-foreground">Webhook URL</Label>
              <div className="flex items-center gap-2">
                <Input value={WEBHOOK_URL} readOnly className="field-text text-xs flex-1" />
                <button className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50" onClick={copyWebhookUrl}>
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="text-muted-foreground" style={fieldStyle}>
              Paste this URL into your GHL workflow as a webhook action on message received
            </p>
            {activeCount(['waiting', 'grouping', 'sending']) > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground" style={fieldStyle}>
                <Users className="w-3.5 h-3.5" />
                <span>{activeCount(['waiting', 'grouping', 'sending'])} active contacts</span>
              </div>
            )}
          </div>
        );
      case 'dm-group':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value="?"
                  readOnly
                  className="field-text w-24 opacity-70 cursor-not-allowed"
                />
                <span className="text-muted-foreground" style={fieldStyle}>seconds</span>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-muted-foreground" style={fieldStyle}>
                This controls how long the agent will wait to:
              </p>
              <ul className="text-muted-foreground space-y-1 pl-4" style={fieldStyle}>
                <li className="list-disc">Receive all messages from the lead within the window</li>
                <li className="list-disc">Group them together and reply once the timer expires</li>
              </ul>
              <p className="text-muted-foreground" style={fieldStyle}>
                For example, if set to 60 seconds, the agent will wait 60 seconds, collect all messages sent during that time, and then reply.
              </p>
              <div className="border-t border-dashed border-border" />
              <p className="text-muted-foreground" style={fieldStyle}>
                This delay is configured <strong>per setter</strong> and this workflow is currently reflecting <strong>{primarySetterSlotId}</strong>. Change it in Text Setter settings.
              </p>
            </div>
            <button
              onClick={onConfigureDelay}
              className="groove-btn !h-8 px-3 flex items-center gap-1.5 uppercase text-foreground"
              style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
            >
              <Wrench className="w-3.5 h-3.5" /> Configure
            </button>
            {activeCount(['waiting']) > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground" style={fieldStyle}>
                <Users className="w-3.5 h-3.5" />
                <span>{activeCount(['waiting'])} contacts waiting</span>
              </div>
            )}
          </div>
        );
      case 'dm-send':
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Native text engine — no extra config needed. Setter replies are generated by the platform's built-in AI.
            </p>
            {activeCount(['sending', 'grouping']) > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground" style={fieldStyle}>
                <Users className="w-3.5 h-3.5" />
                <span>{activeCount(['sending', 'grouping'])} contacts processing</span>
              </div>
            )}
          </div>
        );
      default:
        break;
    }

    // Dynamic follow-up wait nodes (dm-followup-wait-N)
    if (followupWaitMatch) {
      const idx = parseInt(followupWaitMatch[1]);
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value="?"
                readOnly
                className="field-text w-24 opacity-70 cursor-not-allowed"
              />
              <span className="text-muted-foreground" style={fieldStyle}>seconds</span>
            </div>
          </div>
          <p className="text-muted-foreground" style={fieldStyle}>
            This controls how long the agent waits for the lead to reply before sending follow-up #{idx}. If the lead responds within this window, the sequence stops.
          </p>
          <div className="border-t border-dashed border-border" />
          <p className="text-muted-foreground" style={fieldStyle}>
            This delay is configured <strong>per setter</strong> and this workflow is currently reflecting <strong>{primarySetterSlotId}</strong>. Change it in Text Setter settings.
          </p>
          <button
            onClick={() => onConfigureFollowupDelay()}
            className="groove-btn !h-8 px-3 flex items-center gap-1.5 uppercase text-foreground"
            style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
          >
            <Wrench className="w-3.5 h-3.5" /> Configure
          </button>
          <div className="border-t border-dashed border-border" />
           <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-none bg-success" />
              <span className="text-success" style={fieldStyle}>Lead Replied</span>
              <span className="text-muted-foreground" style={fieldStyle}>→ end sequence</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-none bg-destructive" />
              <span className="text-destructive" style={fieldStyle}>No Reply</span>
              <span className="text-muted-foreground" style={fieldStyle}>→ follow-up #{idx}</span>
            </div>
          </div>
        </div>
      );
    }

    // Dynamic follow-up message nodes (dm-followup-N)
    if (followupMatch) {
      const idx = parseInt(followupMatch[1]);
      return (
        <div className="space-y-4">
          <p className="text-foreground" style={fieldStyle}>
            Follow-up message #{idx} is generated using the full conversation history and your setter prompt.
          </p>
          <p className="text-muted-foreground" style={fieldStyle}>
            Each setter can have its own follow-up instructions, allowing you to customize the tone and style of follow-up messages per setter.
          </p>
          <button
            onClick={() => onConfigureFollowupInstructions()}
            className="groove-btn !h-8 px-3 flex items-center gap-1.5 uppercase text-foreground w-full"
            style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Configure Follow-up Instructions
          </button>
        </div>
      );
    }

    // Dynamic end nodes
    if (doneMatch) {
      return (
        <div className="space-y-4">
          <p className="text-foreground" style={fieldStyle}>
            Lead replied — sequence stopped.
          </p>
          <p className="text-muted-foreground" style={fieldStyle}>
            The lead replied within the follow-up window, so the remaining follow-ups are cancelled automatically.
          </p>
        </div>
      );
    }

    if (followupDoneMatch) {
      return (
        <div className="space-y-4">
          <p className="text-foreground" style={fieldStyle}>
            All follow-ups sent — sequence complete.
          </p>
          <p className="text-muted-foreground" style={fieldStyle}>
            The agent has exhausted all follow-up attempts. The lead will need to reply to restart the conversation.
          </p>
        </div>
      );
    }

    return null;
  };

  // Dynamic title resolution
  const getTitle = (id: string): string => {
    const staticTitles: Record<string, string> = {
      'dm-trigger': 'Receive Message',
      'dm-group': 'Wait Before Replying',
      'dm-send': 'Generate Reply',
    };
    if (staticTitles[id]) return staticTitles[id];
    const fwMatch = id.match(/^dm-followup-wait-(\d+)$/);
    if (fwMatch) return `Follow-Up Delay #${fwMatch[1]}`;
    const fuMatch = id.match(/^dm-followup-(\d+)$/);
    if (fuMatch) return `Follow-Up #${fuMatch[1]}`;
    if (id.match(/^dm-done-\d+$/) || id.match(/^dm-followup-done-\d+$/)) return 'End';
    return 'Config';
  };

  return (
      <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
      >
          <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
          {getTitle(nodeId)}
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

/* ─── Execution detail panel — step by step like custom workflows ─── */

interface FollowupTimerRow {
  id: string;
  status: string;
  fires_at: string | null;
  followup_message: string | null;
  sequence_index: number | null;
  created_at: string | null;
  trigger_run_id: string | null;
}

async function getAllFollowupTimers(
  ghlContactId: string,
  ghlAccountId: string,
  afterTimestamp?: string | null,
  triggerRunId?: string | null,
  beforeTimestamp?: string | null,
): Promise<FollowupTimerRow[]> {
  const baseQuery = () =>
    (supabase as any)
      .from('followup_timers')
      .select('id, status, fires_at, followup_message, sequence_index, created_at, trigger_run_id')
      .eq('lead_id', ghlContactId)
      .eq('ghl_account_id', ghlAccountId)
      .order('created_at', { ascending: false })
      .limit(10);

  const dedupe = (rows: FollowupTimerRow[] | null | undefined) => {
    if (!rows || rows.length === 0) return [];
    const byIndex = new Map<number, FollowupTimerRow>();
    for (const row of rows) {
      const idx = row.sequence_index ?? 1;
      if (!byIndex.has(idx)) byIndex.set(idx, row);
    }
    return [1, 2, 3].map(i => byIndex.get(i)).filter(Boolean) as FollowupTimerRow[];
  };

  if (triggerRunId) {
    const { data: exactTimers } = await baseQuery().eq('trigger_run_id', triggerRunId);
    const exact = dedupe(exactTimers as FollowupTimerRow[] | null | undefined);
    if (exact.length > 0) return exact;
  }

  let query = baseQuery();
  if (afterTimestamp) {
    query = query.gte('created_at', afterTimestamp);
  }
  if (beforeTimestamp) {
    query = query.lte('created_at', beforeTimestamp);
  }

  const { data } = await query;
  return dedupe(data as FollowupTimerRow[] | null | undefined);
}

function DmExecutionDetail({
  execution,
  onClose,
  onReload,
  initialFollowupTimers,
  timerUpperBound,
}: {
  execution: DmExecution;
  onClose: () => void;
  onReload: () => Promise<void> | void;
  initialFollowupTimers?: FollowupTimerRow[] | undefined;
  timerUpperBound?: string | null;
}) {
  const { clientId } = useParams();
  const { cb } = useCreatorMode();
  const navigate = useNavigate();
  const [expandedMessage, setExpandedMessage] = useState<{ title: string; body: string } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushingFollowup, setPushingFollowup] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);
  const [followupTimers, setFollowupTimers] = useState<FollowupTimerRow[] | undefined>(initialFollowupTimers);

  // Helper to get timer by sequence index
  const getTimer = (idx: number) => followupTimers?.find(t => t.sequence_index === idx) ?? null;

  const sleep = useCallback((ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms)), []);

  const refreshFollowupTimers = useCallback(async () => {
    if (execution.status !== 'completed') {
      setFollowupTimers(undefined);
      return [];
    }
    const timers = await getAllFollowupTimers(
      execution.lead_id,
      execution.ghl_account_id,
      execution.started_at,
      execution.trigger_run_id,
      timerUpperBound,
    );
    setFollowupTimers(timers);
    return timers;
  }, [execution.status, execution.lead_id, execution.ghl_account_id, execution.started_at, execution.trigger_run_id, timerUpperBound]);

  const waitForExecutionToLeaveWaiting = useCallback(async () => {
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
      const { data } = await (supabase as any)
        .from('dm_executions')
        .select('status')
        .eq('id', execution.id)
        .single();

      if (data && data.status && data.status !== 'waiting') {
        return data;
      }

      await sleep(800);
    }

    return null;
  }, [execution.id, sleep]);

  const waitForFollowupTerminalState = useCallback(async (timerId: string) => {
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
      const { data } = await (supabase as any)
        .from('followup_timers')
        .select('id, status, fires_at, followup_message, sequence_index')
        .eq('id', timerId)
        .maybeSingle();

      if (data) {
        // Update the specific timer in the array
        setFollowupTimers(prev => {
          if (!prev) return [data as FollowupTimerRow];
          const idx = prev.findIndex(t => t.id === data.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = data as FollowupTimerRow; return next; }
          return [...prev, data as FollowupTimerRow];
        });
        if (['fired', 'cancelled', 'failed'].includes(data.status)) {
          return data;
        }
      }

      await sleep(800);
    }

    return null;
  }, [sleep]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      await refreshFollowupTimers();
    };

    load();

    if (execution.status !== 'completed') {
      return () => { cancelled = true; };
    }

    const interval = window.setInterval(load, 1500);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [execution.status, refreshFollowupTimers]);

  const handlePushNow = async () => {
    setPushing(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/push-dm-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution_id: execution.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Failed to push');
        return;
      }

      await waitForExecutionToLeaveWaiting();
      await onReload();
      toast.success('Pushed — processing immediately');
    } catch {
      toast.error('Failed to push');
    } finally {
      setPushing(false);
    }
  };

  // Find the currently pending timer (for push/stop actions)
  const pendingTimer = followupTimers?.find(t => t.status === 'pending' || t.status === 'firing') ?? null;
  const activeTimerStatus = pendingTimer?.status ?? null;
  const activeTimerFiresAt = pendingTimer?.fires_at ?? null;

  const handlePushFollowupNow = async () => {
    setPushingFollowup(true);
    try {
      let timer = pendingTimer;
      if (!timer) {
        const refreshed = await refreshFollowupTimers();
        timer = refreshed.find(t => t.status === 'pending' || t.status === 'firing') ?? null;
      }

      if (!timer?.id) {
        toast.error('No pending follow-up timer found');
        return;
      }

      // Use supabase.functions.invoke (not a raw fetch) so the logged-in user's
      // JWT is forwarded — push-followup-now now enforces authorizeClientRequest
      // (2026-06-10) — and so the call targets the live project (the bare fetch
      // hardcoded the stale qfbhcixkxzivpmxlciot ref). Mirrors push-engagement-now.
      const { error } = await supabase.functions.invoke('push-followup-now', {
        body: { timer_id: timer.id },
      });
      if (error) throw error;

      await waitForFollowupTerminalState(timer.id);
      await refreshFollowupTimers();
      await onReload();
      toast.success('Follow-up pushed — sending immediately');
    } catch {
      toast.error('Failed to push follow-up');
    } finally {
      setPushingFollowup(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      const isFollowup = execution.status === 'completed' && activeTimerStatus && (activeTimerStatus === 'pending' || activeTimerStatus === 'firing');
      const isDelay = execution.status === 'waiting';

      if (isFollowup) {
        let timer = pendingTimer;
        if (!timer) {
          const refreshed = await refreshFollowupTimers();
          timer = refreshed.find(t => t.status === 'pending' || t.status === 'firing') ?? null;
        }
        if (!timer?.id) { toast.error('No pending follow-up timer found'); return; }

        const res = await fetch(`${SUPABASE_URL}/functions/v1/stop-dm-execution`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'followup', timer_id: timer.id }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) { toast.error(data?.error || 'Failed to stop'); return; }

        await refreshFollowupTimers();
        await onReload();
        toast.success('Follow-up cancelled');
      } else if (isDelay) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/stop-dm-execution`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'delay', execution_id: execution.id }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) { toast.error(data?.error || 'Failed to stop'); return; }

        await onReload();
        toast.success('Execution cancelled');
      }
    } catch {
      toast.error('Failed to stop execution');
    } finally {
      setStopping(false);
    }
  };


  const messages: DmMessageEntry[] = useMemo(() => {
    const raw = execution.messages;
    if (Array.isArray(raw) && raw.length > 0) {
      return [...raw].sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
    }

    if (execution.grouped_message) {
      return execution.grouped_message
        .split('\n')
        .map(part => part.trim())
        .filter(Boolean)
        .map((body, index) => ({
          body,
          received_at: execution.started_at || String(index),
        }));
    }

    return [];
  }, [execution.messages, execution.grouped_message, execution.started_at]);


  const statusVariant = (status: string | null): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'completed': return 'positive';
      case 'failed': return 'negative';
      case 'cancelled': return 'neutral';
      case 'waiting': return 'warning';
      case 'grouping':
      case 'sending': return 'neutral';
      default: return 'neutral';
    }
  };

  const stepStatusVariant = (status: string): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'completed': return 'positive';
      case 'failed': return 'negative';
      case 'running': return 'warning';
      case 'skipped': return 'neutral';
      case 'disabled': return 'neutral';
      default: return 'neutral';
    }
  };

  // Format countdown from diff in ms
  const formatCountdown = (diffMs: number): string => {
    if (diffMs <= 0) return '0s';
    const totalSeconds = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  // Countdown timer for waiting state (delay)
  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (execution.status !== 'waiting' || !execution.resume_at) return;
    const update = () => {
      const diff = new Date(execution.resume_at!).getTime() - Date.now();
      setCountdown(formatCountdown(diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [execution.status, execution.resume_at]);

  // Countdown for the currently active follow-up timer
  const [followupCountdown, setFollowupCountdown] = useState('');
  useEffect(() => {
    if (!activeTimerFiresAt || !(activeTimerStatus === 'pending' || activeTimerStatus === 'firing')) return;
    const update = () => {
      const diff = new Date(activeTimerFiresAt).getTime() - Date.now();
      setFollowupCountdown(formatCountdown(diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeTimerStatus, activeTimerFiresAt]);

  // Build synthetic steps
  const triggerStep = {
    id: 'step-trigger',
    label: 'Receive Message',
    nodeType: 'trigger',
    status: execution.started_at ? 'completed' : 'pending',
    timestamp: execution.started_at,
    detail: execution.contact_name || 'Unknown',
    contactId: execution.lead_id,
  };

  const groupStep = {
    id: 'step-group',
    label: 'Wait Before Replying',
    nodeType: 'delay',
    status:
      execution.status === 'waiting' ? 'running' :
      execution.status === 'grouping' || execution.status === 'sending' || execution.status === 'completed' ? 'completed' :
      execution.status === 'failed' ? 'completed' : 'pending',
    timestamp: execution.resume_at,
    detail: execution.status === 'waiting' && countdown
      ? countdown
      : execution.status === 'completed' || execution.status === 'grouping' || execution.status === 'sending'
        ? 'Completed'
        : '—',
  };

  const sendStep = {
    id: 'step-send',
    label: 'Generate Reply',
    nodeType: 'text_setter',
    status:
      execution.status === 'sending' ? 'running' :
      execution.status === 'completed' ? 'completed' :
      execution.status === 'failed' ? 'failed' : 'pending',
    timestamp: execution.completed_at,
    detail: execution.status === 'completed'
      ? 'Reply sent to AI agent'
      : execution.status === 'sending'
        ? 'Generating reply...'
        : execution.stage_description || '—',
  };

  // Build follow-up steps: 3 pairs of (delay + text_setter)
  const buildFollowupStepPair = (seqIdx: number) => {
    const timer = getTimer(seqIdx);
    const prevTimer = seqIdx > 1 ? getTimer(seqIdx - 1) : null;

    // Determine if this pair should be active based on previous pair's completion
    const prevCompleted = seqIdx === 1
      ? execution.status === 'completed'
      : prevTimer?.status === 'fired';

    const delayStep = (() => {
      if (!prevCompleted) {
        // Check if previous was cancelled (lead replied) — then this pair is skipped
        if (seqIdx > 1 && prevTimer?.status === 'cancelled') {
          return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'skipped', timestamp: null as string | null, detail: 'Lead replied — skipped' };
        }
        return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'pending', timestamp: null as string | null, detail: '—' };
      }

      // Timers still loading
      if (followupTimers === undefined) {
        return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'pending', timestamp: null as string | null, detail: 'Loading...' };
      }

      // No timer for this index — not configured
      if (!timer) {
        return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'disabled', timestamp: null as string | null, detail: 'Not configured' };
      }

      switch (timer.status) {
        case 'pending':
        case 'firing':
          return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'running', timestamp: timer.fires_at, detail: timer === pendingTimer && followupCountdown ? followupCountdown : 'Processing...' };
        case 'fired':
          return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'completed', timestamp: timer.fires_at, detail: 'Completed' };
        case 'cancelled':
          return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'completed', timestamp: null as string | null, detail: 'Lead replied' };
        case 'failed':
          return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'completed', timestamp: null as string | null, detail: 'Completed' };
        default:
          return { id: `step-followup-delay-${seqIdx}`, label: `Follow-Up Delay #${seqIdx}`, nodeType: 'delay' as const, status: 'pending', timestamp: null as string | null, detail: '—' };
      }
    })();

    const textSetterStep = (() => {
      if (!prevCompleted || followupTimers === undefined) {
        if (seqIdx > 1 && prevTimer?.status === 'cancelled') {
          return { id: `step-followup-setter-${seqIdx}`, label: `Generate Follow-Up #${seqIdx}`, nodeType: 'text_setter' as const, status: 'skipped', timestamp: null as string | null, detail: 'Lead replied — skipped' };
        }
        return { id: `step-followup-setter-${seqIdx}`, label: `Generate Follow-Up #${seqIdx}`, nodeType: 'text_setter' as const, status: 'pending', timestamp: null as string | null, detail: '—' };
      }

      if (!timer) {
        return { id: `step-followup-setter-${seqIdx}`, label: `Generate Follow-Up #${seqIdx}`, nodeType: 'text_setter' as const, status: 'disabled', timestamp: null as string | null, detail: 'Not configured' };
      }

      switch (timer.status) {
        case 'fired':
          return { id: `step-followup-setter-${seqIdx}`, label: `Generate Follow-Up #${seqIdx}`, nodeType: 'text_setter' as const, status: 'completed', timestamp: timer.fires_at, detail: timer.followup_message ? `Follow-up sent: ${timer.followup_message.slice(0, 100)}${timer.followup_message.length > 100 ? '…' : ''}` : 'Follow-up generated and sent' };
        case 'failed':
          return { id: `step-followup-setter-${seqIdx}`, label: `Generate Follow-Up #${seqIdx}`, nodeType: 'text_setter' as const, status: 'failed', timestamp: null as string | null, detail: 'Follow-up generation failed' };
        case 'cancelled':
          return { id: `step-followup-setter-${seqIdx}`, label: `Generate Follow-Up #${seqIdx}`, nodeType: 'text_setter' as const, status: 'skipped', timestamp: null as string | null, detail: 'Lead replied — skipped' };
        default:
          return { id: `step-followup-setter-${seqIdx}`, label: `Generate Follow-Up #${seqIdx}`, nodeType: 'text_setter' as const, status: 'pending', timestamp: null as string | null, detail: '—' };
      }
    })();

    return [delayStep, textSetterStep];
  };

  const followupPairs = [1, 2, 3].flatMap(i => buildFollowupStepPair(i));

  // End step — find the last meaningful timer
  const lastTimer = followupTimers && followupTimers.length > 0
    ? followupTimers[followupTimers.length - 1]
    : null;

  const endStep = (() => {
    // If any timer is cancelled (lead replied), end is completed
    const cancelledTimer = followupTimers?.find(t => t.status === 'cancelled');
    if (cancelledTimer) {
      return { id: 'step-end', label: 'End', nodeType: 'end', status: 'completed', timestamp: null as string | null, detail: 'Lead replied — sequence complete' };
    }
    // If the last fired timer exists and no more are pending
    if (lastTimer?.status === 'fired' && !pendingTimer) {
      return { id: 'step-end', label: 'End', nodeType: 'end', status: 'completed', timestamp: null as string | null, detail: 'Follow-up sent — now waiting for the lead to reply' };
    }
    return { id: 'step-end', label: 'End', nodeType: 'end', status: 'pending', timestamp: null as string | null, detail: '—' };
  })();

  const allSteps = [triggerStep, groupStep, sendStep, ...followupPairs, endStep];

  const MessageField = useCallback(({ label, body }: { label: string; body: string }) => (
    <div className="space-y-1">
      <Label className="field-text text-foreground">{label}</Label>
      <div className="relative">
        <Input value={body} readOnly className={`field-text text-xs pr-10 ${cb}`} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 hover:!bg-transparent focus:!bg-transparent active:!translate-y-[-50%]"
          onClick={() => setExpandedMessage({ title: label, body })}
        >
          <Expand className="h-4 w-4" />
        </Button>
      </div>
    </div>
  ), []);

  return (
    <>
      <SavingOverlay isVisible={pushing || pushingFollowup || stopping} message={stopping ? 'Ending execution...' : pushing ? 'Pushing now...' : 'Pushing follow-up...'} variant="fixed" />
      <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
        <div
          className="px-4 shrink-0 flex items-center justify-between"
          style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
              Execution Details
            </h3>
            {(execution.status === 'waiting' || (execution.status === 'completed' && followupTimers !== undefined && !!pendingTimer)) && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-[1px] bg-warning opacity-75" />
                <span className="relative inline-flex rounded-[1px] h-2 w-2 bg-warning" />
              </span>
            )}
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

        {/* Overall status */}
        {(execution.status === 'waiting' || (execution.status === 'completed' && followupTimers !== undefined && !!pendingTimer)) ? (
          <div className="px-4 py-3 border-b border-border/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground" style={fieldStyle}>
                {execution.status === 'waiting' && countdown
                  ? countdown
                  : followupCountdown || '—'}
              </span>
              <span className="text-muted-foreground" style={fieldStyle}>
                {execution.started_at ? format(new Date(execution.started_at), 'MMM d, HH:mm:ss') : '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="groove-btn groove-btn-destructive !h-7 px-3 uppercase flex items-center flex-1 justify-center"
                style={{ fontFamily: "'VT323', monospace", fontSize: '14px', letterSpacing: '0.06em' }}
                onClick={() => setStopConfirmOpen(true)}
                disabled={stopping}
              >
                <StopCircle className="h-3.5 w-3.5" />
                <span className="ml-1.5">{stopping ? 'ENDING...' : 'END NOW'}</span>
              </button>
              <button
                className="groove-btn !h-7 px-3 uppercase text-foreground flex items-center flex-1 justify-center"
                style={{ fontFamily: "'VT323', monospace", fontSize: '14px', letterSpacing: '0.06em' }}
                onClick={() => setPushConfirmOpen(true)}
                disabled={pushing || pushingFollowup}
              >
                <Zap className="h-3.5 w-3.5" />
                <span className="ml-1.5">{(pushing || pushingFollowup) ? 'PUSHING...' : 'PUSH NOW'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusTag variant={statusVariant(execution.status)}>
                {execution.status === 'cancelled' ? 'ENDED' : (execution.status || 'unknown').toUpperCase()}
              </StatusTag>
            </div>
            <span className="text-muted-foreground" style={fieldStyle}>
              {execution.started_at ? format(new Date(execution.started_at), 'MMM d, HH:mm:ss') : '—'}
            </span>
          </div>
        )}

        {/* Step-by-step breakdown */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {allSteps.map((step, idx) => {
            const defaultHeaders: Record<string, string> = {
              trigger: 'Trigger',
              delay: 'Delay',
              text_setter: 'Text Setter',
              follow_up: 'Follow-Up Delay',
              end: 'End',
            };
            const getStepPresentation = () => {
              if (step.id === 'step-trigger') return { header: 'Trigger', title: 'Receive Message' };
              if (step.id === 'step-group') return { header: 'Delay', title: 'Wait Before Replying' };
              if (step.id === 'step-send') return { header: 'Text Setter', title: 'Generate Reply' };
              if (step.id.startsWith('step-followup-delay-')) {
                const followupIndex = step.id.match(/step-followup-delay-(\d+)/)?.[1];
                return {
                  header: followupIndex ? `Follow-Up Delay #${followupIndex}` : 'Follow-Up Delay',
                  title: 'Wait for Reply',
                };
              }
              if (step.id.startsWith('step-followup-setter-')) {
                return { header: 'Text Setter', title: step.label };
              }
              if (step.id === 'step-end') return { header: 'End', title: 'End' };
              return { header: defaultHeaders[step.nodeType] || step.nodeType, title: step.label };
            };
            const { header, title } = getStepPresentation();
            return (
            <div key={step.id} className="groove-border bg-background">
              <div className="px-3 py-1.5 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground" style={fieldStyle}>#{idx + 1}</span>
                  <span className="text-foreground" style={fieldStyle}>{header}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusTag variant={stepStatusVariant(step.status)}>
                    {step.status === 'running' ? 'PROCESSING' : step.status.toUpperCase()}
                  </StatusTag>
                </div>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                <div className="text-foreground" style={fieldStyle}>{title}</div>
                {step.id === 'step-trigger' ? (
                  <>
                    <button
                      className="text-primary hover:underline cursor-pointer bg-transparent border-none p-0 text-left"
                      style={fieldStyle}
                      onClick={async () => {
                        const { data } = await supabase
                          .from('leads')
                          .select('id')
                          .eq('client_id', clientId!)
                          .eq('lead_id', execution.lead_id)
                          .maybeSingle();
                        if (data?.id) {
                          navigate(`/client/${clientId}/leads/${data.id}`);
                        } else {
                          toast.error('Contact not found');
                        }
                      }}
                    >
                      <span className={cb}>{step.detail}</span> ↗
                    </button>
                    {step.timestamp && step.status === 'completed' && (
                      <div className="text-muted-foreground" style={fieldStyle}>
                        {format(new Date(step.timestamp), 'HH:mm:ss')}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className={`text-muted-foreground ${cb}`} style={fieldStyle}>{step.detail}</div>
                    {step.timestamp && step.status === 'completed' && (
                      <div className="text-muted-foreground" style={fieldStyle}>
                        {format(new Date(step.timestamp), 'HH:mm:ss')}
                      </div>
                    )}
                  </>
                )}

                {/* Trigger payload fields */}
                {step.id === 'step-trigger' && execution.trigger_payload && Object.keys(execution.trigger_payload).length > 0 && (
                  <div className="space-y-2 mt-1">
                    {Object.entries(execution.trigger_payload)
                      .filter(([key, v]) => v && String(v).trim() !== '' && ['Lead_ID', 'lead_id', 'GHL_Account_ID', 'ghl_account_id', 'Setter_Number', 'setter_number'].includes(key))
                      .map(([key, value]) => (
                        <div key={key} className="space-y-1">
                          <Label className="field-text text-foreground">{key}</Label>
                          <Input value={String(value)} readOnly className={`field-text text-xs ${cb}`} />
                        </div>
                      ))}
                  </div>
                )}

                {/* Messages inside the delay/group step */}
                {step.id === 'step-group' && (messages.length > 0 || (execution.messages_received ?? 0) > 0) && (
                  <div className="space-y-2 mt-1">
                    {messages.map((msg, mIdx) => (
                      <MessageField key={mIdx} label={`Message ${mIdx + 1}`} body={msg.body} />
                    ))}
                    {execution.grouped_message && (
                      <MessageField label="Grouped Message" body={execution.grouped_message} />
                    )}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Expand message dialog */}
      <Dialog open={!!expandedMessage} onOpenChange={() => setExpandedMessage(null)}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              {expandedMessage?.title?.toUpperCase()}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              {expandedMessage?.body}
            </p>
            <button
              className="groove-btn !h-8 px-4 uppercase text-foreground w-full"
              style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
              onClick={() => setExpandedMessage(null)}
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stop confirmation dialog */}
      <Dialog open={stopConfirmOpen} onOpenChange={setStopConfirmOpen}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              END EXECUTION
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <p className="text-sm text-muted-foreground leading-relaxed" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
              Are you sure you want to end this execution? This will cancel the {execution.status === 'waiting' ? 'delay timer' : 'follow-up sequence'} and cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                className="groove-btn !h-8 px-4 uppercase text-foreground flex-1"
                style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
                onClick={() => setStopConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="groove-btn groove-btn-destructive !h-8 px-4 uppercase flex-1 flex items-center justify-center gap-2"
                style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
                onClick={() => {
                  setStopConfirmOpen(false);
                  handleStop();
                }}
              >
                <StopCircle className="h-4 w-4" />
                End
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Push now confirmation dialog */}
      <Dialog open={pushConfirmOpen} onOpenChange={setPushConfirmOpen}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              PUSH NOW
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <p className="text-sm text-muted-foreground leading-relaxed" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
              Are you sure you want to push now? This will skip the current {execution.status === 'waiting' ? 'delay timer' : 'follow-up wait'} and advance the execution immediately.
            </p>
            <div className="flex gap-3">
              <button
                className="groove-btn !h-8 px-4 uppercase text-foreground flex-1"
                style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
                onClick={() => setPushConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className="groove-btn !h-8 px-4 uppercase flex-1 flex items-center justify-center gap-2 text-foreground"
                style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}
                onClick={() => {
                  setPushConfirmOpen(false);
                  execution.status === 'waiting' ? handlePushNow() : handlePushFollowupNow();
                }}
              >
                <Zap className="h-4 w-4" />
                Push
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Right-side execution list panel ─── */

function DmExecutionLog({
  executions,
  onSelectExecution,
  onClose,
  onReload,
  nodeFilter,
  onClearNodeFilter,
}: {
  executions: DmExecution[];
  onSelectExecution: (execution: DmExecution) => void;
  onClose: () => void;
  onReload: () => void;
  nodeFilter?: string | null;
  onClearNodeFilter?: () => void;
}) {
  const { cb } = useCreatorMode();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredExecutions = useMemo(() => {
    if (!normalizedSearch) return executions;

    return executions.filter((ex) => {
      const payload = ex.trigger_payload || {};
      const fullName = ex.contact_name || [payload.first_name, payload.last_name].filter(Boolean).join(' ');
      const searchableValues = [
        ex.contact_name,
        fullName,
        ex.lead_id,
        payload.Lead_ID,
        payload.lead_id,
        payload.email,
        payload.Email,
        payload.phone,
        payload.Phone,
        payload.phone_number,
        payload.Phone_Number,
      ];

      return searchableValues.some((value) =>
        typeof value === 'string' && value.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [executions, normalizedSearch]);

  const totalCount = filteredExecutions.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearch]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedExecutions = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredExecutions.slice(start, start + PAGE_SIZE);
  }, [filteredExecutions, currentPage]);

  const statusVariant = (ex: DmExecution): 'positive' | 'negative' | 'neutral' | 'warning' => {
    if (ex.status === 'completed' && ex.followup_resume_at && (!ex.followup_status || ex.followup_status === 'waiting')) return 'warning';
    switch (ex.status) {
      case 'completed': return 'positive';
      case 'failed': return 'negative';
      case 'waiting': return 'warning';
      case 'grouping':
      case 'sending': return 'neutral';
      default: return 'neutral';
    }
  };

  const statusLabel = (ex: DmExecution) => {
    if (ex.status === 'completed' && ex.followup_resume_at && (!ex.followup_status || ex.followup_status === 'waiting')) return 'PROCESSING';
    if (ex.status === 'waiting') return 'PROCESSING';
    if (ex.status === 'cancelled') return 'ENDED';
    if (ex.status === 'completed' && ex.followup_status === 'fired') return 'COMPLETED';
    if (ex.status === 'completed' && ex.followup_status === 'cancelled') return 'COMPLETED';
    return (ex.status || 'unknown').toUpperCase();
  };

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '3px groove hsl(var(--border-groove))' }}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px', lineHeight: 1, letterSpacing: '0.5px' }}>
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

      {nodeFilter && onClearNodeFilter && (
        <div className="px-4 py-1.5 shrink-0 flex items-center justify-between" style={{ borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--accent) / 0.3)' }}>
          <span className="text-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>Filtered by node</span>
          <button className="text-muted-foreground hover:text-foreground" onClick={onClearNodeFilter}><X className="h-3 w-3" /></button>
        </div>
      )}
      <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search name, phone, email, or lead ID..."
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredExecutions.length === 0 ? (
          <div className="p-4 text-muted-foreground" style={fieldStyle}>
            {normalizedSearch ? 'No executions match your search.' : 'No executions yet. Send a DM through GHL to start.'}
          </div>
        ) : (
          <div className="divide-y divide-dashed divide-border">
            {paginatedExecutions.map(ex => (
              <button
                key={ex.id}
                onClick={() => onSelectExecution(ex)}
                className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <StatusTag variant={statusVariant(ex)}>
                    {statusLabel(ex)}
                  </StatusTag>
                  <span className="text-muted-foreground" style={fieldStyle}>
                    {ex.started_at ? format(new Date(ex.started_at), 'MMM d, HH:mm:ss') : '—'}
                  </span>
                </div>
                <div className={`mt-1 text-muted-foreground ${cb}`} style={{ ...fieldStyle, fontSize: '13px' }}>
                  {ex.contact_name || 'Unknown'} — {ex.messages_received ?? 0} {(ex.messages_received ?? 0) === 1 ? 'message' : 'messages'}
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

export default function ProcessDMs() {
  const { clientId } = useParams<{ clientId: string }>();
  const [loading, setLoading] = useState(true);
  const [dmEnabled, setDmEnabled] = useState(false);
  const [debounceSeconds, setDebounceSeconds] = useState(60);
  const [followupDelaySeconds, setFollowupDelaySeconds] = useState(0);
  const [followup1DelaySeconds, setFollowup1DelaySeconds] = useState(0);
  const [followup2DelaySeconds, setFollowup2DelaySeconds] = useState(0);
  const [followup3DelaySeconds, setFollowup3DelaySeconds] = useState(0);
  const [followupMaxAttempts, setFollowupMaxAttempts] = useState(1);
  const [primarySetterId, setPrimarySetterId] = useState<string | null>(null);
  const [setterDelayItems, setSetterDelayItems] = useState<SetterDelayItem[]>([]);
  const [ghlLocationId, setGhlLocationId] = useState<string | null>(null);
  const [executions, setExecutions] = useState<DmExecution[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [selectedExecution, setSelectedExecution] = useState<DmExecution | null>(null);
  const [selectedExecutionFollowupTimers, setSelectedExecutionFollowupTimers] = useState<FollowupTimerRow[] | undefined>(undefined);
  const [executionNodeFilter, setExecutionNodeFilter] = useState<string | null>(null);
  const selectedExecutionRef = useRef<DmExecution | null>(null);
  const [showToggleActiveDialog, setShowToggleActiveDialog] = useState(false);
  useEffect(() => { selectedExecutionRef.current = selectedExecution; }, [selectedExecution]);

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  usePageHeader({
    title: 'Text Setter Engine',
    breadcrumbs: [
      { label: 'Workflows', onClick: () => navigate(`/client/${clientId}/workflows`) },
      { label: 'Text Setter Engine', badge: 'ACTIVE', badgeVariant: 'positive' as const },
    ],
  }, [dmEnabled]);

  const followupDelays = [followup1DelaySeconds, followup2DelaySeconds, followup3DelaySeconds];

  // Always show 3 follow-up nodes in the canvas — the actual count is controlled per-setter in config
  const canvasNodes: CanvasNode[] = useMemo(() => {
    const base: CanvasNode[] = [
      {
        id: 'dm-trigger',
        type: 'trigger' as const,
        data: { label: 'Webhook', headerTitle: 'Trigger', triggerType: 'contact_created' as const, description: 'Receive new lead message from GoHighLevel' } as any,
        children: ['dm-group'],
      },
      {
        id: 'dm-group',
        type: 'delay' as const,
        data: { label: 'Wait Before Replying', actionType: 'delay' as const, delayMode: 'duration' as const, delayValue: debounceSeconds, delayUnit: 'seconds' as const, waitUntil: '', timezone: '', description: 'Wait for the user to send all messages and pause' },
        children: ['dm-send'],
      },
      {
        id: 'dm-send',
        type: 'text_setter' as const,
        data: { label: 'Generate Reply', description: 'Let Text Setter generate reply to the lead message' } as any,
        children: ['dm-followup-wait-1'],
      },
    ];

    // Always generate 3 follow-up pairs
    for (let i = 1; i <= 3; i++) {
      const waitId = `dm-followup-wait-${i}`;
      const followupId = `dm-followup-${i}`;
      const endId = `dm-done-${i}`;
      const isLast = i === 3;
      const nextWaitId = isLast ? null : `dm-followup-wait-${i + 1}`;

      base.push({
        id: waitId,
        type: 'follow_up' as const,
        data: { label: 'Wait for Reply', headerTitle: `Follow-Up Delay #${i}`, actionType: 'condition' as const, field: 'reply_received', operator: 'equals' as const, value: 'true', description: 'Timeout is configured per setter' } as any,
        children: [endId, followupId],
        branchLabels: { true: 'Lead Replied', false: 'No Reply' },
      });

      base.push({
        id: endId,
        type: 'end' as const,
        data: { label: 'End', description: 'Lead replied — sequence stopped' } as any,
        children: [],
      });

      base.push({
        id: followupId,
        type: 'text_setter' as const,
        data: { label: `Generate Follow-Up #${i}`, description: 'Generate follow-up message based on conversation history' } as any,
        children: nextWaitId ? [nextWaitId] : ['dm-followup-done'],
      });
    }

    // Final end node
    base.push({
      id: 'dm-followup-done',
      type: 'end' as const,
      data: { label: 'End', description: 'All follow-ups sent — sequence complete' } as any,
      children: [],
    });

    return base;
  }, [debounceSeconds, followupDelays]);

  // Fetch client config + saved setter delays used by the DM workflow
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const dmCacheKey = `processdm_config_${clientId}`;
      type DmCacheData = { dmEnabled: boolean; ghlLocationId: string | null; setterDelayItems: any[]; primaryRaw: any };
      const dmCached = getCached<DmCacheData>(dmCacheKey);
      if (dmCached) {
        setDmEnabled(dmCached.dmEnabled);
        setGhlLocationId(dmCached.ghlLocationId);
        setSetterDelayItems(dmCached.setterDelayItems);
        if (dmCached.primaryRaw) {
          const primarySetter = dmCached.setterDelayItems.find((r: any) => r.slotId === 'Setter-1') ?? dmCached.setterDelayItems[0] ?? null;
          setDebounceSeconds(primarySetter?.responseDelaySeconds ?? 60);
          setFollowupDelaySeconds(dmCached.primaryRaw?.followup_1_delay_seconds ?? 0);
          setFollowup1DelaySeconds(dmCached.primaryRaw?.followup_1_delay_seconds ?? 0);
          setFollowup2DelaySeconds(dmCached.primaryRaw?.followup_2_delay_seconds ?? 0);
          setFollowup3DelaySeconds(dmCached.primaryRaw?.followup_3_delay_seconds ?? 0);
          setFollowupMaxAttempts(dmCached.primaryRaw?.followup_max_attempts ?? 1);
          setPrimarySetterId(dmCached.primaryRaw?.slot_id ?? null);
        }
        setLoading(false);
      } else {
        setLoading(true);
      }
      const requestedExecutionId = searchParams.get('execution');
      const [{ data: clientData, error: clientError }, { data: agentSettings, error: agentSettingsError }, { data: executionData }] = await Promise.all([
        supabase
          .from('clients')
          .select('dm_enabled, ghl_location_id')
          .eq('id', clientId)
          .single(),
        supabase
          .from('agent_settings')
          .select('slot_id, response_delay_seconds, followup_1_delay_seconds, followup_2_delay_seconds, followup_3_delay_seconds, followup_max_attempts, updated_at')
          .eq('client_id', clientId)
          .not('response_delay_seconds', 'is', null)
          .order('slot_id', { ascending: true }),
        requestedExecutionId
          ? (supabase as any)
              .from('dm_executions')
              .select('*')
              .eq('id', requestedExecutionId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (clientError) {
        toast.error('Failed to load client config');
      } else if (clientData) {
        setDmEnabled(clientData.dm_enabled ?? false);
        setGhlLocationId(clientData.ghl_location_id ?? null);
      }

      if (agentSettingsError) {
        toast.error('Failed to load setter delay');
      } else {
        const settingsRows = ((agentSettings ?? []) as Array<{ slot_id: string; response_delay_seconds: number | null; followup_1_delay_seconds: number | null; followup_max_attempts: number | null }>)
          .map((row) => ({
            slotId: row.slot_id,
            responseDelaySeconds: row.response_delay_seconds ?? 0,
          }))
          .sort((a, b) => a.slotId.localeCompare(b.slotId, undefined, { numeric: true, sensitivity: 'base' }));

        setSetterDelayItems(settingsRows);

        const primaryRaw = (agentSettings as any[])?.find((row: any) => row.slot_id === 'Setter-1') ?? (agentSettings as any[])?.[0] ?? null;
        const primarySetter = settingsRows.find((row) => row.slotId === 'Setter-1') ?? settingsRows[0] ?? null;
        setDebounceSeconds(primarySetter?.responseDelaySeconds ?? 60);
        setFollowupDelaySeconds(primaryRaw?.followup_1_delay_seconds ?? 0);
        setFollowup1DelaySeconds(primaryRaw?.followup_1_delay_seconds ?? 0);
        setFollowup2DelaySeconds(primaryRaw?.followup_2_delay_seconds ?? 0);
        setFollowup3DelaySeconds(primaryRaw?.followup_3_delay_seconds ?? 0);
        setFollowupMaxAttempts(primaryRaw?.followup_max_attempts ?? 1);
        setPrimarySetterId(primaryRaw?.slot_id ?? null);
      }

      if (requestedExecutionId && executionData) {
        executionParamHandled.current = true;
        setSelectedExecution(executionData as DmExecution);
        setRightPanel('execution-detail');
        setSelectedNodeId(null);
        setSearchParams(prev => {
          prev.delete('execution');
          return prev;
        }, { replace: true });
      }

      // Cache config for instant re-render next time
      if (!clientError && !agentSettingsError) {
        const cachedRows = ((agentSettings ?? []) as any[]).map((row: any) => ({
          slotId: row.slot_id,
          responseDelaySeconds: row.response_delay_seconds ?? 0,
        })).sort((a: any, b: any) => a.slotId.localeCompare(b.slotId, undefined, { numeric: true, sensitivity: 'base' }));
        const cachedPrimary = (agentSettings as any[])?.find((row: any) => row.slot_id === 'Setter-1') ?? (agentSettings as any[])?.[0] ?? null;
        setCache(dmCacheKey, {
          dmEnabled: clientData?.dm_enabled ?? false,
          ghlLocationId: clientData?.ghl_location_id ?? null,
          setterDelayItems: cachedRows,
          primaryRaw: cachedPrimary,
        });
      }
      setLoading(false);
    })();
  }, [clientId]);

  const lastFetchRef = useRef(0);

  const fetchExecutions = useCallback(async () => {
    if (!ghlLocationId) return;
    const { data } = await (supabase as any)
      .from('dm_executions')
      .select('*')
      .eq('ghl_account_id', ghlLocationId)
      .order('started_at', { ascending: false })
      .limit(1000);

    if (data) {
      let enriched = data as DmExecution[];

      const completedExecs = enriched.filter((e) => e.status === 'completed' && e.started_at);
      if (completedExecs.length > 0) {
        const contactIds = [...new Set(completedExecs.map((e) => e.lead_id))];
        const { data: timers } = await (supabase as any)
          .from('followup_timers')
          .select('lead_id, fires_at, status, sequence_index, created_at, trigger_run_id')
          .in('lead_id', contactIds)
          .eq('ghl_account_id', ghlLocationId)
          .order('created_at', { ascending: false });

        const timersByContact = new Map<string, Array<{
          lead_id: string;
          fires_at: string | null;
          status: string;
          sequence_index: number | null;
          created_at: string | null;
          trigger_run_id: string | null;
        }>>();

        for (const timer of (timers as Array<{
          lead_id: string;
          fires_at: string | null;
          status: string;
          sequence_index: number | null;
          created_at: string | null;
          trigger_run_id: string | null;
        }> | null) ?? []) {
          const existing = timersByContact.get(timer.lead_id) ?? [];
          existing.push(timer);
          timersByContact.set(timer.lead_id, existing);
        }

        const executionsByContact = new Map<string, DmExecution[]>();
        for (const execution of completedExecs) {
          const existing = executionsByContact.get(execution.lead_id) ?? [];
          existing.push(execution);
          executionsByContact.set(execution.lead_id, existing);
        }
        executionsByContact.forEach((rows) => {
          rows.sort((a, b) => {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return aTime - bTime;
          });
        });

        enriched = enriched.map((execution) => {
          if (execution.status !== 'completed' || !execution.started_at) return execution;

          const contactTimers = timersByContact.get(execution.lead_id) ?? [];
          const contactExecutions = executionsByContact.get(execution.lead_id) ?? [];
          const executionIndex = contactExecutions.findIndex((row) => row.id === execution.id);
          const nextExecutionStartedAt = executionIndex >= 0
            ? contactExecutions[executionIndex + 1]?.started_at ?? null
            : null;

          let matchedTimers = execution.trigger_run_id
            ? contactTimers.filter((timer) => timer.trigger_run_id === execution.trigger_run_id)
            : [];

          if (matchedTimers.length === 0) {
            const startMs = new Date(execution.started_at).getTime();
            const endMs = nextExecutionStartedAt
              ? new Date(nextExecutionStartedAt).getTime()
              : Number.POSITIVE_INFINITY;

            matchedTimers = contactTimers.filter((timer) => {
              if (!timer.created_at) return false;
              const createdMs = new Date(timer.created_at).getTime();
              return createdMs >= startMs && createdMs < endMs;
            });
          }

          if (matchedTimers.length === 0) {
            return { ...execution, followup_status: null, followup_resume_at: null };
          }

          const pendingTimer = matchedTimers.find(
            (timer) => timer.status === 'pending' || timer.status === 'firing'
          );

          if (pendingTimer) {
            return {
              ...execution,
              followup_status: 'waiting',
              followup_resume_at: pendingTimer.fires_at ?? null,
            };
          }

          return {
            ...execution,
            followup_status: matchedTimers[0]?.status ?? null,
            followup_resume_at: null,
          };
        });
      }

      const unique = Array.from(new Map(enriched.map(e => [e.id, e])).values());
      setExecutions(unique);
      // Sync selectedExecution with fresh data using functional updater
      // to avoid stale ref race when user clicks a different execution
      // right as a realtime fetch completes
      setSelectedExecution(prev => {
        if (!prev) return null;
        const updated = unique.find((e: DmExecution) => e.id === prev.id);
        if (!updated) return prev;
        return JSON.stringify(prev) === JSON.stringify(updated) ? prev : updated;
      });
    }
  }, [ghlLocationId]);

  // Compute the upper bound for timer queries (next execution's started_at for same lead)
  const selectedExecutionTimerUpperBound = useMemo(() => {
    if (!selectedExecution) return null;
    const sameLeadExecs = executions
      .filter(e => e.lead_id === selectedExecution.lead_id && e.started_at > selectedExecution.started_at)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    return sameLeadExecs[0]?.started_at ?? null;
  }, [selectedExecution, executions]);

  useEffect(() => {
    if (!selectedExecution || rightPanel !== 'execution-detail' || selectedExecution.status !== 'completed') {
      setSelectedExecutionFollowupTimers(undefined);
      return;
    }

    let cancelled = false;

    const load = async () => {
      const timers = await getAllFollowupTimers(
        selectedExecution.lead_id,
        selectedExecution.ghl_account_id,
        selectedExecution.started_at,
        selectedExecution.trigger_run_id,
        selectedExecutionTimerUpperBound,
      );
      if (!cancelled) {
        setSelectedExecutionFollowupTimers(timers);
      }
    };

    load();
    const interval = window.setInterval(load, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedExecution, rightPanel]);

  // Fetch executions + realtime
  useEffect(() => {
    if (!ghlLocationId) return;
    fetchExecutions();
    const realtimeHandler = () => {
      const now = Date.now();
      if (now - lastFetchRef.current < 250) return;
      lastFetchRef.current = now;
      fetchExecutions();
    };
    const channel = supabase
      .channel(`dm-executions-live-${ghlLocationId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'dm_executions', filter: `ghl_account_id=eq.${ghlLocationId}` },
        realtimeHandler
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'followup_timers', filter: `ghl_account_id=eq.${ghlLocationId}` },
        realtimeHandler
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [ghlLocationId, fetchExecutions]);

  // Auto-select execution from URL param
  const executionParamHandled = useRef(false);
  useEffect(() => {
    const executionId = searchParams.get('execution');
    if (!executionId || executionParamHandled.current || executions.length === 0) return;
    const match = executions.find(e => e.id === executionId);
    if (match) {
      executionParamHandled.current = true;
      setSelectedExecution(match);
      setRightPanel('execution-detail');
      setSelectedNodeId(null);
      setSearchParams(prev => { prev.delete('execution'); return prev; }, { replace: true });
    }
  }, [executions, searchParams, setSearchParams]);

  const handleToggle = useCallback(async (enabled: boolean) => {
    if (!clientId) return;
    setDmEnabled(enabled);
    const { error } = await supabase
      .from('clients')
      .update({ dm_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('id', clientId);
    if (error) {
      toast.error('Failed to update');
      setDmEnabled(!enabled);
    } else {
      toast.success(enabled ? 'Text Setter Engine enabled' : 'Text Setter Engine disabled');
    }
  }, [clientId]);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setRightPanel('config');
  }, []);

  const handleDeselectNode = useCallback(() => {}, []);

  // Map each execution to the node it's currently "sitting on"
  const getExecutionCurrentNodeId = useCallback((ex: DmExecution): string | null => {
    const s = ex.status;
    if (s === 'waiting' || s === 'grouping') return 'dm-group';
    if (s === 'sending' || s === 'processing') return 'dm-send';
    if (s === 'completed') {
      // Check followup status
      if (ex.followup_status === 'waiting' || (ex.followup_resume_at && (!ex.followup_status || ex.followup_status === 'waiting'))) {
        // We need to figure out which followup-wait node. Use simple heuristic:
        // If followup_resume_at is set and followup_status is waiting, it's on a followup wait node
        return 'dm-followup-wait-1'; // simplified - first followup wait
      }
    }
    return null;
  }, []);

  // Compute lead counts per node
  const nodeLeadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ex of executions) {
      const nodeId = getExecutionCurrentNodeId(ex);
      if (nodeId) {
        counts.set(nodeId, (counts.get(nodeId) || 0) + 1);
      }
    }
    return counts.size > 0 ? counts : undefined;
  }, [executions, getExecutionCurrentNodeId]);

  // Filter executions for a specific node
  const filteredByNodeExecutions = useMemo(() => {
    if (!executionNodeFilter) return executions;
    return executions.filter(ex => getExecutionCurrentNodeId(ex) === executionNodeFilter);
  }, [executions, executionNodeFilter, getExecutionCurrentNodeId]);

  const handleNodeBadgeClick = useCallback((nodeId: string) => {
    setExecutionNodeFilter(nodeId);
    setRightPanel('executions');
    setSelectedNodeId(null);
    setSelectedExecution(null);
  }, []);

  const handleSelectExecution = useCallback((execution: DmExecution) => {
    setSelectedExecution(execution);
    setRightPanel('execution-detail');
    setSelectedNodeId(null);
  }, []);

  // Derive highlighted node IDs from the selected execution's status + all timers
  const highlightedNodeIds = useMemo(() => {
    if (!selectedExecution || rightPanel !== 'execution-detail') return undefined;
    const ids = new Set<string>();
    const status = selectedExecution.status;
    const timers = selectedExecutionFollowupTimers ?? [];

    ids.add('dm-trigger');
    if (status === 'waiting' || status === 'grouped' || status === 'processing' || status === 'sending' || status === 'completed' || status === 'sent') {
      if (status !== 'waiting') ids.add('dm-group');
    }
    if (status === 'sending' || status === 'completed' || status === 'sent') {
      if (status !== 'sending') ids.add('dm-send');
    }

    // Highlight follow-up nodes based on each timer
    for (const timer of timers) {
      const i = timer.sequence_index ?? 1;
      if (timer.status === 'fired' || timer.status === 'cancelled' || timer.status === 'failed') {
        ids.add(`dm-followup-wait-${i}`);
      }
      if (timer.status === 'fired') {
        ids.add(`dm-followup-${i}`);
        ids.add(`dm-followup-done-${i}`);
      }
      if (timer.status === 'cancelled') {
        ids.add(`dm-done-${i}`);
      }
    }

    // If execution completed but no timers, still highlight first wait node
    if ((status === 'completed' || status === 'sent') && timers.length === 0) {
      ids.add('dm-followup-wait-1');
    }

    return ids.size > 0 ? ids : undefined;
  }, [selectedExecution, rightPanel, selectedExecutionFollowupTimers]);

  // Derive nodeStatuses for yellow processing highlights on canvas
  const nodeStatuses = useMemo(() => {
    if (!selectedExecution || rightPanel !== 'execution-detail') return undefined;
    const map = new Map<string, import('@/components/workflow/StaticWorkflowNode').NodeExecutionStatus>();
    const status = selectedExecution.status;
    const timers = selectedExecutionFollowupTimers ?? [];
    
    if (selectedExecution.started_at) map.set('dm-trigger', 'completed');

    if (status === 'cancelled') {
      map.set('dm-group', 'cancelled');
      return map;
    }

    if (status === 'waiting') map.set('dm-group', 'processing');
    else if (status === 'grouping' || status === 'sending' || status === 'completed') map.set('dm-group', 'completed');
    else if (status === 'failed') map.set('dm-group', 'failed');
    if (status === 'sending') map.set('dm-send', 'processing');
    else if (status === 'completed') map.set('dm-send', 'completed');

    // Process each follow-up timer
    for (const timer of timers) {
      const i = timer.sequence_index ?? 1;
      switch (timer.status) {
        case 'pending':
        case 'firing':
          map.set(`dm-followup-wait-${i}`, 'processing');
          break;
        case 'fired':
          map.set(`dm-followup-wait-${i}`, 'completed');
          map.set(`dm-followup-${i}`, 'completed');
          map.set(`dm-followup-done-${i}`, 'completed');
          break;
        case 'cancelled':
          map.set(`dm-followup-wait-${i}`, 'cancelled');
          map.set(`dm-done-${i}`, 'completed');
          break;
        case 'failed':
          map.set(`dm-followup-wait-${i}`, 'completed');
          map.set(`dm-followup-${i}`, 'failed');
          break;
      }
    }

    // If completed and pending timer exists for first pair
    if (status === 'completed' && timers.length === 0 && (selectedExecution.followup_resume_at || selectedExecution.followup_status)) {
      map.set('dm-followup-wait-1', 'processing');
    }

    // Mark final END node as completed when execution is fully done
    if (status === 'completed') {
      map.set('dm-followup-done', 'completed');
    }
    
    return map.size > 0 ? map : undefined;
  }, [selectedExecution, rightPanel, selectedExecutionFollowupTimers]);

  const togglePanel = (panel: 'executions') => {
    if (rightPanel === panel || rightPanel === 'execution-detail') {
      setRightPanel(null);
      setSelectedExecution(null);
      setExecutionNodeFilter(null);
    } else {
      setRightPanel(panel);
      setSelectedNodeId(null);
      setExecutionNodeFilter(null); // Clear node filter when opening via toolbar
    }
  };

  const tabBtnClass = (active: boolean) =>
    `groove-btn !h-8 px-3 flex items-center gap-1.5 uppercase transition-colors ${active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`;

  if (loading) return <RetroLoader />;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Center: Canvas area */}
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
                <ClipboardCheck className="w-3.5 h-3.5" /><span className="ml-1.5">Executions</span>
              </button>
            </div>
          </div>
        </div>

        {/* Canvas with static nodes */}
        <WorkflowCanvas
          nodes={canvasNodes}
          selectedNodeId={selectedNodeId}
          nodeStatuses={nodeStatuses}
          highlightedNodeIds={highlightedNodeIds}
          nodeLeadCounts={rightPanel === 'execution-detail' ? undefined : nodeLeadCounts}
          readOnly
          onSelectNode={handleSelectNode}
          onAddNode={() => {}}
          onDeselectNode={handleDeselectNode}
          onNodeBadgeClick={handleNodeBadgeClick}
        />
      </div>

      {/* Right Panel */}
      {rightPanel === 'config' && selectedNodeId && (
        <ProcessDMsNodeConfig
          nodeId={selectedNodeId}
          debounceSeconds={debounceSeconds}
          onDebounceChange={setDebounceSeconds}
          saving={false}
          executions={executions}
          onClose={() => { setSelectedNodeId(null); setRightPanel(null); }}
          onConfigureDelay={() => navigate(`/client/${clientId}/prompts/text?configure=response_delay`)}
          onConfigureFollowupDelay={() => navigate(`/client/${clientId}/prompts/text?configure=followup_delay`)}
          onConfigureFollowupInstructions={() => navigate(`/client/${clientId}/prompts/text?configure=followup_instructions`)}
          primarySetterSlotId={setterDelayItems[0]?.slotId ?? 'Setter-1'}
        />
      )}
      {rightPanel === 'executions' && (
        <DmExecutionLog
          executions={filteredByNodeExecutions}
          onSelectExecution={handleSelectExecution}
          onClose={() => { setRightPanel(null); setExecutionNodeFilter(null); }}
          onReload={fetchExecutions}
          nodeFilter={executionNodeFilter}
          onClearNodeFilter={() => setExecutionNodeFilter(null)}
        />
      )}
      {rightPanel === 'execution-detail' && selectedExecution && (
        <DmExecutionDetail
          execution={selectedExecution}
          onClose={() => { setSelectedExecution(null); setRightPanel('executions'); }}
          onReload={fetchExecutions}
          initialFollowupTimers={selectedExecutionFollowupTimers}
          timerUpperBound={selectedExecutionTimerUpperBound}
        />
      )}
    </div>
  );
}
