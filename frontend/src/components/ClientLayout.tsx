import { Outlet, useParams, useNavigate, useLocation } from "react-router-dom";
import { SubscriptionGatedOutlet } from "./SubscriptionGatedOutlet";

import { BarChart3, BookOpen, Database, FileText, Layout, Wrench, Settings, User, Plus, ChevronDown, ChevronRight, Video, LogOut, Trash2, GripVertical, HelpCircle, Key, Phone, Bug, Presentation, Users, Home, AlertTriangle, Mic, CreditCard, Target, MessageSquare } from "@/components/icons";
import { PageHeaderProvider } from "@/contexts/PageHeaderContext";
import { PageHeader } from "@/components/PageHeader";
import { SystemTicker } from "./SystemTicker";
import { NavLink } from "./NavLink";
import { useEffect, useState, useRef, useCallback } from "react";
import { useWhatToDoAcknowledged } from "@/hooks/useWhatToDoAcknowledged";
import { supabase } from "@/integrations/supabase/client";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarHeader, SidebarFooter } from "@/components/ui/sidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import RetroLoader from "@/components/RetroLoader";
import { useClientMenuConfig, MENU_ROUTE_MAP, type MenuItemConfig } from "@/hooks/useClientMenuConfig";
import { useErrorLogNotifications } from "@/hooks/useErrorLogNotifications";
import { CHAT_UNREAD_SYNC_EVENT, hasUnreadMessages, isChatUnreadSyncEvent } from "@/lib/chatUnread";

import React from "react";

const ScrollToTopOnRoute: React.FC<React.HTMLAttributes<HTMLDivElement> & { style?: React.CSSProperties }> = ({ children, ...props }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    ref.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return <div ref={ref} {...props}>{children}</div>;
};

// Presentation-only mode is now controlled via the `presentation_only_mode` column in the clients table
const menuItemsBeforeWebinar = [{
  title: "Knowledgebase",
  url: "/knowledge-base",
  icon: BookOpen
}, {
  title: "Contacts",
  url: "/leads",
  icon: Users
}, {
  title: "DB Reactivation",
  url: "/campaigns",
  icon: Database
}];

// Hidden for now - will be enabled in future
// const menuItemsAfterWebinar = [
//   { title: "Demo Pages", url: "/demo-pages", icon: Layout },
//   { title: "Client Portal", url: "/client-portal", icon: User },
// ];
const menuItemsAfterWebinar: typeof menuItemsBeforeWebinar = [{
  title: "Logs",
  url: "/logs",
  icon: AlertTriangle
}, {
  title: "OpenRouter Usage",
  url: "/usage-credits",
  icon: CreditCard
}, {
  title: "Supabase Usage",
  url: "/supabase-usage",
  icon: Database
}, {
  title: "Templates",
  url: "/templates",
  icon: FileText
}];
const demoPagesSubItems = [
  { title: "Knowledgebase", url: "/knowledge-base", icon: BookOpen },
  { title: "DB Reactivation", url: "/campaigns", icon: Database },
  { title: "Email", url: "/email", icon: MessageSquare },
  
  { title: "Lead Reactivation", url: "/lead-reactivation", icon: Target },
  { title: "Demo Pages", url: "/demo-pages", icon: Layout },
  { title: "SMS Contacts", url: "/sms-contacts", icon: MessageSquare },
  { title: "Instagram DMs", url: "/instagram-dms", icon: MessageSquare },
  { title: "Speed to Lead", url: "/speed-to-lead/dashboard", icon: Target },
  { title: "Viz Demo", url: "/prompts/viz-demo", icon: Layout },
  { title: "Tier List", url: "/tier-list", icon: Layout },
  { title: "Home", url: "/home", icon: Home, isExternal: true },
];
const analyticsSubItems = [{
  title: "Text AI Rep",
  url: "/analytics/chatbot",
  defaultPath: "/analytics/chatbot/dashboard"
}];
const webinarSubItems = [{
  title: "Configuration",
  url: "/webinar-setup/configuration"
}, {
  title: "Pre-Launch Checklist",
  url: "/webinar-setup/checklist"
}, {
  title: "Credentials",
  url: "/webinar-setup/credentials"
}, {
  title: "Analytics",
  url: "/webinar-setup/analytics"
}, {
  title: "Presentation Agent",
  url: "/webinar-setup/presentation-agent"
}];
const textAIRepSubItems = [{
  title: "Configuration",
  url: "/text-ai-rep/configuration"
}, {
  title: "Templates",
  url: "/text-ai-rep/templates"
}];
// Voice AI Rep hidden for now
const voiceAIRepSubItems: typeof textAIRepSubItems = [];

// What To Do menu item with pulsating red effect
function WhatToDoMenuItem({
  clientId
}: {
  clientId: string | undefined;
}) {
  const {
    acknowledged,
    isLoading
  } = useWhatToDoAcknowledged(clientId);
  const shouldPulse = !isLoading && !acknowledged;
  return <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <NavLink to={`/client/${clientId}/what-to-do`} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors hover:bg-muted/50 ${shouldPulse ? 'animate-pulse-red border-2 border-red-500/50 bg-red-500/5' : ''}`} activeClassName="bg-primary/10 text-primary font-semibold border-l-4 border-primary">
          <HelpCircle className="h-4 w-4" />
          <span>What To Do</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>;
}
interface Client {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
}

// Sortable client item component
function SortableClientItem({
  client,
  isSelected,
  onSelect
}: {
  client: Client;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: client.id
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };
  return <div ref={setNodeRef} style={style} className={`relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-3 text-sm outline-none hover:bg-accent hover:text-accent-foreground ${isSelected ? 'bg-accent' : ''}`} onClick={onSelect}>
      <div {...attributes} {...listeners} className="mr-2 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex flex-col items-start flex-1">
        <span className="font-medium">{client.name}</span>
        {client.description && <span className="text-xs text-muted-foreground">{client.description}</span>}
      </div>
    </div>;
}
function ClientSidebar() {
  const {
    clientId
  } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    role: userRole
  } = useAuth();
  const isAgency = userRole === 'agency';
  const [clients, setClients] = useState<Client[]>([]);
  const [currentClient, setCurrentClient] = useState<Client | null>(null);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [showAddClientDialog, setShowAddClientDialog] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [clientData, setClientData] = useState({
    name: "",
    email: "",
    description: ""
  });
  const [createLogin, setCreateLogin] = useState(false);
  const [loginData, setLoginData] = useState({ email: "", password: "", full_name: "" });
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [webinarExpanded, setWebinarExpanded] = useState(false);
  const [textAIRepExpanded, setTextAIRepExpanded] = useState(false);
  const [voiceAIRepExpanded, setVoiceAIRepExpanded] = useState(false);
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  const [demoPagesExpanded, setDemoPagesExpanded] = useState(false);
  
  // Menu config for client users
  const { menuConfig, loading: menuConfigLoading, refetch: refetchMenuConfig } = useClientMenuConfig(clientId);

  // Subscribe to menu config changes so sidebar updates after saving in the editor
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase.channel(`menu-config-${clientId}`).on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'client_menu_config',
      filter: `client_id=eq.${clientId}`,
    }, () => {
      refetchMenuConfig();
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, refetchMenuConfig]);


  // ── Unread chats indicator (simple: leads.last_message_at vs chat_read_status.last_read_at) ──
  const [hasUnreadChats, setHasUnreadChats] = useState(false);

  const checkUnreadChats = useCallback(async () => {
    if (!clientId) return;
    try {
      // Fetch leads that have received at least one message
      const { data: leadsWithMessages } = await supabase
        .from('leads')
        .select('id, last_message_at')
        .eq('client_id', clientId)
        .not('last_message_at', 'is', null);

      if (!leadsWithMessages || leadsWithMessages.length === 0) {
        setHasUnreadChats(false);
        return;
      }

      // Fetch read status for those leads
      const leadIds = leadsWithMessages.map(l => l.id);
      const { data: readRows } = await (supabase as any)
        .from('chat_read_status')
        .select('lead_id, last_read_at')
        .eq('client_id', clientId)
        .in('lead_id', leadIds);

      const readMap: Record<string, string> = {};
      if (readRows) readRows.forEach((r: any) => { readMap[r.lead_id] = r.last_read_at; });

      const hasUnread = leadsWithMessages.some((lead: any) => {
        const lastRead = readMap[lead.id];
        return hasUnreadMessages(lead.last_message_at, lastRead);
      });
      setHasUnreadChats(hasUnread);
    } catch (err) {
      console.error('Error checking unread chats:', err);
    }
  }, [clientId]);

  // Keep a local cache of leads + read timestamps so realtime can update instantly
  const leadsWithMsgRef = useRef<{ id: string; last_message_at: string }[]>([]);
  const readMapRef = useRef<Record<string, string>>({});

  const recomputeUnread = useCallback(() => {
    const hasUnread = leadsWithMsgRef.current.some(lead => {
      const lastRead = readMapRef.current[lead.id];
      return hasUnreadMessages(lead.last_message_at, lastRead);
    });
    setHasUnreadChats(hasUnread);
  }, []);

  // Wrap checkUnreadChats to also populate the refs
  const checkAndCacheUnread = useCallback(async () => {
    await checkUnreadChats();
    // Re-fetch into refs for instant realtime updates
    if (!clientId) return;
    try {
      const { data: lwm } = await supabase
        .from('leads')
        .select('id, last_message_at')
        .eq('client_id', clientId)
        .not('last_message_at', 'is', null);
      leadsWithMsgRef.current = lwm || [];
      const leadIds = (lwm || []).map((l: any) => l.id);
      if (leadIds.length > 0) {
        const { data: rr } = await (supabase as any)
          .from('chat_read_status')
          .select('lead_id, last_read_at')
          .eq('client_id', clientId)
          .in('lead_id', leadIds);
        const rm: Record<string, string> = {};
        if (rr) rr.forEach((r: any) => { rm[r.lead_id] = r.last_read_at; });
        readMapRef.current = rm;
      }
    } catch {}
  }, [clientId, checkUnreadChats]);

  useEffect(() => {
    checkAndCacheUnread();
    const interval = setInterval(checkAndCacheUnread, 15000);
    return () => clearInterval(interval);
  }, [checkAndCacheUnread]);

  useEffect(() => {
    if (!clientId) return;

    const handleUnreadSync = (event: Event) => {
      if (!isChatUnreadSyncEvent(event) || event.detail.clientId !== clientId) return;
      setHasUnreadChats(event.detail.hasUnread);
    };

    window.addEventListener(CHAT_UNREAD_SYNC_EVENT, handleUnreadSync);
    return () => {
      window.removeEventListener(CHAT_UNREAD_SYNC_EVENT, handleUnreadSync);
    };
  }, [clientId]);

  // Instantly update unread dot via realtime — no DB round-trip
  useEffect(() => {
    if (!clientId) return;
    const channel = supabase.channel(`unread-chats-${clientId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'chat_read_status', filter: `client_id=eq.${clientId}` },
        (payload: any) => {
          const leadId = payload.new?.lead_id;
          const lastReadAt = payload.new?.last_read_at;
          if (leadId && lastReadAt) {
            readMapRef.current = { ...readMapRef.current, [leadId]: lastReadAt };
            recomputeUnread();
          }
        }
      )
      .on(
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'leads', filter: `client_id=eq.${clientId}` },
        (payload: any) => {
          const lead = payload.new;
          if (lead?.last_message_at) {
            const existing = leadsWithMsgRef.current;
            const idx = existing.findIndex(l => l.id === lead.id);
            if (idx >= 0) {
              existing[idx] = { id: lead.id, last_message_at: lead.last_message_at };
            } else {
              existing.push({ id: lead.id, last_message_at: lead.last_message_at });
            }
            leadsWithMsgRef.current = [...existing];
            recomputeUnread();
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, recomputeUnread]);

  useEffect(() => {
    fetchClients();

    // Subscribe to client changes to refresh logo/data updates
    const channel = supabase.channel('client-changes').on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'clients'
    }, () => {
      fetchClients();
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
  useEffect(() => {
    if (clientId && clients.length > 0) {
      const client = clients.find(c => c.id === clientId);
      if (client) {
        setCurrentClient(client);
      } else {
        // Client not in list yet (e.g. just created) — refetch
        fetchClients();
      }
    }
  }, [clientId, clients]);

  // Expand menus when on their routes
  useEffect(() => {
    const isAnalyticsRoute = location.pathname.includes('/analytics/');
    const isWebinarRoute = location.pathname.includes('/webinar-setup/');
    const isTextAIRepRoute = location.pathname.includes('/text-ai-rep/');
    const isVoiceAIRepRoute = location.pathname.includes('/voice-ai-rep/');
    const isPromptsRoute = location.pathname.includes('/prompts');
    const isDemoPagesRoute = location.pathname.includes('/lead-reactivation') || location.pathname.includes('/demo-pages') || location.pathname.includes('/sms-contacts') || location.pathname.includes('/instagram-dms') || location.pathname.includes('/email') || location.pathname.includes('/prompts/viz-demo') || location.pathname.includes('/tier-list') || location.pathname.includes('/speed-to-lead');
    setAnalyticsExpanded(isAnalyticsRoute);
    setWebinarExpanded(isWebinarRoute);
    setTextAIRepExpanded(isTextAIRepRoute);
    setVoiceAIRepExpanded(isVoiceAIRepRoute);
    setPromptsExpanded(isPromptsRoute);
    setDemoPagesExpanded(isDemoPagesRoute);
  }, [location.pathname]);
  const fetchClients = async () => {
    try {
      setIsLoadingClients(true);
      const {
        data,
        error
      } = await supabase.from("clients_public").select("id, name, description, image_url, sort_order, presentation_only_mode").eq("is_system", false).order("sort_order");
      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error("Error fetching clients:", error);
    } finally {
      setIsLoadingClients(false);
    }
  };
  const handleDragEnd = async (event: DragEndEvent) => {
    const {
      active,
      over
    } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = clients.findIndex(c => c.id === active.id);
    const newIndex = clients.findIndex(c => c.id === over.id);
    const newClients = arrayMove(clients, oldIndex, newIndex);
    setClients(newClients);

    // Update sort_order in database
    try {
      const updates = newClients.map((client, index) => ({
        id: client.id,
        sort_order: index + 1
      }));
      for (const update of updates) {
        await supabase.from("clients").update({
          sort_order: update.sort_order
        }).eq("id", update.id);
      }
    } catch (error) {
      console.error("Error updating client order:", error);
      toast.error("Failed to save sub-account order");
      fetchClients(); // Revert on error
    }
  };
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8
    }
  }), useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  }));
  const handleClientChange = (newClientId: string) => {
    navigate(`/client/${newClientId}/analytics/chatbot/dashboard`);
  };
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Please select an image smaller than 5MB");
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = e => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };
  const uploadImage = async (file: File, clientId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${clientId}-${Date.now()}.${fileExt}`;
    const {
      data,
      error
    } = await supabase.storage.from('logos').upload(fileName, file, {
      cacheControl: '0',
      upsert: true
    });
    if (error) throw error;
    const {
      data: {
        publicUrl
      }
    } = supabase.storage.from('logos').getPublicUrl(fileName);
    return `${publicUrl}?t=${Date.now()}`;
  };
  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setUploading(true);
    try {
      const {
        data: profile,
        error: profileError
      } = await supabase.from('profiles').select('agency_id').eq('id', user.id).single();
      if (profileError || !profile.agency_id) {
        throw new Error('Agency not found');
      }

      // Get max sort_order for new client
      const maxSortOrder = clients.length > 0 ? Math.max(...clients.map(c => c.sort_order || 0)) : 0;
      const {
        data: newClient,
        error: clientError
      } = await supabase.from('clients').insert({
        name: clientData.name,
        email: clientData.email || null,
        description: clientData.description || null,
        agency_id: profile.agency_id,
        sort_order: maxSortOrder + 1
      }).select().single();
      if (clientError) throw clientError;
      let imageUrl = null;
      if (selectedImage && newClient) {
        imageUrl = await uploadImage(selectedImage, newClient.id);
        const {
          error: updateError
        } = await supabase.from('clients').update({
          image_url: imageUrl
        }).eq('id', newClient.id);
        if (updateError) throw updateError;
      }
      // Optionally create a sub-account login user
      if (createLogin && loginData.email && loginData.password && newClient) {
        try {
          const response = await supabase.functions.invoke('create-client-user', {
            body: {
              email: loginData.email,
              password: loginData.password,
              full_name: loginData.full_name,
              client_id: newClient.id,
            },
          });
          if (response.error || response.data?.error) {
            toast.error(`Sub-account created but login failed: ${response.data?.error || response.error?.message}`);
          } else {
            toast.success(`Sub-account created with login: ${loginData.email}`);
          }
        } catch (err: any) {
          toast.error(`Sub-account created but login failed: ${err.message}`);
        }
      } else {
        toast.success("Sub-account created successfully");
      }
      setShowAddClientDialog(false);
      setClientData({ name: "", email: "", description: "" });
      setCreateLogin(false);
      setLoginData({ email: "", password: "", full_name: "" });
      setSelectedImage(null);
      setImagePreview("");
      fetchClients();
      if (newClient) {
        navigate(`/client/${newClient.id}/analytics/chatbot/dashboard`);
      }
    } catch (error) {
      console.error("Error creating sub-account:", error);
      toast.error("Failed to create sub-account");
    } finally {
      setUploading(false);
    }
  };
  const handleDeleteClient = async () => {
    if (!currentClient) return;
    setDeleting(true);
    try {
      // Use the database function to delete client with all related data
      const {
        error
      } = await supabase.rpc('delete_client_with_data', {
        client_id_param: currentClient.id
      });
      if (error) throw error;
      toast.success(`${currentClient.name} has been deleted`);
      setShowDeleteDialog(false);

      // Refresh clients and navigate
      const remainingClients = clients.filter(c => c.id !== currentClient.id);
      if (remainingClients.length > 0) {
        navigate(`/client/${remainingClients[0].id}/analytics/chatbot/dashboard`);
      } else {
        navigate('/');
      }
      fetchClients();
    } catch (error: any) {
      console.error("Error deleting sub-account:", error);
      toast.error(error.message || "Failed to delete sub-account");
    } finally {
      setDeleting(false);
    }
  };
  // Check if this client has presentation-only mode enabled in the database
  const isPresentationOnlyMode = (currentClient as any)?.presentation_only_mode === true;

  // Auto-redirect to presentation agent if in presentation-only mode but on wrong route
  useEffect(() => {
    if (isPresentationOnlyMode && clientId) {
      const isOnPresentationAgent = location.pathname.includes("/webinar-presentation-agent");
      if (!isOnPresentationAgent) {
        navigate(`/client/${clientId}/webinar-presentation-agent`, { replace: true });
      }
    }
  }, [isPresentationOnlyMode, clientId, location.pathname, navigate]);

  // Show loading state until we know if it's presentation-only mode
  if (isLoadingClients || !currentClient) {
    return <RetroLoader />;
  }

  // Full-page mode for Presentation Agent - no sidebar
  if (isPresentationOnlyMode) {
    const handleLogout = async () => {
      try {
        localStorage.removeItem('sb-awzlcmdomhtyqjabzvnn-auth-token');
        await supabase.auth.signOut({ scope: 'global' });
      } catch (e) {
        console.log('Sign out cleanup:', e);
      }
      navigate('/auth', { replace: true });
    };

    return (
      <div className="h-screen w-full overflow-hidden bg-background flex flex-col">
        {/* Minimal header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
          <div className="flex items-center gap-3">
            {currentClient?.image_url && (
              <img src={currentClient.image_url} alt="Logo" className="h-8 object-contain" />
            )}
            <span className="text-sm font-medium text-foreground">{currentClient?.name || "Sub-Account"}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </header>
        
        {/* Full-page content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </div>
      </div>
    );
  }

  // Regular sidebar for all other users
  return <>

    <Sidebar collapsible="icon" className="border-r-0" style={{ borderRight: '3px groove hsl(var(--border-groove))' }}>
      <SidebarHeader className="border-b border-border px-3 space-y-2 h-[55px] flex flex-col justify-center" style={{ borderBottom: '3px groove hsl(var(--border-groove))' }}>
        {/* Logo */}
        {currentClient?.image_url && <div className="flex items-center justify-center">
            <img src={currentClient.image_url} alt="Sub-Account Logo" className="h-10 object-contain" />
          </div>}
        
        {/* Sub-Account Selector - Agency only; Client users see static name */}
        {isAgency ? (
          <Select value={clientId} onValueChange={handleClientChange}>
            <SelectTrigger className="w-full bg-muted/80 hover:bg-muted" style={{ fontFamily: "'VT323', monospace", fontSize: '18px', textTransform: 'uppercase' }}>
              <SelectValue placeholder="Select Sub-Account">
                {currentClient?.name || "Select Sub-Account"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-[100]">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={clients.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  {clients.map(client => <SortableClientItem key={client.id} client={client} isSelected={client.id === clientId} onSelect={() => handleClientChange(client.id)} />)}
                </SortableContext>
              </DndContext>
              
              {/* Groove border separator */}
              <div className="mt-2" style={{ borderTop: '3px groove hsl(var(--border-groove))', marginLeft: '-4px', marginRight: '-4px' }} />
              
              {/* Add New Sub-Account Button inside dropdown */}
              <div className="px-1 pt-2 flex flex-col gap-2 pb-1">
                <button
                  className="groove-btn w-full flex items-center justify-center gap-2 !h-8"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', letterSpacing: '1px' }}
                  onClick={e => {
                    e.preventDefault();
                    setShowAddClientDialog(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  <span>ADD SUB-ACCOUNT</span>
                </button>
                
                {/* Delete Current Sub-Account Button */}
                {currentClient && <button
                  className="groove-btn groove-btn-destructive w-full flex items-center justify-center gap-2 !h-8"
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', letterSpacing: '1px' }}
                  onClick={e => {
                    e.preventDefault();
                    setShowDeleteDialog(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  <span>DELETE SUB-ACCOUNT</span>
                </button>}
              </div>
            </SelectContent>
          </Select>
        ) : (
          <div className="w-full px-3 py-2 bg-muted/80 rounded-md" style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}>
            {currentClient?.name || "My Account"}
          </div>
        )}
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Both roles respect the saved visible flag. Agency toggles items
                  on/off per-client via ClientMenuConfigEditor; hiding the agency
                  bypass prevents the daily sidebar from rendering every item ever
                  defined (fixed 2026-05-20 phase-night-sidebar-agency-respects-visible-flag). */}
              {menuConfig ? (
                <>
                  {menuConfig
                    .filter(i => i.visible)
                    .map((item) => {
                      if (item.type === 'section-label') {
                        return <div key={item.key} className="sidebar-section-label">{item.label}</div>;
                      }
                      if (item.type === 'divider') {
                        return <div key={item.key} className="border-t border-dashed border-border mt-2 -mx-4" />;
                      }
                      const route = MENU_ROUTE_MAP[item.key];
                      if (!route) return null;

                      // Special case: demo-pages has expandable sub-items for agency
                      if (item.key === 'demo-pages' && isAgency) {
                        return (
                          <SidebarMenuItem key={item.key}>
                            <SidebarMenuButton onClick={() => setDemoPagesExpanded(!demoPagesExpanded)} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 cursor-pointer sidebar-nav-item">
                              <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>{item.icon}</span>
                              <span className="flex-1">{item.label}</span>
                              {demoPagesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </SidebarMenuButton>
                            {demoPagesExpanded && <div className="ml-6 mt-1 space-y-1">
                              {demoPagesSubItems.map(subItem => {
                                const currentPath = location.pathname;
                                const isActive = currentPath.includes(subItem.url);
                                const linkTo = (subItem as any).isExternal ? subItem.url : `/client/${clientId}${subItem.url}`;
                                return <SidebarMenuButton key={subItem.title} asChild>
                                  {(subItem as any).isExternal ? (
                                    <a href={linkTo} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 w-full text-left sidebar-nav-item" style={{ fontSize: '14px' }}>
                                      <span>{subItem.title}</span>
                                    </a>
                                  ) : (
                                    <NavLink to={linkTo} className={`flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 w-full text-left sidebar-nav-item ${isActive ? 'bg-primary/10 text-primary border-l-2 border-primary' : ''}`} activeClassName="" style={{ fontSize: '14px' }}>
                                      <span>{isActive ? '▸ ' : ''}{subItem.title}</span>
                                    </NavLink>
                                  )}
                                </SidebarMenuButton>;
                              })}
                            </div>}
                          </SidebarMenuItem>
                        );
                      }

                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton asChild>
                            <NavLink
                              to={`/client/${clientId}${route}`}
                              className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item"
                              activeClassName="bg-primary/10 text-primary border-l-2 border-primary"
                            >
                              {item.icon && (
                                <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>
                                  {item.icon}
                                </span>
                              )}
                              <span className="flex-1">{item.key === 'workflows' ? 'Campaigns' : item.label}</span>
                              {route === '/chats' && hasUnreadChats && <span className="w-2 h-2 rounded-[1px] bg-primary shrink-0" />}
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                </>
              ) : (
                // No config saved yet: show hardcoded default menu
                <>
              <div className="sidebar-section-label">MAIN</div>
              {/* Single Analytics entry (merged Text + Voice 2026-05-18). The page
                  has internal Text/Voice tabs via TabsList at the top of ChatAnalytics.tsx
                  and reads the channel from the URL path (/analytics/chatbot/... vs
                  /analytics/voice-ai/...). Default landing is the chatbot view. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/analytics/chatbot/dashboard`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>▤</span>
                    <span>Analytics</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/leads`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>◇</span>
                    <span>Leads</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/chats`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>✉</span>
                    <span className="flex-1">Conversations</span>
                    {hasUnreadChats && <span className="w-2 h-2 rounded-[1px] bg-primary shrink-0" />}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <div className="sidebar-section-label">CONFIG</div>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/credentials`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⚷</span>
                    <span>Credentials</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/prompts/text`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>░</span>
                    <span>Text Setter</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/prompts/voice`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>♫</span>
                    <span>Voice Setter</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isAgency && <>
              <div className="sidebar-section-label">OPS</div>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/simulator`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⚔</span>
                    <span>Simulator</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/workflows`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⛓</span>
                    <span>Campaigns</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/logs`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⚡</span>
                    <span>Logs</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <div className="sidebar-section-label">BACKEND</div>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/usage-credits`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>□</span>
                    <span>OpenRouter Usage</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/supabase-usage`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⛁</span>
                    <span>Supabase Usage</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/templates`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⌐</span>
                    <span>Source Files</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setDemoPagesExpanded(!demoPagesExpanded)} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 cursor-pointer sidebar-nav-item">
                  <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⊞</span>
                  <span className="flex-1">Work Pages</span>
                  {demoPagesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </SidebarMenuButton>
                {demoPagesExpanded && <div className="ml-6 mt-1 space-y-1">
                  {demoPagesSubItems.map(subItem => {
                    const currentPath = location.pathname;
                    const isActive = currentPath.includes(subItem.url);
                    const linkTo = (subItem as any).isExternal ? subItem.url : `/client/${clientId}${subItem.url}`;
                    return <SidebarMenuButton key={subItem.title} asChild>
                      {(subItem as any).isExternal ? (
                        <a href={linkTo} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 w-full text-left sidebar-nav-item" style={{ fontSize: '14px' }}>
                          <span>{subItem.title}</span>
                        </a>
                      ) : (
                        <NavLink to={linkTo} className={`flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 w-full text-left sidebar-nav-item ${isActive ? 'bg-primary/10 text-primary border-l-2 border-primary' : ''}`} activeClassName="" style={{ fontSize: '14px' }}>
                          <span>{isActive ? '▸ ' : ''}{subItem.title}</span>
                        </NavLink>
                      )}
                    </SidebarMenuButton>;
                  })}
                </div>}
              </SidebarMenuItem>
              </>}
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-0">
          <SidebarGroupContent>
            <div className="section-separator px-3 py-2">SYSTEM</div>
            <SidebarMenu>
              {/* Sub-Accounts (list → click a sub-account → its config) - agency only */}
              {isAgency && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                      <NavLink to={`/client/${clientId}/manage-clients`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                       <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>⚙</span>
                       <span>Sub-Accounts</span>
                      </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {/* Sub-Account Config (per-client deep config: Timezone, Contact hours,
                  Voicemail, Logo, cost ceilings, menu + field-access governance) is no
                  longer a top-level sidebar item (6.1). Agency reaches it by clicking a
                  sub-account inside Manage Sub-Accounts → /client/<id>/settings
                  (ClientSettings.tsx, still RequireAgency-guarded). Clients self-serve
                  the governed subset via My Account (2026-06-17 account-access
                  restructure). */}
              {/* Account Settings → /client/<id>/account-settings (AccountSettings.tsx)
                  User-level config: email, password, theme. Visible to both roles. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to={`/client/${clientId}/account-settings`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item" activeClassName="bg-primary/10 text-primary border-l-2 border-primary">
                    <span className="w-4 text-center text-foreground" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' }}>◉</span>
                    <span>My Account</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={async () => {
                    try {
                      localStorage.removeItem('sb-awzlcmdomhtyqjabzvnn-auth-token');
                      await supabase.auth.signOut({ scope: 'global' });
                    } catch (e) {
                      console.log('Sign out cleanup:', e);
                    }
                    navigate('/auth', { replace: true });
                  }}
                  className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 sidebar-nav-item text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>

    {/* Add Sub-Account Dialog */}
    <Dialog open={showAddClientDialog} onOpenChange={setShowAddClientDialog}>
      <DialogContent className="sm:max-w-[500px] !p-0">
        <DialogHeader>
          <DialogTitle>Add New Sub-Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleAddClient} className="space-y-4 p-6 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="client-name">Sub-Account Name *</Label>
            <Input id="client-name" value={clientData.name} onChange={e => setClientData({
              ...clientData,
              name: e.target.value
            })} placeholder="Enter sub-account name" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-email">Email</Label>
            <Input id="client-email" type="email" value={clientData.email} onChange={e => setClientData({
              ...clientData,
              email: e.target.value
            })} placeholder="Enter sub-account email" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-description">Description</Label>
            <Textarea id="client-description" value={clientData.description} onChange={e => setClientData({
              ...clientData,
              description: e.target.value
            })} placeholder="Enter sub-account description" rows={3} />
          </div>

          <div className="space-y-2">
            <Label>Sub-Account Logo</Label>
            <div className="flex flex-col gap-2">
              {imagePreview && <div className="relative w-32 h-32 border rounded-md overflow-hidden">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-contain" />
                </div>}
              <Input type="file" accept="image/*" onChange={handleImageSelect} />
            </div>
          </div>

          {isAgency && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="create-login"
                  checked={createLogin}
                  onChange={(e) => setCreateLogin(e.target.checked)}
                  className="rounded border-border"
                />
                <Label htmlFor="create-login" className="cursor-pointer text-sm">Create sub-account login</Label>
              </div>
              {createLogin && (
                <div className="space-y-3 pl-1">
                  <div className="space-y-1">
                    <Label htmlFor="login-name" className="text-xs">Full Name</Label>
                    <Input id="login-name" value={loginData.full_name} onChange={e => setLoginData({ ...loginData, full_name: e.target.value })} placeholder="Client user's name" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="login-email" className="text-xs">Login Email *</Label>
                    <Input id="login-email" type="email" value={loginData.email} onChange={e => setLoginData({ ...loginData, email: e.target.value })} placeholder="client@example.com" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="login-password" className="text-xs">Password *</Label>
                    <Input id="login-password" type="password" value={loginData.password} onChange={e => setLoginData({ ...loginData, password: e.target.value })} placeholder="Min 6 characters" />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => {
              setShowAddClientDialog(false);
              setClientData({ name: "", email: "", description: "" });
              setCreateLogin(false);
              setLoginData({ email: "", password: "", full_name: "" });
              setSelectedImage(null);
              setImagePreview("");
            }}>
              Cancel
            </Button>
            <Button type="submit" disabled={uploading || !clientData.name || (createLogin && (!loginData.email || !loginData.password))}>
              {uploading ? "Creating..." : "Create Sub-Account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    {/* Delete Sub-Account Confirmation Dialog */}
    <Dialog open={showDeleteDialog} onOpenChange={(open) => { setShowDeleteDialog(open); if (!open) setDeleteConfirmName(""); }}>
      <DialogContent className="!p-0">
        <DialogHeader>
          <DialogTitle>Delete Sub-Account</DialogTitle>
          <DialogDescription>
            This will permanently delete <strong>{currentClient?.name}</strong> and all associated data. Type the sub-account name below to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-2">
          <Label htmlFor="sidebar-confirm-name" className="text-xs text-muted-foreground">
            Type <strong>{currentClient?.name}</strong> to confirm
          </Label>
          <Input
            id="sidebar-confirm-name"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={currentClient?.name}
            className="mt-1"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteConfirmName(""); }} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDeleteClient} disabled={deleting || deleteConfirmName !== currentClient?.name}>
            {deleting ? "Deleting..." : "Delete Sub-Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Upgrade Prompt Dialog */}
    <Dialog open={showUpgradePrompt} onOpenChange={setShowUpgradePrompt}>
      <DialogContent className="sm:max-w-[420px] !p-0">
        <DialogHeader>
          <DialogTitle>Subscription Required</DialogTitle>
          <DialogDescription>
            Your free plan includes one sub-account. To add more sub-accounts, you need an active subscription. Each additional sub-account costs $10/month.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setShowUpgradePrompt(false)} disabled={subscribeLoading}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={subscribeLoading} onClick={async () => {
            setSubscribeLoading(true);
            try {
              const { data, error } = await supabase.functions.invoke('stripe-checkout', {
                body: { type: 'client', return_url: window.location.href },
              });
              if (error) throw new Error(error.message);
              if (data?.error) throw new Error(data.error);
              if (data?.url) window.location.href = data.url;
            } catch (err: any) {
              toast.error(err.message || 'Failed to start checkout');
              setSubscribeLoading(false);
            }
          }}>
            {subscribeLoading ? 'Redirecting...' : 'Subscribe — $10/mo'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>;
}
export function ClientLayout() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // Global real-time error notifications
  useErrorLogNotifications();

  const isSettingsRoute = location.pathname.endsWith("/settings") || location.pathname.endsWith("/account-settings") || location.pathname.endsWith("/manage-clients") || location.pathname.endsWith("/create-client");
  const isSimulatorRoute = location.pathname.endsWith("/simulator");
  
  const isLeadsListRoute = /^\/client\/[^/]+\/leads$/.test(location.pathname);
  const isLeadDetailRoute = /\/leads\/[^/]+$/.test(location.pathname);
  const isChatsRoute = /^\/client\/[^/]+\/chats$/.test(location.pathname);
  const isWorkflowsRoute = /^\/client\/[^/]+\/workflows$/.test(location.pathname);
  const isWorkflowEditorRoute = /\/workflows\/[^/]+$/.test(location.pathname);
  const isErrorLogsRoute = location.pathname.endsWith("/error-logs") || location.pathname.endsWith("/logs");
  const isAnalyticsLayoutRoute = location.pathname.includes('/analytics/');

  return (
    <SidebarProvider>
      <div className="h-screen min-h-0 flex w-full overflow-hidden" style={{ paddingBottom: '24px' }}>
        <ClientSidebar />
        <PageHeaderProvider key={clientId}>
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background">
            {isSettingsRoute || isSimulatorRoute || isLeadsListRoute || isLeadDetailRoute || isChatsRoute || isWorkflowsRoute || isWorkflowEditorRoute || isErrorLogsRoute || isAnalyticsLayoutRoute ? (
              <>
                <PageHeader />
                <main className="flex-1 min-h-0 overflow-hidden">
                   <SubscriptionGatedOutlet />
                </main>
              </>
            ) : (
              <ScrollToTopOnRoute
                data-client-scroll-container="true"
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
                style={{ scrollbarGutter: 'stable' as const }}
              >
                <div className="min-h-full flex flex-col">
                  <PageHeader />
                  <main className="flex-1 min-h-0 pt-6 pb-6">
                    <SubscriptionGatedOutlet />
                  </main>
                </div>
              </ScrollToTopOnRoute>
            )}
          </div>
        </PageHeaderProvider>
      </div>
      <SystemTicker clientId={clientId} />
    </SidebarProvider>
  );
}