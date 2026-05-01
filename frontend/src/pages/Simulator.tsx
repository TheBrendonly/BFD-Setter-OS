import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getCached, setCache, isFresh } from '@/lib/queryCache';
import RetroLoader from '@/components/RetroLoader';
import SavingOverlay from '@/components/SavingOverlay';
import { getICPCompletion } from '@/components/simulator/ICPArcadeSelector';
import { useParams } from 'react-router-dom';
import { useGenerationGuard } from '@/hooks/useGenerationGuard';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Pencil, ChevronLeft, ChevronRight, RefreshCw, X, Play, Sparkles, Square, MessageSquare } from '@/components/icons';
import { StatusTag } from '@/components/StatusTag';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useNavigationGuard } from '@/contexts/NavigationGuardContext';
import { SimulatorConfigForm, ExtendedConfig, parseExtendedConfig, serializeExtendedConfig, DEFAULT_EXTENDED_CONFIG } from '@/components/simulator/SimulatorConfigForm';
import { SimulationAnalysisDialog } from '@/components/simulator/SimulationAnalysisDialog';
import { SimulationReportDialog } from '@/components/simulator/SimulationReportDialog';
import { SimulationSetupFlow, DEFAULT_ICP } from '@/components/simulator/SimulationSetupFlow';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import type { ICPProfile } from '@/components/simulator/ICPNodeGraph';
import { useClientCredentials } from '@/hooks/useClientCredentials';

interface Simulation {
  id: string;
  client_id: string;
  name: string | null;
  agent_number: number;
  status: string;
  business_info: string | null;
  test_goal: string | null;
  test_specifics: string | null;
  num_conversations: number;
  min_messages: number;
  max_messages: number;
  created_at: string;
}

interface Persona {
  id: string;
  simulation_id: string;
  icp_profile_id?: string | null;
  name: string;
  age: number | null;
  gender: string | null;
  occupation: string | null;
  problem: string | null;
  hobbies: string | null;
  goal: string | null;
  avatar_seed: string | null;
  assigned_message_count: number;
  status: string;
  dummy_email?: string | null;
  dummy_phone?: string | null;
  booking_intent?: string | null;
  preferred_booking_date?: string | null;
}

interface IcpProfileInfo {
  id: string;
  name: string;
  sort_order: number;
}

// Parse hobbies: handle JSON arrays, strings, etc.
function formatHobbies(hobbies: string | null): string {
  if (!hobbies) return '';
  try {
    const parsed = JSON.parse(hobbies);
    if (Array.isArray(parsed)) return parsed.join(', ');
  } catch {}
  return hobbies;
}

// Extract clean goal, style, and booking from goal field
function parseGoalField(goal: string | null): { cleanGoal: string; style: string | null; booking: string | null } {
  if (!goal) return { cleanGoal: '', style: null, booking: null };
  let cleanGoal = goal;
  let style: string | null = null;
  let booking: string | null = null;

  // Extract "| Style: xxx" 
  const styleMatch = goal.match(/\|\s*Style:\s*([^|]+)/);
  if (styleMatch) {
    style = styleMatch[1].trim();
    cleanGoal = cleanGoal.replace(styleMatch[0], '');
  }

  // Extract "| Booking: xxx"
  const bookingMatch = goal.match(/\|\s*Booking:\s*([^|]+)/);
  if (bookingMatch) {
    booking = bookingMatch[1].trim();
    cleanGoal = cleanGoal.replace(bookingMatch[0], '');
  }

  return { cleanGoal: cleanGoal.trim(), style, booking };
}

interface SimMessage {
  id: string;
  persona_id: string;
  role: string;
  content: string | null;
  message_order: number;
  message_type?: string | null;
  created_at: string;
}

type Step = 'list' | 'config' | 'personas' | 'running' | 'results';

const SETTER_OPTIONS = [
  { value: '1', label: 'Setter 1' },
  { value: '2', label: 'Setter 2' },
  { value: '3', label: 'Setter 3' },
  { value: '4', label: 'Setter 4' },
  { value: '5', label: 'Setter 5' },
  { value: '6', label: 'Setter 6' },
  { value: '7', label: 'Setter 7' },
  { value: '8', label: 'Setter 8' },
  { value: '9', label: 'Setter 9' },
  { value: '10', label: 'Setter 10' },
  { value: '11', label: 'Follow-up Setter' },
];

// Pixel avatar generator - creates an 8-bit style avatar from a seed
function PixelAvatar({ seed, size = 48 }: { seed: string; size?: number }) {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F1948A', '#82E0AA'];
  const hash = seed.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const color = colors[Math.abs(hash) % colors.length];
  const bgColor = colors[Math.abs(hash * 7) % colors.length];
  
  const pixels: boolean[][] = [];
  for (let y = 0; y < 5; y++) {
    pixels[y] = [];
    for (let x = 0; x < 3; x++) {
      const val = ((hash * (y * 3 + x + 1) * 13) >> 4) & 1;
      pixels[y][x] = val === 1;
    }
    pixels[y][3] = pixels[y][1];
    pixels[y][4] = pixels[y][0];
  }

  const pixelSize = size / 7;
  
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded" style={{ imageRendering: 'pixelated' }}>
      <rect width={size} height={size} fill={bgColor} opacity="0.3" rx="4" />
      {pixels.map((row, y) =>
        row.map((filled, x) =>
          filled ? (
            <rect
              key={`${x}-${y}`}
              x={(x + 1) * pixelSize}
              y={(y + 1) * pixelSize}
              width={pixelSize}
              height={pixelSize}
              fill={color}
            />
          ) : null
        )
      )}
    </svg>
  );
}

const WAITING_MESSAGES = [
  "Generating response...", "Waiting for the agent to reply...", "Processing conversation...",
  "Thinking of the best response...", "Agent is typing...", "Crafting a thoughtful reply...",
  "Almost there...", "Simulating realistic interaction...", "Building conversation context...",
  "Analyzing the best approach...", "Running through scenarios...", "Preparing the next message...",
  "Agent is working on it...", "Hold tight, response incoming...", "Fine-tuning the reply...",
  "Evaluating conversation flow...", "Composing a natural response...", "Processing your inquiry...",
  "Engaging the setter...", "Fetching agent response...", "Simulating human-like delay...",
  "Interpreting persona context...", "Working through objections...", "Calculating optimal response...",
  "Loading conversation data...", "Agent is reviewing the message...", "Preparing follow-up...",
  "Matching communication style...", "Running behavioral analysis...", "Generating authentic reply...",
  "Checking response quality...", "Aligning with persona goals...", "Crafting the perfect answer...",
  "Simulating real-world timing...", "Building rapport...", "Processing business context...",
  "Evaluating lead knowledge...", "Setter is composing a reply...", "Analyzing conversation history...",
  "Working on it...", "Preparing a personalized response...", "Running through the playbook...",
  "Matching tone and style...", "Generating contextual reply...", "Agent is considering options...",
  "Formulating the best approach...", "Building on previous messages...", "Simulating natural conversation...",
  "Processing scenario items...", "Checking for booking intent...", "Response generation in progress...",
  "Setter is reviewing context...", "Almost ready...", "Preparing intelligent response...",
  "Engaging conversation engine...", "Running simulation logic...", "Interpreting lead signals...",
  "Generating next turn...", "Processing webhook response...", "Waiting for webhook callback...",
  "Agent response incoming...", "Simulating realistic timing...", "Preparing conversation turn...",
  "Analyzing message patterns...", "Building conversation thread...", "Setter is formulating reply...",
  "Processing persona behavior...", "Generating follow-up message...", "Working through the conversation...",
  "Agent is preparing a response...", "Evaluating best next step...", "Simulating agent behavior...",
  "Processing lead information...", "Crafting contextual message...", "Generating AI-powered response...",
  "Setter engine is running...", "Building personalized reply...", "Analyzing prospect needs...",
  "Running conversation simulation...", "Preparing agent response...", "Processing turn data...",
  "Generating natural dialogue...", "Agent is working through this...", "Simulating conversation dynamics...",
  "Preparing the next exchange...", "Loading response data...", "Crafting an engaging reply...",
  "Running through the scenario...", "Evaluating conversation context...", "Building the next message...",
  "Setter is thinking...", "Processing simulation data...", "Generating realistic response...",
  "Working on the next turn...", "Agent is analyzing the situation...", "Preparing conversation flow...",
  "Simulating agent thinking...", "Crafting the next response...", "Processing interaction data...",
  "Generating conversation turn...", "Setter is composing...",
];

function WaitingMessageIndicator() {
  const [msgIndex, setMsgIndex] = React.useState(() => Math.floor(Math.random() * WAITING_MESSAGES.length));

  React.useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(prev => {
        let next = prev;
        while (next === prev) next = Math.floor(Math.random() * WAITING_MESSAGES.length);
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const pixelIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ imageRendering: 'pixelated' }}>
      <rect x="2" y="1" width="12" height="2" fill="currentColor" />
      <rect x="4" y="3" width="8" height="2" fill="currentColor" opacity="0.7" />
      <rect x="6" y="5" width="4" height="2" fill="currentColor" opacity="0.5" />
      <rect x="7" y="7" width="2" height="2" fill="currentColor" />
      <rect x="6" y="9" width="4" height="2" fill="currentColor" opacity="0.5" />
      <rect x="4" y="11" width="8" height="2" fill="currentColor" opacity="0.7" />
      <rect x="2" y="13" width="12" height="2" fill="currentColor" />
    </svg>
  );

  return (
    <div className="flex items-center justify-center gap-2 py-3 text-muted-foreground animate-pulse">
      {pixelIcon}
      <span className="field-text">{WAITING_MESSAGES[msgIndex]}</span>
    </div>
  );
}

function getSetterLabel(num: number, customNames?: Record<string, string> | null): string {
  const custom = customNames?.[`text-${num}`]?.trim();
  if (custom) return custom;
  const found = SETTER_OPTIONS.find(s => s.value === String(num));
  return found?.label || `Setter ${num}`;
}

// parseExtendedConfig and serializeExtendedConfig are now imported from SimulatorConfigForm

export default function Simulator() {
  const { clientId } = useParams();
  const { registerGuard, unregisterGuard } = useNavigationGuard();
  const { credentials } = useClientCredentials(clientId);
  const setterDisplayNames = (credentials?.setter_display_names || {}) as Record<string, string>;

  const [step, setStep] = useState<Step>('list');
  const [cameFromPersonas, setCameFromPersonas] = useState(false);
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [currentSimulation, setCurrentSimulation] = useState<Simulation | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [icpProfileInfos, setIcpProfileInfos] = useState<IcpProfileInfo[]>([]);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [generatingPersonas, setGeneratingPersonas] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);

  // Config form state
  const [simulationName, setSimulationName] = useState('');
  const [agentNumber, setAgentNumber] = useState('1');
  const [businessInfo, setBusinessInfo] = useState('');
  
  // Personas per simulation for list view avatars
  const [listPersonasMap, setListPersonasMap] = useState<Record<string, Persona[]>>({});
  const [listPage, setListPage] = useState(0);
  const [listPageSize, setListPageSize] = useState(50);
  const [extConfig, setExtConfig] = useState<ExtendedConfig>({ ...DEFAULT_EXTENDED_CONFIG });
  const [newScenarioItem, setNewScenarioItem] = useState('');
  const [numConversations, setNumConversations] = useState(5);
  const [icpProfiles, setIcpProfiles] = useState<ICPProfile[]>([]);
  const [freeInput, setFreeInput] = useState('');
  const [isGeneratingConfig, setIsGeneratingConfig] = useState(false);
  const [minMessages, setMinMessages] = useState(3);
  const [maxMessages, setMaxMessages] = useState(10);

  // Edit persona dialog
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [editForm, setEditForm] = useState({ name: '', age: '', gender: '', occupation: '', problem: '', hobbies: '', goal: '' });
  const [personaDetailsOpen, setPersonaDetailsOpen] = useState(false);
  const selectedPersonaIdRef = useRef<string | null>(null);

  // Edit simulation name dialog
  const [editingSimName, setEditingSimName] = useState<{ id: string; name: string } | null>(null);

  // Analysis dialog state
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [waitingDialogOpen, setWaitingDialogOpen] = useState(false);

  // Unsaved changes guard for config step
  const [configDirty, setConfigDirty] = useState(false);
  const [unsavedExitAction, setUnsavedExitAction] = useState<(() => void) | null>(null);

  const markConfigDirty = useCallback(() => {
    if (step === 'config') setConfigDirty(true);
  }, [step]);

  const setIcpProfilesTracked = useCallback((profiles: ICPProfile[] | ((prev: ICPProfile[]) => ICPProfile[])) => {
    setIcpProfiles(profiles);
    markConfigDirty();
  }, [markConfigDirty]);

  const setSimulationNameTracked = useCallback((v: string) => {
    setSimulationName(v);
    markConfigDirty();
  }, [markConfigDirty]);

  const setBusinessInfoTracked = useCallback((v: string) => {
    setBusinessInfo(v);
    markConfigDirty();
  }, [markConfigDirty]);

  const setFreeInputTracked = useCallback((v: string) => {
    setFreeInput(v);
    markConfigDirty();
  }, [markConfigDirty]);

  const setAgentNumberTracked = useCallback((v: string) => {
    setAgentNumber(v);
    markConfigDirty();
  }, [markConfigDirty]);

  const setMinMessagesTracked = useCallback((n: number) => {
    setMinMessages(n);
    markConfigDirty();
  }, [markConfigDirty]);

  const setMaxMessagesTracked = useCallback((n: number) => {
    setMaxMessages(n);
    markConfigDirty();
  }, [markConfigDirty]);

  const [showGenerateExitWarning, setShowGenerateExitWarning] = useState(false);
  const [pendingExitAction, setPendingExitAction] = useState<(() => void) | null>(null);
  const [pendingDeleteSimId, setPendingDeleteSimId] = useState<string | null>(null);
  const [pendingDeleteSimName, setPendingDeleteSimName] = useState<string>('');

  const guardedConfigExit = useCallback((action: () => void) => {
    if (isGeneratingConfig) {
      setPendingExitAction(() => action);
      setShowGenerateExitWarning(true);
    } else if (configDirty) {
      setUnsavedExitAction(() => action);
    } else {
      action();
    }
  }, [configDirty, isGeneratingConfig]);

  useEffect(() => {
    const shouldGuardNavigation = step === 'config' && (configDirty || isGeneratingConfig);

    if (!shouldGuardNavigation) {
      unregisterGuard();
      return;
    }

    registerGuard((proceed) => {
      guardedConfigExit(proceed);
      return true;
    });

    return () => unregisterGuard();
  }, [step, configDirty, isGeneratingConfig, guardedConfigExit, registerGuard, unregisterGuard]);

  // Browser beforeunload guard for config dirty
  useEffect(() => {
    if (step === 'config' && configDirty) {
      const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, [step, configDirty]);

  // Navigation guard during LLM generation
  const isAnyGenerationActive = isGeneratingConfig || generatingPersonas;
  useGenerationGuard(isAnyGenerationActive);

  const simulationDraftPayload = React.useMemo(() => {
    const normalizedAgentNumber = Number.parseInt(agentNumber, 10) || 1;
    // Total persona count across all ICPs
    const totalPersonas = icpProfiles.length > 0
      ? icpProfiles.reduce((sum, icp) => sum + (icp.persona_count || 3), 0)
      : Math.min(20, Math.max(1, numConversations));
    const normalizedMinMessages = Math.min(30, Math.max(2, minMessages));
    const normalizedMaxMessages = Math.min(30, Math.max(normalizedMinMessages, maxMessages));

    return {
      name: simulationName || null,
      agent_number: normalizedAgentNumber,
      business_info: businessInfo,
      test_goal: extConfig.trigger ? 'custom' : 'nurturing',
      test_specifics: serializeExtendedConfig(extConfig),
      num_conversations: totalPersonas,
      min_messages: normalizedMinMessages,
      max_messages: normalizedMaxMessages,
    };
  }, [simulationName, agentNumber, businessInfo, extConfig, numConversations, minMessages, maxMessages, icpProfiles]);

  // ── Debounced auto-save for simulation fields ──
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPayloadRef = useRef<string>('');

  useEffect(() => {
    if (!currentSimulation || step !== 'config') return;
    const payload = {
      ...simulationDraftPayload,
      free_input: freeInput || null,
    };
    const payloadStr = JSON.stringify(payload);
    if (payloadStr === lastSavedPayloadRef.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await (supabase as any)
          .from('simulations')
          .update(payload)
          .eq('id', currentSimulation.id);
        lastSavedPayloadRef.current = payloadStr;
        setConfigDirty(false);
      } catch (err) {
        console.error('Auto-save simulation failed:', err);
      }
    }, 800);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [simulationDraftPayload, freeInput, currentSimulation, step]);

  // Fetch simulations list + their personas for avatar display
  const fetchSimulations = useCallback(async (forceRefresh = false) => {
    if (!clientId) return;
    const cacheKey = `simulations_${clientId}`;
    type SimCache = { sims: Simulation[]; personas: Record<string, Persona[]> };
    
    if (!forceRefresh) {
      const cached = getCached<SimCache>(cacheKey);
      if (cached) {
        setSimulations(cached.sims);
        setListPersonasMap(cached.personas);
        if (isFresh(cacheKey)) return;
      }
    }

    const { data } = await (supabase as any)
      .from('simulations')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    const sims = (data || []) as Simulation[];
    
    // Self-heal: fix simulations stuck in 'draft' or 'processing' that actually have real ICP profiles
    const stuckSims = sims.filter(s => s.status === 'draft' || s.status === 'processing');
    if (stuckSims.length > 0) {
      const stuckIds = stuckSims.map(s => s.id);
      const { data: profileCheck } = await (supabase as any)
        .from('simulation_icp_profiles')
        .select('simulation_id, description, location, concerns')
        .in('simulation_id', stuckIds);
      
      const simsWithRealProfiles = new Set<string>();
      (profileCheck || []).forEach((p: any) => {
        if (p.description || p.location || p.concerns) {
          simsWithRealProfiles.add(p.simulation_id);
        }
      });

      for (const simId of simsWithRealProfiles) {
        await (supabase as any).from('simulations').update({ status: 'configuration_ready', updated_at: new Date().toISOString() }).eq('id', simId);
      }

      if (simsWithRealProfiles.size > 0) {
        for (let i = 0; i < sims.length; i++) {
          if (simsWithRealProfiles.has(sims[i].id)) {
            sims[i] = { ...sims[i], status: 'configuration_ready' };
          }
        }
      }
    }

    setSimulations(sims);
    
    let grouped: Record<string, Persona[]> = {};
    if (sims.length > 0) {
      const simIds = sims.map(s => s.id);
      const { data: allPersonas } = await (supabase as any)
        .from('simulation_personas')
        .select('id, simulation_id, name, avatar_seed')
        .in('simulation_id', simIds);
      (allPersonas || []).forEach((p: any) => {
        if (!grouped[p.simulation_id]) grouped[p.simulation_id] = [];
        grouped[p.simulation_id].push(p);
      });
      setListPersonasMap(grouped);
    }

    setCache(cacheKey, { sims, personas: grouped });
  }, [clientId]);

  const fetchPersonas = useCallback(async (simId: string): Promise<Persona[]> => {
    const [{ data }, { data: icpData }] = await Promise.all([
      (supabase as any)
        .from('simulation_personas')
        .select('*')
        .eq('simulation_id', simId)
        .order('created_at', { ascending: true }),
      (supabase as any)
        .from('simulation_icp_profiles')
        .select('id, name, sort_order')
        .eq('simulation_id', simId)
        .order('sort_order', { ascending: true }),
    ]);
    const personaRows = (data || []) as Persona[];
    setPersonas(personaRows);
    setIcpProfileInfos((icpData || []) as IcpProfileInfo[]);
    return personaRows;
  }, []);

  const fetchMessages = useCallback(async (personaId: string, onlyIfStillSelected = false) => {
    const { data } = await (supabase as any)
      .from('simulation_messages')
      .select('*')
      .eq('persona_id', personaId)
      .order('message_order', { ascending: true });

    if (onlyIfStillSelected && selectedPersonaIdRef.current !== personaId) {
      return;
    }

    setMessages(data || []);
  }, []);

  useEffect(() => {
    selectedPersonaIdRef.current = selectedPersona?.id || null;
  }, [selectedPersona]);

  useEffect(() => { fetchSimulations().finally(() => setInitialLoading(false)); }, [fetchSimulations]);

  // Realtime subscription to keep simulation statuses up-to-date in the list
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`sim-list-status-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'simulations',
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated?.id && updated?.status) {
            setSimulations(prev =>
              prev.map(s => s.id === updated.id ? { ...s, status: updated.status, name: updated.name ?? s.name } : s)
            );
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId]);


  // Polling for simulation progress
  useEffect(() => {
    if (!pollingActive || !currentSimulation) return;

    const tick = async () => {
      const latestPersonas = await fetchPersonas(currentSimulation.id);

      const selectedId = selectedPersonaIdRef.current;
      if (selectedId) {
        const freshPersona = latestPersonas.find(p => p.id === selectedId);
        if (freshPersona && selectedPersonaIdRef.current === selectedId) {
          setSelectedPersona(freshPersona);
          if (freshPersona.status !== 'pending') {
            await fetchMessages(freshPersona.id, true);
          } else {
            setMessages([]);
          }
        }
      }

      const { data: sim } = await (supabase as any)
        .from('simulations')
        .select('status')
        .eq('id', currentSimulation.id)
        .single();

      if (sim?.status === 'complete' || sim?.status === 'error' || sim?.status === 'ended') {
        setPollingActive(false);
        setCurrentSimulation(prev => prev ? { ...prev, status: sim.status } : null);

        if (selectedId) {
          await fetchMessages(selectedId, true);
        }

        if (sim.status === 'complete') {
          toast.success('Simulation complete!');
        } else {
          toast.error('Simulation finished with errors');
        }
        setStep('results');
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 5000);

    return () => clearInterval(interval);
  }, [pollingActive, currentSimulation, fetchPersonas, fetchMessages]);

  const handleStartNewSimulation = useCallback(async () => {
    if (!clientId) return;
    const defaultName = `Simulation ${new Date().toLocaleDateString()}`;
    setSimulationName(defaultName);
    setAgentNumber('1');
    setBusinessInfo('');
    setExtConfig({ ...DEFAULT_EXTENDED_CONFIG });
    setNewScenarioItem('');
    setNumConversations(5);
    setMinMessages(3);
    setMaxMessages(10);
    setIcpProfiles([]);
    setFreeInput('');
    setIsGeneratingConfig(false);
    setPersonas([]);
    setMessages([]);
    setSelectedPersona(null);
    selectedPersonaIdRef.current = null;
    setPollingActive(false);

    // Immediately create simulation in DB
    try {
      const { data, error } = await (supabase as any)
        .from('simulations')
        .insert({
          client_id: clientId,
          name: defaultName,
          agent_number: 1,
          status: 'draft',
          num_conversations: 5,
          min_messages: 3,
          max_messages: 10,
        })
        .select()
        .single();
      if (error) throw error;
      setCurrentSimulation(data as Simulation);
      setStep('config');
    } catch (err: any) {
      console.error('Failed to create simulation:', err);
      toast.error('Failed to create simulation');
    }
  }, [clientId]);

  const persistSimulationConfiguration = useCallback(async ({
    profiles,
    status = 'configuration_ready',
    name = simulationName || null,
    business = businessInfo,
    min = minMessages,
    max = maxMessages,
    targetSimulationId,
  }: {
    profiles: ICPProfile[];
    status?: string;
    name?: string | null;
    business?: string;
    min?: number;
    max?: number;
    targetSimulationId?: string;
  }) => {
    if (!clientId) throw new Error('Missing client ID');

    const simId = targetSimulationId || currentSimulation?.id;
    if (!simId) throw new Error('No simulation ID to update');

    const normalizedAgentNumber = Number.parseInt(agentNumber, 10) || 1;
    const totalPersonas = profiles.reduce((sum, icp) => sum + (icp.persona_count || 3), 0);

    const simulationPayload = {
      name,
      agent_number: normalizedAgentNumber,
      business_info: business,
      num_conversations: totalPersonas,
      min_messages: min,
      max_messages: max,
      status,
    };

    const { data, error } = await (supabase as any)
      .from('simulations')
      .update(simulationPayload)
      .eq('id', simId)
      .select()
      .single();

    if (error) throw error;
    const simulationRow = data as Simulation;

    const icpRows = profiles.map((icp, index) => ({
      simulation_id: simulationRow.id,
      name: icp.name || `ICP ${index + 1}`,
      description: icp.description || null,
      persona_count: icp.persona_count || 3,
      age_min: icp.age_min ?? 18,
      age_max: icp.age_max ?? 65,
      gender: icp.gender || 'any',
      location: icp.location || '',
      behaviors: icp.behaviors || [],
      first_message_sender: icp.first_message_sender || 'inbound',
      first_message_detail: icp.first_message_detail || '',
      form_fields: icp.form_fields || '',
      outreach_message: icp.outreach_message || '',
      lead_trigger: icp.lead_trigger || '',
      lead_knowledge: icp.lead_knowledge || '',
      concerns: icp.concerns || '',
      scenario_items: icp.scenario_items || [],
      test_booking: icp.test_booking || false,
      test_cancellation: icp.test_cancellation || false,
      test_reschedule: icp.test_reschedule || false,
      booking_count: icp.booking_count || 0,
      cancel_reschedule_count: icp.cancel_reschedule_count || 0,
      sort_order: index,
    }));

    const { error: deleteError } = await (supabase as any)
      .from('simulation_icp_profiles')
      .delete()
      .eq('simulation_id', simulationRow.id);

    if (deleteError) throw deleteError;

    if (icpRows.length > 0) {
      const { error: insertError } = await (supabase as any)
        .from('simulation_icp_profiles')
        .insert(icpRows);

      if (insertError) throw insertError;
    }

    setCurrentSimulation(simulationRow);
    setSimulations(prev => {
      const existingIndex = prev.findIndex(sim => sim.id === simulationRow.id);

      if (existingIndex === -1) {
        return [simulationRow, ...prev];
      }

      const next = [...prev];
      next[existingIndex] = simulationRow;
      return next;
    });

    return simulationRow;
  }, [clientId, agentNumber, currentSimulation, simulationName, businessInfo, minMessages, maxMessages]);

  // Save simulation to DB immediately when AI config is generated
  const handleConfigGenerated = useCallback(async (profiles: ICPProfile[], config: any) => {
    if (!clientId) return;
    try {
      const name = config.simulation_name || simulationName || null;
      const biz = config.business_info || businessInfo;
      const minMsg = config.min_messages || minMessages;
      const maxMsg = config.max_messages || maxMessages;

      const simulationRow = await persistSimulationConfiguration({
        profiles,
        name,
        business: biz,
        min: minMsg,
        max: maxMsg,
      });

      console.log('Simulation saved immediately:', simulationRow.id);
    } catch (err: any) {
      console.error('Failed to save simulation on config generation:', err);
      toast.error('Failed to save simulation');
    }
  }, [clientId, simulationName, businessInfo, minMessages, maxMessages, persistSimulationConfiguration]);

  const handleManualConfigInitialized = useCallback(async (profiles: ICPProfile[]) => {
    await persistSimulationConfiguration({ profiles });
  }, [persistSimulationConfiguration]);

  // Generate personas — iterates over ICP profiles and creates personas per ICP
  const handleGeneratePersonas = useCallback(async () => {
    if (!clientId) return;

    setGeneratingPersonas(true);
    try {
      let simulationRow: Simulation;

      if (currentSimulation) {
        const { data, error } = await (supabase as any)
          .from('simulations')
          .update(simulationDraftPayload)
          .eq('id', currentSimulation.id)
          .select()
          .single();

        if (error) throw error;
        simulationRow = data as Simulation;
      } else {
        const { data, error } = await (supabase as any)
          .from('simulations')
          .insert({
            client_id: clientId,
            ...simulationDraftPayload,
            status: 'draft',
          })
          .select()
          .single();

        if (error) throw error;
        simulationRow = data as Simulation;
      }

      setCurrentSimulation(simulationRow);

      // Delete existing ICP profiles for this simulation (in case of regeneration)
      await (supabase as any)
        .from('simulation_icp_profiles')
        .delete()
        .eq('simulation_id', simulationRow.id);

      // Delete existing personas too (regeneration)
      await (supabase as any)
        .from('simulation_personas')
        .delete()
        .eq('simulation_id', simulationRow.id);

      // Use ICP profiles if available, otherwise fallback to legacy single-ICP flow
      const profiles = icpProfiles.length > 0 ? icpProfiles : [{
        ...({} as ICPProfile),
        name: 'Default',
        description: '',
        persona_count: simulationDraftPayload.num_conversations,
        age_min: 18,
        age_max: 65,
        gender: 'any' as const,
        location: '',
        behaviors: ['friendly', 'skeptical', 'inquisitive'],
        lead_trigger: '',
        lead_knowledge: '',
        concerns: '',
        scenario_items: [],
        test_booking: false,
        test_cancellation: false,
        test_reschedule: false,
        booking_count: 0,
        cancel_reschedule_count: 0,
        sort_order: 0,
      }];

      let totalGenerated = 0;

      for (const [i, icp] of profiles.entries()) {
        // Insert ICP profile into DB
        const { data: icpRow, error: icpErr } = await (supabase as any)
          .from('simulation_icp_profiles')
          .insert({
            simulation_id: simulationRow.id,
            name: icp.name || `ICP ${i + 1}`,
            description: icp.description || '',
            persona_count: icp.persona_count || 3,
            age_min: icp.age_min ?? 18,
            age_max: icp.age_max ?? 65,
            gender: icp.gender || 'any',
            location: icp.location || '',
            behaviors: icp.behaviors || [],
            first_message_sender: icp.first_message_sender || 'inbound',
            first_message_detail: icp.first_message_detail || '',
            form_fields: icp.form_fields || '',
            outreach_message: icp.outreach_message || '',
            lead_trigger: icp.lead_trigger || '',
            lead_knowledge: icp.lead_knowledge || '',
            concerns: icp.concerns || '',
            scenario_items: icp.scenario_items || [],
            test_booking: icp.test_booking || false,
            test_cancellation: icp.test_cancellation || false,
            test_reschedule: icp.test_reschedule || false,
            booking_count: icp.booking_count || 0,
            cancel_reschedule_count: icp.cancel_reschedule_count || 0,
            sort_order: i,
          })
          .select()
          .single();

        if (icpErr) {
          console.error('Failed to insert ICP profile:', icpErr);
          throw icpErr;
        }

        // Build test specifics for this ICP
        const richTestSpecifics = [
          icp.first_message_sender && `First Message Sender: ${icp.first_message_sender}`,
          icp.first_message_detail && `Entry Scenario: ${icp.first_message_detail}`,
          icp.form_fields && `Form Fields: ${icp.form_fields}`,
          icp.outreach_message && `Outreach Message: ${icp.outreach_message}`,
          icp.lead_trigger && `Lead Trigger: ${icp.lead_trigger}`,
          icp.lead_knowledge && `What the lead knows: ${icp.lead_knowledge}`,
          icp.concerns && `Concerns: ${icp.concerns}`,
          icp.scenario_items.length > 0 && `Scenarios to test:\n${icp.scenario_items.map((s: string, idx: number) => `${idx + 1}. ${s}`).join('\n')}`,
        ].filter(Boolean).join('\n\n');

        console.info(`[Simulator] generating personas for ICP "${icp.name}" (${icp.persona_count} personas)`);

        const { error } = await supabase.functions.invoke('generate-simulation-personas', {
          body: {
            simulationId: simulationRow.id,
            icpProfileId: icpRow.id,
            businessInfo: simulationDraftPayload.business_info,
            testGoal: getSetterLabel(simulationDraftPayload.agent_number, setterDisplayNames),
            testSpecifics: richTestSpecifics,
            numPersonas: icp.persona_count || 3,
            minMessages: icp.min_messages || simulationDraftPayload.min_messages,
            maxMessages: icp.max_messages || simulationDraftPayload.max_messages,
            ageMin: icp.age_min ?? 18,
            ageMax: icp.age_max ?? 65,
            gender: icp.gender || 'any',
            location: icp.location || '',
            behaviors: icp.behaviors || ['friendly', 'skeptical'],
            testBooking: icp.test_booking || false,
            testCancellation: icp.test_cancellation || false,
            testReschedule: icp.test_reschedule || false,
            bookingCount: icp.booking_count || 0,
            cancelRescheduleCount: icp.cancel_reschedule_count || 0,
            scenarioItems: icp.scenario_items || [],
          },
        });

        if (error) throw error;
        totalGenerated += (icp.persona_count || 3);
      }

      await fetchPersonas(simulationRow.id);
      setStep('personas');
      toast.success(`${totalGenerated} personas generated across ${profiles.length} ICP${profiles.length > 1 ? 's' : ''}!`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate personas');
    } finally {
      setGeneratingPersonas(false);
    }
  }, [clientId, currentSimulation, simulationDraftPayload, icpProfiles, fetchPersonas]);

  const handleLaunchSimulation = async () => {
    if (!currentSimulation) return;
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('run-simulation', {
        body: { simulationId: currentSimulation.id },
      });

      if (error) throw error;

      setCurrentSimulation(prev => prev ? { ...prev, status: 'running' } : null);
      setStep('running');
      setPollingActive(true);

      toast.success('Simulation launched!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to launch simulation');
    } finally {
      setLoading(false);
    }
  };

  // Resume config generation if simulation was left in 'processing' state
  const resumeConfigGeneration = useCallback(async (simId: string) => {
    try {
      // Check if this simulation already has REAL ICP profiles (with actual content, not just empty defaults)
      const { data: existingProfiles } = await (supabase as any)
        .from('simulation_icp_profiles')
        .select('id, description, location, concerns')
        .eq('simulation_id', simId)
        .limit(5);

      const hasRealProfiles = existingProfiles && existingProfiles.length > 0 &&
        existingProfiles.some((p: any) => p.description || p.location || p.concerns);

      if (hasRealProfiles) {
        // Real profiles already exist — just update status and skip re-application
        await (supabase as any).from('simulations').update({ status: 'configuration_ready' }).eq('id', simId);
        setCurrentSimulation(prev => prev ? { ...prev, status: 'configuration_ready' } : null);
        setSimulations(prev => prev.map(sim => sim.id === simId ? { ...sim, status: 'configuration_ready' } : sim));
        setIsGeneratingConfig(false);
        return;
      }

      const { data: job } = await (supabase as any)
        .from('ai_generation_jobs')
        .select('id, status, result, error_message, created_at')
        .eq('client_id', clientId)
        .eq('job_type', 'generate-simulation-config')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!job) {
        setIsGeneratingConfig(false);
        return;
      }

      const applyResult = async (config: any) => {
        if (config?.icps?.length > 0) {
          const profiles: ICPProfile[] = config.icps.map((icp: any, i: number) => ({
            ...DEFAULT_ICP,
            name: (icp.name || `ICP ${i + 1}`).substring(0, 20),
            description: icp.description || '',
            persona_count: icp.persona_count || 3,
            age_min: icp.age_min || 18,
            age_max: icp.age_max || 65,
            gender: icp.gender || 'any',
            location: icp.location || '',
            behaviors: icp.behaviors || ['friendly', 'skeptical'],
            first_message_sender: icp.first_message_sender || 'inbound',
            first_message_detail: icp.first_message_detail || '',
            lead_trigger: icp.lead_trigger || '',
            lead_knowledge: icp.lead_knowledge || '',
            concerns: icp.concerns || '',
            scenario_items: icp.scenario_items || [],
            test_booking: icp.test_booking || false,
            booking_count: icp.booking_count || 0,
            sort_order: i,
          }));
          setIcpProfiles(profiles);
          const newMin = config.min_messages || minMessages;
          const newMax = config.max_messages || maxMessages;
          if (config.min_messages) setMinMessages(newMin);
          if (config.max_messages) setMaxMessages(newMax);
          try {
            await persistSimulationConfiguration({
              profiles,
              status: 'configuration_ready',
              min: newMin,
              max: newMax,
              targetSimulationId: simId,
            });
          } catch (persistErr) {
            console.error('Failed to persist generated config:', persistErr);
          }
          setCurrentSimulation(prev => prev ? { ...prev, status: 'configuration_ready' } : null);
          setSimulations(prev => prev.map(sim => sim.id === simId ? { ...sim, status: 'configuration_ready' } : sim));
          toast.success(`${profiles.length} ICP profiles loaded from completed generation!`);
        }
      };

      if (job.status === 'completed' && job.result) {
        await applyResult(job.result);
        setIsGeneratingConfig(false);
      } else if (job.status === 'failed') {
        await (supabase as any).from('simulations').update({ status: 'draft' }).eq('id', simId);
        setCurrentSimulation(prev => prev ? { ...prev, status: 'draft' } : null);
        setSimulations(prev => prev.map(sim => sim.id === simId ? { ...sim, status: 'draft' } : sim));
        setIsGeneratingConfig(false);
        toast.error(job.error_message || 'Previous AI generation failed');
      } else if (job.status === 'pending' || job.status === 'running') {
        const createdAt = new Date(job.created_at).getTime();
        if (Date.now() - createdAt >= 600000) {
          setIsGeneratingConfig(false);
          return;
        }

        setIsGeneratingConfig(true);
        const pollInterval = setInterval(async () => {
          const { data: pollRow } = await (supabase as any)
            .from('ai_generation_jobs')
            .select('status, result, error_message')
            .eq('id', job.id)
            .single();
          if (pollRow?.status === 'completed' && pollRow.result) {
            clearInterval(pollInterval);
            setIsGeneratingConfig(false);
            await applyResult(pollRow.result);
          } else if (pollRow?.status === 'completed') {
            clearInterval(pollInterval);
            setIsGeneratingConfig(false);
          } else if (pollRow?.status === 'failed') {
            clearInterval(pollInterval);
            setIsGeneratingConfig(false);
            await (supabase as any).from('simulations').update({ status: 'draft' }).eq('id', simId);
            setCurrentSimulation(prev => prev ? { ...prev, status: 'draft' } : null);
            setSimulations(prev => prev.map(sim => sim.id === simId ? { ...sim, status: 'draft' } : sim));
            toast.error(pollRow.error_message || 'AI generation failed');
          }
        }, 3000);
      } else {
        setIsGeneratingConfig(false);
      }
    } catch (err) {
      console.error('Error resuming config generation:', err);
      setIsGeneratingConfig(false);
    }
  }, [clientId, minMessages, maxMessages, persistSimulationConfiguration]);

  // Realtime subscription for AI job completions — auto-update simulation status when config generation finishes in background
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`sim-ai-jobs-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_generation_jobs',
          filter: `client_id=eq.${clientId}`,
        },
        async (payload) => {
          const row = payload.new as any;
          if (!row || row.job_type !== 'generate-simulation-config') return;

          if (row.status === 'completed' || row.status === 'failed') {
            // Find the simulation(s) still in 'processing' for this client
            const { data: processingSims } = await (supabase as any)
              .from('simulations')
              .select('id')
              .eq('client_id', clientId)
              .eq('status', 'processing');

            const newStatus = row.status === 'completed' ? 'configuration_ready' : 'draft';

            for (const sim of (processingSims || [])) {
              await (supabase as any).from('simulations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', sim.id);
              setSimulations(prev => prev.map(s => s.id === sim.id ? { ...s, status: newStatus } : s));

              // If currently viewing this simulation, auto-apply the result
              if (row.status === 'completed' && currentSimulation?.id === sim.id && currentSimulation?.status === 'processing') {
                resumeConfigGeneration(sim.id);
              }
            }
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, currentSimulation?.id, currentSimulation?.status, resumeConfigGeneration]);

  const handleOpenSimulation = async (sim: Simulation) => {
    setConfigDirty(false);
    setUnsavedExitAction(null);
    setPendingExitAction(null);
    setShowGenerateExitWarning(false);
    setIsGeneratingConfig(sim.status === 'processing');
    setCurrentSimulation(sim);
    setSelectedPersona(null);
    selectedPersonaIdRef.current = null;
    setMessages([]);
    await fetchPersonas(sim.id);
    
    // Restore config
    setSimulationName(sim.name || '');
    setAgentNumber(String(sim.agent_number));
    setBusinessInfo(sim.business_info || '');
    setFreeInput((sim as any).free_input || '');
    const parsedConfig = parseExtendedConfig(sim.test_specifics);
    setExtConfig(parsedConfig);
    setNumConversations(sim.num_conversations);
    setMinMessages(sim.min_messages);
    setMaxMessages(sim.max_messages);
    lastSavedPayloadRef.current = JSON.stringify({
      name: sim.name || null,
      agent_number: sim.agent_number,
      business_info: sim.business_info || '',
      test_goal: sim.test_goal || (parsedConfig.trigger ? 'custom' : 'nurturing'),
      test_specifics: serializeExtendedConfig(parsedConfig),
      num_conversations: sim.num_conversations,
      min_messages: sim.min_messages,
      max_messages: sim.max_messages,
      free_input: (sim as any).free_input || null,
    });

    // Load ICP profiles from DB
    const { data: icpRows } = await (supabase as any)
      .from('simulation_icp_profiles')
      .select('*')
      .eq('simulation_id', sim.id)
      .order('sort_order', { ascending: true });
    
    if (icpRows && icpRows.length > 0) {
      const loadedProfiles: ICPProfile[] = icpRows.map((row: any) => ({
        id: row.id,
        name: row.name || '',
        description: row.description || '',
        persona_count: row.persona_count || 3,
        min_messages: row.min_messages || sim.min_messages || 3,
        max_messages: row.max_messages || sim.max_messages || 10,
        age_min: row.age_min || 18,
        age_max: row.age_max || 65,
        gender: row.gender || 'any',
        location: row.location || '',
        behaviors: row.behaviors || ['friendly', 'skeptical'],
        first_message_sender: row.first_message_sender || 'inbound',
        first_message_detail: row.first_message_detail || '',
        form_fields: row.form_fields || '',
        outreach_message: row.outreach_message || '',
        lead_trigger: row.lead_trigger || '',
        lead_knowledge: row.lead_knowledge || '',
        concerns: row.concerns || '',
        scenario_items: row.scenario_items || [],
        test_booking: row.test_booking || false,
        test_cancellation: row.test_cancellation || false,
        test_reschedule: row.test_reschedule || false,
        booking_count: row.booking_count || 0,
        cancel_reschedule_count: row.cancel_reschedule_count || 0,
        sort_order: row.sort_order || 0,
      }));
      setIcpProfiles(loadedProfiles);
    } else {
      setIcpProfiles([]);
    }

    if (sim.status === 'draft' || sim.status === 'configuration_ready' || sim.status === 'processing') {
      setStep('config');
      // Resume generation if still processing
      if (sim.status === 'processing') {
        resumeConfigGeneration(sim.id);
      }
    } else if (sim.status === 'personas_ready') {
      setStep('personas');
    } else if (sim.status === 'running') {
      setStep('running');
      setPollingActive(true);
    } else {
      setStep('results');
    }
  };

  const handleRestartSimulation = async () => {
    if (!currentSimulation) return;
    setLoading(true);
    try {
      const personaIds = personas.map(persona => persona.id);

      if (personaIds.length > 0) {
        await (supabase as any)
          .from('simulation_messages')
          .delete()
          .in('persona_id', personaIds);
      }

      await (supabase as any)
        .from('simulation_personas')
        .update({ status: 'pending' })
        .eq('simulation_id', currentSimulation.id);

      await (supabase as any)
        .from('simulations')
        .update({ status: 'personas_ready' })
        .eq('id', currentSimulation.id);

      await fetchPersonas(currentSimulation.id);
      setSelectedPersona(null);
      selectedPersonaIdRef.current = null;
      setMessages([]);

      const { error: relaunchError } = await supabase.functions.invoke('run-simulation', {
        body: { simulationId: currentSimulation.id },
      });

      if (relaunchError) throw relaunchError;

      setCurrentSimulation(prev => prev ? { ...prev, status: 'running' } : null);
      setStep('running');
      setPollingActive(true);

      toast.success('Simulation restarted!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to restart simulation');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSimulation = (simId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const sim = simulations.find(s => s.id === simId);
    setPendingDeleteSimName(sim?.name || 'Untitled Simulation');
    setPendingDeleteSimId(simId);
  };

  const confirmDeleteSimulation = async () => {
    if (!pendingDeleteSimId) return;
    const simId = pendingDeleteSimId;
    setPendingDeleteSimId(null);
    try {
      await (supabase as any).from('simulations').delete().eq('id', simId);
      if (currentSimulation?.id === simId) {
        handleBackToList();
      } else {
        await fetchSimulations();
      }
      toast.success('Simulation deleted');
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const handleSaveSimName = async () => {
    if (!editingSimName) return;
    try {
      await (supabase as any)
        .from('simulations')
        .update({ name: editingSimName.name || null })
        .eq('id', editingSimName.id);
      // Update local state
      if (currentSimulation?.id === editingSimName.id) {
        setCurrentSimulation(prev => prev ? { ...prev, name: editingSimName.name || null } : null);
        setSimulationName(editingSimName.name);
      }
      await fetchSimulations();
      setEditingSimName(null);
      toast.success('Simulation name updated');
    } catch (err) {
      toast.error('Failed to update name');
    }
  };

  const handleEditPersona = (persona: Persona) => {
    setEditingPersona(persona);
    setEditForm({
      name: persona.name,
      age: String(persona.age || ''),
      gender: persona.gender || '',
      occupation: persona.occupation || '',
      problem: persona.problem || '',
      hobbies: formatHobbies(persona.hobbies),
      goal: persona.goal || '',
    });
  };

  const handleSavePersona = async () => {
    if (!editingPersona) return;
    try {
      await (supabase as any)
        .from('simulation_personas')
        .update({
          name: editForm.name,
          age: parseInt(editForm.age) || null,
          gender: editForm.gender,
          occupation: editForm.occupation,
          problem: editForm.problem,
          hobbies: editForm.hobbies,
          goal: editForm.goal,
        })
        .eq('id', editingPersona.id);
      if (currentSimulation) await fetchPersonas(currentSimulation.id);
      setEditingPersona(null);
      toast.success('Persona updated');
    } catch (err) {
      toast.error('Failed to update persona');
    }
  };

  const [pendingDeletePersona, setPendingDeletePersona] = useState<{ id: string; name: string } | null>(null);

  const handleDeletePersona = async (personaId: string) => {
    try {
      await (supabase as any).from('simulation_personas').delete().eq('id', personaId);
      if (currentSimulation) await fetchPersonas(currentSimulation.id);
      toast.success('Persona removed');
    } catch (err) {
      toast.error('Failed to delete persona');
    }
  };

  const handleAddPersona = async () => {
    if (!currentSimulation) return;
    setEditingPersona({
      id: 'new',
      simulation_id: currentSimulation.id,
      name: '',
      age: null,
      gender: null,
      occupation: null,
      problem: null,
      hobbies: null,
      goal: null,
      avatar_seed: Math.random().toString(36).substring(2, 8),
      assigned_message_count: Math.floor((minMessages + maxMessages) / 2),
      status: 'pending',
    });
    setEditForm({ name: '', age: '', gender: '', occupation: '', problem: '', hobbies: '', goal: '' });
  };

  const handleSaveNewPersona = async () => {
    if (!currentSimulation) return;
    try {
      await (supabase as any).from('simulation_personas').insert({
        simulation_id: currentSimulation.id,
        name: editForm.name || 'Custom Persona',
        age: parseInt(editForm.age) || 30,
        gender: editForm.gender || 'male',
        occupation: editForm.occupation || 'Professional',
        problem: editForm.problem || 'General inquiry',
        hobbies: editForm.hobbies || 'Various',
        goal: editForm.goal || 'Test the setter',
        avatar_seed: Math.random().toString(36).substring(2, 8),
        assigned_message_count: Math.floor((minMessages + maxMessages) / 2),
        status: 'pending',
      });
      await fetchPersonas(currentSimulation.id);
      setEditingPersona(null);
      toast.success('Persona added');
    } catch (err) {
      toast.error('Failed to add persona');
    }
  };

  const handleBackToList = () => {
    const doExit = () => {
      setConfigDirty(false);
      setIsGeneratingConfig(false);
      setStep('list');
      setCurrentSimulation(null);
      setPersonas([]);
      setMessages([]);
      setSelectedPersona(null);
      selectedPersonaIdRef.current = null;
      setPollingActive(false);
      fetchSimulations();
    };

    if (step === 'config') {
      guardedConfigExit(doExit);
    } else {
      doExit();
    }
  };

  const handleAddScenarioItem = () => {
    if (!newScenarioItem.trim()) return;
    setExtConfig(prev => ({ ...prev, scenarioItems: [...prev.scenarioItems, newScenarioItem.trim()] }));
    setNewScenarioItem('');
  };

  const handleRemoveScenarioItem = (index: number) => {
    setExtConfig(prev => ({ ...prev, scenarioItems: prev.scenarioItems.filter((_, i) => i !== index) }));
  };

  const getStatusBadge = (status: string) => {
    const variantMap: Record<string, 'positive' | 'negative' | 'neutral' | 'warning'> = {
      complete: 'positive',
      error: 'negative',
      ended: 'negative',
      running: 'warning',
      in_progress: 'neutral',
      draft: 'neutral',
      processing: 'warning',
      configuration_ready: 'positive',
      personas_ready: 'neutral',
      pending: 'neutral',
    };
    const labelMap: Record<string, string> = {
      configuration_ready: 'CONFIGURATION READY',
      personas_ready: 'PERSONAS READY',
      in_progress: 'IN PROGRESS',
    };
    return (
      <StatusTag variant={variantMap[status] || 'neutral'}>
        {labelMap[status] || status.toUpperCase().replace('_', ' ')}
      </StatusTag>
    );
  };

  // Force stop a running simulation
  const handleForceStop = async () => {
    if (!currentSimulation) return;
    setLoading(true);
    try {
      // Update all pending/in_progress personas to 'error'
      await (supabase as any)
        .from('simulation_personas')
        .update({ status: 'error' })
        .eq('simulation_id', currentSimulation.id)
        .in('status', ['pending', 'in_progress']);

      // Update simulation status to 'ended'
      await (supabase as any)
        .from('simulations')
        .update({ status: 'ended' })
        .eq('id', currentSimulation.id);

      setPollingActive(false);
      setCurrentSimulation(prev => prev ? { ...prev, status: 'ended' } : null);
      await fetchPersonas(currentSimulation.id);
      setStep('results');
      toast.success('Simulation stopped');
    } catch (err) {
      console.error(err);
      toast.error('Failed to stop simulation');
    } finally {
      setLoading(false);
    }
  };

  // Check if simulation can be analyzed (all personas are done)
  const canAnalyze = React.useMemo(() => {
    if (!currentSimulation) return false;
    const status = currentSimulation.status;
    if (status === 'running' || status === 'draft' || status === 'personas_ready') return false;
    // All personas must be complete, error, or ended
    return personas.length > 0 && personas.every(p => p.status === 'complete' || p.status === 'error');
  }, [currentSimulation, personas]);

  // field-text class defined in index.css handles 13px IBM Plex Mono with !important

  // Dynamic page header based on step
  const headerConfig = React.useMemo(() => {
    const base: import('@/contexts/PageHeaderContext').PageHeaderConfig = { title: 'Simulator' };
    if (step === 'list') {
      base.actions = [{
        label: 'NEW SIMULATION',
        icon: loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />,
        onClick: handleStartNewSimulation,
        disabled: loading,
      }];
    } else if (step === 'config') {
      base.breadcrumbs = [
        { label: 'Simulator', onClick: handleBackToList },
        { label: 'Configure' },
      ];
      const allIcpsComplete = icpProfiles.length > 0 && icpProfiles.every(icp => {
        const { configured, total } = getICPCompletion(icp);
        return configured >= total;
      });
      const hasExistingPersonas = personas.length > 0 && cameFromPersonas;
      base.actions = [
        ...(hasExistingPersonas ? [{
          label: 'GO BACK',
          icon: <ChevronLeft className="h-4 w-4" />,
          onClick: () => guardedConfigExit(() => { setConfigDirty(false); setStep('personas'); setCameFromPersonas(false); }),
          disabled: generatingPersonas || isGeneratingConfig,
          className: 'groove-border bg-card hover:bg-muted/50',
        }] : []),
        {
          label: generatingPersonas ? 'GENERATING...' : (hasExistingPersonas ? 'REGENERATE PERSONAS' : 'GENERATE PERSONAS'),
          icon: generatingPersonas ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />,
          onClick: handleGeneratePersonas,
          disabled: generatingPersonas || isGeneratingConfig || !allIcpsComplete,
          className: 'groove-btn-blue',
        },
      ];
    } else if (step === 'personas') {
      base.breadcrumbs = [
        { label: 'Simulator', onClick: handleBackToList },
        { label: 'Personas' },
      ];
      base.actions = [{
        label: 'EDIT',
        icon: <Pencil className="h-4 w-4" />,
        onClick: () => { setCameFromPersonas(true); setStep('config'); },
        hideLabel: true,
      }, {
        label: 'ADD PERSONA',
        icon: <Plus className="h-4 w-4" />,
        onClick: handleAddPersona,
      }, {
        label: loading ? 'LAUNCHING...' : 'LAUNCH SIMULATION',
        icon: loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />,
        onClick: handleLaunchSimulation,
        disabled: loading || personas.length === 0,
        className: 'groove-btn-positive',
      }];
    } else if (step === 'running' || step === 'results') {
      const simName = currentSimulation?.name || 'Results';
      base.breadcrumbs = [
        { label: 'Simulator', onClick: handleBackToList },
        { label: step === 'running' ? 'Running' : simName },
      ];
      // Simulation ID is shown in the content area, not the header
      const actions: any[] = [];
      // Smart Report button — generates parameter-level suggestions
      actions.push({
        label: 'SMART REPORT',
        icon: <Sparkles className="w-4 h-4" />,
        onClick: () => {
          if (canAnalyze) {
            setReportDialogOpen(true);
          } else {
            setWaitingDialogOpen(true);
          }
        },
        className: 'groove-btn-blue',
      });
      // Force stop (only when running)
      if (step === 'running' || currentSimulation?.status === 'running') {
        actions.push({
          label: 'STOP',
          icon: <Square className="w-4 h-4" />,
          onClick: handleForceStop,
          disabled: loading,
          className: 'groove-btn-destructive',
        });
      }
      actions.push({
        label: 'RESTART',
        icon: loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />,
        onClick: handleRestartSimulation,
        disabled: loading,
      }, {
        label: 'EDIT',
        icon: <Pencil className="w-4 h-4" />,
        onClick: () => {
          if (currentSimulation) {
            setStep('config');
          }
        },
      });
      // Delete — icon-only, rightmost
      actions.push({
        label: '',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: () => currentSimulation && handleDeleteSimulation(currentSimulation.id),
        className: 'groove-btn-destructive !w-8 !p-0 !px-0',
      });
      base.actions = actions;
    }
    return base;
  }, [
    step,
    loading,
    generatingPersonas,
    isGeneratingConfig,
    personas.length,
    currentSimulation?.id,
    currentSimulation?.name,
    currentSimulation?.status,
    canAnalyze,
    handleBackToList,
    handleStartNewSimulation,
    handleGeneratePersonas,
    handleLaunchSimulation,
    handleForceStop,
    handleDeleteSimulation,
    handleRestartSimulation,
  ]);

  usePageHeader(headerConfig, [
    step,
    loading,
    generatingPersonas,
    isGeneratingConfig,
    currentSimulation?.id,
    currentSimulation?.name,
    currentSimulation?.status,
    personas.length,
    canAnalyze,
    simulationName,
    agentNumber,
    businessInfo,
    extConfig,
    numConversations,
    minMessages,
    maxMessages,
    icpProfiles,
    cameFromPersonas,
  ]);

  // ── INITIAL LOADING ──
  if (initialLoading) {
    return <RetroLoader />;
  }

  // ── SIMULATION LIST ──
  if (step === 'list') {
    const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
    const totalPages = Math.max(1, Math.ceil(simulations.length / listPageSize));
    const paginatedSimulations = simulations.slice(listPage * listPageSize, (listPage + 1) * listPageSize);

    return (
      <div className="container mx-auto max-w-7xl flex h-full min-h-0 flex-col overflow-hidden pt-6 pb-0">
        {/* Table container — fixed height, no page scroll */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden relative bg-card" style={{ border: '3px groove hsl(var(--border-groove))', overscrollBehavior: 'none' }}>
          <ScrollArea className="flex-1 [&>div]:overscroll-none">
            {simulations.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-muted-foreground field-text">No simulations yet. Create one to start testing your setters.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {paginatedSimulations.map(sim => {
                  const simPersonas = listPersonasMap[sim.id] || [];
                  const displayName = sim.name || `Simulation ${new Date(sim.created_at).toLocaleDateString()}`;
                  return (
                    <div
                      key={sim.id}
                      className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => handleOpenSimulation(sim)}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-4">
                        {simPersonas.length > 0 && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            {simPersonas.slice(0, 5).map(p => (
                              <PixelAvatar key={p.id} seed={p.avatar_seed || p.name} size={24} />
                            ))}
                            {simPersonas.length > 5 && (
                              <span className="text-muted-foreground field-text ml-1">+{simPersonas.length - 5}</span>
                            )}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground font-medium field-text truncate">{displayName}</p>
                          <p className="text-muted-foreground field-text truncate">
                            {getSetterLabel(sim.agent_number, setterDisplayNames).toUpperCase()} · {sim.num_conversations} conversations
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {getStatusBadge(sim.status)}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
                          onClick={(e) => { e.stopPropagation(); setEditingSimName({ id: sim.id, name: sim.name || '' }); }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
                          onClick={(e) => handleDeleteSimulation(sim.id, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Pagination bar — fixed at bottom */}
        <div className="flex items-center justify-center relative" style={{ marginTop: '12px', marginBottom: '12px' }}>
          <div className="absolute left-0">
            <Select value={String(listPageSize)} onValueChange={v => { setListPageSize(Number(v)); setListPage(0); }}>
              <SelectTrigger className="h-8 groove-btn w-auto min-w-[130px] pagination-page-size-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-sidebar pagination-page-size-content">
                {PAGE_SIZE_OPTIONS.map(n => (
                  <SelectItem key={n} value={String(n)} className="pagination-page-size-item">{n} Per Page</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 groove-btn"
              disabled={listPage === 0}
              onClick={() => setListPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
              {listPage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 groove-btn"
              disabled={listPage >= totalPages - 1}
              onClick={() => setListPage(p => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Edit Simulation Name Dialog */}
        {editingSimName && (
          <Dialog open={!!editingSimName} onOpenChange={() => setEditingSimName(null)}>
            <DialogContent className="max-w-md !p-0">
              <DialogHeader>
                <DialogTitle>EDIT SIMULATION NAME</DialogTitle>
              </DialogHeader>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <Label className="field-text">Name</Label>
                  <Input
                    value={editingSimName.name}
                    onChange={e => setEditingSimName(prev => prev ? { ...prev, name: e.target.value } : null)}
                    className="field-text"
                    placeholder="e.g. Q1 Pricing Test"
                  />
                </div>
                <div>
                  <Label className="field-text text-muted-foreground">Simulation ID</Label>
                  <span
                    className="cursor-pointer block mt-1"
                    title="Click to copy Simulation ID"
                    onClick={() => { navigator.clipboard.writeText(editingSimName.id); toast.success('Simulation ID copied'); }}
                  >
                    <StatusTag variant="neutral">{editingSimName.id}</StatusTag>
                  </span>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button className="flex-1 groove-btn field-text" onClick={handleSaveSimName}>SAVE</Button>
                  <Button variant="outline" onClick={() => setEditingSimName(null)} className="flex-1 groove-btn field-text">CANCEL</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        <DeleteConfirmDialog
          open={!!pendingDeleteSimId}
          onOpenChange={(open) => { if (!open) setPendingDeleteSimId(null); }}
          onConfirm={confirmDeleteSimulation}
          title="Delete Simulation"
          itemName={pendingDeleteSimName}
        />
      </div>
    );
  }

  // ── CONFIGURATION ──
  if (step === 'config') {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden bg-background relative" style={{ scrollbarGutter: 'stable' as const }}>
        <SavingOverlay
          isVisible={isGeneratingConfig || generatingPersonas}
          message={isGeneratingConfig ? 'Generating Configuration...' : 'Generating Personas...'}
          variant="fixed"
        />
        <div className="container mx-auto max-w-7xl space-y-6 pt-6" style={{ paddingBottom: '24px' }}>
          <SimulationSetupFlow
            clientId={clientId!}
            simulationName={simulationName}
            setSimulationName={setSimulationNameTracked}
            agentNumber={agentNumber}
            setAgentNumber={setAgentNumberTracked}
            businessInfo={businessInfo}
            setBusinessInfo={setBusinessInfoTracked}
            freeInput={freeInput}
            setFreeInput={setFreeInputTracked}
            icpProfiles={icpProfiles}
            setIcpProfiles={setIcpProfilesTracked}
            minMessages={minMessages}
            setMinMessages={setMinMessagesTracked}
            maxMessages={maxMessages}
            setMaxMessages={setMaxMessagesTracked}
            onGeneratePersonas={handleGeneratePersonas}
            onConfigGenerated={handleConfigGenerated}
            onManualConfigInitialized={handleManualConfigInitialized}
            onStatusChange={async (status: string) => {
              if (!currentSimulation) return;

              setCurrentSimulation(prev => prev ? { ...prev, status } : null);
              setSimulations(prev => prev.map(sim => sim.id === currentSimulation.id ? { ...sim, status } : sim));

              await (supabase as any).from('simulations').update({ status }).eq('id', currentSimulation.id);
            }}
            generatingPersonas={generatingPersonas}
            isGeneratingConfig={isGeneratingConfig}
            setIsGeneratingConfig={setIsGeneratingConfig}
          />
        </div>
        <UnsavedChangesDialog
          open={!!unsavedExitAction}
          onOpenChange={(open) => { if (!open) setUnsavedExitAction(null); }}
          onDiscard={() => { setConfigDirty(false); unsavedExitAction?.(); setUnsavedExitAction(null); }}
          description="You have unsaved configuration changes. If you leave now, all changes to your ICP profiles and settings will be lost."
        />
        {/* Generation exit warning */}
        <Dialog open={showGenerateExitWarning} onOpenChange={setShowGenerateExitWarning}>
          <DialogContent className="max-w-md !p-0">
            <DialogHeader>
              <DialogTitle>Generation in Progress</DialogTitle>
            </DialogHeader>
            <div className="p-6 space-y-6">
              <p className="text-sm text-muted-foreground leading-relaxed" style={{ fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" }}>
                AI is currently generating your simulation configuration. The generation will continue in the background even if you leave. You can return later to see the results.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="default"
                  className="flex-1"
                  onClick={() => setShowGenerateExitWarning(false)}
                >
                  Stay
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    setShowGenerateExitWarning(false);
                    pendingExitAction?.();
                    setPendingExitAction(null);
                  }}
                >
                  Leave Anyway
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── PERSONA PREVIEW ──
  if (step === 'personas') {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden bg-background" style={{ scrollbarGutter: 'stable' as const }}>
        <div className="container mx-auto max-w-7xl space-y-6 pt-6" style={{ paddingBottom: '24px' }}>
          {(() => {
            // Group personas by ICP profile
            const grouped: { icpId: string | null; icpName: string; personas: Persona[] }[] = [];
            
            if (icpProfileInfos.length > 0) {
              for (const icp of icpProfileInfos) {
                const icpPersonas = personas.filter(p => p.icp_profile_id === icp.id);
                if (icpPersonas.length > 0) {
                  grouped.push({ icpId: icp.id, icpName: icp.name, personas: icpPersonas });
                }
              }
              // Any personas without an ICP
              const unlinked = personas.filter(p => !p.icp_profile_id || !icpProfileInfos.some(i => i.id === p.icp_profile_id));
              if (unlinked.length > 0) {
                grouped.push({ icpId: null, icpName: 'Other Personas', personas: unlinked });
              }
            } else {
              // No ICP profiles — show all in one group
              grouped.push({ icpId: null, icpName: 'All Personas', personas });
            }

            return grouped.map((group, groupIdx) => (
              <div key={group.icpId || 'ungrouped'} className="space-y-6">
                {/* Section separator — analytics-style */}
                {(grouped.length > 1 || icpProfileInfos.length > 0) && (
                  <>
                    {groupIdx > 0 && <div className="pt-2" />}
                    <div className="section-separator">
                      {group.icpName}
                      <span className="section-separator-count">{group.personas.length} persona{group.personas.length !== 1 ? 's' : ''}</span>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '24px' }}>
                  {group.personas.map(persona => {
                    const { cleanGoal, style, booking } = parseGoalField(persona.goal);
                    return (
                      <div key={persona.id} className="groove-border bg-card p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <PixelAvatar seed={persona.avatar_seed || persona.name} size={48} />
                            <div>
                              <p className="font-medium text-foreground field-text">
                                {persona.name}
                              </p>
                              <p className="text-muted-foreground field-text">
                                {persona.age && `${persona.age}y`} {persona.gender && `· ${persona.gender}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button
                              className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50"
                              onClick={() => handleEditPersona(persona)}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center"
                              onClick={() => setPendingDeletePersona({ id: persona.id, name: persona.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        <div className="border-t border-dashed border-border" />
                        <div className="space-y-1">
                          <p className="field-text"><span className="text-foreground">Occupation:</span> <span className="text-muted-foreground">{persona.occupation}</span></p>
                          <p className="field-text"><span className="text-foreground">Problem:</span> <span className="text-muted-foreground">{persona.problem}</span></p>
                          <p className="field-text"><span className="text-foreground">Hobbies:</span> <span className="text-muted-foreground">{formatHobbies(persona.hobbies)}</span></p>
                          <p className="field-text"><span className="text-foreground">Goal:</span> <span className="text-muted-foreground">{cleanGoal}</span></p>
                          {style && (
                            <p className="field-text"><span className="text-foreground">Style:</span> <span className="text-muted-foreground">{style}</span></p>
                          )}
                          {booking && booking !== 'none' && (
                            <p className="field-text"><span className="text-foreground">Booking:</span> <span className="text-muted-foreground">{booking}</span></p>
                          )}
                        </div>
                        <div className="border-t border-dashed border-border" />
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground field-text">{persona.assigned_message_count} messages</span>
                          {getStatusBadge(persona.status)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>

        {/* Edit Persona Dialog */}
        {editingPersona && (
          <Dialog open={!!editingPersona} onOpenChange={() => setEditingPersona(null)}>
            <DialogContent className="max-w-lg !p-0 max-h-[85vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>{editingPersona.id === 'new' ? 'ADD PERSONA' : 'EDIT PERSONA'}</DialogTitle>
              </DialogHeader>
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-6 pb-0 space-y-4" style={{ paddingBottom: '24px' }}>
                  <div className="space-y-1">
                    <Label className="field-text">Name</Label>
                    <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="field-text" placeholder="e.g. Sarah Johnson" />
                  </div>
                  <div className="space-y-1">
                    <Label className="field-text">Age</Label>
                    <Input type="number" value={editForm.age} onChange={e => setEditForm(f => ({ ...f, age: e.target.value }))} className="field-text" placeholder="e.g. 32" />
                  </div>
                  <div className="space-y-1">
                    <Label className="field-text">Gender</Label>
                    <Input value={editForm.gender} onChange={e => setEditForm(f => ({ ...f, gender: e.target.value }))} className="field-text" placeholder="e.g. Female" />
                  </div>
                  <div className="space-y-1">
                    <Label className="field-text">Occupation</Label>
                    <Input value={editForm.occupation} onChange={e => setEditForm(f => ({ ...f, occupation: e.target.value }))} className="field-text" placeholder="e.g. Marketing Manager" />
                  </div>
                  <div className="space-y-1">
                    <Label className="field-text">Problem / Need</Label>
                    <Textarea rows={2} value={editForm.problem} onChange={e => setEditForm(f => ({ ...f, problem: e.target.value }))} className="field-text" placeholder="e.g. Looking for a reliable contractor" />
                  </div>
                  <div className="space-y-1">
                    <Label className="field-text">Hobbies</Label>
                    <Input value={editForm.hobbies} onChange={e => setEditForm(f => ({ ...f, hobbies: e.target.value }))} className="field-text" placeholder="e.g. Hiking, reading, cooking" />
                  </div>
                  <div className="space-y-1">
                    <Label className="field-text">Goal / Behavior</Label>
                    <Textarea rows={2} value={editForm.goal} onChange={e => setEditForm(f => ({ ...f, goal: e.target.value }))} className="field-text" placeholder="e.g. Get pricing info and compare options" />
                  </div>
                  {/* Action Buttons - 50/50 full width */}
                  <div className="flex gap-3 pt-2">
                    <Button
                      className="flex-1 groove-btn field-text"
                      onClick={editingPersona.id === 'new' ? handleSaveNewPersona : handleSavePersona}
                    >
                      {editingPersona.id === 'new' ? 'ADD' : 'SAVE'}
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setEditingPersona(null)}
                      className="flex-1 groove-btn field-text"
                    >
                      CANCEL
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        )}

        {/* Edit Simulation Name Dialog (personas step) */}
        {editingSimName && (
          <Dialog open={!!editingSimName} onOpenChange={() => setEditingSimName(null)}>
            <DialogContent className="max-w-md !p-0">
              <DialogHeader>
                <DialogTitle>EDIT SIMULATION NAME</DialogTitle>
              </DialogHeader>
              <div className="p-6 space-y-4">
                <Label className="field-text">Name</Label>
                <Input
                  value={editingSimName.name}
                  onChange={e => setEditingSimName(prev => prev ? { ...prev, name: e.target.value } : null)}
                  className="field-text"
                  placeholder="e.g. Q1 Pricing Test"
                />
                <div>
                  <Label className="field-text text-muted-foreground">Simulation ID</Label>
                  <span
                    className="cursor-pointer block mt-1"
                    title="Click to copy Simulation ID"
                    onClick={() => { navigator.clipboard.writeText(editingSimName.id); toast.success('Simulation ID copied'); }}
                  >
                    <StatusTag variant="neutral">{editingSimName.id}</StatusTag>
                  </span>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button className="flex-1 groove-btn field-text" onClick={handleSaveSimName}>SAVE</Button>
                  <Button variant="outline" onClick={() => setEditingSimName(null)} className="flex-1 groove-btn field-text">CANCEL</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    );
  }

  // ── RUNNING / RESULTS ──
  const isRunning = step === 'running' || currentSimulation?.status === 'running';
  const selectedUserTurnCount = messages.filter(msg => msg.role === 'user').length;
  const selectedAssistantMessageCount = messages.filter(msg => msg.role === 'assistant').length;

  return (
    <div className="h-full overflow-hidden bg-background flex flex-col">
      <div className="container mx-auto max-w-7xl flex flex-col h-full pt-6" style={{ paddingBottom: '24px' }}>
        <div className="flex gap-6 flex-1 min-h-0">
          {/* Persona list - left panel */}
          <div className="w-80 shrink-0 groove-border bg-card flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {(() => {
                // Group personas by ICP profile, sorted stably
                const grouped: { icpId: string | null; icpName: string; personas: Persona[] }[] = [];
                if (icpProfileInfos.length > 0) {
                  for (const icp of [...icpProfileInfos].sort((a, b) => a.sort_order - b.sort_order)) {
                    const icpPersonas = personas
                      .filter(p => p.icp_profile_id === icp.id)
                      .sort((a, b) => a.name.localeCompare(b.name));
                    if (icpPersonas.length > 0) {
                      grouped.push({ icpId: icp.id, icpName: icp.name, personas: icpPersonas });
                    }
                  }
                  const unlinked = personas
                    .filter(p => !p.icp_profile_id || !icpProfileInfos.some(i => i.id === p.icp_profile_id))
                    .sort((a, b) => a.name.localeCompare(b.name));
                  if (unlinked.length > 0) {
                    grouped.push({ icpId: null, icpName: 'Other', personas: unlinked });
                  }
                } else {
                  grouped.push({ icpId: null, icpName: '', personas: [...personas].sort((a, b) => a.name.localeCompare(b.name)) });
                }

                return grouped.map((group) => (
                  <div key={group.icpId || 'ungrouped'}>
                    {/* ICP separator header */}
                    {group.icpName && (
                      <div className="section-separator px-3 py-2">
                        {group.icpName}
                      </div>
                    )}
                    {group.personas.map((persona, pIdx) => (
                      <div
                        key={persona.id}
                        className={`p-3 flex items-center gap-3 cursor-pointer transition-colors
                          ${pIdx < group.personas.length - 1 ? 'border-b border-border/50' : ''}
                          ${selectedPersona?.id === persona.id ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/30'}`}
                        onClick={async () => {
                          setSelectedPersona(persona);
                          selectedPersonaIdRef.current = persona.id;
                          await fetchMessages(persona.id, true);
                        }}
                      >
                        <PixelAvatar seed={persona.avatar_seed || persona.name} size={36} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate field-text">
                            {persona.name}
                          </p>
                          <p className="text-muted-foreground truncate field-text">
                            {persona.occupation}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {getStatusBadge(persona.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Conversation view - right panel */}
          <div className="flex-1 groove-border bg-card flex flex-col overflow-hidden">
            {selectedPersona ? (
              <>
                {/* Persona header */}
                <div className="p-4 border-b border-dashed border-border flex items-center gap-3">
                  <button
                    type="button"
                    className="flex items-center gap-3 text-left rounded-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setPersonaDetailsOpen(true)}
                    title="Open persona details"
                  >
                    <PixelAvatar seed={selectedPersona.avatar_seed || selectedPersona.name} size={40} />
                    <div>
                      <p className="font-medium text-foreground field-text">
                        {selectedPersona.name}
                      </p>
                      <p className="text-muted-foreground field-text">
                        {selectedPersona.age}y · {selectedPersona.gender} · {selectedPersona.occupation}
                      </p>
                    </div>
                  </button>
                  <div className="ml-auto flex flex-col items-end gap-1">
                    {getStatusBadge(selectedPersona.status)}
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.map(msg => {
                    const isFormSubmission = msg.message_type === 'form_submission';
                    const isOutreach = msg.message_type === 'outreach';

                    // Outreach messages (from our side, initial outreach) render on the right
                    // Form submissions render as a special card on the left
                    // Regular messages follow normal layout

                    if (isFormSubmission) {
                      return (
                        <div key={msg.id} className="flex justify-start">
                          <div className="max-w-[75%] min-w-0 overflow-hidden groove-border" style={{ background: 'hsl(var(--muted) / 0.5)' }}>
                            <div className="px-3 py-1.5 border-b border-dashed border-border flex items-center gap-2">
                              <span className="text-[11px] text-muted-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>📋 FORM SUBMISSION</span>
                            </div>
                            <div className="px-3 py-2">
                              <p className="whitespace-pre-wrap break-words text-sm text-foreground" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                                {msg.content?.replace(/^📋 FORM SUBMISSION\n─+\n?/i, '') || msg.content}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (isOutreach) {
                      return (
                        <div key={msg.id} className="flex justify-end">
                          <div className="max-w-[70%] min-w-0 px-3 py-2 rounded text-sm overflow-hidden groove-border" style={{ background: 'hsl(var(--primary) / 0.15)' }}>
                            <p className="text-[11px] mb-1 text-foreground/80" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                              📨 YOUR OUTREACH
                            </p>
                            <p className="whitespace-pre-wrap break-words text-foreground" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{msg.content}</p>
                          </div>
                        </div>
                      );
                    }

                    return (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[70%] min-w-0 px-3 py-2 rounded text-sm overflow-hidden ${
                          msg.role === 'user'
                            ? 'bg-muted text-foreground groove-border'
                            : 'bg-primary/20 text-foreground groove-border'
                        }`}
                      >
                        <p className={`text-[11px] mb-1 capitalize ${msg.role === 'user' ? 'text-foreground/70' : 'text-foreground/80'}`} style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                          {msg.role === 'user' ? selectedPersona.name : getSetterLabel(currentSimulation?.agent_number || 1, setterDisplayNames)}
                        </p>
                        <p className="whitespace-pre-wrap break-words overflow-wrap-anywhere" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{msg.content}</p>
                      </div>
                    </div>
                    );
                  })}
                  {messages.length === 0 && (
                    <div className="text-center text-sm py-12 space-y-3">
                      {selectedPersona.status === 'error' ? (
                        <div className="p-4 mx-auto max-w-md space-y-2" style={{ background: '#9A3D38', border: '3px groove #752e2a' }}>
                          <p className="text-white field-text font-medium">
                            ✕ SIMULATION ERROR
                          </p>
                          <p className="text-white/80 field-text">
                            This persona's conversation failed. The webhook may be unreachable or returned an error.
                          </p>
                        </div>
                      ) : selectedPersona.status === 'pending' ? (
                        <p className="text-muted-foreground">Waiting to start...</p>
                      ) : selectedPersona.status === 'in_progress' ? (
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <p>Processing... messages will appear here.</p>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">No messages yet.</p>
                      )}
                    </div>
                  )}
                  {messages.length > 0 && selectedPersona.status === 'error' && (() => {
                    const errorMessages = messages.filter(m => m.role === 'assistant' && m.content?.includes('[ERROR:'));
                    const lastError = errorMessages[errorMessages.length - 1];
                    const errorDetail = lastError?.content?.replace(/^\[ERROR:.*?\]\s*/, '') || 'Unknown error. Check webhook configuration.';
                    return (
                      <div className="p-3 mx-4 mb-2 space-y-2" style={{ background: '#9A3D38', border: '3px groove #752e2a' }}>
                        <p className="text-white field-text font-medium">
                          ✕ CONVERSATION ENDED WITH ERROR
                        </p>
                        <p className="text-white/80 field-text">
                          The simulation was interrupted.
                        </p>
                        {errorDetail && (
                          <div className="mt-1 p-2 rounded" style={{ background: 'rgba(0,0,0,0.3)' }}>
                            <p className="text-white/70 field-text break-all">{errorDetail}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {messages.length > 0 && (selectedPersona.status === 'in_progress') && (
                    <WaitingMessageIndicator />
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                {isRunning ? (
                  <>
                    <div className="flex gap-2 mb-4">
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
                    <h3 className="text-lg font-medium">Simulation in progress</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Conversations will appear as they complete.
                    </p>
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-12 h-12 text-primary mb-4" />
                    <h3 className="text-lg font-medium">Select a conversation</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Click on a completed persona from the left panel.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={personaDetailsOpen && !!selectedPersona} onOpenChange={setPersonaDetailsOpen}>
        <DialogContent className="max-w-lg !p-0 max-h-[85vh] !flex !flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>PERSONA DETAILS</DialogTitle>
          </DialogHeader>

          {selectedPersona && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <div className="p-6 space-y-4" style={{ paddingBottom: '24px' }}>
                <p className="field-text">
                  <span className="text-foreground">{selectedPersona.name}</span> <span className="text-muted-foreground">· {getSetterLabel(currentSimulation?.agent_number || 1, setterDisplayNames)}</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="groove-border p-3 bg-muted/20">
                    <p className="text-muted-foreground field-text">Status</p>
                    <div className="mt-1">{getStatusBadge(selectedPersona.status)}</div>
                  </div>
                  <div className="groove-border p-3 bg-muted/20">
                    <p className="text-muted-foreground field-text">Target user messages</p>
                    <p className="text-foreground mt-1 field-text">{selectedPersona.assigned_message_count}</p>
                  </div>
                  <div className="groove-border p-3 bg-muted/20">
                    <p className="text-muted-foreground field-text">User messages sent</p>
                    <p className="text-foreground mt-1 field-text">{selectedUserTurnCount}</p>
                  </div>
                  <div className="groove-border p-3 bg-muted/20">
                    <p className="text-muted-foreground field-text">Setter messages saved</p>
                    <p className="text-foreground mt-1 field-text">{selectedAssistantMessageCount}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="field-text"><span className="text-foreground">Demographics:</span> <span className="text-muted-foreground">{selectedPersona.age ?? 'N/A'}y · {selectedPersona.gender || 'N/A'}</span></p>
                  <p className="field-text"><span className="text-foreground">Occupation:</span> <span className="text-muted-foreground">{selectedPersona.occupation || 'N/A'}</span></p>
                  <p className="field-text"><span className="text-foreground">Problem:</span> <span className="text-muted-foreground">{selectedPersona.problem || 'N/A'}</span></p>
                  <p className="field-text"><span className="text-foreground">Hobbies:</span> <span className="text-muted-foreground">{formatHobbies(selectedPersona.hobbies) || 'N/A'}</span></p>
                  <p className="field-text"><span className="text-foreground">Goal:</span> <span className="text-muted-foreground">{selectedPersona.goal || 'N/A'}</span></p>
                  {selectedPersona.dummy_email && (
                    <p className="field-text"><span className="text-foreground">Email:</span> <span className="text-muted-foreground">{selectedPersona.dummy_email}</span></p>
                  )}
                  {selectedPersona.dummy_phone && (
                    <p className="field-text"><span className="text-foreground">Phone:</span> <span className="text-muted-foreground">{selectedPersona.dummy_phone}</span></p>
                  )}
                  {selectedPersona.booking_intent && selectedPersona.booking_intent !== 'none' && (
                    <>
                      <p className="field-text"><span className="text-foreground">Booking Intent:</span> <span className="text-muted-foreground">{selectedPersona.booking_intent.replace(/_/g, ' ')}</span></p>
                      {selectedPersona.preferred_booking_date && (
                        <p className="field-text"><span className="text-foreground">Preferred Date:</span> <span className="text-muted-foreground">{selectedPersona.preferred_booking_date}</span></p>
                      )}
                    </>
                  )}
                </div>

                <div>
                  <Label className="field-text text-muted-foreground">Persona ID</Label>
                  <span
                    className="cursor-pointer block mt-1"
                    title="Click to copy Persona ID"
                    onClick={() => { navigator.clipboard.writeText(selectedPersona.id); toast.success('Persona ID copied'); }}
                  >
                    <StatusTag variant="neutral">{selectedPersona.id}</StatusTag>
                  </span>
                </div>

                <div className="pt-2">
                  <Button variant="outline" onClick={() => setPersonaDetailsOpen(false)} className="w-full groove-btn field-text">CLOSE</Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Simulation Name Dialog (running/results) */}
      {editingSimName && (
        <Dialog open={!!editingSimName} onOpenChange={() => setEditingSimName(null)}>
          <DialogContent className="max-w-md !p-0">
            <DialogHeader>
              <DialogTitle>EDIT SIMULATION NAME</DialogTitle>
            </DialogHeader>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <Label className="field-text">Name</Label>
                <Input
                  value={editingSimName.name}
                  onChange={e => setEditingSimName(prev => prev ? { ...prev, name: e.target.value } : null)}
                  className="field-text"
                  placeholder="e.g. Q1 Pricing Test"
                />
              </div>
              <div>
                <Label className="field-text text-muted-foreground">Simulation ID</Label>
                <span
                  className="cursor-pointer block mt-1"
                  title="Click to copy Simulation ID"
                  onClick={() => { navigator.clipboard.writeText(editingSimName.id); toast.success('Simulation ID copied'); }}
                >
                  <StatusTag variant="neutral">{editingSimName.id}</StatusTag>
                </span>
              </div>
              <div className="flex gap-3 pt-2">
                <Button className="flex-1 groove-btn field-text" onClick={handleSaveSimName}>SAVE</Button>
                <Button variant="outline" onClick={() => setEditingSimName(null)} className="flex-1 groove-btn field-text">CANCEL</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Simulation Analysis Dialog */}
      {currentSimulation && clientId && (
        <SimulationAnalysisDialog
          open={analysisDialogOpen}
          onOpenChange={setAnalysisDialogOpen}
          simulationId={currentSimulation.id}
          clientId={clientId}
          simulationName={currentSimulation.name || `Simulation ${new Date(currentSimulation.created_at).toLocaleDateString()}`}
        />
      )}

      {/* Simulation Report Dialog */}
      {currentSimulation && clientId && (
        <SimulationReportDialog
          open={reportDialogOpen}
          onOpenChange={setReportDialogOpen}
          simulationId={currentSimulation.id}
          clientId={clientId}
          agentNumber={currentSimulation.agent_number}
          simulationName={currentSimulation.name || `Simulation ${new Date(currentSimulation.created_at).toLocaleDateString()}`}
        />
      )}

      {/* Waiting dialog — simulation not yet complete */}
      <Dialog open={waitingDialogOpen} onOpenChange={setWaitingDialogOpen}>
        <DialogContent className="max-w-sm !p-0">
          <DialogHeader>
            <DialogTitle>SIMULATION IN PROGRESS</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
            <p className="field-text text-muted-foreground">
              Please wait until the simulation is completed before analyzing results.
            </p>
            <Button variant="outline" onClick={() => setWaitingDialogOpen(false)} className="w-full groove-btn field-text">
              CLOSE
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!pendingDeleteSimId}
        onOpenChange={(open) => { if (!open) setPendingDeleteSimId(null); }}
        onConfirm={confirmDeleteSimulation}
        title="Delete Simulation"
        itemName={pendingDeleteSimName}
      />

      <DeleteConfirmDialog
        open={!!pendingDeletePersona}
        onOpenChange={(open) => { if (!open) setPendingDeletePersona(null); }}
        onConfirm={() => { if (pendingDeletePersona) handleDeletePersona(pendingDeletePersona.id); }}
        title="Delete Persona"
        itemName={pendingDeletePersona?.name}
      />

    </div>
  );
}
