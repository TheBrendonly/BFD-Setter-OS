import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, ArrowLeft, ArrowRight, AlertCircle, Loader2, Phone, PhoneCall, Database, Webhook } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
// Images
import retellInboundWebhookCheckbox from '@/assets/setup-guide/retell-inbound-webhook-checkbox.png';
import retellPromptVariablesCircled from '@/assets/setup-guide/retell-prompt-variables-circled.png';
import n8nFindContactWorkflow from '@/assets/setup-guide/n8n-find-contact-workflow.png';
import n8nGetPromptsWorkflow from '@/assets/setup-guide/n8n-get-prompts-workflow.png';
import retellBookingVariable from '@/assets/setup-guide/retell-booking-variable.png';
import retellBookingVariableCleared from '@/assets/setup-guide/retell-booking-variable-cleared.png';

export interface QuizNavigationState {
  showBack: boolean;
  backLabel: string;
  onBack: () => void;
  hideProgressBar?: boolean;
  rightButton: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant: 'primary' | 'success' | 'outline';
    icon: 'check' | 'arrow-right';
  };
}

interface VoiceInboundLogicStepProps {
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
    question: 'What happens BEFORE the Retell inbound agent answers a call?',
    options: [
      { label: 'The agent immediately picks up and starts talking', correct: false },
      { label: 'The system runs an n8n workflow to find the contact and get prompts', correct: true },
      { label: 'The caller is put on hold while prompts are manually loaded', correct: false },
    ]
  },
  {
    id: 'q2', 
    question: 'Why do we search for the contact in the CRM before the agent answers?',
    options: [
      { label: 'To verify if the caller has paid their bills', correct: false },
      { label: 'So the agent has information about the caller and can personalize the conversation', correct: true },
      { label: 'Because the phone system requires it for security', correct: false },
    ]
  },
  {
    id: 'q3',
    question: 'Which prompts are used by the Inbound Voice Agent?',
    options: [
      { label: 'Prompt 0 (Bot Persona), Prompt 1 (System Prompt), Prompt 5 (Booking Functions)', correct: true },
      { label: 'Prompt 1, Prompt 2, and Prompt 3', correct: false },
      { label: 'Only Prompt 1', correct: false },
    ]
  },
  {
    id: 'q4',
    question: 'If you want to disable booking functions for your inbound agent, what should you do?',
    options: [
      { label: 'Delete the Prompt 5 content in Prompt Management', correct: false },
      { label: 'Remove the {{bookingFunction}} variable from Retell and delete the functions', correct: true },
      { label: 'Call support to disable it for you', correct: false },
    ]
  },
];

export default function VoiceInboundLogicStep({ clientId, onNavigationChange }: VoiceInboundLogicStepProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [showQuizResults, setShowQuizResults] = useState(false);
  const [isQuizComplete, setIsQuizComplete] = useState(false);
  
  // Load progress from localStorage
  useEffect(() => {
    const savedStep = localStorage.getItem(`voice_inbound_logic_step_${clientId}`);
    const savedAnswers = localStorage.getItem(`voice_inbound_logic_answers_${clientId}`);
    const savedQuizComplete = localStorage.getItem(`voice_inbound_logic_quiz_${clientId}`);
    
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
    localStorage.setItem(`voice_inbound_logic_step_${clientId}`, currentStep.toString());
  }, [currentStep, clientId]);
  
  useEffect(() => {
    localStorage.setItem(`voice_inbound_logic_answers_${clientId}`, JSON.stringify(quizAnswers));
  }, [quizAnswers, clientId]);
  
  const handleQuizSubmit = () => {
    const allCorrect = QUIZ_QUESTIONS.every(q => {
      const selectedOption = q.options.find(o => o.label === quizAnswers[q.id]);
      return selectedOption?.correct;
    });
    
    setShowQuizResults(true);
    
    if (allCorrect) {
      setIsQuizComplete(true);
      localStorage.setItem(`voice_inbound_logic_quiz_${clientId}`, 'completed');
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
    localStorage.removeItem(`voice_inbound_logic_step_${clientId}`);
    localStorage.removeItem(`voice_inbound_logic_answers_${clientId}`);
    localStorage.removeItem(`voice_inbound_logic_quiz_${clientId}`);
  }, [clientId]);

  // Calculate quiz progress
  const answeredCount = Object.keys(quizAnswers).length;
  const quizProgress = (answeredCount / QUIZ_QUESTIONS.length) * 100;

  // Content steps
  const steps = [
    // Step 0: Introduction
    <div key="intro" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Inbound Voice Agent Logic</CardTitle>
        <CardDescription>
          Understanding how inbound calls work with your Voice AI Rep
        </CardDescription>
      </CardHeader>

      <p className="text-sm">
        This step explains how your <strong>Inbound Voice AI Rep</strong> works when someone calls your phone number. Understanding this flow is essential for setting up your voice prompts correctly.
      </p>

      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
        <p className="text-sm font-medium">What you'll learn:</p>
        <ol className="text-sm ml-4 space-y-2 list-decimal list-inside">
          <li>What happens when someone calls your number</li>
          <li>Why we run a workflow BEFORE the agent answers</li>
          <li>How prompts are dynamically loaded from Supabase</li>
          <li>How the prompt numbering system works for voice agents</li>
        </ol>
      </div>

      <div className="bg-primary/10 border-2 border-primary/30 rounded-lg p-6 text-center">
        <h3 className="text-2xl font-bold text-primary mb-4">
          Important: Webinar = Just an Example
        </h3>
        <p className="text-sm">
          Throughout this guide, we'll use a <strong>webinar funnel</strong> as our example. But the inbound voice agent logic works for <strong>ANY</strong> use case — reception calls, HVAC booking, consultation calls, etc.
        </p>
      </div>

      {/* Yellow note - matching app style */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-sm">
        <p className="text-yellow-700 dark:text-yellow-300">
          <strong>Note:</strong> If you don't understand this after reading, please send us a message on Skool or WhatsApp saying: "I still do not understand inbound voice logic. Can you please explain?" - and we will help you!
        </p>
      </div>

    </div>,

    // Step 1: Basic Flow
    <div key="basic-flow" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">How Inbound Calls Work</CardTitle>
        <CardDescription>
          The basic flow when someone calls your number
        </CardDescription>
      </CardHeader>

      <p className="text-sm">
        Let's break down what happens when someone calls your phone number that's connected to Retell. This is explained simply so anyone can understand.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">The Simple Version:</p>
        <ol className="text-sm text-blue-900 dark:text-blue-200 space-y-3 list-decimal list-inside">
          <li className="flex items-start gap-2">
            <Badge className="bg-blue-600 text-white font-mono shrink-0 mt-0.5">1</Badge>
            <span>Someone <strong>calls your phone number</strong> (connected to Retell)</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge className="bg-blue-600 text-white font-mono shrink-0 mt-0.5">2</Badge>
            <span>The system <strong>runs an n8n workflow</strong> (your inbound agent doesn't answer yet!)</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge className="bg-blue-600 text-white font-mono shrink-0 mt-0.5">3</Badge>
            <span>The workflow finds the caller's info and gets the prompts</span>
          </li>
          <li className="flex items-start gap-2">
            <Badge className="bg-blue-600 text-white font-mono shrink-0 mt-0.5">4</Badge>
            <span>The <strong>agent finally answers</strong> with all the information ready</span>
          </li>
        </ol>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
        <p className="text-sm text-green-900 dark:text-green-200">
          <strong>Key Insight:</strong> The Retell agent doesn't answer immediately! There's an important step that happens BEFORE the agent picks up the phone. This is what makes your agent smart and personalized.
        </p>
      </div>

    </div>,

    // Step 2: The Inbound Webhook
    <div key="inbound-webhook" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">The Inbound Webhook</CardTitle>
        <CardDescription>
          The most important step between the call and the agent answering
        </CardDescription>
      </CardHeader>

      <p className="text-sm">
        In the previous phase, you set up the <strong>Inbound Webhook</strong> on your Retell phone number. Let's understand what it actually does.
      </p>

      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-purple-900 dark:text-purple-200 font-medium">What is the Inbound Webhook?</p>
        <p className="text-sm text-purple-900 dark:text-purple-200">
          When you enable "Get Inbound Webhook" on your phone number and paste an n8n workflow webhook URL, you're telling the system:
        </p>
        <p className="text-sm text-purple-900 dark:text-purple-200 font-bold italic">
          "Before the agent answers any call, first run this n8n workflow!"
        </p>
      </div>

      <GuideImage src={retellInboundWebhookCheckbox} alt="Retell phone number settings showing the inbound webhook checkbox and URL field" />

      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium">Think of it like this:</p>
        <ol className="text-sm space-y-2 list-decimal list-inside">
          <li>User makes a phone call</li>
          <li>The call is received by your Retell phone number</li>
          <li><strong>BEFORE the agent answers</strong> → The system runs your n8n workflow</li>
          <li>The n8n workflow does its job (we'll explain next)</li>
          <li>The agent receives all the information from the workflow</li>
          <li>NOW the agent answers the phone with everything ready!</li>
        </ol>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          <strong>Already set up:</strong> You configured this in the previous phase (Get Lead Details workflow). Go back there if you haven't done it yet.
        </p>
      </div>

    </div>,

    // Step 3: Reason 1 - Finding the Contact
    <div key="reason-1-contact" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Reason #1: Finding the Contact</CardTitle>
        <CardDescription>
          Why we search for the caller in your CRM
        </CardDescription>
      </CardHeader>

      <p className="text-sm">
        So why do we run a workflow before the agent answers? There are <strong>two main reasons</strong>. Let's start with the first one.
      </p>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
        <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">What do we know about the caller?</p>
        <p className="text-sm text-blue-900 dark:text-blue-200">
          When someone calls, what information do we have? Think about it...
        </p>
        <p className="text-sm text-blue-900 dark:text-blue-200">
          We <strong>don't know</strong> their name. We <strong>don't know</strong> their email. We <strong>don't know</strong> if they've talked to us before.
        </p>
        <p className="text-sm text-blue-900 dark:text-blue-200 font-bold">
          But we DO have their <strong>phone number</strong> — because they're calling from it!
        </p>
      </div>

      <p className="text-sm font-medium">The Workflow Searches for the Contact:</p>
      <ol className="text-sm space-y-2 list-decimal list-inside">
        <li>The workflow receives the caller's phone number</li>
        <li>It searches your CRM (HighLevel) for a contact with that phone number</li>
        <li>If found, it retrieves all their details: name, email, previous conversations, etc.</li>
        <li>This information is passed back to the Retell agent</li>
      </ol>

      <GuideImage src={n8nFindContactWorkflow} alt="n8n workflow showing the Find Contact in GHL node" />

      <div className="bg-primary/10 border-2 border-primary/30 rounded-lg p-4">
        <p className="text-sm">
          <strong>The Result:</strong> Instead of the agent saying "Hello, how can I help you?", it can say <strong>"Hello John! Thank you for calling back!"</strong> — because it now knows who's calling and has all their history.
        </p>
      </div>

    </div>,

    // Step 4: Reason 2 - Getting Prompts
    <div key="reason-2-prompts" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Reason #2: Dynamic Prompts</CardTitle>
        <CardDescription>
          How prompts are loaded from your database
        </CardDescription>
      </CardHeader>

      <p className="text-sm">
        The second reason we run the workflow is to get the <strong>prompts from Supabase</strong>. This is what makes your agent dynamic and easy to update!
      </p>

      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium">How Prompts Work:</p>
        <p className="text-sm">
          When you update your prompt in <strong>Prompt Management</strong>, it automatically saves to Supabase (your database). So when someone calls:
        </p>
        <ol className="text-sm space-y-2 list-decimal list-inside mt-2">
          <li>The workflow requests the prompts from Supabase</li>
          <li>Supabase returns the latest prompt content</li>
          <li>The workflow passes these prompts to the Retell agent</li>
          <li>The agent uses the prompts you configured</li>
        </ol>
      </div>

      <GuideImage src={n8nGetPromptsWorkflow} alt="n8n workflow showing the Get Prompts node" />

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
        <p className="text-sm text-green-900 dark:text-green-200">
          <strong>Why is this powerful?</strong> You can update your agent's behavior instantly! Just edit the prompt in Prompt Management, and the next call will use the new instructions. No need to touch Retell directly.
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm">
          <strong>Summary:</strong> The workflow does two things before the agent answers: (1) finds the caller's information, and (2) gets the latest prompts. Then it passes everything to the agent through the webhook response.
        </p>
      </div>

    </div>,

    // Step 5: Inbound Prompt Structure
    <div key="prompt-structure" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Inbound Agent Prompt Structure</CardTitle>
        <CardDescription>
          The three parts of your inbound agent's prompt
        </CardDescription>
      </CardHeader>

      <p className="text-sm">
        Your Retell inbound agent doesn't run from a single prompt: it uses <strong>three sections</strong> that combine into the complete prompt, which makes each part easier to manage.
      </p>

      <div className="space-y-3">
        {/* Prompt 0 */}
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Badge className="bg-purple-600 text-white font-mono">Prompt-0</Badge>
            <h4 className="font-semibold text-purple-900 dark:text-purple-100">Bot Persona</h4>
          </div>
          <p className="text-sm text-purple-900/80 dark:text-purple-200/80">
            Defines your agent's personality and character. Maps to <code className="bg-purple-900/10 px-1.5 py-0.5 rounded">{"{{botPersona}}"}</code> in Retell.
          </p>
        </div>

        {/* Prompt 1 */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Badge className="bg-blue-600 text-white font-mono">Prompt-1</Badge>
            <h4 className="font-semibold text-blue-900 dark:text-blue-100">Inbound Agent (System Prompt)</h4>
          </div>
          <p className="text-sm text-blue-900/80 dark:text-blue-200/80">
            The main instructions for your inbound agent — how to behave, what to say, etc. Maps to <code className="bg-blue-900/10 px-1.5 py-0.5 rounded">{"{{retellPrompt}}"}</code> in Retell.
          </p>
        </div>

        {/* Prompt 5 */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <Badge className="bg-amber-600 text-white font-mono">Prompt-5</Badge>
            <h4 className="font-semibold text-amber-900 dark:text-amber-100">Booking Functions</h4>
          </div>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
            Instructions for how to handle bookings (check slots, book appointments, etc.). Maps to <code className="bg-amber-900/10 px-1.5 py-0.5 rounded">{"{{bookingFunction}}"}</code> in Retell.
          </p>
        </div>
      </div>

      <GuideImage src={retellPromptVariablesCircled} alt="Retell agent prompt showing botPersona, retellPrompt, and bookingFunction variables circled" />

      <div className="bg-muted/50 rounded-lg p-4">
        <p className="text-sm">
          <strong>These numbers are fixed:</strong> The inbound agent always uses Prompt 0, 1, and 5. The workflow fetches exactly these prompts and passes them to the agent.
        </p>
      </div>

    </div>,

    // Step 6: Booking Functions Warning
    <div key="booking-warning" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Important: Booking Functions (Prompt 5)</CardTitle>
        <CardDescription>
          Be careful when modifying booking instructions
        </CardDescription>
      </CardHeader>

      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <p className="text-sm text-red-700 dark:text-red-300 font-bold">
          Do NOT change Prompt 5 unless you know what you're doing!
        </p>
        <p className="text-sm text-red-700 dark:text-red-300 mt-2">
          Prompt 5 contains specific instructions for how the agent runs booking functions. If you modify it incorrectly, the booking functions might stop working.
        </p>
      </div>

      <p className="text-sm font-medium">When CAN you modify Prompt 5?</p>
      <ol className="text-sm space-y-2 list-decimal list-inside">
        <li>If you want to add extra questions before booking (like asking for the service type)</li>
        <li>If you want to skip asking for certain details (like the name)</li>
        <li>Use the existing prompt as a template and be very careful with the logic</li>
      </ol>

      <p className="text-sm font-medium mt-4">Don't need booking for this agent?</p>
      <p className="text-sm">
        If your inbound agent doesn't need to book appointments, here's how to disable it:
      </p>
      <ol className="text-sm space-y-2 list-decimal list-inside mt-2">
        <li>Go to your Retell inbound agent</li>
        <li>Delete the <code className="bg-muted px-1.5 py-0.5 rounded">{"{{bookingFunction}}"}</code> variable from the prompt</li>
        <li>Delete all the booking functions from the Functions tab</li>
        <li>Save and publish</li>
      </ol>
      <p className="text-sm mt-2">
        The workflow will still fetch Prompt 5, but since there's no variable to receive it, it won't be used.
      </p>

      <GuideImage src={retellBookingVariable} alt="Retell agent showing the bookingFunction variable in the prompt" />
      
      <p className="text-sm">
        <strong>To disable booking:</strong> Simply clear the <code className="bg-muted px-1.5 py-0.5 rounded">{"{{bookingFunction}}"}</code> variable from your Retell prompt:
      </p>
      
      <GuideImage src={retellBookingVariableCleared} alt="Retell agent with the bookingFunction variable removed" />

    </div>,

    // Step 7: Naming Flexibility
    <div key="naming" className="space-y-4">
      <CardHeader className="p-0 pb-2">
        <CardTitle className="text-lg">Prompt Names vs Numbers</CardTitle>
        <CardDescription>
          The name doesn't matter — only the number does
        </CardDescription>
      </CardHeader>

      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
        <p className="text-sm text-purple-900 dark:text-purple-200">
          The <strong>name</strong> you give your prompt (like "Bot Persona" or "Webinar Inbound Agent") is only for your organization. The system doesn't care about the name — it only uses the <strong>number</strong>.
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium">Examples:</p>
        <ol className="text-sm space-y-2 list-decimal list-inside">
          <li>You can call Prompt-0 "Jonathan's Persona" — it still works as the bot persona</li>
          <li>You can call Prompt-1 "Receptionist for HVAC" — it still works as the inbound agent prompt</li>
          <li>You can call Prompt-5 "Custom Booking Instructions" — it still works for booking</li>
        </ol>
      </div>

      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
        <p className="text-sm text-green-900 dark:text-green-200">
          <strong>The beauty of this system:</strong> You use the same Retell template (the inbound agent you imported) for ANY use case. Just change the prompts in Prompt Management, and you have a completely different agent!
        </p>
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
          Answer these questions to confirm your understanding of inbound voice logic
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
            <p className="font-semibold text-green-700 dark:text-green-400">Inbound Logic Complete</p>
            <p className="text-sm text-green-600 dark:text-green-500">All steps verified and saved</p>
          </div>
        </div>
      </div>

      {/* Configuration Summary */}
      <Card className="p-4">
        <h4 className="font-semibold mb-4">Your Configuration</h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Inbound Flow:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Reviewed</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Webhook Logic:</span>
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Reviewed</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border/50">
            <span className="text-muted-foreground">Dynamic Prompts:</span>
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
      "Got It",                // Step 1: Basic Flow
      "I Understand",          // Step 2: Inbound Webhook
      "Makes Sense",           // Step 3: Finding the Contact
      "Continue",              // Step 4: Dynamic Prompts
      "Got It",                // Step 5: Prompt Structure
      "I'll Be Careful",       // Step 6: Booking Functions Warning
      "Understood",            // Step 7: Summary
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
