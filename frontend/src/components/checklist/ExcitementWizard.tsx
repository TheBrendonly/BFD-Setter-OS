import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, ArrowLeft, RotateCcw, Loader2, Settings, MessageSquareText, ExternalLink, Eye } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { SETUP_PHASES, PHASE_IDS, isPhaseComplete } from '@/components/SetupGuideDialog';
import { useNavigate } from 'react-router-dom';

// Phase names matching the actual AI Reps Setup Guide titles
const PHASE_NAMES: Record<string, string> = {
  'account-creation': 'Accounts Setup',
  'supabase-setup': 'Supabase Setup',
  'text-prompts-setup': 'Text Prompts Setup',
  'highlevel-credentials': 'HighLevel Credentials',
  'highlevel-setup': 'HighLevel Setup',
  'twilio-setup': 'Twilio Setup',
  'voice-accounts-setup': 'Voice AI Rep Setup',
  'voice-prompts-setup': 'Voice Prompts Setup'
};

interface ExcitementWizardState {
  aiRepsUnderstood: boolean | null;
  promptManagementUnderstood: boolean | null;
}

interface ExcitementWizardProps {
  clientId: string;
  onComplete: () => void;
  onReset?: () => void;
  setupGuideCompletedSteps?: string[];
}

const INITIAL_STATE: ExcitementWizardState = {
  aiRepsUnderstood: null,
  promptManagementUnderstood: null,
};

export default function ExcitementWizard({ clientId, onComplete, onReset, setupGuideCompletedSteps = [] }: ExcitementWizardProps) {
  const [state, setState] = useState<ExcitementWizardState>(INITIAL_STATE);
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Load from localStorage
  useEffect(() => {
    const loadAnswers = async () => {
      try {
        const saved = localStorage.getItem(`excitement_wizard_${clientId}`);
        if (saved) {
          const data = JSON.parse(saved);
          setState(data.answers || INITIAL_STATE);
          setIsCompleted(data.is_completed || false);
          // Restore current step
          if (typeof data.current_step === 'number') {
            setCurrentStep(data.current_step);
          }
          if (data.is_completed) {
            setShowSummary(true);
          }
        }
      } catch (error) {
        console.error('Failed to load excitement wizard answers:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAnswers();
  }, [clientId]);

  // Save to localStorage
  const saveProgress = useCallback((newState: ExcitementWizardState, completed: boolean = false, step?: number) => {
    setIsSaving(true);
    try {
      // Read existing data to preserve step if not explicitly provided
      const existing = localStorage.getItem(`excitement_wizard_${clientId}`);
      let existingStep = 0;
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          existingStep = parsed.current_step ?? 0;
        } catch {}
      }
      
      const stepToSave = step !== undefined ? step : existingStep;
      localStorage.setItem(`excitement_wizard_${clientId}`, JSON.stringify({
        answers: newState,
        is_completed: completed,
        current_step: stepToSave,
        completed_at: completed ? new Date().toISOString() : null,
      }));
      
      if (completed) {
        setIsCompleted(true);
        toast({
          title: "Excitement Setup Complete!",
          description: "Your excitement configuration has been verified.",
        });
        onComplete();
      }
    } catch (error) {
      console.error('Failed to save excitement wizard answers:', error);
    } finally {
      setIsSaving(false);
    }
  }, [clientId, toast, onComplete]);

  const updateState = <K extends keyof ExcitementWizardState>(key: K, value: ExcitementWizardState[K]) => {
    setState(prev => {
      const newState = { ...prev, [key]: value };
      // Don't pass step - let it preserve existing step from localStorage
      saveProgress(newState);
      return newState;
    });
  };

  const handleNext = () => {
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    // Explicitly save the new step
    saveProgress(state, false, nextStep);
  };

  const handleBack = () => {
    const prevStep = Math.max(0, currentStep - 1);
    setCurrentStep(prevStep);
    // Explicitly save the new step
    saveProgress(state, false, prevStep);
  };

  const handleReset = () => {
    try {
      localStorage.removeItem(`excitement_wizard_${clientId}`);
      setState(INITIAL_STATE);
      setCurrentStep(0);
      setIsCompleted(false);
      setShowSummary(false);
      onReset?.();
      toast({
        title: "Reset Complete",
        description: "Your excitement wizard has been reset.",
      });
    } catch (error) {
      console.error('Failed to reset excitement wizard:', error);
      toast({
        title: "Error",
        description: "Failed to reset. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleComplete = () => {
    saveProgress(state, true);
    setShowSummary(true);
  };

  // Get phase completion status
  const getPhaseStatus = (phaseId: string): { completed: number; total: number; isComplete: boolean } => {
    const total = SETUP_PHASES[phaseId as keyof typeof SETUP_PHASES] || 0;
    let completed = 0;
    
    for (let i = 0; i < total; i++) {
      if (setupGuideCompletedSteps.includes(`${phaseId}-${i}`)) {
        completed++;
      }
    }
    
    return {
      completed,
      total,
      isComplete: completed === total
    };
  };

  // Calculate overall AI Reps setup completion
  const getOverallAiRepsStatus = () => {
    const totalSteps = PHASE_IDS.reduce((sum, id) => sum + SETUP_PHASES[id], 0);
    const completedCount = setupGuideCompletedSteps.length;
    const isComplete = PHASE_IDS.every(phaseId => isPhaseComplete(phaseId, setupGuideCompletedSteps));
    return {
      completed: completedCount,
      total: totalSteps,
      percentage: Math.round((completedCount / totalSteps) * 100),
      isComplete
    };
  };

  // Define the steps (complete is NOT a step for progress tracking)
  const steps = [
    { id: 'ai-reps-setup' },
    { id: 'prompt-management' }
  ];

  // Track if we're on the complete screen (after all steps)
  const isOnCompleteScreen = currentStep >= steps.length;
  const currentStepId = isOnCompleteScreen ? 'complete' : (steps[currentStep]?.id || 'ai-reps-setup');

  // I Understand button
  const UnderstandButton = ({ 
    value, 
    onChange 
  }: { 
    value: boolean | null; 
    onChange: (val: boolean) => void;
  }) => (
    <Button
      onClick={() => onChange(true)}
      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
    >
      <CheckCircle2 className="h-4 w-4 mr-2" />
      I Understand
    </Button>
  );

  // Summary view for completed wizard
  const renderSummary = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg border border-green-500/30">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
          <div>
            <h3 className="font-semibold text-green-700 dark:text-green-400">Excitement Setup Complete</h3>
            <p className="text-sm text-green-600 dark:text-green-500">All steps verified and saved</p>
          </div>
        </div>

        <Card className="p-4">
          <h4 className="font-semibold mb-3">Your Configuration</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">AI Reps Setup:</span>
              <span className="font-medium">{state.aiRepsUnderstood ? '✓ Reviewed' : '✗ Not Reviewed'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Excitement Prompts:</span>
              <span className="font-medium">{state.promptManagementUnderstood ? '✓ Understood' : '✗ Not Reviewed'}</span>
            </div>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setShowSummary(false)} className="flex-1">
            <Eye className="h-4 w-4 mr-2" />
            Edit Answers
          </Button>
          <Button variant="outline" onClick={handleReset} className="flex-1 text-destructive hover:text-destructive">
            <RotateCcw className="h-4 w-4 mr-2" />
            Start Over
          </Button>
        </div>
      </div>
    );
  };

  // Render step content
  const renderStepContent = () => {
    switch (currentStepId) {
      case 'ai-reps-setup':
        const overallStatus = getOverallAiRepsStatus();
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Complete AI Reps Setup First</CardTitle>
              <CardDescription>
                Before configuring excitement sequences, you need to complete the AI Reps setup. The AI text and voice representatives are essential for excitement conversations.
              </CardDescription>
            </CardHeader>

            {/* Overall progress */}
            <div className={cn(
              "rounded-lg p-4 mb-2 border",
              overallStatus.isComplete 
                ? "bg-green-500/10 border-green-500/30" 
                : overallStatus.percentage > 0
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-red-500/10 border-red-500/30"
            )}>
              <div className="flex items-center gap-3 mb-3">
                <Settings className={cn(
                  "h-5 w-5",
                  overallStatus.isComplete 
                    ? "text-green-600" 
                    : overallStatus.percentage > 0
                      ? "text-amber-600"
                      : "text-red-600"
                )} />
                <div>
                  <p className="font-medium">Overall AI Reps Setup Progress</p>
                  <p className="text-sm text-muted-foreground">
                    {overallStatus.completed}/{overallStatus.total} steps completed ({overallStatus.percentage}%)
                  </p>
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className={cn(
                    "h-2 rounded-full transition-all",
                    overallStatus.isComplete 
                      ? "bg-green-500" 
                      : overallStatus.percentage > 0
                        ? "bg-amber-500"
                        : "bg-red-500"
                  )}
                  style={{ width: `${Math.max(overallStatus.percentage, 2)}%` }}
                />
              </div>
            </div>

            {/* Phase list */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">AI Reps Setup Phases Status</h4>
              
              {PHASE_IDS.map((phaseId) => {
                const status = getPhaseStatus(phaseId);
                const phaseName = PHASE_NAMES[phaseId] || phaseId;
                
                return (
                  <div 
                    key={phaseId}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border-2 transition-all",
                      status.isComplete 
                        ? "border-green-500 bg-green-50/50 dark:bg-green-950/20" 
                        : "border-red-500 bg-red-50/50 dark:bg-red-950/20"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {status.isComplete ? (
                        <CheckCircle2 className="h-[21px] w-[21px] text-green-600 dark:text-green-400" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-red-500" />
                      )}
                      <span className="font-medium">{phaseName}</span>
                    </div>
                    <span className={cn(
                      "text-sm font-medium",
                      status.isComplete ? "text-green-600" : "text-red-500"
                    )}>
                      {status.completed}/{status.total} steps
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-sm">
                <strong>Important:</strong> All phases above must be completed in the AI Reps Guide before your excitement sequences will work properly.
              </p>
            </div>

            <div className="pt-4 space-y-3">
              <Button
                onClick={() => navigate(`/client/${clientId}/api`)}
                variant="outline"
                className="w-full"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Go to AI Reps Setup
              </Button>
              
              <UnderstandButton 
                value={state.aiRepsUnderstood} 
                onChange={(val) => {
                  updateState('aiRepsUnderstood', val);
                  handleNext();
                }} 
              />
            </div>
          </div>
        );

      case 'prompt-management':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Excitement is All About Hyping Up Your Leads</CardTitle>
              <CardDescription>
                The excitement phase happens before the webinar to get leads pumped up and committed to showing up
              </CardDescription>
            </CardHeader>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">What does "Excitement" mean for your AI?</p>
              <ul className="text-sm space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span><strong>Hype Up the Lead:</strong> Build anticipation and excitement about the upcoming webinar</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span><strong>Show the Value:</strong> Remind them what they'll learn and why it matters to them</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span><strong>Why They Need to Show Up:</strong> Create urgency and FOMO about missing out</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span><strong>Reconfirm Attendance:</strong> At the end, ask something like "Are you planning to show up?" to get commitment</span>
                </li>
              </ul>
            </div>

            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <p className="font-medium text-green-700 dark:text-green-400">Good News!</p>
              </div>
              <p className="text-sm text-muted-foreground">
                All of these elements are already included in the <strong>default prompts</strong> we provide. Just make sure you <strong>don't remove or modify</strong> these key excitement elements when customizing for your use case.
              </p>
            </div>

            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5 text-primary" />
                <p className="font-medium">Prompt Management</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Review and customize your excitement prompts in the <strong>Prompt Management</strong> section. The excitement script should build anticipation while maintaining the core structure.
              </p>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-sm">
                <strong>Remember:</strong> The goal is to get leads excited AND committed. Always end with a confirmation question to increase show-up rates.
              </p>
            </div>

            <Button
              onClick={() => navigate(`/client/${clientId}/prompts/text`)}
              variant="outline"
              className="w-full"
            >
              <MessageSquareText className="w-4 h-4 mr-2" />
              Go to Prompt Management
            </Button>

            <UnderstandButton 
              value={state.promptManagementUnderstood} 
              onChange={(val) => {
                updateState('promptManagementUnderstood', val);
                handleNext();
              }} 
            />
          </div>
        );

      case 'complete':
        return (
          <div className="space-y-4">
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <h3 className="text-xl font-bold text-green-600 dark:text-green-400 mb-2">
                All Excitement Steps Complete!
              </h3>
              <p className="text-muted-foreground">
                You understand how AI excitement works and where to configure it.
              </p>
            </div>

            <Card className="p-4 bg-green-500/5 border-green-500/20">
              <h4 className="font-semibold mb-3 text-green-700 dark:text-green-400">What you've configured:</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>AI Reps setup reviewed and understood</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Excitement prompt elements identified</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Hype and reconfirmation flow understood</span>
                </li>
              </ul>
            </Card>

            <Button
              onClick={handleComplete}
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={isSaving}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Complete Excitement Setup'}
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (showSummary && isCompleted) {
    return renderSummary();
  }

  return (
    <div className="space-y-4">
      {/* Progress indicator - segmented like Followups */}
      {!isOnCompleteScreen && (
        <>
          <div className="flex items-center gap-1.5 mb-4">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-all",
                  index < currentStep 
                    ? "bg-green-500" 
                    : index === currentStep 
                      ? "bg-primary" 
                      : "bg-muted"
                )}
              />
            ))}
          </div>

          {/* Step counter */}
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
            <span>Step {currentStep + 1} of {steps.length}</span>
            {currentStep > 0 && (
              <Button variant="outline" size="sm" onClick={handleBack} className="text-foreground border-border hover:bg-muted">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
          </div>
        </>
      )}

      {/* Step content */}
      {renderStepContent()}

      {/* Saving indicator */}
      {isSaving && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}
    </div>
  );
}
