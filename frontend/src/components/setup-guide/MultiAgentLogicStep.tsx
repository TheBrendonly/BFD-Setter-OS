import React, { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, AlertCircle, Loader2 } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import ghlEngagementAgentNumber from '@/assets/setup-guide/ghl-engagement-agent-number.png';
import ghlRollupAgentNumber from '@/assets/setup-guide/ghl-rollup-agent-number.png';
import n8nMultiAgentRouting from '@/assets/setup-guide/n8n-multi-agent-routing.png';
import QuizQuestion from './QuizQuestion';

import { QuizNavigationState } from './VoiceInboundLogicStep';

interface MultiAgentLogicStepProps {
  clientId: string;
  onNavigationChange?: (state: QuizNavigationState) => void;
}

// Lazy loading image component
const GuideImage = React.memo(({ src, alt }: { src: string; alt: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.unobserve(container);
          }
        });
      },
      { rootMargin: '100px', threshold: 0.1 }
    );
    
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  
  return (
    <div ref={containerRef} className="rounded-lg overflow-hidden border border-border/50 mb-4 relative bg-muted/30">
      {!isLoaded && isVisible && (
        <div className="absolute inset-0 flex items-center justify-center min-h-[80px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {isVisible && (
        <img 
          src={src} 
          alt={alt} 
          className={cn(
            "w-full h-auto max-h-[400px] object-contain transition-opacity duration-200",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
          onLoad={() => setIsLoaded(true)}
          loading="lazy"
        />
      )}
    </div>
  );
});

const QUIZ_QUESTIONS = [
  {
    id: 'q1',
    question: "What does a 'setter slot' represent in BFD-setter?",
    options: [
      { label: 'One phone number, one setter slot', correct: false },
      { label: 'One configurable AI Rep with its own prompt, voice, and direction routing (inbound / outbound / followup)', correct: true },
      { label: 'One customer account', correct: false },
    ]
  },
  {
    id: 'q2', 
    question: 'How do you assign an AI Rep to a lead?',
    options: [
      { label: 'By manually sending them a message', correct: false },
      { label: 'By setting the Agent Number custom field in the workflow', correct: true },
      { label: 'AI automatically decides which agent to use', correct: false },
    ]
  },
  {
    id: 'q3',
    question: 'If you want to A/B test a new prompt, what should you do?',
    options: [
      { label: 'Delete the old prompt and create a new one', correct: false },
      { label: 'Create a new prompt with a different number and change the Agent Number in the workflow', correct: true },
      { label: 'Copy the prompt content to a different system', correct: false },
    ]
  },
  {
    id: 'q4',
    question: 'What determines which prompt an AI Rep uses?',
    options: [
      { label: 'The prompt name you give it', correct: false },
      { label: 'The prompt number (1, 2, 3, etc.)', correct: true },
      { label: 'The time of day', correct: false },
    ]
  },
];

export default function MultiAgentLogicStep({ clientId, onNavigationChange }: MultiAgentLogicStepProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [showQuizResults, setShowQuizResults] = useState(false);
  const [isQuizComplete, setIsQuizComplete] = useState(false);
  
  // Ref to track previous navigation state and prevent unnecessary parent updates
  const prevNavStateRef = useRef<string>('');
  // Ref to store the callback to avoid dependency issues
  const onNavigationChangeRef = useRef(onNavigationChange);
  onNavigationChangeRef.current = onNavigationChange;
  
  // Load progress from localStorage
  useEffect(() => {
    const savedStep = localStorage.getItem(`multi_agent_logic_step_${clientId}`);
    const savedAnswers = localStorage.getItem(`multi_agent_logic_answers_${clientId}`);
    const savedQuizComplete = localStorage.getItem(`multi_agent_logic_quiz_${clientId}`);
    
    if (savedStep) {
      setCurrentStep(parseInt(savedStep, 10));
    }
    if (savedAnswers) {
      try {
        setQuizAnswers(JSON.parse(savedAnswers));
      } catch (e) {
        // ignore parse errors
      }
    }
    if (savedQuizComplete === 'completed') {
      setIsQuizComplete(true);
    }
  }, [clientId]);
  
  // Save progress to localStorage (debounced to avoid main-thread jank)
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(`multi_agent_logic_step_${clientId}`, currentStep.toString());
      } catch {
        // ignore storage errors (quota / private mode)
      }
    }, 120);

    return () => window.clearTimeout(t);
  }, [currentStep, clientId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(`multi_agent_logic_answers_${clientId}`, JSON.stringify(quizAnswers));
      } catch {
        // ignore storage errors (quota / private mode)
      }
    }, 120);

    return () => window.clearTimeout(t);
  }, [quizAnswers, clientId]);
  
  const handleQuizSubmit = () => {
    const allCorrect = QUIZ_QUESTIONS.every(q => {
      const selectedOption = q.options.find(o => o.label === quizAnswers[q.id]);
      return selectedOption?.correct;
    });

    startTransition(() => {
      setShowQuizResults(true);
    });

    if (allCorrect) {
      startTransition(() => {
        setIsQuizComplete(true);
      });
      try {
        localStorage.setItem(`multi_agent_logic_quiz_${clientId}`, 'completed');
      } catch {
        // ignore storage errors
      }
      // User must manually click Done button to mark step as complete
    }
  };
  
  const handleNext = useCallback(() => {
    startTransition(() => {
      setCurrentStep(prev => prev + 1);
    });
  }, []);

  const handleBack = useCallback(() => {
    startTransition(() => {
      setCurrentStep(prev => Math.max(0, prev - 1));
    });
  }, []);
  
  const handleReset = useCallback(() => {
    setQuizAnswers({});
    setShowQuizResults(false);
  }, []);

  const handleRestart = useCallback(() => {
    setCurrentStep(0);
    setQuizAnswers({});
    setShowQuizResults(false);
    setIsQuizComplete(false);
    localStorage.removeItem(`multi_agent_logic_step_${clientId}`);
    localStorage.removeItem(`multi_agent_logic_answers_${clientId}`);
    localStorage.removeItem(`multi_agent_logic_quiz_${clientId}`);
    // User must manually click Done button to re-mark step
  }, [clientId]);
  
  // Stable callback for quiz answer selection - prevents re-renders
  const handleQuizSelect = useCallback((questionId: string, answer: string) => {
    setQuizAnswers(prev => ({ ...prev, [questionId]: answer }));
  }, []);

  // Calculate quiz progress
  const answeredCount = Object.keys(quizAnswers).length;
  const quizProgress = (answeredCount / QUIZ_QUESTIONS.length) * 100;
  
  // Content steps
  const staticSteps = useMemo(() => ([
    // Step 0: Introduction
    <div key="intro" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Multi-Agent Logic</CardTitle>
        <CardDescription>
          Understanding how multiple AI Reps work together in your funnel
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        This step explains the core concept of how multiple AI Reps (agents) work together in your system. This is essential knowledge for setting up your prompts correctly.
      </p>

      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
        <p className="text-sm text-muted-foreground font-medium">What you'll learn:</p>
        <ul className="text-sm text-muted-foreground ml-4 space-y-2">
          <li>• Why we use multiple AI Reps instead of one</li>
          <li>• How prompts relate to agents</li>
          <li>• How to route leads to the right AI Rep</li>
          <li>• How to A/B test different prompts</li>
        </ul>
      </div>

      {/* Yellow note - matching app style */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-sm">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <p className="text-yellow-700 dark:text-yellow-300">
            <strong>Note:</strong> If you don't understand this after reading, please send us a message on Skool or WhatsApp saying: "I still do not understand multi-agent logic. Can you please explain?" - and we will help you!
          </p>
        </div>
      </div>

    </div>,

    // Step 1: This Works for ANY Funnel
    <div key="any-funnel" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">This Works for ANY Funnel</CardTitle>
        <CardDescription>
          Webinar is just an example to explain the concept
        </CardDescription>
      </CardHeader>

      <div className="bg-primary/10 border-2 border-primary/30 rounded-lg p-6 text-center">
        <h3 className="text-2xl font-bold text-primary mb-4">
          Important: Webinar = Just an Example
        </h3>
        <p className="text-muted-foreground text-sm">
          Throughout this guide, we'll use a <strong>webinar funnel</strong> as our example because it's easy to explain. But the multi-agent approach works for <strong>ANY</strong> funnel type you run.
        </p>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">Examples of funnels that work with multi-agent logic:</p>
        <ul className="text-sm text-blue-900 dark:text-blue-200 ml-4 space-y-2">
          <li>• <strong>Double Opt-In Funnel:</strong> Lead opts in → watches VSL → books call</li>
          <li>• <strong>Low Ticket Offer Funnel:</strong> Lead buys low ticket → upsell sequence</li>
          <li>• <strong>Workshop Funnel:</strong> Lead registers → attends workshop → books call</li>
          <li>• <strong>Direct Booking Funnel:</strong> Lead books straight from ad</li>
          <li>• <strong>Course Launch Funnel:</strong> Lead signs up → nurture → purchase</li>
          <li>• <strong>Consultation Funnel:</strong> Lead inquires → qualification → booking</li>
        </ul>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-green-900 dark:text-green-200">
          The concept is always the same:
        </p>
        <ol className="text-sm text-green-900 dark:text-green-200 space-y-2 list-decimal list-inside">
          <li>Identify the <strong>stages</strong> in your funnel</li>
          <li>Create a specialized <strong>AI Rep (prompt)</strong> for each stage</li>
          <li>Use workflows to <strong>assign the right Agent Number</strong> at each stage</li>
          <li>Each AI Rep focuses on <strong>one specific job</strong></li>
        </ol>
      </div>

      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm text-muted-foreground">
          Whether you're running webinars, VSLs, workshops, or direct booking campaigns - the multi-agent approach gives you better results because each AI Rep is laser-focused on one specific stage of your customer journey.
        </p>
      </div>

    </div>,

    // Step 2: Why Multiple AI Reps
    <div key="why-multiple" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Why Do We Need Multiple AI Reps?</CardTitle>
        <CardDescription>
          Understanding the multi-agent approach
        </CardDescription>
      </CardHeader>

      {/* Note about terminology */}
      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
        <p className="text-sm text-purple-900 dark:text-purple-200">
          <strong>Note:</strong> Agent = AI Rep. We use these terms interchangeably. Throughout this guide, when you see "agent" or "AI rep," they mean the same thing.
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm text-muted-foreground">
          We have <strong>multiple AI Reps deployed within your funnel</strong>. These AI Reps can be both Text and Voice, but the key insight is that you can have <strong>multiple Text AI Reps</strong> and <strong>multiple Voice AI Reps</strong> working together.
        </p>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          Picture an AI Rep as a <strong>manager who is managing the inbox</strong>. Let's use a webinar funnel as an example:
        </p>
        <ul className="text-sm text-blue-900 dark:text-blue-200 ml-4 space-y-2">
          <li>• <strong>Manager 1:</strong> Talks with leads who signed up BEFORE the webinar</li>
          <li>• <strong>Manager 2:</strong> Talks with leads AFTER the webinar</li>
          <li>• <strong>Manager 3:</strong> Talks with leads who BOOKED a call after the webinar</li>
        </ul>
      </div>

      {/* Disclaimer about webinar */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <strong>Important:</strong> "Webinar" is just an example. The same logic applies to ANY funnel you run - booking funnel, workshop funnel, course funnel, etc.
          </p>
        </div>
      </div>

    </div>,

    // Step 3: Why Specialized is Better
    <div key="specialized" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Why Specialized AI Reps Perform Better</CardTitle>
        <CardDescription>
          The power of focused agents
        </CardDescription>
      </CardHeader>

      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-red-900 dark:text-red-200">
          You <em>could</em> have one human manager handle all stages - before webinar, after webinar, and after booking. But here's the issue: <strong>Both humans AND AI reps perform better when they focus on ONE thing.</strong>
        </p>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-green-900 dark:text-green-200">
          If you had <strong>three different managers</strong>:
        </p>
        <ul className="text-sm text-green-900 dark:text-green-200 ml-4 space-y-1">
          <li>• One specifically trained for pre-webinar conversations</li>
          <li>• One specifically trained for post-webinar conversations</li>
          <li>• One specifically trained for post-booking conversations</li>
        </ul>
        <p className="text-sm text-green-900 dark:text-green-200 font-medium mt-3">
          You would get <strong>much better results</strong> because each manager is specifically trained for that stage!
        </p>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          If you only specify instructions for ONE specific stage to an AI Rep, it will perform significantly better than trying to handle everything. This is why we use multiple AI Reps with focused prompts.
        </p>
      </div>

    </div>,

    // Step 4: Prompt = Agent = AI Rep
    <div key="prompt-equals-agent" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">The Key Equation: Prompt = Agent = AI Rep</CardTitle>
        <CardDescription>
          Understanding the relationship
        </CardDescription>
      </CardHeader>

      <div className="bg-primary/10 border-2 border-primary/30 rounded-lg p-6 text-center">
        <h3 className="text-2xl font-bold text-primary mb-4">
          1 Prompt = 1 Agent = 1 AI Rep
        </h3>
        <p className="text-muted-foreground">
          This is the most important equation to understand
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          The prompt contains everything that defines your AI Rep:
        </p>
        <ul className="text-sm text-muted-foreground ml-4 space-y-1">
          <li>• <strong>Bot persona</strong> - who the bot is</li>
          <li>• <strong>Goals</strong> - what it's trying to achieve</li>
          <li>• <strong>Script</strong> - how it talks</li>
          <li>• <strong>Objection handling</strong> - how it responds to pushback</li>
          <li>• <strong>Solution details</strong> - your product/service info</li>
        </ul>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
        <p className="text-sm text-green-900 dark:text-green-200 mb-3">
          When you go to <strong>Prompt Management</strong>, you see:
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-2 bg-background/50 rounded">
            <Badge className="font-mono bg-primary/20 text-primary hover:bg-primary/30">1</Badge>
            <span className="text-sm text-green-900 dark:text-green-200">= Agent 1 = AI Rep 1</span>
          </div>
          <div className="flex items-center gap-3 p-2 bg-background/50 rounded">
            <Badge className="font-mono bg-primary/20 text-primary hover:bg-primary/30">2</Badge>
            <span className="text-sm text-green-900 dark:text-green-200">= Agent 2 = AI Rep 2</span>
          </div>
          <div className="flex items-center gap-3 p-2 bg-background/50 rounded">
            <Badge className="font-mono bg-primary/20 text-primary hover:bg-primary/30">3</Badge>
            <span className="text-sm text-green-900 dark:text-green-200">= Agent 3 = AI Rep 3</span>
          </div>
        </div>
      </div>

    </div>,

    // Step 5: How Routing Works
    <div key="routing" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">How Do We Route Leads to the Right AI Rep?</CardTitle>
        <CardDescription>
          The Agent Number system
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        This is where the <strong>numbers</strong> come in. We use a custom field called <strong>"Agent Number"</strong> to tell the system which AI Rep should handle each lead.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">Example: Lead Signs Up for Webinar</p>
        <ol className="text-sm text-blue-900 dark:text-blue-200 space-y-2 list-decimal list-inside">
          <li>Lead enters your funnel (signs up for webinar)</li>
          <li>This triggers a workflow in HighLevel</li>
          <li>In the workflow, you set <strong>Agent Number = 1</strong></li>
          <li>When the lead talks to the system, it sees "Agent Number 1"</li>
          <li>System assigns <strong>AI Rep 1</strong> (which uses <strong>Prompt 1</strong>)</li>
        </ol>
      </div>

      <GuideImage src={ghlEngagementAgentNumber} alt="HighLevel workflow showing Agent Number field being set to 1" />

      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm text-muted-foreground">
          <strong>In the screenshot above:</strong> Notice the "Set Agent Number" node in the workflow. The Agent Number field is set to <strong>1</strong>, which means leads going through this workflow will be handled by AI Rep 1 (Prompt 1).
        </p>
      </div>

      {/* Disclaimer about workflow */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <strong>Note:</strong> Don't worry about the specific workflow shown here - this is just an example. The workflow setup will be covered in a later step. Just focus on understanding the concept.
          </p>
        </div>
      </div>

    </div>,

    // Step 6: Changing AI Reps
    <div key="changing-agents" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Changing AI Reps at Different Stages</CardTitle>
        <CardDescription>
          How leads move between agents
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        Let's say the webinar has ended, and now you want all leads who attended to talk to <strong>AI Rep 2</strong> (which has different instructions for post-webinar follow-up).
      </p>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-green-900 dark:text-green-200 font-medium">How to change the AI Rep:</p>
        <ol className="text-sm text-green-900 dark:text-green-200 space-y-2 list-decimal list-inside">
          <li>You have a "Rollup" workflow that triggers after the webinar ends</li>
          <li>In this workflow, you set <strong>Agent Number = 2</strong></li>
          <li>This <strong>replaces</strong> the previous Agent Number on the contact</li>
          <li>Now when the lead talks to the system, it sees "Agent Number 2"</li>
          <li>System assigns <strong>AI Rep 2</strong> (which uses <strong>Prompt 2</strong>)</li>
        </ol>
      </div>

      <GuideImage src={ghlRollupAgentNumber} alt="HighLevel rollup workflow showing Agent Number field being set to 2" />

      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm text-muted-foreground">
          <strong>In the screenshot above:</strong> The same "Set Agent Number" node, but now setting it to <strong>2</strong>. After the webinar, leads are reassigned to AI Rep 2.
        </p>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          Let's say AI Rep 2 books an appointment with the lead. Now you want <strong>AI Rep 3</strong> to educate the lead before the call:
        </p>
        <ul className="text-sm text-blue-900 dark:text-blue-200 ml-4 space-y-1">
          <li>• Trigger: "Appointment Booked"</li>
          <li>• Action: Set Agent Number = 3</li>
          <li>• Result: Lead now talks to AI Rep 3 (Prompt 3)</li>
        </ul>
      </div>

    </div>,

    // Step 7: The Backend Flow
    <div key="backend" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">How It Works Behind the Scenes</CardTitle>
        <CardDescription>
          The n8n routing system
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        In n8n, we have a system that checks the Agent Number and routes the conversation to the correct AI agent. Here's how it looks:
      </p>

      <GuideImage src={n8nMultiAgentRouting} alt="n8n workflow showing multi-agent routing with Agent 1, 2, 3, and 4" />

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200">
          The system checks:
        </p>
        <ul className="text-sm text-blue-900 dark:text-blue-200 ml-4 space-y-1">
          <li>• <strong>Agent Number 1?</strong> → Route to Agent 1</li>
          <li>• <strong>Agent Number 2?</strong> → Route to Agent 2</li>
          <li>• <strong>Agent Number 3?</strong> → Route to Agent 3</li>
          <li>• <strong>Agent Number 4?</strong> → Route to Agent 4</li>
        </ul>
        <p className="text-sm text-blue-900 dark:text-blue-200 mt-2">
          Each agent has its own prompt that it pulls from your Prompt Management system.
        </p>
      </div>

    </div>,

    // Step 8: Important Notes
    <div key="important-notes" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Important Things to Remember</CardTitle>
        <CardDescription>
          Key points about the system
        </CardDescription>
      </CardHeader>

      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-purple-900 dark:text-purple-200">
          The prompt <strong>name</strong> you give (like "Webinar Nurturing Agent" or "Super Duper Agent") is only for your organization. The system doesn't care about the name - it only uses the <strong>number</strong>. Same with the description - it's just for you to remember what each prompt does.
        </p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          The prompt numbers (1, 2, 3, etc.) are <strong>fixed</strong>. You can change the <strong>content</strong> of each prompt, but not the number itself.
        </p>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-green-900 dark:text-green-200">
          Want to test a different approach without losing your current prompt?
        </p>
        <ol className="text-sm text-green-900 dark:text-green-200 space-y-2 list-decimal list-inside mt-2">
          <li>Create a new prompt (e.g., Prompt 5)</li>
          <li>Give it a name like "Testing Prompt"</li>
          <li>Write your experimental content</li>
          <li>In your workflow, change Agent Number from 1 to 5</li>
          <li>New leads will now use Prompt 5 instead of Prompt 1!</li>
        </ol>
        <p className="text-sm text-green-900 dark:text-green-200 font-medium mt-3">
          You can always switch back by changing the Agent Number in the workflow.
        </p>
      </div>

      {/* Disclaimer about webinar - third time */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <div className="flex gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300 font-medium">
            <strong>Third Reminder:</strong> This doesn't have to be webinars! Any funnel you run - booking funnel, workshop, course, consultation - can use multiple AI Reps with this exact same logic.
          </p>
        </div>
      </div>

    </div>,

  ]), []);

  const quizStep = useMemo(() => (
    <div key="quiz" className="space-y-4">
      {/* Quiz Progress - First */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Progress</span>
          <span>{answeredCount} of {QUIZ_QUESTIONS.length} answered</span>
        </div>
        <Progress value={quizProgress} className="h-2" />
      </div>

      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Confirmation Quiz</CardTitle>
        <CardDescription>
          Answer these questions to confirm your understanding
        </CardDescription>
      </CardHeader>

      {/* Quiz Questions - using memoized component */}
      <div className="space-y-4">
        {QUIZ_QUESTIONS.map((q, qIndex) => (
          <QuizQuestion
            key={q.id}
            questionId={q.id}
            questionIndex={qIndex}
            questionText={q.question}
            options={q.options}
            selectedAnswer={quizAnswers[q.id]}
            showResults={showQuizResults}
            onSelect={handleQuizSelect}
          />
        ))}
      </div>

      {/* Quiz Results - only show if not complete */}
      {showQuizResults && !isQuizComplete && (
        <div className="p-4 rounded-lg border-2 bg-red-500/10 border-red-500/30">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-6 w-6 text-red-500" />
              <div>
                <p className="font-semibold text-red-700 dark:text-red-400">Some answers are incorrect</p>
                <p className="text-sm text-red-600 dark:text-red-500">Please review the content and try again.</p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  ), [answeredCount, quizAnswers, showQuizResults, isQuizComplete, quizProgress, handleQuizSelect]);

  const completionStep = useMemo(() => (
    <div key="completion" className="space-y-4">
      {/* Success Banner */}
      <div className="p-4 rounded-lg bg-green-500/10 border-2 border-green-500/30">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
          <div>
            <p className="font-semibold text-green-700 dark:text-green-400">Multi-Agent Logic Complete</p>
            <p className="text-sm text-green-600 dark:text-green-500">All steps verified and saved</p>
          </div>
        </div>
      </div>

      {/* Configuration Summary */}
      <Card className="p-4">
        <h4 className="font-semibold mb-4">Your Configuration</h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Agent Concept:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Reviewed</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Routing Logic:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Reviewed</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">A/B Testing:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Reviewed</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">Confirmation Quiz:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Passed</span>
            </div>
          </div>
        </div>
      </Card>

    </div>
  ), []);

  const steps = useMemo(() => [...staticSteps, quizStep, completionStep], [staticSteps, quizStep, completionStep]);

  const totalSteps = steps.length;
  const progress = ((currentStep) / (totalSteps - 1)) * 100;

  // Determine if we're on the quiz step (second-to-last) or completion step (last)
  const isQuizStep = currentStep === totalSteps - 2;
  const isCompletionStep = currentStep === totalSteps - 1;

  // Auto-navigate to completion step when quiz is passed
  useEffect(() => {
    if (isQuizStep && isQuizComplete && showQuizResults) {
      const timer = setTimeout(() => {
        startTransition(() => {
          setCurrentStep(totalSteps - 1);
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isQuizStep, isQuizComplete, showQuizResults, totalSteps]);

  // Step-specific button labels for interactive confirmation
  const getStepButtonLabel = (step: number): string => {
    const labels = [
      "Let's Start",           // Step 0: Introduction
      "I Understand",          // Step 1: This Works for ANY Funnel
      "Got It",                // Step 2: The Core Concept
      "Makes Sense",           // Step 3: How Routing Works
      "I See It Now",          // Step 4: A/B Testing
      "Continue",              // Step 5: Summary
    ];
    return labels[step] || "Continue";
  };

  // Notify parent of navigation state changes - uses ref comparison to prevent loops
  useEffect(() => {
    const callback = onNavigationChangeRef.current;
    if (!callback) return;

    // Build a key representing the navigation state
    const navKey = `${currentStep}-${showQuizResults}-${answeredCount}-${isCompletionStep}-${isQuizStep}`;
    
    // Skip if navigation state hasn't meaningfully changed
    if (navKey === prevNavStateRef.current) return;
    prevNavStateRef.current = navKey;

    const showBack = currentStep > 0 && !isCompletionStep;

    let navState: QuizNavigationState;
    
    if (isCompletionStep) {
      navState = {
        showBack: true,
        backLabel: 'Restart',
        onBack: handleRestart,
        hideProgressBar: true,
        rightButton: {
          label: 'Complete',
          onClick: () => {},
          variant: 'success',
          icon: 'check',
        },
      };
    } else if (isQuizStep) {
      if (!showQuizResults) {
        navState = {
          showBack,
          backLabel: 'Back',
          onBack: handleBack,
          rightButton: {
            label: 'Check My Answers',
            onClick: handleQuizSubmit,
            disabled: answeredCount < QUIZ_QUESTIONS.length,
            variant: 'primary',
            icon: 'check',
          },
        };
      } else {
        navState = {
          showBack,
          backLabel: 'Back',
          onBack: handleBack,
          rightButton: {
            label: 'Try Again',
            onClick: handleReset,
            variant: 'outline',
            icon: 'check',
          },
        };
      }
    } else {
      navState = {
        showBack,
        backLabel: 'Back',
        onBack: handleBack,
        rightButton: {
          label: 'Continue',
          onClick: handleNext,
          variant: 'primary',
          icon: 'arrow-right',
        },
      };
    }

    callback(navState);
  }, [currentStep, showQuizResults, answeredCount, isQuizStep, isCompletionStep, handleBack, handleNext, handleReset, handleRestart, handleQuizSubmit]);

  return (
    <div className="flex flex-col h-full">
      {/* Progress indicator - hide on completion step */}
      {currentStep > 0 && !isCompletionStep && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            {Array.from({ length: totalSteps }).map((_, index) => (
              <div
                key={index}
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
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Step {currentStep + 1} of {totalSteps}</span>
          </div>
        </div>
      )}
      
      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {steps[currentStep]}
      </div>
    </div>
  );
}
