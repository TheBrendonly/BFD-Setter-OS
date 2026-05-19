import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { MessageSquare, Send, Plus, Bot, User, Copy, Loader2, Trash2, Edit, Sparkles, Calendar, RefreshCw } from '@/components/icons';
const CalendarIcon = Calendar;
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import openaiLogo from '@/assets/openai-logo.svg';
import anthropicLogo from '@/assets/anthropic-logo.svg';
import metaLogo from '@/assets/meta-logo.svg';
import googleLogo from '@/assets/google-logo.svg';

// Default webhook URLs for chat analytics — overridable per-client via
// clients.chat_analytics_webhook_url. Defaults are env-driven (set
// VITE_TEXT_CHAT_ANALYTICS_WEBHOOK_URL / VITE_VOICE_CHAT_ANALYTICS_WEBHOOK_URL
// in the deployment env). Hardcoded upstream URLs removed in N5 2026-05-19 —
// were leaking per-client chat content + apikeys to a shared upstream n8n
// for any tenant without their own column value.
const DEFAULT_TEXT_CHAT_ANALYTICS_WEBHOOK_URL = (import.meta.env.VITE_TEXT_CHAT_ANALYTICS_WEBHOOK_URL as string | undefined) ?? '';
const DEFAULT_VOICE_CHAT_ANALYTICS_WEBHOOK_URL = (import.meta.env.VITE_VOICE_CHAT_ANALYTICS_WEBHOOK_URL as string | undefined) ?? '';
interface AnalyticsChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}
interface AnalyticsChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  message_type: 'text';
  metadata?: any;
  created_at: string;
}
interface AnalyticsChatInterfaceProps {
  timeRange: string;
  customDateRange?: {
    startDate: string;
    endDate: string;
  };
  analyticsType?: 'text' | 'voice'; // NEW: Differentiate between text and voice analytics
}

// Predefined questions for analytics
const predefinedQuestions = ["What are the most common user questions?", "How many conversations happened today?", "What topics do users ask about most?", "Show me conversation trends over time", "What are the peak usage hours?", "How many new users interacted today?", "What's the average conversation length?", "Which responses got the most positive feedback?", "What are the most frequent user complaints?", "How do conversations typically end?", "What questions do users repeat most often?", "Show me user engagement patterns", "What time of day are users most active?", "How many users say 'thank you'?", "What are the longest conversations about?", "Which topics generate follow-up questions?"];
const llmOptions = [{
  id: 'anthropic/claude-sonnet-4.5',
  name: 'Claude Sonnet 4.5',
  logo: anthropicLogo,
  description: 'Latest flagship model with superior understanding'
}, {
  id: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  logo: anthropicLogo,
  description: 'High-performance reasoning'
}, {
  id: 'anthropic/claude-3.5-sonnet',
  name: 'Claude 3.5 Sonnet',
  logo: anthropicLogo,
  description: 'Excellent for writing and analysis'
}, {
  id: 'openai/gpt-5-2025-08-07',
  name: 'GPT-5',
  logo: openaiLogo,
  description: 'Most capable flagship model'
}, {
  id: 'openai/gpt-4o',
  name: 'GPT-4o',
  logo: openaiLogo,
  description: 'Advanced reasoning and creativity'
}, {
  id: 'openai/gpt-4o-mini',
  name: 'GPT-4o Mini',
  logo: openaiLogo,
  description: 'Fast and cost-effective for most tasks'
}, {
  id: 'google/gemini-2.5-flash',
  name: 'Gemini 2.5 Flash',
  logo: googleLogo,
  description: 'Fast and efficient multimodal model'
}];
export const AnalyticsChatInterface: React.FC<AnalyticsChatInterfaceProps> = ({
  timeRange: propTimeRange,
  customDateRange: propCustomDateRange,
  analyticsType = 'text' // Default to text for backward compatibility
}) => {
  const {
    clientId
  } = useParams<{
    clientId: string;
  }>();
  const {
    toast
  } = useToast();
  const [threads, setThreads] = useState<AnalyticsChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AnalyticsChatMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(true); // Start true to prevent flicker

  // Query mode is now always 'general' - customer query removed
  const activeQueryMode = 'general' as const;

  // Time range state for General Query - persisted to localStorage
  const [internalTimeRange, setInternalTimeRange] = useState(() => {
    const saved = localStorage.getItem(`time_range_${clientId}`);
    return saved || '7';
  });
  const [internalCustomStartDate, setInternalCustomStartDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`custom_start_date_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });
  const [internalCustomEndDate, setInternalCustomEndDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`custom_end_date_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });

  // Computed values - always use internal time range since this component has its own selector
  const timeRange = useMemo(() => activeQueryMode === 'general' ? internalTimeRange : '30', [activeQueryMode, internalTimeRange]);
  const customDateRange = useMemo(() => {
    // Prefer externally provided custom date range (e.g. ChatAnalytics page)
    if (propCustomDateRange) return propCustomDateRange;

    // Fallback: read the same persisted date-range keys used by ChatAnalytics (chat + dashboard)
    if (propTimeRange === 'custom' && clientId) {
      const prefix = analyticsType; // 'text' | 'voice'

      const startIso = localStorage.getItem(`${prefix}_chat_custom_start_${clientId}`) ?? localStorage.getItem(`${prefix}_dashboard_custom_start_${clientId}`);
      const endIso = localStorage.getItem(`${prefix}_chat_custom_end_${clientId}`) ?? localStorage.getItem(`${prefix}_dashboard_custom_end_${clientId}`);
      if (startIso && endIso) {
        const start = new Date(startIso);
        const end = new Date(endIso);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
          return {
            startDate: format(start, 'yyyy-MM-dd'),
            endDate: format(end, 'yyyy-MM-dd')
          };
        }
      }
    }

    // Legacy internal picker fallback
    if (activeQueryMode === 'general' && internalTimeRange === 'custom' && internalCustomStartDate && internalCustomEndDate) {
      return {
        startDate: format(internalCustomStartDate, 'yyyy-MM-dd'),
        endDate: format(internalCustomEndDate, 'yyyy-MM-dd')
      };
    }
    return undefined;
  }, [propCustomDateRange, propTimeRange, clientId, analyticsType, activeQueryMode, internalTimeRange, internalCustomStartDate, internalCustomEndDate]);

  // Webhook configuration
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [savedWebhookUrl, setSavedWebhookUrl] = useState<string>('');
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);

  // Client config for analytics function
  const [serviceKey, setServiceKey] = useState<string | null>(null);
  const [tableName, setTableName] = useState<string | null>(null);
  const [openrouterKey, setOpenrouterKey] = useState<string | null>(null);

  // Thread editing state
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  // Thinking message state
  const [thinkingMessageIndex, setThinkingMessageIndex] = useState(0);
  const thinkingMessages = ["AI is thinking...", "Processing your query...", "Analyzing the data...", "Generating insights...", "Almost there..."];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  

  // Determine table names based on analytics type
  const threadsTable = analyticsType === 'text' ? 'analytics_chat_threads' : 'voice_analytics_chat_threads';
  const messagesTable = analyticsType === 'text' ? 'analytics_chat_messages' : 'voice_analytics_chat_messages';
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (clientId) {
      loadClientConfig();
      fetchThreads();
    }
  }, [clientId]);

  // Persist time range to localStorage
  useEffect(() => {
    if (clientId && internalTimeRange) {
      localStorage.setItem(`time_range_${clientId}`, internalTimeRange);
    }
  }, [internalTimeRange, clientId]);

  // Persist custom date range to localStorage
  useEffect(() => {
    if (clientId) {
      if (internalCustomStartDate) {
        localStorage.setItem(`custom_start_date_${clientId}`, internalCustomStartDate.toISOString());
      }
      if (internalCustomEndDate) {
        localStorage.setItem(`custom_end_date_${clientId}`, internalCustomEndDate.toISOString());
      }
    }
  }, [internalCustomStartDate, internalCustomEndDate, clientId]);
  useEffect(() => {
    if (activeThreadId) {
      fetchMessages(activeThreadId);
    } else {
      // Clear messages when no thread is selected
      setMessages([]);
    }
  }, [activeThreadId]);
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  useEffect(() => {
    if (isLoading) scrollToBottom();
  }, [isLoading]);

  // Rotate thinking messages when loading
  useEffect(() => {
    if (!isLoading) {
      setThinkingMessageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setThinkingMessageIndex(prev => (prev + 1) % thinkingMessages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Auto-save thread activity and ensure data sync
  useEffect(() => {
    if (activeThreadId && messages.length > 0) {
      // Update thread timestamp to mark it as recently active
      const updateThreadActivity = async () => {
        try {
          await supabase.from(threadsTable).update({
            updated_at: new Date().toISOString()
          }).eq('id', activeThreadId);
        } catch (error) {
          console.error('Error updating thread activity:', error);
        }
      };
      updateThreadActivity();
    }
  }, [activeThreadId, messages.length]);

  // Load saved webhook URL from client data
  useEffect(() => {
    const loadWebhookUrl = async () => {
      if (!clientId) return;
      try {
        if (analyticsType === 'voice') {
          // For voice analytics, always use the fixed voice webhook URL
          setSavedWebhookUrl('');
          setWebhookUrl(DEFAULT_VOICE_CHAT_ANALYTICS_WEBHOOK_URL);
          return;
        }

        // For text analytics, support both legacy and current webhook fields
        const {
          data: client
        } = await supabase
          .from('clients')
          .select('chat_analytics_webhook_url, analytics_webhook_url')
          .eq('id', clientId)
          .single();

        const configuredWebhook = client?.chat_analytics_webhook_url || client?.analytics_webhook_url;
        if (configuredWebhook) {
          setSavedWebhookUrl(configuredWebhook);
          setWebhookUrl(configuredWebhook);
        } else {
          setSavedWebhookUrl(DEFAULT_TEXT_CHAT_ANALYTICS_WEBHOOK_URL);
          setWebhookUrl(DEFAULT_TEXT_CHAT_ANALYTICS_WEBHOOK_URL);
        }
      } catch (error) {
        console.error('Error loading webhook URL:', error);
      }
    };
    loadWebhookUrl();
  }, [clientId, analyticsType]);
  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior
      });
    }
  };

  // Save webhook URL to client
  const saveWebhookUrl = async () => {
    if (!clientId || !webhookUrl.trim()) return;
    setIsSavingWebhook(true);
    try {
      const {
        error
      } = await supabase.from('clients').update({
        chat_analytics_webhook_url: webhookUrl.trim(),
        analytics_webhook_url: webhookUrl.trim()
      }).eq('id', clientId);
      if (error) throw error;
      setSavedWebhookUrl(webhookUrl.trim());
      toast({
        title: "Success",
        description: "Webhook URL saved successfully"
      });
    } catch (error) {
      console.error('Error saving webhook URL:', error);
      toast({
        title: "Error",
        description: "Failed to save webhook URL",
        variant: "destructive"
      });
    } finally {
      setIsSavingWebhook(false);
    }
  };

  // Reset webhook URL
  const resetWebhookUrl = async () => {
    if (!clientId) return;
    setIsSavingWebhook(true);
    try {
      const {
        error
      } = await supabase.from('clients').update({
        chat_analytics_webhook_url: null,
        analytics_webhook_url: null
      }).eq('id', clientId);
      if (error) throw error;
      setSavedWebhookUrl('');
      setWebhookUrl('');
      toast({
        title: "Success",
        description: "Webhook URL reset successfully"
      });
    } catch (error) {
      console.error('Error resetting webhook URL:', error);
      toast({
        title: "Error",
        description: "Failed to reset webhook URL",
        variant: "destructive"
      });
    } finally {
      setIsSavingWebhook(false);
    }
  };

  // Load client config on mount
  const loadClientConfig = async () => {
    if (!clientId) return;
    try {
      // We no longer need service key, table name, or OpenRouter key
      // since we're using webhooks instead
      console.log('Client config loaded - using webhook integration');
    } catch (error) {
      console.error('Error loading client config:', error);
    }
  };
  const fetchThreads = async () => {
    if (!clientId) return;
    setThreadLoading(true);
    try {
      const {
        data,
        error
      } = await supabase.from(threadsTable).select('*').eq('client_id', clientId).eq('is_active', true).order('updated_at', {
        ascending: false
      });
      if (error) throw error;
      setThreads(data || []);

      // Auto-select the most recent thread if none is selected
      if (!activeThreadId && data && data.length > 0) {
        setActiveThreadId(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching threads:', error);
      toast({
        title: "Error",
        description: "Failed to load chat threads. Please refresh and try again.",
        variant: "destructive"
      });
    } finally {
      setThreadLoading(false);
    }
  };
  const fetchMessages = async (threadId: string) => {
    try {
      const {
        data,
        error
      } = await supabase.from(messagesTable).select('*').eq('thread_id', threadId).order('created_at', {
        ascending: true
      });
      if (error) throw error;
      setMessages((data || []) as AnalyticsChatMessage[]);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast({
        title: "Error",
        description: "Failed to load messages",
        variant: "destructive"
      });
    }
  };
  const createNewThread = async (title?: string) => {
    if (!clientId) return;
    setThreadLoading(true);
    try {
      const {
        data,
        error
      } = await supabase.from(threadsTable).insert([{
        client_id: clientId,
        title: (title || `New ${analyticsType === 'text' ? 'Analytics' : 'Voice'} Chat`).slice(0, 50) // Limit to 50 characters
      }]).select().single();
      if (error) throw error;
      await fetchThreads();
      setActiveThreadId(data.id);
      setMessages([]);
      toast({
        title: "Success",
        description: "New chat thread created"
      });
    } catch (error) {
      console.error('Error creating thread:', error);
      toast({
        title: "Error",
        description: "Failed to create new thread",
        variant: "destructive"
      });
    } finally {
      setThreadLoading(false);
    }
  };
  const updateThreadTitle = async (threadId: string, newTitle: string) => {
    try {
      const trimmedTitle = newTitle.trim().slice(0, 50); // Limit to 50 characters
      const {
        error
      } = await supabase.from(threadsTable).update({
        title: trimmedTitle
      }).eq('id', threadId);
      if (error) throw error;
      await fetchThreads();
      setEditingThreadId(null);
      toast({
        title: "Success",
        description: "Thread title updated"
      });
    } catch (error) {
      console.error('Error updating thread title:', error);
      toast({
        title: "Error",
        description: "Failed to update thread title",
        variant: "destructive"
      });
    }
  };
  const deleteThread = async (threadId: string) => {
    try {
      // Delete messages first
      await supabase.from(messagesTable).delete().eq('thread_id', threadId);

      // Delete thread
      const {
        error
      } = await supabase.from(threadsTable).delete().eq('id', threadId);
      if (error) throw error;
      await fetchThreads();
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
      }
      toast({
        title: "Success",
        description: "Thread deleted"
      });
    } catch (error) {
      console.error('Error deleting thread:', error);
      toast({
        title: "Error",
        description: "Failed to delete thread",
        variant: "destructive"
      });
    }
  };

  // Email validation function
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  // Phone validation function
  const isValidPhone = (phone: string): boolean => {
    const phoneRegex = /^[\d\s\-\(\)\+]{7,15}$/;
    return phoneRegex.test(phone.trim());
  };

  const WEBHOOK_RESPONSE_KEYS = ['output', 'response', 'answer', 'text', 'content', 'result', 'message', 'reply', 'completion', 'generated_text', 'output_text', 'assistant_response', 'final_answer', 'final', 'markdown'];
  const WEBHOOK_NESTED_CONTAINER_KEYS = ['data', 'json', 'body', 'payload', 'result', 'results', 'response'];

  const asText = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  };

  const parseNestedJsonString = (value: string): unknown => {
    const trimmed = value.trim();
    if (!trimmed) return value;

    const looksLikeJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));

    if (!looksLikeJson) return value;

    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  };

  const parseWebhookPayload = (rawText: string): unknown => {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    // Handle SSE-style payloads (data: ...)
    if (trimmed.startsWith('data:')) {
      const frames = trimmed
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('data:'))
        .map(line => line.replace(/^data:\s*/, ''))
        .filter(line => line && line !== '[DONE]')
        .map(line => parseNestedJsonString(line));

      if (frames.length === 1) return frames[0];
      if (frames.length > 1) return frames;
    }

    const parsedWhole = parseNestedJsonString(trimmed);
    if (parsedWhole !== trimmed) return parsedWhole;

    // Handle newline-delimited JSON
    const lines = trimmed
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length > 1) {
      const parsedLines = lines.map(line => parseNestedJsonString(line));
      const hasStructuredLine = parsedLines.some(item => typeof item === 'object' && item !== null);
      if (hasStructuredLine) return parsedLines;
    }

    return rawText;
  };

  const extractTextFromWebhookPayload = (payload: unknown, depth = 0): string | null => {
    if (depth > 8 || payload == null) return null;

    if (typeof payload === 'string') {
      const parsed = parseNestedJsonString(payload);
      if (parsed !== payload) {
        return extractTextFromWebhookPayload(parsed, depth + 1);
      }
      return asText(payload);
    }

    const directText = asText(payload);
    if (directText) return directText;

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const extracted = extractTextFromWebhookPayload(item, depth + 1);
        if (extracted) return extracted;
      }
      return null;
    }

    if (typeof payload !== 'object') return null;

    const obj = payload as Record<string, unknown>;

    const openAIStyle = asText((obj.choices as any)?.[0]?.message?.content);
    if (openAIStyle) return openAIStyle;

    const anthropicStyle = asText((obj.content as any)?.[0]?.text);
    if (anthropicStyle) return anthropicStyle;

    for (const key of WEBHOOK_RESPONSE_KEYS) {
      if (!(key in obj)) continue;

      const value = obj[key];
      const parsedValue = typeof value === 'string' ? parseNestedJsonString(value) : value;
      const extracted = extractTextFromWebhookPayload(parsedValue, depth + 1);
      if (extracted) return extracted;
    }

    for (const containerKey of WEBHOOK_NESTED_CONTAINER_KEYS) {
      if (!(containerKey in obj)) continue;

      const containerValue = obj[containerKey];
      const parsedContainer = typeof containerValue === 'string'
        ? parseNestedJsonString(containerValue)
        : containerValue;

      const extracted = extractTextFromWebhookPayload(parsedContainer, depth + 1);
      if (extracted) return extracted;
    }

    for (const value of Object.values(obj)) {
      const parsedValue = typeof value === 'string' ? parseNestedJsonString(value) : value;
      const extracted = extractTextFromWebhookPayload(parsedValue, depth + 1);
      if (extracted) return extracted;
    }

    return null;
  };

  const sendMessage = async () => {
    if (!currentMessage.trim() || !activeThreadId || !clientId) return;

    // Check if both dates are selected when using custom range
    if (timeRange === 'custom' && !customDateRange) {
      toast({
        title: "Missing Date Range",
        description: "Please select both start and end dates for the custom range",
        variant: "destructive"
      });
      return;
    }

    // Use chat analytics webhook URL from database or default based on analytics type
    const defaultWebhookUrl = analyticsType === 'voice' ? DEFAULT_VOICE_CHAT_ANALYTICS_WEBHOOK_URL : DEFAULT_TEXT_CHAT_ANALYTICS_WEBHOOK_URL;
    const effectiveWebhookUrl = savedWebhookUrl || defaultWebhookUrl;
    console.info(`[AI Chat][${analyticsType}] Using webhook: ${effectiveWebhookUrl}`);
    const userMessage = currentMessage.trim();
    setCurrentMessage('');
    setIsLoading(true);
    
    try {
      // Save user message
      const {
        data: userMessageData,
        error: userMessageError
      } = await supabase.from(messagesTable).insert([{
        thread_id: activeThreadId,
        role: 'user',
        content: userMessage,
        message_type: 'text',
        metadata: {
          queryType: 'general'
        }
      }]).select().single();
      if (userMessageError) throw userMessageError;

      // Update messages state immediately
      setMessages(prev => [...prev, userMessageData as AnalyticsChatMessage]);

      // Prepare chat history for webhook
      const history = [...messages, {
        role: 'user' as const,
        content: userMessage
      }].map(m => ({
        role: m.role,
        content: m.content
      }));

      // Get Supabase configuration
      const {
        data: clientData
      } = await supabase.from('clients').select('supabase_url, supabase_service_key, supabase_table_name').eq('id', clientId).single();

      // Send message to webhook endpoint (custom or default)
      const webhookResponse = await fetch(effectiveWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: userMessage,
          history: history,
          clientId: clientId,
          threadId: activeThreadId,
          timeRange: timeRange,
          queryType: 'general',
          supabase_url: clientData?.supabase_url || null,
          supabase_service_key: clientData?.supabase_service_key || null,
          supabase_table_name: clientData?.supabase_table_name || null,
          ...(timeRange === 'custom' && customDateRange && {
            startDate: customDateRange.startDate,
            endDate: customDateRange.endDate
          })
        })
      });
      if (!webhookResponse.ok) {
        throw new Error(`Webhook responded with status: ${webhookResponse.status}`);
      }

      // Parse webhook response robustly and extract readable text
      let aiResponseContent = '';
      let webhookData: any = null;
      const responseText = await webhookResponse.text();
      console.log('Raw webhook response:', responseText);

      const parsedPayload = parseWebhookPayload(responseText);
      webhookData = typeof parsedPayload === 'string' ? null : parsedPayload;
      aiResponseContent = extractTextFromWebhookPayload(parsedPayload) ?? '';

      if (!aiResponseContent && typeof parsedPayload === 'string') {
        aiResponseContent = parsedPayload.trim();
      }

      console.log('Final AI response content:', aiResponseContent);
      if (!aiResponseContent) {
        const topLevelKeys = webhookData && typeof webhookData === 'object' && !Array.isArray(webhookData)
          ? Object.keys(webhookData as Record<string, unknown>)
          : [];

        const serializedPayload = webhookData && typeof webhookData === 'object'
          ? JSON.stringify(webhookData, null, 2)
          : '';

        if (serializedPayload && serializedPayload !== '{}' && serializedPayload !== '[]') {
          aiResponseContent = `I received structured data from the webhook, but no plain-text answer was found.\n\n\`\`\`json\n${serializedPayload.slice(0, 4000)}\n\`\`\``;
        } else {
          const errorDetails = topLevelKeys.length > 0
            ? `Expected text in keys like "output", "response", "answer", "text", or "content" but found: ${topLevelKeys.join(', ')}`
            : 'Empty or non-text response received from webhook';

          aiResponseContent = `⚠️ Webhook Configuration Issue\n\nThe webhook responded but did not return text in the expected format.\n\n${errorDetails}\n\nPlease check your n8n workflow configuration to ensure it returns a response with one of these keys:\n- "output"\n- "response"\n- "message"\n- "answer"\n- "text"\n- "content"`;
        }
      }

      // Save AI response
      const {
        data: aiMessageData,
        error: aiMessageError
      } = await supabase.from(messagesTable).insert([{
        thread_id: activeThreadId,
        role: 'assistant',
        content: aiResponseContent,
        message_type: 'text',
        metadata: {
          webhookResponse: webhookData,
          timeRange: timeRange,
          queryType: activeQueryMode
        }
      }]).select().single();
      if (aiMessageError) {
        console.error('Error saving AI response:', aiMessageError);
        toast({
          title: "Warning",
          description: "Response received but may not be saved. Data will sync on refresh.",
          variant: "destructive"
        });
      }

      const localAiMessage: AnalyticsChatMessage = (aiMessageData as AnalyticsChatMessage) || {
        id: `local-${Date.now()}`,
        thread_id: activeThreadId,
        role: 'assistant',
        content: aiResponseContent,
        message_type: 'text',
        created_at: new Date().toISOString()
      };

      setMessages(prev => [...prev, localAiMessage]);

      // Update thread timestamp and refresh thread list
      await supabase.from(threadsTable).update({
        updated_at: new Date().toISOString()
      }).eq('id', activeThreadId);

      // Refresh threads to ensure data consistency
      fetchThreads();
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: "Error",
        description: `Failed to send message: ${error.message}`,
        variant: "destructive"
      });

      // Add error message to chat
      const errorMessage: AnalyticsChatMessage = {
        id: Date.now().toString(),
        thread_id: activeThreadId,
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your request. Please check your webhook configuration and try again.',
        message_type: 'text',
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: "Text copied to clipboard"
      });
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  };
  const handlePredefinedQuestion = (question: string) => {
    if (!activeThreadId) {
      toast({
        title: "Select a thread first",
        description: "Please select or create a chat thread before asking questions",
        variant: "destructive"
      });
      return;
    }

    // Check if both dates are selected when using custom range
    if (timeRange === 'custom' && !customDateRange) {
      toast({
        title: "Missing Date Range",
        description: "Please select both start and end dates for the custom range",
        variant: "destructive"
      });
      return;
    }

    // Set the question in the input and automatically send it
    setCurrentMessage(question);

    // Small delay to ensure state is updated, then send
    setTimeout(() => {
      sendMessage();
    }, 50);
  };

  // Add data refresh function for manual sync
  const refreshData = async () => {
    if (!clientId) return;
    setThreadLoading(true);
    try {
      await fetchThreads();
      if (activeThreadId) {
        await fetchMessages(activeThreadId);
      }
      toast({
        title: "Success",
        description: "Data refreshed successfully"
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to refresh data",
        variant: "destructive"
      });
    } finally {
      setThreadLoading(false);
    }
  };
  return <div className="h-full min-h-0 overflow-hidden flex flex-col">
      {/* Top Controls Row - spans full width */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 flex-shrink-0 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-lg font-semibold">History</span>
          <div className="w-px h-6 bg-border" />
          <Select value={internalTimeRange} onValueChange={setInternalTimeRange}>
            <SelectTrigger className="w-[160px] bg-card focus:ring-0 focus:ring-offset-0 !font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 1 day</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {internalTimeRange === 'custom' && <DateRangePicker
            startDate={internalCustomStartDate}
            endDate={internalCustomEndDate}
            onRangeChange={(start, end) => {
              setInternalCustomStartDate(start);
              setInternalCustomEndDate(end);
            }}
            maxDays={30}
          />}
        </div>
        
        <Button onClick={() => createNewThread()} size="sm" className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      {/* Main Content - History sidebar and Chat aligned */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0 overflow-hidden">
        {/* Chat Threads Sidebar */}
        <Card className="lg:col-span-1 material-surface flex flex-col h-full min-h-0 overflow-hidden">
          <CardContent className="p-0 flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Chat Threads - Scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <div className="space-y-2">
                {threads.map(thread => <div key={thread.id} className={`group relative p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm ${activeThreadId === thread.id ? 'bg-primary/10 border-primary' : 'hover:bg-muted/50'}`} onClick={() => setActiveThreadId(thread.id)}>
                    {editingThreadId === thread.id ? <div className="space-y-1">
                        <Input value={editingTitle} onChange={e => {
                      const newValue = e.target.value.slice(0, 50);
                      setEditingTitle(newValue);
                    }} onBlur={() => {
                      if (editingTitle.trim()) {
                        updateThreadTitle(thread.id, editingTitle.trim());
                      } else {
                        setEditingThreadId(null);
                      }
                    }} onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (editingTitle.trim()) {
                          updateThreadTitle(thread.id, editingTitle.trim());
                        } else {
                          setEditingThreadId(null);
                        }
                      } else if (e.key === 'Escape') {
                        setEditingThreadId(null);
                      }
                    }} className="h-6 text-sm" autoFocus maxLength={50} />
                        <p className="text-xs text-muted-foreground text-right">
                          {editingTitle.length}/50
                        </p>
                      </div> : <div className="pr-4">
                        <div className="flex items-center gap-2 mb-2">
                          <MessageSquare className="w-4 h-4 flex-shrink-0" />
                          <span className="font-medium text-sm truncate">
                            {thread.title}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            {new Date(thread.updated_at).toLocaleDateString()}
                          </p>
                          
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 ml-2">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 hover:bg-primary/20" onClick={e => {
                          e.stopPropagation();
                          setEditingThreadId(thread.id);
                          setEditingTitle(thread.title);
                        }}>
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-destructive hover:bg-destructive/20" onClick={e => {
                          e.stopPropagation();
                          deleteThread(thread.id);
                        }}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>}
                  </div>)}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chat Interface */}
        <Card className="lg:col-span-3 material-surface flex flex-col h-full min-h-0">
          <CardContent className="flex flex-col flex-1 min-h-0 p-4">
          {/* Chat Messages - Full height scrollable area */}
          <div ref={scrollContainerRef} className={`flex-1 border p-4 bg-background/50 mb-4 ${messages.length > 0 ? 'overflow-y-auto' : 'overflow-hidden'}`}>
            <div className={`${messages.length > 0 ? 'space-y-4' : 'h-full'}`}>
              {messages.length === 0 ? <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="max-w-2xl mx-auto text-center">
                    <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-3 text-foreground">Ask Me Anything</h3>
                    <p className="text-sm mb-6 leading-relaxed">
                      This thread is connected to an AI agent that will analyze the history of all the conversations and help you to find what you're looking for.
                    </p>
                    {activeThreadId && <div className="flex flex-wrap gap-2 justify-center">
                      {predefinedQuestions.slice(0, 6).map((question, index) => <button key={index} onClick={() => handlePredefinedQuestion(question)} disabled={isLoading || !activeThreadId || timeRange === 'custom' && !customDateRange} className="text-sm px-4 py-2 bg-muted/50 hover:bg-primary/10 border border-border transition-all hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-muted/50 text-foreground">
                          <span className="leading-5">{question}</span>
                        </button>)}
                    </div>}
                  </div>
                </div> : messages.map(message => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                    <div className={`max-w-[85%] rounded-lg px-4 py-3 ${message.role === 'user' ? 'bg-primary text-primary-foreground ml-4' : 'bg-card border shadow-sm mr-4'}`}>
                      {message.role === 'user' ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p> : <div className="prose prose-sm max-w-none dark:prose-invert text-sm leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                        h1: ({
                          children
                        }) => <h1 className="text-xl font-bold mb-4 mt-2 text-foreground border-b pb-2">{children}</h1>,
                        h2: ({
                          children
                        }) => <h2 className="text-lg font-semibold mb-3 mt-4 text-foreground">{children}</h2>,
                        h3: ({
                          children
                        }) => <h3 className="text-base font-semibold mb-2 mt-3 text-foreground">{children}</h3>,
                        p: ({
                          children
                        }) => <p className="mb-3 last:mb-0 text-foreground/90 leading-relaxed">{children}</p>,
                        ul: ({
                          children
                        }) => <ul className="list-disc list-outside ml-4 mb-3 space-y-1.5">{children}</ul>,
                        ol: ({
                          children
                        }) => <ol className="list-decimal list-outside ml-4 mb-3 space-y-1.5">{children}</ol>,
                        li: ({
                          children
                        }) => <li className="text-sm text-foreground/90 leading-relaxed pl-1">{children}</li>,
                        code: ({
                          children,
                          className
                        }) => {
                          const isInlineCode = !className;
                          return isInlineCode ? <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs font-mono">{children}</code> : <code className="block bg-muted/80 p-4 rounded-lg text-xs font-mono border overflow-x-auto my-3">{children}</code>;
                        },
                        pre: ({
                          children
                        }) => <div className="bg-muted/80 p-4 rounded-lg border overflow-x-auto my-3">{children}</div>,
                        blockquote: ({
                          children
                        }) => <blockquote className="border-l-4 border-primary/50 pl-4 italic my-3 text-foreground/80 bg-primary/5 py-2 rounded-r">{children}</blockquote>,
                        strong: ({
                          children
                        }) => <strong className="font-semibold text-foreground">{children}</strong>,
                        em: ({
                          children
                        }) => <em className="italic text-foreground/90">{children}</em>,
                        a: ({
                          children,
                          href
                        }) => <a href={href} className="text-primary hover:underline font-medium" target="_blank" rel="noopener noreferrer">{children}</a>,
                        table: ({
                          children
                        }) => <div className="overflow-x-auto my-4 rounded-lg border border-border shadow-sm">
                        <table className="min-w-full border-collapse bg-card">
                          {children}
                        </table>
                      </div>,
                        thead: ({
                          children
                        }) => <thead className="bg-primary/10 border-b-2 border-primary/20">{children}</thead>,
                        tbody: ({
                          children
                        }) => <tbody className="divide-y divide-border">{children}</tbody>,
                        tr: ({
                          children
                        }) => <tr className="hover:bg-muted/50 transition-colors">{children}</tr>,
                        th: ({
                          children
                        }) => <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-foreground">{children}</th>,
                        td: ({
                          children
                        }) => <td className="px-4 py-3 text-sm text-foreground/90">{children}</td>,
                        hr: () => <hr className="my-4 border-border" />
                      }}>
                            {message.content}
                          </ReactMarkdown>
                        </div>}
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs opacity-70 flex items-center gap-1">
                          {message.role === 'user' ? <>
                              <User className="w-3 h-3" />
                              <span>You</span>
                            </> : <>
                              <Sparkles className="w-3 h-3" />
                              <span>AI</span>
                            </>}
                          <span>•</span>
                          <span>{new Date(message.created_at).toLocaleTimeString()}</span>
                        </p>
                        {message.role === 'assistant' && <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copyToClipboard(message.content)}>
                            <Copy className="w-3 h-3" />
                          </Button>}
                      </div>
                    </div>
                  </div>)}
              
              {isLoading && <div className="flex justify-start animate-fade-in">
                  <div className="bg-muted border rounded-lg px-4 py-3 mr-4">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">{thinkingMessages[thinkingMessageIndex]}</span>
                    </div>
                  </div>
                </div>}
              
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area - Fixed at bottom */}
          <div className="flex-shrink-0">
            <div className="flex gap-2 items-center">
              <Input value={currentMessage} onChange={e => setCurrentMessage(e.target.value)} onKeyDown={handleKeyPress} placeholder={activeThreadId ? "Ask a question about your chat data..." : "Select a thread first..."} disabled={isLoading || !activeThreadId} className="flex-1 !h-8" style={{ fontSize: '13px' }} />
              <Button onClick={sendMessage} disabled={isLoading || !currentMessage.trim() || !activeThreadId || timeRange === 'custom' && !customDateRange} size="sm" className="shrink-0 !bg-foreground !text-background !border-foreground !font-normal">
                {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send</>}
              </Button>
            </div>
          </div>
          </CardContent>
        </Card>
      </div>
    </div>;
};
export default AnalyticsChatInterface;