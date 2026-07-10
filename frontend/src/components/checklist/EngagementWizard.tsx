import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, ArrowLeft, RotateCcw, Eye, Loader2, MessageSquare, Mail, Phone, Settings, ExternalLink } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { SETUP_PHASES, PHASE_IDS, isPhaseComplete } from '@/components/SetupGuideDialog';
import { useNavigate } from 'react-router-dom';

// Import engagement guide images
import engagementSmsPhoneSetup from '@/assets/engagement-sms-phone-setup.png';
import engagementSmsWorkflow from '@/assets/engagement-sms-workflow.png';
import engagementEmailSetup from '@/assets/engagement-email-setup.png';
import engagementEmailWorkflow from '@/assets/engagement-email-workflow.png';
import engagementWhatsappSetup from '@/assets/engagement-whatsapp-setup.png';
import engagementWhatsappTemplates from '@/assets/engagement-whatsapp-templates.png';
import engagementWhatsappWorkflow from '@/assets/engagement-whatsapp-workflow.png';
import engagementPhoneCallWorkflow from '@/assets/engagement-phone-call-workflow.png';
import engagementWorkflowTrigger from '@/assets/engagement-workflow-trigger.png';

type EngagementChannel = 'sms' | 'email' | 'whatsapp' | 'phone';

interface EngagementWizardState {
  selectedChannels: EngagementChannel[];
  // SMS confirmations
  smsPhoneConnected: boolean | null;
  smsWorkflowSetup: boolean | null;
  // Email confirmations
  emailAccountSetup: boolean | null;
  emailWorkflowSetup: boolean | null;
  // WhatsApp confirmations
  whatsappNumberSetup: boolean | null;
  whatsappTemplateApproved: boolean | null;
  whatsappWorkflowSetup: boolean | null;
  // Phone Call confirmations
  phoneAiRepsComplete: boolean | null;
  phoneOutboundCallSetup: boolean | null;
  // Final confirmations (applies to all)
  workflowTriggerSetup: boolean | null;
  workflowPublished: boolean | null;
}

interface EngagementWizardProps {
  clientId: string;
  onComplete: () => void;
  onReset?: () => void;
  setupGuideCompletedSteps?: string[];
}

const INITIAL_STATE: EngagementWizardState = {
  selectedChannels: [],
  smsPhoneConnected: null,
  smsWorkflowSetup: null,
  emailAccountSetup: null,
  emailWorkflowSetup: null,
  whatsappNumberSetup: null,
  whatsappTemplateApproved: null,
  whatsappWorkflowSetup: null,
  phoneAiRepsComplete: null,
  phoneOutboundCallSetup: null,
  workflowTriggerSetup: null,
  workflowPublished: null,
};

import { ZoomableImage } from '@/components/ui/zoomable-image';

const GuideImage = ({ src, alt }: { src: string; alt: string }) => (
  <ZoomableImage src={src} alt={alt} containerClassName="mb-4" />
);

export default function EngagementWizard({ clientId, onComplete, onReset, setupGuideCompletedSteps = [] }: EngagementWizardProps) {
  const [state, setState] = useState<EngagementWizardState>(INITIAL_STATE);
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
        const saved = localStorage.getItem(`engagement_wizard_${clientId}`);
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
        console.error('Failed to load engagement wizard answers:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAnswers();
  }, [clientId]);

  // Save to localStorage
  const saveProgress = useCallback((newState: EngagementWizardState, completed: boolean = false, step?: number) => {
    setIsSaving(true);
    try {
      // Read existing data to preserve step if not explicitly provided
      const existing = localStorage.getItem(`engagement_wizard_${clientId}`);
      let existingStep = 0;
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          existingStep = parsed.current_step ?? 0;
        } catch {}
      }
      
      const stepToSave = step !== undefined ? step : existingStep;
      localStorage.setItem(`engagement_wizard_${clientId}`, JSON.stringify({
        answers: newState,
        is_completed: completed,
        current_step: stepToSave,
        completed_at: completed ? new Date().toISOString() : null,
      }));
      
      if (completed) {
        setIsCompleted(true);
        toast({
          title: "Engagement Setup Complete!",
          description: "Your engagement channels have been configured.",
        });
        onComplete();
      }
    } catch (error) {
      console.error('Failed to save engagement wizard answers:', error);
    } finally {
      setIsSaving(false);
    }
  }, [clientId, toast, onComplete]);

  const updateState = <K extends keyof EngagementWizardState>(key: K, value: EngagementWizardState[K]) => {
    setState(prev => {
      const newState = { ...prev, [key]: value };
      // Don't pass step - let it preserve existing step from localStorage
      saveProgress(newState);
      return newState;
    });
  };

  const toggleChannel = (channel: EngagementChannel) => {
    setState(prev => {
      const channels = prev.selectedChannels.includes(channel)
        ? prev.selectedChannels.filter(c => c !== channel)
        : [...prev.selectedChannels, channel];
      const newState = { ...prev, selectedChannels: channels };
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
      localStorage.removeItem(`engagement_wizard_${clientId}`);
      setState(INITIAL_STATE);
      setCurrentStep(0);
      setIsCompleted(false);
      setShowSummary(false);
      onReset?.();
      toast({
        title: "Reset Complete",
        description: "Your engagement wizard has been reset.",
      });
    } catch (error) {
      console.error('Failed to reset engagement wizard:', error);
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

  // Calculate AI Reps setup completion status
  const getAiRepsStatus = () => {
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

  // Build dynamic steps based on selected channels
  const buildSteps = () => {
    const steps: { id: string; channel?: EngagementChannel }[] = [
      { id: 'channel-selection' }
    ];

    // Add steps for each selected channel in order: SMS, Email, WhatsApp, Phone
    const channelOrder: EngagementChannel[] = ['sms', 'email', 'whatsapp', 'phone'];
    
    for (const channel of channelOrder) {
      if (state.selectedChannels.includes(channel)) {
        switch (channel) {
          case 'sms':
            steps.push({ id: 'sms-phone-setup', channel: 'sms' });
            steps.push({ id: 'sms-workflow-setup', channel: 'sms' });
            break;
          case 'email':
            steps.push({ id: 'email-account-setup', channel: 'email' });
            steps.push({ id: 'email-workflow-setup', channel: 'email' });
            break;
          case 'whatsapp':
            steps.push({ id: 'whatsapp-number-setup', channel: 'whatsapp' });
            steps.push({ id: 'whatsapp-template-approval', channel: 'whatsapp' });
            steps.push({ id: 'whatsapp-workflow-setup', channel: 'whatsapp' });
            break;
          case 'phone':
            steps.push({ id: 'phone-ai-reps-check', channel: 'phone' });
            steps.push({ id: 'phone-outbound-setup', channel: 'phone' });
            break;
        }
      }
    }

    // Add final steps that apply to all (complete is NOT a step for progress tracking)
    if (state.selectedChannels.length > 0) {
      steps.push({ id: 'workflow-trigger' });
      steps.push({ id: 'workflow-publish' });
    }

    return steps;
  };

  const steps = buildSteps();
  const currentStepData = steps[currentStep];
  
  // Track if we're on the complete screen (after all steps)
  const isOnCompleteScreen = currentStep >= steps.length && state.selectedChannels.length > 0;
  const currentStepId = isOnCompleteScreen ? 'complete' : (currentStepData?.id || 'channel-selection');

  // Check if current step is complete
  const isCurrentStepComplete = () => {
    switch (currentStepId) {
      case 'channel-selection':
        return state.selectedChannels.length > 0;
      case 'sms-phone-setup':
        return state.smsPhoneConnected !== null;
      case 'sms-workflow-setup':
        return state.smsWorkflowSetup !== null;
      case 'email-account-setup':
        return state.emailAccountSetup !== null;
      case 'email-workflow-setup':
        return state.emailWorkflowSetup !== null;
      case 'whatsapp-number-setup':
        return state.whatsappNumberSetup !== null;
      case 'whatsapp-template-approval':
        return state.whatsappTemplateApproved !== null;
      case 'whatsapp-workflow-setup':
        return state.whatsappWorkflowSetup !== null;
      case 'phone-ai-reps-check':
        return state.phoneAiRepsComplete !== null;
      case 'phone-outbound-setup':
        return state.phoneOutboundCallSetup !== null;
      case 'workflow-trigger':
        return state.workflowTriggerSetup !== null;
      case 'workflow-publish':
        return state.workflowPublished !== null;
      default:
        return false;
    }
  };

  // Option button matching TrafficWizard style
  const OptionButton = ({ 
    selected, 
    onClick, 
    icon: Icon, 
    children, 
    description 
  }: { 
    selected: boolean; 
    onClick: () => void; 
    icon?: React.ElementType;
    children: React.ReactNode;
    description?: string;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border-2 transition-all duration-200 text-left p-6",
        "hover:border-primary/50 hover:bg-primary/5",
        selected 
          ? "border-primary bg-primary/10" 
          : "border-border bg-card"
      )}
    >
      <div className="flex gap-3 items-center">
        {Icon && (
          <div className={cn(
            "p-2 rounded-lg",
            selected ? "bg-primary text-primary-foreground" : "bg-muted"
          )}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1">
          <span className="font-medium block">{children}</span>
          {description && (
            <span className="text-sm text-muted-foreground">{description}</span>
          )}
        </div>
        {selected && <CheckCircle2 className="h-5 w-5 text-primary" />}
      </div>
    </button>
  );

  // Confirmation button matching other wizards
  const ConfirmButton = ({ 
    value, 
    onChange,
    label = "I've Done This"
  }: { 
    value: boolean | null; 
    onChange: (val: boolean) => void;
    label?: string;
  }) => (
    <Button
      onClick={() => onChange(true)}
      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
    >
      <CheckCircle2 className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );

  // I Understand button for phone AI reps check
  const UnderstandButton = ({ 
    value, 
    onChange 
  }: { 
    value: boolean | null; 
    onChange: (val: boolean) => void;
  }) => (
    <div className="flex gap-3 w-full">
      <Button
        onClick={() => onChange(true)}
        className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        <CheckCircle2 className="h-4 w-4 mr-2" />
        I Understand
      </Button>
    </div>
  );

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

  const AiRepsStatusDisplay = () => {
    const status = getAiRepsStatus();
    return (
      <div className="space-y-4">
        {/* Overall progress */}
        <div className={cn(
          "rounded-lg p-4 border",
          status.isComplete 
            ? "bg-green-500/10 border-green-500/30" 
            : status.percentage > 0
              ? "bg-amber-500/10 border-amber-500/30"
              : "bg-red-500/10 border-red-500/30"
        )}>
          <div className="flex items-center gap-3 mb-3">
            <Settings className={cn(
              "h-5 w-5",
              status.isComplete 
                ? "text-green-600" 
                : status.percentage > 0
                  ? "text-amber-600"
                  : "text-red-600"
            )} />
            <div>
              <p className="font-medium">Overall AI Reps Setup Progress</p>
              <p className="text-sm text-muted-foreground">
                {status.completed}/{status.total} steps completed ({status.percentage}%)
              </p>
            </div>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div 
              className={cn(
                "h-2 rounded-full transition-all",
                status.isComplete 
                  ? "bg-green-500" 
                  : status.percentage > 0
                    ? "bg-amber-500"
                    : "bg-red-500"
              )}
              style={{ width: `${Math.max(status.percentage, 2)}%` }}
            />
          </div>
        </div>

        {/* Phase list */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">AI Reps Setup Phases Status</h4>
          
          {PHASE_IDS.map((phaseId) => {
            const phaseStatus = getPhaseStatus(phaseId);
            const phaseName = PHASE_NAMES[phaseId] || phaseId;
            
            return (
              <div 
                key={phaseId}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border-2 transition-all",
                  phaseStatus.isComplete 
                    ? "border-green-500 bg-green-50/50 dark:bg-green-950/20" 
                    : "border-red-500 bg-red-50/50 dark:bg-red-950/20"
                )}
              >
                <div className="flex items-center gap-3">
                  {phaseStatus.isComplete ? (
                    <CheckCircle2 className="h-[21px] w-[21px] text-green-600 dark:text-green-400" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-red-500" />
                  )}
                  <span className="font-medium">{phaseName}</span>
                </div>
                <span className={cn(
                  "text-sm font-medium",
                  phaseStatus.isComplete ? "text-green-600" : "text-red-500"
                )}>
                  {phaseStatus.completed}/{phaseStatus.total} steps
                </span>
              </div>
            );
          })}
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
          <p className="text-sm">
            <strong>Important:</strong> All phases above must be completed in the AI Reps Guide before phone call engagement will work properly.
          </p>
        </div>
      </div>
    );
  };

  // Summary view for completed wizard - matching LandingWizard style
  const renderSummary = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg border border-green-500/30">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
          <div>
            <h3 className="font-semibold text-green-700 dark:text-green-400">Engagement Setup Complete</h3>
            <p className="text-sm text-green-600 dark:text-green-500">All channels verified and saved</p>
          </div>
        </div>

        <Card className="p-4">
          <h4 className="font-semibold mb-3">Your Configuration</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Channels:</span>
              <span className="font-medium">{state.selectedChannels.map(c => c.toUpperCase()).join(', ')}</span>
            </div>
            {state.selectedChannels.includes('sms') && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SMS Phone Connected:</span>
                  <span className="font-medium">{state.smsPhoneConnected ? '✓ Ready' : '✗ Not Ready'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SMS Workflow:</span>
                  <span className="font-medium">{state.smsWorkflowSetup ? '✓ Configured' : '✗ Not Configured'}</span>
                </div>
              </>
            )}
            {state.selectedChannels.includes('email') && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email Account:</span>
                  <span className="font-medium">{state.emailAccountSetup ? '✓ Ready' : '✗ Not Ready'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email Workflow:</span>
                  <span className="font-medium">{state.emailWorkflowSetup ? '✓ Configured' : '✗ Not Configured'}</span>
                </div>
              </>
            )}
            {state.selectedChannels.includes('whatsapp') && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">WhatsApp Number:</span>
                  <span className="font-medium">{state.whatsappNumberSetup ? '✓ Connected' : '✗ Not Connected'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">WhatsApp Template:</span>
                  <span className="font-medium">{state.whatsappTemplateApproved ? '✓ Approved' : '✗ Not Approved'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">WhatsApp Workflow:</span>
                  <span className="font-medium">{state.whatsappWorkflowSetup ? '✓ Configured' : '✗ Not Configured'}</span>
                </div>
              </>
            )}
            {state.selectedChannels.includes('phone') && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AI Reps Setup:</span>
                  <span className="font-medium">{state.phoneAiRepsComplete ? '✓ Complete' : '✗ Incomplete'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Outbound Call:</span>
                  <span className="font-medium">{state.phoneOutboundCallSetup ? '✓ Configured' : '✗ Not Configured'}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Workflow Trigger:</span>
              <span className="font-medium">{state.workflowTriggerSetup ? '✓ Correct Form' : '✗ Not Set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Workflow Published:</span>
              <span className="font-medium">{state.workflowPublished ? '✓ Published' : '✗ Not Published'}</span>
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

  const renderStepContent = () => {
    switch (currentStepId) {
      case 'channel-selection':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Which engagement channels are you using?</CardTitle>
              <CardDescription>
                Select all the channels you want to use for engaging webinar signups
              </CardDescription>
            </CardHeader>
            <div className="space-y-3">
              <OptionButton
                selected={state.selectedChannels.includes('sms')}
                onClick={() => toggleChannel('sms')}
                icon={MessageSquare}
                description="Send text messages to engage with signups"
              >
                SMS
              </OptionButton>
              <OptionButton
                selected={state.selectedChannels.includes('email')}
                onClick={() => toggleChannel('email')}
                icon={Mail}
                description="Send email communications to signups"
              >
                Email
              </OptionButton>
              <OptionButton
                selected={state.selectedChannels.includes('whatsapp')}
                onClick={() => toggleChannel('whatsapp')}
                icon={MessageSquare}
                description="Engage via WhatsApp messaging"
              >
                WhatsApp
              </OptionButton>
              <OptionButton
                selected={state.selectedChannels.includes('phone')}
                onClick={() => toggleChannel('phone')}
                icon={Phone}
                description="AI voice agent makes outbound calls"
              >
                Phone Call
              </OptionButton>
            </div>
          </div>
        );

      case 'sms-phone-setup':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Have you connected a phone number for SMS?</CardTitle>
              <CardDescription>
                Make sure you've connected a phone number to HighLevel for SMS messaging
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementSmsPhoneSetup} alt="HighLevel Phone System" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>You need to have:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Connected your Twilio account to HighLevel, OR</li>
                <li>Bought a phone number directly on HighLevel</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.smsPhoneConnected} 
              onChange={(val) => {
                updateState('smsPhoneConnected', val);
                handleNext();
              }}
              label="Phone Number is Connected"
            />
          </div>
        );

      case 'sms-workflow-setup':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Is the SMS engagement workflow configured?</CardTitle>
              <CardDescription>
                Configure the SMS node in the Engagement workflow to send outbound messages
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementSmsWorkflow} alt="SMS Workflow Node" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>In the Engagement workflow:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Find the "SMS Engagement" node</li>
                <li>Customize the message with your webinar details</li>
                <li>Make sure the workflow is enabled</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.smsWorkflowSetup} 
              onChange={(val) => {
                updateState('smsWorkflowSetup', val);
                handleNext();
              }}
              label="SMS Workflow is Configured"
            />
          </div>
        );

      case 'email-account-setup':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Have you setup your email in HighLevel?</CardTitle>
              <CardDescription>
                Configure your email sending service for engagement emails
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementEmailSetup} alt="HighLevel Email Services" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>You need to have:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Set up your email service (SMTP or LeadConnector)</li>
                <li>Verified your sending domain for better deliverability</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.emailAccountSetup} 
              onChange={(val) => {
                updateState('emailAccountSetup', val);
                handleNext();
              }}
              label="Email is Set Up"
            />
          </div>
        );

      case 'email-workflow-setup':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Is the email engagement workflow configured?</CardTitle>
              <CardDescription>
                Configure the Email node in the Engagement workflow
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementEmailWorkflow} alt="Email Workflow Node" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>In the Engagement workflow:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Find the "Confirmation Email" node</li>
                <li>Update the subject line and email content</li>
                <li>Include webinar date, time, and action items</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.emailWorkflowSetup} 
              onChange={(val) => {
                updateState('emailWorkflowSetup', val);
                handleNext();
              }}
              label="Email Workflow is Configured"
            />
          </div>
        );

      case 'whatsapp-number-setup':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Is your WhatsApp Business number connected?</CardTitle>
              <CardDescription>
                Connect your WhatsApp Business number to HighLevel
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementWhatsappSetup} alt="WhatsApp Business Settings" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>You need to have:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>WhatsApp Business account connected to HighLevel</li>
                <li>Meta Business verification completed (Approved status)</li>
                <li>At least one phone number showing as "Connected"</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.whatsappNumberSetup} 
              onChange={(val) => {
                updateState('whatsappNumberSetup', val);
                handleNext();
              }}
              label="WhatsApp is Connected"
            />
          </div>
        );

      case 'whatsapp-template-approval':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Do you have an approved WhatsApp Utility template?</CardTitle>
              <CardDescription>
                You need an approved Utility template to message users who haven't messaged you first
              </CardDescription>
            </CardHeader>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm mb-4">
              <p className="text-amber-700 dark:text-amber-300">
                <strong>Important:</strong> Meta has a 24-hour window policy. You cannot message users who haven't messaged you first unless you use an approved template.
              </p>
            </div>
            <GuideImage src={engagementWhatsappTemplates} alt="WhatsApp Templates" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>You need to have:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Created a WhatsApp message template (e.g., "webinar_opening")</li>
                <li>Template category is "Utility" for transactional messages</li>
                <li>Template status shows "Active" (approved by Meta)</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.whatsappTemplateApproved} 
              onChange={(val) => {
                updateState('whatsappTemplateApproved', val);
                handleNext();
              }}
              label="Template is Approved"
            />
          </div>
        );

      case 'whatsapp-workflow-setup':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Is the WhatsApp workflow configured with your template?</CardTitle>
              <CardDescription>
                Configure the WhatsApp node to use your approved template
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementWhatsappWorkflow} alt="WhatsApp Workflow Node" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>In the Engagement workflow:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Find the "WhatsApp Engagement" node</li>
                <li>Select your approved template (e.g., "webinar_opening - UTILITY")</li>
                <li>Select the phone number to send from</li>
                <li>Verify the message preview looks correct</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.whatsappWorkflowSetup} 
              onChange={(val) => {
                updateState('whatsappWorkflowSetup', val);
                handleNext();
              }}
              label="WhatsApp Workflow is Configured"
            />
          </div>
        );

      case 'phone-ai-reps-check':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Have you completed the AI Reps Setup?</CardTitle>
              <CardDescription>
                The AI voice agent requires the full AI Reps setup to be completed first
              </CardDescription>
            </CardHeader>
            <AiRepsStatusDisplay />
            <div className="pt-2 space-y-3">
              <Button
                onClick={() => navigate(`/client/${clientId}/api`)}
                variant="outline"
                className="w-full"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Go to AI Reps Setup
              </Button>
              
              <UnderstandButton 
                value={state.phoneAiRepsComplete} 
                onChange={(val) => {
                  updateState('phoneAiRepsComplete', val);
                  handleNext();
                }} 
              />
            </div>
          </div>
        );

      case 'phone-outbound-setup':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Have you configured the outbound call engagement?</CardTitle>
              <CardDescription>
                Choose which AI agent prompt number will make the engagement calls
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementPhoneCallWorkflow} alt="Outbound Call Workflow" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>In the Make Outbound Call workflow:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Choose the agent number (1, 2, 3, etc.) for the engagement call</li>
                <li>This corresponds to the prompt slot in Voice AI Rep Prompts</li>
                <li>Example: Number 2 uses Prompt 2 from Prompt Management</li>
              </ul>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-sm">
              <p className="text-blue-700 dark:text-blue-300">
                <strong>Tip:</strong> You're choosing which version of your AI agent makes the call. Each prompt number can have a different personality or script.
              </p>
            </div>
            <ConfirmButton 
              value={state.phoneOutboundCallSetup} 
              onChange={(val) => {
                updateState('phoneOutboundCallSetup', val);
                handleNext();
              }}
              label="Outbound Call is Configured"
            />
          </div>
        );

      case 'workflow-trigger':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Is the workflow trigger set to the correct form?</CardTitle>
              <CardDescription>
                The trigger must be THE EXACT FORM from your webinar signup page
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementWorkflowTrigger} alt="Workflow Trigger Settings" />
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm mb-4">
              <p className="text-red-700 dark:text-red-300">
                <strong>Critical:</strong> If the trigger form doesn't match your webinar signup form, the engagement workflow will NOT trigger when people sign up!
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>Verify that:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>The workflow trigger is set to "Form Submitted"</li>
                <li>The selected form matches your webinar landing page form exactly</li>
                <li>Form field mappings are correct (name, email, phone)</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.workflowTriggerSetup} 
              onChange={(val) => {
                updateState('workflowTriggerSetup', val);
                handleNext();
              }}
              label="Trigger is Correct"
            />
          </div>
        );

      case 'workflow-publish':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Is the engagement workflow saved and published?</CardTitle>
              <CardDescription>
                Make sure the workflow is published and active so it will trigger
              </CardDescription>
            </CardHeader>
            <GuideImage src={engagementSmsWorkflow} alt="Workflow Publish Toggle" />
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <p><strong>Final check:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Click "Save" to save all your changes</li>
                <li>Toggle the workflow to "Published" (top right)</li>
                <li>The workflow should show as "Active"</li>
              </ul>
            </div>
            <ConfirmButton 
              value={state.workflowPublished} 
              onChange={(val) => {
                updateState('workflowPublished', val);
                handleNext();
              }}
              label="Workflow is Published"
            />
          </div>
        );

      case 'complete':
        return (
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Engagement Setup Complete!</CardTitle>
              <CardDescription>
                You've configured all your engagement channels
              </CardDescription>
            </CardHeader>

            <Button onClick={handleComplete} className="w-full bg-green-500 hover:bg-green-600" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save & Complete'}
              <CheckCircle2 className="h-4 w-4 ml-2" />
            </Button>

            <Button variant="outline" onClick={handleReset} className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" />
              Start Over
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
      {/* Progress indicator - segmented like other wizards, hidden on complete screen */}
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

          {/* Step counter with back button on top right */}
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

      {/* Channel selection next button */}
      {currentStepId === 'channel-selection' && state.selectedChannels.length > 0 && (
        <Button 
          onClick={handleNext}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          Continue with {state.selectedChannels.length} channel{state.selectedChannels.length > 1 ? 's' : ''}
        </Button>
      )}

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
