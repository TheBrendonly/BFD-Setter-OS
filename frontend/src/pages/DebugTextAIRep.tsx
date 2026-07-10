import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Loader2, MessageSquare, FolderOpen, History, Send, Cpu, Save, Clock, Settings, HelpCircle } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { usePageHeader } from '@/contexts/PageHeaderContext';

// Import images - properly mapped to actual screenshots
import conversationsReceived from '@/assets/debug-guide/conversations-message-received.png';
import workflowFolderPublished from '@/assets/debug-guide/workflow-folder-published.png';
import workflowsOpenTabs from '@/assets/debug-text-ai/workflows-open-tabs.png';
import receiveProcessTriggers from '@/assets/debug-text-ai/receive-process-triggers.png';
import receiveProcessEnrollment from '@/assets/debug-text-ai/receive-process-enrollment.png';
import receiveProcessExecutionPath from '@/assets/debug-text-ai/receive-process-execution-path.png';
import receiveProcessExit from '@/assets/debug-text-ai/receive-process-exit.png';
import executionPathButton from '@/assets/debug-text-ai/execution-path-button.png';
import executionPathView from '@/assets/debug-text-ai/execution-path-view.png';
import executionHistoryButton from '@/assets/debug-text-ai/execution-history-button.png';
import executionHistoryView from '@/assets/debug-guide/execution-history-view.png';
import executionHistoryDetails from '@/assets/debug-text-ai/execution-history-details.png';
import addToWaitReply from '@/assets/debug-guide/add-to-wait-reply.png';
import executionHistoryStatuses from '@/assets/debug-guide/execution-history-statuses.png';
import generateReplyEnrollment from '@/assets/debug-guide/generate-reply-enrollment.png';
import generateReplyNode from '@/assets/debug-guide/generate-reply-node.png';
import saveReplyEnrollment from '@/assets/debug-guide/save-reply-enrollment.png';
import saveReplyExecution from '@/assets/debug-guide/save-reply-execution.png';
import sendReplyEnrollment from '@/assets/debug-guide/send-reply-enrollment.png';
import sendReplyExecutionPath from '@/assets/debug-guide/send-reply-execution-path.png';
import sendReplyExecutionHistory from '@/assets/debug-guide/send-reply-execution-history.png';
import sendReplyWaitingStatus from '@/assets/debug-guide/send-reply-waiting-status.png';
import sendReplyWaitFollowup from '@/assets/debug-guide/send-reply-wait-followup.png';
import setCredentialsNode from '@/assets/debug-guide/set-credentials-node.png';
import setCredentialsExecuted from '@/assets/debug-guide/set-credentials-executed.png';
import setCredentialsPublished from '@/assets/debug-guide/set-credentials-published.png';
import setCredentialsEnrollment from '@/assets/debug-guide/set-credentials-enrollment.png';
import setCredentialsBuilder from '@/assets/debug-guide/set-credentials-builder.png';
import setCredentialsApiSuccess from '@/assets/debug-guide/set-credentials-api-success.png';

// Lazy loading image component with click-to-zoom
import { ZoomableImage } from '@/components/ui/zoomable-image';

const GuideImage = ({ src, alt }: { src: string; alt: string }) => (
  <ZoomableImage src={src} alt={alt} containerClassName="mb-4" />
);

interface DebugStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  content: React.ReactNode;
}

const DebugTextAIRep = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();

  usePageHeader({
    title: 'Debug AI Reps',
    breadcrumbs: [
      { label: 'Debug AI Reps', onClick: () => navigate(`/client/${clientId}/debug-ai-reps`) },
      { label: 'Text AI Rep' },
    ],
  });
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Load progress from localStorage
  useEffect(() => {
    if (clientId) {
      try {
        const saved = localStorage.getItem(`debug_text_ai_rep_progress_${clientId}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          setCompletedItems(new Set(parsed.completed || []));
          setExpandedItems(new Set(parsed.expanded || []));
        }
      } catch (e) {
        console.error('Failed to load debug progress:', e);
      }
    }
  }, [clientId]);

  // Save progress to localStorage
  useEffect(() => {
    if (clientId) {
      try {
        localStorage.setItem(`debug_text_ai_rep_progress_${clientId}`, JSON.stringify({
          completed: Array.from(completedItems),
          expanded: Array.from(expandedItems)
        }));
      } catch (e) {
        console.error('Failed to save debug progress:', e);
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

  const toggleCompleted = (id: string) => {
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

  const debugSteps: DebugStep[] = [
    {
      id: 'understanding',
      title: 'Understanding Debugging',
      description: 'Learn what debugging means and how this guide helps you',
      icon: HelpCircle,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">What is Debugging?</CardTitle>
            <CardDescription>
              Understanding the purpose of this guide
            </CardDescription>
          </CardHeader>
          
          <p className="text-sm">
            <strong>Debugging</strong> means something is not working. In our case, you are sending a DM (message) to your AI Rep through WhatsApp, Instagram, SMS, or any other channel, and you're not getting the expected response.
          </p>
          
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p className="text-sm">
              <strong>Why this guide matters:</strong> This guide helps you identify <strong>exactly where the problem is</strong>. Instead of emailing us saying "my AI rep is not replying," you'll be able to pinpoint the exact step that's failing. This makes it much faster for us to help you fix it!
            </p>
          </div>

          <p className="text-sm">
            When a lead sends a DM to any of your connected channels, the Text AI Rep workflow processes that message through several steps. If any step fails, the AI won't reply. Let's go through each step to find where the issue is.
          </p>
        </div>
      )
    },
    {
      id: 'understanding-executions',
      title: 'Understanding Executions',
      description: 'Learn about Execution Path vs Execution History',
      icon: History,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Two Important Debugging Tools</CardTitle>
            <CardDescription>
              Understanding Execution Path vs Execution History
            </CardDescription>
          </CardHeader>

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2 mb-4">
            <p><strong>Execution Path:</strong></p>
            <p>Shows which path the contact took through the workflow. Highlights the workflow steps in green to visually show the journey.</p>
          </div>

          <GuideImage src={executionPathButton} alt="Execution path button in Actions" />
          <GuideImage src={executionPathView} alt="Execution path view with green highlights" />

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2 mb-4">
            <p><strong>Execution History:</strong></p>
            <p>Shows detailed logs of what happened at each step, including statuses and error messages. This is more useful for debugging.</p>
          </div>

          <GuideImage src={executionHistoryButton} alt="Execution history button" />
          <GuideImage src={executionHistoryDetails} alt="Execution history with event details" />

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p><strong>Status meanings:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>Executed (green):</strong> Step completed successfully</li>
              <li><strong>Skipped (gray):</strong> Step was skipped (usually okay)</li>
              <li><strong>Error (red):</strong> Something went wrong - investigate this!</li>
              <li><strong>Waiting (blue):</strong> Step is waiting for a trigger or time delay</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'verify-connection',
      title: 'Step 1: Verify Message is Received',
      description: 'Check if HighLevel is receiving the inbound messages',
      icon: MessageSquare,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Is your channel connection working?</CardTitle>
            <CardDescription>
              First, verify that HighLevel receives your inbound messages
            </CardDescription>
          </CardHeader>

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p><strong>How to check:</strong></p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Send a test message to your connected channel (e.g., WhatsApp number)</li>
              <li>Go to <strong>Conversations</strong> in HighLevel</li>
              <li>You should see a new conversation with your contact and the message you sent</li>
            </ol>
          </div>

          <GuideImage src={workflowFolderPublished} alt="Conversations showing received message" />

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If you see the message:</strong> Great! The connection works. Move to the next step.
            </p>
          </div>

          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If you don't see the message:</strong> The channel connection is broken. Check your channel settings in HighLevel and make sure it's properly connected.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'workflows-published',
      title: 'Step 2: Verify Workflows are Published',
      description: 'Ensure all 5 Text AI Rep workflows are published',
      icon: FolderOpen,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Are all workflows published?</CardTitle>
            <CardDescription>
              All 5 Text AI Rep workflows must be published for the system to work
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            Go to the <strong>Text AI Rep folder</strong> in your Automation section. All 5 workflows must show <strong>"Published"</strong> status.
          </p>

          <GuideImage src={conversationsReceived} alt="Text AI Rep folder with published workflows" />

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p><strong>The 5 workflows are:</strong></p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Receive & Process DMs</li>
              <li>Generate Reply</li>
              <li>Save Reply</li>
              <li>Send Reply</li>
              <li>Send Follow-ups</li>
            </ol>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p className="text-sm">
              <strong>Pro Tip:</strong> Open all 5 workflows in separate browser tabs. This will help you visualize the entire process and quickly check each step.
            </p>
          </div>

          <GuideImage src={workflowsOpenTabs} alt="Workflows open in separate tabs" />
        </div>
      )
    },
    {
      id: 'receive-process',
      title: 'Step 3: Check Receive & Process DMs',
      description: 'Verify the first workflow received your message',
      icon: History,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Check Receive & Process DMs Workflow</CardTitle>
            <CardDescription>
              This is the first workflow that captures your inbound message
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            Open the <strong>Receive & Process DMs</strong> workflow. First, verify that the correct trigger is set up for your channel (WhatsApp, SMS, etc.):
          </p>

          <GuideImage src={receiveProcessTriggers} alt="Receive & Process DMs workflow triggers" />

          <p className="text-sm">
            Check the <strong>Enrollment History</strong>. You should see your contact (the one who sent the test message) listed here:
          </p>

          <GuideImage src={receiveProcessEnrollment} alt="Enrollment history showing contact" />

          <p className="text-sm">
            Check the <strong>Execution Path</strong> to see which path the contact took through the workflow:
          </p>

          <GuideImage src={receiveProcessExecutionPath} alt="Execution path through workflow" />

          <p className="text-sm">
            At the end, the contact should reach the <strong>"Add to Wait & Reply"</strong> action which sends them to the next workflow:
          </p>

          <GuideImage src={receiveProcessExit} alt="Add to Wait & Reply exit point" />

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If the contact appears and was added to the next workflow:</strong> Move to the next step.
            </p>
          </div>

          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If the contact doesn't appear:</strong> Check that your workflow trigger is set up correctly for your channel (WhatsApp, SMS, etc.).
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'generate-reply',
      title: 'Step 4: Check Generate Reply Workflow',
      description: 'Verify the message was handed to the text engine',
      icon: Send,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Check Generate Reply Workflow</CardTitle>
            <CardDescription>
              This workflow hands your message to the platform's text engine
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            Open the <strong>Generate Reply</strong> workflow and check the enrollment history. The contact should appear here, having been added from the "Receive & Process DMs" workflow.
          </p>

          <GuideImage src={generateReplyEnrollment} alt="Generate Reply enrollment history" />

          <p className="text-sm">
            The most important step here is the <strong>"#1 Generate Reply"</strong> webhook node (older snapshots may still label it "in n8n"). Check the execution history and look for this step. It should show <strong>status 200</strong> for success.
          </p>

          <GuideImage src={generateReplyNode} alt="Generate Reply webhook node execution" />

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If you see status 200:</strong> The message was successfully handed to the text engine. Move to the next step.
            </p>
          </div>

          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If you see an error:</strong> Take a screenshot of the error message and email it to support@buildingflowdigital.com so we can help you fix it.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'text-engine',
      title: 'Step 5: Check the Text Engine',
      description: 'Verify the reply was generated by the platform',
      icon: Cpu,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Check the Text Engine</CardTitle>
            <CardDescription>
              This is where your AI reply is actually generated
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            The platform's native text engine generates the reply - there is nothing external to open. If you just sent a test DM, wait 20-60 seconds (the engine batches rapid messages before replying).
          </p>

          <p className="text-sm">
            Then open this client's <strong>Chats</strong> page in the dashboard. You should see your inbound message and, shortly after, the AI reply in the same conversation.
          </p>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p className="text-sm">
              <strong>If the inbound message never appears:</strong> The message did not reach the platform - re-check the Generate Reply workflow in the previous step.
            </p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p className="text-sm">
              <strong>If the message appears but no reply is generated:</strong> Check the <strong>Logs</strong> page for a failed run, and verify the client's text model and credentials are configured.
            </p>
          </div>

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If the reply appears:</strong> The engine is working and the reply was sent back to HighLevel. Move to the next step.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'save-reply',
      title: 'Step 6: Check Save Reply Workflow',
      description: 'Verify the reply was saved to custom fields',
      icon: Save,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Check Save Reply Workflow</CardTitle>
            <CardDescription>
              This workflow saves the AI-generated replies to custom fields
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            Open the <strong>Save Reply</strong> workflow and check the enrollment history. Your contact should appear here.
          </p>

          <GuideImage src={saveReplyEnrollment} alt="Save Reply enrollment history" />

          <p className="text-sm">
            Check the execution history and make sure all steps are <strong>Executed</strong> (green).
          </p>

          <GuideImage src={saveReplyExecution} alt="Save Reply execution history" />

          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            <p>This workflow saves all the generated replies (Response 1, Response 2, etc.) into custom fields. Once completed, it sends the contact to the <strong>Send Reply</strong> workflow.</p>
          </div>

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If all steps are executed:</strong> The replies were saved successfully. Move to the next step.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'send-reply',
      title: 'Step 7: Check Send Reply Workflow',
      description: 'Verify the outbound messages were sent',
      icon: Clock,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Check Send Reply Workflow</CardTitle>
            <CardDescription>
              This workflow sends the AI-generated responses back to the lead
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            Open the <strong>Send Reply</strong> workflow and check the enrollment history. Your contact should appear here.
          </p>

          <GuideImage src={sendReplyEnrollment} alt="Send Reply enrollment history" />

          <p className="text-sm">
            First, check the <strong>Execution Path</strong> to see visually which channel was used to send the reply.
          </p>

          <GuideImage src={sendReplyExecutionPath} alt="Send Reply execution path" />

          <p className="text-sm">
            Then check the <strong>Execution History</strong>. Look for your channel nodes (e.g., WhatsApp) and verify they show <strong>Executed</strong> status.
          </p>

          <GuideImage src={sendReplyExecutionHistory} alt="Send Reply execution history with WhatsApp nodes" />

          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            <p>You may notice that the contact shows <strong>"Waiting for Contact"</strong> status. This is normal! The workflow is now waiting for the lead to reply before sending follow-ups.</p>
          </div>

          <GuideImage src={sendReplyWaitingStatus} alt="Send Reply waiting status" />

          <p className="text-sm">
            If the lead doesn't reply within the configured time, they'll be moved to the Send Follow-ups workflow.
          </p>

          <GuideImage src={sendReplyWaitFollowup} alt="Send Reply wait for followup" />

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If the outbound nodes are executed:</strong> The messages were sent! Check your phone/channel to confirm you received the reply.
            </p>
          </div>

          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>If there's an error on the outbound nodes:</strong> Click "View Details" to see the error message. Common issues include incorrect phone number format or channel connection problems.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'set-credentials',
      title: 'Step 8: Troubleshoot Set Credentials',
      description: 'Check if credentials are being retrieved correctly',
      icon: Settings,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Troubleshoot Set Credentials Workflow</CardTitle>
            <CardDescription>
              This workflow retrieves your API keys and webhooks from Supabase
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            If something is still not working, there might be an issue with the <strong>Set Credentials</strong> workflow. This workflow runs alongside Generate Reply to fetch your credentials from Supabase.
          </p>

          <p className="text-sm">
            In the <strong>Generate Reply</strong> workflow, there's a step that adds the contact to the Set Credentials workflow:
          </p>

          <GuideImage src={setCredentialsNode} alt="Set Credentials node in Generate Reply" />

          <p className="text-sm">
            Check the execution history to make sure this step was executed:
          </p>

          <GuideImage src={setCredentialsExecuted} alt="Set Credentials executed" />

          <p className="text-sm">
            Now go to the <strong>Set Credentials</strong> workflow itself. Make sure it's <strong>Published</strong>:
          </p>

          <GuideImage src={setCredentialsPublished} alt="Set Credentials workflow published" />

          <p className="text-sm">
            Check the enrollment history to see if your contact was added:
          </p>

          <GuideImage src={setCredentialsEnrollment} alt="Set Credentials enrollment history" />

          <p className="text-sm">
            In the workflow builder, verify that your Supabase credentials are correctly configured in the Set Credentials node:
          </p>

          <GuideImage src={setCredentialsBuilder} alt="Set Credentials builder" />

          <p className="text-sm">
            Finally, check the execution history and verify that the API calls to Supabase returned successfully (status 200 with your credentials in the response):
          </p>

          <GuideImage src={setCredentialsApiSuccess} alt="Set Credentials API success" />

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p className="text-sm">
              <strong>Important:</strong> The Set Credentials workflow runs in parallel with Generate Reply. Even though a contact is sent to Set Credentials, they don't exit Generate Reply - both workflows run simultaneously.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'get-help',
      title: 'Step 9: Getting Help',
      description: 'How to report issues if you still need assistance',
      icon: HelpCircle,
      content: (
        <div className="space-y-4">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-lg">Getting Help</CardTitle>
            <CardDescription>
              How to effectively report your issue for fast support
            </CardDescription>
          </CardHeader>

          <p className="text-sm">
            If you went through all the steps and everything is working, congratulations! Your AI Rep is functioning correctly.
          </p>

          <p className="text-sm">
            If you found an error at any step, here's how to get help:
          </p>

          <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
            <p><strong>When emailing support@buildingflowdigital.com for help:</strong></p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Take a <strong>screenshot</strong> of the specific error or problem</li>
              <li>Mention which <strong>workflow</strong> and which <strong>step</strong> has the issue</li>
              <li>Describe what you were testing (e.g., "Sent a WhatsApp message saying 'hello'")</li>
              <li>Include any error messages you see</li>
            </ol>
          </div>

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-sm">
              <strong>Example of a good support message:</strong><br/><br/>
              "I'm having an issue in the Generate Reply workflow. The '#1 Generate Reply' step shows an error with status 500. Here's the screenshot. I sent a test message 'hello' to my WhatsApp number."
            </p>
          </div>

          <p className="text-sm">
            This level of detail helps us immediately understand where the problem is and fix it much faster!
          </p>
        </div>
      )
    }
  ];

  const completedCount = completedItems.size;
  const totalCount = debugSteps.length;
  const percentage = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="h-full overflow-hidden bg-background flex flex-col">
      <div className="container mx-auto max-w-7xl flex flex-col h-full overflow-hidden py-4">
        {/* Progress Card */}
        <Card className="material-surface mb-4 flex-shrink-0 bg-background/95 backdrop-blur-sm">
          <CardHeader className="pb-3 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">Debug Text AI Rep</CardTitle>
                <CardDescription className="mt-1">
                  Follow each step to identify where the issue is occurring
                </CardDescription>
              </div>
              <div className="text-right">
                <span className="text-[24px] font-bold text-primary">
                  {percentage}%
                </span>
                <p className="text-xs text-muted-foreground">
                  {completedCount}/{totalCount} steps checked
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <Progress value={percentage} className="h-2" />
          </CardContent>
        </Card>

        {/* Debug Steps - Scrollable */}
        <div className="space-y-3 flex-1 overflow-auto pb-4">
          {debugSteps.map((step) => {
            const isCompleted = completedItems.has(step.id);
            const isExpanded = expandedItems.has(step.id);
            const Icon = step.icon;

            return (
              <Collapsible key={step.id} open={isExpanded} onOpenChange={() => toggleExpanded(step.id)}>
                <div className={cn(
                  "border-2 rounded-lg transition-all",
                  isCompleted 
                    ? "border-green-500 bg-green-50/30 dark:bg-green-950/10" 
                    : "border-red-500 bg-red-50/30 dark:bg-red-950/10"
                )}>
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center gap-4 p-4">
                      {/* Icon only - no circles or numbers */}
                      <div className={cn(
                        "p-2 rounded-lg flex-shrink-0",
                        isCompleted 
                          ? "bg-green-100 dark:bg-green-900/30" 
                          : "bg-red-100 dark:bg-red-900/30"
                      )}>
                        <Icon className={cn(
                          "h-5 w-5",
                          isCompleted 
                            ? "text-green-600 dark:text-green-400" 
                            : "text-red-600 dark:text-red-400"
                        )} />
                      </div>

                      <div className="flex-1 text-left min-w-0">
                        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">
                          {step.title}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                          {step.description}
                        </p>
                      </div>

                      <ChevronDown className={cn(
                        "h-5 w-5 text-muted-foreground transition-transform flex-shrink-0",
                        isExpanded && "rotate-180"
                      )} />
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-0">
                      <div className="border-t border-border/50 pt-4">
                        {step.content}
                        
                        <div className="mt-6 pt-4 border-t border-border/50">
                          <Button
                            onClick={() => toggleCompleted(step.id)}
                            className={cn(
                              "w-full",
                              isCompleted
                                ? "bg-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-500/30"
                                : "bg-primary hover:bg-primary/90 text-primary-foreground"
                            )}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            {isCompleted ? "Marked as Checked" : "Mark as Checked"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default DebugTextAIRep;
