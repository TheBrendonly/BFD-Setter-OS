import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, type NavigateOptions } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { createClient } from '@supabase/supabase-js';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { getCached, setCache } from '@/lib/queryCache';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useNavigationGuard } from '@/contexts/NavigationGuardContext';
import {
  getCanonicalLeadId,
  buildEditableContactData,
  buildCustomFieldsFromData,
  buildExternalContactSyncPayload,
  createCanonicalLeadId,
  ContactTag as ContactTagType,
} from '@/utils/contactId';
import RetroLoader from '@/components/RetroLoader';
import SavingOverlay from '@/components/SavingOverlay';
import { ContactConversationHistory } from '@/components/contacts/ContactConversationHistory';
import { LeadNotesPanel } from '@/components/contacts/LeadNotesPanel';
import { TagManager } from '@/components/contacts/TagManager';
import { StatusTag } from '@/components/StatusTag';
import { format } from 'date-fns';
import { dispatchChatUnreadSync, hasUnreadMessages } from '@/lib/chatUnread';
import { MessageSquare, FileText, X, User, Loader2, ChevronDown, ChevronUp, Copy, Plus, Save, Filter, Search, AlertTriangle, RefreshCw, Square, Play, ChevronRight, Check, Calendar } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GripVertical } from 'lucide-react';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';

import { useLeadErrorAlert, useLeadsWithErrors } from '@/hooks/useLeadErrorAlert';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import CrmFilterPanel, { CrmFilterConfig } from '@/components/contacts/CrmFilterPanel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { normalizePhone } from '@/lib/normalizePhone';

interface Lead {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  business_name: string | null;
  lead_id: string | null;
  custom_fields: Record<string, any> | null;
  tags: any[] | null;
  created_at: string;
  updated_at: string;
  phone_valid?: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  setter_stopped?: boolean;
}

interface ChatThread {
  lead: Lead;
  lastMessage: string;
  lastTimestamp: string;
  lastMessageType: string;
  unread: boolean;
  channel?: string | null;
}

interface ContactTag {
  id: string;
  name: string;
  color: string;
}

type RightPanel = 'none' | 'details' | 'notes';
type Tab = 'all' | 'unread' | 'starred';

const PixelStarIcon = ({ filled, ...props }: React.SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 1.2}
    shapeRendering="crispEdges"
    aria-hidden="true"
    {...props}
  >
    <rect x="7" y="1" width="2" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="6" y="3" width="4" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="1" y="5" width="14" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="2" y="7" width="12" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="3" y="9" width="10" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="2" y="11" width="4" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="10" y="11" width="4" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="1" y="13" width="3" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
    <rect x="12" y="13" width="3" height="2" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="0.5" />
  </svg>
);

const FIXED_COLUMNS = [
  { key: 'contact_name', label: 'Lead Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'business_name', label: 'Business Name' },
  { key: 'created_at', label: 'Created' },
  { key: 'last_interaction', label: 'Last Interaction' },
  { key: 'tags', label: 'Tags' },
] as const;

const DEFAULT_FILTER_CONFIG: CrmFilterConfig = { hiddenColumns: [], filters: [], tagFilters: [] };
const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;

interface CampaignOption {
  id: string;
  name: string;
}

/** Outbound message sent via engagement campaign */
interface OutboundCampaignMessage {
  lead_id: string;
  channel: string;
  message_body: string;
  occurred_at: string;
  campaign_id: string;
}

export default function Chats() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { credentials, isLoading: credentialsLoading } = useClientCredentials(clientId);
  const { cb } = useCreatorMode();
  const { registerGuard, unregisterGuard } = useNavigationGuard();


  const [leads, setLeads] = useState<Lead[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('chats_tab');
    return saved === 'all' || saved === 'unread' || saved === 'starred' ? saved : 'unread';
  });
  const [starredLeadIds, setStarredLeadIds] = useState<Set<string>>(new Set());
  const [rightPanel, setRightPanel] = useState<RightPanel>(() => {
    const saved = localStorage.getItem('chats_right_panel');
    if (saved === 'details' || saved === 'notes' || saved === 'none') return saved;
    return 'details';
  });
  const [readStatus, setReadStatus] = useState<Record<string, string>>({});
  const [readStatusLoaded, setReadStatusLoaded] = useState(false);
  const readStatusRef = useRef<Record<string, string>>({});
  const readStatusLoadedRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const previousRightPanelRef = useRef<RightPanel>('none');
  const lastOpenedThreadRef = useRef<string | null>(null);
  const [chatFilterConfig, setChatFilterConfig] = useState<CrmFilterConfig>(DEFAULT_FILTER_CONFIG);
  const [filtersReady, setFiltersReady] = useState(false);
  const chatFilterSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notesCount, setNotesCount] = useState(0);
  const [allTags, setAllTags] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<string[]>([]);
  const [contactTagMap, setContactTagMap] = useState<Record<string, { id: string; name: string; color: string }[]>>({});
  // Per-lead error alert (replaces old hasRecentErrors/errorBannerDismissed)
  const selectedLeadGhlId = useMemo(() => {
    if (!selectedLeadId) return null;
    const lead = leads.find(l => l.id === selectedLeadId);
    return lead?.lead_id || selectedLeadId;
  }, [selectedLeadId, leads]);
  const { activeError, dismissError } = useLeadErrorAlert(clientId, selectedLeadGhlId, credentials?.ghl_location_id || null);
  const errorLeadIds = useLeadsWithErrors(clientId, credentials?.ghl_location_id || null);

  // Retry failed execution state
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [retryExecutionId, setRetryExecutionId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [erroredExecutionId, setErroredExecutionId] = useState<string | null>(null);
  const suppressThreadRefreshRef = useRef(false);
  const [stoppingBot, setStoppingBot] = useState(false);
  const [setterStoppedLeads, setSetterStoppedLeads] = useState<Set<string>>(new Set());
  const [detailsDirty, setDetailsDirty] = useState(false);
  const detailsSaveRef = useRef<(() => Promise<void>) | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const requestNavigation = useCallback((action: () => void) => {
    if (detailsDirty && rightPanel === 'details') {
      pendingActionRef.current = action;
      setShowUnsavedDialog(true);
      return;
    }

    action();
  }, [detailsDirty, rightPanel]);

  const safeNavigate = useCallback((path: string, options?: NavigateOptions) => {
    requestNavigation(() => navigate(path, options));
  }, [navigate, requestNavigation]);

  useEffect(() => {
    if (!(detailsDirty && rightPanel === 'details')) {
      unregisterGuard();
      return;
    }

    registerGuard((proceed) => {
      pendingActionRef.current = proceed;
      setShowUnsavedDialog(true);
      return true;
    });

    return () => unregisterGuard();
  }, [detailsDirty, rightPanel, registerGuard, unregisterGuard]);

  // Sync setter_stopped from leads data into the local Set
  useEffect(() => {
    if (leads.length === 0) return;
    const stoppedIds = new Set(leads.filter(l => l.setter_stopped).map(l => l.id));
    setSetterStoppedLeads(stoppedIds);
  }, [leads]);

  // Browser beforeunload when details are dirty
  useEffect(() => {
    if (!detailsDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [detailsDirty]);

  // Campaign filter selector state
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  const [campaignSelectorOpen, setCampaignSelectorOpen] = useState(false);
  const [campaignDragIdx, setCampaignDragIdx] = useState<number | null>(null);
  const [campaignDragOverIdx, setCampaignDragOverIdx] = useState<number | null>(null);
  // Outbound campaign messages (keyed by lead_id)
  const [outboundMessages, setOutboundMessages] = useState<OutboundCampaignMessage[]>([]);
  // Leads enrolled in selected campaign
  const [campaignLeadIds, setCampaignLeadIds] = useState<Set<string> | null>(null);

  // Fetch errored execution for current lead
  useEffect(() => {
    if (!selectedLeadGhlId || !credentials?.ghl_location_id) {
      setErroredExecutionId(null);
      return;
    }
    const fetchErroredExec = async () => {
      try {
        const { data, error } = await supabase
          .from('dm_executions')
          .select('id, status')
          .eq('lead_id', selectedLeadGhlId)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        setErroredExecutionId(data?.status === 'failed' ? data.id : null);
      } catch (err) {
        console.warn('fetchErroredExec failed:', err);
        setErroredExecutionId(null);
      }
    };
    fetchErroredExec();
  }, [selectedLeadGhlId, credentials?.ghl_location_id, activeError]);

  const handleRetryExecution = useCallback(async () => {
    if (!retryExecutionId) return;
    setRetryDialogOpen(false);
    setRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke('retry-dm-execution', {
        body: { execution_id: retryExecutionId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Retrying — new execution created');
      setErroredExecutionId(null);
      dismissError();
      // Suppress thread list reorder for a few seconds to prevent flicker
      suppressThreadRefreshRef.current = true;
      setTimeout(() => { suppressThreadRefreshRef.current = false; }, 8000);
    } catch (err: any) {
      console.error('Retry failed:', err);
      toast.error(err.message || 'Failed to retry execution');
    } finally {
      setRetrying(false);
    }
  }, [retryExecutionId, dismissError]);

  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const isSetterStopped = selectedLeadId ? setterStoppedLeads.has(selectedLeadId) : false;

  const handleToggleSetter = useCallback(async () => {
    if (!selectedLeadId || !clientId) return;
    const requestType = isSetterStopped ? 'Activate' : 'Stop';
    setStoppingBot(true);
    try {
      const { data, error } = await supabase.functions.invoke('stop-bot-webhook', {
        body: { client_id: clientId, contact_id: selectedLeadId, request_type: requestType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (requestType === 'Stop') {
        setSetterStoppedLeads((prev) => new Set(prev).add(selectedLeadId));
        toast.success('Setter stopped for this lead');
      } else {
        setSetterStoppedLeads((prev) => {
          const next = new Set(prev);
          next.delete(selectedLeadId);
          return next;
        });
        toast.success('Setter activated for this lead');
      }
    } catch (err: any) {
      console.error('Toggle setter failed:', err);
      toast.error(err.message || `Failed to ${requestType.toLowerCase()} setter`);
    } finally {
      setStoppingBot(false);
    }
  }, [selectedLeadId, clientId, isSetterStopped]);

  // Persist tab selections
  const handleSetTab = (t: Tab) => { setTab(t); localStorage.setItem('chats_tab', t); };
  const handleSetRightPanel = (p: RightPanel) => { setRightPanel(p); localStorage.setItem('chats_right_panel', p); };
  const guardedSetRightPanel = (p: RightPanel) => {
    if (detailsDirty && rightPanel === 'details' && p !== 'details') {
      pendingActionRef.current = () => { setDetailsDirty(false); handleSetRightPanel(p); };
      setShowUnsavedDialog(true);
    } else {
      handleSetRightPanel(p);
    }
  };

  // Fetch starred conversations
  const fetchStarred = useCallback(async () => {
    if (!clientId) return;
    const { data } = await (supabase as any)
      .from('chat_starred')
      .select('lead_id')
      .eq('client_id', clientId);
    if (data) {
      setStarredLeadIds(new Set(data.map((r: any) => r.lead_id)));
    }
  }, [clientId]);

  const toggleStar = useCallback(async (leadId: string) => {
    if (!clientId) return;
    const isStarred = starredLeadIds.has(leadId);
    // Optimistic update
    setStarredLeadIds(prev => {
      const next = new Set(prev);
      if (isStarred) next.delete(leadId); else next.add(leadId);
      return next;
    });
    if (isStarred) {
      await (supabase as any).from('chat_starred').delete().eq('client_id', clientId).eq('lead_id', leadId);
    } else {
      await (supabase as any).from('chat_starred').upsert({ client_id: clientId, lead_id: leadId }, { onConflict: 'client_id,lead_id' });
    }
  }, [clientId, starredLeadIds]);

  const selectedLead = useMemo(() => leads.find(l => l.id === selectedLeadId) || null, [leads, selectedLeadId]);

  const getLeadName = (lead: Lead) => {
    const first = lead.first_name || '';
    const last = lead.last_name || '';
    if (first || last) return `${first} ${last}`.trim();
    return lead.email || lead.phone || 'Unknown';
  };

  const getLeadExternalId = (lead: Lead) => {
    return getCanonicalLeadId(lead as any) || lead.id;
  };

  const filterColumns = useMemo(() => [
    ...FIXED_COLUMNS.map(column => ({ key: column.key, label: column.label })),
    ...customFieldDefs.map(field => ({ key: `cf_${field}`, label: field })),
  ], [customFieldDefs]);

  // Fetch leads (include last_message_at for unread detection)
  const fetchLeads = useCallback(async () => {
    if (!clientId) return;
    const cacheKey = `chats_leads_${clientId}`;
    const cached = getCached<Lead[]>(cacheKey);
    if (cached && leads.length === 0) setLeads(cached);
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (!error && data) {
      setLeads(data as Lead[]);
      setCache(cacheKey, data as Lead[]);
    }
  }, [clientId]);

  // Fetch read status — merge with existing to avoid overwriting optimistic updates
  const fetchReadStatus = useCallback(async () => {
    if (!clientId) return;
    const cacheKey = `chats_read_${clientId}`;
    const cachedRS = getCached<Record<string, string>>(cacheKey);
    if (cachedRS && !readStatusLoadedRef.current) {
      setReadStatus(cachedRS);
      readStatusRef.current = cachedRS;
      setReadStatusLoaded(true);
      readStatusLoadedRef.current = true;
    }
    const { data } = await (supabase as any)
      .from('chat_read_status')
      .select('lead_id, last_read_at')
      .eq('client_id', clientId);
    if (data) {
      setReadStatus(prev => {
        const merged = { ...prev };
        data.forEach((r: any) => {
          const existing = merged[r.lead_id];
          if (!existing || new Date(r.last_read_at) > new Date(existing)) {
            merged[r.lead_id] = r.last_read_at;
          }
        });
        setCache(cacheKey, merged);
        return merged;
      });
    }
    setReadStatusLoaded(true);
    readStatusLoadedRef.current = true;
  }, [clientId]);

  const cleanPreviewContent = useCallback((raw: string): string => {
    let c = raw || '';
    const match2 = c.match(/^#\s*USER LAST UTTERANCE\s*\n([\s\S]*?)(\n\n#|$)/i);
    if (match2?.[1]?.trim()) c = match2[1].trim();
    const match1 = c.match(/^User last input:\s*\n([\s\S]*?)(\n\nChat history|$)/i);
    if (match1?.[1]?.trim()) c = match1[1].trim();
    c = c.replace(/^#\s*USER\s*INPUT\s*ATTACHMENTS?[\s\S]*/i, '');
    c = c.split(/\n*Chat\s*history\s*with\s*the\s*user:/i)[0];
    c = c.split(/\n*#\s*CHAT\s*HISTORY/i)[0];
    c = c.split(/\n*#\s*USER\s*INPUT\s*ATTACHMENT/i)[0];
    c = c.replace(/^\s*#\s*$/gm, '').trim();
    c = c.replace(/^#+\s*/gm, '').trim();
    return c;
  }, []);

  const parsePreviewMessage = useCallback((rawMessage: unknown): { message: string; type: string } | null => {
    let content = '';
    let msgType = 'assistant';

    if (typeof rawMessage === 'object' && rawMessage !== null) {
      const parsed = rawMessage as Record<string, any>;
      content = parsed.content || parsed.text || '';
      msgType = parsed.role || parsed.type || 'assistant';
    } else if (typeof rawMessage === 'string') {
      try {
        const parsed = JSON.parse(rawMessage);
        content = parsed.content || parsed.text || '';
        msgType = parsed.role || parsed.type || 'assistant';
      } catch {
        content = rawMessage;
      }
    }

    const cleaned = cleanPreviewContent(content);
    if (!cleaned) return null;

    const isInbound = ['human', 'user', 'Human', 'User'].includes(msgType);
    const isBusiness = ['business', 'Business'].includes(msgType);

    return {
      message: cleaned.substring(0, 120),
      type: isInbound ? 'human' : isBusiness ? 'business' : 'assistant',
    };
  }, [cleanPreviewContent]);

  const fetchMissingThreadPreviews = useCallback(async (
    extClient: any,
    sessionIds: string[],
  ): Promise<Record<string, { message: string; type: string; timestamp: string }>> => {
    const uniqueSessionIds = Array.from(new Set(sessionIds.filter(Boolean)));
    const previewBySession: Record<string, { message: string; type: string; timestamp: string }> = {};
    const batchSize = 20;

    for (let i = 0; i < uniqueSessionIds.length; i += batchSize) {
      const batch = uniqueSessionIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (sessionId) => {
          const { data, error } = await extClient
            .from('chat_history')
            .select('session_id, timestamp, message')
            .eq('session_id', sessionId)
            .order('timestamp', { ascending: false })
            .limit(10);

          if (error || !data?.length) {
            if (error) console.error(`Error backfilling thread preview for ${sessionId}:`, error);
            return null;
          }

          for (const row of data) {
            const preview = parsePreviewMessage(row.message);
            if (preview) {
              return {
                sessionId,
                timestamp: row.timestamp,
                message: preview.message,
                type: preview.type,
              };
            }
          }

          return null;
        }),
      );

      for (const result of results) {
        if (!result) continue;
        previewBySession[result.sessionId] = {
          message: result.message,
          type: result.type,
          timestamp: result.timestamp,
        };
      }
    }

    return previewBySession;
  }, [parsePreviewMessage]);

  // Store thread data (message/timestamp) separately from unread status so read-status
  // changes don't trigger expensive external DB fetches.
  const threadDataRef = useRef<ChatThread[]>([]);
  const threadFetchIdRef = useRef(0);

  // Fetch conversations using leads.last_message_preview for instant rendering.
  // fetch-thread-previews is only called when the user opens a specific conversation.
  const fetchThreads = useCallback(async () => {
    const fetchId = ++threadFetchIdRef.current;

    if (leads.length === 0) {
      threadDataRef.current = [];
      setThreads([]);
      setLoading(false);
      return;
    }

    try {
      const leadExternalIds = leads.map(l => getLeadExternalId(l)).filter(Boolean);
      if (leadExternalIds.length === 0) {
        threadDataRef.current = [];
        setThreads([]);
        setLoading(false);
        return;
      }

      const threadCacheKey = `chats_threads_${clientId}`;
      const cachedThreads = getCached<ChatThread[]>(threadCacheKey);
      const previousThreadByLeadId = new Map<string, ChatThread>(
        (threadDataRef.current.length > 0 ? threadDataRef.current : cachedThreads || []).map(thread => [thread.lead.id, thread])
      );

      if (cachedThreads && cachedThreads.length > 0 && threadDataRef.current.length === 0) {
        threadDataRef.current = cachedThreads;
        setThreads(cachedThreads);
        setLoading(false);
      }

      // Build preview map from leads.last_message_preview (instant, no external DB)
      const latestPreviewBySession: Record<string, { message: string; type: string }> = {};
      for (const lead of leads) {
        const extId = getLeadExternalId(lead);
        if (extId && lead.last_message_preview) {
          latestPreviewBySession[extId] = {
            message: cleanPreviewContent(lead.last_message_preview) || lead.last_message_preview.substring(0, 120),
            type: 'human',
          };
        }
      }

      // Fetch pending dm_executions for recent outbound previews
      const latestPendingBySession: Record<string, { message: string; timestamp: string; type: string; channel?: string | null }> = {};
      const dmChunkSize = 200;
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      for (let i = 0; i < leadExternalIds.length; i += dmChunkSize) {
        const chunk = leadExternalIds.slice(i, i + dmChunkSize);
        const { data: dmExecs } = await supabase
          .from('dm_executions')
          .select('lead_id,status,started_at,completed_at,setter_messages,grouped_message,channel')
          .in('lead_id', chunk)
          .gte('started_at', oneDayAgo)
          .order('started_at', { ascending: false });

        for (const exec of dmExecs || []) {
          // setter_messages is a string[] of the setter's outbound reply texts
          // (the "recent outbound preview" source); fall back to the grouped
          // inbound message only when no outbound reply exists yet.
          const setterMessages = Array.isArray((exec as any).setter_messages) ? (exec as any).setter_messages : [];
          const latestText =
            [...setterMessages].reverse().find((m: any) => typeof m === 'string' && m.trim().length > 0) ||
            (typeof (exec as any).grouped_message === 'string' ? (exec as any).grouped_message : '');

          if (!latestText || !latestText.trim()) continue;

          const cleaned = cleanPreviewContent(latestText);
          if (!cleaned) continue;

          const timestamp = exec.completed_at || exec.started_at;
          if (!timestamp) continue;

          const existing = latestPendingBySession[exec.lead_id];
          if (!existing || new Date(timestamp) > new Date(existing.timestamp)) {
            latestPendingBySession[exec.lead_id] = {
              message: cleaned.substring(0, 120),
              timestamp,
              type: 'human',
              channel: (exec as any).channel || null,
            };
          }
        }
      }

      const outboundByLead: Record<string, { message: string; timestamp: string; channel: string }> = {};
      for (const ob of outboundMessages) {
        const existing = outboundByLead[ob.lead_id];
        if (!existing || new Date(ob.occurred_at) > new Date(existing.timestamp)) {
          outboundByLead[ob.lead_id] = {
            message: (ob.message_body || '').substring(0, 120),
            timestamp: ob.occurred_at,
            channel: ob.channel,
          };
        }
      }

      const threadList: ChatThread[] = [];
      for (const lead of leads) {
        const extId = getLeadExternalId(lead);
        const pending = latestPendingBySession[extId];
        const outbound = outboundByLead[extId];
        const leadPreview = latestPreviewBySession[extId];

        const candidates: { ts: string; message: string; type: string; channel?: string | null }[] = [];
        if (leadPreview?.message && lead.last_message_at) {
          candidates.push({ ts: lead.last_message_at, message: leadPreview.message, type: leadPreview.type });
        }
        if (pending) {
          candidates.push({ ts: pending.timestamp, message: pending.message, type: pending.type, channel: pending.channel });
        }
        if (outbound && outbound.message) {
          candidates.push({ ts: outbound.timestamp, message: outbound.message, type: 'campaign_outbound', channel: outbound.channel });
        }

        if (candidates.length === 0) {
          const previousThread = previousThreadByLeadId.get(lead.id);

          if (previousThread) {
            threadList.push({
              ...previousThread,
              lead: { ...previousThread.lead, ...lead },
              lastTimestamp: lead.last_message_at || previousThread.lastTimestamp,
            });
          } else if (lead.last_message_at) {
            threadList.push({
              lead,
              lastMessage: lead.last_message_preview || '',
              lastTimestamp: lead.last_message_at,
              lastMessageType: 'assistant',
              unread: false,
              channel: null,
            });
          }

          continue;
        }

        candidates.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        const best = candidates[0];
        const resolvedChannel = best.channel || pending?.channel || outbound?.channel || null;

        threadList.push({
          lead,
          lastMessage: best.message,
          lastTimestamp: best.ts,
          lastMessageType: best.type,
          unread: false,
          channel: resolvedChannel,
        });
      }

      threadList.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
      threadDataRef.current = threadList;

      const rs = readStatusRef.current;
      const rsLoaded = readStatusLoadedRef.current;
      const withUnread = threadList.map(t => {
        if (!rsLoaded) return { ...t, unread: false };
        const lastReadAt = rs[t.lead.id];
        const lastMessageAt = t.lead.last_message_at;
        const unread = hasUnreadMessages(lastMessageAt, lastReadAt);
        return { ...t, unread };
      });

      if (fetchId !== threadFetchIdRef.current) return;

      threadDataRef.current = withUnread;
      setThreads(withUnread);
      setCache(`chats_threads_${clientId}`, withUnread);
    } catch (err) {
      console.error('Error fetching chat threads:', err);
    } finally {
      if (fetchId === threadFetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [clientId, leads, cleanPreviewContent, outboundMessages, starredLeadIds]);

  // Apply read status using leads.last_message_at vs chat_read_status.last_read_at
  const applyUnreadStatus = useCallback((threadList?: ChatThread[]) => {
    const data = threadList || threadDataRef.current;
    if (data.length === 0) return;
    const updated = data.map(t => {
      // Don't mark anything unread until we've loaded the read status from DB
      if (!readStatusLoaded) return { ...t, unread: false };
      const lastReadAt = readStatus[t.lead.id];
      const lastMessageAt = t.lead.last_message_at;
      const unread = hasUnreadMessages(lastMessageAt, lastReadAt);
      return { ...t, unread };
    });
    threadDataRef.current = updated;
    setThreads(updated);
  }, [readStatus, readStatusLoaded]);

  // Keep refs in sync with state
  useEffect(() => {
    readStatusRef.current = readStatus;
  }, [readStatus]);

  // Re-apply unread status when readStatus changes (cheap, no DB call)
  useEffect(() => {
    if (threadDataRef.current.length > 0) {
      applyUnreadStatus();
    }
  }, [readStatus, applyUnreadStatus]);

  useEffect(() => {
    fetchLeads();
    fetchReadStatus();
    fetchStarred();
    // Load saved chat filter config — must always set filtersReady,
    // even on RLS denial / network error, or render hangs forever on RetroLoader.
    if (clientId) {
      supabase
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.warn('chat filter config load failed:', error);
          } else {
            const config = (data as any)?.crm_filter_config;
            if (config?.chat_filter && typeof config.chat_filter === 'object') {
              setChatFilterConfig(prev => ({ ...DEFAULT_FILTER_CONFIG, ...config.chat_filter }));
            }
          }
          setFiltersReady(true);
        }, (err) => {
          console.warn('chat filter config rejected:', err);
          setFiltersReady(true);
        });
    } else {
      setFiltersReady(true);
    }
  }, [fetchLeads, fetchReadStatus, fetchStarred, clientId]);

  // Fetch notes count for selected lead
  const fetchNotesCount = useCallback(async () => {
    if (!selectedLeadId || !clientId) { setNotesCount(0); return; }
    const { count } = await (supabase as any)
      .from('lead_notes')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', selectedLeadId)
      .eq('client_id', clientId);
    setNotesCount(count || 0);
  }, [selectedLeadId, clientId]);

  useEffect(() => { fetchNotesCount(); }, [fetchNotesCount]);

  useEffect(() => {
    if (!clientId) return;
    // Tags
    supabase
      .from('lead_tag_assignments')
      .select('lead_id, tag_id, lead_tags(id, name, color, sort_order)')
      .then(({ data }) => {
        if (data) {
          const map: Record<string, { id: string; name: string; color: string }[]> = {};
          data.forEach((d: any) => {
            if (!d.lead_tags) return;
            if (!map[d.lead_id]) map[d.lead_id] = [];
            map[d.lead_id].push({ id: d.lead_tags.id, name: d.lead_tags.name, color: d.lead_tags.color || '#6366f1' });
          });
          setContactTagMap(map);
        }
      });
    supabase
      .from('lead_tags' as any)
      .select('*')
      .eq('client_id', clientId)
      .then(({ data }: any) => {
        if (data) setAllTags(data.map((t: any) => ({ id: t.id, name: t.name, color: t.color })));
      });
    // Custom fields
    (supabase as any)
      .from('client_custom_fields')
      .select('field_name, sort_order')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })
      .then(({ data }: any) => {
        if (data) setCustomFieldDefs(data.map((d: any) => d.field_name));
      });
  }, [clientId]);

  // Fetch engagement campaigns for the campaign filter — must always set
  // campaignsLoaded=true (even on error) or the page hangs on RetroLoader.
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      try {
        const [{ data: campaignsData }, { data: clientData }] = await Promise.all([
          (supabase as any)
            .from('engagement_campaigns')
            .select('id, name, workflow_id')
            .eq('client_id', clientId)
            .not('workflow_id', 'is', null)
            .order('created_at', { ascending: false }),
          (supabase as any)
            .from('clients_public')
            .select('crm_filter_config')
            .eq('id', clientId)
            .single(),
        ]);
        const savedOrder: string[] | undefined = clientData?.crm_filter_config?.conversations_campaign_order;
        let opts: CampaignOption[] = (campaignsData || []).map((c: any) => ({ id: c.id, name: c.name }));
        if (savedOrder && savedOrder.length > 0) {
          const map = new Map(opts.map(o => [o.id, o]));
          const ordered: CampaignOption[] = [];
          for (const id of savedOrder) {
            const item = map.get(id);
            if (item) { ordered.push(item); map.delete(id); }
          }
          map.forEach(v => ordered.push(v));
          opts = ordered;
        }
        setCampaigns(opts);
        // Restore last selected campaign
        const lastCampaign = clientData?.crm_filter_config?.last_conversations_campaign;
        if (lastCampaign && opts.some(o => o.id === lastCampaign)) {
          setSelectedCampaignId(lastCampaign);
        }
      } catch (err) {
        console.warn('campaigns load failed:', err);
        setCampaigns([]);
      } finally {
        setCampaignsLoaded(true);
      }
    })();
  }, [clientId]);

  // Fetch outbound campaign messages + campaign lead IDs when campaign is selected
  useEffect(() => {
    if (!clientId) return;

    // Fetch ALL outbound messages for thread population (regardless of campaign filter)
    (async () => {
      const { data } = await (supabase as any)
        .from('campaign_events')
        .select('lead_id, channel, metadata, occurred_at, campaign_id')
        .eq('client_id', clientId)
        .eq('event_type', 'message_sent')
        .order('occurred_at', { ascending: false });
      if (data) {
        setOutboundMessages(data.map((e: any) => ({
          lead_id: e.lead_id,
          channel: e.channel || 'sms',
          message_body: e.metadata?.message_body || '',
          occurred_at: e.occurred_at,
          campaign_id: e.campaign_id,
        })));
      }
    })();
  }, [clientId]);

  // When campaign selection changes, compute the enrolled lead IDs
  useEffect(() => {
    if (selectedCampaignId === 'all' || !clientId) {
      setCampaignLeadIds(null);
      return;
    }
    (async () => {
      const { data } = await (supabase as any)
        .from('campaign_events')
        .select('lead_id')
        .eq('campaign_id', selectedCampaignId)
        .eq('client_id', clientId);
      if (data) {
        setCampaignLeadIds(new Set(data.map((e: any) => e.lead_id)));
      }
    })();
  }, [selectedCampaignId, clientId]);

  const persistCampaignSelection = useCallback(async (campaignId: string) => {
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
        .update({ crm_filter_config: { ...config, last_conversations_campaign: campaignId } })
        .eq('id', clientId);
    } catch { /* ignore */ }
  }, [clientId]);

  const persistCampaignOrder = useCallback(async (order: string[]) => {
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
        .update({ crm_filter_config: { ...config, conversations_campaign_order: order } })
        .eq('id', clientId);
    } catch { /* ignore */ }
  }, [clientId]);

  const handleCampaignSelect = useCallback((campaignId: string) => {
    setCampaignSelectorOpen(false);
    setSelectedCampaignId(campaignId);
    persistCampaignSelection(campaignId);
  }, [persistCampaignSelection]);

  const handleCampaignDragStart = (event: React.DragEvent, idx: number) => {
    setCampaignDragIdx(idx);
    event.dataTransfer.effectAllowed = 'move';
  };
  const handleCampaignDragOver = (event: React.DragEvent, idx: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setCampaignDragOverIdx(idx);
  };
  const handleCampaignDrop = (event: React.DragEvent, idx: number) => {
    event.preventDefault();
    if (campaignDragIdx === null || campaignDragIdx === idx) {
      setCampaignDragIdx(null);
      setCampaignDragOverIdx(null);
      return;
    }
    const updated = [...campaigns];
    const [moved] = updated.splice(campaignDragIdx, 1);
    updated.splice(idx, 0, moved);
    setCampaigns(updated);
    setCampaignDragIdx(null);
    setCampaignDragOverIdx(null);
    persistCampaignOrder(updated.map(c => c.id));
  };
  const handleCampaignDragEnd = () => {
    setCampaignDragIdx(null);
    setCampaignDragOverIdx(null);
  };

  useEffect(() => {
    if (leads.length > 0 && !credentialsLoading && readStatusLoaded) {
      fetchThreads();
    }
  }, [leads, credentialsLoading, readStatusLoaded, fetchThreads]);

  // Poll: leads/read-status every 5s, threads every 10s
  useEffect(() => {
    if (credentialsLoading || !readStatusLoaded) return;
    const leadsInterval = setInterval(fetchLeads, 5000);
    const readInterval = setInterval(fetchReadStatus, 5000);
    const threadInterval = setInterval(() => {
      fetchLeads();
      if (!suppressThreadRefreshRef.current) fetchThreads();
    }, 10000);
    return () => { clearInterval(leadsInterval); clearInterval(readInterval); clearInterval(threadInterval); };
  }, [credentialsLoading, readStatusLoaded, fetchLeads, fetchReadStatus, fetchThreads]);

  // Realtime subscription on chat_read_status to instantly clear unread
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase.channel(`chats-read-${clientId}`).on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table: 'chat_read_status', filter: `client_id=eq.${clientId}` },
      (payload: any) => {
        const leadId = payload.new?.lead_id;
        const lastReadAt = payload.new?.last_read_at;
        if (leadId && lastReadAt) {
          setReadStatus(prev => ({ ...prev, [leadId]: lastReadAt }));
        }
      }
    ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;

    const channel = supabase.channel(`chats-leads-${clientId}`).on(
      'postgres_changes' as any,
      { event: 'UPDATE', schema: 'public', table: 'leads', filter: `client_id=eq.${clientId}` },
      (payload: any) => {
        const nextLead = payload.new as Lead | undefined;
        const previousLead = payload.old as Partial<Lead> | undefined;

        if (!nextLead?.id || nextLead.last_message_at === previousLead?.last_message_at) return;

        // During retry, suppress reordering and unread changes
        if (suppressThreadRefreshRef.current) return;

        setLeads(prev => {
          const index = prev.findIndex(lead => lead.id === nextLead.id);
          if (index === -1) return prev;

          const updated = [...prev];
          updated[index] = { ...updated[index], ...nextLead };
          return updated;
        });

        setThreads(prev => {
          const updated = prev
            .map(thread => {
              if (thread.lead.id !== nextLead.id) return thread;

              const mergedLead = { ...thread.lead, ...nextLead };
              const updatedTimestamp = mergedLead.last_message_at && new Date(mergedLead.last_message_at) > new Date(thread.lastTimestamp)
                ? mergedLead.last_message_at
                : thread.lastTimestamp;

              const updatedPreview = mergedLead.last_message_preview || thread.lastMessage;

              return {
                ...thread,
                lead: mergedLead,
                lastMessage: updatedPreview,
                lastTimestamp: updatedTimestamp,
                unread: readStatusLoadedRef.current
                  ? hasUnreadMessages(mergedLead.last_message_at, readStatusRef.current[mergedLead.id])
                  : false,
              };
            })
            .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());

          threadDataRef.current = updated;
          return updated;
        });
      }
    ).subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  // Mark conversation as read when selected
  const markAsRead = useCallback(async (leadId: string) => {
    if (!clientId) return;
    const thread = threadDataRef.current.find(t => t.lead.id === leadId);
    const readAt = thread?.lead.last_message_at || new Date().toISOString();
    lastOpenedThreadRef.current = leadId;

    setReadStatus(prev => {
      const existing = prev[leadId];
      if (existing && new Date(existing) >= new Date(readAt)) return prev;
      return { ...prev, [leadId]: readAt };
    });
    setThreads(prev => prev.map(t => t.lead.id === leadId ? { ...t, unread: false } : t));

    await (supabase as any)
      .from('chat_read_status')
      .upsert({
        client_id: clientId,
        lead_id: leadId,
        last_read_at: readAt,
      }, { onConflict: 'client_id,lead_id' });
  }, [clientId]);

  const handleSelectThread = useCallback((leadId: string) => {
    if (selectedLeadId && selectedLeadId !== leadId) {
      if (detailsDirty) {
        pendingActionRef.current = () => { setDetailsDirty(false); markAsRead(selectedLeadId); setSelectedLeadId(leadId); };
        setShowUnsavedDialog(true);
        return;
      }
      markAsRead(selectedLeadId);
    }
    setSelectedLeadId(leadId);
  }, [markAsRead, selectedLeadId, detailsDirty]);

  // Mark current thread as read when leaving the page (unmount)
  const selectedLeadIdRef = useRef(selectedLeadId);
  useEffect(() => { selectedLeadIdRef.current = selectedLeadId; }, [selectedLeadId]);
  useEffect(() => {
    return () => {
      if (selectedLeadIdRef.current) {
        markAsRead(selectedLeadIdRef.current);
      }
    };
  }, [markAsRead]);

  // Error checking is now handled by useLeadErrorAlert hook above

  // Helper to get a field value from a lead for filtering
  const getThreadFieldValue = useCallback((thread: ChatThread, field: string): string => {
    switch (field) {
      case 'contact_name': return getLeadName(thread.lead);
      case 'phone': return thread.lead.phone || '';
      case 'email': return thread.lead.email || '';
      case 'business_name': return thread.lead.business_name || '';
      case 'created_at':
        return new Date(thread.lead.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      case 'last_interaction':
        return thread.lastTimestamp
          ? new Date(thread.lastTimestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
          : '—';
      default:
        if (field.startsWith('cf_')) {
          const val = thread.lead.custom_fields?.[field.slice(3)];
          return val != null ? String(val) : '—';
        }
        return '';
    }
  }, []);

  const applyNonTabThreadFilters = useCallback((threadList: ChatThread[]) => {
    let filtered = threadList;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t => {
        const name = getLeadName(t.lead).toLowerCase();
        const phone = (t.lead.phone || '').toLowerCase();
        const email = (t.lead.email || '').toLowerCase();
        const leadId = (t.lead.lead_id || t.lead.id || '').toLowerCase();
        const business = (t.lead.business_name || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || email.includes(q) || leadId.includes(q) || business.includes(q);
      });
    }

    for (const filter of chatFilterConfig.filters) {
      if (!filter.field) continue;
      filtered = filtered.filter(t => {
        const val = getThreadFieldValue(t, filter.field).toLowerCase();
        const fv = filter.value.toLowerCase();
        switch (filter.operator) {
          case 'contains': return val.includes(fv);
          case 'not_contains': return !val.includes(fv);
          case 'equals': return val === fv;
          case 'not_equals': return val !== fv;
          case 'starts_with': return val.startsWith(fv);
          case 'ends_with': return val.endsWith(fv);
          case 'is_empty': return !val || val === '—';
          case 'is_not_empty': return !!val && val !== '—';
          default: return true;
        }
      });
    }

    if (chatFilterConfig.tagFilters.length > 0) {
      filtered = filtered.filter(t => {
        const tags = contactTagMap[t.lead.id] || [];
        return chatFilterConfig.tagFilters.some(tagId => tags.some(tag => tag.id === tagId));
      });
    }

    const statusFilters = chatFilterConfig.statusFilters || [];
    if (statusFilters.length === 1) {
      if (statusFilters[0] === 'has_errors') {
        filtered = filtered.filter(t => errorLeadIds.has(t.lead.lead_id || t.lead.id));
      } else if (statusFilters[0] === 'no_errors') {
        filtered = filtered.filter(t => !errorLeadIds.has(t.lead.lead_id || t.lead.id));
      }
    }

    const channelFilters = chatFilterConfig.channelFilters || [];
    if (channelFilters.length > 0) {
      filtered = filtered.filter(t => {
        const ch = (t.channel || '').toLowerCase();
        return channelFilters.some(f => ch.includes(f.toLowerCase()));
      });
    }

    return filtered;
  }, [searchQuery, chatFilterConfig, contactTagMap, getThreadFieldValue, errorLeadIds, getLeadName]);

  // Filter threads
  const filteredThreads = useMemo(() => {
    let filtered = threads;

    if (campaignLeadIds) {
      filtered = filtered.filter(t => {
        const extId = t.lead.lead_id || t.lead.id;
        return campaignLeadIds.has(extId);
      });
    }

    if (tab === 'unread') {
      filtered = filtered.filter(t => t.unread);
    } else if (tab === 'starred') {
      filtered = filtered.filter(t => starredLeadIds.has(t.lead.id));
      const threadLeadIds = new Set(filtered.map(t => t.lead.id));
      for (const lead of leads) {
        if (starredLeadIds.has(lead.id) && !threadLeadIds.has(lead.id)) {
          filtered.push({
            lead,
            lastMessage: '',
            lastTimestamp: lead.last_message_at || lead.created_at,
            lastMessageType: 'assistant',
            unread: false,
            channel: null,
          });
        }
      }
      filtered.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    }

    return applyNonTabThreadFilters(filtered);
  }, [threads, tab, starredLeadIds, campaignLeadIds, leads, applyNonTabThreadFilters]);

  // Global unread count (across ALL campaigns) — used for sidebar indicator
  const globalUnreadCount = useMemo(() => {
    return applyNonTabThreadFilters(threads.filter(t => t.unread)).length;
  }, [threads, applyNonTabThreadFilters]);

  // Campaign-scoped unread count — used for the UNREAD tab badge
  const unreadCount = useMemo(() => {
    let source = threads;
    if (campaignLeadIds) {
      source = source.filter(t => campaignLeadIds.has(t.lead.lead_id || t.lead.id));
    }
    source = source.filter(t => t.unread);
    return applyNonTabThreadFilters(source).length;
  }, [threads, campaignLeadIds, applyNonTabThreadFilters]);

  // Per-campaign unread counts for dropdown indicators
  const campaignUnreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (campaigns.length === 0) return counts;
    // Build a map of lead_id -> campaign_ids from outbound messages
    const leadToCampaigns: Record<string, Set<string>> = {};
    outboundMessages.forEach(msg => {
      if (!leadToCampaigns[msg.lead_id]) leadToCampaigns[msg.lead_id] = new Set();
      leadToCampaigns[msg.lead_id].add(msg.campaign_id);
    });
    const unreadThreads = applyNonTabThreadFilters(threads.filter(t => t.unread));
    unreadThreads.forEach(t => {
      const leadId = t.lead.lead_id || t.lead.id;
      const cids = leadToCampaigns[leadId];
      if (cids) cids.forEach(cid => { counts[cid] = (counts[cid] || 0) + 1; });
    });
    return counts;
  }, [threads, campaigns, outboundMessages, applyNonTabThreadFilters]);

  // Sidebar unread indicator always reflects GLOBAL state (not campaign-scoped)
  useEffect(() => {
    if (!clientId) return;
    dispatchChatUnreadSync({ clientId, hasUnread: globalUnreadCount > 0 });
  }, [clientId, globalUnreadCount]);

  const containerClass = rightPanel !== 'none' ? 'max-w-[1600px]' : 'max-w-7xl';

  const activeFilterCount = chatFilterConfig.filters.length + chatFilterConfig.tagFilters.length + (chatFilterConfig.statusFilters?.length || 0) + (chatFilterConfig.channelFilters?.length || 0) + chatFilterConfig.hiddenColumns.length;

  const selectedCampaignName = selectedCampaignId === 'all'
    ? 'All Leads'
    : campaigns.find(c => c.id === selectedCampaignId)?.name || 'All Leads';

  const searchFilterExtra = (
    <div className="flex items-center ml-4" style={{ gap: '12px' }}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search leads..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-10 !h-8 w-[210px]"
        />
      </div>
      <button
        className="groove-btn flex items-center justify-center !h-8 !w-8 !p-0 relative shrink-0"
        title="Filters"
        onClick={() => {
          if (showFilterPanel) {
            setShowFilterPanel(false);
            if (previousRightPanelRef.current !== 'none') {
              handleSetRightPanel(previousRightPanelRef.current);
            }
          } else {
            if (detailsDirty && rightPanel === 'details') {
              pendingActionRef.current = () => { setDetailsDirty(false); previousRightPanelRef.current = rightPanel; handleSetRightPanel('none'); setShowFilterPanel(true); };
              setShowUnsavedDialog(true);
            } else {
              previousRightPanelRef.current = rightPanel;
              if (rightPanel !== 'none') handleSetRightPanel('none');
              setShowFilterPanel(true);
            }
          }
        }}
      >
        <Filter className="w-4 h-4" />
        {activeFilterCount > 0 && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
        )}
      </button>
      {/* Campaign selector */}
      {campaigns.length > 0 && (
        <Popover open={campaignSelectorOpen} onOpenChange={setCampaignSelectorOpen}>
          <PopoverTrigger asChild>
            <button
              className="relative flex h-8 items-center bg-card px-3 text-foreground transition-colors hover:bg-accent/50 groove-border"
              style={{
                ...FONT,
                textTransform: 'uppercase',
                fontWeight: 400,
                letterSpacing: '1px',
                minWidth: '140px',
                paddingRight: '32px',
              }}
            >
              <span className="truncate">{selectedCampaignName}</span>
              <span className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' as const }}>
                  <rect x="7" y="9" width="2" height="2" />
                  <rect x="9" y="11" width="2" height="2" />
                  <rect x="11" y="13" width="2" height="2" />
                  <rect x="13" y="11" width="2" height="2" />
                  <rect x="15" y="9" width="2" height="2" />
                </svg>
              </span>
              {/* Unread indicator on campaign selector — shows when global unread > 0 */}
              {globalUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
              )}
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
              {/* All Leads option */}
              <button
                onClick={() => handleCampaignSelect('all')}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer",
                  selectedCampaignId === 'all'
                    ? 'bg-accent/50 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
                )}
                style={{ ...FONT, fontWeight: 400 }}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", selectedCampaignId === 'all' ? "opacity-100" : "opacity-0")} />
                <span className="truncate flex-1">All Leads</span>
              </button>
              {/* Campaign options */}
              {campaigns.map((campaign, idx) => (
                <button
                  key={campaign.id}
                  onClick={() => handleCampaignSelect(campaign.id)}
                  draggable
                  onDragStart={(event) => handleCampaignDragStart(event, idx)}
                  onDragOver={(event) => handleCampaignDragOver(event, idx)}
                  onDrop={(event) => handleCampaignDrop(event, idx)}
                  onDragEnd={handleCampaignDragEnd}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer",
                    selectedCampaignId === campaign.id
                      ? 'bg-accent/50 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                    campaignDragOverIdx === idx && campaignDragIdx !== idx && 'border-t-2 border-primary'
                  )}
                  style={{ ...FONT, fontWeight: 400 }}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", selectedCampaignId === campaign.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate flex-1">{campaign.name}</span>
                  {(campaignUnreadCounts[campaign.id] || 0) > 0 && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                  )}
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-40 cursor-grab" />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );

  usePageHeader({
    containerClassName: containerClass,
    title: 'CONVERSATIONS',
    breadcrumbs: [{ label: 'CONVERSATIONS' }],
    leftExtra: searchFilterExtra,
    actions: selectedLead ? [
      ...(erroredExecutionId && activeError ? [{
        label: 'RETRY',
        icon: <RefreshCw className="w-4 h-4" />,
        onClick: () => { setRetryExecutionId(erroredExecutionId); setRetryDialogOpen(true); },
        variant: 'destructive' as const,
        className: 'groove-btn groove-btn-destructive',
      }] : []),
      {
        label: stoppingBot ? (isSetterStopped ? 'ACTIVATING...' : 'STOPPING...') : (isSetterStopped ? 'ACTIVATE SETTER' : 'STOP SETTER'),
        icon: stoppingBot ? <Loader2 className="w-4 h-4 animate-spin" /> : (isSetterStopped ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />),
        onClick: () => setShowStopConfirm(true),
        className: isSetterStopped ? 'groove-btn-pulse' : 'groove-btn',
        disabled: stoppingBot,
      },
      ...(detailsDirty && rightPanel === 'details' ? [{
        label: 'SAVE',
        icon: <Save className="w-4 h-4" />,
        onClick: () => { detailsSaveRef.current?.(); },
        className: 'groove-btn-positive',
      }] : []),
      ...(rightPanel !== 'none' ? [{
        label: rightPanel === 'details' ? 'CLOSE DETAILS' : 'CLOSE NOTES',
        icon: <X className="w-4 h-4" />,
        onClick: () => {
          if (detailsDirty && rightPanel === 'details') {
            pendingActionRef.current = () => { setDetailsDirty(false); handleSetRightPanel('none'); };
            setShowUnsavedDialog(true);
          } else {
            handleSetRightPanel('none');
          }
        },
        className: 'groove-btn',
      }] : [
        {
          label: 'OPEN LEAD',
          icon: <User className="w-4 h-4" />,
          onClick: () => handleSetRightPanel('details'),
          className: 'groove-btn',
        },
      ]),
    ] : [],
  }, [rightPanel, selectedLeadId, searchQuery, activeFilterCount, showFilterPanel, erroredExecutionId, activeError, isSetterStopped, stoppingBot, selectedCampaignId, selectedCampaignName, campaigns, campaignSelectorOpen, campaignDragIdx, campaignDragOverIdx, globalUnreadCount, campaignUnreadCounts, detailsDirty]);

  if (credentialsLoading || loading || !filtersReady || !campaignsLoaded) {
    return <RetroLoader />;
  }

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return format(d, 'h:mm a');
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return format(d, 'EEE');
      return format(d, 'MMM d');
    } catch { return ''; }
  };

  return (
    <div className="h-full min-h-0 overflow-hidden bg-background flex flex-col">
      <div className={`container mx-auto flex flex-col h-full min-h-0 pt-6 ${containerClass}`} style={{ paddingBottom: '24px' }}>
        <div className="flex gap-6 flex-1 min-h-0 overflow-hidden relative">

          {/* Left Column - Chat List */}
          <div className="w-80 shrink-0 groove-border bg-card flex flex-col min-h-0 overflow-hidden">
            {/* Tabs - Unread first */}
            <div className="flex border-b border-dashed border-border shrink-0">
              <button
                onClick={() => handleSetTab('unread')}
                className={`ibm-spacing-allow flex-1 py-2.5 text-center font-medium transition-colors flex items-center justify-center gap-1.5 uppercase ${
                  tab === 'unread' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, letterSpacing: '2px' }}
              >
                UNREAD
                {unreadCount > 0 && (
                  <span className="inline-flex h-[18px] w-fit items-center justify-center rounded-full bg-primary text-primary-foreground leading-none text-center" style={{ fontSize: '11px', fontWeight: 500, letterSpacing: '0em', padding: '0 5px 0 5px' }}>
                    {unreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => handleSetTab('all')}
                className={`ibm-spacing-allow flex-1 py-2.5 text-center font-medium transition-colors uppercase ${
                  tab === 'all' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, letterSpacing: '2px' }}
              >
                ALL
              </button>
              <button
                onClick={() => handleSetTab('starred')}
                className={`ibm-spacing-allow flex-1 py-2.5 text-center font-medium transition-colors flex items-center justify-center gap-1.5 uppercase ${
                  tab === 'starred' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, letterSpacing: '2px' }}
              >
                STARRED
              </button>
            </div>

      {/* Unsaved Changes Dialog */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={(open) => { if (!open) { setShowUnsavedDialog(false); pendingActionRef.current = null; } }}
        onDiscard={() => {
          const pendingAction = pendingActionRef.current;
          pendingActionRef.current = null;
          setShowUnsavedDialog(false);
          setDetailsDirty(false);
          pendingAction?.();
        }}
        description="You have unsaved contact changes. Do you want to discard them or continue editing?"
      />

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: 'none' }}>
              {filteredThreads.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center px-4" style={{ height: 'calc(100% + 40px)', marginTop: '-40px' }}>
                  <MessageSquare className="w-12 h-12 text-primary mb-4" />
                  <h3 className="text-lg font-medium">
                    {selectedCampaignId !== 'all' ? 'No leads' : tab === 'unread' ? 'Nothing new' : tab === 'starred' ? 'No starred leads' : 'No leads'}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedCampaignId !== 'all'
                      ? 'No leads have been enrolled in this campaign yet.'
                      : tab === 'unread'
                        ? 'All caught up!'
                        : tab === 'starred'
                          ? 'Star leads to find them quickly.'
                          : !credentials?.supabase_url
                            ? 'Configure Supabase credentials to view leads.'
                            : 'Leads will appear here when messages are sent or received.'}
                  </p>
                </div>
              ) : (
                filteredThreads.map((thread, idx) => (
                  (() => {
                    const threadLeadGhlId = thread.lead.lead_id || thread.lead.id;
                    const hasError = errorLeadIds.has(threadLeadGhlId);
                    return (
                  <div
                    key={thread.lead.id}
                    className={`p-3 flex items-center gap-3 cursor-pointer transition-colors
                      ${idx < filteredThreads.length - 1 ? 'border-b border-border/50' : ''}
                      ${selectedLeadId === thread.lead.id ? 'bg-primary/10 border-l-2 border-l-primary' : hasError ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/30'}`}
                    onClick={() => handleSelectThread(thread.lead.id)}
                  >
                    <div className="w-4 shrink-0 flex flex-col items-center justify-center gap-1">
                      {starredLeadIds.has(thread.lead.id) && (
                        <PixelStarIcon filled className="shrink-0" style={{ width: '10px', height: '10px', color: '#facc15' }} />
                      )}
                      {hasError && (
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                      )}
                      {thread.unread && (
                        <div className="w-2 h-2 rounded-[1px] bg-primary" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className={`truncate field-text ${thread.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'} ${cb}`}>
                            {getLeadName(thread.lead)}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                          {formatTimestamp(thread.lastTimestamp)}
                        </span>
                      </div>
                      <div className={`flex items-center gap-1.5 text-[13px] mt-0.5 ${thread.unread ? 'text-foreground/80' : 'text-muted-foreground'}`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        <span className="truncate min-w-0 flex-1">
                          {thread.lastMessageType === 'human'
                            ? `Lead: ${thread.lastMessage}`
                            : thread.lastMessageType === 'campaign_outbound'
                              ? `Campaign: ${thread.lastMessage}`
                              : `${thread.lastMessageType === 'business' ? 'You' : 'Setter'}: ${thread.lastMessage}`}
                        </span>
                        {thread.channel && thread.lastMessageType !== 'campaign_outbound' && (() => {
                          const rawCh = thread.channel?.toLowerCase() || '';
                          const ch = rawCh.includes('whatsapp') ? 'WhatsApp'
                            : rawCh.includes('instagram') ? 'Instagram'
                            : rawCh.includes('facebook') || rawCh.includes('messenger') ? 'Facebook'
                            : rawCh.includes('linkedin') ? 'LinkedIn'
                            : rawCh.includes('live_chat') || rawCh.includes('livechat') || rawCh.includes('webchat') ? 'Chat'
                            : rawCh.includes('email') ? 'Email'
                            : rawCh.includes('imessage') ? 'iMessage'
                            : 'SMS';
                          return (
                            <span className="shrink-0 ml-auto inline-flex items-center px-1 py-px rounded-sm bg-foreground/10 text-[11px] text-foreground/50 normal-case" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, lineHeight: 1.2 }}>
                              {ch}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                    );
                  })()
                ))
              )}
            </div>
          </div>

          {/* Middle Column - Conversation */}
          <div className="flex-1 groove-border bg-card flex flex-col min-h-0 overflow-hidden relative">
            {selectedLead ? (
              <>
                {/* Contact header */}
                <div className="p-3 border-b border-dashed border-border flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left rounded-sm transition-colors hover:bg-muted/30 focus-visible:outline-none"
                    onClick={() => safeNavigate(`/client/${clientId}/leads/${selectedLead.id}`)}
                    title="Open lead details"
                  >
                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                       <span className={`text-foreground font-medium field-text ${cb}`}>
                        {(getLeadName(selectedLead))[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  </button>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className={`font-medium text-foreground field-text hover:underline cursor-pointer bg-transparent border-none p-0 ${cb}`}
                        onClick={() => safeNavigate(`/client/${clientId}/leads/${selectedLead.id}`)}
                        title="Open lead details"
                      >
                        {getLeadName(selectedLead)}
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors p-0 bg-transparent border-none cursor-pointer"
                        title="Copy name"
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(getLeadName(selectedLead)); toast.success('Name copied'); }}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className={`text-muted-foreground field-text text-[11px] ${cb}`}>
                        {selectedLead.phone || selectedLead.email || 'No contact info'}
                      </p>
                      {(selectedLead.phone || selectedLead.email) && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors p-0 bg-transparent border-none cursor-pointer"
                          title="Copy contact"
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedLead.phone || selectedLead.email || ''); toast.success('Copied'); }}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Lead ID */}
                   <div className="ml-auto shrink-0 flex items-center gap-2">
                    {/* Star button */}
                    <button
                      type="button"
                      className="p-1 bg-transparent border-none cursor-pointer transition-colors hover:scale-110"
                      title={starredLeadIds.has(selectedLead.id) ? 'Unstar conversation' : 'Star conversation'}
                      onClick={(e) => { e.stopPropagation(); toggleStar(selectedLead.id); }}
                    >
                      <PixelStarIcon
                        filled={starredLeadIds.has(selectedLead.id)}
                        className="w-4.5 h-4.5"
                        style={{ width: '13px', height: '13px', color: starredLeadIds.has(selectedLead.id) ? '#facc15' : 'hsl(var(--muted-foreground))' }}
                      />
                    </button>
                    {selectedLead.lead_id && (
                      <span
                        className="cursor-pointer"
                        title="Click to copy Lead ID"
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedLead.lead_id || ''); toast.success('Lead ID copied'); }}
                      >
                        <StatusTag variant="neutral">ID: {selectedLead.lead_id}</StatusTag>
                      </span>
                    )}
                  </div>
                </div>

                {/* Error warning banner */}
                {activeError && (
                  <div className="flex items-center justify-center gap-2 px-3 py-2 bg-destructive/15 border-b border-destructive/30 text-destructive shrink-0">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="flex-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                      There was an error processing a message for this lead.{' '}
                      <button
                        type="button"
                        className="underline hover:text-foreground transition-colors"
                        onClick={() => safeNavigate(`/client/${clientId}/logs`, { state: { openLogId: activeError.id } })}
                      >
                        Check Error Logs
                      </button>
                    </span>
                    <button onClick={dismissError} className="shrink-0 hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Setter stopped warning */}
                {isSetterStopped && (
                  <div
                    className="flex items-center gap-2 px-4 py-2 text-yellow-200 shrink-0"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', background: 'hsl(40 80% 30% / 0.6)', borderBottom: '1px solid hsl(40 80% 40% / 0.4)' }}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Setter has been stopped — the AI no longer responds to this lead's messages.</span>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-hidden">
                  <ContactConversationHistory
                    externalId={getCanonicalLeadId(selectedLead as any) || null}
                    contactDataId={getCanonicalLeadId(selectedLead as any) || selectedLead.id || null}
                    contactName={getLeadName(selectedLead)}
                    supabaseUrl={credentials?.supabase_url || null}
                    hasSupabaseServiceKey={credentials?.has_supabase_service_key ?? false}
                    clientId={clientId}
                    contactId={selectedLead.id}
                    hasTwilio={!!(credentials?.twilio_account_sid && credentials?.has_twilio_auth_token && (credentials?.twilio_default_phone || (credentials as any)?.retell_phone_1))}
                    phoneNumber={selectedLead.phone || ''}
                    refreshKey={selectedLead.last_message_at || undefined}
                    onNewActivity={() => {
                      if (!selectedLead) return;
                      fetchLeads();
                      if (!suppressThreadRefreshRef.current) fetchThreads();
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <MessageSquare className="w-12 h-12 text-primary mb-4" />
                <h3 className="text-lg font-medium">Select a conversation</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Click on a contact from the left panel to view their conversation.
                </p>
              </div>
            )}

          </div>

          {/* Chat Filter Panel — matches leads filter UI */}
          <CrmFilterPanel
            showChannelSection
            open={showFilterPanel}
            onClose={() => {
              setShowFilterPanel(false);
              if (previousRightPanelRef.current !== 'none') {
                handleSetRightPanel(previousRightPanelRef.current);
              }
            }}
            columns={filterColumns}
            config={chatFilterConfig}
            onConfigChange={(config) => {
              setChatFilterConfig(config);
              // Debounced save to DB
              if (chatFilterSaveRef.current) clearTimeout(chatFilterSaveRef.current);
              chatFilterSaveRef.current = setTimeout(async () => {
                if (!clientId) return;
                const { data } = await supabase
                  .from('clients_public')
                  .select('crm_filter_config')
                  .eq('id', clientId)
                  .single();
                const existing = ((data as any)?.crm_filter_config || {}) as Record<string, any>;
                await (supabase as any)
                  .from('clients')
                  .update({ crm_filter_config: { ...existing, chat_filter: config }, updated_at: new Date().toISOString() })
                  .eq('id', clientId);
              }, 500);
            }}
            tags={allTags}
            showColumnsSection={false}
            showStatusSection={true}
          />

          {/* Right Column - Contact Details or Notes (toggleable) */}
          {rightPanel !== 'none' && selectedLead && clientId && (
            <div className="w-80 shrink-0 groove-border bg-card flex flex-col min-h-0 overflow-hidden">
              {/* Tabs */}
              <div className="flex border-b border-dashed border-border shrink-0">
                <button
                  onClick={() => guardedSetRightPanel(rightPanel === 'details' ? 'none' : 'details')}
                  className={`ibm-spacing-allow flex-1 py-2.5 text-center font-medium transition-colors uppercase ${
                    rightPanel === 'details' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500 }}
                >
                  DETAILS
                </button>
                <button
                  onClick={() => guardedSetRightPanel(rightPanel === 'notes' ? 'none' : 'notes')}
                  className={`ibm-spacing-allow flex-1 py-2.5 text-center font-medium transition-colors uppercase flex items-center justify-center gap-1.5 ${
                    rightPanel === 'notes' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500 }}
                >
                  NOTES
                  {notesCount > 0 && (
                    <span className="inline-flex h-[18px] w-fit items-center justify-center rounded-full bg-primary text-primary-foreground leading-none text-center" style={{ fontSize: '11px', fontWeight: 500, letterSpacing: '0em', padding: '0 5px 0 5px' }}>
                      {notesCount}
                    </span>
                  )}
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {rightPanel === 'notes' ? (
                  <LeadNotesPanel
                    open={true}
                    onClose={() => handleSetRightPanel('none')}
                    leadId={selectedLead.id}
                    clientId={clientId}
                    onNotesChanged={fetchNotesCount}
                  />
                ) : (
                  <ChatContactDetailsPanel
                    lead={selectedLead}
                    clientId={clientId}
                    onLeadUpdated={(updated) => {
                      setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
                    }}
                    onDirtyChange={setDetailsDirty}
                    saveRef={detailsSaveRef}
                    onOpenLeadDetails={() => safeNavigate(`/client/${clientId}/leads/${selectedLead.id}`)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <SavingOverlay isVisible={retrying} message="Retrying execution..." variant="fixed" />
      <SavingOverlay isVisible={stoppingBot} message={isSetterStopped ? "Activating setter..." : "Stopping setter..."} variant="fixed" />

      {/* Retry Confirmation Dialog */}
      <Dialog open={retryDialogOpen} onOpenChange={setRetryDialogOpen}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle>Retry Message Processing</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <div className="space-y-3">
              <p className="text-muted-foreground leading-relaxed" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
                This will re-send the last message from this lead to the AI engine and generate a new reply.
              </p>
              <p className="text-muted-foreground leading-relaxed" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
                A new execution will be created. The previous error will be cleared.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => setRetryDialogOpen(false)}
                disabled={retrying}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleRetryExecution}
                disabled={retrying}
              >
                {retrying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Retry Now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stop/Activate Setter Confirmation */}
      <Dialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              {isSetterStopped ? 'ACTIVATE SETTER' : 'STOP SETTER'}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6">
            <p className="text-sm text-muted-foreground leading-relaxed mb-5" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              {isSetterStopped
                ? 'Are you sure you want to activate the setter for this lead? The AI setter will resume replying to this contact.'
                : 'Are you sure you want to stop the setter for this lead? Once stopped, the AI setter will no longer reply to this contact.'}
            </p>
            <div className="flex gap-3">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => setShowStopConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant={isSetterStopped ? 'default' : 'destructive'}
                className={isSetterStopped ? 'flex-1 groove-btn-pulse' : 'flex-1'}
                onClick={() => {
                  setShowStopConfirm(false);
                  handleToggleSetter();
                }}
              >
                {isSetterStopped ? 'Activate Setter' : 'Stop Setter'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

/**
 * Full-featured contact details panel that mirrors ContactDetail's left column exactly.
 * Editable fields, collapsible sections, tags, custom fields, system info.
 */
function ChatContactDetailsPanel({
  lead,
  clientId,
  onLeadUpdated,
  onDirtyChange,
  saveRef,
  onOpenLeadDetails,
}: {
  lead: Lead;
  clientId: string;
  onLeadUpdated?: (lead: Lead) => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  onOpenLeadDetails?: () => void;
}) {
  const { credentials } = useClientCredentials(clientId);
  const { cb } = useCreatorMode();

  const [editData, setEditData] = useState<Record<string, string>>({});
  const editDataRef = useRef<Record<string, string>>({});
  const [originalEditData, setOriginalEditData] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clientFieldKeys, setClientFieldKeys] = useState<string[]>([]);
  const [assignedTags, setAssignedTags] = useState<ContactTag[]>([]);
  const [showTagSettings, setShowTagSettings] = useState(false);

  // Sync dirty state & save function to parent
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  const handleSaveStable = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { if (saveRef) saveRef.current = handleSaveStable.current; return () => { if (saveRef) saveRef.current = null; }; }, [saveRef]);

  interface Booking {
    id: string;
    title: string | null;
    start_time: string | null;
    end_time: string | null;
    status: string;
    location: string | null;
    notes: string | null;
    setter_name: string | null;
    setter_type: string | null;
    cancellation_link: string | null;
    reschedule_link: string | null;
    ghl_booking_id: string | null;
    ghl_contact_id: string | null;
    calendar_id: string | null;
    campaign_id: string | null;
    created_at: string;
  }
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const fetchBookings = useCallback(async () => {
    const bookingLookupIds = Array.from(new Set([
      lead.id,
      lead.lead_id,
      getCanonicalLeadId(lead as any),
    ].filter((value): value is string => Boolean(value))));

    if (bookingLookupIds.length === 0) {
      setBookings([]);
      return;
    }

    const selectClause = 'id, title, start_time, end_time, status, location, notes, setter_name, setter_type, cancellation_link, reschedule_link, ghl_booking_id, ghl_contact_id, calendar_id, campaign_id, created_at';

    const [{ data: byLeadId }, { data: byGhlContactId }] = await Promise.all([
      supabase
        .from('bookings')
        .select(selectClause)
        .in('lead_id', bookingLookupIds),
      supabase
        .from('bookings')
        .select(selectClause)
        .in('ghl_contact_id', bookingLookupIds),
    ]);

    const merged = [...(byLeadId || []), ...(byGhlContactId || [])]
      .filter((booking, index, array) => array.findIndex((candidate) => candidate.id === booking.id) === index)
      .sort((a, b) => {
        const aTime = a.start_time ? new Date(a.start_time).getTime() : 0;
        const bTime = b.start_time ? new Date(b.start_time).getTime() : 0;
        return bTime - aTime;
      });

    setBookings(merged as Booking[]);
  }, [lead]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    bookings: true,
    additional: true,
    system: true,
  });

  const getLeadName = (l: Lead) => {
    const first = l.first_name || '';
    const last = l.last_name || '';
    if (first || last) return `${first} ${last}`.trim();
    return l.email || l.phone || 'Unknown';
  };

  // Initialize edit data when lead changes
  useEffect(() => {
    const mergedEditData = buildEditableContactData(lead as any);
    setEditData(mergedEditData);
    editDataRef.current = mergedEditData;
    setOriginalEditData({ ...mergedEditData });
    setIsDirty(false);
  }, [lead.id]);

  // Fetch custom field keys
  useEffect(() => {
    (async () => {
      const keys = new Set<string>();
      const pageSize = 1000;
      let from = 0;
      try {
        while (true) {
          const { data, error } = await supabase
            .from('leads')
            .select('custom_fields')
            .eq('client_id', clientId)
            .range(from, from + pageSize - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          data.forEach((row) => {
            const cf = (row.custom_fields || {}) as Record<string, string>;
            Object.keys(cf).forEach((key) => keys.add(key));
          });
          if (data.length < pageSize) break;
          from += pageSize;
        }
        const { data: customDefs } = await (supabase as any)
          .from('client_custom_fields')
          .select('field_name, sort_order')
          .eq('client_id', clientId)
          .order('sort_order');
        const orderedFieldNames: string[] = [];
        if (customDefs) {
          customDefs.forEach((def: { field_name: string }) => {
            orderedFieldNames.push(def.field_name);
            keys.add(def.field_name);
          });
        }
        const definedSet = new Set(orderedFieldNames);
        const remaining = Array.from(keys).filter(k => !definedSet.has(k)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setClientFieldKeys([...orderedFieldNames, ...remaining]);
      } catch (err) {
        console.error('Error fetching client field keys:', err);
      }
    })();
  }, [clientId]);

  // Fetch assigned tags
  const fetchAssignedTags = useCallback(async () => {
    const { data } = await supabase
      .from('lead_tag_assignments')
      .select('tag_id, lead_tags(id, name, color, sort_order)')
      .eq('lead_id', lead.id);
    if (data) {
      const tags = data
        .map((d: any) => d.lead_tags)
        .filter(Boolean) as ContactTag[];
      tags.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setAssignedTags(tags);
    }
  }, [lead.id]);

  useEffect(() => {
    fetchAssignedTags();
  }, [fetchAssignedTags]);

  // Load persisted section collapse states
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('clients_public')
          .select('crm_filter_config')
          .eq('id', clientId)
          .single();
        const config = (data?.crm_filter_config || {}) as Record<string, any>;
        if (config.contact_sections_open) {
          setSectionsOpen(prev => ({ ...prev, ...config.contact_sections_open }));
        }
      } catch {}
    })();
  }, [clientId]);

  const handleEditDataChange = useCallback((key: string, value: string) => {
    setEditData(prev => {
      const next = { ...prev, [key]: value };
      editDataRef.current = next;
      return next;
    });
    setIsDirty(true);
  }, []);

  const toggleSection = async (section: string) => {
    const newState = { ...sectionsOpen, [section]: !sectionsOpen[section] };
    setSectionsOpen(newState);
    try {
      const { data } = await supabase
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const existing = (data?.crm_filter_config || {}) as Record<string, any>;
      await supabase
        .from('clients')
        .update({ crm_filter_config: { ...existing, contact_sections_open: newState } })
        .eq('id', clientId);
    } catch {}
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const canonicalContactId = getCanonicalLeadId(lead as any) || createCanonicalLeadId();
      const currentData = { ...editDataRef.current };
      const customFields = buildCustomFieldsFromData(currentData);
      const tagsPayload = assignedTags.map((tag) => ({
        name: tag.name,
        color: tag.color || '#646E82',
      }));

      const updatePayload = {
        lead_id: canonicalContactId,
        first_name: currentData['first_name'] || null,
        last_name: currentData['last_name'] || null,
        email: currentData['email'] || null,
        phone: currentData['phone'] || null,
        // PHONE-CLEAR-1: recompute so clearing/changing the number also clears/updates
        // the by-phone (inbound/STOP) match key (same fix as ContactDetail's save).
        normalized_phone: normalizePhone(currentData['phone'] || null),
        business_name: currentData['business_name'] || null,
        custom_fields: customFields,
        tags: tagsPayload,
      };

      const { error } = await (supabase.from('leads') as any)
        .update(updatePayload)
        .eq('id', lead.id);
      if (error) throw error;

      // Push to external (push-contact-to-external reads creds server-side)
      if (credentials?.has_supabase_service_key) {
        try {
          await supabase.functions.invoke('push-contact-to-external', {
            body: {
              clientId,
              externalId: canonicalContactId,
              contactData: buildExternalContactSyncPayload(currentData, {
                customFields,
                tags: tagsPayload,
              }),
            },
          });
        } catch {}
      }

      const updatedLead = { ...lead, ...updatePayload } as Lead;
      onLeadUpdated?.(updatedLead);
      setOriginalEditData({ ...currentData });
      setIsDirty(false);
      toast.success('Lead saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };
  handleSaveStable.current = handleSave;

  // Field resolution (same as ContactDetail)
  const systemFieldKeys = new Set([
    'created_at', 'Created', 'created', 'createdAt',
    'contact_id', 'Contact Id', 'contactId', 'id', 'Id', 'ID', 'session_id', 'Session Id', 'sessionId',
    'updated_at', 'Updated', 'updated', 'updatedAt', 'custom_fields', 'Custom Fields', '_synced_from_external', 'Synced From External',
    'tags', 'Tags',
  ]);

  const normalizeKey = (value: string) => value.toLowerCase().replace(/[\s_]/g, '');

  const resolveFieldKey = (aliases: string[], fallbackKey: string) => {
    const existingKey = Object.keys(editData).find((key) =>
      aliases.some((alias) => normalizeKey(alias) === normalizeKey(key))
    );
    return existingKey || fallbackKey;
  };

  const baseFieldAliases = {
    firstName: ['First Name', 'first_name', 'firstName'],
    lastName: ['Last Name', 'last_name', 'lastName'],
    email: ['Email', 'email', 'Email Address', 'email_address'],
    phone: ['Phone', 'phone', 'Phone Number', 'phone_number'],
    businessName: ['Business Name', 'business_name', 'Company', 'company', 'Company Name', 'company_name', 'Organization'],
  };

  const baseFields = [
    { label: 'First Name', key: resolveFieldKey(baseFieldAliases.firstName, 'first_name') },
    { label: 'Last Name', key: resolveFieldKey(baseFieldAliases.lastName, 'last_name') },
    { label: 'Email', key: resolveFieldKey(baseFieldAliases.email, 'email') },
    { label: 'Phone', key: resolveFieldKey(baseFieldAliases.phone, 'phone') },
  ];

  const businessNameField = { label: 'Business Name', key: resolveFieldKey(baseFieldAliases.businessName, 'business_name') };
  const baseFieldSet = new Set(Object.values(baseFieldAliases).flat().map((alias) => normalizeKey(alias)));

  const candidateExtraKeys = Array.from(new Set([...clientFieldKeys, ...Object.keys(editData)]));

  const extraFields = candidateExtraKeys
    .filter((key) => !systemFieldKeys.has(key) && !baseFieldSet.has(normalizeKey(key)))
    .sort((a, b) => {
      const ia = clientFieldKeys.indexOf(a);
      const ib = clientFieldKeys.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    })
    .map((key) => ({ label: key, key }));

  const additionalFields = [businessNameField, ...extraFields];

  const systemFields = [
    {
      key: 'created_at',
      label: 'Created',
      rawValue: lead.created_at || '',
      displayValue: lead.created_at
        ? new Date(lead.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit',
          }).toUpperCase()
        : '',
    },
    {
      key: 'lead_id',
      label: 'Lead ID',
      rawValue: getCanonicalLeadId(lead as any) || lead.id || '',
      displayValue: getCanonicalLeadId(lead as any) || lead.id || '',
    },
  ];

  const SECTION_TITLE_STYLE: React.CSSProperties = {
    fontSize: '13px',
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 500,
    letterSpacing: '2px',
    textTransform: 'uppercase',
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="p-3 border-b border-dashed border-border shrink-0">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className={`flex-1 min-w-0 truncate text-foreground font-medium field-text text-left hover:text-primary transition-colors ${cb}`}
            onClick={onOpenLeadDetails}
            title="Open lead details"
          >
            {getLeadName(lead)}
          </button>
        </div>
        {/* Tags below name */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {assignedTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center border px-2 py-0.5 font-medium leading-none whitespace-nowrap [font-size:11px] [border-width:0.7px]"
              style={{
                backgroundColor: `${tag.color || '#6366f1'}26`,
                borderColor: tag.color || '#6366f1',
                color: '#FFFFFF',
              }}
            >
              {tag.name}
            </span>
          ))}
          <button
            onClick={() => setShowTagSettings(true)}
            className="w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center hover:bg-accent transition-colors cursor-pointer"
            title="Manage tags"
          >
            <Plus className="w-2.5 h-2.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-3" style={{ overscrollBehavior: 'none' }}>

        {/* Bookings section — before contact fields, matching ContactDetail */}
        {bookings.length > 0 && (
          <div className="px-4 pt-3">
            <button
              onClick={() => toggleSection('bookings')}
              className="w-full flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer section-separator"
              style={{ marginRight: 0 }}
            >
              <span className="whitespace-nowrap">Bookings</span>
              {sectionsOpen.bookings ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
            </button>
            {sectionsOpen.bookings && (
              <div className="mt-2 space-y-1.5">
                {bookings.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBooking(b)}
                    className="w-full flex items-center gap-2 py-1.5 hover:bg-accent/50 transition-colors cursor-pointer text-left"
                  >
                    <span className="flex-1 min-w-0 truncate field-text text-foreground">
                      {b.title || 'Appointment'}
                    </span>
                    <span className="field-text text-muted-foreground shrink-0">
                      {b.start_time ? new Date(b.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Base Contact Fields */}
        <div className="px-4 pt-3 space-y-3">
          {baseFields.map((field) => {
            const fieldValue = editData[field.key] || '';
            const isCopyable = fieldValue.trim().length > 0;
            return (
              <div key={field.key} className="space-y-1">
                <Label className="field-text">{field.label}</Label>
                <div className="relative">
                  <Input
                    value={fieldValue}
                    onChange={(e) => handleEditDataChange(field.key, e.target.value)}
                    placeholder={`Enter ${field.label.toLowerCase()}`}
                    className={`field-text pr-8 ${cb}`}
                    disabled={saving}
                  />
                  {isCopyable && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-opacity"
                      title={`Copy ${field.label.toLowerCase()}`}
                      onClick={() => { navigator.clipboard.writeText(fieldValue); toast.success(`${field.label} copied`); }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {field.label === 'Phone' && lead.phone_valid === false && (
                  <div className="flex items-center gap-1.5 mt-1 px-0.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="hsl(40 90% 55%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                    <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', color: 'hsl(40 90% 55%)' }}>
                      Phone number format may be invalid
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Additional Info section */}
        <div className="px-4" style={{ paddingTop: '12px' }}>
          <button
            onClick={() => toggleSection('additional')}
            className="w-full flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer section-separator"
            style={{ marginRight: 0 }}
          >
            <span className="whitespace-nowrap">Additional Info</span>
            {sectionsOpen.additional ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
          </button>
          {sectionsOpen.additional && (
            <div style={{ paddingTop: '12px' }} className="space-y-3">
              {additionalFields.map((field) => {
                const fieldValue = editData[field.key] || '';
                const isCopyable = fieldValue.trim().length > 0;
                return (
                  <div key={field.key} className="space-y-1">
                    <Label className="field-text">{field.label}</Label>
                    <div className="relative">
                      <Input
                        value={fieldValue}
                        onChange={(e) => handleEditDataChange(field.key, e.target.value)}
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                        className={`field-text pr-8 ${cb}`}
                        disabled={saving}
                      />
                      {isCopyable && (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-opacity"
                          title={`Copy ${field.label.toLowerCase()}`}
                          onClick={() => { navigator.clipboard.writeText(fieldValue); toast.success(`${field.label} copied`); }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {additionalFields.length === 0 && (
                <p className="text-muted-foreground field-text">No additional fields available yet.</p>
              )}
            </div>
          )}
        </div>

        {/* System Info section */}
        <div className="px-4" style={{ paddingTop: '12px' }}>
          <button
            onClick={() => toggleSection('system')}
            className="w-full flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer section-separator"
            style={{ marginRight: 0 }}
          >
            <span className="whitespace-nowrap">System Info</span>
            {sectionsOpen.system ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
          </button>
          {sectionsOpen.system && (
            <div style={{ paddingTop: '12px' }} className="space-y-3">
              {systemFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label className="field-text">{field.label}</Label>
                  <div>
                    <span
                      className="cursor-pointer"
                      title="Click to copy"
                      onClick={() => {
                        navigator.clipboard.writeText(field.rawValue);
                        toast.success('Copied to clipboard');
                      }}
                    >
                      <StatusTag variant="neutral"><span className={cb}>{field.displayValue}</span></StatusTag>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
                <div>
                  <label className="field-text text-muted-foreground block mb-1">Created</label>
                  <span className="field-text text-foreground">{format(new Date(selectedBooking.created_at), 'MMM d, yyyy h:mm:ss a')}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {selectedBooking.title && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Title</label>
                      <span className="field-text text-foreground">{selectedBooking.title}</span>
                    </div>
                  )}
                  {selectedBooking.start_time && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Start Time</label>
                      <span className="field-text text-foreground">{format(new Date(selectedBooking.start_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedBooking.end_time && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">End Time</label>
                      <span className="field-text text-foreground">{format(new Date(selectedBooking.end_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedBooking.location && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Location</label>
                      <span className="field-text text-foreground">{selectedBooking.location}</span>
                    </div>
                  )}
                  {(selectedBooking.setter_name || selectedBooking.setter_type) && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Setter</label>
                      <span className="field-text text-foreground">{[selectedBooking.setter_name, selectedBooking.setter_type ? `(${selectedBooking.setter_type})` : ''].filter(Boolean).join(' ')}</span>
                    </div>
                  )}
                </div>
                {selectedBooking.notes && (
                  <div>
                    <label className="field-text text-muted-foreground block mb-1">Notes</label>
                    <pre className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto max-h-[200px] whitespace-pre-wrap break-words field-text" style={{ lineHeight: '1.5' }}>
                      {selectedBooking.notes}
                    </pre>
                  </div>
                )}
                {selectedBooking.calendar_id && (
                  <div>
                    <label className="field-text text-muted-foreground block mb-1">Calendar ID</label>
                    <span className="field-text text-foreground text-[11px] break-all">{selectedBooking.calendar_id}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  {selectedBooking.ghl_booking_id && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">GHL Booking ID</label>
                      <span className="field-text text-foreground text-[11px] break-all">{selectedBooking.ghl_booking_id}</span>
                    </div>
                  )}
                  {selectedBooking.ghl_contact_id && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">GHL Contact ID</label>
                      <span className="field-text text-foreground text-[11px] break-all">{selectedBooking.ghl_contact_id}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  {selectedBooking.reschedule_link && (
                    <a href={selectedBooking.reschedule_link} target="_blank" rel="noopener noreferrer" className="groove-btn flex-1 text-center field-text">
                      Reschedule
                    </a>
                  )}
                  {selectedBooking.cancellation_link && (
                    <a href={selectedBooking.cancellation_link} target="_blank" rel="noopener noreferrer" className="groove-btn groove-btn-destructive flex-1 text-center field-text">
                      Cancel
                    </a>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Tag Manager Dialog */}
      <TagManager
        open={showTagSettings}
        onOpenChange={setShowTagSettings}
        contactId={lead.id}
        clientId={clientId}
        assignedTagIds={assignedTags.map((t) => t.id)}
        onTagsChanged={fetchAssignedTags}
      />

    </div>
  );
}
