import { useState, useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCreatorMode } from "@/hooks/useCreatorMode";
import { ImageZoomProvider } from "@/contexts/ImageZoomContext";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";
import { ThemeProvider } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
// Retry wrapper for lazy imports — handles stale chunk errors after redeploy
function lazyRetry(importFn: () => Promise<any>) {
  return lazy(() =>
    importFn().catch(() => {
      // Force reload once to get fresh chunks
      const hasReloaded = sessionStorage.getItem('chunk-reload');
      if (!hasReloaded) {
        sessionStorage.setItem('chunk-reload', '1');
        window.location.reload();
        return new Promise(() => {}); // never resolves, page will reload
      }
      sessionStorage.removeItem('chunk-reload');
      return importFn(); // retry once more after reload
    })
  );
}

import RetroLoader from "./components/RetroLoader";

// Everything else is lazy-loaded
const Dashboard = lazyRetry(() => import("./pages/Dashboard"));
const Auth = lazyRetry(() => import("./pages/Auth"));
const VerifyEmail = lazyRetry(() => import("./pages/VerifyEmail"));
const ForgotPassword = lazyRetry(() => import("./pages/ForgotPassword"));
const ResetPassword = lazyRetry(() => import("./pages/ResetPassword"));
const Subscribe = lazyRetry(() => import("./pages/Subscribe"));
const SupportChatWidget = lazyRetry(() => import("@/components/SupportChatWidget").then(m => ({ default: m.SupportChatWidget })));
const ClientManagement = lazyRetry(() => import("./pages/ClientManagement"));
const ClientDashboard = lazyRetry(() => import("./pages/ClientDashboard"));
const PromptManagement = lazyRetry(() => import("./pages/PromptManagement"));
const KnowledgeBase = lazyRetry(() => import("./pages/KnowledgeBase"));
const CampaignCreate = lazyRetry(() => import("./pages/CampaignCreate"));
const CampaignDetail = lazyRetry(() => import("./pages/CampaignDetail"));
const Settings = lazyRetry(() => import("./pages/Settings"));
const ApiManagement = lazyRetry(() => import("./pages/ApiManagement"));
const ApiCredentials = lazyRetry(() => import("./pages/ApiCredentials"));
const WorkflowImports = lazyRetry(() => import("./pages/WorkflowImports"));
const TextAIRepSetup = lazyRetry(() => import("./pages/TextAIRepSetup"));
const TextAIRepTemplates = lazyRetry(() => import("./pages/TextAIRepTemplates"));
const DeployAIReps = lazyRetry(() => import("./pages/DeployAIReps"));
const DebugAIReps = lazyRetry(() => import("./pages/DebugAIReps"));
const DebugInjectLead = lazyRetry(() => import("./pages/DebugInjectLead"));
const DebugTextAIRep = lazyRetry(() => import("./pages/DebugTextAIRep"));
const DebugVoiceAIRep = lazyRetry(() => import("./pages/DebugVoiceAIRep"));
const VoiceAIRepSetup = lazyRetry(() => import("./pages/VoiceAIRepSetup"));
const VoiceAIRepTemplates = lazyRetry(() => import("./pages/VoiceAIRepTemplates"));
const WhatToDo = lazyRetry(() => import("./pages/WhatToDo"));
// Webinar pages + legacy VoiceAISetter archived to frontend/src/pages/_archived/
// on 2026-05-18 (Brendan confirmed Webinar product dormant; VoiceAISetter explicitly
// labeled "/voice-ai-setter-legacy" route name). Files preserved for revival.
const ChatAnalytics = lazyRetry(() => import("./pages/ChatAnalytics"));
const DemoPages = lazyRetry(() => import("./pages/DemoPages"));
const DemoPageEditor = lazyRetry(() => import("./pages/DemoPageEditor"));
const PublicDemoPage = lazyRetry(() => import("./pages/PublicDemoPage"));
const DemoPageContacts = lazyRetry(() => import("./pages/DemoPageContacts"));
const DemoPageContactChat = lazyRetry(() => import("./pages/DemoPageContactChat"));
const NotFound = lazyRetry(() => import("./pages/NotFound"));
const ClientSettings = lazyRetry(() => import("./pages/ClientSettings"));
const AccountSettings = lazyRetry(() => import("./pages/AccountSettings"));
const RedirectToFirstClient = lazyRetry(() => import("./pages/RedirectToFirstClient"));
const ClientPortal = lazyRetry(() => import("./pages/ClientPortal"));
const Contacts = lazyRetry(() => import("./pages/Contacts"));
const Chats = lazyRetry(() => import("./pages/Chats"));
const LeadFileProcessing = lazyRetry(() => import("./pages/LeadFileProcessing"));
const ContactDetail = lazyRetry(() => import("./pages/ContactDetail"));
const ErrorLogs = lazyRetry(() => import("./pages/ErrorLogs"));
const RequestLogs = lazyRetry(() => import("./pages/RequestLogs"));
const Logs = lazyRetry(() => import("./pages/Logs"));
const UsageCredits = lazyRetry(() => import("./pages/UsageCredits"));
const SupabaseUsage = lazyRetry(() => import("./pages/SupabaseUsage"));
const Templates = lazyRetry(() => import("./pages/Templates"));
const LeadReactivation = lazyRetry(() => import("./pages/LeadReactivation"));
const Simulator = lazyRetry(() => import("./pages/Simulator"));
const TierList = lazyRetry(() => import("./pages/TierList"));
const AnalyticsV2 = lazyRetry(() => import("./pages/AnalyticsV2"));
const VisualizationDemo = lazyRetry(() => import("./pages/VisualizationDemo"));
const ManageClients = lazyRetry(() => import("./pages/ManageClients"));
const CreateClient = lazyRetry(() => import("./pages/CreateClient"));
const ClientLayout = lazyRetry(() => import("./components/ClientLayout").then(m => ({ default: m.ClientLayout })));
const AnalyticsLayout = lazyRetry(() => import("./pages/AnalyticsLayout").then(m => ({ default: m.AnalyticsLayout })));
const SpeedToLeadLayout = lazyRetry(() => import("./pages/SpeedToLeadLayout"));
const SpeedToLeadDashboard = lazyRetry(() => import("./pages/SpeedToLeadDashboard"));
const SpeedToLeadContacts = lazyRetry(() => import("./pages/SpeedToLeadContacts"));
const SpeedToLeadContactDetail = lazyRetry(() => import("./pages/SpeedToLeadContactDetail"));
const Onboarding = lazyRetry(() => import("./pages/Onboarding"));
const Workflows = lazyRetry(() => import("./pages/Workflows"));
const WorkflowEditor = lazyRetry(() => import("./pages/WorkflowEditor"));
const ProcessDMs = lazyRetry(() => import("./pages/ProcessDMs"));
const SyncGHLContacts = lazyRetry(() => import("./pages/SyncGHLContacts"));
const OutboundCallProcessing = lazyRetry(() => import("./pages/OutboundCallProcessing"));
const SyncGHLBookings = lazyRetry(() => import("./pages/SyncGHLBookings"));
const Engagement = lazyRetry(() => import("./pages/Engagement"));
const InstagramDMs = lazyRetry(() => import("./pages/InstagramDMs"));

const EmailInbox = lazyRetry(() => import("./pages/EmailInbox"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, mfaRequired } = useAuth();

  if (loading) return <RetroLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  // aal1 session with a verified factor still owes the TOTP challenge — bounce to /auth.
  if (mfaRequired) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const AgencyRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, role, userClientId, mfaRequired } = useAuth();

  if (loading) return <RetroLoader />;

  if (!user) return <Navigate to="/auth" replace />;
  if (mfaRequired) return <Navigate to="/auth" replace />;
  if (role === 'client' && userClientId) {
    return <Navigate to={`/client/${userClientId}/analytics/chatbot/dashboard`} replace />;
  }

  return <>{children}</>;
};

const ClientRouteGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, role, userClientId, mfaRequired } = useAuth();
  const { clientId } = useParams<{ clientId: string }>();

  if (loading) return <RetroLoader />;

  if (!user) return <Navigate to="/auth" replace />;
  if (mfaRequired) return <Navigate to="/auth" replace />;

  if (role === 'client' && userClientId && clientId !== userClientId) {
    return <Navigate to={`/client/${userClientId}/analytics/chatbot/dashboard`} replace />;
  }

  return <>{children}</>;
};

// Gates internal debug/diagnostic pages behind creator mode. Non-creators are
// redirected to the client's dashboard instead of seeing the debug tools.
const CreatorRouteGuard = ({ children }: { children: React.ReactNode }) => {
  const { clientId } = useParams<{ clientId: string }>();
  const { isCreatorMode } = useCreatorMode();
  if (!isCreatorMode) {
    return <Navigate to={`/client/${clientId}/analytics/chatbot/dashboard`} replace />;
  }
  return <>{children}</>;
};

const IndexRoute = () => {
  const { user, loading, mfaRequired } = useAuth();

  if (loading) return <RetroLoader />;

  // Login-only: logged-out users (and aal1 sessions still owing the TOTP challenge)
  // land on the sign-in page; only fully-authed users redirect to their workspace.
  return (user && !mfaRequired)
    ? <Suspense fallback={<RetroLoader />}><RedirectToFirstClient /></Suspense>
    : <Suspense fallback={<RetroLoader />}><Auth /></Suspense>;
};

const ConditionalSupportChat = () => {
  const location = useLocation();
  const { user } = useAuth();
  const { clientId } = useParams<{ clientId: string }>();
  const [isPresentationOnly, setIsPresentationOnly] = useState(false);
  
  useEffect(() => {
    const checkPresentationMode = async () => {
      if (!clientId) {
        setIsPresentationOnly(false);
        return;
      }
      
      const { data } = await supabase
        .from('clients')
        .select('presentation_only_mode')
        .eq('id', clientId)
        .single();
      
      setIsPresentationOnly(data?.presentation_only_mode === true);
    };
    
    checkPresentationMode();
  }, [clientId]);
  
  if (location.pathname.startsWith('/demo/')) {
    return null;
  }
  
  if (isPresentationOnly) {
    return null;
  }
  
  return user ? <Suspense fallback={null}><SupportChatWidget /></Suspense> : null;
};

const App = () => {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ImageZoomProvider>
          <Toaster />
          <Sonner />
          
          <BrowserRouter>
          <NavigationGuardProvider>
          <Suspense fallback={<RetroLoader />}>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            {/* Public signup retired (login-only). /register + the waitlist Home page
                are unrouted; signup is also disabled at the GoTrue API. /verify kept
                for any in-flight email confirmation links. */}
            <Route path="/verify" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/subscribe" element={<ProtectedRoute><Subscribe /></ProtectedRoute>} />
            <Route path="/demo/:slug" element={<PublicDemoPage />} />
            <Route 
              path="/" 
              element={<IndexRoute />}
            />
            
            <Route path="/client/:clientId" element={<ClientRouteGuard><ClientLayout /></ClientRouteGuard>}>
              <Route index element={<Navigate to="analytics/chatbot/dashboard" replace />} />
              
              <Route path="analytics" element={<AnalyticsLayout />}>
                <Route index element={<Navigate to="chatbot/dashboard" replace />} />
                <Route path="chatbot/dashboard" element={<ChatAnalytics />} />
                <Route path="chatbot/chat-with-ai" element={<ChatAnalytics />} />
                <Route path="voice-ai/dashboard" element={<ChatAnalytics />} />
                <Route path="voice-ai/chat-with-ai" element={<ChatAnalytics />} />
              </Route>
              
              <Route path="analytics-v2" element={<AnalyticsV2 />} />
              
              <Route path="dashboard" element={<Navigate to="analytics/chatbot/dashboard" replace />} />
              <Route path="chat-analytics" element={<Navigate to="analytics/chatbot/dashboard" replace />} />
              
              <Route path="what-to-do" element={<WhatToDo />} />
              <Route path="credentials" element={<AgencyRoute><ApiCredentials /></AgencyRoute>} />
              <Route path="text-ai-rep" element={<Navigate to="setup" replace />} />
              <Route path="text-ai-rep/setup" element={<TextAIRepSetup />} />
              {/* Legacy alias — kept so existing bookmarks + the previously-shipped
                  AI REP CONFIG button target still resolve. Renamed 2026-05-18. */}
              <Route path="text-ai-rep/configuration" element={<Navigate to="../setup" replace />} />
              <Route path="text-ai-rep/templates" element={<TextAIRepTemplates />} />
              <Route path="voice-ai-rep" element={<Navigate to="setup" replace />} />
              <Route path="voice-ai-rep/setup" element={<VoiceAIRepSetup />} />
              <Route path="voice-ai-rep/configuration" element={<Navigate to="../setup" replace />} />
              <Route path="voice-ai-rep/templates" element={<VoiceAIRepTemplates />} />
              <Route path="api" element={<TextAIRepSetup />} />
              <Route path="api/configuration" element={<TextAIRepSetup />} />
              <Route path="api/workflow-imports" element={<TextAIRepTemplates />} />
              <Route path="api/credentials" element={<AgencyRoute><ApiCredentials /></AgencyRoute>} />
              {/* Webinar routes archived 2026-05-18 (product dormant per Brendan).
                  Pages moved to frontend/src/pages/_archived/. To revive: restore
                  the 6 lazy imports + 7 routes + move pages back. */}
              <Route path="prompts" element={<Navigate to="prompts/text" replace />} />
              <Route path="prompts/text" element={<PromptManagement />} />
              <Route path="prompts/voice" element={<PromptManagement />} />
              <Route path="prompts/viz-demo" element={<VisualizationDemo />} />
              <Route path="deploy-ai-reps" element={<DeployAIReps />} />
              <Route path="debug-ai-reps" element={<CreatorRouteGuard><DebugAIReps /></CreatorRouteGuard>} />
              <Route path="debug-ai-reps/text" element={<CreatorRouteGuard><DebugTextAIRep /></CreatorRouteGuard>} />
              <Route path="debug-ai-reps/voice" element={<CreatorRouteGuard><DebugVoiceAIRep /></CreatorRouteGuard>} />
              <Route path="debug-inject-lead" element={<CreatorRouteGuard><DebugInjectLead /></CreatorRouteGuard>} />
              <Route path="knowledge-base" element={<KnowledgeBase />} />
              <Route path="leads" element={<Contacts />} />
              <Route path="leads/files" element={<LeadFileProcessing />} />
              <Route path="leads/:contactId" element={<ContactDetail />} />
              <Route path="chats" element={<Chats />} />
              <Route path="campaigns" element={<Dashboard />} />
              <Route path="campaigns/create" element={<CampaignCreate />} />
              <Route path="campaigns/:campaignId" element={<CampaignDetail />} />
              <Route path="demo-pages" element={<DemoPages />} />
              <Route path="demo-pages/:pageId" element={<DemoPageEditor />} />
              <Route path="sms-contacts" element={<DemoPageContacts />} />
              <Route path="sms-contacts/:contactId" element={<DemoPageContactChat />} />
              <Route path="instagram-dms" element={<InstagramDMs />} />
              
              <Route path="email" element={<EmailInbox />} />
              <Route path="speed-to-lead" element={<SpeedToLeadLayout />}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<SpeedToLeadDashboard />} />
                <Route path="contacts" element={<SpeedToLeadContacts />} />
              </Route>
              <Route path="speed-to-lead/contacts/:contactId" element={<SpeedToLeadContactDetail />} />
              <Route path="settings" element={<AgencyRoute><ClientSettings /></AgencyRoute>} />
              <Route path="manage-clients" element={<AgencyRoute><ManageClients /></AgencyRoute>} />
              <Route path="create-client" element={<AgencyRoute><CreateClient /></AgencyRoute>} />
              <Route path="account-settings" element={<AccountSettings />} />
              <Route path="client-portal" element={<ClientPortal />} />
              <Route path="error-logs" element={<ErrorLogs />} />
              <Route path="request-logs" element={<RequestLogs />} />
              <Route path="logs" element={<Logs />} />
              <Route path="usage-credits" element={<UsageCredits />} />
              <Route path="supabase-usage" element={<SupabaseUsage />} />
              <Route path="templates" element={<Templates />} />
              <Route path="lead-reactivation" element={<LeadReactivation />} />
              <Route path="voice-ai-setter" element={<Navigate to="../prompts/voice" replace />} />
              {/* /voice-ai-setter-legacy route archived 2026-05-18; page moved to
                  frontend/src/pages/_archived/VoiceAISetter.tsx. Use /prompts/voice instead. */}
              <Route path="simulator" element={<Simulator />} />
              <Route path="tier-list" element={<TierList />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="workflows/process-dms" element={<ProcessDMs />} />
              <Route path="workflows/sync-ghl-contacts" element={<SyncGHLContacts />} />
              <Route path="workflows/outbound-call-processing" element={<OutboundCallProcessing />} />
              <Route path="workflows/sync-ghl-bookings" element={<SyncGHLBookings />} />
              <Route path="workflows/engagement" element={<Engagement />} />
              <Route path="workflows/:workflowId" element={<WorkflowEditor />} />
            </Route>
            <Route 
              path="/create" 
              element={
                <ProtectedRoute>
                  <CampaignCreate />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/campaign/:campaignId" 
              element={
                <ProtectedRoute>
                  <CampaignDetail />
                </ProtectedRoute>
              } 
            />
            {/* /settings (profile + logo upload + change password), reached via the
                AppHeader gear. Change-password is ALSO surfaced in the sidebar's
                Account Settings so it is reachable both ways. */}
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
            <ConditionalSupportChat />
          </NavigationGuardProvider>
          </BrowserRouter>
        </ImageZoomProvider>
      </TooltipProvider>
    </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;
