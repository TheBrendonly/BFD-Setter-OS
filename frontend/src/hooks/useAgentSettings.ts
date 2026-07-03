import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getCached, setCache, isFresh } from '@/lib/queryCache';
// PROMPT-LINT-1: the shared lint module is pure (no Deno APIs), so the browser
// imports the SAME source the save-external-prompt edge fn uses — no mirror.
import { lintTextSetterPrompt } from '../../supabase/functions/_shared/promptLint';

export interface AgentSettings {
  id?: string;
  client_id: string;
  slot_id: string;
  name: string;
  model: string;
  response_delay_seconds: number;
  followup_1_delay_seconds: number;
  followup_2_delay_seconds: number;
  followup_3_delay_seconds: number;
  followup_instructions: string | null;
  followup_cancellation_instructions: string | null;
  followup_max_attempts: number;
  file_processing_enabled: boolean;
  human_transfer_enabled: boolean;
  booking_function_enabled: boolean;
  booking_prompt: string;
  last_deployed_prompt: string | null;
  needs_external_sync: boolean;
}

const DEFAULT_SETTINGS: Omit<AgentSettings, 'client_id' | 'slot_id'> = {
  name: '',
  model: '',
  response_delay_seconds: 0,
  followup_1_delay_seconds: 0,
  followup_2_delay_seconds: 0,
  followup_3_delay_seconds: 0,
  followup_instructions: null,
  followup_cancellation_instructions: null,
  followup_max_attempts: 1,
  file_processing_enabled: false,
  human_transfer_enabled: false,
  booking_function_enabled: false,
  booking_prompt: '',
  last_deployed_prompt: null,
  needs_external_sync: false,
};

export function useAgentSettings(clientId: string | undefined) {
  const [settings, setSettings] = useState<Record<string, AgentSettings>>({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const settingsRef = useRef<Record<string, AgentSettings>>({});
  const pendingNeedsSyncRef = useRef<Record<string, boolean | undefined>>({});
  const needsSyncInFlightRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const setLocalSlotSettings = useCallback((slotId: string, value: AgentSettings) => {
    settingsRef.current = { ...settingsRef.current, [slotId]: value };
    setSettings((prev) => ({ ...prev, [slotId]: value }));
    if (clientId) setCache(`agent_settings_${clientId}`, settingsRef.current);
  }, [clientId]);

  const removeLocalSlotSettings = useCallback((slotId: string) => {
    const next = { ...settingsRef.current };
    delete next[slotId];
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const fetchSettings = useCallback(async (forceRefresh = false) => {
    if (!clientId) return;
    const cacheKey = `agent_settings_${clientId}`;

    // Show cached data instantly
    if (!forceRefresh) {
      const cached = getCached<Record<string, AgentSettings>>(cacheKey);
      if (cached) {
        settingsRef.current = cached;
        setSettings(cached);
        setLoading(false);
        // If fresh, skip network fetch
        if (isFresh(cacheKey)) return;
      }
    }

    try {
      const { data, error } = await supabase
        .from('agent_settings')
        .select('*')
        .eq('client_id', clientId);
      if (error) throw error;
      const map: Record<string, AgentSettings> = {};
      (data || []).forEach((row: any) => {
        map[row.slot_id] = row;
      });
      setCache(cacheKey, map);
      settingsRef.current = map;
      setSettings(map);
    } catch (err) {
      console.error('Error fetching agent settings:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const getSettings = (slotId: string): AgentSettings => {
    return settingsRef.current[slotId] || { ...DEFAULT_SETTINGS, client_id: clientId || '', slot_id: slotId };
  };

  const updateSettings = async (slotId: string, updates: Partial<AgentSettings>, options?: { silent?: boolean }) => {
    if (!clientId) return;

    // PROMPT-LINT-1 (review follow-up): sendFollowup reads followup_instructions /
    // followup_cancellation_instructions from THIS table, so the lint must gate THIS
    // write path — the save-external-prompt lint only guards the external mirror,
    // which the follow-up engine never reads. Text channel only (voice prompts
    // legitimately carry {{...}} tokens). Lint ONLY the fields being changed in this
    // call, never stored-but-untouched content, so legacy rows can't brick unrelated
    // saves. Throws BEFORE any optimistic or DB write; the deploy flow's outer catch
    // aborts the whole deploy on this, which is the intended contract.
    if (!slotId.startsWith('Voice-Setter-')) {
      const followupFields = [
        ['followup_instructions', updates.followup_instructions],
        ['followup_cancellation_instructions', updates.followup_cancellation_instructions],
      ] as const;
      for (const [field, value] of followupFields) {
        if (typeof value === 'string' && value.trim()) {
          const lint = lintTextSetterPrompt(value);
          if (!lint.ok) {
            const first = lint.errors[0];
            const summary = `${field} blocked by prompt lint — line ${first.line} [${first.rule}]: "${first.excerpt}"${lint.errors.length > 1 ? ` (+${lint.errors.length - 1} more)` : ''}`;
            toast({ title: 'Follow-up text blocked', description: summary, variant: 'destructive' });
            throw new Error(summary);
          }
        }
      }
    }

    const previousSettings = settingsRef.current[slotId];
    const newSettings = {
      ...getSettings(slotId),
      ...updates,
      client_id: clientId,
      slot_id: slotId,
    };

    setLocalSlotSettings(slotId, previousSettings ? { ...previousSettings, ...newSettings } : newSettings);

    try {
      if (previousSettings?.id) {
        const { data, error } = await supabase
          .from('agent_settings')
          .update({
            name: newSettings.name,
            model: newSettings.model,
            response_delay_seconds: newSettings.response_delay_seconds,
            followup_1_delay_seconds: newSettings.followup_1_delay_seconds,
            followup_2_delay_seconds: newSettings.followup_2_delay_seconds,
            followup_3_delay_seconds: newSettings.followup_3_delay_seconds,
            followup_instructions: newSettings.followup_instructions,
            followup_cancellation_instructions: newSettings.followup_cancellation_instructions,
            followup_max_attempts: newSettings.followup_max_attempts,
            file_processing_enabled: newSettings.file_processing_enabled,
            human_transfer_enabled: newSettings.human_transfer_enabled,
            booking_function_enabled: newSettings.booking_function_enabled,
            booking_prompt: newSettings.booking_prompt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', previousSettings.id)
          .select()
          .single();
        if (error) throw error;

        const current = settingsRef.current[slotId];
        setLocalSlotSettings(slotId, {
          ...(data as AgentSettings),
          last_deployed_prompt: current?.last_deployed_prompt ?? (data as AgentSettings).last_deployed_prompt,
          needs_external_sync: current?.needs_external_sync ?? (data as AgentSettings).needs_external_sync,
        });
      } else {
        const { data, error } = await supabase
          .from('agent_settings')
          .upsert({
            client_id: clientId,
            slot_id: slotId,
            name: newSettings.name,
            model: newSettings.model,
            response_delay_seconds: newSettings.response_delay_seconds,
            followup_1_delay_seconds: newSettings.followup_1_delay_seconds,
            followup_2_delay_seconds: newSettings.followup_2_delay_seconds,
            followup_3_delay_seconds: newSettings.followup_3_delay_seconds,
            followup_instructions: newSettings.followup_instructions,
            followup_cancellation_instructions: newSettings.followup_cancellation_instructions,
            followup_max_attempts: newSettings.followup_max_attempts,
            file_processing_enabled: newSettings.file_processing_enabled,
            human_transfer_enabled: newSettings.human_transfer_enabled,
            booking_function_enabled: newSettings.booking_function_enabled,
            booking_prompt: newSettings.booking_prompt,
          }, { onConflict: 'client_id,slot_id' })
          .select()
          .single();
        if (error) throw error;

        const current = settingsRef.current[slotId] || newSettings;
        setLocalSlotSettings(slotId, {
          ...current,
          ...(data as AgentSettings),
          last_deployed_prompt: current.last_deployed_prompt ?? (data as AgentSettings).last_deployed_prompt,
          needs_external_sync: current.needs_external_sync ?? (data as AgentSettings).needs_external_sync,
        });
      }

      if (!options?.silent) {
        toast({ title: 'Settings saved', description: 'Agent settings updated successfully.' });
      }
    } catch (err) {
      if (previousSettings) {
        setLocalSlotSettings(slotId, previousSettings);
      } else {
        removeLocalSlotSettings(slotId);
      }

      console.error('Error saving agent settings:', err);
      toast({ title: 'Error', description: 'Failed to save agent settings.', variant: 'destructive' });
    }
  };

  const setDeployedPrompt = async (slotId: string, deployedPrompt: string) => {
    if (!clientId) return;
    const existing = settingsRef.current[slotId];

    // Optimistic local update
    setLocalSlotSettings(slotId, {
      ...(existing || { ...DEFAULT_SETTINGS, client_id: clientId, slot_id: slotId }),
      last_deployed_prompt: deployedPrompt,
    });

    try {
      if (existing?.id) {
        await supabase
          .from('agent_settings')
          .update({ last_deployed_prompt: deployedPrompt, updated_at: new Date().toISOString() } as any)
          .eq('id', existing.id);
      } else {
        const { data } = await supabase
          .from('agent_settings')
          .insert({
            client_id: clientId,
            slot_id: slotId,
            last_deployed_prompt: deployedPrompt,
          } as any)
          .select()
          .single();
        if (data) {
          const current = settingsRef.current[slotId] || { ...DEFAULT_SETTINGS, client_id: clientId, slot_id: slotId };
          setLocalSlotSettings(slotId, {
            ...current,
            ...(data as AgentSettings),
            last_deployed_prompt: deployedPrompt,
            needs_external_sync: current.needs_external_sync,
          });
        }
      }
    } catch (err) {
      console.error('Error saving deployed prompt:', err);
    }
  };

  const flushNeedsSync = useCallback(async (slotId: string) => {
    if (!clientId || needsSyncInFlightRef.current[slotId]) return;

    needsSyncInFlightRef.current[slotId] = true;
    try {
      while (pendingNeedsSyncRef.current[slotId] !== undefined) {
        const target = pendingNeedsSyncRef.current[slotId]!;
        delete pendingNeedsSyncRef.current[slotId];

        const existing = settingsRef.current[slotId];
        if (existing?.id && existing.needs_external_sync === target) {
          continue;
        }

        if (existing?.id) {
          const { data, error } = await supabase
            .from('agent_settings')
            .update({ needs_external_sync: target, updated_at: new Date().toISOString() } as any)
            .eq('id', existing.id)
            .select()
            .single();

          if (error) throw error;

          if (data) {
            const current = settingsRef.current[slotId] || existing;
            // Use the latest pending value if one exists, otherwise use the target we just wrote
            const latestSync = pendingNeedsSyncRef.current[slotId] ?? target;
            setLocalSlotSettings(slotId, {
              ...current,
              ...(data as AgentSettings),
              last_deployed_prompt: current.last_deployed_prompt,
              needs_external_sync: latestSync,
            });
          }
        } else {
          const { data, error } = await supabase
            .from('agent_settings')
            .insert({
              client_id: clientId,
              slot_id: slotId,
              needs_external_sync: target,
            } as any)
            .select()
            .single();

          if (error) throw error;

          const current = settingsRef.current[slotId] || { ...DEFAULT_SETTINGS, client_id: clientId, slot_id: slotId };
          const latestSync = pendingNeedsSyncRef.current[slotId] ?? target;
          setLocalSlotSettings(slotId, {
            ...current,
            ...(data as AgentSettings),
            last_deployed_prompt: current.last_deployed_prompt,
            needs_external_sync: latestSync,
          });
        }
      }
    } catch (err) {
      console.error('Error saving needs_external_sync:', err);
    } finally {
      needsSyncInFlightRef.current[slotId] = false;
      if (pendingNeedsSyncRef.current[slotId] !== undefined) {
        void flushNeedsSync(slotId);
      }
    }
  }, [clientId, setLocalSlotSettings]);

  const markNeedsSync = async (slotId: string, needsSync: boolean) => {
    if (!clientId) return;
    const existing = settingsRef.current[slotId];

    // Optimistic local update
    setLocalSlotSettings(slotId, {
      ...(existing || { ...DEFAULT_SETTINGS, client_id: clientId, slot_id: slotId }),
      needs_external_sync: needsSync,
    });

    if (existing?.id && existing.needs_external_sync === needsSync && pendingNeedsSyncRef.current[slotId] === undefined && !needsSyncInFlightRef.current[slotId]) {
      return;
    }

    pendingNeedsSyncRef.current[slotId] = needsSync;
    await flushNeedsSync(slotId);
  };

  return { settings, loading, getSettings, updateSettings, setDeployedPrompt, markNeedsSync, refetch: fetchSettings };
}
