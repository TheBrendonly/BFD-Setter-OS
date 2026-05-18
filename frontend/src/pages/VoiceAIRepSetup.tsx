import React, { useState, useEffect } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronRight, Phone, MessageSquare, MessageSquarePlus, Bot, PhoneCall } from 'lucide-react';
import { cn } from '@/lib/utils';
import VoiceAIRepSetupGuide, { VOICE_AI_REP_PHASES, isPhaseComplete } from '@/components/setup-guide/VoiceAIRepSetupGuide';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useClientCredentials, isCredentialConfigured } from '@/hooks/useClientCredentials';
import RetellAgentsTab from '@/components/retell/RetellAgentsTab';

import RetellPhoneNumbersTab from '@/components/retell/RetellPhoneNumbersTab';
import RetellCallLogsTab from '@/components/retell/RetellCallLogsTab';
import { SetterDisplayNamesCard } from '@/components/setters/SetterDisplayNamesCard';
import { ClientTimezoneCard } from '@/components/setters/ClientTimezoneCard';

// Phase definitions for the cards grid
const VOICE_PHASES = [
  {
    id: 'twilio-setup',
    title: 'Twilio Setup',
    description: 'Configure Twilio for SMS messaging',
    icon: MessageSquare,
    dialogPhase: 0,
    dialogStep: 0
  },
  {
    id: 'voice-accounts-setup',
    title: 'Accounts Setup',
    description: 'Set up Retell AI account and phone numbers',
    icon: Phone,
    dialogPhase: 1,
    dialogStep: 0
  },
  {
    id: 'voice-inbound-setup',
    title: 'Inbound AI Rep Setup',
    description: 'Configure your Inbound Voice AI Rep',
    icon: Phone,
    dialogPhase: 2,
    dialogStep: 0
  },
  {
    id: 'voice-outbound-setup',
    title: 'Outbound AI Rep Setup',
    description: 'Configure your Outbound Voice AI Rep',
    icon: Phone,
    dialogPhase: 3,
    dialogStep: 0
  },
  {
    id: 'voice-prompts-setup',
    title: 'Prompts Setup',
    description: 'Configure your Voice AI agent prompts',
    icon: MessageSquarePlus,
    dialogPhase: 4,
    dialogStep: 0
  }
];

const VoiceAIRepSetup = () => {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const { credentials } = useClientCredentials(clientId);
  const hasRetellApiKey = isCredentialConfigured(credentials?.retell_api_key);

  usePageHeader({
    title: 'Voice Setter',
    breadcrumbs: [
      { label: 'Voice Setter' },
      { label: 'Configuration' },
    ],
  });
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [dialogInitialPhase, setDialogInitialPhase] = useState(0);
  const [dialogInitialStep, setDialogInitialStep] = useState(0);
  const [dialogNavigationKey, setDialogNavigationKey] = useState(0);
  const [setupGuideCompletedSteps, setSetupGuideCompletedSteps] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('agents');

  // Fetch initial settings
  useEffect(() => {
    if (clientId) {
      fetchSettings();
    }
  }, [clientId]);

  // Subscribe to realtime updates for two-way sync
  useEffect(() => {
    if (!clientId) return;

    const channel = supabase
      .channel(`voice-config-sync-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clients', filter: `id=eq.${clientId}` },
        (payload) => {
          const steps = (payload.new.setup_guide_completed_steps as string[]) || [];
          setSetupGuideCompletedSteps(steps);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  const fetchSettings = async () => {
    const cacheKey = `voice_setup_steps_${clientId}`;
    const cached = getCached<string[]>(cacheKey);
    if (cached) {
      setSetupGuideCompletedSteps(cached);
      setLoading(false);
    }
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('setup_guide_completed_steps')
        .eq('id', clientId)
        .single();

      if (error) throw error;

      const steps = (data?.setup_guide_completed_steps as string[]) || [];
      setCache(cacheKey, steps);
      setSetupGuideCompletedSteps(steps);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPhaseStatus = (phase: typeof VOICE_PHASES[0]) => {
    const stepCount = VOICE_AI_REP_PHASES[phase.id] || 0;
    let completed = 0;
    for (let i = 0; i < stepCount; i++) {
      if (setupGuideCompletedSteps.includes(`${phase.id}-${i}`)) {
        completed++;
      }
    }
    return {
      completed,
      total: stepCount,
      percentage: stepCount > 0 ? Math.round((completed / stepCount) * 100) : 0,
      isComplete: stepCount > 0 && completed >= stepCount
    };
  };

  const getOverallProgress = () => {
    let totalSteps = 0;
    let completedSteps = 0;
    VOICE_PHASES.forEach(phase => {
      const status = getPhaseStatus(phase);
      totalSteps += status.total;
      completedSteps += status.completed;
    });
    return {
      completed: completedSteps,
      total: totalSteps,
      percentage: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
    };
  };

  const handlePhaseClick = (phase: typeof VOICE_PHASES[0]) => {
    setDialogInitialPhase(phase.dialogPhase);
    setDialogInitialStep(phase.dialogStep);
    setDialogNavigationKey(prev => prev + 1);
    setSetupGuideOpen(true);
  };

  if (loading) {
    return <RetroLoader />;
  }

  const overallProgress = getOverallProgress();

  return (
    <div className="h-full overflow-hidden bg-background flex flex-col">
      <div className="container mx-auto max-w-7xl flex flex-col h-full">
        {/* Overall Progress Card - Sticky */}
        <div className="flex-shrink-0">
          <Card className="material-surface mb-4">
            <CardHeader className="pb-3 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Voice AI Rep Setup Progress</CardTitle>
                  <CardDescription className="mt-1">
                    Complete all phases to enable Voice AI reps
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
        </div>

        {/* Main Content - Tabs */}
        <div className="flex-1 min-h-0 overflow-auto pb-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="agents" className="text-xs gap-1.5">
                <Bot className="h-3.5 w-3.5" /> Agents
              </TabsTrigger>
              <TabsTrigger value="phone-numbers" className="text-xs gap-1.5">
                <Phone className="h-3.5 w-3.5" /> Phone Numbers
              </TabsTrigger>
              <TabsTrigger value="call-logs" className="text-xs gap-1.5">
                <PhoneCall className="h-3.5 w-3.5" /> Call Logs
              </TabsTrigger>
              <TabsTrigger value="setup-guide" className="text-xs gap-1.5">
                <MessageSquarePlus className="h-3.5 w-3.5" /> Setup Guide
              </TabsTrigger>
            </TabsList>

            {/* Retell API Key Gate — blocks all Retell tabs */}
            {!hasRetellApiKey && activeTab !== 'setup-guide' ? (
              <Card className="material-surface border-2 border-destructive/30">
                <CardContent className="py-12 flex flex-col items-center text-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center groove-border">
                    <Bot className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-foreground font-medium text-base mb-1"
                        style={{ fontFamily: "'VT323', monospace" }}>
                      RETELL API KEY REQUIRED
                    </h3>
                    <p className="text-muted-foreground max-w-md text-sm"
                       style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
                      To create and manage Voice AI agents, you need to connect your Retell AI account first.
                      Add your Retell API key in the Credentials page to unlock all voice features.
                    </p>
                  </div>
                  <Button
                    onClick={() => navigate(`/client/${clientId}/credentials`, { state: { highlight: 'retell_api_key' } })}
                    className="mt-1"
                  >
                    Set Up Retell API Key
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <TabsContent value="agents" className="space-y-4">
                  {clientId && (
                    <ClientTimezoneCard
                      clientId={clientId}
                      title="Client Timezone"
                      description="Sets the timezone used by the voice agent prompt's Current Date & Time label, cadence quiet-hours scheduling, voice-booking-tools time formatting, and what the agent says (e.g. 'Sydney time')."
                    />
                  )}
                  {clientId && (
                    <SetterDisplayNamesCard
                      clientId={clientId}
                      kind="voice"
                      title="Voice Setter Names"
                      description="Custom labels shown in Simulator, Logs, Outbound runs, Conversations, AND pushed to the Retell agent as agent_name (visible in the Retell dashboard). Empty falls back to 'Setter N'."
                      slots={[
                        { slot: 1, hint: 'Inbound' },
                        { slot: 2, hint: 'Outbound' },
                        { slot: 3, hint: 'Followup' },
                        { slot: 4, hint: 'Slot 4' },
                      ]}
                    />
                  )}
                  {clientId && <RetellAgentsTab clientId={clientId} />}
                </TabsContent>

                <TabsContent value="phone-numbers">
                  {clientId && <RetellPhoneNumbersTab clientId={clientId} />}
                </TabsContent>

                <TabsContent value="call-logs">
                  {clientId && <RetellCallLogsTab clientId={clientId} />}
                </TabsContent>
              </>
            )}

            <TabsContent value="setup-guide">
              {/* Setup Phases Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {VOICE_PHASES.map(phase => {
                  const status = getPhaseStatus(phase);
                  const Icon = phase.icon;
                  return (
                    <Card
                      key={phase.id}
                      onClick={() => handlePhaseClick(phase)}
                      className={cn(
                        "material-surface cursor-pointer transition-all hover:shadow-md border-2",
                        status.isComplete
                          ? "border-green-500 bg-green-50/30 dark:bg-green-950/10"
                          : status.completed > 0
                          ? "border-amber-500 bg-amber-50/30 dark:bg-amber-950/10"
                          : "border-red-500 bg-red-50/30 dark:bg-red-950/10"
                      )}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              "p-2 rounded-lg",
                              status.isComplete
                                ? "bg-green-100 dark:bg-green-900/30"
                                : status.completed > 0
                                ? "bg-amber-100 dark:bg-amber-900/30"
                                : "bg-red-100 dark:bg-red-900/30"
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-5 w-5",
                                status.isComplete
                                  ? "text-green-600 dark:text-green-400"
                                  : status.completed > 0
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-red-600 dark:text-red-400"
                              )}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                                {phase.title}
                              </h3>
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 flex-shrink-0",
                                  status.isComplete
                                    ? "text-green-600"
                                    : status.completed > 0
                                    ? "text-amber-600"
                                    : "text-red-600"
                                )}
                              />
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {phase.description}
                            </p>
                            <div className="mt-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium">
                                  {status.completed}/{status.total} steps
                                </span>
                                <span
                                  className={cn(
                                    "text-sm font-medium",
                                    status.isComplete
                                      ? "text-green-600"
                                      : status.completed > 0
                                      ? "text-amber-600"
                                      : "text-red-600"
                                  )}
                                >
                                  {status.percentage}%
                                </span>
                              </div>
                              <Progress
                                value={status.percentage}
                                className={cn(
                                  "h-1.5",
                                  status.isComplete && "[&>div]:bg-green-500",
                                  status.completed > 0 && !status.isComplete && "[&>div]:bg-amber-500",
                                  status.completed === 0 && "[&>div]:bg-red-500"
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Setup Guide Dialog */}
      <VoiceAIRepSetupGuide
        open={setupGuideOpen}
        onOpenChange={open => {
          setSetupGuideOpen(open);
          if (!open) {
            fetchSettings();
          }
        }}
        clientId={clientId || ''}
        initialPhase={dialogInitialPhase}
        initialStep={dialogInitialStep}
        navigationKey={dialogNavigationKey}
      />
    </div>
  );
};

export default VoiceAIRepSetup;
