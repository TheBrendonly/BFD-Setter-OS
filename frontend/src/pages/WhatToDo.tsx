import React from 'react';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useParams, useNavigate } from 'react-router-dom';
import { Settings, MessageSquare, Mic, Rocket, Bug, BookOpen, ChevronRight, Play, ClipboardCheck, GraduationCap, ExternalLink, CheckCircle2 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useWhatToDoAcknowledged } from '@/hooks/useWhatToDoAcknowledged';
import { useSetupGuideProgress } from '@/hooks/useSetupGuideProgress';

interface OnboardingStep {
  id: string;
  step: number;
  title: string;
  description: string;
  icon: React.ElementType;
  route?: string;
  externalUrl?: string;
  buttonText: string;
  warning?: string;
}

const onboardingSteps: OnboardingStep[] = [
  {
    id: 'technical-course',
    step: 1,
    title: 'Complete Technical Course (upstream)',
    description: 'Walk through the upstream 1prompt-os technical course on Skool to understand how the underlying system works before configuring BFD-setter.',
    icon: GraduationCap,
    externalUrl: 'https://www.skool.com/1prompt/classroom/174df031?md=9a229dd14bb947c1bdd263fb2d38afa4',
    buttonText: 'Go to Course',
    warning: 'You must complete this step first. Even though this dashboard contains the most up-to-date version of the system, you still need to understand how everything works. If you are already proficient in n8n and GoHighLevel, we still recommend going through the course.',
  },
  {
    id: 'text-ai-config',
    step: 2,
    title: 'Text AI Rep Configuration',
    description: 'Go to AI Reps Setup → Configuration and complete all the steps to enable your Text AI Rep',
    icon: Settings,
    route: '/text-ai-rep/configuration',
    buttonText: 'Go to Configuration',
    warning: 'This step contains the Supabase setup which is required before you can start working with the system.',
  },
  {
    id: 'text-prompts',
    step: 3,
    title: 'Text AI Rep Prompts',
    description: 'Go to Prompt Management → Text AI Rep and setup your bot persona and the main agent prompts',
    icon: MessageSquare,
    route: '/prompts/text',
    buttonText: 'Go to Text AI Rep Prompts',
  },
  {
    id: 'voice-ai-config',
    step: 4,
    title: 'Voice AI Rep Configuration',
    description: 'Go to AI Reps Setup → Configuration and complete all the steps to enable your Voice AI Rep',
    icon: Settings,
    route: '/voice-ai-rep/configuration',
    buttonText: 'Go to Configuration',
  },
  {
    id: 'voice-prompts',
    step: 5,
    title: 'Voice AI Rep Prompts',
    description: 'Go to Prompt Management → Voice AI Rep and setup all the prompts for voice conversations',
    icon: Mic,
    route: '/prompts/voice',
    buttonText: 'Go to Voice AI Rep Prompts',
  },
  {
    id: 'deploy-ai-reps',
    step: 6,
    title: 'Deploy AI Reps',
    description: 'Go to Deploy AI Reps and follow the steps to deploy your AI Representatives to different channels',
    icon: Rocket,
    route: '/deploy-ai-reps',
    buttonText: 'Go to Deploy AI Reps',
  },
  {
    id: 'debug-ai-reps',
    step: 7,
    title: 'Debug AI Reps',
    description: 'When something is not working, use this step-by-step guide to identify and fix issues with your AI Representatives',
    icon: Bug,
    route: '/debug-ai-reps',
    buttonText: 'Go to Debug AI Reps',
  },
  {
    id: 'knowledge-base',
    step: 8,
    title: 'Knowledge Base',
    description: 'Once everything is functioning, add more documents to your Knowledge Base to improve your AI Representatives',
    icon: BookOpen,
    route: '/knowledge-base',
    buttonText: 'Go to Knowledge Base',
  },
];

const WhatToDo = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { acknowledged, acknowledge, isLoading: isAcknowledgedLoading } = useWhatToDoAcknowledged(clientId);
  const { isStepCompleted, toggleStep, isLoading: isProgressLoading } = useSetupGuideProgress(clientId);

  usePageHeader({ title: 'Setup Guide' });

  // Show nothing while loading to prevent flickering
  if (isAcknowledgedLoading || isProgressLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto max-w-7xl py-8">
          <div className="flex flex-col max-w-4xl mx-auto space-y-4">
            {/* Loading skeleton */}
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const handleNavigate = (item: OnboardingStep) => {
    if (item.externalUrl) {
      window.open(item.externalUrl, '_blank', 'noopener,noreferrer');
    } else if (item.route && clientId) {
      const normalized = item.route.replace(/^\/+/, "");
      navigate(`/client/${clientId}/${normalized}`, { replace: false });
    }
  };

  // Find the current step index (first incomplete step)
  const getCurrentStepIndex = (): number => {
    if (!acknowledged) return -1; // No current step if not acknowledged
    for (let i = 0; i < onboardingSteps.length; i++) {
      if (!isStepCompleted(onboardingSteps[i].id)) {
        return i;
      }
    }
    return -1; // All steps completed
  };

  const currentStepIndex = getCurrentStepIndex();

  // Helper to get arrow color classes based on step completion
  const getArrowColorClasses = (isCompleted: boolean) => {
    if (isCompleted) {
      return {
        line: 'bg-green-500',
        circle: 'bg-green-500 text-white',
        arrow: 'text-green-500',
      };
    }
    return {
      line: 'bg-muted-foreground/30',
      circle: 'bg-muted-foreground/30 text-muted-foreground',
      arrow: 'text-muted-foreground/30',
    };
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl">
        {/* Steps Flow */}
        <div className="flex flex-col max-w-4xl mx-auto">
          {/* START HERE block */}
          <Card className={`material-surface border-2 ${!acknowledged ? 'animate-pulse-red border-red-500/50 bg-red-500/5' : 'border-green-500 bg-green-50/30 dark:bg-green-950/10'}`}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${acknowledged ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                    <Play className={`h-5 w-5 ${acknowledged ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                      Start Here
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Go through everything in this order to make sure you have the best experience possible
                    </p>
                  </div>
                </div>
                {!acknowledged && (
                  <Button 
                    onClick={acknowledge}
                    className="flex-shrink-0"
                  >
                    Acknowledge
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Arrow to first step */}
          {(() => {
            const firstStepCompleted = isStepCompleted(onboardingSteps[0]?.id || '');
            const colors = getArrowColorClasses(firstStepCompleted);
            return (
              <div className="flex flex-col items-center py-1">
                <div className={`w-0.5 h-8 ${colors.line}`} />
                <div className={`flex items-center justify-center w-6 h-6 rounded-full font-medium text-xs my-1 ${colors.circle}`}>
                  1
                </div>
                <div className={`w-0.5 h-6 ${colors.line}`} />
                <svg 
                  className={`w-3 h-3 -mt-1 ${colors.arrow}`}
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M12 16l-6-6h12l-6 6z" />
                </svg>
              </div>
            );
          })()}

          {onboardingSteps.map((item, index) => {
            const Icon = item.icon;
            const isLast = index === onboardingSteps.length - 1;
            const stepCompleted = isStepCompleted(item.id);
            const isCurrentStep = index === currentStepIndex;
            const nextStepCompleted = !isLast && isStepCompleted(onboardingSteps[index + 1]?.id || '');
            const arrowColors = getArrowColorClasses(nextStepCompleted);

            // Determine card styling: green if completed, red if current step, neutral otherwise
            const getCardClasses = () => {
              if (stepCompleted) {
                return 'border-2 border-green-500 bg-green-50/30 dark:bg-green-950/10';
              }
              if (isCurrentStep) {
                return 'border-2 animate-pulse-red border-red-500/50 bg-red-500/5';
              }
              return '';
            };

            const getIconContainerClasses = () => {
              if (stepCompleted) {
                return 'bg-green-100 dark:bg-green-900/30';
              }
              if (isCurrentStep) {
                return 'bg-red-100 dark:bg-red-900/30';
              }
              return 'bg-primary/10';
            };

            const getIconClasses = () => {
              if (stepCompleted) {
                return 'text-green-600 dark:text-green-400';
              }
              if (isCurrentStep) {
                return 'text-red-600 dark:text-red-400';
              }
              return 'text-primary';
            };

            return (
              <div key={item.id} className="flex flex-col">
                {/* Warning box if present */}
                {item.warning && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-3">
                    <p className="text-sm text-foreground">
                      {item.warning}
                    </p>
                  </div>
                )}

                {/* Step Block */}
                <Card 
                  className={`material-surface cursor-pointer transition-all hover:shadow-md ${getCardClasses()}`}
                  onClick={() => handleNavigate(item)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center gap-4">
                      {/* Icon */}
                      <div className={`p-2 rounded-lg flex-shrink-0 ${getIconContainerClasses()}`}>
                        <Icon className={`h-5 w-5 ${getIconClasses()}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                          {item.title}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {item.description}
                        </p>
                      </div>

                      {/* Buttons */}
                      <div className="flex flex-col gap-2 flex-shrink-0 items-end">
                        <Button 
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNavigate(item);
                          }}
                        >
                          {item.buttonText}
                          {item.externalUrl ? (
                            <ExternalLink className="h-4 w-4 ml-1" />
                          ) : (
                            <ChevronRight className="h-4 w-4 ml-1" />
                          )}
                        </Button>
                        <Button 
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStep(item.id);
                          }}
                          className={stepCompleted 
                            ? 'bg-gray-500 hover:bg-gray-600 text-white' 
                            : 'bg-green-500 hover:bg-green-600 text-white'
                          }
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          {stepCompleted ? 'Undone' : 'Done'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Arrow with step number to next step */}
                {!isLast && (
                  <div className="flex flex-col items-center py-1">
                    <div className={`w-0.5 h-8 ${arrowColors.line}`} />
                    <div className={`flex items-center justify-center w-6 h-6 rounded-full font-medium text-xs my-1 ${arrowColors.circle}`}>
                      {item.step + 1}
                    </div>
                    <div className={`w-0.5 h-6 ${arrowColors.line}`} />
                    <svg 
                      className={`w-3 h-3 -mt-1 ${arrowColors.arrow}`}
                      fill="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 16l-6-6h12l-6 6z" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}

          {/* Final arrow */}
          <div className="flex flex-col items-center py-1">
            <div className="w-0.5 h-8 bg-muted-foreground/30" />
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted-foreground/30 text-muted-foreground my-1">
              <ClipboardCheck className="h-3 w-3" />
            </div>
            <div className="w-0.5 h-6 bg-muted-foreground/30" />
            <svg 
              className="w-3 h-3 text-muted-foreground/30 -mt-1" 
              fill="currentColor" 
              viewBox="0 0 24 24"
            >
              <path d="M12 16l-6-6h12l-6 6z" />
            </svg>
          </div>

          {/* Completion block */}
          <Card className="material-surface border-2 border-green-500 bg-green-50/30 dark:bg-green-950/10">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 flex-shrink-0">
                  <ClipboardCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                    You're All Set!
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your AI Representatives are fully configured and ready to go
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default WhatToDo;
