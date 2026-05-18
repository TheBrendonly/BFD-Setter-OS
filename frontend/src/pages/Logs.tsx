import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Phone } from 'lucide-react';
import { RefreshCw, Search, ChevronLeft, ChevronRight, Copy, ExternalLink, Loader2, ChevronDown, Maximize2, MessageSquare, Play, Check } from '@/components/icons';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { format, formatDistanceToNow, subDays, subHours } from 'date-fns';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import { cn } from '@/lib/utils';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { SchemaNode } from '@/components/error-logs/SchemaNode';
import { LogsTabsNav } from '@/components/logs/LogsTabsNav';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { setterLabel } from '@/lib/setterLabels';

interface LiveJob {
  id: string;
  client_id: string;
  job_type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  input_payload: any;
}

const formatElapsed = (startIso: string): string => {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;
const LABEL_CLS = "text-foreground block mb-1";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;
const DEFAULT_PAGE_SIZE = 25;

interface LogEntry {
  id: string;
  created_at: string;
  client_ghl_account_id: string;
  lead_id: string | null;
  execution_id: string | null;
  severity: string;
  error_type: string;
  error_message: string;
  context: any;
  source: string | null;
  category: string | null;
  title: string | null;
  job_id: string | null;
  trigger_run_id: string | null;
}

type TabKey = 'ai-jobs' | 'errors' | 'followups' | 'outbound-calls' | 'bookings';

interface BookingEntry {
  id: string;
  client_id: string;
  lead_id: string | null;
  ghl_contact_id: string | null;
  ghl_booking_id: string | null;
  campaign_id: string | null;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  location: string | null;
  notes: string | null;
  calendar_id: string | null;
  created_at: string;
  setter_name: string | null;
  setter_type: string | null;
  raw_ghl_data: any;
}

interface CallHistoryEntry {
  id: string;
  client_id: string;
  contact_id: string | null;
  contact_name: string | null;
  ghl_account_id: string | null;
  call_id: string;
  agent_id: string | null;
  setter_id: string | null;
  from_number: string | null;
  to_number: string | null;
  call_type: string | null;
  direction: string | null;
  call_status: string | null;
  disconnect_reason: string | null;
  start_timestamp: string | null;
  end_timestamp: string | null;
  duration_ms: number | null;
  transcript: string | null;
  transcript_object: any;
  recording_url: string | null;
  public_log_url: string | null;
  call_summary: string | null;
  user_sentiment: string | null;
  call_successful: boolean | null;
  custom_analysis_data: any;
  cost: number | null;
  campaign_id: string | null;
  created_at: string;
}
type DateRange = '24h' | '7d' | '30d';
type SeverityFilter = 'all' | 'info' | 'error';

const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <button
    onClick={async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
      } catch { toast.error('Failed to copy'); }
    }}
    className="inline-flex items-center gap-1.5 px-2 py-1 groove-border bg-card hover:bg-muted/50 transition-colors"
    style={FONT}
  >
    <Copy className="w-3 h-3" />
    <span className="truncate max-w-[180px]">{value.length > 20 ? `${value.substring(0, 20)}…` : value}</span>
  </button>
);

const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  const variant = severity === 'error' ? 'negative' : severity === 'warning' ? 'warning' : 'neutral';
  return <StatusTag variant={variant}>{severity.toUpperCase()}</StatusTag>;
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = status.toLowerCase();
  if (s === 'running' || s === 'pending') return <StatusTag variant="warning">{s === 'running' ? 'RUNNING' : 'PENDING'}</StatusTag>;
  if (s === 'error' || s === 'failed') return <StatusTag variant="negative">ERROR</StatusTag>;
  return <StatusTag variant="positive">SUCCESS</StatusTag>;
};

// Pixel art terminal icon for errors / all empty states
const PixelTerminalIcon = () => (
  <svg width="48" height="48" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-4">
    <rect x="1" y="2" width="14" height="12" rx="0" stroke="currentColor" strokeWidth="1" fill="none" className="text-primary" />
    <rect x="1" y="2" width="14" height="3" fill="currentColor" className="text-primary" fillOpacity="0.2" />
    <rect x="3" y="3" width="1" height="1" fill="currentColor" className="text-primary" />
    <rect x="5" y="3" width="1" height="1" fill="currentColor" className="text-primary" />
    <rect x="7" y="3" width="1" height="1" fill="currentColor" className="text-primary" />
    <rect x="3" y="7" width="1" height="1" fill="currentColor" className="text-muted-foreground" />
    <rect x="4" y="8" width="1" height="1" fill="currentColor" className="text-muted-foreground" />
    <rect x="5" y="9" width="1" height="1" fill="currentColor" className="text-muted-foreground" />
    <rect x="4" y="10" width="1" height="1" fill="currentColor" className="text-muted-foreground" />
    <rect x="3" y="11" width="1" height="1" fill="currentColor" className="text-muted-foreground" />
    <rect x="7" y="11" width="4" height="1" fill="currentColor" className="text-muted-foreground" />
  </svg>
);

// Pixel art robot icon for AI Jobs empty state
const PixelRobotIcon = () => (
  <svg width="48" height="48" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-4">
    <rect x="7" y="1" width="2" height="2" fill="currentColor" className="text-primary" />
    <rect x="4" y="3" width="8" height="2" fill="currentColor" className="text-primary" fillOpacity="0.3" />
    <rect x="3" y="3" width="10" height="8" rx="0" stroke="currentColor" strokeWidth="1" fill="none" className="text-primary" />
    <rect x="5" y="5" width="2" height="2" fill="currentColor" className="text-primary" />
    <rect x="9" y="5" width="2" height="2" fill="currentColor" className="text-primary" />
    <rect x="6" y="8" width="4" height="1" fill="currentColor" className="text-muted-foreground" />
    <rect x="1" y="5" width="2" height="3" fill="currentColor" className="text-primary" fillOpacity="0.4" />
    <rect x="13" y="5" width="2" height="3" fill="currentColor" className="text-primary" fillOpacity="0.4" />
    <rect x="4" y="12" width="3" height="2" fill="currentColor" className="text-primary" fillOpacity="0.5" />
    <rect x="9" y="12" width="3" height="2" fill="currentColor" className="text-primary" fillOpacity="0.5" />
  </svg>
);

/* ── Detail drawer content ── */

const LogDetailPerformance: React.FC<{ log: LogEntry }> = ({ log }) => {
  const ctx = log.context || {};
  if (log.source !== 'run_ai_job') return null;
  const hasAny = ctx.model || ctx.duration_seconds != null || ctx.prompt_tokens != null || ctx.cost != null;
  if (!hasAny) return null;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      {ctx.model && (
        <div>
          <label className={LABEL_CLS} style={FONT}>Model</label>
          <span className="text-foreground" style={FONT}>{ctx.model}</span>
        </div>
      )}
      {ctx.duration_seconds != null && (
        <div>
          <label className={LABEL_CLS} style={FONT}>Duration</label>
          <span className="text-foreground" style={FONT}>{Number(ctx.duration_seconds).toFixed(1)}s</span>
        </div>
      )}
      {ctx.prompt_tokens != null && (
        <div>
          <label className={LABEL_CLS} style={FONT}>Tokens In</label>
          <span className="text-foreground" style={FONT}>{Number(ctx.prompt_tokens).toLocaleString()}</span>
        </div>
      )}
      {ctx.completion_tokens != null && (
        <div>
          <label className={LABEL_CLS} style={FONT}>Tokens Out</label>
          <span className="text-foreground" style={FONT}>{Number(ctx.completion_tokens).toLocaleString()}</span>
        </div>
      )}
      {ctx.cost != null && (
        <div>
          <label className={LABEL_CLS} style={FONT}>Cost</label>
          <span className="text-foreground" style={FONT}>${Number(ctx.cost).toFixed(4)}</span>
        </div>
      )}
    </div>
  );
};

const LogDetailDebugInfo: React.FC<{ log: LogEntry }> = ({ log }) => {
  const items: { label: string; value: string; link?: string }[] = [];
  if (log.trigger_run_id) items.push({ label: 'Trigger Run', value: log.trigger_run_id, link: `https://cloud.trigger.dev/runs/${log.trigger_run_id}` });
  if (log.execution_id) items.push({ label: 'Execution ID', value: log.execution_id });
  if (log.job_id) items.push({ label: 'Job ID', value: log.job_id });
  if (log.lead_id) items.push({ label: 'Lead ID', value: log.lead_id });
  if (!log.lead_id && log.source === 'process_messages' && log.context?.ghl_contact_id) {
    items.push({ label: 'GHL Contact', value: log.context.ghl_contact_id });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {items.map(item => (
        <div key={item.label}>
          <label className={LABEL_CLS} style={FONT}>{item.label}</label>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className="cursor-pointer"
              title="Click to copy"
              onClick={() => { navigator.clipboard.writeText(item.value); toast.success(`${item.label} copied`); }}
            >
              <StatusTag variant="neutral">{item.value.length > 20 ? `${item.value.substring(0, 20)}…` : item.value}</StatusTag>
            </span>
            {item.link && (
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 groove-border bg-card hover:bg-muted/50 transition-colors text-primary"
                style={FONT}
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                <span>View in Trigger.dev</span>
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const getDrawerTitle = (log: LogEntry): string => {
  if (log.source === 'process_messages') return 'MESSAGE PROCESSING FAILURE';
  if (log.source === 'run_ai_job') return 'AI JOB DETAIL';
  return 'LOG DETAIL';
};

/* ── Resource link helper for AI Jobs ── */

const JOB_TYPE_LABELS: Record<string, string> = {
  'generate-setter-config': 'Generate Setter Configuration',
  'modify-prompt-ai': 'Modify With AI',
  'analyze-setter-prompt': 'Modify Setter With AI',
  'generate-simulation-config': 'Generate Simulation',
  'generate-simulation-report': 'Simulation Report',
  'run-simulation': 'Run Simulation',
  'generate-simulation-personas': 'Generate Simulation Personas',
  'lead-file-export': 'Lead Export',
  'lead-file-import': 'Lead Import',
  'generate-conversation-examples': 'Generate Conversation Examples',
  'copy-setter-config': 'Copy Setter Configuration',
};

/* ── Model name simplifier ── */
const simplifyModelName = (model: string): string => {
  if (!model) return '—';
  // google/gemini-2.5-pro -> Gemini 2.5 Pro
  // anthropic/claude-opus-4.6 -> Claude Opus 4.6
  // openai/gpt-5.1 -> GPT 5.1
  const name = model.includes('/') ? model.split('/').pop()! : model;
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Gpt/g, 'GPT');
};

const getResourceInfo = (
  jobType: string,
  inputPayload: any,
  customNames?: Record<string, string> | null,
): { label: string; path?: string; slotId?: string } | null => {
  const customLabel = (kind: 'voice' | 'text', n: number, prefix: string): string => {
    const trimmed = customNames?.[`${kind}-${n}`]?.trim();
    return trimmed || `${prefix} ${n}`;
  };
  const slotId = inputPayload?.slotId || inputPayload?._enrichedSlotId;
  if (!slotId) {
    const agentNumber = inputPayload?.agent_number;
    if (agentNumber) {
      // For simulation-related jobs, link to the simulator page
      if (jobType.startsWith('generate-simulation') || jobType === 'run-simulation' || jobType === 'generate-simulation-personas') {
        return { label: 'Simulation', path: 'simulator' };
      }
      const simSlotId = `Setter-${agentNumber}`;
      return { label: customLabel('text', agentNumber, 'Text Setter'), path: `prompts/text?slot=${simSlotId}`, slotId: simSlotId };
    }
    if (jobType.startsWith('generate-simulation') || jobType === 'run-simulation') {
      return { label: 'Simulation', path: 'simulator' };
    }
    return null;
  }
  const isVoice = slotId.startsWith('Voice-Setter-');
  const numMatch = slotId.match(/(\d+)$/);
  const slotNum = numMatch ? parseInt(numMatch[1], 10) : null;
  const prettyLabel = slotNum
    ? customLabel(isVoice ? 'voice' : 'text', slotNum, isVoice ? 'Voice Setter' : 'Text Setter')
    : (isVoice
        ? slotId.replace('Voice-Setter-', 'Voice Setter ')
        : slotId.replace('Setter-', 'Text Setter '));
  return {
    label: prettyLabel,
    path: isVoice ? `prompts/voice?slot=${slotId}` : `prompts/text?slot=${slotId}`,
    slotId,
  };
};

/* ── Column definitions per tab ── */

interface ColDef {
  key: string;
  label: string;
  defaultWidth: number;
}

const AI_JOBS_COLS: ColDef[] = [
  { key: 'time', label: 'Time', defaultWidth: 150 },
  { key: 'status', label: 'Status', defaultWidth: 100 },
  { key: 'job_type', label: 'Job Type', defaultWidth: 160 },
  { key: 'resource', label: 'Resource', defaultWidth: 140 },
  { key: 'model', label: 'Model', defaultWidth: 140 },
  { key: 'duration', label: 'Duration', defaultWidth: 100 },
  { key: 'tokens', label: 'Tokens', defaultWidth: 160 },
  { key: 'cost', label: 'Cost', defaultWidth: 90 },
];

const ERRORS_COLS: ColDef[] = [
  { key: 'time', label: 'Time', defaultWidth: 180 },
  { key: 'lead', label: 'Lead', defaultWidth: 150 },
  { key: 'error_type', label: 'Error Type', defaultWidth: 160 },
  { key: 'message', label: 'Message', defaultWidth: 400 },
];


const FOLLOWUPS_COLS: ColDef[] = [
  { key: 'time', label: 'Time', defaultWidth: 180 },
  { key: 'status', label: 'Status', defaultWidth: 110 },
  { key: 'lead', label: 'Lead', defaultWidth: 150 },
  { key: 'setter', label: 'Setter', defaultWidth: 110 },
  { key: 'followup_num', label: 'Follow-up #', defaultWidth: 120 },
  { key: 'reason', label: 'Reason', defaultWidth: 300 },
];

const OUTBOUND_CALLS_COLS: ColDef[] = [
  { key: 'time', label: 'Time', defaultWidth: 160 },
  { key: 'status', label: 'Status', defaultWidth: 120 },
  { key: 'lead', label: 'Lead', defaultWidth: 140 },
  { key: 'setter', label: 'Setter', defaultWidth: 130 },
  { key: 'duration', label: 'Duration', defaultWidth: 100 },
  { key: 'human_pickup', label: 'Pickup', defaultWidth: 90 },
  { key: 'cost', label: 'Cost', defaultWidth: 90 },
  { key: 'recording', label: 'Recording', defaultWidth: 100 },
  { key: 'sentiment', label: 'Sentiment', defaultWidth: 130 },
];

const BOOKINGS_COLS: ColDef[] = [
  { key: 'appointment_time', label: 'Appointment Time', defaultWidth: 180 },
  { key: 'status', label: 'Status', defaultWidth: 120 },
  { key: 'lead', label: 'Lead', defaultWidth: 160 },
  { key: 'campaign', label: 'Campaign', defaultWidth: 180 },
  { key: 'title', label: 'Title', defaultWidth: 180 },
  { key: 'location', label: 'Location', defaultWidth: 140 },
  { key: 'created', label: 'Created', defaultWidth: 160 },
];

const getDefaultWidths = (cols: ColDef[]): Record<string, number> => {
  const w: Record<string, number> = {};
  cols.forEach(c => { w[c.key] = c.defaultWidth; });
  return w;
};

/* ── Custom Audio Player ── */

const CustomAudioPlayer: React.FC<{ src: string }> = ({ src }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); } else { audio.play(); }
    setPlaying(!playing);
  };

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2, 0.75];
    const idx = speeds.indexOf(speed);
    const next = speeds[(idx + 1) % speeds.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  };

  return (
    <div className="flex items-center groove-border bg-card" style={{ height: '32px' }}>
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
        onTimeUpdate={() => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
        onEnded={() => setPlaying(false)}
        preload="metadata"
      />
      {/* Play button */}
      <button
        onClick={togglePlay}
        className="flex items-center justify-center shrink-0 hover:bg-muted/50 transition-colors"
        style={{ width: '32px', height: '32px', borderRight: '1px solid hsl(var(--border-groove) / 0.3)' }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-foreground" style={{ imageRendering: 'pixelated' as const }}>
            <rect x="2" y="1" width="3" height="10" />
            <rect x="7" y="1" width="3" height="10" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-foreground" style={{ imageRendering: 'pixelated' as const }}>
            <rect x="3" y="1" width="2" height="2" />
            <rect x="3" y="3" width="2" height="2" />
            <rect x="5" y="3" width="2" height="2" />
            <rect x="3" y="5" width="2" height="2" />
            <rect x="5" y="5" width="2" height="2" />
            <rect x="7" y="5" width="2" height="2" />
            <rect x="3" y="7" width="2" height="2" />
            <rect x="5" y="7" width="2" height="2" />
            <rect x="3" y="9" width="2" height="2" />
          </svg>
        )}
      </button>
      {/* Progress bar */}
      <div
        className="flex-1 h-full flex items-center px-2 cursor-pointer"
        onClick={handleSeek}
      >
        <div className="w-full h-[4px] bg-muted/50 relative" style={{ borderRadius: '0' }}>
          <div
            className="absolute left-0 top-0 h-full bg-primary"
            style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>
      </div>
      {/* Time */}
      <span className="text-muted-foreground shrink-0 px-2" style={{ ...FONT, fontSize: '11px' }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      {/* Speed */}
      <button
        onClick={cycleSpeed}
        className="shrink-0 px-2 hover:bg-muted/50 transition-colors h-full flex items-center"
        style={{ ...FONT, fontSize: '11px', borderLeft: '1px solid hsl(var(--border-groove) / 0.3)' }}
        title="Playback speed"
      >
        <span className="text-muted-foreground">{speed}x</span>
      </button>
    </div>
  );
};

/* ── Transcript Bubbles (chat-like layout) ── */

interface TranscriptMessage {
  role: string;
  content: string;
}

const parseTranscript = (transcript: string | null, transcriptObject: any): TranscriptMessage[] => {
  // Try transcript_object first (array of {role, content})
  if (transcriptObject && Array.isArray(transcriptObject)) {
    return transcriptObject.map((item: any) => ({
      role: (item.role || 'agent').toLowerCase(),
      content: item.content || '',
    })).filter((m: TranscriptMessage) => m.content.trim());
  }

  if (!transcript) return [];

  // Parse text transcript: "Agent: ... \n User: ..."
  const messages: TranscriptMessage[] = [];
  const lines = transcript.split('\n');
  let currentRole = '';
  let currentContent = '';

  for (const line of lines) {
    const match = line.match(/^(Agent|User|agent|user)\s*:\s*(.*)$/i);
    if (match) {
      if (currentRole && currentContent.trim()) {
        messages.push({ role: currentRole, content: currentContent.trim() });
      }
      currentRole = match[1].toLowerCase();
      currentContent = match[2];
    } else {
      currentContent += '\n' + line;
    }
  }
  if (currentRole && currentContent.trim()) {
    messages.push({ role: currentRole, content: currentContent.trim() });
  }

  return messages;
};

const TranscriptBubbles: React.FC<{ transcript: string | null; transcriptObject?: any }> = ({ transcript, transcriptObject }) => {
  const messages = useMemo(() => parseTranscript(transcript, transcriptObject), [transcript, transcriptObject]);

  if (messages.length === 0) {
    return <p className="text-muted-foreground" style={FONT}>No transcript available</p>;
  }

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => {
        const isAgent = msg.role === 'agent';
        return (
          <div key={i} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
            <div
              className={cn(
                "max-w-[75%] groove-border p-3",
                isAgent ? 'bg-primary/10' : 'bg-muted/30'
              )}
            >
              <span
                className="block text-muted-foreground uppercase mb-1"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '1px' }}
              >
                {isAgent ? 'Agent' : 'User'}
              </span>
              <p className="text-foreground whitespace-pre-wrap break-words" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.6' }}>
                {msg.content}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ── Main component ── */

const Logs = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { cb } = useCreatorMode();
  const { credentials } = useClientCredentials(clientId);
  const setterDisplayNames = (credentials?.setter_display_names || {}) as Record<string, string>;
  const [tab, setTabRaw] = useState<TabKey>(() => {
    const saved = localStorage.getItem(`logs-tab-${clientId}`);
    if (saved && ['ai-jobs', 'errors', 'followups', 'outbound-calls', 'bookings'].includes(saved)) return saved as TabKey;
    return 'outbound-calls';
  });
  const setTab = (t: TabKey) => { localStorage.setItem(`logs-tab-${clientId}`, t); setTabRaw(t); };
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [ghlAccountId, setGhlAccountId] = useState<string | null>(null);
  const [ghlLoaded, setGhlLoaded] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [rawExchanges, setRawExchanges] = useState<any[] | null>(null);
  const [rawExchangesLoading, setRawExchangesLoading] = useState(false);
  const [liveJobs, setLiveJobs] = useState<LiveJob[]>([]);
  const [, setTick] = useState(0);
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const [expandedText, setExpandedText] = useState<{ title: string; content: string } | null>(null);
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);

  // ── Follow-ups tab state ──
  interface FollowupEntry {
    id: string;
    lead_id: string;
    setter_number: number | null;
    sequence_index: number | null;
    decision: string | null;
    decision_reason: string | null;
    raw_exchange: any;
    updated_at: string;
  }
  const [followups, setFollowups] = useState<FollowupEntry[]>([]);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const [followupsCount, setFollowupsCount] = useState(0);
  const [selectedFollowup, setSelectedFollowup] = useState<FollowupEntry | null>(null);

  // ── Outbound Calls tab state ──
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([]);
  const [callHistoryLoading, setCallHistoryLoading] = useState(false);
  const [callHistoryCount, setCallHistoryCount] = useState(0);
  const [selectedCall, setSelectedCall] = useState<CallHistoryEntry | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const callBeforeTranscriptRef = useRef<CallHistoryEntry | null>(null);
  const [callFilterSetter, setCallFilterSetter] = useState<string>('all');
  const [callFilterCampaign, setCallFilterCampaign] = useState<string>('all');
  const [callFilterStatus, setCallFilterStatus] = useState<string>('all');
  const [callSetterOptions, setCallSetterOptions] = useState<string[]>([]);
  const [callCampaignOptions, setCallCampaignOptions] = useState<{ id: string; name: string }[]>([]);

  // ── Bookings tab state ──
  const [bookings, setBookings] = useState<BookingEntry[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsCount, setBookingsCount] = useState(0);
  const [selectedBooking, setSelectedBooking] = useState<BookingEntry | null>(null);
  const [campaignNameCache, setCampaignNameCache] = useState<Record<string, string>>({});

  // ── Lead name cache for display ──
  // Maps any identifier (UUID id or GHL lead_id) → display name
  const [leadNameCache, setLeadNameCache] = useState<Record<string, string>>({});
  // Maps GHL lead_id → UUID id for navigation
  const [leadIdToUuid, setLeadIdToUuid] = useState<Record<string, string>>({});
  // Tracks whether lead names are still being resolved for the current data set
  const [leadNamesLoading, setLeadNamesLoading] = useState(false);

  // Fetch lead names for visible lead IDs
  useEffect(() => {
    const uuidIds = new Set<string>();
    const ghlIds = new Set<string>();

    if (tab === 'errors') {
      logs.forEach(l => { if (l.lead_id) uuidIds.add(l.lead_id); });
    } else if (tab === 'followups') {
      followups.forEach(f => { if (f.lead_id) ghlIds.add(f.lead_id); });
    } else if (tab === 'outbound-calls') {
      callHistory.forEach(c => { if (c.contact_id) uuidIds.add(c.contact_id); });
    } else if (tab === 'bookings') {
      bookings.forEach(b => { if (b.lead_id) uuidIds.add(b.lead_id); });
    }

    const unknownUuids = [...uuidIds].filter(id => !leadNameCache[id]);
    const unknownGhl = [...ghlIds].filter(id => !leadNameCache[id]);

    if (unknownUuids.length === 0 && unknownGhl.length === 0) {
      setLeadNamesLoading(false);
      return;
    }

    setLeadNamesLoading(true);
    const promises: Promise<void>[] = [];

    if (unknownUuids.length > 0) {
      promises.push((async () => {
        const { data } = await (supabase as any)
          .from('leads')
          .select('id, first_name, last_name')
          .in('id', unknownUuids.slice(0, 100));
        if (data && data.length > 0) {
          const newCache: Record<string, string> = {};
          for (const lead of data) {
            const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
            if (name) newCache[lead.id] = name;
          }
          setLeadNameCache(prev => ({ ...prev, ...newCache }));
        }
      })());
    }

    if (unknownGhl.length > 0) {
      promises.push((async () => {
        const { data } = await (supabase as any)
          .from('leads')
          .select('id, lead_id, first_name, last_name')
          .in('lead_id', unknownGhl.slice(0, 100));
        if (data && data.length > 0) {
          const newCache: Record<string, string> = {};
          const newIdMap: Record<string, string> = {};
          for (const lead of data) {
            const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
            if (name && lead.lead_id) newCache[lead.lead_id] = name;
            if (lead.lead_id) newIdMap[lead.lead_id] = lead.id;
          }
          setLeadNameCache(prev => ({ ...prev, ...newCache }));
          setLeadIdToUuid(prev => ({ ...prev, ...newIdMap }));
        }
      })());
    }

    Promise.all(promises).finally(() => setLeadNamesLoading(false));
  }, [tab, logs, followups, callHistory, bookings]);

  // Fetch campaign names for bookings
  useEffect(() => {
    if (tab !== 'bookings') return;
    const campaignIds = new Set<string>();
    bookings.forEach(b => { if (b.campaign_id) campaignIds.add(b.campaign_id); });
    const unknownIds = [...campaignIds].filter(id => !campaignNameCache[id]);
    if (unknownIds.length === 0) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('engagement_campaigns')
        .select('id, name')
        .in('id', unknownIds.slice(0, 100));
      if (data && data.length > 0) {
        const newCache: Record<string, string> = {};
        for (const c of data) { if (c.name) newCache[c.id] = c.name; }
        setCampaignNameCache(prev => ({ ...prev, ...newCache }));
      }
    })();
  }, [tab, bookings]);

  const [colWidths, setColWidths] = useState<Record<string, Record<string, number>>>({
    'ai-jobs': getDefaultWidths(AI_JOBS_COLS),
    'errors': getDefaultWidths(ERRORS_COLS),
    'all': {},
    'followups': getDefaultWidths(FOLLOWUPS_COLS),
    'outbound-calls': getDefaultWidths(OUTBOUND_CALLS_COLS),
    'bookings': getDefaultWidths(BOOKINGS_COLS),
  });
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedWidthsRef = useRef(false);

  // Load saved widths from DB
  useEffect(() => {
    if (!clientId || hasLoadedWidthsRef.current) return;
    hasLoadedWidthsRef.current = true;
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('log_column_widths')
        .eq('id', clientId)
        .single();
      if ((data as any)?.log_column_widths && typeof (data as any).log_column_widths === 'object') {
        const saved = (data as any).log_column_widths as Record<string, Record<string, number>>;
        setColWidths(prev => {
          const next = { ...prev };
          for (const tabKey of ['ai-jobs', 'errors', 'all', 'followups', 'outbound-calls', 'bookings'] as const) {
            if (saved[tabKey] && typeof saved[tabKey] === 'object') {
              const sanitized: Record<string, number> = {};
              for (const [k, v] of Object.entries(saved[tabKey])) {
                if (typeof v === 'number' && v >= 30 && v <= 800) sanitized[k] = v;
              }
              next[tabKey] = { ...next[tabKey], ...sanitized };
            }
          }
          return next;
        });
      }
    })();
  }, [clientId]);

  const saveWidthsToDB = useCallback((widths: Record<string, Record<string, number>>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!clientId) return;
      await supabase
        .from('clients')
        .update({ log_column_widths: widths } as any)
        .eq('id', clientId);
    }, 500);
  }, [clientId]);

  const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentTabWidths = colWidths[tab] || {};
    resizingRef.current = { key, startX: e.clientX, startWidth: currentTabWidths[key] || 120 };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + diff);
      setColWidths(prev => ({
        ...prev,
        [tab]: { ...prev[tab], [resizingRef.current!.key]: newWidth },
      }));
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
  }, [colWidths, tab, saveWidthsToDB]);

  const currentCols = tab === 'ai-jobs' ? AI_JOBS_COLS : tab === 'errors' ? ERRORS_COLS : tab === 'followups' ? FOLLOWUPS_COLS : tab === 'outbound-calls' ? OUTBOUND_CALLS_COLS : BOOKINGS_COLS;
  const currentWidths = colWidths[tab] || {};
  const totalTableWidth = useMemo(() => {
    return currentCols.reduce((sum, col) => sum + (currentWidths[col.key] || col.defaultWidth), 0);
  }, [currentCols, currentWidths]);

  // Live jobs: initial fetch + realtime subscription
  useEffect(() => {
    if (!clientId) return;

    const fetchLive = async () => {
      const { data } = await (supabase as any)
        .from('ai_generation_jobs')
        .select('id, client_id, job_type, status, created_at, started_at, input_payload')
        .eq('client_id', clientId)
        .in('status', ['pending', 'running']);
      if (data) setLiveJobs(data as LiveJob[]);
    };
    fetchLive();

    const channel = supabase
      .channel(`live-jobs-${clientId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'ai_generation_jobs',
        filter: `client_id=eq.${clientId}`,
      }, (payload: any) => {
        const row = payload.new as LiveJob;
        if (row.status === 'pending' || row.status === 'running') {
          setLiveJobs(prev => prev.some(j => j.id === row.id) ? prev : [...prev, row]);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'ai_generation_jobs',
        filter: `client_id=eq.${clientId}`,
      }, (payload: any) => {
        const row = payload.new as LiveJob;
        if (row.status === 'pending' || row.status === 'running') {
          setLiveJobs(prev => prev.map(j => j.id === row.id ? row : j));
        } else {
          setLiveJobs(prev => prev.filter(j => j.id !== row.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [clientId]);

  // Tick every second for elapsed time counter
  useEffect(() => {
    if (liveJobs.length === 0) return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [liveJobs.length]);

  // Handle deep-link from toast notification
  useEffect(() => {
    const state = (location.state as any);
    if (state?.openLogId && ghlLoaded && ghlAccountId) {
      (async () => {
        const { data } = await (supabase as any)
          .from('error_logs')
          .select('*')
          .eq('id', state.openLogId)
          .single();
        if (data) setSelectedLog(data as LogEntry);
      })();
      window.history.replaceState({}, '');
    }
  }, [location.state, ghlLoaded, ghlAccountId]);

  // Fetch ghl_location_id
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data } = await supabase.from('clients').select('ghl_location_id').eq('id', clientId).single();
      setGhlAccountId(data?.ghl_location_id || null);
      setGhlLoaded(true);
    })();
  }, [clientId]);

  const getDateCutoff = useCallback(() => {
    const now = new Date();
    if (dateRange === '24h') return subHours(now, 24).toISOString();
    if (dateRange === '7d') return subDays(now, 7).toISOString();
    return subDays(now, 30).toISOString();
  }, [dateRange]);

  const fetchLogs = useCallback(async () => {
    if (!ghlAccountId) { setLogs([]); setLoading(false); return; }
    setLoading(true);

    try {
      let query = (supabase as any)
        .from('error_logs')
        .select('*', { count: 'exact' })
        .eq('client_ghl_account_id', ghlAccountId)
        .gte('created_at', getDateCutoff())
        .order('created_at', { ascending: false });

      if (tab === 'ai-jobs') query = query.eq('source', 'run_ai_job');
      else if (tab === 'errors') query = query.eq('severity', 'error');

      if (search.trim()) query = query.or(`error_message.ilike.%${search}%,title.ilike.%${search}%`);

      const { data, error, count } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      let finalLogs = (data as LogEntry[]) || [];

      // Enrich AI job logs with slotId from ai_generation_jobs
      if (tab === 'ai-jobs' && finalLogs.length > 0) {
        const jobIds = finalLogs
          .map(l => l.context?.job_id || l.job_id)
          .filter(Boolean) as string[];
        if (jobIds.length > 0) {
          const { data: jobRows } = await (supabase as any)
            .from('ai_generation_jobs')
            .select('id, input_payload')
            .in('id', jobIds);
          if (jobRows) {
            const slotMap: Record<string, string> = {};
            for (const jr of jobRows) {
              const sid = jr.input_payload?.slotId;
              if (sid) slotMap[jr.id] = sid;
            }
            finalLogs = finalLogs.map(l => {
              const jid = l.context?.job_id || l.job_id;
              if (jid && slotMap[jid] && !l.context?.slotId) {
                return { ...l, context: { ...l.context, _enrichedSlotId: slotMap[jid] } };
              }
              return l;
            });
          }
        }
      }

      setLogs(finalLogs);
      setTotalCount(count || 0);
    } catch (err: any) {
      console.error('Error fetching logs:', err);
      toast.error('Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [ghlAccountId, tab, dateRange, severityFilter, search, page, pageSize, getDateCutoff]);

  // ── Followups fetcher ──
  const fetchFollowups = useCallback(async () => {
    if (!ghlAccountId) { setFollowups([]); setFollowupsLoading(false); return; }
    setFollowupsLoading(true);
    try {
      let query = (supabase as any)
        .from('followup_timers')
        .select('*', { count: 'exact' })
        .eq('ghl_account_id', ghlAccountId)
        .not('raw_exchange', 'is', null)
        .gte('updated_at', getDateCutoff())
        .order('updated_at', { ascending: false });
      if (search.trim()) query = query.or(`lead_id.ilike.%${search}%,decision_reason.ilike.%${search}%`);
      const { data, count } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
      if (data) { setFollowups(data); setFollowupsCount(count || 0); }
    } catch (err) {
      console.error('Error fetching followups:', err);
    } finally {
      setFollowupsLoading(false);
    }
  }, [ghlAccountId, dateRange, search, page, pageSize, getDateCutoff]);

  // ── Load call filter options ──
  useEffect(() => {
    if (!clientId) return;
    // Get distinct setter IDs
    (supabase as any).from('call_history').select('setter_id').eq('client_id', clientId).then(({ data }: any) => {
      if (data) {
        const setters = Array.from(new Set(data.map((r: any) => r.setter_id).filter(Boolean))) as string[];
        setters.sort();
        setCallSetterOptions(setters);
      }
    });
    // Get campaigns linked to calls
    (supabase as any).from('call_history').select('campaign_id').eq('client_id', clientId).not('campaign_id', 'is', null).then(({ data }: any) => {
      if (data) {
        const ids = Array.from(new Set(data.map((r: any) => r.campaign_id).filter(Boolean))) as string[];
        if (ids.length > 0) {
          (supabase as any).from('engagement_campaigns').select('id, name').in('id', ids).then(({ data: camps }: any) => {
            if (camps) setCallCampaignOptions(camps);
          });
        }
      }
    });
  }, [clientId]);

  // ── Outbound Calls fetcher ──
  const fetchCallHistory = useCallback(async () => {
    if (!clientId) { setCallHistory([]); setCallHistoryLoading(false); return; }
    setCallHistoryLoading(true);
    try {
      let query = (supabase as any)
        .from('call_history')
        .select('*', { count: 'exact' })
        .eq('client_id', clientId)
        .gte('created_at', getDateCutoff())
        .order('created_at', { ascending: false });
      if (search.trim()) query = query.or(`call_id.ilike.%${search}%,transcript.ilike.%${search}%,call_summary.ilike.%${search}%,to_number.ilike.%${search}%,contact_name.ilike.%${search}%`);
      if (callFilterSetter !== 'all') query = query.eq('setter_id', callFilterSetter);
      if (callFilterCampaign !== 'all') query = query.eq('campaign_id', callFilterCampaign);
      if (callFilterStatus !== 'all') query = query.eq('call_status', callFilterStatus);
      const { data, count } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
      if (data) { setCallHistory(data); setCallHistoryCount(count || 0); }
    } catch (err) {
      console.error('Error fetching call history:', err);
    } finally {
      setCallHistoryLoading(false);
    }
  }, [clientId, dateRange, search, page, pageSize, getDateCutoff, callFilterSetter, callFilterCampaign, callFilterStatus]);

  // ── Bookings fetcher ──
  const fetchBookings = useCallback(async () => {
    if (!clientId) { setBookings([]); setBookingsLoading(false); return; }
    setBookingsLoading(true);
    try {
      let query = (supabase as any)
        .from('bookings')
        .select('*', { count: 'exact' })
        .eq('client_id', clientId)
        .gte('created_at', getDateCutoff())
        .order('created_at', { ascending: false });
      if (search.trim()) query = query.or(`title.ilike.%${search}%,status.ilike.%${search}%,ghl_booking_id.ilike.%${search}%,notes.ilike.%${search}%`);
      const { data, count } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
      if (data) { setBookings(data); setBookingsCount(count || 0); }
    } catch (err) {
      console.error('Error fetching bookings:', err);
    } finally {
      setBookingsLoading(false);
    }
  }, [clientId, dateRange, search, page, pageSize, getDateCutoff]);

  useEffect(() => {
    if (tab === 'followups' && ghlLoaded && ghlAccountId) fetchFollowups();
    else if (tab === 'outbound-calls' && clientId) fetchCallHistory();
    else if (tab === 'bookings' && clientId) fetchBookings();
    else if (!['followups', 'outbound-calls', 'bookings'].includes(tab) && ghlLoaded && ghlAccountId) fetchLogs();
    else if (ghlLoaded && !ghlAccountId && !['outbound-calls', 'bookings'].includes(tab)) { setLoading(false); setFollowupsLoading(false); }
  }, [ghlLoaded, ghlAccountId, fetchLogs, fetchFollowups, fetchCallHistory, fetchBookings, tab, clientId]);

  // Auto-refresh every 30s (silent)
  useEffect(() => {
    if (!ghlAccountId) return;
    const silentRefresh = async () => {
      try {
        let query = (supabase as any)
          .from('error_logs')
          .select('*', { count: 'exact' })
          .eq('client_ghl_account_id', ghlAccountId)
          .gte('created_at', getDateCutoff())
          .order('created_at', { ascending: false });
        if (tab === 'ai-jobs') query = query.eq('source', 'run_ai_job');
        else if (tab === 'errors') query = query.eq('severity', 'error');
        if (search.trim()) query = query.or(`error_message.ilike.%${search}%,title.ilike.%${search}%`);
        const { data, count } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
        if (data) {
          let finalLogs = data as LogEntry[];
          // Enrich AI job logs with slotId
          if (tab === 'ai-jobs' && finalLogs.length > 0) {
            const jobIds = finalLogs.map(l => l.context?.job_id || l.job_id).filter(Boolean) as string[];
            if (jobIds.length > 0) {
              const { data: jobRows } = await (supabase as any)
                .from('ai_generation_jobs')
                .select('id, input_payload')
                .in('id', jobIds);
              if (jobRows) {
                const slotMap: Record<string, string> = {};
                for (const jr of jobRows) {
                  if (jr.input_payload?.slotId) slotMap[jr.id] = jr.input_payload.slotId;
                }
                finalLogs = finalLogs.map(l => {
                  const jid = l.context?.job_id || l.job_id;
                  if (jid && slotMap[jid] && !l.context?.slotId) {
                    return { ...l, context: { ...l.context, _enrichedSlotId: slotMap[jid] } };
                  }
                  return l;
                });
              }
            }
          }
          setLogs(finalLogs);
          setTotalCount(count || 0);
        }
      } catch {}
    };
    refreshInterval.current = setInterval(silentRefresh, 30000);
    return () => { if (refreshInterval.current) clearInterval(refreshInterval.current); };
  }, [ghlAccountId, tab, dateRange, severityFilter, search, page, pageSize, getDateCutoff]);

  // Reset page on filter change
  useEffect(() => { setPage(0); }, [tab, dateRange, severityFilter, search]);

  // Lazy fetch raw_exchanges when drawer opens for AI job rows
  useEffect(() => {
    if (!selectedLog) { setRawExchanges(null); return; }
    if (selectedLog.source !== 'run_ai_job' || !selectedLog.job_id) { setRawExchanges(null); return; }
    let cancelled = false;
    setRawExchangesLoading(true);
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('ai_generation_jobs')
          .select('raw_exchanges')
          .eq('id', selectedLog.job_id)
          .single();
        if (!cancelled) setRawExchanges(data?.raw_exchanges || null);
      } catch {
        if (!cancelled) setRawExchanges(null);
      } finally {
        if (!cancelled) setRawExchangesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedLog]);

  // totalPages computed after effectiveTotalCount

  const handleRefresh = useCallback(() => {
    if (tab === 'followups') fetchFollowups();
    else if (tab === 'outbound-calls') fetchCallHistory();
    else if (tab === 'bookings') fetchBookings();
    else fetchLogs();
  }, [tab, fetchFollowups, fetchCallHistory, fetchBookings, fetchLogs]);

  const isRefreshing = tab === 'followups' ? followupsLoading : tab === 'outbound-calls' ? callHistoryLoading : tab === 'bookings' ? bookingsLoading : loading;

  const searchPlaceholder = tab === 'ai-jobs' ? 'Search AI jobs...' : tab === 'errors' ? 'Search errors...' : tab === 'followups' ? 'Search follow-ups...' : tab === 'outbound-calls' ? 'Search calls...' : tab === 'bookings' ? 'Search bookings...' : 'Search all logs...';

  const DATE_RANGE_LABELS: Record<DateRange, string> = {
    '24h': 'Last 24 Hours',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
  };

  

  const searchFilterExtra = (
    <div className="flex items-center ml-4" style={{ gap: '12px' }}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10 !h-8 w-[252px]"
        />
      </div>
      <Popover open={dateDropdownOpen} onOpenChange={setDateDropdownOpen}>
        <PopoverTrigger asChild>
          <button
            className="relative flex h-8 items-center groove-border bg-card px-3 pr-10 py-1 text-left shrink-0 min-w-[160px]"
            style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            <span className="truncate text-foreground">{DATE_RANGE_LABELS[dateRange]}</span>
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
          className="w-[var(--radix-popover-trigger-width)] p-0 border border-border bg-sidebar"
          align="start"
          sideOffset={4}
        >
          <div className="p-1">
            {(['24h', '7d', '30d'] as DateRange[]).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => { setDateRange(v); setDateDropdownOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors",
                  dateRange === v
                    ? "bg-accent/50 text-foreground"
                    : "hover:bg-muted/50 text-foreground"
                )}
                style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 'normal' }}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", dateRange === v ? "opacity-100" : "opacity-0")} />

                <span>{DATE_RANGE_LABELS[v]}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );

  usePageHeader({
    title: 'Logs',
    leftExtra: searchFilterExtra,
    actions: [
      {
        label: isRefreshing ? 'REFRESHING...' : 'REFRESH',
        icon: <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />,
        onClick: handleRefresh,
        disabled: isRefreshing,
      },
    ],
  }, [isRefreshing, handleRefresh, search, searchPlaceholder, dateRange, dateDropdownOpen]);

  // ── Helpers to determine status for completed log rows ──
  const getLogStatus = (log: LogEntry): string => {
    if (log.severity === 'error') return 'error';
    if (log.source === 'run_ai_job' && log.severity === 'info') return 'success';
    return log.severity;
  };

  // ── Cell border style helpers (CRM-matching) ──
  const headerCellStyle = (isLast: boolean): React.CSSProperties => ({
    borderBottom: '3px groove hsl(var(--border-groove))',
    borderRight: isLast ? 'none' : '3px groove hsl(var(--border-groove))',
  });

  const bodyCellStyle = (isLast: boolean): React.CSSProperties => ({
    borderBottom: '1px solid hsl(var(--border))',
    borderRight: isLast ? 'none' : '1px solid hsl(var(--border-groove) / 0.3)',
    overflow: 'hidden',
    textOverflow: 'clip',
    whiteSpace: 'nowrap',
    maxWidth: 0,
  });

  // ── Row renderers ──

  const renderAIJobsRow = (log: LogEntry) => {
    const ctx = log.context || {};
    const actualJobType = ctx.job_type || (log.title || '').replace(/ completed$/, '') || log.error_type || log.source || '';
    const resource = getResourceInfo(actualJobType, ctx, setterDisplayNames);
    const status = getLogStatus(log);
    const rawJobType = log.error_type === 'ai_job_completed' ? (log.title || '').replace(/ completed$/, '') : (log.error_type || log.title || '');
    const jobTypeLabel = JOB_TYPE_LABELS[rawJobType] || JOB_TYPE_LABELS[log.error_type || ''] || JOB_TYPE_LABELS[log.title || ''] || log.title || log.error_type || '—';
    return (
      <tr key={log.id} className="hover:bg-accent cursor-pointer transition-colors duration-100" onClick={() => setSelectedLog(log)}>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">
            {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
          </span>
        </td>
        <td className="px-4 py-2.5" style={bodyCellStyle(false)}><StatusBadge status={status} /></td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>{jobTypeLabel}</td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {resource ? (
            resource.path ? (
              <button
                className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1"
                style={FONT}
                onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/${resource.path}`); }}
              >
                {resource.label}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </button>
            ) : <span className="text-muted-foreground">{resource.label}</span>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}><span className="text-muted-foreground">{simplifyModelName(ctx.model || '')}</span></td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {ctx.duration_seconds != null ? `${Number(ctx.duration_seconds).toFixed(1)}s` : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {ctx.prompt_tokens != null && ctx.completion_tokens != null
            ? `${Number(ctx.prompt_tokens).toLocaleString()} → ${Number(ctx.completion_tokens).toLocaleString()}`
            : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(true) }}>
          {ctx.cost != null ? `$${Number(ctx.cost).toFixed(4)}` : <span className="text-muted-foreground">—</span>}
        </td>
      </tr>
    );
  };

  const renderLiveJobRow = (job: LiveJob) => {
    const resource = getResourceInfo(job.job_type, job.input_payload, setterDisplayNames);
    const jobLabel = JOB_TYPE_LABELS[job.job_type] || job.job_type;
    return (
      <tr key={`live-${job.id}`} className="bg-muted/20">
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">{formatElapsed(job.started_at || job.created_at)}</span>
        </td>
        <td className="px-4 py-2.5" style={bodyCellStyle(false)}>
          <StatusTag variant="warning">{job.status === 'running' ? 'RUNNING' : 'PENDING'}</StatusTag>
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>{jobLabel}</td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {resource ? (
            resource.path ? (
              <button
                className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1"
                style={FONT}
                onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/${resource.path}`); }}
              >
                {resource.label}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </button>
            ) : <span className="text-muted-foreground">{resource.label}</span>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}><span className="text-muted-foreground">—</span></td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}><span className="text-muted-foreground">—</span></td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}><span className="text-muted-foreground">—</span></td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(true) }}><span className="text-muted-foreground">—</span></td>
      </tr>
    );
  };

  const renderErrorsRow = (log: LogEntry) => {
    const leadName = leadNameCache[log.lead_id || ''];
    return (
      <tr key={log.id} className="hover:bg-accent cursor-pointer transition-colors duration-100" onClick={() => setSelectedLog(log)}>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">
            {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
          </span>
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {log.lead_id ? (
            <button
              className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1"
              style={FONT}
              onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/leads/${log.lead_id}`); }}
            >
              <span className={cb}>{leadName || log.lead_id.substring(0, 8) + '…'}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </button>
          ) : '—'}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>{log.error_type}</td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(true) }}>
          <span className="text-foreground/80">{log.error_message}</span>
        </td>
      </tr>
    );
  };

  const renderFollowupRow = (entry: FollowupEntry) => {
    const setterLabelText = entry.setter_number != null ? setterLabel('text', entry.setter_number, setterDisplayNames) : '—';
    const setterSlotId = entry.setter_number != null ? `Setter-${entry.setter_number}` : null;
    const followupNum = entry.sequence_index != null ? entry.sequence_index + 1 : '—';
    const decision = entry.decision?.toLowerCase();
    const leadName = leadNameCache[entry.lead_id || ''];
    const leadUuid = leadIdToUuid[entry.lead_id || ''] || entry.lead_id;
    return (
      <tr key={entry.id} className="hover:bg-accent cursor-pointer transition-colors duration-100" onClick={() => setSelectedFollowup(entry)}>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">
            {format(new Date(entry.updated_at), 'MMM d, HH:mm:ss')}
          </span>
        </td>
        <td className="px-4 py-2.5" style={bodyCellStyle(false)}>
          {decision === 'sent' ? <StatusTag variant="positive">SENT</StatusTag> : decision === 'cancelled' ? <StatusTag variant="negative">CANCELLED</StatusTag> : <StatusTag variant="neutral">{entry.decision || '—'}</StatusTag>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
           {entry.lead_id ? (
            <button
              className="text-primary underline hover:text-primary/80 text-left inline-flex items-center gap-1"
              style={FONT}
              onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/leads/${leadUuid}`); }}
            >
              <span className={cb}>{leadName || 'View Lead'}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </button>
          ) : '—'}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {setterSlotId ? (
            <button
              className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1"
              style={FONT}
              onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/prompts/text?slot=${setterSlotId}`); }}
            >
              {setterLabelText}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </button>
          ) : '—'}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>{followupNum}</td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(true) }}>
          <span className="text-foreground/80">{entry.decision_reason || '—'}</span>
        </td>
      </tr>
    );
  };

  const formatCallDuration = (ms?: number | null) => {
    if (!ms) return '—';
    const secs = Math.round(ms / 1000);
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins}:${remainder.toString().padStart(2, '0')}`;
  };

  const getCallStatusVariant = (status: string | null): 'positive' | 'warning' | 'negative' | 'neutral' => {
    if (!status) return 'neutral';
    const s = status.toLowerCase();
    if (s === 'ended' || s === 'completed') return 'positive';
    if (s === 'voicemail' || s === 'no-answer' || s === 'no_answer' || s === 'busy') return 'warning';
    if (s === 'error' || s === 'failed') return 'negative';
    return 'neutral';
  };

  const getSentimentVariant = (sentiment: string | null): 'positive' | 'warning' | 'negative' | 'neutral' => {
    if (!sentiment) return 'neutral';
    const s = sentiment.toLowerCase();
    if (s === 'positive') return 'positive';
    if (s === 'negative') return 'negative';
    if (s === 'neutral') return 'neutral';
    return 'warning';
  };

  const formatDisconnectReason = (reason: string | null): string => {
    if (!reason) return '—';
    return reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  const getSetterLabel = (setterId: string | null): string => {
    if (!setterId) return '—';
    // Handle various formats: Voice-Setter-1, voice-setter-1, voice_setter_1, Setter-1, setter-1
    const match = setterId.match(/(?:voice[-_])?setter[-_](\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      return setterLabel('voice', n, setterDisplayNames);
    }
    return setterId;
  };

  const renderOutboundCallRow = (entry: CallHistoryEntry) => {
    const leadName = entry.contact_name || leadNameCache[entry.contact_id || ''];
    const humanPickup = (entry as any).human_pickup;
    const voicemailDetected = (entry as any).voicemail_detected;
    const durationSeconds = (entry as any).duration_seconds;
    const callCost = entry.cost;
    const formatDurationSecs = (secs?: number | null) => {
      if (!secs && secs !== 0) return formatCallDuration(entry.duration_ms);
      const mins = Math.floor(secs / 60);
      const remainder = secs % 60;
      return `${mins}:${remainder.toString().padStart(2, '0')}`;
    };
    return (
      <tr key={entry.id} className="hover:bg-accent cursor-pointer transition-colors duration-100" onClick={() => setSelectedCall(entry)}>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">
            {format(new Date(entry.created_at), 'MMM d, HH:mm:ss')}
          </span>
        </td>
        <td className="px-4 py-2.5" style={bodyCellStyle(false)}>
          <StatusTag variant={getCallStatusVariant(entry.call_status)}>{(entry.call_status || 'unknown').toUpperCase()}</StatusTag>
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {entry.contact_id ? (
            <button
              className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1"
              style={FONT}
              onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/leads/${entry.contact_id}`); }}
            >
              <span className={cb}>{leadName || (entry.contact_id.substring(0, 8) + '…')}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </button>
          ) : <span className={`text-muted-foreground ${cb}`}>{entry.to_number || '—'}</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">{getSetterLabel(entry.setter_id)}</span>
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {formatDurationSecs(durationSeconds)}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {humanPickup === true ? <StatusTag variant="positive">YES</StatusTag> : humanPickup === false ? <StatusTag variant="neutral">NO</StatusTag> : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {callCost != null ? `$${Number(callCost).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {entry.recording_url ? (
            <button
              className="groove-btn inline-flex items-center gap-1 !h-6 !px-2 !py-0"
              style={{ ...FONT, fontSize: '11px' }}
              onClick={(e) => { e.stopPropagation(); setSelectedCall(entry); }}
            >
              <Play className="w-3 h-3" /> Play
            </button>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={bodyCellStyle(true)}>
          {entry.user_sentiment ? <StatusTag variant={getSentimentVariant(entry.user_sentiment)}>{entry.user_sentiment.toUpperCase()}</StatusTag> : <span className="text-muted-foreground">—</span>}
        </td>
      </tr>
    );
  };

  const renderBookingRow = (entry: BookingEntry) => {
    const leadName = leadNameCache[entry.lead_id || ''];
    const campaignName = campaignNameCache[entry.campaign_id || ''];
    const bookingStatusVariant = (s: string): 'positive' | 'warning' | 'negative' | 'neutral' => {
      const sl = s.toLowerCase();
      if (sl === 'confirmed' || sl === 'completed') return 'positive';
      if (sl === 'cancelled' || sl === 'canceled' || sl === 'no-show' || sl === 'no_show') return 'negative';
      if (sl === 'pending' || sl === 'rescheduled') return 'warning';
      return 'neutral';
    };
    return (
      <tr key={entry.id} className="hover:bg-accent cursor-pointer transition-colors duration-100" onClick={() => setSelectedBooking(entry)}>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">
            {entry.start_time ? format(new Date(entry.start_time), 'MMM d, h:mm a') : '—'}
          </span>
        </td>
        <td className="px-4 py-2.5" style={bodyCellStyle(false)}>
          <StatusTag variant={bookingStatusVariant(entry.status)}>{entry.status.toUpperCase()}</StatusTag>
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {entry.lead_id ? (
            <button
              className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1"
              style={FONT}
              onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/leads/${entry.lead_id}`); }}
            >
              <span className={cb}>{leadName || (entry.lead_id.substring(0, 8) + '…')}</span>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </button>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          {entry.campaign_id ? (
            <button
              className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1"
              style={FONT}
              onClick={(e) => { e.stopPropagation(); navigate(`/client/${clientId}/campaigns/${entry.campaign_id}`); }}
            >
              {campaignName || (entry.campaign_id.substring(0, 8) + '…')}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </button>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">{entry.title || '—'}</span>
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(false) }}>
          <span className="text-muted-foreground">{entry.location || '—'}</span>
        </td>
        <td className="px-4 py-2.5" style={{ ...FONT, ...bodyCellStyle(true) }}>
          <span className="text-muted-foreground">
            {format(new Date(entry.created_at), 'MMM d, HH:mm:ss')}
          </span>
        </td>
      </tr>
    );
  };

  const renderRow = tab === 'ai-jobs' ? renderAIJobsRow : renderErrorsRow;

  const isFollowupsTab = tab === 'followups';
  const isOutboundCallsTab = tab === 'outbound-calls';
  const isBookingsTab = tab === 'bookings';
  const dataLoading = isFollowupsTab ? followupsLoading : isOutboundCallsTab ? callHistoryLoading : isBookingsTab ? bookingsLoading : loading;
  const effectiveLoading = dataLoading || leadNamesLoading;
  const effectiveTotalCount = isFollowupsTab ? followupsCount : isOutboundCallsTab ? callHistoryCount : isBookingsTab ? bookingsCount : totalCount;
  const effectiveData = isFollowupsTab ? followups : isOutboundCallsTab ? callHistory : isBookingsTab ? bookings : logs;

  const totalPages = Math.ceil(effectiveTotalCount / pageSize);

  const emptyTitle = tab === 'ai-jobs' ? 'No AI Jobs Yet' : tab === 'errors' ? 'No Errors Found' : tab === 'followups' ? 'No Follow-ups Yet' : tab === 'outbound-calls' ? 'No Outbound Calls Yet' : tab === 'bookings' ? 'No Bookings Yet' : 'No Logs Found';
  const emptySubtitle = tab === 'ai-jobs' ? 'AI generation jobs will appear here as they are triggered.' : tab === 'errors' ? 'Error logs will appear here when issues are detected.' : tab === 'followups' ? 'Follow-up decisions will appear here as conversations progress.' : tab === 'outbound-calls' ? 'Outbound calls will appear here once calls are initiated.' : tab === 'bookings' ? 'Bookings will appear here when appointments are synced.' : !ghlAccountId ? 'Configure the GHL Location ID in Credentials first.' : 'Logs will appear here as activity occurs.';

  const TAB_ITEMS: { key: TabKey; label: string }[] = [
    { key: 'outbound-calls', label: 'OUTBOUND CALLS' },
    { key: 'bookings', label: 'BOOKINGS' },
    { key: 'followups', label: 'FOLLOW-UPS' },
    { key: 'ai-jobs', label: 'AI JOBS' },
    { key: 'errors', label: 'ERRORS' },
  ];

  return (
    <div className="container mx-auto max-w-7xl flex h-full min-h-0 flex-col overflow-hidden pb-0" style={{ paddingTop: '12px' }}>
      {/* Outer Logs surface tabs (Activity / Errors / Requests) — shared across
          the three logs pages. The inner activity-tabs (AI Jobs / Errors / etc.)
          below are SEPARATE concept (sub-categories within Activity). */}
      <div className="mb-3 shrink-0">
        <LogsTabsNav />
      </div>
      {/* Tabs — horizontally scrollable */}
      <div className="flex overflow-x-auto border-b border-dashed border-border shrink-0" style={{ marginBottom: '12px', scrollbarWidth: 'none', msOverflowStyle: 'none' } as any}>
        {TAB_ITEMS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`ibm-spacing-allow shrink-0 px-4 pt-0 pb-2.5 text-center font-medium transition-colors uppercase ${
              tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, letterSpacing: '2px' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Outbound Calls Filters */}
      {tab === 'outbound-calls' && (callSetterOptions.length > 0 || callCampaignOptions.length > 0) && (
        <div className="flex items-center gap-3 shrink-0" style={{ marginBottom: '8px' }}>
          <Select value={callFilterSetter} onValueChange={v => { setCallFilterSetter(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-auto min-w-[140px]" style={FONT}>
              <SelectValue placeholder="Setter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Setters</SelectItem>
              {callSetterOptions.map(s => (
                <SelectItem key={s} value={s}>{getSetterLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={callFilterCampaign} onValueChange={v => { setCallFilterCampaign(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-auto min-w-[160px]" style={FONT}>
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {callCampaignOptions.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={callFilterStatus} onValueChange={v => { setCallFilterStatus(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-auto min-w-[140px]" style={FONT}>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="ended">Ended</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="no_answer">No Answer</SelectItem>
              <SelectItem value="voicemail">Voicemail</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Table area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ border: '3px groove hsl(var(--border-groove))' }}>
        {effectiveLoading ? (
          <div className="flex-1 flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-2">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2.5 h-2.5 bg-foreground"
                    style={{
                      animation: 'saving-bounce 1.2s ease-in-out infinite',
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
              <p
                className="text-foreground"
                style={{
                  fontFamily: "'VT323', monospace",
                  fontSize: '22px',
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                }}
              >
                {isFollowupsTab ? 'Loading Follow-ups' : isOutboundCallsTab ? 'Loading Outbound Calls' : isBookingsTab ? 'Loading Bookings' : tab === 'ai-jobs' ? 'Loading AI Jobs' : 'Loading Errors'}
              </p>
              <style>{`
                @keyframes saving-bounce {
                  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                  40% { opacity: 1; transform: scale(1.2); }
                }
              `}</style>
            </div>
          </div>
        ) : effectiveData.length === 0 && (tab !== 'ai-jobs' || liveJobs.length === 0) ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <MessageSquare className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-medium">{emptyTitle}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {emptySubtitle}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto" style={{ overscrollBehavior: 'none' }}>
            <table className="text-base" style={{ tableLayout: 'fixed', width: Math.max(totalTableWidth, 0) || '100%', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <colgroup>
                {currentCols.map(col => (
                  <col key={col.key} style={{ width: currentWidths[col.key] || col.defaultWidth }} />
                ))}
              </colgroup>
              <thead className="bg-background sticky top-0 z-10">
                <tr>
                  {currentCols.map((col, i) => {
                    const isLast = i === currentCols.length - 1;
                    return (
                      <th
                        key={col.key}
                        className="sticky top-0 z-20 h-[52px] px-4 text-left align-middle text-[13px] font-medium tracking-wide text-foreground relative bg-background"
                        style={headerCellStyle(isLast)}
                      >
                        <div className="flex items-center gap-1 select-none overflow-hidden" style={{ textOverflow: 'clip' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'clip', whiteSpace: 'nowrap' }}>{col.label}</span>
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
                {tab === 'ai-jobs' && liveJobs.map(renderLiveJobRow)}
                {isFollowupsTab
                  ? followups.map(renderFollowupRow)
                  : isOutboundCallsTab
                    ? callHistory.map(renderOutboundCallRow)
                    : isBookingsTab
                      ? bookings.map(renderBookingRow)
                      : logs.map(renderRow)
                }
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination bar — CRM style */}
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
          <span className="text-muted-foreground" style={FONT}>
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

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog && !expandedText} onOpenChange={(open) => { if (!open) setSelectedLog(null); }}>
        <DialogContent className="flex flex-col" style={{ maxWidth: '56rem', width: '90vw', height: '85vh', maxHeight: '85vh' }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="uppercase">
                {selectedLog ? getDrawerTitle(selectedLog) : 'LOG DETAIL'}
              </DialogTitle>
              {selectedLog && <SeverityBadge severity={selectedLog.severity} />}
            </div>
          </DialogHeader>

          {selectedLog && (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="space-y-5 px-6 py-6">
                {/* Timestamp */}
                <div>
                  <label className={LABEL_CLS} style={FONT}>Time</label>
                  <span className="text-foreground" style={FONT}>{format(new Date(selectedLog.created_at), 'MMM d, yyyy h:mm:ss a')}</span>
                </div>

                {/* Title */}
                {selectedLog.title && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Title</label>
                    <p className="text-foreground" style={FONT}>{selectedLog.title}</p>
                  </div>
                )}

                {/* Error Message */}
                <div>
                  <label className={LABEL_CLS} style={FONT}>Message</label>
                  <div className="relative">
                    <pre
                      className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto max-h-[200px] whitespace-pre-wrap break-words"
                      style={{ ...FONT, lineHeight: '1.5' }}
                    >
                      {selectedLog.error_message}
                    </pre>
                    {selectedLog.error_message.length > 200 && (
                      <Button
                        type="button"
                        variant="default"
                        size="icon"
                        onClick={() => setExpandedText({ title: 'MESSAGE', content: selectedLog.error_message })}
                        className="absolute bottom-2 right-2 h-8 w-8"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Metadata chips (error_type, source) */}
                <div className="flex flex-wrap gap-4">
                  {selectedLog.error_type && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Error Type</label>
                      <span
                        className="cursor-pointer block mt-1"
                        title="Click to copy"
                        onClick={() => { navigator.clipboard.writeText(selectedLog.error_type!); toast.success('Error Type copied'); }}
                      >
                        <StatusTag variant="neutral">{selectedLog.error_type}</StatusTag>
                      </span>
                    </div>
                  )}
                  {selectedLog.source && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Source</label>
                      <span
                        className="cursor-pointer block mt-1"
                        title="Click to copy"
                        onClick={() => { navigator.clipboard.writeText(selectedLog.source!); toast.success('Source copied'); }}
                      >
                        <StatusTag variant="neutral">{selectedLog.source}</StatusTag>
                      </span>
                    </div>
                  )}
                </div>

                {/* Performance metrics (AI Jobs only) */}
                <LogDetailPerformance log={selectedLog} />

                {/* Debug IDs */}
                <LogDetailDebugInfo log={selectedLog} />

                {/* Context JSON */}
                {selectedLog.context && typeof selectedLog.context === 'object' && Object.keys(selectedLog.context).length > 0 && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Context</label>
                    <div className="p-3 groove-border bg-card overflow-auto max-h-[300px]">
                      {Object.entries(selectedLog.context).map(([key, value]) => (
                        <SchemaNode key={key} label={key} value={value} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw Exchanges (AI Jobs only) */}
                {selectedLog.source === 'run_ai_job' && selectedLog.job_id && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Raw Exchanges</label>
                    {rawExchangesLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground" style={FONT}>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                      </div>
                    ) : !rawExchanges || (Array.isArray(rawExchanges) && rawExchanges.length === 0) ? (
                      <p className="text-muted-foreground" style={FONT}>Raw data not available for this job</p>
                    ) : (
                      <div className="space-y-2">
                        {(Array.isArray(rawExchanges) ? rawExchanges : [rawExchanges]).map((exchange: any, idx: number, arr: any[]) => {
                          const isChunked = exchange.chunk_index != null;
                          const label = isChunked ? `Chunk ${(exchange.chunk_index ?? idx) + 1} of ${arr.length}` : (arr.length > 1 ? `Exchange ${idx + 1}` : 'Request');
                          return (
                            <RawExchangeBlock key={idx} exchange={exchange} label={label} onExpand={setExpandedText} />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Expanded Text Dialog */}
      <Dialog open={!!expandedText} onOpenChange={(open) => { if (!open) setExpandedText(null); }}>
        <DialogContent
          className="flex flex-col"
          style={{ width: '90vw', maxWidth: '64rem', height: '90vh', maxHeight: '90vh' }}
        >
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              {expandedText?.title || 'CONTENT'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-6 py-6 overflow-auto">
            <pre
              className="text-foreground/80 p-4 groove-border bg-muted/20 whitespace-pre-wrap break-words h-full overflow-auto"
              style={{ ...FONT, lineHeight: '1.6' }}
            >
              {expandedText?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* Call Detail Dialog */}
      <Dialog open={!!selectedCall && !transcriptOpen} onOpenChange={(open) => { if (!open) setSelectedCall(null); }}>
        <DialogContent className="flex flex-col" style={{ maxWidth: '56rem', width: '90vw', height: '85vh', maxHeight: '85vh' }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="uppercase">CALL DETAIL</DialogTitle>
              {selectedCall && <StatusTag variant={getCallStatusVariant(selectedCall.call_status)}>{(selectedCall.call_status || 'unknown').toUpperCase()}</StatusTag>}
            </div>
          </DialogHeader>

          {selectedCall && (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="space-y-5 px-6 py-6">
                {/* Call meta */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Time</label>
                    <span className="text-muted-foreground" style={FONT}>{format(new Date(selectedCall.created_at), 'MMM d, yyyy h:mm:ss a')}</span>
                  </div>
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Duration</label>
                    <span className="text-muted-foreground" style={FONT}>{formatCallDuration(selectedCall.duration_ms)}</span>
                  </div>
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>From</label>
                    <span className={`text-muted-foreground ${cb}`} style={FONT}>{selectedCall.from_number || '—'}</span>
                  </div>
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>To</label>
                    <span className={`text-muted-foreground ${cb}`} style={FONT}>{selectedCall.to_number || '—'}</span>
                  </div>
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Direction</label>
                    <span className="text-muted-foreground" style={FONT}>{selectedCall.direction ? selectedCall.direction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'}</span>
                  </div>
                  {selectedCall.disconnect_reason && (
                    <div>
                      <label className="text-foreground block mb-1" style={FONT}>Disconnect Reason</label>
                      <span className="text-muted-foreground" style={FONT}>{selectedCall.disconnect_reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                    </div>
                  )}
                  {selectedCall.user_sentiment && (
                    <div>
                      <label className="text-foreground block mb-1" style={FONT}>Sentiment</label>
                      <StatusTag variant={getSentimentVariant(selectedCall.user_sentiment)}>{selectedCall.user_sentiment.toUpperCase()}</StatusTag>
                    </div>
                  )}
                  {selectedCall.call_successful !== null && (
                    <div>
                      <label className="text-foreground block mb-1" style={FONT}>Call Successful</label>
                      <StatusTag variant={selectedCall.call_successful ? 'positive' : 'negative'}>{selectedCall.call_successful ? 'YES' : 'NO'}</StatusTag>
                    </div>
                  )}
                  {selectedCall.cost != null && (
                    <div>
                      <label className="text-foreground block mb-1" style={FONT}>Cost</label>
                      <span className="text-muted-foreground" style={FONT}>${Number(selectedCall.cost).toFixed(4)}</span>
                    </div>
                  )}
                </div>

                {/* Call Summary */}
                {selectedCall.call_summary && (
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Call Summary</label>
                    <pre
                      className="text-muted-foreground p-3 groove-border bg-muted/20 overflow-auto max-h-[200px] whitespace-pre-wrap break-words"
                      style={{ ...FONT, lineHeight: '1.5' }}
                    >
                      {selectedCall.call_summary}
                    </pre>
                  </div>
                )}

                {/* Recording - Custom Player */}
                {selectedCall.recording_url && (
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Recording</label>
                    <CustomAudioPlayer src={selectedCall.recording_url} />
                  </div>
                )}

                {/* Transcript */}
                {selectedCall.transcript && (
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Transcript</label>
                    <Button
                      variant="outline"
                      className="groove-btn field-text"
                      onClick={() => {
                        callBeforeTranscriptRef.current = selectedCall;
                        setTranscriptOpen(true);
                      }}
                    >
                      <MessageSquare className="w-3.5 h-3.5 mr-2" />
                      VIEW TRANSCRIPT
                    </Button>
                  </div>
                )}

                {/* Custom Analysis Data */}
                {selectedCall.custom_analysis_data && Object.keys(selectedCall.custom_analysis_data).length > 0 && (
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Custom Analysis</label>
                    <div className="p-3 groove-border bg-card overflow-auto max-h-[300px]">
                      {Object.entries(selectedCall.custom_analysis_data).map(([key, value]) => (
                        <SchemaNode key={key} label={key} value={value} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Campaign */}
                {selectedCall.campaign_id && (
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Campaign</label>
                    <span className="text-muted-foreground" style={FONT}>
                      {callCampaignOptions.find(c => c.id === selectedCall.campaign_id)?.name || selectedCall.campaign_id}
                    </span>
                  </div>
                )}

                {/* Debug IDs */}
                <div className="flex flex-wrap gap-3">
                  <div>
                    <label className="text-foreground block mb-1" style={FONT}>Retell Call ID</label>
                    <CopyButton value={selectedCall.call_id} label="Call ID" />
                  </div>
                  {selectedCall.contact_id && (
                    <div>
                      <label className="text-foreground block mb-1" style={FONT}>Contact ID</label>
                      <CopyButton value={selectedCall.contact_id} label="Contact ID" />
                    </div>
                  )}
                  {selectedCall.agent_id && (
                    <div>
                      <label className="text-foreground block mb-1" style={FONT}>Agent ID</label>
                      <CopyButton value={selectedCall.agent_id} label="Agent ID" />
                    </div>
                  )}
                  {selectedCall.setter_id && (
                    <div>
                      <label className="text-foreground block mb-1" style={FONT}>Setter</label>
                      <span className="text-muted-foreground block mt-1" style={FONT}>{getSetterLabel(selectedCall.setter_id)}</span>
                    </div>
                  )}
                </div>

                {selectedCall.public_log_url && (
                  <a
                    href={selectedCall.public_log_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    style={FONT}
                  >
                    <ExternalLink className="w-3 h-3" /> View Full Log in Retell
                  </a>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Transcript Dialog */}
      <Dialog open={transcriptOpen} onOpenChange={(open) => {
        if (!open) {
          setTranscriptOpen(false);
          if (callBeforeTranscriptRef.current) {
            setSelectedCall(callBeforeTranscriptRef.current);
          }
        }
      }}>
        <DialogContent className="flex flex-col" style={{ maxWidth: '56rem', width: '90vw', height: '85vh', maxHeight: '85vh' }}>
          <DialogHeader>
            <DialogTitle className="uppercase">CALL TRANSCRIPT</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 overflow-auto">
            <div className="px-6 py-6">
              <TranscriptBubbles
                transcript={callBeforeTranscriptRef.current?.transcript || null}
                transcriptObject={callBeforeTranscriptRef.current?.transcript_object}
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Follow-up Detail Dialog */}
      <Dialog open={!!selectedFollowup} onOpenChange={(open) => { if (!open) setSelectedFollowup(null); }}>
        <DialogContent className="flex flex-col" style={{ maxWidth: '56rem', width: '90vw', height: '85vh', maxHeight: '85vh' }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="uppercase">FOLLOW-UP DETAIL</DialogTitle>
              {selectedFollowup && (
                selectedFollowup.decision?.toLowerCase() === 'sent'
                  ? <StatusTag variant="positive">SENT</StatusTag>
                  : selectedFollowup.decision?.toLowerCase() === 'cancelled'
                    ? <StatusTag variant="negative">CANCELLED</StatusTag>
                    : <StatusTag variant="neutral">{selectedFollowup.decision || '—'}</StatusTag>
              )}
            </div>
          </DialogHeader>

          {selectedFollowup && (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="space-y-5 px-6 py-6">
                {/* Timestamp */}
                <div>
                  <label className={LABEL_CLS} style={FONT}>Time</label>
                  <span className="text-foreground" style={FONT}>{format(new Date(selectedFollowup.updated_at), 'MMM d, yyyy h:mm:ss a')}</span>
                </div>

                {/* Contact / Setter / Follow-up # */}
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Contact ID</label>
                    <CopyButton value={selectedFollowup.lead_id} label="Contact ID" />
                  </div>
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Setter</label>
                    <span className="text-foreground block mt-1" style={FONT}>{selectedFollowup.setter_number != null ? setterLabel('text', selectedFollowup.setter_number, setterDisplayNames) : '—'}</span>
                  </div>
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Follow-up #</label>
                    <span className="text-foreground block mt-1" style={FONT}>{selectedFollowup.sequence_index != null ? selectedFollowup.sequence_index + 1 : '—'}</span>
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className={LABEL_CLS} style={FONT}>Reason</label>
                  <pre
                    className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto max-h-[200px] whitespace-pre-wrap break-words"
                    style={{ ...FONT, lineHeight: '1.5' }}
                  >
                    {selectedFollowup.decision_reason || '—'}
                  </pre>
                </div>

                {/* Raw Exchange — Prompt */}
                {selectedFollowup.raw_exchange && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Prompt sent to AI</label>
                    {selectedFollowup.raw_exchange.messages && Array.isArray(selectedFollowup.raw_exchange.messages) ? (
                      <div className="space-y-3 mt-2">
                        {selectedFollowup.raw_exchange.messages.map((msg: any, mi: number) => (
                          <div key={mi}>
                            <div className="flex items-center justify-between mb-1">
                              <StatusTag variant={msg.role === 'system' ? 'neutral' : msg.role === 'assistant' ? 'positive' : 'warning'}>{msg.role?.toUpperCase()}</StatusTag>
                              <button onClick={() => { navigator.clipboard.writeText(msg.content || ''); toast.success('Copied'); }} className="text-muted-foreground hover:text-foreground transition-colors p-1" title="Copy">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <pre
                              className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto whitespace-pre-wrap break-words"
                              style={{ ...FONT, lineHeight: '1.5', maxHeight: '400px' }}
                            >
                              {msg.content}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground" style={FONT}>No prompt messages available</p>
                    )}
                  </div>
                )}

                {/* Raw Exchange — Response */}
                {selectedFollowup.raw_exchange && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>AI Response</label>
                    <pre
                      className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto whitespace-pre-wrap break-words mt-2"
                      style={{ ...FONT, lineHeight: '1.5', maxHeight: '400px' }}
                    >
                      {JSON.stringify(selectedFollowup.raw_exchange.response || selectedFollowup.raw_exchange.raw_response || '—', null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Booking Detail Dialog */}
      <Dialog open={!!selectedBooking} onOpenChange={(open) => { if (!open) setSelectedBooking(null); }}>
        <DialogContent className="flex flex-col" style={{ maxWidth: '56rem', width: '90vw', height: '85vh', maxHeight: '85vh' }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="uppercase">BOOKING DETAIL</DialogTitle>
              {selectedBooking && (() => {
                const sl = selectedBooking.status.toLowerCase();
                const v = sl === 'confirmed' || sl === 'completed' ? 'positive' as const : sl === 'cancelled' || sl === 'canceled' || sl === 'no-show' ? 'negative' as const : sl === 'pending' || sl === 'rescheduled' ? 'warning' as const : 'neutral' as const;
                return <StatusTag variant={v}>{selectedBooking.status.toUpperCase()}</StatusTag>;
              })()}
            </div>
          </DialogHeader>

          {selectedBooking && (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="space-y-5 px-6 py-6">
                {/* Timestamp */}
                <div>
                  <label className={LABEL_CLS} style={FONT}>Time</label>
                  <span className="text-foreground" style={FONT}>{format(new Date(selectedBooking.created_at), 'MMM d, yyyy h:mm:ss a')}</span>
                </div>

                {/* Booking meta */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {selectedBooking.title && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Title</label>
                      <span className="text-foreground" style={FONT}>{selectedBooking.title}</span>
                    </div>
                  )}
                  {selectedBooking.start_time && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Start Time</label>
                      <span className="text-foreground" style={FONT}>{format(new Date(selectedBooking.start_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedBooking.end_time && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>End Time</label>
                      <span className="text-foreground" style={FONT}>{format(new Date(selectedBooking.end_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedBooking.location && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Location</label>
                      <span className="text-foreground" style={FONT}>{selectedBooking.location}</span>
                    </div>
                  )}
                  {selectedBooking.setter_name && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Setter</label>
                      <span className="text-foreground" style={FONT}>{selectedBooking.setter_name}{selectedBooking.setter_type ? ` (${selectedBooking.setter_type})` : ''}</span>
                    </div>
                  )}
                  {selectedBooking.calendar_id && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Calendar ID</label>
                      <CopyButton value={selectedBooking.calendar_id} label="Calendar ID" />
                    </div>
                  )}
                </div>

                {/* Notes */}
                {selectedBooking.notes && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Notes</label>
                    <pre
                      className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto max-h-[200px] whitespace-pre-wrap break-words"
                      style={{ ...FONT, lineHeight: '1.5' }}
                    >
                      {selectedBooking.notes}
                    </pre>
                  </div>
                )}

                {/* Campaign */}
                {selectedBooking.campaign_id && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Campaign</label>
                    <button
                      className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1 mt-1"
                      style={FONT}
                      onClick={() => navigate(`/client/${clientId}/campaigns/${selectedBooking.campaign_id}`)}
                    >
                      {campaignNameCache[selectedBooking.campaign_id] || selectedBooking.campaign_id}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </button>
                  </div>
                )}

                {/* Debug IDs */}
                <div className="flex flex-wrap gap-3">
                  {selectedBooking.ghl_booking_id && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>GHL Booking ID</label>
                      <CopyButton value={selectedBooking.ghl_booking_id} label="GHL Booking ID" />
                    </div>
                  )}
                  {selectedBooking.ghl_contact_id && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>GHL Contact ID</label>
                      <CopyButton value={selectedBooking.ghl_contact_id} label="GHL Contact ID" />
                    </div>
                  )}
                  {selectedBooking.lead_id && (
                    <div>
                      <label className={LABEL_CLS} style={FONT}>Lead</label>
                      <button
                        className="text-foreground underline hover:text-primary text-left inline-flex items-center gap-1 mt-1"
                        style={FONT}
                        onClick={() => navigate(`/client/${clientId}/leads/${selectedBooking.lead_id}`)}
                      >
                        {leadNameCache[selectedBooking.lead_id] || selectedBooking.lead_id}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Raw GHL Data */}
                {selectedBooking.raw_ghl_data && typeof selectedBooking.raw_ghl_data === 'object' && Object.keys(selectedBooking.raw_ghl_data).length > 0 && (
                  <div>
                    <label className={LABEL_CLS} style={FONT}>Raw GHL Data</label>
                    <div className="p-3 groove-border bg-card overflow-auto max-h-[300px]">
                      {Object.entries(selectedBooking.raw_ghl_data).map(([key, value]) => (
                        <SchemaNode key={key} label={key} value={value} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ── Raw Exchange collapsible block ── */

const RawExchangeBlock: React.FC<{ exchange: any; label: string; onExpand?: (data: { title: string; content: string }) => void }> = ({ exchange, label, onExpand }) => {
  const [activeTab, setActiveTab] = useState<'prompt' | 'response'>('prompt');
  const [open, setOpen] = useState(false);

  const messages: { role: string; content: string }[] = exchange.messages || [];
  const rawResponse = exchange.raw_response || '';

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error('Failed to copy'); }
  };

  const roleBadgeVariant = (role: string): 'neutral' | 'positive' | 'warning' => {
    if (role === 'system') return 'neutral';
    if (role === 'assistant') return 'positive';
    return 'warning';
  };

  const fullPromptText = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n');

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 groove-border bg-card hover:bg-muted/50 transition-colors cursor-pointer">
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`} />
        <span className="text-foreground" style={FONT}>{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="groove-border border-t-0 bg-card">
          {/* Sub-tabs */}
          <div className="flex" style={{ borderBottom: '3px groove hsl(var(--border-groove))' }}>
            <button
              className={`px-4 py-2 transition-colors ${activeTab === 'prompt' ? 'text-foreground bg-muted/50' : 'text-muted-foreground hover:text-foreground'}`}
              style={FONT}
              onClick={() => setActiveTab('prompt')}
            >
              Prompt
            </button>
            <button
              className={`px-4 py-2 transition-colors ${activeTab === 'response' ? 'text-foreground bg-muted/50' : 'text-muted-foreground hover:text-foreground'}`}
              style={FONT}
              onClick={() => setActiveTab('response')}
            >
              Response
            </button>
          </div>

          <div className="p-3">
            {activeTab === 'prompt' ? (
              messages.length > 0 ? (
                <div className="space-y-3">
                  {messages.map((msg, mi) => (
                    <div key={mi}>
                      <div className="flex items-center justify-between mb-1">
                        <StatusTag variant={roleBadgeVariant(msg.role)}>{msg.role.toUpperCase()}</StatusTag>
                        <button onClick={() => copyText(msg.content)} className="text-muted-foreground hover:text-foreground transition-colors p-1" title="Copy">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="relative">
                        <pre
                          className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto whitespace-pre-wrap break-words"
                          style={{ ...FONT, lineHeight: '1.5', maxHeight: '400px' }}
                        >
                          {msg.content}
                        </pre>
                        {msg.content.length > 300 && onExpand && (
                          <button
                            type="button"
                            onClick={() => onExpand({ title: `${msg.role.toUpperCase()} PROMPT`, content: msg.content })}
                            className="absolute bottom-2 right-2 h-8 w-8 flex items-center justify-center groove-border bg-card hover:bg-accent transition-colors"
                          >
                            <Maximize2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground" style={FONT}>No prompt messages available</p>
              )
            ) : (
              rawResponse ? (
                <div>
                  <div className="flex justify-end mb-1">
                    <button onClick={() => copyText(rawResponse)} className="text-muted-foreground hover:text-foreground transition-colors p-1" title="Copy">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="relative">
                    <pre
                      className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto whitespace-pre-wrap break-words"
                      style={{ ...FONT, lineHeight: '1.5', maxHeight: '400px' }}
                    >
                      {rawResponse}
                    </pre>
                    {rawResponse.length > 300 && onExpand && (
                      <button
                        type="button"
                        onClick={() => onExpand({ title: 'RESPONSE', content: rawResponse })}
                        className="absolute bottom-2 right-2 h-8 w-8 flex items-center justify-center groove-border bg-card hover:bg-accent transition-colors"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground" style={FONT}>No response data available</p>
              )
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default Logs;
