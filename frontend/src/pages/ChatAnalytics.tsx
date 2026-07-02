import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams, useNavigate, useLocation, useOutletContext } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getMetricIcon } from '@/utils/metricIcons';
import { useAnalyticsWebhook, type AnalyticsWebhookResult } from '@/hooks/useAnalyticsWebhook';
import { useClientWebhooks } from '@/hooks/useClientWebhooks';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { BarChart3, MessageSquare, ThumbsUp, HelpCircle, Users, Database, Key, RefreshCw, Send, Sparkles, CalendarIcon, Activity, AlertTriangle, RotateCcw, Loader2, Trash2, Webhook, ExternalLink, CheckCircle, AlertCircle, Plus, Edit } from '@/components/icons';
import { ConfigStatusBar } from '@/components/ConfigStatusBar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, differenceInDays, startOfDay, endOfDay, subDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { AnalyticsChatInterface } from '@/components/AnalyticsChatInterface';
import { CustomMetricDialog } from '@/components/CustomMetricDialog';
import { VoiceCallLogsTable } from '@/components/VoiceCallLogsTable';
import { SortableMetricGrid } from '@/components/SortableMetricGrid';
import { CampaignDashboardGrid } from '@/components/campaign/CampaignDashboardGrid';
import { CampaignChartRenderer } from '@/components/campaign/CampaignChartRenderer';
import { CampaignWidgetEditPopover } from '@/components/campaign/CampaignWidgetEditPopover';
import { toNormalizedDashboardWidgets, getNextDashboardWidgetSlot } from '@/components/campaign/dashboardGrid';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import SavingOverlay from '@/components/SavingOverlay';
import { ErrorDisplay, parseBackendError, type ParsedError } from '@/components/ui/error-display';
import { DateRangePicker } from '@/components/ui/date-range-picker';

import { ConversationsDrawer, type AiMatch } from '@/components/ConversationsDrawer';
import RetroLoader from '@/components/RetroLoader';
import { UsageSummaryCard } from '@/components/UsageSummaryCard';

// Persistence helpers for Supabase storage
const STORAGE_KEYS = {
  ANALYTICS_DATA: 'chat_analytics_data',
  CHAT_ANALYTICS_DATA: 'chat_analytics_ai_data',
  LAST_FETCH_TIME: 'analytics_last_fetch'
};

// ── Module-level cache ──────────────────────────────────────────────
// Survives component unmount/remount so navigating away and back is instant.
interface CacheEntry { data: any; lastRefreshed: Date; }
interface ModuleCache {
  textWebhookData: Record<string, CacheEntry>;
  voiceWebhookData: Record<string, CacheEntry>;
  textCustomMetrics: any[] | null;
  voiceCustomMetrics: any[] | null;
  client: any | null;
  metricColors: Record<string, string> | null;
  clientWebhookUrl: string | null;
  supabaseConfig: { url: string; serviceKey: string; tableName: string } | null;
  configSaved: boolean;
  hasSupabaseConfig: boolean;
  hasLLMConfig: boolean;
  // Track which clientId this cache is for
  clientId: string | null;
  // Whether we've done a full fetch for this clientId
  hasFetched: boolean;
}

const moduleCache: ModuleCache = {
  textWebhookData: {},
  voiceWebhookData: {},
  textCustomMetrics: null,
  voiceCustomMetrics: null,
  client: null,
  metricColors: null,
  clientWebhookUrl: null,
  supabaseConfig: null,
  configSaved: false,
  hasSupabaseConfig: false,
  hasLLMConfig: false,
  clientId: null,
  hasFetched: false,
};

const getDefaultMetricValue = (metrics: any, metricName: string): number | null => {
  if (!Array.isArray(metrics?.default_metrics)) return null;

  const match = metrics.default_metrics.find((entry: any) =>
    String(entry?.title || entry?.name || '').toLowerCase() === metricName.toLowerCase()
  );

  const numericValue = Number(match?.value ?? match?.count);
  return Number.isFinite(numericValue) ? numericValue : null;
};

// Helper to check if metrics are all zeros (prevents saving bad data)
const isZeroRecord = (metrics: any): boolean => {
  if (!metrics) return true;

  if (metrics._type === 'String' && typeof metrics.value === 'string') {
    try {
      return isZeroRecord(JSON.parse(metrics.value));
    } catch {
      return true;
    }
  }

  if (typeof metrics !== 'object') return true;

  if (Array.isArray(metrics.widgets) && metrics.widgets.length > 0) return false;
  if (Array.isArray(metrics.default_metrics) && metrics.default_metrics.length > 0) return false;
  if (Array.isArray(metrics.conversations_list) && metrics.conversations_list.length > 0) return false;
  if (Array.isArray(metrics.Conversations_List) && metrics.Conversations_List.length > 0) return false;

  const summary = metrics.summary && typeof metrics.summary === 'object' ? metrics.summary : null;
  const summaryValues = [summary?.total_conversations, summary?.total_messages]
    .map(value => Number(value))
    .filter(value => Number.isFinite(value));
  if (summaryValues.some(value => value > 0)) return false;

  const numericSignals = [
    metrics?.Bot_Messages,
    metrics?.totalBotMessages,
    metrics?.['Total Bot Messages'],
    metrics?.New_Users,
    metrics?.newUserMessages,
    metrics?.['New User Messages'],
    metrics?.['Total Unique Users'],
    metrics?.Thank_You,
    metrics?.thankYouCount,
    metrics?.['Thank You Count'],
    metrics?.Questions,
    metrics?.questionsAsked,
    metrics?.['Questions Asked'],
    metrics?.Total_Conversations,
    metrics?.totalConversations,
    metrics?.['Total Conversations'],
    metrics?.['Total Messages'],
    metrics?.['Total Voice Call'],
    metrics?.totalVoiceCalls,
    getDefaultMetricValue(metrics, 'Total Conversations'),
    getDefaultMetricValue(metrics, 'Total Bot Messages'),
    getDefaultMetricValue(metrics, 'Total Human Messages'),
    getDefaultMetricValue(metrics, 'New Users'),
  ]
    .map(value => Number(value))
    .filter(value => Number.isFinite(value));

  if (numericSignals.some(value => value > 0)) return false;

  return numericSignals.length === 0 ? true : numericSignals.every(value => value === 0);
};

const mergeAnalyticsWidgets = (existingWidgets: any[] = [], incomingWidgets: any[] = []) => {
  const merged = new Map<string, any>();

  [...existingWidgets, ...incomingWidgets].forEach(widget => {
    if (!widget || typeof widget !== 'object') return;

    const key = String(
      widget.id || `${widget.name || widget.title || 'metric'}::${widget.widget_type || widget.default_type || 'number_card'}`
    );

    merged.set(key, {
      ...(merged.get(key) || {}),
      ...widget,
    });
  });

  return Array.from(merged.values());
};

const saveAnalyticsToDatabase = async (clientId: string, timeRange: string, data: any, analyticsType: 'text' | 'voice' = 'text') => {
  try {
    // CRITICAL: Prevent saving zero-value records that could overwrite good data
    if (isZeroRecord(data)) {
      console.warn(`Blocked saving zero-value ${analyticsType} analytics for time range: ${timeRange}`);
      return;
    }
    
    const tableName = analyticsType === 'voice' ? 'voice_chat_analytics' : 'chat_analytics';
    const {
      error
    } = await supabase.from(tableName).upsert({
      client_id: clientId,
      time_range: timeRange,
      metrics: data,
      last_updated: new Date().toISOString()
    }, {
      onConflict: 'client_id,time_range'
    });
    if (error) {
      console.error(`Failed to save ${analyticsType} analytics to database:`, error);
    }
  } catch (error) {
    console.error(`Error saving ${analyticsType} analytics to database:`, error);
  }
};
const loadAnalyticsFromDatabase = async (clientId: string, analyticsType: 'text' | 'voice' = 'text') => {
  try {
    const tableName = analyticsType === 'voice' ? 'voice_chat_analytics' : 'chat_analytics';
    const {
      data,
      error
    } = await supabase.from(tableName).select('*').eq('client_id', clientId).order('last_updated', {
      ascending: false
    });
    if (error) {
      console.error(`Failed to load ${analyticsType} analytics from database:`, error);
      return {};
    }

    // Convert to cache format, SKIPPING zero records
    const cache: Record<string, {
      data: any;
      lastRefreshed: Date;
    }> = {};
    data?.forEach(record => {
      // Only load non-zero records to prevent showing corrupted data
      if (!isZeroRecord(record.metrics)) {
        cache[record.time_range] = {
          data: record.metrics,
          lastRefreshed: new Date(record.last_updated)
        };
      } else {
        console.warn(`Skipped loading zero-value ${analyticsType} analytics record for time range: ${record.time_range}`);
      }
    });
    return cache;
  } catch (error) {
    console.error(`Error loading ${analyticsType} analytics from database:`, error);
    return {};
  }
};
interface Client {
  id: string;
  name: string;
  // G3-6: presence-only — secret values never reach the browser.
  has_openrouter_api_key: boolean;
  has_openai_api_key: boolean;
}
interface SupabaseConfig {
  url: string;
  serviceKey: string;
  tableName: string;
}
interface AnalyticsMetrics {
  totalBotMessages: number;
  newUserMessages: number;
  thankYouCount: number;
  questionsAsked: number;
  totalConversations: number;
  customMetrics?: Record<string, number>;
}
interface CustomMetric {
  id: string;
  name: string;
  prompt: string;
  color: string;
  is_active: boolean;
  widget_type?: string;
  widget_width?: string;
  created_at?: string;
  sort_order?: number;
}
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Dynamic color helpers (hex -> HSL)
const hexToHsl = (hex: string) => {
  try {
    let c = (hex || '').replace('#', '');
    if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
    if (c.length !== 6) return {
      h: 217,
      s: 91,
      l: 60
    }; // fallback to blue
    const r = parseInt(c.substring(0, 2), 16) / 255;
    const g = parseInt(c.substring(2, 4), 16) / 255;
    const b = parseInt(c.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0,
      l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h = h / 6;
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  } catch {
    return {
      h: 217,
      s: 91,
      l: 60
    };
  }
};
const hsl = (hex: string) => {
  const {
    h,
    s,
    l
  } = hexToHsl(hex);
  return `hsl(${h} ${s}% ${l}%)`;
};
const hslA = (hex: string, a: number) => {
  const {
    h,
    s,
    l
  } = hexToHsl(hex);
  return `hsl(${h} ${s}% ${l}% / ${a})`;
};
const ChatAnalytics = () => {
  const {
    clientId
  } = useParams<{
    clientId: string;
  }>();
  const {
    user
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
   const outletContext = useOutletContext<{ campaignId: string | null; onHeaderActions?: (actions: ReactNode) => void } | undefined>();
  const selectedCampaignId = outletContext?.campaignId || null;
  const onHeaderActions = outletContext?.onHeaderActions;

  // Determine analytics type and active tab from URL
  const isVoice = location.pathname.includes('/voice-ai/');
  const isChatTab = location.pathname.endsWith('/chat-with-ai');
  const analyticsType = isVoice ? 'voice' : 'text';
  const activeTab = isChatTab ? 'chat' : 'dashboard';
  const {
    toast
  } = useToast();
  const {
    sendAnalyticsToWebhook: sendTextAnalyticsToWebhook,
    sending: textWebhookSending,
    lastError: textWebhookError,
    clearError: clearTextWebhookError,
    stageDescription: textStageDescription,
  } = useAnalyticsWebhook(clientId || '', 'text');
  const {
    sendAnalyticsToWebhook: sendVoiceAnalyticsToWebhook,
    sending: voiceWebhookSending,
    lastError: voiceWebhookError,
    clearError: clearVoiceWebhookError,
    stageDescription: voiceStageDescription,
  } = useAnalyticsWebhook(clientId || '', 'voice');
  const {
    webhooks,
    loading: webhooksLoading
  } = useClientWebhooks(clientId);
  // Check if module cache is warm for this client
  const cacheWarm = moduleCache.clientId === clientId && moduleCache.hasFetched;

  const [client, setClient] = useState<Client | null>(() => cacheWarm ? moduleCache.client : null);
  const [loading, setLoading] = useState(() => !cacheWarm);
  const [configuring, setConfiguring] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [lastError, setLastError] = useState<ParsedError | null>(null);
  const [dataStale, setDataStale] = useState(false);
  
  // Combined webhook error from the hook
  const webhookError = analyticsType === 'text' ? textWebhookError : voiceWebhookError;
  const clearWebhookError = analyticsType === 'text' ? clearTextWebhookError : clearVoiceWebhookError;
  const [textCustomMetrics, setTextCustomMetrics] = useState<CustomMetric[]>(() => cacheWarm && moduleCache.textCustomMetrics ? moduleCache.textCustomMetrics : []);
  const [voiceCustomMetrics, setVoiceCustomMetrics] = useState<CustomMetric[]>(() => cacheWarm && moduleCache.voiceCustomMetrics ? moduleCache.voiceCustomMetrics : []);
  const [initialLoadComplete, setInitialLoadComplete] = useState(() => cacheWarm);
  const [metricColors, setMetricColors] = useState<Record<string, string>>(() => cacheWarm && moduleCache.metricColors ? moduleCache.metricColors : {});
  const [hasSupabaseConfig, setHasSupabaseConfig] = useState(() => cacheWarm ? moduleCache.hasSupabaseConfig : false);
  const [hasLLMConfig, setHasLLMConfig] = useState(() => cacheWarm ? moduleCache.hasLLMConfig : false);

  // Metric editing dialog state
  const [editingMetric, setEditingMetric] = useState<CustomMetric | null>(null);
  const [metricDialogOpen, setMetricDialogOpen] = useState(false);
  const [gridEditWidget, setGridEditWidget] = useState<any | null>(null);
  const [gridDeleteWidget, setGridDeleteWidget] = useState<any | null>(null);

  // Metric analysis cache: metric_id → time-series data built from AI matches
  const [metricAnalysisTimeSeries, setMetricAnalysisTimeSeries] = useState<Record<string, Array<{ date: string; count: number }>>>({});

  // AI-formatted chart data cache: metric_id → structured chart data from format-metric-chart edge function
  const [aiFormattedChartData, setAiFormattedChartData] = useState<Record<string, any>>({});

  // Helper: convert AI analysis matches (with timestamps) to time-series data
  const buildTimeSeriesFromMatches = useCallback((matches: Array<{ timestamp?: string; session_id?: string }>) => {
    if (!matches || matches.length === 0) return [];
    const dateMap = new Map<string, number>();
    for (const match of matches) {
      if (!match.timestamp) continue;
      const d = new Date(match.timestamp);
      if (isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      dateMap.set(key, (dateMap.get(key) || 0) + 1);
    }
    // Fill gaps
    const sortedDates = Array.from(dateMap.keys()).sort();
    if (sortedDates.length >= 2) {
      const start = new Date(sortedDates[0] + 'T00:00:00');
      const end = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00');
      const cursor = new Date(start);
      while (cursor <= end) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const day = String(cursor.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${day}`;
        if (!dateMap.has(key)) dateMap.set(key, 0);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return Array.from(dateMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, []);
  
  const [conversationsDrawerOpen, setConversationsDrawerOpen] = useState(false);
  const [selectedMetricForDrawer, setSelectedMetricForDrawer] = useState<string>('');
  const [drawerAiMatches, setDrawerAiMatches] = useState<AiMatch[] | undefined>(undefined);
  const [isAnalyzingMetric, setIsAnalyzingMetric] = useState(false);
  const [refreshingMetricIds, setRefreshingMetricIds] = useState<Set<string>>(new Set());

  // Request deduplication flags
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [clientWebhookUrl, setClientWebhookUrl] = useState<string | null>(() => cacheWarm ? moduleCache.clientWebhookUrl : null);
  const disableSend = useMemo(() => analyzing || textWebhookSending || voiceWebhookSending || !initialLoadComplete && isLoadingData, [analyzing, textWebhookSending, voiceWebhookSending, initialLoadComplete, isLoadingData]);

  // Configuration state
  const [supabaseConfig, setSupabaseConfig] = useState<SupabaseConfig>(() => cacheWarm && moduleCache.supabaseConfig ? moduleCache.supabaseConfig : {
    url: '',
    serviceKey: '',
    tableName: ''
  });
  const [configSaved, setConfigSaved] = useState(() => cacheWarm ? moduleCache.configSaved : false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  // TEXT CHAT ANALYTICS STATE
  const [textTimeRange, setTextTimeRange] = useState(() => {
    const saved = localStorage.getItem(`text_dashboard_time_range_${clientId}`);
    return saved || '7';
  });
  const [textCustomStartDate, setTextCustomStartDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`text_dashboard_custom_start_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });
  const [textCustomEndDate, setTextCustomEndDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`text_dashboard_custom_end_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });
  const [textWebhookDataCache, setTextWebhookDataCache] = useState<Record<string, {
    data: any;
    lastRefreshed: Date;
  }>>(() => cacheWarm ? moduleCache.textWebhookData : {});
  const [textChatTimeRange, setTextChatTimeRange] = useState(() => {
    const saved = localStorage.getItem(`text_chat_time_range_${clientId}`);
    return saved || '7';
  });
  const [textChatCustomStartDate, setTextChatCustomStartDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`text_chat_custom_start_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });
  const [textChatCustomEndDate, setTextChatCustomEndDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`text_chat_custom_end_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });

  // VOICE CHAT ANALYTICS STATE
  const [voiceTimeRange, setVoiceTimeRange] = useState(() => {
    const saved = localStorage.getItem(`voice_dashboard_time_range_${clientId}`);
    return saved || '7';
  });
  const [voiceCustomStartDate, setVoiceCustomStartDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`voice_dashboard_custom_start_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });
  const [voiceCustomEndDate, setVoiceCustomEndDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`voice_dashboard_custom_end_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });
  const [voiceWebhookDataCache, setVoiceWebhookDataCache] = useState<Record<string, {
    data: any;
    lastRefreshed: Date;
  }>>(() => cacheWarm ? moduleCache.voiceWebhookData : {});
  const [voiceChatTimeRange, setVoiceChatTimeRange] = useState(() => {
    const saved = localStorage.getItem(`voice_chat_time_range_${clientId}`);
    return saved || '7';
  });
  const [voiceChatCustomStartDate, setVoiceChatCustomStartDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`voice_chat_custom_start_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });
  const [voiceChatCustomEndDate, setVoiceChatCustomEndDate] = useState<Date | undefined>(() => {
    const saved = localStorage.getItem(`voice_chat_custom_end_${clientId}`);
    return saved ? new Date(saved) : undefined;
  });

  // Derived state based on analytics type (text/voice from URL)
  const timeRange = analyticsType === 'text' ? textTimeRange : voiceTimeRange;
  const setTimeRange = analyticsType === 'text' ? setTextTimeRange : setVoiceTimeRange;
  const customStartDate = analyticsType === 'text' ? textCustomStartDate : voiceCustomStartDate;
  const setCustomStartDate = analyticsType === 'text' ? setTextCustomStartDate : setVoiceCustomStartDate;
  const customEndDate = analyticsType === 'text' ? textCustomEndDate : voiceCustomEndDate;
  const setCustomEndDate = analyticsType === 'text' ? setTextCustomEndDate : setVoiceCustomEndDate;
  const webhookDataCache = analyticsType === 'text' ? textWebhookDataCache : voiceWebhookDataCache;
  const setWebhookDataCache = analyticsType === 'text' ? setTextWebhookDataCache : setVoiceWebhookDataCache;
  
  // CRITICAL FIX: Derive currentWebhookData and lastRefreshed directly from cache + timeRange
  // This eliminates race conditions between effects that caused flicker
  const currentWebhookData = useMemo(() => {
    const cache = analyticsType === 'text' ? textWebhookDataCache : voiceWebhookDataCache;
    const data = cache[timeRange]?.data ?? null;
    if (!data || analyticsType !== 'voice') return data;
    // Derive the "Call Recordings & Transcripts" table shape (TranscriptRecord[])
    // from conversations_list (voice only). compute-analytics now carries
    // recording_url/public_log_url/transcript per call, so the table populates
    // instead of showing 0 CALLS. Skip if an upstream payload already set the key.
    if (data['Transcript & Recording URL']) return data;
    const convos = data.conversations_list || data.Conversations_List
      || data.metrics?.conversations_list || data.metrics?.Conversations_List;
    if (!Array.isArray(convos) || convos.length === 0) return data;
    const recordings = convos.map((c: any, i: number) => ({
      Id: i + 1,
      Timestamp: c.first_timestamp || '',
      Session_Id: c.session_id || '',
      Call_Recording: c.recording_url || c.public_log_url || '',
      Call_Transcript: c.transcript
        || (Array.isArray(c.messages)
          ? c.messages.map((m: any) => `${m.role === 'ai' || m.role === 'agent' ? 'Agent' : 'User'}: ${m.content}`).join('\n')
          : ''),
    }));
    return { ...data, 'Transcript & Recording URL': recordings };
  }, [analyticsType, textWebhookDataCache, voiceWebhookDataCache, timeRange]);

  const lastRefreshed = useMemo(() => {
    const cache = analyticsType === 'text' ? textWebhookDataCache : voiceWebhookDataCache;
    return cache[timeRange]?.lastRefreshed ?? null;
  }, [analyticsType, textWebhookDataCache, voiceWebhookDataCache, timeRange]);

  const displayLastRefreshed = useMemo(() => {
    if (lastRefreshed) return lastRefreshed;
    const cache = analyticsType === 'text' ? textWebhookDataCache : voiceWebhookDataCache;
    const allRefreshes = Object.values(cache)
      .map(entry => entry.lastRefreshed)
      .filter((value): value is Date => value instanceof Date && !isNaN(value.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());

    return allRefreshes[0] ?? null;
  }, [analyticsType, textWebhookDataCache, voiceWebhookDataCache, lastRefreshed]);

  const chatTimeRange = analyticsType === 'text' ? textChatTimeRange : voiceChatTimeRange;
  const setChatTimeRange = analyticsType === 'text' ? setTextChatTimeRange : setVoiceChatTimeRange;
  const chatCustomStartDate = analyticsType === 'text' ? textChatCustomStartDate : voiceChatCustomStartDate;
  const setChatCustomStartDate = analyticsType === 'text' ? setTextChatCustomStartDate : setVoiceChatCustomStartDate;
  const chatCustomEndDate = analyticsType === 'text' ? textChatCustomEndDate : voiceChatCustomEndDate;
  const setChatCustomEndDate = analyticsType === 'text' ? setTextChatCustomEndDate : setVoiceChatCustomEndDate;
  const customMetrics = analyticsType === 'text' ? textCustomMetrics : voiceCustomMetrics;
  const setCustomMetrics = analyticsType === 'text' ? setTextCustomMetrics : setVoiceCustomMetrics;
  const sendAnalyticsToWebhook = analyticsType === 'text' ? sendTextAnalyticsToWebhook : sendVoiceAnalyticsToWebhook;
  const webhookSending = analyticsType === 'text' ? textWebhookSending : voiceWebhookSending;

  const refreshButtonClassName = "flex items-center gap-2";

  // Track local writes so DB sync can't temporarily overwrite fresh webhook results
  const lastLocalWriteRef = useRef<Record<string, number>>({});
  const hasLoadedInitialDataRef = useRef(false);

  // ── Sync state → module cache so remounts are instant ──
  useEffect(() => {
    if (!clientId) return;
    moduleCache.clientId = clientId;
    moduleCache.textWebhookData = textWebhookDataCache;
    moduleCache.voiceWebhookData = voiceWebhookDataCache;
    moduleCache.textCustomMetrics = textCustomMetrics;
    moduleCache.voiceCustomMetrics = voiceCustomMetrics;
    moduleCache.client = client;
    moduleCache.metricColors = metricColors;
    moduleCache.clientWebhookUrl = clientWebhookUrl;
    moduleCache.supabaseConfig = supabaseConfig;
    moduleCache.configSaved = configSaved;
    moduleCache.hasSupabaseConfig = hasSupabaseConfig;
    moduleCache.hasLLMConfig = hasLLMConfig;
    if (initialLoadComplete) moduleCache.hasFetched = true;
  });

  // Persist active tab selection to localStorage
  useEffect(() => {
    if (clientId && activeTab) {
      localStorage.setItem(`chat_analytics_tab_${clientId}`, activeTab);
    }
  }, [activeTab, clientId]);

  // Reset module cache and one-time initial loader when client changes
  useEffect(() => {
    const isSameClient = moduleCache.clientId === clientId && moduleCache.hasFetched;
    if (!isSameClient) {
      // Clear stale module cache for the new client
      moduleCache.clientId = null;
      moduleCache.hasFetched = false;
      moduleCache.client = null;
      moduleCache.textWebhookData = {};
      moduleCache.voiceWebhookData = {};
      moduleCache.textCustomMetrics = null;
      moduleCache.voiceCustomMetrics = null;
      moduleCache.metricColors = null;
      moduleCache.clientWebhookUrl = null;
      moduleCache.supabaseConfig = null;
      moduleCache.configSaved = false;
      moduleCache.hasSupabaseConfig = false;
      moduleCache.hasLLMConfig = false;
      hasLoadedInitialDataRef.current = false;
      setInitialLoadComplete(false);
    }
  }, [clientId, user]);

  // Helper function to format time in user's timezone
  const formatInUserTimezone = (date: Date): string => {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  };

  // Load metric color preferences and subscribe to real-time updates
  const metricColorsLoadedRef = useRef(cacheWarm);
  useEffect(() => {
    // Skip initial load if cache is warm — colors are already in state
    if (metricColorsLoadedRef.current) {
      metricColorsLoadedRef.current = false;
    } else {
      const loadMetricColors = async () => {
        if (!clientId) return;
        try {
          const {
            data,
            error
          } = await supabase.from('metric_color_preferences').select('metric_name, color').eq('client_id', clientId);
          if (error) throw error;
          const colorMap: Record<string, string> = {};
          data?.forEach(item => {
            colorMap[item.metric_name] = item.color;
          });
          setMetricColors(colorMap);
        } catch (error) {
          console.error('Error loading metric colors:', error);
        }
      };
      loadMetricColors();
    }

    // Subscribe to real-time color preference changes
    const channel = supabase.channel('metric_color_changes').on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'metric_color_preferences',
      filter: `client_id=eq.${clientId}`
    }, payload => {
      console.log('Metric color changed:', payload);
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const newRecord = payload.new as {
          metric_name: string;
          color: string;
        };
        setMetricColors(prev => ({
          ...prev,
          [newRecord.metric_name]: newRecord.color
        }));
      } else if (payload.eventType === 'DELETE') {
        const oldRecord = payload.old as {
          metric_name: string;
        };
        setMetricColors(prev => {
          const updated = {
            ...prev
          };
          delete updated[oldRecord.metric_name];
          return updated;
        });
      }
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  // Persist TEXT dashboard time range and custom dates
  useEffect(() => {
    if (clientId) {
      localStorage.setItem(`text_dashboard_time_range_${clientId}`, textTimeRange);
      if (textCustomStartDate) {
        localStorage.setItem(`text_dashboard_custom_start_${clientId}`, textCustomStartDate.toISOString());
      } else {
        localStorage.removeItem(`text_dashboard_custom_start_${clientId}`);
      }
      if (textCustomEndDate) {
        localStorage.setItem(`text_dashboard_custom_end_${clientId}`, textCustomEndDate.toISOString());
      } else {
        localStorage.removeItem(`text_dashboard_custom_end_${clientId}`);
      }
    }
  }, [textTimeRange, textCustomStartDate, textCustomEndDate, clientId]);

  // Persist TEXT chat time range and custom dates
  useEffect(() => {
    if (clientId) {
      localStorage.setItem(`text_chat_time_range_${clientId}`, textChatTimeRange);
      if (textChatCustomStartDate) {
        localStorage.setItem(`text_chat_custom_start_${clientId}`, textChatCustomStartDate.toISOString());
      } else {
        localStorage.removeItem(`text_chat_custom_start_${clientId}`);
      }
      if (textChatCustomEndDate) {
        localStorage.setItem(`text_chat_custom_end_${clientId}`, textChatCustomEndDate.toISOString());
      } else {
        localStorage.removeItem(`text_chat_custom_end_${clientId}`);
      }
    }
  }, [textChatTimeRange, textChatCustomStartDate, textChatCustomEndDate, clientId]);

  // Persist VOICE dashboard time range and custom dates
  useEffect(() => {
    if (clientId) {
      localStorage.setItem(`voice_dashboard_time_range_${clientId}`, voiceTimeRange);
      if (voiceCustomStartDate) {
        localStorage.setItem(`voice_dashboard_custom_start_${clientId}`, voiceCustomStartDate.toISOString());
      } else {
        localStorage.removeItem(`voice_dashboard_custom_start_${clientId}`);
      }
      if (voiceCustomEndDate) {
        localStorage.setItem(`voice_dashboard_custom_end_${clientId}`, voiceCustomEndDate.toISOString());
      } else {
        localStorage.removeItem(`voice_dashboard_custom_end_${clientId}`);
      }
    }
  }, [voiceTimeRange, voiceCustomStartDate, voiceCustomEndDate, clientId]);

  // Persist VOICE chat time range and custom dates
  useEffect(() => {
    if (clientId) {
      localStorage.setItem(`voice_chat_time_range_${clientId}`, voiceChatTimeRange);
      if (voiceChatCustomStartDate) {
        localStorage.setItem(`voice_chat_custom_start_${clientId}`, voiceChatCustomStartDate.toISOString());
      } else {
        localStorage.removeItem(`voice_chat_custom_start_${clientId}`);
      }
      if (voiceChatCustomEndDate) {
        localStorage.setItem(`voice_chat_custom_end_${clientId}`, voiceChatCustomEndDate.toISOString());
      } else {
        localStorage.removeItem(`voice_chat_custom_end_${clientId}`);
      }
    }
  }, [voiceChatTimeRange, voiceChatCustomStartDate, voiceChatCustomEndDate, clientId]);

  // Pre-defined questions
  const predefinedQuestions = ["Top 10 most asked questions", "Most common user concerns", "Frequent conversation topics", "Average conversation length", "User satisfaction indicators", "Peak conversation times"];

  // Optimized data loading with deduplication
  const loadInitialData = useCallback(async () => {
    if (hasLoadedInitialDataRef.current || !clientId || !user) return;

    hasLoadedInitialDataRef.current = true;
    
    // If module cache is warm for this client, skip loading state entirely
    // and refresh silently in the background
    const isCacheWarm = moduleCache.clientId === clientId && moduleCache.hasFetched;
    if (!isCacheWarm) {
      setIsLoadingData(true);
    }
    
    try {
      await Promise.all([fetchClientData(), loadPersistedWebhookData()]);
    } catch (error) {
      console.error('Error loading initial data:', error);
      hasLoadedInitialDataRef.current = false;
    } finally {
      // Always mark the initial attempt complete so the full-page loader gate
      // clears even on a zero-data / zero-config (is_system) client or a load
      // error. Previously this only ran on success, so those paths hung on the
      // RetroLoader forever.
      setInitialLoadComplete(true);
      setIsLoadingData(false);
    }
  }, [clientId, user]);
  useEffect(() => {
    loadInitialData();

    // Listen for custom metrics changes and refresh analytics data
    const handleCustomMetricsChange = async () => {
      console.log('Custom metrics changed - syncing list without reordering');
      if (!clientId) return;
      try {
        // Load text custom metrics
        const {
          data: textData,
          error: textError
        } = await supabase.from('custom_metrics').select('*').eq('client_id', clientId).eq('analytics_type', 'text').eq('is_active', true);
        if (!textError && textData) {
          setTextCustomMetrics(prev => {
            const map = new Map(textData.map(m => [m.id, m]));
            const ordered: typeof prev = [];
            const seen = new Set<string>();
            prev.forEach(m => {
              const updated = map.get(m.id);
              if (updated) {
                ordered.push({
                  ...m,
                  ...updated
                });
                seen.add(m.id);
              }
            });
            textData.forEach(m => {
              if (!seen.has(m.id)) ordered.push(m);
            });
            return ordered;
          });
        }

        // Load voice custom metrics
        const {
          data: voiceData,
          error: voiceError
        } = await supabase.from('custom_metrics').select('*').eq('client_id', clientId).eq('analytics_type', 'voice').eq('is_active', true);
        if (!voiceError && voiceData) {
          setVoiceCustomMetrics(prev => {
            const map = new Map(voiceData.map(m => [m.id, m]));
            const ordered: typeof prev = [];
            const seen = new Set<string>();
            prev.forEach(m => {
              const updated = map.get(m.id);
              if (updated) {
                ordered.push({
                  ...m,
                  ...updated
                });
                seen.add(m.id);
              }
            });
            voiceData.forEach(m => {
              if (!seen.has(m.id)) ordered.push(m);
            });
            return ordered;
          });
        }
      } catch (e) {
        console.warn('Failed to sync custom metrics list', e);
      }
    };

    // Listen for custom metric color changes
    const handleCustomMetricColorChange = (event: any) => {
      const {
        metricId,
        color
      } = event.detail;
      console.log('Custom metric color changed:', metricId, color);
      setTextCustomMetrics(prev => prev.map(m => m.id === metricId ? {
        ...m,
        color
      } : m));
      setVoiceCustomMetrics(prev => prev.map(m => m.id === metricId ? {
        ...m,
        color
      } : m));
    };

    // Listen for analytics cache invalidation
    const handleAnalyticsCacheInvalidation = () => {
      console.log('Analytics cache invalidated');
      // Do NOT clear existing data; mark as stale and prompt user to refresh
      setDataStale(true);
    };
    // Listen for late-arriving custom metric widgets from background polling
    const handleWidgetsUpdated = (event: any) => {
      const {
        widgets,
        analyticsType: targetAnalyticsType,
        timeRange: targetTimeRange,
      } = event.detail || {};

      if (!Array.isArray(widgets) || widgets.length === 0 || !targetAnalyticsType || !targetTimeRange || !clientId) {
        return;
      }

      console.log(`Received ${widgets.length} late-arriving custom metric widgets for ${targetAnalyticsType}/${targetTimeRange}`);

      const sourceCache = targetAnalyticsType === 'voice' ? voiceWebhookDataCache : textWebhookDataCache;
      const existingEntry = sourceCache[targetTimeRange];
      const existingData = existingEntry?.data && typeof existingEntry.data === 'object' ? existingEntry.data : {};
      const mergedData = {
        ...existingData,
        widgets: mergeAnalyticsWidgets(existingData.widgets || [], widgets),
      };
      const mergedAt = new Date();

      if (targetAnalyticsType === 'voice') {
        setVoiceWebhookDataCache(prev => ({
          ...prev,
          [targetTimeRange]: {
            data: mergedData,
            lastRefreshed: mergedAt,
          },
        }));
      } else {
        setTextWebhookDataCache(prev => ({
          ...prev,
          [targetTimeRange]: {
            data: mergedData,
            lastRefreshed: mergedAt,
          },
        }));
      }

      const tableName = targetAnalyticsType === 'voice' ? 'voice_chat_analytics' : 'chat_analytics';
      void supabase.from(tableName).upsert({
        client_id: clientId,
        time_range: targetTimeRange,
        metrics: mergedData,
        last_updated: mergedAt.toISOString(),
      }, {
        onConflict: 'client_id,time_range',
      }).then(({ error }) => {
        if (error) {
          console.error('Failed to persist late-arriving custom metric widgets:', error);
        }
      });
    };

    window.addEventListener('customMetricsChanged', handleCustomMetricsChange);
    window.addEventListener('customMetricColorChanged', handleCustomMetricColorChange as EventListener);
    window.addEventListener('invalidateAnalyticsCache', handleAnalyticsCacheInvalidation);
    window.addEventListener('analyticsWidgetsUpdated', handleWidgetsUpdated);
    return () => {
      window.removeEventListener('customMetricsChanged', handleCustomMetricsChange);
      window.removeEventListener('customMetricColorChanged', handleCustomMetricColorChange as EventListener);
      window.removeEventListener('invalidateAnalyticsCache', handleAnalyticsCacheInvalidation);
      window.removeEventListener('analyticsWidgetsUpdated', handleWidgetsUpdated);
    };
  }, [loadInitialData, clientId, textWebhookDataCache, voiceWebhookDataCache]);

  // Keep UI in sync with the database for the selected time range (no webhook auto-refresh)
  // Skip on first mount when cache is warm — loadPersistedWebhookData already populates cache
  const hasHydratedFromCacheRef = useRef(false);
  useEffect(() => {
    // If we just hydrated from module cache, skip the first sync to avoid redundant fetch
    if (hasHydratedFromCacheRef.current) {
      hasHydratedFromCacheRef.current = false;
      return;
    }

    let cancelled = false;

    const syncDataFromDatabase = async () => {
      if (!clientId || !user) return;

      try {
        const tableName = analyticsType === 'voice' ? 'voice_chat_analytics' : 'chat_analytics';
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .eq('client_id', clientId)
          .eq('time_range', timeRange)
          .maybeSingle();

        if (cancelled) return;
        if (error) {
          console.error('Error fetching analytics from database:', error);
          return;
        }
        if (!data) return;

        // Never hydrate dashboard cache with zero-value records (prevents tab-switch flicker)
        if (isZeroRecord(data.metrics)) {
          setWebhookDataCache(prev => {
            if (!prev[timeRange]) return prev;
            const next = { ...prev };
            delete next[timeRange];
            return next;
          });
          return;
        }

        const dbLastUpdated = new Date(data.last_updated);
        const localWriteKey = `${analyticsType}:${timeRange}`;
        const lastLocalWriteMs = lastLocalWriteRef.current[localWriteKey];

        // If we just wrote fresher data locally from the webhook, don't overwrite with older DB reads.
        if (typeof lastLocalWriteMs === 'number' && lastLocalWriteMs > dbLastUpdated.getTime()) {
          return;
        }

        // Only update cache - currentWebhookData/lastRefreshed are derived via useMemo
        setWebhookDataCache(prev => ({
          ...prev,
          [timeRange]: {
            data: data.metrics,
            lastRefreshed: dbLastUpdated
          }
        }));
      } catch (err) {
        console.error('Error syncing data from database:', err);
      }
    };

    syncDataFromDatabase();
    return () => {
      cancelled = true;
    };
  }, [timeRange, clientId, user, analyticsType]);

  // Optimized load persisted webhook data with caching
  const loadPersistedWebhookData = useCallback(async () => {
    if (!clientId || !user) return;
    try {
      // Load client configuration including webhook URL
      const {
        data: clientData,
        error: clientError
      } = await supabase.from('clients_public').select('supabase_url, has_supabase_service_key, analytics_webhook_url').eq('id', clientId).maybeSingle();
      if (clientError) throw clientError;

      if (clientData) {
        // Set webhook URL for validation
        setClientWebhookUrl(clientData.analytics_webhook_url || null);
        // G3-6: the service key is write-only (never read back). Presence comes
        // from has_supabase_service_key; the time-series reads run server-side.
        if (clientData.supabase_url && clientData.has_supabase_service_key) {
          setSupabaseConfig({
            url: clientData.supabase_url,
            serviceKey: '',
            tableName: '' // No longer needed
          });
          setConfigSaved(true);
        }
      }

      // Load TEXT analytics webhook data 
      const {
        data: textWebhookData,
        error: textWebhookError
      } = await supabase.from('chat_analytics').select('*').eq('client_id', clientId).order('last_updated', {
        ascending: false
      });
      if (textWebhookError) {
        console.error('Error loading text webhook data:', textWebhookError);
      } else if (textWebhookData && textWebhookData.length > 0) {
        const textCache: Record<string, {
          data: any;
          lastRefreshed: Date;
        }> = {};
        textWebhookData.forEach(record => {
          // Only load non-zero records to prevent showing corrupted data
          if (!isZeroRecord(record.metrics)) {
            textCache[record.time_range] = {
              data: record.metrics,
              lastRefreshed: new Date(record.last_updated)
            };
          } else {
            console.warn(`Skipped loading zero-value text analytics record for time range: ${record.time_range}`);
          }
        });
        setTextWebhookDataCache(textCache);
        // currentWebhookData/lastRefreshed are now derived via useMemo from the cache
      }

      // Load VOICE analytics webhook data
      const {
        data: voiceWebhookData,
        error: voiceWebhookError
      } = await supabase.from('voice_chat_analytics').select('*').eq('client_id', clientId).order('last_updated', {
        ascending: false
      });
      if (voiceWebhookError) {
        console.error('Error loading voice webhook data:', voiceWebhookError);
      } else if (voiceWebhookData && voiceWebhookData.length > 0) {
        const voiceCache: Record<string, {
          data: any;
          lastRefreshed: Date;
        }> = {};
        voiceWebhookData.forEach(record => {
          // Only load non-zero records to prevent showing corrupted data
          if (!isZeroRecord(record.metrics)) {
            voiceCache[record.time_range] = {
              data: record.metrics,
              lastRefreshed: new Date(record.last_updated)
            };
          } else {
            console.warn(`Skipped loading zero-value voice analytics record for time range: ${record.time_range}`);
          }
        });
        setVoiceWebhookDataCache(voiceCache);
        // currentWebhookData/lastRefreshed are now derived via useMemo from the cache
      }

      // Load TEXT custom metrics
      const {
        data: textCustomMetricsData,
        error: textCustomMetricsError
      } = await supabase.from('custom_metrics').select('*').eq('client_id', clientId).eq('analytics_type', 'text').eq('is_active', true).order('sort_order', { ascending: true });
      if (textCustomMetricsError) {
        console.error('Error loading text custom metrics:', textCustomMetricsError);
      } else {
        const existing = textCustomMetricsData || [];
        // Seed default metrics if none exist
        const defaultTextNames = ['Total Conversations', 'Total Bot Messages', 'Total Human Messages', 'New Users'];
        const existingNames = new Set(existing.map(m => m.name));
        const missingDefaults = defaultTextNames.filter(n => !existingNames.has(n));
        if (missingDefaults.length > 0) {
          const COLOR_MAP: Record<string, string> = { 'Total Conversations': '#3b82f6', 'Total Bot Messages': '#10b981', 'Total Human Messages': '#ec4899', 'New Users': '#8b5cf6' };
          const PROMPT_MAP: Record<string, string> = { 'Total Conversations': 'Count total conversations in the chat data', 'Total Bot Messages': 'Count total bot messages sent', 'Total Human Messages': 'Count total human/user messages sent', 'New Users': 'Count new unique users interacting for the first time' };
          const toInsert = missingDefaults.map(name => ({ client_id: clientId, analytics_type: 'text' as const, name, color: COLOR_MAP[name] || '#3b82f6', description: '', prompt: PROMPT_MAP[name] || `Count ${name.toLowerCase()}` }));
          const { data: seeded } = await supabase.from('custom_metrics').insert(toInsert).select();
          if (seeded) {
            setTextCustomMetrics([...existing, ...seeded]);
          } else {
            setTextCustomMetrics(existing);
          }
        } else {
          setTextCustomMetrics(existing);
        }
      }

      // Load VOICE custom metrics
      const {
        data: voiceCustomMetricsData,
        error: voiceCustomMetricsError
      } = await supabase.from('custom_metrics').select('*').eq('client_id', clientId).eq('analytics_type', 'voice').eq('is_active', true).order('sort_order', { ascending: true });
      if (voiceCustomMetricsError) {
        console.error('Error loading voice custom metrics:', voiceCustomMetricsError);
      } else {
        const existing = voiceCustomMetricsData || [];
        const defaultVoiceNames = ['Total Voice Call', 'New Users', 'Thank You Count', 'User Questions Asked'];
        const existingNames = new Set(existing.map(m => m.name));
        const missingDefaults = defaultVoiceNames.filter(n => !existingNames.has(n));
        if (missingDefaults.length > 0) {
          const COLOR_MAP: Record<string, string> = { 'Total Voice Call': '#3b82f6', 'New Users': '#8b5cf6', 'Thank You Count': '#f97316', 'User Questions Asked': '#6366f1' };
          const PROMPT_MAP: Record<string, string> = { 'Total Voice Call': 'Count total voice calls', 'New Users': 'Count new unique callers', 'Thank You Count': 'Count messages expressing gratitude', 'User Questions Asked': 'Count questions asked by callers' };
          const toInsert = missingDefaults.map(name => ({ client_id: clientId, analytics_type: 'voice' as const, name, color: COLOR_MAP[name] || '#3b82f6', description: '', prompt: PROMPT_MAP[name] || `Count ${name.toLowerCase()}` }));
          const { data: seeded } = await supabase.from('custom_metrics').insert(toInsert).select();
          if (seeded) {
            setVoiceCustomMetrics([...existing, ...seeded]);
          } else {
            setVoiceCustomMetrics(existing);
          }
        } else {
          setVoiceCustomMetrics(existing);
        }
      }

      // Load cached metric analysis results for chart-type metrics
      const allMetrics = [...(textCustomMetricsData || []), ...(voiceCustomMetricsData || [])];
      const chartMetricIds = allMetrics
        .filter(m => m.widget_type && m.widget_type !== 'number_card')
        .map(m => m.id);
      
      if (chartMetricIds.length > 0) {
        const { data: cachedAnalysis } = await supabase
          .from('metric_analysis_results' as any)
          .select('metric_id, results')
          .in('metric_id', chartMetricIds)
          .eq('client_id', clientId)
          .order('analysis_date', { ascending: false });
        
        if (cachedAnalysis && cachedAnalysis.length > 0) {
          const tsCache: Record<string, Array<{ date: string; count: number }>> = {};
          const seen = new Set<string>();
          for (const row of cachedAnalysis as any[]) {
            if (seen.has(row.metric_id)) continue; // only latest per metric
            seen.add(row.metric_id);
            const matches = Array.isArray(row.results) ? row.results : [];
            const ts = buildTimeSeriesFromMatches(matches);
            if (ts.length > 0) tsCache[row.metric_id] = ts;
          }
          setMetricAnalysisTimeSeries(tsCache);
        }
      }

    } catch (error: any) {
      console.error('Error loading persisted data:', error);
    }
  }, [clientId, user, buildTimeSeriesFromMatches]);
  const fetchClientData = useCallback(async () => {
    if (!clientId || !user) return;
    try {
      const {
        data,
        error
      } = await supabase.from('clients_public').select('id, name, has_openrouter_api_key, has_openai_api_key, supabase_url, has_supabase_service_key').eq('id', clientId).maybeSingle();
      if (error) throw error;

      if (!data) {
        toast({
          title: "Client Not Found",
          description: "The requested client could not be found or you don't have access.",
          variant: "destructive"
        });
        return;
      }

      setClient(data);

      // Check if Supabase is configured (URL and service key only - no table name required)
      const hasConfig = !!(data.supabase_url && data.has_supabase_service_key);
      setHasSupabaseConfig(hasConfig);

      // Check if LLMs (OpenRouter/OpenAI) are configured
      const hasLLMs = !!data.has_openrouter_api_key;
      setHasLLMConfig(hasLLMs);
    } catch (error: any) {
      console.error('Error fetching client:', error);
      toast({
        title: "Error",
        description: "Failed to fetch client data",
        variant: "destructive"
      });
      // Do NOT navigate(`/client/${clientId}`) here: the index route bounces
      // straight back to analytics/chatbot/dashboard, which remounts this page
      // and retries the failing fetch — an infinite redirect/remount loop that
      // shows the RetroLoader forever. Leave client null; the render falls
      // through to the empty state below.
    } finally {
      setLoading(false);
    }
  }, [clientId, user]);
  const saveConfiguration = async () => {
    if (!supabaseConfig.url || !supabaseConfig.serviceKey || !supabaseConfig.tableName) {
      toast({
        title: "Missing Configuration",
        description: "Please provide Supabase URL, Service Key, and Table Name",
        variant: "destructive"
      });
      return;
    }
    setConfiguring(true);
    try {
      // Test the connection first
      const testResponse = await supabase.functions.invoke('test-external-supabase', {
        body: {
          clientId,
          supabaseConfig,
          timeRange: '1'
        }
      });
      if (testResponse.error) {
        // When edge function returns non-2xx, Supabase wraps as error with the
        // Response on .context — pull the specific {success:false,error} body.
        let msg = testResponse.error.message || 'Failed to connect to external Supabase';
        try {
          const ctx = (testResponse.error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* keep the generic message */ }
        throw new Error(msg);
      }
      if (testResponse.data && (testResponse.data as any).success === false) {
        const errMsg = (testResponse.data as any).error || 'Failed to test connection';
        throw new Error(errMsg);
      }

      // Save configuration to database
      await supabase.from('clients').update({
        supabase_url: supabaseConfig.url,
        supabase_service_key: supabaseConfig.serviceKey,
        supabase_table_name: supabaseConfig.tableName
      }).eq('id', clientId);
      setConfigSaved(true);
      toast({
        title: "Configuration Saved",
        description: "Successfully connected to your Supabase instance"
      });
    } catch (error: any) {
      console.error('Error testing configuration:', error);
      toast({
        title: "Configuration Error",
        description: error.message || "Failed to connect to Supabase instance",
        variant: "destructive"
      });
    } finally {
      setConfiguring(false);
    }
  };

  // Save webhook data to database for persistence using existing structure
  const saveWebhookData = async (newData: any, dataTimeRange: string) => {
    if (!clientId) return;

    const isEmptyPayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return true;

      // If webhook sends an array, treat as empty/invalid for our dashboard
      if (Array.isArray(payload)) return payload.length === 0;

      // CRITICAL: Unwrap the n8n String envelope before checking
      // The webhook often returns {_type: "String", value: "...JSON with widgets..."}
      let unwrapped = payload;
      if (unwrapped._type === 'String' && typeof unwrapped.value === 'string') {
        try { unwrapped = JSON.parse(unwrapped.value); } catch { /* keep original */ }
      }
      // Also unwrap nested arrays
      if (Array.isArray(unwrapped)) unwrapped = unwrapped[0];

      // If the unwrapped payload has widgets or default_metrics arrays with data, it's NOT empty
      if (unwrapped && typeof unwrapped === 'object') {
        if (Array.isArray(unwrapped.widgets) && unwrapped.widgets.length > 0) return false;
        if (Array.isArray(unwrapped.default_metrics) && unwrapped.default_metrics.length > 0) return false;
      }

      const other = (unwrapped as any)?.["Other Metrics"];
      const otherHasAnyKey = !!other && typeof other === 'object' && Object.keys(other).length > 0;

      // Extract numeric values - handle both number and string representations
      const numericValues: number[] = [];
      for (const [key, v] of Object.entries(unwrapped || {})) {
        if (key === 'Other Metrics' || key === '_type' || key === 'value') continue;
        if (typeof v === 'number') {
          numericValues.push(v);
        } else if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '') {
          numericValues.push(Number(v));
        }
      }

      const allNumbersZero = numericValues.length > 0 && numericValues.every(n => n === 0);

      // If there are no numeric fields at all, consider it empty
      if (numericValues.length === 0 && !otherHasAnyKey) return true;

      // Common "empty" response pattern we see: all numeric fields are 0 and no other metrics
      return allNumbersZero && !otherHasAnyKey;
    };

    try {
      const existing = webhookDataCache[dataTimeRange]?.data;
      if (existing && isEmptyPayload(newData)) {
        // CRITICAL: Preserve last refreshed data; do not overwrite with an empty/zero payload.
        toast({
          title: 'Analytics not updated',
          description: 'The backend returned an empty/zero payload. Keeping your last refreshed data.',
          variant: 'destructive'
        });
        return;
      }

      const refreshTime = new Date();
      lastLocalWriteRef.current[`${analyticsType}:${dataTimeRange}`] = refreshTime.getTime();
      const tableName = analyticsType === 'voice' ? 'voice_chat_analytics' : 'chat_analytics';

      const { error } = await supabase.from(tableName).upsert(
        {
          client_id: clientId,
          time_range: dataTimeRange,
          metrics: newData as any,
          last_updated: refreshTime.toISOString()
        },
        { onConflict: 'client_id,time_range' }
      );
      if (error) throw error;

      setWebhookDataCache(prev => ({
        ...prev,
        [dataTimeRange]: {
          data: newData,
          lastRefreshed: refreshTime
        }
      }));
      // currentWebhookData/lastRefreshed are derived via useMemo - no need to set them directly

      // Verify data was saved by reading it back
      const { data: verifyData, error: verifyError } = await supabase
        .from(tableName)
        .select('*')
        .eq('client_id', clientId)
        .eq('time_range', dataTimeRange)
        .maybeSingle();

      if (verifyError || !verifyData) {
        console.warn('Data verification failed, attempting to save again');
        // Retry save once more
        await supabase.from(tableName).upsert(
          {
            client_id: clientId,
            time_range: dataTimeRange,
            metrics: newData as any,
            last_updated: refreshTime.toISOString()
          },
          { onConflict: 'client_id,time_range' }
        );
      } else {
        console.log(`${analyticsType} analytics data successfully saved and verified:`, verifyData);
      }
    } catch (error: any) {
      console.error('Error saving webhook data:', error);
      toast({
        title: 'Data Save Warning',
        description: 'Analytics data may not have been saved properly. Keeping your last refreshed data.',
        variant: 'destructive'
      });
    }
  };
  const saveChatMessage = async (message: ChatMessage) => {
    if (!clientId) return;
    try {
      await supabase.from('chat_analytics_messages').insert({
        client_id: clientId,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp.toISOString()
      });
    } catch (error: any) {
      console.error('Error saving chat message:', error);
    }
  };

  // Manual refresh function (direct webhook, no edge function)
  const refreshAnalytics = useCallback(async () => {
    if (analyzing || webhookSending) return; // Prevent multiple simultaneous requests

    // Snapshot the requested context so changing the dropdown (or switching Text/Voice) mid-request
    // cannot save/update the wrong time range.
    const requestedTimeRange = timeRange;
    const requestedAnalyticsType = analyticsType;

    setAnalyzing(true);
    setLastError(null);
    try {
      // Always get latest custom metrics for the refresh
      const { data: latestCustomMetrics, error: customMetricsError } = await supabase
        .from('custom_metrics')
        .select('*')
        .eq('client_id', clientId)
        .eq('analytics_type', requestedAnalyticsType)
        .eq('is_active', true);

      if (customMetricsError) {
        console.warn('Error loading custom metrics:', customMetricsError);
      } else {
        setCustomMetrics(latestCustomMetrics || []);
      }

      const activeCustomMetricIds = new Set((latestCustomMetrics || []).map(metric => metric.id));

      // Clear derived chart caches for the metrics being refreshed so the UI reuses
      // the incoming backend payload immediately instead of holding onto stale data.
      if (activeCustomMetricIds.size > 0) {
        setAiFormattedChartData(prev => {
          const next = { ...prev };
          activeCustomMetricIds.forEach(metricId => {
            delete next[metricId];
          });
          return next;
        });

        setMetricAnalysisTimeSeries(prev => {
          const next = { ...prev };
          activeCustomMetricIds.forEach(metricId => {
            delete next[metricId];
          });
          return next;
        });
      }

      const defaultMetricNameSet = new Set(
        (analyticsType === 'voice'
          ? ['Total Voice Call', 'New Users']
          : ['Total Conversations', 'Total Bot Messages', 'Total Human Messages', 'New Users']
        ).map(name => name.toLowerCase())
      );

      const currentCustomMetrics = (latestCustomMetrics || [])
        .filter(m => !defaultMetricNameSet.has((m.name || '').toLowerCase()))
        .map(m => ({
          id: m.id,
          name: m.name,
          description: m.description,
          prompt: m.prompt,
          color: m.color,
          widget_type: m.widget_type || 'number_card',
        }));

      const result = await sendAnalyticsToWebhook(
        requestedTimeRange === 'custom' ? 'custom' : requestedTimeRange,
        'manual',
        currentCustomMetrics,
        requestedTimeRange === 'custom' && customStartDate && customEndDate
          ? {
              startDate: format(customStartDate, 'yyyy-MM-dd'),
              endDate: format(customEndDate, 'yyyy-MM-dd')
            }
          : undefined
      );

      const ok = (result as any).success;
      if (!ok) {
        throw new Error('Failed to send analytics to webhook');
      }

      const data = typeof result === 'object' ? (result as any).data : null;
      if (data) {
        await saveWebhookData(data, requestedTimeRange);
      }

      setDataStale(false);
      toast({
        title: 'Analytics Sent',
        description: `Analytics request sent for ${requestedTimeRange} day${requestedTimeRange !== '1' ? 's' : ''}`
      });

      const allCustomMetrics = (latestCustomMetrics || []).filter(
        m => m.prompt && !defaultMetricNameSet.has((m.name || '').toLowerCase())
      );
      if (allCustomMetrics.length > 0 && data) {
        // Get conversations list from webhook data
        const unwrapped = unwrapWebhookPayload(data);
        const conversations = unwrapped?.Conversations_List || unwrapped?.conversations_list || unwrapped?.metrics?.Conversations_List || [];

        // AWAIT all format calls so data is ready before overlay dismisses
        const formatPromises = allCustomMetrics.map(async (metric) => {
          try {
            const wt = metric.widget_type || 'number_card';
            const { data: formatResult, error: formatError } = await supabase.functions.invoke('format-metric-chart', {
              body: {
                client_id: clientId,
                metric_name: metric.name,
                metric_prompt: metric.prompt,
                widget_type: wt,
                time_range: requestedTimeRange,
                start_date: requestedTimeRange === 'custom' && customStartDate ? format(customStartDate, 'yyyy-MM-dd') : undefined,
                end_date: requestedTimeRange === 'custom' && customEndDate ? format(customEndDate, 'yyyy-MM-dd') : undefined,
                raw_webhook_data: data,
                conversations_list: conversations.length > 0 ? conversations : undefined,
              },
            });
            if (!formatError && formatResult?.success && formatResult?.chart_data) {
              console.log(`AI formatted chart data for "${metric.name}":`, formatResult.chart_data);
              setAiFormattedChartData(prev => ({ ...prev, [metric.id]: formatResult.chart_data }));

              // Also build time series from data_points if available (for line/bar charts)
              if (formatResult.chart_data.data_points && Array.isArray(formatResult.chart_data.data_points)) {
                const ts = formatResult.chart_data.data_points.map((dp: any) => ({
                  date: dp.date || dp.name || '',
                  count: dp.value || 0,
                }));
                if (ts.length > 0) {
                  setMetricAnalysisTimeSeries(prev => ({ ...prev, [metric.id]: ts }));
                }
              }
            } else {
              console.warn(`AI format failed for "${metric.name}":`, formatError || formatResult);
              // Fallback: try old analyze-metric if OpenRouter key is configured.
              // G3-6: analyze-metric reads the key server-side from client_id.
              if (conversations.length > 0 && wt !== 'number_card' && hasLLMConfig) {
                const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-metric', {
                  body: {
                    client_id: clientId,
                    metric_id: metric.id,
                    metric_prompt: metric.prompt,
                    metric_name: metric.name,
                    conversations,
                    time_range: requestedTimeRange,
                  },
                });
                if (!analysisError && analysisData?.matches) {
                  const ts = buildTimeSeriesFromMatches(analysisData.matches);
                  setMetricAnalysisTimeSeries(prev => ({ ...prev, [metric.id]: ts }));
                }
              }
            }
          } catch (err) {
            console.error(`AI chart formatting failed for metric ${metric.name}:`, err);
          }
        });
        // Do not block the primary analytics render on secondary chart formatting.
        void Promise.all(formatPromises);
      }
    } catch (error: any) {
      console.error('Analytics refresh failed:', error);
      const parsedError = parseBackendError(error);
      setLastError(parsedError);

      // IMPORTANT: do NOT clear currentWebhookData/lastRefreshed — preserve last refreshed data.
      toast({
        title: 'Refresh failed',
        description: 'Keeping your last refreshed data.',
        variant: 'destructive'
      });
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, webhookSending, clientId, timeRange, customStartDate, customEndDate, toast, clientWebhookUrl, sendAnalyticsToWebhook, analyticsType, webhookDataCache, buildTimeSeriesFromMatches]);

  // Per-widget refresh: sends only a single metric to n8n for update
  const refreshSingleMetric = useCallback(async (metric: CustomMetric) => {
    if (!clientId || refreshingMetricIds.has(metric.id)) return;

    const requestedTimeRange = timeRange;

    setRefreshingMetricIds(prev => new Set(prev).add(metric.id));

    try {
      // Clear cached chart data for this metric
      setAiFormattedChartData(prev => { const n = { ...prev }; delete n[metric.id]; return n; });
      setMetricAnalysisTimeSeries(prev => { const n = { ...prev }; delete n[metric.id]; return n; });

      // Send only this single metric to webhook
      const singleMetric = [{
        id: metric.id,
        name: metric.name,
        description: metric.prompt,
        prompt: metric.prompt,
        widget_type: metric.widget_type || 'number_card',
      }];

      const result = await sendAnalyticsToWebhook(
        requestedTimeRange === 'custom' ? 'custom' : requestedTimeRange,
        'custom-metric',
        singleMetric,
        requestedTimeRange === 'custom' && customStartDate && customEndDate
          ? { startDate: format(customStartDate, 'yyyy-MM-dd'), endDate: format(customEndDate, 'yyyy-MM-dd') }
          : undefined
      );

      const ok = (result as any).success;
      const data = typeof result === 'object' ? (result as any).data : null;

      if (ok && data) {
        // Save webhook data (merged with existing)
        await saveWebhookData(data, requestedTimeRange);

        // Format this metric's chart with AI
        const unwrapped = unwrapWebhookPayload(data);
        const conversations = unwrapped?.Conversations_List || unwrapped?.conversations_list || unwrapped?.metrics?.Conversations_List || [];

        const wt = metric.widget_type || 'number_card';
        const { data: formatResult, error: formatError } = await supabase.functions.invoke('format-metric-chart', {
          body: {
            client_id: clientId,
            metric_name: metric.name,
            metric_prompt: metric.prompt,
            widget_type: wt,
            time_range: requestedTimeRange,
            start_date: requestedTimeRange === 'custom' && customStartDate ? format(customStartDate, 'yyyy-MM-dd') : undefined,
            end_date: requestedTimeRange === 'custom' && customEndDate ? format(customEndDate, 'yyyy-MM-dd') : undefined,
            raw_webhook_data: data,
            conversations_list: conversations.length > 0 ? conversations : undefined,
          },
        });

        if (!formatError && formatResult?.success && formatResult?.chart_data) {
          setAiFormattedChartData(prev => ({ ...prev, [metric.id]: formatResult.chart_data }));
          if (formatResult.chart_data.data_points && Array.isArray(formatResult.chart_data.data_points)) {
            const ts = formatResult.chart_data.data_points.map((dp: any) => ({
              date: dp.date || dp.name || '',
              count: dp.value || 0,
            }));
            if (ts.length > 0) {
              setMetricAnalysisTimeSeries(prev => ({ ...prev, [metric.id]: ts }));
            }
          }
        }

        toast({ title: 'Metric Refreshed', description: `"${metric.name}" has been updated.` });
      } else {
        toast({ title: 'Refresh Failed', description: `Failed to refresh "${metric.name}".`, variant: 'destructive' });
      }
    } catch (err: any) {
      console.error(`Single metric refresh failed for ${metric.name}:`, err);
      toast({ title: 'Refresh Failed', description: err.message || 'Unexpected error', variant: 'destructive' });
    } finally {
      setRefreshingMetricIds(prev => { const n = new Set(prev); n.delete(metric.id); return n; });
    }
  }, [clientId, refreshingMetricIds, timeRange, customStartDate, customEndDate, sendAnalyticsToWebhook, toast]);
  const resetConfiguration = async () => {
    try {
      await supabase.from('clients').update({
        supabase_url: null,
        supabase_service_key: null,
        supabase_table_name: null
      }).eq('id', clientId);
      setSupabaseConfig({
        url: '',
        serviceKey: '',
        tableName: ''
      });
      setConfigSaved(false);
      setShowResetDialog(false);
      toast({
        title: "Configuration Reset",
        description: "Supabase configuration has been cleared"
      });
    } catch (error: any) {
      console.error('Error resetting configuration:', error);
      toast({
        title: "Error",
        description: "Failed to reset configuration",
        variant: "destructive"
      });
    }
  };

  // Resolve metric value from webhook data
  const unwrapWebhookPayload = (payload: any): any => {
    let current = payload;

    // Unwrap common envelope shapes safely
    for (let i = 0; i < 5; i++) {
      if (Array.isArray(current)) {
        current = current[0];
        continue;
      }
      if (!current || typeof current !== 'object') break;

      // Handle n8n String envelope: {"_type": "String", "value": "...json..."}
      if (current._type === 'String' && typeof current.value === 'string') {
        try { current = JSON.parse(current.value); } catch { break; }
        continue;
      }

      if (current.data && typeof current.data === 'object') {
        current = current.data;
        continue;
      }
      if (current.result && typeof current.result === 'object') {
        current = current.result;
        continue;
      }
      break;
    }

    // Handle widgets array format: flatten into a keyed object for easy lookup
    if (current && typeof current === 'object' && Array.isArray(current.widgets)) {
      const flattened: Record<string, any> = { _widgets: current.widgets };
      
      // Preserve default_metrics array for separation logic
      if (Array.isArray(current.default_metrics)) {
        flattened._default_metrics = current.default_metrics;
        flattened._default_metric_titles = new Set(current.default_metrics.map((w: any) => w.title || w.name));
        for (const metric of current.default_metrics) {
          const metricTitle = metric.title || metric.name;
          if (!metricTitle) continue;
          if (metric.value !== undefined) {
            flattened[metricTitle] = metric.value;
          }
        }
      }
      
      // Preserve summary and conversations_list
      if (current.summary) flattened._summary = current.summary;
      if (current.conversations_list) flattened.Conversations_List = current.conversations_list;
      
      // Build a lowercase lookup map for case-insensitive metric resolution
      const lowerMap: Record<string, any> = {};
      const lowerWidgetMap: Record<string, any> = {};
      
      for (const key of Object.keys(flattened)) {
        if (!key.startsWith('_')) {
          lowerMap[key.toLowerCase()] = flattened[key];
        }
      }

      for (const widget of current.widgets) {
        const widgetTitle = widget.title || widget.name;
        if (!widgetTitle) continue;
        const numberVal = widget.formats?.number_card?.value ?? widget.data?.value;
        if (numberVal !== undefined) {
          flattened[widgetTitle] = numberVal;
          lowerMap[widgetTitle.toLowerCase()] = numberVal;
        }
        flattened[`__widget_${widgetTitle}`] = widget;
        if (widget.id) {
          flattened[`__widget_id_${widget.id}`] = widget;
        }
        lowerWidgetMap[widgetTitle.toLowerCase()] = widget;
      }
      
      flattened._lowerMap = lowerMap;
      flattened._lowerWidgetMap = lowerWidgetMap;
      
      return flattened;
    }

    return current && typeof current === 'object' ? current : null;
  };

  const resolveMetricValue = (metricName: string, webhookData: any) => {
    const result = unwrapWebhookPayload(webhookData);
    if (!result) return null;

    const metricsContainer = result.metrics && typeof result.metrics === 'object' ? result.metrics : result;
    const lowerMap = metricsContainer._lowerMap || {};

    // Special case: Total Conversations should be the number of unique sessions/conversations
    if (metricName === 'Total Conversations') {
      const directVal = metricsContainer['Total Conversations'] ?? lowerMap['total conversations'];
      if (directVal !== undefined) return directVal;
      const conversationList = result?.Conversations_List || result?.conversations_list || [];
      if (Array.isArray(conversationList) && conversationList.length > 0) return conversationList.length;
    }

    // Trust webhook numbers directly for built-in metrics
    const keyMap: Record<string, string[]> = {
      'Total Bot Messages': ['Total Bot Messages', 'Bot_Messages', 'Bot Messages', 'Total_Bot_Messages'],
      'Total Human Messages': ['Total Human Messages', 'Total_Human_Messages', 'Human_Messages', 'Human Messages', 'Total User Messages', 'User_Messages', 'Total_User_Messages', 'User Messages'],
      'Bot Messages': ['Bot_Messages', 'Bot Messages', 'Total Bot Messages'],
      'New Users': ['New_Users', 'New Users', 'New User Messages', 'Total Unique Users', 'Total_Unique_Users'],
      'Thank You Count': ['Thank You Count', 'Thank_You_Count', 'Thank You'],
      'User Questions Asked': ['Questions Asked', 'User Questions Asked', 'Questions Asked'],
      'Questions Asked': ['Questions Asked', 'User Questions Asked'],
      'Total Voice Call': ['Total Voice Call'],
    };

    const keys = keyMap[metricName];
    if (keys) {
      for (const key of keys) {
        if (metricsContainer[key] !== undefined) return metricsContainer[key];
      }
    }

    // Direct exact match
    if (metricsContainer[metricName] !== undefined) return metricsContainer[metricName];

    // Underscore variant
    const underscored = metricName.replace(/ /g, '_');
    if (metricsContainer[underscored] !== undefined) return metricsContainer[underscored];

    // Case-insensitive lookup via lowerMap
    const lowerName = metricName.toLowerCase();
    if (lowerMap[lowerName] !== undefined) return lowerMap[lowerName];

    const other = metricsContainer['Other Metrics'] || metricsContainer.other_metrics;
    if (other && typeof other === 'object') {
      if (other[metricName] !== undefined) return other[metricName];
      if (keys) {
        for (const key of keys) {
          if (other[key] !== undefined) return other[key];
        }
      }
    }

    return null;
  };

  // ── Time series data from client's chat_history table ──────────────
  // Store raw messages so we can filter per-metric for widget graphs
  interface ChatHistoryMsg { timestamp: string; type: string; content: string; }
  const [chatHistoryMessages, setChatHistoryMessages] = useState<ChatHistoryMsg[] | null>(null);

  // Helper: get local YYYY-MM-DD from a timestamp (respects user's timezone)
  const toLocalDateKey = useCallback((ts: string): string => {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // Legacy: total messages grouped by date (used as fallback)
  const chatHistoryTimeSeries = useMemo(() => {
    if (!chatHistoryMessages || chatHistoryMessages.length === 0) return null;
    const dateMap = new Map<string, number>();
    for (const msg of chatHistoryMessages) {
      const dateKey = toLocalDateKey(msg.timestamp);
      dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + 1);
    }
    // Fill missing dates for continuous chart
    const sortedDates = Array.from(dateMap.keys()).sort();
    if (sortedDates.length >= 2) {
      const start = new Date(sortedDates[0] + 'T00:00:00');
      const end = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00');
      const cursor = new Date(start);
      while (cursor <= end) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const day = String(cursor.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${day}`;
        if (!dateMap.has(key)) dateMap.set(key, 0);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return Array.from(dateMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [chatHistoryMessages, toLocalDateKey]);

  useEffect(() => {
    if (!clientId || !hasSupabaseConfig) {
      setChatHistoryMessages(null);
      return;
    }

    let cancelled = false;

    const fetchTimeSeries = async () => {
      try {
        // Calculate date range
        let startDate: string;
        let endDate: string;
        if (timeRange === 'custom' && customStartDate && customEndDate) {
          startDate = startOfDay(customStartDate).toISOString();
          endDate = endOfDay(customEndDate).toISOString();
        } else {
          const days = parseInt(timeRange || '7');
          startDate = startOfDay(subDays(new Date(), isNaN(days) ? 7 : days)).toISOString();
          endDate = new Date().toISOString();
        }

        // G3-6: the external-supabase read runs server-side in get-chat-history
        // (date-range mode), so the service key never reaches the browser.
        const { data, error } = await supabase.functions.invoke('get-chat-history', {
          body: { clientId, mode: 'range', startDate, endDate },
        });
        if (error) throw error;
        const rows = (data?.rows ?? []) as Array<{ timestamp: string; message: any }>;

        const allMessages: ChatHistoryMsg[] = [];
        for (const row of rows) {
          let msgType = 'assistant';
          let msgContent = '';
          const m = row.message;
          if (typeof m === 'object' && m !== null) {
            msgContent = (m as any).content || (m as any).text || '';
            msgType = (m as any).role || (m as any).type || 'assistant';
          } else if (typeof m === 'string') {
            try { const p = JSON.parse(m); msgContent = p.content || p.text || m; msgType = p.role || p.type || 'assistant'; } catch { msgContent = m; }
          }
          if (['human', 'user', 'Human', 'User'].includes(msgType)) msgType = 'human';
          else msgType = 'assistant';
          allMessages.push({ timestamp: row.timestamp, type: msgType, content: msgContent });
        }

        if (!cancelled) {
          setChatHistoryMessages(allMessages.length > 0 ? allMessages : null);
        }
      } catch (err) {
        console.error('Failed to fetch time series from chat_history:', err);
        if (!cancelled) setChatHistoryMessages(null);
      }
    };

    fetchTimeSeries();
    return () => { cancelled = true; };
  }, [clientId, hasSupabaseConfig, timeRange, customStartDate, customEndDate]);

  // ── Auto-refresh when time range changes and no cached data exists ──
  const prevTimeRangeRef = useRef(timeRange);
  useEffect(() => {
    // Skip on initial mount
    if (prevTimeRangeRef.current === timeRange && initialLoadComplete) return;
    prevTimeRangeRef.current = timeRange;

    if (!initialLoadComplete || !clientId || !user) return;
    if (!hasSupabaseConfig || !hasLLMConfig) return;

    // If we already have cached data for this time range, skip
    const cache = analyticsType === 'text' ? textWebhookDataCache : voiceWebhookDataCache;
    if (cache[timeRange]?.data) return;

    // Custom range needs both dates
    if (timeRange === 'custom' && (!customStartDate || !customEndDate)) return;

    // Auto-refresh when no cached data exists for the selected time range
    console.log(`No cached data for time range: ${timeRange} — auto-refreshing`);
    const timer = setTimeout(() => {
      refreshAnalytics();
    }, 300);
    return () => clearTimeout(timer);
  }, [timeRange, initialLoadComplete, clientId, user, hasSupabaseConfig, hasLLMConfig, analyticsType, textWebhookDataCache, voiceWebhookDataCache, customStartDate, customEndDate]);

  // Filter chat_history messages by metric name and group by date
  const getMetricTimeSeries = useCallback((metricName: string): Array<{ date: string; count: number }> | null => {
    if (!chatHistoryMessages || chatHistoryMessages.length === 0) return null;

    const n = metricName.toUpperCase().trim();
    let filtered = chatHistoryMessages;

    // Filter by metric type
    if (n === 'BOT MESSAGES' || n === 'TOTAL BOT MESSAGES') {
      filtered = chatHistoryMessages.filter(m => m.type === 'assistant');
    } else if (n === 'USER QUESTIONS ASKED' || n === 'QUESTIONS ASKED') {
      filtered = chatHistoryMessages.filter(m => m.type === 'human' && m.content.includes('?'));
    } else if (n === 'THANK YOU COUNT') {
      const kws = ['thank you', 'thanks', 'appreciate', 'grateful', 'thankful'];
      filtered = chatHistoryMessages.filter(m => {
        const c = m.content.toLowerCase();
        return kws.some(k => c.includes(k));
      });
    } else if (n === 'NEW USERS' || n === 'NEW USER MESSAGES') {
      filtered = chatHistoryMessages.filter(m => m.type === 'human');
    } else if (n === 'TOTAL CONVERSATIONS') {
      // All messages
      filtered = chatHistoryMessages;
    } else if (n === 'STOP BOT') {
      filtered = chatHistoryMessages.filter(m => {
        const c = m.content.toLowerCase();
        return c.includes('stop bot') || c.includes('stop');
      });
    } else {
      // Custom metric — DO NOT use naive keyword matching.
      // Custom metrics get their time series from AI analysis (metricAnalysisTimeSeries).
      // Return null here; resolveTimeSeriesData will check AI analysis cache.
      return null;
    }

    if (filtered.length === 0) return null;

    const dateMap = new Map<string, number>();
    for (const msg of filtered) {
      const dateKey = toLocalDateKey(msg.timestamp);
      dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + 1);
    }

    // Fill in missing dates so chart shows continuous timeline with zero-gaps
    const sortedDates = Array.from(dateMap.keys()).sort();
    if (sortedDates.length >= 2) {
      const start = new Date(sortedDates[0] + 'T00:00:00');
      const end = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00');
      const cursor = new Date(start);
      while (cursor <= end) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const day = String(cursor.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${day}`;
        if (!dateMap.has(key)) dateMap.set(key, 0);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return Array.from(dateMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [chatHistoryMessages, toLocalDateKey]);

  // Resolve time series data — check AI analysis cache for custom metrics by ID, then built-in fallbacks by name
  const resolveTimeSeriesData = (metric: { id: string; name: string }, _webhookData: any): Array<{ date: string; count: number }> | null => {
    const customMetric = customMetrics.find(m => m.id === metric.id);
    if (customMetric) {
      const cachedSeries = metricAnalysisTimeSeries[customMetric.id];
      if (cachedSeries && cachedSeries.length > 0) return cachedSeries;
      return null;
    }

    const metricSeries = getMetricTimeSeries(metric.name);
    if (metricSeries && metricSeries.length > 0) return metricSeries;

    if (chatHistoryTimeSeries && chatHistoryTimeSeries.length > 0) {
      return chatHistoryTimeSeries;
    }

    const result = unwrapWebhookPayload(_webhookData);
    if (result) {
      const candidates = [
        result['Conversations_By_Date'],
        result['conversations_by_date'],
        result.metrics?.['Conversations_By_Date'],
        result.metrics?.['conversations_by_date'],
      ];

      for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length > 0) return candidate;
      }
    }

    return null;
  };

  // ── Resolve webhook chart data for custom metrics ──
  const resolveWebhookChartData = useCallback((metric: { id: string; name: string; widget_type?: string }): any | null => {
    if (aiFormattedChartData[metric.id]) {
      return aiFormattedChartData[metric.id];
    }

    if (!currentWebhookData) return null;
    const result = unwrapWebhookPayload(currentWebhookData);
    if (!result) return null;

    const widgetData = result[`__widget_id_${metric.id}`]
      || result[`__widget_${metric.name}`]
      || (result._lowerWidgetMap && result._lowerWidgetMap[metric.name.toLowerCase()]);
    if (widgetData?.formats) {
      // Use the metric's own widget_type first, then fall back to the webhook's default_type
      const metricWt = metric.widget_type || widgetData.default_type || 'number_card';
      const formatData = widgetData.formats[metricWt] || widgetData.formats[widgetData.default_type] || widgetData.formats.number_card;
      if (formatData) return formatData;
    }

    const metricData = result[metric.name] || result[metric.name.replace(/ /g, '_')];
    if (metricData && typeof metricData === 'object' && !Array.isArray(metricData)) {
      if (metricData.data_points || metricData.segments || metricData.content) {
        return metricData;
      }
    }

    const chartSection = result['Chart Data'] || result['chart_data'] || result.metrics?.['Chart Data'];
    if (chartSection && typeof chartSection === 'object') {
      const chartData = chartSection[metric.name] || chartSection[metric.name.replace(/ /g, '_')];
      if (chartData) return chartData;
    }

    const other = result['Other Metrics'] || result.other_metrics;
    if (other && typeof other === 'object') {
      const otherData = other[metric.name];
      if (otherData && typeof otherData === 'object' && !Array.isArray(otherData)) {
        if (otherData.data_points || otherData.segments || otherData.content) {
          return otherData;
        }
      }
    }

    return null;
  }, [currentWebhookData, aiFormattedChartData]);

  // Conversation fetching is now handled directly inside ConversationsDrawer

  // Default metric names that cannot be duplicated
  const DEFAULT_METRIC_NAMES = useMemo(() => {
    if (analyticsType === 'voice') {
      return ['Total Voice Call', 'New Users'];
    }
    return ['Total Conversations', 'Total Bot Messages', 'Total Human Messages', 'New Users'];
  }, [analyticsType]);

  // Unified metric save handler
  const handleMetricSave = async (data: { name: string; prompt: string; color: string; widget_type?: string; widget_width?: string }) => {
    if (!clientId) return;
    try {
      // Check against default metric names — exact match
      const normalizedName = data.name.trim().toLowerCase();
      const isDuplicate = DEFAULT_METRIC_NAMES.some(d => d.toLowerCase() === normalizedName);
      if (!editingMetric && isDuplicate) {
        toast({ title: "Error", description: `"${data.name}" already exists as a default metric. Please choose a different name.`, variant: "destructive" });
        return;
      }

      // G3-6: the optional in-browser OpenRouter "semantic duplicate" check was
      // removed (it read the secret key into the browser and called openrouter.ai
      // directly). The exact-name duplicate guard above is retained.

      if (editingMetric) {
        const updatePayload: any = { name: data.name, prompt: data.prompt, color: data.color, updated_at: new Date().toISOString() };
        if (data.widget_width) updatePayload.widget_width = data.widget_width;
        const { error } = await supabase
          .from('custom_metrics')
          .update(updatePayload)
          .eq('id', editingMetric.id);
        if (error) throw error;
        setCustomMetrics(prev => prev.map(m => m.id === editingMetric.id ? { ...m, name: data.name, prompt: data.prompt, color: data.color, widget_width: data.widget_width || m.widget_width } : m));
      } else {
        const { data: existing } = await supabase
          .from('custom_metrics')
          .select('name, widget_type')
          .eq('client_id', clientId)
          .eq('analytics_type', analyticsType)
          .eq('name', data.name)
          .eq('widget_type', data.widget_type || 'number_card')
          .eq('is_active', true);
        if (existing && existing.length > 0) {
          toast({ title: "Error", description: "A metric with this name and format already exists. Try a different visualization type.", variant: "destructive" });
          return;
        }
        const { data: newMetric, error } = await supabase
          .from('custom_metrics')
          .insert({ client_id: clientId, analytics_type: analyticsType, name: data.name, prompt: data.prompt, color: data.color, description: '', widget_type: data.widget_type || 'number_card' } as any)
          .select()
          .single();
        if (error) throw error;
        if (newMetric) setCustomMetrics(prev => [...prev, newMetric]);

        setMetricDialogOpen(false);
        setEditingMetric(null);
        window.dispatchEvent(new CustomEvent('customMetricsChanged'));
        window.dispatchEvent(new CustomEvent('invalidateAnalyticsCache'));
        toast({ title: "Success", description: "Metric created. Refreshing..." });
        if (newMetric) {
          setTimeout(() => refreshSingleMetric(newMetric), 300);
        }
        return;
      }
      setMetricDialogOpen(false);
      setEditingMetric(null);
      window.dispatchEvent(new CustomEvent('customMetricsChanged'));
      toast({ title: "Success", description: "Metric updated." });
    } catch (error) {
      console.error('Error saving metric:', error);
      toast({ title: "Error", description: "Failed to save metric.", variant: "destructive" });
    }
  };

  // Unified metric delete handler
  const handleMetricDelete = async () => {
    if (!editingMetric) return;
    try {
      const { error } = await supabase
        .from('custom_metrics')
        .update({ is_active: false })
        .eq('id', editingMetric.id);
      if (error) throw error;
      setCustomMetrics(prev => prev.filter(m => m.id !== editingMetric.id));
      setMetricDialogOpen(false);
      setEditingMetric(null);
      window.dispatchEvent(new CustomEvent('invalidateAnalyticsCache'));
      window.dispatchEvent(new CustomEvent('customMetricsChanged'));
      toast({ title: "Success", description: "Metric deleted." });
    } catch (error) {
      console.error('Error deleting metric:', error);
      toast({ title: "Error", description: "Failed to delete metric.", variant: "destructive" });
    }
  };

  // Drag-and-drop reorder handler
  const handleMetricReorder = useCallback(async (reordered: CustomMetric[]) => {
    setCustomMetrics(reordered);
    // Persist sort_order to DB
    try {
      for (let i = 0; i < reordered.length; i++) {
        await supabase
          .from('custom_metrics')
          .update({ sort_order: i } as any)
          .eq('id', reordered[i].id);
      }
    } catch (error) {
      console.error('Error saving metric order:', error);
    }
  }, []);

  // ── Separator & layout persistence via crm_filter_config ──
  const [separatorNames, setSeparatorNames] = useState<Record<string, string>>({});
  // Saved layout: map of widgetId → grid slot position (preserves spatial layout)
  const [savedWidgetSlots, setSavedWidgetSlots] = useState<Record<string, number> | null>(null);
  const [layoutConfigLoaded, setLayoutConfigLoaded] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resettingLayout, setResettingLayout] = useState(false);
  const layoutConfigLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    const cacheKey = `${clientId}_${analyticsType}`;
    if (!clientId || layoutConfigLoadedRef.current === cacheKey) return;
    layoutConfigLoadedRef.current = cacheKey;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('clients_public')
          .select('crm_filter_config')
          .eq('id', clientId)
          .single();
        const cfg = data?.crm_filter_config || {};
        const typeKey = analyticsType === 'voice' ? 'voice' : 'text';
        if (cfg.analytics_separator_names) setSeparatorNames(cfg.analytics_separator_names);
        // Support both new slot-map format and legacy ID-array format
        const slotData = cfg[`analytics_widget_slots_${typeKey}`];
        const legacyOrder: string[] | null = cfg[`analytics_widget_order_${typeKey}`] || null;
        if (slotData && typeof slotData === 'object' && !Array.isArray(slotData)) {
          setSavedWidgetSlots(slotData);
        } else if (legacyOrder && Array.isArray(legacyOrder)) {
          // Migrate: treat sequential index as sort_order (will be normalized)
          const migrated: Record<string, number> = {};
          legacyOrder.forEach((id, i) => { migrated[id] = i; });
          setSavedWidgetSlots(migrated);
        } else {
          setSavedWidgetSlots(null);
        }
      } catch {}
      setLayoutConfigLoaded(true);
    })();
  }, [clientId, analyticsType]);

  const persistLayoutConfig = useCallback(async (updates: Record<string, any>) => {
    if (!clientId) return;
    try {
      const { data } = await (supabase as any)
        .from('clients_public')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const cfg = data?.crm_filter_config || {};
      await (supabase as any)
        .from('clients')
        .update({ crm_filter_config: { ...cfg, ...updates } })
        .eq('id', clientId);
    } catch {}
  }, [clientId]);

  // ── Build dashboard widgets for CampaignDashboardGrid ──
  const dashboardWidgets = useMemo(() => {
    const defaultNames = new Set(DEFAULT_METRIC_NAMES.map(n => n.toLowerCase()));
    const FIXED_DEFAULT_ORDER = analyticsType === 'voice'
      ? ['total voice call', 'new users']
      : ['total conversations', 'new users', 'total bot messages', 'total human messages'];
    const defaultMetrics = FIXED_DEFAULT_ORDER
      .map(name => customMetrics.find(m => m.is_active && m.name.toLowerCase() === name))
      .filter(Boolean) as CustomMetric[];
    const userMetrics = customMetrics
      .filter(m => m.is_active && !defaultNames.has(m.name.toLowerCase()))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime());

    // Build a map of all items by id
    const allItems: Record<string, any> = {};
    let sortIdx = 0;

    // Default separator
    allItems['sep-default'] = {
      id: 'sep-default',
      title: separatorNames['sep-default'] || 'Default Metrics',
      friendly_name: separatorNames['sep-default'] || 'Default Metrics',
      widget_type: 'separator',
      width: 'full',
      config: {},
      sort_order: 0,
      color: '#3b82f6',
    };
    for (const m of defaultMetrics) {
      allItems[m.id] = {
        id: m.id,
        title: m.name,
        friendly_name: m.name,
        widget_type: 'number_card',
        width: undefined,
        config: { _metric: m },
        sort_order: 0,
        color: m.color || '#3b82f6',
      };
    }
    // Custom separator
    if (userMetrics.length > 0) {
      allItems['sep-custom'] = {
        id: 'sep-custom',
        title: separatorNames['sep-custom'] || 'Custom Metrics',
        friendly_name: separatorNames['sep-custom'] || 'Custom Metrics',
        widget_type: 'separator',
        width: 'full',
        config: {},
        sort_order: 0,
        color: '#3b82f6',
      };
    }
    for (const m of userMetrics) {
      const wt = m.widget_type || 'number_card';
      allItems[m.id] = {
        id: m.id,
        title: m.name,
        friendly_name: m.name,
        widget_type: wt,
        width: (m.widget_width === 'full' || wt === 'text') ? 'full' : (wt !== 'number_card' ? 'half' : undefined),
        config: { _metric: m },
        sort_order: 0,
        color: m.color || '#3b82f6',
      };
    }

    // Apply saved slot positions if available
    let ordered: any[];
    if (savedWidgetSlots && Object.keys(savedWidgetSlots).length > 0) {
      // Apply saved slot positions directly to preserve spatial layout
      const withSlots: any[] = [];
      const unsaved: any[] = [];
      for (const id of Object.keys(allItems)) {
        if (savedWidgetSlots[id] !== undefined) {
          allItems[id].sort_order = savedWidgetSlots[id];
          withSlots.push(allItems[id]);
        } else {
          unsaved.push(allItems[id]);
        }
      }
      // Sort saved items by their slot position
      withSlots.sort((a, b) => a.sort_order - b.sort_order);
      // Append unsaved items after
      ordered = [...withSlots, ...unsaved];
      // For unsaved items, assign sort_order after the last saved slot
      const maxSlot = withSlots.length > 0 ? Math.max(...withSlots.map(w => w.sort_order)) + 1 : 0;
      unsaved.forEach((w, i) => { w.sort_order = maxSlot + i; });
      return toNormalizedDashboardWidgets(ordered);
    } else {
      // Default: sep-default, defaults, sep-custom, customs
      ordered = [];
      if (defaultMetrics.length > 0) {
        ordered.push(allItems['sep-default']);
        for (const m of defaultMetrics) ordered.push(allItems[m.id]);
      }
      if (userMetrics.length > 0 && allItems['sep-custom']) {
        ordered.push(allItems['sep-custom']);
        for (const m of userMetrics) ordered.push(allItems[m.id]);
      }
    }

    // Assign sort_order
    ordered.forEach((w, i) => { w.sort_order = i; });

    return toNormalizedDashboardWidgets(ordered);
  }, [customMetrics, analyticsType, DEFAULT_METRIC_NAMES, separatorNames, savedWidgetSlots]);

  // ── Grid handlers ──
  const handleGridGetStatValue = useCallback((widget: any): string | number => {
    if (widget.widget_type === 'separator') return '';
    const metric = widget.config?._metric;
    if (!metric) return 'N/A';
    const v = resolveMetricValue(metric.name, currentWebhookData);
    return v !== undefined && v !== null ? String(v) : 'N/A';
  }, [currentWebhookData]);

  const handleGridGetChartData = useCallback((widget: any): any => {
    if (widget.widget_type === 'separator' || widget.widget_type === 'number_card') return null;
    const metric = widget.config?._metric;
    if (!metric) return null;
    // Try AI formatted chart data first
    const webhookChart = resolveWebhookChartData(metric);
    if (webhookChart) return webhookChart;
    // Fall back to time series
    const ts = resolveTimeSeriesData(metric, currentWebhookData);
    if (ts && ts.length > 0) return { data_points: ts.map(p => ({ date: p.date, value: p.count })) };
    return null;
  }, [currentWebhookData, resolveWebhookChartData]);

  const handleGridEditWidget = useCallback((widget: any) => {
    const metric = widget.config?._metric;
    if (metric) {
      setEditingMetric(metric);
      setMetricDialogOpen(true);
    }
  }, []);

  const handleGridRenameSeparator = useCallback((widgetId: string, newName: string) => {
    setSeparatorNames(prev => {
      const next = { ...prev, [widgetId]: newName };
      persistLayoutConfig({ analytics_separator_names: next });
      return next;
    });
  }, [persistLayoutConfig]);

  const handleGridDeleteSeparator = useCallback((_widgetId: string) => {
    // Separators are structural, don't delete
  }, []);

  const handleGridReorder = useCallback(async (nextWidgets: any[]) => {
    // Save the actual grid slot positions (sort_order = y*4+x) to preserve spatial layout
    const slotMap: Record<string, number> = {};
    for (const w of nextWidgets) {
      slotMap[w.id] = w.sort_order ?? 0;
    }
    const typeKey = analyticsType === 'voice' ? 'voice' : 'text';
    setSavedWidgetSlots(slotMap);
    persistLayoutConfig({ [`analytics_widget_slots_${typeKey}`]: slotMap });

    // Also persist metric sort_order using visual order for DB consistency
    const visualOrder = [...nextWidgets].sort((a, b) => {
      if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) {
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      }
      return String(a.id).localeCompare(String(b.id));
    });
    const reordered = visualOrder
      .filter(w => w.config?._metric && w.widget_type !== 'separator')
      .map(w => w.config._metric as CustomMetric);
    try {
      for (let i = 0; i < reordered.length; i++) {
        await supabase
          .from('custom_metrics')
          .update({ sort_order: i } as any)
          .eq('id', reordered[i].id);
      }
    } catch (error) {
      console.error('Error saving metric order:', error);
    }
  }, [analyticsType, persistLayoutConfig]);

  const handleResetToDefaultLayout = useCallback(async () => {
    setResettingLayout(true);
    try {
      const typeKey = analyticsType === 'voice' ? 'voice' : 'text';
      setSavedWidgetSlots(null);
      setSeparatorNames({});
      await persistLayoutConfig({
        [`analytics_widget_slots_${typeKey}`]: null,
        [`analytics_widget_order_${typeKey}`]: null,
        analytics_separator_names: {},
      });
      toast({ title: 'Layout reset to default' });
    } finally {
      setResettingLayout(false);
    }
  }, [analyticsType, persistLayoutConfig, toast]);

  // ── Push header actions to parent layout ──
  useEffect(() => {
    if (!onHeaderActions) return;
    if (activeTab !== 'dashboard') {
      onHeaderActions(null);
      return;
    }
    onHeaderActions(
      <>
        <span style={{ fontSize: '11px' }} className="text-muted-foreground whitespace-nowrap">
          Last updated: {displayLastRefreshed ? formatInUserTimezone(displayLastRefreshed) : 'Never'}
        </span>
        <Button onClick={() => { setEditingMetric(null); setMetricDialogOpen(true); }} size="sm" className="!h-8 groove-btn-blue">
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          CREATE METRIC
        </Button>
        <Button onClick={() => setResetConfirmOpen(true)} size="sm" className="!h-8">
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          DEFAULT LAYOUT
        </Button>
      </>
    );
    return () => onHeaderActions(null);
  }, [onHeaderActions, activeTab, disableSend, hasSupabaseConfig, hasLLMConfig, timeRange, customStartDate, customEndDate, analyzing, webhookSending, displayLastRefreshed, handleResetToDefaultLayout]);

  // Generate default AI prompts for built-in metrics
  const getDefaultMetricPrompt = useCallback((metricName: string): string | null => {
    const n = metricName.toUpperCase().trim();
    if (n === 'THANK YOU COUNT') return 'Find all messages where the user expresses gratitude, thanks, or appreciation (e.g. "thank you", "thanks", "appreciate it", "grateful").';
    if (n === 'USER QUESTIONS ASKED' || n === 'QUESTIONS ASKED') return 'Find all messages where the user asks a question or makes an inquiry.';
    if (n === 'STOP BOT') return 'Find all messages where the user wants to stop, end, or disable the bot or conversation.';
    if (n === 'TOTAL CONVERSATIONS') return 'Find the first message in each conversation session.';
    if (n === 'BOT MESSAGES' || n === 'TOTAL BOT MESSAGES') return 'Find all messages sent by the AI/bot/assistant.';
    if (n === 'NEW USERS' || n === 'NEW USER MESSAGES') return 'Find the first message from each unique user.';
    if (n === 'TOTAL MESSAGES') return 'Find all messages in the conversations.';
    return null;
  }, []);

  // AI metric analysis handler
  const handleViewMetricMessages = useCallback(async (metric: CustomMetric) => {
    setSelectedMetricForDrawer(metric.name);
    setDrawerAiMatches(undefined);
    setIsAnalyzingMetric(false);
    setConversationsDrawerOpen(true);

    // Determine prompt: use metric's own prompt, or generate a default for built-in metrics
    const effectivePrompt = metric.prompt || getDefaultMetricPrompt(metric.name);
    if (!effectivePrompt || !hasLLMConfig) return;

    // Get conversations list from current webhook data
    const result = unwrapWebhookPayload(currentWebhookData);
    const conversations = result?.Conversations_List || result?.conversations_list || result?.metrics?.Conversations_List || [];
    if (!conversations || conversations.length === 0) return;

    // G3-6: analyze-metric reads the OpenRouter key server-side from client_id;
    // the hasLLMConfig gate above already confirms a key is configured.
    try {
      setIsAnalyzingMetric(true);

      // Check cache first
      const { data: cached } = await supabase
        .from('metric_analysis_results' as any)
        .select('results, total_count')
        .eq('metric_id', metric.id)
        .eq('client_id', clientId)
        .eq('time_range', timeRange)
        .order('analysis_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached && (cached as any).results) {
        setDrawerAiMatches((cached as any).results as AiMatch[]);
        setIsAnalyzingMetric(false);
        return;
      }

      // Call edge function for AI analysis
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-metric', {
        body: {
          client_id: clientId,
          metric_id: metric.id,
          metric_prompt: effectivePrompt,
          metric_name: metric.name,
          conversations,
          time_range: timeRange,
        },
      });

      if (analysisError) {
        console.error('AI analysis error:', analysisError);
        // Try to extract meaningful error from the response
        let errorMsg = 'Failed to analyze conversations with AI.';
        try {
          const ctx = (analysisError as any)?.context;
          const body = ctx?.body ? JSON.parse(new TextDecoder().decode(await new Response(ctx.body).arrayBuffer())) : null;
          const serverError = body?.error || analysisData?.error;
          if (serverError) {
            if (typeof serverError === 'string' && serverError.includes('401')) {
              errorMsg = 'Your OpenRouter API key is invalid or has been revoked. Please update it on the Credentials page with a valid key from openrouter.ai/keys.';
            } else if (typeof serverError === 'string' && serverError.includes('402')) {
              errorMsg = 'Your OpenRouter account has insufficient credits. Please add funds at openrouter.ai and try again.';
            } else if (typeof serverError === 'string' && serverError.includes('429')) {
              errorMsg = 'Rate limit exceeded on OpenRouter. Please wait a moment and try again.';
            } else {
              errorMsg = serverError;
            }
          }
        } catch { /* use default message */ }
        toast({ title: 'Analysis Error', description: errorMsg, variant: 'destructive' });
      } else if (analysisData?.error) {
        // Edge function returned 200 but with an error field
        let errorMsg = analysisData.error;
        if (typeof errorMsg === 'string' && errorMsg.includes('401')) {
          errorMsg = 'Your OpenRouter API key is invalid or has been revoked. Please update it on the Credentials page with a valid key from openrouter.ai/keys.';
        } else if (typeof errorMsg === 'string' && errorMsg.includes('402')) {
          errorMsg = 'Your OpenRouter account has insufficient credits. Please add funds at openrouter.ai and try again.';
        } else if (typeof errorMsg === 'string' && errorMsg.includes('429')) {
          errorMsg = 'Rate limit exceeded on OpenRouter. Please wait a moment and try again.';
        }
        toast({ title: 'Analysis Error', description: errorMsg, variant: 'destructive' });
      } else if (analysisData?.matches) {
        setDrawerAiMatches(analysisData.matches);
      }
    } catch (err) {
      console.error('AI analysis error:', err);
      toast({ title: 'Analysis Error', description: 'An unexpected error occurred during analysis. Please try again.', variant: 'destructive' });
    } finally {
      setIsAnalyzingMetric(false);
    }
  }, [clientId, currentWebhookData, timeRange, hasLLMConfig, toast, getDefaultMetricPrompt]);


  if (loading || (!cacheWarm && isLoadingData && !initialLoadComplete)) {
    return <RetroLoader />;
  }
  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
        <p className="text-sm">No analytics to show yet.</p>
        <p className="text-xs mt-1">This sub-account has no data or could not be loaded. Try refreshing, or pick another sub-account.</p>
      </div>
    );
  }
  return <div className="relative space-y-6 pb-6" style={{ position: 'relative' }}>
      {/* Channel toggle — merged Text + Voice analytics into a single sidebar item;
          this toggle navigates between the two URL variants so the page can render
          the appropriate analyticsType ('text' or 'voice'). chat-with-ai sub-route
          is preserved when toggling. */}
      <Tabs
        value={isVoice ? 'voice' : 'text'}
        onValueChange={(next) => {
          const suffix = isChatTab ? '/chat-with-ai' : '/dashboard';
          const channel = next === 'voice' ? 'voice-ai' : 'chatbot';
          navigate(`/client/${clientId}/analytics/${channel}${suffix}`);
        }}
      >
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="text">Text Analytics</TabsTrigger>
          <TabsTrigger value="voice">Voice Analytics</TabsTrigger>
        </TabsList>
      </Tabs>
      {/* F13 billing-period usage summary — server-branched by role (client sees
          only the admin-toggled parts; agency sees billed/cost/margin). */}
      {activeTab === 'dashboard' && clientId && <UsageSummaryCard clientId={clientId} />}
      {/* Refresh overlay - scoped to dashboard content area only */}
      {(analyzing || webhookSending) && (
        <div className="absolute inset-0 z-40 bg-background/80 backdrop-blur-sm flex items-center justify-center">
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
              {(analyticsType === 'text' ? textStageDescription : voiceStageDescription) || 'REFRESHING DATA'}
            </p>
            <style>{`
              @keyframes saving-bounce {
                0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                40% { opacity: 1; transform: scale(1.2); }
              }
            `}</style>
          </div>
        </div>
      )}
      {/* Content based on URL params - Text Chatbot Dashboard */}
        {analyticsType === 'text' && activeTab === 'dashboard' && <>
            {/* Inline controls bar */}
            <div className="flex items-center gap-3">
              <Button onClick={() => refreshAnalytics()} disabled={disableSend || !hasSupabaseConfig || !hasLLMConfig || (timeRange === 'custom' && (!customStartDate || !customEndDate))} size="sm" className="!h-8">
                {analyzing || webhookSending ? <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  {analyzing ? 'REFRESHING...' : 'SENDING...'}
                </> : <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  REFRESH
                </>}
              </Button>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-[160px] bg-card focus:ring-0 focus:ring-offset-0 !h-8" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                  <SelectItem value="1">Last 1 Day</SelectItem>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              {timeRange === 'custom' && <DateRangePicker
                startDate={customStartDate}
                endDate={customEndDate}
                onRangeChange={(start, end) => {
                  setCustomStartDate(start);
                  setCustomEndDate(end);
                }}
                maxDays={30}
              />}
            </div>

            {/* Error Display */}
            {(webhookError || lastError) && !currentWebhookData && (
              <ErrorDisplay 
                error={webhookError || lastError!}
                onDismiss={() => {
                  setLastError(null);
                  clearWebhookError();
                }}
              />
            )}

            <SavingOverlay isVisible={resettingLayout} message="Resetting layout..." variant="fixed" />

            {(isLoadingData && !initialLoadComplete && customMetrics.length === 0) || !layoutConfigLoaded ?
      <div className="space-y-6">
                <div className="stat-row animate-pulse">
                  {[1, 2, 3, 4].map(i => <div key={i} className="stat-cell">
                    <div className="h-3 bg-muted w-24 mb-3"></div>
                    <div className="h-6 bg-muted w-16"></div>
                  </div>)}
                </div>
              </div> : (
              <div className="space-y-6">
                <CampaignDashboardGrid
                  widgets={dashboardWidgets}
                  getStatValue={handleGridGetStatValue}
                  getChartData={handleGridGetChartData}
                  onEditWidget={handleGridEditWidget}
                  onRenameSeparator={handleGridRenameSeparator}
                  onDeleteSeparator={handleGridDeleteSeparator}
                  onReorder={handleGridReorder}
                />

                <CampaignWidgetEditPopover
                  title={editingMetric?.name || ''}
                  internalName={editingMetric?.name}
                  color={editingMetric?.color || '#3b82f6'}
                  onUpdate={(t, c) => {
                    if (editingMetric) {
                      handleMetricSave({ name: t, prompt: editingMetric.prompt, color: c, widget_type: editingMetric.widget_type, widget_width: editingMetric.widget_width });
                    }
                  }}
                  onDelete={() => { if (editingMetric) handleMetricDelete(); }}
                  openExternal={!!editingMetric && metricDialogOpen}
                  onCloseExternal={() => { setMetricDialogOpen(false); setEditingMetric(null); }}
                />

                <CustomMetricDialog
                  open={metricDialogOpen && !editingMetric}
                  onOpenChange={(open) => { setMetricDialogOpen(open); if (!open) setEditingMetric(null); }}
                  metric={null}
                  onSave={handleMetricSave}
                  hasOpenrouterKey={!!client?.has_openrouter_api_key}
                  clientId={clientId}
                />
              </div>
            )}
          </>}

        {/* Content based on URL params - Text Chatbot Chat with AI */}
        {analyticsType === 'text' && activeTab === 'chat' && <div className="h-full">
            <AnalyticsChatInterface timeRange={chatTimeRange} customDateRange={chatTimeRange === 'custom' && chatCustomStartDate && chatCustomEndDate ? {
        startDate: format(chatCustomStartDate, 'yyyy-MM-dd'),
        endDate: format(chatCustomEndDate, 'yyyy-MM-dd')
      } : undefined} analyticsType="text" />
          </div>}

        {/* Content based on URL params - Voice AI Dashboard */}
        {analyticsType === 'voice' && activeTab === 'dashboard' && <>
            {/* Inline controls bar */}
            <div className="flex items-center gap-3">
              <Button onClick={() => refreshAnalytics()} disabled={disableSend || !hasSupabaseConfig || !hasLLMConfig || (timeRange === 'custom' && (!customStartDate || !customEndDate))} size="sm" className="!h-8">
                {analyzing || webhookSending ? <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  {analyzing ? 'REFRESHING...' : 'SENDING...'}
                </> : <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  REFRESH
                </>}
              </Button>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger className="w-[160px] bg-card focus:ring-0 focus:ring-offset-0 !h-8" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 400 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                  <SelectItem value="1">Last 24 Hours</SelectItem>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              {timeRange === 'custom' && <DateRangePicker
                startDate={customStartDate}
                endDate={customEndDate}
                onRangeChange={(start, end) => {
                  setCustomStartDate(start);
                  setCustomEndDate(end);
                }}
                maxDays={30}
              />}
            </div>

            {/* Error Display */}
            {(webhookError || lastError) && !currentWebhookData && (
              <ErrorDisplay 
                error={webhookError || lastError!}
                onDismiss={() => {
                  setLastError(null);
                  clearWebhookError();
                }}
              />
            )}

            <SavingOverlay isVisible={resettingLayout} message="Resetting layout..." variant="fixed" />

            {(isLoadingData && !initialLoadComplete && customMetrics.length === 0) || !layoutConfigLoaded ?
      <div className="space-y-6">
                <div className="stat-row animate-pulse">
                  {[1, 2, 3, 4].map(i => <div key={i} className="stat-cell">
                    <div className="h-3 bg-muted w-24 mb-3"></div>
                    <div className="h-6 bg-muted w-16"></div>
                  </div>)}
                </div>
              </div> : (
              <div className="space-y-6">
                <CampaignDashboardGrid
                  widgets={dashboardWidgets}
                  getStatValue={handleGridGetStatValue}
                  getChartData={handleGridGetChartData}
                  onEditWidget={handleGridEditWidget}
                  onRenameSeparator={handleGridRenameSeparator}
                  onDeleteSeparator={handleGridDeleteSeparator}
                  onReorder={handleGridReorder}
                />

                <CampaignWidgetEditPopover
                  title={editingMetric?.name || ''}
                  internalName={editingMetric?.name}
                  color={editingMetric?.color || '#3b82f6'}
                  onUpdate={(t, c) => {
                    if (editingMetric) {
                      handleMetricSave({ name: t, prompt: editingMetric.prompt, color: c, widget_type: editingMetric.widget_type, widget_width: editingMetric.widget_width });
                    }
                  }}
                  onDelete={() => { if (editingMetric) handleMetricDelete(); }}
                  openExternal={!!editingMetric && metricDialogOpen}
                  onCloseExternal={() => { setMetricDialogOpen(false); setEditingMetric(null); }}
                />

                <CustomMetricDialog
                  open={metricDialogOpen && !editingMetric}
                  onOpenChange={(open) => { setMetricDialogOpen(open); if (!open) setEditingMetric(null); }}
                  metric={null}
                  onSave={handleMetricSave}
                  hasOpenrouterKey={!!client?.has_openrouter_api_key}
                  clientId={clientId}
                />
                
                {/* Call Recordings & Transcripts Section */}
                <VoiceCallLogsTable transcriptData={currentWebhookData?.["Transcript & Recording URL"]} isLoading={analyzing || webhookSending} />
              </div>
            )}
          </>}

        {/* Content based on URL params - Voice AI Chat with AI */}
        {analyticsType === 'voice' && activeTab === 'chat' && <div className="h-full">
            <AnalyticsChatInterface timeRange={chatTimeRange} customDateRange={chatTimeRange === 'custom' && chatCustomStartDate && chatCustomEndDate ? {
        startDate: format(chatCustomStartDate, 'yyyy-MM-dd'),
        endDate: format(chatCustomEndDate, 'yyyy-MM-dd')
      } : undefined} analyticsType="voice" />
          </div>}


        {/* Conversations Drawer */}
        <ConversationsDrawer
          open={conversationsDrawerOpen}
          onOpenChange={(open) => {
            setConversationsDrawerOpen(open);
            if (!open) { setDrawerAiMatches(undefined); setIsAnalyzingMetric(false); }
          }}
          metricName={selectedMetricForDrawer}
          metricCount={resolveMetricValue(selectedMetricForDrawer, currentWebhookData)}
          conversationsList={(() => {
            const result = unwrapWebhookPayload(currentWebhookData);
            if (!result) return [];
            return result?.Conversations_List || result?.conversations_list || result?.metrics?.Conversations_List || [];
          })()}
          aiMatches={drawerAiMatches}
          isAnalyzing={isAnalyzingMetric}
        />

        <DeleteConfirmDialog
          open={resetConfirmOpen}
          onOpenChange={setResetConfirmOpen}
          title="Reset to Default Layout"
          description="Are you sure you want to reset the dashboard to its default layout? All customizations (reordering, renaming, deletions) will be lost."
          confirmLabel="Reset"
          confirmIcon={<RotateCcw className="w-4 h-4 mr-2" />}
          onConfirm={() => {
            setResetConfirmOpen(false);
            handleResetToDefaultLayout();
          }}
        />
    </div>;
};
export default ChatAnalytics;