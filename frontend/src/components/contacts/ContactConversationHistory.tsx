import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { format } from 'date-fns';
import { Loader2, MessageSquare, Send, ExternalLink, Phone, Play, Pause, ExternalLink as LinkIcon, X, Calendar, ChevronLeft, ChevronRight } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusTag } from '@/components/StatusTag';
import { toast } from 'sonner';
import { getCached, setCache } from '@/lib/queryCache';

interface CallData {
  call_id: string;
  call_status: string | null;
  recording_url: string | null;
  duration_ms: number | null;
  call_summary: string | null;
  call_successful: boolean | null;
  disconnect_reason: string | null;
  transcript: string | null;
  user_sentiment: string | null;
}

interface Message {
  type: 'human' | 'assistant' | 'business' | 'campaign_outbound' | 'voice_call' | 'booking';
  bookingId?: string;
  content: string;
  timestamp: string;
  source?: 'manual' | 'ai' | 'campaign';
  pending?: boolean;
  channel?: string; // 'sms' | 'whatsapp' for campaign outbound
  callData?: CallData;
  bookingStatus?: string;
}

interface PendingExecution {
  id: string;
  status: string;
  messages: Array<{ body?: string; content?: string; timestamp?: string }>;
  started_at: string;
  resume_at: string | null;
  channel?: string | null;
}

interface CompletedExecution {
  id: string;
  lead_id: string;
  messages: Array<{ body?: string; content?: string; received_at?: string; timestamp?: string }>;
  setter_messages: string[] | null;
  completed_at: string;
  started_at: string;
  channel?: string | null;
}

interface ContactConversationHistoryProps {
  externalId: string | null;
  contactDataId?: string | null;
  contactName: string;
  supabaseUrl: string | null | undefined;
  supabaseServiceKey: string | null | undefined;
  clientId?: string;
  contactId?: string;
  hasTwilio?: boolean;
  phoneNumber?: string;
  refreshKey?: string;
  onLoadComplete?: () => void;
  onNewActivity?: () => void;
}

export const ContactConversationHistory: React.FC<ContactConversationHistoryProps> = ({
  externalId,
  contactDataId,
  contactName,
  supabaseUrl,
  supabaseServiceKey,
  clientId,
  contactId,
  hasTwilio,
  phoneNumber,
  refreshKey,
  onLoadComplete,
  onNewActivity,
}) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [selectedChannel, setSelectedChannel] = useState(() => {
    try { return localStorage.getItem(`preferred_send_channel_${contactId}`) || 'sms'; } catch { return 'sms'; }
  });
  useEffect(() => {
    try { setSelectedChannel(localStorage.getItem(`preferred_send_channel_${contactId}`) || 'sms'); } catch { setSelectedChannel('sms'); }
  }, [contactId]);
  const [countdown, setCountdown] = useState('');
  const [dismissedBookingIds, setDismissedBookingIds] = useState<Set<string>>(new Set());
  const [selectedChatBooking, setSelectedChatBooking] = useState<any | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentMessagesRef = useRef<Set<string>>(new Set());
  const shouldAnimateScrollRef = useRef(false);
  // Track which contact the current fetch is for to discard stale results
  const activeContactRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);




  // Reset state immediately when contact changes to avoid showing stale conversation
  const prevContactRef = useRef<string | null>(null);
  useEffect(() => {
    const currentContact = contactDataId || externalId;
    if (prevContactRef.current && prevContactRef.current !== currentContact) {
      // Contact changed — clear messages immediately
      const cachedConv = getCached<Message[]>(`conv_${currentContact}`);
      if (cachedConv && cachedConv.length > 0) {
        setMessages(cachedConv);
        setLoading(false);
      } else {
        setMessages([]);
        setLoading(true);
      }
      setError(null);
      shouldAnimateScrollRef.current = false;
      prevMessageCountRef.current = 0;
    }
    prevContactRef.current = currentContact;
  }, [contactDataId, externalId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ── SMS Queue System ──
  interface QueuedMessage { id: string; text: string; channel: string; }
  const queueRef = useRef<QueuedMessage[]>([]);
  const processingRef = useRef(false);
  const lastSentAtRef = useRef<number>(0);
  const [queueProcessing, setQueueProcessing] = useState(false);

  const canSendSms = !!(hasTwilio && phoneNumber && clientId && contactId);

  // ── Pending dm_executions polling ──
  const [pendingExecution, setPendingExecution] = useState<PendingExecution | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef(pendingExecution);
  const lastPendingSignatureRef = useRef<string | null>(null);
  pendingRef.current = pendingExecution;
  const fetchMessagesRef = useRef<(() => void) | null>(null);

  const fetchPendingExecution = useCallback(async () => {
    const ghlId = contactDataId || externalId;
    if (!ghlId) return;

    try {
      const { data } = await supabase
        .from('dm_executions')
        .select('id,status,messages,started_at,resume_at,channel')
        .eq('lead_id', ghlId)
        .in('status', ['pending', 'waiting', 'grouping', 'sending', 'failed'])
        .order('started_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const row = data[0];

        // If the most recent non-completed execution is 'failed', check whether a newer
        // completed execution already supersedes it — if so, ignore the stale failed row.
        if (row.status === 'failed') {
          const { data: newerCompleted } = await supabase
            .from('dm_executions')
            .select('id')
            .eq('lead_id', ghlId)
            .eq('status', 'completed')
            .gt('started_at', row.started_at)
            .limit(1);

          if (newerCompleted && newerCompleted.length > 0) {
            if (pendingRef.current) {
              setPendingExecution(null);
              fetchMessagesRef.current?.();
            } else {
              setPendingExecution(null);
            }
            return;
          }
        }

        const msgs = (Array.isArray(row.messages) ? row.messages : []) as PendingExecution['messages'];
        const prev = pendingRef.current;
        const newExec: PendingExecution = { id: row.id, status: row.status ?? '', messages: msgs, started_at: row.started_at ?? '', resume_at: (row as any).resume_at ?? null, channel: (row as any).channel ?? null };
        const pendingSignature = `${row.id}:${msgs.length}:${msgs.map((msg: any) => msg?.received_at || msg?.timestamp || '').join('|')}`;
        // Only notify parent for genuinely new pending activity, not when retry rehydrates old inbound messages
        if (lastPendingSignatureRef.current && pendingSignature !== lastPendingSignatureRef.current) {
          onNewActivity?.();
        }
        lastPendingSignatureRef.current = pendingSignature;
        setPendingExecution(newExec);
      } else {
        lastPendingSignatureRef.current = null;
        if (pendingRef.current) {
          setPendingExecution(null);
          fetchMessagesRef.current?.();
        } else {
          setPendingExecution(null);
        }
      }
    } catch (err) {
      console.error('Error polling dm_executions:', err);
    }
  }, [contactDataId, externalId]);

  useEffect(() => {
    fetchPendingExecution();
    pollTimerRef.current = setInterval(fetchPendingExecution, 5000);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [fetchPendingExecution]);

  // ── Realtime subscription for call_history changes ──
  const [activeCall, setActiveCall] = useState<CallData | null>(null);

  useEffect(() => {
    const ghlId = contactDataId || externalId;
    if (!ghlId || !clientId) return;

    // Check for any currently in-progress call
    const checkActiveCall = async () => {
      const { data } = await supabase
        .from('call_history')
        .select('call_id, call_status, recording_url, duration_ms, call_summary, call_successful, disconnect_reason')
        .eq('client_id', clientId)
        .eq('contact_id', ghlId)
        .in('call_status', ['registered', 'ongoing'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setActiveCall({
          call_id: data[0].call_id,
          call_status: data[0].call_status,
          recording_url: data[0].recording_url,
          duration_ms: data[0].duration_ms,
          call_summary: data[0].call_summary,
          call_successful: data[0].call_successful,
          disconnect_reason: data[0].disconnect_reason,
          transcript: null,
          user_sentiment: null,
        });
      }
    };
    checkActiveCall();

    const channel = supabase
      .channel(`call-history-${ghlId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_history',
          filter: `contact_id=eq.${ghlId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (!row || row.client_id !== clientId) return;

          if (['registered', 'ongoing'].includes(row.call_status)) {
            setActiveCall({
              call_id: row.call_id,
              call_status: row.call_status,
              recording_url: row.recording_url,
              duration_ms: row.duration_ms,
              call_summary: row.call_summary,
              call_successful: row.call_successful,
              disconnect_reason: row.disconnect_reason,
              transcript: row.transcript || null,
              user_sentiment: row.user_sentiment || null,
            });
          } else {
            // Call ended — clear active call and refresh messages to show the card
            setActiveCall(null);
            fetchMessagesRef.current?.();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [contactDataId, externalId, clientId]);

  // ── Fetch completed dm_executions for this contact ──
  const fetchCompletedExecutions = useCallback(async (): Promise<CompletedExecution[]> => {
    const ghlId = contactDataId || externalId;
    if (!ghlId) return [];

    try {
      const { data, error: fetchErr } = await (supabase as any)
        .from('dm_executions')
        .select('id,lead_id,messages,setter_messages,completed_at,started_at,channel')
        .eq('lead_id', ghlId)
        .in('status', ['completed', 'paused'])
        .order('started_at', { ascending: true });

      if (fetchErr || !data) return [];
      return data as CompletedExecution[];
    } catch {
      return [];
    }
  }, [contactDataId, externalId]);

  // Helper to parse raw chat_history rows into Message objects
  const parseRawRows = useCallback((rows: any[]): Message[] => {
    return rows
      .map((row: any) => {
        let msgContent = '';
        let msgType = 'assistant';
        let msgSource: 'manual' | 'ai' | 'campaign' | undefined = undefined;

        if (typeof row.message === 'object' && row.message !== null) {
          msgContent = row.message.content || row.message.text || '';
          msgType = row.message.role || row.message.type || 'assistant';
          if (row.message.additional_kwargs?.source === 'manual') msgSource = 'manual';
        } else if (typeof row.message === 'string') {
          try {
            const p = JSON.parse(row.message);
            msgContent = p.content || p.text || '';
            msgType = p.role || p.type || 'assistant';
            if (p.additional_kwargs?.source === 'manual') msgSource = 'manual';
          } catch {
            msgContent = row.message;
          }
        }

        if (!msgContent || !msgContent.trim()) return null;

        if (['human', 'user', 'Human', 'User'].includes(msgType)) {
          msgType = 'human';
          // Extract user input from wrappers
          const match2 = msgContent.match(/^#\s*USER LAST UTTERANCE\s*\n([\s\S]*?)(\n\n#|$)/);
          if (match2?.[1]?.trim()) msgContent = match2[1].trim();
          else {
            const match1 = msgContent.match(/^User last input:\s*\n([\s\S]*?)(\n\nChat history|$)/);
            if (match1?.[1]?.trim()) msgContent = match1[1].trim();
          }
        } else if (['business', 'Business'].includes(msgType)) {
          msgType = 'business';
        } else {
          msgType = 'assistant';
        }

        msgContent = msgContent.replace(/^\s*#\s*$/gm, '').trim();
        if (!msgContent) return null;

        return {
          type: msgType as Message['type'],
          content: msgContent,
          timestamp: row.timestamp,
          source: msgSource,
        };
      })
      .filter(Boolean) as Message[];
  }, []);

  // NOTE: chat_history is now fetched via the get-chat-history edge function
  // instead of a per-client Supabase client created in the browser. As of the
  // 2026-04-30 sb_secret_*/sb_publishable_* key rotation, Supabase rejects
  // service-role keys when called from a browser ("Forbidden use of secret
  // API key in browser"). The edge function holds the secret server-side.

  const fetchMessages = useCallback(async () => {
    const searchId = contactDataId || externalId;
    if (!searchId) { onLoadComplete?.(); return; }
    if (!clientId) { onLoadComplete?.(); return; }

    // Track which contact this fetch is for — discard results if contact changed
    activeContactRef.current = searchId;

    // Show loading spinner only when we have no messages at all
    if (messagesRef.current.length === 0) {
      shouldAnimateScrollRef.current = false;
      setLoading(true);
    }
    setError(null);

    try {
      const altSessionId = (contactDataId && externalId && contactDataId !== externalId)
        ? externalId
        : null;

      const [completedExecs, historyResp] = await Promise.all([
        fetchCompletedExecutions(),
        supabase.functions.invoke('get-chat-history', {
          body: { clientId, sessionId: searchId, altSessionId },
        }),
      ]);

      if (historyResp.error) {
        throw new Error(historyResp.error.message || 'get-chat-history failed');
      }
      const payload = historyResp.data as { ok: boolean; rows?: any[]; error?: string } | null;
      if (!payload?.ok) {
        throw new Error(payload?.error || 'get-chat-history returned ok=false');
      }
      const allRows: any[] = Array.isArray(payload.rows) ? payload.rows : [];

      // Build a set of execution time windows that have setter_messages
      // We'll suppress chat_history AI rows that fall within these windows
      const executionWindows: Array<{ start: number; end: number }> = [];
      for (const exec of completedExecs) {
        if (exec.setter_messages && Array.isArray(exec.setter_messages) && exec.setter_messages.length > 0) {
          const start = new Date(exec.started_at).getTime();
          const end = exec.completed_at ? new Date(exec.completed_at).getTime() + 5000 : start + 60000; // 5s buffer
          executionWindows.push({ start, end });
        }
      }

      // Build messages from dm_executions (individual bubbles)
      // Track last known channel so follow-up executions (which may lack a channel)
      // inherit it from the preceding setter response
      const executionMessages: Message[] = [];
      let lastKnownChannel: string | undefined = undefined;
      for (const exec of completedExecs) {
        const effectiveChannel = exec.channel || lastKnownChannel || undefined;
        if (exec.channel) lastKnownChannel = exec.channel;

        // Inbound messages from messages array
        const msgs = Array.isArray(exec.messages) ? exec.messages : [];
        for (const msg of msgs) {
          const body = msg.body || msg.content || '';
          if (!body.trim()) continue;
          const ts = msg.received_at || msg.timestamp || exec.started_at;
          executionMessages.push({
            type: 'human',
            content: body,
            timestamp: ts,
            channel: effectiveChannel,
          });
        }

        // Outbound setter messages
        if (exec.setter_messages && Array.isArray(exec.setter_messages)) {
          for (const setterMsg of exec.setter_messages) {
            if (!setterMsg || !setterMsg.trim()) continue;
            executionMessages.push({
              type: 'assistant',
              content: setterMsg,
              timestamp: exec.completed_at || exec.started_at,
              source: 'ai',
              channel: effectiveChannel,
            });
          }
        }
      }

      // Parse chat_history rows
      const parsedChatHistory: Message[] = allRows
        .filter((row) => {
          // Skip engagement campaign messages — they're already rendered as Campaign bubbles from campaign_events
          let kwargsSource: string | undefined;
          if (typeof row.message === 'object' && row.message !== null) {
            kwargsSource = row.message.additional_kwargs?.source;
          } else if (typeof row.message === 'string') {
            try {
              const p = JSON.parse(row.message);
              kwargsSource = p.additional_kwargs?.source;
            } catch {
              // ignore
            }
          }
          return kwargsSource !== 'engagement_campaign';
        })
        .map((row) => {
          let msgContent = '';
          let msgType = 'assistant';
          let msgSource: 'manual' | 'ai' | 'campaign' | undefined = undefined;

          if (typeof row.message === 'object' && row.message !== null) {
            msgContent = row.message.content || row.message.text || '';
            msgType = row.message.role || row.message.type || 'assistant';
            if (row.message.additional_kwargs?.source === 'manual') {
              msgSource = 'manual';
            }
            if (!msgContent || !msgContent.trim()) return null;
          } else if (typeof row.message === 'string') {
            try {
              const p = JSON.parse(row.message);
              msgContent = p.content || p.text || '';
              msgType = p.role || p.type || 'assistant';
              if (p.additional_kwargs?.source === 'manual') {
                msgSource = 'manual';
              }
              if (!msgContent || !msgContent.trim()) return null;
            } catch {
              msgContent = row.message;
            }
          }

          if (['human', 'user', 'Human', 'User'].includes(msgType)) {
            msgType = 'human';
          } else if (['business', 'Business'].includes(msgType)) {
            msgType = 'business';
          } else {
            // If it's type "ai" with source "manual", keep it as assistant but flag it
            msgType = 'assistant';
          }

          if (!msgContent || !msgContent.trim()) return null;

          // For human messages, extract actual user input from system wrappers
          if (msgType === 'human') {
            const match2 = msgContent.match(/^#\s*USER LAST UTTERANCE\s*\n([\s\S]*?)(\n\n#|$)/);
            if (match2 && match2[1]?.trim()) {
              msgContent = match2[1].trim();
            } else {
              const match1 = msgContent.match(/^User last input:\s*\n([\s\S]*?)(\n\nChat history|$)/);
              if (match1 && match1[1]?.trim()) {
                msgContent = match1[1].trim();
              }
            }
          }

          msgContent = msgContent.replace(/^\s*#\s*$/gm, '').trim();
          if (!msgContent) return null;

          // Suppress AI messages that fall within execution windows with setter_messages
          if (msgType === 'assistant' && row.timestamp) {
            const rowTime = new Date(row.timestamp).getTime();
            const isSupressed = executionWindows.some(w => rowTime >= w.start && rowTime <= w.end);
            if (isSupressed) return null;
          }

          // Suppress human messages that are covered by dm_executions inbound messages
          if (msgType === 'human' && row.timestamp) {
            const rowTime = new Date(row.timestamp).getTime();
            const isCoveredByExec = executionWindows.some(w => rowTime >= w.start && rowTime <= w.end);
            if (isCoveredByExec) return null;
          }

          return {
            type: msgType as 'human' | 'assistant' | 'business',
            content: msgContent,
            timestamp: row.timestamp,
            source: msgSource,
          };
        })
        .filter(Boolean) as Message[];

      // Fetch outbound campaign messages from campaign_events
      const campaignMessages: Message[] = [];
      if (clientId) {
        const ghlId = contactDataId || externalId;
        if (ghlId) {
          const { data: campaignEvents } = await supabase
            .from('campaign_events')
            .select('channel, metadata, occurred_at')
            .eq('client_id', clientId)
            .eq('lead_id', ghlId)
            .eq('event_type', 'message_sent')
            .order('occurred_at', { ascending: true });
          for (const evt of campaignEvents || []) {
            const body = (evt as any).metadata?.message_body || '';
            if (!body.trim()) continue;
            campaignMessages.push({
              type: 'campaign_outbound',
              content: body,
              timestamp: evt.occurred_at,
              source: 'campaign',
              channel: evt.channel || 'sms',
            });
          }
        }
      }

      // Fetch voice call history from call_history table
      const callMessages: Message[] = [];
      if (clientId) {
        const ghlId = contactDataId || externalId;
        if (ghlId) {
          const { data: callRecords } = await supabase
            .from('call_history')
            .select('call_id, call_status, recording_url, duration_ms, call_summary, call_successful, disconnect_reason, start_timestamp, direction, contact_id, transcript, user_sentiment')
            .eq('client_id', clientId)
            .eq('contact_id', ghlId)
            .order('start_timestamp', { ascending: true });
          for (const call of callRecords || []) {
            callMessages.push({
              type: 'voice_call',
              content: call.call_summary || 'Phone call',
              timestamp: call.start_timestamp || new Date().toISOString(),
              callData: {
                call_id: call.call_id,
                call_status: call.call_status,
                recording_url: call.recording_url,
                duration_ms: call.duration_ms,
                call_summary: call.call_summary,
                call_successful: call.call_successful,
                disconnect_reason: call.disconnect_reason,
                transcript: call.transcript || null,
                user_sentiment: call.user_sentiment || null,
              },
            });
          }
        }
      }

      // Fetch bookings for this contact
      const bookingMessages: Message[] = [];
      if (contactId) {
        const { data: bookingRecords } = await supabase
          .from('bookings')
          .select('id, title, start_time, end_time, status, location, created_at')
          .eq('lead_id', contactId)
          .order('created_at', { ascending: true });
        for (const booking of bookingRecords || []) {
          const startFormatted = booking.start_time
            ? new Date(booking.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : '';
          bookingMessages.push({
            type: 'booking',
            content: `${booking.title || 'Appointment'}${startFormatted ? ` - ${startFormatted}` : ''}`,
            timestamp: booking.created_at,
            bookingStatus: booking.status,
            bookingId: booking.id,
          });
        }
      }

      // Merge chat_history, execution messages, campaign messages, calls, and bookings chronologically
      const allMessages = [...parsedChatHistory, ...executionMessages, ...campaignMessages, ...callMessages, ...bookingMessages];
      allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Propagate channel info: messages without a channel inherit from the nearest prior message that has one
      let inheritedChannel: string | undefined = undefined;
      for (const msg of allMessages) {
        if (msg.channel) {
          inheritedChannel = msg.channel;
        } else if (inheritedChannel && (msg.type === 'assistant' || msg.type === 'human')) {
          msg.channel = inheritedChannel;
        }
      }

      // Deduplicate consecutive messages with same content and type
      const deduped: Message[] = [];
      for (const msg of allMessages) {
        const last = deduped[deduped.length - 1];
        if (last && last.type === msg.type && last.content === msg.content) {
          continue;
        }
        deduped.push(msg);
      }

      // Discard results if user switched to a different contact while fetching
      if (activeContactRef.current !== searchId) return;

      sentMessagesRef.current.clear();
      setMessages(deduped);
      // Cache conversation for instant display on next visit
      const cacheId = contactDataId || externalId;
      if (cacheId) setCache(`conv_${cacheId}`, deduped);
    } catch (err: any) {
      const errMsg = err?.message || err?.error?.message || (typeof err === 'string' ? err : 'unknown error');
      const errCode = err?.code || err?.error?.code || null;
      console.error('Failed to load conversation history:', err);
      // Best-effort log to platform error_logs so the failure is server-visible
      try {
        if (clientId) {
          await supabase.from('error_logs').insert({
            client_id: clientId,
            source: 'frontend.ContactConversationHistory.fetchMessages',
            error_type: 'conversation_history_load_failed',
            error_message: `${errMsg}${errCode ? ` (${errCode})` : ''}`,
            lead_id: contactDataId || externalId || null,
          });
        }
      } catch { /* never let logging mask the original error */ }
      // Only show error if we don't have any preloaded data
      if (messagesRef.current.length === 0) {
        setError(`Failed to load conversation history: ${errMsg}`);
      }
    } finally {
      if (activeContactRef.current === searchId) {
        setLoading(false);
        onLoadComplete?.();
      }
    }
  }, [externalId, contactDataId, fetchCompletedExecutions, clientId, parseRawRows, onLoadComplete]);

  fetchMessagesRef.current = fetchMessages;

  // Initial load effect: show cached instantly, otherwise fetch everything
  useEffect(() => {
    const searchId = contactDataId || externalId;
    if (!searchId) return;

    const cachedConv = getCached<Message[]>(`conv_${searchId}`);

    if (cachedConv && cachedConv.length > 0) {
      setMessages(cachedConv);
      setLoading(false);
      onLoadComplete?.();
      // Still refresh in background
      fetchMessages();
    } else {
      fetchMessages();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactDataId, externalId]);

  // Refetch messages when refreshKey changes (e.g. leads.last_message_at updated via realtime in parent)
  const prevRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey && refreshKey !== prevRefreshKeyRef.current) {
      prevRefreshKeyRef.current = refreshKey;
      fetchMessagesRef.current?.();
    }
  }, [refreshKey, contactDataId, externalId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior });
    });
  }, []);

  // Track previous message count to only auto-scroll on genuine new messages
  const prevMessageCountRef = useRef(0);

  React.useLayoutEffect(() => {
    if (loading) return;
    const currentCount = messages.length + (pendingExecution?.messages?.length ?? 0);
    if (currentCount === 0) return;

    // On initial load (not animated yet), always scroll to bottom instantly
    if (!shouldAnimateScrollRef.current) {
      scrollToBottom('auto');
      shouldAnimateScrollRef.current = true;
      prevMessageCountRef.current = currentCount;
      return;
    }

    // Only auto-scroll when new messages actually arrive
    if (currentCount > prevMessageCountRef.current) {
      scrollToBottom('smooth');
    }
    prevMessageCountRef.current = currentCount;
  }, [loading, messages, pendingExecution, scrollToBottom]);

  // Countdown timer for pending execution
  const isWaitingForCountdown = pendingExecution?.status === 'waiting';
  const resumeAt = pendingExecution?.resume_at;
  useEffect(() => {
    if (!isWaitingForCountdown || !resumeAt) { setCountdown(''); return; }
    const update = () => {
      const diff = new Date(resumeAt).getTime() - Date.now();
      if (diff <= 0) { setCountdown('0s'); return; }
      const s = Math.floor(diff / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) setCountdown(`${h}h ${m % 60}m ${s % 60}s`);
      else if (m > 0) setCountdown(`${m}m ${s % 60}s`);
      else setCountdown(`${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isWaitingForCountdown, resumeAt]);

  // Process queue one message at a time with 10s cooldown
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    if (queueRef.current.length === 0) { setQueueProcessing(false); return; }

    processingRef.current = true;
    setQueueProcessing(true);

    while (queueRef.current.length > 0) {
      const item = queueRef.current[0];

      // Wait for 10s cooldown since last successful send
      const elapsed = Date.now() - lastSentAtRef.current;
      if (lastSentAtRef.current > 0 && elapsed < 10_000) {
        await new Promise(resolve => setTimeout(resolve, 10_000 - elapsed));
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          toast.error('Not authenticated');
          // Remove failed message from queue and UI
          queueRef.current.shift();
          setMessages(prev => prev.filter(m => !(m.content === item.text && m.source === 'manual' && m.pending)));
          continue;
        }

        const { data: result, error } = await supabase.functions.invoke('crm-send-message', {
          body: {
            client_id: clientId,
            contact_id: contactId,
            message: item.text,
            channel: item.channel,
          },
        });

        if (error) {
          // FunctionsHttpError carries the raw Response on .context; read the
          // body once so we can both honour the 429 backoff and surface errors.
          let errBody: any = {};
          if (error instanceof FunctionsHttpError) {
            errBody = await error.context.json().catch(() => ({}));
            // If rate limited by server, wait and retry (don't remove from queue)
            if (error.context.status === 429 && errBody?.wait_seconds) {
              await new Promise(resolve => setTimeout(resolve, errBody.wait_seconds * 1000));
              continue; // retry same message
            }
          }
          throw new Error(errBody?.error || error.message || 'Failed to send SMS');
        }

        lastSentAtRef.current = Date.now();

        // Warn if external write failed (message won't persist on reload)
        if (result.external_write === false) {
          console.warn('Manual SMS: external Supabase write failed — message may not persist on reload');
        }

        // Mark this chat as read so outbound messages don't trigger unread
        if (clientId && contactId) {
          await (supabase as any)
            .from('chat_read_status')
            .upsert({
              client_id: clientId,
              lead_id: contactId,
              last_read_at: new Date().toISOString(),
            }, { onConflict: 'client_id,lead_id' });
        }

        // Clear pending state
        setMessages(prev => prev.map(m =>
          m.content === item.text && m.source === 'manual' && m.pending
            ? { ...m, pending: false }
            : m
        ));

        queueRef.current.shift();
      } catch (error: any) {
        console.error('Error sending SMS:', error);
        toast.error(error.message || 'Failed to send SMS');
        // Remove failed message from UI and queue
        setMessages(prev => prev.filter(m => !(m.content === item.text && m.source === 'manual' && m.pending)));
        queueRef.current.shift();
      }
    }

    processingRef.current = false;
    setQueueProcessing(false);

    // Re-fetch from DB so persisted messages survive page reloads
    fetchMessagesRef.current?.();
  }, [clientId, contactId]);

  const handleSend = async () => {
    if (!newMessage.trim() || !canSendSms) return;

    const messageText = newMessage.trim();
    setNewMessage('');

    const optimisticMsg: Message = {
      type: 'human',
      content: messageText,
      timestamp: new Date().toISOString(),
      source: 'manual',
      pending: true,
      channel: selectedChannel,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    sentMessagesRef.current.add(messageText);

    // Add to queue and start processing
    queueRef.current.push({ id: crypto.randomUUID(), text: messageText, channel: selectedChannel });
    processQueue();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Collect all non-dismissed bookings for banner navigation
  const allBannerBookings = React.useMemo(() => {
    return messages.filter(m => m.type === 'booking' && m.bookingId && !dismissedBookingIds.has(m.bookingId));
  }, [messages, dismissedBookingIds]);
  const [bannerBookingIndex, setBannerBookingIndex] = React.useState(0);
  // Reset index when bookings change
  React.useEffect(() => {
    if (bannerBookingIndex >= allBannerBookings.length) setBannerBookingIndex(Math.max(0, allBannerBookings.length - 1));
  }, [allBannerBookings.length, bannerBookingIndex]);
  const latestBooking = allBannerBookings.length > 0 ? allBannerBookings[Math.min(bannerBookingIndex, allBannerBookings.length - 1)] : null;

  const openBookingDetail = useCallback(async (bookingId: string) => {
    const { data } = await supabase
      .from('bookings')
      .select('id, title, start_time, end_time, status, location, notes, setter_name, setter_type, cancellation_link, reschedule_link, ghl_booking_id, ghl_contact_id, calendar_id, campaign_id, created_at')
      .eq('id', bookingId)
      .maybeSingle();
    if (data) setSelectedChatBooking(data);
  }, []);

  if (!supabaseUrl || !supabaseServiceKey) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <MessageSquare className="w-12 h-12 text-muted-foreground" />
          <div>
            <p style={{ fontSize: '16px' }} className="font-medium text-foreground">Conversation History</p>
            <p style={{ fontSize: '13px' }} className="text-muted-foreground mt-1">
              Configure Supabase credentials to view conversation history.
            </p>
          </div>
        </div>
        {canSendSms && <SmsInputBar value={newMessage} onChange={setNewMessage} onSend={handleSend} onKeyDown={handleKeyDown} sending={queueProcessing} channel={selectedChannel} onChannelChange={setSelectedChannel} contactId={contactId} />}
      </div>
    );
  }

  if (!externalId && !contactDataId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <MessageSquare className="w-12 h-12 text-muted-foreground" />
          <div>
            <p style={{ fontSize: '16px' }} className="font-medium text-foreground">Conversation History</p>
            <p style={{ fontSize: '13px' }} className="text-muted-foreground mt-1">
              No external ID linked.
            </p>
          </div>
        </div>
        {canSendSms && <SmsInputBar value={newMessage} onChange={setNewMessage} onSend={handleSend} onKeyDown={handleKeyDown} sending={queueProcessing} channel={selectedChannel} onChannelChange={setSelectedChannel} contactId={contactId} />}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span style={{ fontSize: '13px' }} className="text-muted-foreground">Loading conversation...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <MessageSquare className="w-12 h-12 text-muted-foreground" />
          <p style={{ fontSize: '13px' }} className="text-destructive">{error}</p>
        </div>
        {canSendSms && <SmsInputBar value={newMessage} onChange={setNewMessage} onSend={handleSend} onKeyDown={handleKeyDown} sending={queueProcessing} channel={selectedChannel} onChannelChange={setSelectedChannel} contactId={contactId} />}
      </div>
    );
  }

  const parseHumanContent = (content: string): string => {
    const match2 = content.match(/^#\s*USER LAST UTTERANCE\s*\n([\s\S]*?)(\n\n#|$)/);
    if (match2) return match2[1].trim();
    const match1 = content.match(/^User last input:\s*\n([\s\S]*?)(\n\nChat history|$)/);
    if (match1) return match1[1].trim();
    return content;
  };

  const cleanContent = (content: string, isHuman: boolean) => {
    if (isHuman) return parseHumanContent(content || '');
    let cleaned = content || '';
    cleaned = cleaned.replace(/^\s*#\s*$/gm, '');
    return cleaned.trim() || content;
  };

  const hasPendingMessages = pendingExecution && pendingExecution.messages.length > 0;
  const showEmptyState = messages.length === 0 && !hasPendingMessages && !activeCall;
  const isWaiting = pendingExecution?.status === 'waiting';
  const timerDone = isWaiting && pendingExecution?.resume_at && countdown === '0s';

  const isFailed = pendingExecution?.status === 'failed';
  const statusLabel = pendingExecution && !isFailed
    ? (pendingExecution.status === 'waiting' && !timerDone ? 'AI processing' : 'Generating reply')
    : '';

  return (
    <div className="flex flex-col h-full">
      {/* Green booking banner */}
      {latestBooking && latestBooking.bookingId && (
        <div
          className="flex items-center gap-2 px-4 py-2 shrink-0 cursor-pointer hover:brightness-110 transition-all"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', background: 'hsl(142 60% 25% / 0.6)', borderBottom: '1px solid hsl(142 60% 35% / 0.4)', color: 'hsl(142 80% 85%)' }}
          onClick={() => latestBooking.bookingId && openBookingDetail(latestBooking.bookingId)}
        >
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 truncate">{latestBooking.content}</span>
          {allBannerBookings.length > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setBannerBookingIndex(i => Math.max(0, i - 1))}
                disabled={bannerBookingIndex === 0}
                className="hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                {bannerBookingIndex + 1}/{allBannerBookings.length}
              </span>
              <button
                onClick={() => setBannerBookingIndex(i => Math.min(allBannerBookings.length - 1, i + 1))}
                disabled={bannerBookingIndex >= allBannerBookings.length - 1}
                className="hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button onClick={() => setDismissedBookingIds(prev => { const n = new Set(prev); n.add(latestBooking.bookingId!); return n; })} className="shrink-0 hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div ref={scrollContainerRef} className={`flex-1 p-4 space-y-3 ${showEmptyState ? 'overflow-hidden flex items-center justify-center' : 'overflow-y-auto'}`} style={{ overscrollBehavior: 'none' }}>
        {showEmptyState ? (
          <div className="flex flex-col items-center text-center">
            <MessageSquare className="w-12 h-12 text-primary mb-4" />
            <h3 className="text-lg font-medium">No messages</h3>
            <p className="text-sm text-muted-foreground mt-1">No conversation history found.</p>
          </div>
        ) : (
          <>
          {messages.map((msg, msgIndex) => {
            // Voice call card
            if (msg.type === 'voice_call' && msg.callData) {
              return (
                <div key={msgIndex} className="flex justify-end">
                  <VoiceCallCard callData={msg.callData} timestamp={msg.timestamp} clientId={clientId} />
                </div>
              );
            }

            // Booking card — only show inline if dismissed from banner or not the latest
            if (msg.type === 'booking') {
              const isInBanner = latestBooking?.bookingId === msg.bookingId && !dismissedBookingIds.has(msg.bookingId || '');
              if (isInBanner) return null; // shown as banner above
              return (
                <div key={msgIndex} className="flex justify-center my-2">
                  <div
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-dashed cursor-pointer hover:brightness-110 transition-all"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', borderColor: 'hsl(142 60% 35% / 0.6)', background: 'hsl(142 60% 25% / 0.15)' }}
                    onClick={() => msg.bookingId && openBookingDetail(msg.bookingId)}
                  >
                    <Calendar className="w-3.5 h-3.5 shrink-0" style={{ color: 'hsl(142 80% 65%)' }} />
                    <span className="text-foreground">{msg.content}</span>
                  </div>
                </div>
              );
            }

            const isHuman = msg.type === 'human';
            const isBusiness = msg.type === 'business' || msg.source === 'manual';
            const isManualHuman = msg.source === 'manual';
            const isCampaignOutbound = msg.type === 'campaign_outbound';
            const isLeftSide = isHuman && !isBusiness;
            if (!isHuman && !isBusiness && !isCampaignOutbound && (!msg.content || !msg.content.trim())) return null;
            return (
              <div key={msgIndex} className={`flex ${isLeftSide ? 'justify-start' : 'justify-end'}`}>
                {msg.pending && !isLeftSide && (
                  <div className="flex items-center mr-2 shrink-0">
                    <span className="flex gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                )}
                <div
                  className={`max-w-[70%] min-w-0 px-3 py-2 rounded text-sm overflow-hidden transition-opacity duration-200 ${
                    isLeftSide
                      ? 'bg-muted text-foreground groove-border'
                      : isCampaignOutbound || isManualHuman
                        ? 'bg-accent/30 text-foreground groove-border'
                        : msg.pending
                          ? 'bg-primary/10 text-foreground/50 groove-border'
                          : 'bg-primary/20 text-foreground groove-border'
                  }`}
                >
                  <div className={`flex items-center justify-between gap-2 mb-1 text-[11px] capitalize ${isLeftSide ? 'text-foreground/70' : 'text-foreground/90'}`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    <span>
                      {isCampaignOutbound
                        ? 'Campaign'
                        : isBusiness ? 'You' : isHuman ? 'Lead' : 'Setter'}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {(() => {
                        const rawCh = msg.channel?.toLowerCase() || '';
                        const ch = isCampaignOutbound || msg.channel
                          ? rawCh.includes('whatsapp') ? 'WhatsApp'
                            : rawCh.includes('instagram') ? 'Instagram'
                            : rawCh.includes('facebook') || rawCh.includes('messenger') ? 'Facebook'
                            : rawCh.includes('linkedin') ? 'LinkedIn'
                            : rawCh.includes('live_chat') || rawCh.includes('livechat') || rawCh.includes('webchat') ? 'Chat'
                            : rawCh.includes('email') ? 'Email'
                            : rawCh.includes('imessage') ? 'iMessage'
                            : rawCh.includes('phone') || rawCh.includes('call') ? 'Call'
                            : 'SMS'
                          : null;
                        return ch ? (
                          <span className={`inline-flex items-center px-1 py-px rounded-sm text-[11px] normal-case ${isLeftSide ? 'bg-foreground/10 text-foreground/50' : 'bg-foreground/15 text-foreground/70'}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, lineHeight: 1.2 }}>
                            {ch}
                          </span>
                        ) : null;
                      })()}
                      {msg.timestamp && (
                        <span className="text-foreground/50 normal-case">
                          {format(new Date(msg.timestamp), 'MMM d, h:mm a')}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {cleanContent(msg.content, isHuman)}
                  </p>
                </div>
              </div>
            );
          })}
          </>
        )}

        {/* Active call in progress indicator */}
        {activeCall && (
          <div className="flex justify-end">
            <div className="min-w-[220px] max-w-[70%] px-3 py-3 rounded text-sm overflow-hidden bg-primary/10 text-foreground groove-border">
              <div className="flex items-center gap-2 mb-1">
                <Phone className="w-3.5 h-3.5 text-primary" />
                <p className="text-[11px] text-foreground/80" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  Voice Setter · Call
                </p>
              </div>
              <p className="text-[13px] text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                <span>Call in progress</span>
                <span className="inline-flex gap-0.5 ml-1 align-middle">
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce inline-block" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce inline-block" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce inline-block" style={{ animationDelay: '300ms' }} />
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Pending inbound messages from dm_executions */}
        {hasPendingMessages && (
          <>
            {pendingExecution.messages.map((msg, i) => {
              const body = msg.body || msg.content || '';
              if (!body.trim()) return null;
              return (
              <div key={`pending-${i}`} className="flex justify-start">
                  <div className="max-w-[70%] min-w-0 px-3 py-2 rounded text-sm overflow-hidden bg-muted text-foreground groove-border">
                    <div className="flex items-center justify-between gap-2 mb-1 text-[11px] text-foreground/70" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      <div className="flex items-center gap-1.5">
                        <span>Lead</span>
                        {pendingExecution.channel && (() => {
                          const rawCh = pendingExecution.channel?.toLowerCase() || '';
                          const label = rawCh.includes('whatsapp') ? 'WhatsApp'
                            : rawCh.includes('instagram') ? 'Instagram'
                            : rawCh.includes('facebook') || rawCh.includes('messenger') ? 'Facebook'
                            : rawCh.includes('linkedin') ? 'LinkedIn'
                            : rawCh.includes('live_chat') || rawCh.includes('livechat') || rawCh.includes('webchat') ? 'Chat'
                            : rawCh.includes('email') ? 'Email'
                            : rawCh.includes('imessage') ? 'iMessage'
                            : 'SMS';
                          return (
                            <span className="inline-flex items-center px-1 py-px rounded-sm bg-foreground/10 text-[11px] text-foreground/50 normal-case" style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, lineHeight: 1.2 }}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                      <span className="text-foreground/50">
                        {msg.timestamp ? format(new Date(msg.timestamp), 'MMM d, h:mm a') : format(new Date(), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                      {body}
                    </p>
                  </div>
                </div>
              );
            })}
            {/* Processing indicator with countdown and execution link — hide for failed */}
            {!isFailed && (
            <div className="flex justify-end">
              <div className="flex flex-col items-end gap-2">
                <div className="min-w-[220px] max-w-[70%] px-3 py-2 rounded text-sm overflow-hidden bg-primary/10 text-foreground groove-border">
                  {isWaiting && countdown && countdown !== '0s' && (
                    <p className="text-[11px] text-foreground/70 mb-1" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {countdown}
                    </p>
                  )}
                  <p className="text-[13px] text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                    <span>{statusLabel}</span>
                    <span className="inline-flex gap-0.5 ml-1 align-middle">
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce inline-block" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce inline-block" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce inline-block" style={{ animationDelay: '300ms' }} />
                    </span>
                  </p>
                </div>
                {clientId && (
                  <button
                    type="button"
                    className="groove-btn flex items-center gap-2"
                    onClick={() => navigate(`/client/${clientId}/workflows/process-dms?execution=${pendingExecution.id}`)}
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>CHECK EXECUTION</span>
                  </button>
                )}
              </div>
            </div>
            )}
          </>
        )}
      </div>

      {canSendSms && <SmsInputBar value={newMessage} onChange={setNewMessage} onSend={handleSend} onKeyDown={handleKeyDown} sending={queueProcessing} channel={selectedChannel} onChannelChange={setSelectedChannel} contactId={contactId} />}

      {/* Booking Detail Dialog */}
      <Dialog open={!!selectedChatBooking} onOpenChange={(open) => { if (!open) setSelectedChatBooking(null); }}>
        <DialogContent className="flex flex-col" style={{ maxWidth: '56rem', width: '90vw', height: '85vh', maxHeight: '85vh' }}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <DialogTitle className="uppercase">BOOKING DETAIL</DialogTitle>
              {selectedChatBooking && (() => {
                const sl = (selectedChatBooking.status || '').toLowerCase();
                const v = sl === 'confirmed' || sl === 'completed' ? 'positive' as const : sl === 'cancelled' || sl === 'canceled' || sl === 'no-show' ? 'negative' as const : sl === 'pending' || sl === 'rescheduled' ? 'warning' as const : 'neutral' as const;
                return <StatusTag variant={v}>{(selectedChatBooking.status || '').toUpperCase()}</StatusTag>;
              })()}
            </div>
          </DialogHeader>

          {selectedChatBooking && (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="space-y-5 px-6 py-6">
                <div>
                  <label className="field-text text-muted-foreground block mb-1">Created</label>
                  <span className="field-text text-foreground">{format(new Date(selectedChatBooking.created_at), 'MMM d, yyyy h:mm:ss a')}</span>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {selectedChatBooking.title && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Title</label>
                      <span className="field-text text-foreground">{selectedChatBooking.title}</span>
                    </div>
                  )}
                  {selectedChatBooking.start_time && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Start Time</label>
                      <span className="field-text text-foreground">{format(new Date(selectedChatBooking.start_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedChatBooking.end_time && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">End Time</label>
                      <span className="field-text text-foreground">{format(new Date(selectedChatBooking.end_time), 'MMM d, yyyy h:mm a')}</span>
                    </div>
                  )}
                  {selectedChatBooking.location && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Location</label>
                      <span className="field-text text-foreground">{selectedChatBooking.location}</span>
                    </div>
                  )}
                  {(selectedChatBooking.setter_name || selectedChatBooking.setter_type) && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Setter</label>
                      <span className="field-text text-foreground">{[selectedChatBooking.setter_name, selectedChatBooking.setter_type ? `(${selectedChatBooking.setter_type})` : ''].filter(Boolean).join(' ')}</span>
                    </div>
                  )}
                  {selectedChatBooking.calendar_id && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">Calendar ID</label>
                      <span className="field-text text-foreground text-[11px] break-all">{selectedChatBooking.calendar_id}</span>
                    </div>
                  )}
                </div>

                {selectedChatBooking.notes && (
                  <div>
                    <label className="field-text text-muted-foreground block mb-1">Notes</label>
                    <pre className="text-foreground/80 p-3 groove-border bg-muted/20 overflow-auto max-h-[200px] whitespace-pre-wrap break-words field-text" style={{ lineHeight: '1.5' }}>
                      {selectedChatBooking.notes}
                    </pre>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  {selectedChatBooking.ghl_booking_id && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">GHL Booking ID</label>
                      <span className="field-text text-foreground text-[11px] break-all">{selectedChatBooking.ghl_booking_id}</span>
                    </div>
                  )}
                  {selectedChatBooking.ghl_contact_id && (
                    <div>
                      <label className="field-text text-muted-foreground block mb-1">GHL Contact ID</label>
                      <span className="field-text text-foreground text-[11px] break-all">{selectedChatBooking.ghl_contact_id}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  {selectedChatBooking.reschedule_link && (
                    <a href={selectedChatBooking.reschedule_link} target="_blank" rel="noopener noreferrer" className="groove-btn flex-1 text-center field-text">
                      Reschedule
                    </a>
                  )}
                  {selectedChatBooking.cancellation_link && (
                    <a href={selectedChatBooking.cancellation_link} target="_blank" rel="noopener noreferrer" className="groove-btn groove-btn-destructive flex-1 text-center field-text">
                      Cancel
                    </a>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const CHANNEL_OPTIONS = [
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'imessage', label: 'iMessage' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'live_chat', label: 'Chat' },
];

function SmsInputBar({ value, onChange, onSend, onKeyDown, sending, channel, onChannelChange, contactId }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  sending: boolean;
  channel: string;
  onChannelChange: (ch: string) => void;
  contactId: string;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Reset textarea height when value is cleared (after send)
  React.useEffect(() => {
    if (!value && textareaRef.current) {
      textareaRef.current.rows = 1;
      textareaRef.current.style.height = '32px';
      textareaRef.current.style.lineHeight = '26px';
      textareaRef.current.style.paddingTop = '0px';
      textareaRef.current.style.paddingBottom = '0px';
    }
  }, [value]);

  const handleChannelChange = (val: string) => {
    onChannelChange(val);
    try { localStorage.setItem(`preferred_send_channel_${contactId}`, val); } catch {}
  };

  const [channelOpen, setChannelOpen] = React.useState(false);
  const selectedLabel = CHANNEL_OPTIONS.find(o => o.value === channel)?.label || 'SMS';

  return (
    <div className="p-3 border-t border-dashed border-border shrink-0 space-y-1.5">
      {/* Channel selector */}
      <Popover open={channelOpen} onOpenChange={setChannelOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-1.5 py-px rounded-sm text-[11px] bg-foreground/10 text-foreground/70 hover:bg-foreground/15 transition-colors cursor-pointer"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400, lineHeight: 1.2 }}
          >
            {selectedLabel}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-3 w-3 text-foreground/50" fill="currentColor" style={{ imageRendering: 'pixelated' as const }}>
              <rect x="7" y="9" width="2" height="2" />
              <rect x="9" y="11" width="2" height="2" />
              <rect x="11" y="13" width="2" height="2" />
              <rect x="13" y="11" width="2" height="2" />
              <rect x="15" y="9" width="2" height="2" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[140px] p-1 bg-sidebar border border-border rounded-md shadow-lg" sideOffset={4}>
          {CHANNEL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`flex items-center w-full rounded-sm px-2 py-1.5 cursor-pointer text-[11px] hover:bg-accent hover:text-accent-foreground transition-colors ${channel === opt.value ? 'bg-accent text-accent-foreground' : 'text-foreground/80'}`}
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400 }}
              onClick={() => { handleChannelChange(opt.value); setChannelOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Message input */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          placeholder="Type a message..."
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(e) => { e.currentTarget.rows = 4; e.currentTarget.style.height = 'auto'; e.currentTarget.style.lineHeight = '1.5'; e.currentTarget.style.paddingTop = '8px'; e.currentTarget.style.paddingBottom = '8px'; }}
          onBlur={(e) => { if (!e.currentTarget.value.trim()) { e.currentTarget.rows = 1; e.currentTarget.style.height = '32px'; e.currentTarget.style.lineHeight = '26px'; e.currentTarget.style.paddingTop = '0px'; e.currentTarget.style.paddingBottom = '0px'; } }}
          rows={1}
          disabled={false}
          className="flex-1 field-text w-full bg-card px-3 text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0 focus:shadow-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 groove-border resize-none transition-all duration-200"
          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', letterSpacing: '0.3px', height: '32px', lineHeight: '26px', paddingTop: '0px', paddingBottom: '0px' }}
        />
        <Button
          onClick={onSend}
          disabled={!value.trim()}
          size="icon"
          className="h-8 w-8 groove-btn shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Voice Call Card Component ──
function VoiceCallCard({ callData, timestamp, clientId }: { callData: CallData; timestamp: string; clientId?: string }) {
  const navigate = useNavigate();
  const [playing, setPlaying] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = React.useRef<HTMLAudioElement>(null);

  const statusColor = callData.call_successful
    ? 'text-green-500'
    : ['failed', 'error'].includes(callData.call_status || '')
      ? 'text-destructive'
      : 'text-yellow-500';

  const statusLabel = callData.call_status
    ? callData.call_status.charAt(0).toUpperCase() + callData.call_status.slice(1).replace(/_/g, ' ')
    : 'Unknown';

  const durationFormatted = callData.duration_ms
    ? `${Math.floor(callData.duration_ms / 60000)}:${String(Math.floor((callData.duration_ms % 60000) / 1000)).padStart(2, '0')}`
    : null;

  const sentimentColor = callData.user_sentiment === 'Positive' ? 'text-green-400'
    : callData.user_sentiment === 'Negative' ? 'text-red-400'
    : callData.user_sentiment === 'Neutral' ? 'text-yellow-400'
    : 'text-muted-foreground';

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  return (
    <div className="min-w-[260px] max-w-[70%] px-3 py-3 rounded text-sm overflow-hidden bg-accent/20 text-foreground groove-border">
      <div className="flex items-center gap-2 mb-2">
        <Phone className="w-3.5 h-3.5 text-primary" />
        <p className="text-[11px] text-foreground/80" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          Voice Setter · Phone Call
          <span className="ml-2 text-foreground/50">
            {format(new Date(timestamp), 'MMM d, h:mm a')}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[12px] font-medium ${statusColor}`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {statusLabel}
        </span>
        {durationFormatted && (
          <span className="text-[11px] text-foreground/50" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            {durationFormatted}
          </span>
        )}
        {callData.user_sentiment && (
          <span className={`text-[11px] ${sentimentColor}`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            · {callData.user_sentiment}
          </span>
        )}
      </div>

      {callData.call_summary && (
        <p className="text-[12px] text-foreground/70 mb-2 line-clamp-2" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {callData.call_summary}
        </p>
      )}

      {callData.recording_url && (
        <div className="mb-2">
          <audio
            ref={audioRef}
            src={callData.recording_url}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
          <button
            type="button"
            onClick={togglePlay}
            className="groove-btn flex items-center gap-2 text-[12px]"
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{playing ? 'PAUSE' : 'PLAY RECORDING'}</span>
          </button>
        </div>
      )}

      {callData.transcript && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setShowTranscript(!showTranscript)}
            className="groove-btn flex items-center gap-2 text-[12px] mb-1"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>{showTranscript ? 'HIDE TRANSCRIPT' : 'SHOW TRANSCRIPT'}</span>
          </button>
          {showTranscript && (
            <div className="mt-1 p-2 rounded bg-muted/50 text-[11px] text-foreground/80 max-h-[200px] overflow-y-auto whitespace-pre-wrap" style={{ fontFamily: "'IBM Plex Mono', monospace", wordBreak: 'break-word' }}>
              {callData.transcript}
            </div>
          )}
        </div>
      )}

      {clientId && (
        <button
          type="button"
          className="groove-btn flex items-center gap-2 text-[12px]"
          onClick={() => navigate(`/client/${clientId}/logs?tab=calls&call=${callData.call_id}`)}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>VIEW DETAILS</span>
        </button>
      )}
    </div>
  );
}
