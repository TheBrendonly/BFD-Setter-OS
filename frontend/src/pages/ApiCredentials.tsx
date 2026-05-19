import React, { useState, useEffect } from 'react';
import { useCreatorMode } from '@/hooks/useCreatorMode';
import { OpenRouterModelSelector } from '@/components/OpenRouterModelSelector';
import { useParams, useSearchParams } from 'react-router-dom';

import { supabase } from '@/integrations/supabase/client';
import { useClientCredentials, isCredentialConfigured } from '@/hooks/useClientCredentials';
import { useWebhookSave } from '@/hooks/useWebhookSave';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { StatusTag } from '@/components/StatusTag';
import { useToast } from '@/hooks/use-toast';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Key, Webhook, Brain, Loader2, Eye, EyeOff, AlertCircle, Lock, Phone, RefreshCw, Building, Link2 } from '@/components/icons';
import { ConfigStatusBar } from '@/components/ConfigStatusBar';
import { cn } from '@/lib/utils';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useRetellApi } from '@/hooks/useRetellApi';


// Webhook fields that should fire test payloads
const WEBHOOK_FIELDS = [
  'text_engine_webhook',
  'text_engine_followup_webhook',
  
  'update_pipeline_webhook_url',
  'knowledge_base_webhook_url',
  'knowledge_base_add_webhook_url',
  'campaign_webhook_url',
  'database_reactivation_inbound_webhook_url',
  'prompt_webhook_url',
  'analytics_webhook_url',
  'ai_chat_webhook_url',
  'chat_analytics_webhook_url'
];

// Simple input field without save button (for grouped use)
const CredentialInputField = ({ 
  id,
  label, 
  subtitle,
  value, 
  onChange,
  disabled,
  isSavedConfigured,
  isPassword = false,
  placeholder = '',
}: { 
  id: string;
  label: string; 
  subtitle?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  isSavedConfigured: boolean;
  isPassword?: boolean;
  placeholder?: string;
}) => {
  const [showPassword, setShowPassword] = React.useState(false);
  const { cb } = useCreatorMode();
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {isSavedConfigured ? (
          <StatusTag variant="positive">Configured</StatusTag>
        ) : (
          <StatusTag variant="negative" className="animate-pulse">Not Configured</StatusTag>
        )}
      </div>
      <div className="relative">
        <Input 
          id={id}
          type={isPassword && !showPassword ? "password" : "text"}
          autoComplete="off"
          placeholder={isSavedConfigured ? '' : placeholder}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn("font-mono text-sm", isPassword && "pr-10", cb)}
        />
        {isPassword && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus:outline-none"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
};

// API Credential Field component matching SetupGuideDialog styling exactly
const ApiCredentialField = ({ 
  id,
  label, 
  value, 
  onChange,
  onSave,
  isSaving,
  disabled,
  isSavedConfigured,
  isPassword = false,
  placeholder = '',
  isOptional = false,
  isHighlighted = false,
}: { 
  id: string;
  label: string; 
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  isSaving?: boolean;
  disabled: boolean;
  isSavedConfigured: boolean;
  isPassword?: boolean;
  placeholder?: string;
  isOptional?: boolean;
  isHighlighted?: boolean;
}) => {
  const [showPassword, setShowPassword] = React.useState(false);
  const { cb } = useCreatorMode();

  const highlightColors = isSavedConfigured
    ? { text: 'hsl(142, 71%, 45%)', bg: 'hsl(142, 71%, 45%, 0.2)', glow: 'rgba(34, 197, 94, 0.3)' }
    : { text: 'hsl(0, 84%, 60%)', bg: 'hsl(0, 84%, 60%, 0.2)', glow: 'rgba(239, 68, 68, 0.3)' };

  return (
    <div
      id={`field-${id}`}
      className="space-y-2 rounded-md"
      style={{ padding: '6px 8px', margin: '0 -8px' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
          {isOptional && !isSavedConfigured && (
            <span className="text-xs text-muted-foreground">(Not Required)</span>
          )}
        </div>
        {isSavedConfigured ? (
          <StatusTag variant="positive">Configured</StatusTag>
        ) : !isOptional ? (
          <StatusTag variant="negative" className="animate-pulse">Not Configured</StatusTag>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {isHighlighted && (
          <span
            className="credential-arrow-pulse shrink-0 -ml-1"
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '14px',
              color: isSavedConfigured ? 'hsl(142, 71%, 45%)' : 'hsl(0, 84%, 60%)',
              textShadow: isSavedConfigured ? '0 0 6px rgba(34, 197, 94, 0.3)' : '0 0 6px rgba(239, 68, 68, 0.3)',
            }}
          >
            ▶
          </span>
        )}
        <div className="relative flex-1">
          <Input
            id={id}
            type={isPassword && !showPassword ? "password" : "text"}
            autoComplete="off"
            placeholder={isSavedConfigured ? '' : placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={cn("font-mono text-sm", isPassword && "pr-10", cb)}
          />
          {isHighlighted && (
            <div
              className="absolute inset-[3px] pointer-events-none credential-arrow-pulse"
              style={{
                border: `1px solid ${isSavedConfigured ? 'hsl(142, 71%, 45%)' : 'hsl(0, 84%, 60%)'}`,
                boxShadow: isSavedConfigured
                  ? 'inset 0 0 0 1px hsl(142 71% 45% / 0.15)'
                  : 'inset 0 0 0 1px hsl(0 84% 60% / 0.15)',
              }}
            />
          )}
        {isPassword && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus:outline-none"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          onClick={onSave}
          disabled={disabled || isSaving}
          size="sm"
          className="font-medium"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

interface ApiSettings {
  api_webhook_url: string | null;
  openai_api_key: string | null;
  openrouter_api_key: string | null;
  openrouter_management_key: string | null;
  elevenlabs_api_key: string | null;
  elevenlabs_agent_id: string | null;
  retell_api_key: string | null;
  supabase_service_key?: string | null;
  supabase_table_name?: string | null;
  supabase_url?: string | null;
  supabase_access_token?: string | null;
  campaign_webhook_url?: string | null;
  knowledge_base_webhook_url?: string | null;
  prompt_webhook_url?: string | null;
  analytics_webhook_url?: string | null;
  ai_chat_webhook_url?: string | null;
  chat_analytics_webhook_url?: string | null;
  text_engine_webhook?: string | null;
  text_engine_followup_webhook?: string | null;
  simulation_webhook?: string | null;
  system_prompt?: string | null;
  database_reactivation_inbound_webhook_url?: string | null;
  update_pipeline_webhook_url?: string | null;
  twilio_account_sid?: string | null;
  twilio_auth_token?: string | null;
  twilio_default_phone?: string | null;
  ghl_api_key?: string | null;
  ghl_calendar_id?: string | null;
  gohighlevel_booking_title?: string | null;
  ghl_assignee_id?: string | null;
  ghl_location_id?: string | null;
  ghl_send_setter_reply_webhook_url?: string | null;
  send_message_webhook_url?: string | null;
  send_followup_webhook_url?: string | null;
  send_engagement_webhook_url?: string | null;
  stop_bot_webhook_url?: string | null;
  llm_model?: string | null;
}

const ApiCredentials = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  usePageHeader({ title: 'Credentials' });
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [refreshingGroup, setRefreshingGroup] = useState<string | null>(null);
  const [highlightedField, setHighlightedField] = useState<string | null>(null);
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);

  // Use cached credentials hook - prevents flash of incorrect state
  const { credentials, isLoading, updateCredential, updateMultipleCredentials, refetch } = useClientCredentials(clientId);

  useEffect(() => {
    const highlight = searchParams.get('highlight');
    if (highlight) {
      setPendingHighlight(highlight);
    }
  }, [searchParams]);

  // Handle highlight query param — wait for the form to render, then scroll and flash-highlight a field
  useEffect(() => {
    if (!pendingHighlight || isLoading) return;

    const highlightField = pendingHighlight;
    let attempts = 0;
    let retryTimer: number | null = null;
    let scrollTimer: number | null = null;
    let highlightDelayTimer: number | null = null;
    let clearHighlightTimer: number | null = null;

    const runHighlight = () => {
      const fieldEl = document.getElementById(`field-${highlightField}`);
      const sectionEl = document.getElementById('knowledge-base-webhooks');

      if (!fieldEl) {
        if (attempts < 20) {
          attempts += 1;
          retryTimer = window.setTimeout(runHighlight, 150);
        }
        return;
      }

      sectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      scrollTimer = window.setTimeout(() => {
        fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 180);

      highlightDelayTimer = window.setTimeout(() => {
        setHighlightedField(highlightField);
      }, 500);

      clearHighlightTimer = window.setTimeout(() => {
        setHighlightedField((current) => (current === highlightField ? null : current));
        setPendingHighlight(null);

        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('highlight');
        setSearchParams(nextParams, { replace: true });
      }, 6500);
    };

    runHighlight();

    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      if (scrollTimer) window.clearTimeout(scrollTimer);
      if (highlightDelayTimer) window.clearTimeout(highlightDelayTimer);
      if (clearHighlightTimer) window.clearTimeout(clearHighlightTimer);
    };
  }, [pendingHighlight, isLoading, searchParams, setSearchParams]);
  
  // Use webhook save hook for firing test payloads
  const { saveWebhookField } = useWebhookSave({ 
    clientId: clientId || '', 
    onSuccess: () => refetch() 
  });

  // Sync credentials to external Supabase's credentials table
  const syncToExternalSupabase = async () => {
    if (!clientId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/sync-external-credentials`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ clientId }),
        }
      );
      const result = await res.json();
      if (!res.ok) {
        console.error('External sync failed:', result.error);
      } else {
        console.log('External Supabase credentials synced:', result);
      }
    } catch (error) {
      console.error('Error syncing to external Supabase:', error);
    }
  };

  // Send all credentials to the api-credentials webhook after any save
  const sendToApiCredentialsWebhook = async () => {
    if (!clientId) return;
    try {
      const { data } = await (await import('@/integrations/supabase/client')).supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();
      if (!data) return;

      const apiWebhookUrl = data.api_webhook_url;
      if (!apiWebhookUrl) {
        // Per-client api_webhook_url not configured — skip the external mirror rather than
        // leak credentials to a hardcoded upstream fallback (N5 2026-05-19).
        return;
      }
      
      const payload = {
        type: 'api_settings_updated',
        timestamp: new Date().toISOString(),
        client_id: clientId,
        supabase_url: data.supabase_url,
        supabase_service_key: data.supabase_service_key,
        openai_api_key: data.openai_api_key,
        openrouter_api_key: data.openrouter_api_key,
        elevenlabs_api_key: data.elevenlabs_api_key,
        elevenlabs_agent_id: data.elevenlabs_agent_id,
        ghl_api_key: data.ghl_api_key,
        ghl_calendar_id: data.ghl_calendar_id,
        ghl_location_id: data.ghl_location_id,
        text_engine_webhook: data.text_engine_webhook,
        knowledge_base_webhook: data.knowledge_base_add_webhook_url,
      };

      await fetch(apiWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log('Sent credentials to api-credentials webhook:', apiWebhookUrl);
    } catch (error) {
      console.error('Error sending to api-credentials webhook:', error);
    }

    await syncToExternalSupabase();
  };
  
  const [settings, setSettings] = useState<ApiSettings>({
    api_webhook_url: '',
    openai_api_key: '',
    openrouter_api_key: '',
    openrouter_management_key: '',
    elevenlabs_api_key: '',
    elevenlabs_agent_id: '',
    retell_api_key: '',
    supabase_service_key: '',
    supabase_table_name: '',
    supabase_url: '',
    supabase_access_token: '',
    campaign_webhook_url: '',
    knowledge_base_webhook_url: '',
    prompt_webhook_url: '',
    analytics_webhook_url: '',
    ai_chat_webhook_url: '',
    chat_analytics_webhook_url: '',
    text_engine_webhook: '',
    text_engine_followup_webhook: '',
    simulation_webhook: '',
    system_prompt: '',
    database_reactivation_inbound_webhook_url: '',
    update_pipeline_webhook_url: '',
    twilio_account_sid: '',
    twilio_auth_token: '',
    twilio_default_phone: '',
    ghl_api_key: '',
     ghl_calendar_id: '',
    gohighlevel_booking_title: '',
    ghl_assignee_id: '',
    ghl_location_id: '',
    ghl_send_setter_reply_webhook_url: '',
    send_message_webhook_url: '',
    send_followup_webhook_url: '',
    send_engagement_webhook_url: '',
    stop_bot_webhook_url: '',
    llm_model: '',
  });

  // Sync local settings with cached credentials
  useEffect(() => {
    if (credentials) {
      setSettings({
        api_webhook_url: credentials.api_webhook_url || '',
        openai_api_key: credentials.openai_api_key || '',
        openrouter_api_key: credentials.openrouter_api_key || '',
        openrouter_management_key: (credentials as any).openrouter_management_key || '',
        elevenlabs_api_key: credentials.elevenlabs_api_key || '',
        elevenlabs_agent_id: (credentials as any).elevenlabs_agent_id || '',
        retell_api_key: credentials.retell_api_key || '',
        supabase_service_key: credentials.supabase_service_key || '',
        supabase_table_name: credentials.supabase_table_name || '',
        supabase_url: credentials.supabase_url || '',
        supabase_access_token: (credentials as any).supabase_access_token || '',
        campaign_webhook_url: credentials.campaign_webhook_url || '',
        knowledge_base_webhook_url: credentials.knowledge_base_add_webhook_url || '',
        prompt_webhook_url: credentials.prompt_webhook_url || '',
        analytics_webhook_url: credentials.analytics_webhook_url || '',
        ai_chat_webhook_url: credentials.ai_chat_webhook_url || '',
        chat_analytics_webhook_url: credentials.chat_analytics_webhook_url || '',
        text_engine_webhook: credentials.text_engine_webhook || '',
        simulation_webhook: (credentials as any).simulation_webhook || '',
        system_prompt: '',
        database_reactivation_inbound_webhook_url: credentials.database_reactivation_inbound_webhook_url || '',
        update_pipeline_webhook_url: credentials.update_pipeline_webhook_url || '',
        twilio_account_sid: (credentials as any).twilio_account_sid || '',
        twilio_auth_token: (credentials as any).twilio_auth_token || '',
        twilio_default_phone: (credentials as any).twilio_default_phone || '',
        ghl_api_key: credentials.ghl_api_key || '',
        ghl_calendar_id: credentials.ghl_calendar_id || '',
        gohighlevel_booking_title: (credentials as any).gohighlevel_booking_title || '',
        ghl_assignee_id: (credentials as any).ghl_assignee_id || '',
        ghl_location_id: credentials.ghl_location_id || '',
        ghl_send_setter_reply_webhook_url: (credentials as any).ghl_send_setter_reply_webhook_url || '',
        send_message_webhook_url: (credentials as any).send_message_webhook_url || '',
        send_followup_webhook_url: (credentials as any).send_followup_webhook_url || '',
        send_engagement_webhook_url: (credentials as any).send_engagement_webhook_url || '',
        stop_bot_webhook_url: (credentials as any).stop_bot_webhook_url || '',
        llm_model: (credentials as any).llm_model || '',
      });
    }
  }, [credentials]);

  const handleInputChange = (field: keyof ApiSettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveField = async (field: keyof ApiSettings) => {
    if (!clientId) return;
    setSavingField(field);
    try {
      const fieldValue = settings[field] || null;
      const updateField = field === 'knowledge_base_webhook_url' ? 'knowledge_base_add_webhook_url' : field;
      
      // Check if this is a webhook field - use webhook save to fire test payload
      if (WEBHOOK_FIELDS.includes(field) || WEBHOOK_FIELDS.includes(updateField)) {
        const webhookUrl = fieldValue?.trim();
        if (webhookUrl) {
          // Use webhook save which fires test payload and syncs to backend
          await saveWebhookField(updateField, webhookUrl);
        } else {
          // If clearing the webhook, just update without test payload
          await updateCredential({ field: updateField, value: null });
          toast({ title: "Saved", description: `${field.replace(/_/g, ' ')} cleared successfully` });
        }
      } else {
        // Non-webhook field - use regular update
        await updateCredential({ field: updateField, value: fieldValue });
        toast({ title: "Saved", description: `${field.replace(/_/g, ' ')} updated successfully` });
      }
      // Send updated data to api-credentials webhook
      await sendToApiCredentialsWebhook();
    } catch (error) {
      console.error('Error saving field:', error);
      toast({ title: "Error", description: "Failed to save field", variant: "destructive" });
    } finally {
      setSavingField(null);
    }
  };

  // Save Supabase credentials together
  const handleSaveSupabaseCredentials = async () => {
    if (!clientId) return;
    
    const url = settings.supabase_url?.trim();
    const key = settings.supabase_service_key?.trim();
    
    if (!url || !key) {
      toast({ 
        title: "Both fields required", 
        description: "Please enter both Supabase URL and Service Role Key", 
        variant: "destructive" 
      });
      return;
    }
    
    setSavingGroup('supabase');
    try {
      const updates: Record<string, string | null> = { 
        supabase_url: url, 
        supabase_service_key: key,
      };
      if (settings.supabase_access_token?.trim()) {
        updates.supabase_access_token = settings.supabase_access_token.trim();
      }
      await updateMultipleCredentials({ updates });
      await sendToApiCredentialsWebhook();
      toast({ title: "Saved", description: "Supabase credentials saved successfully" });
    } catch (error) {
      console.error('Error saving Supabase credentials:', error);
      toast({ title: "Error", description: "Failed to save Supabase credentials", variant: "destructive" });
    } finally {
      setSavingGroup(null);
    }
  };

  // Save LLM credentials together
  const handleSaveLLMCredentials = async () => {
    if (!clientId) return;
    
    const openai = settings.openai_api_key?.trim();
    const openrouter = settings.openrouter_api_key?.trim();
    
    if (!openai || !openrouter) {
      toast({ 
        title: "Both fields required", 
        description: "Please enter both OpenAI API Key and OpenRouter API Key", 
        variant: "destructive" 
      });
      return;
    }
    
    setSavingGroup('llm');
    try {
      const updates: Record<string, string | null> = { 
        openai_api_key: openai, 
        openrouter_api_key: openrouter,
      };
      const mgmtKey = settings.openrouter_management_key?.trim();
      if (mgmtKey) {
        updates.openrouter_management_key = mgmtKey;
      }
      const llmModel = settings.llm_model?.trim();
      if (llmModel) {
        updates.llm_model = llmModel;
      }
      await updateMultipleCredentials({ updates });
      await sendToApiCredentialsWebhook();
      toast({ title: "Saved", description: "LLM credentials saved successfully" });
    } catch (error) {
      console.error('Error saving LLM credentials:', error);
      toast({ title: "Error", description: "Failed to save LLM credentials", variant: "destructive" });
    } finally {
      setSavingGroup(null);
    }
  };

  // Save ElevenLabs credentials
  const handleSaveElevenLabsCredentials = async () => {
    if (!clientId) return;
    
    const key = settings.elevenlabs_api_key?.trim();
    const agentId = settings.elevenlabs_agent_id?.trim();
    
    if (!key) {
      toast({ 
        title: "Field required", 
        description: "Please enter your ElevenLabs API key", 
        variant: "destructive" 
      });
      return;
    }
    
    setSavingGroup('elevenlabs');
    try {
      await updateMultipleCredentials({
        updates: {
          elevenlabs_api_key: key,
          elevenlabs_agent_id: agentId || null,
        }
      });
      await sendToApiCredentialsWebhook();
      toast({ title: "Saved", description: "ElevenLabs credentials saved successfully" });
    } catch (error) {
      console.error('Error saving ElevenLabs credentials:', error);
      toast({ title: "Error", description: "Failed to save ElevenLabs credentials", variant: "destructive" });
    } finally {
      setSavingGroup(null);
    }
  };

  // Save Retell AI credentials
  const handleSaveRetellCredentials = async () => {
    if (!clientId) return;
    
    const key = settings.retell_api_key?.trim();
    
    if (!key) {
      toast({ 
        title: "Field required", 
        description: "Please enter your Retell API key", 
        variant: "destructive" 
      });
      return;
    }
    
    setSavingGroup('retell');
    try {
      await updateCredential({ field: 'retell_api_key', value: key });
      await sendToApiCredentialsWebhook();
      toast({ title: "Saved", description: "Retell AI credentials saved successfully" });
    } catch (error) {
      console.error('Error saving Retell credentials:', error);
      toast({ title: "Error", description: "Failed to save Retell credentials", variant: "destructive" });
    } finally {
      setSavingGroup(null);
    }
  };

  // Re-push credentials to Supabase (refresh/sync)
  const handleRefreshGroup = async (group: 'llm' | 'elevenlabs' | 'webhooks' | 'retell') => {
    if (!clientId) return;
    setRefreshingGroup(group);
    try {
      let updates: Record<string, string | null> = {};
      if (group === 'llm') {
        updates = {
          openai_api_key: settings.openai_api_key?.trim() || null,
          openrouter_api_key: settings.openrouter_api_key?.trim() || null,
          openrouter_management_key: settings.openrouter_management_key?.trim() || null,
        };
      } else if (group === 'elevenlabs') {
        updates = {
          elevenlabs_api_key: settings.elevenlabs_api_key?.trim() || null,
          elevenlabs_agent_id: settings.elevenlabs_agent_id?.trim() || null,
        };
      } else if (group === 'retell') {
        updates = {
          retell_api_key: settings.retell_api_key?.trim() || null,
        };
      } else if (group === 'webhooks') {
        updates = {
          text_engine_webhook: settings.text_engine_webhook?.trim() || null,
          simulation_webhook: settings.simulation_webhook?.trim() || null,
        };
      }
      await updateMultipleCredentials({ updates });
      await sendToApiCredentialsWebhook();
      toast({ title: "Synced", description: `${group === 'llm' ? 'LLM' : group === 'retell' ? 'Retell AI' : group === 'elevenlabs' ? 'ElevenLabs' : 'Webhook'} credentials re-synced to database` });
    } catch (error) {
      console.error(`Error refreshing ${group} credentials:`, error);
      toast({ title: "Error", description: `Failed to sync ${group} credentials`, variant: "destructive" });
    } finally {
      setRefreshingGroup(null);
    }
  };


  const areRequiredCredentialsConfigured = () => {
    const hasSupabase = isCredentialConfigured(credentials?.supabase_url) && 
                        isCredentialConfigured(credentials?.supabase_service_key);
    const hasLLM = isCredentialConfigured(credentials?.openai_api_key) || 
                   isCredentialConfigured(credentials?.openrouter_api_key);
    return hasSupabase && hasLLM;
  };

  // Get missing credentials for the alert message
  const getMissingCredentials = () => {
    const missing: string[] = [];
    if (!isCredentialConfigured(credentials?.supabase_url) || !isCredentialConfigured(credentials?.supabase_service_key)) {
      missing.push('Supabase');
    }
    if (!isCredentialConfigured(credentials?.openai_api_key) && !isCredentialConfigured(credentials?.openrouter_api_key)) {
      missing.push('LLM (OpenAI or OpenRouter)');
    }
    return missing;
  };

  const requiredFieldsConfigured = areRequiredCredentialsConfigured();

  // Show loading only on initial load (no cached data)
  if (isLoading && !credentials) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="space-y-6">

          {/* Config Status Bar for missing credentials */}
          {!requiredFieldsConfigured && (
            <ConfigStatusBar
              configs={getMissingCredentials().map(name => ({
                name,
                isConfigured: false,
                description: `${name} credentials required`,
                scrollToId: name.toLowerCase().includes('supabase') ? 'supabase-configuration' : 'llm-configuration'
              }))}
            />
          )}

          {/* Supabase Credentials */}
          <Card id="supabase-configuration" className="material-surface scroll-mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="w-5 h-5" />
                Supabase Credentials
              </CardTitle>
              <CardDescription>
                Both fields are required to save. Enter your Supabase project URL and service role key.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <CredentialInputField
                  id="supabase_url"
                  label="Supabase Project URL"
                  value={settings.supabase_url || ''}
                  onChange={(value) => handleInputChange('supabase_url', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.supabase_url)}
                  placeholder="https://your-project.supabase.co"
                />
                <CredentialInputField
                  id="supabase_service_key"
                  label="Supabase Service Role Key"
                  value={settings.supabase_service_key || ''}
                  onChange={(value) => handleInputChange('supabase_service_key', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.supabase_service_key)}
                  isPassword
                  placeholder="Enter your Supabase service role key"
                />
                <CredentialInputField
                  id="supabase_access_token"
                  label="Supabase Personal Access Token (PAT)"
                  value={settings.supabase_access_token || ''}
                  onChange={(value) => handleInputChange('supabase_access_token', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.supabase_access_token)}
                  isPassword
                  placeholder="sbp_... (for Supabase Usage dashboard)"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSaveSupabaseCredentials}
                    disabled={savingGroup === 'supabase' || !settings.supabase_url?.trim() || !settings.supabase_service_key?.trim()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingGroup === 'supabase' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LLM Credentials */}
          <Card id="llm-configuration" className="material-surface scroll-mt-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  LLM Credentials
                </CardTitle>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleRefreshGroup('llm')}
                  disabled={refreshingGroup === 'llm'}
                >
                  <RefreshCw className={cn("h-4 w-4", refreshingGroup === 'llm' && "animate-spin")} />
                </Button>
              </div>
              <CardDescription>
                Both fields are required to save. Enter your OpenAI and OpenRouter API keys.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <CredentialInputField
                  id="openai_api_key"
                  label="OpenAI API Key"
                  value={settings.openai_api_key || ''}
                  onChange={(value) => handleInputChange('openai_api_key', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.openai_api_key)}
                  isPassword
                  placeholder="Enter your OpenAI API key"
                />
                <CredentialInputField
                  id="openrouter_api_key"
                  label="OpenRouter API Key"
                  value={settings.openrouter_api_key || ''}
                  onChange={(value) => handleInputChange('openrouter_api_key', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.openrouter_api_key)}
                  isPassword
                  placeholder="Enter your OpenRouter API key"
                />
                <CredentialInputField
                  id="openrouter_management_key"
                  label="OpenRouter Management Key"
                  value={settings.openrouter_management_key || ''}
                  onChange={(value) => handleInputChange('openrouter_management_key', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.openrouter_management_key)}
                  isPassword
                  placeholder="Enter your OpenRouter management key (for billing/activity data)"
                />
                <OpenRouterModelSelector
                  value={settings.llm_model || ''}
                  onChange={(value) => handleInputChange('llm_model', value)}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.llm_model)}
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSaveLLMCredentials}
                    disabled={savingGroup === 'llm' || !settings.openai_api_key?.trim() || !settings.openrouter_api_key?.trim()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingGroup === 'llm' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Retell AI Credentials */}
          <Card id="retell-configuration" className="material-surface scroll-mt-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  Retell AI Credentials
                </CardTitle>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleRefreshGroup('retell')}
                  disabled={refreshingGroup === 'retell'}
                >
                  <RefreshCw className={cn("h-4 w-4", refreshingGroup === 'retell' && "animate-spin")} />
                </Button>
              </div>
              <CardDescription>
                Enter your Retell AI API key for Voice AI Setter.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <CredentialInputField
                  id="retell_api_key"
                  label="Retell API Key"
                  value={settings.retell_api_key || ''}
                  onChange={(value) => handleInputChange('retell_api_key', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.retell_api_key)}
                  isPassword
                  placeholder="key_xxxxxxxxxxxxxxxxxxxxxxxx"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSaveRetellCredentials}
                    disabled={savingGroup === 'retell' || !settings.retell_api_key?.trim()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingGroup === 'retell' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>

              </div>
            </CardContent>
          </Card>

          {/* GoHighLevel Connection */}
          <Card className="material-surface scroll-mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building className="w-5 h-5" />
                GoHighLevel Connection
              </CardTitle>
              <CardDescription>
                Save the GoHighLevel API key, calendar ID, assignee ID, and sub-account ID used for calendar bookings and voice setter calls.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <CredentialInputField
                  id="ghl_api_key"
                  label="API Key"
                  value={settings.ghl_api_key || ''}
                  onChange={(value) => handleInputChange('ghl_api_key', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.ghl_api_key)}
                  isPassword
                  placeholder="Enter your GoHighLevel API key"
                />
                <CredentialInputField
                  id="ghl_calendar_id"
                  label="Calendar ID"
                  value={settings.ghl_calendar_id || ''}
                  onChange={(value) => handleInputChange('ghl_calendar_id', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.ghl_calendar_id)}
                  placeholder="Enter your GoHighLevel calendar ID"
                />
                <CredentialInputField
                  id="gohighlevel_booking_title"
                  label="Booking Title"
                  subtitle="This is how your leads will see the appointment in their calendar (e.g. &quot;Strategy call with Jessica&quot;)"
                  value={settings.gohighlevel_booking_title || ''}
                  onChange={(value) => handleInputChange('gohighlevel_booking_title', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.gohighlevel_booking_title)}
                  placeholder="e.g. Strategy call with Brendan"
                />
                <CredentialInputField
                  id="ghl_assignee_id"
                  label="Assignee ID"
                  value={settings.ghl_assignee_id || ''}
                  onChange={(value) => handleInputChange('ghl_assignee_id', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.ghl_assignee_id)}
                  placeholder="Enter the GHL user/assignee ID for calendar bookings"
                />
                <CredentialInputField
                  id="ghl_location_id"
                  label="Sub-Account ID (Location ID)"
                  value={settings.ghl_location_id || ''}
                  onChange={(value) => handleInputChange('ghl_location_id', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured(credentials?.ghl_location_id)}
                  placeholder="Enter your GHL Location ID"
                />
                <CredentialInputField
                  id="ghl_send_setter_reply_webhook_url"
                  label="Send Setter Reply Webhook URL"
                  value={settings.ghl_send_setter_reply_webhook_url || ''}
                  onChange={(value) => handleInputChange('ghl_send_setter_reply_webhook_url', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.ghl_send_setter_reply_webhook_url)}
                  placeholder="Enter the webhook URL for sending setter replies back to GHL"
                />
                <CredentialInputField
                  id="send_message_webhook_url"
                  label="Send Message Webhook URL"
                  value={settings.send_message_webhook_url || ''}
                  onChange={(value) => handleInputChange('send_message_webhook_url', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.send_message_webhook_url)}
                  placeholder="Enter the webhook URL for sending manual messages via GHL"
                />
                <CredentialInputField
                  id="send_followup_webhook_url"
                  label="Send Follow-Up Webhook URL"
                  value={settings.send_followup_webhook_url || ''}
                  onChange={(value) => handleInputChange('send_followup_webhook_url', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.send_followup_webhook_url)}
                  placeholder="Enter the webhook URL for sending text setter follow-up messages via GHL"
                />
                <CredentialInputField
                  id="send_engagement_webhook_url"
                  label="Send Engagement Webhook URL"
                  value={settings.send_engagement_webhook_url || ''}
                  onChange={(value) => handleInputChange('send_engagement_webhook_url', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.send_engagement_webhook_url)}
                  placeholder="Enter the webhook URL for sending engagement workflow messages via GHL"
                />
                <CredentialInputField
                  id="stop_bot_webhook_url"
                  label="Stop Bot Webhook URL"
                  value={settings.stop_bot_webhook_url || ''}
                  onChange={(value) => handleInputChange('stop_bot_webhook_url', value)}
                  disabled={false}
                  isSavedConfigured={isCredentialConfigured((credentials as any)?.stop_bot_webhook_url)}
                  placeholder="Enter the webhook URL to stop the AI setter for a lead"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={async () => {
                      if (!clientId) return;

                      const hasAnyCoreGhlField = Boolean(
                        settings.ghl_api_key?.trim() ||
                        settings.ghl_calendar_id?.trim() ||
                        settings.ghl_location_id?.trim()
                      );

                      if (
                        hasAnyCoreGhlField &&
                        (!settings.ghl_api_key?.trim() || !settings.ghl_calendar_id?.trim() || !settings.ghl_location_id?.trim())
                      ) {
                        toast({
                          title: 'Missing GoHighLevel fields',
                          description: 'Add the GHL API key, Calendar ID, and Location ID before saving voice setter availability settings.',
                          variant: 'destructive'
                        });
                        return;
                      }

                      setSavingGroup('ghl');
                      try {
                        await updateMultipleCredentials({
                          updates: {
                            ghl_api_key: settings.ghl_api_key?.trim() || null,
                            ghl_calendar_id: settings.ghl_calendar_id?.trim() || null,
                            gohighlevel_booking_title: settings.gohighlevel_booking_title?.trim() || null,
                            ghl_assignee_id: settings.ghl_assignee_id?.trim() || null,
                            ghl_location_id: settings.ghl_location_id?.trim() || null,
                            ghl_send_setter_reply_webhook_url: settings.ghl_send_setter_reply_webhook_url?.trim() || null,
                            send_message_webhook_url: settings.send_message_webhook_url?.trim() || null,
                            send_followup_webhook_url: settings.send_followup_webhook_url?.trim() || null,
                            send_engagement_webhook_url: settings.send_engagement_webhook_url?.trim() || null,
                            stop_bot_webhook_url: settings.stop_bot_webhook_url?.trim() || null,
                          }
                        });
                        await sendToApiCredentialsWebhook();
                        await syncToExternalSupabase();
                        toast({ title: 'Saved', description: 'GoHighLevel settings saved successfully' });
                      } catch (error) {
                        toast({ title: 'Error', description: 'Failed to save GoHighLevel settings', variant: 'destructive' });
                      } finally {
                        setSavingGroup(null);
                      }
                    }}
                    disabled={savingGroup === 'ghl'}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingGroup === 'ghl' ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                    ) : (
                      <><Save className="h-4 w-4 mr-2" /> Save</>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* n8n Connections */}
          <Card id="knowledge-base-webhooks" className={cn(
            "material-surface border border-border scroll-mt-6",
            !requiredFieldsConfigured && "opacity-60"
          )}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  {!requiredFieldsConfigured ? <Lock className="w-5 h-5 text-muted-foreground" /> : <Link2 className="w-5 h-5" />}
                  n8n Connections
                </CardTitle>
                <div className="flex items-center gap-2">
                  {!requiredFieldsConfigured && (
                    <Badge variant="outline" className="text-muted-foreground">Locked</Badge>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleRefreshGroup('webhooks')}
                    disabled={refreshingGroup === 'webhooks' || !requiredFieldsConfigured}
                  >
                    <RefreshCw className={cn("h-4 w-4", refreshingGroup === 'webhooks' && "animate-spin")} />
                  </Button>
                </div>
              </div>
              {!requiredFieldsConfigured && (
                <p className="text-sm text-muted-foreground mt-2">
                  Configure Supabase & LLM credentials first to unlock this section
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <ApiCredentialField id="text_engine_webhook" label="Text Engine Webhook URL" value={settings.text_engine_webhook || ''} onChange={(value) => handleInputChange('text_engine_webhook', value)} onSave={() => handleSaveField('text_engine_webhook')} isSaving={savingField === 'text_engine_webhook'} disabled={!requiredFieldsConfigured} isSavedConfigured={isCredentialConfigured(credentials?.text_engine_webhook)} placeholder="Enter Text Engine webhook URL" isHighlighted={highlightedField === 'text_engine_webhook'} />
              <ApiCredentialField id="simulation_webhook" label="Simulation Webhook URL" value={settings.simulation_webhook || ''} onChange={(value) => handleInputChange('simulation_webhook', value)} onSave={() => handleSaveField('simulation_webhook')} isSaving={savingField === 'simulation_webhook'} disabled={!requiredFieldsConfigured} isSavedConfigured={isCredentialConfigured((credentials as any)?.simulation_webhook)} placeholder="Enter Simulation webhook URL" />
            </CardContent>
          </Card>


        </div>
      </div>
    </div>
  );
};

export default ApiCredentials;
