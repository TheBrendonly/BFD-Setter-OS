import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, CheckCircle2, ExternalLink, Save, Loader2, Copy, Settings } from '@/components/icons';
import { cn } from '@/lib/utils';
import { SETUP_PHASES, PHASE_IDS } from '@/components/SetupGuideDialog';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Import screenshots
import zoomPricingWebinars from '@/assets/setup-guide/zoom-pricing-webinars.png';
import zoomScheduleWebinar from '@/assets/setup-guide/zoom-schedule-webinar.png';
import zoomWebinarTopic from '@/assets/setup-guide/zoom-webinar-topic.png';
import zoomWebinarRegistration from '@/assets/setup-guide/zoom-webinar-registration.png';
import zoomWebinarOptions from '@/assets/setup-guide/zoom-webinar-options.png';
import zoomUserManagement from '@/assets/setup-guide/zoom-user-management.png';

// HighLevel Setup images
import ghlSitesFunnels from '@/assets/setup-guide/ghl-sites-funnels.png';
import ghlFunnelSettingsDomain from '@/assets/setup-guide/ghl-funnel-settings-domain.png';
import ghlFunnelTrackingCode from '@/assets/setup-guide/ghl-funnel-tracking-code.png';
import ghlFunnelStepsSignup from '@/assets/setup-guide/ghl-funnel-steps-signup.png';
import ghlFunnelSignupEdit from '@/assets/setup-guide/ghl-funnel-signup-edit.png';
import ghlFunnelConfirmationStep from '@/assets/setup-guide/ghl-funnel-confirmation-step.png';
import ghlConfirmationPage from '@/assets/setup-guide/ghl-confirmation-page.png';
import ghlButtonWebinarUrl from '@/assets/setup-guide/ghl-button-webinar-url.png';

// Engagement Setup images
import webinarFormsSignup from '@/assets/setup-guide/webinar-forms-signup.png';
import webinarEngagementWorkflow from '@/assets/setup-guide/webinar-engagement-workflow.png';
import webinarLeadEvent from '@/assets/setup-guide/webinar-lead-event.png';
import webinarAddTag from '@/assets/setup-guide/webinar-add-tag.png';
import webinarBookAppointment from '@/assets/setup-guide/webinar-book-appointment.png';
import webinarEventStartDate from '@/assets/setup-guide/webinar-event-start-date.png';
import webinarConfirmationEmail from '@/assets/setup-guide/webinar-confirmation-email.png';
import webinarWhatsappEngagement from '@/assets/setup-guide/webinar-whatsapp-engagement.png';
import webinarSetFieldsWhatsapp from '@/assets/setup-guide/webinar-set-fields-whatsapp.png';
import webinarSmsWorkflow from '@/assets/setup-guide/webinar-sms-workflow.png';
import webinarSmsEngagement from '@/assets/setup-guide/webinar-sms-engagement.png';

// Followups Setup images
import webinarFollowupsList from '@/assets/setup-guide/webinar-followups-list.png';
import webinarFollowupsWorkflow from '@/assets/setup-guide/webinar-followups-workflow.png';
import webinarFollowupsPublish from '@/assets/setup-guide/webinar-followups-publish.png';
import webinarFollowupsEditContent from '@/assets/setup-guide/webinar-followups-edit-content.png';

// Pipeline Setup images
import ghlEngagedLeadList from '@/assets/setup-guide/ghl-engaged-lead-list.png';
import ghlEngagedLeadWorkflow from '@/assets/setup-guide/ghl-engaged-lead-workflow.png';
import ghlPipelineOverview from '@/assets/setup-guide/ghl-pipeline-overview.png';
import ghlPipelineEdit from '@/assets/setup-guide/ghl-pipeline-edit.png';

// Dashboard Overview images
import ghlDashboardOverview from '@/assets/setup-guide/ghl-dashboard-overview.png';
import ghlDashboardEdit from '@/assets/setup-guide/ghl-dashboard-edit.png';
import ghlDashboardWidgets from '@/assets/setup-guide/ghl-dashboard-widgets.png';
import ghlDashboardTags from '@/assets/setup-guide/ghl-dashboard-tags.png';

// Rollup Setup images
import rollupWorkflowList from '@/assets/setup-guide/rollup-workflow-list.png';
import rollupWorkflowOverview from '@/assets/setup-guide/rollup-workflow-overview.png';
import rollupEditEmail from '@/assets/setup-guide/rollup-edit-email.png';
import rollupWorkflowWait from '@/assets/setup-guide/rollup-workflow-wait.png';
import zoomRecordingsList from '@/assets/setup-guide/zoom-recordings-list.png';
import zoomShareDialog from '@/assets/setup-guide/zoom-share-dialog.png';
import zoomShareSettings from '@/assets/setup-guide/zoom-share-settings.png';
import zoomCopyLink from '@/assets/setup-guide/zoom-copy-link.png';
import rollupPushLeads from '@/assets/setup-guide/rollup-push-leads.png';
import rollupSelectContacts from '@/assets/setup-guide/rollup-select-contacts.png';
import rollupPublishSave from '@/assets/setup-guide/rollup-publish-save.png';

// Appointments Setup images
import ghlConnectedCalendars from '@/assets/setup-guide/ghl-connected-calendars.png';
import ghlWorkingHours from '@/assets/setup-guide/ghl-working-hours.png';
import ghlUpdateAvailability from '@/assets/setup-guide/ghl-update-availability.png';
import ghlVideoConferencing from '@/assets/setup-guide/ghl-video-conferencing.png';
import ghlCalendarsSettings from '@/assets/setup-guide/ghl-calendars-settings.png';
import ghlStrategyCallCalendar from '@/assets/setup-guide/ghl-strategy-call-calendar.png';
import ghlCalendarName from '@/assets/setup-guide/ghl-calendar-name.png';
import ghlMeetingLocation from '@/assets/setup-guide/ghl-meeting-location.png';
import ghlAvailabilityBooking from '@/assets/setup-guide/ghl-availability-booking.png';
import ghlMeetingSettings from '@/assets/setup-guide/ghl-meeting-settings.png';
import ghlCalendarSave from '@/assets/setup-guide/ghl-calendar-save.png';

// All images for preloading
const ALL_WEBINAR_IMAGES = [
  zoomPricingWebinars,
  zoomScheduleWebinar,
  zoomWebinarTopic,
  zoomWebinarRegistration,
  zoomWebinarOptions,
  zoomUserManagement,
  ghlSitesFunnels,
  ghlFunnelSettingsDomain,
  ghlFunnelTrackingCode,
  ghlFunnelStepsSignup,
  ghlFunnelSignupEdit,
  ghlFunnelConfirmationStep,
  ghlConfirmationPage,
  ghlButtonWebinarUrl,
  webinarFormsSignup,
  webinarEngagementWorkflow,
  webinarLeadEvent,
  webinarAddTag,
  webinarBookAppointment,
  webinarEventStartDate,
  webinarConfirmationEmail,
  webinarWhatsappEngagement,
  webinarSetFieldsWhatsapp,
  webinarSmsWorkflow,
  webinarSmsEngagement,
  webinarFollowupsList,
  webinarFollowupsWorkflow,
  webinarFollowupsPublish,
  webinarFollowupsEditContent,
  ghlEngagedLeadList,
  ghlEngagedLeadWorkflow,
  ghlPipelineOverview,
  ghlPipelineEdit,
  ghlDashboardOverview,
  ghlDashboardEdit,
  ghlDashboardWidgets,
  ghlDashboardTags,
  rollupWorkflowList,
  rollupWorkflowOverview,
  rollupEditEmail,
  rollupWorkflowWait,
  zoomRecordingsList,
  zoomShareDialog,
  zoomShareSettings,
  zoomCopyLink,
  rollupPushLeads,
  rollupSelectContacts,
  rollupPublishSave,
  // Appointments Setup images
  ghlConnectedCalendars,
  ghlWorkingHours,
  ghlUpdateAvailability,
  ghlVideoConferencing,
  ghlCalendarsSettings,
  ghlStrategyCallCalendar,
  ghlCalendarName,
  ghlMeetingLocation,
  ghlAvailabilityBooking,
  ghlMeetingSettings,
  ghlCalendarSave
];

const WEBINAR_WEBHOOK_URL = 'https://n8n-1prompt.99players.com/webhook/update_webinar_details';

// Phase names matching the actual AI Reps Setup Guide titles
const PHASE_NAMES: Record<string, string> = {
  'account-creation': 'Accounts Setup',
  'supabase-setup': 'Supabase Setup',
  'workflows-import': 'Workflows Import',
  'n8n-setup': 'Text AI Rep Setup',
  'text-prompts-setup': 'Text Prompts Setup',
  'highlevel-credentials': 'HighLevel Credentials',
  'highlevel-setup': 'HighLevel Setup',
  'twilio-setup': 'Twilio Setup',
  'retell-setup': 'Voice AI Rep Setup',
  'voice-prompts-setup': 'Voice Prompts Setup',
  'knowledgebase-setup': 'Knowledgebase Setup'
};

// Preload only first few critical images for initial view
const preloadCriticalImages = (imageUrls: string[]) => {
  // Only preload first 3 images for faster initial load
  imageUrls.slice(0, 3).forEach(url => {
    const img = new Image();
    img.src = url;
  });
};

// Optimized image component with lazy loading, smooth fade-in, and click-to-zoom
import { ZoomableImage } from '@/components/ui/zoomable-image';

const SmoothImage = ({ src, alt }: { src: string; alt: string }) => (
  <ZoomableImage src={src} alt={alt} maxHeight="auto" />
);

interface WebinarSetupGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
  setupGuideCompletedSteps: string[];
  webinarUrl?: string;
  originalWebinarUrl?: string;
  onWebinarUrlChange?: (value: string) => void;
  onSaveWebinarUrl?: () => Promise<void>;
  savingWebinarUrl?: boolean;
  replayUrl?: string;
  originalReplayUrl?: string;
  onReplayUrlChange?: (value: string) => void;
  onSaveReplayUrl?: () => Promise<void>;
  savingReplayUrl?: boolean;
  initialPhase?: number;
  initialStep?: number;
}

interface WebinarPhase {
  id: string;
  title: string;
  description: string;
  steps: {
    id: string;
    title: string;
    content: React.ReactNode;
  }[];
}

const WebinarSetupGuideDialog: React.FC<WebinarSetupGuideDialogProps> = ({
  open,
  onOpenChange,
  clientId,
  setupGuideCompletedSteps,
  webinarUrl = '',
  originalWebinarUrl = '',
  onWebinarUrlChange,
  onSaveWebinarUrl,
  savingWebinarUrl = false,
  replayUrl = '',
  originalReplayUrl = '',
  onReplayUrlChange,
  onSaveReplayUrl,
  savingReplayUrl = false,
  initialPhase = 0,
  initialStep = 0
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentPhase, setCurrentPhase] = useState(initialPhase);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([initialPhase]));

  const isWebinarUrlConfigured = Boolean(originalWebinarUrl?.trim());
  const isReplayUrlConfigured = Boolean(originalReplayUrl?.trim());

  // Track if we should use initial phase/step from props (when user clicks a specific phase)
  const [hasNavigatedFromProps, setHasNavigatedFromProps] = useState(false);

  // Update position when initialPhase/initialStep change and dialog opens
  useEffect(() => {
    if (open && (initialPhase !== 0 || initialStep !== 0)) {
      // User clicked a specific phase - use those values
      setCurrentPhase(initialPhase);
      setCurrentStep(initialStep);
      setExpandedPhases(prev => new Set([...prev, initialPhase]));
      setHasNavigatedFromProps(true);
    } else if (open && !hasNavigatedFromProps) {
      // Dialog opened without specific phase - will be handled by localStorage effect
      setHasNavigatedFromProps(false);
    }
  }, [open, initialPhase, initialStep]);

  // Reset navigation flag when dialog closes
  useEffect(() => {
    if (!open) {
      setHasNavigatedFromProps(false);
    }
  }, [open]);

  // Preload only first few critical images when dialog opens
  useEffect(() => {
    if (open) {
      preloadCriticalImages(ALL_WEBINAR_IMAGES);
    }
  }, [open]);

  // Check if API setup phase is complete based on the setup guide completed steps
  const getApiPhaseStatus = (phaseId: string): { completed: number; total: number; isComplete: boolean } => {
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
    const isComplete = PHASE_IDS.every(phaseId => {
      const status = getApiPhaseStatus(phaseId);
      return status.isComplete;
    });
    return {
      completed: completedCount,
      total: totalSteps,
      percentage: Math.round((completedCount / totalSteps) * 100),
      isComplete
    };
  };

  // Define phases for webinar setup
  const phases: WebinarPhase[] = [
    {
      id: 'api-setup',
      title: 'AI Reps Setup',
      description: 'Complete the AI Reps setup to enable AI text and voice reps',
      steps: [
        {
          id: 'api-overview',
          title: 'Complete AI Reps Setup',
          content: (() => {
            const overallStatus = getOverallAiRepsStatus();
            return (
              <div className="space-y-4">
                <p>
                  Before setting up your webinar system, you need to complete the AI Reps setup. 
                  The AI text and voice representatives are essential parts of the webinar system.
                </p>

                {/* Overall progress */}
                <div className={cn(
                  "rounded-lg p-4 border",
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
                    const status = getApiPhaseStatus(phaseId);
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
                    <strong>Important:</strong> All phases above must be completed in the AI Reps Guide before proceeding with the webinar setup.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/client/${clientId}/api`);
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to AI Reps Setup
                  </Button>
                </div>
              </div>
            );
          })()
        }
      ]
    },
    {
      id: 'zoom-setup',
      title: 'Zoom Setup',
      description: 'Create and configure your Zoom webinar',
      steps: [
        {
          id: 'create-zoom-account',
          title: 'Create Zoom Account',
          content: (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span>Visit:</span>
                <a 
                  href="https://www.zoom.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  zoom.com
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>Sign Up</strong> to create your account</li>
                  <li>Fill in your details and verify your email address</li>
                  <li>Complete the registration process</li>
                </ol>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  Zoom provides professional video conferencing and webinar hosting for your online events.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'purchase-webinar-plan',
          title: 'Purchase Webinar Plan',
          content: (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <span>Visit:</span>
                <a 
                  href="https://zoom.us/pricing" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  zoom.us/pricing
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on <strong>Webinars & Events</strong> in the left sidebar</li>
                  <li>Select the <strong>Webinars</strong> plan (the basic one at $89/month)</li>
                  <li>This plan includes up to 300 attendees - a great starting point</li>
                  <li>Complete the purchase</li>
                </ol>
              </div>

              <SmoothImage src={zoomPricingWebinars} alt="Zoom Webinars & Events pricing page" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> You'll need a Zoom Workplace Pro subscription first before you can add the Webinars plan. The total cost will be the Pro subscription plus the Webinars add-on.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'schedule-webinar',
          title: 'Schedule a Webinar',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the left sidebar, click on <strong>Webinars</strong></li>
                  <li>Click the <strong>+ Schedule a Webinar</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={zoomScheduleWebinar} alt="Zoom Webinars page with Schedule button" />
            </div>
          )
        },
        {
          id: 'webinar-topic-description',
          title: 'Topic & Description',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Configure your webinar details:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Enter a <strong>catchy but clear Topic name</strong> - this will appear in attendees' calendars</li>
                  <li>Add a brief <strong>Description</strong> explaining what attendees will learn</li>
                  <li>Select the <strong>date and time</strong> for your webinar</li>
                  <li><strong>Don't forget to select your current timezone!</strong></li>
                  <li>For duration: if your webinar is ~1 hour, set <strong>1.5 hours</strong> to ensure the full time block is reserved</li>
                </ol>
              </div>

              <SmoothImage src={zoomWebinarTopic} alt="Zoom Schedule a Webinar form - Topic, Description, Date, Time" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Pro Tip:</strong> The topic name shows in calendar invites, so make it specific and valuable enough that people will remember why they signed up!
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'webinar-recurring-registration',
          title: 'Recurring & Registration',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Configure these settings:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li><strong>Disable</strong> the "Recurring webinar" checkbox - this is a one-time event</li>
                  <li><strong>Enable</strong> the "Required" checkbox under Registration</li>
                </ol>
              </div>

              <SmoothImage src={zoomWebinarRegistration} alt="Zoom Webinar recurring and registration settings" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> About 10 minutes before the webinar starts, you should disable the registration requirement. This allows people to join even without registration, in case of any issues.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'webinar-options',
          title: 'Webinar Options',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Enable these options:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li><strong>Q&A</strong> - Let attendees post questions in a dedicated section</li>
                  <li><strong>Enable Practice Session</strong> - Test everything before going live</li>
                  <li><strong>Enable HD video for screen shared video</strong> - Better quality</li>
                  <li><strong>Automatically record webinar</strong> - Select <strong>"In the cloud"</strong></li>
                  <li>Under "By default, attendees can chat with:", select <strong>"Everyone"</strong></li>
                </ol>
              </div>

              <SmoothImage src={zoomWebinarOptions} alt="Zoom Webinar options - Q&A, Practice Session, Recording, Chat" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Why cloud recording?</strong> Local recording can sometimes fail or cause issues. Cloud recording is more reliable and gives you automatic access to the recording after the webinar.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'alternative-hosts',
          title: 'Alternative Hosts',
          content: (
            <div className="space-y-4">
              <p>
                Having someone else in the Zoom room to <strong>monitor chat and remove spam</strong> is extremely valuable. This lets you focus on your presentation.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to add an Alternative Host:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>User Management → Users</strong> in the left sidebar</li>
                  <li>Click <strong>+ Add Users</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={zoomUserManagement} alt="Zoom User Management - adding users with Webinar licenses" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>Add your co-host's email address</li>
                  <li>Assign them a <strong>Zoom Webinars license</strong></li>
                  <li>Back in the webinar form, add them in the "Alternative Hosts" field</li>
                </ol>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Cost Note:</strong> You'll need to purchase another Webinar license for your alternative host. While this adds cost, it's worth it to keep your webinar professional and spam-free. You can manage it yourself, but it's better to focus on presentation.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'save-webinar',
          title: 'Save & Complete',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Before saving, double-check:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Topic name is catchy and clear</li>
                  <li>Date and time are correct</li>
                  <li>Timezone is set to your current timezone</li>
                  <li>Duration is 1.5x your planned content length</li>
                  <li>Registration is required</li>
                  <li>Q&A and Practice Session are enabled</li>
                  <li>Cloud recording is selected</li>
                  <li>Alternative host is added (if applicable)</li>
                </ol>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Final step:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the <strong>Schedule</strong> button at the bottom to create your webinar</li>
                </ol>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Next Steps:</strong> After creating the webinar, you'll get registration links and join URLs that you'll need to configure in the next steps.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'get-registration-link',
          title: 'Get Registration Link',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your Zoom webinar registration URL below.</p>

              {/* WEBINAR URL INPUT FIELD - AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                isWebinarUrlConfigured 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-webinar-url" className="text-sm font-medium">
                    Webinar URL
                  </Label>
                  {isWebinarUrlConfigured && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-webinar-url"
                  value={webinarUrl}
                  onChange={(e) => onWebinarUrlChange?.(e.target.value)}
                  placeholder="https://zoom.us/webinar/register/..."
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={onSaveWebinarUrl}
                    disabled={savingWebinarUrl || !webinarUrl}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingWebinarUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> This is the link you'll share with your audience. When people click it, they'll be taken to the Zoom registration page for your webinar.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'webinar-replay',
          title: 'Webinar Replay',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your replay URL below after your webinar is complete.</p>

              {/* REPLAY URL FIELD - AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                isReplayUrlConfigured 
                  ? "border-green-500 bg-green-500/10" 
                  : "border-muted"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-replay-url" className="text-sm font-medium">
                    Replay URL
                  </Label>
                  {isReplayUrlConfigured && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-replay-url"
                  value={replayUrl}
                  onChange={(e) => onReplayUrlChange?.(e.target.value)}
                  placeholder="https://your-replay-url.com/..."
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={onSaveReplayUrl}
                    disabled={savingReplayUrl || !replayUrl}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingReplayUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* RED WARNING NOTE BELOW */}
              <div className="bg-red-500/10 border-2 border-red-500 rounded-lg p-4">
                <p className="font-medium text-red-600 dark:text-red-400">
                  ⚠️ This step is NOT required right now. You do NOT need to set this up until after your webinar is complete.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">When to set the Replay URL:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Complete your live webinar</li>
                  <li>Wait for the cloud recording to process (usually 1-2 hours)</li>
                  <li>Download the recording from Zoom</li>
                  <li>Upload to your hosting platform (Vimeo, YouTube, etc.)</li>
                  <li>Copy the direct link and paste it in the field above</li>
                </ol>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Mark as Done:</strong> Click "Done" to complete the setup guide - you can always return here to add the Replay URL after your webinar.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'highlevel-setup',
      title: 'Landing Setup',
      description: 'Configure your landing page funnel',
      steps: [
        {
          id: 'navigate-to-funnels',
          title: 'Navigate to Funnels',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, go to <strong>Sites</strong> in the left sidebar</li>
                  <li>Click on <strong>Funnels</strong> in the top navigation</li>
                  <li>Click on the <strong>Landing Page</strong> funnel</li>
                </ol>
              </div>

              <SmoothImage src={ghlSitesFunnels} alt="HighLevel Sites - Funnels - Landing Page" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> This is the landing page that you will be using for your webinar - this is where people will land from your ads or outreach.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'funnel-steps-overview',
          title: 'Funnel Steps Overview',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Your funnel has 2 steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li><strong>Sign-Up</strong> - This is where people land from your ads/outreach</li>
                  <li><strong>Confirmation</strong> - This is where people go after they submit the signup form</li>
                </ol>
              </div>

              <SmoothImage src={ghlFunnelStepsSignup} alt="HighLevel Funnel Steps - Sign-Up and Confirmation" />
            </div>
          )
        },
        {
          id: 'connect-domain',
          title: 'Connect Your Domain',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Settings</strong> tab in your funnel</li>
                  <li>Find the <strong>Domain</strong> field on the right side</li>
                  <li>Connect your own domain here</li>
                </ol>
              </div>

              <SmoothImage src={ghlFunnelSettingsDomain} alt="HighLevel Funnel Settings - Domain connection" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> Make sure to connect a professional domain that matches your brand for better trust and conversion rates.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'head-tracking-code',
          title: 'Head Tracking Code',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Head tracking code:</p>
                <p className="text-muted-foreground">
                  This is where you would put the <strong>Meta Pixel Code</strong> to track conversions from your ads (or any other third-party pixel like Google Ads, TikTok, etc.)
                </p>
              </div>

              <SmoothImage src={ghlFunnelTrackingCode} alt="HighLevel Funnel Settings - Head tracking code" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> If you're running Facebook/Meta ads, paste your Pixel code here to track registrations and optimize your campaigns.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'edit-signup-page',
          title: 'Edit Sign-Up Page',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Sign-Up</strong> step in the funnel</li>
                  <li>Click the <strong>Edit</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={ghlFunnelStepsSignup} alt="HighLevel Funnel - Click Edit on Sign-Up step" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>Design the page based on your brand</li>
                </ol>
              </div>

              <SmoothImage src={ghlFunnelSignupEdit} alt="HighLevel Sign-Up page editor" />

              <div className="bg-red-500/10 border-2 border-red-500 rounded-lg p-4">
                <p className="font-medium text-red-600 dark:text-red-400">
                  ⚠️ IMPORTANT: Make sure you change ALL the dates to your own webinar dates to not confuse people!
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={4}>
                  <li>Update all dates and times to match your webinar</li>
                  <li>Click <strong>Save</strong> and <strong>Publish</strong> in the top right</li>
                </ol>
              </div>
            </div>
          )
        },
        {
          id: 'edit-confirmation-page',
          title: 'Edit Confirmation Page',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Confirmation</strong> step in the funnel</li>
                  <li>Click the <strong>Edit</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={ghlFunnelConfirmationStep} alt="HighLevel Funnel - Confirmation step" />

              <SmoothImage src={ghlConfirmationPage} alt="HighLevel Confirmation page with buttons" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> On this page you can see 2 buttons. You can remove or add more, but we <strong>HIGHLY RECOMMEND</strong> to have at least the <strong>Complete Registration</strong> button.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'configure-registration-button',
          title: 'Configure Registration Button',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Why Complete Registration button?</p>
                <p className="text-muted-foreground">
                  When people click this button they will go to your Zoom registration page and finish the registration. You might think this is double registration, but:
                </p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-muted-foreground">
                  <li>It makes people commit more - more actions = more likely to show up</li>
                  <li>After Zoom registration, they'll see a button to <strong>"Add to Calendar"</strong></li>
                  <li>This significantly increases your show-up rate!</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to configure the button:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>COMPLETE REGISTRATION</strong> button in the editor</li>
                  <li>On the right panel, scroll down to find the <strong>Website</strong> section</li>
                  <li>Copy your Webinar URL from the field below</li>
                </ol>
              </div>

              {/* BLUE PULSATING WEBINAR URL FIELD - same design as API Setup Guide */}
              <div className={cn(
                "space-y-2 rounded-lg p-4 border-2",
                isWebinarUrlConfigured 
                  ? "animate-pulse-blue border-blue-500/50 bg-blue-500/5" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Your Webinar URL</Label>
                  {!isWebinarUrlConfigured && (
                    <Badge className="bg-red-500 hover:bg-red-600 text-white">
                      Not Set - Complete Zoom Setup First
                    </Badge>
                  )}
                </div>
                <Input 
                  type="text"
                  value={webinarUrl || originalWebinarUrl || ''}
                  readOnly
                  placeholder={isWebinarUrlConfigured ? '' : 'Not Configured'}
                  className="font-mono text-sm bg-background"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => {
                      const url = webinarUrl || originalWebinarUrl;
                      if (url) {
                        navigator.clipboard.writeText(url);
                        toast({
                          title: "Copied!",
                          description: "Webinar URL copied to clipboard",
                        });
                      }
                    }}
                    disabled={!isWebinarUrlConfigured}
                    size="sm"
                    className={cn(
                      isWebinarUrlConfigured 
                        ? "bg-blue-500 hover:bg-blue-600 text-white font-medium shadow-lg shadow-blue-500/50 animate-pulse-bright-blue"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={4}>
                  <li>Paste your Webinar URL in the URL field on the right panel</li>
                  <li>Make sure "Open in New Tab" is <strong>enabled</strong></li>
                </ol>
              </div>

              <SmoothImage src={ghlButtonWebinarUrl} alt="HighLevel Button settings - Website URL field" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Don't forget:</strong> After configuring the button, click <strong>Save</strong> and <strong>Publish</strong> your confirmation page!
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'forms-overview',
          title: 'Forms Overview',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, go to <strong>Sites</strong> in the left sidebar</li>
                  <li>Click on <strong>Forms</strong> in the top navigation</li>
                  <li>Find the <strong>Sign-Up</strong> form</li>
                </ol>
              </div>

              <SmoothImage src={webinarFormsSignup} alt="HighLevel Sites - Forms - Sign-Up form" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> This is the form that people will use to sign up for the webinar. You don't need to do anything here - it's already configured.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'pipeline-setup',
      title: 'Pipeline Setup',
      description: 'Set up pipeline stages for lead tracking',
      steps: [
        {
          id: 'pipeline-overview',
          title: 'Pipeline Overview',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Opportunities</strong> in the left sidebar</li>
                  <li>Select the <strong>Self-Selling Webinar</strong> pipeline from the dropdown</li>
                </ol>
              </div>

              <SmoothImage src={ghlPipelineOverview} alt="HighLevel - Self-Selling Webinar Pipeline with stages" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">Default Pipeline Stages:</p>
                <ul className="list-disc list-inside space-y-1 mt-2 text-muted-foreground">
                  <li><strong>Signed-Up</strong> - Lead signs up for your webinar</li>
                  <li><strong>Engaged</strong> - Lead replies to any engagement messages (email, WhatsApp, SMS) or answers AI phone call</li>
                  <li><strong>Showed-Up</strong> - Lead attended the webinar</li>
                  <li><strong>Not Interested</strong> - Lead indicated they're not interested</li>
                  <li><strong>Call Booked</strong> - Lead booked a call with you</li>
                </ul>
              </div>
            </div>
          )
        },
        {
          id: 'edit-pipeline-stages',
          title: 'Edit Pipeline Stages (Optional)',
          content: (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Optional:</strong> Only modify the pipeline if you need to add or remove stages for your specific workflow.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">To edit pipeline stages:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on <strong>Pipelines</strong> in the top navigation</li>
                  <li>Find the <strong>Self-Selling Webinar</strong> pipeline</li>
                  <li>Click the <strong>Edit</strong> (pencil) icon on the right</li>
                </ol>
              </div>

              <SmoothImage src={ghlPipelineEdit} alt="HighLevel - Pipelines list with edit button" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> From here you can add, remove, or rename pipeline stages to match your specific sales process.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
  {
    id: 'dashboard-setup',
    title: 'Dashboard Setup',
      description: 'Track your webinar progress with the dashboard',
      steps: [
        {
          id: 'dashboard-overview-step',
          title: 'Dashboard Overview',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Your Webinar Dashboard</p>
                <p className="text-muted-foreground">
                  Here you can track the progress of your webinar. The dashboard is <strong>fully synced with the Pipeline</strong> - when an "Opportunity" (lead) is added to a pipeline stage like "Signed-Up", it will also be reflected in the dashboard.
                </p>
              </div>

              <SmoothImage src={ghlDashboardOverview} alt="HighLevel Dashboard - Overview with date filters" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
                <p className="font-medium">Dashboard Features:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-muted-foreground">
                  <li><strong>Customizable Widgets</strong> - You can easily add or remove elements from your dashboard</li>
                  <li><strong>Multiple Tracking Options</strong> - Track Contacts, Opportunities, and Communications</li>
                  <li><strong>Basic View</strong> - The default dashboard gives you a clear overview of what's happening</li>
                  <li><strong>Adaptable</strong> - Customize it based on your own use case</li>
                </ul>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-3">
                <p className="font-medium">Filtering Options:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-muted-foreground">
                  <li><strong>Filter by Date</strong> - Select a date range to see data for specific time periods</li>
                  <li><strong>Filter by Tags</strong> - When you run multiple webinars, you can filter by specific webinar tags</li>
                </ul>
              </div>

              <SmoothImage src={ghlDashboardTags} alt="HighLevel Dashboard - Filter by tags" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="text-muted-foreground">
                  For example, when people sign up for the webinar, they get a unique tag like <code className="bg-background px-1 rounded">"webinar - december 18"</code>. If you choose this tag in the filter, it will only show people who attended that specific webinar.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'dashboard-customization',
          title: 'Customize Dashboard',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps to customize:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the <strong>Edit Dashboard</strong> button in the top right corner</li>
                  <li>You'll enter Edit mode where you can modify the dashboard</li>
                </ol>
              </div>

              <SmoothImage src={ghlDashboardEdit} alt="HighLevel Dashboard - Edit Dashboard button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Adding Widgets:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>+ Add Widget</strong> to add new elements</li>
                  <li>Browse through available widget categories:</li>
                </ol>
                <ul className="list-disc list-inside space-y-1 ml-6 text-muted-foreground mt-2">
                  <li><strong>Contacts</strong> - Track contact counts and segments</li>
                  <li><strong>Appointments</strong> - Monitor scheduled appointments</li>
                  <li><strong>Opportunities</strong> - Track pipeline stage counts</li>
                  <li><strong>Visitor Data</strong> - Website visitor analytics</li>
                  <li><strong>Emails</strong> - Email performance metrics</li>
                  <li><strong>Calls</strong> - Call tracking data</li>
                  <li><strong>Conversations</strong> - Message statistics</li>
                  <li><strong>Payments</strong> - Revenue tracking</li>
                </ul>
              </div>

              <SmoothImage src={ghlDashboardWidgets} alt="HighLevel Dashboard - Add Widget panel with categories" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> After adding or removing widgets, click <strong>Save Changes</strong> to save your customized dashboard layout.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'engagement-setup',
      title: 'Engagement Setup',
      description: 'Configure engagement workflows and automations',
      steps: [
        {
          id: 'engaged-lead-workflow',
          title: 'Engaged Lead Workflow',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> in the left sidebar</li>
                  <li>Navigate to the <strong>Before Webinar</strong> folder</li>
                  <li>Click on the <strong>Engaged Lead</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={ghlEngagedLeadList} alt="HighLevel - Engaged Lead workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How it works:</p>
                <p className="text-muted-foreground">
                  You don't need to change anything here. The workflow has a <strong>Contact Tag trigger</strong> - when a lead engages with one of your AI reps (via email, WhatsApp, SMS, or phone call), they automatically get a tag added.
                </p>
              </div>

              <SmoothImage src={ghlEngagedLeadWorkflow} alt="HighLevel - Engaged Lead workflow with tag trigger" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>What happens:</strong> When the tag is added, this workflow triggers and updates the lead's pipeline stage for better tracking.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Enable the <strong>Publish</strong> toggle in the top right</li>
                  <li>Click <strong>Save</strong> to save the workflow</li>
                </ol>
              </div>
            </div>
          )
        },
        {
          id: 'engagement-workflow',
          title: 'Engagement Workflow',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> in the left sidebar</li>
                  <li>Navigate to the <strong>Before Webinar</strong> folder</li>
                  <li>Click on the <strong>Engagement</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={webinarEngagementWorkflow} alt="HighLevel Automation - Engagement workflow" />
            </div>
          )
        },
        {
          id: 'configure-lead-event',
          title: 'Configure Lead Event (Optional)',
          content: (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Optional:</strong> This step is only needed if you run ads to get people to sign up for the webinar.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Send "Lead" Event</strong> node in the workflow</li>
                  <li>Put your own <strong>Access Token</strong></li>
                  <li>Put your own <strong>Dataset ID</strong></li>
                </ol>
              </div>

              <SmoothImage src={webinarLeadEvent} alt="HighLevel - Send Lead Event configuration" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>What is this?</strong> This sends a "Lead" event to Facebook/Meta when someone signs up, allowing you to track conversions and optimize your ad campaigns.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'add-webinar-tag',
          title: 'Add Webinar Tag',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Add Tag</strong> module in the workflow</li>
                  <li>Create a tag that identifies the webinar and date (e.g., <code>webinar - december 18</code>)</li>
                </ol>
              </div>

              <SmoothImage src={webinarAddTag} alt="HighLevel - Add Tag for webinar tracking" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Why this matters:</strong> This tag helps you track everything on the dashboard and pipeline. You'll be able to see exactly which webinar each lead signed up for.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'set-webinar-time-tracking',
          title: 'Set Webinar Start Time (#1)',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>#1 Set Webinar Start Time</strong> node</li>
                  <li>Set the <strong>Start Date & Time</strong> to your webinar date and time</li>
                </ol>
              </div>

              <SmoothImage src={webinarBookAppointment} alt="HighLevel - Book Appointment for webinar tracking" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>What this does:</strong> This creates an "appointment" with the lead that signs up. It's made for tracking purposes so you can see the upcoming event for this lead in their contact record.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'set-webinar-time-technical',
          title: 'Set Webinar Start Time (#2)',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the second <strong>Set Webinar Start Time</strong> node</li>
                  <li>Set the <strong>Select Date</strong> to your webinar date and time</li>
                </ol>
              </div>

              <SmoothImage src={webinarEventStartDate} alt="HighLevel - Event Start Date configuration" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> This block is for technical purposes. It ensures that the follow-up sequences work correctly and the follow-up emails, texts, and WhatsApp messages are sent within a specific timeframe before the webinar.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'configure-confirmation-email',
          title: 'Configure Confirmation Email',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Confirmation Email</strong> node</li>
                  <li>Edit the email content to match your webinar details</li>
                  <li>Update the date and time mentioned in the email</li>
                </ol>
              </div>

              <SmoothImage src={webinarConfirmationEmail} alt="HighLevel - Confirmation Email configuration" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>What to include:</strong> This is the email that confirms the signup was received. You can also provide additional information here - for example, a link to a private WhatsApp group so all participants stay in one place and you can additionally engage with them.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'whatsapp-template-explanation',
          title: 'WhatsApp Template Explained',
          content: (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  ⚠️ Important: Understanding WhatsApp's 24-Hour Rule
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">The 24-Hour Rule:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-muted-foreground">
                  <li>WhatsApp and Meta have a <strong>24-hour rule</strong> - you can't engage with people on WhatsApp if they haven't interacted with your number for more than 24 hours</li>
                  <li>Since this is the very first message to a new lead, you can only send <strong>approved templates</strong></li>
                  <li>For <strong>US users</strong>, you can only send <strong>Utility templates</strong> (not Marketing), which are harder to get approved</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">The Variable Trick:</p>
                <p className="text-muted-foreground mb-2">
                  Here's how to work around the strict template approval:
                </p>
                <ol className="list-decimal list-inside space-y-2 ml-2 text-muted-foreground">
                  <li>Create a template with a variable like <code>{"{{contact.cta_for_whatsapp}}"}</code></li>
                  <li>When getting the template approved, use a default value like "Thank you for your registration"</li>
                  <li>Before sending the actual message, you set the field to what you actually want to say</li>
                </ol>
              </div>
            </div>
          )
        },
        {
          id: 'set-whatsapp-field',
          title: 'Set WhatsApp CTA Field',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Set Fields for WhatsApp</strong> node (above the WhatsApp Engagement node)</li>
                  <li>Find the <strong>CTA for WhatsApp</strong> field</li>
                  <li>Set the value to something engaging, for example:</li>
                </ol>
              </div>

              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 font-mono text-sm">
                and I need to clarify a few things, can we chat here? Let me know
              </div>

              <SmoothImage src={webinarSetFieldsWhatsapp} alt="HighLevel - Set Fields for WhatsApp CTA" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Why this works:</strong> The user will receive the approved template with this value, making them more likely to reply. When they reply, your AI sales rep will start working - nurturing and educating the user.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'configure-whatsapp-engagement',
          title: 'Configure WhatsApp Engagement',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>WhatsApp Engagement</strong> node</li>
                  <li>Select your approved <strong>WhatsApp Template</strong> (should be a Utility template)</li>
                  <li>Select the <strong>From Phone Number</strong> to send from</li>
                </ol>
              </div>

              <SmoothImage src={webinarWhatsappEngagement} alt="HighLevel - WhatsApp Engagement configuration" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> The template message includes the variable <code>{"{{contact.cta_for_whatsapp}}"}</code> which will be replaced with the value you set in the previous step.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'configure-sms-engagement',
          title: 'Configure SMS Engagement',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>SMS Engagement</strong> node in the workflow</li>
                  <li>Edit the message to match your style and webinar details</li>
                </ol>
              </div>

              <SmoothImage src={webinarSmsEngagement} alt="HighLevel - SMS Engagement configuration" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Purpose:</strong> This SMS is sent to the lead after signup, trying to get a response so that your AI reps can start nurturing and educating them.
                </p>
              </div>

              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                <p className="font-medium mb-2">Example message:</p>
                <p className="font-mono text-sm">
                  {"Hey {{contact.first_name}}, it's Gary from Building Flow. Just saw you registered for the webinar and I need to clarify a few things. Can we chat here?"}
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'engagement-publish-save',
          title: 'Publish & Save',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Final Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the <strong>Publish</strong> toggle in the top right to enable the workflow</li>
                  <li>Click the <strong>Save</strong> button to save all your changes</li>
                </ol>
              </div>

              <SmoothImage src={webinarSmsWorkflow} alt="HighLevel - Engagement workflow Publish and Save" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your Engagement workflow is now active and will start sending messages to new webinar signups.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'followups-setup',
      title: 'Followups Setup',
      description: 'Configure pre-webinar follow-up sequences',
      steps: [
        {
          id: 'navigate-to-followups',
          title: 'Navigate to Followups Workflow',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> in the left sidebar</li>
                  <li>Navigate to the <strong>Before Webinar</strong> folder</li>
                  <li>Click on the <strong>Followups</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={webinarFollowupsList} alt="HighLevel - Followups workflow in list" />
            </div>
          )
        },
        {
          id: 'followups-overview',
          title: 'Followups Overview',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">What are Followups?</p>
                <p className="text-muted-foreground">
                  These are automated emails, SMS, and WhatsApp messages that will be sent to the user before the webinar to:
                </p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-muted-foreground">
                  <li><strong>Educate and nurture</strong> them additionally with valuable content</li>
                  <li><strong>Ensure they show up</strong> committed to learn and buy</li>
                </ul>
              </div>

              <SmoothImage src={webinarFollowupsWorkflow} alt="HighLevel - Followups workflow structure" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Structure:</strong> The workflow sends messages at specific intervals before the webinar (5 days, 4 days, 3 days, etc.) with a mix of emails, SMS, and WhatsApp messages.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'edit-followup-content',
          title: 'Edit Followup Content',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go through <strong>each email, SMS, and WhatsApp node</strong> step-by-step</li>
                  <li>Click on each node to open its settings</li>
                  <li>Edit the <strong>content</strong> to match your brand, voice, and webinar topic</li>
                  <li>Update any <strong>links or CTAs</strong> to point to your resources</li>
                </ol>
              </div>

              <SmoothImage src={webinarFollowupsEditContent} alt="HighLevel - Edit followup nodes" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Recommendation:</strong> We recommend keeping the same frequency and schedule of the messages for best results. The timing has been optimized for maximum engagement and show-up rates.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'followups-publish-save',
          title: 'Publish & Save',
          content: (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Final Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the <strong>Publish</strong> toggle in the top right to enable the workflow</li>
                  <li>Click the <strong>Save</strong> button to save all your changes</li>
                </ol>
              </div>

              <SmoothImage src={webinarFollowupsPublish} alt="HighLevel - Followups workflow Publish and Save" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your Followups workflow is now active and will automatically send nurturing messages to webinar registrants in the days leading up to your webinar.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'rollup-setup',
      title: 'Rollup Setup',
      description: 'Configure post-webinar recording delivery and messages',
      steps: [
        {
          id: 'find-rollup-workflow',
          title: 'Find Rollup Workflow',
          content: (
            <div className="space-y-4">
              <p>
                The Rollup workflow is triggered after your webinar is done. It handles sending the recording link and follow-up messages to attendees.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, navigate to <strong>Automation → Workflows</strong></li>
                  <li>Find the <strong>"Rollup"</strong> workflow in the list</li>
                  <li>Click to open it</li>
                </ol>
              </div>

              <SmoothImage src={rollupWorkflowList} alt="HighLevel - Rollup workflow in workflow list" />
            </div>
          )
        },
        {
          id: 'customize-rollup-messages',
          title: 'Customize Recording Messages',
          content: (
            <div className="space-y-4">
              <p>
                After the webinar, leads will receive an Email, SMS, and WhatsApp message with the recording link. 
                You need to customize these messages with your own content.
              </p>

              <SmoothImage src={rollupWorkflowOverview} alt="HighLevel - Rollup workflow overview" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">For each message type (Email, SMS, WhatsApp):</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Email (Recording)</strong>, <strong>SMS (Recording)</strong>, or <strong>WhatsApp (Recording)</strong> node</li>
                  <li>Update the message content with your own copy</li>
                  <li>Include the recording link and your CTA (call-to-action) from the webinar</li>
                  <li>Save each node after editing</li>
                </ol>
              </div>

              <SmoothImage src={rollupEditEmail} alt="HighLevel - Edit rollup email content" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> These are the first messages leads receive after attending your webinar. Make them count! Include the recording link and duplicate your CTA from the webinar (e.g., schedule a call).
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'get-configure-recording',
          title: 'Get & Save Recording Link',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your replay URL below after your webinar is complete.</p>

              {/* REPLAY URL INPUT FIELD - AT TOP - Same design as Webinar URL */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                isReplayUrlConfigured 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-replay-url" className="text-sm font-medium">
                    Replay URL
                  </Label>
                  {isReplayUrlConfigured && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-replay-url"
                  value={replayUrl}
                  onChange={(e) => onReplayUrlChange?.(e.target.value)}
                  placeholder="https://zoom.us/rec/share/..."
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={onSaveReplayUrl}
                    disabled={savingReplayUrl || !replayUrl}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {savingReplayUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <p>
                  <strong>⚠️ CRITICAL:</strong> After your webinar ends, wait 1-2 hours for Zoom to upload the recording to the cloud before proceeding with this step.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Get the recording link from Zoom</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <a href="https://zoom.us" target="_blank" rel="noopener noreferrer">zoom.us</a> and log into your account</li>
                  <li>Navigate to <strong>Recordings & Transcripts</strong> in the left sidebar</li>
                  <li>Find your webinar recording in the list</li>
                  <li>Click the <strong>Share</strong> button on the right side</li>
                </ol>
              </div>

              <SmoothImage src={zoomRecordingsList} alt="Zoom - Recordings list with share button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure recording settings</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the <strong>Settings</strong> (gear icon) in the Share dialog</li>
                  <li>Disable everything <strong>EXCEPT</strong> "Viewers can see chat"</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>

              <SmoothImage src={zoomShareSettings} alt="Zoom - Recording share settings" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Why enable chat visibility?</strong> Showing the chat makes the replay feel more "live" - viewers can see what questions others asked, which increases engagement and trust.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Copy the link and paste in the field above</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>Copy link</strong> in the Share dialog</li>
                  <li>Paste it in the <strong>Replay URL</strong> field at the top of this step</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>

              <SmoothImage src={zoomCopyLink} alt="Zoom - Copy recording link" />

              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <p>
                  <strong>⚠️ IMPORTANT:</strong> You MUST save the Replay URL BEFORE pushing leads to the next step. If you push leads first, they'll receive messages without any recording links!
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'push-leads-next-step',
          title: 'Push Leads to Next Step',
          content: (
            <div className="space-y-4">
              <p>
                After your webinar ends, all leads will be waiting on the "Wait for Manual Action" step. 
                Once you've saved the Replay URL, you can push them forward to receive their recording messages.
              </p>

              <SmoothImage src={rollupPushLeads} alt="HighLevel - Rollup workflow with waiting leads" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Open the <strong>Rollup</strong> workflow</li>
                  <li>Click on the <strong>people icon</strong> on the "Wait for Manual Action" node</li>
                  <li>Click <strong>"Select all X contacts"</strong> to select everyone</li>
                  <li>Click the <strong>Push button</strong> (arrow icon) to move them to the next step</li>
                </ol>
              </div>

              <SmoothImage src={rollupSelectContacts} alt="HighLevel - Select and push contacts" />
            </div>
          )
        },
        {
          id: 'publish-save-rollup',
          title: 'Publish & Save',
          content: (
            <div className="space-y-4">
              <p>
                Finally, make sure to publish and save the Rollup workflow so it's active for your webinar.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the <strong>Publish</strong> toggle in the top right to enable the workflow</li>
                  <li>Click the <strong>Save</strong> button to save all your changes</li>
                </ol>
              </div>

              <SmoothImage src={rollupPublishSave} alt="HighLevel - Rollup workflow Publish and Save" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your Rollup workflow is now active. After your webinar ends and you push the leads, they will receive the recording link via Email, SMS, and WhatsApp with your customized messages!
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'appointments-setup',
      title: 'Appointments Setup',
      description: 'Configure your calendar and booking system for strategy calls',
      steps: [
        {
          id: 'connect-calendar',
          title: 'Connect Your Calendar',
          content: (
            <div className="space-y-4">
              <p>
                In the Settings section, go to <strong>My Profile</strong>. Here you have an option to connect the calendar you are using. 
              </p>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Why HighLevel Calendar?</strong> We use the HighLevel calendar link for people to book appointments because it's directly synced with all the workflows and the system. On the backend, the HighLevel calendar is powered by your own calendar (Google Calendar, etc.), so whenever someone books a call at your HighLevel calendar - the meeting will be synced with your own calendar.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Settings</strong> → <strong>My Profile</strong></li>
                  <li>Scroll down to find <strong>Calendar Settings</strong></li>
                  <li>Click <strong>+ Add New</strong> to connect your calendar</li>
                  <li>Select your calendar provider (Google Calendar recommended)</li>
                  <li>Authorize the connection</li>
                </ol>
              </div>

              <SmoothImage src={ghlConnectedCalendars} alt="HighLevel - Connected Calendars in My Profile" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> Make sure to also configure the <strong>Linked Calendar</strong> and <strong>Conflict Calendars</strong> sections to ensure proper syncing and avoid double bookings.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'set-working-hours',
          title: 'Set Working Hours',
          content: (
            <div className="space-y-4">
              <p>
                Now you need to set your weekly working hours - this is where you define your schedule for when you want to take calls from people on the webinar. This will be synced with your calendar.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In <strong>Settings</strong> → <strong>My Profile</strong>, scroll down to <strong>Weekly Working Hours</strong></li>
                  <li>Check/uncheck the days you want to be available</li>
                  <li>For each day, set your available time slots (Start Time & End Time)</li>
                  <li>You can add multiple time slots per day if needed</li>
                </ol>
              </div>

              <SmoothImage src={ghlWorkingHours} alt="HighLevel - Weekly Working Hours settings" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">After setting your hours:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Scroll down to the bottom of the page</li>
                  <li>Click the <strong>Update Availability</strong> button to save your changes</li>
                </ol>
              </div>

              <SmoothImage src={ghlUpdateAvailability} alt="HighLevel - Update Availability button" />
            </div>
          )
        },
        {
          id: 'connect-video-conferencing',
          title: 'Connect Video Conferencing',
          content: (
            <div className="space-y-4">
              <p>
                Now connect your video conferencing software so meetings can be automatically scheduled with video links.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In <strong>My Profile</strong>, go to the <strong>Video Conferencing</strong> tab</li>
                  <li>Click <strong>+ Add New</strong></li>
                  <li>Select your video conferencing provider (we highly recommend Zoom)</li>
                  <li>Authorize the connection with your account</li>
                </ol>
              </div>

              <SmoothImage src={ghlVideoConferencing} alt="HighLevel - Video Conferencing settings with Zoom" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Why Zoom?</strong> Zoom provides the most reliable video conferencing integration and is widely trusted by professionals. It also integrates seamlessly with the webinar system you've already set up.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'configure-strategy-calendar',
          title: 'Configure Strategy Call Calendar',
          content: (
            <div className="space-y-4">
              <p>
                Now let's configure the Strategy Call calendar - this is your main calendar where people will book appointments with you on and after the webinar.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Navigate to Calendar Settings</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Calendars</strong> in the left sidebar</li>
                  <li>Click on <strong>Calendar Settings</strong> tab at the top</li>
                </ol>
              </div>

              <SmoothImage src={ghlCalendarsSettings} alt="HighLevel - Calendars with Calendar Settings tab" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Select the Strategy Call calendar</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Find the <strong>Strategy Call</strong> calendar in the list</li>
                  <li>Click on it to open the settings</li>
                </ol>
              </div>

              <SmoothImage src={ghlStrategyCallCalendar} alt="HighLevel - Calendar Settings with Strategy Call calendar" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Update the calendar name</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In <strong>Meeting Details</strong>, change the <strong>Calendar name</strong> to your preferred name</li>
                  <li>Update the description if needed</li>
                </ol>
              </div>

              <SmoothImage src={ghlCalendarName} alt="HighLevel - Edit calendar name" />
            </div>
          )
        },
        {
          id: 'set-meeting-location',
          title: 'Set Meeting Location',
          content: (
            <div className="space-y-4">
              <p>
                Now set up the meeting location - this is where you assign yourself and connect the video conferencing (Zoom) that you set up in the previous steps.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Scroll down to <strong>Select Team member & Assign Meeting Location</strong></li>
                  <li>Add yourself as the team member</li>
                  <li>In the <strong>Meeting location</strong> dropdown, select <strong>Zoom</strong></li>
                  <li>This will use the Zoom account you connected earlier</li>
                </ol>
              </div>

              <SmoothImage src={ghlMeetingLocation} alt="HighLevel - Meeting location with Zoom and team member" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> By assigning yourself as the team member, all meetings booked through this calendar will be assigned to you and use your Zoom link.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'configure-availability-rules',
          title: 'Configure Availability & Booking Rules',
          content: (
            <div className="space-y-4">
              <p>
                Now configure the availability and booking rules for your Strategy Call calendar.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Set Booking Availability</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to the <strong>Availability</strong> tab in the calendar settings</li>
                  <li>Under <strong>Booking Availability</strong>, select yourself as the user</li>
                  <li>This will pull your availability from the working hours you set in My Profile</li>
                </ol>
              </div>

              <SmoothImage src={ghlAvailabilityBooking} alt="HighLevel - Booking Availability with user selection" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure Meeting Parameters</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Set the <strong>Meeting interval</strong> (time between available slots)</li>
                  <li>Set the <strong>Meeting duration</strong> (how long each call is)</li>
                  <li>Set <strong>Minimum scheduling notice</strong> (how far in advance people can book)</li>
                  <li>Set <strong>Date range</strong> (how far into the future people can book)</li>
                  <li>Configure <strong>Pre buffer time</strong> and <strong>Post buffer time</strong> for breaks between calls</li>
                </ol>
              </div>

              <SmoothImage src={ghlMeetingSettings} alt="HighLevel - Meeting interval, duration, and buffer settings" />
            </div>
          )
        },
        {
          id: 'save-calendar',
          title: 'Save Calendar Settings',
          content: (
            <div className="space-y-4">
              <p>
                Finally, save all your calendar settings to make them active.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Review all your settings one more time</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlCalendarSave} alt="HighLevel - Save button for calendar settings" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your Strategy Call calendar is now configured and ready to accept bookings! People from your webinar will be able to book calls with you, and the meetings will be automatically synced with your personal calendar and include Zoom meeting links.
                </p>
              </div>
            </div>
          )
        }
      ]
    }
  ];

  // Refs for race condition protection when saving to database
  const isSavingRef = React.useRef(false);
  const pendingStepsRef = React.useRef<Set<string> | null>(null);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent initial empty state from overwriting DB progress before the first load completes.
  const hasLoadedProgressRef = React.useRef(false);
  const lastSavedStepsKeyRef = React.useRef('');
  const stepsKey = React.useCallback((steps: Set<string>) => Array.from(steps).sort().join('|'), []);

  // Load completed steps from database (primary source) on mount
  useEffect(() => {
    if (clientId && open) {
      // Block saving until we load the current DB state.
      hasLoadedProgressRef.current = false;
      lastSavedStepsKeyRef.current = '';
      pendingStepsRef.current = null;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      const loadFromDatabase = async () => {
        try {
          const { data, error } = await supabase
            .from('clients_public')
            .select('setup_guide_completed_steps')
            .eq('id', clientId)
            .single();

          if (error) throw error;
          
          // Load webinar-specific steps from the database
          const dbSteps = (data?.setup_guide_completed_steps as string[]) || [];
          // Filter to only include webinar-related steps (starting with webinar-)
          const webinarSteps = dbSteps.filter(step => step.startsWith('webinar-'));
          const loaded = new Set(webinarSteps);
          setCompletedSteps(loaded);
          hasLoadedProgressRef.current = true;
          lastSavedStepsKeyRef.current = stepsKey(loaded);
        } catch (e) {
          console.error('Failed to load webinar setup progress from database:', e);
        }
      };
      
      loadFromDatabase();
    }
  }, [clientId, open]);

  // Load navigation position from localStorage (only if not navigating from props)
  useEffect(() => {
    if (clientId && open && !hasNavigatedFromProps) {
      try {
        const saved = localStorage.getItem(`webinar_setup_guide_progress_${clientId}`);
        if (saved) {
          const { expanded, phase, step } = JSON.parse(saved);
          // Only load navigation position, not completed steps (those come from DB)
          if (initialPhase === 0 && initialStep === 0) {
            setCurrentPhase(phase || 0);
            setCurrentStep(step || 0);
            setExpandedPhases(new Set(expanded || [0]));
          }
        }
      } catch (e) {
        console.error('Failed to load webinar setup navigation:', e);
      }
    }
  }, [clientId, open, hasNavigatedFromProps, initialPhase, initialStep]);

  // Subscribe to realtime changes for two-way sync
  useEffect(() => {
    if (!clientId) return;

    const channel = supabase
      .channel(`webinar-setup-sync-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clients', filter: `id=eq.${clientId}` },
        (payload) => {
          // Don't overwrite local state if we're in the middle of saving
          if (isSavingRef.current || pendingStepsRef.current !== null) {
            console.log('Skipping webinar realtime update - save in progress');
            return;
          }
          const steps = (payload.new.setup_guide_completed_steps as string[]) || [];
          const webinarSteps = steps.filter(step => step.startsWith('webinar-'));
          setCompletedSteps(new Set(webinarSteps));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  // Save completed steps to database
  const saveToDatabase = React.useCallback(async (stepsToSave: Set<string>) => {
    if (!clientId) return;
    
    isSavingRef.current = true;
    try {
      // First, get current steps from database to merge (preserve non-webinar steps)
      const { data: currentData } = await supabase
        .from('clients_public')
        .select('setup_guide_completed_steps')
        .eq('id', clientId)
        .single();
      
      const existingSteps = (currentData?.setup_guide_completed_steps as string[]) || [];
      // Keep non-webinar steps, replace webinar steps
      const nonWebinarSteps = existingSteps.filter(step => !step.startsWith('webinar-'));
      const mergedSteps = [...nonWebinarSteps, ...Array.from(stepsToSave)];
      
      const { error } = await supabase
        .from('clients')
        .update({ setup_guide_completed_steps: mergedSteps })
        .eq('id', clientId);
      
      if (error) {
        console.error('Failed to save webinar setup progress to database:', error);
        toast({
          title: "Failed to save progress",
          description: "Your progress may not have been saved. Please try again.",
          variant: "destructive"
        });
      } else {
        lastSavedStepsKeyRef.current = stepsKey(stepsToSave);
      }
    } catch (e) {
      console.error('Failed to save webinar setup progress to database:', e);
      toast({
        title: "Failed to save progress",
        description: "Your progress may not have been saved. Please try again.",
        variant: "destructive"
      });
    } finally {
      isSavingRef.current = false;
      pendingStepsRef.current = null;
    }
  }, [clientId, toast, stepsKey]);

  // Debounced save effect
  useEffect(() => {
    if (!clientId) return;
    if (!hasLoadedProgressRef.current) return;

    const currentKey = stepsKey(completedSteps);
    if (currentKey === lastSavedStepsKeyRef.current) {
      pendingStepsRef.current = null;
      return;
    }

    // Store pending steps for the save
    pendingStepsRef.current = completedSteps;

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save to avoid too many database calls
    saveTimeoutRef.current = setTimeout(() => {
      if (pendingStepsRef.current) {
        saveToDatabase(pendingStepsRef.current);
      }
    }, 300);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [completedSteps, clientId, saveToDatabase, stepsKey]);

  // Force save when dialog closes
  useEffect(() => {
    if (!open && pendingStepsRef.current && clientId && hasLoadedProgressRef.current) {
      const pendingKey = stepsKey(pendingStepsRef.current);
      if (pendingKey === lastSavedStepsKeyRef.current) {
        pendingStepsRef.current = null;
        return;
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveToDatabase(pendingStepsRef.current);
    }
  }, [open, clientId, saveToDatabase, stepsKey]);

  // Save navigation position to localStorage (navigation only, not completion state)
  useEffect(() => {
    if (clientId) {
      try {
        localStorage.setItem(
          `webinar_setup_guide_progress_${clientId}`,
          JSON.stringify({
            phase: currentPhase,
            step: currentStep,
            expanded: Array.from(expandedPhases)
          })
        );
      } catch (e) {
        console.error('Failed to save webinar setup navigation:', e);
      }
    }
  }, [currentPhase, currentStep, expandedPhases, clientId]);

  const activePhase = phases[currentPhase];
  const currentStepId = `${activePhase.id}-${currentStep}`;
  const currentStepData = activePhase.steps[currentStep];

  const isPhaseCompleted = (phaseIndex: number) => {
    const phase = phases[phaseIndex];
    return phase.steps.every((_, stepIndex) => 
      completedSteps.has(`${phase.id}-${stepIndex}`)
    );
  };

  const handleNext = () => {
    if (completedSteps.has(currentStepId)) {
      setCompletedSteps(prev => {
        const next = new Set(prev);
        next.delete(currentStepId);
        return next;
      });
    } else {
      setCompletedSteps(prev => new Set([...prev, currentStepId]));
      
      if (currentStep < activePhase.steps.length - 1) {
        setCurrentStep(currentStep + 1);
      } else if (currentPhase < phases.length - 1) {
        const nextPhase = currentPhase + 1;
        setCurrentPhase(nextPhase);
        setCurrentStep(0);
        setExpandedPhases(prev => new Set([...prev, nextPhase]));
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else if (currentPhase > 0) {
      setCurrentPhase(currentPhase - 1);
      setCurrentStep(phases[currentPhase - 1].steps.length - 1);
    }
  };

  const handlePhaseClick = (phaseIndex: number) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseIndex)) {
        next.delete(phaseIndex);
      } else {
        next.add(phaseIndex);
      }
      return next;
    });
  };

  const handleStepClick = (phaseIndex: number, stepIndex: number) => {
    setCurrentPhase(phaseIndex);
    setCurrentStep(stepIndex);
    setExpandedPhases(prev => {
      if (!prev.has(phaseIndex)) {
        return new Set([...prev, phaseIndex]);
      }
      return prev;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-screen h-screen max-h-screen p-0 gap-0 rounded-none overflow-hidden" aria-describedby={undefined}>
        <VisuallyHidden>
          <DialogTitle>Webinar Setup Guide</DialogTitle>
        </VisuallyHidden>
        <div className="flex h-full w-full overflow-hidden">
          {/* Left Sidebar - Phase & Step Navigation */}
          <div className="w-64 border-r bg-muted/30 flex flex-col h-full overflow-hidden">
            {/* Sidebar Header - Fixed */}
            <div className="px-6 py-4 flex-shrink-0">
              <h2 className="text-base font-semibold">Webinar Setup Guide</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Follow everything step-by-step not skipping any single action.
              </p>
            </div>

            {/* Separator */}
            <div className="border-t border-border/50 flex-shrink-0" />

            {/* Phase & Step List - Scrollable */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden pt-4 px-2 pb-8 space-y-3">
              {phases.map((phase, phaseIndex) => (
                <div key={phase.id}>
                  {/* Phase Header - Clickable to expand/collapse */}
                  <button
                    onClick={() => handlePhaseClick(phaseIndex)}
                    className={cn(
                      "w-full px-4 py-3 text-left flex items-center gap-3 transition-all border-2 rounded-lg",
                      isPhaseCompleted(phaseIndex)
                        ? "border-green-500 bg-green-50/50 dark:bg-green-950/20"
                        : "border-red-500 bg-red-50/50 dark:bg-red-950/20"
                    )}
                  >
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wide flex-1">
                      {phase.title}
                    </h3>
                    <ChevronRight className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      expandedPhases.has(phaseIndex) && "rotate-90"
                    )} />
                  </button>

                  {/* Steps - shown when phase is expanded */}
                  {expandedPhases.has(phaseIndex) && (
                    <div>
                      {phase.steps.map((step, stepIndex) => {
                        const stepId = `${phase.id}-${stepIndex}`;
                        const isActive = phaseIndex === currentPhase && stepIndex === currentStep;
                        return (
                          <button
                            key={step.id}
                            onClick={() => handleStepClick(phaseIndex, stepIndex)}
                            className={cn(
                              "w-full pl-3 pr-6 py-3 text-left transition-colors flex items-center gap-3 border-l-2",
                              isActive
                                ? "bg-primary/10 border-primary"
                                : completedSteps.has(stepId)
                                ? "border-green-500 hover:bg-muted/50"
                                : "border-transparent hover:bg-muted/50"
                            )}
                          >
                            <div className="flex-shrink-0">
                              {completedSteps.has(stepId) ? (
                                <CheckCircle2 className="h-[21px] w-[21px] text-green-600 dark:text-green-400" />
                              ) : (
                                <div className={cn(
                                  "h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] font-medium",
                                  isActive
                                    ? "border-primary text-primary"
                                    : "border-muted-foreground text-muted-foreground"
                                )}>
                                  <span className="mt-px">{stepIndex + 1}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn(
                                "text-sm font-medium",
                                isActive
                                  ? "text-primary"
                                  : "text-foreground"
                              )}>
                                {step.title}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Header - Fixed */}
            <div className="px-6 py-4 border-b bg-background flex-shrink-0">
              <h3 
                key={`title-${currentPhase}-${currentStep}`}
                className="text-sm font-medium transition-all duration-200"
              >
                {currentStepData.title}
              </h3>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 [&_a]:text-blue-600 [&_a]:underline [&_a]:hover:text-blue-800 [&_a]:cursor-pointer">
              <div 
                key={`${currentPhase}-${currentStep}`}
                className="max-w-3xl text-sm animate-fade-in"
              >
                {currentStepData.content}
              </div>
            </div>

            {/* Footer - Fixed */}
            <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between flex-shrink-0">
              <Button
                onClick={handleBack}
                disabled={currentStep === 0 && currentPhase === 0}
                className="bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-70"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>

              <Button 
                onClick={handleNext}
                className={cn(
                  "transition-all duration-300 hover:scale-105 active:scale-95",
                  completedSteps.has(currentStepId)
                    ? "bg-gray-500 hover:bg-gray-600 text-white"
                    : "bg-green-500 hover:bg-green-600 text-white"
                )}
              >
                {completedSteps.has(currentStepId) ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Undone
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Done
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WebinarSetupGuideDialog;