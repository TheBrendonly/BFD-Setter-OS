import React from 'react';
import { supabase } from '@/integrations/supabase/client';

const { useState, useEffect, useCallback } = React;

export interface OpenRouterCredits {
  total_credits: number;
  total_usage: number;
  remaining: number;
}

export interface KeyUsageData {
  label: string;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  limit: number | null;
  limit_remaining: number | null;
  is_free_tier: boolean;
}

export interface ActivityItem {
  date: string;
  model: string;
  model_permaslug: string;
  endpoint_id: string;
  provider_name: string;
  usage: number;
  byok_usage_inference: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
}

export interface ModelUsageSummary {
  model: string;
  totalCost: number;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

export interface DailyUsage {
  date: string;
  cost: number;
  requests: number;
}

export function useOpenRouterUsage(clientId: string | undefined) {
  const [credits, setCredits] = useState<OpenRouterCredits | null>(null);
  const [keyUsage, setKeyUsage] = useState<KeyUsageData | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // G3-6: the OpenRouter keys never reach the browser. We track presence only
  // (has_openrouter_api_key) and fetch usage via the get-openrouter-usage edge fn.
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  const fetchApiKey = useCallback(async () => {
    if (!clientId) return;
    try {
      const { data, error } = await supabase
        .from('clients_public')
        .select('has_openrouter_api_key')
        .eq('id', clientId)
        .maybeSingle();
      if (error) throw error;
      setHasKey(!!(data as any)?.has_openrouter_api_key);
    } catch (err: any) {
      setError(err.message);
      setHasKey(false);
    }
  }, [clientId]);

  // Load from cache on mount
  const loadCache = useCallback(async () => {
    if (!clientId) return;
    try {
      const { data } = await supabase
        .from('openrouter_usage_cache' as any)
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      if (data && (data as any).cached_data) {
        const cached = (data as any).cached_data as any;
        if (cached.credits) setCredits(cached.credits);
        if (cached.keyUsage) setKeyUsage(cached.keyUsage);
        if (cached.activity) setActivity(cached.activity);
        setLastRefreshed((data as any).last_refreshed);
        setCacheLoaded(true);
        setLoading(false);
      }
    } catch {
      // Cache miss is fine
    }
  }, [clientId]);

  // Save to cache
  const saveCache = useCallback(async (creditsData: OpenRouterCredits | null, keyData: KeyUsageData | null, activityData: ActivityItem[]) => {
    if (!clientId) return;
    const now = new Date().toISOString();
    try {
      const { data: existing } = await supabase
        .from('openrouter_usage_cache' as any)
        .select('id')
        .eq('client_id', clientId)
        .maybeSingle();

      const cachePayload = { credits: creditsData, keyUsage: keyData, activity: activityData };

      if (existing) {
        await supabase
          .from('openrouter_usage_cache' as any)
          .update({ cached_data: cachePayload, last_refreshed: now } as any)
          .eq('client_id', clientId);
      } else {
        await supabase
          .from('openrouter_usage_cache' as any)
          .insert({ client_id: clientId, cached_data: cachePayload, last_refreshed: now } as any);
      }
      setLastRefreshed(now);
    } catch {
      // Non-critical
    }
  }, [clientId]);

  // G3-6: all OpenRouter calls run server-side in get-openrouter-usage; the hook
  // just invokes it and stores the returned safe shapes.
  const refresh = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('get-openrouter-usage', {
        body: { clientId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const c = (data?.credits ?? null) as OpenRouterCredits | null;
      const k = (data?.keyUsage ?? null) as KeyUsageData | null;
      const a = (data?.activity ?? []) as ActivityItem[];
      setCredits(c);
      setKeyUsage(k);
      setActivity(a);
      setActivityError(data?.activityError ?? null);
      if (typeof data?.hasKey === 'boolean') setHasKey(data.hasKey);
      await saveCache(c, k, a);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [clientId, saveCache]);

  useEffect(() => { fetchApiKey(); }, [fetchApiKey]);
  useEffect(() => { loadCache(); }, [loadCache]);

  useEffect(() => {
    if (hasKey && !cacheLoaded) {
      refresh();
    } else if (hasKey && cacheLoaded) {
      // Cache was loaded, don't auto-fetch
      setLoading(false);
    } else if (hasKey === false) {
      setLoading(false);
    }
  }, [hasKey, cacheLoaded, refresh]);

  // Aggregate: usage by model
  const modelUsage: ModelUsageSummary[] = (() => {
    const map = new Map<string, ModelUsageSummary>();
    activity.forEach((item) => {
      const existing = map.get(item.model) || {
        model: item.model, totalCost: 0, totalRequests: 0,
        promptTokens: 0, completionTokens: 0, reasoningTokens: 0,
      };
      existing.totalCost += item.usage || 0;
      existing.totalRequests += item.requests || 0;
      existing.promptTokens += item.prompt_tokens || 0;
      existing.completionTokens += item.completion_tokens || 0;
      existing.reasoningTokens += item.reasoning_tokens || 0;
      map.set(item.model, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  })();

  // Aggregate: daily usage
  const dailyUsage: DailyUsage[] = (() => {
    const map = new Map<string, DailyUsage>();
    activity.forEach((item) => {
      const existing = map.get(item.date) || { date: item.date, cost: 0, requests: 0 };
      existing.cost += item.usage || 0;
      existing.requests += item.requests || 0;
      map.set(item.date, existing);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  })();

  return {
    credits, keyUsage, activity, modelUsage, dailyUsage,
    loading, error, activityError, hasKey, refresh, lastRefreshed,
  };
}