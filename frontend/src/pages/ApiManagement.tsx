import React, { useState, useEffect, useRef } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowLeft, Save, Key, Calendar, User, MapPin, Webhook, AlertCircle, Brain, MessageSquarePlus, Settings, Loader2, ChevronDown, ChevronRight, Copy, Database, BookOpen, Eye, EyeOff, CheckCircle, FileUp, Wrench, Phone, MessageSquare, FolderOpen, Lock } from '@/components/icons';
import { ConfigStatusBar } from '@/components/ConfigStatusBar';
import { Textarea } from '@/components/ui/textarea';
import SetupGuideDialog, { areAllPhasesComplete, SETUP_PHASES, PHASE_IDS, isPhaseComplete } from '@/components/SetupGuideDialog';
import { cn } from '@/lib/utils';

// API Setup phase definitions for the cards grid
const API_PHASES = [{
  id: 'account-creation' as keyof typeof SETUP_PHASES,
  title: 'Accounts Setup',
  description: 'Create accounts for Supabase, n8n, HighLevel, and Retell',
  icon: User,
  dialogPhase: 0,
  dialogStep: 0
}, {
  id: 'supabase-setup' as keyof typeof SETUP_PHASES,
  title: 'Supabase Setup',
  description: 'Configure your Supabase database connection',
  icon: Database,
  dialogPhase: 1,
  dialogStep: 0
}, {
  id: 'workflows-import' as keyof typeof SETUP_PHASES,
  title: 'Workflows Import',
  description: 'Download and import n8n workflows',
  icon: FileUp,
  dialogPhase: 2,
  dialogStep: 0
}, {
  id: 'n8n-setup' as keyof typeof SETUP_PHASES,
  title: 'Text AI Rep Setup',
  description: 'Configure your Text AI Rep workflow in n8n',
  icon: Wrench,
  dialogPhase: 3,
  dialogStep: 0
}, {
  id: 'text-prompts-setup' as keyof typeof SETUP_PHASES,
  title: 'Text Prompts Setup',
  description: 'Configure your Text AI agent prompts',
  icon: MessageSquarePlus,
  dialogPhase: 4,
  dialogStep: 0
}, {
  id: 'highlevel-credentials' as keyof typeof SETUP_PHASES,
  title: 'HighLevel Credentials',
  description: 'Set up your GoHighLevel API credentials',
  icon: Key,
  dialogPhase: 5,
  dialogStep: 0
}, {
  id: 'highlevel-setup' as keyof typeof SETUP_PHASES,
  title: 'HighLevel Setup',
  description: 'Configure HighLevel workflows and webhooks',
  icon: Settings,
  dialogPhase: 6,
  dialogStep: 0
}, {
  id: 'twilio-setup' as keyof typeof SETUP_PHASES,
  title: 'Twilio Setup',
  description: 'Configure Twilio for SMS messaging',
  icon: MessageSquare,
  dialogPhase: 7,
  dialogStep: 0
}, {
  id: 'retell-setup' as keyof typeof SETUP_PHASES,
  title: 'Voice AI Rep Setup',
  description: 'Configure your Voice AI Rep with Retell',
  icon: Phone,
  dialogPhase: 8,
  dialogStep: 0
}, {
  id: 'voice-prompts-setup' as keyof typeof SETUP_PHASES,
  title: 'Voice Prompts Setup',
  description: 'Configure your Voice AI agent prompts',
  icon: MessageSquarePlus,
  dialogPhase: 9,
  dialogStep: 0
}, {
  id: 'knowledgebase-setup' as keyof typeof SETUP_PHASES,
  title: 'Knowledgebase Setup',
  description: 'Set up your knowledge base workflow',
  icon: FolderOpen,
  dialogPhase: 10,
  dialogStep: 0
}];

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
  isOptional = false
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
}) => {
  const [showPassword, setShowPassword] = React.useState(false);

  // Determine styling based on configured status and whether field is optional
  const getBorderClasses = () => {
    if (isSavedConfigured) {
      return "border-green-500 bg-green-500/10";
    }
    if (isOptional) {
      return "border-muted bg-muted/5";
    }
    return "animate-pulse-red border-red-500/50 bg-red-500/5";
  };
  return <div className={cn("space-y-2 rounded-lg p-4 border-2", getBorderClasses())}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
          {isOptional && !isSavedConfigured && <span className="text-xs text-muted-foreground">(Not Required)</span>}
        </div>
        {isSavedConfigured && <Badge className="bg-success/20 text-foreground border border-foreground hover:bg-success/20">
            Configured
          </Badge>}
      </div>
      <div className="relative">
        <Input id={id} type={isPassword && !showPassword ? "password" : "text"} autoComplete="off" placeholder={isSavedConfigured ? '' : placeholder} value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={cn("font-mono text-sm", isPassword && "pr-10")} />
        {isPassword && <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 hover:bg-transparent" onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>}
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={onSave} disabled={disabled || isSaving} size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
          {isSaving ? <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </> : <>
              <Save className="h-4 w-4 mr-2" />
              Save
            </>}
        </Button>
      </div>
    </div>;
};
interface ApiSettings {
  ghl_api_key: string | null;
  ghl_assignee_id: string | null;
  ghl_calendar_id: string | null;
  ghl_location_id: string | null;
  api_webhook_url: string | null;
  openai_api_key: string | null;
  openrouter_api_key: string | null;
  supabase_service_key?: string | null;
  supabase_table_name?: string | null;
  supabase_url?: string | null;
  campaign_webhook_url?: string | null;
  knowledge_base_webhook_url?: string | null;
  prompt_webhook_url?: string | null;
  analytics_webhook_url?: string | null;
  ai_chat_webhook_url?: string | null;
  chat_analytics_webhook_url?: string | null;
  simulation_webhook?: string | null;
  outbound_caller_webhook_1_url?: string | null;
  outbound_caller_webhook_2_url?: string | null;
  outbound_caller_webhook_3_url?: string | null;
  system_prompt?: string | null;
  retell_api_key?: string | null;
  retell_inbound_agent_id?: string | null;
  retell_outbound_agent_id?: string | null;
  retell_outbound_followup_agent_id?: string | null;
  retell_agent_id_4?: string | null;
  retell_phone_1?: string | null;
  retell_phone_1_country_code?: string | null;
  retell_phone_2?: string | null;
  retell_phone_2_country_code?: string | null;
  retell_phone_3?: string | null;
  retell_phone_3_country_code?: string | null;
  transfer_to_human_webhook_url?: string | null;
  save_reply_webhook_url?: string | null;
  user_details_webhook_url?: string | null;
  database_reactivation_inbound_webhook_url?: string | null;
  lead_score_webhook_url?: string | null;
  update_pipeline_webhook_url?: string | null;
}
const ApiManagement = () => {
  const {
    clientId
  } = useParams<{
    clientId: string;
  }>();
  const {
    user
  } = useAuth();
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingGHL, setSavingGHL] = useState(false);
  const [savingOpenRouter, setSavingOpenRouter] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [ghlEditMode, setGhlEditMode] = useState(false);
  const [modifyingParams, setModifyingParams] = useState(false);
  const [openRouterEditMode, setOpenRouterEditMode] = useState(false);
  const [systemPromptEditMode, setSystemPromptEditMode] = useState(false);
  const [clientName, setClientName] = useState('');
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [ghlTestWebhookUrl, setGhlTestWebhookUrl] = useState('');
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [setupGuideCompletedSteps, setSetupGuideCompletedSteps] = useState<string[]>([]);
  const [dialogInitialPhase, setDialogInitialPhase] = useState(0);
  const [dialogInitialStep, setDialogInitialStep] = useState(0);
  const [dialogNavigationKey, setDialogNavigationKey] = useState(0);
  const [settings, setSettings] = useState<ApiSettings>({
    ghl_api_key: '',
    ghl_assignee_id: '',
    ghl_calendar_id: '',
    ghl_location_id: '',
    api_webhook_url: '',
    openai_api_key: '',
    openrouter_api_key: '',
    supabase_service_key: '',
    supabase_table_name: '',
    supabase_url: '',
    campaign_webhook_url: '',
    knowledge_base_webhook_url: '',
    prompt_webhook_url: '',
    analytics_webhook_url: '',
    ai_chat_webhook_url: '',
    chat_analytics_webhook_url: '',
    simulation_webhook: '',
    outbound_caller_webhook_1_url: '',
    outbound_caller_webhook_2_url: '',
    outbound_caller_webhook_3_url: '',
    system_prompt: '',
    retell_api_key: '',
    retell_inbound_agent_id: '',
    retell_outbound_agent_id: '',
    retell_outbound_followup_agent_id: '',
    retell_agent_id_4: '',
    retell_phone_1: '',
    retell_phone_1_country_code: '+1',
    retell_phone_2: '',
    retell_phone_2_country_code: '+1',
    retell_phone_3: '',
    retell_phone_3_country_code: '+1',
    transfer_to_human_webhook_url: '',
    save_reply_webhook_url: '',
    user_details_webhook_url: '',
    database_reactivation_inbound_webhook_url: '',
    lead_score_webhook_url: '',
    update_pipeline_webhook_url: ''
  });

  // Track original values from database
  const [originalSettings, setOriginalSettings] = useState<ApiSettings>({
    ghl_api_key: '',
    ghl_assignee_id: '',
    ghl_calendar_id: '',
    ghl_location_id: '',
    api_webhook_url: '',
    openai_api_key: '',
    openrouter_api_key: '',
    supabase_service_key: '',
    supabase_table_name: '',
    supabase_url: '',
    campaign_webhook_url: '',
    knowledge_base_webhook_url: '',
    prompt_webhook_url: '',
    analytics_webhook_url: '',
    ai_chat_webhook_url: '',
    chat_analytics_webhook_url: '',
    simulation_webhook: '',
    outbound_caller_webhook_1_url: '',
    outbound_caller_webhook_2_url: '',
    outbound_caller_webhook_3_url: '',
    system_prompt: '',
    retell_api_key: '',
    retell_inbound_agent_id: '',
    retell_outbound_agent_id: '',
    retell_outbound_followup_agent_id: '',
    retell_agent_id_4: '',
    retell_phone_1: '',
    retell_phone_1_country_code: '+1',
    retell_phone_2: '',
    retell_phone_2_country_code: '+1',
    retell_phone_3: '',
    retell_phone_3_country_code: '+1',
    lead_score_webhook_url: '',
    update_pipeline_webhook_url: ''
  });
  const [systemDefaultsOpen, setSystemDefaultsOpen] = useState(false);
  const isDirty = useRef(false);
  useEffect(() => {
    if (clientId) {
      fetchApiSettings();
    }
  }, [clientId, user]);

  // Clear any stale localStorage drafts on mount - data should always come from database
  useEffect(() => {
    if (!clientId) return;
    try {
      localStorage.removeItem(`apiSettingsDraft_${clientId}`);
    } catch {}
    isDirty.current = false;
  }, [clientId]);
  const fetchApiSettings = async () => {
    if (!clientId || !user) return;
    try {
      const {
        data,
        error
      } = await (supabase.from('clients').select('name, ghl_api_key, ghl_assignee_id, ghl_calendar_id, ghl_location_id, api_webhook_url, openai_api_key, openrouter_api_key, supabase_service_key, supabase_table_name, supabase_url, campaign_webhook_url, knowledge_base_webhook_url:knowledge_base_add_webhook_url, prompt_webhook_url, analytics_webhook_url, ai_chat_webhook_url, chat_analytics_webhook_url, simulation_webhook, outbound_caller_webhook_1_url, outbound_caller_webhook_2_url, outbound_caller_webhook_3_url, retell_api_key, retell_inbound_agent_id, retell_outbound_agent_id, retell_outbound_followup_agent_id, retell_agent_id_4, retell_phone_1, retell_phone_1_country_code, retell_phone_2, retell_phone_2_country_code, retell_phone_3, retell_phone_3_country_code, transfer_to_human_webhook_url, save_reply_webhook_url, user_details_webhook_url, database_reactivation_inbound_webhook_url, lead_score_webhook_url, update_pipeline_webhook_url, setup_guide_completed_steps' as any).eq('id', clientId).maybeSingle() as any);
      if (error) throw error;
      setClientName(data.name);

      // Load setup guide completed steps
      const completedSteps = data.setup_guide_completed_steps || [];
      setSetupGuideCompletedSteps(Array.isArray(completedSteps) ? completedSteps : []);
      const settingsData = {
        ghl_api_key: data.ghl_api_key || '',
        ghl_assignee_id: data.ghl_assignee_id || '',
        ghl_calendar_id: data.ghl_calendar_id || '',
        ghl_location_id: data.ghl_location_id || '',
        api_webhook_url: data.api_webhook_url || '',
        openai_api_key: data.openai_api_key || '',
        openrouter_api_key: data.openrouter_api_key || '',
        supabase_service_key: data.supabase_service_key || '',
        supabase_table_name: data.supabase_table_name || '',
        supabase_url: data.supabase_url || '',
        campaign_webhook_url: data.campaign_webhook_url || '',
        knowledge_base_webhook_url: data.knowledge_base_webhook_url || '',
        prompt_webhook_url: data.prompt_webhook_url || '',
        analytics_webhook_url: data.analytics_webhook_url || '',
        ai_chat_webhook_url: data.ai_chat_webhook_url || '',
        chat_analytics_webhook_url: data.chat_analytics_webhook_url || '',
        simulation_webhook: data.simulation_webhook || '',
        outbound_caller_webhook_1_url: data.outbound_caller_webhook_1_url || '',
        outbound_caller_webhook_2_url: data.outbound_caller_webhook_2_url || '',
        outbound_caller_webhook_3_url: data.outbound_caller_webhook_3_url || '',
        system_prompt: data.system_prompt || '',
        retell_api_key: data.retell_api_key || '',
        retell_inbound_agent_id: data.retell_inbound_agent_id || '',
        retell_outbound_agent_id: data.retell_outbound_agent_id || '',
        retell_outbound_followup_agent_id: data.retell_outbound_followup_agent_id || '',
        retell_agent_id_4: data.retell_agent_id_4 || '',
        retell_phone_1: data.retell_phone_1 || '',
        retell_phone_1_country_code: data.retell_phone_1_country_code || '+1',
        retell_phone_2: data.retell_phone_2 || '',
        retell_phone_2_country_code: data.retell_phone_2_country_code || '+1',
        retell_phone_3: data.retell_phone_3 || '',
        retell_phone_3_country_code: data.retell_phone_3_country_code || '+1',
        transfer_to_human_webhook_url: data.transfer_to_human_webhook_url || '',
        save_reply_webhook_url: data.save_reply_webhook_url || '',
        user_details_webhook_url: data.user_details_webhook_url || '',
        database_reactivation_inbound_webhook_url: data.database_reactivation_inbound_webhook_url || '',
        lead_score_webhook_url: data.lead_score_webhook_url || '',
        update_pipeline_webhook_url: data.update_pipeline_webhook_url || ''
      };
      setSettings(settingsData);
      setOriginalSettings(settingsData);

      // Determine if we should be in edit mode or view mode
      const hasGHLData = settingsData.ghl_api_key && settingsData.ghl_assignee_id && settingsData.ghl_calendar_id && settingsData.ghl_location_id;
      const hasOpenRouterData = settingsData.openrouter_api_key;
      setGhlEditMode(!hasGHLData);
      setOpenRouterEditMode(!hasOpenRouterData);
      isDirty.current = false;
    } catch (error: any) {
      console.error('Error fetching API settings:', error);
      toast({
        title: "Error",
        description: "Failed to fetch API settings",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Validate webhook URL format
  const validateWebhookUrl = (url: string): {
    isValid: boolean;
    error?: string;
  } => {
    if (!url || !url.trim()) {
      return {
        isValid: false,
        error: 'Webhook URL is required'
      };
    }
    try {
      const urlObj = new URL(url);
      // Accept both HTTP and HTTPS (localhost support)
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        return {
          isValid: false,
          error: 'Webhook URL must use HTTP or HTTPS'
        };
      }
      return {
        isValid: true
      };
    } catch (error) {
      return {
        isValid: false,
        error: 'Invalid URL format'
      };
    }
  };

  // Phases that should always be accessible (for initial setup)
  const ALWAYS_ACCESSIBLE_PHASES = ['account-creation', 'supabase-setup'];

  // Check if webhook has changed and is valid
  const isWebhookChanged = (webhookField: keyof ApiSettings) => {
    return settings[webhookField] !== originalSettings[webhookField];
  };
  const isWebhookValid = (webhookField: keyof ApiSettings) => {
    const url = settings[webhookField];
    if (!url || !url.trim()) return false;
    return validateWebhookUrl(url as string).isValid;
  };
  const handleSaveWebhook = async (webhookField: keyof ApiSettings) => {
    if (!clientId) return;

    // Capture the URL BEFORE any async operations
    const webhookUrl = webhookField === 'knowledge_base_webhook_url' ? settings.knowledge_base_webhook_url as string : settings[webhookField] as string || '';

    // Validate webhook URL
    const validation = validateWebhookUrl(webhookUrl);
    if (!validation.isValid) {
      toast({
        title: "Invalid Webhook URL",
        description: validation.error || "Please provide a valid HTTPS webhook URL",
        variant: "destructive"
      });
      return;
    }
    setSavingGHL(true);
    try {
      const updateData: any = {};

      // Map knowledge_base_webhook_url to both add and delete webhook columns in the database
      if (webhookField === 'knowledge_base_webhook_url') {
        updateData.knowledge_base_add_webhook_url = settings.knowledge_base_webhook_url;
        updateData.knowledge_base_delete_webhook_url = settings.knowledge_base_webhook_url;
      } else {
        updateData[webhookField] = settings[webhookField];
      }
      const {
        error
      } = await supabase.from('clients').update(updateData).eq('id', clientId);
      if (error) throw error;

      // Clear local draft after successful save
      if (clientId) {
        try {
          localStorage.removeItem(`apiSettingsDraft_${clientId}`);
        } catch {}
      }
      isDirty.current = false;

      // Send test payload to webhook BEFORE refreshing (use captured URL)
      if (webhookUrl?.trim()) {
        await sendConfigSavedNotification(webhookUrl, String(webhookField));
      }

      // Refresh data to get updated status
      await fetchApiSettings();
      toast({
        title: "Success",
        description: "Webhook URL saved and test payload sent"
      });
    } catch (error: any) {
      console.error('Error saving webhook:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook URL",
        variant: "destructive"
      });
    } finally {
      setSavingGHL(false);
    }
  };
  const handleResetWebhook = async (webhookField: keyof ApiSettings) => {
    if (!clientId) return;
    setSavingOpenRouter(true);
    try {
      const updateData: any = {};

      // Map knowledge_base_webhook_url to both add and delete webhook columns for reset
      if (webhookField === 'knowledge_base_webhook_url') {
        updateData.knowledge_base_add_webhook_url = null;
        updateData.knowledge_base_delete_webhook_url = null;
      } else {
        updateData[webhookField] = null;
      }
      const {
        error
      } = await supabase.from('clients').update(updateData).eq('id', clientId);
      if (error) throw error;
      toast({
        title: "Reset",
        description: "Webhook URL has been cleared"
      });

      // Clear local draft
      if (clientId) {
        try {
          localStorage.removeItem(`apiSettingsDraft_${clientId}`);
        } catch {}
      }
      isDirty.current = false;

      // Refresh data
      await fetchApiSettings();
    } catch (error: any) {
      console.error('Error resetting webhook:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to reset webhook URL",
        variant: "destructive"
      });
    } finally {
      setSavingOpenRouter(false);
    }
  };

  // Check if required fields are filled
  const areRequiredFieldsFilled = () => {
    // Supabase required fields
    const hasSupabase = Boolean(settings.supabase_url?.trim() && settings.supabase_service_key?.trim());

    // LLM required fields (either OpenAI OR OpenRouter is sufficient)
    const hasLLM = Boolean(settings.openai_api_key?.trim() || settings.openrouter_api_key?.trim());
    return hasSupabase && hasLLM;
  };

  // Check which specific credentials are missing
  const getMissingCredentials = () => {
    const missing: string[] = [];
    if (!settings.supabase_url?.trim() || !settings.supabase_service_key?.trim()) {
      missing.push('Supabase');
    }
    if (!settings.openai_api_key?.trim() && !settings.openrouter_api_key?.trim()) {
      missing.push('LLM (OpenAI or OpenRouter)');
    }
    return missing;
  };

  // List of webhook fields that should receive test payloads
  const webhookFields = ['transfer_to_human_webhook_url', 'save_reply_webhook_url', 'user_details_webhook_url', 'update_pipeline_webhook_url', 'lead_score_webhook_url', 'database_reactivation_inbound_webhook_url', 'simulation_webhook', 'outbound_caller_webhook_1_url', 'outbound_caller_webhook_2_url', 'outbound_caller_webhook_3_url', 'campaign_webhook_url', 'knowledge_base_webhook_url', 'prompt_webhook_url', 'analytics_webhook_url', 'ai_chat_webhook_url', 'chat_analytics_webhook_url', 'api_webhook_url'];

  // Mapping from database field names to UI-friendly labels
  const fieldLabelMap: Record<string, string> = {
    // Retell Agent IDs
    retell_inbound_agent_id: 'Agent ID 1',
    retell_outbound_agent_id: 'Agent ID 2',
    retell_outbound_followup_agent_id: 'Agent ID 3',
    retell_agent_id_4: 'Agent ID 4',
    // Retell Phone Numbers
    retell_phone_1: 'Phone Number 1',
    retell_phone_2: 'Phone Number 2',
    retell_phone_3: 'Phone Number 3',
    // Retell API
    retell_api_key: 'Retell API Key',
    // GHL fields
    ghl_api_key: 'GHL API Key',
    ghl_assignee_id: 'Assignee ID',
    ghl_calendar_id: 'Calendar ID',
    ghl_location_id: 'Location ID',
    // LLM fields
    openai_api_key: 'OpenAI API Key',
    openrouter_api_key: 'OpenRouter API Key',
    // Supabase fields
    supabase_url: 'Supabase URL',
    supabase_service_key: 'Supabase Service Key',
    supabase_table_name: 'Supabase Table Name',
    // Webhook fields
    simulation_webhook: 'Simulation Webhook',
    transfer_to_human_webhook_url: 'Transfer to Human Webhook',
    save_reply_webhook_url: 'Save Reply Webhook',
    user_details_webhook_url: 'Update Lead Details Webhook',
    update_pipeline_webhook_url: 'Update Pipeline Webhook',
    lead_score_webhook_url: 'Lead Score Webhook',
    database_reactivation_inbound_webhook_url: 'Database Reactivation Webhook',
    outbound_caller_webhook_1_url: 'Outbound Caller Webhook 1',
    outbound_caller_webhook_2_url: 'Outbound Caller Webhook 2',
    outbound_caller_webhook_3_url: 'Outbound Caller Webhook 3',
    campaign_webhook_url: 'Campaign Webhook',
    knowledge_base_webhook_url: 'Knowledge Base Webhook',
    prompt_webhook_url: 'Prompt Webhook',
    analytics_webhook_url: 'Analytics Webhook',
    ai_chat_webhook_url: 'AI Chat Webhook',
    chat_analytics_webhook_url: 'Chat Analytics Webhook',
    api_webhook_url: 'API Webhook',
    system_prompt: 'System Prompt'
  };

  // Get friendly label for a field name
  const getFieldLabel = (fieldName: string): string => {
    return fieldLabelMap[fieldName] || fieldName.replace(/_/g, ' ');
  };

  // Save ALL fields when any save button is clicked
  const handleSaveField = async (fieldName: keyof ApiSettings) => {
    if (!clientId) return;

    // Capture URL before any async operations if it's a webhook field
    const isWebhookField = webhookFields.includes(fieldName);
    const webhookUrl = isWebhookField ? settings[fieldName] as string || '' : '';

    // Validate webhook URL if it's a webhook field and has a value
    if (isWebhookField && webhookUrl?.trim()) {
      const validation = validateWebhookUrl(webhookUrl);
      if (!validation.isValid) {
        toast({
          title: "Invalid Webhook URL",
          description: validation.error || "Please provide a valid HTTPS webhook URL",
          variant: "destructive"
        });
        return;
      }
    }
    setSavingField(fieldName);
    try {
      // Build update object with ALL fields
      const updateData: Record<string, string | null> = {
        // Retell fields
        retell_api_key: settings.retell_api_key || null,
        retell_inbound_agent_id: settings.retell_inbound_agent_id || null,
        retell_outbound_agent_id: settings.retell_outbound_agent_id || null,
        retell_outbound_followup_agent_id: settings.retell_outbound_followup_agent_id || null,
        retell_agent_id_4: settings.retell_agent_id_4 || null,
        retell_phone_1: settings.retell_phone_1 || null,
        retell_phone_2: settings.retell_phone_2 || null,
        retell_phone_3: settings.retell_phone_3 || null,
        // GHL fields
        ghl_api_key: settings.ghl_api_key || null,
        ghl_assignee_id: settings.ghl_assignee_id || null,
        ghl_calendar_id: settings.ghl_calendar_id || null,
        ghl_location_id: settings.ghl_location_id || null,
        // LLM fields
        openai_api_key: settings.openai_api_key || null,
        openrouter_api_key: settings.openrouter_api_key || null,
        // Supabase fields
        supabase_url: settings.supabase_url || null,
        supabase_service_key: settings.supabase_service_key || null,
        supabase_table_name: settings.supabase_table_name || null,
        // Webhook fields
        simulation_webhook: settings.simulation_webhook || null,
        transfer_to_human_webhook_url: settings.transfer_to_human_webhook_url || null,
        save_reply_webhook_url: settings.save_reply_webhook_url || null,
        user_details_webhook_url: settings.user_details_webhook_url || null,
        update_pipeline_webhook_url: settings.update_pipeline_webhook_url || null,
        lead_score_webhook_url: settings.lead_score_webhook_url || null,
        database_reactivation_inbound_webhook_url: settings.database_reactivation_inbound_webhook_url || null,
        outbound_caller_webhook_1_url: settings.outbound_caller_webhook_1_url || null,
        outbound_caller_webhook_2_url: settings.outbound_caller_webhook_2_url || null,
        outbound_caller_webhook_3_url: settings.outbound_caller_webhook_3_url || null,
        campaign_webhook_url: settings.campaign_webhook_url || null,
        prompt_webhook_url: settings.prompt_webhook_url || null,
        analytics_webhook_url: settings.analytics_webhook_url || null,
        ai_chat_webhook_url: settings.ai_chat_webhook_url || null,
        chat_analytics_webhook_url: settings.chat_analytics_webhook_url || null,
        api_webhook_url: settings.api_webhook_url || null,
        system_prompt: settings.system_prompt || null,
        // Knowledge base webhook maps to both add and delete
        knowledge_base_add_webhook_url: settings.knowledge_base_webhook_url || null,
        knowledge_base_delete_webhook_url: settings.knowledge_base_webhook_url || null
      };
      const {
        error
      } = await supabase.from('clients').update(updateData).eq('id', clientId);
      if (error) throw error;

      // Clear local draft
      try {
        localStorage.removeItem(`apiSettingsDraft_${clientId}`);
      } catch {}
      isDirty.current = false;

      // If it's a webhook field with value, send test payload to it
      if (isWebhookField && webhookUrl?.trim()) {
        await sendConfigSavedNotification(webhookUrl, fieldName);
      }

      // Refresh data
      await fetchApiSettings();



      const friendlyLabel = getFieldLabel(fieldName);
      toast({
        title: "Success",
        description: `All settings saved (triggered by ${friendlyLabel})`
      });
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive"
      });
    } finally {
      setSavingField(null);
    }
  };
  const handleSaveGHL = async () => {
    if (!clientId) return;

    // Validate required fields first
    if (!areRequiredFieldsFilled()) {
      toast({
        title: "Required Fields Missing",
        description: "Please fill in all required fields: Supabase Setup (URL, Service Key, Table Name) and LLM Setup (OpenAI API Key, OpenRouter API Key)",
        variant: "destructive"
      });
      return;
    }

    // Validate that all GHL fields are filled if any GHL field is provided
    const hasAnyGHLField = Boolean(settings.ghl_api_key?.trim() || settings.ghl_assignee_id?.trim() || settings.ghl_calendar_id?.trim() || settings.ghl_location_id?.trim());
    if (hasAnyGHLField && (!settings.ghl_api_key?.trim() || !settings.ghl_assignee_id?.trim() || !settings.ghl_calendar_id?.trim() || !settings.ghl_location_id?.trim())) {
      toast({
        title: "All GoHighLevel Fields Required",
        description: "If you're configuring GoHighLevel, please fill in all GHL fields (API Key, Assignee ID, Calendar ID, and Location ID) before saving.",
        variant: "destructive"
      });
      return;
    }

    // Validate webhook URLs if they are provided
    const webhookFields: Array<{
      field: keyof ApiSettings;
      label: string;
    }> = [{
      field: 'simulation_webhook',
      label: 'Simulation'
    }, {
      field: 'outbound_caller_webhook_1_url',
      label: 'Outbound Caller Webhook 1'
    }, {
      field: 'outbound_caller_webhook_2_url',
      label: 'Outbound Caller Webhook 2'
    }, {
      field: 'outbound_caller_webhook_3_url',
      label: 'Outbound Caller Webhook 3'
    }, {
      field: 'user_details_webhook_url',
      label: 'Update Lead Details'
    }, {
      field: 'transfer_to_human_webhook_url',
      label: 'Transfer Lead to Human'
    }, {
      field: 'database_reactivation_inbound_webhook_url',
      label: 'Database Reactivation'
    }, {
      field: 'campaign_webhook_url',
      label: 'Campaign'
    }, {
      field: 'knowledge_base_webhook_url',
      label: 'Knowledge Base'
    }, {
      field: 'lead_score_webhook_url',
      label: 'Update Lead Score'
    }, {
      field: 'update_pipeline_webhook_url',
      label: 'Update Lead Pipeline Stage'
    }];
    for (const {
      field,
      label
    } of webhookFields) {
      const url = settings[field] as string;
      if (url && url.trim()) {
        const validation = validateWebhookUrl(url);
        if (!validation.isValid) {
          toast({
            title: `Invalid ${label} webhook URL`,
            description: validation.error || "Must be HTTPS and not point to private/local networks",
            variant: "destructive"
          });
          return;
        }
      }
    }
    setSavingGHL(true);
    try {
      
      const {
        error
      } = await supabase.from('clients').update({
        ghl_api_key: settings.ghl_api_key?.trim() || null,
        ghl_assignee_id: settings.ghl_assignee_id?.trim() || null,
        ghl_calendar_id: settings.ghl_calendar_id?.trim() || null,
        ghl_location_id: settings.ghl_location_id?.trim() || null,
        api_webhook_url: null,
        openai_api_key: settings.openai_api_key?.trim() || null,
        openrouter_api_key: settings.openrouter_api_key?.trim() || null,
        supabase_url: settings.supabase_url?.trim() || null,
        supabase_service_key: settings.supabase_service_key?.trim() || null,
        supabase_table_name: settings.supabase_table_name?.trim() || null,
        campaign_webhook_url: settings.campaign_webhook_url?.trim() || null,
        knowledge_base_add_webhook_url: settings.knowledge_base_webhook_url?.trim() || null,
        knowledge_base_delete_webhook_url: settings.knowledge_base_webhook_url?.trim() || null,
        simulation_webhook: settings.simulation_webhook?.trim() || null,
        outbound_caller_webhook_1_url: settings.outbound_caller_webhook_1_url?.trim() || null,
        outbound_caller_webhook_2_url: settings.outbound_caller_webhook_2_url?.trim() || null,
        outbound_caller_webhook_3_url: settings.outbound_caller_webhook_3_url?.trim() || null,
        retell_api_key: settings.retell_api_key?.trim() || null,
        retell_inbound_agent_id: settings.retell_inbound_agent_id?.trim() || null,
        retell_outbound_agent_id: settings.retell_outbound_agent_id?.trim() || null,
        retell_phone_1: settings.retell_phone_1?.trim() || null,
        retell_phone_1_country_code: settings.retell_phone_1_country_code,
        retell_phone_2: settings.retell_phone_2?.trim() || null,
        retell_phone_2_country_code: settings.retell_phone_2_country_code,
        retell_phone_3: settings.retell_phone_3?.trim() || null,
        retell_phone_3_country_code: settings.retell_phone_3_country_code,
        transfer_to_human_webhook_url: settings.transfer_to_human_webhook_url?.trim() || null,
        save_reply_webhook_url: settings.save_reply_webhook_url?.trim() || null,
        user_details_webhook_url: settings.user_details_webhook_url?.trim() || null,
        database_reactivation_inbound_webhook_url: settings.database_reactivation_inbound_webhook_url?.trim() || null,
        lead_score_webhook_url: settings.lead_score_webhook_url?.trim() || null,
        update_pipeline_webhook_url: settings.update_pipeline_webhook_url?.trim() || null
      } as any).eq('id', clientId);
      if (error) throw error;

      // Send all webhook notifications in parallel for better performance
      const webhookPromises = [];




      if (settings.campaign_webhook_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.campaign_webhook_url, 'campaign_webhook_url'));
      }
      if (settings.knowledge_base_webhook_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.knowledge_base_webhook_url, 'knowledge_base_webhook_url'));
      }
      if (settings.outbound_caller_webhook_1_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.outbound_caller_webhook_1_url, 'outbound_caller_webhook_1_url'));
      }
      if (settings.outbound_caller_webhook_2_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.outbound_caller_webhook_2_url, 'outbound_caller_webhook_2_url'));
      }
      if (settings.outbound_caller_webhook_3_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.outbound_caller_webhook_3_url, 'outbound_caller_webhook_3_url'));
      }

      // Send test payloads to Transfer to Human webhook if configured
      if (settings.transfer_to_human_webhook_url?.trim()) {
        webhookPromises.push(sendTransferToHumanTestPayload(settings.transfer_to_human_webhook_url));
      }

      // Send test payloads to User Details webhook if configured
      if (settings.user_details_webhook_url?.trim()) {
        webhookPromises.push(sendUserDetailsTestPayload(settings.user_details_webhook_url));
      }

      // Send test payloads to Database Reactivation webhook if configured
      if (settings.database_reactivation_inbound_webhook_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.database_reactivation_inbound_webhook_url, 'database_reactivation_inbound_webhook_url'));
      }

      // Send test payloads to Lead Score webhook if configured
      if (settings.lead_score_webhook_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.lead_score_webhook_url, 'lead_score_webhook_url'));
      }

      // Send test payloads to Pipeline Update webhook if configured
      if (settings.update_pipeline_webhook_url?.trim()) {
        webhookPromises.push(sendConfigSavedNotification(settings.update_pipeline_webhook_url, 'update_pipeline_webhook_url'));
      }

      // Execute all webhook calls in parallel
      await Promise.allSettled(webhookPromises);
      toast({
        title: "Success",
        description: "GoHighLevel API settings saved and sent to webhook successfully"
      });

      // Clear local draft after successful save
      if (clientId) {
        try {
          localStorage.removeItem(`apiSettingsDraft_${clientId}`);
        } catch {}
      }
      isDirty.current = false;

      // Refresh data to get updated status
      await fetchApiSettings();
    } catch (error: any) {
      console.error('Error saving GHL settings:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save GoHighLevel API settings",
        variant: "destructive"
      });
    } finally {
      setSavingGHL(false);
    }
  };




  // Send test payload when webhook is saved to verify connectivity
  const sendConfigSavedNotification = async (url: string, field: string) => {
    if (!url) return;
    try {
      const testPayload = {
        type: 'webhook_test',
        field,
        client_id: clientId,
        client_name: clientName,
        timestamp: new Date().toISOString(),
        message: 'Test payload sent after saving webhook configuration',
        test_data: {
          user_id: 'test_user_123',
          user_name: 'Test User',
          user_email: 'test@example.com',
          user_phone: '+15555555555',
          sample_message: 'This is a test message to verify the webhook is receiving data correctly.'
        }
      };
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testPayload)
      });
      console.log(`Test payload sent to ${field} webhook`);
    } catch (err) {
      console.error('Error sending test payload to webhook:', err);
    }
  };
  const sendTransferToHumanTestPayload = async (webhookUrl: string) => {
    try {
      const testPayload = {
        type: 'transfer_to_human_test',
        timestamp: new Date().toISOString(),
        client_id: clientId,
        conversation_id: 'test_conversation_123',
        user_message: 'I need to speak with a human agent',
        context: {
          conversation_history: [{
            role: 'user',
            message: 'Hello'
          }, {
            role: 'assistant',
            message: 'Hi! How can I help you today?'
          }, {
            role: 'user',
            message: 'I need to speak with a human agent'
          }],
          user_info: {
            phone: '+1234567890',
            email: 'test@example.com'
          }
        }
      };
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testPayload)
      });
    } catch (error) {
      console.error('Error sending transfer to human test payload:', error);
    }
  };
  const sendUserDetailsTestPayload = async (webhookUrl: string) => {
    try {
      const testPayload = {
        type: 'user_details_request_test',
        timestamp: new Date().toISOString(),
        client_id: clientId,
        conversation_id: 'test_conversation_456',
        request_type: 'user_lookup',
        identifiers: {
          phone: '+1234567890',
          email: 'test@example.com',
          user_id: 'test_user_789'
        }
      };
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testPayload)
      });
    } catch (error) {
      console.error('Error sending user details test payload:', error);
    }
  };
  const handleSaveSystemPrompt = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      const {
        error
      } = await supabase.from('clients').update({
        system_prompt: settings.system_prompt
      }).eq('id', clientId);
      if (error) throw error;
      toast({
        title: "Success",
        description: "System prompt for AI generation saved successfully"
      });

      // Clear local draft after successful save
      if (clientId) {
        try {
          localStorage.removeItem(`apiSettingsDraft_${clientId}`);
        } catch {}
      }
      isDirty.current = false;
      setSystemPromptEditMode(false);
      await fetchApiSettings();
    } catch (error: any) {
      console.error('Error saving system prompt:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save system prompt",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };
  const handleInputChange = (field: keyof ApiSettings, value: string) => {
    setSettings(prev => {
      const next = {
        ...prev,
        [field]: value
      };
      isDirty.current = true;
      if (clientId) {
        try {
          localStorage.setItem(`apiSettingsDraft_${clientId}`, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };
  const handleTestGHLWebhook = async () => {
    if (!ghlTestWebhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a GoHighLevel webhook URL to test",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    const validation = validateWebhookUrl(ghlTestWebhookUrl);
    if (!validation.isValid) {
      toast({
        title: "Invalid URL",
        description: validation.error || "Please provide a valid HTTPS webhook URL",
        variant: "destructive"
      });
      return;
    }
    setTestingWebhook(true);
    try {
      const testPayload = {
        type: 'ghl_webhook_test',
        timestamp: new Date().toISOString(),
        test: true,
        message: 'This is a test webhook request from BFD-setter',
        client_id: clientId,
        sample_data: {
          contact: {
            name: 'John Doe',
            email: 'john.doe@example.com',
            phone: '+1234567890'
          },
          event: 'test_event',
          source: 'BFD-setter API Management'
        }
      };
      const response = await fetch(ghlTestWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testPayload)
      });
      if (response.ok) {
        toast({
          title: "Test Successful",
          description: "Test data sent to your GoHighLevel webhook. Check your GoHighLevel workflow to verify receipt."
        });
      } else {
        toast({
          title: "Test Failed",
          description: `Webhook returned status ${response.status}. Please check your GoHighLevel webhook configuration.`,
          variant: "destructive"
        });
      }
    } catch (error: any) {
      console.error('Error testing GHL webhook:', error);
      toast({
        title: "Test Failed",
        description: error.message || "Failed to send test request to webhook",
        variant: "destructive"
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  // Calculate phase completion status
  const getPhaseStatus = (phase: typeof API_PHASES[0]) => {
    const stepCount = SETUP_PHASES[phase.id];
    let completed = 0;
    for (let i = 0; i < stepCount; i++) {
      if (setupGuideCompletedSteps.includes(`${phase.id}-${i}`)) {
        completed++;
      }
    }
    return {
      completed,
      total: stepCount,
      percentage: Math.round(completed / stepCount * 100),
      isComplete: completed >= stepCount
    };
  };

  // Calculate overall progress
  const getOverallProgress = () => {
    let totalSteps = 0;
    let completedSteps = 0;
    API_PHASES.forEach(phase => {
      const status = getPhaseStatus(phase);
      totalSteps += status.total;
      completedSteps += status.completed;
    });
    return {
      completed: completedSteps,
      total: totalSteps,
      percentage: totalSteps > 0 ? Math.round(completedSteps / totalSteps * 100) : 0
    };
  };

  // COPIED EXACTLY FROM WebinarSetup.tsx
  const handlePhaseClick = (phase: typeof API_PHASES[0]) => {
    setDialogInitialPhase(phase.dialogPhase);
    setDialogInitialStep(phase.dialogStep);
    setDialogNavigationKey(prev => prev + 1);
    setSetupGuideOpen(true);
  };
  if (loading) {
    return <RetroLoader />;
  }
  const overallProgress = getOverallProgress();
  return <div className="h-full overflow-hidden bg-background flex flex-col">
      <div className="container mx-auto max-w-7xl flex flex-col h-full">

        {/* Overall Progress Card - Sticky */}
        <div className="flex-shrink-0">
          <Card className="material-surface mb-6">
            <CardHeader className="pb-3 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">AI Reps Setup Progress</CardTitle>
                  <CardDescription className="mt-1">
                    Complete all phases to enable AI text and voice reps
                  </CardDescription>
                </div>
                <div className="text-right">
                  <span className="text-[24px] font-bold text-primary">
                    {overallProgress.percentage}%
                  </span>
                   <p className="text-sm text-muted-foreground">
                    {overallProgress.completed}/{overallProgress.total} steps
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Progress value={overallProgress.percentage} className="h-2" />
            </CardContent>
          </Card>

          {/* Alert for missing required credentials */}
          {!areRequiredFieldsFilled() && (
            <ConfigStatusBar
              configs={getMissingCredentials().map(name => ({
                name,
                isConfigured: false,
                description: `${name} credentials required`,
              }))}
            />
          )}
        </div>

        {/* Setup Phases Grid - Scrollable */}
        <div className="flex-1 min-h-0 overflow-auto pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {API_PHASES.map(phase => {
            const status = getPhaseStatus(phase);
            const Icon = phase.icon;
            const isAccessible = areRequiredFieldsFilled() || ALWAYS_ACCESSIBLE_PHASES.includes(phase.id);
            const isLocked = !isAccessible;
            
            return <Card 
              key={phase.id} 
              onClick={() => isAccessible && handlePhaseClick(phase)} 
              className={cn(
                "material-surface transition-all border-2",
                isLocked 
                  ? "cursor-not-allowed opacity-60 border-amber-500 bg-amber-50/30 dark:bg-amber-950/10" 
                  : "cursor-pointer hover:shadow-md",
                !isLocked && status.isComplete && "border-green-500 bg-green-50/30 dark:bg-green-950/10",
                !isLocked && status.completed > 0 && !status.isComplete && "border-amber-500 bg-amber-50/30 dark:bg-amber-950/10",
                !isLocked && status.completed === 0 && "border-red-500 bg-red-50/30 dark:bg-red-950/10"
              )}
            >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        isLocked 
                          ? "bg-amber-100 dark:bg-amber-900/30" 
                          : status.isComplete 
                            ? "bg-green-100 dark:bg-green-900/30" 
                            : status.completed > 0 
                              ? "bg-amber-100 dark:bg-amber-900/30" 
                              : "bg-red-100 dark:bg-red-900/30"
                      )}>
                        {isLocked ? (
                          <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Icon className={cn("h-5 w-5", status.isComplete ? "text-green-600 dark:text-green-400" : status.completed > 0 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className={cn(
                            "text-sm font-bold uppercase tracking-wide",
                            isLocked ? "text-muted-foreground" : "text-foreground"
                          )}>{phase.title}</h3>
                          <ChevronRight className={cn(
                            "h-4 w-4 flex-shrink-0", 
                            isLocked ? "text-amber-600 dark:text-amber-400" : status.isComplete ? "text-green-600" : status.completed > 0 ? "text-amber-600" : "text-red-600"
                          )} />
                        </div>
                        <p className={cn(
                          "text-sm mt-1 line-clamp-2",
                          isLocked ? "text-muted-foreground/70" : "text-muted-foreground"
                        )}>
                          {isLocked ? "Complete Supabase & LLM setup first" : phase.description}
                        </p>
                        {!isLocked && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">
                                {status.completed}/{status.total} steps
                              </span>
                              <span className={cn("text-sm font-medium", status.isComplete ? "text-green-600" : status.completed > 0 ? "text-amber-600" : "text-red-600")}>
                                {status.percentage}%
                              </span>
                            </div>
                            <Progress value={status.percentage} className={cn("h-1.5", status.isComplete && "[&>div]:bg-green-500", status.completed > 0 && !status.isComplete && "[&>div]:bg-amber-500", status.completed === 0 && "[&>div]:bg-red-500")} />
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>;
          })}
          </div>
        </div>

      </div>
      
      {/* Setup Guide Dialog */}
      <SetupGuideDialog open={setupGuideOpen} onOpenChange={open => {
      setSetupGuideOpen(open);
      if (!open) {
        fetchApiSettings();
      }
    }} clientId={clientId || ''} initialPhase={dialogInitialPhase} initialStep={dialogInitialStep} navigationKey={dialogNavigationKey} />
    </div>;
};
export default ApiManagement;