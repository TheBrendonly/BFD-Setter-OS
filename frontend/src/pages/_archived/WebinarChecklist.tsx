import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Target, Users, MessageCircle, Heart, Zap, Bell, Presentation, ArrowRightLeft, Phone, RefreshCw } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import TrafficWizard from '@/components/checklist/TrafficWizard';
import LandingWizard from '@/components/checklist/LandingWizard';
import EngagementWizard from '@/components/checklist/EngagementWizard';
import NurturingWizard from '@/components/checklist/NurturingWizard';
import ExcitementWizard from '@/components/checklist/ExcitementWizard';
import FollowupsWizard from '@/components/checklist/FollowupsWizard';
import { supabase } from '@/integrations/supabase/client';
import { usePageHeader } from '@/contexts/PageHeaderContext';

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  content: React.ReactNode;
  customContent?: boolean;
}
const WebinarChecklist = () => {
  const {
    clientId
  } = useParams<{
    clientId: string;
  }>();

  usePageHeader({
    title: 'Webinar',
    breadcrumbs: [
      { label: 'Webinar' },
      { label: 'Pre-Launch Checklist' },
    ],
  });
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Load progress from localStorage
  useEffect(() => {
    if (clientId) {
      try {
        const saved = localStorage.getItem(`webinar_checklist_progress_${clientId}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          setCompletedItems(new Set(parsed.completed || []));
          setExpandedItems(new Set(parsed.expanded || []));
        }
      } catch (e) {
        console.error('Failed to load checklist progress:', e);
      }
    }
  }, [clientId]);

  // Save progress to localStorage whenever it changes
  useEffect(() => {
    if (clientId) {
      try {
        localStorage.setItem(`webinar_checklist_progress_${clientId}`, JSON.stringify({
          completed: Array.from(completedItems),
          expanded: Array.from(expandedItems)
        }));
      } catch (e) {
        console.error('Failed to save checklist progress:', e);
      }
    }
  }, [completedItems, expandedItems, clientId]);
  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const toggleCompleted = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCompletedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleTrafficComplete = () => {
    // Only mark complete if not already completed (prevent toggle-off)
    if (!completedItems.has('traffic')) {
      setCompletedItems(prev => new Set([...prev, 'traffic']));
    }
    toggleExpanded('traffic');
  };

  const handleTrafficReset = () => {
    // Remove traffic from completed items when wizard is reset
    setCompletedItems(prev => {
      const next = new Set(prev);
      next.delete('traffic');
      return next;
    });
  };

  const handleLandingComplete = () => {
    if (!completedItems.has('landing')) {
      setCompletedItems(prev => new Set([...prev, 'landing']));
    }
    toggleExpanded('landing');
  };

  const handleLandingReset = () => {
    setCompletedItems(prev => {
      const next = new Set(prev);
      next.delete('landing');
      return next;
    });
  };

  const handleEngagementComplete = () => {
    if (!completedItems.has('engagement')) {
      setCompletedItems(prev => new Set([...prev, 'engagement']));
    }
    toggleExpanded('engagement');
  };

  const handleEngagementReset = () => {
    setCompletedItems(prev => {
      const next = new Set(prev);
      next.delete('engagement');
      return next;
    });
  };

  const handleNurturingComplete = () => {
    if (!completedItems.has('nurturing')) {
      setCompletedItems(prev => new Set([...prev, 'nurturing']));
    }
    toggleExpanded('nurturing');
  };

  const handleNurturingReset = () => {
    setCompletedItems(prev => {
      const next = new Set(prev);
      next.delete('nurturing');
      return next;
    });
  };

  const handleExcitementComplete = () => {
    if (!completedItems.has('excitement')) {
      setCompletedItems(prev => new Set([...prev, 'excitement']));
    }
    toggleExpanded('excitement');
  };

  const handleExcitementReset = () => {
    setCompletedItems(prev => {
      const next = new Set(prev);
      next.delete('excitement');
      return next;
    });
  };

  const handleFollowupsComplete = () => {
    if (!completedItems.has('followups')) {
      setCompletedItems(prev => new Set([...prev, 'followups']));
    }
    toggleExpanded('followups');
  };

  const handleFollowupsReset = () => {
    setCompletedItems(prev => {
      const next = new Set(prev);
      next.delete('followups');
      return next;
    });
  };

  // State for setup guide completed steps (for engagement wizard)
  const [setupGuideCompletedSteps, setSetupGuideCompletedSteps] = useState<string[]>([]);

  // Load setup guide completed steps
  useEffect(() => {
    const loadSetupGuideSteps = async () => {
      if (!clientId) return;
      try {
        const { data } = await supabase
          .from('clients')
          .select('setup_guide_completed_steps')
          .eq('id', clientId)
          .single();
        if (data?.setup_guide_completed_steps) {
          setSetupGuideCompletedSteps(data.setup_guide_completed_steps as string[]);
        }
      } catch (e) {
        console.error('Failed to load setup guide steps:', e);
      }
    };
    loadSetupGuideSteps();
  }, [clientId]);

  // Define the 10 checklist items
  const checklistItems: ChecklistItem[] = [{
    id: 'traffic',
    title: 'Traffic',
    description: 'How you get leads to your landing page',
    icon: Target,
    customContent: true,
    content: clientId ? (
      <TrafficWizard clientId={clientId} onComplete={handleTrafficComplete} onReset={handleTrafficReset} />
    ) : null
  }, {
    id: 'landing',
    title: 'Landing',
    description: 'Your webinar registration page',
    icon: Users,
    customContent: true,
    content: clientId ? (
      <LandingWizard clientId={clientId} onComplete={handleLandingComplete} onReset={handleLandingReset} />
    ) : null
  }, {
    id: 'engagement',
    title: 'Engagement',
    description: 'AI reps engaging leads across channels',
    icon: MessageCircle,
    customContent: true,
    content: clientId ? (
      <EngagementWizard 
        clientId={clientId} 
        onComplete={handleEngagementComplete} 
        onReset={handleEngagementReset}
        setupGuideCompletedSteps={setupGuideCompletedSteps}
      />
    ) : null
  }, {
    id: 'nurturing',
    title: 'Nurturing',
    description: 'AI conversations to qualify and educate leads',
    icon: Heart,
    customContent: true,
    content: clientId ? (
      <NurturingWizard 
        clientId={clientId} 
        onComplete={handleNurturingComplete} 
        onReset={handleNurturingReset}
        setupGuideCompletedSteps={setupGuideCompletedSteps}
      />
    ) : null
  }, {
    id: 'excitement',
    title: 'Excitement',
    description: 'Building hype and anticipation',
    icon: Zap,
    customContent: true,
    content: clientId ? (
      <ExcitementWizard 
        clientId={clientId} 
        onComplete={handleExcitementComplete} 
        onReset={handleExcitementReset}
        setupGuideCompletedSteps={setupGuideCompletedSteps}
      />
    ) : null
  }, {
    id: 'followups',
    title: 'Follow-ups',
    description: 'Reminders and educational content',
    icon: Bell,
    customContent: true,
    content: clientId ? (
      <FollowupsWizard 
        clientId={clientId} 
        onComplete={handleFollowupsComplete} 
        onReset={handleFollowupsReset}
        setupGuideCompletedSteps={setupGuideCompletedSteps}
      />
    ) : null
  }, {
    id: 'performance',
    title: 'Performance',
    description: 'Your webinar script and presentation',
    icon: Presentation,
    content: <div className="space-y-4">
          <p>
            Your webinar performance and script structure are critical for keeping attention and moving leads toward your offer.
          </p>
          
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">Checklist:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Hook/Opening (first 5 minutes) - grab attention, set expectations</li>
              <li>Credibility section - why should they listen to you?</li>
              <li>Content section - deliver massive value (40-50 minutes)</li>
              <li>Transition to offer - bridge from content to solution</li>
              <li>Offer presentation - clearly explain what they get</li>
              <li>Objection handling - address common concerns</li>
              <li>Call-to-action - clear next steps</li>
              <li>Q&A section prepared</li>
              <li>Slides are visually clean and professional</li>
              <li>Tech check completed (camera, mic, screen share)</li>
            </ol>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p>
              <strong>Structure:</strong> The best webinars follow a "teach → transition → offer" flow. Give real value first, then naturally transition to your solution.
            </p>
          </div>
        </div>
  }, {
    id: 'conversion',
    title: 'Conversion',
    description: 'Converting attendees to bookings',
    icon: ArrowRightLeft,
    content: <div className="space-y-4">
          <p>
            Your conversion strategy turns webinar attendees into booked calls or direct purchases. This is where you monetize your webinar efforts.
          </p>
          
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">Checklist:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Clear CTA defined (book a call, buy now, apply)</li>
              <li>Booking page/calendar is set up and tested</li>
              <li>CTA link is easily accessible during the webinar</li>
              <li>Limited-time offer or bonus for taking action now</li>
              <li>Follow-up sequence for non-converters ready</li>
              <li>Replay strategy defined (send replay with CTA)</li>
              <li>Urgency elements in place (deadline, limited spots)</li>
              <li>Thank you page after booking is configured</li>
            </ol>
          </div>

          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <p>
              <strong>Benchmark:</strong> Aim for 10-20% of live attendees to book a call or purchase. If you're below 10%, refine your offer or CTA timing.
            </p>
          </div>
        </div>
  }, {
    id: 'sales',
    title: 'Sales',
    description: 'Discovery and strategy calls',
    icon: Phone,
    content: <div className="space-y-4">
          <p>
            Your sales calls are where you close deals with leads who are already educated and excited. These leads understand your solution - they just need final clarifications.
          </p>
          
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">Checklist:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Call script/framework prepared</li>
              <li>Discovery questions ready to understand their situation</li>
              <li>Pricing and packages clearly defined</li>
              <li>Objection handling responses prepared</li>
              <li>Payment links/contracts ready to send</li>
              <li>Follow-up sequence for no-shows and "not yets"</li>
              <li>CRM is tracking call outcomes</li>
              <li>Calendar reminders set for your call blocks</li>
            </ol>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p>
              <strong>Key Point:</strong> Webinar leads are warmer than cold leads. They've invested time to learn from you. Your call should focus on understanding their specific situation, not re-selling the concept.
            </p>
          </div>
        </div>
  }, {
    id: 'reactivation',
    title: 'Reactivation',
    description: 'Post-webinar value extraction',
    icon: RefreshCw,
    content: <div className="space-y-4">
          <p>
            Reactivation workflows ensure you extract maximum value from everyone who signed up - including no-shows and those who didn't convert initially.
          </p>
          
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">Checklist:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Replay email sent to all registrants (especially no-shows)</li>
              <li>Limited-time replay access to create urgency</li>
              <li>Follow-up sequence for replay viewers</li>
              <li>No-show specific messaging (empathetic, offer replay)</li>
              <li>Long-term nurture sequence for non-buyers</li>
              <li>Invite to next webinar or related content</li>
              <li>Survey to gather feedback and improve</li>
              <li>Tag leads based on engagement level for future targeting</li>
            </ol>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
            <p>
              <strong>Don't Leave Money on the Table:</strong> 70-80% of your leads won't convert immediately. A strong reactivation sequence can recover 20-30% of those over time.
            </p>
          </div>
        </div>
  }];
  const completedCount = completedItems.size;
  const totalCount = checklistItems.length;
  const percentage = Math.round(completedCount / totalCount * 100);
  return <div className="h-full overflow-hidden bg-background flex flex-col">
      <div className="container mx-auto max-w-7xl flex flex-col h-full overflow-hidden py-4">
        {/* Progress Card - Sticky at top */}
        <Card className="material-surface mb-4 flex-shrink-0 bg-background/95 backdrop-blur-sm">
          <CardHeader className="pb-3 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Complete Before Launching Webinar</CardTitle>
                <CardDescription className="mt-1">
                  Complete all steps to ensure a successful webinar launch
                </CardDescription>
              </div>
              <div className="text-right">
                <span className="text-[24px] font-bold text-primary">
                  {percentage}%
                </span>
                <p className="text-xs text-muted-foreground">
                  {completedCount}/{totalCount} steps
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <Progress value={percentage} className="h-2" />
          </CardContent>
        </Card>

        {/* Checklist Items - Scrollable */}
        <div className="space-y-3 flex-1 overflow-auto pb-4">
          {checklistItems.map(item => {
          const isCompleted = completedItems.has(item.id);
          const isExpanded = expandedItems.has(item.id);
          const Icon = item.icon;
          return <Collapsible key={item.id} open={isExpanded} onOpenChange={() => toggleExpanded(item.id)}>
                <div className={cn("border-2 rounded-lg transition-all", isCompleted ? "border-green-500 bg-green-50/30 dark:bg-green-950/10" : "border-red-500 bg-red-50/30 dark:bg-red-950/10")}>
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center gap-4 p-4">
                      {/* Icon only - no circles or numbers */}
                      <div className={cn("p-2 rounded-lg flex-shrink-0", isCompleted ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30")}>
                        <Icon className={cn("h-5 w-5", isCompleted ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")} />
                      </div>

                      {/* Title and Description */}
                      <div className="flex-1 text-left min-w-0">
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                          {item.title}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                          {item.description}
                        </p>
                      </div>

                      {/* Chevron */}
                      <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180")} />
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-0">
                      <div className="border-t border-border/50 pt-4">
                        <div className="text-sm [&_a]:text-blue-600 [&_a]:underline [&_a]:hover:text-blue-800">
                          {item.content}
                        </div>
                        
                        {/* Done Button - Same style as setup guides (hide for custom content items) */}
                        {!item.customContent && (
                          <div className="flex justify-end mt-4 pt-4 border-t border-border/50">
                            <Button onClick={e => toggleCompleted(item.id, e)} className={cn("transition-all duration-300 hover:scale-105 active:scale-95", isCompleted ? "bg-gray-500 hover:bg-gray-600 text-white" : "bg-green-500 hover:bg-green-600 text-white")}>
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              {isCompleted ? 'Undone' : 'Done'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>;
        })}
        </div>
      </div>
    </div>;
};
export default WebinarChecklist;