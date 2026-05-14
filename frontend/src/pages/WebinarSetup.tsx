import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Save, Loader2, Link, CheckCircle, Circle, ChevronRight, Settings, Video, Layout, MessageSquare, Mail, Calendar } from '@/components/icons';
const GitBranch = Link; const ClipboardCheck = CheckCircle;
import { cn } from '@/lib/utils';
import WebinarSetupGuideDialog from '@/components/WebinarSetupGuideDialog';
import { areAllPhasesComplete, SETUP_PHASES, PHASE_IDS, isPhaseComplete } from '@/components/SetupGuideDialog';
const WEBINAR_WEBHOOK_URL = 'https://n8n-1prompt.99players.com/webhook/update_webinar_details';
import { usePageHeader } from '@/contexts/PageHeaderContext';

// Webinar-specific phase definitions
const WEBINAR_PHASES = [{
  id: 'api-setup',
  title: 'AI Reps Setup',
  description: 'Complete the AI Reps setup to enable AI text and voice reps',
  icon: Settings,
  dialogPhase: 0,
  dialogStep: 0,
  // This phase depends on the main setup guide completion
  isApiDependency: true
}, {
  id: 'zoom-setup',
  title: 'Zoom Setup',
  description: 'Create and configure your Zoom webinar',
  icon: Video,
  dialogPhase: 1,
  dialogStep: 0,
  totalSteps: 10
}, {
  id: 'highlevel-setup',
  title: 'Landing Setup',
  description: 'Configure your landing page funnel',
  icon: Layout,
  dialogPhase: 2,
  dialogStep: 0,
  totalSteps: 8
}, {
  id: 'pipeline-setup',
  title: 'Pipeline Setup',
  description: 'Set up pipeline stages for lead tracking',
  icon: GitBranch,
  dialogPhase: 3,
  dialogStep: 0,
  totalSteps: 2
}, {
  id: 'dashboard-setup',
  title: 'Dashboard Setup',
  description: 'Track your webinar progress synced with pipeline',
  icon: Layout,
  dialogPhase: 4,
  dialogStep: 0,
  totalSteps: 2
}, {
  id: 'engagement-setup',
  title: 'Engagement Setup',
  description: 'Configure engagement workflows and messages',
  icon: MessageSquare,
  dialogPhase: 5,
  dialogStep: 0,
  totalSteps: 12
}, {
  id: 'followups-setup',
  title: 'Followups Setup',
  description: 'Configure pre-webinar follow-up sequences',
  icon: Mail,
  dialogPhase: 6,
  dialogStep: 0,
  totalSteps: 4
}, {
  id: 'rollup-setup',
  title: 'Rollup Setup',
  description: 'Configure post-webinar recording and messages',
  icon: Video,
  dialogPhase: 7,
  dialogStep: 0,
  totalSteps: 5
}, {
  id: 'appointments-setup',
  title: 'Appointments Setup',
  description: 'Configure your calendar and booking system',
  icon: Calendar,
  dialogPhase: 8,
  dialogStep: 0,
  totalSteps: 7
}];
const WebinarSetup = () => {
  const {
    clientId
  } = useParams<{
    clientId: string;
  }>();
  const {
    user
  } = useAuth();
  const {
    toast
  } = useToast();

  usePageHeader({
    title: 'Webinar',
    breadcrumbs: [
      { label: 'Webinar' },
      { label: 'Configuration' },
    ],
  });
  const [loading, setLoading] = useState(true);
  const [savingWebinarUrl, setSavingWebinarUrl] = useState(false);
  const [savingReplayUrl, setSavingReplayUrl] = useState(false);
  const [clientSupabaseUrl, setClientSupabaseUrl] = useState<string | null>(null);
  const [clientSupabaseAnonKey, setClientSupabaseAnonKey] = useState<string | null>(null);
  const [webinarUrl, setWebinarUrl] = useState('');
  const [originalWebinarUrl, setOriginalWebinarUrl] = useState('');
  const [replayUrl, setReplayUrl] = useState('');
  const [originalReplayUrl, setOriginalReplayUrl] = useState('');

  // Webinar setup guide state
  const [webinarSetupGuideOpen, setWebinarSetupGuideOpen] = useState(false);
  const [setupGuideCompletedSteps, setSetupGuideCompletedSteps] = useState<string[]>([]);
  const [webinarGuideProgress, setWebinarGuideProgress] = useState<{
    phase: number;
    step: number;
    completed: string[];
    expanded: number[];
  } | null>(null);

  // State to track which phase/step to open dialog at
  const [dialogInitialPhase, setDialogInitialPhase] = useState(0);
  const [dialogInitialStep, setDialogInitialStep] = useState(0);
  useEffect(() => {
    if (clientId) {
      fetchWebinarData();
      loadWebinarGuideProgress();
    }
  }, [clientId, user]);
  const loadWebinarGuideProgress = () => {
    if (!clientId) return;
    try {
      const saved = localStorage.getItem(`webinar_setup_guide_progress_${clientId}`);
      if (saved) {
        setWebinarGuideProgress(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load webinar setup progress:', e);
    }
  };
  const fetchWebinarData = async () => {
    if (!clientId || !user) {
      setLoading(false);
      return;
    }
    try {
      // Fetch client's Supabase URL, API key, and setup guide steps
      const {
        data: clientData
      } = await supabase.from('clients').select('supabase_url, supabase_service_key, setup_guide_completed_steps').eq('id', clientId).single();
      if (clientData) {
        setClientSupabaseUrl(clientData.supabase_url);
        setClientSupabaseAnonKey(clientData.supabase_service_key);
        const completedSteps = (clientData.setup_guide_completed_steps || []) as string[];
        setSetupGuideCompletedSteps(Array.isArray(completedSteps) ? completedSteps : []);
      }

      // Fetch from our webinar_setup table
      const {
        data: webinarData,
        error
      } = await supabase.from('webinar_setup').select('webinar_url, replay_url').eq('client_id', clientId).maybeSingle();
      if (!error && webinarData) {
        setWebinarUrl(webinarData.webinar_url || '');
        setOriginalWebinarUrl(webinarData.webinar_url || '');
        setReplayUrl(webinarData.replay_url || '');
        setOriginalReplayUrl(webinarData.replay_url || '');
      }
    } catch (error: any) {
      console.log('Error fetching webinar data:', error.message);
    } finally {
      setLoading(false);
    }
  };
  const validateUrl = (url: string): boolean => {
    if (!url.trim()) return false;
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'https:' || urlObj.protocol === 'http:';
    } catch {
      return false;
    }
  };
  const handleSaveWebinarUrl = async () => {
    if (!validateUrl(webinarUrl)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid Webinar URL",
        variant: "destructive"
      });
      return;
    }
    setSavingWebinarUrl(true);
    try {
      const {
        error: dbError
      } = await supabase.from('webinar_setup').upsert({
        client_id: clientId,
        webinar_url: webinarUrl,
        replay_url: originalReplayUrl || null
      }, {
        onConflict: 'client_id'
      });
      if (dbError) throw dbError;
      const webhookPayload = {
        client_id: clientId,
        field_updated: 'webinar_url',
        webinar_url: webinarUrl,
        replay_url: originalReplayUrl || null,
        supabase_url: clientSupabaseUrl,
        supabase_api_key: clientSupabaseAnonKey
      };
      try {
        await supabase.functions.invoke('notify-webhook', {
          body: {
            url: WEBINAR_WEBHOOK_URL,
            payload: webhookPayload
          }
        });
      } catch (webhookError) {
        console.error('Webhook error:', webhookError);
      }
      setOriginalWebinarUrl(webinarUrl);
      toast({
        title: "Success",
        description: "Webinar URL saved successfully"
      });
    } catch (error: any) {
      console.error('Error saving field:', error);
      toast({
        title: "Error",
        description: "Failed to save Webinar URL",
        variant: "destructive"
      });
    } finally {
      setSavingWebinarUrl(false);
    }
  };
  const handleSaveReplayUrl = async () => {
    if (replayUrl && !validateUrl(replayUrl)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid Replay URL",
        variant: "destructive"
      });
      return;
    }
    setSavingReplayUrl(true);
    try {
      const {
        error: dbError
      } = await supabase.from('webinar_setup').upsert({
        client_id: clientId,
        webinar_url: originalWebinarUrl,
        replay_url: replayUrl || null
      }, {
        onConflict: 'client_id'
      });
      if (dbError) throw dbError;
      const webhookPayload = {
        client_id: clientId,
        field_updated: 'replay_url',
        webinar_url: originalWebinarUrl,
        replay_url: replayUrl || null,
        supabase_url: clientSupabaseUrl,
        supabase_api_key: clientSupabaseAnonKey
      };
      try {
        await supabase.functions.invoke('notify-webhook', {
          body: {
            url: WEBINAR_WEBHOOK_URL,
            payload: webhookPayload
          }
        });
      } catch (webhookError) {
        console.error('Webhook error:', webhookError);
      }
      setOriginalReplayUrl(replayUrl);
      toast({
        title: "Success",
        description: "Replay URL saved successfully"
      });
    } catch (error: any) {
      console.error('Error saving field:', error);
      toast({
        title: "Error",
        description: "Failed to save Replay URL",
        variant: "destructive"
      });
    } finally {
      setSavingReplayUrl(false);
    }
  };

  // Calculate phase completion status
  const getPhaseStatus = (phase: typeof WEBINAR_PHASES[0]) => {
    if (phase.isApiDependency) {
      // For API setup, check if all main setup phases are complete
      const isComplete = areAllPhasesComplete(setupGuideCompletedSteps);
      const totalSteps = PHASE_IDS.reduce((sum, id) => sum + SETUP_PHASES[id], 0);
      const completedCount = setupGuideCompletedSteps.length;
      return {
        completed: completedCount,
        total: totalSteps,
        percentage: Math.round(completedCount / totalSteps * 100),
        isComplete
      };
    }

    // For webinar-specific phases, check localStorage progress
    if (webinarGuideProgress?.completed) {
      const phaseSteps = webinarGuideProgress.completed.filter((step: string) => step.startsWith(phase.id));
      const total = phase.totalSteps || 1;
      const completed = phaseSteps.length;
      return {
        completed,
        total,
        percentage: Math.round(completed / total * 100),
        isComplete: completed >= total
      };
    }
    return {
      completed: 0,
      total: phase.totalSteps || 1,
      percentage: 0,
      isComplete: false
    };
  };

  // Calculate overall progress
  const getOverallProgress = () => {
    let totalSteps = 0;
    let completedSteps = 0;
    WEBINAR_PHASES.forEach(phase => {
      const status = getPhaseStatus(phase);
      totalSteps += status.total;
      completedSteps += status.completed;
    });
    return {
      completed: completedSteps,
      total: totalSteps,
      percentage: totalSteps > 0 ? Math.round(completedSteps / totalSteps * 100) : 0
    };
  };
  const handlePhaseClick = (phase: typeof WEBINAR_PHASES[0]) => {
    setDialogInitialPhase(phase.dialogPhase);
    setDialogInitialStep(phase.dialogStep);
    setWebinarSetupGuideOpen(true);
  };
  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>;
  }
  const overallProgress = getOverallProgress();
  const isWebinarConfigured = Boolean(originalWebinarUrl?.trim());
  const isReplayConfigured = Boolean(originalReplayUrl?.trim());
  return <div className="h-full overflow-hidden bg-background">
      <div className="container mx-auto max-w-7xl h-full flex flex-col overflow-hidden py-4">
        {/* Webinar Setup Guide Dialog */}
        <WebinarSetupGuideDialog open={webinarSetupGuideOpen} onOpenChange={open => {
        setWebinarSetupGuideOpen(open);
        if (!open) {
          // Reload progress when dialog closes
          loadWebinarGuideProgress();
        }
      }} clientId={clientId} setupGuideCompletedSteps={setupGuideCompletedSteps} webinarUrl={webinarUrl} originalWebinarUrl={originalWebinarUrl} onWebinarUrlChange={setWebinarUrl} onSaveWebinarUrl={handleSaveWebinarUrl} savingWebinarUrl={savingWebinarUrl} replayUrl={replayUrl} originalReplayUrl={originalReplayUrl} onReplayUrlChange={setReplayUrl} onSaveReplayUrl={handleSaveReplayUrl} savingReplayUrl={savingReplayUrl} initialPhase={dialogInitialPhase} initialStep={dialogInitialStep} />


        {/* Overall Progress Card - Sticky */}
        <Card className="material-surface mb-4 flex-shrink-0 bg-background/95 backdrop-blur-sm">
          <CardHeader className="pb-3 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Webinar Setup Progress</CardTitle>
                <CardDescription className="mt-1">
                  Complete all phases to setup your webinar and the BFD-setter system
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

        {/* Setup Phases Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-1 content-start">
          {WEBINAR_PHASES.map(phase => {
          const status = getPhaseStatus(phase);
          const Icon = phase.icon;
          return <Card key={phase.id} onClick={() => handlePhaseClick(phase)} className={cn("material-surface cursor-pointer transition-all hover:shadow-md border-2", status.isComplete ? "border-green-500 bg-green-50/30 dark:bg-green-950/10" : status.completed > 0 ? "border-amber-500 bg-amber-50/30 dark:bg-amber-950/10" : "border-red-500 bg-red-50/30 dark:bg-red-950/10")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn("p-2 rounded-lg", status.isComplete ? "bg-green-100 dark:bg-green-900/30" : status.completed > 0 ? "bg-amber-100 dark:bg-amber-900/30" : "bg-red-100 dark:bg-red-900/30")}>
                      <Icon className={cn("h-5 w-5", status.isComplete ? "text-green-600 dark:text-green-400" : status.completed > 0 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">{phase.title}</h3>
                        <ChevronRight className={cn("h-4 w-4 flex-shrink-0", status.isComplete ? "text-green-600" : status.completed > 0 ? "text-amber-600" : "text-red-600")} />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {phase.description}
                      </p>
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">
                            {status.completed}/{status.total} steps
                          </span>
                          <span className={cn("text-sm font-medium", status.isComplete ? "text-green-600" : status.completed > 0 ? "text-amber-600" : "text-red-600")}>
                            {status.percentage}%
                          </span>
                        </div>
                        <Progress value={status.percentage} className={cn("h-1.5", status.isComplete && "[&>div]:bg-green-500", status.completed > 0 && !status.isComplete && "[&>div]:bg-amber-500", status.completed === 0 && "[&>div]:bg-red-500")} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>;
        })}
        </div>

      </div>
    </div>;
};
export default WebinarSetup;