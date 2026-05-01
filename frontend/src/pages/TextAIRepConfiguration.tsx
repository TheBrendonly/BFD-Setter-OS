import React, { useState, useEffect } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ChevronRight, User, Database, FileUp, Wrench, MessageSquarePlus, Key, Settings, FolderOpen } from '@/components/icons';
import { cn } from '@/lib/utils';
import TextAIRepSetupGuide, { TEXT_AI_REP_PHASES, isPhaseComplete } from '@/components/setup-guide/TextAIRepSetupGuide';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { SetterDisplayNamesCard } from '@/components/setters/SetterDisplayNamesCard';

// Phase definitions for the cards grid (core setup phases only)
const TEXT_PHASES = [
  {
    id: 'account-creation',
    title: 'Accounts Setup',
    description: 'Create accounts for Supabase, n8n, and HighLevel',
    icon: User,
    dialogPhase: 0,
    dialogStep: 0
  },
  {
    id: 'supabase-setup',
    title: 'Supabase Setup',
    description: 'Configure your Supabase database connection',
    icon: Database,
    dialogPhase: 1,
    dialogStep: 0
  },
  {
    id: 'workflows-import',
    title: 'Workflows Import',
    description: 'Download and import n8n workflows',
    icon: FileUp,
    dialogPhase: 2,
    dialogStep: 0
  },
  {
    id: 'n8n-setup',
    title: 'AI Rep Setup',
    description: 'Configure your Text AI Rep workflow in n8n',
    icon: Wrench,
    dialogPhase: 3,
    dialogStep: 0
  },
  {
    id: 'text-prompts-setup',
    title: 'Prompts Setup',
    description: 'Configure your Text AI agent prompts',
    icon: MessageSquarePlus,
    dialogPhase: 4,
    dialogStep: 0
  },
  {
    id: 'highlevel-credentials',
    title: 'HighLevel Credentials',
    description: 'Set up your GoHighLevel API credentials',
    icon: Key,
    dialogPhase: 5,
    dialogStep: 0
  },
  {
    id: 'highlevel-setup',
    title: 'HighLevel Setup',
    description: 'Configure HighLevel workflows and webhooks',
    icon: Settings,
    dialogPhase: 6,
    dialogStep: 0
  },
  {
    id: 'knowledgebase-setup',
    title: 'Knowledgebase Setup',
    description: 'Set up your knowledge base workflow',
    icon: FolderOpen,
    dialogPhase: 7,
    dialogStep: 0
  }
];

const TextAIRepConfiguration = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [dialogInitialPhase, setDialogInitialPhase] = useState(0);
  const [dialogInitialStep, setDialogInitialStep] = useState(0);
  const [dialogNavigationKey, setDialogNavigationKey] = useState(0);
  const [setupGuideCompletedSteps, setSetupGuideCompletedSteps] = useState<string[]>([]);

  usePageHeader({
    title: 'Text Setter',
    breadcrumbs: [
      { label: 'Text Setter' },
      { label: 'Configuration' },
    ],
  });

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
      .channel(`text-config-sync-${clientId}`)
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
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('setup_guide_completed_steps')
        .eq('id', clientId)
        .single();

      if (error) throw error;

      if (data?.setup_guide_completed_steps) {
        const steps = data.setup_guide_completed_steps as string[];
        setSetupGuideCompletedSteps(steps);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPhaseStatus = (phase: typeof TEXT_PHASES[0]) => {
    const stepCount = TEXT_AI_REP_PHASES[phase.id] || 0;
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
    TEXT_PHASES.forEach(phase => {
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

  const handlePhaseClick = (phase: typeof TEXT_PHASES[0]) => {
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
          <Card className="material-surface mb-6">
            <CardHeader className="pb-3 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Text AI Rep Setup Progress</CardTitle>
                  <CardDescription className="mt-1">
                    Complete all phases to enable Text AI reps
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

        {/* Setup Phases Grid - Scrollable */}
        <div className="flex-1 min-h-0 overflow-auto pb-6 space-y-6">
          {clientId && (
            <SetterDisplayNamesCard
              clientId={clientId}
              kind="text"
              title="Text Setter Names"
              description="Custom labels shown in Simulator, Logs, and Conversations. Empty falls back to 'Setter N'."
              slots={[
                { slot: 1 },
                { slot: 2 },
                { slot: 3 },
                { slot: 4 },
                { slot: 5 },
                { slot: 6 },
                { slot: 7 },
                { slot: 8 },
                { slot: 9 },
                { slot: 10 },
              ]}
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEXT_PHASES.map(phase => {
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
        </div>
      </div>

      {/* Setup Guide Dialog */}
      <TextAIRepSetupGuide
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

export default TextAIRepConfiguration;
