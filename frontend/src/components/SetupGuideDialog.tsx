import React, { useState, useEffect } from 'react';
import { SETUP_SQL_SCRIPT } from '@/constants/setupSqlScript';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, ChevronRight, CheckCircle2, ExternalLink, Eye, EyeOff, Save, Bot, Copy, Settings, Phone, Lock, AlertCircle } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { EmbeddedPromptChat } from '@/components/EmbeddedPromptChat';
import { preserveMarkdownFormatting } from '@/utils/markdownConverter';
import VoiceOutboundLogicStep from '@/components/setup-guide/VoiceOutboundLogicStep';
import type { QuizNavigationState } from '@/components/setup-guide/quizNavigationState';
import { getDefaultPromptForSlot, STATIC_PROMPTS } from '@/data/defaultPromptTemplates';
import supabaseNewProject from '@/assets/setup-guide/supabase-new-project.png';
import supabaseCreateAccount from '@/assets/setup-guide/supabase-create-account.png';
import retellCreateAccount from '@/assets/setup-guide/retell-create-account.png';
import supabaseTablesCreated from '@/assets/setup-guide/supabase-tables-created.png';
import supabaseMicroPlan from '@/assets/setup-guide/supabase-micro-plan.png';
import supabaseSqlEditor from '@/assets/setup-guide/supabase-sql-editor.png';
import skoolSnapshotLink from '@/assets/setup-guide/skool-snapshot-link.png';
import ghlImportSnapshot from '@/assets/setup-guide/ghl-import-snapshot.png';
import skoolWorkflowsDownload from '@/assets/setup-guide/skool-workflows-download.png';
import n8nImportWorkflow from '@/assets/setup-guide/n8n-import-workflow.png';
import skoolWorkflowFolders from '@/assets/setup-guide/skool-workflow-folders.png';
import n8nCreateFolder from '@/assets/setup-guide/n8n-create-folder.png';
import skoolRetellTemplates from '@/assets/setup-guide/skool-retell-templates.png';
import retellImportAgent from '@/assets/setup-guide/retell-import-agent.png';
import supabaseProjectUrl from '@/assets/setup-guide/supabase-project-url.png';
import supabaseServiceKey from '@/assets/setup-guide/supabase-service-key.png';
import openrouterApiKeys from '@/assets/setup-guide/openrouter-api-keys.png';
import openaiApiKeys from '@/assets/setup-guide/openai-api-keys.png';
import ghlApiKey from '@/assets/setup-guide/ghl-api-key.png';
import ghlAssigneeId from '@/assets/setup-guide/ghl-assignee-id.png';
import ghlCalendarId from '@/assets/setup-guide/ghl-calendar-id.png';
import ghlLocationId from '@/assets/setup-guide/ghl-location-id.png';
import ghlVerifyWorkflow from '@/assets/setup-guide/ghl-verify-workflow.png';
import retellApiKeys from '@/assets/setup-guide/retell-api-keys.png';
import retellAgentsList from '@/assets/setup-guide/retell-agents-list.png';
import retellAgentId from '@/assets/setup-guide/retell-agent-id.png';
import retellPromptsStructure from '@/assets/setup-guide/retell-prompts-structure.png';
import retellPhoneNumbers from '@/assets/setup-guide/retell-phone-numbers.png';
// N8N Setup phase images
import n8nOpenWorkflow from '@/assets/setup-guide/n8n-open-workflow.png';
import n8nWorkflowOverview from '@/assets/setup-guide/n8n-workflow-overview.png';
import n8nNotesColors from '@/assets/setup-guide/n8n-notes-colors.png';
import n8nFirstRedNote from '@/assets/setup-guide/n8n-first-red-note.png';
import n8nSupabaseCredentials from '@/assets/setup-guide/n8n-supabase-credentials.png';
import n8nSupabaseConnection from '@/assets/setup-guide/n8n-supabase-connection.png';
import n8nGetPrompts from '@/assets/setup-guide/n8n-get-prompts.png';
import n8nConversationHistory from '@/assets/setup-guide/n8n-conversation-history.png';
import n8nPostgresNewCredential from '@/assets/setup-guide/n8n-postgres-new-credential.png';
import supabaseProjectsList from '@/assets/setup-guide/supabase-projects-list.png';
import supabaseConnectButton from '@/assets/setup-guide/supabase-connect-button.png';
import supabaseSessionPooler from '@/assets/setup-guide/supabase-session-pooler.png';
import n8nPostgresForm from '@/assets/setup-guide/n8n-postgres-form.png';
import supabaseSessionPoolerParams from '@/assets/setup-guide/supabase-session-pooler-params.png';
import n8nPostgresFilled from '@/assets/setup-guide/n8n-postgres-filled.png';
import n8nPostgresPassword from '@/assets/setup-guide/n8n-postgres-password.png';
import supabaseDatabaseSettings from '@/assets/setup-guide/supabase-database-settings.png';
import supabaseSessionPoolerPort from '@/assets/setup-guide/supabase-session-pooler-port.png';
import n8nPostgresPort from '@/assets/setup-guide/n8n-postgres-port.png';
import n8nPostgresSave from '@/assets/setup-guide/n8n-postgres-save.png';
// New phase images
import n8nFollowupHistoryNode from '@/assets/setup-guide/n8n-followup-history-node.png';
import n8nFollowupHistoryConnection from '@/assets/setup-guide/n8n-followup-history-connection.png';
import n8nLlmModelNode from '@/assets/setup-guide/n8n-llm-model-node.png';
import n8nOpenrouterConnection from '@/assets/setup-guide/n8n-openrouter-connection.png';
import n8nEmbeddingsOpenaiNode from '@/assets/setup-guide/n8n-embeddings-openai-node.png';
import n8nOpenaiConnection from '@/assets/setup-guide/n8n-openai-connection.png';
import n8nMultipleLlmNodes from '@/assets/setup-guide/n8n-multiple-llm-nodes.png';
import n8nKnowledgebaseNode from '@/assets/setup-guide/n8n-knowledgebase-node.png';
import n8nKnowledgebaseConnection from '@/assets/setup-guide/n8n-knowledgebase-connection.png';
// Appointment Name step images
import n8nBookAppointmentNode from '@/assets/setup-guide/n8n-book-appointment-node.png';
import n8nBookAppointmentJson from '@/assets/setup-guide/n8n-book-appointment-json.png';
import n8nBookAppointmentTitle from '@/assets/setup-guide/n8n-book-appointment-title.png';
// HighLevel Setup phase images
import ghlWorkflowsList from '@/assets/setup-guide/ghl-workflows-list.png';
import ghlReceiveProcessDms from '@/assets/setup-guide/ghl-receive-process-dms.png';
import ghlPublishSave from '@/assets/setup-guide/ghl-publish-save.png';
import ghlGenerateReplyList from '@/assets/setup-guide/ghl-generate-reply-list.png';
import ghlGetApiCredentialsNodeV2 from '@/assets/setup-guide/ghl-get-api-credentials-node-v2.png';
import ghlUrlSectionV2 from '@/assets/setup-guide/ghl-url-section-v2.png';
import ghlHeadersSectionV2 from '@/assets/setup-guide/ghl-headers-section-v2.png';
import ghlPublishSaveV2 from '@/assets/setup-guide/ghl-publish-save-v2.png';
// Note: ghlSendReplyWorkflow removed - now using ghlSendReplyList instead
// Update Lead Details images
import ghlUpdateLeadDetailsList from '@/assets/setup-guide/ghl-update-lead-details-list.png';
import ghlUpdatePipelineTrigger from '@/assets/setup-guide/ghl-update-pipeline-trigger.png';
import ghlUpdatePipelineWebhook from '@/assets/setup-guide/ghl-update-pipeline-webhook.png';
import ghlFetchSampleRequests from '@/assets/setup-guide/ghl-fetch-sample-requests.png';
import ghlSelectRequest from '@/assets/setup-guide/ghl-select-request.png';
import ghlSaveWorkflow from '@/assets/setup-guide/ghl-save-workflow.png';
// Update Lead Score images
import ghlUpdateLeadScoreList from '@/assets/setup-guide/ghl-update-lead-score-list.png';
import ghlUpdateLeadScoreTrigger from '@/assets/setup-guide/ghl-update-lead-score-trigger.png';
import ghlUpdateLeadScoreWebhook from '@/assets/setup-guide/ghl-update-lead-score-webhook.png';
import ghlLeadScoreFetchRequests from '@/assets/setup-guide/ghl-lead-score-fetch-requests.png';
import ghlLeadScoreSelectRequest from '@/assets/setup-guide/ghl-lead-score-select-request.png';
import ghlLeadScoreSaveTrigger from '@/assets/setup-guide/ghl-lead-score-save-trigger.png';
import ghlLeadScorePublishSave from '@/assets/setup-guide/ghl-lead-score-publish-save.png';
// Update Lead Pipeline Stage images
import ghlPipelineStageList from '@/assets/setup-guide/ghl-pipeline-stage-list.png';
import ghlPipelineStageTrigger from '@/assets/setup-guide/ghl-pipeline-stage-trigger.png';
import ghlPipelineStageWebhook from '@/assets/setup-guide/ghl-pipeline-stage-webhook.png';
import ghlPipelineStageFetch from '@/assets/setup-guide/ghl-pipeline-stage-fetch.png';
import ghlPipelineStageSelect from '@/assets/setup-guide/ghl-pipeline-stage-select.png';
import ghlPipelineStageSave from '@/assets/setup-guide/ghl-pipeline-stage-save.png';
// Transfer to Human images
import ghlTransferHumanList from '@/assets/setup-guide/ghl-transfer-human-list.png';
import ghlTransferHumanTrigger from '@/assets/setup-guide/ghl-transfer-human-trigger.png';
import ghlTransferHumanWebhook from '@/assets/setup-guide/ghl-transfer-human-webhook.png';
import ghlTransferHumanFetch from '@/assets/setup-guide/ghl-transfer-human-fetch.png';
import ghlTransferHumanSelect from '@/assets/setup-guide/ghl-transfer-human-select.png';
import ghlTransferHumanSave from '@/assets/setup-guide/ghl-transfer-human-save.png';
import ghlTransferHumanPublish from '@/assets/setup-guide/ghl-transfer-human-publish.png';
// Set Credentials workflow images
import ghlSetCredentialsList from '@/assets/setup-guide/ghl-set-credentials-list.png';
import ghlSetCredentialsFields from '@/assets/setup-guide/ghl-set-credentials-fields.png';
import ghlSetCredentialsSave from '@/assets/setup-guide/ghl-set-credentials-save.png';
// Save Reply workflow images
import ghlSaveReplyList from '@/assets/setup-guide/ghl-save-reply-list.png';
import ghlSaveReplyTrigger from '@/assets/setup-guide/ghl-save-reply-trigger.png';
import ghlSaveReplyWebhook from '@/assets/setup-guide/ghl-save-reply-webhook.png';
import ghlSaveReplyFetchRequests from '@/assets/setup-guide/ghl-save-reply-fetch-requests.png';
import ghlSaveReplySelectRequest from '@/assets/setup-guide/ghl-save-reply-select-request.png';
import ghlSaveReplyPublish from '@/assets/setup-guide/ghl-save-reply-publish.png';
import ghlGenerateReplySave from '@/assets/setup-guide/ghl-generate-reply-save.png';
// Send Reply workflow images
import ghlSendReplyList from '@/assets/setup-guide/ghl-send-reply-list.png';
import ghlSendReplyFollowupTimes from '@/assets/setup-guide/ghl-send-reply-followup-times.png';
import ghlSendReplyPublish from '@/assets/setup-guide/ghl-send-reply-publish.png';
// Send Followups workflow images
import ghlSendFollowupsList from '@/assets/setup-guide/ghl-send-followups-list.png';
import ghlSendFollowupsWorkflow from '@/assets/setup-guide/ghl-send-followups-workflow.png';
import ghlSendFollowupsTimes from '@/assets/setup-guide/ghl-send-followups-times.png';
// Retell Setup phase images
import retellInboundAgentList from '@/assets/setup-guide/retell-inbound-agent-list.png';
// TODO 2026-05-20 (D27 follow-up): PNG file rename pending Brendan's Retell
// screenshot session. Once the new "Building Flow" folder PNGs are captured,
// rename retell-1prompt-folder.png → retell-building-flow-folder.png and update
// this import + path. Text references throughout this file already say
// "Building Flow" per phase-night-n3-setup-guide-text-rebrand.
import retellBuildingFlowFolder from '@/assets/setup-guide/retell-1prompt-folder.png';
import retellInboundAgentClick from '@/assets/setup-guide/retell-inbound-agent-click.png';
import retellInboundAgentIdCopy from '@/assets/setup-guide/retell-inbound-agent-id-copy.png';
import retellOutboundAgentClick from '@/assets/setup-guide/retell-outbound-agent-click.png';
import retellOutboundAgentIdCopy from '@/assets/setup-guide/retell-outbound-agent-id-copy.png';
import n8nMakeOutboundCallList from '@/assets/setup-guide/n8n-make-outbound-call-list.png';
import n8nMakeOutboundCallWorkflow from '@/assets/setup-guide/n8n-make-outbound-call-workflow.png';
import n8nMakeOutboundCallWebhook from '@/assets/setup-guide/n8n-make-outbound-call-webhook.png';
import n8nMakeOutboundCallProductionUrl from '@/assets/setup-guide/n8n-make-outbound-call-production-url.png';
import ghlCallFinishedWorkflow from '@/assets/setup-guide/ghl-call-finished-workflow.png';
import ghlCallReceivedTrigger from '@/assets/setup-guide/ghl-call-received-trigger.png';
import ghlCallReceivedWebhookUrl from '@/assets/setup-guide/ghl-call-received-webhook-url.png';
import ghlCallReceivedFetchRequests from '@/assets/setup-guide/ghl-call-received-fetch-requests.png';
import ghlCallReceivedSelectPayload from '@/assets/setup-guide/ghl-call-received-select-payload.png';
import ghlCallReceivedPayloadSelected from '@/assets/setup-guide/ghl-call-received-payload-selected.png';
import ghlCallReceivedSavePublish from '@/assets/setup-guide/ghl-call-received-save-publish.png';
import retellInboundWebhookSettings from '@/assets/setup-guide/retell-inbound-webhook-settings.png';
// Get Lead Details workflow images
import n8nGetLeadDetailsList from '@/assets/setup-guide/n8n-get-lead-details-list.png';
import n8nGetLeadDetailsWorkflow from '@/assets/setup-guide/n8n-get-lead-details-workflow.png';
import n8nGetLeadDetailsSupabase from '@/assets/setup-guide/n8n-get-lead-details-supabase.png';
import n8nGetLeadDetailsWebhook from '@/assets/setup-guide/n8n-get-lead-details-webhook.png';
import n8nGetLeadDetailsProductionUrl from '@/assets/setup-guide/n8n-get-lead-details-production-url.png';
import n8nGetLeadDetailsSave from '@/assets/setup-guide/n8n-get-lead-details-save.png';
import retellPhoneNumbersWebhook from '@/assets/setup-guide/retell-phone-numbers-webhook.png';
// Booking Workflow images
import n8nBookAppointmentList from '@/assets/setup-guide/n8n-book-appointment-list.png';
import n8nBookAppointmentWorkflow from '@/assets/setup-guide/n8n-book-appointment-workflow.png';
import n8nBookAppointmentCredentials from '@/assets/setup-guide/n8n-book-appointment-credentials.png';
import n8nBookAppointmentModule from '@/assets/setup-guide/n8n-book-appointment-module.png';
import n8nBookAppointmentActivate from '@/assets/setup-guide/n8n-book-appointment-activate.png';
// Booking Functions images
import retellFunctionsList from '@/assets/setup-guide/retell-functions-list.png';
import n8nBookingWebhookNode from '@/assets/setup-guide/n8n-booking-webhook-node.png';
import n8nBookingWebhookUrl from '@/assets/setup-guide/n8n-booking-webhook-url.png';
import retellFunctionApiEndpoint from '@/assets/setup-guide/retell-function-api-endpoint.png';
import retellFunctionUpdate from '@/assets/setup-guide/retell-function-update.png';
import retellFunctionsBook from '@/assets/setup-guide/retell-functions-book.png';
import retellBookAppointmentsEndpoint from '@/assets/setup-guide/retell-book-appointments-endpoint.png';
import retellRemainingFunctions from '@/assets/setup-guide/retell-remaining-functions.png';
import retellPublishDialog from '@/assets/setup-guide/retell-publish-dialog.png';
// Prompt system explanation images
import n8nAgentBotPersona from '@/assets/setup-guide/n8n-agent-bot-persona.png';
import n8nAgentPrompt1 from '@/assets/setup-guide/n8n-agent-prompt-1.png';
import n8nAgentPromptNumber from '@/assets/setup-guide/n8n-agent-prompt-number.png';
// Multi Agent Logic images
import ghlEngagementAgentNumber from '@/assets/setup-guide/ghl-engagement-agent-number.png';
import ghlRollupAgentNumber from '@/assets/setup-guide/ghl-rollup-agent-number.png';
import n8nMultiAgentRouting from '@/assets/setup-guide/n8n-multi-agent-routing.png';
// Knowledgebase Setup images
import n8nKbWorkflowList from '@/assets/setup-guide/n8n-kb-workflow-list.png';
import n8nKbWorkflowOverview from '@/assets/setup-guide/n8n-kb-workflow-overview.png';
import n8nKbSupabaseNodesHighlight from '@/assets/setup-guide/n8n-kb-supabase-nodes-highlight.png';
import n8nKbSupabaseConnection from '@/assets/setup-guide/n8n-kb-supabase-connection.png';
import n8nKbEmbeddingsHighlight from '@/assets/setup-guide/n8n-kb-embeddings-highlight.png';
import n8nKbEmbeddingsOpenai from '@/assets/setup-guide/n8n-kb-embeddings-openai.png';
import n8nKbWebhookHighlight from '@/assets/setup-guide/n8n-kb-webhook-highlight.png';
import n8nKbWebhookUrl from '@/assets/setup-guide/n8n-kb-webhook-url.png';
import n8nKbSaveButton from '@/assets/setup-guide/n8n-kb-save-button.png';
// Twilio Setup images
import ghlPhoneSystemAddNumber from '@/assets/setup-guide/ghl-phone-system-add-number.png';
import twilioActiveNumbers from '@/assets/setup-guide/twilio-active-numbers.png';
import twilioA2pMessaging from '@/assets/setup-guide/twilio-a2p-messaging.png';
import twilioA2pRegistration from '@/assets/setup-guide/twilio-a2p-registration.png';
import twilioCampaignRegistration from '@/assets/setup-guide/twilio-campaign-registration.png';
// Connect Channel images
import ghlIntegrationsFacebook from '@/assets/setup-guide/ghl-integrations-facebook.png';
import ghlConversationsTab from '@/assets/setup-guide/ghl-conversations-tab.png';
// Publish Demo - Live Chat Widget images
import ghlSitesChatWidget from '@/assets/setup-guide/ghl-sites-chat-widget.png';
import ghlSelectLiveChat from '@/assets/setup-guide/ghl-select-live-chat.png';
import ghlWidgetStyleTab from '@/assets/setup-guide/ghl-widget-style-tab.png';
import ghlWidgetChatWindow from '@/assets/setup-guide/ghl-widget-chat-window.png';
import ghlWidgetContactForm from '@/assets/setup-guide/ghl-widget-contact-form.png';
import ghlWidgetMessaging from '@/assets/setup-guide/ghl-widget-messaging.png';
import ghlWidgetSave from '@/assets/setup-guide/ghl-widget-save.png';
import ghlWidgetGetCode from '@/assets/setup-guide/ghl-widget-get-code.png';
import ghlReceiveDmsLiveChat from '@/assets/setup-guide/ghl-receive-dms-live-chat.png';
// WhatsApp Setup images
import whatsappSubscribe from '@/assets/setup-guide/whatsapp-subscribe.png';
import whatsappBusinessDashboard from '@/assets/setup-guide/whatsapp-business-dashboard.png';
import phoneSystemNumbers from '@/assets/setup-guide/phone-system-numbers.png';
import whatsappAddNumber from '@/assets/setup-guide/whatsapp-add-number.png';
import whatsappConfigureSelect from '@/assets/setup-guide/whatsapp-configure-select.png';
import whatsappConfigureOwn from '@/assets/setup-guide/whatsapp-configure-own.png';
import whatsappConnectedStatus from '@/assets/setup-guide/whatsapp-connected-status.png';
import whatsappWorkflowTrigger from '@/assets/setup-guide/whatsapp-workflow-trigger.png';
import whatsappConversationsTest from '@/assets/setup-guide/whatsapp-conversations-test.png';
// SMS Setup images
import smsPhoneNumbersA2p from '@/assets/setup-guide/sms-phone-numbers-a2p.png';
import smsWorkflowTrigger from '@/assets/setup-guide/sms-workflow-trigger.png';
import smsConversationsTest from '@/assets/setup-guide/sms-conversations-test.png';
// Meta/Instagram Setup images
import metaIntegrationsConnect from '@/assets/setup-guide/meta-integrations-connect.png';
import metaFacebookLogin from '@/assets/setup-guide/meta-facebook-login.png';
import metaSelectPages from '@/assets/setup-guide/meta-select-pages.png';
import metaWorkflowTriggers from '@/assets/setup-guide/meta-workflow-triggers.png';
import metaConversationsTest from '@/assets/setup-guide/meta-conversations-test.png';
// Demo Setup images
import demoFunnelsList from '@/assets/setup-guide/demo-funnels-list.png';
import demoFunnelSteps from '@/assets/setup-guide/demo-funnel-steps.png';
import demoOptinEdit from '@/assets/setup-guide/demo-optin-edit.png';
import demoOptinForm from '@/assets/setup-guide/demo-optin-form.png';
import demoConfirmationStep from '@/assets/setup-guide/demo-confirmation-step.png';
import demoConfirmationPage from '@/assets/setup-guide/demo-confirmation-page.png';
import demoFormEdit from '@/assets/setup-guide/demo-form-edit.png';
import demoEngagementWorkflow from '@/assets/setup-guide/demo-engagement-workflow.png';
import demoWorkflowTrigger from '@/assets/setup-guide/demo-workflow-trigger.png';
import demoAgentNumber from '@/assets/setup-guide/demo-agent-number.png';
import demoSmsEngagement from '@/assets/setup-guide/demo-sms-engagement.png';
import demoPhoneNumbers from '@/assets/setup-guide/demo-phone-numbers.png';
import demoOutboundCallAgentNumber from '@/assets/setup-guide/demo-outbound-call-agent-number.png';
import demoWorkflowPublish from '@/assets/setup-guide/demo-workflow-publish.png';
import demoTestForm from '@/assets/setup-guide/demo-test-form.png';
import demoTestConfirmation from '@/assets/setup-guide/demo-test-confirmation.png';
// Phase definitions with step counts for tracking completion
// Each phase ID maps to the number of steps in that phase
export const SETUP_PHASES = {
  'account-creation': 5,  // 4 original + 1 API key step (OpenAI + OpenRouter combined) - Twilio moved to twilio-setup
  'supabase-setup': 7,  // 5 original steps + 2 connection steps (Project URL + Service Key) - includes Create Account
  'workflows-import': 3,  // Download, Import, Organize workflows
  'n8n-setup': 12,  // Text AI Rep Setup: 12 setup steps starting from Open Workflow
  'text-prompts-setup': 7,  // Understand Prompts + Bot Persona + 3 Text Engine prompts + 2 Booking prompts
  'highlevel-credentials': 4,  // API Key, Assignee ID, Location ID, Calendar ID
  'highlevel-setup': 10,  // 10 steps: Connect Channel + 9 workflow steps
  'twilio-setup': 6,  // Create Account, Understand Phone Numbers, Buy Number, Connect to GHL, A2P Brand, A2P Campaign
  'voice-accounts-setup': 6,  // Create Account, Download Templates, Import Agents, Verify Folders, API Key, Phone Numbers
  'voice-inbound-setup': 8,  // Inbound Agent ID, Get Lead Details, Inbound Webhook, Call Finished, Retell Webhook Settings, Booking Workflow, Booking Functions, Publish Agent
  'voice-outbound-setup': 5,  // Outbound Agent ID, Outbound Booking Functions, Make Outbound Call, Outbound Webhook, Activate Workflow
  'voice-prompts-setup': 6,  // Understand Prompts + Outbound Logic + Persona (0) + Main Agent (1,2) + Booking (5)
  'knowledgebase-setup': 5,  // 5 steps: Open Workflow, Supabase Nodes, Embeddings, Webhook, Publish
  'live-chat-setup': 8,  // 8 steps: Navigate, Create Widget, Style, Chat Window, Contact Form, Messaging, Save, Get Code & Auto-Connection
  'whatsapp-setup': 8,  // 8 steps: Understand Logic, Subscribe, Get Phone Number, Add to WhatsApp, Configure Number, Verify Status, Enable Workflow Trigger, Test
  'sms-setup': 5,  // 5 steps: Understand A2P, Phone Number Options, Verify A2P Complete, Enable SMS Trigger, Test SMS
  'meta-instagram-setup': 5,  // 5 steps: Connect Facebook/Instagram, Login, Select Pages, Enable Triggers, Test DMs
  'inbound-voice-ai-testing': 5,  // 4 steps: Prerequisites Check, Verify Retell Config, Get Phone Number, Test Inbound Call
  'demo-setup': 13  // 13 steps: Complete Text AI Rep, Complete Voice AI Rep, Find Template, Review Steps, Edit Opt-In, Confirmation Page, Configure Form, Engagement Workflow, Agent Number, SMS Engagement, Outbound Call, Publish Workflow, Test Demo
} as const;

export const PHASE_IDS = Object.keys(SETUP_PHASES) as (keyof typeof SETUP_PHASES)[];

// Helper function to check if a phase is complete based on completed steps
export const isPhaseComplete = (phaseId: keyof typeof SETUP_PHASES, completedSteps: string[]): boolean => {
  const stepCount = SETUP_PHASES[phaseId];
  for (let i = 0; i < stepCount; i++) {
    if (!completedSteps.includes(`${phaseId}-${i}`)) {
      return false;
    }
  }
  return true;
};

// Helper function to check if ALL phases are complete
export const areAllPhasesComplete = (completedSteps: string[]): boolean => {
  return PHASE_IDS.every(phaseId => isPhaseComplete(phaseId, completedSteps));
};

// All images to preload
const ALL_IMAGES = [
  supabaseNewProject, supabaseMicroPlan, supabaseSqlEditor, skoolSnapshotLink,
  ghlImportSnapshot, skoolWorkflowsDownload, n8nImportWorkflow, skoolWorkflowFolders,
  n8nCreateFolder, skoolRetellTemplates, retellImportAgent, supabaseProjectUrl,
  supabaseServiceKey, openrouterApiKeys, openaiApiKeys, ghlApiKey, ghlAssigneeId,
  ghlCalendarId, ghlLocationId, ghlVerifyWorkflow, retellApiKeys, retellAgentsList,
  retellAgentId, retellPhoneNumbers, n8nOpenWorkflow, n8nWorkflowOverview, n8nNotesColors,
  n8nFirstRedNote, n8nSupabaseCredentials, n8nSupabaseConnection, n8nGetPrompts,
  n8nConversationHistory, n8nPostgresNewCredential, supabaseProjectsList, supabaseConnectButton,
  supabaseSessionPooler, n8nPostgresForm, supabaseSessionPoolerParams, n8nPostgresFilled,
  n8nPostgresPassword, supabaseDatabaseSettings, supabaseSessionPoolerPort, n8nPostgresPort,
  n8nPostgresSave, n8nFollowupHistoryNode, n8nFollowupHistoryConnection, n8nLlmModelNode,
  n8nOpenrouterConnection, n8nEmbeddingsOpenaiNode, n8nOpenaiConnection, n8nMultipleLlmNodes, n8nKnowledgebaseNode,
  n8nKnowledgebaseConnection, n8nBookAppointmentNode, n8nBookAppointmentJson, n8nBookAppointmentTitle,
  // HighLevel Setup phase images
  ghlWorkflowsList, ghlReceiveProcessDms, ghlPublishSave, ghlGenerateReplyList,
  ghlGetApiCredentialsNodeV2, ghlUrlSectionV2, ghlHeadersSectionV2, ghlPublishSaveV2,
  ghlUpdateLeadDetailsList, ghlUpdatePipelineTrigger, ghlUpdatePipelineWebhook,
  ghlFetchSampleRequests, ghlSelectRequest, ghlSaveWorkflow,
  ghlUpdateLeadScoreList, ghlUpdateLeadScoreTrigger, ghlUpdateLeadScoreWebhook,
  ghlLeadScoreFetchRequests, ghlLeadScoreSelectRequest, ghlLeadScoreSaveTrigger, ghlLeadScorePublishSave,
  ghlPipelineStageList, ghlPipelineStageTrigger, ghlPipelineStageWebhook,
  ghlPipelineStageFetch, ghlPipelineStageSelect, ghlPipelineStageSave,
  ghlTransferHumanList, ghlTransferHumanTrigger, ghlTransferHumanWebhook,
  ghlTransferHumanFetch, ghlTransferHumanSelect, ghlTransferHumanSave, ghlTransferHumanPublish,
  ghlSetCredentialsList, ghlSetCredentialsFields, ghlSetCredentialsSave,
  ghlSaveReplyList, ghlSaveReplyTrigger, ghlSaveReplyWebhook, ghlSaveReplyFetchRequests, ghlSaveReplySelectRequest, ghlSaveReplyPublish, ghlGenerateReplySave,
  ghlSendReplyList, ghlSendReplyFollowupTimes, ghlSendReplyPublish, ghlSendFollowupsList, ghlSendFollowupsWorkflow, ghlSendFollowupsTimes,
  // Twilio Setup images
  ghlPhoneSystemAddNumber, twilioActiveNumbers, twilioA2pMessaging, twilioA2pRegistration, twilioCampaignRegistration
];

// Screenshot placeholders - add actual images to src/assets/setup-guide/ when available
const ImagePlaceholder = ({ alt }: { alt: string }) => (
  <div className="border rounded-lg bg-muted/50 p-8 text-center text-muted-foreground">
    <p className="text-sm">[Screenshot: {alt}]</p>
  </div>
);

// Pulsating credential field component for fields users need to COPY
// Shows BLUE pulsing when value is available (configured), RED pulsing when not configured
const PulsatingCredentialField = ({ 
  label, 
  value, 
  onCopy, 
  isPassword = false 
}: { 
  label: string; 
  value: string; 
  onCopy: () => void;
  isPassword?: boolean;
}) => {
  const isConfigured = !!value && value.trim() !== '';
  
  return (
    <div className={cn(
      "space-y-2 rounded-lg p-4 border-2",
      isConfigured 
        ? "animate-pulse-blue border-blue-500/50 bg-blue-500/5" 
        : "animate-pulse-red border-red-500/50 bg-red-500/5"
    )}>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        {!isConfigured && (
          <Badge className="bg-red-500 hover:bg-red-600 text-white">
            Setup Required
          </Badge>
        )}
      </div>
      <Input 
        type={isPassword ? "password" : "text"}
        value={isConfigured ? value : ''}
        readOnly
        placeholder={isConfigured ? '' : 'Not Configured'}
        className="font-mono text-sm bg-background"
      />
      <div className="flex gap-2 pt-2">
        <Button
          onClick={onCopy}
          disabled={!isConfigured}
          size="sm"
          className={cn(
            isConfigured 
              ? "bg-blue-500 hover:bg-blue-600 text-white font-medium shadow-lg shadow-blue-500/50 animate-pulse-bright-blue"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          <Copy className="w-4 h-4 mr-1" />
          Copy
        </Button>
      </div>
    </div>
  );
};

// Credential INPUT field - pulsates red when empty, static green when configured
const CredentialInputField = ({ 
  label, 
  value, 
  isConfigured,
  isPassword = false,
  showToggle = false,
  showPassword,
  onTogglePassword
}: { 
  label: string; 
  value: string;
  isConfigured: boolean;
  isPassword?: boolean;
  showToggle?: boolean;
  showPassword?: boolean;
  onTogglePassword?: () => void;
}) => (
  <div className={cn(
    "space-y-2 rounded-lg p-4 border-2",
    isConfigured 
      ? "border-green-500 bg-green-500/10" 
      : "animate-pulse-red border-red-500/50 bg-red-500/5"
  )}>
    <div className="flex items-center justify-between">
      <Label className="text-sm font-medium">{label}</Label>
      {isConfigured && (
        <Badge className="bg-success/20 text-foreground border border-foreground hover:bg-success/20">
          Configured
        </Badge>
      )}
    </div>
    <div className="relative">
      <Input 
        type={isPassword && !showPassword ? "password" : "text"}
        value={value || ''}
        readOnly
        placeholder={isConfigured ? '' : 'Not configured yet'}
        className={cn("font-mono text-sm", showToggle && "pr-10")}
      />
      {showToggle && onTogglePassword && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 hover:bg-transparent"
          onClick={onTogglePassword}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      )}
    </div>
  </div>
);

// Optimized image component with lazy loading, smooth fade-in, and click-to-zoom
import { ZoomableImage } from '@/components/ui/zoomable-image';

const SmoothImage = ({ src, alt }: { src: string; alt: string }) => (
  <ZoomableImage src={src} alt={alt} maxHeight="auto" />
);

interface SetupStep {
  id: string;
  title: string;
  description: string;
  content: React.ReactNode;
  optional?: boolean;
}

interface SetupStage {
  id: string;
  title: string;
  description: string;
  steps: SetupStep[];
}

interface SetupGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  initialPhase?: number;
  initialStep?: number;
  navigationKey?: number;
  phaseFilter?: (keyof typeof SETUP_PHASES)[];
  dialogTitle?: string;
}

const SetupGuideDialog: React.FC<SetupGuideDialogProps> = ({ open, onOpenChange, clientId, initialPhase = 0, initialStep = 0, navigationKey = 0, phaseFilter, dialogTitle = 'AI Reps Setup Guide' }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStage, setCurrentStage] = useState(initialPhase);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set([initialPhase]));
  const [logicNavState, setLogicNavState] = useState<QuizNavigationState | null>(null);
  const [hasNavigatedFromProps, setHasNavigatedFromProps] = useState(false);
  const [supabaseConfig, setSupabaseConfig] = useState({
    supabase_url: '',
    supabase_service_key: ''
  });
  const [llmConfig, setLlmConfig] = useState({
    openrouter_api_key: '',
    openai_api_key: ''
  });
  const [ghlConfig, setGhlConfig] = useState({
    ghl_api_key: '',
    ghl_assignee_id: '',
    ghl_calendar_id: '',
    ghl_location_id: ''
  });
  // Track what's actually saved in the database (not just typed)
  const [savedSupabaseConfig, setSavedSupabaseConfig] = useState({
    supabase_url: '',
    supabase_service_key: ''
  });
  const [savedLlmConfig, setSavedLlmConfig] = useState({
    openrouter_api_key: '',
    openai_api_key: ''
  });
  const [savedGhlConfig, setSavedGhlConfig] = useState({
    ghl_api_key: '',
    ghl_assignee_id: '',
    ghl_calendar_id: '',
    ghl_location_id: ''
  });
  const [savedRetellConfig, setSavedRetellConfig] = useState({
    retell_api_key: '',
    retell_inbound_agent_id: '',
    retell_outbound_agent_id: '',
    retell_phone_1: '',
    retell_phone_2: '',
    retell_phone_3: ''
  });
  const [retellConfig, setRetellConfig] = useState({
    retell_api_key: '',
    retell_inbound_agent_id: '',
    retell_outbound_agent_id: '',
    retell_phone_1: '',
    retell_phone_1_country_code: '+1',
    retell_phone_2: '',
    retell_phone_2_country_code: '+1',
    retell_phone_3: '',
    retell_phone_3_country_code: '+1'
  });
  // Only show/hide for sensitive API keys
  const [showServiceKey, setShowServiceKey] = useState(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showGHLApiKey, setShowGHLApiKey] = useState(false);
  const [showRetellApiKey, setShowRetellApiKey] = useState(false);
const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true); // Track if initial config is loading
  const [transferHumanWebhookUrl, setTransferHumanWebhookUrl] = useState('');
  const [transferHumanWebhookSaved, setTransferHumanWebhookSaved] = useState(false);
  const [userDetailsWebhookUrl, setUserDetailsWebhookUrl] = useState('');
  const [userDetailsWebhookSaved, setUserDetailsWebhookSaved] = useState(false);
  const [pipelineWebhookUrl, setPipelineWebhookUrl] = useState('');
  const [pipelineWebhookSaved, setPipelineWebhookSaved] = useState(false);
  const [leadScoreWebhookUrl, setLeadScoreWebhookUrl] = useState('');
  const [leadScoreWebhookSaved, setLeadScoreWebhookSaved] = useState(false);
  const [callReceivedWebhookUrl, setCallReceivedWebhookUrl] = useState('');
  const [callReceivedWebhookSent, setCallReceivedWebhookSent] = useState(false);
  const [sendingCallReceivedPayload, setSendingCallReceivedPayload] = useState(false);
  const [knowledgebaseWebhook, setKnowledgebaseWebhook] = useState('');
  const [knowledgebaseWebhookSaved, setKnowledgebaseWebhookSaved] = useState(false);
  const [saveReplyWebhookUrl, setSaveReplyWebhookUrl] = useState('');
  const [saveReplyWebhookSaved, setSaveReplyWebhookSaved] = useState(false);
  const [outboundCallerWebhook1, setOutboundCallerWebhook1] = useState('');
  const [outboundCallerWebhook1Saved, setOutboundCallerWebhook1Saved] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  
  // Track which fields have been saved in this session (for button styling)
  const [savedFields, setSavedFields] = useState<Set<string>>(new Set());
  
  // Prompt setup state
  const [botPersonaPrompt, setBotPersonaPrompt] = useState({
    name: '',
    content: '',
    description: ''
  });
  const [botPersonaSaving, setBotPersonaSaving] = useState(false);
  const [botPersonaSaved, setBotPersonaSaved] = useState(false);
  
  // Text Engine prompts (1, 2, 3)
  const [prompt1, setPrompt1] = useState({ name: '', content: '', description: '' });
  const [prompt1Saving, setPrompt1Saving] = useState(false);
  const [prompt1Saved, setPrompt1Saved] = useState(false);
  
  const [prompt2, setPrompt2] = useState({ name: '', content: '', description: '' });
  const [prompt2Saving, setPrompt2Saving] = useState(false);
  const [prompt2Saved, setPrompt2Saved] = useState(false);
  
  const [prompt3, setPrompt3] = useState({ name: '', content: '', description: '' });
  const [prompt3Saving, setPrompt3Saving] = useState(false);
  const [prompt3Saved, setPrompt3Saved] = useState(false);
  
  // Booking prompts (7, 8)
  const [prompt7, setPrompt7] = useState({ name: '', content: '', description: '' });
  const [prompt7Saving, setPrompt7Saving] = useState(false);
  const [prompt7Saved, setPrompt7Saved] = useState(false);
  
  const [prompt8, setPrompt8] = useState({ name: '', content: '', description: '' });
  const [prompt8Saving, setPrompt8Saving] = useState(false);
  const [prompt8Saved, setPrompt8Saved] = useState(false);
  
  // Voice prompts: Persona (0), Main Agent (1,2), Booking (5)
  const [voicePrompt0, setVoicePrompt0] = useState({ name: '', content: '', description: '' });
  const [voicePrompt0Saving, setVoicePrompt0Saving] = useState(false);
  const [voicePrompt0Saved, setVoicePrompt0Saved] = useState(false);
  
  const [voicePrompt1, setVoicePrompt1] = useState({ name: '', content: '', description: '' });
  const [voicePrompt1Saving, setVoicePrompt1Saving] = useState(false);
  const [voicePrompt1Saved, setVoicePrompt1Saved] = useState(false);
  
  const [voicePrompt2, setVoicePrompt2] = useState({ name: '', content: '', description: '' });
  const [voicePrompt2Saving, setVoicePrompt2Saving] = useState(false);
  const [voicePrompt2Saved, setVoicePrompt2Saved] = useState(false);
  
  const [voicePrompt5, setVoicePrompt5] = useState({ name: '', content: '', description: '' });
  const [voicePrompt5Saving, setVoicePrompt5Saving] = useState(false);
  const [voicePrompt5Saved, setVoicePrompt5Saved] = useState(false);
  
  // Client's configured prompt webhook URL (fetched from DB)
  const [clientPromptWebhookUrl, setClientPromptWebhookUrl] = useState<string | null>(null);

  // Country code options - same as API Setup
  const countryCodeOptions = [
    { value: '+1', label: '+1 (US)' },
    { value: '+44', label: '+44 (UK)' },
    { value: '+91', label: '+91 (IN)' },
    { value: '+61', label: '+61 (AU)' },
    { value: '+81', label: '+81 (JP)' },
    { value: '+86', label: '+86 (CN)' },
    { value: '+49', label: '+49 (DE)' },
    { value: '+33', label: '+33 (FR)' },
    { value: '+39', label: '+39 (IT)' },
    { value: '+34', label: '+34 (ES)' },
    { value: '+55', label: '+55 (BR)' },
    { value: '+52', label: '+52 (MX)' },
    { value: '+7', label: '+7 (RU)' },
    { value: '+27', label: '+27 (ZA)' },
    { value: '+82', label: '+82 (KR)' }
  ];

// Load Supabase, LLM, HighLevel and Retell config when dialog opens
  useEffect(() => {
    if (clientId && open) {
      setConfigLoading(true); // Start loading
      const loadConfig = async () => {
        const { data, error } = await (supabase
          .from('clients')
          .select('supabase_url, supabase_service_key, openrouter_api_key, openai_api_key, ghl_api_key, ghl_assignee_id, ghl_calendar_id, ghl_location_id, retell_api_key, retell_inbound_agent_id, retell_outbound_agent_id, retell_phone_1, retell_phone_1_country_code, retell_phone_2, retell_phone_2_country_code, retell_phone_3, retell_phone_3_country_code, transfer_to_human_webhook_url, user_details_webhook_url, update_pipeline_webhook_url, lead_score_webhook_url, knowledge_base_add_webhook_url, save_reply_webhook_url, outbound_caller_webhook_1_url, setup_guide_completed_steps, prompt_webhook_url') as any)
          .eq('id', clientId)
          .single();
        
        if (data) {
          const supabaseData = {
            supabase_url: data.supabase_url || '',
            supabase_service_key: data.supabase_service_key || ''
          };
          setSupabaseConfig(supabaseData);
          setSavedSupabaseConfig(supabaseData);
          
          const llmData = {
            openrouter_api_key: data.openrouter_api_key || '',
            openai_api_key: data.openai_api_key || ''
          };
          setLlmConfig(llmData);
          setSavedLlmConfig(llmData);
          
          const ghlData = {
            ghl_api_key: data.ghl_api_key || '',
            ghl_assignee_id: data.ghl_assignee_id || '',
            ghl_calendar_id: data.ghl_calendar_id || '',
            ghl_location_id: data.ghl_location_id || ''
          };
          setGhlConfig(ghlData);
          setSavedGhlConfig(ghlData);
          
          const retellData = {
            retell_api_key: data.retell_api_key || '',
            retell_inbound_agent_id: data.retell_inbound_agent_id || '',
            retell_outbound_agent_id: data.retell_outbound_agent_id || '',
            retell_phone_1: data.retell_phone_1 || '',
            retell_phone_1_country_code: data.retell_phone_1_country_code || '+1',
            retell_phone_2: data.retell_phone_2 || '',
            retell_phone_2_country_code: data.retell_phone_2_country_code || '+1',
            retell_phone_3: data.retell_phone_3 || '',
            retell_phone_3_country_code: data.retell_phone_3_country_code || '+1'
          };
          setRetellConfig(retellData);
          setSavedRetellConfig({
            retell_api_key: retellData.retell_api_key,
            retell_inbound_agent_id: retellData.retell_inbound_agent_id,
            retell_outbound_agent_id: retellData.retell_outbound_agent_id,
            retell_phone_1: retellData.retell_phone_1,
            retell_phone_2: retellData.retell_phone_2,
            retell_phone_3: retellData.retell_phone_3
          });
          
          setTransferHumanWebhookUrl(data.transfer_to_human_webhook_url || '');
          setTransferHumanWebhookSaved(!!data.transfer_to_human_webhook_url);
          setUserDetailsWebhookUrl(data.user_details_webhook_url || '');
          setUserDetailsWebhookSaved(!!data.user_details_webhook_url);
          setPipelineWebhookUrl(data.update_pipeline_webhook_url || '');
          setPipelineWebhookSaved(!!data.update_pipeline_webhook_url);
          setLeadScoreWebhookUrl(data.lead_score_webhook_url || '');
          setLeadScoreWebhookSaved(!!data.lead_score_webhook_url);
          setKnowledgebaseWebhook(data.knowledge_base_add_webhook_url || '');
          setKnowledgebaseWebhookSaved(!!data.knowledge_base_add_webhook_url);
          setSaveReplyWebhookUrl(data.save_reply_webhook_url || '');
          setSaveReplyWebhookSaved(!!data.save_reply_webhook_url);
          setOutboundCallerWebhook1(data.outbound_caller_webhook_1_url || '');
          setOutboundCallerWebhook1Saved(!!data.outbound_caller_webhook_1_url);
          setClientPromptWebhookUrl(data.prompt_webhook_url || null);
          
          // Load call finished webhook from localStorage
          try {
            const savedCallReceivedWebhook = localStorage.getItem(`call_received_webhook_${clientId}`);
            if (savedCallReceivedWebhook) {
              const parsed = JSON.parse(savedCallReceivedWebhook);
              setCallReceivedWebhookUrl(parsed.url || '');
              setCallReceivedWebhookSent(parsed.sent || false);
            }
          } catch (e) {
            console.error('Failed to load call finished webhook from localStorage:', e);
          }
          
          // Load completed steps from database first
          const savedSteps = data.setup_guide_completed_steps || [];
          const newCompleted = new Set<string>(Array.isArray(savedSteps) ? savedSteps : []);
          
          // User must manually click Done button to mark steps as complete
          // No auto-marking based on saved data - only load what user explicitly marked
          setCompletedSteps(newCompleted);
        }
        
        // Load all prompts (bot-persona, text-1, text-2, text-3, booking-1, booking-2, voice-0, voice-1, voice-2, voice-5)
        const { data: allPrompts } = await supabase
          .from('prompts')
          .select('*')
          .eq('client_id', clientId)
          .in('slot_id', ['bot-persona', 'text-1', 'text-2', 'text-3', 'booking-1', 'booking-2', 'voice-persona', 'voice-1', 'voice-2', 'voice-5']);
        
        // Track which slot_ids were found in DB
        const foundSlotIds = new Set<string>();
        
        if (allPrompts && allPrompts.length > 0) {
          allPrompts.forEach(promptData => {
            const slotId = promptData.slot_id;
            if (slotId) foundSlotIds.add(slotId);
            
            const promptState = {
              name: promptData.name || '',
              content: promptData.content || '',
              description: promptData.description || ''
            };
            
            if (slotId === 'bot-persona') {
              setBotPersonaPrompt(promptState);
              setBotPersonaSaved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'text-1') {
              setPrompt1(promptState);
              setPrompt1Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'text-2') {
              setPrompt2(promptState);
              setPrompt2Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'text-3') {
              setPrompt3(promptState);
              setPrompt3Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'booking-1') {
              setPrompt7(promptState);
              setPrompt7Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'booking-2') {
              setPrompt8(promptState);
              setPrompt8Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'voice-persona') {
              setVoicePrompt0(promptState);
              setVoicePrompt0Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'voice-1') {
              setVoicePrompt1(promptState);
              setVoicePrompt1Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'voice-2') {
              setVoicePrompt2(promptState);
              setVoicePrompt2Saved(true);
              // User must manually click Done button to mark step as complete
            } else if (slotId === 'voice-5') {
              setVoicePrompt5(promptState);
              setVoicePrompt5Saved(true);
              // User must manually click Done button to mark step as complete
            }
          });
        }
        
        // For any slots NOT found in DB, prefill with default templates (but don't mark as saved)
        // This ensures Setup Guide shows the same defaults as Prompt Management
        const slotSetterMap: Record<string, (state: { name: string; content: string; description: string }) => void> = {
          'bot-persona': setBotPersonaPrompt,
          'text-1': setPrompt1,
          'text-2': setPrompt2,
          'text-3': setPrompt3,
          'booking-1': setPrompt7,
          'booking-2': setPrompt8,
          'voice-persona': setVoicePrompt0,
          'voice-1': setVoicePrompt1,
          'voice-2': setVoicePrompt2,
          'voice-5': setVoicePrompt5
        };
        
        Object.keys(slotSetterMap).forEach(slotId => {
          if (!foundSlotIds.has(slotId)) {
            const defaultPrompt = getDefaultPromptForSlot(slotId);
            if (defaultPrompt) {
              slotSetterMap[slotId](defaultPrompt);
              // Do NOT mark as saved - user needs to click Done to save
            }
          }
        });
        
        setConfigLoading(false); // Done loading
      };
      loadConfig();
    } else if (!open) {
      // Reset loading state when dialog closes
      setConfigLoading(true);
    }
  }, [clientId, open]);
  
  // NOTE: Completed steps are saved to database via the debounced saveToDatabase mechanism
  // defined around line 10580. The refs (isSavingRef, pendingStepsRef, saveTimeoutRef)
  // are declared there along with the save logic. This ensures:
  // 1. Debounced saves (300ms) to avoid excessive database calls
  // 2. Race condition protection via refs
  // 3. Force-save when dialog closes
  // The old save mechanism has been removed to prevent duplicate/conflicting saves.

  // Preload only first few critical images when dialog opens for faster initial load
  useEffect(() => {
    if (open) {
      // Only preload first 3 images to speed up initial load
      ALL_IMAGES.slice(0, 3).forEach(src => {
        const img = new Image();
        img.src = src;
      });
    }
  }, [open]);

  // Update position when initialPhase/initialStep change and dialog opens
  // COPIED EXACTLY FROM WebinarSetupGuideDialog
  useEffect(() => {
    if (open && navigationKey > 0) {
      // User clicked a specific phase card - always navigate to that phase
      setCurrentStage(initialPhase);
      setCurrentStep(initialStep);
      setExpandedStages(new Set([initialPhase]));
      setHasNavigatedFromProps(true);
    } else if (open && (initialPhase !== 0 || initialStep !== 0)) {
      // User clicked a specific phase - use those values
      setCurrentStage(initialPhase);
      setCurrentStep(initialStep);
      setExpandedStages(new Set([initialPhase]));
      setHasNavigatedFromProps(true);
    } else if (open && !hasNavigatedFromProps) {
      // Dialog opened without specific phase - will be handled by localStorage effect
      setHasNavigatedFromProps(false);
    }
  }, [open, initialPhase, initialStep, navigationKey]);

  // Reset navigation flag when dialog closes
  useEffect(() => {
    if (!open) {
      setHasNavigatedFromProps(false);
    }
  }, [open]);




  // Helper to check if Supabase credentials are configured
  const hasSupabaseCredentials = (overrideField?: string, overrideValue?: string) => {
    const url = overrideField === 'supabase_url' ? overrideValue : supabaseConfig.supabase_url;
    const key = overrideField === 'supabase_service_key' ? overrideValue : supabaseConfig.supabase_service_key;
    return !!(url && key);
  };

  const saveSupabaseField = async (field: 'supabase_url' | 'supabase_service_key', value: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ [field]: value })
        .eq('id', clientId);

      if (error) throw error;

      toast({
        title: "Saved",
        description: `${field === 'supabase_url' ? 'Project URL' : 'Service Key'} saved successfully`
      });

      setSupabaseConfig(prev => ({ ...prev, [field]: value }));
      setSavedSupabaseConfig(prev => ({ ...prev, [field]: value }));
      setSavedFields(prev => new Set([...prev, field]));
      
      // User must manually click Done button to mark step as complete
      


    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const saveLlmField = async (field: 'openrouter_api_key' | 'openai_api_key', value: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ [field]: value })
        .eq('id', clientId);

      if (error) throw error;

      toast({
        title: "Saved",
        description: `${field === 'openrouter_api_key' ? 'OpenRouter API Key' : 'OpenAI API Key'} saved successfully`
      });

      setLlmConfig(prev => ({ ...prev, [field]: value }));
      setSavedLlmConfig(prev => ({ ...prev, [field]: value }));
      setSavedFields(prev => new Set([...prev, field]));
      
      // User must manually click Done button to mark step as complete
      


    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const saveGhlField = async (field: 'ghl_api_key' | 'ghl_assignee_id' | 'ghl_calendar_id' | 'ghl_location_id', value: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ [field]: value })
        .eq('id', clientId);

      if (error) throw error;

      const fieldNames = {
        'ghl_api_key': 'API Key',
        'ghl_assignee_id': 'Assignee ID',
        'ghl_calendar_id': 'Calendar ID',
        'ghl_location_id': 'Location ID'
      };

      toast({
        title: "Saved",
        description: `${fieldNames[field]} saved successfully`
      });

      setGhlConfig(prev => ({ ...prev, [field]: value }));
      setSavedGhlConfig(prev => ({ ...prev, [field]: value }));
      setSavedFields(prev => new Set([...prev, field]));
      
      // User must manually click Done button to mark step as complete
      


    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const saveRetellField = async (field: 'retell_api_key' | 'retell_inbound_agent_id' | 'retell_outbound_agent_id' | 'retell_phone_1' | 'retell_phone_2' | 'retell_phone_3', value: string, countryCode?: string) => {
    setLoading(true);
    try {
      const updateData: Record<string, string> = { [field]: value };
      
      // If saving a phone field and country code is provided, save it too
      if (countryCode && field.startsWith('retell_phone_')) {
        const countryCodeField = `${field}_country_code`;
        updateData[countryCodeField] = countryCode;
      }
      
      const { error } = await supabase
        .from('clients')
        .update(updateData)
        .eq('id', clientId);

      if (error) throw error;

      const fieldNames: Record<string, string> = {
        'retell_api_key': 'API Key',
        'retell_inbound_agent_id': 'Inbound Agent ID',
        'retell_outbound_agent_id': 'Outbound Agent ID',
        'retell_phone_1': 'Phone Number 1',
        'retell_phone_2': 'Phone Number 2',
        'retell_phone_3': 'Phone Number 3'
      };

      toast({
        title: "Saved",
        description: `${fieldNames[field]} saved successfully`
      });

      setRetellConfig(prev => ({ ...prev, [field]: value }));
      // Update saved config for the appropriate field
      if (field === 'retell_api_key' || field === 'retell_inbound_agent_id' || field === 'retell_outbound_agent_id' || field === 'retell_phone_1' || field === 'retell_phone_2' || field === 'retell_phone_3') {
        setSavedRetellConfig(prev => ({ ...prev, [field]: value }));
      }
      setSavedFields(prev => new Set([...prev, field]));
      
      // User must manually click Done button to mark step as complete
      


    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const saveTransferHumanWebhook = async (webhookUrl: string) => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(webhookUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSavingWebhook(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ transfer_to_human_webhook_url: webhookUrl })
        .eq('id', clientId);

      if (error) throw error;

      // Send test payload to webhook
      try {
        const testPayload = {
          type: 'transfer_to_human_webhook_test',
          timestamp: new Date().toISOString(),
          client_id: clientId,
          test: true,
          message: 'Transfer to Human webhook configured successfully',
          sample_data: {
            contact_id: 'test_contact_123',
            phone: '+1234567890',
            reason: 'Customer requested human agent'
          }
        };
        
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });
      } catch (webhookError) {
        console.error('Error sending test to webhook:', webhookError);
        // Don't fail the save, just log
      }




      toast({
        title: "Saved",
        description: "Transfer to Human webhook saved and payload sent to Supabase"
      });

      setTransferHumanWebhookUrl(webhookUrl);
      setTransferHumanWebhookSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook",
        variant: "destructive"
      });
    } finally {
      setSavingWebhook(false);
    }
  };

  const saveSaveReplyWebhook = async (webhookUrl: string) => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(webhookUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSavingWebhook(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ save_reply_webhook_url: webhookUrl })
        .eq('id', clientId);

      if (error) throw error;

      // Send test payload to webhook
      try {
        const testPayload = {
          type: 'save_reply_webhook_test',
          timestamp: new Date().toISOString(),
          client_id: clientId,
          test: true,
          message: 'Save Reply webhook configured successfully',
          sample_data: {
            contact_id: 'test_contact_123',
            message: 'Test AI reply message',
            channel: 'sms'
          }
        };
        
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });
      } catch (webhookError) {
        console.error('Error sending test to webhook:', webhookError);
        // Don't fail the save, just log
      }




      toast({
        title: "Saved",
        description: "Save Reply webhook saved and payload sent to Supabase"
      });

      setSaveReplyWebhookUrl(webhookUrl);
      setSaveReplyWebhookSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook",
        variant: "destructive"
      });
    } finally {
      setSavingWebhook(false);
    }
  };

  const saveUserDetailsWebhook = async (webhookUrl: string) => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(webhookUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSavingWebhook(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ user_details_webhook_url: webhookUrl })
        .eq('id', clientId);

      if (error) throw error;

      // Send test payload to webhook
      try {
        const testPayload = {
          type: 'user_details_webhook_test',
          timestamp: new Date().toISOString(),
          client_id: clientId,
          test: true,
          message: 'User Details webhook configured successfully',
          sample_data: {
            contact_id: 'test_contact_123',
            first_name: 'Test',
            last_name: 'User',
            email: 'test@example.com'
          }
        };
        
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });
      } catch (webhookError) {
        console.error('Error sending test to webhook:', webhookError);
        // Don't fail the save, just log
      }




      toast({
        title: "Saved",
        description: "User Details webhook saved and payload sent to Supabase"
      });

      setUserDetailsWebhookUrl(webhookUrl);
      setUserDetailsWebhookSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook",
        variant: "destructive"
      });
    } finally {
      setSavingWebhook(false);
    }
  };

  const savePipelineWebhook = async (webhookUrl: string) => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(webhookUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSavingWebhook(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ update_pipeline_webhook_url: webhookUrl })
        .eq('id', clientId);

      if (error) throw error;

      // Send test payload to webhook
      try {
        const testPayload = {
          type: 'pipeline_webhook_test',
          timestamp: new Date().toISOString(),
          client_id: clientId,
          test: true,
          message: 'Pipeline Update webhook configured successfully',
          sample_data: {
            contact_id: 'test_contact_123',
            pipeline_stage: 'New Lead',
            previous_stage: 'None'
          }
        };
        
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });
      } catch (webhookError) {
        console.error('Error sending test to webhook:', webhookError);
        // Don't fail the save, just log
      }




      toast({
        title: "Saved",
        description: "Pipeline Update webhook saved and payload sent to Supabase"
      });

      setPipelineWebhookUrl(webhookUrl);
      setPipelineWebhookSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook",
        variant: "destructive"
      });
    } finally {
      setSavingWebhook(false);
    }
  };

  const saveLeadScoreWebhook = async (webhookUrl: string) => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(webhookUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSavingWebhook(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ lead_score_webhook_url: webhookUrl })
        .eq('id', clientId);

      if (error) throw error;

      // Send test payload to webhook
      try {
        const testPayload = {
          type: 'lead_score_webhook_test',
          timestamp: new Date().toISOString(),
          client_id: clientId,
          test: true,
          message: 'Lead Score webhook configured successfully',
          sample_data: {
            contact_id: 'test_contact_123',
            lead_score: 85,
            previous_score: 0
          }
        };
        
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });
      } catch (webhookError) {
        console.error('Error sending test to webhook:', webhookError);
        // Don't fail the save, just log
      }




      toast({
        title: "Saved",
        description: "Lead Score webhook saved and payload sent to Supabase"
      });

      setLeadScoreWebhookUrl(webhookUrl);
      setLeadScoreWebhookSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook",
        variant: "destructive"
      });
    } finally {
      setSavingWebhook(false);
    }
  };

  const saveOutboundCallerWebhook = async (webhookUrl: string) => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(webhookUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSavingWebhook(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ outbound_caller_webhook_1_url: webhookUrl })
        .eq('id', clientId);

      if (error) throw error;




      toast({
        title: "Saved",
        description: "Outbound Caller Webhook saved successfully"
      });

      setOutboundCallerWebhook1(webhookUrl);
      setOutboundCallerWebhook1Saved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook",
        variant: "destructive"
      });
    } finally {
      setSavingWebhook(false);
    }
  };

  const saveKnowledgebaseWebhook = async () => {
    if (!knowledgebaseWebhook.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(knowledgebaseWebhook);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSavingWebhook(true);
    try {
      // Update BOTH add and delete webhook columns (same as ApiManagement)
      const { error } = await supabase
        .from('clients')
        .update({ 
          knowledge_base_add_webhook_url: knowledgebaseWebhook,
          knowledge_base_delete_webhook_url: knowledgebaseWebhook
        })
        .eq('id', clientId);

      if (error) throw error;

      // Send test payload to the webhook
      try {
        const testPayload = {
          type: 'knowledge_base_webhook_test',
          timestamp: new Date().toISOString(),
          client_id: clientId,
          test: true,
          message: 'Knowledgebase webhook configured successfully'
        };
        await fetch(knowledgebaseWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });
      } catch (webhookError) {
        console.error('Error sending test to webhook:', webhookError);
      }




      toast({
        title: "Saved",
        description: "Knowledgebase webhook saved and payload sent to Supabase"
      });

      setKnowledgebaseWebhookSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save webhook",
        variant: "destructive"
      });
    } finally {
      setSavingWebhook(false);
    }
  };

  // Default prompt-management webhook URL. Per-client overrides via
  // clients.prompt_webhook_url; default via VITE_SETUP_GUIDE_PROMPT_WEBHOOK_URL
  // env var (empty if unset). Hardcoded upstream URL removed in N5 2026-05-19.
  const DEFAULT_PROMPT_WEBHOOK_URL = (import.meta.env.VITE_SETUP_GUIDE_PROMPT_WEBHOOK_URL as string | undefined) ?? '';
  
  // Get the webhook URL to use (client's configured one or fallback to default)
  const getPromptWebhookUrl = () => clientPromptWebhookUrl || DEFAULT_PROMPT_WEBHOOK_URL;

  // Helper to map slotId to staticName and numericId (same logic as PromptManagement)
  const getSlotInfo = (slotId?: string | null) => {
    if (!slotId) return { staticName: '', numericId: '' };
    if (slotId === STATIC_PROMPTS.voicePersona.id) {
      const staticName = STATIC_PROMPTS.voicePersona.staticName;
      const match = staticName.match(/Prompt-(\d+)/);
      return { staticName, numericId: match ? match[1] : '' };
    }
    const all = [...STATIC_PROMPTS.textAgents, ...STATIC_PROMPTS.voiceAgents];
    const found = all.find(s => s.id === slotId);
    const staticName = found?.staticName || '';
    const numericId = staticName.match(/(?:Agent-|Prompt-)(\d+)/)?.[1] || '';
    return { staticName, numericId };
  };

  // Determine prompt_type based on slotId (same logic as PromptManagement)
  const getPromptType = (slotId?: string | null): 'text' | 'voice' => {
    if (!slotId) return 'text';
    if (slotId === 'voice-persona' || slotId.startsWith('voice-')) return 'voice';
    return 'text'; // bot-persona, text-*, booking-* are all text type
  };

  // Send webhook notification with full payload matching PromptManagement exactly
  const sendPromptWebhookNotification = async (data: {
    title: string;
    content: string;
    description?: string;
    webhookUrl: string;
    action: 'created' | 'updated';
    slotId: string;
  }) => {
    try {
      console.log('🚀 Sending webhook notification to:', data.webhookUrl);

      // Convert HTML to clean markdown with proper formatting and spacing
      const markdownContent = preserveMarkdownFormatting(data.content);

      // Fetch Supabase configuration for the client (account-specific) - CRITICAL FOR BACKEND LOGIC
      const { data: clientData } = await supabase
        .from('clients')
        .select('supabase_url, supabase_service_key, supabase_table_name')
        .eq('id', clientId)
        .maybeSingle();

      // Get card name and numeric ID from slot (centralized)
      const { staticName: cardName, numericId } = getSlotInfo(data.slotId);

      const payload = {
        id: numericId || '',
        cardName: cardName || '',
        title: data.title,
        description: data.description || '',
        content: markdownContent,
        format: 'markdown',
        action: data.action,
        prompt_type: getPromptType(data.slotId),
        timestamp: new Date().toISOString(),
        clientId: clientId,
        supabase_url: clientData?.supabase_url || null,
        supabase_service_key: clientData?.supabase_service_key || null,
        supabase_table_name: clientData?.supabase_table_name || null
      };

      // Send via Edge Function to avoid CORS differences across accounts
      const { data: result, error: fnError } = await supabase.functions.invoke('notify-webhook', {
        body: {
          url: data.webhookUrl,
          payload
        }
      });

      if (fnError) {
        console.warn('❌ Edge function error while sending webhook:', fnError);
        toast({
          title: 'Webhook error',
          description: 'Failed to send webhook notification',
          variant: 'destructive'
        });
        return;
      }

      if (result?.ok) {
        console.log('✅ Webhook notification sent successfully via edge function');
        toast({
          title: 'Webhook sent',
          description: 'Webhook notification sent successfully',
          variant: 'default'
        });
      } else {
        console.warn('❌ Webhook notification failed:', result);
        toast({
          title: 'Webhook failed',
          description: `Webhook failed with status: ${result?.status ?? 'unknown'}`,
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('💥 Error sending webhook notification:', error);
      toast({
        title: 'Webhook error',
        description: 'Failed to send webhook notification',
        variant: 'destructive'
      });
    }
  };

  const saveBotPersonaPrompt = async () => {
    if (!clientId || botPersonaSaving) return;
    
    if (!botPersonaPrompt.name.trim() || !botPersonaPrompt.content.trim()) {
      toast({
        title: "Error",
        description: "Please fill in both prompt name and content",
        variant: "destructive"
      });
      return;
    }

    setBotPersonaSaving(true);
    try {
      // Check if prompt already exists
      const { data: existingPrompt } = await supabase
        .from('prompts')
        .select('id')
        .eq('client_id', clientId)
        .eq('slot_id', 'bot-persona')
        .maybeSingle();

      if (existingPrompt) {
        // Update existing prompt
        const { error } = await supabase
          .from('prompts')
          .update({
            name: botPersonaPrompt.name,
            content: botPersonaPrompt.content,
            description: botPersonaPrompt.description,
            webhook_url: getPromptWebhookUrl(),
            is_active: true,
            category: 'bot_persona'
          })
          .eq('id', existingPrompt.id);

        if (error) throw error;
      } else {
        // Create new prompt
        const { error } = await supabase
          .from('prompts')
          .insert({
            client_id: clientId,
            name: botPersonaPrompt.name,
            content: botPersonaPrompt.content,
            description: botPersonaPrompt.description,
            webhook_url: getPromptWebhookUrl(),
            is_active: true,
            category: 'bot_persona',
            slot_id: 'bot-persona'
          });

        if (error) throw error;
      }

      // Send webhook notification with FULL payload matching PromptManagement
      await sendPromptWebhookNotification({
        title: botPersonaPrompt.name,
        content: botPersonaPrompt.content,
        description: botPersonaPrompt.description,
        webhookUrl: getPromptWebhookUrl(),
        action: existingPrompt ? 'updated' : 'created',
        slotId: 'bot-persona'
      });

      toast({
        title: "Saved",
        description: "Bot Persona prompt saved successfully"
      });

      setBotPersonaSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      console.error('Error saving bot persona prompt:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save prompt",
        variant: "destructive"
      });
    } finally {
      setBotPersonaSaving(false);
    }
  };

  // Generic function to save any numbered prompt
  const saveNumberedPrompt = async (
    slotId: string,
    promptData: { name: string; content: string; description: string },
    setSaving: (v: boolean) => void,
    setSaved: (v: boolean) => void,
    completedStepId: string,
    cardNumber: string
  ) => {
    if (!clientId) return;
    
    if (!promptData.name.trim() || !promptData.content.trim()) {
      toast({
        title: "Error",
        description: "Please fill in both prompt name and content",
        variant: "destructive"
      });
      return;
    }

    setSaving(true);
    try {
      // Check if prompt already exists
      const { data: existingPrompt } = await supabase
        .from('prompts')
        .select('id')
        .eq('client_id', clientId)
        .eq('slot_id', slotId)
        .maybeSingle();

      if (existingPrompt) {
        const { error } = await supabase
          .from('prompts')
          .update({
            name: promptData.name,
            content: promptData.content,
            description: promptData.description,
            webhook_url: getPromptWebhookUrl(),
            is_active: true
          })
          .eq('id', existingPrompt.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('prompts')
          .insert({
            client_id: clientId,
            name: promptData.name,
            content: promptData.content,
            description: promptData.description,
            webhook_url: getPromptWebhookUrl(),
            is_active: true,
            slot_id: slotId
          });

        if (error) throw error;
      }

      // Send webhook notification with FULL payload matching PromptManagement
      await sendPromptWebhookNotification({
        title: promptData.name,
        content: promptData.content,
        description: promptData.description,
        webhookUrl: getPromptWebhookUrl(),
        action: existingPrompt ? 'updated' : 'created',
        slotId: slotId
      });

      toast({
        title: "Saved",
        description: `Prompt ${cardNumber} saved successfully`
      });

      setSaved(true);
      // User must manually click Done button to mark step as complete
    } catch (error: any) {
      console.error('Error saving prompt:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save prompt",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const sendCallReceivedTestPayload = async (webhookUrl: string) => {
    if (!webhookUrl.trim()) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    // Validate URL format
    try {
      const urlObj = new URL(webhookUrl);
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        toast({
          title: "Invalid URL",
          description: "Webhook URL must use HTTP or HTTPS",
          variant: "destructive"
        });
        return;
      }
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid webhook URL",
        variant: "destructive"
      });
      return;
    }

    setSendingCallReceivedPayload(true);
    try {
      // Send test payload to webhook
      const testPayload = {
        type: 'call_received_webhook_test',
        timestamp: new Date().toISOString(),
        client_id: clientId,
        test: true,
        message: 'Call Finished webhook activated for Retell connection',
        sample_data: {
          call_id: 'test_call_123',
          call_type: 'inbound',
          phone_number: '+1234567890',
          agent_id: retellConfig.retell_inbound_agent_id || 'agent_123',
          status: 'connected'
        }
      };
      
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });

      // Save to localStorage
      localStorage.setItem(`call_received_webhook_${clientId}`, JSON.stringify({
        url: webhookUrl,
        sent: true
      }));

      toast({
        title: "Test Payload Sent",
        description: "Test payload was sent to activate the webhook. Now go to HighLevel and click 'Fetch Sample Requests'."
      });

      setCallReceivedWebhookUrl(webhookUrl);
      setCallReceivedWebhookSent(true);
    } catch (error: any) {
      console.error('Error sending test to webhook:', error);
      toast({
        title: "Error",
        description: "Failed to send test payload. Please check the webhook URL.",
        variant: "destructive"
      });
    } finally {
      setSendingCallReceivedPayload(false);
    }
  };

  const stages: SetupStage[] = [
    {
      id: 'account-creation',
      title: 'Accounts Setup',
      description: 'Create all necessary accounts for the system',
      steps: [
    {
      id: 'gohighlevel',
      title: 'Create GoHighLevel Account',
      description: 'Set up your GoHighLevel account for CRM functionality',
      content: (
        <div className="space-y-4">
          <p className="font-medium">You have 2 options for your HighLevel account:</p>
          
          <div className="bg-muted/50 rounded-lg p-4 space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Option 1: Get our HighLevel account</p>
                  <p className="text-muted-foreground">(Recommended for simplicity)</p>
                  <ul className="list-disc list-inside ml-2 mt-2 text-sm text-muted-foreground space-y-1">
                    <li>We act as your provider - you get all the same features</li>
                    <li>No separate payment required for HighLevel</li>
                    <li>Add your own logo and custom CSS to brand it however you want</li>
                    <li>All workflows, pipelines, and dashboards are loaded automatically</li>
                    <li>The only difference: uses app.1prompt.com domain (no custom domain)</li>
                  </ul>
                  <div className="mt-3 p-3 bg-primary/10 rounded-lg">
                    <p className="text-sm">To open a HighLevel account with us, send an email to:</p>
                    <a 
                      href="mailto:support@1prompt.com" 
                      className="text-primary hover:underline font-medium"
                    >
                      support@1prompt.com
                    </a>
                  </div>
                </div>
              </div>
              
              <div className="flex items-start gap-2 pt-2 border-t border-border/50">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Option 2: Use your own HighLevel account</p>
                  <p className="text-muted-foreground">If you already have one or want to get your own</p>
                  <ul className="list-disc list-inside ml-2 mt-2 text-sm text-muted-foreground space-y-1">
                    <li>If you don't have an account yet, you can get the basic plan</li>
                    <li>Go to the <a 
                      href="https://www.skool.com/1prompt/classroom/359c291b?md=829b6d49c6ee44d19354a48bd8b434b9" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Resources page on Skool
                      <ExternalLink className="h-3 w-3" />
                    </a></li>
                    <li>Find the recent <strong>Building Flow Version</strong> snapshot</li>
                    <li>Copy the snapshot link</li>
                    <li>Open the link in the browser where you're logged into HighLevel</li>
                    <li>The snapshot will load all workflows, pipelines, and dashboards to your account</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p>
              <strong>Summary:</strong> With our HighLevel, everything is loaded automatically. With your own account, you'll need to import the snapshot from Skool Resources.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'openai',
      title: 'Create OpenAI Account',
      description: 'Set up your OpenAI account for AI capabilities',
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span>Visit:</span>
            <a 
              href="https://platform.openai.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              platform.openai.com
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">Steps:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Create your OpenAI account</li>
              <li>Navigate to billing section</li>
              <li>Recharge your account for at least <strong>$10</strong></li>
            </ol>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p>
              <strong>Important:</strong> Make sure the balance shows on your account before proceeding to API key generation.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'openai-api-key',
      title: 'OpenAI API Key',
      description: 'Create and configure your OpenAI API key',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Paste your OpenAI API key below to enable AI functionality.</p>
          {/* FIELD AT TOP */}
          <div className={cn(
            "space-y-2 p-4 rounded-lg border-2 relative",
            savedLlmConfig.openai_api_key 
              ? "border-green-500 bg-green-500/10" 
              : "animate-pulse-red border-red-500/50 bg-red-500/5"
          )}>
            <div className="flex items-center justify-between">
              <Label htmlFor="setup-openai-key" className="text-sm font-medium">
                OpenAI API Key
              </Label>
              {savedLlmConfig.openai_api_key && (
                <Badge className="bg-green-500 hover:bg-green-600 text-white">
                  Configured
                </Badge>
              )}
            </div>
            <div className="relative">
              <Input
                id="setup-openai-key"
                type={showOpenAIKey ? "text" : "password"}
                value={llmConfig.openai_api_key}
                onChange={(e) => setLlmConfig(prev => ({ ...prev, openai_api_key: e.target.value }))}
                placeholder="sk-..."
                className="font-mono text-sm pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowOpenAIKey(!showOpenAIKey)}
              >
                {showOpenAIKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => saveLlmField('openai_api_key', llmConfig.openai_api_key)}
                disabled={loading || !llmConfig.openai_api_key}
                size="sm"
                className={savedFields.has('openai_api_key') ? 'bg-green-600 hover:bg-green-700' : ''}
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                ) : savedFields.has('openai_api_key') ? (
                  'Configured'
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>

          {/* DESCRIPTION BELOW */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">How to get your OpenAI API Key:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Visit <a 
                href="https://platform.openai.com/api-keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                OpenAI API Keys
              </a></li>
              <li>Log in to your OpenAI account</li>
              <li>Navigate to the <strong>API keys</strong> section</li>
              <li>Click <strong>+ Create new secret key</strong></li>
              <li>Copy the generated secret key immediately (you won't be able to see it again)</li>
            </ol>
          </div>

          <SmoothImage src={openaiApiKeys} alt="OpenAI API Keys page" />

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p>
              <strong>Important:</strong> Keep your API key secure and never share it publicly. OpenAI will only show the key once during creation.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'openrouter',
      title: 'Create OpenRouter Account',
      description: 'Set up your OpenRouter account for additional AI models',
      content: (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span>Visit:</span>
            <a 
              href="https://openrouter.ai" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              openrouter.ai
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">Steps:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Create your OpenRouter account</li>
              <li>Navigate to billing/credits section</li>
              <li>Recharge your account for at least <strong>$10</strong></li>
            </ol>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p>
              OpenRouter provides access to multiple AI models through a single API, giving you flexibility in model selection.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'openrouter-api-key',
      title: 'OpenRouter API Key',
      description: 'Create and configure your OpenRouter API key',
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Paste your OpenRouter API key below to enable multi-model AI access.</p>
          {/* FIELD AT TOP */}
          <div className={cn(
            "space-y-2 p-4 rounded-lg border-2 relative",
            savedLlmConfig.openrouter_api_key 
              ? "border-green-500 bg-green-500/10" 
              : "animate-pulse-red border-red-500/50 bg-red-500/5"
          )}>
            <div className="flex items-center justify-between">
              <Label htmlFor="setup-openrouter-key" className="text-sm font-medium">
                OpenRouter API Key
              </Label>
              {savedLlmConfig.openrouter_api_key && (
                <Badge className="bg-green-500 hover:bg-green-600 text-white">
                  Configured
                </Badge>
              )}
            </div>
            <div className="relative">
              <Input
                id="setup-openrouter-key"
                type={showOpenRouterKey ? "text" : "password"}
                value={llmConfig.openrouter_api_key}
                onChange={(e) => setLlmConfig(prev => ({ ...prev, openrouter_api_key: e.target.value }))}
                placeholder="sk-or-v1-..."
                className="font-mono text-sm pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
              >
                {showOpenRouterKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => saveLlmField('openrouter_api_key', llmConfig.openrouter_api_key)}
                disabled={loading || !llmConfig.openrouter_api_key}
                size="sm"
                className={savedFields.has('openrouter_api_key') ? 'bg-green-600 hover:bg-green-700' : ''}
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                ) : savedFields.has('openrouter_api_key') ? (
                  'Configured'
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>

          {/* DESCRIPTION BELOW */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium">How to get your OpenRouter API Key:</p>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Visit <a 
                href="https://openrouter.ai/settings/keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                OpenRouter Settings - Keys
              </a></li>
              <li>Go to your account settings</li>
              <li>Navigate to the <strong>Keys</strong> section</li>
              <li>Click <strong>Create API Key</strong></li>
              <li>Copy the generated API key</li>
            </ol>
          </div>

          <SmoothImage src={openrouterApiKeys} alt="OpenRouter API Keys page" />

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p>
              <strong>Note:</strong> OpenRouter provides access to multiple AI models through a single API, giving you flexibility in model selection.
            </p>
          </div>
        </div>
      )
    }
      ]
    },
    {
      id: 'supabase-setup',
      title: 'Supabase Setup',
      description: 'Configure your Supabase project with required tables and functions',
      steps: [
        {
          id: 'create-account',
          title: 'Create Supabase Account',
          description: 'Set up your Supabase account for database functionality',
          content: (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span>Visit:</span>
                <a 
                  href="https://supabase.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  supabase.com
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>

              <p>Click "Start your project" to create a free Supabase account.</p>

              <SmoothImage src={supabaseCreateAccount} alt="Supabase create account page" />
            </div>
          )
        },
        {
          id: 'create-project',
          title: 'Create New Supabase Project',
          description: 'Set up a new project in your Supabase account',
          content: (
            <div className="space-y-4">
              <p>After logging into your Supabase account, create a new project:</p>
              
              <SmoothImage src={supabaseNewProject} alt="Create new Supabase project" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the "New project" button in the top right</li>
                  <li>Choose your organization</li>
                  <li>Enter a project name</li>
                  <li>Continue to the next step to select compute size</li>
                </ol>
              </div>
            </div>
          )
        },
        {
          id: 'select-micro-plan',
          title: 'Choose Micro Plan',
          description: 'Select the Micro compute size to start',
          content: (
            <div className="space-y-4">
              <p>Select the <strong>Micro plan</strong> for your project:</p>
              
              <SmoothImage src={supabaseMicroPlan} alt="Select Micro plan" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Important:</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li>Choose <strong>MICRO</strong> compute size (1 GB RAM / 2-core ARM CPU)</li>
                  <li>Set a strong database password</li>
                  <li>Select the region closest to your users</li>
                  <li>Click "Create new project" when ready</li>
                </ul>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> You can upgrade the compute size later if needed in your project settings.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'run-sql',
          title: 'Run SQL Setup Script',
          description: 'Execute the SQL script to create required tables and functions',
          content: (
            <div className="space-y-4">
              <p>Navigate to the SQL Editor and paste the setup script:</p>
              
              <SmoothImage src={supabaseSqlEditor} alt="SQL Editor location" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on "SQL Editor" in the left sidebar</li>
                  <li>Click "New query"</li>
                  <li>Paste the SQL code below</li>
                  <li>Click "Run" to execute the script</li>
                </ol>
              </div>

              <div className="bg-muted rounded-lg p-4 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium">SQL Setup Script:</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(SETUP_SQL_SCRIPT);
                      toast({
                        title: "Copied!",
                        description: "SQL script copied to clipboard",
                      });
                    }}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Script
                  </Button>
                </div>
                <div className="bg-background rounded p-3 max-h-[200px] overflow-y-auto">
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
{SETUP_SQL_SCRIPT}
                  </pre>
                </div>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 mt-4">
                <p>
                  <strong>Success:</strong> After running this script, you should see "Success. No rows returned" message.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'verify-tables',
          title: 'Verify Tables Created',
          description: 'Confirm that all required tables exist in your database',
          content: (
            <div className="space-y-4">
              <p>Verify that the following tables have been created successfully:</p>

              <SmoothImage src={supabaseTablesCreated} alt="Supabase tables created" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Required Tables:</p>
                <ul className="space-y-2 ml-4">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="font-medium">API_Management</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="font-medium">Call_History</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="font-medium">Documents</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="font-medium">Text_Prompts</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="font-medium">Voice_Prompts</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <p className="font-medium">Webinar_Management</p>
                  </li>
                </ul>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> It might take up to 3 minutes after running the SQL code for the tables to appear. If you don't see them, reload the page.
                </p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> If any tables are missing after reloading, go back to the previous step and re-run the SQL script.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'supabase-project-url',
          title: 'Supabase Project URL',
          description: 'Enter your Supabase project URL from the Data API settings',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your Supabase Project URL below to connect your database.</p>
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedSupabaseConfig.supabase_url 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-supabase-url" className="text-sm font-medium">
                    Supabase Project URL
                  </Label>
                  {savedSupabaseConfig.supabase_url && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-supabase-url"
                  value={supabaseConfig.supabase_url}
                  onChange={(e) => setSupabaseConfig(prev => ({ ...prev, supabase_url: e.target.value }))}
                  placeholder="https://your-project.supabase.co"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveSupabaseField('supabase_url', supabaseConfig.supabase_url)}
                    disabled={loading || !supabaseConfig.supabase_url}
                    size="sm"
                    className={savedFields.has('supabase_url') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('supabase_url') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to find your Project URL:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your Supabase project dashboard</li>
                  <li>Click on <strong>Settings</strong> in the left sidebar</li>
                  <li>Navigate to <strong>Data API</strong></li>
                  <li>Copy the <strong>URL</strong> shown in the Project URL section</li>
                </ol>
              </div>

              <SmoothImage src={supabaseProjectUrl} alt="Supabase Data API settings showing Project URL" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> This URL is used to connect to your Supabase database for storing and retrieving data.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'supabase-service-key',
          title: 'Supabase Service Role Key',
          description: 'Enter your Supabase service role key for backend access',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your Supabase Service Role Key below for backend database access.</p>
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedSupabaseConfig.supabase_service_key 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-supabase-key" className="text-sm font-medium">
                    Supabase Service Role Key
                  </Label>
                  {savedSupabaseConfig.supabase_service_key && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="setup-supabase-key"
                    type={showServiceKey ? "text" : "password"}
                    value={supabaseConfig.supabase_service_key}
                    onChange={(e) => setSupabaseConfig(prev => ({ ...prev, supabase_service_key: e.target.value }))}
                    placeholder="Enter your service role key"
                    className="font-mono text-sm pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowServiceKey(!showServiceKey)}
                  >
                    {showServiceKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveSupabaseField('supabase_service_key', supabaseConfig.supabase_service_key)}
                    disabled={loading || !supabaseConfig.supabase_service_key}
                    size="sm"
                    className={savedFields.has('supabase_service_key') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('supabase_service_key') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to find your Service Role Key:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In your Supabase project, go to <strong>Settings</strong></li>
                  <li>Navigate to <strong>API Keys</strong></li>
                  <li>Under <strong>Legacy anon, service_role API keys</strong></li>
                  <li>Find the <strong>service_role</strong> key with the "secret" badge</li>
                  <li>Click <strong>Reveal</strong> to show the full key</li>
                  <li>Copy the entire key</li>
                </ol>
              </div>

              <SmoothImage src={supabaseServiceKey} alt="Supabase API Keys showing service_role key" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Security Warning:</strong> The service role key has full access to your database. Keep it secure and never share it publicly.
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> Once both fields are configured, your Supabase connection will be active and persistent across the entire system.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'workflows-import',
      title: 'Workflows Import',
      description: 'Download, import, and organize your n8n workflows',
      steps: [
        {
          id: 'download-workflows',
          title: 'Download Workflow Templates',
          description: 'Download all n8n workflow files directly',
          content: (
            <div className="space-y-6">
              {/* n8n Templates Section */}
              <div className="space-y-2">
                <h4 className="text-base font-semibold">n8n Templates</h4>
                <p className="text-sm text-muted-foreground">Download all n8n workflows</p>
              </div>
              
              {/* Visual folder structure */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                {/* Text Engine Folder */}
                <div className="border-b border-border">
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Text Engine</span>
                    <span className="text-xs text-muted-foreground ml-auto">1 Workflow</span>
                  </div>
                  <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Text_Engine.json</span>
                    <a 
                      href="/workflows/text-engine/Text_Engine.json" 
                      download="Text_Engine.json"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </a>
                  </div>
                </div>

                {/* Voice Sales Rep Folder */}
                <div className="border-b border-border">
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Voice Sales Rep</span>
                    <span className="text-xs text-muted-foreground ml-auto">3 Workflows</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Get_Lead_Details.json</span>
                      <a 
                        href="/workflows/voice-sales-rep/Get_Lead_Details.json" 
                        download="Get_Lead_Details.json"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    </div>
                    <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Make_Outbound_Call.json</span>
                      <a 
                        href="/workflows/voice-sales-rep/Make_Outbound_Call.json" 
                        download="Make_Outbound_Call.json"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    </div>
                    <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Appointment_Booking_Functions.json</span>
                      <a 
                        href="/workflows/voice-sales-rep/Appointment_Booking_Functions.json" 
                        download="Appointment_Booking_Functions.json"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    </div>
                  </div>
                </div>

                {/* Knowledgebase Automation Folder */}
                <div className="border-b border-border">
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Knowledgebase Automation</span>
                    <span className="text-xs text-muted-foreground ml-auto">1 Workflow</span>
                  </div>
                  <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Update_Knowledgebase.json</span>
                    <a 
                      href="/workflows/knowledgebase-automation/Update_Knowledgebase.json" 
                      download="Update_Knowledgebase.json"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </a>
                  </div>
                </div>

                {/* Database Reactivation Folder */}
                <div>
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Database Reactivation</span>
                    <span className="text-xs text-muted-foreground ml-auto">1 Workflow</span>
                  </div>
                  <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Launch_Campaign.json</span>
                    <a 
                      href="/workflows/database-reactivation/Launch_Campaign.json" 
                      download="Launch_Campaign.json"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </a>
                  </div>
                </div>
              </div>

            </div>
          )
        },
        {
          id: 'import-workflows',
          title: 'Import Workflows to n8n',
          description: 'Create folders and import workflows into n8n',
          content: (
            <div className="space-y-4">
              <p>First, create the folder structure in n8n, then import each workflow into its folder:</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Create Folders in n8n</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In n8n, go to <strong>Workflows</strong> → <strong>Personal</strong></li>
                  <li>Click <strong>"Create folder in 'Personal'"</strong> or the folder icon</li>
                  <li>Create the following folders with these exact names:
                    <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-sm">
                      <li><strong>Text Engine</strong></li>
                      <li><strong>Voice Sales Rep</strong></li>
                      <li><strong>Knowledgebase Automation</strong></li>
                      <li><strong>Database Reactivation</strong></li>
                    </ul>
                  </li>
                </ol>
              </div>

              <SmoothImage src={n8nCreateFolder} alt="n8n Create folder in Personal" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Import Workflows</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Navigate into the folder you want to import to (e.g., <strong>Text Engine</strong>)</li>
                  <li>Click <strong>"Create workflow"</strong></li>
                  <li>Click the menu icon (⋯) in the top right corner</li>
                  <li>Select <strong>"Import from File..."</strong></li>
                  <li>Choose the matching workflow file (e.g., <strong>Text_Engine.json</strong>)</li>
                  <li>Click <strong>"Save"</strong> to save the imported workflow</li>
                </ol>
              </div>

              <SmoothImage src={n8nImportWorkflow} alt="n8n Import from File menu option" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> Make sure each workflow goes into the correct folder. Reference the folder structure from Step 1.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'organize-folders',
          title: 'Verify Folder Structure',
          description: 'Confirm all workflows are organized correctly',
          content: (
            <div className="space-y-4">
              <p>Verify your n8n folder structure matches this layout:</p>

              {/* Expected folder structure visual - matches download section styling */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                {/* Text Engine Folder */}
                <div className="border-b border-border">
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Text Engine</span>
                    <span className="text-xs text-muted-foreground ml-auto">1 Workflow</span>
                  </div>
                  <div className="px-4 py-2 pl-12 bg-background">
                    <span className="text-sm text-muted-foreground">Text Engine</span>
                  </div>
                </div>

                {/* Voice Sales Rep Folder */}
                <div className="border-b border-border">
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Voice Sales Rep</span>
                    <span className="text-xs text-muted-foreground ml-auto">3 Workflows</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    <div className="px-4 py-2 pl-12 bg-background">
                      <span className="text-sm text-muted-foreground">Get Lead Details</span>
                    </div>
                    <div className="px-4 py-2 pl-12 bg-background">
                      <span className="text-sm text-muted-foreground">Make Retell Outbound Call</span>
                    </div>
                    <div className="px-4 py-2 pl-12 bg-background">
                      <span className="text-sm text-muted-foreground">Appointment Booking Functions</span>
                    </div>
                  </div>
                </div>

                {/* Knowledgebase Automation Folder */}
                <div className="border-b border-border">
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Knowledgebase Automation</span>
                    <span className="text-xs text-muted-foreground ml-auto">1 Workflow</span>
                  </div>
                  <div className="px-4 py-2 pl-12 bg-background">
                    <span className="text-sm text-muted-foreground">Update Knowledgebase</span>
                  </div>
                </div>

                {/* Database Reactivation Folder */}
                <div>
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Database Reactivation</span>
                    <span className="text-xs text-muted-foreground ml-auto">1 Workflow</span>
                  </div>
                  <div className="px-4 py-2 pl-12 bg-background">
                    <span className="text-sm text-muted-foreground">Launch Campaign</span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">Your n8n folders should look like this:</p>
              <SmoothImage src="/images/n8n-folder-structure.png" alt="n8n folder structure example" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> Your n8n workflows are now imported and organized. Continue to configure them in the next steps.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'n8n-setup',
      title: 'AI Rep Setup',
      description: 'Configure your Text AI Rep workflow in n8n',
      steps: [
        {
          id: 'open-workflow',
          title: 'Open the Workflow',
          description: 'Open the Text Engine workflow you uploaded',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Open the workflow that you uploaded in the previous steps.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your n8n account</li>
                  <li>Navigate to the folder where you imported the workflow</li>
                  <li>Click on the <strong>Text Engine</strong> workflow to open it</li>
                </ol>
              </div>

              <SmoothImage src={n8nOpenWorkflow} alt="n8n open workflow" />
              
              <p className="text-muted-foreground">The full workflow will appear showing all the nodes and connections.</p>
              
              <SmoothImage src={n8nWorkflowOverview} alt="n8n workflow overview" />
            </div>
          )
        },
        {
          id: 'understanding-notes',
          title: 'Understanding Notes',
          description: 'Learn about the color-coded notes system',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Before editing the workflow, understand the color-coded notes system used in all n8n workflows.</p>

              <div className="grid gap-4">
                <div className="bg-[#7f1d1d] border border-[#991b1b] rounded-lg p-4">
                  <h4 className="font-bold text-white uppercase mb-2">RED NOTES</h4>
                  <p className="text-white">
                    THEY MEAN THAT YOU <strong>MUST</strong> CHANGE CREDENTIALS / PROMPT / DETAILS TO MAKE THE ENGINE WORK.
                  </p>
                  <p className="text-white mt-2">
                    CLICK ON EACH RED NOTE IN THIS WORKFLOW ONE-BY-ONE AND FOLLOW INSTRUCTIONS.
                  </p>
                </div>
                
                <div className="bg-[#1e3a5f] border border-[#1e4976] rounded-lg p-4">
                  <h4 className="font-bold text-white uppercase mb-2">BLUE NOTES</h4>
                  <p className="text-white">
                    THEY MEAN THAT YOU <strong>MIGHT WANT TO</strong> CHANGE PROMPT / DETAILS TO BETTER FIT YOUR OWN WORKFLOW.
                  </p>
                  <p className="text-white mt-2">
                    BUT IT'S NOT A REQUIREMENT, SO YOU CAN KEEP THEM AS IS.
                  </p>
                </div>
                
                <div className="bg-[#374151] border border-[#4b5563] rounded-lg p-4">
                  <h4 className="font-bold text-white uppercase mb-2">GREY NOTES</h4>
                  <p className="text-white">
                    THESE ARE THE NODES YOU SHOULD NOT TOUCH - THEY ARE BUILT IN A WAY TO MAKE YOUR ENGINE WORK.
                  </p>
                  <p className="text-white mt-2">
                    YOU CAN CHANGE THEM, BUT MAKE SURE THAT YOU KNOW WHAT YOU'RE DOING.
                  </p>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>In Simple Words:</strong> The very first thing you must do is go through all the RED notes and put your own credentials - then the engine will be ready to go.
                </p>
              </div>

              
            </div>
          )
        },
        {
          id: 'connect-supabase-api',
          title: 'Connect Supabase (API)',
          description: 'Connect Supabase API to n8n',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Now let's edit the first red note - connecting Supabase API to n8n.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>first red note</strong> (Get API Credentials)</li>
                  <li>Click on <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Click <strong>"+ Create new credential"</strong></li>
                </ol>
              </div>

              <SmoothImage src={n8nFirstRedNote} alt="n8n first red note" />

              <p className="text-muted-foreground">The credentials window will popup. Here you need to enter:</p>

              {/* Show saved values from Supabase Connection phase */}
              <div className="space-y-4">
                <p className="font-medium">Your Supabase credentials (from Supabase Connection phase):</p>
                
                <PulsatingCredentialField
                  label="Host (Supabase Project URL)"
                  value={supabaseConfig.supabase_url}
                  onCopy={() => {
                    navigator.clipboard.writeText(supabaseConfig.supabase_url);
                    toast({ title: "Copied", description: "URL copied to clipboard" });
                  }}
                />
                
                <PulsatingCredentialField
                  label="Service Role Secret"
                  value={supabaseConfig.supabase_service_key}
                  isPassword
                  onCopy={() => {
                    navigator.clipboard.writeText(supabaseConfig.supabase_service_key);
                    toast({ title: "Copied", description: "Service key copied to clipboard" });
                  }}
                />
              </div>

              <SmoothImage src={n8nSupabaseCredentials} alt="n8n Supabase credentials popup" />

              <p className="text-muted-foreground">Paste the Host and Service Role Secret, then click <strong>Save</strong>.</p>

              <SmoothImage src={n8nSupabaseConnection} alt="n8n Supabase connection success" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Connection Done!</strong> You should see "Connection tested successfully". Exit the node.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'get-prompts-node',
          title: 'Get Prompts Node',
          description: 'Select the Supabase connection you just made',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Open the next red note (Get Prompts) and select the connection you just created.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Get Prompts</strong> node (next red note)</li>
                  <li>Click on <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Select the <strong>Supabase connection</strong> you just created</li>
                  <li>That's it! You don't need to create a new connection - just reuse the one you made</li>
                </ol>
              </div>

              <SmoothImage src={n8nGetPrompts} alt="n8n Get Prompts node" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> You only need to create a connection once. For all other Supabase nodes, just select the existing connection from the dropdown.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'conversation-history',
          title: 'Conversation History (Postgres)',
          description: 'Connect Postgres for chat memory',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Now we need to connect the Conversation History node which uses Postgres (Supabase Memory).</p>

              <SmoothImage src={n8nConversationHistory} alt="n8n Conversation History node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Open the node and create new credentials</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Supabase Memory</strong> node (Conversation History)</li>
                  <li>Click on <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Click <strong>"+ Create new credential"</strong></li>
                </ol>
              </div>

              <SmoothImage src={n8nPostgresNewCredential} alt="n8n Postgres new credential" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Get your Postgres connection details from Supabase</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your Supabase project that you created</li>
                </ol>
              </div>

              <SmoothImage src={supabaseProjectsList} alt="Supabase projects list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Click the <strong>Connect</strong> button at the top</li>
                </ol>
              </div>

              <SmoothImage src={supabaseConnectButton} alt="Supabase Connect button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>Scroll down to the <strong>Session pooler</strong> section</li>
                  <li>Click <strong>"View parameters"</strong></li>
                  <li>Copy the <strong>host</strong> value</li>
                </ol>
              </div>

              <SmoothImage src={supabaseSessionPooler} alt="Supabase Session pooler section" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Fill in the n8n Postgres form</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Paste the <strong>Host</strong> from Session pooler into n8n</li>
                </ol>
              </div>

              <SmoothImage src={n8nPostgresForm} alt="n8n Postgres form" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Copy <strong>database</strong> and <strong>user</strong> from Supabase Session pooler</li>
                </ol>
              </div>

              <SmoothImage src={supabaseSessionPoolerParams} alt="Supabase Session pooler parameters" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>Paste <strong>Database</strong> and <strong>User</strong> into the n8n form</li>
                </ol>
              </div>

              <SmoothImage src={n8nPostgresFilled} alt="n8n Postgres form filled" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={4}>
                  <li>In the <strong>Password</strong> field, enter the password you created when setting up the Supabase project</li>
                </ol>
              </div>

              <SmoothImage src={n8nPostgresPassword} alt="n8n Postgres password field" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Forgot your password?</strong> If you don't remember your database password or it doesn't work:
                </p>
                <ol className="list-decimal list-inside space-y-2 ml-2 mt-2">
                  <li>In Supabase, go to <strong>Database</strong> tab (on the left)</li>
                  <li>Click <strong>Settings</strong></li>
                  <li>Find <strong>Database password</strong> section</li>
                  <li>Click <strong>Reset database password</strong></li>
                </ol>
              </div>

              <SmoothImage src={supabaseDatabaseSettings} alt="Supabase Database Settings" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={5}>
                  <li>Copy the <strong>port</strong> from Supabase Session pooler (usually 5432)</li>
                </ol>
              </div>

              <SmoothImage src={supabaseSessionPoolerPort} alt="Supabase Session pooler port" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={6}>
                  <li>Paste the <strong>Port</strong> (5432) into the n8n form</li>
                </ol>
              </div>

              <SmoothImage src={n8nPostgresPort} alt="n8n Postgres port field" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={7}>
                  <li>Click <strong>Save</strong> to save the connection</li>
                </ol>
              </div>

              <SmoothImage src={n8nPostgresSave} alt="n8n Postgres save button" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your Postgres connection for chat memory is now configured. The Conversation History node will use this to store chat sessions.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'followup-history-postgres',
          title: 'Followup History (Postgres)',
          description: 'Connect Postgres for the Followup workflow',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">In the Create Followups section, find the <strong>Postgres Chat Memory</strong> node and connect it using the same Postgres connection you created in the previous step.</p>

              <SmoothImage src={n8nFollowupHistoryNode} alt="n8n Followup History node location" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Postgres Chat Memory</strong> node in the "Create Followups" section</li>
                  <li>Click on <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Select the <strong>same Postgres connection</strong> you created in the previous step (Conversation History)</li>
                  <li>Click <strong>Save</strong> - you don't need to create a new connection!</li>
                </ol>
              </div>

              <SmoothImage src={n8nFollowupHistoryConnection} alt="n8n Followup History connection selection" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> You already created the Postgres connection in the previous step. Just select the same connection from the dropdown - no need to create a new one.
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> The Followup History Postgres connection is now configured using your existing credentials.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'setup-llm-openrouter',
          title: 'Setup LLM (OpenRouter)',
          description: 'Add OpenRouter API key for the LLM Model',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Now we need to connect the LLM Model node using OpenRouter.</p>

              <SmoothImage src={n8nLlmModelNode} alt="n8n LLM Model node location" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>OpenRouter Chat Model</strong> node (in the LLM Model section)</li>
                  <li>Click on <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Click <strong>"+ Create new credential"</strong></li>
                </ol>
              </div>

              <p className="text-muted-foreground">Copy your OpenRouter API key and paste it into the connection form:</p>

              {/* Pulsating credential field */}
              <PulsatingCredentialField
                label="OpenRouter API Key (from LLM Connection phase)"
                value={llmConfig.openrouter_api_key}
                isPassword={true}
                onCopy={() => {
                  navigator.clipboard.writeText(llmConfig.openrouter_api_key);
                  toast({ title: "Copied", description: "OpenRouter API key copied to clipboard" });
                }}
              />

              <SmoothImage src={n8nOpenrouterConnection} alt="n8n OpenRouter connection form" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your OpenRouter LLM connection is now configured. The AI agent will use this for generating responses.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> There are multiple LLM Model nodes in the workflow that look exactly the same - all highlighted in red. You don't need to create new credentials for each one. Simply click on each LLM node and select the OpenRouter connection you just created from the dropdown. That's it!
                </p>
              </div>

              <SmoothImage src={n8nMultipleLlmNodes} alt="Multiple LLM nodes highlighted in the workflow" />
            </div>
          )
        },
        {
          id: 'knowledgebase-embeddings',
          title: 'Knowledgebase - Embeddings OpenAI',
          description: 'Add OpenAI API key for embeddings',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">First, we need to connect the <strong>Embeddings OpenAI</strong> node which is used for creating vector embeddings of your knowledge base.</p>

              <SmoothImage src={n8nEmbeddingsOpenaiNode} alt="n8n Embeddings OpenAI node location" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Embeddings OpenAI</strong> node (in the Supabase Knowledgebase section)</li>
                  <li>Click on <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Click <strong>"+ Create new credential"</strong></li>
                </ol>
              </div>

              <p className="text-muted-foreground">Copy your OpenAI API key and paste it into the connection form:</p>

              {/* Pulsating credential field */}
              <PulsatingCredentialField
                label="OpenAI API Key (from LLM Connection phase)"
                value={llmConfig.openai_api_key}
                isPassword={true}
                onCopy={() => {
                  navigator.clipboard.writeText(llmConfig.openai_api_key);
                  toast({ title: "Copied", description: "OpenAI API key copied to clipboard" });
                }}
              />

              <SmoothImage src={n8nOpenaiConnection} alt="n8n OpenAI connection form" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Connection Done!</strong> You should see "Connection tested successfully". Click Save and exit the node.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'knowledgebase-tool',
          title: 'Knowledgebase - Tool Connection',
          description: 'Select the Supabase connection for the knowledgebase',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Now connect the <strong>Knowledgebase tool</strong> node using the <strong>same Supabase connection</strong> you created earlier.</p>

              <SmoothImage src={n8nKnowledgebaseNode} alt="n8n Knowledgebase tool node location" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Knowledgebase tool</strong> node (in the Supabase Knowledgebase section)</li>
                  <li>Click on <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Select the <strong>same Supabase connection</strong> you created earlier in this phase</li>
                  <li>That's it! Just reuse the existing connection - no need to create a new one</li>
                </ol>
              </div>

              <SmoothImage src={n8nKnowledgebaseConnection} alt="n8n Knowledgebase tool connection selection" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> This uses the same Supabase connection you created earlier for the API nodes. Just select it from the dropdown.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Almost done!</strong> One more step - configure your appointment name.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'appointment-name',
          title: 'Appointment Name',
          description: 'Set the appointment title that leads will see',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Configure the <strong>appointment title</strong> that your leads will see in their calendar when they book.</p>

              <SmoothImage src={n8nBookAppointmentNode} alt="n8n bookAppointment1 node location" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>bookAppointment1</strong> node (in the "Booking Functions Connected with HighLevel Calendar" section)</li>
                  <li>Scroll down to find the <strong>JSON</strong> field</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentJson} alt="n8n bookAppointment JSON field" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Find and change the title:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the JSON field to open the expression editor</li>
                  <li>Find the <code className="bg-muted px-1 py-0.5 rounded">"title"</code> field in the JSON</li>
                  <li>Change the value to your desired appointment title</li>
                  <li>Example: <code className="bg-muted px-1 py-0.5 rounded">"title": "Strategy Call with Your Company"</code></li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentTitle} alt="n8n bookAppointment title field highlighted" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> This is the title your leads will see in their calendar invitation. Make it clear and professional!
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'save-text-engine',
          title: 'Text Engine',
          description: 'Native text engine — no extra setup needed',
          content: (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Native text engine active.</strong> The platform's built-in AI generates setter replies — no n8n workflow connection required. Click <strong>Done</strong> to continue.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    // Text Prompts Setup Phase - MOVED HERE (after Text AI Rep Setup)
    {
      id: 'text-prompts-setup',
      title: 'Prompts Setup',
      description: 'Configure your Text AI agent prompts',
      steps: [
        {
          id: 'understand-prompts',
          title: 'Understand Prompts',
          description: 'Learn how prompts work in our system',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Before we set up your prompts, let's understand how they work in our system. This will save you a lot of time!
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-4">
                <h4 className="font-semibold text-lg">The Traditional Way (Complicated)</h4>
                <p className="text-sm text-muted-foreground">
                  Usually when you want to update an AI agent's behavior, you need to:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground ml-2">
                  <li>Go to n8n and find the correct workflow</li>
                  <li>Locate the node where the prompt is set</li>
                  <li>Copy the prompt to ChatGPT</li>
                  <li>Ask it to modify certain details</li>
                  <li>Copy the modified prompt back</li>
                  <li>Update it in n8n and save</li>
                </ol>
                <p className="text-sm text-muted-foreground italic">That's a lot of steps for a simple text change!</p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-4">
                <h4 className="font-semibold text-lg text-green-900 dark:text-green-100">Our Way (Simple)</h4>
                <p className="text-sm text-green-900 dark:text-green-200">
                  We've streamlined everything. Here's how it works:
                </p>
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">1</div>
                    <span className="text-green-900 dark:text-green-200">
                      <strong>You update prompts here</strong> - in our system's Prompt Management tab
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">2</div>
                    <span className="text-green-900 dark:text-green-200">
                      <strong>Prompts sync to Supabase</strong> - saved in your Prompts table (you created this in Supabase Setup)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">3</div>
                    <span className="text-green-900 dark:text-green-200">
                      <strong>n8n fetches from Supabase</strong> - it automatically gets the latest prompts
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <h4 className="font-semibold mb-2 text-blue-900 dark:text-blue-100">Why This Matters</h4>
                <p className="text-sm text-blue-900 dark:text-blue-200">
                  You no longer need to touch n8n to update prompts. Just come to our system, make your changes, and your Text AI agents will automatically use the updated prompts. That's it!
                </p>
              </div>

              <SmoothImage src={n8nAgentBotPersona} alt="n8n agent showing prompts coming from Supabase" />

              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm text-muted-foreground">
                  <strong>Notice:</strong> In the screenshot above, you can see the agent's System Message uses variables like <code className="bg-background px-1.5 py-0.5 rounded text-xs font-mono">{'{{ $("Set_Prompts").item.json.Prompt_0 }}'}</code>. 
                  These are pulling directly from your Supabase Prompts table, which syncs from this system!
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'bot-persona',
          title: 'Prompt 0',
          description: 'Setup the personality and behavior of your AI bot',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Setup the persona of your bot - who this is, how it needs to talk, its personality and communication style.
              </p>

              {/* Prompt Number Badge */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-0
                </Badge>
                <span className="text-sm text-muted-foreground">Bot Persona</span>
                {botPersonaSaved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              {/* Prompt Form Fields */}
              <div className="space-y-4">
                {/* Prompt Name */}
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  botPersonaPrompt.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="bot-persona-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="bot-persona-name"
                    value={botPersonaPrompt.name}
                    onChange={(e) => setBotPersonaPrompt(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Gary - AI Sales Rep"
                    className="w-full"
                  />
                </div>

                {/* Description */}
                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="bot-persona-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="bot-persona-description"
                    value={botPersonaPrompt.description}
                    onChange={(e) => setBotPersonaPrompt(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this prompt does..."
                    className="w-full"
                  />
                </div>

                {/* Prompt Content */}
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  botPersonaPrompt.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="bot-persona-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="bot-persona-content"
                    value={botPersonaPrompt.content}
                    onChange={(e) => setBotPersonaPrompt(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter your bot persona prompt in markdown format..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown formatting (# for headers, - for bullet points, **text** for bold)
                  </p>
                </div>

                {/* Save Button */}
                <div className="flex gap-2">
                  <Button
                    onClick={saveBotPersonaPrompt}
                    disabled={botPersonaSaving || !botPersonaPrompt.name.trim() || !botPersonaPrompt.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {botPersonaSaving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {botPersonaSaving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              {/* AI Chat Assistant Section */}
              <div className="border-t pt-6 mt-6">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                        AI Prompt Assistant
                      </h4>
                      <p className="text-sm text-blue-900 dark:text-blue-200 mb-3">
                        In order for you to easily update the prompt, you can chat with this AI assistant and it will help you modify the prompt. This bot is our own bot that we use ourselves!
                      </p>
                      <div className="bg-blue-900/10 dark:bg-blue-100/10 rounded p-3 mt-2">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                          Example prompts you can send:
                        </p>
                        <ul className="text-sm text-blue-900 dark:text-blue-200 space-y-1 ml-2">
                          <li>• "Change the name of the bot from Gary to Alex"</li>
                          <li>• "Alex is a senior sales manager at X company, he is professional and ready to help"</li>
                          <li>• "Make the bot more formal and less casual in its responses"</li>
                          <li>• "Add information about our company's services to the prompt"</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => {
                    setBotPersonaPrompt(prev => ({
                      ...prev,
                      content: prompt.content
                    }));
                  }}
                  onClose={() => {}}
                  currentPromptContent={botPersonaPrompt.content}
                  promptTitle={botPersonaPrompt.name || 'Bot Persona'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        },
        // Step 3: Prompt 1
        {
          id: 'prompt-1',
          title: 'Prompt 1',
          description: 'Configure your first text engine sub-agent prompt',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Configure your first Text Engine sub-agent prompt. By default this is used as the Webinar Nurture Agent.
              </p>

              {/* Prompt Number Badge */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-1
                </Badge>
                <span className="text-sm text-muted-foreground">Text Engine Sub-Agent</span>
                {prompt1Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              {/* Prompt Form Fields */}
              <div className="space-y-4">
                {/* Prompt Name */}
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt1.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-1-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="prompt-1-name"
                    value={prompt1.name}
                    onChange={(e) => setPrompt1(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Webinar Nurture Agent"
                    className="w-full"
                  />
                </div>

                {/* Description */}
                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="prompt-1-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="prompt-1-description"
                    value={prompt1.description}
                    onChange={(e) => setPrompt1(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this prompt does..."
                    className="w-full"
                  />
                </div>

                {/* Prompt Content */}
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt1.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-1-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="prompt-1-content"
                    value={prompt1.content}
                    onChange={(e) => setPrompt1(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter your agent prompt in markdown format..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown formatting (# for headers, - for bullet points, **text** for bold)
                  </p>
                </div>

                {/* Save Button */}
                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('text-1', prompt1, setPrompt1Saving, setPrompt1Saved, 'text-prompts-setup-2', '1')}
                    disabled={prompt1Saving || !prompt1.name.trim() || !prompt1.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {prompt1Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {prompt1Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              {/* Red Note - Not a Requirement (after content) */}
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">
                      THIS IS NOT A REQUIREMENT
                    </h4>
                    <p className="text-sm text-red-700/80 dark:text-red-300/80">
                      You can customize this prompt to be <strong>WHATEVER YOU WANT</strong>. You can make it an Engagement Agent for people who opt in to your funnel, a Website Chat Agent for your website widget, or anything else. We just give you the framework - the prompt number stays the same, but the content is completely yours to customize.
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Chat Assistant Section */}
              <div className="border-t pt-6 mt-6">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                        AI Prompt Assistant
                      </h4>
                      <p className="text-sm text-blue-900 dark:text-blue-200 mb-3">
                        In order for you to easily update the prompt, you can chat with this AI assistant and it will help you modify the prompt. This bot is our own bot that we use ourselves!
                      </p>
                      <div className="bg-blue-900/10 dark:bg-blue-100/10 rounded p-3 mt-2">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                          Example prompts you can send:
                        </p>
                        <ul className="text-sm text-blue-900 dark:text-blue-200 space-y-1 ml-2">
                          <li>• "Change the webinar date to December 15th"</li>
                          <li>• "Update the product information to match my SaaS offering"</li>
                          <li>• "Make the agent focus on booking appointments"</li>
                          <li>• "Add objection handling for price concerns"</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => {
                    setPrompt1(prev => ({
                      ...prev,
                      content: prompt.content
                    }));
                  }}
                  onClose={() => {}}
                  currentPromptContent={prompt1.content}
                  promptTitle={prompt1.name || 'Prompt 1'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        },
        // Step 4: Prompt 2
        {
          id: 'prompt-2',
          title: 'Prompt 2',
          description: 'Configure your second text engine sub-agent prompt',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Configure your second Text Engine sub-agent prompt. By default this is used as the After Webinar Agent.
              </p>

              {/* Prompt Number Badge */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-2
                </Badge>
                <span className="text-sm text-muted-foreground">Text Engine Sub-Agent</span>
                {prompt2Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              {/* Prompt Form Fields */}
              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt2.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-2-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="prompt-2-name"
                    value={prompt2.name}
                    onChange={(e) => setPrompt2(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., After Webinar Agent"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="prompt-2-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="prompt-2-description"
                    value={prompt2.description}
                    onChange={(e) => setPrompt2(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this prompt does..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt2.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-2-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="prompt-2-content"
                    value={prompt2.content}
                    onChange={(e) => setPrompt2(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter your agent prompt in markdown format..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown formatting (# for headers, - for bullet points, **text** for bold)
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('text-2', prompt2, setPrompt2Saving, setPrompt2Saved, 'text-prompts-setup-3', '2')}
                    disabled={prompt2Saving || !prompt2.name.trim() || !prompt2.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {prompt2Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {prompt2Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              {/* Red Note - Not a Requirement */}
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">
                      THIS IS NOT A REQUIREMENT
                    </h4>
                    <p className="text-sm text-red-700/80 dark:text-red-300/80">
                      You can customize this prompt to be <strong>WHATEVER YOU WANT</strong>. Define what you want the agent to do - how to sell, be proactive, what offers to make, how to handle objections.
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Chat Assistant Section */}
              <div className="border-t pt-6 mt-6">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                        AI Prompt Assistant
                      </h4>
                      <p className="text-sm text-blue-900 dark:text-blue-200 mb-3">
                        In order for you to easily update the prompt, you can chat with this AI assistant and it will help you modify the prompt. This bot is our own bot that we use ourselves!
                      </p>
                      <div className="bg-blue-900/10 dark:bg-blue-100/10 rounded p-3 mt-2">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                          Example prompts you can send:
                        </p>
                        <ul className="text-sm text-blue-900 dark:text-blue-200 space-y-1 ml-2">
                          <li>• "Make the agent follow up after the webinar ended"</li>
                          <li>• "Add urgency messaging about limited spots available"</li>
                          <li>• "Include testimonials and social proof in responses"</li>
                          <li>• "Focus on selling the course instead of booking calls"</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => {
                    setPrompt2(prev => ({
                      ...prev,
                      content: prompt.content
                    }));
                  }}
                  onClose={() => {}}
                  currentPromptContent={prompt2.content}
                  promptTitle={prompt2.name || 'Prompt 2'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        },
        // Step 5: Prompt 3
        {
          id: 'prompt-3',
          title: 'Prompt 3',
          description: 'Configure your third text engine sub-agent prompt',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Configure your third Text Engine sub-agent prompt. By default this is used as the Qualification Agent.
              </p>

              {/* Prompt Number Badge */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-3
                </Badge>
                <span className="text-sm text-muted-foreground">Text Engine Sub-Agent</span>
                {prompt3Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              {/* Prompt Form Fields */}
              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt3.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-3-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="prompt-3-name"
                    value={prompt3.name}
                    onChange={(e) => setPrompt3(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Qualification Agent"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="prompt-3-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="prompt-3-description"
                    value={prompt3.description}
                    onChange={(e) => setPrompt3(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this prompt does..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt3.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-3-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="prompt-3-content"
                    value={prompt3.content}
                    onChange={(e) => setPrompt3(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter your agent prompt in markdown format..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown formatting (# for headers, - for bullet points, **text** for bold)
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('text-3', prompt3, setPrompt3Saving, setPrompt3Saved, 'text-prompts-setup-4', '3')}
                    disabled={prompt3Saving || !prompt3.name.trim() || !prompt3.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {prompt3Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {prompt3Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              {/* Red Note - Not a Requirement */}
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">
                      THIS IS NOT A REQUIREMENT
                    </h4>
                    <p className="text-sm text-red-700/80 dark:text-red-300/80">
                      You can customize this prompt to be <strong>WHATEVER YOU WANT</strong>. Define how the bot should behave when someone books an appointment, what qualifying questions to ask, what information to collect.
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Chat Assistant Section */}
              <div className="border-t pt-6 mt-6">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                        AI Prompt Assistant
                      </h4>
                      <p className="text-sm text-blue-900 dark:text-blue-200 mb-3">
                        In order for you to easily update the prompt, you can chat with this AI assistant and it will help you modify the prompt. This bot is our own bot that we use ourselves!
                      </p>
                      <div className="bg-blue-900/10 dark:bg-blue-100/10 rounded p-3 mt-2">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                          Example prompts you can send:
                        </p>
                        <ul className="text-sm text-blue-900 dark:text-blue-200 space-y-1 ml-2">
                          <li>• "Ask about their budget and timeline"</li>
                          <li>• "Collect company size and industry information"</li>
                          <li>• "Add BANT qualification questions"</li>
                          <li>• "Make the agent confirm appointment details"</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => {
                    setPrompt3(prev => ({
                      ...prev,
                      content: prompt.content
                    }));
                  }}
                  onClose={() => {}}
                  currentPromptContent={prompt3.content}
                  promptTitle={prompt3.name || 'Prompt 3'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        },
        // Step 6: Prompt 7 - Booking Prompt
        {
          id: 'prompt-7',
          title: 'Prompt 7',
          description: 'Configure the booking extraction prompt',
          content: (
            <div className="space-y-6">
              {/* Warning Note */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-1">
                      BOOKING PROMPT - DEFAULT VALUES
                    </h4>
                    <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                      This is a <strong>system prompt</strong> that guides the agent on how to extract booking information from conversations. These are carefully tuned default values. <strong>Do not change anything here unless you're comfortable with the entire system</strong> and understand how booking extraction works.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-muted-foreground">
                This prompt tells the agent how to extract dates, times, and booking details from the conversation.
              </p>

              {/* Prompt Number Badge */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-7
                </Badge>
                <span className="text-sm text-muted-foreground">Booking Extraction</span>
                {prompt7Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              {/* Prompt Form Fields */}
              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt7.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-7-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="prompt-7-name"
                    value={prompt7.name}
                    onChange={(e) => setPrompt7(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Booking Extraction Prompt"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="prompt-7-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="prompt-7-description"
                    value={prompt7.description}
                    onChange={(e) => setPrompt7(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this prompt does..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt7.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-7-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="prompt-7-content"
                    value={prompt7.content}
                    onChange={(e) => setPrompt7(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter the booking extraction prompt..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown formatting (# for headers, - for bullet points, **text** for bold)
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('booking-1', prompt7, setPrompt7Saving, setPrompt7Saved, 'text-prompts-setup-5', '7')}
                    disabled={prompt7Saving || !prompt7.name.trim() || !prompt7.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {prompt7Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {prompt7Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>
            </div>
          )
        },
        // Step 7: Prompt 8 - Booking Response
        {
          id: 'prompt-8',
          title: 'Prompt 8',
          description: 'Configure the booking response prompt',
          content: (
            <div className="space-y-6">
              {/* Warning Note */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-1">
                      BOOKING PROMPT - DEFAULT VALUES
                    </h4>
                    <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                      This is a <strong>system prompt</strong> that guides the agent on how to respond after booking appointments. These are carefully tuned default values. <strong>Do not change anything here unless you're comfortable with the entire system</strong> and understand how booking responses work.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-muted-foreground">
                This prompt tells the agent how to format booking confirmations and handle booking-related responses.
              </p>

              {/* Prompt Number Badge */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-8
                </Badge>
                <span className="text-sm text-muted-foreground">Booking Response</span>
                {prompt8Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              {/* Prompt Form Fields */}
              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt8.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-8-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="prompt-8-name"
                    value={prompt8.name}
                    onChange={(e) => setPrompt8(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Booking Response Prompt"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="prompt-8-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="prompt-8-description"
                    value={prompt8.description}
                    onChange={(e) => setPrompt8(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this prompt does..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  prompt8.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="prompt-8-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="prompt-8-content"
                    value={prompt8.content}
                    onChange={(e) => setPrompt8(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter the booking response prompt..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown formatting (# for headers, - for bullet points, **text** for bold)
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('booking-2', prompt8, setPrompt8Saving, setPrompt8Saved, 'text-prompts-setup-6', '8')}
                    disabled={prompt8Saving || !prompt8.name.trim() || !prompt8.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {prompt8Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {prompt8Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'highlevel-credentials',
      title: 'HighLevel Credentials',
      description: 'Configure your HighLevel API credentials',
      steps: [
        {
          id: 'ghl-api-key',
          title: 'HighLevel API Key',
          description: 'Enter your HighLevel API key from Business Profile',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your HighLevel API Key below to enable CRM integration.</p>
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedGhlConfig.ghl_api_key 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-ghl-api-key" className="text-sm font-medium">
                    API Key
                  </Label>
                  {savedGhlConfig.ghl_api_key && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="setup-ghl-api-key"
                    type={showGHLApiKey ? "text" : "password"}
                    value={ghlConfig.ghl_api_key}
                    onChange={(e) => setGhlConfig(prev => ({ ...prev, ghl_api_key: e.target.value }))}
                    placeholder="Enter your HighLevel API key"
                    className="font-mono text-sm pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowGHLApiKey(!showGHLApiKey)}
                  >
                    {showGHLApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveGhlField('ghl_api_key', ghlConfig.ghl_api_key)}
                    disabled={loading || !ghlConfig.ghl_api_key}
                    size="sm"
                    className={savedFields.has('ghl_api_key') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-6">
                <p className="font-medium">How to get your HighLevel API Key:</p>
                
                <div className="space-y-2">
                  <p><strong>Step 1:</strong> Go to your HighLevel account and navigate to <strong>Settings</strong> in the sidebar. Click on <strong>Private Integrations</strong>.</p>
                  <SmoothImage src="/lovable-uploads/ghl-private-integrations-menu.png" alt="HighLevel Settings menu showing Private Integrations option" />
                </div>

                <div className="space-y-2">
                  <p><strong>Step 2:</strong> On the Private Integrations page, you'll see all your API keys. Click <strong>Create New Integration</strong>.</p>
                  <SmoothImage src="/lovable-uploads/ghl-private-integrations-page.png" alt="HighLevel Private Integrations page" />
                </div>

                <div className="space-y-2">
                  <p><strong>Step 3:</strong> A dialog will appear. Click <strong>Create New Integration</strong> to start.</p>
                  <SmoothImage src="/lovable-uploads/ghl-create-integration.png" alt="HighLevel Create New Integration dialog" />
                </div>

                <div className="space-y-2">
                  <p><strong>Step 4:</strong> Enter a <strong>Name</strong> for your integration (e.g., "Building Flow" or your preferred name).</p>
                  <SmoothImage src="/lovable-uploads/ghl-name-integration.png" alt="HighLevel naming the integration" />
                </div>

                <div className="space-y-2">
                  <p><strong>Step 5:</strong> Go to the <strong>Scopes</strong> tab and click <strong>Select All</strong> to grant all permissions. Then click <strong>Create</strong>.</p>
                  <SmoothImage src="/lovable-uploads/ghl-select-all-scopes.png" alt="HighLevel Select All scopes" />
                </div>

                <div className="space-y-2">
                  <p><strong>Step 6:</strong> Copy the generated API key and paste it in the field above.</p>
                  <SmoothImage src="/lovable-uploads/ghl-copy-api-key.png" alt="HighLevel copy API key" />
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> This API key allows the system to interact with your HighLevel account for automation and CRM functionality.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'ghl-assignee-id',
          title: 'Assignee ID',
          description: 'Set the user to whom all AI-booked appointments will be assigned',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste the Assignee ID below - this is the user who will be assigned AI-booked appointments.</p>
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedGhlConfig.ghl_assignee_id 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-ghl-assignee-id" className="text-sm font-medium">
                    Assignee ID
                  </Label>
                  {savedGhlConfig.ghl_assignee_id && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-ghl-assignee-id"
                  value={ghlConfig.ghl_assignee_id}
                  onChange={(e) => setGhlConfig(prev => ({ ...prev, ghl_assignee_id: e.target.value }))}
                  placeholder="Enter the Assignee ID"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveGhlField('ghl_assignee_id', ghlConfig.ghl_assignee_id)}
                    disabled={loading || !ghlConfig.ghl_assignee_id}
                    size="sm"
                    className={savedFields.has('ghl_assignee_id') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to find the Assignee ID:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Settings</strong> → <strong>My Staff</strong></li>
                  <li>Click on the user who should receive appointments</li>
                  <li>In the URL, copy the ID after <code>/settings/team/</code></li>
                </ol>
              </div>

              <SmoothImage src={ghlAssigneeId} alt="HighLevel staff settings showing user ID in URL" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> This is the team member who will be assigned to all appointments booked by the AI system.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'ghl-location-id',
          title: 'Location ID',
          description: 'Find your HighLevel Location ID',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your Location ID below to identify your HighLevel sub-account.</p>
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedGhlConfig.ghl_location_id 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-ghl-location-id" className="text-sm font-medium">
                    Location ID
                  </Label>
                  {savedGhlConfig.ghl_location_id && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-ghl-location-id"
                  value={ghlConfig.ghl_location_id}
                  onChange={(e) => setGhlConfig(prev => ({ ...prev, ghl_location_id: e.target.value }))}
                  placeholder="Enter your Location ID"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveGhlField('ghl_location_id', ghlConfig.ghl_location_id)}
                    disabled={loading || !ghlConfig.ghl_location_id}
                    size="sm"
                    className={savedFields.has('ghl_location_id') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to find your Location ID:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your HighLevel dashboard</li>
                  <li>Look at the URL in your browser</li>
                  <li>The Location ID is after <code>/location/</code></li>
                  <li>Copy the entire ID string</li>
                </ol>
              </div>

              <SmoothImage src={ghlLocationId} alt="HighLevel URL showing Location ID" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> The Location ID identifies your specific HighLevel sub-account and is required for API calls.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'ghl-calendar-id',
          title: 'Calendar ID',
          description: 'Get your calendar ID for booking appointments',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste your Calendar ID below to enable AI-powered appointment booking.</p>
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedGhlConfig.ghl_calendar_id 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-ghl-calendar-id" className="text-sm font-medium">
                    Calendar ID
                  </Label>
                  {savedGhlConfig.ghl_calendar_id && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-ghl-calendar-id"
                  value={ghlConfig.ghl_calendar_id}
                  onChange={(e) => setGhlConfig(prev => ({ ...prev, ghl_calendar_id: e.target.value }))}
                  placeholder="Enter your Calendar ID"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveGhlField('ghl_calendar_id', ghlConfig.ghl_calendar_id)}
                    disabled={loading || !ghlConfig.ghl_calendar_id}
                    size="sm"
                    className={savedFields.has('ghl_calendar_id') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to find your Calendar ID:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Calendars</strong> in HighLevel</li>
                  <li>Click on the calendar you want to use for AI bookings</li>
                  <li>Look at the URL - the Calendar ID is after <code>/calendars/</code></li>
                  <li>Copy the entire ID string</li>
                </ol>
              </div>

              <SmoothImage src={ghlCalendarId} alt="HighLevel calendar URL showing Calendar ID" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> All HighLevel credentials are now configured. Your system can interact with your HighLevel account.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'highlevel-setup',
      title: 'HighLevel Setup',
      description: 'Configure HighLevel workflows for automation',
      steps: [
        {
          id: 'connect-channel',
          title: 'Connect Channel',
          description: 'Connect a messaging channel to test the Text AI Rep',
          content: (
            <div className="space-y-4">
              <p>The Text AI Rep works through text-based channels. You need at least one channel connected to test how it works:</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Supported Channels:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>SMS</strong> - Requires Twilio phone number</li>
                  <li><strong>WhatsApp</strong> - Via Twilio or HighLevel integration</li>
                  <li><strong>Instagram</strong> - Direct Messages</li>
                  <li><strong>Facebook</strong> - Messenger</li>
                  <li><strong>LiveChat</strong> - Website widget</li>
                  <li><strong>Telegram</strong> - Bot integration</li>
                  <li><strong>iMessage</strong> - Apple Business Chat</li>
                </ul>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <p>
                  <strong>Quick Start Tip:</strong> If your Twilio account isn't ready yet (A2P registration takes 3-5 days), you can connect Instagram or Facebook to start testing immediately while waiting for SMS approval.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">To connect Instagram or Facebook:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Settings</strong> → <strong>Integrations</strong></li>
                  <li>Find the <strong>Facebook/Instagram</strong> card</li>
                  <li>Click to connect and follow the on-screen steps</li>
                  <li>Select which Facebook Page or Instagram account to connect</li>
                </ol>
              </div>

              <SmoothImage src={ghlIntegrationsFacebook} alt="HighLevel Integrations - Facebook/Instagram connection" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Test the connection:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Send a DM from a <strong>different</strong> Instagram/Facebook account to the one you just connected</li>
                  <li>Go to <strong>Conversations</strong> tab in HighLevel</li>
                  <li>You should see a new conversation appear</li>
                  <li>Also check <strong>Contacts</strong> - a new contact is automatically created for every new user</li>
                </ol>
              </div>

              <SmoothImage src={ghlConversationsTab} alt="HighLevel Conversations tab showing new conversation" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Troubleshooting:</strong> If you don't see the new conversation or contact:
                </p>
                <ol className="list-decimal list-inside space-y-1 ml-2 mt-2">
                  <li>Reload the page</li>
                  <li>If still not visible, go back to <strong>Integrations</strong> and verify the connection is active</li>
                  <li>If the connection is active but still not working, contact HighLevel support</li>
                </ol>
              </div>

              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
                <p>
                  <strong>⚠️ Important:</strong> Your AI Rep will <strong>NOT</strong> respond to this DM yet! The AI is not set up - that's what all the steps and phases below are for. This step is just to verify your channel is connected and ready. Once you complete all the workflows in the following steps, your AI Rep will start answering messages automatically on Instagram (or whichever channel you connected).
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> Once you see new conversations coming in, your channel is connected and ready. Now continue with the steps below to enable your AI Rep!
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'set-credentials',
          title: 'Set Credentials',
          description: 'Configure Supabase credentials in HighLevel',
          content: (
            <div className="space-y-4">
              <p>First, open the Set Credentials workflow to configure your Supabase connection:</p>

              <SmoothImage src={ghlSetCredentialsList} alt="Set Credentials workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> → <strong>Workflows</strong></li>
                  <li>Find and open the <strong>"Set Credentials"</strong> workflow</li>
                  <li>Click on the <strong>"Set Credentials"</strong> node</li>
                </ol>
              </div>

              <SmoothImage src={ghlSetCredentialsFields} alt="Set Credentials workflow fields" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Configure the fields:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the <strong>Supabase Project URL</strong> field, paste your URL:</li>
                </ol>
              </div>

              <PulsatingCredentialField
                label="Supabase Project URL"
                value={supabaseConfig.supabase_url}
                onCopy={() => {
                  navigator.clipboard.writeText(supabaseConfig.supabase_url);
                  toast({ title: 'Copied!', description: 'Supabase URL copied to clipboard' });
                }}
              />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>In the <strong>Supabase Service Role Key</strong> field, paste your key:</li>
                </ol>
              </div>

              <PulsatingCredentialField
                label="Supabase Service Role Key"
                value={supabaseConfig.supabase_service_key}
                onCopy={() => {
                  navigator.clipboard.writeText(supabaseConfig.supabase_service_key);
                  toast({ title: 'Copied!', description: 'Service key copied to clipboard' });
                }}
                isPassword
              />

              <SmoothImage src={ghlSetCredentialsSave} alt="Save and publish Set Credentials workflow" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Final steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>Save Action</strong></li>
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>
            </div>
          )
        },
        {
          id: 'receive-process-dms',
          title: 'Receive & Process DMs',
          description: 'Open the first workflow, publish and save it',
          content: (
            <div className="space-y-4">
              <p>Navigate to the Text AI Rep folder and open the first workflow:</p>

              <SmoothImage src={ghlWorkflowsList} alt="HighLevel workflows list showing AI Rep folder" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> → <strong>Workflows</strong></li>
                  <li>Navigate to the <strong>Text AI Rep</strong> folder</li>
                  <li>Open <strong>"1 - Receive & Process DMs"</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={ghlReceiveProcessDms} alt="Receive & Process DMs workflow" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={4}>
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> You don't need to change anything here. Just publish and save.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'generate-reply',
          title: 'Generate Reply',
          description: 'Publish and save the workflow',
          content: (
            <div className="space-y-4">
              <p>Open the Generate Reply workflow:</p>

              <SmoothImage src={ghlGenerateReplyList} alt="Generate Reply workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to Workflows and open <strong>"2 - Generate Reply"</strong></li>
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlGenerateReplySave} alt="Generate Reply workflow publish and save" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> You don't need to change anything here - the credentials are already configured via Set Credentials workflow. Just publish and save.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'save-reply',
          title: 'Save Reply',
          description: 'Configure the Save Reply webhook',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste the Save Reply webhook URL from HighLevel below.</p>

              {/* Webhook URL Input Field - AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                saveReplyWebhookSaved
                  ? "border-green-500 bg-green-500/10"
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Save Reply Webhook</Label>
                  {saveReplyWebhookSaved && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  value={saveReplyWebhookUrl}
                  onChange={(e) => setSaveReplyWebhookUrl(e.target.value)}
                  placeholder="Paste the webhook URL here"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveSaveReplyWebhook(saveReplyWebhookUrl)}
                    disabled={savingWebhook || !saveReplyWebhookUrl.trim()}
                    size="sm"
                  >
                    {savingWebhook ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              <SmoothImage src={ghlSaveReplyList} alt="Save Reply workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to Workflows and open <strong>"3 - Save Reply"</strong></li>
                  <li>Click on the <strong>Trigger</strong> node (Inbound Webhook)</li>
                </ol>
              </div>

              <SmoothImage src={ghlSaveReplyTrigger} alt="Save Reply trigger node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>In the panel that opens, find the <strong>URL (POST/GET/PUT)</strong> field</li>
                  <li>Copy that webhook URL and paste it in the field above</li>
                </ol>
              </div>

              <SmoothImage src={ghlSaveReplyWebhook} alt="Copy webhook URL from trigger" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Test payload sent!</strong> After clicking Save, a test payload is sent. Now fetch and select this request in HighLevel.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Fetch the test request:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to the HighLevel workflow trigger panel</li>
                  <li>Click the <strong>"Fetch Sample Requests"</strong> button (or "Check for new requests")</li>
                </ol>
              </div>

              <SmoothImage src={ghlSaveReplyFetchRequests} alt="Click Fetch Sample Requests button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>A dropdown will appear with available requests</li>
                  <li>Select the request that just appeared (the test request we sent)</li>
                </ol>
              </div>

              <SmoothImage src={ghlSaveReplySelectRequest} alt="Select the test request from dropdown" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Save trigger and publish:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Save Trigger"</strong> button at the bottom of the panel</li>
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlSaveReplyPublish} alt="Publish and save the workflow" />
            </div>
          )
        },
        {
          id: 'send-reply',
          title: 'Send Reply',
          description: 'Configure default followup times for each channel',
          content: (
            <div className="space-y-4">
              <p>Open the Send Reply workflow and configure followup timing:</p>

              <SmoothImage src={ghlSendReplyList} alt="Send Reply workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to Workflows and open <strong>"4 - Send Reply"</strong></li>
                  <li>Scroll down in the workflow to find the <strong>Wait</strong> nodes for each channel</li>
                </ol>
              </div>

              <SmoothImage src={ghlSendReplyFollowupTimes} alt="Send Reply workflow with wait times highlighted" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-2">
                <p className="font-medium">Understanding Followup Times:</p>
                <p>When the AI rep sends a message, it will wait for this configured time before checking if a followup is needed. The system will then decide whether to send a followup or not based on the conversation.</p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-2">
                <p className="font-medium">💡 Channel-specific timing tips:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>WhatsApp:</strong> Shorter wait times (e.g., 4-6 hours) - messages can get lost in busy chats</li>
                  <li><strong>Instagram:</strong> Longer wait times (e.g., 10-18 hours) - users check DMs less frequently</li>
                  <li><strong>SMS:</strong> Medium wait times (e.g., 4 hours) - balance between urgency and not being pushy</li>
                  <li><strong>Live Chat:</strong> Very short wait times (e.g., 2 minutes) - real-time communication</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Configure and save:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on each <strong>Wait</strong> node to adjust the time as needed</li>
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlSendReplyPublish} alt="Send Reply workflow publish and save" />
            </div>
          )
        },
        {
          id: 'send-followups',
          title: 'Send Followups',
          description: 'Configure second followups and extended sequences',
          content: (
            <div className="space-y-4">
              <p>Open the Send Followups workflow to configure extended followup sequences:</p>

              <SmoothImage src={ghlSendFollowupsList} alt="Send Followups workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to Workflows and open <strong>"5 - Send Followups"</strong></li>
                  <li>Review the workflow structure</li>
                </ol>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-2">
                <p className="font-medium">Understanding Second Followups:</p>
                <p>This workflow handles additional followups after the first one from "Send Reply". For example:</p>
                <ul className="list-disc list-inside space-y-1 ml-2 mt-2">
                  <li>AI rep sends initial message</li>
                  <li>First followup after 6 hours (configured in Send Reply)</li>
                  <li>Second followup after 10-12 more hours (configured here)</li>
                </ul>
              </div>

              <SmoothImage src={ghlSendFollowupsTimes} alt="Second followup wait times" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-2">
                <p className="font-medium">💡 Extending the sequence:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>You can <strong>duplicate the second part</strong> of any channel's workflow to create third and fourth followups</li>
                  <li>Adjust the wait times for each subsequent followup</li>
                  <li>This allows you to keep engaging leads until they respond</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Configure and save:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Wait</strong> nodes to adjust second followup times if needed</li>
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlSendFollowupsWorkflow} alt="Send Followups workflow publish and save" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> The default configuration works well for most use cases. Only modify if you have specific followup timing requirements.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'transfer-to-human',
          title: 'Transfer to Human',
          description: 'Configure the transfer to human webhook',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste the Transfer to Human webhook URL from HighLevel below.</p>

              {/* Webhook URL Input Field - AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                transferHumanWebhookSaved
                  ? "border-green-500 bg-green-500/10"
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Transfer to Human Webhook</Label>
                  {transferHumanWebhookSaved && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  value={transferHumanWebhookUrl}
                  onChange={(e) => setTransferHumanWebhookUrl(e.target.value)}
                  placeholder="Paste the webhook URL here"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveTransferHumanWebhook(transferHumanWebhookUrl)}
                    disabled={savingWebhook || !transferHumanWebhookUrl.trim()}
                    size="sm"
                  >
                    {savingWebhook ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to Workflows and open <strong>"Transfer to Human"</strong></li>
                </ol>
              </div>

              <SmoothImage src={ghlTransferHumanList} alt="Transfer to Human workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Click on the <strong>Trigger</strong> node (Inbound Webhook)</li>
                </ol>
              </div>

              <SmoothImage src={ghlTransferHumanTrigger} alt="Click on Trigger node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>In the panel that opens, find the <strong>URL (POST/GET/PUT)</strong> field</li>
                  <li>Copy that webhook URL and paste it in the field above</li>
                </ol>
              </div>

              <SmoothImage src={ghlTransferHumanWebhook} alt="Copy webhook URL from trigger" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Test payload sent!</strong> After clicking Save, a test payload has been sent to this webhook URL. Now you need to fetch and select this request in HighLevel.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Fetch the test request:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to the HighLevel workflow trigger panel</li>
                  <li>Click the <strong>"Fetch Sample Requests"</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={ghlTransferHumanFetch} alt="Click Fetch Sample Requests button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>A dropdown will appear with available requests</li>
                  <li>Select the request that just appeared (the test request we sent)</li>
                </ol>
              </div>

              <SmoothImage src={ghlTransferHumanSelect} alt="Select the test request from dropdown" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Save the trigger:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Save Trigger"</strong> button at the bottom of the panel</li>
                </ol>
              </div>

              <SmoothImage src={ghlTransferHumanSave} alt="Save the trigger" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Publish and save the workflow:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlTransferHumanPublish} alt="Publish and save the workflow" />

              <div className="bg-muted/50 rounded-lg p-4">
                <p>
                  <strong>Transfer to Human workflow configured!</strong> Now let's set up the Update Lead Details webhook.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'update-lead-details',
          title: 'Update Lead Details',
          description: 'Configure the lead details update webhook',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste the User Details webhook URL from HighLevel below.</p>

              {/* Webhook URL Input Field - AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                userDetailsWebhookSaved
                  ? "border-green-500 bg-green-500/10"
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">User Details Webhook</Label>
                  {userDetailsWebhookSaved && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  value={userDetailsWebhookUrl}
                  onChange={(e) => setUserDetailsWebhookUrl(e.target.value)}
                  placeholder="Paste the webhook URL here"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveUserDetailsWebhook(userDetailsWebhookUrl)}
                    disabled={savingWebhook || !userDetailsWebhookUrl.trim()}
                    size="sm"
                  >
                    {savingWebhook ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to Workflows and open <strong>"Update Lead Details"</strong></li>
                </ol>
              </div>

              <SmoothImage src={ghlUpdateLeadDetailsList} alt="Update Lead Details workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Click on the <strong>Trigger</strong> node (Inbound Webhook)</li>
                </ol>
              </div>

              <SmoothImage src={ghlUpdatePipelineTrigger} alt="Click on Trigger node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>In the panel that opens, find the <strong>URL (POST/GET/PUT)</strong> field</li>
                  <li>Copy that webhook URL and paste it in the field above</li>
                </ol>
              </div>

              <SmoothImage src={ghlUpdatePipelineWebhook} alt="Copy webhook URL from trigger" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Test payload sent!</strong> After clicking Save, a test payload has been sent to this webhook URL. Now you need to fetch and select this request in HighLevel.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Fetch the test request:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to the HighLevel workflow trigger panel</li>
                  <li>Click the <strong>"Fetch Sample Requests"</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={ghlFetchSampleRequests} alt="Click Fetch Sample Requests button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>A dropdown will appear with available requests</li>
                  <li>Select the request that just appeared (the test request we sent)</li>
                </ol>
              </div>

              <SmoothImage src={ghlSelectRequest} alt="Select the test request from dropdown" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Save and publish the workflow:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Save Trigger"</strong> button at the bottom of the panel</li>
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlSaveWorkflow} alt="Save trigger, publish and save workflow" />

              <div className="bg-muted/50 rounded-lg p-4">
                <p>
                  <strong>User Details workflow configured!</strong> Now let's set up the Pipeline Stage webhook.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'update-lead-score',
          title: 'Update Lead Score',
          description: 'Configure the lead score update webhook',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste the Lead Score webhook URL from HighLevel below.</p>

              {/* Webhook URL Input Field - AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                leadScoreWebhookSaved
                  ? "border-green-500 bg-green-500/10"
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Lead Score Webhook</Label>
                  {leadScoreWebhookSaved && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  value={leadScoreWebhookUrl}
                  onChange={(e) => setLeadScoreWebhookUrl(e.target.value)}
                  placeholder="Paste the webhook URL here"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveLeadScoreWebhook(leadScoreWebhookUrl)}
                    disabled={savingWebhook || !leadScoreWebhookUrl.trim()}
                    size="sm"
                  >
                    {savingWebhook ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to Workflows and open <strong>"Update Lead Score"</strong></li>
                </ol>
              </div>

              <SmoothImage src={ghlUpdateLeadScoreList} alt="Update Lead Score workflow in list" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Click on the <strong>Trigger</strong> node (Inbound Webhook)</li>
                </ol>
              </div>

              <SmoothImage src={ghlUpdateLeadScoreTrigger} alt="Click on Trigger node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>In the panel that opens, find the <strong>URL (POST/GET/PUT)</strong> field</li>
                  <li>Copy that webhook URL and paste it in the field above</li>
                </ol>
              </div>

              <SmoothImage src={ghlUpdateLeadScoreWebhook} alt="Copy webhook URL from trigger" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Test payload sent!</strong> After clicking Save, a test payload has been sent to this webhook URL. Now you need to fetch and select this request in HighLevel.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Fetch the test request:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to the HighLevel workflow trigger panel</li>
                  <li>Click the <strong>"Select reference payload"</strong> dropdown</li>
                </ol>
              </div>

              <SmoothImage src={ghlLeadScoreFetchRequests} alt="Click Select reference payload dropdown" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>A dropdown will appear with available requests</li>
                  <li>Select the request that just appeared (the test request we sent)</li>
                </ol>
              </div>

              <SmoothImage src={ghlLeadScoreSelectRequest} alt="Select the test request from dropdown" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={5}>
                  <li>Click <strong>"Save Trigger"</strong> button at the bottom of the panel</li>
                </ol>
              </div>

              <SmoothImage src={ghlLeadScoreSaveTrigger} alt="Click Save Trigger button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Publish and save the workflow:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlLeadScorePublishSave} alt="Publish and save the workflow" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> All HighLevel workflows are now configured. Your setup is complete!
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'twilio-setup',
      title: 'TWILIO SETUP',
      description: 'Set up Twilio for SMS and voice number integration',
      steps: [
        {
          id: 'create-twilio-account',
          title: 'Create Twilio Account',
          description: 'Set up your Twilio account for SMS and voice communications',
          content: (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span>Visit:</span>
                <a 
                  href="https://www.twilio.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  twilio.com
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Sign up for a Twilio account</li>
                  <li>Verify your phone number</li>
                  <li>Note down your Account SID and Auth Token</li>
                </ol>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  Twilio provides the infrastructure for SMS messaging and phone number management in your campaigns.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'understand-phone-numbers',
          title: 'Understand Phone Numbers',
          description: 'Learn about your phone number options',
          content: (
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
                <p className="font-medium">Understanding Your Phone Number Options</p>
                <p>Our AI Sales Rep system uses <strong>one phone number</strong> for both:</p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li><strong>Text AI Sales Rep</strong> - receives and sends SMS messages</li>
                  <li><strong>Voice AI Sales Rep</strong> - receives inbound calls and makes outbound calls</li>
                </ul>
                <p className="mt-2">You have two options for getting a phone number:</p>
              </div>

              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 space-y-3">
                <p className="font-medium">Option 1: Buy Directly from HighLevel (NOT Recommended)</p>
                <p>HighLevel has a built-in "LC Connector" that lets you buy phone numbers directly:</p>
                
                <SmoothImage src={ghlPhoneSystemAddNumber} alt="HighLevel Phone System showing Add Number button" />
                
                <p className="mt-2">While this is simpler, it has a <strong>major limitation</strong>:</p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li>Numbers bought through HighLevel <strong>cannot connect to Retell AI</strong></li>
                  <li>This means Text AI will work, but <strong>Voice AI will NOT work</strong></li>
                  <li>You would need a <strong>separate number</strong> for voice calls</li>
                  <li>Having two numbers is confusing for your leads</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-3">
                <p className="font-medium">Option 2: Buy from Twilio (Recommended)</p>
                <p>Twilio is a third-party platform that gives you full control over your phone numbers:</p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li><strong>One number for everything</strong> - text AND voice</li>
                  <li>Connect to HighLevel for Text AI (via account integration)</li>
                  <li>Connect to Retell AI for Voice AI (via SIP Trunking)</li>
                  <li>Better deliverability with A2P verification</li>
                  <li>More control over your messaging and calling</li>
                </ul>
              </div>
            </div>
          )
        },
        {
          id: 'buy-twilio-number',
          title: 'Buy a Phone Number',
          description: 'Purchase a phone number in Twilio',
          content: (
            <div className="space-y-4">
              <p>In your Twilio Console, navigate to <strong>Phone Numbers → Manage → Active numbers</strong>:</p>

              <SmoothImage src={twilioActiveNumbers} alt="Twilio Active Numbers page with Buy a number button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Buy a number"</strong> in the top right corner</li>
                  <li>Select your country (US or Canada recommended for A2P support)</li>
                  <li>Make sure the number has these capabilities:
                    <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-sm">
                      <li><strong>Voice</strong> - for receiving and making calls</li>
                      <li><strong>SMS</strong> - for receiving and sending text messages</li>
                      <li><strong>MMS</strong> (optional) - for sending images/media</li>
                    </ul>
                  </li>
                  <li>Complete the purchase</li>
                </ol>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> Make sure the number has <strong>both Voice AND SMS</strong> capabilities. You need both for the AI sales reps to work properly with one number.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'connect-twilio-ghl',
          title: 'Connect Twilio to HighLevel',
          description: 'Link your Twilio account with GoHighLevel for Text AI',
          content: (
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>What this does:</strong> Connecting your entire Twilio account to HighLevel syncs all your Twilio phone numbers. When someone texts your Twilio number, HighLevel receives it and the Text AI Sales Rep responds.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to connect:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Open HighLevel <strong>Support Chat</strong> (bottom right of your screen)</li>
                  <li>Send this message:
                    <div className="bg-background border rounded p-2 mt-2 text-sm font-mono">
                      "Hi, can you please connect my Twilio account with my HighLevel account?"
                    </div>
                  </li>
                  <li>They will ask for your Twilio credentials:
                    <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-sm">
                      <li><strong>Account SID</strong> - found on your Twilio Console dashboard</li>
                      <li><strong>Auth Token</strong> - found on your Twilio Console dashboard</li>
                    </ul>
                  </li>
                  <li>Provide the credentials and wait for confirmation</li>
                  <li>Connection is usually completed within <strong>24 hours</strong></li>
                </ol>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">After connection is confirmed:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to HighLevel <strong>Settings → Phone System → Phone Numbers</strong></li>
                  <li>Your Twilio numbers will automatically appear in the list</li>
                  <li>Click on a number to select it</li>
                  <li>Click <strong>"Save"</strong> to activate it for messaging</li>
                </ol>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Result:</strong> Now when someone texts this number, the Text AI Sales Rep will automatically start the conversation. The number is synced between Twilio and HighLevel.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> For Voice AI, you will also connect this same Twilio number to Retell AI (via SIP Trunking) in the Retell Setup phase. This way, one number handles both text AND voice.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'a2p-brand-registration',
          title: 'A2P Brand Registration',
          description: 'Register your brand for US/Canada SMS compliance',
          content: (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> To send SMS to US/Canada phone numbers, you must complete A2P 10DLC verification. This proves you're a legitimate business.
                </p>
              </div>

              <p>Search for <strong>"a2p"</strong> in the Twilio console to find the A2P Messaging page:</p>

              <SmoothImage src={twilioA2pMessaging} alt="Twilio A2P Messaging overview page" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Register additional Campaigns"</strong></li>
                  <li>You'll go through the <strong>US A2P 10DLC Registration</strong> process</li>
                </ol>
              </div>

              <SmoothImage src={twilioA2pRegistration} alt="Twilio A2P 10DLC Registration page showing Brand and Campaign steps" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Register Your Brand:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Submit Brand"</strong> under Register Brand</li>
                  <li>Fill in your business information:
                    <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-sm">
                      <li>Business Name (official LLC/company name)</li>
                      <li>EIN Number</li>
                      <li>Business Address</li>
                      <li>Contact Information</li>
                    </ul>
                  </li>
                  <li>Submit for approval (usually takes a few hours)</li>
                </ol>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> Brand registration is done <strong>once per business</strong>. If you create sub-accounts for different customers, you can share the same brand.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'a2p-campaign-registration',
          title: 'A2P Campaign Registration',
          description: 'Register your messaging campaign for compliance',
          content: (
            <div className="space-y-4">
              <p>After your brand is approved, register your campaign:</p>

              <SmoothImage src={twilioCampaignRegistration} alt="Twilio Campaign Registration form" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Campaign Setup:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Register A2P Campaign"</strong></li>
                  <li>For <strong>Use Case</strong>, select: <strong>"Low Volume Mixed"</strong>
                    <p className="text-sm text-muted-foreground ml-6 mt-1">This covers customer care, delivery notifications, and general messaging</p>
                  </li>
                  <li>Select <strong>"Create new Messaging Service"</strong></li>
                  <li>Fill in Campaign Description (describe what messages you'll send)</li>
                  <li>Provide Sample Messages (examples of texts you'll send)</li>
                  <li>Submit for approval</li>
                </ol>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Approval Time:</strong> Campaign approval typically takes <strong>3-5 business days</strong>. This is a one-time process - once approved, all your Twilio numbers can use this campaign.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">After Approval:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Register Phone Numbers</strong> in the A2P setup</li>
                  <li>Add your Twilio phone numbers to the approved campaign</li>
                  <li>Your numbers are now ready for A2P messaging</li>
                </ol>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> Once your campaign is approved and numbers are registered, you can send SMS to US/Canada phone numbers without being blocked.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    // Voice Accounts Setup Phase (Accounts: create account, templates, api key, phone numbers)
    {
      id: 'voice-accounts-setup',
      title: 'Accounts Setup',
      description: 'Set up Retell AI account, templates, and phone numbers',
      steps: [
        {
          id: 'create-account',
          title: 'Create Retell AI Account',
          description: 'Set up your Retell AI account for voice AI capabilities',
          content: (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span>Visit:</span>
                <a 
                  href="https://retellai.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  retellai.com
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>

              <p>Click "Join / Log In" to create your Retell AI account.</p>

              <SmoothImage src={retellCreateAccount} alt="Retell AI create account page" />
            </div>
          )
        },
        {
          id: 'download-retell-templates',
          title: 'Download Agent Templates',
          description: 'Download all Retell AI agent templates directly',
          content: (
            <div className="space-y-4">
              <p>Download all agent templates below:</p>
              
              {/* Visual folder structure - matching n8n workflow download style */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                {/* Building Flow Folder */}
                <div>
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Building Flow</span>
                    <span className="text-xs text-muted-foreground ml-auto">2 Agents</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Inbound_Voice_AI_Rep.json</span>
                      <a 
                        href="/retell-agents/Inbound_Agent.json" 
                        download="Inbound_Voice_AI_Rep.json"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    </div>
                    <div className="px-4 py-2 pl-12 bg-background flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Outbound_Voice_AI_Rep.json</span>
                      <a 
                        href="/retell-agents/Outbound_Agent.json" 
                        download="Outbound_Voice_AI_Rep.json"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> Download both agent files and save them to a folder on your computer. You'll import these into Retell AI in the next step.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'import-retell-agents',
          title: 'Import Agents to Retell AI',
          description: 'Create folder and import agents into Retell AI',
          content: (
            <div className="space-y-4">
              <p>First, create a folder in Retell AI, then import each agent into it:</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Create Folder in Retell AI</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In your Retell AI account, click on <strong>"Agents"</strong> in the left sidebar</li>
                  <li>Click the <strong>"+"</strong> button next to "FOLDERS"</li>
                  <li>Create a folder named: <strong>Building Flow</strong></li>
                  <li>Click on the folder to open it</li>
                </ol>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Import Agents</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>While inside the <strong>Building Flow</strong> folder, click <strong>"Import"</strong> in the top right</li>
                  <li>Select <strong>Inbound_Voice_AI_Rep.json</strong> and click <strong>"Save"</strong></li>
                  <li>Click <strong>"Import"</strong> again and select <strong>Outbound_Voice_AI_Rep.json</strong></li>
                  <li>Both agents should now appear in your folder</li>
                </ol>
              </div>

              <SmoothImage src={retellImportAgent} alt="Retell AI Import button and upload dialog" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> Make sure to import both the Outbound Voice AI Rep and Inbound Voice AI Rep agents - they serve different purposes in your automation system.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'organize-retell-folders',
          title: 'Verify Folder Structure',
          description: 'Confirm all agents are organized correctly',
          content: (
            <div className="space-y-4">
              <p>Verify your Retell AI folder structure matches this layout:</p>

              {/* Expected folder structure visual - matching download section styling */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                {/* Building Flow Folder */}
                <div>
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                    <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium">Building Flow</span>
                    <span className="text-xs text-muted-foreground ml-auto">2 Agents</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    <div className="px-4 py-2 pl-12 bg-background">
                      <span className="text-sm text-muted-foreground">Outbound Voice AI Rep</span>
                    </div>
                    <div className="px-4 py-2 pl-12 bg-background">
                      <span className="text-sm text-muted-foreground">Inbound Voice AI Rep</span>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">Your Retell AI folders should look like this:</p>
              <SmoothImage src={retellBuildingFlowFolder} alt="Retell AI Building Flow folder structure" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> Your Retell AI agents are now imported and organized. Continue to configure them in the next steps.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'retell-api-key',
          title: 'API Key',
          description: 'Get your Retell API key for authentication',
          content: (
            <div className="space-y-4">
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedRetellConfig.retell_api_key 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-retell-api-key" className="text-sm font-medium">
                    Retell API Key
                  </Label>
                  {savedRetellConfig.retell_api_key && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="setup-retell-api-key"
                    type={showRetellApiKey ? "text" : "password"}
                    value={retellConfig.retell_api_key}
                    onChange={(e) => setRetellConfig(prev => ({ ...prev, retell_api_key: e.target.value }))}
                    placeholder="Enter your Retell API key"
                    className="font-mono text-sm pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowRetellApiKey(!showRetellApiKey)}
                  >
                    {showRetellApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveRetellField('retell_api_key', retellConfig.retell_api_key)}
                    disabled={loading || !retellConfig.retell_api_key}
                    size="sm"
                    className={savedFields.has('retell_api_key') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('retell_api_key') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to get your Retell API Key:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <a 
                    href="https://beta.retellai.com/settings" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Retell AI Settings
                  </a></li>
                  <li>Navigate to the <strong>API Keys</strong> section</li>
                  <li>Copy your API key</li>
                </ol>
              </div>

              <SmoothImage src={retellApiKeys} alt="Retell AI API Keys page" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> This API key allows the system to interact with your Retell AI account for voice calls.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'retell-phone-numbers',
          title: 'Phone Numbers',
          description: 'Add your Retell AI phone numbers',
          content: (
            <div className="space-y-4">
              {/* Phone Number 1 - Required */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedRetellConfig.retell_phone_1 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-retell-phone-1" className="text-sm font-medium">
                    Phone Number 1 (Required)
                  </Label>
                  {savedRetellConfig.retell_phone_1 && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-retell-phone-1"
                  type="text"
                  value={retellConfig.retell_phone_1}
                  onChange={(e) => setRetellConfig(prev => ({ ...prev, retell_phone_1: e.target.value }))}
                  placeholder="Enter phone number (e.g., +14155551234)"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveRetellField('retell_phone_1', retellConfig.retell_phone_1)}
                    disabled={loading || !retellConfig.retell_phone_1}
                    size="sm"
                    className={savedFields.has('retell_phone_1') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('retell_phone_1') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* Phone Number 2 - Optional */}
              <div className="space-y-2 bg-background/50 p-4 rounded-lg border">
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-retell-phone-2" className="text-sm font-medium">
                    Phone Number 2
                  </Label>
                  {savedRetellConfig.retell_phone_2 && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-retell-phone-2"
                  type="text"
                  value={retellConfig.retell_phone_2}
                  onChange={(e) => setRetellConfig(prev => ({ ...prev, retell_phone_2: e.target.value }))}
                  placeholder="Enter phone number (optional)"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveRetellField('retell_phone_2', retellConfig.retell_phone_2)}
                    disabled={loading || !retellConfig.retell_phone_2}
                    size="sm"
                    className={savedFields.has('retell_phone_2') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('retell_phone_2') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* Phone Number 3 - Optional */}
              <div className="space-y-2 bg-background/50 p-4 rounded-lg border">
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-retell-phone-3" className="text-sm font-medium">
                    Phone Number 3
                  </Label>
                  {savedRetellConfig.retell_phone_3 && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-retell-phone-3"
                  type="text"
                  value={retellConfig.retell_phone_3}
                  onChange={(e) => setRetellConfig(prev => ({ ...prev, retell_phone_3: e.target.value }))}
                  placeholder="Enter phone number (optional)"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveRetellField('retell_phone_3', retellConfig.retell_phone_3)}
                    disabled={loading || !retellConfig.retell_phone_3}
                    size="sm"
                    className={savedFields.has('retell_phone_3') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('retell_phone_3') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Required:</strong> At least 1 phone number is required for the voice system to work. Phone numbers 2 and 3 are optional.
                </p>
              </div>

              <p className="text-muted-foreground">Add the phone numbers that you've connected in Retell AI.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Where to find your Phone Numbers:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Phone Numbers</strong> in your Retell AI dashboard</li>
                  <li>Choose the phone number that you added and connected</li>
                  <li>Copy the phone number and paste it in the field above</li>
                </ol>
              </div>

              <SmoothImage src={retellPhoneNumbers} alt="Retell AI Phone Numbers" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> With all Retell credentials configured, your voice AI system is now fully connected.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    // Voice Inbound Setup Phase
    {
      id: 'voice-inbound-setup',
      title: 'Inbound AI Rep Setup',
      description: 'Configure your Inbound Voice AI Rep',
      steps: [
        {
          id: 'retell-inbound-agent-id',
          title: 'Inbound Agent ID',
          description: 'Get your Inbound Agent ID from Retell AI',
          content: (
            <div className="space-y-4">
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedRetellConfig.retell_inbound_agent_id 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-retell-inbound-agent-id" className="text-sm font-medium">
                    Inbound Agent ID
                  </Label>
                  {savedRetellConfig.retell_inbound_agent_id && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-retell-inbound-agent-id"
                  value={retellConfig.retell_inbound_agent_id}
                  onChange={(e) => setRetellConfig(prev => ({ ...prev, retell_inbound_agent_id: e.target.value }))}
                  placeholder="Enter your Inbound Agent ID"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveRetellField('retell_inbound_agent_id', retellConfig.retell_inbound_agent_id)}
                    disabled={loading || !retellConfig.retell_inbound_agent_id}
                    size="sm"
                    className={savedFields.has('retell_inbound_agent_id') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('retell_inbound_agent_id') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to find your Inbound Agent ID:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Agents</strong> in your Retell AI dashboard</li>
                  <li>Open the <strong>Building Flow</strong> folder</li>
                  <li>Click on your <strong>Inbound Voice AI Rep</strong> agent</li>
                  <li>Copy the <strong>Agent ID</strong> from the top left (shown under the agent name)</li>
                </ol>
              </div>

              <SmoothImage src={retellInboundAgentClick} alt="Click on Inbound Voice AI Rep in Building Flow folder" />

              <SmoothImage src={retellInboundAgentIdCopy} alt="Copy Inbound Agent ID from top left" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> The Inbound Voice AI Rep handles incoming calls to your system.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'get-lead-details-workflow',
          title: 'Get Lead Details Workflow',
          description: 'Configure the Get Lead Details workflow in n8n',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Configure the n8n Get Lead Details workflow for voice agent data.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Open the workflow</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your <strong>n8n dashboard</strong></li>
                  <li>Open the <strong>Get Lead Details</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={n8nGetLeadDetailsList} alt="n8n workflows list with Get Lead Details" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure Supabase connections</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Supabase nodes</strong> (Get API Credentials and Get Prompts)</li>
                </ol>
              </div>

              <SmoothImage src={n8nGetLeadDetailsWorkflow} alt="Click on Supabase nodes" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Choose the <strong>same connection</strong> you already have - you don't need to create a new one</li>
                </ol>
              </div>

              <SmoothImage src={n8nGetLeadDetailsSupabase} alt="Select existing Supabase connection" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Save and activate the workflow</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Toggle the <strong>Active</strong> switch to ON in the top right</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>

              <SmoothImage src={n8nGetLeadDetailsSave} alt="Activate and save the workflow" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 4: Copy the production webhook URL</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Webhook</strong> node (first node)</li>
                </ol>
              </div>

              <SmoothImage src={n8nGetLeadDetailsWebhook} alt="Click on Webhook node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Click on <strong>Production URL</strong> tab</li>
                  <li>Copy the webhook URL - you'll need it in the next step</li>
                </ol>
              </div>

              <SmoothImage src={n8nGetLeadDetailsProductionUrl} alt="Copy Production URL" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> The Get Lead Details workflow is configured. Keep the webhook URL copied - you'll paste it into Retell in the next step.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'retell-inbound-webhook',
          title: 'Retell Inbound Webhook',
          description: 'Configure the inbound webhook for each phone number',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Configure the inbound webhook in Retell for each of your phone numbers.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Go to Phone Numbers</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In Retell, click on <strong>Phone Numbers</strong> in the left sidebar</li>
                  <li>Select your <strong>main phone number</strong> (or the first one if you have multiple)</li>
                </ol>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure the inbound webhook</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Check the <strong>"Add an inbound webhook"</strong> checkbox</li>
                  <li>Paste the n8n webhook URL you copied from the previous step</li>
                  <li>The settings will be <strong>automatically saved</strong></li>
                </ol>
              </div>

              <SmoothImage src={retellPhoneNumbersWebhook} alt="Retell Phone Numbers with inbound webhook configured" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> If you have <strong>multiple phone numbers</strong>, you MUST repeat this process for <strong>each and every number</strong>. Each phone number needs to have the inbound webhook configured.
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> The inbound webhook is now configured. When someone calls your Retell number, the workflow will fetch the lead details automatically.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'call-finished-webhook',
          title: 'Call Finished Webhook',
          description: 'Configure the Call Finished workflow webhook in HighLevel',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Go to HighLevel and configure the Call Finished workflow webhook trigger.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Open the Call Finished workflow</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation → Workflows</strong></li>
                  <li>Find and click on <strong>Call Finished</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={ghlCallFinishedWorkflow} alt="HighLevel workflows list with Call Finished" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Click on the Trigger</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Trigger - Inbound Webhook</strong> node at the top of the workflow</li>
                </ol>
              </div>

              <SmoothImage src={ghlCallReceivedTrigger} alt="Click on Trigger Inbound Webhook node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Copy the webhook URL and paste it below</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the panel that opens, find the <strong>URL (POST/GET/PUT)</strong> field</li>
                  <li>Copy that webhook URL</li>
                  <li>Paste it in the field below and click <strong>Send Test Payload</strong></li>
                </ol>
              </div>

              <SmoothImage src={ghlCallReceivedWebhookUrl} alt="Copy webhook URL from trigger" />

              {/* Webhook URL Input Field */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                callReceivedWebhookSent
                  ? "border-green-500 bg-green-500/10"
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Call Finished Webhook URL</Label>
                  {callReceivedWebhookSent && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Payload Sent
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  value={callReceivedWebhookUrl}
                  onChange={(e) => setCallReceivedWebhookUrl(e.target.value)}
                  placeholder="Paste the webhook URL here"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => sendCallReceivedTestPayload(callReceivedWebhookUrl)}
                    disabled={sendingCallReceivedPayload || !callReceivedWebhookUrl.trim()}
                    size="sm"
                    className={callReceivedWebhookSent ? "bg-green-500 hover:bg-green-600" : ""}
                  >
                    {sendingCallReceivedPayload ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : callReceivedWebhookSent ? (
                      'Resend Test Payload'
                    ) : (
                      'Send Test Payload'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> The test payload was sent to activate the webhook. Now you need to fetch and select this request in HighLevel to complete the setup.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 4: Fetch the test request</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to the HighLevel workflow trigger panel</li>
                  <li>Click the <strong>"Fetch Sample Requests"</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={ghlCallReceivedFetchRequests} alt="Click Fetch Sample Requests button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 5: Select the test request</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>A dropdown will appear with available requests</li>
                  <li>Select the request that just appeared (the test request we sent)</li>
                </ol>
              </div>

              <SmoothImage src={ghlCallReceivedSelectPayload} alt="Select test request from dropdown" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 6: Confirm the test request</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>"Save Trigger"</strong> button to confirm the selection</li>
                </ol>
              </div>

              <SmoothImage src={ghlCallReceivedPayloadSelected} alt="Test payload selected" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 7: Publish and save the workflow</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Toggle the <strong>Publish</strong> switch to ON</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                </ol>
              </div>

              <SmoothImage src={ghlCallReceivedSavePublish} alt="Publish and save the workflow" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> The Call Finished workflow is now configured. Continue to the next step to connect this webhook to Retell.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'retell-webhook-settings',
          title: 'Retell Webhook Settings',
          description: 'Configure the Retell inbound agent webhook settings',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Now go to Retell and configure the inbound agent webhook settings with the HighLevel webhook URL you just set up.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Open a Retell Agent</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your <strong>Retell AI dashboard</strong></li>
                  <li>Navigate to <strong>Agents</strong> and open the <strong>Building Flow</strong> folder</li>
                  <li>Click on either <strong>Outbound Voice AI Rep</strong> or <strong>Inbound Voice AI Rep</strong></li>
                </ol>
              </div>

              <SmoothImage src={retellOutboundAgentClick} alt="Open Outbound Voice AI Rep agent" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> You need to configure the webhook settings for <strong>BOTH</strong> agents (Inbound Voice AI Rep and Outbound Voice AI Rep). After a call is finished, the system needs to send the call details to HighLevel - this applies to both inbound and outbound calls.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure Webhook Settings</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Scroll down to <strong>Webhook Settings</strong> section</li>
                  <li>Find the <strong>Agent Level Webhook URL</strong> field</li>
                  <li>Copy the webhook URL below and paste it into Retell</li>
                </ol>
              </div>

              {/* Show the webhook URL to copy */}
              {callReceivedWebhookUrl ? (
                <PulsatingCredentialField
                  label="HighLevel Call Finished Webhook URL"
                  value={callReceivedWebhookUrl}
                  onCopy={() => {
                    navigator.clipboard.writeText(callReceivedWebhookUrl);
                    toast({ title: "Copied", description: "Webhook URL copied to clipboard" });
                  }}
                />
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <p>
                    <strong>Note:</strong> You need to complete the previous step first to get the webhook URL.
                  </p>
                </div>
              )}

              <SmoothImage src={retellInboundWebhookSettings} alt="Retell Webhook Settings section" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> After pasting the webhook URL, make sure to save your changes in Retell.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'booking-workflow',
          title: 'Booking Workflow',
          description: 'Configure the Appointment Booking Functions workflow in n8n',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Configure the n8n Appointment Booking Functions workflow.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Open the workflow</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your <strong>n8n dashboard</strong></li>
                  <li>Open the <strong>Appointment Booking Functions</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentList} alt="n8n workflows list with Appointment Booking Functions" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure API Credentials</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Get API Credentials</strong> module</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentWorkflow} alt="Click on Get API Credentials module" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Choose the <strong>same connection</strong> that you already have after setting up the Text Engine and Supabase (you don't need to create a new one)</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentCredentials} alt="Select existing Supabase connection" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Configure Appointment Title</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>bookAppointment</strong> module</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentModule} alt="Click on bookAppointment module" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Scroll down to the <strong>JSON</strong> section and click to open it</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentJson} alt="Open JSON section" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={3}>
                  <li>Find the <strong>"title"</strong> field and change the name to how you want the lead to see the appointment in their calendar</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentTitle} alt="Change the appointment title" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 4: Activate and save the workflow</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Toggle the <strong>Active</strong> switch to ON in the top right</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>

              <SmoothImage src={n8nBookAppointmentActivate} alt="Activate and save the workflow" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> The Appointment Booking Functions workflow is now configured. Continue to the next step to connect it to Retell.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'booking-functions',
          title: 'Booking Functions',
          description: 'Connect the n8n webhook to all Retell functions',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Get the n8n webhook URL and configure all Retell agent functions.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Get the n8n Production Webhook URL</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the n8n <strong>Appointment Booking Functions</strong> workflow, click on the <strong>Webhook1</strong> node (first node)</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookingWebhookNode} alt="Click on Webhook1 node" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Click on <strong>Production URL</strong> tab and copy the webhook URL</li>
                </ol>
              </div>

              <SmoothImage src={n8nBookingWebhookUrl} alt="Copy Production URL" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Open Retell Agent Functions</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your <strong>Retell AI dashboard</strong></li>
                  <li>Open the <strong>Inbound Agent</strong></li>
                  <li>Find the <strong>Functions</strong> tab on the right panel</li>
                  <li>Click on <strong>create-contact</strong> function to open it</li>
                </ol>
              </div>

              <SmoothImage src={retellFunctionsList} alt="Retell Functions tab with create-contact" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Paste the webhook URL</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the function settings, find the <strong>API Endpoint</strong> field and paste the n8n webhook URL</li>
                </ol>
              </div>

              <SmoothImage src={retellFunctionApiEndpoint} alt="Paste webhook URL in API Endpoint" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <ol className="list-decimal list-inside space-y-2 ml-2" start={2}>
                  <li>Click <strong>Update</strong> at the bottom</li>
                </ol>
              </div>

              <SmoothImage src={retellFunctionUpdate} alt="Click Update button" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> You need to do the <strong>SAME EXACT THING</strong> for ALL the following functions. Yes, all functions use the <strong>SAME n8n webhook URL</strong> from the Appointment Booking Functions workflow. You need to replace it manually one by one:
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Repeat for these functions:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li><strong>get-available-slots</strong></li>
                  <li><strong>book-appointments</strong></li>
                  <li><strong>cancel-appointments</strong></li>
                  <li><strong>get-contact-appointments</strong></li>
                  <li><strong>get_contact</strong></li>
                  <li><strong>update-appointment</strong></li>
                  <li><strong>create-contact</strong> (already done)</li>
                </ol>
              </div>

              <SmoothImage src={retellFunctionsBook} alt="Click on book-appointments function" />

              <SmoothImage src={retellBookAppointmentsEndpoint} alt="Same webhook URL in book-appointments" />

              <SmoothImage src={retellRemainingFunctions} alt="All remaining functions to configure" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> All functions are now configured with the n8n webhook URL. Continue to the next step to publish your agent.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'publish-agent',
          title: 'Publish Agent',
          description: 'Publish the Retell agent with your phone number',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Publish your Retell inbound agent and connect it to your phone number.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Publish the agent:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click the <strong>Publish</strong> button in the top right corner of Retell</li>
                  <li>In the publish dialog, check <strong>Inbound phone number</strong></li>
                  <li>Select the phone number that you added to your Retell account</li>
                  <li>Click <strong>Publish</strong></li>
                </ol>
              </div>

              <SmoothImage src={retellPublishDialog} alt="Publish dialog with phone number selection" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Congratulations!</strong> Your Retell voice agent is now fully configured and published. It will answer calls on your inbound phone number and can book appointments, manage contacts, and more!
                </p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Test it out:</strong> Try calling your inbound phone number to test the voice agent. The agent should be able to help callers book appointments and will sync all data with HighLevel.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    // Voice Outbound Setup Phase
    {
      id: 'voice-outbound-setup',
      title: 'Outbound AI Rep Setup',
      description: 'Configure your Outbound Voice AI Rep',
      steps: [
        {
          id: 'retell-outbound-agent-id',
          title: 'Outbound Agent ID',
          description: 'Get your Outbound Agent ID from Retell AI',
          content: (
            <div className="space-y-4">
              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                savedRetellConfig.retell_outbound_agent_id 
                  ? "border-green-500 bg-green-500/10" 
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="setup-retell-outbound-agent-id" className="text-sm font-medium">
                    Outbound Agent ID
                  </Label>
                  {savedRetellConfig.retell_outbound_agent_id && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  id="setup-retell-outbound-agent-id"
                  value={retellConfig.retell_outbound_agent_id}
                  onChange={(e) => setRetellConfig(prev => ({ ...prev, retell_outbound_agent_id: e.target.value }))}
                  placeholder="Enter your Outbound Agent ID"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveRetellField('retell_outbound_agent_id', retellConfig.retell_outbound_agent_id)}
                    disabled={loading || !retellConfig.retell_outbound_agent_id}
                    size="sm"
                    className={savedFields.has('retell_outbound_agent_id') ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {loading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : savedFields.has('retell_outbound_agent_id') ? (
                      'Configured'
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              {/* DESCRIPTION BELOW */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How to find your Outbound Agent ID:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Agents</strong> in your Retell AI dashboard</li>
                  <li>Open the <strong>Building Flow</strong> folder</li>
                  <li>Click on your <strong>Outbound Voice AI Rep</strong> agent</li>
                  <li>Copy the <strong>Agent ID</strong> from the top left (shown under the agent name)</li>
                </ol>
              </div>

              <SmoothImage src={retellOutboundAgentClick} alt="Click on Outbound Voice AI Rep in Building Flow folder" />

              <SmoothImage src={retellOutboundAgentIdCopy} alt="Copy Outbound Agent ID from top left" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> The Outbound Voice AI Rep is used for making outgoing calls from your system.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'outbound-booking-functions',
          title: 'Booking Functions',
          description: 'Connect the n8n webhook to all Retell Outbound agent functions',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Configure all Retell Outbound agent functions with the same n8n webhook URL you used for the Inbound agent.</p>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> You need to repeat the same process you did for the Inbound agent. The Outbound agent also needs all the booking functions configured with the <strong>same n8n webhook URL</strong> from the Appointment Booking Functions workflow.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Open Retell Outbound Agent Functions</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your <strong>Retell AI dashboard</strong></li>
                  <li>Open the <strong>Outbound Voice AI Rep</strong> agent</li>
                  <li>Find the <strong>Functions</strong> tab on the right panel</li>
                </ol>
              </div>

              <SmoothImage src={retellOutboundAgentClick} alt="Open Outbound Voice AI Rep agent" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure each function</p>
                <p className="text-sm text-muted-foreground mb-2">For each function, paste the same n8n webhook URL from the Appointment Booking Functions workflow:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li><strong>create-contact</strong></li>
                  <li><strong>get-available-slots</strong></li>
                  <li><strong>book-appointments</strong></li>
                  <li><strong>cancel-appointments</strong></li>
                  <li><strong>get-contact-appointments</strong></li>
                  <li><strong>get_contact</strong></li>
                  <li><strong>update-appointment</strong></li>
                </ol>
              </div>

              <SmoothImage src={retellFunctionsList} alt="Retell Functions tab" />

              <SmoothImage src={retellFunctionApiEndpoint} alt="Paste webhook URL in API Endpoint" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> All Outbound agent functions are now configured. Continue to the next step to set up the Make Outbound Call workflow.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'make-outbound-call-workflow',
          title: 'Make Outbound Call Workflow',
          description: 'Configure the Make Outbound Call workflow in n8n',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Configure the n8n Make Outbound Call workflow for outbound voice calls.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Open the workflow</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your <strong>n8n dashboard</strong></li>
                  <li>Navigate to <strong>Voice Sales Rep</strong> folder</li>
                  <li>Open the <strong>Make Outbound Call</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={n8nMakeOutboundCallList} alt="n8n workflows list with Make Outbound Call" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Configure Supabase connections</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>red Supabase nodes</strong> (Get_Retell_Prompts and Get_API_Credentials)</li>
                  <li>Choose the <strong>same connection</strong> you already have - you don't need to create a new one</li>
                </ol>
              </div>

              <SmoothImage src={n8nMakeOutboundCallWorkflow} alt="Make Outbound Call workflow with red Supabase nodes highlighted" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 3: Get the production webhook URL</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Webhook</strong> node (first node)</li>
                  <li>Click on <strong>Production URL</strong> tab</li>
                  <li>Copy the webhook URL - you'll need it in the next step</li>
                </ol>
              </div>

              <SmoothImage src={n8nMakeOutboundCallWebhook} alt="Click on Webhook node" />

              <SmoothImage src={n8nMakeOutboundCallProductionUrl} alt="Copy Production URL from webhook" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> Keep the webhook URL copied - you'll paste it in the Credentials page in the next step.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'outbound-caller-webhook',
          title: 'Outbound Caller Webhook',
          description: 'Paste the webhook URL to save it',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Paste the webhook URL you copied from the Make Outbound Call workflow.</p>

              {/* FIELD AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                outboundCallerWebhook1Saved
                  ? "border-green-500 bg-green-500/10"
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Outbound Caller Webhook</Label>
                  {outboundCallerWebhook1Saved && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  value={outboundCallerWebhook1}
                  onChange={(e) => setOutboundCallerWebhook1(e.target.value)}
                  placeholder="Paste the Production URL here"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => saveOutboundCallerWebhook(outboundCallerWebhook1)}
                    disabled={savingWebhook || !outboundCallerWebhook1.trim()}
                    size="sm"
                  >
                    {savingWebhook ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2 mt-2">
                  <li>Paste the n8n production webhook URL you copied in the previous step</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> Once saved, the Make Outbound Call workflow will be connected and your Voice AI Rep can make outbound calls.
                </p>
              </div>
            </div>
          )
        },
        {
          id: 'activate-outbound-workflow',
          title: 'Activate Workflow',
          description: 'Activate the Make Outbound Call workflow',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Activate the Make Outbound Call workflow in n8n.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Activate the workflow:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to the <strong>Make Outbound Call</strong> workflow in n8n</li>
                  <li>Toggle the <strong>Active</strong> switch to ON in the top right</li>
                  <li>Click <strong>Save</strong></li>
                </ol>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Congratulations!</strong> Your Outbound Voice AI Rep setup is complete. You can now make outbound calls with your AI agent.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    // Voice Prompts Setup Phase
    {
      id: 'voice-prompts-setup',
      title: 'Prompts Setup',
      description: 'Configure your Voice AI agent prompts',
      steps: [
        // Step 0: Understand Prompts
        {
          id: 'understand-prompts',
          title: 'Understand Prompts',
          description: 'Learn how prompts work in Retell',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                In Retell, your Voice AI agent uses <strong>dynamic prompts</strong> that are fetched from Supabase. This allows you to update your agent's behavior without re-deploying or editing the agent directly in Retell.
              </p>

              <SmoothImage src={retellPromptsStructure} alt="Retell prompts structure showing Bot Persona, System Prompt, and Booking Instructions" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">How It Works</h4>
                <p className="text-sm text-blue-900/80 dark:text-blue-200/80 mb-3">
                  When a call starts, Retell fetches the latest prompts from Supabase using these dynamic variables:
                </p>
                <ul className="space-y-2 text-sm text-blue-900/80 dark:text-blue-200/80">
                  <li className="flex items-start gap-2">
                    <code className="bg-blue-900/10 px-2 py-0.5 rounded text-xs">{"{{botPersona}}"}</code>
                    <span>→ Your agent's personality and character</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <code className="bg-blue-900/10 px-2 py-0.5 rounded text-xs">{"{{retellPrompt}}"}</code>
                    <span>→ The main system prompt with instructions</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <code className="bg-blue-900/10 px-2 py-0.5 rounded text-xs">{"{{bookingFunction}}"}</code>
                    <span>→ Instructions for booking appointments</span>
                  </li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <h4 className="font-semibold text-green-900 dark:text-green-100 mb-2">Why This Matters</h4>
                <p className="text-sm text-green-900/80 dark:text-green-200/80">
                  By managing prompts in Supabase (via this setup guide or the Prompt Management page), you can instantly update your Voice AI agent's behavior. Changes sync in real-time — no need to touch Retell directly!
                </p>
              </div>
            </div>
          )
        },
        // Outbound Logic Quiz
        {
          id: 'outbound-logic',
          title: 'Outbound Logic',
          description: 'Learn how outbound voice calls work',
          content: <VoiceOutboundLogicStep clientId={clientId} onNavigationChange={setLogicNavState} />
        },
        // Step 3: Prompt 0 - Voice Persona
        {
          id: 'voice-prompt-0',
          title: 'Prompt 0',
          description: 'Voice Persona - Configure the bot persona for your voice agent',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Configure your Voice Agent's persona. This defines the agent's personality, character, and speaking style.
              </p>

              {/* Prompt Number Badge */}
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-0
                </Badge>
                <span className="text-sm text-muted-foreground">Voice Agent - Bot Persona</span>
                {voicePrompt0Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              {/* Prompt Form Fields */}
              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt0.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-0-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="voice-prompt-0-name"
                    value={voicePrompt0.name}
                    onChange={(e) => setVoicePrompt0(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Bot Persona"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="voice-prompt-0-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="voice-prompt-0-description"
                    value={voicePrompt0.description}
                    onChange={(e) => setVoicePrompt0(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of what this prompt does..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt0.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-0-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="voice-prompt-0-content"
                    value={voicePrompt0.content}
                    onChange={(e) => setVoicePrompt0(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter your voice agent persona in markdown format..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown formatting (# for headers, - for bullet points, **text** for bold)
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('voice-persona', voicePrompt0, setVoicePrompt0Saving, setVoicePrompt0Saved, 'voice-prompts-setup-2', 'Voice Persona')}
                    disabled={voicePrompt0Saving || !voicePrompt0.name.trim() || !voicePrompt0.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {voicePrompt0Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {voicePrompt0Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              {/* AI Chat Assistant */}
              <div className="border-t pt-6 mt-6">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                        AI Prompt Assistant
                      </h4>
                      <p className="text-sm text-blue-900 dark:text-blue-200">
                        Use this assistant to help craft your voice agent's persona.
                      </p>
                    </div>
                  </div>
                </div>
                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => setVoicePrompt0(prev => ({ ...prev, content: prompt.content }))}
                  onClose={() => {}}
                  currentPromptContent={voicePrompt0.content}
                  promptTitle={voicePrompt0.name || 'Voice Persona'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        },
        // Step 4: Prompt 1 - Webinar Inbound Agent
        {
          id: 'voice-prompt-1',
          title: 'Prompt 1',
          description: 'Webinar Inbound Agent prompt',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Configure the main prompt for your Webinar Inbound Voice Agent. This handles incoming calls.
              </p>

              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-1
                </Badge>
                <span className="text-sm text-muted-foreground">Webinar Inbound Agent</span>
                {voicePrompt1Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt1.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-1-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="voice-prompt-1-name"
                    value={voicePrompt1.name}
                    onChange={(e) => setVoicePrompt1(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Webinar Inbound Agent"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="voice-prompt-1-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="voice-prompt-1-description"
                    value={voicePrompt1.description}
                    onChange={(e) => setVoicePrompt1(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt1.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-1-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="voice-prompt-1-content"
                    value={voicePrompt1.content}
                    onChange={(e) => setVoicePrompt1(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter the inbound agent prompt..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('voice-1', voicePrompt1, setVoicePrompt1Saving, setVoicePrompt1Saved, 'voice-prompts-setup-3', 'Inbound Agent')}
                    disabled={voicePrompt1Saving || !voicePrompt1.name.trim() || !voicePrompt1.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {voicePrompt1Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {voicePrompt1Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-6 mt-6">
                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => setVoicePrompt1(prev => ({ ...prev, content: prompt.content }))}
                  onClose={() => {}}
                  currentPromptContent={voicePrompt1.content}
                  promptTitle={voicePrompt1.name || 'Inbound Agent'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        },
        // Step 5: Prompt 2 - Webinar Outbound Agent
        {
          id: 'voice-prompt-2',
          title: 'Prompt 2',
          description: 'Webinar Outbound Agent prompt',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Configure the main prompt for your Webinar Outbound Voice Agent. This handles outgoing calls to leads.
              </p>

              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-2
                </Badge>
                <span className="text-sm text-muted-foreground">Webinar Outbound Agent</span>
                {voicePrompt2Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt2.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-2-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="voice-prompt-2-name"
                    value={voicePrompt2.name}
                    onChange={(e) => setVoicePrompt2(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Webinar Outbound Agent"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="voice-prompt-2-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="voice-prompt-2-description"
                    value={voicePrompt2.description}
                    onChange={(e) => setVoicePrompt2(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt2.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-2-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="voice-prompt-2-content"
                    value={voicePrompt2.content}
                    onChange={(e) => setVoicePrompt2(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter the outbound agent prompt..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('voice-2', voicePrompt2, setVoicePrompt2Saving, setVoicePrompt2Saved, 'voice-prompts-setup-4', 'Outbound Agent')}
                    disabled={voicePrompt2Saving || !voicePrompt2.name.trim() || !voicePrompt2.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {voicePrompt2Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {voicePrompt2Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-6 mt-6">
                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => setVoicePrompt2(prev => ({ ...prev, content: prompt.content }))}
                  onClose={() => {}}
                  currentPromptContent={voicePrompt2.content}
                  promptTitle={voicePrompt2.name || 'Outbound Agent'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        },
        // Step 6: Prompt 5 - Booking Prompt
        {
          id: 'voice-prompt-5',
          title: 'Prompt 5',
          description: 'Booking Instructions prompt',
          content: (
            <div className="space-y-6">
              <p className="text-muted-foreground">
                Configure the booking instructions for your Voice Agent. This tells the agent how to book appointments.
              </p>

              {/* Warning Note */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div>
                  <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-1">
                    Default Booking Instructions
                  </h4>
                  <p className="text-sm text-amber-700/80 dark:text-amber-300/80">
                    These are the default values that guide the agent on how to book appointments. <strong>Do not change anything here</strong> unless you're comfortable with the entire system and understand how booking works.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-sm font-mono">
                  Prompt-5
                </Badge>
                <span className="text-sm text-muted-foreground">Booking Instructions</span>
                {voicePrompt5Saved && (
                  <Badge className="bg-green-500 hover:bg-green-600 text-white">
                    Configured
                  </Badge>
                )}
              </div>

              <div className="space-y-4">
                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt5.name 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-5-name" className="text-sm font-medium">
                    Prompt Name
                  </Label>
                  <Input
                    id="voice-prompt-5-name"
                    value={voicePrompt5.name}
                    onChange={(e) => setVoicePrompt5(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Booking Instructions"
                    className="w-full"
                  />
                </div>

                <div className="space-y-2 p-4 rounded-lg border border-border bg-muted/30">
                  <Label htmlFor="voice-prompt-5-description" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Input
                    id="voice-prompt-5-description"
                    value={voicePrompt5.description}
                    onChange={(e) => setVoicePrompt5(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description..."
                    className="w-full"
                  />
                </div>

                <div className={cn(
                  "space-y-2 p-4 rounded-lg border-2",
                  voicePrompt5.content 
                    ? "border-green-500 bg-green-500/10" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <Label htmlFor="voice-prompt-5-content" className="text-sm font-medium">
                    Prompt Content (Markdown)
                  </Label>
                  <Textarea
                    id="voice-prompt-5-content"
                    value={voicePrompt5.content}
                    onChange={(e) => setVoicePrompt5(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter the booking instructions..."
                    className="w-full min-h-[300px] font-mono text-sm leading-relaxed"
                    rows={15}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => saveNumberedPrompt('voice-5', voicePrompt5, setVoicePrompt5Saving, setVoicePrompt5Saved, 'voice-prompts-setup-5', 'Booking')}
                    disabled={voicePrompt5Saving || !voicePrompt5.name.trim() || !voicePrompt5.content.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {voicePrompt5Saving ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {voicePrompt5Saving ? 'Saving...' : 'Save Prompt'}
                  </Button>
                </div>
              </div>

              <div className="border-t pt-6 mt-6">
                <EmbeddedPromptChat
                  onAcceptPrompt={(prompt) => setVoicePrompt5(prev => ({ ...prev, content: prompt.content }))}
                  onClose={() => {}}
                  currentPromptContent={voicePrompt5.content}
                  promptTitle={voicePrompt5.name || 'Booking Instructions'}
                  disableAutoScroll
                />
              </div>
            </div>
          )
        }
      ]
    },
    // Knowledgebase Setup Phase
    {
      id: 'knowledgebase-setup',
      title: 'Knowledgebase Setup',
      description: 'Configure the knowledgebase workflow for AI memory',
      steps: [
        // Step 1: Open Workflow
        {
          id: 'open-workflow',
          title: 'Open Workflow',
          description: 'Navigate to the Update Knowledgebase workflow in n8n',
          content: (
            <div className="space-y-4">
              <p>Navigate to your n8n instance and find the <strong>Update Knowledgebase</strong> workflow:</p>
              
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to your n8n instance</li>
                  <li>Navigate to the <strong>Knowledgebase Automation</strong> folder</li>
                  <li>Click on <strong>Update Knowledgebase</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={n8nKbWorkflowList} alt="n8n Knowledgebase Workflow in list" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> This workflow handles adding, updating, and deleting documents from your AI knowledgebase.
                </p>
              </div>
            </div>
          )
        },
        // Step 2: Connect Supabase Nodes
        {
          id: 'connect-supabase-nodes',
          title: 'Connect Supabase Nodes',
          description: 'Select your existing Supabase connection for all Supabase nodes',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Click on each Supabase node and select the connection you already set up previously. <strong>No need to create a new one!</strong></p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Supabase nodes to configure:</p>
                <p className="text-sm text-muted-foreground">There are 3 Supabase nodes in this workflow (highlighted in red circles):</p>
              </div>

              <SmoothImage src={n8nKbSupabaseNodesHighlight} alt="Supabase nodes highlighted in workflow" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">For each Supabase node:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the node to open it</li>
                  <li>In <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Select your existing Supabase connection (the one you set up in the n8n Setup phase)</li>
                  <li>Repeat for all 3 Supabase nodes: <strong>Delete a row1</strong>, <strong>Delete a row</strong>, and <strong>Knowledgebase_Upload</strong></li>
                </ol>
              </div>

              <SmoothImage src={n8nKbSupabaseConnection} alt="Selecting Supabase connection in node" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> Use the same Supabase connection for all 3 nodes. You already created this connection in the n8n Setup phase - no need to create a new one!
                </p>
              </div>
            </div>
          )
        },
        // Step 3: Connect Embeddings Node
        {
          id: 'connect-embeddings',
          title: 'Connect Embeddings Node',
          description: 'Select your existing OpenAI connection for the Embeddings node',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Click on the <strong>Embeddings OpenAI</strong> node and select the same OpenAI account you already set up.</p>

              <SmoothImage src={n8nKbEmbeddingsHighlight} alt="Embeddings OpenAI node highlighted" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Embeddings OpenAI1</strong> node</li>
                  <li>In <strong>"Credential to connect with"</strong> dropdown</li>
                  <li>Select your existing <strong>OpenAI account</strong> (the one you set up in the Account Creation phase)</li>
                </ol>
              </div>

              <SmoothImage src={n8nKbEmbeddingsOpenai} alt="Selecting OpenAI connection in Embeddings node" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> This is the same OpenAI connection you already set up in the Account Creation phase - just select it from the dropdown, no need to create a new one!
                </p>
              </div>
            </div>
          )
        },
        // Step 4: Setup Webhook
        {
          id: 'setup-webhook',
          title: 'Setup Webhook',
          description: 'Copy the webhook URL and save it',
          content: (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Paste the Knowledgebase webhook URL from n8n below.</p>

              {/* Webhook URL Input Field - Interactive - AT TOP */}
              <div className={cn(
                "space-y-2 p-4 rounded-lg border-2 relative",
                knowledgebaseWebhookSaved
                  ? "border-green-500 bg-green-500/10"
                  : "animate-pulse-red border-red-500/50 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Knowledgebase Webhook URL</Label>
                  {knowledgebaseWebhookSaved && (
                    <Badge className="bg-green-500 hover:bg-green-600 text-white">
                      Configured
                    </Badge>
                  )}
                </div>
                <Input
                  type="text"
                  value={knowledgebaseWebhook}
                  onChange={(e) => setKnowledgebaseWebhook(e.target.value)}
                  placeholder="Paste the Production URL here"
                  className="font-mono text-sm"
                />
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={saveKnowledgebaseWebhook}
                    disabled={savingWebhook || !knowledgebaseWebhook.trim()}
                    size="sm"
                  >
                    {savingWebhook ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Click on the Webhook node</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the Update Knowledgebase workflow</li>
                  <li>Click on the <strong>Webhook</strong> node</li>
                </ol>
              </div>

              <SmoothImage src={n8nKbWebhookHighlight} alt="Webhook node highlighted" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: Copy the Production URL</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on <strong>"Production URL"</strong> tab</li>
                  <li>Copy the URL shown</li>
                  <li>Paste it in the field above and click <strong>Save</strong></li>
                </ol>
              </div>

              <SmoothImage src={n8nKbWebhookUrl} alt="Webhook Production URL" />
            </div>
          )
        },
        // Step 5: Publish
        {
          id: 'publish',
          title: 'Save & Publish',
          description: 'Activate and save the workflow',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Activate and save the workflow to make it ready for use.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Make sure the <strong>Active</strong> toggle is ON in the top right corner</li>
                  <li>Click <strong>Save</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={n8nKbSaveButton} alt="Save button in n8n" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your Knowledgebase workflow is now configured and ready to use. You can now add documents from the Knowledge Base page in this dashboard.
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    // Live Chat Setup Phase
    {
      id: 'live-chat-setup',
      title: 'Live Chat Setup',
      description: 'Deploy and test your AI Rep with Live Chat widget',
      steps: [
        // Step 1: Navigate to Chat Widget
        {
          id: 'navigate-chat-widget',
          title: 'Navigate to Chat Widget',
          description: 'Go to Sites and find the Chat Widget section in HighLevel',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Congratulations! Your AI Rep is now fully set up. Let&apos;s deploy a <strong>Live Chat Widget</strong> to test it on your website.
              </p>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>How it works:</strong> The Live Chat widget automatically connects to your AI Rep through the <strong>Receive & Process DMs</strong> workflow you already set up in HighLevel. No additional configuration needed!
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, go to <strong>Sites</strong> in the left sidebar</li>
                  <li>Click on <strong>Chat Widget</strong> tab in the top navigation</li>
                  <li>You will see our Demo Widget here, or if you don&apos;t have one yet, click <strong>+ New</strong></li>
                </ol>
              </div>

              <SmoothImage src={ghlSitesChatWidget} alt="HighLevel Sites - Chat Widget section" />
            </div>
          )
        },
        // Step 2: Create Live Chat Widget
        {
          id: 'create-live-chat',
          title: 'Create Live Chat Widget',
          description: 'Select Live Chat as the widget type',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">When you click <strong>+ New</strong>, you&apos;ll see a popup to select the type of chat widget.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>+ New</strong> button</li>
                  <li>In the popup, select <strong>Live Chat</strong></li>
                  <li>This creates a real-time website chat powered by your team or conversation AI</li>
                </ol>
              </div>

              <SmoothImage src={ghlSelectLiveChat} alt="Select Live Chat widget type" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> Live Chat engages visitors instantly through real-time website chat. It&apos;s powered by your AI Rep, anytime, anywhere.
                </p>
              </div>
            </div>
          )
        },
        // Step 3: Configure Widget Style
        {
          id: 'configure-style',
          title: 'Configure Widget Style',
          description: 'Customize colors, themes, and appearance',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">In the <strong>Style</strong> tab, you&apos;ll customize the look and feel of your chat widget.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Style Options:</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li><strong>Chat Prompt</strong> - Choose the style of the chat bubble</li>
                  <li><strong>Chat Icon</strong> - Select the icon that appears on your website</li>
                  <li><strong>Theme</strong> - Pick a color theme that matches your brand</li>
                  <li><strong>Welcome Message</strong> - Set the initial message visitors see</li>
                  <li><strong>Bio Image</strong> - Add your avatar or company logo</li>
                </ul>
              </div>

              <SmoothImage src={ghlWidgetStyleTab} alt="Chat Widget Style tab configuration" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> You can customize different colors, styles and bio images that you can then deploy to any website you want.
                </p>
              </div>
            </div>
          )
        },
        // Step 4: Configure Chat Window
        {
          id: 'configure-chat-window',
          title: 'Configure Chat Window',
          description: 'Set up title, intro, and chat settings',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">In the <strong>Chat Window</strong> tab, configure the chat experience for your visitors.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Chat Window Settings:</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li><strong>Title & Intro</strong> - Set the header text and introduction</li>
                  <li><strong>Live Chat Assigned</strong> - Configure who handles the chat</li>
                  <li><strong>Live Chat Closed</strong> - Set messages for when chat is unavailable</li>
                  <li><strong>Business Hour Setup</strong> - Define when the chat is active</li>
                  <li><strong>Additional Options</strong> - Other customization settings</li>
                </ul>
              </div>

              <SmoothImage src={ghlWidgetChatWindow} alt="Chat Window tab with settings" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> You can choose the settings you need based on your preference. The preview on the right shows how it will look to visitors.
                </p>
              </div>
            </div>
          )
        },
        // Step 5: Configure Contact Form
        {
          id: 'configure-contact-form',
          title: 'Configure Contact Form',
          description: 'Decide whether to require lead info before chatting',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">One of the most important settings is the <strong>Enable Contact Form</strong> option.</p>

              <SmoothImage src={ghlWidgetContactForm} alt="Enable Contact Form toggle" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium text-amber-600 dark:text-amber-400">Important Decision</p>
                <p className="text-sm mt-2">
                  If you <strong>enable</strong> the contact form, the user would need to first fill out this form (Name, Phone, Email) to start chatting with your AI Rep.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Our Recommendation:</p>
                <p className="text-sm">We usually keep this <strong>OFF</strong> to not confuse the AI Rep and the person.</p>
                <p className="text-sm mt-2">However, if you need to capture all the leads you can enable it, just note that of course the message rate will be lower since not all the leads would want to provide this info without chatting first.</p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Other Settings:</p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                  <li><strong>Show Live Chat Welcome Message</strong> - Initial greeting</li>
                  <li><strong>Time Out Delay</strong> - User inactivity timeout</li>
                  <li><strong>Time Out Message</strong> - Message shown on timeout</li>
                </ul>
              </div>
            </div>
          )
        },
        // Step 6: Configure Messaging
        {
          id: 'configure-messaging',
          title: 'Configure Messaging',
          description: 'Set up acknowledgement and feedback messages',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">In the <strong>Messaging</strong> tab, set up the default messages that the lead sees after or before talking to your AI Rep.</p>

              <SmoothImage src={ghlWidgetMessaging} alt="Messaging tab with acknowledgement settings" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Messaging Settings:</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li><strong>Acknowledgement Message</strong> - e.g., &quot;Your chat has ended&quot;</li>
                  <li><strong>Feedback Message</strong> - e.g., &quot;Please rate your experience&quot;</li>
                  <li><strong>Feedback Submission Note</strong> - Thank you message</li>
                  <li><strong>Chat Ended Message</strong> - How to start a new chat</li>
                  <li><strong>Acknowledgement Icon</strong> - Icon style for system messages</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> These messages provide a better customer experience with better acknowledgement and language supports.
                </p>
              </div>
            </div>
          )
        },
        // Step 7: Save Widget
        {
          id: 'save-widget',
          title: 'Save Widget',
          description: 'Save your widget configuration',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Once you&apos;ve configured all the settings, save your widget.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Review all your settings in Style, Chat Window, and Messaging tabs</li>
                  <li>Click the <strong>Save</strong> button in the top right corner</li>
                  <li>Wait for the save confirmation</li>
                </ol>
              </div>

              <SmoothImage src={ghlWidgetSave} alt="Save button in widget editor" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Done!</strong> Your widget configuration is now saved. Next, we&apos;ll get the code to deploy it to your website.
                </p>
              </div>
            </div>
          )
        },
        // Step 8: Get Code & Understand Auto-Connection
        {
          id: 'get-code-deploy',
          title: 'Get Code & Deploy',
          description: 'Copy the script and deploy to your website',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">Get the embed code and understand how the widget automatically connects to your AI Rep.</p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Get the Code</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>Get Code</strong> button in the top right</li>
                  <li>Choose <strong>Via Code</strong> or <strong>Via GTM</strong></li>
                  <li>Copy the script code</li>
                  <li>Paste it in the <strong>header</strong> of your website</li>
                </ol>
              </div>

              <SmoothImage src={ghlWidgetGetCode} alt="Get Code dialog with script" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">Very Important to Understand</p>
                <p className="text-sm mt-2">
                  <strong>YOU DO NOT NEED TO DO ANYTHING ELSE!</strong> The widget automatically connects to your AI Rep.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How it Works:</p>
                <p className="text-sm">If you remember, you already set up the <strong>Receive & Process DMs</strong> workflow in HighLevel. If you go to this workflow, you will see <strong>Live Chat</strong> as a channel trigger.</p>
                <p className="text-sm mt-2">It basically means that whenever someone sends a DM to the Live Chat widget that you just created - it will trigger this HighLevel workflow - and then all other workflows will be triggered, the reply will be sent to n8n, it will generate the response and send it back to the user inside the live chat.</p>
              </div>

              <SmoothImage src={ghlReceiveDmsLiveChat} alt="Receive & Process DMs workflow with Live Chat trigger" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p className="font-medium text-green-600 dark:text-green-400">It Works Like Any Other Channel!</p>
                <p className="text-sm mt-1">
                  It doesn&apos;t matter if it&apos;s Facebook Messenger, SMS, or Live Chat - whenever a message (DM) is received, it triggers this workflow and generates the reply. So you don&apos;t need to do anything extra!
                </p>
              </div>

              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                <p className="text-sm">
                  <strong className="text-red-600 dark:text-red-400">Before Testing - Important:</strong> <strong>JUST MAKE SURE</strong> that ALL your Text AI Rep workflows inside HighLevel are <strong>enabled/published</strong> already - this way you can just deploy the live chat widget to your website and it will start working!
                </p>
              </div>
            </div>
          )
        }
      ]
    },
    // WhatsApp Setup Phase
    {
      id: 'whatsapp-setup',
      title: 'WhatsApp Setup',
      description: 'Connect WhatsApp to your AI Rep',
      steps: [
        // Step 1: Understand the Logic
        {
          id: 'understand-whatsapp-logic',
          title: 'Understand the Logic',
          description: 'Important things to know before setting up WhatsApp',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Before setting up WhatsApp, there are some <strong>critical things</strong> you need to understand about how WhatsApp integration works with HighLevel.
              </p>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-2">
                <p className="text-sm">
                  <strong className="text-amber-600 dark:text-amber-400">Very Important:</strong> When you connect a phone number to WhatsApp through HighLevel (which uses Meta APIs), <strong>you will NOT be able to use this phone number on your iPhone/Android WhatsApp app or the desktop app</strong>.
                </p>
                <p className="text-sm">
                  This WhatsApp number can <strong>ONLY</strong> be used inside HighLevel. Because the phone number is connected through the API, you cannot log in to the WhatsApp app with this number - it will not work.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">How WhatsApp Works with AI Rep:</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li>WhatsApp is <strong>just another channel</strong> like Live Chat, SMS, or Facebook Messenger</li>
                  <li>Once set up, it uses the <strong>SAME workflows</strong> - Receive & Process DMs, Generate Reply, Send Reply</li>
                  <li>The AI Rep will respond to WhatsApp messages exactly like it does for other channels</li>
                </ul>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">Prerequisites:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>You need to <strong>subscribe to WhatsApp</strong> in HighLevel ($10/month)</li>
                  <li>You need a <strong>phone number</strong> to connect to WhatsApp</li>
                  <li>Your <strong>Text AI Rep workflows</strong> should already be set up and published</li>
                </ol>
              </div>
            </div>
          )
        },
        // Step 2: Subscribe to WhatsApp
        {
          id: 'subscribe-whatsapp',
          title: 'Subscribe to WhatsApp',
          description: 'Pay the $10/month WhatsApp subscription in HighLevel',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                HighLevel charges a <strong>$10/month fee</strong> for the WhatsApp integration. You need to pay this subscription before you can set up WhatsApp.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, go to <strong>Settings</strong> in the left sidebar</li>
                  <li>Click on <strong>WhatsApp</strong> in the settings menu</li>
                  <li>You will see the WhatsApp subscription page</li>
                  <li>Click the <strong>&quot;PAY $10 &amp; SUBSCRIBE&quot;</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={whatsappSubscribe} alt="WhatsApp subscription page with Pay $10 & Subscribe button" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> If you already have WhatsApp activated, you will see the WhatsApp Business dashboard instead of the subscription page. In that case, skip to the next step.
                </p>
              </div>
            </div>
          )
        },
        // Step 3: Get a Phone Number
        {
          id: 'get-phone-number',
          title: 'Get a Phone Number',
          description: 'Understand the three options for WhatsApp phone numbers',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                After subscribing, you&apos;ll see the WhatsApp Business dashboard. You need a phone number to connect to WhatsApp. There are <strong>three options</strong>:
              </p>

              <SmoothImage src={whatsappBusinessDashboard} alt="WhatsApp Business dashboard showing phone numbers" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium text-blue-600 dark:text-blue-400">Option 1: Buy from HighLevel Directly</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li>Go to <strong>Settings → Phone System</strong></li>
                  <li>Buy a phone number directly from HighLevel</li>
                  <li>This number can be used for <strong>texting AND WhatsApp</strong></li>
                  <li><strong>Disadvantage:</strong> This number cannot be used for Voice AI Rep (Retell)</li>
                </ul>
              </div>

              <SmoothImage src={phoneSystemNumbers} alt="Phone System showing HighLevel phone numbers" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium text-green-600 dark:text-green-400">Option 2: Use a Twilio Number (Recommended)</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li>Create a Twilio account and buy a number there</li>
                  <li>Connect your Twilio account to HighLevel</li>
                  <li>The Twilio numbers will automatically sync to HighLevel</li>
                  <li><strong>Advantage:</strong> Same number can be used for SMS, WhatsApp, AND Voice AI Rep</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium text-purple-600 dark:text-purple-400">Option 3: Add Your Own Phone Number</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li>Use a physical SIM card phone number</li>
                  <li>This number will be used <strong>specifically for WhatsApp only</strong></li>
                  <li>You&apos;ll need to verify the number via text message</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Recommendation:</strong> If you want to use the same number for Voice AI Rep, Text AI Rep, and WhatsApp - use a Twilio number (Option 2).
                </p>
              </div>
            </div>
          )
        },
        // Step 4: Add Number to WhatsApp
        {
          id: 'add-number-whatsapp',
          title: 'Add Number to WhatsApp',
          description: 'Click Add Number to start connecting your phone number',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Once you have your phone number ready (in HighLevel&apos;s Phone System), you can add it to WhatsApp.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Settings → WhatsApp</strong></li>
                  <li>Click the <strong>&quot;+ Add Number&quot;</strong> button in the top right</li>
                </ol>
              </div>

              <SmoothImage src={whatsappAddNumber} alt="WhatsApp Business dashboard with Add Number button highlighted" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> When you click Add Number, you&apos;ll see a popup showing all the phone numbers you have available in HighLevel (whether bought directly or synced from Twilio).
                </p>
              </div>
            </div>
          )
        },
        // Step 5: Configure Phone Number
        {
          id: 'configure-phone-number',
          title: 'Configure Phone Number',
          description: 'Select your number or add your own',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                In the &quot;Configure Phone Number&quot; popup, you have two choices:
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Option A: Select from Your Phone Numbers</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>You&apos;ll see a list of phone numbers already in HighLevel</li>
                  <li>These are numbers bought from HighLevel or synced from Twilio</li>
                  <li>Select the number you want to use for WhatsApp</li>
                  <li>Click <strong>&quot;Proceed to verify&quot;</strong></li>
                </ol>
              </div>

              <SmoothImage src={whatsappConfigureSelect} alt="Configure Phone Number popup with number selection" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium text-amber-600 dark:text-amber-400">Remember!</p>
                <p className="text-sm mt-2">
                  Once you connect a number here, <strong>you will no longer be able to use it on the WhatsApp mobile app</strong>. It can only be used inside HighLevel.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Option B: Add Your Own Phone Number</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>If you have a physical SIM card number you want to use</li>
                  <li>Enter your phone number in the input field at the bottom</li>
                  <li>You&apos;ll receive a text to verify the number</li>
                  <li>Follow the verification steps</li>
                </ol>
              </div>

              <SmoothImage src={whatsappConfigureOwn} alt="Configure Phone Number popup with own number input" />
            </div>
          )
        },
        // Step 6: Verify Connection Status
        {
          id: 'verify-connection-status',
          title: 'Verify Connection Status',
          description: 'Make sure your WhatsApp number shows as Connected',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                After completing the setup, verify that your phone number is properly connected.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to <strong>Settings → WhatsApp</strong></li>
                  <li>Look at the <strong>Status</strong> column in the phone numbers table</li>
                  <li>Your number should show as <strong>&quot;Connected&quot;</strong> (in green)</li>
                </ol>
              </div>

              <SmoothImage src={whatsappConnectedStatus} alt="WhatsApp Business showing Connected status" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Success!</strong> If you see &quot;Connected&quot; status, your WhatsApp number is ready. Now we need to make sure the workflow trigger is enabled.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>If you see &quot;Pending&quot;:</strong> Wait a few minutes and refresh the page. If it stays pending, check that you completed all verification steps.
                </p>
              </div>
            </div>
          )
        },
        // Step 7: Enable WhatsApp Trigger in Workflow
        {
          id: 'enable-whatsapp-trigger',
          title: 'Enable WhatsApp Trigger',
          description: 'Verify the WhatsApp trigger is enabled in your workflow',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The WhatsApp integration uses the <strong>same workflows</strong> as your other channels. You just need to make sure the WhatsApp trigger is enabled.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> in HighLevel</li>
                  <li>Open the <strong>&quot;Receive & Process DMs&quot;</strong> workflow</li>
                  <li>Check that the workflow is <strong>Published</strong> (toggle should be ON)</li>
                  <li>Look at the triggers at the top - you should see a <strong>&quot;Whatsapp&quot;</strong> trigger</li>
                </ol>
              </div>

              <SmoothImage src={whatsappWorkflowTrigger} alt="Receive & Process DMs workflow showing WhatsApp trigger" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">How It Works:</p>
                <p className="text-sm mt-2">
                  Whenever someone sends a DM to your WhatsApp number, this workflow is triggered. The message goes through the same process - n8n generates the AI response and sends it back to the user inside WhatsApp.
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Same Workflows!</strong> You don&apos;t need to create new workflows. WhatsApp is just another channel that triggers the same Receive & Process DMs, Generate Reply, and Send Reply workflows.
                </p>
              </div>
            </div>
          )
        },
        // Step 8: Test WhatsApp
        {
          id: 'test-whatsapp',
          title: 'Test WhatsApp',
          description: 'Send a test message to verify everything works',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Time to test your WhatsApp integration! Send a message from your personal WhatsApp to the connected number.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Open <strong>WhatsApp</strong> on your phone (your personal WhatsApp account)</li>
                  <li>Start a new chat with your <strong>connected WhatsApp number</strong></li>
                  <li>Send a test message like &quot;Hello&quot;</li>
                  <li>Wait for the AI Rep to respond</li>
                </ol>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Verify in HighLevel:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Conversations</strong> in HighLevel</li>
                  <li>You should see a new conversation from your contact</li>
                  <li>You&apos;ll see your message and the AI Rep&apos;s response</li>
                </ol>
              </div>

              <SmoothImage src={whatsappConversationsTest} alt="HighLevel Conversations showing WhatsApp messages" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p className="font-medium text-green-600 dark:text-green-400">Congratulations!</p>
                <p className="text-sm mt-1">
                  If you see your message in the Conversations tab and the AI Rep responds, your WhatsApp integration is fully working! The AI Rep will now handle all incoming WhatsApp messages automatically.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium">Troubleshooting:</p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm mt-2">
                  <li>Make sure all your workflows are <strong>published</strong> in HighLevel</li>
                  <li>Verify n8n workflows are <strong>active</strong></li>
                  <li>Check that the WhatsApp number status is <strong>&quot;Connected&quot;</strong></li>
                </ul>
              </div>
            </div>
          )
        }
      ]
    },
    // SMS Setup Phase
    {
      id: 'sms-setup',
      title: 'SMS Setup',
      description: 'Set up SMS texting with A2P verification',
      steps: [
        // Step 1: Understand A2P Verification
        {
          id: 'understand-a2p',
          title: 'Understand A2P Verification',
          description: 'What is A2P and why you need it for US/Canada numbers',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Before setting up SMS texting, you need to understand <strong>A2P (Application-to-Person) verification</strong> - a requirement for sending SMS messages in the US and Canada.
              </p>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="text-sm">
                  <strong className="text-amber-600 dark:text-amber-400">Very Important:</strong> If you want to send SMS text messages to phone numbers in the <strong>US or Canada</strong>, you <strong>MUST</strong> complete the A2P verification. Without it, your messages may not be delivered or your number could be blocked.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">What is A2P Verification?</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li><strong>A2P</strong> stands for &quot;Application-to-Person&quot; messaging</li>
                  <li>It&apos;s a registration process required by US carriers (AT&T, T-Mobile, Verizon)</li>
                  <li>It verifies that your business is legitimate and your messages are not spam</li>
                  <li>Without A2P, carriers may block or filter your messages</li>
                </ul>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">When You Need A2P:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 mt-2">
                  <li><strong>Required:</strong> US and Canada phone numbers</li>
                  <li><strong>Not Required:</strong> UK, European, and other international numbers</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Good News:</strong> We have a separate detailed guide for completing the A2P verification process. In this guide, we&apos;ll assume your A2P is already complete.
                </p>
              </div>
            </div>
          )
        },
        // Step 2: Phone Number Options
        {
          id: 'phone-number-options',
          title: 'Phone Number Options',
          description: 'Understand your options for getting a phone number',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                As you already know from the WhatsApp setup, there are two main ways to get a phone number for texting:
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium text-blue-600 dark:text-blue-400">Option 1: Buy from HighLevel Directly</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li>Go to <strong>Settings → Phone System</strong></li>
                  <li>Buy a US-based phone number directly from HighLevel</li>
                  <li>You will need to <strong>complete A2P verification inside HighLevel</strong></li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium text-green-600 dark:text-green-400">Option 2: Use a Twilio Number</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li>Buy a number from Twilio and connect your Twilio account to HighLevel</li>
                  <li>You will need to <strong>complete A2P verification inside Twilio</strong></li>
                  <li><strong>Advantage:</strong> Same number can be used for SMS, WhatsApp, AND Voice AI Rep</li>
                </ul>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> It doesn&apos;t matter which option you choose - if you&apos;re using a US or Canada-based phone number, you MUST complete the A2P verification. The only difference is <strong>where</strong> you complete it:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm mt-2">
                  <li>HighLevel number → A2P verification in HighLevel</li>
                  <li>Twilio number → A2P verification in Twilio</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Recommendation:</strong> If you want to use the same number for Voice AI Rep, Text AI Rep, and WhatsApp - use a Twilio number.
                </p>
              </div>
            </div>
          )
        },
        // Step 3: Verify A2P Complete
        {
          id: 'verify-a2p-complete',
          title: 'Verify A2P Complete',
          description: 'Make sure your phone number has completed A2P verification',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Let&apos;s verify that your phone number is ready for SMS texting with A2P completed.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, go to <strong>Settings → Phone System</strong></li>
                  <li>Look at the <strong>Phone Numbers</strong> tab</li>
                  <li>Find your US/Canada phone number in the list</li>
                  <li>Check if there are any <strong>A2P warnings</strong> or messages</li>
                </ol>
              </div>

              <SmoothImage src={smsPhoneNumbersA2p} alt="Phone System showing phone numbers with A2P status" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p className="font-medium text-green-600 dark:text-green-400">If A2P is Complete:</p>
                <p className="text-sm mt-1">
                  Your phone number should appear without any warning messages about A2P registration. It&apos;s ready for texting!
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium text-amber-600 dark:text-amber-400">If You See &quot;A2P Required&quot; Message:</p>
                <p className="text-sm mt-1">
                  You need to complete the A2P verification before your texts will be delivered. Please follow our separate A2P guide to complete this step.
                </p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Note:</strong> UK, European, and other international numbers don&apos;t need A2P verification. If you&apos;re using one of these numbers, you can skip directly to the workflow setup.
                </p>
              </div>
            </div>
          )
        },
        // Step 4: Enable SMS Trigger
        {
          id: 'enable-sms-trigger',
          title: 'Enable SMS Trigger',
          description: 'Verify the SMS trigger is enabled in your workflow',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Just like with WhatsApp and Live Chat, SMS uses the <strong>same workflows</strong>. You just need to make sure the SMS trigger is enabled.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> in HighLevel</li>
                  <li>Open the <strong>&quot;Receive & Process DMs&quot;</strong> workflow</li>
                  <li>Check that the workflow is <strong>Published</strong> (toggle should be ON)</li>
                  <li>Look at the triggers at the top - you should see an <strong>&quot;SMS&quot;</strong> trigger</li>
                </ol>
              </div>

              <SmoothImage src={smsWorkflowTrigger} alt="Receive & Process DMs workflow showing SMS trigger" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">How It Works:</p>
                <p className="text-sm mt-2">
                  Whenever someone sends an SMS text to your phone number, this workflow is triggered. The message goes through the same process - n8n generates the AI response and sends it back to the user via SMS.
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Same Workflows!</strong> You don&apos;t need to create new workflows. SMS is just another channel that triggers the same Receive & Process DMs, Generate Reply, and Send Reply workflows.
                </p>
              </div>
            </div>
          )
        },
        // Step 5: Test SMS
        {
          id: 'test-sms',
          title: 'Test SMS',
          description: 'Send a test message to verify everything works',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Time to test your SMS integration! Send a text message from your phone to your AI Rep&apos;s number.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Open the <strong>Messages app</strong> on your phone</li>
                  <li>Start a new text to your <strong>HighLevel phone number</strong></li>
                  <li>Send a test message like &quot;Hello&quot;</li>
                  <li>Wait for the AI Rep to respond</li>
                </ol>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Verify in HighLevel:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Conversations</strong> in HighLevel</li>
                  <li>You should see a new conversation from your contact</li>
                  <li>You&apos;ll see your message and the AI Rep&apos;s response</li>
                </ol>
              </div>

              <SmoothImage src={smsConversationsTest} alt="HighLevel Conversations showing SMS messages" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p className="font-medium text-green-600 dark:text-green-400">Congratulations!</p>
                <p className="text-sm mt-1">
                  If you see your message in the Conversations tab and the AI Rep responds, your SMS integration is fully working! The AI Rep will now handle all incoming SMS messages automatically.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium">Troubleshooting:</p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm mt-2">
                  <li>Make sure all your workflows are <strong>published</strong> in HighLevel</li>
                  <li>Verify n8n workflows are <strong>active</strong></li>
                  <li>Check that <strong>A2P verification is complete</strong> (for US/Canada numbers)</li>
                  <li>If texts aren&apos;t being delivered, A2P is likely the issue</li>
                </ul>
              </div>
            </div>
          )
        }
      ]
    },
    // Meta/Instagram Setup Phase
    {
      id: 'meta-instagram-setup',
      title: 'Meta/Instagram Setup',
      description: 'Connect Facebook and Instagram to your AI Rep',
      steps: [
        // Step 1: Understand Meta Integration
        {
          id: 'understand-meta-integration',
          title: 'Understand Meta Integration',
          description: 'How Facebook and Instagram work together with HighLevel',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Let&apos;s set up Meta (Facebook/Instagram) integration so your AI Rep can respond to DMs automatically.
              </p>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">How It Works:</p>
                <p className="text-sm mt-2">
                  Since Instagram is owned by Meta (Facebook), when you connect your Facebook account, you also get access to your connected Instagram accounts. This single connection allows your AI Rep to handle DMs from both platforms.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-2">
                <p className="font-medium text-amber-600 dark:text-amber-400">Important Requirements:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-sm">
                  <li><strong>Professional Instagram Account Required:</strong> Your Instagram must be a Professional account (Creator or Business). Personal accounts cannot be connected. You can convert your account in Instagram Settings.</li>
                  <li><strong>Facebook Business Page Required:</strong> Your Instagram account must be connected to a Facebook Business Page (not your personal Facebook profile).</li>
                  <li><strong>Personal Facebook DMs Not Supported:</strong> The AI Rep can only automate Facebook Messenger DMs sent to your Business Page, NOT your personal Facebook profile.</li>
                </ul>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">What Gets Connected:</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li><strong>Instagram DMs:</strong> When someone sends a DM to your connected Instagram Professional account, your AI Rep will respond automatically.</li>
                  <li><strong>Facebook Page Messenger:</strong> When someone sends a message to your Facebook Business Page through Messenger, your AI Rep will respond automatically.</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Good News:</strong> Once connected, Meta integration uses the same workflows as your other channels. No additional workflow setup is needed!
                </p>
              </div>
            </div>
          )
        },
        // Step 2: Connect Facebook/Instagram
        {
          id: 'connect-facebook-instagram',
          title: 'Connect Facebook/Instagram',
          description: 'Navigate to Integrations and connect your Meta account',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Let&apos;s connect your Facebook account to HighLevel to enable Instagram and Facebook Messenger integration.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, go to <strong>Settings → Integrations</strong></li>
                  <li>Find the <strong>Facebook &amp; Instagram</strong> card</li>
                  <li>Click the <strong>Connect</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={metaIntegrationsConnect} alt="HighLevel Integrations page showing Facebook & Instagram Connect button" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="text-sm">
                  The Facebook & Instagram card allows you to auto-sync ad leads, manage DMs, and respond to reviews and comments across all your Facebook Pages and Instagram handles.
                </p>
              </div>
            </div>
          )
        },
        // Step 3: Login to Facebook
        {
          id: 'login-to-facebook',
          title: 'Login to Facebook',
          description: 'Authenticate with your Facebook account',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                After clicking Connect, Facebook will ask you to log in to your account.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Enter your <strong>Facebook email and password</strong></li>
                  <li>Click <strong>Log In</strong></li>
                  <li>Follow any additional authentication steps Facebook may require (2FA, etc.)</li>
                </ol>
              </div>

              <SmoothImage src={metaFacebookLogin} alt="Facebook login page" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="text-sm">
                  <strong>Note:</strong> Use the Facebook account that manages your Business Page(s) and is connected to your Instagram Professional account.
                </p>
              </div>
            </div>
          )
        },
        // Step 4: Select Pages
        {
          id: 'select-pages',
          title: 'Select Pages',
          description: 'Choose which Facebook Pages and Instagram accounts to connect',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                After logging in, you&apos;ll see a list of all the Facebook Pages and Instagram accounts associated with your Facebook account.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Review the list of available pages</li>
                  <li><strong>Check the boxes</strong> next to the pages/accounts you want to connect</li>
                  <li>Look for pages with the <strong>Instagram icon</strong> - these are your connected Instagram accounts</li>
                  <li>Click <strong>Update and Continue</strong></li>
                </ol>
              </div>

              <SmoothImage src={metaSelectPages} alt="Select Facebook Pages and Instagram accounts modal" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">Understanding the Page List:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-sm mt-2">
                  <li>Pages with just the Facebook icon = Facebook Business Pages only</li>
                  <li>Pages with the Instagram icon = Instagram Professional accounts connected to that Facebook page</li>
                  <li>You can select multiple pages if you manage several business accounts</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> For now, select the main Instagram account you want your AI Rep to handle. You can always add more later.
                </p>
              </div>
            </div>
          )
        },
        // Step 5: Enable Workflow Triggers
        {
          id: 'enable-workflow-triggers',
          title: 'Enable Workflow Triggers',
          description: 'Verify Instagram and Facebook Messenger triggers are enabled',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Now let&apos;s make sure your <strong>Receive &amp; Process DMs</strong> workflow has the Instagram and Facebook Messenger triggers enabled.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> in HighLevel</li>
                  <li>Open the <strong>&quot;1 - Receive &amp; Process DMs&quot;</strong> workflow</li>
                  <li>Check that the workflow is <strong>Published</strong></li>
                  <li>Look at the triggers - you should see both <strong>Facebook Messenger</strong> and <strong>Instagram</strong> triggers</li>
                </ol>
              </div>

              <SmoothImage src={metaWorkflowTriggers} alt="Workflow showing Facebook Messenger and Instagram triggers" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">How It Works:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-sm mt-2">
                  <li>When someone DMs your Instagram account → <strong>Instagram trigger</strong> fires</li>
                  <li>When someone messages your Facebook Business Page via Messenger → <strong>Facebook Messenger trigger</strong> fires</li>
                  <li>Both go through the same workflow - n8n generates the AI response and sends it back</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Same Workflows!</strong> You don&apos;t need to create new workflows. Instagram and Facebook Messenger are just additional channels that trigger the same Receive &amp; Process DMs, Generate Reply, and Send Reply workflows.
                </p>
              </div>
            </div>
          )
        },
        // Step 6: Test DMs
        {
          id: 'test-meta-dms',
          title: 'Test Meta DMs',
          description: 'Send a test message to verify everything works',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Time to test your Meta integration! Send a DM from another account to your connected Instagram.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Open Instagram on your phone (from a <strong>different account</strong>)</li>
                  <li>Find and open your connected business Instagram account</li>
                  <li>Send a DM like &quot;Hello&quot;</li>
                  <li>Wait for the AI Rep to respond</li>
                </ol>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Verify in HighLevel:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Conversations</strong> in HighLevel</li>
                  <li>You should see a new conversation from your contact</li>
                  <li>Notice the <strong>&quot;IG Messenger DM&quot;</strong> tab showing it came from Instagram</li>
                  <li>You&apos;ll see your message and the AI Rep&apos;s response</li>
                </ol>
              </div>

              <SmoothImage src={metaConversationsTest} alt="HighLevel Conversations showing Instagram DM conversation with AI Rep" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p className="font-medium text-green-600 dark:text-green-400">Congratulations!</p>
                <p className="text-sm mt-1">
                  If you see your message in the Conversations tab and the AI Rep responds, your Meta integration is fully working! The AI Rep will now handle all incoming Instagram DMs and Facebook Page messages automatically.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium">Troubleshooting:</p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm mt-2">
                  <li>Make sure all your workflows are <strong>published</strong> in HighLevel</li>
                  <li>Verify n8n workflows are <strong>active</strong></li>
                  <li>Confirm your Instagram is a <strong>Professional account</strong></li>
                  <li>Make sure your Instagram is <strong>connected to a Facebook Business Page</strong></li>
                  <li>Remember: Personal Facebook Messenger DMs will <strong>NOT</strong> be automated</li>
                </ul>
              </div>
            </div>
          )
        }
      ]
    },
    // Inbound Voice AI Testing Phase
    {
      id: 'inbound-voice-ai-testing',
      title: 'Inbound Voice AI Testing',
      description: 'Test your Inbound Voice AI Rep with a live call',
      steps: [
        // Step 1: Complete Text AI Rep Setup (Prerequisite)
        {
          id: 'complete-text-ai-rep',
          title: 'Complete Text AI Rep Setup',
          description: 'Complete the Text AI Rep setup before testing inbound voice',
          content: (() => {
            // Phase IDs for Text AI Rep prerequisite
            const TEXT_AI_REP_PREREQ_PHASES = [
              'account-creation',
              'supabase-setup',
              'workflows-import',
              'n8n-setup',
              'text-prompts-setup',
              'highlevel-credentials',
              'highlevel-setup'
            ] as const;
            
            const PHASE_DISPLAY_NAMES: Record<string, string> = {
              'account-creation': 'Accounts Setup',
              'supabase-setup': 'Supabase Setup',
              'workflows-import': 'Workflows Import',
              'n8n-setup': 'Text AI Rep Setup',
              'text-prompts-setup': 'Text Prompts Setup',
              'highlevel-credentials': 'HighLevel Credentials',
              'highlevel-setup': 'HighLevel Setup'
            };
            
            const getPhaseStatus = (phaseId: string) => {
              const total = SETUP_PHASES[phaseId as keyof typeof SETUP_PHASES] || 0;
              let completed = 0;
              for (let i = 0; i < total; i++) {
                if (completedSteps.has(`${phaseId}-${i}`)) {
                  completed++;
                }
              }
              return { completed, total, isComplete: completed === total };
            };
            
            const getOverallStatus = () => {
              const totalSteps = TEXT_AI_REP_PREREQ_PHASES.reduce((sum, id) => sum + (SETUP_PHASES[id] || 0), 0);
              let completedCount = 0;
              TEXT_AI_REP_PREREQ_PHASES.forEach(phaseId => {
                const status = getPhaseStatus(phaseId);
                completedCount += status.completed;
              });
              const isComplete = TEXT_AI_REP_PREREQ_PHASES.every(phaseId => getPhaseStatus(phaseId).isComplete);
              return {
                completed: completedCount,
                total: totalSteps,
                percentage: Math.round((completedCount / totalSteps) * 100),
                isComplete
              };
            };
            
            const overallStatus = getOverallStatus();
            
            return (
              <div className="space-y-4">
                <p>
                  Before testing your Inbound Voice AI Rep, you need to complete the Text AI Rep setup. 
                  These phases are essential for the voice AI to work correctly.
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
                      <p className="font-medium">Text AI Rep Setup Progress</p>
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
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Text AI Rep Setup Phases Status</h4>
                  
                  {TEXT_AI_REP_PREREQ_PHASES.map((phaseId) => {
                    const status = getPhaseStatus(phaseId);
                    const phaseName = PHASE_DISPLAY_NAMES[phaseId] || phaseId;
                    
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
                    <strong>Important:</strong> All phases above must be completed in the Text AI Rep Setup Guide before proceeding with inbound voice testing.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/client/${clientId}/text-ai-rep/configuration`);
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to Text AI Rep Setup
                  </Button>
                </div>
              </div>
            );
          })()
        },
        // Step 2: Complete Voice AI Rep Setup (Prerequisite)
        {
          id: 'complete-voice-ai-rep',
          title: 'Complete Voice AI Rep Setup',
          description: 'Complete the Voice AI Rep inbound setup before testing',
          content: (() => {
            // Phase IDs for Voice AI Rep prerequisite (inbound)
            const VOICE_AI_REP_PREREQ_PHASES = [
              'twilio-setup',
              'voice-accounts-setup',
              'voice-inbound-setup',
              'voice-prompts-setup'
            ] as const;
            
            const PHASE_DISPLAY_NAMES: Record<string, string> = {
              'twilio-setup': 'Twilio Setup',
              'voice-accounts-setup': 'Accounts Setup',
              'voice-inbound-setup': 'Inbound AI Rep Setup',
              'voice-prompts-setup': 'Voice Prompts Setup'
            };
            
            const getPhaseStatus = (phaseId: string) => {
              const total = SETUP_PHASES[phaseId as keyof typeof SETUP_PHASES] || 0;
              let completed = 0;
              for (let i = 0; i < total; i++) {
                if (completedSteps.has(`${phaseId}-${i}`)) {
                  completed++;
                }
              }
              return { completed, total, isComplete: completed === total };
            };
            
            const getOverallStatus = () => {
              const totalSteps = VOICE_AI_REP_PREREQ_PHASES.reduce((sum, id) => sum + (SETUP_PHASES[id] || 0), 0);
              let completedCount = 0;
              VOICE_AI_REP_PREREQ_PHASES.forEach(phaseId => {
                const status = getPhaseStatus(phaseId);
                completedCount += status.completed;
              });
              const isComplete = VOICE_AI_REP_PREREQ_PHASES.every(phaseId => getPhaseStatus(phaseId).isComplete);
              return {
                completed: completedCount,
                total: totalSteps,
                percentage: Math.round((completedCount / totalSteps) * 100),
                isComplete
              };
            };
            
            const overallStatus = getOverallStatus();
            
            return (
              <div className="space-y-4">
                <p>
                  Before testing your Inbound Voice AI Rep, you need to complete the Voice AI Rep setup. 
                  This enables inbound voice calls to work correctly.
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
                      <p className="font-medium">Voice AI Rep Setup Progress</p>
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
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Voice AI Rep Setup Phases Status</h4>
                  
                  {VOICE_AI_REP_PREREQ_PHASES.map((phaseId) => {
                    const status = getPhaseStatus(phaseId);
                    const phaseName = PHASE_DISPLAY_NAMES[phaseId] || phaseId;
                    
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
                    <strong>Important:</strong> All phases above must be completed in the Voice AI Rep Setup Guide before proceeding with inbound voice testing.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/client/${clientId}/voice-ai-rep/configuration`);
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to Voice AI Rep Setup
                  </Button>
                </div>
              </div>
            );
          })()
        },
        // Step 3: Verify Retell Configuration
        {
          id: 'verify-retell-config',
          title: 'Verify Retell Configuration',
          description: 'Confirm your phone number has the correct agent and webhook',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Let&apos;s verify that your phone number in Retell is properly configured with the Inbound Agent and webhook.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps to Verify:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Retell AI Dashboard</strong></li>
                  <li>Navigate to <strong>Phone Numbers</strong> in the left sidebar</li>
                  <li>Click on your phone number to view its settings</li>
                  <li>Verify the <strong>Inbound Call Agent</strong> is set to your Inbound Voice AI Rep</li>
                  <li>Verify the <strong>Inbound Webhook</strong> checkbox is enabled and has your webhook URL</li>
                </ol>
              </div>

              <SmoothImage src={retellPhoneNumbers} alt="Retell Phone Numbers showing inbound agent and webhook configuration" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">What to Check:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-sm mt-2">
                  <li><strong>Inbound Call Agent:</strong> Should show your Inbound Voice AI Rep agent name</li>
                  <li><strong>Add an inbound webhook:</strong> Should be checked/enabled</li>
                  <li><strong>Webhook URL:</strong> Should contain your n8n webhook URL</li>
                </ul>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="font-medium">If Not Configured:</p>
                <p className="text-sm mt-1">
                  If you haven&apos;t set up the inbound agent or webhook yet, please complete the <strong>Voice AI Rep Configuration &gt; Inbound AI Rep Setup</strong> phase first.
                </p>
              </div>
            </div>
          )
        },
        // Step 4: Your AI Rep Phone Number
        {
          id: 'get-phone-number',
          title: 'Your AI Rep Phone Number',
          description: 'The phone number to call for testing',
          content: (() => {
            const hasPhoneNumber = retellConfig?.retell_phone_1 && retellConfig.retell_phone_1.trim() !== '';
            const phoneNumber = retellConfig?.retell_phone_1 || '';
            
            return (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Your Inbound Voice AI Rep is assigned to the phone number you configured in the Credentials section.
                </p>

                {/* Phone Number Field - same design as CredentialSyncField */}
                <div className={cn(
                  "space-y-2 rounded-lg p-4 border-2",
                  hasPhoneNumber 
                    ? "animate-pulse-blue border-blue-500/50 bg-blue-500/5" 
                    : "animate-pulse-red border-red-500/50 bg-red-500/5"
                )}>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Phone Number 1</Label>
                    {!hasPhoneNumber && (
                      <Badge className="bg-red-500 hover:bg-red-600 text-white">
                        Setup Required
                      </Badge>
                    )}
                  </div>
                  <Input 
                    type="text"
                    value={hasPhoneNumber ? phoneNumber : ''}
                    readOnly
                    placeholder={hasPhoneNumber ? '' : 'Not Configured'}
                    className="font-mono text-sm bg-background"
                  />
                  {hasPhoneNumber && (
                    <p className="text-xs text-muted-foreground">
                      This is the number you&apos;ll call to test your Inbound Voice AI Rep
                    </p>
                  )}
                </div>

                {hasPhoneNumber ? (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                    <p className="font-medium text-green-600 dark:text-green-400">Phone Number Found!</p>
                    <p className="text-sm mt-1">
                      Your phone number is configured. Proceed to the next step to make the test call.
                    </p>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                    <p className="font-medium text-red-600 dark:text-red-400">No Phone Number Configured</p>
                    <p className="text-sm mt-1">
                      Please go to <strong>Credentials</strong> and enter your phone number in the <strong>Phone Number 1</strong> field. This should be the phone number you purchased and configured in Retell.
                    </p>
                  </div>
                )}

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                  <p className="text-sm">
                    <strong>Note:</strong> The Phone Number 1 field in Credentials should match the phone number you configured in Retell with your Inbound Agent.
                  </p>
                </div>
              </div>
            );
          })()
        },
        // Step 5: Test Inbound Call
        {
          id: 'test-inbound-call',
          title: 'Test Inbound Call',
          description: 'Call your AI Rep and test the conversation',
          content: (() => {
            const hasPhoneNumber = retellConfig?.retell_phone_1 && retellConfig.retell_phone_1.trim() !== '';
            const phoneNumber = retellConfig?.retell_phone_1 || '';
            
            return (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Time to test your Inbound Voice AI Rep! Make a call and have a conversation with your AI agent.
                </p>

                {hasPhoneNumber ? (
                  <>
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-6 text-center">
                      <p className="font-medium mb-2">Call This Number:</p>
                      <div className="flex items-center justify-center gap-2">
                        <Phone className="h-5 w-5 text-blue-600" />
                        <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                          {phoneNumber}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        Your Inbound Voice AI Rep will answer
                      </p>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                      <p className="font-medium">Steps:</p>
                      <ol className="list-decimal list-inside space-y-2 ml-2">
                        <li>Open the <strong>Phone app</strong> on your mobile phone</li>
                        <li>Dial <strong>{phoneNumber}</strong></li>
                        <li>Wait for the AI Rep to answer</li>
                        <li>Have a conversation - ask questions, test booking, etc.</li>
                        <li>End the call when done testing</li>
                      </ol>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                      <p className="font-medium">What to Test:</p>
                      <ul className="list-disc list-inside space-y-2 ml-2">
                        <li>Verify the AI Rep greets you appropriately</li>
                        <li>Ask about your services or products</li>
                        <li>Try booking an appointment (if configured)</li>
                        <li>Ask to speak to a human (test transfer if configured)</li>
                      </ul>
                    </div>

                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                      <p className="font-medium text-green-600 dark:text-green-400">Congratulations!</p>
                      <p className="text-sm mt-1">
                        If your Inbound Voice AI Rep answers and has a meaningful conversation, your setup is complete! The AI will now handle all inbound calls to this number.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                    <p className="font-medium text-red-600 dark:text-red-400">Phone Number Required</p>
                    <p className="text-sm mt-1">
                      Please go back to the previous step and configure your phone number in the Credentials section.
                    </p>
                  </div>
                )}

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <p className="font-medium">Troubleshooting:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2 text-sm mt-2">
                    <li>If the call doesn&apos;t connect, verify the phone number in Retell</li>
                    <li>If the AI doesn&apos;t respond properly, check your voice prompts</li>
                    <li>Ensure the inbound webhook is correctly configured in Retell</li>
                    <li>Make sure your n8n workflows are active and published</li>
                  </ul>
                </div>
              </div>
            );
          })()
        }
      ]
    },
    // Demo Setup Phase
    {
      id: 'demo-setup',
      title: 'Demo Setup',
      description: 'Set up a demo to test your AI Rep workflow',
      steps: [
        // Step 1: Complete Text AI Rep Setup (Prerequisite)
        {
          id: 'complete-text-ai-rep',
          title: 'Complete Text AI Rep Setup',
          description: 'Complete the Text AI Rep setup before configuring the demo',
          content: (() => {
            // Phase IDs for Text AI Rep prerequisite
            const TEXT_AI_REP_PREREQ_PHASES = [
              'account-creation',
              'supabase-setup',
              'workflows-import',
              'n8n-setup',
              'text-prompts-setup',
              'highlevel-credentials',
              'highlevel-setup'
            ] as const;
            
            const PHASE_DISPLAY_NAMES: Record<string, string> = {
              'account-creation': 'Accounts Setup',
              'supabase-setup': 'Supabase Setup',
              'workflows-import': 'Workflows Import',
              'n8n-setup': 'Text AI Rep Setup',
              'text-prompts-setup': 'Text Prompts Setup',
              'highlevel-credentials': 'HighLevel Credentials',
              'highlevel-setup': 'HighLevel Setup'
            };
            
            const getPhaseStatus = (phaseId: string) => {
              const total = SETUP_PHASES[phaseId as keyof typeof SETUP_PHASES] || 0;
              let completed = 0;
              for (let i = 0; i < total; i++) {
                if (completedSteps.has(`${phaseId}-${i}`)) {
                  completed++;
                }
              }
              return { completed, total, isComplete: completed === total };
            };
            
            const getOverallStatus = () => {
              const totalSteps = TEXT_AI_REP_PREREQ_PHASES.reduce((sum, id) => sum + (SETUP_PHASES[id] || 0), 0);
              let completedCount = 0;
              TEXT_AI_REP_PREREQ_PHASES.forEach(phaseId => {
                const status = getPhaseStatus(phaseId);
                completedCount += status.completed;
              });
              const isComplete = TEXT_AI_REP_PREREQ_PHASES.every(phaseId => getPhaseStatus(phaseId).isComplete);
              return {
                completed: completedCount,
                total: totalSteps,
                percentage: Math.round((completedCount / totalSteps) * 100),
                isComplete
              };
            };
            
            const overallStatus = getOverallStatus();
            
            return (
              <div className="space-y-4">
                <p>
                  Before setting up the demo, you need to complete the Text AI Rep setup. 
                  These phases are essential for the demo to work correctly.
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
                      <p className="font-medium">Text AI Rep Setup Progress</p>
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
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Text AI Rep Setup Phases Status</h4>
                  
                  {TEXT_AI_REP_PREREQ_PHASES.map((phaseId) => {
                    const status = getPhaseStatus(phaseId);
                    const phaseName = PHASE_DISPLAY_NAMES[phaseId] || phaseId;
                    
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
                    <strong>Important:</strong> All phases above must be completed in the Text AI Rep Setup Guide before proceeding with the demo setup.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/client/${clientId}/text-ai-rep/configuration`);
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to Text AI Rep Setup
                  </Button>
                </div>
              </div>
            );
          })()
        },
        // Step 2: Complete Voice AI Rep Setup (Prerequisite)
        {
          id: 'complete-voice-ai-rep',
          title: 'Complete Voice AI Rep Setup',
          description: 'Complete the Voice AI Rep outbound setup before configuring the demo',
          content: (() => {
            // Phase IDs for Voice AI Rep prerequisite (outbound only, no inbound)
            const VOICE_AI_REP_PREREQ_PHASES = [
              'twilio-setup',
              'voice-accounts-setup',
              'voice-outbound-setup',
              'voice-prompts-setup'
            ] as const;
            
            const PHASE_DISPLAY_NAMES: Record<string, string> = {
              'twilio-setup': 'Twilio Setup',
              'voice-accounts-setup': 'Accounts Setup',
              'voice-outbound-setup': 'Outbound AI Rep Setup',
              'voice-prompts-setup': 'Voice Prompts Setup'
            };
            
            const getPhaseStatus = (phaseId: string) => {
              const total = SETUP_PHASES[phaseId as keyof typeof SETUP_PHASES] || 0;
              let completed = 0;
              for (let i = 0; i < total; i++) {
                if (completedSteps.has(`${phaseId}-${i}`)) {
                  completed++;
                }
              }
              return { completed, total, isComplete: completed === total };
            };
            
            const getOverallStatus = () => {
              const totalSteps = VOICE_AI_REP_PREREQ_PHASES.reduce((sum, id) => sum + (SETUP_PHASES[id] || 0), 0);
              let completedCount = 0;
              VOICE_AI_REP_PREREQ_PHASES.forEach(phaseId => {
                const status = getPhaseStatus(phaseId);
                completedCount += status.completed;
              });
              const isComplete = VOICE_AI_REP_PREREQ_PHASES.every(phaseId => getPhaseStatus(phaseId).isComplete);
              return {
                completed: completedCount,
                total: totalSteps,
                percentage: Math.round((completedCount / totalSteps) * 100),
                isComplete
              };
            };
            
            const overallStatus = getOverallStatus();
            
            return (
              <div className="space-y-4">
                <p>
                  Before setting up the demo, you need to complete the Voice AI Rep setup. 
                  This enables outbound voice calls from the demo.
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
                      <p className="font-medium">Voice AI Rep Setup Progress</p>
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
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Voice AI Rep Setup Phases Status</h4>
                  
                  {VOICE_AI_REP_PREREQ_PHASES.map((phaseId) => {
                    const status = getPhaseStatus(phaseId);
                    const phaseName = PHASE_DISPLAY_NAMES[phaseId] || phaseId;
                    
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
                    <strong>Important:</strong> All phases above must be completed in the Voice AI Rep Setup Guide before proceeding with the demo setup.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/client/${clientId}/voice-ai-rep/configuration`);
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to Voice AI Rep Setup
                  </Button>
                </div>
              </div>
            );
          })()
        },
        // Step 3: Find AI Demo Templates
        {
          id: 'find-demo-template',
          title: 'Find AI Demo Template',
          description: 'Locate the AI Demo Templates funnel in HighLevel',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The Demo is a special funnel that allows you to quickly test how the entire AI Rep process works. You can use it yourself, show it to clients, or do live demonstrations.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In HighLevel, go to <strong>Sites → Funnels</strong></li>
                  <li>Look for the <strong>&quot;AI Demo Templates&quot;</strong> funnel</li>
                  <li>Click on it to open the funnel settings</li>
                </ol>
              </div>

              <SmoothImage src={demoFunnelsList} alt="HighLevel Sites showing AI Demo Templates funnel" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">What This Demo Does:</p>
                <p className="text-sm mt-2">
                  When someone fills out the demo form, it triggers an automation that will send them an SMS (and optionally a voice call). This allows you to test the complete flow from lead capture to AI engagement.
                </p>
              </div>
            </div>
          )
        },
        // Step 2: Review Funnel Steps
        {
          id: 'review-funnel-steps',
          title: 'Review Funnel Steps',
          description: 'Understand the two-step funnel structure',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The AI Demo Templates funnel has two steps: an <strong>Opt-In page</strong> and a <strong>Confirmation page</strong>.
              </p>

              <SmoothImage src={demoFunnelSteps} alt="AI Demo Templates funnel showing Opt-In and Confirmation steps" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium text-blue-600 dark:text-blue-400">Opt-In Page</p>
                <p className="text-sm">
                  This is the main landing page where users see what the demo offers and fill out their information. The form on this page triggers the engagement workflow when submitted.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium text-green-600 dark:text-green-400">Confirmation Page</p>
                <p className="text-sm">
                  After submitting the form, users are redirected here. This page explains what they should expect next (SMS, voice call, WhatsApp, etc.).
                </p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  <strong>Next:</strong> We&apos;ll configure both pages to match your setup and ensure the form triggers the correct workflow.
                </p>
              </div>
            </div>
          )
        },
        // Step 3: Edit Opt-In Page
        {
          id: 'edit-optin-page',
          title: 'Edit Opt-In Page',
          description: 'Configure the opt-in page and verify the form',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Let&apos;s configure the Opt-In page and make sure it uses the correct form.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>&quot;Opt-In&quot;</strong> step in the funnel</li>
                  <li>Click the <strong>&quot;Edit&quot;</strong> button to open the page editor</li>
                </ol>
              </div>

              <SmoothImage src={demoOptinEdit} alt="Opt-In step selected with Edit button highlighted" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Verify the Form:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the editor, click on the <strong>form element</strong></li>
                  <li>In the right panel under <strong>&quot;Element Options&quot;</strong>, verify it says <strong>&quot;Demo Form&quot;</strong></li>
                  <li>This is important because this form triggers the engagement workflow</li>
                </ol>
              </div>

              <SmoothImage src={demoOptinForm} alt="Page editor showing Demo Form selected in Element Options" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> Make sure the trigger form on your workflow (later step) is the <strong>same form</strong> as you have on this page. Otherwise, the automation won&apos;t be triggered!
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  You can customize the page text if you want, but make sure to keep the Demo Form. Once done, click <strong>Publish</strong> in the top right corner.
                </p>
              </div>
            </div>
          )
        },
        // Step 4: Edit Confirmation Page
        {
          id: 'edit-confirmation-page',
          title: 'Edit Confirmation Page',
          description: 'Customize what users should expect after signing up',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The Confirmation page explains what the user should expect after filling out the form. Customize it based on which channels you&apos;ve set up.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go back to the funnel and click on the <strong>&quot;Confirmation&quot;</strong> step</li>
                  <li>Click the <strong>&quot;Edit&quot;</strong> button</li>
                </ol>
              </div>

              <SmoothImage src={demoConfirmationStep} alt="Confirmation step selected with Edit button" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">What to Show on This Page:</p>
                <p className="text-sm">
                  This page tells users what to expect. Edit the text based on what your demo actually does:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm mt-2">
                  <li><strong>Voice AI Rep:</strong> &quot;You&apos;ll receive a phone call in about 2 minutes...&quot;</li>
                  <li><strong>SMS AI Rep:</strong> &quot;You&apos;ll receive a text message shortly...&quot;</li>
                  <li><strong>WhatsApp:</strong> &quot;Check your WhatsApp for a message...&quot;</li>
                  <li><strong>Email:</strong> &quot;Check your email inbox...&quot;</li>
                </ul>
              </div>

              <SmoothImage src={demoConfirmationPage} alt="Confirmation page editor showing what to expect content" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p>
                  Only include the channels that your demo actually uses. If you&apos;re only sending SMS, remove the voice call and WhatsApp sections.
                </p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  Once you&apos;ve customized the text, click <strong>Publish</strong> to save your changes.
                </p>
              </div>
            </div>
          )
        },
        // Step 5: Configure Demo Form
        {
          id: 'configure-demo-form',
          title: 'Configure Demo Form',
          description: 'Set up the form fields based on your needs',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Now let&apos;s make sure the Demo Form has the right fields for your use case.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Sites → Forms</strong> (or click &quot;Edit form&quot; from the page editor)</li>
                  <li>Find the <strong>&quot;Demo Form&quot;</strong></li>
                  <li>Click on it to edit</li>
                </ol>
              </div>

              <SmoothImage src={demoFormEdit} alt="Demo Form editor showing form fields" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Recommended Fields:</p>
                <ul className="list-disc list-inside space-y-2 ml-2">
                  <li><strong>Name</strong> - To personalize the AI responses</li>
                  <li><strong>Phone Number</strong> - Required if you&apos;re sending SMS or making calls</li>
                  <li><strong>Email</strong> - Required if you&apos;re sending emails</li>
                </ul>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">Tips:</p>
                <ul className="list-disc list-inside space-y-1 ml-2 text-sm mt-2">
                  <li>If you&apos;re only doing SMS, you may not need the email field</li>
                  <li>If using WhatsApp, consider adding a separate &quot;WhatsApp Number&quot; field</li>
                  <li>Keep it simple - fewer fields = higher conversion</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  Once configured, click <strong>Save</strong> to save your form.
                </p>
              </div>
            </div>
          )
        },
        // Step 6: Set Up Engagement Workflow
        {
          id: 'setup-engagement-workflow',
          title: 'Set Up Engagement Workflow',
          description: 'Configure the workflow that triggers when the form is submitted',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The Engagement workflow is triggered when someone submits the Demo Form. Let&apos;s configure it.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Go to <strong>Automation</strong> in HighLevel</li>
                  <li>Navigate to the <strong>&quot;Setup Demo&quot;</strong> folder</li>
                  <li>Open the <strong>&quot;Engagement&quot;</strong> workflow</li>
                </ol>
              </div>

              <SmoothImage src={demoEngagementWorkflow} alt="Automation showing Engagement workflow in Setup Demo folder" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Verify the Trigger:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click on the <strong>Trigger</strong> node at the top</li>
                  <li>Make sure it says <strong>&quot;Form Submitted&quot;</strong></li>
                  <li>In the <strong>Filters</strong> section, verify <strong>&quot;Demo Form&quot;</strong> is selected</li>
                </ol>
              </div>

              <SmoothImage src={demoWorkflowTrigger} alt="Workflow trigger showing Form Submitted with Demo Form filter" />

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> The form in this trigger MUST match the form on your landing page. If they don&apos;t match, the workflow won&apos;t be triggered when someone fills out the form.
                </p>
              </div>
            </div>
          )
        },
        // Step 7: Set Agent Number
        {
          id: 'set-agent-number',
          title: 'Set Agent Number',
          description: 'Configure which AI agent prompt to use',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The Agent Number determines which prompt your Text AI Rep will use when talking to leads who filled out this form.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the Engagement workflow, find the <strong>&quot;Set Agent Number&quot;</strong> action</li>
                  <li>Click on it to open the settings</li>
                  <li>Set the <strong>Agent Number</strong> field to the prompt you want to use</li>
                </ol>
              </div>

              <SmoothImage src={demoAgentNumber} alt="Set Agent Number action showing Agent Number field set to 1" />

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">How Agent Numbers Work:</p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-sm mt-2">
                  <li><strong>Agent Number 1</strong> → Uses Prompt #1 from your Prompt Management</li>
                  <li><strong>Agent Number 2</strong> → Uses Prompt #2 from your Prompt Management</li>
                  <li>And so on for additional agents...</li>
                </ul>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  This allows you to have different AI personalities or use cases. For the demo, you can use Agent Number 1 which corresponds to your main prompt.
                </p>
              </div>
            </div>
          )
        },
        // Step 8: Configure Engagement SMS
        {
          id: 'configure-engagement-sms',
          title: 'Configure Engagement SMS',
          description: 'Set up the first SMS message sent to demo users',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The Engagement SMS is the first outbound message sent to users after they fill out the demo form. This message starts the conversation.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the Engagement workflow, find the <strong>&quot;SMS (Engagement)&quot;</strong> action</li>
                  <li>Click on it to open the settings</li>
                  <li>Customize the <strong>Message</strong> text</li>
                </ol>
              </div>

              <SmoothImage src={demoSmsEngagement} alt="SMS Engagement action showing message configuration" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Example Message:</p>
                <p className="text-sm italic bg-background/50 p-3 rounded border">
                  &quot;Hey {'{{contact.first_name}}'}, it&apos;s [Your Name]! Just saw you registered for my demo and I need to clarify a few things. Can we chat here?&quot;
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Important:</strong> For this outbound SMS to work, you MUST have a phone number set up in HighLevel with <strong>A2P verification completed</strong> (for US/Canada numbers).
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Verify Phone Number:</p>
                <p className="text-sm">
                  Go to <strong>Settings → Phone System</strong> to confirm you have a phone number configured.
                </p>
              </div>

              <SmoothImage src={demoPhoneNumbers} alt="Phone System showing available phone numbers" />

            </div>
          )
        },
        // Step 9: Configure Outbound Call
        {
          id: 'configure-outbound-call',
          title: 'Configure Outbound Call',
          description: 'Set up the voice AI outbound call node',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                The Make Outbound Call node triggers the Voice AI Rep to call the lead. The webhook URL is already configured from your Voice AI Rep Setup.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>In the Engagement workflow, find the <strong>&quot;#4 Make Outbound Call (n8n)&quot;</strong> action</li>
                  <li>Click on it to open the settings</li>
                  <li>Look at the <strong>Query Parameters</strong> section</li>
                </ol>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">About the Webhook URL:</p>
                <p className="text-sm mt-1">
                  You don&apos;t need to change the webhook URL here. This URL triggers n8n which then makes the outbound call via Retell AI. This was already configured in the <strong>Voice AI Rep Setup → Outbound AI Rep Setup</strong>.
                </p>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Configure Agent Number:</p>
                <p className="text-sm">
                  The <strong>agent_number</strong> parameter determines which Voice AI prompt to use:
                </p>
                <ul className="list-disc list-inside space-y-2 ml-2 text-sm mt-2">
                  <li><strong>agent_number = 1</strong> → Uses Voice Prompt #1 from Prompt Management</li>
                  <li><strong>agent_number = 2</strong> → Uses Voice Prompt #2 from Prompt Management</li>
                  <li>And so on...</li>
                </ul>
              </div>

              <SmoothImage src={demoOutboundCallAgentNumber} alt="Agent number parameter in the outbound call settings" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p>
                  <strong>Example:</strong> If you set up an &quot;Engagement Agent&quot; as Voice Prompt #2 in your Voice AI Rep Prompt Management, put <strong>2</strong> in the agent_number field here.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p>
                  <strong>Tip:</strong> You can add a <strong>Wait</strong> action between the SMS and the outbound call if you want a delay between the text message and the phone call.
                </p>
              </div>
            </div>
          )
        },
        // Step 10: Publish Workflow
        {
          id: 'publish-engagement-workflow',
          title: 'Publish Workflow',
          description: 'Save and publish the workflow to activate it',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Now that everything is configured, publish the workflow to make it live.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Steps:</p>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Click <strong>Save</strong> in the top right corner</li>
                  <li>Toggle the workflow from <strong>Draft</strong> to <strong>Publish</strong></li>
                </ol>
              </div>

              <SmoothImage src={demoWorkflowPublish} alt="Saving and publishing the Engagement workflow" />
            </div>
          )
        },
        // Step 11: Test Demo
        {
          id: 'test-demo',
          title: 'Test Demo',
          description: 'Test your demo page end-to-end',
          content: (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Now it&apos;s time to test your demo! Visit your published demo page and go through the entire flow as a lead would.
              </p>

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 1: Fill Out the Demo Form</p>
                <p className="text-sm">
                  Go to your demo landing page and fill out the form with your contact information.
                </p>
              </div>

              <SmoothImage src={demoTestForm} alt="Demo landing page with the form to fill out" />

              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="font-medium">Step 2: See the Confirmation Page</p>
                <p className="text-sm">
                  After submitting, you&apos;ll be redirected to the confirmation page. This is when the Engagement workflow triggers!
                </p>
              </div>

              <SmoothImage src={demoTestConfirmation} alt="Confirmation page showing what to expect next" />

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                <p className="font-medium text-green-600 dark:text-green-400">What Happens Next:</p>
                <div className="text-sm mt-2 space-y-2">
                  <p><strong>1.</strong> The Engagement workflow triggers automatically</p>
                  <p><strong>2.</strong> You receive the engagement SMS (Text AI Rep)</p>
                  <p><strong>3.</strong> Shortly after, the Voice AI Rep calls you</p>
                  <p><strong>4.</strong> Your AI Reps handle the conversation across both channels!</p>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="font-medium">🎉 Congratulations!</p>
                <p className="text-sm mt-1">
                  Your demo is now fully set up. Share the landing page URL with prospects and let them experience your AI Sales Reps in action!
                </p>
              </div>
            </div>
          )
        }
      ]
    }
  ];

  // Filter stages based on phaseFilter prop
  const filteredStages = phaseFilter 
    ? stages.filter(stage => phaseFilter.includes(stage.id as keyof typeof SETUP_PHASES))
    : stages;

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
          
          const dbSteps = (data?.setup_guide_completed_steps as string[]) || [];
          const loaded = new Set(dbSteps);
          setCompletedSteps(loaded);
          hasLoadedProgressRef.current = true;
          lastSavedStepsKeyRef.current = stepsKey(loaded);
        } catch (e) {
          console.error('Failed to load setup progress from database:', e);
        }
      };
      
      loadFromDatabase();
    }
  }, [clientId, open]);

  // Load navigation position from localStorage - but NOT if user clicked a specific phase
  useEffect(() => {
    if (clientId && open && navigationKey === 0 && !hasNavigatedFromProps) {
      try {
        const saved = localStorage.getItem(`setup_guide_progress_${clientId}`);
        if (saved) {
          const { stage, step, expanded } = JSON.parse(saved);
          setCurrentStage(stage ?? 0);
          setCurrentStep(step ?? 0);
          setExpandedStages(new Set(expanded ?? [0])); // Default first stage expanded
        }
      } catch (e) {
        console.error('Failed to load setup progress:', e);
      }
    }
  }, [clientId, open, hasNavigatedFromProps, navigationKey]);

  // Track if we're currently saving to prevent realtime overwriting our pending changes
  const isSavingRef = React.useRef(false);
  const pendingStepsRef = React.useRef<Set<string> | null>(null);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent initial empty state from overwriting DB progress before the first load completes.
  const hasLoadedProgressRef = React.useRef(false);
  const lastSavedStepsKeyRef = React.useRef('');
  const stepsKey = React.useCallback((steps: Set<string>) => Array.from(steps).sort().join('|'), []);

  // Subscribe to realtime changes for two-way sync with dedicated pages
  useEffect(() => {
    if (!clientId) return;

    const channel = supabase
      .channel(`setup-guide-sync-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clients', filter: `id=eq.${clientId}` },
        (payload) => {
          // Don't overwrite local state if we're in the middle of saving
          // This prevents race conditions where realtime event overwrites pending changes
          if (isSavingRef.current || pendingStepsRef.current !== null) {
            console.log('Skipping realtime update - save in progress');
            return;
          }
          const steps = (payload.new.setup_guide_completed_steps as string[]) || [];
          setCompletedSteps(new Set(steps));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  // Save completed steps to database for two-way sync
  // Using a ref-based approach to ensure saves complete even on unmount
  const saveToDatabase = React.useCallback(async (stepsToSave: Set<string>) => {
    if (!clientId) return;
    
    isSavingRef.current = true;
    try {
      const { error } = await supabase
        .from('clients')
        .update({ setup_guide_completed_steps: Array.from(stepsToSave) })
        .eq('id', clientId);
      
      if (error) {
        console.error('Failed to save setup progress to database:', error);
        toast({
          title: "Failed to save progress",
          description: "Your progress may not have been saved. Please try again.",
          variant: "destructive"
        });
      } else {
        lastSavedStepsKeyRef.current = stepsKey(stepsToSave);
      }
    } catch (e) {
      console.error('Failed to save setup progress to database:', e);
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

  // Effect to handle debounced saves
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

  // Ensure saves complete when dialog closes
  useEffect(() => {
    if (!open && pendingStepsRef.current && clientId && hasLoadedProgressRef.current) {
      const pendingKey = stepsKey(pendingStepsRef.current);
      if (pendingKey === lastSavedStepsKeyRef.current) {
        pendingStepsRef.current = null;
        return;
      }
      // Force immediate save when dialog closes
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveToDatabase(pendingStepsRef.current);
    }
  }, [open, clientId, saveToDatabase, stepsKey]);

  // Save navigation position to localStorage
  useEffect(() => {
    if (clientId) {
      try {
        localStorage.setItem(
          `setup_guide_progress_${clientId}`,
          JSON.stringify({
            stage: currentStage,
            step: currentStep,
            expanded: Array.from(expandedStages)
          })
        );
      } catch (e) {
        console.error('Failed to save setup progress:', e);
      }
    }
  }, [currentStage, currentStep, expandedStages, clientId]);

  const activeStage = filteredStages[currentStage];
  const currentStepId = `${activeStage.id}-${currentStep}`;
  const currentStepData = activeStage.steps[currentStep];
  const isLogicMiniGuide = ['inbound-logic', 'outbound-logic', 'multi-agent-logic'].includes(currentStepData.id);
  const totalSteps = filteredStages.reduce((acc, stage) => acc + stage.steps.length, 0);
  const completedCount = completedSteps.size;
  const progress = (completedCount / totalSteps) * 100;

  useEffect(() => {
    if (!isLogicMiniGuide) setLogicNavState(null);
  }, [isLogicMiniGuide]);

  // Check if Supabase and LLM credentials are configured (required to unlock other phases)
  const areRequiredCredentialsConfigured = () => {
    // Supabase required fields
    const hasSupabase = Boolean(savedSupabaseConfig.supabase_url?.trim() && savedSupabaseConfig.supabase_service_key?.trim());
    // LLM required fields (need at least OpenRouter)
    const hasLLM = Boolean(savedLlmConfig.openrouter_api_key?.trim());
    return hasSupabase && hasLLM;
  };

  // Get list of missing required credentials for alert message
  const getMissingRequiredCredentials = () => {
    const missing: string[] = [];
    if (!savedSupabaseConfig.supabase_url?.trim() || !savedSupabaseConfig.supabase_service_key?.trim()) {
      missing.push('Supabase');
    }
    if (!savedLlmConfig.openrouter_api_key?.trim()) {
      missing.push('LLM (OpenRouter)');
    }
    return missing;
  };

  // Phases that are always accessible (before credential lock)
  const ALWAYS_ACCESSIBLE_PHASES = ['account-creation', 'supabase-setup'];

// Check if a phase is locked due to missing required credentials
  // IMPORTANT: Return false while loading to prevent flicker - don't show locked state until data is loaded
  const isPhaseLockedForCredentials = (phaseId: string): boolean => {
    if (configLoading) return false; // Don't show locked while loading
    if (ALWAYS_ACCESSIBLE_PHASES.includes(phaseId)) return false;
    return !areRequiredCredentialsConfigured();
  };

  // Map step IDs to their required field values
  const getRequiredFieldForStep = (stepId: string): string | null => {
    const fieldMap: Record<string, string | null> = {
      // Supabase (step 4 is Verify Tables - no field required, step 5 is URL, step 6 is Service Key)
      'supabase-setup-5': supabaseConfig.supabase_url,
      'supabase-setup-6': supabaseConfig.supabase_service_key,
      // LLM
      'llm-connection-0': llmConfig.openrouter_api_key,
      'llm-connection-1': llmConfig.openai_api_key,
      // HighLevel Credentials
      'highlevel-credentials-0': ghlConfig.ghl_api_key,
      'highlevel-credentials-1': ghlConfig.ghl_assignee_id,
      'highlevel-credentials-2': ghlConfig.ghl_location_id,
      'highlevel-credentials-3': ghlConfig.ghl_calendar_id,
      'highlevel-setup-7': transferHumanWebhookUrl,
      'highlevel-setup-8': userDetailsWebhookUrl,
      'highlevel-setup-9': leadScoreWebhookUrl,
      // Retell (step 0: Create Account, step 1: Download Templates, step 2: Import Agents, step 3: API Key, etc.)
      'retell-setup-3': retellConfig.retell_api_key,
      'retell-setup-4': retellConfig.retell_inbound_agent_id,
      'retell-setup-5': retellConfig.retell_outbound_agent_id,
      'retell-setup-6': retellConfig.retell_phone_1,
      // Knowledgebase (step 0: Open Workflow, step 1: Connect Supabase, step 2: Connect Embeddings, step 3: Setup Webhook)
      'knowledgebase-setup-3': knowledgebaseWebhook,
      // Text Prompts
      'text-prompts-setup-1': botPersonaPrompt.content,
      'text-prompts-setup-2': prompt1.content,
      'text-prompts-setup-3': prompt2.content,
      'text-prompts-setup-4': prompt3.content,
      // Voice Prompts
      'voice-prompts-setup-2': voicePrompt0.content,
      'voice-prompts-setup-3': voicePrompt1.content,
      'voice-prompts-setup-4': voicePrompt2.content,
      'voice-prompts-setup-5': voicePrompt5.content,
    };
    return fieldMap[stepId] ?? null;
  };

  // Check if a step requires a field and if it's filled
  const isStepFieldFilled = (stepId: string): boolean => {
    const fieldValue = getRequiredFieldForStep(stepId);
    // If step doesn't require a field, return true (can be marked done)
    if (fieldValue === null) return true;
    // If step requires a field, check if it's filled
    return Boolean(fieldValue);
  };

  const isStageCompleted = (stageIndex: number) => {
    const stage = filteredStages[stageIndex];
    return stage.steps.every((_, stepIndex) => 
      completedSteps.has(`${stage.id}-${stepIndex}`)
    );
  };

  const handleNext = () => {
    // Toggle completion state
    if (completedSteps.has(currentStepId)) {
      // Unmark as completed (only if the step doesn't require a filled field, or if field is empty)
      setCompletedSteps(prev => {
        const next = new Set(prev);
        next.delete(currentStepId);
        return next;
      });
    } else {
      // Check if the step requires a field and if it's filled
      if (!isStepFieldFilled(currentStepId)) {
        toast({
          title: "Field Required",
          description: "Please save the required field before marking this step as done.",
          variant: "destructive"
        });
        return;
      }
      
      // Mark as completed
      setCompletedSteps(prev => new Set([...prev, currentStepId]));
      
      // Move to next step
      if (currentStep < activeStage.steps.length - 1) {
        setCurrentStep(currentStep + 1);
      } else if (currentStage < filteredStages.length - 1) {
        // Move to next stage
        const nextStage = currentStage + 1;
        setCurrentStage(nextStage);
        setCurrentStep(0);
        // Auto-expand the next stage
        setExpandedStages(prev => new Set([...prev, nextStage]));
      }
      // When all steps are complete, just show the stage as completed (don't close the guide)
    }
  };

  // Auto-unmark steps when their required field becomes empty
  // Guard: Only run after initial config has loaded to prevent false unmarking during load
  useEffect(() => {
    // Don't run during initial load - wait for config to load first
    if (configLoading || !hasLoadedProgressRef.current) return;
    
    const stepsToUnmark: string[] = [];
    
    // Check all field-dependent steps
    // Note: supabase-setup-5 is Project URL, supabase-setup-6 is Service Key
    const fieldSteps = [
      'supabase-setup-5', 'supabase-setup-6',
      'llm-connection-0', 'llm-connection-1',
      'highlevel-credentials-0', 'highlevel-credentials-1', 'highlevel-credentials-2', 'highlevel-credentials-3',
      'highlevel-setup-7', 'highlevel-setup-8', 'highlevel-setup-9', 'highlevel-setup-10',
      'retell-setup-3', 'retell-setup-4', 'retell-setup-5', 'retell-setup-6',
      'knowledgebase-setup-2',
      'text-prompts-setup-1', 'text-prompts-setup-2', 'text-prompts-setup-3', 'text-prompts-setup-4',
      'voice-prompts-setup-2', 'voice-prompts-setup-3', 'voice-prompts-setup-4', 'voice-prompts-setup-5'
    ];
    
    fieldSteps.forEach(stepId => {
      if (completedSteps.has(stepId) && !isStepFieldFilled(stepId)) {
        stepsToUnmark.push(stepId);
      }
    });
    
    if (stepsToUnmark.length > 0) {
      setCompletedSteps(prev => {
        const next = new Set(prev);
        stepsToUnmark.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [configLoading, supabaseConfig, llmConfig, ghlConfig, retellConfig, transferHumanWebhookUrl, userDetailsWebhookUrl, pipelineWebhookUrl, leadScoreWebhookUrl, knowledgebaseWebhook, botPersonaPrompt, prompt1, prompt2, prompt3, voicePrompt0, voicePrompt1, voicePrompt2, voicePrompt5]);

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else if (currentStage > 0) {
      setCurrentStage(currentStage - 1);
      setCurrentStep(filteredStages[currentStage - 1].steps.length - 1);
    }
  };

  const handleStageClick = (stageIndex: number) => {
    // Toggle stage expansion
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stageIndex)) {
        next.delete(stageIndex);
      } else {
        next.add(stageIndex);
      }
      return next;
    });
  };

  const handleStepClick = (stageIndex: number, stepIndex: number) => {
    setCurrentStage(stageIndex);
    setCurrentStep(stepIndex);
    // Auto-expand the stage if it's not already expanded
    setExpandedStages(prev => {
      if (!prev.has(stageIndex)) {
        return new Set([...prev, stageIndex]);
      }
      return prev;
    });
  };

return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-screen h-screen max-h-screen p-0 gap-0 rounded-none overflow-hidden" aria-describedby={undefined}>
        <VisuallyHidden>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </VisuallyHidden>
        {/* Show loading indicator while config loads to prevent flicker */}
        {configLoading ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
        <div className="flex h-full w-full overflow-hidden">
          {/* Left Sidebar - Stage & Step Navigation */}
          <div className="w-64 border-r bg-muted/30 flex flex-col h-full overflow-hidden">
            {/* Sidebar Header - Fixed */}
            <div className="px-6 py-4 flex-shrink-0">
              <h2 className="text-sm font-semibold uppercase tracking-wide">{dialogTitle}</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Follow everything step-by-step not skipping any single action.
              </p>
            </div>

            {/* Separator */}
            <div className="border-t border-border/50 flex-shrink-0" />

            {/* Stage & Step List - Scrollable */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden pt-4 px-2 pb-8 space-y-3">
              {filteredStages.map((stage, stageIndex) => {
                const isPhaseLocked = isPhaseLockedForCredentials(stage.id);
                return (
                <div key={stage.id}>
                  {/* Stage Header - Clickable to expand/collapse */}
                  <button
                    onClick={() => handleStageClick(stageIndex)}
                    className={cn(
                      "w-full px-4 py-3 text-left flex items-center gap-3 transition-all border-2 rounded-lg",
                      isPhaseLocked
                        ? "border-amber-500 bg-amber-50/30 dark:bg-amber-950/10 opacity-60"
                        : isStageCompleted(stageIndex)
                        ? "border-green-500 bg-green-50/50 dark:bg-green-950/20"
                        : "border-red-500 bg-red-50/50 dark:bg-red-950/20"
                    )}
                  >
                    {isPhaseLocked && (
                      <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    )}
                    <h3 className={cn(
                      "text-sm font-bold uppercase tracking-wide flex-1",
                      isPhaseLocked ? "text-muted-foreground" : "text-foreground"
                    )}>
                      {stage.title}
                    </h3>
                    <ChevronRight className={cn(
                      "h-4 w-4 transition-transform",
                      isPhaseLocked ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                      expandedStages.has(stageIndex) && "rotate-90"
                    )} />
                  </button>

                  {/* Steps - shown when stage is expanded */}
                  {expandedStages.has(stageIndex) && (
                    <div>
                      {stage.steps.map((step, stepIndex) => {
                        const stepId = `${stage.id}-${stepIndex}`;
                        const isActive = stageIndex === currentStage && stepIndex === currentStep;
                        return (
                          <button
                            key={step.id}
                            onClick={() => handleStepClick(stageIndex, stepIndex)}
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
                                <CheckCircle2 className={cn(
                                  "h-[21px] w-[21px]",
                                  isPhaseLocked 
                                    ? "text-green-600/40 dark:text-green-400/40" 
                                    : "text-green-600 dark:text-green-400"
                                )} />
                              ) : (
                                <div className={cn(
                                  "h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] font-medium",
                                  isPhaseLocked
                                    ? "border-muted-foreground/40 text-muted-foreground/40"
                                    : isActive
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
                                isPhaseLocked
                                  ? "text-muted-foreground/60"
                                  : isActive
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
                );
              })}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Header - Fixed */}
            <div className="px-6 py-4 border-b bg-background flex-shrink-0">
              <h3 
                key={`title-${currentStage}-${currentStep}`}
                className="text-sm font-bold uppercase tracking-wide transition-all duration-200"
              >
                {currentStepData.title}
              </h3>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 [&_a]:text-blue-600 [&_a]:underline [&_a]:hover:text-blue-800 [&_a]:cursor-pointer">
              {/* Alert for locked phases */}
              {isPhaseLockedForCredentials(activeStage.id) && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
                  <p className="[font-size:13px] text-muted-foreground">
                    <strong className="text-foreground">Required Setup Incomplete:</strong> Please configure <strong className="text-foreground">{getMissingRequiredCredentials().join(' and ')}</strong> credentials first in the <strong className="text-foreground">Accounts Setup</strong> and <strong className="text-foreground">Supabase Setup</strong> phases. This phase will be unlocked once those credentials are configured.
                  </p>
                </div>
              )}
              <div 
                key={`${currentStage}-${currentStep}`}
                className={cn(
                  "max-w-3xl text-sm [&_img]:transition-opacity [&_img]:duration-300",
                  isPhaseLockedForCredentials(activeStage.id) 
                    ? "opacity-50 pointer-events-none" 
                    : "animate-fade-in"
                )}
              >
                {currentStepData.content}
              </div>
            </div>

            {/* Footer - Fixed */}
            <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between flex-shrink-0">
              {isLogicMiniGuide && logicNavState ? (
                <>
                  {logicNavState.showBack ? (
                    <Button
                      onClick={logicNavState.onBack}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 hover:scale-105 active:scale-95"
                    >
                      <ChevronLeft className="w-4 h-4 mr-2" />
                      {logicNavState.backLabel}
                    </Button>
                  ) : (
                    <div />
                  )}

                  {logicNavState.rightButton.label === 'Complete' ? (
                    <Button
                      onClick={handleNext}
                      className="bg-green-500 hover:bg-green-600 text-white transition-all duration-300 hover:scale-105 active:scale-95"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Done
                    </Button>
                  ) : logicNavState.rightButton.variant === 'outline' ? (
                    <Button
                      onClick={logicNavState.rightButton.onClick}
                      disabled={logicNavState.rightButton.disabled}
                      className="bg-red-500 hover:bg-red-600 text-white transition-all duration-300 hover:scale-105 active:scale-95"
                    >
                      {logicNavState.rightButton.label}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        logicNavState.rightButton.onClick();
                        if (logicNavState.rightButton.label === 'Restart') {
                          setCompletedSteps(prev => {
                            const next = new Set(prev);
                            next.delete(currentStepId);
                            return next;
                          });
                        }
                      }}
                      disabled={logicNavState.rightButton.disabled}
                      className={cn(
                        "transition-all duration-300 hover:scale-105 active:scale-95",
                        logicNavState.rightButton.disabled
                          ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground"
                      )}
                    >
                      {logicNavState.rightButton.label}
                      {logicNavState.rightButton.icon === 'arrow-right' && (
                        <ChevronRight className="w-4 h-4 ml-2" />
                      )}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button
                    onClick={handleBack}
                    disabled={currentStep === 0 && currentStage === 0 || isPhaseLockedForCredentials(activeStage.id)}
                    className={cn(
                      "transition-all duration-300 hover:scale-105 active:scale-95",
                      isPhaseLockedForCredentials(activeStage.id)
                        ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                        : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-70"
                    )}
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>

                  <Button 
                    onClick={handleNext}
                    disabled={isPhaseLockedForCredentials(activeStage.id) || (!completedSteps.has(currentStepId) && !isStepFieldFilled(currentStepId))}
                    className={cn(
                      "transition-all duration-300 hover:scale-105 active:scale-95",
                      isPhaseLockedForCredentials(activeStage.id)
                        ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                        : completedSteps.has(currentStepId)
                          ? "bg-gray-500 hover:bg-gray-600 text-white"
                          : !isStepFieldFilled(currentStepId)
                            ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                            : "bg-green-500 hover:bg-green-600 text-white"
                    )}
                  >
                    {completedSteps.has(currentStepId) ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Undone
                      </>
                    ) : currentStep === activeStage.steps.length - 1 && currentStage === filteredStages.length - 1 ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Complete Setup
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Done
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SetupGuideDialog;
