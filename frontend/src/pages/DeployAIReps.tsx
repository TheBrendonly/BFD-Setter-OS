import React, { useState, useEffect } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getCached, setCache } from '@/lib/queryCache';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ChevronRight, MessageSquare, MessageCircle, Phone, Play, Instagram, PhoneIncoming } from '@/components/icons';
import { cn } from '@/lib/utils';
import DeployAIRepsSetupGuide, { DEPLOY_AI_REPS_PHASES, isPhaseComplete } from '@/components/setup-guide/DeployAIRepsSetupGuide';
import { usePageHeader } from '@/contexts/PageHeaderContext';

// Phase definitions for the cards grid
const DEPLOY_PHASES = [
  {
    id: 'live-chat-setup',
    title: 'Live Chat Setup',
    description: 'Deploy and test your AI Rep with Live Chat widget',
    icon: MessageSquare,
    dialogPhase: 0,
    dialogStep: 0
  },
  {
    id: 'whatsapp-setup',
    title: 'WhatsApp Setup',
    description: 'Connect WhatsApp to your AI Rep',
    icon: MessageCircle,
    dialogPhase: 1,
    dialogStep: 0
  },
  {
    id: 'sms-setup',
    title: 'SMS Setup',
    description: 'Set up SMS texting with A2P verification',
    icon: Phone,
    dialogPhase: 2,
    dialogStep: 0
  },
  {
    id: 'meta-instagram-setup',
    title: 'Meta/Instagram Setup',
    description: 'Connect Facebook and Instagram to your AI Rep',
    icon: Instagram,
    dialogPhase: 3,
    dialogStep: 0
  },
  {
    id: 'inbound-voice-ai-testing',
    title: 'Inbound Voice AI Testing',
    description: 'Test your Inbound Voice AI Rep with a live call',
    icon: PhoneIncoming,
    dialogPhase: 4,
    dialogStep: 0
  },
  {
    id: 'demo-setup',
    title: 'Demo Setup',
    description: 'Set up a demo to test your AI Rep workflow',
    icon: Play,
    dialogPhase: 5,
    dialogStep: 0
  }
];

const DeployAIReps = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);

  usePageHeader({ title: 'Deploy AI Reps' });
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);
  const [dialogInitialPhase, setDialogInitialPhase] = useState(0);
  const [dialogInitialStep, setDialogInitialStep] = useState(0);
  const [dialogNavigationKey, setDialogNavigationKey] = useState(0);
  const [setupGuideCompletedSteps, setSetupGuideCompletedSteps] = useState<string[]>([]);

  useEffect(() => {
    if (clientId) {
      fetchSettings();
    }
  }, [clientId]);

  const fetchSettings = async () => {
    const cacheKey = `deploy_steps_${clientId}`;
    const cached = getCached<string[]>(cacheKey);
    if (cached) {
      setSetupGuideCompletedSteps(cached);
      setLoading(false);
    }
    try {
      const { data, error } = await supabase
        .from('clients_public')
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

  const getPhaseStatus = (phase: typeof DEPLOY_PHASES[0]) => {
    const stepCount = DEPLOY_AI_REPS_PHASES[phase.id] || 0;
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
    DEPLOY_PHASES.forEach(phase => {
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

  const handlePhaseClick = (phase: typeof DEPLOY_PHASES[0]) => {
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
                  <CardTitle className="text-lg">Deploy AI Reps Progress</CardTitle>
                  <CardDescription className="mt-1">
                    Deploy your AI Reps across different channels
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
        <div className="flex-1 min-h-0 overflow-auto pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {DEPLOY_PHASES.map(phase => {
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
      <DeployAIRepsSetupGuide
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

export default DeployAIReps;
