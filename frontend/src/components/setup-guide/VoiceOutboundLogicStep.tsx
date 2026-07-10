import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, ArrowLeft, ArrowRight, AlertCircle, Loader2, Phone, PhoneOutgoing } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
// Images
import ghlOutboundCallTrigger from '@/assets/setup-guide/ghl-outbound-call-trigger.png';

import { QuizNavigationState } from './quizNavigationState';

interface VoiceOutboundLogicStepProps {
  clientId: string;
  onNavigationChange?: (state: QuizNavigationState) => void;
}

// Lazy loading image component
const GuideImage = ({ src, alt }: { src: string; alt: string }) => {
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
};

const QUIZ_QUESTIONS = [
  {
    id: 'q1',
    question: 'How is outbound calling different from inbound?',
    options: [
      { label: 'There is no difference - they work the same way', correct: false },
      { label: 'For outbound, we call the user first and must be ready instantly when they pick up', correct: true },
      { label: 'Outbound calls don\'t use prompts', correct: false },
    ]
  },
  {
    id: 'q2', 
    question: 'What do you pass from HighLevel to trigger an outbound call?',
    options: [
      { label: 'Only the phone number', correct: false },
      { label: 'The user\'s phone number, name, and the agent number', correct: true },
      { label: 'A copy of the entire prompt', correct: false },
    ]
  },
  {
    id: 'q3',
    question: 'If you have a webinar nurturing agent (Prompt 2) and an after-webinar agent (Prompt 3), how do you switch between them?',
    options: [
      { label: 'Create two different Retell agents', correct: false },
      { label: 'Pass a different agent_number (2 or 3) from your HighLevel workflow', correct: true },
      { label: 'Manually edit the prompts before each call', correct: false },
    ]
  },
  {
    id: 'q4',
    question: 'How many Retell outbound agent templates do you need for multiple use cases (nurturing, follow-up, reactivation)?',
    options: [
      { label: 'One for each use case (3 templates)', correct: false },
      { label: 'Just one template - the prompts change dynamically based on agent number', correct: true },
      { label: 'You need to create a new agent for every call', correct: false },
    ]
  },
];

export default function VoiceOutboundLogicStep({ clientId, onNavigationChange }: VoiceOutboundLogicStepProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [showQuizResults, setShowQuizResults] = useState(false);
  const [isQuizComplete, setIsQuizComplete] = useState(false);
  
  // Load progress from localStorage
  useEffect(() => {
    const savedStep = localStorage.getItem(`voice_outbound_logic_step_${clientId}`);
    const savedAnswers = localStorage.getItem(`voice_outbound_logic_answers_${clientId}`);
    const savedQuizComplete = localStorage.getItem(`voice_outbound_logic_quiz_${clientId}`);
    
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
  
  // Save progress to localStorage
  useEffect(() => {
    localStorage.setItem(`voice_outbound_logic_step_${clientId}`, currentStep.toString());
  }, [currentStep, clientId]);
  
  useEffect(() => {
    localStorage.setItem(`voice_outbound_logic_answers_${clientId}`, JSON.stringify(quizAnswers));
  }, [quizAnswers, clientId]);
  
  const handleQuizSubmit = () => {
    const allCorrect = QUIZ_QUESTIONS.every(q => {
      const selectedOption = q.options.find(o => o.label === quizAnswers[q.id]);
      return selectedOption?.correct;
    });
    
    setShowQuizResults(true);
    
    if (allCorrect) {
      setIsQuizComplete(true);
      localStorage.setItem(`voice_outbound_logic_quiz_${clientId}`, 'completed');
    }
  };
  
  const handleNext = useCallback(() => {
    setCurrentStep(prev => prev + 1);
  }, []);
  
  const handleBack = useCallback(() => {
    setCurrentStep(prev => Math.max(0, prev - 1));
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
    localStorage.removeItem(`voice_outbound_logic_step_${clientId}`);
    localStorage.removeItem(`voice_outbound_logic_answers_${clientId}`);
    localStorage.removeItem(`voice_outbound_logic_quiz_${clientId}`);
  }, [clientId]);

  // Calculate quiz progress
  const answeredCount = Object.keys(quizAnswers).length;
  const quizProgress = (answeredCount / QUIZ_QUESTIONS.length) * 100;
  
  // Content steps
  const steps = [
    // Step 0: Introduction
    <div key="intro" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Outbound Voice Agent Logic</CardTitle>
        <CardDescription>
          Understanding how outbound calls work with your Voice AI Rep
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        Now that you understand inbound calls, let's learn how <strong>outbound calls</strong> work. This is when YOUR system calls the lead, not the other way around.
      </p>

      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
        <p className="text-sm text-muted-foreground font-medium">What you'll learn:</p>
        <ul className="text-sm text-muted-foreground ml-4 space-y-2">
          <li>• How outbound calling differs from inbound</li>
          <li>• How to trigger an outbound call</li>
          <li>• How agent numbers route to different prompts</li>
          <li>• How to use one template for multiple use cases</li>
        </ul>
      </div>

      <div className="bg-primary/10 border-2 border-primary/30 rounded-lg p-6 text-center">
        <h3 className="text-2xl font-bold text-primary mb-4">
          Important: Webinar = Just an Example
        </h3>
        <p className="text-muted-foreground text-sm">
          We'll use webinar follow-up as an example, but outbound calling works for <strong>ANY</strong> use case — database reactivation, cold outbound, appointment reminders, etc.
        </p>
      </div>

      {/* Yellow note - matching app style */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-sm">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
          <p className="text-yellow-700 dark:text-yellow-300">
            <strong>Note:</strong> If you don't understand this after reading, email us at support@buildingflowdigital.com saying: "I still do not understand outbound voice logic. Can you please explain?" - and we will help you!
          </p>
        </div>
      </div>

    </div>,

    // Step 1: Outbound vs Inbound
    <div key="vs-inbound" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Outbound vs Inbound: The Key Difference</CardTitle>
        <CardDescription>
          Why outbound works differently
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        Let's think about the difference between inbound and outbound calls.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">Inbound (what you learned):</p>
        <ol className="text-sm text-blue-900 dark:text-blue-200 space-y-1 list-decimal list-inside">
          <li>User calls your number</li>
          <li>System runs workflow to prepare</li>
          <li>Agent answers with information ready</li>
        </ol>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-green-900 dark:text-green-200 font-medium">Outbound (what you're learning now):</p>
        <ol className="text-sm text-green-900 dark:text-green-200 space-y-1 list-decimal list-inside">
          <li>YOUR system calls the user</li>
          <li>The phone is dialing...</li>
          <li>User picks up → Agent must start talking IMMEDIATELY!</li>
        </ol>
      </div>

      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
        <p className="text-sm text-purple-900 dark:text-purple-200">
          <strong>The Key Difference:</strong> With outbound calls, you can't run a workflow AFTER the user picks up. When they answer, you need to start talking right away. So we prepare everything BEFORE making the call!
        </p>
      </div>

    </div>,

    // Step 2: How Outbound Works
    <div key="how-it-works" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">How Outbound Calling Works</CardTitle>
        <CardDescription>
          The API call that triggers a phone call
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        Since Retell is our phone system, we need to tell Retell: "Hey, please call this number!" We do this with an <strong>API call</strong>.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">What is an API call? (Simple version)</p>
        <p className="text-sm text-blue-900 dark:text-blue-200">
          An API call is just a message sent to Retell saying: "Please make a phone call to [phone number] using [this agent] with [these prompts]."
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <p className="text-sm text-muted-foreground font-medium">What we need to tell Retell:</p>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li><strong>What number to call</strong> (the user's phone number)</li>
          <li><strong>What to call them</strong> (the user's name, so we can say "Hi John!")</li>
          <li><strong>What prompt to use</strong> (the instructions for this call)</li>
        </ol>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
        <p className="text-sm text-green-900 dark:text-green-200">
          <strong>This is what the platform does for you:</strong> it gathers all this information and makes the API call to Retell. That happens BEFORE the call is made, not during.
        </p>
      </div>

    </div>,

    // Step 3: The Workflow Trigger
    <div key="workflow-trigger" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Triggering the Outbound Call</CardTitle>
        <CardDescription>
          How HighLevel tells the platform to make a call
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        Let's use a webinar as an example. Someone signs up for your webinar, and you want to give them a call to nurture them.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">The Flow:</p>
        <ol className="text-sm text-blue-900 dark:text-blue-200 space-y-2 list-decimal list-inside">
          <li>User signs up for webinar (HighLevel workflow triggers)</li>
          <li>HighLevel calls the platform's outbound webhook with this data:
            <ul className="ml-6 mt-1 space-y-1">
              <li>• <strong>Phone number:</strong> User's phone</li>
              <li>• <strong>Name:</strong> User's first name</li>
              <li>• <strong>Agent number:</strong> Which prompt to use (e.g., "2")</li>
            </ul>
          </li>
          <li>The platform gets the prompts from Supabase</li>
          <li>The platform makes the API call to Retell</li>
          <li>Retell calls the user with everything ready!</li>
        </ol>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            <strong>Key Point:</strong> Notice how HighLevel passes an "agent number" — this tells the system which prompt to use. We'll explain this next!
          </p>
        </div>
      </div>

      <GuideImage src={ghlOutboundCallTrigger} alt="HighLevel workflow showing the outbound call trigger with phone number, name, and agent number parameters" />

    </div>,

    // Step 4: Agent Numbers for Outbound
    <div key="agent-numbers" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Outbound Agent Numbers (Prompts 2, 3, 4)</CardTitle>
        <CardDescription>
          Different prompts for different outbound use cases
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        While the inbound agent uses Prompt 1, outbound agents use <strong>Prompts 2, 3, and 4</strong>. Each number represents a different use case.
      </p>

      <div className="space-y-3">
        {/* Prompt 2 */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Badge className="bg-blue-600 text-white font-mono">Prompt-2</Badge>
            <h4 className="font-semibold text-blue-900 dark:text-blue-100">Outbound Agent 2</h4>
          </div>
          <p className="text-sm text-blue-900/80 dark:text-blue-200/80">
            Example: <strong>Webinar Nurturing Agent</strong> — Calls people who just signed up
          </p>
        </div>

        {/* Prompt 3 */}
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Badge className="bg-green-600 text-white font-mono">Prompt-3</Badge>
            <h4 className="font-semibold text-green-900 dark:text-green-100">Outbound Agent 3</h4>
          </div>
          <p className="text-sm text-green-900/80 dark:text-green-200/80">
            Example: <strong>After Webinar Agent</strong> — Calls people after the webinar ended
          </p>
        </div>

        {/* Prompt 4 */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Badge className="bg-amber-600 text-white font-mono">Prompt-4</Badge>
            <h4 className="font-semibold text-amber-900 dark:text-amber-100">Outbound Agent 4</h4>
          </div>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
            Example: <strong>Database Reactivation Agent</strong> — Calls old leads to re-engage them
          </p>
        </div>
      </div>

      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm text-muted-foreground">
          <strong>Remember:</strong> The names are just examples. You can use Prompt-2 for anything you want — it's the number that matters, not the name!
        </p>
      </div>

    </div>,

    // Step 5: The Routing System
    <div key="routing" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">How the Routing Works</CardTitle>
        <CardDescription>
          One workflow, multiple agents
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        Here's the powerful part: You use the <strong>same outbound webhook</strong> for all outbound calls. The <strong>agent_number</strong> tells it which prompt to use!
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">Example Scenario:</p>
        <div className="space-y-2 text-sm text-blue-900 dark:text-blue-200">
          <p>• <strong>Webinar signup workflow:</strong> Triggers the platform with agent_number = 2</p>
          <p>• <strong>After webinar workflow:</strong> Triggers the platform with agent_number = 3</p>
          <p>• <strong>Database reactivation workflow:</strong> Triggers the platform with agent_number = 4</p>
        </div>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-green-900 dark:text-green-200 font-medium">What the platform does:</p>
        <ol className="text-sm text-green-900 dark:text-green-200 space-y-1 list-decimal list-inside">
          <li>Receives the agent_number from HighLevel</li>
          <li>Gets ALL prompts from Supabase</li>
          <li>Routes to the correct prompt based on the agent_number</li>
          <li>Makes the API call to Retell with that prompt</li>
        </ol>
      </div>

      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
        <p className="text-sm text-purple-900 dark:text-purple-200">
          <strong>The Beauty:</strong> You only have ONE Retell outbound agent template, but it can behave like many different agents! Just change the prompt in Prompt Management and pass the right agent_number.
        </p>
      </div>

    </div>,

    // Step 6: Practical Example
    <div key="practical" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Practical Example: Webinar Funnel</CardTitle>
        <CardDescription>
          Putting it all together
        </CardDescription>
      </CardHeader>

      <p className="text-sm text-muted-foreground">
        Let's see how this works in a real webinar funnel scenario.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">Scenario: User signs up for webinar</p>
        <ol className="text-sm text-blue-900 dark:text-blue-200 space-y-1 list-decimal list-inside">
          <li>HighLevel triggers the "Make Outbound Call" webhook</li>
          <li>Passes: phone="+1234567890", name="John", agent_number=2</li>
          <li>The platform fetches Prompt-2 (Webinar Nurturing Agent) from Supabase</li>
          <li>Retell calls John with the nurturing script</li>
        </ol>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-green-900 dark:text-green-200 font-medium">Later: Webinar ends, we want to follow up</p>
        <ol className="text-sm text-green-900 dark:text-green-200 space-y-1 list-decimal list-inside">
          <li>HighLevel triggers the SAME webhook</li>
          <li>This time passes: phone="+1234567890", name="John", agent_number=3</li>
          <li>The platform fetches Prompt-3 (After Webinar Agent) from Supabase</li>
          <li>Retell calls John with the after-webinar script</li>
        </ol>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          <strong>Same workflow, same Retell template, different prompts!</strong> This is the power of the agent number routing system.
        </p>
      </div>

    </div>,

    // Step 7: Key Takeaways
    <div key="takeaways" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Key Takeaways</CardTitle>
        <CardDescription>
          What to remember about outbound voice logic
        </CardDescription>
      </CardHeader>

      <div className="space-y-3">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-sm text-green-900 dark:text-green-200">
            <strong>✓ One template, many agents:</strong> Your single Retell outbound template can act as different agents based on the prompt.
          </p>
        </div>

        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-sm text-green-900 dark:text-green-200">
            <strong>✓ Agent number controls the prompt:</strong> Pass agent_number=2 for Prompt-2, agent_number=3 for Prompt-3, etc.
          </p>
        </div>

        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-sm text-green-900 dark:text-green-200">
            <strong>✓ Names don't matter:</strong> Call your prompts whatever you want — only the number matters to the system.
          </p>
        </div>

        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-sm text-green-900 dark:text-green-200">
            <strong>✓ Update without touching Retell:</strong> Change prompts in Prompt Management, and the next call uses the new content.
          </p>
        </div>
      </div>

      {/* Third reminder about webinar */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <div className="flex gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300 font-medium">
            <strong>Reminder:</strong> This doesn't have to be webinars! Cold outbound, database reactivation, appointment reminders, consultation follow-ups — any outbound call use case works with this exact same logic.
          </p>
        </div>
      </div>

    </div>,

    // Step 8: Quiz
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
          Answer these questions to confirm your understanding of outbound voice logic
        </CardDescription>
      </CardHeader>

      {/* Quiz Questions */}
      <div className="space-y-4">
        {QUIZ_QUESTIONS.map((q, qIndex) => (
          <Card key={q.id} className="p-4">
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono shrink-0">Q{qIndex + 1}</Badge>
                <p className="font-medium">{q.question}</p>
              </div>
              <div className="space-y-2 ml-8">
                {q.options.map((option) => {
                  const isSelected = quizAnswers[q.id] === option.label;
                  const showResult = showQuizResults;
                  const isCorrect = option.correct;
                  
                  return (
                    <button
                      key={option.label}
                      onClick={() => {
                        if (!showQuizResults) {
                          setQuizAnswers(prev => ({ ...prev, [q.id]: option.label }));
                        }
                      }}
                      disabled={showQuizResults}
                      className={cn(
                        "w-full text-left p-3 rounded-lg border-2 transition-all",
                        !showResult && isSelected && "border-primary bg-primary/10",
                        !showResult && !isSelected && "border-border hover:border-primary/50 hover:bg-primary/5",
                        showResult && isSelected && isCorrect && "border-green-500 bg-green-500/10",
                        showResult && isSelected && !isCorrect && "border-red-500 bg-red-500/10",
                        showResult && !isSelected && isCorrect && "border-green-500/50 bg-green-500/5",
                        showResult && "cursor-default"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {showResult && isCorrect && (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        )}
                        {showResult && isSelected && !isCorrect && (
                          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                        )}
                        <span className="text-sm">{option.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
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

    </div>,

    // Completion Summary Step
    <div key="completion" className="space-y-4">
      {/* Success Banner */}
      <div className="p-4 rounded-lg bg-green-500/10 border-2 border-green-500/30">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
          <div>
            <p className="font-semibold text-green-700 dark:text-green-400">Outbound Logic Complete</p>
            <p className="text-sm text-green-600 dark:text-green-500">All steps verified and saved</p>
          </div>
        </div>
      </div>

      {/* Configuration Summary */}
      <Card className="p-4">
        <h4 className="font-semibold mb-4">Your Configuration</h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Outbound Flow:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Reviewed</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Trigger Logic:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Reviewed</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Agent Numbers:</span>
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
    </div>,
  ];

  const totalSteps = steps.length;
  const progress = ((currentStep) / (totalSteps - 1)) * 100;

  // Determine if we're on the quiz step (second-to-last) or completion step (last)
  const isQuizStep = currentStep === totalSteps - 2;
  const isCompletionStep = currentStep === totalSteps - 1;

  // User must manually click Done button to mark step as complete
  // No auto-navigation - user controls progression

  // Step-specific button labels for interactive confirmation
  const getStepButtonLabel = (step: number): string => {
    const labels = [
      "Let's Start",           // Step 0: Introduction
      "I See the Difference",  // Step 1: Outbound vs Inbound
      "Got It",                // Step 2: Triggering Outbound
      "Makes Sense",           // Step 3: Agent Numbers
      "I Understand",          // Step 4: One Template Multiple Use Cases
      "Continue",              // Step 5: Summary
    ];
    return labels[step] || "Continue";
  };

  // Notify parent of navigation state changes
  useEffect(() => {
    if (!onNavigationChange) return;

    const getNavigationState = (): QuizNavigationState => {
      const showBack = currentStep > 0 && !isCompletionStep;

      if (isCompletionStep) {
        return {
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
          return {
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
          // After quiz results shown, allow user to continue
          return {
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
      } else {
        return {
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
    };

    onNavigationChange(getNavigationState());
  }, [currentStep, showQuizResults, isQuizComplete, answeredCount, onNavigationChange, isQuizStep, isCompletionStep, handleBack, handleNext, handleReset, handleRestart]);

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
