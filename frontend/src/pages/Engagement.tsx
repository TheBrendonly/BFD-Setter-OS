import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import { supabase } from '@/integrations/supabase/client';
import { edgeFunctionUrl } from '@/integrations/supabase/functionsBase';
import { getCached, setCache } from '@/lib/queryCache';
import { cn } from '@/lib/utils';
import { insertDefaultCampaignWidgets } from '@/lib/campaignWidgets';
import { useNavigationGuard } from '@/contexts/NavigationGuardContext';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { X, Save, ClipboardCheck, RefreshCw, Loader2, Square, Code, ChevronDown, ChevronRight, ChevronLeft, Search, Layers, Rocket, Power, Zap, MessageSquare, Phone, GripVertical, Clock, Maximize2, Check, Trash2, Plus, Copy, Globe, Pencil, Pause, Play } from '@/components/icons';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import SavingOverlay from '@/components/SavingOverlay';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import RetroLoader from '@/components/RetroLoader';
import WorkflowCanvas, { type CanvasNode } from '@/components/workflow/WorkflowCanvas';
import { format } from 'date-fns';
import { nanoid } from 'nanoid';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  buildFlatToOriginalMap,
  expandNodesToFlat,
  isActiveExecution,
  isCompletedExecution,
  isFailedExecution,
  isStoppedExecution,
  resolveExecutionFlatIndex,
  type FlatWorkflowStep,
} from '@/lib/engagementExecutionState';

const fieldStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;
const tabStyle = { fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' } as const;

interface EngageChannel {
  type: 'sms' | 'whatsapp' | 'phone_call' | 'email';
  enabled: boolean;
  message?: string;
  subject?: string; // for email
  instructions?: string; // for phone_call
  delay_seconds?: number; // delay before this step (0 for first)
  voice_setter_id?: string; // slot_id from agent_settings for phone_call
  treat_pickup_as_reply?: boolean; // if true, human pickup ends engagement
  wa_mode?: 'template' | 'freeform'; // whatsapp mode
  wa_template_name?: string; // approved Meta template name
  whatsapp_type?: 'template' | 'text'; // backend-facing whatsapp type
  template_name?: string; // backend-facing template name
  ai_generate?: boolean; // route through AI copy generator (runEngagement supports for sms + email)
  ai_prompt?: string;
}

interface DripSchedule {
  timezone: string;
  days: number[];
  start_time: string;
  end_time: string;
}

interface WorkflowNode {
  id: string;
  type: 'trigger' | 'delay' | 'send_sms' | 'send_whatsapp' | 'phone_call' | 'wait_for_reply' | 'drip' | 'engage';
  delay_seconds?: number;
  message?: string;
  instructions?: string;
  timeout_seconds?: number;
  batch_size?: number;
  interval_seconds?: number;
  schedule?: DripSchedule;
  // Engage node specific
  channels?: EngageChannel[];
}

const IANA_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Phoenix', 'America/Toronto',
  'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'America/Buenos_Aires',
  'America/Bogota', 'America/Lima', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich',
  'Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Warsaw', 'Europe/Prague',
  'Europe/Vienna', 'Europe/Athens', 'Europe/Bucharest', 'Europe/Istanbul', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Asia/Taipei', 'Asia/Jakarta', 'Asia/Manila', 'Australia/Sydney', 'Australia/Melbourne',
  'Australia/Perth', 'Australia/Brisbane', 'Pacific/Auckland', 'Pacific/Fiji',
];

function getUtcOffset(tz: string): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = fmt.formatToParts(now);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value?.replace('GMT', 'UTC') || '';
  } catch { return ''; }
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0]; // ISO Mon=1..Sun=0

// Canonical days for runEngagement quiet-hours parser (Mon=1..Sun=7).
// Differs from DAY_VALUES (drip schedule uses Sun=0).
const CADENCE_DAY_VALUES = [1, 2, 3, 4, 5, 6, 7];

interface QuietHoursConfig {
  start: string;
  end: string;
  tz: string;
  days: number[];
}

interface VoicemailConfig {
  mode: 'static' | 'dynamic';
  message: string;
}

const DEFAULT_QUIET_HOURS_OVERRIDE: QuietHoursConfig = {
  start: '09:00',
  end: '21:00',
  tz: 'Australia/Brisbane',
  days: [1, 2, 3, 4, 5],
};

const TIME_OPTIONS_30MIN: string[] = (() => {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return opts;
})();

function formatTime12(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${String(h).padStart(2, '0')}:${mStr} ${ampm}`;
}

function summariseQuietHours(qh: QuietHoursConfig | null): string {
  if (!qh) return 'no client default set';
  const dayLabels = qh.days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d === 7 ? 6 : d - 1])
    .join(',');
  return `${formatTime12(qh.start)}–${formatTime12(qh.end)} ${qh.tz} ${dayLabels}`;
}

interface EngagementWorkflow {
  id: string;
  client_id: string;
  name: string;
  nodes: WorkflowNode[];
  created_at: string;
  updated_at: string;
}

interface EngagementExecution {
  id: string;
  client_id: string;
  workflow_id: string | null;
  lead_id: string;
  ghl_account_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: string;
  current_node_index: number | null;
  stage_description: string | null;
  stop_reason: string | null;
  trigger_run_id: string | null;
  last_sms_sent_at: string | null;
  waiting_for_reply_since: string | null;
  waiting_for_reply_until: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
  enrollment_source: string | null;
  is_new_lead: boolean | null;
}

function delayToUnits(seconds: number): { value: number; unit: string } {
  if (seconds >= 86400 && seconds % 86400 === 0) return { value: seconds / 86400, unit: 'days' };
  if (seconds >= 3600 && seconds % 3600 === 0) return { value: seconds / 3600, unit: 'hours' };
  if (seconds >= 60 && seconds % 60 === 0) return { value: seconds / 60, unit: 'minutes' };
  return { value: seconds, unit: 'seconds' };
}

function unitsToSeconds(value: number, unit: string): number {
  switch (unit) {
    case 'days': return value * 86400;
    case 'hours': return value * 3600;
    case 'minutes': return value * 60;
    default: return value;
  }
}

function formatDelay(seconds: number): string {
  const { value, unit } = delayToUnits(seconds);
  return `Wait ${value} ${unit}`;
}

const DEFAULT_PHONE_CALL_INSTRUCTIONS = `Keep the conversation natural and human-like. Speak casually as if you're a real person, not a bot. Use filler words occasionally (like "yeah", "I mean", "for sure"). Keep responses short - 1 to 2 sentences max unless they ask for more detail. Mirror the prospect's energy and pace. If they sound busy, get to the point fast. If they're chatty, match that vibe. Never sound scripted or robotic.`;

const DEFAULT_ENGAGE_CHANNELS: EngageChannel[] = [
  { type: 'sms', enabled: true, message: '', delay_seconds: 0 },
  { type: 'whatsapp', enabled: false, message: '', delay_seconds: 3600 },
  { type: 'phone_call', enabled: false, instructions: '', delay_seconds: 1800 },
  // Bug 8 — email channel. runEngagement (trigger/runEngagement.ts:1186) already
  // routes ch.type === 'email' through sendEmailAndStamp; the runtime handles
  // it. This default lets workflow builders enable it from the canvas editor.
  { type: 'email', enabled: false, subject: '', message: '', delay_seconds: 7200 },
];

/**
 * Validate engage nodes before save / activation.
 * Returns the first error message found, or null if all valid.
 */
function validateEngageNodes(nodes: WorkflowNode[]): string | null {
  const engageNodes = nodes.filter(n => n.type === 'engage');
  for (let i = 0; i < engageNodes.length; i++) {
    const node = engageNodes[i];
    const label = `Engage node ${i + 1}`;
    const channels = node.channels || [];
    for (const ch of channels) {
      if (!ch.enabled) continue;
      if (ch.type === 'sms') {
        if (!ch.message || !ch.message.trim()) {
          return `${label} — SMS: message is required`;
        }
      } else if (ch.type === 'whatsapp') {
        const mode = ch.wa_mode;
        if (mode !== 'template' && mode !== 'freeform') {
          return `${label} — WhatsApp: choose Template or Freeform Text`;
        }
        if (mode === 'template') {
          if (!ch.wa_template_name || !ch.wa_template_name.trim()) {
            return `${label} — WhatsApp: template name is required`;
          }
        } else if (mode === 'freeform') {
          if (!ch.message || !ch.message.trim()) {
            return `${label} — WhatsApp: message is required`;
          }
        }
      } else if (ch.type === 'phone_call') {
        if (!ch.voice_setter_id || !ch.voice_setter_id.trim()) {
          return `${label} — Phone call: voice setter is required`;
        }
      } else if (ch.type === 'email') {
        if (!ch.subject || !ch.subject.trim()) {
          return `${label} — Email: subject is required`;
        }
        if (!ch.message || !ch.message.trim()) {
          return `${label} — Email: message is required`;
        }
      }
    }
  }
  return null;
}

const DEFAULT_NODES: WorkflowNode[] = [
  { id: nanoid(), type: 'delay', delay_seconds: 300 },
  { id: nanoid(), type: 'engage', channels: DEFAULT_ENGAGE_CHANNELS.map(c => ({ ...c })) },
];

/* ─── Contact variable fields ─── */
const CONTACT_FIELDS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'business_name', label: 'Business Name' },
];

function ContactVariablePicker({ onInsert, clientId }: { onInsert: (variable: string) => void; clientId?: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [customFields, setCustomFields] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !clientId) return;
    (supabase as any)
      .from('client_custom_fields')
      .select('field_name, sort_order')
      .eq('client_id', clientId)
      .order('sort_order')
      .then(({ data }: any) => {
        if (data) setCustomFields(data.map((d: any) => d.field_name));
      });
  }, [open, clientId]);

  const allFields = [
    ...CONTACT_FIELDS,
    ...customFields.map(f => ({ key: `custom.${f}`, label: f })),
  ];

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setExpanded(false); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="!h-8 !w-8 groove-btn">
          <Code className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
       <PopoverContent className="w-72 p-0 groove-border bg-sidebar" align="end" sideOffset={6}>
        <div
          className="px-3 py-2 text-foreground"
          style={{ fontFamily: "'VT323', monospace", fontSize: '18px', borderBottom: '3px groove hsl(var(--border-groove))' }}
        >
          Insert Variable
        </div>
        <div className="max-h-64 overflow-y-auto p-2" onWheel={e => e.stopPropagation()}>
          <div className="groove-border bg-sidebar overflow-hidden">
            <button
              type="button"
              className="w-full text-left px-2.5 py-2 hover:bg-accent transition-colors flex items-center justify-between"
              onClick={() => setExpanded(!expanded)}
            >
              <span className="flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground" style={fieldStyle}>Contact Fields</span>
              </span>
              {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
            {expanded && (
              <div className="border-t border-border p-1.5 space-y-0.5">
                {allFields.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="w-full text-left px-2 py-1.5 rounded-sm hover:bg-accent transition-colors flex items-center justify-between group"
                    onClick={() => { onInsert(`{{${f.key}}}`); setOpen(false); setExpanded(false); }}
                  >
                    <span className="text-foreground" style={fieldStyle}>{f.label}</span>
                    <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" style={{ ...fieldStyle, fontSize: '10px' }}>Insert</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Test on Lead popup ─── */
function TestOnLeadPanel({ message, clientId }: { message: string; clientId?: string }) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    setLoading(true);
    (supabase as any)
      .from('leads')
      .select('id, first_name, last_name, phone, email, business_name, custom_fields')
      .eq('client_id', clientId)
      .limit(200)
      .then(({ data }: any) => {
        setContacts(data || []);
        setLoading(false);
      });
  }, [open, clientId]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(c =>
      (c.first_name || '').toLowerCase().includes(q) ||
      (c.last_name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    );
  }, [contacts, searchQuery]);

  const resolveMessage = (contact: any) => {
    let resolved = message;
    resolved = resolved.replace(/\{\{first_name\}\}/g, contact.first_name || '');
    resolved = resolved.replace(/\{\{last_name\}\}/g, contact.last_name || '');
    resolved = resolved.replace(/\{\{phone\}\}/g, contact.phone || '');
    resolved = resolved.replace(/\{\{email\}\}/g, contact.email || '');
    resolved = resolved.replace(/\{\{business_name\}\}/g, contact.business_name || '');
    // Custom fields
    resolved = resolved.replace(/\{\{custom\.([^}]+)\}\}/g, (_: string, key: string) => {
      const cf = contact.custom_fields;
      if (cf && typeof cf === 'object') return (cf as any)[key] || '';
      return '';
    });
    return resolved;
  };

  return (
    <>
      <Button
        type="button"
        className="w-full groove-btn gap-2"
        style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
        onClick={() => { setOpen(true); setSelectedContact(null); setSearchQuery(''); }}
      >
        <Search className="w-4 h-4" />
        TEST ON LEAD
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-card groove-border flex flex-col" style={{ width: 520, maxWidth: '90vw', maxHeight: '80vh' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))', paddingTop: '14px', paddingBottom: '14px' }}>
              <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
                Test on Lead
              </h3>
              <button
                className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search contacts..."
                  className="pl-9 field-text"
                />
              </div>

              {/* Contact list */}
              <div className="groove-border max-h-[240px] overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground" style={fieldStyle}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading contacts...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground" style={fieldStyle}>No contacts found</div>
                ) : (
                  filtered.map(c => {
                    const isSelected = selectedContact?.id === c.id;
                    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unnamed';
                    return (
                      <button
                        key={c.id}
                        className={`w-full text-left px-3 py-2.5 flex items-center justify-between transition-colors ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
                        style={{ borderBottom: '1px solid hsl(var(--border))' }}
                        onClick={() => setSelectedContact(c)}
                      >
                        <div className="min-w-0">
                          <div className="text-foreground truncate" style={{ ...fieldStyle, fontWeight: 500 }}>{name}</div>
                          <div className="text-muted-foreground truncate" style={{ ...fieldStyle, fontSize: '11px' }}>{c.phone || c.email || '—'}</div>
                        </div>
                        {isSelected && (
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: 'hsl(var(--primary))' }} />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Test button */}
              <Button
                type="button"
                className="w-full groove-btn-blue gap-2"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
                disabled={!selectedContact}
                onClick={() => {}}
              >
                TEST
              </Button>

              {/* Final message preview */}
              {selectedContact && (
                <div className="space-y-1">
                  <Label className="text-foreground" style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}>Final Message</Label>
                  <div
                    className="groove-border bg-background px-3 py-2.5 text-foreground whitespace-pre-wrap"
                    style={fieldStyle}
                  >
                    {resolveMessage(selectedContact) || <span className="text-muted-foreground italic">Empty message</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Send SMS config with variable picker ─── */
function SendSmsConfig({ node, onChange, clientId }: { node: WorkflowNode; onChange: (updated: WorkflowNode) => void; clientId?: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string) => {
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + variable + el.value.slice(end);
      onChange({ ...node, message: newVal });
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else {
      onChange({ ...node, message: (node.message || '') + variable });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground" style={fieldStyle}>
        Send an SMS message to the lead.
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-1">
          <Label className="field-text text-foreground">Message</Label>
          <ContactVariablePicker onInsert={insertVariable} clientId={clientId} />
        </div>
        <Textarea
          ref={textareaRef}
          value={node.message || ''}
          onChange={e => onChange({ ...node, message: e.target.value })}
          className="field-text min-h-[120px]"
          placeholder="Hey {{first_name}}, just checking in..."
        />
      </div>
      <TestOnLeadPanel message={node.message || ''} clientId={clientId} />
    </div>
  );
}

/* ─── Engage config with multi-channel support ─── */
const CHANNEL_LABELS: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', phone_call: 'Phone Call', email: 'Email' };
const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  sms: <MessageSquare className="w-3.5 h-3.5" />,
  whatsapp: <MessageSquare className="w-3.5 h-3.5" />,
  phone_call: <Phone className="w-3.5 h-3.5" />,
  email: <MessageSquare className="w-3.5 h-3.5" />,
};

function ChannelConnectorLine() {
  return (
    <div className="flex justify-center" style={{ height: 24 }}>
      <div style={{ width: 2, height: '100%', background: 'hsl(var(--muted-foreground))', opacity: 0.4 }} />
    </div>
  );
}

function SortableChannelItem({ channel, idx, channels, updateChannel, toggleChannel, clientId, isAnyDragging, onGripMouseDown }: {
  channel: EngageChannel; idx: number; channels: EngageChannel[];
  updateChannel: (idx: number, updates: Partial<EngageChannel>) => void;
  toggleChannel: (idx: number) => void; clientId?: string; isAnyDragging: boolean; onGripMouseDown: () => void;
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: channel.type });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 0,
  };

  const enabledBefore = channels.slice(0, idx).filter(c => c.enabled);
  const isFirstEnabled = channels.filter(c => c.enabled).findIndex(c => c.type === channel.type) === 0;
  const hasPrevEnabled = channel.enabled && !isFirstEnabled;
  const cardMarginTop = isAnyDragging ? (idx > 0 ? 12 : 0) : hasPrevEnabled ? 0 : idx > 0 ? 12 : 0;

  const headerStyle = { fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.06em' } as const;

  return (
    <div ref={setNodeRef} style={style}>
      {/* Connector line + delay block between enabled channels — hidden during drag */}
      {hasPrevEnabled && !isAnyDragging && (
        <>
          <ChannelConnectorLine />
          <div className="groove-border bg-card">
            <div className="bg-background px-3 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}>DELAY</span>
            </div>
            <div className="px-3 py-3">
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  value={delayToUnits(channel.delay_seconds || 0).value}
                  onChange={e => updateChannel(idx, { delay_seconds: unitsToSeconds(Number(e.target.value) || 0, delayToUnits(channel.delay_seconds || 0).unit) })}
                  className="field-text w-20"
                />
                <Select
                  value={delayToUnits(channel.delay_seconds || 0).unit}
                  onValueChange={u => updateChannel(idx, { delay_seconds: unitsToSeconds(delayToUnits(channel.delay_seconds || 0).value, u) })}
                >
                  <SelectTrigger className="field-text flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                    <SelectItem value="seconds">Seconds</SelectItem>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <ChannelConnectorLine />
        </>
      )}

      {/* Channel node card — same style as canvas nodes */}
      <div className={`${isAnyDragging ? 'border border-border rounded' : 'groove-border'} bg-card transition-colors ${!channel.enabled ? 'opacity-50' : ''}`} style={{ marginTop: cardMarginTop }}>
        {/* Header matching canvas node header */}
        <div className="bg-background px-3 py-2.5 flex items-center gap-2" style={(channel.enabled && !isAnyDragging) ? { borderBottom: '1px solid hsl(var(--border))' } : undefined}>
          <Checkbox
            checked={channel.enabled}
            onCheckedChange={() => toggleChannel(idx)}
          />
          <span className="text-foreground uppercase flex-1" style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.06em' }}>{CHANNEL_LABELS[channel.type]}</span>
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100"
            onMouseDown={onGripMouseDown}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Body */}
        {channel.enabled && !isAnyDragging && (
          <div className="px-3 pb-3" style={{ paddingTop: '8px' }}>
            {channel.type === 'sms' && (
              <ChannelMessageField
                label="Edit SMS Message"
                expandTitle="Edit SMS Message"
                value={channel.message || ''}
                onChange={msg => updateChannel(idx, { message: msg })}
                clientId={clientId}
                placeholder="Hey {{first_name}}, just checking in..."
              />
            )}
            {channel.type === 'whatsapp' && (
              <WhatsAppChannelConfig
                channel={channel}
                updateChannel={(updates) => updateChannel(idx, updates)}
                clientId={clientId}
              />
            )}
            {channel.type === 'phone_call' && (
              <PhoneCallChannelConfig
                channel={channel}
                updateChannel={(updates) => updateChannel(idx, updates)}
                clientId={clientId}
              />
            )}
            {channel.type === 'email' && (
              <div className="space-y-2">
                <Input
                  value={channel.subject || ''}
                  onChange={e => updateChannel(idx, { subject: e.target.value })}
                  placeholder="Subject"
                  className="field-text"
                />
                <ChannelMessageField
                  label="Edit Email Body"
                  expandTitle="Edit Email Body"
                  value={channel.message || ''}
                  onChange={msg => updateChannel(idx, { message: msg })}
                  clientId={clientId}
                  placeholder="Hi {{first_name}}, just following up..."
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── WhatsApp channel config with template/freeform toggle ─── */
function WhatsAppChannelConfig({ channel, updateChannel, clientId }: {
  channel: EngageChannel;
  updateChannel: (updates: Partial<EngageChannel>) => void;
  clientId?: string;
}) {
  const mode = channel.wa_mode;
  const isTemplate = mode === 'template';
  const isFreeform = mode === 'freeform';

  const pixelCheck = <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Mode toggles */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => updateChannel({ wa_mode: 'template', whatsapp_type: 'template' })}
          className={cn(
            'w-full text-left p-3 transition-colors duration-100 groove-border relative bg-card',
            !isTemplate && 'hover:bg-muted/50'
          )}
        >
          {isTemplate && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                border: '1px solid hsl(var(--primary))',
                boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)',
              }}
            />
          )}
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 mt-[1px] bg-card" style={isTemplate ? { backgroundColor: '#fff' } : undefined}>
              {isTemplate && pixelCheck}
            </div>
            <div className="min-w-0">
              <div className={cn('text-foreground', isTemplate && 'text-primary')} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                Use a Template
              </div>
              <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                Send a pre-approved Meta WhatsApp template
              </p>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => updateChannel({ wa_mode: 'freeform', whatsapp_type: 'text', template_name: undefined })}
          className={cn(
            'w-full text-left p-3 transition-colors duration-100 groove-border relative bg-card',
            !isFreeform && 'hover:bg-muted/50'
          )}
        >
          {isFreeform && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                border: '1px solid hsl(var(--primary))',
                boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)',
              }}
            />
          )}
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 mt-[1px] bg-card" style={isFreeform ? { backgroundColor: '#fff' } : undefined}>
              {isFreeform && pixelCheck}
            </div>
            <div className="min-w-0">
              <div className={cn('text-foreground', isFreeform && 'text-primary')} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                Use Freeform Text
              </div>
              <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                Write a custom message (24-hour window rule applies)
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Template mode: number input */}
      {isTemplate && (
        <div className="space-y-2">
          <Label className="field-text text-foreground">Template Name</Label>
          <Input
            type="text"
            value={channel.wa_template_name || ''}
            onChange={e => {
              const val = e.target.value;
              updateChannel({ wa_template_name: val || undefined, template_name: val || undefined });
            }}
            placeholder="e.g. hello_world"
            className="groove-border bg-card h-8"
            style={fieldStyle}
          />
          {!channel.wa_template_name && (
            <p className="text-destructive" style={{ ...fieldStyle, fontSize: '13px' }}>
              A template name must be provided for the WhatsApp message to fire.
            </p>
          )}
          <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>
            This is the name of your approved WhatsApp template in GoHighLevel → Settings → WhatsApp Templates.
          </p>
        </div>
      )}

      {/* Freeform mode: message field */}
      {isFreeform && (
        <ChannelMessageField
          label="Edit WhatsApp Message"
          expandTitle="Edit WhatsApp Message"
          value={channel.message || ''}
          onChange={msg => updateChannel({ message: msg })}
          clientId={clientId}
          placeholder="Hey {{first_name}}, sent you a WhatsApp..."
        />
      )}
    </div>
  );
}

function PhoneCallChannelConfig({ channel, updateChannel, clientId }: {
  channel: EngageChannel;
  updateChannel: (updates: Partial<EngageChannel>) => void;
  clientId?: string;
}) {
  // UUID-native picker: prefer the voice_setters model and store the row UUID.
  // Falls back to legacy "Voice-Setter-N" slots for clients not yet backfilled.
  // Existing nodes may hold either an id or a legacy slot string — both resolve at
  // call time (make-retell-outbound-call dual-accepts), so we never rewrite stored
  // values here; Brendan re-selects to migrate the live cadence.
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [setterOpen, setSetterOpen] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: vs } = await (supabase as any)
        .from('voice_setters')
        .select('id, name, is_active')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('name');
      if (vs && vs.length > 0) {
        setOptions(vs.map((d: any) => ({ id: d.id, name: d.name || d.id })));
        return;
      }
      const { data: legacy } = await (supabase as any)
        .from('agent_settings')
        .select('slot_id, name')
        .eq('client_id', clientId)
        .like('slot_id', 'Voice-Setter-%');
      if (legacy) setOptions(legacy.map((d: any) => ({ id: d.slot_id, name: d.name || d.slot_id })));
    })();
  }, [clientId]);

  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1">
        <Label className="field-text text-foreground">Voice Setter</Label>
        <Popover open={setterOpen} onOpenChange={setSetterOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative flex h-8 w-full items-center groove-border bg-card px-3 pr-10 py-1 text-left"
              style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", textTransform: 'uppercase', letterSpacing: 'normal' }}
            >
              <span className="truncate text-foreground flex-1">
                {channel.voice_setter_id
                  ? (options.find(o => o.id === channel.voice_setter_id)?.name || channel.voice_setter_id)
                  : <span className="text-muted-foreground">Select voice setter</span>}
              </span>
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
            className="w-[var(--radix-popover-trigger-width)] p-0 groove-border bg-sidebar"
            align="start"
            sideOffset={4}
          >
            <div className="p-1">
              {options.length === 0 ? (
                <div className="px-3 py-4 text-center text-muted-foreground" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
                  No voice setters configured.
                </div>
              ) : (
                <>
                  <div className="pt-1.5 pb-1.5 border-b border-border/50 mb-1 px-3 -mx-1 w-[calc(100%+0.5rem)]">
                    <span className="text-muted-foreground uppercase" style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 'normal' }}>Voice Setters</span>
                  </div>
                  {options.map(o => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => { updateChannel({ voice_setter_id: o.id }); setSetterOpen(false); }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors",
                        channel.voice_setter_id === o.id
                          ? "bg-accent/50 text-foreground"
                          : "hover:bg-muted/50 text-foreground"
                      )}
                      style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 'normal' }}
                    >
                      <span className="w-4 shrink-0 flex items-center justify-center">
                        {channel.voice_setter_id === o.id ? <Check className="w-3.5 h-3.5 text-foreground" /> : ''}
                      </span>
                      <span>{o.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {!channel.voice_setter_id && (
          <p className="text-destructive" style={{ ...fieldStyle, fontSize: '13px' }}>
            A voice setter must be selected for the call to fire.
          </p>
        )}
      </div>

      <div>
        <ChannelMessageField
          label="Edit Custom Call Instructions"
          expandTitle="Edit Custom Call Instructions"
          value={channel.instructions || ''}
          onChange={v => updateChannel({ instructions: v })}
          clientId={clientId}
          placeholder={DEFAULT_PHONE_CALL_INSTRUCTIONS}
        />
      </div>

      <div className="flex items-start gap-2 pt-1">
        <Checkbox
          checked={channel.treat_pickup_as_reply ?? false}
          onCheckedChange={(checked) => updateChannel({ treat_pickup_as_reply: !!checked })}
          className="mt-0.5"
        />
        <div>
          <Label className="field-text text-foreground cursor-pointer">Treat human pickup as a reply</Label>
          <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>
            If enabled, when the prospect answers the phone (not voicemail), the engagement sequence ends — same as an SMS reply.
          </p>
        </div>
      </div>
    </div>
  );
}

function TextSetterSelector({
  value,
  onChange,
  setterSlots,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  setterSlots: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    const uniqueNumbers = Array.from(new Set(
      setterSlots
        .map((slot) => parseInt(slot.replace(/\D/g, '')) || 1)
        .filter((num) => Number.isInteger(num) && num > 0)
    ));

    return uniqueNumbers.map((num) => ({
      value: String(num),
      label: `Setter ${num}`,
    }));
  }, [setterSlots]);

  const selectedOption = options.find((option) => option.value === String(value));
  const selectedLabel = selectedOption?.label || `Setter ${value}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={cn(
            "relative flex h-8 w-full items-center groove-border bg-card px-3 pr-10 py-1 text-left",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          style={{ ...fieldStyle, textTransform: 'uppercase' }}
        >
          <span className="truncate text-foreground flex-1">
            {selectedLabel || <span className="text-muted-foreground">Select Setter...</span>}
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
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
        className="w-[var(--radix-popover-trigger-width)] p-0 groove-border bg-sidebar"
        align="start"
        sideOffset={4}
      >
        <div className="max-h-[260px] overflow-y-auto">
          <div className="p-1">
            {options.length === 0 && (
              <div className="py-4 text-center text-muted-foreground" style={fieldStyle}>
                No active setters found.
              </div>
            )}
            {options.map((option) => (
              <button
                key={option.value}
                className={cn(
                  "flex items-center w-full gap-2 rounded-sm px-3 py-1.5 cursor-pointer",
                  "hover:bg-accent hover:text-accent-foreground",
                  String(value) === option.value && "bg-accent text-accent-foreground"
                )}
                style={{ ...fieldStyle, textTransform: 'capitalize' }}
                onClick={() => {
                  onChange(Number(option.value));
                  setOpen(false);
                }}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", String(value) === option.value ? "opacity-100" : "opacity-0")} />
                <span className="truncate flex-1 text-left">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EngageConfig({ node, onChange, clientId, textSetterNumber, onTextSetterChange, setterSlots, engagementIndex }: { node: WorkflowNode; onChange: (updated: WorkflowNode) => void; clientId?: string; textSetterNumber: number; onTextSetterChange: (n: number) => void; setterSlots: string[]; engagementIndex?: number }) {
  const channels = node.channels || DEFAULT_ENGAGE_CHANNELS.map(c => ({ ...c }));

  const updateChannel = (idx: number, updates: Partial<EngageChannel>) => {
    const newChannels = channels.map((c, i) => i === idx ? { ...c, ...updates } : c);
    onChange({ ...node, channels: newChannels });
  };

  const toggleChannel = (idx: number) => {
    updateChannel(idx, { enabled: !channels[idx].enabled });
  };

  const enabledChannels = channels.filter(c => c.enabled);
  const [isDragging, setIsDragging] = useState(false);

  // Reset collapse if user clicks grip but doesn't actually drag
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseUp = () => {
      // Small delay to let DndContext onDragStart fire first
      setTimeout(() => setIsDragging(prev => prev ? false : prev), 200);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setIsDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = channels.findIndex(c => c.type === active.id);
    const newIdx = channels.findIndex(c => c.type === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(channels, oldIdx, newIdx);
    onChange({ ...node, channels: reordered });
  };

  const hasTextChannel = channels.some(c => (c.type === 'sms' || c.type === 'whatsapp') && c.enabled);
  const showTextSetter = engagementIndex == null || engagementIndex === 0;

  return (
    <div className="space-y-4">
      {showTextSetter && (
        <>
          <div className={`${!hasTextChannel ? 'opacity-40 pointer-events-none' : ''}`}>
            <Label className="field-text">Text Setter</Label>
            <p className="text-[11px] text-muted-foreground field-text mt-1">
              Handles SMS and WhatsApp replies for this campaign. Voice setter is configured per phone call node.
            </p>
            <p className="text-[11px] text-muted-foreground field-text mt-0.5">
              Set it once here — it applies to all engagement steps automatically.
            </p>
            <div className="mt-2">
              <TextSetterSelector
                value={textSetterNumber}
                onChange={onTextSetterChange}
                setterSlots={setterSlots}
                disabled={!hasTextChannel}
              />
            </div>
          </div>

          <div className="border-t border-dashed border-border -mx-4 w-[calc(100%+2rem)]" />
        </>
      )}

      <p className="text-muted-foreground" style={fieldStyle}>
        Configure multi-channel outreach. Drag to reorder, toggle to enable.
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setIsDragging(true)} onDragEnd={handleDragEnd} onDragCancel={() => setIsDragging(false)}>
        <SortableContext items={channels.map(c => c.type)} strategy={verticalListSortingStrategy}>
          <div>
            {channels.map((channel, idx) => (
              <SortableChannelItem
                key={channel.type}
                channel={channel}
                idx={idx}
                channels={channels}
                updateChannel={updateChannel}
                toggleChannel={toggleChannel}
                clientId={clientId}
                isAnyDragging={isDragging}
                onGripMouseDown={() => setIsDragging(true)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {enabledChannels.length === 0 && (
        <p className="text-destructive" style={fieldStyle}>
          Enable at least one channel.
        </p>
      )}
    </div>
  );
}

function ChannelMessageField({ label, expandTitle, value, onChange, clientId, placeholder }: {
  label: string; expandTitle?: string; value: string; onChange: (v: string) => void; clientId?: string; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const expandedRef = useRef<HTMLTextAreaElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedValue, setExpandedValue] = useState('');
  const insertVariable = (variable: string) => {
    const el = ref.current;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + variable + el.value.slice(end);
      onChange(newVal);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + variable.length, start + variable.length); }, 0);
    } else {
      onChange(value + variable);
    }
  };
  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-1">
          <Label className="field-text text-foreground">{label}</Label>
          <ContactVariablePicker onInsert={insertVariable} clientId={clientId} />
        </div>
        <div className="relative">
          <Textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="field-text min-h-[120px]"
            placeholder={placeholder}
          />
          <Button
            type="button"
            variant="default"
            size="icon"
            onClick={() => { setExpandedValue(value); setIsExpanded(true); }}
            className="absolute bottom-2 right-2 h-8 w-8"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent className="max-w-3xl !p-0 flex flex-col" style={{ height: '80vh', maxHeight: '80vh' }}>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              {(expandTitle || label).toUpperCase()}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-6" style={{ paddingTop: 24 }}>
            <div className="relative h-full">
              <Textarea
                ref={expandedRef}
                value={expandedValue}
                onChange={e => setExpandedValue(e.target.value)}
                placeholder={placeholder}
                className="h-full w-full leading-relaxed !resize-none field-text"
                style={{ height: '100%' }}
              />
              <div className="absolute top-2 right-2">
                <ContactVariablePicker
                  onInsert={(variable) => {
                    const el = expandedRef.current;
                    if (el) {
                      const start = el.selectionStart ?? el.value.length;
                      const end = el.selectionEnd ?? el.value.length;
                      const newVal = el.value.slice(0, start) + variable + el.value.slice(end);
                      setExpandedValue(newVal);
                      setTimeout(() => { el.focus(); el.setSelectionRange(start + variable.length, start + variable.length); }, 0);
                    } else {
                      setExpandedValue(expandedValue + variable);
                    }
                  }}
                  clientId={clientId}
                />
              </div>
            </div>
          </div>
          <div className="px-6 pb-6" style={{ paddingTop: 8 }}>
            <Button
              onClick={() => { onChange(expandedValue); setIsExpanded(false); }}
              className="w-full h-10"
              style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
            >
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─── Right-side config panel for editing selected node ─── */

function EngagementNodeConfig({
  node,
  onChange,
  onClose,
  waitNodeIndex,
  clientId,
  onDeleteDrip,
  onDeleteEngagement,
  engagementIndex,
  engagementCount,
  enrollWebhookToken,
  selectedNodeId,
  textSetterNumber,
  onTextSetterChange,
  setterSlots,
  workflowQuietHoursOverrideEnabled,
}: {
  node: WorkflowNode;
  onChange: (updated: WorkflowNode) => void;
  onClose: () => void;
  waitNodeIndex?: number;
  clientId?: string;
  onDeleteDrip?: () => void;
  onDeleteEngagement?: () => void;
  engagementIndex?: number;
  engagementCount?: number;
  enrollWebhookToken?: string | null;
  selectedNodeId?: string | null;
  textSetterNumber: number;
  onTextSetterChange: (n: number) => void;
  setterSlots: string[];
  workflowQuietHoursOverrideEnabled?: boolean;
}) {
  const [showDeleteDrip, setShowDeleteDrip] = useState(false);
  const [showDeleteEngagement, setShowDeleteEngagement] = useState(false);
  const [startTimeOpen, setStartTimeOpen] = useState(false);
  const [endTimeOpen, setEndTimeOpen] = useState(false);
  const titles: Record<string, string> = {
    trigger: 'Trigger',
    delay: 'Delay',
    send_sms: 'Send SMS',
    engage: 'Engagement',
    wait_for_reply: 'Wait for Reply',
    drip: 'Drip',
  };

  const [triggerTab, setTriggerTab] = useState<'manual' | 'webhook'>('manual');

  if (node.type === 'trigger') {
    const isWebhookNode = selectedNodeId === 'eng-webhook-trigger';
    const isFindLeadNode = selectedNodeId === 'eng-find-lead';
    const isLeadExistsNode = selectedNodeId === 'eng-lead-exists';
    const isCreateLeadNode = selectedNodeId === 'eng-create-lead';
    const isExistingLeadNode = selectedNodeId === 'eng-existing-lead';
    const isVisualOnlyNode = isFindLeadNode || isLeadExistsNode || isCreateLeadNode || isExistingLeadNode;

    const webhookUrl = enrollWebhookToken
      ? `${edgeFunctionUrl('campaign-enroll-webhook')}?token=${enrollWebhookToken}`
      : '';

    const copyWebhookUrl = () => {
      if (!webhookUrl) return;
      navigator.clipboard.writeText(webhookUrl);
      toast.success('Webhook URL copied');
    };

    const title = isWebhookNode ? 'GoHighLevel Webhook Trigger'
      : isFindLeadNode ? 'Find Lead'
      : isLeadExistsNode ? 'Condition'
      : isCreateLeadNode ? 'New Lead'
      : isExistingLeadNode ? 'Existing Lead'
      : 'Manual Entry';

    const renderBody = () => {
      if (isWebhookNode) {
        const copyParam = (val: string) => {
          navigator.clipboard.writeText(val);
          toast.success('Copied to clipboard');
        };
        const paramFields = ['Lead_ID', 'Name', 'Email', 'Phone'];
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="field-text text-foreground">GoHighLevel Webhook URL</Label>
              <p className="text-muted-foreground" style={fieldStyle}>
                Paste this URL into your GoHighLevel workflow as a webhook action. The lead will be automatically found or created, then enrolled into this engagement campaign.
              </p>
              <div className="pt-1 flex items-center gap-2">
                <Input value={webhookUrl} readOnly className="field-text text-xs flex-1" />
                <button className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50" onClick={copyWebhookUrl}>
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
      if (isFindLeadNode) {
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Before the drip starts, the system searches for an existing lead using the Lead ID from the enrollment data.
            </p>
          </div>
        );
      }
      if (isLeadExistsNode) {
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Checks whether the lead was found in the CRM database.
            </p>
            <div className="border-t border-dashed border-border pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-none bg-success" />
                <span className="text-success" style={fieldStyle}>Lead Exists</span>
                <span className="text-muted-foreground" style={fieldStyle}>→ proceed to drip</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-none bg-destructive" />
                <span className="text-destructive" style={fieldStyle}>Lead Doesn't Exist</span>
                <span className="text-muted-foreground" style={fieldStyle}>→ create lead first</span>
              </div>
            </div>
          </div>
        );
      }
      if (isCreateLeadNode) {
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              The lead was not found in the CRM. A new lead record will be automatically created using the name, phone, and email from the enrollment payload.
            </p>
          </div>
        );
      }
      if (isExistingLeadNode) {
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              The lead was found in the CRM database. This existing lead record will be used and processed through the engagement sequence.
            </p>
          </div>
        );
      }
      // Manual entry (default)
      return (
        <div className="space-y-4">
          <p className="text-muted-foreground" style={fieldStyle}>
            In order for a prospect to enter this engagement, you need to manually select leads from the Leads page and enroll them into this campaign.
          </p>
          <p className="text-muted-foreground" style={fieldStyle}>
            Once enrolled, the workflow will be automatically executed for each selected lead.
          </p>
        </div>
      );
    };

    return (
      <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
        <div
          className="px-4 shrink-0 flex items-center justify-between"
          style={{ height: 52, borderBottom: '1px solid hsl(var(--border))' }}
        >
          <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
            {title}
          </h3>
          <button
            className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {renderBody()}
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (node.type) {
      case 'delay': {
        const { value, unit } = delayToUnits(node.delay_seconds || 300);
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="field-text text-foreground">Wait Duration</Label>
              <p className="text-muted-foreground" style={fieldStyle}>
                Pause the engagement sequence before the next step.
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={value}
                  onChange={e => onChange({ ...node, delay_seconds: unitsToSeconds(Number(e.target.value) || 1, unit) })}
                  className="field-text w-20"
                />
                <Select value={unit} onValueChange={u => onChange({ ...node, delay_seconds: unitsToSeconds(value, u) })}>
                  <SelectTrigger className="field-text flex-1">
                    <SelectValue />
                  </SelectTrigger>
                   <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                     <SelectItem value="seconds">Seconds</SelectItem>
                     <SelectItem value="minutes">Minutes</SelectItem>
                     <SelectItem value="hours">Hours</SelectItem>
                     <SelectItem value="days">Days</SelectItem>
                   </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      }
      case 'send_sms':
        return <SendSmsConfig node={node} onChange={onChange} clientId={clientId} />;
      case 'engage':
        return <EngageConfig node={node} onChange={onChange} clientId={clientId} textSetterNumber={textSetterNumber} onTextSetterChange={onTextSetterChange} setterSlots={setterSlots} engagementIndex={engagementIndex} />;
      case 'wait_for_reply': {
        const { value, unit } = delayToUnits(node.timeout_seconds || 86400);
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="field-text text-foreground">Timeout Duration</Label>
              <p className="text-muted-foreground" style={fieldStyle}>
                Wait for the lead to reply. If they don't reply within the timeout, the sequence continues to the next step.
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={value}
                  onChange={e => onChange({ ...node, timeout_seconds: unitsToSeconds(Number(e.target.value) || 1, unit) })}
                  className="field-text w-20"
                />
                <Select value={unit} onValueChange={u => onChange({ ...node, timeout_seconds: unitsToSeconds(value, u) })}>
                  <SelectTrigger className="field-text flex-1">
                    <SelectValue />
                  </SelectTrigger>
                   <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                     <SelectItem value="seconds">Seconds</SelectItem>
                     <SelectItem value="minutes">Minutes</SelectItem>
                     <SelectItem value="hours">Hours</SelectItem>
                     <SelectItem value="days">Days</SelectItem>
                   </SelectContent>
                </Select>
              </div>
            </div>
            <div className="border-t border-dashed border-border pt-3 mt-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-none bg-success" />
                <span className="text-success" style={fieldStyle}>Lead Replied</span>
                <span className="text-muted-foreground" style={fieldStyle}>→ end sequence</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-none bg-destructive" />
                <span className="text-destructive" style={fieldStyle}>No Reply</span>
                <span className="text-muted-foreground" style={fieldStyle}>→ Follow-Up #{waitNodeIndex || 1}</span>
              </div>
            </div>
          </div>
        );
      }
      case 'drip': {
        const dripInterval = node.interval_seconds || 3600;
        const { value: dripVal, unit: dripUnit } = delayToUnits(dripInterval);
        const hasSchedule = !!node.schedule;
        const schedule = node.schedule || { timezone: 'America/New_York', days: [1,2,3,4,5], start_time: '09:00', end_time: '17:00' };
        const toggleDay = (d: number) => {
          const cur = schedule.days || [];
          const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d];
          onChange({ ...node, schedule: { ...schedule, days: next } });
        };
        const timeOptions = (() => {
          const opts: string[] = [];
          for (let h = 0; h < 24; h++) {
            for (let m = 0; m < 60; m += 30) {
              opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            }
          }
          return opts;
        })();
        const formatTime12 = (t: string) => {
          const [hStr, mStr] = t.split(':');
          let h = parseInt(hStr, 10);
          const ampm = h >= 12 ? 'PM' : 'AM';
          if (h === 0) h = 12; else if (h > 12) h -= 12;
          return `${String(h).padStart(2, '0')}:${mStr} ${ampm}`;
        };
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground" style={fieldStyle}>
              Controls how leads are released from the campaign queue into the workflow.
            </p>

            {/* Batch size */}
            <div className="space-y-1">
              <Label className="field-text text-foreground">Leads per batch</Label>
              <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>
                How many leads to release at once each time the drip fires.
              </p>
              <Input
                type="number"
                min={1}
                value={node.batch_size || 100}
                onChange={e => onChange({ ...node, batch_size: Math.max(1, Number(e.target.value) || 1) })}
                className="field-text w-32"
              />
            </div>

            {/* Release interval */}
            <div className="space-y-1">
              <Label className="field-text text-foreground">How often to release a batch</Label>
              <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>
                Time between each batch release. E.g. "every 1 hour" means a new batch is sent out each hour.
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={dripVal}
                  onChange={e => onChange({ ...node, interval_seconds: unitsToSeconds(Number(e.target.value) || 1, dripUnit) })}
                  className="field-text w-20"
                />
                <Select value={dripUnit} onValueChange={u => onChange({ ...node, interval_seconds: unitsToSeconds(dripVal, u) })}>
                  <SelectTrigger className="field-text flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Example */}
            <div className="rounded border border-border bg-muted/40 p-3" style={fieldStyle}>
              <p className="text-muted-foreground" style={{ fontSize: '13px' }}>
                <strong className="text-foreground">Example:</strong> {node.batch_size || 100} leads every {dripVal} {dripUnit} means the system will send out {node.batch_size || 100} leads, wait {dripVal} {dripUnit}, then send the next {node.batch_size || 100}, and so on until the campaign is done.
              </p>
            </div>

            {/* Schedule section */}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="field-text text-foreground">Restrict to working hours</Label>
                <Switch
                  checked={hasSchedule && !workflowQuietHoursOverrideEnabled}
                  disabled={workflowQuietHoursOverrideEnabled}
                  onCheckedChange={checked => {
                    if (checked) {
                      onChange({ ...node, schedule: { timezone: 'America/New_York', days: [1,2,3,4,5], start_time: '09:00', end_time: '17:00' } });
                    } else {
                      const { schedule: _, ...rest } = node;
                      onChange(rest as WorkflowNode);
                    }
                  }}
                />
              </div>
              {workflowQuietHoursOverrideEnabled ? (
                <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>
                  Workflow-level quiet hours are active. The drip will use the workflow override; this switch is disabled.
                </p>
              ) : (
                <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>
                  When on, batches only go out during the days and hours you choose. Leads queued outside this window will wait until the next active period.
                </p>
              )}

              {hasSchedule && (
                <div className="space-y-3 pt-1">
                  {/* Active Days */}
                  <div className="space-y-1">
                    <Label className="field-text text-foreground">Active Days</Label>
                    <div className="flex gap-1 flex-wrap">
                      {DAY_LABELS.map((label, i) => {
                        const dayVal = DAY_VALUES[i];
                        const active = schedule.days.includes(dayVal);
                        return (
                          <button
                            key={label}
                            type="button"
                            className={cn(
                              'px-2.5 py-1 rounded border transition-colors',
                              active
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                            )}
                            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                            onClick={() => toggleDay(dayVal)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Time Window */}
                  <div className="space-y-1">
                    <Label className="field-text text-foreground">Time Window</Label>
                    <div className="flex items-center gap-2">
                      <Popover open={startTimeOpen} onOpenChange={setStartTimeOpen}>
                        <PopoverTrigger asChild>
                          <button
                            className="flex items-center gap-2 rounded border border-border bg-background px-3 py-1.5 text-foreground hover:border-primary/50 transition-colors"
                            style={fieldStyle}
                          >
                            <span>{formatTime12(schedule.start_time)}</span>
                            <Clock className="h-4 w-4 text-muted-foreground mr-0.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-0 bg-sidebar border border-border" style={{ borderStyle: 'solid', boxShadow: 'none' }} align="start">
                          <div className="max-h-56 overflow-y-auto">
                            {timeOptions.map(t => (
                              <button
                                key={t}
                                type="button"
                                className={cn(
                                  'w-full text-left px-3 py-1.5 transition-colors',
                                  t === schedule.start_time ? 'bg-accent/50 text-foreground' : 'hover:bg-accent/50 text-foreground'
                                )}
                                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                onClick={() => { onChange({ ...node, schedule: { ...schedule, start_time: t } }); setStartTimeOpen(false); }}
                              >
                                {formatTime12(t)}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <span className="text-muted-foreground" style={fieldStyle}>to</span>
                      <Popover open={endTimeOpen} onOpenChange={setEndTimeOpen}>
                        <PopoverTrigger asChild>
                          <button
                            className="flex items-center gap-2 rounded border border-border bg-background px-3 py-1.5 text-foreground hover:border-primary/50 transition-colors"
                            style={fieldStyle}
                          >
                            <span>{formatTime12(schedule.end_time)}</span>
                            <Clock className="h-4 w-4 text-muted-foreground mr-0.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-0 bg-sidebar border border-border" style={{ borderStyle: 'solid', boxShadow: 'none' }} align="start">
                          <div className="max-h-56 overflow-y-auto">
                            {timeOptions.map(t => (
                              <button
                                key={t}
                                type="button"
                                className={cn(
                                  'w-full text-left px-3 py-1.5 transition-colors',
                                  t === schedule.end_time ? 'bg-accent/50 text-foreground' : 'hover:bg-accent/50 text-foreground'
                                )}
                                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                onClick={() => { onChange({ ...node, schedule: { ...schedule, end_time: t } }); setEndTimeOpen(false); }}
                              >
                                {formatTime12(t)}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  {/* Timezone */}
                  <div className="space-y-1">
                    <Label className="field-text text-foreground">Timezone</Label>
                    <Select value={schedule.timezone} onValueChange={tz => onChange({ ...node, schedule: { ...schedule, timezone: tz } })}>
                      <SelectTrigger className="field-text">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-sidebar border border-border max-h-60" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                        {IANA_TIMEZONES.map(tz => (
                          <SelectItem key={tz} value={tz}>
                            {tz} ({getUtcOffset(tz)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="pb-[60px]" />
                </div>
              )}
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '1px solid hsl(var(--border))' }}
      >
        <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
          {node.type === 'wait_for_reply' && waitNodeIndex ? `Follow-Up Delay #${waitNodeIndex}` : (titles[node.type] || 'Config')}
        </h3>
        <div className="flex items-center gap-1">
          {node.type === 'drip' && onDeleteDrip && (
            <button
              className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
              onClick={() => setShowDeleteDrip(true)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {node.type === 'engage' && onDeleteEngagement && engagementIndex != null && engagementIndex > 0 && (
            <button
              className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
              onClick={() => setShowDeleteEngagement(true)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {renderContent()}
      </div>
      {node.type === 'drip' && onDeleteDrip && (
        <DeleteConfirmDialog
          open={showDeleteDrip}
          onOpenChange={setShowDeleteDrip}
          onConfirm={() => { setShowDeleteDrip(false); onDeleteDrip(); }}
          title="Delete Drip Node"
          itemName="Drip"
          description="This will remove the drip batching from your engagement workflow. Leads will no longer be staggered into batches."
        />
      )}
      {node.type === 'engage' && onDeleteEngagement && engagementIndex != null && engagementIndex > 0 && (
        <DeleteConfirmDialog
          open={showDeleteEngagement}
          onOpenChange={setShowDeleteEngagement}
          onConfirm={() => { setShowDeleteEngagement(false); onDeleteEngagement(); }}
          title={`Delete Engagement #${(engagementIndex || 0) + 1}`}
          itemName={`Engagement #${(engagementIndex || 0) + 1}`}
          description={engagementIndex != null && engagementCount != null && engagementIndex < engagementCount - 1
            ? `This will also remove all engagement steps after #${engagementIndex + 1} and their follow-up delays.`
            : `This will remove Engagement #${(engagementIndex || 0) + 1} and its follow-up delay from the workflow.`}
        />
      )}
    </div>
  );
}

/* ─── Execution detail panel ─── */

function EngagementExecutionDetail({
  execution,
  nodes,
  onClose,
  onReload,
  onStop,
  stopping,
  onPushNow,
  pushingNow,
  onPause,
  pausing,
  onResume,
  resuming,
}: {
  execution: EngagementExecution;
  nodes: WorkflowNode[];
  onClose: () => void;
  onReload: () => Promise<void> | void;
  onStop: () => void;
  stopping: boolean;
  onPushNow: () => void;
  pushingNow: boolean;
  onPause: () => void;
  pausing: boolean;
  onResume: () => void;
  resuming: boolean;
}) {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { cb } = useCreatorMode();
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);

  const statusVariant = (status: string): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'completed':
      case 'replied':
        return 'positive';
      case 'running': case 'pending': case 'paused': return 'warning';
      case 'failed': case 'stopped': case 'cancelled': return 'negative';
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

  // Countdown timer for waiting_for_reply_until
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

  const [countdown, setCountdown] = useState('');

  // Auto-refresh when running
  useEffect(() => {
    if (!isActiveExecution(execution.status)) return;
    const interval = setInterval(() => { onReload(); }, 5000);
    return () => clearInterval(interval);
  }, [execution.status, onReload]);

  // Build synthetic steps from workflow nodes and execution state
  // current_node_index maps to top-level workflow nodes, so we resolve the active
  // flat engage sub-step from that node plus stage hints from the backend.
  const isStopped = isStoppedExecution(execution);
  const isCompleted = isCompletedExecution(execution.status);
  const isFailed = isFailedExecution(execution.status);
  const isActive = isActiveExecution(execution.status);

  const flatSteps = useMemo(() => expandNodesToFlat(nodes), [nodes]);
  const effectiveFlatIdx = useMemo(
    () => resolveExecutionFlatIndex(execution, flatSteps),
    [execution, flatSteps],
  );

  // Delay countdown — compute deadline from updated_at + delay_seconds of current flat step
  const [delayCountdown, setDelayCountdown] = useState('');
  const currentFlatStep = isActive && effectiveFlatIdx >= 0 && effectiveFlatIdx < flatSteps.length
    ? flatSteps[effectiveFlatIdx]
    : null;
  const waitReplyUntil = currentFlatStep?.type === 'wait_for_reply' ? execution.waiting_for_reply_until : null;
  const isWaiting = isActive && !!waitReplyUntil;
  const isDelayStep = currentFlatStep?.type === 'delay' || currentFlatStep?.type === 'engage_delay';
  const delayDeadline = currentFlatStep && isDelayStep && execution.updated_at
    ? new Date(execution.updated_at).getTime() + (currentFlatStep.delay_seconds || 0) * 1000
    : null;

  useEffect(() => {
    if (!waitReplyUntil) { setCountdown(''); return; }
    const update = () => {
      const diff = new Date(waitReplyUntil).getTime() - Date.now();
      setCountdown(formatCountdown(diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [waitReplyUntil]);

  useEffect(() => {
    if (!delayDeadline) { setDelayCountdown(''); return; }
    const update = () => {
      const diff = delayDeadline - Date.now();
      setDelayCountdown(formatCountdown(diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [delayDeadline]);

  const buildSteps = () => {
    const steps: { id: string; label: string; nodeType: string; status: string; detail: string; timestamp: string | null; groupLabel?: string }[] = [];

    const enrollmentSource = (execution as any).enrollment_source || 'manual';
    const isNewLead = (execution as any).is_new_lead === true;
    const triggerLabel = enrollmentSource === 'webhook' ? 'Webhook' : 'Manual Entry';

    // Step 1: Trigger
    steps.push({
      id: 'step-trigger',
      label: triggerLabel,
      nodeType: 'trigger',
      status: execution.started_at ? 'completed' : 'pending',
      detail: execution.contact_name || 'Unknown',
      timestamp: execution.started_at,
    });

    // Step 2: Find Lead
    steps.push({
      id: 'step-find-lead',
      label: 'Find Lead',
      nodeType: 'find',
      status: execution.started_at ? 'completed' : 'pending',
      detail: 'Search by phone or email',
      timestamp: null,
    });

    // Step 3: Lead Exists?
    steps.push({
      id: 'step-lead-exists',
      label: 'Lead Exists?',
      nodeType: 'condition',
      status: execution.started_at ? 'completed' : 'pending',
      detail: isNewLead ? "Lead Doesn't Exist" : 'Lead Exists',
      timestamp: null,
    });

    // Step 4: Create Lead (only if new lead)
    if (isNewLead) {
      steps.push({
        id: 'step-create-lead',
        label: 'Create Lead',
        nodeType: 'create_contact',
        status: execution.started_at ? 'completed' : 'pending',
        detail: 'New lead created from enrollment data',
        timestamp: null,
      });
    }

    let engageCount = 0;
    let waitCount = 0;
    // Track which engage nodes we've seen to number them
    const seenEngageIds = new Set<string>();

    for (let fi = 0; fi < flatSteps.length; fi++) {
      const flat = flatSteps[fi];

      let stepStatus = 'pending';
      let detail = '—';
      let timestamp: string | null = null;

      if (isStopped) {
        if (fi < effectiveFlatIdx) stepStatus = 'completed';
        else if (fi === effectiveFlatIdx) { stepStatus = 'completed'; detail = execution.stop_reason || 'Stopped'; }
        else { stepStatus = 'skipped'; detail = 'Skipped — engagement stopped'; }
      } else if (isFailed) {
        if (fi < effectiveFlatIdx) stepStatus = 'completed';
        else if (fi === effectiveFlatIdx) { stepStatus = 'failed'; detail = execution.stage_description || 'Failed'; }
        else stepStatus = 'skipped';
      } else if (isCompleted) {
        stepStatus = 'completed';
      } else {
        // Running
        if (fi < effectiveFlatIdx) stepStatus = 'completed';
        else if (fi === effectiveFlatIdx) { stepStatus = 'running'; detail = execution.stage_description || 'Processing...'; }
        else stepStatus = 'pending';
      }

      // Determine engagement group label
      let groupLabel: string | undefined;
      if (flat.parentEngageId) {
        if (!seenEngageIds.has(flat.parentEngageId)) {
          seenEngageIds.add(flat.parentEngageId);
          engageCount++;
        }
        groupLabel = `Engagement #${engageCount}`;
      }

      switch (flat.type) {
        case 'delay':
          if (stepStatus === 'completed') detail = 'Completed';
          else if (stepStatus === 'running') detail = delayCountdown || 'Waiting...';
          steps.push({ id: `step-${flat.id}`, label: 'Initial Wait', nodeType: 'delay', status: stepStatus, detail, timestamp });
          break;
        case 'engage_delay': {
          const delaySec = flat.delay_seconds || 0;
          const channelLabel = flat.channelType === 'sms' ? 'SMS' : flat.channelType === 'whatsapp' ? 'WhatsApp' : 'Phone Call';
          if (stepStatus === 'completed') detail = 'Completed';
          else if (stepStatus === 'running') detail = delayCountdown || 'Waiting...';
          else if (stepStatus === 'pending') detail = formatDelay(delaySec);
          steps.push({ id: `step-${flat.id}`, label: `Wait before ${channelLabel}`, nodeType: 'engage_delay', status: stepStatus, detail, timestamp, groupLabel });
          break;
        }
        case 'send_sms':
          if (stepStatus === 'completed') {
            detail = flat.message ? (flat.message.length > 80 ? flat.message.slice(0, 80) + '…' : flat.message) : 'SMS sent';
          }
          steps.push({ id: `step-${flat.id}`, label: 'Send SMS', nodeType: 'send_sms', status: stepStatus, detail, timestamp, groupLabel });
          break;
        case 'send_whatsapp': {
          const waType = flat.whatsapp_type;
          const waLabel = waType === 'template' ? 'Send WhatsApp - Template' : waType === 'text' ? 'Send WhatsApp - Text' : 'Send WhatsApp';
          if (stepStatus === 'completed') {
            if (waType === 'template' && flat.template_name) {
              detail = flat.template_name;
            } else {
              detail = flat.message ? (flat.message.length > 80 ? flat.message.slice(0, 80) + '…' : flat.message) : 'WhatsApp sent';
            }
          } else {
            if (waType === 'template' && flat.template_name) {
              detail = flat.template_name;
            }
          }
          steps.push({ id: `step-${flat.id}`, label: waLabel, nodeType: 'send_whatsapp', status: stepStatus, detail, timestamp, groupLabel });
          break;
        }
        case 'phone_call':
          if (stepStatus === 'completed') detail = 'Call completed';
          else if (stepStatus === 'running') detail = 'Calling...';
          steps.push({ id: `step-${flat.id}`, label: 'Phone Call', nodeType: 'phone_call', status: stepStatus, detail, timestamp, groupLabel });
          break;
        case 'wait_for_reply':
          waitCount++;
          if (stepStatus === 'running' && isWaiting) detail = countdown || 'Waiting for reply...';
          else if (stepStatus === 'completed') {
            detail = execution.stop_reason?.toLowerCase().includes('repl') ? 'Lead replied' : 'Timeout — no reply';
          }
          steps.push({ id: `step-${flat.id}`, label: `Follow-Up Delay #${waitCount}`, nodeType: 'wait_for_reply', status: stepStatus, detail, timestamp: execution.waiting_for_reply_until });
          break;
        case 'drip':
          if (stepStatus === 'completed') detail = 'Released';
          steps.push({ id: `step-${flat.id}`, label: 'Drip Release', nodeType: 'drip', status: stepStatus, detail, timestamp: null });
          break;
      }
    }

    // End step
    steps.push({
      id: 'step-end',
      label: 'End',
      nodeType: 'end',
      status: isCompleted || isStopped ? 'completed' : 'pending',
      detail: isStopped
        ? (execution.stop_reason || 'Engagement stopped')
        : isCompleted
          ? 'Sequence complete'
          : '—',
      timestamp: execution.completed_at,
    });

    return steps;
  };

  const allSteps = buildSteps();

  return (
    <>
      <SavingOverlay isVisible={stopping || pushingNow || pausing || resuming} message={stopping ? 'Ending execution...' : pausing ? 'Pausing...' : resuming ? 'Resuming...' : 'Pushing now...'} variant="fixed" />
      <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
        <div
          className="px-4 shrink-0 flex items-center justify-between"
          style={{ height: 52, borderBottom: '1px solid hsl(var(--border))' }}
        >
          <div className="flex items-center gap-2">
            <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
              Execution Details
            </h3>
            {isActive && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-[1px] bg-warning opacity-75" />
                <span className="relative inline-flex rounded-[1px] h-2 w-2 bg-warning" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
              onClick={() => onReload()}
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

        {/* Status bar with countdown + END NOW */}
        {isActive ? (
          <div className="px-4 py-3 border-b border-border/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground" style={fieldStyle}>
                {isWaiting && countdown
                  ? countdown
                  : delayCountdown
                    ? delayCountdown
                    : execution.stage_description || 'Processing...'}
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
                <Square className="h-3.5 w-3.5" />
                <span className="ml-1.5">{stopping ? 'ENDING...' : 'END NOW'}</span>
              </button>
              <button
                className="groove-btn !h-7 px-3 uppercase text-foreground flex items-center flex-1 justify-center"
                style={{ fontFamily: "'VT323', monospace", fontSize: '14px', letterSpacing: '0.06em' }}
                onClick={onPause}
                disabled={pausing}
              >
                <Pause className="h-3.5 w-3.5" />
                <span className="ml-1.5">{pausing ? 'PAUSING...' : 'PAUSE'}</span>
              </button>
              <button
                className="groove-btn !h-7 px-3 uppercase text-foreground flex items-center flex-1 justify-center"
                style={{ fontFamily: "'VT323', monospace", fontSize: '14px', letterSpacing: '0.06em' }}
                onClick={() => setPushConfirmOpen(true)}
                disabled={pushingNow}
              >
                <Zap className="h-3.5 w-3.5" />
                <span className="ml-1.5">{pushingNow ? 'PUSHING...' : 'PUSH NOW'}</span>
              </button>
            </div>
          </div>
        ) : execution.status === 'paused' ? (
          <div className="px-4 py-3 border-b border-border/50 space-y-2">
            <div className="flex items-center justify-between">
              <StatusTag variant="warning">PAUSED</StatusTag>
              <span className="text-muted-foreground" style={fieldStyle}>
                {execution.started_at ? format(new Date(execution.started_at), 'MMM d, HH:mm:ss') : '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="groove-btn !h-7 px-3 uppercase text-foreground flex items-center flex-1 justify-center"
                style={{ fontFamily: "'VT323', monospace", fontSize: '14px', letterSpacing: '0.06em' }}
                onClick={onResume}
                disabled={resuming}
              >
                <Play className="h-3.5 w-3.5" />
                <span className="ml-1.5">{resuming ? 'RESUMING...' : 'RESUME'}</span>
              </button>
              <button
                className="groove-btn groove-btn-destructive !h-7 px-3 uppercase flex items-center flex-1 justify-center"
                style={{ fontFamily: "'VT323', monospace", fontSize: '14px', letterSpacing: '0.06em' }}
                onClick={() => setStopConfirmOpen(true)}
                disabled={stopping}
              >
                <Square className="h-3.5 w-3.5" />
                <span className="ml-1.5">{stopping ? 'ENDING...' : 'END NOW'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
            <StatusTag variant={statusVariant(execution.status)}>
              {execution.status === 'stopped' ? 'ENDED' : execution.status.toUpperCase()}
            </StatusTag>
            <span className="text-muted-foreground" style={fieldStyle}>
              {execution.started_at ? format(new Date(execution.started_at), 'MMM d, HH:mm:ss') : '—'}
            </span>
          </div>
        )}

        {/* Step-by-step breakdown */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
         {/* Group steps by engagement blocks */}
          {(() => {
            const rendered: React.ReactNode[] = [];
            let stepNumber = 0;

            // Collect steps into groups for engagement containers
            type StepGroup = { groupLabel: string; steps: typeof allSteps };
            const groupedSections: ({ type: 'single'; step: typeof allSteps[0]; stepNum: number } | { type: 'group'; group: StepGroup; stepNums: number[] })[] = [];
            let currentGroup: StepGroup | null = null;
            let currentGroupStepNums: number[] = [];

            for (let idx = 0; idx < allSteps.length; idx++) {
              const step = allSteps[idx];
              stepNumber++;
              const groupLabel = (step as any).groupLabel as string | undefined;

              if (groupLabel) {
                if (!currentGroup || currentGroup.groupLabel !== groupLabel) {
                  // Flush previous group
                  if (currentGroup) {
                    groupedSections.push({ type: 'group', group: currentGroup, stepNums: [...currentGroupStepNums] });
                  }
                  currentGroup = { groupLabel, steps: [step] };
                  currentGroupStepNums = [stepNumber];
                } else {
                  currentGroup.steps.push(step);
                  currentGroupStepNums.push(stepNumber);
                }
              } else {
                // Flush current group
                if (currentGroup) {
                  groupedSections.push({ type: 'group', group: currentGroup, stepNums: [...currentGroupStepNums] });
                  currentGroup = null;
                  currentGroupStepNums = [];
                }
                groupedSections.push({ type: 'single', step, stepNum: stepNumber });
              }
            }
            // Flush trailing group
            if (currentGroup) {
              groupedSections.push({ type: 'group', group: currentGroup, stepNums: [...currentGroupStepNums] });
            }

            const getStepPresentation = (step: typeof allSteps[0]) => {
              if (step.id === 'step-trigger') return { header: 'Trigger', title: step.label };
              if (step.id === 'step-find-lead') return { header: 'Find Lead', title: 'Find Lead' };
              if (step.id === 'step-lead-exists') return { header: 'Condition', title: 'Lead Exists?' };
              if (step.id === 'step-create-lead') return { header: 'Create Lead', title: 'Create Lead' };
              if (step.nodeType === 'drip') return { header: 'Webhook', title: 'Drip' };
              if (step.nodeType === 'delay') return { header: 'Delay', title: 'Initial Wait' };
              if (step.nodeType === 'engage_delay') return { header: 'Delay', title: step.label };
              if (step.nodeType === 'send_sms') return { header: 'Send SMS', title: step.label };
              if (step.nodeType === 'send_whatsapp') return { header: step.label, title: step.label };
              if (step.nodeType === 'phone_call') return { header: 'Phone Call', title: step.label };
              if (step.nodeType === 'wait_for_reply') return { header: step.label, title: 'Wait for Reply' };
              if (step.nodeType === 'end') return { header: 'End', title: 'End' };
              return { header: step.nodeType, title: step.label };
            };

            const renderStepCard = (step: typeof allSteps[0], num: number) => {
              const { header, title } = getStepPresentation(step);
              return (
                <div key={step.id} className="groove-border bg-background">
                  <div className="px-3 py-1.5 flex items-center justify-between border-b border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground" style={fieldStyle}>#{num}</span>
                      <span className="text-foreground" style={fieldStyle}>{header}</span>
                    </div>
                    <StatusTag variant={stepStatusVariant(step.status)}>
                      {step.status === 'running' ? 'PROCESSING' : step.status.toUpperCase()}
                    </StatusTag>
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
                              .or(`lead_id.eq.${execution.lead_id},id.eq.${execution.lead_id}`)
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
                        {step.timestamp && (
                          <div className="text-muted-foreground" style={fieldStyle}>
                            {format(new Date(step.timestamp), 'HH:mm:ss')}
                          </div>
                        )}
                        {execution.contact_phone && (
                          <div className="space-y-1 mt-1">
                            <Label className="field-text text-foreground">Phone</Label>
                         <Input value={execution.contact_phone} readOnly className={`field-text text-xs ${cb}`} />
                          </div>
                        )}
                        {execution.contact_email && (
                          <div className="space-y-1 mt-1">
                            <Label className="field-text text-foreground">Email</Label>
                            <Input value={execution.contact_email} readOnly className={`field-text text-xs ${cb}`} />
                          </div>
                        )}
                        <div className="space-y-1 mt-1">
                          <Label className="field-text text-foreground">Lead_ID</Label>
                          <Input value={execution.lead_id} readOnly className={`field-text text-xs ${cb}`} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-muted-foreground" style={fieldStyle}>{step.detail}</div>
                        {step.timestamp && step.status === 'completed' && (
                          <div className="text-muted-foreground" style={fieldStyle}>
                            {format(new Date(step.timestamp), 'HH:mm:ss')}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            };

            for (const section of groupedSections) {
              if (section.type === 'single') {
                rendered.push(renderStepCard(section.step, section.stepNum));
              } else {
                const { group, stepNums } = section;
                const allCompleted = group.steps.every(s => s.status === 'completed');
                const anyRunning = group.steps.some(s => s.status === 'running');
                const anyFailed = group.steps.some(s => s.status === 'failed');
                const groupStatus = anyFailed ? 'failed' : anyRunning ? 'running' : allCompleted ? 'completed' : 'pending';

                rendered.push(
                  <div key={`group-${group.groupLabel}`} className="rounded-md border border-border overflow-hidden">
                    {/* Group header */}
                    <div className="bg-muted/60 px-3 py-2 flex items-center justify-between border-b border-border">
                      <span className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.06em' }}>
                        {group.groupLabel}
                      </span>
                      <StatusTag variant={stepStatusVariant(groupStatus)}>
                        {groupStatus === 'running' ? 'PROCESSING' : groupStatus.toUpperCase()}
                      </StatusTag>
                    </div>
                    {/* Group children */}
                    <div className="p-2 space-y-2">
                      {group.steps.map((step, i) => renderStepCard(step, stepNums[i]))}
                    </div>
                  </div>
                );
              }
            }

            return rendered;
          })()}

          {/* Stop reason */}
          {execution.stop_reason && (
            <div className="groove-border bg-background px-3 py-2">
              <Label className="field-text text-foreground">Stop Reason</Label>
              <p className="text-muted-foreground mt-1" style={fieldStyle}>{execution.stop_reason}</p>
            </div>
          )}
        </div>
      </div>

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
              Are you sure you want to end this engagement? This will stop the sequence and cannot be undone.
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
                  onStop();
                }}
              >
                <Square className="h-4 w-4" />
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
              Are you sure you want to push now? This will skip the current wait and advance the execution immediately.
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
                  onPushNow();
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

/* ─── Execution list panel ─── */

function EngagementExecutionLog({
  executions,
  onSelectExecution,
  onClose,
  onReload,
  nodeFilter,
  onClearNodeFilter,
}: {
  executions: EngagementExecution[];
  onSelectExecution: (ex: EngagementExecution) => void;
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
      const searchable = [ex.contact_name, ex.contact_phone, ex.lead_id];
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

  const statusVariant = (status: string): 'positive' | 'negative' | 'neutral' | 'warning' => {
    switch (status) {
      case 'completed': return 'positive';
      case 'running': return 'warning';
      case 'failed': return 'negative';
      default: return 'neutral';
    }
  };

  const hasActive = executions.some(e => e.status === 'pending' || e.status === 'running');

  return (
    <div className="w-[408px] h-full bg-card overflow-hidden flex flex-col" style={{ borderLeft: '3px groove hsl(var(--border-groove))' }}>
      <div
        className="px-4 shrink-0 flex items-center justify-between"
        style={{ height: 52, borderBottom: '1px solid hsl(var(--border))' }}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-foreground uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '22px' }}>
            Executions
          </h3>
          {hasActive && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning" />
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
          placeholder="Search name, phone, or ID..."
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredExecutions.length === 0 ? (
          <div className="p-4 text-muted-foreground" style={fieldStyle}>
            {normalizedSearch ? 'No executions match your search.' : 'No executions yet. Start an engagement from a lead\'s detail page.'}
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
                <div className="mt-1 text-muted-foreground" style={{ ...fieldStyle, fontSize: '13px' }}>
                  <span className={cb}>{ex.contact_name || 'Unknown'} — {ex.contact_phone || '—'}</span>
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

export default function Engagement() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetWorkflowId = searchParams.get('wf');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workflow, setWorkflow] = useState<EngagementWorkflow | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [workflowName, setWorkflowName] = useState('Engagement Workflow');
  const [executions, setExecutions] = useState<EngagementExecution[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [selectedExecution, setSelectedExecution] = useState<EngagementExecution | null>(null);
  const selectedExecutionRef = useRef<EngagementExecution | null>(null);
  useEffect(() => { selectedExecutionRef.current = selectedExecution; }, [selectedExecution]);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [pushingNowId, setPushingNowId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [campaignContactIds, setCampaignContactIds] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [enrollWebhookToken, setEnrollWebhookToken] = useState<string | null>(null);
  const [showDeleteWorkflowDialog, setShowDeleteWorkflowDialog] = useState(false);
  const [showToggleActiveDialog, setShowToggleActiveDialog] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignLaunching, setCampaignLaunching] = useState(false);
  const [campaignProgress, setCampaignProgress] = useState<{ current: number; total: number } | null>(null);
  const [clientGhlAccountId, setClientGhlAccountId] = useState<string>('');
  const [executionNodeFilter, setExecutionNodeFilter] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const savedNodesRef = useRef<string>('');
  const savedNameRef = useRef<string>('');
  const [saveGeneration, setSaveGeneration] = useState(0);
  const { registerGuard, unregisterGuard } = useNavigationGuard();
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [textSetterNumber, setTextSetterNumber] = useState(1);
  const [setterSlots, setSetterSlots] = useState<string[]>([]);

  // Cadence Settings bar state (phase-11b)
  const [cadenceBarOpen, setCadenceBarOpen] = useState(false);
  const [quietHoursOverrideEnabled, setQuietHoursOverrideEnabled] = useState(false);
  const [quietHoursOverride, setQuietHoursOverride] = useState<QuietHoursConfig>(DEFAULT_QUIET_HOURS_OVERRIDE);
  const [voicemailMode, setVoicemailMode] = useState<'static' | 'dynamic'>('static');
  const [voicemailMessage, setVoicemailMessage] = useState('');
  const [clientQuietHoursDefault, setClientQuietHoursDefault] = useState<QuietHoursConfig | null>(null);
  const [cadenceStartTimeOpen, setCadenceStartTimeOpen] = useState(false);
  const [cadenceEndTimeOpen, setCadenceEndTimeOpen] = useState(false);

  usePageHeader({
    title: workflowName || 'Campaign',
    breadcrumbs: [
      { label: 'Workflows', onClick: () => navigate(`/client/${clientId}/workflows`) },
      { label: workflowName || 'Campaign', badge: (workflow as any)?.is_active ? 'ACTIVE' : 'INACTIVE', badgeVariant: (workflow as any)?.is_active ? 'positive' as const : 'neutral' as const },
    ],
  }, [workflowName, (workflow as any)?.is_active]);

  // Load client GHL account ID
  useEffect(() => {
    if (!clientId) return;
    (supabase as any).from('clients').select('ghl_location_id, cadence_quiet_hours').eq('id', clientId).single().then(({ data }: any) => {
      if (data?.ghl_location_id) setClientGhlAccountId(data.ghl_location_id);
      if (data?.cadence_quiet_hours && typeof data.cadence_quiet_hours === 'object') {
        const raw = data.cadence_quiet_hours as Record<string, unknown>;
        if (typeof raw.start === 'string' && typeof raw.end === 'string' && typeof raw.tz === 'string' && Array.isArray(raw.days)) {
          setClientQuietHoursDefault({
            start: raw.start,
            end: raw.end,
            tz: raw.tz,
            days: (raw.days as unknown[]).filter((d): d is number => typeof d === 'number'),
          });
        }
      }
    });
  }, [clientId]);

  // Load available setter slots for this client
  useEffect(() => {
    if (!clientId) return;
    (supabase as any).from('agent_settings').select('slot_id, name').eq('client_id', clientId).like('slot_id', 'Setter-%').then(({ data }: any) => {
      if (data) {
        const slots = Array.from(new Set(
          (data as { slot_id: string; name: string | null }[])
            .filter((r) => r.name && r.name.trim().length > 0)
            .map((r) => r.slot_id)
            .filter((s): s is string => typeof s === 'string' && /^Setter-\d+$/.test(s))
        )) as string[];
        slots.sort((a: string, b: string) => {
          const numA = parseInt(a.replace(/\D/g, '')) || 0;
          const numB = parseInt(b.replace(/\D/g, '')) || 0;
          return numA - numB;
        });
        setSetterSlots(slots.length > 0 ? slots : ['Setter-1']);
      }
    });
  }, [clientId]);

  // Load workflow (by wf= param, or auto-create if none)
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const engCacheKey = `engagement_wf_${clientId}_${targetWorkflowId || 'default'}`;
      const engCached = getCached<any>(engCacheKey);
      if (engCached) {
        setWorkflow(engCached.workflow);
        setWorkflowName(engCached.workflowName);
        setNodes(engCached.nodes);
        savedNodesRef.current = JSON.stringify(engCached.nodes);
        savedNameRef.current = engCached.workflowName;
        if (engCached.campaignId) setCampaignId(engCached.campaignId);
        if (engCached.enrollWebhookToken) setEnrollWebhookToken(engCached.enrollWebhookToken);
        setLoading(false);
      } else {
        setLoading(true);
      }

      let data: any = null;
      let error: any = null;

      if (targetWorkflowId) {
        // Load specific workflow by ID
        const res = await (supabase as any)
          .from('engagement_workflows')
          .select('*')
          .eq('id', targetWorkflowId)
          .eq('client_id', clientId)
          .maybeSingle();
        data = res.data;
        error = res.error;
      } else {
        // Fallback: load first workflow
        const res = await (supabase as any)
          .from('engagement_workflows')
          .select('*')
          .eq('client_id', clientId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        data = res.data;
        error = res.error;
      }

      if (error) {
        toast.error('Failed to load workflow');
        setLoading(false);
        return;
      }

      let loadedWorkflowId: string | null = null;
      let loadedWorkflowName: string = 'Campaign';

      if (data) {
        setWorkflow(data);
        setWorkflowName(data.name);
        loadedWorkflowId = data.id;
        loadedWorkflowName = data.name;
        // Hydrate Cadence Settings bar (phase-11b)
        const qhRaw = data.quiet_hours_override as Record<string, unknown> | null | undefined;
        if (qhRaw && typeof qhRaw.start === 'string' && typeof qhRaw.end === 'string' && typeof qhRaw.tz === 'string' && Array.isArray(qhRaw.days)) {
          setQuietHoursOverrideEnabled(true);
          setQuietHoursOverride({
            start: qhRaw.start,
            end: qhRaw.end,
            tz: qhRaw.tz,
            days: (qhRaw.days as unknown[]).filter((d): d is number => typeof d === 'number'),
          });
        } else {
          setQuietHoursOverrideEnabled(false);
          setQuietHoursOverride(DEFAULT_QUIET_HOURS_OVERRIDE);
        }
        const vmRaw = data.voicemail_config as Record<string, unknown> | null | undefined;
        if (vmRaw && (vmRaw.mode === 'static' || vmRaw.mode === 'dynamic')) {
          setVoicemailMode(vmRaw.mode);
          setVoicemailMessage(typeof vmRaw.message === 'string' ? vmRaw.message : '');
        } else {
          setVoicemailMode('static');
          setVoicemailMessage('');
        }
        // Auto-migrate legacy send_sms nodes to engage nodes
        const rawNodes: WorkflowNode[] = Array.isArray(data.nodes) ? data.nodes : [];
        const migratedNodes = rawNodes.map(n => {
          if (n.type === 'send_sms') {
            return {
              ...n,
              type: 'engage' as const,
              channels: [
                { type: 'sms' as const, enabled: true, message: n.message || '', delay_seconds: 0 },
                { type: 'whatsapp' as const, enabled: false, message: '', delay_seconds: 3600 },
                { type: 'phone_call' as const, enabled: false, instructions: '', delay_seconds: 1800 },
                { type: 'email' as const, enabled: false, subject: '', message: '', delay_seconds: 7200 },
              ],
            };
          }
          return n;
        });
        setNodes(migratedNodes);
        savedNodesRef.current = JSON.stringify(migratedNodes);
        savedNameRef.current = data.name;
      } else {
        const defaultNodes = DEFAULT_NODES.map(n => ({ ...n, id: nanoid() }));
        const { data: created, error: createErr } = await (supabase as any)
          .from('engagement_workflows')
          .insert({ client_id: clientId, name: 'Engagement Workflow', nodes: defaultNodes })
          .select()
          .single();
        if (createErr) {
          toast.error('Failed to create workflow');
        } else {
          setWorkflow(created);
          setWorkflowName(created.name);
          setNodes(created.nodes);
          savedNodesRef.current = JSON.stringify(created.nodes);
          savedNameRef.current = created.name;
          loadedWorkflowId = created.id;
          loadedWorkflowName = created.name;
        }
      }
      // Look up or create the linked campaign
      if (loadedWorkflowId) {
        const { data: existingCampaign } = await (supabase as any)
          .from('engagement_campaigns')
          .select('id, enroll_webhook_token, text_setter_number')
          .eq('workflow_id', loadedWorkflowId)
          .limit(1)
          .maybeSingle();
        if (existingCampaign) {
          setCampaignId(existingCampaign.id);
          setEnrollWebhookToken(existingCampaign.enroll_webhook_token || null);
          if (existingCampaign.text_setter_number) setTextSetterNumber(existingCampaign.text_setter_number);
        } else {
          // Auto-create campaign if missing (legacy workflows)
          const { data: newCamp } = await (supabase as any)
            .from('engagement_campaigns')
            .insert({ client_id: clientId, workflow_id: loadedWorkflowId, name: loadedWorkflowName })
            .select('id, enroll_webhook_token')
            .single();
          if (newCamp) {
            setCampaignId(newCamp.id);
            setEnrollWebhookToken(newCamp.enroll_webhook_token || null);
            await insertDefaultCampaignWidgets(clientId, newCamp.id);
          }
        }
      }

      // Cache the loaded state for instant rendering on next visit
      const currentNodes = savedNodesRef.current ? JSON.parse(savedNodesRef.current) : [];
      setCache(engCacheKey, {
        workflow: workflow,
        workflowName: savedNameRef.current,
        nodes: currentNodes,
        campaignId: loadedWorkflowId ? campaignId : null,
        enrollWebhookToken: enrollWebhookToken,
      });

      setLoading(false);
    })();
  }, [clientId, targetWorkflowId]);

  // Load executions
  const activeWorkflowId = workflow?.id || targetWorkflowId || null;
  const fetchExecutionsRequestIdRef = useRef(0);

  const fetchExecutions = useCallback(async () => {
    if (!clientId || !activeWorkflowId) return;
    const requestId = ++fetchExecutionsRequestIdRef.current;
    const { data, error } = await (supabase as any)
      .from('engagement_executions')
      .select('*')
      .eq('client_id', clientId)
      .eq('workflow_id', activeWorkflowId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (requestId !== fetchExecutionsRequestIdRef.current) return;
    if (error) {
      console.error('Failed to load engagement executions', error);
      return;
    }

    const scopedExecutions = (data as EngagementExecution[]) || [];
    setExecutions(scopedExecutions);
    setSelectedExecution(prev => {
      if (!prev) return null;
      const updated = scopedExecutions.find(e => e.id === prev.id);
      if (!updated) return null;
      return JSON.stringify(prev) === JSON.stringify(updated) ? prev : updated;
    });
  }, [clientId, activeWorkflowId]);

  const lastFetchRef = useRef(0);

  useEffect(() => {
    if (!clientId || !activeWorkflowId) {
      setExecutions([]);
      setSelectedExecution(null);
      return;
    }

    fetchExecutions();
    const channel = supabase
      .channel(`engagement-executions-live-${clientId}-${activeWorkflowId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'engagement_executions', filter: `workflow_id=eq.${activeWorkflowId}` },
        () => {
          const now = Date.now();
          if (now - lastFetchRef.current < 250) return;
          lastFetchRef.current = now;
          fetchExecutions();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, activeWorkflowId, fetchExecutions]);

  // Save workflow (activates on first save)
  const handleSave = useCallback(async () => {
    if (!workflow || !clientId) return;
    const validationError = validateEngageNodes(nodes);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    const updatePayload: any = { name: workflowName, nodes, updated_at: new Date().toISOString() };
    if (!(workflow as any).is_active) {
      updatePayload.is_active = true;
    }
    // Phase-11b: persist Cadence Settings bar values.
    updatePayload.quiet_hours_override = quietHoursOverrideEnabled ? quietHoursOverride : null;
    updatePayload.voicemail_config = voicemailMessage.trim() ? { mode: voicemailMode, message: voicemailMessage } : null;
    const { error } = await (supabase as any)
      .from('engagement_workflows')
      .update(updatePayload)
      .eq('id', workflow.id);
    if (error) {
      toast.error('Failed to save workflow');
    } else {
      toast.success('Workflow saved');
      savedNodesRef.current = JSON.stringify(nodes);
      savedNameRef.current = workflowName;
      setSaveGeneration(g => g + 1);
      if (!(workflow as any).is_active) {
        setWorkflow(prev => prev ? { ...prev, is_active: true } as any : prev);
      }
      // Sync campaign name + text setter number
      if (campaignId) {
        await (supabase as any)
          .from('engagement_campaigns')
          .update({ name: workflowName, text_setter_number: textSetterNumber })
          .eq('id', campaignId);
      }
    }
    setSaving(false);
  }, [workflow, clientId, workflowName, nodes, textSetterNumber, campaignId, quietHoursOverrideEnabled, quietHoursOverride, voicemailMode, voicemailMessage]);

  // Node operations
  const handleNodeChange = useCallback((nodeId: string, updated: WorkflowNode) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? updated : n));
  }, []);

  // Stop engagement
  const handleStop = useCallback(async (executionId: string) => {
    setStoppingId(executionId);
    try {
      const { error } = await supabase.functions.invoke('stop-engagement', {
        body: { execution_id: executionId },
      });
      if (error) throw error;
      toast.success('Engagement stopped');
      // Immediately update local state so canvas reflects cancellation
      setSelectedExecution(prev => prev?.id === executionId ? { ...prev, status: 'cancelled', stop_reason: 'manual_stop', completed_at: new Date().toISOString() } : prev);
      setExecutions(prev => prev.map(e => e.id === executionId ? { ...e, status: 'cancelled', stop_reason: 'manual_stop', completed_at: new Date().toISOString() } : e));
      fetchExecutions();
    } catch {
      toast.error('Failed to stop engagement');
    }
    setStoppingId(null);
  }, [fetchExecutions]);

  // Push now — advance the execution past the current delay/wait
  const handlePushNow = useCallback(async (executionId: string) => {
    setPushingNowId(executionId);
    try {
      const { error } = await supabase.functions.invoke('push-engagement-now', {
        body: { execution_id: executionId },
      });
      if (error) throw error;
      toast.success('Pushed — advancing execution');
      await fetchExecutions();
    } catch {
      toast.error('Failed to push');
    }
    setPushingNowId(null);
  }, [fetchExecutions]);

  // Pause — freeze a running cadence (resumable). D1 (4.5).
  const handlePause = useCallback(async (executionId: string) => {
    setPausingId(executionId);
    try {
      const { error } = await supabase.functions.invoke('pause-engagement', {
        body: { execution_id: executionId },
      });
      if (error) throw error;
      toast.success('Engagement paused');
      setSelectedExecution(prev => prev?.id === executionId ? { ...prev, status: 'paused', stage_description: 'Paused — manually paused from UI.' } : prev);
      setExecutions(prev => prev.map(e => e.id === executionId ? { ...e, status: 'paused' } : e));
      fetchExecutions();
    } catch {
      toast.error('Failed to pause engagement');
    }
    setPausingId(null);
  }, [fetchExecutions]);

  // Resume — continue a paused cadence from where it left off. D1 (4.5).
  const handleResume = useCallback(async (executionId: string) => {
    setResumingId(executionId);
    try {
      const { error } = await supabase.functions.invoke('resume-engagement', {
        body: { execution_id: executionId },
      });
      if (error) throw error;
      toast.success('Engagement resumed');
      setSelectedExecution(prev => prev?.id === executionId ? { ...prev, status: 'running', stage_description: 'Resumed — continuing the sequence.' } : prev);
      setExecutions(prev => prev.map(e => e.id === executionId ? { ...e, status: 'running' } : e));
      fetchExecutions();
    } catch {
      toast.error('Failed to resume engagement');
    }
    setResumingId(null);
  }, [fetchExecutions]);

  // Start Campaign handler — uses the existing linked campaign
  const handleStartCampaign = useCallback(async () => {
    if (!clientId || !workflow || !campaignId) {
      toast.error('Campaign not linked. Please reload.');
      return;
    }
    const lines = campaignContactIds.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error('No contact IDs provided'); return; }
    setCampaignLaunching(true);
    setCampaignProgress({ current: 0, total: lines.length });

    try {

      let successCount = 0;
      for (let i = 0; i < lines.length; i++) {
        try {
          await supabase.functions.invoke('trigger-engagement', {
            body: {
              lead_id: lines[i],
              client_id: clientId,
              workflow_id: workflow.id,
              contact_name: '',
              contact_phone: '',
              campaign_id: campaignId,
            },
          });
          successCount++;
        } catch { /* continue */ }
        setCampaignProgress({ current: i + 1, total: lines.length });
      }
      setCampaignLaunching(false);
      setCampaignProgress(null);
      setShowCampaignDialog(false);
      toast.success(`Campaign started — ${successCount} leads enrolled`);
      fetchExecutions();
    } catch (err: any) {
      setCampaignLaunching(false);
      setCampaignProgress(null);
      toast.error(err.message || 'Failed to start campaign');
    }
  }, [clientId, workflow, campaignContactIds, campaignId, fetchExecutions]);

  // Convert nodes to CanvasNode format matching Text Setter Engine tree structure
  const canvasNodes: CanvasNode[] = useMemo(() => {
    if (nodes.length === 0) return [];

    const dripNode = nodes.find(n => n.type === 'drip');
    const delayNode = nodes.find(n => n.type === 'delay');
    const engageNodes = nodes.filter(n => n.type === 'engage' || n.type === 'send_sms');
    const waitNodes = nodes.filter(n => n.type === 'wait_for_reply');

    const result: CanvasNode[] = [];

    // Shared step after enrollment resolution
    const addDripId = 'eng-add-drip';
    const firstChildId = dripNode ? dripNode.id : addDripId;

    // Manual trigger (root 1) → Find Lead
    result.push({
      id: 'eng-trigger',
      type: 'trigger' as const,
      data: { label: 'Manual Entry', triggerType: 'contact_created' as const, description: 'Enroll the lead manually' },
      children: ['eng-find-lead'],
    });

    // Webhook trigger (root 2) → Find Lead
    result.push({
      id: 'eng-webhook-trigger',
      type: 'trigger' as const,
      data: { label: 'Webhook', triggerType: 'inbound_webhook' as const, description: 'Enroll lead via webhook' },
      children: ['eng-find-lead'],
    });

    result.push({
      id: 'eng-find-lead',
      type: 'find' as const,
      data: { label: 'Find Lead', actionType: 'find' as const, description: 'Search by Lead ID' } as any,
      children: ['eng-lead-exists'],
    });

    result.push({
      id: 'eng-lead-exists',
      type: 'condition' as const,
      data: { label: 'Lead Exists?', actionType: 'condition' as const, field: 'lead_found', operator: 'equals' as const, value: 'true', description: 'Check if lead exists' } as any,
      mergeChildId: firstChildId,
      children: [firstChildId, 'eng-create-lead'],
      branchLabels: { true: 'Lead Exists', false: "Lead Doesn't Exist" },
    });

    result.push({
      id: 'eng-create-lead',
      type: 'create_contact' as const,
      data: { label: 'Create Lead', actionType: 'create_contact' as const, description: 'Create from webhook data' } as any,
      children: [],
    });

    // Drip node (if present, always after trigger) OR add-drip placeholder
    if (dripNode) {
      const { value: dv, unit: du } = delayToUnits(dripNode.interval_seconds || 3600);
      result.push({
        id: dripNode.id,
        type: 'drip' as const,
        data: {
          label: 'Drip',
          actionType: 'delay' as const,
          delayMode: 'duration' as const,
          delayValue: 0,
          delayUnit: 'seconds' as const,
          waitUntil: '',
          timezone: '',
          description: `Batches of ${dripNode.batch_size || 100} every ${dv} ${du}`,
        },
        children: delayNode ? [delayNode.id] : (engageNodes[0] ? [engageNodes[0].id] : []),
      });
    } else {
      // Placeholder "Add Drip" node
      const nextAfterDrip = delayNode ? delayNode.id : (engageNodes[0] ? engageNodes[0].id : 'eng-final-end');
      result.push({
        id: addDripId,
        type: 'add_followup' as const,
        data: { label: 'Add Drip' } as any,
        children: [nextAfterDrip],
      });
    }

    // Initial delay
    if (delayNode) {
      result.push({
        id: delayNode.id,
        type: 'delay' as const,
        data: {
          label: 'Initial Wait',
          actionType: 'delay' as const,
          delayMode: 'duration' as const,
          delayValue: 0,
          delayUnit: 'seconds' as const,
          waitUntil: '',
          timezone: '',
          description: formatDelay(delayNode.delay_seconds || 300),
        },
        children: engageNodes[0] ? [engageNodes[0].id] : [],
      });
    }

    // New structure: E1 → FU1 (replied→end, no reply→) → E2 → FU2 → ... → EN (no follow-up)
    // N engagements, N-1 follow-ups. Last engagement ends the sequence.
    const addEngagementId = 'eng-add-engagement';

    for (let i = 0; i < engageNodes.length; i++) {
      const engNode = engageNodes[i];
      const isLast = i === engageNodes.length - 1;
      const wait = !isLast ? waitNodes[i] : null; // follow-up only for non-last

      // Engagement node
      if (engNode.type === 'engage') {
        const channels = engNode.channels || [];
        const enabledLabels = channels.filter(c => c.enabled).map(c => CHANNEL_LABELS[c.type] || c.type);
        const chipText = enabledLabels.length > 0 ? enabledLabels.join(' · ') : 'No channels';

        result.push({
          id: engNode.id,
          type: 'engage' as const,
          data: {
            label: `Engagement #${i + 1}`,
            actionType: 'send_sms' as const,
            description: chipText,
          } as any,
          children: isLast
            ? ['eng-final-end']
            : [wait!.id],
        });
      } else {
        // Legacy send_sms node
        result.push({
          id: engNode.id,
          type: 'send_sms' as const,
          data: {
            label: `Send SMS #${i + 1}`,
            actionType: 'send_sms' as const,
            message: engNode.message,
            description: engNode.message
              ? (engNode.message.length > 60 ? engNode.message.slice(0, 60) + '...' : engNode.message)
              : 'Configure message...',
          },
          children: isLast
            ? ['eng-final-end']
            : [wait!.id],
        });
      }

      // Follow-up delay (only for non-last engagements)
      if (wait) {
        const endId = `eng-end-${i + 1}`;
        const nextEng = engageNodes[i + 1];

        result.push({
          id: wait.id,
          type: 'follow_up' as const,
          data: {
            label: 'Wait for Reply',
            headerTitle: `Follow-Up Delay #${i + 1}`,
            actionType: 'condition' as const,
            field: 'reply_received',
            operator: 'equals' as const,
            value: 'true',
            description: `Timeout: ${formatDelay(wait.timeout_seconds || 86400)}`,
          } as any,
          children: [endId, nextEng.id],
          branchLabels: { true: 'Lead Replied', false: 'No Reply' },
        });

        // End node for "Lead Replied" branch
        result.push({
          id: endId,
          type: 'end' as const,
          data: { label: 'End', description: 'Lead replied — sequence stopped' } as any,
          children: [],
        });
      }
    }

    // Final end node
    result.push({
      id: 'eng-final-end',
      type: 'end' as const,
      data: { label: 'End', description: engageNodes.length === 1 ? 'Engagement complete' : 'All follow-ups exhausted — sequence complete' } as any,
      children: engageNodes.length < 5 ? [addEngagementId] : [],
    });

    // "Add Engagement" placeholder button (max 5)
    if (engageNodes.length < 5) {
      result.push({
        id: addEngagementId,
        type: 'add_followup' as const,
        data: { label: 'Add Engagement' } as any,
        children: [],
      });
    }

    return result;
  }, [nodes]);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setRightPanel('config');
    setSelectedExecution(null);
  }, []);

  const handleDeselectNode = useCallback(() => {}, []);

  const [showCanvasDeleteDrip, setShowCanvasDeleteDrip] = useState(false);
  const handleDeleteDripNode = useCallback(() => {
    setShowCanvasDeleteDrip(true);
  }, []);

  const executionFlatSteps = useMemo(() => expandNodesToFlat(nodes), [nodes]);
  const flatToOriginalMap = useMemo(() => buildFlatToOriginalMap(executionFlatSteps), [executionFlatSteps]);

  // Map execution to the canvas node it's currently sitting on (using resolved flat index mapping)
  const getEngagementExecutionNodeId = useCallback((ex: EngagementExecution): string | null => {
    if (ex.status !== 'running' && ex.status !== 'pending') return null;
    const flatIdx = resolveExecutionFlatIndex(ex, executionFlatSteps);
    const origIdx = flatIdx >= 0 && flatIdx < flatToOriginalMap.length ? flatToOriginalMap[flatIdx] : -1;
    return origIdx >= 0 ? nodes[origIdx]?.id ?? null : null;
  }, [executionFlatSteps, flatToOriginalMap, nodes]);

  // Compute lead counts per canvas node
  const nodeLeadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ex of executions) {
      const nodeId = getEngagementExecutionNodeId(ex);
      if (nodeId) {
        counts.set(nodeId, (counts.get(nodeId) || 0) + 1);
      }
    }
    return counts.size > 0 ? counts : undefined;
  }, [executions, getEngagementExecutionNodeId]);

  const filteredByNodeExecutions = useMemo(() => {
    if (!executionNodeFilter) return executions;
    return executions.filter(ex => getEngagementExecutionNodeId(ex) === executionNodeFilter);
  }, [executions, executionNodeFilter, getEngagementExecutionNodeId]);

  const handleNodeBadgeClick = useCallback((nodeId: string) => {
    setExecutionNodeFilter(nodeId);
    setRightPanel('executions');
    setSelectedNodeId(null);
    setSelectedExecution(null);
  }, []);



  // Derive highlighted node IDs and statuses from selected execution
  const highlightedNodeIds = useMemo(() => {
    if (!selectedExecution || rightPanel !== 'execution-detail') return undefined;
    const ids = new Set<string>();
    const flatIdx = resolveExecutionFlatIndex(selectedExecution, executionFlatSteps);
    const origIdx = flatIdx >= 0 && flatIdx < flatToOriginalMap.length ? flatToOriginalMap[flatIdx] : -1;
    const isStopped = isStoppedExecution(selectedExecution);
    const isCompleted = isCompletedExecution(selectedExecution.status);
    const enrollmentSource = (selectedExecution as any).enrollment_source || 'manual';
    const isNewLead = (selectedExecution as any).is_new_lead === true;

    // Highlight the correct trigger based on enrollment source
    if (enrollmentSource === 'webhook') {
      ids.add('eng-webhook-trigger');
    } else {
      ids.add('eng-trigger');
    }

    ids.add('eng-find-lead');
    ids.add('eng-lead-exists');

    // Highlight the correct branch of the if/else
    if (isNewLead) {
      ids.add('eng-create-lead');
    } else {
      ids.add('eng-existing-lead');
    }

    for (let i = 0; i < nodes.length; i++) {
      if (isCompleted || i <= origIdx) {
        ids.add(nodes[i].id);
      }
      if (isStopped && i <= origIdx) {
        ids.add(nodes[i].id);
      }
    }

    return ids.size > 0 ? ids : undefined;
  }, [selectedExecution, rightPanel, nodes, flatToOriginalMap, executionFlatSteps]);

  const nodeStatuses = useMemo(() => {
    if (!selectedExecution || rightPanel !== 'execution-detail') return undefined;
    const map = new Map<string, import('@/components/workflow/StaticWorkflowNode').NodeExecutionStatus>();
    const flatIdx = resolveExecutionFlatIndex(selectedExecution, executionFlatSteps);
    const origIdx = flatIdx >= 0 && flatIdx < flatToOriginalMap.length ? flatToOriginalMap[flatIdx] : -1;
    const isStopped = isStoppedExecution(selectedExecution);
    const isCompleted = isCompletedExecution(selectedExecution.status);
    const isFailed = isFailedExecution(selectedExecution.status);

    const enrollmentSource = (selectedExecution as any).enrollment_source || 'manual';
    const isNewLead = (selectedExecution as any).is_new_lead === true;

    if (selectedExecution.started_at) {
      // Mark the correct trigger
      if (enrollmentSource === 'webhook') {
        map.set('eng-webhook-trigger', 'completed');
      } else {
        map.set('eng-trigger', 'completed');
      }
      map.set('eng-find-lead', 'completed');
      map.set('eng-lead-exists', 'completed');
      if (isNewLead) {
        map.set('eng-create-lead', 'completed');
      } else {
        map.set('eng-existing-lead', 'completed');
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const nodeId = nodes[i].id;
      if (isCompleted) {
        map.set(nodeId, 'completed');
      } else if (isStopped) {
        if (i < origIdx) map.set(nodeId, 'completed');
        else if (i === origIdx) map.set(nodeId, 'cancelled');
      } else if (isFailed) {
        if (i < origIdx) map.set(nodeId, 'completed');
        else if (i === origIdx) map.set(nodeId, 'failed');
      } else {
        if (i < origIdx) map.set(nodeId, 'completed');
        else if (i === origIdx) map.set(nodeId, 'processing');
      }
    }

    // Mark END nodes as completed when execution is done
    if (isCompleted) {
      map.set('eng-final-end', 'completed');
      // Also mark any replied-branch end nodes
      const waitNodes = nodes.filter(n => n.type === 'wait_for_reply');
      waitNodes.forEach((_w, i) => {
        map.set(`eng-end-${i + 1}`, 'completed');
      });
    } else if (isStopped && selectedExecution.stop_reason === 'replied') {
      // If stopped due to reply, mark the corresponding replied-end node
      const engageNodes = nodes.filter(n => n.type === 'engage' || n.type === 'send_sms');
      const waitNodes = nodes.filter(n => n.type === 'wait_for_reply');
      for (let i = 0; i < waitNodes.length; i++) {
        const waitIdx = nodes.indexOf(waitNodes[i]);
        if (waitIdx <= origIdx) {
          map.set(`eng-end-${i + 1}`, 'completed');
        }
      }
    }

    return map.size > 0 ? map : undefined;
  }, [selectedExecution, rightPanel, nodes, flatToOriginalMap, executionFlatSteps]);

  const handleSelectExecution = useCallback((ex: EngagementExecution) => {
    setSelectedExecution(ex);
    setRightPanel('execution-detail');
    setSelectedNodeId(null);
  }, []);

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
    `groove-btn !h-8 px-3 flex items-center uppercase transition-colors ${active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`;

  const VISUAL_TRIGGER_IDS = new Set(['eng-trigger', 'eng-webhook-trigger', 'eng-find-lead', 'eng-lead-exists', 'eng-create-lead', 'eng-existing-lead']);
  const selectedNode: WorkflowNode | null = selectedNodeId && VISUAL_TRIGGER_IDS.has(selectedNodeId)
    ? { id: selectedNodeId, type: 'trigger' }
    : selectedNodeId ? nodes.find(n => n.id === selectedNodeId) || null : null;

  // Dirty detection
  const hasUnsavedChanges = useMemo(() => {
    if (!workflow || loading) return false;
    return JSON.stringify(nodes) !== savedNodesRef.current || workflowName !== savedNameRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, workflowName, workflow, loading, saveGeneration]);

  // Browser beforeunload warning
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Navigation guard for sidebar
  useEffect(() => {
    if (hasUnsavedChanges) {
      registerGuard((proceed) => {
        pendingNavigationRef.current = proceed;
        setShowUnsavedDialog(true);
        return true; // blocked
      });
    } else {
      unregisterGuard();
    }
    return () => unregisterGuard();
  }, [hasUnsavedChanges, registerGuard, unregisterGuard]);

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
              Edit Campaign
            </span>
            <button
              className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 ml-2"
              onClick={() => { setRenameValue(workflowName); setShowRenameDialog(true); }}
            >
              <Pencil className="h-4 w-4" />
            </button>

            <div className="flex items-center ml-auto" style={{ gap: 12 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                className="groove-btn groove-btn-pulse !h-8 px-3 flex items-center uppercase disabled:opacity-50"
                style={tabStyle}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span className="ml-1.5">{saving ? 'Saving...' : 'Save'}</span>
              </button>
              <button
                onClick={() => togglePanel('executions')}
                className={tabBtnClass(rightPanel === 'executions' || rightPanel === 'execution-detail')}
                style={tabStyle}
              >
                <ClipboardCheck className="w-4 h-4" />
                <span className="ml-1.5">Executions</span>
              </button>
              {workflow && (
              <button
                onClick={() => setShowToggleActiveDialog(true)}
                className={`groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center ${(workflow as any)?.is_active ? 'groove-btn-destructive' : 'groove-btn-positive'}`}
                title={(workflow as any)?.is_active ? 'Disable workflow' : 'Enable workflow'}
              >
                <Power className="w-4 h-4" />
              </button>
              )}
              <button
                onClick={() => setShowDeleteWorkflowDialog(true)}
                className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Cadence Settings bar (phase-11b) */}
        <div className="bg-card shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))' }}>
          <div
            className={rightPanel ? 'flex items-center' : 'container mx-auto max-w-7xl flex items-center'}
            style={{
              ...(rightPanel ? { paddingLeft: 'max(3rem, calc((100vw - 16rem - 80rem) / 2 + 3rem))', paddingRight: 12 } : undefined),
              minHeight: 40,
            }}
          >
            <button
              type="button"
              onClick={() => setCadenceBarOpen((v) => !v)}
              className="flex items-center gap-2 text-foreground uppercase py-2"
              style={tabStyle}
            >
              {cadenceBarOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span>Cadence Settings</span>
            </button>
            <span className="ml-3 text-muted-foreground" style={{ ...fieldStyle, fontSize: '12px' }}>
              {quietHoursOverrideEnabled ? `Quiet hours: ${summariseQuietHours(quietHoursOverride)}` : `Quiet hours: inherit (${summariseQuietHours(clientQuietHoursDefault)})`}
              {' · '}
              {voicemailMessage.trim() ? `Voicemail: ${voicemailMode}` : 'Voicemail: not configured'}
            </span>
          </div>
          {cadenceBarOpen && (
            <div
              className={rightPanel ? 'pb-4' : 'container mx-auto max-w-7xl pb-4'}
              style={rightPanel ? { paddingLeft: 'max(3rem, calc((100vw - 16rem - 80rem) / 2 + 3rem))', paddingRight: 12 } : undefined}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                {/* Quiet Hours column */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="field-text text-foreground uppercase" style={tabStyle}>Quiet Hours</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground" style={fieldStyle}>Override</span>
                      <Switch checked={quietHoursOverrideEnabled} onCheckedChange={setQuietHoursOverrideEnabled} />
                    </div>
                  </div>
                  <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '12px' }}>
                    Client default: <span className="text-foreground">{summariseQuietHours(clientQuietHoursDefault)}</span>
                  </p>
                  {quietHoursOverrideEnabled && (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1">
                        <Label className="field-text text-foreground">Active Days</Label>
                        <div className="flex gap-1 flex-wrap">
                          {DAY_LABELS.map((label, i) => {
                            const dayVal = CADENCE_DAY_VALUES[i];
                            const active = quietHoursOverride.days.includes(dayVal);
                            return (
                              <button
                                key={label}
                                type="button"
                                className={cn(
                                  'px-2.5 py-1 rounded border transition-colors',
                                  active
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                                )}
                                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                onClick={() => {
                                  setQuietHoursOverride((prev) => ({
                                    ...prev,
                                    days: prev.days.includes(dayVal)
                                      ? prev.days.filter((x) => x !== dayVal)
                                      : [...prev.days, dayVal].sort((a, b) => a - b),
                                  }));
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="field-text text-foreground">Time Window</Label>
                        <div className="flex items-center gap-2">
                          <Popover open={cadenceStartTimeOpen} onOpenChange={setCadenceStartTimeOpen}>
                            <PopoverTrigger asChild>
                              <button
                                className="flex items-center gap-2 rounded border border-border bg-background px-3 py-1.5 text-foreground hover:border-primary/50 transition-colors"
                                style={fieldStyle}
                              >
                                <span>{formatTime12(quietHoursOverride.start)}</span>
                                <Clock className="h-4 w-4 text-muted-foreground mr-0.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-44 p-0 bg-sidebar border border-border" style={{ borderStyle: 'solid', boxShadow: 'none' }} align="start">
                              <div className="max-h-56 overflow-y-auto">
                                {TIME_OPTIONS_30MIN.map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    className={cn(
                                      'w-full text-left px-3 py-1.5 transition-colors',
                                      t === quietHoursOverride.start ? 'bg-accent/50 text-foreground' : 'hover:bg-accent/50 text-foreground'
                                    )}
                                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                    onClick={() => { setQuietHoursOverride((p) => ({ ...p, start: t })); setCadenceStartTimeOpen(false); }}
                                  >
                                    {formatTime12(t)}
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                          <span className="text-muted-foreground" style={fieldStyle}>to</span>
                          <Popover open={cadenceEndTimeOpen} onOpenChange={setCadenceEndTimeOpen}>
                            <PopoverTrigger asChild>
                              <button
                                className="flex items-center gap-2 rounded border border-border bg-background px-3 py-1.5 text-foreground hover:border-primary/50 transition-colors"
                                style={fieldStyle}
                              >
                                <span>{formatTime12(quietHoursOverride.end)}</span>
                                <Clock className="h-4 w-4 text-muted-foreground mr-0.5" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-44 p-0 bg-sidebar border border-border" style={{ borderStyle: 'solid', boxShadow: 'none' }} align="start">
                              <div className="max-h-56 overflow-y-auto">
                                {TIME_OPTIONS_30MIN.map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    className={cn(
                                      'w-full text-left px-3 py-1.5 transition-colors',
                                      t === quietHoursOverride.end ? 'bg-accent/50 text-foreground' : 'hover:bg-accent/50 text-foreground'
                                    )}
                                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                    onClick={() => { setQuietHoursOverride((p) => ({ ...p, end: t })); setCadenceEndTimeOpen(false); }}
                                  >
                                    {formatTime12(t)}
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="field-text text-foreground">Timezone</Label>
                        <Select value={quietHoursOverride.tz} onValueChange={(tz) => setQuietHoursOverride((p) => ({ ...p, tz }))}>
                          <SelectTrigger className="field-text">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-sidebar border border-border max-h-60" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                            {IANA_TIMEZONES.map((tz) => (
                              <SelectItem key={tz} value={tz}>{tz} ({getUtcOffset(tz)})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Voicemail column */}
                <div className="space-y-3">
                  <Label className="field-text text-foreground uppercase" style={tabStyle}>Voicemail</Label>
                  <RadioGroup
                    value={voicemailMode}
                    onValueChange={(v) => setVoicemailMode(v as 'static' | 'dynamic')}
                    className="flex gap-4"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="static" id="vm-static" />
                      <Label htmlFor="vm-static" className="field-text text-foreground cursor-pointer">Static text</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="dynamic" id="vm-dynamic" />
                      <Label htmlFor="vm-dynamic" className="field-text text-foreground cursor-pointer">Dynamic (LLM-generated per call)</Label>
                    </div>
                  </RadioGroup>
                  <Textarea
                    className="field-text"
                    rows={5}
                    value={voicemailMessage}
                    onChange={(e) => setVoicemailMessage(e.target.value)}
                    placeholder={voicemailMode === 'static'
                      ? 'Hey {{first_name}}, sorry I missed you. Call me back when you can.'
                      : 'You are leaving a voicemail for {{first_name}} after they did not pick up. Keep it under 15 seconds, friendly tone, ask them to call back.'}
                  />
                  <p className="text-muted-foreground" style={{ ...fieldStyle, fontSize: '12px' }}>
                    {voicemailMode === 'static'
                      ? 'Pushed to Retell as a static text voicemail. {{vars}} substituted by Retell.'
                      : 'Pushed to Retell as a prompt; the LLM generates the voicemail per call.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <WorkflowCanvas
          nodes={canvasNodes}
          selectedNodeId={selectedNodeId}
          highlightedNodeIds={highlightedNodeIds}
          nodeStatuses={nodeStatuses}
          nodeLeadCounts={rightPanel === 'execution-detail' ? undefined : nodeLeadCounts}
          readOnly
          onSelectNode={handleSelectNode}
          onAddNode={() => {}}
          onDeselectNode={handleDeselectNode}
          onNodeBadgeClick={handleNodeBadgeClick}
          
          renderCustomNode={(node) => {
            if (node.id === 'eng-add-drip') {
              return (
                <button
                  data-workflow-interactive
                  className="groove-btn !h-9 w-[260px] flex items-center justify-center gap-2 uppercase pointer-events-auto"
                  style={{ ...tabStyle, borderRadius: 0 }}
                  onClick={() => {
                    setNodes(prev => [{ id: nanoid(), type: 'drip' as const, batch_size: 10, interval_seconds: 3600 }, ...prev]);
                  }}
                >
                  <Clock className="w-4 h-4" />
                  <span>Add Drip</span>
                </button>
              );
            }
            if (node.id === 'eng-add-engagement') {
              return (
                <button
                  data-workflow-interactive
                  className="groove-btn !h-9 w-[260px] flex items-center justify-center gap-2 uppercase pointer-events-auto"
                  style={{ ...tabStyle, borderRadius: 0 }}
                  onClick={() => {
                    setNodes(prev => {
                      // Add a new wait_for_reply before the last engage, then add a new engage at the end
                      const engageNodes = prev.filter(n => n.type === 'engage' || n.type === 'send_sms');
                      if (engageNodes.length >= 5) return prev;
                      const newWait: WorkflowNode = { id: nanoid(), type: 'wait_for_reply', timeout_seconds: 86400 };
                      const newEngage: WorkflowNode = { id: nanoid(), type: 'engage', channels: DEFAULT_ENGAGE_CHANNELS.map(c => ({ ...c })) };
                      return [...prev, newWait, newEngage];
                    });
                  }}
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Engagement</span>
                </button>
              );
            }
            return null;
          }}
        />
        <DeleteConfirmDialog
          open={showCanvasDeleteDrip}
          onOpenChange={setShowCanvasDeleteDrip}
          onConfirm={() => { setShowCanvasDeleteDrip(false); setNodes(prev => prev.filter(n => n.type !== 'drip')); }}
          title="Delete Drip Node"
          itemName="Drip"
        />
      </div>

      {/* Right Panel */}
      {rightPanel === 'config' && selectedNode && (
        <EngagementNodeConfig
          node={selectedNode}
          onChange={(updated) => handleNodeChange(selectedNode.id, updated)}
          onClose={() => { setSelectedNodeId(null); setRightPanel(null); }}
          waitNodeIndex={selectedNode.type === 'wait_for_reply' ? nodes.filter(n => n.type === 'wait_for_reply').indexOf(selectedNode) + 1 : undefined}
          clientId={clientId}
          enrollWebhookToken={enrollWebhookToken}
          selectedNodeId={selectedNodeId}
          textSetterNumber={textSetterNumber}
          onTextSetterChange={setTextSetterNumber}
          setterSlots={setterSlots}
          workflowQuietHoursOverrideEnabled={quietHoursOverrideEnabled}
          onDeleteDrip={selectedNode.type === 'drip' ? () => {
            setNodes(prev => prev.filter(n => n.type !== 'drip'));
            setSelectedNodeId(null);
            setRightPanel(null);
          } : undefined}
          engagementIndex={selectedNode.type === 'engage' ? (() => {
            const engageNodes = nodes.filter(n => n.type === 'engage' || n.type === 'send_sms');
            return engageNodes.findIndex(n => n.id === selectedNode.id);
          })() : undefined}
          engagementCount={nodes.filter(n => n.type === 'engage' || n.type === 'send_sms').length}
          onDeleteEngagement={selectedNode.type === 'engage' ? (() => {
            const engageNodes = nodes.filter(n => n.type === 'engage' || n.type === 'send_sms');
            const idx = engageNodes.findIndex(n => n.id === selectedNode.id);
            if (idx <= 0) return undefined;
            const idsToRemove = new Set<string>();
            const waitNodes = nodes.filter(n => n.type === 'wait_for_reply');
            for (let i = idx; i < engageNodes.length; i++) {
              idsToRemove.add(engageNodes[i].id);
            }
            for (let i = idx - 1; i < waitNodes.length; i++) {
              if (waitNodes[i]) idsToRemove.add(waitNodes[i].id);
            }
            return () => {
              setNodes(prev => prev.filter(n => !idsToRemove.has(n.id)));
              setSelectedNodeId(null);
              setRightPanel(null);
            };
          })() : undefined}
        />
      )}
      {rightPanel === 'executions' && (
        <EngagementExecutionLog
          executions={filteredByNodeExecutions}
          onSelectExecution={handleSelectExecution}
          onClose={() => { setRightPanel(null); setExecutionNodeFilter(null); }}
          onReload={fetchExecutions}
          nodeFilter={executionNodeFilter}
          onClearNodeFilter={() => setExecutionNodeFilter(null)}
        />
      )}
      {rightPanel === 'execution-detail' && selectedExecution && (
        <EngagementExecutionDetail
          execution={selectedExecution}
          nodes={nodes}
          onClose={() => { setSelectedExecution(null); setRightPanel('executions'); }}
          onReload={fetchExecutions}
          onStop={() => handleStop(selectedExecution.id)}
          stopping={stoppingId === selectedExecution.id}
          onPushNow={() => handlePushNow(selectedExecution.id)}
          pushingNow={pushingNowId === selectedExecution.id}
          onPause={() => handlePause(selectedExecution.id)}
          pausing={pausingId === selectedExecution.id}
          onResume={() => handleResume(selectedExecution.id)}
          resuming={resumingId === selectedExecution.id}
        />
      )}

      {/* Start Campaign Dialog */}
      {showCampaignDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-card groove-border flex flex-col" style={{ width: 544, maxWidth: '90vw', maxHeight: '80vh' }}>
            <div className="flex items-center justify-between px-6 shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))', paddingTop: '14px', paddingBottom: '14px' }}>
              <h3 className="text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500 }}>
                START CAMPAIGN
              </h3>
              <button
                className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
                onClick={() => setShowCampaignDialog(false)}
                disabled={campaignLaunching}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="space-y-1">
                <Label className="field-text text-foreground">Contact IDs (one per line)</Label>
                <Textarea
                  value={campaignContactIds}
                  onChange={e => setCampaignContactIds(e.target.value)}
                  placeholder="Paste GHL Contact IDs here, one per line..."
                  className="field-text min-h-[200px]"
                  disabled={campaignLaunching}
                />
              </div>
              {campaignProgress && (
                <div className="groove-border bg-background px-3 py-2.5">
                  <p className="text-foreground" style={fieldStyle}>
                    Enrolling lead {campaignProgress.current} of {campaignProgress.total}...
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 pb-6 flex gap-2 shrink-0">
              <Button
                className="flex-1 groove-btn"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
                onClick={() => setShowCampaignDialog(false)}
                disabled={campaignLaunching}
              >
                CANCEL
              </Button>
              <Button
                className="flex-1 groove-btn-positive"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
                onClick={handleStartCampaign}
                disabled={campaignLaunching || !campaignContactIds.trim()}
              >
                {campaignLaunching ? (
                  <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />ENROLLING...</>
                ) : (
                  <><Rocket className="w-4 h-4 mr-1.5" />START CAMPAIGN</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={(open) => { if (!open) setShowUnsavedDialog(false); }}
        onDiscard={() => {
          setShowUnsavedDialog(false);
          pendingNavigationRef.current?.();
          pendingNavigationRef.current = null;
        }}
      />
      <DeleteConfirmDialog
        open={showDeleteWorkflowDialog}
        onOpenChange={setShowDeleteWorkflowDialog}
        onConfirm={async () => {
          if (!workflow) return;
          try {
            const { error } = await (supabase as any)
              .from('engagement_workflows')
              .delete()
              .eq('id', workflow.id);
            if (error) throw error;
            toast.success('Campaign workflow deleted');
            navigate(`/client/${clientId}/workflows`);
          } catch (err) {
            console.error(err);
            toast.error('Failed to delete workflow');
          }
        }}
        title="Delete Campaign Workflow"
        itemName={workflowName}
        description="This will permanently delete this campaign workflow and all associated analytics dashboards. All campaign data will be lost. This action cannot be undone."
      />
      <DeleteConfirmDialog
        open={showToggleActiveDialog}
        onOpenChange={setShowToggleActiveDialog}
        onConfirm={async () => {
          if (!workflow) return;
          const nextActive = !(workflow as any).is_active;
          // Block activation if any enabled channel is missing required fields. Disabling is always allowed.
          if (nextActive) {
            const validationError = validateEngageNodes(nodes);
            if (validationError) {
              toast.error(validationError);
              setShowToggleActiveDialog(false);
              return;
            }
          }
          const { error } = await (supabase as any)
            .from('engagement_workflows')
            .update({ is_active: nextActive, updated_at: new Date().toISOString() })
            .eq('id', workflow.id);
          if (error) {
            toast.error('Failed to update workflow status');
          } else {
            setWorkflow(prev => prev ? { ...prev, is_active: nextActive } as any : prev);
            toast.success(nextActive ? 'Workflow activated' : 'Workflow disabled');
          }
          setShowToggleActiveDialog(false);
        }}
        title={(workflow as any)?.is_active ? 'Disable Workflow' : 'Enable Workflow'}
        itemName={workflowName}
        confirmLabel={(workflow as any)?.is_active ? 'Disable' : 'Enable'}
        confirmIcon={<Power className="w-4 h-4 mr-2" />}
        description={(workflow as any)?.is_active
          ? 'This will disable the workflow. No new executions will be triggered until it is re-enabled.'
          : 'This will enable the workflow. New executions will be triggered based on your configured enrollment rules.'
        }
      />
      {/* Rename Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle>CAMPAIGN SETTINGS</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="space-y-1">
              <Label className="field-text">Name</Label>
              <Input
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                className="field-text"
                placeholder="e.g. Spring Reactivation"
              />
            </div>
            <div>
              <Label className="field-text text-muted-foreground">Workflow ID</Label>
              <span
                className="cursor-pointer block mt-1"
                title="Click to copy Workflow ID"
                onClick={() => { navigator.clipboard.writeText(workflow?.id || ''); toast.success('Workflow ID copied'); }}
              >
                <StatusTag variant="neutral">{workflow?.id || ''}</StatusTag>
              </span>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowRenameDialog(false)} className="flex-1 groove-btn field-text">CANCEL</Button>
              <Button className="flex-1 groove-btn field-text" onClick={async () => {
                if (!renameValue.trim() || !workflow) return;
                const newName = renameValue.trim();
                const { error } = await (supabase as any)
                  .from('engagement_workflows')
                  .update({ name: newName, updated_at: new Date().toISOString() })
                  .eq('id', workflow.id);
                if (error) { toast.error('Failed to save name'); return; }
                await (supabase as any)
                  .from('engagement_campaigns')
                  .update({ name: newName })
                  .eq('workflow_id', workflow.id);
                setWorkflowName(newName);
                setWorkflow(prev => prev ? { ...prev, name: newName } : prev);
                setShowRenameDialog(false);
                toast.success('Campaign name saved');
              }}><Save className="w-4 h-4 mr-1.5" />SAVE</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
