import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, ArrowLeft, RotateCcw, Eye, AlertTriangle, Clock, Phone, MessageSquare, Mail } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';

// Import screenshots
import followupsWorkflowList from '@/assets/followups-workflow-list.png';
import followupsEngagementTransfer from '@/assets/followups-engagement-transfer.png';
import followupsContentChange from '@/assets/followups-content-change.png';
import followupsDatetime from '@/assets/followups-datetime.png';
import followupsReminders from '@/assets/followups-reminders.png';
import followups2hrWorkflow from '@/assets/followups-2hr-workflow.png';
import followupsAgentNumber from '@/assets/followups-agent-number.png';

interface FollowupsWizardState {
  workflowEnabled: boolean | null;
  engagementTransfer: boolean | null;
  contentChanged: boolean | null;
  datetimeUpdated: boolean | null;
  remindersSet: boolean | null;
  twoHourWorkflowPublished: boolean | null;
  agentNumberSet: boolean | null;
}

interface FollowupsWizardProps {
  clientId: string;
  onComplete: () => void;
  onReset?: () => void;
  setupGuideCompletedSteps?: string[];
}

const INITIAL_STATE: FollowupsWizardState = {
  workflowEnabled: null,
  engagementTransfer: null,
  contentChanged: null,
  datetimeUpdated: null,
  remindersSet: null,
  twoHourWorkflowPublished: null,
  agentNumberSet: null,
};

// Clickable screenshot component
const ClickableScreenshot = ({ src, alt }: { src: string; alt: string }) => (
  <Dialog>
    <DialogTrigger asChild>
      <div className="cursor-pointer group">
        <img 
          src={src} 
          alt={alt}
          className="w-full rounded-lg border border-border shadow-sm transition-all group-hover:shadow-md group-hover:border-primary/50"
        />
        <p className="text-xs text-muted-foreground text-center mt-1">Click to enlarge</p>
      </div>
    </DialogTrigger>
    <DialogContent className="max-w-[95vw] max-h-[95vh] p-2">
      <img 
        src={src} 
        alt={alt}
        className="w-full h-full object-contain rounded-lg"
      />
    </DialogContent>
  </Dialog>
);

export default function FollowupsWizard({ clientId, onComplete, onReset }: FollowupsWizardProps) {
  const [state, setState] = useState<FollowupsWizardState>(INITIAL_STATE);
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const { toast } = useToast();

  // Load from localStorage
  useEffect(() => {
    const loadAnswers = async () => {
      try {
        const saved = localStorage.getItem(`followups_wizard_${clientId}`);
        if (saved) {
          const data = JSON.parse(saved);
          setState(data.answers || INITIAL_STATE);
          setIsCompleted(data.is_completed || false);
          if (typeof data.current_step === 'number') {
            setCurrentStep(data.current_step);
          }
          if (data.is_completed) {
            setShowSummary(true);
          }
        }
      } catch (error) {
        console.error('Failed to load followups wizard answers:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAnswers();
  }, [clientId]);

  // Save to localStorage
  const saveProgress = useCallback((newState: FollowupsWizardState, completed: boolean = false, step?: number) => {
    setIsSaving(true);
    try {
      const existing = localStorage.getItem(`followups_wizard_${clientId}`);
      let existingStep = 0;
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          existingStep = parsed.current_step ?? 0;
        } catch {}
      }
      
      const stepToSave = step !== undefined ? step : existingStep;
      localStorage.setItem(`followups_wizard_${clientId}`, JSON.stringify({
        answers: newState,
        is_completed: completed,
        current_step: stepToSave,
        completed_at: completed ? new Date().toISOString() : null,
      }));
      
      if (completed) {
        setIsCompleted(true);
        toast({
          title: "Follow-ups Setup Complete!",
          description: "Your follow-ups configuration has been verified.",
        });
        onComplete();
      }
    } catch (error) {
      console.error('Failed to save followups wizard answers:', error);
    } finally {
      setIsSaving(false);
    }
  }, [clientId, toast, onComplete]);

  const updateState = <K extends keyof FollowupsWizardState>(key: K, value: FollowupsWizardState[K]) => {
    setState(prev => {
      const newState = { ...prev, [key]: value };
      saveProgress(newState);
      return newState;
    });
  };

  const handleNext = () => {
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    saveProgress(state, false, nextStep);
  };

  const handleBack = () => {
    const prevStep = Math.max(0, currentStep - 1);
    setCurrentStep(prevStep);
    saveProgress(state, false, prevStep);
  };

  const handleReset = () => {
    try {
      localStorage.removeItem(`followups_wizard_${clientId}`);
      setState(INITIAL_STATE);
      setCurrentStep(0);
      setIsCompleted(false);
      setShowSummary(false);
      onReset?.();
      toast({
        title: "Reset Complete",
        description: "Your follow-ups wizard has been reset.",
      });
    } catch (error) {
      console.error('Failed to reset followups wizard:', error);
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

  // I Understand / Done button
  const UnderstandButton = ({ 
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

  // Define the steps
  const steps = [
    { id: 'workflow-enabled' },
    { id: 'engagement-transfer' },
    { id: 'content-changed' },
    { id: 'datetime-updated' },
    { id: 'reminders-set' },
    { id: 'two-hour-workflow' },
    { id: 'agent-number' }
  ];

  const isOnCompleteScreen = currentStep >= steps.length;
  const currentStepId = isOnCompleteScreen ? 'complete' : (steps[currentStep]?.id || 'workflow-enabled');

  // Summary view for completed wizard
  const renderSummary = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-green-500/10 rounded-lg border border-green-500/30">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
          <div>
            <h3 className="font-semibold text-green-700 dark:text-green-400">Follow-ups Setup Complete</h3>
            <p className="text-sm text-green-600 dark:text-green-500">All steps verified and saved</p>
          </div>
        </div>

        <Card className="p-4">
          <h4 className="font-semibold mb-3">Your Configuration</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Followups Workflow:</span>
              <span className="font-medium">{state.workflowEnabled ? '✓ Published' : '✗ Not Set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Engagement Transfer:</span>
              <span className="font-medium">{state.engagementTransfer ? '✓ Configured' : '✗ Not Set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Content Updated:</span>
              <span className="font-medium">{state.contentChanged ? '✓ Changed' : '✗ Not Set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date/Time Updated:</span>
              <span className="font-medium">{state.datetimeUpdated ? '✓ Updated' : '✗ Not Set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reminders Set:</span>
              <span className="font-medium">{state.remindersSet ? '✓ Configured' : '✗ Not Set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">2hr Caller Workflow:</span>
              <span className="font-medium">{state.twoHourWorkflowPublished ? '✓ Published' : '✗ Not Set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Agent Number:</span>
              <span className="font-medium">{state.agentNumberSet ? '✓ Set' : '✗ Not Set'}</span>
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
      case 'workflow-enabled':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Enable Your Followups Workflow</CardTitle>
              <CardDescription>
                First, make sure your Followups workflow is enabled and published in HighLevel
              </CardDescription>
            </CardHeader>

            <ClickableScreenshot src={followupsWorkflowList} alt="Followups workflow in workflow list" />

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">Steps to verify:</p>
              <ol className="text-sm space-y-2 text-muted-foreground list-decimal list-inside">
                <li>Go to <strong>Automation → Workflows</strong> in HighLevel</li>
                <li>Find the <strong>"Followups"</strong> workflow</li>
                <li>Make sure the status shows <strong>"Published"</strong> (green badge)</li>
                <li>If it shows "Draft", toggle the publish switch to enable it</li>
              </ol>
            </div>

            <div className="pt-4">
              <UnderstandButton 
                value={state.workflowEnabled} 
                onChange={(val) => {
                  updateState('workflowEnabled', val);
                  handleNext();
                }}
                label="Workflow is Published"
              />
            </div>
          </div>
        );

      case 'engagement-transfer':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Connect Engagement to Followups</CardTitle>
              <CardDescription>
                At the end of the Engagement workflow, leads must be transferred to the Followups workflow
              </CardDescription>
            </CardHeader>

            <ClickableScreenshot src={followupsEngagementTransfer} alt="Engagement workflow transferring to Followups" />

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">What to check:</p>
              <ol className="text-sm space-y-2 text-muted-foreground list-decimal list-inside">
                <li>Open the <strong>Engagement</strong> workflow in HighLevel</li>
                <li>Scroll to the end of the workflow</li>
                <li>Find the <strong>"Add to Workflow"</strong> action node</li>
                <li>Verify it's set to transfer to the <strong>"Followups"</strong> workflow</li>
                <li>Make sure "Pass Input Trigger Parameters" is <strong>enabled</strong></li>
              </ol>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-sm">
                <strong>Why this matters:</strong> Without this connection, leads who complete engagement won't receive your follow-up sequence and reminders.
              </p>
            </div>

            <div className="pt-4">
              <UnderstandButton 
                value={state.engagementTransfer} 
                onChange={(val) => {
                  updateState('engagementTransfer', val);
                  handleNext();
                }}
                label="Transfer is Configured"
              />
            </div>
          </div>
        );

      case 'content-changed':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Customize All Your Messages</CardTitle>
              <CardDescription>
                Change the content of ALL emails, SMS, and WhatsApp messages in the Followups workflow to your own content
              </CardDescription>
            </CardHeader>

            <ClickableScreenshot src={followupsContentChange} alt="Changing content in Followups workflow" />

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">Messages to customize:</p>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-green-500" />
                  <span>All Emails</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-blue-500" />
                  <span>All SMS</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-green-600" />
                  <span>All WhatsApp</span>
                </div>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-sm">
                <strong>Important:</strong> Don't just use the template content! Personalize each message to match your webinar topic, your brand voice, and your audience.
              </p>
            </div>

            <div className="pt-4">
              <UnderstandButton 
                value={state.contentChanged} 
                onChange={(val) => {
                  updateState('contentChanged', val);
                  handleNext();
                }}
                label="All Content is Customized"
              />
            </div>
          </div>
        );

      case 'datetime-updated':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Update Date & Time in All Messages</CardTitle>
              <CardDescription>
                Each outgoing email, SMS, and WhatsApp has a date and time - make sure they match YOUR webinar schedule
              </CardDescription>
            </CardHeader>

            <ClickableScreenshot src={followupsDatetime} alt="Date and time in messages" />

            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <p className="font-medium text-red-700 dark:text-red-400">Critical Step!</p>
              </div>
              <p className="text-sm text-muted-foreground">
                If you forget to change the date and time, people will be confused about when the webinar is - even if they have it on their calendar. This will <strong>significantly decrease your show-up rate</strong>.
              </p>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">Check every message for:</p>
              <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                <li>Correct webinar date</li>
                <li>Correct time (with timezone)</li>
                <li>Day of week matches the date</li>
              </ul>
            </div>

            <div className="pt-4">
              <UnderstandButton 
                value={state.datetimeUpdated} 
                onChange={(val) => {
                  updateState('datetimeUpdated', val);
                  handleNext();
                }}
                label="All Dates & Times are Correct"
              />
            </div>
          </div>
        );

      case 'reminders-set':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Verify All Reminder Timings</CardTitle>
              <CardDescription>
                These critical reminders are what make the BIGGEST difference in your show-up rate
              </CardDescription>
            </CardHeader>

            <ClickableScreenshot src={followupsReminders} alt="Reminder timings in workflow" />

            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">Required Reminders (Don't Remove!):</p>
              <div className="space-y-2 mt-2">
                <div className="flex items-center gap-3 p-2 bg-background rounded border">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">1 Day Before</span>
                </div>
                <div className="flex items-center gap-3 p-2 bg-background rounded border">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">2 Hours Before</span>
                </div>
                <div className="flex items-center gap-3 p-2 bg-background rounded border">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">15 Minutes Before</span>
                </div>
                <div className="flex items-center gap-3 p-2 bg-background rounded border">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">1 Minute Before</span>
                </div>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-sm">
                <strong>Pro Tip:</strong> You can add educational content between registration and event, but <strong>never remove</strong> these core reminder timings - they're what get people to actually show up!
              </p>
            </div>

            <div className="pt-4">
              <UnderstandButton 
                value={state.remindersSet} 
                onChange={(val) => {
                  updateState('remindersSet', val);
                  handleNext();
                }}
                label="All Reminders are Set"
              />
            </div>
          </div>
        );

      case 'two-hour-workflow':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Publish the 2hr Reminder Caller Workflow</CardTitle>
              <CardDescription>
                2 hours before the webinar, Voice AI Rep will make phone calls to remind people - this workflow must be published
              </CardDescription>
            </CardHeader>

            <ClickableScreenshot src={followups2hrWorkflow} alt="2hr Reminder Caller workflow" />

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-primary" />
                <p className="font-medium">Voice AI Reminder Calls</p>
              </div>
              <p className="text-sm text-muted-foreground">
                This workflow triggers Voice AI Rep to call registered leads 2 hours before the webinar. It's a powerful way to boost show-up rates.
              </p>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">Steps to verify:</p>
              <ol className="text-sm space-y-2 text-muted-foreground list-decimal list-inside">
                <li>Go to <strong>Automation → Workflows</strong></li>
                <li>Navigate to <strong>Voice AI Rep</strong> folder</li>
                <li>Find <strong>"2hr Reminder Caller"</strong></li>
                <li>Make sure it shows <strong>"Published"</strong> (green badge)</li>
              </ol>
            </div>

            <div className="pt-4">
              <UnderstandButton 
                value={state.twoHourWorkflowPublished} 
                onChange={(val) => {
                  updateState('twoHourWorkflowPublished', val);
                  handleNext();
                }}
                label="2hr Caller is Published"
              />
            </div>
          </div>
        );

      case 'agent-number':
        return (
          <div className="space-y-4">
            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-lg">Set the Correct Agent Number</CardTitle>
              <CardDescription>
                The agent number determines which prompt the Voice AI Rep uses - make sure it's set correctly
              </CardDescription>
            </CardHeader>

            <ClickableScreenshot src={followupsAgentNumber} alt="Agent number configuration" />

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <p className="font-medium">How to set the agent number:</p>
              <ol className="text-sm space-y-2 text-muted-foreground list-decimal list-inside">
                <li>Open the <strong>2hr Reminder Caller</strong> workflow</li>
                <li>Find the <strong>"#1 Make Outbound Call"</strong> webhook action (older snapshots may still label it "(n8n)")</li>
                <li>Look at <strong>Query Parameters</strong></li>
                <li>Set <strong>agent_number</strong> to the correct prompt number</li>
                <li>This should match the prompt in your Prompt Management (e.g., 3)</li>
              </ol>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <p className="text-sm">
                <strong>Remember:</strong> This works the same way you set the agent number for outbound calls in the Engagement workflow. The number corresponds to which prompt the Voice AI Rep will use.
              </p>
            </div>

            <div className="pt-4">
              <UnderstandButton 
                value={state.agentNumberSet} 
                onChange={(val) => {
                  updateState('agentNumberSet', val);
                  handleNext();
                }}
                label="Agent Number is Set"
              />
            </div>
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
                All Follow-ups Steps Complete!
              </h3>
              <p className="text-muted-foreground">
                Your follow-up sequence is ready to keep leads engaged and boost your show-up rate.
              </p>
            </div>

            <Card className="p-4 bg-green-500/5 border-green-500/20">
              <h4 className="font-semibold mb-3 text-green-700 dark:text-green-400">What you've configured:</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Followups workflow is published</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Engagement transfers leads to Followups</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>All message content is customized</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Date & time updated in all messages</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>1 day, 2hr, 15min, 1min reminders set</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>2hr Voice AI caller workflow published</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Agent number configured correctly</span>
                </li>
              </ul>
            </Card>

            <Button
              onClick={handleComplete}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Complete Follow-ups Setup
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (showSummary && isCompleted) {
    return renderSummary();
  }

  return (
    <div className="space-y-4">
      {/* Progress indicator - hidden on complete screen */}
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
            <span>Step {Math.min(currentStep + 1, steps.length)} of {steps.length}</span>
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
    </div>
  );
}
