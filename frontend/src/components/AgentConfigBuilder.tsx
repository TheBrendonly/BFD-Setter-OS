import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useGenerationGuard } from '@/hooks/useGenerationGuard';
import { DEFAULT_BOOKING_PROMPT, DEFAULT_VOICE_BOOKING_PROMPT } from '@/data/defaultBookingPrompt';
import RetroLoader from '@/components/RetroLoader';
import SavingOverlay from '@/components/SavingOverlay';
import { VoiceRetellSettings, ToolsEditor, DEFAULT_RETELL_VOICE_SETTINGS, type RetellVoiceSettings } from '@/components/VoiceRetellSettings';
import { DEFAULT_RETELL_GENERAL_TOOLS, formatJsonConfig } from '@/lib/retellVoiceAgentDefaults';
import { RetellPhoneNumberSelector } from '@/components/RetellPhoneNumberSelector';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, ChevronUp, Save, RotateCcw, Maximize2, MessageSquare, Eye, Sparkles, Check, Lock, Loader2, Trash2, Pencil } from '@/components/icons';
import { PromptAIChatPanel } from '@/components/PromptAIChatPanel';
import { ExpandableTextDialog } from '@/components/ExpandableTextDialog';
import { OpenRouterModelSelector } from '@/components/OpenRouterModelSelector';
import { RetellModelSelector } from '@/components/RetellModelSelector';
import { PromptVersionPanel } from '@/components/prompt-editor/PromptVersionPanel';
import { PromptDiffReview } from '@/components/prompt-editor/PromptDiffReview';
import { PromptLoadingOverlay } from '@/components/prompt-editor/PromptLoadingOverlay';
import { buildSectionDiffs, resolvePromptFromDiffs, type SectionDiff } from '@/components/prompt-editor/diffUtils';
import { usePromptVersions } from '@/hooks/usePromptVersions';
import { usePromptChatHistory } from '@/hooks/usePromptChatHistory';
import { cn } from '@/lib/utils';
// PersonalityConstructor removed — replaced by parameter system
import { AgentCoreVisualization, CORE_LAYERS, getLayerStatus, type CoreLayerId } from '@/components/AgentCoreVisualization';
import { SectionLayerHeader } from '@/components/SectionLayerHeader';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MiniPromptAIDialog } from '@/components/MiniPromptAIDialog';
import { SetterPromptAIDialog } from '@/components/SetterPromptAIDialog';
import { SetterSubsectionRenderer } from '@/components/SetterSubsectionRenderer';
import type { ParamState } from '@/components/SetterParameterField';
import {
  TONE_STYLE_SUBSECTIONS, STRATEGY_SUBSECTIONS, GUARDRAILS_SUBSECTIONS,
  IDENTITY_SUBSECTIONS, COMPANY_SUBSECTIONS, COMPANY_LEAD_CONTEXT_SUBSECTIONS, COMPANY_INFO_SUBSECTIONS,
  ALL_SUBSECTIONS, buildPromptFromParams, buildMiniPromptParts, getSelectPrompt,
  SUBSECTION_SEPARATOR,
  AI_PERSONALIZABLE_LAYERS,
  type SetterParam,
} from '@/data/setterConfigParameters';
import {
  VOICE_TONE_STYLE_SUBSECTIONS, VOICE_STRATEGY_SUBSECTIONS, VOICE_GUARDRAILS_SUBSECTIONS,
  VOICE_IDENTITY_SUBSECTIONS, VOICE_COMPANY_SUBSECTIONS, VOICE_COMPANY_LEAD_CONTEXT_SUBSECTIONS, VOICE_COMPANY_INFO_SUBSECTIONS,
  VOICE_ALL_SUBSECTIONS, VOICE_AI_PERSONALIZABLE_LAYERS,
} from '@/data/voiceSetterConfigParameters';
import { segmentsToText, SEGMENT_JOIN, SUB_SEGMENT_JOIN, type PromptSegment, type PromptSubSegment, type SegmentTarget } from '@/lib/promptSegments';
import { buildDynamicVarsBlock } from '@/data/retellDynamicVarsBlock';
import { FullPromptXRay } from '@/components/FullPromptXRay';

// ── LLM Options ──
const LLM_OPTIONS = [
  { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
  { id: 'openai/gpt-5', name: 'GPT-5' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
];

const AI_UNLOCK_CONFIG_KEY = '__ai_config_unlocked';

// ── Default mini-prompts for each option ──

const CONFIG_SECTIONS: ConfigSection[] = [
  // ─── PERSONA CONFIGS ───
  {
    key: 'agent_name',
    label: 'What should be the name of your agent?',
    group: 'persona',
    type: 'text',
    description: 'You can use your own name, create a persona for your company, name it after a manager, or call it your AI representative.',
    options: [],
    defaultOption: '',
    defaultContent: `You are **{name}**. This is YOUR name. You MUST use it when introducing yourself. You ARE this person throughout the entire conversation. Never forget your name, never change it, never hesitate when someone asks who you are.

Speak as yourself: "I will", "I built", "my system", "I handle". You are a real person having a real conversation.`,
  },
  {
    key: 'agent_goal',
    label: 'Agent Goal',
    group: 'persona',
    type: 'multi-select',
    description: 'What should this agent accomplish? (Select one or more)',
    options: [
      {
        value: 'book_appointments',
        label: 'Book Appointments',
        description: 'Drive conversations toward scheduling calls or meetings',
        defaultContent: `## GOAL: BOOK APPOINTMENTS

Your primary objective is to guide the conversation toward booking an appointment or call.

**CRITICAL: DO NOT rush to book.** If the user is still asking questions, KEEP ANSWERING. Only steer toward booking when they seem satisfied and comfortable.

Qualify the prospect through natural conversation. Ask strategic questions to understand their needs, timeline, and situation. When the moment feels right, transition naturally:
"awesome, let's get you on a call to discuss this further"
"makes sense, why don't we hop on a quick call so I can show you exactly how this works for your situation?"

Handle scheduling objections calmly. Confirm booking details. If they can't book now, set a specific follow-up time. NEVER be pushy or desperate.`,
      },
      {
        value: 'nurture_leads',
        label: 'Nurture Leads',
        description: 'Build relationships and keep leads warm over time',
        defaultContent: `## GOAL: NURTURE LEADS

Your primary objective is to build trust and keep leads engaged over time.

**YOU MUST** focus on providing value in every single interaction. Share relevant insights, tips, and resources. Ask thoughtful questions about their challenges. Reference previous conversations when possible.

**NEVER** push for sales. Focus entirely on building the relationship. Share social proof and results naturally, not as a pitch. Check in periodically without being annoying. Educate them about solutions that could genuinely help their situation.

The goal is simple: when they ARE ready to buy, you are the first person they think of.`,
      },
      {
        value: 'engage_qualify',
        label: 'Engage & Qualify',
        description: 'Engage prospects and determine if they\'re a good fit',
        defaultContent: `## GOAL: ENGAGE & QUALIFY

Your primary objective is to engage prospects in conversation and figure out if they are a good fit.

**CRITICAL RULE: DO NOT present your solution until you understand their CORE problem.** If they give surface-level answers, DIG DEEPER. Ask:
"but what IS the actual problem?"
"where are you struggling the MOST right now?"
"what have you tried already?"
"what's stopping you?"

Start with open-ended questions about their current situation. Understand their business, challenges, timeline, and decision-making process. If qualified, transition toward next steps naturally. If not qualified, be honest and helpful.

**YOUR FIRST PRIORITY: HELP THEM.** If they ask you something, ANSWER IT FIRST. Then continue discovering their core problem.`,
      },
      {
        value: 'provide_support',
        label: 'Provide Support',
        description: 'Answer questions and help users solve problems',
        defaultContent: `## GOAL: PROVIDE SUPPORT

Your primary objective is to help users with their questions and problems.

**ANSWER FIRST, ALWAYS.** When someone asks a question, answer it immediately. Do not deflect, do not redirect, do not ask a counter-question before answering. Help them FIRST.

Listen carefully to understand the exact issue. Ask clarifying questions when the problem is not clear. Provide step-by-step solutions when possible. If you genuinely cannot solve the problem, say so directly and escalate.

**NEVER** give a wall of information nobody asked for. Answer what was asked, then check if they need more.`,
      },
      {
        value: 'custom_goal',
        label: 'Custom',
        description: 'Define your own custom goal for the agent',
        defaultContent: `## GOAL\n\n`,
      },
    ],
    defaultOption: '',
    defaultContent: '',
  },

  // ─── PROMPT CONFIGS ───
  {
    key: 'custom_prompt',
    label: 'Custom Instructions',
    group: 'prompt',
    type: 'custom_prompt',
    description: 'Add your own custom instructions about your business, services, target audience, and anything else the agent should know.',
    options: [],
    defaultOption: '',
    defaultContent: '',
  },
];
interface ConfigOption {
  value: string;
  label: string;
  description: string;
  defaultContent: string;
}

interface ConfigSection {
  key: string;
  label: string;
  group: 'persona' | 'technical' | 'prompt';
  type: 'select' | 'multi-select' | 'text' | 'custom_prompt' | 'personality';
  description: string;
  options: ConfigOption[];
  defaultOption: string;
  defaultContent: string;
}

interface LocalConfig {
  selectedOption: string;
  customContent: string;
  expanded: boolean;
}

interface AgentSettings {
  name: string;
  model: string;
  response_delay_seconds: number;
  file_processing_enabled: boolean;
  human_transfer_enabled: boolean;
  booking_function_enabled: boolean;
  booking_prompt: string;
  followup_1_delay_seconds: number;
  followup_2_delay_seconds: number;
  followup_3_delay_seconds: number;
  followup_instructions: string | null;
  followup_cancellation_instructions: string | null;
  followup_max_attempts: number;
}

type DelayUnit = 'seconds' | 'minutes' | 'hours' | 'days';

function secondsToUnit(totalSeconds: number): { value: number; unit: DelayUnit } {
  if (totalSeconds <= 0) return { value: 0, unit: 'seconds' };
  if (totalSeconds % 86400 === 0) return { value: totalSeconds / 86400, unit: 'days' };
  if (totalSeconds % 3600 === 0) return { value: totalSeconds / 3600, unit: 'hours' };
  if (totalSeconds % 60 === 0) return { value: totalSeconds / 60, unit: 'minutes' };
  return { value: totalSeconds, unit: 'seconds' };
}

function unitToSeconds(value: number, unit: DelayUnit): number {
  switch (unit) {
    case 'days': return value * 86400;
    case 'hours': return value * 3600;
    case 'minutes': return value * 60;
    default: return value;
  }
}

interface AgentConfigBuilderProps {
  configs: Record<string, { selected_option: string; custom_content: string } | null>;
  onConfigsChange: (configs: Record<string, { selectedOption: string; customContent: string }>) => void;
  onExplicitSave?: (configs: Record<string, { selectedOption: string; customContent: string }>) => void | Promise<void>;
  disabled?: boolean;
  agentSettings?: AgentSettings;
  onAgentSettingsChange?: (settings: Partial<AgentSettings>) => void;
  /** Called when model/delay changes locally to mark the save button as needed, without persisting */
  onMarkNeedsSync?: () => void;
  retellVoiceSettings?: RetellVoiceSettings;
  onRetellVoiceSettingsChange?: (updates: Partial<RetellVoiceSettings>) => void;
  isFollowup?: boolean;
  clientId?: string;
  slotId?: string;
  onMiniPromptSaving?: (isSaving: boolean) => void;
  highlightResponseDelay?: boolean;
  highlightFollowupDelay?: boolean;
  highlightFollowupInstructions?: boolean;
  highlightBookingFunction?: boolean;
  reloadTrigger?: number;
  mode?: 'text' | 'voice';
  onReturnToDefault?: () => void;
  /** Ref callback that exposes a getter for the current full prompt + persona at any time */
  getFullPromptRef?: React.MutableRefObject<(() => { persona: string; content: string }) | null>;
  /** Ref that exposes pending (unsaved) agent settings for model, response_delay, followup_delay */
  pendingAgentSettingsRef?: React.MutableRefObject<(() => Partial<AgentSettings>) | null>;
  /** Callback when AI config readiness changes (unlocked after generation or manual skip) */
  onConfigReadyChange?: (isReady: boolean) => void;
  /** Keeps the standard generation overlay active when a job starts outside this component */
  externalGeneratingConfig?: boolean;
  /** Clears the external generation latch once the persisted job flow takes over */
  onExternalGenerationHandled?: () => void;
  /** Triggers the full save flow (same as the header SAVE SETTER button) */
  onFullSave?: () => void | Promise<void>;
  /** Notifies parent when internal AI config generation starts/stops */
  onGeneratingChange?: (isGenerating: boolean) => void;
  /** Notifies parent when all configuration layers are complete (green) */
  onAllLayersCompleteChange?: (allComplete: boolean) => void;
}

function normalizePromptVersionContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

export { CONFIG_SECTIONS };
export type { ConfigSection, ConfigOption };

export const AgentConfigBuilder: React.FC<AgentConfigBuilderProps> = ({
  configs,
  onConfigsChange,
  onExplicitSave,
  disabled = false,
  agentSettings,
  onAgentSettingsChange,
  onMarkNeedsSync,
  retellVoiceSettings,
  onRetellVoiceSettingsChange,
  isFollowup = false,
  clientId,
  slotId,
  onMiniPromptSaving,
  highlightResponseDelay = false,
  highlightFollowupDelay = false,
  highlightFollowupInstructions = false,
  highlightBookingFunction = false,
  reloadTrigger,
  mode = 'text',
  onReturnToDefault,
  getFullPromptRef,
  pendingAgentSettingsRef,
  onConfigReadyChange,
  externalGeneratingConfig = false,
  onExternalGenerationHandled,
  onFullSave,
  onGeneratingChange,
  onAllLayersCompleteChange,
}) => {
  // ── Resolved subsections based on mode ──
  const R_IDENTITY = mode === 'voice' ? VOICE_IDENTITY_SUBSECTIONS : IDENTITY_SUBSECTIONS;
  const R_COMPANY = mode === 'voice' ? VOICE_COMPANY_SUBSECTIONS : COMPANY_SUBSECTIONS;
  const R_COMPANY_INFO = mode === 'voice' ? VOICE_COMPANY_INFO_SUBSECTIONS : COMPANY_INFO_SUBSECTIONS;
  const R_COMPANY_LEAD_CONTEXT = mode === 'voice' ? VOICE_COMPANY_LEAD_CONTEXT_SUBSECTIONS : COMPANY_LEAD_CONTEXT_SUBSECTIONS;
  const R_TONE_STYLE = mode === 'voice' ? VOICE_TONE_STYLE_SUBSECTIONS : TONE_STYLE_SUBSECTIONS;
  const R_STRATEGY = mode === 'voice' ? VOICE_STRATEGY_SUBSECTIONS : STRATEGY_SUBSECTIONS;
  const R_GUARDRAILS = mode === 'voice' ? VOICE_GUARDRAILS_SUBSECTIONS : GUARDRAILS_SUBSECTIONS;
  const R_ALL = mode === 'voice' ? VOICE_ALL_SUBSECTIONS : ALL_SUBSECTIONS;
  const R_AI_LAYERS = mode === 'voice' ? VOICE_AI_PERSONALIZABLE_LAYERS : AI_PERSONALIZABLE_LAYERS;

  // Voice settings keys for SectionLayerHeader (replaces text setter's 8 keys)
  const VOICE_SETTINGS_KEYS = ['_setter_name', '_ai_model', '_voice_id', '_voice_volume', '_voice_language', '_voice_start_speaker', '_voice_begin_message', '_voice_ambient_sound', '_voice_phone_number', '_voice_booking'];
  const headerSubsectionOverrides = mode === 'voice' ? {
    identity: R_IDENTITY,
    company: R_COMPANY,
    tone_style: R_TONE_STYLE,
    strategy: R_STRATEGY,
    guardrails: R_GUARDRAILS,
  } : undefined;
  const headerSettingsKeysOverride = mode === 'voice' ? VOICE_SETTINGS_KEYS : undefined;
  const [localConfigs, setLocalConfigs] = useState<Record<string, LocalConfig>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [localSetterName, setLocalSetterName] = useState(agentSettings?.name || '');
  const [localModel, setLocalModel] = useState(agentSettings?.model || '');
  const [localResponseDelay, setLocalResponseDelay] = useState(agentSettings?.response_delay_seconds ?? 0);
  const [localResponseDelayUnit, setLocalResponseDelayUnit] = useState<DelayUnit>(() => secondsToUnit(agentSettings?.response_delay_seconds ?? 0).unit);
  const [localResponseDelayValue, setLocalResponseDelayValue] = useState(() => secondsToUnit(agentSettings?.response_delay_seconds ?? 0).value);
  const [localFollowupDelay, setLocalFollowupDelay] = useState(agentSettings?.followup_1_delay_seconds ?? 0);
  const [localFollowupDelayUnit, setLocalFollowupDelayUnit] = useState<DelayUnit>(() => secondsToUnit(agentSettings?.followup_1_delay_seconds ?? 0).unit);
  const [localFollowupDelayValue, setLocalFollowupDelayValue] = useState(() => secondsToUnit(agentSettings?.followup_1_delay_seconds ?? 0).value);
  // Per-follow-up delays (1, 2, 3)
  const [localFollowup1Delay, setLocalFollowup1Delay] = useState(agentSettings?.followup_1_delay_seconds ?? 0);
  const [localFollowup1DelayUnit, setLocalFollowup1DelayUnit] = useState<DelayUnit>(() => secondsToUnit(agentSettings?.followup_1_delay_seconds ?? 0).unit);
  const [localFollowup1DelayValue, setLocalFollowup1DelayValue] = useState(() => secondsToUnit(agentSettings?.followup_1_delay_seconds ?? 0).value);
  const [localFollowup2Delay, setLocalFollowup2Delay] = useState(agentSettings?.followup_2_delay_seconds ?? 0);
  const [localFollowup2DelayUnit, setLocalFollowup2DelayUnit] = useState<DelayUnit>(() => secondsToUnit(agentSettings?.followup_2_delay_seconds ?? 0).unit);
  const [localFollowup2DelayValue, setLocalFollowup2DelayValue] = useState(() => secondsToUnit(agentSettings?.followup_2_delay_seconds ?? 0).value);
  const [localFollowup3Delay, setLocalFollowup3Delay] = useState(agentSettings?.followup_3_delay_seconds ?? 0);
  const [localFollowup3DelayUnit, setLocalFollowup3DelayUnit] = useState<DelayUnit>(() => secondsToUnit(agentSettings?.followup_3_delay_seconds ?? 0).unit);
  const [localFollowup3DelayValue, setLocalFollowup3DelayValue] = useState(() => secondsToUnit(agentSettings?.followup_3_delay_seconds ?? 0).value);
  const [localFollowupInstructions, setLocalFollowupInstructions] = useState(agentSettings?.followup_instructions || '');
  const [followupExpandOpen, setFollowupExpandOpen] = useState(false);
  const [voiceAdvancedExpanded, setVoiceAdvancedExpanded] = useState(false);
  const [localFollowupMaxAttempts, setLocalFollowupMaxAttempts] = useState(agentSettings?.followup_max_attempts ?? 0);
  const DEFAULT_CANCELLATION_CONDITIONS = [
    'Conversation ended naturally',
    'Lead no longer wants to be contacted',
    'Lead gave a clear rejection',
    'Lead confirmed they are not interested',
  ];
  const [localCancellationChips, setLocalCancellationChips] = useState<string[]>(() => {
    const raw = agentSettings?.followup_cancellation_instructions;
    if (raw) return raw.includes(' ; ') ? raw.split(' ; ').filter(Boolean) : raw.split('\n').filter(Boolean);
    return [...DEFAULT_CANCELLATION_CONDITIONS];
  });
  const [cancellationInput, setCancellationInput] = useState('');
  const [editingCancellationIdx, setEditingCancellationIdx] = useState<number | null>(null);
  const [editingCancellationValue, setEditingCancellationValue] = useState('');
  useEffect(() => { setLocalSetterName(agentSettings?.name || ''); }, [agentSettings?.name]);
  useEffect(() => { setLocalModel(agentSettings?.model || ''); }, [agentSettings?.model]);
  useEffect(() => {
    const s = agentSettings?.response_delay_seconds ?? 0;
    setLocalResponseDelay(s);
    const p = secondsToUnit(s);
    setLocalResponseDelayValue(p.value);
    setLocalResponseDelayUnit(p.unit);
  }, [agentSettings?.response_delay_seconds]);
  useEffect(() => {
    const s = agentSettings?.followup_1_delay_seconds ?? 0;
    setLocalFollowupDelay(s);
    const p = secondsToUnit(s);
    setLocalFollowupDelayValue(p.value);
    setLocalFollowupDelayUnit(p.unit);
  }, [agentSettings?.followup_1_delay_seconds]);
  useEffect(() => {
    const s = agentSettings?.followup_1_delay_seconds ?? 0;
    setLocalFollowup1Delay(s);
    const p = secondsToUnit(s);
    setLocalFollowup1DelayValue(p.value);
    setLocalFollowup1DelayUnit(p.unit);
  }, [agentSettings?.followup_1_delay_seconds]);
  useEffect(() => {
    const s = agentSettings?.followup_2_delay_seconds ?? 0;
    setLocalFollowup2Delay(s);
    const p = secondsToUnit(s);
    setLocalFollowup2DelayValue(p.value);
    setLocalFollowup2DelayUnit(p.unit);
  }, [agentSettings?.followup_2_delay_seconds]);
  useEffect(() => {
    const s = agentSettings?.followup_3_delay_seconds ?? 0;
    setLocalFollowup3Delay(s);
    const p = secondsToUnit(s);
    setLocalFollowup3DelayValue(p.value);
    setLocalFollowup3DelayUnit(p.unit);
  }, [agentSettings?.followup_3_delay_seconds]);
  useEffect(() => { setLocalFollowupInstructions(agentSettings?.followup_instructions || ''); }, [agentSettings?.followup_instructions]);
  useEffect(() => { setLocalFollowupMaxAttempts(agentSettings?.followup_max_attempts ?? 0); }, [agentSettings?.followup_max_attempts]);
  useEffect(() => {
    const raw = agentSettings?.followup_cancellation_instructions;
    if (raw) setLocalCancellationChips(raw.includes(' ; ') ? raw.split(' ; ').filter(Boolean) : raw.split('\n').filter(Boolean));
  }, [agentSettings?.followup_cancellation_instructions]);
  const isSetterNameDirty = localSetterName !== (agentSettings?.name || '');
  const isModelDirty = localModel !== (agentSettings?.model || '');
  const isResponseDelayDirty = localResponseDelay !== (agentSettings?.response_delay_seconds ?? 0);
  const isFollowupDelayDirty = localFollowupDelay !== (agentSettings?.followup_1_delay_seconds ?? 0);
  const isFollowup1DelayDirty = localFollowup1Delay !== (agentSettings?.followup_1_delay_seconds ?? 0);
  const isFollowup2DelayDirty = localFollowup2Delay !== (agentSettings?.followup_2_delay_seconds ?? 0);
  const isFollowup3DelayDirty = localFollowup3Delay !== (agentSettings?.followup_3_delay_seconds ?? 0);
  const isFollowupInstructionsDirty = localFollowupInstructions !== (agentSettings?.followup_instructions || '');
  const isCancellationDirty = localCancellationChips.join(' ; ') !== (agentSettings?.followup_cancellation_instructions || DEFAULT_CANCELLATION_CONDITIONS.join(' ; '));
  const isFollowupMaxAttemptsDirty = localFollowupMaxAttempts !== (agentSettings?.followup_max_attempts ?? 0);

  // Expose pending (deferred) agent settings via ref for parent to read during save
  useEffect(() => {
    if (pendingAgentSettingsRef) {
      pendingAgentSettingsRef.current = () => {
        const pending: Partial<AgentSettings> = {};
        if (isSetterNameDirty) pending.name = localSetterName;
        if (isModelDirty) pending.model = localModel;
        if (isResponseDelayDirty) pending.response_delay_seconds = localResponseDelay;
        if (isFollowupDelayDirty) pending.followup_1_delay_seconds = localFollowupDelay;
        if (isFollowup1DelayDirty) pending.followup_1_delay_seconds = localFollowup1Delay;
        if (isFollowup2DelayDirty) pending.followup_2_delay_seconds = localFollowup2Delay;
        if (isFollowup3DelayDirty) pending.followup_3_delay_seconds = localFollowup3Delay;
        if (isFollowupInstructionsDirty) pending.followup_instructions = localFollowupInstructions || null;
        if (isCancellationDirty) pending.followup_cancellation_instructions = localCancellationChips.join(' ; ') || null;
        if (isFollowupMaxAttemptsDirty) {
          pending.followup_max_attempts = localFollowupMaxAttempts;
          // Null out unused follow-up delays
          if (localFollowupMaxAttempts < 1) pending.followup_1_delay_seconds = 0;
          if (localFollowupMaxAttempts < 2) pending.followup_2_delay_seconds = 0;
          if (localFollowupMaxAttempts < 3) pending.followup_3_delay_seconds = 0;
        }
        return pending;
      };
    }
  });
  const [conversationExamples, setConversationExamples] = useState('');
  const [isGeneratingExamples, setIsGeneratingExamples] = useState(false);
  const [expandedPromptKey, setExpandedPromptKey] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<CoreLayerId | null>('settings');
  const [activeSubsection, setActiveSubsection] = useState<string | null>(null);
  const [showFullPromptDialog, setShowFullPromptDialog] = useState(false);
  // Client timezone for the read-only DYNAMIC VARIABLES x-ray segment (voice only) —
  // same source + default as retell-proxy (clients.timezone, Australia/Sydney).
  const [clientTimezone, setClientTimezone] = useState('Australia/Sydney');
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [showConversationExamplesDialog, setShowConversationExamplesDialog] = useState(false);
  // showAIChat removed — AI chat is always visible in 3-column layout
  // Version system for AI prompt editing (DB-backed)
  const { versions: dbVersions, saveVersion, loadVersions } = usePromptVersions(clientId, slotId);
  const { messages: chatMessages, addMessage: addChatMessage } = usePromptChatHistory(clientId, slotId);
  const { toast } = useToast();
  // activeView = version number being viewed, null = not set yet
  const [activeView, setActiveView] = useState<number | null>(null);
  const [sectionDiffs, setSectionDiffs] = useState<SectionDiff[] | null>(null);
  const [isAIGenerating, setIsAIGenerating] = useState(false);
  useGenerationGuard(isAIGenerating);
  const [isFirstReview, setIsFirstReview] = useState(false); // true only during fresh AI review
  const [examplesApproved, setExamplesApproved] = useState(false);
  const [promptApproved, setPromptApproved] = useState(false);
  // Store the AI-generated prompt for the version being reviewed
  const [aiGeneratedPrompt, setAiGeneratedPrompt] = useState<string | null>(null);
  // Track if user has started manual editing (to create version on first keystroke)
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [manualEditVersionCreated, setManualEditVersionCreated] = useState(false);
  // Track the prompt snapshot when dialog opened (for close warning)
  const [dialogOpenPromptSnapshot, setDialogOpenPromptSnapshot] = useState('');
  // Track if we need close confirmation
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  // Mini-prompt AI dialog state
  const [miniPromptAIKey, setMiniPromptAIKey] = useState<string | null>(null);
  const [miniPromptAITitle, setMiniPromptAITitle] = useState('');
  const [pendingMiniPromptAI, setPendingMiniPromptAI] = useState<{ key: string; title: string } | null>(null);
  const [showSetterAIDialog, setShowSetterAIDialog] = useState(false);
  const [bookingPromptExpanded, setBookingPromptExpanded] = useState(false);
  const [localBookingPrompt, setLocalBookingPrompt] = useState(agentSettings?.booking_prompt || '');
  const [bookingPromptDirty, setBookingPromptDirty] = useState(false);

  // Sync local booking prompt when external value changes (e.g. after AI modification)
  useEffect(() => {
    const incoming = agentSettings?.booking_prompt || '';
    setLocalBookingPrompt(incoming);
    setBookingPromptDirty(false);
  }, [agentSettings?.booking_prompt]);

  // ── NEW: Parameter states for behavior layers (4-6) ──
  const [paramStates, setParamStates] = useState<Record<string, ParamState>>({});
  const [expandedSubsections, setExpandedSubsections] = useState<Set<string>>(new Set());
  const [dirtyParamKeys, setDirtyParamKeys] = useState<Set<string>>(new Set());
  const [savingParamKeys, setSavingParamKeys] = useState<Set<string>>(new Set());
  const isMiniSaving = savingParamKeys.size > 0;

  // Notify parent of mini-prompt saving state
  React.useEffect(() => {
    onMiniPromptSaving?.(isMiniSaving);
  }, [isMiniSaving, onMiniPromptSaving]);

  const paramStatesLoadedRef = useRef(false);
  const latestParamStatesRef = useRef<Record<string, ParamState>>({});
  const latestLocalConfigsRef = useRef<Record<string, LocalConfig>>({});
  const persistedParamStatesRef = useRef<Record<string, ParamState>>({});
  const [isFullyLoaded, setIsFullyLoaded] = useState(false);
  

  // ── AI Config Generation State ──
  const [aiConfigLocked, setAiConfigLocked] = useState(true); // locked until AI generates
  const [isGeneratingConfig, setIsGeneratingConfigInternal] = useState(false);
  const [isCopyingConfig, setIsCopyingConfig] = useState(false);
  const setIsGeneratingConfig = useCallback((val: boolean) => {
    setIsGeneratingConfigInternal(val);
    if (!val) setIsCopyingConfig(false);
    onGeneratingChange?.(val);
  }, [onGeneratingChange]);
  const [checkingForActiveJob, setCheckingForActiveJob] = useState(true); // true until mount check completes
  const [showGenerateExitWarning, setShowGenerateExitWarning] = useState(false);
  const [aiConfigGenerated, setAiConfigGenerated] = useState(false);
  const [aiConfigNotes, setAiConfigNotes] = useState('');
  const [aiNotesExpanded, setAiNotesExpanded] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
  const aiConfigNotesLoadedRef = useRef(false);
  const generationPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const externalGeneratingConfigRef = useRef(externalGeneratingConfig);
  const externalGenerationHandledRef = useRef(false);
  const onExternalGenerationHandledRef = useRef(onExternalGenerationHandled);

  useEffect(() => {
    externalGeneratingConfigRef.current = externalGeneratingConfig;
    if (!externalGeneratingConfig) {
      externalGenerationHandledRef.current = false;
    }
  }, [externalGeneratingConfig]);

  useEffect(() => {
    onExternalGenerationHandledRef.current = onExternalGenerationHandled;
  }, [onExternalGenerationHandled]);

  const markExternalGenerationHandled = useCallback(() => {
    if (!externalGeneratingConfigRef.current || externalGenerationHandledRef.current) return;
    externalGenerationHandledRef.current = true;
    onExternalGenerationHandledRef.current?.();
  }, []);

  const persistAiUnlockState = useCallback(async () => {
    if (!clientId || !slotId) return;
    try {
      await (supabase as any)
        .from('prompt_configurations')
        .upsert({
          client_id: clientId,
          slot_id: slotId,
          config_key: AI_UNLOCK_CONFIG_KEY,
          selected_option: 'enabled',
          custom_content: 'true',
        }, { onConflict: 'client_id,slot_id,config_key' });
    } catch (err) {
      console.error('Error persisting AI unlock state:', err);
    }
  }, [clientId, slotId]);

  const unlockAiConfig = useCallback(() => {
    setAiConfigLocked(false);
    setAiConfigGenerated(true);
    void persistAiUnlockState();
  }, [persistAiUnlockState]);

  // Notify parent when config readiness changes
  useEffect(() => {
    onConfigReadyChange?.(!aiConfigLocked);
  }, [aiConfigLocked, onConfigReadyChange]);

  useEffect(() => {
    latestParamStatesRef.current = paramStates;
  }, [paramStates]);

  useEffect(() => {
    latestLocalConfigsRef.current = localConfigs;
  }, [localConfigs]);

  // Cleanup generation polling on unmount
  useEffect(() => {
    return () => {
      if (generationPollingRef.current) {
        clearInterval(generationPollingRef.current);
        generationPollingRef.current = null;
      }
    };
  }, []);

  // Reset loaded ref when slot changes (e.g. switching text ↔ voice)
  const prevSlotRef = useRef(slotId);
  useEffect(() => {
    if (slotId !== prevSlotRef.current) {
      prevSlotRef.current = slotId;
      paramStatesLoadedRef.current = false;
      setCheckingForActiveJob(true); // re-check for active job on slot change
    }
  }, [slotId]);

  // Load param states from localStorage on mount (fast hydration)
  useEffect(() => {
    if (!clientId || !slotId || paramStatesLoadedRef.current) return;
    const cacheKey = `param_states_${clientId}_${slotId}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        setParamStates(parsed);
        latestParamStatesRef.current = parsed;
      }
    } catch {}

    setLastGeneratedAt(null);
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('prompt_configurations')
          .select('config_key, selected_option, custom_content')
          .eq('client_id', clientId)
          .eq('slot_id', slotId);

        const rows = data || [];
        const rowMap = new Map<string, any>(rows.map((row: any) => [row.config_key, row]));

        if (rows.length > 0) {
          const loaded: Record<string, ParamState> = {};
          for (const row of rows) {
            if (!row.config_key.startsWith('param_')) continue;
            const paramKey = row.config_key.replace('param_', '');
            try {
              loaded[paramKey] = JSON.parse(row.custom_content || '{}');
            } catch {}
          }
          if (Object.keys(loaded).length > 0) {
            setParamStates(loaded);
            latestParamStatesRef.current = loaded;
            persistedParamStatesRef.current = loaded;
            try {
              localStorage.setItem(cacheKey, JSON.stringify(loaded));
            } catch {
              /* quota exceeded */
            }
          }

          const aiLayerParamKeys = new Set([
            ...R_TONE_STYLE.flatMap((s) => s.params.map((p) => p.key)),
            ...R_STRATEGY.flatMap((s) => s.params.map((p) => p.key)),
            ...R_GUARDRAILS.flatMap((s) => s.params.map((p) => p.key)),
          ]);
          const hasSavedAiLayerConfig = Object.keys(loaded).some((key) => aiLayerParamKeys.has(key));
          const hasPersistentAiUnlock = rowMap.get(AI_UNLOCK_CONFIG_KEY)?.selected_option === 'enabled'
            || rowMap.get(AI_UNLOCK_CONFIG_KEY)?.custom_content === 'true';

          if (hasSavedAiLayerConfig || hasPersistentAiUnlock) {
            setAiConfigLocked(false);
            setAiConfigGenerated(true);
          }
        }
        // Load last generated timestamp from ai_generation_jobs for this specific slot
        const { data: lastJob } = await (supabase as any)
          .from('ai_generation_jobs')
          .select('completed_at, input_payload')
          .eq('client_id', clientId)
          .eq('job_type', 'generate-setter-config')
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(20);
        if (lastJob) {
          const slotJob = lastJob.find((j: any) => (j.input_payload as any)?.slotId === slotId);
          if (slotJob?.completed_at) {
            setLastGeneratedAt(slotJob.completed_at);
          } else {
            setLastGeneratedAt(null);
          }
        }
      } catch (err) {
        console.error('Error loading param states:', err);
      }
      paramStatesLoadedRef.current = true;
      // Signal ready after a tick so localConfigs also have time to initialize
      requestAnimationFrame(() => setIsFullyLoaded(true));
    })();
  }, [clientId, slotId]);

  // Force-reload param states when reloadTrigger changes (e.g. after AI apply from parent)
  const reloadTriggerRef = useRef(reloadTrigger);
  useEffect(() => {
    if (reloadTrigger === undefined || reloadTrigger === reloadTriggerRef.current) return;
    reloadTriggerRef.current = reloadTrigger;
    if (!clientId || !slotId) return;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('prompt_configurations')
          .select('config_key, selected_option, custom_content')
          .eq('client_id', clientId)
          .eq('slot_id', slotId);

        const rows = data || [];
        const rowMap = new Map<string, any>(rows.map((row: any) => [row.config_key, row]));
        const loaded: Record<string, ParamState> = {};

        for (const row of rows) {
          if (!row.config_key.startsWith('param_')) continue;
          const paramKey = row.config_key.replace('param_', '');
          try {
            loaded[paramKey] = JSON.parse(row.custom_content || '{}');
          } catch {}
        }

        const reloadedLocalConfigs: Record<string, LocalConfig> = {};
        for (const section of CONFIG_SECTIONS) {
          const saved = rowMap.get(section.key);
          const selectedOption = saved?.selected_option ?? section.defaultOption;
          reloadedLocalConfigs[section.key] = {
            selectedOption,
            customContent: saved?.custom_content ?? getDefaultContent(section, selectedOption),
            expanded: latestLocalConfigsRef.current[section.key]?.expanded || false,
          };
        }

        const reloadedConversationExamples = rowMap.get('conversation_examples')?.custom_content || '';
        const reloadedExamplesApproved = rowMap.get('_deploy_examples')?.selected_option === 'approved';
        const reloadedPromptApproved = rowMap.get('_deploy_prompt')?.selected_option === 'approved';

        setLocalConfigs(reloadedLocalConfigs);
        latestLocalConfigsRef.current = reloadedLocalConfigs;
        setConversationExamples(reloadedConversationExamples);
        setExamplesApproved(reloadedExamplesApproved);
        setPromptApproved(reloadedPromptApproved);

        if (Object.keys(loaded).length > 0) {
          setParamStates(loaded);
          latestParamStatesRef.current = loaded;
          persistedParamStatesRef.current = loaded;
          const cacheKey = `param_states_${clientId}_${slotId}`;
          try { localStorage.setItem(cacheKey, JSON.stringify(loaded)); } catch { /* quota exceeded */ }

          // Mark all reloaded keys as dirty so SAVE SETTER PROMPT becomes active
          setDirtyKeys(prev => {
            const next = new Set(prev);
            Object.keys(loaded).forEach(k => next.add(k));
            return next;
          });
        }

        const aiLayerParamKeys = new Set([
          ...R_TONE_STYLE.flatMap((s) => s.params.map((p) => p.key)),
          ...R_STRATEGY.flatMap((s) => s.params.map((p) => p.key)),
          ...R_GUARDRAILS.flatMap((s) => s.params.map((p) => p.key)),
        ]);
        const hasSavedAiLayerConfig = Object.keys(loaded).some((key) => aiLayerParamKeys.has(key));
        const hasPersistentAiUnlock = rowMap.get(AI_UNLOCK_CONFIG_KEY)?.selected_option === 'enabled'
          || rowMap.get(AI_UNLOCK_CONFIG_KEY)?.custom_content === 'true';

        if (hasSavedAiLayerConfig || hasPersistentAiUnlock) {
          setAiConfigLocked(false);
          setAiConfigGenerated(true);
        }

        onConfigsChange(buildParentConfigOutput({
          paramStateMap: Object.keys(loaded).length > 0 ? loaded : latestParamStatesRef.current,
          configMap: reloadedLocalConfigs,
          conversationExamplesText: reloadedConversationExamples,
          deployExamplesSelected: reloadedExamplesApproved ? 'approved' : '',
          deployPromptSelected: reloadedPromptApproved ? 'approved' : '',
        }));
      } catch (err) {
        console.error('Error reloading param states after AI apply:', err);
      }
    })();
  }, [reloadTrigger, clientId, slotId, onConfigsChange]);


  useEffect(() => {
    if (!clientId || !slotId || aiConfigNotesLoadedRef.current) return;
    aiConfigNotesLoadedRef.current = true;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('prompt_configurations')
          .select('custom_content')
          .eq('client_id', clientId)
          .eq('slot_id', slotId)
          .eq('config_key', 'ai_config_notes')
          .maybeSingle();
        if (data?.custom_content) {
          setAiConfigNotes(data.custom_content);
        }
      } catch (err) {
        console.error('Error loading AI config notes:', err);
      }
    })();
  }, [clientId, slotId]);

  // Save AI config notes to DB (debounced)
  const aiNotesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAiConfigNotesToDb = useCallback((notes: string) => {
    if (!clientId || !slotId) return;
    if (aiNotesTimerRef.current) clearTimeout(aiNotesTimerRef.current);
    aiNotesTimerRef.current = setTimeout(async () => {
      try {
        await (supabase as any)
          .from('prompt_configurations')
          .upsert({
            client_id: clientId,
            slot_id: slotId,
            config_key: 'ai_config_notes',
            selected_option: '',
            custom_content: notes,
          }, { onConflict: 'client_id,slot_id,config_key' });
      } catch (err) {
        console.error('Error saving AI config notes:', err);
      }
    }, 1000);
  }, [clientId, slotId]);

  const handleAiConfigNotesChange = useCallback((value: string) => {
    setAiConfigNotes(value);
    saveAiConfigNotesToDb(value);
  }, [saveAiConfigNotesToDb]);

  const buildParamPersistenceOutput = useCallback((paramStateMap?: Record<string, ParamState>) => {
    const activeParamStates = paramStateMap ?? latestParamStatesRef.current;
    const output: Record<string, { selectedOption: string; customContent: string }> = {};

    for (const [paramKey, state] of Object.entries(activeParamStates)) {
      output[`param_${paramKey}`] = {
        selectedOption: state.enabled ? 'enabled' : 'disabled',
        customContent: JSON.stringify(state),
      };
    }

    return output;
  }, []);

  const allBehaviorParams = React.useMemo(
    () => [...R_IDENTITY, ...R_COMPANY, ...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS].flatMap((subsection) => subsection.params),
    [R_IDENTITY, R_COMPANY, R_TONE_STYLE, R_STRATEGY, R_GUARDRAILS]
  );

  const getParamDefinition = useCallback((paramKey: string): SetterParam | undefined => {
    return allBehaviorParams.find((param) => param.key === paramKey);
  }, [allBehaviorParams]);

  const getDefaultParamState = useCallback((paramKey: string): ParamState => {
    const paramDef = getParamDefinition(paramKey);
    return {
      enabled: paramDef?.defaultEnabled ?? false,
      value: paramDef?.defaultValue ?? '',
      customPrompt: undefined,
      optionPrompts: undefined,
    };
  }, [getParamDefinition]);

  const getDefaultPromptForState = useCallback((paramDef: SetterParam | undefined, state: ParamState): string => {
    if (!paramDef) return '';

    if (paramDef.type === 'select' && paramDef.options) {
      const selected = paramDef.options.find((option) => option.value === String(state.value));
      return selected?.defaultPrompt || '';
    }

    if (state.enabled && paramDef.promptWhenEnabled) {
      let prompt = paramDef.promptWhenEnabled;
      if (state.value !== undefined && state.value !== '') {
        prompt = prompt.replace(/\{value\}/g, String(state.value));
      }
      return prompt;
    }

    if (!state.enabled && paramDef.promptWhenDisabled) {
      return paramDef.promptWhenDisabled;
    }

    if (paramDef.promptWhenEnabled) {
      let prompt = paramDef.promptWhenEnabled;
      const fallbackValue = state.value ?? paramDef.defaultValue;
      if (fallbackValue !== undefined && fallbackValue !== '') {
        prompt = prompt.replace(/\{value\}/g, String(fallbackValue));
      }
      return prompt;
    }

    return '';
  }, []);

  const normalizeOptionPrompts = useCallback((paramDef: SetterParam | undefined, optionPrompts?: Record<string, string>) => {
    if (!paramDef || paramDef.type !== 'select' || !paramDef.options || !optionPrompts) {
      return undefined;
    }

    const entries = Object.entries(optionPrompts)
      .map(([optionValue, prompt]) => {
        const defaultPrompt = paramDef.options?.find((option) => option.value === optionValue)?.defaultPrompt || '';
        if (!prompt || prompt === defaultPrompt) return null;
        return [optionValue, prompt] as const;
      })
      .filter((entry): entry is readonly [string, string] => entry !== null)
      .sort(([left], [right]) => left.localeCompare(right));

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }, []);

  const getComparableParamState = useCallback((paramKey: string, state?: ParamState) => {
    const paramDef = getParamDefinition(paramKey);
    const fallbackState = getDefaultParamState(paramKey);
    const resolvedState = state ?? fallbackState;
    const customPrompt = resolvedState.customPrompt ?? '';
    const defaultPrompt = getDefaultPromptForState(paramDef, resolvedState);

    return {
      enabled: resolvedState.enabled ?? fallbackState.enabled,
      value: resolvedState.value ?? fallbackState.value ?? '',
      customPrompt: customPrompt && customPrompt !== defaultPrompt ? customPrompt : '',
      optionPrompts: normalizeOptionPrompts(paramDef, resolvedState.optionPrompts),
    };
  }, [getDefaultParamState, getDefaultPromptForState, getParamDefinition, normalizeOptionPrompts]);

  const areParamStatesEquivalent = useCallback((paramKey: string, left?: ParamState, right?: ParamState) => {
    const leftComparable = getComparableParamState(paramKey, left);
    const rightComparable = getComparableParamState(paramKey, right);
    return JSON.stringify(leftComparable) === JSON.stringify(rightComparable);
  }, [getComparableParamState]);

  const loadPersistedParamStateFromDb = useCallback(async (paramKey: string): Promise<ParamState | null> => {
    if (!clientId || !slotId) return null;
    try {
      const dbKey = `param_${paramKey}`;
      const { data, error } = await (supabase as any)
        .from('prompt_configurations')
        .select('custom_content')
        .eq('client_id', clientId)
        .eq('slot_id', slotId)
        .eq('config_key', dbKey)
        .maybeSingle();

      if (error) throw error;
      if (!data?.custom_content) return null;

      try {
        return JSON.parse(data.custom_content) as ParamState;
      } catch {
        return null;
      }
    } catch (err) {
      console.error('Error loading persisted param state:', err);
      return null;
    }
  }, [clientId, slotId]);

  const saveParamStateToDB = useCallback(async (paramKey: string, state: ParamState) => {
    if (!clientId || !slotId) return;
    try {
      const dbKey = `param_${paramKey}`;
      const payload = {
        client_id: clientId,
        slot_id: slotId,
        config_key: dbKey,
        selected_option: state.enabled ? 'enabled' : 'disabled',
        custom_content: JSON.stringify(state),
      };

      await (supabase as any)
        .from('prompt_configurations')
        .upsert(payload, { onConflict: 'client_id,slot_id,config_key' });
    } catch (err) {
      console.error('Error saving param state:', err);
    }
  }, [clientId, slotId]);

  const paramSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleParamChange = useCallback((paramKey: string, state: ParamState) => {
    let nextParamStates: Record<string, ParamState> | null = null;

    setParamStates((prev) => {
      const next = { ...prev, [paramKey]: state };
      nextParamStates = next;
      latestParamStatesRef.current = next;
      if (clientId && slotId) {
        const cacheKey = `param_states_${clientId}_${slotId}`;
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota exceeded — skip cache */ }
      }

      const baselineState = persistedParamStatesRef.current[paramKey] ?? getDefaultParamState(paramKey);
      const matchesBaseline = areParamStatesEquivalent(paramKey, state, baselineState);

      setDirtyParamKeys((dirtyKeys) => {
        const nextDirtyKeys = new Set(dirtyKeys);
        if (matchesBaseline) nextDirtyKeys.delete(paramKey);
        else nextDirtyKeys.add(paramKey);
        return nextDirtyKeys;
      });

      return next;
    });

    userHasInteractedRef.current = true;
    setPromptApproved(false);

    if (nextParamStates) {
      onConfigsChange(buildParentConfigOutput({
        paramStateMap: nextParamStates,
        deployPromptSelected: '',
      }));
    }

    if (paramSaveTimeoutRef.current) clearTimeout(paramSaveTimeoutRef.current);
    paramSaveTimeoutRef.current = setTimeout(() => {
      void saveParamStateToDB(paramKey, state);
    }, 800);
  }, [areParamStatesEquivalent, buildParentConfigOutput, clientId, getDefaultParamState, onConfigsChange, saveParamStateToDB, slotId]);

  const resolveParamPromptContent = useCallback((paramKey: string, paramStateMap?: Record<string, ParamState>): string => {
    const activeParamStates = paramStateMap ?? latestParamStatesRef.current;
    const allParams = [...R_IDENTITY, ...R_COMPANY, ...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS].flatMap((s) => s.params);
    const paramDef = allParams.find((p) => p.key === paramKey);
    const paramState = paramDef
      ? (activeParamStates[paramKey] || { enabled: paramDef.defaultEnabled || false, value: paramDef.defaultValue })
      : activeParamStates[paramKey];
    if (!paramDef) return paramState?.customPrompt || '';
    // For select params, always resolve the active option's prompt first so options stay isolated
    if (paramDef.type === 'select' && paramState?.optionPrompts && paramState.value) {
      const optPrompt = paramState.optionPrompts[String(paramState.value)];
      if (optPrompt) return optPrompt;
    }
    if (paramState?.customPrompt?.trim()) return paramState.customPrompt;
    if (paramDef.type === 'select' && paramDef.options) {
      const opt = paramDef.options.find((o) => o.value === String(paramState?.value)) || paramDef.options[0];
      return opt?.defaultPrompt || '';
    }
    if (paramDef.type === 'text' || paramDef.type === 'textarea') {
      let prompt = paramDef.promptWhenEnabled || '';
      if (paramState?.value !== undefined && String(paramState.value).trim() !== '') {
        prompt = prompt.replace(/\{value\}/g, String(paramState.value));
      }
      return prompt;
    }
    if (paramState?.enabled && paramDef.promptWhenEnabled) {
      let prompt = paramDef.promptWhenEnabled;
      if (paramState.value !== undefined && paramState.value !== '') {
        prompt = prompt.replace(/\{value\}/g, String(paramState.value));
      }
      return prompt;
    }
    if (!paramState?.enabled && paramDef.promptWhenDisabled) return paramDef.promptWhenDisabled;
    return paramDef.promptWhenEnabled || '';
  }, []);

  const saveParamVersionSnapshot = useCallback(async (paramKey: string, promptContent: string, previousPromptContent?: string) => {
    if (!clientId || !slotId) return false;

    // For select params, include the option value in the version slot_id for per-option versioning
    const allParamDefs = [...R_IDENTITY, ...R_COMPANY, ...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS].flatMap(s => s.params);
    const paramDefForVersion = allParamDefs.find(p => p.key === paramKey);
    const currentParamState = latestParamStatesRef.current[paramKey];
    const optionSuffix = (paramDefForVersion?.type === 'select' && currentParamState?.value)
      ? `__opt__${currentParamState.value}`
      : '';
    const scopedSlotId = `${slotId}__param__${paramKey}${optionSuffix}`;
    const normalizedPromptContent = normalizePromptVersionContent(promptContent);

    // For select params, resolve baseline from the option's own default prompt
    // to prevent cross-option contamination in version history
    let resolvedPreviousPromptContent = previousPromptContent || '';
    if (paramDefForVersion?.type === 'select' && currentParamState?.value && paramDefForVersion.options) {
      const currentOpt = paramDefForVersion.options.find(o => o.value === String(currentParamState.value));
      const optionDefaultPrompt = currentOpt?.defaultPrompt || '';
      // Use the option's own optionPrompts entry or default, not the shared previousPromptContent
      const optionSpecificPrompt = currentParamState.optionPrompts?.[String(currentParamState.value)];
      // Only use the passed previousPromptContent if it matches this option's content
      // Otherwise fall back to the option's default
      if (!previousPromptContent || previousPromptContent === optionDefaultPrompt || previousPromptContent === optionSpecificPrompt) {
        resolvedPreviousPromptContent = previousPromptContent || '';
      } else {
        // previousPromptContent is from a different option — use this option's default instead
        resolvedPreviousPromptContent = optionSpecificPrompt || optionDefaultPrompt;
      }
    }
    const normalizedPreviousPromptContent = normalizePromptVersionContent(resolvedPreviousPromptContent);
    if (!normalizedPromptContent) return false;

    try {
      const { data: latestVersions, error: latestVersionError } = await (supabase as any)
        .from('prompt_versions')
        .select('id, version_number, prompt_content, original_prompt_content')
        .eq('client_id', clientId)
        .eq('slot_id', scopedSlotId)
        .order('version_number', { ascending: false })
        .limit(1);

      if (latestVersionError) throw latestVersionError;

      const latestVersion = latestVersions?.[0];
      const lastSavedPrompt = normalizePromptVersionContent(latestVersion?.prompt_content || '');
      if (lastSavedPrompt === normalizedPromptContent) {
        const latestOriginalPrompt = normalizePromptVersionContent(latestVersion?.original_prompt_content || '');

        // Repair polluted histories where an AI dialog auto-created V1 from the unsaved draft.
        // In that case, restore V1 to the previous persisted prompt and add the current edit as V2.
        if (
          latestVersion &&
          latestVersion.version_number === 1 &&
          !latestOriginalPrompt &&
          normalizedPreviousPromptContent &&
          normalizedPreviousPromptContent !== normalizedPromptContent
        ) {
          const { error: repairBaselineError } = await (supabase as any)
            .from('prompt_versions')
            .update({
              prompt_content: normalizedPreviousPromptContent,
              original_prompt_content: null,
              label: 'V1',
            })
            .eq('id', latestVersion.id);

          if (repairBaselineError) throw repairBaselineError;

          const { error: repairedInsertError } = await (supabase as any)
            .from('prompt_versions')
            .insert({
              client_id: clientId,
              slot_id: scopedSlotId,
              version_number: 2,
              prompt_content: normalizedPromptContent,
              original_prompt_content: normalizedPreviousPromptContent,
              label: 'V2',
            });

          if (repairedInsertError) throw repairedInsertError;
          return true;
        }

        return false;
      }

      if (!latestVersion) {
        let nextVersionNumber = 1;

        if (normalizedPreviousPromptContent && normalizedPreviousPromptContent !== normalizedPromptContent) {
          const { error: baselineInsertError } = await (supabase as any)
            .from('prompt_versions')
            .insert({
              client_id: clientId,
              slot_id: scopedSlotId,
              version_number: 1,
              prompt_content: normalizedPreviousPromptContent,
              label: 'V1',
            });

          if (baselineInsertError) throw baselineInsertError;
          nextVersionNumber = 2;
        }

        const { error: firstInsertError } = await (supabase as any)
          .from('prompt_versions')
          .insert({
            client_id: clientId,
            slot_id: scopedSlotId,
            version_number: nextVersionNumber,
            prompt_content: normalizedPromptContent,
            original_prompt_content: nextVersionNumber > 1 ? normalizedPreviousPromptContent : null,
            label: `V${nextVersionNumber}`,
          });

        if (firstInsertError) throw firstInsertError;
        return true;
      }

      const nextVersionNumber = (latestVersion?.version_number || 0) + 1;
      const { error: insertError } = await (supabase as any)
        .from('prompt_versions')
        .insert({
          client_id: clientId,
          slot_id: scopedSlotId,
          version_number: nextVersionNumber,
          prompt_content: normalizedPromptContent,
          original_prompt_content: latestVersion.prompt_content,
          label: `V${nextVersionNumber}`,
        });

      if (insertError) throw insertError;
      return true;
    } catch (err) {
      console.error('Error saving param version on manual save:', err);
      return false;
    }
  }, [clientId, slotId]);

  const handleSaveParamPrompt = useCallback(async (paramKey: string) => {
    const currentParamStates = latestParamStatesRef.current;
    const state = currentParamStates[paramKey];
    if (!state) return;
    setSavingParamKeys((prev) => new Set(prev).add(paramKey));

    if (paramSaveTimeoutRef.current) {
      clearTimeout(paramSaveTimeoutRef.current);
      paramSaveTimeoutRef.current = null;
    }

    try {
      const persistedStateFromDb = await loadPersistedParamStateFromDb(paramKey);
      const previousPromptContent = resolveParamPromptContent(
        paramKey,
        persistedStateFromDb
          ? { ...persistedParamStatesRef.current, [paramKey]: persistedStateFromDb }
          : persistedParamStatesRef.current
      );
      const promptContent = resolveParamPromptContent(paramKey, currentParamStates);

      // Run independent DB writes in parallel to reduce save time
      await Promise.all([
        saveParamStateToDB(paramKey, state),
        saveParamVersionSnapshot(paramKey, promptContent, previousPromptContent),
      ]);

      persistedParamStatesRef.current = {
        ...persistedParamStatesRef.current,
        [paramKey]: state,
      };

      const output = buildParentConfigOutput({ paramStateMap: currentParamStates, deployPromptSelected: '' });
      onConfigsChange(output);
      // Fire explicit save without awaiting — it's a background persistence, not blocking
      void onExplicitSave?.(output);

      setDirtyParamKeys((prev) => {
        const next = new Set(prev);
        next.delete(paramKey);
        return next;
      });

      toast({ title: 'Prompt saved', description: 'Mini-prompt saved to the full setter prompt.' });
    } catch (err) {
      console.error('Error saving mini-prompt:', err);
      toast({ title: 'Error', description: 'Failed to save mini-prompt.', variant: 'destructive' });
    } finally {
      setSavingParamKeys((prev) => {
        const next = new Set(prev);
        next.delete(paramKey);
        return next;
      });
    }
  }, [loadPersistedParamStateFromDb, saveParamStateToDB, resolveParamPromptContent, saveParamVersionSnapshot, buildParentConfigOutput, onConfigsChange, onExplicitSave, toast]);

  // Return to Default: save current AI-modified prompt as a version, then reset
  const handleReturnToDefault = useCallback(async (paramKey: string) => {
    const state = paramStates[paramKey];
    if (!state) return;

    const allParamDefs = [...R_IDENTITY, ...R_COMPANY, ...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS].flatMap(s => s.params);
    const paramDef = allParamDefs.find(p => p.key === paramKey);

    // If there's a customPrompt (AI-modified), save it as a version before resetting
    if (state.customPrompt && clientId && slotId) {
      const optSuffix = (paramDef?.type === 'select' && state.value) ? `__opt__${state.value}` : '';
      const scopedSlotId = `${slotId}__param__${paramKey}${optSuffix}`;
      try {
        const { data: existingVersions } = await (supabase as any)
          .from('prompt_versions')
          .select('version_number')
          .eq('client_id', clientId)
          .eq('slot_id', scopedSlotId)
          .order('version_number', { ascending: false })
          .limit(1);

        const nextVersion = existingVersions && existingVersions.length > 0
          ? existingVersions[0].version_number + 1
          : 1;

        let defaultPrompt = '';
        if (paramDef) {
          if (paramDef.type === 'select' && paramDef.options) {
            const opt = paramDef.options.find(o => o.value === String(state.value)) || paramDef.options[0];
            defaultPrompt = opt?.defaultPrompt || '';
          } else if (paramDef.promptWhenEnabled) {
            defaultPrompt = paramDef.promptWhenEnabled;
            if (state.value !== undefined) {
              defaultPrompt = defaultPrompt.replace(/\{value\}/g, String(state.value));
            }
          }
        }

        await (supabase as any)
          .from('prompt_versions')
          .insert({
            client_id: clientId,
            slot_id: scopedSlotId,
            version_number: nextVersion,
            prompt_content: defaultPrompt,
            original_prompt_content: state.customPrompt,
            label: `V${nextVersion} – Reset to default`,
          });
      } catch (err) {
        console.error('Error saving version before reset:', err);
      }
    }

    const resetState = getDefaultParamState(paramKey);
    handleParamChange(paramKey, resetState);
    void saveParamStateToDB(paramKey, resetState);
    persistedParamStatesRef.current = {
      ...persistedParamStatesRef.current,
      [paramKey]: resetState,
    };
    toast({ title: 'Returned to default', description: 'Input unlocked. Previous AI version saved to history.' });
  }, [paramStates, clientId, slotId, getDefaultParamState, handleParamChange, saveParamStateToDB, toast]);

  const handleToggleSubsection = useCallback((key: string) => {
    setExpandedSubsections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const applyGeneratedResult = useCallback(async (result: any) => {
    console.log('[applyGeneratedResult] Mode:', mode, '| R_ALL subsections:', R_ALL.length, '| Params:', R_ALL.flatMap(s => s.params).length);
    console.log('[applyGeneratedResult] Applying result:', result);

    const personalizedPrompts = result?.personalizedPrompts;
    if (!personalizedPrompts || typeof personalizedPrompts !== 'object' || Array.isArray(personalizedPrompts)) {
      throw new Error('Invalid response from AI');
    }

    const allParamsFull = R_ALL.flatMap(s => s.params);
    console.log('[applyGeneratedResult] Available param keys:', allParamsFull.map(p => p.key));
    const paramDefs = allParamsFull.reduce<Record<string, (typeof allParamsFull)[number]>>((acc, param) => {
      acc[param.key] = param;
      return acc;
    }, {});

    const nextStates: Record<string, ParamState> = {
      ...latestParamStatesRef.current,
    };

    const optionPromptsMap: Record<string, Record<string, string>> = {};
    const simplePrompts: Record<string, string> = {};

    for (const [key, prompt] of Object.entries(personalizedPrompts as Record<string, unknown>)) {
      if (typeof prompt !== 'string' || !prompt.trim()) continue;

      if (key.includes('::')) {
        const [paramKey, optionValue] = key.split('::', 2);
        if (!paramKey || !optionValue) continue;
        if (!optionPromptsMap[paramKey]) optionPromptsMap[paramKey] = {};
        optionPromptsMap[paramKey][optionValue] = prompt.trim();
      } else {
        simplePrompts[key] = prompt.trim();
      }
    }

    const selections: Record<string, string> = (personalizedPrompts as any)._selections || {};
    console.log('[applyGeneratedResult] Option prompts:', Object.keys(optionPromptsMap).length, '| Simple prompts:', Object.keys(simplePrompts).length, '| Selections:', Object.keys(selections).length);

    for (const [paramKey, optPrompts] of Object.entries(optionPromptsMap)) {
      const paramDef = paramDefs[paramKey];
      const existingState = nextStates[paramKey] || {
        enabled: paramDef?.defaultEnabled || false,
        value: paramDef?.defaultValue,
      };

      const availableOptionValues = new Set(paramDef?.options?.map((option) => option.value) || []);

      let selectedValue = '';
      if (selections[paramKey] && availableOptionValues.has(selections[paramKey])) {
        selectedValue = selections[paramKey];
      } else if (availableOptionValues.has('enabled') && optPrompts.enabled) {
        selectedValue = 'enabled';
      } else {
        const firstWithPrompt = Object.keys(optPrompts).find(k => availableOptionValues.has(k));
        if (firstWithPrompt) selectedValue = firstWithPrompt;
      }

      nextStates[paramKey] = {
        ...existingState,
        enabled: availableOptionValues.has('enabled') ? selectedValue === 'enabled' : existingState.enabled || !!selectedValue,
        value: selectedValue,
        optionPrompts: {
          ...(existingState.optionPrompts || {}),
          ...optPrompts,
        },
        customPrompt: selectedValue && optPrompts[selectedValue]
          ? optPrompts[selectedValue]
          : existingState.customPrompt,
      };
    }

    for (const [paramKey, customPrompt] of Object.entries(simplePrompts)) {
      const paramDef = paramDefs[paramKey];
      const existingState = nextStates[paramKey] || { enabled: true };

      // For textarea/text params, the AI result is the VALUE (not a mini-prompt)
      if (paramDef && (paramDef.type === 'textarea' || paramDef.type === 'text')) {
        nextStates[paramKey] = {
          ...existingState,
          enabled: true,
          value: customPrompt,
        };
      } else {
        nextStates[paramKey] = {
          ...existingState,
          customPrompt,
        };
      }
    }

    for (const [paramKey, selectedVal] of Object.entries(selections)) {
      if (paramKey === 'agent_goal' || paramKey === '_selections') continue;
      const paramDef = paramDefs[paramKey];
      if (!paramDef) continue;

      const existingState = nextStates[paramKey] || {
        enabled: paramDef.defaultEnabled ?? false,
        value: paramDef.defaultValue,
      };

      if ((paramDef.type as string) === 'number') {
        const numVal = parseInt(selectedVal, 10);
        nextStates[paramKey] = {
          ...existingState,
          enabled: true,
          value: isNaN(numVal) ? existingState.value : numVal,
        };
      } else if (paramDef.type === 'toggle' || paramDef.type === 'toggle_text') {
        nextStates[paramKey] = {
          ...existingState,
          enabled: selectedVal === 'enabled',
          value: selectedVal,
          customPrompt: existingState.optionPrompts?.[selectedVal] || existingState.customPrompt,
        };
      } else if (paramDef.type === 'select' && paramDef.options) {
        const availableOpts = new Set(paramDef.options.map(o => o.value));
        if (availableOpts.has(selectedVal)) {
          const alreadyHandled = optionPromptsMap[paramKey] && nextStates[paramKey]?.value === selectedVal;
          if (!alreadyHandled) {
            nextStates[paramKey] = {
              ...existingState,
              enabled: true,
              value: selectedVal,
              customPrompt: existingState.optionPrompts?.[selectedVal]
                || paramDef.options.find(o => o.value === selectedVal)?.defaultPrompt
                || existingState.customPrompt,
            };
          }
        }
      } else {
        nextStates[paramKey] = {
          ...existingState,
          enabled: true,
        };
      }
    }

    const baseLocalConfigs = latestLocalConfigsRef.current;
    let nextLocalConfigs = baseLocalConfigs;

    if (selections['agent_goal'] || optionPromptsMap['agent_goal']) {
      const goalPrompts = optionPromptsMap['agent_goal'] || {};
      const selectedGoal = selections['agent_goal'] || '';
      const previousGoalConfig = baseLocalConfigs['agent_goal'] || { selectedOption: '', customContent: '', expanded: false };
      nextLocalConfigs = {
        ...baseLocalConfigs,
        agent_goal: {
          ...previousGoalConfig,
          selectedOption: selectedGoal,
          customContent: goalPrompts[selectedGoal] || previousGoalConfig.customContent || '',
          expanded: previousGoalConfig.expanded || false,
        },
      };
      latestLocalConfigsRef.current = nextLocalConfigs;
      setLocalConfigs(nextLocalConfigs);
    }

    latestParamStatesRef.current = nextStates;
    setParamStates(nextStates);
    userHasInteractedRef.current = true;
    setPromptApproved(false);

    const output = buildParentConfigOutput({
      paramStateMap: nextStates,
      configMap: nextLocalConfigs,
      deployPromptSelected: '',
    });
    const persistableOutput = {
      ...output,
      ...buildParamPersistenceOutput(nextStates),
    };
    onConfigsChange(output);
    await onExplicitSave?.(persistableOutput);
    console.log('[AI Config] Auto-saved all configs after generation completed');

    const allParamKeys = new Set([...Object.keys(optionPromptsMap), ...Object.keys(simplePrompts), ...Object.keys(selections).filter(k => k !== '_selections' && k !== 'agent_goal')]);
    await Promise.all(
      Array.from(allParamKeys).map((key) => {
        const state = nextStates[key];
        return state ? saveParamStateToDB(key, state) : Promise.resolve();
      })
    );

    persistedParamStatesRef.current = {
      ...persistedParamStatesRef.current,
      ...Object.fromEntries(
        Array.from(allParamKeys)
          .map((key) => [key, nextStates[key]] as const)
          .filter(([, state]) => !!state)
      ),
    };

    if (clientId && slotId) {
      const cacheKey = `param_states_${clientId}_${slotId}`;
      try { localStorage.setItem(cacheKey, JSON.stringify(nextStates)); } catch { /* quota exceeded */ }
    }

    // lastGeneratedAt is derived from ai_generation_jobs completed_at — the job row
    // was already updated by the backend, so just set local state from job completion time
    const now = new Date().toISOString();
    setLastGeneratedAt(now);

    unlockAiConfig();
    toast({ title: 'Configuration generated!', description: 'All mini-prompts have been personalized based on your company and ICP.' });
  }, [buildParamPersistenceOutput, buildParentConfigOutput, clientId, mode, R_ALL, onConfigsChange, onExplicitSave, saveParamStateToDB, slotId, toast, unlockAiConfig]);

  // ── AI Config Generation ──
  const handleGenerateConfig = useCallback(async () => {
    if (!clientId) {
      toast({ title: 'Error', description: 'Client ID is missing.', variant: 'destructive' });
      return;
    }

    const currentParamStates = latestParamStatesRef.current;
    const currentLocalConfigs = latestLocalConfigsRef.current;

    // Gather company info
    const companyName = currentParamStates['company_name']?.value as string || '';
    const companyKnowledge = currentParamStates['company_knowledge_base']?.value as string || '';
    const idealCustomerProfile = currentParamStates['ideal_customer_profile']?.value as string || '';
    const agentGoal = currentLocalConfigs['agent_goal']?.selectedOption || currentLocalConfigs['agent_goal']?.customContent || '';
    const agentMission = currentParamStates['agent_mission']?.value as string || '';
    const leadSource = currentParamStates['lead_source']?.value as string || '';
    const leadAwareness = currentParamStates['lead_awareness']?.value as string || '';
    const priorCommunications = currentParamStates['prior_communications']?.value as string || '';

    if (!companyKnowledge.trim() && !idealCustomerProfile.trim()) {
      toast({ title: 'Missing information', description: 'Please provide company knowledge and/or ideal customer profile before generating.', variant: 'destructive' });
      return;
    }

    // Clear conversation examples — they must be regenerated after config is set
    setConversationExamples('');
    setExamplesApproved(false);

    setIsGeneratingConfig(true);

    if (clientId && slotId) {
      if (aiNotesTimerRef.current) {
        clearTimeout(aiNotesTimerRef.current);
        aiNotesTimerRef.current = null;
      }

      try {
        await (supabase as any)
          .from('prompt_configurations')
          .upsert({
            client_id: clientId,
            slot_id: slotId,
            config_key: 'ai_config_notes',
            selected_option: '',
            custom_content: aiConfigNotes,
          }, { onConflict: 'client_id,slot_id,config_key' });
      } catch (notesErr) {
        console.error('Error flushing AI config notes before generation:', notesErr);
      }
    }

    // Auto-save all current configs before starting generation
    try {
      const output = buildParentConfigOutput({ deployPromptSelected: '' });
      onConfigsChange(output);
      await onExplicitSave?.(output);
      console.log('[AI Config] Auto-saved all configs before generation');
    } catch (saveErr) {
      console.error('Error auto-saving before generation:', saveErr);
      // Continue with generation even if save fails
    }


    const personalizableSubs = [...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS];
    const allParams = personalizableSubs.flatMap(s => s.params);
    const visibleParams = allParams.filter((param) => {
      if (!param.showWhenParent) return true;
      const parentState = currentParamStates[param.showWhenParent];
      if (!parentState) return false;
      const parentValue = parentState.value ?? (parentState.enabled ? 'enabled' : 'disabled');
      return String(parentValue) === param.showWhenParentValue;
    });
    
    // Build parameter list with current prompts — include visible conditional params too
    const parameters = visibleParams
      .map(p => {
        const state = currentParamStates[p.key];
        const selectedValue = state?.value as string || (p.options?.[0]?.value || 'enabled');
        const currentOpt = p.options?.find(o => o.value === selectedValue);
        
        // For select params with multiple options, send all options
        const options = (p.type === 'select' && p.options && p.options.length > 1)
          ? p.options.map(opt => ({
              value: opt.value,
              label: opt.label,
              defaultPrompt: opt.defaultPrompt || '',
            }))
          : undefined;

        return {
          key: p.key,
          label: p.label,
          selectedOption: currentOpt?.label || selectedValue,
          currentPrompt: currentOpt?.defaultPrompt || p.promptWhenEnabled || '',
          options,
        };
      });

    // Add agent_goal to parameters — it's a multi-select CONFIG_SECTION, not in subsections
    const agentGoalConfig = CONFIG_SECTIONS.find(s => s.key === 'agent_goal');
    if (agentGoalConfig && agentGoalConfig.options && agentGoalConfig.options.length > 0) {
      parameters.push({
        key: 'agent_goal',
        label: 'Agent Goal',
        selectedOption: agentGoal || '',
        currentPrompt: '',
        options: agentGoalConfig.options
          .filter(opt => opt.value !== 'custom_goal') // skip custom — user writes their own
          .map(opt => ({
            value: opt.value,
            label: opt.label,
            defaultPrompt: opt.defaultContent || '',
          })),
      });
    }

    try {
      // Call edge function which returns job_id, then subscribe for result
      const { data: jobData, error: jobError } = await supabase.functions.invoke('generate-setter-config', {
        body: {
          clientId,
          slotId,
          companyName,
          companyKnowledge,
          idealCustomerProfile,
          agentGoal,
          agentMission,
          leadSource,
          leadAwareness,
          priorCommunications,
          parameters,
          userNotes: aiConfigNotes,
        },
      });

      if (jobError) throw jobError;
      if (jobData?.error) throw new Error(jobData.error);

      const jobId = jobData?.job_id;
      if (!jobId) throw new Error('No job_id returned');

      const startTime = Date.now();
      const TIMEOUT = 720000; // 12 minutes
      // polling is stored in generationPollingRef
      let resolved = false;

      const clearPolling = () => {
        if (generationPollingRef.current) {
          clearInterval(generationPollingRef.current);
          generationPollingRef.current = null;
        }
      };

      const failPolling = (message: string, err?: unknown) => {
        if (resolved) return;
        resolved = true;
        clearPolling();
        if (err) {
          console.error('Generate config error:', err);
        }
        toast({ title: 'Generation failed', description: message, variant: 'destructive', duration: Infinity });
        setIsGeneratingConfig(false);
      };

      const poll = async () => {
        if (resolved) return;

        if (Date.now() - startTime > TIMEOUT) {
          failPolling('AI generation timed out after 12 minutes. Please try again.');
          return;
        }

        try {
          const { data: pollRow, error: pollError } = await (supabase as any)
            .from('ai_generation_jobs')
            .select('status, result, error_message')
            .eq('id', jobId)
            .maybeSingle();

          if (pollError) throw pollError;

          console.log('[Setter Config Poll]', jobId, pollRow?.status, pollRow?.result ? 'has result' : 'no result');

          if (pollRow?.status === 'completed') {
            resolved = true;
            clearPolling();
            await applyGeneratedResultRef.current(pollRow.result);
            setIsGeneratingConfig(false);
            return;
          }

          if (pollRow?.status === 'failed' || pollRow?.error_message) {
            failPolling(pollRow?.error_message || 'AI generation failed');
          }
        } catch (err) {
          failPolling(err instanceof Error ? err.message : 'Failed to read AI generation result.', err);
        }
      };

      generationPollingRef.current = setInterval(() => {
        void poll();
      }, 3000);
      void poll();
      return;
    } catch (err) {
      console.error('Generate config error:', err);
      toast({ title: 'Generation failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive', duration: Infinity });
    } finally {
      // Polling branch clears loading itself on success/failure.
    }
  }, [aiConfigNotes, applyGeneratedResult, buildParentConfigOutput, clientId, onConfigsChange, onExplicitSave, slotId, toast]);

  // Store latest applyGeneratedResult in a ref so the resume effect always uses the current version
  const applyGeneratedResultRef = useRef(applyGeneratedResult);
  useEffect(() => { applyGeneratedResultRef.current = applyGeneratedResult; }, [applyGeneratedResult]);

  // ── Resume polling for in-progress AI generation on mount ──
  // Phase 1: Fetch job data from DB immediately (runs in parallel with config loading)
  // Phase 2: Apply results only after isFullyLoaded
  const pendingJobDataRef = useRef<{ jobRow: any; recentCompleted: any } | null>(null);
  const jobFetchDoneRef = useRef(false);

  // Phase 1: Start fetching job status immediately when clientId/slotId are available
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setCheckingForActiveJob(true);
    jobFetchDoneRef.current = false;
    pendingJobDataRef.current = null;

    const matchesCurrentSlot = (job: any) => {
      if (!slotId) return true;
      return (job?.input_payload as any)?.slotId === slotId;
    };

    const fetchJobStatus = async () => {
      try {
        const [{ data: activeJobs }, { data: recentCompletedJobs }] = await Promise.all([
          (supabase as any)
            .from('ai_generation_jobs')
            .select('id, status, result, error_message, created_at, input_payload')
            .eq('client_id', clientId)
            .eq('job_type', 'generate-setter-config')
            .in('status', ['pending', 'running'])
            .order('created_at', { ascending: false })
            .limit(10),
          (supabase as any)
            .from('ai_generation_jobs')
            .select('id, status, result, error_message, created_at, completed_at, input_payload')
            .eq('client_id', clientId)
            .eq('job_type', 'generate-setter-config')
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .limit(10),
        ]);

        if (cancelled) return;

        const jobRow = (activeJobs || []).find(matchesCurrentSlot) || null;
        const recentCompleted = (recentCompletedJobs || []).find(matchesCurrentSlot) || null;

        pendingJobDataRef.current = { jobRow, recentCompleted };
        jobFetchDoneRef.current = true;
      } catch (err) {
        console.error('Error fetching job status:', err);
        if (!cancelled) {
          jobFetchDoneRef.current = true;
          markExternalGenerationHandled();
          setCheckingForActiveJob(false);
        }
      }
    };

    fetchJobStatus();
    return () => { cancelled = true; };
  }, [clientId, slotId, reloadTrigger]);

  // Phase 2: Once both job data AND config are loaded, process the result
  useEffect(() => {
    if (!clientId || !isFullyLoaded) return;
    let cancelled = false;

    const processJobData = async () => {
      // Wait for job fetch to complete (it started in parallel)
      let attempts = 0;
      while (!jobFetchDoneRef.current && attempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      if (cancelled || !jobFetchDoneRef.current) {
        markExternalGenerationHandled();
        setCheckingForActiveJob(false);
        return;
      }

      const data = pendingJobDataRef.current;
      if (!data) {
        markExternalGenerationHandled();
        setCheckingForActiveJob(false);
        return;
      }

      const { jobRow, recentCompleted } = data;

      // If no active job, check if a recently completed job needs to be applied
      if (!jobRow && recentCompleted?.result) {
        const completedAt = new Date(recentCompleted.completed_at).getTime();
        const isCopyJob = !!(recentCompleted.input_payload as any)?.sourceSlotId;
        const RECENT_THRESHOLD = isCopyJob ? 600000 : 120000; // 10 min for copy jobs, 2 min otherwise
        if (Date.now() - completedAt > RECENT_THRESHOLD) {
          markExternalGenerationHandled();
          setCheckingForActiveJob(false);
          return;
        }

        // For copy jobs, always apply the result (overwrite existing params).
        // For regular generate jobs, skip if params already exist (already applied).
        if (!isCopyJob) {
          const currentStates = latestParamStatesRef.current;
          const hasAnyGeneratedParams = Object.values(currentStates).some(
            (s) => s.optionPrompts && Object.keys(s.optionPrompts).length > 0
          );
          if (hasAnyGeneratedParams) {
            markExternalGenerationHandled();
            setCheckingForActiveJob(false);
            return;
          }
        }

        console.log('[Resume] Applying recently completed job:', recentCompleted.id);
        try {
          await applyGeneratedResultRef.current(recentCompleted.result);
          toast({ title: 'Configuration generated!', description: 'Your AI configuration completed while you were away and has been applied.' });
        } catch (err) {
          console.error('Error applying recently completed job:', err);
          toast({ title: 'Generation failed', description: err instanceof Error ? err.message : 'Failed to restore the completed configuration.', variant: 'destructive' });
        }
        markExternalGenerationHandled();
        setCheckingForActiveJob(false);
        return;
      }

      if (!jobRow) {
        markExternalGenerationHandled();
        setCheckingForActiveJob(false);
        return;
      }

      const createdAt = new Date(jobRow.created_at).getTime();
      const MAX_AGE = 720000; // 12 minutes
      if (Date.now() - createdAt > MAX_AGE) {
        markExternalGenerationHandled();
        setCheckingForActiveJob(false);
        return;
      }

      // Resume: show overlay and poll
      const isResumedCopyJob = !!(jobRow.input_payload as any)?.sourceSlotId;
      markExternalGenerationHandled();
      setCheckingForActiveJob(false);
      setIsCopyingConfig(isResumedCopyJob);
      setIsGeneratingConfig(true);
      let resolved = false;

      const clearPolling = () => {
        if (generationPollingRef.current) {
          clearInterval(generationPollingRef.current);
          generationPollingRef.current = null;
        }
      };

      const poll = async () => {
        if (resolved || cancelled) return;

        if (Date.now() - createdAt > MAX_AGE) {
          resolved = true;
          clearPolling();
          setIsGeneratingConfig(false);
          toast({ title: 'Generation timed out', description: 'The previous generation took too long. Please try again.', variant: 'destructive' });
          return;
        }

        try {
          const { data: pollRow } = await (supabase as any)
            .from('ai_generation_jobs')
            .select('status, result, error_message')
            .eq('id', jobRow.id)
            .maybeSingle();

          if (pollRow?.status === 'completed' && pollRow.result) {
            resolved = true;
            clearPolling();
            await applyGeneratedResultRef.current(pollRow.result);
            setIsGeneratingConfig(false);
            return;
          }

          if (pollRow?.status === 'failed' || pollRow?.error_message) {
            resolved = true;
            clearPolling();
            setIsGeneratingConfig(false);
            toast({ title: 'Generation failed', description: pollRow?.error_message || 'AI generation failed', variant: 'destructive' });
          }
        } catch (err) {
          console.error('Resume poll error:', err);
          resolved = true;
          clearPolling();
          setIsGeneratingConfig(false);
          toast({ title: 'Generation failed', description: err instanceof Error ? err.message : 'Failed to resume AI generation.', variant: 'destructive' });
        }
      };

      generationPollingRef.current = setInterval(() => { void poll(); }, 3000);
      void poll();
    };

    processJobData();

    return () => {
      cancelled = true;
      if (generationPollingRef.current) {
        clearInterval(generationPollingRef.current);
        generationPollingRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, slotId, isFullyLoaded, reloadTrigger]);


  const currentVersionNumber = dbVersions.length > 0 ? Math.max(...dbVersions.map(v => v.version_number)) : null;
  const isViewingCurrentVersion = activeView !== null && activeView === currentVersionNumber;

  // Reset all versions and create a fresh V1 from current mini-prompts
  const resetAndInitVersions = useCallback(async (freshPrompt: string) => {
    if (!clientId || !slotId) return;
    try {
      await (supabase as any)
        .from('prompt_versions')
        .delete()
        .eq('client_id', clientId)
        .eq('slot_id', slotId);
      await (supabase as any)
        .from('prompt_versions')
        .insert({
          client_id: clientId,
          slot_id: slotId,
          version_number: 1,
          prompt_content: freshPrompt,
          label: 'V1',
        });
      await loadVersions();
    } catch (err) {
      console.error('Error resetting versions:', err);
    }
  }, [clientId, slotId, loadVersions]);

  // Refs for infinite scroll
  const layerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const activeLayerRef = useRef<CoreLayerId | null>('identity');
  const activeSubsectionRef = useRef<string | null>(null);
  const isScrollingRef = useRef(false);
  const scrollLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollParentRef = useRef<HTMLElement | Window>(window);
  const setterCoreScrollRef = useRef<HTMLDivElement | null>(null);
  const setterCoreContentRef = useRef<HTMLDivElement | null>(null);
  const [setterCoreScrollbar, setSetterCoreScrollbar] = useState({
    isVisible: false,
    thumbHeight: 0,
    thumbOffset: 0,
  });

  const setActiveLayerIfChanged = useCallback((nextLayer: CoreLayerId | null) => {
    if (!nextLayer || activeLayerRef.current === nextLayer) return;
    activeLayerRef.current = nextLayer;
    setActiveLayer(nextLayer);
  }, []);

  const setActiveSubsectionIfChanged = useCallback((nextSubsection: string | null) => {
    if (activeSubsectionRef.current === nextSubsection) return;
    activeSubsectionRef.current = nextSubsection;
    setActiveSubsection(nextSubsection);
  }, []);

  const getScrollParent = useCallback((node: HTMLElement | null): HTMLElement | Window => {
    let parent: HTMLElement | null = node;
    while (parent) {
      if (parent.hasAttribute('data-client-scroll-container')) return parent;
      const { overflowY } = window.getComputedStyle(parent);
      if (overflowY === 'auto' || overflowY === 'scroll') return parent;
      parent = parent.parentElement;
    }
    return window;
  }, []);

  const updateActiveLayerFromScroll = useCallback(() => {
    // During programmatic scroll (click on setter core), skip — the target is already set
    if (isScrollingRef.current) return;

    // Settings: if near top, highlight settings
    const settingsEl = layerRefs.current['settings'];
    if (settingsEl) {
      if (settingsEl.getBoundingClientRect().top >= -20) {
        setActiveLayerIfChanged('settings');
        // Default to the first subsection (General) when at the top
        const firstSubEl = settingsEl.querySelector('[data-subsection-key]');
        const firstSubKey = firstSubEl ? (firstSubEl as HTMLElement).getAttribute('data-subsection-key') : 'settings_general';
        setActiveSubsectionIfChanged(firstSubKey);
        return;
      }
    }

    // Standard scan-line: immediate, no delay
    const scanLine = Math.round(window.innerHeight * 0.65);
    let nextLayer: CoreLayerId = CORE_LAYERS[0].id;

    for (const layer of CORE_LAYERS) {
      const el = layerRefs.current[layer.id];
      if (!el) continue;
      if (el.getBoundingClientRect().top <= scanLine) {
        nextLayer = layer.id;
      } else {
        break;
      }
    }

    setActiveLayerIfChanged(nextLayer);

    // Detect active subsection
    if (nextLayer === 'settings' || nextLayer === 'tone_style' || nextLayer === 'strategy' || nextLayer === 'guardrails') {
      const layerEl = layerRefs.current[nextLayer];
      if (layerEl) {
        const subsectionEls = layerEl.querySelectorAll('[data-subsection-key]');
        let activeSubKey: string | null = null;
        subsectionEls.forEach((el) => {
          if ((el as HTMLElement).getBoundingClientRect().top <= scanLine) {
            activeSubKey = (el as HTMLElement).getAttribute('data-subsection-key');
          }
        });
        setActiveSubsectionIfChanged(activeSubKey);
      }
    } else {
      setActiveSubsectionIfChanged(null);
    }
  }, [setActiveLayerIfChanged, setActiveSubsectionIfChanged]);

  const generateConversationExamples = useCallback(async (configsToUse?: Record<string, LocalConfig>) => {
    setIsGeneratingExamples(true);
    try {
      // Build the current full prompt (without examples) for context
      const currentFullPrompt = buildFullPrompt();

      const { data, error } = await supabase.functions.invoke('generate-conversation-examples', {
        body: {
          clientId,
          fullPrompt: currentFullPrompt,
        },
      });

      if (error) throw error;
      if (data?.error) {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
        return;
      }
      const EXAMPLES_HEADER = `## CONVERSATION EXAMPLES

### IMPORTANT: HOW TO USE THESE EXAMPLES

- These are **reference conversations only**. They exist to show you the general tone, flow, and approach.
- You **MUST NEVER** copy or mimic these examples word for word.
- You **MUST NEVER** try to steer every conversation to follow the same structure as these examples.
- You **MUST NEVER** use the same phrases, transitions, or responses from these examples in your actual conversations.
- Each real conversation is unique. Adapt your responses to what the lead actually says.
- Use these examples to understand the **vibe and energy**, not as a script.

── ──

`;
      setConversationExamples(EXAMPLES_HEADER + (data?.examples || ''));
      setExamplesApproved(false);
    } catch (err) {
      console.error('Error generating conversation examples:', err);
      toast({ title: 'Error', description: 'Failed to generate conversation examples.', variant: 'destructive' });
    } finally {
      setIsGeneratingExamples(false);
    }
  }, [localConfigs, toast]);

  // Initialize local configs from saved configs or defaults (only on first meaningful load)
  const lastConfigKeysRef = useRef<string>('');
  useEffect(() => {
    // Build a fingerprint of the incoming config keys+ids to detect slot changes vs refetch
    const configFingerprint = Object.keys(configs).sort().join(',');
    const isSlotChange = lastConfigKeysRef.current !== '' && lastConfigKeysRef.current !== configFingerprint;
    const isFirstLoad = lastConfigKeysRef.current === '';
    
    // Only initialize on first load or when the slot changes (different config keys)
    // Skip on auto-save refetch (same keys, just updated values)
    if (!isFirstLoad && !isSlotChange && Object.keys(localConfigs).length > 0) return;

    lastConfigKeysRef.current = configFingerprint;

    const initial: Record<string, LocalConfig> = {};
    for (const section of CONFIG_SECTIONS) {
      const saved = configs[section.key];
      if (saved) {
        // Use nullish coalescing so empty string '' is preserved (user intentionally deselected)
        const selectedOption = saved.selected_option ?? section.defaultOption;
        initial[section.key] = {
          selectedOption,
          customContent: saved.custom_content ?? getDefaultContent(section, selectedOption),
          expanded: false,
        };
      } else {
        initial[section.key] = {
          selectedOption: section.defaultOption,
          customContent: getDefaultContent(section, section.defaultOption),
          expanded: false,
        };
      }
    }
    setLocalConfigs(initial);

    // Load conversation examples from saved configs
    const savedExamples = configs['conversation_examples'];
    if (savedExamples?.custom_content) {
      setConversationExamples(savedExamples.custom_content);
    }

    // Load deploy approval states
    const savedDeployExamples = configs['_deploy_examples'];
    if (savedDeployExamples?.selected_option === 'approved') {
      setExamplesApproved(true);
    }
    const savedDeployPrompt = configs['_deploy_prompt'];
    if (savedDeployPrompt?.selected_option === 'approved') {
      setPromptApproved(true);
    }
  }, [configs]);

  // Fetch the client's timezone for the x-ray's call-time DYNAMIC VARIABLES segment (voice only)
  useEffect(() => {
    if (mode !== 'voice' || !clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('clients')
          .select('timezone')
          .eq('id', clientId)
          .maybeSingle();
        if (!cancelled && data?.timezone) setClientTimezone(data.timezone);
      } catch {
        // keep the Australia/Sydney default — display-only
      }
    })();
    return () => { cancelled = true; };
  }, [mode, clientId]);

  // Track the active layer from scroll position — instant for manual scroll, locked for programmatic
  useEffect(() => {
    let frame = 0;
    const handleScroll = () => {
      if (frame) cancelAnimationFrame(frame);
      // During programmatic scroll (setter core click), skip entirely
      if (isScrollingRef.current) return;
      // Immediate rAF — no debounce for natural scrolling
      frame = requestAnimationFrame(updateActiveLayerFromScroll);
    };

    let anchorEl: HTMLElement | null = null;
    for (const layer of CORE_LAYERS) {
      if (layerRefs.current[layer.id]) {
        anchorEl = layerRefs.current[layer.id];
        break;
      }
    }
    if (!anchorEl) {
      anchorEl = document.querySelector('[data-client-scroll-container]') as HTMLElement | null;
    }

    const scrollParent = getScrollParent(anchorEl);
    scrollParentRef.current = scrollParent;

    handleScroll();

    if (scrollParent === window) {
      window.addEventListener('scroll', handleScroll, { passive: true });
    } else {
      scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('resize', handleScroll);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
      if (scrollParent === window) {
        window.removeEventListener('scroll', handleScroll);
      } else {
        scrollParent.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', handleScroll);
    };
  }, [getScrollParent, updateActiveLayerFromScroll, agentSettings]);

  useEffect(() => {
    const frame = requestAnimationFrame(updateActiveLayerFromScroll);
    return () => cancelAnimationFrame(frame);
  }, [localConfigs, updateActiveLayerFromScroll]);

  useEffect(() => {
    const scrollEl = setterCoreScrollRef.current;
    const contentEl = setterCoreContentRef.current;
    if (!scrollEl || !contentEl) return;

    let frameId: number | null = null;

    const commitScrollbar = () => {
      frameId = null;
      const { scrollTop, clientHeight, scrollHeight } = scrollEl;
      const hasOverflow = scrollHeight > clientHeight + 1;

      if (!hasOverflow) {
        setSetterCoreScrollbar((prev) => (
          !prev.isVisible && prev.thumbHeight === 0 && prev.thumbOffset === 0
            ? prev
            : { isVisible: false, thumbHeight: 0, thumbOffset: 0 }
        ));
        return;
      }

      const minThumbHeight = 56;
      const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, minThumbHeight);
      const maxThumbOffset = Math.max(clientHeight - thumbHeight, 0);
      const scrollProgress = scrollHeight - clientHeight > 0 ? scrollTop / (scrollHeight - clientHeight) : 0;
      const thumbOffset = maxThumbOffset * scrollProgress;

      setSetterCoreScrollbar((prev) => (
        prev.isVisible &&
        Math.abs(prev.thumbHeight - thumbHeight) < 0.5 &&
        Math.abs(prev.thumbOffset - thumbOffset) < 0.5
          ? prev
          : {
              isVisible: true,
              thumbHeight,
              thumbOffset,
            }
      ));
    };

    const updateScrollbar = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(commitScrollbar);
    };

    updateScrollbar();

    const resizeObserver = new ResizeObserver(() => updateScrollbar());
    resizeObserver.observe(scrollEl);
    resizeObserver.observe(contentEl);
    scrollEl.addEventListener('scroll', updateScrollbar, { passive: true });
    window.addEventListener('resize', updateScrollbar);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      scrollEl.removeEventListener('scroll', updateScrollbar);
      window.removeEventListener('resize', updateScrollbar);
    };
  }, [activeLayer, localConfigs, conversationExamples]);

  function getDefaultContent(section: ConfigSection, optionValue: string): string {
    if (section.type === 'text' || section.type === 'custom_prompt') return section.defaultContent;
    if (section.type === 'multi-select') {
      const values = optionValue.split(',').filter(Boolean);
      return values.map(v => {
        const opt = section.options.find(o => o.value === v);
        return opt?.defaultContent || '';
      }).filter(Boolean).join('\n\n');
    }
    const opt = section.options.find(o => o.value === optionValue);
    return opt?.defaultContent || '';
  }

  const getConfigBaseline = useCallback((key: string) => {
    const saved = configs[key];
    const section = CONFIG_SECTIONS.find((s) => s.key === key);

    if (!section) {
      return {
        selectedOption: saved?.selected_option ?? '',
        customContent: saved?.custom_content ?? '',
      };
    }

    const baselineSelectedOption = saved?.selected_option ?? section.defaultOption;
    return {
      selectedOption: baselineSelectedOption,
      customContent: saved?.custom_content ?? getDefaultContent(section, baselineSelectedOption),
    };
  }, [configs]);

  const handleOptionChange = (key: string, value: string) => {
    const section = CONFIG_SECTIONS.find(s => s.key === key);
    if (!section) return;

    let newOption: string;
    let newContent: string;

    if (section.type === 'multi-select') {
      const current = localConfigs[key]?.selectedOption?.split(',').filter(Boolean) || [];
      const newValues = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      newOption = newValues.join(',');
      newContent = newValues.map(v => {
        const opt = section.options.find(o => o.value === v);
        return opt?.defaultContent || '';
      }).filter(Boolean).join('\n\n');

      // Auto-expand prompt view when 'custom_goal' is selected
      if (value === 'custom_goal' && !current.includes('custom_goal')) {
        updateConfig(key, newOption, newContent);
        setLocalConfigs(prev => ({
          ...prev,
          [key]: { ...prev[key], expanded: true },
        }));
        return;
      }
    } else {
      const current = localConfigs[key]?.selectedOption;
      if (current === value) {
        newOption = '';
        newContent = '';
      } else {
        newOption = value;
        newContent = getDefaultContent(section, value);
      }
    }

    updateConfig(key, newOption, newContent);
  };

  const handleTextChange = (key: string, value: string) => {
    const section = CONFIG_SECTIONS.find(s => s.key === key);
    if (!section) return;
    const content = section.defaultContent.replace('{name}', value || 'Agent');
    updateConfig(key, value, content);
  };

  const handleContentEdit = (key: string, content: string) => {
    updateConfig(key, localConfigs[key]?.selectedOption || '', content, true);
  };

  const toggleExpanded = (key: string) => {
    setLocalConfigs(prev => ({
      ...prev,
      [key]: { ...prev[key], expanded: !prev[key]?.expanded },
    }));
  };

  const updateConfig = (key: string, selectedOption: string, customContent: string, isContentEdit = false) => {
    userHasInteractedRef.current = true;
    // Reset prompt approval when any mini-prompt changes
    if (key !== '_deploy_examples' && key !== '_deploy_prompt') {
      setPromptApproved(false);
    }
    const updated = {
      ...localConfigs,
      [key]: { ...localConfigs[key], selectedOption, customContent },
    };
    setLocalConfigs(updated);

    const baseline = getConfigBaseline(key);
    const revertedToBaseline = selectedOption === baseline.selectedOption && customContent === baseline.customContent;

    setDirtyKeys(prev => {
      const next = new Set(prev);
      if (revertedToBaseline) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

    onConfigsChange(buildParentConfigOutput({
      configMap: updated,
      deployPromptSelected: '',
    }));
  };

  const allSections = [...CONFIG_SECTIONS.filter(s => s.group === 'persona'), ...CONFIG_SECTIONS.filter(s => s.group === 'technical'), ...CONFIG_SECTIONS.filter(s => s.group === 'prompt')];

  // Helper: push current localConfigs to parent and clear dirty keys
  const saveMiniPromptToParent = useCallback(() => {
    userHasInteractedRef.current = true;
    const output = buildParentConfigOutput({ deployPromptSelected: '' });
    onConfigsChange(output);
    void onExplicitSave?.(output);
    setDirtyKeys(new Set());
  }, [onConfigsChange, onExplicitSave]);

  const hasDirtyKeys = dirtyKeys.size > 0 || dirtyParamKeys.size > 0;

  const renderCheckbox = (isSelected: boolean) => (
    <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 bg-card" style={isSelected ? { backgroundColor: '#fff' } : undefined}>
      {isSelected && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
    </div>
  );

  const renderOptionCard = (section: ConfigSection, opt: ConfigOption, isSelected: boolean) => (
    <button
      key={opt.value}
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) handleOptionChange(section.key, opt.value);
      }}
      disabled={disabled}
      className={cn(
        "text-left p-2.5 transition-colors duration-100 groove-border relative",
        isSelected
          ? "bg-card"
          : "bg-card hover:bg-muted/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {isSelected && (
        <div className="absolute inset-0 pointer-events-none" style={{
          border: '1px solid hsl(var(--primary))',
          boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)',
        }} />
      )}
      <div className="flex items-center gap-2">
        {renderCheckbox(isSelected)}
        <span
          className={cn("text-foreground", isSelected && "text-primary")}
          style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'uppercase' }}
        >
          {opt.label}
        </span>
      </div>
      <p
        className="text-muted-foreground mt-1"
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.5', paddingLeft: '28px' }}
      >
        {opt.description}
      </p>
    </button>
  );

  const renderSection = (section: ConfigSection, isLast: boolean) => {
    const local = localConfigs[section.key];
    if (!local) return null;

    return (
      <React.Fragment key={section.key}>
        <div className="space-y-2.5 py-1" data-anchor-key={`section-${section.key}`}>
          {/* Section Header - matches parameter field style */}
          {section.label && (
            <div>
              <div className="text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                {section.label}
              </div>
              {section.type === 'text' && section.description && (
                <p className="text-muted-foreground mt-[2px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                  {section.description}
                </p>
              )}
            </div>
          )}

          {/* Text Input */}
          {section.type === 'text' && (() => {
            // Check if the prompt was AI-modified (content differs from default template)
            const defaultForCurrentName = section.defaultContent.replace('{name}', local.selectedOption || 'Agent');
            const isAIModified = local.customContent && local.customContent.trim() !== defaultForCurrentName.trim() && local.customContent.trim() !== section.defaultContent.trim();
            return isAIModified ? (
              <div className="flex items-center gap-2 px-3 py-2 groove-border bg-muted/50">
                <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                  Modified with AI. Click <strong>Modify with AI</strong> to continue editing, or <strong>Return to Default</strong> to unlock.
                </span>
              </div>
            ) : (
              <Input
                value={local.selectedOption}
                onChange={(e) => handleTextChange(section.key, e.target.value)}
                placeholder="Enter agent name..."
                className="h-8"
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                disabled={disabled}
              />
            );
          })()}

          {/* Custom Prompt */}
          {section.type === 'custom_prompt' && (
            <div className="space-y-2.5">
              {section.description && (
                <p className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                  {section.description}
                </p>
              )}
              <div className="relative">
                <Textarea
                  value={local.customContent}
                  onChange={(e) => {
                    if (!disabled) {
                      updateConfig(section.key, 'custom', e.target.value, true);
                    }
                  }}
                  placeholder={section.key === 'company_knowledge' 
                    ? "Provide your company information here..." 
                    : "Add any additional instructions for your agent here..."}
                  className="w-full leading-relaxed"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '200px', height: '200px' }}
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  onClick={() => { setMiniPromptAIKey(section.key); setMiniPromptAITitle(section.label || section.key); }}
                  className="absolute bottom-2 right-2 h-8 w-8"
                >
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </div>
              {/* Action buttons below field */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setMiniPromptAIKey(section.key);
                    setMiniPromptAITitle(section.label || section.key);
                  }}
                  disabled={disabled || !local.customContent?.trim()}
                  className="h-8 gap-1.5 font-medium groove-btn-blue"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Modify with AI
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => {
                    saveMiniPromptToParent();
                    toast({ title: 'Prompt saved', description: 'Mini-prompt saved to the full setter prompt.' });
                  }}
                  className="h-8 gap-1.5 font-medium groove-btn-pulse"
                  disabled={disabled || !hasDirtyKeys}
                >
                  <Save className="w-4 h-4" />
                  Save Mini Prompt
                </Button>
              </div>
            </div>
          )}

          {/* Personality Constructor removed — replaced by parameter system in Tone & Style layer */}

          {/* Single Select */}
          {section.type === 'select' && (
            <div className={cn(
              "grid gap-2",
              section.options.length <= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"
            )}>
              {section.options.map(opt => renderOptionCard(section, opt, local.selectedOption === opt.value))}
            </div>
          )}

          {/* Multi-Select */}
          {section.type === 'multi-select' && (
            <div className="space-y-2.5">
              {section.description && (
                <p
                  className="text-muted-foreground"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}
                >
                  {section.description}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {section.options.map(opt => {
                  const selectedValues = local.selectedOption?.split(',').filter(Boolean) || [];
                  return renderOptionCard(section, opt, selectedValues.includes(opt.value));
                })}
              </div>
            </div>
          )}

          {/* Expand/Collapse Mini Prompt */}
          {(section.type === 'select' || section.type === 'multi-select') && section.key !== 'personality' && local.selectedOption && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => toggleExpanded(section.key)}
                className="h-8 font-medium"
              >
                {local.expanded ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
                {local.expanded ? 'Hide' : 'View'} Prompt
              </Button>
              {local.expanded && (
                <>
                  <div className="relative">
                    <Textarea
                      value={local.customContent}
                      onChange={(e) => !disabled && handleContentEdit(section.key, e.target.value)}
                      className="w-full leading-relaxed"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '200px', height: '200px' }}
                      disabled={disabled}
                    />
                    <Button
                      type="button"
                      variant="default"
                      size="icon"
                      onClick={() => { setMiniPromptAIKey(section.key); setMiniPromptAITitle(section.label || section.key); }}
                      className="absolute bottom-2 right-2 h-8 w-8"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        setMiniPromptAIKey(section.key);
                        setMiniPromptAITitle(section.label || section.key);
                      }}
                      disabled={disabled || !local.customContent?.trim()}
                      className="h-8 gap-1.5 font-medium groove-btn-blue"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Modify with AI
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        // Reset to default option and default content
                        const defaultOption = section.defaultOption;
                        const defaultContent = getDefaultContent(section, defaultOption);
                        updateConfig(section.key, defaultOption, defaultContent);
                        toast({ title: 'Returned to default', description: 'Mini-prompt restored to default in the master prompt.' });
                      }}
                      className="h-8 gap-1.5 font-medium"
                      disabled={disabled}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Return to Default
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        saveMiniPromptToParent();
                        toast({ title: 'Prompt saved', description: 'Mini-prompt saved to the full setter prompt.' });
                      }}
                      className="h-8 gap-1.5 font-medium groove-btn-pulse"
                      disabled={disabled || !hasDirtyKeys}
                    >
                      <Save className="w-4 h-4" />
                      Save Mini Prompt
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Text input expandable content */}
          {section.type === 'text' && local.selectedOption && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => toggleExpanded(section.key)}
                className="h-8 font-medium"
              >
                {local.expanded ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
                {local.expanded ? 'Hide' : 'View'} Prompt
              </Button>
              {local.expanded && (
                <>
                  <div className="relative">
                    <Textarea
                      value={local.customContent}
                      onChange={(e) => !disabled && handleContentEdit(section.key, e.target.value)}
                      className="w-full leading-relaxed"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '200px', height: '200px' }}
                      disabled={disabled}
                    />
                    <Button
                      type="button"
                      variant="default"
                      size="icon"
                      onClick={() => { setMiniPromptAIKey(section.key); setMiniPromptAITitle(section.label || section.key); }}
                      className="absolute bottom-2 right-2 h-8 w-8"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        setMiniPromptAIKey(section.key);
                        setMiniPromptAITitle(section.label || section.key);
                      }}
                      disabled={disabled || !local.customContent?.trim()}
                      className="h-8 gap-1.5 font-medium groove-btn-blue"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Modify with AI
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        // For text fields: clear the input value AND reset the prompt to default template
                        if (section.type === 'text') {
                          updateConfig(section.key, '', section.defaultContent);
                        } else {
                          const defaultContent = getDefaultContent(section, local.selectedOption);
                          handleContentEdit(section.key, defaultContent);
                        }
                        toast({ title: 'Returned to default', description: 'Mini-prompt restored to default in the master prompt.' });
                      }}
                      className="h-8 gap-1.5 font-medium"
                      disabled={disabled}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Return to Default
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        saveMiniPromptToParent();
                        toast({ title: 'Prompt saved', description: 'Mini-prompt saved to the full setter prompt.' });
                      }}
                      className="h-8 gap-1.5 font-medium groove-btn-pulse"
                      disabled={disabled || !hasDirtyKeys}
                    >
                      <Save className="w-4 h-4" />
                      Save Mini Prompt
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  const expandedSection = expandedPromptKey ? CONFIG_SECTIONS.find(s => s.key === expandedPromptKey) : null;
  const expandedLocal = expandedPromptKey ? localConfigs[expandedPromptKey] : null;

  // Build configs map for core visualization (include settings layer synthetic entries)
  const coreConfigs = (() => {
    const base = Object.fromEntries(
      Object.entries(localConfigs).map(([k, v]) => [k, v ? { selectedOption: v.selectedOption, customContent: v.customContent } : null])
    );
    // Inject settings layer status
    if (agentSettings) {
      base['_setter_name'] = { selectedOption: localSetterName || '', customContent: '' };
      base['_ai_model'] = { selectedOption: localModel || '', customContent: '' };
      if (mode === 'voice') {
        // Voice mode: track voice-specific settings
        const rvs = retellVoiceSettings;
        base['_voice_id'] = { selectedOption: rvs?.voice_id || '', customContent: '' };
        base['_voice_volume'] = { selectedOption: rvs?.volume != null ? 'set' : '', customContent: '' };
        base['_voice_language'] = { selectedOption: rvs?.language || '', customContent: '' };
        base['_voice_start_speaker'] = { selectedOption: rvs?.start_speaker || '', customContent: '' };
        base['_voice_begin_message'] = { selectedOption: 'set', customContent: '' }; // always set (empty = dynamic)
        base['_voice_ambient_sound'] = { selectedOption: rvs?.ambient_sound || '', customContent: '' };
        base['_voice_phone_number'] = { selectedOption: 'set', customContent: '' }; // phone number always counts
        base['_voice_booking'] = { selectedOption: 'set', customContent: '' }; // booking toggle always counts
      } else {
        // Text mode settings
        base['_response_delay'] = { selectedOption: localResponseDelay > 0 ? 'set' : '', customContent: '' };
        base['_followup_delays'] = { selectedOption: (localFollowup1Delay > 0 || localFollowup2Delay > 0 || localFollowup3Delay > 0) ? 'set' : '', customContent: '' };
        base['_followup_instructions'] = { selectedOption: localFollowupInstructions.trim() ? 'set' : '', customContent: '' };
        base['_cancellation_conditions'] = { selectedOption: localCancellationChips.length > 0 ? 'set' : '', customContent: '' };
        base['_file_processing'] = { selectedOption: 'set', customContent: '' };
        base['_human_transfer'] = { selectedOption: 'set', customContent: '' };
      }
    }
    // Inject deploy layer status
    base['_deploy_examples'] = { selectedOption: examplesApproved ? 'approved' : '', customContent: '' };
    base['_deploy_prompt'] = { selectedOption: promptApproved ? 'approved' : '', customContent: '' };
    return base;
  })();
  // Section marker prefix used to tag each section in the full prompt (internal only)
  const SECTION_MARKER_PREFIX = '<!-- section:';

  // Notify parent when all layers are complete (green)
  useEffect(() => {
    if (!onAllLayersCompleteChange) return;
    const subsectionOverrides: Record<string, any[]> = {
      identity: R_IDENTITY,
      company: R_COMPANY,
      tone_style: R_TONE_STYLE,
      strategy: R_STRATEGY,
      guardrails: R_GUARDRAILS,
    };
    const allComplete = CORE_LAYERS.every(layer => {
      const status = getLayerStatus(layer, coreConfigs, paramStates, subsectionOverrides, headerSettingsKeysOverride);
      return status.isComplete;
    });
    onAllLayersCompleteChange(allComplete);
  }, [coreConfigs, paramStates, onAllLayersCompleteChange, R_IDENTITY, R_COMPANY, R_TONE_STYLE, R_STRATEGY, R_GUARDRAILS, headerSettingsKeysOverride]);

  const SECTION_MARKER_SUFFIX = ' -->';

  // Build the full prompt as an ORDERED list of navigable segments — flat structure:
  // # LAYER → ## PARAMETER (no subsection grouping in the text). Each segment carries the
  // editor target that produces it so the x-ray view can deep-link. segmentsToText() must
  // reproduce the legacy buildFullPrompt() output byte-for-byte (persisted as __full_prompt__).
  function buildFullPromptSegments(overrides?: {
    paramStateMap?: Record<string, ParamState>;
    configMap?: Record<string, LocalConfig>;
    conversationExamplesText?: string;
  }): PromptSegment[] {
    const activeParamStates = overrides?.paramStateMap ?? latestParamStatesRef.current;
    const activeLocalConfigs = overrides?.configMap ?? localConfigs;
    const activeConversationExamples = overrides?.conversationExamplesText ?? conversationExamples;
    const segments: PromptSegment[] = [];

    // Preserve edited first-line titles from mini-prompts while still preventing nested headings.
    const parseMiniPromptBlock = (text: string, fallbackTitle: string): { title: string; body: string } => {
      const trimmed = text.trim();
      const headingMatch = trimmed.match(/^#{1,3}\s+([^\n]+)(?:\n+([\s\S]*))?$/);

      if (!headingMatch) {
        return { title: fallbackTitle, body: trimmed };
      }

      return {
        title: headingMatch[1]?.trim() || fallbackTitle,
        body: headingMatch[2]?.trim() || '',
      };
    };

    // Helper to build a layer — flat list of ## PARAM_TITLE entries, grouped per subsection
    // so each subsection's slice of text is individually clickable in the x-ray view.
    const buildLayerBlock = (layerHeader: string, subsections: typeof R_IDENTITY, layerId: CoreLayerId) => {
      const subSegments: PromptSubSegment[] = [];
      for (const sub of subsections) {
        const miniParts = buildMiniPromptParts(activeParamStates, sub.params);
        const paramBlocks: string[] = [];
        for (const mp of miniParts) {
          const { title, body } = parseMiniPromptBlock(mp.prompt, mp.title);
          if (body) {
            paramBlocks.push(`## ${title}\n\n${body}`);
          } else if (title.trim()) {
            paramBlocks.push(`## ${title}`);
          }
        }
        if (paramBlocks.length > 0) {
          subSegments.push({
            id: `sub:${sub.key}`,
            title: sub.label,
            text: paramBlocks.join(SUB_SEGMENT_JOIN),
            target: { kind: 'subsection', key: sub.key },
          });
        }
      }
      if (subSegments.length > 0) {
        segments.push({
          id: `layer:${layerHeader}`,
          title: layerHeader.replace(/^#\s*/, ''),
          text: `${layerHeader}\n\n${subSegments.map(s => s.text).join(SUB_SEGMENT_JOIN)}`,
          source: 'params',
          target: { kind: 'layer', key: layerId },
          headerText: layerHeader,
          subSegments,
        });
      }
    };

    // ── Old config sections: agent_name goes first, agent_goal / custom_prompt collected separately ──
    const goalParts: string[] = [];
    const customInstructionParts: string[] = [];
    for (const section of allSections) {
      const local = activeLocalConfigs[section.key];
      if (!local?.customContent?.trim()) continue;
      if (section.key === 'custom_prompt') {
        customInstructionParts.push(local.customContent.trim());
      } else if (section.key === 'agent_goal') {
        goalParts.push(local.customContent.trim());
      } else {
        segments.push({
          id: `section:${section.key}`,
          title: section.label || section.key,
          text: local.customContent.trim(),
          source: 'config-section',
          target: { kind: 'anchor', key: `section-${section.key}` },
        });
      }
    }

    // ── Identity ──
    buildLayerBlock('# IDENTITY', R_IDENTITY, 'identity');

    // ── Lead Context (lead source, lead awareness, prior comms) — stays near top ──
    buildLayerBlock('# LEAD CONTEXT', R_COMPANY_LEAD_CONTEXT, 'company');

    // ── Agent Goal ──
    if (goalParts.length > 0) {
      segments.push({
        id: 'section:agent_goal',
        title: 'Agent Goal',
        text: goalParts.join('\n\n'),
        source: 'config-section',
        target: { kind: 'anchor', key: 'section-agent_goal' },
      });
    }

    // ── Personality & Style (persona behavior + tone + emojis + formatting + language) ──
    buildLayerBlock('# PERSONALITY & STYLE', R_TONE_STYLE, 'tone_style');

    // ── Strategy ──
    buildLayerBlock('# CONVERSATION STRATEGY', R_STRATEGY, 'strategy');

    // ── Guardrails ──
    buildLayerBlock('# GUARDRAILS', R_GUARDRAILS, 'guardrails');

    // ── Conversation Examples ──
    if (activeConversationExamples?.trim()) {
      segments.push({
        id: 'examples',
        title: 'Conversation Examples',
        text: `# CONVERSATION EXAMPLES\n\n${activeConversationExamples.trim()}`,
        source: 'examples',
        target: { kind: 'anchor', key: 'conversation-examples' },
      });
    }

    // ── Custom Instructions ──
    if (customInstructionParts.length > 0) {
      segments.push({
        id: 'custom',
        title: 'Additional Custom Instructions',
        text: `# ADDITIONAL CUSTOM INSTRUCTIONS\n\n${customInstructionParts.join('\n\n')}`,
        source: 'custom',
        target: { kind: 'anchor', key: 'custom-instructions' },
      });
    }

    // ── Booking Prompt (if enabled) ──
    if (agentSettings?.booking_function_enabled && agentSettings?.booking_prompt?.trim()) {
      segments.push({
        id: 'booking',
        title: 'Booking Function',
        text: `# BOOKING FUNCTION\n\n${agentSettings.booking_prompt.trim()}`,
        source: 'booking',
        target: { kind: 'anchor', key: 'booking-prompt' },
      });
    }

    // ── Company Info at the very bottom (company name, ICP, knowledge base) ──
    buildLayerBlock('# COMPANY', R_COMPANY_INFO, 'company');

    return segments;
  }

  function buildFullPrompt(overrides?: {
    paramStateMap?: Record<string, ParamState>;
    configMap?: Record<string, LocalConfig>;
    conversationExamplesText?: string;
  }) {
    return segmentsToText(buildFullPromptSegments(overrides));
  }

  function buildParentConfigOutput(overrides?: {
    paramStateMap?: Record<string, ParamState>;
    configMap?: Record<string, LocalConfig>;
    conversationExamplesText?: string;
    deployExamplesSelected?: string;
    deployPromptSelected?: string;
  }) {
    const activeParamStates = overrides?.paramStateMap ?? latestParamStatesRef.current;
    const activeLocalConfigs = overrides?.configMap ?? localConfigs;
    const activeConversationExamples = overrides?.conversationExamplesText ?? conversationExamples;
    const output: Record<string, { selectedOption: string; customContent: string }> = {};

    for (const [k, v] of Object.entries(activeLocalConfigs)) {
      output[k] = { selectedOption: v.selectedOption, customContent: v.customContent };
    }

    if (activeConversationExamples?.trim()) {
      output['conversation_examples'] = { selectedOption: 'custom', customContent: activeConversationExamples };
    }

    output['_deploy_examples'] = { selectedOption: overrides?.deployExamplesSelected ?? (examplesApproved ? 'approved' : ''), customContent: '' };
    output['_deploy_prompt'] = { selectedOption: overrides?.deployPromptSelected ?? (promptApproved ? 'approved' : ''), customContent: '' };
    output['__full_prompt__'] = {
      selectedOption: '',
      customContent: buildFullPrompt({
        paramStateMap: activeParamStates,
        configMap: activeLocalConfigs,
        conversationExamplesText: activeConversationExamples,
      }),
    };
    // The manual full-prompt override feature was removed (the Verify Setter Prompt view is
    // read-only). Always emit this key cleared so stale 'active' rows persisted by older
    // builds self-heal in prompt_configurations on the next save.
    output['__full_prompt_manual_override__'] = {
      selectedOption: '',
      customContent: '',
    };

    return output;
  }

  // ── Expose imperative getter for the current full prompt ──
  useEffect(() => {
    if (getFullPromptRef) {
      getFullPromptRef.current = () => {
        const output = buildParentConfigOutput();
        const fullPrompt = output['__full_prompt__']?.customContent || '';
        // Build persona from the config sections (same logic as buildPromptFromConfigs in parent)
        const personaKeys = ['agent_name', 'agent_goal', 'identity_behavior', 'personality', 'communication_tone', 'grammar_style'];
        const SECTION_SEPARATOR = '\n\n── ── ── ── ── ── ── ── ── ── ── ── ── ──\n\n';
        const personaParts: string[] = [];
        for (const key of personaKeys) {
          const config = localConfigs[key];
          if (!config?.customContent?.trim()) continue;
          if (key === 'personality') {
            try {
              const parsed = JSON.parse(config.customContent);
              if (parsed.prompt?.trim()) personaParts.push(parsed.prompt.trim());
            } catch { personaParts.push(config.customContent.trim()); }
          } else {
            personaParts.push(config.customContent.trim());
          }
        }
        return { persona: personaParts.join(SECTION_SEPARATOR), content: fullPrompt };
      };
    }
  });

  const userHasInteractedRef = useRef(false);
  const initialSnapshotRef = useRef<string>('');

  useEffect(() => {
    userHasInteractedRef.current = false;
    initialSnapshotRef.current = '';
  }, [clientId, slotId]);

  useEffect(() => {
    const hasInitializedConfigs = Object.keys(localConfigs).length > 0;
    if (!hasInitializedConfigs || !paramStatesLoadedRef.current) return;

    // Capture initial snapshot once all data is loaded
    if (!initialSnapshotRef.current) {
      initialSnapshotRef.current = JSON.stringify(buildParentConfigOutput());
      return;
    }

    // Only propagate if user has explicitly interacted
    if (!userHasInteractedRef.current) return;

    onConfigsChange(buildParentConfigOutput());
  }, [localConfigs, paramStates, conversationExamples, examplesApproved, promptApproved, onConfigsChange]);

  useEffect(() => {
    if (!pendingMiniPromptAI || expandedPromptKey !== null) return;
    setMiniPromptAITitle(pendingMiniPromptAI.title);
    setMiniPromptAIKey(pendingMiniPromptAI.key);
    setPendingMiniPromptAI(null);
  }, [pendingMiniPromptAI, expandedPromptKey]);

  const startProgrammaticScrollLock = useCallback(() => {
    if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);

    let stableChecks = 0;
    let lastOffset = scrollParentRef.current === window
      ? (window.scrollY || 0)
      : (scrollParentRef.current as HTMLElement).scrollTop;
    const startedAt = Date.now();

    const checkForSettle = () => {
      const currentOffset = scrollParentRef.current === window
        ? (window.scrollY || 0)
        : (scrollParentRef.current as HTMLElement).scrollTop;

      if (Math.abs(currentOffset - lastOffset) < 1) {
        stableChecks += 1;
      } else {
        stableChecks = 0;
        lastOffset = currentOffset;
      }

      if (stableChecks >= 3 || Date.now() - startedAt > 2000) {
        isScrollingRef.current = false;
        scrollLockTimerRef.current = null;
        updateActiveLayerFromScroll();
        return;
      }

      scrollLockTimerRef.current = window.setTimeout(checkForSettle, 60);
    };

    scrollLockTimerRef.current = window.setTimeout(checkForSettle, 60);
  }, [updateActiveLayerFromScroll]);

  // Handle layer click - scroll to section
  const handleLayerClick = (layerId: CoreLayerId) => {
    const el = layerRefs.current[layerId];
    if (!el) return;

    if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);

    isScrollingRef.current = true;
    activeLayerRef.current = layerId;
    setActiveLayer(layerId);
    setActiveSubsectionIfChanged(null);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    startProgrammaticScrollLock();
  };

  // Container-aware scroll shared by subsection clicks and x-ray segment navigation
  const scrollToElement = (el: Element) => {
    const scrollContainer = document.querySelector('[data-client-scroll-container]') as HTMLElement | null;
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scrollTop = scrollContainer.scrollTop + (elRect.top - containerRect.top);
      scrollContainer.scrollTo({ top: scrollTop, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSubsectionClick = (subsectionKey: string) => {
    const el = document.querySelector(`[data-subsection-key="${subsectionKey}"]`);
    if (!el) return;

    if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);

    isScrollingRef.current = true;

    // Derive the parent layer from the subsection key prefix
    if (subsectionKey.startsWith('settings_')) {
      activeLayerRef.current = 'settings';
      setActiveLayer('settings');
    }

    setActiveSubsectionIfChanged(subsectionKey);

    // Use the scroll container for reliable scrolling
    scrollToElement(el);
    startProgrammaticScrollLock();
  };

  // ── Setter Prompt X-Ray: memoized segment registry + click-to-navigate ──
  const fullPromptSegments = useMemo(
    () => buildFullPromptSegments({ paramStateMap: paramStates }),
    // buildFullPromptSegments reads localConfigs/conversationExamples/agentSettings from closure;
    // mode is included because the R_* subsection sets are derived from it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paramStates, localConfigs, conversationExamples, agentSettings?.booking_function_enabled, agentSettings?.booking_prompt, mode]
  );

  // Lookup maps for the inline "View rendered prompt text" previews
  const segmentsByLayer = useMemo(() => {
    const map = new Map<string, PromptSegment[]>();
    for (const seg of fullPromptSegments) {
      if (seg.target.kind === 'layer') {
        const arr = map.get(seg.target.key) || [];
        arr.push(seg);
        map.set(seg.target.key, arr);
      }
    }
    return map;
  }, [fullPromptSegments]);

  const segmentById = useMemo(() => {
    const map = new Map<string, PromptSegment>();
    for (const seg of fullPromptSegments) map.set(seg.id, seg);
    return map;
  }, [fullPromptSegments]);

  // Segments appended at push/call time (voice only) — shown read-only in the x-ray so the
  // TRUE final prompt that hits the LLM is visible. Mirrors PromptManagement handleSavePrompt
  // (booking append, truthiness check not trim) + retell-proxy's DYNAMIC_VARS_BLOCK.
  const callTimeSegments = useMemo<PromptSegment[]>(() => {
    if (mode !== 'voice') return [];
    const segs: PromptSegment[] = [];
    if (agentSettings?.booking_function_enabled && agentSettings?.booking_prompt) {
      segs.push({
        id: 'push:booking',
        title: 'Booking Instructions (appended at push)',
        text: `\n## BOOKING INSTRUCTIONS\n${agentSettings.booking_prompt}`,
        source: 'push-append',
        target: { kind: 'readonly', label: 'Added at call time' },
      });
    }
    segs.push({
      id: 'push:dynamic-vars',
      title: 'Dynamic Variables (auto-injected at push)',
      text: buildDynamicVarsBlock(clientTimezone),
      source: 'push-append',
      target: { kind: 'readonly', label: 'Added at call time' },
    });
    return segs;
  }, [mode, agentSettings?.booking_function_enabled, agentSettings?.booking_prompt, clientTimezone]);

  // ── Inline "View rendered prompt text" previews: x-ray slices under each editing area ──
  const [expandedPreviews, setExpandedPreviews] = useState<Set<string>>(new Set());
  const togglePreview = (key: string) => {
    setExpandedPreviews(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const renderSegmentPreview = (previewKey: string, segs: PromptSegment[]) => {
    const isOpen = expandedPreviews.has(previewKey);
    const text = segs.map(s => s.text).join(SEGMENT_JOIN);
    return (
      <div className="space-y-2 mt-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => togglePreview(previewKey)}
          className="h-8 font-medium"
        >
          {isOpen ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
          {isOpen ? 'Hide' : 'View'} Rendered Prompt Text
        </Button>
        {isOpen && (
          <div className="groove-border bg-card p-3">
            {text.trim() ? (
              <pre className="whitespace-pre-wrap break-words m-0" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.6' }}>{text}</pre>
            ) : (
              <p className="text-muted-foreground m-0" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>(nothing rendered into the prompt yet)</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Click a segment in the x-ray → jump the editor to the control that produces it.
  // Retry loop covers the dialog close animation and the booking-prompt expansion render.
  const navigateToSegment = (target: SegmentTarget) => {
    if (target.kind === 'readonly') return;
    if (showFullPromptDialog) setShowFullPromptDialog(false);
    if (target.kind === 'anchor' && target.key === 'booking-prompt') setBookingPromptExpanded(true);
    const selector =
      target.kind === 'layer' ? `[data-layer-id="${target.key}"]`
      : target.kind === 'subsection' ? `[data-subsection-key="${target.key}"]`
      : target.key === 'booking-prompt' ? '#field-booking_function'
      : `[data-anchor-key="${target.key}"]`;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.querySelector(selector);
      if (el) {
        if (target.kind === 'layer') {
          handleLayerClick(target.key as CoreLayerId);
          return;
        }
        if (target.kind === 'subsection') {
          handleSubsectionClick(target.key);
          return;
        }
        if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
        isScrollingRef.current = true;
        scrollToElement(el);
        startProgrammaticScrollLock();
      } else if (++attempts < 20) {
        setTimeout(tryScroll, 50);
      }
    };
    requestAnimationFrame(tryScroll);
  };

  // Gate rendering behind loading state to prevent flicker
  if (!isFullyLoaded || (checkingForActiveJob && !externalGeneratingConfig) || Object.keys(localConfigs).length === 0) {
    return <RetroLoader />;
  }

  return (
    <div className="flex gap-6 relative">
      <SavingOverlay isVisible={savingParamKeys.size > 0} message="Saving mini prompt..." variant="fixed" />
      <SavingOverlay
        isVisible={isGeneratingConfig || externalGeneratingConfig}
        message={isCopyingConfig || externalGeneratingConfig ? "Copying Setter Configuration" : "Generating Configuration"}
        variant="fixed"
      />
      {/* Left: Config fields (infinite scroll) */}
      <div className="flex-1 min-w-0 space-y-0">
        {CORE_LAYERS.map((layer, layerIdx) => {
          // Settings layer is rendered specially with agent settings
          if (layer.id === 'settings') {
            if (!agentSettings || !onAgentSettingsChange) return null;
            const isActiveLayer = activeLayer === layer.id;
            return (
              <div
                key={layer.id}
                ref={(el) => { layerRefs.current[layer.id] = el; }}
                data-layer-id={layer.id}
              >
                <SectionLayerHeader layerId={layer.id} configs={coreConfigs} isActive={isActiveLayer} paramStates={paramStates} subsectionOverrides={headerSubsectionOverrides} settingsKeysOverride={headerSettingsKeysOverride} />
                <div className="space-y-6">
                  {/* Setter Description */}
                  <div className="space-y-2" data-subsection-key="settings_general">
                    <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>Setter Description</Label>
                    <Input
                      type="text"
                      className="h-8"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                      placeholder="e.g. Webinar Nurturing Agent"
                      value={localSetterName}
                      onChange={(e) => {
                        setLocalSetterName(e.target.value);
                        onMarkNeedsSync?.();
                      }}
                    />
                  </div>

                  <div className="border-t border-dashed border-border" />

                  {/* AI Model */}
                  <div data-subsection-key="settings_general">
                    {mode === 'voice' ? (
                      <RetellModelSelector
                        value={localModel}
                        onChange={(v) => {
                          setLocalModel(v);
                          onMarkNeedsSync?.();
                        }}
                        label="AI Model"
                      />
                    ) : (
                      <OpenRouterModelSelector
                        value={localModel}
                        onChange={(v) => {
                          setLocalModel(v);
                          onMarkNeedsSync?.();
                        }}
                        label="AI Model"
                      />
                    )}
                    {/* Fast Tier toggle (Retell model_high_priority): same model,
                        dedicated low-latency pool, ~1.5x cost. Lives next to the
                        model selector; the field still persists via retellVoiceSettings. */}
                    {mode === 'voice' && retellVoiceSettings && onRetellVoiceSettingsChange && (
                      <div className="flex items-center justify-between gap-4 mt-3">
                        <div>
                          <label className="text-sm font-medium" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>Fast Tier</label>
                          <p className="text-muted-foreground" style={{ fontSize: '11px', fontFamily: "'IBM Plex Mono', monospace" }}>Lower latency, ~1.5× cost — same model.</p>
                        </div>
                        <Switch
                          checked={!!retellVoiceSettings.model_high_priority}
                          onCheckedChange={(c) => {
                            onRetellVoiceSettingsChange({ model_high_priority: !!c });
                            onMarkNeedsSync?.();
                          }}
                          disabled={disabled}
                        />
                      </div>
                    )}
                  </div>

                  {/* Voice-specific Retell settings (BASIC only) */}
                  {mode === 'voice' && clientId && retellVoiceSettings && onRetellVoiceSettingsChange && (
                    <>
                      <div className="border-t border-dashed border-border" />
                      <VoiceRetellSettings
                        clientId={clientId}
                        settings={retellVoiceSettings}
                        onChange={onRetellVoiceSettingsChange}
                        disabled={disabled}
                        bookingEnabled={agentSettings.booking_function_enabled}
                        renderMode="basic"
                      />
                    </>
                  )}

                  {/* Phone Number Selector for voice setters */}
                  {mode === 'voice' && clientId && slotId && (
                    <>
                      <div className="border-t border-dashed border-border" />
                      <RetellPhoneNumberSelector
                        clientId={clientId}
                        slotId={slotId}
                        disabled={disabled}
                        onMarkNeedsSync={onMarkNeedsSync}
                      />
                    </>
                  )}

                  {!isFollowup && mode !== 'voice' && (
                    <>
                      <div className="border-t border-dashed border-border" />
                      {/* Response Delay */}
                      <div className="space-y-2" id="field-response_delay" data-highlight-field="response_delay">
                        <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>Response Delay</Label>
                        <div className="flex items-center gap-2">
                          {highlightResponseDelay && (
                            <span
                              className="credential-arrow-pulse shrink-0 -ml-1"
                              style={{
                                fontFamily: "'VT323', monospace",
                                fontSize: '14px',
                                color: 'hsl(142, 71%, 45%)',
                                textShadow: '0 0 6px rgba(34, 197, 94, 0.3)',
                              }}
                            >
                              ▶
                            </span>
                          )}
                          <div className="relative flex-1" style={{ maxWidth: '96px' }}>
                            <Input
                              type="number"
                              min={0}
                              className="h-8 w-24"
                              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                              value={localResponseDelayValue}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setLocalResponseDelayValue(val);
                                setLocalResponseDelay(unitToSeconds(val, localResponseDelayUnit));
                                onMarkNeedsSync?.();
                              }}
                            />
                            {highlightResponseDelay && (
                              <div
                                className="absolute inset-[3px] pointer-events-none credential-arrow-pulse"
                                style={{
                                  border: '1px solid hsl(142, 71%, 45%)',
                                  boxShadow: 'inset 0 0 0 1px hsl(142 71% 45% / 0.15)',
                                }}
                              />
                            )}
                          </div>
                          <Select value={localResponseDelayUnit} onValueChange={(v) => {
                            const u = v as DelayUnit;
                            setLocalResponseDelayUnit(u);
                            setLocalResponseDelay(unitToSeconds(localResponseDelayValue, u));
                            onMarkNeedsSync?.();
                          }}>
                            <SelectTrigger className="h-8 w-[120px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
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

                      <div className="border-t border-dashed border-border" />
                      {/* Number of Follow-ups Select */}
                      <div className="space-y-4" id="field-followup_delay" data-subsection-key="settings_followup">
                        <div>
                          <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>Follow-ups</Label>
                          <p className="text-muted-foreground mt-[2px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                            How many follow-up messages to send if the lead doesn't respond, and the delay before each one.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { value: 0, label: 'No Follow-ups', desc: 'Single message only, no automated re-engagement' },
                            { value: 1, label: '1 Follow-up', desc: 'One follow-up if no response received' },
                            { value: 2, label: '2 Follow-ups', desc: 'Two follow-ups for higher engagement' },
                            { value: 3, label: '3 Follow-ups', desc: 'Full sequence with three follow-ups' },
                          ] as const).map((opt) => {
                            const isSelected = localFollowupMaxAttempts === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLocalFollowupMaxAttempts(opt.value); onMarkNeedsSync?.(); }}
                                className={cn(
                                  'text-left p-2.5 transition-colors duration-100 groove-border relative',
                                  isSelected ? 'bg-card' : 'bg-card hover:bg-muted/50',
                                )}
                              >
                                {isSelected && (
                                  <div className="absolute inset-0 pointer-events-none" style={{
                                    border: '1px solid hsl(var(--primary))',
                                    boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)',
                                  }} />
                                )}
                                <div className="flex items-center gap-2">
                                  {renderCheckbox(isSelected)}
                                  <span className={cn('text-foreground', isSelected && 'text-primary')} style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                                    {opt.label}
                                  </span>
                                </div>
                                <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.5', paddingLeft: '28px' }}>
                                  {opt.desc}
                                </p>
                              </button>
                            );
                          })}
                        </div>

                        {/* Follow-up #1 delay */}
                        {localFollowupMaxAttempts >= 1 && (
                          <div className="space-y-1">
                            <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>Follow-up #1 Delay</Label>
                            <div className="flex items-center gap-2">
                              {highlightFollowupDelay && (
                                <span className="credential-arrow-pulse shrink-0 -ml-1" style={{ fontFamily: "'VT323', monospace", fontSize: '14px', color: 'hsl(142, 71%, 45%)', textShadow: '0 0 6px rgba(34, 197, 94, 0.3)' }}>▶</span>
                              )}
                              <div className="relative flex-1" style={{ maxWidth: '96px' }}>
                                <Input type="number" min={0} className="h-8 w-24" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                  value={localFollowup1DelayValue}
                                  onChange={(e) => { const val = parseInt(e.target.value) || 0; setLocalFollowup1DelayValue(val); setLocalFollowup1Delay(unitToSeconds(val, localFollowup1DelayUnit)); onMarkNeedsSync?.(); }}
                                />
                                {highlightFollowupDelay && <div className="absolute inset-[3px] pointer-events-none credential-arrow-pulse" style={{ border: '1px solid hsl(142, 71%, 45%)', boxShadow: 'inset 0 0 0 1px hsl(142 71% 45% / 0.15)' }} />}
                              </div>
                              <Select value={localFollowup1DelayUnit} onValueChange={(v) => { const u = v as DelayUnit; setLocalFollowup1DelayUnit(u); setLocalFollowup1Delay(unitToSeconds(localFollowup1DelayValue, u)); onMarkNeedsSync?.(); }}>
                                <SelectTrigger className="h-8 w-[120px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                                  <SelectItem value="seconds">Seconds</SelectItem><SelectItem value="minutes">Minutes</SelectItem><SelectItem value="hours">Hours</SelectItem><SelectItem value="days">Days</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {/* Follow-up #2 delay */}
                        {localFollowupMaxAttempts >= 2 && (
                          <div className="space-y-1">
                            <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>Follow-up #2 Delay</Label>
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1" style={{ maxWidth: '96px' }}>
                                <Input type="number" min={0} className="h-8 w-24" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                  value={localFollowup2DelayValue}
                                  onChange={(e) => { const val = parseInt(e.target.value) || 0; setLocalFollowup2DelayValue(val); setLocalFollowup2Delay(unitToSeconds(val, localFollowup2DelayUnit)); onMarkNeedsSync?.(); }}
                                />
                              </div>
                              <Select value={localFollowup2DelayUnit} onValueChange={(v) => { const u = v as DelayUnit; setLocalFollowup2DelayUnit(u); setLocalFollowup2Delay(unitToSeconds(localFollowup2DelayValue, u)); onMarkNeedsSync?.(); }}>
                                <SelectTrigger className="h-8 w-[120px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                                  <SelectItem value="seconds">Seconds</SelectItem><SelectItem value="minutes">Minutes</SelectItem><SelectItem value="hours">Hours</SelectItem><SelectItem value="days">Days</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {/* Follow-up #3 delay */}
                        {localFollowupMaxAttempts >= 3 && (
                          <div className="space-y-1">
                            <Label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: 'hsl(var(--muted-foreground))' }}>Follow-up #3 Delay</Label>
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1" style={{ maxWidth: '96px' }}>
                                <Input type="number" min={0} className="h-8 w-24" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                  value={localFollowup3DelayValue}
                                  onChange={(e) => { const val = parseInt(e.target.value) || 0; setLocalFollowup3DelayValue(val); setLocalFollowup3Delay(unitToSeconds(val, localFollowup3DelayUnit)); onMarkNeedsSync?.(); }}
                                />
                              </div>
                              <Select value={localFollowup3DelayUnit} onValueChange={(v) => { const u = v as DelayUnit; setLocalFollowup3DelayUnit(u); setLocalFollowup3Delay(unitToSeconds(localFollowup3DelayValue, u)); onMarkNeedsSync?.(); }}>
                                <SelectTrigger className="h-8 w-[120px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}><SelectValue /></SelectTrigger>
                                <SelectContent className="bg-sidebar border border-border" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', borderStyle: 'solid', boxShadow: 'none' }}>
                                  <SelectItem value="seconds">Seconds</SelectItem><SelectItem value="minutes">Minutes</SelectItem><SelectItem value="hours">Hours</SelectItem><SelectItem value="days">Days</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Follow-up Instructions — only when count >= 1 */}
                      {localFollowupMaxAttempts >= 1 && (
                      <>
                          <div className="border-t border-dashed border-border" />
                          <div id="field-followup_instructions" className="space-y-2 relative">
                            <div className="flex items-center gap-2">
                              <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>Follow-up Instructions</Label>
                            </div>
                            <p className="text-muted-foreground mt-[2px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                              Tell the AI how to write follow-ups for this setter. Examples: 'Keep it under one sentence', 'Always ask a question', 'Use casual tone with emojis'
                            </p>
                            <div className="flex items-start gap-2">
                              {highlightFollowupInstructions && (
                                <span
                                  className="credential-arrow-pulse shrink-0 -ml-1 mt-2"
                                  style={{
                                    fontFamily: "'VT323', monospace",
                                    fontSize: '14px',
                                    color: 'hsl(142, 71%, 45%)',
                                    textShadow: '0 0 6px rgba(34, 197, 94, 0.3)',
                                  }}
                                >
                                  ▶
                                </span>
                              )}
                              <div className="relative flex-1">
                                <Textarea
                                  value={localFollowupInstructions}
                                  onChange={(e) => {
                                    setLocalFollowupInstructions(e.target.value);
                                    onMarkNeedsSync?.();
                                  }}
                                  placeholder="e.g. Keep it short and casual, always end with a question"
                                  className="min-h-[120px]"
                                  rows={5}
                                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setFollowupExpandOpen(true)}
                                  className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-foreground/10 text-foreground/50 hover:text-foreground/80 transition-colors"
                                  title="Expand"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                                {highlightFollowupInstructions && (
                                  <div
                                    className="absolute inset-[3px] pointer-events-none credential-arrow-pulse"
                                    style={{
                                      border: '1px solid hsl(142, 71%, 45%)',
                                      boxShadow: 'inset 0 0 0 1px hsl(142 71% 45% / 0.15)',
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                          <ExpandableTextDialog
                            open={followupExpandOpen}
                            onOpenChange={setFollowupExpandOpen}
                            title="Follow-up Instructions"
                            value={localFollowupInstructions}
                            onChange={(val) => {
                              setLocalFollowupInstructions(val);
                              onMarkNeedsSync?.();
                            }}
                          />
                        </>
                      )}

                      {/* When NOT to Follow Up — only when count >= 1 */}
                      {localFollowupMaxAttempts >= 1 && (
                      <>
                          <div className="border-t border-dashed border-border" />
                          <div className="space-y-2 relative">
                            <div className="flex items-center gap-2">
                              <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>When NOT to Follow Up</Label>
                            </div>
                            <p className="text-muted-foreground mt-[2px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                              Define conditions under which the AI should skip the follow-up. These are checked automatically before every follow-up is sent.
                            </p>
                            <div className="flex flex-col gap-1">
                              {localCancellationChips.map((chip, idx) => (
                                editingCancellationIdx === idx ? (
                                  <div key={idx} className="border border-border p-2.5 space-y-2 bg-muted/30">
                                    <Input
                                      autoFocus
                                      value={editingCancellationValue}
                                      onChange={(e) => setEditingCancellationValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && editingCancellationValue.trim()) {
                                          e.preventDefault();
                                          setLocalCancellationChips(prev => prev.map((c, i) => i === idx ? editingCancellationValue.trim() : c));
                                          setDirtyKeys(prev => new Set(prev).add('_cancellation_conditions'));
                                          onMarkNeedsSync?.();
                                          setEditingCancellationIdx(null);
                                        } else if (e.key === 'Escape') {
                                          setEditingCancellationIdx(null);
                                        }
                                      }}
                                      className="h-8"
                                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                                    />
                                    <div className="flex items-center gap-2">
                                      <Button type="button" variant="outline" size="sm" className="h-7 flex-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }} onClick={() => setEditingCancellationIdx(null)}>Cancel</Button>
                                      <Button type="button" size="sm" className="h-7 flex-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }} onClick={() => {
                                        if (editingCancellationValue.trim()) {
                                          setLocalCancellationChips(prev => prev.map((c, i) => i === idx ? editingCancellationValue.trim() : c));
                                          setDirtyKeys(prev => new Set(prev).add('_cancellation_conditions'));
                                          onMarkNeedsSync?.();
                                        }
                                        setEditingCancellationIdx(null);
                                      }} disabled={!editingCancellationValue.trim() || editingCancellationValue.trim() === chip}>Save</Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div key={idx} className="flex items-center gap-2">
                                    <div className="flex-1 min-w-0 groove-border bg-card px-3 flex items-center overflow-hidden" style={{ minHeight: '32px' }}>
                                      <span className="text-foreground truncate" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                                        {chip}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => { setEditingCancellationIdx(idx); setEditingCancellationValue(chip); }}
                                        className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 cursor-pointer"
                                        title="Edit condition"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setLocalCancellationChips(prev => prev.filter((_, i) => i !== idx));
                                          setDirtyKeys(prev => new Set(prev).add('_cancellation_conditions'));
                                          onMarkNeedsSync?.();
                                        }}
                                        className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer"
                                        title="Delete condition"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                )
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                value={cancellationInput}
                                onChange={(e) => setCancellationInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && cancellationInput.trim()) {
                                    e.preventDefault();
                                    setLocalCancellationChips(prev => [...prev, cancellationInput.trim()]);
                                    setCancellationInput('');
                                    setDirtyKeys(prev => new Set(prev).add('_cancellation_conditions'));
                                    onMarkNeedsSync?.();
                                  }
                                }}
                                placeholder="Type a condition..."
                                className="h-8 flex-1"
                                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                              />
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                className="h-8 gap-1.5 font-medium groove-btn-positive"
                                disabled={!cancellationInput.trim()}
                                onClick={() => {
                                  if (cancellationInput.trim()) {
                                    setLocalCancellationChips(prev => [...prev, cancellationInput.trim()]);
                                    setCancellationInput('');
                                    setDirtyKeys(prev => new Set(prev).add('_cancellation_conditions'));
                                    onMarkNeedsSync?.();
                                  }
                                }}
                              >
                                <Save className="w-3.5 h-3.5" />
                                <span className="ml-1.5">Submit</span>
                              </Button>
                            </div>
                          </div>
                        </>
                      )}

                      <div className="border-t border-dashed border-border" />
                      {/* Agent Features - Single column select cards matching Role/Title pattern */}
                      <div className="space-y-2.5 py-1" data-subsection-key="settings_features">
                        <div>
                          <Label className="text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>Agent Features</Label>
                          <p className="text-muted-foreground mt-[2px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                            Choose the features you want your setter to have
                          </p>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {/* File Processing */}
                          <button
                            type="button"
                            onClick={() => onAgentSettingsChange({ file_processing_enabled: !agentSettings.file_processing_enabled })}
                            className={cn(
                              'text-left p-3 transition-colors duration-100 groove-border relative bg-card',
                              !agentSettings.file_processing_enabled && 'hover:bg-muted/50'
                            )}
                          >
                            {agentSettings.file_processing_enabled && (
                              <div
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                  border: '1px solid hsl(var(--primary))',
                                  boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)',
                                }}
                              />
                            )}
                            <div className="flex items-start gap-2">
                               <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 mt-[1px] bg-card" style={agentSettings.file_processing_enabled ? { backgroundColor: '#fff' } : undefined}>
                                {agentSettings.file_processing_enabled && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
                              </div>
                              <div className="min-w-0">
                                <div className={cn('text-foreground', agentSettings.file_processing_enabled && 'text-primary')} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                                  File Processing
                                </div>
                                <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                                  Process voice notes, images, and files
                                </p>
                              </div>
                            </div>
                          </button>
                          {/* Human Transfer */}
                          <button
                            type="button"
                            onClick={() => onAgentSettingsChange({ human_transfer_enabled: !agentSettings.human_transfer_enabled })}
                            className={cn(
                              'text-left p-3 transition-colors duration-100 groove-border relative bg-card',
                              !agentSettings.human_transfer_enabled && 'hover:bg-muted/50'
                            )}
                          >
                            {agentSettings.human_transfer_enabled && (
                              <div
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                  border: '1px solid hsl(var(--primary))',
                                  boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)',
                                }}
                              />
                            )}
                            <div className="flex items-start gap-2">
                               <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 mt-[1px] bg-card" style={agentSettings.human_transfer_enabled ? { backgroundColor: '#fff' } : undefined}>
                                {agentSettings.human_transfer_enabled && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
                              </div>
                              <div className="min-w-0">
                                <div className={cn('text-foreground', agentSettings.human_transfer_enabled && 'text-primary')} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                                  Human Transfer
                                </div>
                                <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>
                                  Transfer conversation to a human
                                </p>
                              </div>
                            </div>
                          </button>
                          {/* Booking Function */}
                          <div id="field-booking_function">
                            <div className="flex items-center gap-2">
                              {highlightBookingFunction && (
                                <span className="credential-arrow-pulse shrink-0 -ml-1" style={{ fontFamily: "'VT323', monospace", fontSize: '14px', color: 'hsl(142, 71%, 45%)', textShadow: '0 0 6px rgba(34, 197, 94, 0.3)' }}>▶</span>
                              )}
                              <div className="relative flex-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newVal = !agentSettings.booking_function_enabled;
                                    const updates: Record<string, any> = { booking_function_enabled: newVal };
                                    if (newVal && !agentSettings.booking_prompt) {
                                      updates.booking_prompt = DEFAULT_BOOKING_PROMPT;
                                    }
                                    onAgentSettingsChange(updates);
                                  }}
                                  className={cn(
                                    'text-left p-3 transition-colors duration-100 groove-border relative bg-card w-full',
                                    !agentSettings.booking_function_enabled && 'hover:bg-muted/50'
                                  )}
                                >
                                  {agentSettings.booking_function_enabled && (
                                    <div className="absolute inset-0 pointer-events-none" style={{ border: '1px solid hsl(var(--primary))', boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)' }} />
                                  )}
                                  <div className="flex items-start gap-2">
                                    <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 mt-[1px] bg-card" style={agentSettings.booking_function_enabled ? { backgroundColor: '#fff' } : undefined}>
                                      {agentSettings.booking_function_enabled && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
                                    </div>
                                    <div className="min-w-0">
                                      <div className={cn('text-foreground', agentSettings.booking_function_enabled && 'text-primary')} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>Booking Function</div>
                                      <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.4' }}>Book appointments, drive conversions, schedule calls or meetings</p>
                                    </div>
                                  </div>
                                </button>
                                {highlightBookingFunction && <div className="absolute inset-[3px] pointer-events-none credential-arrow-pulse" style={{ border: '1px solid hsl(142, 71%, 45%)', boxShadow: 'inset 0 0 0 1px hsl(142 71% 45% / 0.15)' }} />}
                              </div>
                            </div>
                          </div>
                        </div>
                        {/* Booking Prompt — shown when booking is enabled */}
                        {agentSettings.booking_function_enabled && (
                          <div className="space-y-2 mt-2">
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              onClick={() => setBookingPromptExpanded(!bookingPromptExpanded)}
                              className="h-8 font-medium"
                            >
                              {bookingPromptExpanded ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
                              {bookingPromptExpanded ? 'Hide' : 'View'} Prompt
                            </Button>

                            {bookingPromptExpanded && (
                              <>
                                <div className="relative">
                                  <Textarea
                                    value={localBookingPrompt || ''}
                                    onChange={(e) => {
                                      setLocalBookingPrompt(e.target.value);
                                      setBookingPromptDirty(true);
                                    }}
                                    placeholder="Enter your booking function prompt..."
                                    className="w-full leading-relaxed groove-border bg-card"
                                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '200px', height: '200px' }}
                                  />
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="icon"
                                    onClick={() => {
                                      if (bookingPromptDirty) {
                                        onAgentSettingsChange({ booking_prompt: localBookingPrompt });
                                      }
                                      setMiniPromptAIKey('param__booking_prompt');
                                      setMiniPromptAITitle('BOOKING PROMPT');
                                    }}
                                    className="absolute bottom-2 right-2 h-8 w-8"
                                  >
                                    <Maximize2 className="w-4 h-4" />
                                  </Button>
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    onClick={() => {
                                      if (bookingPromptDirty) {
                                        onAgentSettingsChange({ booking_prompt: localBookingPrompt });
                                      }
                                      setMiniPromptAIKey('param__booking_prompt');
                                      setMiniPromptAITitle('BOOKING PROMPT');
                                    }}
                                    disabled={!localBookingPrompt.trim()}
                                    className="h-8 gap-1.5 font-medium groove-btn-blue"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Modify with AI
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    onClick={() => {
                                      setLocalBookingPrompt(DEFAULT_BOOKING_PROMPT);
                                      onAgentSettingsChange({ booking_prompt: DEFAULT_BOOKING_PROMPT });
                                      setBookingPromptDirty(false);
                                    }}
                                    className="h-8 gap-1.5 font-medium"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    Return to Default
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    onClick={async () => {
                                      const previousPrompt = agentSettings.booking_prompt || DEFAULT_BOOKING_PROMPT;
                                      onAgentSettingsChange({ booking_prompt: localBookingPrompt });
                                      setBookingPromptDirty(false);
                                      await saveParamVersionSnapshot('booking_prompt', localBookingPrompt, previousPrompt);
                                      if (onExplicitSave) {
                                        const output = buildParentConfigOutput({});
                                        onConfigsChange(output);
                                        void onExplicitSave(output);
                                      }
                                      toast({ title: 'Prompt saved', description: 'Booking prompt saved and version created.' });
                                    }}
                                    disabled={!bookingPromptDirty}
                                    className="h-8 gap-1.5 font-medium groove-btn-pulse"
                                  >
                                    <Save className="w-4 h-4" />
                                    Save Mini Prompt
                                  </Button>
                                </div>
                              </>
                            )}
                            {/* X-ray slice: rendered booking segment */}
                            {renderSegmentPreview('booking', segmentById.get('booking') ? [segmentById.get('booking')!] : [])}
                          </div>
                        )}
                      </div>
                    </>
                   )}

                  {/* Voice Booking Function - shown only for voice setters */}
                  {!isFollowup && mode === 'voice' && (
                    <>
                      <div className="border-t border-dashed border-border" />
                      <div id="field-booking_function" className="space-y-3">
                        <div>
                          <span className="text-foreground block" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, lineHeight: '1.4' }}>Booking Function</span>
                          <p className="text-muted-foreground mt-[2px]" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 400, lineHeight: '1.4' }}>Should this agent book appointments during calls?</p>
                        </div>
                        {highlightBookingFunction && (
                          <span className="credential-arrow-pulse shrink-0 -ml-1" style={{ fontFamily: "'VT323', monospace", fontSize: '14px', color: 'hsl(142, 71%, 45%)', textShadow: '0 0 6px rgba(34, 197, 94, 0.3)' }}>▶</span>
                        )}
                        <div className="space-y-2">
                          {/* Book Appointments option */}
                          <button
                            type="button"
                            onClick={() => {
                              if (agentSettings.booking_function_enabled) return;
                              const updates: Record<string, any> = { booking_function_enabled: true };
                              if (!agentSettings.booking_prompt) {
                                updates.booking_prompt = DEFAULT_VOICE_BOOKING_PROMPT;
                                setLocalBookingPrompt(DEFAULT_VOICE_BOOKING_PROMPT);
                              }
                              onAgentSettingsChange(updates);
                              if (onRetellVoiceSettingsChange) {
                                try {
                                  const currentTools = JSON.parse(retellVoiceSettings.general_tools || '[]');
                                  const hasBookingTools = Array.isArray(currentTools) && currentTools.some(
                                    (t: any) => ['update-appointment', 'get-available-slots', 'book-appointments'].includes(t.name)
                                  );
                                  if (!hasBookingTools) {
                                    onRetellVoiceSettingsChange({ general_tools: formatJsonConfig(DEFAULT_RETELL_GENERAL_TOOLS) });
                                  }
                                } catch { /* keep existing tools */ }
                              }
                            }}
                            className={cn(
                              'text-left p-3 transition-colors duration-100 groove-border relative bg-card w-full',
                              !agentSettings.booking_function_enabled && 'hover:bg-muted/50'
                            )}
                          >
                            {agentSettings.booking_function_enabled && (
                              <div className="absolute inset-0 pointer-events-none" style={{ border: '1px solid hsl(var(--primary))', boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)' }} />
                            )}
                            <div className="flex items-start gap-2">
                              <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 mt-[1px] bg-card" style={agentSettings.booking_function_enabled ? { backgroundColor: '#fff' } : undefined}>
                                {agentSettings.booking_function_enabled && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
                              </div>
                              <div className="min-w-0">
                                <div className={cn('text-foreground', agentSettings.booking_function_enabled && 'text-primary')} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, lineHeight: '1.4' }}>Book Appointments</div>
                                <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 400, lineHeight: '1.4' }}>Enable appointment booking, drive conversions, schedule calls or meetings</p>
                              </div>
                            </div>
                          </button>
                          {/* Don't Book Appointments option */}
                          <button
                            type="button"
                            onClick={() => {
                              if (!agentSettings.booking_function_enabled) return;
                              onAgentSettingsChange({ booking_function_enabled: false });
                            }}
                            className={cn(
                              'text-left p-3 transition-colors duration-100 groove-border relative bg-card w-full',
                              agentSettings.booking_function_enabled && 'hover:bg-muted/50'
                            )}
                          >
                            {!agentSettings.booking_function_enabled && (
                              <div className="absolute inset-0 pointer-events-none" style={{ border: '1px solid hsl(var(--primary))', boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)' }} />
                            )}
                            <div className="flex items-start gap-2">
                              <div className="w-5 h-5 groove-border flex items-center justify-center flex-shrink-0 mt-[1px] bg-card" style={!agentSettings.booking_function_enabled ? { backgroundColor: '#fff' } : undefined}>
                                {!agentSettings.booking_function_enabled && <svg viewBox="0 0 16 15" fill="#000" shapeRendering="crispEdges" className="w-3 h-3"><rect x="1" y="5" width="3" height="3"/><rect x="3" y="7" width="3" height="3"/><rect x="5" y="9" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="9" y="5" width="3" height="3"/><rect x="11" y="3" width="3" height="3"/></svg>}
                              </div>
                              <div className="min-w-0">
                                <div className={cn('text-foreground', !agentSettings.booking_function_enabled && 'text-primary')} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 500, lineHeight: '1.4' }}>Don't Book Appointments</div>
                                <p className="text-muted-foreground mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 400, lineHeight: '1.4' }}>Only <code style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' }}>end_call</code> will be active</p>
                              </div>
                            </div>
                          </button>
                        </div>
                        {agentSettings.booking_function_enabled && retellVoiceSettings && onRetellVoiceSettingsChange && (
                          <div className="mt-2 space-y-2">
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              onClick={() => setBookingPromptExpanded(!bookingPromptExpanded)}
                              className="h-8 font-medium"
                            >
                              {bookingPromptExpanded ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
                              {bookingPromptExpanded ? 'Hide' : 'View'} Prompt
                            </Button>

                            {bookingPromptExpanded && (
                              <>
                                <div className="relative">
                                  <Textarea
                                    value={localBookingPrompt || DEFAULT_VOICE_BOOKING_PROMPT}
                                    onChange={(e) => {
                                      setLocalBookingPrompt(e.target.value);
                                      setBookingPromptDirty(true);
                                    }}
                                    className="w-full leading-relaxed groove-border bg-card"
                                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '200px', height: '200px' }}
                                  />
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="icon"
                                    onClick={() => {
                                      if (bookingPromptDirty) {
                                        onAgentSettingsChange({ booking_prompt: localBookingPrompt });
                                      }
                                      setMiniPromptAIKey('param__booking_prompt');
                                      setMiniPromptAITitle('BOOKING PROMPT');
                                    }}
                                    className="absolute bottom-2 right-2 h-8 w-8"
                                  >
                                    <Maximize2 className="w-4 h-4" />
                                  </Button>
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    onClick={() => {
                                      if (bookingPromptDirty) {
                                        onAgentSettingsChange({ booking_prompt: localBookingPrompt });
                                      }
                                      setMiniPromptAIKey('param__booking_prompt');
                                      setMiniPromptAITitle('BOOKING PROMPT');
                                    }}
                                    disabled={!localBookingPrompt.trim()}
                                    className="h-8 gap-1.5 font-medium groove-btn-blue"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Modify with AI
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    onClick={() => {
                                      setLocalBookingPrompt(DEFAULT_VOICE_BOOKING_PROMPT);
                                      onAgentSettingsChange({ booking_prompt: DEFAULT_VOICE_BOOKING_PROMPT });
                                      setBookingPromptDirty(false);
                                    }}
                                    className="h-8 gap-1.5 font-medium"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    Return to Default
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    onClick={async () => {
                                      const previousPrompt = agentSettings.booking_prompt || DEFAULT_VOICE_BOOKING_PROMPT;
                                      onAgentSettingsChange({ booking_prompt: localBookingPrompt });
                                      setBookingPromptDirty(false);
                                      // Create a version snapshot
                                      await saveParamVersionSnapshot('booking_prompt', localBookingPrompt, previousPrompt);
                                      if (onExplicitSave) {
                                        const output = buildParentConfigOutput({});
                                        onConfigsChange(output);
                                        void onExplicitSave(output);
                                      }
                                      toast({ title: 'Prompt saved', description: 'Booking prompt saved and version created.' });
                                    }}
                                    disabled={!bookingPromptDirty}
                                    className="h-8 gap-1.5 font-medium groove-btn-pulse"
                                  >
                                    <Save className="w-4 h-4" />
                                    Save Mini Prompt
                                  </Button>
                                </div>
                              </>
                            )}
                            {/* X-ray slice: rendered booking segment */}
                            {renderSegmentPreview('booking', segmentById.get('booking') ? [segmentById.get('booking')!] : [])}

                            {/* General Tools moved to advanced config */}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Voice-specific Retell settings (ADVANCED gate + content) - after booking */}
                  {mode === 'voice' && clientId && retellVoiceSettings && onRetellVoiceSettingsChange && (
                    <>
                      <VoiceRetellSettings
                        clientId={clientId}
                        settings={retellVoiceSettings}
                        onChange={onRetellVoiceSettingsChange}
                        disabled={disabled}
                        bookingEnabled={agentSettings.booking_function_enabled}
                        advancedExpanded={voiceAdvancedExpanded}
                        onAdvancedExpandedChange={(expanded) => {
                          setVoiceAdvancedExpanded(expanded);
                        }}
                        renderMode="advanced"
                      />
                    </>
                  )}
                </div>
              </div>
            );
          }

          // Deploy layer is rendered specially
          if (layer.id === 'deploy') {
            if (aiConfigLocked) return null;
            const isActiveLayer = activeLayer === layer.id;
            return (
              <div
                key={layer.id}
                ref={(el) => { layerRefs.current[layer.id] = el; }}
                data-layer-id={layer.id}
                className="pt-6"
              >
                <div className="border-t border-dashed border-border mb-6" />
                <SectionLayerHeader layerId={layer.id} configs={coreConfigs} isActive={isActiveLayer} paramStates={paramStates} subsectionOverrides={headerSubsectionOverrides} settingsKeysOverride={headerSettingsKeysOverride} />

                <div className="space-y-6">
                  {/* Conversation Examples */}
                  <div className="space-y-2" data-anchor-key="conversation-examples">
                    <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>
                      Conversation Examples
                    </Label>
                    {!conversationExamples?.trim() ? (
                      <div className="groove-border bg-card p-4 space-y-3">
                        <p
                          className="text-muted-foreground"
                          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.6' }}
                        >
                          Before deploying your setter, you should generate conversation examples. Each mini-prompt already has small examples, but full conversation examples give your setter much better context on how to handle different scenarios naturally.
                        </p>
                        <p
                          className="text-muted-foreground"
                          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.6' }}
                        >
                          Click <strong>Generate</strong> to create examples based on your current configuration. You can then review, edit, and approve them.
                        </p>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => generateConversationExamples()}
                          disabled={disabled || isGeneratingExamples}
                          className="h-8 gap-1.5 font-medium groove-btn-blue"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {isGeneratingExamples ? 'Generating...' : 'Generate Examples'}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p
                          className="text-muted-foreground"
                          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.5' }}
                        >
                          Review your conversation examples below. You can edit them directly, regenerate, or use AI to refine them further.
                        </p>
                        <div className="relative">
                          <Textarea
                            value={conversationExamples}
                            onChange={(e) => {
                              if (!disabled) {
                                setConversationExamples(e.target.value);
                                setExamplesApproved(false);
                              }
                            }}
                            className="w-full leading-relaxed"
                            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '400px', height: '400px' }}
                            placeholder="No conversation examples yet..."
                            disabled={disabled || isGeneratingExamples}
                          />
                          <Button
                            type="button"
                            variant="default"
                            size="icon"
                            onClick={() => {
                              setMiniPromptAIKey('param__conversation_examples');
                              setMiniPromptAITitle('CONVERSATION EXAMPLES');
                            }}
                            className="absolute bottom-2 right-2 h-8 w-8"
                          >
                            <Maximize2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => generateConversationExamples()}
                            disabled={disabled || isGeneratingExamples}
                            className="h-8 gap-1.5 font-medium"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            {isGeneratingExamples ? 'Generating...' : 'Regenerate'}
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => {
                              setMiniPromptAIKey('param__conversation_examples');
                              setMiniPromptAITitle('CONVERSATION EXAMPLES');
                            }}
                            disabled={disabled || !conversationExamples?.trim()}
                            className="h-8 gap-1.5 font-medium groove-btn-blue"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Modify with AI
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() => {
                              setExamplesApproved(true);
                              const output: Record<string, { selectedOption: string; customContent: string }> = {};
                              for (const [k, v] of Object.entries(localConfigs)) {
                                output[k] = { selectedOption: v.selectedOption, customContent: v.customContent };
                              }
                              if (conversationExamples?.trim()) {
                                output['conversation_examples'] = { selectedOption: 'custom', customContent: conversationExamples };
                              }
                              output['_deploy_examples'] = { selectedOption: 'approved', customContent: '' };
                              output['_deploy_prompt'] = { selectedOption: promptApproved ? 'approved' : '', customContent: '' };
                              onConfigsChange(output);
                              toast({ title: 'Examples approved', description: 'Conversation examples have been verified and approved.' });
                            }}
                            disabled={disabled || !conversationExamples?.trim() || examplesApproved}
                            className={cn("h-8 gap-1.5 font-medium groove-btn-pulse", examplesApproved ? "groove-btn opacity-50" : "groove-btn-positive")}
                          >
                            <Save className="w-4 h-4" />
                            {examplesApproved ? '✓ Approved' : 'Approve Examples'}
                          </Button>
                        </div>
                      </>
                    )}
                    {/* X-ray slice: rendered conversation examples segment */}
                    {renderSegmentPreview('examples', segmentById.get('examples') ? [segmentById.get('examples')!] : [])}
                  </div>

                  <div className="border-t border-dashed border-border" />

                  {/* Custom Instructions */}
                  <div className="space-y-2" data-anchor-key="custom-instructions">
                    <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>
                      Custom Instructions
                    </Label>
                    <p
                      className="text-muted-foreground"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.5' }}
                    >
                      Add any additional custom instructions for your setter. These will be appended after the conversation examples in the final prompt.
                    </p>
                    <div className="relative">
                      <Textarea
                        value={localConfigs['custom_prompt']?.customContent || ''}
                        onChange={(e) => {
                          if (!disabled) {
                            userHasInteractedRef.current = true;
                            updateConfig('custom_prompt', 'custom', e.target.value, true);
                          }
                        }}
                        className="w-full leading-relaxed"
                        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '400px', height: '400px' }}
                        placeholder="Add custom instructions here..."
                        disabled={disabled}
                      />
                      <Button
                        type="button"
                        variant="default"
                        size="icon"
                        onClick={() => {
                          setMiniPromptAIKey('param__custom_prompt');
                          setMiniPromptAITitle('CUSTOM INSTRUCTIONS');
                        }}
                        className="absolute bottom-2 right-2 h-8 w-8"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => {
                          setMiniPromptAIKey('param__custom_prompt');
                          setMiniPromptAITitle('CUSTOM INSTRUCTIONS');
                        }}
                        disabled={disabled}
                        className="h-8 gap-1.5 font-medium groove-btn-blue"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Modify with AI
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={async () => {
                          const output: Record<string, { selectedOption: string; customContent: string }> = {};
                          for (const [k, v] of Object.entries(localConfigs)) {
                            output[k] = { selectedOption: v.selectedOption, customContent: v.customContent };
                          }
                          if (conversationExamples?.trim()) {
                            output['conversation_examples'] = { selectedOption: 'custom', customContent: conversationExamples };
                          }
                          output['_deploy_examples'] = { selectedOption: examplesApproved ? 'approved' : '', customContent: '' };
                          output['_deploy_prompt'] = { selectedOption: promptApproved ? 'approved' : '', customContent: '' };
                          onConfigsChange(output);
                          await onExplicitSave?.(output);
                          setDirtyKeys(new Set());
                          toast({ title: 'Prompt saved', description: 'Custom instructions saved to the full setter prompt.' });
                        }}
                        disabled={disabled || !hasDirtyKeys}
                        className={cn("h-8 gap-1.5 font-medium groove-btn-pulse", hasDirtyKeys ? "groove-btn-positive" : "groove-btn opacity-50")}
                      >
                        <Save className="w-4 h-4" />
                        Save Mini Prompt
                      </Button>
                    </div>
                    {/* X-ray slice: rendered custom instructions segment */}
                    {renderSegmentPreview('custom', segmentById.get('custom') ? [segmentById.get('custom')!] : [])}
                  </div>

                  <div className="border-t border-dashed border-border" />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'capitalize' }}>
                        Verify Setter Prompt
                      </Label>
                    </div>
                    <p
                      className="text-muted-foreground"
                      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.5' }}
                    >
                      This is the final prompt assembled from all your sections. It is read-only: click any section to jump to the control that edits it. Dashed sections are appended automatically at call time.
                    </p>
                    <div className="relative">
                      <FullPromptXRay
                        segments={fullPromptSegments}
                        callTimeSegments={callTimeSegments}
                        onNavigate={navigateToSegment}
                        maxHeight="400px"
                      />
                      <Button
                        type="button"
                        variant="default"
                        size="icon"
                        onClick={() => setShowFullPromptDialog(true)}
                        className="absolute bottom-2 right-2 h-8 w-8"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                {/* Delete Setter — at the very bottom (only when config is already generated, otherwise it's shown after AI generator) */}
                {onReturnToDefault && aiConfigGenerated && (
                  <div className="pt-4 border-t border-dashed border-border">
                    <Button
                      type="button"
                      variant="default"
                      onClick={onReturnToDefault}
                      className="w-full h-9 gap-1.5 font-medium groove-btn groove-btn-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Setter
                    </Button>
                  </div>
                )}
              </div>
            );
          }

          // ── Subsection-based layers (Identity, Company, Tone & Style, Strategy, Guardrails) ──
          if (layer.id === 'identity' || layer.id === 'company' || layer.id === 'tone_style' || layer.id === 'strategy' || layer.id === 'guardrails') {
            const subsectionMap: Record<string, typeof R_TONE_STYLE> = {
              identity: R_IDENTITY,
              company: R_COMPANY,
              tone_style: R_TONE_STYLE,
              strategy: R_STRATEGY,
              guardrails: R_GUARDRAILS,
            };
            const subsections = subsectionMap[layer.id] || [];
            const isActiveLayer = activeLayer === layer.id;

            // Render old CONFIG_SECTIONS that belong to this layer (e.g. agent_name, agent_goal, company_knowledge)
            const layerOldSections = allSections.filter(s => layer.configKeys.includes(s.key) && !s.key.startsWith('_subsection'));

            const isLockedLayer = (R_AI_LAYERS as readonly string[]).includes(layer.id) && aiConfigLocked;

            // When locked, hide these layers entirely (page ends after AI Generator)
            if (isLockedLayer) return null;

            return (
              <div
                key={layer.id}
                ref={(el) => { layerRefs.current[layer.id] = el; }}
                data-layer-id={layer.id}
                className="pt-6"
              >
                <div className="border-t border-dashed border-border mb-6" />
                <SectionLayerHeader layerId={layer.id} configs={coreConfigs} isActive={isActiveLayer} paramStates={paramStates} subsectionOverrides={headerSubsectionOverrides} settingsKeysOverride={headerSettingsKeysOverride} />

                {/* Unlocked content */}
                <div className="space-y-4">
                    {/* For company layer: render subsection params (company_name) FIRST, then old sections (company_knowledge) */}
                    {layer.id === 'company' && subsections.length > 0 && (
                      <SetterSubsectionRenderer
                        subsections={subsections}
                        paramStates={paramStates}
                        onParamChange={handleParamChange}
                        expandedSubsections={expandedSubsections}
                        onToggleSubsection={handleToggleSubsection}
                        disabled={disabled}
                        onOpenAI={(paramKey) => {
                          const allParams = subsections.flatMap((s) => s.params);
                          const paramDef = allParams.find((p) => p.key === paramKey);
                          if (paramDef) {
                            const pState = paramStates[paramKey];
                            const optSuffix = (paramDef.type === 'select' && pState?.value) ? `__opt__${pState.value}` : '';
                            setMiniPromptAIKey(`param__${paramKey}${optSuffix}`);
                            setMiniPromptAITitle(paramDef.label);
                          }
                        }}
                        onSave={handleSaveParamPrompt}
                        onReturnToDefault={handleReturnToDefault}
                        isParamSaving={(paramKey) => savingParamKeys.has(paramKey)}
                        isParamDirty={(paramKey) => dirtyParamKeys.has(paramKey)}
                      />
                    )}

                    {/* Separator between subsection params and old sections for company */}
                    {layer.id === 'company' && subsections.length > 0 && layerOldSections.length > 0 && (
                      <div className="border-t border-dashed border-border" />
                    )}

                    {/* Old config sections for this layer */}
                    {layerOldSections.length > 0 && (
                      <div className="space-y-6">
                        {layerOldSections.map((section, idx) => (
                          <React.Fragment key={section.key}>
                            {idx > 0 && <div className="border-t border-dashed border-border" />}
                            {renderSection(section, idx === layerOldSections.length - 1)}
                          </React.Fragment>
                        ))}
                      </div>
                    )}

                    {/* Separator between old sections and subsection params (non-company layers) */}
                    {layer.id !== 'company' && layerOldSections.length > 0 && subsections.length > 0 && (
                      <div className="border-t border-dashed border-border" />
                    )}

                    {/* Subsection parameters (non-company layers render after old sections) */}
                    {layer.id !== 'company' && subsections.length > 0 && (
                      <SetterSubsectionRenderer
                        subsections={subsections}
                        paramStates={paramStates}
                        onParamChange={handleParamChange}
                        expandedSubsections={expandedSubsections}
                        onToggleSubsection={handleToggleSubsection}
                        disabled={disabled}
                        onOpenAI={(paramKey) => {
                          const allParams = subsections.flatMap((s) => s.params);
                          const paramDef = allParams.find((p) => p.key === paramKey);
                          if (paramDef) {
                            const pState = paramStates[paramKey];
                            const optSuffix = (paramDef.type === 'select' && pState?.value) ? `__opt__${pState.value}` : '';
                            setMiniPromptAIKey(`param__${paramKey}${optSuffix}`);
                            setMiniPromptAITitle(paramDef.label);
                          }
                        }}
                        onSave={handleSaveParamPrompt}
                        onReturnToDefault={handleReturnToDefault}
                        isParamSaving={(paramKey) => savingParamKeys.has(paramKey)}
                        isParamDirty={(paramKey) => dirtyParamKeys.has(paramKey)}
                      />
                    )}

                    {/* X-ray slice: this layer's rendered prompt text */}
                    {renderSegmentPreview(`layer:${layer.id}`, segmentsByLayer.get(layer.id) ?? [])}
                  </div>

                {/* AI Configuration Generator — visible on company layer only when config not yet generated */}
                {layer.id === 'company' && !aiConfigGenerated && (
                  <div className="mt-6">
                    <div className="groove-border bg-card p-5 space-y-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        <span style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px', textTransform: 'uppercase' }} className="text-foreground">
                          AI Configuration Generator
                        </span>
                      </div>
                      <p className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', lineHeight: '1.6' }}>
                        Generate all setter parameters based on your company information, ICP, lead context, and any additional notes. Add your notes below to help the AI understand exactly how your setter should behave — the more detail you provide, the better the result. You can modify everything after.
                      </p>
                      <div className="relative">
                        <Textarea
                          value={aiConfigNotes}
                          onChange={(e) => handleAiConfigNotesChange(e.target.value)}
                          placeholder="e.g. Be very casual, use slang, never mention competitors, focus on agencies not direct businesses, always ask about their team size..."
                          className="min-h-[160px]"
                          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}
                          disabled={isGeneratingConfig || disabled}
                        />
                        <Button
                          type="button"
                          variant="default"
                          size="icon"
                          onClick={() => setAiNotesExpanded(true)}
                          className="absolute bottom-2 right-2 h-8 w-8"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <Dialog open={aiNotesExpanded} onOpenChange={setAiNotesExpanded}>
                        <DialogContent
                          className="flex flex-col"
                          style={{
                            width: '90vw',
                            maxWidth: '64rem',
                            height: '90vh',
                            maxHeight: '90vh',
                          }}
                        >
                          <DialogHeader>
                            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
                              AI CONFIGURATION GENERATOR NOTES
                            </DialogTitle>
                          </DialogHeader>
                          <div className="flex-1 min-h-0 px-6 pt-6">
                            <Textarea
                              value={aiConfigNotes}
                              onChange={(e) => handleAiConfigNotesChange(e.target.value)}
                              placeholder="e.g. Be very casual, use slang, never mention competitors, focus on agencies not direct businesses, always ask about their team size..."
                              className="h-full w-full leading-relaxed !resize-none"
                              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', height: '100%' }}
                              disabled={isGeneratingConfig || disabled}
                            />
                          </div>
                          <div className="px-6 pb-6" style={{ paddingTop: '8px' }}>
                            <Button
                              onClick={() => { setAiNotesExpanded(false); handleGenerateConfig(); }}
                              disabled={isGeneratingConfig || disabled}
                              className="h-10 gap-2 w-full groove-btn-blue"
                              style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
                            >
                              {isGeneratingConfig ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Generating... Please Wait
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-4 h-4" />
                                  GENERATE SETTER CONFIGURATION WITH AI
                                </>
                              )}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button
                        onClick={() => {
                          handleGenerateConfig();
                        }}
                        disabled={isGeneratingConfig || disabled}
                        className="h-10 gap-2 w-full groove-btn-blue"
                        style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
                      >
                        {isGeneratingConfig ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating... Please Wait
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            {aiConfigGenerated ? 'Generate New Setter Configuration with AI' : 'Generate Setter Configuration with AI'}
                          </>
                        )}
                      </Button>
                    </div>
                    {/* Delete Setter — shown here when config not yet generated */}
                    {onReturnToDefault && (
                      <div className="pt-4 border-t border-dashed border-border">
                        <Button
                          type="button"
                          variant="default"
                          onClick={onReturnToDefault}
                          className="w-full h-9 gap-1.5 font-medium groove-btn groove-btn-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete Setter
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }

          // Generic layers (custom, deploy, settings, etc.)
          const isGenericLocked = (R_AI_LAYERS as readonly string[]).includes(layer.id) && aiConfigLocked;
          if (isGenericLocked) return null;

          const layerSections = allSections.filter(s => layer.configKeys.includes(s.key));
          if (layerSections.length === 0) return null;
          const isActiveLayer = activeLayer === layer.id;

           return (
            <div
              key={layer.id}
              ref={(el) => { layerRefs.current[layer.id] = el; }}
              data-layer-id={layer.id}
              className="pt-6"
            >
              {/* Dashed separator from previous layer */}
              <div className="border-t border-dashed border-border mb-6" />
              {/* Layer Header */}
              <SectionLayerHeader layerId={layer.id} configs={coreConfigs} isActive={isActiveLayer} paramStates={paramStates} subsectionOverrides={headerSubsectionOverrides} settingsKeysOverride={headerSettingsKeysOverride} />

              {/* Layer Sections */}
              <div className="space-y-6">
                {layerSections.map((section, idx) => (
                  <React.Fragment key={section.key}>
                    {idx > 0 && (
                      <div className="border-t border-dashed border-border" />
                    )}
                    {renderSection(section, idx === layerSections.length - 1)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Right: Setter Core Visualization (sticky) */}
      <div
        className="shrink-0 self-start hidden md:block"
        style={{ position: 'sticky', top: 'calc(52px + 24px)', width: '380px' }}
      >
        <style>{`
          .setter-core-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .setter-core-scroll::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        <div className="relative" style={{ width: '100%' }}>
          <div
            ref={setterCoreScrollRef}
            className="setter-core-scroll"
            style={{
              maxHeight: 'calc(100vh - 52px - 48px)',
              overflowY: 'auto',
              overflowX: 'hidden',
              width: '100%',
            }}
          >
            <div ref={setterCoreContentRef} style={{ width: '100%' }}>

              <div className="groove-border bg-card px-4 pb-4">
                <AgentCoreVisualization
                  configs={coreConfigs}
                  activeLayer={activeLayer}
                  onLayerClick={handleLayerClick}
                  onSubsectionClick={handleSubsectionClick}
                  onExpandPrompt={() => setShowFullPromptDialog(true)}
                  disabled={disabled}
                  paramStates={paramStates}
                  activeSubsection={activeSubsection}
                  lockedLayers={aiConfigLocked ? new Set(R_AI_LAYERS as unknown as CoreLayerId[]) : undefined}
                  {...(mode === 'voice' ? {
                    coreTitle: 'VOICE CORE',
                    hideSettingsSubsections: true,
                    settingsKeysOverride: VOICE_SETTINGS_KEYS,
                    subsectionOverrides: {
                      identity: R_IDENTITY,
                      company: R_COMPANY,
                      tone_style: R_TONE_STYLE,
                      strategy: R_STRATEGY,
                      guardrails: R_GUARDRAILS,
                    },
                  } : {})}
                />
              </div>

              <div className="pb-6" />
            </div>
          </div>

          {setterCoreScrollbar.isVisible && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-[-14px] top-0"
              style={{ height: 'calc(100vh - 52px - 48px)', width: '6px' }}
            >
              <div
                className="absolute inset-x-0 rounded-full bg-border"
                style={{
                  top: `${setterCoreScrollbar.thumbOffset}px`,
                  height: `${setterCoreScrollbar.thumbHeight}px`,
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Full Prompt Dialog — read-only x-ray; click a section to jump to its editor */}
      <Dialog open={showFullPromptDialog} onOpenChange={(open) => {
        if (!open) setShowFullPromptDialog(false);
      }}>
        <DialogContent
          className="flex flex-col"
          style={{
            width: '95vw',
            maxWidth: '1600px',
            height: '92vh',
            maxHeight: '92vh',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              VERIFY SETTER PROMPT
            </DialogTitle>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }} className="text-muted-foreground mt-1">
              Read-only view of the assembled setter prompt. Click any section to jump to the control that edits it. Sections marked ADDED AT CALL TIME are appended automatically when the prompt is pushed, so this is the true final prompt the AI receives.
            </p>
          </DialogHeader>

          <div className="flex-1 min-h-0 px-6 pb-2 flex flex-col" style={{ paddingTop: '24px' }}>
            <FullPromptXRay
              segments={fullPromptSegments}
              callTimeSegments={callTimeSegments}
              onNavigate={navigateToSegment}
              maxHeight="100%"
            />
          </div>
          <div className="px-6 pb-6 flex gap-2">
            <Button
              type="button"
              variant="default"
              onClick={() => setShowFullPromptDialog(false)}
              className="flex-1 h-10 font-medium groove-btn"
              style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
            >
              CLOSE
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showConversationExamplesDialog} onOpenChange={setShowConversationExamplesDialog}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col" style={{ width: '90vw' }}>
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>CONVERSATION EXAMPLES</DialogTitle>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }} className="text-muted-foreground mt-1">
              These conversation examples are included in your setter's main prompt as reference. They are split here for easier editing. Modify anything you want, hit save, and they will be synced into the full prompt automatically.
            </p>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            <Textarea
              value={conversationExamples}
              onChange={(e) => {
                if (!disabled) setConversationExamples(e.target.value);
              }}
              className="w-full leading-relaxed !resize-none"
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', minHeight: '60vh' }}
              placeholder="Conversation examples will appear here once generated..."
              disabled={disabled || isGeneratingExamples}
            />
          </div>
          <div className="px-6 pb-6">
            <div className="flex w-full gap-2">
              <Button
                type="button"
                variant="default"
                onClick={() => generateConversationExamples()}
                disabled={disabled || isGeneratingExamples}
                className="flex-1 h-10 font-medium groove-btn-white"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                {isGeneratingExamples ? 'GENERATING...' : conversationExamples ? 'REGENERATE' : 'GENERATE'}
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  setExamplesApproved(true);
                  const output: Record<string, { selectedOption: string; customContent: string }> = {};
                  for (const [k, v] of Object.entries(localConfigs)) {
                    output[k] = { selectedOption: v.selectedOption, customContent: v.customContent };
                  }
                  if (conversationExamples?.trim()) {
                    output['conversation_examples'] = { selectedOption: 'custom', customContent: conversationExamples };
                  }
                  output['_deploy_examples'] = { selectedOption: 'approved', customContent: '' };
                  output['_deploy_prompt'] = { selectedOption: promptApproved ? 'approved' : '', customContent: '' };
                  onConfigsChange(output);
                  setShowConversationExamplesDialog(false);
                  toast({ title: 'Examples approved', description: 'Conversation examples have been verified and approved.' });
                }}
                disabled={disabled || isGeneratingExamples || !conversationExamples?.trim() || examplesApproved}
                className={cn("flex-1 h-10 font-medium groove-btn-pulse", examplesApproved ? "groove-btn opacity-50" : "groove-btn-positive")}
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
              >
                <Save className="w-4 h-4 mr-1.5" />
                {examplesApproved ? '✓ APPROVED' : 'APPROVE EXAMPLES'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Expand Dialog */}
      <Dialog open={!!expandedPromptKey} onOpenChange={(open) => { if (!open) setExpandedPromptKey(null); }}>
        <DialogContent
          className="flex flex-col"
          style={{
            width: '90vw',
            maxWidth: '64rem',
            height: '90vh',
            maxHeight: '90vh',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "'VT323', monospace", fontSize: '22px', letterSpacing: '1px' }}>
              {expandedSection?.label?.toUpperCase() || 'PROMPT'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-6 pt-4 pb-2">
            <Textarea
              value={expandedLocal?.customContent || ''}
              onChange={(e) => {
                if (!disabled && expandedPromptKey) {
                  if (expandedSection?.type === 'custom_prompt') {
                    updateConfig(expandedPromptKey, 'custom', e.target.value, true);
                  } else {
                    handleContentEdit(expandedPromptKey, e.target.value);
                  }
                }
              }}
              className="h-full w-full leading-relaxed !resize-none"
              style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', height: '100%' }}
              disabled={disabled}
            />
          </div>
          <div className="px-6 pb-6">
            <div className="flex w-full gap-2">
              <Button
                type="button"
                variant="default"
                onClick={() => {
                    if (!expandedPromptKey) return;
                    setPendingMiniPromptAI({
                      key: expandedPromptKey,
                      title: expandedSection?.label || expandedPromptKey,
                    });
                    setExpandedPromptKey(null);
                }}
                className="flex-1 h-10 font-medium groove-btn-blue"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
                disabled={disabled || !expandedLocal?.customContent?.trim()}
              >
                <Sparkles className="w-4 h-4 mr-1.5" />
                MODIFY WITH AI
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  if (!expandedPromptKey || !expandedSection) return;
                  const defaultContent = getDefaultContent(
                    expandedSection,
                    expandedLocal?.selectedOption || expandedSection.defaultOption
                  );
                  if (expandedSection.type === 'custom_prompt') {
                    updateConfig(expandedPromptKey, 'custom', defaultContent);
                  } else {
                    handleContentEdit(expandedPromptKey, defaultContent);
                  }
                }}
                className="flex-1 h-10 font-medium"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
                disabled={disabled || !expandedSection}
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                RETURN TO DEFAULT
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  saveMiniPromptToParent();
                  setExpandedPromptKey(null);
                }}
                className="flex-1 h-10 font-medium groove-btn-pulse"
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' }}
                disabled={disabled || !hasDirtyKeys}
              >
                <Save className="w-4 h-4 mr-1.5" />
                SAVE MINI PROMPT
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mini-Prompt AI Dialog */}
      <MiniPromptAIDialog
        open={!!miniPromptAIKey}
        onOpenChange={(open) => { if (!open) setMiniPromptAIKey(null); }}
        title={miniPromptAITitle}
        promptContent={(() => {
          if (!miniPromptAIKey) return '';
          if (miniPromptAIKey === 'param__booking_prompt') return agentSettings.booking_prompt || (mode === 'voice' ? DEFAULT_VOICE_BOOKING_PROMPT : DEFAULT_BOOKING_PROMPT);
          if (miniPromptAIKey === 'param__conversation_examples') return conversationExamples || '';
          if (miniPromptAIKey.startsWith('param__')) {
            const rawParamKey = miniPromptAIKey.replace('param__', '');
            const paramKey = rawParamKey.replace(/__opt__.*$/, '');
            const optionValue = rawParamKey.match(/__opt__(.*)$/)?.[1];
            const allParams = [...R_IDENTITY, ...R_COMPANY, ...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS].flatMap((s) => s.params);
            const paramDef = allParams.find((p) => p.key === paramKey);
            const paramState = paramDef
              ? (paramStates[paramKey] || { enabled: paramDef.defaultEnabled || false, value: paramDef.defaultValue })
              : paramStates[paramKey];
            if (!paramDef) return paramState?.customPrompt || '';
            if (optionValue && paramDef.type === 'select') {
              const scopedPrompt = paramState?.optionPrompts?.[optionValue];
              if (scopedPrompt?.trim()) return scopedPrompt;
              const opt = paramDef.options?.find((o) => o.value === optionValue) || paramDef.options?.[0];
              return opt?.defaultPrompt || '';
            }
            if (paramState?.customPrompt) return paramState.customPrompt;
            if (paramDef.type === 'select' && paramDef.options) {
              const opt = paramDef.options.find((o) => o.value === String(paramState?.value)) || paramDef.options[0];
              return opt?.defaultPrompt || '';
            }
            if (paramDef.type === 'text' || paramDef.type === 'textarea') {
              let prompt = paramDef.promptWhenEnabled || '';
              if (paramState?.value !== undefined && String(paramState.value).trim() !== '') {
                prompt = prompt.replace(/\{value\}/g, String(paramState.value));
              }
              return prompt;
            }
            if (paramState?.enabled && paramDef.promptWhenEnabled) {
              let prompt = paramDef.promptWhenEnabled;
              if (paramState.value !== undefined && paramState.value !== '') {
                prompt = prompt.replace(/\{value\}/g, String(paramState.value));
              }
              return prompt;
            }
            if (!paramState?.enabled && paramDef.promptWhenDisabled) return paramDef.promptWhenDisabled;
            return paramDef.promptWhenEnabled || '';
          }
          return localConfigs[miniPromptAIKey]?.customContent || '';
        })()}
        baselinePromptContent={(() => {
          if (!miniPromptAIKey) return '';
          if (miniPromptAIKey === 'param__booking_prompt') return mode === 'voice' ? DEFAULT_VOICE_BOOKING_PROMPT : DEFAULT_BOOKING_PROMPT;
          if (miniPromptAIKey.startsWith('param__')) {
            const rawParamKey = miniPromptAIKey.replace('param__', '');
            const paramKey = rawParamKey.replace(/__opt__.*$/, '');
            const optionValue = rawParamKey.match(/__opt__(.*)$/)?.[1];
            const allParams = [...R_IDENTITY, ...R_COMPANY, ...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS].flatMap((s) => s.params);
            const paramDef = allParams.find((p) => p.key === paramKey);
            const persistedState = persistedParamStatesRef.current[paramKey];
            if (optionValue && paramDef?.type === 'select') {
              const persistedOptionPrompt = persistedState?.optionPrompts?.[optionValue];
              if (persistedOptionPrompt?.trim()) return persistedOptionPrompt;
              const defaultOptionPrompt = paramDef.options?.find((opt) => opt.value === optionValue)?.defaultPrompt;
              return defaultOptionPrompt || '';
            }
            return resolveParamPromptContent(paramKey, persistedParamStatesRef.current);
          }
          return '';
        })()}
        onApplyPrompt={(newContent) => {
          if (miniPromptAIKey) {
            if (miniPromptAIKey === 'param__booking_prompt') {
              onAgentSettingsChange({ booking_prompt: newContent });
              const output = buildParentConfigOutput({});
              onConfigsChange(output);
              void onExplicitSave?.(output);
              toast({ title: 'Booking prompt saved', description: 'Booking prompt updated from AI modifications.' });
              return;
            }
            if (miniPromptAIKey === 'param__conversation_examples') {
              setConversationExamples(newContent);
              setExamplesApproved(false);
              const output = buildParentConfigOutput({
                conversationExamplesText: newContent,
                deployExamplesSelected: '',
                deployPromptSelected: '',
              });
              onConfigsChange(output);
              void onExplicitSave?.(output);
              toast({ title: 'Examples updated', description: 'Conversation examples updated from AI modifications.' });
              return;
            }
            if (miniPromptAIKey.startsWith('param__')) {
              const rawParamKey = miniPromptAIKey.replace('param__', '');
              const paramKey = rawParamKey.replace(/__opt__.*$/, '');
              const allParams = [...R_IDENTITY, ...R_COMPANY, ...R_TONE_STYLE, ...R_STRATEGY, ...R_GUARDRAILS].flatMap((s) => s.params);
              const paramDef = allParams.find((p) => p.key === paramKey);
              const existingState = paramDef
                ? (paramStates[paramKey] || { enabled: paramDef.defaultEnabled || false, value: paramDef.defaultValue })
                : (paramStates[paramKey] || { enabled: false });
              const updatedOptionPrompts = paramDef?.type === 'select' && existingState.value
                ? { ...(existingState.optionPrompts || {}), [String(existingState.value)]: newContent }
                : existingState.optionPrompts;
              const newState = {
                ...existingState,
                customPrompt: newContent,
                optionPrompts: updatedOptionPrompts,
              };
              const nextParamStates = { ...latestParamStatesRef.current, [paramKey]: newState };
              handleParamChange(paramKey, newState);
              void saveParamStateToDB(paramKey, newState);
              // This is an explicit AI approval, so advance the persisted baseline immediately.
              persistedParamStatesRef.current = {
                ...persistedParamStatesRef.current,
                [paramKey]: newState,
              };
              // Clear dirty state so Save Mini Prompt button deactivates
              setDirtyParamKeys((prev) => {
                const next = new Set(prev);
                next.delete(paramKey);
                return next;
              });
              const output = buildParentConfigOutput({
                paramStateMap: nextParamStates,
                deployPromptSelected: '',
              });
              onConfigsChange(output);
              void onExplicitSave?.(output);
              toast({ title: 'Prompt saved', description: 'Mini-prompt updated from AI modifications.' });
              return;
            }
            handleContentEdit(miniPromptAIKey, newContent);
            const updated = { ...localConfigs, [miniPromptAIKey]: { ...localConfigs[miniPromptAIKey], customContent: newContent } };
            const output = buildParentConfigOutput({ configMap: updated, deployPromptSelected: '' });
            onConfigsChange(output);
            void onExplicitSave?.(output);
            setDirtyKeys(new Set());
            toast({ title: 'Prompt saved', description: 'Mini-prompt updated from AI modifications.' });
          }
        }}
        clientId={clientId || ''}
        slotId={slotId || ''}
        configKey={miniPromptAIKey || ''}
        disabled={disabled}
        initialDirty={(() => {
          if (!miniPromptAIKey) return false;
          if (miniPromptAIKey.startsWith('param__')) {
            const rawParamKey = miniPromptAIKey.replace('param__', '');
            const paramKey = rawParamKey.replace(/__opt__.*$/, '');
            return dirtyParamKeys.has(paramKey);
          }
          return dirtyKeys.has(miniPromptAIKey);
        })()}
      />

      {/* Setter Prompt AI Dialog */}
      {clientId && slotId && (
        <SetterPromptAIDialog
          open={showSetterAIDialog}
          onOpenChange={setShowSetterAIDialog}
          clientId={clientId}
          slotId={slotId}
          onApplied={() => {
            // Reload param states from DB after AI changes applied
            (async () => {
              try {
                const { data } = await (supabase as any)
                  .from('prompt_configurations')
                  .select('config_key, selected_option, custom_content')
                  .eq('client_id', clientId)
                  .eq('slot_id', slotId)
                  .like('config_key', 'param_%');
                if (data && data.length > 0) {
                  const loaded: Record<string, any> = {};
                  for (const row of data) {
                    const paramKey = row.config_key.replace('param_', '');
                    try { loaded[paramKey] = JSON.parse(row.custom_content || '{}'); } catch {}
                  }
                  if (Object.keys(loaded).length > 0) {
                    setParamStates(loaded);
                    latestParamStatesRef.current = loaded;
                    persistedParamStatesRef.current = loaded;
                    const cacheKey = `param_states_${clientId}_${slotId}`;
                    try { localStorage.setItem(cacheKey, JSON.stringify(loaded)); } catch { /* quota exceeded */ }
                  }
                }
              } catch {}
            })();
          }}
        />
      )}
    </div>
  );
};
